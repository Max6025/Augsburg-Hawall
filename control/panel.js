// Steuerung des physischen Panels unter Windows.
//
// "Panel aus" heißt hier: Windows schaltet die Hintergrundbeleuchtung ab (SC_MONITORPOWER).
// Das ist ausdrücklich NICHT das Nachtschwarz der Vorlage, bei dem ein schwarzes Overlay über
// einem weiterhin leuchtenden Bildschirm liegt.
//
// Zwei Windows-Eigenheiten prägen dieses Modul:
//
// 1. Jede Eingabe -- Maus, Touch, Tastatur, manche Hintergrunddienste -- weckt das Panel sofort
//    wieder auf. Deshalb genügt einmaliges Abschalten nicht; der Wächter im Controller schaltet
//    wiederholt nach. Dieses Modul stellt dafür nur das billige Nachschalten bereit.
//
// 2. Das Einschalten über SC_MONITORPOWER mit -1 funktioniert auf aktuellen Windows-Versionen
//    unzuverlässig. Zuverlässig weckt nur echte Eingabe -- und zwar ECHTE: `SetCursorPos`
//    verschiebt zwar den Mauszeiger, zählt für Windows aber nicht als Benutzereingabe und setzt
//    den Leerlaufzähler nicht zurück. Am Gerät beobachtet: Das Panel ging an, zeigte zwei
//    Sekunden den Sperrbildschirm und wurde sofort wieder verdunkelt; ein Tastendruck dagegen
//    liess es an. Deshalb wird die Eingabe jetzt über `mouse_event` eingespeist -- eine relative
//    Bewegung um einen Pixel und zurück, die Windows als echte Eingabe verbucht.
//
// Damit der Wächter nicht alle paar Sekunden einen neuen PowerShell-Prozess startet, hält
// dieses Modul EINEN Prozess offen und schiebt ihm Befehle über die Standardeingabe zu.
//
// ACHTUNG, teuer bezahlte Lektion: Der Vorspann darf KEINEN mehrzeiligen Here-String (@'...'@)
// enthalten. Über die Standardeingabe erkennt PowerShell dessen Ende nicht, puffert alles
// Folgende als Text, führt nie etwas aus und beendet sich am Dateiende ohne Ausgabe und ohne
// Fehlermeldung -- das Panel wird dann nie abgeschaltet, und niemand merkt es. Alle
// Deklarationen stehen deshalb einzeilig. Der Bereitschafts-Rückruf unten sichert das ab.

const { spawn } = require('child_process');

const HWND_BROADCAST = -1;
const WM_SYSCOMMAND = 0x0112;
const SC_MONITORPOWER = 0xF170;
const MONITOR_OFF = 2;
const MONITOR_ON = -1;

const READY_MARKER = 'PANEL-BEREIT';
const READY_TIMEOUT_MS = 10000;
// Das Einschalten wird regelmaessig bekraeftigt. Einmal genuegt in der Theorie -- praktisch gibt
// es unter Windows genug Stellen, die einen Bildschirm wieder verdunkeln (Sperrbildschirm-
// Zeitgeber, Treiber, Energierichtlinien). Eine Minute ist selten genug, um nicht zu stoeren,
// und haeufig genug, dass ein dunkler Bildschirm waehrend eines Termins nicht dunkel bleibt.
const ON_REASSERT_MS = 60 * 1000;

const MOUSEEVENTF_MOVE = 0x0001;

