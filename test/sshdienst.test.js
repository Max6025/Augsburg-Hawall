'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ssh = require('../control/sshdienst.js');
const { pruefungen } = require('../server/systemstatus.js');

// Wortwoertlich von `sc.exe` auf deutschem Windows 11 25H2, am 2026-09-23 abgenommen. Die
// Beschriftungen sind uebersetzt, die WERTE nicht -- genau darauf beruht dieses Modul.
const QUERY_LAEUFT = `
SERVICE_NAME: sshd
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
                                (STOPPABLE, NOT_PAUSABLE, IGNORES_SHUTDOWN)
        WIN32_EXIT_CODE    : 0  (0x0)`;
const QUERY_GESTOPPT = QUERY_LAEUFT.replace('4  RUNNING', '1  STOPPED');
const QUERY_FEHLT = '[SC] EnumQueryServicesStatus:OpenService FEHLER 1060:\n\nDer angegebene Dienst ist kein installierter Dienst.';
const QC_AUTO = `
SERVICE_NAME: sshd
        START_TYPE         : 2   AUTO_START
        BINARY_PATH_NAME   : "C:\\WINDOWS\\System32\\OpenSSH\\sshd.exe"`;
const QC_MANUELL = QC_AUTO.replace('2   AUTO_START', '3   DEMAND_START');
const QF_MIT = `
SERVICE_NAME: sshd
        RESET_PERIOD (in Sekunden)   : 86400
        FAILURE_ACTIONS              : RESTART -- Verz\u00f6gerung = 5000 Millisek.
                                       RESTART -- Verz\u00f6gerung = 20000 Millisek.`;
const QF_OHNE = `
SERVICE_NAME: sshd
        RESET_PERIOD (in Sekunden)   : 0
        REBOOT_MESSAGE               :
        COMMAND_LINE                 :`;

const gut = { queryCode: 0, query: QUERY_LAEUFT, qc: QC_AUTO, qfailure: QF_MIT };

test('der Normalfall wird erkannt', () => {
  assert.deepStrictEqual(ssh.auswerten(gut),
    { vorhanden: true, laeuft: true, startAutomatisch: true, wiederherstellung: true, grund: '' });
});

test('Code 1060 heisst: gibt es nicht', () => {
  // Sprachunabhaengig. Auf die uebersetzte Meldung zu hoeren ist der Fehler, der
  // modernstandby.js zwei Releases gekostet hat ("nicht vorhanden" vs. "nicht gefunden").
  const r = ssh.auswerten({ queryCode: 1060, query: QUERY_FEHLT });
  assert.strictEqual(r.vorhanden, false);
  assert.strictEqual(r.laeuft, false);
  assert.match(r.grund, /nicht installiert/);
});

test('gelesen werden die ZAHLEN, nicht die Woerter', () => {
  // Gegenprobe: Die englischen Marken werden durch Phantasie ersetzt, die Zahlen bleiben.
  // Wenn das Modul weiter richtig antwortet, haengt es wirklich an den Zahlen.
  const verfremdet = {
    queryCode: 0,
    query: QUERY_LAEUFT.replace('RUNNING', 'WIRDGERADEAUSGEFUEHRT'),
    qc: QC_AUTO.replace('AUTO_START', 'AUTOMATISCH'),
    qfailure: QF_MIT
  };
  const r = ssh.auswerten(verfremdet);
  assert.strictEqual(r.laeuft, true);
  assert.strictEqual(r.startAutomatisch, true);
});

test('gestoppt ist nicht dasselbe wie nicht vorhanden', () => {
  const r = ssh.auswerten({ ...gut, query: QUERY_GESTOPPT });
  assert.strictEqual(r.vorhanden, true);
  assert.strictEqual(r.laeuft, false);
});

test('manueller Start faellt auf', () => {
  // Ein Dienst auf "manuell" laeuft bis zum naechsten Neustart und ist danach weg -- ein
  // Ausfall mit Verzoegerung, und genau der, den man nicht kommen sieht.
  assert.strictEqual(ssh.auswerten({ ...gut, qc: QC_MANUELL }).startAutomatisch, false);
});

test('fehlende Wiederherstellung faellt auf', () => {
  // Am Geraet gemessen: RESET_PERIOD 0, keine Aktionen. Der Dienst lief -- und waere er
  // abgestuerzt, haette ihn niemand neu gestartet.
  assert.strictEqual(ssh.auswerten({ ...gut, qfailure: QF_OHNE }).wiederherstellung, false);
});

