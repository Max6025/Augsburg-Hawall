'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const k = require('../control/kiosksperren.js');
const { pruefungen } = require('../server/systemstatus.js');

const alle = (ok) => k.SPERREN.map(s => ({ name: s.name, ok }));

test('ohne gespeicherten Stand sind alle Sperren offen', () => {
  assert.strictEqual(k.offeneSperren(null).length, k.SPERREN.length);
  assert.strictEqual(k.offeneSperren({}).length, k.SPERREN.length);
});

test('was sitzt, wird nicht erneut versucht', () => {
  const nach = k.standFortschreiben({}, alle(true));
  assert.deepStrictEqual(k.offeneSperren(nach), []);
});

test('was Windows VERWEIGERT, wird auch nicht erneut versucht', () => {
  // Der Kern des Umbaus. `TaskbarDa` liess sich auf Windows 11 25H2 Build 26200 nicht
  // schreiben -- gemessen am Geraet: Der Schluessel gibt dem Benutzer Vollzugriff, ein anderer
  // Wert darin liess sich anlegen, nur dieser eine antwortet mit "nicht autorisierter Vorgang".
  // Eine Warnung, die bei jedem Start wiederkommt, liest nach dem dritten Mal niemand mehr --
  // und dann geht die echte darin unter.
  const nach = k.standFortschreiben({}, [
    { name: k.SPERREN[0].name, ok: false, unmoeglich: true, grund: 'Zugriff verweigert' }
  ]);
  assert.strictEqual(nach[k.SPERREN[0].name].ergebnis, 'nicht moeglich');
  assert.ok(!k.offeneSperren(nach).some(s => s.name === k.SPERREN[0].name));
});

test('ein einzelner Fehlschlag wird beim naechsten Start erneut versucht', () => {
  const nach = k.standFortschreiben({}, [
    { name: k.SPERREN[0].name, ok: false, grund: 'irgendein Zeitablauf' }
  ]);
  assert.strictEqual(nach[k.SPERREN[0].name].ergebnis, 'fehlgeschlagen');
  assert.ok(k.offeneSperren(nach).some(s => s.name === k.SPERREN[0].name));
});

test('ein neuer Stand versucht alles wieder', () => {
  // Sonst bekommt eine bestehende Installation eine ergaenzte Sperre nie -- der Fehler, den
  // die alte Fassung mit ihrer einen Nummer hatte.
  const nach = k.standFortschreiben({}, alle(true));
  assert.deepStrictEqual(k.offeneSperren(nach, k.STAND + 1).length, k.SPERREN.length);
});

test('EINE unmoegliche Sperre haelt die anderen nicht auf', () => {
  // Genau das war der Fehler: Ein Merker fuer alle zusammen wurde nie gesetzt, weil eine
  // Sperre nie ging -- und damit lief auch der Explorer-Neustart nie, der die uebrigen erst
  // wirksam macht. Am Geraet stand AllowEdgeSwipe=0 in der Registry und die Wischgeste ging
  // weiter.
  const ergebnisse = k.SPERREN.map((s, i) => (
    i === 0 ? { name: s.name, ok: false, unmoeglich: true, grund: 'Zugriff verweigert' }
            : { name: s.name, ok: true }
  ));
  const nach = k.standFortschreiben({}, ergebnisse);
  assert.deepStrictEqual(k.offeneSperren(nach), [], 'nichts bleibt offen');
  assert.strictEqual(k.explorerNeustartNoetig(ergebnisse), true, 'der Explorer startet neu');
});

test('der Explorer startet nur neu, wenn sich wirklich etwas geaendert hat', () => {
  assert.strictEqual(k.explorerNeustartNoetig(alle(false)), false);
  assert.strictEqual(k.explorerNeustartNoetig([]), false);
  assert.strictEqual(k.explorerNeustartNoetig([{ name: 'x', ok: true }]), true);
});

test('istUnmoeglich trennt "geht hier nicht" von "diesmal nicht"', () => {
  assert.strictEqual(k.istUnmoeglich('FEHLER: Zugriff verweigert'), true);
  assert.strictEqual(k.istUnmoeglich('ERROR: Access is denied.'), true);
  assert.strictEqual(k.istUnmoeglich('Es wurde versucht, einen nicht autorisierten Vorgang auszufuehren'), true);
  assert.strictEqual(k.istUnmoeglich('Der Vorgang wurde abgebrochen'), false);
  assert.strictEqual(k.istUnmoeglich(''), false);
  assert.strictEqual(k.istUnmoeglich(null), false);
});

// --- Was die Statusseite daraus macht -------------------------------------------------------

test('"nicht moeglich" ist KEIN offener Posten auf der Statusseite', () => {
  // Vorher stand dort dauerhaft "Stand 0 von 2 -- jeder Start versucht es erneut". Zweimal
  // falsch: Die meisten Sperren sassen, und der eine Versuch war aussichtslos.
  const nach = k.standFortschreiben({}, k.SPERREN.map((s, i) => (
    i === 0 ? { name: s.name, ok: false, unmoeglich: true, grund: 'Zugriff verweigert' }
            : { name: s.name, ok: true }
  )));
  const r = pruefungen({ sperren: k.bericht(nach) });
  const e = r.pruefungen.find(x => x.schluessel === 'sperren');
  assert.strictEqual(e.stufe, 'ok');
  assert.match(e.wert, new RegExp(`${k.SPERREN.length - 1} von ${k.SPERREN.length}`));
  assert.match(e.erklaerung, /nicht setzen/, 'und es wird trotzdem erwaehnt');
});

test('offene Sperren sind ein Hinweis und werden namentlich genannt', () => {
  const r = pruefungen({ sperren: k.bericht({}) });
  const e = r.pruefungen.find(x => x.schluessel === 'sperren');
  assert.strictEqual(e.stufe, 'hinweis');
  assert.match(e.erklaerung, new RegExp(k.SPERREN[0].name),
    '"mindestens eine" laesst niemanden wissen, welche');
});

// --- Die Verbindung zu main.js --------------------------------------------------------------

test('main.js benutzt das Modul und nicht mehr seine eigene Liste', () => {
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(/require\(['"]\.\/control\/kiosksperren/.test(quelle), 'Modul wird geladen');
  assert.ok(/kiosksperren\.offeneSperren/.test(quelle), 'es fragt, was offen ist');
  assert.ok(/kiosksperren\.standFortschreiben/.test(quelle), 'und schreibt den Stand fort');
  assert.ok(!/KIOSK_SPERREN_STAND/.test(quelle), 'die alte Sammelnummer ist weg');
  assert.ok(!/TaskbarDa/.test(quelle), 'und die unmoegliche Sperre auch');
});

test('in der Liste steht nur, was unelevert wirklich geht', () => {
  // Drei Werte sind hier schon gescheitert, jeder auf seine Art:
  //   TaskbarDa                  -- von Windows einzeln geschuetzt (25H2 Build 26200)
  //   DisableNotificationCenter  -- liegt in HKCU\Software\Policies: nur ReadKey
  //   NoWinKeys                  -- liegt in CurrentVersion\Policies: nur ReadKey
  // Ersetzt sind die beiden letzten durch control/wintasten.js und control/vordergrund.js.
  const werte = k.SPERREN.map(s => s.wert);
  for (const tot of ['TaskbarDa', 'DisableNotificationCenter', 'NoWinKeys']) {
    assert.ok(!werte.includes(tot), `${tot} laesst Windows unelevert nicht setzen`);
  }
  assert.ok(werte.includes('AllowEdgeSwipe'), 'was geht, soll auch drinstehen');
});
