const test = require('node:test');
const assert = require('node:assert');
const { Controller, isWithinNightLock, GRACE_MS } = require('../control/controller');

// Ein Speicher, der sich wie electron-store verhaelt, ohne Electron zu brauchen.
function fakeStore(values = {}) {
  const data = { ...values };
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    delete: (k) => { delete data[k]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    _data: data
  };
}

// Die Nachtsperre ist in diesem Projekt der EINZIGE Grund, das Panel abzuschalten. Jeder Test,
// der ein ausgeschaltetes Panel braucht, muss sie deshalb setzen -- ohne sie ist die richtige
// Antwort immer "an".
const NACHTS = { nightModeEnabled: true, nightStart: '23:00', nightEnd: '06:30' };
const IN_DER_NACHT = new Date(2026, 0, 1, 23, 30);

function controllerWith(values) {
  const c = new Controller({ store: fakeStore(values), logDir: null });
  c.panel.supported = false; // im Test nie PowerShell starten
  return c;
}

test('Nachtsperre erkennt ein Fenster ueber Mitternacht', () => {
  const cfg = { nightModeEnabled: true, nightStart: '23:00', nightEnd: '06:30' };
  assert.ok(isWithinNightLock(cfg, new Date(2026, 0, 1, 23, 30)));
  assert.ok(isWithinNightLock(cfg, new Date(2026, 0, 1, 2, 0)));
  assert.ok(isWithinNightLock(cfg, new Date(2026, 0, 1, 6, 29)));
  assert.ok(!isWithinNightLock(cfg, new Date(2026, 0, 1, 6, 30)));
  assert.ok(!isWithinNightLock(cfg, new Date(2026, 0, 1, 12, 0)));
});

test('Nachtsperre erkennt auch ein Fenster innerhalb eines Tages', () => {
  const cfg = { nightModeEnabled: true, nightStart: '13:00', nightEnd: '15:00' };
  assert.ok(isWithinNightLock(cfg, new Date(2026, 0, 1, 14, 0)));
  assert.ok(!isWithinNightLock(cfg, new Date(2026, 0, 1, 16, 0)));
});

test('Ohne Nachtsperre bleibt das Panel dauerhaft an', () => {
  const c = controllerWith({});
  c.startedAt = Date.now() - 2 * GRACE_MS; // Karenzzeit bewusst vorbei
  const d = c.decide(new Date());
  assert.strictEqual(d.on, true);
  assert.strictEqual(d.reason, 'dauerbetrieb');
});

test('Eine abgeschaltete Nachtsperre schaltet auch nachts nicht ab', () => {
  const c = controllerWith({ nightModeEnabled: false, nightStart: '23:00', nightEnd: '06:30' });
  c.startedAt = IN_DER_NACHT.getTime() - 2 * GRACE_MS;
  assert.strictEqual(c.decide(IN_DER_NACHT).on, true);
});

test('Waehrend der Karenzzeit nach dem Start bleibt das Panel an', () => {
  // Rettungsanker: Nach einem Windows-Update startet die App neu, und wer dann davorsteht,
  // soll nicht auf eine Wand schauen, die sich sofort wieder abschaltet.
  const c = controllerWith(NACHTS);
  c.startedAt = IN_DER_NACHT.getTime() - 10 * 1000;
  const d = c.decide(IN_DER_NACHT);
  assert.strictEqual(d.on, true);
  assert.strictEqual(d.reason, 'karenzzeit');
});

test('Nach der Karenzzeit schaltet die Nachtsperre ab', () => {
  const c = controllerWith(NACHTS);
  c.startedAt = IN_DER_NACHT.getTime() - 2 * GRACE_MS;
  const d = c.decide(IN_DER_NACHT);
  assert.strictEqual(d.on, false);
  assert.strictEqual(d.reason, 'nachtsperre');
});

test('Die Pause schlaegt die Nachtsperre -- sonst waere das Geraet nachts nicht bedienbar', () => {
  const c = controllerWith(NACHTS);
  c.startedAt = IN_DER_NACHT.getTime() - 2 * GRACE_MS;
  c.pausedUntil = IN_DER_NACHT.getTime() + 10 * 60000;
  const d = c.decide(IN_DER_NACHT);
  assert.strictEqual(d.on, true);
  assert.strictEqual(d.reason, 'pause');
});

