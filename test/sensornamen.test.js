'use strict';

// Die Uebersetzungstabelle fuer englische Sensornamen.
//
// Die Vorgabe war ausdruecklich "richtiges Deutsch, kein Google-Translater-Deutsch". Das ist
// keine Geschmacksfrage, sondern pruefbar: Es gibt fuer diese Groessen feststehende deutsche
// FACHBEGRIFFE, und die Wort-fuer-Wort-Uebersetzung ist bei mehreren davon eine andere.
// Dieser Test haelt genau die Faelle fest, in denen sich beides unterscheidet -- sonst
// rutscht beim naechsten Ergaenzen der Tabelle die naheliegende Variante hinein.

const test = require('node:test');
const assert = require('node:assert');
const { sensornameDeutsch: de, SENSORNAMEN } = require('../renderer/shared/dashboard-render.js');

test('Fachbegriff statt Wort-fuer-Wort', () => {
  const faelle = [
    ['Solar Radiation', 'Globalstrahlung', 'Sonnenstrahlung'],
    ['Rain Rate', 'Regenintensität', 'Regenrate'],
    ['Solar Illuminance', 'Beleuchtungsstärke', 'Sonnenbeleuchtung'],
    ['Dewpoint Temperature', 'Taupunkt', 'Tautemperatur'],
    ['Wind Gust', 'Böe', 'Windstoß'],
    ['Vapor Pressure Deficit', 'Dampfdruckdefizit', 'Dampfdruckmangel'],
    ['Current', 'Stromstärke', 'Strom']
  ];
  for (const [en, richtig, wortwoertlich] of faelle) {
    assert.strictEqual(de(en), richtig, `${en}`);
    assert.notStrictEqual(de(en), wortwoertlich);
  }
});

test('die Namen aus der Wetterstation am Geraet', () => {
  // Wortwoertlich die Liste, die Home Assistant fuer die WH90 zeigt (2026-09-23 abgenommen).
  const erwartet = {
    '24-Hour Rain': 'Regen (24 Stunden)',
    'Daily Rain': 'Regen (heute)',
    'Dewpoint Temperature': 'Taupunkt',
    'Hourly Rain': 'Regen (letzte Stunde)',
    'Max Daily Gust': 'Stärkste Böe (heute)',
    'Monthly Rain': 'Regen (dieser Monat)',
    'Outdoor Humidity': 'Luftfeuchte (außen)',
    'Outdoor Temperature': 'Außentemperatur',
    'Rain Event': 'Regen (laufender Schauer)',
    'Rain Rate': 'Regenintensität',
    'Solar Illuminance': 'Beleuchtungsstärke',
    'Solar Radiation': 'Globalstrahlung',
    'Srain Piezo': 'Regen (Piezo)',
    'UV Index': 'UV-Index',
    'Vapor Pressure Deficit': 'Dampfdruckdefizit',
    'Weekly Rain': 'Regen (diese Woche)',
    'Wind Direction': 'Windrichtung',
    'Wind Direction Avg': 'Windrichtung (Mittel)',
    'Wind Gust': 'Böe',
    'Wind Speed': 'Windgeschwindigkeit',
    'Yearly Rain': 'Regen (dieses Jahr)',
    'Indoor Humidity': 'Luftfeuchte (innen)',
    'Indoor Temperature': 'Innentemperatur',
    'Relative Pressure': 'Luftdruck (relativ)',
    'Absolute Pressure': 'Luftdruck (absolut)'
  };
  for (const [en, soll] of Object.entries(erwartet)) {
    assert.strictEqual(de(en), soll, `"${en}" muss "${soll}" werden`);
  }
});

test('NUR der ganze Name wird ersetzt, nie ein Teil', () => {
  // Halb uebersetzt ist schlimmer als gar nicht: "Garage Tür Sensor" sieht aus wie ein Fehler,
  // "Garage Door Sensor" sieht aus wie Englisch.
  for (const unberuehrt of ['Garage Door Sensor', 'Power Plug Wohnzimmer', 'Rain Rate Garten',
    'Alte Temperature', 'Küchenlicht', 'sensor.irgendwas']) {
    assert.strictEqual(de(unberuehrt), unberuehrt, unberuehrt);
  }
});

test('Modellkuerzel davor werden abgestreift', () => {
  assert.strictEqual(de('WH90 Capacitor Voltage'), 'Kondensatorspannung');
  assert.strictEqual(de('WS2900 Indoor Humidity'), 'Luftfeuchte (innen)');
  assert.strictEqual(de('GW2000A Relative Pressure'), 'Luftdruck (relativ)');
  // Aber kein beliebiges Wort davor -- sonst ist es wieder eine Teil-Ersetzung.
  assert.strictEqual(de('Keller Capacitor Voltage'), 'Keller Capacitor Voltage');
});

test('Gross- und Kleinschreibung und Leerraum sind egal', () => {
  assert.strictEqual(de('  wind   speed  '), 'Windgeschwindigkeit');
  assert.strictEqual(de('SOLAR RADIATION'), 'Globalstrahlung');
});

test('leer bleibt leer, und nichts wirft', () => {
  assert.strictEqual(de(''), '');
  assert.strictEqual(de(null), '');
  assert.strictEqual(de(undefined), '');
  assert.strictEqual(de(0), '0');
});

// --- Die Tabelle selbst ---------------------------------------------------------------------

test('jeder Eintrag ist echtes Deutsch, nicht ASCII-Ersatz', () => {
  // "Boe" statt "Böe" oder "Aussentemperatur" statt "Außentemperatur" steht sonst so auf der
  // Wand. Geprueft wird auf die Ersatzschreibungen, die dabei entstehen.
  for (const [en, dt] of Object.entries(SENSORNAMEN)) {
    assert.ok(!/\b(Boe|Aussen|Staerk|Stromstaerke|Luftfeuchtigk\w*keit|ae|oe|ue)\b/.test(dt),
      `"${en}" -> "${dt}" sieht nach ASCII-Ersatz aus`);
    assert.strictEqual(dt, dt.trim(), `"${dt}" hat Leerraum am Rand`);
    assert.match(dt[0], /[A-ZÄÖÜ]/, `"${dt}" faengt klein an -- Substantive gross`);
  }
});

test('die Schluessel sind kleingeschrieben und einfach gesetzt', () => {
  for (const k of Object.keys(SENSORNAMEN)) {
    assert.strictEqual(k, k.toLowerCase(), `"${k}" muss klein geschrieben sein`);
    assert.strictEqual(k, k.trim().replace(/\s+/g, ' '), `"${k}" hat unsauberen Leerraum`);
  }
});

test('kein Eintrag ist so lang, dass er keine Karte trifft', () => {
  // Der Name ist die Bildunterschrift einer Karte, und die ist ein paar Zentimeter breit.
  for (const [en, dt] of Object.entries(SENSORNAMEN)) {
    assert.ok(dt.length <= 26, `"${en}" -> "${dt}" ist ${dt.length} Zeichen lang`);
  }
});

test('der eigene Name wird NICHT uebersetzt', () => {
  const quelle = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'renderer', 'shared', 'dashboard-render.js'), 'utf8');
  const i = quelle.indexOf('const name = esc((settings.name');
  assert.ok(i > 0, 'die Namensauflösung sieht anders aus -- dieser Test muss nachgezogen werden');
  const block = quelle.slice(i, i + 320);
  assert.ok(/settings\.name && String\(settings\.name\)\.trim\(\)\)\s*\n?\s*\|\|\s*sensornameDeutsch/.test(block),
    'die Uebersetzung darf erst NACH dem eigenen Namen greifen');
});
