const {
  defaultCardType, defaultSize, sizeToSpan, clampSpan, resolveSpan, buildCard,
  CARD_TYPES, ICONS, domainsForType, minSpanFor
} = DashboardRender;
const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);
const DASHBOARD_ID = params.get('dashboard') || 'main'; // 'main' = normales Dashboard, sonst Unterdashboard-ID

// Die Uhr-Karte ist seit dem Wegfall der Kopfzeile der einzige Weg, Uhrzeit und Datum aufs
// Dashboard zu bekommen -- und zwar dort, wo der Nutzer sie haben will, statt fest oben in
// einer Leiste.
const PICKER_TYPES = Object.keys(CARD_TYPES);

// Feste, bildschirmgrosse Arbeitsflaeche: 4 Spalten x MAX_ROWS Zeilen a 14vh -- entspricht
// in etwa dem, was auf dem echten Wall Display ohne Scrollen sichtbar ist. Karten koennen
// nicht mehr darueber hinaus platziert werden -- nichts kann mehr "nach unten verschwinden".
const MAX_ROWS = 6;

let currentLayout = []; // [{ entity_id, order, card_type, cols, rows, x, y, settings }]
let statesById = {};
let historyCache = {};
let forecastCache = {};
let allEntities = [];
let haNamen = {};
let allDashboards = []; // [{id,name}] fuer Navigations-Karten
let currentSunEntity = '';
let settingsEntityId = null;
let settingsFields = {};
let settingsThresholds = [];
let pickerType = null;
let duplicateSourceId = null; // gesetzt waehrend "Karte kopieren"-Ablauf
let isDirty = false; // true sobald ungespeicherte Aenderungen vorliegen -> eigene Verlassen-Warnung
function markDirty() { isDirty = true; }

async function loadAll() {
  const [configRes, entitiesRes, dashboardsRes, namenRes] = await Promise.all([
    fetch('/api/config').then(r => r.json()),
    fetch('/api/entities').then(r => r.json()),
    fetch('/api/dashboards').then(r => r.json()).catch(() => ({ ok: false })),
    // Die kurzen Namen aus der Entitaetsregistrierung -- dieselben, die Home Assistant in
    // seiner eigenen Oberflaeche zeigt. Ohne sie steht hier ueberall der Geraetename davor.
    fetch('/api/ha/namen').then(r => r.json()).catch(() => ({ ok: false }))
  ]);
  haNamen = (namenRes && namenRes.ok && namenRes.namen) ? namenRes.namen : {};
  allDashboards = dashboardsRes.ok ? dashboardsRes.dashboards : [];
  currentSunEntity = configRes.sunEntity || '';
  DashboardRender.applyCustomTheme(configRes.customTheme || DashboardRender.DEFAULT_THEME);
  allEntities = (entitiesRes.ok ? entitiesRes.entities : [])
    .map(e => Object.assign({}, e, { name: haNamen[e.entity_id] || e.name }));

  if (DASHBOARD_ID === 'main') {
    $('title').textContent = 'Wall Display – Karten einrichten (' + (configRes.title || 'Wall Display') + ')';
    currentLayout = (configRes.layout || []).length
      ? configRes.layout.map(l => ({ ...l }))
      : (configRes.entities || []).map((id, i) => ({ entity_id: id, order: i }));
  } else {
    const dRes = await fetch(`/api/dashboards/${DASHBOARD_ID}`).then(r => r.json());
    const dash = dRes.ok ? dRes.dashboard : { name: 'Dashboard', layout: [] };
    $('title').textContent = 'Unterdashboard einrichten (' + (dash.name || 'Dashboard') + ')';
    currentLayout = (dash.layout || []).map(l => ({ ...l }));
  }
  assignMissingPositions();
  await refreshStates();
}

// Weist jeder Karte ohne feste Position (z.B. aus einer alten Konfiguration vor diesem
// Umbau) automatisch die erste freie Stelle zu, damit von Anfang an alles innerhalb der
// festen Arbeitsflaeche liegt.
function assignMissingPositions() {
  currentLayout.forEach(entry => {
    // Die Karte der unteren Leiste hat absichtlich KEIN x/y. Bekaeme sie hier eines
    // zugewiesen, waere sie ploetzlich eine Rasterkarte mit einem Platz, den sie nie
    // benutzt -- und den sie niemandem wegnimmt, aber der Eintrag waere trotzdem falsch.
    if (entry.unterleiste) return;
    if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y)) {
      const type = entry.card_type || defaultCardType(entry.entity_id, statesById[entry.entity_id]);
      const span = clampSpan(entry.cols && entry.rows ? { cols: entry.cols, rows: entry.rows } : sizeToSpan(defaultSize(type)), type);
      const pos = findFreeSpot(span.cols, span.rows, type);
      // Kein Platz mehr: Die Karte bleibt ohne Position stehen, statt eine andere zu
      // ueberdecken. Beim naechsten Aufraeumen bekommt sie eine.
      if (!pos) return;
      entry.cols = pos.cols;
      entry.rows = pos.rows;
      entry.x = pos.x;
      entry.y = pos.y;
    }
  });
}

// Groesse des Panels holen -- daraus bekommt die Arbeitsflaeche ihr Seitenverhaeltnis.
window.panelGroesse = null;
// Die Arbeitsflaeche haengt an der Fenstergroesse -- beim Drehen eines Tablets oder beim
// Verkleinern des Browserfensters muss sie neu gerechnet werden.
window.addEventListener('resize', () => arbeitsflaecheAnpassen());
fetch('/api/config').then(r => r.json()).then(c => {
  window.panelGroesse = c && c.panelGroesse;
  if (window.panelGroesse) arbeitsflaecheAnpassen();
}).catch(() => { /* dann eben ohne */ });

async function refreshStates() {
  const r = await fetch('/api/ha/states');
  const data = await r.json();
  if (data.ok) statesById = Object.fromEntries(data.states.map(s => [s.entity_id, s]));
  applyTheme();
  await render();
}

function applyTheme() {
  if (!currentSunEntity) { document.body.classList.remove('light-theme'); return; }
  const s = statesById[currentSunEntity];
  if (!s) return;
  const isDay = s.state === 'above_horizon' || s.state === 'on';
  document.body.classList.toggle('light-theme', isDay);
}

async function ensureHistory(entityId, stunden) {
  if (historyCache[entityId]) return historyCache[entityId];
  try {
    const r = await fetch(`/api/ha/history?entity_id=${encodeURIComponent(entityId)}&hours=${Number(stunden) > 0 ? Number(stunden) : 24}`);
    const data = await r.json();
    historyCache[entityId] = data.ok ? data.series : [];
  } catch (e) {
    historyCache[entityId] = [];
  }
  return historyCache[entityId];
}

async function ensureForecast(entityId, forecastType) {
  const cacheKey = `${entityId}:${forecastType || 'auto'}`;
  if (forecastCache[cacheKey]) return forecastCache[cacheKey];
  try {
    const typeParam = forecastType ? `&type=${encodeURIComponent(forecastType)}` : '';
    const r = await fetch(`/api/ha/forecast?entity_id=${encodeURIComponent(entityId)}${typeParam}`);
    const data = await r.json();
    if (data.ok && Array.isArray(data.forecast) && data.forecast.length) {
      forecastCache[cacheKey] = { forecast: data.forecast, error: '' };
      return forecastCache[cacheKey];
    }
    return { forecast: [], error: data.error || 'Keine Vorhersagedaten' };
  } catch (e) {
    return { forecast: [], error: String(e.message || e) };
  }
}

let wasteCache = {};
async function ensureWasteEvents(entityId) {
  if (wasteCache[entityId]) return wasteCache[entityId];
  try {
    const r = await fetch(`/api/ha/calendar-events?entity_id=${encodeURIComponent(entityId)}&days=60`);
    const data = await r.json();
    if (data.ok && Array.isArray(data.events) && data.events.length) {
      wasteCache[entityId] = { events: data.events, error: '' };
      return wasteCache[entityId];
    }
    return { events: [], error: data.error || 'Keine Termine gefunden' };
  } catch (e) {
    return { events: [], error: String(e.message || e) };
  }
}

// Prueft, ob eine Karte geometrisch eine Foto-Bereich-Karte ueberlappt (fuer den
// automatischen Glas-Effekt) -- nur relevant fuer Kartentypen, die das ueberhaupt duerfen.
function findOverlappingPhoto(entry) {
  if (!DashboardRender.canOverlayOnPhoto(entry.card_type)) return null;
  return currentLayout.find(o =>
    o.card_type === 'photo' && o.entity_id !== entry.entity_id &&
    rectsOverlap(entry.x || 0, entry.y || 0, entry.cols || 1, entry.rows || 1, o.x || 0, o.y || 0, o.cols || 1, o.rows || 1)
  ) || null;
}

// Die Unterleiste ist genau eine Karte und sitzt nicht im Raster -- sie laesst sich weder
// ziehen noch in der Groesse aendern, sie fuellt immer den ganzen Streifen. Deshalb hier ein
// eigener kleiner Aufbau statt der Rasterlogik.
let unterleisteWahl = false;   // gesetzt, solange die Auswahl fuer die Unterleiste offen ist

/**
 * Arbeitsflaeche im Seitenverhaeltnis des echten Panels.
 *
 * Der Editor laeuft auf einem anderen Geraet. Ohne diese Anpassung zieht man Karten auf einem
 * breiten Notebook zurecht und stellt erst auf der Wand fest, dass alles anders aussitzt --
 * "ich kann nicht sehen, wieviel Platz ich auf dem Surface Go hab".
 */
function arbeitsflaecheAnpassen() {
  const rahmen = $('panelFlaeche');
  const g = $('grid');
  const leiste = $('unterleisteCanvas');
  const hinweis = $('platzHinweis');
  if (!rahmen || !g || !leiste) return;

  const p = (window.panelGroesse || null);
  // Ohne Angabe vom Panel das Verhaeltnis des Rasters selbst -- besser als gar keine Flaeche.
  const verhaeltnis = (p && p.breite && p.hoehe) ? (p.breite / p.hoehe) : (4 / 3);

  // Zuerst die HOEHE bestimmen, dann die Breite. Andersherum wird die Flaeche bei einer
  // breiten Seite hoeher als das Fenster, und unten ist alles abgeschnitten -- genau das
  // war der Fehler in 1.17.0.
  // Untergrenze, damit ein sehr schmales Fenster (Handy quer, angedockter Browser) die
  // Flaeche nicht auf Briefmarkengroesse zusammenfallen laesst -- dann lieber scrollen.
  const platzBreite = Math.max(300,
    (rahmen.parentElement ? rahmen.parentElement.clientWidth : window.innerWidth) - 8);
  const obenWeg = rahmen.getBoundingClientRect().top;
  // Was unter der Flaeche noch sichtbar bleiben muss: Hinweiszeile und Kartenliste.
  // So gross wie moeglich. Der Editor ist Arbeitsflaeche -- hier wird gezogen und
  // eingeordnet, und dafuer braucht es Platz. Unter ihr bleibt nur die Hinweiszeile stehen;
  // die Kartenliste ist eingeklappt und darf ruhig unterhalb der Falz beginnen.
  const platzHoehe = Math.max(300, window.innerHeight - obenWeg - 60);

  const breite = Math.min(platzBreite, platzHoehe * verhaeltnis);
  const hoehe = breite / verhaeltnis;

  rahmen.style.width = Math.round(breite) + 'px';
  rahmen.style.height = Math.round(hoehe) + 'px';

  // Dieselbe Aufteilung wie auf dem Geraet: sechs Zeilen a 14vh plus Abstaende sind rund
  // 90 % der Hoehe, der Streifen bekommt den Rest.
  const innen = Math.round(hoehe) - 12;
  g.style.height = Math.round(innen * 0.895) + 'px';
  leiste.style.height = Math.round(innen * 0.105) + 'px';

  if (hinweis) {
    hinweis.textContent = p && p.breite
      ? `Arbeitsfläche im Seitenverhältnis des Panels (${p.breite} × ${p.hoehe}`
        + (p.skalierung && p.skalierung !== 1 ? `, ${Math.round(p.skalierung * 100)} % Skalierung` : '')
        + '). Unten der Streifen für die Uhr. Was hier passt, passt dort auch.'
      : 'Unten der Streifen für die Uhr.';
  }

}


