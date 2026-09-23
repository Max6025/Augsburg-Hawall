// Das Energiefluss-Diagramm. Eine einzige SVG -- Knoten, Linien und Text im selben
// Koordinatensystem.
//
// WARUM NEU
//
// Die alte Fassung setzte die Knoten per CSS absolut und legte darunter eine SVG mit
// `preserveAspectRatio="none"`. Damit wird das Koordinatensystem der Linien mit der Karte
// verzerrt, die CSS-Knoten aber nicht -- Linien und Knoten laufen bei jeder anderen
// Kartengroesse auseinander. Auf einer 4x2-Karte trifft die Linie den Knoten, auf einer 2x2
// endet sie im Nichts. Das war der "billige" Eindruck: nicht die Farben, die Geometrie.
//
// Jetzt steckt alles in EINER SVG mit `xMidYMid meet`. Was gezeichnet wird, kann nicht mehr
// gegeneinander verrutschen, und die Karte darf jede Groesse haben.
//
// AUFBAU wie bei Home Assistant: Solar oben, Netz links, Haus rechts, Batterie unten. Die
// Verbindungen laufen als Kurven ueber die Mitte, nicht als Winkel -- eine Leitung, die einen
// rechten Winkel macht, sieht nach Schaltplan aus, nicht nach Fluss.

