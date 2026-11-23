# M477 — Gemeinsam in einer Notiz tippen
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m477-gemeinsam-tippen.mjs` (Port 5477, zweiter Server 6477) · Datum: 2026-11-23

## Warum
Im Live-Team (M364/M383) gehörte eine Karte dem, der gerade darin tippte: Die anderen sahen mit, warteten aber
(„… bearbeitet diese Karte gerade"). Bei Notizen — Protokoll-Stichpunkte, Ideensammlung im Workshop — ist genau das
gleichzeitige Schreiben gewünscht. Backlog-Idee (UMBAU §5a „Später möglich"); BlockNote kann seit M462 (0.57)
Kollaboration über Yjs.

## Was
- Im **Live-Board** (Kanal verbunden) schreiben mehrere **gleichzeitig in derselben Notiz**, jeder an seiner Stelle.
  Keine Karten-Sperre für Notizen mehr.
- Die **Cursor der anderen** stehen als schmaler Strich in ihrer Teilnehmerfarbe (`farbenVerteilen`, wie Kürzel und
  Mauszeiger), beim Tippen mit Namen; ihre **Markierung** ist eingefärbt.
- **Späteinsteiger** bekommen den aktuellen Stand, auch was noch nicht gespeichert ist.
- **Strg+Z** im Text nimmt nur die eigenen Eingaben zurück (Yjs-Undo).
- Gespeichert wird **wie bisher das Block-JSON** der Notiz (`data.blocks`) — Sync, Konto, Export, ruhende Notiz
  unverändert. Yjs ist nur die Live-Schicht.
- **Ohne Live-Verbindung** bleibt alles wie vorher (ein Schreiber, Sperre, Board-Rückgängig für Text).

## Wie (Architektur)
- `lib/notizGemeinsam.ts` (Start-Paket, klein): `gemeinsamMoeglich(boardId)` = `liveVerbunden`, Hook
  `useGemeinsamMoeglich`, Nachlader `gemeinsamKern()`, Weckruf `NOTIZ_Y_WACH` (jede `hallo`/`upd`-Nachricht eines
  Anwesenden für eine Notiz; `gemeinsamGewuenscht`).
- `lib/notizGemeinsamKern.ts` (nachgeladen, Paket `gemeinsam` ≈ 135 KB + 6 KB): Sitzung je Notiz und Gerät
  (`sitzungOeffnen(boardId, nodeId, blocks, schema, darf)`), `Y.Doc` + `y-protocols/awareness`, BlockNote
  `withCollaboration` aus `@blocknote/core/yjs`.
- `components/nodes/NoteCard.tsx`: `NotizEditorWahl` zwischen `NoteCard` und `NotizEditor` (Modi `allein` →
  `pause` → `laedt` → `gemeinsam`, Hülle `.note-wahl` mit `display: contents`). `NotizEditor` nimmt `sitzung`,
  `abschied`, `fokus`, `ohneSperre`. Gemeinsam: `blocksSichern()` statt `updateNodeData` (nur der Schreiber, ohne
  Board-Verlaufsschritt via `mutedHistory`), `NOTIZ_EXTERN` wird nicht eingespielt, `extEpoch` nur vom Schreiber,
  `data-ohne-sperre` am `.note-editor` (gastSync nimmt dann keine Sperre).
- **Wann gemeinsam?** Nicht jeder Editor eines Live-Boards hält eine Sitzung (50 Notizen = 50 Fragen an jeden):
  allein, bis man die Notiz **betritt** (Pointer-/Fokus-Ereignis an der Hülle; der Klickpunkt wird über
  `startPunkt` an den neuen Editor weitergereicht) oder bis ein anderer in ihr arbeitet (`NOTIZ_Y_WACH`; eine ruhende
  Notiz wacht dafür auf). Gewechselt wird nie unter dem Cursor: zwischen zwei Editoren steht kurz die ruhende
  Ansicht, so sichert der alte, bevor der neue liest. Bricht der Kanal ab, geht es zurück zu `allein`, sobald der
  Cursor die Notiz verlassen hat. Lädt der Kern nicht, bleibt es bei `allein` (mit Sperre).
- **Lage bleibt geschützt:** `store.ts` `setzeNotizSchutz(boardId, Map<Notiz, Name>)` — tippt ein anderer in einer
  Notiz (Awareness-Eintrag mit `cursor`), darf hier niemand sie verschieben, archivieren oder löschen; der Inhalt
  (`data`) bleibt frei (`sperrschutz(…, datenFrei = true)`, Hinweis wie bei der Sperre). Sonst stünden Lage und Text
  derselben Karte als zwei Änderungen im kartenweisen Abgleich, und eine ginge verloren.
- `lib/sicher.ts`: `notizYVonAussen(roh, anwesende)` — Gestalt, Absender muss in der Presence stehen, Base64 nur
  aus seinen Zeichen, je Nachricht ≤ `NOTIZ_Y_TEIL_ZEICHEN` (48 000), höchstens `NOTIZ_Y_TEILE_MAX` (90) Teile.
- Vite `manualChunks`: `yjs`, `y-prosemirror`, `y-protocols` (samt ihrem eigenen lib0 0.2) und
  `@blocknote/core/dist/yjs.js` → Paket `gemeinsam`; sonst zöge die Editor-Regel sie in den Start. Start-JS unverändert
  (Grenze `START_JS_GRENZE` in m446/m459/m467 hält ohne Anhebung).
- Neue Abhängigkeiten: `yjs` 13.6, `y-prosemirror` 1.3, `y-protocols` 1.0 (optionale Peer-Abhängigkeiten von
  BlockNote 0.57; vorher nicht installiert).
- CSS: `src/styles/77-gemeinsam-tippen.css` (Hülle, Cursor-Schild, fremde Markierung).

### Protokoll (Ereignis `notiz-y` im vorhandenen Realtime-Kanal)
Jede Nachricht: `{ von: ich().id, c: Yjs-Kennung, n: Notiz-Kennung, a: Art, … }`.

| Art | Inhalt | Wer, wann |
|---|---|---|
| `hallo` | `sv` (Stand-Vektor) | beim Öffnen; erneut, wenn Yjs Lücken meldet (`pendingStructs`) oder der Kanal wiederkommt |
| `stand` | `an` (Yjs-Kennung des Fragenden), `d` (was ihm fehlt), `sv` (eigener Stand) | jede Sitzung, die schon bereit ist, auf `hallo` |
| `upd` | `d` (Yjs-Änderung, gebündelt mit `Y.mergeUpdates`) | eigene Änderungen, Takt 40 ms (bis 8 Leute) / 120 ms (bis 20) / 240 ms; der Fragende schickt nach `stand` zurück, was nur er hat |
| `aw` | `d` (Awareness-Meldung nur des eigenen Eintrags) | Cursor/Markierung/Name, Takt 90/270/540 ms; beim Schließen sofort die Abmeldung |
| `offen` | `ns` (Notiz-Kennungen, ≤ 200), `n: '_'` | jedes Gerät mit offenen Sitzungen, sobald jemand neu in den Kanal kommt (60–300 ms gestreut) |
| `teil` | `k`, `i`, `z`, `ganz`, Stück von `d` | Nachrichten über 48 000 Zeichen, zusammengesetzt beim Empfänger (≤ 3 offene je Absender, 20 s) |

Eingang: `LIVE_NACHRICHT` (gastSync reicht unbekannte Ereignisse weiter) → `notizYVonAussen` → Sitzung. Eine
Awareness-Meldung wird nur angenommen, wenn sie genau einen Eintrag mit der Yjs-Kennung **und** der Kanal-Kennung des
Absenders trägt (`awareEigene`). Verlässt jemand den Kanal, nimmt `rundeGeaendert` seinen Cursor heraus.

### Start eines Dokuments (keine Verdopplung)
0. Gewartet wird nur, wo schon jemand arbeitet (`gemeinsamGewuenscht`: ein `hallo`/`upd` dieser Notiz kam an, oder sie
   stand in einer `offen`-Liste). Sonst beginnt die Sitzung sofort aus dem Block-JSON und schickt nur ein `hallo`
   zum Wecken — so gehen beim Betreten keine Tasten verloren (eine frisch angelegte Notiz nimmt sofort Text an).
1. `hallo` mit leerem Stand-Vektor, warten bis 450 ms auf `stand` (allein im Kanal: gar nicht).
2. Kam nur `upd` (es wird getippt, Grundlage fehlt): noch einmal fragen, 800 ms.
3. Sonst aus dem Block-JSON beginnen — **deterministisch**: Hilfsdokument mit Yjs-Kennung = Streuwert(Notiz +
   Inhalt), fehlende Block-Kennungen nach ihrer Stelle (`mitKennungen`). Zwei Geräte, die im selben Augenblick
   dieselbe gespeicherte Fassung öffnen, erzeugen Byte für Byte dieselben Einträge — Yjs legt sie übereinander.
4. Erst danach entsteht der Editor (ein Editor auf leerem Dokument legte seinen eigenen leeren Absatz an).

### Wer speichert?
Genau einer je Notiz: unter allen Awareness-Einträgen mit `schreibt: true` die kleinste Kennung
(`Kanal-Kennung\0Yjs-Kennung`; zwei Fenster desselben Geräts haben dieselbe Kanal-Kennung). Der Schreiber sichert bei
jeder Änderung (auch fremden) über `updateNodeData` → normaler Abgleich (gastSync/kontoSync schicken Patch + Delta).
Die anderen schreiben nichts; ihr Block-JSON kommt mit dem Abgleich vom Schreiber (der Editor spielt es dann bewusst
nicht ein). Geht der Schreiber (Awareness weg, Kanal verlassen), schreibt der Nächste einmal den ganzen Stand
(`beiSchreiber`). Ohne Kanal (Abriss) schreibt jeder selbst; nach dem Wiederverbinden gleichen sich die Yjs-Stände ab
und der Schreiber sichert das Ergebnis (der kartenweise Abgleich meldet einen Konflikt höchstens einmal). Beim
Verlassen der Sitzung sichert der Schreiber den letzten Stand (`abschied`, aus `letzterStand` — der Editor ist dann
womöglich schon abgebaut). Wer nur lesen darf (`useKarteFest`), meldet `schreibt: false`.

## Prüfreihe
A Yjs/Nachrichten erst beim Betreten · B zwei tippen gleichzeitig vorne/hinten, gleicher Text, Karte währenddessen nicht verschieb- oder löschbar · C fremder Cursor mit
Name + Farbe, Markierung, Strg+Z nur Eigenes · D Späteinsteiger (ungespeicherter Stand), zu dritt · E Server-JSON = Anzeige, jedes Stück
einmal, kein Konflikt, andere Notiz unberührt · F Neuladen ohne Verdopplung, fremde/kaputte/zu große Nachrichten,
Start-Pakete ohne Yjs · G ohne Kanal wie bisher (kein Yjs, Board-Strg+Z) · H Hilfe, keine Seitenfehler.

Angepasst: `m364`, `m365`, `m366`, `m372`, `m377` prüfen die Karten-Sperre an Notizen jetzt als **Rückweg** (der Kern wird durch eine Fassung ersetzt,
die ablehnt — ein abgebrochener Abruf löste `vite:preloadError` aus und lüde die Seite neu). Lehnt der Kern ab, bleibt
der Editor allein (`kernKaputt`) und bekommt den Cursor zurück. Im gemeinsamen Modus schreibt der Schreiber auch Text,
den ein anderer getippt hat — m366 (Version des Gasts = Server, Besitzer schreibt im Sturm nicht) setzt das alte
Modell voraus und läuft deshalb auf dem Rückweg.

## Grenzen / offen
- Nur **Notizen**. Protokoll (`MinutesCard`), Präsentation (`Presenter`) und andere Karten bleiben bei „wer zuerst
  anfasst".
- **Gemischte Fassungen:** Wer eine ältere App-Fassung nutzt, sperrt die Notiz beim Tippen weiter; seine Änderung
  überschreibt der Schreiber der neuen Fassung beim nächsten Tippen (die gemeinsame Sitzung spielt gespeicherte Stände
  nicht ein, um keine überholten Stände unterzuschieben).
- **Vertrauen im Kanal:** Den Kanal kennt, wer den Link hat — auch mit Rolle „nur lesen". Die App eines Lesenden sendet
  keine Änderungen; ein manipuliertes Programm könnte aber Text unterschieben, den der Schreiber speichert. Vorher
  konnte über den Kanal nichts gespeichert werden (M388: Mitlesen war nur Anzeige). Abhilfe wäre eine Server-Prüfung
  je Absender (Backlog).
- Verdopplung ist nur noch im Randfall möglich: Zwei öffnen im selben Augenblick **verschiedene** gespeicherte
  Fassungen derselben Notiz (etwa eine gerade erst angekommene Änderung) — dann steht der Text einmal je Fassung da.
- Board-Rückgängig nimmt gemeinsam getippten Text nicht zurück (Yjs-Undo im Editor tut es, nur Eigenes); ein
  Wiederherstellen aus den Versionen während einer laufenden Sitzung überschreibt der Schreiber beim nächsten Tippen.
- Ändert jemand den Text einer Notiz auf anderem Weg (ältere Fassung, Werkzeug von außen), während sie gemeinsam offen
  ist, überschreibt ihn der Schreiber beim nächsten Tippen. Der Wechsel des Schreibers sichert nur, wenn sich das
  Dokument in der Sitzung geändert hat.
- Keine neuen Oberflächentexte (Cursor-Schild = Name), daher keine Einträge in `src/sprache/en.json`.
