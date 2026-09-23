const $ = id => document.getElementById(id);
let polling = null;

function describe(state) {
  if (state.error) return 'Fehler: ' + state.error;
  if (state.downloaded) return `Update ${state.version} heruntergeladen – wird installiert, die App startet gleich neu.`;
  if (state.checking) return 'Suche nach Updates...';
  if (state.available) return `Update ${state.version} verfügbar – wird heruntergeladen (${state.progress || 0}%).`;
  // "Noch nie nachgesehen" ist NICHT dasselbe wie "nachgesehen, nichts da". Vorher stand hier
  // für beides „Diese Version ist aktuell" – eine Behauptung ohne Grundlage, und zwar in genau
  // dem Zustand, in dem man die Seite normalerweise öffnet: Die App fragt GitHub von sich aus
  // nie, also ist beim Öffnen noch nichts geprüft.
  if (!state.geprueft) return 'Noch nicht nachgesehen – ein Druck fragt GitHub.';
  return 'Kein Update verfügbar. Diese Version ist aktuell.';
}

async function refresh() {
  const r = await fetch('/api/update/status');
  const data = await r.json();
  if (!data.ok) {
    $('statusText').textContent = 'Fehler: ' + data.error;
    return;
  }
  $('currentVersion').textContent = data.currentVersion;
  $('statusText').textContent = describe(data);
  $('installBtn').style.display = data.downloaded ? 'inline-block' : 'none';
  if (data.available && !data.downloaded) {
    $('progressWrap').style.display = 'block';
    $('progressBar').style.width = (data.progress || 0) + '%';
  } else {
    $('progressWrap').style.display = 'none';
  }
  if ((data.checking || (data.available && !data.downloaded)) && !polling) {
    polling = setInterval(refresh, 2000);
  }
  if (!data.checking && (data.downloaded || (!data.available && !data.checking)) && polling) {
    clearInterval(polling);
    polling = null;
  }
}

// Ein Druck: suchen, laden, installieren. GitHub wird ausschliesslich hier gefragt -- die App
// pruft weder beim Start noch in einem Intervall von sich aus.
$('checkBtn').addEventListener('click', async () => {
  $('statusText').textContent = 'Suche nach Updates...';
  await fetch('/api/update/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoInstall: true })
  });
  if (!polling) polling = setInterval(refresh, 2000);
  refresh();
});

$('installBtn').addEventListener('click', async () => {
  $('statusText').textContent = 'Installiere automatisch im Hintergrund (kein Assistent, keine Admin-Abfrage) – auf dem Wall Display erscheint "Update wird installiert". Diese Seite wird kurz nicht erreichbar sein, während die App neu startet.';
  $('installBtn').disabled = true;
  $('installOverlay').classList.add('show');
  await fetch('/api/update/install', { method: 'POST' });
  waitForRestartThenReload();
});

// Wartet, bis der Server einmal wirklich weg war (alter Prozess beendet sich) und danach
// wieder antwortet (neuer Prozess laeuft) -- erst dann automatisch neu laden. Verhindert ein
// verfruehtes Neuladen, falls der alte Server kurz noch reagiert.
function waitForRestartThenReload() {
  let sawDown = false;
  const interval = setInterval(async () => {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (r.ok && sawDown) {
        clearInterval(interval);
        $('installOverlayText').textContent = 'Update fertig – Seite wird neu geladen...';
        setTimeout(() => location.reload(), 600);
      }
    } catch (e) {
      sawDown = true;
      $('installOverlayText').textContent = 'App startet neu...';
    }
  }, 1200);
}

refresh();
