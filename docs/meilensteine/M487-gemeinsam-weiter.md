# M487 — Gemeinsam tippen auch im Protokoll und in Kanban-Texten
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m487-gemeinsam-weiter.mjs` (Port 5487, zweiter Server 6487) · Datum: 2026-11-23

## Warum
M477 brachte gemeinsames Tippen per Yjs für Notizen; offen blieben Protokoll, Präsentation und Kanban-Texte (Backlog).
Gerade das Protokoll schreiben in einer Besprechung mehrere zugleich mit. Im Kanban war es schlimmer als „wer zuerst
anfasst": Das Ticket-Fenster ist ein Portal außerhalb der Karte und nahm deshalb **keine** Karten-Sperre — zwei, die
zugleich zwei Tickets desselben Kanbans bearbeiteten, schrieben beide die ganze Karte, und der kartenweise Abgleich
(`syncMerge.ts`, „lokal gewinnt") verlor eine der Änderungen still.

## Was
- **Protokoll:** Im Live-Board schreiben mehrere gleichzeitig in den Protokolltext der angezeigten Sitzung — Cursor und
  Markierung der anderen in ihrer Farbe, Späteinsteiger bekommen den Stand, Strg+Z nur Eigenes, keine Karten-Sperre.
  Gespeichert wird wie bisher `entries[…].blocks`.
- **Kanban-Ticket:** Titel und Beschreibung im Ticket-Fenster sind gemeinsam: Wer im selben Feld tippt, wird
  zeichengenau zusammengeführt (Y.Text je Feld); unter bzw. neben dem Feld steht „Anna tippt …" in ihrer Farbe; der
  eigene Cursor bleibt an seiner Stelle, wenn andere davor schreiben; Strg+Z im Feld nimmt nur die eigene Eingabe
  zurück. Zwei verschiedene Tickets zugleich verlieren nichts mehr.
- Solange jemand im Protokoll oder einem Ticket tippt, bleibt die **übrige Karte**, wie sie ist (Datum, Teilnehmende,
  Beschlüsse; Spalten, Frist, Reihenfolge der Tickets) — Hinweis „… tippt gerade in dieser Karte", danach frei.
- **Präsentation:** Protokoll- und Kanban-Folien benutzen dieselben Bausteine (`MinutesBody`, `KanbanBody`; das Board
  ist während der Präsentation ausgehängt, es gibt also nie zwei Sitzungen derselben Karte auf einem Gerät) und gehen
  damit ebenfalls gemeinsam, solange der Kanal steht (nicht eigens in der Prüfreihe). Notiz-Folien nicht (siehe unten).
- **Ohne Live-Verbindung** bleibt alles wie vorher; Yjs wird nicht geladen.

## Wie (Architektur)
- `lib/notizGemeinsamKern.ts` (nachgeladen): Der Sitzungskern ist jetzt allgemein — `kernOeffnen(auftrag)` mit
  `KernAuftrag { boardId, nodeId, n, darf, warten, leer(doc), anfangen(doc), schreiben(wert) }`. `n` ist der
  Kanal-Schlüssel (Feld `n` im Ereignis `notiz-y`, Prüfung `[\w:.-]{1,200}` in `sicherNotizY.ts` unverändert):
  Notiz und Kanban = Karten-Kennung, Protokoll = `Karte:Sitzungstermin`. Kanal, Bündeln, Teile, `hallo`/`stand`,
  Awareness, Schreiberwahl, Heilen, `offen`-Liste: unverändert aus M477, nur je `n`.
  - `sitzungOeffnen(…)` (Notiz) — Aufruf und Verhalten wie M477, intern über `kernOeffnen` + `blockAnfang`.
  - `protokollOeffnen(boardId, nodeId, entryId, blocks, schema, darf, warten)` — BlockNote wie die Notiz; `schreiben`
    setzt `entries[i].blocks` des Termins (Termin gelöscht → nichts).
  - `kanbanOeffnen(boardId, nodeId, darf, warten)` → `FeldSitzung` mit `feldBinden(el, key, anfang)`,
    `tippende(key)`, `beiAnwesenheit(cb)`. Texte als Y.Text in der Y.Map `texte`, Schlüssel `Ticket:text` /
    `Ticket:note`. Ein Feld entsteht beim ersten Binden **deterministisch** (Hilfsdokument, Yjs-Kennung =
    Streuwert(Karte, Feld, gespeicherter Text)) und geht sofort hinaus (Herkunft `feld-anfang`), damit andere die
    Grundlage folgender Eingaben haben. Bindung: `input`-Ereignis → gemeinsamer Anfang/Ende → `delete`/`insert` mit
    Herkunft `pn-feld`; fremde Änderung → `el.value` neu, Auswahl über das Yjs-Delta verschoben (`verschieben`);
    Strg+Z/Y → `Y.UndoManager` nur für `pn-feld`; Awareness-Feld `cursor: { feld, a, k }` (der Schutz im Speicher
    hängt wie bei M477 an `cursor`). Der Schreiber setzt `items[].text/note` (leere Beschreibung = keine).
  - Schutz je Sitzung: `schutzSetzen(boardId, n, nodeId, name)`, je Karte zusammengefasst an `setzeNotizSchutz`.
  - `SitzungIntern.beimSchliessen(f)` räumt Speicher-Abo und Beobachter der Feld-Sitzung auf.
- `store/schutz.ts` `mitTextVon(alt, neu)`: Was beim Tippen der anderen durchgeht — Notiz `blocks`, Protokoll
  `entries[].blocks`, Kanban `items[].text/note` (je Kennung; neue/entfernte Tickets, Spalten, Frist bleiben).
- `lib/gastSync.ts` `anfassenPruefen`: In einer Karte, in der ein anderer gemeinsam tippt (`notizSchutz`), nimmt das
  Anfassen eines übrigen Felds (Teilnehmende, Beschluss) keine Karten-Sperre — Hinweis „{0} tippt gerade in dieser
  Karte – gleich wieder frei." Sonst hielte man die Karte, und der gemeinsame Text käme erst nach dem Loslassen in den
  Speicher.
- `components/nodes/MinutesCard.tsx`: `EntryEditorWahl` (wie `NotizEditorWahl`) — einmal live, die nachgeladene Hülle
  `ProtokollGemeinsam.tsx`; `EntryEditor` nimmt `sitzung` (Optionen, `aenderung`, `anbinden`, kein Nachsichern beim
  Abbau — das macht `abschied`). `ProtokollRuhend` zeigt den Text während des Wechsels.
- `components/nodes/ProtokollGemeinsam.tsx` (nachgeladen): Modi `allein` → `pause` → `laedt` → `gemeinsam`. Anders als
  die Notiz **ohne Betreten**: Steht der Kanal, öffnet die angezeigte Sitzung ihre Yjs-Sitzung gleich (ein, zwei
  Protokolle je Board; in Besprechungen schreiben mehrere mit). Nie unter dem Cursor: Wer schon tippt, wenn der Kanal
  aufgeht, wechselt erst nach dem Verlassen. Hülle `.note-wahl.protokoll-wahl`, `data-ohne-sperre` außer auf dem
  Rückweg (`kernKaputt`).
- `components/nodes/KanbanGemeinsam.tsx` (nachgeladen): `KanbanFeld` — eine Sitzung je Kanban-Karte und Gerät mit
  Zählung (Titel und Beschreibung teilen sie; 400 ms Nachlauf beim Schließen), bis die Sitzung steht nur lesend,
  dann ungesteuertes Feld (`defaultValue`) + `feldBinden`; Marke `data-gemeinsam`; „… tippt/tippen …"
  (`data-taste="feld-tippt"`, `.feld-tippt` in `styles/77-gemeinsam-tippen.css`).
- `components/nodes/KanbanCard.tsx`: im Ticket-Fenster `gemeinsameFelder` = Board war live (`liveVerbunden` beim
  Zeichnen, kein Takt) und Kern nicht kaputt (`feldAllein`). Eingesammelte Tickets (`quelleVon(it)`, M390) behalten
  den alten Titel-Weg — sie schreiben in ihre Quelle.
- Start-JS: 2 097 539 B (vorher ~2 097 100 B; Grenze 2 120 000 unverändert) — neu im Start nur `mitTextVon`.

## Prüfreihe
A Live-Runde · B Protokoll: zwei tippen vorne/hinten, keine Sperre, fremder Cursor, Teilnehmende geschützt mit Hinweis,
Server = Anzeige, Block-JSON, kein Konflikt, danach frei · C Ticket: dieselbe Beschreibung gleichzeitig, „tippt",
Cursor bleibt, Strg+Z nur Eigenes, Titel, Server, zwei verschiedene Tickets ohne Verlust, Spalten unberührt ·
D Späteinsteiger in Ticket und Protokoll, zu dritt · E Rückweg (Kern lehnt ab, Zwischenspeicher aus): Protokoll mit
Karten-Sperre, gewohnte Ticket-Felder · F ohne Kanal wie bisher, kein Yjs · G Hilfe, keine Seitenfehler.

## Grenzen / offen
- **Notiz-Folien in der Präsentation** bleiben allein (eigener Editor in `Presenter.tsx`); ebenso übrige Ticket-Felder
  (Person, Checkliste, Frist) und Tabellen.
- **Eingesammelte Tickets** (Quelle in einer anderen Karte) tippen weiter auf dem alten Weg.
- Öffnen zwei ein Ticket-Feld, dessen gespeicherter Text sich gerade unterscheidet (eine Änderung ist noch unterwegs),
  entstehen zwei Anfänge; Yjs behält einen (der andere verliert, was er bis dahin darin tippte). Wie bei M477 nur im
  Randfall.
- Ein Protokoll öffnet im Live-Board seine Sitzung ohne Klick — Yjs (≈ 140 KB) lädt also, sobald ein Live-Board ein
  Protokoll zeigt.
- Wer ein übriges Feld des Protokolls hält, **bevor** jemand im Text tippt, hält die Karte wie bisher; der gemeinsame
  Text wird dann gesichert, sobald die Karte frei ist (der Schreiber heilt beim nächsten Stand von außen).
- Fremde Cursor im Ticket-Feld erscheinen als Name unter dem Feld, nicht als Strich im Text.
- Sonst wie M477 (gemischte Fassungen, Vertrauen im Kanal).
