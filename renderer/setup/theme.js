const $ = id => document.getElementById(id);

async function load() {
  const [configRes, sunEntitiesRes, textEntitiesRes] = await Promise.all([
    fetch('/api/config').then(r => r.json()),
    fetch('/api/entities?domain=sun').then(r => r.json()),
    fetch('/api/entities?domain=input_text').then(r => r.json())
  ]);
  const sunSelect = $('sunEntity');
  if (sunEntitiesRes.ok) {
    sunEntitiesRes.entities.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.entity_id;
      opt.textContent = e.name;
      if (e.entity_id === configRes.sunEntity) opt.selected = true;
      sunSelect.appendChild(opt);
    });
  }
  const notifySelect = $('notifyEntity');
  if (textEntitiesRes.ok) {
    textEntitiesRes.entities.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.entity_id;
      opt.textContent = e.name;
      if (e.entity_id === configRes.notifyEntity) opt.selected = true;
      notifySelect.appendChild(opt);
    });
  }
  // Zeigen, was in der gewaehlten Entitaet gerade WIRKLICH steht.
  //
  // Ohne diese Zeile sucht man den Fehler an der falschen Stelle: Auf dem Geraet stand
  // "unknow" (ohne das letzte n) in der konfigurierten Entitaet, und es gab daneben eine
  // zweite, richtig geschriebene. Welche gewaehlt ist und was drinsteht, sah man nirgends.
  async function notifyVorschau() {
    const el = $('notifyVorschau');
    const id = $('notifyEntity').value;
    if (!el) return;
    if (!id) { el.className = 'result'; el.textContent = 'Keine Entität gewählt – die Box erscheint nie.'; return; }
    try {
      const st = await (await fetch('/api/ha/states')).json();
      const e = (st.states || []).find(x => x.entity_id === id);
      if (!e) { el.className = 'result err'; el.textContent = 'Diese Entität meldet Home Assistant gerade nicht.'; return; }
      const zeigt = window.DashboardRender
        ? DashboardRender.ankuendigungsText(e.state)
        : String(e.state || '').trim();
      el.className = 'result ok';
      el.innerHTML = `Steht gerade drin: <code>${(e.state === '' ? '(leer)' : e.state)}</code><br>`
        + (zeigt ? 'Die Box <strong>wird angezeigt</strong>.' : 'Die Box <strong>bleibt weg</strong> – das gilt als leer.');
    } catch (err) {
      el.className = 'result err';
      el.textContent = 'Zustand nicht lesbar: ' + (err.message || err);
    }
  }
  $('notifyEntity').addEventListener('change', notifyVorschau);
  notifyVorschau();

  $('notifyTitel').value = configRes.notifyTitel || '';
  $('notifySekunden').value = configRes.notifySekunden === undefined ? 20 : configRes.notifySekunden;
  $('batteryThreshold').value = configRes.batteryThreshold || 20;
  $('batterySound').checked = configRes.batterySound !== false;
  $('batteryVolume').checked = configRes.batteryVolume !== false;
  $('nightEnabled').checked = !!configRes.nightModeEnabled;
  $('nightStart').value = configRes.nightStart || '23:00';
  $('nightEnd').value = configRes.nightEnd || '06:30';
  $('nightForceOn').checked = !!configRes.nightModeForceOn;

  // Kalendersteuerung
  $('calEnabled').checked = !!configRes.calendarEnabled;
  $('calKeywords').value = configRes.calendarKeywords || '';
  $('calLead').value = configRes.calendarLeadMinutes || 0;
  $('calTrail').value = configRes.calendarTrailMinutes || 0;

  const calSelect = $('calEntity');
  calSelect.innerHTML = '<option value="">– kein Kalender ausgewählt –</option>';
  const calRes = await fetch('/api/entities?domain=calendar').then(r => r.json()).catch(() => ({ ok: false }));
  if (calRes.ok && calRes.entities.length) {
    calRes.entities.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.entity_id;
      opt.textContent = `${e.name} (${e.entity_id})`;
      if (e.entity_id === configRes.calendarEntity) opt.selected = true;
      calSelect.appendChild(opt);
    });
  } else {
    calSelect.innerHTML = '<option value="">– keine Kalender in Home Assistant gefunden –</option>';
  }

  // Auf Ankunft warten
  $('ankunftEnabled').checked = !!configRes.ankunftEnabled;
  $('ankunftEntity').value = configRes.ankunftEntity || '';
  $('ankunftZuhause').value = configRes.ankunftZuhause || 'disarmed, armed_home';
  $('ankunftNachMinuten').value = configRes.ankunftNachMinuten === undefined ? 60 : configRes.ankunftNachMinuten;
  $('abwesendEnabled').checked = !!configRes.abwesendEnabled;
  $('abwesendHelligkeit').value = configRes.abwesendHelligkeit === undefined ? 20 : configRes.abwesendHelligkeit;
  $('abwesendSekunden').value = configRes.abwesendSekunden === undefined ? 20 : configRes.abwesendSekunden;
  ankunftEntitaetenLaden();

  // Ankunftsschirm
  $('abschiedEnabled').checked = !!configRes.abschiedEnabled;
  // Der Testmodus wird ueber eine eigene Route gespeichert und faehrt beim Neustart nicht von
  // allein herunter -- der Schalter muss also zeigen, was wirklich laeuft.
  if ($('abschiedTestmodus')) $('abschiedTestmodus').checked = !!configRes.abschiedTestmodus;
  $('abschiedHeading').value = configRes.abschiedHeading || '';
  $('abschiedText').value = configRes.abschiedText || '';
  $('abschiedAbStunde').value = configRes.abschiedAbStunde === undefined ? 0 : configRes.abschiedAbStunde;
  abschiedDashboardsLaden(configRes.abschiedDashboard || '');

  $('welcomeEnabled').checked = !!configRes.welcomeEnabled;
  $('welcomeHeading').value = configRes.welcomeHeading || '';
  $('welcomeText').value = configRes.welcomeText || '';
  $('welcomeCaption').value = configRes.welcomeCaption || '';
  $('welcomeCaption2').value = configRes.welcomeCaption2 || '';
  $('welcomeImageSeconds').value = configRes.welcomeImageSeconds === undefined ? 8 : configRes.welcomeImageSeconds;
  $('hintergrundBewegung').checked = configRes.hintergrundBewegung !== false;
  $('desktopHintergrund').checked = !!configRes.desktopHintergrund;
  $('rueckkehrSekunden').value = configRes.rueckkehrSekunden === undefined ? 90 : configRes.rueckkehrSekunden;
  $('welcomeTestmodus').checked = !!configRes.welcomeTestmodus;
  $('welcomeTestSekunden').value = configRes.welcomeTestSekunden || 10;
  $('welcomeHours').value = configRes.welcomeHours === undefined ? 5 : configRes.welcomeHours;

  const bildRes = await fetch('/api/entities?domain=image').then(r => r.json()).catch(() => ({ ok: false }));
  const bildListe = (selectId, leerText, gewaehlt) => {
    const sel = $(selectId);
    sel.innerHTML = `<option value="">${leerText}</option>`;
    if (!bildRes.ok || !bildRes.entities.length) {
      sel.innerHTML = '<option value="">– keine Bild-Entitäten in Home Assistant gefunden –</option>';
      return;
    }
    bildRes.entities.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.entity_id;
      opt.textContent = `${e.name} (${e.entity_id})`;
      if (e.entity_id === gewaehlt) opt.selected = true;
      sel.appendChild(opt);
    });
  };
  bildListe('welcomeImageEntity', '– kein Bild –', configRes.welcomeImageEntity);
  bildListe('welcomeImageEntity2', '– keine Entität gewählt –', configRes.welcomeImageEntity2);

  $('welcomeImage2Quelle').value = configRes.welcomeImage2Quelle || '';
  if (configRes.welcomeImage2Version) {
    $('welcomeImage2Preview').src = `/api/photo-card/welcome-2/background?v=${configRes.welcomeImage2Version}`;
    $('welcomeImage2Preview').style.display = 'block';
    $('welcomeImage2Remove').style.display = 'inline-block';
  }
  zweiteBildQuelleAnzeigen();

  $('codeState').textContent = configRes.hasSetupCode
    ? 'Es ist ein Zugangscode gesetzt. Leer lassen, um ihn nicht zu ändern.'
    : 'Es ist noch KEIN Zugangscode gesetzt – diese Seite ist derzeit für jeden im Netzwerk offen.';

  refreshCalStatus();
}

