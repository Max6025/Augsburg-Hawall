// Das Energiefluss-Diagramm.
//
// Eine reine Funktion: rein die Leistungen, raus die SVG. Genau deshalb ist hier pruefbar, was
// sonst nur am Geraet aufgefallen waere -- und einmal schon aufgefallen IST.
//
// Der Aufbau ist seit 1.0.27 ein NABENSTERN nach der Vorlage einer App-Ansicht: ein Ring in der
// Mitte mit dem Eigenanteil, Haus oben, Netz rechts, Solar unten, Wallbox links, Batterie auf
// der Diagonale. Jede Leitung ist eine GERADE mit einem Richtungsdreieck darauf.

const test = require('node:test');
const assert = require('node:assert');
const R = require('../renderer/shared/dashboard-render.js');

const SYM = {
  solar: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>',
  netz: '<svg viewBox="0 0 24 24"><path d="M12 2v20"/></svg>',
  haus: '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7"/></svg>',
  batterie: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="16" height="10"/></svg>'
};
const mach = (d) => R.energieDiagramm(Object.assign({ schwelleW: 5, symbole: SYM }, d));
const pfade = (svg) => [...svg.matchAll(/<path d="([^"]+)"\s+class="ed-leitung/g)].map(m => m[1]);
const ausschnitt = (svg) => /class="ed" viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(svg).slice(1).map(Number);

// Alle Richtungsdreiecke samt Ort und Winkel. Ueber den Ort ist die Leitung eindeutig: Der
// Pfeil sitzt auf der Mitte zwischen Nabe und Knoten.
function pfeile(svg) {
  return [...svg.matchAll(/class="ed-pfeil"[^>]*?transform="translate\((-?[\d.]+),(-?[\d.]+)\) rotate\((-?[\d.]+)\)"/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), winkel: Number(m[3]) }));
}
function pfeilBei(svg, x, y) {
  return pfeile(svg).find(p => Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 2);
}
// Die Mitten der Leitungen -- ED_MITTE (200,190), ED_BAHN 140, Batterie auf der Diagonale
// weiter aussen. Hier als Zahlen, damit ein Verrutschen der Geometrie AUFFAELLT statt sich
// stillschweigend anzupassen.
const MITTE_HAUS = [200, 120], MITTE_NETZ = [270, 190];
const MITTE_SOLAR = [200, 260], MITTE_WALLBOX = [130, 190];
const MITTE_BATTERIE = [139.5, 262.5];

test('Jeder Leitungspfad ist eine GERADE und beginnt mit dem SVG-Kommando M', () => {
  // DER Test dieser Datei. Beim Umbenennen der Konstanten wurde das fuehrende `M` des
  // Pfadstrings mitumbenannt ("ED_M200,148"). Der Browser verwirft so einen Pfad
  // STILLSCHWEIGEND: getTotalLength() gibt 0, es gibt keine Fehlermeldung, und die Karte zeigt
  // Knoten ohne eine einzige Leitung. Von aussen sieht das aus wie ein Gestaltungsfehler.
  //
  // Gerade, nicht geschwungen: Eine Bahn, die ausholt, laesst offen, wo sie herkommt. In der
  // Vorlage laufen die Leitungen schnurstracks von der Nabe zum Knoten, und genau das macht
  // aus fuenf Metern den Unterschied.
  const svg = mach({ solarW: 4000, netzBezugW: 200, netzEinspeisungW: 0, hausW: 4200,
    batterieW: 500, batterieLaedt: true });
  const p = pfade(svg);
  assert.ok(p.length >= 4, 'es muessen Leitungen gezeichnet werden: ' + p.length);
  for (const d of p) {
    assert.match(d, /^M-?[\d.]+,-?[\d.]+ L-?[\d.]+,-?[\d.]+$/, 'kein gueltiger Pfad: ' + d);
  }
  assert.ok(!svg.includes(' Q'), 'keine Kurven mehr');
});

