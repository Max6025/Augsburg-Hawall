'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { Wartungsmelder, anlassText } = require('../control/wartungsmelder.js');

// --- Ein Melder mit nachgebautem Netz und nachgebauter Ablage --------------------------------

function bauen({ url = 'http://ha:8099', schluessel = 'geheim', antworten = [], ablage = {} } = {}) {
  const rufe = [];
  const melder = new Wartungsmelder({
    konfig: () => ({ url, schluessel }),
    offeneLesen: () => ablage,
    offeneSchreiben: (d) => { ablage = d; },
    jetzt: () => new Date('2026-09-23T11:42:00Z'),
    holen: async (adresse, o) => {
      rufe.push({ adresse, weg: o.method, kopf: o.headers, koerper: o.body ? JSON.parse(o.body) : null });
      const a = antworten.shift();
      if (a && a.wirft) throw Object.assign(new Error(a.wirft), { name: a.name || 'Error' });
      const status = (a && a.status) || 200;
      return { ok: status < 400, status, json: async () => (a && a.daten) || { ok: status < 400 } };
    }
  });
  return { melder, rufe, ablageLesen: () => ablage };
}

// --- Die Texte ------------------------------------------------------------------------------

test('anlassText nennt beide Versionen und den Zeitpunkt', () => {
  const t = anlassText('update', { von: '1.0.14', nach: '1.0.15' }, new Date('2026-09-23T11:42:00'));
  assert.match(t.titel, /1\.0\.14/);
  assert.match(t.titel, /1\.0\.15/);
  assert.match(t.beschreibung, /11:42/, 'ohne Uhrzeit beantwortet die Beschreibung nicht, wann');
  assert.ok(t.dauer_minuten >= 10);
});

test('anlassText traegt keine ASCII-Ersatzschreibung in die Statusseite', () => {
  for (const art of ['update', 'vorort', 'irgendwas']) {
    const t = anlassText(art, { von: '1', nach: '2', minuten: 5 });
    const text = `${t.titel} ${t.beschreibung}`;
    assert.ok(!/\b(fuer|Geraet|ueber|laeuft|waehrend)\b/.test(text),
      `"${text}" steht so in Uptime Kuma -- dort gehoeren echte Umlaute hin`);
  }
});

test('vorort-Fenster ist nie kuerzer als zehn Minuten', () => {
  // Die Pause dauert oft nur fuenf Minuten, aber wer davor steht, verlaengert sie -- und ein
  // Fenster, das mitten in der Arbeit ablaeuft, loest genau den Alarm aus, den es verhindern soll.
  assert.strictEqual(anlassText('vorort', { minuten: 2 }).dauer_minuten, 10);
  assert.strictEqual(anlassText('vorort', { minuten: 30 }).dauer_minuten, 30);
});

// --- Der Weg zum Add-on ---------------------------------------------------------------------