/**
 * Liste aller Karten, mit Einstellungen und Entfernen.
 *
 * Der eigentliche Grund: Auf der Arbeitsflaeche kann eine Karte hinter einer anderen liegen
 * oder so gross gezogen sein, dass man ihre Knoepfe nicht mehr trifft -- dann kommt man an
 * sie nicht mehr heran und kann sie nicht einmal loeschen. Hier kommt man immer heran.
 */
function kartenListeRendern() {
  const el = $('kartenListe');
  if (!el) return;
  const eintraege = currentLayout.slice();
  if (!eintraege.length) {
    el.innerHTML = '<p style="font-size:1.1vh; color:var(--muted);">Noch keine Karten.</p>';
    return;
  }
  el.innerHTML = eintraege.map((e, i) => {
    const typ = e.card_type || defaultCardType(e.entity_id, statesById[e.entity_id]);
    const label = (e.settings && e.settings.name)
      || haNamen[e.entity_id]
      || ((statesById[e.entity_id] || {}).attributes || {}).friendly_name
      || e.entity_id;
    const platz = e.unterleiste ? 'untere Leiste' : `${e.cols || 1}×${e.rows || 1} bei ${e.x || 0},${e.y || 0}`;
    return `
      <div style="display:flex; align-items:center; gap:0.6vh; margin-bottom:0.4vh;">
        <span style="flex:1; font-size:1.2vh; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${label}</span>
        <span style="flex:0 0 auto; font-size:1.05vh; color:var(--muted);">${(CARD_TYPES[typ] || {}).label || typ}</span>
        <span style="flex:0 0 auto; font-size:1.05vh; color:var(--muted);">${platz}</span>
        <button type="button" class="kl-set" data-i="${i}" style="width:auto; padding:0 1vh; margin:0;" title="Einstellungen">⚙</button>
        <button type="button" class="kl-del" data-i="${i}" style="width:auto; padding:0 1.2vh; margin:0; background:#dc3545;" title="Entfernen">×</button>
      </div>`;
  }).join('');
  el.querySelectorAll('.kl-set').forEach(b => b.addEventListener('click', () => {
    openSettings(eintraege[+b.dataset.i].entity_id);
  }));
  el.querySelectorAll('.kl-del').forEach(b => b.addEventListener('click', () => {
    const e = eintraege[+b.dataset.i];
    fotosWegraeumen(e);
    currentLayout = currentLayout.filter(x => x !== e);
    markDirty();
    render();
  }));
}

async function unterleisteRendern() {
  const el = $('unterleisteCanvas');
  if (!el) return;
  const entry = currentLayout.find(e => e.unterleiste);
  el.innerHTML = '';

  if (!entry) {
    el.innerHTML = `<button type="button" id="unterleisteAdd">+ Uhr oder andere Karte</button>`;
    $('unterleisteAdd').addEventListener('click', () => { unterleisteWahl = true; openPicker(); });
    return;
  }

  const state = statesById[entry.entity_id];
  const type = entry.card_type || defaultCardType(entry.entity_id, state);
  let history;
  if (type === 'graph' || type === 'gauge') history = await ensureHistory(entry.entity_id, (entry.settings || {}).graphHours);

  const card = buildCard(entry.entity_id, state, type, { cols: 1, rows: 1 }, {
    editable: true, freeMove: false, history, apiBase: '', settings: entry.settings || {}, statesById,
    namen: haNamen
  });
  card.style.flex = '1';
  el.appendChild(card);

  const leiste = document.createElement('div');
  leiste.style.cssText = 'display:flex; flex-direction:row; gap:0.3vh; align-items:center; '
    + 'margin-left:0.4vh; flex:0 0 auto;';
  leiste.innerHTML = `
    <button type="button" id="unterleisteSet" style="width:auto; padding:0 1vh; margin:0;" title="Einstellungen">⚙</button>
    <button type="button" id="unterleisteDel" style="width:auto; padding:0 1vh; margin:0; background:#dc3545;" title="Entfernen">×</button>`;
  el.appendChild(leiste);
  $('unterleisteSet').addEventListener('click', () => openSettings(entry.entity_id));
  $('unterleisteDel').addEventListener('click', () => {
    currentLayout = currentLayout.filter(e => e !== entry);
    markDirty();
    render();
  });
}

async function render() {
  const grid = $('grid');
  grid.innerHTML = '';
  arbeitsflaecheAnpassen();
  await unterleisteRendern();
  kartenListeRendern();
  // Dieselben Farben wie auf der Wand -- der Editor soll zeigen, was dort steht, und nicht
  // etwas, das man erst am Panel sieht.
  const sensorFarben = DashboardRender.sensorAkzente(currentLayout
    .filter(e => (e.card_type || defaultCardType(e.entity_id, statesById[e.entity_id])) === 'sensor')
    .map(e => e.entity_id), document.body.classList.contains('light-theme'));
  for (const entry of currentLayout.filter(e => !e.unterleiste)) {
    const state = statesById[entry.entity_id];
    const type = entry.card_type || defaultCardType(entry.entity_id, state);
    const span = resolveSpan(entry, type);
    let history, forecast, forecastError, energy, waste, wasteError;
    if (type === 'graph' || type === 'gauge') history = await ensureHistory(entry.entity_id, (entry.settings || {}).graphHours);
    if (type === 'forecast') { const fr = await ensureForecast(entry.entity_id, (entry.settings || {}).forecastType); forecast = fr.forecast; forecastError = fr.error; }
    if (type === 'waste') { const wr = await ensureWasteEvents(entry.entity_id); waste = wr.events; wasteError = wr.error; }
    if (type === 'energy') {
      const es = entry.settings || {};
      energy = {
        grid: statesById[es.gridEntity], gridReturn: statesById[es.gridReturnEntity],
        solar: statesById[es.solarEntity], battery: statesById[es.batteryEntity],
        batterySoc: statesById[es.batterySocEntity]
      };
    }
    const card = buildCard(entry.entity_id, state, type, span, {
      editable: true,
      freeMove: true,
      history,
      forecast,
      forecastError,
      energy,
      waste,
      wasteError,
      apiBase: '',
      photoVersion: type === 'photo' ? (entry.settings || {}).photoVersion : null,
      onPhoto: !!findOverlappingPhoto(entry),
      settings: entry.settings || {},
      namen: haNamen,
      akzent: sensorFarben[entry.entity_id],
      callbacks: {
        onRemove: removeEntity,
        onChangeType: changeType,
        onResizeStart: onResizeStart,
        onOpenSettings: openSettings,
        onDuplicate: duplicateCard,
        onMoveStart: onMoveStart
      }
    });
    grid.appendChild(card);
  }
  // Das Plus nur zeigen, wenn wirklich noch Platz ist. Vorher rutschte es weiter, sobald
  // eine Karte groesser gezogen wurde, und stand am Ende in einer Zeile, die es auf dem
  // Panel gar nicht mehr gibt -- ein Knopf, der etwas anbietet, das nicht geht.
  const frei = findFreeSpot(1, 1, 'sensor');
  if (frei) {
    const addTile = document.createElement('div');
    addTile.className = 'card add-tile';
    addTile.textContent = '+';
    addTile.style.gridColumn = (frei.x + 1) + ' / span 1';
    addTile.style.gridRow = (frei.y + 1) + ' / span 1';
    addTile.addEventListener('click', openPicker);
    grid.appendChild(addTile);
  }
}

// --- Feste Arbeitsflaeche: Kollisionspruefung + freie Platzsuche, begrenzt auf 4xMAX_ROWS ---
function rectsOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
  return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
}

function collidesAt(entityId, x, y, cols, rows, type) {
  // Die Karte der Unterleiste sitzt nicht im Raster -- sie hat kein x/y und wuerde sonst
  // bei 0,0 als Hindernis gelten.
  const others = currentLayout.filter(l => l.entity_id !== entityId && !l.unterleiste);
  return others.some(o => {
    if (!rectsOverlap(x, y, cols, rows, o.x || 0, o.y || 0, o.cols || 1, o.rows || 1)) return false;
    // Erlaubte Ueberlappung: eine Foto-Bereich-Karte mit einer dafuer zugelassenen Karte
    // (z.B. Media Player, Wetter) -- in beide Richtungen geprueft, je nachdem wer "die
    // Foto-Karte" von beiden ist.
    if (o.card_type === 'photo' && DashboardRender.canOverlayOnPhoto(type)) return false;
    if (type === 'photo' && DashboardRender.canOverlayOnPhoto(o.card_type)) return false;
    return true;
  });
}

/**
 * Der erste freie Platz fuer eine Karte dieser Groesse, oder null.
 *
 * Frueher wurde bei vollem Raster die letzte Zeile als "Notloesung" zurueckgegeben. Das legte
 * die neue Karte einfach AUF eine vorhandene -- man druckte auf +, bekam eine Karte, die halb
 * unter einer anderen lag, und musste erst merken, dass da zwei sind. Lieber ehrlich sagen,
 * dass kein Platz mehr ist.
 *
 * Zweiter Versuch mit einer kleineren Karte: Eine grosse Vorgabegroesse soll nicht daran
 * scheitern, dass nur noch ein Feld frei ist.
 */
function findFreeSpot(cols, rows, type) {
  const suche = (c, r) => {
    for (let y = 0; y <= MAX_ROWS - r; y++) {
      for (let x = 0; x <= 4 - c; x++) {
        if (!collidesAt(null, x, y, c, r, type)) return { x, y, cols: c, rows: r };
      }
    }
    return null;
  };
  const min = minSpanFor(type);
  for (let c = cols; c >= Math.max(1, min.cols); c--) {
    for (let r = rows; r >= Math.max(1, min.rows); r--) {
      const platz = suche(c, r);
      if (platz) return platz;
    }
  }
  return null;
}

function clampAgainstOthers(entityId, x, y, cols, rows, type) {
  const min = minSpanFor(type);
  let c = cols, r = rows;
  while (c > min.cols && (x + c > 4 || collidesAt(entityId, x, y, c, r, type))) c--;
  while (r > min.rows && (y + r > MAX_ROWS || collidesAt(entityId, x, y, c, r, type))) r--;
  return { cols: c, rows: r };
}

// Die Bilder einer Foto-Karte liegen auf der Platte, nicht im Layout. Verschwindet die Karte
// -- geloescht oder auf einen anderen Typ umgestellt -- blieben sie bisher liegen: unsichtbar,
// unauffindbar, und bei Urlaubsfotos in voller Aufloesung schnell dreistellig in Megabyte.
async function fotosWegraeumen(entry) {
  if (!entry || entry.card_type !== 'photo') return;
  const st = entry.settings || {};
  const anzahl = Array.isArray(st.photoBilder) ? st.photoBilder.length : (st.photoVersion ? 1 : 0);
  for (let n = 0; n < anzahl; n++) {
    const id = n === 0 ? entry.entity_id : entry.entity_id + '__' + (n + 1);
    // Fehler hier duerfen den Loeschvorgang nicht aufhalten -- die Karte soll weg, auch wenn
    // die Datei schon nicht mehr da war.
    try {
      await fetch(`/api/photo-card/${encodeURIComponent(id)}/background/remove`, { method: 'POST' });
    } catch (e) { /* Datei war ohnehin nicht mehr da */ }
  }
}

function removeEntity(id) {
  const entry = currentLayout.find(l => l.entity_id === id);
  fotosWegraeumen(entry);
  currentLayout = currentLayout.filter(l => l.entity_id !== id);
  markDirty();
  render();
}

