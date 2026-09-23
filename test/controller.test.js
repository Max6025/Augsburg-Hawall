const test = require('node:test');
const assert = require('node:assert');
const { Controller, isWithinNightLock, GRACE_MS, TASKLEISTE_MS, ABSCHIED_MS } = require('../control/controller');

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
  // setTaskleiste MUSS mit abgeklemmt werden, und zwar aus einem handfesten Grund: Mit
  // `supported = true` wuerde der echte Aufruf einen PowerShell-Prozess starten und
  // `Taskleiste-Aus` senden -- der Testlauf versteckt dann die Taskleiste des Rechners, auf dem
  // er laeuft, und der Dauerprozess haelt `node --test` am Leben, bis das Zeitlimit zuschlaegt.
  // Genau das ist auf dem Windows-Runner passiert. Wer hier einen Controller mit
  // `supported = true` baut, klemmt ALLE drei Panel-Aufrufe ab.
  c.panel.setTaskleiste = () => true;
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
  c.panel.setTaskleiste = () => true;     // sonst echtes PowerShell, siehe controllerMitAkku
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
  aus.panel.setTaskleiste = () => true;   // sonst echtes PowerShell, siehe controllerMitAkku
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

// --- Die Taskleiste dauerhaft ausblenden ---------------------------------------------------
//
// Die Taskleiste ist die dritte Sache, die am Waechter-Takt haengt (nach dem Panel und dem
// Wachhalten), und sie haengt dort aus einem Grund: Ausblenden HAELT NICHT. Windows legt bei
// jedem Explorer-Neustart und jeder Anmeldung eine frische, sichtbare Leiste an. Ein Test, der
// nur "wird einmal ausgeblendet" prueft, wuerde genau das durchlassen, was auf der Wand
// auffaellt -- eine Taskleiste, die irgendwann einfach wieder da ist.
//
// Zweite Falle, die hier abgedeckt ist: Sichtbarmachen ohne Kiosk-Ausstieg. Die Leiste waere
// dann sichtbar, laege aber unter dem Fenster -- man sieht sie und trifft sie nicht.

function controllerMitLeiste(values = IMMER_NACHT) {
  const kiosk = [];
  const c = new Controller({
    store: fakeStore(values), logDir: null, setKiosk: (k) => kiosk.push(k)
  });
  c.panel.supported = true;
  c.panel.setPower = () => true;          // kein PowerShell im Test
  c.panel.setSystemWach = () => true;
  c.leiste = [];
  c.panel.setTaskleiste = (s) => { c.leiste.push(s); return true; };
  c.kiosk = kiosk;
  c.startedAt = Date.now() - 2 * GRACE_MS;
  return c;
}

test('Jeder Takt blendet die Taskleiste erneut aus', () => {
  // Nachschalten, wie beim Panel in der Nachtsperre: Der Befehl ist bei versteckter Leiste
  // wirkungslos und billig -- und ohne ihn stuende die Leiste ab dem naechsten
  // Explorer-Neustart ueber dem Dashboard, bis jemand davorsteht und es sieht.
  const c = controllerMitLeiste();
  c.tick(); c.tick(); c.tick();
  assert.deepStrictEqual(c.leiste, [false, false, false]);
});

test('Der Kiosk-Modus wird nur beim Wechsel angefasst, nicht bei jedem Takt', () => {
  // Ein Fenster, das alle fuenf Sekunden neu in den Kiosk-Modus gesetzt wird, flackert und
  // zieht den Fokus an sich. Anders als die Leiste bringt Windows es nicht von selbst
  // durcheinander -- hier waere Nachschalten der Fehler.
  const c = controllerMitLeiste();
  c.tick(); c.tick(); c.tick();
  assert.deepStrictEqual(c.kiosk, [true], 'einmal gesetzt genuegt');
});

test('taskleisteZeigen blendet die Leiste ein und verlaesst den Kiosk-Modus', () => {
  const c = controllerMitLeiste();
  c.tick();
  c.leiste = []; c.kiosk.length = 0;
  c.taskleisteZeigen();
  assert.deepStrictEqual(c.leiste, [true]);
  assert.deepStrictEqual(c.kiosk, [false], 'sonst liegt das Fenster ueber der Leiste');
});

