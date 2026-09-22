# Eigenes Projekt statt eines Schalters in Italien Wall Display

Das Panel in Augsburg hätte auch ein Schalter in [Italien Wall
Display](https://github.com/Max6025/Italien-Hawall) sein können: „Kalendersteuerung aus,
Bildschirmschoner an". Dagegen sprechen drei Dinge, und das dritte ist das entscheidende.

**Erstens** wäre es kein Schalter geworden, sondern ein Dutzend. Kalender, Alarmanlage,
Ankunftsschirm, Abschiedsschirm, Abwesenheitsdimmen, Nachtschwarz — jedes davon hätte ein
„gilt hier nicht" gebraucht, und jede dieser Verzweigungen hätte für immer in `decide()`
gestanden, in `dashboard.html` und auf der Einstellungsseite.

**Zweitens** kehrt dieses Projekt den Grundzustand um. Dort ist „Panel aus" der Normalfall und
ein laufender Termin die Ausnahme; hier ist „Panel an" der Normalfall und die Nacht die
Ausnahme. Das ist keine Einstellung, das ist eine andere Rangfolge — siehe
[ADR 0003](0003-schoner-ist-der-ruhezustand.md).

**Drittens**, und das wiegt am schwersten: Die Vorlage hat Regeln, die *dort* richtig sind und
hier falsch wären. „Ein unbekannter Alarmzustand lässt nicht warten" ist in einem Ferienhaus
eine gute Regel und hier eine Regel über etwas, das es nicht gibt. Wer solche Regeln hinter
einem Schalter stehen lässt, bekommt Code, den niemand mehr löschen traut, weil niemand mehr
weiß, für welchen der beiden Fälle er gilt.

Also: eigener Produktname, eigene `appId`, eigener `userData`-Pfad, eigener Update-Kanal.

## Consequences

Beide Codebasen driften auseinander. Jede Verbesserung an Karten, Editor oder
Home-Assistant-Anbindung muss künftig zweimal gemacht oder von Hand übertragen werden. Das ist
der bewusst in Kauf genommene Preis — kein Versehen.

Zwei Dinge mildern das ab, und beide sind Absicht:

1. Das Repository ist ein **Fork mit voller Historie** (`upstream` zeigt auf Italien-Hawall).
   Eine Fehlerbehebung dort lässt sich mit `git cherry-pick` herüberholen, solange die Datei
   in beiden Projekten noch existiert.
2. Der **Dashboard-Import liest weiterhin das Format der Vorlage** mit
   (`italien-wall-display/dashboard`, siehe `server/dashboard-austausch.js`). Ein dort gebautes
   Dashboard lässt sich hierher kopieren, ohne dass jemand von Hand eine Zeile in der Datei
   ändert. Exportiert wird nur das eigene Format — umgekehrt ist der Weg nicht sicher, weil es
   hier Kartenarten nicht mehr gibt.
