// Die Statusseite mit dem ECHTEN Server ansehen, ohne Geraet und ohne Home Assistant.
//
// Anlass: In diesem Projekt sind schon zwei Oberflaechen kaputt ausgeliefert worden, weil sie
// sich ohne laufende Verbindung nicht ansehen liessen (siehe CLAUDE.md, "Editor-Aenderungen nie
// ohne Hinsehen ausliefern"). Eine neue Seite ohne Hinsehen waere derselbe Fehler.
//
// Anders als editor-probe.js ist das kein Mock-Server: Hier laeuft `startServer` aus
// server/setup-server.js, also auch die echte Route /api/status/system und das echte Urteil aus
// server/systemstatus.js.
//
// Start:  node .scratch/statusseite/probe.js
// Dann:   http://localhost:9931/setup/status.html
//         ?fall=gut | ?fall=schlecht  -- schaltet die erfundenen Rohwerte um

const { startServer } = require('../../server/setup-server');

const PORT = 9931;
const fall = (process.argv[2] || 'gut');

function fakeStore(werte) {
  const d = { ...werte };
  return {
    get: (k) => d[k], set: (k, v) => { d[k] = v; },
    delete: (k) => { delete d[k]; }, clear: () => { for (const k of Object.keys(d)) delete d[k]; },
    path: '/tmp/probe/config.json'
  };
}

const GUT = {
  haUrl: 'http://ha.invalid', token: 'geheim', title: 'Eurasburg',
  kioskSperren: {},
  layout: Array.from({ length: 8 }, (_, i) => ({ entity_id: 'light.x' + i, card_type: 'light' })),
  dashboards: [{ id: 'a', name: 'Küche' }, { id: 'b', name: 'Bad' }]
};
const SCHLECHT = { haUrl: 'http://ha.invalid', token: 'geheim', kioskLockdownStand: 1, layout: [], dashboards: [] };

const PANEL_GUT = {
  panelOn: true, reason: 'dauerbetrieb', nightModeEnabled: true, nightStart: '23:00',
  nightEnd: '06:30', pausedUntil: 0, taskleisteBis: 0, systemWach: true,
  systemWachGestellt: true, systemWachhalten: true, letzteSchlafluecke: null,
  schlafZeitgeber: { ac: 0, dc: 0 }
};
const PANEL_SCHLECHT = {
  ...PANEL_GUT, panelOn: false, reason: 'nachtsperre',
  systemWachGestellt: false, schlafZeitgeber: { ac: 1800, dc: 300 },
  taskleisteBis: Date.now() + 4 * 60 * 1000,
  letzteSchlafluecke: { ende: Date.now() - 8 * 60 * 1000, dauerMs: 225000 }
};

const WARN_SCHLECHT = [
  '2026-09-23T07:28:41.085Z [warn] Taktluecke von 225 s -- das Geraet hat geschlafen.',
  '2026-09-23T07:19:41.514Z [warn] Sperre "Widget-Knopf" konnte nicht gesetzt werden: Zugriff verweigert',
  '2026-09-23T07:19:41.514Z [error] System kann NICHT wachgehalten werden (kein dauerhafter PowerShell-Prozess)'
];

// Der Server liest die Warnungen aus controller.logFile. Fuer die Probe wird eine kleine
// Protokolldatei geschrieben -- so laeuft auch dieser Weg wirklich durch und nicht nur als
// untergeschobenes Array.
const fs = require('fs');
const os = require('os');
const path = require('path');
const logDatei = path.join(os.tmpdir(), 'probe-panelsteuerung.log');
fs.writeFileSync(logDatei, fall === 'schlecht'
  ? WARN_SCHLECHT.slice().reverse().join('\n') + '\n'
  : '2026-09-23T09:00:00.000Z [info] Panelsteuerung gestartet\n');

const controller = {
  getState: () => (fall === 'schlecht' ? PANEL_SCHLECHT : PANEL_GUT),
  logFile: logDatei,
  log: () => {},
  pause: () => Date.now() + 1800000,
  resume: () => {},
  wartung: () => ({ pausedUntil: Date.now() + 1800000, taskleisteBis: Date.now() + 300000 }),
  taskleisteVerbergen: () => {}
};

const app = startServer({
  port: PORT,
  store: fakeStore(fall === 'schlecht' ? SCHLECHT : GUT),
  onConfigSaved: () => {},
  getLocalIps: () => ['192.168.1.174'],
  updater: { currentVersion: '1.0.11', getState: () => ({ geprueft: false }), check: () => {}, install: () => {} },
  controller,
  getPanelSize: () => ({ breite: 1280, hoehe: 854, fenster: { breite: 1280, hoehe: 854 }, skalierung: 1, drehung: 0 }),
  sperrenSoll: 2,
  gestartetAm: Date.now() - 3 * 60 * 60 * 1000
});

// Der Akkustand kommt sonst von der Anzeige selbst. Hier einmal untergeschoben, damit die
// Zeile nicht auf "unbekannt" steht.
setTimeout(() => {
  fetch(`http://localhost:${PORT}/api/geraet/akku`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fall === 'schlecht'
      ? { prozent: 12, laedt: false }
      : { prozent: 100, laedt: true })
  }).catch(() => {});
}, 400);

console.log(`Probe (${fall}) laeuft: http://localhost:${PORT}/setup/status.html`);