test('Die Sichtbarkeit endet von selbst -- und der Kiosk-Modus kommt zurueck', () => {
  // Ein Wandpanel, das seit drei Wochen mit sichtbarer Taskleiste haengt, weil jemand die
  // Wartung nicht abgeschlossen hat, ist von einem kaputten nicht zu unterscheiden.
  const c = controllerMitLeiste();
  c.taskleisteZeigen();
  c.leiste = []; c.kiosk.length = 0;

  c.taskleisteBis = Date.now() - 1;       // Frist bewusst abgelaufen
  c.tick();
  assert.deepStrictEqual(c.leiste, [false]);
  assert.deepStrictEqual(c.kiosk, [true]);
  assert.strictEqual(c.state.taskleisteBis, 0, 'eine abgelaufene Frist gehoert nicht in den Zustand');
});

test('Die voreingestellte Sichtbarkeit sind fuenf Minuten', () => {
  const c = controllerMitLeiste();
  const bis = c.taskleisteZeigen();
  assert.ok(Math.abs(bis - (Date.now() + TASKLEISTE_MS)) < 2000);
  assert.strictEqual(c.state.taskleisteBis, bis, 'die Einrichtungsseite liest das aus dem Zustand');
});

test('taskleisteVerbergen blendet vorzeitig wieder aus', () => {
  const c = controllerMitLeiste();
  c.taskleisteZeigen();
  c.leiste = []; c.kiosk.length = 0;
  c.taskleisteVerbergen();
  assert.deepStrictEqual(c.leiste, [false]);
  assert.deepStrictEqual(c.kiosk, [true]);
  assert.strictEqual(c.taskleisteSoll(), false);
});

test('Der Wartungs-Ausstieg pausiert UND blendet die Leiste ein', () => {
  // Beides einzeln waere hier falsch: Eine Taskleiste auf einem Panel, das sich in fuenf
  // Sekunden abschaltet, nuetzt nichts -- und eine Pause ohne Taskleiste laesst niemanden an
  // Windows. Das ist der Punkt, an dem die drei Wege vor dem Geraet zusammenlaufen.
  const c = controllerMitLeiste();
  const r = c.wartung();
  assert.ok(r.pausedUntil > Date.now(), 'ohne Pause schaltet der Waechter gleich wieder ab');
  assert.ok(r.taskleisteBis > Date.now());
  assert.strictEqual(c.decide().reason, 'pause');
  assert.strictEqual(c.taskleisteSoll(), true);
});

test('Die Pause allein blendet die Taskleiste NICHT ein', () => {
  // Der Weg vom Handy (/api/panel/pause) bleibt eine reine Pause: Wer aus dem Netz pausiert,
  // steht nicht davor, und eine Taskleiste auf einem unbeaufsichtigten Wandpanel wartet nur
  // darauf, dass jemand im Vorbeigehen das Startmenue oeffnet.
  const c = controllerMitLeiste();
  c.pause();
  assert.strictEqual(c.taskleisteSoll(), false);
  assert.deepStrictEqual(c.leiste, [false]);
});

test('Ein Fenster, das nicht mehr da ist, haelt die Steuerung nicht auf', () => {
  // Beim Update und beim Beenden ist das Fenster weg, der Takt laeuft aber noch.
  const zeilen = [];
  const c = new Controller({
    store: fakeStore(IMMER_NACHT), logDir: null,
    setKiosk: () => { throw new Error('Fenster zerstoert'); }
  });
  c.panel.supported = true;
  c.panel.setPower = () => true;
  c.panel.setSystemWach = () => true;
  c.panel.setTaskleiste = () => true;
  c.log = (stufe, text) => zeilen.push(stufe + ': ' + text);
  c.startedAt = Date.now() - 2 * GRACE_MS;
  c.tick();
  assert.strictEqual(c.state.panelOn, false, 'die Nachtsperre gilt weiterhin');
  assert.ok(zeilen.some(z => z.includes('Kiosk-Modus konnte nicht')), 'und es steht im Protokoll');
});

