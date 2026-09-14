// Tests fuer den Ruheschirm -- die Entscheidung, wann sich das Dashboard hinlegt.
//
// Gemeldet wurde er als Frage: "Warum ist der Bildschirm die ganze Zeit an?" Waehrend eines
// Termins haelt die Steuerung das Panel durchgehend an, damit jemand, der vorbeigeht, sein
// Dashboard sieht -- die meiste Zeit geht aber niemand vorbei.
//
// Der teuerste Fehler waere, dass er sich AUSSERHALB eines Termins einmischt: Dann gaebe es
// zwei Stellen, die entscheiden, was auf der Wand zu sehen ist, und decide() waere nicht mehr
// die einzige. Der zweitteuerste, dass er den Ankunftsschirm zudeckt.

const test = require('node:test');
const assert = require('node:assert');
const { sollRuhen, ruheHelligkeit, RUHE_MINUTEN_VORGABE } = require('../renderer/shared/ruheschirm.js');

const JETZT = new Date(2026, 8, 14, 15, 0, 0);
const vorMinuten = (m) => JETZT.getTime() - m * 60000;

const basis = (u) => Object.assign({
  aktiviert: true,
  imTermin: true,
  schirmSichtbar: false,
  nacht: false,
  letzteBedienung: vorMinuten(10),
  minuten: 3,
  jetzt: JETZT
}, u);

test('Nach der Frist ohne Bedienung legt er sich hin', () => {
  assert.strictEqual(sollRuhen(basis()), true);
});

test('Kurz nach einer Bedienung bleibt das Dashboard stehen', () => {
  assert.strictEqual(sollRuhen(basis({ letzteBedienung: vorMinuten(1) })), false);
  // Genau auf der Frist zaehlt als abgelaufen -- sonst haengt es bei exakt drei Minuten.
  assert.strictEqual(sollRuhen(basis({ letzteBedienung: vorMinuten(3) })), true);
});

test('Ausgeschaltet passiert nichts', () => {
  assert.strictEqual(sollRuhen(basis({ aktiviert: false })), false);
  assert.strictEqual(sollRuhen(null), false);
});

test('Ohne laufenden Termin mischt er sich NICHT ein', () => {
  // Ausserhalb eines Termins schaltet die Kalendersteuerung das Panel ohnehin ab. Ein
  // Ruheschirm davor waere ein zweiter Schalter fuer dieselbe Sache -- und zwei Schalter fuer
  // eine Sache widersprechen einander irgendwann.
  assert.strictEqual(sollRuhen(basis({ imTermin: false })), false);
});

test('Ankunfts- und Abschiedsschirm haben Vorrang', () => {
  // Wer begruesst oder verabschiedet wird, soll das sehen und nicht eine Aufforderung zum
  // Tippen. Zwei Vollbilder uebereinander sind ein Fehler, kein Entwurf.
  assert.strictEqual(sollRuhen(basis({ schirmSichtbar: true })), false);
});

test('Nachts bleibt es beim Nachtschwarz', () => {
  // Eine leuchtende Aufforderung waere dort ausgerechnet dann die einzige Lichtquelle im
  // Raum, wenn jemand schlafen will.
  assert.strictEqual(sollRuhen(basis({ nacht: true })), false);
});

test('Ohne bekannte letzte Bedienung wird geruht', () => {
  // Ein unbekannter Wert darf nicht dazu fuehren, dass die Wand doch wieder durchleuchtet --
  // das ist genau der Zustand, gegen den es diese Funktion gibt.
  [0, null, undefined, NaN, 'quatsch'].forEach(w =>
    assert.strictEqual(sollRuhen(basis({ letzteBedienung: w })), true, String(w)));
});

test('Eine Bedienung aus der Zukunft verlaengert die Frist nicht endlos', () => {
  // Uhrumstellung oder ein Zeitsprung nach dem Aufwachen. Lieber einmal wach bleiben als
  // stundenlang -- beim naechsten Takt stimmt die Uhr wieder.
  assert.strictEqual(sollRuhen(basis({ letzteBedienung: JETZT.getTime() + 3600000 })), false);
});

test('Eine fehlende Frist faellt auf die Vorgabe zurueck', () => {
  assert.strictEqual(RUHE_MINUTEN_VORGABE, 3);
  [undefined, null, 0, -5, 'viele'].forEach(w => {
    assert.strictEqual(sollRuhen(basis({ minuten: w, letzteBedienung: vorMinuten(2) })), false, String(w));
    assert.strictEqual(sollRuhen(basis({ minuten: w, letzteBedienung: vorMinuten(4) })), true, String(w));
  });
});

test('Die Ruhehelligkeit bleibt lesbar', () => {
  // Bei 0 waere die Aufforderung unsichtbar, und niemand wuesste, dass ein Tipp genuegt --
  // die Wand saehe schlicht kaputt aus.
  assert.strictEqual(ruheHelligkeit(undefined), 12);
  assert.strictEqual(ruheHelligkeit(0), 1);
  assert.strictEqual(ruheHelligkeit(-30), 1);
  assert.strictEqual(ruheHelligkeit(999), 60);
  assert.strictEqual(ruheHelligkeit(25), 25);
  assert.strictEqual(ruheHelligkeit('quatsch'), 12);
});

test('Die Frist rechnet in Minuten, nicht in Sekunden', () => {
  // Ein vertauschter Faktor faellt sonst erst am Geraet auf -- und sieht dort aus wie ein
  // Bildschirm, der sich sofort wieder hinlegt.
  assert.strictEqual(sollRuhen(basis({ minuten: 30, letzteBedienung: vorMinuten(29) })), false);
  assert.strictEqual(sollRuhen(basis({ minuten: 30, letzteBedienung: vorMinuten(31) })), true);
});