test('Die Leitungen enden am RAND der Ringe, nicht in den Mittelpunkten', () => {
  // Der Knoten ist eine Kontur, keine Scheibe. Eine Linie bis zum Mittelpunkt liefe sichtbar
  // quer durch das Symbol -- vorher hat die gefuellte Scheibe das verdeckt.
  const svg = mach({ solarW: 4000, netzBezugW: 0, hausW: 4000 });
  const haus = pfade(svg).find(d => /^M200\.0,/.test(d) && Number(/L200\.0,([\d.]+)/.exec(d)[1]) < 190);
  assert.ok(haus, 'die Hausleitung fehlt: ' + pfade(svg).join(' | '));
  const [, y1, y2] = /^M200\.0,([\d.]+) L200\.0,([\d.]+)$/.exec(haus).map(Number);
  assert.strictEqual(y1, 150, 'Start am Rand der Nabe (190 - 40)');
  assert.strictEqual(y2, 84, 'Ende am Rand des Hausrings (50 + 34)');
});

test('Unter der Schwelle fliesst nichts und es gibt keinen Pfeil', () => {
  // Ein Wechselrichter, der nachts 30 W Eigenverbrauch meldet, darf die Leitung nicht die
  // ganze Nacht leuchten lassen.
  const ruhig = mach({ solarW: 3, netzBezugW: 2, netzEinspeisungW: 0, hausW: 5, schwelleW: 5 });
  assert.strictEqual((ruhig.match(/ed-fliesst/g) || []).length, 0, 'keine Leitung darf fliessen');
  assert.strictEqual(pfeile(ruhig).length, 0, 'und kein Dreieck darauf liegen');
  const laut = mach({ solarW: 300, netzBezugW: 2, netzEinspeisungW: 0, hausW: 302, schwelleW: 5 });
  assert.ok((laut.match(/ed-fliesst/g) || []).length > 0);
  assert.ok(pfeile(laut).length > 0);
});

test('Das Dreieck zeigt in die Richtung, in die der Strom fliesst', () => {
  // Der Grund, warum es das Dreieck ueberhaupt gibt: Eine leuchtende Leitung zwischen Netz und
  // Nabe kann Bezug ODER Einspeisung heissen -- Geld ausgeben oder Geld verdienen.
  const bezug = mach({ solarW: 0, netzBezugW: 2000, netzEinspeisungW: 0, hausW: 2000 });
  assert.strictEqual(pfeilBei(bezug, ...MITTE_NETZ).winkel, 180, 'Bezug zeigt zur Nabe (nach links)');
  assert.strictEqual(pfeilBei(bezug, ...MITTE_HAUS).winkel, -90, 'zum Haus zeigt es nach oben, weg von der Nabe');

  const raus = mach({ solarW: 4000, netzBezugW: 0, netzEinspeisungW: 2600, hausW: 1400 });
  assert.strictEqual(pfeilBei(raus, ...MITTE_NETZ).winkel, 0, 'Einspeisung zeigt nach rechts, weg von der Nabe');
  // 270 und nicht -90: rotate() bekommt den Winkel der Leitung (90, nach unten) plus 180.
  assert.strictEqual(pfeilBei(raus, ...MITTE_SOLAR).winkel, 270, 'Solar liegt unten und speist nach oben ein');
});

test('Die Batterie dreht ihren Pfeil je nach Laden und Entladen', () => {
  const laedt = mach({ solarW: 4000, netzBezugW: 0, hausW: 2000, batterieW: 2000, batterieLaedt: true });
  const ab = mach({ solarW: 0, netzBezugW: 0, hausW: 2000, batterieW: 2000, batterieLaedt: false });
  const p = (svg) => pfeilBei(svg, ...MITTE_BATTERIE);
  assert.ok(p(laedt) && p(ab), 'beide Faelle brauchen einen Pfeil auf der Batterieleitung');
  assert.notStrictEqual(p(laedt).winkel, p(ab).winkel, 'Laden und Entladen zeigen nicht in dieselbe Richtung');
  assert.strictEqual(Math.abs(p(laedt).winkel - p(ab).winkel), 180);
});

