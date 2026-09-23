// Prueft das Aus- und Eingeben von Dashboards gegen einen ECHTEN laufenden Server.
//
// Anlass: In 1.10.0 lief kein einziger Import. Die Route hiess /api/dashboards/import, und
// darueber stand app.post('/api/dashboards/:id'). Express nimmt die erste passende Route --
// "import" war fuer sie eine Dashboard-Kennung, und die Antwort lautete "Dashboard nicht
// gefunden". Aufgefallen ist das erst auf dem Geraet.
//
// Die Modultests konnten es nicht sehen: Sie pruefen dashboard-austausch.js, und das Modul
// war die ganze Zeit in Ordnung. Der Fehler lag im Weg dorthin. Deshalb geht dieser Test den
// echten Weg -- ueber HTTP, durch den Router, in den Speicher und zurueck.

const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../server/setup-server');

function fakeStore(values = {}) {
  const data = { ...values };
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    delete: (k) => { delete data[k]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; }
  };
}

// Der Port wird vom Betriebssystem vergeben, nicht festgelegt.
//
// Vorher stand hier 18789 -- und genau den belegte auf dem Entwicklungsrechner ein fremder
// Dienst. Der Test scheiterte dann mit EADDRINUSE, also mit einer Meldung, die aussieht wie ein
// kaputter Server und keiner ist: Er war nie gestartet. In der CI fiel das nie auf, weil dort
// nichts anderes laeuft. Ein Test, der einen bestimmten Port BRAUCHT, prueft nebenbei die
// Portbelegung des Rechners mit, auf dem er laeuft, und das ist nicht seine Aufgabe.
let PORT = 0;
const HAUPT = [
  { entity_id: 'light.kueche', card_type: 'light', x: 0, y: 0, cols: 1, rows: 1, settings: { name: 'Decke' } },
  { entity_id: 'sensor.temp', card_type: 'temperature', x: 1, y: 0, cols: 2, rows: 1 }
];

const store = fakeStore({
  haUrl: 'http://ha.invalid', token: 'geheim',
  title: 'Zuhause', layout: HAUPT,
  dashboards: [{ id: 'db_test', name: 'Küche', type: 'cards', layout: HAUPT }]
});
let server;
let live;
const U = (pfad) => `http://127.0.0.1:${PORT}${pfad}`;

test.before(async () => {
  const app = startServer({
    port: 0, store, onConfigSaved: () => {}, getLocalIps: () => [],
    updater: { currentVersion: '1.0.0', getState: () => ({}), check: () => {}, install: () => {} },
    controller: null
  });
  server = app.server;
  live = app.haLive;
  // `listen()` gibt den Server sofort zurueck, aber `address()` bleibt null, bis er wirklich
  // lauscht. Ohne dieses Warten steht im ersten Test eine undefinierte Portnummer in der URL.
  return new Promise((fertig) => {
    if (server.listening) return fertig();
    server.once('listening', fertig);
  }).then(() => { PORT = server.address().port; });
});

test.after(() => {
  if (server) server.close();
  // Ohne das versucht die Live-Verbindung im Hintergrund weiter, Home Assistant zu erreichen.
  if (live) live.stop();
});

test('Ein Unterdashboard laesst sich exportieren', async () => {
  const r = await fetch(U('/api/dashboards/db_test/export'));
  assert.strictEqual(r.status, 200);
  const d = await r.json();
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.datei.name, 'Küche');
  assert.strictEqual(d.datei.karten.length, 2);
  assert.ok(d.datei._anleitung, 'die Anleitung muss mitkommen');
});

test('Das Hauptdashboard laesst sich exportieren', async () => {
  // Es steht nicht in der Dashboard-Liste, sondern als 'layout' in der Konfiguration --
  // ohne eigene Route waere ausgerechnet das wichtigste das einzige, das man nicht mitnimmt.
  const r = await fetch(U('/api/dashboard-haupt/export'));
  const d = await r.json();
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.datei.karten.length, 2);
});

test('Die Format-Anleitung ist auch ohne Export zu bekommen', async () => {
  const r = await fetch(U('/api/dashboard-format'));
  const d = await r.json();
  assert.strictEqual(d.ok, true);
  assert.ok(d.anleitung.kartenarten.length > 20);
});

test('Ein Export laesst sich wirklich wieder einspielen', async () => {
  // DAS ist der Test, der in 1.10.0 gefehlt hat.
  const ex = await (await fetch(U('/api/dashboard-haupt/export'))).json();
  ex.datei.name = 'Wieder da';

  const r = await fetch(U('/api/dashboard-import'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datei: ex.datei })
  });
  assert.strictEqual(r.status, 200, 'der Import wurde nicht erreicht');
  const d = await r.json();
  assert.strictEqual(d.ok, true, JSON.stringify(d));
  assert.strictEqual(d.name, 'Wieder da');
  assert.strictEqual(d.anzahl, 2);

  // Und es liegt danach wirklich im Speicher, nicht nur in der Antwort.
  const liste = store.get('dashboards');
  assert.ok(liste.some(x => x.name === 'Wieder da'), 'nicht gespeichert');
});

test('Der Import-Pfad kollidiert nicht mit der Dashboard-Kennung', async () => {
  // Der eigentliche Regressionstest. Kaeme hier 404 mit "Dashboard nicht gefunden", waere
  // die Route wieder von /api/dashboards/:id verschluckt worden.
  const r = await fetch(U('/api/dashboard-import'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datei: { format: 'augsburg-wall-display/dashboard', version: 1, name: 'X', karten: [] } })
  });
  const text = await r.text();
  assert.ok(!text.includes('Dashboard nicht gefunden'),
    'die Import-Route wird von /api/dashboards/:id verschluckt: ' + text);
});

test('Eine kaputte Datei wird mit Begruendung abgelehnt', async () => {
  const r = await fetch(U('/api/dashboard-import'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datei: { format: 'augsburg-wall-display/dashboard', version: 1, karten: [
      { entitaet: 'climate.bad', art: 'thermostat' }
    ] } })
  });
  assert.strictEqual(r.status, 400);
  const d = await r.json();
  assert.strictEqual(d.ok, false);
  assert.ok(d.fehler.join(' ').includes('thermostat'), JSON.stringify(d.fehler));
});

test('Ein Export eines unbekannten Dashboards meldet das sauber', async () => {
  const r = await fetch(U('/api/dashboards/gibtsnicht/export'));
  assert.strictEqual(r.status, 404);
});

