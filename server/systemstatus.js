// Beantwortet die eine Frage, die man vor einem Wandpanel hat: passt alles?
//
// WARUM DAS EIN EIGENES MODUL IST
//
// Weil das Urteil an EINER Stelle fallen muss. Vorher lagen die Auskuenfte verstreut: Der
// Panelzustand stand in den Einstellungen unter "Panel", der Akku in der Navigationsleiste, die
// Version auf der Update-Seite, und was im Protokoll steht, sah nur, wer am Geraet sitzt. Wer
// wissen wollte, ob alles laeuft, musste vier Seiten aufmachen und selbst zusammenrechnen.
//
// Und weil die Bewertung nicht in die Anzeige gehoert. `pruefungen()` ist eine reine Funktion
// ohne Netz, ohne Dateien, ohne DOM: rein kommen die Rohwerte, raus kommt eine Liste mit Urteil.
// Damit ist jeder Grenzfall ohne Geraet pruefbar -- und die Seite zeigt nur an, was hier
// entschieden wurde. Zwei Stellen, die dasselbe bewerten, widersprechen einander spaetestens
// beim naechsten Sonderfall (dieselbe Regel wie bei decide() in control/controller.js).
//
// DIE STUFEN
//
//   ok        -- laeuft
//   hinweis   -- faellt auf, ist aber kein Schaden (eine Wartung laeuft, kein Dashboard da)
//   fehler    -- hier geht etwas nicht, und zwar so, dass es jemandem auffallen wird
//   unbekannt -- nicht zu ermitteln. AUSDRUECKLICH NICHT "ok": Eine Seite, die Gewissheit
//                behauptet, die sie nicht hat, ist schlimmer als eine, die zugibt, dass sie
//                nichts weiss.
//
// Das Gesamturteil ist die schlechteste Einzelstufe. Kein Mittelwert: Ein Panel, an dem eine
// Sache kaputt ist und neun laufen, ist kein Panel, an dem "fast alles passt".

const STUFEN = ['ok', 'unbekannt', 'hinweis', 'fehler'];

function schlechteste(stufen) {
  return stufen.reduce((a, b) => (STUFEN.indexOf(b) > STUFEN.indexOf(a) ? b : a), 'ok');
}

function minuten(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return Math.round(ms / 1000) + ' s';
  if (m < 90) return m + ' Min.';
  const h = Math.floor(m / 60);
  return h + ' h ' + (m % 60) + ' Min.';
}

function uhrzeit(ms) {
  try {
    return new Date(ms).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) { return '–'; }
}

/**
 * Baut die Pruefliste.
 *
 * Alle Eingaben duerfen fehlen: Die Statusseite muss auch dann etwas anzeigen, wenn die
 * Steuerung noch nicht laeuft oder Home Assistant nie eingerichtet wurde -- das ist genau der
 * Moment, in dem jemand nachsieht.
 */
