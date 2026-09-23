'use strict';

// Die Schrift der Uhr-Karte.
//
// Eine mitgelieferte Schriftdatei ist ein Fall, in dem ALLES richtig aussieht und trotzdem
// nichts passiert: Findet der Browser die Datei nicht, nimmt er stillschweigend die naechste
// aus der Liste. Die Uhr sieht dann genauso aus wie vorher, und man sucht den Fehler in der
// Einstellung. Deshalb pruefen diese Tests nicht die Gestaltung, sondern die Kette:
// Editor schreibt -> buildCard setzt die Klasse -> CSS hat eine Regel -> die Datei ist da.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WURZEL = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(WURZEL, 'renderer', 'shared', 'dashboard.css'), 'utf8');
const RENDER = fs.readFileSync(path.join(WURZEL, 'renderer', 'shared', 'dashboard-render.js'), 'utf8');
const EDITOR = fs.readFileSync(path.join(WURZEL, 'renderer', 'setup', 'editor.js'), 'utf8');

test('die Schriftdatei aus dem @font-face gibt es wirklich', () => {
  // DER Test dieser Datei. Ein Pfadfehler faellt sonst nirgends auf -- der Browser nimmt
  // einfach die Ersatzschrift, ohne eine Meldung.
  const m = /@font-face\s*\{[^}]*?url\('([^']+)'\)/.exec(CSS);
  assert.ok(m, 'kein @font-face mit url() im CSS gefunden');
  const datei = path.join(WURZEL, 'renderer', 'shared', m[1]);
  assert.ok(fs.existsSync(datei), `${m[1]} steht im CSS, liegt aber nicht unter renderer/shared/`);
  assert.ok(fs.statSync(datei).size > 10000, 'die Datei ist verdaechtig klein');
});

test('die Lizenz liegt daneben', () => {
  // Apache 2.0 erlaubt das Mitliefern und verlangt dafuer, dass die Lizenz mitreist. Wer die
  // Schrift austauscht und die Lizenz vergisst, merkt es nie -- niemand beschwert sich bei
  // einem Wandpanel.
  const ordner = path.join(WURZEL, 'renderer', 'shared', 'schriften');
  const dateien = fs.readdirSync(ordner);
  const schriften = dateien.filter(d => /\.(ttf|otf|woff2?)$/i.test(d));
  assert.ok(schriften.length > 0, 'keine Schriftdatei gefunden');
  assert.ok(dateien.some(d => /license|lizenz|ofl/i.test(d)), 'keine Lizenzdatei im Ordner');
  assert.ok(dateien.includes('HERKUNFT.md'), 'HERKUNFT.md fehlt -- woher die Schrift kommt');
});

test('font-display ist block, nicht swap', () => {
  // Bei `swap` erscheint die Uhr erst in Segoe UI und springt dann in die Handschrift. Auf
  // einer Wand sieht man genau diesen Sprung, jeden Morgen. Die Datei liegt lokal, der
  // Augenblick ohne Schrift ist kurz.
  const block = /@font-face\s*\{[^}]*\}/.exec(CSS)[0];
  assert.match(block, /font-display:\s*block/);
  assert.ok(!/font-display:\s*swap/.test(block));
});

test('die Klasse aus buildCard hat eine Regel im CSS', () => {
  // Eine Klasse ohne Regel ist genauso tot wie eine Regel ohne Klasse -- die Lehre aus
  // ed-edSymbol.
  assert.match(RENDER, /classList\.add\('uhr-marker'\)/, 'buildCard setzt die Klasse nicht');
  assert.match(CSS, /\.uhr-marker/, 'im CSS gibt es keine Regel dafuer');
  assert.match(CSS, /\.uhr-marker[^{]*\{[^}]*font-family:\s*'Panel Handschrift'/,
    'die Regel muss die Schrift auch setzen');
});

test('die Schrift gilt nur bei clockFont = marker', () => {
  const i = RENDER.indexOf("classList.add('uhr-marker')");
  const davor = RENDER.slice(Math.max(0, i - 200), i);
  assert.match(davor, /settings\.clockFont === 'marker'/,
    'ohne diese Bedingung bekaeme jede Uhr die Handschrift');
});

test('der Editor bietet das Feld an UND speichert es', () => {
  // Eine Einstellung, die nur an einer der beiden Stellen steht, ist ein Feld ohne Wirkung --
  // genau so war gauge.baseColor monatelang tot (siehe CLAUDE.md).
  assert.match(EDITOR, /id="setClockFont"/, 'das Feld fehlt im Editor');
  assert.match(EDITOR, /settings\.clockFont = schrift/, 'es wird nicht gespeichert');
  assert.match(EDITOR, /delete settings\.clockFont/, '"wie überall" muss die Einstellung entfernen');
  // Und es gehoert zu den Uhr-Optionen, nicht in einen anderen Block.
  const i = EDITOR.indexOf('id="setClockFont"');
  const block = EDITOR.slice(EDITOR.lastIndexOf('if (fields.', i), i);
  assert.match(block, /fields\.clockOpts/, 'das Feld haengt am falschen Kartentyp');
});

test('die Schrift wird NICHT aus dem Netz geholt', () => {
  // Eine Uhr, die erst dann richtig aussieht, wenn Google antwortet, ist eine Uhr mit
  // Netzabhaengigkeit -- und beim ersten Start sieht man den Wechsel.
  const block = /@font-face\s*\{[^}]*\}/.exec(CSS)[0];
  assert.ok(!/https?:/.test(block), 'im @font-face darf keine Adresse aus dem Netz stehen');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(CSS), 'kein Google-Fonts-Verweis im CSS');
});

test('die Schrift ist in beiden Proben zu sehen', () => {
  // Was in vorschau.html fehlt, wird nicht angesehen -- und der Streifen unten ist die engste
  // Stelle, an der die Uhr steht.
  for (const [datei, muster] of [
    ['.scratch/karten-design/vorschau.html', /clockFont: 'marker'/],
    ['.scratch/karten-design/unterleiste-probe.html', /clockFont: 'marker'/]
  ]) {
    const q = fs.readFileSync(path.join(WURZEL, datei), 'utf8');
    assert.match(q, muster, `${datei} zeigt die Handschrift nicht`);
  }
});

test('electron-builder nimmt den Schriftordner mit', () => {
  // Ohne das fehlt die Datei im Installer, und zwar NUR dort: Beim Entwickeln laeuft alles.
  const pkg = JSON.parse(fs.readFileSync(path.join(WURZEL, 'package.json'), 'utf8'));
  const files = (pkg.build && pkg.build.files) || [];
  assert.ok(files.some(f => f === 'renderer/**/*'),
    'renderer/**/* muss in build.files stehen, sonst reist die Schrift nicht mit');
});
