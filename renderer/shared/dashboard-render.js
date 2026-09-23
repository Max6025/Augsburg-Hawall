(function (global) {
  // --- Energiefluss-Diagramm ------------------------------------------------------------------
  //
  // Eine einzige SVG: Knoten, Leitungen und Text im selben Koordinatensystem.
  //
  // Die Vorgaengerin setzte die Knoten per CSS absolut und legte darunter eine SVG mit
  // `preserveAspectRatio="none"`. Damit wird das Koordinatensystem der Leitungen mit der Karte
  // verzerrt, die CSS-Knoten aber nicht -- beides laeuft bei jeder anderen Kartengroesse
  // auseinander. Auf einer 4x2-Karte traf die Leitung den Knoten, auf einer 2x2 endete sie im
  // Nichts. Das war der billige Eindruck: nicht die Farben, die Geometrie.
  //
  // Aufbau wie in Home Assistant: Solar oben, Netz links, Haus rechts, Batterie unten, die
  // Verbindungen als Kurven ueber die Mitte. Eine Leitung mit rechtem Winkel sieht nach
  // Schaltplan aus, nicht nach Fluss.

  // Hoeher als breit, und das mit Absicht: Unter jedem Knoten stehen zwei Zeilen (Wert und
  // Name), und beim untersten Knoten muessen die noch ins Bild passen. Mit einem Quadrat wurde
  // die Beschriftung der Batterie abgeschnitten -- sichtbar erst, wenn eine Batterie
  // konfiguriert ist, also beim Nutzer und nicht beim Bauen.
  const ED_B = 400;
  const ED_R = 44;               // Radius eines Knotens
  const ED_BAHN = 136;           // Abstand der Knotenmitte von der Mitte
  const ED_MITTE_Y = 240;
  // Unter jedem Knoten stehen zwei Zeilen. Beim UNTERSTEN muessen die noch ins Bild passen --
  // sonst wird die Beschriftung der Batterie abgeschnitten, und zwar erst beim Nutzer, weil
  // ohne Batterie nichts dort unten steht.
  //
  // Die Hoehe haengt deshalb davon ab, ob eine Batterie dabei ist. Eine feste Hoehe sah ohne
  // Batterie aus wie eine Karte, die zu einem Drittel leer ist: Die Zeichnung wird auf die
  // Hoehe eingepasst, und das reservierte Feld unten bleibt leer.
  const ED_H_OHNE = ED_MITTE_Y + ED_R + 70;
  const ED_H_MIT = ED_MITTE_Y + ED_BAHN + ED_R + 74;

  const ED_MITTE = { x: ED_B / 2, y: ED_MITTE_Y };
  const ED_ORT = {
    solar:    { x: ED_MITTE.x,        y: ED_MITTE.y - ED_BAHN },
    netz:     { x: ED_MITTE.x - ED_BAHN, y: ED_MITTE.y },
    haus:     { x: ED_MITTE.x + ED_BAHN, y: ED_MITTE.y },
    batterie: { x: ED_MITTE.x,        y: ED_MITTE.y + ED_BAHN }
  };

  const ED_FARBE = {
    solar: '#f5b544',
    netz: '#6f7784',
    haus: '#4f7cff',
    batterie: '#57c98a',
    ruhe: 'rgba(255,255,255,0.13)'
  };

  function edFmt(w) {
    if (w === null || w === undefined || !isFinite(w)) return '–';
    const a = Math.abs(w);
    if (a >= 10000) return (w / 1000).toFixed(1).replace('.', ',') + ' kW';
    if (a >= 1000) return (w / 1000).toFixed(2).replace('.', ',') + ' kW';
    return Math.round(w) + ' W';
  }


  // Eine Kurve von A nach ED_B, die durch die Mitte ausholt. Der Kontrollpunkt liegt auf der
  // Verbindung zur Mitte -- so biegt jede Leitung zur Mitte hin und die vier sehen wie ein
  // System aus und nicht wie vier Striche.
  function edBahn(a, b) {
    const ax = a.x + (ED_MITTE.x - a.x) * (ED_R / ED_BAHN);
    const ay = a.y + (ED_MITTE.y - a.y) * (ED_R / ED_BAHN);
    const bx = b.x + (ED_MITTE.x - b.x) * (ED_R / ED_BAHN);
    const by = b.y + (ED_MITTE.y - b.y) * (ED_R / ED_BAHN);
    // ACHTUNG: Das führende `M` ist das SVG-Kommando "moveto", keine Variable. Beim Umbenennen
    // der Konstanten ist es einmal mitumbenannt worden ("ED_M200.0,148.0") -- der Browser hat
    // den Pfad dann stillschweigend verworfen, getTotalLength() gab 0, und die Karte zeigte
    // Knoten ohne eine einzige Leitung. Deshalb heißt der Mittelpunkt hier ED_MITTE und nicht M.
    return `M${ax.toFixed(1)},${ay.toFixed(1)} Q${ED_MITTE.x},${ED_MITTE.y} ${bx.toFixed(1)},${by.toFixed(1)}`;
  }

  // Die Symbole kommen von AUSSEN (ICONS aus dashboard-render.js), nicht aus dieser Datei.
  //
  // Der erste Anlauf hatte eigene Pfade -- und das Netz-Symbol sah aus wie ein Muelleimer. Vor
  // allem aber waeren es zwei Symbolsaetze im selben Dashboard geworden, mit unterschiedlicher
  // Strichstaerke und unterschiedlicher Formensprache. Der Satz in ICONS ist der eine.
  //
  // Eingesetzt wird als VERSCHACHTELTE SVG: Die Symbole bringen ihr eigenes `viewBox="0 0 24
  // 24"` mit, und eine verschachtelte SVG rechnet das selbst um. Ein `<g transform="scale()">`
  // muesste die Strichstaerke mitskalieren und haette sie verzerrt.
  const ED_GROESSE = 46;
  function edSymbol(quelle, ort, farbe) {
    if (!quelle) return '';
    const x = (ort.x - ED_GROESSE / 2).toFixed(1);
    const y = (ort.y - ED_GROESSE / 2).toFixed(1);
    return quelle.replace('<svg ',
      `<svg class="ed-symbol" x="${x}" y="${y}" width="${ED_GROESSE}" height="${ED_GROESSE}" `
      + `style="color:${farbe}" `);
  }

  // Symbol IN der Scheibe, Wert und Name DARUNTER.
  //
  // Der erste Anlauf legte den Wert in die Scheibe, mitten auf das Symbol -- "5,20 kW" stand
  // quer ueber der Sonne und war beides unlesbar. Es gibt in einer Scheibe von 88 Pixeln nicht
  // genug Platz fuer ein Symbol und eine vierstellige Zahl; eines davon muss raus.
  // Symbol IN der Scheibe, Wert und Name DARUNTER -- beim obersten Knoten DARUEBER.
  //
  // Zwei Anlaeufe waren hier falsch. Der erste legte den Wert in die Scheibe, mitten auf das
  // Symbol: "5,20 kW" stand quer ueber der Sonne, beides unlesbar. Der zweite setzte den Text
  // bei jedem Knoten nach unten -- und beim Solarknoten laufen die Leitungen nach unten weg,
  // mitten durch das Wort "SOLAR".
  //
  // Deshalb: Text auf der Seite, an der KEINE Leitung abgeht. Oben der Solarknoten, unten die
  // Batterie, seitlich Netz und Haus (dort laufen die Leitungen waagerecht und kreuzen den
  // Text nicht).
  function edKnoten(art, ort, wert, beschriftung, aktiv, zusatz, symbole, textOben) {
    const farbe = ED_FARBE[art];
    const name = zusatz ? beschriftung + ' \u00b7 ' + zusatz : beschriftung;
    // Wert immer naeher an der Scheibe als der Name: Er ist die Zahl, die man sucht.
    const yWert = textOben ? ort.y - ED_R - 16 : ort.y + ED_R + 32;
    const yName = textOben ? ort.y - ED_R - 38 : ort.y + ED_R + 56;
    return `
      <g class="ed-knoten ${aktiv ? 'ed-aktiv' : ''}">
        <circle cx="${ort.x}" cy="${ort.y}" r="${ED_R}" class="ed-scheibe"/>
        <circle cx="${ort.x}" cy="${ort.y}" r="${ED_R}" class="ed-ring" style="stroke:${farbe}"/>
        ${edSymbol(symbole[art], ort, farbe)}
        <text x="${ort.x}" y="${yWert}" class="ed-wert">${esc(edFmt(wert))}</text>
        <text x="${ort.x}" y="${yName}" class="ed-name">${esc(name)}</text>
      </g>`;
  }

  /**
   * daten: { solarW, netzBezugW, netzEinspeisungW, batterieW, batterieLaedt, batterieSoc,
   *          hausW, schwelleW, namen: {solar, netz, haus, batterie} }
   * Fehlende Zweige werden weggelassen, nicht mit Null gezeichnet.
   */
  function edDiagramm(d) {
    const symbole = d.symbole || {};
    const s = d.schwelleW === undefined ? 5 : Math.abs(d.schwelleW);
    const n = Object.assign({ solar: 'Solar', netz: 'Netz', haus: 'Haus', batterie: 'Batterie' }, d.namen || {});
    const hatSolar = d.solarW !== null && d.solarW !== undefined;
    const hatBatterie = d.batterieW !== null && d.batterieW !== undefined;

    const bezug = d.netzBezugW || 0;
    const einspeisung = d.netzEinspeisungW || 0;
    const netzAktiv = Math.abs(bezug) > s || Math.abs(einspeisung) > s;
    // Der Netzknoten zeigt den BETRAG, die Richtung steht im Namen ("Netz · Einspeisung").
    // Ein Minuszeichen vor einer Zahl liest man aus fuenf Metern nicht, und zwei Zahlen
    // nebeneinander schon gar nicht.
    const netzWert = einspeisung > s ? einspeisung : bezug;
    const solarAktiv = hatSolar && Math.abs(d.solarW) > s;
    const battAktiv = hatBatterie && Math.abs(d.batterieW) > s;

    const leitungen = [];
    if (hatSolar) {
      leitungen.push({ d: edBahn(ED_ORT.solar, ED_ORT.haus), farbe: ED_FARBE.solar, aktiv: solarAktiv, um: false });
      if (einspeisung > s) {
        leitungen.push({ d: edBahn(ED_ORT.solar, ED_ORT.netz), farbe: ED_FARBE.solar, aktiv: true, um: false });
      }
    }
    if (bezug > s) {
      leitungen.push({ d: edBahn(ED_ORT.netz, ED_ORT.haus), farbe: ED_FARBE.netz, aktiv: true, um: false });
    } else {
      leitungen.push({ d: edBahn(ED_ORT.netz, ED_ORT.haus), farbe: ED_FARBE.netz, aktiv: false, um: false });
    }
    if (hatBatterie) {
      leitungen.push({
        d: d.batterieLaedt ? edBahn(ED_ORT.solar, ED_ORT.batterie) : edBahn(ED_ORT.batterie, ED_ORT.haus),
        farbe: ED_FARBE.batterie, aktiv: battAktiv, um: false
      });
    }

    // LUFT OBEN. Der Name des Solarknotens steht ueber seiner Scheibe und lag ohne diesen Rand
    // auf der Kante des Ausschnitts -- in einer Karte mit `overflow: hidden` ist er dann halb
    // abgeschnitten, und zwar nur oben, was wie ein Zufall aussieht und keiner ist.
    const LUFT = 14;
    const hoehe = (hatBatterie ? ED_H_MIT : ED_H_OHNE) + LUFT;
    return `
      <svg class="ed" viewBox="0 ${-LUFT} ${ED_B} ${hoehe}" preserveAspectRatio="xMidYMid meet" role="img">
        <g>
          ${leitungen.map(l => `<path d="${l.d}" class="ed-leitung ${l.aktiv ? 'ed-fliesst' : ''}"
             style="stroke:${l.aktiv ? l.farbe : ED_FARBE.ruhe}"/>`).join('')}
        </g>
        ${hatSolar ? edKnoten('solar', ED_ORT.solar, d.solarW, n.solar, solarAktiv, '', symbole, true) : ''}
        ${edKnoten('netz', ED_ORT.netz, netzWert, n.netz, netzAktiv,
          einspeisung > s ? 'Einspeisung' : (bezug > s ? 'Bezug' : ''), symbole)}
        ${edKnoten('haus', ED_ORT.haus, d.hausW, n.haus, (d.hausW || 0) > s, '', symbole)}
        ${hatBatterie ? edKnoten('batterie', ED_ORT.batterie, d.batterieW, n.batterie, battAktiv,
          d.batterieSoc !== null && d.batterieSoc !== undefined
            ? Math.round(d.batterieSoc) + ' %' + (d.batterieLaedt ? ' ↑' : ' ↓') : '', symbole) : ''}
      </svg>`;
  }

  const ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.2-1.6l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.7-1.6L13.4 2h-2.8l-.4 2.8a7 7 0 0 0-2.7 1.6l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .2 1.6l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 2.7 1.6l.4 2.8h2.8l.4-2.8a7 7 0 0 0 2.7-1.6l2.3 1 2-3.4-2-1.6c.1-.5.2-1 .2-1.6z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M5 15a8 8 0 0 0 14-3M19 9a8 8 0 0 0-14 3"/></svg>',
    climate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M4 7l16 10M20 7L4 17"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a6 6 0 0 0-4 10.5c.5.5.8 1 .8 1.7V16h6.4v-1.8c0-.7.3-1.2.8-1.7A6 6 0 0 0 12 2z"/></svg>',
    cover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h18M6 4v10M18 4v10M6 20l3-3M18 20l-3-3"/></svg>',
    switch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v10"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/></svg>',
    button: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
    gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18a8 8 0 0 1 16 0"/><path d="M12 18l4-6"/></svg>',
    graph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 16l4-5 4 3 8-9"/></svg>',
    temperature: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>',
    wind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 16h15a3 3 0 1 1-3 3"/><path d="M3 12h9"/></svg>',
    rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 15.5a4.5 4.5 0 0 1 .5-8.98A6 6 0 0 1 19 8.5a4 4 0 0 1-1 7.9H7z"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/></svg>',
    radar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 12V4"/><path d="M12 12l6.5 3.2"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>',
    fan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1.6"/><path d="M12 12c0-4 2-7 4-7s2 3-1 5M12 12c-4 0-7 2-7 4s3 2 5-1M12 12c0 4-2 7-4 7s-2-3 1-5M12 12c4 0 7-2 7-4s-3-2-5 1"/></svg>',
    sensor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a5 5 0 0 0-5 5v7a5 5 0 0 0 10 0V7a5 5 0 0 0-5-5z"/><circle cx="12" cy="18" r="2"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    pressure: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 13L16 9"/><path d="M12 5v1.5M5 13h1.5M17.5 13H19M7 7.5l1 1M17 7.5l-1 1"/></svg>',
    select: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 12h8M15 9l3 3-3 3"/></svg>',
    // Ein Pfeil, der in eine Flaeche HINEINGEHT. Vorher stand hier ein Fadenkreuz aus vier
    // Strichen und einem Kreis -- das liest sich als "Standort" oder "Ziel", nicht als
    // "hier geht es weiter". Gemeldet wurde das als "man versteht die Karte nicht".
    navigate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3.5h4.5A2 2 0 0 1 20.5 5.5v13a2 2 0 0 1-2 2H14"/><path d="M3.5 12h10"/><path d="m9.5 8 4 4-4 4"/></svg>',
    // Sonne mit Strahlen -- und zwar geschlossen gezeichnet, damit sie auch auf 1x1 noch als
    // Sonne lesbar ist und nicht als Zahnrad.
    // Zwei Flügel in der Draufsicht, angeschlagen an den Pfosten links und rechts. Nur die
    // beiden Flügel tragen eine eigene Klasse -- sie sind das, was sich bewegt.
    fluegeltor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
      + '<path d="M2.6 5.5v13M21.4 5.5v13" opacity="0.55"/>'
      + '<path class="tor-fluegel tor-links" d="M2.6 12h9"/>'
      + '<path class="tor-fluegel tor-rechts" d="M21.4 12h-9"/>'
      + '</svg>',
    solar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4M5.1 5.1l1.7 1.7M17.2 17.2l1.7 1.7M18.9 5.1l-1.7 1.7M6.8 17.2l-1.7 1.7"/></svg>',
    pfeilRechts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
    forecast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 18a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18 11.5 3.5 3.5 0 0 1 17.5 18H7z"/><path d="M8 21l1-2M12 21l1-2M16 21l1-2"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
    sunny: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>',
    cloudy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 18a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18 11.5 3.5 3.5 0 0 1 17.5 18H7z"/></svg>',
    snowy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 12a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18 5.5 3.5 3.5 0 0 1 17.5 12H7z"/><path d="M8 16v4M12 16v4M16 16v4M7 18l2 2M17 18l-2 2M11 18l-2 2M13 18l2 2"/></svg>',
    storm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 12a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18 5.5 3.5 3.5 0 0 1 17.5 12H7z"/><path d="M13 13l-3 5h3l-2 4"/></svg>',
    fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 10h13M4 14h16M6 18h12"/></svg>',
    sun2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.5 4.5l1.8 1.8M17.7 17.7l1.8 1.8M2.5 12h2.5M19 12h2.5M4.5 19.5l1.8-1.8M17.7 6.3l1.8-1.8"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M6 6l6 4 6-4M6 12l6 4 6-4M4 20h16"/></svg>',
    home2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/></svg>',
    battery2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="16" height="10" rx="1.5"/><path d="M21 11v4"/><path d="M8 13h3l-1 2h3l-4 4v-3H7z" fill="currentColor" stroke="none"/></svg>',
    mediaPlayer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M9 8.5v5l4.5-2.5z" fill="currentColor" stroke="none"/><path d="M4 20h16"/></svg>',
    lockClosed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    lockOpen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.4-2"/></svg>',
    fan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 12c0-3 1-6 4-6a3 3 0 1 1-1 5.8"/><path d="M12 12c3 0 6 1 6 4a3 3 0 1 1-5.8-1"/><path d="M12 12c0 3-1 6-4 6a3 3 0 1 1 1-5.8"/><path d="M12 12c-3 0-6-1-6-4a3 3 0 1 1 5.8 1"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>',
    vacuum: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><circle cx="11" cy="11" r="2.4" fill="currentColor" stroke="none"/><path d="M16.5 16.5L21 21"/></svg>',
    humidity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3.5v5c0 5-3.5 8.5-8 9.5-4.5-1-8-4.5-8-9.5v-5L12 3z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
    shieldOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3.5v5c0 5-3.5 8.5-8 9.5-4.5-1-8-4.5-8-9.5v-5L12 3z" opacity="0.4"/></svg>',
    dockIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19h16M6 19v-3a6 6 0 0 1 12 0v3"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77 0"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 4l14 8-14 8z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="4" width="5" height="16"/><rect x="14" y="4" width="5" height="16"/></svg>',
    skipPrev: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="2.5" height="16"/><path d="M19 4v16l-11-8z"/></svg>',
    skipNext: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="17.5" y="4" width="2.5" height="16"/><path d="M5 4v16l11-8z"/></svg>',
    volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
    volumeMute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h3.5L16 18h6M2 18h3.5L11 11"/><path d="M18 6h4v0M18 6l3-3M18 6l3 3M18 18h4M18 18l3-3M18 18l3 3"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    repeatOne: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M11 9h1v4"/></svg>',
    // Fuer Knoepfe, die man auf einen Blick unterscheiden koennen muss -- ein Tor sieht
    // anders aus als eine Garage, und das erkennt man aus fuenf Metern, einen Text nicht.
    gate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20V9l9-4 9 4v11"/><path d="M3 13h18"/><path d="M9 20V9"/><path d="M15 20V9"/></svg>',
    garage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-7h10v7"/><path d="M7 17.5h10"/></svg>',
    door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
    arrowDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>',
    stopSquare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    // Betriebsarten der Klimaanlage. Jede sieht anders aus -- eine Anlage, die heizt, darf
    // nicht dasselbe Symbol tragen wie eine, die kuehlt, und eine ausgeschaltete schon gar
    // nicht. Die inneren Teile haben Klassen, damit das CSS sie bewegen kann.
    hvacHeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path class="flamme-aussen" d="M12 22c3.9 0 6.8-2.6 6.8-6.3 0-4.4-4.4-6.4-3.9-11.2-2.4 1.5-3.9 3.9-3.9 5.9 0 1.5-1 1.9-1.5 1.2-.6-.9-1-1.9-1-2.9-2 1.5-3.3 3.9-3.3 7 0 3.7 2.9 6.3 6.8 6.3z"/><path class="flamme-innen" d="M12 22c1.9 0 3.3-1.4 3.3-3.2 0-2.2-2.4-3-2.1-5.4-1.5 1-2.5 2.5-2.5 3.6 0 .8-.6.9-.9.5a2.6 2.6 0 0 1-.5-1.1c-.8.8-1.2 1.7-1.2 2.6 0 1.8 1.4 3 3.9 3z"/></svg>',
    hvacCool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><g class="flocke"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8"/><path d="M12 6.2 9.6 4M12 6.2 14.4 4M12 17.8l-2.4 2.2M12 17.8l2.4 2.2"/><path d="m6.9 9 .1-3.2M6.9 9 4 9.6M17.1 15l-.1 3.2M17.1 15l2.9-.6"/><path d="m17.1 9-.1-3.2M17.1 9 20 9.6M6.9 15l.1 3.2M6.9 15 4 14.4"/></g></svg>',
    hvacDry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.2c3.4 4.4 5.8 7.3 5.8 10.2a5.8 5.8 0 0 1-11.6 0c0-2.9 2.4-5.8 5.8-10.2z"/><circle class="tropfen" cx="12" cy="14.4" r="1.6" fill="currentColor" stroke="none" opacity="0"/></svg>',
    hvacFan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><g class="luefter"><path d="M12 11.2c1.6-3.6.7-6.6-1.3-7.6-1.7-.8-3.1.5-2.7 2.4.5 2.3 2.3 4.3 4 5.2z"/><path d="M12.8 12c3.6-1.6 6.6-.7 7.6 1.3.8 1.7-.5 3.1-2.4 2.7-2.3-.5-4.3-2.3-5.2-4z"/><path d="M11.2 12.8c-1.6 3.6-4.6 4.5-6.6 3.5-1.7-.8-1.5-2.7.4-3.5 2.1-.9 4.6-.6 6.2 0z"/></g><circle cx="12" cy="12" r="1.5"/></svg>',
    hvacAuto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17.5 8.8 7.2l3.8 10.3M6.2 14.4h5.2"/><path d="M16 8.6v6.8M16 8.6c2 0 3.2 1.2 3.2 3.4S18 15.4 16 15.4"/></svg>',
    hvacOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3.5v8"/><path d="M6.5 6.8a7.5 7.5 0 1 0 11 0"/></svg>',
    generic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>'
  };
  const DOMAIN_LABEL = { light: 'Licht', switch: 'Schalter', climate: 'Klima', cover: 'Rollläden', fan: 'Lüfter', sensor: 'Sensoren', button: 'Taster', input_button: 'Taster', scene: 'Szenen', script: 'Skripte' };

  // Kartentypen-Katalog: id -> { label, defaultSize (Preset fuer NEUE Karten) }
  const CARD_TYPES = {
    light:  { label: 'Lampe (Dimmer)', defaultSize: 'md' },
    switch: { label: 'Schalter',       defaultSize: 'sm' },
    button: { label: 'Taster',         defaultSize: 'sm' },
    gauge:  { label: 'Gauge',          defaultSize: 'md' },
    graph:  { label: 'Verlauf',        defaultSize: 'lg' },
    temperature: { label: 'Temperatur', defaultSize: 'lg' },
    wind:   { label: 'Wind',           defaultSize: 'lg' },
    rain:   { label: 'Regen',          defaultSize: 'lg' },
    radar:  { label: 'Regenradar',     defaultSize: 'lg' },
    climate:{ label: 'Klima',          defaultSize: 'md' },
    cover:  { label: 'Rollladen',      defaultSize: 'md' },
    sensor: { label: 'Sensor (Text)',  defaultSize: 'sm' },
    clock:  { label: 'Uhr',            defaultSize: 'md' },
    pressure: { label: 'Luftdruck',    defaultSize: 'lg' },
    solar:  { label: 'Sonneneinstrahlung', defaultSize: 'lg' },
    fluegeltor: { label: 'Flügeltor', defaultSize: 'md' },
    select: { label: 'Auswahl',        defaultSize: 'md' },
    navigate: { label: 'Dashboard wechseln', defaultSize: 'sm' },
    forecast: { label: 'Wettervorhersage', defaultSize: 'xl' },
    energy: { label: 'Energiefluss', defaultSize: 'xl' },
    media_player: { label: 'Media Player', defaultSize: 'lg' },
    lock: { label: 'Schloss', defaultSize: 'sm' },
    fan: { label: 'Ventilator', defaultSize: 'md' },
    vacuum: { label: 'Saugroboter', defaultSize: 'md' },
    humidity: { label: 'Luftfeuchtigkeit', defaultSize: 'lg' },
    waste: { label: 'Mülltermine', defaultSize: 'lg' },
    gate: { label: 'Tor öffnen', defaultSize: 'md' },
    photo: { label: 'Foto-Bereich', defaultSize: 'xl' },
    quicktiles: { label: 'Schnellzugriff', defaultSize: 'lg' }
  };

  // Welche Domains zu welchem Kartentyp passen -- Grundlage fuer den "erst Typ,
  // dann Entitaet"-Ablauf beim Hinzufuegen. null = keine Einschraenkung, [] = keine
  // Entitaet noetig (z.B. Uhr).
  function domainsForType(type) {
    switch (type) {
      case 'light': return ['light'];
      case 'switch': return ['switch', 'input_boolean', 'fan', 'light', 'binary_sensor'];
      case 'button': return ['button', 'input_button', 'scene', 'script'];
      case 'climate': return ['climate'];
      case 'cover': case 'fluegeltor': return ['cover'];
      case 'radar': return ['camera', 'image'];
      case 'gauge': case 'graph': case 'temperature': case 'wind': case 'rain': case 'pressure': case 'humidity':
      case 'solar':
        return NUMERIC_DOMAINS;
      case 'sensor': return [...NUMERIC_DOMAINS, 'binary_sensor'];
      case 'select': return ['input_select', 'select'];
      case 'forecast': return ['weather'];
      case 'media_player': return ['media_player'];
      case 'lock': return ['lock'];
      case 'fan': return ['fan'];
      case 'vacuum': return ['vacuum'];
      case 'waste': return ['calendar'];
      // Die Karten-Entitaet ist hier die Melde-Entitaet ("Tor dauerhaft offen"). Die Knoepfe
      // haengen in den Einstellungen und koennen aus jeder Domain kommen.
      case 'gate': return ['input_boolean', 'switch', 'light', 'binary_sensor'];
      case 'clock': case 'navigate': case 'energy': case 'photo': case 'quicktiles': return [];
      default: return null;
    }
  }

  // Umkehrung von allowedCardTypes: welche Kartentypen passen zu einer bereits
  // vorhandenen Entitaet (fuer das Typ-Dropdown auf existierenden Karten).
  function typesForEntity(entity_id) {
    const domain = domainOf(entity_id);
    return Object.keys(CARD_TYPES).filter(t => {
      if (t === 'clock' || t === 'navigate' || t === 'energy') return false;
      const doms = domainsForType(t);
      return doms === null || doms.includes(domain);
    });
  }

  // Freies Groessenmodell: jede Karte hat cols (1-4) x rows (1-4), per Drag im Editor
  // frei einstellbar. Presets bleiben als Kurzwahl-Buttons UND als Fallback fuer alte
  // Configs erhalten.
  const SIZE_PRESETS = { sm: { cols: 1, rows: 1 }, md: { cols: 2, rows: 1 }, lg: { cols: 2, rows: 2 }, xl: { cols: 4, rows: 2 } };
  function sizeToSpan(sizeStr) { return SIZE_PRESETS[sizeStr] || SIZE_PRESETS.sm; }

  // Mindestgroessen gibt es bewusst nicht mehr: Jede Karte darf auf 1x1 gezogen werden.
  //
  // Frueher stand hier eine Tabelle, die je Kartentyp eine Untergrenze vorgab (Verlauf 2x2,
  // Foto 3x2 und so weiter). Sie hat mehr verhindert als geschuetzt -- viele Karten waren
  // damit fuer das eigene Layout schlicht zu gross. Dass ein Energiefluss auf 1x1 unlesbar
  // wird, sieht man im Editor sofort und zieht ihn wieder auf. Diese Entscheidung gehoert
  // dem Nutzer, nicht einer Tabelle im Code.
  const MIN_SPAN = {};
  function minSpanFor(type) { return MIN_SPAN[type] || { cols: 1, rows: 1 }; }

  // Kartentypen, die auf einer Foto-Bereich-Karte "andocken" duerfen (ueberlappen statt zu
  // kollidieren) -- bekommen dort automatisch einen durchscheinenden Glas-Effekt.
  const PHOTO_OVERLAY_TYPES = ['media_player', 'forecast'];
  function canOverlayOnPhoto(type) { return PHOTO_OVERLAY_TYPES.includes(type); }

  function clampSpan(span, type) {
    const min = minSpanFor(type);
    return {
      cols: Math.max(min.cols, Math.min(4, span.cols || min.cols)),
      rows: Math.max(min.rows, Math.min(4, span.rows || min.rows))
    };
  }

  // Ermittelt cols/rows aus einem Layout-Eintrag: neue Eintraege haben cols/rows direkt,
  // alte nur ein `size`-Preset (sm/md/lg/xl) -- beides wird unterstuetzt.
  function resolveSpan(entry, type) {
    const base = (entry && entry.cols && entry.rows)
      ? clampSpan({ cols: entry.cols, rows: entry.rows }, type)
      : clampSpan(sizeToSpan((entry && entry.size) || defaultSize(type)), type);
    if (entry && Number.isInteger(entry.x) && Number.isInteger(entry.y)) {
      return { ...base, x: entry.x, y: entry.y };
    }
    return base;
  }

  // --- Karten auf dem Bildschirmschoner --------------------------------------------------
  //
  // Die Karten kommen aus einem Unterdashboard und bringen von dort BEIDES mit: ihre Groesse
  // und ihren Platz im Raster des Editors. Beides wird behalten -- der Schoner zeigt das
  // Unterdashboard so, wie es im Editor angeordnet wurde.
  // Das ist die Regel, die man sich merken kann: Was du dort hinlegst, liegt hier auch dort.
  //
  // Die Flaeche muss deshalb DASSELBE Raster haben. Vorher hatte sie zwei Spalten, und eine
  // Karte mit "grid-column: 4 / span 3" zeigte ins Leere: Der Browser haengt stillschweigend
  // weitere Spalten an, und was dahinter kommt, steht halb ausserhalb des Bildschirms. Genau
  // so sah es am 2026-09-14 auf der Wand der Vorlage aus -- eine riesige Karte und daneben
  // der Streifen einer zweiten.
  //
  // Geschnitten wird nur noch als Fangnetz: Ein Eintrag, der ueber den Rand hinausragt (aus
  // einem aelteren Layout, von Hand bearbeitet, aus einer Austauschdatei), wird
  // hereingeschoben statt hinausgeschrieben.
  //
  // Das Raster ist das des EDITORS: 4 Spalten, 6 Zeilen (MAX_ROWS in editor.js, .grid in
  // dashboard.css). In der ersten Fassung stand hier 6x6, uebernommen vom Abschiedsschirm der
  // Vorlage. Am Geraet sah das so aus: Die Karten nahmen nur zwei Drittel der Breite ein,
  // rechts blieb ein Drittel leer, und gemeldet wurde es als "der Bildschirm ist groesser als
  // im Editor" (2026-09-22). Was im Editor die ganze Flaeche fuellt, muss es hier auch tun.
  const SCHONER_SPALTEN = 4;
  const SCHONER_ZEILEN = 6;

  function schonerSpanne(span, spalten, zeilen) {
    const maxS = Number(spalten) > 0 ? Number(spalten) : SCHONER_SPALTEN;
    const maxZ = Number(zeilen) > 0 ? Number(zeilen) : SCHONER_ZEILEN;
    const ganz = (w, kleinstes, groesstes) => {
      const n = Math.round(Number(w));
      if (!Number.isFinite(n)) return kleinstes;
      return Math.max(kleinstes, Math.min(n, groesstes));
    };
    const cols = ganz(span && span.cols, 1, maxS);
    const rows = ganz(span && span.rows, 1, maxZ);
    if (span && Number.isInteger(span.x) && Number.isInteger(span.y)) {
      // Hereinschieben, nicht abschneiden: Eine Karte, die schmaler gemacht wird, verliert
      // ihren Inhalt; eine, die ein Feld weiter links liegt, nicht.
      return { cols, rows, x: ganz(span.x, 0, maxS - cols), y: ganz(span.y, 0, maxZ - rows) };
    }
    return { cols, rows };
  }

  const PRESS_DOMAINS = { button: 'press', input_button: 'press', scene: 'turn_on', script: 'turn_on' };
  const TOGGLE_DOMAINS = ['light', 'switch', 'input_boolean', 'fan'];
  const NUMERIC_DOMAINS = ['sensor', 'number', 'input_number'];

  function domainOf(entity_id) { return entity_id.split('.')[0]; }

  function isNumeric(state) {
    return state != null && state.state !== undefined && state.state !== '' && !isNaN(parseFloat(state.state));
  }

  // Temperatur-Erkennung: primaer ueber device_class/Einheit, zusaetzlich ueber den
  // Namen -- manche Integrationen (z.B. manche Wetterstationen/Vorlagen) setzen weder
  // device_class noch eine erkennbare Einheit korrekt.
  function isTemperature(entity_id, attrs) {
    const unit = attrs.unit_of_measurement;
    if (attrs.device_class === 'temperature' || unit === '°C' || unit === '°F') return true;
    const name = ((attrs.friendly_name || '') + ' ' + (entity_id || '')).toLowerCase();
    return /temperat/.test(name) || /\btemp\b/.test(name);
  }

  function isWind(entity_id, attrs) {
    if (attrs.device_class === 'wind_speed') return true;
    const name = ((attrs.friendly_name || '') + ' ' + (entity_id || '')).toLowerCase();
    return /wind/.test(name);
  }

  /**
   * Sonneneinstrahlung: Leistung pro Flaeche, W/m2.
   *
   * Die Einheit ist der zuverlaessige Teil -- `irradiance` als device_class gibt es erst seit
   * HA 2022, und aeltere Integrationen (Ecowitt, OpenDTU) liefern sie oft gar nicht. Der Name
   * ist die letzte Wahl, weil "Solar" auch an Wechselrichtern und Batterien steht, die Watt
   * liefern und keine Einstrahlung.
   */
  function isSolar(entity_id, attrs) {
    if (attrs.device_class === 'irradiance') return true;
    const unit = String(attrs.unit_of_measurement || '').replace(/\s/g, '');
    if (['W/m²', 'W/m2', 'W/qm', 'kW/m²', 'kW/m2'].includes(unit)) return true;
    if (attrs.device_class) return false;   // eine andere Messgroesse hat sich schon erklaert
    const name = ((attrs.friendly_name || '') + ' ' + (entity_id || '')).toLowerCase();
    return /(solar|sonnen)(_|\s)?(radiation|einstrahlung|strahlung)|irradian/.test(name);
  }

  function isRain(entity_id, attrs) {
    if (attrs.device_class === 'precipitation' || attrs.device_class === 'precipitation_intensity') return true;
    if (attrs.unit_of_measurement === 'mm' || attrs.unit_of_measurement === 'mm/h') return true;
    const name = ((attrs.friendly_name || '') + ' ' + (entity_id || '')).toLowerCase();
    return /regen|niederschlag|rain/.test(name);
  }

  function isPressure(entity_id, attrs) {
    if (attrs.device_class === 'atmospheric_pressure' || attrs.device_class === 'pressure') return true;
    const unit = attrs.unit_of_measurement;
    if (unit === 'hPa' || unit === 'mbar' || unit === 'mmHg' || unit === 'inHg' || unit === 'Pa') return true;
    const name = ((attrs.friendly_name || '') + ' ' + (entity_id || '')).toLowerCase();
    return /luftdruck|pressure|barometer/.test(name);
  }

  function isHumidity(entity_id, attrs) {
    if (attrs.device_class === 'humidity') return true;
    const name = ((attrs.friendly_name || '') + ' ' + (entity_id || '')).toLowerCase();
    return attrs.unit_of_measurement === '%' && /feucht|humid/.test(name);
  }

  // Welcher Kartentyp passt standardmaessig zu dieser Entitaet
  function defaultCardType(entity_id, state) {
    const domain = domainOf(entity_id);
    const attrs = (state && state.attributes) || {};
    if (domain === 'climate') return 'climate';
    // Ein Tor ist kein Rollladen. Home Assistant sagt das selbst ueber die device_class --
    // und wer ein Tor auf die Wand legt, will sehen, ob es offen ist, nicht auf wie viel
    // Prozent es steht.
    if (domain === 'cover') return attrs.device_class === 'gate' ? 'fluegeltor' : 'cover';
    if (domain === 'camera' || domain === 'image') return 'radar';
    if (domain === 'weather') return 'forecast';
    if (domain === 'media_player') return 'media_player';
    if (domain === 'lock') return 'lock';
    if (domain === 'vacuum') return 'vacuum';
    if (domain === 'calendar') return 'waste';
    if (domain === 'fan') return 'fan';
    if (domain === 'input_select' || domain === 'select') return 'select';
    if (PRESS_DOMAINS[domain]) return 'button';
    if (domain === 'light') return attrs.brightness !== undefined ? 'light' : 'switch';
    if (domain === 'switch' || domain === 'input_boolean') return 'switch';
    if (domain === 'binary_sensor') return 'switch';
    if (NUMERIC_DOMAINS.includes(domain) && isTemperature(entity_id, attrs)) return 'temperature';
    if (NUMERIC_DOMAINS.includes(domain) && isWind(entity_id, attrs)) return 'wind';
    if (NUMERIC_DOMAINS.includes(domain) && isRain(entity_id, attrs)) return 'rain';
    if (NUMERIC_DOMAINS.includes(domain) && isPressure(entity_id, attrs)) return 'pressure';
    if (NUMERIC_DOMAINS.includes(domain) && isHumidity(entity_id, attrs)) return 'humidity';
    if (NUMERIC_DOMAINS.includes(domain) && isSolar(entity_id, attrs)) return 'solar';
    if (NUMERIC_DOMAINS.includes(domain) && isNumeric(state)) return 'gauge';
    return 'sensor';
  }

  // Welche Kartentypen darf man fuer diese Entitaet manuell waehlen
  function allowedCardTypes(entity_id, state) {
    const domain = domainOf(entity_id);
    const attrs = (state && state.attributes) || {};
    if (domain === 'climate') return ['climate'];
    if (domain === 'cover') {
      return attrs.device_class === 'gate' ? ['fluegeltor', 'cover'] : ['cover', 'fluegeltor'];
    }
    if (domain === 'camera' || domain === 'image') return ['radar'];
    if (domain === 'weather') return ['forecast'];
    if (domain === 'media_player') return ['media_player'];
    if (domain === 'input_select' || domain === 'select') return ['select'];
    if (PRESS_DOMAINS[domain]) return ['button'];
    if (domain === 'light') return ['light', 'switch'];
    if (domain === 'switch' || domain === 'input_boolean' || domain === 'fan') return ['switch'];
    if (domain === 'binary_sensor') return ['switch', 'sensor'];
    if (NUMERIC_DOMAINS.includes(domain)) {
      const base = ['gauge', 'graph', 'sensor'];
      if (isRain(entity_id, attrs)) return ['rain', ...base];
      if (isWind(entity_id, attrs)) return ['wind', ...base];
      if (isTemperature(entity_id, attrs)) return ['temperature', ...base];
      if (isPressure(entity_id, attrs)) return ['pressure', ...base];
      if (isHumidity(entity_id, attrs)) return ['humidity', ...base];
      if (isSolar(entity_id, attrs)) return ['solar', ...base];
      return base;
    }
    return ['sensor'];
  }

  // --- Farben fuer Karten ohne eigene Farbe ------------------------------------------------------
  //
  // Jeder Kartentyp hat einen festen Akzent -- ausser der Sensorkarte. Die ist der Sammelfall:
  // Sie nimmt alles auf, wofuer es keine eigene Karte gibt. Stehen drei davon nebeneinander,
  // sahen sie bisher identisch aus, und man musste jedes Mal die Bildunterschrift lesen.
  //
  // Die Farben liegen bewusst in Luecken zwischen den festen Akzenten: Rosa, Gelbgruen, Flieder,
  // Malve, Moosgruen, Bernstein. Kein Blau (Klima, Regen, Verlauf), kein Rot (Alarm), kein
  // Orange (Lampe, Temperatur) -- sonst sieht eine Sensorkarte aus wie eine Klimakarte.
  const SENSOR_FARBEN = ['#e79ec5', '#c2d96e', '#a9a0ea', '#d79ae0', '#8fc79a', '#ddc06f'];

  // Dieselben Farbtoene, aber fuer hellen Grund: Die pastelligen oben verschwinden dort fast
  // vollstaendig. Sie stehen hier und nicht im CSS, weil der Akzent direkt am Element gesetzt
  // wird -- eine CSS-Regel kaeme dagegen nicht an, egal wie sie geschrieben waere.
  const SENSOR_FARBEN_HELL = ['#b3417f', '#5f7a1c', '#5b4ec2', '#9c3fae', '#2f7a48', '#8a6510'];

  /**
   * Ordnet jeder Kennung eine Farbe zu -- moeglichst verschieden voneinander.
   *
   * Erst wird aus der Kennung selbst eine Farbe gewuerfelt: So bleibt eine Karte bei ihrer
   * Farbe, auch wenn daneben eine andere dazukommt oder verschwindet. Ist die Farbe schon
   * vergeben, wird die naechste freie genommen -- zwei gleiche waeren genau das, was hier
   * vermieden werden soll. Erst ab der siebten Karte wiederholt sich etwas.
   */
  function sensorAkzente(kennungen, hell) {
    const palette = hell ? SENSOR_FARBEN_HELL : SENSOR_FARBEN;
    const zu = {};
    const vergeben = new Set();
    (kennungen || []).forEach((id) => {
      let h = 0;
      const s = String(id || '');
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      let i = h % palette.length;
      for (let n = 0; n < palette.length && vergeben.has(i); n++) i = (i + 1) % palette.length;
      vergeben.add(i);
      if (vergeben.size >= palette.length) vergeben.clear();
      zu[s] = palette[i];
    });
    return zu;
  }

  function defaultSize(cardType) { return (CARD_TYPES[cardType] || {}).defaultSize || 'sm'; }

  function fmt(val, unit) { return unit ? `${val} ${unit}` : `${val}`; }

  // --- Querschnitt ueber alle Karten ------------------------------------------------------------
  //
  // Bis hierher hatte KEIN Kartentyp eine Einstellung fuer Nachkommastellen oder Symbol. Ein
  // Sensor, der 21.34567 meldet, stand genau so auf der Wand.

  /**
   * Rundet auf die eingestellte Stellenzahl. Ohne Einstellung bleibt der Wert unveraendert --
   * bewusst kein Standard-Runden, sonst aendert sich mit diesem Update stillschweigend jede
   * bestehende Karte.
   */
  function zahlFormatieren(roh, stellen) {
    if (stellen === undefined || stellen === null || stellen === '') return roh;
    const n = parseFloat(roh);
    if (!Number.isFinite(n)) return roh;
    const k = Math.max(0, Math.min(6, parseInt(stellen, 10)));
    // toLocaleString statt toFixed: 1234.5 gehoert auf einem deutschen Panel als 1.234,5
    // dargestellt, nicht als 1234.5.
    return n.toLocaleString('de-DE', { minimumFractionDigits: k, maximumFractionDigits: k });
  }

  /** Das gewaehlte Symbol, sonst das vom Kartentyp vorgesehene. */
  function symbolFuer(settings, standard) {
    const w = settings && settings.icon;
    return (w && ICONS[w]) ? ICONS[w] : standard;
  }

  // --- Symbole aus Home Assistant ----------------------------------------------------------------
  //
  // Home Assistant gibt das Symbol einer Entitaet nur als NAMEN zurueck ("mdi:weather-sunny").
  // Die Zeichnung dazu liegt in renderer/shared/mdi-pfade.js -- einer erzeugten Datei mit allen
  // 7447 Material-Design-Symbolen, die BEWUSST nicht beim Start geladen wird: 2,6 MB fuer einen
  // Fall, den die meisten Dashboards nie brauchen, waeren beim Aufwachen jedes Mal zu bezahlen.
  //
  // Die Sensorkarte ist der einzige Ort, an dem das Symbol aus Home Assistant gewinnt. Sie ist
  // der Sammelfall: Was hier landet, hat keine eigene Karte -- und damit auch kein Symbol, das
  // jemand fuer diesen Fall entworfen haette. Bei einer Klimakarte waere es umgekehrt falsch:
  // Dort sagt die Bewegung des eigenen Symbols etwas, das ein fremdes nicht sagen kann.
  function mdiSymbol(name) {
    const roh = String(name || '').trim().replace(/^mdi:/, '');
    if (!roh) return '';
    const pfade = (typeof window !== 'undefined' && window.MDI_PFADE) || null;
    const d = pfade && pfade[roh];
    if (!d) return '';
    // Material-Design-Symbole sind Flaechen, keine Striche -- deshalb fill und kein stroke.
    return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="' + d + '"/></svg>';
  }

  /** Braucht diese Karte ein Symbol aus Home Assistant? (Fuer das Nachladen der Pfade.) */
  function brauchtMdi(type, state, settings) {
    if (type !== 'sensor') return false;
    if (settings && settings.icon) return false;    // eigene Wahl schlaegt alles
    return !!(state && state.attributes && state.attributes.icon);
  }

  // --- Schnellzugriff ---------------------------------------------------------------------------
  //
  // Die Kacheln konnten bisher AUSSCHLIESSLICH eine Quelle an einem Media Player waehlen. Damit
  // war die Karte an einen einzigen Anwendungsfall genagelt, obwohl sie wie eine allgemeine
  // Schnellwahl aussieht. Jetzt kann eine Kachel auch ein Skript oder eine Szene ausloesen.
  //
  // Alte Kacheln haben kein `art`-Feld -- die gelten weiter als Quellenwahl, sonst waeren sie
  // nach dem Update stumm.

  /** Was beim Druck auf die Kachel passieren soll: {domain, service, entity_id, daten}. */
  function quickTileAktion(t) {
    const kachel = t || {};
    const art = kachel.art || 'media';
    if (art === 'script') {
      const id = kachel.entity || '';
      // script.turn_on statt script.<name>: funktioniert fuer jedes Skript gleich, ohne
      // den Dienstnamen aus der Entitaets-ID zu basteln.
      return { domain: 'script', service: 'turn_on', entity_id: id, daten: {} };
    }
    if (art === 'scene') {
      return { domain: 'scene', service: 'turn_on', entity_id: kachel.entity || '', daten: {} };
    }
    return {
      domain: 'media_player', service: 'select_source',
      entity_id: kachel.mediaPlayerEntity || '', daten: { source: kachel.source || '' }
    };
  }

  /** Leuchtet die Kachel gerade? Nur die Quellenwahl kennt einen "laeuft"-Zustand. */
  function quickTileAktiv(t, statesById) {
    const kachel = t || {};
    if ((kachel.art || 'media') !== 'media') return false;
    const st = (statesById || {})[kachel.mediaPlayerEntity];
    return !!(st && st.state === 'playing' && st.attributes && st.attributes.source === kachel.source);
  }

  /** Beschriftung, wenn kein Bild hinterlegt ist. */
  function quickTileText(t) {
    const kachel = t || {};
    return kachel.label || kachel.source || kachel.entity || '?';
  }

  // --- Foto-Bereich -----------------------------------------------------------------------------
  //
  // Eine Karte konnte genau ein Bild zeigen. Fuer eine Diashow werden weitere Bilder unter
  // derselben Route mit angehaengter Nummer abgelegt -- kein neuer Server-Code noetig, dieselbe
  // Loesung wie beim zweiten Bild des Ankunftsschirms.
  //
  // Bild 1 behaelt die ID OHNE Nummer: Bestehende Karten sollen nach dem Update ihr Bild
  // behalten, nicht auf einen leeren Rahmen schauen.

  /** Speicher-ID des n-ten Bildes (n ab 0). */
  function fotoBildId(cardId, n) { return n === 0 ? String(cardId) : String(cardId) + '__' + (n + 1); }

  /** Die Versionsnummern aller Bilder einer Foto-Karte, alte Einzelbild-Karten eingeschlossen. */
  function fotoVersionen(settings) {
    const st = settings || {};
    if (Array.isArray(st.photoBilder) && st.photoBilder.length) return st.photoBilder.slice(0, 8);
    return st.photoVersion ? [st.photoVersion] : [];
  }

  /** Bild-Adressen der Karte, in der Reihenfolge der Diashow. */
  function fotoUrls(cardId, settings, apiBase) {
    const base = apiBase || '';
    return fotoVersionen(settings).map((v, i) =>
      `${base}/api/photo-card/${encodeURIComponent(fotoBildId(cardId, i))}/background?v=${v}`);
  }

  // --- Verlauf im Hintergrund einer Sensorkarte ---------------------------------------------------
  //
  // Eine Sensorkarte zeigte Symbol, Zahl und Name -- auf einer grossen Kachel viel Luft und
  // wenig Aussage. Die Zahl allein beantwortet auch die eigentliche Frage nicht: 21 Grad sind
  // etwas anderes, wenn es seit Stunden faellt, als wenn es steigt.
  //
  // Also derselbe Verlauf, den die Verlaufskarte ohnehin abruft, aber als ruhige Flaeche im
  // unteren Drittel hinter dem Text -- kein zweites Diagramm, sondern Untergrund.

  /** Gefuellte Flaeche ohne Achsen und Beschriftung. Leer, wenn zu wenige Punkte da sind. */
  function miniVerlaufSvg(werte, id) {
    if (!werte || werte.length < 3 || werte.some(v => !Number.isFinite(v))) return '';
    const min = Math.min(...werte);
    const max = Math.max(...werte);
    const spanne = (max - min) || 1;
    const B = 100, H = 30;
    const punkte = werte.map((v, i) => {
      const x = (i / (werte.length - 1)) * B;
      const y = H - ((v - min) / spanne) * H;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const linie = 'M' + punkte.join(' L');
    const flaeche = `${linie} L${B},${H} L0,${H} Z`;
    return `<svg class="mini-verlauf" viewBox="0 0 ${B} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="mv-${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.30"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${flaeche}" fill="url(#mv-${id})"/>
      <path d="${linie}" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.1"
            vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  /**
   * Tendenz ueber den Zeitraum: steigt, faellt, oder nichts Nennenswertes.
   *
   * Zwei Vorkehrungen, beide gegen dieselbe Sorte Fehlalarm:
   *
   * Erstens werden DRITTEL gemittelt, nicht der erste mit dem letzten Punkt verglichen. Bei
   * einem Einzelpunktvergleich entscheidet ein einziger Ausreisser am Rand ueber die ganze
   * Aussage -- und Sensordaten haben Ausreisser.
   *
   * Zweitens eine Totzone von einem Zehntel der beobachteten Spanne. Ein Sensor, der um sich
   * herum zappelt, ist nicht "steigend". Ohne die Zone zeigte der Pfeil bei jedem Aufbau in
   * eine andere Richtung -- ein Flackern an der Wand, das schlimmer waere als gar keine
   * Angabe. Relativ zur Spanne, weil ein halbes Grad bei einem Raumthermometer viel ist und
   * bei einem Backofen nichts.
   */
  const TENDENZ_TOTZONE = 0.1;

  function tendenz(series) {
    if (!series || series.length < 3) return null;
    if (series.some(v => !Number.isFinite(v))) return null;
    const drittel = Math.max(1, Math.ceil(series.length / 3));
    const mittel = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const anfang = mittel(series.slice(0, drittel));
    const ende = mittel(series.slice(-drittel));
    const spanne = Math.max(...series) - Math.min(...series);
    const totzone = Math.max(spanne * TENDENZ_TOTZONE, 1e-9);
    const d = ende - anfang;
    if (Math.abs(d) <= totzone) return { richtung: 0, delta: 0 };
    return { richtung: d > 0 ? 1 : -1, delta: d };
  }

  // --- Ankuendigungs-Box: was zaehlt als "nichts anzuzeigen"? -------------------------------------
  //
  // Die Box liest eine input_text-Entitaet. Steht dort etwas, wird sie gezeigt, sonst nicht.
  // Die Frage ist nur, was "nichts" heisst -- und da reicht "leer" nicht:
  //
  // Home Assistant liefert selbst `unknown` und `unavailable`. Dazu kommt, was Menschen in
  // solche Felder schreiben, wenn sie sie leeren wollen: ein Strich, "keine", "none" -- oder
  // ein Tippfehler. Auf dem Geraet stand tatsaechlich "unknow" ohne das letzte n; mit einer
  // Pruefung nur auf "unknown" wuerde dieses Wort formatfuellend an der Wand stehen.
  //
  // Grosszuegig sein kostet hier fast nichts: Wer wirklich "keine" ankuendigen will, schreibt
  // einen Satz darum. Umgekehrt ist eine Wand, auf der "unknow" steht, ein sichtbarer Fehler.

  const NICHTS_ANZUZEIGEN = [
    '', '-', '--', '—', 'unknown', 'unknow', 'unavailable', 'none', 'null', 'undefined',
    'n/a', 'na', 'leer', 'unbekannt', 'nicht verfuegbar', 'nicht verfügbar', 'keine', 'kein'
  ];

  // Bewusst ueber Zeichencodes zusammengesetzt statt als Maskierungen geschrieben: Diese
  // Datei wird von Skripten veraendert, und eine zerbrochene Maskierung faellt erst zur
  // Laufzeit auf. Dieselbe Vorsichtsmassnahme wie bei NEUE_ZEILE in ankunftsschirm.js.
  const ZEILENUMBRUCH = new RegExp(String.fromCharCode(13) + "?" + String.fromCharCode(10));
  const UEBERSCHRIFT = new RegExp("^#{1,3}" + String.fromCharCode(92) + "s+");
  const AUFZAEHLUNG = new RegExp("^[-*+]" + String.fromCharCode(92) + "s+");
  const AUSZEICHNUNG = new RegExp("[*_`]", "g");

  /**
   * Eine Zeile aus dem Ankuendigungstext -- fuer die untere Leiste.
   *
   * Dort ist Platz fuer eine Zeile, nicht fuer einen Absatz. Genommen wird die Ueberschrift,
   * sonst der erste Absatz; Auszeichnungen fallen weg, weil Sternchen in einer Zeile nur
   * stoeren. Der ganze Text kommt beim Antippen zurueck.
   */
  function ankuendigungKurz(roh) {
    const zeilen = String(roh || "").split(ZEILENUMBRUCH).map(z => z.trim()).filter(Boolean);
    if (!zeilen.length) return "";
    const ueberschrift = zeilen.find(z => UEBERSCHRIFT.test(z));
    return (ueberschrift || zeilen[0])
      .replace(UEBERSCHRIFT, "")
      .replace(AUFZAEHLUNG, "")
      .replace(AUSZEICHNUNG, "")
      .trim();
  }

  /** Der anzuzeigende Text, oder '' wenn nichts anzuzeigen ist. */
  function ankuendigungsText(roh) {
    const text = String(roh == null ? '' : roh).trim();
    return NICHTS_ANZUZEIGEN.includes(text.toLowerCase()) ? '' : text;
  }

  // --- Flügeltor: die Karte zeigt, was das Tor gerade TUT ---------------------------------------
  //
  // Ein Rollladen wird in Prozent gemessen, ein Tor nicht: Es ist zu, es geht auf, es ist auf,
  // es geht zu. Aus fünf Metern liest niemand "73 %" -- aber zwei Flügel, die offen stehen,
  // erkennt man sofort.
  //
  // Die Bewegung ist deshalb auch keine Verzierung. Ob ein Tor OFFEN ist oder gerade AUFGEHT,
  // ist der Unterschied zwischen "ich kann losfahren" und "ich muss noch warten" -- und dieser
  // Unterschied steht auf der Karte sonst nirgends.
  //
  // Die Karte SCHALTET NICHT. Ein Tor, das aus Versehen aufgeht, weil jemand im Vorbeigehen die
  // Wand berührt hat, ist genau das, was auf einem Wandpanel nicht passieren darf. Zum Öffnen
  // gibt es die Tor-Karte mit ihren Knöpfen (Kartentyp "Tor öffnen").
  const TOR_ZUSTAENDE = {
    closed:  { text: 'Geschlossen', klasse: 'tor-zu',       akzent: null },
    open:    { text: 'Offen',       klasse: 'tor-auf',      akzent: '#6fd6a0' },
    opening: { text: 'Öffnet …',    klasse: 'tor-oeffnet',  akzent: '#ffc061' },
    closing: { text: 'Schließt …',  klasse: 'tor-schliesst', akzent: '#ffc061' }
  };

  // Wie viel laenger eine Fahrt dauern darf, bevor sie als ueberfaellig gilt: ein Drittel
  // mehr, mindestens aber drei Sekunden Luft. Ein Torantrieb faehrt nicht jeden Tag gleich
  // schnell -- bei Frost, gegen den Wind, mit einem Ast im Weg. Zu knapp gesetzt waere die
  // Warnung jeden zweiten Tag rot und damit wertlos.
  // Rot heisst hier: Die Fahrt dauert laenger als gemessen. Derselbe Ton wie bei der
  // kritischen Akkuwarnung -- auf dieser Wand soll Rot immer dasselbe bedeuten.
  const TOR_ROT = '#ff4444';

  const TOR_TOLERANZ = 1.34;
  const TOR_TOLERANZ_SEKUNDEN = 3;

  /**
   * Steht das Tor auf Dauer-Auf?
   *
   * Viele Torsteuerungen kennen einen Zustand "bleibt offen" -- fuer den Umzugswagen, fuer die
   * Gartenparty, fuer den Paketboten. Das Tor faehrt dann nicht zu, und genau das ist gewollt.
   * Eine Warnung "dauert laenger als sonst" waere dort falsch: Sie meldet einen Fehler, wo
   * keiner ist, und nach dem dritten Mal glaubt man ihr auch dann nicht mehr, wenn wirklich
   * etwas klemmt.
   *
   * Welche Entitaet das meldet, weiss nur der Nutzer -- es ist je nach Anlage ein Schalter, ein
   * input_boolean oder, wie hier, ein Licht.
   */
  function torDauerauf(settings, statesById) {
    const id = settings && settings.torDaueraufEntity;
    if (!id || !statesById) return false;
    const s = statesById[id];
    if (!s) return false;
    const z = String(s.state || '').toLowerCase();
    // "on" ist der Normalfall; "open"/"true" fangen Entitaeten ab, die ihren Zustand anders
    // benennen. Alles andere gilt als aus -- auch "unavailable": Ein Melder, den niemand
    // erreicht, darf die Warnung nicht dauerhaft abschalten.
    return z === 'on' || z === 'open' || z === 'true';
  }

  /**
   * Dauer, Startversatz und Ueberfaelligkeit der Torbewegung.
   *
   * Ohne Messung bleibt es bei einer Schleife: Sie sagt "es bewegt sich", mehr nicht. MIT
   * Messung laeuft die Animation genau so lange wie das Tor und faengt dort an, wo die Fahrt
   * gerade steht -- Home Assistant sagt mit `last_changed`, wann sie begann. Dann zeigt der
   * Fluegel nicht "irgendwas bewegt sich", sondern "halb offen".
   *
   * Dauert es laenger als gemessen, stimmt etwas nicht: Das Tor klemmt, etwas steht im Weg,
   * oder die Meldung "offen" ist verloren gegangen. Die Karte wird dann rot und behaelt den
   * Zustand -- eine Karte, die in diesem Fall einfach weiterlaeuft, behauptet, alles sei in
   * Ordnung.
   *
   * @param {string} zustand      'opening' | 'closing' | ...
   * @param {object} zeiten       gemessene Zeiten { oeffnen, schliessen } in Sekunden
   * @param {string} seitIso      last_changed aus Home Assistant
   * @param {number} jetztMs
   * @param {boolean} dauerauf  Dauer-Auf aktiv -- dann gibt es keine Ueberfaelligkeit
   */
  function torAnimation(zustand, zeiten, seitIso, jetztMs, dauerauf) {
    const z = String(zustand || '').toLowerCase();
    const faehrt = z === 'opening' || z === 'closing';
    if (!faehrt) return { faehrt: false, dauer: 0, versatz: '0s', echtzeit: false, ueberfaellig: false };

    const gemessen = Number(zeiten && (z === 'opening' ? zeiten.oeffnen : zeiten.schliessen));
    const jetzt = jetztMs === undefined ? Date.now() : jetztMs;
    const seit = Date.parse(seitIso || '');
    const laeuftSeit = Number.isFinite(seit) ? (jetzt - seit) / 1000 : NaN;

    // Ohne Messung oder ohne brauchbaren Startzeitpunkt: die alte Schleife.
    if (!(gemessen > 0) || !Number.isFinite(laeuftSeit) || laeuftSeit < 0) {
      return {
        faehrt: true, dauer: TOR_TAKT, echtzeit: false, ueberfaellig: false,
        versatz: animationsPhase(TOR_TAKT, false, jetztMs)
      };
    }

    const grenze = Math.max(gemessen * TOR_TOLERANZ, gemessen + TOR_TOLERANZ_SEKUNDEN);
    return {
      faehrt: true,
      dauer: gemessen,
      echtzeit: true,
      // Bei Dauer-Auf gibt es nichts zu warnen: Dass das Tor nicht zufaehrt, ist dort gewollt.
      ueberfaellig: !dauerauf && laeuftSeit > grenze,
      // Negativ: Die Animation faengt dort an, wo die Fahrt gerade steht.
      versatz: '-' + Math.min(laeuftSeit, gemessen).toFixed(2) + 's'
    };
  }

  /**
   * Wie das Tor gerade dasteht.
   *
   * `unavailable` und Unbekanntes werden ausdrücklich NICHT als "geschlossen" gelesen: Ein Tor,
   * das offen steht, während die Karte "Geschlossen" behauptet, ist schlimmer als eine Karte,
   * die zugibt, dass sie es nicht weiß.
   */
  function torDarstellung(zustand) {
    const z = String(zustand || '').toLowerCase();
    if (TOR_ZUSTAENDE[z]) return Object.assign({ zustand: z }, TOR_ZUSTAENDE[z]);
    return { zustand: z, text: 'Unbekannt', klasse: 'tor-unbekannt', akzent: null };
  }

  // --- Klimaanlage: das Symbol zeigt, WAS die Anlage tut -----------------------------------------
  //
  // Vorher trug die Karte immer dasselbe Symbol -- auch im ausgeschalteten Zustand stand dort
  // ein Kuehlsymbol. Aus dem Vorbeigehen las man daraus das Gegenteil der Wahrheit.
  //
  // Die Bewegung ist keine Spielerei: Sie unterscheidet "laeuft gerade" von "ist eingestellt".
  // Steht die Flamme still, heizt die Anlage nicht, auch wenn Heizen gewaehlt ist.

  const HVAC_SYMBOL = {
    off: 'hvacOff',
    heat: 'hvacHeat',
    cool: 'hvacCool',
    dry: 'hvacDry',
    fan_only: 'hvacFan',
    auto: 'hvacAuto',
    heat_cool: 'hvacAuto'
  };

  // Die Bewegung haengt an der UHR, nicht am Alter des Elements.
  //
  // Eine Karte wird bei jeder Aenderung neu gebaut -- und seit die Live-Verbindung besteht,
  // passiert das oft und unregelmaessig. Eine CSS-Animation faengt in einem frisch gebauten
  // Element aber immer bei null an: Die Schneeflocke sprang dann mitten in der Drehung zurueck
  // auf ihre Ausgangslage, die Flamme setzte neu an. Von aussen sah das aus wie eine
  // stotternde Animation; gemeldet wurde es als "die spackt rum".
  //
  // Ein negativer animation-delay verschiebt den Startpunkt in die Vergangenheit: Mit
  // -3s beginnt eine 12-Sekunden-Drehung bei einem Viertel. Rechnet man ihn aus der aktuellen
  // Uhrzeit, steht jedes neu gebaute Element genau dort, wo das alte gerade war -- die
  // Bewegung laeuft ueber den Neuaufbau hinweg weiter, ohne dass jemand das Element
  // aufheben muesste.
  //
  // Bei `alternate` ist der volle Zyklus doppelt so lang (hin und zurueck), sonst sprangen
  // die Flammen bei jedem zweiten Neuaufbau an den Wendepunkt.

  /** Negativer Startversatz, damit eine Animation dort weiterlaeuft, wo sie gerade waere. */
  function animationsPhase(dauerSekunden, wechselnd, jetztMs) {
    const dauer = Number(dauerSekunden);
    if (!(dauer > 0)) return '0s';
    const zyklus = wechselnd ? dauer * 2 : dauer;
    const jetzt = (jetztMs === undefined ? Date.now() : jetztMs) / 1000;
    const versatz = ((jetzt % zyklus) + zyklus) % zyklus;
    return '-' + versatz.toFixed(2) + 's';
  }

  // Die Dauern stehen in dashboard.css; hier stehen sie ein zweites Mal, und das ist die
  // Schwachstelle dieser Loesung: Wer dort eine Dauer aendert und hier nicht, bekommt keinen
  // Fehler, sondern einen Sprung beim Neuaufbau -- also genau das, was das hier verhindern
  // soll. Deshalb tragen beide Seiten denselben Namen.
  // Wie lange eine Runde "Tor faehrt" dauert. Steht auch in dashboard.css -- wer eine der
  // beiden Zahlen aendert, bekommt keinen Fehler, sondern einen Sprung beim Neuaufbau.
  const TOR_TAKT = 3.2;

  const HVAC_ANIMATIONEN = [
    ['zucken', 1.1, true],
    ['atmen', 2.3, true],
    ['flocke', 12, false],
    ['tropfen', 2.4, false],
    ['luefter', 3.2, false],
    ['auto', 3.4, true]
  ];

  /** style-Attribut fuer das Klima-Symbol: je Animation ein Startversatz. */
  function hvacPhasenStil(jetztMs) {
    return HVAC_ANIMATIONEN
      .map(([name, dauer, wechselnd]) => '--ph-' + name + ':' + animationsPhase(dauer, wechselnd, jetztMs))
      .join(';');
  }

  /** Symbolname und Bewegungsklasse fuer eine Betriebsart. */
  function hvacSymbol(modus, laeuftGerade) {
    const name = HVAC_SYMBOL[modus] || 'climate';
    // 'off' bewegt sich nie -- eine ausgeschaltete Anlage tut nichts.
    const bewegt = modus !== 'off' && laeuftGerade !== false;
    return { name, klasse: bewegt ? 'hvac-laeuft' : '' };
  }

  /**
   * Betriebsarten in einer sinnvollen Reihenfolge: "Aus" zuerst.
   *
   * Home Assistant liefert sie in der Reihenfolge der Integration, und die setzt "off"
   * gelegentlich mitten hinein. Auf einem Wandpanel sucht man den Aus-Knopf dann zwischen
   * Heizen und Kuehlen -- ausgerechnet den, den man im Zweifel schnell trifft.
   */
  function hvacReihenfolge(modi) {
    const liste = Array.isArray(modi) ? modi.slice() : [];
    const rang = { off: 0, auto: 1, heat_cool: 1, heat: 2, cool: 3, dry: 4, fan_only: 5 };
    return liste.sort((a, b) => (rang[a] === undefined ? 9 : rang[a]) - (rang[b] === undefined ? 9 : rang[b]));
  }

  // --- Symbole, die sich von selbst einstellen ---------------------------------------------------
  //
  // Ein Symbol je Knopf hilft nur, wenn eines da ist. Es aber erst auszuwaehlen bedeutet: Wer
  // die Einstellung nie oeffnet, hat nie ein Symbol -- und genau der braucht es. Also raten,
  // und zwar aus dem, was ohnehin dasteht: der Beschriftung und der Entitaets-ID.
  //
  // Geraten wird nur, wenn nichts gewaehlt ist; eine Auswahl gewinnt immer.

  const SYMBOL_WOERTER = [
    [['garage'], 'garage'],
    [['tor', 'gate', 'einfahrt', 'hoftor'], 'gate'],
    [['tuer', 'tür', 'door', 'haustuer', 'haustür', 'eingang'], 'door'],
    [['schloss', 'lock', 'riegel'], 'lockClosed'],
    [['rollladen', 'rolladen', 'jalousie', 'markise'], 'cover'],
    [['licht', 'lampe', 'light'], 'light'],
    [['szene', 'scene'], 'sun2'],
    [['auf', 'open', 'hoch'], 'arrowUp'],
    [['zu', 'close', 'runter'], 'arrowDown'],
    [['stopp', 'stop', 'halt'], 'stopSquare']
  ];

  /** Ein passendes Symbol aus Beschriftung und Entitaet, oder das Taster-Symbol als Rueckfall. */
  function symbolErraten(beschriftung, entitaet) {
    const heu = (String(beschriftung || '') + ' ' + String(entitaet || '')).toLowerCase();
    for (const [woerter, symbol] of SYMBOL_WOERTER) {
      if (woerter.some(w => heu.includes(w))) return symbol;
    }
    return 'button';
  }

  // --- Innen oder aussen? ---------------------------------------------------------------------
  //
  // Zwei Temperaturkarten nebeneinander sahen bis hierher gleich aus: dasselbe Thermometer,
  // dieselbe grosse Zahl, und der Unterschied stand allein in der Bildunterschrift -- der
  // kleinsten Schrift auf der Karte. Aus zwei Metern las man "21,4" und "8,2" und musste raten,
  // welche Zahl die draussen ist. Beim Luftdruck ist es noch schlimmer, da liegen die Werte
  // innen und aussen fast gleich.
  //
  // Die Regel, die sich merken laesst: **Die Zahl sagt WAS, das Zeichen sagt WO.** Die Einheit
  // (°C, hPa, %) unterscheidet die Messgroesse; der Ort bekommt ein eigenes Zeichen, das man an
  // der FORM erkennt, nicht an der Schrift:
  //
  //   - ein grosses Wort im Chip oben rechts ("INNEN" / "AUSSEN"),
  //   - das Symbol oben links wird zum Haus bzw. zur Tanne,
  //   - und dieselbe Silhouette liegt gross und blass im Kartenhintergrund.
  //
  // Die Silhouette ist das, was aus der Entfernung traegt: Ein Haus und eine Tanne sind auch
  // dann noch auseinanderzuhalten, wenn man kein Wort mehr lesen kann.
  //
  // Bewusst NICHT ueber die Farbe. Die Temperaturkarte faerbt ihren Akzent schon nach dem Wert
  // (tempAkzent: blau kalt, rot warm) -- eine zweite Farbbedeutung auf derselben Karte hiesse,
  // dass man nicht mehr weiss, ob "blau" kalt oder draussen bedeutet. Und Farbe als Flaeche
  // verbietet ohnehin ADR 0004.

  const ORTE = {
    innen: {
      text: 'Innen',
      symbol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5.5h4V20"/></svg>',
      silhouette: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 1.5 11.2l1.4 1.6L4.5 11.5V21h15v-9.5l1.6 1.3 1.4-1.6z"/></svg>'
    },
    aussen: {
      text: 'Außen',
      symbol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3 4 11h2.5L3.5 16h11L11.5 11H14z"/><path d="M9 16v5"/><circle cx="18.5" cy="6" r="2.5"/></svg>',
      silhouette: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1 5.5 10h3L4.5 16h5.5v2.5h4V16h5.5l-4-6h3z"/><rect x="10.5" y="18" width="3" height="5"/></svg>'
    }
  };

  // Woerter, an denen sich der Ort erkennen laesst. Geprueft wird in Beschriftung UND Kennung --
  // "sensor.aussentemperatur" genuegt, auch wenn die Karte "Temperatur" heisst.
  const ORT_WOERTER = [
    [['aussen', 'außen', 'outdoor', 'outside', 'draussen', 'draußen', 'garten', 'balkon',
      'terrasse', 'wetterstation', 'weather_station'], 'aussen'],
    [['innen', 'indoor', 'inside', 'wohnzimmer', 'schlafzimmer', 'kinderzimmer', 'kueche',
      'küche', 'bad', 'buero', 'büro', 'flur', 'keller', 'zimmer', 'wohnung'], 'innen']
  ];

  /**
   * Der Ort einer Messkarte: 'innen', 'aussen' oder '' (keiner).
   *
   * Eine ausdrueckliche Einstellung gewinnt immer, auch 'kein' -- wer die Markierung abschaltet,
   * soll sie nicht zurueckbekommen, weil zufaellig "bad" im Namen steht ("Badewasser"...).
   * Ohne Einstellung wird geraten, und zwar AB WERK: Eine Verbesserung, die man erst
   * einschalten muss, ist fuer die meisten keine (siehe CLAUDE.md, symbolErraten).
   *
   * "Aussen" wird zuerst geprueft. "Aussenwand Wohnzimmer" ist ein Messpunkt aussen, und ein
   * Sensor, der "outdoor" heisst, ist selten falsch benannt.
   */
  function ortErmitteln(settings, beschriftung, entitaet) {
    const w = settings && settings.ort;
    if (w === 'innen' || w === 'aussen') return w;
    if (w === 'kein') return '';
    const heu = (String(beschriftung || '') + ' ' + String(entitaet || '')).toLowerCase();
    for (const [woerter, ort] of ORT_WOERTER) {
      if (woerter.some(x => heu.includes(x))) return ort;
    }
    return '';
  }

  // Nur dort, wo dieselbe Messgroesse innen UND aussen vorkommt. Wind, Regen und
  // Sonneneinstrahlung gibt es nur draussen -- ein "AUSSEN" darauf waere Rauschen.
  // Der Ring der Gauge-Karte hat keinen Platz fuer einen Chip und traegt sein eigenes Bild;
  // wer dort innen und aussen braucht, nimmt die Temperatur- oder Luftdruckkarte.
  const ORT_TYPEN = ['temperature', 'pressure', 'humidity', 'sensor'];

  // --- Hat es geklappt? ---------------------------------------------------------------------------
  //
  // Ein Torantrieb braucht Sekunden, bis sich etwas sichtbar tut, und ein Skript gibt ueberhaupt
  // keine Rueckmeldung. Bisher passierte nach dem Druck nichts -- man stand davor und druckte
  // ein zweites Mal, weil man nicht wusste, ob der erste angekommen war.
  //
  // Der Knopf beantwortet deshalb selbst, was er weiss: Der Befehl ist raus (Haken) oder er
  // ist nicht angekommen (Kreuz). Das ist BEWUSST keine Aussage darueber, ob das Tor
  // aufgegangen ist -- das weiss die App nicht, und so zu tun als ob waere schlimmer als
  // nichts zu sagen.

  const RUECKMELDUNG_MS = 1400;

  /**
   * Zeigt am Knopf, ob der Befehl durchging. `versprechen` liefert true/false.
   *
   * Der urspruengliche Inhalt wird gesichert und danach zurueckgesetzt -- auch im Fehlerfall,
   * sonst bliebe ein Knopf mit einem Haken darauf stehen und waere fuer immer unbeschriftet.
   */
  function rueckmeldung(el, versprechen) {
    if (!el) return;
    if (el.dataset.meldetGerade === '1') return;   // Doppeldruck nicht uebereinander legen
    const vorher = el.innerHTML;
    el.dataset.meldetGerade = '1';
    el.classList.add('wartet');

    const fertig = (ok) => {
      el.classList.remove('wartet');
      el.classList.add(ok ? 'geschafft' : 'fehlgeschlagen');
      el.innerHTML = `<span class="rueckmeldung-zeichen">${ok ? ICONS.check : ICONS.cross}</span>`;
      setTimeout(() => {
        el.classList.remove('geschafft', 'fehlgeschlagen');
        el.innerHTML = vorher;
        delete el.dataset.meldetGerade;
      }, RUECKMELDUNG_MS);
    };

    Promise.resolve(versprechen).then(
      (ok) => fertig(ok !== false),
      () => fertig(false)
    );
  }

  // --- Die Karte IST der Regler -----------------------------------------------------------------
  //
  // Vorher sass unter dem Wert ein duenner Schiebregler. Auf einem Wandpanel muss man den mit
  // dem Finger treffen -- bei einer kleinen Karte ist der Griff wenige Millimeter hoch. Jetzt
  // ist die ganze Kachel die Bedienflaeche: von unten nach oben wischen macht heller.
  //
  // Tippen und Wischen muessen sich dabei unterscheiden lassen. Ein Tippen schaltet um, ein
  // Wischen setzt den Wert. Die Grenze liegt bei WISCH_SCHWELLE Pixeln -- darunter zittert nur
  // der Finger, und ein Zittern darf nicht die Helligkeit verstellen.

  const WISCH_SCHWELLE = 10;

  /**
   * Macht aus einer Karte einen senkrechten Regler.
   *
   * `aufWert(pct)` kommt beim Loslassen nach einem Wisch, `aufTippen()` bei einer Beruehrung
   * ohne nennenswerte Bewegung. Waehrend des Wischens wird nur die Anzeige nachgefuehrt -- ein
   * Dienstaufruf pro Bildschirmaktualisierung wuerde Home Assistant fluten und die Lampe
   * flackern lassen.
   */
  function kachelRegler(card, opts) {
    const einstellung = opts || {};
    const fuellung = card.querySelector('.kachel-fuellung');
    const anzeige = card.querySelector('.value');
    let start = null;

    const setzeAnzeige = (pct) => {
      if (fuellung) fuellung.style.height = pct + '%';
      if (anzeige && einstellung.beschriftung) anzeige.textContent = einstellung.beschriftung(pct);
    };

    card.addEventListener('pointerdown', (e) => {
      // Eigene Bedienelemente auf der Karte (Farbtemperatur, Farbwahl) behalten Vorrang --
      // sonst liesse sich die Farbtemperatur nicht mehr verstellen, ohne zu dimmen.
      if (e.target.closest('input, button, select, a')) return;
      start = { y: e.clientY, pct: einstellung.wert || 0, bewegt: 0 };
      card.setPointerCapture(e.pointerId);
      card.classList.add('wird-geregelt');
    });

    card.addEventListener('pointermove', (e) => {
      if (!start) return;
      const hoehe = card.getBoundingClientRect().height || 1;
      const weg = start.y - e.clientY;              // nach oben = heller
      start.bewegt = Math.max(start.bewegt, Math.abs(weg));
      if (start.bewegt < WISCH_SCHWELLE) return;
      const pct = Math.max(0, Math.min(100, Math.round(start.pct + (weg / hoehe) * 100)));
      start.aktuell = pct;
      setzeAnzeige(pct);
    });

    const beenden = (e) => {
      if (!start) return;
      const s = start;
      start = null;
      card.classList.remove('wird-geregelt');
      try { card.releasePointerCapture(e.pointerId); } catch (err) { /* Zeiger schon weg */ }
      if (s.bewegt < WISCH_SCHWELLE) {
        if (einstellung.aufTippen) einstellung.aufTippen();
      } else if (einstellung.aufWert && s.aktuell !== undefined) {
        einstellung.aufWert(s.aktuell);
      }
    };
    card.addEventListener('pointerup', beenden);
    card.addEventListener('pointercancel', beenden);
  }

  /** Namen aller Symbole, die zur Auswahl stehen -- der Editor baut daraus die Liste. */
  function symbolNamen() { return Object.keys(ICONS); }

  // Ordnet einem Kalender-Termin-Titel eine Farbe nach deutscher Tonnenart zu -- rein
  // stichwortbasiert, damit es ohne Konfiguration mit den gaengigen Muellkalender-
  // Integrationen (z.B. Abfall.io) funktioniert.
  // Die eingebauten Regeln decken die gaengigen Muellkalender ab. Sie sind aber nur eine
  // Vermutung ueber deutsche Tonnenbezeichnungen: Wer "Gruengut" oder "Biotonne Sued" im
  // Kalender stehen hat, bekam bisher ausnahmslos Grau und hatte kein Gegenmittel. Eigene
  // Regeln werden deshalb ZUERST geprueft und gewinnen gegen die eingebauten.
  const WASTE_REGELN = [
    { muster: 'bio', farbe: '#6b8e23' },
    { muster: 'papier', farbe: '#4f7cff' },
    { muster: 'pappe', farbe: '#4f7cff' },
    { muster: 'blau', farbe: '#4f7cff' },
    { muster: 'gelb', farbe: '#f0b429' },
    { muster: 'verpackung', farbe: '#f0b429' },
    { muster: 'wertstoff', farbe: '#f0b429' },
    { muster: 'glas', farbe: '#22c55e' },
    { muster: 'sperrm', farbe: '#ef4444' },
    { muster: 'rest', farbe: '#6b7280' }
  ];
  const WASTE_UNBEKANNT = '#9ca3af';

  // Absichtlich Teilzeichenkette statt regulaerem Ausdruck: Die Muster kommen aus einem
  // Eingabefeld. Ein Klammerfehler darf dort keine Ausnahme werfen, die die ganze Karte
  // verschluckt -- und niemand tippt in ein Feld "Tonnenart" einen Ausdruck.
  function wasteColor(summary, eigene) {
    const s = (summary || '').toLowerCase();
    const regeln = (Array.isArray(eigene) ? eigene : []).concat(WASTE_REGELN);
    for (const r of regeln) {
      const m = String((r && r.muster) || '').trim().toLowerCase();
      if (m && s.includes(m)) return (r && r.farbe) || WASTE_UNBEKANNT;
    }
    return WASTE_UNBEKANNT;
  }

  /**
   * Liest ein Termindatum -- ein reines Datum als LOKALE Mitternacht.
   *
   * `new Date('2026-09-14')` ist nach der Norm UTC-Mitternacht. Westlich von Greenwich ist das
   * der 13. September, und ein Ganztagestermin rutscht auf den Vortag: Die Tonne steht dann
   * einen Tag zu frueh auf der Karte. Genau dieser Fall steht als Fallstrick in CLAUDE.md und
   * hat die Kalenderauswertung schon einmal erwischt. Ein Zeitpunkt MIT Uhrzeit bringt seine
   * Zone selbst mit und wird unveraendert gelesen.
   */
  function wasteDatum(wert) {
    const s = String(wert == null ? '' : wert).trim();
    const nurDatum = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (nurDatum) return new Date(+nurDatum[1], +nurDatum[2] - 1, +nurDatum[3]);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Der Tag, an dem ein Termin liegt -- als ortsbezogener Schluessel zum Gruppieren. */
  function wasteTagesschluessel(wert) {
    const d = wasteDatum(wert);
    if (!d) return '';
    const zwei = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + zwei(d.getMonth() + 1) + '-' + zwei(d.getDate());
  }

  /**
   * Fasst Termine zu TAGEN zusammen.
   *
   * Auf der Karte interessiert "was kommt an welchem Tag raus", nicht eine flache Liste, in
   * der derselbe Tag dreimal untereinander steht. In Crespina fahren dienstags zwei Tonnen
   * zusammen -- als Einzelzeilen frisst das die halbe Karte und sieht aus wie ein Fehler.
   */
  function wasteTage(events, hoechstens) {
    const tage = [];
    const nach = new Map();
    for (const e of (Array.isArray(events) ? events : [])) {
      const schluessel = wasteTagesschluessel(e && e.start);
      if (!schluessel) continue;
      if (!nach.has(schluessel)) {
        const tag = { tag: schluessel, start: e.start, arten: [] };
        nach.set(schluessel, tag);
        tage.push(tag);
      }
      const art = String((e && e.summary) || '').trim();
      if (art && nach.get(schluessel).arten.indexOf(art) < 0) nach.get(schluessel).arten.push(art);
    }
    tage.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
    const n = Number(hoechstens);
    return n > 0 ? tage.slice(0, n) : tage;
  }

  /**
   * Steht die Tonne heute oder morgen an?
   *
   * Nur dafuer faerbt sich der Zustands-Chip ein. Ab uebermorgen ist es eine Information,
   * heute und morgen ist es eine Aufgabe -- und wer im Vorbeigehen hinsieht, soll den
   * Unterschied sehen, ohne das Datum zu lesen.
   */
  function wasteBald(wert) {
    const d = wasteDatum(wert);
    if (!d) return false;
    const heute = new Date(); heute.setHours(0, 0, 0, 0);
    const ziel = new Date(d); ziel.setHours(0, 0, 0, 0);
    const tage = Math.round((ziel - heute) / 86400000);
    return tage >= 0 && tage <= 1;
  }

  // Formatiert ein Datum relativ ("Heute", "Morgen", sonst Wochentag + Datum)
  function wasteDateLabel(dateStr) {
    const d = wasteDatum(dateStr);
    if (!d) return '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(d); target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target - today) / 86400000);
    if (diffDays === 0) return 'Heute';
    if (diffDays === 1) return 'Morgen';
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  }

  // HA-Wetterzustand (z.B. "partlycloudy", "pouring") auf eines unserer Icons abbilden
  function conditionIcon(condition) {
    const c = (condition || '').toLowerCase();
    if (c.includes('clear') || c === 'sunny') return 'sunny';
    if (c.includes('snow') || c.includes('hail')) return 'snowy';
    if (c.includes('lightning') || c.includes('thunder')) return 'storm';
    if (c.includes('rain') || c.includes('pouring') || c.includes('drizzle')) return 'rain';
    if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'fog';
    if (c.includes('cloud')) return 'cloudy';
    return 'cloudy';
  }

  // Aktualisiert Uhrzeit/Datum einer Uhr-Karte -- wird beim Bauen einmal aufgerufen
  // und kann von aussen periodisch erneut aufgerufen werden (Karte bleibt bestehen).
  // Das Format haengt an der Karte, nicht am Modul. renderClockNow wird auch als
  // forEach-Rueckruf uebergeben -- deshalb liest die Funktion die Einstellungen aus dem
  // Element statt aus einem zweiten Argument, das dort niemand uebergeben koennte.
  function renderClockNow(card) {
    let opt = {};
    try { opt = JSON.parse(card.dataset.uhr || '{}'); } catch (e) { opt = {}; }
    const sprache = opt.locale || 'de-DE';
    const now = new Date();
    const timeEl = card.querySelector('.clock-time');
    const dateEl = card.querySelector('.clock-date');
    const zeitFormat = { hour: '2-digit', minute: '2-digit' };
    if (opt.sekunden) zeitFormat.second = '2-digit';
    // hour12 nur setzen, wenn ausdruecklich gewaehlt -- sonst entscheidet die Sprache, und
    // genau das will man bei "automatisch".
    if (opt.stunden12 === true) zeitFormat.hour12 = true;
    if (opt.stunden12 === false) zeitFormat.hour12 = false;
    if (timeEl) timeEl.textContent = now.toLocaleTimeString(sprache, zeitFormat);
    if (dateEl) {
      // Mit Jahr: Das Datum stand vorher als "Samstag, 12. September" da und liess eine
      // Zeile halb leer. Auf einem Wandpanel ist die Frage nach dem Jahr selten, aber der
      // Platz ist ohnehin da -- und eine ausgeschriebene Zeile liest sich von weitem besser
      // als eine abgekuerzte.
      dateEl.textContent = opt.ohneDatum ? ''
        : now.toLocaleDateString(sprache, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
      dateEl.style.display = opt.ohneDatum ? 'none' : '';
    }
  }

  // Farbverlauf blau (kalt) -> rot (warm) je nach Temperaturwert, fuer die Temperatur-Karte
  /**
   * Temperaturfarbe: blau (kalt) bis rot (warm).
   *
   * Frueher war das ein Verlauf, mit dem die ganze Kachel geflutet wurde. Genau daher kam
   * der Eindruck von Bastelei -- eine deckend rote Kachel neben einer deckend blauen, auf
   * einem Hintergrund, der von Zurueckhaltung lebt. Jetzt kommt eine einzelne Farbe heraus,
   * die Symbol, Regler und Schein einfaerbt.
   */
  function tempAkzent(value, unit) {
    if (value === null || value === undefined || isNaN(value)) return 'rgba(255,255,255,0.6)';
    let celsius = value;
    if (unit === '°F') celsius = (value - 32) * 5 / 9;
    const clamped = Math.max(-10, Math.min(35, celsius));
    const t = (clamped + 10) / 45;
    const hue = 210 - t * 210;
    // Hell und nur mittel gesaettigt: Die Farbe steht auf Glas, nicht auf Weiss.
    return `hsl(${hue.toFixed(0)},72%,68%)`;
  }

  // Ermittelt Wertebereich [min,max] fuer den Gauge-Ring, falls in den Karten-Einstellungen
  // keins vorgegeben ist: bei %/Batterie/Feuchtigkeit fest 0-100, bei Temperatur ein
  // sinnvoller Bereich, sonst aus dem beobachteten Verlauf der letzten 24h.
  function gaugeRange(attrs, history) {
    const unit = attrs.unit_of_measurement;
    const dc = attrs.device_class;
    if (unit === '%' || dc === 'battery' || dc === 'humidity') return [0, 100];
    if (dc === 'temperature') return [-10, 40];
    if (history && history.length > 1) {
      const vals = history.map(p => p.v);
      let min = Math.min(...vals), max = Math.max(...vals);
      if (min === max) { min -= 1; max += 1; }
      return [min, max];
    }
    return null;
  }

  // Farbe je nach Schwellenwerten (z.B. ab 10 gruen, ab 28 gelb): es gilt die hoechste
  // Schwelle, deren Wert <= aktuellem Messwert ist; darunter greift die Basisfarbe.
  function thresholdColor(value, thresholds, baseColor) {
    const fallback = baseColor || 'var(--on-card-strong)';
    if (value === null || value === undefined || isNaN(value) || !thresholds || !thresholds.length) return fallback;
    const sorted = [...thresholds].filter(t => t && t.value !== '' && t.value !== null && !isNaN(t.value))
      .sort((a, b) => Number(a.value) - Number(b.value));
    let color = fallback;
    for (const t of sorted) { if (value >= Number(t.value)) color = t.color; }
    return color;
  }

  // Gauge-Bogen 1:1 nach der vom Nutzer bereitgestellten Vorlage: derselbe Pfad/dieselbe
  // Kruemmung wie im Original-Template, mit pathLength=100-Trick fuer den Fuellstand in %.
  // Text liegt als HTML-Overlay ueber dem Bogen (nicht im SVG) -- dadurch greift dieselbe
  // fluide Container-Query-Typografie wie bei allen anderen Karten.
  const GAUGE_ARC_PATH = 'M 49.7 220.9 A 124 124 0 1 1 250.3 220.9';

  function gaugeSvg2(pct, valueText, unit, title, color) {
    const known = pct !== null && pct !== undefined && !isNaN(pct);
    const clamped = known ? Math.max(0, Math.min(100, pct)) : 0;
    return `
      <svg viewBox="0 0 288 243" class="gauge-svg" preserveAspectRatio="xMidYMid meet">
        <path pathLength="100" d="${GAUGE_ARC_PATH}" fill="none" stroke="var(--on-card-track)" stroke-width="13" stroke-linecap="round"/>
        <path pathLength="100" d="${GAUGE_ARC_PATH}" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round"
          stroke-dasharray="${clamped} 100" opacity="${known ? 1 : 0.35}"/>
      </svg>
      <div class="gauge-content">
        ${title ? `<div class="gauge-title">${String(title).toUpperCase()}</div>` : ''}
        <div class="gauge-value">${valueText}${unit ? `<span class="gauge-unit">${unit}</span>` : ''}</div>
      </div>`;
  }

  // Glaettet rohe, verrauschte Sensordaten in eine ueberschaubare Anzahl Buckets
  // (Mittelwert je Zeitfenster) -- rohe Rohwerte mit einzelnen Extremspitzen sehen
  // sonst wie chaotisches Gezacke aus statt einen Trend erkennen zu lassen.
  function downsample(series, buckets) {
    if (series.length <= buckets) return series.map(p => p.v);
    const out = [];
    const bucketSize = series.length / buckets;
    for (let i = 0; i < buckets; i++) {
      const start = Math.floor(i * bucketSize);
      const end = Math.max(Math.floor((i + 1) * bucketSize), start + 1);
      const slice = series.slice(start, end);
      out.push(slice.reduce((s, p) => s + p.v, 0) / slice.length);
    }
    return out;
  }

  // Weiche Kurve statt scharfer Geradenzuege zwischen den Punkten
  function smoothPath(points) {
    if (points.length < 3) return `M ${points.map(p => p.join(',')).join(' L ')}`;
    let d = `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
    for (let i = 1; i < points.length - 1; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      d += ` Q ${x0.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last[0].toFixed(1)},${last[1].toFixed(1)}`;
    return d;
  }

  function sparklineSvg(series, gradId, grenzen) {
    if (!series || series.length < 2) {
      return { svg: '<div class="graph-empty">Keine Verlaufsdaten</div>', caption: '' };
    }
    const smoothed = downsample(series, 36);
    // Die Beschriftung stammte frueher aus den ROHdaten, die Kurve aus den geglaetteten --
    // die angezeigten Extremwerte passten also nicht zu dem, was man sah. Jetzt beides gleich.
    const g = grenzen || {};
    const festUnten = typeof g.min === 'number' && !isNaN(g.min);
    const festOben = typeof g.max === 'number' && !isNaN(g.max);
    const min = festUnten ? g.min : Math.min(...smoothed);
    const max = festOben ? g.max : Math.max(...smoothed);
    const range = (max - min) || 1;
    const w = 100, h = 36;
    const points = smoothed.map((v, i) => {
      const x = (i / (smoothed.length - 1)) * w;
      const y = h - ((v - min) / range) * h * 0.85 - h * 0.05; // etwas Luft oben/unten
      return [x, y];
    });
    const linePath = smoothPath(points);
    const areaPath = `${linePath} L ${w},${h} L 0,${h} Z`;
    const id = `sg${gradId || 0}`;
    const svg = `<svg viewBox="0 0 ${w} ${h}" class="sparkline" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--on-card-med)"/>
          <stop offset="100%" stop-color="transparent"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${id})" stroke="none"/>
      <path d="${linePath}" fill="none" stroke="var(--on-card-strong)" stroke-width="2.2" vector-effect="non-scaling-stroke"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    const values = series.map(p => p.v);
    const rawMin = Math.min(...values), rawMax = Math.max(...values);
    const fmtN = n => Number.isInteger(n) ? n : Math.round(n * 10) / 10;
    return { svg, caption: `${fmtN(rawMin)} – ${fmtN(rawMax)}` };
  }

  // opts: { editable, callbacks: {...}, history, settings, apiBase }
  // span: entweder {cols, rows} ODER ein Preset-String (sm/md/lg/xl, Altbestand)
  function buildCard(entity_id, state, cardType, span, opts) {
    opts = opts || {};
    const editable = !!opts.editable;
    const cb = opts.callbacks || {};
    const settings = opts.settings || {};
    const attrs = (state && state.attributes) || {};
    const domain = domainOf(entity_id);
    // An der Quelle maskiert: "name" landet in saemtlichen Kartenvorlagen in innerHTML.
    // Reihenfolge: eigener Name > kurzer Name aus der Entitaetsregistrierung > friendly_name >
    // Kennung. Der kurze Name ist der, den Home Assistant in seiner Oberflaeche zeigt
    // ("Solar Radiation"); friendly_name traegt bei den meisten Integrationen den Geraetenamen
    // davor ("Ecowitt Sensor 11DC2 Solar Radiation") und passt auf keine Karte.
    const name = esc((settings.name && String(settings.name).trim())
      || (opts.namen && opts.namen[entity_id])
      || attrs.friendly_name || entity_id);
    const dis = editable ? 'disabled' : '';

    // Verlauf und Tendenz stehen allen Zahlenkarten zur Verfuegung. Ohne Verlaufsdaten bleiben
    // beide leer -- die Karte sieht dann aus wie vorher, statt eine leere Flaeche zu zeigen.
    const verlaufReihe = (settings.verlaufAus || !Array.isArray(opts.history) || opts.history.length < 3)
      ? null : downsample(opts.history, 40);
    const verlaufTeil = verlaufReihe ? miniVerlaufSvg(verlaufReihe, entity_id.replace(/[^a-z0-9]/gi, '')) : '';
    const tend = verlaufReihe ? tendenz(verlaufReihe) : null;
    const tendenzTeil = (tend && tend.richtung !== 0)
      ? `<span class="tendenz ${tend.richtung > 0 ? 'steigt' : 'faellt'}">${tend.richtung > 0 ? '↑' : '↓'}</span>`
      : '';
    const type = cardType || defaultCardType(entity_id, state);
    const spanObj = (span && typeof span === 'object') ? span : sizeToSpan(span || defaultSize(type));
    const { cols, rows } = clampSpan(spanObj, type);
    const hasFixedPos = spanObj && Number.isInteger(spanObj.x) && Number.isInteger(spanObj.y);

    const card = document.createElement('div');
    card.dataset.entityId = entity_id;
    card.className = `card type-${type}`;
    // Eine von aussen zugewiesene Farbe schlaegt den Typ-Akzent. Gebraucht wird das fuer die
    // Sensorkarte, die sonst immer gleich aussieht (siehe sensorAkzente).
    if (opts.akzent) card.style.setProperty('--kachel-akzent', opts.akzent);
    if (opts.onPhoto) card.classList.add('card-on-photo');
    if (hasFixedPos) {
      card.style.gridColumn = `${spanObj.x + 1} / span ${cols}`;
      card.style.gridRow = `${spanObj.y + 1} / span ${rows}`;
      card.dataset.x = spanObj.x;
      card.dataset.y = spanObj.y;
    } else {
      card.style.gridColumn = `span ${cols}`;
      card.style.gridRow = `span ${rows}`;
    }
    card.dataset.cols = cols;
    card.dataset.rows = rows;

    // Der Ort gilt fuer die ganze Karte. Das Symbol oben links wird zum Haus bzw. zur Tanne,
    // der Chip oben rechts nennt ihn, und die Silhouette kommt am Ende hinzu (siehe
    // ortAnbringen) -- erst dann steht innerHTML, und sie darf von keinem Zweig ueberschrieben
    // werden.
    const ort = ORT_TYPEN.includes(type)
      ? ortErmitteln(settings, (settings.name && String(settings.name).trim()) || (opts.namen && opts.namen[entity_id]) || attrs.friendly_name, entity_id)
      : '';
    const ortSymbol = (standard) => (ort && !(settings && settings.icon)) ? ORTE[ort].symbol : symbolFuer(settings, standard);
    const ortChip = ort ? `<span class="ort-chip">${ORTE[ort].text}</span>` : '';

    if (type === 'climate') {
      const cur = attrs.current_temperature;
      const target = attrs.temperature;
      // Schrittweite, Grenzen und Einheit kommen jetzt vom GERAET, nicht aus dem Code. Vorher
      // stand hier fest 0,5 und fest "°C" -- bei Fahrenheit-Anlagen war die Einheit schlicht
      // falsch, und man konnte ueber die Grenzen hinausklicken, die HA dann ablehnte.
      const schritt = Number(attrs.target_temp_step) || 0.5;
      const unten = attrs.min_temp !== undefined ? Number(attrs.min_temp) : -Infinity;
      const oben = attrs.max_temp !== undefined ? Number(attrs.max_temp) : Infinity;
      const einheit = settings.suffix || opts.tempUnit || '°C';
      const modi = Array.isArray(attrs.hvac_modes) ? attrs.hvac_modes : [];
      const presets = Array.isArray(attrs.preset_modes) ? attrs.preset_modes : [];
      const modus = state ? state.state : '';
      const zeigeModi = settings.climateModes !== false && modi.length > 1;
      const zeigePresets = !!settings.climatePresets && presets.length > 0;
      const nachkomma = schritt < 1 ? 1 : 0;
      const begrenzt = (v) => Math.min(oben, Math.max(unten, v));

      // hvac_action sagt, was die Anlage GERADE tut (heating/cooling/idle/off). Ohne das
      // Attribut wird angenommen, dass sie laeuft -- lieber Bewegung zu viel als eine
      // stillstehende Flamme bei einer heizenden Anlage.
      const taetigkeit = attrs.hvac_action;
      const laeuft = taetigkeit === undefined ? true : !['idle', 'off'].includes(taetigkeit);
      const sym = hvacSymbol(modus, laeuft);

      card.classList.add('klima-' + (modus || 'unbekannt').replace(/[^a-z_]/g, ''));
      card.innerHTML = `
        <div class="row"><span class="icon hvac-symbol ${sym.klasse}" style="${hvacPhasenStil()}">${ICONS[sym.name]}</span><span class="badge">${esc(HVAC_LABEL[modus] || modus || '–')}</span></div>
        <div class="value">${modus === 'off'
          ? 'Aus'
          : (target !== undefined ? target + einheit : (cur !== undefined ? cur + einheit : esc(modus)))}</div>
        <div class="name">${name}</div>
        ${cur !== undefined && target !== undefined ? `<div class="caption">gemessen ${cur}${einheit}</div>` : ''}
        <div class="controls">
          <button data-act="temp-down" ${dis}>−</button>
          <button data-act="temp-up" ${dis}>+</button>
        </div>
        ${zeigeModi ? `<div class="climate-modes">${hvacReihenfolge(modi).map(m =>
          `<button class="climate-mode${m === modus ? ' aktiv' : ''}" data-modus="${esc(m)}" ${dis}>${esc(HVAC_LABEL[m] || m)}</button>`).join('')}</div>` : ''}
        ${zeigePresets ? `<div class="climate-presets"><select data-act="preset" ${dis}>${presets.map(pm =>
          `<option value="${esc(pm)}" ${pm === attrs.preset_mode ? 'selected' : ''}>${esc(pm)}</option>`).join('')}</select></div>` : ''}`;

      if (!editable && cb.onSetTemp) {
        const basis = target !== undefined ? Number(target) : 20;
        card.querySelector('[data-act="temp-up"]').addEventListener('click',
          () => cb.onSetTemp(entity_id, +begrenzt(basis + schritt).toFixed(nachkomma)));
        card.querySelector('[data-act="temp-down"]').addEventListener('click',
          () => cb.onSetTemp(entity_id, +begrenzt(basis - schritt).toFixed(nachkomma)));
      }
      if (!editable && cb.onSetHvacMode) {
        card.querySelectorAll('.climate-mode').forEach(el => el.addEventListener('click', (e) => {
          e.stopPropagation(); cb.onSetHvacMode(entity_id, el.dataset.modus);
        }));
      }
      if (!editable && cb.onSetPreset) {
        const sel = card.querySelector('[data-act="preset"]');
        if (sel) sel.addEventListener('change', (e) => { e.stopPropagation(); cb.onSetPreset(entity_id, sel.value); });
      }
    } else if (type === 'light') {
      const isOn = state && state.state === 'on';
      const pct = Math.round((attrs.brightness || 0) / 255 * 100);
      // Kann die Lampe Farbtemperatur oder Farbe? HA meldet das in supported_color_modes.
      const modi = Array.isArray(attrs.supported_color_modes) ? attrs.supported_color_modes : [];
      const kannTemperatur = settings.lightTemp !== false && modi.includes('color_temp');
      const kannFarbe = !!settings.lightColor && modi.some(m => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m));
      const kelvinMin = Number(attrs.min_color_temp_kelvin) || 2000;
      const kelvinMax = Number(attrs.max_color_temp_kelvin) || 6500;
      const kelvin = Number(attrs.color_temp_kelvin) || Math.round((kelvinMin + kelvinMax) / 2);
      const rgb = Array.isArray(attrs.rgb_color) ? attrs.rgb_color : [255, 255, 255];
      const hexFarbe = '#' + rgb.map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');

      // Nicht jede Lampe laesst sich dimmen. HA meldet das ueber die Farbmodi: 'onoff' heisst
      // nur ein und aus. Eine solche Lampe bekommt keine Fuellung und keinen Wisch -- ein
      // Regler, der nichts bewirkt, ist schlimmer als keiner.
      const kannDimmen = modi.length === 0
        ? attrs.brightness !== undefined
        : modi.some(m => m !== 'onoff');

      card.classList.add('kachel-regler');
      card.innerHTML = `
        ${kannDimmen ? `<div class="kachel-fuellung" style="height:${isOn ? pct : 0}%"></div>` : ''}
        <div class="row"><span class="icon">${symbolFuer(settings, ICONS.light)}</span><span class="badge">${isOn ? 'An' : 'Aus'}</span></div>
        <div class="value">${kannDimmen && isOn ? pct + '%' : (isOn ? 'An' : 'Aus')}</div>
        <div class="name">${name}</div>
        ${kannTemperatur ? `<div class="controls slider-row light-temp">
          <input type="range" min="${kelvinMin}" max="${kelvinMax}" step="50" value="${kelvin}" data-act="kelvin" ${dis}>
        </div>` : ''}
        ${kannFarbe ? `<div class="controls light-color">
          <input type="color" value="${hexFarbe}" data-act="farbe" ${dis}>
        </div>` : ''}`;
      if (!editable) {
        const umschalten = () => cb.onToggle && cb.onToggle('light', entity_id, state ? state.state : 'off');
        if (kannDimmen && cb.onSetBrightness) {
          kachelRegler(card, {
            wert: isOn ? pct : 0,
            beschriftung: (v) => v + '%',
            aufTippen: umschalten,
            aufWert: (wert) => {
              // Frueher wurde bei 0 ein turn_on mit 0 Prozent geschickt -- viele Lampen
              // ignorieren das oder bleiben glimmend an. 0 heisst aus.
              if (wert === 0) return cb.onToggle && cb.onToggle('light', entity_id, 'on');
              cb.onSetBrightness(entity_id, wert);
            }
          });
        } else if (cb.onToggle) {
          card.style.cursor = 'pointer';
          card.addEventListener('click', (e) => {
            if (e.target.closest('input, button, select')) return;
            umschalten();
          });
        }
        const kelvinRegler = card.querySelector('[data-act="kelvin"]');
        if (kelvinRegler && cb.onSetColorTemp) {
          kelvinRegler.addEventListener('change', (e) => {
            e.stopPropagation(); cb.onSetColorTemp(entity_id, parseInt(kelvinRegler.value, 10));
          });
        }
        const farbwahl = card.querySelector('[data-act="farbe"]');
        if (farbwahl && cb.onSetColor) {
          farbwahl.addEventListener('change', (e) => {
            e.stopPropagation();
            const h = farbwahl.value.replace('#', '');
            cb.onSetColor(entity_id, [
              parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)
            ]);
          });
        }
      }
    } else if (type === 'fluegeltor') {
      const tor = torDarstellung(state ? state.state : '');
      // Die Bewegung haengt an der Uhr, nicht am Alter des Elements -- sonst faengt sie nach
      // jedem Neuaufbau der Karte von vorne an. Mit Messung haengt sie sogar am echten
      // Fahrtbeginn und zeigt damit die wirkliche Stellung des Fluegels.
      const dauerauf = torDauerauf(settings, opts.statesById);
      const anim = torAnimation(state ? state.state : '', opts.torZeiten,
        state ? state.last_changed : '', undefined, dauerauf);
      // Der Akzent wird DIREKT am Element gesetzt und schlaegt damit jede CSS-Regel -- eine
      // Klasse "ueberfaellig" mit roter Farbe kaeme dagegen nicht an. Deshalb faellt die
      // Entscheidung hier, an einer Stelle.
      const torAkzent = anim.ueberfaellig ? TOR_ROT : tor.akzent;
      if (torAkzent) card.style.setProperty('--kachel-akzent', torAkzent);
      card.classList.add(tor.klasse);
      if (anim.echtzeit) card.classList.add('tor-echtzeit');
      if (anim.ueberfaellig) card.classList.add('tor-ueberfaellig');
      if (dauerauf) card.classList.add('tor-dauerauf');
      card.innerHTML = `
        <div class="row"><span class="icon"></span><span class="badge">${esc(tor.text)}</span></div>
        <div class="tor-bild" style="--ph-tor:${anim.versatz}; --tor-dauer:${(anim.dauer || TOR_TAKT)}s">${ICONS.fluegeltor}</div>
        ${dauerauf ? '<div class="tor-dauerauf-hinweis">Dauer-Auf</div>' : ''}
        <div class="name">${name}${anim.ueberfaellig ? ' · dauert länger als sonst' : ''}</div>`;
    } else if (type === 'cover') {
      const pos = attrs.current_position;
      // Nur anbieten, was das Geraet wirklich kann -- ein Schieber, der ins Leere greift, ist
      // schlimmer als keiner. HA meldet die Faehigkeiten in supported_features:
      // 4 = SET_POSITION, 128 = SET_TILT_POSITION.
      const faehig = Number(attrs.supported_features) || 0;
      const zeigePosition = settings.coverPosition !== false && pos !== undefined && (faehig & 4);
      const zeigeNeigung = !!settings.coverTilt && attrs.current_tilt_position !== undefined && (faehig & 128);
      card.innerHTML = `
        <div class="row"><span class="icon">${ICONS.cover}</span><span class="badge">${state ? state.state : '–'}</span></div>
        <div class="value">${pos !== undefined ? pos + '%' : ''}</div>
        <div class="name">${name}</div>
        <div class="controls">
          <button data-act="open" ${dis} aria-label="Auf">${ICONS.arrowUp}</button>
          <button data-act="stop" ${dis} aria-label="Stopp">${ICONS.stopSquare}</button>
          <button data-act="close" ${dis} aria-label="Zu">${ICONS.arrowDown}</button>
        </div>
        ${zeigePosition ? `<div class="controls slider-row">
          <input type="range" min="0" max="100" step="1" value="${pos}" data-act="position" ${dis}>
        </div>` : ''}
        ${zeigeNeigung ? `<div class="controls slider-row cover-tilt">
          <span class="cover-tilt-label">Neigung</span>
          <input type="range" min="0" max="100" step="1" value="${attrs.current_tilt_position}" data-act="tilt" ${dis}>
        </div>` : ''}`;
      if (!editable && cb.onCover) {
        card.querySelector('[data-act="open"]').addEventListener('click', () => cb.onCover(entity_id, 'open_cover'));
        card.querySelector('[data-act="stop"]').addEventListener('click', () => cb.onCover(entity_id, 'stop_cover'));
        card.querySelector('[data-act="close"]').addEventListener('click', () => cb.onCover(entity_id, 'close_cover'));
      }
      // Anfahren einer Position war bisher nicht moeglich: Die Position wurde angezeigt, aber
      // es gab nur Auf, Stop und Zu. Auf 40 Prozent kam man nicht.
      if (!editable && cb.onCoverPosition) {
        const schieber = card.querySelector('[data-act="position"]');
        if (schieber) schieber.addEventListener('change', (e) => {
          e.stopPropagation(); cb.onCoverPosition(entity_id, parseInt(schieber.value, 10));
        });
        const neigung = card.querySelector('[data-act="tilt"]');
        if (neigung) neigung.addEventListener('change', (e) => {
          e.stopPropagation(); cb.onCoverTilt(entity_id, parseInt(neigung.value, 10));
        });
      }
    } else if (type === 'switch') {
      const isOn = state && state.state === 'on';
      const isReadOnly = domain === 'binary_sensor';
      card.classList.add(isOn ? 'on' : 'off');
      card.classList.toggle('ist-aktiv', !!isOn);
      card.innerHTML = `
        <div class="row"><span></span><span class="badge">${isOn ? 'An' : 'Aus'}</span></div>
        <span class="icon">${symbolFuer(settings, ICONS[domain] || ICONS.switch)}</span>
        <div class="name">${name}</div>`;
      if (!editable && !isReadOnly && cb.onToggle) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => cb.onToggle(domain, entity_id, state ? state.state : 'off'));
      }
    } else if (type === 'button') {
      card.innerHTML = `
        <div class="row"><span></span><span class="badge">Drücken</span></div>
        <span class="icon">${symbolFuer(settings, ICONS.button)}</span>
        <div class="name">${name}</div>`;
      if (!editable && cb.onPress) {
        card.style.cursor = 'pointer';
        const chip = card.querySelector('.badge');
        card.addEventListener('click', () => {
          card.classList.add('pressed');
          setTimeout(() => card.classList.remove('pressed'), 300);
          rueckmeldung(chip, cb.onPress(domain, entity_id));
        });
      }
    } else if (type === 'temperature') {
      const unit = (settings.suffix !== undefined && settings.suffix !== '') ? settings.suffix : (attrs.unit_of_measurement || '°C');
      const rawVal = state ? state.state : null;
      const numVal = rawVal !== null ? parseFloat(rawVal) : NaN;
      card.style.setProperty('--kachel-akzent', tempAkzent(isNaN(numVal) ? null : numVal, attrs.unit_of_measurement));
      card.innerHTML = `
        ${verlaufTeil}
        <div class="row"><span class="icon">${ortSymbol(ICONS.temperature)}</span><span class="row-rechts">${tendenzTeil}${ortChip}</span></div>
        <div class="value">${fmt(zahlFormatieren(isNaN(numVal) ? (rawVal ?? '–') : numVal, settings.decimals), unit)}</div>
        <div class="name">${name}</div>`;
    } else if (type === 'wind') {
      const unit = (settings.suffix !== undefined && settings.suffix !== '') ? settings.suffix : (attrs.unit_of_measurement || 'km/h');
      const val = state ? state.state : '–';
      card.innerHTML = `
        ${verlaufTeil}
        <div class="row"><span class="icon">${symbolFuer(settings, ICONS.wind)}</span>${tendenzTeil}</div>
        <div class="value">${fmt(zahlFormatieren(val, settings.decimals), unit)}</div>
        <div class="name">${name}</div>`;
    } else if (type === 'rain') {
      const unit = (settings.suffix !== undefined && settings.suffix !== '') ? settings.suffix : (attrs.unit_of_measurement || 'mm');
      const val = state ? state.state : '–';
      card.innerHTML = `
        ${verlaufTeil}
        <div class="row"><span class="icon">${symbolFuer(settings, ICONS.rain)}</span>${tendenzTeil}</div>
        <div class="value">${fmt(zahlFormatieren(val, settings.decimals), unit)}</div>
        <div class="name">${name}</div>`;
    } else if (type === 'solar') {
      const unit = (settings.suffix !== undefined && settings.suffix !== '') ? settings.suffix : (attrs.unit_of_measurement || 'W/m²');
      const val = state ? state.state : '–';
      card.innerHTML = `
        ${verlaufTeil}
        <div class="row"><span class="icon">${symbolFuer(settings, ICONS.solar)}</span>${tendenzTeil}</div>
        <div class="value">${fmt(zahlFormatieren(val, settings.decimals), unit)}</div>
        <div class="name">${name}</div>`;
    } else if (type === 'pressure') {
      const unit = (settings.suffix !== undefined && settings.suffix !== '') ? settings.suffix : (attrs.unit_of_measurement || 'hPa');
      const val = state ? state.state : '–';
      card.innerHTML = `
        ${verlaufTeil}
        <div class="row"><span class="icon">${ortSymbol(ICONS.pressure)}</span><span class="row-rechts">${tendenzTeil}${ortChip}</span></div>
        <div class="value">${fmt(zahlFormatieren(val, settings.decimals), unit)}</div>
        <div class="name">${name}</div>`;
    } else if (type === 'radar') {
      const base = opts.apiBase || '';
      // Fest fuenf Minuten passte zu Regenradar-Bildern, die genau so oft erneuert werden.
      // Eine Kamera am Tor will man haeufiger sehen, ein Satellitenbild seltener.
      const radarSek = Math.max(5, Math.min(3600, Number(settings.radarSeconds) || 300));
      const bust = Math.floor(Date.now() / (radarSek * 1000));
      card.innerHTML = `
        <div class="row"><span class="icon">${symbolFuer(settings, ICONS.radar)}</span><span class="name">${name}</span></div>
        <div class="radar-wrap"><img src="${base}/api/ha/media?entity_id=${encodeURIComponent(entity_id)}&t=${bust}" alt="${name}"></div>`;
    } else if (type === 'gauge') {
      const unit = (settings.suffix !== undefined && settings.suffix !== '') ? settings.suffix : attrs.unit_of_measurement;
      const rawVal = state ? state.state : null;
      const numVal = rawVal !== null ? parseFloat(rawVal) : NaN;
      const range = (settings.min !== undefined && settings.min !== '' && settings.max !== undefined && settings.max !== '')
        ? [Number(settings.min), Number(settings.max)]
        : gaugeRange(attrs, opts.history);
      let pct = null;
      if (range && !isNaN(numVal)) pct = ((numVal - range[0]) / (range[1] - range[0])) * 100;
      const displayVal = rawVal === null || rawVal === undefined ? '–' : (isNaN(numVal) ? rawVal : zahlFormatieren(numVal, settings.decimals));
      const color = thresholdColor(numVal, settings.thresholds, settings.baseColor);
      card.innerHTML = gaugeSvg2(pct, displayVal, unit, name, color);
    } else if (type === 'graph') {
      const val = state ? state.state : '–';
      const unit = (settings.suffix !== undefined && settings.suffix !== '') ? settings.suffix : attrs.unit_of_measurement;
      const { svg, caption } = sparklineSvg(opts.history, entity_id.replace(/[^a-z0-9]/gi, ''),
        { min: settings.graphMin, max: settings.graphMax });
      // Ohne Zeitangabe wusste niemand, welchen Ausschnitt die Kurve zeigt.
      const stundenGraph = Number(settings.graphHours) > 0 ? Number(settings.graphHours) : 24;
      const zeitraumText = stundenGraph >= 24 && stundenGraph % 24 === 0
        ? (stundenGraph / 24) + (stundenGraph === 24 ? ' Tag' : ' Tage')
        : stundenGraph + ' h';
      card.innerHTML = `
        <div class="row"><span class="icon">${symbolFuer(settings, ICONS.graph)}</span><span class="badge">${fmt(zahlFormatieren(val, settings.decimals), unit)}</span></div>
        <div class="name">${name}</div>
        <div class="graph-wrap">${svg}</div>
        <div class="graph-caption">${caption ? esc(caption) + (unit ? ' ' + esc(unit) : '') + ' · ' : ''}${zeitraumText}</div>`;
    } else if (type === 'clock') {
      card.dataset.uhr = JSON.stringify({
        locale: settings.clockLocale || 'de-DE',
        sekunden: !!settings.clockSeconds,
        ohneDatum: !!settings.clockNoDate,
        stunden12: settings.clockHour12 === undefined || settings.clockHour12 === '' ? undefined : settings.clockHour12 === true || settings.clockHour12 === 'true'
      });
      card.innerHTML = `<div class="clock-time">--:--</div><div class="clock-date">-</div>`;
      renderClockNow(card);
    } else if (type === 'energy') {
      const en = opts.energy || {};
      const zahl = s => { const v = s && parseFloat(s.state); return (v === undefined || isNaN(v)) ? null : v; };
      const einheit = s => (s && s.attributes && s.attributes.unit_of_measurement) || '';
      const klasse = s => (s && s.attributes && s.attributes.device_class) || '';
      const nachW = (v, e) => (v === null ? null : (e === 'kW' ? v * 1000 : v));

      // --- Die Pruefung, die vorher fehlte ------------------------------------------------------
      //
      // Diese Karte zeigt LEISTUNG (W), nicht ENERGIE (kWh). Der Vorschlag-Knopf im Editor las
      // die Energie-Einstellungen von Home Assistant aus, und die nennen kWh-Zaehler
      // (`stat_energy_from`). Ein Zaehlerstand von 1234 kWh wurde dann als "1,23 kW" angezeigt:
      // eine Zahl, die aussieht wie eine Leistung, sich langsam bewegt und nichts bedeutet.
      // Falsch, aber nicht als falsch erkennbar -- die teuerste Sorte Fehler.
      //
      // Jetzt sagt die Karte es. Lieber ein Satz, der erklaert, als eine Zahl, die luegt.
      const falsch = [];
      for (const [feld, zustand] of [['Netzbezug', en.grid], ['Einspeisung', en.gridReturn],
        ['Solar', en.solar], ['Batterie', en.battery]]) {
        if (!zustand) continue;
        const e = einheit(zustand);
        if (e === 'W' || e === 'kW' || klasse(zustand) === 'power') continue;
        // Kennung, sonst Anzeigename, sonst nur das Feld: Eine Meldung, in der "undefined"
        // steht, ist keine Meldung.
        const wer = zustand.entity_id
          || (zustand.attributes && zustand.attributes.friendly_name) || '(unbekannt)';
        falsch.push(feld + ': ' + wer + (e ? ' misst ' + e : ' ohne Einheit'));
      }
      if (falsch.length) {
        card.innerHTML = `
          <div class="ed-fehler">
            <div class="ed-fehler-titel">Diese Karte braucht Leistung, nicht Energie</div>
            <div class="ed-fehler-text">Erwartet werden Sensoren in <b>W</b> oder <b>kW</b>
              (z.&nbsp;B. „Netzbezug", „Wechselrichter"), nicht die kWh-Zähler aus den
              Energie-Einstellungen.</div>
            <ul class="ed-fehler-liste">${falsch.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
          </div>`;
        return card;
      }

      const netzBezugW = nachW(zahl(en.grid), einheit(en.grid));
      const netzEinspeisungW = nachW(zahl(en.gridReturn), einheit(en.gridReturn));
      const solarW = nachW(zahl(en.solar), einheit(en.solar));
      const battRoh = nachW(zahl(en.battery), einheit(en.battery));
      const battSoc = en.batterySoc ? parseFloat(en.batterySoc.state) : null;
      // Welches Vorzeichen "laedt" bedeutet, ist keine Norm, sondern eine Entscheidung der
      // jeweiligen Anlage. Passt sie nicht, floss die Energie auf dem Display in die falsche
      // Richtung -- sichtbar, aber nicht als Fehler erkennbar.
      const battInvers = !!settings.energyBatteryInvert;
      const battLaedt = battRoh !== null && (battInvers ? battRoh > 0 : battRoh < 0);
      const battW = battRoh !== null ? Math.abs(battRoh) : null;

      // Das Haus wird gerechnet, nicht gemessen: Was hereinkommt, geht hinaus. Ein eigener
      // Hausverbrauchs-Sensor waere eine zweite Wahrheit daneben, und die beiden waeren sich
      // nie einig.
      const hausW = (solarW || 0) + (netzBezugW || 0) - (netzEinspeisungW || 0)
        + (battLaedt ? -(battW || 0) : (battW || 0));

      // Ab wann eine Leitung als "fliesst" gilt. 5 W passten zu einem Zaehler mit ruhigem
      // Nullpunkt; ein Wechselrichter, der nachts 30 W Eigenverbrauch meldet, liesse die
      // Leitung sonst die ganze Nacht leuchten.
      const schwelleW = (settings.energyThreshold !== undefined && settings.energyThreshold !== ''
        && Number.isFinite(Number(settings.energyThreshold)))
        ? Math.abs(Number(settings.energyThreshold)) : 5;

      card.innerHTML = edDiagramm({
        solarW: en.solar !== undefined ? solarW : null,
        netzBezugW, netzEinspeisungW,
        batterieW: en.battery !== undefined ? battW : null,
        batterieLaedt: battLaedt, batterieSoc: battSoc,
        hausW, schwelleW,
        namen: {
          solar: settings.energyLabelSolar || 'Solar',
          netz: settings.energyLabelGrid || 'Netz',
          haus: settings.energyLabelHome || settings.name || 'Haus',
          batterie: settings.energyLabelBattery || 'Batterie'
        },
        symbole: { solar: ICONS.sun2, netz: ICONS.grid, haus: ICONS.home2, batterie: ICONS.battery2 }
      });
    } else if (type === 'media_player') {
      const st = state ? state.state : 'off';
      const isPlaying = st === 'playing';
      const isOff = st === 'off' || st === 'unavailable';
      const title = attrs.media_title || '';
      const artist = attrs.media_artist || '';
      const picture = attrs.entity_picture;
      const base = opts.apiBase || '';
      const pictureUrl = picture ? `${base}/api/ha/picture?path=${encodeURIComponent(picture)}` : '';
      const volume = attrs.volume_level !== undefined ? Math.round(attrs.volume_level * 100) : null;
      const isMuted = !!attrs.is_volume_muted;
      const hasShuffle = attrs.shuffle !== undefined;
      const hasRepeat = attrs.repeat !== undefined;
      const showArtBg = settings.mediaArtBg !== false; // Standard an -- per Karten-Einstellung abschaltbar
      const sourceList = Array.isArray(attrs.source_list) ? attrs.source_list : [];
      const showSource = settings.mediaShowSource !== false && sourceList.length > 1;
      const duration = attrs.media_duration; // Sekunden, nur vorhanden wenn die Quelle das liefert
      // media_position ist der Stand ZUM ZEITPUNKT media_position_updated_at, nicht jetzt.
      // Ohne diese Korrektur zeigte der Balken bis zu 15 Sekunden Rueckstand -- so lange
      // dauert es bis zum naechsten Aufbau -- und sprang dann.
      const positionRoh = attrs.media_position;
      const seitStand = (() => {
        if (st !== 'playing' || !attrs.media_position_updated_at) return 0;
        const t = new Date(attrs.media_position_updated_at).getTime();
        if (!Number.isFinite(t)) return 0;
        const d = (Date.now() - t) / 1000;
        return d > 0 && d < 86400 ? d : 0;   // Unsinnige Zeitstempel lieber ignorieren
      })();
      const position = typeof positionRoh === 'number'
        ? Math.min(typeof duration === 'number' ? duration : positionRoh + seitStand, positionRoh + seitStand)
        : positionRoh;
      const showProgress = settings.mediaShowProgress !== false && typeof duration === 'number' && duration > 0 && typeof position === 'number';
      const fmtTime = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); const sec = s % 60; return `${m}:${String(sec).padStart(2, '0')}`; };
      const progressPct = showProgress ? Math.min(100, Math.round((position / duration) * 100)) : 0;
      card.classList.add('has-art-bg');
      card.innerHTML = `
        ${pictureUrl && showArtBg ? `<div class="mp-bg" style="background-image:url('${pictureUrl}')"></div><div class="mp-scrim"></div>` : ''}
        <button class="mp-power ${!isOff ? 'active' : ''}" data-act="power" ${dis}>${ICONS.power}</button>
        <div class="mp-wrap2">
          <div class="mp-art2">${pictureUrl ? `<img src="${pictureUrl}" alt="">` : ICONS.mediaPlayer}</div>
          <div class="mp-title2">${title || name}</div>
          <div class="mp-artist2">${artist || (isOff ? 'Aus' : st === 'idle' ? 'Bereit' : st)}</div>
          ${showProgress ? `
          <div class="mp-progress2">
            <span class="mp-time">${fmtTime(position)}</span>
            <div class="mp-progress-track"><div class="mp-progress-fill" style="width:${progressPct}%"></div></div>
            <span class="mp-time">${fmtTime(duration)}</span>
          </div>` : ''}
          <div class="mp-controls2">
            ${hasShuffle ? `<button class="mp-btn-sm ${attrs.shuffle ? 'active' : ''}" data-act="shuffle" ${dis}>${ICONS.shuffle}</button>` : '<span class="mp-btn-spacer"></span>'}
            <button class="mp-btn-md" data-act="prev" ${dis}>${ICONS.skipPrev}</button>
            <button class="mp-btn-lg" data-act="playpause" ${dis}>${isPlaying ? ICONS.pause : ICONS.play}</button>
            <button class="mp-btn-md" data-act="next" ${dis}>${ICONS.skipNext}</button>
            ${hasRepeat ? `<button class="mp-btn-sm ${attrs.repeat !== 'off' ? 'active' : ''}" data-act="repeat" ${dis}>${attrs.repeat === 'one' ? ICONS.repeatOne : ICONS.repeat}</button>` : '<span class="mp-btn-spacer"></span>'}
          </div>
          ${volume !== null ? `
          <div class="mp-volume2">
            <span class="mp-vol-icon" data-act="mute" ${dis}>${isMuted ? ICONS.volumeMute : ICONS.volume}</span>
            <input type="range" min="0" max="100" value="${volume}" data-act="volume" ${dis}>
          </div>` : ''}
          ${showSource ? `
          <select class="mp-source" data-act="source" ${dis}>
            ${sourceList.map(s => `<option value="${s}" ${s === attrs.source ? 'selected' : ''}>${s}</option>`).join('')}
          </select>` : ''}
        </div>`;
      if (!editable && cb.onMediaControl) {
        const act = (name, handler) => { const el = card.querySelector(`[data-act="${name}"]`); if (el) el.addEventListener('click', e => { e.stopPropagation(); handler(); }); };
        act('prev', () => cb.onMediaControl(entity_id, 'media_previous_track'));
        act('next', () => cb.onMediaControl(entity_id, 'media_next_track'));
        act('playpause', () => cb.onMediaControl(entity_id, isPlaying ? 'media_pause' : 'media_play'));
        act('shuffle', () => cb.onMediaControl(entity_id, 'shuffle_set', { shuffle: !attrs.shuffle }));
        act('power', () => cb.onMediaControl(entity_id, isOff ? 'turn_on' : 'turn_off'));
        act('repeat', () => {
          const next = attrs.repeat === 'off' ? 'all' : attrs.repeat === 'all' ? 'one' : 'off';
          cb.onMediaControl(entity_id, 'repeat_set', { repeat: next });
        });
        act('mute', () => cb.onMediaControl(entity_id, 'volume_mute', { is_volume_muted: !isMuted }));
        const volSlider = card.querySelector('[data-act="volume"]');
        if (volSlider) {
          volSlider.addEventListener('click', e => e.stopPropagation());
          volSlider.addEventListener('change', () => cb.onMediaControl(entity_id, 'volume_set', { volume_level: parseInt(volSlider.value, 10) / 100 }));
        }
        const sourceSelect = card.querySelector('[data-act="source"]');
        if (sourceSelect) {
          sourceSelect.addEventListener('click', e => e.stopPropagation());
          sourceSelect.addEventListener('change', () => cb.onMediaControl(entity_id, 'select_source', { source: sourceSelect.value }));
        }
      }
    } else if (type === 'gate') {
      // Oben ein einblendbarer Meldeblock, darunter die frei zusammengestellte Knopfliste.
      // Der Block schiebt die Knoepfe nach unten, wenn er erscheint -- so gewuenscht; die
      // Hoehe zieht dafuer weich auf, damit es nicht ruckartig unter dem Finger verrutscht.
      const meldungAn = !!(state && (state.state === 'on' || state.state === 'open' || state.state === 'unlocked'));
      const meldetext = settings.gateMessage || 'Tor dauerhaft offen';
      const knoepfe = Array.isArray(settings.gateButtons) ? settings.gateButtons : [];
      card.innerHTML = `
        <div class="gate-message${meldungAn ? ' gate-message-an' : ''}">
          <span class="gate-message-inner">${esc(meldetext)}</span>
        </div>
        ${settings.name ? `<div class="gate-title">${name}</div>` : ''}
        <div class="gate-buttons">
          ${knoepfe.length
            ? knoepfe.map((b, i) => {
                // Das Symbol ist die eigentliche Unterscheidung. Aus fuenf Metern liest man
                // "Tor" und "Garage" nicht auseinander, ein Tor und eine Garage schon.
                // Gewaehltes Symbol, sonst eins geraten -- ein Knopf ohne Symbol waere das,
                // was der Nutzer gerade bemaengelt hat.
                const symbolName = (b.icon && ICONS[b.icon]) ? b.icon
                  : (b.icon === '' ? '' : symbolErraten(b.label, b.entity));
                const symbol = symbolName ? ICONS[symbolName] : '';
                return `<button class="gate-btn${symbol ? ' hat-symbol' : ''}" data-gate="${i}" ${dis}>`
                  + (symbol ? `<span class="gate-btn-symbol">${symbol}</span>` : '')
                  + `<span class="gate-btn-text">${esc(b.label || b.entity || '?')}</span></button>`;
              }).join('')
            : '<div class="graph-empty">Noch keine Knöpfe – in den Karten-Einstellungen hinzufügen</div>'}
        </div>`;
      if (!editable && cb.onGatePress) {
        knoepfe.forEach((b, i) => {
          const el = card.querySelector(`[data-gate="${i}"]`);
          if (el && b.entity) el.addEventListener('click', (e) => {
            e.stopPropagation();
            rueckmeldung(el, cb.onGatePress(b.entity, b.alsSchalter === true));
          });
        });
      }
    } else if (type === 'lock') {
      const s = state ? state.state : '';
      const isLocked = s === 'locked';
      const busy = s === 'locking' || s === 'unlocking';
      const label = { locked: 'Verriegelt', unlocked: 'Entriegelt', locking: 'Verriegelt…', unlocking: 'Entriegelt…', jammed: 'Blockiert' }[s] || (s || '–');
      const lockHtml = `<span class="icon">${isLocked ? ICONS.lockClosed : ICONS.lockOpen}</span><span class="name">${name}</span><span class="badge">${label}</span>`;
      card.innerHTML = lockHtml;
      if (!editable && !busy && cb.onLockToggle) {
        card.style.cursor = 'pointer';
        // Entriegeln braucht eine Rueckfrage: Ein Fehlgriff auf einem Wandpanel, das Gaesten
        // zugaenglich ist, schliesst sonst die Tuer auf. Verriegeln bleibt ein einzelner Tipp --
        // dabei kann nichts passieren, was man bereuen wuerde.
        let wartetAufBestaetigung = false;
        let rueckfallTimer = null;
        const zurueck = () => {
          wartetAufBestaetigung = false;
          clearTimeout(rueckfallTimer);
          card.innerHTML = lockHtml;
          card.classList.remove('lock-confirm');
        };
        card.addEventListener('click', () => {
          if (!isLocked) return cb.onLockToggle(entity_id, s);   // verriegeln: sofort
          if (wartetAufBestaetigung) { zurueck(); return cb.onLockToggle(entity_id, s); }
          wartetAufBestaetigung = true;
          card.classList.add('lock-confirm');
          card.innerHTML = `<span class="icon">${ICONS.lockOpen}</span><span class="name">${name}</span>`
            + `<span class="badge">Wirklich entriegeln? Erneut tippen</span>`;
          rueckfallTimer = setTimeout(zurueck, 6000);
        });
      }
    } else if (type === 'fan') {
      const isOn = state && state.state === 'on';
      card.classList.toggle('ist-aktiv', !!isOn);
      const pct = attrs.percentage !== undefined && attrs.percentage !== null ? attrs.percentage : (isOn ? 100 : 0);
      // Ein Ventilator mit Stufen wird genauso bedient wie eine Lampe: die ganze Kachel ist
      // der Regler. Einer ohne Stufen (percentage fehlt) kann nur ein und aus.
      const kannStufen = attrs.percentage !== undefined && attrs.percentage !== null;
      card.classList.add('kachel-regler');
      card.innerHTML = `
        ${kannStufen ? `<div class="kachel-fuellung" style="height:${isOn ? pct : 0}%"></div>` : ''}
        <div class="row"><span class="icon">${symbolFuer(settings, ICONS.fan)}</span><span class="badge">${isOn ? 'An' : 'Aus'}</span></div>
        <div class="value">${isOn ? (kannStufen ? pct + '%' : 'An') : 'Aus'}</div>
        <div class="name">${name}</div>`;
      if (!editable) {
        const umschalten = () => cb.onToggle && cb.onToggle('fan', entity_id, state ? state.state : 'off');
        if (kannStufen && cb.onFanSpeed) {
          kachelRegler(card, {
            wert: isOn ? pct : 0,
            beschriftung: (v) => v + '%',
            aufTippen: umschalten,
            aufWert: (wert) => (wert === 0 ? umschalten() : cb.onFanSpeed(entity_id, wert))
          });
        } else if (cb.onToggle) {
          card.style.cursor = 'pointer';
          card.addEventListener('click', umschalten);
        }
      }
    } else if (type === 'vacuum') {
      const s = state ? state.state : 'docked';
      const isCleaning = s === 'cleaning';
      const label = { docked: 'Docke', cleaning: 'Reinigt', paused: 'Pausiert', returning: 'Fährt zur Basis', idle: 'Bereit', error: 'Fehler' }[s] || s;
      const battery = attrs.battery_level !== undefined ? attrs.battery_level + '%' : '';
      card.innerHTML = `
        <div class="row"><span class="icon">${symbolFuer(settings, ICONS.vacuum)}</span></div>
        <div class="name">${name}</div>
        <div class="value" style="font-size:clamp(1vh,7cqmin,1.8vh);">${label}${battery ? ' · ' + battery : ''}</div>
        <div class="controls" style="display:flex; gap:0.6vh; margin-top:0.4vh;">
          <button data-act="startpause" ${dis}>${isCleaning ? ICONS.pause : ICONS.play}</button>
          <button data-act="dock" ${dis}>${ICONS.dockIcon}</button>
        </div>`;
      if (!editable && cb.onVacuumControl) {
        const spBtn = card.querySelector('[data-act="startpause"]');
        const dockBtn = card.querySelector('[data-act="dock"]');
        if (spBtn) spBtn.addEventListener('click', e => { e.stopPropagation(); cb.onVacuumControl(entity_id, isCleaning ? 'pause' : 'start'); });
        if (dockBtn) dockBtn.addEventListener('click', e => { e.stopPropagation(); cb.onVacuumControl(entity_id, 'return_to_base'); });
      }
    } else if (type === 'humidity') {
      const unit = (settings.suffix !== undefined && settings.suffix !== '') ? settings.suffix : '%';
      const val = state ? state.state : '–';
      card.innerHTML = `
        ${verlaufTeil}
        <div class="row"><span class="icon">${ortSymbol(ICONS.humidity)}</span><span class="row-rechts">${tendenzTeil}${ortChip}</span></div>
        <div class="value">${fmt(zahlFormatieren(val, settings.decimals), unit)}</div>
        <div class="name">${name}</div>`;
    } else if (type === 'waste') {
      // Dieselbe Anatomie wie jede andere Karte: Symbolzeile, Wert, Name als Bildunterschrift.
      // Vorher war der KARTENNAME die groesste Schrift und die naechste Abfuhr klein darunter --
      // aus zwei Metern las man "Muelltermine" und sonst nichts. Die Frage lautet aber "welche
      // Tonne, und wann", und genau das steht jetzt gross.
      const anzahlTage = Math.max(1, Math.min(12, Number(settings.wasteCount) || 4));
      const eigeneFarben = Array.isArray(settings.wasteColors) ? settings.wasteColors : [];
      const tage = wasteTage(opts.waste, anzahlTage);
      const naechster = tage[0];

      // Die Farbe der naechsten Tonne wird der Kartenakzent -- Symbol, Schein und Anflug
      // nehmen sie auf. Eine Tonne erkennt man an ihrer Farbe, lange bevor man den Namen
      // liest; ein Punkt von zwoelf Pixeln leistet das nicht.
      if (naechster) card.style.setProperty('--kachel-akzent', wasteColor(naechster.arten[0], eigeneFarben));

      const punkte = (arten) => arten.map(a =>
        `<span class="waste-dot" style="background:${wasteColor(a, eigeneFarben)}"></span>`).join('');

      card.innerHTML = `
        <div class="row">
          <span class="icon">${symbolFuer(settings, ICONS.trash)}</span>
          ${naechster ? `<span class="badge${wasteBald(naechster.start) ? ' waste-bald' : ''}">${esc(wasteDateLabel(naechster.start))}</span>` : ''}
        </div>
        ${naechster ? `
          <div class="value waste-art">${esc(naechster.arten.join(' · '))}</div>
          <div class="name">${name}</div>
          <div class="waste-list">
            ${tage.slice(1).map(t => `
              <div class="waste-item">
                <span class="waste-punkte">${punkte(t.arten)}</span>
                <span class="waste-item-title">${esc(t.arten.join(' · '))}</span>
                <span class="waste-item-date">${esc(wasteDateLabel(t.start))}</span>
              </div>`).join('')}
          </div>`
        : `<div class="name">${name}</div>
           <div class="graph-empty">${esc(opts.wasteError || 'Keine Termine gefunden')}</div>`}`;
    } else if (type === 'photo') {
      const cardId = entity_id; // z.B. "photo:1712345678" -- eindeutig pro Karte
      const urls = fotoUrls(cardId, settings, opts.apiBase);
      card.classList.add('photo-card');

      if (urls.length === 1) {
        // Ein Bild: wie bisher als Kartenhintergrund, ohne zusaetzliche Ebenen.
        card.style.backgroundImage = `url('${urls[0]}')`;
      } else if (urls.length > 1) {
        // Diashow: zwei Ebenen, die sich ueberblenden. Ein harter Wechsel des
        // background-image blitzt weiss auf, solange das naechste Bild noch laedt.
        card.innerHTML = urls.map((u, i) =>
          `<div class="foto-ebene${i === 0 ? ' foto-vorn' : ''}" style="background-image:url('${u}')"></div>`).join('');
        const sek = Math.max(3, Math.min(3600, Number(settings.photoSeconds) || 20));
        let vorn = 0;
        const ebenen = card.querySelectorAll('.foto-ebene');
        const wechsel = setInterval(() => {
          if (!card.isConnected) return clearInterval(wechsel);   // Karte weggeraeumt
          ebenen[vorn].classList.remove('foto-vorn');
          vorn = (vorn + 1) % ebenen.length;
          ebenen[vorn].classList.add('foto-vorn');
        }, sek * 1000);
      }

      if (settings.name) {
        card.insertAdjacentHTML('beforeend', `<div class="photo-card-label">${esc(settings.name)}</div>`);
      } else if (!urls.length) {
        card.innerHTML = `<div class="photo-card-empty">Kein Bild – in den Karten-Einstellungen hochladen</div>`;
      }
    } else if (type === 'quicktiles') {
      const tiles = Array.isArray(settings.tiles) ? settings.tiles : [];
      const statesById = opts.statesById || {};
      card.classList.add('quicktiles-card');
      card.innerHTML = `
        ${settings.name ? `<div class="qt-title">${esc(settings.name)}</div>` : ''}
        <div class="qt-row">
          ${tiles.map(t => {
            const isActive = quickTileAktiv(t, statesById);
            const bg = t.imageDataUrl ? ` style="background-image:url('${t.imageDataUrl}')"` : '';
            return `<button class="qt-tile ${isActive ? 'active' : ''}" data-tile-id="${t.id}" ${dis}${bg}>
              ${!t.imageDataUrl ? `<span class="qt-tile-label">${esc(quickTileText(t))}</span>` : ''}
            </button>`;
          }).join('')}
          ${!tiles.length ? `<div class="graph-empty">Noch keine Kacheln – in den Karten-Einstellungen hinzufügen</div>` : ''}
        </div>`;
      if (!editable && cb.onQuickTile) {
        tiles.forEach(t => {
          const el = card.querySelector(`[data-tile-id="${t.id}"]`);
          if (el) el.addEventListener('click', e => { e.stopPropagation(); cb.onQuickTile(quickTileAktion(t)); });
        });
      }
    } else if (type === 'select') {
      const options = attrs.options || [];
      const current = state ? state.state : '';
      card.innerHTML = `
        <div class="row"><span class="icon">${symbolFuer(settings, ICONS.select)}</span></div>
        <div class="name">${name}</div>
        <select class="select-input" ${dis}>
          ${options.map(o => `<option value="${esc(o)}" ${o === current ? 'selected' : ''}>${esc(o)}</option>`).join('')}
        </select>`;
      if (!editable && cb.onSelectOption) {
        const sel = card.querySelector('.select-input');
        sel.addEventListener('click', e => e.stopPropagation());
        sel.addEventListener('change', () => cb.onSelectOption(domain, entity_id, sel.value));
      }
    } else if (type === 'navigate') {
      // Derselbe Aufbau wie jede andere Karte: Symbolzeile, Wert, Bildunterschrift. Vorher
      // standen hier nur ein Symbol und ein Wort in der Mitte -- das sah aus wie eine Anzeige
      // und nicht wie etwas, das man antippt. Der Zieltext steht jetzt gross als WERT, und
      // darunter steht ausgeschrieben, was passiert, wenn man draufdrueckt.
      const targetName = esc(settings.targetDashboardName || 'Dashboard');
      card.innerHTML = `
        <div class="row"><span class="icon">${ICONS.navigate}</span><span class="badge">Antippen</span></div>
        <div class="value">${targetName}</div>
        <div class="name">Dashboard wechseln</div>
        <span class="navigate-pfeil">${ICONS.pfeilRechts}</span>`;
      if (!editable && cb.onNavigate && settings.targetDashboardId) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => cb.onNavigate(settings.targetDashboardId));
      }
    } else if (type === 'forecast') {
      const isHourly = settings.forecastType === 'hourly';
      // Fest 5 Tage / 6 Stunden passte zu genau einer Kartenbreite. Eine xl-Karte hat Platz
      // fuer mehr, eine schmale fuer weniger.
      const anzahlVorschau = Math.max(2, Math.min(12, Number(settings.forecastCount) || (isHourly ? 6 : 5)));
      const days = (opts.forecast || []).slice(0, anzahlVorschau);
      const zeigeRegen = !!settings.forecastRain;
      const zeigeWind = !!settings.forecastWind;
      // Home Assistant liefert je nach Integration mal precipitation, mal
      // precipitation_probability -- und manchmal beides nicht.
      const regenVon = (d) => {
        if (typeof d.precipitation === 'number' && d.precipitation > 0) return Math.round(d.precipitation * 10) / 10 + ' mm';
        if (typeof d.precipitation_probability === 'number') return Math.round(d.precipitation_probability) + '%';
        return '';
      };
      const windVon = (d) => (typeof d.wind_speed === 'number' ? Math.round(d.wind_speed) + ' km/h' : '');
      const dayFmt = d => {
        const dt = new Date(d.datetime || d.date || d);
        return isHourly ? dt.toLocaleTimeString('de-DE', { hour: '2-digit' }) : dt.toLocaleDateString('de-DE', { weekday: 'short' });
      };
      card.innerHTML = `
        <div class="row"><span class="icon">${symbolFuer(settings, ICONS.forecast)}</span><span class="name">${name}</span></div>
        <div class="forecast-row">
          ${days.length ? days.map(d => `
            <div class="forecast-day">
              <div class="fc-label">${dayFmt(d)}</div>
              <span class="fc-icon">${ICONS[conditionIcon(d.condition)] || ICONS.cloudy}</span>
              <div class="fc-temps"><span class="fc-hi">${d.temperature !== undefined ? Math.round(d.temperature) + '°' : '–'}</span>${d.templow !== undefined ? `<span class="fc-lo">${Math.round(d.templow)}°</span>` : ''}</div>
              ${zeigeRegen && regenVon(d) ? `<div class="fc-extra fc-rain">${esc(regenVon(d))}</div>` : ''}
              ${zeigeWind && windVon(d) ? `<div class="fc-extra fc-wind">${esc(windVon(d))}</div>` : ''}
            </div>`).join('') : `<div class="graph-empty">${opts.forecastError || 'Keine Vorhersagedaten'}</div>`}
        </div>`;
    } else {
      // sensor / Fallback -- Wert ist primaer (gross), Name nur kleine Bildunterschrift
      const val = state ? state.state : '–';
      const unit = (settings.suffix !== undefined && settings.suffix !== '') ? settings.suffix : attrs.unit_of_measurement;
      card.innerHTML = `
        ${verlaufTeil}
        <div class="row"><span class="icon">${ortSymbol(mdiSymbol(attrs.icon) || ICONS[domain] || ICONS.sensor)}</span><span class="row-rechts">${tendenzTeil}${ortChip}</span></div>
        <div class="value">${fmt(zahlFormatieren(val, settings.decimals), unit)}</div>
        <div class="name">${name}</div>`;
    }

    // Die Silhouette als letztes Kind VOR allen anderen: Sie liegt unter Zahl und Schrift
    // (z-index in dashboard.css) und darf von keinem Zweig oben ueberschrieben werden.
    if (ort) {
      card.classList.add('ort-' + ort);
      const umriss = document.createElement('div');
      umriss.className = 'ort-silhouette';
      umriss.setAttribute('aria-hidden', 'true');
      umriss.innerHTML = ORTE[ort].silhouette;
      card.insertBefore(umriss, card.firstChild);
    }

    if (editable) {
      card.classList.add('editable');

      const handle = document.createElement('div');
      handle.className = 'drag-handle';
      handle.textContent = '⋮⋮';
      handle.draggable = false;
      card.appendChild(handle);

      if (opts.freeMove) {
        // Der Griff verschiebt die Karte frei auf feste x/y-Positionen, statt sie in eine
        // Liste einzusortieren -- die Position bleibt danach fix liegen.
        card.draggable = false;
        handle.style.cursor = 'grab';
        if (cb.onMoveStart) {
          handle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            cb.onMoveStart(entity_id, card, e);
          });
        }
      } else {
        card.draggable = true;
      }

      const removeBtn = document.createElement('div');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => { e.stopPropagation(); if (cb.onRemove) cb.onRemove(entity_id); });
      card.appendChild(removeBtn);

      const settingsBtn = document.createElement('div');
      settingsBtn.className = 'settings-btn';
      settingsBtn.innerHTML = ICONS.settings;
      settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); if (cb.onOpenSettings) cb.onOpenSettings(entity_id); });
      card.appendChild(settingsBtn);

      if (type !== 'clock' && type !== 'navigate' && type !== 'energy') {
        const copyBtn = document.createElement('div');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = ICONS.copy;
        copyBtn.title = 'Karte kopieren';
        copyBtn.addEventListener('click', (e) => { e.stopPropagation(); if (cb.onDuplicate) cb.onDuplicate(entity_id); });
        card.appendChild(copyBtn);
      }

      const editBar = document.createElement('div');
      editBar.className = 'edit-bar';

      const types = typesForEntity(entity_id);
      if (types.length > 1) {
        const select = document.createElement('select');
        select.className = 'type-select';
        types.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t;
          opt.textContent = (CARD_TYPES[t] || {}).label || t;
          opt.selected = t === type;
          select.appendChild(opt);
        });
        select.addEventListener('click', e => e.stopPropagation());
        select.addEventListener('change', () => { if (cb.onChangeType) cb.onChangeType(entity_id, select.value); });
        editBar.appendChild(select);
      }
      card.appendChild(editBar);

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'resize-handle';
      resizeHandle.draggable = false;
      resizeHandle.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M22 22H16M22 22V16M22 22L14 14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
      card.appendChild(resizeHandle);
      if (cb.onResizeStart) {
        resizeHandle.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          cb.onResizeStart(entity_id, card, e);
        });
      }
    }

    return card;
  }

  // Wendet ein importiertes Design (siehe /setup/design-import.html) als CSS-Variablen auf
  // :root an -- ueberschreibt Farben UND Formen/Abstaende. theme=null setzt alles wieder auf
  // die eingebauten Standardwerte aus dashboard.css zurueck (per removeProperty).
  // --- Eingebautes Standarddesign "Ankunft" ---------------------------------------------------
  //
  // Ab Werk aktiv, aber kein Zwang: Sobald der Nutzer ein eigenes Design importiert, gewinnt
  // seines. Ueber "Design zuruecksetzen" landet er wieder hier.
  //
  // Der Hintergrund ist hier bewusst ein STANDBILD aus denselben Farbwolken, die der
  // Ankunftsschirm bewegt zeigt. Hinter Zahlen, Diagrammen und Schaltern konkurriert eine
  // laufende Animation mit dem Inhalt -- und ein Dashboard schaut man tagelang an, einen
  // Ankunftsschirm einmal.
  // --- Die Farbwolken --------------------------------------------------------------------------
  //
  // Der Seitenhintergrund des eingebauten Designs: vier weiche Farbflecken auf fast schwarzem
  // Grund, dieselben, die der Ankunftsschirm in Bewegung zeigt.
  //
  // Sie stehen als DATEN da und nicht als fertige CSS-Zeichenkette, weil dasselbe Bild auch als
  // Windows-Hintergrund gebraucht wird -- und eine CSS-Zeichenkette laesst sich nicht malen.
  // Beide Wege lesen dieselbe Tabelle; sonst haette man zwei Hintergruende, die einander
  // aehnlich sehen sollen und es nach der ersten Aenderung nicht mehr tun.
  //
  // x/y = Mitte in Prozent, b/h = Radien in Prozent, ende = wo die Farbe verlaufen ist.
  const HINTERGRUND_WOLKEN = [
    { x: 14, y: 18, b: 52, h: 44, farbe: 'rgba(196,74,58,0.30)', ende: 68 },
    { x: 86, y: 26, b: 46, h: 40, farbe: 'rgba(122,58,168,0.28)', ende: 66 },
    { x: 74, y: 88, b: 60, h: 46, farbe: 'rgba(38,124,120,0.26)', ende: 70 },
    { x: 38, y: 72, b: 40, h: 34, farbe: 'rgba(214,132,48,0.18)', ende: 68 }
  ];

  function wolkenCss(wolken, grundfarbe) {
    return wolken
      .map(w => `radial-gradient(${w.b}% ${w.h}% at ${w.x}% ${w.y}%, ${w.farbe} 0%, transparent ${w.ende}%)`)
      .concat([grundfarbe])
      .join(', ');
  }

  /**
   * Malt die Farbwolken auf eine Zeichenflaeche -- fuer das Windows-Hintergrundbild.
   *
   * `createRadialGradient` kann nur Kreise. Die Wolken sind Ellipsen, deshalb wird die Flaeche
   * kurz gestaucht, der Kreis gezeichnet und wieder entzerrt. Ohne das saehen die Wolken rund
   * aus, und das Bild waere dem auf der Wand nur aehnlich statt gleich.
   */
  function wolkenMalen(ctx, breite, hoehe, wolken, grundfarbe) {
    ctx.fillStyle = grundfarbe;
    ctx.fillRect(0, 0, breite, hoehe);
    (wolken || []).forEach((w) => {
      const rx = (w.b / 100) * breite;
      const ry = (w.h / 100) * hoehe;
      const cx = (w.x / 100) * breite;
      const cy = (w.y / 100) * hoehe;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, w.farbe);
      g.addColorStop(w.ende / 100, w.farbe.replace(/,\s*[\d.]+\)$/, ',0)'));
      g.addColorStop(1, w.farbe.replace(/,\s*[\d.]+\)$/, ',0)'));
      ctx.fillStyle = g;
      // Grosszuegig ueber den Rand hinaus: Nach dem Stauchen liegt die Flaeche anders.
      ctx.fillRect(-breite * 2, -hoehe * 2, breite * 4, hoehe * 4);
      ctx.restore();
    });
  }

  const DEFAULT_THEME = {
    name: 'Ankunft',
    dark: {
      bg: '#0a0810',
      surface: 'rgba(255,255,255,0.07)',
      panel2: 'rgba(255,255,255,0.06)',
      cardBorder: 'rgba(255,255,255,0.14)',
      text: '#f3f1f7',
      muted: 'rgba(243,241,247,0.62)'
    },
    light: {
      bg: '#eceaf2',
      surface: 'rgba(255,255,255,0.55)',
      panel2: 'rgba(255,255,255,0.45)',
      cardBorder: 'rgba(255,255,255,0.7)',
      text: '#17151d',
      muted: 'rgba(23,21,29,0.6)'
    },
    cardRadius: '26px',
    cardShadow: '0 1.2vh 4vh rgba(0,0,0,0.42), 0 0.2vh 0.8vh rgba(0,0,0,0.22)',
    cardBlur: '20px',
    cardSaturate: '170%',
    cardHighlight: 'rgba(255,255,255,0.34)',
    cardHighlightSide: 'rgba(255,255,255,0.13)',
    // Der helle Gegenpart. Ohne ihn blieb im hellen Design der DUNKLE Verlauf stehen --
    // dunkler Text auf fast schwarzem Grund, darueber weisse Glaskarten. Das war der Grund,
    // warum das helle Design nicht zu gebrauchen war.
    //
    // Dieselben vier Farbwolken, nur hell und viel schwaecher: Auf Weiss traegt schon ein
    // Zehntel der Deckkraft sichtbar Farbe, waehrend auf Schwarz ein Drittel noetig ist.
    pageBgGradientLight: [
      'radial-gradient(52% 44% at 14% 18%, rgba(226,122,104,0.30) 0%, transparent 68%)',
      'radial-gradient(46% 40% at 86% 26%, rgba(166,124,214,0.26) 0%, transparent 66%)',
      'radial-gradient(60% 46% at 74% 88%, rgba(104,186,180,0.26) 0%, transparent 70%)',
      'radial-gradient(40% 34% at 38% 72%, rgba(240,186,110,0.24) 0%, transparent 68%)',
      '#f2f0f6'
    ].join(', '),
    // Auf hellem Grund traegt ein harter schwarzer Schatten auf; er wird weicher und
    // schwaecher, sonst sehen die Karten aus wie aufgeklebt.
    cardShadowLight: '0 1.2vh 3.4vh rgba(40,34,58,0.14), 0 0.2vh 0.6vh rgba(40,34,58,0.08)',
    pageBgGradient: wolkenCss(HINTERGRUND_WOLKEN, '#0a0810'),
    // Schlankere Schrift und ruhigere Beschriftungen -- das ist der Teil des Aussehens, den
    // die strukturierten Felder oben nicht abdecken.
    extraCss: [
      '.card .label, .card .caption { letter-spacing: .04em; }',
      '.card .value, .card .badge { font-weight: 300; }',
      '.card { border-top: 1px solid var(--card-highlight, transparent); }',
      'body { background-attachment: fixed; }'
    ].join(' ')
  };

  // Home Assistant liefert die Modi als englische Bezeichner. Unbekannte werden unveraendert
  // durchgereicht statt verschluckt -- lieber ein englisches Wort als ein leerer Knopf.
  const HVAC_LABEL = {
    off: 'Aus', heat: 'Heizen', cool: 'Kühlen', heat_cool: 'Auto', auto: 'Automatik',
    dry: 'Entfeuchten', fan_only: 'Nur Lüfter', idle: 'Bereit', heating: 'Heizt', cooling: 'Kühlt'
  };

  // Welcher Dienst gehoert zu welcher Entitaet? Damit laesst sich in der Tor-Card ein
  // input_button neben einem cover und einem script verwenden, ohne dass der Nutzer wissen
  // muss, was HA dahinter aufruft.
  //
  // "impuls" heisst: Die Entitaet muss wie ein TASTER wirken, nicht wie ein Schalter. Ein
  // Torantrieb haengt an einem Relais -- schaltet man es nur ein, bleibt es ein. Solche
  // Entitaeten werden kurz eingeschaltet und gleich wieder aus.
  //
  // input_button, button, script, scene und automation sind von Natur aus momentan; dort waere
  // ein Impuls sinnlos. cover faehrt ohnehin und darf nicht gestoppt werden.
  function serviceFuerEntitaet(entity_id) {
    const domain = String(entity_id || '').split('.')[0];
    switch (domain) {
      case 'input_button': case 'button': return { domain, service: 'press', impuls: false };
      case 'script': return { domain: 'script', service: 'turn_on', impuls: false };
      case 'scene': return { domain: 'scene', service: 'turn_on', impuls: false };
      case 'automation': return { domain: 'automation', service: 'trigger', impuls: false };
      case 'cover': return { domain: 'cover', service: 'open_cover', impuls: false };
      case 'lock': return { domain: 'lock', service: 'unlock', impuls: false };
      case 'switch': case 'input_boolean': case 'light':
        return { domain, service: 'turn_on', aus: 'turn_off', impuls: true };
      default: return null;
    }
  }

  // Alles, was aus Home Assistant oder aus den Einstellungen kommt, muss hier durch, bevor es
  // in innerHTML landet. Ein Kalendertitel mit "<" hat sonst gereicht, um eine Karte zu
  // zerlegen -- und Kalendertitel sind seit der Kalendersteuerung Alltag.
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const CUSTOM_THEME_VARS = {
    dark: { bg: '--bg', surface: '--surface', panel2: '--panel2', cardBorder: '--card-border', text: '--text', muted: '--muted' },
    light: { bg: '--bg', surface: '--surface', panel2: '--panel2', cardBorder: '--card-border', text: '--text', muted: '--muted' }
  };
  function applyCustomTheme(theme) {
    const sheetId = 'hawall-custom-theme';
    const existing = document.getElementById(sheetId);
    if (existing) existing.remove();
    if (!theme) return;
    const toCss = (obj, selector) => {
      const decls = Object.entries(CUSTOM_THEME_VARS.dark).map(([k, v]) => obj[k] ? `${v}: ${obj[k]};` : '').join(' ');
      return `${selector} { ${decls} }`;
    };
    const styleEl = document.createElement('style');
    styleEl.id = sheetId;
    let css = toCss(theme.dark || {}, ':root');
    css += ' ' + toCss(theme.light || {}, 'body.light-theme');
    if (theme.cardRadius) css += ` .card, .wizard { border-radius: ${theme.cardRadius} !important; }`;
    if (theme.cardShadow) css += ` .card { box-shadow: ${theme.cardShadow} !important; }`;
    // Glas-Effekt: Weichzeichner + Saettigungs-Boost hinter der Karte (das "Milchglas"-Gefuehl),
    // optionale Lichtkante oben/links (Specular Highlight) -- alles einzeln optional, ein
    // Design kann nur Farben setzen und den Rest weglassen.
    if (theme.cardBlur) {
      const sat = theme.cardSaturate || '100%';
      css += ` :root { --card-blur: blur(${theme.cardBlur}) saturate(${sat}); }`;
    }
    if (theme.cardHighlight) css += ` :root { --card-highlight: ${theme.cardHighlight}; }`;
    if (theme.cardHighlightSide) css += ` :root { --card-highlight-side: ${theme.cardHighlightSide}; }`;
    // Seitenhintergrund: Bild und/oder Verlauf hinter allem -- Glas-Effekte wirken erst richtig,
    // wenn dahinter etwas Farbiges zum Durchscheinen liegt statt eines flachen Einheitstons.
    if (theme.pageBgImage) css += ` :root { --page-bg-image: url('${theme.pageBgImage}'); }`;
    if (theme.pageBgGradient) css += ` body { background: ${theme.pageBgGradient}; }`;
    // Getrennt fuers helle Design -- sonst steht dort der dunkle Verlauf und der ebenfalls
    // dunkle Text ist nicht zu lesen.
    if (theme.pageBgGradientLight) css += ` body.light-theme { background: ${theme.pageBgGradientLight}; }`;
    if (theme.cardShadowLight) css += ` body.light-theme .card { box-shadow: ${theme.cardShadowLight} !important; }`;
    // Escape Hatch fuer alles, was die strukturierten Felder oben nicht abdecken -- macht das
    // Design-Import-System generell "komplexeres Design"-faehig statt nur die vordefinierten
    // Stellschrauben zu erlauben. Wird roh als CSS angehaengt (letztes Wort, ueberschreibt alles).
    if (theme.extraCss) css += ` ${theme.extraCss}`;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  global.DashboardRender = {
    ICONS, DOMAIN_LABEL, CARD_TYPES, TOGGLE_DOMAINS, PRESS_DOMAINS,
    defaultCardType, allowedCardTypes, defaultSize, buildCard,
    sizeToSpan, minSpanFor, clampSpan, resolveSpan, schonerSpanne, SCHONER_SPALTEN, SCHONER_ZEILEN, thresholdColor,
    domainsForType, typesForEntity, renderClockNow, sensorAkzente, SENSOR_FARBEN, SENSOR_FARBEN_HELL, isSolar,
    mdiSymbol, brauchtMdi, HINTERGRUND_WOLKEN, wolkenCss, wolkenMalen, ortErmitteln, ORT_TYPEN,
    torDarstellung, TOR_ZUSTAENDE, TOR_TAKT, torAnimation, TOR_TOLERANZ, TOR_ROT, torDauerauf, canOverlayOnPhoto, applyCustomTheme, esc,
    serviceFuerEntitaet,
    wasteColor, wasteDatum, wasteTage, wasteBald, wasteTagesschluessel, wasteDateLabel, zahlFormatieren, symbolFuer, symbolNamen,
    quickTileAktion, quickTileAktiv, quickTileText,
    kachelRegler, miniVerlaufSvg, tendenz, rueckmeldung,
    symbolErraten,
    HVAC_SYMBOL, hvacSymbol, hvacReihenfolge, animationsPhase, hvacPhasenStil,
    ankuendigungsText, ankuendigungKurz, NICHTS_ANZUZEIGEN,
    fotoBildId, fotoVersionen, fotoUrls,
    // Das Energiefluss-Diagramm als reine Funktion: rein die Werte, raus die SVG. Damit ist es
    // ohne Browser pruefbar -- und genau dort steckte der Fehler, der es sonst bis aufs Geraet
    // geschafft haette (das SVG-Kommando M, das beim Umbenennen mitwanderte).
    energieDiagramm: edDiagramm,
    DEFAULT_THEME
  };
  // Auch ausserhalb eines Browsers ladbar machen. Ohne das konnte kein einziger Test dieses
  // Modul ueberhaupt anfassen -- und genau in einem ungetesteten Pfad steckte der Fehler,
  // der es bis aufs Geraet geschafft hat (siehe CLAUDE.md).
  if (typeof module !== 'undefined' && module.exports) module.exports = global.DashboardRender;
})(typeof window !== 'undefined' ? window : globalThis);
