# M446 — Start-Leistung: das Board steht schneller
PR: (siehe Merge) · Prüfreihe: `pruefungen/m446-start-leistung.mjs` (Port 5446) · Datum: 2026-11-23

## Warum
Seit M321 (Start-JS 6,3 → 3,4 MB) war der Start wieder gewachsen (3,58 MB), und ein großer Teil davon
wird fürs erste Board nie gebraucht: alle Kartentypen, Übersicht, Präsentation, Aufgaben-Zentrale —
und, unbemerkt, die Emoji-Daten und die Markdown-Kette von BlockNote.

## Was
Kein sichtbarer Verhaltenswechsel. Gemessen mit `dist/`, Board mit einer Notiz, Chromium kalt:

| | vorher | nachher |
|---|---|---|
| Start-JS (unkomprimiert, über die Leitung) | 3,58 MB (3 752 252 B) | 2,33 MB (2 441 218 B) — −35 % |
| Start-JS gzip | 1 128 KB | 757 KB |
| `editor`-Paket | 1 825 KB | 967 KB |
| eigener App-Teil (`index`) | 1 379 KB | 957 KB |
| Board sichtbar, gedrosselt (20 Mbit/s, 40 ms, CPU × 4), Median aus 5 | 3 191 ms | 2 432 ms — −24 % |
| Board sichtbar, lokal ungedrosselt | ~370 ms | ~370 ms (Rauschen) |

## Wie (Architektur)
- **`vite.config.ts` `manualChunks`:** Das Paket `editor` nimmt nur noch, was BlockNote beim Start braucht
  (`@blocknote`, `@tiptap`, `prosemirror-*`, `yjs`, `lib0`, `@mantine`, `@floating-ui`, `linkifyjs`).
  BlockNote lädt `emoji-mart` + `@emoji-mart/data` (480 KB Quelltext) und die Markdown-/HTML-Kette
  (`unified`, `remark-*`, `rehype-*`, `parse5`, `mdast/hast/micromark` …) selbst per `import()` — stand das
  in der Regex, zog manualChunks es in den Start. Das war allein rund 0,9 MB.
- **`Board.tsx` `KARTEN_LADER` + `spaet()`:** Kanban, Form, Diagramm, Zeitplan, Kalender, Woche, Tabelle,
  Protokoll, Zeit, Eigene App und Bubbles sind `React.lazy` hinter `guard()`. Platzhalter `.karte-laedt`
  (leer, in Kartengröße, `index.css` Abschnitt „Karten (gemeinsam)"). Notiz, E-Mail, Bild, Datei, Rahmen,
  Portal bleiben fest im Start. `kartenVorladen()` holt alle Kartentypen.
- **`App.tsx` `LADER` + `BeiBedarf`:** Übersicht, Aufgaben-Zentrale, Präsentation, Suche und Recherche kommen
  mit dem ersten Aufruf und bleiben danach eingehängt (Muster wie Hilfe/Einstellungen, M377/M398).
  `Suche()` hört bis zum Laden selbst auf Strg/⌘+K und gibt die Taste dann an `SearchOverlay` ab (kein
  Doppel-Umschalten). Presenter importiert die Karten-Bodies weiter statisch — er ist selbst nachgeladen.
- **`imLeerlaufVorladen()`** (App-Start, nach `VORLADEN_NACH_MS` = 4 s im `requestIdleCallback`, nicht bei
  `saveData`): holt alle nachgeladenen Teile still nach. So wartet der erste Aufruf nicht, und der Service
  Worker (stale-while-revalidate, kein Precache) hat sie auch für den Offline-Betrieb — vorher lagen alle
  Kartentypen im Start und damit garantiert im Cache.
- **`lib/konfetti.ts` `konfettiWerfen()`:** canvas-confetti erst beim ersten Wurf (NoteCard, KanbanCard,
  TaskHub). **`lib/exporter.ts`, `lib/shareCards.ts`:** html-to-image erst beim Export/Teilen.
- Ein-Datei-Fassung (`npm run build:single`, vite-plugin-singlefile): die `import()` werden eingebettet,
  per file:// laufen Tabelle, Zeitplan, Kanban und Präsentation ohne Netzanfrage (Reihe Teil F).
- Messen: Die Prüfreihe zählt alle JS-Bytes bis Board + `networkidle` (Grenze `START_JS_GRENZE` 2,5 MB,
  knapp über dem Stand). Für eine Modulübersicht je Chunk hilft ein Rollup-Plugin mit `generateBundle`
  (`chunk.modules[id].renderedLength`) — nicht eingecheckt.

## Grenzen / offen
- `chrono-node` (Fristen in Notizen, ~120 KB Quelltext) und `libphonenumber-js` (Paket `rufnummer`) bleiben
  im Start: Sie werden synchron beim Zeichnen von Notizen/E-Mails gebraucht; ein Umbau auf asynchron wäre
  ein eigener Meilenstein.
- `kontoSync`/`gastSync` (zusammen ~110 KB Quelltext) laufen beim Start an; nur bei angemeldetem Konto
  nachzuladen wäre der nächste Schritt.
- Der BlockNote-Editor selbst (967 KB) bleibt im Start — fast jedes Board hat Notizen, ein nachgeladener
  Editor hieße sichtbares Nachrücken der Notiztexte.
- `SelectionToolbar` und `FocusSheet` blieben im Start (erscheinen beim ersten Klick, ein Verzug dort fiele auf).
