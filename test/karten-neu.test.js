// Tests fuer die Sonneneinstrahlungs-Karte, die Sensorfarben und die Symbole aus Home Assistant.

const test = require('node:test');
const assert = require('node:assert');
const R = require('../renderer/shared/dashboard-render.js');

// --- Sonneneinstrahlung -------------------------------------------------------------------

test('Die Einheit W/m2 macht eine Sonneneinstrahlungs-Karte', () => {
  // Die Einheit ist der zuverlaessige Teil: device_class "irradiance" gibt es erst seit
  // HA 2022, und aeltere Integrationen liefern sie oft gar nicht.
  ['W/m²', 'W/m2', 'W/m ²'].forEach(u => {
    assert.strictEqual(R.isSolar('sensor.x', { unit_of_measurement: u }), true, u);
  });
  assert.strictEqual(R.isSolar('sensor.x', { device_class: 'irradiance' }), true);
});

test('Watt allein ist keine Einstrahlung', () => {
  // An einem Wechselrichter steht "Solar" und er liefert Watt -- das ist Leistung, keine
  // Einstrahlung, und gehoert auf eine andere Karte.
  assert.strictEqual(R.isSolar('sensor.solar_power', { unit_of_measurement: 'W', device_class: 'power' }), false);
  assert.strictEqual(R.isSolar('sensor.solar_ertrag', { unit_of_measurement: 'kWh', device_class: 'energy' }), false);
});

test('Ohne Einheit entscheidet der Name -- aber nur, wenn nichts anderes dagegen spricht', () => {
  assert.strictEqual(R.isSolar('sensor.ecowitt_solar_radiation', {}), true);
  assert.strictEqual(R.isSolar('sensor.sonneneinstrahlung', {}), true);
  // Eine device_class hat sich schon erklaert -- dann zaehlt der Name nicht mehr.
  assert.strictEqual(R.isSolar('sensor.solar_radiation_batterie', { device_class: 'battery' }), false);
});

test('Eine Einstrahlungs-Entitaet bekommt die Sonnenkarte vorgeschlagen', () => {
  const z = { state: '412', attributes: { unit_of_measurement: 'W/m²', friendly_name: 'Solar Radiation' } };
  assert.strictEqual(R.defaultCardType('sensor.solar', z), 'solar');
  assert.ok(R.allowedCardTypes('sensor.solar', z).includes('solar'));
});

test('Die Sonnenkarte steht im Katalog und nimmt Sensor-Domains', () => {
  assert.ok(R.CARD_TYPES.solar, 'fehlt im Katalog');
  assert.ok(R.domainsForType('solar').includes('sensor'));
});

// --- Sensorfarben -------------------------------------------------------------------------

test('Mehrere Sensorkarten bekommen verschiedene Farben', () => {
  // Drei nebeneinander sahen bisher identisch aus -- man musste jedes Mal die
  // Bildunterschrift lesen.
  const ids = ['sensor.a', 'sensor.b', 'sensor.c', 'sensor.d'];
  const farben = Object.values(R.sensorAkzente(ids));
  assert.strictEqual(new Set(farben).size, ids.length, JSON.stringify(farben));
});

test('Dieselbe Karte behaelt ihre Farbe, wenn daneben etwas dazukommt', () => {
  // Sonst faerbte sich das halbe Dashboard um, weil irgendwo ein Sensor hinzukam.
  const vorher = R.sensorAkzente(['sensor.a', 'sensor.b']);
  const nachher = R.sensorAkzente(['sensor.a', 'sensor.b', 'sensor.neu']);
  assert.strictEqual(nachher['sensor.a'], vorher['sensor.a']);
  assert.strictEqual(nachher['sensor.b'], vorher['sensor.b']);
});

test('Die Farben sind stabil ueber Programmlaeufe hinweg', () => {
  assert.deepStrictEqual(R.sensorAkzente(['sensor.aussen']), R.sensorAkzente(['sensor.aussen']));
});

