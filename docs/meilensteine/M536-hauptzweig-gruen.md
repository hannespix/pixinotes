# M536 — Hauptzweig wieder grün: Prüfreihen nach M529/M532, board_aendern räumt jede alte Fassung ab
PR: #232 · Prüfreihen: m525 (S0c, S2b neu), m383b (1d–1f neu); keine eigene m536 · Datum: 2026-11-25

## Warum
Nach M529 und M532 waren auf dem Hauptzweig m374 (E), m395 (A5, B5, B12), m299 (A1) und m383b rot; m525 S1 flatterte (gemeldet aus M534/M535).

## Was
- **Rettungskopie-Hinweis** (M529, `lib/rettung.ts`) ist kürzer: „Gespeicherter Stand nicht lesbar – PixiNotes
  startet leer. Rettungskopie: Einstellungen → Daten." (96 Zeichen; m299 A1 verlangt höchstens 110), englisch
  „Stored state unreadable – PixiNotes starts empty. Rescue copy: Settings → Data."
- Das erste Verschieben einer Sitzung ruckelt nicht mehr: Die Sicherung „Sitzung" (Stand vor der ersten Änderung) entsteht nach dem Ablegen im Leerlauf, und ein Board, das nur von selbst einsammelt, legt beim Start keine solche Version mehr an.
- Die übrigen Befunde waren Fehler der Prüfreihen, nicht der App.

## Befunde
### m383b — „function public.board_aendern(…) is not unique"
Ursache in der **Prüfreihe**: Prüfpunkt 1c sollte „die neue Migration lässt sich ein zweites Mal einspielen" zeigen und
nahm dafür `dateien.find(/board_aendern/)` — seit M529 gibt es zwei solche Dateien, `find` liefert die ERSTE
(`20261115100000_board_aendern.sql`, M383). Deren `create or replace function board_aendern(uuid, text, json, text)`
legte die alte Fassung neben die neue mit sechs Parametern; danach war jeder Aufruf mehrdeutig (die vier ersten
Parameter passen auf beide). Nach der Kette der Migrationen allein (frische Datenbank) gibt es genau **eine** Fassung
`board_aendern(uuid,text,json,text,bigint,bigint)`, und Aufrufe mit vier und mit sechs benannten Parametern (wie
PostgREST) lösen eindeutig auf. Die Migration war also richtig.
- `pruefungen/m383b-sql-board-aendern.mjs`: 1c wiederholt die **jüngste** Migration zu board_aendern; neu 1d (genau eine
  Fassung), 1e (Aufrufe mit 4 und 6 benannten Parametern lösen auf, „kein board" = Funktion lief an), 1f (alte Migration
  erneut und eine fremde Fassung aus einem Entwurf daneben → die jüngste Migration räumt beide ab).
- `pruefungen/sql/m383-board-aendern.sql` C5 prüft die Rechte an der neuen Signatur (`…, bigint, bigint`).
- **Härtung der Migration** `supabase/migrations/20261125100000_board_aendern_vorbedingung.sql`: statt nur
  `drop function if exists board_aendern(uuid, text, json, text)` entfernt ein `do`-Block jede Fassung außer der neuen
  (über `pg_proc`). Stünde irgendeine andere daneben, schriebe sonst kein App-Stand mehr. In der echten Datenbank ist
  die Migration bereits angewendet (dort gab es nur die vierstellige Fassung, also dasselbe Ergebnis); ein erneutes
  Einspielen der gehärteten Datei ist harmlos (wiederholbar).

### m374 E, m395 A5/B5/B12 — `EncodingError` / Bild „nicht wie vorher"
Ursache in den **Prüfreihen**: Sie lasen den Rohtext `localStorage['pixinotes-board']` und erwarteten darin die
data-URL des Bildes. Seit M532 steht dort für Bilder ab 10 000 Zeichen nur ein Verweis `pixinotes-ablage:…`, der Inhalt
liegt in der IndexedDB. Neu in beiden Reihen: `gespeicherterStand(P)` setzt die Verweise aus der IndexedDB ein, genau wie
die App beim Neuladen (`ablageIdb.ts → nachDemLaden/verweiseEinsetzen`). Fehlt ein Inhalt in der Ablage, bleibt der
Verweis stehen — dann scheitert der Vergleich bzw. das Dekodieren wie vorher (die Prüfung ist nicht schwächer, sie prüft
jetzt zusätzlich, dass das Bild in der Ablage liegt).

