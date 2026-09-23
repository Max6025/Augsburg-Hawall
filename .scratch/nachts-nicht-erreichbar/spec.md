# Nachts nicht erreichbar

Status: Ursache benannt, Gegenmaßnahme gebaut, **am Gerät noch nicht geprüft**.
Erfasst am 2026-09-23 nach einem Ausfall in der Nacht.

## Was beobachtet wurde

Am 2026-09-23 gegen 00:41: Nachtsperre aktiv, „Gerät wach halten" angehakt, laut Nutzer am
Stromnetz. Die Einrichtungsseite unter `http://192.168.1.174:8788` lief in eine
Netzwerk-Zeitüberschreitung. Eine Berührung des Panels brachte auch nicht die zwei Minuten
Pause, die dafür vorgesehen sind. Gegenprobe aus dem LAN einige Minuten später: keine Antwort.

Auf dem Gerät lief **1.0.7** — die Taskleisten-Arbeit derselben Sitzung war zu diesem Zeitpunkt
nicht ausgeliefert und ist nicht die Ursache.

## Warum beides zusammen auftritt

Auf einem Modern-Standby-Gerät ist das **Abschalten des Bildschirms** der Auslöser für den
Standby, kein Leerlauf-Timeout. Die Messung vom 2026-09-22 sagt das schon: Connected Standby
(Kernel-Power 506) begann *in derselben Sekunde*, in der die Nachtsperre das Panel abschaltete.

Während des Standby läuft nichts: kein Setup-Server, und kein Takt. Damit kann die Regel
„Berührung pausiert zwei Minuten" nicht feuern — sie lebt in `tick()`. Ein Symptom, eine
Ursache.

`ES_SYSTEM_REQUIRED` (`panel.js`) verhindert klassischen Leerlaufschlaf, nicht diesen Übergang;
`prevent-app-suspension` landet als Away Mode und wirkt hier ohnehin nicht. Vollständig in
CLAUDE.md unter „Modern Standby frisst die Anwendung".

## Was Italien-Hawall dazu hat: nichts

Nachgesehen im Upstream-Remote (`git show upstream/main:main.js`): derselbe
`prevent-app-suspension`-Aufruf, mit dem Vorbehalt „Ob es dort ausreicht, ist am Geraet zu
messen" im Kommentar. Kein `powercfg`, kein `PlatformAoAcOverride`.
`.scratch/aufwecken-und-echtes-ausschalten/spec.md` dort: „erfasst, nicht entschieden, nicht
gebaut". Augsburg hat mit `setSystemWach()` **mehr** als Italien.

**Folgerung:** Ist das Gerät in Italien nachts erreichbar und das in Augsburg nicht, liegt der
Unterschied am Gerät (Energieeinstellungen, Modern Standby ggf. dort längst abgeschaltet),
nicht am Code. Das ist am 2026-09-23 vormittags zu klären.

## Was gebaut wurde

1. `control/modernstandby.js` — `PlatformAoAcOverride = 0` setzen und nachlesen. Danach nutzt
   das Gerät klassischen S3-Schlaf. **Wirksam erst nach einem Neustart.**
2. `build/installer.nsh` — der Installer versucht es direkt, **fragt aber nie nach** (ein stilles
   Update darf nicht an einem UAC-Dialog hängen) und nimmt den Wert beim Deinstallieren zurück.
3. `main.js`, `wartungVorOrt()` — genau **eine** Rückfrage, und nur bei einer Wartung vor Ort
   (Tipp-Geste, Strg+Alt+W). Nicht über `/api/panel/wartung`: Der Dialog erscheint auf dem
   Panel.
4. `panel.js` — ein fehlgeschlagenes Wachhalten wird protokolliert; der Zustand trennt
   `systemWach` (gewünscht) von `systemWachGestellt` (wirklich angefordert).
5. `controller.js`, `schlaflueckeMessen()` — jede Taktlücke über 20 s geht ins Protokoll und in
   den Zustand. Das ist der Beweis dafür, dass das Gerät geschlafen hat; `powercfg /requests`
   verlangt erhöhte Rechte und fällt aus.

## Nachtrag 1.0.9: der klassische Schlaf-Timer

