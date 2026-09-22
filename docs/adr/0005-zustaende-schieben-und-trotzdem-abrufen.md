# Zustände schieben und trotzdem abrufen

Für die **Zustände der Entitäten** hält `server/ha-live.js` eine WebSocket-Verbindung zu Home
Assistant offen und reicht jedes `state_changed` per Server-Sent Events an die Anzeige weiter.
Der regelmäßige Abruf bleibt trotzdem bestehen — nur seltener, solange die Verbindung steht.
Bricht sie ab, geht er von allein wieder auf den kurzen Takt. Ein verpasster Anstoß wird also
nachgeholt: Die Verbindung ist die Abkürzung, nicht der Verlass. Wer den Abruf „weil es jetzt ja
Push gibt" entfernt, baut einen Fehler ein, der sich erst zeigt, wenn die WebSocket-Verbindung
einmal stillschweigend hängt — und dann friert die Wand ein, ohne dass irgendetwas nach einem
Fehler aussieht.

Gewünscht war ursprünglich „eine Integration, die dem Display sagt, es soll sich aktualisieren".
Genau das kann Home Assistant ab Werk: Die WebSocket-API liefert `state_changed` für jede
Entität, mit demselben Token, das ohnehin hinterlegt ist. Eine eigene Python-Komponente hieße
HACS oder Handinstallation und Nachziehen bei jedem HA-Update — für eine Nachricht, die es
bereits gibt. (Was eine eigene Integration *zusätzlich* könnte, wäre das Panel **in** Home
Assistant als Gerät sichtbar zu machen. Das ist ein anderes Feature.)

Die zweite Hälfte der Entscheidung steht im Renderer: Ein selbst geschalteter Wert wird bis zu
zwanzig Sekunden **festgehalten**, bis Home Assistant denselben Wert meldet (`erwarteteWerte` in
`renderer/dashboard.html`). Ohne das springt die Anzeige — man drückt auf 23 Grad, die Karte
zeigt 23, die nächste Meldung bringt noch die alten 22, und die Zahl hüpft zurück. Bei fünfzehn
Sekunden Abruftakt sah man das selten; wenn Meldungen in Sekundenbruchteilen eintreffen, sieht
man es jedes Mal. Nach Ablauf der Frist hat Home Assistant wieder das letzte Wort: Ein Befehl,
der beim Gerät nie ankam, darf nicht dauerhaft als Wahrheit auf der Wand stehen.
