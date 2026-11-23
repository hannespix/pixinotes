# Backlog

Der Orchestrator pflegt diese Liste: offene Ideen oben, laufende mit Nummer,
erledigte wandern als Datei nach `docs/meilensteine/`. Nutzerwünsche haben
immer Vorrang vor dieser Liste.

## Läuft
| Nr. | Thema |
|---|---|
| M484 | Flatternde Prüfreihen stabilisieren (m414, m383, m387, m428, m477; Läufer `--wiederhole N`) |

## Offene Punkte aus gemergten Meilensteinen
- M449: Versionen nur je Gerät (reisen nicht mit Sync/Export)
- M470: Versionen holen Gespräche (Kommentare) nicht einzeln zurück (Spaltenzeit im Abgleich → erledigt in M472)
- M458: Erweiterung nicht im Chrome-/Edge-/Firefox-Store (nur „Entpackt laden“); kein Weg in die portable pixinotes.html (Schnellablage → erledigt in M478 „Eingang“)
- M478: Eingang ohne E-Mail-Eingang (`board@pixinotes`, KONZEPT „Inbox-Ecke“); Option je Gerät, nicht je Konto („in eine Notiz einfügen“ → erledigt in M488)
- M488: In eine Notiz nur Text, Links und eingebettete Bilder (E-Mail, PDF, Dateien in der Geräte-Ablage landen als Karte daneben); Ablagestelle nur bei offener Notiz und nur zwischen obersten Blöcken
- M473: Serien ohne `BYHOUR`/`BYWEEKNO`/`BYYEARDAY` und nicht stündlich; Export über einen Zeitraum nimmt Serien nur im sichtbaren Fenster mit; stille Google-Erneuerung scheitert ohne Geste meist (dann Hinweis in der Zentrale)
- M477/M487: Gemeinsam tippen in Notizen, Protokoll und Kanban-Tickets (Titel, Beschreibung) — offen: Präsentation (Folien-Editor) und übrige Ticket-Felder (Person, Checkliste) sowie Tabellen; eingesammelte Tickets (Quelle in anderer Karte) bleiben beim alten Weg; Mitwirkende mit älterer App-Fassung sperren die Notiz weiter; Kanal-Teilnehmer ohne Schreibrecht könnten mit einem manipulierten Programm Text unterschieben, den der Schreiber speichert (Server prüft Notiz-Inhalte nicht je Absender)
- M480: `store/struktur.ts` und `store/karten.ts` mit je ~650 Zeilen noch die größten Scheiben (Portale aus Karten, Stände/Zurückholen aus Struktur herauslösen, wenn sie wieder Konfliktherd werden)
- M481: Nachbarn weichen nur einstufig aus (keine Kettenreaktion, ein Nachbar kann auf einen dritten gleiten); Linien zeigen während des Zugs auf die ungehobene Lage (→ erledigt in M485)
- M482: Codeblöcke innerhalb einer Notiz werden mitgeprüft (→ erledigt in M485)
- M466: Outlook nur lesen und auf Abruf (kein Abo/Delta-Abgleich, keine Ordner außer Posteingang, kein Antworten über Graph); braucht `VITE_MS_CLIENT_ID` im Build

## Ideen (noch nicht vergeben)
- Eingebaute Übersetzung der Oberfläche statt Browser-Übersetzer (UMBAU Zeile 54)
- Server-Migrationen `inhalt_pruefen` und `team_haertung` einspielen (braucht Freigabe des Besitzers) – serverseitige Prüfung der Gast-Schreibvorgänge, Stempel-Grenze, Sperr-Reihenfolge (AUDIT S9/A12/A13) – supabase/migrations/
- Fortsetzbare Uploads über 50 MB (TUS) und OneDrive-Upload-Sitzungen über 4 MB – große Anhänge im Konto-Sync (UMBAU §5a) – lib/kontoSync.ts, lib/kontoSupabase.ts