test('Der Netzknoten zeigt den Betrag, die Richtung steht im Namen', () => {
  // Ein Minuszeichen vor einer Zahl liest man aus fuenf Metern nicht.
  const rein = mach({ solarW: 0, netzBezugW: 840, netzEinspeisungW: 0, hausW: 840 });
  assert.match(rein, /840 W/);
  assert.match(rein, /Bezug/);
  const raus = mach({ solarW: 4000, netzBezugW: 0, netzEinspeisungW: 2600, hausW: 1400 });
  assert.match(raus, /2,60 kW/, 'der Betrag, nicht -2,60');
  assert.ok(!raus.includes('-2,60'), 'kein Minuszeichen');
  assert.match(raus, /Einspeisung/);
});

test('Eine Zahl steht nur an einem Knoten, an dem etwas fliesst', () => {
  // "0 W" an fuenf Knoten gleichzeitig ist Zahlensalat, den niemand liest -- der graue Ring
  // sagt schon, dass hier gerade nichts passiert. Genau so macht es die Vorlage.
  const svg = mach({ solarW: 0, netzBezugW: 2000, netzEinspeisungW: 0, hausW: 2000, wallboxW: 0 });
  assert.strictEqual((svg.match(/class="ed-wert"/g) || []).length, 2, 'nur Netz und Haus');
  assert.ok(!svg.includes('>0 W<'), 'keine Null irgendwo');
});

test('Unter einem Knoten stehen HOECHSTENS zwei Zeilen, und die zweite traegt die Richtung', () => {
  // Zwei Dinge auf einmal. Erstens: "Netz" und "Bezug" standen als eigene Zeilen auf
  // DERSELBEN Grundlinie -- gedruckt las man "BEEZTUZG". Kein Fehler, den ein Test bemerkt
  // haette, beide Texte waren ja da.
  // Zweitens, und das ist der Grund fuer die eine Zeile: Mit drei Zeilen reicht der
  // Wallbox-Knoten links in den Batteriering hinein -- nur bei dem, der beides hat.
  const svg = mach({ solarW: 0, netzBezugW: 840, netzEinspeisungW: 0, hausW: 840,
    namen: { netz: 'Netz' } });
  const g = svg.split('<g class="ed-knoten').find(s => s.includes('cx="340"'));
  const zeilen = [...g.matchAll(/y="(-?[\d.]+)" class="ed-(?:wert|name)"[^>]*>([^<]*)</g)]
    .map(m => ({ y: Number(m[1]), t: m[2] }));
  assert.strictEqual(zeilen.length, 2, 'Wert und Beschriftung -- mehr nicht: '
    + zeilen.map(z => z.t).join(' / '));
  assert.ok(zeilen[1].y - zeilen[0].y >= 18, 'sie duerfen sich nicht ueberdecken: '
    + zeilen.map(z => z.y).join(', '));
  assert.strictEqual(zeilen[1].t, 'Netz · Bezug', 'die Richtung haengt am Namen');
});

test('Mit fuenf Knoten laeuft kein Text in einen fremden Ring', () => {
  // Der Fall, den es vorher zerlegt hat: Wallbox links, Batterie darunter. Gerechnet wird mit
  // den Kaesten, die auch gezeichnet werden -- Ring gegen Textzeile.
  const svg = R.energieDiagramm({ solarW: 9100, netzBezugW: 300, netzEinspeisungW: 0,
    hausW: 200, verbrauchW: 11000, wallboxW: 10800, batterieW: 1600, batterieLaedt: false,
    batterieSoc: 22, schwelleW: 5, symbole: {},
    namen: { solar: 'Solar', netz: 'Netz', haus: 'Haus', batterie: 'Batterie', wallbox: 'Wallbox' } });
  const ringe = [...svg.matchAll(/cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="(\d+)"/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), r: Number(m[3]) }));
  assert.strictEqual(ringe.length, 6, 'Nabe und fuenf Knoten');
  for (const m of svg.matchAll(/x="(-?[\d.]+)" y="(-?[\d.]+)" class="ed-(wert|name)"/g)) {
    const x = Number(m[1]), y = Number(m[2]);
    const halb = (m[3] === 'wert' ? 50 : 60);   // halbe Textbreite, grosszuegig geschaetzt
    for (const r of ringe) {
      const dx = Math.max(0, Math.abs(x - r.x) - halb);
      const dy = Math.abs(y - 8 - r.y);         // 8 = halbe Zeilenhoehe ueber der Grundlinie
      assert.ok(Math.hypot(dx, dy) > r.r,
        `Text bei ${x},${y} liegt im Ring ${r.x},${r.y}`);
    }
  }
});

