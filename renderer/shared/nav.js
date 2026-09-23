// Die Navigationsleiste der Einrichtungsoberflaeche.
//
// Sie steht als Markup in jeder Seite -- der Akkustand aber wird hier erzeugt und nicht in
// zehn Dateien einzeln eingebaut. Eine Anzeige, die man an zehn Stellen pflegen muss, ist an
// neun davon irgendwann veraltet.

(function () {
  const current = location.pathname.split('/').pop() || 'index.html';

  // --- Die Reihenfolge der Reiter -----------------------------------------------------------
  //
  // Sie steht HIER und nicht in acht HTML-Dateien. Vorher stand sie in jeder Seite als Markup,
  // und das Ergebnis war absehbar: Zwei Seiten kannten den Design-Import nicht, eine die
  // Unterdashboards nicht, und der Status-Reiter waere in der neunten Seite vergessen worden.
  // Eine Reihenfolge, die man an acht Stellen pflegen muss, stimmt an sieben davon irgendwann
  // nicht mehr.
  //
  // Die Gruppierung ist Absicht: vorne das Einrichten (Verbindung, Karten, Design, Dashboards),
  // hinten der Betrieb (Update, Einstellungen, Status, Live-Ansicht). Was man einmal macht,
  // steht vorne; was man immer wieder aufmacht, hinten -- dort ist der Weg mit dem Daumen kurz.
  //
  // Das Markup in den Seiten bleibt als Rückfall, falls dieses Skript nicht lädt: Eine Leiste
  // in falscher Reihenfolge ist immer noch eine Leiste, eine leere ist eine Sackgasse.
  const SEITEN = [
    ['index.html', 'Verbindung', ''],
    ['editor.html', 'Karten', ''],
    ['design-import.html', 'Design-Import', ''],
    ['dashboards.html', 'Unterdashboards', ''],
    ['update.html', 'Update', ''],
    ['theme.html', 'Einstellungen', ''],
    ['status.html', 'Status', 'Läuft alles? Bildschirm, Verbindung, Schlaf-Fristen, Akku, Protokoll'],
    ['/live', 'Live-Ansicht', 'Dieselbe Anzeige wie auf der Wand – hier bedienbar']
  ];

  const reiter = document.querySelector('.hawall-nav-links');
  if (reiter) {
    // Vorhandene Anker werden WIEDERVERWENDET, nicht neu gebaut: So bleibt erhalten, was eine
    // Seite an ihrem Link besonders gesetzt hat.
    const da = new Map();
    reiter.querySelectorAll('a').forEach(a => da.set(a.getAttribute('href'), a));

    const fragment = document.createDocumentFragment();
    for (const [href, text, titel] of SEITEN) {
      const a = da.get(href) || document.createElement('a');
      da.delete(href);
      a.href = href;
      a.textContent = text;
      if (titel) a.title = titel;
      a.classList.toggle('active', href === '/live' ? location.pathname === '/live' : href === current);
      fragment.appendChild(a);
    }
    // Was die Seite sonst noch in der Leiste hatte, bleibt -- hinten, damit die feste
    // Reihenfolge davon unberührt ist.
    da.forEach(a => fragment.appendChild(a));

    reiter.textContent = '';
    reiter.appendChild(fragment);
  }

  // --- Akkustand des Panels ---------------------------------------------------------------
  //
  // Diese Seite laeuft auf einem anderen Geraet als das Panel: navigator.getBattery() wuerde
  // hier den Akku des Notebooks zeigen, auf dem gerade eingerichtet wird -- also genau das
  // Falsche. Der Wert kommt deshalb vom Server, gemeldet von der Anzeige selbst.
  const leiste = document.querySelector('.hawall-nav');
  if (!leiste) return;

  const feld = document.createElement('div');
  feld.className = 'hawall-nav-akku';
  feld.hidden = true;
  leiste.appendChild(feld);

  // Aelter als das: Die Anzeige laeuft offenbar nicht mehr (Panel aus, App beendet, Netz weg).
  // Dann lieber "unbekannt" sagen als einen Stand von vorgestern zeigen.
  const ZU_ALT_SEKUNDEN = 15 * 60;

  function glyph(prozent, laedt) {
    const breite = Math.max(1, Math.round(13 * Math.min(100, Math.max(0, prozent)) / 100));
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">'
      + '<rect x="2.5" y="7.5" width="16" height="9" rx="2"/><path d="M21 10.5v3"/>'
      + '<rect x="4" y="9" width="' + breite + '" height="6" rx="1" fill="currentColor" stroke="none"/>'
      + (laedt ? '<path d="M11 8.5 8.5 12.5h3L10.5 15.5l4-4.5h-3L13 8.5z" fill="#0a0a0b" stroke="none"/>' : '')
      + '</svg>';
  }

  function zeigen(d) {
    if (!d || !d.akku || (d.alterSekunden !== undefined && d.alterSekunden > ZU_ALT_SEKUNDEN)) {
      feld.hidden = true;
      return;
    }
    const { prozent, laedt } = d.akku;
    feld.innerHTML = glyph(prozent, laedt)
      + '<span>' + prozent + '\u202f%</span>'
      + '<em>' + (laedt ? 'lädt' : 'Akku') + '</em>';
    feld.classList.toggle('laedt', laedt);
    feld.classList.toggle('schwach', !laedt && prozent <= 20);
    feld.title = 'Akku des Panels: ' + prozent + ' % – ' + (laedt ? 'wird geladen' : 'nicht am Netzteil');
    feld.hidden = false;
  }

  async function holen() {
    try {
      zeigen(await fetch('/api/geraet/akku').then(r => r.json()));
    } catch (e) { /* Server nicht erreichbar -- die letzte Anzeige stehen lassen */ }
  }

  // Sofort statt beim naechsten Abruf: Wer das Netzteil ansteckt, soll das hier sehen, ohne
  // die Seite neu zu laden.
  //
  // Der Abruf bleibt als Netz daneben stehen -- seltener als vorher, weil er jetzt nur noch
  // den Fall abdeckt, dass der Ereignisstrom gar nicht zustande kommt. Ein verpasstes Ereignis
  // holt niemand nach; ein verpasster Abruf schon.
  try {
    const strom = new EventSource('/api/geraet/akku/live');
    strom.onmessage = (e) => {
      try { zeigen(JSON.parse(e.data)); } catch (err) { /* unlesbar -- naechstes Mal */ }
    };
  } catch (e) { /* ohne EventSource bleibt es beim Abruf */ }

  holen();
  setInterval(holen, 60000);
})();
