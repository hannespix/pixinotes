# M489 — Protokollreihe neu gedacht
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m489-protokoll-neu.mjs` (Port 5489) · Datum: 2026-11-23

## Warum
Nutzerwunsch: „Die Protokollreihe muss bitte massiv überarbeitet werden … Sie funktioniert zum Beispiel im Dark Mode
nicht so gut, und auch sonst finde ich sie einfach noch nicht so übersichtlich und gut funktional. Bitte komplett neu
denken.“

## Vorher (Bestandsaufnahme mit Bildschirmfotos, hell/dunkel, ruhend/markiert/Fokus/Telefon)
- **Dunkelmodus kaputt:** Die weiße Karte ist im Dunkeln eine dunkle Fläche (`--surface-card`), der Protokolltext kam
  aber mit BlockNotes hellem Thema (Schrift `#3f3f3f` auf `#21252a`) — gemessen 1,46:1, praktisch unlesbar (jetzt 12,9:1). Felder und Chips lagen
  mit festen `rgba(0,0,0,.18)`-Flächen darauf; Rot zum Löschen war hart codiert (`#d84b3d`). Eine Karte mit unbekanntem
  Farbwert bekam weder Fläche noch passende Schrift.
- **Gliederung:** sieben gleich laute Zeilen übereinander (Kopf mit Farbpunkt/Farbwähler/Zahnrad/Plus, Blätter-Zeile
  ◀ Auswahl ▶ 3/3 ✕, Datum + Teilnehmer-Freitext, TOP-Chips mit „＋ TOP“-Prompt, Text, Beschlüsse, aufklappbare
  Beschlusslage). Der Sitzungs-Titel aus dem Datenmodell hatte keine Oberfläche.
- **Wege:** Die nächste Sitzung brauchte „+“ ganz oben; ein TOP ging nur über `window.prompt`; Aufgaben und
  Beschlüsse über mehrere Sitzungen sah man nirgends in der Karte (nur in der Aufgaben-Zentrale); Wiederfinden nur
  über die globale Suche; Versenden nur über den Export der ganzen Karte.
- **Fehler nebenbei:** Ein Haken aus der Aufgaben-Zentrale (`extEpoch`, M390) erreichte den offenen Protokoll-Editor
  nicht — der nächste Tastendruck schrieb den alten Stand zurück.

## Konzept
Eine Protokollreihe ist im Büro **eine wiederkehrende Runde**: Man legt die nächste Sitzung an (dieselben Leute, die
offenen Punkte von letztem Mal), schreibt währenddessen schnell mit, hält fest, *wer was bis wann* tut und *was
beschlossen* ist, schickt das Protokoll danach herum und sucht später etwas wieder. Daraus zwei Ansichten — nicht mehr:

1. **Sitzung** (schreiben): Sitzungsleiste (neueste zuerst) → Kopf der Sitzung (Datum · Titel · Werkzeuge · ⋯) →
   Runde als Namen → Tagesordnung als Sprungmarken → Text → Beschlüsse.
2. **Übersicht** (verfolgen): offene Aufgaben nach Person mit Frist, Beschlusslage der Reihe, Teilnahme, Suche über
   alle Sitzungen.

Leitbild „Weniger ist mehr“: flach, keine eigenen Farben — alles über Tokens; Bedienung (Plus, Zahnrad, Werkzeuge,
Eingabezeilen) nur im Fokus (M421-Listen). Das Datenmodell bleibt: Aufgaben **sind** die Checklisten-Punkte im Text,
Person („Anna: …“, „@Anna“) und Frist („bis Freitag“) stehen darin — so lesen Zentrale, Wiedervorlage, KI, Export,
Briefing und MCP alles wie bisher, und alte Protokolle brauchen keine Umwandlung.

## Was (Nutzersicht)
- **Kopf:** Titel · Umschalter **Sitzung | Übersicht** (mit Zahl der offenen Aufgaben) · **＋** (nächste Sitzung) ·
  Zahnrad (Rhythmus, Übernahme, feste Tagesordnung, **Farbe** — Farbpunkt und Farbwähler sind dorthin umgezogen).
- **Neue Sitzung** übernimmt Runde und offene Aufgaben; die Meldung sagt es („… übernommen: 3 Personen und 2 offene
  Aufgaben.“).