test('Der Wert traegt die Farbe seines Knotens', () => {
  // Bei fuenf Knoten ist das der Unterschied zwischen lesen und suchen: Man ordnet die Zahl
  // dem Ring zu, ohne der Leitung mit dem Auge zu folgen.
  const svg = mach({ solarW: 4000, netzBezugW: 200, netzEinspeisungW: 0, hausW: 4200 });
  assert.match(svg, /class="ed-wert" style="fill:#f5b544"/, 'Solar gelb');
  assert.match(svg, /class="ed-wert" style="fill:#e8623c"/, 'Netz rot');
  assert.match(svg, /class="ed-wert" style="fill:#c464e0"/, 'Haus violett');
});

test('Fehlende Zweige werden weggelassen, nicht mit Null gezeichnet', () => {
  const knoten = (svg) => (svg.match(/ed-knoten/g) || []).length;
  const ohneSolar = mach({ netzBezugW: 1240, netzEinspeisungW: 0, hausW: 1240 });
  assert.strictEqual(knoten(ohneSolar), 2, 'ohne Solarsensor darf kein Solarknoten erscheinen');
  const mitSolar = mach({ solarW: 0, netzBezugW: 1240, netzEinspeisungW: 0, hausW: 1240 });
  assert.strictEqual(knoten(mitSolar), 3, 'mit Sensor erscheint er, auch bei 0 W');
  assert.ok(mitSolar.includes('cy="330"'), 'und zwar unten');
});

test('Die Symbole kommen von aussen und werden eingesetzt', () => {
  // Zwei Symbolsaetze im selben Dashboard waeren zwei Formensprachen. Der Satz in ICONS ist
  // der eine -- deshalb reicht die Karte ihn herein, statt eigene Pfade zu halten.
  const svg = mach({ solarW: 100, netzBezugW: 10, hausW: 110 });
  assert.strictEqual((svg.match(/class="ed-symbol"/g) || []).length, 3);
  assert.ok(svg.includes('viewBox="0 0 24 24"'), 'die Symbole behalten ihr eigenes Raster');
});

test('Ein fehlender Wert wird zum Gedankenstrich, nicht zu 0', () => {
  // "0 W" behauptet eine Messung. Ein Strich sagt: nichts bekannt.
  const svg = mach({ solarW: null, netzBezugW: null, hausW: null });
  assert.ok(svg.includes('–'), 'es muss ein Gedankenstrich vorkommen');
});

// --- Die Nabe ------------------------------------------------------------------------------

test('In der Nabe steht der Eigenanteil, und er rechnet auf ALLES', () => {
  // Die eine Zahl, die auf keiner Leitung steht. Sie muss den Gesamtverbrauch ansetzen, nicht
  // den Haus-Rest: Sonst springt sie beim Laden des Autos nach oben, obwohl mehr Strom gekauft
  // wird als vorher.
  const halb = mach({ solarW: 1000, netzBezugW: 1000, netzEinspeisungW: 0, hausW: 2000 });
  assert.match(halb, /class="ed-anteil"[^>]*>50%</);
  // 2 kW Haus, 6 kW Auto, davon 4 kW aus dem Netz -> 50 %, nicht 0 %.
  const mitAuto = mach({ solarW: 4000, netzBezugW: 4000, netzEinspeisungW: 0,
    hausW: 2000, verbrauchW: 8000, wallboxW: 6000 });
  assert.match(mitAuto, /class="ed-anteil"[^>]*>50%</);
});

test('Ohne Hausverbrauch gibt es keinen Anteil -- und das ist nicht 0 %', () => {
  // 0 % wuerde "alles gekauft" behaupten, und gekauft wurde gar nichts.
  const svg = mach({ solarW: 0, netzBezugW: 0, hausW: 0 });
  assert.match(svg, /class="ed-anteil"[^>]*>–</);
  assert.ok(!/ed-nabe ed-aktiv/.test(svg), 'die Nabe leuchtet dann nicht');
});

