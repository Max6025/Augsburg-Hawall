// Die Statusseite zeigt an, sie bewertet nicht.
//
// Das Urteil fällt in server/systemstatus.js. Hier steht bewusst kein einziger Schwellwert und
// kein „wenn kleiner als" -- sonst gäbe es zwei Stellen, die dasselbe entscheiden, und die
// laufen spätestens beim nächsten Sonderfall auseinander. Dieselbe Regel wie beim Dashboard,
// das den Steuerungszustand nur anzeigt (siehe renderer/dashboard.html).

const $ = id => document.getElementById(id);

const ZEICHEN = { ok: '✓', hinweis: '!', fehler: '✕', unbekannt: '?' };
const URTEIL = {
  ok: ['Alles in Ordnung', 'Jede Prüfung ist durchgelaufen.'],
  hinweis: ['Läuft, mit Hinweisen', 'Nichts ist kaputt – aber unten steht, was auffällt.'],
  fehler: ['Da geht etwas nicht', 'Die rot markierte Zeile zuerst ansehen.'],
  unbekannt: ['Teilweise nicht zu ermitteln', 'Einige Werte sind von hier aus nicht zu sehen.']
};

// Aus Text wird hier nie HTML gebaut, auch nicht aus den eigenen Protokollzeilen: Dort steht
// unter anderem, was Windows gemeldet hat, und das ist Fremdtext.
function textZeile(el, klasse, inhalt) {
  const d = document.createElement('div');
  d.className = klasse;
  d.textContent = inhalt;
  el.appendChild(d);
  return d;
}

function zeileBauen(e) {
  const zeile = document.createElement('div');
  zeile.className = 'zeile';

  const punkt = document.createElement('div');
  punkt.className = 'punkt ' + e.stufe;
  punkt.title = e.stufe;
  zeile.appendChild(punkt);

  const text = document.createElement('div');
  text.className = 'zeile-text';
  const kopf = document.createElement('div');
  kopf.className = 'zeile-kopf';
  textZeile(kopf, 'zeile-titel', e.titel);
  textZeile(kopf, 'zeile-wert', e.wert);
  text.appendChild(kopf);
  if (e.erklaerung) textZeile(text, 'zeile-erkl', e.erklaerung);
  zeile.appendChild(text);
  return zeile;
}

function warnungenZeigen(zeilen) {
  const pre = $('warnungen');
  pre.textContent = '';
  if (!zeilen || !zeilen.length) { $('warnKarte').hidden = true; return; }
  $('warnKarte').hidden = false;
  for (const z of zeilen) {
    const span = document.createElement('span');
    span.className = /\[error\]/.test(z) ? 'err' : 'warn';
    span.textContent = z + '\n';
    pre.appendChild(span);
  }
}

function netzZeigen(d) {
  const el = $('netz');
  el.textContent = '';
  const eintraege = [];
  for (const ip of d.ips || []) {
    eintraege.push({ stufe: 'ok', titel: 'Diese Seite', wert: `http://${ip}:${d.port}/setup/status.html`,
      erklaerung: '' });
  }
  if (d.panelGroesse) {
    const g = d.panelGroesse;
    const f = g.fenster;
    // Weicht das Fenster von der Bildschirmgroesse ab, sieht man auf dem Panel einen schwarzen
    // Rand -- und kein CSS der Seite kann das erklaeren. Deshalb steht es hier.
    const passt = !f || (f.breite === g.breite && f.hoehe === g.hoehe);
    eintraege.push({
      stufe: passt ? 'ok' : 'hinweis',
      titel: 'Panelgröße',
      wert: `${g.breite} × ${g.hoehe}${g.skalierung && g.skalierung !== 1 ? ` (Skalierung ${g.skalierung})` : ''}`,
      erklaerung: passt ? '' : `Das Fenster ist ${f.breite} × ${f.hoehe} – auf dem Panel bleibt ein Rand.`
    });
  }
  eintraege.forEach(e => el.appendChild(zeileBauen(e)));
}

