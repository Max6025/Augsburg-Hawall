'use strict';

/**
 * Die Windows-Einstellungen, die auf einem Wandpanel im Weg sind -- und die Frage, welche davon
 * beim naechsten Start noch zu setzen sind.
 *
 * WARUM DAS EIN EIGENES MODUL IST
 *
 * Vorher stand alles in einer Schleife in `main.js`, mit EINEM Merker fuer alle Sperren
 * zusammen: Schlug eine fehl, wurde der Merker nicht gesetzt -- und dann lief auch der
 * Explorer-Neustart nicht, der die uebrigen Sperren erst wirksam macht. Am Geraet sah das so
 * aus: `AllowEdgeSwipe=0` stand in der Registry, die Wischgeste funktionierte weiter, und im
 * Protokoll stand eine Zeile ueber eine ganz andere Sperre.
 *
 * NICHTS AUS EINEM `Policies`-ZWEIG. Das gilt zweimal gemessen und ist keine Vorsichtsregel:
 * `HKCU\\Software\\Policies` und `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies`
 * geben dem Benutzerkonto nur `ReadKey`; Vollzugriff haben allein SYSTEM und die Gruppe
 * Administratoren, und die App laeuft unelevert. In 1.0.16 standen hier trotzdem
 * `DisableNotificationCenter` und `NoWinKeys` -- beide scheiterten am Geraet mit "Zugriff
 * verweigert", und zwar NACHDEM die Messung sie fuer moeglich erklaert hatte: gemessen wurde
 * ueber SSH, und OpenSSH gibt einem Administratorkonto ein volles Token ohne UAC-Filterung.
 * Wer hier etwas prueft, prueft es unelevert.
 *
 * Ersetzt sind die beiden durch Mechanismen, die keine Rechte brauchen:
 * `control/wintasten.js` (Tastenkombinationen ueber globalShortcut) und
 * `control/vordergrund.js` (das Benachrichtigungscenter schliesst sich, sobald es den Fokus
 * verliert). Beide haben denselben Vorteil: Es bleibt nichts liegen, wenn die App abstuerzt.
 *
 * Genau eine Sperre war an der alten Sammel-Buchfuehrung schuld, und sie ist UNMOEGLICH: `TaskbarDa` (der Widget-Knopf)
 * laesst sich auf Windows 11 25H2 Build 26200 nicht schreiben. Gemessen am 2026-09-23 auf dem
 * Surface Go: Der Schluessel `Explorer\\Advanced` gibt dem Benutzer Vollzugriff, ein anderer
 * Wert darin liess sich anlegen und wieder loeschen -- nur dieser eine Wert antwortet mit
 * "Es wurde versucht, einen nicht autorisierten Vorgang auszufuehren". Windows schuetzt ihn
 * einzeln. Er ist deshalb draussen und nicht "wird nochmal versucht": Ein Wandpanel, dessen
 * Taskleiste ohnehin versteckt ist, hat keinen Widget-Knopf zu verstecken.
 *
 * Seitdem gilt: JEDE Sperre wird einzeln gemerkt. Eine, die nicht geht, haelt die anderen
 * nicht auf.
 */

// Hochzaehlen, wenn sich die Liste aendert -- dann wird alles erneut gesetzt. Ein neuer Eintrag
// in der Liste wuerde sonst bei jedem, der die alten Sperren schon hat, nie gesetzt werden.
const STAND = 4;

const SPERREN = [
  {
    name: 'Wischgeste vom Rand',
    pfad: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\EdgeUI',
    wert: 'AllowEdgeSwipe', zahl: 0
  },
  {
    name: 'Ecke oben links',
    pfad: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\EdgeUi',
    wert: 'DisableTLcorner', zahl: 1
  },
  {
    name: 'Ecke oben rechts',
    pfad: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ImmersiveShell\\EdgeUi',
    wert: 'DisableTRcorner', zahl: 1
  },
  {
    name: 'Benachrichtigungen',
    pfad: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications',
    wert: 'ToastEnabled', zahl: 0
  },
  {
    name: 'Benachrichtigungen auf dem Sperrbildschirm',
    pfad: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications',
    wert: 'LockScreenToastEnabled', zahl: 0
  },
  {
    name: 'Suchfeld in der Taskleiste',
    pfad: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search',
    wert: 'SearchboxTaskbarMode', zahl: 0
  }
];

