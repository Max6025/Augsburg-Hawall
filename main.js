const { app, BrowserWindow, globalShortcut, ipcMain, screen, session, powerSaveBlocker, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const { startServer } = require('./server/setup-server');
const { Controller } = require('./control/controller');
const energie = require('./control/energie');
const lautstaerke = require('./control/lautstaerke');
const hintergrund = require('./control/hintergrund');
const { Wartungsmelder } = require('./control/wartungsmelder');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// --- Umzug des Konfigurationsordners ---------------------------------------------------------
//
// MUSS VOR `new Store(...)` LAUFEN. Der Speicher liest seine Datei beim Anlegen; laeuft der
// Umzug danach, hat die App schon einen leeren Zustand gesehen und ihn beim ersten Schreiben
// festgeschrieben.
//
// Anlass: Beim Umbenennen des Projekts am 2026-09-23 wurde `productName` von
// "Augsburg Wall Display" auf "Hawall Eurasburg" geaendert. Daraus leitet Electron
// `app.getPath('userData')` ab, also %APPDATA%\<productName> -- und dort liegen der
// Home-Assistant-Zugang, alle Dashboards, das Design und die hochgeladenen Bilder. Ohne diesen
// Umzug startet die App nach dem Update wie frisch installiert: keine Verbindung, keine
// Dashboards, eine leere Wand. Von aussen sieht das wie Datenverlust aus, und es waere auch
// einer -- die alten Dateien lagen noch da, nur hat niemand mehr hingesehen.
//
// Einmalig und ohne Merker: Gibt es im neuen Ordner schon eine config.json, ist der Umzug
// erledigt. Ein Merker waere hier die falsche Wahl, denn er muesste im Speicher liegen -- also
// in genau der Datei, um deren Existenz es geht.
//
// Kopiert, nicht verschoben. Wer nach dem Update auf die alte Fassung zurueckgeht, findet
// seinen Stand dort unveraendert vor.
function konfigurationUebernehmen() {
  try {
    const neu = app.getPath('userData');
    const alt = path.join(app.getPath('appData'), 'Augsburg Wall Display');
    if (alt === neu || !fs.existsSync(alt)) return null;
    if (fs.existsSync(path.join(neu, 'config.json'))) return null;
    fs.mkdirSync(neu, { recursive: true });
    fs.cpSync(alt, neu, { recursive: true, force: false, errorOnExist: false });
    return { alt, neu };
  } catch (e) {
    return { fehler: String(e.message || e) };
  }
}
const umzug = konfigurationUebernehmen();

const store = new Store({ name: 'config' });
// Bewusst ein anderer Port als bei HA Wall Display (8787), damit beide Anwendungen auf
// demselben Gerät nebeneinander laufen können -- siehe docs/adr/0001-...
const SETUP_PORT = 8788;

let controller = null;

// Erkennt, ob dieser Start direkt auf ein Update folgt (Version hat sich seit dem letzten
// bekannten Start geaendert) -- dann wird nach dem Start kurz eine Erfolgs-Anzeige gezeigt,
// statt sofort ins normale Dashboard zu springen.
const lastKnownVersion = store.get('lastKnownVersion');
const currentVersion = app.getVersion();
const isPostUpdateLaunch = !!lastKnownVersion && lastKnownVersion !== currentVersion;
store.set('lastKnownVersion', currentVersion);

// Wann dieser Programmlauf begonnen hat. Fuer die Statusseite: Nach einem Windows-Neustart
// startet die App erst mit der Anmeldung -- eine kurze Laufzeit bei langer Geraetelaufzeit
// ist genau der Hinweis, den man dann braucht.
const GESTARTET_AM = Date.now();

// --- Der Ueberwachung sagen, dass hier gearbeitet wird ---------------------------------------
//
// Ohne das ist jedes Update fuer Uptime Kuma ein Ausfall: Die App beendet sich, der Installer
// laeuft, das Geraet startet neu -- und die Statusseite wird rot, jedes Mal. Nach dem dritten
// Fehlalarm glaubt niemand mehr der Anzeige, auch wenn wirklich etwas kaputt ist.
//
// Die Merker liegen im Speicher der App, nicht im Arbeitsspeicher: Zwischen "gemeldet" und
// "beendet" liegt genau der Neustart, um den es geht.
const melder = new Wartungsmelder({
  konfig: () => ({
    url: store.get('wartungsmelderUrl') || '',
    schluessel: store.get('wartungsmelderSchluessel') || ''
  }),
  offeneLesen: () => store.get('wartungenOffen') || {},
  offeneSchreiben: (d) => store.set('wartungenOffen', d),
  log: (stufe, text) => { if (controller) controller.log(stufe, text); else console.log(stufe, text); }
});

// Die eigene Gesundheitsroute fragen, bis sie antwortet.
//
// Der Beweis, dass das Panel wieder da ist, ist nicht "die App laeuft" -- das waere ein Urteil
// ueber sich selbst. Er ist "der Webserver antwortet", denn genau das sieht die Ueberwachung
// von draussen. Erst danach wird die Wartung geschlossen.
async function gesundAbwarten(versuche = 20, abstand = 3000) {
  for (let i = 0; i < versuche; i++) {
    try {
      const a = await fetch(`http://127.0.0.1:${SETUP_PORT}/api/gesundheit`);
      if (a.ok) return true;
    } catch (e) { /* noch nicht da -- weiter warten */ }
    await new Promise(f => setTimeout(f, abstand));
  }
  return false;
}

// Die Vorort-Wartung endet, wenn die Taskleiste wieder verschwindet -- das ist der Moment, in
// dem niemand mehr davor steht. Gemerkt wird der letzte Stand, weil `onStateChange` bei jedem
// Takt kommt und nicht nur beim Wechsel.
let taskleisteWarSichtbar = false;
function vorortEnde(state) {
  const sichtbar = !!(state && state.taskleisteBis);
  if (taskleisteWarSichtbar && !sichtbar) {
    melder.beenden('wandpanel-vorort').catch(() => {});
  }
  taskleisteWarSichtbar = sichtbar;
}

let mainWindow = null;
// `geprueft` trennt "noch nicht nachgesehen" von "nachgesehen, nichts da".
//
// Ohne dieses Feld sind beide Zustaende ununterscheidbar, und die Update-Seite schrieb
// "Diese Version ist aktuell", bevor ueberhaupt jemand GitHub gefragt hatte. Das ist eine
// Behauptung ohne Grundlage -- und weil die App von sich aus NIE nachsieht (kein Abruf beim
// Start, kein Intervall), ist es der Zustand, in dem man die Seite normalerweise oeffnet.
let updateState = {
  geprueft: false, checking: false, available: false, downloaded: false,
  version: null, progress: 0, error: null
};

// GitHub wird ausschliesslich auf ausdruecklichen Wunsch gefragt: kein Abruf beim Start, kein
// Intervall im Hintergrund. Ausgeloest wird eine Suche nur ueber "Nach Updates suchen" in der
// Einrichtungsoberflaeche. autoDownload darf deshalb an bleiben -- es greift erst nach einer
// Suche, und eine Suche gibt es nur auf Knopfdruck.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;

// Ein Druck genuegt: suchen, laden und installieren laufen ohne weitere Rueckfrage durch.
// Auch dann, wenn gerade ein Anzeigefenster laeuft -- die Unterbrechung ist gewollt in Kauf
// genommen, weil der Anstoss vom Nutzer selbst kam.
let installWhenDownloaded = false;

autoUpdater.on('checking-for-update', () => {
  updateState = { ...updateState, checking: true, error: null };
});
autoUpdater.on('update-available', (info) => {
  updateState = { ...updateState, geprueft: true, checking: false, available: true, version: info.version };
});
autoUpdater.on('update-not-available', () => {
  updateState = { ...updateState, geprueft: true, checking: false, available: false, downloaded: false };
});
autoUpdater.on('download-progress', (p) => {
  updateState = { ...updateState, progress: Math.round(p.percent) };
});
autoUpdater.on('update-downloaded', (info) => {
  updateState = { ...updateState, checking: false, downloaded: true, version: info.version, progress: 100 };
  if (installWhenDownloaded) {
    installWhenDownloaded = false;
    updater.install();
  }
});
autoUpdater.on('error', (err) => {
  updateState = { ...updateState, geprueft: true, checking: false, error: String((err && err.message) || err) };
});

const updater = {
  currentVersion: app.getVersion(),
  getState: () => updateState,
  // autoInstall: bei true wird nach dem Herunterladen sofort installiert (der Ein-Klick-Weg
  // aus der Einrichtungsoberflaeche).
  check: (autoInstall = false) => {
    installWhenDownloaded = !!autoInstall;
    return autoUpdater.checkForUpdates().catch(err => {
      installWhenDownloaded = false;
      updateState = { ...updateState, checking: false, error: String(err.message || err) };
    });
  },
  install: () => {
    if (!updateState.downloaded) return;
    // Update-Bildschirm auf dem Wall Display zeigen, dann still (ohne Assistent,
    // ohne Admin-Abfrage -- perMachine:false + Silent-Flag) installieren und neu starten.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'updating.html')).catch(() => {});
    }
    // Jetzt, nicht spaeter: Gleich ist die App weg, und dann kann niemand mehr etwas setzen.
    // Der Desktop traegt waehrend des Updates den Hinweis, dass gerade gewartet wird.
    hintergrundSetzen('wartung').catch(() => {});
    // Erst melden, dann beenden -- und zwar in dieser Reihenfolge abgewartet: Nach
    // `quitAndInstall` gibt es keinen Prozess mehr, der eine Anfrage abschicken koennte, und
    // eine Wartung, die nie ankam, ist genau der Fehlalarm, den das hier verhindern soll.
    // Die Verzoegerung faellt nicht auf: Auf der Wand steht schon das Update-Bild.
    const wartungMelden = () => melder.beginnen('update', {
      von: app.getVersion(), nach: updateState.version
    }).catch(() => {});
    wartungMelden().finally(() => {
      setTimeout(() => {
        autoUpdater.quitAndInstall(true, true); // isSilent, isForceRunAfter
      }, 1200);
    });
  }
};

