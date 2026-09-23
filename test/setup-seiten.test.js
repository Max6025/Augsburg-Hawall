'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Jede ID, die ein Skript ruft, muss es in seiner Seite geben.
 *
 * Der Grund steht in CLAUDE.md und ist hier zweimal teuer geworden: `$('x')` liefert `null`,
 * der Zugriff darauf wirft, und der Fehler bricht den GANZEN Aufbau ab -- nicht nur die eine
 * Zeile. Auf der Einstellungsseite heisst das: Sie laesst sich nicht mehr bedienen, und zu
 * sehen ist nichts, was nach einem Fehler aussieht. Ein Tippfehler in einer ID genuegt dafuer.
 */
// Nicht von Hand aufgezaehlt: Eine Liste, die beim naechsten Seitenzusatz nicht nachgezogen
// wird, prueft die neue Seite stillschweigend nicht -- also genau die, an der gerade gearbeitet
// wurde. Gepaart wird nach dem Dateinamen, und das Skript muss wirklich eingebunden sein.
function seitenPaare(ordner) {
  return fs.readdirSync(ordner)
    .filter(d => d.endsWith('.html'))
    .map(seite => [seite, seite.replace(/\.html$/, '.js')])
    .filter(([seite, skript]) => {
      if (!fs.existsSync(path.join(ordner, skript))) return false;
      return fs.readFileSync(path.join(ordner, seite), 'utf8').includes(skript);
    });
}

const ORDNER = path.join(__dirname, '..', 'renderer', 'setup');

const PAARE = seitenPaare(ORDNER);

test('es gibt ueberhaupt Seiten zu pruefen', () => {
  // Ohne das ist ein kaputtes Suchmuster oben ein gruener Testlauf ueber null Seiten.
  assert.ok(PAARE.length >= 5, `nur ${PAARE.length} Seiten gefunden -- stimmt die Paarung noch?`);
});

for (const [seite, skript] of PAARE) {
  test(`${skript} ruft nur IDs, die es in ${seite} gibt`, () => {
    const html = fs.readFileSync(path.join(ORDNER, seite), 'utf8');
    const js = fs.readFileSync(path.join(ORDNER, skript), 'utf8');
    // Auch die IDs, die das Skript SELBST erzeugt (der Editor baut seine Einstellungsfelder
    // vollstaendig in JS zusammen, siehe openSettings() in CLAUDE.md). Ohne das waere dieser
    // Test auf dem Editor eine Wand aus falschen Treffern -- und ein Test, dem man nicht
    // glaubt, wird abgeschaltet statt gelesen.
    const vorhanden = new Set([
      ...[...html.matchAll(/id=["']([^"'${}]+)["']/g)].map(m => m[1]),
      ...[...js.matchAll(/id=["']([^"'${}]+)["']/g)].map(m => m[1]),
      ...[...js.matchAll(/id=([A-Za-z0-9_-]+)["'\s]/g)].map(m => m[1])
    ]);
    const gerufen = new Set(
      [...js.matchAll(/\$\('([^']+)'\)|getElementById\('([^']+)'\)/g)].map(m => m[1] || m[2])
    );
    const fehlt = [...gerufen].filter(i => !vorhanden.has(i));
    assert.deepStrictEqual(fehlt, [],
      `Diese IDs ruft ${skript}, aber ${seite} hat sie nicht: ${fehlt.join(', ')}`);
  });
}

test('die Einstellungsseite gibt den Zugriffsschluessel nicht zurueck in das Feld', () => {
  // Er kommt bewusst nicht aus /api/config heraus (nur "gesetzt: ja/nein"). Wuerde die Seite
  // ihn doch irgendwo einsetzen, waere das der Weg, auf dem er wieder herauskaeme.
  const js = fs.readFileSync(path.join(ORDNER, 'theme.js'), 'utf8');
  assert.ok(!/wartungsmelderSchluessel'\)\.value\s*=/.test(js),
    'das Feld darf nie gefuellt werden -- leer heisst "unveraendert"');
});