let laeuft = false;

async function laden() {
  if (laeuft) return;
  laeuft = true;
  $('neuBtn').disabled = true;
  try {
    const d = await fetch('/api/status/system').then(r => r.json());
    if (!d.ok) throw new Error(d.error || 'Status nicht verfügbar');

    const stufe = d.stufe || 'unbekannt';
    const [titel, unter] = URTEIL[stufe] || URTEIL.unbekannt;
    $('urteil').className = 'urteil ' + stufe;
    $('urteilZeichen').textContent = ZEICHEN[stufe] || '?';
    $('urteilText').textContent = titel;
    const zahl = (s) => (d.pruefungen || []).filter(e => e.stufe === s).length;
    const teile = [];
    if (zahl('fehler')) teile.push(zahl('fehler') + '× Fehler');
    if (zahl('hinweis')) teile.push(zahl('hinweis') + '× Hinweis');
    $('urteilUnter').textContent = teile.length ? teile.join(', ') + ' – ' + unter : unter;

    const liste = $('liste');
    liste.textContent = '';
    (d.pruefungen || []).forEach(e => liste.appendChild(zeileBauen(e)));

    warnungenZeigen(d.warnungen);
    netzZeigen(d);
    $('stand').textContent = 'Stand: ' + new Date().toLocaleTimeString('de-DE');
  } catch (e) {
    $('urteil').className = 'urteil fehler';
    $('urteilZeichen').textContent = '✕';
    $('urteilText').textContent = 'Status nicht abrufbar';
    $('urteilUnter').textContent = String(e.message || e);
  } finally {
    laeuft = false;
    $('neuBtn').disabled = false;
  }
}

$('neuBtn').addEventListener('click', laden);

// --- Eingreifen ------------------------------------------------------------------------------
//
// Die Knoepfe standen bis 1.0.11 unter "Einstellungen". Dort waren sie falsch: Eine Einstellung
// gilt bis auf Widerruf, das hier sind Handlungen fuer genau jetzt. Und wer nachsieht, ob alles
// laeuft, ist auch derjenige, der eingreifen will -- beides auf einer Seite erspart den Wechsel.
async function handeln(pfad, meldung) {
  const el = $('aktionErgebnis');
  el.className = 'result';
  el.textContent = 'Wird ausgeführt …';
  try {
    const r = await fetch(pfad, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    }).then(a => a.json());
    if (!r.ok) throw new Error(r.error || 'abgelehnt');
    el.className = 'result ok';
    el.textContent = meldung;
  } catch (e) {
    el.className = 'result err';
    el.textContent = 'Fehler: ' + (e.message || e);
  }
  // Sofort neu laden, nicht auf den 15-Sekunden-Takt warten: Wer drückt, will das Ergebnis sehen.
  laden();
}

$('panelPauseBtn').addEventListener('click', () =>
  handeln('/api/panel/pause', 'Pausiert – der Bildschirm bleibt 30 Minuten an.'));
$('panelResumeBtn').addEventListener('click', () =>
  handeln('/api/panel/resume', 'Pause beendet.'));
$('panelWartungBtn').addEventListener('click', () =>
  handeln('/api/panel/wartung', 'Taskleiste ist 5 Minuten sichtbar, der Bildschirm pausiert.'));
$('panelTaskleisteAusBtn').addEventListener('click', () =>
  handeln('/api/panel/taskleiste-aus', 'Taskleiste wieder ausgeblendet.'));

// Alle 15 Sekunden von selbst. Kurz genug, dass man beim Zusehen die Änderung mitbekommt (etwa
// wenn die Nachtsperre greift), und lang genug, dass es das Gerät nicht beschäftigt -- der
// Wächter selbst taktet alle fünf Sekunden.
setInterval(laden, 15000);
laden();
