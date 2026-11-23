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
- `components/nodes/NoteCard.tsx` (Start): `NotizEditorWahl` — solange das Board nie live war, der gewohnte
  `NotizEditor`; sobald ein Kanal steht, die nachgeladene Hülle `NotizGemeinsam.tsx` (Suspense, Rückfall = ruhende
  Ansicht). `NotizEditor` nimmt nur `sitzung`: Editor-Optionen über `sitzung.optionen()`, Änderungen über
  `sitzung.aenderung()` (statt `updateNodeData`), `sitzung.anbinden()`, gespeicherte Stände (`NOTIZ_EXTERN`) werden
  gemeinsam nicht eingespielt, `extEpoch` nur vom Schreiber, Strg+Z ohne Board-Rückgängig.
- `components/nodes/NotizGemeinsam.tsx` (nachgeladen, ≈ 3 KB): Modi `allein` → `pause` → `laedt` → `gemeinsam`, Hülle
  `.note-wahl` (`display: contents`, `data-ohne-sperre`, Klasse `note-gemeinsam`), Fokus nach dem Wechsel.
  Eine eben hier angelegte Notiz beginnt gleich gemeinsam (kein Wechsel unter dem ersten Tippen); ruht die Maus auf
  einer Notiz, wird der Yjs-Teil schon geholt.
- `lib/notizGemeinsam.ts` (lädt mit dem Abgleich, `lib/gastSync.ts` bindet es ein — Kanäle gibt es nur mit ihm):
  horcht auf `LIVE_NACHRICHT`, Weckruf `NOTIZ_Y_WACH` (+ `pixinotes:notiz-aktiv` für ruhende Notizen),
  `gemeinsamGewuenscht`, Nachlader `gemeinsamKern()`.
- `lib/notizGemeinsamKern.ts` (nachgeladen, ≈ 8 KB + Paket `gemeinsam` ≈ 135 KB): Sitzung je Notiz und Gerät
  (`sitzungOeffnen(boardId, nodeId, blocks, schema, darf, warten)`), `Y.Doc` + `y-protocols/awareness`, BlockNote
  `withCollaboration` aus `@blocknote/core/yjs`; `sichern` (Schreiber, nur eigenes Board, nur wenn anders,
  `mutedHistory`).
- **Wann gemeinsam?** Nicht jeder Editor eines Live-Boards hält eine Sitzung (50 Notizen = 50 Fragen an jeden):
  allein, bis man die Notiz **betritt** (Pointer-/Fokus-Ereignis an der Hülle; der Klickpunkt wird über
  `startPunkt` an den neuen Editor weitergereicht) oder bis ein anderer in ihr arbeitet (`NOTIZ_Y_WACH`; eine ruhende
  Notiz wacht dafür auf). Gewechselt wird nie unter dem Cursor: zwischen zwei Editoren steht kurz die ruhende
  Ansicht, so sichert der alte, bevor der neue liest. Bricht der Kanal ab, geht es zurück zu `allein`, sobald der
  Cursor die Notiz verlassen hat. Lädt der Kern nicht, bleibt es bei `allein` (mit Sperre, Cursor zurück).
- **Karte bleibt, wie sie ist, solange getippt wird:** `store.ts` `setzeNotizSchutz(boardId, Map<Notiz, Name>)` —
  steht der Cursor eines anderen in der Notiz (Awareness-Feld `cursor`), darf hier nur ihr Text (`data.blocks`) sich
  ändern; Lage, Farbe, Archiv, Löschen nicht (`sperrschutz(…, nurText = true)`, Hinweis wie bei der Sperre). Der
  Schreiber sichert die ganze Karte bei jedem Tastendruck — eine gleichzeitige Änderung derselben Karte ginge im
  kartenweisen Abgleich verloren.
- **Der Schreiber heilt:** `anbinden` hört auf den Speicher; kommt die Notiz von außen mit anderem Text an (jemand hat
  sie verschoben oder umgefärbt, als niemand tippte, und dabei seine ein paar Zeichen ältere gespeicherte Fassung des
  Texts mitgeschickt), sichert der Schreiber den Text des Y-Dokuments erneut — Lage und Farbe bleiben (Prüfreihe E7/E8).
- `lib/sicherNotizY.ts` (Teil der Schicht `lib/sicher.ts`, eigene Datei nur, damit sie nachlädt):
  `notizYVonAussen(roh, anwesende)` — Gestalt, Absender muss in der Presence stehen, Base64 nur aus seinen Zeichen,
  je Nachricht ≤ `NOTIZ_Y_TEIL_ZEICHEN` (48 000), höchstens `NOTIZ_Y_TEILE_MAX` (90) Teile, `offen` ≤ 200 Kennungen.
- Vite `manualChunks`: `yjs`, `y-prosemirror`, `y-protocols` (samt ihrem eigenen lib0 0.2) und
  `@blocknote/core/dist/yjs.js` → Paket `gemeinsam`; sonst zöge die Editor-Regel sie in den Start.
- **Start-JS:** Der Hauptzweig stand nach M476/M478 bei 2 239 956 B (44 B unter `START_JS_GRENZE` 2 240 000 in
  m446/m459/m467). Damit Platz bleibt, lädt die **Live-Leiste** (Kürzel, Liste, Werkzeuge der Gruppe) jetzt erst, wenn
  das Board live ist: `components/LiveLeisteVoll.tsx` (≈ 4,7 KB), `LiveLeiste.tsx` behält `LiveSperren`,
  `GastNameDialog`, `NAME_FRAGEN`, `useTakt`, `kuerzel`, `farbe` und eine kleine `LiveLeiste`, die nachlädt (ohne Kanal
  zeigte sie ohnehin nichts). Start nach M477: 2 237 043 B — Grenze unverändert.
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
einmal, kein Konflikt, andere Notiz unberührt; ohne Tippende darf Gerd sie verschieben, der Text bleibt (E7/E8) · F Neuladen ohne Verdopplung, fremde/kaputte/zu große Nachrichten,
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
- Solange der Cursor eines anderen in der Notiz steht, lässt sie sich nicht verschieben, umfärben oder löschen (wie die
  frühere Sperre, nur für alles außer dem Text).
- Board-Rückgängig nimmt gemeinsam getippten Text nicht zurück (Yjs-Undo im Editor tut es, nur Eigenes); ein
  Wiederherstellen aus den Versionen während einer laufenden Sitzung überschreibt der Schreiber beim nächsten Tippen.
- Ändert jemand den Text einer Notiz auf anderem Weg (ältere Fassung, Werkzeug von außen), während sie gemeinsam offen
  ist, überschreibt ihn der Schreiber beim nächsten Tippen. Der Wechsel des Schreibers sichert nur, wenn sich das
  Dokument in der Sitzung geändert hat.
- Geht der Kanal erst auf, während jemand schon in einer Notiz tippt (ein, zwei Sekunden nach dem Öffnen des Boards),
  baut sich ihr Editor einmal neu auf (allein → Hülle); der Cursor muss dann neu gesetzt werden.
- Keine neuen Oberflächentexte (Cursor-Schild = Name), daher keine Einträge in `src/sprache/en.json`.
