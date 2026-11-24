# M512 — Timer für alle frei einstellbar (z. B. 90 Minuten)
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m512-timer-frei.mjs` (Port 5512) · Datum: 2026-11-24

## Warum
Wunsch: „timer kann man momentan nur auf max 15 minuten stellen. bitte freie eingaben erlauben auch z. B. 90 m“.
Der Timer für alle (M376, seit M391 eine Zeile in der Liste der Gruppe hinter der Leiste oben rechts) bot nur die
festen Zeiten 1, 2, 3, 5, 10, 15 Minuten. `timerStart` hätte bis 120 Minuten angenommen, die Empfänger bis 121.

## Was
- **Schnellwahl** bleibt und reicht jetzt bis zur Stunde: 1 · 2 · 3 · 5 · 10 · 15 · **30 · 60** Minuten.
- **Freies Feld** darunter (`TimerZeile` in `components/Gruppenraum.tsx`, Formular `timer-frei`): Enter oder „Start“.
  Was verstanden wurde, steht vor dem Start darunter („= 1:30:00“); ungültig bleibt die Liste offen, das Feld wird
  rot markiert (`aria-invalid`) und darunter steht ein Satz (`role="alert"`): „Bitte eine Dauer wie 90, 1h30 oder 45s
  eingeben.“, „Mindestens 10 Sekunden.“, „Höchstens 12 Stunden.“ Tippen nimmt die Meldung weg.
- **Formen** (`lib/timerDauer.ts`, `timerDauerLesen`, nur mit der Liste nachgeladen, nicht im Start-Bundle):
  eine Zahl sind Minuten (`90`, `7`, `1,5`); Zahl + Einheit in absteigender Folge (`90m`, `90 min`, `2h`, `1,5 h`,
  `1.5h`, `1h30`, `1h 5m 30s`, `45s`, deutsch und englisch: std/stunden/hr/hours, min/minuten/minutes,
  s/sek/sec/sekunden/seconds); eine Zahl ohne Einheit nach einer Einheit nimmt die nächstkleinere (`1h30` = 1 h 30 min).
  Doppelpunkt: `1:30` = **Stunden:Minuten** (wie die Uhr ab einer Stunde zeigt), `1:30:00` = h:mm:ss; `0:45` sind
  also 45 Minuten — die Vorschau sagt es vor dem Start. Spanne **10 Sekunden bis 12 Stunden**
  (`TIMER_MIN_MS`/`TIMER_MAX_MS` in `lib/gruppenraum.ts`).
- **Anzeige** ab einer Stunde mit Stunden: „1:29:59“, darunter wie bisher „4:05“ (`timerText`). Ende „Zeit ist um“,
  Anhalten (jeder), späterer Start gilt, Spätkommer bekommen den Stand — unverändert aus M376.
- **Empfänger** (`initGruppenraum`): Restzeit bis 12 h + 1 min Spiel; die mitgeschickte Gesamtdauer (nur für den
  Balken) wird ebenso begrenzt, sonst gilt die Restzeit (vorher konnte ein Unsinnswert den Balken auf 0 setzen).
  Eine Prüfung in `lib/sicher.ts` gab es für den Timer nie — die Kanal-Prüfung steht in `lib/gruppenraum.ts`.
- **Takt** (`GruppenraumSchicht`): statt viermal je Sekunde wird genau dann nachgesehen, wenn die Anzeige umspringt
  (Wecker auf die nächste volle Sekunde, höchstens einmal je Sekunde). Ein **verdeckter Tab** stellt nur einen Wecker
  aufs Ende (Ton beim Starter) und rechnet sonst nichts; beim Zurückkehren (`visibilitychange`) kommt die Restzeit aus
  der Endzeit. Der Balken gleitet passend dazu in 1 s.
- **Telefon**: `inputmode="numeric"` (Zahlentastatur, Minuten), `enterkeyhint="go"`; Schnellwahl, Feld und „Start“
  44 px hoch (Schnellwahl 44 × 44, vorher 38), Schrift im Feld 16 px, damit iOS beim Antippen nicht hineinzoomt.
- **Tasten**: Das Feld lässt Tasten nicht zum Board durch (keine Kürzel beim Tippen von „f“, „n“ …), nur Esc schließt
  wie bisher die Liste. Neue Tastenkürzel gibt es keine.
- Texte: Wörterbuch (`en.json`), „Was ist neu“ DE/EN; im M376-Eintrag steht statt „1 bis 15 Minuten“ der Verweis auf
  M512; die Hilfe (Speichern, Sync & Teilen) hat einen Punkt „Gemeinsam im Board“.

## Einschränkungen
- **Ältere App-Fassungen** nehmen Restzeiten bis 121 Minuten an: 90 Minuten sehen auch sie, einen Timer über zwei
  Stunden verwerfen sie still (die Uhr erscheint dort nicht). Sie zeigen Stunden als „90:00“ statt „1:30:00“.
- Auf dem **iPhone** hat die Zahlentastatur nur Ziffern — dort gibt man Minuten ein („90“, „150“); Formen mit
  Buchstaben oder Doppelpunkt gehen am PC und mit Android-Tastaturen, die Satzzeichen anbieten.
- Die Uhr oben in der Mitte kann am schmalen Telefon die Leiste der Gruppe überdecken (schon vor M512 so; mit
  Stunden ist sie etwas breiter) — Kandidat für die Telefon-Live-Leiste (M511).

## Prüfreihe
`pruefungen/m512-timer-frei.mjs` (54 Prüfungen, nachgebautes Supabase aus m376): A 90 Minuten bei Anna und Gerd, Kontraste der Zeile,
Hanna kommt später · B zwölf Formen und sechs ungültige Eingaben, keine Board-Kürzel aus dem Feld · C späterer Start
über „Start“, Anhalten (Uhr und Liste), Ende „Zeit ist um“ mit vorgestellter Uhr bei der Starterin · D elf Stunden
kommen an, dreizehn nicht; Takt einmal je Sekunde; verdeckter Tab steht still und rechnet nach; Gesamtdauer begrenzt ·
E iPhone: Maße, Zahlentastatur, Start und Anhalten per Tippen · F Texte. `m376` zählt jetzt acht Schnellwahlen.