**Liest die App selbst irgendwo den Rohtext und erwartet data-URLs?** Durchgesehen: alle Leser von
`pixinotes-board` in `src/` (`speicher.ts → getItem/adoptPersistedState`, `ablageIdb.ts`, `App.tsx` nur das
`storage`-Ereignis, `firstRun.ts` nur „gibt es einen Stand"). Export, Sicherung, Teilen, Präsentation, Kopieren und
Abgleich arbeiten auf dem Store, der nie einen Verweis hält. Nachgestellt im echten Build (Skript im Scratch-Ordner,
nicht im Repository): zwei Fenster, Mitleser, Schreiber schließt (auch 150 ms nach dem Einfügen eines neuen großen
Bildes), Nachfolger übernimmt, neu laden, drittes Fenster — alle Bilder überall geladen, im localStorage nur Verweise.
Kein App-Fehler, daher keine neue Prüfreihe.

### m525 S1 — „1,0 Stände" JSON beim Ziehen (gemeldet aus M534/M535) — echter Ruckler, behoben
Je Mausbewegung entsteht weiter kein ganzer Stand. Der eine volle Stand JSON kam aus der **Version „Sitzung"** (M449,
`lib/boardVersionen.ts → initBoardVersionen`): Sie sichert den Stand vor der ersten Änderung der Sitzung und baute dafür
das ganze Board als JSON (`versionSichern` → `JSON.stringify(stand)`). Ist die erste Änderung der erste Schritt eines
Zugs, geschah das **mitten im Zug** — ein Ruckler beim ersten Verschieben jeder Sitzung. In der Reihe entschied die
Taktung, ob es S1 traf: Das Kanban des Prüf-Boards sammelt rund 4,4 s nach dem Start von selbst ein (`runDerived`),
und auch das löste die Version aus — kam das vor dem Zug, war S1 grün, kam es (ausgelastete Maschine) gleichzeitig mit
dem Zug, war S1 rot. Gemessen mit Stapel im Build: Auslöser `updateNodeDataOnBoard` aus `fluss-*.js`, `inDerived()` =
true, t = 4 400 ms.
- **Version „Sitzung" nach dem Zug:** `spaeter(a)` merkt den Stand vor der Änderung (unveränderliches Store-Objekt) und
  sichert ihn 1,5 s später im Leerlauf (`requestIdleCallback`, höchstens 5 s); läuft gerade ein Zug (`zugLaeuft`), erst
  1,5 s nach dem Ablegen (`nachZug`). Wird die Seite verdeckt, sofort (`nachholen` im `visibilitychange`). Die Version
  trägt den Zeitpunkt der Änderung (`versionSichern(…, zeit)`), und jede andere Sicherung sowie `versionenVon` holen eine
  wartende Version „Sitzung" vorher nach (`sitzungZuerst`) — sonst stand sie in der Liste nach „Board verlassen"
  (m449 A6 fing das).
- **Was von selbst entsteht, löst die Version „Sitzung" nicht aus** (`inDerived()`), wie es der Kommentar zu `bereitAb`
  schon für die ersten 2,5 s wollte („sonst entstünde bei jedem Start eine Version"). Die Markierung `geaendert` für die
  automatischen Versionen bleibt wie bisher.
- Prüfreihe m525: neu **S0c** (der Start mit einsammelndem Kanban legt keine Version „Sitzung" an) und **S2b** (nach dem
  Zug entsteht die Version „Sitzung" trotzdem). Vor S1 wartet die Reihe außerdem, bis der Start fertig geschrieben hat
  (M532: einmaliges Schreiben mit Verweisen; kein großes Bild mehr im Text, Zähler 1,5 s ruhig).
- **Gegenproben** (Builds nur zum Messen, nicht im Repository): (1) neuer Stand, aber Version „Sitzung" sofort wie
  vorher → S1 rot mit genau `{"zeichen":482148,"staende":"1.0"}` (das gemeldete Bild); (2) ein Build, der wie vor M525
  bei jeder Store-Änderung den ganzen Stand als JSON baut → S1 rot mit 36,3 Ständen. Die Wartezeit vor S1 verdeckt also
  nichts.
- Ein Versuch, nach dem Sichern eines Bildes nur gemerkte Texte mit data-URL zu verwerfen statt das ganze Gedächtnis
  (`store/speicher.ts`), brachte gemessen nichts und wurde verworfen.

Nebenbei: Mehrere Agenten auf derselben Maschine teilen die festen Ports der Reihen (5525 …); läuft dieselbe Reihe
gleichzeitig in einem anderen Arbeitsbaum, scheitert sie mit `EADDRINUSE` (das Werkzeug wiederholt sie allein).

## Grenzen / offen
- Jeder Start schreibt seit M532 einmal den ganzen Stand (Gedächtnis leer). Bei sehr großen Ständen kostet das einmal
  einige zehn Millisekunden; nicht weiter verfolgt.
- `canEmbed` (lib/nodes.ts) baut beim Einfügen eines Bildes einmal den ganzen Stand als JSON (bekannt seit M532).
- `adoptPersistedState` übernimmt seit M532 nachgeladen (asynchron). Ändert ein Nachfolger im Bruchteil einer Sekunde
  nach der Übernahme etwas, könnte die Übernahme danach eintreffen; im Versuch (Wechsel 150 ms nach dem Einfügen) trat
  nichts auf. Nicht weiter verfolgt.
