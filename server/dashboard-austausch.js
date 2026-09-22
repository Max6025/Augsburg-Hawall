// Dashboards als Datei aus- und wieder eingeben.
//
// Warum ein EIGENES Format und nicht einfach die gespeicherte Struktur?
//
// Zwei Gruende, und der zweite ist der wichtige:
//
// 1. Die gespeicherte Struktur ist Innenleben. Sie enthaelt `order` aus der Zeit vor dem
//    Raster, `size` aus der Zeit vor frei ziehbaren Karten, und Schluesselnamen, die niemand
//    erklaeren muss, weil sie nie jemand liest. In einer Datei, die ein Mensch oeffnet und
//    ein Sprachmodell schreiben soll, ist das Ballast.
//
// 2. **Ein Export darf nicht auf Dateien verweisen, die nicht mitkommen.** Foto-Karten
//    speichern nur eine Versionsnummer; das Bild selbst liegt auf dem Geraet. Wer die
//    Rohstruktur exportiert und woanders einspielt, bekommt Karten mit kaputten
//    Bildverweisen -- und zwar lautlos. Deshalb werden solche Felder beim Export bewusst
//    entfernt und im Ergebnis vermerkt, damit man es WEISS statt es spaeter zu entdecken.
//
// Das Format traegt seine eigene Anleitung (`_anleitung`). Wer die Datei in einen Chat
// wirft und "bau mir noch eine Karte fuer die Waschmaschine dazu" sagt, hat damit alles
// beisammen, was man zum Schreiben einer gueltigen Datei braucht: die erlaubten Kartenarten,
// die Rastergroesse und ein Beispiel. Ohne das raet ein Modell die Kartennamen -- und liegt
// daneben.

const FORMAT = 'augsburg-wall-display/dashboard';

// Das Format der Vorlage wird beim Import MITGELESEN, aber nie geschrieben.
//
// Der Grund ist handfest: Auf dem Schwesterngeraet in Italien liegen fertige Dashboards, und
// die sollen sich hierher kopieren lassen, ohne dass jemand von Hand eine Zeile in der Datei
// aendert. Wer eine Datei ablehnt, die er problemlos lesen koennte, erzeugt genau die Sorte
// Handarbeit, bei der danach etwas anderes kaputt ist.
//
// Umgekehrt gilt das NICHT: Exportiert wird nur das eigene Format. Eine Datei von hier auf
// dem Italien-Geraet einzuspielen kann schiefgehen -- dort gibt es Kartenarten, die es hier
// nicht mehr gibt, und umgekehrt.
const FORMAT_VORLAGE = 'italien-wall-display/dashboard';
const FORMATE_LESBAR = [FORMAT, FORMAT_VORLAGE];
const VERSION = 1;

// Muss zum Editor passen (MAX_ROWS dort) und zum Raster in dashboard.css.
const SPALTEN = 4;
const ZEILEN = 6;

// Felder, die auf etwas auf DIESEM Geraet zeigen und deshalb nicht mitreisen koennen.
const NICHT_UEBERTRAGBAR = {
  photoVersion: 'Foto-Karte: das Bild liegt auf dem Gerät',
  photoBilder: 'Foto-Karte: die Bilder liegen auf dem Gerät'
};

function istZahl(v) { return typeof v === 'number' && Number.isFinite(v); }

/**
 * Baut die Austauschdatei aus einem gespeicherten Dashboard.
 *
 * Gibt `{ datei, hinweise }` zurueck. `hinweise` nennt alles, was NICHT mitgeht -- diese
 * Liste gehoert dem Nutzer angezeigt, nicht verschluckt.
 */