test('beginnen meldet mit Strategie single, nicht manual', async () => {
  // Der Kern der Sache: Eine manuelle Wartung bleibt offen, wenn das Geraet nach einem
  // misslungenen Update aus bleibt -- und verdeckt dann genau diesen Ausfall.
  const { melder, rufe } = bauen();
  const r = await melder.beginnen('update', { von: '1.0.14', nach: '1.0.15' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(rufe.length, 1);
  assert.strictEqual(rufe[0].weg, 'POST');
  assert.strictEqual(rufe[0].adresse, 'http://ha:8099/wartung/wandpanel-update');
  assert.strictEqual(rufe[0].koerper.strategie, 'single');
  assert.ok(rufe[0].koerper.dauer_minuten > 0, 'ohne Dauer hat das Fenster kein Ende');
});

test('der Zugriffsschluessel geht als Kopfzeile mit, nicht in der Adresse', () => {
  // In der Adresse landete er im Protokoll jedes Vermittlers.
  const { melder, rufe } = bauen();
  return melder.beginnen('update', {}).then(() => {
    assert.strictEqual(rufe[0].kopf['X-Schluessel'], 'geheim');
    assert.ok(!rufe[0].adresse.includes('geheim'));
  });
});

test('ohne Zugriffsschluessel wird die Kopfzeile weggelassen', async () => {
  const { melder, rufe } = bauen({ schluessel: '' });
  await melder.beginnen('update', {});
  assert.ok(!('X-Schluessel' in rufe[0].kopf));
});

test('der Merker wird VOR der Anfrage abgelegt', async () => {
  // Zwischen Ablegen und Antwort liegt updater.install(): Danach ist die App weg, und was dort
  // geschrieben wuerde, wird nie geschrieben.
  let stand = null;
  const melder = new Wartungsmelder({
    konfig: () => ({ url: 'http://ha:8099', schluessel: '' }),
    offeneLesen: () => ({}),
    offeneSchreiben: (d) => { stand = d; },
    holen: async () => {
      assert.ok(stand && stand['wandpanel-update'], 'beim Absenden muss der Merker schon liegen');
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
  });
  await melder.beginnen('update', { von: '1', nach: '2' });
  assert.ok(stand['wandpanel-update'].seit, 'ohne Zeitpunkt ist der Merker nicht auswertbar');
});

test('ein nicht erreichbarer Melder haelt nichts auf und wirft nicht', async () => {
  const { melder } = bauen({ antworten: [{ wirft: 'connect ECONNREFUSED' }] });
  const r = await melder.beginnen('update', {});
  assert.strictEqual(r.ok, false);
  assert.match(r.fehler, /ECONNREFUSED/);
});

test('ohne eingetragene Adresse tut der Melder gar nichts', async () => {
  const { melder, rufe, ablageLesen } = bauen({ url: '   ' });
  assert.strictEqual(melder.konfiguriert(), false);
  const r = await melder.beginnen('update', {});
  assert.strictEqual(r.still, true, 'das ist kein Fehler, den jemand sehen muss');
  assert.strictEqual(rufe.length, 0);
  assert.deepStrictEqual(ablageLesen(), {}, 'und es bleibt auch kein Merker liegen');
});

test('die Klartextmeldung des Add-ons wird durchgereicht', async () => {
  const { melder } = bauen({ antworten: [{ status: 401, daten: { fehler: 'Zugriffsschlüssel fehlt oder ist falsch.' } }] });
  const r = await melder.beginnen('update', {});
  assert.match(r.fehler, /Zugriffsschlüssel/);
  assert.strictEqual(r.status, 401);
});

// --- Das Ende -------------------------------------------------------------------------------

test('beenden entfernt den Merker -- aber nur bei Erfolg', async () => {
  const a = bauen({ ablage: { 'wandpanel-update': { art: 'update' } } });
  await a.melder.beenden('wandpanel-update');
  assert.deepStrictEqual(a.ablageLesen(), {});

  const b = bauen({ ablage: { 'wandpanel-update': { art: 'update' } }, antworten: [{ status: 502 }] });
  await b.melder.beenden('wandpanel-update');
  assert.ok(b.ablageLesen()['wandpanel-update'],
    'der Merker muss liegen bleiben, sonst versucht es niemand mehr');
});

test('abschliessen schliesst alles Offene und meldet, was uebrig ist', async () => {
  const a = bauen({ ablage: { eins: {}, zwei: {} } });
  const r = await a.melder.abschliessen();
  assert.deepStrictEqual(r.geschlossen.sort(), ['eins', 'zwei']);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(a.ablageLesen(), {});

  const b = bauen({ ablage: { eins: {}, zwei: {} }, antworten: [{ status: 200 }, { status: 502 }] });
  const r2 = await b.melder.abschliessen();
  assert.deepStrictEqual(r2.geschlossen, ['eins']);
  assert.deepStrictEqual(r2.offen, ['zwei']);
  assert.strictEqual(r2.ok, false);
});

test('abschliessen ohne offene Wartung fragt gar nicht', async () => {
  const { melder, rufe } = bauen();
  const r = await melder.abschliessen();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(rufe.length, 0, 'bei jedem Start eine Anfrage ohne Grund ist Laerm');
});

test('der Warte-Zeitgeber haelt die Ereignisschleife am Leben', () => {
  // Mit unref() beendet sich Node, bevor der Zeitgeber feuert -- die Wiederholung findet dann
  // nie statt. Auf dem Windows-Laeufer brach genau daran der ganze Testlauf ab, und zwar mit
  // "fail 0": Keine Zusicherung war fehlgeschlagen, der Prozess war einfach weg.
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'control', 'wartungsmelder.js'), 'utf8');
  assert.ok(!/setTimeout\([^)]*\)\s*\.unref/.test(quelle),
    'kein unref() am Warte-Zeitgeber -- sonst wird die Wiederholung stillschweigend uebersprungen');
});

