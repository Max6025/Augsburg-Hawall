// Der Bildschirmschoner: der RUHEZUSTAND dieses Geraets.
//
// Das ist der Punkt, an dem dieses Projekt sich von seiner Vorlage unterscheidet, und er ist
// leicht falsch herum zu lesen. In der Vorlage (Italien Wall Display) war das Dashboard der
// Normalfall und der Ruheschirm die Ausnahme: Es lief ein Termin, die Wand leuchtete, und
// wenn eine Weile niemand vorbeikam, legte sich ein fast schwarzes Overlay darueber.
//
// Hier ist es umgekehrt. Das Geraet haengt in einem bewohnten Haus und laeuft durch. Der
// Schoner LIEGT, und das Dashboard ist das, was man sich holt:
//
//   Start               -> Schoner
//   Tipp                -> Dashboard
//   n Minuten ohne Tipp -> Schoner
//   Nachtsperre         -> Panel wirklich aus (Sache von control/controller.js, nicht von hier)
//
// Daraus folgt eine Vorgabe, die man nicht uebersehen darf: `sollSchonen()` antwortet mit JA,
// solange keine Bedienung bekannt ist. Ein unbekannter Wert darf nicht dazu fuehren, dass die
// Wand doch wieder durchleuchtet -- das ist genau der Zustand, den der Schoner verhindern soll.
//
// Er schaltet NICHTS am Panel. Er ist ein Overlay, kein "Panel aus" (siehe CONTEXT.md). Ueber
// das Panel entscheidet allein decide() im Hauptprozess; zwei Stellen, die dasselbe schalten,
// widersprechen einander spaetestens beim naechsten Sonderfall.
//
// Aufgeteilt wie alles in diesem Projekt:
//
//   sollSchonen()      -- reine Entscheidung, ohne DOM, ohne Uhr, ohne Netz.
//   Bildschirmschoner  -- die Anzeige. Kennt DOM und Buehne, trifft aber keine Entscheidung.

