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
- Eigene Stile (`textSize`, `textFont`) rendert BlockNote 0.57 als Mark-View (Hülle
  `.react-renderer.mark-textSize` + Span mit Stil). Gespeichertes JSON und die ruhende Darstellung sind
  unverändert; die Optik ist gleich.
- `editor.prosemirrorView` (Android-Fix M110) und `tryParseMarkdownToBlocks` (KI, M117/M332) bestehen
  weiter; `_headless` wird ignoriert (ein ungemounteter Editor ist von selbst kopflos).
- Start-JS (`pruefungen/m446-start-leistung.mjs`): Editor-Paket 990 KB → 1.039 KB (+21 KB gzip, Tiptap 3 +
  Mantine 8 + frimousse statisch in `@blocknote/react`). Start gesamt 2,52 MB; Grenze A1 von 2,5 auf
  **2,6 MB** angehoben (begründet im Kopf der Reihe). Grenze A4 (Editor < 1,1 MB, keine Emoji-Daten) hält.
- Fixture `pruefungen/daten/m462-notizen-blocknote031.json`: zwei Notizen, die der **alte** Build
  (0.31.3) gespeichert hat — Überschriften 1–3, Inline-Stile inkl. textSize/textFont, Link, Haken,
  verschachtelte Liste, Nummern, Ausrichtung + Blockfarben, Zitat, Codeblock, Rechentabelle, alte
  Tabelle, Bild als Daten-URL mit Bildunterschrift. Neu erzeugen: alten Stand bauen, Notizen mit diesen
  Teil-Blöcken anlegen, einmal tippen (der Editor schreibt dann das volle JSON), `localStorage` lesen.

## Prüfreihe m462
A Altbestand ruhend · B geweckt (h1–h3, Haken, Stile, Ausrichtung, Rechentabelle, alte Tabelle, Bild) ·
C Bearbeiten/Speichern/Neuladen ohne Blockverlust, einfache Alt-Notiz ruht auch nach dem Speichern mit
dem neuen Editor · D Einfügen-Menü deutsch, eine Tabelle, Bild ja/Video nein, keine 0.57-Neuheiten ·
E Überschrift, Checkliste, Rechentabelle über das Menü · F Formatier-Leiste A+ → `textSize` · G keine
Seitenfehler.

## Grenzen / offen
- Die Block-Typ-Auswahl der Formatier-Leiste zeigt die aufklappbare Liste aus 0.57 weiterhin an (nur das
  Einfügen-Menü ist gefiltert).
- Links im Editor tragen ein wirkungsloses Attribut `classname` (Fehler in BlockNote 0.57, harmlos).
- Gemeinsames Tippen per Yjs (Backlog) ist mit 0.57 möglich, aber nicht Teil dieses Schritts.
