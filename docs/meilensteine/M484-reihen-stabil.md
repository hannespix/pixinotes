# M484 — Flatternde Prüfreihen stabilisieren
PR: siehe Merge-Titel „… (M484)" · Prüfreihe: keine neue (Läufer `werkzeug/alle-pruefungen.mjs --wiederhole N`) · Datum: 2026-11-23

## Warum
Mehrere Agenten meldeten Reihen, die unter paralleler Last (`alle-pruefungen.mjs --bahnen 4`) rot und allein grün
sind: m414-vorfuehren-gaeste, m383-karten-einzeln, m387, m428; nach M483 (Auswahl-Leiste u. a. nachgeladen) dazu
m332, m447, m429, m354, m366. Jeder Agent verlor damit Wiederholungen und Gewissheit („ist das meins?").

## Was
- **Läufer:** `node werkzeug/alle-pruefungen.mjs <auswahl> --wiederhole N --bahnen B` legt jede Reihe N-mal in die
  Warteschlange (Durchgang für Durchgang, damit jede Reihe in jedem Durchgang neben anderen läuft), wiederholt
  nichts allein und meldet am Ende je Reihe „x von N grün · min–max s" sowie `FLATTERT`/`IMMER ROT`; Rückgabe 1, wenn
  eine Reihe nicht N-mal grün war. Mit `--json` stehen `gruen`/`laeufe` je Reihe in der Datei; `--ablage <ordner>`
  legt die volle Ausgabe jedes roten Laufs als `<reihe>-<durchgang>.txt` ab (der Bericht zeigt nur die ersten Zeilen).
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
- **m387 I8/I11 war ein echter Fehler der App (M387, Folgen):** Wer dem Vorführenden folgt, bekommt für dessen offene
  Dokument-Karten „zeige" (die Karte klappt auf) und, sobald sie dort zu sind, „zuklappen" — aber nur für Karten, die
  in `aufGefolgt` stehen, und dort landete eine Karte nur, wenn sie hier noch zu war. Unter Last kam Annas Fokus vor
  ihrer Seitenangabe an: Gerds Karte war im Fokus schon offen, bekam beim Blättern „zeige", stand aber nicht in der
  Liste — nach dem Schließen des Fokus blieb sie bei Gerd offen (gemessen: Anna `auf: false`, Gerd `auf: true`).
  Jetzt wird jede Karte gemerkt, der „zeige" galt; „zuklappen" nimmt nur das Zeigen zurück, eine selbst aufgeklappte
  Karte bleibt offen.
- **m387, m414:** `vortragStart` wartet auf die offene Präsentation (`.presenter`, bis 15 s) statt fester 700 ms (der
  Vortrag wird nachgeladen); m387 H1 wartet erst, bis Gerds Präsentation offen ist, dann die 2,5 s, in denen sie bei
  Anna zu bleiben hat.
- **m414 F1:** Das untergeschobene fremde Abbild (Folgenummer 1e9) wurde unter Last vom nächsten echten Abbild Annas
  ersetzt, bevor die Reihe es las (gewollt: eine viel kleinere Nummer gilt als Neubeginn) — `getComputedStyle(null)`,
  Absturz bzw. `null`. Die Reihe liest es jetzt neu und sendet es nach je 1,5 s erneut, bis sie es zu fassen bekommt;
  geprüft wird weiter dasselbe (ohne Skripte, Rahmen, Weiterleitung, Ereignis-Merkmale, `javascript:`).
- **m477 B8:** Der Hinweis „Anna tippt gerade" erschien, war aber nach Zug und 900 ms Warten unter Last schon wieder
  weg (auch ohne die Änderung dieses Meilensteins 2 von 4 rot). Die Reihe schreibt jetzt jeden Hinweis mit, der während
  des Zugs erscheint (MutationObserver), und prüft, ob einer Anna nennt.
- **Nach M483 (nachgeladene Auswahl-Leiste):** m447 F wartet auf `.sel-toolbar` statt 600 ms; m332 `auswahlMenue` und
  m428 D2 warten auf Leiste, „Mehr"-Menü und KI-Menü statt 400/500 ms.
- **m332 C6/C8/D1/E1:** Die Endmeldung kam, aber der gespeicherte Stand hatte noch 0 Notizen — der Speicher schreibt
  verzögert, unter Last erst nach der Abfrage. `gespeichert()` wartet, bis `pixinotes-board` 1 s gleich bleibt.
- **m477 C5:** Strg+Z nahm unter Last nur „XYZ", nicht „ XYZ" zurück — Yjs fasst Tasten nur binnen 500 ms zu einem
  Schritt zusammen, die einzeln getippten Zeichen lagen weiter auseinander. Die Reihe fügt „ XYZ" in einem Zug ein.
- **m354 A2:** Der Strich lag nach 400 ms noch nicht im gespeicherten Stand (der Wert der Meldung, eine Abfrage später,
  stimmte). `zeichnen()` wartet, bis sich der Stand ändert; die Prüfung, dass ein Radierer nichts trifft (E2), behält
  ihre feste Wartezeit.
- **m429 B1:** wartet erst, bis 1 s lang nichts mehr läuft (höchstens 20 s), und prüft dann 3 s Stillstand. (Ein
  Versuch für A1 — Messbeginn erst mit allen Namen, unter Last zwei Messintervalle — machte es nicht besser und ist
  zurückgenommen, siehe „Grenzen".)
- **m476 G2/G4/G8:** Die Sicherungsdatei steht im Ordner, sobald sie angelegt ist; Inhalt und das Aufräumen der
  alten Sicherungen folgen danach. Die Reihe wartet jetzt auf den fertigen Zustand (höchstens 7 Dateien, heutige nicht
  leer) statt nur darauf, dass die Datei auftaucht.
- **m366 (und 23 weitere Reihen mit demselben Helfer `notiz()`):** „Port belegt" war kein Fehler der Reihe (andere
  Agenten starteten sie ohne den Läufer). Der TimeoutError (bei Last über 20 auf 4 Kernen, mit `--ablage` gefunden):
  `notiz()` legt per Doppelklick eine Notiz an, wartete 700 ms auf den Cursor darin und klickte sonst in den Editor der
  letzten Karte — unter Last kam der Cursor später, der Klick traf die Hülle einer anderen Karte (`.card-shell`
  „intercepts pointer events") und hing 30 s. Jetzt wartet `notiz()` nach den 700 ms bis zu 8 s auf den Cursor.

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
- `src/components/Vorfuehren.tsx`: `aufGefolgt.current.add(karte)` für jede Karte, der „zeige" gilt.
- Regeln für neue Reihen: `docs/AGENTEN.md` Abschnitt „Prüfreihen, die unter Last nicht flattern".

## Nachweis
Last = Läufer mit 6 Bahnen auf 4 Kernen, dazu andere Agenten (Lastmittel 10–20) bzw. Prozesse mit Dauerlast.
Vor der Änderung: m383 1 von 3 und 0 von 3, m428 1 von 3, m477 2 von 4 (Hauptzweig), m387 1 von 2, m354 1 von 2,
m332 in 3 von 4 Durchgängen rot (nach M483), m366 8 von 10. Nach der Änderung (`--wiederhole 10 --bahnen 6`, zuletzt nach dem Einmischen
von M487):

| Reihe | grün |
|---|---|
| m383-karten-einzeln | 10 von 10 |
| m387-praesentation-fuer-alle | 10 von 10 |
| m414-vorfuehren-gaeste | 10 von 10 |
| m428-ki-ueberarbeiten | 10 von 10 |
| m366-grosse-gruppe | 10 von 10 |
| m477-gemeinsam-tippen | 10 von 10 |
| m332, m354, m447, m400–m409 | je 10 von 10 (Lauf davor) |
| m476-sicherung | 6 von 6 |
| m429-bubbles-ruhig | 7 von 10 (A1, offen) |
| m487-gemeinsam-weiter | 8 von 10 (B5/B8, offen, M487) |

## Grenzen / offen
- **m429 A1 flattert weiter** (in 10 Durchgängen 1–3 rot, Werte 8,8 bis 21 bei Grenze 6/12): Die Reihe misst ein
  Gleiten Bild für Bild, das unter CPU-Mangel nicht mehr gleichmäßig ist; ob dahinter auch ein Verhalten der App steckt
  (Kräfte je Bild statt je Zeit beim Einschwingen), ist offen. Eigene Aufgabe: Messung von der Bildfolge lösen oder die
  Physik zeitbasiert prüfen — nicht einfach die Grenze heben.
- **m487 B5/B8 flattert** (gleichzeitiges Tippen im Protokoll, M487): Unter Last landen Gerds Zeichen mitten in Annas
  Text bzw. ein Leerzeichen fehlt, auf beiden Seiten gleich. Gehört zu M487 (Cursor-Lage im gemeinsamen Protokoll), hier
  nicht angefasst.
- m477 lief einmal in das Zeitlimit des Läufers (600 s, hängend bei `keyboard.type` nach Abschnitt B, Last ~20 auf
  4 Kernen); nicht wieder aufgetreten, Ursache offen.
- Der Schreiber-Anspruch ist wie `schreibt` eine Selbstauskunft im Kanal: Ein manipuliertes Programm ohne Schreibrecht
  könnte ihn dauerhaft erheben, dann sicherte bei den anderen niemand den gemeinsamen Text (dieselbe Lücke wie das
  schon bisher selbst gemeldete `schreibt`; Server-Prüfung je Absender steht im BACKLOG unter M477).
