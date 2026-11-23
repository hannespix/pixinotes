# M443 — MCP-Schnittstelle: KI-Programme legen Boards an, lesen und füllen sie
PR: #119 · Prüfreihe: `pruefungen/m443-mcp.mjs` · Datum: 2026-11-23 · Anleitung: `docs/MCP.md`

## Warum
Nutzerwunsch: „Ich hätte gerne eine MCP-Schnittstelle, dass ich mit KI-Modellen von außen einfach ein Board
erstellen/bearbeiten/füllen kann. Auch die Spezial-Module sollen optimal durch die MCP genutzt werden können."

## Was
- Claude, Cursor & Co. legen Boards an (in Bereich/Projekt), lesen sie samt Kennungen und füllen/ändern sie mit allen
  Modulen: Notiz (Markdown), Kanban, Zeitplan, Rechen-Tabelle mit Formeln, Wochenplaner, Protokoll, Zeiterfassung,
  Ideen, Diagramm, Formen, Rahmen, Pfeile; dazu Karten verschieben und in der Größe ändern.
- Der Server schreibt in den Sync-Ordner; die App übernimmt die Änderung von allein (Drei-Wege-Abgleich) und behält,
  was der Mensch inzwischen getippt hat. Alternativ Datei oder PixiNotes-Konto.
- Einrichtung eingeklappt unter Dienste → KI-Assistent → „KI-Programme von außen (MCP)": Download + Eintrag zum Kopieren.

## Wie (Architektur)
- `release/pixinotes-mcp.mjs` = `npm run build:mcp` (`werkzeug/mcp-bauen.mjs`, esbuild, eine Datei, Node ≥ 18).
  Ein Plugin lenkt jeden Import von `src/store.ts` auf `mcp/storeShim.ts` (Speicher im Arbeitsspeicher) um; ein Banner
  stellt `localStorage`/`window`/`navigator`/`document`-Attrappen bereit.
- `mcp/server.ts`: Werkzeuge `pixinotes_uebersicht`, `_board_lesen`, `_board_anlegen`, `_bearbeiten` (1–80 Ops),
  `_board_umbenennen`; `aendern()` liest neu und wiederholt bei `Konflikt`.
- `mcp/motor.ts`: `boardLesen` (kiLesen je Karte + Pfeile), `boardAnlegen`, `markdownZuBloecken`, `platzierer`
  (Reihen zu dritt unter dem Inhalt), `ausfuehren` (Op für Op über `planAusfuehren` mit `km`), `opsBeschreibung`
  (= `GRUND_OPS` + `kiOpsText` aller Module + move/resize).
- `lib/kiPlan.ts` (neu): `GRUND_OPS`, `planAusfuehren`, `AiOp` aus `kiAnweisung.ts` herausgelöst – App-KI und MCP
  teilen dieselben Operationen.
- `mcp/speicher.ts`: `dateiSpeicher` (`pixinotes-daten.json`, mtime-Konflikt, atomar per tmp+rename, fremde Felder
  bleiben) und `kontoSpeicher` (Passwort-Anmeldung, `board-<id>.json` upsert, `umgebung.json` per PATCH mit
  `version=eq.<etag>`, Stempel wie `kontoSync.ts`).
- Build: `vite.config.ts` leert `release/` im Single-Modus nicht mehr; `pages.yml` legt die Datei neben die App,
  `release.yml` baut sie nach jedem Merge mit.
- Settings: `MCP_DATEI` (relativ, unter file:// die Website), `mcpKonfig()` (Platzhalter in der Sprache der Oberfläche,
  als `<code>` unübersetzt), Taste `mcp`.

## Grenzen / offen
- Konto-Weg braucht ein Konto mit Passwort (nicht nur Magic Link/Google).
- Dateien/Anhänge (PDF, Bilder) legt der Server nicht an – nur Inhalte, die als Daten in den Karten stehen.
