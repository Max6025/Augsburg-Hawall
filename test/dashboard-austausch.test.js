// Tests fuer das Aus- und Eingeben von Dashboards.
//
// Der Import ist die eigentlich heikle Seite. Die Dateien kommen von aussen: aus einem
// aelteren Stand, aus einem Chatfenster, von Hand getippt. Sie werden Fehler enthalten, und
// die Frage ist nur, ob man sie SIEHT oder ob sie sich als leere Karte tarnen.

const test = require('node:test');
const assert = require('node:assert');
const a = require('../server/dashboard-austausch');
const { CARD_TYPES } = require('../renderer/shared/dashboard-render.js');

const dash = (layout, extra) => Object.assign({ name: 'Küche', type: 'cards', layout }, extra);
const rein = (karten, extra) => Object.assign({
  format: a.FORMAT, version: 1, name: 'Küche', art: 'karten', karten
}, extra);

// --- Export ------------------------------------------------------------------------------------

test('Ein Dashboard wird zu einer lesbaren Datei', () => {
  const { datei } = a.exportieren(dash([
    { entity_id: 'light.kueche', card_type: 'light', x: 0, y: 0, cols: 1, rows: 1, settings: { name: 'Decke' } }
  ]), CARD_TYPES);

  assert.strictEqual(datei.format, a.FORMAT);
  assert.strictEqual(datei.name, 'Küche');
  assert.deepStrictEqual(datei.karten[0], {
    entitaet: 'light.kueche', art: 'light', x: 0, y: 0, spalten: 1, zeilen: 1,
    einstellungen: { name: 'Decke' }
  });
});

test('Die Datei bringt ihre eigene Anleitung mit', () => {
  // Sie ist allein unterwegs -- in einem Chatfenster, in einer Mail, auf einem Stick. Was
  // dort nicht drinsteht, ist nicht da.
  const { datei } = a.exportieren(dash([]), CARD_TYPES);
  assert.ok(datei._anleitung, 'keine Anleitung');
  assert.ok(datei._anleitung.raster.includes('4'), 'Rastergroesse fehlt');
  assert.ok(datei._anleitung.kartenarten.length > 20, 'zu wenige Kartenarten aufgezaehlt');
  assert.ok(datei._anleitung.kartenarten.some(z => z.startsWith('light ')), 'light fehlt');
  assert.ok(datei._anleitung.beispiel, 'kein Beispiel');
});

test('Die Anleitung zaehlt genau die Arten auf, die der Import akzeptiert', () => {
  // Sonst schlaegt die Datei etwas vor, das beim Einspielen abgelehnt wird -- der
  // aergerlichste denkbare Fehler, weil man der Anleitung geglaubt hat.
  const { datei } = a.exportieren(dash([]), CARD_TYPES);
  datei._anleitung.kartenarten.forEach((zeile) => {
    const art = zeile.split(' ')[0];
    const e = a.importieren(rein([{ entitaet: 'x.y', art, x: 0, y: 0 }]), CARD_TYPES);
    assert.ok(e.ok, `Anleitung nennt "${art}", der Import lehnt es ab: ${e.fehler}`);
  });
});

test('Bilder, die auf dem Geraet liegen, reisen NICHT mit -- und das wird gesagt', () => {
  // Der wichtigste Fall des ganzen Formats: Ein Export mit photoVersion ergaebe woanders
  // eine Karte mit kaputtem Bildverweis, und zwar lautlos.
  const { datei, hinweise } = a.exportieren(dash([
    { entity_id: 'photo:1', card_type: 'photo', settings: { photoVersion: 123, photoBilder: [1, 2], name: 'Urlaub' } }
  ]), CARD_TYPES);

  assert.strictEqual(datei.karten[0].einstellungen.photoVersion, undefined);
  assert.strictEqual(datei.karten[0].einstellungen.photoBilder, undefined);
  assert.strictEqual(datei.karten[0].einstellungen.name, 'Urlaub', 'der Rest muss bleiben');
  assert.ok(hinweise.length, 'kein Hinweis auf das fehlende Bild');
});

