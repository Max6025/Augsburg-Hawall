# Augsburg Wall Display

Ein eigenständiges Windows-Wandpanel für Home Assistant im **Dauerbetrieb**: Das Gerät hängt in
einem bewohnten Haus und läuft durch. Im Ruhezustand liegt der Bildschirmschoner; ein Tipp holt
das Dashboard; nachts ist der physische Bildschirm wirklich abgeschaltet.

Abgeleitet von [Italien Wall Display](https://github.com/Max6025/Italien-Hawall), aber ein
eigenes Projekt — siehe [ADR 0001](docs/adr/0001-eigenes-projekt-statt-schalter.md). Die Vorlage
steuert ihre Anzeige über einen Kalender, weil dort nur zeitweise jemand ist. Hier wohnt jemand,
und das dreht fast jede Regel um.

## Language

### Anzeige

**Dashboard**:
Ein Raster aus Karten, das der Nutzer im Editor zusammenstellt. Es gibt mehrere davon; eines
ist das Hauptdashboard, weitere sind Unterdashboards.

**Bildschirmschoner**:
Der **Ruhezustand** des Geräts: eine Vollbildanzeige, die liegt, solange niemand das Panel
berührt. Ein Tipp nimmt sie weg und zeigt das Dashboard; nach einer eingestellten Frist ohne
Bedienung kommt sie zurück. Sie zeigt einen Hintergrund (Bühne oder eigenes Bild) und
wahlweise die Karten eines Unterdashboards.

Wie das Nachtschwarz der Vorlage ein **Overlay**, kein Panel aus: Das Panel leuchtet weiter,
nur gedimmt, und über das Panel entscheidet weiterhin allein `decide()`.

Die Richtung ist die häufigste Fehlerquelle beim Lesen dieses Projekts: Der Schoner ist der
Normalfall, **das Dashboard ist die Ausnahme**. In der Vorlage war es umgekehrt.
_Vermeiden_: Ruheschirm (hieß in der Vorlage etwas anderes — dort lag er nur während eines
Termins), Standby, Screensaver

**Bühne**:
Die driftenden Farbwolken, die der Bildschirmschoner ab Werk als Hintergrund zeigt. Technisch
ein Partikelsystem mit fester Formenzahl; der Zufall läuft ausschließlich bei der Geburt einer
Form. Sie ist das einzige Stück, das dieses Projekt aus dem Ankunftsschirm der Vorlage behalten
hat, und steht hier für sich (`renderer/shared/buehne.js`).
_Vermeiden_: Animation, Hintergrund (mehrdeutig — der Schoner kann auch ein Standbild zeigen)

### Bildschirmzustand

**Panel**:
Der physische Bildschirm des Geräts, inklusive Hintergrundbeleuchtung.
_Vermeiden_: Monitor, Display, Bildschirm (mehrdeutig, siehe Wall Display)

**Wall Display**:
Die Vollbild-Anwendung auf dem Panel — das, was angezeigt wird, nicht das Gerät, das anzeigt.
_Vermeiden_: App, Kiosk, Frontend

**Panel aus**:
Das Panel ist über Windows stromlos geschaltet, die Hintergrundbeleuchtung ist dunkel. In
diesem Projekt passiert das an genau einer Stelle: in der Nachtsperre.
_Vermeiden_: Standby, Schlafmodus

**Nachtsperre**:
Ein wiederkehrendes Uhrzeit-Fenster, in dem das Panel aus bleibt. Die einzige Regel in
`decide()`, die abschaltet. Eine Berührung weckt das Panel für eine begrenzte Pause; danach
legt es sich von selbst wieder hin.
_Vermeiden_: Nachtmodus (heißt in der Vorlage-Vorlage HA Wall Display etwas anderes),
Nachtschwarz (das war ein Overlay über einem weiter leuchtenden Panel — hier ersatzlos
entfallen, siehe [ADR 0002](docs/adr/0002-nachts-wirklich-aus.md))

**Dauerbetrieb**:
Der Normalfall: Es läuft keine Nachtsperre, keine Karenzzeit, keine Pause — das Panel ist an.
Was darauf zu sehen ist, entscheidet der Bildschirmschoner, nicht `decide()`.

### Schutzmechanismen

**Wächter**:
Die wiederkehrende Prüfung, die das Panel erneut abschaltet, wenn es während der Nachtsperre
durch eine Eingabe aufgeweckt wurde.
_Vermeiden_: Watchdog, Loop, Timer

**Pause**:
Ein zeitlich begrenzter Zustand, in dem der Wächter nicht abschaltet, damit das Gerät bedient
werden kann. Endet von selbst.
_Vermeiden_: Not-Aus, Override, Wartungsmodus

**Karenzzeit**:
Eine Spanne nach dem Start der Anwendung, in der nie abgeschaltet wird.

**Wartung**:
Der Ausstieg für jemanden, der **vor dem Gerät steht**: Pause *und* sichtbare Taskleiste in
einem Griff. Drei Wege führen hinein — der Knopf auf der Einstellungsseite, fünfmal schnell in
die obere linke Ecke tippen, `Strg+Alt+W`. Endet von selbst, wie die Pause.
_Vermeiden_: Wartungsmodus (klingt nach einem Zustand, den man erst wieder verlassen muss),
Not-Aus, Servicemodus

**Taskleiste**:
Die Leiste von *Windows*, nicht Teil des Wall Display. Im Normalbetrieb ist ihr Fenster
**versteckt** — nicht nur vom Kiosk-Modus zugedeckt, sondern für Windows selbst unsichtbar, und
deshalb auch durch eine Wischgeste vom Rand nicht hervorzuholen. Sichtbar wird sie nur während
einer Wartung.
_Vermeiden_: Startleiste, Statusleiste (das ist die Kopfzeile des Dashboards), Unterleiste
(das ist der Kartenstreifen am unteren Rand des Dashboards)

**Zugangscode**:
Das Geheimnis, das die Setup-Oberfläche gegen unbefugte Zugriffe aus dem lokalen Netz schützt.
_Vermeiden_: Passwort, PIN, Token (Token meint hier immer den Home-Assistant-Zugang)

### Was es hier NICHT gibt

Diese Begriffe stammen aus der Vorlage und sind in diesem Projekt ersatzlos entfallen. Sie
stehen hier, damit niemand sie versehentlich wieder einführt — und damit klar ist, dass ihr
Fehlen Absicht ist und kein Versehen:

| Begriff | Warum weg |
|---|---|
| **Kalendersteuerung**, Keyword, Treffer, Anzeigefenster, Vorlauf/Nachlauf | Hier wohnt jemand. Es gibt nichts, worauf ein Kalender das Panel einschalten müsste. |
| **Ankunftsschirm**, Abschiedsschirm, Terminankündigung | Gäste, die begrüßt und verabschiedet werden, gibt es in einem bewohnten Haus nicht. Die Bühne des Ankunftsschirms ist geblieben. |
| **Ankunft**, Verworfen | Hing am Kalender und an der Alarmanlage. |
| **Alarmanlage** (als Steuergröße), Abwesenheit | Beide Funktionen — auf Ankunft warten und bei Abwesenheit dimmen — beantworteten die Frage „ist jemand da?“. In einem bewohnten Haus ist die Antwort ja. Auch die **Alarm-Karte** ist entfallen. |
| **Nachtschwarz** | Doppelte Nachtlogik. Die Nachtsperre schaltet das Panel wirklich ab; ein Overlay daneben wäre eine zweite Stelle für dieselbe Sache. |
| **Ruheschirm** | Aufgegangen im Bildschirmschoner. Zwei Overlays für eine Aufgabe wären eines zu viel. |
