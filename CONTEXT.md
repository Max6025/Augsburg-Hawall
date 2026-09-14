# Italien Wall Display

Ein eigenständiges Windows-Wandpanel für Home Assistant, dessen Anzeige von Kalendereinträgen
gesteuert wird: läuft ein passender Termin, zeigt das Gerät ein Dashboard; läuft keiner, ist der
physische Bildschirm abgeschaltet. Abgeleitet von HA Wall Display, aber ein eigenes Projekt.

## Language

### Kalendersteuerung

**Keyword**:
Ein vom Nutzer eingegebener Suchbegriff. Mehrere Keywords werden kommagetrennt hinterlegt.

**Treffer**:
Ein Kalendereintrag, dessen Titel eines der Keywords enthält (Groß-/Kleinschreibung irrelevant).
Die Beschreibung eines Eintrags wird nie durchsucht.
_Vermeiden_: Match, Fund, Ereignis

**Anzeigefenster**:
Der Zeitraum, in dem der Bildschirm wegen eines Treffers an sein soll: Start und Ende des
Treffers, verschoben um Vorlauf und Nachlauf. Ein Ganztages-Treffer ergibt ein Anzeigefenster
von Mitternacht bis Mitternacht.
_Vermeiden_: Zeitfenster, Termin, Slot

**Vorlauf / Nachlauf**:
Zwei einstellbare Minutenwerte, die das Anzeigefenster nach vorne bzw. hinten verlängern.
Standardwert ist jeweils 0.

### Anzeige

**Dashboard**:
Ein Raster aus Karten, das der Nutzer im Editor zusammenstellt. Es gibt mehrere davon; eines
ist das Hauptdashboard, weitere sind Unterdashboards.

**Ankunftsschirm**:
Eine Vollbildanzeige, die zu Beginn eines Anzeigefensters vor dem Dashboard erscheint und einen
ankommenden Gast begrüßt. Sie ist ausdrücklich kein Dashboard: kein Kartenraster, sondern
Hintergrundbewegung, Überschrift, Text und ein Bild. Sie verschwindet durch Berührung oder nach
einer eingestellten Dauer und kommt erst beim nächsten Anzeigefenster wieder.
_Vermeiden_: Willkommensbildschirm, Splashscreen, Startbildschirm, Begrüßungsdashboard

**Verworfen**:
Der Zustand eines Ankunftsschirms, den jemand weggetippt hat. Gilt für das laufende
Anzeigefenster und überdauert einen Neustart der Anwendung.

**Ankunft**:
Der Zeitpunkt, zu dem die Alarmanlage während eines laufenden Anzeigefensters zum ersten Mal
„zu Hause“ meldet. Sie wird je Anzeigefenster genau einmal erkannt und danach nicht mehr
widerrufen — auch dann nicht, wenn die Anlage später wieder scharf gestellt wird. Bis zur
Ankunft bleibt das Panel aus, obwohl das Anzeigefenster läuft.
_Vermeiden_: Anwesenheit, Präsenz (beides beschreibt einen fortlaufenden Zustand, die Ankunft
ist ein einmaliges Ereignis)

### Bildschirmzustand

**Panel**:
Der physische Bildschirm des Geräts, inklusive Hintergrundbeleuchtung.
_Vermeiden_: Monitor, Display, Bildschirm (mehrdeutig, siehe Wall Display)

**Wall Display**:
Die Vollbild-Anwendung auf dem Panel — das, was angezeigt wird, nicht das Gerät, das anzeigt.
_Vermeiden_: App, Kiosk, Frontend

**Panel aus**:
Das Panel ist über Windows stromlos geschaltet, die Hintergrundbeleuchtung ist dunkel.
Abzugrenzen vom Nachtschwarz.
_Vermeiden_: Standby, Schlafmodus

**Nachtschwarz**:
Der Zustand aus HA Wall Display, bei dem ein schwarzes Overlay über dem Wall Display liegt und
die Helligkeit abgesenkt ist, das Panel aber weiter leuchtet. In diesem Projekt ausdrücklich
kein Ersatz für Panel aus.

**Nachtsperre**:
Ein wiederkehrendes Uhrzeit-Fenster, in dem das Panel aus bleibt, auch wenn ein Anzeigefenster
läuft. Hat Vorrang vor der Kalendersteuerung — mit genau einer Ausnahme: kurz nach einer
Ankunft. Wer nachts ankommt, soll begrüßt werden.
_Vermeiden_: Nachtmodus (heißt in HA Wall Display etwas anderes)

**Ruheschirm**:
Ein fast schwarzes Overlay mit einer großen Aufforderung („Zum Anzeigen tippen"), das während
eines Anzeigefensters über dem Wall Display liegt, wenn eine Weile niemand das Panel berührt
hat. Ein Tipp nimmt ihn weg. Wie das Nachtschwarz ein **Overlay**, kein Panel aus: Das Panel
leuchtet weiter, nur gedimmt, und die Steuerung entscheidet über das Panel weiterhin allein.
Er greift ausschließlich **während** eines Anzeigefensters — außerhalb ist das Panel ohnehin
aus, und ein zweiter Schalter für dieselbe Sache widerspräche dem ersten irgendwann.
_Vermeiden_: Bildschirmschoner (der ist in diesem Projekt entfernt worden), Standby

### Schutzmechanismen

**Wächter**:
Die wiederkehrende Prüfung, die das Panel erneut abschaltet, wenn es außerhalb eines
Anzeigefensters durch eine Eingabe aufgeweckt wurde.
_Vermeiden_: Watchdog, Loop, Timer

**Pause**:
Ein zeitlich begrenzter Zustand, in dem der Wächter nicht abschaltet, damit das Gerät bedient
werden kann. Endet von selbst.
_Vermeiden_: Not-Aus, Override, Wartungsmodus

**Karenzzeit**:
Eine Spanne nach dem Start der Anwendung, in der nie abgeschaltet wird.

**Zugangscode**:
Das Geheimnis, das die Setup-Oberfläche gegen unbefugte Zugriffe aus dem lokalen Netz schützt.
_Vermeiden_: Passwort, PIN, Token (Token meint hier immer den Home-Assistant-Zugang)