(function (global) {
  'use strict';

  // Hoeher als breit, und das mit Absicht: Unter jedem Knoten stehen zwei Zeilen (Wert und
  // Name), und beim untersten Knoten muessen die noch ins Bild passen. Mit einem Quadrat wurde
  // die Beschriftung der Batterie abgeschnitten -- sichtbar erst, wenn eine Batterie
  // konfiguriert ist, also beim Nutzer und nicht beim Bauen.
  const B = 400;
  const R = 44;               // Radius eines Knotens
  const BAHN = 136;           // Abstand der Knotenmitte von der Mitte
  const MITTE_Y = 240;
  // Unter jedem Knoten stehen zwei Zeilen. Beim UNTERSTEN muessen die noch ins Bild passen --
  // sonst wird die Beschriftung der Batterie abgeschnitten, und zwar erst beim Nutzer, weil
  // ohne Batterie nichts dort unten steht.
  //
  // Die Hoehe haengt deshalb davon ab, ob eine Batterie dabei ist. Eine feste Hoehe sah ohne
  // Batterie aus wie eine Karte, die zu einem Drittel leer ist: Die Zeichnung wird auf die
  // Hoehe eingepasst, und das reservierte Feld unten bleibt leer.
  const H_OHNE = MITTE_Y + R + 70;
  const H_MIT = MITTE_Y + BAHN + R + 74;

  const M = { x: B / 2, y: MITTE_Y };
  const ORT = {
    solar:    { x: M.x,        y: M.y - BAHN },
    netz:     { x: M.x - BAHN, y: M.y },
    haus:     { x: M.x + BAHN, y: M.y },
    batterie: { x: M.x,        y: M.y + BAHN }
  };

  const FARBE = {
    solar: '#f5b544',
    netz: '#6f7784',
    haus: '#4f7cff',
    batterie: '#57c98a',
    ruhe: 'rgba(255,255,255,0.13)'
  };

  function fmt(w) {
    if (w === null || w === undefined || !isFinite(w)) return '–';
    const a = Math.abs(w);
    if (a >= 10000) return (w / 1000).toFixed(1).replace('.', ',') + ' kW';
    if (a >= 1000) return (w / 1000).toFixed(2).replace('.', ',') + ' kW';
    return Math.round(w) + ' W';
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Eine Kurve von A nach B, die durch die Mitte ausholt. Der Kontrollpunkt liegt auf der
  // Verbindung zur Mitte -- so biegt jede Leitung zur Mitte hin und die vier sehen wie ein
  // System aus und nicht wie vier Striche.
  function bahn(a, b) {
    const ax = a.x + (M.x - a.x) * (R / BAHN);
    const ay = a.y + (M.y - a.y) * (R / BAHN);
    const bx = b.x + (M.x - b.x) * (R / BAHN);
    const by = b.y + (M.y - b.y) * (R / BAHN);
    return `M${ax.toFixed(1)},${ay.toFixed(1)} Q${M.x},${M.y} ${bx.toFixed(1)},${by.toFixed(1)}`;
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
  const GROESSE = 46;
  function symbol(quelle, ort, farbe) {
    if (!quelle) return '';
    const x = (ort.x - GROESSE / 2).toFixed(1);
    const y = (ort.y - GROESSE / 2).toFixed(1);
    return quelle.replace('<svg ',
      `<svg class="ed-symbol" x="${x}" y="${y}" width="${GROESSE}" height="${GROESSE}" `
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
  function knoten(art, ort, wert, beschriftung, aktiv, zusatz, symbole, textOben) {
    const farbe = FARBE[art];
    const name = zusatz ? beschriftung + ' \u00b7 ' + zusatz : beschriftung;
    // Wert immer naeher an der Scheibe als der Name: Er ist die Zahl, die man sucht.
    const yWert = textOben ? ort.y - R - 16 : ort.y + R + 32;
    const yName = textOben ? ort.y - R - 38 : ort.y + R + 56;
    return `
      <g class="ed-knoten ${aktiv ? 'ed-aktiv' : ''}">
        <circle cx="${ort.x}" cy="${ort.y}" r="${R}" class="ed-scheibe"/>
        <circle cx="${ort.x}" cy="${ort.y}" r="${R}" class="ed-ring" style="stroke:${farbe}"/>
        ${symbol(symbole[art], ort, farbe)}
        <text x="${ort.x}" y="${yWert}" class="ed-wert">${esc(fmt(wert))}</text>
        <text x="${ort.x}" y="${yName}" class="ed-name">${esc(name)}</text>
      </g>`;
  }

  /**
   * daten: { solarW, netzBezugW, netzEinspeisungW, batterieW, batterieLaedt, batterieSoc,
   *          hausW, schwelleW, namen: {solar, netz, haus, batterie} }
   * Fehlende Zweige werden weggelassen, nicht mit Null gezeichnet.
   */
  function diagramm(d) {
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
      leitungen.push({ d: bahn(ORT.solar, ORT.haus), farbe: FARBE.solar, aktiv: solarAktiv, um: false });
      if (einspeisung > s) {
        leitungen.push({ d: bahn(ORT.solar, ORT.netz), farbe: FARBE.solar, aktiv: true, um: false });
      }
    }
    if (bezug > s) {
      leitungen.push({ d: bahn(ORT.netz, ORT.haus), farbe: FARBE.netz, aktiv: true, um: false });
    } else {
      leitungen.push({ d: bahn(ORT.netz, ORT.haus), farbe: FARBE.netz, aktiv: false, um: false });
    }
    if (hatBatterie) {
      leitungen.push({
        d: d.batterieLaedt ? bahn(ORT.solar, ORT.batterie) : bahn(ORT.batterie, ORT.haus),
        farbe: FARBE.batterie, aktiv: battAktiv, um: false
      });
    }

    // LUFT OBEN. Der Name des Solarknotens steht ueber seiner Scheibe und lag ohne diesen Rand
    // auf der Kante des Ausschnitts -- in einer Karte mit `overflow: hidden` ist er dann halb
    // abgeschnitten, und zwar nur oben, was wie ein Zufall aussieht und keiner ist.
    const LUFT = 14;
    const hoehe = (hatBatterie ? H_MIT : H_OHNE) + LUFT;
    return `
      <svg class="ed" viewBox="0 ${-LUFT} ${B} ${hoehe}" preserveAspectRatio="xMidYMid meet" role="img">
        <g>
          ${leitungen.map(l => `<path d="${l.d}" class="ed-leitung ${l.aktiv ? 'ed-fliesst' : ''}"
             style="stroke:${l.aktiv ? l.farbe : FARBE.ruhe}"/>`).join('')}
        </g>
        ${hatSolar ? knoten('solar', ORT.solar, d.solarW, n.solar, solarAktiv, '', symbole, true) : ''}
        ${knoten('netz', ORT.netz, netzWert, n.netz, netzAktiv,
          einspeisung > s ? 'Einspeisung' : (bezug > s ? 'Bezug' : ''), symbole)}
        ${knoten('haus', ORT.haus, d.hausW, n.haus, (d.hausW || 0) > s, '', symbole)}
        ${hatBatterie ? knoten('batterie', ORT.batterie, d.batterieW, n.batterie, battAktiv,
          d.batterieSoc !== null && d.batterieSoc !== undefined
            ? Math.round(d.batterieSoc) + ' %' + (d.batterieLaedt ? ' ↑' : ' ↓') : '', symbole) : ''}
      </svg>`;
  }

  const api = { diagramm, fmt, B, H_OHNE, H_MIT, FARBE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.EnergieDiagramm = api;
})(typeof window !== 'undefined' ? window : globalThis);