function changeType(id, newType) {
  const entry = currentLayout.find(l => l.entity_id === id);
  if (!entry) return;
  if (entry.card_type === 'photo' && newType !== 'photo') fotosWegraeumen(entry);
  entry.card_type = newType;
  const span = clampAgainstOthers(id, entry.x || 0, entry.y || 0, sizeToSpan(defaultSize(newType)).cols, sizeToSpan(defaultSize(newType)).rows, newType);
  entry.cols = span.cols;
  entry.rows = span.rows;
  delete entry.size;
  entry.settings = {};
  markDirty();
  render();
}

// --- Karte kopieren: gleicher Typ/Groesse/Einstellungen, nur neue Entitaet abfragen ----
function duplicateCard(id) {
  const entry = currentLayout.find(l => l.entity_id === id);
  if (!entry) return;
  duplicateSourceId = id;
  const type = entry.card_type || defaultCardType(id, statesById[id]);
  $('picker').classList.add('show');
  showEntityStep(type);
  $('pickerTitle').textContent = CARD_TYPES[type].label + ' kopieren – neue Entität wählen';
}

// --- Karte frei verschieben (Griff) -- bleibt danach exakt an der Stelle liegen ---------
function onMoveStart(entityId, cardEl, startEvent) {
  const entry = currentLayout.find(l => l.entity_id === entityId);
  if (!entry) return;
  const grid = $('grid');
  const gridRect = grid.getBoundingClientRect();
  const cs = getComputedStyle(grid);
  const colGap = parseFloat(cs.columnGap) || 0;
  const rowGap = parseFloat(cs.rowGap) || 0;
  const rowH = parseFloat(cs.gridAutoRows) || 100;
  const colW = (gridRect.width - colGap * 3) / 4;

  const cols = entry.cols || 1;
  const rows = entry.rows || 1;
  const startGX = entry.x || 0;
  const startGY = entry.y || 0;
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  cardEl.classList.add('moving');

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const deltaCols = Math.round(dx / (colW + colGap));
    const deltaRows = Math.round(dy / (rowH + rowGap));
    const newX = Math.max(0, Math.min(4 - cols, startGX + deltaCols));
    const newY = Math.max(0, Math.min(MAX_ROWS - rows, startGY + deltaRows));
    if (collidesAt(entityId, newX, newY, cols, rows, entry.card_type)) return; // bliebe kollidierend -- Karte "klebt"
    entry.x = newX;
    entry.y = newY;
    cardEl.style.gridColumn = `${newX + 1} / span ${cols}`;
    cardEl.style.gridRow = `${newY + 1} / span ${rows}`;
    cardEl.dataset.x = newX;
    cardEl.dataset.y = newY;
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    cardEl.classList.remove('moving');
    markDirty();
    render();
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// --- Freies Groessenziehen (Ecke unten rechts) -- begrenzt auf Bildschirm + Kollision ---
function onResizeStart(entityId, cardEl, startEvent) {
  const entry = currentLayout.find(l => l.entity_id === entityId);
  if (!entry) return;
  const type = entry.card_type || defaultCardType(entityId, statesById[entityId]);
  const grid = $('grid');
  const gridRect = grid.getBoundingClientRect();
  const cs = getComputedStyle(grid);
  const colGap = parseFloat(cs.columnGap) || 0;
  const rowGap = parseFloat(cs.rowGap) || 0;
  const rowH = parseFloat(cs.gridAutoRows) || 100;
  const colW = (gridRect.width - colGap * 3) / 4;

  const startCols = parseInt(cardEl.dataset.cols, 10) || 1;
  const startRows = parseInt(cardEl.dataset.rows, 10) || 1;
  const fixedX = entry.x || 0;
  const fixedY = entry.y || 0;
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  cardEl.classList.add('resizing');

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const deltaCols = Math.round(dx / (colW + colGap));
    const deltaRows = Math.round(dy / (rowH + rowGap));
    let span = clampSpan({ cols: startCols + deltaCols, rows: startRows + deltaRows }, type);
    span = clampAgainstOthers(entityId, fixedX, fixedY, span.cols, span.rows, type);
    cardEl.style.gridColumn = `${fixedX + 1} / span ${span.cols}`;
    cardEl.style.gridRow = `${fixedY + 1} / span ${span.rows}`;
    cardEl.dataset.cols = span.cols;
    cardEl.dataset.rows = span.rows;
    entry.cols = span.cols;
    entry.rows = span.rows;
    delete entry.size;
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    cardEl.classList.remove('resizing');
    markDirty();
    render();
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// --- Karten-Einstellungen ----------------------------------------------------------------
// Der Farbwaehler kann kein "leer" darstellen. Dieser Merker haelt fest, dass der Nutzer
// den Standard-Knopf gedrueckt hat -- sonst waere die Grundfarbe nach dem ersten Oeffnen der
// Einstellungen unwiderruflich auf den Vorgabewert festgenagelt.
let settingsBaseColorEntfernt = false;

function settingsFieldsForType(type) {
  // humidity und climate fehlten hier, obwohl beide settings.suffix lesen -- das Feld war im
  // Editor schlicht nicht erreichbar.
  const withSuffix = ['gauge', 'graph', 'wind', 'rain', 'temperature', 'sensor', 'pressure', 'humidity', 'solar', 'climate'];
  // Nachkommastellen ergeben nur dort Sinn, wo ueberhaupt eine Zahl gross dasteht.
  const mitZahl = ['gauge', 'graph', 'wind', 'rain', 'temperature', 'sensor', 'pressure', 'humidity', 'solar'];
  // Karten ohne eigenes Symbol (Uhr, Foto, Kacheln, Energiefluss, Media Player) haben nichts
  // zu tauschen -- ein Auswahlfeld dort waere eine Einstellung ohne Wirkung.
  const ohneSymbol = ['clock', 'photo', 'quicktiles', 'energy', 'media_player', 'navigate', 'gate', 'light', 'switch', 'climate', 'cover', 'lock', 'fluegeltor'];
  // Karten ohne Home-Assistant-Entitaet (Uhr, Energiefluss, Foto, Kacheln, Wechsel-Karte)
  // haben nichts zu tauschen -- sie tragen eine selbst vergebene Kennung.
  const ohneEntitaet = ['clock', 'energy', 'photo', 'quicktiles', 'navigate'];
  return {
    entitaetWechseln: !ohneEntitaet.includes(type),
    decimals: mitZahl.includes(type),
    // Innen/aussen nur dort, wo dieselbe Messgroesse an beiden Orten vorkommt -- die Liste
    // steht im Renderer, damit Editor und Karte nicht auseinanderlaufen.
    ortWahl: DashboardRender.ORT_TYPEN.includes(type),
    verlaufOpts: mitZahl.includes(type) && type !== 'graph' && type !== 'gauge',
    iconWahl: !ohneSymbol.includes(type),
    radarOpts: type === 'radar',
    clockOpts: type === 'clock',
    name: type !== 'navigate',
    suffix: withSuffix.includes(type),
    gaugeExtras: type === 'gauge',
    navigateTarget: type === 'navigate',
    forecastType: type === 'forecast',
    energyEntities: type === 'energy',
    torDauerauf: type === 'fluegeltor',
    mediaPlayerOpts: type === 'media_player',
    photoUpload: type === 'photo',
    quickTiles: type === 'quicktiles',
    gateOpts: type === 'gate',
    climateOpts: type === 'climate',
    graphOpts: type === 'graph',
    coverOpts: type === 'cover',
    lightOpts: type === 'light',
    wasteOpts: type === 'waste'
  };
}

function renderThresholdList() {
  const list = $('thresholdList');
  if (!list) return;
  list.innerHTML = '';
  settingsThresholds.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'threshold-row';
    row.innerHTML = `
      <span style="font-size:1.2vh; color:var(--muted);">ab</span>
      <input type="number" step="any" value="${t.value ?? ''}" class="thr-value">
      <input type="color" value="${t.color || '#4f7cff'}" class="thr-color">
      <button type="button" class="remove-threshold">×</button>
    `;
    row.querySelector('.thr-value').addEventListener('input', e => { t.value = e.target.value; });
    row.querySelector('.thr-color').addEventListener('input', e => { t.color = e.target.value; });
    row.querySelector('.remove-threshold').addEventListener('click', () => {
      settingsThresholds.splice(i, 1);
      renderThresholdList();
    });
    list.appendChild(row);
  });
}

