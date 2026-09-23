'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Die Liste der Entitaeten, von denen ein Layout abhaengt, muss an EINER Stelle stehen.
 *
 * Der Fehler, der das ausgeloest hat: `letzteAnzeigeEntitaeten` kannte die fremden Entitaeten
 * der Energie-Karte, `zustandsSignatur` nicht. Eine Aenderung am Netzbezug kam damit durch die
 * Live-Verbindung an, aenderte die Signatur aber nicht -- und ueber den Abruf-Takt wurde die
 * Karte erst neu gezeichnet, wenn zufaellig eine ANDERE Karte etwas meldete. Minuten.
 *
 * Geprueft wird der QUELLTEXT, weil dashboard.html ein Renderer-Skript ohne Modulausgang ist:
 * Die Funktion laesst sich hier nicht aufrufen. Was sich pruefen laesst, ist die Eigenschaft,
 * die den Fehler verhindert -- dass es nur eine Liste gibt und beide Seiten sie benutzen.
 */
const QUELLE = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dashboard.html'), 'utf8');

test('es gibt kartenEntitaeten(), und beide Seiten benutzen es', () => {
  assert.ok(/function kartenEntitaeten\(/.test(QUELLE), 'die Funktion fehlt');
  assert.ok(/letzteAnzeigeEntitaeten = kartenEntitaeten\(/.test(QUELLE),
    'der Live-Filter muss daraus kommen');
  assert.ok(/kartenEntitaeten\(layout\)\]\.sort\(\)/.test(QUELLE),
    'und die Signatur auch -- sonst laufen die beiden wieder auseinander');
});

test('die Signatur baut NICHT mehr direkt auf layout.map', () => {
  // So sah der Fehler aus: layout.map(e => ... e.entity_id ...) kennt nur die Haupt-Entitaet
  // einer Karte.
  const i = QUELLE.indexOf('function zustandsSignatur');
  const block = QUELLE.slice(i, i + 700);
  assert.ok(!/layout\.map\(/.test(block),
    'die Signatur darf nicht wieder nur ueber die Layout-Einträge laufen');
});

test('jedes Einstellungsfeld mit einer Entität steht in kartenEntitaeten', () => {
  // Der eigentliche Schutz: Wer der Energie-Karte ein Feld hinzufuegt und es hier vergisst,
  // baut denselben Fehler neu. Verglichen wird gegen den Editor, der die Felder schreibt.
  const editor = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'setup', 'editor.js'), 'utf8');
  const i = QUELLE.indexOf('function kartenEntitaeten');
  const block = QUELLE.slice(i, QUELLE.indexOf('function zustandsSignatur'));

  const felder = new Set();
  for (const m of editor.matchAll(/settings\.(\w*Entity)\b/g)) felder.add(m[1]);
  assert.ok(felder.size >= 5, `zu wenige Felder gefunden (${felder.size}) -- stimmt das Muster noch?`);

  const fehlen = [...felder].filter(f => !block.includes(`'${f}'`));
  assert.deepStrictEqual(fehlen, [],
    `Diese Entitäts-Felder schreibt der Editor, aber kartenEntitaeten kennt sie nicht: ${fehlen.join(', ')}`);
});

test('der Hausverbrauchs-Sensor wird durchgereicht und geprueft', () => {
  assert.ok(/home: statesById\[einst\.energyHomeEntity\]/.test(QUELLE),
    'ohne das kommt der Wert nie bei der Karte an');
  const render = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'dashboard-render.js'), 'utf8');
  assert.ok(/hausGemessen/.test(render), 'die Karte muss ihn auswerten');
  assert.ok(/\['Hausverbrauch', en\.home\]/.test(render),
    'und er gehoert in die Einheiten-Pruefung: ein kWh-Zaehler hier waere derselbe Fehler wie bei den anderen');
});
