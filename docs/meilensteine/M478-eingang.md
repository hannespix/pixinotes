# M478 — Eingang: eine Ablage für alles, was von außen kommt
PR: siehe Merge-Titel „… (M478)" · Prüfreihe: `pruefungen/m478-eingang.mjs` (Port 5478) · Datum: 2026-11-23

## Warum
KONZEPT „Inbox-Ecke" und der offene Punkt aus M458: Was über die Browser-Erweiterung (M458), das Android-Teilen
(M290) oder Outlook (M466) kam, landete sofort auf dem gerade offenen Board bzw. stellte den Empfangs-Dialog mitten
in die Arbeit — auch wenn man dort gerade nicht sortieren wollte.

## Was
- **Eingang:** Erweiterung und Teilen legen ihr Gesendetes (Option „Eingehendes im Eingang sammeln", Einstellungen →
  Design → Bedienung, Vorgabe an, je Gerät) in den Eingang statt aufs Board bzw. in den Empfangs-Dialog; eine kurze
  Meldung sagt es. Outlook hat je Mail neben „Aufs Board" ein leises **„Später"**.
- Bleiben direkt aufs Board: „Ohne Rückfrage" der Erweiterung (ein gewähltes Ziel), Ablegen per Ziehen, Strg+V.
  Option aus: der Empfangs-Dialog wie bisher.
- **Zähler** „Eingang n" in der Spalte direkt unter „Aufgaben" (am Telefon im Kopf der Navigation) — nur solange
  etwas wartet; kein neuer Knopf im Board, kein Dauer-Knopf.
- **Liste** (rechts, ohne Abdunkelung, Esc schließt): je Eintrag Vorschau (Bild oder erste Zeile, weitere Zeilen,
  Herkunft, Zeit, Kartenzahl), „Aufs Board", Löschen; Häkchen und „Alle" für mehrere; „Einsortieren in" wählt das
  Ziel (Vorgabe: das offene Board). Einträge lassen sich aus der Liste aufs Board **ziehen**. Leer: Liste und Zähler
  verschwinden.
- „Aufs Board" legt die Karten in die Mitte des sichtbaren Ausschnitts an eine freie Stelle (mehrere Einträge
  nebeneinander, jede Sendung in ihrer Anordnung), wählt sie aus; **Strg+Z** legt sie zurück in den Eingang, ohne das
  Board zu wechseln. Löschen hat „Rückgängig".