function openSettings(entityId) {
  const entry = currentLayout.find(l => l.entity_id === entityId);
  if (!entry) return;
  const state = statesById[entityId];
  const attrs = (state && state.attributes) || {};
  const type = entry.card_type || defaultCardType(entityId, state);
  const settings = entry.settings || {};
  const fields = settingsFieldsForType(type);
  settingsEntityId = entityId;
  settingsFields = fields;
  settingsThresholds = (settings.thresholds || []).map(t => ({ ...t }));
  settingsBaseColorEntfernt = !settings.baseColor;

  // Derselbe Name wie ueberall sonst: erst der eigene, dann der kurze aus Home Assistant.
  // Ohne den stuende hier "Ecowitt Sensor 11DC2 Solar Radiation" und auf der Karte daneben
  // "Solar Radiation" -- und man fragt sich, ob man die richtige Karte erwischt hat.
  const haName = haNamen[entityId] || attrs.friendly_name;
  $('settingsTitle').textContent = 'Einstellungen: ' + (settings.name || haName || entityId);

  let html = '';
  if (fields.entitaetWechseln) {
    // Die Entitaet laesst sich nachtraeglich tauschen. Vorher musste man die Karte entfernen
    // und neu anlegen -- und verlor dabei Groesse, Platz und saemtliche Einstellungen, obwohl
    // sich nur das dahinterliegende Geraet geaendert hat.
    const doms = domainsForType(type);
    const belegt = currentLayout.filter(l => l.entity_id !== entityId).map(l => l.entity_id);
    const passende = allEntities
      .filter(e => doms === null || doms.includes(e.domain))
      .filter(e => !belegt.includes(e.entity_id));
    html += `<label>Entität (Gerät hinter dieser Karte)</label>
      <select id="setEntity">
        ${passende.some(e => e.entity_id === entityId) ? '' : `<option value="${entityId}" selected>${entityId} (aktuell)</option>`}
        ${passende.map(e => `<option value="${e.entity_id}" ${e.entity_id === entityId ? 'selected' : ''}>${e.name} — ${e.entity_id}</option>`).join('')}
      </select>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Tauscht nur das Gerät aus. Größe, Platz und alle Einstellungen dieser Karte bleiben.
        Bereits von anderen Karten belegte Entitäten stehen nicht zur Auswahl.</p>`;
  }
  if (fields.name) {
    html += `<label>Anzeigename (leer = Name aus Home Assistant${haName ? ': ' + haName : ''})</label>
      <input type="text" id="setName" value="${settings.name || ''}" placeholder="${haName || entityId}">`;
  }
  if (fields.suffix) {
    html += `<label>Einheit / Suffix (leer = automatisch${attrs.unit_of_measurement ? ': ' + attrs.unit_of_measurement : ''})</label>
      <input type="text" id="setSuffix" value="${settings.suffix || ''}" placeholder="${attrs.unit_of_measurement || ''}">`;
  }
  if (fields.ortWahl) {
    const w = settings.ort || '';
    const opt = (wert, text) => `<option value="${wert}" ${w === wert ? 'selected' : ''}>${text}</option>`;
    html += `<label>Ort des Messpunkts</label>
      <select id="setOrt">
        ${opt('', 'Automatisch (aus Name und Entität)')}
        ${opt('aussen', 'Außen')}
        ${opt('innen', 'Innen')}
        ${opt('kein', 'Keine Angabe')}
      </select>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Zwei Temperaturkarten sahen bisher gleich aus – der Unterschied stand nur in der
        kleinsten Schrift. Mit Ort bekommt die Karte ein Zeichen, das man aus der Entfernung
        an der <strong>Form</strong> erkennt: Haus oder Tanne, und ein Chip „INNEN“ (Ring)
        bzw. „AUSSEN“ (gefüllt). Automatisch erkennt Wörter wie „außen“, „outdoor“, „Garten“,
        „Wohnzimmer“ oder „innen“ in Name und Entität.</p>`;
  }
  if (fields.decimals) {
    html += `<label>Nachkommastellen (leer = Wert unverändert übernehmen)</label>
      <input type="number" id="setDecimals" min="0" max="6" placeholder="unverändert" value="${settings.decimals ?? ''}">
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Bisher stand ein Sensor, der 21.34567 meldet, genau so auf der Wand. Leer bedeutet
        weiterhin unverändert – damit sich mit diesem Update keine bestehende Karte still ändert.
        Gesetzt wird deutsch formatiert: 1.234,5 statt 1234.5.</p>`;
  }
  if (fields.verlaufOpts) {
    html += `<label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.8rem;">
        <input type="checkbox" id="setVerlauf" style="width:auto; margin:0;" ${settings.verlaufAus ? '' : 'checked'}>
        Verlauf der letzten Stunden im Hintergrund zeigen
      </label>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Eine ruhige Fläche im unteren Drittel plus ein Pfeil für die Tendenz. Eine Zahl allein
        sagt nicht, ob sie gerade steigt – und ohne den Verlauf wirkte die Karte sehr leer.
        Erscheint nur, wenn Home Assistant genug Verlaufsdaten liefert.</p>`;
  }
  if (fields.iconWahl) {
    const namen = (window.DashboardRender && DashboardRender.symbolNamen) ? DashboardRender.symbolNamen() : [];
    html += `<label>Symbol (leer = passend zum Kartentyp)</label>
      <select id="setIcon">
        <option value="">Standard</option>
        ${namen.map(n => `<option value="${n}" ${settings.icon === n ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
      <div id="iconVorschau" style="margin:0.6vh 0 1vh; width:3.4vh; height:3.4vh; color:var(--fg);"></div>`;
  }
  if (fields.radarOpts) {
    html += `<label>Bild neu laden alle … Sekunden</label>
      <input type="number" id="setRadarSeconds" min="5" max="3600" placeholder="300" value="${settings.radarSeconds ?? ''}">
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        War fest auf 5 Minuten – passend zu Regenradar-Bildern, die genau so oft erneuert
        werden. Eine Kamera am Tor will man häufiger sehen.</p>`;
  }
  if (fields.clockOpts) {
    html += `<label>Sprache / Region</label>
      <input type="text" id="setClockLocale" placeholder="de-DE" value="${settings.clockLocale || ''}">
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        War fest auf de-DE. Beispiele: <code>de-DE</code>, <code>it-IT</code>, <code>en-GB</code>.</p>
      <label>Stundenformat</label>
      <select id="setClockHour12">
        <option value="" ${settings.clockHour12 === undefined || settings.clockHour12 === '' ? 'selected' : ''}>Automatisch (nach Sprache)</option>
        <option value="false" ${settings.clockHour12 === false ? 'selected' : ''}>24 Stunden</option>
        <option value="true" ${settings.clockHour12 === true ? 'selected' : ''}>12 Stunden (AM/PM)</option>
      </select>
      <label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.8rem;">
        <input type="checkbox" id="setClockSeconds" style="width:auto; margin:0;" ${settings.clockSeconds ? 'checked' : ''}>
        Sekunden anzeigen
      </label>
      <label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.4rem;">
        <input type="checkbox" id="setClockNoDate" style="width:auto; margin:0;" ${settings.clockNoDate ? 'checked' : ''}>
        Datum ausblenden
      </label>`;
  }
  if (fields.gaugeExtras) {
    html += `
      <div class="row2">
        <div><label>Min (leer = automatisch)</label><input type="number" step="any" id="setMin" value="${settings.min ?? ''}"></div>
        <div><label>Max (leer = automatisch)</label><input type="number" step="any" id="setMax" value="${settings.max ?? ''}"></div>
      </div>
      <label>Farbschwellen (z.B. ab 10 grün, ab 28 gelb)</label>
      <div id="thresholdList"></div>
      <button type="button" class="add-threshold" id="addThresholdBtn">+ Schwelle hinzufügen</button>
      <label style="margin-top:0.8rem;">Grundfarbe (unterhalb der ersten Schwelle)</label>
      <div style="display:flex; align-items:center; gap:0.8vh;">
        <input type="color" id="setBaseColor" value="${settings.baseColor || '#4f7cff'}" style="width:6vh;">
        <button type="button" id="baseColorReset" style="width:auto; padding:0 1.2vh; margin:0; background:#6c757d;">Standard</button>
        <span style="font-size:1.1vh; color:var(--muted);">${settings.baseColor ? settings.baseColor : 'Standard (Themenfarbe)'}</span>
      </div>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Die Karte las diese Farbe schon immer aus – nur schrieb sie bisher kein Feld.</p>
    `;
  }
  if (fields.navigateTarget) {
    html += `<label>Ziel-Dashboard</label>
      <select id="setTarget">
        <option value="main" ${settings.targetDashboardId === 'main' || !settings.targetDashboardId ? 'selected' : ''}>Hauptdashboard</option>
        ${allDashboards.map(d => `<option value="${d.id}" ${settings.targetDashboardId === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}
      </select>
      <label>Angezeigter Name (leer = Dashboard-Name)</label>
      <input type="text" id="setName" value="${settings.name || ''}" placeholder="${settings.targetDashboardName || 'Dashboard'}">`;
  }
  if (fields.forecastType) {
    html += `<label>Vorhersage-Art</label>
      <select id="setForecastType">
        <option value="daily" ${settings.forecastType !== 'hourly' ? 'selected' : ''}>Täglich</option>
        <option value="hourly" ${settings.forecastType === 'hourly' ? 'selected' : ''}>Stündlich</option>
      </select>
      <label>Anzahl Spalten (leer = 5 Tage bzw. 6 Stunden)</label>
      <input type="number" id="setForecastCount" min="2" max="12" placeholder="automatisch" value="${settings.forecastCount ?? ''}">
      <label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.8rem;">
        <input type="checkbox" id="setForecastRain" style="width:auto; margin:0;" ${settings.forecastRain ? 'checked' : ''}>
        Niederschlag anzeigen
      </label>
      <label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.4rem;">
        <input type="checkbox" id="setForecastWind" style="width:auto; margin:0;" ${settings.forecastWind ? 'checked' : ''}>
        Wind anzeigen
      </label>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Beides erscheint nur, wenn die Wetter-Integration die Werte auch liefert. Beim
        Niederschlag zeigt die Karte Millimeter, falls vorhanden – sonst die
        Wahrscheinlichkeit in Prozent.</p>`;
  }
  if (fields.torDauerauf) {
    html += `
      <label>Melder für „Dauer-Auf“ (optional)</label>
      <input type="text" id="setTorDauerauf" list="entityList" value="${settings.torDaueraufEntity || ''}" placeholder="light.tor_dauerhaft_offen">
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Viele Torsteuerungen kennen einen Zustand „bleibt offen“ – für den Umzugswagen, die
        Gartenparty, den Paketboten. Solange diese Entität <strong>an</strong> ist, warnt die
        Karte nicht mehr, wenn das Tor länger braucht als sonst: Dass es nicht zufährt, ist dort
        ja gewollt. Stattdessen steht „Dauer-Auf“ auf der Karte. Je nach Anlage ist das ein
        Schalter, ein input_boolean oder ein Licht.</p>`;
  }
  if (fields.energyEntities) {
    html += `
      <button type="button" id="autoLoadEnergyBtn" style="margin-bottom:1rem;">Automatisch aus HA-Energie-Konfiguration laden</button>
      <div id="autoLoadResult" class="result"></div>
      <label>Netzbezug (Leistung, W/kW)</label>
      <input type="text" id="setGrid" list="entityList" value="${settings.gridEntity || ''}" placeholder="sensor.netzbezug_leistung">
      <label>Netzeinspeisung (optional)</label>
      <input type="text" id="setGridReturn" list="entityList" value="${settings.gridReturnEntity || ''}" placeholder="sensor.einspeisung_leistung">
      <label>Solar-Erzeugung (optional)</label>
      <input type="text" id="setSolar" list="entityList" value="${settings.solarEntity || ''}" placeholder="sensor.pv_leistung">
      <label>Batterie-Leistung (optional, negativ = lädt)</label>
      <input type="text" id="setBattery" list="entityList" value="${settings.batteryEntity || ''}" placeholder="sensor.batterie_leistung">
      <label>Batterie-Ladezustand % (optional)</label>
      <input type="text" id="setBatterySoc" list="entityList" value="${settings.batterySocEntity || ''}" placeholder="sensor.batterie_soc">
      <datalist id="entityList">
        ${allEntities.map(e => `<option value="${e.entity_id}">${e.name}</option>`).join('')}
      </datalist>
      <label style="margin-top:1rem;">Ab welcher Leistung eine Linie leuchtet (W)</label>
      <input type="number" id="setEnergyThreshold" min="0" step="any" placeholder="5" value="${settings.energyThreshold ?? ''}">
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        War fest auf 5 W. Meldet der Wechselrichter nachts Eigenverbrauch, leuchtet die Linie
        sonst durch – dann hier höher setzen.</p>
      <label style="display:flex; align-items:center; gap:0.6vh;">
        <input type="checkbox" id="setEnergyBatteryInvert" style="width:auto; margin:0;" ${settings.energyBatteryInvert ? 'checked' : ''}>
        Batterie-Vorzeichen umdrehen (positiv = lädt)
      </label>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Nur anhaken, wenn der Pfeil in die falsche Richtung zeigt. Welches Vorzeichen „lädt“
        heißt, entscheidet jede Anlage selbst.</p>
      <label>Beschriftungen (leer = Standard)</label>
      <div class="row2">
        <div><label style="font-size:1.1vh;">Solar</label>
          <input type="text" id="setEnergyLabelSolar" placeholder="Solar" value="${(settings.energyLabelSolar || '').replace(/"/g, '&quot;')}"></div>
        <div><label style="font-size:1.1vh;">Netz</label>
          <input type="text" id="setEnergyLabelGrid" placeholder="Netz" value="${(settings.energyLabelGrid || '').replace(/"/g, '&quot;')}"></div>
      </div>
      <div class="row2">
        <div><label style="font-size:1.1vh;">Haus</label>
          <input type="text" id="setEnergyLabelHome" placeholder="Haus" value="${(settings.energyLabelHome || '').replace(/"/g, '&quot;')}"></div>
        <div><label style="font-size:1.1vh;">Batterie</label>
          <input type="text" id="setEnergyLabelBattery" placeholder="Batterie" value="${(settings.energyLabelBattery || '').replace(/"/g, '&quot;')}"></div>
      </div>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Bisher diente der Anzeigename oben doppelt als Haus-Beschriftung – wer die Karte
        umbenannte, benannte damit ungewollt das Haus um.</p>
    `;
  }
  if (fields.wasteOpts) {
    html += `
      <label>Wie viele Abfuhrtage anzeigen</label>
      <input type="number" id="setWasteCount" min="1" max="12" placeholder="4" value="${settings.wasteCount ?? ''}">
      <p class="hint-text">Gezaehlt werden TAGE, nicht Eintraege: Fahren an einem Tag zwei Tonnen,
        stehen sie in einer Zeile. Der erste Tag ist der grosse oben.</p>
      <label style="margin-top:0.8rem;">Eigene Tonnenfarben</label>
      <div id="wasteColorList"></div>
      <button type="button" id="wasteAddColorBtn" style="margin-top:0.6rem;">+ Tonnenart hinzufügen</button>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.6vh 0 1vh;">
        Ein Stichwort aus dem Termintitel genügt – Groß- und Kleinschreibung ist egal.
        Eigene Regeln gehen vor den eingebauten (Bio, Papier, Gelb, Glas, Sperrmüll, Rest).
        Was zu keiner Regel passt, bleibt grau.</p>
    `;
  }
  if (fields.mediaPlayerOpts) {
    html += `<label><input type="checkbox" id="setMediaArtBg" style="width:auto; margin-right:0.5rem;" ${settings.mediaArtBg !== false ? 'checked' : ''}>Album-Cover als Kartenhintergrund (weichgezeichnet)</label>
      <label><input type="checkbox" id="setMediaShowSource" style="width:auto; margin-right:0.5rem;" ${settings.mediaShowSource !== false ? 'checked' : ''}>Quellenauswahl anzeigen (falls vom Gerät unterstützt)</label>
      <label><input type="checkbox" id="setMediaShowProgress" style="width:auto; margin-right:0.5rem;" ${settings.mediaShowProgress !== false ? 'checked' : ''}>Fortschrittsbalken anzeigen (falls vom Gerät unterstützt)</label>`;
  }
  if (fields.photoUpload) {
    html += `
      <label>Bilder</label>
      <div id="photoSlots"></div>
      <button type="button" id="photoAddBtn" style="margin-top:0.6rem;">+ Bild hinzufügen</button>
      <input type="file" id="photoFileInput" accept="image/png,image/jpeg,image/webp" style="display:none;">
      <span id="photoResult" style="font-size:1.2vh;"></span>
      <label style="margin-top:1rem;">Bildwechsel alle … Sekunden</label>
      <input type="number" id="setPhotoSeconds" min="3" max="3600" placeholder="20" value="${settings.photoSeconds ?? ''}">
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Gilt erst ab dem zweiten Bild. Mit einem Bild bleibt es stehen wie bisher.</p>
      <p style="font-size:1.1vh; color:var(--muted);">Auf diesem Foto dürfen Media-Player- und Wetter-Karten überlappend platziert werden (bekommen dabei automatisch einen Glas-Effekt).</p>
    `;
  }
  if (fields.quickTiles) {
    html += `
      <label>Kacheln</label>
      <div id="qtTileList"></div>
      <button type="button" id="qtAddTileBtn" style="margin-top:0.6rem;">+ Kachel hinzufügen</button>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.6vh 0 1vh;">
        Eine Kachel wählt entweder eine Quelle an einem Media Player, oder sie startet ein
        Skript oder eine Szene. Nur die Quellenwahl leuchtet, wenn sie gerade läuft – ein
        Skript hat keinen „läuft“-Zustand.</p>
      <datalist id="mpEntityList">
        ${allEntities.filter(e => e.domain === 'media_player').map(e => `<option value="${e.entity_id}">${e.name}</option>`).join('')}
      </datalist>
      <datalist id="qtScriptList">
        ${allEntities.filter(e => e.domain === 'script' || e.domain === 'scene').map(e => `<option value="${e.entity_id}">${e.name}</option>`).join('')}
      </datalist>
    `;
  }
  if (fields.graphOpts) {
    const stunden = settings.graphHours || 24;
    const wahl = [[1,'1 Stunde'],[6,'6 Stunden'],[12,'12 Stunden'],[24,'24 Stunden'],[48,'2 Tage'],[168,'7 Tage']];
    html += `
      <label>Zeitraum</label>
      <select id="graphHours">
        ${wahl.map(([v, txt]) => `<option value="${v}" ${Number(stunden) === v ? 'selected' : ''}>${txt}</option>`).join('')}
      </select>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        War bisher fest auf 24 Stunden verdrahtet.</p>
      <label>Y-Achse</label>
      <div class="row2">
        <div><label style="font-size:1.1vh;">Untergrenze</label>
          <input type="number" id="graphMin" placeholder="automatisch" value="${settings.graphMin ?? ''}"></div>
        <div><label style="font-size:1.1vh;">Obergrenze</label>
          <input type="number" id="graphMax" placeholder="automatisch" value="${settings.graphMax ?? ''}"></div>
      </div>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Leer lassen für automatische Skalierung.</p>
    `;
  }

  if (fields.lightOpts) {
    html += `
      <label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.8rem;">
        <input type="checkbox" id="lightTemp" style="width:auto; margin:0;" ${settings.lightTemp === false ? '' : 'checked'}>
        Farbtemperatur-Regler anzeigen
      </label>
      <label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.4rem;">
        <input type="checkbox" id="lightColor" style="width:auto; margin:0;" ${settings.lightColor ? 'checked' : ''}>
        Farbwahl anzeigen
      </label>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Beide erscheinen nur, wenn die Lampe das laut Home Assistant beherrscht.</p>
    `;
  }

  if (fields.coverOpts) {
    html += `
      <label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.8rem;">
        <input type="checkbox" id="coverPosition" style="width:auto; margin:0;" ${settings.coverPosition === false ? '' : 'checked'}>
        Positionsregler anzeigen
      </label>
      <label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.4rem;">
        <input type="checkbox" id="coverTilt" style="width:auto; margin:0;" ${settings.coverTilt ? 'checked' : ''}>
        Neigungsregler anzeigen
      </label>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Beide erscheinen nur, wenn das Gerät sie laut Home Assistant auch beherrscht.</p>
    `;
  }

  if (fields.climateOpts) {
    html += `
      <label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.8rem;">
        <input type="checkbox" id="climateModes" style="width:auto; margin:0;" ${settings.climateModes === false ? '' : 'checked'}>
        Betriebsarten anzeigen (Heizen, Kühlen, Aus …)
      </label>
      <label style="display:flex; align-items:center; gap:0.6vh; margin-top:0.4rem;">
        <input type="checkbox" id="climatePresets" style="width:auto; margin:0;" ${settings.climatePresets ? 'checked' : ''}>
        Voreinstellungen anzeigen (Eco, Komfort …)
      </label>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Schrittweite, Grenzwerte und Betriebsarten kommen vom Gerät selbst – die Karte zeigt nur,
        was es wirklich kann.</p>
    `;
  }

  if (fields.gateOpts) {
    html += `
      <label>Meldetext</label>
      <input type="text" id="gateMessage" placeholder="Tor dauerhaft offen" value="${(settings.gateMessage || '').replace(/"/g, '&quot;')}">
      <p style="font-size:1.1vh; color:var(--muted); margin:0.4vh 0 1vh;">
        Erscheint oben auf der Karte, solange die gewählte Karten-Entität an ist.</p>
      <label>Knöpfe</label>
      <p style="font-size:1.1vh; color:var(--muted); margin:0 0 0.6vh;">
        Ein Symbol je Knopf lohnt sich: Aus fünf Metern liest man „Tor“ und „Garage“ nicht
        auseinander – ein Tor und eine Garage schon. Passend sind z.B. <code>gate</code>,
        <code>garage</code>, <code>door</code>, <code>lockClosed</code>, <code>power</code>.</p>
      <div id="gateBtnList"></div>
      <button type="button" id="gateAddBtn" style="margin-top:0.6rem;">+ Knopf hinzufügen</button>
      <p style="font-size:1.1vh; color:var(--muted); margin:0.6vh 0 1vh;">
        Relais und Schalter werden als <strong>Taster</strong> behandelt: kurz ein, gleich wieder
        aus – ein Torantrieb braucht einen Impuls, kein Dauersignal. Soll eine Entität statt
        dessen eingeschaltet bleiben, den Haken „Schalter“ setzen. Taster-Entitäten
        (<code>input_button</code>, <code>button</code>, <code>script</code>) sind ohnehin
        momentan; dort ändert der Haken nichts.</p>
      <datalist id="gateEntityList">
        ${allEntities.map(e => `<option value="${e.entity_id}">${e.name}</option>`).join('')}
      </datalist>
    `;
  }

  $('settingsBody').innerHTML = html;

  // ACHTUNG: Alles, was Elemente aus `html` anfasst, MUSS hinter dieser Zeile stehen.
  // Davor gibt es sie noch nicht, und $() liefert null -- die Einstellungen liessen sich
  // dann gar nicht mehr oeffnen, weil der Fehler den ganzen Aufbau abbricht. Genau das
  // ist in der Vorlage einer Karte passiert, und zwar unbemerkt ueber zwei Versionen.
  if (fields.iconWahl) {
    // Eine Liste von Namen ohne Bild waere Raten. Die Vorschau zeigt sofort, was man waehlt.
    const zeigeSymbol = () => {
      const n = $('setIcon').value;
      const svg = (window.DashboardRender && DashboardRender.ICONS) ? DashboardRender.ICONS[n] : '';
      $('iconVorschau').innerHTML = svg || '';
    };
    $('setIcon').addEventListener('change', zeigeSymbol);
    zeigeSymbol();
  }

  if (fields.gaugeExtras) {
    renderThresholdList();
    $('addThresholdBtn').addEventListener('click', () => {
      settingsThresholds.push({ value: '', color: '#4f7cff' });
      renderThresholdList();
    });
    // Ein Farbwaehler kann nicht "nichts" bedeuten -- er zeigt immer irgendeine Farbe. Ohne
    // diesen Knopf gaebe es keinen Weg zurueck zur Themenfarbe.
    $('baseColorReset').addEventListener('click', () => {
      settingsBaseColorEntfernt = true;
      $('setBaseColor').value = '#4f7cff';
      $('baseColorReset').nextElementSibling.textContent = 'Standard (Themenfarbe)';
    });
    $('setBaseColor').addEventListener('input', () => {
      settingsBaseColorEntfernt = false;
      $('baseColorReset').nextElementSibling.textContent = $('setBaseColor').value;
    });
  }

  if (fields.wasteOpts) {
    if (!Array.isArray(settings.wasteColors)) settings.wasteColors = [];
    function renderWasteColorRows() {
      const list = $('wasteColorList');
      list.innerHTML = settings.wasteColors.map((r, i) => `
        <div style="display:flex; align-items:center; gap:0.6vh; margin-bottom:0.6vh;">
          <input type="text" class="wc-muster" data-idx="${i}" placeholder="Stichwort, z.B. Grüngut" value="${(r.muster || '').replace(/"/g, '&quot;')}" style="flex:1;">
          <input type="color" class="wc-farbe" data-idx="${i}" value="${r.farbe || '#6b8e23'}" style="width:5vh; flex-shrink:0;">
          <button type="button" class="wc-remove" data-idx="${i}" style="width:auto; padding:0 1.2vh; margin:0; background:#dc3545; flex-shrink:0;">×</button>
        </div>
      `).join('') || `<p style="font-size:1.1vh; color:var(--muted);">Keine eigenen Regeln – es gelten die eingebauten.</p>`;
      list.querySelectorAll('.wc-muster').forEach(el => el.addEventListener('input', () => {
        settings.wasteColors[+el.dataset.idx].muster = el.value; markDirty();
      }));
      list.querySelectorAll('.wc-farbe').forEach(el => el.addEventListener('input', () => {
        settings.wasteColors[+el.dataset.idx].farbe = el.value; markDirty();
      }));
      list.querySelectorAll('.wc-remove').forEach(el => el.addEventListener('click', () => {
        settings.wasteColors.splice(+el.dataset.idx, 1); markDirty(); renderWasteColorRows();
      }));
    }
    renderWasteColorRows();
    $('wasteAddColorBtn').addEventListener('click', () => {
      settings.wasteColors.push({ muster: '', farbe: '#6b8e23' });
      markDirty(); renderWasteColorRows();
    });
  }

  if (fields.energyEntities) {
    $('autoLoadEnergyBtn').addEventListener('click', async () => {
      const resultEl = $('autoLoadResult');
      resultEl.textContent = 'Lade HA-Energie-Konfiguration (kann kurz dauern)...';
      resultEl.className = 'result';
      try {
        const r = await fetch('/api/ha/energy-prefs');
        const data = await r.json();
        if (!data.ok) {
          resultEl.textContent = 'Fehler: ' + data.error;
          resultEl.className = 'result err';
          return;
        }
        if (data.gridConsumption) $('setGrid').value = data.gridConsumption;
        if (data.gridReturn) $('setGridReturn').value = data.gridReturn;
        if (data.solar) $('setSolar').value = data.solar;
        if (data.batteryOut) $('setBattery').value = data.batteryOut;
        resultEl.textContent = 'Übernommen. Bitte prüfen, ob die Entitäten passen (ggf. Leistungssensor statt Statistik-ID nachtragen) und speichern.';
        resultEl.className = 'result ok';
      } catch (e) {
        resultEl.textContent = 'Fehler: ' + e.message;
        resultEl.className = 'result err';
      }
    });
  }

  if (fields.photoUpload) {
    const cardId = entityId;
    // Bild 1 behaelt die ID OHNE Nummer -- bestehende Karten sollen nach dem Update ihr Bild
    // behalten und nicht auf einen leeren Rahmen schauen.
    const bildId = (n) => (n === 0 ? cardId : cardId + '__' + (n + 1));

    if (!Array.isArray(settings.photoBilder)) {
      settings.photoBilder = settings.photoVersion ? [settings.photoVersion] : [];
    }

    const meldung = (text, gut) => {
      const el = $('photoResult');
      el.textContent = text;
      el.style.color = gut === undefined ? 'var(--muted)' : (gut ? '#7fd68a' : '#ff8a8a');
    };

    function renderPhotoSlots() {
      const liste = $('photoSlots');
      liste.innerHTML = settings.photoBilder.map((v, i) => `
        <div style="display:flex; align-items:center; gap:0.8vh; margin-bottom:0.6vh;">
          <img src="/api/photo-card/${encodeURIComponent(bildId(i))}/background?v=${v}"
               style="height:5vh; width:8vh; object-fit:cover; border-radius:6px; background:var(--bg); flex-shrink:0;">
          <span style="font-size:1.2vh; color:var(--muted); flex:1;">Bild ${i + 1}</span>
          <button type="button" class="photo-del" data-idx="${i}" style="width:auto; padding:0 1.2vh; margin:0; background:#dc3545; flex-shrink:0;">×</button>
        </div>
      `).join('') || `<p style="font-size:1.1vh; color:var(--muted);">Noch kein Bild.</p>`;

      // Nur das LETZTE Bild laesst sich entfernen. Die Bilder haengen an ihrer Position, nicht
      // an einer eigenen Kennung; wer aus der Mitte loescht, muesste die nachfolgenden
      // umhaengen -- und dafuer braeuchte es die Originaldateien, die hier nicht mehr
      // vorliegen. Ein Knopf, der still Bilder verliert, waere schlimmer als keiner.
      liste.querySelectorAll('.photo-del').forEach(el => el.addEventListener('click', async () => {
        const i = +el.dataset.idx;
        if (i !== settings.photoBilder.length - 1) {
          return meldung('Es lässt sich nur das letzte Bild entfernen – die Bilder hängen an ihrer Position.', false);
        }
        meldung('Entferne...');
        await fetch(`/api/photo-card/${encodeURIComponent(bildId(i))}/background/remove`, { method: 'POST' });
        settings.photoBilder.pop();
        if (!settings.photoBilder.length) delete settings.photoVersion;
        markDirty();
        renderPhotoSlots();
        meldung('Entfernt.', true);
      }));
    }

    renderPhotoSlots();

    $('photoAddBtn').addEventListener('click', () => {
      if (settings.photoBilder.length >= 8) return meldung('Mehr als acht Bilder nimmt eine Karte nicht.', false);
      $('photoFileInput').click();
    });

    $('photoFileInput').addEventListener('change', async () => {
      const file = $('photoFileInput').files[0];
      if (!file) return;
      const n = settings.photoBilder.length;
      meldung('Lade hoch...');
      try {
        const dataUrl = await resizeImageFile(file, 1920);
        const r = await fetch(`/api/photo-card/${encodeURIComponent(bildId(n))}/background`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl })
        });
        const data = await r.json();
        if (data.ok) {
          settings.photoBilder.push(Date.now());
          // photoVersion bleibt fuer Bild 1 gesetzt: So zeigt eine aeltere Fassung der App
          // dieselbe Karte weiterhin an, statt einen leeren Rahmen.
          if (n === 0) settings.photoVersion = settings.photoBilder[0];
          markDirty();
          renderPhotoSlots();
          meldung('Gespeichert.', true);
        } else {
          meldung('Fehler: ' + data.error, false);
        }
      } catch (e) {
        meldung('Fehler: ' + e.message, false);
      }
      $('photoFileInput').value = '';
    });
  }

  if (fields.graphOpts) {
    $('graphHours').addEventListener('change', () => { settings.graphHours = parseInt($('graphHours').value, 10); markDirty(); });
    const zahlOderWeg = (id, feld) => $(id).addEventListener('input', () => {
      const v = $(id).value.trim();
      if (v === '') delete settings[feld]; else settings[feld] = parseFloat(v);
      markDirty();
    });
    zahlOderWeg('graphMin', 'graphMin');
    zahlOderWeg('graphMax', 'graphMax');
  }

  if (fields.lightOpts) {
    $('lightTemp').addEventListener('change', () => { settings.lightTemp = $('lightTemp').checked; markDirty(); });
    $('lightColor').addEventListener('change', () => { settings.lightColor = $('lightColor').checked; markDirty(); });
  }

  if (fields.coverOpts) {
    $('coverPosition').addEventListener('change', () => { settings.coverPosition = $('coverPosition').checked; markDirty(); });
    $('coverTilt').addEventListener('change', () => { settings.coverTilt = $('coverTilt').checked; markDirty(); });
  }

  if (fields.climateOpts) {
    $('climateModes').addEventListener('change', () => { settings.climateModes = $('climateModes').checked; markDirty(); });
    $('climatePresets').addEventListener('change', () => { settings.climatePresets = $('climatePresets').checked; markDirty(); });
  }

  if (fields.gateOpts) {
    if (!Array.isArray(settings.gateButtons)) settings.gateButtons = [];
    $('gateMessage').addEventListener('input', () => { settings.gateMessage = $('gateMessage').value; markDirty(); });

    function renderGateRows() {
      const list = $('gateBtnList');
      list.innerHTML = settings.gateButtons.map((b, i) => `
        <div style="display:flex; align-items:center; gap:0.6vh; margin-bottom:0.6vh;">
          <input type="text" class="gate-label-input" data-idx="${i}" placeholder="Beschriftung, z.B. Tor vorne" value="${(b.label || '').replace(/"/g, '&quot;')}" style="flex:1;">
          <input type="text" class="gate-entity-input" data-idx="${i}" list="gateEntityList" placeholder="input_button.xxx" value="${(b.entity || '').replace(/"/g, '&quot;')}" style="flex:1.4;">
          <span class="gate-symbol-vorschau" data-idx="${i}" style="width:3vh; height:3vh; flex-shrink:0; color:var(--text);"></span>
          <select class="gate-icon-input" data-idx="${i}" style="flex:0 0 auto; width:auto; margin:0;">
            <option value="">ohne Symbol</option>
            ${((window.DashboardRender && DashboardRender.symbolNamen) ? DashboardRender.symbolNamen() : [])
              .map(n => `<option value="${n}" ${b.icon === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          <label style="display:flex; align-items:center; gap:0.3vh; font-size:1.1vh; color:var(--muted); flex-shrink:0; white-space:nowrap;"
                 title="Aus: kurzer Impuls wie ein Taster. An: bleibt eingeschaltet wie ein Schalter.">
            <input type="checkbox" class="gate-schalter-input" data-idx="${i}" style="width:auto; margin:0;" ${b.alsSchalter ? 'checked' : ''}>Schalter
          </label>
          <button type="button" class="gate-up-btn" data-idx="${i}" style="width:auto; padding:0 1vh; margin:0; flex-shrink:0;" title="nach oben">↑</button>
          <button type="button" class="gate-remove-btn" data-idx="${i}" style="width:auto; padding:0 1.2vh; margin:0; background:#dc3545; flex-shrink:0;">×</button>
        </div>
      `).join('') || `<p style="font-size:1.1vh; color:var(--muted);">Noch keine Knöpfe.</p>`;

      list.querySelectorAll('.gate-label-input').forEach(el => el.addEventListener('input', () => {
        settings.gateButtons[+el.dataset.idx].label = el.value; markDirty();
      }));
      list.querySelectorAll('.gate-entity-input').forEach(el => el.addEventListener('input', () => {
        settings.gateButtons[+el.dataset.idx].entity = el.value; markDirty();
      }));
      const symbolVorschau = () => {
        list.querySelectorAll('.gate-symbol-vorschau').forEach(el => {
          const wahl = settings.gateButtons[+el.dataset.idx].icon;
          el.innerHTML = (wahl && DashboardRender.ICONS[wahl]) ? DashboardRender.ICONS[wahl] : '';
        });
      };
      symbolVorschau();
      // Eine Liste von Namen ohne Bild waere Raten -- das Symbol ist ja gerade der Punkt.
      list.querySelectorAll('.gate-icon-input').forEach(el => el.addEventListener('change', () => {
        settings.gateButtons[+el.dataset.idx].icon = el.value;
        markDirty(); symbolVorschau();
      }));
      list.querySelectorAll('.gate-schalter-input').forEach(el => el.addEventListener('change', () => {
        settings.gateButtons[+el.dataset.idx].alsSchalter = el.checked; markDirty();
      }));
      list.querySelectorAll('.gate-remove-btn').forEach(el => el.addEventListener('click', () => {
        settings.gateButtons.splice(+el.dataset.idx, 1); markDirty(); renderGateRows();
      }));
      list.querySelectorAll('.gate-up-btn').forEach(el => el.addEventListener('click', () => {
        const i = +el.dataset.idx;
        if (i === 0) return;
        const [w] = settings.gateButtons.splice(i, 1);
        settings.gateButtons.splice(i - 1, 0, w);
        markDirty(); renderGateRows();
      }));
    }
    renderGateRows();
    $('gateAddBtn').addEventListener('click', () => {
      settings.gateButtons.push({ label: '', entity: '' });
      markDirty(); renderGateRows();
    });
  }

  if (fields.quickTiles) {
    if (!Array.isArray(settings.tiles)) settings.tiles = [];
    function renderTileRows() {
      const list = $('qtTileList');
      list.innerHTML = settings.tiles.map((t, i) => {
        // Kacheln aus der Zeit vor den Skripten haben kein art-Feld -- die bleiben Quellenwahl.
        const art = t.art || 'media';
        return `
        <div style="display:flex; align-items:center; gap:0.6vh; margin-bottom:0.6vh;">
          <img class="qt-thumb" src="${t.imageDataUrl || ''}" style="width:4vh; height:4vh; border-radius:6px; object-fit:cover; background:var(--bg); flex-shrink:0; display:${t.imageDataUrl ? 'block' : 'none'};">
          <button type="button" class="qt-img-btn" data-idx="${i}" style="width:auto; padding:0 1vh; margin:0; flex-shrink:0;">Bild</button>
          <select class="qt-art-input" data-idx="${i}" style="flex:0 0 auto; width:auto; margin:0;">
            <option value="media" ${art === 'media' ? 'selected' : ''}>Quelle</option>
            <option value="script" ${art === 'script' ? 'selected' : ''}>Skript</option>
            <option value="scene" ${art === 'scene' ? 'selected' : ''}>Szene</option>
          </select>
          ${art === 'media' ? `
            <input type="text" class="qt-mp-input" data-idx="${i}" list="mpEntityList" placeholder="media_player.xxx" value="${(t.mediaPlayerEntity || '').replace(/"/g, '&quot;')}" style="flex:1.4;">
            <input type="text" class="qt-source-input" data-idx="${i}" placeholder="Quelle, z.B. Netflix" value="${(t.source || '').replace(/"/g, '&quot;')}" style="flex:1;">
          ` : `
            <input type="text" class="qt-entity-input" data-idx="${i}" list="qtScriptList" placeholder="${art === 'scene' ? 'scene.xxx' : 'script.xxx'}" value="${(t.entity || '').replace(/"/g, '&quot;')}" style="flex:1.4;">
            <input type="text" class="qt-label-input" data-idx="${i}" placeholder="Beschriftung" value="${(t.label || '').replace(/"/g, '&quot;')}" style="flex:1;">
          `}
          <button type="button" class="qt-remove-btn" data-idx="${i}" style="width:auto; padding:0 1.2vh; margin:0; background:#dc3545; flex-shrink:0;">×</button>
        </div>`;
      }).join('') || `<p style="font-size:1.1vh; color:var(--muted);">Noch keine Kacheln.</p>`;
      list.querySelectorAll('.qt-art-input').forEach(el => el.addEventListener('change', () => {
        settings.tiles[+el.dataset.idx].art = el.value; markDirty(); renderTileRows();
      }));
      list.querySelectorAll('.qt-entity-input').forEach(el => el.addEventListener('input', () => { settings.tiles[+el.dataset.idx].entity = el.value; markDirty(); }));
      list.querySelectorAll('.qt-label-input').forEach(el => el.addEventListener('input', () => { settings.tiles[+el.dataset.idx].label = el.value; markDirty(); }));
      list.querySelectorAll('.qt-mp-input').forEach(el => el.addEventListener('input', () => { settings.tiles[+el.dataset.idx].mediaPlayerEntity = el.value; markDirty(); }));
      list.querySelectorAll('.qt-source-input').forEach(el => el.addEventListener('input', () => {
        const t = settings.tiles[+el.dataset.idx]; t.source = el.value; t.label = el.value; markDirty();
      }));
      list.querySelectorAll('.qt-remove-btn').forEach(el => el.addEventListener('click', () => {
        settings.tiles.splice(+el.dataset.idx, 1); markDirty(); renderTileRows();
      }));
      list.querySelectorAll('.qt-img-btn').forEach(el => el.addEventListener('click', () => {
        const idx = +el.dataset.idx;
        const fileInput = document.createElement('input');
        fileInput.type = 'file'; fileInput.accept = 'image/png,image/jpeg,image/webp';
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files[0];
          if (!file) return;
          settings.tiles[idx].imageDataUrl = await resizeImageFile(file, 200);
          markDirty();
          renderTileRows();
        });
        fileInput.click();
      }));
    }
    renderTileRows();
    $('qtAddTileBtn').addEventListener('click', () => {
      settings.tiles.push({ id: 'tile_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), art: 'media', mediaPlayerEntity: '', source: '', label: '' });
      markDirty();
      renderTileRows();
    });
  }

  $('settingsModal').classList.add('show');
}

// Verkleinert ein Bild vor dem Hochladen auf max. maxDim Pixel (laengste Seite) und
// komprimiert als JPEG.
function resizeImageFile(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

$('settingsCancel').addEventListener('click', () => $('settingsModal').classList.remove('show'));

$('settingsSave').addEventListener('click', () => {
  const entry = currentLayout.find(l => l.entity_id === settingsEntityId);
  if (!entry) return;
  const settings = { ...(entry.settings || {}) };

  if (settingsFields.torDauerauf && $('setTorDauerauf')) {
    const melder = $('setTorDauerauf').value.trim();
    if (melder) settings.torDaueraufEntity = melder; else delete settings.torDaueraufEntity;
  }

  // Entitaet tauschen, falls gewaehlt. Das passiert VOR allem anderen, damit die uebrigen
  // Einstellungen auf dem schon getauschten Eintrag landen.
  let neueEntitaet = null;
  if (settingsFields.entitaetWechseln && $('setEntity')) {
    const gewaehlt = $('setEntity').value;
    if (gewaehlt && gewaehlt !== entry.entity_id) {
      // Doppelt vergeben waere ein stiller Datenverlust: Zwei Eintraege mit derselben
      // Kennung, und jede Suche nach entity_id findet nur noch den ersten.
      if (currentLayout.some(l => l !== entry && l.entity_id === gewaehlt)) {
        alert('Diese Entität steckt schon in einer anderen Karte.');
        return;
      }
      neueEntitaet = gewaehlt;
    }
  }
  if (settingsFields.name) {
    const nameV = ($('setName') && $('setName').value.trim()) || '';
    if (nameV) settings.name = nameV; else delete settings.name;
  }
  if (settingsFields.suffix) {
    const v = ($('setSuffix') && $('setSuffix').value.trim()) || '';
    if (v) settings.suffix = v; else delete settings.suffix;
  }
  if (settingsFields.ortWahl) {
    // Leer heisst "automatisch" und wird NICHT gespeichert: Nur so bekommt eine Karte, die nie
    // jemand angefasst hat, spaeter verbesserte Ratewoerter mit.
    const v = ($('setOrt') && $('setOrt').value) || '';
    if (['innen', 'aussen', 'kein'].includes(v)) settings.ort = v; else delete settings.ort;
  }
  if (settingsFields.decimals) {
    const v = ($('setDecimals') && $('setDecimals').value.trim()) || '';
    if (v !== '' && !isNaN(parseInt(v, 10))) settings.decimals = Math.max(0, Math.min(6, parseInt(v, 10)));
    else delete settings.decimals;
  }
  if (settingsFields.verlaufOpts) {
    // Gespeichert wird die AUSNAHME, nicht der Normalfall: So bekommen bestehende Karten den
    // Verlauf automatisch, ohne dass irgendwo ein Haken nachgetragen werden muss.
    const an = !($('setVerlauf') && !$('setVerlauf').checked);
    if (an) delete settings.verlaufAus; else settings.verlaufAus = true;
  }
  if (settingsFields.iconWahl) {
    const v = ($('setIcon') && $('setIcon').value) || '';
    if (v) settings.icon = v; else delete settings.icon;
  }
  if (settingsFields.radarOpts) {
    const v = ($('setRadarSeconds') && $('setRadarSeconds').value.trim()) || '';
    if (v !== '' && !isNaN(parseInt(v, 10))) settings.radarSeconds = Math.max(5, Math.min(3600, parseInt(v, 10)));
    else delete settings.radarSeconds;
  }
  if (settingsFields.clockOpts) {
    const loc = ($('setClockLocale') && $('setClockLocale').value.trim()) || '';
    if (loc) settings.clockLocale = loc; else delete settings.clockLocale;
    const h12 = ($('setClockHour12') && $('setClockHour12').value) || '';
    if (h12 === 'true') settings.clockHour12 = true;
    else if (h12 === 'false') settings.clockHour12 = false;
    else delete settings.clockHour12;
    settings.clockSeconds = !!($('setClockSeconds') && $('setClockSeconds').checked);
    settings.clockNoDate = !!($('setClockNoDate') && $('setClockNoDate').checked);
  }
  if (settingsFields.gaugeExtras) {
    const minV = $('setMin') ? $('setMin').value : '';
    const maxV = $('setMax') ? $('setMax').value : '';
    if (minV !== '') settings.min = minV; else delete settings.min;
    if (maxV !== '') settings.max = maxV; else delete settings.max;
    const cleaned = settingsThresholds.filter(t => t.value !== '' && t.value !== null && t.value !== undefined && !isNaN(t.value));
    if (cleaned.length) settings.thresholds = cleaned; else delete settings.thresholds;
    if (settingsBaseColorEntfernt || !$('setBaseColor')) delete settings.baseColor;
    else settings.baseColor = $('setBaseColor').value;
  }
  if (settingsFields.wasteOpts) {
    const anz = $('setWasteCount') ? $('setWasteCount').value.trim() : '';
    if (anz !== '') settings.wasteCount = Math.max(1, Math.min(12, parseInt(anz, 10) || 4));
    else delete settings.wasteCount;
    // Regeln ohne Stichwort wuerden auf jeden Titel passen bzw. auf keinen -- beides nutzlos.
    const regeln = (settings.wasteColors || []).filter(r => String(r.muster || '').trim());
    if (regeln.length) settings.wasteColors = regeln; else delete settings.wasteColors;
  }
  if (settingsFields.navigateTarget) {
    const targetSel = $('setTarget');
    const targetId = targetSel ? targetSel.value : 'main';
    const targetName = targetId === 'main' ? 'Hauptdashboard' : ((allDashboards.find(d => d.id === targetId) || {}).name || 'Dashboard');
    settings.targetDashboardId = targetId;
    settings.targetDashboardName = targetName;
    const nameV = ($('setName') && $('setName').value.trim()) || '';
    if (nameV) settings.name = nameV; else delete settings.name;
  }
  if (settingsFields.forecastType) {
    settings.forecastType = $('setForecastType') ? $('setForecastType').value : 'daily';
    const anz = $('setForecastCount') ? $('setForecastCount').value.trim() : '';
    if (anz !== '') settings.forecastCount = Math.max(2, Math.min(12, parseInt(anz, 10) || 5));
    else delete settings.forecastCount;
    settings.forecastRain = !!($('setForecastRain') && $('setForecastRain').checked);
    settings.forecastWind = !!($('setForecastWind') && $('setForecastWind').checked);
  }
  if (settingsFields.energyEntities) {
    const grab = id => (($(id) && $(id).value.trim()) || '');
    const grid = grab('setGrid'), gridRet = grab('setGridReturn'), solar = grab('setSolar'),
      batt = grab('setBattery'), battSoc = grab('setBatterySoc');
    if (grid) settings.gridEntity = grid; else delete settings.gridEntity;
    if (gridRet) settings.gridReturnEntity = gridRet; else delete settings.gridReturnEntity;
    if (solar) settings.solarEntity = solar; else delete settings.solarEntity;
    if (batt) settings.batteryEntity = batt; else delete settings.batteryEntity;
    if (battSoc) settings.batterySocEntity = battSoc; else delete settings.batterySocEntity;
    const schwelle = grab('setEnergyThreshold');
    if (schwelle !== '' && !isNaN(parseFloat(schwelle))) settings.energyThreshold = Math.abs(parseFloat(schwelle));
    else delete settings.energyThreshold;
    settings.energyBatteryInvert = !!($('setEnergyBatteryInvert') && $('setEnergyBatteryInvert').checked);
    [['setEnergyLabelSolar', 'energyLabelSolar'], ['setEnergyLabelGrid', 'energyLabelGrid'],
     ['setEnergyLabelHome', 'energyLabelHome'], ['setEnergyLabelBattery', 'energyLabelBattery']]
      .forEach(([id, feld]) => { const v = grab(id); if (v) settings[feld] = v; else delete settings[feld]; });
  }
  if (settingsFields.photoUpload) {
    const v = ($('setPhotoSeconds') && $('setPhotoSeconds').value.trim()) || '';
    if (v !== '' && !isNaN(parseInt(v, 10))) settings.photoSeconds = Math.max(3, Math.min(3600, parseInt(v, 10)));
    else delete settings.photoSeconds;
  }
  if (settingsFields.mediaPlayerOpts) {
    settings.mediaArtBg = $('setMediaArtBg') ? $('setMediaArtBg').checked : true;
    settings.mediaShowSource = $('setMediaShowSource') ? $('setMediaShowSource').checked : true;
    settings.mediaShowProgress = $('setMediaShowProgress') ? $('setMediaShowProgress').checked : true;
  }
  entry.settings = settings;
  // Erst jetzt umhaengen -- bis hierher wurde der Eintrag noch ueber die alte Kennung
  // gefunden.
  if (neueEntitaet) {
    entry.entity_id = neueEntitaet;
    settingsEntityId = neueEntitaet;
  }
  markDirty();
  $('settingsModal').classList.remove('show');
  render();
});

// --- Picker: erst Kartentyp, dann passende Entitaet (oder Ziel-Dashboard bei Navigation) ---
function openPicker() {
  duplicateSourceId = null;
  $('picker').classList.add('show');
  wegZeigen('entitaet');
}

/**
 * Der Weg "Entitaet zuerst".
 *
 * Wer weiss, WAS er anzeigen will, soll danach suchen duerfen. Vorher gab es nur "Kartentyp
 * zuerst" -- und dort muss man raten, unter welchem der dreissig Typen die eigene Entitaet
 * einsortiert ist. Welcher Kartentyp passt, weiss die App selbst (defaultCardType); aendern
 * laesst er sich danach an der Karte.
 */
function entitaetsWegRendern(query) {
  const q = String(query || '').toLowerCase();
  const vorhanden = currentLayout.map(l => l.entity_id);
  const liste = allEntities
    .filter(e => !vorhanden.includes(e.entity_id))
    .filter(e => e.name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q))
    .slice(0, 200);   // eine Liste mit tausend Zeilen sucht niemand durch
  const el = $('entitaetListe');
  el.innerHTML = '';
  if (!liste.length) {
    el.innerHTML = '<p style="font-size:1.3vh; color:var(--muted);">Keine passenden Entitäten gefunden.</p>';
    return;
  }
  liste.forEach(e => {
    const typ = DashboardRender.defaultCardType(e.entity_id, statesById[e.entity_id]);
    const row = document.createElement('div');
    row.className = 'picker-item';
    row.innerHTML = `<span>${e.name}</span>`
      + `<span class="typ">${(CARD_TYPES[typ] || {}).label || typ}</span>`
      + `<span class="domain">${e.domain}</span>`;
    row.addEventListener('click', () => kartenEintragAnlegen(e.entity_id, typ, {}));
    el.appendChild(row);
  });
}

function wegZeigen(weg) {
  if (weg === 'typ') {
    // Das Raster wird in showTypeStep() GEFUELLT -- nur die Sichtbarkeit umzuschalten ergab
    // einen leeren Tab. Genau so war er nach dem Umbau: Die Kartentypen waren weg.
    $('entitaetStep').style.display = 'none';
    showTypeStep();
    return;
  }
  $('entitaetStep').style.display = '';
  $('typeGrid').style.display = 'none';
  $('entityStep').style.display = 'none';
  document.querySelectorAll('#pickerWege .weg').forEach(b => b.classList.toggle('aktiv', b.dataset.weg !== 'typ'));
  $('pickerTitle').textContent = 'Karte hinzufügen';
  $('entitaetFilter').value = '';
  entitaetsWegRendern('');
  $('entitaetFilter').focus();
}

document.querySelectorAll('#pickerWege .weg').forEach(b => {
  b.addEventListener('click', () => wegZeigen(b.dataset.weg));
});
$('entitaetFilter').addEventListener('input', e => entitaetsWegRendern(e.target.value));

function showTypeStep() {
  pickerType = null;
  $('pickerTitle').textContent = 'Karte hinzufügen';
  $('entityStep').style.display = 'none';
  $('entitaetStep').style.display = 'none';
  const grid = $('typeGrid');
  grid.style.display = 'grid';
  document.querySelectorAll('#pickerWege .weg').forEach(b => b.classList.toggle('aktiv', b.dataset.weg === 'typ'));
  grid.innerHTML = '';
  PICKER_TYPES.forEach(t => {
    const tile = document.createElement('div');
    tile.className = 'type-tile';
    tile.innerHTML = `${ICONS[t] || ICONS.generic}<span>${CARD_TYPES[t].label}</span>`;
    tile.addEventListener('click', () => {
      if (t === 'navigate') addNavigateCard();
      else if (t === 'energy') addEnergyCard();
      else if (t === 'photo') addPhotoCard();
      else if (t === 'quicktiles') addQuickTilesCard();
      // Die Uhr braucht keine Entitaet. Sie stand seit 1.5.0 in der Auswahl, fuehrte aber in
      // den Entitaetsschritt -- und der zeigt fuer sie eine LEERE Liste, weil domainsForType
      // ein leeres Feld liefert. Die Karte liess sich also anwaehlen und nie anlegen.
      else if ((domainsForType(t) || []).length === 0) {
        kartenEintragAnlegen(eigeneKartenKennung(t), t, {});
      }
      else showEntityStep(t);
    });
    grid.appendChild(tile);
  });
}

/**
 * Legt eine neue Karte an -- entweder im Raster oder in der unteren Leiste.
 *
 * Vorher stand dieselbe Push-Logik fuenfmal im Code: viermal fuer Karten ohne Entitaet und
 * einmal in der Entitaetsauswahl. Fuer die Unterleiste haette sie ein sechstes Mal
 * dazugemusst -- und beim naechsten Kartentyp ein siebtes.
 */
function kartenEintragAnlegen(entity_id, type, settings, einstellungenOeffnen = true) {
  if (unterleisteWahl) {
    unterleisteWahl = false;
    // In die Leiste passt genau eine Karte. Eine vorhandene wird ersetzt, statt still eine
    // zweite anzulegen, die niemand zu sehen bekaeme.
    currentLayout = currentLayout.filter(e => !e.unterleiste);
    currentLayout.push({
      entity_id, order: currentLayout.length, card_type: type,
      unterleiste: true, settings: settings || {}
    });
  } else {
    const span = clampSpan(sizeToSpan(defaultSize(type)), type);
    const pos = findFreeSpot(span.cols, span.rows, type);
    if (!pos) {
      $('picker').classList.remove('show');
      alert('Kein Platz mehr im Raster. Erst eine Karte entfernen oder verkleinern – '
        + 'oder die Karte über „+ Karte für die untere Leiste“ in den Streifen darunter legen.');
      return;
    }
    currentLayout.push({
      entity_id, order: currentLayout.length, card_type: type,
      cols: pos.cols, rows: pos.rows, x: pos.x, y: pos.y, settings: settings || {}
    });
  }
  markDirty();
  $('picker').classList.remove('show');
  render();

  // Gleich die Einstellungen aufmachen.
  //
  // Wer eine Karte anlegt, hat sie noch nicht so, wie er sie haben will: Name, Nachkommastellen,
  // Symbol, bei manchen Typen sogar die eigentlichen Entitaeten. Bisher musste man die Karte
  // erst im Raster suchen und das Zahnrad treffen -- auf einer 1x1-Kachel ein kleines Ziel.
  //
  // Wer nichts aendern will, drueckt Abbrechen; die Karte bleibt in jedem Fall.
  if (einstellungenOeffnen) openSettings(entity_id);
}

/** Eine eindeutige Kennung fuer Karten, die keine Home-Assistant-Entitaet haben. */
function eigeneKartenKennung(type) {
  return type + ':' + Date.now();
}

function addNavigateCard() {
  kartenEintragAnlegen(eigeneKartenKennung('navigate'), 'navigate',
    { targetDashboardId: 'main', targetDashboardName: 'Hauptdashboard' });
}

function addEnergyCard() {
  kartenEintragAnlegen(eigeneKartenKennung('energy'), 'energy', {});
}

function addPhotoCard() {
  kartenEintragAnlegen(eigeneKartenKennung('photo'), 'photo', {});
}

function addQuickTilesCard() {
  kartenEintragAnlegen(eigeneKartenKennung('quicktiles'), 'quicktiles', { tiles: [] });
}

function showEntityStep(type) {
  pickerType = type;
  $('pickerTitle').textContent = CARD_TYPES[type].label + ' – Entität wählen';
  $('typeGrid').style.display = 'none';
  $('entitaetStep').style.display = 'none';
  $('entityStep').style.display = '';   // Layout kommt aus dem CSS (Flex-Spalte, scrollbar)
  $('pickerFilter').value = '';
  renderPickerList('');
  $('pickerFilter').focus();
}

$('pickerBack').addEventListener('click', () => { duplicateSourceId = null; showTypeStep(); });

function renderPickerList(query) {
  const q = query.toLowerCase();
  const existingIds = currentLayout.map(l => l.entity_id);
  const doms = domainsForType(pickerType);
  const list = allEntities
    .filter(e => !existingIds.includes(e.entity_id))
    .filter(e => doms === null || doms.includes(e.domain))
    .filter(e => e.name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q));
  const el = $('pickerList');
  el.innerHTML = '';
  if (!list.length) {
    el.innerHTML = '<p style="font-size:1.3vh; color:var(--muted);">Keine passenden Entitäten gefunden.</p>';
    return;
  }
  list.forEach(e => {
    const row = document.createElement('div');
    row.className = 'picker-item';
    row.innerHTML = `<span>${e.name}</span><span class="domain">${e.domain}</span>`;
    row.addEventListener('click', () => {
      let settings = {};
      if (duplicateSourceId) {
        const src = currentLayout.find(l => l.entity_id === duplicateSourceId);
        if (src) settings = JSON.parse(JSON.stringify(src.settings || {}));
      }
      duplicateSourceId = null;
      kartenEintragAnlegen(e.entity_id, pickerType, settings);
    });
    el.appendChild(row);
  });
}

$('pickerFilter').addEventListener('input', e => renderPickerList(e.target.value));
$('pickerClose').addEventListener('click', () => {
  duplicateSourceId = null;
  unterleisteWahl = false;   // sonst landet die naechste Karte ungewollt in der Leiste
  $('picker').classList.remove('show');
});

$('saveBtn').addEventListener('click', async () => {
  const resultEl = $('saveResult');
  resultEl.textContent = 'Speichere...';
  resultEl.className = 'save-result';
  const layout = currentLayout.map((l, i) => ({ ...l, order: i }));
  const url = DASHBOARD_ID === 'main' ? '/api/config' : `/api/dashboards/${DASHBOARD_ID}`;
  const body = DASHBOARD_ID === 'main'
    ? { entities: layout.map(l => l.entity_id), layout }
    : { layout };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (data.ok) {
    resultEl.textContent = 'Gespeichert – Wall Display aktualisiert sich automatisch.';
    resultEl.className = 'save-result ok';
    isDirty = false;
  } else {
    resultEl.textContent = 'Fehler: ' + data.error;
    resultEl.className = 'save-result err';
  }
});

loadAll();
setInterval(refreshStates, 15000);

// --- Escape schliesst den obersten Dialog ------------------------------------------------------
//
// Gemeldet: "Escape im Pop-up macht nichts". Geschlossen wird ueber den jeweiligen Knopf
// (.click()) und nicht ueber classList: Die Knoepfe raeumen mehr auf als nur die Sichtbarkeit --
// "Schliessen" im Auswahldialog setzt z. B. die Unterleisten-Wahl zurueck, sonst landete die
// naechste Karte ungewollt dort. Zwei Wege zum Schliessen, die Verschiedenes tun, liefen
// frueher oder spaeter auseinander.
//
// Reihenfolge = Stapelung: Die Verlassen-Warnung liegt ueber allem, die Einstellungen oeffnen
// sich nach dem Anlegen ueber dem schon geschlossenen Auswahldialog.
const ESCAPE_REIHENFOLGE = [
  ['leaveWarnModal', 'leaveWarnCancel'],
  ['settingsModal', 'settingsCancel'],
  ['helpModal', 'helpModalClose'],
  ['picker', 'pickerClose']
];
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const offen = ESCAPE_REIHENFOLGE.find(([dialog]) => $(dialog) && $(dialog).classList.contains('show'));
  if (!offen) return;
  e.preventDefault();
  $(offen[1]).click();
});

// --- Hilfe-Popup statt Fließtext, eigene Verlassen-Warnung statt Browser-Standarddialog ---
$('helpBtn').addEventListener('click', () => $('helpModal').classList.add('show'));
$('helpModalClose').addEventListener('click', () => $('helpModal').classList.remove('show'));

let pendingNavHref = null;
document.querySelectorAll('.hawall-nav-links a').forEach(a => {
  a.addEventListener('click', (e) => {
    if (isDirty) {
      e.preventDefault();
      pendingNavHref = a.getAttribute('href');
      $('leaveWarnModal').classList.add('show');
    }
  });
});
$('leaveWarnCancel').addEventListener('click', () => {
  $('leaveWarnModal').classList.remove('show');
  pendingNavHref = null;
});
$('leaveWarnConfirm').addEventListener('click', () => {
  $('leaveWarnModal').classList.remove('show');
  if (pendingNavHref) location.href = pendingNavHref;
});
