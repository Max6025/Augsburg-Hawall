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
  $('systemWachhalten').checked = configRes.systemWachhalten !== false;

  // Der Zugriffsschluessel kommt ausdruecklich NICHT zurueck (siehe /api/config) -- das Feld
  // bleibt leer und heisst "unveraendert". Ohne diesen Hinweis sieht es aus, als waere keiner
  // gesetzt, und beim naechsten Speichern traegt jemand ihn erneut ein.
  $('wartungsmelderUrl').value = configRes.wartungsmelderUrl || '';
  $('wartungsmelderSchluesselStand').textContent = configRes.wartungsmelderSchluesselGesetzt
    ? 'Ein Schlüssel ist gesetzt. Das Feld leer lassen behält ihn.'
    : 'Kein Schlüssel gesetzt. Ohne Schlüssel kann jeder im Netz beim Add-on Wartungen anlegen.';

  // Bildschirmschoner
  $('schonerEnabled').checked = configRes.schonerEnabled !== false;
  $('schonerMinuten').value = configRes.schonerMinuten === undefined ? 3 : configRes.schonerMinuten;
  $('schonerHelligkeit').value = configRes.schonerHelligkeit === undefined ? 40 : configRes.schonerHelligkeit;
  const art = configRes.schonerHintergrund === 'bild' ? 'bild' : 'wolken';
  const radio = document.querySelector(`input[name="schonerHintergrund"][value="${art}"]`);
  if (radio) radio.checked = true;
  schonerBildAnzeigen(configRes.schonerBildVersion || 0);
  hintergrundBereichAnzeigen();
  schonerDashboardsLaden(configRes.schonerDashboard || '');


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


// --- Das eigene Hintergrundbild des Schoners ---------------------------------------------------
//
// Es liegt auf dem GERAET, nicht in Home Assistant -- ueber dieselbe Route wie die Bilder der
// Foto-Karten, unter der Kennung "schoner". Es reist deshalb bei einem Dashboard-Export nicht
// mit; das ist gewollt, ein Export darf nichts enthalten, was nicht mitreist.

function hintergrundBereichAnzeigen() {
  const gewaehlt = document.querySelector('input[name="schonerHintergrund"]:checked');
  const bild = gewaehlt && gewaehlt.value === 'bild';
  $('schonerBildBereich').style.display = bild ? '' : 'none';
}

function schonerBildAnzeigen(version) {
  const bild = $('schonerBildVorschau');
  const weg = $('schonerBildWeg');
  if (version) {
    bild.src = `/api/photo-card/schoner/background?v=${version}`;
    bild.style.display = 'block';
    weg.style.display = 'inline-block';
  } else {
    bild.removeAttribute('src');
    bild.style.display = 'none';
    weg.style.display = 'none';
  }
}

document.querySelectorAll('input[name="schonerHintergrund"]').forEach(el =>
  el.addEventListener('change', hintergrundBereichAnzeigen));

$('schonerBildDatei').addEventListener('change', async () => {
  const datei = $('schonerBildDatei').files[0];
  if (!datei) return;
  const ergebnis = $('saveAllResult');
  ergebnis.className = 'result';
  ergebnis.textContent = 'Bild wird hochgeladen …';
  try {
    // Auf 1920 statt 1600: Dies ist eine vollflaechige Wand, kein Kartenausschnitt.
    const dataUrl = await bildVerkleinern(datei, 1920);
    const r = await fetch('/api/photo-card/schoner/background', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl })
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Fehler beim Hochladen');
    schonerBildAnzeigen(Date.now());
    ergebnis.className = 'result ok';
    ergebnis.textContent = 'Bild hochgeladen. Nicht vergessen: unten speichern, damit es auch benutzt wird.';
  } catch (e) {
    ergebnis.className = 'result err';
    ergebnis.textContent = 'Fehler: ' + e.message;
  }
  $('schonerBildDatei').value = '';
});