(function (global) {
  'use strict';

  // Ab Werk: nach drei Minuten ohne Bedienung. Kurz genug, dass die Wand nicht stundenlang
  // ein Dashboard zeigt, das niemand liest; lang genug, dass man es in Ruhe ansehen kann,
  // ohne es dauernd anzufassen.
  const SCHONER_MINUTEN_VORGABE = 3;
  // Wie hell es dabei ist. Deutlich heller als der alte Ruheschirm (12 %): Der zeigte eine
  // schwarze Flaeche mit einer Aufforderung, dieser hier zeigt Karten, die man aus zwei
  // Metern lesen koennen soll.
  const SCHONER_HELLIGKEIT_VORGABE = 40;
  // Der Farbausschnitt der Buehne. Der ganze Farbkreis, wie beim Ankunftsschirm der Vorlage:
  // Dies ist die Flaeche, die man am haeufigsten sieht, und sie darf lebendig sein.
  const TON_VON = 0;
  const TON_BIS = 360;

  /**
   * Soll der Schoner gerade liegen?
   *
   * @param {object} p
   * @param {boolean} p.aktiviert        Einstellung "Bildschirmschoner verwenden"
   * @param {number}  p.letzteBedienung  Zeitstempel in ms der letzten Beruehrung
   * @param {number}  p.minuten          Ruhe nach so vielen Minuten ohne Bedienung
   * @param {Date}    [p.jetzt]
   */
  function sollSchonen(p) {
    if (!p || !p.aktiviert) return false;

    const minuten = Number(p.minuten);
    const frist = (minuten > 0 ? minuten : SCHONER_MINUTEN_VORGABE) * 60000;
    const letzte = Number(p.letzteBedienung);
    // Ohne bekannte letzte Bedienung wird geschont -- siehe Kopf der Datei.
    if (!Number.isFinite(letzte) || letzte <= 0) return true;

    const jetzt = (p.jetzt || new Date()).getTime();
    // Eine Bedienung aus der ZUKUNFT (Uhrumstellung, Zeitsprung nach dem Aufwachen) wuerde die
    // Frist sonst auf Stunden verlaengern.
    if (letzte > jetzt) return false;
    return jetzt - letzte >= frist;
  }

  /** Wie hell der Schoner sein soll -- begrenzt, damit die Karten lesbar bleiben. */
  function schonerHelligkeit(wert) {
    const v = Number(wert);
    if (!Number.isFinite(v)) return SCHONER_HELLIGKEIT_VORGABE;
    // Nicht bis null: Ein Bildschirm, der sich nicht mehr ablesen laesst, ist von einem
    // kaputten nicht zu unterscheiden -- und wer davorsteht, sucht den Fehler woanders.
    return Math.max(5, Math.min(100, Math.round(v)));
  }

  /**
   * Welcher Hintergrund gilt -- ohne DOM, damit pruefbar.
   *
   * Zwei Arten, und nur zwei. 'bild' faellt auf die Wolken zurueck, wenn gar kein Bild da ist:
   * Eine leere Flaeche saehe auf der Wand aus wie ein Absturz, und wer sie sieht, sucht den
   * Fehler am Geraet statt in einer Einstellung, die er selbst gesetzt hat.
   */
  function hintergrundArt(art, hatBild) {
    return (String(art || '') === 'bild' && hatBild) ? 'bild' : 'wolken';
  }

  function Bildschirmschoner(wurzel, optionen) {
    const opt = optionen || {};
    this.wurzel = wurzel;
    this.beimWecken = opt.beimWecken || function () {};
    this.sichtbar = false;
    this.buehne = null;
    this._bauen();
  }

  Bildschirmschoner.prototype._bauen = function () {
    this.wurzel.innerHTML =
      '<div class="bs-buehne"></div>' +
      '<div class="bs-bild"></div>' +
      '<div class="bs-raster"></div>' +
      '<div class="bs-inhalt"><div class="bs-karten"></div></div>';

    // Die Buehne bekommt ihr eigenes Element und laeuft nur, solange der Schoner liegt.
    this.buehne = new global.BuehneModul.Buehne(this.wurzel.querySelector('.bs-buehne'), {
      tonVon: TON_VON, tonBis: TON_BIS
    });

    // Ein Tipp irgendwo weckt. Auf pointerdown statt click: Der Schoner soll sich beim
    // Aufsetzen des Fingers verabschieden, nicht erst beim Loslassen -- das fuehlt sich sonst
    // an, als haette die Wand den ersten Tipp verschluckt.
    this.wurzel.addEventListener('pointerdown', (ev) => {
      if (!this.sichtbar) return;
      // Der Tipp gehoert dem Schoner und darf NICHT zusaetzlich eine Karte darunter schalten
      // -- wer aufweckt, will nicht im Vorbeigehen das Licht ausmachen.
      ev.preventDefault();
      ev.stopPropagation();
      this.beimWecken();
    });
  };

  /** Die Flaeche, in die das Dashboard seine Karten baut. */
  Bildschirmschoner.prototype.kartenFlaeche = function () {
    return this.wurzel.querySelector('.bs-karten');
  };

  /**
   * Hintergrund setzen. `bildUrl` darf leer sein -- dann bleibt es bei den Wolken.
   *
   * Die Buehne wird dabei gestoppt, wenn ein Bild gilt: Ein Partikelsystem, das unter einer
   * deckenden Flaeche weiterrechnet, kostet das Geraet Bildrate fuer nichts.
   */
  Bildschirmschoner.prototype.hintergrundSetzen = function (art, bildUrl) {
    const gilt = hintergrundArt(art, !!bildUrl);
    const bild = this.wurzel.querySelector('.bs-bild');
    if (gilt === 'bild') {
      bild.style.backgroundImage = 'url("' + String(bildUrl).replace(/"/g, '&quot;') + '")';
      this.wurzel.classList.add('bs-mit-bild');
      this.buehne.stoppen();
    } else {
      bild.style.backgroundImage = '';
      this.wurzel.classList.remove('bs-mit-bild');
      if (this.sichtbar) this.buehne.starten();
    }
    this.art = gilt;
    return gilt;
  };

  Bildschirmschoner.prototype.istSichtbar = function () { return !!this.sichtbar; };

  Bildschirmschoner.prototype.zeigen = function () {
    if (this.sichtbar) return;
    this.sichtbar = true;
    this.wurzel.classList.add('bs-sichtbar');
    if (this.art !== 'bild') this.buehne.starten();
  };

  Bildschirmschoner.prototype.verbergen = function () {
    if (!this.sichtbar) return;
    this.sichtbar = false;
    this.wurzel.classList.remove('bs-sichtbar');
    // Liegt der Schoner nicht, darf auch nichts mehr rechnen. Auf einem Surface Go ist eine
    // Animation hinter einem sichtbaren Dashboard verschenkte Bildrate.
    this.buehne.stoppen();
  };

  const api = {
    sollSchonen, schonerHelligkeit, hintergrundArt, Bildschirmschoner,
    SCHONER_MINUTEN_VORGABE, SCHONER_HELLIGKEIT_VORGABE
  };
  global.BildschirmschonerModul = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
