# CLAUDE.md — Einstieg für Agenten und LLMs (PixiNotes)

Diese Datei liest jeder Agent zuerst. Sie sagt, **was** PixiNotes ist, **wie**
hier gearbeitet wird und **wo** das Wissen liegt. Antworten, Oberfläche,
Bezeichner und Commit-Texte sind **Deutsch**.

## 1. Produkt in drei Sätzen
Browserbasiertes, unendliches Whiteboard für den Büroalltag: E-Mails, Dateien,
Notizen (BlockNote), Kanban, Gantt, Tabellen mit Formeln, Diagramme als Karten
auf einer React-Flow-Fläche. Local-first (localStorage + IndexedDB), optional
Sync über Ordner/WebDAV/Konto (Supabase) und Live-Team (Realtime), KI-Aktionen
mit eigenem Schlüssel oder Ollama. Läuft als Web-App (GitHub Pages) **und** als
eine portable HTML-Datei (`release/pixinotes.html`).

Leitbild: **„Weniger ist mehr"** (`docs/UMBAU.md` §2) — ruhige, flache
Oberfläche, Bedienung erst im Fokus, keine neuen Knöpfe ohne Grund.

## 2. Wissenskarte
| Was | Wo |
|---|---|
| Vision, Datenmodell, Architektur, Roadmap | `docs/KONZEPT.md` |
| Leitsätze + Etappen-Tabelle bis M441 (Architektur-Notizen je Meilenstein) | `docs/UMBAU.md` §4 |
| Meilensteine ab M442 (eine Datei je Meilenstein) | `docs/meilensteine/` |
| Entwicklungsgeschichte (Phasen, Wendepunkte, Lehren) | `docs/HISTORIE.md` |
| Arbeitsweise mehrerer Agenten parallel | `docs/AGENTEN.md` |
| MCP-Server für KI-Programme von außen (`mcp/`, `npm run build:mcp`) | `docs/MCP.md` |
| Audits (Design, Logik, Code/Security) mit Befund-Listen | `docs/AUDIT.md` |
| Einrichtung für den Betreiber (Google, Microsoft, Supabase, Variablen) | `docs/EINRICHTUNG.md` |
| E2E-Prüfreihen (eine je Meilenstein) | `pruefungen/` + `pruefungen/README.md` |
| Werkzeuge (Prüfungen parallel, Sprache, App-Zeichen) | `werkzeug/` |
| Server (Supabase-Migrationen, RLS) | `supabase/migrations/` |

**Wichtig:** Vor einer Änderung an einem Bereich in `docs/UMBAU.md` und
`docs/meilensteine/` nach dem Dateinamen bzw. der Funktion suchen
(`grep -n "FocusSheet" docs/UMBAU.md docs/meilensteine/*`). Dort steht, warum
etwas so gebaut ist — viele scheinbar umständliche Lösungen sind Antworten auf
konkrete Fehler.

## 3. Stack und Struktur
React 18 + TypeScript (strict, `noUnusedLocals/Parameters`), Vite 6, Zustand
(`src/store.ts`, ein Store), `@xyflow/react` (Fläche), BlockNote (Notizen),
pdf.js, mermaid, chrono-node, libphonenumber-js. Keine Test-Bibliothek: geprüft
wird **Ende-zu-Ende mit playwright-core** gegen den gebauten `dist/`.

```
src/App.tsx            Rahmen, Ansichten, Overlays
src/store.ts           Zustand-Store: Boards, Karten, Verlauf (Undo), Sync-Haken
src/types.ts           Datenmodell (Karte = Node mit data je Typ)
src/components/        Oberfläche; nodes/ = ein Kartentyp je Datei (*Card.tsx)
src/lib/               Logik ohne JSX (ein Thema je Datei, deutsche Namen)
src/sprache/en.json    englische Oberfläche (werkzeug/sprache-*.mjs)
src/index.css          nur @import der Teildateien in fester Reihenfolge (M475)
src/styles/NN-*.css    Stylesheet je Bereich; 00-tokens = CSS-Variablen/Hell/Dunkel,
                       99-bedienung-im-fokus = M421-Listen (immer zuletzt)
pruefungen/mNNN-*.mjs  E2E-Reihe je Meilenstein
release/               portable Single-File + PWA-Beiwerk
```

Hotspots (viele Änderungen, Konfliktgefahr): `store.ts`, `src/styles/`,
`Board.tsx`, `App.tsx`, `HelpOverlay*.tsx`, `Settings.tsx`.

## 4. Befehle
```bash
npm ci                                   # ~10 s
npm run check                            # nur Typprüfung (tsc), ~15 s
npm run build                            # tsc + Web-Build nach dist/, ~30 s
npm run build:single                     # portable release/pixinotes.html
node pruefungen/m441-fokus-wischen.mjs   # eine Prüfreihe (braucht dist/)
node werkzeug/alle-pruefungen.mjs m43 m44 --bahnen 4   # mehrere parallel
```
Chromium: `/opt/pw-browsers/chromium` (sonst `PW_CHROMIUM=…`).

