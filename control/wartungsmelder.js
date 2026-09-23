'use strict';

/**
 * Dem Wartungsmelder-Add-on sagen, dass hier gerade gearbeitet wird -- und wann es vorbei ist.
 *
 * WARUM DAS UEBERHAUPT NOETIG IST
 *
 * Uptime Kuma sieht ein Update nicht als Update, sondern als Ausfall: Die App beendet sich, der
 * Installer laeuft, das Geraet startet neu -- fuer die Ueberwachung ist der Webserver in dieser
 * Zeit tot. Ohne Wartung wird die Statusseite rot und es gibt einen Alarm, jedes Mal. Nach dem
 * dritten Mal glaubt niemand mehr der Anzeige, auch wenn wirklich etwas kaputt ist.
 *
 * DIE WARTUNG LAEUFT VON SELBST AB -- UND DAS IST DER WICHTIGE TEIL
 *
 * Angelegt wird mit der Strategie `single`, also mit einem festen Fenster von jetzt bis
 * `dauer_minuten`, NICHT mit `manual`. Eine manuelle Wartung bleibt offen, bis jemand sie
 * schliesst: Bleibt das Geraet nach einem misslungenen Update aus, verdeckt sie genau den
 * Ausfall, den sie eigentlich nur ankuendigen sollte -- und niemand merkt es, weil die
 * Statusseite freundlich "in Wartung" sagt. Mit einem Fenster laeuft sie aus, und der Alarm
 * kommt eben verspaetet statt nie.
 *
 * Geschlossen wird trotzdem ausdruecklich, sobald die App wieder laeuft. Das Fenster ist das
 * Fangnetz, nicht der Weg.
 *
 * ERST MERKEN, DANN MELDEN
 *
 * Der Schluessel wird VOR dem Melden abgelegt und ERST NACH dem Beenden entfernt. Genau
 * dazwischen liegt der Moment, in dem die App verschwindet (`updater.install()`), und ein
 * Merker, der danach geschrieben wuerde, wird nie geschrieben. Die Wartung stuende dann in
 * Uptime Kuma, und beim naechsten Start wuesste niemand mehr davon.
 *
 * WER NICHTS EINGETRAGEN HAT, MERKT NICHTS DAVON
 *
 * Ohne Adresse ist der Melder still und tut nichts -- kein Fehler, keine Verzoegerung beim
 * Update. Die Ueberwachung ist eine Zugabe; ein Panel muss ohne sie genauso laufen.
 */

// Wie lange das Fenster gilt, wenn der Aufrufer nichts sagt. Ein Update auf dem Surface Go
// dauert gemessen zwei bis drei Minuten, ein Windows-Neustart dazu kann zehn werden.
const DAUER_STANDARD_MIN = 20;
// Solange versucht der Melder, eine Wartung wieder zu schliessen. Das Add-on kann beim Start
// des Panels noch nicht da sein (Home Assistant bootet laenger als das Panel).
const SCHLIESS_VERSUCHE = 12;
const SCHLIESS_ABSTAND_MS = 30 * 1000;
const ZEITGRENZE_MS = 8000;

/**
 * Titel und Beschreibung aus dem Anlass -- reine Funktion, damit sie pruefbar ist.
 *
 * DAS STEHT AUF EINER STATUSSEITE, DIE ANDERE LESEN.
 *
 * Daran haben sich drei Dinge entschieden, und der erste Entwurf hat alle drei falsch gemacht:
 *
 * 1. **Kein Innenjargon.** "Die Taskleiste ist freigegeben und die Anzeige pausiert" beschreibt
 *    die Innereien dieser Anwendung. Wer auf eine Statusseite schaut, will wissen, was fuer ihn
 *    nicht geht -- nicht, was das Programm intern tut.
 * 2. **Keine Uhrzeit.** Uptime Kuma zeigt das Zeitfenster als eigenes Feld direkt darunter an.
 *    "Begonnen 23.09., 14:12" im Text daneben ist dieselbe Angabe zweimal, und die zweite
 *    stimmt schon nicht mehr, sobald sich etwas verschiebt.
 * 3. **Zwei Saetze, nicht vier.** Eine Wartungsmeldung wird im Vorbeigehen gelesen.
 */
