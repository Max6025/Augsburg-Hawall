// Tests fuer die Kalibrierung der Tore.
//
// Gemessen wird beim ersten Durchlauf: von "faehrt auf" bis "offen", von "faehrt zu" bis "zu".
// Danach laeuft die Animation so lange wie das Tor. Was hier schiefgeht, faellt nicht auf --
// die Karte sieht weiter richtig aus, nur der Fluegel steht an der falschen Stelle. Deshalb
// liegt die ganze Rechnung in reinen Funktionen.

const test = require('node:test');
const assert = require('node:assert');
const Z = require('../control/torzeiten.js');
const R = require('../renderer/shared/dashboard-render.js');

const S = 1000;

// --- Messen ---------------------------------------------------------------------------------

test('Von "faehrt auf" nach "offen" ergibt die Oeffnungszeit', () => {
  const r = Z.messen({ vorher: 'opening', vorherSeit: 0, jetzt: 'open', jetztZeit: 18 * S, bisher: {} });
  assert.strictEqual(r.oeffnen, 18);
});

test('Von "faehrt zu" nach "zu" ergibt die Schliesszeit', () => {
  const r = Z.messen({ vorher: 'closing', vorherSeit: 0, jetzt: 'closed', jetztZeit: 21.4 * S, bisher: {} });
  assert.strictEqual(r.schliessen, 21.4);
});

test('Wie lange es offen stand, wird auch gemerkt', () => {
  // Beantwortet die Frage, die man sich beim Blick auf die Karte als naechstes stellt.
  const r = Z.messen({ vorher: 'open', vorherSeit: 0, jetzt: 'closing', jetztZeit: 300 * S, bisher: {} });
  assert.strictEqual(r.offen, 300);
});

test('Eine bestehende Messung bleibt stehen, wenn die andere Richtung dazukommt', () => {
  const r = Z.messen({ vorher: 'closing', vorherSeit: 0, jetzt: 'closed', jetztZeit: 20 * S, bisher: { oeffnen: 18 } });
  assert.strictEqual(r.oeffnen, 18);
  assert.strictEqual(r.schliessen, 20);
});

test('Unglaubhafte Fahrzeiten werden verworfen', () => {
  // Ein Tor, das laut Messung vier Stunden zum Oeffnen braucht, hat nicht vier Stunden
  // gebraucht -- da ist eine Meldung verloren gegangen oder der Server wurde neu gestartet.
  // So ein Wert wuerde die Animation fuer immer unbrauchbar machen.
  assert.strictEqual(Z.messen({ vorher: 'opening', vorherSeit: 0, jetzt: 'open', jetztZeit: 4 * 3600 * S, bisher: {} }), null);
  assert.strictEqual(Z.messen({ vorher: 'opening', vorherSeit: 0, jetzt: 'open', jetztZeit: 0.4 * S, bisher: {} }), null);
});

test('Ein Wechsel ohne vorigen Zustand lehrt nichts', () => {
  // Direkt nach dem Start des Servers ist der vorige Zustand unbekannt -- dann darf nicht
  // gerechnet werden, sonst misst man die Laufzeit des Servers statt die des Tores.
  assert.strictEqual(Z.messen({ vorher: '', vorherSeit: 0, jetzt: 'open', jetztZeit: 9 * S, bisher: {} }), null);
  assert.strictEqual(Z.messen({ vorher: 'opening', vorherSeit: 0, jetzt: 'open', jetztZeit: 0, bisher: {} }), null);
});

test('Uninteressante Wechsel aendern nichts', () => {
  assert.strictEqual(Z.messen({ vorher: 'closed', vorherSeit: 0, jetzt: 'opening', jetztZeit: 5 * S, bisher: {} }), null);
  assert.strictEqual(Z.messen({ vorher: 'open', vorherSeit: 0, jetzt: 'open', jetztZeit: 5 * S, bisher: {} }), null);
});

// --- Der Beobachter --------------------------------------------------------------------------

