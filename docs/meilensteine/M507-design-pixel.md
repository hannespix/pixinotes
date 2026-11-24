# M507 — Neue Design-Variante „pix·el“ in den Einstellungen
PR: #… · Prüfreihe: `pruefungen/m507-design-pixel.mjs` (Port 5507) · Datum: 2026-11-24

## Warum
Nutzerwunsch: „Können wir noch eine weitere Design-Variante in den Optionen zur Verfügung stellen und ein bisschen das
pix-el.de Design auf unser Tool übertragen als Option?“ — pix-el.de ist ein eigenes Werk des Nutzers (Repo `pix-el`,
`site/style.css`), Übernahme ausdrücklich erwünscht. Pixi, das Maskottchen (M501), kommt bereits von dort.

## Was
- Einstellungen → Darstellung → Aussehen: neue Zeile **Design** (Segment „Klassisch · pix·el“, `data-taste="design"`)
  unter „Erscheinungsbild“. Wirkt sofort, je Gerät gespeichert und mit den übrigen Vorlieben synchron (Feld `ui`).
- **pix·el** (hell und dunkel, folgt „Erscheinungsbild“):
  - Palette von pix-el: vier LCD-Grüntöne (`--lcd-0…4`), warmes Papier als Fläche (`#f6f7ef` / `#0c170b`), Tinte
    `#12280f` / `#e2f0c6`, gelber Marker für markierten Text, Gehäuse-Grün (`#20301f`) als Grund der Präsentation.
  - **Pixel-Kanten**: alle Radien 0; Karten, Leisten, Menüs und Fenster bekommen den Pixel-Rahmen von pix-el — vier harte
    Schatten (2 px) mit freien Ecken (gestufte Pixel-Ecke) plus ein harter Versatz-Schatten (Karten 4 px, angehoben 7 px,
    gezogen 10 px, Leisten 3 px, Menüs/Fenster 6 px). Prozess-Formen: harter `drop-shadow` ohne Unschärfe.
  - Punktraster in `--pix-punkt`, Punkte ohne Kantenglättung (eckig); Seitenpunkte der Präsentation eckig.
  - **Pixelschrift** (Jersey 10) nur für Titel: Wortmarke, Kartentitel (`.drag-title`, Kanban/Protokoll/Woche/Zeit),
    Dialog- und Hilfetitel, Überschriften in Notizen, Folientitel, Bereiche der Übersicht — und die **Flüssige Schrift**
    (M500) fließt in Pixelform wie der Schriftzug auf pix-el. Fließtext und Bedienung bleiben in Geist.
    Abschnitts-Etiketten der Einstellungen als gesperrte Schreibmaschinen-Versalien (wie die Etiketten auf pix-el).
  - Gewählte Stelle in Umschaltern = gedrückter Pixel-Knopf (dunkles LCD-Grün, helle Schrift); Hinweise (Toast) als
    dunkles LCD-Feld.
- **Klassisch** ist unverändert (Bildvergleich `werkzeug/bild-vergleich.mjs` gegen den Stand vor M507: alle Ansichten
  pixelgleich außer den Einstellungen, dort nur die neue Zeile).

## Entscheidung: Akzentfarbe
**pix·el bringt sein LCD-Grün fest mit**; die Akzent-Tupfer weichen dort dem Satz „LCD-Grün (pix·el)“. Begründung: Das
Grün der vier LCD-Töne plus Gelb ist die Identität von pix-el — Blau, Violett oder Rosa als Auswahl- und Knopffarbe
zerrissen die Palette, und fünf Akzente × hell/dunkel wären zehn weitere, einzeln zu messende Tonsätze für eine Option,
die das Design gerade verwässern würde („Weniger ist mehr“). Die gewählte Akzentfarbe bleibt gespeichert und gilt sofort
wieder, wenn man auf „Klassisch“ zurückstellt.