- **Sitzungsleiste:** Datums-Chips nebeneinander, neueste zuerst, die gezeigte gefüllt; rollt waagrecht (nur die
  Leiste, nie die Arbeitsfläche).
- **Kopf der Sitzung:** Datum, Titel (optional, neu sichtbar), drei Werkzeuge für die Zeile am Cursor — **TOP**
  (Überschrift), **Aufgabe** (Checklisten-Punkt, erneut = zurück), **§ Beschluss** (die Zeile wird Beschluss und
  verlässt den Text; leere Zeile → Cursor ins Beschlussfeld) — und **⋯**: als Text kopieren, per E-Mail versenden
  (`mailto:` mit Betreff), Sitzung löschen. In schmalen Karten nur als Zeichen (Container-Abfrage), damit sie in der
  Datumszeile bleiben und in Ruhe keine leere Zeile zurücklassen.
- **Runde:** Namen als ruhige Marken, „+ Person“ (Komma trennt mehrere), × entfernt. Gespeichert bleibt der Freitext.
- **Tagesordnung:** die Überschriften der Sitzung als Sprungmarken in den Text.
- **Beschlüsse:** mit Akzentstrich, direkt bearbeitbar (leer = weg), darüber „n Aufgaben offen · m erledigt“.
- **Übersicht:** Suche über alle Sitzungen (jedes Wort, Umlaute/ß tolerant; Klick öffnet die Sitzung) · offene
  Aufgaben nach Person (ohne den Namen im Text), mit Frist („bis Fr. 27.11.“, überfällig in Warnfarbe) und „seit …“
  bei vertagten Punkten, zum Abhaken · Beschlüsse der Reihe mit Datum (Klick öffnet die Sitzung) · Teilnahme „Anna 3/3“.
- **Kachel:** zusätzlich „n offene Aufgaben · nächste Frist …“ bzw. „· k überfällig“ (Warnzeile).
- **Dunkelmodus und Farben:** jede Schrift ≥ 4,5:1 — auf Weiß (folgt dem Theme), auf den Farbtönen (bleiben auch im
  Dunkeln helles Papier) und auf einer freien Farbe (dunkel oder hell nach ihrer Helligkeit), Protokolltext inklusive.
- **Telefon:** nichts breiter als die Karte; Leiste, Reiter und Werkzeuge mit größeren Zielen am Finger.

## Wie (Architektur)
- `src/components/nodes/MinutesCard.tsx` neu: `MinutesBody` mit lokalem Zustand `ansicht` ('sitzung' | 'uebersicht',
  bewusst nicht gespeichert — kein Abgleich), Werkzeuge über den lebenden Editor (`LebenderEditor`: `getTextCursorPosition`,
  `updateBlock`, `removeBlocks`, `insertBlocks`; Knöpfe mit `onMouseDown preventDefault`, damit der Cursor im Text
  bleibt). Übersicht hakt über den Speicher ab (`toggleCheckBlock` aus `lib/tasks.ts`, `extEpoch` + 1) — der Editor ist
  dann abgebaut. Klassen `pr-*`; alte Klassen, die andere Stellen nennen (`minutes-head/-title/-body/-setup/-new/
  -setup-btn/-decision(s)/-decision-add/-tops/-top-chip/-empty/-colorpick`), sind geblieben.
  `EntryEditorWahl`/`ProtokollRuhend`/`EntryEditor` (M487) unverändert in der Schnittstelle; `EntryEditor` übernimmt
  jetzt `extEpoch` (wie `NoteCard` M170; gemeinsam nur der Schreiber).
- `src/lib/minutes.ts` (ohne React): `kurzDatum`, `langDatum`, `fristText`, `teilnehmende`/`teilnehmendeText`,
  `personVon` (@Name immer; „Name:“ nur, wenn der Name in der Runde vorkommt — sonst wäre „Hinweis:“ eine Person),
  `offeneAufgaben` (neueste Sitzung, dieselbe Regel wie `lib/tasks.ts`; Frist über `detectDates` mit
  `sitzungsAnker` — jetzt aus `lib/tasks.ts` exportiert), `aufgabenStand`, `tagesordnung`, `anwesenheit`, `suchNorm`,
  `sucheInReihe`, `sitzungAlsText`, `papierArt` ('hell' | 'dunkel' | 'thema').