test('Kachelbilder im Schnellzugriff bleiben draussen', () => {
  // Base64-Bilder blaehen die Datei um ein Vielfaches auf und sind in einem Chatfenster
  // unbrauchbar.
  const { datei, hinweise } = a.exportieren(dash([
    { entity_id: 'quicktiles:1', card_type: 'quicktiles',
      settings: { tiles: [{ id: 't1', source: 'Netflix', imageDataUrl: 'data:image/jpeg;base64,AAAA' }] } }
  ]), CARD_TYPES);

  assert.strictEqual(datei.karten[0].einstellungen.tiles[0].imageDataUrl, undefined);
  assert.strictEqual(datei.karten[0].einstellungen.tiles[0].source, 'Netflix');
  assert.ok(hinweise.some(h => h.includes('Kachelbilder')));
});

test('Ein Export ohne Karten ist kein Fehler', () => {
  const { datei } = a.exportieren(dash([]), CARD_TYPES);
  assert.deepStrictEqual(datei.karten, []);
});

// --- Import: was aufgehalten werden MUSS -------------------------------------------------------

test('Eine unbekannte Kartenart wird abgelehnt, nicht durchgewinkt', () => {
  // Durchgewinkt waere sie spaeter eine leere Kachel, und niemand wuesste warum. Genau die
  // Sorte Fehler, die ein Sprachmodell macht: "thermostat" statt "climate".
  const e = a.importieren(rein([{ entitaet: 'climate.bad', art: 'thermostat' }]), CARD_TYPES);
  assert.strictEqual(e.ok, false);
  assert.ok(e.fehler[0].includes('thermostat'), e.fehler[0]);
});

test('Eine fehlende Entitaet wird abgelehnt', () => {
  const e = a.importieren(rein([{ art: 'light' }]), CARD_TYPES);
  assert.strictEqual(e.ok, false);
  assert.ok(e.fehler[0].includes('entitaet'), e.fehler[0]);
});

test('Karten ohne eigene Entitaet duerfen ohne kommen', () => {
  // Uhr, Energiefluss, Foto, Schnellzugriff und Wechsel-Karte brauchen keine.
  const e = a.importieren(rein([{ art: 'clock' }, { art: 'energy' }, { art: 'photo' }]), CARD_TYPES);
  assert.strictEqual(e.ok, true, JSON.stringify(e.fehler));
  assert.strictEqual(e.dashboard.layout.length, 3);
  e.dashboard.layout.forEach(k => assert.ok(k.entity_id, 'jede Karte braucht eine Kennung'));
});

test('Eine Datei aus einer neueren Fassung wird abgelehnt', () => {
  const e = a.importieren(rein([], { version: 99 }), CARD_TYPES);
  assert.strictEqual(e.ok, false);
});

test('Eine fremde Datei wird abgelehnt', () => {
  const e = a.importieren(rein([], { format: 'irgendwas-anderes' }), CARD_TYPES);
  assert.strictEqual(e.ok, false);
});

test('Unsinn statt einer Datei stuerzt nicht ab', () => {
  [null, undefined, 42, 'text', [], {}].forEach((v) => {
    const e = a.importieren(v, CARD_TYPES);
    assert.strictEqual(e.ok, false, JSON.stringify(v));
    assert.ok(e.fehler.length, 'ohne Begruendung abgelehnt: ' + JSON.stringify(v));
  });
});

// --- Import: was geradegebogen werden DARF -----------------------------------------------------
//
// Streng bei allem, was stillschweigend schiefginge. Nachsichtig bei allem, was sich rechnen
// laesst: Ein Sprachmodell verrechnet sich beim Raster, nicht bei den Kartennamen.