## Schrift und Lizenz
Jersey 10 — Copyright 2023 The Soft Type Project Authors (https://github.com/scfried/soft-type-jersey), **SIL Open
Font License 1.1**. Unverändert aus `pix-el/site/fonts/jersey-10.woff2` (13 KB) übernommen nach
`src/assets/jersey-10.woff2`, Lizenzvermerk in `public/lizenzen/schriften.txt`. Lokal eingebunden (`@font-face 'PN
Jersey'` in `src/styles/90-design-pixel.css`), kein Schriften-Dienst; Web-Build: eigene Datei, die erst geladen wird,
wenn ein Element sie benutzt (in Klassisch nie — m507 B prüft die Anfragen); Single-File: von Vite eingebettet, offline.
Rückfall ohne Schrift: Courier New / Monospace.

## Wie (Architektur)
- Zustand: `ui.design?: 'klassisch' | 'pixel'` (`src/store/typen.ts`), `setUiDesign` (`src/store/ansicht.ts`). Fehlt
  das Feld (Vorlieben von vor M507), gilt Klassisch. `ui` steht schon in `lib/einstellungen.ts` `FELDER`.
- Anwenden: `src/App.tsx` setzt `html[data-design="pixel"]` — in Klassisch wird das Attribut **entfernt**, damit keine
  Regel für Klassisch anders greift; `meta[name=theme-color]` nimmt in pix·el das Papier.
- Farben: Token-Satz `:root[data-design='pixel']` und `:root[data-design='pixel'][data-theme='dark']` in
  `src/styles/00-tokens.css` (Spezifität 0,2,0 / 0,3,0 schlägt Akzent- und Dunkel-Regeln sowie die späteren
  `--card-shadow`-Regeln aus M417). Neue Token: `--lcd-0…4`, `--pix-marker`, `--pix-punkt`, `--pix-rahmen`,
  `--pix-schlag`, `--pix-px`, `--pix-dunkel`, `--pix-gehaeuse`, `--pix-gehaeuse-leise`, `--pix-rahmen-schatten`,
  `--font-pixel`, `--font-etikett`; überschrieben: Grund, Tinte, Flächen, Ränder, `--feld-rand`, Kanten, Radien,
  alle Schatten-Token, Bildlaufleiste.
- Formen/Schrift: `src/styles/90-design-pixel.css` (vor `99-…`, alles unter `html[data-design='pixel']`). Pixelschrift
  mit `font-size-adjust: ex-height 0.6` statt eigener Größen je Stelle (Jersey ist bei gleicher Größe deutlich kleiner);
  Gewicht 400, `font-synthesis: none`. „Besser lesbar“ (`html[data-lesbar='an']`) ist per `:not()` ausgenommen.
- Flüssige Schrift: `.fluessig-card canvas { font-family: var(--font-pixel) }`; `lib/fluessig/motor.ts` beobachtet
  zusätzlich `data-design`/`data-lesbar` und tastet neu ab (die Flüssigkeit fließt in die neue Form).
- Einstellungen: `src/components/Settings.tsx` (Segment `data-design-wahl`, `.akzent-pixel`).
- m491 kann im Design laufen: `PN_DESIGN=pixel node pruefungen/m491-kanten-60fps.mjs` (grün, 24/24).

## Messungen
- Kontrast (`werkzeug/kontrast-pruefen.mjs`, m507 D/E): Notiz (gelb, weiß mit allen neun Editor-Farben als Schrift und
  Hintergrund — M494/M499), Kanban, Protokoll, Tabelle, Pixi, Flüssige Schrift (ruhend, ausgewählt, Fokus) sowie Board,
  Einstellungen, Hilfe, Suche, Kontextmenü, Präsentation — hell und dunkel ohne Stelle unter 4,5:1; Ränder der
  Bedienelemente und Fokusringe der Einstellungen ≥ 3:1. Zwei Funde beim Bau behoben: dunkle Zweitschrift auf dem
  aktiven Suchtreffer (3,99:1 → `--muted` dunkel `#acc19c`), Hinweis der Präsentation auf dem Gehäuse (3,7:1 →
  `--pix-gehaeuse-leise`).
- Leistung: nur `box-shadow` ohne Unschärfe, keine Filter mit Unschärfe, kein `:has()`, keine Animationen; m491 mit
  pix·el grün.
- Start-JS unverändert in der Größenordnung (nur das Attribut in `App.tsx`); CSS +≈4,6 KB, Schrift als eigene Datei.

## Grenzen / offen
- Icons bleiben die bisherigen Linien-Icons (keine Neuzeichnung als Pixel-Icons aus `pix-el/site/icons.js`).
- Mermaid-Diagramme, Gantt-/Kalender-Farben und Haftnotiz-Farben behalten ihre eigenen Töne.
- Kein Pixel-„Drücken“ (Versatz beim Klick) und keine Stufen-Animationen — bewusst ruhig, und Übergänge an Karten
  gehören der Zieh-Physik (M481).