- Farben: `MinutesCard`/`Presenter` setzen `papier-<art>`; `styles/52-phone-termine-protokoll.css` leitet daraus
  `--pr-ink/-muted/-linie/-flaeche/-warn` ab und setzt BlockNotes `--bn-colors-editor-text` darauf. Neue Tokens in
  `styles/00-tokens.css`: `--warn-text` (hell/dunkel), `--papier-*` (helles Papier, theme-unabhängig),
  `--nacht-*` (dunkles Papier). `60-dunkel-…` setzt die Protokoll-Schrift nicht mehr pauschal.
- M421-Listen (`99-bedienung-im-fokus.css`, dreimal) und „nur Inhalt“ (`72-…`): `.minutes-setup-btn, .minutes-new,
  .pr-werkzeuge, .pr-person-neu:placeholder-shown, .pr-person-weg, .pr-runde:not(:has(.pr-person)),
  .minutes-decision-add:placeholder-shown, .minutes-decisions:not(:has(.minutes-decision))`.
- `lib/kachel.ts`: Zeile offene Aufgaben (`offeneAufgaben`).
- Datenmodell: **unverändert** (`MinutesData`, `MinutesEntry`); keine Migration, keine neuen Merkfelder für
  `lib/abgleichZeiten.ts` (`current` und `extEpoch` zählen schon nicht als Inhalt, `lib/kartenZeit.ts`).
- Hilfe (beide Sprachen), `src/sprache/en.json` (56 Texte).
- Start-JS: 2 107 883 B mit eingemischtem M486/M488 (Grenze 2 120 000 unverändert). Die Karte selbst lädt weiter nach
  (`React.lazy`, M446); in den Start kommt nur `lib/minutes.ts`, weil die Kachel die offenen Aufgaben zählt.

## Prüfreihe
A Kontraste aller sichtbaren Texte (berechnete Farbe gegen den durch alle halbdurchsichtigen Flächen gemischten
Hintergrund) in Sitzung und Übersicht — hell/dunkel × Weiß/Gelb/dunkle eigene Farbe · B neue Sitzung übernimmt Runde
und offene Aufgaben (mit „offen seit“, ohne Erledigtes), Meldung · C Zeile → Aufgabe/Beschluss, Übersicht nach Person
mit Frist, Beschlusslage, Abhaken, Suche + Sprung · D altes Protokoll (Blöcke ohne Kennung, Semikolon-Runde,
unbekannte Felder) ohne Verlust · E Neuladen · F Telefon hell/dunkel ohne Überlauf, Werkzeuge in der Datumszeile,
Ziele ≥ 28 px am Schirm · G Kachel, keine Seitenfehler.

Angepasste alte Reihen (nur Selektoren — das gemessene Verhalten bleibt): `m421` (Bedienung in Ruhe unsichtbar:
`.pr-werkzeuge` statt der entfallenen Blätter-Zeile `.minutes-nav` und `.minutes-top-add`; Inhalt `.pr-datum` statt
`.minutes-meta input[type=date]`), `m487` (Teilnehmende über `.pr-person-neu` statt des Freitextfelds — Sperr-Hinweis
und Speichern „Anna, Gerd“ unverändert geprüft), `m381` (englische Rückfrage beim Sitzung-Löschen, jetzt über ⋯).

## Grenzen / offen
- Die BlockNote-Menüs (Formatierleiste, Einfügen-Menü) bleiben im hellen Thema (wie in Notizen).
- Abhaken in der Übersicht schreibt über den Speicher; tippt im Live-Board gerade jemand gemeinsam in derselben
  Sitzung (M487), gewinnt dessen Yjs-Stand — der Haken kann dann verloren gehen (selten, wie in der Zentrale).
- Die Person ist eine Konvention im Text (kein eigenes Feld): „Name:“ zählt nur mit einem Namen aus der Runde.
- Versenden per E-Mail nutzt `mailto:` (sehr lange Protokolle kürzen manche Mailprogramme) — „Als Text kopieren“ ist der
  sichere Weg.
- Mehr als ein paar Dutzend Sitzungen: die Leiste rollt waagrecht; eine Jahres-Gruppierung gibt es nicht.