// --- Das System wach halten, das Display aber schlafen lassen ---------------------------------
//
// Gemessen am 2026-09-09 auf dem Surface Go: Eine Minute nach dem Abschalten des Panels ging das
// GERAET in Connected Standby (Kernel-Power 506). Die Anwendung war damit weg -- kein
// Waechter-Takt, kein Setup-Server, und die Anzeige stand still. Erst beim Aufwachen
// (Kernel-Power 507) lief alles weiter und das Panel ging an.
//
// "prevent-app-suspension" haelt das System wach und erlaubt dem Bildschirm ausdruecklich weiter,
// sich abzuschalten. Genau diese Kombination brauchen wir: dunkles Panel, wacher Rechner.
//
// Vorbehalt: Auf Modern-Standby-Geraeten behandelt Windows solche Anforderungen anders als auf
// klassischen PCs. Ob es dort ausreicht, ist am Geraet zu messen -- deshalb wird der Zustand
// protokolliert, damit man es im Nachhinein nachvollziehen kann.
let powerBlockerId = null;

function keepSystemAwake(reason) {
  if (process.platform !== 'win32') return;
  try {
    if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) return;
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    if (controller) controller.log('info', `System wird wachgehalten (${reason}), Bildschirm darf weiter abschalten`);
  } catch (err) {
    if (controller) controller.log('warn', `System konnte nicht wachgehalten werden: ${err.message}`);
  }
}

function getLocalIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function hasConfig() {
  return !!(store.get('haUrl') && store.get('token'));
}

// Erzwingt Querformat-Darstellung: falls Windows den Bildschirm dreht (z.B. Surface Go 2
// Rotationssensor), wird der Seiteninhalt per CSS gegengedreht, damit die App immer wie im
// Querformat aussieht -- ein echtes OS-Rotationssperren gibt es unter Windows fuer normale
// Anwendungen nicht, das hier ist die praktikable Kompensation auf App-Ebene.
let insertedCssKey = null;
async function applyOrientationLock() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const angle = display.rotation || 0; // 0, 90, 180, 270

  try {
    if (insertedCssKey) {
      await mainWindow.webContents.removeInsertedCSS(insertedCssKey).catch(() => {});
      insertedCssKey = null;
    }
    if (angle === 0) return;

    const { width, height } = display.size;
    const compensate = (360 - angle) % 360;
    let css = `html { transform: rotate(${compensate}deg); transform-origin: center center; }`;
    if (angle === 90 || angle === 270) {
      css += `html { position: fixed; top: 50%; left: 50%; width: ${height}px; height: ${width}px;
        margin-top: -${width / 2}px; margin-left: -${height / 2}px; }`;
    }
    insertedCssKey = await mainWindow.webContents.insertCSS(css);
  } catch (e) {
    // Bildschirmwechsel wird nicht als kritisch behandelt
  }
}

