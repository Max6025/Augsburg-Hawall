'use strict';

// Was von der Sicherheitsgrenze des Setup-Servers UEBRIG ist.
//
// Bis 1.0.16 lag diese Oberflaeche hinter einem Zugangscode, und der Vorgaenger dieser Datei
// (test/server-auth.test.js) prueefte ihn gegen einen echten Server -- ueber 127.0.0.1 UND
// ueber die LAN-Adresse, weil nur so der Unterschied sichtbar wurde. Auf Anweisung vom
// 2026-09-23 ist der Code entfernt.
//
// Diese Datei haelt deshalb zwei Dinge fest:
//
// 1. Was TROTZDEM nicht herausgeht: das Home-Assistant-Token. Das ist der einzige Wert hier,
//    mit dem jemand auch von ausserhalb des Netzes etwas anfangen koennte, und er bleibt auf
//    dem Geraet. Diese Zusicherung hat nichts mit dem Zugangscode zu tun und gilt weiter.
// 2. Dass die Oberflaeche jetzt AUSDRUECKLICH offen ist. Ein Test darauf klingt verkehrt, ist
//    aber der Unterschied zwischen einer Entscheidung und einem Versehen: Wer den Schutz
//    versehentlich wieder einbaut, bekommt hier einen roten Test und liest die Begruendung.

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
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

function lanAdresse() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

const store = fakeStore({ haUrl: 'http://ha.invalid', token: 'GEHEIMES-TOKEN-4711' });
let server;
let live;
let port;

test.before(async () => {
  // Port 0 und auf 'listening' warten, nicht eine feste Nummer: Eine feste Nummer kollidiert
  // mit allem, was auf diesem Rechner gerade laeuft, und der Test schlaegt aus einem Grund
  // fehl, der nichts mit ihm zu tun hat. Genau das ist hier schon einmal passiert.
  const app = startServer({
    port: 0,
    store,
    onConfigSaved: () => {},
    getLocalIps: () => [],
    updater: { currentVersion: '1.0.0', getState: () => ({}), check: () => {}, install: () => {} },
    controller: null
  });
  server = app.server;
  live = app.haLive;
  await new Promise((fertig) => {
    if (server.listening) return fertig();
    server.once('listening', fertig);
  });
  port = server.address().port;
});

test.after(() => {
  if (server) server.close();
  // Ohne das versucht die Live-Verbindung im Hintergrund weiter, Home Assistant zu erreichen,
  // und `node --test` beendet sich nicht mehr.
  if (live) live.stop();
});

test('Das Home-Assistant-Token geht NIE heraus', async () => {
  const cfg = await fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.json());
  assert.ok(!('token' in cfg), 'das Token darf nicht im Konfigurations-Abruf stehen');
  assert.strictEqual(cfg.hasToken, true, 'nur die Tatsache, dass eines gesetzt ist');
  assert.ok(!JSON.stringify(cfg).includes('GEHEIMES-TOKEN-4711'),
    'und auch nirgends sonst in der Antwort');
});

test('Die Oberflaeche ist aus dem Netz offen -- ausdruecklich', async (t) => {
  const ip = lanAdresse();
  if (!ip) return t.skip('kein Netzwerkadapter -- ohne LAN-Adresse ist hier nichts zu messen');
  const r = await fetch(`http://${ip}:${port}/api/config`);
  assert.strictEqual(r.status, 200, 'kein 401, keine Umleitung auf eine Anmeldeseite');
  const cfg = await r.json();
  assert.strictEqual(cfg.hasToken, true, 'und es kommt wirklich die Konfiguration');
});

test('Die Gesundheitsroute antwortet aus dem Netz', async (t) => {
  const ip = lanAdresse();
  if (!ip) return t.skip('kein Netzwerkadapter');
  const r = await fetch(`http://${ip}:${port}/api/gesundheit`);
  assert.ok(r.status === 200 || r.status === 503, `unerwartet: ${r.status}`);
  assert.match(await r.text(), /HAWALL-(OK|FEHLER)/);
});

test('Vom Zugangscode ist nichts liegen geblieben', () => {
  // Halbe Reste sind schlimmer als beides: Eine Anmeldeseite ohne Pruefung dahinter sieht aus
  // wie Schutz und ist keiner, und ein Sitzungs-Keks, den niemand mehr liest, verwirrt beim
  // naechsten Lesen des Quelltexts.
  const dateien = {
    'server/setup-server.js': ['setupCode', 'wallcode', 'LOGIN_PAGE', 'needsAuth', '/api/auth/'],
    'server/systemstatus.js': ['zugangscodeGesetzt'],
    'renderer/setup/theme.js': ['setupCode', 'codeState'],
    'renderer/setup/theme.html': ['setupCode', 'Zugangscode']
  };
  for (const [datei, woerter] of Object.entries(dateien)) {
    const q = fs.readFileSync(path.join(__dirname, '..', datei), 'utf8');
    for (const w of woerter) {
      assert.ok(!q.includes(w), `"${w}" steht noch in ${datei}`);
    }
  }
});

test('Der alte Code wird aus der Konfiguration entfernt', () => {
  // Ein Geheimnis, das nichts mehr liest, hat in der config.json nichts zu suchen -- und wer
  // die Datei in einem Jahr liest, haelt es sonst fuer einen aktiven Schutz.
  const q = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(/zugangscodeAufraeumen/.test(q), 'die Aufraeumfunktion fehlt');
  assert.ok(/speicher\.delete\('setupCode'\)/.test(q), 'und sie muss den Wert wirklich loeschen');
  // Direkt nach dem Anlegen des Speichers: Spaeter gaebe es einen Programmlauf, in dem der
  // Wert noch da ist und niemand ihn mehr liest.
  const anlegen = q.indexOf("const store = new Store(");
  const aufraeumen = q.indexOf("zugangscodeAufraeumen(store)");
  assert.ok(anlegen > 0 && aufraeumen > anlegen, 'der Aufruf gehoert direkt hinter new Store');
});

test('Der Pfad der Gesundheitsroute steht genau einmal als Zeichenkette', () => {
  // Zwei Zeichenketten laufen beim naechsten Umbenennen auseinander, und das faellt erst der
  // Ueberwachung auf -- Wochen spaeter.
  const q = fs.readFileSync(path.join(__dirname, '..', 'server', 'setup-server.js'), 'utf8');
  assert.strictEqual((q.match(/'\/api\/gesundheit'/g) || []).length, 1);
});
