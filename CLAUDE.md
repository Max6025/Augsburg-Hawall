# HA Wall Eurasburg

Wandpanel für Home Assistant unter Windows im **Dauerbetrieb**. Electron 31, Vanilla JS, kein
Bundler, kein TypeScript.

Vorlage ist [Italien Wall Display](https://github.com/Max6025/Italien-Hawall) — ein Fork mit
voller Historie, `upstream` zeigt dorthin. Dies ist bewusst ein eigenes Projekt, siehe
[ADR 0001](docs/adr/0001-eigenes-projekt-statt-schalter.md).

**Der eine Satz, der alles andere erklärt:** Dort steuert ein Kalender die Anzeige, weil nur
zeitweise jemand im Haus ist. Hier wohnt jemand. Der Normalzustand ist „Panel an", die einzige
Ausnahme ist die Nacht — und was auf dem angeschalteten Panel zu sehen ist, entscheidet der
Bildschirmschoner, nicht die Steuerung.

## Vor dem Loslegen lesen

- [CONTEXT.md](CONTEXT.md) — das Glossar. **Panel** ist das Gerät, **Wall Display** die Anzeige;
  **Panel aus** ist echtes Abschalten. Ganz unten steht, welche Begriffe aus der Vorlage hier
  ersatzlos entfallen sind — die Liste ist da, damit niemand sie versehentlich wieder einführt.
- [docs/adr/](docs/adr/) — fünf Entscheidungen, die im Code wie Versehen aussehen und keine sind.

## Architektur

Die Steuerung liegt im **Hauptprozess** unter `control/`, nicht im Renderer. Der Wächter muss
auch laufen, wenn gerade kein Dashboard geladen ist.

| Datei | Aufgabe |
|---|---|
| `control/panel.js` | Win32 über einen dauerhaft offenen PowerShell-Prozess: Panel per `SC_MONITORPOWER` schalten, System wach halten, Taskleiste verstecken |
| `control/controller.js` | Zustandsautomat; die Rangfolge steht vollständig in `decide()`, die Taskleiste in `taskleisteSoll()` |
| `control/energie.js` | Die Schlaf-Fristen des Energieschemas auf „nie" setzen — **das** hält das Gerät nachts erreichbar |
| `server/systemstatus.js` | Das Urteil der Statusseite: reine Funktion, rein die Rohwerte, raus die Liste mit Stufen |
| `renderer/setup/status.html` | Die Statusseite — zeigt nur an, bewertet nicht |
| `renderer/dashboard.html` (Blende) | Der Übergang zwischen „Panel an" und „Panel aus", zwei Wege hinein |
| `control/wartungsmelder.js` | Der Überwachung sagen, dass gerade gearbeitet wird — und dass es vorbei ist |
| `control/lautstaerke.js` | Systemlautstärke anheben (nur während einer Akkuwarnung, nie senken) |
| `control/hintergrund.js` | Windows-Hintergrundbild setzen — sichtbar nur, während die App nicht läuft |
| `control/torzeiten.js` | Misst beim ersten Durchlauf, wie lange ein Tor auf- und zufährt |
| `renderer/shared/akku.js` | Wie dringend die Akkuwarnung ist: Stufe, Abstand, Lautstärke, Stummschalten |
| `renderer/shared/mdi-pfade.js` | **Erzeugt.** Alle Material-Design-Symbole; wird nur bei Bedarf nachgeladen |
| `server/setup-server.js` | Express auf Port 8788, HA-Proxy, Zugangscode |
| `server/dashboard-austausch.js` | Dashboards als Datei aus- und eingeben; Prüfung beim Import |
| `server/ha-live.js` | Dauerverbindung zu HA; meldet jede Zustandsänderung weiter |
| `renderer/dashboard.html` | Anzeige; empfängt den Steuerungszustand per IPC, entscheidet nichts selbst. Läuft auch als **Live-Ansicht** unter `/live` im Browser |
| `renderer/shared/bildschirmschoner.js` | Der Ruhezustand: `sollSchonen()` ist reine Entscheidung ohne DOM und ohne Netz, der Rest ist Anzeige |
| `renderer/shared/buehne.js` | Die driftenden Farbwolken — ein Partikelsystem, ohne jede Entscheidung |
| `renderer/shared/markdown.js` | Der kleine Markdown-Satz für eingetippte Texte |
| `renderer/shared/dashboard-render.js` | Kartenkatalog und Rendering; enthält auch das eingebaute Design `DEFAULT_THEME` |

Die Rangfolge in `decide()` ist die einzige Stelle, an der entschieden wird, ob das Panel an
sein soll. Sie ist kurz, und das soll sie bleiben:

```
1. Karenzzeit nach dem Start  -> Panel an   (Rettungsanker nach einem Windows-Update)
2. Pause aktiv                -> Panel an   (jemand steht davor und will bedienen)
3. Nachtsperre aktiv          -> Panel aus  (die EINZIGE Regel, die abschaltet)
4. sonst                      -> Panel an
```

Neue Sonderfälle gehören dorthin und nirgendwo sonst. Was auf dem *angeschalteten* Panel zu
sehen ist, gehört dagegen ausdrücklich **nicht** hierher — das ist Sache des Bildschirmschoners
(siehe [ADR 0003](docs/adr/0003-schoner-ist-der-ruhezustand.md)).

## Fallstricke

- **Panel einschalten braucht ECHTE Eingabe.** `SC_MONITORPOWER` mit `-1` allein hält nicht, und
  `SetCursorPos` hilft nicht: Es verschiebt den Zeiger, zählt für Windows aber nicht als
  Benutzereingabe und setzt den Leerlaufzähler nicht zurück. Am Gerät sah das so aus: Panel geht
  an, zeigt zwei Sekunden den Sperrbildschirm, wird wieder dunkel — ein Tastendruck dagegen ließ
  es an. `panel.js` speist die Eingabe deshalb über `mouse_event` ein und bekräftigt das
  Einschalten jede Minute erneut. Beim **Ausschalten** darf keine Eingabe erzeugt werden, sonst
  weckt der Abschaltbefehl den Bildschirm sofort wieder.
- **Rundruf nur mit Zeitgrenze.** `HWND_BROADCAST` stellt die Nachricht *jedem* Fenster einzeln
  zu, und `SendMessage` wartet dabei auf jede einzelne Antwort. Ein Fenster, das gerade nicht
  pumpt, haelt den Aufruf unbegrenzt fest. Gemessen am 2026-09-10 auf dem Entwicklungsrechner:
  `SendMessage` kam nach 25 Sekunden nicht zurueck, `SendMessageTimeout` mit `SMTO_ABORTIFHUNG`
  nach 55 Millisekunden. Auf dem Geraet friert das den dauerhaft offenen PowerShell-Prozess in
  diesem einen Aufruf ein; jeder weitere Ein- und Ausschaltbefehl reiht sich dahinter ein und
  wird nie ausgefuehrt -- von aussen nicht von 1.0.0 zu unterscheiden. `panel.js` verwendet
  deshalb ausschliesslich `SendMessageTimeout`, und `test/panel.test.js` misst die Dauer, statt
  nur den Text zu pruefen.

- **Kein Here-String im PowerShell-Vorspann.** Über die Standardeingabe erkennt PowerShell das
  Ende von `@'...'@` nicht: Es puffert alles Folgende als Text, führt nie etwas aus und beendet
  sich am Dateiende mit Code 0 — ohne Ausgabe, ohne Fehlermeldung. Das Panel wird dann nie
  abgeschaltet, und man sieht nur ein Display, das anbleibt. Genau das ist in 1.0.0 passiert.
  Alle Deklarationen in `panel.js` stehen deshalb einzeilig, der Prozess meldet seine
  Bereitschaft zurück, und bleibt die Meldung aus, fällt die App auf Einzelaufrufe zurück.
  `test/panel.test.js` prüft das gegen einen echten PowerShell-Prozess.
- **Zugangscode und Loopback**: Das Wall Display selbst ruft über `http://localhost` auf und ist
  vom Code ausgenommen. Diese Grenze nicht aufweichen, sonst sperrt sich das Gerät selbst aus.
- **Electrons `prevent-app-suspension` hält ein Modern-Standby-Gerät NICHT wach.** Gemessen am
  2026-09-22 auf dem Surface Go: In derselben Sekunde, in der das Panel abgeschaltet wurde,
  begann Connected Standby (Kernel-Power 506) — Setup-Server weg, SSH weg, zurück erst durch
  eine Berührung, zwei Minuten später (507). `powercfg /requests` sagte, warum:

  ```
  SYSTEM:    Keine.
  AWAYMODE:  <die App>
  ```

  Away Mode stammt aus der Zeit des klassischen S3-Schlafs und wirkt auf einem
  Modern-Standby-Gerät nicht; gebraucht wird eine **SYSTEM**-Anforderung. Electron bietet dafür
  keinen Weg — sein `prevent-display-sleep` würde zusätzlich den Bildschirm wach halten, also
  genau das Gegenteil. Deshalb setzt `control/panel.js` `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`
  selbst, über den ohnehin offenen PowerShell-Prozess, **ohne** `ES_DISPLAY_REQUIRED`. Drei
  Dinge hängen daran: Die Zahl steht **dezimal** im Vorspann (PowerShell liest `0x80000001` als
  negativen Int32, und der Aufruf schlägt dann ohne Fehlermeldung fehl); die Anforderung hängt
  am **Thread** des PowerShell-Prozesses und wird deshalb regelmäßig bekräftigt; und es gibt
  **keinen Rückfall** auf einen Einzelaufruf — ein eigener Prozess wäre sofort wieder weg, und
  mit ihm die Anforderung. Wachgehalten wird ab Werk **ohne Ausnahme, auch im Akkubetrieb**, und die Einstellung
  `systemWachhalten` schaltet es ab.
  Das ist eine ausdrückliche Entscheidung und kein Versehen: Ein Wandpanel, dessen
  Weboberfläche nachts nicht antwortet, ist von einem kaputten nicht zu unterscheiden — und wer
  dann nachsehen will, muss hingehen. Der Preis steht im Protokoll (`akkuWarnen()` meldet den
  Wechsel, nicht jeden Takt): Am Akku entlädt sich das Gerät deutlich schneller. Abschaltbar ist es trotzdem, denn die richtige Antwort hängt am Gerät: Das Surface beherrscht
  „Standby mit verbundenem Netzwerk" — **am Netz** bleibt die Weboberfläche also auch im Schlaf
  erreichbar, und dann ist Schlafenlassen das Sparsamere. **Am Akku** wirft Windows das WLAN in
  einen tieferen Sparzustand, und nur Wachhalten hilft. Gemessen am 2026-09-23 auf dem Surface
  Go: auf Akku war der Setup-Server im Standby zwei Minuten lang tot.
  Eine Randnotiz, die Zeit spart: Die Vorlage hat dafür **keine Lösung**, auch wenn es dort so
  aussieht. `.scratch/aufwecken-und-echtes-ausschalten/spec.md` dort trägt den Status
  „erfasst, nicht entschieden, nicht gebaut". Prüfen lässt sich das Ganze nur am
  Gerät, mit `powercfg /requests` — unter **SYSTEM** muss die App stehen, nicht „Keine".
- **Eine Funktion, die niemand aufruft, ist dasselbe wie eine, die es nicht gibt.** In 1.0.4
  steckte `setSystemWach()` vollständig in `panel.js` — der Aufruf im Controller fehlte, weil
  ein abgebrochenes Bearbeitungsskript `controller.js` und `main.js` nie geschrieben hatte.
  Alle Tests waren grün, denn jeder prüfte nur seine eigene Hälfte; am Gerät zeigte
  `powercfg /requests` weiterhin „SYSTEM: Keine". Wo zwei Dateien zusammenspielen müssen,
  gehört ein Test auf die **Verbindung** dazu, nicht nur auf die Teile — `test/controller.test.js`
  prüft deshalb, dass jeder Takt `setSystemWach()` ruft, und liest `main.js` daraufhin, ob der
  Akkuzustand überhaupt hereingereicht wird.
- **Das Gerät schläft ein, weil der Bildschirm ausgeht — und die Lösung ist eine Zeile
  `powercfg`.** Der Weg dorthin hat zwei falsche Erklärungen und zwei Releases gekostet; beide
  stehen unten, damit sie niemand noch einmal geht.

  **Was gemessen wurde (2026-09-23, Surface Go, Windows 11 25H2 Build 26200):** Sobald die
  Nachtsperre das Panel abschaltete, war der Setup-Server **in derselben Sekunde** weg. Das
  Windows-Protokoll zeigt Kernel-Power **506** (Standby-Beginn) auf die Sekunde genau zu den
  Zeitpunkten, an denen `panelsteuerung.log` „Panel wird ausgeschaltet" schreibt — 07:09:56 und
  07:24:56. Das Abschalten des Bildschirms machte das Gerät leerlaufend, und die **Schlaffrist
  des Energieschemas** griff sofort.

  **Die Lösung:** `powercfg /change standby-timeout-ac|dc 0`, dazu `hibernate-timeout` und
  `monitor-timeout` (`control/energie.js`). Danach lag das Panel fünf Minuten dunkel, davon vier
  Minuten **ohne ein einziges Netzwerkpaket von außen** — danach antworteten Webserver *und*
  SSH, und im Windows-Protokoll steht für diesen Zeitraum **kein** Standby-Ereignis. Das Gerät
  hat nicht „überlebt", es ist gar nicht schlafen gegangen.

  Drei Punkte, die daran hängen:
  1. **Kein Merker, bei jedem Start neu setzen.** Ein Windows-Update oder ein Zurücksetzen des
     Schemas stellt die Fristen wieder her, und ein Merker würde genau dann lügen. Sechs Aufrufe
     beim Start kosten nichts. Nach einer erkannten Taktlücke wird zusätzlich nachgezogen.
  2. **Keine erhöhten Rechte nötig** — nachgemessen, nicht angenommen: Eine geplante Aufgabe mit
     `/rl limited` setzte den Wert von `0x12c` (fünf Minuten) auf `0x0`. Damit entfällt jeder
     UAC-Dialog.
  3. **Nachlesen statt dem Rückgabewert glauben.** `powercfg` kommt auch dann ohne Fehler
     zurück, wenn nichts steht; `setzen()` liest die Fristen danach zurück. Und die Auswertung
     liest **keine übersetzten Beschriftungen**, sondern die letzten beiden Hexwerte in fester
     Reihenfolge.

  **Sackgasse 1: `ES_SYSTEM_REQUIRED` (`panel.js`, `setSystemWach`).** Die Anforderung wird
  gestellt, `powercfg /requests` zeigt sie unter SYSTEM — und das Gerät schlief trotzdem. Sie
  verhindert den expliziten und den leerlaufbedingten Schlaf, aber nicht den Übergang, den das
  Abschalten des Bildschirms auslöst. Der Aufruf bleibt drin (er kostet nichts und deckt den
  Leerlauf-Fall), als *Erklärung* für die Erreichbarkeit ist er falsch. Nebenbei widerlegt:
  Electrons `prevent-app-suspension` landet auf diesem Build als **AUSFÜHRUNG**-Anforderung
  (`PowerRequestExecutionRequired`), nicht als Away Mode.

  **Sackgasse 2: `PlatformAoAcOverride = 0`, um Modern Standby abzuschalten.** Auf diesem Gerät
  **wirkungslos**, und zwar messbar: Wert gesetzt, Gerät neu gestartet, `powercfg /a` meldete
  Modern Standby unverändert als verfügbar. Microsoft hat die Wirkung in den neueren
  Windows-11-Builds entfernt. Dazu kennt die Firmware des Surface Go **kein S3** (`powercfg /a`:
  „Die Systemfirmware unterstützt diesen Standbystatus nicht") — ein anderer Schlafzustand wäre
  also ohnehin nicht dagewesen. Das hat 1.0.8 und 1.0.9 gekostet, samt eines UAC-Dialogs, der
  nichts bewirkt hätte. **Nicht wieder einbauen**; ein Test prüft, dass das Modul und der
  NSIS-Einschub draußen bleiben.
- **Ein stilles „false" ist kein Fehlerbericht.** `setSystemWach()` gab bei fehlendem Dauerprozess
  nur `false` zurück: kein Protokolleintrag, und die Einrichtungsseite meldete weiter „Das Gerät
  wird wachgehalten", weil sie den **Wunsch** anzeigte statt der Tatsache. Ein Haken, der nichts
  tut, ist schlimmer als ein Haken, der aus ist — man verlässt sich darauf. Jetzt trennt der
  Zustand `systemWach` (gewünscht) von `systemWachGestellt` (wirklich angefordert), und das
  Scheitern wird beim Wechsel protokolliert.
- **Der eigene Takt ist der einzige Zeuge für den eigenen Schlaf.** Während Connected Standby
  läuft nichts — kein Takt, kein Server —, und hinterher läuft alles wieder: Von außen ist das
  nicht von einem Absturz und nicht von einem WLAN-Problem zu unterscheiden, und am Gerät findet
  man keine Spur. `schlaflueckeMessen()` meldet deshalb jede Taktlücke über 20 Sekunden ins
  Protokoll und in den Zustand. `powercfg /requests` wäre genauer, **verlangt aber erhöhte
  Rechte** und fällt damit aus — die App läuft unelevert.
- **Die Taskleiste wird versteckt, nicht zugedeckt.** Der Kiosk-Modus legt sich nur *über* sie;
  auf einem Touch-Gerät holt eine Wischgeste vom unteren Rand sie darüber, und ein
  Explorer-Neustart oder eine Anmeldung bringt sie ohnehin zurück. `AllowEdgeSwipe=0` nimmt der
  Geste die Wirkung, aber nur ihr. Deshalb versteckt `panel.js` das **Fenster** der Leiste
  (`ShowWindow(SW_HIDE)` auf `Shell_TrayWnd`, dazu jede `Shell_SecondaryTrayWnd`), und der
  Wächter schaltet bei **jedem Takt** nach — dieselbe Nachschalt-Logik, mit der das Panel
  nachts dunkel bleibt. Drei Dinge hängen daran:
  1. **Sichtbar heißt raus aus dem Kiosk-Modus**, und zwar *mit* dem Vollbild: `setKiosk(false)`
     allein lässt das Fenster im Vollbild, und die Leiste bliebe zugedeckt — von außen sieht das
     aus, als hätte das Einblenden nicht funktioniert. Das Fenster zieht sich danach auf
     `workArea` zusammen, also auf den Bildschirm ohne den Streifen der Leiste.
  2. **Der Kiosk-Modus wird nur beim Wechsel angefasst.** Alle fünf Sekunden neu gesetzt,
     flackert das Fenster und zieht den Fokus an sich; anders als die Leiste bringt Windows es
     nicht von selbst durcheinander.
  3. **Nichts davon steht in der Registry.** Es gibt keinen gespeicherten Zustand, der ein Gerät
     unbrauchbar zurücklassen könnte: Ein Neustart legt eine frische, sichtbare Leiste an. Das
     ist der Rettungsanker, wenn die App abstürzt, während die Leiste versteckt ist —
     `Strg+Alt+Q` gibt sie ausdrücklich zurück, `dispose()` bewusst **nicht** (beim Update ist
     der nackte Desktop gewollt).
- **Die `appId` bleibt `de.max.augsburgwalldisplay` — sie ist kein Name, sie ist eine
  Identität.** Beim Umbenennen des Projekts am 2026-09-23 (aus „Augsburg Wall Display" wurde
  „HA Wall Eurasburg") wurde alles Sichtbare geändert: `name`, `productName`, Repo, Titel,
  Markenfläche, Dateiname des Installers. Die `appId` **nicht**, und das ist Absicht:
  electron-builder führt daran den Deinstallations-Eintrag und den Update-Pfad. Wer sie ändert,
  bekommt beim nächsten Update **keinen** Fehler, sondern eine **zweite** Installation neben der
  alten — und die alte startet weiter mit, streitet um Port 8788 und schaltet am Panel mit.
  Dasselbe gilt für `productName` mit einer zweiten Falle: Daraus leitet Electron
  `app.getPath('userData')` ab, also `%APPDATA%\<productName>`. Dort liegen Zugangsdaten,
  Dashboards und Bilder. Eine Umbenennung ohne **Mitnehmen dieses Ordners** startet die App wie
  frisch installiert: keine Home-Assistant-Verbindung, keine Dashboards, und am Panel sieht es
  aus wie ein Totalverlust.
- **Die Blende hat ZWEI Wege hinein, und der zweite ist der wichtigere.** Sie macht den
  Übergang zwischen „Panel an" und „Panel aus" — ohne sie schaltet die Nachtsperre die
  Hintergrundbeleuchtung mitten im Bild ab, und beim Aufwachen steht das volle Dashboard von
  einem Bild auf das andere da. Auf einer Wand fällt der **Sprung** auf, nicht das Abschalten.
  1. **Der Zustand der Steuerung.** `abschiedEinlegen()` lässt das Panel beim Kippen noch 2,5 s
     an und meldet `abschied`; die Anzeige blendet in dieser Zeit aus. Das verschiebt nur den
     *Zeitpunkt* — an `decide()` ändert es nichts, und das muss so bleiben.
  2. **Eine Berührung.** Die weckt die Beleuchtung **sofort** (echte Eingabe, siehe `panel.js`),
     aber die Steuerung erfährt das erst beim nächsten Takt — bis zu **fünf Sekunden** später.
     Wer nur auf den Zustand hört, zeigt dem, der gerade angefasst hat, fünf Sekunden Schwarz —
     also *schlimmer* als ohne Blende. Deshalb blendet der `pointerdown`/`keydown`-Handler
     selbst auf. Wer zuerst merkt, gewinnt.

  Zwei Dinge sind leicht zu übersehen: Die Blende braucht `pointer-events: none`, sonst
  verschluckt sie den ersten Tipp — genau den, der aufwecken soll. Und die **Dauer** kommt aus
  dem Zustand (`abschiedMs`), nicht aus dem CSS: eine zweite Zahl dort läuft beim nächsten
  Ändern auseinander, dieselbe Lehre wie bei `TOR_TAKT` und `HVAC_ANIMATIONEN`. Ansehen ohne
  Gerät: `.scratch/uebergaenge/blende-probe.html`.
- **Eine Wartung, die niemand schließt, verdeckt genau den Ausfall, den sie ankündigen
  sollte.** Vor einem Update meldet die App eine Wartung an das Add-on
  [Wartungsmelder](https://github.com/Max6025/Hawall-Addons) (Uptime Kuma hat dafür keine
  REST-API, und die Zugangsdaten sollen den HA-Host nicht verlassen). Ohne das ist jedes Update
  für die Überwachung ein Ausfall: Die App beendet sich, der Installer läuft, das Gerät startet
  neu — Statusseite rot, Alarm, jedes Mal. Vier Dinge hängen daran:
  1. **Strategie `single`, nicht `manual`.** Eine manuelle Wartung bleibt offen, bis jemand sie
     schließt. Bleibt das Gerät nach einem misslungenen Update aus, sagt die Statusseite
     freundlich „in Wartung" — und niemand sieht nach. Mit einem Fenster läuft sie aus, und der
     Alarm kommt verspätet statt nie. Geschlossen wird trotzdem ausdrücklich; das Fenster ist
     das Fangnetz, nicht der Weg.
  2. **Erst merken, dann melden.** Der Schlüssel wird vor dem Melden in den Speicher gelegt und
     erst nach dem Beenden entfernt — genau dazwischen liegt `updater.install()`, und was danach
     geschrieben würde, wird nie geschrieben.
  3. **Das Ende erkennt der eigene Webserver, nicht die App.** „Die App läuft" wäre ein Urteil
     über sich selbst; `gesundAbwarten()` fragt deshalb `/api/gesundheit` — genau das, was die
     Überwachung von draußen sieht. Und beharrlich (`abschliessenWiederholt`), weil Home
     Assistant länger bootet als das Panel.
  4. **Gemeldet wird in `controller.wartung()`**, nicht bei den Aufrufern. Es gibt drei Wege
     dorthin, und einer davon (der Knopf auf der Einstellungsseite) läuft über den Server und
     ginge an `main.js` vorbei. Drei Meldestellen wären drei Stellen, an denen eine vergessen
     wird — gemerkt hätte man es erst, wenn eine Wartung vor Ort Alarm auslöst.

  Ohne eingetragene Adresse ist der Melder **still**: kein Fehler, keine Verzögerung beim
  Update. Die Überwachung ist eine Zugabe, und ein Panel muss ohne sie genauso laufen.
- **Eine Wartung ohne zugeordnete Monitore unterdrückt keinen einzigen Alarm.** Sie ist dann
  angelegt, in der Liste sichtbar — und wirkungslos; dasselbe gilt für eine fehlende
  Statusseiten-Zuordnung. Das Add-on macht nach dem Anlegen deshalb immer beide Zuordnungen,
  und sein `GET /selbsttest` prüft ausdrücklich, ob die eingetragenen Monitornamen in Uptime
  Kuma überhaupt **existieren**. Das ist der Fehler, der sonst unentdeckt bleibt, weil alles
  gelingt. Der Knopf „Verbindung prüfen" auf der Einstellungsseite geht dafür **vom Panel aus**
  und über dieselbe Adresse und denselben Schlüssel wie später das Update — eine Prüfung aus
  dem Browser des Einrichtenden wäre grün und bewiese nichts.
- **`$('x')` liefert `null`, und der Zugriff darauf bricht den GANZEN Seitenaufbau ab.** Ein
  Tippfehler in einer ID genügt, und die Einstellungsseite lässt sich nicht mehr bedienen —
  ohne dass etwas nach einem Fehler aussieht. `test/setup-seiten.test.js` vergleicht deshalb
  jede gerufene ID mit der Seite, und zwar für **alle** Seitenpaare, die es findet: Eine von
  Hand gepflegte Liste ließe ausgerechnet die neue Seite ungeprüft. IDs, die das Skript selbst
  erzeugt (der Editor baut seine Einstellungsfelder vollständig in JS), zählen mit — ein Test,
  dem man nicht glaubt, wird abgeschaltet statt gelesen.
- **`/api/gesundheit` ist die einzige Route ohne Zugangscode — und das ist eine Entscheidung.**
  Sie ist für eine Überwachung von außen gedacht (Uptime Kuma), und die kann sich nicht
  anmelden. Hängt sie hinter dem Code, meldet die Überwachung ab dem Tag, an dem einer gesetzt
  wird, dauerhaft „down" — aus dem falschen Grund. Drei Dinge hängen daran:
  1. **Die Ausnahme steht VOR der Code-Prüfung** in der Mittelschicht. Dahinter wäre sie
     wirkungslos, und das fällt erst auf, wenn jemand einen Code setzt. Ein Test vergleicht die
     Reihenfolge im Quelltext.
  2. **Jedes Feld ist eine Preisgabe.** Raus gehen Stufe, Version und die *Titel* der
     auffälligen Prüfungen — keine Adressen, keine Entitäten, kein Protokoll, kein Token. Ein
     Test prüft die Antwort gegen eine feste Feldliste und gegen konkrete Fremdwerte.
  3. **Nur `fehler` ist 503.** `hinweis` und `unbekannt` liefern 200: Ein fehlender Zugangscode
     darf niemanden nachts aus dem Bett holen, und nach dem dritten Fehlalarm glaubt niemand
     mehr der Anzeige — dieselbe Lehre wie bei der Überfällig-Warnung der Tor-Karte.

  Das Schlüsselwort `HAWALL-OK` steht **wortwörtlich** im Körper, weil die Überwachungsart
  „HTTP(s) - Keyword" Text sucht und nicht Struktur. Wer es umbenennt, muss die Überwachung
  nachziehen.
- **Die Energiekarte zeigt LEISTUNG (W), nicht ENERGIE (kWh) — und hat das jahrelang nicht
  gesagt.** Der Vorschlag-Knopf im Editor las `energy/get_prefs` von Home Assistant aus und trug
  ein, was dort steht: die kWh-**Zähler** (`stat_energy_from`). Ein Zählerstand von 1234 kWh
  erschien dann als „1,23 kW" — eine Zahl, die aussieht wie eine Leistung, sich langsam bewegt
  und nichts bedeutet. Im Kleingedruckten stand „ggf. Leistungssensor statt Statistik-ID
  nachtragen", und genau das geht unter: Der Knopf hat gefüllt, es sah fertig aus.
  1. **Die Karte prüft die Einheit** und schreibt einen Satz statt einer Zahl, die lügt — mit
     Kennung und Einheit des Sensors.
  2. **Der Vorschlag-Knopf sucht Leistungssensoren** (`/api/entities` liefert dafür `einheit`
     und `klasse` mit) und lässt leer, was er nicht findet. Ein leeres Feld ist ein sichtbares
     „fehlt noch", ein falsch gefülltes eine stille Lüge.
  3. **Die Batterie wird NICHT geraten.** Am Gerät durchprobiert: `battery.?power` trifft einen
     Handy-Akku, `akkuleistung` den Speicher des *zweiten* Hauses — beide Anlagen hängen in
     derselben HA-Instanz. Aus einem Sensornamen lässt sich nicht ableiten, in welchem Haus er
     steht, und ein falscher Batterieknoten geht auch in die Hausverbrauchs-Rechnung ein.
- **Eine Klasse ohne CSS-Regel ist genauso tot wie eine Regel ohne Klasse.** Beim Umbenennen der
  Diagramm-Konstanten traf das Suchmuster auch Zeichenketten: Aus dem SVG-Kommando `M` am Anfang
  eines Pfads wurde `ED_M` (der Browser verwirft so einen Pfad **stillschweigend** —
  `getTotalLength()` gab 0, und die Karte zeigte Knoten ohne eine einzige Leitung), und aus
  `class="ed-symbol"` wurde `class="ed-edSymbol"` (Element da, Gestaltung weg). Beides ohne
  Fehlermeldung. `test/energiediagramm.test.js` vergleicht deshalb die Klassen im JS mit den
  Regeln im CSS **in beide Richtungen** und prüft jeden Pfadstring gegen `^M…`.
- **Was in `.scratch/karten-design/vorschau.html` fehlt, wird nicht angesehen.** Die Energiekarte
  stand dort nicht — und ist deshalb jahrelang ungeprüft ausgeliefert worden. Wer einen
  Kartentyp ändert, trägt ihn dort ein, samt der Optionen, die er braucht.
- **Auf dem Sperrbildschirm greift kein einziger Fluchtweg.** Die Tipp-Geste erreicht das
  Dashboard nicht (der Sperrbildschirm liegt davor), globale Tastenkuerzel laesst Windows dort
  nicht durch, und der Schalter in der Weboberflaeche braucht einen Server, der beim Aufwachen
  noch nicht antwortet. Wer aufweckt, hat sonst fuenf Sekunden bis zum naechsten Abschalten.
  Deshalb pausiert `powerMonitor`s `resume` und `unlock-screen` die Steuerung automatisch zwei
  Minuten. Diese Automatik nicht entfernen -- ohne sie sperrt das Geraet den Nutzer aus.
- **Beruehrung eines dunklen Panels feuert kein powerMonitor-Ereignis.** Weder `resume` noch
  `unlock-screen` -- es gab ja weder Standby noch Entsperrung. Der Controller schaut deshalb
  zusaetzlich auf `powerMonitor.getSystemIdleTime()`, hereingereicht als `idleSeconds`. Nur
  gepruft, wenn ohnehin abgeschaltet wuerde: Das Einschalten wackelt mit dem Mauszeiger
  (`panel.js`), und das wuerde sich sonst selbst als Benutzereingabe zurueckmelden.
- **Nachts wird WIRKLICH abgeschaltet, und deshalb weckt nur der Leerlaufzähler.** Das
  Nachtschwarz der Vorlage (ein Overlay über einem weiter leuchtenden Panel) gibt es hier
  nicht mehr; Begründung und Folgen stehen vollständig in
  [ADR 0002](docs/adr/0002-nachts-wirklich-aus.md). Die eine Zeile, die man dabei übersieht:
  Die Leerlauf-Prüfung in `tick()` läuft **nur, wenn ohnehin abgeschaltet würde**. Ohne diese
  Bedingung meldet sich das Mauszeiger-Wackeln aus `panel.js` als Benutzereingabe zurück, und
  die Steuerung hält sich selbst am Leben.

- **Der Bildschirmschoner ist der RUHEZUSTAND, nicht die Ausnahme.** Das ist die Umkehrung
  gegenüber der Vorlage und die häufigste Fehlerquelle beim Lesen dieses Projekts — die
  vollständige Begründung steht in
  [ADR 0003](docs/adr/0003-schoner-ist-der-ruhezustand.md). Vier Punkte sind nicht verhandelbar:
  1. **`sollSchonen()` antwortet mit JA, solange keine Bedienung bekannt ist**, und
     `letzteBedienung` startet bei `0`, nicht bei `Date.now()`. Das sieht aus wie ein
     vergessener Sonderfall und ist der Kern der Sache.
  2. **Er schaltet NICHTS am Panel.** Darüber entscheidet allein `decide()`.
  3. **Die Helligkeit läuft über `helligkeitAnpassen()`**, das den *gesamten* Zustand liest,
     nicht das letzte Ereignis. Nach dem Wegfall von Nachtschwarz und Abwesenheit ist der Schoner
     dort im Moment der einzige Grund zu dimmen — wer einen zweiten hinzufügt, rechnet ihn
     dort aus und nicht am Schoner vorbei.
  4. **Bedienung wird auf `pointerdown` und `keydown` gemessen, NIE auf `mousemove`.**
  Er läuft **nur auf dem Panel** (`IM_PANEL`): In der Live-Ansicht würde er dem, der von
  unterwegs nachsieht, genau das verdecken, wofür er die Seite geöffnet hat.

- **Die Karten des Schoners werden bei JEDER Prüfung nachgezogen, nicht nur beim Hinlegen.**
  In `schonerPruefen()` stand zuerst ein früher Ausstieg, sobald sich die Sichtbarkeit nicht
  änderte. Die Karten entstanden dadurch genau einmal — beim Start, als noch kein einziger
  Zustand abgerufen war. Auf der Wand stand daraufhin dauerhaft die Entitäts-ID statt des
  Namens und ein Strich statt des Wertes, und zwar ohne dass irgendetwas nach einem Fehler
  aussah. Teuer ist das Nachziehen nicht: `schonerKartenBauen()` vergleicht eine Signatur über
  Zustände und Attribute und baut nur bei echter Änderung neu. Ohne Zustände baut es
  **gar nichts** — eine Fläche voller Striche ist schlechter als die alten Karten.
- **`buildCard()` braucht auf dem Schoner dieselben Optionen wie auf dem Dashboard.** Fehlt
  `namen`, steht dort die Entitäts-ID statt des kurzen Namens aus der Entitätsregistrierung;
  fehlt `settings`, ist jede im Editor gesetzte Einstellung wirkungslos — eingestellt, ohne
  Wirkung, ohne Fehler. Dasselbe gilt für `apiBase`, `statesById`, `akzent` (Sensorfarben) und
  `torZeiten`. Wer `render()` um eine Option ergänzt, ergänzt `schonerKartenBauen()` mit.
- **Die Sensoren des Schoners stehen auf einem ANDEREN Dashboard.** `letzteAnzeigeEntitaeten`
  filtert die Live-Verbindung nach dem gerade angezeigten Layout — die Entitäten des Schoners
  fielen damit heraus, und ausgerechnet die Fläche, die am längsten zu sehen ist, zeigte Werte,
  die sich stundenlang nicht rührten. `schonerLayout` gehört deshalb mit in die Menge, und eine
  Live-Meldung baut bei liegendem Schoner **ihn** neu statt des verdeckten Dashboards.
- **Die Kartenfläche des Schoners hat dasselbe Raster wie der Editor: 4 Spalten, 6 Zeilen.**
  Die erste Fassung hatte 6×6 (vom Abschiedsschirm der Vorlage übernommen); am Gerät nahmen die
  Karten dann nur zwei Drittel der Breite ein. Die Karten kommen aus
  einem Unterdashboard und bringen von dort **beides** mit: Größe *und* Platz
  (`grid-column: 4 / span 3`). Mit weniger Spalten zeigt das ins Leere — der Browser hängt
  stillschweigend weitere Spalten an, und was dahinter liegt, steht außerhalb des Bildschirms.
  Am 2026-09-14 sah das auf der Wand der Vorlage so aus: eine riesige Karte und daneben der
  Streifen einer zweiten. Die Lösung ist **nicht**, den Platz wegzuwerfen — dann sieht der
  Schoner anders aus als das, was im Editor angeordnet wurde, und die Regel wird unerklärbar.
  `schonerSpanne()` schneidet nur noch als Fangnetz und **schiebt herein statt zu beschneiden**:
  Eine Karte, die schmaler gemacht wird, verliert ihren Inhalt; eine, die ein Feld weiter links
  liegt, nicht. Die Zahlen stehen in `SCHONER_SPALTEN`/`SCHONER_ZEILEN` **und** in
  `dashboard.css`; ein Test vergleicht beide, weil ein Auseinanderlaufen keinen Fehler ergibt,
  sondern genau diesen Rand.

- **Karten brauchen mehr als ihren Zustand, und das steht an einer Stelle.** `kartenZusatz()`
  in `dashboard.html` holt Verlauf, Vorhersage, Mülltermine und Energiequellen. Zwei Flächen
  bauen Karten — das Dashboard und der Bildschirmschoner —, und die zweite Fläche holte in
  der Vorlage anfangs nur den Verlauf: Eine Müllkarte zeigte dort immer „Keine Termine
  gefunden", obwohl im Unterdashboard alles richtig eingestellt war. Wer einen Kartentyp mit eigenen Daten
  ergänzt, ergänzt ihn dort — zwei Kopien dieser Liste laufen beim nächsten Typ wieder
  auseinander.
- **Die Mülltermine-Karte beantwortet „welche Tonne, und wann" — in dieser Reihenfolge.**
  Vorher war der **Kartenname** die größte Schrift; aus zwei Metern las man „Mülltermine" und
  sonst nichts, und die Folgetermine standen in 8-Pixel-Zeilen darunter. Jetzt dieselbe
  Anatomie wie jede andere Karte: Symbolzeile mit dem Tag als Zustands-Chip, die Tonnenart als
  Wert, der Kartenname als Bildunterschrift. Drei Punkte hängen daran:
  1. **Gruppiert wird nach TAGEN** (`wasteTage()`), nicht nach Einträgen. In Crespina fahren
     dienstags zwei Tonnen zusammen — als Einzelzeilen frisst das die halbe Karte und sieht
     aus wie ein Fehler. Die Einstellung „wie viele" zählt seitdem Tage.
  2. **Die Farbe der nächsten Tonne wird der Kartenakzent.** Eine Tonne erkennt man an ihrer
     Farbe, lange bevor man den Namen liest; ein Punkt von zwölf Pixeln leistet das nicht.
     Gesetzt wird `--kachel-akzent` — nicht `background`, siehe [ADR 0004](docs/adr/0004-farbe-als-akzent-statt-als-kachelfarbe.md).
  3. **Heute und morgen färben den Zustands-Chip ein** (`wasteBald()`). Bis übermorgen ist es
     eine Information, heute ist es eine Aufgabe.
  Und: `new Date('2026-09-14')` ist **UTC**-Mitternacht. Westlich von Greenwich ist das der
  13. September, und die Tonne stünde einen Tag zu früh auf der Karte — derselbe Fallstrick wie
  bei Ganztages-Einträgen aus einem Kalender. `wasteDatum()` liest ein reines
  Datum deshalb als **lokale** Mitternacht; ein Zeitpunkt mit Uhrzeit bringt seine Zone selbst mit.
- **Die Zahl sagt WAS, das Zeichen sagt WO.** Zwei Temperaturkarten sahen gleich aus, und
  der Unterschied zwischen innen und außen stand nur in der Bildunterschrift — der kleinsten
  Schrift auf der Karte. Beim Luftdruck liegen die Werte innen und außen sogar fast gleich.
  `ortErmitteln()` gibt Temperatur-, Luftdruck-, Feuchte- und Sensorkarten (`ORT_TYPEN`)
  einen Ort, und der wird an der **Form** erkennbar gemacht, nie an der Farbe: Haus oder Tanne
  oben links, ein Chip „INNEN" (Ring) bzw. „AUSSEN" (gefüllt), und dieselbe Silhouette groß
  und blass hinter dem Wert. Die Silhouette ist das, was aus fünf Metern trägt. Farbe
  scheidet aus, weil die Temperaturkarte ihren Akzent schon nach dem Wert färbt — „blau"
  hieße dann kalt *oder* draußen. Geraten wird ab Werk aus Name und Kennung, „außen" vor
  „innen" („Aussenwand Wohnzimmer" misst draußen); eine Einstellung gewinnt immer, auch
  „Keine Angabe". Prüfen mit `.scratch/karten-design/ort-probe.html?weit` — die Frage ist
  nicht, ob es gut aussieht, sondern ob man es aus der Entfernung erkennt. `?ohne` zeigt
  zum Vergleich, wie es vorher war.
- **Karten-Einstellungen leben an genau zwei Stellen.** `settingsFieldsForType()` in
  `editor.js` entscheidet, welche Felder ein Typ bekommt; `buildCard()` in
  `dashboard-render.js` liest sie. Wer eine Einstellung nur an einer der beiden Stellen
  anlegt, bekommt keinen Fehler, sondern ein Feld ohne Wirkung — in der Vorlage war
  `gauge.baseColor` so über Monate tot. Die vollständige Bestandsaufnahme steht in
  `.scratch/karten-einstellungen/spec.md`, samt der Punkte, die bewusst **nicht** gebaut
  wurden und warum.
- **Neue Standardwerte ändern bestehende Anzeigen.** Die Nachkommastellen sind deshalb
  standardmäßig leer und lassen den Wert unverändert. Wer hier später auf „zwei Stellen ab
  Werk" umstellt, ändert stillschweigend jede Karte, die seit Jahren so hängt.

- **`el.hidden` allein blendet hier nichts aus.** Der Browser bringt `[hidden] { display: none }`
  nur im Benutzeragenten-Stylesheet mit, und das verliert gegen **jede** Regel in
  `dashboard.css` — schon gegen eine Klassenregel mit `display: flex`. Genau so stand der
  Zurück-Knopf auf dem Hauptdashboard und die Termin-Anzeige als leerer Glaskasten oben
  rechts, obwohl beide auf `hidden` standen. Deshalb steht ganz oben in `dashboard.css` ein
  `[hidden] { display: none !important; }`. Wer diese Zeile entfernt, bricht jede
  Sichtbarkeitssteuerung, die über `hidden` läuft — und zwar lautlos.
- **Das Symbol einer Klima-Karte muss zeigen, was die Anlage TUT.** Vorher trug sie immer
  dasselbe Symbol — auch ausgeschaltet stand dort ein Kühlsymbol, und aus dem Vorbeigehen las
  man das Gegenteil der Wahrheit. Die Bewegung ist dabei keine Spielerei: Sie unterscheidet
  „läuft gerade" (`hvac_action`) von „ist eingestellt" (`state`). Steht die Flamme still,
  heizt die Anlage nicht — das steht sonst nirgends auf der Karte.
- **`.as-text` trägt Markdown-Regeln, keine Farbannahmen.** Die Klasse kam vom Ankunftsschirm
  der Vorlage, der einen fest dunklen Hintergrund hatte; heute benutzt sie nur noch die
  Ankündigungsbox, und die ist themenabhängig. Eine pauschale Hell-Regel auf `.as-text` machte
  die Fettschrift dort dunkel auf dunkel. Farbregeln dafür immer auf den Container scoped
  (`.notify-box .as-text …`), nie auf `.as-text` allein.
- **Der Neuaufbau läuft nur bei echter Änderung** (`zustandsSignatur()` über die Entitäten
  *dieses* Dashboards, Zustand **und** Attribute — eine Klimaanlage ändert beim Verstellen der
  Zieltemperatur nur ein Attribut). Erst dadurch sind fünf Sekunden Abfragetakt bezahlbar.
  **Folge:** Alles, was sich ohne Zustandsänderung ändert — abgelaufene Zwischenspeicher für
  Verlauf, Vorhersage, Mülltermine — muss selbst `aufbauErzwingen = true` setzen, sonst holt
  niemand die frischen Daten ab und die Diagramme frieren lautlos ein.
- **Geschaltetes wird sofort angezeigt** (`zustandVorwegnehmen()`), nicht erst wenn Home
  Assistant den neuen Zustand meldet — bei einer Klimaanlage dauert das mehrere Sekunden, und
  bis dahin drückt man ein zweites Mal. Der vorweggenommene Wert ist eine **Annahme**; der
  nächste Abruf überschreibt ihn. Falsch liegt er nur, wenn der Befehl gar nicht ankam — und
  das meldet der Knopf ohnehin mit einem Kreuz.
- **Beide Themes prüfen, nicht nur das dunkle.** Das Dunkle war entworfen, das Helle nur
  abgeleitet — und es fiel an jeder Stelle auseinander, an der eine Farbe **fest auf Weiß**
  stand: weißer Glanz auf weißem Glas, ein Akzent, der Weiß war, ein schwarzer Schlagschatten
  als Schmutzfleck. Vor allem aber blieb der **Seitenhintergrund dunkel** (`pageBgGradient`
  gilt für beide), während der Text auf Dunkel umgestellt wurde. Deshalb gibt es jetzt
  `pageBgGradientLight` und `cardShadowLight`. Alles, was über `color-mix(… var(--text) …)`
  gerechnet ist, kippt von allein mit und braucht keine Sonderregel — feste `rgba(255,255,255,…)`
  brauchen immer eine. Ansehen mit `.scratch/karten-design/vorschau.html?hell`.
- **Die Ankündigung hat zwei Zustände und einen Weg dazwischen.** Vollbild (auffällig,
  Hintergrund abgedunkelt, Dashboard gesperrt) und Leiste (eine Zeile unten, Dashboard wieder
  bedienbar, die Karte dort weicht). Die Lage der Box wird in **Pixeln aus der echten
  Geometrie** gesetzt — gemessen an der Karte in der Unterleiste, nicht an der Leiste selbst,
  sonst landet sie breiter als das, was sie ersetzt. Nach einer Fenstergrößenänderung muss
  `notifyGeometrie()` neu laufen, sonst steht sie an der alten Stelle.
- **Sichtbarkeit gehört an den Container, nicht an die Einzelteile.** Die Ankündigungs-Box
  bestand aus einem SVG-Rahmen und einem Text, die beide per Animation mit `forwards`
  eingeblendet wurden. Das Ausblenden nahm nur den dunklen Hintergrund weg — Rahmen und Text
  standen weiter auf der Wand, obwohl die Entität längst leer war. Wer eine Überlagerung
  ausblendet, schaltet `opacity` **und** `visibility` am Container; Teile, die sich selbst
  eingeblendet haben, blenden sich nicht von selbst wieder aus.
- **Wer etwas über allem anzeigt, muss die Stapelhöhen kennen.** Der Bildschirmschoner liegt
  auf `z-index: 9990`, die Ankündigungs-Box auf 9998 — sie gewinnt bewusst, eine Nachricht ist
  dringender als eine Ruhefläche. In der Vorlage lag die Box auf 80 und war damit während
  jedes Termins vollständig zugedeckt: Sie funktionierte, nur sah sie niemand. Das ist hier
  besonders leicht zu wiederholen, weil der Schoner die meiste Zeit liegt.
- **„Leer" ist mehr als leer.** Home Assistant liefert `unknown`/`unavailable`, Menschen
  schreiben `-`, `keine` — und vertippen sich: Auf dem Gerät stand `unknow` ohne das letzte
  `n`. Mit einer Prüfung nur auf `unknown` hätte dieses Wort bildschirmfüllend an der Wand
  gestanden. `ankuendigungsText()` sammelt diese Fälle an einer Stelle; die Einstellungsseite
  benutzt **dieselbe** Funktion für ihre Vorschau, sonst sagt sie etwas anderes voraus, als
  später passiert.
- **`entity_id` ist der Schlüssel eines Layout-Eintrags.** Wer ihn ändert (Entität einer
  bestehenden Karte tauschen), muss es **nach** allen anderen Schreibzugriffen tun — bis dahin
  wird der Eintrag über die alte Kennung gefunden — und vorher prüfen, dass die neue Kennung
  nicht schon vergeben ist. Zwei Einträge mit derselben `entity_id` sind stiller Datenverlust:
  Jede Suche findet nur noch den ersten.
- **In `openSettings()` gilt eine Reihenfolge:** Erst wird `html` zusammengebaut, dann
  `$('settingsBody').innerHTML = html`, und **erst danach** darf Code die neuen Elemente
  anfassen. Steht ein `$('…')` davor, liefert es `null`, der Fehler bricht den ganzen Aufbau
  ab — und die Einstellungen lassen sich **gar nicht mehr öffnen**, nicht nur die eine Gruppe.
  In der Vorlage war eine ganze Karte deshalb zwei Versionen lang unerreichbar.
- **`editor.html` lädt `setup/style.css` NICHT.** Es bindet nur `nav.css` und `dashboard.css`
  ein und bringt seine Regeln in einem eigenen `<style>`-Block mit. Wer dort etwas gestalten
  will und es in `style.css` schreibt, bekommt keinen Fehler — die Regel wirkt einfach nicht.
  Genau so ist eine Editor-Änderung zweimal ins Leere gelaufen. Gegenprobe im Browser:
  `[...document.styleSheets].map(s => s.href)`.
- **Editor-Änderungen nie ohne Hinsehen ausliefern.** Der Editor braucht eine laufende
  HA-Verbindung und ließ sich deshalb schlecht prüfen — mit dem Ergebnis, dass er zweimal
  hintereinander unbrauchbar ausgeliefert wurde. `.scratch/karten-design/editor-probe.js`
  stellt die nötigen API-Aufrufe mit Beispieldaten nach: `node` starten, dann
  `http://localhost:9930/setup/editor.html`.
- **Im Auswahldialog gibt es zwei Wege, und einer davon füllt sein Raster selbst.** „Nach
  Kartentyp" wird in `showTypeStep()` **aufgebaut** — `wegZeigen('typ')` darf deshalb nicht nur
  die Sichtbarkeit umschalten, sonst steht dort ein leerer Tab. Genau so war er nach dem Umbau
  auf zwei Wege: Alle dreißig Kartentypen waren weg, und zu sehen war nichts, was nach einem
  Fehler aussah.
- **Nach dem Anlegen öffnen sich die Einstellungen.** Wer eine Karte anlegt, hat sie noch nicht
  so, wie er sie haben will — und das Zahnrad auf einer 1×1-Kachel ist ein kleines Ziel. Das
  übernimmt jetzt `kartenEintragAnlegen()` für alle Karten; die Sonderfälle (Energie, Foto,
  Kacheln) hatten es vorher einzeln getan und würden es sonst doppelt tun.
- **Der Editor läuft auf einem anderen Gerät als das Panel.** Ohne die Panelgröße
  (`panelGroesse` aus `/api/config`, gefüllt von `getPanelSize` in `main.js`) zieht man Karten
  auf einem breiten Notebook zurecht und sieht erst auf der Wand, dass es nicht passt. Und es
  braucht **immer einen Weg an jede Karte heran**, der nicht über die Arbeitsfläche führt: Eine
  Karte kann hinter einer anderen liegen oder so groß gezogen sein, dass man ihre Knöpfe nicht
  trifft — dann ließ sie sich nicht einmal mehr löschen. Dafür ist die Kartenliste da.
- **Eine Verbesserung, die man erst einschalten muss, ist für die meisten keine.** Drei
  Releases in Folge bestanden fast nur aus Einstellungen — Symbole, Beschriftungen, untere
  Leiste, Testmodus —, und die Rückmeldung lautete folgerichtig „hat sich nichts geändert".
  Wer die Einstellungen nie öffnet, braucht die Hilfe am dringendsten. Deshalb: sinnvolle
  Vorgabe ab Werk, Einstellung nur zum Abweichen. `symbolErraten()` rät ein Knopfsymbol aus
  Beschriftung und Entitäts-ID, statt auf eine Auswahl zu warten.
- **Eine CSS-Animation fängt in einem neu gebauten Element bei null an.** Die Karte wird bei
  jeder Änderung neu gebaut, und seit der Live-Verbindung passiert das oft und unregelmäßig —
  die Schneeflocke der Klima-Karte sprang dadurch mitten in der Drehung zurück. `hvacPhasenStil()`
  hängt die Bewegung deshalb an die **Uhr** statt an das Alter des Elements: ein negativer
  `animation-delay` aus der aktuellen Uhrzeit. Das trägt, weil `T − (T mod Zyklus)` immer ein
  Vielfaches des Zyklus ist — die Phase hängt danach nur noch von der Uhrzeit ab. Bei
  `alternate` zählt der **doppelte** Zyklus. Die Dauern stehen in `dashboard.css` **und** in
  `HVAC_ANIMATIONEN`; wer eine nur an einer Stelle ändert, bekommt keinen Fehler, sondern genau
  den Sprung zurück, den das hier verhindern soll.
- **Der Akkustand des Panels lässt sich von der Einrichtungsseite aus nicht lesen.**
  `navigator.getBattery()` beantwortet immer nur die Frage nach dem Gerät, auf dem der Browser
  gerade läuft — auf der Einrichtungsseite wäre das das Notebook, auf dem eingerichtet wird,
  also genau das falsche Gerät. Die Anzeige meldet ihn deshalb an `/api/geraet/akku`, und die
  Navigationsleiste liest ihn von dort. Zwei Dinge daran sind leicht zu übersehen: Der Wert
  liegt **nur im Speicher** (ein Akkustand von gestern ist keine Information, sondern eine
  Falle), und die Anzeige schickt **alle fünf Minuten ein Lebenszeichen**, auch wenn sich
  nichts geändert hat. Ohne das verschwände die Leiste ausgerechnet bei einem voll geladenen
  Gerät: Die Battery-API meldet sich nur bei Änderungen, und die Leiste blendet alles aus, was
  älter als eine Viertelstunde ist. Eine **Änderung** geht zusätzlich sofort über
  `/api/geraet/akku/live` (Server-Sent Events) raus — das Lebenszeichen dagegen nicht, sonst
  wäre es Lärm ohne Inhalt.
- **Ton braucht in Chromium eine Freigabe, die an einer Wand niemand erteilt.** Ohne
  `--autoplay-policy=no-user-gesture-required` (gesetzt in `main.js`) bleibt der Tonkontext
  angehalten, bis jemand die Seite anfasst — und ein angehaltener Kontext gibt **lautlos**
  nichts von sich. Der Akku-Warnton wäre genau dann still, wenn er gebraucht wird.
  Der Ton selbst ist **gerechnet, nicht abgespielt**: Eine Tondatei müsste mitgebaut,
  mitgeliefert und mit dem Installer aktuell gehalten werden — für drei Töne. Er läuft in
  **Schleife mit Pause** (45 s, unter 10 % alle 20 s): Ein einzelner Ton geht unter, wenn man
  im Nebenraum ist; ein Dauerton treibt einen aus dem Zimmer, und nach zehn Minuten zieht
  jemand den Stecker — aus dem Gerät, nicht aus dem Ladekabel.
- **Eine Warnung, die immer gleich klingt, endet immer gleich.** Entweder sie ist leise genug,
  dass man sie nach dem dritten Mal überhört — dann ist das Gerät irgendwann leer. Oder sie ist
  laut genug, dass man sie nicht überhören kann — dann schaltet sie jemand am zweiten Tag
  dauerhaft ab, und das Gerät ist irgendwann leer. Deshalb hat die Akkuwarnung **Stufen**
  (`renderer/shared/akku.js`): leise und selten am Anfang, mit der Zeit häufiger und lauter,
  ab 15 % mit anderem Motiv und blinkend. Und deshalb lässt sie sich **dreimal** für drei
  Minuten wegdrücken, danach nicht mehr — wer gerade telefoniert, soll das können; wer die
  Warnung aussitzen will, nicht. Das Kontingent gilt **je Stufe**: Wer es bei zwanzig Prozent
  aufgebraucht hat, bekommt bei vierzehn ein neues, weil das eine andere Lage ist (gemeldet
  wurde das vorher als „ab 15 % geht das Stummschalten nicht mehr"). Ausgesessen wird sie
  trotzdem nicht — auf der kritischen Stufe dauert eine Stummschaltung nur noch eine Minute. Die Schwelle ist nach unten auf **20 %** begrenzt: Darunter
  bleibt bei einem Panel, das nebenbei lädt und sich entlädt, keine Reserve zum Reagieren.
- **`Number(null)` ist 0, nicht `NaN`.** In `akkuStufe()` hätte ein fehlender Akkustand damit
  dieselbe Wirkung wie ein leerer Akku gehabt: sofort die kritische Stufe, volle Lautstärke,
  blinkende Warnung. Erst aussortieren, dann rechnen — dasselbe gilt überall dort, wo ein
  fehlender Wert etwas anderes bedeutet als null.
- **Die App hebt die Systemlautstärke an.** Ein Warnton nützt nichts, wenn das Panel stumm an
  der Wand hängt — und genau so hängt es dort normalerweise. Am Gerät gemessen: Tonkontext lief,
  Ton wurde abgespielt, zu hören war nichts. `control/lautstaerke.js` hebt sie deshalb an, aber
  **nur** während einer Akkuwarnung, **nur** nach oben und **nur**, wenn die Einstellung es
  erlaubt. Zwei Fallen stecken darin: Das PowerShell-Skript muss als **Datei** abgelegt werden
  (als `-EncodedCommand` bricht Windows mit „Die Befehlszeile ist zu lang" ab — Base64 von
  UTF-16 bläht es auf das Vierfache), und die COM-Schnittstelle `IAudioEndpointVolume` braucht
  **alle** Methoden in der richtigen Reihenfolge. Wer eine auslässt, ruft die nächste auf; ein
  erster Anlauf hatte zwei Platzhalter zu wenig und bekam „Der Wert liegt außerhalb des
  erwarteten Bereichs" zu lesen.
- **Ein stummes Panel ist von einem funktionierenden nicht zu unterscheiden.** Die Anzeige
  steht, der Code lief durch, und trotzdem hört man nichts — weil der Tonkontext angehalten
  ist, weil das Gerät stumm geschaltet wurde, oder weil gar keine Anzeige läuft. Deshalb meldet
  `akkuTonSpielen()` den Zustand des Tonkontexts an `/api/geraet/ton-ergebnis` zurück, und der
  Knopf „Warnton auf der Wand abspielen" nennt genau diese drei Fälle beim Namen. Der Befehl
  dorthin läuft über `/api/anzeige/befehle` — der erste Weg in diesem Projekt, der von der
  Einrichtungsseite **zur** Anzeige führt statt umgekehrt.
- **Die alte Akkuwarnung hing in der Kopfzeile — und die ist seit dem Redesign
  `display: none`.** Sie funktionierte, berechnete den richtigen Schwellwert und wurde nie von
  irgendjemandem gesehen. Wer eine Warnung in ein vorhandenes Element hängt, muss nachsehen,
  ob dieses Element überhaupt sichtbar ist.
- **Der einzige Moment, in dem das Gerät wie ein Computer aussieht, ist das Update.** Die App
  beendet sich, der Installer läuft still durch, die App startet neu — und weil die Taskleiste
  ausgeblendet ist, schaut man in diesen Sekunden auf den nackten Windows-Desktop. Deshalb legt
  die App dort dieselben **Farbwolken** ab wie hinter dem Dashboard, während des Updates mit dem
  Hinweis „System wird gewartet". Drei Dinge daran sind leicht zu übersehen:
  1. Gezeichnet wird im **Renderer** (dort liegen Farben, Schrift und Panelgröße), gesetzt vom
     **Hauptprozess** — denn gesetzt werden muss es in dem Moment, in dem der Renderer
     verschwindet (`updater.install()`).
  2. **Beide** Fassungen entstehen im Voraus. Die Wartungsfassung erst zu zeichnen, wenn das
     Update beginnt, wäre zu spät.
  3. Es ist eine **Einstellung, ab Werk aus**: Es ändert eine Windows-Einstellung des Benutzers.
     Auf einem Wandpanel sieht den Desktop niemand; auf einem normalen Rechner wäre es ein
     Übergriff.
- **Die Farbwolken stehen als Daten, nicht als CSS-Zeichenkette.** `HINTERGRUND_WOLKEN` speist
  sowohl `pageBgGradient` (über `wolkenCss`) als auch das gemalte Bild (über `wolkenMalen`) —
  eine CSS-Zeichenkette lässt sich nicht malen. Zwei getrennte Definitionen wären zwei
  Hintergründe, die einander ähnlich sehen sollen und es nach der ersten Änderung nicht mehr
  tun. `createRadialGradient` kann außerdem nur Kreise: Die Fläche wird für jede Wolke kurz
  gestaucht, sonst sind die Wolken rund statt oval.
- **Dieselbe Seite läuft an zwei Orten: auf der Wand und unter `/live` im Browser.**
  Unterschieden wird über `IM_PANEL` (`location.protocol === 'file:'`). Das ist keine
  Kosmetik — alles, was das **Gerät** betrifft, darf nur auf dem Panel passieren:
  Helligkeit stellen, den Akku melden (sonst stünde der Akku des Notebooks in der Leiste),
  das Hintergrundbild ablegen, den Warnton abspielen, nachts schwarz werden. Wer künftig
  etwas einbaut, das den Rechner anfasst, muss `IM_PANEL` prüfen — sonst tut es die
  Live-Ansicht mit.
  Bewusst **keine Bildschirmübertragung**: Ein Videostrom kostet dauernd Rechenzeit, frisst
  auf einem Surface Go Akku und sieht trotzdem unscharf aus. Die Seite holt ihre Daten
  ohnehin über diesen Server; ein Tastendruck geht denselben Weg wie auf dem Panel.
  Die Route heißt `/live` **ohne** abschließenden Schrägstrich: Mit `/live/` wäre die
  Grundlage für `shared/…` das Verzeichnis `/live/`, und jede Datei liefe ins Leere.
- **Kein Mauszeiger auf der Anzeige.** `body.wandanzeige` blendet ihn überall aus. Er taucht
  sonst von allein auf, weil das Aufwecken mit dem Mauszeiger wackeln muss (`panel.js`), und
  bleibt dann mitten auf der Wand stehen. Bewusst an die Body-Klasse gebunden: Der
  Karten-Editor lädt dieselbe CSS-Datei, wird aber mit der Maus bedient.
- **Eine Karte, die etwas TUT, muss anders aussehen als eine, die etwas anzeigt.** Die
  Wechsel-Karte trug ein Fadenkreuz-Symbol und ein Wort, mittig, ohne Akzent — zwischen zwanzig
  Messwerten sah sie aus wie der einundzwanzigste, und gemeldet wurde sie als „versteht man
  nicht". Jetzt: ein Pfeil, der in eine Fläche **hineingeht**, derselbe Aufbau wie bei jeder
  anderen Karte, ein fester Akzent, ein Pfeil am rechten Rand und die Bildunterschrift
  „Dashboard wechseln". Das Symbol allein reicht nicht, und der Text allein auch nicht.
- **`friendly_name` ist nicht der Name, den Home Assistant anzeigt.** Er trägt bei den meisten
  Integrationen den Gerätenamen davor: „Ecowitt Sensor 11DC2 Solar Radiation" statt
  „Solar Radiation". Auf einer zwei Zentimeter breiten Karte steht davon die Hälfte. Den kurzen
  Namen kennt nur die **Entitätsregistrierung**, und die gibt es ausschließlich über die
  WebSocket-Verbindung (`haLive.befehl('config/entity_registry/list')`, gecacht im Server unter
  `/api/ha/namen`). Ohne Administratorrechte lehnt Home Assistant sie ab — dann bleibt es bei
  `friendly_name`, so wie vorher. Reihenfolge überall: eigener Name > Registrierungsname >
  `friendly_name` > Kennung.
- **Symbole aus Home Assistant kommen nur als NAME** („mdi:weather-sunny"), nie als Zeichnung.
  Die Zeichnungen liegen in der **erzeugten** Datei `renderer/shared/mdi-pfade.js` (7447
  Symbole, 2,6 MB, erzeugt von `.scratch/karten-design/mdi-erzeugen.js` aus der
  Entwicklungsabhängigkeit `@mdi/js`). Sie wird **nicht beim Start** geladen: Die meisten
  Dashboards brauchen sie nie. Nur die **Sensorkarte** greift auf das HA-Symbol zurück — sie
  ist der Sammelfall, und was dort landet, hat kein eigens entworfenes Symbol. Bei einer
  Klimakarte wäre es umgekehrt falsch: Dort sagt die Bewegung des eigenen Symbols etwas, das
  ein fremdes nicht sagen kann.
- **Die Sensorkarte ist der Sammelfall — und sah deshalb immer gleich aus.** Drei nebeneinander
  waren nur an der Bildunterschrift zu unterscheiden. `sensorAkzente()` verteilt Farben aus
  einer Palette, die in den **Lücken** zwischen den festen Kartenakzenten liegt (kein Blau,
  kein Rot, kein Orange — sonst sieht eine Sensorkarte aus wie eine Klimakarte). Die Farbe wird
  aus der Kennung gewürfelt, damit eine Karte ihre Farbe behält, wenn daneben eine dazukommt;
  ist sie schon vergeben, wird die nächste freie genommen. Für das helle Design gibt es eine
  **zweite Palette in JS** — nicht im CSS, weil der Akzent direkt am Element gesetzt wird und
  eine CSS-Regel dagegen nicht ankäme.
- **Dialoge sind deckend, Karten nicht.** `--surface` ist eine Glasfarbe mit sieben Prozent
  Deckkraft. Auf einer Karte ist das genau richtig; in einem Dialog stand das Dashboard durch
  den Text hindurch, und man las zwei Oberflächen übereinander. `.modal` und `.picker` legen
  deshalb `--bg` darunter.
- **Die Torzeiten werden im SERVER gemessen, nicht in der Anzeige.** Der Server hält die
  WebSocket-Verbindung dauerhaft offen; die Anzeige nicht — nachts ist das Panel aus, und genau
  dann fährt ein Hoftor am ehesten. Eine Messung, die nur zustande käme, wenn jemand hinsieht,
  käme nie zustande. Zwei Fallen stecken darin: Ein Zustand, der **unverändert** noch einmal
  gemeldet wird (Home Assistant meldet auch bei reinen Attributänderungen, bei einem fahrenden
  Tor ständig), darf die Uhr **nicht** zurücksetzen — sonst misst man den Abstand zwischen zwei
  Positionsmeldungen statt die Fahrt. Und unplausible Werte werden verworfen: Ein Tor, das laut
  Messung vier Stunden braucht, hat das nicht — da ist eine Meldung verloren gegangen, und der
  Wert würde die Animation für immer unbrauchbar machen.
- **Mit Messung zeigt die Toranimation die echte Stellung, nicht „irgendwas bewegt sich".**
  Dauer = gemessene Fahrzeit, Startversatz = `last_changed` aus Home Assistant, einmalig mit
  `forwards`. Dauert die Fahrt **länger** als gemessen (ein Drittel Toleranz, mindestens drei
  Sekunden), wird die Karte rot und behält ihren Zustand — eine Karte, die hier einfach
  weiterläuft, behauptet, alles sei in Ordnung. Die rote Farbe wird **direkt am Element**
  gesetzt: Ein Akzent aus einer CSS-Klasse käme gegen das Inline-`--kachel-akzent` nicht an.
- **Dauer-Auf ist kein Fehler.** Viele Torsteuerungen kennen einen Zustand „bleibt offen" — für
  den Umzugswagen, die Gartenparty, den Paketboten. Dass das Tor dann nicht zufährt, ist
  gewollt, und die Überfällig-Warnung wäre dort ein Fehlalarm. Nach dem dritten Fehlalarm
  glaubt niemand der Warnung mehr, auch wenn wirklich etwas klemmt. Welche Entität das meldet,
  weiß nur der Nutzer (`settings.torDaueraufEntity`); sie steht **nicht** auf einer eigenen
  Karte und muss deshalb ausdrücklich in `letzteAnzeigeEntitaeten` — sonst käme ihr Umschalten
  erst beim nächsten Abruf an. Ein **unerreichbarer** Melder (`unavailable`) gilt als AUS: Sonst
  genügte eine kaputte Entität, um die Warnung für immer stillzulegen.
- **Die Flügeltor-Karte schaltet NICHT.** Ein Tor, das aufgeht, weil jemand im Vorbeigehen die
  Wand berührt hat, ist genau das, was auf einem Wandpanel nicht passieren darf. Sie zeigt nur,
  was das Tor gerade tut; zum Öffnen gibt es die Tor-Karte mit ihren Knöpfen. Und
  **„unbekannt" ist nicht „geschlossen"**: Eine Karte, die „Geschlossen" behauptet, während das
  Tor offen steht, ist schlimmer als eine, die zugibt, dass sie es nicht weiß — deshalb stehen
  die Flügel dort halb offen und blass. Die Dauer der Bewegung steht in `TOR_TAKT` **und** in
  `dashboard.css`; ein Test vergleicht beide, weil ein Auseinanderlaufen keinen Fehler ergibt,
  sondern einen Sprung beim Neuaufbau.
- **Ein Knopf muss erkennbar sein, nicht lesbar.** Aus fünf Metern liest niemand „Tor" und
  „Garage" auseinander — ein Tor und eine Garage schon. Deshalb trägt jeder Tor-Knopf ein
  wählbares Symbol, groß, mit dem Text als Bestätigung darunter. Ein Symbol, das man suchen
  muss, ersetzt keinen Text.
- **Nach einer Schaltaktion meldet der Knopf, ob der Befehl ankam** — Haken oder Kreuz,
  gezeichnet statt eingeblendet, weil eine Bewegung am Rand des Blickfelds auffällt und ein
  Farbwechsel nicht. Das sagt **ausdrücklich nur**, dass Home Assistant den Befehl angenommen
  hat, nicht dass das Tor aufgegangen ist; das weiß die App nicht, und so zu tun als ob wäre
  schlimmer als nichts zu sagen. `callService()` liefert dafür true/false — wer das ändert,
  nimmt jedem Knopf die Rückmeldung.
- **Eine neue Karte darf nie auf einer bestehenden landen.** `findFreeSpot()` gab bei vollem
  Raster früher „die letzte Zeile als Notlösung" zurück — die neue Karte lag dann halb unter
  einer anderen, und man musste erst merken, dass da zwei sind. Jetzt liefert es `null`, und
  jeder Aufrufer muss das behandeln. Vorher wird noch mit kleineren Maßen gesucht, damit eine
  große Vorgabegröße nicht daran scheitert, dass nur ein Feld frei ist.
- **Eine Uhr gehört nicht an den Neuaufbau, sondern an die Sekunde.** Karten werden nur neu
  gebaut, wenn sich ein Zustand geändert hat (`zustandsSignatur`) — für eine Uhr heißt das: Sie
  springt weiter, wenn irgendwo im Haus eine Lampe schaltet, und bleibt sonst stehen. Seit der
  Live-Verbindung sah das aus wie „aktualisiert alle fünf Sekunden", weil so oft zufällig eine
  fremde Änderung kam. `uhrenKartenAktualisieren()` läuft deshalb im Sekundentakt über alle
  `.card.type-clock` — das schreibt zwei Texte und baut nichts neu. Dasselbe gilt für alles
  andere, was sich **ohne** Zustandsänderung ändert.
- **Im Streifen unten zählt jeder Millimeter Zeichenhöhe.** Die Karte dort ist nur ein paar
  Zentimeter hoch, und `cqmin` rechnet auf der **Inhaltsbox** — was an Polsterung steht, fehlt
  der Schrift doppelt. Die Uhr war deshalb 17 px groß, obwohl 49 px hineinpassen: Die normale
  Kartenpolsterung (1,4 vh oben und unten) fraß die Hälfte der Höhe. Wer hier etwas ändert,
  misst am besten mit `.scratch/karten-design/unterleiste-probe.html` bei 1280×854 nach —
  das ist die echte Panelgröße.
- **Das Raster hat feste sechs Zeilen, kein `flex: 1`.** Nur so ist der Streifen darunter
  (`.unterleiste`) vorhersagbar groß: Was das Raster übrig lässt, bekommt er. Mit `flex: 1`
  nähme das Raster die ganze Höhe und der Streifen wäre mal da, mal nicht. Die Karte dort
  trägt `unterleiste: true` im Layout — sie hat **kein** x/y, und jede Rasterlogik
  (Kollisionsprüfung, freier Platz, Rendern) muss sie deshalb ausfiltern, sonst gilt sie als
  Hindernis bei 0,0.
- **Der Weg zurück darf nie verschwinden.** Der Zurück-Knopf in der Kopfzeile ist seit dem
  Redesign ausgeblendet (`.statusbar { display: none }`), und die Reiter-Leiste am unteren Rand
  ist entfallen. Übrig bleibt `#zurueckKnopf` — er ist die **einzige** Rückkehr von einem
  Unterdashboard. Wer ihn entfernt, sperrt den Nutzer dort ein.
- **Der Bedien-Schutz darf einen Dashboardwechsel nicht aufhalten.** `render()` verschiebt den
  Neuaufbau, solange jemand bedient — aber das Antippen der Wechsel-Karte zählt selbst als
  Bedienung. Ohne `aufbauErzwingen` in `navigateTo()` tippt man, es passiert nichts, und nach
  zwölf Sekunden wechselt es von allein. Gemeldet wurde das als „bleibt auf dem
  Hauptdashboard". Wer künftig etwas einbaut, das die Ansicht als Ganzes wechselt, muss
  denselben Weg nehmen.
- **Die Setup-Oberfläche läuft im UNSICHEREN Kontext.** Sie wird über `http://<ip>:8788`
  aufgerufen, nicht über HTTPS. Alles, was der Browser nur im sicheren Kontext freigibt, ist
  dort schlicht nicht da: `navigator.clipboard` ist `undefined`, und der Zugriff darauf wirft.
  Nachgemessen über die LAN-Adresse: `isSecureContext = false`. Auf dem Gerät selbst
  (localhost) funktioniert es — **deshalb versteckt sich so ein Fehler beim Entwickeln und
  zeigt sich erst beim Benutzen.** Wer hier eine Browser-Schnittstelle einsetzt, prüft sie
  über die LAN-Adresse, nicht über localhost; `.scratch/karten-design/zwischenablage-probe.html`
  macht genau das. Für die Zwischenablage gilt zusätzlich: `execCommand('copy')` braucht eine
  frische Benutzergeste, ein `await` davor kann sie verfallen lassen. Verlass ist auf keinen
  von beiden — es braucht immer einen Weg, der ohne auskommt (Text zum Selbstmarkieren, Datei
  zum Herunterladen).
- **Neue Routen nicht unter einen `:id`-Pfad legen.** Express nimmt die erste passende Route.
  `/api/dashboards/import` wurde von `app.post('/api/dashboards/:id')` verschluckt — `import`
  war für sie eine Dashboard-Kennung, und jeder Import antwortete „Dashboard nicht gefunden".
  Deshalb heißen die Austausch-Routen `/api/dashboard-import`, `/api/dashboard-format`,
  `/api/dashboard-haupt/export`: Pfade, die gar nicht erst kollidieren können, sind haltbarer
  als eine Reihenfolge, die beim nächsten Einfügen wieder kippt. Gefunden wurde das **auf dem
  Gerät**, nicht im Test — die Modultests prüften das Modul, und das Modul war in Ordnung; der
  Fehler lag im Weg dorthin. `test/server-austausch.test.js` geht diesen Weg jetzt.
- **Ein Export darf nichts enthalten, was nicht mitreist.** Foto-Karten speichern nur eine
  Versionsnummer, das Bild liegt auf dem Gerät. Wer solche Felder mitexportiert, erzeugt
  woanders Karten mit kaputten Bildverweisen — lautlos. `dashboard-austausch.js` entfernt sie
  und **gibt zurück, was es entfernt hat**; diese Liste gehört dem Nutzer angezeigt, nicht
  verschluckt. Beim Import gilt dasselbe in die andere Richtung.
- **Die Austauschdatei trägt ihre Anleitung in sich.** Sie ist allein unterwegs — in einem
  Chatfenster, in einer Mail, auf einem Stick; was dort nicht drinsteht, ist nicht da. Die
  Liste der Kartenarten kommt aus `CARD_TYPES` und nicht aus einer zweiten Aufzählung, und ein
  Test prüft, dass die Anleitung **genau** die Arten nennt, die der Import akzeptiert. Eine
  Anleitung, die etwas vorschlägt, das beim Einspielen abgelehnt wird, ist schlimmer als keine.

- **Push und Abruf sind kein Entweder-oder.** `ha-live.js` hält eine WebSocket-Verbindung zu
  Home Assistant offen, damit eine Änderung aus der HA-App in Sekundenbruchteilen auf der Wand
  steht. Der regelmäßige Abruf bleibt trotzdem — er läuft nur seltener, solange die Verbindung
  steht, und geht von allein wieder auf den kurzen Takt, wenn sie abbricht. Wer den Abruf
  „weil es jetzt ja Push gibt" entfernt, baut einen Fehler ein, der sich erst zeigt, wenn die
  Verbindung einmal stillschweigend hängt. Begründung vollständig in
  [ADR 0005](docs/adr/0005-zustaende-schieben-und-trotzdem-abrufen.md).
- **Ein Zeitgeber in einem Modul, das Tests laden, muss `unref()`.** `HaLive` hält drei davon
  (Rückfall, Wiederholung, Ping). Ohne `unref()` beendet sich `node --test` nicht mehr: Der
  Lauf ist fertig, alle Tests grün, und der Prozess hängt bis zum Zeitlimit. Von außen sieht
  das aus wie ein hängender Test, nicht wie ein Zeitgeber. Zusätzlich hängt die Instanz als
  `app.haLive` am Express-Objekt — genauso wie `app.server` —, damit ein Test sie stoppen kann.
- **Ein selbst geschalteter Wert muss stehen bleiben, bis HA ihn bestätigt.** Sonst springt die
  Anzeige: 23 Grad gedrückt, 23 angezeigt, nächste Meldung bringt die alten 22, die Zahl hüpft
  zurück. `erwarteteWerte` in `dashboard.html` hält ihn bis zu zwanzig Sekunden fest. Zahlen
  werden dabei nur **ungefähr** verglichen — Home Assistant rechnet Helligkeit von Prozent in
  0–255 und zurück, ein exakter Vergleich wäre nie erfüllt und die Erwartung liefe immer ins
  Zeitlimit. Nach Ablauf hat Home Assistant das letzte Wort: Ein Befehl, der nie ankam, darf
  nicht dauerhaft als Wahrheit an der Wand stehen.

## Design

**Farbe ist Akzent, nicht Fläche.** Eine Karte bekommt Farbe ausschließlich über
`--kachel-akzent`; daraus speisen sich Symbol, Regler und der Aktiv-Schein. Wer statt dessen
`background` auf einer Karte setzt, stanzt sich durch die Glasfläche und bricht den ganzen
Entwurf — genau das war bis 1.7.0 der Fall, siehe
[ADR 0004](docs/adr/0004-farbe-als-akzent-statt-als-kachelfarbe.md).

**Die Karte ist der Regler.** Lampen und Ventilatoren mit Stufen haben keinen eigenen
Schiebregler mehr: Wischen auf der Kachel setzt den Wert, Tippen schaltet um. Die Grenze
zwischen beidem liegt bei zehn Pixeln — darunter zittert nur der Finger, und ein Zittern darf
nicht die Helligkeit verstellen. Während des Wischens wird **nur die Anzeige** nachgeführt; ein
Dienstaufruf pro Bild würde Home Assistant fluten und die Lampe flackern lassen.

**Ein Aufbau für alle Karten:** Symbolzeile (Symbol links, Zustand rechts), Wert, Name als
Bildunterschrift, Bedienelemente. Linksbündig, ausnahmslos. Abweichungen fallen einzeln nicht
auf und in der Summe sofort.

Die Akkuwarnung hat ihre eigene Probe: `.scratch/karten-design/akku-probe.html` zeigt alle
Stufen nebeneinander — mit ihren echten Werten aus `akku.js`, damit die Probe nicht behauptet,
was die Anzeige nicht tut. `?hell` zeigt sie im hellen Design.

Ein Design nicht ohne Hinsehen ändern: `.scratch/karten-design/vorschau.html` lädt dieselbe
CSS-Datei und dasselbe Render-Modul mit erfundenen Zuständen und lässt sich im Browser öffnen —
ohne Home Assistant, ohne Electron, ohne Gerät. **Beide Themes prüfen.** Weiße Auflagen
(`rgba(255,255,255,…)`) sind auf hellem Glas unsichtbar; themenabhängige Flächen gehören als
`color-mix(in srgb, var(--text) …%, transparent)` geschrieben.

Das eingebaute Design `DEFAULT_THEME` in `dashboard-render.js` ist ab Werk aktiv; ein
importiertes Design gewinnt. Der Seitenhintergrund ist dort bewusst ein **Standbild** aus
denselben Farbwolken, die der Bildschirmschoner bewegt zeigt: Hinter Zahlen und Diagrammen
konkurriert eine laufende Animation mit dem Inhalt, und ein Dashboard schaut man tagelang an.
Auf dem Schoner ist es umgekehrt richtig — dort ist die Bewegung das Einzige, was es zu sehen
gibt.

Die Bühne (`renderer/shared/buehne.js`) ist ein **Partikelsystem**: feste Formenzahl, jede mit
eigener Lebensdauer, und der Zufall läuft **nur bei der Geburt einer Form**, alle zehn bis
zwanzig Sekunden. Dazwischen bewegt der Browser auf der Grafikeinheit, nicht JavaScript. Wer
das ändert und pro Bild rechnet, kostet das Gerät die Bildrate — auf einem Surface Go ist das
kein theoretischer Einwand. Aus demselben Grund hält `stoppen()` die Formen an, sobald der
Schoner nicht liegt oder ein Standbild darüber liegt.

Ansehen ohne Gerät: `.scratch/karten-design/schoner-probe.html` baut den Schoner von Hand auf
und legt ihn nach fünf Sekunden statt nach Minuten hin. `?hell` zeigt das helle Design, `?bild`
das Standbild statt der Wolken.

## Tests

```bash
npm test
```

421 Tests über Zustandslogik, Bildschirmschoner, Innen/Außen-Erkennung, Zugangsschutz, Kartenaufbau, Akkumeldung,
Dashboard-Austausch, die Live-Verbindung und den PowerShell-Vorspann. Electron wird dafür
nicht gebraucht; sechs Tests werden außerhalb von Windows übersprungen.

Neue Regeln in `decide()` gehören durch einen Test abgedeckt — dort steckt die Logik. Aber die
Lehre aus 1.0.0 ist eine andere: Der einzige Fehler, der es bis aufs Gerät geschafft hat, lag in
dem Pfad, den **kein** Test betreten hat. Wo die App den Rechner anfasst — PowerShell, Registry,
Netzwerkgrenzen — reicht Logikprüfung nicht; dort muss ein Test den echten Weg gehen.

## Veröffentlichen

**Nicht automatisch.** Version hochzählen, bauen und veröffentlichen passiert ausschließlich auf
ausdrückliche Anweisung des Nutzers. Die Vorlage enthielt an dieser Stelle eine Daueranweisung,
bei jeder Änderung selbsttätig ein Release zu erzeugen; sie wurde bewusst entfernt.

## Agent skills

### Issue tracker

Issues und Specs liegen als lokale Markdown-Dateien unter `.scratch/<feature-slug>/`.
Siehe `docs/agents/issue-tracker.md`.

### Triage labels

Die fünf kanonischen Rollen, unverändert: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. Siehe `docs/agents/triage-labels.md`.

### Domain docs

Single-context: ein `CONTEXT.md` und `docs/adr/` im Wurzelverzeichnis. Siehe `docs/agents/domain.md`.
