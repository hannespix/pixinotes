# M547 — Dritte Design-Wahl „vave.log" mit atmender Wortmarke
PR: siehe Merge-Titel „… (M547)" · Prüfreihe: `pruefungen/m547-design-vave.mjs` (Port 5547) · Datum: 2026-11-26

## Warum
Nutzerwunsch: „kannst du in vave.log repo das design genau übernehmen und als weitere layoutauswahl das vave-log design
in pixinotes anbieten? (ohne das vave logo, dafür pixinotes logo entsprechend animieren ;-)". vave.log ist ein eigenes
Werk des Nutzers (öffentliches Repo `hannespix/vave.log`, Stand `f0447dd`), Übernahme ausdrücklich erwünscht. Vorbild
für den Einbau: pix·el (M507).

## Was
- Einstellungen → Darstellung → Aussehen → **Design**: drittes Segment **vave.log** neben „Klassisch · pix·el"
  (`data-taste="design"`, `data-design-wahl="vave"`). Wirkt sofort, je Gerät gespeichert, reist mit den Vorlieben
  (`ui.design`) und als Look eines geteilten Boards (M509) sowie im Mitmachen-Link (`d=vave`, M513).
- **vave.log** (hell und dunkel, folgt „Erscheinungsbild"), Werte aus `vave.log/src/web/styles.css` und `select-menu.css`:
  - Fläche `#f8f9f6`, Tinte `#1b1b1b`, Karten/Menüs weiß, Kanten `#e7e8e3`, Hover `#f2f3ed`, Akzent **Violett `#641dff`**
    (fest wie das LCD-Grün in pix·el; die gewählte Akzentfarbe bleibt gemerkt), Fokusring **3 px `#8951ff`**, Lime
    `#e8ffb9` für markierten Text und „Rückgängig" im Hinweis.
  - **Readex Pro** (variabel) für alles: Titel Gewicht 500 mit −0,045 em, Kartentitel 500/−0,02 em, Abschnitte der
    Einstellungen als „Eyebrow" (11 px, 0,16 em, 550, Versalien); auch die Flüssige Schrift formt Readex Pro.
  - Rundungen: Felder 7 px, Knöpfe/Segment 8 px (gewählte Stelle 5 px), Karten 10 px, Kanban-Spalte 13 px, Ticket 9 px,
    Leisten/Menüs 16 px, Fenster 17 px.
  - Karten flach mit 1-px-Kante, unter der Maus violett umrissen (`#cfb5ff`, wie `.project-card:hover`); Menüs mit der
    weichen Doppel-Wolke von `.sm-panel`; Fenster mit `0 20px 100px` und Abdunkler mit `blur(3px)` wie `.dialog`;
    über dem Fenstertitel das violette Etikett „PIXINOTES" (wie „VAVE.LOG" über den Dialogtiteln, per `::before` mit
    leerem Alternativtext, also nicht vorgelesen).
  - Umschalter (`.seg`) als vave-Segment: heller Grund `#eff1e9`, gewählte Stelle weiß mit violetter Schrift und
    leichtem Schatten. Kanban wie die Aufgaben-Spalten in vave.log (Spalte `#f0f2eb` mit Kante, Tickets weiß, Kante statt
    farbigem Streifen). Hinweise (Toast) warm-schwarz, 8 px.
  - **Wortmarke „PIXI · NOTES"** wie „VAVE · LOG": kräftiges Wort, violetter Punkt (5 px), leichter Zusatz. Das kräftige
    Wort **atmet** in den drei Gesten des vave-Logos (langer Atem · Doppelwelle · kleine Wellen, Dauern ±, nie zweimal
    dieselbe Geste, jede beginnt und endet bei 0), als Welle durch die Buchstaben.
- **Klassisch** und **pix·el** sind unverändert (Bildvergleich unten).

