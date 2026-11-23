# M499 — Kräftigere Editor-Farben im Hellen
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m499-farben-kraeftiger.mjs` (Port 5499) · Datum: 2026-11-23

## Warum
Offener Punkt aus M494: Im Dunkeln haben die neun BlockNote-Farben eigene Nachtstufen, im Hellen galten noch
BlockNotes Originale — als Schrift auf Weiß Gelb 2,1:1, Grau 2,8:1, Orange 3,3:1, Rot 4,3:1, auf den Haftnotiz-Farben
noch weniger (Gelb auf Rosa 1,6:1). Der Nutzer hat zugestimmt: „Ja, etwas kräftigere Farben können wir gerne
ausprobieren.“

## Was (Nutzersicht)
- **Im hellen Modus** stehen die neun Schrift- und Hintergrundfarben im Text in eigenen Hellstufen: auf der weißen
  Notiz, auf jeder Haftnotiz-Farbe (Gelb, Rosa, Mint, Himmel) und im Protokoll. Jeder Farbton bleibt erkennbar
  derselbe — Gelb als Schrift wird Ocker/Senf, Orange Rost, Grau ein mittleres Grau; die Hintergründe sind etwas satter
  (Gelb als Textmarker). **Bestehende Notizen** zeigen die neuen Töne von selbst (gespeichert sind nur die Namen).
- Jede Kombination hält **≥ 4,5:1** (gemessen min 4,60:1): Farbschrift auf Weiß und auf den vier Papierfarben (Rosa ist
  die dunkelste), Farbschrift auf jedem Hintergrund. Standardschrift (`#3f3f3f`) auf jedem Hintergrund **≥ 7:1**
  (min 7,89:1; im Protokoll mit Papiertinte 13,2:1).
- **Farbwahl** (Formatierungs-Leiste → Farben) zeigt die neuen Töne. **Kopieren, E-Mail, Drucken/PDF, Webseite** und
  die Präsentation (Karten, die als HTML gezeigt werden) nehmen dieselben Werte.
- **Im Dunkeln unverändert** (M494): weiße Notiz und Protokoll im Thema mit Nachtstufen, Haftnotizen in Farbe (helles
  Papier) weiter mit BlockNotes Farben. Das Protokoll mit dunkler eigener Farbe zeigt auch im Hellen die Nachtstufen.

| Farbe | Schrift vorher → nachher (auf Weiß) | Hintergrund vorher → nachher |
|---|---|---|
| Grau | `#9b9a97` 2,81 → `#5e5d59` 6,59 | `#ebeced` → `#e3e4e6` |
| Braun | `#64473a` 8,39 → `#6e4530` 8,21 | `#e9e5e3` → `#ecdcd2` |
| Rot | `#e03e3e` 4,26 → `#b42318` 6,57 | `#fbe4e4` → `#fcd9d6` |
| Orange | `#d9730d` 3,28 → `#9a4a00` 6,26 | `#f6e9d9` → `#fde1c6` |
| Gelb | `#dfab01` 2,11 → `#7c5d00` 6,14 | `#fbf3db` → `#fbe98e` |
| Grün | `#4d6461` 6,34 → `#1e6e4e` 6,18 | `#ddedea` → `#d3ecdf` |
| Blau | `#0b6e99` 5,67 → `#0b62a8` 6,31 | `#ddebf1` → `#d6e7f7` |
| Lila | `#6940a5` 7,30 → `#6c36b5` 7,41 | `#eae4f2` → `#e7dcf6` |
| Rosa | `#ad1a72` 6,63 → `#ad1771` 6,69 | `#f4dfeb` → `#f8d9ea` |

Gegen den alten Build (`PN_DIST=<alt>`) sind 13 von 31 Prüfungen der Reihe rot (min 1,6:1), mit dem neuen 0.

