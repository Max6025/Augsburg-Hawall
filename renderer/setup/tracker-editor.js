const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DASHBOARD_ID = params.get('dashboard');
let iconDataUrl = null;

if (!DASHBOARD_ID) {
  document.querySelector('.wizard').innerHTML = '<p class="result err">Kein Dashboard angegeben.</p>';
} else {
  init();
}

async function init() {
  const [dashRes, entRes] = await Promise.all([
    fetch(`/api/dashboards/${DASHBOARD_ID}`).then(r => r.json()),
    fetch('/api/entities').then(r => r.json())
  ]);
  if (!dashRes.ok) {
    document.querySelector('.wizard').innerHTML = '<p class="result err">Dashboard nicht gefunden.</p>';
    return;
  }
  const dash = dashRes.dashboard;
  $('pageTitle').textContent = `Tracker einrichten – ${dash.name}`;
  $('trackerEntity').value = dash.trackerEntity || '';
  $('defaultZoom').value = dash.trackerDefaultZoom || 16;
  $('autoCenter').checked = dash.trackerAutoCenter !== false;
  $('showZones').checked = !!dash.trackerShowZones;
  iconDataUrl = dash.trackerIconDataUrl || null;
  updateIconPreview();

  const trackers = (entRes.ok ? entRes.entities : []).filter(e => e.domain === 'device_tracker' || e.domain === 'person');
  $('trackerEntityList').innerHTML = trackers.map(e => `<option value="${e.entity_id}">${e.name}</option>`).join('');

  $('iconUploadBtn').addEventListener('click', () => $('iconFileInput').click());
  $('iconFileInput').addEventListener('change', async () => {
    const file = $('iconFileInput').files[0];
    if (!file) return;
    try {
      iconDataUrl = istSvg(file) ? await svgLesen(file) : await resizeImageFile(file, 120);
      iconMeldung('');
    } catch (e) {
      iconMeldung(String(e.message || e));
    }
    updateIconPreview();
    $('iconFileInput').value = '';
  });
  $('iconRemoveBtn').addEventListener('click', () => {
    iconDataUrl = null;
    updateIconPreview();
  });

  $('saveBtn').addEventListener('click', async () => {
    const trackerEntity = $('trackerEntity').value.trim();
    const r = await fetch(`/api/dashboards/${DASHBOARD_ID}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackerEntity,
        trackerIconDataUrl: iconDataUrl,
        trackerDefaultZoom: parseInt($('defaultZoom').value, 10) || 16,
        trackerAutoCenter: $('autoCenter').checked,
        trackerShowZones: $('showZones').checked
      })
    });
    const data = await r.json();
    if (data.ok) {
      $('result').textContent = 'Gespeichert – wird beim nächsten Aufruf des Unterdashboards auf dem Wall Display sichtbar.';
      $('result').className = 'result ok';
    } else {
      $('result').textContent = 'Fehler: ' + data.error;
      $('result').className = 'result err';
    }
  });
}

function updateIconPreview() {
  if (iconDataUrl) {
    // `contain` statt `cover`: Eine SVG ist meist nicht quadratisch, und `cover` schneidet
    // dann genau das weg, was man sehen will.
    $('iconPreview').style.objectFit = iconDataUrl.startsWith('data:image/svg') ? 'contain' : 'cover';
    $('iconPreview').src = iconDataUrl;
    $('iconPreview').style.display = 'inline-block';
    $('iconNoneText').style.display = 'none';
    $('iconRemoveBtn').style.display = 'inline-block';
  } else {
    $('iconPreview').style.display = 'none';
    $('iconNoneText').style.display = 'inline';
    $('iconRemoveBtn').style.display = 'none';
  }
}

function iconMeldung(text) {
  const el = $('iconInfo');
  if (el) el.textContent = text;
}

function istSvg(file) {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');
}

// Groesser gehoert so ein Symbol nicht in die Konfiguration: Es liegt als Data-URL in
// config.json, und die wird bei jedem Start gelesen.
const SVG_MAX = 64 * 1024;

/**
 * Eine SVG SO speichern, wie sie ist -- ohne Canvas.
 *
 * Das ist der ganze Punkt: `resizeImageFile()` zeichnet auf ein Canvas und gibt ein PNG
 * zurueck. Damit waere eine SVG rasterisiert, und zwar auf 120 Pixel -- genau der Vorteil,
 * wegen dem man eine SVG nimmt, waere weg. Beim Hineinzoomen auf der Landkarte sieht man den
 * Unterschied sofort.
 *
 * Ein zweiter Grund: Eine SVG ohne `width`/`height` rendert auf einem Canvas in manchen
 * Browsern als 0x0, und dann kommt ein LEERES Bild heraus -- ohne Fehlermeldung.
 *
 * Gefahrlos ist das, weil Leaflet daraus ein `<img>` macht und die Vorschau hier auch: In
 * einem `<img>` fuehrt ein Browser keine Skripte aus einer SVG aus. Eingebettet als
 * `innerHTML` waere es etwas anderes -- deshalb darf diese Data-URL nirgends dorthin.
 */
function svgLesen(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Datei nicht lesbar'));
    reader.onload = () => {
      const text = String(reader.result || '');
      if (!/<svg[\s>]/i.test(text)) {
        return reject(new Error('Das sieht nicht nach einer SVG aus – kein <svg>-Element gefunden.'));
      }
      // Ohne viewBox UND ohne Groessenangabe hat eine SVG kein Seitenverhaeltnis. Im Marker
      // steht sie dann verzerrt oder gar nicht -- und man sucht den Fehler an der Landkarte.
      if (!/viewBox=/i.test(text) && !/<svg[^>]*\swidth=/i.test(text)) {
        return reject(new Error('Diese SVG hat weder viewBox noch width – so lässt sie sich nicht '
          + 'zuverlässig skalieren. Bitte eine mit viewBox exportieren.'));
      }
      const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
      if (url.length > SVG_MAX) {
        return reject(new Error(`Die SVG ist ${Math.round(url.length / 1024)} kB groß – `
          + `mehr als ${SVG_MAX / 1024} kB gehören nicht in die Konfiguration. `
          + 'Meist hilft "Als einfache SVG exportieren" oder das Entfernen eingebetteter Bilder.'));
      }
      iconMeldung(`SVG übernommen, ${Math.round(url.length / 1024)} kB – unverändert gespeichert.`);
      resolve(url);
    };
    // Als TEXT, nicht als Data-URL: Nur so lassen sich viewBox und Groesse pruefen, bevor die
    // Datei in der Konfiguration landet.
    reader.readAsText(file);
  });
}

// Verkleinert ein Bild vor dem Speichern auf max. maxDim Pixel (laengste Seite), komprimiert
// als JPEG -- gleiche Logik wie an anderen Upload-Stellen im Projekt.
function resizeImageFile(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