test('Eine Karte ueber dem Rand wird hereingeschoben statt abgelehnt', () => {
  const e = a.importieren(rein([{ entitaet: 'light.x', art: 'light', x: 3, y: 0, spalten: 2, zeilen: 1 }]), CARD_TYPES);
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.dashboard.layout[0].x, 2, 'haette nach links gerueckt werden muessen');
  assert.ok(e.warnungen.length, 'stillschweigend verschoben');
});

test('Zwei Karten auf demselben Platz werden entzerrt', () => {
  const e = a.importieren(rein([
    { entitaet: 'light.a', art: 'light', x: 0, y: 0 },
    { entitaet: 'light.b', art: 'light', x: 0, y: 0 }
  ]), CARD_TYPES);
  assert.strictEqual(e.ok, true);
  const [a1, b1] = e.dashboard.layout;
  assert.ok(a1.x !== b1.x || a1.y !== b1.y, 'die Karten liegen uebereinander');
  assert.ok(e.warnungen.length);
});

test('Zu grosse Karten werden auf das Raster begrenzt', () => {
  const e = a.importieren(rein([{ entitaet: 'light.x', art: 'light', spalten: 99, zeilen: 99 }]), CARD_TYPES);
  assert.strictEqual(e.dashboard.layout[0].cols, a.SPALTEN);
  assert.strictEqual(e.dashboard.layout[0].rows, a.ZEILEN);
});

test('Fehlende Platzangaben sind erlaubt', () => {
  // Wer eine Datei im Chat schreiben laesst, bekommt oft nur Entitaet und Art.
  const e = a.importieren(rein([{ entitaet: 'light.x', art: 'light' }]), CARD_TYPES);
  assert.strictEqual(e.ok, true);
  assert.deepStrictEqual(
    { x: e.dashboard.layout[0].x, y: e.dashboard.layout[0].y, cols: e.dashboard.layout[0].cols },
    { x: 0, y: 0, cols: 1 });
});

test('Zahlen als Text werden gelesen', () => {
  const e = a.importieren(rein([{ entitaet: 'light.x', art: 'light', x: '2', spalten: '2' }]), CARD_TYPES);
  assert.strictEqual(e.dashboard.layout[0].x, 2);
  assert.strictEqual(e.dashboard.layout[0].cols, 2);
});

test('Mehr Karten als Plaetze werden nicht uebereinandergestapelt', () => {
  const viele = Array.from({ length: 40 }, (_, i) => ({ entitaet: 'light.' + i, art: 'light' }));
  const e = a.importieren(rein(viele), CARD_TYPES);
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.dashboard.layout.length, a.SPALTEN * a.ZEILEN, 'das Raster wurde ueberfuellt');
  assert.ok(e.warnungen.some(w => w.includes('ausgelassen')), 'die ausgelassenen Karten wurden verschwiegen');
});

test('Englische Schluesselnamen werden auch verstanden', () => {
  // Wer die interne Struktur von Hand kopiert, soll nicht an den Namen scheitern.
  const e = a.importieren(rein([{ entity_id: 'light.x', card_type: 'light', cols: 2, settings: { name: 'A' } }]), CARD_TYPES);
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.dashboard.layout[0].entity_id, 'light.x');
  assert.strictEqual(e.dashboard.layout[0].settings.name, 'A');
});

test('Bildverweise werden auch beim Import entfernt', () => {
  // Die Datei koennte sie mitbringen -- das Bild gibt es hier aber nicht, der Verweis zeigte
  // auf nichts.
  const e = a.importieren(rein([
    { entitaet: 'photo:1', art: 'photo', einstellungen: { photoVersion: 5, name: 'Urlaub' } }
  ]), CARD_TYPES);
  assert.strictEqual(e.dashboard.layout[0].settings.photoVersion, undefined);
  assert.strictEqual(e.dashboard.layout[0].settings.name, 'Urlaub');
});