test('main.js reicht den Kiosk-Schalter ueberhaupt herein', () => {
  // Dieselbe Lehre wie bei aufAkku (1.0.4): Der Controller kann noch so richtig entscheiden --
  // ohne diese Anbindung kaeme das Fenster nie aus dem Kiosk-Modus, und die eingeblendete
  // Taskleiste laege darunter. Eine Funktion, die niemand aufruft, ist dasselbe wie eine, die
  // es nicht gibt.
  const main = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /setKiosk:/, 'main.js uebergibt kein setKiosk an den Controller');
  assert.match(main, /function kioskSetzen/, 'main.js kann den Kiosk-Modus nicht umschalten');
  assert.match(main, /setFullScreen\(false\)/,
    'setKiosk(false) allein laesst das Fenster im Vollbild -- die Leiste bliebe zugedeckt');
  assert.match(main, /controller\.wartung\(\)/, 'Strg+Alt+W loest keinen Wartungs-Ausstieg aus');
  assert.match(main, /taskleisteFreigeben/,
    'Strg+Alt+Q wuerde ein Windows ohne Startmenue zuruecklassen');
});

test('Die Tipp-Geste im Dashboard nimmt denselben Weg', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const lies = (...t) => fs.readFileSync(path.join(__dirname, '..', ...t), 'utf8');
  assert.match(lies('preload.js'), /wartungAnfordern/, 'preload bietet den Weg nicht an');
  assert.match(lies('main.js'), /'wartung-anfordern'/, 'main.js nimmt ihn nicht an');
  assert.match(lies('renderer', 'dashboard.html'), /wartungAnfordern/,
    'die Tipp-Geste pausiert nur und laesst niemanden an Windows');
});

test('Der Weg aus dem Netz hat seinen Knopf und seine Route', () => {
  // Seit 1.0.11 auf der STATUSSEITE, nicht mehr unter Einstellungen: Eine Einstellung gilt bis
  // auf Widerruf, das hier sind Handlungen fuer genau jetzt -- und wer nachsieht, ob alles
  // laeuft, ist derjenige, der eingreifen will.
  const fs = require('node:fs');
  const path = require('node:path');
  const lies = (...t) => fs.readFileSync(path.join(__dirname, '..', ...t), 'utf8');
  assert.match(lies('renderer', 'setup', 'status.html'), /id="panelWartungBtn"/);
  assert.match(lies('renderer', 'setup', 'status.js'), /\/api\/panel\/wartung/);
  assert.match(lies('server', 'setup-server.js'), /\/api\/panel\/wartung/);
  assert.match(lies('server', 'setup-server.js'), /\/api\/panel\/taskleiste-aus/);
});

// --- Hat das Geraet geschlafen? ---------------------------------------------------------------
//
// Anlass, gemeldet am 2026-09-23 um 00:41: Das Geraet hing am Strom, "Geraet wach halten" war
// angehakt, Nachtsperre aktiv -- und die Einrichtungsseite antwortete nicht mehr. Von aussen
// ist das nicht von einem Absturz und nicht von einem WLAN-Problem zu unterscheiden, und weil
// hinterher alles wieder laeuft, findet man am Geraet keine Spur.
//
// Die Luecke im eigenen Takt ist der Beweis. `powercfg /requests` waere genauer, verlangt aber
// erhoehte Rechte -- die App laeuft unelevert.

test('Eine Taktluecke wird erkannt und protokolliert', () => {
  const zeilen = [];
  const c = controllerMitLeiste();
  c.log = (stufe, text) => zeilen.push(stufe + ': ' + text);
  c.tick();
  c.letzterTakt = Date.now() - 3 * 60 * 1000;   // drei Minuten Stille
  c.tick();
  assert.ok(c.state.letzteSchlafluecke, 'die Luecke gehoert in den Zustand');
  assert.ok(c.state.letzteSchlafluecke.dauerMs >= 3 * 60 * 1000);
  assert.ok(zeilen.some(z => z.startsWith('warn') && z.includes('Taktluecke')),
    'und ins Protokoll, sonst sucht beim naechsten Mal wieder niemand an der richtigen Stelle');
});

test('Ein normaler Takt ist keine Schlafluecke', () => {
  // Windows verteilt Zeitgeber nicht auf die Millisekunde. Ein Fehlalarm pro Takt waere Laerm.
  const c = controllerMitLeiste();
  c.tick();
  c.tick();
  assert.strictEqual(c.state.letzteSchlafluecke, null);
});

