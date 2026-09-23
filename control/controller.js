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
// Ein Zweites haengt hier: ob das SYSTEM wach bleiben soll, waehrend das Panel dunkel ist.
// Das ist nicht dieselbe Frage wie "Panel an?", sondern die Gegenfrage -- gerade WEIL das
// Panel aus ist, soll der Setup-Server erreichbar bleiben und die Steuerung weiterlaufen.
// Siehe den Kopf von control/panel.js: Ohne das geht mit dem Panel das ganze Geraet schlafen.
//
// Ab Werk AN, und zwar ohne Ausnahme fuer den Akku: Ein Wandpanel, dessen Weboberflaeche
// nachts nicht antwortet, ist von einem kaputten nicht zu unterscheiden.
//
// Abschaltbar ist es trotzdem, denn die richtige Antwort haengt am Geraet und nicht am Code:
// Das Surface beherrscht "Standby mit verbundenem Netzwerk" -- AM NETZ bleibt der Server also
// auch im Standby erreichbar, und dann ist Schlafenlassen das Sparsamere. Am AKKU wirft
// Windows das WLAN in einen tieferen Sparzustand, und nur Wachhalten hilft. Das kann diese
// Datei nicht entscheiden, das weiss nur, wer das Geraet aufgehaengt hat.
//
// Ein Drittes haengt hier: die TASKLEISTE von Windows. Auch das ist nicht die Frage "Panel an?",
// sondern eine eigene -- aber sie braucht genau dasselbe, was diese Datei ohnehin schon hat:
// einen Takt, der nachschaltet.
//
// Der Kiosk-Modus deckt die Leiste nur zu. Eine Wischgeste vom unteren Rand holt sie darueber,
// und ein Explorer-Neustart oder eine Anmeldung legt eine frische, sichtbare an. Deshalb wird
// das Fenster der Leiste versteckt (control/panel.js, setTaskleiste) und das Verstecken bei
// JEDEM Takt nachgeschaltet -- dieselbe Logik wie beim Panel in der Nachtsperre.
//
// Sichtbar wird sie nur auf Anforderung, und dann zeitlich begrenzt: taskleisteZeigen(). Dafuer
// muss das Fenster kurz aus dem Kiosk-Modus, sonst liegt es ueber der wieder eingeblendeten
// Leiste. Das kann diese Datei nicht selbst (sie kennt kein Electron) -- sie ruft dafuer den
// hereingereichten setKiosk() auf, genau wie idleSeconds() und aufAkku().
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
// So lange bleibt die Taskleiste nach einer Anforderung sichtbar. Sie endet von SELBST, wie die
// Pause: Ein Wandpanel, das seit drei Wochen mit sichtbarer Taskleiste haengt, weil jemand die
// Wartung nicht abgeschlossen hat, ist von einem kaputten nicht zu unterscheiden.
const TASKLEISTE_MS = 5 * 60 * 1000;
// Ab welcher Taktluecke das Geraet geschlafen hat. Vier Takte -- ein einzelner verspaeteter Takt
// (Windows verteilt Zeitgeber nicht auf die Millisekunde) ist keine Meldung wert, zwanzig
// Sekunden Stille dagegen schon.
const SCHLAF_SCHWELLE_MS = 4 * TICK_MS;

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
  constructor({ store, logDir, onStateChange, idleSeconds, aufAkku, setKiosk,
    schlafZeitgeber, energieNachziehen }) {
    this.store = store;
    this.idleSeconds = idleSeconds || (() => Infinity);
    // Ohne Angabe wird Netzbetrieb angenommen: Das ist der Normalfall fuer ein Wandpanel, und
    // faelschlich wach zu bleiben ist harmloser als ein Geraet, das nachts unerreichbar ist.
    this.aufAkku = aufAkku || (() => false);
    this.zuletztAufAkku = null;   // nur fuer die Warnung, nicht fuer die Entscheidung
    // Stehen die Schlaf-Zeitgeber auf "nie"? Nur zur Anzeige -- entschieden wird damit nichts.
    // Siehe control/energie.js: Stehen sie nicht, schlaeft das Geraet ein, sobald die
    // Nachtsperre das Panel abschaltet, und die Einrichtungsseite soll das sagen koennen.
    this.schlafZeitgeber = schlafZeitgeber || (() => null);
    // Wird gerufen, wenn eine Taktluecke auftritt: Dann stimmt etwas an den Zeitgebern nicht,
    // und der naechste Versuch kostet sechs billige Aufrufe. Selbstheilung statt einer Meldung,
    // die niemand liest.
    this.energieNachziehen = energieNachziehen || (() => {});
    // Schaltet das Fenster in den Kiosk-Modus (true) oder heraus (false). Wird aus dem
    // Hauptprozess hereingereicht, damit dieses Modul ohne Electron testbar bleibt.
    this.setKiosk = setKiosk || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.logFile = logDir ? path.join(logDir, 'panelsteuerung.log') : null;
    this.panel = new Panel((level, msg) => this.log(level, msg));

    this.startedAt = Date.now();
    this.pausedUntil = 0;
    this.taskleisteBis = 0;
    this.kioskZuletzt = null;   // zuletzt gesetzter Kiosk-Zustand, null = noch nie gesetzt
    this.letzterTakt = 0;
    this.letzteSchlafluecke = null;
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
      nightModeForceOn: !!g('nightModeForceOn', false),
      systemWachhalten: g('systemWachhalten', true) !== false
    };
  }

  decide(now = new Date()) {
    const cfg = this.config();
    if (now.getTime() - this.startedAt < GRACE_MS) return { on: true, reason: 'karenzzeit' };
    if (now.getTime() < this.pausedUntil) return { on: true, reason: 'pause' };
    if (isWithinNightLock(cfg, now)) return { on: false, reason: 'nachtsperre' };
    return { on: true, reason: 'dauerbetrieb' };
  }

  /**
   * Soll die Taskleiste gerade sichtbar sein?
   *
   * Die EINE Stelle, an der das entschieden wird -- dieselbe Disziplin wie bei decide() fuer das
   * Panel. Der Normalfall ist "aus", ohne Ausnahme und ohne Uhrzeit; sichtbar ist sie nur,
   * solange eine Anforderung laeuft. Bewusst NICHT in decide(): Zwei Antworten aus einer
   * Funktion widersprechen einander spaetestens beim naechsten Sonderfall.
   */
  taskleisteSoll(now = new Date()) {
    return now.getTime() < this.taskleisteBis;
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
      // Damit die Einrichtungsseite zeigen kann, dass gerade jemand am Geraet arbeitet -- und
      // ab wann die Leiste von selbst wieder verschwindet.
      taskleisteBis: this.taskleisteSoll(now) ? this.taskleisteBis : 0,
      // Damit die Einrichtungsseite erklaeren kann, warum das Geraet nachts nicht antwortet.
      //
      // Zwei Felder statt einem, und der Unterschied ist der Punkt: `systemWach` war der
      // WUNSCH und wurde als Tatsache angezeigt. Ohne dauerhaften PowerShell-Prozess laesst
      // sich die Anforderung gar nicht stellen -- die Seite meldete trotzdem "wird
      // wachgehalten". `systemWachGestellt` sagt, was wirklich angefordert wurde.
      systemWach: this.panel.systemWach === true,
      systemWachGestellt: this.panel.systemWachGestellt === true,
      systemWachhalten: cfg.systemWachhalten,
      // Der Beweis, dass das Geraet trotzdem geschlafen hat. Siehe schlaflueckeMessen().
      letzteSchlafluecke: this.letzteSchlafluecke,
      // null heisst "nicht zu ermitteln", nicht "in Ordnung" -- der Unterschied gehoert auf die
      // Seite, sonst behauptet sie Gewissheit, die sie nicht hat.
      schlafZeitgeber: this.schlafZeitgeberLesen()
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
    this.schlaflueckeMessen(now);
    const cfgJetzt = this.config();
    let decision = this.decide(now);

    // Nur pruefen, wenn tatsaechlich abgeschaltet wuerde. Sonst wuerde das Mauszeiger-Wackeln
    // beim Einschalten (siehe panel.js) sich selbst als Benutzereingabe zurueckmelden.
    if (!decision.on && this.beruecksichtigeEingabe(now)) {
      decision = this.decide(now);
    }

    this.panel.setPower(decision.on);

    // Unabhaengig davon, ob das Panel an oder aus ist.
    const wach = cfgJetzt.systemWachhalten;
    this.panel.setSystemWach(wach);
    if (wach) this.akkuWarnen();

    this.taskleisteSchalten(now);

    const next = this.buildState(decision, now);
    const changed = !this.state || JSON.stringify(this.state) !== JSON.stringify(next);
    this.state = next;
    if (changed) this.onStateChange(next);
  }

  schlafZeitgeberLesen() {
    try { return this.schlafZeitgeber(); } catch (e) { return null; }
  }

  /**
   * Hat das Geraet zwischen zwei Takten geschlafen?
   *
   * Eine Taktluecke ist der einzige Beweis, den dieses Programm ueber seinen eigenen Schlaf
   * fuehren kann. Waehrend Connected Standby laeuft nichts: kein Takt, kein Setup-Server, kein
   * Waechter. Von aussen ist das nicht von einem Absturz und nicht von einem WLAN-Problem zu
   * unterscheiden -- und weil hinterher alles wieder laeuft, findet man am Geraet keine Spur.
   *
   * `powercfg /requests` waere die genauere Antwort, verlangt aber erhoehte Rechte; die App
   * laeuft unelevert (siehe CLAUDE.md). Die Luecke im eigenen Takt kostet nichts und ist
   * trotzdem ein harter Beweis: Der Zeitgeber steht auf fuenf Sekunden, und wenn zwanzig
   * vergangen sind, hat jemand anderes entschieden, dass hier gerade nichts zu laufen hat.
   */
  schlaflueckeMessen(now) {
    const vorher = this.letzterTakt;
    this.letzterTakt = now.getTime();
    if (!vorher) return 0;
    const luecke = now.getTime() - vorher;
    if (luecke < SCHLAF_SCHWELLE_MS) return 0;
    this.letzteSchlafluecke = { ende: now.getTime(), dauerMs: luecke };
    this.log('warn', `Taktluecke von ${Math.round(luecke / 1000)} s -- das Geraet hat geschlafen. `
      + 'In dieser Zeit war die Weboberflaeche nicht erreichbar und der Waechter stand.');
    // Geschlafen heisst: An den Zeitgebern stimmt etwas nicht. Sie noch einmal setzen ist
    // billiger als eine Protokollzeile, die niemand liest.
    try { this.energieNachziehen(); } catch (e) { /* darf die Steuerung nie aufhalten */ }
    return luecke;
  }

  /**
   * Die Taskleiste und den Kiosk-Modus auf den gewuenschten Stand bringen.
   *
   * Der Unterschied zwischen den beiden ist der Grund, warum das hier auseinandersteht:
   *
   * Das AUSBLENDEN wird bei jedem Takt nachgeschaltet -- Windows bringt die Leiste von selbst
   * zurueck, und der Befehl ist bei versteckter Leiste wirkungslos und billig. Das ist dasselbe
   * Nachschalten, mit dem der Waechter das Panel in der Nachtsperre dunkel haelt.
   *
   * Der KIOSK-Modus wird nur beim Wechsel angefasst. Ein Fenster, das alle fuenf Sekunden neu
   * in den Kiosk-Modus gesetzt wird, flackert und zieht den Fokus an sich -- und anders als
   * die Leiste bringt Windows es nicht von selbst durcheinander.
   */
  taskleisteSchalten(now = new Date()) {
    const sichtbar = this.taskleisteSoll(now);
    this.panel.setTaskleiste(sichtbar);

    const kiosk = !sichtbar;
    if (this.kioskZuletzt === kiosk) return;
    this.kioskZuletzt = kiosk;
    try {
      this.setKiosk(kiosk);
    } catch (e) {
      // Das Fenster ist gerade weg (Update, Beenden). Die Leiste selbst ist davon unberuehrt.
      this.log('warn', `Kiosk-Modus konnte nicht umgeschaltet werden: ${e.message}`);
      return;
    }
    this.log('info', kiosk
      ? 'Kiosk-Modus wieder aktiv -- die Taskleiste ist ausgeblendet'
      : 'Kiosk-Modus verlassen -- die Taskleiste ist sichtbar');
  }

  /**
   * Einmal warnen, wenn das Geraet am Akku haengt und trotzdem wachgehalten wird.
   *
   * Nicht bei jedem Takt: Das waere alle fuenf Sekunden eine Zeile, und ein zugemuelltes
   * Protokoll ist genau dann wertlos, wenn man es braucht. Gewarnt wird beim WECHSEL --
   * damit man spaeter sieht, seit wann das Geraet ohne Strom durchwacht.
   */
  akkuWarnen() {
    let akku = false;
    try { akku = !!this.aufAkku(); } catch (e) { return; }
    if (akku === this.zuletztAufAkku) return;
    this.zuletztAufAkku = akku;
    this.log('warn', akku
      ? 'Akkubetrieb -- das System wird trotzdem wachgehalten, damit die Weboberflaeche '
        + 'erreichbar bleibt. Der Akku entlaedt sich dadurch deutlich schneller.'
      : 'Wieder am Netz.');
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

  /**
   * Die Taskleiste fuer eine begrenzte Zeit sichtbar machen.
   *
   * Das Fenster verlaesst dabei den Kiosk-Modus (siehe taskleisteSchalten) -- ohne das liegt es
   * ueber der Leiste, und die waere sichtbar, aber unerreichbar.
   */
  taskleisteZeigen(minuten) {
    const ms = (Number(minuten) > 0 ? Number(minuten) * 60 * 1000 : TASKLEISTE_MS);
    this.taskleisteBis = Date.now() + ms;
    this.log('info', `Taskleiste sichtbar bis ${new Date(this.taskleisteBis).toISOString()}`);
    this.tick();
    return this.taskleisteBis;
  }

  taskleisteVerbergen() {
    // Nur protokollieren, wenn die Leiste wirklich sichtbar war -- dieselbe Ueberlegung wie bei
    // resume(): Ein zugemuelltes Protokoll ist genau dann wertlos, wenn man es braucht.
    const lief = this.taskleisteSoll();
    this.taskleisteBis = 0;
    if (lief) this.log('info', 'Taskleiste vorzeitig wieder ausgeblendet');
    this.tick();
  }

  /**
   * Der Wartungs-Ausstieg: Pause UND sichtbare Taskleiste in einem Griff.
   *
   * Das ist, was jemand VOR DEM GERAET braucht, und deshalb haengen genau die drei Wege daran,
   * die man dort nimmt: der Knopf auf der Einstellungsseite, fuenfmal oben links tippen und
   * Strg+Alt+W. Beides einzeln waere hier falsch -- eine Taskleiste auf einem Panel, das sich
   * in fuenf Sekunden abschaltet, nuetzt nichts, und eine Pause ohne Taskleiste laesst niemanden
   * an Windows.
   *
   * Die Pause vom Handy aus (/api/panel/pause) bleibt bewusst eine reine Pause: Wer aus dem
   * Netz pausiert, steht nicht davor, und eine Taskleiste auf einem unbeaufsichtigten Panel
   * wartet nur darauf, dass jemand im Vorbeigehen das Startmenue oeffnet.
   */
  wartung(minuten) {
    const pausedUntil = this.pause(minuten);
    const taskleisteBis = this.taskleisteZeigen();
    return { pausedUntil, taskleisteBis };
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

  /**
   * Die Taskleiste zurueckgeben, weil die App fuer die Wartung beendet wird.
   *
   * Nur hierfuer, nicht in stop(): Beim Update beendet sich die App ebenfalls, und dort ist der
   * nackte Desktop gewollt. Wer dagegen Strg+Alt+Q drueckt, will an Windows -- und stuende ohne
   * das vor einem Desktop ohne Startmenue.
   */
  taskleisteFreigeben() {
    this.taskleisteBis = 0;
    return this.panel.taskleisteFreigeben();
  }

  stop() {
    clearInterval(this.tickTimer);
    this.panel.dispose();
  }
}

module.exports = {
  Controller, isWithinNightLock, parseHM,
  TICK_MS, GRACE_MS, PAUSE_MS, EINGABE_SEKUNDEN, EINGABE_PAUSE_MS, TASKLEISTE_MS
};
