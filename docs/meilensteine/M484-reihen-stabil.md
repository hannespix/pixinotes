# M484 — Flatternde Prüfreihen stabilisieren
PR: siehe Merge-Titel „… (M484)" · Prüfreihe: keine neue (Läufer `werkzeug/alle-pruefungen.mjs --wiederhole N`) · Datum: 2026-11-23

## Warum
Mehrere Agenten meldeten Reihen, die unter paralleler Last (`alle-pruefungen.mjs --bahnen 4`) rot und allein grün
sind: m414-vorfuehren-gaeste, m383-karten-einzeln, m387, m428. Jeder Agent verlor damit Wiederholungen und
Gewissheit („ist das meins?").

## Was
- **Läufer:** `node werkzeug/alle-pruefungen.mjs <auswahl> --wiederhole N --bahnen B` legt jede Reihe N-mal in die
  Warteschlange (Durchgang für Durchgang, damit jede Reihe in jedem Durchgang neben anderen läuft), wiederholt
  nichts allein und meldet am Ende je Reihe „x von N grün · min–max s" sowie `FLATTERT`/`IMMER ROT`; Rückgabe 1, wenn
  eine Reihe nicht N-mal grün war. Mit `--json` stehen `gruen`/`laeufe` je Reihe in der Datei.
- **m383 D2 war ein echter Fehler der App (M477):** Der Schreiber einer gemeinsam getippten Notiz wechselte mitten im
  Tippen. Gerd (Gast per Link) tippt in seine neue Notiz; Annas Notiz wacht dafür auf (M477) und tritt der Sitzung bei.
  Hatte Anna die kleinere Kennung, wurde **sie** sofort Schreiberin — beide sicherten kurz nacheinander, und Anna
  schrieb Gerds noch nicht gesicherten Text in ihr Konto (gemessen: Gerds Gerät sicherte bis 1,8 s, dann Annas,
  während Gerd weiter tippte; auf dem Server stand noch „Gerd", Annas `board_aendern` brachte „Gerd für Anna").
  Ohne Last war Gerd meist fertig, bevor Annas Sitzung stand, deshalb nur unter Last (und je nach Zufallskennung).
  Jetzt bleibt der Schreiber Schreiber, bis er die Notiz verlässt.
- **m428:** Der Rahmen der Präsentation trug unter Last laut Playwright die Adresse `""` statt `about:srcdoc` (gemessen:
  `[["http://localhost:4770/",0],["",1]]` — der Editor stand darin). Die Reihe suchte nur `about:srcdoc` und nur den
  ersten Rahmen → `null.locator`. Dazu feste Pausen statt Warten auf die neue Karte und auf den gespeicherten Titel;
  der von außen in `localStorage` gelegte Pfeil konnte vor dem Neuladen von der App überschrieben werden.
- **m383 sonst:** Marken für „seitdem nichts geschrieben" setzt die Reihe erst, wenn der nachgebaute Server 3 s
  nichts mehr bekommen hat (`serverRuhig`) — vorher konnte ein verspäteter Schreibvorgang des vorigen Schritts für den
  nächsten zählen; D1 wartet zusätzlich, bis Annas Text im Konto steht (Gerd sieht ihn über den Kanal früher).
- **m387, m414:** `vortragStart` wartet auf die offene Präsentation (`.presenter`, bis 15 s) statt fester 700 ms (der
  Vortrag wird nachgeladen); m387 H1 wartet erst, bis Gerds Präsentation offen ist, dann die 2,5 s, in denen sie bei
  Anna zu bleiben hat. In den Läufen dieses Meilensteins waren beide unter Last nicht rot zu bekommen — die Änderung
  nimmt die einzige Stelle heraus, an der eine feste Pause einen positiven Zustand voraussetzte.

## Wie (Architektur)
- `src/lib/notizGemeinsamKern.ts`: Anwesenheit (`Awareness`) trägt neu `sichert: true`, solange ein Gerät Schreiber
  ist (`anspruchMelden(an)`, aus `schreiberPruefen()` und nach dem Start). `schreiberKennung()` nimmt unter den
  Schreibberechtigten zuerst die mit Anspruch (kleinste Kennung unter ihnen), sonst wie bisher die kleinste. Wer neu
  dazukommt, sieht den Anspruch schon beim Start: Auf `hallo` geht die eigene Anwesenheit jetzt **vor** dem `stand`
  hinaus (der Neue beginnt mit dem Stand). Verlässt der Schreiber die Notiz (Anwesenheit weg), gilt wieder die
  kleinste Kennung, und der Nächste sichert einmal den ganzen Stand (unverändert).
- `pruefungen/m383-karten-einzeln.mjs`: `serverRuhig(P, stillMs = 3000, maxMs = 25000)` (zählt Patches, ganze Boards,
  Stapel, `freigabe_schreiben`, `gast_aendern`); D2 nennt bei Rot Gerds Karte und ob sein Text schon im Konto stand.
- `pruefungen/m428-ki-ueberarbeiten.mjs`: `rahmen()` prüft alle Rahmen am Inhalt (`#edit`), 30 s; `anlegen()` wartet
  auf die neue Karte im Speicher und den Titel im Stand der Karte (`happ-state:<id>`), wirft sonst mit der Liste der
  Rahmen; `pfeilUndNeuLaden()` legt den Pfeil erneut an, falls die App ihn vor dem Neuladen überschrieb.
- Regeln für neue Reihen: `docs/AGENTEN.md` Abschnitt „Prüfreihen, die unter Last nicht flattern".

## Nachweis
Last = Läufer mit 6 Bahnen plus drei Prozesse mit Dauerlast auf 4 Kernen. Vor der Änderung (je 3 Durchgänge):
m383 1 von 3 und 0 von 3, m428 1 von 3; m414 und m387 je 3 von 3. Nach der Änderung: siehe PR (10 Durchgänge).

## Grenzen / offen
- m414 und m387 ließen sich hier nicht rot machen; ihre Meldungen stammten aus Läufen mit fremder Last (andere
  Agenten). Kommt eins wieder, mit `--wiederhole` nachstellen — der Läufer zeigt die erste Fehlerzeile je Durchgang.
- Der Schreiber-Anspruch ist wie `schreibt` eine Selbstauskunft im Kanal: Ein manipuliertes Programm ohne Schreibrecht
  könnte ihn dauerhaft erheben, dann sicherte bei den anderen niemand den gemeinsamen Text (dieselbe Lücke wie das
  schon bisher selbst gemeldete `schreibt`; Server-Prüfung je Absender steht im BACKLOG unter M477).
