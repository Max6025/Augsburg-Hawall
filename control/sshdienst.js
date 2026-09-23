'use strict';

/**
 * Den Zustand des OpenSSH-Dienstes lesen -- ohne erhoehte Rechte.
 *
 * WARUM DAS AUF DIE STATUSSEITE GEHOERT
 *
 * SSH ist der Weg, auf dem man an dieses Geraet kommt, ohne davorzustehen. Faellt er aus, merkt
 * man es genau dann, wenn man ihn braucht -- und dann hilft nur noch hingehen. Am 2026-09-23
 * war der Dienst weg ("Es konnte kein Dienst mit dem Namen sshd gefunden werden"), und zwischen
 * dem Ausfall und dem Auffallen lagen Tage.
 *
 * SPRACHUNABHAENGIG AUSGELESEN, und das ist hier keine Kleinigkeit: `sc.exe` gibt seine
 * Beschriftungen uebersetzt aus, die WERTE aber als englische Marken -- am Geraet nachgemessen
 * auf deutschem Windows 11 25H2:
 *
 *     STATE              : 4  RUNNING
 *     START_TYPE         : 2   AUTO_START
 *     FAILURE_ACTIONS    : RESTART -- Verzoegerung = 5000 Millisek.
 *
 * Gelesen werden deshalb die ZAHLEN (4 = laeuft, 2 = automatisch) und der Rueckgabecode
 * **1060** fuer "Dienst gibt es nicht". Auf uebersetzte Beschriftungen zu hoeren ist der Fehler,
 * der `modernstandby.js` zwei Releases gekostet hat: Dort wurde auf "nicht vorhanden" geprueft,
 * das Geraet sagte aber "nicht gefunden", und die Antwort war `null` statt `false`.
 *
 * WAS DIESES MODUL NICHT KANN: den Dienst starten. Das braucht erhoehte Rechte, und die App
 * laeuft unelevert. Reparieren tut `werkzeuge/ssh-dienst-reparieren.ps1`, und der Abschnitt H
 * dort setzt die Wiederherstellung -- damit ein Absturz sich selbst heilt, statt auf jemanden zu
 * warten.
 */

// Rueckgabecode von sc.exe, wenn der Dienst nicht existiert. Sprachunabhaengig.
const NICHT_INSTALLIERT = 1060;

/**
 * Die drei Ausgaben von sc.exe auswerten. Reine Funktion.
 *
 * @param {{queryCode: number, query: string, qc: string, qfailure: string}} rohdaten
 */
function auswerten(rohdaten = {}) {
  const { queryCode, query = '', qc = '', qfailure = '' } = rohdaten;

  if (Number(queryCode) === NICHT_INSTALLIERT) {
    return {
      vorhanden: false, laeuft: false, startAutomatisch: false, wiederherstellung: false,
      grund: 'Der Dienst ist nicht installiert.'
    };
  }

  const zustand = /STATE\s*:\s*(\d+)/i.exec(query);
  if (!zustand) {
    // Kein STATE in der Ausgabe heisst: Wir haben gar nichts Verwertbares bekommen. Das ist
    // ausdruecklich NICHT dasselbe wie "der Dienst laeuft nicht" -- ein Urteil ohne Grundlage
    // waere hier schlimmer als ein ehrliches "unbekannt".
    return {
      vorhanden: null, laeuft: null, startAutomatisch: null, wiederherstellung: null,
      grund: 'Der Zustand liess sich nicht auslesen.'
    };
  }

  return {
    vorhanden: true,
    // 4 = RUNNING. 1 = STOPPED, 2/3 = startet/haelt an.
    laeuft: Number(zustand[1]) === 4,
    // 2 = AUTO_START. 3 waere "manuell": Der Dienst laeuft dann bis zum naechsten Neustart und
    // ist danach weg -- ein Ausfall mit Verzoegerung.
    startAutomatisch: /START_TYPE\s*:\s*2\b/i.test(qc),
    // Ohne Aktionen startet niemand den Dienst neu, wenn er abstuerzt. Am Geraet stand hier
    // RESET_PERIOD 0 und nichts weiter.
    wiederherstellung: /RESTART/i.test(qfailure),
    grund: ''
  };
}

/**
 * Nachsehen. `laufen` fuehrt einen Befehl aus und liefert `{code, text}`.
 *
 * Drei Aufrufe, weil sc.exe die drei Auskuenfte nicht zusammen gibt. Sie kosten zusammen
 * wenige Millisekunden und laufen nur, wenn die Statusseite geoeffnet wird -- nicht im Takt.
 */
async function lesen(laufen) {
  const query = await laufen('sc query sshd');
  const qc = await laufen('sc qc sshd');
  const qfailure = await laufen('sc qfailure sshd');
  return auswerten({
    queryCode: query.code,
    query: query.text,
    qc: qc.text,
    qfailure: qfailure.text
  });
}

module.exports = { auswerten, lesen, NICHT_INSTALLIERT };