test('Ein voller Durchlauf misst beide Richtungen', () => {
  let gespeichert = {};
  const b = new Z.TorBeobachter({ laden: () => gespeichert, speichern: (a) => { gespeichert = a; } });
  const id = 'cover.einfahrt';
  b.gemeldet(id, 'closed', 0);
  b.gemeldet(id, 'opening', 1 * S);
  b.gemeldet(id, 'open', 19 * S);        // 18 s auf
  b.gemeldet(id, 'closing', 79 * S);     // 60 s offen
  b.gemeldet(id, 'closed', 100 * S);     // 21 s zu
  assert.deepStrictEqual(
    { oeffnen: gespeichert[id].oeffnen, schliessen: gespeichert[id].schliessen, offen: gespeichert[id].offen },
    { oeffnen: 18, schliessen: 21, offen: 60 }
  );
});

test('Nur Cover werden beobachtet', () => {
  // Eine Lampe, die "opening" meldet, gibt es nicht -- aber eine Automation koennte alles
  // Moegliche schicken, und daraus eine Torfahrt zu lernen waere Unsinn.
  let gespeichert = {};
  const b = new Z.TorBeobachter({ laden: () => gespeichert, speichern: (a) => { gespeichert = a; } });
  b.gemeldet('light.flur', 'opening', 0);
  assert.strictEqual(b.gemeldet('light.flur', 'open', 10 * S), false);
  assert.deepStrictEqual(gespeichert, {});
});

test('Derselbe Zustand zweimal aendert nichts', () => {
  // Home Assistant meldet auch dann, wenn sich nur ein Attribut geaendert hat.
  let gespeichert = {};
  const b = new Z.TorBeobachter({ laden: () => gespeichert, speichern: (a) => { gespeichert = a; } });
  b.gemeldet('cover.tor', 'opening', 0);
  assert.strictEqual(b.gemeldet('cover.tor', 'opening', 5 * S), false);
  assert.strictEqual(b.gemeldet('cover.tor', 'open', 18 * S), true);
  assert.strictEqual(gespeichert['cover.tor'].oeffnen, 18);
});

// --- Die Animation ---------------------------------------------------------------------------

test('Ohne Messung bleibt es bei der Schleife', () => {
  const a = R.torAnimation('opening', {}, new Date().toISOString(), Date.now());
  assert.strictEqual(a.echtzeit, false);
  assert.strictEqual(a.dauer, R.TOR_TAKT);
  assert.strictEqual(a.ueberfaellig, false);
});

test('Mit Messung laeuft sie so lange wie das Tor und faengt beim Ist-Stand an', () => {
  // Genau das ist der Gewinn: nicht "es bewegt sich", sondern "es ist halb offen".
  const jetzt = 1000000;
  const seit = new Date(jetzt - 9000).toISOString();   // faehrt seit 9 s
  const a = R.torAnimation('opening', { oeffnen: 18 }, seit, jetzt);
  assert.strictEqual(a.echtzeit, true);
  assert.strictEqual(a.dauer, 18);
  assert.strictEqual(a.versatz, '-9.00s');
});

test('Dauert die Fahrt laenger als gemessen, ist sie ueberfaellig', () => {
  // Das Tor klemmt, etwas steht im Weg, oder die Meldung "offen" ist verloren gegangen.
  const jetzt = 1000000;
  const knapp = R.torAnimation('opening', { oeffnen: 18 }, new Date(jetzt - 22000).toISOString(), jetzt);
  assert.strictEqual(knapp.ueberfaellig, false, 'ein Drittel Luft muss bleiben');
  const zuLang = R.torAnimation('opening', { oeffnen: 18 }, new Date(jetzt - 40000).toISOString(), jetzt);
  assert.strictEqual(zuLang.ueberfaellig, true);
});

test('Ein kurzes Tor bekommt Sekunden statt Prozent Toleranz', () => {
  // Bei drei Sekunden Fahrzeit waeren ein Drittel nur eine Sekunde -- das reisst jeder
  // Messfehler. Deshalb gilt immer mindestens eine feste Reserve.
  const jetzt = 1000000;
  const a = R.torAnimation('closing', { schliessen: 3 }, new Date(jetzt - 5500).toISOString(), jetzt);
  assert.strictEqual(a.ueberfaellig, false);
});

