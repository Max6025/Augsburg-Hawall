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

test('Der Lesebefehl fragt den SCHLUESSEL ab, nicht den Wert', () => {
  // Der teuerste Einzeiler dieser Sitzung. Vorher stand hier `/v PlatformAoAcOverride`: Fehlt
  // der Wert, endet reg.exe mit einem Fehler, und der Code unterschied "Wert fehlt" von
  // "konnte nicht lesen" am WORTLAUT der Meldung -- gesucht nach "nicht vorhanden", auf dem
  // Geraet steht "nicht gefunden". Ergebnis war `null` statt `false`, die Einrichtungsseite
  // sagte zu Modern Standby gar nichts, und die Rueckfrage (die nur bei `false` kommt) ist nie
  // erschienen. Ein eingebauter Ausweg, der ohne eine Fehlermeldung unerreichbar war.
  //
  // Der Schluessel existiert immer. Damit haengt die Antwort an der Ausgabe und nicht an einer
  // uebersetzten Fehlermeldung.
  assert.ok(ms.LESE_BEFEHL.includes('reg query'));
  assert.ok(ms.LESE_BEFEHL.includes('SYSTEM\\CurrentControlSet\\Control\\Power'));
  assert.ok(!ms.LESE_BEFEHL.includes('/v'),
    'mit /v haengt die Antwort an einer uebersetzten Fehlermeldung');
  assert.ok(!ms.LESE_BEFEHL.includes('\n'), 'ein Befehl, eine Zeile');
});

test('Die Erkennung haengt an keiner uebersetzten Meldung', () => {
  // Gegenprobe am Quelltext: Wer hier wieder anfaengt, Fehlertexte zu vergleichen, bekommt
  // denselben Fehler in der naechsten Windows-Sprache zurueck.
  const quelle = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'control', 'modernstandby.js'), 'utf8');
  for (const text of ['nicht vorhanden', 'unable to find', 'cannot find']) {
    const zeilen = quelle.split('\n').filter(z => z.includes(text) && !z.trim().startsWith('//'));
    assert.deepStrictEqual(zeilen, [], `Fehlertext "${text}" wird noch ausgewertet`);
  }
});

test('Der Aufruf fordert erhoehte Rechte an und wartet auf die Antwort', () => {
  // `-Verb RunAs` ist die Rueckfrage. Ohne `-Wait` kaeme der Aufruf zurueck, bevor jemand sie
  // beantwortet hat -- und das Nachlesen danach waere wertlos.
  const b = ms.befehl('C:\\Pfad mit Leerzeichen\\wall-standby.cmd');
  assert.ok(b.includes('-Verb RunAs'), 'ohne Elevation kein HKLM');
  assert.ok(b.includes('-Wait'), 'sonst ist das Nachlesen ein Ratespiel');
  assert.ok(!b.includes('\n'), 'ein Befehl, eine Zeile');
  assert.ok(!b.includes("@'"), 'kein Here-String');
  // Keine verschachtelten Anfuehrungszeichen: Der Pfad steht in EINER einfach bequoteten
  // Zeichenkette, die Umleitung liegt in der Datei. Alles andere kam durch drei Ebenen
  // Maskierung zerlegt an.
  assert.ok(!b.includes('""'), 'doppelte Anfuehrungszeichen zerlegen den Pfad');
  assert.ok(b.includes("'C:\\Pfad mit Leerzeichen\\wall-standby.cmd'"), 'Pfad mit Leerzeichen muss halten');
});

test('Ein einfaches Anfuehrungszeichen im Pfad bricht den Befehl nicht auf', () => {
  const b = ms.befehl("C:\\Max's Panel\\wall-standby.cmd");
  assert.ok(b.includes("Max''s Panel"), 'in PowerShell wird es verdoppelt');
});

test('Das Skript setzt Modern Standby UND die Schlaf-Zeitgeber', () => {
  // Ohne Modern Standby greift der klassische Schlaf-Timer, ab Werk oft dreissig Minuten --
  // dann ist der Webserver aus einem anderen Grund weg, und von aussen sieht es gleich aus.
  assert.ok(ms.SKRIPT.includes('PlatformAoAcOverride'));
  assert.ok(ms.SKRIPT.includes('REG_DWORD'));
  for (const was of ['standby-timeout-ac', 'standby-timeout-dc',
    'hibernate-timeout-ac', 'hibernate-timeout-dc',
    'monitor-timeout-ac', 'monitor-timeout-dc']) {
    assert.ok(ms.SKRIPT.includes(was), `${was} fehlt -- das Geraet schlaeft weiter ein`);
  }
  assert.ok(ms.SKRIPT.includes('powercfg /a'), 'zum Nachlesen, welcher Schlafzustand danach gilt');
});

test('Vor jeder Umleitung steht ein Leerzeichen', () => {
  // Der teuerste cmd-Fallstrick in dieser Datei: Eine Ziffer unmittelbar vor `>` liest cmd als
  // DATEIKENNUNG. `standby-timeout-ac 0>> datei` leitet die Standardeingabe um und verschluckt
  // die 0 -- powercfg bekaeme seinen Wert nie, der Zeitgeber blieb stehen, und zwar ohne
  // Fehlermeldung. Genau die Art Fehlschlag, die dieses Projekt zweimal teuer bezahlt hat.
  //
  // `2>&1` ist dagegen eine echte Kennungs-Umleitung und ausgenommen.
  const zeilen = ms.SKRIPT.split(/\r?\n/);
  for (const zeile of zeilen) {
    const ohneStderr = zeile.replace(/2>&1/g, '');
    assert.ok(!/[0-9]>/.test(ohneStderr),
      `Ziffer direkt vor > -- cmd liest das als Dateikennung: ${zeile}`);
  }
});

test('Das Skript legt sein Protokoll neben sich ab', () => {
  // Der elevierte Prozess ist ein eigener; seine Ausgabe erreicht die App nur ueber diese
  // Datei. Ohne sie waere ein fehlgeschlagener powercfg-Aufruf unsichtbar.
  assert.ok(ms.SKRIPT.includes('%~dp0' + ms.LOG_NAME), 'das Protokoll gehoert neben das Skript');
  assert.ok(ms.SKRIPT.includes('>> "%LOG%" 2>&1'), 'auch die Fehlerausgabe muss hinein');
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
