'use strict';

// Das Detailfenster: Tippen auf eine Anzeigekarte zeigt eine groessere Ansicht.
//
// `detailInhalt()` ist eine reine Funktion (rein Kennung, Typ, Zustand, Zusatzdaten -- raus
// HTML), und genau deshalb ist hier pruefbar, was sonst nur auf der Wand auffaellt.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = require('../renderer/shared/dashboard-render.js');
const de = R.detailInhalt;

const verlauf = (n, f) => Array.from({ length: n }, (_, i) => ({ t: 1000 + i * 60000, v: f(i) }));
const titel = (h) => (h.match(/dt-titel">([^<]*)</) || [])[1];
const unter = (h) => (h.match(/dt-unter">([^<]*)</) || [])[1];

// --- Welche Karten es ueberhaupt gibt -------------------------------------------------------

test('NUR Karten, die beim Tippen nichts tun', () => {
  // Bei einer Lampe, einem Tor, einem Rollladen ist das Tippen die Bedienung. Ein Fenster
  // davor macht aus einem Schalter ein Ratespiel: Man tippt, es geht nichts an, und
  // stattdessen erscheint etwas zum Lesen.
  for (const bedienbar of ['light', 'switch', 'button', 'cover', 'climate', 'lock', 'fan',
    'vacuum', 'gate', 'select', 'navigate', 'media_player', 'quicktiles']) {
    assert.ok(!R.DETAIL_TYPEN.includes(bedienbar), `${bedienbar} wird bedient, nicht gelesen`);
  }
});

test('die Anzeigekarten sind dabei, Uhr und Foto nicht', () => {
  for (const anzeige of ['energy', 'graph', 'gauge', 'temperature', 'humidity', 'pressure',
    'wind', 'rain', 'sensor', 'forecast', 'waste']) {
    assert.ok(R.DETAIL_TYPEN.includes(anzeige), `${anzeige} fehlt`);
  }
  // Eine Uhr in Gross sagt dasselbe wie die Uhr in Klein; das Foto IST schon die grosse Ansicht.
  assert.ok(!R.DETAIL_TYPEN.includes('clock'));
  assert.ok(!R.DETAIL_TYPEN.includes('photo'));
});

// --- Der Kopf ------------------------------------------------------------------------------

test('eine erfundene Kennung ist kein Titel', () => {
  // Karten ohne Entitaet tragen "energy:1790160724518" -- als Titel ist das eine Zeitmarke,
  // kein Name. Dann ist die Art der Karte die bessere Auskunft.
  assert.strictEqual(titel(de('energy:1790160724518', 'energy', null, {})), 'Energiefluss');
  assert.strictEqual(titel(de('energy:1', 'energy', null, { settings: { name: 'Strom' } })), 'Strom');
  // Eine echte Kennung bleibt stehen, wenn sonst nichts bekannt ist -- sie ist dann die
  // einzige Auskunft, die es gibt.
  assert.strictEqual(titel(de('sensor.namenlos', 'sensor', { state: '1', attributes: {} }, {})),
    'sensor.namenlos');
});

test('der Titel wird uebersetzt, die Kennung nicht', () => {
  const h = de('sensor.x', 'sensor', { state: '1', attributes: {} },
    { namen: { 'sensor.x': 'Solar Radiation' } });
  assert.strictEqual(titel(h), 'Globalstrahlung');
  assert.match(unter(h), /sensor\.x$/, 'die Kennung gehoert unveraendert in die Unterzeile');
});

// --- Der Wert ------------------------------------------------------------------------------

test('ein fehlender Wert wird zum Gedankenstrich, nicht zu 0', () => {
  // "unknow" ohne n hat es am Geraet wirklich gegeben. Number('unavailable') waere NaN,
  // Number(null) waere 0 -- beides gehoert nicht an eine Wand.
  for (const nichts of ['unavailable', 'unknown', 'unknow', '-', 'keine', '']) {
    const h = de('sensor.x', 'temperature', { state: nichts, attributes: {} }, {});
    assert.match(h, /dt-wert">–</, `"${nichts}" muss ein Strich werden`);
  }
});

test('Einheit und Nachkommastellen kommen aus der Karte', () => {
  const h = de('sensor.x', 'temperature', { state: '11.234', attributes: { unit_of_measurement: '°C' } },
    { settings: { decimals: 1 } });
  assert.match(h, /11,2/, 'deutsche Schreibweise, eine Stelle');
  assert.match(h, /dt-einheit">°C</);
  // Ein eigenes Suffix gewinnt, genau wie auf der Karte.
  assert.match(de('sensor.x', 'temperature', { state: '5', attributes: { unit_of_measurement: '°C' } },
    { settings: { suffix: 'Grad' } }), /dt-einheit">Grad</);
});

// --- Verlauf und Kennzahlen ----------------------------------------------------------------

test('Tiefstwert, Mittel und Hoechstwert werden gerechnet, nicht geschaetzt', () => {
  const h = de('sensor.x', 'temperature', { state: '5', attributes: {} },
    { history: verlauf(5, i => [2, 4, 6, 8, 10][i]) });
  assert.match(h, /Tiefstwert<\/span><strong>2</);
  assert.match(h, /Mittel<\/span><strong>6</);
  assert.match(h, /Höchstwert<\/span><strong>10</);
});

test('ohne Verlauf gibt es weder Kurve noch Kennzahlen', () => {
  // Eine leere Flaeche mit vier Nullen darin behauptet eine Messung.
  const h = de('sensor.x', 'temperature', { state: '5', attributes: {} }, {});
  assert.ok(!/dt-verlauf/.test(h));
  assert.ok(!/dt-kennzahlen/.test(h));
});

test('ein einzelner Messpunkt ergibt keine Kurve', () => {
  const h = de('sensor.x', 'temperature', { state: '5', attributes: {} }, { history: verlauf(1, () => 5) });
  assert.ok(!/dt-verlauf/.test(h), 'eine Linie aus einem Punkt ist keine');
});

test('jeder Pfad faengt mit dem SVG-Kommando M an', () => {
  // Dieselbe Falle wie bei ED_M: Der Browser verwirft so einen Pfad STILLSCHWEIGEND.
  const h = de('sensor.x', 'temperature', { state: '5', attributes: {} },
    { history: verlauf(20, i => Math.sin(i) * 10) });
  const pfade = [...h.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
  assert.ok(pfade.length >= 2, 'Flaeche und Linie');
  for (const p of pfade) assert.match(p, /^M/, p.slice(0, 40));
});

test('ein waagerechter Verlauf teilt nicht durch null', () => {
  // max - min ist dann 0. Ohne Absicherung kaeme NaN in jede Koordinate, und der Browser
  // verwirft den Pfad -- lautlos.
  const h = de('sensor.x', 'temperature', { state: '5', attributes: {} }, { history: verlauf(10, () => 7) });
  assert.ok(!/NaN/.test(h), 'keine NaN in den Koordinaten');
  assert.match(h, /dt-verlauf/);
});

// --- Attribute -----------------------------------------------------------------------------

test('Attribute, die schon auf der Karte stehen, werden nicht wiederholt', () => {
  const h = de('sensor.x', 'sensor', { state: '1', attributes: {
    friendly_name: 'Name', icon: 'mdi:x', unit_of_measurement: '°C', device_class: 'temperature',
    battery: 87
  } }, {});
  assert.match(h, /battery<\/span><strong>87</, 'was Neues sagt, gehoert hinein');
  for (const doppelt of ['friendly_name', 'icon', 'device_class', 'unit_of_measurement']) {
    assert.ok(!h.includes(`>${doppelt}<`), `${doppelt} steht schon oben`);
  }
});

test('verschachtelte Attribute werden weggelassen', () => {
  // "[object Object]" auf einer Wand ist schlechter als eine Zeile weniger.
  const h = de('sensor.x', 'sensor', { state: '1', attributes: { forecast: [{ a: 1 }], ok: 'ja' } }, {});
  assert.ok(!h.includes('[object Object]'));
  assert.match(h, /ok<\/span><strong>ja</);
});

// --- Die Energiekarte ----------------------------------------------------------------------

test('die Energieansicht nennt jede Quelle samt Kennung', () => {
  // Das ist die Auskunft, die auf der Karte fehlt: Welcher Sensor liefert welche Zahl. Bei der
  // Fehlersuche ("warum steht da 1,23 kW") hilft nur das.
  const z = (id, v, e) => ({ entity_id: id, state: v, attributes: { unit_of_measurement: e } });
  const h = de('energy:1', 'energy', null, {
    diagramm: '<svg class="ed"></svg>',
    energy: {
      solar: z('sensor.kostal', '8200', 'W'),
      grid: z('sensor.netzbezug', '0', 'W'),
      wallbox: z('sensor.wallbox', '7400', 'W')
    }
  });
  assert.match(h, /class="ed"/, 'das Diagramm gehoert hinein');
  for (const [name, id] of [['Solar', 'sensor.kostal'], ['Netzbezug', 'sensor.netzbezug'],
    ['Wallbox', 'sensor.wallbox']]) {
    assert.ok(h.includes(name), name);
    assert.ok(h.includes(id), id);
  }
  // Was nicht eingetragen ist, erscheint auch nicht als leere Zeile.
  assert.ok(!h.includes('Batterie'), 'ohne Batteriesensor keine Batteriezeile');
});

// --- Maskierung ----------------------------------------------------------------------------

test('alles Fremde wird maskiert', () => {
  // Der Inhalt landet per innerHTML im Fenster, und Namen und Attribute kommen aus Home
  // Assistant -- also von aussen.
  const h = de('sensor.x', 'sensor', { state: '<b>1</b>', attributes: { boes: '<img src=x>' } },
    { settings: { name: '<script>alert(1)</script>' } });
  assert.ok(!h.includes('<script>'), 'kein Skript aus dem Namen');
  assert.ok(!h.includes('<img src=x>'), 'kein Element aus einem Attribut');
  assert.ok(!h.includes('<b>1</b>'), 'kein Element aus dem Zustand');
});

// --- Die Verbindung ------------------------------------------------------------------------

const RENDER = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'dashboard-render.js'), 'utf8');
const DASH = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dashboard.html'), 'utf8');

test('buildCard haengt den Zuhoerer nur da an, wo er hingehoert', () => {
  const i = RENDER.indexOf("if (!editable && cb.onDetail && DETAIL_TYPEN.includes(type))");
  assert.ok(i > 0, 'die Bedingung fehlt oder sieht anders aus');
  // Im Editor NICHT: Dort ist ein Tippen das Auswaehlen der Karte.
  assert.match(RENDER.slice(i, i + 60), /!editable/);
});

test('ein Tipp auf ein Bedienelement innerhalb der Karte oeffnet nichts', () => {
  // Die Verlaufskarte hat Zeitraum-Knoepfe, der Media Player Regler. Wer eines davon trifft,
  // will nicht das Fenster.
  const i = RENDER.indexOf("if (!editable && cb.onDetail");
  const block = RENDER.slice(i, i + 700);
  assert.match(block, /closest\('\[data-act\], button, input, select, a'\)/);
});

test('dashboard.html verdrahtet das Fenster vollstaendig', () => {
  assert.match(DASH, /onDetail: \(entity_id, type, settings\)/, 'der Rueckruf fehlt');
  assert.match(DASH, /const DETAIL_RUHE_MS = 30000;/, 'die dreissig Sekunden fehlen');
  assert.match(DASH, /detailAktualisieren\(\);/, 'das Fenster muss mitlaufen');
});

test('es gibt mehr als einen Weg aus dem Fenster', () => {
  // Ein Fenster ohne sichtbaren Ausgang ist auf einem Touch-Panel eine Falle -- dieselbe Lehre
  // wie beim Zurueck-Knopf ("Der Weg zurueck darf nie verschwinden").
  assert.match(DASH, /id="detailZuKnopf"/, 'der Knopf fehlt');
  assert.match(DASH, /e\.target === h\) detailSchliessen\(\)/, 'Tippen daneben muss schliessen');
  assert.match(DASH, /e\.key === 'Escape'\) detailSchliessen\(\)/, 'Escape muss schliessen');
});

test('der Schoner schliesst das Fenster', () => {
  // Es liegt UNTER dem Schoner (9980 gegen 9990) und waere beim Aufwachen sonst noch offen --
  // mit Zahlen von gestern.
  const i = DASH.indexOf('function hinterDemSchonerAufraeumen');
  const block = DASH.slice(i, DASH.indexOf('\n}', i));
  assert.match(block, /detailSchliessen\(\)/);
});

test('JEDE Eingabe stellt die Uhr zurueck, nicht nur eine im Fenster', () => {
  // Wer daneben tippt, steht noch davor.
  const i = DASH.indexOf('detailUhrStellen(); }');
  assert.ok(i > 0);
  const block = DASH.slice(i - 400, i + 200);
  assert.match(block, /'pointerdown', 'keydown'/);
  assert.match(block, /capture: true/, 'ohne capture verschluckt ein stopPropagation die Eingabe');
});

test('das Fenster liegt unter dem Schoner und unter der Ankuendigung', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'dashboard.css'), 'utf8');
  const z = (muster) => Number(new RegExp(muster + '[^}]*?z-index:\\s*(\\d+)').exec(css)[1]);
  const fenster = z('\\.dt-huelle\\s*\\{');
  assert.ok(fenster < 9990, `das Fenster (${fenster}) muss unter dem Schoner (9990) liegen`);
  assert.ok(fenster > 100, 'aber ueber den Karten');
});