test('Ein zusaetzlicher Takt erzeugt keine Luecke', () => {
  // pause(), resume() und taskleisteZeigen() ticken von Hand. Mehr Takte machen Luecken nur
  // kleiner -- aber das muss auch so bleiben.
  const c = controllerMitLeiste();
  c.tick();
  c.pause();
  c.taskleisteZeigen();
  assert.strictEqual(c.state.letzteSchlafluecke, null);
});

test('Der Zustand trennt gewuenschtes von gestelltem Wachhalten', () => {
  // Vorher meldete die Einrichtungsseite "wird wachgehalten", sobald es GEWUENSCHT war. Ohne
  // dauerhaften PowerShell-Prozess laesst sich die Anforderung gar nicht stellen -- ein Haken,
  // der nichts tut, und nichts, was darauf hinweist.
  const c = controllerMitLeiste();
  c.panel.setSystemWach = (w) => { c.panel.systemWach = w; c.panel.systemWachGestellt = false; return false; };
  c.tick();
  assert.strictEqual(c.state.systemWachhalten, true, 'gewuenscht ist es');
  assert.strictEqual(c.state.systemWach, true);
  assert.strictEqual(c.state.systemWachGestellt, false, 'gestellt wurde es nicht');
});

// --- "Noch nicht nachgesehen" ist keine Auskunft ueber die Aktualitaet ------------------------
//
// Gemeldet am 2026-09-23: GitHub hatte 1.0.10, das Geraet lief auf 1.0.9, und die Update-Seite
// schrieb "Kein Update verfuegbar. Diese Version ist aktuell." Die Suche selbst war in Ordnung
// -- ueber die API ausgeloest fand sie 1.0.10 und lud es herunter. Falsch war die ANZEIGE: Der
// Ausgangszustand "noch nie gesucht" sah genauso aus wie "gesucht und nichts gefunden".
//
// Das ist der Normalzustand dieser Seite, denn die App fragt GitHub von sich aus nie.

test('Der Updater-Zustand trennt "nicht geprueft" von "nichts gefunden"', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /geprueft: false/, 'der Anfangszustand kennt das Feld nicht');
  // Jedes der drei Ereignisse, die eine Suche beenden, muss es setzen -- sonst bleibt die
  // Seite in genau einem Fall bei der falschen Aussage stehen.
  const treffer = main.match(/geprueft: true/g) || [];
  assert.ok(treffer.length >= 3,
    `update-available, update-not-available und error muessen es setzen (gefunden: ${treffer.length})`);

  const seite = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'setup', 'update.js'), 'utf8');
  assert.match(seite, /!state\.geprueft/, 'die Seite unterscheidet die Faelle nicht');
  // Auf die RUECKGABE-Zeile pruefen, nicht auf den Satz irgendwo im Text -- der steht auch im
  // Kommentar darueber, und danach waere die Reihenfolge immer "falsch".
  const vorher = seite.indexOf('!state.geprueft');
  const nachher = seite.indexOf("return 'Kein Update verf");
  assert.notStrictEqual(vorher, -1, 'die Seite unterscheidet die Faelle nicht');
  assert.notStrictEqual(nachher, -1, 'die Rueckgabe wurde umbenannt -- Test nachziehen');
  assert.ok(vorher < nachher,
    'die Pruefung muss VOR der Aktualitaets-Behauptung stehen, sonst wirkt sie nicht');
});

// --- Abschied: ausblenden, bevor das Panel dunkel wird ---------------------------------------
//
// Ohne Vorlauf schaltet die Nachtsperre die Hintergrundbeleuchtung mitten im Bild ab. Auf einer
// Wand faellt genau dieser Sprung auf -- nicht das Abschalten selbst.
//
// Der Vorlauf verschiebt nur den ZEITPUNKT. An decide() aendert er nichts, und das ist der
// Punkt: Die Rangfolge bleibt die eine Stelle, an der entschieden wird.

function controllerAbschied() {
  const c = controllerMitLeiste(IMMER_NACHT);
  c.state = { panelOn: true };   // es war ein Bild da, von dem man sich verabschieden kann
  return c;
}

