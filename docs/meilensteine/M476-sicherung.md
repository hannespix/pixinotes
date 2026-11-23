# M476 — Einfache Sicherung: ein Board oder alles sichern und wieder einspielen
PR: #162 · Prüfreihe: `pruefungen/m476-sicherung.mjs` (Port 5476) · Datum: 2026-11-23

## Warum
Nutzerwunsch: „einfache Backup funktion wäre top. Einzelne board als backup/alle boards als backup sichern.
einspielbar, lokal etc". Es gab schon zwei fast gleiche Dateien – Board-⋯ „Als Datei sichern" (`.pixiboard.json`)
und Einstellungen → Daten „Datei exportieren" (`pixinotes-daten-….json`) –, beide mit Anhängen als Base64 im
JSON, und „Datei laden" ersetzte ohne Vorschau alles (nur ein `window.confirm`).

## Was
- **Ein Board sichern:** ⋯ des Boards (Seitenleiste, Übersicht) → **„Sicherung herunterladen"** →
  `PixiNotes-<Board>-<JJJJ-MM-TT>.pixinotes` mit Bildern, PDFs/Dateien (Gerätespeicher), Tool-Quelltexten,
  Kommentaren, Strichen und den Vorlagen. Auch Strg+K „Sicherung dieses Boards". Der Link-Teilen-Ausweg für große
  Boards (Board-⋯, Karten teilen, Link-Dialog) liefert dieselbe Datei.
- **Alles sichern:** Einstellungen → Daten → **„Alles sichern"** (Strg+K „Alles sichern") →
  `PixiNotes-Alles-<Datum>.pixinotes`: Bereiche, Projekte, Boards, Vorlagen, Anhänge, Vorlieben (Aussehen/Bedienung).
- **Einspielen:** Datei aufs Board ziehen, Einstellungen → „Sicherung einspielen…" oder Strg+K
  „Sicherung einspielen". Vorschau (`SicherungDialog`): Art, Datum, Zahl der Boards/Karten/Dateien/Vorlagen/Bereiche,
  Boardnamen, Hinweis auf weggelassene ungültige Teile. Wahl:
  - **Als Kopie hinzufügen** (Standard): frische Kennungen für Boards, Karten, Bereiche, Projekte; Verweise
    innerhalb der Sicherung (Pfeile, Rahmen-Kinder, Striche, Kommentare, Portale, Ticket-Verknüpfungen) ziehen mit;
    gleichnamige Boards bekommen „(Sicherung TT.MM.JJJJ)", Bereiche immer.
  - **Vorhandene ersetzen:** Boards mit gleicher Kennung bekommen den Stand der Datei – vorher je Board eine Version
    (M449, Grund `import`); Boards, die nur hier liegen, bleiben; bei „alles" ersetzen Bereiche gleicher Kennung die
    hiesigen, eigene Bereiche bleiben, hier liegende Boards ohne Platz kehren in ihr Projekt zurück; Vorlieben werden
    übernommen.
  - Danach ein Hinweis mit **„Rückgängig"** – nimmt das Einspielen als Ganzes zurück (Boards, Bereiche, Vorlagen,
    Vorlieben und die geschriebenen Einträge im Gerätespeicher).
- **Automatisch (Chrome/Edge):** Einstellungen → Daten → „Automatisch sichern" wählt einen Ordner (File System
  Access) und sichert sofort, danach höchstens einmal am Tag – beim Start (verzögert) und beim Verdecken/Schließen
  des Fensters. Eine Datei je Tag (`PixiNotes-Alles-JJJJ-MM-TT.pixinotes`), die letzten **7** bleiben, andere Dateien
  im Ordner werden nie angefasst. Ohne Erlaubnis nach dem Neustart: Hinweis mit „Erlauben".
- **Erinnerung (überall, auch Firefox/Telefon):** Standard aus. Nach **14 Tagen** ohne vollständige Sicherung (oder
  seit dem ersten Start) **ein** ruhiger Hinweis mit „Jetzt sichern"; dieselbe Lücke wird nie zweimal angesprochen.
  Einstellungen → Daten zeigt „Letzte Sicherung: … (vor n Tagen)".
- Funktioniert in der portablen Single-File (`file://`): Herunterladen, Einspielen, Gerätespeicher.