/**
 * Welche Sperren jetzt zu setzen sind.
 *
 * Nicht erneut versucht wird, was schon sitzt -- und auch nicht, was Windows verweigert hat:
 * Ein Wert, den das Betriebssystem einzeln schuetzt, wird beim naechsten Start genauso
 * geschuetzt sein, und eine Warnung, die bei jedem Start wiederkommt, liest nach dem dritten
 * Mal niemand mehr. Erst ein neuer STAND versucht alles wieder -- der Fall, in dem ein
 * Windows-Update etwas geaendert haben koennte.
 */
function offeneSperren(gespeichert, stand = STAND, sperren = SPERREN) {
  const bekannt = gespeichert || {};
  return sperren.filter(s => {
    const e = bekannt[s.name];
    if (!e || typeof e !== 'object') return true;
    if (Number(e.stand) !== Number(stand)) return true;
    return e.ergebnis !== 'ok' && e.ergebnis !== 'nicht moeglich';
  });
}

/** Den neuen Stand aus dem alten und den Ergebnissen dieses Durchlaufs bilden. */
function standFortschreiben(gespeichert, ergebnisse, stand = STAND) {
  const neu = { ...(gespeichert || {}) };
  for (const e of ergebnisse || []) {
    neu[e.name] = e.ok
      ? { stand, ergebnis: 'ok' }
      : { stand, ergebnis: e.unmoeglich ? 'nicht moeglich' : 'fehlgeschlagen', grund: e.grund || '' };
  }
  return neu;
}

/**
 * Muss der Explorer neu starten?
 *
 * Nur wenn sich wirklich etwas geaendert hat. Der Neustart nimmt fuer einen Moment die
 * Taskleiste und alle offenen Explorer-Fenster mit -- das ist bei jedem Programmstart zu tun
 * unzumutbar, und ohne ihn liest der Explorer die geaenderten Werte nicht.
 */
function explorerNeustartNoetig(ergebnisse) {
  return (ergebnisse || []).some(e => e.ok);
}

/**
 * Erkennt an der Meldung von `reg add`, dass Windows diesen Wert nicht schreiben LAESST.
 *
 * Unterscheidet den Fall "geht hier grundsaetzlich nicht" von "hat diesmal nicht geklappt".
 * Beim ersten waere jeder weitere Versuch Laerm, beim zweiten ist er richtig.
 */
function istUnmoeglich(grund) {
  return /Zugriff verweigert|Access is denied|nicht autorisierten Vorgang|unauthorized/i
    .test(String(grund || ''));
}

/**
 * Was die Statusseite ueber die Sperren sagen soll.
 *
 * Drei Zahlen und zwei Listen, und die Unterscheidung dazwischen ist der Punkt: "nicht
 * moeglich" ist kein offener Posten. Vorher stand auf der Statusseite dauerhaft
 * "Stand 0 von 2 -- jeder Start versucht es erneut", und das war gleich zweimal falsch:
 * Sieben von acht Sperren sassen, und der achte Versuch war aussichtslos.
 */
function bericht(gespeichert, stand = STAND, sperren = SPERREN) {
  const bekannt = gespeichert || {};
  const stand_gilt = n => bekannt[n] && Number(bekannt[n].stand) === Number(stand);
  const ok = sperren.filter(s => stand_gilt(s.name) && bekannt[s.name].ergebnis === 'ok');
  const unmoeglich = sperren.filter(s => stand_gilt(s.name) && bekannt[s.name].ergebnis === 'nicht moeglich');
  const offen = offeneSperren(gespeichert, stand, sperren);
  return {
    stand,
    gesamt: sperren.length,
    gesetzt: ok.length,
    offen: offen.map(s => s.name),
    unmoeglich: unmoeglich.map(s => s.name)
  };
}

/**
 * Steht eine Sperre in einem `Policies`-Zweig? Die sind unelevert nicht schreibbar.
 *
 * Als Funktion und nicht als Kommentar, damit ein Test es prueefen kann: Der Fehler ist schon
 * zweimal passiert, und beim zweiten Mal hatte die Datei die Warnung dagegen im Kopf stehen.
 */
function istPolicyPfad(pfad) {
  return /\\Policies\\/i.test(String(pfad || ''));
}

module.exports = {
  SPERREN, STAND, offeneSperren, standFortschreiben, explorerNeustartNoetig, istUnmoeglich,
  bericht, istPolicyPfad
};