// Der Mauszeiger wird vom HAUPTPROZESS abgeschaltet, nicht nur per Stylesheet der Seite.
//
// Grund: Das Stylesheet gilt nur fuer dashboard.html. Die App zeigt aber auch andere Seiten --
// updating.html, update-success.html, die Fehlerseite -- und ueber denen stand der Zeiger
// weiterhin. Eingespeist wird bei JEDEM Laden, weil eingefuegtes CSS einen Seitenwechsel
// nicht ueberlebt.
const ZEIGER_AUS = '*, *::before, *::after { cursor: none !important; }';
function zeigerAusblenden(win) {
  if (!win || win.isDestroyed()) return;
  const einspeisen = () => {
    win.webContents.insertCSS(ZEIGER_AUS).catch(() => { /* Seite gerade weg */ });
  };
  win.webContents.on('did-finish-load', einspeisen);
  win.webContents.on('dom-ready', einspeisen);
  einspeisen();
}

// Das Fenster in den Kiosk-Modus und zurueck. Gerufen wird das vom Controller, wenn die
// Taskleiste sichtbar werden soll -- ein Kiosk-Fenster liegt darueber, und eine Leiste, die man
// sieht, aber nicht trifft, ist schlimmer als keine.
//
// Das Vollbild muss MIT weg. `setKiosk(false)` allein laesst das Fenster im Vollbild, und damit
// bleibt die Leiste zugedeckt -- von aussen sieht das aus, als haette das Ausblenden nicht
// funktioniert. Die Groesse kommt danach aus `workArea`: dem Bildschirm ohne den Streifen, den
// die Taskleiste fuer sich beansprucht. Windows rechnet diesen Streifen weiter heraus, auch
// waehrend das Fenster der Leiste versteckt ist -- deshalb passt beides zusammen.
function kioskSetzen(kiosk) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Schon im Kiosk-Modus: nichts anfassen. Das Fenster kommt so auf die Welt (createWindow),
  // und der erste Takt des Waechters wuerde es sonst unmittelbar nach dem Start noch einmal
  // auf die Bildschirmgroesse ziehen -- eine Groessenaenderung an einem Vollbildfenster, die
  // nichts verbessern kann und je nach Windows-Version einen sichtbaren Sprung erzeugt.
  if (kiosk && mainWindow.isKiosk()) return;
  const display = screen.getPrimaryDisplay();
  if (!kiosk) {
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);
    mainWindow.setBounds(display.workArea);
    return;
  }
  mainWindow.setKiosk(true);
  mainWindow.setFullScreen(true);
  mainWindow.setBounds(display.bounds);
  // Den Fokus zurueckholen: Wer die Taskleiste benutzt hat, hat ihn dort gelassen, und ohne das
  // kommen Tastendruecke im Dashboard nicht mehr an.
  mainWindow.focus();
}

// Die Standby-Fristen, wie `control/energie.js` sie zuletzt gemeldet hat: { ac, dc } in
// Sekunden, 0 heisst "nie". null heisst "nicht zu ermitteln". Nur zur Anzeige.
let schlafZeitgeberWerte = null;

/**
 * Die Schlaf-Zeitgeber auf "nie" setzen und das Ergebnis merken.
 *
 * Braucht KEINE erhoehten Rechte -- nachgemessen, siehe den Kopf von control/energie.js.
 * Deshalb laeuft es still beim Start und nach jeder erkannten Taktluecke, ohne Rueckfrage und
 * ohne Merker.
 */
function energieSetzen() {
  return energie.setzen({ log: (s, m) => { if (controller) controller.log(s, m); } })
    .then((r) => { schlafZeitgeberWerte = r.werte; return r; })
    .catch(() => null);
}

function createWindow() {
  // Kamera-Zugriff automatisch erlauben -- wird ausschliesslich lokal fuer die
  // Annaeherungserkennung genutzt (Frame-Differenz im Renderer), es wird nichts
  // gespeichert oder irgendwohin uebertragen. Ohne diesen Handler wuerde Electron
  // im Kiosk-Modus (kein sichtbarer Berechtigungsdialog moeglich) den Zugriff blockieren.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });

  mainWindow = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  zeigerAusblenden(mainWindow);

  // Nach einem Update: der Ladekreis ("Update wird installiert") laeuft nahtlos weiter,
  // auch waehrend/nach dem Neustart -- kein Sprung ins Leere. Erst wenn die App wirklich
  // wieder laeuft, wird kurz "Erfolgreich auf Version X aktualisiert" gezeigt, danach geht
  // es automatisch zur normalen Ansicht (update-success.html ruft dafuer reloadView() auf).
  if (isPostUpdateLaunch) {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'updating.html'));
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'update-success.html'), {
        search: `version=${encodeURIComponent(currentVersion)}`
      });
    }, 1800); // kurze Ueberbrueckung, bis der lokale Server & alles bereit ist
  } else {
    loadCurrentView();
  }

  mainWindow.webContents.on('did-finish-load', applyOrientationLock);

  // Wartungs-Shortcut: App beenden fuer Vor-Ort-Wartung.
  //
  // Die Taskleiste wird dabei ausdruecklich freigegeben. Ohne das stuende man nach dem Beenden
  // vor einem Windows ohne Startmenue, ohne Uhr und ohne Fensterleiste -- und der einzige Weg
  // zurueck waere ein Neustart des Geraets.
  globalShortcut.register('Control+Alt+Q', () => {
    if (controller) controller.taskleisteFreigeben();
    app.quit();
  });

  // Der Wartungs-Ausstieg: pausiert den Waechter UND blendet die Taskleiste ein, damit das
  // Panel bedienbar ist und man an Windows kommt. Einer von drei Wegen -- die anderen beiden
  // sind die Tipp-Geste in der oberen linken Ecke des Dashboards und der Knopf in der
  // Setup-Oberflaeche. Ein Geraet, das sich selbst abschalten kann, braucht mehr als einen
  // Ausweg, und eine Tastenkombination hilft auf einem Touch-Panel ohne Tastatur nicht weiter.
  globalShortcut.register('Control+Alt+W', () => {
    if (controller) controller.wartung();
  });
}

