# M462 — Editor-Bibliothek aktualisiert (BlockNote 0.31 → 0.57)
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m462-blocknote.mjs` (Port 5462) · Datum: 2026-11-23

## Warum
Audit-Befund C6 (`docs/AUDIT.md`): 22 „moderate" npm-Meldungen in tiptap/uuid hingen an BlockNote 0.31
(Tiptap 2). Sie ließen sich nur über den großen Versionssprung auf eine aktuelle BlockNote-Fassung lösen.

## Was
- Notizen, Protokoll und Präsentation laufen mit **BlockNote 0.57.0** (Tiptap 3.31, ProseMirror aktuell,
  Mantine 8.3). Für Nutzer ändert sich nichts Sichtbares: gleiches Einfügen-Menü, gleiche Formatier-Leiste.
- **Altbestand lädt unverändert.** Das Block-JSON hat sich zwischen 0.31 und 0.57 nicht geändert (gleiche
  Blocktypen, Eigenschaften, `tableContent` mit `tableCell`, Inline-Stile, Links). Eine Migration ist nicht
  nötig; geprüft mit echtem 0.31-JSON (siehe Prüfreihe).
- `npm audit`: vorher **36** Meldungen (7 niedrig, **25 moderat**, 4 hoch), nachher **16** (7 niedrig,
  **5 moderat**, 4 hoch). Alle tiptap-/BlockNote-Meldungen sind weg; `uuid` bleibt nur noch über mermaid.
  Übrig sind Werkzeug-Abhängigkeiten (vite, postcss, browserslist, Polyfills) und mermaid/katex.

## Wie (Architektur)
- `package.json`: `@blocknote/core|react|mantine` `^0.57.0`; **neu ausdrücklich** `@mantine/core` und
  `@mantine/hooks` `^8.3.18` — sie sind bei `@blocknote/mantine` 0.57 Peer-Abhängigkeiten (Mantine 9
  verlangt React 19, deshalb 8).
- `components/NoteTypo.tsx`
  - `createReactBlockSpec` liefert jetzt eine **Fabrik**: Schema nimmt `RechenTabelleBlock()`.
  - Überschrift über `createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: false })`. Ohne das
    trüge jede neu gespeicherte Überschrift die Eigenschaft `isToggleable`, und `lib/notizRuhend.ts`
    (`PROPS`) hätte jede Notiz mit Überschrift aus der ruhenden Darstellung (M338) geworfen.
  - `useEditorContentOrSelectionChange` gibt es nicht mehr → `useEditorChange` + `useEditorSelectionChange`.
  - `FormattingToolbarController`: `floatingOptions` heißt `floatingUIOptions.useFloatingOptions`
    (`strategy: 'fixed'`, M267 bleibt).
  - `Components.Generic.Menu.Root` verlangt `portalElement` → `usePortalElement()` (Aa-Menü).
  - Einfügen-Menü: die Neuheiten aus 0.57 (`toggle_list`, `divider`, `heading_4–6`, `toggle_heading*`)
    werden herausgefiltert (`NEUE_BLOECKE_057`) — „Weniger ist mehr", und ruhende Notiz, Export und
    Handschrift kennen diese Blöcke nicht. Im Schema bleiben sie (eingefügter Inhalt von außen scheitert
    nicht; die ruhende Notiz fällt bei unbekannten Typen ohnehin auf den Editor zurück).
- `vite.config.ts` (`manualChunks`): BlockNote 0.57 legt die Emoji-Namen je Sprache (frimousse, 20
  Dateien à 75–190 KB) als eigene Module in `@blocknote/core/dist` ab und lädt sie per `import()`. Die
  Editor-Regel zog sie in den Start (Editor-Paket 4,2 MB). Module, die nur dynamisch erreicht werden
  (`getModuleInfo`: keine statischen, aber dynamische Importeure), bleiben jetzt eigene Nachlade-Teile.
- **Strg+A** markiert wie bisher die ganze Notiz: `selectAllBehavior: 'document'` in `NoteCard`,
  `MinutesCard`, `Presenter` (0.57 markiert sonst erst den Block).
- **Schluss-Absatz:** 0.31 hängte nach der ersten Änderung einen leeren Absatz an (und speicherte ihn).
  0.57 zeigt stattdessen eine Klickfläche `.bn-trailing-block` (30px, nie gespeichert). `index.css`: eine
  leere Zeile hoch (`1.5em`) und nur mit Fokus im Editor — sonst wüchse jede Karte schon beim Wecken
  (Fokus-Zoom M333) und die ruhende Notiz bräuchte eine Nachbildung. In Formen ganz ausgeblendet
  (wie der leere Absatz in M436). `NotizRuhend` hängt keinen Schluss-Absatz mehr an (`hatNummern`/`SCHLUSS`
  entfallen).
- **Gleiches Bild wie vorher, ruhend wie wach (M338):**
  - Listen: 0.57 setzt die Marke in eine 24px-Spalte und den Haken in eine 24px-Zeile mit eigenen Rändern;
    ein Block in `index.css` stellt die kompakte Form aus 0.31 her (gemessen: gleiche Lagen wie 0.31).
  - Haken-Block: 0.57 legt Haken und Text ohne Hülle direkt in den Block — `NotizRuhend` ebenso.
  - Farben: Die Variablen `--bn-colors-*` hängen jetzt an `.bn-root` (vorher `.bn-container`); die ruhende
    Notiz trägt die Klasse mit (sonst Schwarz statt Editor-Grau und keine Blockfarben).
  - Überschrift Stufe 1 hat kein `data-level` mehr (Vorgabewert wird weggelassen). CSS-Regeln für H1
    lauten `:is([data-level='1'], :not([data-level]))`; `NotizRuhend` lässt das Attribut bei Stufe 1 ebenso weg.
- Eigene Stile (`textSize`, `textFont`) rendert BlockNote 0.57 als Mark-View (Hülle
  `.react-renderer.mark-textSize` + Span mit Stil). Gespeichertes JSON und die ruhende Darstellung sind
  unverändert; die Optik ist gleich.
- `editor.prosemirrorView` (Android-Fix M110) und `tryParseMarkdownToBlocks` (KI, M117/M332) bestehen
  weiter; `_headless` wird ignoriert (ein ungemounteter Editor ist von selbst kopflos).
- **Emoji-Auswahl nachgeladen:** `@blocknote/react` 0.57 importiert die Emoji-Auswahl `frimousse` (~27 KB) statisch.
  Das Plugin `frimousseNachladen()` in `vite.config.ts` lenkt „frimousse" für alle Module auf
  `src/lib/frimousseNachladen.tsx`; der Nachlader lädt das echte Paket beim ersten Öffnen (`EmojiPicker.Root` mit
  eigener Suspense-Grenze; die übrigen Teile und `useSkinTone` laufen nur innerhalb von Root). Wie früher
  emoji-mart in 0.31. Die Emoji-Daten kommen offline aus `@blocknote/core/emoji-data` (eigene Nachlade-Teile).
- **Start-JS** (gemessen mit `dist/`, Stand nach Einmischen von M467): Editor-Paket 959 887 B → 1 010 260 B;
  Start gesamt 2 170 290 B → **2 220 718 B (+50 KB)**. Ohne den Nachlader wären es 2 246 608 B gewesen. Gewachsen
  sind Tiptap 3 / BlockNote-Kern (+59 KB Quelltext), `@floating-ui/react` (+38 KB), `@blocknote/react` (+17 KB),
  Mantine (+8 KB); weggefallen sind yjs, y-prosemirror, lib0 und linkifyjs (0.57 bindet sie nur noch für
  Zusammenarbeit an). Grenze `START_JS_GRENZE` in **m446, m459 und m467** von 2 190 000 auf **2 240 000 B**
  angehoben (Kommentar in allen drei Reihen); A4 (Editor < 1,1 MB, keine Emoji-Daten) hält. Weiter kürzen ginge nur,
  wenn der Editor selbst nachgeladen würde (M446 hat das bewusst verworfen: sichtbares Nachrücken der Notizen) —
  bzw. die mitgebündelte Kommentar-/Versions-Oberfläche von BlockNote (`bn-thread` …) aus `BlockNoteView` fiele.
- Fixture `pruefungen/daten/m462-notizen-blocknote031.json`: zwei Notizen, die der **alte** Build
  (0.31.3) gespeichert hat — Überschriften 1–3, Inline-Stile inkl. textSize/textFont, Link, Haken,
  verschachtelte Liste, Nummern, Ausrichtung + Blockfarben, Zitat, Codeblock, Rechentabelle, alte
  Tabelle, Bild als Daten-URL mit Bildunterschrift. Neu erzeugen: alten Stand bauen, Notizen mit diesen
  Teil-Blöcken anlegen, einmal tippen (der Editor schreibt dann das volle JSON), `localStorage` lesen.

- Angepasste alte Reihen: `m372` (Schreibhinweis steht seit 0.57 als `::after` am Block — Messung liest beide;
  die M372-Regel in `index.css` blendet auch das `::after` ohne Fokus aus), `m283` (T4: Zelle mit echtem Klick statt per Skript gesetzter DOM-Auswahl ohne
  Fokus — die übernimmt ProseMirror nicht mehr), `m338` (B2: 17 statt 18 Blöcke, kein angehängter
  Schluss-Absatz), `m416` (A6: H1-Selektor ohne `data-level`), `m446`, `m459`, `m467` (Grenze).

## Prüfreihe m462
A Altbestand ruhend · B geweckt (h1–h3, Haken, Stile, Ausrichtung, Rechentabelle, alte Tabelle, Bild) ·
C Bearbeiten/Speichern/Neuladen ohne Blockverlust, einfache Alt-Notiz ruht auch nach dem Speichern mit
dem neuen Editor · D Einfügen-Menü deutsch, eine Tabelle, Bild ja/Video nein, keine 0.57-Neuheiten ·
E Überschrift, Checkliste, Rechentabelle über das Menü · F Formatier-Leiste A+ → `textSize` · G keine
Seitenfehler · H Emoji-Bibliothek nicht im Start, „/Emoji" öffnet die Auswahl und fügt ein.

## Grenzen / offen
- Die Block-Typ-Auswahl der Formatier-Leiste zeigt die aufklappbare Liste aus 0.57 weiterhin an (nur das
  Einfügen-Menü ist gefiltert).
- Links im Editor tragen ein wirkungsloses Attribut `classname` (Fehler in BlockNote 0.57, harmlos).
- Gemeinsames Tippen per Yjs (Backlog) ist mit 0.57 möglich, aber nicht Teil dieses Schritts.