test('Mehr Netzbezug als Hausverbrauch ergibt 0 %, nicht einen negativen Anteil', () => {
  // Kommt vor, sobald die Batterie laedt oder die Zaehler nicht in derselben Sekunde messen.
  const svg = mach({ solarW: 0, netzBezugW: 5000, netzEinspeisungW: 0, hausW: 3000 });
  assert.match(svg, /class="ed-anteil"[^>]*>0%</);
});

// --- Staerke, Tempo, Ausschnitt -------------------------------------------------------------

test('Staerke und Tempo richten sich nach der Leistung', () => {
  // Der Unterschied zwischen einer Grafik, die Zahlen zeigt, und einer, an der man im
  // Vorbeigehen sieht, dass etwas passiert.
  const wert = (w) => {
    const svg = mach({ solarW: w, netzBezugW: 0, netzEinspeisungW: 0, hausW: w });
    const dicke = /class="ed-leitung ed-fliesst"\s+style="stroke:#f5b544;stroke-width:([\d.]+)px"/.exec(svg);
    const dauer = /class="ed-pfeil"[^>]*style="animation-duration:([\d.]+)s"/.exec(svg);
    assert.ok(dicke && dauer, 'kein Stil an Leitung oder Pfeil: ' + svg.slice(0, 300));
    return { dicke: Number(dicke[1]), dauer: Number(dauer[1]) };
  };
  const klein = wert(12), mittel = wert(800), gross = wert(5200);
  assert.ok(klein.dicke < mittel.dicke && mittel.dicke < gross.dicke,
    `Dicke steigt nicht: ${klein.dicke} / ${mittel.dicke} / ${gross.dicke}`);
  assert.ok(klein.dauer > mittel.dauer && mittel.dauer > gross.dauer,
    `Tempo steigt nicht: ${klein.dauer} / ${mittel.dauer} / ${gross.dauer}`);
});

test('Die Skala ist logarithmisch, nicht linear', () => {
  // Linear waere die 12-W-Leitung ein unsichtbarer Haarstrich und ab etwa 2 kW jede gleich
  // dick -- man saehe genau im interessanten Bereich keinen Unterschied. Pruefung: Der Schritt
  // von 12 auf 120 W muss aehnlich viel bringen wie der von 500 auf 5000 W.
  const dicke = (w) => Number(/stroke-width:([\d.]+)px/.exec(
    mach({ solarW: w, netzBezugW: 0, hausW: w }))[1]);
  const unten = dicke(120) - dicke(12);
  const oben = dicke(5000) - dicke(500);
  assert.ok(unten > 0.7, 'die kleinen Werte muessen sich unterscheiden: ' + unten);
  assert.ok(oben > 0.8, 'die grossen auch: ' + oben);
  assert.ok(unten / oben < 4 && oben / unten < 4,
    `die Schritte liegen zu weit auseinander -- das ist keine log-Skala: ${unten} / ${oben}`);
});

test('Eine ruhende Leitung bleibt duenn', () => {
  // Sie zeigt, dass der Weg da ist, nicht dass etwas fliesst.
  const svg = mach({ solarW: 2, netzBezugW: 1, netzEinspeisungW: 0, hausW: 3, schwelleW: 5 });
  assert.ok(!svg.includes('ed-fliesst'), 'nichts darf fliessen');
  assert.match(svg, /stroke-width:2px/, 'und sie bleibt auf der Grundstaerke');
});

test('Der Ausschnitt richtet sich nach den Knoten, die es WIRKLICH gibt', () => {
  // Vorher standen hier zwei feste Zahlen. Wer keinen Solarsensor eingetragen hatte, bekam
  // unten ein leeres Drittel -- und weil die Zeichnung auf die Hoehe eingepasst wird, wurde
  // alles andere dafuer kleiner.
  const h = (d) => ausschnitt(R.energieDiagramm(Object.assign({ symbole: {} }, d)))[3];
  const knapp = h({ netzBezugW: 1200, hausW: 1200 });
  assert.ok(h({ solarW: 1, netzBezugW: 1200, hausW: 1200 }) > knapp + 80,
    'ein Knoten unten braucht Platz unten');
  assert.ok(h({ netzBezugW: 1200, hausW: 1200, batterieW: 1 }) > knapp,
    'die Batterie sitzt tiefer als die Mitte');
  assert.strictEqual(h({ netzBezugW: 1200, hausW: 1200, wallboxW: 1 }), knapp,
    'die Wallbox sitzt auf der Hoehe der Nabe und braucht keinen Platz nach unten');
});

