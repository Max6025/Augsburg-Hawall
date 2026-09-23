'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const w = require('../control/wintasten.js');
const k = require('../control/kiosksperren.js');

test('bei versteckter Taskleiste wird geschluckt, bei Wartung nicht', () => {
  assert.strictEqual(w.sollGreifen({ taskleisteBis: 0 }), true);
  assert.strictEqual(w.sollGreifen(null), true, 'ohne Zustand gilt der Normalfall');
  assert.strictEqual(w.sollGreifen({ taskleisteBis: Date.now() + 60000 }), false,
    'wer vor dem Geraet steht, braucht Win+E');
});

test('anpassen fordert jede Kombination an und meldet, was Windows behaelt', () => {
  const gegriffen = [];
  const r = w.anpassen({}, {
    aktiv: false,
    greifen: (t) => { gegriffen.push(t); return t !== 'Super+M'; },
    freigeben: () => {}
  });
  assert.strictEqual(gegriffen.length, w.KOMBINATIONEN.length);
  assert.deepStrictEqual(r.misslungen, ['Super+M'],
    'ein stilles false ist kein Fehlerbericht -- das muss ins Protokoll');
  assert.strictEqual(r.aktiv, true);
});

test('reservierte Kombinationen sind eine Auskunft, keine Warnung', () => {
  // Am Geraet behielt Windows zehn von sechzehn. Das ist der Normalfall, und vorher stand
  // dafuer eine Warnzeile mit zehn Namen im Protokoll -- das liest sich wie ein Fehlschlag.
  // Eine Warnung, die immer kommt, bringt einem bei, das Protokoll zu ueberfliegen.
  const zeilen = [];
  const r = w.anpassen({}, {
    aktiv: false,
    greifen: (t) => !w.RESERVIERT.includes(t),
    freigeben: () => {},
    log: (stufe, text) => zeilen.push([stufe, text])
  });
  assert.deepStrictEqual(r.unerwartet, [], 'nichts Unerwartetes');
  assert.deepStrictEqual(zeilen.map(z => z[0]), ['info'], 'genau eine Zeile, und keine Warnung');
  assert.match(zeilen[0][1], /Fokus-Rueckholer/,
    'die Zeile muss sagen, wer die reservierten abfaengt -- sonst sieht sie aus wie ein Loch');
});

test('eine Kombination, die gehen SOLLTE und nicht geht, ist eine Warnung', () => {
  const zeilen = [];
  w.anpassen({}, {
    aktiv: false,
    greifen: (t) => !w.RESERVIERT.includes(t) && t !== 'Super+M',
    freigeben: () => {},
    log: (stufe, text) => zeilen.push([stufe, text])
  });
  const warnungen = zeilen.filter(z => z[0] === 'warn');
  assert.strictEqual(warnungen.length, 1);
  assert.match(warnungen[0][1], /Super\+M/);
});

test('die reservierten sind wirklich als solche gekennzeichnet', () => {
  // Am 2026-09-23 auf Build 26200 gemessen. Ausgerechnet Win+A und Win+N -- das
  // Benachrichtigungscenter -- gehoeren dazu.
  for (const t of ['Super+A', 'Super+N']) {
    assert.ok(w.RESERVIERT.includes(t), `${t} ist reserviert und muss so gekennzeichnet sein`);
  }
  for (const t of ['Super+M', 'Super+D', 'Super+E']) {
    assert.ok(!w.RESERVIERT.includes(t), `${t} ging am Geraet -- also keine Ausrede eintragen`);
  }
});

test('anpassen tut nichts, wenn der Zustand schon stimmt', () => {
  // Alle fuenf Sekunden sechzehn Tastenkombinationen neu anzufordern ist unnoetig und
  // reisst sie fuer einen Augenblick los.
  let gerufen = 0;
  const r = w.anpassen({}, { aktiv: true, greifen: () => { gerufen++; return true; }, freigeben: () => { gerufen++; } });
  assert.strictEqual(gerufen, 0);
  assert.strictEqual(r.geaendert, false);
});

test('bei einer Wartung werden sie freigegeben', () => {
  let frei = false;
  const r = w.anpassen({ taskleisteBis: Date.now() + 60000 }, {
    aktiv: true, greifen: () => true, freigeben: () => { frei = true; }
  });
  assert.strictEqual(frei, true);
  assert.strictEqual(r.aktiv, false);
});

test('Win+L bleibt in Ruhe', () => {
  // Den Bildschirm sperren soll moeglich bleiben -- und Windows gibt die Kombination ohnehin
  // nicht her.
  assert.ok(!w.KOMBINATIONEN.some(([t]) => /\+L$/i.test(t)));
});

test('Minimieren steht an erster Stelle', () => {
  // Win+M und Win+D legen den nackten Desktop frei. Das ist auf einer Wand der schlimmste
  // Fall, und die Liste ist nach Schaden geordnet, damit das beim Lesen auffaellt.
  assert.match(w.KOMBINATIONEN[0][0], /Super\+(M|D)$/);
});

// --- Die Lehre, die zweimal Geld gekostet hat -----------------------------------------------

test('KEINE Sperre liegt in einem Policies-Zweig', () => {
  // Gemessen am 2026-09-23: HKCU\Software\Policies und
  // HKCU\Software\Microsoft\Windows\CurrentVersion\Policies geben dem Benutzerkonto nur
  // ReadKey. Die App laeuft unelevert, also ist dort nichts zu holen. In 1.0.16 standen
  // trotzdem zwei Sperren darin -- die Messung hatte sie fuer moeglich erklaert, weil sie
  // ueber SSH lief und OpenSSH ein volles Token ohne UAC-Filterung gibt.
  for (const s of k.SPERREN) {
    assert.ok(!k.istPolicyPfad(s.pfad), `"${s.name}" liegt in einem Policies-Zweig: ${s.pfad}`);
  }
});

test('istPolicyPfad erkennt beide Zweige', () => {
  assert.strictEqual(k.istPolicyPfad('HKCU\\Software\\Policies\\Microsoft\\Windows\\Explorer'), true);
  assert.strictEqual(k.istPolicyPfad('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer'), true);
  assert.strictEqual(k.istPolicyPfad('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\EdgeUI'), false);
  assert.strictEqual(k.istPolicyPfad(''), false);
});

test('main.js haengt die Tasten an den Takt und an die Wartung', () => {
  const q = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(/require\(['"]\.\/control\/wintasten/.test(q), 'Modul wird geladen');
  assert.ok(/windowsTastenAnpassen\(state\)/.test(q), 'bei jedem Zustandswechsel angepasst');
  assert.ok(/globalShortcut\.register\(taste/.test(q), 'und wirklich angefordert');
});
