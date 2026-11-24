# M515 — Präsentation im Dunkelmodus: keine helle Schrift auf hellem Grund
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m515-folie-kontrast.mjs` (Port 5515) · Datum: 2026-11-24

## Warum
Fehlermeldung: „im präsentationsmodus sind in manchen modulen (schritt/start/ende etc) schriftfarben im darkmode
invertiert, aber deren hintergrund hell → hell auf hell nicht lesbar!“

## Ursache
- **Formen auf der Folie (Schritt, Start/Ende, Entscheidung, Notizfeld):** Eine Form mit schlichtem Text läuft auf
  der Folie als `<textarea class="shape-input">`. Das Feld hatte `color: var(--ink)` – im Dunkeln also die helle
  Thema-Tinte (#e9ebee, pix·el #e2f0c6) auf der hellen Pastellfüllung: 1,03–1,19:1. Auf dem Board fiel das nicht auf:
  Dort zeigt die Form ihren Text seit M435 über den Notiz-Editor, und `[data-theme='dark'] .shape-body` setzt dunkle
  Schrift. Das Textfeld gibt es nur noch auf der Folie, die Regel für den Text der Form galt dort nicht.
- **Eigene dunkle oder kräftige Füllung (Form):** Schrift war die Vorgabe des Papiers (BlockNote-Grau #3f3f3f bzw.
  #16191e) – auf #1f2a44 1,35:1, auf Blau #4f7cff 2,8:1, auf Orange #ff8800 4,4:1. Board und Folie, hell und dunkel.
- **Notiz auf der Folie:** Die Folie übernahm weder die eigene Farbe (`hex`) noch die Regel „Weiß folgt im Dunkeln dem
  Thema“: Weiße Notiz und Notiz in eigener Farbe zeigten BlockNote-Grau auf der dunklen Folie (1,46:1, pix·el 1,6:1).
- **Notiz in eigener Farbe auf dem Board:** Eine eigene Farbe trug weiter die Klasse ihrer Palettenfarbe (meist
  `sticky-white`) – im Dunkeln bekam ein helles Rosa deshalb die helle Thema-Tinte (1,15:1), im Hellen ein dunkles
  Blau BlockNote-Grau (1,35:1).
- **Kleinere Funde der Folien-Messung:** Priorität „!!!“ im Kanban fest #d84b3d (4,2:1 hell, 3,9:1 dunkel), Dateigröße
  auf der Datei-Folie fest #777 (4,48:1 hell, 3,4:1 dunkel), Knopf „Pause“ der Zeiterfassung auf seiner getönten
  Fläche 4,0:1, Personen-Kürzel im Kanban in der Akzentfarbe Orange 4,2:1 (Grün 4,47:1 nachgerechnet).

## Was
- **Formen:** Die Schrift folgt der **gezeichneten Füllung**, nicht dem Thema. `lib/lesbareSchrift.ts`
  `schriftAufFuellung(füllung)` liefert `null`, solange die Vorgaben des Papiers (#16191e und BlockNote-Grau) auf der
  Füllung ≥ 4,5:1 haben – dann bleibt alles wie bisher (alle Pastelltöne der Palette). Erst eine dunkle oder mittlere
  Füllung bekommt die lesbare Schrift (`--auf-farbe-*`). `formSchrift()` setzt sie als `--shape-schrift` und die
  Klassen `schrift-eigen` (+ `schrift-hell`, dann gelten die Nachtstufen der Editor-Farben) – in `ShapeCard` und auf
  der Folie (`ShapeSlide`) gleich. Das Textfeld erbt die Schrift der Form (`color: inherit`); im Dunkeln ist sie ohne
  eigene Füllung `--papier-ink`.
- **Notizen:** Die Folie zeigt die eigene Farbe als Fläche und setzt `papier-*` wie das Protokoll; Weiß folgt im
  Dunkeln dem Thema (Schrift `--ink`, Nachtstufen der Editor-Farben). Eine eigene Farbe heißt jetzt `sticky-eigen`
  (Board und Folie) und bringt über `notizSchrift()` ihre Schrift mit, wo die Vorgabe nicht reicht.
- **Tokens:** `--prio-hoch/-mittel/-niedrig` (hell und dunkel) für Kanban-Priorität und Aufgaben-Zentrale,
  `--zeit-pause-schrift` hell #876016, `--accent-strong` Orange #a04e17 und Grün #1b7243. Die Dateigröße im
  Serialisierer nimmt `var(--muted, #5f6670)` (Exporte ohne Variablen fallen auf den Ersatz bzw. die Grundschrift).
- **Werkzeug:** `werkzeug/kontrast-pruefen.mjs` zählt eine Fläche aus `::before`/`::after`, die ihr Element fast ganz
  füllt, als Grund – die Raute der Entscheidung zeichnet ihre Füllung so (die Form selbst ist durchsichtig). Vorher
  maß der Scan dort gegen den Grund der Folie und übersah helle Schrift auf hellem Pastell.

## Fundliste (vorher → nachher)
| Stelle | vorher | nachher |
|---|---|---|
| Form (alle 4 Arten × 7 Palettentöne), Text, Folie dunkel Klassisch | 1,03–1,19:1 (#e9ebee auf Pastell) | ≥ 15,2:1 (#16191e) |
| dieselbe, pix·el dunkel | 1,0–1,2:1 (#e2f0c6) | ≥ 15,2:1 |
| Form #1f2a44 Text, Folie hell | 1,24:1 (#16191e), pix·el 1,1:1 | 14,3:1 (Weiß) |
| Form #1f2a44 formatiert, Board/Folie hell und dunkel | 1,35:1 (#3f3f3f) | 14,3:1 (Weiß) |
| Form #4f7cff, Board und Folie | 2,84:1 (#3f3f3f), Folie dunkel 3,1:1 (#e9ebee) | 4,75:1 (#16191e) |
| Form #ff8800 formatiert | 4,4:1 | 7,4:1 (#16191e) |
| Notiz weiß, Folie dunkel | 1,46:1 / pix·el 1,6:1 | --ink |
| Notiz eigene Farbe #1f2a44 / #ffd0e0, Folie dunkel | 1,46:1 (Farbe fehlte) | eigene Fläche, Weiß bzw. Grau |
| Notiz #ffd0e0, Board dunkel | 1,15:1 (#e9ebee) | 7,7:1 (#3f3f3f) |
| Notiz #1f2a44, Board hell | 1,35:1 | 14,3:1 (Weiß) |
| Kanban „!!!“ | 4,21:1 hell, 3,89:1 dunkel | 5,4:1 / 7,2:1 |
| Datei „(1 KB)“ auf der Folie | 4,48:1 hell, 3,44:1 dunkel | 6,2:1 / 6,6:1 (--muted) |
| Zeiterfassung „Pause“ (hell) | 4,07:1 | 4,96:1 |
| Kürzel „A“ im Kanban, Akzent Orange | 4,18:1 | 4,94:1 |

Ohne Treffer (schon vorher ≥ 4,5:1): Haftnotizen in Farbe, Gantt, Kalender, Wochenplan, Protokoll (weiß, gelb, dunkle
eigene Farbe), Rechen-Tabelle, Ideabubbles, Kontakt, E-Mail, Bild, Rahmen-Abschnittsfolie, Pixi-Name. Text in SVG
(Mermaid, Flüssige Schrift, Pixi) misst der Scan nicht; Mermaid folgt auf der Folie seit M97 dem Thema. Das Portal ist
keine Folie.

## Hell unverändert
Pastellformen setzen nichts (`schriftAufFuellung` → `null`): Schrift im Hellen wie vorher (Klassisch #16191e,
pix·el #12280f, formatiert BlockNote-Grau) – Reihe C misst das, die Bildschirmfotos der Formen-Folien sind
pixelgleich zum Stand vor M515 (Klassisch und pix·el, Schritt, Entscheidung, Start/Ende, formatiert; Vergleich der
Bildschirmfotos aus Reihe A, alter und neuer Build).

## Wie (Architektur)
- `src/lib/lesbareSchrift.ts`: `schriftAufFuellung`, `flaechenSchrift`, `formSchrift`, `notizSchrift`.
- `src/components/nodes/ShapeCard.tsx`, `src/components/nodes/NoteCard.tsx`, `src/components/Presenter.tsx`
  (`ShapeSlide`, `NoteSlide`).
- CSS: `00-tokens.css` (Formen-Schrift im Dunkeln, Prio-Tokens, Akzente, Pause), `10-karten-grundlagen.css`
  (`.note-card.schrift-eigen`), `25-board-formen-mermaid.css` (`.shape-body`, `.shape-input`), `34-praesentation.css`
  (`.slide-note`), `36-aufgaben.css` (Prio), `60-dunkel-navigator-stift.css` (Nachtstufen für `schrift-hell`).

## Prüfung
`pruefungen/m515-folie-kontrast.mjs`: 65 Karten (31 Formen in allen Arten und Palettentönen, schlicht und formatiert,
dazu dunkle, mittlere und kräftige eigene Füllung; 7 Notizen; alle übrigen Kartentypen) als Folien – Klassisch und
pix·el, dunkel und hell, im Fenster, dunkel zusätzlich in „Nur Inhalt“. Jede Folie: richtige Karte, kein Text unter
4,5:1 (Liste der Ausnahmen leer). Board: Formen und Notizen in Klassisch dunkel, pix·el dunkel und Klassisch hell.
Hell: Schrift der Pastellformen wie vorher. Gegen den Stand vor M515 ist die Reihe rot.
