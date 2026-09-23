// Die Gesundheitspruefung fuer eine Ueberwachung von aussen (Uptime Kuma).
//
// Sie ist die EINZIGE Route, die ohne Zugangscode erreichbar bleibt. Das ist eine Entscheidung
// mit Folgen, und diese Tests halten beide Seiten davon fest: dass sie wirklich frei ist (sonst
// meldet die Ueberwachung ab dem Tag, an dem ein Code gesetzt wird, dauerhaft "down"), und dass
// dabei nichts nach draussen geht, was nicht muss.

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

async function serverMit({ panel = PANEL_GUT, code = null } = {}) {
  const app = startServer({
    port: 0,
    store: fakeStore({
      haUrl: 'http://ha.invalid', token: 'GEHEIMES-TOKEN-4711', setupCode: code,
      layout: [{ entity_id: 'light.kueche' }], dashboards: []
    }),
    onConfigSaved: () => {}, getLocalIps: () => ['192.168.1.174'],
    updater: { currentVersion: '9.9.9', getState: () => ({}), check: () => {}, install: () => {} },
    controller: { getState: () => panel, logFile: null, log: () => {} },
    getPanelSize: () => null, sperrenSoll: 2, gestartetAm: Date.now()
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
  // Ein fehlender Zugangscode darf niemanden nachts aus dem Bett holen. Nach dem dritten
  // Fehlalarm glaubt niemand mehr der Anzeige -- dieselbe Lehre wie bei der
  // Ueberfaellig-Warnung der Tor-Karte.
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

test('Mit gesetztem Zugangscode bleibt sie erreichbar -- alles andere nicht', async (t) => {
  // Der eigentliche Punkt. Haengt die Pruefung hinter dem Code, meldet die Ueberwachung ab dem
  // Tag, an dem einer gesetzt wird, dauerhaft "down" -- aus dem falschen Grund.
  //
  // Angesprochen wird ueber die LAN-Adresse. Ueber 127.0.0.1 ist alles frei, dort waere der
  // Test wertlos -- und genau so ist er beim ersten Anlauf durchgefallen.
  const ip = lanAdresse();
  if (!ip) return t.skip('kein Netzwerkadapter mit LAN-Adresse vorhanden');
  const s = await serverMit({ code: 'geheim' });
  t.after(() => { s.server.close(); if (s.live) s.live.stop(); });

  const frei = await fetch(`http://${ip}:${s.port}${GESUNDHEIT_PFAD}`);
  assert.strictEqual(frei.status, 200, 'die Gesundheitspruefung muss aus dem Netz frei bleiben');
  assert.ok((await frei.text()).includes('HAWALL-'), 'und einen brauchbaren Koerper liefern');

  const zu = await fetch(`http://${ip}:${s.port}/api/status/system`);
  assert.strictEqual(zu.status, 401, 'die ausfuehrliche Statusroute NICHT');
  const zu2 = await fetch(`http://${ip}:${s.port}/api/config`);
  assert.strictEqual(zu2.status, 401, 'und die Konfiguration schon gar nicht');
});

test('Nach draussen geht nur das Noetigste', async (t) => {
  // Sie ist ohne Code erreichbar, also ist jedes Feld hier eine Preisgabe. Token, Adressen,
  // Entitaeten und Protokollzeilen haben darin nichts verloren.
  const ip = lanAdresse();
  const s = await serverMit({ panel: PANEL_KAPUTT, code: 'geheim' });
  t.after(() => { s.server.close(); if (s.live) s.live.stop(); });
  // Ueber das Netz abrufen, also genau so, wie die Ueberwachung es tut.
  const r = ip
    ? await (async () => { const x = await fetch(`http://${ip}:${s.port}${GESUNDHEIT_PFAD}`);
        const t2 = await x.text(); return { status: x.status, text: t2, json: JSON.parse(t2) }; })()
    : await hol(s.port, GESUNDHEIT_PFAD);
  for (const verboten of ['GEHEIMES-TOKEN-4711', '192.168.1.174', 'light.kueche', 'ha.invalid', 'geheim']) {
    assert.ok(!r.text.includes(verboten), `"${verboten}" steht in der Antwort: ${r.text}`);
  }
  assert.deepStrictEqual(Object.keys(r.json).sort(),
    ['auffaellig', 'hinweise', 'status', 'stufe', 'version'],
    'unerwartetes Feld -- jedes ist eine Preisgabe');
});

test('Die Ausnahme steht VOR der Code-Pruefung', async () => {
  // Reihenfolge im Quelltext: Stuende die Ausnahme dahinter, waere sie wirkungslos -- und das
  // faellt erst auf, wenn jemand einen Code setzt.
  const q = fs.readFileSync(path.join(__dirname, '..', 'server', 'setup-server.js'), 'utf8');
  const ausnahme = q.indexOf('if (req.path === GESUNDHEIT_PFAD) return next();');
  const pruefung = q.indexOf("if (!store.get('setupCode')) return next();");
  assert.notStrictEqual(ausnahme, -1, 'die Ausnahme fehlt');
  assert.ok(ausnahme < pruefung, 'die Ausnahme muss vor der Code-Pruefung stehen');
  // Und der Pfad steht an einer Stelle, nicht zweimal als Zeichenkette.
  assert.strictEqual((q.match(/'\/api\/gesundheit'/g) || []).length, 1,
    'der Pfad darf nur EINMAL als Zeichenkette vorkommen, sonst laufen die beiden auseinander');
});