// Zeigt je nach gewaehlter Quelle das Entitaets-Auswahlfeld oder den Hochladen-Bereich.
function zweiteBildQuelleAnzeigen() {
  const q = $('welcomeImage2Quelle').value;
  $('welcomeImage2Entity').style.display = q === 'entity' ? '' : 'none';
  $('welcomeImage2Upload').style.display = q === 'upload' ? '' : 'none';
}

// Verkleinert ein gewaehltes Bild im Browser, bevor es hochgeladen wird -- ein Handyfoto mit
// zwoelf Megapixeln hat auf einem Wandpanel nichts verloren und blaeht die Konfiguration auf.
function bildVerkleinern(datei, maxKante) {
  return new Promise((fertig, fehler) => {
    const leser = new FileReader();
    leser.onerror = () => fehler(new Error('Datei nicht lesbar'));
    leser.onload = () => {
      const bild = new Image();
      bild.onerror = () => fehler(new Error('Kein gültiges Bild'));
      bild.onload = () => {
        const faktor = Math.min(1, maxKante / Math.max(bild.width, bild.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bild.width * faktor);
        c.height = Math.round(bild.height * faktor);
        c.getContext('2d').drawImage(bild, 0, 0, c.width, c.height);
        fertig(c.toDataURL('image/jpeg', 0.85));
      };
      bild.src = leser.result;
    };
    leser.readAsDataURL(datei);
  });
}

function fmt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

const REASON_TEXT = {
  'nicht-konfiguriert': 'Kalendersteuerung ist aus oder unvollständig – der Bildschirm bleibt an.',
  'karenzzeit': 'Karenzzeit nach dem Start – es wird vorerst nicht abgeschaltet.',
  'pause': 'Pausiert – der Bildschirm bleibt an.',
  'nachtsperre': 'Nachtsperre aktiv – der Bildschirm bleibt aus.',
  'anzeigefenster': 'Ein passender Termin läuft – der Bildschirm ist an.',
  'kein-treffer': 'Kein passender Termin – der Bildschirm ist aus.'
};

async function refreshCalStatus() {
  const el = $('calStatus');
  const res = await fetch('/api/calendar/state').then(r => r.json()).catch(() => ({ ok: false }));
  if (!res.ok || !res.state) { el.textContent = 'Status nicht verfügbar.'; return; }
  const s = res.state;
  const lines = [];
  lines.push(`<strong>Bildschirm ist ${s.panelOn ? 'an' : 'aus'}.</strong> ${REASON_TEXT[s.reason] || ''}`);
  if (s.activeWindow) {
    lines.push(`Laufender Treffer: „${s.activeWindow.title}“ bis ${fmt(s.activeWindow.end)}`);
  }
  if (s.nextWindow) {
    lines.push(`Nächster Treffer: „${s.nextWindow.title}“ ab ${fmt(s.nextWindow.start)}`);
  } else if (s.configured) {
    lines.push('Kein weiterer Treffer in den nächsten 30 Tagen.');
  }
  if (s.pausedUntil) lines.push(`Pause läuft bis ${fmt(new Date(s.pausedUntil).toISOString())}.`);
  if (s.error) lines.push(`<span style="color:#f28b82">Home Assistant nicht erreichbar: ${s.error.message}</span>`);
  else if (s.lastPollOk) lines.push(`Zuletzt erfolgreich abgerufen: ${fmt(s.lastPollOk)}`);
  el.innerHTML = lines.join('<br>');
}

$('welcomeImage2Quelle').addEventListener('change', zweiteBildQuelleAnzeigen);
$('welcomeImage2Btn').addEventListener('click', () => $('welcomeImage2File').click());
$('welcomeImage2File').addEventListener('change', async () => {
  const datei = $('welcomeImage2File').files[0];
  const ergebnis = $('welcomeImage2Result');
  if (!datei) return;
  ergebnis.className = 'result';
  ergebnis.textContent = 'Wird hochgeladen …';
  try {
    const dataUrl = await bildVerkleinern(datei, 1600);
    const r = await fetch('/api/photo-card/welcome-2/background', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl })
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Fehler beim Hochladen');
    const v = Date.now();
    $('welcomeImage2Preview').src = `/api/photo-card/welcome-2/background?v=${v}`;
    $('welcomeImage2Preview').style.display = 'block';
    $('welcomeImage2Remove').style.display = 'inline-block';
    ergebnis.className = 'result ok';
    ergebnis.textContent = 'Hochgeladen. Nicht vergessen: unten speichern.';
  } catch (e) {
    ergebnis.className = 'result err';
    ergebnis.textContent = 'Fehler: ' + e.message;
  }
  $('welcomeImage2File').value = '';
});
$('welcomeImage2Remove').addEventListener('click', async () => {
  await fetch('/api/photo-card/welcome-2/background/remove', { method: 'POST' });
  $('welcomeImage2Preview').removeAttribute('src');
  $('welcomeImage2Preview').style.display = 'none';
  $('welcomeImage2Remove').style.display = 'none';
  $('welcomeImage2Result').className = 'result';
  $('welcomeImage2Result').textContent = 'Entfernt.';
});