## Wie (Architektur)
- **Tokens** (`src/styles/00-tokens.css`, erstes `:root`, direkt nach den Nachtstufen): `--tag-hl-<farbe>` und
  `--tag-hl-<farbe>-grund` für grau, braun, rot, orange, gelb, gruen, blau, lila, rosa. Regel beim Wählen: Schrift
  Leuchtdichte ≤ 0,121 (≥ 4,5:1 auf Rosa-Papier `#ffd6e0`, L 0,747), Hintergrund Leuchtdichte ≥ 0,73 (Standardschrift
  ≥ 7:1, Farbschrift ≥ 4,5:1).
- **Zuordnung** (`src/styles/60-dunkel-navigator-stift.css`, Block „M499: Editor-Farben auf hellem Papier“ vor dem
  M494-Block): `[data-theme='light'] .bn-root { --bn-colors-highlights-*: var(--tag-hl-*) }`. Spezifität (0,2,0) schlägt
  BlockNotes `.bn-root`-Vorgabe (0,1,0) und verliert gegen die M494-Regeln (0,3,0), z. B.
  `.minutes-card.papier-dunkel .bn-root` — so bleibt das dunkle eigene Protokollpapier bei den Nachtstufen. Im Dunkeln
  greift die Regel nicht (`data-theme` ist immer `light` oder `dark`, `App.tsx`). Das ruhende Abbild (`NotizRuhend`)
  und die Farbwahl-Muster liegen in derselben `.bn-root`.
- **Export** (`src/lib/editorFarben.ts`: `EDITOR_SCHRIFT`, `EDITOR_GRUND`): `serialize.ts` (`TEXT_FARBE`/`GRUND_FARBE`
  für `blocksToHtml`/`nodeToHtml`/`nodesToHtml`) nimmt diese Werte statt der fest eingetragenen BlockNote-Farben.
  Die Prüfreihe vergleicht Tokens und TS-Datei Wert für Wert.
- **Prüfreihen:** m499 neu (A alle Kombinationen hell ≥ 4,5:1 / Tinte ≥ 7:1, B Werte = Tokens = Export, C Dunkel
  unverändert, D Farbwahl, E Seitenfehler; `M499_BILDER=<ordner>` legt Farbtafeln hell/dunkel und die Farbwahl ab).
  **m494** Teil B: die weiße Notiz im Hellen erwartet jetzt die M499-Werte statt BlockNotes Originale (die gelbe
  Haftnotiz im Dunkeln weiter die Originale) — die Vorgabe „Hell unverändert“ aus M494 ist mit M499 bewusst
  aufgehoben. **m340** A2: Kopieren als HTML trägt `color:#b42318` statt `#e03e3e`.
- **Bildvergleich** (`werkzeug/bild-vergleich.mjs`, alter gegen neuen Build): alle 11 Standardansichten pixelgleich;
  die Farbtafel im Dunkeln (fünf Papiere + gelbes Protokoll) vorher/nachher byte-gleich.

## Grenzen / offen
- **Haftnotizen in Farbe im Dunkeln** (helles Papier, etwas gedeckter: z. B. Rosa `#e8bcc8`) zeigen weiter BlockNotes
  Originale — Vorgabe „Dunkel unverändert“. Dort ist Gelb als Schrift weiter kaum lesbar; die Hellstufen würden dort
  auf dem dunkleren Rosa nicht ganz 4,5:1 halten (Papier L ≈ 0,57) und bräuchten eine eigene, noch dunklere Stufe.
- **Frei gewählte Notiz- oder Protokollfarbe im Hellen** (Inline-Hintergrund) ist nicht geprüft: auf mittelhellen
  eigenen Farben können einzelne Farbschriften unter 4,5:1 fallen.
- Gelb als Textmarker auf gelbem Papier hebt sich nur schwach ab (Farbe, nicht Lesbarkeit: Schrift darauf ≥ 7:1).
- Markdown und WhatsApp-Text tragen keine Farben (unverändert).