function loadCurrentView() {
  if (!mainWindow) return;
  if (hasConfig()) {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'), {
      search: `port=${SETUP_PORT}`
    });
  } else {
    const ips = getLocalIps();
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'waiting.html'), {
      search: `ips=${encodeURIComponent(ips.join(','))}&port=${SETUP_PORT}`
    });
  }
}

// Wird vom lokalen Setup-Server aufgerufen, sobald eine Konfiguration gespeichert wurde
function onConfigSaved() {
  loadCurrentView();
}

// Sperrt Windows-eigene Rand-Wischgesten (Action Center, Task-Ansicht, Widgets, Taskleiste-
// Reveal), die auf einem Touch-Geraet sonst VOR unserer App zugreifen und die Geste komplett
// schlucken -- das ist derselbe Grund, warum eigene Wisch-Gesten im Dashboard nicht ankommen.
// Dazu Benachrichtigungen: Ein Toast ueber dem Dashboard ist auf einer Wand nichts als Stoerung.
//
// ALLES UNTER HKCU -- UND ZWAR AUSSERHALB VON \Software\Policies.
//
// Das ist die Lehre vom 2026-09-22, gemessen auf dem Geraet: Drei der sechs Werte waren nie
// angekommen, und niemand hat es gemerkt. `Get-Acl HKCU:\Software\Policies` gibt dem Konto
// nur `ReadKey` -- dieser Zweig gehoert der Gruppenrichtlinie, und ein unelevierter Prozess
// darf dort nicht schreiben. Dass das Konto Administrator IST, hilft nicht: Bei
// eingeschalteter Benutzerkontensteuerung laeuft die App ohne erhoehte Rechte.
//
// Die Fehler waren doppelt unsichtbar: `exec` bekam einen Rueckruf, der jeden Fehler
// verschluckt (`() => resolve()`), und das Erledigt-Flag wurde trotzdem gesetzt. Beim naechsten
// Start lief es deshalb nie wieder an. Jetzt gilt:
//
//   1. Kein Wert aus \Software\Policies. Fuer die Benachrichtigungen gibt es mit
//      PushNotifications\ToastEnabled einen Schluessel, der dem Benutzer gehoert.
//   2. Jeder Fehlschlag wird protokolliert, mit dem Wortlaut von reg.exe.
//   3. Das Flag wird NUR gesetzt, wenn wirklich alles durchging. Sonst versucht es der
//      naechste Start erneut -- vielleicht ist die Ursache dann behoben.
//   4. Das Flag traegt eine Nummer. Wer hier einen Wert ergaenzt, zaehlt sie hoch, sonst
//      bekommen bestehende Installationen die Ergaenzung nie.
const KIOSK_SPERREN_STAND = 2;