test('Eine abgelaufene Pause wirkt nicht mehr', () => {
  const c = controllerWith(NACHTS);
  c.startedAt = IN_DER_NACHT.getTime() - 2 * GRACE_MS;
  c.pausedUntil = IN_DER_NACHT.getTime() - 1000;
  assert.strictEqual(c.decide(IN_DER_NACHT).on, false);
});

test('pause() setzt ein Ende in der Zukunft, resume() hebt sie sofort auf', () => {
  const c = controllerWith({});
  const until = c.pause(15);
  assert.ok(until > Date.now() + 14 * 60000);
  c.resume();
  assert.strictEqual(c.pausedUntil, 0);
});

test('Der Zustand nennt die Nachtsperre, damit die Anzeige sie erklaeren kann', () => {
  const c = controllerWith(NACHTS);
  c.startedAt = IN_DER_NACHT.getTime() - 2 * GRACE_MS;
  const s = c.buildState(c.decide(IN_DER_NACHT), IN_DER_NACHT);
  assert.strictEqual(s.panelOn, false);
  assert.strictEqual(s.nightModeEnabled, true);
  assert.strictEqual(s.nightStart, '23:00');
  assert.strictEqual(s.nightEnd, '06:30');
});

// --- Eingabeerkennung -------------------------------------------------------------------------
//
// Anlass: Der Aussperr-Schutz ueber powerMonitor greift nur bei "resume" und "unlock-screen".
// Beruehrt jemand ein bloss dunkel geschaltetes Panel, feuert keines von beiden -- es gab weder
// Standby noch Entsperrung. Der Waechter schaltete fuenf Sekunden spaeter wieder ab, und wer
// davorstand, kam nicht ans Geraet.
//
// In diesem Projekt ist das zugleich der Weg aus der Nachtsperre: nachts hinlangen, Bild da.

function controllerMitLeerlauf(values, idle) {
  const c = new Controller({ store: fakeStore(values), logDir: null, idleSeconds: () => idle });
  c.panel.supported = false;
  return c;
}

// Eine Sperre, die unabhaengig von der Uhrzeit gilt. Dafuer ist der Test-Schalter da.
//
// Der erste Anlauf nahm statt dessen ein Fenster ueber den ganzen Tag (00:00 bis 23:59) -- und
// schlug am 2026-09-22 um 23:59:39 fehl. Das Ende eines Fensters ist AUSSCHLIESSEND (cur < end,
// wie bei 06:30 weiter oben), und damit fiel genau die letzte Minute des Tages heraus. Ein Test,
// der einmal taeglich fuer eine Minute rot wird, ist schlimmer als keiner: Man sucht den Fehler
// dort, wo keiner ist.
const IMMER_NACHT = { nightModeEnabled: true, nightModeForceOn: true, nightStart: '23:00', nightEnd: '06:30' };

test('Eine frische Eingabe in der Nacht pausiert, statt den Bildschirm wieder abzuschalten', () => {
  const c = controllerMitLeerlauf(IMMER_NACHT, 1); // vor einer Sekunde beruehrt
  c.startedAt = Date.now() - 2 * GRACE_MS;
  assert.strictEqual(c.decide(new Date()).on, false, 'ohne Eingabe waere abgeschaltet worden');
  c.tick();
  assert.ok(c.pausedUntil > Date.now(), 'es muss eine Pause gesetzt worden sein');
  assert.strictEqual(c.state.panelOn, true, 'das Panel bleibt an');
  assert.strictEqual(c.state.reason, 'pause');
});

test('Laengeres Nichtstun loest keine Pause aus', () => {
  const c = controllerMitLeerlauf(IMMER_NACHT, 600);
  c.startedAt = Date.now() - 2 * GRACE_MS;
  c.tick();
  assert.strictEqual(c.pausedUntil, 0);
  assert.strictEqual(c.state.panelOn, false);
});

