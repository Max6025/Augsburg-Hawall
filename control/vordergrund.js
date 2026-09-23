'use strict';

/**
 * Das Fenster nach vorne zurueckholen, wenn etwas anderes es verdrängt.
 *
 * WARUM DIE REGISTRY HIER NICHT REICHT
 *
 * Die Windows-Taste ALLEIN oeffnet das Startmenue, und dafuer gibt es keinen Registry-Wert,
 * den ein unelevierter Prozess setzen koennte. `NoWinKeys` nimmt nur den Kombinationen die
 * Wirkung (Win+A, Win+C, Win+X). Windows' eigene Antwort waere "Zugewiesener Zugriff", also
 * der echte Kioskmodus -- der braucht Administratorrechte und legt das Geraet auf ein
 * einziges Programm fest. Beides passt hier nicht.
 *
 * Was bleibt, ist der Umstand, dass Startmenue und Benachrichtigungscenter **Ausklappfenster**
 * sind: Sie schliessen sich von selbst, sobald sie den Fokus verlieren. Holt man den Fokus
 * zurueck, sind sie wieder weg. Das braucht keine Rechte und keine Registry.
 *
 * DREI DINGE, DIE DARAN HAENGEN
 *
 * 1. **Nur bei versteckter Taskleiste.** Laeuft eine Wartung, ist die Taskleiste absichtlich
 *    da, und dann WILL jemand an Windows -- ihm den Fokus wegzunehmen waere das Gegenteil von
 *    hilfreich. `taskleisteBis` ist der Schalter dafuer, derselbe, an dem auch das Ende der
 *    gemeldeten Wartung haengt.
 * 2. **Eine Bremse.** Laesst sich das Fenster nicht in den Vordergrund holen -- auf dem
 *    Sperrbildschirm zum Beispiel --, wuerde der Rueckholer endlos gegen Windows anrennen und
 *    dabei das Geraet beschaeftigen. Nach einer Haeufung von Versuchen gibt er deshalb fuer
 *    eine halbe Minute Ruhe und schreibt eine Zeile ins Protokoll.
 * 3. **Entschieden wird hier, gehandelt in main.js.** Dieses Modul kennt kein Electron und
 *    keinen Zeitgeber; es beantwortet nur die Frage "zurueckholen, und wann". Nur so ist die
 *    Bremse pruefbar, ohne eine halbe Minute zu warten.
 */

// Kurz warten, statt sofort. Das Startmenue braucht einen Moment, bis es ueberhaupt oben ist;
// ein Fokuswechsel im selben Augenblick laesst es manchmal offen stehen.
const ABSTAND_MS = 150;
// So viele Versuche in diesem Zeitraum gelten als Kampf gegen Windows.
const HAEUFUNG = 6;
const HAEUFUNG_FENSTER_MS = 4000;
const RUHE_MS = 30 * 1000;

class Vordergrund {
  constructor({ log, jetzt } = {}) {
    this.log = log || (() => {});
    this.jetzt = jetzt || (() => Date.now());
    this.versuche = [];
    this.ruheBis = 0;
  }

  /**
   * Das Fenster hat den Fokus verloren. Zurueckholen?
   *
   * @param {object|null} state Der Zustand der Steuerung
   * @returns {{holen: boolean, verzoegerung?: number, grund?: string}}
   */
  verloren(state) {
    const jetzt = this.jetzt();

    if (state && state.taskleisteBis) {
      return { holen: false, grund: 'wartung' };
    }
    if (jetzt < this.ruheBis) {
      return { holen: false, grund: 'ruhe' };
    }

    this.versuche = this.versuche.filter(t => jetzt - t < HAEUFUNG_FENSTER_MS);
    this.versuche.push(jetzt);

    if (this.versuche.length > HAEUFUNG) {
      this.ruheBis = jetzt + RUHE_MS;
      this.versuche = [];
      this.log('warn', `Das Fenster laesst sich nicht nach vorne holen (${HAEUFUNG}+ Versuche `
        + `in ${HAEUFUNG_FENSTER_MS} ms). ${RUHE_MS / 1000} Sekunden Ruhe -- liegt der `
        + 'Sperrbildschirm davor, ist das normal.');
      return { holen: false, grund: 'haeufung' };
    }

    return { holen: true, verzoegerung: ABSTAND_MS };
  }

  /** Nach einem geglueckten Rueckholen: Der Zaehler faengt von vorne an. */
  geglueckt() {
    this.versuche = [];
    this.ruheBis = 0;
  }
}

module.exports = { Vordergrund, ABSTAND_MS, HAEUFUNG, HAEUFUNG_FENSTER_MS, RUHE_MS };
