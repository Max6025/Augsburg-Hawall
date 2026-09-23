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

const SCHLUESSEL = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power';
const WERT = 'PlatformAoAcOverride';
const MERKER = 'aoacVersuchtStand';
const VERSUCH_STAND = 1;

// Lesen geht unelevert: HKLM ist fuer Benutzer lesbar. `powercfg /a` waere die genauere Antwort
// -- welcher Schlafzustand wirklich verfuegbar ist -- verlangt aber erhoehte Rechte und faellt
// damit aus. Der Registrierungswert sagt immerhin, ob die Umstellung vorgenommen wurde.
const LESE_BEFEHL = `reg query "${SCHLUESSEL}" /v ${WERT}`;

// Der elevierte Schreibzugriff, als EINZEILIGER PowerShell-Befehl. Kein Here-String, aus
// demselben Grund wie in control/panel.js. `-Wait`, damit der Rueckgabewert etwas bedeutet:
// Ohne das kaeme der Aufruf zurueck, bevor der Benutzer den UAC-Dialog beantwortet hat.
const SCHREIB_BEFEHL = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "'
  + 'Start-Process -FilePath reg.exe -ArgumentList '
  + ["add", SCHLUESSEL, "/v", WERT, "/t", "REG_DWORD", "/d", "0", "/f"].map(a => `'${a}'`).join(',')
  + ' -Verb RunAs -WindowStyle Hidden -Wait"';

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
 * Einmal versuchen, Modern Standby abzuschalten. Erzeugt EINEN UAC-Dialog auf dem Panel.
 *
 * Nur aufrufen, wenn jemand vor dem Geraet steht -- siehe den Kopf dieser Datei.
 */
function abschalten({ store, log } = {}) {
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
  if (log) log('info', 'Modern Standby wird abgeschaltet -- dafuer kommt einmal die Rueckfrage von Windows.');
  return new Promise((fertig) => {
    exec(SCHREIB_BEFEHL, { timeout: 120000 }, async (err, stdout, stderr) => {
      if (err) {
        const grund = String(stderr || err.message || '').trim().split('\n')[0];
        if (log) log('warn', `Modern Standby konnte nicht abgeschaltet werden: ${grund}`);
        return fertig({ ok: false, grund });
      }
      // Nicht dem Rueckgabewert glauben, sondern nachlesen: Ein abgelehnter UAC-Dialog endet
      // ohne Fehlermeldung, und "kein Fehler" hiesse hier sonst faelschlich "erledigt".
      const aus = await lesen();
      if (log) {
        log(aus ? 'info' : 'warn', aus
          ? 'Modern Standby ist abgeschaltet -- wirksam nach dem naechsten Neustart des Geraets.'
          : 'Modern Standby ist weiterhin aktiv (Rueckfrage abgelehnt oder ohne Wirkung).');
      }
      fertig({ ok: aus === true, grund: aus ? null : 'Wert nicht gesetzt' });
    });
  });
}

module.exports = { lesen, abschalten, LESE_BEFEHL, SCHREIB_BEFEHL, SCHLUESSEL, WERT, MERKER };
