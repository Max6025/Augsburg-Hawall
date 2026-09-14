// Tests fuer den Abschiedsschirm -- die Entscheidung, wann er erscheint.
//
// Der teuerste Fehler waere, dass er am ANKUNFTSTAG erscheint: Dann verabschiedet das Panel
// Gaeste, die gerade erst hereingekommen sind. Der zweitteuerste, dass er sich nicht
// wegtippen laesst und den ganzen letzten Tag ueber den Karten steht.

const test = require('node:test');
const assert = require('node:assert');
const { sollAbschiedZeigen, abschiedHinweis, hakenSchluessel, hakenSpeicherName,
  ABSCHIED_TON_VON, ABSCHIED_TON_BIS } = require('../renderer/shared/ankunftsschirm.js');

const START = new Date(2026, 8, 12, 16, 0, 0).toISOString();
const basis = (u) => Object.assign({
  aktiviert: true,
  verlauf: { mehrtaegig: true, letzterTag: true, tag: 3, gesamt: 3 },
  anzeigefenster: { start: START },
  verworfenFuer: '',
  abStunde: 0,
  ankunftSichtbar: false,
  jetzt: new Date(2026, 8, 14, 10, 0, 0)
}, u);

test('Am letzten Tag erscheint er', () => {
  assert.strictEqual(sollAbschiedZeigen(basis()), true);
});

test('Ausgeschaltet erscheint er nie', () => {
  assert.strictEqual(sollAbschiedZeigen(basis({ aktiviert: false })), false);
});

test('An jedem anderen Tag des Termins nicht', () => {
  assert.strictEqual(sollAbschiedZeigen(basis({ verlauf: { mehrtaegig: true, letzterTag: false } })), false);
});

test('Bei einem eintaegigen Termin nie', () => {
  // Dort waere der "letzte Tag" derselbe wie der Ankunftstag -- eine Verabschiedung am
  // Ankunftstag ist keine Information, sondern ein Fehler.
  assert.strictEqual(sollAbschiedZeigen(basis({ verlauf: { mehrtaegig: false, letzterTag: true } })), false);
  assert.strictEqual(sollAbschiedZeigen(basis({ verlauf: null })), false);
});

test('Ohne laufenden Termin nicht', () => {
  assert.strictEqual(sollAbschiedZeigen(basis({ anzeigefenster: null })), false);
});

test('Weggetippt gilt fuer diesen Termin', () => {
  assert.strictEqual(sollAbschiedZeigen(basis({ verworfenFuer: START })), false);
  // Ein anderer Termin hat einen anderen Beginn -- dort kommt er wieder.
  assert.strictEqual(sollAbschiedZeigen(basis({ verworfenFuer: '2026-01-01T00:00:00.000Z' })), true);
});

test('Der Ankunftsschirm hat Vorrang', () => {
  // Zwei Vollbilder uebereinander waeren ein Fehler, kein Entwurf.
  assert.strictEqual(sollAbschiedZeigen(basis({ ankunftSichtbar: true })), false);
});

test('Vor der eingestellten Stunde bleibt er weg', () => {
  const frueh = new Date(2026, 8, 14, 5, 30, 0);
  assert.strictEqual(sollAbschiedZeigen(basis({ abStunde: 7, jetzt: frueh })), false);
  assert.strictEqual(sollAbschiedZeigen(basis({ abStunde: 7, jetzt: new Date(2026, 8, 14, 7, 0, 0) })), true);
  // 0 heisst den ganzen Tag -- auch um halb sechs.
  assert.strictEqual(sollAbschiedZeigen(basis({ abStunde: 0, jetzt: frueh })), true);
});

test('Die Farben liegen im kuehlen Teil des Farbkreises', () => {
  // Wer morgens vorbeigeht, soll am Farbton erkennen, ob heute jemand kommt oder faehrt.
  // Der Ankunftsschirm nimmt den ganzen Kreis (0-360), dieser nur einen Ausschnitt.
  assert.ok(ABSCHIED_TON_VON >= 150 && ABSCHIED_TON_BIS <= 300, ABSCHIED_TON_VON + '-' + ABSCHIED_TON_BIS);
  assert.ok(ABSCHIED_TON_BIS - ABSCHIED_TON_VON >= 60, 'ein zu schmaler Ausschnitt sieht einfarbig aus');
});

