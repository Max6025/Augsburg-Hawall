// Die Gesundheitspruefung fuer eine Ueberwachung von aussen (Uptime Kuma).
//
// Seit 1.0.17 ist die ganze Oberflaeche offen (siehe test/server-offen.test.js), diese Route
// war es schon vorher. Was bleibt, ist die zweite Haelfte der damaligen Entscheidung, und die
// gilt unveraendert: Es geht nur das Noetigste nach draussen. Kein Token, keine Adressen, keine
// Entitaeten, keine Protokollzeilen -- eine Ueberwachung braucht eine Stufe, keinen Bericht.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, GESUNDHEIT_PFAD } = require('../server/setup-server');

function fakeStore(values = {}) {
  const d = { ...values };
  return {
    get: (k) => d[k], set: (k, v) => { d[k] = v; },
    delete: (k) => { delete d[k]; }, clear: () => { for (const k of Object.keys(d)) delete d[k]; },
    path: '/tmp/test/config.json', _d: d
  };
}

const PANEL_GUT = {
  panelOn: true, reason: 'dauerbetrieb', nightModeEnabled: false,
  schlafZeitgeber: { ac: 0, dc: 0 }, systemWachhalten: true, systemWachGestellt: true,
  letzteSchlafluecke: null, taskleisteBis: 0
};
// Stehende Schlaf-Fristen: der Fall, an dem zwei Releases vorbeigingen.
const PANEL_KAPUTT = { ...PANEL_GUT, schlafZeitgeber: { ac: 1800, dc: 300 } };

async function serverMit({ panel = PANEL_GUT } = {}) {
  const app = startServer({
    port: 0,
    store: fakeStore({
      haUrl: 'http://ha.invalid', token: 'GEHEIMES-TOKEN-4711',
      layout: [{ entity_id: 'light.kueche' }], dashboards: []
    }),
    onConfigSaved: () => {}, getLocalIps: () => ['192.168.1.174'],
    updater: { currentVersion: '9.9.9', getState: () => ({}), check: () => {}, install: () => {} },
    controller: { getState: () => panel, logFile: null, log: () => {} },
    getPanelSize: () => null, gestartetAm: Date.now(),
    sperrenBericht: () => ({ stand: 3, gesamt: 8, gesetzt: 8, offen: [], unmoeglich: [] })
  });
  const server = app.server;
  await new Promise((f) => (server.listening ? f() : server.once('listening', f)));
  return { app, server, live: app.haLive, port: server.address().port };
}

// Der Unterschied Loopback/Netz wird nur ueber die echte LAN-Adresse sichtbar: Ueber 127.0.0.1
// ist ALLES frei, das ist die Sicherheitsgrenze dieses Servers (siehe isLoopback). Wer den
// Code-Schutz ueber Loopback prueft, prueft nichts.
function lanAdresse() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

async function hol(port, pfad, kopf = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { headers: kopf });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* nicht immer JSON */ }
  return { status: r.status, text, json };
}

test('Ein HINWEIS ist kein Ausfall -- 200', async (t) => {
  // Ein Hinweis darf niemanden nachts aus dem Bett holen. Nach dem dritten Fehlalarm glaubt
  // niemand mehr der Anzeige -- dieselbe Lehre wie bei der Ueberfaellig-Warnung der Tor-Karte.
  // Der Hinweis kommt hier daher, dass kein einziges Unterdashboard eingerichtet ist.
  const s = await serverMit({});
  t.after(() => { s.server.close(); if (s.live) s.live.stop(); });
  const r = await hol(s.port, GESUNDHEIT_PFAD);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.status, 'HAWALL-OK');
  assert.ok(r.json.hinweise.length > 0, 'Hinweise werden trotzdem genannt');
});

test('Ein FEHLER ist ein Ausfall -- 503 und die Namen dazu', async (t) => {
  const s = await serverMit({ panel: PANEL_KAPUTT });
  t.after(() => { s.server.close(); if (s.live) s.live.stop(); });
  const r = await hol(s.port, GESUNDHEIT_PFAD);
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.json.status, 'HAWALL-FEHLER');
  assert.ok(r.json.auffaellig.includes('Schlaf-Fristen'), JSON.stringify(r.json.auffaellig));
});

test('Das Schluesselwort steht WORTWOERTLICH im Koerper', async (t) => {
  // Die Ueberwachungsart "HTTP(s) - Keyword" sucht Text, nicht Struktur. Wer HAWALL-OK
  // umbenennt, muss die Ueberwachung nachziehen -- deshalb steht es hier fest.
  const s = await serverMit({});
  t.after(() => { s.server.close(); if (s.live) s.live.stop(); });
  const r = await hol(s.port, GESUNDHEIT_PFAD);
  assert.ok(r.text.includes('HAWALL-OK'), r.text);
});


test('Nach draussen geht nur das Noetigste', async (t) => {
  // Sie ist ohne Code erreichbar, also ist jedes Feld hier eine Preisgabe. Token, Adressen,
  // Entitaeten und Protokollzeilen haben darin nichts verloren.
  const ip = lanAdresse();
  const s = await serverMit({ panel: PANEL_KAPUTT });
  t.after(() => { s.server.close(); if (s.live) s.live.stop(); });
  // Ueber das Netz abrufen, also genau so, wie die Ueberwachung es tut.
  const r = ip
    ? await (async () => { const x = await fetch(`http://${ip}:${s.port}${GESUNDHEIT_PFAD}`);
        const t2 = await x.text(); return { status: x.status, text: t2, json: JSON.parse(t2) }; })()
    : await hol(s.port, GESUNDHEIT_PFAD);
  for (const verboten of ['GEHEIMES-TOKEN-4711', '192.168.1.174', 'light.kueche', 'ha.invalid']) {
    assert.ok(!r.text.includes(verboten), `"${verboten}" steht in der Antwort: ${r.text}`);
  }
  assert.deepStrictEqual(Object.keys(r.json).sort(),
    ['auffaellig', 'hinweise', 'status', 'stufe', 'version'],
    'unerwartetes Feld -- jedes ist eine Preisgabe');
});