test('Steht das Tor still, gibt es nichts zu animieren', () => {
  ['open', 'closed', 'unavailable', ''].forEach(z => {
    assert.strictEqual(R.torAnimation(z, { oeffnen: 18 }, new Date().toISOString()).faehrt, false, z);
  });
});

test('Ein unbrauchbares last_changed faellt auf die Schleife zurueck', () => {
  // Lieber eine Schleife als ein Fluegel, der an einer erfundenen Stelle steht.
  const a = R.torAnimation('opening', { oeffnen: 18 }, 'kein Datum', Date.now());
  assert.strictEqual(a.echtzeit, false);
});

test('Ueberfaellig faerbt die Karte rot -- und zwar dort, wo es ankommt', () => {
  // Der Akzent wird direkt am Element gesetzt und schlaegt jede CSS-Regel. Eine Klasse allein
  // waere wirkungslos gewesen, und die Karte haette bernsteinfarben weitergemacht, als sei
  // nichts.
  assert.strictEqual(R.TOR_ROT, '#ff4444');
  assert.notStrictEqual(R.TOR_ZUSTAENDE.opening.akzent, R.TOR_ROT);
});

// --- Dauer-Auf --------------------------------------------------------------------------------
//
// Viele Torsteuerungen kennen einen Zustand "bleibt offen". Dass das Tor dann nicht zufaehrt,
// ist gewollt -- eine Warnung waere dort ein Fehlalarm, und nach dem dritten Fehlalarm glaubt
// man der Warnung auch dann nicht mehr, wenn wirklich etwas klemmt.

test('Der Dauer-Auf-Melder wird an seinem Zustand erkannt', () => {
  const an = { 'light.dauerauf': { state: 'on' } };
  assert.strictEqual(R.torDauerauf({ torDaueraufEntity: 'light.dauerauf' }, an), true);
  // Manche Entitaeten benennen ihren Zustand anders.
  assert.strictEqual(R.torDauerauf({ torDaueraufEntity: 'x' }, { x: { state: 'open' } }), true);
  assert.strictEqual(R.torDauerauf({ torDaueraufEntity: 'x' }, { x: { state: 'off' } }), false);
});

test('Ohne Melder gibt es kein Dauer-Auf', () => {
  assert.strictEqual(R.torDauerauf({}, { 'light.x': { state: 'on' } }), false);
  assert.strictEqual(R.torDauerauf({ torDaueraufEntity: 'light.x' }, {}), false);
  assert.strictEqual(R.torDauerauf(null, null), false);
});

test('Ein unerreichbarer Melder schaltet die Warnung NICHT ab', () => {
  // Sonst genuegte eine kaputte Entitaet, um die Warnung fuer immer stillzulegen -- und
  // niemand wuesste, warum das Tor nie mehr meldet, dass es klemmt.
  ['unavailable', 'unknown', ''].forEach(z => {
    assert.strictEqual(R.torDauerauf({ torDaueraufEntity: 'x' }, { x: { state: z } }), false, z);
  });
});

test('Bei Dauer-Auf gibt es keine Ueberfaelligkeit', () => {
  const jetzt = 1000000;
  const lange = new Date(jetzt - 120000).toISOString();   // faehrt angeblich seit zwei Minuten
  assert.strictEqual(R.torAnimation('opening', { oeffnen: 18 }, lange, jetzt, false).ueberfaellig, true);
  assert.strictEqual(R.torAnimation('opening', { oeffnen: 18 }, lange, jetzt, true).ueberfaellig, false);
});

test('Dauer-Auf aendert nichts an Dauer und Startversatz', () => {
  // Faehrt das Tor gerade wirklich, soll die Animation trotzdem stimmen -- nur die Warnung
  // faellt weg.
  const jetzt = 1000000;
  const seit = new Date(jetzt - 9000).toISOString();
  const ohne = R.torAnimation('opening', { oeffnen: 18 }, seit, jetzt, false);
  const mit = R.torAnimation('opening', { oeffnen: 18 }, seit, jetzt, true);
  assert.strictEqual(mit.dauer, ohne.dauer);
  assert.strictEqual(mit.versatz, ohne.versatz);
});