test('Im Dauerbetrieb wird gar nicht erst auf Eingaben geschaut', () => {
  // Wichtig gegen eine Rueckkopplung: Das Einschalten wackelt mit dem Mauszeiger (panel.js).
  // Wuerde das als Benutzereingabe zaehlen, haette die Steuerung sich selbst am Leben gehalten.
  const c = controllerMitLeerlauf({}, 0);
  c.startedAt = Date.now() - 2 * GRACE_MS;
  c.tick();
  assert.strictEqual(c.pausedUntil, 0, 'keine Pause, weil ohnehin eingeschaltet wird');
  assert.strictEqual(c.state.reason, 'dauerbetrieb');
});

test('Ohne Leerlauf-Geber verhaelt sich der Controller wie bisher', () => {
  const c = new Controller({
    store: fakeStore(IMMER_NACHT),
    logDir: null
  });
  c.panel.supported = false;
  c.startedAt = Date.now() - 2 * GRACE_MS;
  c.tick();
  assert.strictEqual(c.pausedUntil, 0);
  assert.strictEqual(c.state.panelOn, false);
});

test('Ein fehlerhafter Leerlauf-Geber legt die Steuerung nicht lahm', () => {
  const c = new Controller({
    store: fakeStore(IMMER_NACHT),
    logDir: null,
    idleSeconds: () => { throw new Error('kaputt'); }
  });
  c.panel.supported = false;
  c.startedAt = Date.now() - 2 * GRACE_MS;
  c.tick();
  assert.strictEqual(c.state.panelOn, false, 'faellt auf das normale Verhalten zurueck');
});

test('Der Test-Schalter der Nachtsperre ignoriert die Uhrzeit', () => {
  // Ohne ihn liesse sich "nachts wirklich aus" nur zwischen 23:00 und 06:30 pruefen. In der
  // Vorlage steuerte er das Nachtschwarz im Renderer; das gibt es hier nicht mehr, und ohne
  // diesen Test faellt es niemandem auf, wenn der Schalter wieder wirkungslos wird.
  const mittags = new Date(2026, 0, 1, 12, 0);
  const c = controllerWith({ ...NACHTS, nightModeForceOn: true });
  c.startedAt = mittags.getTime() - 2 * GRACE_MS;
  const d = c.decide(mittags);
  assert.strictEqual(d.on, false);
  assert.strictEqual(d.reason, 'nachtsperre');
});

test('Der Test-Schalter wirkt nur bei eingeschalteter Nachtsperre', () => {
  const mittags = new Date(2026, 0, 1, 12, 0);
  const c = controllerWith({ nightModeEnabled: false, nightModeForceOn: true });
  c.startedAt = mittags.getTime() - 2 * GRACE_MS;
  assert.strictEqual(c.decide(mittags).on, true);
});

// --- Das System wach halten ---------------------------------------------------------------
//
// Anlass, und zwar ein peinlicher: Version 1.0.4 enthielt setSystemWach() in panel.js, aber
// NICHT den Aufruf im Controller -- ein abgebrochenes Bearbeitungsskript hatte die Datei nie
// geschrieben. Alle Tests waren gruen, weil keiner die Verbindung zwischen beiden prueft, und
// am Geraet zeigte `powercfg /requests` weiterhin "SYSTEM: Keine".
//
// Eine Funktion, die niemand aufruft, ist dasselbe wie eine, die es nicht gibt.

function controllerMitAkku(aufAkku) {
  const c = new Controller({ store: fakeStore(IMMER_NACHT), logDir: null, aufAkku });
  c.panel.supported = true;
  c.panel.setPower = () => true;          // kein PowerShell im Test
  c.gesendet = [];
  c.panel.setSystemWach = (w) => { c.gesendet.push(w); return true; };
  c.startedAt = Date.now() - 2 * GRACE_MS;
  return c;
}

test('Jeder Takt sagt dem Panel, dass das System wach bleiben soll', () => {
  const c = controllerMitAkku(() => false);
  c.tick();
  assert.deepStrictEqual(c.gesendet, [true]);
});