$('showWelcomeBtn').addEventListener('click', async () => {
  const resultEl = $('showWelcomeResult');
  const r = await fetch('/api/welcome/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const data = await r.json();
  resultEl.textContent = data.ok
    ? `Der Ankunftsschirm erscheint gleich auf dem Display – auch ohne laufenden Termin. `
      + `Er bleibt ${data.minuten || 10} Minuten stehen oder bis jemand ihn wegtippt.`
    : 'Fehler: ' + data.error;
  resultEl.className = data.ok ? 'result ok' : 'result err';
});

$('calPauseBtn').addEventListener('click', async () => {
  await fetch('/api/calendar/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  refreshCalStatus();
});

$('calResumeBtn').addEventListener('click', async () => {
  await fetch('/api/calendar/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  refreshCalStatus();
});

// Vorschau gegen die AKTUELLEN Eingabefelder, nicht gegen das Gespeicherte -- so laesst sich eine
// Keyword-Aenderung pruefen, bevor man sie festschreibt.
$('calPreviewBtn').addEventListener('click', async () => {
  const el = $('calPreview');
  el.className = 'result';
  el.textContent = 'Suche Treffer …';
  const q = new URLSearchParams({
    entity: $('calEntity').value,
    keywords: $('calKeywords').value,
    lead: String(parseInt($('calLead').value, 10) || 0),
    trail: String(parseInt($('calTrail').value, 10) || 0)
  });
  const res = await fetch('/api/calendar/preview?' + q).then(r => r.json()).catch(() => ({ ok: false, error: 'Netzwerkfehler' }));
  if (!res.ok) { el.className = 'result err'; el.textContent = 'Fehler: ' + res.error; return; }
  if (!res.windows.length) { el.className = 'result'; el.textContent = 'Keine Treffer in den nächsten 30 Tagen.'; return; }
  el.className = 'result ok';
  el.innerHTML = res.windows.map(w => `„${w.title}“: ${fmt(w.start)} – ${fmt(w.end)}`).join('<br>');
});

// --- Speichern -------------------------------------------------------------------------------
//
// Vorher hatte jeder der neun Abschnitte einen eigenen Speicherknopf. Wer zwei Bereiche
// anfasste und nur einen Knopf traf, verlor die andere Haelfte -- ohne dass irgendetwas
// darauf hinwies. Jetzt sammelt ein Knopf die ganze Seite ein und schickt sie in EINER
// Anfrage; entweder wird alles gespeichert oder nichts.

function alleFelder() {
  const zahl = (id, ersatz) => {
    const v = parseInt($(id).value, 10);
    return Number.isFinite(v) ? v : ersatz;
  };
  const felder = {
    hintergrundBewegung: $('hintergrundBewegung').checked,
    desktopHintergrund: $('desktopHintergrund').checked,
    rueckkehrSekunden: zahl('rueckkehrSekunden', 90),
    sunEntity: $('sunEntity').value,
    notifyEntity: $('notifyEntity').value,
    notifyTitel: $('notifyTitel').value,
    notifySekunden: zahl('notifySekunden', 20),
    batteryThreshold: zahl('batteryThreshold', 20),
    batterySound: $('batterySound').checked,
    batteryVolume: $('batteryVolume').checked,

    nightModeEnabled: $('nightEnabled').checked,
    nightStart: $('nightStart').value || '23:00',
    nightEnd: $('nightEnd').value || '06:30',
    nightModeForceOn: $('nightForceOn').checked,

    calendarEnabled: $('calEnabled').checked,
    calendarEntity: $('calEntity').value,
    calendarKeywords: $('calKeywords').value,
    calendarLeadMinutes: zahl('calLead', 0),
    calendarTrailMinutes: zahl('calTrail', 0),

    abschiedEnabled: $('abschiedEnabled').checked,
    abschiedHeading: $('abschiedHeading').value,
    abschiedText: $('abschiedText').value,
    abschiedDashboard: $('abschiedDashboard').value,
    abschiedAbStunde: zahl('abschiedAbStunde', 0),
    welcomeEnabled: $('welcomeEnabled').checked,
    welcomeHeading: $('welcomeHeading').value,
    welcomeText: $('welcomeText').value,
    welcomeImageEntity: $('welcomeImageEntity').value,
    welcomeCaption: $('welcomeCaption').value,
    welcomeCaption2: $('welcomeCaption2').value,
    welcomeHours: zahl('welcomeHours', 0),
    welcomeImage2Quelle: $('welcomeImage2Quelle').value,
    welcomeImageEntity2: $('welcomeImage2Quelle').value === 'entity' ? $('welcomeImageEntity2').value : '',
    welcomeImageSeconds: zahl('welcomeImageSeconds', 8),
    welcomeTestmodus: $('welcomeTestmodus').checked,
    welcomeTestSekunden: zahl('welcomeTestSekunden', 10),
    ankunftEnabled: $('ankunftEnabled').checked,
    ankunftEntity: $('ankunftEntity').value.trim(),
    ankunftZuhause: $('ankunftZuhause').value.trim(),
    ankunftNachMinuten: zahl('ankunftNachMinuten', 60),
    abwesendEnabled: $('abwesendEnabled').checked,
    abwesendHelligkeit: zahl('abwesendHelligkeit', 20),
    abwesendSekunden: zahl('abwesendSekunden', 20)
  };

  // Der Zugangscode NUR, wenn wirklich etwas eingegeben wurde. Ein leeres Feld heisst
  // "nicht aendern", nicht "Code loeschen" -- sonst haette jedes Speichern der Seite den
  // Schutz stillschweigend aufgehoben, und niemand haette es gemerkt, bis das Geraet
  // offen im Netz stand.
  const code = $('setupCode').value;
  if (code) felder.setupCode = code;

  return felder;
}

async function speichereAlles() {
  const el = $('saveAllResult');
  const knopf = $('saveAllBtn');
  const hatteCode = !!$('setupCode').value;
  el.className = 'result';
  el.textContent = 'Speichere...';
  knopf.disabled = true;
  try {
    const r = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alleFelder())
    });
    const data = await r.json();
    if (data.ok) {
      el.className = 'result ok';
      el.textContent = hatteCode
        ? 'Gespeichert. Der Zugangscode wurde geändert – alle angemeldeten Geräte müssen ihn neu eingeben.'
        : 'Gespeichert.';
      if (hatteCode) {
        $('setupCode').value = '';
        $('codeState').textContent = 'Es ist ein Zugangscode gesetzt. Leer lassen, um ihn nicht zu ändern.';
      }
      setTimeout(refreshCalStatus, 1200); // dem sofortigen Neuabruf kurz Zeit geben
    } else {
      el.className = 'result err';
      el.textContent = 'Fehler: ' + data.error;
    }
  } catch (e) {
    el.className = 'result err';
    el.textContent = 'Fehler: ' + (e.message || e);
  }
  knopf.disabled = false;
}