## Wie (Architektur)
- Zustand: `ui.design?: 'klassisch' | 'pixel' | 'vave'` (`src/store/typen.ts`, auch `BoardLook.design`); `lib/boardLook.ts`
  (`DESIGNS`, `lookWort` „vave.log", `lookAnders` vergleicht den Akzent nur in Klassisch); `lib/mitmachen.ts`
  (`lookFuerLink`), `lib/mitmachenProtokoll.ts` (`MitLink.design`, `linkLesen` nimmt `d=vave`), `mitmachen/main.ts`.
- Anwenden: `src/App.tsx` setzt `html[data-design="vave"]` (Klassisch weiter ohne Attribut), `meta[name=theme-color]` =
  Fläche. Einstellungen: `src/components/Settings.tsx` (drittes Segment, `.akzent-vave` statt der Tupfer).
- Farben: `:root[data-design='vave']` und `…[data-theme='dark']` in `src/styles/00-tokens.css` (Spezifität 0,2,0 /
  0,3,0 wie pix·el). Neue Token: `--vave-lime`, `--vave-fokus`, `--vave-hover`, `--vave-rand-hover`, `--vave-spalte`,
  `--vave-spalte-rand`, `--vave-seg`, `--vave-seg-rand`, `--vave-seg-schrift`, `--vave-hinweis`, `--vave-abdunkler`,
  `--vave-fenster-schatten`, `--font-vave`; überschrieben: Grund, Tinte, Flächen, Ränder, `--feld-rand`, Kanten,
  Radien, alle Schatten-Token.
- Formen/Schrift: `src/styles/91-design-vave.css` (nach `90-design-pixel.css`, vor `99-…`; alles unter
  `html[data-design='vave']`). „Besser lesbar" gewinnt weiter (Atkinson steht direkt an body/Knöpfen/Titeln).
- Wortmarke: `src/components/AboutMenu.tsx` rendert im Design vave.log `VaveMarke` (Markup in Klassisch/pix·el
  unverändert `Pixi<span>Notes</span>`); welches Design zu sehen ist, liest `lib/designAttr.ts` (`useDesign`,
  MutationObserver auf `data-design`, winzig, im Start). Die Bewegung `lib/vaveLogo.ts` (`logoBewegen(el)`) wird
  **nachgeladen** (`import()`), nur im Design vave.log:
  - Lage 0…1 aus den Gesten (Abschnitte `[Ziel, ms]`, Glättung `t³(6t²−15t+10)`, Zeitschritt höchstens 100 ms wie im
    Original) → Gewicht 560…700 (Readex Pro) plus eine Kontur in Schriftfarbe bis 0,04 em (`-webkit-text-stroke`), damit
    das Wort wie im Lottie-Original über den fettesten Schnitt hinaus schwillt. Je Buchstabe 170 ms Versatz (Welle).
  - Jeder Buchstabe hat eine feste Breite in em (beim fettesten Schnitt gemessen, nach dem Laden der Schrift erneut) —
    die Bewegung verschiebt nichts daneben.
  - Leistung: kein Takt bei verdecktem Tab, außerhalb des Bildes (IntersectionObserver; Fokus-Modus blendet die Marke
    aus), während eines Zugs (`zugBeobachten`/`zugLaeuft`, M535) und in den Haltephasen der Gesten (ein Zeitgeber statt
    Bild-Takt, sobald alle Buchstaben angekommen sind). Je Bild ändern sich höchstens vier Inline-Stile (Stufen von 1/280).
  - Still in der Ruhelage bei `prefers-reduced-motion` und bei „Besser lesbar" (Atkinson kennt keine Zwischenstufen).
- Schrift: Readex Pro aus `@fontsource-variable/readex-pro` 5.3.0 (wie vave.log), nur Latein und Latein-Erweitert,
  unverändert als `src/assets/readex-pro-latin-wght.woff2` (31 KB) und `…-latin-ext-wght.woff2` (28 KB); `@font-face
  'PN Readex'` in `91-design-vave.css` (und für die Teilnehmer-Seite in `mitmachen/mitmachen.css`). Web-Build: eigene
  Dateien, die erst geladen werden, wenn ein Element sie benutzt — in Klassisch und pix·el nie (m547 prüft die
  Anfragen). Lizenz: SIL OFL 1.1, Vermerk in `public/lizenzen/schriften.txt`. Kein Schriften-Dienst.
- Sprache: „Violett (vave.log)" in `src/sprache/en.json`; „NOTES" (Wortmarke) in `werkzeug/sprache-ohne.json`.

## Messungen
- m547: Umschalten, Neuladen, Vorlieben, Rückweg; Tokens und Formen (Werte aus vave.log, berechnet am Dokument);
  Fenster, Etikett, Segment, Felder, Kontextmenü, Hinweis, Fokusring; Wortmarke bewegt sich (Gewichte und Pixel über die
  Zeit, als Welle), steht bei reduzierter Bewegung, „Besser lesbar" und im Zug; Kontrast-Scan hell und dunkel (Karten
  ruhend/ausgewählt/Fokus, Board, Einstellungen mit Rändern und Fokusringen, Hilfe, Suche, Kontextmenü); Klassisch
  unverändert.
- Bildvergleich (`werkzeug/bild-vergleich.mjs`, Stand vor M547 gegen M547): Klassisch pixelgleich außer den
  Einstellungen (dort das neue Segment „vave.log"); dieselbe Messung mit gewähltem pix·el ebenso.

## Grenzen / Abweichungen vom Original
- **Logo**: kein vave-Logo, keine Lottie-Datei. Das Original morpht die Buchstabenformen (eigene Kurven je Buchstabe);
  hier schwillt die Schrift über Gewicht und Kontur — dieselbe Rhythmik, nicht dieselbe Form.
- **Kontraste**: `--muted` eine Stufe dunkler als in vave.log (`#5f635c` statt `#686c65`: Zähler in der Kanban-Spalte
  und aktiver Suchtreffer hatten 4,1–4,3:1); Feldränder `#80847b` statt `#dedfd9` (1,3:1, WCAG 1.4.11 verlangt 3:1);
  Kanten (Pfeile) `#8c9085` statt `#b9bcb1`.
- **Dunkel**: vave.log hat keins — abgeleitet aus denselben Tönen (Grund `#121311`, Flächen `#1b1c19`/`#262823`,
  Akzent als Schrift `#c3aaff`), gemessen ≥ 4,5:1.
- Bedienelemente in Karten behalten ihre Größe (vave.log setzt Felder und Knöpfe auf 44 px Höhe — auf dem Board zu
  groß); Icons bleiben die PixiNotes-Linien-Icons (vave.log nutzt Lucide, ähnlich).
- Die Abdunkler-Unschärfe (`blur(3px)`) kostet nur, solange ein Fenster offen ist; auf dem Board gibt es keine neuen
  Filter oder Animationen.