// --- Die Taskleiste dauerhaft ausblenden ----------------------------------------------------
//
// Ein Drittes haengt hier, aus demselben Grund wie das Wachhalten unten: Es ist ein
// Win32-Aufruf, und der dauerhaft offene PowerShell-Prozess macht ohnehin schon Win32-Aufrufe.
// Ein zweiter Dauerprozess nur fuer die Taskleiste waere ein zweiter Bereitschafts-Handschlag,
// ein zweiter Rueckfallweg und eine zweite Stelle, die stumm kaputtgehen kann.
//
// Warum nicht der Kiosk-Modus allein? Der deckt die Taskleiste nur ZU. Auf einem Touch-Geraet
// holt eine Wischgeste vom unteren Rand sie darueber, und mit ihr Startmenue und Uhr -- mitten
// im Dashboard. `AllowEdgeSwipe=0` in main.js nimmt der Geste die Wirkung, aber nur ihr: Die
// Windows-Taste, ein Explorer-Neustart und die Anmeldung bringen die Leiste genauso zurueck.
//
// Deshalb wird nicht zugedeckt, sondern das Fenster der Leiste selbst versteckt
// (`ShowWindow(SW_HIDE)` auf `Shell_TrayWnd`). Ein verstecktes Fenster kann keine Geste
// hervorholen -- es ist nicht da. Weitere Bildschirme haben je eine eigene Leiste
// (`Shell_SecondaryTrayWnd`); die werden mitgenommen, sonst bliebe auf einem angesteckten
// Monitor bei der Wartung eine Leiste stehen.
//
// Das Verstecken ist NICHT dauerhaft gespeichert -- kein Registrierungswert, nichts, was ein
// Geraet unbrauchbar zuruecklaesst. Ein Explorer-Neustart oder ein Neustart des Geraets legt
// eine frische, sichtbare Leiste an. Genau darum schaltet der Waechter bei jedem Takt nach
// (siehe control/controller.js), und genau darum ist ein Neustart der Rettungsanker, wenn die
// App einmal abstuerzt, waehrend die Leiste versteckt ist.
const SW_HIDE = 0;
// SHOWNA statt SHOW: Die Leiste wird wieder sichtbar, reisst aber nicht den Fokus an sich.
// Andernfalls verliert das Dashboard den Fokus in dem Moment, in dem jemand es bedienen will.
const SW_SHOWNA = 8;
// Die Leiste kommt von selbst zurueck (Explorer-Neustart, Anmeldung). Sichtbar-Lassen wird
// deshalb regelmaessig bekraeftigt -- dieselbe Vorsicht wie beim Panel und beim Wachhalten.
// Das Verstecken braucht keine Frist: Es wird bei JEDEM Takt nachgeschaltet.
const TASKLEISTE_REASSERT_MS = 60 * 1000;

// Bricht die Zustellung an ein Fenster ab, das seine Nachrichtenschleife nicht bedient.
const SMTO_ABORTIFHUNG = 0x0002;
// Reichlich fuer ein antwortendes Fenster (gemessen: der gesamte Rundruf braucht ~55 ms) und
// kurz genug, dass ein haengendes Fenster die Steuerung nicht sichtbar aufhaelt.
const SMTO_TIMEOUT_MS = 1500;

