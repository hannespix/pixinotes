# M470 — Nachschärfen Runde 2: Versionen mit Auswahl, Pfeilen und Strichen; Spaltenzeit je Ticket
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m470-nachschaerfen-2.mjs` (Port 5470) · Datum: 2026-11-23

## Warum
Offene Punkte aus M460 („kein Zurückholen von Pfeilen oder Strichen allein; keine Mehrfachauswahl") und M463
(„In Arbeit" misst die Kanban-Karte, nicht das Ticket – wer irgendein Ticket bewegt, setzt die Uhr für alle zurück).

## Was
- **(a) Versionen:** Unter „Seitdem" stehen neben den Karten jetzt auch **gelöschte und geänderte Verbindungen**
  („Eins → Vier (zu vier)") und **Striche** („Marker-Strich an „Vier"") mit eigenem Symbol. Jede zurückholbare Zeile
  hat ein Häkchen; „alle" im Kopf wählt alles, **„Auswahl zurückholen (n)"** holt Karten, Verbindungen und Striche in
  **einem** Schritt (ein Strg+Z nimmt alles zurück, Strg+Y holt es wieder). Verbindungen und Striche lassen sich auch
  einzeln zurückholen. Eine Verbindung geht nur, wenn beide Karten da sind oder mit angehakt sind; ein Strich an einer
  Karte ebenso (sonst Häkchen und Knopf gesperrt, Tooltip sagt warum). Der Hinweis zählt „2 Karten, 1 Verbindung,
  3 Striche zurückgeholt – Strg+Z …".
- **(b) Spaltenzeit je Ticket:** Jedes Kanban-Ticket merkt sich, seit wann es in seiner Spalte steht – beim Anlegen
  und bei jedem Spaltenwechsel von Hand (Ziehen, Pfeile, Ticket-Fenster, Aufgaben-Zentrale), **nicht** beim
  Bearbeiten von Titel, Person, Frist oder Beschreibung. Strg+Z stellt den Stempel mit zurück. Im Ticket-Fenster
  steht leise „seit 3 Tagen in „In Arbeit"" (genaue Zeit im Tooltip; ältere Tickets ohne Stempel zeigen nichts).
  Das Board-Briefing nennt „Seit 23 Tagen in „In Arbeit": …" je Ticket (älteste zuerst, höchstens drei) – ein frisch
  dorthin gezogenes Ticket nicht mehr, auch wenn die Kanban-Karte lange unverändert war, und umgekehrt.
- **Sync:** Eingearbeitete fremde Stände werden nicht neu gestempelt; Zeitpunkte von außen (Ordner, WebDAV, Konto)
  werden gesäubert – ein Stempel aus der Zukunft fällt weg.

## Wie (Architektur)
- `src/lib/boardVersionen.ts`: `KartenVergleich` um `pfeileGeloescht`, `pfeileGeaendert`, `stricheGeloescht`,
  `stricheGeaendert`; `kartenVergleich(stand, nodes, edges?, drawings?)`; Vergleich über `stabil()` (Schlüssel
  sortiert, `selected`/`dragging` zählen nicht), `listenVergleich`.
- `src/store.ts`: `kartenZurueckholen(boardId, ids, stand, { pfeile?, striche? })` liefert jetzt
  `{ karten, pfeile, striche }`; gewählte Verbindungen nur mit beiden Enden (nach dem Einsetzen der Karten),
  gewählte Striche nur mit vorhandenem Anker; ersetzt geänderte bzw. hängt gelöschte an; EIN History-Eintrag (mit
  `drawings`).
- `src/components/VersionenDialog.tsx`: `auswahl` (Set mit `k:`/`p:`/`s:`-Schlüsseln, beim Standwechsel leer, nach
  dem Zurückholen bereinigt), `pfeilGeht`/`strichGeht`, Zeilen `data-taste="vergleich-pfeil"` / `"vergleich-strich"`
  (`data-geht`), Häkchen `vergleich-wahl`, `vergleich-alle`, Knopf `auswahl-zurueckholen` (`data-anzahl`), einzeln
  `pfeil-zurueckholen` / `strich-zurueckholen`. Karten behalten `vergleich-karte` (m460 zählt sie). CSS im
  M449-Block (`.vv-kopf`, `.vv-alle`, `.vv-wahl`).
- `src/types.ts`: `KanbanItem.spalteSeit?: number` (ms).
- `src/lib/kartenZeit.ts`: `nachPatch` ruft für Kanban-Patches mit `items` `spaltenStempeln(alt, neu)` – neu in
  `items` → jetzt; Spalte gewechselt (Index anders UND gleiche Spaltenliste oder anderer Spaltenname – eine
  eingefügte Spalte verschiebt Indizes, ohne dass ein Ticket umzieht) → jetzt; sonst alter Stempel (auch wenn ein
  Editor das Ticket ohne ihn neu baut). Weil der Store `nachPatch` nur außerhalb von `runDerived` ruft
  (`zeitNachPatch`), stempeln Automatiken (Rücksync, Einsammeln, Auto-Archiv) und Sync nicht. `spalteSeitVon(it,
  kanban)` = Stempel oder Kartenzeit. `zeitSaeubern` säubert auch `spalteSeit` in `items`/`archiv`
  (`ticketZeitSaeubern`).
- `src/lib/sicher.ts`: `zeitenVonAussen(boards)`; `syncFolder.ts` → `fremdStandEinarbeiten` säubert damit jeden
  fremden Stand (Ordner, WebDAV, Konto). Vorher lief der Ordner-Eingang an `karteEntschaerfen` vorbei – auch
  `angelegt`/`geaendert` von dort werden jetzt geprüft.
- `src/lib/boardBriefing.ts`: Befund 2 sammelt je Ticket (`spalteSeitVon`), sortiert nach Alter, Text
  `Seit {0} in „{1}“: {2}` mit `zahlWort`.
- `KanbanCard.tsx`: `spaltenZeitText`, Zeile `.ticket-spaltenzeit` (`data-taste="ticket-spaltenzeit"`) im
  Ticket-Fenster. Hilfe DE/EN, `en.json`.

## Grenzen / offen
- ~~Im Drei-Wege-Abgleich zählt ein anderer `spalteSeit` desselben Tickets als Unterschied (kein „spätere gilt" wie bei
  `geaendert`, M453) – nur, wenn zwei Geräte dasselbe Ticket bewegen.~~ → erledigt in M472 (`lib/abgleichZeiten.ts`).
- Gespräche (Kommentare) und neue Pfeile/Striche stehen nicht in „Seitdem"; „neu" bleibt nur bei Karten.
- Tickets aus der Zeit vor M470 zeigen keine Spaltenzeit, bis sie das nächste Mal die Spalte wechseln (das Briefing
  nimmt für sie weiter die Kartenzeit).
- Ein Ticket, das im Ticket-Fenster als erledigt steht, zeigt weiter „erledigt am …" statt der Spaltenzeit.