test('Der Ausschnitt hat seitlich Luft -- sonst werden Namen abgeschnitten', () => {
  // In der Probe nachgemessen: "Netz · Einspeisung" lief von x=-16 bis 144 bei einem
  // Ausschnitt von 0 bis 400.
  const [x, , breite] = ausschnitt(R.energieDiagramm(MIT_WALLBOX));
  assert.ok(x < 0, `der Ausschnitt muss links vor 0 beginnen, war ${x}`);
  assert.ok(x + breite > 400, 'und rechts hinter 400 enden');
});

// --- Klassen und CSS ------------------------------------------------------------------------

test('Jede Klasse im Diagramm hat eine Regel im CSS', () => {
  // Dieser Test haette beide Unfaelle von damals gefangen. Beim Umbenennen der Konstanten traf
  // das Muster auch die KLASSENNAMEN in den Zeichenketten: aus `ed-symbol` wurde
  // `ed-edSymbol`, aus `ed-knoten` wurde `ed-edKnoten`. Es gab keinen Fehler -- das Element
  // war da, nur ohne Gestaltung. Genau die Sorte Schaden, die man erst auf der Wand sieht.
  //
  // Die Gegenrichtung zaehlt mit: Eine CSS-Regel, die niemand benutzt, ist dasselbe wie eine,
  // die es nicht gibt (siehe CLAUDE.md, gauge.baseColor). Beim Umbau auf den Nabenstern blieb
  // genau so `.ed-scheibe` stehen -- die gefuellte Flaeche hinter dem Symbol, die es nicht
  // mehr gibt.
  const fs = require('node:fs');
  const path = require('node:path');
  const wurzel = path.join(__dirname, '..', 'renderer', 'shared');
  const js = fs.readFileSync(path.join(wurzel, 'dashboard-render.js'), 'utf8');
  const css = fs.readFileSync(path.join(wurzel, 'dashboard.css'), 'utf8');

  const teil = js.slice(js.indexOf('Das Energiefluss-Diagramm ---'), js.indexOf('const ICONS = {'));
  assert.ok(teil.length > 2000, 'der Diagramm-Abschnitt wurde nicht gefunden');
  // Eingebettete Ausdruecke (`${aktiv ? 'ed-aktiv' : ''}`) erst herausnehmen, sonst faellt
  // jede zusammengesetzte Klasse durchs Raster -- so hat dieser Test beim ersten Anlauf
  // `ed-knoten` und `ed-leitung` uebersehen und dafuer `editable` bemaengelt.
  const imJs = new Set();
  for (const m of teil.matchAll(/class="([^"]*)"/g)) {
    const roh = m[1];
    for (const k of roh.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      if (/^ed(-|$)/.test(k)) imJs.add(k);
    }
    // Und die Klassen AUS den Ausdruecken, dort stehen sie als Zeichenketten.
    for (const t of roh.matchAll(/'(ed[-\w]*)'/g)) if (t[1]) imJs.add(t[1]);
  }
  // Nicht jede Klasse steht in einem `class="..."`: Die Textzeilen tragen ihre Klasse als Wert
  // in einer Tabelle (`{ k: 'ed-wert', … }`). Wer nur nach `class=` sucht, haelt die dann fuer
  // unbenutzt und loescht die Regel -- einmal beinahe passiert.
  for (const m of teil.matchAll(/'(ed-[\w-]+)'/g)) imJs.add(m[1]);

  // Nur `.ed` und `.ed-...` -- sonst zaehlen `editable` und `edit-bar` mit, die mit dem
  // Diagramm nichts zu tun haben.
  const imCss = new Set();
  for (const m of css.matchAll(/\.(ed(?:-[\w-]+)?)(?![\w-])/g)) imCss.add(m[1]);

  const ohneRegel = [...imJs].filter(k => !imCss.has(k));
  assert.deepStrictEqual(ohneRegel, [], 'Klassen im JS ohne CSS-Regel: ' + ohneRegel.join(', '));

  // Umgekehrt: Regeln fuer Klassen, die niemand mehr setzt. `ed-fehler*` gehoert zur
  // Warnung im Kartenzweig, nicht zum Diagramm, und ist ausgenommen.
  const verwaist = [...imCss].filter(k => !imJs.has(k) && !k.startsWith('ed-fehler'));
  assert.deepStrictEqual(verwaist, [], 'CSS-Regeln ohne Verwendung: ' + verwaist.join(', '));
});

