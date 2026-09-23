// Modern Standby abschalten -- und nachsehen, ob es abgeschaltet IST.
//
// Der Kern des Problems, gemessen am 2026-09-22 auf dem Surface Go: Auf einem
// Modern-Standby-Geraet ist das ABSCHALTEN DES BILDSCHIRMS der Ausloeser fuer den Standby, kein
// Leerlauf-Timeout. In derselben Sekunde, in der die Nachtsperre das Panel abschaltete, begann
// Connected Standby (Kernel-Power 506). `ES_SYSTEM_REQUIRED` haelt diesen Uebergang nicht auf,
// und gegen den Desktop Activity Moderator, der kurz darauf die Anwendung suspendiert, hilft es
// auch nicht. Die Folge sieht man von aussen an zwei Dingen gleichzeitig: Der Setup-Server
// antwortet nicht mehr, und "Beruehrung pausiert zwei Minuten" feuert nicht -- die Regel lebt im
// Takt, und der Takt laeuft nicht.
//
// `PlatformAoAcOverride = 0` schaltet Modern Standby ab. Das Geraet nutzt danach klassischen
// S3-Schlaf, und damit greift die Wach-Anforderung wieder. WIRKSAM ERST NACH EINEM NEUSTART.
//
// --- Und damit ist es NICHT erledigt -------------------------------------------------------
//
// Ohne Modern Standby greift der KLASSISCHE Schlaf-Timer des Energieschemas, ab Werk oft
// dreissig Minuten. Dann ist der Webserver aus einem anderen Grund weg, und von aussen sieht
// das genauso aus wie vorher. Deshalb werden im selben Zug die Zeitgeber abgeschaltet:
// Standby, Ruhezustand und der Bildschirm-Zeitgeber.
//
// Der Bildschirm-Zeitgeber gehoert mit dazu, obwohl er nichts am Erreichbarsein aendert: Ueber
// das Panel entscheidet in diesem Projekt `decide()`, und zwei Stellen, die dasselbe schalten,
// widersprechen einander spaetestens beim naechsten Sonderfall. Bisher hat `panel.js` gegen
// Windows angeschaltet (ON_REASSERT_MS, jede Minute) -- das ist ein Wettlauf, kein Entwurf.
//
// Was dabei NICHT passiert: Der Bildschirm bleibt weiter wirklich abschaltbar. Die Nachtsperre
// schaltet ihn ueber SC_MONITORPOWER aus, die Hintergrundbeleuchtung ist dann dunkel, und eine
// Beruehrung weckt ihn -- das ist der Unterschied zu "Helligkeit auf 0", das dieses Projekt
// ausdruecklich nicht will (siehe ADR 0002).
//
// --- Warum das hier steht und nicht im Installer ---------------------------------------------
//
// Der Wert liegt unter HKLM und braucht erhoehte Rechte. Der Installer ist eine
// Per-User-Installation (`perMachine: false`) und laeuft deshalb unelevert -- er versucht es
// (build/installer.nsh), kommt aber im Normalfall nicht durch. `perMachine: true` waere der
// naheliegende Ausweg und ist der falsche: Dann braeuchte JEDES Update erhoehte Rechte, und ein
// UAC-Dialog auf einem Wandpanel, vor dem niemand steht, ist ein Update, das fuer immer haengt.
//
// Bleibt genau ein UAC-Dialog, ein einziges Mal. Der wird ausdruecklich nur dann ausgeloest,
// wenn jemand VOR ORT eine Wartung angefordert hat -- fuenfmal oben links getippt oder
// Strg+Alt+W gedrueckt. Nicht vom Handy aus: Der Dialog erscheint auf dem PANEL, und wer ihn
// aus dem Netz ausloest, hat ihn nicht vor sich.
//
// Versucht wird es genau einmal (Merker im Speicher). Wer ablehnt, bekommt keinen zweiten
// Dialog aufgedraengt; stattdessen sagt die Einrichtungsseite, dass es noch aussteht.

const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHLUESSEL = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power';
const WERT = 'PlatformAoAcOverride';
const MERKER = 'aoacVersuchtStand';
const VERSUCH_STAND = 1;

// Lesen geht unelevert: HKLM ist fuer Benutzer lesbar. `powercfg /a` waere die genauere Antwort
// -- welcher Schlafzustand wirklich verfuegbar ist -- verlangt aber erhoehte Rechte und faellt
// damit aus. Der Registrierungswert sagt immerhin, ob die Umstellung vorgenommen wurde.
const LESE_BEFEHL = `reg query "${SCHLUESSEL}" /v ${WERT}`;

