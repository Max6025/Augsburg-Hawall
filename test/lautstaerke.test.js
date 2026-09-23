// Tests fuer das Anheben der Systemlautstaerke.
//
// Der Aufruf selbst laesst sich ohne Windows nicht ausfuehren -- pruefbar ist aber genau das,
// woran er schon zweimal gescheitert ist: die Laenge der Befehlszeile und das Lesen der
// Antwort. Beim ersten Anlauf steckte das PowerShell-Skript als Base64 IM Aufruf; Windows
// brach mit "Die Befehlszeile ist zu lang" ab, und das sah aus wie ein Rechteproblem.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../control/lautstaerke.js');

test('Der Aufruf bleibt weit unter der Laengengrenze von Windows', () => {
  // cmd.exe nimmt 8191 Zeichen. Das Skript gehoert deshalb in eine Datei und nicht in den
  // Aufruf -- Base64 von UTF-16 blaeht es auf das Vierfache.
  const b = L.befehl('C:\\Users\\jemand\\AppData\\Roaming\\Hawall Eurasburg\\wall-lautstaerke.ps1', 60);
  assert.ok(b.length < 500, 'Aufruf ist ' + b.length + ' Zeichen lang');
});

test('Der Pfad wird in Anfuehrungszeichen gesetzt', () => {
  // "Hawall Eurasburg" enthaelt Leerzeichen. Ohne Anfuehrungszeichen sucht PowerShell eine
  // Datei namens "Hawall" und meldet, sie sei nicht da.
  assert.match(L.befehl('C:\\Programme\\Hawall Eurasburg\\x.ps1', 50), /-File "C:\\Programme\\Hawall Eurasburg\\x\.ps1"/);
});

test('Die Ausfuehrungsrichtlinie wird umgangen', () => {
  // Eine frisch geschriebene .ps1 startet sonst je nach Richtlinie gar nicht -- mit einer
  // Meldung, die nach fehlenden Rechten aussieht.
  assert.match(L.befehl('x.ps1', 50), /-ExecutionPolicy Bypass/);
});

test('Unsinnige Zielwerte werden auf 0 bis 100 begrenzt', () => {
  assert.match(L.befehl('x.ps1', 250), /-Ziel 100$/);
  assert.match(L.befehl('x.ps1', -5), /-Ziel 0$/);
  assert.match(L.befehl('x.ps1', 'laut'), /-Ziel 0$/);
  assert.match(L.befehl('x.ps1', 61.6), /-Ziel 62$/);
});

test('Die Antwort wird in ihre drei Teile zerlegt', () => {
  assert.deepStrictEqual(L.antwortLesen('12|laut|60\r\n'), { vorher: 12, warStumm: false, jetzt: 60 });
  assert.deepStrictEqual(L.antwortLesen('0|stumm|35'), { vorher: 0, warStumm: true, jetzt: 35 });
});

test('Eine unvollstaendige oder leere Antwort gilt als Fehlschlag', () => {
  // Sonst stuende spaeter eine erfundene Zahl im Protokoll und niemand wuesste, dass der
  // Aufruf gar nicht durchkam.
  ['', '   ', 'Fehler beim Laden', '60', '60|laut'].forEach(a => {
    assert.strictEqual(L.antwortLesen(a), null, JSON.stringify(a));
  });
});

test('Das Skript deklariert die COM-Methoden vollstaendig', () => {
  // DIE Fehlerquelle dieser Datei: Wer eine Methode auslaesst, ruft die naechste auf. Ein
  // erster Anlauf hatte zwei Platzhalter zu wenig und rief statt SetMute etwas anderes --
  // die Meldung lautete "Der Wert liegt ausserhalb des erwarteten Bereichs".
  const noetig = [
    'RegisterControlChangeNotify', 'UnregisterControlChangeNotify', 'GetChannelCount',
    'SetMasterVolumeLevel(', 'SetMasterVolumeLevelScalar', 'GetMasterVolumeLevel(',
    'GetMasterVolumeLevelScalar', 'SetChannelVolumeLevel(', 'SetChannelVolumeLevelScalar',
    'GetChannelVolumeLevel(', 'GetChannelVolumeLevelScalar', 'SetMute', 'GetMute'
  ];
  noetig.forEach(m => assert.ok(L.SKRIPT.includes(m), 'fehlt: ' + m));
});

test('Das Skript senkt die Lautstaerke nie', () => {
  // Steht das Geraet schon lauter, bleibt es dabei. Wer sein Panel laut haben will, soll das
  // behalten duerfen -- die App warnt, sie regelt nicht.
  assert.match(L.SKRIPT, /if \(ist < ziel\) v\.SetMasterVolumeLevelScalar/);
});

test('Das Skript landet als Datei und wird nicht bei jedem Aufruf neu geschrieben', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-ton-'));
  const p1 = L.skriptAblegen(dir);
  assert.ok(fs.existsSync(p1));
  assert.strictEqual(fs.readFileSync(p1, 'utf8'), L.SKRIPT);
  // Zweiter Aufruf: derselbe Pfad, kein erneutes Schreiben -- bei Stufe 3 kommt alle zwoelf
  // Sekunden ein Ton, und der Inhalt aendert sich nie.
  const vorher = fs.statSync(p1).mtimeMs;
  assert.strictEqual(L.skriptAblegen(dir), p1);
  assert.strictEqual(fs.statSync(p1).mtimeMs, vorher);
  fs.rmSync(dir, { recursive: true, force: true });
});
