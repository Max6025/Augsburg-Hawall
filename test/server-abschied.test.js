// Tests fuer den Testmodus des Abschiedsschirms -- ueber HTTP, nicht am Modul vorbei.
//
// `sollAbschiedZeigen()` ist reine Entscheidung und laengst geprueft. Was hier geprueft wird,
// ist der Weg dorthin: Der Schalter steht in der Einrichtungsseite, der Schirm in der Anzeige,
// und dazwischen liegen zwei Routen und der Store. Genau in so einem Weg lag der Import-Fehler,
// waehrend das Modul in Ordnung war.
//
// Die Besonderheit dieses Schalters: Er laeuft NICHT von allein ab. Damit ist das Ausschalten
// der einzige Weg zurueck -- und deshalb der Fall, der wehtut, wenn er nicht traegt.

const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../server/setup-server');
const { sollAbschiedZeigen } = require('../renderer/shared/ankunftsschirm');

function fakeStore(values = {}) {
  const data = { ...values };
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    delete: (k) => { delete data[k]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    path: require('node:path').join(require('node:os').tmpdir(), 'abschied-test-config.json')
  };
}

const PORT = 18793;
const U = (pfad) => `http://127.0.0.1:${PORT}${pfad}`;
let server;
let live;
let store;

test.before(() => {
  store = fakeStore({ haUrl: 'http://ha.invalid', token: 'geheim' });
  const app = startServer({
    port: PORT, store,
    onConfigSaved: () => {}, getLocalIps: () => [],
    updater: { currentVersion: '1.0.0', getState: () => ({}), check: () => {}, install: () => {} },
    controller: null
  });
  server = app.server;
  live = app.haLive;
});

test.after(() => {
  if (server) server.close();
  if (live) live.stop();
});

const schalten = (an) => fetch(U('/api/abschied/testmodus'), {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ an })
}).then(r => r.json());

const konfig = () => fetch(U('/api/config')).then(r => r.json());

test('Der Schalter geht an und steht danach in der Konfiguration', async () => {
  const d = await schalten(true);
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.an, true);
  // Die Anzeige liest ihn von hier -- steht er nicht drin, erscheint der Schirm nie.
  assert.strictEqual((await konfig()).abschiedTestmodus, true);
});

test('Eingeschaltet zeigt die Entscheidung den Schirm -- ohne Termin und ausgeschaltet', async () => {
  // Der ganze Weg auf einmal: Was der Server liefert, geht unveraendert in die Entscheidung.
  const c = await konfig();
  assert.strictEqual(sollAbschiedZeigen({
    aktiviert: !!c.abschiedEnabled,        // ist ab Werk aus
    anzeigefenster: null, verlauf: null,
    verworfenFuer: c.abschiedDismissedFor || '',
    testmodus: !!c.abschiedTestmodus,
    jetzt: new Date()
  }), true);
});

test('Einschalten raeumt den Verworfen-Zustand weg', async () => {
  // Sonst haengt am selben Schirm noch die Entscheidung von gestern, und nach dem Ausschalten
  // bliebe er unerwartet weg.
  store.set('abschiedDismissedFor', '2026-09-13T00:00:00.000Z');
  await schalten(true);
  assert.strictEqual((await konfig()).abschiedDismissedFor, '');
});

test('Der Schalter geht wieder aus -- der einzige Weg zurueck', async () => {
  await schalten(true);
  const d = await schalten(false);
  assert.strictEqual(d.an, false);
  const c = await konfig();
  assert.strictEqual(c.abschiedTestmodus, false);
  assert.strictEqual(sollAbschiedZeigen({
    aktiviert: false, anzeigefenster: null, verlauf: null,
    testmodus: !!c.abschiedTestmodus, jetzt: new Date()
  }), false);
});

test('Wegtippen loescht den Testmodus NICHT', async () => {
  // Wer an der Wand steht, soll ihn nicht versehentlich beenden koennen: Der Schalter ist der
  // einzige Ausgang. Frueher loeschte dieselbe Route die Frist -- daraus darf kein stilles
  // Ausschalten werden.
  await schalten(true);
  const d = await fetch(U('/api/abschied/dismiss'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ windowStart: '2026-09-14T00:00:00.000Z' })
  }).then(r => r.json());
  assert.strictEqual(d.ok, true);
  assert.strictEqual((await konfig()).abschiedTestmodus, true);
  await schalten(false);
});

test('Ohne Testmodus bleibt das Wegtippen wirksam', async () => {
  await schalten(false);
  await fetch(U('/api/abschied/dismiss'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ windowStart: '2026-09-14T00:00:00.000Z' })
  });
  assert.strictEqual((await konfig()).abschiedDismissedFor, '2026-09-14T00:00:00.000Z');
});