$('saveAllBtn').addEventListener('click', speichereAlles);

// Strg+S ist an dieser Stelle keine Spielerei: Die Seite ist lang, der Knopf steht unten,
// und wer oben in der Kalendersteuerung tippt, sieht ihn nicht.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    speichereAlles();
  }
});

load();
// Status live halten, solange die Seite offen ist
setInterval(refreshCalStatus, 10000);

// --- Auf Ankunft warten: Auswahlliste und Zustandsanzeige --------------------------------------
//
// Die Zustandsnamen einer Alarmanlage gehoeren der Anlage, nicht dieser App: armed_home heisst
// nicht ueberall dasselbe, und manche Integrationen melden ganz eigene Namen. Wer sie raten muss,
// traegt frueher oder spaeter einen ein, den es nicht gibt -- und merkt es erst, wenn die Wand
// einen ganzen Termin lang dunkel bleibt. Deshalb steht hier, was die gewaehlte Entitaet GERADE
// meldet, und ob dieser Zustand als "zu Hause" zaehlt.
let ankunftEntitaeten = [];

async function ankunftEntitaetenLaden() {
  const liste = document.getElementById('ankunftListe');
  const res = await fetch('/api/entities?domain=alarm_control_panel').then(r => r.json()).catch(() => ({ ok: false }));
  ankunftEntitaeten = (res.ok && res.entities) ? res.entities : [];
  liste.innerHTML = ankunftEntitaeten
    .map(e => `<option value="${e.entity_id}">${e.name} — ${e.zustand}</option>`).join('');
  ankunftZustandZeigen();
}

