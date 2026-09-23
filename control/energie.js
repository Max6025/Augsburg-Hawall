// Die Schlaf-Zeitgeber des Energieschemas auf "nie" setzen.
//
// DAS IST DIE GANZE LOESUNG. Sie ist klein, und der Weg hierher war lang genug, dass die
// Sackgassen hier stehen muessen -- sonst geht jemand sie noch einmal.
//
// --- Was wirklich passiert ist, gemessen am 2026-09-23 auf dem Surface Go ---------------------
//
// Sobald die Nachtsperre das Panel abschaltete, war der Setup-Server in derselben Sekunde weg.
// Das Windows-Protokoll zeigte Kernel-Power 506 (Standby-Beginn) auf die Sekunde genau zu den
// Zeitpunkten, an denen das App-Protokoll "Panel wird ausgeschaltet" schrieb: 07:09:56 und
// 07:24:56. Das Abschalten des Bildschirms machte das Geraet leerlaufend, und die Schlaffrist
// des Energieschemas griff sofort.
//
// Nach `powercfg /change standby-timeout-* 0` lag das Panel fuenf Minuten dunkel, davon vier
// Minuten ohne ein einziges Netzwerkpaket von aussen -- und danach antworteten Webserver UND
// SSH. Im Windows-Protokoll steht fuer diesen Zeitraum KEIN einziges Standby-Ereignis. Das
// Geraet hat nicht "ueberlebt", es ist gar nicht schlafen gegangen.
//
// --- Zwei Sackgassen, die vorher als Loesung verkauft wurden ----------------------------------
//
// 1. `ES_SYSTEM_REQUIRED` (control/panel.js, `setSystemWach`). Die Anforderung wird gestellt,
//    `powercfg /requests` zeigt sie unter SYSTEM -- und das Geraet schlief trotzdem. Sie
//    verhindert den expliziten und den leerlaufbedingten Schlaf, aber nicht den Uebergang, den
//    das Abschalten des Bildschirms ausloest. Der Aufruf bleibt drin, er kostet nichts und
//    schuetzt gegen den Leerlauf-Fall; als Erklaerung fuer die Erreichbarkeit ist er falsch.
//
// 2. `PlatformAoAcOverride = 0`, um Modern Standby abzuschalten. Auf diesem Geraet WIRKUNGSLOS,
//    und zwar messbar: Wert gesetzt, Geraet neu gestartet, `powercfg /a` meldete Modern Standby
//    unveraendert als verfuegbar. Microsoft hat die Wirkung dieses Werts in den neueren
//    Windows-11-Builds entfernt (gemessen auf 25H2, Build 26200). Dazu kennt die Firmware des
//    Surface Go kein S3 -- ein anderer Schlafzustand waere also ohnehin nicht dagewesen. Diese
//    Sackgasse hat zwei Versionen (1.0.8, 1.0.9) und einen UAC-Dialog gekostet, der nichts
//    bewirkt haette. Nicht wieder einbauen.
//
// --- Warum das hier ohne erhoehte Rechte laeuft -----------------------------------------------
//
// `powercfg /change` aendert das AKTIVE Schema des aufrufenden Benutzers und braucht dafuer
// KEINE erhoehten Rechte. Nachgemessen, nicht angenommen: eine geplante Aufgabe mit
// `/rl limited` setzte den Wert von 0x12c (fuenf Minuten) auf 0x0. Damit entfallen der
// UAC-Dialog, der NSIS-Einschub und die ganze Einmal-Frage-Mechanik.
//
// Gesetzt wird bei jedem Start, nicht einmalig mit Merker: Ein Windows-Update oder ein
// Zuruecksetzen des Energieschemas stellt die Fristen wieder her, und ein Merker wuerde genau
// dann luegen. Sechs Aufrufe beim Start kosten nichts.

const { exec } = require('child_process');