function exportieren(dashboard, kartenArten) {
  const d = dashboard || {};
  const hinweise = [];
  const karten = (Array.isArray(d.layout) ? d.layout : []).map((e) => {
    const einstellungen = Object.assign({}, e.settings || {});

    Object.keys(NICHT_UEBERTRAGBAR).forEach((feld) => {
      if (einstellungen[feld] !== undefined) {
        delete einstellungen[feld];
        const grund = NICHT_UEBERTRAGBAR[feld];
        if (!hinweise.includes(grund)) hinweise.push(grund);
      }
    });

    // Kachelbilder im Schnellzugriff stecken als Base64 direkt in den Einstellungen. Sie
    // KOENNTEN mitreisen, machen die Datei aber um ein Vielfaches groesser und sind in einem
    // Chatfenster unbrauchbar. Also raus, mit Vermerk.
    if (Array.isArray(einstellungen.tiles)) {
      let hatBilder = false;
      einstellungen.tiles = einstellungen.tiles.map((t) => {
        const kopie = Object.assign({}, t);
        if (kopie.imageDataUrl) { hatBilder = true; delete kopie.imageDataUrl; }
        return kopie;
      });
      if (hatBilder) {
        const grund = 'Schnellzugriff: die Kachelbilder werden nicht mit übertragen';
        if (!hinweise.includes(grund)) hinweise.push(grund);
      }
    }

    // Die Karte der unteren Leiste sitzt nicht im Raster. Ohne dieses Feld ginge die
    // Zuordnung beim Export verloren, und beim Einspielen laege sie ploetzlich im Raster --
    // an einem Platz, den sie jemandem wegnimmt.
    const karte = e.unterleiste
      ? { entitaet: e.entity_id, art: e.card_type || 'sensor', unten: true }
      : {
        entitaet: e.entity_id,
        art: e.card_type || 'sensor',
        x: istZahl(e.x) ? e.x : 0,
        y: istZahl(e.y) ? e.y : 0,
        spalten: istZahl(e.cols) ? e.cols : 1,
        zeilen: istZahl(e.rows) ? e.rows : 1
      };
    if (Object.keys(einstellungen).length) karte.einstellungen = einstellungen;
    return karte;
  });

  const datei = {
    format: FORMAT,
    version: VERSION,
    name: d.name || 'Dashboard',
    art: d.type === 'tracker' ? 'tracker' : 'karten',
    karten
  };

  if (datei.art === 'tracker') {
    datei.tracker = { entitaet: d.trackerEntity || '' };
    if (d.trackerIconDataUrl) {
      hinweise.push('Tracker: das eigene Symbolbild wird nicht mit übertragen');
    }
  }

  datei._anleitung = anleitung(kartenArten);
  return { datei, hinweise };
}

/**
 * Die mitgelieferte Anleitung.
 *
 * Sie steht IN der Datei und nicht in einer Dokumentation daneben, weil die Datei allein
 * unterwegs ist: in einem Chatfenster, in einer Mail, auf einem USB-Stick. Was dort nicht
 * drinsteht, ist nicht da.
 */
function anleitung(kartenArten) {
  const arten = kartenArten || {};
  return {
    wozu: 'Ein Dashboard für Augsburg Wall Display. Diese Datei lässt sich unter '
      + '"Unterdashboards" wieder einspielen.',
    raster: `${SPALTEN} Spalten mal ${ZEILEN} Zeilen. x zählt von links ab 0, y von oben ab 0. `
      + 'Karten dürfen sich nicht überlappen und nicht über den Rand hinausragen.',
    untereLeiste: 'Eine Karte darf statt x/y/spalten/zeilen das Feld "unten": true tragen. Sie '
      + 'sitzt dann in dem schmalen Streifen unter dem Raster, über die ganze Breite. Dort '
      + 'passt genau eine Karte – typisch die Uhr.',
    entitaet: 'Die entity_id aus Home Assistant, z.B. "light.kueche". Muss es dort wirklich '
      + 'geben – erfundene Entitäten erscheinen als leere Karte.',
    einstellungen: 'Optional, je Kartenart verschieden. "name" gibt es überall und ersetzt den '
      + 'Namen aus Home Assistant.',
    kartenarten: Object.keys(arten).map((k) => `${k} – ${(arten[k] || {}).label || k}`),
    beispiel: {
      entitaet: 'light.kueche',
      art: 'light',
      x: 0, y: 0, spalten: 1, zeilen: 1,
      einstellungen: { name: 'Deckenlicht' }
    }
  };
}

