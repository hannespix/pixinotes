# M492 — Dunkelmodus überall stimmig: Editor-Menüs und Restfarben
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m492-dunkel-stimmig.mjs` (Port 5492) · Werkzeug: `werkzeug/kontrast-pruefen.mjs` · Datum: 2026-11-23

## Warum
Nach M489 (Protokoll lesbar im Dunkeln) blieb offen: **Die BlockNote-Menüs blieben im Dunkelmodus hell** — Einfügen-Menü
(„/“), Formatierungs-Leiste, Schrift-Menü (Aa), Farbwahl, Link-Werkzeug, Seitenmenü samt Griff-Menü, Tabellen-Griffe,
Vorschläge — in jeder Notiz, im Protokoll und in der Präsentation. Dazu ein Audit des ganzen Dunkelmodus: welche Schrift
liegt unter 4,5:1, wo stehen harte Hellfarben?

## Was (Nutzersicht)
- **Editor-Menüs folgen dem Erscheinungsbild** (Hell/Dunkel/System): im Dunkeln dunkle Fläche (`--surface`), Schrift
  `--ink`, Hover `--surface-2`, gewählt umgekehrt (helle Fläche, dunkle Schrift), Rand `--border-soft`, dunkler Schatten
  statt des hellen Lichthofs. Im Hellen unverändert.
- **Auch über einer Haftnotiz.** Entscheidung: Menüs gehören zur Oberfläche, nicht zum Papier. Sie schweben über der
  Karte wie Auswahl-Leiste und Kontextmenü (die im Dunkeln längst dunkel sind); ein helles Menü über gelbem Papier im
  dunklen Raum wäre die einzige helle Bedienfläche des Schirms. Das Papier selbst bleibt hell (M338).
- **Farbwahl:** Die Muster „A“ stehen im Dunkeln auf der hellen Editor-Fläche — sie zeigen die Farbe so, wie sie im
  Text auf dem Papier erscheint (Braun auf dunklem Menü wären 1,9:1 gewesen und hätten anders gewirkt).
- **Seitenmenü im Protokoll:** Griffe und ihr Hover liegen AUF dem Papier und nehmen dessen Farben (`--pr-ink`,
  `--pr-flaeche`, M489); das aufgeklappte Griff-Menü ist dunkel.
- **Restfarben** (gefunden mit dem Kontrast-Scan, siehe Liste).

## Gefunden und behoben
| Stelle | Vorher (dunkel) | Nachher | Wie |
|---|---|---|---|
| Einfügen-Menü, Formatierungs-Leiste, Schrift-Menü, Farbwahl, Link-Werkzeug, Griff-Menü | Fläche weiß (L = 1) | Fläche `--surface` (L = 0,014), Schrift ≥ 4,5:1, Symbole ≥ 13:1 | `60-dunkel-navigator-stift.css` Block „M492: BlockNote-Menüs“ |
| Farbmuster der Farbwahl | Braun 1,95:1, Rot 3,8:1 auf dunklem Menü | auf der hellen Editor-Fläche | ebenda |
| Notiz ohne bekannte Farbe (alter Stand, Import; im Bildvergleich die Karte „Weiß“ ohne `color`) | `#3f3f3f` auf `#141618` = 1,72:1 | `--ink` | ebenda, neben der M284-Regel für Weiß |
| Zeiterfassung: Knöpfe und Summen „Arbeit“/„Pause“, laufende Anzeige, Wochentage | 2,2:1 / 2,8:1 / 2,9:1 / 3,7:1 | 5,9:1 bzw. 6,7:1 und mehr | Tokens `--zeit-arbeit/-pause` (Fläche) und `--zeit-*-schrift` (Schrift, im Dunkeln heller) in `00-tokens.css`; `TimeCard.tsx` nimmt `var(…)` statt fester Hex-Werte |
| Bereichsname in der Übersicht (und dahinter in der Präsentation) | Bereichsfarbe als Schrift 4,32:1 (Blau) bis ~3:1 | mit `--ink` aufgehellt, Farbton bleibt | `Overview.tsx` setzt `--bereich-farbe` statt `color`; `25-board-formen-mermaid.css` |
| Kürzel neben einer E-Mail (Avatar) | Weiß auf `#6c8ef5` = 3,08:1 (auch hell) | `--accent-fill` = 4,6:1 | `10-karten-grundlagen.css` — **einzige bewusste Änderung im Hellen** (dort ebenso zu schwach) |

Gescannt (dunkel, je ruhend · ausgewählt · Fokus): Notiz gelb/ohne Farbe/weiß/blau, Kanban, Gantt, Kalender, Bubbles,
Wochenplan, Zeiterfassung, Protokoll (gelb), Tabelle, Diagramm, Form, eigene App, Portal, E-Mail, Datei, Kontakt,
Rahmen; Fenster: Board, Einstellungen, Hilfe, Suche (mit Treffern), Aufgaben-Zentrale, Kontextmenü, Modul-Palette,
Eingang, Präsentation, Übersicht. Danach: keine Stelle unter 4,5:1.

