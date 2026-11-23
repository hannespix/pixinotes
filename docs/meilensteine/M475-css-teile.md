# M475 — Stylesheet in Teildateien je Bereich
PR: siehe PR-Titel „(M475)" · Prüfreihe: `pruefungen/m475-css-teile.mjs` (Port 5475) · Datum: 2026-11-23

## Warum
`src/index.css` war mit ~8 600 Zeilen der größte Konflikt-Hotspot: jeder parallel arbeitende Agent hing dort
Regeln an, Merges kollidierten am Dateiende. Für Nutzer ändert sich nichts – das ist ein reiner Umbau.

## Was
- Das Stylesheet liegt in **29 Teildateien** `src/styles/NN-bereich.css`. `src/index.css` enthält nur noch einen
  Kopfkommentar und die `@import`-Zeilen in Kaskaden-Reihenfolge; Vite (postcss-import) setzt sie beim Bauen
  zusammen – Web-Build und Single-File (`npm run build:single`) wie bisher.
- Geschnitten wurde **nur an Abschnittsgrenzen** (Kommentarköpfe `/* ---------- … */`, `/* ===== M… */`), in
  der Reihenfolge der alten Datei. Weil die Datei chronologisch gewachsen ist, heißt jede Teildatei nach ihrem
  überwiegenden Inhalt (z. B. `10-karten-grundlagen`, `36-aufgaben`, `38-gantt-kalender`, `66-entscheidungs-bubbles`);
  der Kopfkommentar jedes Abschnitts sagt weiterhin den Meilenstein.
- `00-tokens.css`: CSS-Variablen, Akzentfarben, Hell/Dunkel, Scrollbalken, Mauszeiger (`--zeiger-*`, M464).
- `99-bedienung-im-fokus.css`: der M421-Block mit den drei Listen (Übergang, Zeiger, Finger) – wird **zuletzt**
  eingebunden.

## Wie (Beleg „kein Pixel anders")
- Teilen: Skript (einmalig, nicht im Repo) mit Startzeilen je Teil; `url()` in den verschobenen Dateien wurde eine
  Ebene tiefer umgeschrieben (`./assets/…` → `../assets/…`, `../node_modules/…` → `../../node_modules/…`,
  betrifft Kalam in `54-…` und Geist in `70-…`). Leerzeilen am Ende jedes Teils entfallen.
- **Kontroll-Build** mit `99-…` an seiner alten Stelle (zwischen `70-…` und `72-…`): gebautes
  `dist/assets/index-*.css` **byte-gleich** zum Build vor dem Umbau (gleicher Hash `index-CBnN5NnU.css`). Das
  Aufteilen selbst ist also verlustfrei.
- **Endgültiger Build** (`99-…` zuletzt): `node werkzeug/css-vergleich.mjs alt.css neu.css` → gleiche Regelmenge
  (3 281 Regeln), genau **4 Regeln haben ihre Stelle gewechselt** – die des M421-Blocks (`@keyframes
  pn-bedienung-ein`, Übergangsregel, `@media (hover: hover)`, `@media (hover: none)`). Begründung, dass das für
  die Kaskade neutral ist: Der Block stand vorher vor den Abschnitten M423–M440 (Netz, Fokus-Darstellung, Nur
  Inhalt, Kanban schmal, Pfeil-Schatten, Formen, Seitenleiste). Von dort setzt nur M426 („Nur Inhalt") dieselben
  Eigenschaften an denselben Elementen – mit `!important`, gewinnt also unabhängig von der Reihenfolge; alle
  übrigen Regeln dort setzen opacity/transition/animation/pointer-events an anderen Elementen.
  Single-File: dasselbe Ergebnis (4 852 Regeln, dieselben 4 verschoben).
- **Bildschirmfotos** `node werkzeug/bild-vergleich.mjs <dist-alt> <dist-neu>`: 11 Ansichten – Board hell und
  dunkel, Karte markiert, Zeiger ruht auf der Karte (M421-Einblendung), Karten-Fokus Notiz und Kanban dunkel,
  Präsentation, Einstellungen hell und dunkel, Telefon hell und dunkel – alle **pixelgleich** (Bildpunkte über
  Canvas verglichen). Gegenprobe alt gegen alt ebenfalls 11/11 gleich (die Aufnahmen sind deterministisch).
- Prüfreihen, die den Stylesheet-Quelltext lesen (m300, m302, m389, m397), lesen ihn über
  `werkzeug/css-quelle.mjs` (`cssQuelle(repo)` = alle Teile in @import-Reihenfolge, `cssTeile(repo)`).
- Neue Werkzeuge: `werkzeug/css-vergleich.mjs` (Regel-für-Regel-Vergleich zweier gebauter Stylesheets, meldet
  fehlende/neue/verschobene Regeln) und `werkzeug/bild-vergleich.mjs` (zwei Builds nebeneinander auf 5475/6475,
  gleiche Ansichten, pixelgenauer Vergleich) – für künftige Umbauten, die nur verschieben sollen.
- Prüfreihe m475: A index.css nur @import, jede Teildatei genau einmal, Nummern steigend, Tokens zuerst, kein
  weiteres Stylesheet in `src/`; B `99-…` zuletzt eingebunden, drei gleiche Listen, im gebauten CSS die letzten
  Regeln; C im Browser: Schriften aus den Teilen laden, M421 (Kanban-Bedienung in Ruhe 0, markiert 1), Tokens
  greifen, keine Seitenfehler.
- Regeln für Agenten: `CLAUDE.md` §3/§6, `docs/AGENTEN.md` Regel 3.

## Grenzen / offen
- Die Teile folgen der gewachsenen (chronologischen) Ordnung, nicht einer reinen Bereichs-Ordnung: Regeln
  eines Moduls (z. B. Kanban, Präsentation, Dunkelmodus) verteilen sich weiter auf mehrere Dateien. Ein echtes
  Umsortieren nach Bereich würde die Kaskade ändern und braucht je Schritt denselben Beleg (css-vergleich +
  bild-vergleich).
- Neue Teildateien bekommen eine freie Nummer zwischen den Nachbarn; ist keine frei, darf umnummeriert werden
  (Reihenfolge bleibt, Prüfreihe A3 hält sie fest).
