// Das Energiefluss-Diagramm.
//
// Eine reine Funktion: rein die Leistungen, raus die SVG. Genau deshalb ist hier pruefbar, was
// sonst nur am Geraet aufgefallen waere -- und einmal schon aufgefallen IST.

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

test('Jeder Leitungspfad beginnt mit dem SVG-Kommando M', () => {
  // DER Test dieser Datei. Beim Umbenennen der Konstanten wurde das fuehrende `M` des
  // Pfadstrings mitumbenannt ("ED_M200,148"). Der Browser verwirft so einen Pfad
  // STILLSCHWEIGEND: getTotalLength() gibt 0, es gibt keine Fehlermeldung, und die Karte zeigt
  // Knoten ohne eine einzige Leitung. Von aussen sieht das aus wie ein Gestaltungsfehler.
  const svg = mach({ solarW: 4000, netzBezugW: 200, netzEinspeisungW: 0, hausW: 4200,
    batterieW: 500, batterieLaedt: true });
  const p = pfade(svg);
  assert.ok(p.length >= 3, 'es muessen Leitungen gezeichnet werden: ' + p.length);
  for (const d of p) {
    assert.match(d, /^M-?[\d.]+,-?[\d.]+ Q-?[\d.]+,-?[\d.]+ -?[\d.]+,-?[\d.]+$/,
      'kein gueltiger Pfad: ' + d);
  }
});

test('Ohne Batterie ist die Zeichnung niedriger', () => {
  // Sonst bleibt bei drei Knoten unten ein Feld leer, und die Karte sieht aus wie zu einem
  // Drittel ungenutzt -- die Zeichnung wird ja auf die Hoehe eingepasst.
  const hoehe = (svg) => Number(/viewBox="0 -?\d+ \d+ (\d+)"/.exec(svg)[1]);
  const ohne = hoehe(mach({ solarW: 1000, netzBezugW: 10, hausW: 1010 }));
  const mit = hoehe(mach({ solarW: 1000, netzBezugW: 10, hausW: 1010, batterieW: 100 }));
  assert.ok(mit > ohne + 80, `mit ${mit} / ohne ${ohne}`);
});

test('Unter der Schwelle fliesst nichts', () => {
  // Ein Wechselrichter, der nachts 30 W Eigenverbrauch meldet, darf die Leitung nicht die
  // ganze Nacht leuchten lassen.
  const ruhig = mach({ solarW: 3, netzBezugW: 2, netzEinspeisungW: 0, hausW: 5, schwelleW: 5 });
  assert.strictEqual((ruhig.match(/ed-fliesst/g) || []).length, 0, 'keine Leitung darf fliessen');
  const laut = mach({ solarW: 300, netzBezugW: 2, netzEinspeisungW: 0, hausW: 302, schwelleW: 5 });
  assert.ok((laut.match(/ed-fliesst/g) || []).length > 0);
});

