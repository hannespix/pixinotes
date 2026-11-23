# Backlog

Der Orchestrator pflegt diese Liste: offene Ideen oben, laufende mit Nummer,
erledigte wandern als Datei nach `docs/meilensteine/`. Nutzerwünsche haben
immer Vorrang vor dieser Liste.

## Läuft (Runde 2026-11-23, parallel)
| Nr. | Thema | Bereich |
|---|---|---|
| M442/M443 | Google verknüpfen, MCP-Schnittstelle | PR #119 (andere Sitzung) |
| M444 | KI: Board-Briefing (Lage des Boards auf einen Blick) | lib/aiActions, kiAnweisung |
| M445 | KI: Karten nach Themen ordnen (Auto-Clustering) | lib/arrange, KI |
| M446 | Start-Leistung: Start-Bundle verkleinern | vite.config, Nachladen |
| M447 | Barrierefreiheit: Audit + Behebung (Tastatur, ARIA, Kontrast) | Komponenten |
| M448 | Prüfreihen-Gesundheit: volle Reihe grün, Wackler stabil | pruefungen/ |
| M449 | Board-Versionen: Stände wiederherstellen (Zeitreise) | store, Speicher |
| — | Wissensbasis: HISTORIE.md, README aktualisieren | docs/ |

## Offene Punkte aus gemergten Meilensteinen
- M445: Auto-Aufräumen (nächtlich) und Pin „nicht mit ordnen“ fehlen
- M449: Versionen nur je Gerät (reisen nicht mit Sync/Export)
- M444: Risiko-Erkennung ohne KI nur Wortmuster

## Ideen (noch nicht vergeben)
- Microsoft-Graph-Anbindung (Outlook-Mails/Termine live) — Roadmap Phase 4
- Browser-Erweiterung „An PixiNotes senden" (Capture)
- Eingebaute Übersetzung der Oberfläche statt Browser-Übersetzer (UMBAU Zeile 54)
- Nächtlicher CI-Lauf aller Prüfreihen (braucht Chromium im Runner)
- BlockNote 0.31 → aktuelle Fassung – schließt die 22 „moderaten" Meldungen in tiptap/uuid (AUDIT C6), neue Editor-Funktionen – package.json, NoteCard.tsx, NotizRuhend.tsx, notizRuhend.ts
- Gemeinsames Tippen in einer Notiz (Yjs über Realtime-Broadcast, BlockNote kann Yjs) – heute sperrt das Team ganze Karten (UMBAU §5a „Später möglich") – NoteCard.tsx, lib/gastSync.ts, lib/kontoSupabase.ts
- Server-Migrationen `inhalt_pruefen` und `team_haertung` einspielen (braucht Freigabe des Besitzers) – serverseitige Prüfung der Gast-Schreibvorgänge, Stempel-Grenze, Sperr-Reihenfolge (AUDIT S9/A12/A13) – supabase/migrations/
- Fortsetzbare Uploads über 50 MB (TUS) und OneDrive-Upload-Sitzungen über 4 MB – große Anhänge im Konto-Sync (UMBAU §5a) – lib/kontoSync.ts, lib/kontoSupabase.ts
- `index.css` in Teil-Dateien je Modul aufteilen (Import-Reihenfolge erhalten) – weniger Merge-Konflikte paralleler Agenten am größten Hotspot (~8 400 Zeilen) – src/index.css, main.tsx
- `store.ts` in Scheiben schneiden (Boards, Verlauf, Sync, Team) ohne API-Bruch – Hotspot entschärfen, schnellere Orientierung (3 500 Zeilen) – src/store.ts
- Text in Bildern finden (OCR lokal, z. B. Tesseract-WASM, nachgeladen) – Screenshots durchsuchbar und für KI lesbar (KONZEPT §9, nicht umgesetzt) – ImageCard.tsx, Suche, lib/kiModule.ts