function ankunftZustandZeigen() {
  const feld = document.getElementById('ankunftZustandAnzeige');
  const id = document.getElementById('ankunftEntity').value.trim();
  if (!id) {
    feld.textContent = 'Ohne Entität wird nie gewartet – der Bildschirm geht wie bisher zu Terminbeginn an.';
    return;
  }
  const treffer = ankunftEntitaeten.find(e => e.entity_id === id);
  if (!treffer) {
    feld.textContent = 'Diese Entität ist keine Alarmanlage in Home Assistant. Das kann richtig sein '
      + '(z. B. ein Schalter), nur lässt sich ihr Zustand hier nicht anzeigen.';
    return;
  }
  const zuhause = document.getElementById('ankunftZuhause').value.trim() || 'disarmed, armed_home';
  const liste = zuhause.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const passt = liste.includes(String(treffer.zustand).toLowerCase());
  feld.textContent = `Steht gerade auf „${treffer.zustand}“ – das zählt hier als `
    + (passt ? 'ZU HAUSE (Bildschirm ginge an).' : 'abwesend (es würde gewartet).');
}

['ankunftEntity', 'ankunftZuhause'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', ankunftZustandZeigen);
});

// --- Warnton auf der Wand ausprobieren --------------------------------------------------------
//
// Der Ton kommt aus dem Panel, nicht aus diesem Browser. Bleibt es still, gibt es genau drei
// Gruende, und man kann sie von hier aus nicht auseinanderhalten -- deshalb sagt die Antwort,
// welcher es war: Es hoerte keine Anzeige zu, die Tonausgabe ist blockiert (dann steht der
// Tonkontext auf "suspended"), oder alles lief und das Geraet selbst ist stumm.
const tonTestBtn = document.getElementById('tonTestBtn');
if (tonTestBtn) {
  tonTestBtn.addEventListener('click', async () => {
    const ziel = document.getElementById('tonTestResult');
    tonTestBtn.disabled = true;
    ziel.className = 'result';
    ziel.textContent = 'Wird abgespielt \u2026';
    try {
      const start = await fetch('/api/anzeige/ton-test', { method: 'POST' }).then(r => r.json());
      if (!start.anzeigen) {
        ziel.className = 'result err';
        ziel.textContent = 'Keine Anzeige verbunden. L\u00e4uft das Wall Display gerade? '
          + 'Ist das Panel abgeschaltet, h\u00f6rt dort niemand zu \u2013 dann kommt auch kein Ton.';
        return;
      }
      // Kurz warten: Die Anzeige spielt und meldet danach zurueck.
      await new Promise(r => setTimeout(r, 1600));
      const d = await fetch('/api/geraet/ton-ergebnis').then(r => r.json());
      const e = d.ergebnis;
      if (!e || d.alterSekunden > 20) {
        ziel.className = 'result err';
        ziel.textContent = 'Die Anzeige hat nicht geantwortet. M\u00f6glicherweise l\u00e4uft dort noch eine '
          + '\u00e4ltere Version \u2013 dann hilft ein Update.';
      } else if (e.zustand === 'running') {
        ziel.className = 'result ok';
        ziel.textContent = 'Der Ton wurde abgespielt. H\u00f6rst du nichts, ist das Ger\u00e4t selbst stumm '
          + 'geschaltet oder die Lautst\u00e4rke steht auf null \u2013 das l\u00e4sst sich nur am Panel \u00e4ndern.';
      } else if (e.zustand === 'suspended') {
        ziel.className = 'result err';
        ziel.textContent = 'Die Tonausgabe ist blockiert (Tonkontext angehalten). Einmal das Panel '
          + 'ber\u00fchren und es erneut versuchen.';
      } else {
        ziel.className = 'result err';
        ziel.textContent = 'Ton nicht m\u00f6glich: ' + (e.fehler || e.zustand);
      }
    } catch (err) {
      ziel.className = 'result err';
      ziel.textContent = 'Fehler: ' + err.message;
    } finally {
      tonTestBtn.disabled = false;
    }
  });
}

