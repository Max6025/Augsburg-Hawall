// Die Bühne: driftende Farbwolken als bewegter Hintergrund.
//
// Herkunft: Sie stammt aus dem Ankunftsschirm der Vorlage (Italien Wall Display) und ist das
// einzige Stück daraus, das dieses Projekt behalten hat. Dort war sie fest mit einer Begrüßung
// verwachsen; hier steht sie für sich, weil der Bildschirmschoner sie braucht und sonst
// niemand. Wer sie wieder in eine Anzeige einbaut, baut die alte Verwachsung nach.
//
// Technisch ein **Partikelsystem**: eine feste Zahl von Formen, jede mit eigener Lebensdauer.
// Eine Form wird geboren, driftet zu einem zufälligen Ziel, verblasst und wird woanders neu
// geboren.
//
// Der Zufall läuft AUSSCHLIESSLICH bei der Geburt einer Form, also alle elf bis neunzehn
// Sekunden. Dazwischen bewegt der Browser auf der Grafikeinheit, nicht JavaScript. Wer das
// ändert und pro Bild rechnet, kostet das Gerät die Bildrate -- auf einem Surface Go ist das
// kein theoretischer Einwand.
//
// Keine Entscheidung, keine Uhr, kein Netz: Die Bühne weiß nicht, warum sie läuft. Ob sie
// laufen soll, entscheidet der Bildschirmschoner.

(function (global) {
  'use strict';

  const ANZAHL_FORMEN_VORGABE = 6;
  // Lebensdauer einer Form in Sekunden. Kürzer heißt mehr Bewegung.
  const LEBEN_MIN = 11;
  const LEBEN_MAX = 19;

  const z = (a, b) => a + Math.random() * (b - a);

  /**
   * @param {Element} wurzel   Element, in das die Formen gelegt werden. Muss positioniert sein.
   * @param {object}  [optionen]
   * @param {number}  [optionen.anzahl]  Wie viele Formen gleichzeitig unterwegs sind
   * @param {number}  [optionen.tonVon]  Untere Grenze des Farbkreis-Ausschnitts in Grad
   * @param {number}  [optionen.tonBis]  Obere Grenze
   */
  function Buehne(wurzel, optionen) {
    const opt = optionen || {};
    this.wurzel = wurzel;
    // Der Farbausschnitt gehört dem Aufrufer, nicht der Bühne: Ein ruhiger Schirm nimmt einen
    // schmalen Ausschnitt, ein festlicher den ganzen Kreis. Die Geburt einer Form bleibt für
    // beide dieselbe Rechnung.
    this.tonVon = opt.tonVon === undefined ? 0 : opt.tonVon;
    this.tonBis = opt.tonBis === undefined ? 360 : opt.tonBis;
    this.formen = [];
    this.aktiv = false;

    const anzahl = Number(opt.anzahl) > 0 ? Math.round(Number(opt.anzahl)) : ANZAHL_FORMEN_VORGABE;
    for (let i = 0; i < anzahl; i++) {
      const el = document.createElement('div');
      el.className = 'buehne-form';
      this.wurzel.appendChild(el);
      this.formen.push({ el, timerAus: 0, timerNeu: 0 });
    }
  }

  Buehne.prototype._gebaeren = function (form) {
    const el = form.el;
    const groesse = z(26, 62);
    el.style.width = groesse + 'vw';
    el.style.height = groesse * z(0.7, 1.25) + 'vw';
    el.style.setProperty('--buehne-weich', Math.round(groesse * z(1.1, 1.9)) + 'px');
    el.style.background = 'radial-gradient(circle at ' + z(30, 70) + '% ' + z(30, 70) + '%, ' +
      'hsl(' + z(this.tonVon, this.tonBis) + ' ' + z(72, 96) + '% ' + z(52, 68) + '%), transparent 70%)';
    el.style.transition = 'none';
    el.style.left = z(-15, 100) + 'vw';
    el.style.top = z(-15, 100) + 'vh';
    el.style.transform = 'translate3d(0,0,0) scale(' + z(0.8, 1.05) + ')';
    el.style.opacity = '0';

    void el.offsetWidth; // Startzustand übernehmen, bevor der Übergang beginnt

    const leben = z(LEBEN_MIN, LEBEN_MAX);
    const blende = Math.min(6, leben / 4);
    el.style.transition = 'transform ' + leben + 's cubic-bezier(.37,.16,.32,.96), opacity ' + blende + 's ease-in-out';
    el.style.transform = 'translate3d(' + z(-38, 38) + 'vw, ' + z(-34, 34) + 'vh, 0) scale(' + z(0.85, 1.5) + ')';
    el.style.opacity = String(z(0.45, 0.9));

    clearTimeout(form.timerAus);
    clearTimeout(form.timerNeu);
    form.timerAus = setTimeout(() => { el.style.opacity = '0'; }, (leben - blende) * 1000);
    form.timerNeu = setTimeout(() => this._gebaeren(form), leben * 1000);
  };

  Buehne.prototype.starten = function () {
    this.aktiv = true;
    this.formen.forEach((form, i) => {
      clearTimeout(form.timerAus);
      clearTimeout(form.timerNeu);
      // Versetzt starten, damit nicht alle gleichzeitig auftauchen
      form.timerNeu = setTimeout(() => this._gebaeren(form), i * z(300, 1400));
    });
  };

  Buehne.prototype.stoppen = function () {
    // Wichtig fürs Wandpanel: Läuft die Bühne nicht, darf auch nichts mehr rechnen.
    this.aktiv = false;
    this.formen.forEach(form => {
      clearTimeout(form.timerAus);
      clearTimeout(form.timerNeu);
      form.el.style.opacity = '0';
    });
  };

  Buehne.prototype.laeuft = function () { return !!this.aktiv; };

  const api = { Buehne, ANZAHL_FORMEN_VORGABE, LEBEN_MIN, LEBEN_MAX };
  global.BuehneModul = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