// --- Das System wach halten, den Bildschirm aber schlafen lassen ---------------------------
//
// Gemessen am 2026-09-22 auf dem Surface Go: In der Sekunde, in der das Panel abgeschaltet
// wurde, begann Connected Standby (Kernel-Power 506). Der Setup-Server war weg, SSH auch, und
// zurueck kam das Geraet erst durch eine Beruehrung -- zwei Minuten spaeter (507).
//
// `keepSystemAwake()` in main.js sollte genau das verhindern, tut es aber nicht.
// `powercfg /requests` auf dem Geraet zeigte:
//
//     SYSTEM:    Keine.
//     AWAYMODE:  Augsburg Wall Display.exe
//
// Electrons `prevent-app-suspension` landet als **Away-Mode**-Anforderung. Away Mode stammt
// aus der Zeit des klassischen S3-Schlafs und wirkt auf einem Modern-Standby-Geraet nicht.
// Gebraucht wird eine SYSTEM-Anforderung, und Electron bietet dafuer keinen Weg: Sein
// `prevent-display-sleep` wuerde zusaetzlich den BILDSCHIRM wach halten -- das Gegenteil
// dessen, was dieses Projekt will.
//
// Deshalb hier, ueber denselben dauerhaft offenen PowerShell-Prozess, der ohnehin schon
// Win32-Aufrufe macht. ES_SYSTEM_REQUIRED **ohne** ES_DISPLAY_REQUIRED: System wach, Panel
// darf dunkel bleiben. Der Aufruf erzeugt KEINE Eingabe und weckt deshalb auch nichts auf --
// das ist der Unterschied zum Mauszeiger-Wackeln beim Einschalten.
//
// Die Zahlen bewusst dezimal statt hexadezimal: PowerShell liest 0x80000001 als negativen
// Int32, und der Aufruf schluegt dann ohne Fehlermeldung fehl.
//   ES_CONTINUOUS      0x80000000 = 2147483648  (gilt, bis sie zurueckgenommen wird)
//   ES_SYSTEM_REQUIRED 0x00000001
const ES_WACH = 2147483649;   // ES_CONTINUOUS | ES_SYSTEM_REQUIRED
const ES_FREI = 2147483648;   // nur ES_CONTINUOUS -- nimmt die Anforderung zurueck
// Die Anforderung haengt am THREAD. Stirbt der PowerShell-Prozess, faellt sie weg; der
// Vorspann setzt sie beim Neustart wieder. Zusaetzlich wird sie regelmaessig bekraeftigt --
// dieselbe Vorsicht wie beim Einschalten des Panels.
const WACH_REASSERT_MS = 60 * 1000;

const MEMBERS = [
  '[DllImport("user32.dll")] public static extern int SendMessageTimeout(int hWnd, int hMsg, int wParam, int lParam, int fuFlags, int uTimeout, out int lpdwResult);',
  '[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, System.IntPtr dwExtraInfo);',
  '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);',
  '[DllImport("user32.dll", SetLastError = true)] public static extern System.IntPtr FindWindow(string lpClassName, string lpWindowName);',
  '[DllImport("user32.dll", SetLastError = true)] public static extern System.IntPtr FindWindowEx(System.IntPtr hwndParent, System.IntPtr hwndChildAfter, string lpszClass, string lpszWindow);',
  '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);'
].join(' ');

// Der Rundruf an HWND_BROADCAST stellt die Nachricht JEDEM Fenster einzeln zu. Mit dem
// gewoehnlichen SendMessage wartet der Aufruf dabei auf jede einzelne Antwort -- ein Fenster,
// das gerade nicht pumpt, haelt ihn unbegrenzt fest. Das ist keine graue Theorie: Auf dem
// Entwicklungsrechner lief `Panel-On` am 2026-09-10 reproduzierbar in die 30-Sekunden-Grenze
// des Tests, waehrend derselbe Aufruf mit Zeitgrenze in 55 ms zurueckkam. Passiert das auf dem
// Geraet, steht der dauerhaft offene PowerShell-Prozess in diesem einen Aufruf, und jeder
// weitere Ein- und Ausschaltbefehl reiht sich dahinter ein, ohne je auszufuehren -- von aussen
// nicht von 1.0.0 zu unterscheiden. Deshalb ausschliesslich SendMessageTimeout.
const rundruf = (wert) => '$r = 0; [Wall.PanelCtl]::SendMessageTimeout('
  + [HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, wert, SMTO_ABORTIFHUNG, SMTO_TIMEOUT_MS].join(', ')
  + ', [ref]$r) | Out-Null';

