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
    { namen: { 'sensor.x': 'Solar Radiation' }, debug: true });
  assert.strictEqual(titel(h), 'Globalstrahlung');
  assert.match(unter(h), /sensor\.x$/, 'die Kennung gehoert unveraendert in die Unterzeile');
});

test('die Kennung steht nur mit Debug im Kopf', () => {
  // Sie ist eine Auskunft fuer die Fehlersuche, kein Untertitel. Ohne Debug steht dort nur,
  // was fuer eine Karte das ist.
  const ohne = de('sensor.x', 'sensor', { state: '1', attributes: {} }, {});
  assert.ok(!unter(ohne).includes('sensor.x'), `"${unter(ohne)}" verraet die Kennung`);
  assert.strictEqual(unter(ohne), 'Sensor (Text)');
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
  } }, { debug: true });
  assert.match(h, /battery<\/span><strong>87</, 'was Neues sagt, gehoert hinein');
  for (const doppelt of ['friendly_name', 'icon', 'device_class', 'unit_of_measurement']) {
    assert.ok(!h.includes(`>${doppelt}<`), `${doppelt} steht schon oben`);
  }
});

test('verschachtelte Attribute werden weggelassen', () => {
  // "[object Object]" auf einer Wand ist schlechter als eine Zeile weniger.
  const h = de('sensor.x', 'sensor', { state: '1', attributes: { forecast: [{ a: 1 }], ok: 'ja' } },
    { debug: true });
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

// --- Debug an oder aus ---------------------------------------------------------------------

const ZUSTAND = { state: '11.2', last_changed: new Date(Date.now() - 300000).toISOString(),
  attributes: { unit_of_measurement: '°C', battery: 87 } };
const VERLAUF = { history: verlauf(10, i => i) };

test('ohne Debug gibt es die AUSWERTUNG, keine Rohdaten', () => {
  // Wer davorsteht, will den Verlauf -- nicht die Attributliste.
  const h = de('sensor.x', 'temperature', ZUSTAND, VERLAUF);
  assert.match(h, /dt-verlauf/, 'der Verlauf gehoert hinein');
  assert.match(h, /Höchstwert/, 'und die Kennzahlen');
  assert.match(h, /Zuletzt aktualisiert/, 'und wann es zuletzt kam');
  assert.ok(!/dt-roh/.test(h), 'keine Rohdaten');
  assert.ok(!/battery/.test(h), 'keine Attribute');
});

test('mit Debug kommen Rohdaten UND Attribute dazu', () => {
  const h = de('sensor.x', 'temperature', ZUSTAND, { ...VERLAUF, debug: true });
  assert.match(h, /dt-roh/);
  assert.match(h, /Zustand \(roh\)<\/span><strong>11\.2</, 'der rohe Wert, unformatiert');
  assert.match(h, /battery/, 'die Attribute');
  // Der Verlauf bleibt: Debug NIMMT nichts weg, es legt etwas dazu.
  assert.match(h, /dt-verlauf/);
  assert.match(h, /Höchstwert/);
});

test('die Energiekarte ist in BEIDEN Lagen gleich', () => {
  // Dort sind die Sensoren die Auskunft, und das Diagramm ist ohnehin die Auswertung. Eine
  // Weiche waere hier eine Verschlechterung in der einen Richtung.
  const daten = { diagramm: '<svg class="ed"></svg>',
    energy: { solar: { entity_id: 'sensor.pv', state: '8200', attributes: { unit_of_measurement: 'W' } } } };
  const ohne = de('energy:1', 'energy', null, daten);
  const mit = de('energy:1', 'energy', null, { ...daten, debug: true });
  assert.match(ohne, /sensor\.pv/, 'die Quellen stehen auch ohne Debug da');
  // Verglichen wird der KOERPER, nicht der Kopf: Dort steht mit Debug die Kennung, und das
  // gilt fuer jede Karte gleich.
  const koerper = (h) => h.slice(h.indexOf('dt-energie'));
  assert.strictEqual(koerper(ohne), koerper(mit), 'der Inhalt muss identisch sein');
  assert.ok(!/dt-roh/.test(mit), 'auch mit Debug kein zusaetzlicher Rohdaten-Block');
});

// --- Der Abfallkalender --------------------------------------------------------------------

const ABFUHR = [
  { start: '2026-10-07', summary: 'Restabfall' },
  { start: '2026-10-07', summary: 'Papierabfall' },
  { start: '2026-10-21', summary: 'Restabfall' },
  { start: '2026-11-04', summary: 'Verpackungstonne' }
];

test('ohne Debug zeigen die Muelltermine einen KALENDER', () => {
  // Ihr Rohzustand ist "off". Gross angezeigt sagt das niemandem etwas -- und genau so sah es
  // vorher aus.
  const h = de('calendar.awido', 'waste', { state: 'off', attributes: {} }, { waste: ABFUHR });
  assert.match(h, /dk-raster/, 'das Monatsraster fehlt');
  assert.ok(!/dt-wert/.test(h), '"off" darf nicht gross dastehen');
  assert.ok(!/dt-verlauf/.test(h), 'ein Verlauf ergibt bei Terminen keinen Sinn');
});

test('mit Debug zeigen sie die Rohdaten, keinen Kalender', () => {
  const h = de('calendar.awido', 'waste', { state: 'off', attributes: { message: 'Restabfall' } },
    { waste: ABFUHR, debug: true });
  assert.match(h, /dt-roh/);
  assert.ok(!/dk-raster/.test(h));
});

test('der Kalender deckt die Monate ab, in denen Termine liegen', () => {
  const h = de('calendar.awido', 'waste', null, { waste: ABFUHR });
  const monate = (h.match(/class="dk-monat"/g) || []).length;
  assert.ok(monate >= 2, `zu wenige Monate (${monate}) -- die Termine reichen bis November`);
  assert.ok(monate <= 4, 'hoechstens vier -- der Abruf geht ueber 60 Tage, mehr waere leer');
});

test('jeder Abfuhrtag traegt die Farben seiner Tonnen', () => {
  const h = de('calendar.awido', 'waste', null, { waste: ABFUHR });
  const abfuhrtage = (h.match(/class="dk-tag dk-abfuhr/g) || []).length;
  assert.strictEqual(abfuhrtage, 3, 'drei Tage mit Abfuhr, nicht vier Termine');
  // Am 7.10. kommen zwei Tonnen -- also zwei Punkte an diesem Tag.
  assert.ok((h.match(/dk-punkt/g) || []).length >= 4, 'Punkte auf den Tagen und in der Legende');
});

test('die Legende nennt nur Tonnen, die wirklich vorkommen', () => {
  // Eine Legende mit Eintraegen, die nirgends auftauchen, laesst einen suchen.
  const h = de('calendar.awido', 'waste', null, { waste: ABFUHR });
  const legende = /dk-legende">([\s\S]*?)<\/div>/.exec(h)[1];
  for (const art of ['Restabfall', 'Papierabfall', 'Verpackungstonne']) {
    assert.ok(legende.includes(art), art);
  }
  assert.ok(!legende.includes('Biotonne'), 'was nicht vorkommt, steht nicht in der Legende');
});

test('die Woche faengt am Montag an', () => {
  const h = de('calendar.awido', 'waste', null, { waste: ABFUHR });
  const koepfe = [...h.matchAll(/class="dk-kopf">([^<]+)</g)].map(m => m[1]).slice(0, 7);
  assert.deepStrictEqual(koepfe, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
});

test('ohne Termine steht ein Satz, kein leeres Raster', () => {
  const h = de('calendar.awido', 'waste', null, { waste: [] });
  assert.match(h, /Keine Termine gefunden/);
  assert.ok(!/dk-raster/.test(h));
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

// --- Der Abfuhrtag auf der Karte -----------------------------------------------------------

test('der Tag ist auf der Karte die GROESSTE Schrift, nicht ein Chip in der Ecke', () => {
  // Gemeldet als "man erkennt nicht auf Anhieb, an welchem Tag das jetzt ist". Gemessen bei
  // echter Kartengroesse (1229x120): Tag 10 px, Tonnen 22 px, Bildunterschrift 10 px -- der
  // Tag war genau so gross wie die kleinste Schrift auf der Karte.
  //
  // DAMIT KIPPT die Entscheidung "welche Tonne, und wann -- in dieser Reihenfolge". Die
  // Tonnennamen sind lang und deshalb von weitem ohnehin erkennbar; ein Datum ist kurz und
  // verschwindet. Dieser Test haelt die neue Reihenfolge fest, damit sie beim naechsten Umbau
  // nicht stillschweigend zurueckkippt.
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'dashboard.css'), 'utf8');
  const groesse = (sel) => {
    const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^}]*?font-size:\\s*clamp\\([^,]+,\\s*([\\d.]+)cqmin').exec(css);
    return m ? Number(m[1]) : null;
  };
  const tag = groesse('.card.type-waste .waste-tag');
  const tonnen = groesse('.card.type-waste .value.waste-art');
  assert.ok(tag, 'die Regel fuer den Tag fehlt');
  assert.ok(tonnen, 'die Regel fuer die Tonnenzeile fehlt');
  assert.ok(tag > tonnen, `der Tag (${tag}cqmin) muss groesser sein als die Tonnen (${tonnen}cqmin)`);
});

test('die Tonnenzeile hat genug Spezifitaet, um zu wirken', () => {
  // `.waste-art` allein setzte 13cqmin und wirkte NIE: `.card .value` hat zwei Klassen und
  // gewinnt mit 23cqmin. Eine Regel, die nie greift, ist dasselbe wie keine.
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'dashboard.css'), 'utf8');
  assert.match(css, /\.card\.type-waste \.value\.waste-art/,
    'die Groesse der Tonnenzeile braucht mindestens so viele Klassen wie `.card .value`');
});

test('der Tag steht nur EINMAL auf der Karte', () => {
  // Vorher als Chip in der Ecke, jetzt als Zeile. Beides waere dieselbe Auskunft zweimal.
  const render = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'dashboard-render.js'), 'utf8');
  const i = render.indexOf("} else if (type === 'waste') {");
  const block = render.slice(i, render.indexOf("} else if (type === 'photo')", i));
  assert.match(block, /class="waste-tag/, 'die Tagzeile fehlt');
  assert.ok(!/class="badge/.test(block), 'der Chip in der Ecke muss weg sein');
  assert.strictEqual((block.match(/wasteDateLabel\(naechster\.start\)/g) || []).length, 1,
    'der naechste Tag darf nur an einer Stelle gesetzt werden');
});
