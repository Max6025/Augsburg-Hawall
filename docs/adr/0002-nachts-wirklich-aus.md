# Nachts wirklich aus, kein schwarzes Bild

Die Vorlage kennt zwei Arten, nachts dunkel zu sein, und schleppt beide mit:

- **Nachtschwarz** — ein schwarzes Overlay im Renderer über einem weiter leuchtenden Panel.
  Stammt aus HA Wall Display, der Vorlage der Vorlage.
- **Nachtsperre** — das Panel wird über `SC_MONITORPOWER` wirklich abgeschaltet.

Dort laufen sie nie gleichzeitig: `isNightTime()` im Renderer gibt `false` zurück, sobald die
Kalendersteuerung eingerichtet ist. Das ist eine Sicherung gegen Flackern, und sie hat
funktioniert — aber sie bedeutet auch, dass eine von beiden Hälften immer toter Code ist,
abhängig von einer Einstellung, die woanders steht.

Hier gibt es nur noch die **Nachtsperre**. Das Overlay ist ersatzlos entfallen.

Der Grund ist nicht nur Aufräumen. Das Gerät hängt in einem Schlafbereich: Ein schwarzes Bild
auf einem eingeschalteten IPS-Panel ist im dunklen Raum immer noch eine graue Leuchtfläche,
und es zieht die ganze Nacht Strom. „Wirklich aus" ist hier die Anforderung, nicht die
Alternative.

## Consequences

**Berühren weckt, über einen Umweg.** Ein abgeschaltetes Panel bekommt keine Touch-Ereignisse
in die Anwendung — es gibt kein `resume` und kein `unlock-screen`, weil weder geschlafen noch
entsperrt wurde. Der Controller schaut deshalb auf `powerMonitor.getSystemIdleTime()`: Liegt
die letzte Eingabe weniger als drei Sekunden zurück, obwohl abgeschaltet würde, löst das eine
zweiminütige Pause aus. Das ist der einzige Weg aus der Nachtsperre heraus, der ohne Handy und
ohne Tastatur funktioniert.

**Diese Prüfung läuft nur, wenn ohnehin abgeschaltet würde.** Das Einschalten wackelt mit dem
Mauszeiger (`control/panel.js`) — als Benutzereingabe gezählt, hielte die Steuerung sich selbst
am Leben. Wer die Bedingung in `tick()` entfernt, baut genau diese Rückkopplung ein.

**Der Renderer stellt nachts nichts mehr.** `helligkeitAnpassen()` kennt nur noch einen Grund
zu dimmen: den Bildschirmschoner. Wer eine zweite Quelle hinzufügt, rechnet sie dort aus dem
Gesamtzustand aus — nicht aus dem letzten Ereignis.
