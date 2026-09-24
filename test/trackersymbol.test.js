'use strict';

// Das eigene Symbol für den Tracker-Marker.
//
// SVG ist hier die bessere Wahl, und der Grund ist nicht Geschmack: Das Symbol steht auf einer
// Landkarte, die man zoomt. Ein auf 120 Pixel gerechnetes PNG ist bei Zoomstufe 19 ein
// Pixelbrei; eine SVG bleibt scharf.
//
// Geprueft wird der Quelltext: tracker-editor.js ist ein Renderer-Skript ohne Modulausgang.
// Was sich pruefen laesst, sind die Eigenschaften, an denen es haengt.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WURZEL = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(WURZEL, 'renderer', 'setup', 'tracker-editor.js'), 'utf8');
const HTML = fs.readFileSync(path.join(WURZEL, 'renderer', 'setup', 'tracker-editor.html'), 'utf8');
const DASH = fs.readFileSync(path.join(WURZEL, 'renderer', 'dashboard.html'), 'utf8');

test('die Dateiauswahl laesst SVG ueberhaupt zu', () => {
  const m = /id="iconFileInput"[^>]*accept="([^"]+)"/.exec(HTML);
  assert.ok(m, 'das Feld oder sein accept fehlt');
  assert.match(m[1], /image\/svg\+xml/, 'der Medientyp fehlt');
  assert.match(m[1], /\.svg/, 'die Endung fehlt -- manche Systeme melden den Typ nicht');
});

test('eine SVG geht NICHT durch das Canvas', () => {
  // Der ganze Punkt. resizeImageFile() zeichnet auf ein Canvas und gibt ein PNG zurueck --
  // damit waere die SVG rasterisiert, und zwar auf 120 Pixel. Zweiter Grund: Eine SVG ohne
  // width/height rendert auf einem Canvas in manchen Browsern als 0x0, und dann kommt ein
  // LEERES Bild heraus, ohne Fehlermeldung.
  assert.match(JS, /istSvg\(file\) \? await svgLesen\(file\) : await resizeImageFile\(/,
    'die Weiche fehlt');
  const i = JS.indexOf('function svgLesen');
  const block = JS.slice(i, JS.indexOf('\n}', JS.indexOf('readAsText', i)));
  assert.ok(!/canvas|drawImage|toDataURL/.test(block),
    'in svgLesen darf kein Canvas vorkommen');
});

test('erkannt wird an Medientyp UND Endung', () => {
  // Nicht jedes System meldet für .svg den Typ image/svg+xml -- unter Windows haengt das an
  // der Registry. Wer nur auf den Typ prueft, bekommt die Datei durch das Canvas.
  const i = JS.indexOf('function istSvg');
  const block = JS.slice(i, JS.indexOf('\n}', i));
  assert.match(block, /image\/svg\+xml/);
  assert.match(block, /\\.svg\$\/i/);
});

test('was keine SVG ist, wird abgelehnt statt gespeichert', () => {
  const i = JS.indexOf('function svgLesen');
  const block = JS.slice(i, i + 2200);
  assert.match(block, /<svg\[\\s>\]/, 'es muss ein <svg>-Element geben');
  assert.match(block, /viewBox=/, 'ohne viewBox und ohne width laesst sich nichts skalieren');
});

test('es gibt eine Obergrenze, und sie steht als Zahl da', () => {
  // Das Symbol liegt als Data-URL in config.json, und die wird bei jedem Start gelesen.
  assert.match(JS, /const SVG_MAX = \d+ \* 1024;/, 'die Grenze fehlt');
  const grenze = Number(/const SVG_MAX = (\d+) \* 1024;/.exec(JS)[1]);
  assert.ok(grenze >= 16 && grenze <= 256, `${grenze} kB ist keine sinnvolle Grenze`);
  assert.match(JS, /url\.length > SVG_MAX/, 'sie wird nicht geprueft');
});

test('ein Fehler wird GESAGT, nicht verschluckt', () => {
  // Ein Symbol, das stillschweigend nicht uebernommen wird, laesst einen die Datei suchen.
  assert.match(JS, /iconMeldung\(String\(e\.message \|\| e\)\)/, 'der Fehler muss angezeigt werden');
  assert.match(HTML, /id="iconInfo"/, 'die Stelle dafuer fehlt in der Seite');
});

test('die Data-URL landet nur in einem img, nie in innerHTML', () => {
  // In einem `<img>` fuehrt der Browser keine Skripte aus einer SVG aus. Eingebettet als
  // innerHTML waere es etwas anderes -- deshalb darf diese Data-URL nirgends dorthin.
  assert.match(JS, /\$\('iconPreview'\)\.src = iconDataUrl;/, 'die Vorschau muss ein img sein');
  assert.ok(!/innerHTML\s*=\s*iconDataUrl/.test(JS), 'nie als innerHTML');
  // Und auf der Landkarte: Leaflet macht aus iconUrl ein <img>.
  assert.match(DASH, /L\.icon\(\{ iconUrl: dash\.trackerIconDataUrl/, 'der Weg auf die Karte');
  assert.ok(!/innerHTML[^\n]*trackerIconDataUrl/.test(DASH));
});

test('die Vorschau schneidet eine SVG nicht ab', () => {
  // Eine SVG ist meist nicht quadratisch, und `cover` schneidet dann genau das weg, was man
  // sehen will.
  assert.match(JS, /objectFit = iconDataUrl\.startsWith\('data:image\/svg'\) \? 'contain' : 'cover'/);
});

test('die Seite sagt, dass SVG die bessere Wahl ist', () => {
  // Eine Moeglichkeit, von der niemand weiss, ist fuer die meisten keine.
  assert.match(HTML, /SVG wird unterstützt/);
  assert.match(HTML, /120 Pixel/, 'und dass die anderen Formate verkleinert werden');
});
