# M520 — Bugfixing-Audit, Karten B: Planung, Daten, Workshop
PR: #213 · Prüfreihe: `pruefungen/m520-audit-karten-b.mjs` (Port 5520), dazu `m513` F5 · Datum: 2026-11-24

## Warum
Auftrag des Besitzers: „Prüfe das gesamte Tool auf Logikfehler und UI-Fehler, ob alles läuft. Quasi ein großes
Bugfixing-Audit." Sechs Agenten teilen sich das Tool; dieser Teil nimmt die Karten für Planung, Daten und Workshop:
Kanban, Zeitplan, Rechen-Tabelle, Kalender, Wochenplan, Zeiterfassung, Timer für alle, Fälligkeiten, Protokoll,
Ideabubbles samt „Mitmachen per QR".

## Vorgehen
Zweigleisig, jeder Befund nachgestellt, bevor er hier landete:
- **Rechenkerne von Hand nachgerechnet** (ohne Browser, gegen `src/lib/`): rund 100 Formeln und Eingaben der
  Rechen-Tabelle (Punkt vor Strich, Potenz, Prozent, Bereiche, Zirkelbezug, Fehlerwerte, deutsche Zahlen, Telefonnummern
  und Postleitzahlen als Text), Datumsrechnung des Zeitplans über Monats-, Jahres-, Schaltjahr- und
  Zeitumstellungsgrenzen, Kalenderwochen 52/53/1, Timer-Eingaben.
