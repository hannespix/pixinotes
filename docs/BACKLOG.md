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
- M449: Versionen nur je Gerät (reisen nicht mit Sync/Export)
- M463: „lange in Arbeit“ misst die Kanban-Karte, nicht das einzelne Ticket (Tickets tragen keine eigene Zeit)
- M458: Erweiterung nicht im Chrome-/Edge-/Firefox-Store (nur „Entpackt laden“); kein Weg in die portable pixinotes.html; keine feste Schnellablage-Zone (KONZEPT „Inbox-Ecke“)
- M466: Outlook nur lesen und auf Abruf (kein Abo/Delta-Abgleich, keine Ordner außer Posteingang, kein Antworten über Graph); Konto-Termine stehen wie bisher nur in der Kalender-Karte, nicht in der Aufgaben-Zentrale; braucht `VITE_MS_CLIENT_ID` im Build

## Ideen (noch nicht vergeben)
- Eingebaute Übersetzung der Oberfläche statt Browser-Übersetzer (UMBAU Zeile 54)
- Gemeinsames Tippen in einer Notiz (Yjs über Realtime-Broadcast, BlockNote kann Yjs) – heute sperrt das Team ganze Karten (UMBAU §5a „Später möglich") – NoteCard.tsx, lib/gastSync.ts, lib/kontoSupabase.ts
- Server-Migrationen `inhalt_pruefen` und `team_haertung` einspielen (braucht Freigabe des Besitzers) – serverseitige Prüfung der Gast-Schreibvorgänge, Stempel-Grenze, Sperr-Reihenfolge (AUDIT S9/A12/A13) – supabase/migrations/
- Fortsetzbare Uploads über 50 MB (TUS) und OneDrive-Upload-Sitzungen über 4 MB – große Anhänge im Konto-Sync (UMBAU §5a) – lib/kontoSync.ts, lib/kontoSupabase.ts
- `index.css` in Teil-Dateien je Modul aufteilen (Import-Reihenfolge erhalten) – weniger Merge-Konflikte paralleler Agenten am größten Hotspot (~8 400 Zeilen) – src/index.css, main.tsx
- `store.ts` in Scheiben schneiden (Boards, Verlauf, Sync, Team) ohne API-Bruch – Hotspot entschärfen, schnellere Orientierung (3 500 Zeilen) – src/store.ts
