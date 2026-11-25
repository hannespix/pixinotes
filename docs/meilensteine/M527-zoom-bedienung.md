# M527 — Bedienung auf dem Board in jeder Zoomstufe gleich verlässlich
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m527-zoom-bedienung.mjs` (Port 5527) · Datum: 2026-11-25

## Warum
Rückmeldung des Besitzers: „in manchen Zoomstufen verschwindet das Textformatierungs-Menü sofort, bevor man etwas
verändern kann … auch das Verschieben von Rahmen und Karten und die Auswahl etc. ist manchmal nicht ganz intuitiv …
auch dass man nicht in allen Zoomstufen Pfeilconnectoren bekommt etc. etc."

Vorgehen: ein Messskript (playwright-core gegen `dist/`) stellt den Zoom genau ein (feine Strg-Rad-Schritte wie
Kneifen am Trackpad), holt die Karte in die Bildmitte und prüft je Bedienelement: sichtbar, obenauf (`elementFromPoint`),
Größe in Bildschirm-Punkten, Wirkung des Klicks/Zugs. Stufen 15 % (Minimum, 10 % gibt es nicht), 25, 35, 50, 75, 100,
150, 200, 300 % und 600 % (Maximum), hell/dunkel, Anzeige 130 %, Karten-Fokus. Die Prüfreihe ist diese Matrix; gegen
den Build von vorher sind 40 ihrer 91 Prüfpunkte rot, jetzt alle grün.

## Gefundene Ausfälle (vorher → nachher)
| Nr | Zoom | Was der Nutzer merkte | Ursache | Stand |
|----|------|-----------------------|---------|-------|
| 1 | unter ~45 % | **Formatier-Leiste verschwindet beim Klick:** Text markiert, herausgezoomt — die Leiste steht noch (9 Bildpunkte hoch), ein Klick auf „Fett" trifft einen Anschlusspunkt der Karte, der Editor verliert die Markierung, die Leiste ist weg, nichts wurde fett. Das ist der gemeldete Fehler. | Die Leiste hing im Knoten der Karte, also in der gezoomten Fläche und im Kartenkörper, der im weiten Zoom keine Zeiger annimmt (M343); Anschlusspunkte lagen darüber. | ✅ eigene Ebene |
| 2 | alle außer 100 % | Leiste mitgezoomt: bei 50 % Knöpfe 15 Bildpunkte, bei 200 % 60, bei 300 % 1 803 Bildpunkte breit — A−, A+, Aa außerhalb des Bildes. | dieselbe | ✅ immer 604 × 36, Knöpfe 30 |
| 3 | 100 % | Aa-Menü einer Notiz mit Auto-Größe ging nach ~0,3 s wieder zu (nach Umbau 1). | Die Notiz schrumpfte, sobald der Fokus sie verließ — die Menüs liegen jetzt außerhalb der Karte. | ✅ |
| 4 | Anzeige 130 % | Aa-Menü öffnete am rechten Bildrand statt unter seinem Knopf. | Lage im mitgezoomten Knoten falsch gerechnet. | ✅ |
| 5 | alle | **Erster Zug bzw. Doppelklick über den Text einer Notiz markierte nichts** (keine Markierung, keine Leiste), erst der zweite. Wer kurz auf der Notiz verweilt hatte, merkte nichts — daher „manchmal". | Ruhende Notiz (M338, noch ohne Editor) war nicht markierbar (`user-select: none` der Karte); der Klick weckte den Editor und setzte nur den Cursor; ProseMirror zählte den zweiten Klick des Doppelklicks als ersten. | ✅ |
| 6 | unter ~45 % | **Kein Pfeil:** Anschlusspunkte der gewählten Karte sichtbar und treffbar, der Zug daran verschob aber die Karte. | `noDragClassName` war dort abgeschaltet; React Flows Kartenzug fing den Druck ab, bevor er den Anschluss erreichte. | ✅ |
| 7 | alle | Pfeil **mitten auf der Zielkarte** losgelassen: je nach Zoom und Stelle entstand keiner (nur nahe an einem Anschlusspunkt). | Das Ganzkarten-Ziel (`pn-handle-body`) lag unter dem Kartenkörper. | ✅ |
| 8 | unter ~45 % | Gewählte kleine Karte: Anschlusspunkte (22 px) und Größen-Kanten (10 px) deckten den Großteil der Karte zu — bei 15 % blieben von 24 px Höhe 4 zum Verschieben; der Zug zog oft die Größe. | Griffe mittig auf der Kante. | ✅ vor der Kante |
| 9 | unter 100 % | **Verbindung kaum zu treffen:** 6 Bildpunkte neben der Linie verfehlt bei 50 %, 25 %. Bei 300 % war die Klickzone 60 Bildpunkte breit. | Klickzone 20 Flächenpunkte. | ✅ 20 Bildpunkte |
| 10 | alle außer 100 % | Knöpfe der gewählten Verbindung (Spitzen, Stärke, Farbe) bei 25 % winzig, bei 300 % 57 Bildpunkte. | mitgezoomt | ✅ 19–29 |
| 11 | unter 100 % | **Rahmen schwer zu greifen:** sein einziger Griff, der Titel, war bei 25 % 7, bei 15 % 4 Bildpunkte hoch; bei 300 % 78. | mitgezoomt | ✅ 26 (bis 39 bei 300 %) |
| 12 | alle außer 100 % | Drehknopf bei 25 % 5 Bildpunkte groß und auf der Größen-Ecke, bei 300 % 66. | mitgezoomt | ✅ |

Ohne Befund (in jeder Stufe gleich): Karten-Griff (46 × 17), Anschlusspunkte (22, über 250 % gedeckelt), Größen-Ecken
(10), Karten-Leiste (`SelectionToolbar`), Rahmen innen ziehen = Board schwenken, Karte im Rahmen ziehen, Rahmentitel ziehen
= Rahmen samt Inhalt, Ziehen an freier Kartenstelle = Karte, Karten-Fokus, dunkel.

## Die Regel: was ein Klick oder Zug wo tut
- **Auf der freien Fläche** (auch im Inneren eines Rahmens): Ziehen schwenkt das Board, Klick hebt die Auswahl auf.
- **Auf einer Karte, normaler Zoom (ab ~45 %):** am Griff oben oder auf freier Kartenfläche ziehen = Karte verschieben;
  im Text ziehen oder doppelklicken = Text markieren (gleich beim ersten Mal), die Karte ist dabei gewählt;
  Klick in den Text = Cursor setzen.
- **Auf einer Karte, weit herausgezoomt (unter ~45 %):** Text ist dort nicht lesbar — die ganze Karte ist der Griff,
  egal ob gewählt. Anschlusspunkte und Größen-Griffe zeigt nur die gewählte Karte, und zwar **vor** ihrer Kante.
- **Pfeil:** vom Anschlusspunkt (＋) ziehen und irgendwo auf der Zielkarte loslassen — in jeder Zoomstufe. Im weiten
  Zoom erst die Karte wählen (Klick), dann ziehen.
- **Rahmen:** am Titel ziehen = Rahmen samt Inhalt; der Titel ist in jeder Zoomstufe gleich groß.
- **Bedienelemente** (Leisten, Griffe, Knöpfe, Klickzonen) haben in jeder Zoomstufe dieselbe Bildschirm-Größe; Inhalt
  (Text, Beschriftung einer Verbindung) zoomt mit.

## Wie (Architektur)
- `src/components/NoteTypo.tsx`: `NoteToolbar({ aufDemBoard })` gibt `FormattingToolbarController` ein `portalElement`:
  die gemeinsame Ebene `formatSchicht()` (`div.pn-format-schicht.nokey` am `body`, einmal angelegt). BlockNote legt dort
  über `PortalElementOverride` eine eigene thematisierte, beim Editor registrierte Wurzel an (Fokus darin zählt als „im
  Editor", Dunkelmodus über `.bn-mantine`). `NoteCard` und `MinutesCard` geben `aufDemBoard`; die Präsentation (`Presenter`,
  z-index 95) bleibt beim alten Weg. Telefon unverändert (`PhoneFormatDock`).
- `src/styles/54-schrift-gehirn-handy.css`: `.pn-format-schicht` fest, z-index 70 (über Karten, Karten-Leiste, Fokus-Kopf
  60; unter Dialogen 80); `zoom: var(--pn-gegen)` nimmt die Anzeige-Größe heraus (floating-ui rechnet in Bildschirm-Punkten),
  `.bn-formatting-toolbar { zoom: var(--pn-anz) }` holt sie für die Leiste zurück.
- `src/components/nodes/CardShell.tsx` (Auto-Größe): Schrumpfen auch nicht, solange der Fokus in `.pn-format-schicht` liegt.
- `src/components/nodes/NoteCard.tsx`: `auswahlPunkte(el)` (Bildschirmstellen von Anfang/Ende einer Markierung in der
  ruhenden Ansicht), `textStelle(x, y)`, `wortWaehlen(el, x, y)`; `StartPunkt` hat `bis`. Die ruhende Notiz weckt per
  Klick (wählt dabei die Karte) bzw. per Loslassen außerhalb (`pointerup` am Fenster, nur mit Markierung); der Editor
  setzt die Markierung aus `startPunkt.bis`. Doppelklick auf eine eben geweckte Notiz: `onDoubleClick` am Editor wählt das
  Wort, wenn die Auswahl danach leer ist. `10-karten-grundlagen.css`: `.notiz-ruhend .bn-editor { user-select: text }`
  (nur Maus).
- `src/components/Board.tsx`: `noDragClassName` im weiten Zoom `react-flow__handle` (statt aus).
- `src/styles/62-greifen-tastatur-teilen.css`: `[data-weit]` schiebt `.pn-handle` und die Größen-Linien per `translate`
  um eine halbe Breite nach außen, die Ecken (React Flow skaliert sie per `scale`) um `--pn-eck` = 5 (Finger 8) × `--pn-inv`;
  `.react-flow__edge-interaction { stroke-width: calc(20px * var(--pn-inv)) }`; `.edge-opts` Abstände × `--pn-inv`,
  `.edge-opts-row { zoom: var(--pn-inv) }`.
- `src/styles/40-verbinden-attribute.css`: `.pn-handle-body` während des Verbindens `z-index: 3` (über dem Kartenkörper).
- `src/styles/30-zeichnen-rahmen-zeit.css`: `.frame-head { scale: var(--pn-inv); transform-origin: 0 100% }`, Breite
  geteilt durch `--pn-inv` (Name kürzt sich auf die Rahmenbreite); im Export (`data-alles-zeigen`) ohne.
- `src/styles/68-vorlagen-folien-datentabelle.css`: `.dreh-knopf` mit `scale: var(--pn-inv)` um seine äußere Ecke,
  Abstand × `--pn-inv`.
- Angepasst: `pruefungen/m267-typo.mjs` T6b misst den Überstand gegen die Notiz, deren Text markiert ist (die Leiste liegt
  nicht mehr in ihr) — Prüfinhalt unverändert.

## Grenzen / offen
- **Weit herausgezoomt zeigen Karten unter dem Zeiger weiter keine Anschlusspunkte** (erst wählen, dann ziehen — Regel
  aus M343, damit ein Zug über dicht stehende Karten nicht ständig einen Pfeil beginnt). Sollen sie dort schon beim
  Zeigen erscheinen? Braucht eine Entscheidung.
- Finger (Tablet/Telefon): Ein Tipp öffnet dort den Fokus (M212); Verbinden am Finger auf dem Board wurde nicht neu
  untersucht. Die Finger-Größen der Griffe (28 / 16) gelten wie bisher in jeder Zoomstufe.
- Rahmen größer als der Bildschirm (stark hineingezoomt): Der Titel liegt dann außerhalb des Bildes, der Rahmen lässt sich
  erst nach dem Herauszoomen verschieben (wie in Miro).
- Nebenbefund (Prüfumgebung): Ein großer waagerechter Rad-Ausschlag über der Werkzeugleiste unten nimmt Chromium als
  „Zurück"-Wisch und verlässt die Seite. Am Mac-Trackpad könnte das ein echtes Ärgernis sein (Wisch über der Leiste) —
  nicht untersucht.