const OFF_CALL = rundruf(MONITOR_OFF);
// Erst einschalten, dann echte Eingabe einspeisen, damit der Zustand haelt. Die Reihenfolge ist
// wichtig: Die Eingabe setzt den Leerlaufzaehler zurueck und verhindert das sofortige erneute
// Verdunkeln -- deshalb muss sie NACH dem Einschalten kommen.
const ON_CALL = [
  rundruf(MONITOR_ON),
  `[Wall.PanelCtl]::mouse_event(${MOUSEEVENTF_MOVE}, 1, 0, 0, [System.IntPtr]::Zero)`,
  'Start-Sleep -Milliseconds 40',
  `[Wall.PanelCtl]::mouse_event(${MOUSEEVENTF_MOVE}, -1, 0, 0, [System.IntPtr]::Zero)`
].join('; ');

// Erst die Hauptleiste, dann alle Leisten weiterer Bildschirme. Die Schleife laeuft ueber
// FindWindowEx mit dem jeweils zuletzt gefundenen Fenster als Startpunkt -- so kommen auch
// mehrere Nebenleisten dran.
//
// EINZEILIG, wie alles hier: Ueber die Standardeingabe wuerde PowerShell aus einer mehrzeiligen
// Deklaration nie eine Funktion machen (siehe der Warnhinweis im Kopf dieser Datei).
const TASKLEISTE_CALL = "function Taskleiste-Setzen($z) { "
  + "$h = [Wall.PanelCtl]::FindWindow('Shell_TrayWnd', $null); "
  + "if ($h -ne [System.IntPtr]::Zero) { [Wall.PanelCtl]::ShowWindow($h, $z) | Out-Null }; "
  + "$n = [System.IntPtr]::Zero; "
  + "while ($true) { "
  + "$n = [Wall.PanelCtl]::FindWindowEx([System.IntPtr]::Zero, $n, 'Shell_SecondaryTrayWnd', $null); "
  + "if ($n -eq [System.IntPtr]::Zero) { break }; "
  + "[Wall.PanelCtl]::ShowWindow($n, $z) | Out-Null } }";

const ADD_TYPE = `Add-Type -Name PanelCtl -Namespace Wall -MemberDefinition '${MEMBERS}'`;

const PRELUDE = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  ADD_TYPE,
  `function Panel-Off { ${OFF_CALL} }`,
  `function Panel-On { ${ON_CALL} }`,
  `function System-Wach { [Wall.PanelCtl]::SetThreadExecutionState([uint32]${ES_WACH}) | Out-Null }`,
  `function System-Frei { [Wall.PanelCtl]::SetThreadExecutionState([uint32]${ES_FREI}) | Out-Null }`,
  TASKLEISTE_CALL,
  `function Taskleiste-Aus { Taskleiste-Setzen ${SW_HIDE} }`,
  `function Taskleiste-An { Taskleiste-Setzen ${SW_SHOWNA} }`,
  `"${READY_MARKER}"`
].join('\n');

// Für den Rückfallweg: ein vollständiger Einzelbefehl, der ohne Standardeingabe auskommt.
function oneShotCommand(on) {
  return `${ADD_TYPE}; ${on ? ON_CALL : OFF_CALL}`;
}

// Dasselbe fuer die Taskleiste. Gebraucht wird es an zwei Stellen: wenn der Dauerprozess
// aufgegeben hat, und beim Wartungs-Ausstieg -- dort muss die Leiste zurueckkommen, WAEHREND
// sich die App beendet, und ein Befehl in der Standardeingabe eines gleich beendeten Prozesses
// kaeme dafuer zu spaet.
function taskleisteOneShotCommand(sichtbar) {
  return `${ADD_TYPE}; ${TASKLEISTE_CALL}; Taskleiste-Setzen ${sichtbar ? SW_SHOWNA : SW_HIDE}`;
}