function anlassText(art, daten = {}) {
  const geraet = daten.geraet || 'Wandpanel';

  if (art === 'update') {
    const von = daten.von || '?';
    const nach = daten.nach || '?';
    return {
      titel: `${geraet}: Update ${von} \u2192 ${nach}`,
      beschreibung: 'Das Gerät installiert ein Update und startet danach neu. '
        + 'Die Weboberfläche ist in dieser Zeit nicht erreichbar.',
      dauer_minuten: DAUER_STANDARD_MIN
    };
  }

  if (art === 'vorort') {
    const min = Number(daten.minuten) || 5;
    return {
      titel: `${geraet}: Wartung`,
      beschreibung: 'Am Gerät wird gearbeitet. Die Weboberfläche und die Anzeige können '
        + 'in dieser Zeit kurz nicht erreichbar sein.',
      dauer_minuten: Math.max(min, 10)
    };
  }

  return {
    titel: `${geraet}: Wartung`,
    beschreibung: 'Am Gerät wird gearbeitet. Die Weboberfläche ist in dieser Zeit '
      + 'möglicherweise nicht erreichbar.',
    dauer_minuten: DAUER_STANDARD_MIN
  };
}

class Wartungsmelder {
  /**
   * @param {object} o
   * @param {() => ({url: string, schluessel: string})} o.konfig  Bei jedem Aufruf frisch gelesen
   *   -- wer die Adresse in den Einstellungen nachtraegt, soll nicht neu starten muessen.
   * @param {() => string} [o.geraet]        Wie das Geraet auf der Statusseite heisst
   * @param {() => object} o.offeneLesen      Die abgelegten Schluessel (ueberlebt einen Neustart)
   * @param {(d: object) => void} o.offeneSchreiben
   * @param {Function} [o.holen]              fetch, hereingereicht fuer die Tests
   * @param {Function} [o.log]
   * @param {() => Date} [o.jetzt]
   */
  constructor({ konfig, geraet, offeneLesen, offeneSchreiben, holen, log, jetzt } = {}) {
    this.konfig = konfig || (() => ({ url: '', schluessel: '' }));
    this.geraet = geraet || (() => 'Wandpanel');
    this.offeneLesen = offeneLesen || (() => ({}));
    this.offeneSchreiben = offeneSchreiben || (() => {});
    this.holen = holen || ((...a) => fetch(...a));
    this.log = log || (() => {});
    this.jetzt = jetzt || (() => new Date());
    this.schliessLauf = null;
  }

  adresse() {
    const { url } = this.konfig() || {};
    return String(url || '').trim().replace(/\/+$/, '');
  }

  konfiguriert() {
    return !!this.adresse();
  }

