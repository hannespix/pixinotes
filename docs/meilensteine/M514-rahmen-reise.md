# M514 — Rahmen für Rahmen präsentieren, direkt auf dem Board
PR: #… · Prüfreihe: `pruefungen/m514-rahmen-reise.mjs` (Port 5514) · Datum: 2026-11-24

## Warum
Nutzerwunsch: „es wäre zudem toll für meine Präsentation auf dem Whiteboard, wenn ich Rahmen für Rahmen präsentieren
könnte. Also Rahmen auch mit speziellen Rahmenpfeilen verbinden, und dann bekommt ein Rahmen bei Doppelklick auf den
Titel einen bildschirmfüllenden Rahmenfokus, und dann kann man mit typischer Weiter-Geste und Shortcuts etc. zum
nächsten Rahmen springen! Dieser wird dann automatisch so reingezoomt, dass er auch wieder bildschirmfüllend ist."

Die Präsentation (Presenter.tsx) baut Folien nach — Karte für Karte, außerhalb des Boards. Gewünscht war das Gegenteil:
auf der echten Fläche bleiben, nur die Kamera wandert von Rahmen zu Rahmen, die Karten bleiben live.

## Was
- **Rahmen-Reise:** Doppelklick auf den Titel eines Rahmens (auch: `Alt+Umschalt+P` ab dem gewählten Rahmen bzw. dem
  Rahmen der gewählten Karte, sonst dem ersten; Rahmen-Menü → „Rahmen präsentieren"). Die Kamera fährt weich hin, der
  Rahmen samt Titel füllt das Fenster mit kleinem Rand (3 % der kürzeren Seite, 12–40 px), die Oberfläche tritt
  zurück — über „Oberfläche ausblenden" (M510): Kopfleiste, Navigation, Dock, Minimap, Auswahl-Leiste, Live-Leiste,
  Griffe. War sie schon ausgeblendet (Alt+B), bleibt sie es nach der Reise; sonst kommt sie mit dem Ende zurück. Unten steht eine
  leise Leiste „‹ 3 / 8 Titel › ✕", die nach 2,5 s Ruhe verblasst (zurück mit Zeiger, Taste, Fokus).
- **Weiter:** →, Leertaste, Bild↓ (Präsentations-Klicker), Wischen nach links (Finger auf der Fläche, waagerecht über
  das Trackpad), Knopf ›. **Zurück:** ←, Umschalt+Leertaste, Bild↑, Wischen nach rechts, Knopf ‹. **Pos1/Ende:**
  erster/letzter Rahmen. **Esc** (oder ✕, oder `Alt+Umschalt+P`) beendet und stellt die Ansicht von vorher her.
- Jeder Rahmen wird eingepasst, egal welches Seitenverhältnis; ändert sich das Fenster (Drehung, Größe) oder der
  Rahmen, passt die Kamera neu ein. `prefers-reduced-motion`: kein Flug, die Leiste blendet nicht über.
- **Karten bleiben bedienbar:** Tippen in Notizen, Ideen abstimmen, Timer … Solange der Fokus in einem Feld oder
  Text liegt, gehören die Tasten dem Feld (auch Leertaste und Pfeile). Esc verlässt erst den Text, das zweite Esc die
  Reise. Eine Karte im Fokus (Doppelklick auf die Karte) hat Vorrang; nach dem Schließen steht wieder der Rahmen da.
- **Rahmenpfeile:** Eine gerichtete Verbindung von Rahmen zu Rahmen ist ein Rahmenpfeil — gestrichelt, etwas kräftiger,
  mit einer runden Marke, die die Nummer seines Ziels in der Reise trägt (Abzweig: „–"). Anlegen wie jede Verbindung
  (Verbindungspunkte am Rahmen; Hinweis beim Verbinden) oder per Rechtsklick auf den Titel → „Weiter zu Rahmen" → Ziel.
  Die Pfeile bestimmen die Reihenfolge; ohne Pfeile gilt die Kartenfolge (lib/kartenFolge.ts, wie im Vortrag).
- **Live:** Wer vorführt („Folgt mir"), nimmt den Rahmen mit; wer folgt, reist mit — derselbe Rahmen, auf dem eigenen
  Schirm eingepasst. Wie die Präsentation (M387) beginnt die Reise auf dem eigenen Board mit anderen dabei von selbst
  eine Vorführung, die mit ihr endet. Blättert ein Folgender selbst, löst er sich und reist allein weiter.
- **Umbenennen** des Rahmens: Rahmen-Menü „Umbenennen" (wie bisher) oder neu **F2** am gewählten Rahmen — der
  Doppelklick auf den Titel präsentiert jetzt.

## Wie (Architektur)
- `src/lib/rahmenReise.ts` (Start-Paket, klein): `rahmenReise(nodes, edges)` = Reihenfolge (Ketten den Pfeilen nach;
  Anfang = Rahmen ohne eingehenden Pfeil, in der Kartenfolge; Verzweigung → zuerst gezogener Pfeil, der nicht in
  Besuchtes führt; Kreise ohne Anfang beginnen am ersten Rahmen der Kartenfolge). `rahmenPfeilNr(nodes, edges, id)`
  = Nummer für die Marke, einmal je Stand gerechnet und während eines Zugs (`zugLaeuft`) eingefroren (M491).
  Zustand `{ boardId, rahmen, gefolgt }` mit `reiseStand/reiseAbo`, `rahmenReiseStarten`, `reiseRahmenSetzen`,
  `reiseLoesen`, `rahmenReiseBeenden`; `reiseStart(nodes, edges)` wählt den Start für Kürzel/Menü.
- `src/lib/kartenFolge.ts`: `richtung(e)` jetzt exportiert (Rahmenpfeil = gerichtet, Spitze vorn XOR hinten).
- `src/components/RahmenReiseHost.tsx` (in `Board.tsx` nach `</ReactFlow>`) lädt `src/components/RahmenReise.tsx`
  (`lazy`, ~7,5 KB) erst mit der ersten Reise. Dort: `nurBoardSetzen(true)` (M510, `lib/nurBoard.tsx`; beim Ende
  zurück auf den Stand davor, erst danach — zwei Bilder später — die Rückfahrt der Kamera, weil `NurBoard` beim
  Umschalten die Kamera um die Breite der Spalte ausgleicht; nach einer Karte im Fokus wieder an), Attribut
  `html[data-rahmen-reise]` (der Umschalter `.nur-board-ecke` steht nicht zusätzlich im Bild; das Esc von `NurBoard`
  gilt in der Reise nicht, damit Esc zuerst die Reise beendet) und
  `html[data-reise-flug]` (solange die Kamera fährt — Prüfreihen warten darauf); Kamera über `setViewport(…, {duration})`
  (React Flows zeitbasierte d3-Fahrt; Dauer 420–900 ms nach Weg und Zoomsprung, 0 bei reduzierter Bewegung), Maße aus
  dem React-Flow-Speicher (`width/height/minZoom/maxZoom`), Rahmenlage aus `internals.positionAbsolute`, Platz `KOPF`
  (34) für den Titel über dem Rahmen. Tasten im Erfassungs-Durchgang am `window` mit `stopImmediatePropagation`
  (Board-Pfeile, Pos1/Ende von `boardTasten.ts`, Leertaste-Schwenken greifen so nicht), nicht in Feldern/Text, nicht
  bei offenem Fenster (`overlayOffen`), Menü oder Karten-Fokus; Leertaste/Enter auf einem Knopf bleiben dem Knopf.
  Wischen: waagerechtes Rad (Summe > 70, Nachlauf-Sperre 650 ms; nicht in Karten, die selbst waagerecht rollen) und
  Finger-Zeiger (≥ 60 px, < 700 ms, waagerecht). `ResizeObserver` nicht nötig: Größenänderung kommt über den
  React-Flow-Speicher (`width/height`) und löst ein neues Einpassen aus.
- Leistung (M491): Die Leiste steht von Anfang an, im Flug ändert sich im DOM nur die Kamera; die Reihenfolge rechnet
  die Reise nur neu, wenn sich Rahmen oder Verbindungen ändern (Schlüssel aus Lage/Größe der Rahmen).
- `src/components/LabeledEdge.tsx`: `rahmenpfeil` (beide Enden `type === 'frame'`, gerichtet) → Strich `11 7`,
  Stärke ≥ 2,8, Klasse `pn-rahmenpfeil` (`abzweig`), Marke `.rahmenpfeil-nr`, Beschriftung `data-reise-nr`.
- `src/store/kanten.ts` `onConnect`: Hinweis beim Verbinden zweier Rahmen.
- `src/components/nodes/FrameCard.tsx`: Doppelklick auf `.frame-head` → `rahmenReiseStarten`; F2 am gewählten Rahmen
  → Umbenennen am Titel.
- `src/components/SelectionToolbar.tsx` (Rahmen-Menü, auch per Rechtsklick): „Rahmen präsentieren"
  (`data-taste="rahmen-praesentieren"`), „Weiter zu Rahmen" (`data-taste="rahmenpfeil-zu"`, `addLabeledEdge`).
- `src/lib/tasten.ts`: `rahmenReise` (Alt+Umschalt+P, ausgeführt in `Tastatur.tsx`), `rahmenBlaettern` und
  `rahmenUmbenennen` (fremd, nur Hilfe).
- Live: `src/lib/vorfuehren.ts` — Feld `rahmen` am `Zeiger` und in der Meldung `zeig`, `rahmenMelden(boardId, id|null)`;
  `src/components/Vorfuehren.tsx` startet/beendet die gefolgte Reise (`rahmenReiseStarten(…, true)`) und lässt die
  Ausschnitt-Mitfahrt ruhen, solange der Vorführende einen Rahmen zeigt.
- CSS: `src/styles/35-rahmen-reise.css` (neu): Rahmenpfeil-Marke, Leiste `.rahmen-reise-leiste` (`data-blass`); das
  Ausblenden selbst steht in `73-nur-board.css` (M510).
- Texte: Hilfe „Was ist neu" DE/EN, `src/sprache/en.json` (22 Texte).

## Grenzen / offen
- Drückt ein Folgender „Wieder folgen", springt er zum Rahmen des Vorführenden; Laser und Zeiger laufen wie bisher.
- Die Reihenfolge an einer Verzweigung ist die Zieh-Reihenfolge der Pfeile; eine eigene Nummer zum Umsortieren gibt
  es (noch) nicht — Pfeil löschen und neu ziehen.
- Karten außerhalb aller Rahmen kommen in der Reise nicht vor (dafür gibt es die Präsentation).