test('abschliessenWiederholt gibt nach dem ersten Erfolg Ruhe', async () => {
  const { melder, rufe } = bauen({ ablage: { eins: {} }, antworten: [{ status: 502 }, { status: 200 }] });
  await melder.abschliessenWiederholt(5, 1);
  assert.strictEqual(rufe.length, 2);
});

test('abschliessenWiederholt laeuft nur einmal gleichzeitig', async () => {
  const { melder } = bauen({ ablage: { eins: {} } });
  const a = melder.abschliessenWiederholt(3, 1);
  const b = melder.abschliessenWiederholt(3, 1);
  assert.strictEqual(a, b, 'zwei Laeufe wuerden sich die Ablage gegenseitig wegschreiben');
  await a;
});

// --- Die Verbindung zu main.js --------------------------------------------------------------
//
// Die Lehre aus 1.0.4: Eine Funktion, die niemand aufruft, ist dasselbe wie eine, die es nicht
// gibt -- und alle Modultests waren damals gruen.

// Gegen den GANZEN Dateiinhalt zu pruefen ist verlockend und falsch: Schlaegt es fehl, druckt
// node --test 20000 Zeichen main.js in den Bericht, und die eine Zeile, die zaehlt, geht darin
// unter. Deshalb wird hier ein Wahrheitswert geprueft und die Meldung selbst geschrieben.
function mainJs() {
  return fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
}

test('main.js laedt den Melder ueberhaupt', () => {
  assert.ok(/require\(['"]\.\/control\/wartungsmelder/.test(mainJs()),
    'ohne require ist das Modul da und wirkungslos -- die Lehre aus 1.0.4');
});

test('main.js meldet das Update, bevor es installiert', () => {
  const quelle = mainJs();
  const anfang = quelle.indexOf('  install: ()');
  assert.ok(anfang > 0, 'updater.install() nicht gefunden -- dieser Test muss nachgezogen werden');
  const install = quelle.slice(anfang, anfang + 2000);
  assert.ok(/wartungMelden|melder\.beginnen/.test(install),
    'in updater.install() muss die Wartung gemeldet werden -- danach ist die App weg');
});

test('main.js schliesst offene Wartungen nach dem Start', () => {
  assert.ok(/abschliessenWiederholt/.test(mainJs()),
    'ohne diesen Aufruf merkt niemand, dass die Wartung vorbei ist');
});

test('main.js beendet die Vorort-Wartung, wenn die Taskleiste wieder weg ist', () => {
  assert.ok(/vorortEnde/.test(mainJs()),
    'sonst bleibt die Wartung stehen, bis ihr Fenster ablaeuft');
});

test('main.js reicht das Melden in den Controller hinein', () => {
  // Und nicht an die Aufrufer: Der Knopf auf der Einstellungsseite laeuft ueber den Server
  // direkt in controller.wartung() und ginge an main.js vorbei.
  assert.ok(/wartungMelden:/.test(mainJs()),
    'ohne diesen Rueckruf meldet der Weg ueber die Einstellungsseite nichts');
});

test('controller.wartung meldet -- auf ALLEN drei Wegen', () => {
  const { Controller } = require('../control/controller.js');
  const gemeldet = [];
  const c = new Controller({
    store: { get: (k, d) => d, set: () => {} },
    logDir: null,
    setKiosk: () => {},
    wartungMelden: (d) => gemeldet.push(d)
  });
  c.panel.supported = false;
  c.wartung(7);
  assert.strictEqual(gemeldet.length, 1);
  assert.strictEqual(gemeldet[0].minuten, 7);
  c.stop();
});

test('ein Fehler beim Melden haelt die Wartung vor Ort nicht auf', () => {
  // Wer vor dem Geraet steht, braucht die Taskleiste -- und zwar auch dann, wenn Home
  // Assistant gerade nicht antwortet. Ein Wurf hier wuerde genau das verhindern.
  const { Controller } = require('../control/controller.js');
  const c = new Controller({
    store: { get: (k, d) => d, set: () => {} },
    logDir: null,
    setKiosk: () => {},
    wartungMelden: () => { throw new Error('kaputt'); }
  });
  c.panel.supported = false;
  const r = c.wartung(5);
  assert.ok(r.taskleisteBis > Date.now(), 'die Taskleiste muss trotzdem freigegeben sein');
  c.stop();
});
