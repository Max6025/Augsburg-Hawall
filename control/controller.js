// Der Zustandsautomat, der entscheidet, ob das Panel an oder aus sein soll.
//
// Die Rangfolge ist bewusst starr und steht an genau einer Stelle (decide()). Sie lautet von
// oben nach unten -- die erste zutreffende Regel gewinnt:
//
//   1. Karenzzeit nach dem Start  -> Panel an   (Rettungsanker nach einem Windows-Update)
//   2. Pause aktiv                -> Panel an   (jemand steht davor und will bedienen)
//   3. Nachtsperre aktiv          -> Panel aus  (nachts ist der Bildschirm wirklich aus)
//   4. sonst                      -> Panel an   (Dauerbetrieb; der Bildschirmschoner
//                                                uebernimmt das Ruhen, siehe unten)
//
// Der Unterschied zur Vorlage (Italien Wall Display) steckt in Regel 4. Dort entschied ein
// Kalender, ob ueberhaupt jemand im Haus ist, und der Normalzustand war "Panel aus". Hier wohnt
// jemand: Der Normalzustand ist "Panel an", und die einzige Ausnahme ist die Nacht.
//
// Was dadurch NICHT hierher gehoert: Der Bildschirmschoner. Er ist ein Overlay und schaltet
// nichts am Panel (siehe renderer/shared/bildschirmschoner.js und CONTEXT.md). Ueber das Panel
// entscheidet allein decide() -- zwei Stellen, die dasselbe schalten, widersprechen einander
// spaetestens beim naechsten Sonderfall.

const fs = require('fs');
const path = require('path');
const { Panel } = require('./panel');

const TICK_MS = 5 * 1000;               // Wächter-Takt
const GRACE_MS = 1 * 60 * 1000;         // Karenzzeit nach dem Start
const PAUSE_MS = 30 * 60 * 1000;        // Dauer einer Pause
const EINGABE_SEKUNDEN = 3;             // so frisch muss eine Eingabe sein, um als "jemand steht davor" zu gelten
const EINGABE_PAUSE_MS = 2 * 60 * 1000; // Pause, die eine solche Eingabe ausloest

function parseHM(str) {
  const parts = String(str || '').split(':').map(Number);
  if (isNaN(parts[0])) return null;
  return parts[0] * 60 + (parts[1] || 0);
}

