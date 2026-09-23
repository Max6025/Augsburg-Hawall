'use strict';

/**
 * Die Windows-Tastenkombinationen schlucken, solange die Taskleiste versteckt sein soll.
 *
 * WARUM NICHT UEBER DIE REGISTRY
 *
 * `NoWinKeys` waere der naheliegende Weg und ist **unmoeglich**. Gemessen am 2026-09-23 auf dem
 * Surface Go: `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies` und
 * `HKCU\\Software\\Policies` geben dem Benutzerkonto nur `ReadKey` -- Vollzugriff haben allein
 * SYSTEM und die Gruppe Administratoren, und die App laeuft unelevert.
 *
 * Diese Messung ist beim ersten Anlauf schiefgegangen, und zwar auf eine Art, die man kennen
 * sollte: Geprueft wurde ueber SSH, und **OpenSSH gibt einem Administratorkonto ein volles
 * Token ohne UAC-Filterung** (`IsInRole(Administrator)` ist dort `True`). Die Sperre liess sich
 * in der SSH-Sitzung setzen und scheiterte in der App -- im Protokoll stand dann zweimal
 * "Zugriff verweigert" fuer etwas, das gerade noch funktioniert hatte. Wer hier etwas an der
 * Registry prueft, prueft es **unelevert**, sonst prueft er das Falsche.
 *
 * WAS STATTDESSEN
 *
 * `globalShortcut` von Electron. Windows vergibt eine Tastenkombination an den Prozess, der sie
 * zuerst anfordert, und das braucht keine erhoehten Rechte. Zwei Vorteile gegenueber der
 * Registry, die schwerer wiegen als der Umstand:
 *
 * 1. **Nichts bleibt liegen.** Die Anforderung haengt am Prozess. Stuerzt die App ab, sind die
 *    Tasten sofort wieder da -- eine Registry-Sperre wuerde ein Geraet zurueeklassen, an dem
 *    Win+E nicht mehr geht und niemand weiss, warum.
 * 2. **Kein Explorer-Neustart.** Die Registry-Sperren greifen erst danach.
 *
 * Was NICHT geht: die Windows-Taste allein (Windows behaelt sie fuer sich) und Win+L. Die
 * nackte Taste faengt der Fokus-Rueckholer ab (control/vordergrund.js), das Sperren des
 * Bildschirms soll ausdruecklich moeglich bleiben.
 */

// Reihenfolge nach Schaden, nicht nach Alphabet -- das Erste ist das Wichtigste.
const KOMBINATIONEN = [
  ['Super+M', 'Alle Fenster minimieren -- danach schaut man auf den nackten Desktop'],
  ['Super+D', 'Desktop anzeigen -- dasselbe'],
  ['Super+A', 'Schnelleinstellungen'],
  ['Super+N', 'Benachrichtigungscenter'],
  ['Super+C', 'Copilot'],
  ['Super+X', 'Das Menue an der Startschaltflaeche'],
  ['Super+E', 'Explorer'],
  ['Super+R', 'Ausfuehren'],
  ['Super+I', 'Einstellungen'],
  ['Super+S', 'Suche'],
  ['Super+Q', 'Suche'],
  ['Super+K', 'Uebertragen'],
  ['Super+P', 'Projizieren'],
  ['Super+B', 'Infobereich der Taskleiste'],
  ['Super+Tab', 'Task-Ansicht'],
  ['Super+Down', 'Fenster verkleinern']
];

/**
 * Sollen die Kombinationen gerade geschluckt werden?
 *
 * Dieselbe Regel wie beim Fokus-Rueckholer, und aus demselben Grund: Laeuft eine Wartung, ist
 * die Taskleiste absichtlich da, und wer davor steht, braucht Win+E.
 */
function sollGreifen(state) {
  return !(state && state.taskleisteBis);
}

/**
 * Den Soll-Zustand herstellen. `greifen`/`freigeben` kommen von aussen, damit dieses Modul
 * ohne Electron laeuft.
 *
 * Gibt zurueck, was sich geaendert hat -- und was Windows NICHT hergegeben hat. Ein stilles
 * `false` von `register()` ist kein Fehlerbericht; genau daran ist `setSystemWach()` schon
 * einmal unbemerkt vorbeigelaufen.
 */
function anpassen(state, { aktiv, greifen, freigeben, log } = {}) {
  const soll = sollGreifen(state);
  if (soll === aktiv) return { geaendert: false, aktiv };

  if (!soll) {
    freigeben();
    if (log) log('info', 'Windows-Tastenkombinationen freigegeben (Wartung laeuft)');
    return { geaendert: true, aktiv: false };
  }

  const misslungen = [];
  for (const [taste] of KOMBINATIONEN) {
    if (!greifen(taste)) misslungen.push(taste);
  }
  if (log) {
    log('info', `${KOMBINATIONEN.length - misslungen.length} von ${KOMBINATIONEN.length} `
      + 'Windows-Tastenkombinationen werden geschluckt');
    if (misslungen.length) {
      log('warn', `Diese behaelt Windows fuer sich: ${misslungen.join(', ')}`);
    }
  }
  return { geaendert: true, aktiv: true, misslungen };
}

module.exports = { KOMBINATIONEN, sollGreifen, anpassen };
