// Das Urteil der Statusseite.
//
// `pruefungen()` ist eine reine Funktion: rein die Rohwerte, raus die Liste mit Urteil. Genau
// deshalb ist jeder Grenzfall hier pruefbar, ohne Geraet, ohne Server, ohne Browser -- und
// deshalb darf in renderer/setup/status.js kein einziger Schwellwert stehen.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pruefungen, schlechteste } = require('../server/systemstatus');

const GUT = {
  konfiguriert: true, haVerbunden: true, version: '1.0.11', laeuftSeit: Date.now() - 60000,
  akku: { prozent: 100, laedt: true }, zugangscodeGesetzt: true,
  dashboards: 2, hauptKarten: 8, warnungen: [],
  sperren: { stand: 3, gesamt: 8, gesetzt: 8, offen: [], unmoeglich: [] },
  panel: {
    panelOn: true, reason: 'dauerbetrieb', nightModeEnabled: true,
    nightStart: '23:00', nightEnd: '06:30', schlafZeitgeber: { ac: 0, dc: 0 },
    systemWachhalten: true, systemWachGestellt: true, letzteSchlafluecke: null, taskleisteBis: 0
  }
};
const mit = (aend) => pruefungen({ ...GUT, ...aend });
const finde = (r, schluessel) => r.pruefungen.find(e => e.schluessel === schluessel);

test('Wenn alles laeuft, ist das Urteil ok', () => {
  const r = mit({});
  assert.strictEqual(r.stufe, 'ok', JSON.stringify(r.pruefungen.filter(e => e.stufe !== 'ok')));
});

test('Das Gesamturteil ist die schlechteste Einzelstufe, kein Mittelwert', () => {
  // Ein Panel, an dem eine Sache kaputt ist und neun laufen, ist kein Panel, an dem "fast
  // alles passt".
  assert.strictEqual(schlechteste(['ok', 'ok', 'fehler', 'hinweis']), 'fehler');
  assert.strictEqual(schlechteste(['ok', 'hinweis']), 'hinweis');
  assert.strictEqual(schlechteste(['ok', 'unbekannt']), 'unbekannt');
  assert.strictEqual(schlechteste([]), 'ok');
  assert.strictEqual(schlechteste(['ok']), 'ok');
});

test('"unbekannt" ist schlechter als ok, aber besser als ein Hinweis', () => {
  // Eine Seite, die Gewissheit behauptet, die sie nicht hat, ist schlimmer als eine, die
  // zugibt, dass sie nichts weiss -- aber ein echter Hinweis wiegt schwerer.
  assert.strictEqual(schlechteste(['unbekannt', 'hinweis']), 'hinweis');
  assert.strictEqual(schlechteste(['ok', 'unbekannt']), 'unbekannt');
});

test('Stehende Schlaf-Fristen sind ein FEHLER, nicht ein Hinweis', () => {
  // Das war die Ursache, an der zwei Releases vorbeigingen: Sobald der Bildschirm ausgeht,
  // schlaeft das Geraet und die Seite ist weg. Wer das als Hinweis anzeigt, verharmlost es.
  const r = mit({ panel: { ...GUT.panel, schlafZeitgeber: { ac: 300, dc: 0 } } });
  assert.strictEqual(finde(r, 'schlaf').stufe, 'fehler');
  assert.match(finde(r, 'schlaf').wert, /5 Min\./);
  assert.strictEqual(r.stufe, 'fehler');
});

test('Wachhalten gewuenscht, aber nicht gestellt, ist ein Fehler', () => {
  const r = mit({ panel: { ...GUT.panel, systemWachGestellt: false } });
  assert.strictEqual(finde(r, 'wach').stufe, 'fehler');
});

test('Bewusst abgeschaltetes Wachhalten ist kein Fehler', () => {
  // Es ist eine Entscheidung des Nutzers, kein Defekt.
  const r = mit({ panel: { ...GUT.panel, systemWachhalten: false, systemWachGestellt: false } });
  assert.strictEqual(finde(r, 'wach').stufe, 'hinweis');
});

test('Nicht ermittelbare Werte melden "unbekannt", nicht "ok"', () => {
  const r = mit({ panel: { ...GUT.panel, schlafZeitgeber: null }, akku: null });
  assert.strictEqual(finde(r, 'schlaf').stufe, 'unbekannt');
  assert.strictEqual(finde(r, 'akku').stufe, 'unbekannt');
});

test('Ohne Home Assistant ist alles andere nebensaechlich', () => {
  const r = mit({ konfiguriert: false });
  assert.strictEqual(finde(r, 'ha').stufe, 'fehler');
});

test('Ein niedriger Akku am Netzteil ist kein Fehler', () => {
  // Es laedt ja. Genau der Fall vom 2026-09-23: 21 Prozent und steigend.
  assert.strictEqual(finde(mit({ akku: { prozent: 21, laedt: true } }), 'akku').stufe, 'ok');
  assert.strictEqual(finde(mit({ akku: { prozent: 21, laedt: false } }), 'akku').stufe, 'hinweis');
  assert.strictEqual(finde(mit({ akku: { prozent: 12, laedt: false } }), 'akku').stufe, 'fehler');
});

