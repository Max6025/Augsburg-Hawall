// Modern Standby abschalten.
//
// Anlass, gemeldet am 2026-09-23 um 00:41: Das Geraet hing (angeblich) am Strom, "Geraet wach
// halten" war angehakt, Nachtsperre aktiv -- und die Einrichtungsseite antwortete nicht mehr.
// Auf einem Modern-Standby-Geraet ist das Abschalten des Bildschirms selbst der Ausloeser fuer
// den Standby; `ES_SYSTEM_REQUIRED` haelt ihn nicht auf.
//
// Geprueft wird hier der Weg zum Rechner, nicht die Logik: die Gestalt der Befehle und der
// Merker, der genau EINE Rueckfrage erlaubt. Der Rest ist nur am Geraet zu messen.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ms = require('../control/modernstandby');

function fakeStore(values = {}) {
  const data = { ...values };
  return { get: (k) => data[k], set: (k, v) => { data[k] = v; }, _data: data };
}

test('Der Lesebefehl fragt genau den Wert ab, um den es geht', () => {
  assert.ok(ms.LESE_BEFEHL.includes('reg query'));
  assert.ok(ms.LESE_BEFEHL.includes('SYSTEM\\CurrentControlSet\\Control\\Power'));
  assert.ok(ms.LESE_BEFEHL.includes('PlatformAoAcOverride'));
  assert.ok(!ms.LESE_BEFEHL.includes('\n'), 'ein Befehl, eine Zeile');
});

test('Der Schreibbefehl fordert erhoehte Rechte an und wartet auf die Antwort', () => {
  // `-Verb RunAs` ist die Rueckfrage. Ohne `-Wait` kaeme der Aufruf zurueck, bevor jemand sie
  // beantwortet hat -- und das Nachlesen danach waere wertlos.
  assert.ok(ms.SCHREIB_BEFEHL.includes('-Verb RunAs'), 'ohne Elevation kein HKLM');
  assert.ok(ms.SCHREIB_BEFEHL.includes('-Wait'), 'sonst ist das Nachlesen ein Ratespiel');
  assert.ok(ms.SCHREIB_BEFEHL.includes('/d','0') || ms.SCHREIB_BEFEHL.includes("'0'"));
  assert.ok(ms.SCHREIB_BEFEHL.includes('REG_DWORD'));
  assert.ok(!ms.SCHREIB_BEFEHL.includes('\n'), 'kein mehrzeiliger Befehl -- siehe panel.js');
  assert.ok(!ms.SCHREIB_BEFEHL.includes("@'"), 'kein Here-String');
});

test('Auf Nicht-Windows wird nichts versucht', async () => {
  if (process.platform === 'win32') return;
  assert.strictEqual(await ms.lesen(), null, 'null heisst "nicht zu ermitteln", nicht "aktiv"');
  const r = await ms.abschalten({ store: fakeStore() });
  assert.strictEqual(r.ok, false);
});

test('Gefragt wird genau einmal, nicht bei jeder Wartung', async () => {
  // Einmal fragen ist Hilfe, bei jeder Wartung fragen ist Noetigung. Der Merker wird VOR dem
  // Versuch gesetzt: Wer die Rueckfrage ablehnt, bekommt keinen zweiten Dialog.
  const store = fakeStore({ [ms.MERKER]: 1 });
  const r = await ms.abschalten({ store });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.grund, 'bereits versucht');
});

test('Nur die Wege VOR ORT loesen die Rueckfrage aus', () => {
  // Der UAC-Dialog erscheint auf dem PANEL. Wer die Wartung vom Handy aus anfordert, hat ihn
  // nicht vor sich und wuerde ihn dort nur stehen lassen -- deshalb haengt er an der Tipp-Geste
  // und an Strg+Alt+W, nicht an /api/panel/wartung.
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'setup-server.js'), 'utf8');
  assert.match(main, /function wartungVorOrt/, 'der Weg vor Ort fehlt');
  assert.match(main, /wartungVorOrt\(\)/, 'Strg+Alt+W nimmt ihn nicht');
  assert.match(main, /'wartung-anfordern'[\s\S]{0,200}wartungVorOrt/, 'die Tipp-Geste nimmt ihn nicht');
  assert.ok(!/modernStandby/.test(server),
    'die Route aus dem Netz darf keine Rueckfrage auf dem Panel ausloesen');
});

test('Der Installer versucht es, fragt aber nie nach', () => {
  // Ein Update laeuft still (electron-updater ruft den Installer mit /S). Ein UAC-Dialog dort
  // waere ein Update, das fuer immer haengt.
  const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
  assert.match(nsh, /PlatformAoAcOverride/);
  assert.match(nsh, /WriteRegDWORD HKLM/, 'der direkte Weg fehlt');
  assert.ok(!/runas/i.test(nsh), 'der Installer darf keine Rueckfrage stellen');
  assert.match(nsh, /customUnInstall/, 'was der Installer aendert, nimmt er zurueck');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.build.nsis.include, 'build/installer.nsh', 'der Einschub ist nicht eingebunden');
  assert.strictEqual(pkg.build.nsis.perMachine, false,
    'perMachine true wuerde jedes stille Update an einem UAC-Dialog haengen lassen');
});