- **Jede Karte im gebauten Programm bedient** (playwright-core gegen `dist/`): anlegen, Kernfunktionen, Größe ändern,
  Fokus, kopieren, löschen mit Rückgängig/Wiederholen, neu laden, leer und mit sehr vielen Einträgen (400 Tickets,
  300 Ideen), Board nur zum Lesen, hell/dunkel/pix·el, 390 px, Englisch, vier Zeitzonen, gestellte Uhr; dabei
  Seitenfehler und Konsole mitgeschrieben (keine Fehler; eine Warnung, siehe „Für andere Bereiche").

## Befunde
| Nr | Schwere | Was der Nutzer merkt | Ursache | Stand |
|----|---------|----------------------|---------|-------|
| 1 | mittel | Zeiterfassung, Wochenansicht: Die Kalenderwoche ist im ganzen Jahr 2027 um eins zu hoch („KW 2" für 4.–10. Januar, „KW 53" für Ende Dezember 2027) | `isoWeekNo` rechnete ab 12 Uhr statt ab Mitternacht; der halbe Tag kippt die Aufrundung in jedem Jahr, das an einem Freitag beginnt (2027, 2038 …) | behoben (`TimeCard.tsx`) |
| 2 | mittel | Zeitplan westlich von Greenwich (Amerika): Tageszahlen, Wochenenden, Monatslinien und Kalenderwochen stehen einen Tag neben den Balken — über dem Balken ab 1.12. steht „30" | Balken rechnen in Weltzeit-Tagen, die Kopfzeile las dieselben Zeitpunkte mit der Ortszeit (`getDate()`, `getDay()` …) | behoben: Kopfzeile liest in Weltzeit (`GanttCard.tsx`) |
| 3 | mittel | Zeitplan: Wer einen Balken beim Ziehen zurück an seinen Platz schiebt, bekommt ihn einen Tag daneben | `onDragMove` brach bei „0 Tage Abstand zum Start" ab, statt den Vorgang zurückzusetzen | behoben |
| 4 | niedrig | Zeitplan: Das Feld „Fortschritt" zeigt „0%", obwohl der Balken 30 % zeigt (so beginnt jeder neue Zeitplan) oder 90 % (nach „Zurück" aus Erledigt im Kanban) | die Liste kannte nur 0/25/50/75/100 | behoben: der gespeicherte Wert steht immer in der Liste |
| 5 | mittel | Zeitplan im Dunkeln: Jeder sechste Balken ist unsichtbar (dunkelste Palettenfarbe `#2b2a27` auf fast gleich dunkler Fläche, 1,1:1); der Rand des gewählten Balkens ebenso | Palette und Auswahlrand ohne Rücksicht auf das Thema | behoben: `sichtbareFarbe()` hebt eine Farbe unter 1,8:1 in ihrem Ton auf 3:1 (gespeichert bleibt die gewählte), `auswahlRand` |
| 6 | niedrig | Rechen-Tabelle: Nach dem Hinein- und Herausklicken in eine Zelle tut Strg+Z scheinbar nichts | jedes Verlassen einer Zelle schrieb die Zellen neu und legte einen Rückgängig-Schritt an | behoben (`SheetCard.tsx` → `uebernimm`) |
| 7 | mittel | Rechen-Tabelle: `=WENN(A1="offen";1;0)` findet „Offen" nicht und rechnet still den anderen Zweig — anders als Excel und LibreOffice (wichtig für übernommene Excel-Formeln) | Textvergleich unterschied Groß und Klein | behoben (`lib/formel.ts` → `vergleich`) |
| 8 | mittel | Kalender: „Ansicht umschalten" springt weg — Monat März 2027 → Woche zeigt die heutige Woche; Woche im Januar 2028 → Jahr zeigt das Jahr des zuletzt gezeigten Monats. Außerdem blieb die Wochenansicht auf dem Tag des Umschaltens stehen (zwei Wochen später zeigte sie noch die alte Woche) | der Umschalter setzte immer `anchor: heute` und ließ `month` unberührt | behoben: Monat → Woche des Monatsersten (im laufenden Monat: heute, ohne Festschreiben), Woche → Jahr/Monat der Woche |
| 9 | mittel | Wochenplan: Ein Block vor dem Raster-Beginn (9:00 bei Raster ab 10:00) steht über dem Raster, quer über Titel und Wochentag; einer über das Raster-Ende hinaus ragt unten heraus | gefiltert wurde nur „beginnt vor dem Ende", gezeichnet ohne Zuschnitt | behoben: gezeichnet wird der Teil im Raster (`WeekCard.tsx`) |
| 10 | niedrig | Zeiterfassung: Hinweise an den Ansichts-Knöpfen heißen „Wochees-Ansicht", „Monates-Ansicht" | zusammengesetzt aus Wort + „es-Ansicht" | behoben (ausgeschrieben, auch englisch) |
| 11 | niedrig | Protokoll: Wer das Datumsfeld leert, hat eine Sitzung namens „—", die ans Ende der Reihe rutscht | leeres Datum wurde gespeichert | behoben: ein geleertes Feld ändert nichts |
| 12 | mittel | Kanban: Eine Spalte verschwindet wortlos, ihre Tickets liegen in der Nachbarspalte. Am Telefon reicht dafür ein Doppeltipp auf die verkleinerte Karte: Der erste Tipp öffnet den Fokus, der zweite trifft das ✕ einer Spalte (2 von 24 probierten Stellen) | `removeCol` ohne Rückmeldung; mit dem vorigen Handgriff zu einem Schritt gebündelt | behoben im Kanban: eigener Schritt, Hinweis „Spalte „In Arbeit" gelöscht – 2 Tickets nach „To Do" verschoben." mit „Rückgängig". Die Ursache am Telefon (zweiter Tipp trifft Bedienung) steht unter „Für andere Bereiche" |
| 13 | mittel | Ideabubbles: Die Kopie einer Karte mit laufender Mitmach-Runde (Duplizieren, Board kopieren, Vorlage) zeigt denselben QR-Code — wer ihn scannt, schreibt in die Ur-Karte | das Feld `mitmachen` wird mitkopiert und kannte seine Karte nicht | behoben: `mitmachen.karte` = Kennung der Karte; `mitmachenVon(data, id)` liefert für eine andere Karte keine Runde (Runden von vor M520 ohne Kennung gelten wie bisher) |
| 14 | niedrig | Teilnehmer-Seite (M513, offener Punkt): Beim Abstimmen stehen − Zahl ＋ unter dem Text statt daneben; jede Idee ist anderthalbmal so hoch | die Zeile brach am Telefon um (Flex mit 60 % Textbreite) | behoben: Raster (Klasse `wahl`), Text links, Knöpfe rechts; Prüfpunkt `m513` F5 |
| 15 | mittel | Board nur zum Lesen (und Gäste mit „nur Eigenes"): Der Kalender lässt sich nicht blättern, im Protokoll keine ältere Sitzung öffnen, die Zeiterfassung bleibt in der Tagesansicht, Zeit-Skala und Sortieren/Filtern der Tabelle greifen nicht — jeweils nur der Hinweis „nur zum Lesen freigegeben" | diese Karten halten ihre Ansicht in den Daten; der Leseschutz verwirft jede Änderung an den Daten | behoben: `lib/kartenAnsicht.ts` (`useKartenAnsicht`) hält Ansichts-Felder lokal, wenn die Karte nicht geändert werden darf; der Speicher bleibt unberührt |
| 16 | niedrig | Englische Oberfläche: Das Ergebnis der Ideabubbles nennt „2 Punkte" | Text ohne `zahlWort` | behoben |

**Ohne Befund** blieben: Kanban (Anlegen, Pfeile, Ziehen, WIP-Limit, Abhängigkeiten, Checkliste vor „Erledigt",
Archiv, `spalteSeit`, Löschen mit Abhängigkeit, Rückgängig/Wiederholen, 400 Tickets), der Rechenkern der Tabelle
(bis auf Nr. 7), Auto-Summe, CSV, Filter/Sortierung; Datumsrechnung des Zeitplans (28.12. + 9 Tage = 6.1.,
25.2.2028 + 9 = 5.3., über die Zeitumstellung), Konflikte auflösen, Skalen, KW 53 → KW 1; Zeiterfassung über
Mitternacht und Neuladen; Wiedervorlage und Datumsvorschlag des Protokolls (31.10. + 1 Monat = 30.11.);
Ideabubbles (Budget, Verschmelzen, Ergebnis, 300 Ideen, Rückgängig); die Runde per QR (m513, 57 Prüfpunkte).

## Wie (Architektur)
- `src/lib/kartenAnsicht.ts` (neu): `useKartenAnsicht(id, data, felder)` → `[data, schreiben]`. `schreiben` hat die
  Form von `updateNodeData`. Ist die Karte fest (`useKarteFest`: Board nur lesen oder Gast ohne Recht an der Karte),
  gehen die genannten Felder in einen Arbeitsspeicher je Karte und überlagern beim Zeichnen die Daten; alles andere
  geht an den Speicher (der ablehnt). Genutzt von `CalendarBody` (`month`, `anchor`, `view`, `scope`, `show`),
  `TimeBody` (`view`), `MinutesBody` (`current`), `GanttBody` (`dayWidth`, `labelW`), `SheetBody` (`filterAn`,
  `filter`, `sort`, `kopf`, `bis`, `colW`). **Neue Ansichts-Felder dieser Karten in die Liste ihrer Karte eintragen.**
- `src/lib/mitmachen.ts`: `MitmachenKarte.karte`, `mitmachenVon(data, karte?)`; `mitmachenOeffnen` schreibt die
  Kennung, `BubblesCard` und `mitmachenHost.abgleichen` fragen mit ihr.
- `GanttCard.tsx`: Kopfzeile mit `getUTC…` und `timeZone: 'UTC'`; `onDragMove` vergleicht mit dem Stand des Vorgangs;
  `sichtbareFarbe()`, `auswahlRand`. (Die Datei enthält ein NUL-Zeichen im Schlüssel des Mess-Speichers — beim
  Bearbeiten erhalten.)
- `KanbanCard.tsx` → `removeCol`: `pushHistory()` + `mutedHistory`, Hinweis mit `'schritt'` (Rückgängig im Hinweis, M390).
- `src/mitmachen/main.ts` + `mitmachen.css`: Klasse `wahl` an der Zeile beim Abstimmen, Raster `1fr auto`.
- `src/sprache/en.json`: sechs neue Einträge (Ansichts-Hinweise, Spalte gelöscht).

## Grenzen / offen
Brauchen eine Entscheidung oder sind keine Fehler, sondern fehlende Funktionen:
- **Fristen-Erkennung nur deutsch** (`lib/chronoKern.ts` lädt chrono-`de`): „by Friday", „tomorrow" ergeben auch in
  der englischen Oberfläche keine Frist. Englisch dazuzuladen kostet rund 100 KB (nachladbar) — Entscheidung.
- **Rechen-Tabelle**: Zeilen/Spalten lassen sich nur anhängen (nicht einfügen oder löschen), Bereiche nicht
  kopieren/einfügen; `=HEUTE()+1` ergibt `#WERT!` (das Datum ist Text, es gibt keine Datumsrechnung); Bezüge auf
  ganze Spalten (`A:A`) gibt es nicht. Fehlende Funktionen, keine Fehler.
- **Timer für alle** überlebt das Neuladen beim Starter nicht (so gebaut: wird nirgends gespeichert; die anderen
  behalten ihn bis zum Ablauf).
- **Mitmachen**: Karte mit laufender Runde löschen und mit Strg+Z zurückholen → die Runde ist beendet, die Karte sagt
  aber „Läuft auf einem anderen Gerät" (der Schlüssel ist vergessen); „Mitmachen per QR" startet nach Rückfrage neu.
- **Zähl-Texte** nach M461 noch mit Klammern: „Checklisten-Punkt(e)" (Kanban), „Frist(en)" (Zeitplan),
  „Eintrag/Einträge" (Kalender), „Karte(n)" (Kanban).
- Zeiterfassung: Blättern in Monat/Jahr stellt den Tag auf den 15.; danach zeigt „Tag" den 15. (Schönheitsfehler).

## Für andere Bereiche
- **Fokus/Board (M519/M521)** — Doppeltipp am Telefon: Der erste Tipp auf eine verkleinerte Karte öffnet den Fokus,
  der zweite (90–250 ms später, gleiche Stelle) trifft, was dann dort liegt. Nachstellung: 390 × 780, Touch, Board mit
  einem Kanban (drei Spalten, vier Tickets), `touchscreen.tap` zweimal bei (0,8 · 0,4) bzw. (0,5 · 0,85) der Karte →
  eine Spalte ist gelöscht. Nach dem Öffnen des Fokus sollte die Karte für einen Moment keine Tipps annehmen.
- **Auswahl-Leiste (M521)** — am Telefon ragt die Leiste über einer Karte am rechten Rand aus dem Bild (Papierkorb
  halb abgeschnitten; 390 px, acht Karten, Karte rechts oben gewählt).
- **Leseschutz (M522)** — Karten melden Erfolg, obwohl der Speicher die Änderung verworfen hat (nur lesen:
  Zeiterfassung „Arbeit beendet (2:00 h)", wenn kurz zuvor schon der Lese-Hinweis kam).
- **Rahmen/Start (M523)** — Konsole bei jedem Start mit Notiz oder Protokoll: BlockNote warnt, im viewport-Meta
  fehle `interactive-widget=resizes-content`. Englisch: Zeiterfassung zeigt „day" (klein) neben „Week/Month/Year";
  Kanban-Frist „in 2 T." und „§ ohne TOP" am Beschluss bleiben deutsch.

## Prüfreihe
`m520` (38 Prüfpunkte): A Rechnen · B Kalenderwochen · C Zeitplan (vier Zeitzonen, Ziehen, Fortschritt, Dunkel per
Bildpunkt) · D Tabelle · E Kalender · F Wochenplan · G Protokoll · H Kanban · I Ideabubbles/Mitmachen · J nur lesen ·
K Englisch. Gegen den Stand vor M520 (`PN_DIST=<alter Build>`) sind 26 davon rot. Bilder: `pruefungen/ablage/m520/`.
