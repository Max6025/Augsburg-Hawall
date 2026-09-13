// Tests fuer die Flügeltor-Karte.
//
// Was hier schiefgeht, sieht man nicht an einem falschen Pixel, sondern an einer Karte, die
// "Geschlossen" behauptet, waehrend das Tor offen steht -- und danach faehrt jemand dagegen.

const test = require('node:test');
const assert = require('node:assert');
const R = require('../renderer/shared/dashboard-render.js');

test('Die vier Zustaende eines Tores stehen in Worten da', () => {
  // Ein Rollladen wird in Prozent gemessen, ein Tor nicht: Es ist zu, es geht auf, es ist auf,
  // es geht zu.
  assert.strictEqual(R.torDarstellung('closed').text, 'Geschlossen');
  assert.strictEqual(R.torDarstellung('open').text, 'Offen');
  assert.match(R.torDarstellung('opening').text, /Öffnet/);
  assert.match(R.torDarstellung('closing').text, /Schließt/);
});

test('Jeder Zustand hat seine eigene Klasse', () => {
  // Die Stellung der Fluegel sagt dasselbe wie das Wort, nur aus fuenf Metern lesbar. Zwei
  // Zustaende mit derselben Klasse saehen identisch aus.
  const klassen = ['closed', 'open', 'opening', 'closing'].map(z => R.torDarstellung(z).klasse);
  assert.strictEqual(new Set(klassen).size, 4, JSON.stringify(klassen));
});

test('Unbekannt wird NICHT als geschlossen gelesen', () => {
  // Der teuerste Fehler dieser Karte: Ein Tor, das offen steht, waehrend die Karte
  // "Geschlossen" behauptet, ist schlimmer als eine Karte, die zugibt, dass sie es nicht weiss.
  ['unavailable', 'unknown', '', null, undefined, 'irgendwas'].forEach(z => {
    const d = R.torDarstellung(z);
    assert.strictEqual(d.text, 'Unbekannt', JSON.stringify(z));
    assert.strictEqual(d.klasse, 'tor-unbekannt', JSON.stringify(z));
  });
});

test('Nur die Bewegung und "offen" bekommen eine Farbe', () => {
  // Geschlossen ist der Normalfall und braucht keine. Farbe ist Akzent, nicht Dekoration.
  assert.strictEqual(R.torDarstellung('closed').akzent, null);
  assert.ok(R.torDarstellung('open').akzent);
  assert.strictEqual(R.torDarstellung('opening').akzent, R.torDarstellung('closing').akzent);
});

test('Gross- und Kleinschreibung spielt keine Rolle', () => {
  assert.strictEqual(R.torDarstellung('OPEN').text, 'Offen');
});

// --- Kartenwahl -----------------------------------------------------------------------------

test('Ein Cover mit device_class "gate" bekommt die Torkarte vorgeschlagen', () => {
  // Home Assistant sagt selbst, dass es ein Tor ist. Wer ein Tor auf die Wand legt, will
  // sehen, ob es offen ist, nicht auf wie viel Prozent es steht.
  const tor = { state: 'closed', attributes: { device_class: 'gate' } };
  assert.strictEqual(R.defaultCardType('cover.einfahrt', tor), 'fluegeltor');
  assert.strictEqual(R.allowedCardTypes('cover.einfahrt', tor)[0], 'fluegeltor');
});

test('Ein normaler Rollladen bleibt beim Rollladen', () => {
  // Die Torkarte darf bestehende Dashboards nicht umkrempeln.
  const rollo = { state: 'open', attributes: { device_class: 'shutter', current_position: 40 } };
  assert.strictEqual(R.defaultCardType('cover.wohnzimmer', rollo), 'cover');
  assert.strictEqual(R.allowedCardTypes('cover.wohnzimmer', rollo)[0], 'cover');
});

test('Beide Karten lassen sich fuer jedes Cover waehlen', () => {
  // Nicht jede Integration setzt die device_class -- dann muss man von Hand umstellen koennen.
  const ohne = { state: 'closed', attributes: {} };
  const erlaubt = R.allowedCardTypes('cover.tor', ohne);
  assert.ok(erlaubt.includes('fluegeltor'), JSON.stringify(erlaubt));
  assert.ok(erlaubt.includes('cover'), JSON.stringify(erlaubt));
});

test('Die Torkarte steht im Katalog und nimmt nur Cover', () => {
  assert.ok(R.CARD_TYPES.fluegeltor, 'fehlt im Katalog');
  assert.deepStrictEqual(R.domainsForType('fluegeltor'), ['cover']);
});

test('Die Dauer der Bewegung steht in JS und in CSS -- und muss uebereinstimmen', () => {
  // Der negative Startversatz wird aus TOR_TAKT gerechnet, damit die Bewegung einen Neuaufbau
  // der Karte ueberlebt. Steht in dashboard.css eine andere Dauer, springt sie doch.
  const css = require('node:fs').readFileSync('renderer/shared/dashboard.css', 'utf8');
  assert.match(css, new RegExp('animation: tor-links ' + R.TOR_TAKT + 's'));
  assert.match(css, new RegExp('animation: tor-rechts ' + R.TOR_TAKT + 's'));
});
