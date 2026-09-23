// Regressionstest fuer den PowerShell-Vorspann der Panel-Steuerung.
//
// Anlass: Der Vorspann enthielt einen mehrzeiligen Here-String (@'...'@). Ueber die
// Standardeingabe erkennt PowerShell dessen Ende nicht -- es puffert alles Folgende als Text,
// fuehrt nie etwas aus und beendet sich am Dateiende mit Code 0, ohne Ausgabe und ohne
// Fehlermeldung. Die Funktionen Panel-Off/Panel-On existierten damit nie, jeder Abschaltbefehl
// lief ins Leere, und das Panel blieb dauerhaft an. Kein einziger der uebrigen Tests konnte das
// sehen, weil sie den PowerShell-Pfad nie betreten.
//
// Dieser Test betritt ihn. Er prueft ausschliesslich, dass der Vorspann durchlaeuft und die
// Funktionen definiert sind -- Panel-Off wird NICHT aufgerufen, sonst wuerde der Bildschirm
// des Entwicklungsrechners mitten im Testlauf schwarz.

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const {
  Panel, PRELUDE, READY_MARKER, oneShotCommand, ES_WACH, ES_FREI, WACH_REASSERT_MS,
  taskleisteOneShotCommand, TASKLEISTE_REASSERT_MS, SW_HIDE, SW_SHOWNA
} = require('../control/panel');

const isWindows = process.platform === 'win32';

function runPowerShell(input, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => { ps.kill(); reject(new Error('Zeitüberschreitung')); }, timeoutMs);
    ps.stdout.on('data', d => { out += d; });
    ps.stderr.on('data', d => { err += d; });
    ps.on('error', e => { clearTimeout(timer); reject(e); });
    ps.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
    ps.stdin.write(input);
    ps.stdin.end();
  });
}

test('Der Vorspann enthaelt keinen mehrzeiligen Here-String', () => {
  // Reine Textpruefung, laeuft auf jedem System: @' am Zeilenende ist der Ausloeser.
  assert.ok(!/@'\s*$/m.test(PRELUDE),
    'Ein Here-String im Vorspann macht die Panel-Steuerung stumm (siehe Kommentar oben)');
  assert.ok(!PRELUDE.includes("'@"),
    'Kein Here-String-Abschluss im Vorspann erlaubt');
});

test('Jede Anweisung des Vorspanns steht auf genau einer Zeile', () => {
  const lines = PRELUDE.split('\n').filter(l => l.trim());
  assert.ok(lines.length >= 4, 'Vorspann wirkt unvollständig');
  for (const line of lines) {
    assert.ok(line.trim().length > 0);
  }
  assert.ok(PRELUDE.includes('function Panel-Off'), 'Panel-Off fehlt im Vorspann');
  assert.ok(PRELUDE.includes('function Panel-On'), 'Panel-On fehlt im Vorspann');
});

test('Der Rueckfallweg kommt ohne Standardeingabe aus', () => {
  const cmd = oneShotCommand(false);
  assert.ok(cmd.includes('Add-Type'), 'Der Einzelaufruf muss den Typ selbst anlegen');
  assert.ok(!cmd.includes('\n'), 'Der Einzelaufruf muss eine einzige Zeile sein');
});

test('PowerShell fuehrt den echten Vorspann aus und meldet Bereitschaft', { skip: !isWindows && 'nur unter Windows' }, async () => {
  const { code, out, err } = await runPowerShell(PRELUDE + '\n');
  assert.strictEqual(code, 0, `PowerShell endete mit Code ${code}: ${err}`);
  assert.ok(out.includes(READY_MARKER),
    `Der Vorspann hat sich nicht gemeldet. Ausgabe: ${JSON.stringify(out)} / Fehler: ${JSON.stringify(err)}`);
});

