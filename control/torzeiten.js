// Wie lange ein Tor zum Öffnen und Schließen braucht -- gemessen, nicht geraten.
//
// WARUM
//
// Die Flügeltor-Karte lief anfangs in einer festen Schleife von gut drei Sekunden. Das sagt
// "es bewegt sich", aber nicht "es ist halb offen". Ein Hoftor braucht fünfzehn bis dreißig
// Sekunden; wer davorsteht, will wissen, ob er losfahren kann oder noch warten muss.
//
// Beobachtet wird deshalb der erste Durchlauf: Wie lange dauert es von `opening` bis `open`,
// wie lange bleibt es offen, wie lange von `closing` bis `closed`. Danach läuft die Animation
// genau so lange wie das Tor -- und weil Home Assistant mit `last_changed` sagt, WANN die
// Bewegung begann, steht der Flügel an der Stelle, an der er wirklich steht.
//
// WARUM IM SERVER UND NICHT IN DER ANZEIGE
//
// Der Server hält die WebSocket-Verbindung dauerhaft offen. Die Anzeige nicht: Nachts ist das
// Panel aus, und genau dann fährt ein Hoftor am ehesten. Eine Messung, die nur zustande kommt,
// wenn jemand hinsieht, käme nie zustande.
//
// WAS NICHT GEMESSEN WIRD
//
// Alles, was unplausibel ist. Ein Tor, das laut Messung vier Stunden zum Öffnen braucht, hat
// nicht vier Stunden gebraucht -- da ist eine Meldung verloren gegangen, der Server wurde neu
// gestartet oder jemand hat mittendrin gestoppt. So ein Wert würde die Animation für immer
// unbrauchbar machen, und niemand käme auf die Idee, dort nach der Ursache zu suchen.

// Grenzen einer glaubhaften Messung, in Sekunden. Unter zwei Sekunden ist es kein Torantrieb,
// über fünf Minuten keine Fahrt.
const MIN_SEKUNDEN = 2;
const MAX_SEKUNDEN = 300;

// Wie lange ein Tor offen bleibt, darf länger dauern -- bis zu einem halben Tag.
const MAX_OFFEN_SEKUNDEN = 12 * 3600;

/** Ist das eine glaubhafte Fahrzeit? */
function fahrzeitGueltig(sekunden) {
  return Number.isFinite(sekunden) && sekunden >= MIN_SEKUNDEN && sekunden <= MAX_SEKUNDEN;
}

/**
 * Verarbeitet einen Zustandswechsel und liefert, was daraus zu lernen war.
 *
 * Reine Rechnung ohne Uhr und ohne Speicher: Der Aufrufer hält den vorigen Zustand und die
 * bisherigen Zeiten. Genau deshalb lässt sich das hier prüfen, ohne ein Tor zu haben.
 *
 * @param {object} p
 * @param {string} p.vorher        voriger Zustand ('' = keiner bekannt)
 * @param {number} p.vorherSeit    seit wann, in ms
 * @param {string} p.jetzt         neuer Zustand
 * @param {number} p.jetztZeit     Zeitpunkt des Wechsels in ms
 * @param {object} p.bisher        bisher gemessene Zeiten { oeffnen, schliessen, offen }
 * @returns {object|null} die neuen Zeiten, oder null wenn nichts zu lernen war
 */
function messen(p) {
  const vorher = String(p.vorher || '').toLowerCase();
  const jetzt = String(p.jetzt || '').toLowerCase();
  // Null ist ein gueltiger Zeitpunkt. Ein `!p.vorherSeit` haette jede Messung verworfen, die
  // bei null anfaengt -- im Betrieb faellt das nie auf, im Test sofort.
  if (!vorher || p.vorherSeit === undefined || p.vorherSeit === null) return null;
  const dauer = (Number(p.jetztZeit) - Number(p.vorherSeit)) / 1000;
  if (!(dauer > 0)) return null;

  const neu = Object.assign({}, p.bisher || {});
  let gelernt = false;

  if (vorher === 'opening' && jetzt === 'open' && fahrzeitGueltig(dauer)) {
    neu.oeffnen = Math.round(dauer * 10) / 10;
    gelernt = true;
  }
  if (vorher === 'closing' && jetzt === 'closed' && fahrzeitGueltig(dauer)) {
    neu.schliessen = Math.round(dauer * 10) / 10;
    gelernt = true;
  }
  // Wie lange es offen stand. Nicht fuer die Animation, aber es beantwortet die Frage, die
  // man sich beim Blick auf die Karte als naechstes stellt: "steht das schon lange offen?"
  if (vorher === 'open' && (jetzt === 'closing' || jetzt === 'closed')
      && dauer >= 1 && dauer <= MAX_OFFEN_SEKUNDEN) {
    neu.offen = Math.round(dauer);
    gelernt = true;
  }

  if (!gelernt) return null;
  neu.gemessen = new Date(Number(p.jetztZeit)).toISOString();
  return neu;
}

/**
 * Führt die Beobachtung für viele Entitäten.
 *
 * Hält den zuletzt gesehenen Zustand je Entität im Speicher -- die Zeiten selbst gehören in
 * den Store des Aufrufers, damit ein Neustart die Kalibrierung nicht vergisst.
 */
class TorBeobachter {
  constructor({ laden, speichern }) {
    this.laden = laden || (() => ({}));
    this.speichern = speichern || (() => {});
    this.letzte = new Map();
  }

  /** Meldet einen Zustandswechsel. Liefert true, wenn etwas dazugelernt wurde. */
  gemeldet(entityId, zustand, jetztZeit = Date.now()) {
    if (!entityId || !String(entityId).startsWith('cover.')) return false;
    const neuerZustand = String(zustand || '').toLowerCase();
    const vorige = this.letzte.get(entityId);

    // Derselbe Zustand noch einmal: Die Uhr darf NICHT zurueckgesetzt werden. Home Assistant
    // meldet auch dann, wenn sich nur ein Attribut geaendert hat -- bei einem Tor passiert das
    // waehrend der Fahrt staendig (current_position). Wer hier die Zeit neu stellt, misst nicht
    // die Fahrt, sondern den Abstand zur letzten Positionsmeldung, und das Tor "faehrt" laut
    // Messung zwei Sekunden.
    if (vorige && vorige.zustand === neuerZustand) return false;

    this.letzte.set(entityId, { zustand: neuerZustand, seit: jetztZeit });
    if (!vorige) return false;

    const alle = this.laden() || {};
    const neu = messen({
      vorher: vorige.zustand, vorherSeit: vorige.seit,
      jetzt: neuerZustand, jetztZeit,
      bisher: alle[entityId]
    });
    if (!neu) return false;
    alle[entityId] = neu;
    this.speichern(alle);
    return true;
  }
}

module.exports = { messen, fahrzeitGueltig, TorBeobachter, MIN_SEKUNDEN, MAX_SEKUNDEN, MAX_OFFEN_SEKUNDEN };
