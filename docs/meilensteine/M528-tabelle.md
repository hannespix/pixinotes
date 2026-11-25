# M528 — Rechen-Tabelle wie Excel: Zeilen/Spalten einfügen und löschen, Bereiche kopieren, Datumsrechnung, ganze Spalten
PR: #… · Prüfreihe: `pruefungen/m528-tabelle.mjs` (Port 5528) · Datum: 2026-11-25

## Warum
Offene Punkte aus dem Audit M520 („Rechen-Tabelle: Zeilen/Spalten lassen sich nur anhängen, Bereiche nicht
kopieren/einfügen; `=HEUTE()+1` ergibt `#WERT!`; Bezüge auf ganze Spalten gibt es nicht"), vom Besitzer freigegeben
(„setzte alles um"). Dazu beim Nachstellen gefunden: Zwei Geräte am selben Konto, die gleichzeitig in **verschiedene**
Zellen derselben Tabelle schrieben, verloren eine der beiden Änderungen — `cells` ist für den Abgleich (M524, Feld für
Feld) EIN Feld, „beide geändert" ließ die hiesige Fassung gelten.

## Was
- **Zeilen und Spalten einfügen/löschen an jeder Stelle:** Rechtsklick auf einen Zeilen- oder Spaltenkopf (oder eine
  Zelle) öffnet ein kleines Menü: Zeile oberhalb/unterhalb einfügen, Zeile löschen, Spalte links/rechts einfügen,
  Spalte löschen. Sind mehrere Zeilen/Spalten ausgewählt, gilt es für alle („2 Zeilen oberhalb einfügen"). Mit einer
  Auswahl stehen die vier häufigsten Schritte auch im ⋯ der Tabelle. Formeln passen sich an wie in Excel/LibreOffice:
  Bezüge hinter der Stelle wandern, Bereiche wachsen (Einfügen innerhalb) oder schrumpfen (Löschen innerhalb), ein
  Bezug auf eine gelöschte Zelle wird `#BEZUG!` (englisch `#REF!`), auch `$`-Bezüge wandern mit. Links, Aussehen,
  verbundene Zellen, Spaltenbreiten, Kopfzeile, Filter und Sortierung wandern mit. Ein Schritt für Strg+Z; Löschen mit
  Inhalt meldet „Gelöscht: 2 Zeilen." mit „Rückgängig". Bei 26 Spalten geht Einfügen nur, wenn hinten leere Spalten
  wegfallen können (sonst der bekannte Hinweis aus M520).
- **Auswahl und Zwischenablage:** Umschalt+Klick, Ziehen über Zellen, Klick auf einen Kopf (ganze Spalte/Zeile, mit
  Umschalt bis dorthin), Esc aus dem Bearbeiten (behält die Zelle gewählt), Strg+A. Dann: Pfeile (mit Umschalt
  erweitern), Tab, Enter/F2 bearbeitet, Lostippen ersetzt die Zelle, Entf leert, Esc hebt auf. **Strg+C/X/V** innerhalb
  der Tabelle, zwischen Tabellen und von/nach Excel, LibreOffice, Google Sheets: Kopiert wird der sichtbare Text als
  Tabulator-Text; innerhalb von PixiNotes reisen Formeln, Links und Aussehen mit, relative Bezüge wandern um den Abstand
  (`=B1*2` von C1 nach D5 → `=C5*2`), `$`-Teile nicht, was über den Rand fiele, wird `#BEZUG!`. Ausschneiden + Einfügen
  verschiebt: Formeln bleiben, wie sie sind, und Bezüge auf die verschobenen Zellen folgen ihnen (wie Excel).
  Ein einzelner kopierter Wert füllt eine größere Auswahl. Was größer ist als die Tabelle, erweitert sie (Zeilen bis
  1 048 576, Spalten bis 26 bzw. bis zur vorhandenen Breite einer Excel-Tabelle; der Rest mit Hinweis weggelassen).
- **Datumsrechnung:** `=HEUTE()+1`, `=HEUTE()-A1` (Zahl → Datum, Datum → Tage), Datum − Datum = Tage, Datum ± Zahl =
  Datum, Zahl + Datum = Datum; Datum + Datum und Zahl − Datum sind `#WERT!`; zwei Daten vergleichen. Neu `JETZT`/`NOW`,
  `DATUM`/`DATE`, `JAHR`/`YEAR`, `MONAT`/`MONTH`, `TAG`/`DAY`. Als Datum gilt ein Wert „2026-11-25" (so lieferte
  `HEUTE()` es schon immer) oder eine eingetippte Angabe „24.12.2026" / „1.3.26". Angezeigt: deutsch `TT.MM.JJJJ`,
  englisch `TT/MM/JJJJ`, mit Uhrzeit ` HH:MM`; ausgerechnete Daten stehen rechtsbündig.
- **Ganze Spalten und Zeilen:** `A:A`, `B:D`, `$A:$A`, `1:1`, `2:5` in jeder Funktion. Es zählen nur belegte Zellen;
  steht die Formel selbst im Bereich, ist das ein Ring (`#ZYKLUS!`, wie bisher bei jedem Ring).
- **Abgleich:** Fügt Gerät A eine Zeile ein, während Gerät B in eine Zelle schreibt, landet B's Eintrag auf beiden
  Geräten in der verschobenen Zelle; löscht A die Zeile, in die B schreibt, bleibt sie gelöscht (wie Google Sheets).
  Zwei Geräte in verschiedenen Zellen ohne Umbau: beides bleibt (vorher war eines weg).

## Wie (Architektur)
- `src/lib/formel.ts` (im Start-Paket, weil Suche/Export Tabellen als Text lesen) bekommt nur **Haken**: `plus.lex`
  (eigene Zeichen), `plus.wert` (ihr Wert), `plus.rechne` (+/− und Vergleiche), `plus.zeige` (Anzeige). Zeichen tragen
  ihre Stelle im Text (`p`, `e`; `zerteile` exportiert — der Schleifenrumpf steht dafür in `do { … } while (false)`,
  ein `continue` verlässt nur ihn). `Lage.belegt` = alle belegten Adressen (für ganze Spalten), `rechne(f, lies, belegt?)`.
  `FUNKTIONEN`, `ALIAS`, `zuZahl`, `Zeichen`, `Lage` sind exportiert.
- `src/lib/formelPlus.ts` (nachgeladen): setzt die Haken. Zeichen `plus` mit Wert `F#BEZUG!` (Fehlerwert in der Formel,
  `#REF!` u. a. gelesen), `SA:C` (Spalten), `Z1:3` (Zeilen). Datum: `tageVon` (Tage seit 1970 „wie an der Wand", UTC
  ohne Zeitzone), `datumAus`. Bezüge umschreiben über dieselben Zeichen: `bezuegeUmschreiben(roh, fn)` (Bezug =
  zelle/bereich/spalten/zeilen mit `Stelle {i, fest}`; unveränderte behalten ihre Schreibweise, Texte in "…" bleiben),
  `bezuegeVerschieben` (Kopieren), `bezuegeVerlegen` (Ausschneiden), `bezuegeUmbauen` + `umbauNummer`/`umbauSpanne`
  (Einfügen/Löschen; `UmbauSchritt {a: 'z'|'s', bei ab 0, n > 0 einfügen / < 0 löschen}`). `bezugFehlerText()` schreibt
  `#BEZUG!` bzw. in der englischen Oberfläche `#REF!`.
  Geladen von `SheetCard` und `RechenTabelleGitter` (statisch, beide sind eigene Stücke), `serialize.ts` stößt es beim
  ersten Tabellen-Text an (bis dahin rechnet die Suche ohne Datum/ganze Spalten).
- `src/lib/tabellenUmbau.ts` (nachgeladen): `umbauAnwenden(data, schritt)` → Felder für EIN `updateNodeData`;
  `umbauNeu`, `UMBAU_MAX` (40), `tsvLesen`/`tsvSchreiben` (Excel-Quoting, CRLF). **Neues Datenfeld
  `SheetData.umbau`** = die letzten Schritte mit Kennung (in `types.ts`, in `GESTALT` mit `umbauSchritt`).
  `tabelleMischen(B, L, F)`: gemeinsame neue Schritte vorne abziehen; hat nur eine Seite neue Schritte, werden Basis
  und die andere Seite durch sie geschickt (dieselbe Rechnung, auf jedem Gerät gleich), dann je Zelle/Schlüssel
  dreiwegig (`je3`) für `cells`, `links`, `stile`, `colW`, `filter`, einzeln (`eins3`) für `kopf`, `bis`, `sort`,
  `verbunden`; `rows`/`cols`: hat jede Seite geändert, das Größere. Beide mit neuen Schritten oder Protokoll reicht nicht
  zurück → `null` = wie bisher Feld für Feld (Konflikt, hiesige gilt). Unverändertes bleibt das hiesige Objekt (M524).
- `src/lib/syncMerge.ts`: `tabellenMischen { f, felder }` — Haken, den `tabellenUmbau` beim Laden setzt; `karteFeldweise`
  nimmt bei `sheet`-Karten dessen Felder heraus und legt sein Ergebnis darüber. `syncFolder.fremdStandEinarbeiten`
  (Konto, Ordner, WebDAV) und `gastSync.holen` laden das Stück vor dem Mischen nach.
- `src/components/nodes/SheetCard.tsx`: Auswahl `auswahl {a, b}` (Spalte/Zeile ab 0), unsichtbares Textfeld
  `.sheet-ablage` (hält den Fokus während einer Auswahl; nimmt Tasten und die Ereignisse der Zwischenablage — `onCopy`,
  `onCut`, `onPaste`; `inputMode="none"`, damit am Telefon keine Tastatur aufgeht), `ablageFokus` (sofort und nach dem
  Zeichnen — sonst landete ein schnelles Strg+V nach Esc beim Board als Notiz), `verwerfen` (Esc übernimmt nichts beim
  Verlassen des Felds). Modulweit `zwischen` = zuletzt Kopiertes mit Formeln/Links/Aussehen; eingefügter Text, der ihm
  gleicht (Zeilenenden normalisiert), gilt als „aus PixiNotes". Struktur-Schritte, Einfügen und Leeren über
  `schreiben(patch)` = `pushHistory` + `mutedHistory(updateNodeData)` (eigener Rückgängig-Schritt, nicht mit dem Tippen
  davor gebündelt; nicht über `useKartenAnsicht`, damit ein Board nur zum Lesen alles ablehnt statt Ansichtsfelder lokal
  zu verschieben). `UmbauMenue` (Portal, `ebenen-menu`, Esc und Klick daneben schließen, Pfeile wandern). Tabelle trägt
  `data-eigenes-menue` → `Kontextmenue.tsx` lässt den Rechtsklick dort dem eigenen Menü.
- CSS (`58-barrierefreiheit-tabelle.css`): `.gewaehlt` (Fläche `--accent-soft` wie beim Zeigen), `.anker` (Rahmen
  `--accent`), `.ausgeschnitten` (gestrichelt), Köpfe `.gewaehlt`, `.sheet-ablage` (unsichtbar), Zellen
  `user-select: none` (Ziehen markiert Zellen, nicht Text).
- Start-Paket: +1,2 KB (Haken in `formel.ts`/`syncMerge.ts`, die Nachlade-Aufrufe); Rechnen und Umbau liegen in
  `formelPlus` (~5 KB) und `tabellenUmbau` (~3 KB), die mit der Tabelle bzw. dem ersten Abgleich kommen.

## Prüfreihe
`m528` (56 Prüfpunkte). A Logik per esbuild — jede Zahl von Hand nachgerechnet (24.12. − 25.11. = 29, 28.02.2024 + 1 =
29.02., `=SUMME(A:A)` über 10/20/30/„x"/5 = 65, Mittelwert 16,25 …), Umbau mit Bezügen/Bereichen/`#BEZUG!`/`$`,
Kopieren/Ausschneiden, Tabulator-Text, Abgleich zweier Geräte in beiden Richtungen (gleiches Ergebnis), Gestalt-Prüfung.
B im gebauten Programm mit fester Uhr: Rechtsklick-Menü, Einfügen mit Strg+Z/Strg+Y, Spalte löschen → `#BEZUG!`, zwei
Zeilen auf einmal, Ziehen + Strg+C/V (Text für Excel, Formel wandert), Einfügen aus Excel (Tabelle wächst, `""`,
Datum + 14), Ausschneiden (Bezüge folgen), Entf/Umschalt+Klick/Kopf/Pfeile/Esc, Datum und ganze Spalten in der Karte,
Englisch (`26/11/2026`, `#REF!`), 26-Spalten-Grenze. Gegen den Stand vor M528 (`PN_DIST=<alter Build>
M528_SRC=<alter src>`) ist die Reihe rot (A: der Rechenkern hat die Teile nicht; B: kein Menü, keine Auswahl).
Bilder: `pruefungen/ablage/m528/`.

## Grenzen / offen
- **Beide Geräte bauen gleichzeitig um** (A fügt eine Zeile ein, B löscht eine Spalte, bevor einer den anderen sieht):
  kein Zusammenführen der beiden Umbauten, sondern wie bisher „die hiesige Fassung gilt" mit Konflikt-Hinweis. Ebenso,
  wenn ein Gerät mehr als 40 Umbauten hinter dem gemeinsamen Stand liegt.
- **Live-Team (Realtime, gemeinsames Arbeiten in Echtzeit)** wurde nicht eigens geprüft; dort reist je Änderung die
  geänderte Karte, das Mischen nach Protokoll greift über den Abgleich danach.
- Ausschneiden in eine **andere** Tabelle leert die Quelle als eigenen Rückgängig-Schritt (zwei Schritte statt einem).
- Kein Einfügen über das Menü (Lesen der Zwischenablage braucht eine Erlaubnis des Browsers) — Strg+V.
- Ein Datum ist ein Text „JJJJ-MM-TT", keine Seriennummer wie in Excel: `=A1*2` mit einem Datum ist `#WERT!`, ein Datum
  im Export nach Excel kommt als Text. Eingetippte ISO-Daten („2026-11-25") werden jetzt als Datum angezeigt
  (`25.11.2026`). `=JAHR(…)` zeigt 2.026 (Zahlen mit Tausenderpunkt, wie jede Zahl in der Tabelle).
- Am Telefon wählt Ziehen keine Zellen (es rollt die Tabelle); dort wählen Umschalt fehlt — Kopf antippen oder lange
  drücken (Menü).