class Panel {
  constructor(logger) {
    this.log = logger || (() => {});
    this.proc = null;
    this.supported = process.platform === 'win32';
    this.lastDesired = null;
    this.lastOnAssert = 0;   // wann zuletzt "einschalten" gesendet wurde
    this.ready = false;      // hat der Prozess seine Bereitschaft gemeldet?
    this.systemWach = null;  // zuletzt gewuenschter Zustand, null = noch nie gesetzt
    this.wachZuletzt = 0;
    this.taskleiste = null;  // zuletzt gewuenschter Zustand der Taskleiste, null = nie gesetzt
    this.taskleisteZuletzt = 0;
    // GEWUENSCHT (systemWach) und TATSAECHLICH GESTELLT sind zweierlei. Der Unterschied ist der
    // ganze Punkt: Ohne Dauerprozess laesst sich die Anforderung nicht stellen, und wer nur den
    // Wunsch meldet, behauptet auf der Einrichtungsseite etwas, das nicht stimmt.
    this.systemWachGestellt = false;
    this.wachFehlerGemeldet = false;
    this.fallback = false;   // Dauerprozess aufgegeben, Einzelaufrufe verwenden
    this.readyTimer = null;
  }

  _spawnPersistent() {
    try {
      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );

      let buffer = '';
      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        if (!this.ready && buffer.includes(READY_MARKER)) {
          this.ready = true;
          clearTimeout(this.readyTimer);
          this.log('info', 'Panel-Steuerung bereit');
        }
        if (buffer.length > 4096) buffer = buffer.slice(-1024);
      });

      proc.on('error', (err) => {
        this.log('warn', `Panel-Steuerung konnte nicht gestartet werden: ${err.message}`);
        this._dropProcess();
      });
      proc.on('exit', () => { this._dropProcess(); });
      if (proc.stderr) proc.stderr.on('data', () => {});
      proc.stdin.on('error', () => { this._dropProcess(); });

      proc.stdin.write(PRELUDE + '\n');

      // Meldet sich der Prozess nicht, ist der Dauerweg kaputt -- dann lieber teurere
      // Einzelaufrufe als ein Panel, das still nie ausgeht.
      this.readyTimer = setTimeout(() => {
        if (this.ready) return;
        this.log('warn', 'Panel-Steuerung meldet keine Bereitschaft -- Umschalten auf Einzelaufrufe');
        this.fallback = true;
        this._dropProcess();
      }, READY_TIMEOUT_MS);
      this.readyTimer.unref && this.readyTimer.unref();

      return proc;
    } catch (err) {
      this.log('warn', `Panel-Steuerung nicht verfügbar: ${err.message}`);
      this.fallback = true;
      return null;
    }
  }

  _dropProcess() {
    this.ready = false;
    if (this.proc) {
      try { this.proc.kill(); } catch (e) { /* Prozess ist bereits weg */ }
    }
    this.proc = null;
  }

  _ensureProcess() {
    if (!this.supported || this.fallback) return null;
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;
    this.proc = this._spawnPersistent();
    return this.proc;
  }

  // Rückfallweg: ein eigener Prozess je Schaltvorgang. Teurer, aber ohne Standardeingabe und
  // damit ohne die Fehlerquelle, die den Dauerprozess stumm machen kann.
  //
  // `eigenstaendig` loest den Prozess von unserem ab, damit er den Befehl noch ausfuehrt, wenn
  // die App sich gerade beendet. Gebraucht wird das nur beim Wartungs-Ausstieg: Stirbt der
  // Kindprozess mit uns, bleibt die Taskleiste versteckt und niemand kommt an Windows.
  _einzelaufruf(befehl, was, eigenstaendig = false) {
    try {
      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', befehl],
        { windowsHide: true, stdio: 'ignore', detached: eigenstaendig }
      );
      proc.on('error', (err) => this.log('warn', `${was}-Einzelaufruf fehlgeschlagen: ${err.message}`));
      if (eigenstaendig) proc.unref();
      return true;
    } catch (err) {
      this.log('warn', `${was}-Einzelaufruf nicht möglich: ${err.message}`);
      return false;
    }
  }

  _oneShot(on) {
    return this._einzelaufruf(oneShotCommand(on), 'Panel');
  }

  _send(command, on) {
    const proc = this._ensureProcess();
    if (!proc || !proc.stdin.writable) return this._oneShot(on);
    try {
      proc.stdin.write(command + '\n');
      return true;
    } catch (err) {
      this.log('warn', `Panel-Befehl fehlgeschlagen: ${err.message}`);
      this._dropProcess();
      return this._oneShot(on);
    }
  }

  /**
   * Schaltet das Panel ein bzw. aus.
   *
   * Beim Ausschalten wird bewusst auch dann erneut gesendet, wenn das Panel nach unserem
   * Kenntnisstand längst aus ist -- genau das ist das Nachschalten des Wächters, und der
   * Befehl ist bei bereits dunklem Panel wirkungslos und billig.
   */
  setPower(on) {
    if (!this.supported) return false;
    const changed = this.lastDesired !== on;
    this.lastDesired = on;
    if (on) {
      const faellig = Date.now() - this.lastOnAssert >= ON_REASSERT_MS;
      if (!changed && !faellig) return true;
      this.lastOnAssert = Date.now();
      // Nur der Wechsel wird protokolliert -- sonst stuende jede Minute eine Zeile im Protokoll.
      if (changed) this.log('info', 'Panel wird eingeschaltet');
      return this._send('Panel-On', true);
    }
    if (changed) this.log('info', 'Panel wird ausgeschaltet');
    return this._send('Panel-Off', false);
  }

  /**
   * Das System wach halten (true) oder wieder freigeben (false).
   *
   * Wach heisst hier ausdruecklich NICHT hell: Das Panel darf und soll weiter abschalten.
   * Gebraucht wird das, damit der Setup-Server und die Steuerung nachts erreichbar bleiben,
   * waehrend das Panel dunkel ist -- siehe den Kopf dieser Datei.
   *
   * Wird regelmaessig bekraeftigt, auch ohne Aenderung: Die Anforderung haengt am Thread des
   * PowerShell-Prozesses, und der kann zwischendurch neu gestartet worden sein.
   */
  setSystemWach(wach) {
    if (!this.supported) return false;
    const changed = this.systemWach !== wach;
    this.systemWach = wach;
    const faellig = Date.now() - this.wachZuletzt >= WACH_REASSERT_MS;
    if (!changed && !faellig) return true;
    this.wachZuletzt = Date.now();
    if (changed) {
      this.log('info', wach
        ? 'System wird wachgehalten -- das Panel darf trotzdem abschalten'
        : 'System darf schlafen (Akkubetrieb)');
    }
    // Kein Rueckfall auf einen Einzelaufruf: Ein eigener Prozess waere sofort wieder weg, und
    // mit ihm die Anforderung. Ohne Dauerprozess gibt es dieses Merkmal schlicht nicht.
    const proc = this._ensureProcess();
    if (!proc || !proc.stdin.writable) return this._wachFehlgeschlagen(
      'kein dauerhafter PowerShell-Prozess');
    try {
      proc.stdin.write((wach ? 'System-Wach' : 'System-Frei') + '\n');
      this.systemWachGestellt = wach;
      this.wachFehlerGemeldet = false;
      return true;
    } catch (err) {
      this._dropProcess();
      return this._wachFehlgeschlagen(err.message);
    }
  }

  /**
   * Das Wachhalten ist fehlgeschlagen -- und das darf nicht still passieren.
   *
   * Vorher gab diese Stelle nur `false` zurueck. Niemand hat den Rueckgabewert gelesen, im
   * Protokoll stand weiterhin "System wird wachgehalten", und die Einrichtungsseite meldete
   * denselben Satz -- ein Haken, der nichts tut, und nichts, was darauf hinweist. Das ist
   * dieselbe Klasse Fehler wie der fehlende Aufruf in 1.0.4, nur eine Ebene tiefer.
   *
   * Gemeldet wird beim WECHSEL, nicht bei jedem Takt: Eine Zeile pro Minute waere Laerm, und
   * ein zugemuelltes Protokoll ist genau dann wertlos, wenn man es braucht.
   */
  _wachFehlgeschlagen(grund) {
    this.systemWachGestellt = false;
    if (!this.wachFehlerGemeldet) {
      this.wachFehlerGemeldet = true;
      this.log('warn', `System kann NICHT wachgehalten werden (${grund}) -- das Geraet darf `
        + 'nach dem Abschalten des Panels schlafen, und die Weboberflaeche ist dann nicht '
        + 'erreichbar.');
    }
    return false;
  }

  /**
   * Die Taskleiste sichtbar machen (true) oder verstecken (false).
   *
   * Die Rollen sind vertauscht gegenueber setPower(): Hier ist AUSBLENDEN der Dauerzustand, der
   * bei jedem Takt nachgeschaltet wird, und SICHTBAR die Ausnahme, die nur bei Aenderung und
   * danach im Minutentakt bekraeftigt wird. Der Grund steht im Kopf dieser Datei: Windows legt
   * bei jedem Explorer-Neustart eine frische, sichtbare Leiste an, und ohne Nachschalten stuende
   * sie ab diesem Moment ueber dem Dashboard, bis jemand davorsteht und es sieht.
   */
  setTaskleiste(sichtbar) {
    if (!this.supported) return false;
    const changed = this.taskleiste !== sichtbar;
    this.taskleiste = sichtbar;
    if (sichtbar) {
      const faellig = Date.now() - this.taskleisteZuletzt >= TASKLEISTE_REASSERT_MS;
      if (!changed && !faellig) return true;
      this.taskleisteZuletzt = Date.now();
      if (changed) this.log('info', 'Taskleiste wird eingeblendet');
      return this._sendTaskleiste(true);
    }
    if (changed) this.log('info', 'Taskleiste wird ausgeblendet');
    return this._sendTaskleiste(false);
  }

  _sendTaskleiste(sichtbar) {
    const proc = this._ensureProcess();
    if (!proc || !proc.stdin.writable) {
      return this._einzelaufruf(taskleisteOneShotCommand(sichtbar), 'Taskleiste');
    }
    try {
      proc.stdin.write((sichtbar ? 'Taskleiste-An' : 'Taskleiste-Aus') + '\n');
      return true;
    } catch (err) {
      this.log('warn', `Taskleisten-Befehl fehlgeschlagen: ${err.message}`);
      this._dropProcess();
      return this._einzelaufruf(taskleisteOneShotCommand(sichtbar), 'Taskleiste');
    }
  }

  /**
   * Die Taskleiste zurueckgeben, bevor die App verschwindet.
   *
   * Ausdruecklich NICHT Teil von dispose(): Beim Update beendet sich die App ebenfalls, und
   * dort ist der nackte Desktop gewollt (siehe hintergrundSetzen in main.js). Zurueckgegeben
   * wird sie nur beim Wartungs-Ausstieg -- wer Strg+Alt+Q drueckt, will an Windows.
   */
  taskleisteFreigeben() {
    if (!this.supported || this.taskleiste !== false) return false;
    this.taskleiste = true;
    this.log('info', 'Taskleiste wird freigegeben -- die App beendet sich');
    return this._einzelaufruf(taskleisteOneShotCommand(true), 'Taskleiste', true);
  }

  dispose() {
    clearTimeout(this.readyTimer);
    if (this.proc) {
      try { this.proc.stdin.end(); } catch (e) { /* Prozess ist bereits weg */ }
    }
    this._dropProcess();
  }
}

module.exports = {
  Panel, PRELUDE, READY_MARKER, oneShotCommand, ES_WACH, ES_FREI, WACH_REASSERT_MS,
  taskleisteOneShotCommand, TASKLEISTE_REASSERT_MS, SW_HIDE, SW_SHOWNA
};