## 5. Arbeitsweise (vollautomatisch)
- **Hauptzweig** (Default, deployt): `claude/notes-whiteboard-design-bnwvxj`.
  Jeder Push dorthin baut und veröffentlicht GitHub Pages
  (<https://hannespix.github.io/pixinotes/>).
- **Meilensteine** `M<Nummer>` fortlaufend; jede sichtbare Änderung bekommt
  eine Nummer. Nächste freie Nummer: höchste aus `docs/meilensteine/`,
  `pruefungen/` und offenen PR-Titeln + 1. Parallel arbeitende Agenten
  bekommen ihre Nummer vom Orchestrator.
- **Ablauf je Aufgabe:** eigener Branch → Änderung → `npm run build` →
  neue Prüfreihe `pruefungen/mNNN-thema.mjs` + betroffene alte Reihen grün →
  `docs/meilensteine/MNNN-thema.md` → Commit → PR auf den Hauptzweig →
  **sofort selbst mergen**, wenn PR-Prüfung (`.github/workflows/pruefen.yml`)
  und lokale Reihen grün sind. Keine Rückfrage, kein Warten auf Review.
- **`release/pixinotes.html` nie im PR ändern.** Die Datei baut und committet
  der Workflow `release.yml` nach jedem Merge selbst (ebenso den MCP-Server
  `release/pixinotes-mcp.mjs`, M443) (vorher war sie die
  häufigste Konfliktquelle zwischen parallelen PRs).
- **Keine Zeilen mehr an die Etappen-Tabelle in `docs/UMBAU.md` anhängen** —
  stattdessen `docs/meilensteine/MNNN-*.md` (Vorlage dort im README).
- Vor dem Merge den Hauptzweig einmischen (`git fetch origin <haupt> && git
  merge origin/<haupt>`), Konflikte lösen, erneut bauen.
- Hilfe-Texte: neue Funktionen kurz in `HelpOverlay.tsx` **und**
  `HelpOverlayEn.tsx`; neue Oberflächentexte englisch in `src/sprache/en.json`
  (`node werkzeug/sprache-ernten.mjs` zeigt, was fehlt).

## 6. Konventionen
- Deutsch in Bezeichnern (`kartenFolge`, `fokusAnsicht`), Kommentare erklären
  das **Warum** und nennen den Meilenstein (`// M421: …`).
- Keine Emojis in der Oberfläche (Prüfreihe m397, `werkzeug/ohne-emoji.mjs`);
  Symbole aus `components/Icons.tsx`.
- Neue Bedien-Elemente in Karten in die drei Listen des Blocks „Bedienung nur
  im Fokus" in `src/styles/99-bedienung-im-fokus.css` eintragen (M421).
- CSS: neue Regeln in die Teildatei ihres Bereichs unter `src/styles/` (an den
  thematisch passenden Abschnitt, nicht ans Dateiende), nie in `src/index.css`
  (dort nur @import, Prüfreihe m475). Neue Teildatei = freie Nummer zwischen den
  Nachbarn + @import an derselben Stelle; die Nummern geben die Kaskade vor,
  `99-…` bleibt zuletzt. Ein Umbau, der nur verschieben soll, wird mit
  `werkzeug/css-vergleich.mjs` (gebautes CSS) und `werkzeug/bild-vergleich.mjs`
  (Bildschirmfotos zweier Builds) belegt (M475).
- Neue Tastenkürzel nur hinter `overlayOffen()` (`lib/overlay.ts`).
- Eigene Mauszeiger nur über `--zeiger-*` im ersten `:root` von `src/styles/00-tokens.css` bzw. `lib/zeiger.ts`, immer mit Kontur und System-Fallback; kein nacktes `crosshair`, `cursor: none` nur mit sichtbarem Ersatz (M464).
- Zähl-Texte über `zahlWort(n, 'Karte', 'Karten')` in `lib/sprache.ts` — nie `${n} Karten` oder „Karte(n)" (M461).
- Neue Zeit-/Merkfelder, die jedes Gerät selbst stempelt (wie `geaendert`, `spalteSeit`), in die Listen von `lib/abgleichZeiten.ts` eintragen — sonst erzeugen sie im Abgleich Schein-Konflikte (M472).
- Daten von außen (Links, Dateien, Sync, Live-Kanal) laufen durch
  `lib/sicher.ts`.
- Schweres nachladen (`import()`), nicht in den Start-Bundle ziehen (M321).
- Prüfreihen messen **Verhalten** (Pixel, Downloads, abgefangene Anfragen),
  nicht Klassennamen. Jede Reihe startet ihren eigenen Server auf einem festen
  Port — neue Reihen nehmen einen freien Port (siehe `docs/AGENTEN.md`).
- Commits: Betreff = was der Nutzer merkt (deutsch, ohne Präfix), Rumpf = warum.
