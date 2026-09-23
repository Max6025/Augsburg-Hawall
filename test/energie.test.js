// Die Schlaf-Zeitgeber des Energieschemas.
//
// Das ist die Loesung fuer "nachts nicht erreichbar", und sie ist eine Zeile `powercfg` --
// nach zwei Sackgassen, die als Loesung ausgeliefert wurden. Die Geschichte steht im Kopf von
// control/energie.js; hier wird geprueft, was ohne Windows pruefbar ist.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const energie = require('../control/energie');

test('Alle vier Fristen werden gesetzt, Netz und Akku', () => {
  // Eine fehlende Haelfte reicht: Am Akku wuerde das Geraet weiter einschlafen, und der Fehler
  // waere von aussen derselbe.
  const namen = energie.ZEITGEBER.map(([n]) => n);
  for (const pflicht of ['standby-timeout-ac', 'standby-timeout-dc',
    'hibernate-timeout-ac', 'hibernate-timeout-dc']) {
    assert.ok(namen.includes(pflicht), `${pflicht} fehlt`);
  }
  // Der Bildschirm-Zeitgeber gehoert dazu, weil decide() ueber das Panel entscheidet und nicht
  // Windows -- sonst schaltet panel.js jede Minute gegen Windows an.
  assert.ok(namen.includes('monitor-timeout-ac'));
  assert.ok(namen.includes('monitor-timeout-dc'));
});

test('Jeder Befehl setzt auf 0 und steht auf einer Zeile', () => {
  for (const [name] of energie.ZEITGEBER) {
    const b = energie.befehl(name);
    assert.match(b, /^powercfg \/change \S+ 0$/, `unerwartete Form: ${b}`);
    assert.ok(!b.includes('\n'));
  }
});

test('Die Auswertung liest KEINE uebersetzten Beschriftungen', () => {
  // Genau daran ist die Vorgaenger-Erkennung gescheitert: Sie verglich eine deutsche
  // Fehlermeldung mit einem englischen Wortlaut und lieferte "unbekannt" statt "nicht gesetzt".
  // Die fuenf Hexwerte stehen in fester Reihenfolge; die letzten beiden sind Netz und Akku.
  const deutsch = [
    'Mindestmoeglicher Einstellungswert: 0x00000000',
    'Hoechstmoeglicher Einstellungswert: 0xffffffff',
    'Moeglicher Einstellungsschritt: 0x00000001',
    'Index der aktuellen Wechselstromeinstellung: 0x0000012c',
    'Index der aktuellen Gleichstromeinstellung: 0x00000000'
  ].join('\n');
  const englisch = [
    'Possible Settings Minimum: 0x00000000',
    'Possible Settings Maximum: 0xffffffff',
    'Possible Settings Increment: 0x00000001',
    'Current AC Power Setting Index: 0x0000012c',
    'Current DC Power Setting Index: 0x00000000'
  ].join('\n');
  assert.deepStrictEqual(energie.werteAus(deutsch), { ac: 300, dc: 0 });
  assert.deepStrictEqual(energie.werteAus(englisch), { ac: 300, dc: 0 },
    'dieselbe Antwort in jeder Sprache -- sonst ist es wieder geraten');
});

test('Unbrauchbare Ausgabe ergibt null, nicht "in Ordnung"', () => {
  // null heisst "nicht zu ermitteln". Wer das mit "steht auf nie" verwechselt, zeigt auf der
  // Einrichtungsseite eine Gewissheit an, die es nicht gibt.
  assert.strictEqual(energie.werteAus(''), null);
  assert.strictEqual(energie.werteAus('Zugriff verweigert'), null);
  assert.strictEqual(energie.werteAus(null), null);
  assert.strictEqual(energie.werteAus('nur ein Wert: 0x00000000'), null);
});

test('Ohne Windows wird nichts gesetzt und nichts behauptet', async () => {
  if (process.platform === 'win32') return;
  assert.strictEqual(await energie.lesen(), null);
  const r = await energie.setzen();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.werte, null);
});

test('Die Sackgassen sind wirklich draussen', () => {
  // PlatformAoAcOverride war auf dem Geraet messbar wirkungslos (Wert gesetzt, Neustart,
  // powercfg /a unveraendert) und hat zwei Versionen samt UAC-Dialog gekostet. Ein Rueckfall
  // faellt sonst erst am Geraet auf.
  const wurzel = path.join(__dirname, '..');
  assert.ok(!fs.existsSync(path.join(wurzel, 'control', 'modernstandby.js')),
    'modernstandby.js ist wieder da');
  assert.ok(!fs.existsSync(path.join(wurzel, 'build', 'installer.nsh')),
    'der NSIS-Einschub ist wieder da');
  const pkg = JSON.parse(fs.readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.build.nsis.include, undefined, 'der Installer bindet wieder etwas ein');
  for (const datei of ['main.js', 'control/controller.js']) {
    const inhalt = fs.readFileSync(path.join(wurzel, datei), 'utf8');
    assert.ok(!/PlatformAoAcOverride/.test(inhalt), `${datei} nennt PlatformAoAcOverride wieder`);
    assert.ok(!/Verb RunAs/.test(inhalt), `${datei} fragt wieder nach erhoehten Rechten`);
  }
});

test('main.js setzt die Fristen ueberhaupt -- und zieht sie nach einer Luecke nach', () => {
  // Dieselbe Lehre wie 1.0.4: Eine Funktion, die niemand aufruft, ist dasselbe wie eine, die
  // es nicht gibt.
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /require\('\.\/control\/energie'\)/, 'main.js kennt das Modul nicht');
  assert.match(main, /energieSetzen\(\)/, 'gesetzt wird nie');
  assert.match(main, /energieNachziehen:/, 'nach einer Taktluecke passiert nichts');
  assert.match(main, /schlafZeitgeber:/, 'der Zustand erfaehrt die Fristen nicht');
});