function pruefungen(d = {}) {
  const panel = d.panel || null;
  const liste = [];
  const p = (schluessel, titel, stufe, wert, erklaerung) =>
    liste.push({ schluessel, titel, stufe, wert, erklaerung: erklaerung || '' });

  // --- Home Assistant ------------------------------------------------------------------------
  if (!d.konfiguriert) {
    p('ha', 'Home Assistant', 'fehler', 'nicht eingerichtet',
      'Ohne Adresse und Token zeigt das Panel nichts an. Unter „Verbindung" einrichten.');
  } else if (d.haVerbunden === true) {
    p('ha', 'Home Assistant', 'ok', 'verbunden',
      'Die Dauerverbindung steht — Änderungen sind in Sekundenbruchteilen auf der Wand.');
  } else if (d.haVerbunden === false) {
    p('ha', 'Home Assistant', 'hinweis', 'eingerichtet, keine Live-Verbindung',
      'Die Anzeige holt die Zustände weiter im kurzen Takt ab, nur eben nicht sofort. '
      + 'Verbindet sich von selbst wieder.');
  } else {
    p('ha', 'Home Assistant', 'unbekannt', 'eingerichtet, Verbindung unbekannt', '');
  }

  // --- Panel ---------------------------------------------------------------------------------
  const GRUND = {
    karenzzeit: 'Karenzzeit nach dem Start — es wird vorerst nicht abgeschaltet.',
    pause: 'Pausiert — der Bildschirm bleibt an.',
    nachtsperre: 'Nachtsperre — der Bildschirm ist wirklich aus. Berühren weckt ihn.',
    dauerbetrieb: 'Dauerbetrieb. Was zu sehen ist, entscheidet der Bildschirmschoner.'
  };
  if (!panel) {
    p('panel', 'Bildschirm', 'unbekannt', 'Steuerung nicht aktiv',
      'Die Panelsteuerung antwortet nicht. Auf einem Nicht-Windows-System ist das normal.');
  } else {
    p('panel', 'Bildschirm', 'ok', panel.panelOn ? 'an' : 'aus', GRUND[panel.reason] || '');
    p('nacht', 'Nachtsperre', 'ok',
      panel.nightModeEnabled ? `${panel.nightStart} bis ${panel.nightEnd}` : 'aus',
      panel.nightModeEnabled ? '' : 'Das Panel läuft durch.');

    // --- Die Sache, an der es zweimal gescheitert ist ----------------------------------------
    const z = panel.schlafZeitgeber;
    if (z && z.ac === 0 && z.dc === 0) {
      p('schlaf', 'Schlaf-Fristen', 'ok', 'nie',
        'Das Gerät schläft nicht ein, wenn der Bildschirm abgeschaltet wird — deshalb bleibt '
        + 'diese Seite auch nachts erreichbar.');
    } else if (z) {
      p('schlaf', 'Schlaf-Fristen', 'fehler',
        `am Netz ${z.ac ? minuten(z.ac * 1000) : 'nie'}, am Akku ${z.dc ? minuten(z.dc * 1000) : 'nie'}`,
        'Sobald die Nachtsperre den Bildschirm abschaltet, geht das Gerät schlafen und diese '
        + 'Seite ist weg. Ein Neustart der App setzt die Fristen neu.');
    } else {
      p('schlaf', 'Schlaf-Fristen', 'unbekannt', 'nicht zu ermitteln', '');
    }

    if (!panel.systemWachhalten) {
      p('wach', 'Gerät wachhalten', 'hinweis', 'abgeschaltet',
        'Bewusst aus. Bei ausgeschaltetem Panel kann das Gerät dann schlafen.');
    } else if (panel.systemWachGestellt) {
      p('wach', 'Gerät wachhalten', 'ok', 'angefordert', '');
    } else {
      p('wach', 'Gerät wachhalten', 'fehler', 'eingeschaltet, greift aber nicht',
        'Die Anforderung an Windows konnte nicht gestellt werden. Einzelheiten im Protokoll.');
    }

    if (panel.letzteSchlafluecke) {
      p('luecke', 'Letzter Schlaf', 'hinweis',
        `${minuten(panel.letzteSchlafluecke.dauerMs)} bis ${uhrzeit(panel.letzteSchlafluecke.ende)}`,
        'So lange war diese Seite nicht erreichbar und der Wächter stand.');
    } else {
      p('luecke', 'Letzter Schlaf', 'ok', 'keiner seit dem Start',
        'Keine Lücke im Takt — das Gerät ist durchgelaufen.');
    }

    p('taskleiste', 'Taskleiste', panel.taskleisteBis ? 'hinweis' : 'ok',
      panel.taskleisteBis ? `sichtbar bis ${uhrzeit(panel.taskleisteBis)}` : 'ausgeblendet',
      panel.taskleisteBis
        ? 'Eine Wartung läuft, das Fenster ist aus dem Kiosk-Modus. Endet von selbst.'
        : 'Auch gegen Wischgesten vom Rand.');
  }

  // --- Akku ----------------------------------------------------------------------------------
  if (!d.akku) {
    p('akku', 'Akku des Panels', 'unbekannt', 'nicht gemeldet',
      'Die Anzeige meldet ihn nur, während sie auf dem Panel läuft.');
  } else {
    const { prozent, laedt } = d.akku;
    const stufe = laedt ? 'ok' : (prozent <= 15 ? 'fehler' : (prozent <= 30 ? 'hinweis' : 'ok'));
    p('akku', 'Akku des Panels', stufe, `${prozent} %${laedt ? ', lädt' : ', am Akku'}`,
      laedt ? '' : 'Das Gerät hängt nicht am Netzteil.');
  }

  // --- Windows-Sperren -----------------------------------------------------------------------
  //
  // "Nicht möglich" ist KEIN offener Posten. Vorher stand hier dauerhaft "Stand 0 von 2 --
  // jeder Start versucht es erneut", und das war zweimal falsch: Die meisten Sperren saßen, und
  // der eine fehlende Versuch war aussichtslos (Windows schützt den Wert einzeln).
  if (!d.sperren) {
    p('sperren', 'Windows-Sperren', 'unbekannt', 'nicht zu ermitteln', '');
  } else {
    const s = d.sperren;
    const offen = (s.offen || []).length;
    const unmoeglich = (s.unmoeglich || []).length;
    const zusatz = unmoeglich
      ? ` ${unmoeglich} lässt Windows nicht setzen (${(s.unmoeglich || []).join(', ')}); `
        + 'das wird nicht wieder versucht.'
      : '';
    if (offen) {
      p('sperren', 'Windows-Sperren', 'hinweis', `${s.gesetzt} von ${s.gesamt} gesetzt`,
        `Offen: ${(s.offen || []).join(', ')}. Jeder Start versucht es erneut.` + zusatz);
    } else {
      p('sperren', 'Windows-Sperren', 'ok', `${s.gesetzt} von ${s.gesamt} gesetzt`,
        'Rand-Wischgesten, Benachrichtigungscenter und Windows-Tastenkombinationen sind '
        + 'abgeschaltet.' + zusatz);
    }
  }


  // --- Dashboards ----------------------------------------------------------------------------
  if (d.dashboards === undefined) {
    p('dashboards', 'Dashboards', 'unbekannt', '–', '');
  } else {
    p('dashboards', 'Dashboards', d.hauptKarten ? 'ok' : 'hinweis',
      `Haupt: ${d.hauptKarten || 0} Karten, ${d.dashboards} Unterdashboard(s)`,
      d.hauptKarten ? '' : 'Auf dem Hauptdashboard liegt keine Karte — die Wand bleibt leer.');
  }

  // --- Programm ------------------------------------------------------------------------------
  p('version', 'Version', 'ok', d.version || '–', '');
  if (d.laeuftSeit) {
    p('laufzeit', 'App läuft seit', 'ok',
      `${minuten(Date.now() - d.laeuftSeit)} (${uhrzeit(d.laeuftSeit)})`,
      'Nach einem Neustart von Windows startet sie erst mit der Anmeldung.');
  }

  // --- Was zuletzt schiefging ----------------------------------------------------------------
  //
  // Der wichtigste Teil, und der einzige, der von aussen sonst gar nicht zu sehen ist: Ohne
  // das muesste man sich per SSH auf das Geraet setzen, um in panelsteuerung.log zu schauen.
  const warnungen = Array.isArray(d.warnungen) ? d.warnungen : [];
  if (warnungen.length) {
    p('protokoll', 'Warnungen im Protokoll', 'hinweis', `${warnungen.length} zuletzt`,
      'Die jüngsten stehen unten.');
  } else {
    p('protokoll', 'Warnungen im Protokoll', 'ok', 'keine', '');
  }

  return {
    stufe: schlechteste(liste.map(e => e.stufe)),
    pruefungen: liste,
    warnungen
  };
}

module.exports = { pruefungen, schlechteste, STUFEN, minuten };