## Format `.pixinotes`
Ein ZIP (unkomprimiert, „stored") – jedes ZIP-Programm öffnet es:
- `pixinotes.json` = `{ app: 'pixinotes-sicherung', version: 1, art: 'board' | 'alles', savedAt, boards, spaces,
  activeId?, templates, einstellungen?, anhaenge: [{ id, vorsilbe, pfad, typ, mime? }], bilder: [{ pfad, kopf }],
  ohne: [...] }`. Boards/Bereiche/Vorlagen in der gewohnten Gestalt des Stands.
- `anhaenge/<n>`: Inhalte aus dem Gerätespeicher (IndexedDB `pixinotes-sync`/`kv`) je Karte, Vorsilben wie
  `lib/anhangKopie.ts`: `file:` (Blob, mit MIME), `happ:` (Tool-Quelltext, Text), `happ-state:`/`happ-state-at:`
  (JSON). `typ` = blob | text | json.
- `bilder/<n>`: eingebettete `data:…;base64`-Inhalte ab 2 KB (Bilder, kleine Dateien im Board) als Binärdaten; im
  JSON steht `pixinotes-zip:bilder/<n>`, gleiche Inhalte nur einmal. Beim Lesen werden nur gelistete Pfade mit
  gültigem `kopf` aufgelöst.
- Ältere Dateien werden weiter gelesen: `.pixiboard.json` (`app: 'pixinotes-board'`) und der komplette Stand
  (`app: 'pixinotes'`, Anhänge als Base64 unter `dateien`). Ein abgelegter kompletter Stand öffnet jetzt ebenfalls
  die Vorschau statt ungefragt alles zu ersetzen.

## Bewusst NICHT enthalten
- **KI-Schlüssel** (`ai.apiKey`) und überhaupt die KI-Einstellungen, **Zugangsdaten** für Sync-Ordner, WebDAV, Konto
  (Supabase/Google/Microsoft), Kalender-Konten, Outlook – sie liegen nicht im Board-Stand, die Sicherung liest nur
  Boards, Bereiche, Vorlagen und die Vorlieben aus `lib/einstellungen.ts` (`VORLIEBEN_FELDER`). Die Datei und die
  Vorschau sagen das (`OHNE`).
- **Einladungs-Token und Besitzer** geteilter Boards (`gastLink`, `geteiltVon…`, `zumWeitergeben`) – beim Schreiben
  und beim Lesen entfernt; Boards anderer (geteilt mit mir) kommen in „Alles sichern" gar nicht vor, ebenso der
  Bereich „Geteilt mit mir".
- **Versionen** (M449) – sie liegen je Gerät.

## Wie (Architektur)
- `src/lib/sicherung.ts` (nur nachgeladen): `sicherungBauen(art, boardId | BoardDoc)`, `boardSichern`, `allesSichern`,
  `sicherungLesen(blob)` (ZIP oder alte JSON), `normalisieren` (alles durch `lib/sicher.ts`: `boardVonAussen`,
  `karteGueltig`/`karteEntschaerfen`; Bereiche/Projekte nur mit gültigen Kennungen und bekannten Boards; Anhänge nur
  zu Karten aus der Datei; Vorlieben nur bekannte Felder mit schlichten Werten), `ueberblick`, `sicherungEinspielen
  (s, 'kopie' | 'ersetzen')`, `sicherungRueckgaengig`, `autoEinschalten/autoAusschalten/autoSichern`, `erinnern`,
  `sicherungStart`.
- `src/lib/zip.ts`: ZIP-Schreiber (CRC-32, UTF-8-Namen) – Gegenstück zu `lib/unzip.ts`.
- `src/lib/sicherungTakt.ts` (im Start, ohne Abhängigkeiten): Speicher-Schlüssel `pixinotes:letzte-sicherung`,
  `pixinotes:sicherung-seit`, `pixinotes:sicherung-erinnert`, `pixinotes:auto-sicherung`,
  `pixinotes:auto-sicherung-letzte`; `sicherungStartFaellig()` – nur wenn etwas fällig ist, lädt `App.tsx` nach 6 s
  `lib/sicherung.ts`; Ereignis `pixinotes:sicherung-einspielen` (`sicherungEinspielenOeffnen(datei?)`) öffnet den
  Dialog (`App.tsx` → `SicherungEinspielen`, lazy). Der Ordner liegt in IndexedDB unter `sicherung:ordner`.
- `src/components/SicherungDialog.tsx`, Regeln in `src/styles/74-sicherung.css`.
- `store.ts`: `hinweisMitKnopf(text, knopf, aktion)` / `hinweisKnopfDruecken()` – Hinweis mit eigenem Knopf (Toast
  `knopf`), genutzt für „Rückgängig", „Jetzt sichern", „Erlauben".
- `importFiles.ts`: Endung `.pixinotes` und der komplette Stand (`app: 'pixinotes'`) → Dialog.
- `share.ts`: `downloadBoardFile(board, still)` → `boardSichern` (dynamisch); `zumWeitergeben` exportiert.
- `einstellungen.ts`: `VORLIEBEN_FELDER`, `vorliebenAuszug()`.
- Prüfreihen angepasst: `m288` (Menüeintrag heißt „Sicherung herunterladen"), `m390` F (Alles sichern + Vorschau).

## Grenzen / offen
- Die Auto-Sicherung schreibt beim Verdecken des Fensters; schließt der Browser sofort, kann der Schreibvorgang
  abbrechen – dann holt der nächste Start ihn nach (er ist ja noch fällig).
- In der Prüfreihe ist der „gewählte Ordner" ein Ordner aus dem Origin-Speicher (gleiche Schnittstelle, kein nativer
  Dialog); einen Handle aus IndexedDB nach dem Neuladen zurückzulesen, beendet Chromium im Test – deshalb merkt
  `autoOrdner()` den Handle zusätzlich je Sitzung im Speicher.
- Keine Verschlüsselung der Datei; wer sie weitergibt, gibt den Inhalt weiter (wie bisher).
- Sehr große Bestände werden im Speicher zusammengesetzt (ein Blob aus Teilen); ZIP64 (> 4 GB) gibt es nicht.