// --- Hin und zurueck ---------------------------------------------------------------------------

test('Exportieren und wieder Einspielen ergibt dasselbe Dashboard', () => {
  const original = dash([
    { entity_id: 'light.kueche', card_type: 'light', x: 0, y: 0, cols: 1, rows: 1, settings: { name: 'Decke' } },
    { entity_id: 'sensor.temp', card_type: 'temperature', x: 1, y: 0, cols: 2, rows: 1, settings: { decimals: 1 } },
    { entity_id: 'clock:1', card_type: 'clock', x: 3, y: 0, cols: 1, rows: 1 }
  ]);
  const { datei } = a.exportieren(original, CARD_TYPES);
  const e = a.importieren(datei, CARD_TYPES);

  assert.strictEqual(e.ok, true, JSON.stringify(e.fehler));
  assert.deepStrictEqual(e.warnungen, [], 'nichts haette angepasst werden duerfen');
  assert.strictEqual(e.dashboard.name, 'Küche');
  assert.strictEqual(e.dashboard.layout.length, 3);
  original.layout.forEach((vorher, i) => {
    const nachher = e.dashboard.layout[i];
    assert.strictEqual(nachher.entity_id, vorher.entity_id);
    assert.strictEqual(nachher.card_type, vorher.card_type);
    assert.deepStrictEqual(
      { x: nachher.x, y: nachher.y, cols: nachher.cols, rows: nachher.rows },
      { x: vorher.x, y: vorher.y, cols: vorher.cols, rows: vorher.rows });
  });
});

test('Ein Tracker-Dashboard ueberlebt den Weg', () => {
  const { datei } = a.exportieren(dash([], { type: 'tracker', trackerEntity: 'device_tracker.katze' }), CARD_TYPES);
  const e = a.importieren(datei, CARD_TYPES);
  assert.strictEqual(e.dashboard.type, 'tracker');
  assert.strictEqual(e.dashboard.trackerEntity, 'device_tracker.katze');
});

// --- Die Karte der unteren Leiste --------------------------------------------------------------
//
// Sie sitzt nicht im Raster. Ohne eigene Kennzeichnung ginge das beim Export verloren, und
// beim Einspielen laege sie ploetzlich im Raster -- an einem Platz, den sie jemandem wegnimmt.

test('Die Leisten-Karte wird als solche exportiert', () => {
  const { datei } = a.exportieren(dash([
    { entity_id: 'clock:1', card_type: 'clock', unterleiste: true }
  ]), CARD_TYPES);
  assert.strictEqual(datei.karten[0].unten, true);
  assert.strictEqual(datei.karten[0].x, undefined, 'sie hat keinen Platz im Raster');
});

test('Sie kommt auch als Leisten-Karte zurueck', () => {
  const e = a.importieren(rein([{ entitaet: 'clock:1', art: 'clock', unten: true }]), CARD_TYPES);
  assert.strictEqual(e.ok, true, JSON.stringify(e.fehler));
  assert.strictEqual(e.dashboard.layout[0].unterleiste, true);
});

test('In die Leiste passt nur eine Karte', () => {
  const e = a.importieren(rein([
    { entitaet: 'clock:1', art: 'clock', unten: true },
    { entitaet: 'sensor.x', art: 'sensor', unten: true }
  ]), CARD_TYPES);
  assert.strictEqual(e.dashboard.layout.filter(k => k.unterleiste).length, 1);
  assert.ok(e.warnungen.some(w => w.includes('untere Leiste')), JSON.stringify(e.warnungen));
});

test('Die Leisten-Karte belegt keinen Rasterplatz', () => {
  // Sonst waere 0,0 fuer die naechste Karte blockiert.
  const e = a.importieren(rein([
    { entitaet: 'clock:1', art: 'clock', unten: true },
    { entitaet: 'light.a', art: 'light', x: 0, y: 0 }
  ]), CARD_TYPES);
  const imRaster = e.dashboard.layout.find(k => !k.unterleiste);
  assert.deepStrictEqual({ x: imRaster.x, y: imRaster.y }, { x: 0, y: 0 });
  assert.deepStrictEqual(e.warnungen, []);
});

