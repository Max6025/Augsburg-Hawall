// Die Navigationsleiste der Einrichtungsoberflaeche.
//
// Sie steht als Markup in jeder Seite -- der Akkustand aber wird hier erzeugt und nicht in
// zehn Dateien einzeln eingebaut. Eine Anzeige, die man an zehn Stellen pflegen muss, ist an
// neun davon irgendwann veraltet.

(function () {
  const current = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.hawall-nav-links a').forEach(a => {
    if (a.getAttribute('href') === current) a.classList.add('active');
  });

  // --- Der Weg zur Live-Ansicht -------------------------------------------------------------
  //
  // Sie steht hier und nicht als Markup in zehn Seiten: Eine Verknuepfung, die man an zehn
  // Stellen pflegen muss, fehlt an neun davon irgendwann.
  const links = document.querySelector('.hawall-nav-links');
  if (links && !links.querySelector('[href="/live"]')) {
    const a = document.createElement('a');
    a.href = '/live';
    a.textContent = 'Live-Ansicht';
    a.title = 'Dieselbe Anzeige wie auf der Wand – hier bedienbar';
    links.appendChild(a);
    if (location.pathname === '/live') a.classList.add('active');
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