/**
 * Prueft eine eingelesene Datei und baut daraus ein Dashboard.
 *
 * Gibt `{ ok, dashboard, fehler, warnungen }` zurueck. Fehler halten den Import auf,
 * Warnungen nicht.
 *
 * Streng bei allem, was stillschweigend schiefgehen wuerde -- eine Karte mit unbekannter Art
 * waere spaeter eine leere Kachel, und niemand wuesste warum. Nachsichtig bei allem, was sich
 * geradebiegen laesst: Eine Karte, die zu weit rechts sitzt, wird geschoben statt abgelehnt.
 * Ein Sprachmodell verrechnet sich beim Raster, nicht bei den Kartennamen.
 */
function importieren(roh, kartenArten) {
  const fehler = [];
  const warnungen = [];
  const arten = kartenArten || {};

  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) {
    return { ok: false, fehler: ['Die Datei enthält kein Dashboard.'], warnungen };
  }
  if (roh.format && !FORMATE_LESBAR.includes(roh.format)) {
    fehler.push(`Unbekanntes Format "${roh.format}" – erwartet wird "${FORMAT}".`);
  }
  if (roh.version && Number(roh.version) > VERSION) {
    fehler.push(`Die Datei ist für eine neuere Fassung gedacht (Version ${roh.version}).`);
  }
  if (!Array.isArray(roh.karten)) {
    fehler.push('Es fehlt die Liste "karten".');
    return { ok: false, fehler, warnungen };
  }
  if (fehler.length) return { ok: false, fehler, warnungen };

  const belegt = [];
  const layout = [];

  roh.karten.forEach((k, i) => {
    const nr = i + 1;
    if (!k || typeof k !== 'object') { fehler.push(`Karte ${nr}: kein Objekt.`); return; }

    const art = k.art || k.card_type;
    if (!art) { fehler.push(`Karte ${nr}: es fehlt "art".`); return; }
    if (!arten[art]) {
      fehler.push(`Karte ${nr}: "${art}" ist keine bekannte Kartenart.`);
      return;
    }

    const entitaet = k.entitaet || k.entity_id;
    // Uhr, Energiefluss, Foto und Schnellzugriff brauchen keine Entitaet -- sie bekommen
    // beim Anlegen eine eigene Kennung.
    const brauchtEntitaet = !['clock', 'energy', 'photo', 'quicktiles', 'navigate'].includes(art);
    if (brauchtEntitaet && (typeof entitaet !== 'string' || !entitaet.trim())) {
      fehler.push(`Karte ${nr} (${art}): es fehlt "entitaet".`);
      return;
    }

    // "unten" heisst: nicht ins Raster, sondern in den Streifen darunter. Dort passt genau
    // eine Karte -- eine zweite wird abgelehnt statt still verschluckt.
    if (k.unten || k.unterleiste) {
      if (layout.some(x => x.unterleiste)) {
        warnungen.push(`Karte ${nr}: es passt nur eine Karte in die untere Leiste – ausgelassen.`);
        return;
      }
      const eintragUnten = {
        entity_id: (typeof entitaet === 'string' && entitaet.trim()) ? entitaet.trim() : eigeneKennung(art),
        card_type: art, order: layout.length, unterleiste: true
      };
      const eu = k.einstellungen || k.settings;
      if (eu && typeof eu === 'object' && !Array.isArray(eu)) {
        const kopie = Object.assign({}, eu);
        Object.keys(NICHT_UEBERTRAGBAR).forEach((f) => delete kopie[f]);
        if (Object.keys(kopie).length) eintragUnten.settings = kopie;
      }
      layout.push(eintragUnten);
      return;
    }

    const zahl = (v, ersatz) => (istZahl(v) ? v : (istZahl(Number(v)) ? Number(v) : ersatz));
    let spalten = Math.max(1, Math.min(SPALTEN, Math.round(zahl(k.spalten !== undefined ? k.spalten : k.cols, 1))));
    let zeilen = Math.max(1, Math.min(ZEILEN, Math.round(zahl(k.zeilen !== undefined ? k.zeilen : k.rows, 1))));
    let x = Math.max(0, Math.round(zahl(k.x, 0)));
    let y = Math.max(0, Math.round(zahl(k.y, 0)));

    if (x + spalten > SPALTEN) { x = Math.max(0, SPALTEN - spalten); warnungen.push(`Karte ${nr}: nach links gerückt, sie ragte über den Rand.`); }
    if (y + zeilen > ZEILEN) { y = Math.max(0, ZEILEN - zeilen); warnungen.push(`Karte ${nr}: nach oben gerückt, sie ragte über den Rand.`); }

    const platz = freierPlatz(belegt, x, y, spalten, zeilen);
    if (!platz) {
      warnungen.push(`Karte ${nr}: kein freier Platz mehr im Raster – ausgelassen.`);
      return;
    }
    if (platz.x !== x || platz.y !== y) {
      warnungen.push(`Karte ${nr}: verschoben, der gewünschte Platz war belegt.`);
    }
    belegt.push({ x: platz.x, y: platz.y, cols: spalten, rows: zeilen });

    const eintrag = {
      entity_id: brauchtEntitaet ? entitaet.trim() : (entitaet || eigeneKennung(art)),
      card_type: art,
      order: layout.length,
      x: platz.x, y: platz.y, cols: spalten, rows: zeilen
    };
    const einstellungen = k.einstellungen || k.settings;
    if (einstellungen && typeof einstellungen === 'object' && !Array.isArray(einstellungen)) {
      const kopie = Object.assign({}, einstellungen);
      // Auch beim IMPORT raus: Eine Datei koennte sie mitbringen, aber die Bilder gibt es
      // hier nicht -- der Verweis zeigte dann auf nichts.
      Object.keys(NICHT_UEBERTRAGBAR).forEach((f) => delete kopie[f]);
      if (Object.keys(kopie).length) eintrag.settings = kopie;
    }
    layout.push(eintrag);
  });

  if (fehler.length) return { ok: false, fehler, warnungen };

  const dashboard = {
    name: (typeof roh.name === 'string' && roh.name.trim()) ? roh.name.trim() : 'Importiert',
    type: (roh.art === 'tracker' || roh.type === 'tracker') ? 'tracker' : 'cards',
    layout
  };
  if (dashboard.type === 'tracker') {
    dashboard.trackerEntity = (roh.tracker && roh.tracker.entitaet) || roh.trackerEntity || '';
  }
  return { ok: true, dashboard, fehler, warnungen };
}

function eigeneKennung(art) {
  return art + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function ueberlappt(a, b) {
  return a.x < b.x + b.cols && a.x + a.cols > b.x && a.y < b.y + b.rows && a.y + a.rows > b.y;
}

/** Der Wunschplatz, sonst der naechste freie -- zeilenweise von oben links. */
function freierPlatz(belegt, x, y, cols, rows) {
  const passt = (px, py) => !belegt.some(b => ueberlappt({ x: px, y: py, cols, rows }, b));
  if (passt(x, y)) return { x, y };
  for (let py = 0; py <= ZEILEN - rows; py++) {
    for (let px = 0; px <= SPALTEN - cols; px++) {
      if (passt(px, py)) return { x: px, y: py };
    }
  }
  return null;
}

module.exports = { exportieren, importieren, anleitung, FORMAT, FORMAT_VORLAGE, FORMATE_LESBAR, VERSION, SPALTEN, ZEILEN };