// Nachtsperre darf über Mitternacht laufen (23:00 bis 06:30).
function isWithinNightLock(cfg, now) {
  if (!cfg.nightModeEnabled) return false;
  // Der Test-Schalter ignoriert die Uhrzeit. Er hat einen handfesten Zweck: Sonst laesst sich
  // "nachts wirklich aus" nur zwischen 23:00 und 06:30 pruefen -- und wer das um drei Uhr
  // nachts am Geraet macht, macht es genau einmal.
  //
  // In der Vorlage steuerte dieser Schalter das Nachtschwarz im Renderer. Das gibt es hier
  // nicht mehr; ohne diese Zeile waere er ein Feld ohne Wirkung, und davon hat dieses
  // Projekt schon genug gesehen (siehe CLAUDE.md, gauge.baseColor).
  if (cfg.nightModeForceOn) return true;
  const start = parseHM(cfg.nightStart || '23:00');
  const end = parseHM(cfg.nightEnd || '06:30');
  if (start === null || end === null || start === end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return start > end ? (cur >= start || cur < end) : (cur >= start && cur < end);
}

class Controller {
  /**
   * idleSeconds: liefert die Sekunden seit der letzten Benutzereingabe am Geraet.
   * Wird aus dem Hauptprozess hereingereicht (powerMonitor.getSystemIdleTime), damit dieses
   * Modul ohne Electron testbar bleibt. Ohne Angabe verhaelt es sich, als sei nie jemand da.
   */
  constructor({ store, logDir, onStateChange, idleSeconds }) {
    this.store = store;
    this.idleSeconds = idleSeconds || (() => Infinity);
    this.onStateChange = onStateChange || (() => {});
    this.logFile = logDir ? path.join(logDir, 'panelsteuerung.log') : null;
    this.panel = new Panel((level, msg) => this.log(level, msg));

    this.startedAt = Date.now();
    this.pausedUntil = 0;
    this.state = null;
    this.tickTimer = null;
  }

  log(level, message) {
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;
    if (!this.logFile) return;
    try {
      fs.appendFileSync(this.logFile, line);
    } catch (e) {
      // Protokollieren darf die Steuerung niemals zum Absturz bringen
    }
  }

  config() {
    const g = (k, d) => {
      const v = this.store.get(k);
      return v === undefined || v === null ? d : v;
    };
    return {
      nightModeEnabled: !!g('nightModeEnabled', false),
      nightStart: g('nightStart', '23:00'),
      nightEnd: g('nightEnd', '06:30'),
      nightModeForceOn: !!g('nightModeForceOn', false)
    };
  }

  decide(now = new Date()) {
    const cfg = this.config();
    if (now.getTime() - this.startedAt < GRACE_MS) return { on: true, reason: 'karenzzeit' };
    if (now.getTime() < this.pausedUntil) return { on: true, reason: 'pause' };
    if (isWithinNightLock(cfg, now)) return { on: false, reason: 'nachtsperre' };
    return { on: true, reason: 'dauerbetrieb' };
  }

  buildState(decision, now = new Date()) {
    const cfg = this.config();
    return {
      panelOn: decision.on,
      reason: decision.reason,
      nightModeEnabled: cfg.nightModeEnabled,
      nightStart: cfg.nightStart,
      nightEnd: cfg.nightEnd,
      pausedUntil: this.pausedUntil > now.getTime() ? this.pausedUntil : 0,
      graceUntil: this.startedAt + GRACE_MS,
      // Damit die Einrichtungsseite erklaeren kann, warum das Geraet nachts nicht antwortet.
      systemWach: this.panel.systemWach === true
    };
  }

  // Jemand steht am Geraet: Waehrend das Panel aus waere, hat gerade eine Eingabe stattgefunden.
  //
  // Das deckt den Fall ab, den weder "resume" noch "unlock-screen" sehen: Der Bildschirm ist bloss
  // dunkel geschaltet, niemand hat geschlafen und niemand hat sich entsperrt -- es hat einfach
  // jemand das Panel beruehrt. Ohne diese Regel schaltet der Waechter fuenf Sekunden spaeter
  // wieder ab, und wer davorsteht, kommt nicht ans Geraet.
  //
  // Hier ist das zugleich der einzige Weg aus der Nachtsperre heraus: Wer nachts hinlangt, will
  // etwas sehen und soll nicht vor einer Wand stehen, die sich nach fuenf Sekunden wieder
  // abschaltet.
  beruecksichtigeEingabe(now) {
    if (now.getTime() < this.pausedUntil) return false; // laeuft schon
    let idle;
    try { idle = this.idleSeconds(); } catch (e) { return false; }
    if (!(idle <= EINGABE_SEKUNDEN)) return false;
    this.pausedUntil = now.getTime() + EINGABE_PAUSE_MS;
    this.log('info', `Eingabe am Geraet erkannt -- Panelsteuerung pausiert ${EINGABE_PAUSE_MS / 60000} Minuten`);
    return true;
  }

  tick() {
    const now = new Date();
    let decision = this.decide(now);

    // Nur pruefen, wenn tatsaechlich abgeschaltet wuerde. Sonst wuerde das Mauszeiger-Wackeln
    // beim Einschalten (siehe panel.js) sich selbst als Benutzereingabe zurueckmelden.
    if (!decision.on && this.beruecksichtigeEingabe(now)) {
      decision = this.decide(now);
    }

    this.panel.setPower(decision.on);

    const next = this.buildState(decision, now);
    const changed = !this.state || JSON.stringify(this.state) !== JSON.stringify(next);
    this.state = next;
    if (changed) this.onStateChange(next);
  }

  pause(minutes) {
    const ms = (Number(minutes) > 0 ? Number(minutes) * 60 * 1000 : PAUSE_MS);
    this.pausedUntil = Date.now() + ms;
    this.log('info', `Pause gesetzt bis ${new Date(this.pausedUntil).toISOString()}`);
    this.tick();
    return this.pausedUntil;
  }

  resume() {
    // Nur protokollieren, wenn tatsaechlich eine Pause lief. Sonst fuellt jeder Druck auf
    // "Pause beenden" das Protokoll, auch wenn er nichts bewirkt -- und ein zugemuelltes
    // Protokoll ist genau dann wertlos, wenn man es braucht.
    const lief = this.pausedUntil > Date.now();
    this.pausedUntil = 0;
    if (lief) this.log('info', 'Pause vorzeitig beendet');
    this.tick();
  }

  getState() {
    if (!this.state) this.tick();
    return this.state;
  }

  // Nach dem Speichern der Einstellungen sofort neu entscheiden, statt bis zum naechsten Takt
  // zu warten: Wer die Nachtsperre verstellt, will das Ergebnis sofort sehen.
  refresh() {
    this.tick();
  }

  start() {
    this.log('info', 'Panelsteuerung gestartet');
    this.tick();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.tickTimer);
    this.panel.dispose();
  }
}

module.exports = { Controller, isWithinNightLock, parseHM, TICK_MS, GRACE_MS, PAUSE_MS, EINGABE_SEKUNDEN, EINGABE_PAUSE_MS };
