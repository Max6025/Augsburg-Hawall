# Der Bildschirmschoner ist der Ruhezustand, nicht die Ausnahme

Die Vorlage hat einen `Ruheschirm`: Während eines mehrtägigen Termins hält die Steuerung das
Panel durchgehend an, und wenn eine Weile niemand vorbeikommt, legt sich ein fast schwarzes
Overlay mit der Aufforderung „Zum Anzeigen tippen" darüber. Das Dashboard ist dort der
Normalfall, der Ruheschirm die Ausnahme.

Hier ist es umgekehrt:

```
Start                 -> Schoner
Tipp                  -> Dashboard
n Minuten ohne Tipp   -> Schoner
Nachtsperre           -> Panel wirklich aus
```

Der Unterschied klingt nach Geschmack und ist keiner. Ein Ferienhaus-Panel wird angeschaltet,
weil jemand kommt — da ist das Dashboard das Ziel. Ein Panel in der eigenen Wohnung hängt
vierundzwanzig Stunden an der Wand, und die allermeiste Zeit steht niemand davor. Was dann zu
sehen ist, ist die eigentliche Anzeige; das Dashboard ist das, was man sich holt.

## Consequences

**`sollSchonen()` antwortet mit JA, solange keine Bedienung bekannt ist.** Das ist die Stelle,
an der die Umkehrung im Code steht, und sie sieht aus wie ein fehlender Sonderfall. Sie ist
keiner: Nach einem Neustart — Update, Stromausfall — soll das Gerät in den Ruhezustand kommen
und nicht stundenlang ein Dashboard zeigen, das niemand angefordert hat. `letzteBedienung`
startet deshalb bei `0` und nicht bei `Date.now()`.

**Ein Ruheschirm und ein Bildschirmschoner nebeneinander wären einer zu viel.** Sie tun
dasselbe. Der Ruheschirm ist deshalb ersatzlos aufgegangen, und `Ruheschirm` steht in
CONTEXT.md auf der Vermeiden-Liste.

**Der Schoner schaltet nichts am Panel.** Er ist ein Overlay wie das Nachtschwarz der Vorlage.
Über das Panel entscheidet allein `decide()` — zwei Stellen, die dasselbe schalten,
widersprechen einander spätestens beim nächsten Sonderfall.

**Die Bedienung wird auf `pointerdown` und `keydown` gemessen, NIE auf `mousemove`.** Das
Aufwecken des Panels wackelt mit dem Mauszeiger (`control/panel.js`); als Bedienung gezählt
läge der Schoner nie wieder.

**Er läuft nur auf dem Panel** (`IM_PANEL`). In der Live-Ansicht unter `/live` würde er dem,
der von unterwegs nachsieht, genau das verdecken, wofür er die Seite geöffnet hat.

**Kein zweiter Karten-Editor.** Die Karten des Schoners kommen aus einem Unterdashboard und
bringen von dort Größe *und* Platz mit. Ein eigener Editor wäre derselbe Editor noch einmal —
und der zweite wäre der, den niemand pflegt.