// Alles, was erhoehte Rechte braucht, in EINER Datei -- und damit hinter EINEM UAC-Dialog.
//
// Warum eine Datei und nicht ein Aufruf: Es sind sieben Befehle. Als verschachtelte
// Zeichenkette durch `exec` -> `powershell -Command` -> `Start-Process -ArgumentList` ->
// `cmd /c` muessten Anfuehrungszeichen dreifach maskiert werden, und der Backslash im
// Registrierungspfad kommt dabei irgendwo abhanden. Dasselbe Urteil wie in
// control/lautstaerke.js: Bleibt die Datei.
//
// Die Ausgabe wird MITGESCHRIEBEN. Der elevierte Prozess ist ein eigener; seine Ausgabe
// erreicht uns nicht. Ohne das Protokoll waere ein fehlgeschlagener Befehl unsichtbar -- und
// unsichtbare Fehlschlaege sind in diesem Projekt schon zweimal teuer geworden.
const LOG_NAME = 'wall-standby.log';

// Die Umleitung steht IN der Datei, nicht im Aufruf. `%~dp0` ist ihr eigenes Verzeichnis.
//
// Das ist nicht Geschmack: Stuende die Umleitung im Aufruf, muessten ihre Anfuehrungszeichen
// durch drei Ebenen (`exec` -> `powershell -Command "..."` -> `-ArgumentList '...'` -> `cmd /c`)
// maskiert werden. PowerShell liest `""` in einer EINFACH bequoteten Zeichenkette als zwei
// Zeichen, nicht als ein maskiertes -- der Pfad kaeme zerlegt an. In der Datei gibt es die
// Ebenen nicht, und `Start-Process` braucht ueberhaupt keine Argumente.
const SKRIPT = [
  '@echo off',
  'set LOG=%~dp0' + LOG_NAME,
  // LEERZEICHEN VOR JEDEM `>`. Eine Ziffer unmittelbar davor liest cmd als Dateikennung:
  // `standby-timeout-ac 0>> datei` leitet die STANDARDEINGABE um und verschluckt die 0 --
  // powercfg bekaeme seinen Wert nie und der Zeitgeber blieb stehen, ohne Fehlermeldung.
  // Dasselbe bei `%TIME%>`: Die Uhrzeit endet auf eine Ziffer.
  'echo Umstellung %DATE% %TIME% > "%LOG%"',
  `reg add "${SCHLUESSEL}" /v ${WERT} /t REG_DWORD /d 0 /f >> "%LOG%" 2>&1`,
  // Kein `&&` zwischen den Zeilen: Ein fehlgeschlagener Befehl soll die folgenden nicht
  // aufhalten. Sechs von sieben sind besser als einer.
  'powercfg /change standby-timeout-ac 0 >> "%LOG%" 2>&1',
  'powercfg /change standby-timeout-dc 0 >> "%LOG%" 2>&1',
  'powercfg /change hibernate-timeout-ac 0 >> "%LOG%" 2>&1',
  'powercfg /change hibernate-timeout-dc 0 >> "%LOG%" 2>&1',
  'powercfg /change monitor-timeout-ac 0 >> "%LOG%" 2>&1',
  'powercfg /change monitor-timeout-dc 0 >> "%LOG%" 2>&1',
  // Zum Nachlesen, welcher Schlafzustand das Geraet danach ueberhaupt kennt. Vor dem Neustart
  // steht hier noch der alte Stand -- das ist kein Fehler, sondern der Beweis, dass es einen
  // Neustart braucht.
  'powercfg /a >> "%LOG%" 2>&1',
  'exit /b 0',
  ''
].join('\r\n');

let skriptPfad = null;

function skriptAblegen(verzeichnis) {
  if (skriptPfad && fs.existsSync(skriptPfad)) return skriptPfad;
  const ziel = path.join(verzeichnis || os.tmpdir(), 'wall-standby.cmd');
  fs.writeFileSync(ziel, SKRIPT, 'utf8');
  skriptPfad = ziel;
  return ziel;
}

/**
 * Baut den Aufruf. Ausgelagert, damit er sich ohne Windows pruefen laesst.
 *
 * `-Verb RunAs` ist die Rueckfrage, `-Wait` macht den Rueckgabewert erst bedeutungsvoll: Ohne
 * das kaeme der Aufruf zurueck, bevor jemand den UAC-Dialog beantwortet hat.
 */