function applyWindowsKioskLockdown() {
  if (process.platform !== 'win32') return;
  if (Number(store.get('kioskLockdownStand')) >= KIOSK_SPERREN_STAND) return;

  const sperren = [
    ['Wischgeste vom Rand', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\EdgeUI', 'AllowEdgeSwipe', 0],
    ['Ecke oben links', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\EdgeUi', 'DisableTLcorner', 1],
    ['Ecke oben rechts', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\EdgeUi', 'DisableTRcorner', 1],
    // Frueher DisableNotificationCenter unter \Software\Policies -- dort schreibgeschuetzt.
    ['Benachrichtigungen', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', 'ToastEnabled', 0],
    ['Benachrichtigungen auf dem Sperrbildschirm', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', 'LockScreenToastEnabled', 0],
    // Frueher AllowNewsAndInterests unter \Software\Policies -- dort schreibgeschuetzt.
    // TaskbarDa blendet den Widget-Knopf aus und gehoert dem Benutzer.
    ['Widget-Knopf', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarDa', 0],
    ['Suchfeld in der Taskleiste', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search', 'SearchboxTaskbarMode', 0]
  ];

  const setzen = ([name, pfad, wert, zahl]) => new Promise((fertig) => {
    const befehl = `reg add "${pfad}" /v ${wert} /t REG_DWORD /d ${zahl} /f`;
    exec(befehl, { timeout: 5000 }, (err, stdout, stderr) => {
      if (!err) return fertig({ name, ok: true });
      const grund = String(stderr || stdout || err.message || '').trim().split('\n')[0];
      fertig({ name, ok: false, grund });
    });
  });

  Promise.all(sperren.map(setzen)).then((ergebnisse) => {
    const kaputt = ergebnisse.filter(e => !e.ok);
    kaputt.forEach(e => {
      if (controller) controller.log('warn', `Sperre "${e.name}" konnte nicht gesetzt werden: ${e.grund}`);
    });
    if (kaputt.length) {
      if (controller) {
        controller.log('warn', `${kaputt.length} von ${ergebnisse.length} Windows-Sperren fehlgeschlagen -- `
          + 'beim naechsten Start wird es erneut versucht.');
      }
      return;   // Flag NICHT setzen
    }
    store.set('kioskLockdownStand', KIOSK_SPERREN_STAND);
    if (controller) controller.log('info', `Windows-Sperren gesetzt (Stand ${KIOSK_SPERREN_STAND})`);
    // Explorer neu starten, damit die Aenderungen sofort ohne Geraete-Neustart greifen
    exec('taskkill /f /im explorer.exe', { timeout: 5000 }, () => {
      exec('start explorer.exe', { timeout: 5000 }, () => {});
    });
  });
}

// Schiebt den aktuellen Steuerungszustand an die geladene Seite. Das Dashboard blendet daraus
// die Fehlerseite ein bzw. aus -- ein Seitenwechsel wuerde das Dashboard neu laden und dabei
// jedes Mal alle Home-Assistant-Daten neu holen.
function pushControlState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('control-state', state);
  }
  vorortEnde(state);
}

// Ohne diesen Schalter laesst Chromium Ton erst zu, nachdem jemand die Seite angefasst hat.
// An einer Wand fasst wochenlang niemand etwas an -- der Akku-Warnton waere genau dann still,
// wenn er gebraucht wird, und zwar ohne jede Fehlermeldung.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  createWindow();

  controller = new Controller({
    store,
    logDir: app.getPath('userData'),
    onStateChange: pushControlState,
    // Wartung vor Ort an die Ueberwachung melden. Bewusst im Controller aufgerufen und nicht
    // hier: Der Knopf auf der Einstellungsseite laeuft ueber den Server direkt in
    // controller.wartung() und wuerde hier vorbeigehen.
    wartungMelden: ({ minuten }) => melder.beginnen('vorort', { minuten }).catch(() => {}),
    // Sekunden seit der letzten Eingabe am Geraet. Damit erkennt der Controller, dass jemand
    // davorsteht -- auch dann, wenn weder "resume" noch "unlock-screen" gefeuert haben, weil der
    // Bildschirm bloss dunkel geschaltet war.
    idleSeconds: () => {
      try { return powerMonitor.getSystemIdleTime(); } catch (e) { return Infinity; }
    },
    // Am Netz oder am Akku? Davon haengt ab, ob das System wachgehalten wird -- siehe
    // control/panel.js. Im Zweifel Netzbetrieb annehmen.
    aufAkku: () => {
      try { return powerMonitor.isOnBatteryPower(); } catch (e) { return false; }
    },
    // Damit der Controller das Fenster aus dem Kiosk-Modus holen kann, wenn die Taskleiste
    // sichtbar werden soll. Er selbst kennt kein Electron -- siehe den Kopf von
    // control/controller.js.
    setKiosk: kioskSetzen,
    schlafZeitgeber: () => schlafZeitgeberWerte,
    // Nach einer Taktluecke noch einmal setzen: Geschlafen heisst, dass an den Fristen etwas
    // nicht stimmt -- ein Windows-Update kann sie zurueckgesetzt haben.
    energieNachziehen: () => { energieSetzen().then(() => { if (controller) controller.refresh(); }); }
  });
  controller.start();

  // Erst hier protokollierbar: Der Umzug lief, bevor es einen Controller gab.
  if (umzug && umzug.fehler) {
    controller.log('warn', `Konfiguration konnte nicht uebernommen werden: ${umzug.fehler}. `
      + 'Die App startet mit leerem Zustand -- der alte Ordner liegt unveraendert weiter da.');
  } else if (umzug) {
    controller.log('info', `Konfiguration uebernommen: "${umzug.alt}" -> "${umzug.neu}". `
      + 'Der alte Ordner bleibt als Sicherung liegen.');
  }

  // Die eigentliche Loesung, und sie steht hier in einer Zeile: Ohne diese Fristen schlaeft das
  // Geraet in derselben Sekunde ein, in der die Nachtsperre das Panel abschaltet -- gemessen am
  // 2026-09-23, siehe den Kopf von control/energie.js.
  energieSetzen().then(() => { if (controller) controller.refresh(); });

  keepSystemAwake('Start');
  // Nach einem Aufwachen die Anforderung neu setzen: Windows verwirft sie in manchen
  // Uebergaengen, und ein stillschweigend verlorener Wachhalter waere derselbe Fehler
  // wie eine stille Panel-Steuerung.
  powerMonitor.on('resume', () => keepSystemAwake('nach dem Aufwachen'));

  // --- Aussperr-Schutz -----------------------------------------------------------------------
  //
  // Am Geraet gemessen: Wacht das Panel auf und Windows zeigt den Sperrbildschirm, schaltet der
  // Waechter fuenf Sekunden spaeter wieder ab -- und ALLE drei Fluchtwege sind dort wirkungslos.
  // Die Tipp-Geste erreicht das Dashboard nicht, weil der Sperrbildschirm davor liegt. Globale
  // Tastenkuerzel laesst Windows dort nicht durch. Und der Schalter in der Weboberflaeche
  // braucht den Server, der beim Aufwachen noch nicht antwortet.
  //
  // Deshalb: Jedes Aufwachen und jedes Entsperren setzt selbsttaetig eine Pause. Wer vor dem
  // Geraet steht, bekommt garantierte Zeit zum Anmelden, statt gegen eine Uhr zu arbeiten.
  const AUFWACH_PAUSE_MINUTEN = 2;
  const pauseNachAufwachen = (anlass) => {
    if (!controller) return;
    controller.log('info', `${anlass}: Bildschirmsteuerung pausiert ${AUFWACH_PAUSE_MINUTEN} Minuten, damit die Anmeldung moeglich ist`);
    controller.pause(AUFWACH_PAUSE_MINUTEN);
  };
  powerMonitor.on('resume', () => pauseNachAufwachen('Aufgewacht'));
  powerMonitor.on('unlock-screen', () => pauseNachAufwachen('Entsperrt'));
  powerMonitor.on('lock-screen', () => {
    if (controller) controller.log('info', 'Sitzung gesperrt -- das Wall Display liegt jetzt hinter dem Sperrbildschirm');
  });

  // Die Groesse des Panels weiterreichen. Der Karten-Editor laeuft auf einem ANDEREN Geraet
  // und kann sonst nicht wissen, wie viel Platz auf der Wand ueberhaupt da ist -- man zieht
  // Karten zurecht und sieht am Ergebnis erst auf dem Panel, dass es nicht passt.
  const getPanelSize = () => {
    try {
      const d = screen.getPrimaryDisplay();
      const w = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow.getContentBounds() : null;
      return {
        breite: d.bounds.width, hoehe: d.bounds.height,
        // Zur Fehlersuche: Weicht die Fenster- von der Bildschirmgroesse ab, sieht man auf
        // dem Panel einen schwarzen Rand -- und kein CSS der Seite kann das erklaeren.
        fenster: w ? { breite: w.width, hoehe: w.height } : null,
        skalierung: d.scaleFactor,
        drehung: d.rotation
      };
    } catch (e) {
      return null;
    }
  };
  startServer({
    port: SETUP_PORT, store, onConfigSaved, getLocalIps, updater, controller, getPanelSize,
    // Fuer die Statusseite: Womit der Stand der Windows-Sperren zu vergleichen ist, und
    // seit wann die App laeuft. Beides weiss nur der Hauptprozess.
    sperrenSoll: KIOSK_SPERREN_STAND,
    gestartetAm: GESTARTET_AM,
    // Damit die Einstellungsseite den Wartungsmelder auf demselben Weg pruefen kann, den ein
    // Update spaeter nimmt.
    melder
  });
  applyWindowsKioskLockdown();

  // Was vor dem Neustart als Wartung gemeldet wurde, wird jetzt geschlossen -- sobald der
  // eigene Webserver antwortet. Beharrlich, weil Home Assistant (und damit das Add-on) laenger
  // bootet als das Panel: Ein einziger Versuch geht in genau diesem Fall ins Leere, und die
  // Wartung liefe dann nur noch durch ihr Fenster ab.
  gesundAbwarten().then(() => melder.abschliessenWiederholt());

  // Auto-Start bei Windows-Anmeldung aktivieren
  app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });

  // Bewusst KEIN updater.check() hier: GitHub wird nur auf Knopfdruck gefragt.

  screen.on('display-metrics-changed', (event, display, changedMetrics) => {
    if (changedMetrics.includes('rotation') || changedMetrics.includes('bounds')) {
      // Nur im Kiosk-Modus auf den ganzen Bildschirm ziehen. Laeuft gerade eine Wartung, liegt
      // das Fenster absichtlich nur auf der `workArea` -- es hier zurueckzuziehen wuerde die
      // gerade eingeblendete Taskleiste wieder zudecken.
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isKiosk()) {
        mainWindow.setBounds(screen.getPrimaryDisplay().bounds);
      }
      applyOrientationLock();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (controller) controller.stop();
});

ipcMain.handle('reload-view', () => loadCurrentView());

// Die Tipp-Geste im Dashboard (fuenfmal in die obere linke Ecke) landet hier: Pause UND
// sichtbare Taskleiste, siehe controller.wartung().
ipcMain.handle('wartung-anfordern', (event, minutes) => {
  if (!controller) return { ok: false };
  return { ok: true, ...controller.wartung(minutes) };
});

ipcMain.handle('get-control-state', () => (controller ? controller.getState() : null));

// Bildschirmhelligkeit ueber Windows WMI regeln (funktioniert fuer eingebaute Displays wie
// beim Surface Go 2, die DDC/CI bzw. WmiMonitorBrightnessMethods unterstuetzen). Wird fuer
// den Nachtmodus genutzt, um die Helligkeit zusaetzlich zum schwarzen Bildschirm zu senken.
// Schlaegt auf nicht unterstuetzter Hardware oder Nicht-Windows-Systemen einfach still fehl --
// das schwarze Overlay allein reicht dann weiterhin als Nachtmodus-Effekt aus.
// --- Windows-Hintergrundbild ------------------------------------------------------------------
//
// Sichtbar wird es genau dann, wenn die App NICHT laeuft: waehrend eines Updates beendet sie
// sich, der Installer laeuft still durch, und die Taskleiste ist ausgeblendet -- man schaut auf
// den nackten Desktop. Mit diesem Bild sieht man stattdessen dieselben Farbwolken wie hinter
// dem Dashboard, waehrend des Updates mit einem Satz darauf.
function hintergrundPfad(art) {
  return path.join(path.dirname(store.path), art === 'wartung' ? 'desktop-wartung.png' : 'desktop.png');
}

function hintergrundSetzen(art) {
  if (!store.get('desktopHintergrund')) return Promise.resolve({ ok: false, fehler: 'abgeschaltet' });
  return hintergrund.setzen(hintergrundPfad(art), { verzeichnis: app.getPath('userData') });
}

ipcMain.handle('desktop-hintergrund-setzen', (event, art) => hintergrundSetzen(art));

// Hebt die Systemlautstaerke an, waehrend eine Akkuwarnung laeuft. Gesenkt wird sie nie --
// und ausserhalb einer Warnung ruft niemand das hier auf.
ipcMain.handle('system-lautstaerke-anheben', async (event, prozent) => {
  try {
    const r = await lautstaerke.anheben(prozent, { verzeichnis: app.getPath('userData') });
    if (controller && r && r.ok && (r.warStumm || r.vorher < r.jetzt)) {
      controller.log('info', `Akkuwarnung: Lautstaerke von ${r.vorher} % auf ${r.jetzt} % angehoben`
        + (r.warStumm ? ' und Stummschaltung aufgehoben' : ''));
    }
    return r;
  } catch (e) {
    return { ok: false, fehler: String(e.message || e) };
  }
});

ipcMain.handle('set-brightness', (event, percent) => {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false });
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const cmd = `powershell -NoProfile -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${value})"`;
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000 }, (err) => {
      resolve({ ok: !err });
    });
  });
});