test('Panel-Off und Panel-On sind nach dem Vorspann definiert', { skip: !isWindows && 'nur unter Windows' }, async () => {
  const probe = PRELUDE + '\n'
    + '"OFF:" + [bool](Get-Command Panel-Off -EA SilentlyContinue)\n'
    + '"ON:" + [bool](Get-Command Panel-On -EA SilentlyContinue)\n';
  const { out } = await runPowerShell(probe);
  assert.match(out, /OFF:True/, 'Panel-Off wurde nicht definiert -- das Abschalten liefe ins Leere');
  assert.match(out, /ON:True/, 'Panel-On wurde nicht definiert -- das Einschalten liefe ins Leere');
});

// Panel-On ist gefahrlos: es schaltet ein und bewegt den Mauszeiger um einen Pixel hin und
// zurueck. Damit ist der gesamte Weg bis in user32.dll einmal wirklich durchlaufen, ohne dass
// beim Testen ein Bildschirm dunkel wird.
test('Ein echter Aufruf erreicht user32.dll', { skip: !isWindows && 'nur unter Windows' }, async () => {
  const probe = PRELUDE + '\nPanel-On\n"AUFRUF-OK"\n';
  const { out, err } = await runPowerShell(probe);
  assert.match(out, /AUFRUF-OK/, `Der Aufruf brach ab. Fehler: ${JSON.stringify(err)}`);
  assert.ok(!/Exception|nicht gefunden|not recognized/i.test(err),
    `PowerShell meldete einen Fehler: ${err}`);
});

// --- Echte Eingabe statt blosser Zeigerbewegung ------------------------------------------------
//
// Am Geraet beobachtet: Das Panel ging zum Terminbeginn an, zeigte zwei Sekunden den
// Sperrbildschirm und wurde sofort wieder verdunkelt. Ein Tastendruck dagegen liess es an.
// Ursache: `SetCursorPos` verschiebt den Zeiger, zaehlt fuer Windows aber nicht als
// Benutzereingabe und setzt den Leerlaufzaehler nicht zurueck.

test('Das Einschalten speist echte Eingabe ein, nicht nur eine Zeigerbewegung', () => {
  assert.ok(PRELUDE.includes('mouse_event'), 'mouse_event fehlt -- das Wecken wuerde nicht halten');
  assert.ok(!PRELUDE.includes('SetCursorPos'),
    'SetCursorPos zaehlt nicht als Benutzereingabe und darf dafuer nicht verwendet werden');
});

test('Erst einschalten, dann Eingabe einspeisen', () => {
  const zeile = PRELUDE.split('\n').find(l => l.startsWith('function Panel-On'));
  assert.ok(zeile, 'Panel-On nicht gefunden');
  assert.ok(zeile.indexOf('SendMessage') < zeile.indexOf('mouse_event'),
    'die Eingabe muss NACH dem Einschalten kommen, sonst verdunkelt Windows sofort wieder');
});

test('Ausschalten speist keine Eingabe ein', () => {
  const zeile = PRELUDE.split('\n').find(l => l.startsWith('function Panel-Off'));
  assert.ok(zeile, 'Panel-Off nicht gefunden');
  assert.ok(!zeile.includes('mouse_event'),
    'beim Abschalten darf keine Eingabe erzeugt werden -- das wuerde den Bildschirm sofort wecken');
});

test('Einschalten wird wiederholt, Ausschalten bleibt unveraendert haeufig', () => {
  const p = new Panel();
  p.supported = true;
  const gesendet = [];
  p._send = (cmd) => { gesendet.push(cmd); return true; };

  p.setPower(true);
  p.setPower(true);
  assert.deepStrictEqual(gesendet, ['Panel-On'], 'kurz hintereinander nicht erneut einschalten');

  p.lastOnAssert = Date.now() - 90 * 1000; // eine Minute ist vorbei
  p.setPower(true);
  assert.strictEqual(gesendet.length, 2, 'nach der Frist wird das Einschalten bekraeftigt');

  p.setPower(false);
  p.setPower(false);
  assert.strictEqual(gesendet.filter(c => c === 'Panel-Off').length, 2,
    'das Nachschalten des Waechters muss bei JEDEM Aufruf senden');
});

