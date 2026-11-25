# M521 — Audit Board und Präsentation: vierzehn Fehler behoben
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m521-audit-board.mjs` (Port 5521) · Datum: 2026-11-24

## Warum
Teil des großen Bugfixing-Audits (M518–M523, Auftrag: „Prüfe das gesamte Tool auf Logikfehler und UI-Fehler"). Bereich
hier: die Board-Fläche und alles, was an ihr hängt — Ziehen, Rahmen, Verbindungen, Auswahl, Löschen, Rückgängig,
Zeichnen, Tastenkürzel, Zoom, Präsentation, Rahmen-Reise (M514), „Oberfläche ausblenden" (M510).

Vorgehen: Quelltext gelesen (`Board.tsx`, `boardTasten.ts`, `Tastatur.tsx`, `store/karten|kanten|verlauf|zeichnen`,
`kartenFolge.ts`, `rahmenReise.ts`, `RahmenReise.tsx`, `nurBoard.tsx`, `FrameCard.tsx`) und den gebauten Stand mit
playwright-core durchgespielt: zwölf Erkundungs-Läufe (Maus, Tastatur, Finger per CDP, 224 Karten in vier Rahmen,
hell/dunkel), dabei Seitenfehler, Konsolen-Warnungen und Bildschirmfotos mitgeschrieben. Jeder Befund unten ist
nachgestellt; jeder Fix hat einen Prüfpunkt, der vor dem Fix rot war (gemessen gegen den Build von vorher) und jetzt
grün ist.

## Befunde
| Nr | Schwere | Was der Nutzer merkte | Ursache | Stand |
|----|---------|-----------------------|---------|-------|
| B1 | mittel | Ein **gewählter Rahmen** ließ sich im weiten Zoom nicht mehr am Titel verschieben: Der Zug zog die Oberkante (Rahmen wurde größer/kleiner), der Inhalt blieb liegen. Weil ein Zug den Rahmen wählt, traf es jeden zweiten Zug. Unter ~20 % Zoom ganz, bis ~35 % auf der unteren Titelhälfte; am Finger (dickere Linie) schon bei 33 %. | Die Anfass-Linie der Größe (10/16 Bildpunkte, mittig auf der Oberkante, `z-index: 4`) lag über dem Titel (ohne z-index) — der Titel ist der einzige Griff des Rahmens. M514 hatte das nur für den Doppelklick umschifft. | ✅ `.frame-head { z-index: 5 }`, Eck-Griffe und Anschlusspunkte des Rahmens darüber (6) — `30-zeichnen-rahmen-zeit.css` |
| B2 | mittel | Der **Radierer** wirkte auf begradigte Linien und eingerastete Formen nur an den Enden bzw. Ecken — quer über die Mitte einer Linie gewischt passierte nichts. | Beide Radierer (`eraseStrokesPartial`, `eraseStrokesNear`) prüften nur die Stützpunkte; eine begradigte Linie hat zwei, ein Rechteck fünf. | ✅ `radiert()` in `store/zeichnen.ts` prüft die Strecke zwischen den Punkten |
| B3 | mittel | **Rahmen-Reise:** Wer mittendrin die Aufgaben-Zentrale, die Präsentation oder die Übersicht aufmachte (oder im Notiztext Strg+Z drückte), landete nach Esc bei 0/0 und 100 % statt am Ausschnitt von vorher; „Oberfläche ausblenden" von vor der Reise war danach aus. | Ansicht und Modus von vorher lagen in einem `useRef` des Bauteils — das Board (und mit ihm das Bauteil) wird in diesen Fällen neu eingehängt und merkte sich die Ansicht des frisch aufgebauten Boards. | ✅ am Modul gemerkt (`vorReise` in `RahmenReise.tsx`), Aufräumen nur, wenn die Reise wirklich endet |
| B4 | mittel | **Pfeiltasten am gewählten Rahmen** schoben nur den Rahmen — der Inhalt blieb liegen, und Strg+Z nahm den Schritt nicht zurück (sondern den davor). Rahmen + Karte gewählt: Der Rahmen blieb liegen. | `boardTasten.ts` kennt in `gewaehlt` keine Rahmen (Tab springt nur von Karte zu Karte); `verschiebeUm` (M390) bekam die Rahmen deshalb nie zu sehen, bei „nur Rahmen" schob die Bibliothek selbst. | ✅ die Pfeiltasten nehmen alle gewählten Karten **und** Rahmen (`schiebbar`) |
| B5 | mittel | **Im Karten-Fokus** legte `N` eine Notiz hinter der offenen Karte an (unsichtbar, der Schreib-Cursor wanderte hinein); `Strg+A` wählte das ganze Board dahinter — `Entf` oder `Strg+D` trafen danach alle Karten. | Die Tasten der Fläche prüften den Fokus nicht (`Board.tsx` N, `Tastatur.tsx` Strg+A). | ✅ beide tun im Fokus nichts |
| B6 | mittel | **Reihenfolge:** Ein leerer Rahmen stand vor allem in seiner Zeile — bei drei Rahmen nebeneinander begann die Rahmen-Reise beim leeren in der Mitte, die Präsentation zeigte einen leeren Rahmen rechts vor der Karte links. | `kartenFolge`: „vor der ersten Karte, die unter ihrer Oberkante beginnt" verglich nur die Höhe. | ✅ leere Rahmen stehen in der Lesefolge ihrer Zeile (`liegtVor`: Kopf des Rahmens gegen die Karte bzw. den Kopf ihres Rahmens) |
| B7 | niedrig | **Strg+V** legte hinter einem offenen Fenster (Karten teilen, Versionen, Vorlagen, Ticket) eine Notiz bzw. ein Bild an. | Der Einfüge-Zuhörer kannte nur fünf Fenster-Zustände. | ✅ zusätzlich `overlayOffen()` |
| B8 | niedrig | **F2** öffnete hinter Einstellungen/Hilfe/Suche das Namensfeld des gewählten Rahmens und zog den Fokus aus dem Fenster. | Der F2-Zuhörer (`FrameCard.tsx`, M514) stand nicht hinter `overlayOffen()`. | ✅ |
| B9 | niedrig | Eine Verbindung, die auf der **eigenen Karte** losgelassen wurde, entstand unsichtbar (zählte als Verbindung, kostete einen leeren Rückgängig-Schritt). | `onConnect` nahm `source === target` an; gezeichnet wird so eine Verbindung nirgends. | ✅ `store/kanten.ts` |
| B10 | niedrig | **Entf** mit Karte und (per Umschalt) mitgewählter Verbindung zwischen anderen Karten löschte nur die Karte. | `onBeforeDelete` reichte nur die Karten weiter und brach das Löschen der Bibliothek ab. | ✅ `removeNodes(ids, kantenIds)` — ein Schritt, ein Strg+Z |
| B11 | niedrig | Rahmen (mit Karte gewählt) auf ein anderes Board verschoben: **archivierte Karten** im Rahmen blieben unsichtbar auf dem alten Board. | `moveNodesToBoard` rief `frameMembers` ohne `mitArchiv` (beim Ziehen seit M390 richtig). | ✅ |
| B12 | niedrig | **Präsentation:** Der Text einer Form mit schlichtem Text (Schritt, Entscheidung — z. B. aus KI-Abläufen) stand oben statt mittig; in der Raute ragte schon ein kurzer Satz über die Form hinaus (im Dunkeln dort unlesbar). | Das Textfeld der Folie war fest 80 % hoch, Text beginnt in einem Textfeld oben. | ✅ `field-sizing: content` (mit `@supports`) — das Feld ist so hoch wie sein Text und steht in der Mitte |
| B13 | mittel | **Telefon, Doppeltipp** auf eine verkleinerte Karte: Der erste Tipp öffnete den Fokus, der zweite traf, was dann unter dem Finger lag — im Kanban wurde so ein Ticket verschoben oder eine Spalte gelöscht (Hinweis aus M520, das nur die Folge entschärft hatte). | Der Tipp, der den Fokus öffnet (`onNodeClick`), ließ alle folgenden Tipps sofort an den Inhalt der aufgehenden Karte durch. | ✅ eine halbe Sekunde lang (gemessen an der Zeit der Ereignisse) gehört kein Tipp dem Inhalt — `Board.tsx` |
| B14 | niedrig | **Auswahl-Leiste** über einer Karte am rechten oder linken Bildrand ragte aus dem Bild (am Telefon „Löschen" halb abgeschnitten; Hinweis aus M520). | Die Leiste hängt mittig an der Karte (`NodeToolbar`) — geprüft wurde nur oben/unten. | ✅ der innere Kasten rückt waagerecht ins Bild (8 Punkte Rand) — `SelectionToolbar.tsx` |

## Wie (Architektur)
- `src/styles/30-zeichnen-rahmen-zeit.css`: `.frame-head { z-index: 5 }`, `.frame-wrap > .react-flow__resize-control.handle`
  und `.frame-wrap > .pn-handle` auf 6 (Linien bleiben auf 4, `25-board-formen-mermaid.css`). Der Doppelklick-Umweg aus
  M514 in `FrameCard.tsx` (Doppelklick auf die Linie am Ort des Titels abfangen) ist damit entfallen.
- `src/store/zeichnen.ts`: `radiert(rel, ox, oy, x, y, radius)` → getroffene Punkte; liegt die Strecke zwischen zwei
  Punkten im Radius, gelten beide. Strecken kürzer als der Radius werden übersprungen (dichte Freihand-Striche wie bisher).
- `src/components/RahmenReise.tsx`: `vorReise { boardId, ansicht, nur }` und `eingehaengt` am Modul; gemerkt wird nur beim
  Beginn, das Aufräumen kehrt zurück (Ansicht, `nurBoardSetzen`) nur bei `reiseStand() === null`. Endet die Reise, während
  das Board nicht eingehängt ist, verfällt das Gemerkte (`reiseAbo`).
- `src/components/boardTasten.ts`: `schiebbar` = alle gewählten, sichtbaren Karten und Rahmen → `verschiebeUm`.
- `src/components/Board.tsx`: N nicht bei `focusCard`; Einfügen nicht bei `overlayOffen()`; `onBeforeDelete` reicht
  `edges` an `removeNodes` weiter.
- `src/components/Tastatur.tsx`: Strg+A im Karten-Fokus ohne Wirkung (Standard des Browsers bleibt unterdrückt).
- `src/lib/kartenFolge.ts`: `liegtVor(rahmen, karte)` mit `RAHMEN_KOPF` (120): gleiche Zeile (Überdeckung wie in
  `leseFolge`) → links vor rechts, sonst oben vor unten; leere Rahmen werden vor jeder Karte geprüft (nicht mehr nur der
  oberste).
- `src/components/nodes/FrameCard.tsx`: F2 hinter `overlayOffen()`.
- `src/store/kanten.ts` `onConnect`: keine Selbstverbindung. `src/store/karten.ts`: `removeNodes(ids, kantenIds?)`
  (Typ in `store/typen.ts`), `moveNodesToBoard` mit archivierten Rahmen-Mitgliedern.
- `src/styles/34-praesentation.css`: `.slide-shape-input` mit `field-sizing: content; height: auto; max-height: 80%`.
- `src/components/Board.tsx` `onNodeClick`: Öffnet der Tipp (bzw. der Klick mit „Mit einem Klick öffnen") den Fokus,
  schluckt ein Zuhörer am Fenster (Erfassungsphase) `pointerdown`/`pointerup`/`click`/`dblclick`, solange der Druck
  weniger als 500 ms nach dem öffnenden Klick kam (`timeStamp` der Ereignisse — das Aufgehen der Karte kann den Browser
  länger beschäftigen als eine Uhr misst); der erste spätere Druck hängt den Zuhörer wieder aus.
- `src/components/SelectionToolbar.tsx`: Layout-Effekt ohne Abhängigkeiten misst `.sel-toolbar` (nicht die feste Zeile
  `.sel-toolbar-dock`) und setzt `translate` am inneren Kasten, in Layout-Punkten (`wurzelZoom`).
- **Start-JS (M483/M502, Grenze 2 065 000 B):** Der Hauptzweig lag zu Beginn 163 B unter der Grenze, die Fixes kosten
  rund 1,2 KB. Dafür zwei Entlastungen: `detachStrokes` („Markierungen lösen", Kartenmenü) ruft
  `src/store/stricheLoesen.ts`, das erst beim Aufruf lädt (die Auswahl-Leiste holt es beim eigenen Laden vor — ohne
  Verzug und offline da); und der Doppelklick-Umweg aus M514 in `FrameCard.tsx` ist entfallen (der Titel liegt jetzt
  selbst über den Linien). Netto kostet M521 das Start-Paket rund 50 B. Stand nach dem Einmischen von M522 (das die
  Gestalt-Prüfung nachlädt): 2 062 462 B, 2,5 KB frei.

## Ohne Befund geprüft
Rahmen ziehen mit verschachteltem Rahmen und Karten (Rückgängig/Wiederholen exakt), Karte löschen samt Verbindungen
und Etikett (Strg+Z/Strg+Y), Rahmen löschen (Inhalt bleibt, Verbindung des Rahmens kommt zurück), Duplizieren mit
Verbindungen, Auswahlrahmen, Mehrfach-Zug, Ausrichten, Größe ziehen (Karte und Rahmen), Verbinden (doppelt gezogen
entsteht nichts Doppeltes), Zeichnen/Marker/Radieren mit je einem Rückgängig-Schritt, geankerte Striche (wandern mit,
gehen und kommen mit der Karte), 224 Karten (Alles wählen, Löschen, Rückgängig, Rahmen-Zug, Minimap, Zoom-Grenzen,
Pos1/Ende/Strg+Pfeil/Tab), Finger (Schwenken, Zwei-Finger-Zoom, Karte und Rahmen ziehen), Präsentation (leer, 1 Folie,
224 Folien, ab Karte, ab Rahmen, Pos1/Ende, hell/dunkel), Rahmen-Reise (0/1/3 Rahmen, Kreis, Rahmen fällt weg), Alt+B
(alle Wege zurück: Esc, Alt+B, Menü, Suche, Fokus).

## Grenzen / offen
- **Strg+V im Karten-Fokus** legt weiter eine Notiz bzw. ein Bild hinter der offenen Karte an (der Hinweis sagt es).
  Sperren hieße: Einfügen tut dort nichts — braucht eine Entscheidung (und einen neuen Hinweistext).
- **Duplizieren (Strg+D) nimmt Rahmen nicht mit** — Rahmen samt Inhalt gewählt ergibt Kopien der Karten ohne Rahmen.
  Wäre eine neue Funktion.
- **Rahmen allein** bietet in der Auswahl-Leiste kein „Auf anderes Board verschieben" (nur zusammen mit einer Karte).
- **Rahmen-Reise per Alt+Umschalt+P beendet, während die Aufgaben-Zentrale offen ist:** Das Board kommt danach im
  Ausschnitt des letzten Rahmens zurück (der gemerkte Ausschnitt je Board liegt in `Board.tsx`).
- In der Rahmen-Reise wirken die Tasten der Fläche weiter (gewollt: Karten bleiben bedienbar) — `F` passt dabei das
  ganze Board ein und verlässt den Rahmen-Ausschnitt, bis man blättert.
- `0` im Karten-Fokus stellt 100 % ein (die Karte ist dann nicht mehr eingepasst) — Zoomen im Fokus ist seit M363 gewollt.
- Esc schließt mit offenem Fenster **und** aktivem Stift beides (Fenster und Zeichenmodus).
- Reihenfolge an Verzweigungen der Rahmenpfeile umsortieren (offen aus M514) — neue Funktion, nicht Teil des Audits.

## Für andere Bereiche
- **Orchestrator — Start-JS-Grenze:** Zu Beginn des Audits waren auf dem Hauptzweig nur 163 B frei; nach M522 und
  M521 sind es rund 2,5 KB. Jeder Fix im Start-Paket (Board, Store, Tastatur) zählt gegen m459/m467/m483/m502 A1 —
  wer mehr braucht, lädt etwas nach, statt die Grenze anzuheben.
- **M519 (Form):** `ShapeCard.tsx` Zeile ~174 `<input type="color" value={data.color}>` — eine Form ohne `color`
  (Daten von außen, alte Stände) wirft beim Auswählen die Konsolen-Warnung „The specified value "" does not conform
  to the required format"; Vorgabe wie in `makeShape` (`#eef2ff`) einsetzen.