// --- Die Unterdashboards fuer den Abschiedsschirm ----------------------------------------------
//
// Der Schirm zeigt die Karten eines Unterdashboards. Ein zweiter Karten-Editor waere derselbe
// Editor noch einmal -- und der zweite waere der, den niemand pflegt.
async function abschiedDashboardsLaden(gewaehlt) {
  const feld = document.getElementById('abschiedDashboard');
  if (!feld) return;
  let liste = [];
  try {
    const d = await fetch('/api/dashboards').then(r => r.json());
    liste = (d && d.ok && d.dashboards) ? d.dashboards : [];
  } catch (e) { /* dann bleibt nur "keine Karten" */ }
  feld.innerHTML = '<option value="">\u2013 keine Karten \u2013</option>'
    + liste.map(x => '<option value="' + x.id + '">' + x.name + '</option>').join('');
  feld.value = gewaehlt || '';
  if (!liste.length) {
    feld.insertAdjacentHTML('beforeend',
      '<option value="" disabled>\u2013 noch kein Unterdashboard angelegt \u2013</option>');
  }
}

// --- Abschiedsschirm dauerhaft zum Testen ------------------------------------------------------
//
// Eigene Route statt eines Feldes im grossen Speichern-Knopf: Der Schalter soll sofort wirken,
// und /api/config wuerde die ganze Anzeige neu laden -- beim Ausschalten wuerde der Neuaufbau
// gerade das verdecken, was man pruefen will.
const abschiedTestmodus = document.getElementById('abschiedTestmodus');
if (abschiedTestmodus) {
  abschiedTestmodus.addEventListener('change', async () => {
    const ziel = document.getElementById('abschiedTestmodusResult');
    const an = abschiedTestmodus.checked;
    ziel.className = 'result';
    ziel.textContent = 'Wird übernommen …';
    try {
      const d = await fetch('/api/abschied/testmodus', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ an })
      }).then(r => r.json());
      ziel.className = d.ok ? 'result ok' : 'result err';
      ziel.textContent = d.ok
        ? (d.an
          ? 'Der Abschiedsschirm steht jetzt dauerhaft auf dem Display – spätestens nach einer '
            + 'halben Minute. Wegtippen geht nicht; zum Beenden diesen Schalter wieder ausschalten.'
          : 'Testmodus aus. Das Display geht innerhalb einer halben Minute zurück in den Normalbetrieb.')
        : 'Fehler: ' + d.error;
      // Der Schalter zeigt, was der Server wirklich gespeichert hat -- nicht, was angeklickt wurde.
      if (d.ok) abschiedTestmodus.checked = !!d.an;
    } catch (e) {
      ziel.className = 'result err';
      ziel.textContent = 'Fehler: ' + e.message;
      abschiedTestmodus.checked = !an;
    }
  });
}
