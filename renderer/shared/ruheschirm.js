// Der Ruheschirm: Wenn ein Termin läuft, muss das Dashboard nicht den ganzen Tag leuchten.
//
// Gemeldet wurde es als Frage: „Warum ist der Bildschirm die ganze Zeit an?" — und die Frage
// ist berechtigt. Während eines mehrtägigen Termins hält die Steuerung das Panel durchgehend
// eingeschaltet, damit jemand, der vorbeigeht, sein Dashboard sieht. Die meiste Zeit geht aber
// niemand vorbei, und dann steht eine helle Wand in einem leeren Raum.
//
// Statt dessen: ein fast schwarzer Schirm mit einer großen Aufforderung. Ein Tipp, und das
// Dashboard ist sofort da; nach einer Weile ohne Bedienung legt es sich wieder hin.
//
// Ausdrücklich NICHT dasselbe wie „Panel aus" (siehe CONTEXT.md): Das Panel bleibt an, die
// Steuerung entscheidet darüber weiterhin allein. Hier wird nur anders angezeigt — sonst
// gäbe es zwei Stellen, die das Panel schalten, und die widersprächen einander.
//
// Aufgeteilt wie der Ankunftsschirm:
//
//   sollRuhen()  -- reine Entscheidung, ohne DOM, ohne Uhr, ohne Netz.
//   Ruheschirm   -- die Anzeige. Kennt DOM, trifft aber keine Entscheidung.

(function (global) {
  'use strict';

  // Ab Werk: nach drei Minuten ohne Bedienung. Kurz genug, dass die Wand nicht stundenlang
  // leuchtet; lang genug, dass man ein Dashboard in Ruhe lesen kann, ohne es anzufassen.
  const RUHE_MINUTEN_VORGABE = 3;
  // Wie dunkel es dabei wird. Nicht ganz aus: Die Aufforderung muss lesbar bleiben, sonst
  // steht dort eine schwarze Scheibe, und niemand weiß, dass ein Tipp genügt.
  const RUHE_HELLIGKEIT_VORGABE = 12;
  const RUHE_TEXT_VORGABE = 'Zum Anzeigen tippen';

  /**
   * Soll der Ruheschirm gerade liegen?
   *
   * @param {object} p
   * @param {boolean} p.aktiviert        Einstellung „Ruheschirm verwenden"
   * @param {boolean} p.imTermin         Läuft gerade ein Anzeigefenster?
   * @param {boolean} p.schirmSichtbar   Ankunfts- oder Abschiedsschirm steht gerade
   * @param {boolean} p.nacht            Nachtschwarz liegt schon darüber
   * @param {number}  p.letzteBedienung  Zeitstempel in ms der letzten Berührung
   * @param {number}  p.minuten          Ruhe nach so vielen Minuten ohne Bedienung
   * @param {Date}    p.jetzt
   */
  function sollRuhen(p) {
    if (!p || !p.aktiviert) return false;

    // NUR während eines Termins. Außerhalb schaltet die Steuerung das Panel ohnehin ab
    // (siehe decide()) -- ein Ruheschirm davor wäre ein zweiter Schalter für dieselbe Sache,
    // und zwei Schalter für eine Sache widersprechen einander irgendwann.
    if (!p.imTermin) return false;

    // Wer begrüßt oder verabschiedet wird, soll das sehen und nicht eine Aufforderung zum
    // Tippen. Zwei Vollbilder übereinander sind ein Fehler, kein Entwurf.
    if (p.schirmSichtbar) return false;

    // Nachts liegt schon Schwarz darüber. Eine leuchtende Aufforderung darin wäre ausgerechnet
    // dann die einzige Lichtquelle im Raum, wenn jemand schlafen will.
    if (p.nacht) return false;

    const minuten = Number(p.minuten);
    const frist = (minuten > 0 ? minuten : RUHE_MINUTEN_VORGABE) * 60000;
    const letzte = Number(p.letzteBedienung);
    // Ohne bekannte letzte Bedienung wird geruht: Das ist der Zweck der Funktion, und ein
    // unbekannter Wert darf nicht dazu führen, dass die Wand doch wieder durchleuchtet.
    if (!Number.isFinite(letzte) || letzte <= 0) return true;

    const jetzt = (p.jetzt || new Date()).getTime();
    // Eine Bedienung aus der ZUKUNFT (Uhrumstellung, Zeitsprung nach dem Aufwachen) würde die
    // Frist sonst auf Stunden verlängern.
    if (letzte > jetzt) return false;
    return jetzt - letzte >= frist;
  }

  /** Wie hell es beim Ruhen sein soll -- begrenzt, damit die Schrift lesbar bleibt. */
  function ruheHelligkeit(wert) {
    const v = Number(wert);
    if (!Number.isFinite(v)) return RUHE_HELLIGKEIT_VORGABE;
    return Math.max(1, Math.min(60, Math.round(v)));
  }

  function Ruheschirm(wurzel, optionen) {
    const opt = optionen || {};
    this.wurzel = wurzel;
    this.beimWecken = opt.beimWecken || function () {};
    this.sichtbar = false;
    this._bauen();
  }

  Ruheschirm.prototype._bauen = function () {
    this.wurzel.innerHTML =
      '<div class="ru-mitte">' +
        '<div class="ru-kreis"><span class="ru-welle"></span><span class="ru-welle ru-welle-2"></span>' +
          '<svg class="ru-finger" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path fill="currentColor" d="M9 11.2V5.5a1.5 1.5 0 0 1 3 0v5.2h.5V4a1.5 1.5 0 0 1 3 0v6.7h.5V6.5a1.5 1.5 0 0 1 3 0V14c0 3.9-2.6 7-6.5 7-2.2 0-3.7-.9-4.8-2.5l-3-4.4a1.5 1.5 0 0 1 2.3-1.9L9 14.2v-3z"/>' +
          '</svg>' +
        '</div>' +
        '<p class="ru-text"></p>' +
      '</div>';

    // Ein Tipp irgendwo weckt. Auf pointerdown statt click: Der Schirm soll sich beim
    // Aufsetzen des Fingers verabschieden, nicht erst beim Loslassen -- das fuehlt sich sonst
    // an, als haette die Wand den ersten Tipp verschluckt.
    this.wurzel.addEventListener('pointerdown', (ev) => {
      if (!this.sichtbar) return;
      // Der Tipp gehoert dem Ruheschirm und darf NICHT zusaetzlich eine Karte darunter
      // schalten -- wer aufweckt, will nicht im Vorbeigehen das Licht ausmachen.
      ev.preventDefault();
      ev.stopPropagation();
      this.beimWecken();
    });
  };

  Ruheschirm.prototype.textSetzen = function (text) {
    const t = String(text == null ? '' : text).trim();
    this.wurzel.querySelector('.ru-text').textContent = t || RUHE_TEXT_VORGABE;
  };

  Ruheschirm.prototype.istSichtbar = function () { return !!this.sichtbar; };

  Ruheschirm.prototype.zeigen = function () {
    if (this.sichtbar) return;
    this.sichtbar = true;
    this.wurzel.classList.add('ru-sichtbar');
  };

  Ruheschirm.prototype.verbergen = function () {
    if (!this.sichtbar) return;
    this.sichtbar = false;
    this.wurzel.classList.remove('ru-sichtbar');
  };

  const api = { sollRuhen, ruheHelligkeit, Ruheschirm,
    RUHE_MINUTEN_VORGABE, RUHE_HELLIGKEIT_VORGABE, RUHE_TEXT_VORGABE };
  global.RuheschirmModul = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