test('Der Netzknoten zeigt den Betrag, die Richtung steht im Namen', () => {
  // Ein Minuszeichen vor einer Zahl liest man aus fuenf Metern nicht.
  const rein = mach({ solarW: 0, netzBezugW: 840, netzEinspeisungW: 0, hausW: 840 });
  assert.match(rein, /840 W/);
  assert.match(rein, /Netz · Bezug|NETZ · BEZUG|Netz &#183; Bezug/i);
  const raus = mach({ solarW: 4000, netzBezugW: 0, netzEinspeisungW: 2600, hausW: 1400 });
  assert.match(raus, /2,60 kW/, 'der Betrag, nicht -2,60');
  assert.ok(!raus.includes('-2,60'), 'kein Minuszeichen');
  assert.match(raus, /Einspeisung/);
});

test('Fehlende Zweige werden weggelassen, nicht mit Null gezeichnet', () => {
  const ohneSolar = mach({ netzBezugW: 1240, netzEinspeisungW: 0, hausW: 1240 });
  assert.ok(!/ed-knoten[^]*?Solar/.test(ohneSolar) || !ohneSolar.includes('>Solar<'),
    'ohne Solarsensor darf kein Solarknoten erscheinen');
  const mitSolar = mach({ solarW: 0, netzBezugW: 1240, netzEinspeisungW: 0, hausW: 1240 });
  assert.ok(mitSolar.includes('>Solar<'), 'mit Sensor erscheint er, auch bei 0 W');
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

test('Jede Klasse im Diagramm hat eine Regel im CSS', () => {
  // Dieser Test haette beide Unfaelle von heute gefangen. Beim Umbenennen der Konstanten traf
  // das Muster auch die KLASSENNAMEN in den Zeichenketten: aus `ed-symbol` wurde
  // `ed-edSymbol`, aus `ed-knoten` wurde `ed-edKnoten`. Es gab keinen Fehler -- das Element
  // war da, nur ohne Gestaltung. Genau die Sorte Schaden, die man erst auf der Wand sieht.
  //
  // Die Gegenrichtung zaehlt mit: Eine CSS-Regel, die niemand benutzt, ist dasselbe wie eine,
  // die es nicht gibt (siehe CLAUDE.md, gauge.baseColor).
  const fs = require('node:fs');
  const path = require('node:path');
  const wurzel = path.join(__dirname, '..', 'renderer', 'shared');
  const js = fs.readFileSync(path.join(wurzel, 'dashboard-render.js'), 'utf8');
  const css = fs.readFileSync(path.join(wurzel, 'dashboard.css'), 'utf8');

  const teil = js.slice(js.indexOf('Energiefluss-Diagramm ---'), js.indexOf('const ICONS = {'));
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

test('Die alte Energiekarte ist restlos weg', () => {
  // Die Vorgaengerin setzte Knoten per CSS ueber ein verzerrtes SVG. Bleibt davon eine Regel
  // stehen, gestaltet sie irgendwann wieder mit -- und niemand weiss, woher.
  const fs = require('node:fs');
  const path = require('node:path');
  const wurzel = path.join(__dirname, '..', 'renderer', 'shared');
  for (const datei of ['dashboard-render.js', 'dashboard.css']) {
    const inhalt = fs.readFileSync(path.join(wurzel, datei), 'utf8');
    for (const alt of ['ef-wrap', 'ef-lines', 'ef-path', 'ef-node', 'ef-flow']) {
      assert.ok(!inhalt.includes(alt), `${datei} enthaelt noch ${alt}`);
    }
  }
});

test('Staerke und Tempo richten sich nach der Leistung', () => {
  // Der Unterschied zwischen einer Grafik, die Zahlen zeigt, und einer, an der man im
  // Vorbeigehen sieht, dass etwas passiert.
  const wert = (w) => {
    const svg = mach({ solarW: w, netzBezugW: 0, netzEinspeisungW: 0, hausW: w });
    const m = /stroke-width:([\d.]+)px;stroke-dasharray:[\d.]+ [\d.]+;animation-duration:([\d.]+)s/.exec(svg);
    assert.ok(m, 'kein Stil an der Leitung: ' + svg.slice(0, 200));
    return { dicke: Number(m[1]), dauer: Number(m[2]) };
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
  assert.ok(unten > 1, 'die kleinen Werte muessen sich unterscheiden: ' + unten);
  assert.ok(oben > 0.8, 'die grossen auch: ' + oben);
  assert.ok(unten / oben < 4 && oben / unten < 4,
    `die Schritte liegen zu weit auseinander -- das ist keine log-Skala: ${unten} / ${oben}`);
});

test('Eine ruhende Leitung bleibt duenn und ohne Muster', () => {
  // Sie zeigt, dass der Weg da ist, nicht dass etwas fliesst.
  const svg = mach({ solarW: 2, netzBezugW: 1, netzEinspeisungW: 0, hausW: 3, schwelleW: 5 });
  assert.ok(!svg.includes('ed-fliesst'), 'nichts darf fliessen');
  assert.ok(!svg.includes('stroke-dasharray'), 'und kein Strichmuster tragen');
});
