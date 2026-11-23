# Backlog

Der Orchestrator pflegt diese Liste: offene Ideen oben, laufende mit Nummer,
erledigte wandern als Datei nach `docs/meilensteine/`. Nutzerwünsche haben
immer Vorrang vor dieser Liste.

## Läuft
| Nr. | Thema |
|---|---|
| M477 | Gemeinsam in einer Notiz tippen (Yjs) |
| M480 | `store.ts` in Scheiben (nach M477) |

## Offene Punkte aus gemergten Meilensteinen
- M449: Versionen nur je Gerät (reisen nicht mit Sync/Export)
- M470: Versionen holen Gespräche (Kommentare) nicht einzeln zurück (Spaltenzeit im Abgleich → erledigt in M472)
- M458: Erweiterung nicht im Chrome-/Edge-/Firefox-Store (nur „Entpackt laden“); kein Weg in die portable pixinotes.html (Schnellablage → erledigt in M478 „Eingang“)
- M478: Eingang ohne „in eine Notiz einfügen“ und ohne E-Mail-Eingang (`board@pixinotes`, KONZEPT „Inbox-Ecke“); Option je Gerät, nicht je Konto
- M473: Serien ohne `BYHOUR`/`BYWEEKNO`/`BYYEARDAY` und nicht stündlich; Export über einen Zeitraum nimmt Serien nur im sichtbaren Fenster mit; stille Google-Erneuerung scheitert ohne Geste meist (dann Hinweis in der Zentrale)
- M477: Gemeinsam tippen nur in Notizen (nicht Protokoll, Präsentation, Kanban-Texte); Mitwirkende mit älterer App-Fassung sperren die Notiz weiter; Kanal-Teilnehmer ohne Schreibrecht könnten mit einem manipulierten Programm Text unterschieben, den der Schreiber speichert (Server prüft Notiz-Inhalte nicht je Absender)
- M466: Outlook nur lesen und auf Abruf (kein Abo/Delta-Abgleich, keine Ordner außer Posteingang, kein Antworten über Graph); braucht `VITE_MS_CLIENT_ID` im Build

## Ideen (noch nicht vergeben)
- Eingebaute Übersetzung der Oberfläche statt Browser-Übersetzer (UMBAU Zeile 54)
- Server-Migrationen `inhalt_pruefen` und `team_haertung` einspielen (braucht Freigabe des Besitzers) – serverseitige Prüfung der Gast-Schreibvorgänge, Stempel-Grenze, Sperr-Reihenfolge (AUDIT S9/A12/A13) – supabase/migrations/
- Fortsetzbare Uploads über 50 MB (TUS) und OneDrive-Upload-Sitzungen über 4 MB – große Anhänge im Konto-Sync (UMBAU §5a) – lib/kontoSync.ts, lib/kontoSupabase.ts
- `store.ts` in Scheiben schneiden (Boards, Verlauf, Sync, Team) ohne API-Bruch – Hotspot entschärfen, schnellere Orientierung (3 500 Zeilen) – src/store.ts