test('Keine Sensorfarbe kollidiert mit einem festen Kartenakzent', () => {
  // Sonst sieht eine Sensorkarte aus wie eine Klimakarte -- und die Farbe wuerde etwas
  // behaupten, was nicht stimmt.
  const feste = ['#7ba4ff', '#ffc061', '#6fd6a0', '#8fdccd', '#7fa2e6', '#bd9cf5',
    '#ff9d7a', '#7fc7e6', '#9db4d8', '#ff8f8f', '#a7b09a', '#f2d867', '#7aa2ff'];
  R.SENSOR_FARBEN.forEach(f => assert.ok(!feste.includes(f.toLowerCase()), 'doppelt: ' + f));
});

test('Eine leere Liste ergibt eine leere Zuordnung, keinen Fehler', () => {
  assert.deepStrictEqual(R.sensorAkzente([]), {});
  assert.deepStrictEqual(R.sensorAkzente(null), {});
});

// --- Symbole aus Home Assistant -------------------------------------------------------------

test('Ohne geladene Pfade kommt kein kaputtes SVG heraus', () => {
  // Die 2,6-MB-Datei wird erst nachgeladen, wenn eine Karte sie braucht. Bis dahin darf hier
  // nichts Halbes entstehen -- ein <path d="undefined"> zeichnet einen Fehler statt nichts.
  assert.strictEqual(R.mdiSymbol('mdi:weather-sunny'), '');
  assert.strictEqual(R.mdiSymbol(''), '');
  assert.strictEqual(R.mdiSymbol(null), '');
});

test('Nachgeladene Pfade ergeben ein gefuelltes SVG', () => {
  const alt = global.window;
  global.window = { MDI_PFADE: { 'weather-sunny': 'M1,2L3,4' } };
  try {
    const svg = R.mdiSymbol('mdi:weather-sunny');
    assert.match(svg, /<svg/);
    assert.match(svg, /d="M1,2L3,4"/);
    // Material-Design-Symbole sind Flaechen, keine Striche.
    assert.match(svg, /fill="currentColor"/);
    // Auch ohne das Praefix "mdi:" -- Home Assistant schreibt es, unsere Einstellungen nicht.
    assert.match(R.mdiSymbol('weather-sunny'), /<svg/);
    assert.strictEqual(R.mdiSymbol('gibtesnicht'), '');
  } finally { global.window = alt; }
});

test('Nur die Sensorkarte holt sich das Symbol aus Home Assistant', () => {
  const mitIcon = { state: '5', attributes: { icon: 'mdi:flower' } };
  assert.strictEqual(R.brauchtMdi('sensor', mitIcon, {}), true);
  // Eine Klimakarte nicht: Dort sagt die Bewegung des eigenen Symbols etwas, das ein fremdes
  // nicht sagen kann.
  assert.strictEqual(R.brauchtMdi('climate', mitIcon, {}), false);
  // Und die eigene Wahl schlaegt Home Assistant.
  assert.strictEqual(R.brauchtMdi('sensor', mitIcon, { icon: 'gate' }), false);
  assert.strictEqual(R.brauchtMdi('sensor', { state: '5', attributes: {} }, {}), false);
});

test('Fuer helles Design gibt es dunklere Sensorfarben', () => {
  // Die pastelligen Toene verschwinden auf hellem Grund fast vollstaendig. Und sie stehen in
  // JS statt im CSS, weil der Akzent direkt am Element gesetzt wird -- eine CSS-Regel kaeme
  // dagegen nicht an.
  assert.strictEqual(R.SENSOR_FARBEN_HELL.length, R.SENSOR_FARBEN.length);
  const hell = R.sensorAkzente(['sensor.a', 'sensor.b'], true);
  const dunkel = R.sensorAkzente(['sensor.a', 'sensor.b'], false);
  Object.keys(hell).forEach(k => assert.notStrictEqual(hell[k], dunkel[k], k));
  Object.values(hell).forEach(f => assert.ok(R.SENSOR_FARBEN_HELL.includes(f), f));
});