- **Strg+K** findet Einträge (Board „Eingang") und öffnet die Liste beim Treffer; Befehl „Eingang".
- **Abgleich:** Der Eingang reist mit Konto, Ordner und WebDAV — am Telefon Geteiltes wartet am PC; dort einsortiert,
  ist er auch am Telefon leer. Sicherung („Datei exportieren", M476 „Alles sichern"), Markdown-Export und Versionen
  nehmen ihn mit, weil er ein Board ist.

## Wie (Architektur)
- **System-Board** statt eigener Datenart: `BoardDoc.system = 'eingang'`, feste Kennung `EINGANG_ID =
  'pixinotes-eingang'` (`src/lib/eingangId.ts`, ohne Importe — auch für Module, die der Store lädt). Fest, damit zwei
  Geräte im Abgleich dasselbe Board zusammenführen (Drei-Wege je Karte, `lib/syncMerge.ts`) statt zwei Eingänge zu
  haben. Steht in **keinem Projekt**, wird am Ende der Board-Liste angelegt (Rückfallwege „erstes Board" treffen ihn
  nicht).
- **Ausgeblendet** über `ohneEingang(boards)` bzw. den Hook `useNutzerBoards()` (`lib/eingang.ts`): Baum
  (`Navigation.tsx`, auch „Ohne Projekt" und die Gast-Prüfung), Übersicht Kacheln + Netz (`ohneArchiv` in
  `Overview.tsx`), Suche nach Board-Namen, Zielwahl in Kanban/Portal/Aufgaben-Zentrale, `collectTasks` (`lib/tasks.ts`),
  Termine (`lib/termineZentrale.ts`). Reiter und „In Board verschieben" gehen ohnehin über `spaces`.
  `syncMerge.mergeHierarchie` bekommt die Board-Kennungen **ohne** Eingang — sonst hängte es ihn als „Waise" ins erste
  Projekt (gefunden mit J4 der Reihe).
- **Nie aktiv:** `eingangWaechter()` (Store-Abo, gestartet im `Eingang`-Host in `App.tsx`) setzt ein aktives
  Eingangs-Board auf das zuletzt offene zurück; kam der Sprung aus `focusNode` (`pendingFocus`), öffnet es die Liste
  bei diesem Eintrag. So greifen Präsentieren, Reiter, Undo und Rückfallwege nie auf den Eingang.
- **Einträge:** Karten im Eingang tragen `data.eingang = { gruppe, herkunft: 'erweiterung'|'teilen'|'outlook', wann }`;
  eine Sendung (Foto + Text) = eine Gruppe. `eintraege(board)` gruppiert, neueste zuerst; `eingangZahl` für den
  Zähler. Beim Einsortieren fällt die Marke weg (`ohneMarke`).
- **Ablegen:** `inEingangLegen(nodes, herkunft)` (kein Undo-Schritt — am eigenen Board ändert sich nichts),
  `geteiltesInEingang(g, herkunft)` für Erweiterung/Teilen. Dateien laufen durch dieselbe Import-Pipeline:
  `importFilesToBoard(files, pos, { ablegen })` nimmt die fertigen Karten entgegen statt `addNode` — ohne Sonderwege,
  die das aktive Board ändern (.ics in dessen Kalender, Board-/Sicherungsdateien werden Datei-Karten) und ohne
  Team-Spiegel. `textBloecke` (Notiz mit echtem Verweis) liegt jetzt in `lib/eingang.ts` und dient auch
  `GeteiltDialog.tsx`.
- **Einsortieren:** `eingangHolen(gruppen, zielId?, an?)` — öffnet das Ziel, `pushHistoryBoards([EINGANG_ID])`
  (aktives Board + Eingang in EINEM Schritt; `undo` setzt `activeId = entry.boardId` = Ziel), dann Verschieben per
  `setState`. Lage: `an` (Ziehen) oder `findFreeSpot` um `sichtMitte` (aus der Transformation von
  `.react-flow__viewport`). `eingangLoeschen(gruppen)` mit demselben Schritt-Muster und Hinweis `'schritt'`.
- **Ziehen:** Liste setzt `dataTransfer` `application/x-pixinotes-eingang` (`EINGANG_ZIEHEN`, JSON der Gruppen);
  `Board.tsx` → `handleDrop` erkennt ihn vor den Dateien.
- **Oberfläche:** `components/EingangFenster.tsx` (nachgeladen, Host `Eingang()` in `App.tsx`, Ereignis
  `pixinotes:eingang` = `EINGANG_OEFFNEN`, `eingangOeffnen(gruppe?)`), Zähler `eingangKnopf` in `Tabs.tsx` (Klasse
  `tab-tasks`, `data-taste="eingang"`), Symbol `IEingang`, Stil `src/styles/76-eingang.css` (nach `74-sicherung`, vor `99-…`).
- **Option:** `localStorage` `pixinotes-eingang-sammeln` (`'0'` = aus), `eingangSammeln()`/`setEingangSammeln()`;
  Weiche in `GeteiltDialog.tsx` (Start mit `?geteilt=1` und `erweiterungEingang`).
- Reihen m290 und m458 prüfen den Empfangs-Dialog und setzen die Option deshalb auf aus.

## Grenzen / offen
- „In eine Notiz einfügen" gibt es nur im Empfangs-Dialog (Option aus), nicht aus dem Eingang.
- Die Option gilt je Gerät (localStorage), nicht je Konto.
- Kein E-Mail-Eingang (`board@pixinotes`, KONZEPT) — dafür bräuchte es einen Server.
- Große Dateien (Geräte-Ablage, `lokal`) reisen wie überall nicht über den Abgleich: am anderen Gerät kommt die Karte
  ohne Inhalt an (wie bei normalen Boards).
- Der MCP-Server (`mcp/`) sieht den Eingang als Board.