// Standby und Ruhezustand jeweils fuer Netz und Akku -- beide Fristen wuerden den Server
// beenden. Der Bildschirm gehoert dazu, weil in diesem Projekt `decide()` ueber das Panel
// entscheidet und nicht Windows: Bisher hat panel.js jede Minute gegen den Windows-Zeitgeber
// angeschaltet, und das ist ein Wettlauf, kein Entwurf.
const ZEITGEBER = [
  ['standby-timeout-ac', 'Standby am Netz'],
  ['standby-timeout-dc', 'Standby am Akku'],
  ['hibernate-timeout-ac', 'Ruhezustand am Netz'],
  ['hibernate-timeout-dc', 'Ruhezustand am Akku'],
  ['monitor-timeout-ac', 'Bildschirm am Netz'],
  ['monitor-timeout-dc', 'Bildschirm am Akku']
];

function befehl(name) {
  return `powercfg /change ${name} 0`;
}

const LESE_BEFEHL = 'powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE';

/**
 * Die beiden Indizes (Netz, Akku) aus der Ausgabe von `powercfg /query` ziehen.
 *
 * AUSDRUECKLICH OHNE die Beschriftungen zu lesen. Die sind uebersetzt ("Index der aktuellen
 * Wechselstromeinstellung"), und genau daran ist die Modern-Standby-Erkennung heute schon
 * einmal gescheitert: Sie verglich eine deutsche Fehlermeldung mit einem englischen Wortlaut
 * und lieferte "unbekannt" statt "nicht gesetzt".
 *
 * Die Ausgabe enthaelt fuenf Hexwerte in fester Reihenfolge -- Mindestwert, Hoechstwert,
 * Schrittweite, dann Netz und Akku. Die letzten beiden sind die, um die es geht, und diese
 * Reihenfolge ist von der Sprache unabhaengig.
 */
function werteAus(ausgabe) {
  const alle = String(ausgabe || '').match(/0x[0-9a-f]{8}/gi) || [];
  if (alle.length < 2) return null;
  const [ac, dc] = alle.slice(-2).map(h => parseInt(h, 16));
  if (!Number.isFinite(ac) || !Number.isFinite(dc)) return null;
  return { ac, dc };
}

/**
 * Die Standby-Fristen ablesen. Sekunden; 0 heisst "nie". null heisst "nicht zu ermitteln" --
 * und ausdruecklich nicht "in Ordnung".
 */
function lesen() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((fertig) => {
    exec(LESE_BEFEHL, { timeout: 8000 }, (err, stdout) => {
      if (err) return fertig(null);
      fertig(werteAus(stdout));
    });
  });
}

/**
 * Alle Fristen auf "nie" setzen und danach nachlesen.
 *
 * Nachgelesen wird immer: Ein `powercfg`, das ohne Fehler zurueckkommt, ist kein Beweis, dass
 * der Wert steht -- und ein stiller Fehlschlag ist in diesem Projekt schon dreimal teuer
 * geworden.
 */
function setzen({ log } = {}) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, grund: 'nur unter Windows', werte: null });
  }
  const einzeln = ([name, klar]) => new Promise((fertig) => {
    exec(befehl(name), { timeout: 8000 }, (err, stdout, stderr) => {
      if (!err) return fertig({ klar, ok: true });
      const grund = String(stderr || stdout || err.message || '').trim().split('\n')[0];
      fertig({ klar, ok: false, grund });
    });
  });

  return Promise.all(ZEITGEBER.map(einzeln)).then(async (ergebnisse) => {
    const kaputt = ergebnisse.filter(e => !e.ok);
    if (log) {
      kaputt.forEach(e => log('warn', `Zeitgeber "${e.klar}" konnte nicht auf "nie" gesetzt `
        + `werden: ${e.grund}`));
    }
    const werte = await lesen();
    const ok = !!werte && werte.ac === 0 && werte.dc === 0;
    if (log) {
      log(ok ? 'info' : 'warn', ok
        ? 'Schlaf-Zeitgeber stehen auf "nie" -- das Geraet schlaeft nicht ein, wenn die '
          + 'Nachtsperre das Panel abschaltet.'
        : 'Schlaf-Zeitgeber stehen NICHT auf "nie". Sobald die Nachtsperre das Panel '
          + 'abschaltet, schlaeft das Geraet ein und die Weboberflaeche ist weg.');
    }
    return { ok, werte, fehlgeschlagen: kaputt.map(e => e.klar) };
  });
}

module.exports = { setzen, lesen, werteAus, befehl, ZEITGEBER, LESE_BEFEHL };
