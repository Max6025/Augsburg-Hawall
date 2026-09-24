'use strict';

// Was der Schoner beim Hinlegen aufraeumt.
//
// Das Problem, das das loest: Wer abends auf dem Unterdashboard "Heizung" nachgesehen hat,
// findet morgens das Unterdashboard "Heizung" vor -- und muss erst auf "zurueck" tippen, bevor
// er das sieht, was er sehen wollte. Auf einem Tracker-Dashboard zweimal, weil dort noch die
// Verlaufslinie der letzten Woche liegt und die Karte auf die ganze Woche gezoomt ist.
//
// Geprueft wird der QUELLTEXT: dashboard.html ist ein Renderer-Skript ohne Modulausgang, die
// Funktionen sind von hier nicht aufrufbar. Was sich pruefen laesst, sind die Eigenschaften, an
// denen es haengt -- vor allem die REIHENFOLGE.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const QUELLE = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dashboard.html'), 'utf8');

test('der Schoner raeumt beim Hinlegen auf', () => {
  assert.match(QUELLE, /function hinterDemSchonerAufraeumen\(/, 'die Funktion fehlt');
  assert.match(QUELLE, /\n    hinterDemSchonerAufraeumen\(\);/, 'sie wird nicht gerufen');
});

test('ERST zeigen, DANN aufraeumen', () => {
  // Umgekehrt saehe man den Wechsel: einen Augenblick das Hauptdashboard, dann den Schoner.
  // Der Schoner liegt auf z-index 9990 und deckt alles ab -- hinter ihm ist der Wechsel
  // unsichtbar, davor nicht.
  const i = QUELLE.indexOf('schoner.zeigen();');
  const j = QUELLE.indexOf('hinterDemSchonerAufraeumen();');
  assert.ok(i > 0 && j > 0, 'beide Aufrufe muessen vorkommen');
  assert.ok(i < j, 'schoner.zeigen() muss VOR dem Aufraeumen stehen');
});

test('aufgeraeumt wird beides: Dashboard und Verlauf', () => {
  const i = QUELLE.indexOf('function hinterDemSchonerAufraeumen');
  const block = QUELLE.slice(i, QUELLE.indexOf('\n}', i));
  assert.match(block, /trackerVerlaufAus\(\)/, 'der Verlauf muss weg');
  assert.match(block, /navigateTo\('main'\)/, 'und es muss aufs Hauptdashboard zurueckgehen');
  // Der Verlauf ZUERST: Er gehoert zur Tracker-Ansicht, die gleich nicht mehr aktiv ist.
  assert.ok(block.indexOf('trackerVerlaufAus') < block.indexOf("navigateTo('main')"),
    'erst den Verlauf, dann wechseln');
});

test('nur wechseln, wenn man nicht schon auf dem Hauptdashboard ist', () => {
  const i = QUELLE.indexOf('function hinterDemSchonerAufraeumen');
  const block = QUELLE.slice(i, QUELLE.indexOf('\n}', i));
  assert.match(block, /currentDashboardId !== 'main'/,
    'ein navigateTo auf das Dashboard, das schon da ist, ist ein Neuaufbau ohne Anlass');
});

test('trackerVerlaufAus legt KEINE Landkarte an', () => {
  // Von aussen gerufen (Schonerbeginn) wuerde ensureTrackerMap() sonst eine Leaflet-Karte in
  // einem unsichtbaren Container erzeugen, nur um nichts daraus zu entfernen -- bei jedem
  // Hinlegen, auf einem Geraet, das nie ein Tracker-Dashboard gesehen hat.
  const i = QUELLE.indexOf('function trackerVerlaufAus');
  const block = QUELLE.slice(i, QUELLE.indexOf('\n}', i));
  assert.match(block, /if \(!trackerMapInstance\) return;/, 'die Wache fehlt');
  assert.ok(block.indexOf('if (!trackerMapInstance) return;') < block.indexOf('ensureTrackerMap()'),
    'die Wache muss VOR ensureTrackerMap() stehen');
});

test('navigateTo setzt letzteBedienung NICHT', () => {
  // Sonst wuerde der Schoner sich im selben Augenblick wieder verbergen, in dem er sich
  // hinlegt: Das Panel haette sich selbst geweckt, und zwar jede Nacht.
  const i = QUELLE.indexOf('async function navigateTo');
  const block = QUELLE.slice(i, QUELLE.indexOf('\n}', i));
  assert.ok(!/letzteBedienung\s*=/.test(block),
    'navigateTo darf die Bedienzeit nicht anfassen -- nur letzteBedienungAufUnterdashboard');
  assert.match(block, /letzteBedienungAufUnterdashboard = Date\.now\(\)/,
    'die andere Uhr gehoert dagegen gesetzt');
});

test('die zeitgesteuerte Rueckkehr bleibt eine eigene Entscheidung', () => {
  // `rueckkehrSekunden` beantwortet eine andere Frage: Wie lange darf ein Unterdashboard
  // stehen bleiben, WAEHREND jemand davorsteht? Wer dort 0 eintraegt, will nicht
  // weggeschaltet werden, solange er hinsieht -- beim liegenden Schoner sieht niemand hin.
  const i = QUELLE.indexOf('function hinterDemSchonerAufraeumen');
  const block = QUELLE.slice(i, QUELLE.indexOf('\n}', i));
  assert.ok(!/rueckkehrSekunden/.test(block),
    'das Aufraeumen des Schoners haengt nicht an dieser Einstellung');
  // Und umgekehrt: rueckkehrPruefen steigt beim liegenden Schoner weiter aus.
  const j = QUELLE.indexOf('function rueckkehrPruefen');
  const rp = QUELLE.slice(j, QUELLE.indexOf('\n}', j));
  assert.match(rp, /schoner\.istSichtbar\(\)\) return;/,
    'zwei Stellen, die gleichzeitig zurueckwechseln, waeren ein Wettlauf');
});