  async anfragen(weg, pfad, koerper) {
    const basis = this.adresse();
    if (!basis) return { ok: false, fehler: 'Keine Adresse des Wartungsmelders eingetragen.' };
    const { schluessel } = this.konfig() || {};
    const kopf = { 'Content-Type': 'application/json' };
    if (schluessel) kopf['X-Schluessel'] = schluessel;

    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), ZEITGRENZE_MS);
    try {
      const a = await this.holen(basis + pfad, {
        method: weg, headers: kopf, signal: abbruch.signal,
        body: koerper === undefined ? undefined : JSON.stringify(koerper)
      });
      let daten = null;
      try { daten = await a.json(); } catch { /* Klartext oder leer -- nicht schlimm */ }
      if (!a.ok) {
        return { ok: false, fehler: (daten && daten.fehler) || `HTTP ${a.status}`, status: a.status };
      }
      return { ok: true, daten };
    } catch (e) {
      const abgebrochen = e && e.name === 'AbortError';
      return { ok: false, fehler: abgebrochen ? `Keine Antwort binnen ${ZEITGRENZE_MS} ms` : String((e && e.message) || e) };
    } finally {
      clearTimeout(uhr);
    }
  }

  /**
   * Eine Wartung anmelden. Der Merker wird VOR der Anfrage abgelegt, siehe Kopf der Datei.
   *
   * Gibt immer zurueck, statt zu werfen: Ein nicht erreichbarer Melder darf ein Update nicht
   * aufhalten. Gemeldet wird es im Protokoll.
   */
  async beginnen(art, daten = {}) {
    if (!this.konfiguriert()) return { ok: false, fehler: 'nicht eingerichtet', still: true };

    const schluessel = daten.schluessel || `wandpanel-${art}`;
    const text = anlassText(art, { geraet: this.geraet(), ...daten });

    const offene = { ...this.offeneLesen() };
    offene[schluessel] = { art, seit: this.jetzt().toISOString(), titel: text.titel };
    this.offeneSchreiben(offene);

    const a = await this.anfragen('POST', `/wartung/${encodeURIComponent(schluessel)}`, {
      ...text,
      // `single`, nicht `manual` -- die Begruendung steht im Kopf der Datei.
      strategie: 'single'
    });
    if (a.ok) this.log('info', `Wartung gemeldet: ${text.titel}`);
    else this.log('warn', `Wartung ${schluessel} liess sich nicht melden: ${a.fehler}`);
    return a;
  }

  /** Eine bestimmte Wartung beenden und den Merker entfernen -- aber nur bei Erfolg. */
  async beenden(schluessel) {
    if (!this.konfiguriert()) return { ok: false, fehler: 'nicht eingerichtet', still: true };
    const a = await this.anfragen('DELETE', `/wartung/${encodeURIComponent(schluessel)}`);
    if (a.ok) {
      const offene = { ...this.offeneLesen() };
      delete offene[schluessel];
      this.offeneSchreiben(offene);
      this.log('info', `Wartung beendet: ${schluessel}`);
    } else {
      // Der Merker bleibt liegen. Sonst versucht es niemand mehr, und die Wartung laeuft nur
      // noch durch ihr Fenster ab -- der Alarm kaeme dann verspaetet statt gar nicht, aber
      // "verspaetet" ist hier vermeidbar.
      this.log('warn', `Wartung ${schluessel} liess sich nicht beenden: ${a.fehler}`);
    }
    return a;
  }

  /**
   * Alle offenen Wartungen schliessen -- der Weg, auf dem das System "von selbst merkt, dass es
   * vorbei ist".
   *
   * Aufgerufen wird das beim Start, nachdem der eigene Webserver antwortet: Genau dann ist
   * wahr, was die Ueberwachung von draussen sehen will. Erreicht der Aufruf das Add-on nicht
   * (Home Assistant bootet laenger), wird es wiederholt, statt es einmal zu versuchen und
   * aufzugeben.
   */
  async abschliessen() {
    const offene = this.offeneLesen();
    const schluessel = Object.keys(offene || {});
    if (!schluessel.length) return { ok: true, geschlossen: [], offen: [] };
    if (!this.konfiguriert()) return { ok: false, fehler: 'nicht eingerichtet', still: true };

    const geschlossen = [];
    for (const s of schluessel) {
      const a = await this.beenden(s);
      if (a.ok) geschlossen.push(s);
    }
    const uebrig = Object.keys(this.offeneLesen() || {});
    return { ok: !uebrig.length, geschlossen, offen: uebrig };
  }

  /** Beharrlich abschliessen, bis nichts mehr offen ist. */
  abschliessenWiederholt(versuche = SCHLIESS_VERSUCHE, abstand = SCHLIESS_ABSTAND_MS) {
    if (this.schliessLauf) return this.schliessLauf;
    let uebrig = versuche;
    const lauf = async () => {
      while (uebrig-- > 0) {
        const r = await this.abschliessen();
        if (r.ok || r.still) return r;
        // KEIN unref() hier. Das nimmt der Ereignisschleife den Grund zu warten, und dann
        // feuert der Zeitgeber nie: Node sieht nichts mehr zu tun, beendet sich, und das
        // Versprechen loest sich nicht mehr auf. Unter Linux hielten zufaellig andere Handles
        // die Schleife am Leben, auf dem Windows-Laeufer nicht -- dort brach `node --test`
        // mitten im Lauf ab ("Promise resolution is still pending but the event loop has
        // already resolved"), OHNE dass eine Zusicherung fehlgeschlagen waere.
        if (uebrig > 0) await new Promise(f => setTimeout(f, abstand));
      }
      this.log('warn', 'Offene Wartungen liessen sich nicht schliessen. Sie laufen durch ihr Fenster ab.');
      return { ok: false };
    };
    this.schliessLauf = lauf().finally(() => { this.schliessLauf = null; });
    return this.schliessLauf;
  }
}

module.exports = { Wartungsmelder, anlassText, DAUER_STANDARD_MIN, SCHLIESS_VERSUCHE, SCHLIESS_ABSTAND_MS };