// --- Der Rundruf braucht eine Zeitgrenze -------------------------------------------------------
//
// HWND_BROADCAST stellt die Nachricht jedem Fenster einzeln zu. `SendMessage` wartet dabei auf
// jede Antwort; ein Fenster, das gerade nicht pumpt, haelt den Aufruf unbegrenzt fest. Gemessen
// am 2026-09-10 auf dem Entwicklungsrechner: `SendMessage` kam nach 25 Sekunden nicht zurueck,
// `SendMessageTimeout` mit SMTO_ABORTIFHUNG nach 55 Millisekunden. Auf dem Geraet wuerde das den
// dauerhaft offenen PowerShell-Prozess in diesem Aufruf einfrieren -- alle weiteren Befehle
// haengen dahinter, und das Panel reagiert nicht mehr.

test('Der Rundruf laeuft nie ohne Zeitgrenze', () => {
  assert.ok(!/SendMessage\(/.test(PRELUDE),
    'SendMessage ohne Zeitgrenze kann am Rundruf haengenbleiben -- SendMessageTimeout verwenden');
  assert.ok(PRELUDE.includes('SendMessageTimeout'), 'SendMessageTimeout fehlt');
  assert.ok(!/SendMessage\(/.test(oneShotCommand(true)) && !/SendMessage\(/.test(oneShotCommand(false)),
    'auch der Rueckfallweg darf nicht ohne Zeitgrenze rundrufen');
});

test('Die Zeitgrenze bricht bei einem haengenden Fenster ab', () => {
  // SMTO_ABORTIFHUNG (2) -- ohne dieses Flag wartet Windows die volle Zeitgrenze bei JEDEM
  // haengenden Fenster ab, statt sofort weiterzugehen.
  const zeile = PRELUDE.split('\n').find(l => l.startsWith('function Panel-Off'));
  const args = zeile.match(/SendMessageTimeout\(([^)]*)\)/)[1].split(',').map(a => a.trim());
  assert.strictEqual(args[4], '2', 'SMTO_ABORTIFHUNG muss gesetzt sein');
  const grenze = Number(args[5]);
  assert.ok(grenze > 0 && grenze <= 5000, `unbrauchbare Zeitgrenze: ${args[5]}`);
});

test('Panel-Off kehrt in Sekundenbruchteilen zurueck', { skip: !isWindows && 'nur unter Windows' }, async () => {
  // Der eigentliche Beweis: nicht der Text, sondern die Uhr. Gemessen wird Panel-OFF nicht --
  // das wuerde den Bildschirm des Entwicklungsrechners schwarz machen -- sondern derselbe
  // Rundruf mit MONITOR_ON, der gefahrlos ist.
  const begonnen = Date.now();
  const { out, err } = await runPowerShell(PRELUDE + '\nPanel-On\n"AUFRUF-OK"\n', 20000);
  const gedauert = Date.now() - begonnen;
  assert.match(out, /AUFRUF-OK/, `Der Aufruf brach ab. Fehler: ${JSON.stringify(err)}`);
  assert.ok(gedauert < 10000, `Der Rundruf brauchte ${gedauert} ms -- das riecht nach einer fehlenden Zeitgrenze`);
});

// --- System wach halten, Bildschirm schlafen lassen -------------------------------------------
//
// Gemessen am 2026-09-22 auf dem Surface Go: In der Sekunde, in der das Panel abgeschaltet
// wurde, begann Connected Standby -- Setup-Server weg, SSH weg, zurueck erst durch Beruehrung.
// `powercfg /requests` zeigte, woran es lag: Die App hielt nur eine AWAYMODE-Anforderung
// (Electrons prevent-app-suspension), und die wirkt auf einem Modern-Standby-Geraet nicht.

test('Der Vorspann kennt beide Richtungen des Wachhaltens', () => {
  assert.ok(PRELUDE.includes('function System-Wach'), 'System-Wach fehlt');
  assert.ok(PRELUDE.includes('function System-Frei'), 'System-Frei fehlt');
  assert.ok(PRELUDE.includes('SetThreadExecutionState'), 'der Win32-Aufruf fehlt');
});

test('Wachhalten fordert das SYSTEM an, NICHT den Bildschirm', () => {
  // ES_DISPLAY_REQUIRED (0x2) wuerde das Panel wach halten -- genau das Gegenteil dessen,
  // was dieses Projekt will. Die Zahl darf also kein gesetztes Bit 2 haben.
  const ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 0x1, ES_DISPLAY_REQUIRED = 0x2;
  assert.strictEqual(ES_WACH, ES_CONTINUOUS + ES_SYSTEM_REQUIRED);
  assert.strictEqual(ES_WACH & ES_DISPLAY_REQUIRED, 0, 'der Bildschirm darf NICHT wachgehalten werden');
  assert.strictEqual(ES_FREI, ES_CONTINUOUS, 'Freigeben heisst: nur ES_CONTINUOUS, ohne Anforderung');
});

test('Die Zahlen stehen dezimal im Vorspann', () => {
  // PowerShell liest 0x80000001 als NEGATIVEN Int32; der Aufruf schluegt dann ohne
  // Fehlermeldung fehl, und das Geraet schlaeft weiter ein, als waere nichts geschehen.
  assert.ok(PRELUDE.includes(String(ES_WACH)), 'ES_WACH steht nicht dezimal im Vorspann');
  assert.ok(!/0x8000000/i.test(PRELUDE), 'hexadezimale Schreibweise im Vorspann gefunden');
  assert.ok(PRELUDE.includes('[uint32]'), 'ohne uint32-Umwandlung wird die Zahl negativ');
});

test('Wachhalten wird bekraeftigt, nicht nur einmal gesendet', () => {
  // Die Anforderung haengt am Thread des PowerShell-Prozesses. Stirbt er und startet neu,
  // faellt sie weg -- deshalb wird sie regelmaessig erneut geschickt, wie das Einschalten.
  const p = new Panel(() => {});
  p.supported = true;
  const gesendet = [];
  p._ensureProcess = () => ({ stdin: { writable: true, write: (t) => gesendet.push(t.trim()) } });

  p.setSystemWach(true);
  assert.deepStrictEqual(gesendet, ['System-Wach'], 'die erste Anforderung muss raus');

  p.setSystemWach(true);
  assert.strictEqual(gesendet.length, 1, 'unveraendert und nicht faellig: nichts senden');

  p.wachZuletzt = Date.now() - WACH_REASSERT_MS - 1;
  p.setSystemWach(true);
  assert.deepStrictEqual(gesendet, ['System-Wach', 'System-Wach'], 'faellig: erneut bekraeftigen');

  p.setSystemWach(false);
  assert.strictEqual(gesendet[gesendet.length - 1], 'System-Frei', 'Freigeben muss ankommen');
});

test('Ohne Dauerprozess gibt es kein Wachhalten -- und keinen Absturz', () => {
  // Bewusst KEIN Rueckfall auf einen Einzelaufruf: Ein eigener Prozess waere sofort wieder
  // weg, und mit ihm die Anforderung. Eine Anforderung, die niemand haelt, ist keine.
  const p = new Panel(() => {});
  p.supported = true;
  p._ensureProcess = () => null;
  assert.strictEqual(p.setSystemWach(true), false);
});

// --- Die Taskleiste ---------------------------------------------------------------------------
//
// Hier gilt derselbe Vorbehalt wie bei Panel-Off: `Taskleiste-Aus` wird NICHT aufgerufen, sonst
// verschwindet die Taskleiste des Entwicklungsrechners mitten im Testlauf. Geprueft wird, dass
// der Vorspann durchlaeuft und die Funktionen wirklich existieren -- das war in 1.0.0 der
// Unterschied zwischen "sieht richtig aus" und "tut nichts".

test('Der Vorspann bringt die Taskleisten-Funktionen mit', () => {
  assert.ok(PRELUDE.includes('function Taskleiste-Aus'), 'Taskleiste-Aus fehlt im Vorspann');
  assert.ok(PRELUDE.includes('function Taskleiste-An'), 'Taskleiste-An fehlt im Vorspann');
  assert.ok(PRELUDE.includes('Shell_TrayWnd'), 'ohne die Fensterklasse findet niemand die Leiste');
  assert.ok(PRELUDE.includes('Shell_SecondaryTrayWnd'),
    'auf einem angesteckten Monitor bliebe sonst eine Leiste stehen');
  for (const line of PRELUDE.split('\n').filter(l => l.trim())) {
    assert.ok(!/^\s*(function|if|while)\b.*[^}]\s*$/.test(line) || line.trim().endsWith('}'),
      `Unvollstaendige Zeile im Vorspann: ${line.slice(0, 60)}…`);
  }
});

test('Der Rueckfallweg der Taskleiste kommt ohne Standardeingabe aus', () => {
  const cmd = taskleisteOneShotCommand(true);
  assert.ok(cmd.includes('Add-Type'), 'der Einzelaufruf muss den Typ selbst anlegen');
  assert.ok(!cmd.includes('\n'), 'der Einzelaufruf muss eine einzige Zeile sein');
  assert.ok(cmd.trim().endsWith(`Taskleiste-Setzen ${SW_SHOWNA}`), 'zeigen heisst SW_SHOWNA');
  assert.ok(taskleisteOneShotCommand(false).trim().endsWith(`Taskleiste-Setzen ${SW_HIDE}`));
});

test('Ausblenden wird bei jedem Aufruf gesendet, Einblenden nur beim Wechsel', () => {
  // Die Rollen sind gegenueber setPower() vertauscht: Hier ist AUSBLENDEN der Dauerzustand.
  // Windows legt bei jedem Explorer-Neustart eine frische, sichtbare Leiste an -- ohne
  // Nachschalten stuende sie ab diesem Moment ueber dem Dashboard.
  const gesendet = [];
  const p = new Panel(() => {});
  p.supported = true;
  p._ensureProcess = () => ({ stdin: { writable: true, write: (c) => gesendet.push(c.trim()) } });

  p.setTaskleiste(false);
  p.setTaskleiste(false);
  p.setTaskleiste(false);
  assert.deepStrictEqual(gesendet, ['Taskleiste-Aus', 'Taskleiste-Aus', 'Taskleiste-Aus']);

  gesendet.length = 0;
  p.setTaskleiste(true);
  p.setTaskleiste(true);
  assert.deepStrictEqual(gesendet, ['Taskleiste-An'], 'unveraendert und nicht faellig: nichts senden');

  p.taskleisteZuletzt = Date.now() - TASKLEISTE_REASSERT_MS - 1;
  p.setTaskleiste(true);
  assert.deepStrictEqual(gesendet, ['Taskleiste-An', 'Taskleiste-An'], 'faellig: erneut bekraeftigen');
});

test('Ohne Dauerprozess blendet ein Einzelaufruf aus', () => {
  // Anders als beim Wachhalten gibt es hier einen Rueckfallweg: ShowWindow haengt nicht am
  // Thread des Prozesses, ein Einzelaufruf wirkt also auch, wenn er danach sofort endet.
  const aufrufe = [];
  const p = new Panel(() => {});
  p.supported = true;
  p._ensureProcess = () => null;
  p._einzelaufruf = (befehl) => { aufrufe.push(befehl); return true; };
  assert.strictEqual(p.setTaskleiste(false), true);
  assert.strictEqual(aufrufe.length, 1);
  assert.ok(aufrufe[0].includes(`Taskleiste-Setzen ${SW_HIDE}`));
});

test('Freigeben laeuft eigenstaendig und nur, wenn die Leiste versteckt ist', () => {
  // Der Prozess muss unseren eigenen ueberleben: Freigegeben wird, WAEHREND sich die App
  // beendet. Und freigegeben wird nur, was vorher versteckt war -- beim Update ist der nackte
  // Desktop gewollt.
  const aufrufe = [];
  const p = new Panel(() => {});
  p.supported = true;
  p._einzelaufruf = (befehl, was, eigenstaendig) => { aufrufe.push({ befehl, eigenstaendig }); return true; };

  assert.strictEqual(p.taskleisteFreigeben(), false, 'nie versteckt: nichts zu tun');
  assert.strictEqual(aufrufe.length, 0);

  p.taskleiste = false;
  assert.strictEqual(p.taskleisteFreigeben(), true);
  assert.strictEqual(aufrufe.length, 1);
  assert.strictEqual(aufrufe[0].eigenstaendig, true, 'sonst stirbt der Prozess mit der App');
  assert.ok(aufrufe[0].befehl.includes(`Taskleiste-Setzen ${SW_SHOWNA}`));
});

test('Taskleiste-Aus und Taskleiste-An sind nach dem Vorspann definiert', { skip: !isWindows && 'nur unter Windows' }, async () => {
  const probe = PRELUDE + '\n'
    + '"AUS:" + [bool](Get-Command Taskleiste-Aus -EA SilentlyContinue)\n'
    + '"AN:" + [bool](Get-Command Taskleiste-An -EA SilentlyContinue)\n';
  const { out } = await runPowerShell(probe);
  assert.match(out, /AUS:True/, 'Taskleiste-Aus wurde nicht definiert -- das Ausblenden liefe ins Leere');
  assert.match(out, /AN:True/, 'Taskleiste-An wurde nicht definiert -- die Leiste kaeme nie zurueck');
});

// Gefahrlos: FindWindow sucht eine Fensterklasse, die es nicht gibt, ShowWindow wird also nie
// aufgerufen. Damit ist der Weg bis in user32.dll einmal durchlaufen, ohne dass beim Testen
// eine Taskleiste verschwindet.
test('Die Taskleisten-Aufrufe erreichen user32.dll', { skip: !isWindows && 'nur unter Windows' }, async () => {
  const probe = PRELUDE + '\n'
    + "$h = [Wall.PanelCtl]::FindWindow('Wall_GibtEsNicht', $null)\n"
    + '"TREFFER:" + ($h -eq [System.IntPtr]::Zero)\n';
  const { out, err } = await runPowerShell(probe);
  assert.match(out, /TREFFER:True/, `Der Aufruf brach ab. Fehler: ${JSON.stringify(err)}`);
  assert.ok(!/Exception|nicht gefunden|not recognized/i.test(err),
    `PowerShell meldete einen Fehler: ${err}`);
});

test('Ein fehlgeschlagenes Wachhalten wird gemeldet -- einmal, nicht jede Minute', () => {
  // Vorher gab diese Stelle nur `false` zurueck. Niemand las den Rueckgabewert, im Protokoll
  // stand weiterhin "System wird wachgehalten" -- dieselbe Klasse Fehler wie 1.0.4, nur eine
  // Ebene tiefer.
  const zeilen = [];
  const p = new Panel((stufe, text) => zeilen.push(stufe + ': ' + text));
  p.supported = true;
  p._ensureProcess = () => null;

  assert.strictEqual(p.setSystemWach(true), false);
  assert.strictEqual(p.systemWachGestellt, false, 'gestellt wurde nichts');
  const warnungen = () => zeilen.filter(z => z.startsWith('warn') && z.includes('NICHT wachgehalten'));
  assert.strictEqual(warnungen().length, 1, 'die Meldung muss ueberhaupt kommen');

  p.wachZuletzt = Date.now() - WACH_REASSERT_MS - 1;
  p.setSystemWach(true);
  assert.strictEqual(warnungen().length, 1, 'aber nur beim Wechsel -- sonst waere es Laerm');
});

test('Nach einem gelungenen Wachhalten gilt es als gestellt', () => {
  const p = new Panel(() => {});
  p.supported = true;
  p._ensureProcess = () => ({ stdin: { writable: true, write: () => {} } });
  assert.strictEqual(p.setSystemWach(true), true);
  assert.strictEqual(p.systemWachGestellt, true);
  p.setSystemWach(false);
  assert.strictEqual(p.systemWachGestellt, false, 'freigeben heisst: keine Anforderung mehr');
});
