'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { Vordergrund, ABSTAND_MS, HAEUFUNG, HAEUFUNG_FENSTER_MS, RUHE_MS } = require('../control/vordergrund.js');

function bauen() {
  const zeilen = [];
  let uhr = 1000;
  const v = new Vordergrund({ jetzt: () => uhr, log: (s, m) => zeilen.push(m) });
  return { v, zeilen, vor: (ms) => { uhr += ms; }, jetzt: () => uhr };
}

test('verlorener Fokus wird zurueckgeholt', () => {
  const { v } = bauen();
  const e = v.verloren({ taskleisteBis: 0 });
  assert.strictEqual(e.holen, true);
  assert.strictEqual(e.verzoegerung, ABSTAND_MS);
});

test('waehrend einer Wartung NICHT', () => {
  // Dann ist die Taskleiste absichtlich da, und wer davor steht, will an Windows. Ihm den
  // Fokus wegzunehmen waere das Gegenteil von hilfreich.
  const { v, jetzt } = bauen();
  const e = v.verloren({ taskleisteBis: jetzt() + 60000 });
  assert.strictEqual(e.holen, false);
  assert.strictEqual(e.grund, 'wartung');
});

test('ohne Zustand wird zurueckgeholt', () => {
  // Beim Start ist noch kein Takt gelaufen. Die Taskleiste ist dann versteckt, also gilt der
  // Normalfall -- und nicht "im Zweifel nichts tun".
  assert.strictEqual(bauen().v.verloren(null).holen, true);
});

test('eine Haeufung fuehrt zu Ruhe, nicht zu einem Dauerkampf', () => {
  // Laesst sich das Fenster nicht nach vorne holen -- auf dem Sperrbildschirm zum Beispiel --,
  // wuerde der Rueckholer endlos gegen Windows anrennen und dabei das Geraet beschaeftigen.
  const { v, zeilen, vor } = bauen();
  let geholt = 0;
  for (let i = 0; i <= HAEUFUNG; i++) {
    if (v.verloren({}).holen) geholt++;
    vor(100);
  }
  assert.strictEqual(geholt, HAEUFUNG, `${HAEUFUNG} Versuche, dann Schluss`);
  assert.strictEqual(v.verloren({}).holen, false);
  assert.strictEqual(zeilen.length, 1, 'und genau eine Zeile im Protokoll, nicht eine pro Versuch');
  assert.match(zeilen[0], /Sperrbildschirm/, 'samt der wahrscheinlichsten Erklaerung');
});

test('nach der Ruhezeit wird es wieder versucht', () => {
  const { v, vor } = bauen();
  for (let i = 0; i <= HAEUFUNG; i++) { v.verloren({}); vor(100); }
  assert.strictEqual(v.verloren({}).holen, false);
  vor(RUHE_MS + 1000);
  assert.strictEqual(v.verloren({}).holen, true);
});

test('vereinzelte Fokusverluste ueber die Zeit sind keine Haeufung', () => {
  // Sonst geht der Rueckholer nach einem langen, ruhigen Tag in die Bremse, obwohl nie etwas
  // schiefgegangen ist.
  const { v, vor, zeilen } = bauen();
  for (let i = 0; i < 20; i++) {
    assert.strictEqual(v.verloren({}).holen, true, `Versuch ${i + 1}`);
    vor(HAEUFUNG_FENSTER_MS + 100);
  }
  assert.strictEqual(zeilen.length, 0);
});

test('ein geglueckter Rueckholvorgang setzt den Zaehler zurueck', () => {
  const { v, vor } = bauen();
  for (let i = 0; i < HAEUFUNG - 1; i++) { v.verloren({}); vor(10); }
  v.geglueckt();
  for (let i = 0; i < HAEUFUNG - 1; i++) {
    assert.strictEqual(v.verloren({}).holen, true, 'nach dem Erfolg zaehlt es von vorne');
    vor(10);
  }
});

test('der ERSTE Erfolg wird protokolliert, die folgenden nicht', () => {
  // Ohne diese eine Zeile gibt es keinen Beleg, dass der Rueckholer jemals etwas tut -- er
  // arbeitet lautlos, und lautlos ist von "gar nicht" nicht zu unterscheiden. Eine Zeile pro
  // Vorgang waere Laerm: Beim Bedienen von Windows passiert es dauernd.
  const { v, zeilen } = bauen();
  v.geglueckt();
  assert.strictEqual(zeilen.length, 1);
  assert.match(zeilen[0], /zurueckgeholt/);
  for (let i = 0; i < 20; i++) v.geglueckt();
  assert.strictEqual(zeilen.length, 1, 'danach still');
  assert.strictEqual(v.zurueckgeholt, 21, 'gezaehlt wird trotzdem');
});

test('main.js haengt den Rueckholer an blur und respektiert die Wartung', () => {
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(/require\(['"]\.\/control\/vordergrund/.test(quelle), 'Modul wird geladen');
  assert.ok(/on\('blur'/.test(quelle), 'an blur gehaengt -- sonst passiert nie etwas');
  assert.ok(/vordergrund\.verloren/.test(quelle), 'und es fragt das Modul, statt selbst zu entscheiden');
  assert.ok(/vordergrund\.geglueckt/.test(quelle), 'Erfolg wird zurueckgemeldet');
});