test('Auch auf Akku wird wachgehalten -- die Weboberflaeche geht vor', () => {
  // Ausdrueckliche Entscheidung: Ein Panel, dessen Weboberflaeche nachts nicht antwortet, ist
  // von einem kaputten nicht zu unterscheiden. Der Preis (schnellere Entladung) steht im
  // Protokoll. Wer das aendert, aendert die Entscheidung -- nicht heimlich die Bedingung.
  const c = controllerMitAkku(() => true);
  c.tick();
  assert.deepStrictEqual(c.gesendet, [true]);
});

test('Der Akkubetrieb wird gewarnt, aber nur beim Wechsel', () => {
  let akku = true;
  const zeilen = [];
  const c = new Controller({ store: fakeStore(IMMER_NACHT), logDir: null, aufAkku: () => akku });
  c.panel.supported = true;
  c.panel.setPower = () => true;
  c.panel.setSystemWach = () => true;
  c.log = (stufe, text) => zeilen.push(stufe + ': ' + text);
  c.startedAt = Date.now() - 2 * GRACE_MS;

  c.tick(); c.tick(); c.tick();
  const warnungen = zeilen.filter(z => z.includes('Akkubetrieb'));
  assert.strictEqual(warnungen.length, 1, 'alle fuenf Sekunden eine Zeile waere Laerm');

  akku = false;
  c.tick();
  assert.ok(zeilen.some(z => z.includes('Wieder am Netz')), 'die Rueckkehr gehoert auch ins Protokoll');
});

test('Ein fehlerhafter Akku-Geber haelt die Panelsteuerung nicht auf', () => {
  const c = controllerMitAkku(() => { throw new Error('kaputt'); });
  c.tick();
  assert.deepStrictEqual(c.gesendet, [true]);
  assert.strictEqual(c.state.panelOn, false, 'die Nachtsperre gilt weiterhin');
});

test('Der Zustand meldet, ob das System wachgehalten wird', () => {
  // Damit die Einrichtungsseite erklaeren kann, warum das Geraet nachts nicht antwortet.
  const c = controllerMitAkku(() => true);
  c.panel.systemWach = false;
  c.tick();
  assert.strictEqual(c.state.systemWach, false);
  c.panel.systemWach = true;
  c.tick();
  assert.strictEqual(c.state.systemWach, true);
});

test('main.js reicht den Akkuzustand ueberhaupt herein', () => {
  // Der Controller kann noch so richtig rechnen -- ohne diesen Geber bekaeme er nie mit,
  // dass das Geraet am Akku haengt. Genau diese Anbindung fehlte in 1.0.4.
  const main = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /aufAkku:/, 'main.js uebergibt kein aufAkku an den Controller');
  assert.match(main, /isOnBatteryPower/, 'main.js fragt den Akkuzustand nicht ab');
});

test('Die Einstellung entscheidet ueber das Wachhalten, nicht der Akku', () => {
  // Am Netz beherrscht das Surface "Standby mit verbundenem Netzwerk" -- dann ist Schlafen
  // sparsamer und die Seite trotzdem erreichbar. Am Akku trennt Windows das WLAN. Was richtig
  // ist, weiss nur, wer das Geraet aufgehaengt hat.
  const aus = new Controller({ store: fakeStore({ ...IMMER_NACHT, systemWachhalten: false }), logDir: null });
  aus.panel.supported = true; aus.panel.setPower = () => true;
  const g = []; aus.panel.setSystemWach = (w) => { g.push(w); return true; };
  aus.startedAt = Date.now() - 2 * GRACE_MS;
  aus.tick();
  assert.deepStrictEqual(g, [false], 'abgeschaltet heisst: schlafen lassen');
  assert.strictEqual(aus.state.systemWachhalten, false);
});

test('Ohne Einstellung wird wachgehalten', () => {
  // Ab Werk an: lieber ein erreichbares Geraet als ein sparsames, das nachts schweigt.
  const c = controllerMitAkku(() => true);
  c.tick();
  assert.deepStrictEqual(c.gesendet, [true]);
  assert.strictEqual(c.state.systemWachhalten, true);
});