test('Hin und zurueck bleibt sie unten', () => {
  const original = dash([
    { entity_id: 'light.a', card_type: 'light', x: 0, y: 0, cols: 1, rows: 1 },
    { entity_id: 'clock:1', card_type: 'clock', unterleiste: true, settings: { clockSeconds: true } }
  ]);
  const { datei } = a.exportieren(original, CARD_TYPES);
  const e = a.importieren(datei, CARD_TYPES);
  const unten = e.dashboard.layout.find(k => k.unterleiste);
  assert.ok(unten, 'die Leisten-Karte fehlt');
  assert.strictEqual(unten.card_type, 'clock');
  assert.strictEqual(unten.settings.clockSeconds, true);
});

test('Die Anleitung erwaehnt die untere Leiste', () => {
  // Sonst kaeme ein Sprachmodell nie darauf, dass es sie gibt.
  const { datei } = a.exportieren(dash([]), CARD_TYPES);
  assert.ok(datei._anleitung.untereLeiste, 'kein Hinweis auf die untere Leiste');
  assert.ok(datei._anleitung.untereLeiste.includes('unten'), datei._anleitung.untereLeiste);
});

// --- Der Name hat sich geaendert, das Format nicht ------------------------------------------
//
// Am 2026-09-23 wurde das Projekt von "Augsburg Wall Display" in "Hawall Eurasburg"
// umbenannt. Jede Datei, die bis dahin exportiert wurde, traegt die alte Kennung -- und liegt
// jetzt in einem Chatfenster, einer Mail oder auf einem Stick. Waere sie beim Umbenennen aus
// FORMATE_LESBAR gefallen, haette der Import "Unbekanntes Format" gemeldet: Es saehe aus, als
// waere die Datei kaputt, und nicht, als haetten wir den Namen gewechselt.

const EINE_KARTE = [{ entitaet: 'light.kueche', art: 'light', x: 0, y: 0, spalten: 1, zeilen: 1 }];

test('Eine Datei mit der alten Kennung wird weiter gelesen', () => {
  const r = a.importieren(rein(EINE_KARTE, { format: a.FORMAT_AUGSBURG }), CARD_TYPES);
  assert.strictEqual(r.ok, true, JSON.stringify(r.fehler));
});

test('Die Kennung der Vorlage bleibt lesbar', () => {
  const r = a.importieren(rein(EINE_KARTE, { format: a.FORMAT_VORLAGE }), CARD_TYPES);
  assert.strictEqual(r.ok, true, JSON.stringify(r.fehler));
});

test('Eine fremde Kennung wird weiterhin abgelehnt', () => {
  // Die Liste darf nicht zur Sammelstelle werden: Was nicht aus dieser Familie kommt, kommt
  // nicht durch.
  const r = a.importieren(rein(EINE_KARTE, { format: 'irgendwas/anderes' }), CARD_TYPES);
  assert.strictEqual(r.ok, false);
  assert.ok(r.fehler.join(' ').includes('hawall-eurasburg/dashboard'),
    'die Meldung muss die ERWARTETE Kennung nennen: ' + r.fehler.join(' '));
});

test('Exportiert wird mit der NEUEN Kennung', () => {
  assert.strictEqual(a.FORMAT, 'hawall-eurasburg/dashboard');
  assert.ok(a.FORMATE_LESBAR.includes(a.FORMAT_AUGSBURG), 'die alte Kennung fehlt in der Liste');
  assert.strictEqual(a.FORMATE_LESBAR[0], a.FORMAT,
    'die Fehlermeldung nennt die erste -- das muss die neue sein');
});