test('Die Knoten sind Ringe -- von der gefuellten Scheibe ist nichts uebrig', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wurzel = path.join(__dirname, '..', 'renderer', 'shared');
  for (const datei of ['dashboard-render.js', 'dashboard.css']) {
    const inhalt = fs.readFileSync(path.join(wurzel, datei), 'utf8');
    // Die Vorgaengerin des Nabensterns, und die Vorgaengerin von DER: Bleibt eine Regel
    // stehen, gestaltet sie irgendwann wieder mit, und niemand weiss, woher.
    for (const alt of ['ed-scheibe', 'ef-wrap', 'ef-lines', 'ef-path', 'ef-node', 'ef-flow']) {
      assert.ok(!inhalt.includes(alt), `${datei} enthaelt noch ${alt}`);
    }
  }
});

test('Wer Bewegung abgeschaltet hat, bekommt einen ruhigen Pfeil', () => {
  // Dieselbe Ruecksicht wie bei der Tor- und der Klima-Karte. Ein Dreieck, das still blinkt,
  // ist fuer manche Menschen keine Kleinigkeit.
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'dashboard.css'), 'utf8');
  const i = css.indexOf('prefers-reduced-motion');
  assert.ok(i > 0, 'es muss eine Regel fuer prefers-reduced-motion geben');
  assert.ok(/prefers-reduced-motion[\s\S]{0,400}ed-pfeil[\s\S]{0,200}animation: none/.test(css),
    'und sie muss den Pfeil anhalten');
});

// --- Der Hausverbrauch: gerechnet oder gemessen ---------------------------------------------

test('ohne eigenen Sensor wird der Hausverbrauch gerechnet, mit Sensor nicht', () => {
  // Die Vorgabe bleibt die Rechnung: Nur so summieren sich die Leitungen auf den Knoten in der
  // Mitte. Wer einen eigenen Sensor hat, ist damit aber besser bedient -- die Rechnung kennt
  // nur die eingetragenen Zaehler, ein Strang ohne Zaehler fehlt ihr.
  const fs = require('node:fs');
  const path = require('node:path');
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'dashboard-render.js'), 'utf8');
  const i = quelle.indexOf('const hausGemessen');
  assert.ok(i > 0, 'hausGemessen fehlt');
  const block = quelle.slice(i, i + 400);
  assert.match(block, /hausGemessen !== null \? Math\.abs\(hausGemessen\)/,
    'ein eingetragener Sensor muss gewinnen');
  assert.match(block, /solarW \|\| 0\) \+ \(netzBezugW/,
    'und ohne Angabe muss weiter gerechnet werden');
});

// --- Die Wallbox ---------------------------------------------------------------------------

const MIT_WALLBOX = { solarW: 8200, netzBezugW: 0, netzEinspeisungW: 400, hausW: 400,
  verbrauchW: 7800, wallboxW: 7400, schwelleW: 5, symbole: {} };

test('ohne wallboxW gibt es keinen vierten Knoten', () => {
  const ohne = R.energieDiagramm({ solarW: 1200, netzBezugW: 0, hausW: 1200, symbole: {} });
  assert.ok(!ohne.includes('Wallbox'));
  assert.strictEqual((ohne.match(/ed-knoten/g) || []).length, 3, 'Solar, Netz, Haus');
});

test('mit wallboxW kommt ein Knoten und eine Leitung dazu', () => {
  const svg = R.energieDiagramm(MIT_WALLBOX);
  assert.strictEqual((svg.match(/ed-knoten/g) || []).length, 4);
  assert.strictEqual((svg.match(/ed-leitung/g) || []).length, 4);
});

