const test = require('node:test');
const assert = require('node:assert');
const B = require('../renderer/shared/bildschirmschoner.js');

// --- sollSchonen ------------------------------------------------------------------------------
//
// Der Kern der Umkehr gegenueber der Vorlage: Der Schoner ist der Ruhezustand, nicht die
// Ausnahme. Wer diese Tests bricht, hat die Richtung gedreht.

test('Ohne bekannte Bedienung wird geschont -- das ist der Ruhezustand', () => {
  // Der wichtigste Test der Datei. Beim Start ist noch nichts bedient worden, und genau dann
  // soll der Schoner liegen. Waere die Antwort false, zeigte das Geraet nach jedem Neustart
  // stundenlang ein Dashboard, das niemand angefordert hat.
  assert.strictEqual(B.sollSchonen({ aktiviert: true, letzteBedienung: 0 }), true);
  assert.strictEqual(B.sollSchonen({ aktiviert: true, letzteBedienung: null }), true);
  assert.strictEqual(B.sollSchonen({ aktiviert: true }), true);
});

test('Frisch bedient heisst Dashboard', () => {
  const jetzt = new Date(2026, 0, 1, 12, 0, 0);
  assert.strictEqual(B.sollSchonen({
    aktiviert: true, letzteBedienung: jetzt.getTime() - 30000, minuten: 3, jetzt
  }), false);
});

test('Nach Ablauf der Frist legt er sich wieder hin', () => {
  const jetzt = new Date(2026, 0, 1, 12, 0, 0);
  assert.strictEqual(B.sollSchonen({
    aktiviert: true, letzteBedienung: jetzt.getTime() - 3 * 60000, minuten: 3, jetzt
  }), true, 'genau auf der Frist gehoert schon zum Schonen');
  assert.strictEqual(B.sollSchonen({
    aktiviert: true, letzteBedienung: jetzt.getTime() - 179000, minuten: 3, jetzt
  }), false, 'eine Sekunde davor noch nicht');
});

test('Ohne Minutenangabe gilt die Vorgabe', () => {
  const jetzt = new Date(2026, 0, 1, 12, 0, 0);
  const knappDavor = jetzt.getTime() - (B.SCHONER_MINUTEN_VORGABE * 60000 - 1000);
  const knappDanach = jetzt.getTime() - (B.SCHONER_MINUTEN_VORGABE * 60000 + 1000);
  assert.strictEqual(B.sollSchonen({ aktiviert: true, letzteBedienung: knappDavor, jetzt }), false);
  assert.strictEqual(B.sollSchonen({ aktiviert: true, letzteBedienung: knappDanach, jetzt }), true);
});

test('Abgeschaltet heisst abgeschaltet -- auch ohne bekannte Bedienung', () => {
  assert.strictEqual(B.sollSchonen({ aktiviert: false, letzteBedienung: 0 }), false);
  assert.strictEqual(B.sollSchonen(null), false);
});

test('Eine Bedienung aus der ZUKUNFT verlaengert die Frist nicht auf Stunden', () => {
  // Uhrumstellung oder ein Zeitsprung nach dem Aufwachen. Ohne diese Regel bliebe das
  // Dashboard stehen, bis die Systemuhr die falsche Zeit eingeholt hat.
  const jetzt = new Date(2026, 0, 1, 12, 0, 0);
  assert.strictEqual(B.sollSchonen({
    aktiviert: true, letzteBedienung: jetzt.getTime() + 3600000, minuten: 3, jetzt
  }), false);
});

// --- Helligkeit -------------------------------------------------------------------------------

test('Die Helligkeit bleibt in lesbaren Grenzen', () => {
  // Nicht bis null: Ein Bildschirm, der sich nicht ablesen laesst, ist von einem kaputten
  // nicht zu unterscheiden.
  assert.strictEqual(B.schonerHelligkeit(0), 5);
  assert.strictEqual(B.schonerHelligkeit(-40), 5);
  assert.strictEqual(B.schonerHelligkeit(250), 100);
  assert.strictEqual(B.schonerHelligkeit(42), 42);
  assert.strictEqual(B.schonerHelligkeit(41.6), 42);
});

test('Ein fehlender Wert ergibt die Vorgabe, nicht null', () => {
  // Number(null) ist 0, nicht NaN -- ohne das Aussortieren stuende der Schoner auf der
  // dunkelsten Stufe, sobald die Einstellung fehlt.
  assert.strictEqual(B.schonerHelligkeit(undefined), B.SCHONER_HELLIGKEIT_VORGABE);
  assert.strictEqual(B.schonerHelligkeit('keine Zahl'), B.SCHONER_HELLIGKEIT_VORGABE);
});

// --- Hintergrund ------------------------------------------------------------------------------

test('Ohne hochgeladenes Bild bleibt es bei den Wolken', () => {
  // Sonst stuende dort eine leere Flaeche, und wer sie sieht, sucht den Fehler am Geraet
  // statt in einer Einstellung, die er selbst gesetzt hat.
  assert.strictEqual(B.hintergrundArt('bild', false), 'wolken');
  assert.strictEqual(B.hintergrundArt('bild', true), 'bild');
});

test('Alles Unbekannte ist Wolken', () => {
  assert.strictEqual(B.hintergrundArt('', true), 'wolken');
  assert.strictEqual(B.hintergrundArt(undefined, true), 'wolken');
  assert.strictEqual(B.hintergrundArt('tippfehler', true), 'wolken');
});