## Begründete Ausnahmen (bleiben)
- **Harte Weiß-Flächen** in `src/styles/`: Word-/PDF-Seiten (`32-dialoge-pdf.css`), Rahmen eigener Apps und App-Folien
  (`48-…`, `64-…` — der Inhalt der App bestimmt sein Aussehen selbst), QR-Code (braucht Weiß zum Scannen), das
  Farbmuster „Weiß“ der Notizfarben, der Griff im Bild-Editor. Alle gewollt.
- **Haftnotizen** bleiben im Dunkeln helles Papier, Schrift dunkel (M338) — kein Fehler.
- **Kalender-Streifen der Wochenansicht und Gantt-Balken:** weiße Schrift auf der frei gewählten Zeilenfarbe (z. B.
  `#4f7cff` 3,7:1, `#3fa564` 3,1:1) — Nutzerfarbe, in Hell und Dunkel gleich; in der Reihe als Ausnahme geführt.
  (Die Streifen der Monatsansicht haben Schrift 0 und zählen nicht.)
- **Farbmuster der Farbwahl** zählen nicht als Text (sie zeigen die Farbe selbst).

## Wie (Architektur)
- `src/styles/60-dunkel-navigator-stift.css`: `[data-theme='dark'] .bn-root` setzt nur die Menü-Variablen von BlockNote
  (`--bn-colors-menu-*`, `tooltip-*`, `hovered-*`, `selected-*`, `disabled-*`, `border`, `shadow`);
  `[data-theme='dark'] .bn-mantine[data-mantine-color-scheme]` die Mantine-Variablen (`--mantine-color-text/-dimmed/
  -body/-default*/-placeholder`, `--mantine-shadow-md`) — Spezifität (0,3,0) schlägt BlockNotes
  `.bn-mantine[data-mantine-color-scheme="light"]`. `color-scheme: dark` nur auf den schwebenden Menüs (Eingabefeld,
  Bildlaufleisten), nicht auf dem Text (Abhak-Kästchen stehen auf dem Papier). Die Editoren behalten `theme="light"`
  (`NoteCard`, `MinutesCard`, `Presenter`): BlockNotes dunkles Thema hätte Editor-Schrift und Hervorhebungen auf dem
  Papier hell gemacht. Die Menüs liegen DOM-seitig in `.bn-container` (BlockNote 0.57 portiert in den eigenen
  Container), darum greifen die Variablen ohne Eingriff in die Komponenten.
- `werkzeug/kontrast-pruefen.mjs`: `kontrastScan(page, sel, { grenze, alle })` → Paare unter der Grenze mit Text, Wert,
  Farben, Pfad; Hintergrund über Vorfahren gemischt, sonst über `elementsFromPoint` (schwebende Leisten), sonst die
  Leinwand; versteht `color(srgb …)` (color-mix). Lässt unsichtbares, deaktiviertes, SVG und Schrift 0 aus. Von Hand:
  `node werkzeug/kontrast-pruefen.mjs dist --dunkel [--sel …] [--alle]`. Hinweis in `docs/AGENTEN.md` (Regel 9).
- Prüfreihe: A/B Menüs dunkel (Fläche L < 0,06, Schrift ≥ 4,5:1, Symbole ≥ 3:1), C dieselben Menüs hell (L > 0,8),
  D Scan über jeden Kartentyp und die Fenster, E Seitenfehler. `M492_BILDER=<ordner>` legt Bildschirmfotos ab;
  mit `PN_DIST=<alter Build>` gegen den Stand vorher: 18 Prüfungen rot (genau die Liste oben).
- Bildvergleich hell vorher/nachher (`werkzeug/bild-vergleich.mjs`): Board, Notiz im Fokus, Präsentation,
  Einstellungen, Telefon pixelgleich; „Auswahl“ weicht in 10 Bildpunkten an den Ecken der Größen-Griffe um ≤ 3/255 ab
  (Kantenglättung, unsichtbar). Dunkel unterscheidet sich gewollt (die Notiz ohne Farbe ist jetzt lesbar).

## Grenzen / offen
- **Schriftfarben im Text einer weißen Notiz im Dunkeln:** Die Hervorhebungsfarben (Braun, Grau …) sind für helles
  Papier gemacht; auf der dunklen weißen Notiz bzw. dem Protokoll „Thema“ sind manche zu dunkel. Eigene Dunkelstufen
  je Farbe wären ein eigener Schritt.
- **Nutzerfarben unter weißer Schrift** (Gantt-Zeilen, Kalender-Woche): bräuchten eine automatische Schriftfarbe nach
  Helligkeit der Zeilenfarbe — betrifft Hell und Dunkel gleich.
- **Zeiterfassung „Pause“ läuft:** Weiß auf `#9c6f1c` = 4,46:1 (knapp, in beiden Themes) — bewusst nicht verschoben.
- Nicht-Text-Kontrast (Ränder von Eingabefeldern ≥ 3:1) misst das Werkzeug nicht; geprüft sind Symbole in Menüs.