function befehl(pfad) {
  // Ein einfaches Anfuehrungszeichen im Pfad wuerde die PowerShell-Zeichenkette aufbrechen.
  // In einem Windows-Benutzerpfad ist das unwahrscheinlich und kostet eine Zeile.
  const sicher = String(pfad).replace(/'/g, "''");
  return 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "'
    + `Start-Process -FilePath '${sicher}' -Verb RunAs -WindowStyle Hidden -Wait`
    + '"';
}

/**
 * Ist Modern Standby abgeschaltet?
 *
 * true  = Wert steht auf 0, die Umstellung ist vorgenommen (wirkt nach dem Neustart)
 * false = Wert fehlt oder ist nicht 0, Modern Standby ist aktiv
 * null  = nicht zu ermitteln (kein Windows, Lesezugriff verweigert)
 */
function lesen() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((fertig) => {
    exec(LESE_BEFEHL, { timeout: 5000 }, (err, stdout) => {
      if (err) {
        // "Der angegebene Wert ist nicht vorhanden" ist KEIN Fehler im eigentlichen Sinn --
        // es ist die Antwort "Modern Standby ist aktiv". Unterschieden wird an der Ausgabe:
        // Kommt der Schluesselname gar nicht vor, hat reg.exe ihn nicht gefunden.
        fertig(/nicht vorhanden|unable to find|cannot find/i.test(String(err.message)) ? false : null);
        return;
      }
      const treffer = /PlatformAoAcOverride\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(stdout));
      if (!treffer) return fertig(false);
      fertig(parseInt(treffer[1], 16) === 0);
    });
  });
}

/**
 * Einmal versuchen, Modern Standby und die Schlaf-Zeitgeber abzuschalten. Erzeugt EINEN
 * UAC-Dialog auf dem Panel.
 *
 * Nur aufrufen, wenn jemand vor dem Geraet steht -- siehe den Kopf dieser Datei.
 */
function abschalten({ store, log, verzeichnis } = {}) {
  // Der Merker zuerst, vor der Plattformpruefung: "schon gefragt" gilt unabhaengig davon, auf
  // welchem System das laeuft -- und nur so ist der Riegel ohne Windows pruefbar.
  if (store && Number(store.get(MERKER)) >= VERSUCH_STAND) {
    return Promise.resolve({ ok: false, grund: 'bereits versucht' });
  }
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, grund: 'nur unter Windows' });
  // Der Merker wird VOR dem Versuch gesetzt. Absicht: Bricht der Aufruf ab oder lehnt jemand
  // den Dialog ab, soll beim naechsten Antippen nicht wieder ein Dialog aufspringen. Einmal
  // fragen ist Hilfe, bei jeder Wartung fragen ist Noetigung.
  if (store) store.set(MERKER, VERSUCH_STAND);
  if (log) log('info', 'Modern Standby und die Schlaf-Zeitgeber werden abgeschaltet -- dafuer '
    + 'kommt einmal die Rueckfrage von Windows.');

  let pfad, logPfad;
  try {
    pfad = skriptAblegen(verzeichnis);
    logPfad = path.join(path.dirname(pfad), LOG_NAME);
  } catch (e) {
    if (log) log('warn', `Standby-Skript konnte nicht abgelegt werden: ${e.message}`);
    return Promise.resolve({ ok: false, grund: e.message });
  }

  return new Promise((fertig) => {
    exec(befehl(pfad), { timeout: 120000 }, async (err, stdout, stderr) => {
      // Die Ausgabe des elevierten Prozesses erreicht uns nur ueber diese Datei. Ohne sie
      // waere ein fehlgeschlagener powercfg-Aufruf unsichtbar.
      let ausgabe = '';
      try { ausgabe = fs.readFileSync(logPfad, 'utf8').trim(); } catch (e) { /* nichts da */ }
      if (ausgabe && log) {
        for (const zeile of ausgabe.split(/\r?\n/).filter(z => z.trim())) {
          log('info', `Standby-Umstellung: ${zeile.trim()}`);
        }
      }
      if (err) {
        const grund = String(stderr || err.message || '').trim().split('\n')[0];
        if (log) log('warn', `Umstellung fehlgeschlagen: ${grund}`);
        return fertig({ ok: false, grund });
      }
      // Nicht dem Rueckgabewert glauben, sondern nachlesen: Ein abgelehnter UAC-Dialog endet
      // ohne Fehlermeldung, und "kein Fehler" hiesse hier sonst faelschlich "erledigt".
      const aus = await lesen();
      if (log) {
        log(aus ? 'info' : 'warn', aus
          ? 'Modern Standby ist abgeschaltet und die Schlaf-Zeitgeber stehen auf "nie" -- '
            + 'wirksam nach dem naechsten Neustart des Geraets.'
          : 'Modern Standby ist weiterhin aktiv (Rueckfrage abgelehnt oder ohne Wirkung).');
      }
      fertig({ ok: aus === true, grund: aus ? null : 'Wert nicht gesetzt' });
    });
  });
}

module.exports = { lesen, abschalten, befehl, skriptAblegen, LESE_BEFEHL, SKRIPT, SCHLUESSEL, WERT, MERKER, LOG_NAME };
