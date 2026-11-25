# M536 — Hauptzweig wieder grün: Prüfreihen nach M529/M532, board_aendern räumt jede alte Fassung ab
PR: siehe Merge-Titel „… (M536)" · Prüfreihe: keine neue (kein App-Fehler gefunden) · Datum: 2026-11-25

## Warum
Nach M529 und M532 waren auf dem Hauptzweig m374 (E), m395 (A5, B5, B12), m299 (A1) und m383b rot.

## Was
- **Rettungskopie-Hinweis** (M529, `lib/rettung.ts`) ist kürzer: „Gespeicherter Stand nicht lesbar – PixiNotes
  startet leer. Rettungskopie: Einstellungen → Daten." (96 Zeichen; m299 A1 verlangt höchstens 110), englisch
  „Stored state unreadable – PixiNotes starts empty. Rescue copy: Settings → Data."
- Sonst merkt der Nutzer nichts: Die übrigen Befunde waren Fehler der Prüfreihen, nicht der App.

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

### m525 S1 — „1,0 Stände" JSON beim Ziehen (gemeldet aus M534)
Kein Rückschritt beim Ziehen, sondern **ein** einmaliges Schreiben nach dem Start, das ins Messfenster fiel: Seit M532
lädt beim Start die Ablage nach, setzt Bilder ein bzw. lagert sie aus und schreibt den Stand einmal neu — mit leerem
Gedächtnis (M525) ist das ein voller Stand. Auf einer ausgelasteten Maschine (mehrere Agenten, parallele Reihen) kam
dieses Schreiben erst nach den 2,5 s Wartezeit der Reihe, also während der 30 Mausbewegungen von S1. Nachgestellt:
misst S1 direkt nach dem Laden, steht genau `{"zeichen":482318,"staende":"1.0"}` mit **einem** großen Text da; nach dem
Start-Schreiben gemessen 0,02 Mio. Zeichen.
- `pruefungen/m525-grosse-boards.mjs`: vor S1 wartet die Reihe, bis der Start fertig geschrieben hat (kein großes Bild
  mehr im gespeicherten Text, Zähler `pixinotesSpeicher.geschrieben` 1,5 s ruhig).
- **Gegenprobe:** ein Build, der wie vor M525 bei jeder Store-Änderung den ganzen Stand als JSON baut (eine Zeile in
  `speicherAblage.setItem`, nur zum Messen gebaut, nicht im Repository) → S1 rot mit 36,3 Ständen. Die Wartezeit
  verdeckt also keinen Rückschritt beim Ziehen.
- Ein Versuch, das Gedächtnis nach dem Sichern eines Bildes nur für Texte mit data-URL zu verwerfen statt ganz, brachte
  gemessen nichts (beim Einfügen eines Bildes stammt der volle Stand JSON aus `canEmbed` in `lib/nodes.ts`, siehe
  M532 „Grenzen") und wurde verworfen.

Nebenbei: Mehrere Agenten auf derselben Maschine teilen die festen Ports der Reihen (5525 …); läuft dieselbe Reihe
gleichzeitig in einem anderen Arbeitsbaum, scheitert sie mit `EADDRINUSE` (das Werkzeug wiederholt sie allein).

## Grenzen / offen
- Jeder Start schreibt seit M532 einmal den ganzen Stand (Gedächtnis leer). Bei sehr großen Ständen kostet das einmal
  einige zehn Millisekunden; nicht weiter verfolgt.
- `canEmbed` (lib/nodes.ts) baut beim Einfügen eines Bildes einmal den ganzen Stand als JSON (bekannt seit M532).
- `adoptPersistedState` übernimmt seit M532 nachgeladen (asynchron). Ändert ein Nachfolger im Bruchteil einer Sekunde
  nach der Übernahme etwas, könnte die Übernahme danach eintreffen; im Versuch (Wechsel 150 ms nach dem Einfügen) trat
  nichts auf. Nicht weiter verfolgt.
