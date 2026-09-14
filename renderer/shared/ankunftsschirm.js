// Der Ankunftsschirm: Vollbildanzeige, die zu Beginn eines Anzeigefensters vor dem Dashboard
// erscheint und einen ankommenden Gast begrüßt.
//
// Ausdrücklich kein Dashboard (siehe CONTEXT.md): kein Kartenraster, sondern gewürfelte
// Farbwolken in Bewegung, Überschrift, Text und ein Bild aus Home Assistant.
//
// Das Modul zerfällt bewusst in zwei Hälften:
//
//   sollAnzeigen()  -- reine Entscheidung, ohne DOM, ohne Uhr, ohne Netz. Genau hier steckt
//                      die Fehleranfälligkeit (Verworfen-Zustand, Ablauf, fehlende Konfiguration),
//                      und genau deshalb ist sie ohne Browser testbar.
//   Ankunftsschirm  -- die Anzeige. Kennt DOM und Animation, trifft aber keine Entscheidung.

(function (global) {
  'use strict';

  const ANZAHL_FORMEN = 6;
  // Lebensdauer einer Form in Sekunden. Kürzer heißt mehr Bewegung.
  const LEBEN_MIN = 11;
  const LEBEN_MAX = 19;

  const z = (a, b) => a + Math.random() * (b - a);

  /** Der wievielte KALENDERTAG eines Anzeigefensters ein Zeitpunkt ist (1 = Anreisetag). */
  function tagNummer(fensterBeginn, zeitpunkt) {
    const mitternacht = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    return Math.round((mitternacht(zeitpunkt) - mitternacht(fensterBeginn)) / 86400000) + 1;
  }

  /**
   * Soll der Ankunftsschirm gerade sichtbar sein?
   *
   * @param {object} p
   * @param {boolean} p.aktiviert        Einstellung "Ankunftsschirm verwenden"
   * @param {object|null} p.anzeigefenster  { start, end } als ISO-Zeichenketten, oder null
   * @param {string} p.verworfenFuer     Beginn des Anzeigefensters, für das weggetippt wurde
   * @param {number} p.stunden           Anzeigedauer ab Beginn des Anzeigefensters
   * @param {number} p.ankunftZeit       Zeitpunkt der erkannten Ankunft in ms, oder 0
   * @param {Date}   p.jetzt
   */
  function sollAnzeigen(p) {
    if (!p) return false;

    // "Jetzt anzeigen" aus den Einstellungen schlaegt ALLES andere -- auch einen fehlenden
    // Termin, eine abgelaufene Anzeigedauer und den Verworfen-Zustand.
    //
    // Vorher setzte der Knopf nur den Verworfen-Zustand zurueck. Ohne laufenden Termin gibt es
    // aber gar kein Anzeigefenster, und die Pruefung stieg zwei Zeilen spaeter aus: Man drueckt
    // "jetzt anzeigen", und es passiert nichts. Wer den Schirm ansehen will, hat in aller Regel
    // gerade KEINEN Termin laufen -- sonst muesste er nicht danach fragen.
    const erzwungenBis = Number(p.erzwungenBis) || 0;
    const jetztMs = (p.jetzt || new Date()).getTime();
    if (erzwungenBis && jetztMs < erzwungenBis) return true;

    // Testmodus: Nach ein paar Sekunden ohne Beruehrung kommt der Schirm von allein wieder.
    // Zum Ausprobieren gedacht -- so laesst sich das Aussehen immer wieder ansehen, ohne
    // jedes Mal in die Einstellungen zu gehen. Schlaegt wie das erzwungene Anzeigen alles
    // andere, sonst braeuchte man zum Testen einen laufenden Termin.
    if (p.testmodus) {
      const leerlauf = Number(p.leerlaufSekunden);
      const schwelle = Number(p.testSekunden) > 0 ? Number(p.testSekunden) : 10;
      if (Number.isFinite(leerlauf) && leerlauf >= schwelle) return true;
      // Im Testmodus wird der Schirm NICHT dauerhaft verworfen -- er soll ja wiederkommen.
      // Ohne dieses vorzeitige Ende griffe unten der Verworfen-Zustand und der Schirm bliebe
      // fuer den Rest des Termins weg.
      return false;
    }

    if (!p.aktiviert) return false;
    const fenster = p.anzeigefenster;
    if (!fenster || !fenster.start) return false;

    // Weggetippt gilt für genau dieses Anzeigefenster -- und überdauert damit einen Neustart.
    // Beim nächsten Termin hat das Fenster einen anderen Beginn, und der Schirm kommt wieder.
    if (p.verworfenFuer && p.verworfenFuer === fenster.start) return false;

    let beginn = new Date(fenster.start).getTime();
    if (isNaN(beginn)) return false;

    // Ab wann die Anzeigedauer zählt: ab der Ankunft, sonst ab Terminbeginn.
    //
    // Die Termine sind ganztägig, ein Anzeigefenster beginnt also um 00:00 Uhr des Anreisetags.
    // Ohne diese Verschiebung wäre die Anzeigedauer längst abgelaufen, bevor der erste Gast zur
    // Tür hereinkommt -- der Begrüßungsschirm hätte die ganze Nacht eine leere Wand begrüßt.
    // Wann jemand angekommen ist, weiß die Steuerung (siehe control/ankunft.js).
    const fensterBeginn = beginn;
    const ankunftZeit = Number(p.ankunftZeit) || 0;
    if (ankunftZeit > beginn) beginn = ankunftZeit;

    const stunden = Number(p.stunden);

    // Begrüßt wird nur am ANREISETAG. Wer am dritten Tag eines Aufenthalts an der Wand
    // vorbeigeht, ist kein ankommender Gast mehr -- eine Begrüßung wäre dort nur noch im Weg.
    //
    // Zwei Bedingungen, und beide werden gebraucht:
    //  * Der Bezugspunkt (Ankunft, sonst Terminbeginn) muss am ersten Tag liegen. Sonst
    //    begrüßte ein Neustart am vierten Tag die Gäste noch einmal.
    //  * Heute muss der erste Tag sein -- es sei denn, eine Anzeigedauer läuft noch. Damit
    //    verschwindet der Schirm nicht um Punkt Mitternacht, wenn jemand um 23:50 Uhr ankommt,
    //    bleibt aber bei "bis zum Wegtippen" (0 Stunden) trotzdem auf den ersten Tag begrenzt.
    if (tagNummer(fensterBeginn, beginn) > 1) return false;
    const heute = (p.jetzt || new Date()).getTime();
    if (tagNummer(fensterBeginn, heute) > 1 && !(stunden > 0)) return false;
    // 0 Stunden heißt ausdrücklich "bis zum Wegtippen", nicht "gar nicht".
    if (stunden > 0) {
      const jetzt = (p.jetzt || new Date()).getTime();
      if (jetzt >= beginn + stunden * 3600 * 1000) return false;
    }
    return true;
  }

  /**
   * Auszeichnungen innerhalb einer Zeile. Wird sowohl vom Fliesstext als auch von der
   * Ueberschrift genutzt -- damit laesst sich "Herzlich **willkommen**" schreiben und man
   * bekommt dieselbe Zweiteilung wie in der Entwurfsvorlage.
   */
  function inlineMarkdown(roh, escFn) {
    const esc = escFn || (v => String(v == null ? '' : v));
    let t = esc(roh);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/_([^_]+)_/g, '<em>$1</em>');
    // Nur http und https -- alles andere waere ein Einfallstor.
    t = t.replace(/\[([^\]]+)\]\((https?:&#x2F;&#x2F;[^)\s]+|https?:\/\/[^)\s]+)\)/g,
      (m, txt, url) => `<a href="${url.replace(/&#x2F;/g, '/')}" rel="noopener">${txt}</a>`);
    return t;
  }

  /**
   * Kleiner Markdown-Satz fuer den Text des Ankunftsschirms.
   *
   * Sicherheitsprinzip: Erst wird ALLES maskiert, danach werden ausschliesslich die eigenen
   * Auszeichnungen wieder zu Tags. So kann aus dem Text nie HTML entstehen, das jemand
   * hineingeschrieben hat -- auch nicht ueber einen Umweg.
   */
  // Absichtlich ueber Zeichencodes statt ueber Maskierungen: Diese Datei wird von Skripten
  // erzeugt und veraendert, und eine zerbrochene Maskierung faellt erst zur Laufzeit auf.
  const NEUE_ZEILE = new RegExp(String.fromCharCode(13) + '?' + String.fromCharCode(10));

  function markdown(text, escFn) {
    const esc = escFn || (v => String(v == null ? '' : v));
    const zeilen = String(text || '').split(NEUE_ZEILE);
    const raus = [];
    let liste = false;

    const inline = (roh) => inlineMarkdown(roh, esc);

    const listeSchliessen = () => { if (liste) { raus.push('</ul>'); liste = false; } };

    for (const zeile of zeilen) {
      const z = zeile.trim();
      if (!z) { listeSchliessen(); continue; }
      const punkt = z.match(/^[-*+]\s+(.*)$/);
      if (punkt) {
        if (!liste) { raus.push('<ul>'); liste = true; }
        raus.push('<li>' + inline(punkt[1]) + '</li>');
        continue;
      }
      listeSchliessen();
      const ueberschrift = z.match(/^(#{1,3})\s+(.*)$/);
      if (ueberschrift) {
        const stufe = ueberschrift[1].length + 1; // h2 bis h4, h1 gehoert der Ueberschrift oben
        raus.push(`<h${stufe}>` + inline(ueberschrift[2]) + `</h${stufe}>`);
        continue;
      }
      raus.push('<p>' + inline(z) + '</p>');
    }
    listeSchliessen();
    return raus.join('');
  }

  function Ankunftsschirm(wurzel, optionen) {
    const opt = optionen || {};
    this.wurzel = wurzel;
    this.beimWegtippen = opt.beimWegtippen || function () {};
    this.formen = [];
    this.sichtbar = false;
    this.fensterStart = null;
    this._bauen();
  }

  Ankunftsschirm.prototype._bauen = function () {
    this.wurzel.innerHTML =
      '<div class="as-buehne"></div>' +
      '<div class="as-raster"></div>' +
      '<div class="as-inhalt">' +
        '<div class="as-links">' +
          '<h1 class="as-ueberschrift"></h1>' +
          '<p class="as-text"></p>' +
        '</div>' +
        '<div class="as-rechts">' +
          '<div class="as-bildrahmen">' +
            // Vier Seiten, nicht zwei: Damit sich der Wuerfel IMMER in dieselbe Richtung
            // dreht, muss nach einer Vierteldrehung die naechste Seite bereitstehen. Mit nur
            // zwei Seiten muesste er zurueckdrehen -- das sieht aus wie ein Fehler, nicht wie
            // ein Uebergang. Seite 0 und 2 zeigen Bild eins, Seite 1 und 3 Bild zwei.
            '<div class="as-wuerfel">' +
              '<img class="as-bild as-seite-0" alt="">' +
              '<img class="as-bild as-seite-1" alt="">' +
              '<img class="as-bild as-seite-2" alt="">' +
              '<img class="as-bild as-seite-3" alt="">' +
            '</div>' +
          '</div>' +
          '<div class="as-bildtext"></div>' +
        '</div>' +
      '</div>' +
      '<div class="as-tippen">Zum Fortfahren tippen</div>';

    this.buehne = this.wurzel.querySelector('.as-buehne');
    for (let i = 0; i < ANZAHL_FORMEN; i++) {
      const el = document.createElement('div');
      el.className = 'as-form';
      this.buehne.appendChild(el);
      this.formen.push({ el, timerAus: 0, timerNeu: 0 });
    }

    this.wurzel.addEventListener('click', () => {
      if (!this.sichtbar) return;
      this.beimWegtippen(this.fensterStart);
    });
  };

  // Eine Form wird geboren, driftet zu einem zufälligen Ziel, verblasst und wird woanders neu
  // geboren. Der Zufall läuft nur bei der Geburt -- dazwischen bewegt der Browser, nicht JS.
  // Deshalb kostet die Zufälligkeit praktisch keine Rechenzeit.
  Ankunftsschirm.prototype._gebaeren = function (form) {
    const el = form.el;
    const groesse = z(26, 62);
    el.style.width = groesse + 'vw';
    el.style.height = groesse * z(0.7, 1.25) + 'vw';
    el.style.setProperty('--as-weich', Math.round(groesse * z(1.1, 1.9)) + 'px');
    // Der Farbausschnitt gehoert dem Schirm, nicht der Funktion: Der Ankunftsschirm nimmt den
    // ganzen Farbkreis, der Abschiedsschirm nur den kuehlen Teil. So bleibt die Geburt einer
    // Form fuer beide dieselbe Rechnung.
    const tonVon = this.tonVon === undefined ? 0 : this.tonVon;
    const tonBis = this.tonBis === undefined ? 360 : this.tonBis;
    el.style.background = 'radial-gradient(circle at ' + z(30, 70) + '% ' + z(30, 70) + '%, ' +
      'hsl(' + z(tonVon, tonBis) + ' ' + z(72, 96) + '% ' + z(52, 68) + '%), transparent 70%)';
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

  Ankunftsschirm.prototype._animationStarten = function () {
    this.formen.forEach((form, i) => {
      clearTimeout(form.timerAus);
      clearTimeout(form.timerNeu);
      // Versetzt starten, damit nicht alle gleichzeitig auftauchen
      form.timerNeu = setTimeout(() => this._gebaeren(form), i * z(300, 1400));
    });
  };

  Ankunftsschirm.prototype._animationStoppen = function () {
    // Wichtig fürs Wandpanel: Läuft der Schirm nicht, darf auch nichts mehr rechnen.
    this.formen.forEach(form => {
      clearTimeout(form.timerAus);
      clearTimeout(form.timerNeu);
      form.el.style.opacity = '0';
    });
  };

  /**
   * Inhalte setzen. bildUrl darf leer sein -- dann verschwindet der Bildbereich ganz und
   * Überschrift und Text nehmen die Fläche ein. Kein Platzhalter, kein Hinweis.
   */
  /**
   * Was der Bildbereich zeigt -- ohne DOM, ohne Uhr, damit pruefbar.
   *
   * `kennung` ist der Kern der Sache: inhaltSetzen() wird bei JEDER Zustandsmeldung
   * aufgerufen, nicht nur beim Aufbau. Ohne Vergleich begann der Bildwechsel jedes Mal von
   * vorn -- Bild zwei erschien, die naechste Meldung ein paar Sekunden spaeter setzte hart
   * zurueck und startete den Zaehler neu. Am Geraet sah das aus, als bliebe das zweite Bild
   * nur drei Sekunden stehen, unabhaengig von der eingestellten Dauer.
   */
  function bildFolge(inhalt) {
    const i = inhalt || {};
    const bilder = [i.bildUrl, i.bildUrl2].filter(Boolean);
    const texte = [i.bildtext || '', i.bildtext2 || i.bildtext || ''];
    const sekunden = Number(i.wechselSekunden) > 0 ? Number(i.wechselSekunden) : 8;
    // Vier Seiten: Bild eins auf 0 und 2, Bild zwei auf 1 und 3. So steht nach jeder
    // Vierteldrehung die naechste Seite bereit und der Wuerfel dreht immer gleich herum.
    const zweites = bilder[1] || bilder[0];
    const seiten = bilder.length ? [bilder[0], zweites, bilder[0], zweites] : [];
    return {
      bilder,
      seiten,
      texte,
      sekunden,
      dreht: bilder.length > 1,
      kennung: JSON.stringify([bilder, texte, sekunden])
    };
  }

  /** Nach wie vielen Grad steht welche Seite vorn -- und welche Unterschrift gehoert dazu. */
  function textFuerDrehung(texte, drehung) {
    const t = Array.isArray(texte) && texte.length ? texte : [''];
    const schritt = Math.round(-drehung / 90);
    return t[((schritt % 2) + 2) % 2];
  }

  Ankunftsschirm.prototype.inhaltSetzen = function (inhalt) {
    const esc = (global.DashboardRender && global.DashboardRender.esc) || (v => String(v == null ? '' : v));
    this.wurzel.querySelector('.as-ueberschrift').innerHTML = inlineMarkdown(inhalt.ueberschrift || '', esc);
    this.wurzel.querySelector('.as-text').innerHTML = markdown(inhalt.text || '', esc);

    const rechts = this.wurzel.querySelector('.as-rechts');
    const wuerfel = this.wurzel.querySelector('.as-wuerfel');
    const bildtext = this.wurzel.querySelector('.as-bildtext');
    const folge = bildFolge(inhalt);

    // Siehe bildFolge(): unveraenderter Inhalt darf den laufenden Wechsel nicht zuruecksetzen.
    if (this._bildKennung === folge.kennung && this._bildWechsel) return;
    this._bildKennung = folge.kennung;

    clearInterval(this._bildWechsel);
    this._bildWechsel = null;

    if (!folge.bilder.length) {
      wuerfel.querySelectorAll('.as-bild').forEach(el => el.removeAttribute('src'));
      rechts.style.display = 'none';
      this.wurzel.classList.add('as-ohne-bild');
      return;
    }

    rechts.style.display = '';
    this.wurzel.classList.remove('as-ohne-bild');

    folge.seiten.forEach((url, i) => { wuerfel.querySelector('.as-seite-' + i).src = url; });

    let drehung = 0;
    wuerfel.style.setProperty('--drehung', '0deg');
    bildtext.textContent = folge.texte[0];

    // Laedt ein Bild nicht (Entitaet weg, HA kurz nicht erreichbar), verschwindet der
    // Bildbereich ganz -- kein Platzhalter, kein Hinweis.
    const erstes = wuerfel.querySelector('.as-seite-0');
    erstes.onerror = () => {
      rechts.style.display = 'none';
      this.wurzel.classList.add('as-ohne-bild');
    };

    if (folge.dreht) {
      this._bildWechsel = setInterval(() => {
        drehung -= 90;
        wuerfel.style.setProperty('--drehung', drehung + 'deg');
        // Die Bildunterschrift wechselt in der Mitte der Drehung, wenn die alte Seite
        // weggekippt und die neue noch nicht lesbar ist.
        const naechster = textFuerDrehung(folge.texte, drehung);
        bildtext.classList.add('as-bildtext-weg');
        setTimeout(() => {
          bildtext.textContent = naechster;
          bildtext.classList.remove('as-bildtext-weg');
        }, 450);
      }, folge.sekunden * 1000);
    }
  };

  Ankunftsschirm.prototype.zeigen = function (fensterStart) {
    this.fensterStart = fensterStart || null;
    if (this.sichtbar) return;
    this.sichtbar = true;
    this.wurzel.classList.add('as-sichtbar');
    this._animationStarten();
  };

  /**
   * Steht der Schirm gerade auf dem Bildschirm?
   *
   * Braucht das Dashboard, um nicht unter ihm hindurch das Dashboard zu wechseln -- die
   * automatische Rueckkehr aufs Hauptdashboard soll warten, solange jemand den Schirm
   * vor sich hat.
   */
  Ankunftsschirm.prototype.istSichtbar = function () {
    return !!this.sichtbar;
  };

  Ankunftsschirm.prototype.verbergen = function () {
    if (!this.sichtbar) return;
    clearInterval(this._bildWechsel);
    // Ohne dies liefe der naechste inhaltSetzen()-Aufruf in die Kennungs-Abfrage und der
    // Bildwechsel bliebe fuer immer stehen.
    this._bildWechsel = null;
    this._bildKennung = null;
    this.sichtbar = false;
    this.wurzel.classList.remove('as-sichtbar');
    this._animationStoppen();
  };

  // --- Abschiedsschirm ---------------------------------------------------------------------------
  //
  // Das Gegenstueck zum Ankunftsschirm: am LETZTEN Tag eines Aufenthalts. Dieselbe Buehne,
  // dieselben wandernden Farbwolken -- aber kuehl statt warm, und mit KARTEN.
  //
  // Warum kuehl: Die beiden Schirme sollen sich nicht verwechseln lassen. Wer morgens an der
  // Wand vorbeigeht, soll am Farbton erkennen, ob heute jemand kommt oder jemand faehrt, ohne
  // die Ueberschrift zu lesen.
  //
  // Warum mit Karten, obwohl der Ankunftsschirm ausdruecklich keine hat: Ein ankommender Gast
  // wird begruesst und soll nichts tun. Ein abreisender hat eine Liste -- Muell, Fenster,
  // Schluessel -- und will dabei sehen, wie das Wetter auf der Fahrt wird und wann er los
  // muss. Das sind Karten, und die gibt es hier ohnehin schon.
  //
  // Welche Karten, entscheidet der Nutzer: Der Schirm zeigt die Karten eines Unterdashboards.
  // Ein zweiter Editor waere derselbe Editor noch einmal.

  // Kuehler Ausschnitt des Farbkreises: Blau ueber Tuerkis bis Violett. Der Ankunftsschirm
  // nimmt den ganzen Kreis.
  const ABSCHIED_TON_VON = 175;
  const ABSCHIED_TON_BIS = 285;

  /**
   * Soll der Abschiedsschirm gerade sichtbar sein?
   *
   * @param {object} p
   * @param {boolean} p.aktiviert     Einstellung
   * @param {object|null} p.verlauf   { letzterTag, mehrtaegig } aus der Steuerung
   * @param {object|null} p.anzeigefenster { start } als ISO-Zeichenkette
   * @param {string} p.verworfenFuer  Beginn des Fensters, fuer das weggetippt wurde
   * @param {number} p.abStunde       ab welcher vollen Stunde des letzten Tages
   * @param {boolean} p.ankunftSichtbar  der Ankunftsschirm hat Vorrang
   * @param {Date}   p.jetzt
   */
  function sollAbschiedZeigen(p) {
    if (!p) return false;

    // Der Testmodus schlaegt ALLES -- fehlender Termin, falscher Tag, Uhrzeitgrenze,
    // weggetippt, und auch die Einstellung "verwenden" selbst: Man will ja gerade sehen, ob
    // sich das Einschalten lohnt. Wer den Schirm ansehen will, hat in aller Regel keinen
    // passenden Termin laufen; sonst muesste er nicht danach fragen.
    //
    // Er endet NICHT von allein. Eine Frist, die im Hintergrund ablaeuft, beantwortet die
    // Frage "sieht das an der Wand gut aus?" nur fuer die ersten zehn Minuten -- wer danach
    // hinsieht, findet den Schirm weg und weiss nicht, ob es an ihm oder an der Uhr lag.
    // Aus ist er erst, wenn der Schalter wieder umgelegt wird.
    if (p.testmodus) return true;

    if (!p.aktiviert) return false;
    // Zwei Vollbilder uebereinander waeren ein Fehler, kein Entwurf.
    if (p.ankunftSichtbar) return false;

    const fenster = p.anzeigefenster;
    if (!fenster || !fenster.start) return false;

    // Nur bei mehrtaegigen Terminen. Bei einem Termin, der ohnehin nur heute laeuft, waere
    // "letzter Tag" derselbe Tag wie die Ankunft -- eine Verabschiedung am Ankunftstag ist
    // keine Information, sondern ein Fehler.
    const v = p.verlauf;
    if (!v || !v.mehrtaegig || !v.letzterTag) return false;

    if (p.verworfenFuer && p.verworfenFuer === fenster.start) return false;

    // Vor dieser Stunde schlaeft man noch. 0 heisst: den ganzen letzten Tag.
    const ab = Number(p.abStunde);
    if (ab > 0 && (p.jetzt || new Date()).getHours() < ab) return false;

    return true;
  }

  /**
   * Was unter dem Text steht -- die einzige Bedienanleitung, die dieser Schirm hat.
   *
   * Im Testmodus tippt ihn nichts weg. Dann darf dort auch nicht stehen, man solle antippen:
   * Eine Wand, die eine Aufforderung zeigt und nicht darauf reagiert, sieht kaputt aus, und
   * wer davorsteht, sucht den Fehler am Geraet statt in den Einstellungen.
   */
  function abschiedHinweis(testmodus) {
    return testmodus
      ? 'Testmodus – endet über den Schalter in den Einstellungen'
      : 'Zum Ausblenden antippen';
  }

  function Abschiedsschirm(wurzel, optionen) {
    const opt = optionen || {};
    this.wurzel = wurzel;
    this.beimWegtippen = opt.beimWegtippen || function () {};
    this.formen = [];
    this.sichtbar = false;
    this.fensterStart = null;
    this.tonVon = ABSCHIED_TON_VON;
    this.tonBis = ABSCHIED_TON_BIS;
    this._bauen();
  }

  Abschiedsschirm.prototype._bauen = function () {
    this.wurzel.innerHTML =
      '<div class="as-buehne"></div>' +
      '<div class="as-raster"></div>' +
      '<div class="ab-inhalt">' +
        '<div class="ab-links">' +
          '<h1 class="as-ueberschrift ab-ueberschrift"></h1>' +
          '<p class="as-text ab-text"></p>' +
          '<p class="ab-hinweis">Zum Ausblenden antippen</p>' +
        '</div>' +
        '<div class="ab-karten"></div>' +
      '</div>';

    const buehne = this.wurzel.querySelector('.as-buehne');
    for (let i = 0; i < ANZAHL_FORMEN; i++) {
      const el = document.createElement('span');
      el.className = 'as-form';
      buehne.appendChild(el);
      this.formen.push({ el, timerAus: 0, timerNeu: 0 });
    }

    // Nur die linke Haelfte tippt weg. Die Karten sollen BEDIENBAR bleiben -- wer das Licht
    // ausmacht, will nicht, dass dabei der halbe Schirm verschwindet.
    this.wurzel.querySelector('.ab-links').addEventListener('click', () => {
      if (!this.sichtbar) return;
      this.beimWegtippen(this.fensterStart);
    });
  };

  // Dieselbe Geburt wie beim Ankunftsschirm, nur im kuehlen Ausschnitt des Farbkreises.
  Abschiedsschirm.prototype._gebaeren = Ankunftsschirm.prototype._gebaeren;
  Abschiedsschirm.prototype._animationStarten = Ankunftsschirm.prototype._animationStarten;
  Abschiedsschirm.prototype._animationStoppen = Ankunftsschirm.prototype._animationStoppen;

  Abschiedsschirm.prototype.inhaltSetzen = function (inhalt) {
    this.wurzel.querySelector('.ab-ueberschrift').innerHTML = inlineMarkdown(inhalt.ueberschrift || '');
    this.wurzel.querySelector('.ab-text').innerHTML = markdown(inhalt.text || '');
    this.wurzel.querySelector('.ab-hinweis').textContent = abschiedHinweis(inhalt.testmodus);
  };

  /** Die Flaeche fuer die Karten -- gefuellt wird sie vom Dashboard, das Karten bauen kann. */
  Abschiedsschirm.prototype.kartenFlaeche = function () {
    return this.wurzel.querySelector('.ab-karten');
  };

  Abschiedsschirm.prototype.istSichtbar = function () { return !!this.sichtbar; };

  Abschiedsschirm.prototype.zeigen = function (fensterStart) {
    this.fensterStart = fensterStart || null;
    if (this.sichtbar) return;
    this.sichtbar = true;
    this.wurzel.classList.add('as-sichtbar');
    this._animationStarten();
  };

  Abschiedsschirm.prototype.verbergen = function () {
    if (!this.sichtbar) return;
    this.sichtbar = false;
    this.wurzel.classList.remove('as-sichtbar');
    this._animationStoppen();
  };

  // --- Terminankuendigung ---------------------------------------------------------------------
  //
  // Beginnt ein Termin, faellt das Panel nicht mit der Tuer ins Haus. Ablauf: schwarz, dann
  // erscheint ein Symbol mit "Neuer Termin", Titel und Zeitraum, und erst danach uebernimmt der
  // Ankunftsschirm oder das Dashboard. Fuenf Sekunden, weich ein und aus.
  const ANKUENDIGUNG_MS = 5000;

  function Terminankuendigung(wurzel) {
    this.wurzel = wurzel;
    this.timer = null;
    wurzel.innerHTML =
      '<div class="ta-inhalt">' +
        '<div class="ta-symbol">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">' +
          '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>' +
          '<path d="M12 14v3M10.5 15.5h3"/></svg>' +
        '</div>' +
        '<div class="ta-klein">Neuer Termin</div>' +
        '<div class="ta-titel"></div>' +
        '<div class="ta-zeit"></div>' +
      '</div>';
  }

  Terminankuendigung.prototype.zeigen = function (fenster, danach) {
    const esc = (global.DashboardRender && global.DashboardRender.esc) || (v => String(v == null ? '' : v));
    const von = new Date(fenster.start);
    const bis = new Date(fenster.end);
    const tag = von.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
    const uhr = von.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const bisUhr = bis.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const mehrtaegig = von.toDateString() !== bis.toDateString();
    const bisText = mehrtaegig
      ? bis.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' }) + ', ' + bisUhr
      : bisUhr;

    this.wurzel.querySelector('.ta-titel').innerHTML = esc(fenster.title || '');
    this.wurzel.querySelector('.ta-zeit').textContent = tag + ', ' + uhr + ' bis ' + bisText;

    this.wurzel.classList.add('ta-sichtbar');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.wurzel.classList.remove('ta-sichtbar');
      // Erst nach dem Ausblenden weitergeben, damit sich die Uebergaenge nicht ueberlagern.
      setTimeout(() => { if (danach) danach(); }, 700);
    }, ANKUENDIGUNG_MS);
  };

  Terminankuendigung.prototype.abbrechen = function () {
    clearTimeout(this.timer);
    this.wurzel.classList.remove('ta-sichtbar');
  };

  const api = { sollAnzeigen, sollAbschiedZeigen, abschiedHinweis, markdown, inlineMarkdown, bildFolge, textFuerDrehung,
    Ankunftsschirm, Abschiedsschirm, Terminankuendigung, ANZAHL_FORMEN, ANKUENDIGUNG_MS,
    ABSCHIED_TON_VON, ABSCHIED_TON_BIS };
  global.AnkunftsschirmModul = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