// --- Karten auf dem Abschiedsschirm ------------------------------------------------------------
//
// Am 2026-09-14 stand auf der Wand eine riesige Alarmkarte und daneben ein Streifen einer
// zweiten, halb ausserhalb des Bildschirms. Ursache: Die Karten kommen aus einem
// Unterdashboard und bringen von dort ihren PLATZ im 6x6-Raster der Wand mit -- die Flaeche
// auf dem Abschiedsschirm hatte aber nur zwei Spalten. "grid-column: 4 / span 3" haengt dort
// stillschweigend weitere Spalten an.
//
// Die Loesung ist NICHT, den Platz wegzuwerfen: Der Schirm soll das Unterdashboard so zeigen,
// wie es im Editor angeordnet wurde. Die Flaeche hat deshalb dasselbe Raster, und geschnitten
// wird nur noch als Fangnetz.

test('Eine passende Karte behaelt Groesse UND Platz', () => {
  assert.deepStrictEqual(R.schonerSpanne({ cols: 3, rows: 4, x: 3, y: 0 }),
    { cols: 3, rows: 4, x: 3, y: 0 });
});

test('Was ueber den Rand ragt, wird hereingeschoben statt beschnitten', () => {
  // Eine Karte, die schmaler gemacht wird, verliert ihren Inhalt; eine, die ein Feld weiter
  // links liegt, nicht.
  assert.deepStrictEqual(R.schonerSpanne({ cols: 2, rows: 2, x: 5, y: 5 }),
    { cols: 2, rows: 2, x: 4, y: 4 });
});

test('Groesser als die Flaeche geht nicht', () => {
  assert.deepStrictEqual(R.schonerSpanne({ cols: 9, rows: 9, x: 0, y: 0 }),
    { cols: 6, rows: 6, x: 0, y: 0 });
});

test('Ohne Platzangabe fliesst die Karte', () => {
  // Kein x/y erfunden -- mit erfundener Position landete sie irgendwo, und "irgendwo" ist auf
  // einem Raster immer auf einer anderen Karte.
  assert.deepStrictEqual(R.schonerSpanne({ cols: 2, rows: 2 }), { cols: 2, rows: 2 });
});

test('Unsinnige Masse ergeben eine Karte, keine Ausnahme', () => {
  // Ein fehlendes Mass darf keine Karte mit "span NaN" erzeugen -- die verschwindet lautlos.
  for (const w of [null, undefined, {}, { cols: 0, rows: 0 }, { cols: -3, rows: 'zwei' }]) {
    const s = R.schonerSpanne(w);
    assert.ok(s.cols >= 1 && s.rows >= 1, JSON.stringify(w) + ' -> ' + JSON.stringify(s));
  }
});

test('Die Grenzen stimmen mit dem Raster in der CSS ueberein', () => {
  // Zwei Zahlen, die dasselbe meinen: Laufen sie auseinander, gibt es keinen Fehler, sondern
  // wieder eine Karte, die halb aus dem Bild haengt.
  const css = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'renderer', 'shared', 'dashboard.css'), 'utf8');
  const block = css.slice(css.indexOf('.bs-karten {'), css.indexOf('.bs-leer'));
  const spalten = 'grid-template-columns: repeat(' + R.SCHONER_SPALTEN + ', 1fr)';
  const zeilen = 'grid-template-rows: repeat(' + R.SCHONER_ZEILEN + ', 1fr)';
  assert.ok(block.includes(spalten), spalten + ' fehlt in: ' + block);
  assert.ok(block.includes(zeilen), zeilen + ' fehlt in: ' + block);
});

