# M498 — Kanban-Ticket ganz gemeinsam bearbeiten
PR: siehe Merge-Titel „… (M498)" · Prüfreihe: `pruefungen/m498-ticket-gemeinsam.mjs` (Port 5498, zweiter Server 6498) · Datum: 2026-11-23

## Warum
M487 machte im Live-Board Titel und Beschreibung eines Tickets gemeinsam (Y.Text je Feld). Alles andere lief weiter
über den Speicher — und weil gemeinsam genau EIN Gerät (der Schreiber) die ganze Kanban-Karte sichert, nahm der Schutz
(`store/schutz.ts`) jede andere Änderung zurück, solange jemand tippte: Person, Frist, Haken in der Checkliste, Spalte
waren gesperrt („… tippt gerade in dieser Karte"). Ohne Sperre wären sie im kartenweisen Abgleich verloren gegangen.
Dazu: fremde Cursor standen nur als Name unter dem Feld, und eingesammelte Tickets schrieben an der gemeinsamen
Sitzung ihrer Quelle vorbei.

## Was
- **Das ganze Ticket ist gemeinsam:** Person, Frist, Priorität, Abhängigkeiten, verknüpfte Karten und die
  **Checkliste** (Punkt dazu, abhaken, umbenennen, umsortieren, entfernen) ändern mehrere zugleich — ohne Sperre, ohne
  Verlust; alle sehen jede Änderung sofort (nicht erst, wenn der Schreiber gesichert hat).
- **Verschieben während getippt wird:** Spaltenwahl im Ticket-Fenster, Pfeile und Ziehen auf dem Board (auch
  innerhalb der Spalte), „Erledigt" in der Aufgaben-Zentrale — alles kommt an, der Text bleibt vollständig.
- **Checkliste:** Punkte werden direkt im Text umbenannt; der Griff links (ziehen) oder **Alt+↑ / Alt+↓** sortiert um
  — auch ohne Live-Verbindung.
- **Fremde Cursor im Ticket:** schmaler Strich in der Farbe der Person (beim Bewegen kurz mit Namen), Markierung leicht
  eingefärbt; der Strich wandert mit, wenn davor getippt wird; ≥ 3:1 zum Feld in Hell und Dunkel.
- **Eingesammelte Tickets:** Ändern sie ihre Quelle (Original-Ticket in einem anderen Kanban, Haken in einer Notiz),
  geht das im Live-Board über das Y-Dokument der Quelle — dort heilte der Schreiber den Haken sonst wieder weg.
  Ebenso der Haken an Notiz-Punkten in der Aufgaben-Zentrale.
- Neue Tickets anlegen, Tickets löschen/archivieren, Spalten und der Titel der Karte bleiben gesperrt, solange jemand
  tippt (wie M487). Ohne Live-Verbindung ist alles wie vorher (kein Yjs).

## Wie (Architektur)
- `lib/notizGemeinsamKern.ts` `kanbanOeffnen` (nur der Kanban-Block): neben `texte` eine Y.Map `kanban` als
  **Überlagerung** des Gespeicherten, flache Schlüssel (Trenner `\u001f`): `f␟Ticket␟Feld` (Wert, null = entfernt),
  `o␟Ticket` (Rang in der Reihe), `s␟Ticket␟Punkt␟text|done|o|x` (Checklisten-Punkt; `x` = Grabstein). Flach, damit
  zwei, die zugleich zum ersten Mal ein Ticket ändern, nicht je eine eigene verschachtelte Y.Map anlegen (eine ginge
  verloren); je Schlüssel gilt der letzte.
  - `anwenden(items)` = gespeicherte Tickets + Überlagerung (Felder, Texte, Checklisten, Reihenfolge); dieselbe Liste,
    wenn nichts anders ist. `ordnen(liste, rang)`: mit Rang aufsteigend (gleich → Kennung), ohne Rang hinter dem
    Vorgänger im Gespeicherten — stabil, wenn der Schreiber die geordnete Liste zurückschreibt (ein Rang „Stelle im
    Gespeicherten" verrutschte beim Schreiben und kippte die Reihe).
  - `uebernehmen(alt, neu)`: nur der Unterschied; Umsortieren gibt ALLEN Tickets einen neuen Rang, Dazu/Weg/Umsortieren
    in der Checkliste allen Punkten des Tickets. Neue/entfernte Tickets → `false` (Weg über den Speicher). Wer nicht
    schreiben darf (`schreibt` in der Anwesenheit) → `false`. Erlaubte Felder und Werte: `FELD_OK`/`PUNKT_OK` (das
    Dokument ist eine fremde Eingabe; Ungültiges wird beim Lesen übergangen).
  - Der Schreiber (`schreiben`) sichert `anwenden(gespeichert)`; ausgelöst von jeder Änderung des Dokuments
    (`doc.on('update')`).
  - `feldBinden`: Cursor in der Anwesenheit zusätzlich als relative Yjs-Position (`ra`, `rk`); `tippende(key)` liefert
    `{ name, farbe, a, k, cid }` mit der Stelle im eigenen Text (ältere Fassungen: die Zahl).
  - `notizHaken(boardId, nodeId, blocks, schema, blockId, an)` (wie `protokollHaken`, M493): nutzt eine offene Sitzung
    der Notiz auf diesem Gerät oder tritt kurz bei.
- `lib/kanbanLive.ts` (neu, leicht): Brücke `kanbanLiveSetzen`, `kanbanLive`, `ticketsSetzen(boardId, nodeId, alt,
  neu, sonst)`, Hook `useKanbanLive`. Alle Schreibwege an Tickets gehen hierüber: `KanbanBody.setItems` (damit
  patchItem, tryMoveTo, Checkliste, Auto-Einsammeln), Quell-Rückschreiben in `patchTicket`/`writeBackToSource`,
  `TaskHub` (`ticketsAendern`).
- `components/nodes/KanbanGemeinsam.tsx`: `KanbanHalter` hält die Sitzung, sobald das Ticket-Fenster aufgeht oder
  jemand anderes in der Karte arbeitet (`NOTIZ_Y_WACH`/`gemeinsamGewuenscht`) und bleibt, solange die Karte zu sehen
  ist; meldet sie an der Brücke an. `KanbanFeld`: Hülle `.feld-huelle` + Lage `.feld-cursor-lage` (Spiegel-Element
  `stellen()` für Zeichenpositionen in input/textarea), Strich `.feld-cursor-strich`, Markierung
  `.feld-cursor-markierung`, Name `.feld-cursor-name` 2,5 s nach einer Bewegung; Farbe über `farbeAlsSchrift`.
- `components/nodes/KanbanCard.tsx`: `kanban` = gemeinsamer Stand (`useKanbanLive`), Checkliste als Zeilen mit Griff
  (`IGriff`, HTML5-Ziehen mit eigenem Datentyp `application/x-pixinotes-ticket`, damit das Board keine Notiz daraus
  macht), Textfeld `.ticket-sub-text`, Alt+↑/↓ (`punktVerschieben`). Frist am Ticket auf dem Board:
  `data-ohne-sperre` im gemeinsamen Modus.
- `store/schutz.ts` `mitTextVon` (Kanban): alle Felder und die Reihenfolge bestehender Tickets gehen durch; ist nichts
  zurückzunehmen, bleiben die neuen Daten selbst (der Schutz vergleicht nach Identität und meldete sonst „… bearbeitet
  diese Karte" für eine Änderung, die er gar nicht zurücknimmt).
- Start-JS: 2 108 819 B (Grenze 2 120 000 unverändert); neu im Start nur `lib/kanbanLive.ts` über die Aufgaben-Zentrale.

## Nachweis
`node werkzeug/alle-pruefungen.mjs m477 m487 m489 m498 --wiederhole 5 --bahnen 4`: je 5 von 5 grün. `--geaendert` (nach Einmischen
von M497): 45 von 45 Reihen grün.

## Prüfreihe
A Live-Runde · B Checkliste (dazu, abhaken, umbenennen) während Anna tippt, beide fügen zugleich hinzu, Alt+↑ während
der andere abhakt, Ziehen am Griff, Entfernen, Server · C Person/Frist/Priorität während getippt wird, zwei Felder
zugleich · D Verschieben im Ticket-Fenster, auf dem Board ohne offenes Fenster (Weckruf), Umsortieren in der Spalte mit
der Maus — Spalten und Reihen bei Anna, Gerd und Server gleich · E fremder Cursor: Strich mit Name, folgt, wandert bei
Tippen davor mit, Markierung, Kontrast ≥ 3:1 hell/dunkel, verschwindet beim Verlassen · F Späteinsteiger sieht alles, zu
dritt · G Rückweg ohne Yjs · H ohne Kanal (kein Yjs, Umbenennen/Umsortieren) · I Hilfe, keine Seitenfehler, keine
Sperr-/Konflikt-Hinweise in der ganzen Runde.

## Grenzen / offen
- Neue Tickets anlegen, löschen, archivieren, Spalten und Titel der Karte laufen weiter über den Speicher und bleiben
  gesperrt, solange ein anderer im Ticket tippt.
- Strg+Z des Boards nimmt gemeinsam geänderte Ticket-Felder nicht zurück (die Änderung liegt im Y-Dokument; im
  Textfeld nimmt Strg+Z wie bisher nur Eigenes zurück).
- Ändern zwei dasselbe Feld (Person) oder denselben Punkttext zugleich, gilt der letzte. Sortieren zwei zugleich um,
  mischen sich die Ränge (nichts geht verloren, die Reihe ist auf allen Geräten gleich).
- Notiz-Quellen eingesammelter Tickets: im Live-Board nur der Haken, nicht der Spalten-Vermerk „(→ Spalte)" (er änderte
  Text, den gerade andere schreiben); ein Rückgängig-Schritt umfasst dann nur das Ticket.
- Wer den Kanal ohne Schreibrecht hat, könnte mit einem manipulierten Programm Werte ins Dokument legen, die der
  Schreiber speichert (wie bei Texten, M477) — `FELD_OK` begrenzt Felder und Werte.