test('die Wallbox haengt an der NABE und links, nicht unter dem Haus', () => {
  // Umgestellt mit 1.0.27 nach der Vorlage: Das Auto ist dort ein Verbraucher neben dem Haus,
  // keiner darin. Der Platz ist fest -- ein Knoten, der je nach Anlage die Seite wechselt,
  // laesst einen bei jedem Hinsehen neu suchen.
  const svg = R.energieDiagramm(MIT_WALLBOX);
  assert.ok(svg.includes('cx="60" cy="190"'), 'der Wallbox-Ring sitzt links auf der Mittelachse');
  const pfeil = pfeilBei(svg, ...MITTE_WALLBOX);
  assert.ok(pfeil, 'die Wallbox-Leitung braucht ein Dreieck');
  assert.strictEqual(pfeil.winkel, 180, 'und es zeigt nach links, von der Nabe weg');
});

test('der Hauswert enthaelt die Wallbox NICHT -- sonst zaehlt die Grafik sie doppelt', () => {
  // Der Fehler waere nicht als Fehler zu erkennen, nur als Grafik, die sich nicht ausgeht:
  // "Haus 7,9 kW" neben "Auto 7,4 kW" bei 8 kW Einspeisung von der Solaranlage.
  const fs = require('node:fs');
  const path = require('node:path');
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'dashboard-render.js'), 'utf8');
  assert.match(quelle, /const hausRestW = wallboxW !== null \? Math\.max\(0, hausW - wallboxW\) : hausW;/,
    'der Wallbox-Strom muss aus dem Hauswert heraus');
  assert.match(quelle, /hausW: hausRestW, verbrauchW: hausW/,
    'und der GESAMTE Verbrauch muss fuer die Nabe trotzdem mitgehen');
});

test('jeder Pfad faengt mit dem SVG-Kommando M an', () => {
  // Dieselbe Falle wie bei ED_M: Ein Pfad, der nicht mit M beginnt, wird vom Browser
  // STILLSCHWEIGEND verworfen -- Knoten ohne Leitungen, keine Fehlermeldung.
  const svg = R.energieDiagramm({ ...MIT_WALLBOX, batterieW: 1500, batterieLaedt: true, batterieSoc: 70 });
  for (const p of [...svg.matchAll(/<path d="([^"]+)"/g)].map(m => m[1])) {
    assert.match(p, /^M/, p.slice(0, 40));
  }
});

test('der Hauswert steht OBEN, ueber seinem Ring', () => {
  // Das Haus ist der einzige Knoten oberhalb der Nabe; sein Text muss nach oben ausweichen,
  // sonst kreuzt er die eigene Leitung.
  const svg = R.energieDiagramm({ ...MIT_WALLBOX, hausW: 400 });
  const g = svg.split('<g class="ed-knoten').find(s => s.includes('cy="50"'));
  assert.ok(g, 'der Hausknoten fehlt');
  const y = Number(/y="(-?[\d.]+)" class="ed-wert"/.exec(g)[1]);
  assert.ok(y < 50, `der Wert muss ueber dem Ring stehen, war ${y}`);
});

test('"laedt" steht nur dran, wenn wirklich Leistung fliesst', () => {
  assert.match(R.energieDiagramm(MIT_WALLBOX), /lädt/);
  assert.ok(!/lädt/.test(R.energieDiagramm({ ...MIT_WALLBOX, wallboxW: 0 })),
    'eine stehende Wallbox laedt nicht');
  assert.ok(!/lädt/.test(R.energieDiagramm({ ...MIT_WALLBOX, wallboxW: 3 })),
    'und 3 W sind Eigenverbrauch, kein Laden');
});

test('0 W ist ein Wert, kein fehlender Knoten', () => {
  // Number(null) ist 0 -- dieselbe Falle wie in akkuStufe(). Eine Wallbox, die gerade nicht
  // laedt, muss trotzdem zu sehen sein: Sonst verschwindet sie jedes Mal, wenn das Auto weg ist.
  const svg = R.energieDiagramm({ ...MIT_WALLBOX, wallboxW: 0 });
  assert.strictEqual((svg.match(/ed-knoten/g) || []).length, 4);
});