// --- Muelltermine ------------------------------------------------------------------------------
//
// Zwei Dinge waren hier falsch. Erstens war der KARTENNAME die groesste Schrift -- aus zwei
// Metern las man "Muelltermine" und sonst nichts, obwohl die Frage "welche Tonne, und wann?"
// lautet. Zweitens stand jeder Eintrag in einer eigenen Zeile; in Crespina fahren dienstags
// zwei Tonnen zusammen, und das frass die halbe Karte.

test('Termine werden nach Tagen zusammengefasst', () => {
  const tage = R.wasteTage([
    { summary: 'Pannoloni', start: '2026-09-15' },
    { summary: 'Organico', start: '2026-09-14' },
    { summary: 'Indifferenziato', start: '2026-09-15' }
  ]);
  assert.strictEqual(tage.length, 2);
  assert.deepStrictEqual(tage[0].arten, ['Organico']);
  // Innerhalb eines Tages bleibt die Reihenfolge aus Home Assistant stehen -- umsortieren
  // wuerde eine Rangfolge behaupten, die es nicht gibt.
  assert.deepStrictEqual(tage[1].arten, ['Pannoloni', 'Indifferenziato'], 'beide Tonnen an einem Tag');
});

test('Derselbe Tonnenname an einem Tag steht nur einmal da', () => {
  const tage = R.wasteTage([
    { summary: 'Organico', start: '2026-09-14' },
    { summary: 'Organico', start: '2026-09-14' }
  ]);
  assert.deepStrictEqual(tage[0].arten, ['Organico']);
});

test('Die Anzahl begrenzt TAGE, nicht Eintraege', () => {
  const ev = [
    { summary: 'A', start: '2026-09-14' }, { summary: 'B', start: '2026-09-14' },
    { summary: 'C', start: '2026-09-15' }, { summary: 'D', start: '2026-09-16' }
  ];
  assert.strictEqual(R.wasteTage(ev, 2).length, 2);
  assert.deepStrictEqual(R.wasteTage(ev, 2)[0].arten, ['A', 'B']);
});

test('Kaputte Eintraege werden uebergangen, nicht gezaehlt', () => {
  assert.deepStrictEqual(R.wasteTage(null), []);
  assert.deepStrictEqual(R.wasteTage([{ summary: 'X' }, { start: '' }]), []);
});

test('Ein reines Datum ist LOKALE Mitternacht, nicht UTC', () => {
  // new Date('2026-09-14') ist nach der Norm UTC-Mitternacht. Westlich von Greenwich waere das
  // der 13. September -- die Tonne stuende einen Tag zu frueh auf der Karte. Genau dieser
  // Fallstrick steht in CLAUDE.md.
  const d = R.wasteDatum('2026-09-14');
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 8);
  assert.strictEqual(d.getDate(), 14, 'Ortszeit, nicht UTC');
  assert.strictEqual(R.wasteTagesschluessel('2026-09-14'), '2026-09-14');
  assert.strictEqual(R.wasteDatum('quatsch'), null);
});

test('Heute und morgen werden benannt, alles andere datiert', () => {
  const zwei = (x) => String(x).padStart(2, '0');
  const tag = (n) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + zwei(d.getMonth() + 1) + '-' + zwei(d.getDate());
  };
  assert.strictEqual(R.wasteDateLabel(tag(0)), 'Heute');
  assert.strictEqual(R.wasteDateLabel(tag(1)), 'Morgen');
  assert.match(R.wasteDateLabel(tag(5)), /\d\d\.\d\d\./);
  // "Bald" ist eine Aufgabe, alles andere eine Information -- nur dafuer faerbt sich der Chip.
  assert.strictEqual(R.wasteBald(tag(0)), true);
  assert.strictEqual(R.wasteBald(tag(1)), true);
  assert.strictEqual(R.wasteBald(tag(2)), false);
  assert.strictEqual(R.wasteBald(tag(-1)), false, 'Vergangenes draengt nicht mehr');
});
