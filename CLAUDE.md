# Italien Wall Display

Wandpanel für Home Assistant unter Windows, dessen Anzeige über Kalendereinträge gesteuert wird.
Electron 31, Vanilla JS, kein Bundler, kein TypeScript.

Vorlage ist [HA Wall Display](https://github.com/Max6025/Hawall); dies ist bewusst ein eigenes
Projekt, siehe [ADR 0001](docs/adr/0001-eigenes-projekt-statt-einstellung-in-hawall.md).

## Vor dem Loslegen lesen

- [CONTEXT.md](CONTEXT.md) — das Glossar. **Panel** ist das Gerät, **Wall Display** die Anzeige;
  **Panel aus** ist echtes Abschalten, **Nachtschwarz** nur ein Overlay. Diese Unterscheidungen
  ernst nehmen, sie waren die Ursache der meisten Missverständnisse beim Entwurf.
- [docs/adr/](docs/adr/) — fünf Entscheidungen, die im Code wie Versehen aussehen und keine sind.

## Architektur

Die Steuerung liegt im **Hauptprozess** unter `control/`, nicht im Renderer. Der Wächter muss
auch laufen, wenn gerade kein Dashboard geladen ist.

| Datei | Aufgabe |
|---|---|
| `control/calendar.js` | HA-Kalender abrufen, Treffer finden, Anzeigefenster berechnen |
| `control/panel.js` | Panel per `SC_MONITORPOWER` schalten, über einen dauerhaft offenen PowerShell-Prozess |
| `control/controller.js` | Zustandsautomat; die Rangfolge steht vollständig in `decide()` |
| `control/ankunft.js` | Warten auf die Ankunft: erst Dashboard, wenn die Alarmanlage „zu Hause“ meldet |
| `renderer/shared/alarm.js` | Was die Alarmanlage über das Haus sagt: zu Hause, abwesend, unbekannt |
| `renderer/shared/mdi-pfade.js` | **Erzeugt.** Alle Material-Design-Symbole; wird nur bei Bedarf nachgeladen |
| `control/lautstaerke.js` | Systemlautstärke anheben (nur während einer Akkuwarnung, nie senken) |
| `control/hintergrund.js` | Windows-Hintergrundbild setzen — sichtbar nur, während die App nicht läuft |
| `control/torzeiten.js` | Misst beim ersten Durchlauf, wie lange ein Tor auf- und zufährt |
| `renderer/shared/akku.js` | Wie dringend die Akkuwarnung ist: Stufe, Abstand, Lautstärke, Stummschalten |
| `server/setup-server.js` | Express auf Port 8788, HA-Proxy, Zugangscode |
| `server/dashboard-austausch.js` | Dashboards als Datei aus- und eingeben; Prüfung beim Import |
| `server/ha-live.js` | Dauerverbindung zu HA; meldet jede Zustandsänderung weiter |
| `renderer/dashboard.html` | Anzeige; empfängt den Steuerungszustand per IPC, entscheidet nichts selbst. Läuft auch als **Live-Ansicht** unter `/live` im Browser |
| `renderer/shared/ankunftsschirm.js` | Ankunfts- **und** Abschiedsschirm: `sollAnzeigen()` / `sollAbschiedZeigen()` sind reine Entscheidung ohne DOM und ohne Uhr, der Rest ist Anzeige |
| `renderer/shared/dashboard-render.js` | Kartenkatalog und Rendering; enthält auch das eingebaute Design `DEFAULT_THEME` |

Die Rangfolge in `decide()` ist die einzige Stelle, an der entschieden wird, ob das Panel an
sein soll. Neue Sonderfälle gehören dorthin und nirgendwo sonst.

## Fallstricke

- **Ganztages-Termine**: Home Assistant liefert das Enddatum **ausschließend**. Ein Termin vom
  3. bis 7. Juni hat `end.date = "2026-06-08"`. Wer das übersieht, schaltet einen Tag zu früh ab.
- **Zeitzonen**: `{ date: ... }` muss als *lokale* Mitternacht gelesen werden, nicht als UTC.
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
- **Modern Standby frisst die Anwendung.** Gemessen am 2026-09-09 auf dem Surface Go: eine
  Minute nach dem Abschalten des Panels ging das *Gerät* in Connected Standby (Kernel-Power 506),
  die App war weg, der Setup-Server unerreichbar, und ein Termin in dieser Zeit blieb unbemerkt.
  Dagegen hält `keepSystemAwake()` in `main.js` eine `prevent-app-suspension`-Anforderung. Wird
  hier je etwas an der Panel-Abschaltung geändert, muss dieser Fall neu gemessen werden --
  „Panel aus" und „Gerät schläft" sehen von außen identisch aus.
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
- **Doppelte Nachtlogik**: Der alte Nachtmodus im Renderer ist deaktiviert, solange die
  Kalendersteuerung aktiv ist (`panelControlActive` in `dashboard.html`). Beide gleichzeitig
  laufen zu lassen führt zu Flackern.

- **An der Alarmanlage hängen zwei Funktionen, und sie dürfen sich nicht widersprechen.**
  „Auf Ankunft warten" (`control/ankunft.js`, Hauptprozess) und „bei Abwesenheit dimmen"
  (`dashboard.html`, Renderer) fragen dieselbe Entität dasselbe. Die Auslegung steht deshalb an
  **einer** Stelle: `renderer/shared/alarm.js` — unter `renderer/`, weil nur von dort ein
  `<script src>` hinkommt; Hauptprozess und Server holen sie sich per `require`. Die Frage hat
  **drei** Antworten, nicht zwei: zu Hause, abwesend, **unbekannt**. Wer „unbekannt" zu
  „abwesend" macht, dimmt den Bildschirm dauerhaft herunter, weil eine Entitäts-ID einen
  Tippfehler hat — und wer davorsteht, sucht den Fehler am Gerät.
- **Nacht und Abwesenheit greifen auf dieselbe Schraube zu.** Beide stellen die Helligkeit.
  Wer sie an zwei Stellen einzeln dreht, bekommt einen Bildschirm, der nach dem Ende der Nacht
  auf volle Helligkeit springt, obwohl noch niemand zu Hause ist. `helligkeitAnpassen()`
  rechnet sie deshalb aus dem **gesamten** Zustand aus, nicht aus dem letzten Ereignis.
- **Während der Abwesenheit lässt die Live-Verbindung nur die Alarmanlage durch.** Sonst wäre
  der langsamere Abruftakt wirkungslos: Jede Lampe im Haus löst weiterhin sofort einen
  Neuaufbau aus. Die Alarmanlage dagegen wird **nicht** gesammelt (kein 120-ms-Fenster) — wer
  heimkommt, soll auf einen hellen Bildschirm treffen und nicht auf einen Sammeltakt warten.
  Dafür steht sie auch dann in `letzteAnzeigeEntitaeten`, wenn sie auf keiner Karte liegt.
- **Ankunfts- und Abschiedsschirm sind Geschwister, keine Zwillinge.** Beide benutzen dieselbe
  Bühne und dieselbe Geburt einer Farbwolke — der Farb­ausschnitt hängt aber am **Objekt**
  (`tonVon`/`tonBis`), nicht an der Funktion: Ankunft nimmt den ganzen Farbkreis, Abschied nur
  den kühlen Teil (175–285°). Wer morgens an der Wand vorbeigeht, soll am Farbton erkennen, ob
  heute jemand kommt oder jemand fährt, ohne die Überschrift zu lesen.
  Drei Unterschiede sind Absicht: Der Abschiedsschirm zeigt **Karten** (ein Ankommender wird
  begrüßt und soll nichts tun, ein Abreisender hat eine Liste), er nimmt sie aus einem
  **Unterdashboard** (ein zweiter Karten-Editor wäre derselbe Editor noch einmal — und der
  zweite wäre der, den niemand pflegt), und **nur der Text links tippt ihn weg**: Die Karten
  müssen bedienbar bleiben.
  Das Ansehen auf Zuruf schlägt bei **beiden** Schirmen alles — fehlender Termin, falscher
  Tag, Uhrzeitgrenze, weggetippt, und sogar den Einschalter selbst. Wer einen Schirm ansehen
  will, hat in aller Regel gerade keinen passenden Termin laufen; sonst müsste er nicht danach
  fragen. Genau daran ist der Knopf beim Ankunftsschirm zuerst gescheitert.
  **Die beiden enden verschieden, und das ist Absicht.** Der Ankunftsschirm bekommt eine Frist
  von zehn Minuten: Man sieht ihn an, er geht wieder. Der Abschiedsschirm hat statt dessen
  einen **Schalter, der bleibt** (`abschiedTestmodus`) — er zeigt Karten, und ob die an der
  Wand taugen, sieht man nicht in zehn Minuten. Eine Frist beantwortete die Frage nur für ihren
  Anfang: Wer später hinsieht, findet den Schirm weg und weiß nicht, ob es an ihm oder an der
  Uhr lag. Solange der Schalter an ist, lässt der Schirm sich auch **nicht wegtippen** —
  er käme beim nächsten Takt von selbst wieder, und dieses Flackern sähe aus wie ein Fehler.
  Der Schalter ist der einzige Ausgang, und deshalb darf `/api/abschied/dismiss` ihn **nicht**
  anfassen.
  Weil der Schalter über eine **eigene Route** speichert, lädt die Ansicht sich dabei nicht neu
  (über `/api/config` täte sie es, und beim Ausschalten verdeckte der Neuaufbau genau das, was
  man prüfen will). Die Anzeige fragt die Konfiguration deshalb alle 30 Sekunden selbst nach —
  in **beide** Richtungen: Ohne das Nachfragen während des Testmodus bekäme sie das Ausschalten
  nie mit, und der Schirm stünde bis zum nächsten Neustart.
  Er erscheint **nur bei mehrtägigen Terminen**. Bei einem eintägigen wäre der „letzte Tag"
  derselbe wie der Ankunftstag, und das Panel verabschiedete Gäste, die gerade hereingekommen
  sind.
- **Ganztägige Termine beginnen um Mitternacht.** Ein Anzeigefenster steht damit einen halben
  Tag, bevor jemand da ist — die Wand leuchtet gegen ein leeres Haus, und der Ankunftsschirm hat
  seine Anzeigedauer aufgebraucht, bevor der erste Gast zur Tür hereinkommt. Deshalb wartet
  `control/ankunft.js` auf ein besseres Signal: Die Alarmanlage steht im Regelfall auf
  *abwesend* und wird kurz vor dem Betreten auf *zu Hause* gestellt. Drei Punkte daran sind
  nicht verhandelbar:
  1. **Ein unbekannter Zustand lässt nicht warten.** Tippfehler in der Entitäts-ID, umbenannte
     Anlage, Home Assistant nicht erreichbar — die Alternative wäre eine Wand, die nie wieder
     angeht und deren Ursache niemand sieht. Lieber einen halben Tag zu früh hell als einen
     ganzen Termin lang dunkel.
  2. **Die Ankunft gilt für das ganze Anzeigefenster**, nicht nur für den Moment. Wer tagsüber
     wegfährt und scharf stellt, soll abends nicht vor einer dunklen Wand stehen. Die Frage
     lautet „ist die Anreise passiert?“, nicht „ist gerade jemand zu Hause?“.
  3. **Der Vermerk liegt im Store, nicht nur im Speicher** — und `ankunftAktualisieren()` fasst
     ihn nicht an, solange noch kein Kalender-Abruf geglückt ist. Beim Start ist die
     Fensterliste leer, weil noch niemand gefragt hat, nicht weil kein Termin läuft; wer dort
     aufräumt, wartet nach jedem Update wieder auf eine Ankunft, die längst passiert ist.

  Direkt nach der Ankunft schlägt das Panel die **Nachtsperre** für eine einstellbare Frist
  (ab Werk eine Stunde). Wer um halb eins nachts ankommt, soll begrüßt werden und nicht vor
  einer schwarzen Wand stehen. Und der Ankunftsschirm zählt seine Anzeigedauer **ab der
  Ankunft** (`ankunftZeit` in `sollAnzeigen()`), nicht ab Terminbeginn.

- **Karten-Einstellungen leben an genau zwei Stellen.** `settingsFieldsForType()` in
  `editor.js` entscheidet, welche Felder ein Typ bekommt; `buildCard()` in
  `dashboard-render.js` liest sie. Wer eine Einstellung nur an einer der beiden Stellen
  anlegt, bekommt keinen Fehler, sondern ein Feld ohne Wirkung — genau so war
  `gauge.baseColor` über Monate tot. Die vollständige Bestandsaufnahme steht in
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
- **Der Ankunftsschirm hat einen FEST dunklen Hintergrund** (`#07070c`), unabhängig vom
  Design. Eine pauschale Hell-Regel auf `.as-text` machte die Fettschrift dort dunkel auf
  dunkel. Die Klasse trägt **Markdown-Regeln, keine Farbannahmen** — sie wird auch von der
  Ankündigungsbox benutzt, und die ist themenabhängig. Farbregeln dafür immer auf den
  Container scoped (`.notify-box .as-text …`), nie auf `.as-text` allein.
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
- **Wer etwas über allem anzeigt, muss die Stapelhöhen kennen.** Der Ankunftsschirm liegt auf
  `z-index: 9997`. Die Ankündigungs-Box lag auf 80 und war damit während jedes Termins
  vollständig zugedeckt — sie funktionierte, nur sah sie niemand. Eine Ankündigung ist die
  dringendere Nachricht und liegt jetzt auf 9998.
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
  Genau so war die Alarm-Karte zwei Versionen lang unerreichbar.
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
- **Die Alarm-Zustände gehören der Anlage, nicht der App.** `armed_home` heißt nicht überall
  dasselbe — in der einen Anlage scharf mit freiem Innenbereich, in der anderen der ganz
  normale Zustand, wenn jemand da ist. Wer Text oder Farbe fest verdrahtet, erzählt der Hälfte
  der Nutzer etwas Unwahres über ihre Sicherheit. `ALARM_ZUSTAENDE` sind deshalb nur Vorgaben;
  `alarmDarstellung()` lässt Text **und** Farbton je Karte überschreiben.
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
  „weil es jetzt ja Push gibt" entfernt, baut genau den Fehler ein, den
  [ADR 0002](docs/adr/0002-kalender-abrufen-statt-benachrichtigen.md) beschreibt. Begründung
  vollständig in [ADR 0005](docs/adr/0005-zustaende-schieben-und-trotzdem-abrufen.md).
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
denselben Farbwolken, die der Ankunftsschirm bewegt zeigt: Hinter Zahlen und Diagrammen
konkurriert eine laufende Animation mit dem Inhalt, und ein Dashboard schaut man tagelang an.

Bei der Animation im Ankunftsschirm läuft der Zufall **nur bei der Geburt einer Form**, alle
zehn bis zwanzig Sekunden. Dazwischen bewegt der Browser auf der Grafikeinheit, nicht
JavaScript. Wer das ändert und pro Bild rechnet, kostet das Gerät die Bildrate.

## Tests

```bash
npm test
```

404 Tests über Kalenderauswertung, Zustandslogik, Ankunftserkennung, Zugangsschutz,
Kartenaufbau, Ankunftsschirm, Akkumeldung, die Live-Verbindung und den PowerShell-Vorspann.
Electron wird dafür nicht gebraucht.

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