Der Nutzer hat die Anforderung am 2026-09-23 vormittags geschärft: Der Bildschirm soll
**wirklich** abschalten (ausdrücklich nicht „Helligkeit auf 0"), das Gerät soll erreichbar
bleiben, und eine Berührung soll ihn wieder anschalten.

Dabei fiel eine Lücke in 1.0.8 auf: Ohne Modern Standby greift der **klassische** Schlaf-Timer
des Energieschemas, ab Werk oft 30 Minuten. Dann ist der Webserver aus einem anderen Grund weg,
und von außen sieht es identisch aus. `modernstandby.js` setzt deshalb im selben elevierten
Schritt `standby-timeout`, `hibernate-timeout` und `monitor-timeout` auf „nie" (Netz und Akku)
und schreibt `powercfg /a` ins Protokoll, damit nachlesbar ist, welcher Schlafzustand danach
gilt.

Zwei Fallstricke dabei, beide im Code kommentiert und durch Tests abgedeckt:
Leerzeichen vor jeder cmd-Umleitung (`0>>` wäre eine Umleitung der Standardeingabe und würde
den Wert verschlucken), und die Befehle stehen in einer Datei statt im Aufruf, weil sonst
Anführungszeichen durch drei Ebenen maskiert werden müssten.

## Offen — zuerst zu klären

- [ ] **Hing das Gerät wirklich am Strom?** Auf dem Screenshot von 00:2x meldet die
      Navigationsleiste **21 %** für das Panel. Die Anzeige kann dort nur „lädt" (am Netzteil)
      oder „Akku" (nicht am Netzteil) stehen — siehe `renderer/shared/nav.js`, `zeigen()`. Ein
      Wandpanel, das seit Tagen hängt und am Netz ist, stünde bei ~100 %. 21 % und fallend passt
      eher zu einem Netzteil, das nicht lädt (Kabel, Dock, Ladebuchse). Und bei kritischem
      Akkustand versetzt Windows das Gerät in den Ruhezustand oder schaltet es ab — **das
      erklärt beide Symptome ebenso gut wie Modern Standby und ist die einfachere Erklärung.**
      Zu prüfen: Was steht jetzt in der Navigationsleiste, und was sagt `panelsteuerung.log`
      (Zeile „Akkubetrieb -- das System wird trotzdem wachgehalten")?
- [ ] `panelsteuerung.log` vom Gerät ansehen: Kam „System kann NICHT wachgehalten werden"? Kam
      „Panel-Steuerung meldet keine Bereitschaft"? Gibt es Taktlücken? (Die beiden ersten
      Meldungen gibt es erst ab der neuen Version.)
- [ ] Nach dem Update, der einmaligen Rückfrage und einem Neustart: Bleibt die
      Einrichtungsseite nachts erreichbar, bleiben Taktlücken aus, und weckt eine Berührung den
      Bildschirm? Im Protokoll steht nach der Umstellung auch die Ausgabe von `powercfg /a` --
      dort muss ein echter Standby-Zustand stehen und nicht nur „S0 Low Power Idle".
- [ ] Wenn Modern Standby aus ist und das Gerät trotzdem schläft: Als nächstes die Variante
      „Helligkeit 0 statt Panel aus" vorlegen — sie umgeht das Problem grundsätzlich, kippt aber
      ADR 0002 und gehört deshalb dem Nutzer vorgelegt.
- [ ] Nicht vergessen: Auf manchen Surface-Geräten ist S3 in der Firmware nicht verfügbar. Dann
      hat das Gerät nach dieser Umstellung **keinen** Schlafzustand mehr — für ein Wandpanel
      erwünscht, aber es ändert das Verhalten beim Zuklappen und bei leerem Akku.

## Auch in dieser Sitzung entstanden, unabhängig davon

Die Taskleiste bleibt dauerhaft ausgeblendet (`panel.js`, `setTaskleiste`), sichtbar nur über
Knopf / Tipp-Geste / Strg+Alt+W, und das Fenster verlässt dafür den Kiosk-Modus. Siehe CLAUDE.md,
„Die Taskleiste wird versteckt, nicht zugedeckt", und CONTEXT.md, „Wartung" und „Taskleiste".