$('schonerBildWeg').addEventListener('click', async () => {
  await fetch('/api/photo-card/schoner/background/remove', { method: 'POST' });
  schonerBildAnzeigen(0);
  $('saveAllResult').className = 'result';
  $('saveAllResult').textContent = 'Bild entfernt. Ohne Bild zeigt der Schoner wieder die Farbwolken.';
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
    systemWachhalten: $('systemWachhalten').checked,
    wartungsmelderUrl: $('wartungsmelderUrl').value.trim(),

    schonerEnabled: $('schonerEnabled').checked,
    schonerMinuten: zahl('schonerMinuten', 3),
    schonerHelligkeit: zahl('schonerHelligkeit', 40),
    schonerDashboard: $('schonerDashboard').value,
    schonerHintergrund: (document.querySelector('input[name="schonerHintergrund"]:checked') || {}).value || 'wolken'
  };

  // Dasselbe beim Zugriffsschluessel des Wartungsmelders, aus demselben Grund: Ein leeres Feld
  // heisst "unveraendert". Wuerde es mitgeschickt, loeschte jedes Speichern der Seite den
  // Schluessel -- und aufgefallen waere das erst beim naechsten Update, wenn die Wartung
  // nicht ankommt.
  const wmSchluessel = $('wartungsmelderSchluessel').value;
  if (wmSchluessel) felder.wartungsmelderSchluessel = wmSchluessel;

  return felder;
}

async function speichereAlles() {
  const el = $('saveAllResult');
  const knopf = $('saveAllBtn');
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
      el.textContent = 'Gespeichert.';
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
// und wer oben beim Bildschirmschoner tippt, sieht ihn nicht.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    speichereAlles();
  }
});

load();

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

// --- Die Unterdashboards fuer den Bildschirmschoner --------------------------------------------
//
// Der Schoner zeigt die Karten eines Unterdashboards. Ein zweiter Karten-Editor waere derselbe
// Editor noch einmal -- und der zweite waere der, den niemand pflegt.
async function schonerDashboardsLaden(gewaehlt) {
  const feld = document.getElementById('schonerDashboard');
  if (!feld) return;
  let liste = [];
  try {
    const d = await fetch('/api/dashboards').then(r => r.json());
    liste = (d && d.ok && d.dashboards) ? d.dashboards : [];
  } catch (e) { /* dann bleibt nur "nichts anzeigen" */ }
  feld.innerHTML = '<option value="">\u2013 nichts anzeigen \u2013</option>'
    + liste.map(x => '<option value="' + x.id + '">' + x.name + '</option>').join('');
  feld.value = gewaehlt || '';
  if (!liste.length) {
    feld.insertAdjacentHTML('beforeend',
      '<option value="" disabled>\u2013 noch kein Unterdashboard angelegt \u2013</option>');
  }
}


// --- Den Wartungsmelder ausprobieren ----------------------------------------------------------
//
// Geprueft wird vom PANEL aus, nicht von diesem Browser: Das Panel ist es, das spaeter meldet,
// und es steht woanders im Netz. Eine Pruefung von hier waere gruen, und beim naechsten Update
// kaeme die Wartung trotzdem nicht an.
//
// Das Add-on beantwortet den Selbsttest mit dem, was einzeln funktioniert hat -- Anmeldung,
// Wartungen lesen, Monitore lesen, Statusseiten lesen. "Hat nicht geklappt" laesst niemanden
// wissen, ob die Adresse falsch ist, der Schluessel nicht stimmt oder Uptime Kuma die
// Anmeldung ablehnt.
const wmPruefen = document.getElementById('wartungsmelderPruefen');
if (wmPruefen) {
  wmPruefen.addEventListener('click', async () => {
    const ziel = document.getElementById('wartungsmelderErgebnis');
    ziel.hidden = false;
    ziel.textContent = 'Wird gepr\u00fcft \u2026';
    wmPruefen.disabled = true;
    try {
      // Erst speichern: Wer die Adresse gerade eingetippt hat, will SIE pruefen und nicht die
      // vom letzten Mal. Ohne das prueft der Knopf etwas anderes, als auf dem Schirm steht.
      await speichereAlles();
      const d = await fetch('/api/wartungsmelder/pruefen').then(r => r.json());
      if (!d.ok) {
        ziel.textContent = 'Fehler: ' + (d.error || 'unbekannt');
        return;
      }
      const b = d.bericht || {};
      const zeilen = Object.entries(b.pruefungen || b).map(([k, v]) => `${k}: ${
        v === true ? 'ok' : (typeof v === 'object' ? JSON.stringify(v) : String(v))
      }`);
      ziel.textContent = zeilen.length ? zeilen.join('\n') : JSON.stringify(b, null, 1);
    } catch (e) {
      ziel.textContent = 'Fehler: ' + (e.message || e);
    } finally {
      wmPruefen.disabled = false;
    }
  });
}
