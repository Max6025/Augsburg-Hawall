// Tests fuer das Windows-Hintergrundbild.
//
// Zu sehen ist es genau dann, wenn die App NICHT laeuft -- waehrend eines Updates. Genau dann
// kann auch niemand nachsehen, ob es geklappt hat. Pruefbar ist hier das, was sich ohne Windows
// pruefen laesst: der Aufruf, das Skript und die Farbwolken.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../control/hintergrund.js');
const R = require('../renderer/shared/dashboard-render.js');

// "Augsburg Wall Display" steht im Pfad jedes Geraets -- mit Leerzeichen.
const ORDNER = 'C:\\Users\\max\\AppData\\Roaming\\Augsburg Wall Display';

test('Pfade mit Leerzeichen werden in Anfuehrungszeichen gesetzt', () => {
  // Ohne sie sucht PowerShell eine Datei namens "Augsburg" und meldet, sie sei nicht da.
  const b = H.befehl(ORDNER + '\\x.ps1', ORDNER + '\\desktop.png');
  assert.ok(b.includes('-File "' + ORDNER + '\\x.ps1"'), b);
  assert.ok(b.includes('-Bild "' + ORDNER + '\\desktop.png"'), b);
});

test('Der Aufruf bleibt kurz -- das Skript liegt in einer Datei', () => {
  // Dieselbe Lehre wie bei der Lautstaerke: Als -EncodedCommand bricht Windows mit
  // "Die Befehlszeile ist zu lang" ab.
  assert.ok(H.befehl('a.ps1', 'b.png').length < 300);
  assert.match(H.befehl('a.ps1', 'b.png'), /-ExecutionPolicy Bypass/);
});

test('Das Skript fuellt den Bildschirm und merkt sich das Bild', () => {
  // WallpaperStyle 10 = fuellend. Und ohne das dritte Flag (SPIF_SENDWININICHANGE) merkt sich
  // Windows das Bild nicht ueber den naechsten Start hinaus -- dann steht nach einem Neustart
  // wieder der alte Hintergrund da, und niemand weiss warum.
  assert.match(H.SKRIPT, /WallpaperStyle -Value '10'/);
  assert.match(H.SKRIPT, /TileWallpaper -Value '0'/);
  assert.match(H.SKRIPT, /SystemParametersInfo\(20, 0, pfad, 3\)/);
});

test('Ein fehlendes Bild ist kein Fehler, sondern der Normalfall vor dem ersten Start', async () => {
  // Die Bilder entstehen erst, wenn die Anzeige sie gezeichnet hat.
  const r = await H.setzen(path.join(os.tmpdir(), 'gibt-es-nicht-4711.png'));
  assert.strictEqual(r.ok, false);
  assert.match(r.fehler, /nicht vorhanden|Windows/);
});

test('Das Skript landet als Datei und wird nicht jedes Mal neu geschrieben', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-hg-'));
  const p1 = H.skriptAblegen(dir);
  assert.strictEqual(fs.readFileSync(p1, 'utf8'), H.SKRIPT);
  const vorher = fs.statSync(p1).mtimeMs;
  assert.strictEqual(H.skriptAblegen(dir), p1);
  assert.strictEqual(fs.statSync(p1).mtimeMs, vorher);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- Die Farbwolken -------------------------------------------------------------------------

test('Der Seitenhintergrund kommt aus derselben Tabelle wie das Bild', () => {
  // Sonst haette man zwei Hintergruende, die einander aehnlich sehen sollen und es nach der
  // ersten Aenderung nicht mehr tun.
  assert.strictEqual(R.DEFAULT_THEME.pageBgGradient, R.wolkenCss(R.HINTERGRUND_WOLKEN, '#0a0810'));
});

test('Der erzeugte Verlauf ist Zeichen fuer Zeichen der alte', () => {
  // Die Umstellung auf Daten durfte das Aussehen nicht anfassen.
  assert.strictEqual(R.DEFAULT_THEME.pageBgGradient, [
    'radial-gradient(52% 44% at 14% 18%, rgba(196,74,58,0.30) 0%, transparent 68%)',
    'radial-gradient(46% 40% at 86% 26%, rgba(122,58,168,0.28) 0%, transparent 66%)',
    'radial-gradient(60% 46% at 74% 88%, rgba(38,124,120,0.26) 0%, transparent 70%)',
    'radial-gradient(40% 34% at 38% 72%, rgba(214,132,48,0.18) 0%, transparent 68%)',
    '#0a0810'
  ].join(', '));
});

test('wolkenMalen legt den Grund zuerst und zeichnet jede Wolke einzeln', () => {
  // Ohne echte Zeichenflaeche: ein Doppel, das mitschreibt, was verlangt wurde.
  const rufe = [];
  const ctx = {
    set fillStyle(v) { rufe.push(['fillStyle', v]); },
    get fillStyle() { return ''; },
    fillRect: () => rufe.push(['fillRect']),
    save: () => rufe.push(['save']),
    restore: () => rufe.push(['restore']),
    translate: () => rufe.push(['translate']),
    scale: () => rufe.push(['scale']),
    createRadialGradient: () => ({ addColorStop: (o, f) => rufe.push(['stop', o, f]) })
  };
  R.wolkenMalen(ctx, 1280, 854, R.HINTERGRUND_WOLKEN, '#0a0810');
  assert.strictEqual(rufe[0][1], '#0a0810', 'der Grund gehoert zuerst');
  assert.strictEqual(rufe.filter(r => r[0] === 'save').length, R.HINTERGRUND_WOLKEN.length);
  assert.strictEqual(rufe.filter(r => r[0] === 'restore').length, R.HINTERGRUND_WOLKEN.length);
  // Jede Wolke laeuft nach aussen auf DURCHSICHTIG aus -- sonst stuende ein harter Rand im Bild.
  const durchsichtig = rufe.filter(r => r[0] === 'stop' && String(r[2]).endsWith(',0)'));
  assert.strictEqual(durchsichtig.length, R.HINTERGRUND_WOLKEN.length * 2, JSON.stringify(rufe.slice(0, 10)));
});