test('eine unverwertbare Antwort ist "unbekannt", nicht "laeuft nicht"', () => {
  // Ein Urteil ohne Grundlage ist schlimmer als ein ehrliches "weiss nicht" -- dieselbe Lehre
  // wie beim stillen `false` von setSystemWach().
  const r = ssh.auswerten({ queryCode: 0, query: 'irgendein Muell' });
  assert.strictEqual(r.vorhanden, null);
  assert.strictEqual(r.laeuft, null);
});

test('lesen() fragt alle drei Auskuenfte ab', async () => {
  const gefragt = [];
  const r = await ssh.lesen(async (befehl) => {
    gefragt.push(befehl);
    if (befehl.includes('qfailure')) return { code: 0, text: QF_MIT };
    if (befehl.includes('qc')) return { code: 0, text: QC_AUTO };
    return { code: 0, text: QUERY_LAEUFT };
  });
  assert.deepStrictEqual(gefragt, ['sc query sshd', 'sc qc sshd', 'sc qfailure sshd']);
  assert.strictEqual(r.wiederherstellung, true);
});

// --- Was die Statusseite daraus macht -------------------------------------------------------

test('SSH ist nie ein FEHLER -- auch wenn der Dienst fehlt', () => {
  // Das Panel funktioniert ohne SSH vollstaendig. Ein 503 wuerde die Ueberwachung nachts Alarm
  // schlagen lassen fuer etwas, das niemandem auffaellt.
  for (const ssh_zustand of [
    { vorhanden: false, laeuft: false, grund: 'x' },
    { vorhanden: true, laeuft: false, startAutomatisch: true, wiederherstellung: true },
    { vorhanden: true, laeuft: true, startAutomatisch: false, wiederherstellung: true }
  ]) {
    const e = pruefungen({ ssh: ssh_zustand }).pruefungen.find(x => x.schluessel === 'ssh');
    assert.strictEqual(e.stufe, 'hinweis', JSON.stringify(ssh_zustand));
  }
});

test('ohne Angabe gibt es die Zeile gar nicht', () => {
  // Auf einem Linux-Entwicklungsrechner ist "SSH-Dienst: unbekannt" keine Auskunft, sondern
  // eine Zeile, die man jedes Mal ueberliest.
  assert.ok(!pruefungen({}).pruefungen.some(x => x.schluessel === 'ssh'));
});

test('der abgesicherte Zustand ist ok und sagt auch, warum', () => {
  const e = pruefungen({ ssh: { vorhanden: true, laeuft: true, startAutomatisch: true, wiederherstellung: true } })
    .pruefungen.find(x => x.schluessel === 'ssh');
  assert.strictEqual(e.stufe, 'ok');
  assert.match(e.erklaerung, /Absturz/, 'die Absicherung ist der Punkt, nicht nur "laeuft"');
});

// --- Die Verbindung ------------------------------------------------------------------------

test('main.js reicht den SSH-Zustand und den Neustart herein', () => {
  const q = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(/require\(['"]\.\/control\/sshdienst/.test(q), 'Modul wird geladen');
  assert.ok(/sshLesen:/.test(q), 'und an den Server gegeben');
  assert.ok(/geraetNeustarten:/.test(q), 'der Neustart ebenfalls');
  assert.ok(/shutdown \/r \/t \d/.test(q), 'und er startet wirklich neu');
});

test('das Reparaturskript setzt die Wiederherstellung -- und laeuft dafuer immer', () => {
  const q = fs.readFileSync(path.join(__dirname, '..', 'werkzeuge', 'ssh-dienst-reparieren.ps1'), 'utf8');
  assert.ok(/sc\.exe failure sshd/.test(q), 'die Aktionen werden gesetzt');
  assert.ok(/sc\.exe failureflag sshd 1/.test(q),
    'ohne das greift die Wiederherstellung nur bei einem Absturz, nicht bei einem Fehler-Ende');
  // Der Aufruf muss AUSSERHALB von DienstEinrichten stehen: Die Schritte 1-7 werden
  // uebersprungen, sobald sshd laeuft ("Nur anfassen, was nicht laeuft"), und wer nur einen
  // laufenden Dienst hat, braucht die Absicherung am dringendsten.
  // `\r?` ist nicht Kosmetik: Die Datei hat CRLF, weil PowerShell 5.1 das braucht -- und ein
  // Muster ohne \r schlaegt hier fehl, ohne dass am Skript etwas falsch ist.
  assert.ok(/^GegenAusfallAbsichern\s*$/m.test(q), 'die Absicherung wird immer aufgerufen');
  const inEinrichten = q.indexOf('function DienstEinrichten');
  const absichern = q.indexOf('function GegenAusfallAbsichern');
  assert.ok(absichern > inEinrichten, 'und steht in einer eigenen Funktion');
});