// --- Testmodus ---------------------------------------------------------------------------------
//
// Wer den Schirm ansehen will, hat in aller Regel gerade keinen mehrtaegigen Termin am letzten
// Tag laufen -- sonst muesste er nicht danach fragen. Genau daran ist der Knopf beim
// Ankunftsschirm zuerst gescheitert: Er setzte nur den Verworfen-Zustand zurueck, und es
// passierte nichts.
//
// Und er endet nicht von allein: Eine Frist beantwortet "sieht das an der Wand gut aus?" nur
// fuer die ersten zehn Minuten. Wer danach hinsieht, findet den Schirm weg und weiss nicht,
// ob es an ihm oder an der Uhr lag.

test('Im Testmodus erscheint er ohne Termin', () => {
  assert.strictEqual(sollAbschiedZeigen({
    aktiviert: true, anzeigefenster: null, verlauf: null,
    testmodus: true, jetzt: new Date()
  }), true);
});

test('Der Testmodus schlaegt den falschen Tag, die Uhrzeit und das Wegtippen', () => {
  const p = {
    aktiviert: true,
    verlauf: { mehrtaegig: true, letzterTag: false },
    anzeigefenster: { start: START },
    verworfenFuer: START,
    abStunde: 23,
    testmodus: true,
    jetzt: new Date(2026, 8, 13, 3, 0, 0)
  };
  assert.strictEqual(sollAbschiedZeigen(p), true);
});

test('Im Testmodus erscheint er auch, wenn er ausgeschaltet ist', () => {
  // Man will ja sehen, ob sich das Einschalten lohnt.
  assert.strictEqual(sollAbschiedZeigen({
    aktiviert: false, anzeigefenster: null, testmodus: true, jetzt: new Date()
  }), true);
});

test('Der Testmodus laeuft nicht von allein ab', () => {
  // Dieselbe Frage in einem Jahr muss dieselbe Antwort bekommen -- der Schalter ist die
  // einzige Uhr, die hier zaehlt.
  const inEinemJahr = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  assert.strictEqual(sollAbschiedZeigen({
    aktiviert: false, anzeigefenster: null, testmodus: true, jetzt: inEinemJahr
  }), true);
});

test('Ohne Testmodus gilt der Rest unveraendert weiter', () => {
  assert.strictEqual(sollAbschiedZeigen({
    aktiviert: true, anzeigefenster: null, testmodus: false, jetzt: new Date()
  }), false);
  assert.strictEqual(sollAbschiedZeigen(basis({ testmodus: false })), true);
  // Ein fehlendes Feld darf nicht als "an" durchgehen.
  assert.strictEqual(sollAbschiedZeigen(basis({ verworfenFuer: START })), false);
});

test('Im Testmodus steht dort keine Aufforderung zum Antippen', () => {
  // Eine Wand, die zum Antippen auffordert und nicht reagiert, sieht kaputt aus -- wer
  // davorsteht, sucht den Fehler am Geraet statt in den Einstellungen.
  assert.ok(!/antippen/i.test(abschiedHinweis(true)), abschiedHinweis(true));
  assert.match(abschiedHinweis(true), /Testmodus/);
  // Und der Weg zurueck muss dort stehen, sonst sucht man ihn an der Wand.
  assert.match(abschiedHinweis(true), /Einstellungen/);
  assert.match(abschiedHinweis(false), /antippen/i);
});

// --- Abhakliste --------------------------------------------------------------------------------

test('Der Haken haengt am Text, nicht an der Position', () => {
  // Wer einen Punkt in der Mitte einfuegt, haette sonst alle Haken darunter um eins
  // verschoben -- "Saugen" waere erledigt, weil darueber eine Zeile dazugekommen ist.
  assert.strictEqual(hakenSchluessel('  Alle   Türen  verschließen '), 'alle türen verschließen');
  assert.strictEqual(hakenSchluessel('Fensterläden zu'), hakenSchluessel('fensterläden   ZU'));
  // Wird ein Punkt umformuliert, faellt sein Haken weg -- es ist dann eine andere Aufgabe.
  assert.notStrictEqual(hakenSchluessel('Fenster zu'), hakenSchluessel('Fenster kippen'));
  assert.strictEqual(hakenSchluessel(null), '');
});

test('Jeder Termin hat seine eigenen Haken', () => {
  // Die naechste Abreise faengt mit einer leeren Liste an, ohne dass jemand aufraeumt.
  const a = hakenSpeicherName('2026-09-12T16:00:00.000Z');
  const b = hakenSpeicherName('2026-10-02T16:00:00.000Z');
  assert.notStrictEqual(a, b);
  // Ohne Termin (Testmodus) ein fester Name -- Ausprobieren darf keine echte Abreise ueberschreiben.
  assert.strictEqual(hakenSpeicherName(null), hakenSpeicherName(''));
  assert.notStrictEqual(hakenSpeicherName(null), a);
});
