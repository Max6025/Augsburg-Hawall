const express = require('express');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const crypto = require('crypto');
const calendar = require('../control/calendar');
const austausch = require('./dashboard-austausch');
// Das Render-Modul kennt die Kartenarten. Es laesst sich in Node laden (dafuer wurde es
// seinerzeit vom Fenster geloest) -- so gibt es die Liste nur EINMAL, statt sie hier ein
// zweites Mal zu pflegen und beim naechsten neuen Kartentyp zu vergessen.
const { CARD_TYPES } = require('../renderer/shared/dashboard-render.js');
const { HaLive } = require('./ha-live');
const { TorBeobachter } = require('../control/torzeiten');
const { ZUHAUSE_VORGABE } = require('../renderer/shared/alarm.js');
const { SCHWELLE_MINDESTENS } = require('../renderer/shared/akku.js');

// Domains, die keine sinnvollen Wall-Display-Karten sind (Helfer/System-Entitaeten)
// -- werden weder im Editor angeboten noch als Karten dargestellt.
const EXCLUDED_DOMAINS = new Set([
  'automation', 'zone', 'person', 'device_tracker', 'update',
  'persistent_notification', 'sun', 'tag', 'event',
  'group', 'conversation', 'stt', 'tts'
]);

function haFetch(haUrl, token, endpoint, options = {}) {
  const url = `${haUrl.replace(/\/$/, '')}${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

// HA's Energie-Dashboard-Konfiguration (welche Entitaeten fuer Netz/Solar/Batterie
// hinterlegt sind) ist nur per WebSocket-Kommando abrufbar, es gibt dafuer keine
// REST-Route. Einmaliger Verbindungsaufbau + ein Kommando + Verbindung wieder zu.
function haWebsocketCommand(haUrl, token, message, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const wsUrl = haUrl.replace(/\/$/, '').replace(/^http/, 'ws') + '/api/websocket';
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      return reject(err);
    }
    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.terminate(); reject(new Error('Zeitüberschreitung bei WebSocket-Verbindung')); }
    }, timeoutMs);

    ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch (e) { return; }
      if (data.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (data.type === 'auth_invalid') {
        if (!settled) { settled = true; clearTimeout(timer); ws.close(); reject(new Error('Token ungültig (WebSocket-Auth)')); }
      } else if (data.type === 'auth_ok') {
        ws.send(JSON.stringify({ id: 1, ...message }));
      } else if (data.type === 'result' && data.id === 1) {
        if (!settled) {
          settled = true; clearTimeout(timer); ws.close();
          if (data.success) resolve(data.result);
          else reject(new Error((data.error && data.error.message) || 'HA-WebSocket-Fehler'));
        }
      }
    });
    ws.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
    });
  });
}

// --- Zugangsschutz fuer die Setup-Oberflaeche -------------------------------------------------
//
// Die Vorlage lauscht auf 0.0.0.0 ohne jede Anmeldung: jeder im selben WLAN kann ueber
// /api/ha/service beliebige Home-Assistant-Dienste schalten (Schloesser, Alarmanlage) und ueber
// /api/reset die Konfiguration loeschen. Das ist hier bewusst geschlossen.
//
// Die Grenze verlaeuft entlang der Loopback-Schnittstelle: das Wall Display selbst spricht ueber
// http://localhost mit diesem Server und bleibt deshalb frei; alles, was aus dem Netz kommt,
// braucht den Zugangscode. Damit ist der Schutz genau dort, wo die Bedrohung ist, und die App
// muss ihren eigenen Code nicht kennen.

const sessions = new Set();

function isLoopback(req) {
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const LOGIN_PAGE = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Zugangscode</title>
<style>
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
      background:#111418;color:#e8eaed;font-family:Segoe UI,system-ui,sans-serif}
 form{background:#1b1f24;padding:32px;border-radius:14px;width:min(340px,90vw);
      box-shadow:0 10px 40px rgba(0,0,0,.5)}
 h1{margin:0 0 6px;font-size:20px} p{margin:0 0 20px;color:#9aa0a6;font-size:14px;line-height:1.5}
 input{width:100%;box-sizing:border-box;padding:12px;font-size:18px;letter-spacing:2px;
       text-align:center;border-radius:8px;border:1px solid #333a42;background:#0e1216;color:#fff}
 button{width:100%;margin-top:14px;padding:12px;font-size:16px;border:0;border-radius:8px;
        background:#3b82f6;color:#fff;cursor:pointer}
 .err{color:#f28b82;font-size:14px;margin-top:12px;min-height:20px}
</style></head><body>
<form id="f"><h1>Zugangscode</h1>
<p>Diese Einrichtungsseite ist geschützt. Gib den Code ein, den du bei der Einrichtung festgelegt hast.</p>
<input id="c" type="password" inputmode="numeric" autocomplete="current-password" autofocus>
<button type="submit">Anmelden</button><div class="err" id="e"></div></form>
<script>
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const r = await fetch('/api/auth/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ code: document.getElementById('c').value })
  });
  const j = await r.json().catch(() => ({}));
  if (j.ok) location.href = new URLSearchParams(location.search).get('next') || '/setup/';
  else { document.getElementById('e').textContent = j.error || 'Code falsch'; document.getElementById('c').value = ''; }
});
</script></body></html>`;

function startServer({ port, store, onConfigSaved, getLocalIps, updater, controller, getPanelSize }) {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/login', (req, res) => res.type('html').send(LOGIN_PAGE));

  app.post('/api/auth/login', (req, res) => {
    const expected = store.get('setupCode');
    const given = String((req.body && req.body.code) || '');
    if (!expected) return res.json({ ok: true, note: 'Es ist noch kein Code gesetzt' });
    if (given !== expected) return res.status(401).json({ ok: false, error: 'Code falsch' });
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.add(sid);
    // Ein Jahr gueltig: der Code soll nicht bei jedem Blick aufs Handy neu abgefragt werden.
    res.setHeader('Set-Cookie', `wallcode=${sid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    const sid = readCookie(req, 'wallcode');
    if (sid) sessions.delete(sid);
    res.setHeader('Set-Cookie', 'wallcode=; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.use((req, res, next) => {
    // Das Wall Display selbst ruft ueber localhost auf und wird nie abgefragt.
    if (isLoopback(req)) return next();
    // Solange kein Code gesetzt ist, muss die Ersteinrichtung erreichbar bleiben -- sonst
    // sperrt sich das Geraet selbst aus, bevor ueberhaupt ein Code vergeben werden konnte.
    if (!store.get('setupCode')) return next();
    const sid = readCookie(req, 'wallcode');
    if (sid && sessions.has(sid)) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ ok: false, error: 'Zugangscode erforderlich', needsAuth: true });
    }
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  });

  // --- Die Live-Ansicht ---------------------------------------------------------------------
  //
  // Dieselbe Anzeige wie auf der Wand, im Browser eines anderen Geraets -- und bedienbar.
  //
  // Bewusst KEINE Bildschirmuebertragung: Das waere ein Videostrom, der dauernd Rechenzeit
  // kostet, auf einem Surface Go Akku frisst und trotzdem unscharf aussieht. Stattdessen
  // laeuft dieselbe Seite noch einmal -- sie holt ihre Daten ohnehin ueber diesen Server, und
  // ein Tastendruck geht denselben Weg wie auf dem Panel.
  //
  // Sie liegt HINTER dem Zugangscode (die Pruefung steht weiter oben): Wer die Anzeige
  // bedienen kann, kann Licht, Tore und die Alarmanlage schalten.
  //
  // Ohne abschliessenden Schraegstrich, damit `shared/...` in der Seite auf `/shared/...`
  // zeigt. Mit Schraegstrich waere die Grundlage `/live/` und jede Datei ein Fehlschlag.
  app.get('/live', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'renderer', 'dashboard.html'));
  });
  app.get('/live/', (req, res) => res.redirect('/live'));

  app.use('/setup', express.static(path.join(__dirname, '..', 'renderer', 'setup')));
  app.use('/shared', express.static(path.join(__dirname, '..', 'renderer', 'shared')));

  app.get('/api/status', (req, res) => {
    res.json({
      configured: !!(store.get('haUrl') && store.get('token')),
      ips: getLocalIps(),
      port
    });
  });

  app.post('/api/test-connection', async (req, res) => {
    const { haUrl, token } = req.body || {};
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'haUrl und token erforderlich' });
    try {
      const r = await haFetch(haUrl, token, '/api/');
      if (!r.ok) return res.status(200).json({ ok: false, error: `HA antwortete mit Status ${r.status}` });
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: String(err.message || err) });
    }
  });

  // Entitaeten-Liste anhand der bereits gespeicherten Zugangsdaten (fuer die
  // separate Entitaeten-Auswahl, die jederzeit NACH der Ersteinrichtung aufgerufen wird).
  // Optionaler ?domain=-Parameter liefert gezielt eine sonst ausgeschlossene Domain
  // (z.B. "sun" fuer die Tag/Nacht-Theme-Auswahl), ohne sie generell freizugeben.
  app.get('/api/entities', async (req, res) => {
    const haUrl = store.get('haUrl');
    const token = store.get('token');
    const domainFilter = req.query.domain;
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'Erst Verbindung einrichten (Schritt 1)' });
    try {
      const r = await haFetch(haUrl, token, '/api/states');
      if (!r.ok) return res.status(200).json({ ok: false, error: `HA antwortete mit Status ${r.status}` });
      const states = await r.json();
      const entities = states
        .filter(s => {
          const d = s.entity_id.split('.')[0];
          return domainFilter ? d === domainFilter : !EXCLUDED_DOMAINS.has(d);
        })
        .map(s => ({
          entity_id: s.entity_id,
          name: s.attributes.friendly_name || s.entity_id,
          domain: s.entity_id.split('.')[0],
          // Damit die Einstellungsseite zeigen kann, was eine Entitaet GERADE meldet. Bei der
          // Ankunftserkennung muss man die Zustandsnamen der eigenen Anlage eintragen, und die
          // heissen nicht ueberall gleich -- ohne diese Anzeige raet man.
          zustand: s.state
        }));
      res.json({ ok: true, entities });
    } catch (err) {
      res.json({ ok: false, error: String(err.message || err) });
    }
  });

  // --- Akkustand des Panels -------------------------------------------------------------------
  //
  // Die Einrichtungsseite laeuft auf einem ANDEREN Geraet: Sie kann den Akku des Panels nicht
  // selbst auslesen -- navigator.getBattery() beantwortet immer nur die Frage nach dem Geraet,
  // auf dem der Browser gerade steht. Die Anzeige meldet ihn deshalb hierher.
  //
  // Bewusst nur im Speicher, nicht im Store: Ein Akkustand von gestern ist keine Information,
  // sondern eine Falle. Nach einem Neustart ist er weg, und die Leiste sagt ehrlich "unbekannt",
  // bis sich das Panel das naechste Mal meldet.
  let geraetAkku = null;
  const akkuHoerer = new Set();

  const akkuStand = () => (geraetAkku
    ? { akku: { prozent: geraetAkku.prozent, laedt: geraetAkku.laedt }, alterSekunden: Math.round((Date.now() - geraetAkku.zeit) / 1000) }
    : { akku: null });

  app.post('/api/geraet/akku', (req, res) => {
    const { prozent, laedt } = req.body || {};
    const p = Number(prozent);
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      return res.status(400).json({ ok: false, error: 'prozent muss zwischen 0 und 100 liegen' });
    }
    const vorher = geraetAkku;
    geraetAkku = { prozent: Math.round(p), laedt: !!laedt, zeit: Date.now() };
    // Nur bei echter Aenderung weitersagen. Die Anzeige meldet sich auch alle fuenf Minuten
    // unveraendert als Lebenszeichen -- daraus ein Ereignis zu machen waere Laerm ohne Inhalt.
    if (!vorher || vorher.prozent !== geraetAkku.prozent || vorher.laedt !== geraetAkku.laedt) {
      const zeile = 'data: ' + JSON.stringify(akkuStand()) + '\n\n';
      for (const h of akkuHoerer) {
        try { h.write(zeile); } catch (e) { akkuHoerer.delete(h); }
      }
    }
    res.json({ ok: true });
  });

  // Der Akkustand als Ereignisstrom: Wer die Einrichtungsseite offen hat, soll ein
  // angestecktes Netzteil sehen, ohne die Seite neu zu laden. Derselbe Weg wie bei den
  // Zustaenden aus Home Assistant (siehe /api/ha/live) -- Server-Sent Events, eine Richtung,
  // und der Browser verbindet sich nach einem Abbruch von selbst wieder.
  app.get('/api/geraet/akku/live', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    res.write('data: ' + JSON.stringify(akkuStand()) + '\n\n');
    akkuHoerer.add(res);
    req.on('close', () => akkuHoerer.delete(res));
  });

  // Das Alter gehoert zur Antwort: Laeuft die Anzeige nicht mehr, steht sonst ein Stand von
  // vor drei Tagen in der Leiste und sieht aus wie die Gegenwart.
  app.get('/api/geraet/akku', (req, res) => {
    res.json(Object.assign({ ok: true }, akkuStand()));
  });

  // --- Befehle an die Anzeige ------------------------------------------------------------------
  //
  // Bisher lief alles in eine Richtung: Die Einrichtungsseite schrieb in die Konfiguration, die
  // Anzeige las sie beim naechsten Start. Fuer "Ton testen" reicht das nicht -- man will ihn
  // JETZT hoeren, auf der Wand, waehrend man danebensteht.
  //
  // Derselbe Weg wie bei den Zustaenden aus Home Assistant: Server-Sent Events, eine Richtung,
  // und die Anzeige verbindet sich nach einem Abbruch von selbst wieder.
  const anzeigeHoerer = new Set();
  let tonErgebnis = null;

  app.get('/api/anzeige/befehle', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    res.write(': verbunden\n\n');
    anzeigeHoerer.add(res);
    req.on('close', () => anzeigeHoerer.delete(res));
  });

  app.post('/api/anzeige/ton-test', (req, res) => {
    // Das Ergebnis von vorhin verwerfen, sonst haelt man die alte Antwort fuer die neue.
    tonErgebnis = null;
    const zeile = 'data: ' + JSON.stringify({ befehl: 'ton' }) + '\n\n';
    for (const h of anzeigeHoerer) {
      try { h.write(zeile); } catch (e) { anzeigeHoerer.delete(h); }
    }
    // Wie viele Anzeigen zuhoeren, ist die halbe Antwort: Kommt kein Ton und hoerte niemand zu,
    // liegt es nicht am Ton.
    res.json({ ok: true, anzeigen: anzeigeHoerer.size });
  });

  app.post('/api/geraet/ton-ergebnis', (req, res) => {
    const { zustand, fehler } = req.body || {};
    tonErgebnis = { zustand: String(zustand || ''), fehler: String(fehler || ''), zeit: Date.now() };
    res.json({ ok: true });
  });

  app.get('/api/geraet/ton-ergebnis', (req, res) => {
    if (!tonErgebnis) return res.json({ ok: true, ergebnis: null, anzeigen: anzeigeHoerer.size });
    res.json({
      ok: true,
      ergebnis: { zustand: tonErgebnis.zustand, fehler: tonErgebnis.fehler },
      alterSekunden: Math.round((Date.now() - tonErgebnis.zeit) / 1000),
      anzeigen: anzeigeHoerer.size
    });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      haUrl: store.get('haUrl') || '',
      hasToken: !!store.get('token'),
      title: store.get('title') || 'Wall Display',
      entities: store.get('entities') || [],
      layout: store.get('layout') || [],
      sunEntity: store.get('sunEntity') || '',
      notifyEntity: store.get('notifyEntity') || '',
      notifyTitel: store.get('notifyTitel') || 'Ankündigung',
      // Wie lange die Ankuendigung gross bleibt, bevor sie in die Leiste wandert.
      // 0 heisst ausdruecklich: bleibt gross.
      notifySekunden: store.get('notifySekunden') === undefined ? 20 : store.get('notifySekunden'),
      // Nie unter das Mindestmass: Ein alter, tiefer Wert aus der Zeit davor darf nicht
      // stillschweigend weitergelten.
      batteryThreshold: Math.max(SCHWELLE_MINDESTENS, store.get('batteryThreshold') || 20),
      batterySound: store.get('batterySound') !== false,
      batteryVolume: store.get('batteryVolume') !== false,
      nightModeEnabled: store.get('nightModeEnabled') || false,
      nightStart: store.get('nightStart') || '23:00',
      nightEnd: store.get('nightEnd') || '06:30',
      nightModeForceOn: store.get('nightModeForceOn') || false,
      customTheme: store.get('customTheme') || null,
      // Kalendersteuerung
      calendarEnabled: store.get('calendarEnabled') || false,
      calendarEntity: store.get('calendarEntity') || '',
      calendarKeywords: store.get('calendarKeywords') || '',
      calendarLeadMinutes: store.get('calendarLeadMinutes') || 0,
      calendarTrailMinutes: store.get('calendarTrailMinutes') || 0,
      // Ankunftsschirm
      welcomeEnabled: store.get('welcomeEnabled') || false,
      welcomeHeading: store.get('welcomeHeading') || 'Herzlich willkommen',
      welcomeText: store.get('welcomeText') || '',
      welcomeImageEntity: store.get('welcomeImageEntity') || '',
      welcomeCaption: store.get('welcomeCaption') || 'Gast-WLAN',
      welcomeCaption2: store.get('welcomeCaption2') || '',
      welcomeImageEntity2: store.get('welcomeImageEntity2') || '',
      // Das zweite Bild kann entweder aus Home Assistant kommen oder hochgeladen sein.
      welcomeImage2Quelle: store.get('welcomeImage2Quelle') || '',
      welcomeImage2Version: store.get('photoCardVersion:welcome-2') || 0,
      welcomeImageSeconds: store.get('welcomeImageSeconds') === undefined ? 8 : store.get('welcomeImageSeconds'),
      welcomeHours: store.get('welcomeHours') === undefined ? 5 : store.get('welcomeHours'),
      welcomeDismissedFor: store.get('welcomeDismissedFor') || '',
      // Abschiedsschirm: das Gegenstueck zum Ankunftsschirm, am letzten Tag.
      abschiedEnabled: !!store.get('abschiedEnabled'),
      abschiedHeading: store.get('abschiedHeading') || '',
      abschiedText: store.get('abschiedText') || '',
      abschiedDashboard: store.get('abschiedDashboard') || '',
      abschiedAbStunde: store.get('abschiedAbStunde') === undefined ? 0 : store.get('abschiedAbStunde'),
      abschiedDismissedFor: store.get('abschiedDismissedFor') || '',
      welcomeErzwungenBis: store.get('welcomeErzwungenBis') || 0,
      // Standard AN -- die Bewegung ist der sichtbare Teil des Designs.
      // Wie gross das Panel wirklich ist -- der Editor zeichnet seine Arbeitsflaeche danach.
      panelGroesse: (typeof getPanelSize === 'function' ? getPanelSize() : null),
      hintergrundBewegung: store.get('hintergrundBewegung') !== false,
      // 0 = gar nicht zurueck. Vorgabe 90 Sekunden: lang genug, um in Ruhe etwas
      // nachzusehen, kurz genug, dass die Wand nicht tagelang auf einem Unterdashboard steht.
      rueckkehrSekunden: store.get('rueckkehrSekunden') === undefined ? 90 : store.get('rueckkehrSekunden'),
      welcomeTestmodus: !!store.get('welcomeTestmodus'),
      welcomeTestSekunden: store.get('welcomeTestSekunden') || 10,
      // Auf Ankunft warten: Die Termine sind ganztaegig, das Anzeigefenster begaenne also um
      // Mitternacht. Siehe control/ankunft.js.
      ankunftEnabled: !!store.get('ankunftEnabled'),
      ankunftEntity: store.get('ankunftEntity') || '',
      ankunftZuhause: store.get('ankunftZuhause') || ZUHAUSE_VORGABE,
      ankunftNachMinuten: store.get('ankunftNachMinuten') === undefined ? 60 : store.get('ankunftNachMinuten'),
      // Abwesenheit: dieselbe Entitaet, andere Frage. Steht die Anlage auf abwesend, schaut
      // ohnehin niemand hin.
      abwesendEnabled: !!store.get('abwesendEnabled'),
      abwesendHelligkeit: store.get('abwesendHelligkeit') === undefined ? 20 : store.get('abwesendHelligkeit'),
      abwesendSekunden: store.get('abwesendSekunden') === undefined ? 20 : store.get('abwesendSekunden'),
      desktopHintergrund: !!store.get('desktopHintergrund'),
      // Der Code selbst wird nie zurueckgegeben, nur ob einer gesetzt ist.
      hasSetupCode: !!store.get('setupCode')
      // Token bewusst NICHT an den Dashboard-Client zurueckgeben; HA-Aufrufe laufen ueber /api/ha/*
    });
  });

  // Speichert Verbindung UND/ODER Entitaeten-Auswahl UND/ODER Theme-Einstellung unabhaengig
  // voneinander: jeweils fehlende Felder bleiben unveraendert.
  app.post('/api/config', (req, res) => {
    const {
      haUrl, token, title, entities, layout, sunEntity,
      notifyEntity, batteryThreshold, batterySound, batteryVolume, nightModeEnabled, nightStart, nightEnd, nightModeForceOn,
      notifyTitel, notifySekunden,
      calendarEnabled, calendarEntity, calendarKeywords, calendarLeadMinutes, calendarTrailMinutes,
      setupCode,
      welcomeEnabled, welcomeHeading, welcomeText, welcomeImageEntity, welcomeCaption, welcomeCaption2, welcomeHours,
      welcomeImageEntity2, welcomeImageSeconds, welcomeImage2Quelle,
      welcomeTestmodus, welcomeTestSekunden, hintergrundBewegung, rueckkehrSekunden,
      ankunftEnabled, ankunftEntity, ankunftZuhause, ankunftNachMinuten,
      abwesendEnabled, abwesendHelligkeit, abwesendSekunden, desktopHintergrund,
      abschiedEnabled, abschiedHeading, abschiedText, abschiedDashboard, abschiedAbStunde
    } = req.body || {};
    const finalHaUrl = haUrl || store.get('haUrl');
    const finalToken = token || store.get('token');
    if (!finalHaUrl || !finalToken) return res.status(400).json({ ok: false, error: 'haUrl und token erforderlich' });
    store.set('haUrl', finalHaUrl);
    store.set('token', finalToken);
    // Adresse oder Token koennen sich geaendert haben -- die Live-Verbindung haengt sonst
    // weiter an der alten und meldet nie wieder etwas.
    if (haLive) haLive.neuVerbinden();
    if (title !== undefined) store.set('title', title);
    if (entities !== undefined) store.set('entities', entities);
    if (layout !== undefined) store.set('layout', layout);
    if (sunEntity !== undefined) store.set('sunEntity', sunEntity);
    if (notifyEntity !== undefined) store.set('notifyEntity', notifyEntity);
    if (notifyTitel !== undefined) store.set('notifyTitel', String(notifyTitel || '').slice(0, 40));
    if (notifySekunden !== undefined) store.set('notifySekunden', Math.max(0, Math.min(600, parseInt(notifySekunden, 10) || 0)));
    if (batteryThreshold !== undefined) {
      // Unter zwanzig Prozent bleibt keine Reserve mehr, um in Ruhe zu reagieren -- und ein
      // Feld, das 5 annimmt und dann doch bei 20 warnt, waere schlimmer als eine Grenze.
      const v = Math.max(SCHWELLE_MINDESTENS, Math.min(100, parseInt(batteryThreshold, 10) || SCHWELLE_MINDESTENS));
      store.set('batteryThreshold', v);
    }
    if (batterySound !== undefined) store.set('batterySound', !!batterySound);
    if (batteryVolume !== undefined) store.set('batteryVolume', !!batteryVolume);
    if (nightModeEnabled !== undefined) store.set('nightModeEnabled', nightModeEnabled);
    if (nightStart !== undefined) store.set('nightStart', nightStart);
    if (nightEnd !== undefined) store.set('nightEnd', nightEnd);
    if (nightModeForceOn !== undefined) store.set('nightModeForceOn', nightModeForceOn);

    if (calendarEnabled !== undefined) store.set('calendarEnabled', !!calendarEnabled);
    if (calendarEntity !== undefined) store.set('calendarEntity', String(calendarEntity || ''));
    if (calendarKeywords !== undefined) store.set('calendarKeywords', String(calendarKeywords || ''));
    if (calendarLeadMinutes !== undefined) store.set('calendarLeadMinutes', Math.max(0, Number(calendarLeadMinutes) || 0));
    if (calendarTrailMinutes !== undefined) store.set('calendarTrailMinutes', Math.max(0, Number(calendarTrailMinutes) || 0));

    if (welcomeEnabled !== undefined) store.set('welcomeEnabled', !!welcomeEnabled);
    if (welcomeHeading !== undefined) store.set('welcomeHeading', String(welcomeHeading || ''));
    if (welcomeText !== undefined) store.set('welcomeText', String(welcomeText || ''));
    if (welcomeImageEntity !== undefined) store.set('welcomeImageEntity', String(welcomeImageEntity || ''));
    if (welcomeCaption !== undefined) store.set('welcomeCaption', String(welcomeCaption || ''));
    if (welcomeCaption2 !== undefined) store.set('welcomeCaption2', String(welcomeCaption2 || ''));
    if (welcomeHours !== undefined) store.set('welcomeHours', Math.max(0, Number(welcomeHours) || 0));
    if (welcomeImageEntity2 !== undefined) store.set('welcomeImageEntity2', String(welcomeImageEntity2 || ''));
    if (welcomeImage2Quelle !== undefined) store.set('welcomeImage2Quelle', String(welcomeImage2Quelle || ''));
    if (hintergrundBewegung !== undefined) store.set('hintergrundBewegung', !!hintergrundBewegung);
    if (rueckkehrSekunden !== undefined) {
      store.set('rueckkehrSekunden', Math.max(0, Math.min(3600, parseInt(rueckkehrSekunden, 10) || 0)));
    }
    if (welcomeTestmodus !== undefined) store.set('welcomeTestmodus', !!welcomeTestmodus);
    if (welcomeTestSekunden !== undefined) {
      // Unter drei Sekunden liesse sich der Schirm nicht mehr wegtippen -- er waere
      // sofort wieder da, und der Testmodus liesse sich nur noch von aussen abschalten.
      const v = Math.max(3, Math.min(600, parseInt(welcomeTestSekunden, 10) || 10));
      store.set('welcomeTestSekunden', v);
    }
    if (welcomeImageSeconds !== undefined) store.set('welcomeImageSeconds', Math.max(2, Number(welcomeImageSeconds) || 8));

    if (ankunftEnabled !== undefined) store.set('ankunftEnabled', !!ankunftEnabled);
    if (ankunftEntity !== undefined) store.set('ankunftEntity', String(ankunftEntity || '').trim());
    if (ankunftZuhause !== undefined) {
      // Ein leeres Feld heisst "Vorgabe", nicht "keine Zustaende". Ohne das waere die Liste
      // leer, nichts gaelte je als "zu Hause", und das Panel bliebe den ganzen Termin dunkel.
      const roh = String(ankunftZuhause || '').trim();
      store.set('ankunftZuhause', roh || ZUHAUSE_VORGABE);
    }
    if (ankunftNachMinuten !== undefined) {
      store.set('ankunftNachMinuten', Math.max(0, Math.min(1440, parseInt(ankunftNachMinuten, 10) || 0)));
    }

    if (abwesendEnabled !== undefined) store.set('abwesendEnabled', !!abwesendEnabled);
    if (abwesendHelligkeit !== undefined) {
      // Nicht bis null: Ein Bildschirm, der sich nicht mehr ablesen laesst, ist von einem
      // kaputten nicht zu unterscheiden -- und wer davorsteht, sucht den Fehler woanders.
      store.set('abwesendHelligkeit', Math.max(5, Math.min(100, parseInt(abwesendHelligkeit, 10) || 20)));
    }
    if (abwesendSekunden !== undefined) {
      store.set('abwesendSekunden', Math.max(5, Math.min(600, parseInt(abwesendSekunden, 10) || 20)));
    }
    if (desktopHintergrund !== undefined) store.set('desktopHintergrund', !!desktopHintergrund);

    if (abschiedEnabled !== undefined) store.set('abschiedEnabled', !!abschiedEnabled);
    if (abschiedHeading !== undefined) store.set('abschiedHeading', String(abschiedHeading || ''));
    if (abschiedText !== undefined) store.set('abschiedText', String(abschiedText || ''));
    if (abschiedDashboard !== undefined) store.set('abschiedDashboard', String(abschiedDashboard || '').trim());
    if (abschiedAbStunde !== undefined) {
      store.set('abschiedAbStunde', Math.max(0, Math.min(23, parseInt(abschiedAbStunde, 10) || 0)));
    }

    // Mindestlaenge, damit das Feld nicht versehentlich leer bleibt und der Schutz still ausfaellt.
    if (setupCode !== undefined && String(setupCode).length > 0) {
      const code = String(setupCode);
      if (code.length < 4) return res.status(400).json({ ok: false, error: 'Der Zugangscode muss mindestens 4 Zeichen haben' });
      store.set('setupCode', code);
      sessions.clear(); // nach einer Code-Aenderung muessen sich alle Geraete neu anmelden
    }

    res.json({ ok: true });
    if (onConfigSaved) onConfigSaved();
    // Sofort neu abrufen, statt bis zu zwei Minuten auf den naechsten Takt zu warten.
    if (controller) controller.refresh().catch(() => {});
  });

  app.post('/api/reset', (req, res) => {
    store.clear();
    res.json({ ok: true });
    if (onConfigSaved) onConfigSaved();
  });

  // Der Ankunftsschirm wurde weggetippt. Gespeichert wird der Beginn des Anzeigefensters, zu dem
  // er gehoerte -- damit ueberdauert das Wegtippen einen Neustart, und beim naechsten Termin
  // erscheint der Schirm wieder. Bewusst eine eigene Route: ueber /api/config wuerde das daran
  // haengende onConfigSaved() die Ansicht neu laden.
  app.post('/api/welcome/dismiss', (req, res) => {
    const start = String((req.body && req.body.windowStart) || '');
    // Ein leerer Fensterbeginn ist erlaubt: Beim erzwungenen Anzeigen laeuft kein Termin, und
    // trotzdem muss sich der Schirm wegtippen lassen.
    if (start) store.set('welcomeDismissedFor', start);
    store.delete('welcomeErzwungenBis');
    res.json({ ok: true });
  });

  // Weggetippt gilt fuer genau diesen Termin -- wie beim Ankunftsschirm. Eigene Route aus
  // demselben Grund: ueber /api/config wuerde onConfigSaved() die Ansicht neu laden, und der
  // Schirm waere sofort wieder da.
  app.post('/api/abschied/dismiss', (req, res) => {
    const start = String((req.body && req.body.windowStart) || '');
    if (start) store.set('abschiedDismissedFor', start);
    res.json({ ok: true });
  });

  // Wie lange ein erzwungener Ankunftsschirm stehen bleibt, wenn ihn niemand wegtippt. Lang
  // genug, um vom Einstellungsgeraet zur Wand zu gehen und hinzusehen; kurz genug, dass ein
  // vergessener Knopfdruck das Panel nicht den halben Tag blockiert.
  const WELCOME_ERZWUNGEN_MS = 10 * 60 * 1000;

  // Ankunftsschirm jetzt zeigen.
  //
  // Vorher wurde hier nur der Verworfen-Zustand geloescht -- und das reichte nicht: Ohne
  // laufenden Termin gibt es kein Anzeigefenster, und der Schirm erschien trotzdem nicht.
  // Wer ihn ansehen will, hat aber in aller Regel gerade keinen Termin laufen. Jetzt wird ein
  // Zeitfenster gesetzt, das die Anzeige unabhaengig vom Kalender erzwingt.
  app.post('/api/welcome/show', (req, res) => {
    store.delete('welcomeDismissedFor');
    store.set('welcomeErzwungenBis', Date.now() + WELCOME_ERZWUNGEN_MS);
    res.json({ ok: true, minuten: Math.round(WELCOME_ERZWUNGEN_MS / 60000) });
  });

  // --- Kalendersteuerung ----------------------------------------------------------------------

  app.get('/api/calendar/state', (req, res) => {
    if (!controller) return res.json({ ok: false, error: 'Steuerung nicht aktiv' });
    res.json({ ok: true, state: controller.getState() });
  });

  // Der zweite von drei Wegen in die Pause -- dieser hier ist der, den man vom Handy aus findet.
  app.post('/api/calendar/pause', (req, res) => {
    if (!controller) return res.json({ ok: false, error: 'Steuerung nicht aktiv' });
    const pausedUntil = controller.pause(req.body && req.body.minutes);
    res.json({ ok: true, pausedUntil, state: controller.getState() });
  });

  app.post('/api/calendar/resume', (req, res) => {
    if (!controller) return res.json({ ok: false, error: 'Steuerung nicht aktiv' });
    controller.resume();
    res.json({ ok: true, state: controller.getState() });
  });

  // Vorschau: welche Treffer liefert die aktuelle Keyword-Eingabe? Erlaubt es, die Einstellung
  // zu pruefen, ohne auf den naechsten Termin warten zu muessen.
  app.get('/api/calendar/preview', async (req, res) => {
    const haUrl = store.get('haUrl');
    const token = store.get('token');
    const entity = req.query.entity || store.get('calendarEntity');
    const keywords = req.query.keywords !== undefined ? req.query.keywords : store.get('calendarKeywords');
    if (!haUrl || !token) return res.json({ ok: false, error: 'Erst Verbindung einrichten' });
    if (!entity) return res.json({ ok: false, error: 'Kein Kalender ausgewählt' });
    try {
      const windows = await calendar.fetchWindows({
        haUrl, token, entity, keywords,
        leadMinutes: Number(req.query.lead) || 0,
        trailMinutes: Number(req.query.trail) || 0
      });
      res.json({
        ok: true,
        windows: windows.slice(0, 20).map(w => ({
          title: w.title, start: w.start.toISOString(), end: w.end.toISOString()
        }))
      });
    } catch (err) {
      res.json({ ok: false, error: String(err.message || err) });
    }
  });

  // Proxy fuer das Dashboard: aktuelle Zustaende ausgewaehlter Entitaeten
  app.get('/api/ha/states', async (req, res) => {
    const haUrl = store.get('haUrl');
    const token = store.get('token');
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'nicht konfiguriert' });
    try {
      const r = await haFetch(haUrl, token, '/api/states');
      const states = await r.json();
      res.json({ ok: true, states });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  // Proxy fuer Service-Aufrufe (z.B. Licht schalten)
  app.post('/api/ha/service', async (req, res) => {
    const haUrl = store.get('haUrl');
    const token = store.get('token');
    const { domain, service, service_data } = req.body || {};
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'nicht konfiguriert' });
    try {
      const r = await haFetch(haUrl, token, `/api/services/${domain}/${service}`, {
        method: 'POST',
        body: JSON.stringify(service_data || {})
      });
      const data = await r.json().catch(() => ({}));
      res.json({ ok: r.ok, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  // Verlaufsdaten fuer die "Verlauf"-Karte (Sparkline der letzten Stunden)
  app.get('/api/ha/history', async (req, res) => {
    const haUrl = store.get('haUrl');
    const token = store.get('token');
    const entity_id = req.query.entity_id;
    const hours = parseInt(req.query.hours, 10) || 24;
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'nicht konfiguriert' });
    if (!entity_id) return res.status(400).json({ ok: false, error: 'entity_id erforderlich' });
    const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    try {
      const r = await haFetch(haUrl, token, `/api/history/period/${start}?filter_entity_id=${encodeURIComponent(entity_id)}&minimal_response`);
      if (!r.ok) return res.json({ ok: false, error: `HA antwortete mit Status ${r.status}` });
      const data = await r.json();
      const series = (data[0] || [])
        .map(p => ({ t: p.last_changed, v: parseFloat(p.state) }))
        .filter(p => !isNaN(p.v));
      res.json({ ok: true, series });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  // Standortverlauf fuer die Tracker-Unterdashboard-Karte (z.B. GPS-Halsband der Katze) --
  // anders als /api/ha/history: braucht volle Attribute (lat/lon/Akku) statt nur Zahlenwerte,
  // und einen frei waehlbaren Start/Ende-Zeitraum statt nur "die letzten X Stunden".
  app.get('/api/ha/tracker-history', async (req, res) => {
    const haUrl = store.get('haUrl');
    const token = store.get('token');
    const entity_id = req.query.entity_id;
    const start = req.query.start;
    const end = req.query.end;
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'nicht konfiguriert' });
    if (!entity_id) return res.status(400).json({ ok: false, error: 'entity_id erforderlich' });
    if (!start || !end) return res.status(400).json({ ok: false, error: 'start und end erforderlich' });
    try {
      const qs = `filter_entity_id=${encodeURIComponent(entity_id)}&end_time=${encodeURIComponent(end)}`;
      const r = await haFetch(haUrl, token, `/api/history/period/${encodeURIComponent(start)}?${qs}`);
      if (!r.ok) return res.json({ ok: false, error: `HA antwortete mit Status ${r.status}` });
      const data = await r.json();
      const raw = data[0] || [];
      const points = raw
        .map(p => ({
          lat: p.attributes && parseFloat(p.attributes.latitude),
          lon: p.attributes && parseFloat(p.attributes.longitude),
          battery: p.attributes && (p.attributes.battery_level ?? p.attributes.battery),
          t: p.last_changed
        }))
        .filter(p => !isNaN(p.lat) && !isNaN(p.lon));
      const lastBattery = [...raw].reverse().map(p => p.attributes && (p.attributes.battery_level ?? p.attributes.battery)).find(b => b !== undefined && b !== null);
      res.json({ ok: true, points, battery: lastBattery ?? null });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  // Bild-Proxy fuer Kamera-/Bild-Entitaeten (z.B. Regenradar-Karte)
  app.get('/api/ha/media', async (req, res) => {
    const haUrl = store.get('haUrl');
    const token = store.get('token');
    const entity_id = req.query.entity_id;
    if (!haUrl || !token) return res.status(400).end();
    if (!entity_id) return res.status(400).end();
    const domain = entity_id.split('.')[0];
    const endpoint = domain === 'camera'
      ? `/api/camera_proxy/${entity_id}`
      : `/api/image_proxy/${entity_id}`;
    try {
      const r = await haFetch(haUrl, token, endpoint, { headers: {} });
      if (!r.ok) return res.status(502).end();
      res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      const buf = Buffer.from(await r.arrayBuffer());
      res.send(buf);
    } catch (err) {
      res.status(500).end();
    }
  });

  // Generischer Bild-Proxy fuer beliebige relative HA-Pfade (z.B. "entity_picture"
  // Attribut von media_player-Entitaeten fuers Album-Cover -- anders aufgebaut als der
  // Kamera-Proxy oben, daher eigener, einfacherer Endpunkt).
  app.get('/api/ha/picture', async (req, res) => {
    const haUrl = store.get('haUrl');
    const token = store.get('token');
    const path = req.query.path;
    if (!haUrl || !token) return res.status(400).end();
    if (!path || !path.startsWith('/')) return res.status(400).end();
    try {
      const r = await haFetch(haUrl, token, path, { headers: {} });
      if (!r.ok) return res.status(502).end();
      res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      const buf = Buffer.from(await r.arrayBuffer());
      res.send(buf);
    } catch (err) {
      res.status(500).end();
    }
  });

  // Update-Steuerung aus dem Webinterface
  app.get('/api/update/status', (req, res) => {
    if (!updater) return res.json({ ok: false, error: 'Updater nicht verfuegbar' });
    res.json({ ok: true, currentVersion: updater.currentVersion, ...updater.getState() });
  });

  // autoInstall=true ist der Ein-Klick-Weg: suchen, laden, installieren ohne weitere Rueckfrage.
  app.post('/api/update/check', (req, res) => {
    if (!updater) return res.status(400).json({ ok: false, error: 'Updater nicht verfuegbar' });
    updater.check(!!(req.body && req.body.autoInstall));
    res.json({ ok: true });
  });

  app.post('/api/update/install', (req, res) => {
    if (!updater) return res.status(400).json({ ok: false, error: 'Updater nicht verfuegbar' });
    const state = updater.getState();
    if (!state.downloaded) return res.status(400).json({ ok: false, error: 'Noch kein Update heruntergeladen' });
    res.json({ ok: true });
    setTimeout(() => updater.install(), 300); // Antwort erst rausschicken, dann App beenden/installieren
  });

  // Kommende Termine einer calendar-Entitaet (z.B. von einer Muellkalender-Integration wie
  // Abfall.io) -- HA's normaler /api/states liefert nur den GERADE laufenden Termin, fuer eine
  // Liste kommender Termine gibt es eine eigene REST-Route mit Zeitfenster.
  app.get('/api/ha/calendar-events', async (req, res) => {
    const haUrl = store.get('haUrl');
    const token = store.get('token');
    const entity_id = req.query.entity_id;
    const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || 60));
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'nicht konfiguriert' });
    if (!entity_id) return res.status(400).json({ ok: false, error: 'entity_id erforderlich' });
    try {
      const start = new Date();
      const end = new Date(Date.now() + days * 86400000);
      const qs = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
      const r = await haFetch(haUrl, token, `/api/calendars/${entity_id}?${qs}`);
      if (!r.ok) return res.json({ ok: false, error: `HA antwortete mit Status ${r.status}` });
      const events = await r.json();
      const normalized = (Array.isArray(events) ? events : [])
        .map(e => ({
          summary: e.summary || e.message || '',
          start: (e.start && (e.start.dateTime || e.start.date)) || e.start || null
        }))
        .filter(e => e.start)
        .sort((a, b) => new Date(a.start) - new Date(b.start));
      res.json({ ok: true, events: normalized });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  // Vorhersagedaten fuer die "Wettervorhersage"-Karte. HA hat den Zugriffsweg im
  // Lauf der Zeit geaendert: aeltere Versionen liefern sie als Attribut "forecast"
  // am weather-Entity, neuere nur noch per Service-Aufruf "weather.get_forecasts"
  // mit Response-Daten -- wir versuchen beides, in dieser Reihenfolge.
  app.get('/api/ha/forecast', async (req, res) => {
    const haUrl = store.get('haUrl');
    const token = store.get('token');
    const entity_id = req.query.entity_id;
    const requestedType = req.query.type; // 'daily' | 'hourly' | 'twice_daily' -- optional, sonst Fallback-Reihenfolge
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'nicht konfiguriert' });
    if (!entity_id) return res.status(400).json({ ok: false, error: 'entity_id erforderlich' });
    try {
      // 1) Alter Weg: Attribut "forecast" direkt am weather-Entity (manche Integrationen
      // liefern es noch, obwohl im HA-Core als deprecated markiert). Gilt unabhaengig vom
      // gewuenschten Typ, da dieser Weg keine Typ-Auswahl kennt.
      const stateRes = await haFetch(haUrl, token, `/api/states/${entity_id}`);
      if (stateRes.ok) {
        const state = await stateRes.json();
        const attrForecast = state.attributes && state.attributes.forecast;
        if (Array.isArray(attrForecast) && attrForecast.length) {
          return res.json({ ok: true, forecast: attrForecast });
        }
      }

      // 2) Neuer Weg: Service "weather.get_forecasts" mit Response-Daten. HA packt die
      // Antwort je nach Version leicht unterschiedlich ein -- mehrere Formen probieren.
      // Ohne explizit gewaehlten Typ wird die alte Fallback-Reihenfolge probiert.
      const typesToTry = requestedType ? [requestedType] : ['daily', 'twice_daily', 'hourly'];
      let lastRaw = '';
      let lastStatus = 0;
      for (const type of typesToTry) {
        const svcRes = await haFetch(haUrl, token, `/api/services/weather/get_forecasts?return_response=true`, {
          method: 'POST',
          body: JSON.stringify({ entity_id, type })
        });
        lastStatus = svcRes.status;
        const text = await svcRes.text();
        lastRaw = text;
        if (!svcRes.ok) continue;
        let data = null;
        try { data = JSON.parse(text); } catch (e) { continue; }
        const forecast =
          (data.service_response && data.service_response[entity_id] && data.service_response[entity_id].forecast) ||
          (data.response && data.response[entity_id] && data.response[entity_id].forecast) ||
          (data[entity_id] && data[entity_id].forecast);
        if (Array.isArray(forecast) && forecast.length) {
          return res.json({ ok: true, forecast });
        }
      }
      res.json({
        ok: false,
        error: `Keine Vorhersagedaten gefunden (letzter Service-Status ${lastStatus}: ${lastRaw.slice(0, 200)})`
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  // --- Debug-Werkzeug fuer die Vorhersage-Karte: eigene URL/Token pro Anfrage (nicht
  // zwingend die gespeicherte Verbindung), zeigt jeden Versuch inkl. Rohantwort. ---
  app.get('/api/debug/weather-entities', async (req, res) => {
    const haUrl = req.query.haUrl || store.get('haUrl');
    const token = req.query.token || store.get('token');
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'haUrl und token erforderlich' });
    try {
      const r = await haFetch(haUrl, token, '/api/states');
      if (!r.ok) return res.json({ ok: false, error: `HA antwortete mit Status ${r.status}` });
      const states = await r.json();
      const entities = states
        .filter(s => s.entity_id.startsWith('weather.'))
        .map(s => ({ entity_id: s.entity_id, name: s.attributes.friendly_name || s.entity_id }));
      res.json({ ok: true, entities });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.get('/api/debug/forecast', async (req, res) => {
    const haUrl = req.query.haUrl || store.get('haUrl');
    const token = req.query.token || store.get('token');
    const entity_id = req.query.entity_id;
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'haUrl und token erforderlich' });
    if (!entity_id) return res.status(400).json({ ok: false, error: 'entity_id erforderlich' });

    const steps = [];
    let finalForecast = null;

    try {
      // Schritt 1: Attribut "forecast" direkt am Entity (alter, evtl. noch aktiver Weg)
      const stateRes = await haFetch(haUrl, token, `/api/states/${entity_id}`);
      const stateText = await stateRes.text();
      let stateJson = null;
      try { stateJson = JSON.parse(stateText); } catch (e) { /* kein JSON */ }
      const attrForecast = stateJson && stateJson.attributes && stateJson.attributes.forecast;
      const attrFound = Array.isArray(attrForecast) && attrForecast.length > 0;
      steps.push({
        step: 'Attribut "forecast" am Entity (GET /api/states/<entity_id>)',
        status: stateRes.status,
        found: attrFound,
        count: attrFound ? attrForecast.length : 0,
        raw: stateText.slice(0, 3000)
      });
      if (attrFound) finalForecast = attrForecast;

      // Schritt 2: Service weather.get_forecasts fuer jeden bekannten Vorhersage-Typ
      for (const type of ['daily', 'twice_daily', 'hourly']) {
        const svcRes = await haFetch(haUrl, token, `/api/services/weather/get_forecasts?return_response=true`, {
          method: 'POST',
          body: JSON.stringify({ entity_id, type })
        });
        const text = await svcRes.text();
        let data = null;
        try { data = JSON.parse(text); } catch (e) { /* kein JSON */ }
        const forecast = data && (
          (data.service_response && data.service_response[entity_id] && data.service_response[entity_id].forecast) ||
          (data.response && data.response[entity_id] && data.response[entity_id].forecast) ||
          (data[entity_id] && data[entity_id].forecast)
        );
        const found = Array.isArray(forecast) && forecast.length > 0;
        steps.push({
          step: `Service weather.get_forecasts (type="${type}")`,
          status: svcRes.status,
          found,
          count: found ? forecast.length : 0,
          raw: text.slice(0, 3000)
        });
        if (!finalForecast && found) finalForecast = forecast;
      }

      res.json({ ok: true, steps, forecast: finalForecast || [] });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err), steps });
    }
  });

  // --- Zusaetzliche, eigenstaendige Dashboards (Unterdashboards) ------------------------
  app.get('/api/dashboards', (req, res) => {
    const list = store.get('dashboards') || [];
    res.json({ ok: true, dashboards: list.map(d => ({ id: d.id, name: d.name, type: d.type || 'cards' })) });
  });

  app.get('/api/dashboards/:id', (req, res) => {
    const list = store.get('dashboards') || [];
    const d = list.find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ ok: false, error: 'Dashboard nicht gefunden' });
    res.json({ ok: true, dashboard: d });
  });

  // Neues Dashboard anlegen -- type "cards" (Standard, wie bisher) oder "tracker"
  // (Kartenansicht mit Standort+Verlauf eines device_tracker, z.B. fuer ein GPS-Halsband).
  app.post('/api/dashboards', (req, res) => {
    const { name, type, trackerEntity } = req.body || {};
    const list = store.get('dashboards') || [];
    const id = 'db_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const entry = { id, name: (name || 'Dashboard').trim() || 'Dashboard', type: type === 'tracker' ? 'tracker' : 'cards', layout: [] };
    if (entry.type === 'tracker') entry.trackerEntity = trackerEntity || '';
    list.push(entry);
    store.set('dashboards', list);
    res.json({ ok: true, id });
  });

  // Bestehendes Dashboard speichern (Name, Karten-Layout, und/oder Tracker-Einstellungen)
  app.post('/api/dashboards/:id', (req, res) => {
    const list = store.get('dashboards') || [];
    const idx = list.findIndex(x => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Dashboard nicht gefunden' });
    const { name, layout, trackerEntity, trackerIconDataUrl, trackerDefaultZoom, trackerShowZones, trackerAutoCenter } = req.body || {};
    if (name !== undefined) list[idx].name = name;
    if (layout !== undefined) list[idx].layout = layout;
    if (trackerEntity !== undefined) list[idx].trackerEntity = trackerEntity;
    if (trackerIconDataUrl !== undefined) list[idx].trackerIconDataUrl = trackerIconDataUrl;
    if (trackerDefaultZoom !== undefined) list[idx].trackerDefaultZoom = trackerDefaultZoom;
    if (trackerShowZones !== undefined) list[idx].trackerShowZones = trackerShowZones;
    if (trackerAutoCenter !== undefined) list[idx].trackerAutoCenter = trackerAutoCenter;
    store.set('dashboards', list);
    res.json({ ok: true });
    if (onConfigSaved) onConfigSaved();
  });

  app.post('/api/dashboards/:id/delete', (req, res) => {
    const list = (store.get('dashboards') || []).filter(x => x.id !== req.params.id);
    store.set('dashboards', list);
    res.json({ ok: true });
    if (onConfigSaved) onConfigSaved();
  });

  // --- Zustandsaenderungen sofort weiterreichen -------------------------------------------------
  //
  // Die Anzeige fragt die Zustaende ohnehin regelmaessig ab. Das ist das Netz; hier kommt die
  // Abkuerzung: Aendert jemand etwas in der Home-Assistant-App, weiss das Panel es in
  // Sekundenbruchteilen statt beim naechsten Abruf.
  //
  // Weitergereicht wird ueber Server-Sent Events, nicht ueber einen zweiten WebSocket: Die
  // Anzeige spricht ohnehin nur HTTP mit diesem Server, EventSource verbindet sich nach einem
  // Abbruch von selbst wieder, und es geht nur in eine Richtung -- mehr braucht es nicht.

  const liveHoerer = new Set();

  // Wie lange die Tore zum Oeffnen und Schliessen brauchen -- gemessen beim ersten Durchlauf.
  //
  // Hier und nicht in der Anzeige: Dieser Server haelt die Verbindung zu Home Assistant
  // dauerhaft offen, die Anzeige nicht. Nachts ist das Panel aus, und genau dann faehrt ein
  // Hoftor am ehesten. Eine Messung, die nur zustande kaeme, wenn jemand hinsieht, kaeme nie
  // zustande.
  const torBeobachter = new TorBeobachter({
    laden: () => store.get('torZeiten') || {},
    speichern: (alle) => store.set('torZeiten', alle)
  });

  const haLive = new HaLive({
    getConfig: () => ({ haUrl: store.get('haUrl'), token: store.get('token') }),
    onAenderung: (aenderung) => {
      // Die Steuerung im Hauptprozess wartet unter Umstaenden genau auf diese eine Entitaet:
      // Stellt jemand die Alarmanlage auf "zu Hause", ist das die Ankunft, und das Panel soll
      // in dem Moment angehen -- nicht erst beim naechsten Abruf zwei Minuten spaeter.
      // Tore: aus den Zustandswechseln die Fahrzeiten lernen.
      try {
        if (torBeobachter.gemeldet(aenderung.entity_id, aenderung.state)) {
          console.log('[Tor] ' + aenderung.entity_id + ': ' + JSON.stringify((store.get('torZeiten') || {})[aenderung.entity_id]));
        }
      } catch (e) { /* eine misslungene Messung darf die Anzeige nicht aufhalten */ }

      if (controller && controller.zustandGemeldet) {
        try { controller.zustandGemeldet(aenderung.entity_id, aenderung.state); } catch (e) { /* die Anzeige darf davon nichts merken */ }
      }
      const zeile = 'data: ' + JSON.stringify(aenderung) + '\n\n';
      for (const res of liveHoerer) {
        try { res.write(zeile); } catch (e) { liveHoerer.delete(res); }
      }
    },
    onStatus: (verbunden) => {
      // Frisch verbunden: Die Namen aus der Entitaetsregistrierung holen. Sie aendern sich fast
      // nie, deshalb einmal je Verbindung und nicht auf Zuruf.
      if (verbunden) namenHolen();
      const zeile = 'event: status\ndata: ' + JSON.stringify({ verbunden }) + '\n\n';
      for (const res of liveHoerer) {
        try { res.write(zeile); } catch (e) { liveHoerer.delete(res); }
      }
    },
    log: (text) => console.log('[HA-Live] ' + text)
  });
  haLive.start();

  // --- Die kurzen Namen der Entitaeten ----------------------------------------------------------
  //
  // Ueber REST liefert Home Assistant nur `friendly_name` -- und der enthaelt bei den meisten
  // Integrationen den Geraetenamen davor: "Ecowitt Sensor 11DC2 Solar Radiation". Auf einer
  // Karte, die zwei Zentimeter breit ist, steht davon die Haelfte.
  //
  // Den kurzen Namen ("Solar Radiation") kennt nur die Entitaetsregistrierung, und die gibt es
  // ausschliesslich ueber die WebSocket-Verbindung. Die steht ohnehin.
  //
  // Kein Store, nur Speicher: Ein Name von gestern ist kein Schaden, aber auch kein Gewinn --
  // und nach einem Neustart ist die Verbindung binnen Sekunden wieder da.
  let entitaetsNamen = null;

  async function namenHolen() {
    try {
      const liste = await haLive.befehl('config/entity_registry/list');
      if (!Array.isArray(liste)) return;
      const zu = {};
      liste.forEach((e) => {
        if (!e || !e.entity_id) return;
        // `name` ist der selbst vergebene Name, `original_name` der der Integration. Der selbst
        // vergebene gewinnt -- wer eine Entitaet umbenennt, will das auch hier sehen.
        const n = (e.name || e.original_name || '').trim();
        if (n) zu[e.entity_id] = n;
      });
      entitaetsNamen = zu;
      console.log('[HA-Live] ' + Object.keys(zu).length + ' Entitaetsnamen geholt');
    } catch (err) {
      // Ohne Administratorrechte lehnt Home Assistant die Registrierung ab. Kein Beinbruch:
      // Dann bleibt es bei friendly_name, so wie es vorher war.
      entitaetsNamen = null;
      console.log('[HA-Live] Entitaetsnamen nicht verfuegbar: ' + String(err.message || err));
    }
  }

  // --- Das Windows-Hintergrundbild --------------------------------------------------------------
  //
  // Gezeichnet wird es in der Anzeige (dort liegen Farben, Schrift und die Groesse des Panels),
  // gespeichert hier. Zwei Fassungen: die normale und eine mit dem Hinweis, dass gerade ein
  // Update laeuft. Sie werden gebraucht, wenn die App gerade NICHT laeuft -- dann kann sie
  // nichts mehr zeichnen.
  function hintergrundPfad(art) {
    return path.join(bgDir(), art === 'wartung' ? 'desktop-wartung.png' : 'desktop.png');
  }

  app.post('/api/hintergrund', (req, res) => {
    const { normal, wartung } = req.body || {};
    const schreiben = (dataUrl, art) => {
      const m = dataUrl && String(dataUrl).match(/^data:image\/png;base64,(.+)$/);
      if (!m) return false;
      fs.writeFileSync(hintergrundPfad(art), Buffer.from(m[1], 'base64'));
      return true;
    };
    try {
      const a = schreiben(normal, 'normal');
      const b = schreiben(wartung, 'wartung');
      if (!a || !b) return res.status(400).json({ ok: false, error: 'PNG erwartet' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  // Die gemessenen Fahrzeiten. Die Anzeige richtet ihre Animation danach aus.
  app.get('/api/tor-zeiten', (req, res) => {
    res.json({ ok: true, zeiten: store.get('torZeiten') || {} });
  });

  app.get('/api/ha/namen', (req, res) => {
    res.json({ ok: true, namen: entitaetsNamen || {} });
  });

  app.get('/api/ha/live', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      // Ohne das puffert mancher Zwischenspeicher den Strom und nichts kommt an.
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    // Sofort sagen, woran man ist -- sonst weiss die Anzeige nicht, ob sie sich auf die
    // Verbindung verlassen kann und wie oft sie selbst abfragen muss.
    res.write('event: status\ndata: ' + JSON.stringify({ verbunden: haLive.istVerbunden() }) + '\n\n');
    liveHoerer.add(res);
    req.on('close', () => liveHoerer.delete(res));
  });

  // --- Dashboards aus- und eingeben ------------------------------------------------------------
  //
  // Eine Datei, die man weitergeben, sichern und in einem Chatfenster bearbeiten kann. Das
  // Format und die Gruende stehen in server/dashboard-austausch.js.

  app.get('/api/dashboards/:id/export', (req, res) => {
    const list = store.get('dashboards') || [];
    const d = list.find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ ok: false, error: 'Dashboard nicht gefunden' });
    const { datei, hinweise } = austausch.exportieren(d, CARD_TYPES);
    res.json({ ok: true, datei, hinweise });
  });

  // Das Hauptdashboard liegt nicht in der Dashboard-Liste, sondern als 'layout' in der
  // Konfiguration. Fuer den Export ist das ein Sonderfall, sonst waere ausgerechnet das
  // wichtigste Dashboard das einzige, das man nicht mitnehmen kann.
  app.get('/api/dashboard-haupt/export', (req, res) => {
    const d = { name: store.get('title') || 'Hauptdashboard', type: 'cards', layout: store.get('layout') || [] };
    const { datei, hinweise } = austausch.exportieren(d, CARD_TYPES);
    res.json({ ok: true, datei, hinweise });
  });

  // Der Pfad heisst BEWUSST nicht /api/dashboards/import: Darueber steht
  // app.post('/api/dashboards/:id'), Express nimmt die erste passende Route, und "import"
  // waere fuer sie eine Dashboard-Kennung. Genau das ist in 1.10.0 passiert -- jeder Import
  // antwortete "Dashboard nicht gefunden". Ein Pfad, der gar nicht erst kollidieren kann, ist
  // haltbarer als eine bestimmte Reihenfolge, die beim naechsten Einfuegen wieder kippt.
  app.post('/api/dashboard-import', (req, res) => {
    const ergebnis = austausch.importieren(req.body && req.body.datei, CARD_TYPES);
    if (!ergebnis.ok) return res.status(400).json({ ok: false, fehler: ergebnis.fehler, warnungen: ergebnis.warnungen });
    const list = store.get('dashboards') || [];
    const id = 'db_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    list.push(Object.assign({ id }, ergebnis.dashboard));
    store.set('dashboards', list);
    res.json({ ok: true, id, name: ergebnis.dashboard.name, anzahl: ergebnis.dashboard.layout.length, warnungen: ergebnis.warnungen });
    if (onConfigSaved) onConfigSaved();
  });

  // Die Anleitung auch einzeln -- wer ein Dashboard von Grund auf schreiben lassen will,
  // braucht sie, ohne vorher eines exportiert zu haben.
  app.get('/api/dashboard-format', (req, res) => {
    res.json({ ok: true, format: austausch.FORMAT, version: austausch.VERSION, anleitung: austausch.anleitung(CARD_TYPES) });
  });

  // Liest HA's Energie-Dashboard-Konfiguration aus (Netz-/Solar-/Batterie-Entitaeten,
  // wie im "Einstellungen -> Dashboards -> Energie" von HA hinterlegt) und schlaegt
  // daraus passende Live-Leistungssensoren vor. Bewusst best-effort: HA erlaubt hier
  // pro Quelle mehrere Statistik-IDs, wir nehmen jeweils die erste sinnvolle.
  app.get('/api/ha/energy-prefs', async (req, res) => {
    const haUrl = req.query.haUrl || store.get('haUrl');
    const token = req.query.token || store.get('token');
    if (!haUrl || !token) return res.status(400).json({ ok: false, error: 'nicht konfiguriert' });
    try {
      const prefs = await haWebsocketCommand(haUrl, token, { type: 'energy/get_prefs' });
      const sources = prefs.energy_sources || [];
      const gridSource = sources.find(s => s.type === 'grid');
      const solarSources = sources.filter(s => s.type === 'solar');
      const batterySources = sources.filter(s => s.type === 'battery');

      const gridConsumption = gridSource && gridSource.flow_from && gridSource.flow_from[0]
        ? gridSource.flow_from[0].stat_energy_from : '';
      const gridReturn = gridSource && gridSource.flow_to && gridSource.flow_to[0]
        ? gridSource.flow_to[0].stat_energy_to : '';
      const solar = solarSources[0] ? solarSources[0].stat_energy_from : '';
      const batteryIn = batterySources[0] ? batterySources[0].stat_energy_to : '';
      const batteryOut = batterySources[0] ? batterySources[0].stat_energy_from : '';

      res.json({
        ok: true,
        gridConsumption, gridReturn, solar, batteryIn, batteryOut,
        raw: prefs // fuer Debug-Zwecke, falls die Zuordnung nicht passt
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  function bgDir() { return path.dirname(store.path); }

  // --- Foto-Bereich-Karte: eigenes Bild pro Karte -- Karten-ID (z.B. "photo:1712345678") wird fuer den Dateinamen bereinigt.
  function photoCardFilePath(cardId, ext) {
    const safeId = String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(bgDir(), 'photo-card-' + safeId + ext);
  }

  app.post('/api/photo-card/:cardId/background', (req, res) => {
    const cardId = req.params.cardId;
    const { dataUrl } = req.body || {};
    const match = dataUrl && dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
    if (!match) return res.status(400).json({ ok: false, error: 'Ungültiges Bildformat (JPEG, PNG oder WEBP erwartet)' });
    try {
      const oldExt = store.get('photoCardExt:' + cardId);
      if (oldExt) { try { fs.unlinkSync(photoCardFilePath(cardId, oldExt)); } catch (e) { /* gab es evtl. nicht mehr */ } }
      const ext = '.' + (match[1] === 'jpeg' ? 'jpg' : match[1]);
      fs.writeFileSync(photoCardFilePath(cardId, ext), Buffer.from(match[2], 'base64'));
      store.set('photoCardExt:' + cardId, ext);
      store.set('photoCardVersion:' + cardId, Date.now());
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.get('/api/photo-card/:cardId/background', (req, res) => {
    const cardId = req.params.cardId;
    const ext = store.get('photoCardExt:' + cardId);
    if (!ext) return res.status(404).end();
    const filePath = photoCardFilePath(cardId, ext);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  });

  app.post('/api/photo-card/:cardId/background/remove', (req, res) => {
    const cardId = req.params.cardId;
    const ext = store.get('photoCardExt:' + cardId);
    if (ext) { try { fs.unlinkSync(photoCardFilePath(cardId, ext)); } catch (e) { /* gab es evtl. nicht mehr */ } }
    store.delete('photoCardExt:' + cardId);
    store.delete('photoCardVersion:' + cardId);
    res.json({ ok: true });
  });

  // --- Design-Import: eine JSON-Datei kann Farben UND Formen/Abstaende auf einen Schlag
  // ersetzen (statt alles einzeln einzustellen). Erwartetes Format siehe design-import.html
  // (Felder fuer dark/light je Farbe, plus cardRadius/cardShadow). Wird nur grob auf Struktur
  // geprueft -- die eigentlichen Werte landen 1:1 als CSS-Variablen im Client.
  const THEME_KEYS = ['bg', 'surface', 'panel2', 'cardBorder', 'text', 'muted'];
  function validTheme(t) {
    if (!t || typeof t !== 'object') return false;
    if (!t.dark || !t.light) return false;
    for (const mode of [t.dark, t.light]) {
      if (typeof mode !== 'object') return false;
      for (const k of THEME_KEYS) if (typeof mode[k] !== 'string') return false;
    }
    // Alles ab hier ist optional (Glas-Effekt + generisches Escape-Hatch fuer komplexere
    // Designs) -- wird nur auf Typ geprueft, wenn ueberhaupt vorhanden.
    const OPTIONAL_STRING_KEYS = ['cardRadius', 'cardShadow', 'cardBlur', 'cardSaturate',
      'cardHighlight', 'cardHighlightSide', 'pageBgImage', 'pageBgGradient', 'extraCss', 'name'];
    for (const k of OPTIONAL_STRING_KEYS) if (t[k] !== undefined && typeof t[k] !== 'string') return false;
    if (typeof t.extraCss === 'string' && t.extraCss.length > 20000) return false; // grobe Notbremse
    return true;
  }

  app.post('/api/theme/import', (req, res) => {
    const theme = req.body;
    if (!validTheme(theme)) {
      return res.status(400).json({ ok: false, error: 'Ungültiges Design-Format – dark/light mit bg, surface, panel2, cardBorder, text, muted (alle als Text) erforderlich.' });
    }
    store.set('customTheme', theme);
    res.json({ ok: true });
  });

  app.post('/api/theme/reset', (req, res) => {
    store.delete('customTheme');
    res.json({ ok: true });
  });

  // Der HTTP-Server haengt am app-Objekt, damit Tests ihn wieder schliessen koennen -- ohne das
  // bleibt der Node-Prozess nach einem Test ewig offen. Fuer die Live-Verbindung gilt dasselbe:
  // Sie versucht sonst im Hintergrund weiter, Home Assistant zu erreichen.
  app.server = app.listen(port, '0.0.0.0', () => {
    console.log(`Setup-Server laeuft auf Port ${port}`);
  });

  app.haLive = haLive;
  return app;
}

module.exports = { startServer };
