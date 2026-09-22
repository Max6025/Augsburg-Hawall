// Stellt die Einrichtungsoberflaeche mit erfundenen Daten bereit.
//
// Anlass: Der Karten-Editor wurde zweimal hintereinander kaputt ausgeliefert, weil er sich
// ohne laufende Home-Assistant-Verbindung nicht ansehen liess -- und blind geaendert wurde.
// Dieser Server beantwortet genau die Aufrufe, die der Editor beim Laden macht, mit
// Beispieldaten. Damit laesst sich das Layout im Browser pruefen.
//
// Start:  node .scratch/karten-design/editor-probe.js
// Dann:   http://localhost:9930/setup/editor.html

const http = require('http');
const fs = require('fs');
const path = require('path');

const WURZEL = path.resolve(__dirname, '..', '..');
const TYP = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

const ZUSTAENDE = [
  ['input_button.alle_tore', 'Tor Normal', 'off'],
  ['input_boolean.tor_dauerhaft_offen', 'Tor Dauerhaft', 'off'],
  ['climate.klima', 'Klimaanlage', 'off', { hvac_modes: ['off', 'heat', 'cool'], current_temperature: 22 }],
  ['sensor.aussen', 'Außentemperatur', '21.4', { unit_of_measurement: '°C' }],
  ['light.wohnzimmer', 'Wohnzimmer', 'on', { brightness: 180 }],
  // Zweite Klimaanlage und zweiter Sensor, damit sich der Entitaetstausch pruefen laesst:
  // mit nur einem Kandidaten je Art gibt es nichts zu tauschen.
  ['climate.schlafzimmer', 'Klima Schlafzimmer', 'heat', { hvac_modes: ['off', 'heat'], current_temperature: 19 }],
  ['sensor.keller', 'Kellertemperatur', '7.2', { unit_of_measurement: '°C' }],
  // Fuer die Sonneneinstrahlungs-Karte und die Sensorfarben
  ['sensor.solar', 'Ecowitt Sensor 11DC2 Solar Radiation', '412', { unit_of_measurement: 'W/m²', device_class: 'irradiance' }],
  ['sensor.text1', 'Betriebsart', 'Automatik', { icon: 'mdi:robot' }],
  ['sensor.text2', 'Letzter Abruf', 'vor 3 min', { icon: 'mdi:cloud-download' }],
  ['sensor.text3', 'Zustand', 'bereit', {}]
];

const LAYOUT = [
  { entity_id: 'input_button.alle_tore', card_type: 'gate', x: 0, y: 0, cols: 2, rows: 2,
    settings: { name: 'Tor Normal', gateButtons: [{ label: 'Tor öffnen', entity: 'input_button.alle_tore' }] } },
  { entity_id: 'input_boolean.tor_dauerhaft_offen', card_type: 'gate', x: 2, y: 0, cols: 2, rows: 2,
    settings: { name: 'Tor Dauerhaft', gateButtons: [{ label: 'Tor Dauerhaft', entity: 'input_boolean.tor_dauerhaft_offen' }] } },
  { entity_id: 'climate.klima', card_type: 'climate', x: 3, y: 2, cols: 1, rows: 2, settings: {} },
  { entity_id: 'clock:probe', card_type: 'clock', unterleiste: true, settings: {} }
];

const ANTWORTEN = {
  '/api/config': {
    ok: true, haUrl: 'http://ha.invalid', title: 'Wall Display', hasSetupCode: false,
    layout: LAYOUT,
    panelGroesse: { breite: 1280, hoehe: 854, fenster: { breite: 1280, hoehe: 854 }, skalierung: 1.5, drehung: 0 },
    entities: ZUSTAENDE.map(z => z[0]),
    // Damit sich auch die Einstellungsseite (/setup/theme.html) ansehen laesst
    ankunftEnabled: true,
    ankunftZuhause: 'disarmed, armed_home',
    ankunftNachMinuten: 60
  },
  '/api/ha/states': {
    ok: true,
    states: ZUSTAENDE.map(([id, name, state, attrs]) => ({
      entity_id: id, state, attributes: Object.assign({ friendly_name: name }, attrs || {})
    }))
  },
  // Der Editor holt die Entitaetsliste hierher. Ohne sie ist allEntities undefined und jede
  // Karten-Einstellung mit Auswahlliste wirft -- das sah beim ersten Anlauf wie ein Fehler
  // der App aus und war einer der Probe.
  '/api/entities': {
    ok: true,
    entities: ZUSTAENDE.map(([id, name, state]) => ({
      entity_id: id, name, domain: id.split('.')[0], zustand: state
    }))
  },
  // Der Akkustand des Panels fuer die Navigationsleiste. Ohne diesen Eintrag antwortet die
  // Probe nur mit {ok:true}, die Leiste blendet sich aus -- und man haelt es fuer einen Fehler.
  '/api/geraet/akku': { ok: true, akku: { prozent: 14, laedt: false }, alterSekunden: 12 },
  // Die kurzen Namen aus der Entitaetsregistrierung. Ohne sie faellt der Editor auf
  // friendly_name zurueck -- pruefbar ist der Unterschied nur mit Beispieldaten.
  '/api/ha/namen': { ok: true, namen: {
    'sensor.aussen': 'Außentemperatur',
    'sensor.solar': 'Solar Radiation',
    'sensor.keller': 'Kellertemperatur'
  } },
  '/api/dashboards': { ok: true, dashboards: [] },
  '/api/dashboard-format': { ok: true, anleitung: { kartenarten: [] } }
};

http.createServer((q, s) => {
  const pfad = decodeURIComponent(q.url.split('?')[0]);

  if (ANTWORTEN[pfad]) {
    s.writeHead(200, { 'Content-Type': 'application/json' });
    return s.end(JSON.stringify(ANTWORTEN[pfad]));
  }
  if (pfad.startsWith('/api/')) {   // alles Uebrige bejahen, damit nichts haengt
    s.writeHead(200, { 'Content-Type': 'application/json' });
    return s.end('{"ok":true}');
  }

  // /setup/... und /shared/... auf die echten Dateien abbilden
  let datei;
  if (pfad.startsWith('/shared/')) datei = path.join(WURZEL, 'renderer', pfad);
  else if (pfad.startsWith('/setup/')) datei = path.join(WURZEL, 'renderer', pfad);
  else datei = path.join(WURZEL, 'renderer', 'setup', pfad);

  fs.readFile(datei, (e, d) => {
    if (e) { s.writeHead(404); return s.end('nicht gefunden: ' + pfad); }
    s.writeHead(200, { 'Content-Type': TYP[path.extname(datei)] || 'application/octet-stream' });
    s.end(d);
  });
}).listen(9930, () => console.log('Editor-Probe: http://localhost:9930/setup/editor.html'));