test('Ein leeres Hauptdashboard faellt auf', () => {
  assert.strictEqual(finde(mit({ hauptKarten: 0 }), 'dashboards').stufe, 'hinweis');
});

test('Eine laufende Wartung wird gemeldet, nicht verschwiegen', () => {
  const r = mit({ panel: { ...GUT.panel, taskleisteBis: Date.now() + 60000 } });
  assert.strictEqual(finde(r, 'taskleiste').stufe, 'hinweis');
});

test('Ohne Steuerung bleibt die Seite trotzdem auskunftsfaehig', () => {
  // Genau der Moment, in dem jemand nachsieht. Eine Statusseite, die dann leer ist, ist
  // wertlos.
  const r = pruefungen({});
  assert.ok(r.pruefungen.length >= 5, 'es muss trotzdem etwas dastehen');
  assert.strictEqual(finde(r, 'panel').stufe, 'unbekannt');
  assert.strictEqual(finde(r, 'ha').stufe, 'fehler');
});

test('Alles hat einen Schluessel, einen Titel und eine gueltige Stufe', () => {
  const erlaubt = ['ok', 'hinweis', 'fehler', 'unbekannt'];
  const gesehen = new Set();
  for (const e of mit({}).pruefungen) {
    assert.ok(e.schluessel, 'Eintrag ohne Schluessel: ' + JSON.stringify(e));
    assert.ok(!gesehen.has(e.schluessel), 'Schluessel doppelt: ' + e.schluessel);
    gesehen.add(e.schluessel);
    assert.ok(e.titel && e.wert !== undefined, JSON.stringify(e));
    assert.ok(erlaubt.includes(e.stufe), 'unbekannte Stufe: ' + e.stufe);
  }
});

test('Die Seite bewertet nicht selbst', () => {
  // Zwei Stellen, die dasselbe entscheiden, laufen spaetestens beim naechsten Sonderfall
  // auseinander -- dieselbe Regel wie bei decide() im Controller.
  const js = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'setup', 'status.js'), 'utf8');
  const ohneKommentare = js.split('\n').filter(z => !z.trim().startsWith('//')).join('\n');
  assert.ok(!/<=\s*\d|>=\s*\d/.test(ohneKommentare),
    'in status.js steht ein Schwellwert -- das Urteil gehoert in server/systemstatus.js');
});

test('Die Statusseite ist verdrahtet', () => {
  const w = (...t) => fs.readFileSync(path.join(__dirname, '..', ...t), 'utf8');
  assert.match(w('server', 'setup-server.js'), /\/api\/status\/system/, 'die Route fehlt');
  assert.match(w('renderer', 'shared', 'nav.js'), /status\.html/, 'der Tab fehlt in der Leiste');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'renderer', 'setup', 'status.html')));
  // Und das Status-Zeug ist wirklich aus den Einstellungen heraus, nicht nur doppelt da.
  const theme = w('renderer', 'setup', 'theme.js');
  for (const rest of ['refreshPanelStatus', 'panelStatus', 'REASON_TEXT', 'panelPauseBtn']) {
    assert.ok(!theme.includes(rest), `theme.js enthaelt noch ${rest}`);
  }
  assert.ok(!w('renderer', 'setup', 'theme.html').includes('panelWartungBtn'),
    'die Wartungsknoepfe stehen noch in den Einstellungen');
});

// --- Der Umzug des Konfigurationsordners ----------------------------------------------------
//
// Beim Umbenennen des Projekts wanderte `productName` -- und damit
// `app.getPath('userData')`, wo Zugangsdaten, Dashboards und Bilder liegen. Ohne Umzug startet
// die App nach dem Update wie frisch installiert. Die Reihenfolge ist dabei das Entscheidende:
// `new Store(...)` liest seine Datei beim Anlegen.

test('Der Umzug laeuft VOR dem Anlegen des Speichers', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const umzug = main.indexOf('const umzug = konfigurationUebernehmen()');
  const speicher = main.indexOf("const store = new Store(");
  assert.notStrictEqual(umzug, -1, 'der Umzug fehlt ganz');
  assert.notStrictEqual(speicher, -1, 'der Speicher wird nicht mehr so angelegt -- Test nachziehen');
  assert.ok(umzug < speicher,
    'laeuft der Umzug nach new Store(), hat die App schon einen leeren Zustand gesehen');
});

test('Der Umzug erkennt den alten Ordner am alten productName', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /'Augsburg Wall Display'/,
    'ohne den alten Namen findet der Umzug nichts -- er darf hier NICHT mitumbenannt werden');
  assert.match(main, /fs\.cpSync/, 'es wird nichts kopiert');
  assert.ok(!/fs\.renameSync|fs\.rmSync/.test(main),
    'verschieben oder loeschen waere falsch: der alte Stand ist die Sicherung');
});