test('Beim Kippen auf AUS bleibt das Panel erst an und kuendigt an', () => {
  const c = controllerAbschied();
  const d = c.abschiedEinlegen(c.decide());
  assert.strictEqual(d.on, true, 'das Panel bleibt noch an');
  assert.strictEqual(d.reason, 'abschied');
  assert.strictEqual(d.danach, 'nachtsperre', 'und es steht dran, warum es gleich ausgeht');
});

test('Nach dem Vorlauf geht das Panel wirklich aus', () => {
  const c = controllerAbschied();
  c.abschiedEinlegen(c.decide());
  c.abschiedBis = Date.now() - 1;
  const d = c.abschiedEinlegen(c.decide());
  assert.strictEqual(d.on, false);
  assert.strictEqual(d.reason, 'nachtsperre');
});

test('Wer IN die Nachtsperre hinein startet, blendet nicht aus', () => {
  // Da war nie ein Bild. Ein Ausblenden aus dem Nichts waere eine Verzoegerung ohne Wirkung --
  // und nach einem Windows-Update mitten in der Nacht faellt genau die auf.
  const c = controllerMitLeiste(IMMER_NACHT);
  c.state = null;
  const d = c.abschiedEinlegen(c.decide());
  assert.strictEqual(d.on, false, 'sofort aus');
  assert.strictEqual(c.abschiedBis, 0, 'und kein Vorlauf gesetzt');
});

test('Wird wieder eingeschaltet, ist der Vorlauf zurueckgesetzt', () => {
  const c = controllerAbschied();
  c.abschiedEinlegen(c.decide());
  assert.ok(c.abschiedBis > 0);
  c.abschiedEinlegen({ on: true, reason: 'pause' });
  assert.strictEqual(c.abschiedBis, 0, 'sonst greift beim naechsten Abschalten kein Vorlauf');
});

test('Der Zustand meldet den Abschied und seine Dauer', () => {
  // Die Dauer reist MIT. Eine zweite Zahl im CSS waere beim naechsten Aendern eine andere --
  // dieselbe Lehre wie bei TOR_TAKT.
  const c = controllerAbschied();
  c.tick();
  assert.strictEqual(c.state.abschied, true);
  assert.strictEqual(c.state.abschiedMs, ABSCHIED_MS);
  assert.strictEqual(c.state.panelOn, true, 'waehrend des Abschieds bleibt das Panel an');
});

test('Der Vorlauf aendert die Rangfolge in decide() nicht', () => {
  // Wer eine neue Regel braucht, baut sie in decide() ein und nicht in den Vorlauf.
  const c = controllerAbschied();
  assert.strictEqual(c.decide().on, false, 'decide() sagt weiterhin AUS');
  assert.strictEqual(c.decide().reason, 'nachtsperre');
});

test('Die Blende haengt an BEIDEN Wegen -- Zustand und Beruehrung', () => {
  // Eine Beruehrung weckt die Beleuchtung sofort (echte Eingabe, panel.js), die Steuerung
  // erfaehrt es erst beim naechsten Takt. Wer nur auf den Zustand hoert, zeigt dem, der gerade
  // angefasst hat, bis zu fuenf Sekunden Schwarz.
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dashboard.html'), 'utf8');
  assert.match(html, /id="panelBlende"/, 'die Blende fehlt im Markup');
  assert.match(html, /function blendeSetzen/, 'die Blende wird nie gesetzt');
  assert.match(html, /state\.abschied \|\| state\.panelOn === false/,
    'der Zustand schliesst die Blende nicht');
  // Der Eingabe-Weg: im selben Block, in dem letzteBedienung gesetzt wird.
  const block = html.slice(html.indexOf("['pointerdown', 'keydown'].forEach"));
  assert.match(block.slice(0, 600), /blendeSetzen\(false\)/,
    'eine Beruehrung blendet nicht auf -- dann klebt das Schwarz bis zum naechsten Takt');

  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'dashboard.css'), 'utf8');
  assert.match(css, /\.panel-blende\b/, 'die Blende hat kein CSS');
  assert.match(css, /pointer-events:\s*none/,
    'ohne das verschluckt die Blende den ersten Tipp -- genau den, der aufwecken soll');
  assert.match(css, /--blende-dauer/, 'die Dauer muss aus dem Zustand kommen, nicht aus dem CSS');
});
