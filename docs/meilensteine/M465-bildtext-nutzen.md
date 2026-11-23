# M465 — Text in Bildern nutzen: Gehirn und anklickbare Angaben
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m465-bildtext-nutzen.mjs` (Port 5465) · Datum: 2026-11-23

## Warum
M452 erkennt Text in Bildern und speichert ihn an der Karte (`data.ocrText`). Offen blieben zwei Dinge: Das Gehirn
(Bedeutungssuche, M204) kannte den Bildtext nicht — wer nach „Buchhaltung" fragte, fand den Screenshot der Rechnung
nicht. Und Telefonnummern, Mail-Adressen, Web-Adressen und Fristen auf einem Screenshot ließen sich nicht nutzen,
obwohl dieselben Angaben in einer Notiz als Chips klickbar sind (Smart Layer, KONZEPT §3).

## Was
- **Gehirn:** Bilder (und Datei-Karten mit Bild) werden mit dem erkannten Text eingebettet
  („Bild: Name\nText im Bild: …"). Sobald die Erkennung fertig ist, bettet das Gehirn das Bild nach ~1,5 s neu ein
  (sonst erst nach 12 s Entprellung). Vom Gehirn ausgeschlossene Bereiche (M220) bleiben draußen — auch ihr Bildtext.
- **Angaben am Bild:** Am **markierten** Bild stehen unter dem Bild (neben bzw. unter dem Namen, außerhalb der Karte)
  dezente Chips: Rufnummer (`tel:`), E-Mail (`mailto:`), Web-Adresse (neuer Tab, `noopener noreferrer`; „www.…"
  ohne Schema wird als `https://` erkannt) und Fristen (bis zu zwei, abgelaufene nicht). In Ruhe steht nichts da.
- **Frist:** Klick auf den Frist-Chip → `.ics` (wie bei Notizen); daneben **„als Aufgabe"** → Kanban-Ticket mit
  `due` und Verweis aufs Bild (`links`), im ersten nicht archivierten Kanban des Boards, sonst in einem neuen Kanban
  „Aufgaben" unter dem Bild; ein Schritt im Verlauf; derselbe Klick zweimal legt nichts doppelt an. Fristen aus Bildern
  kommen **nie von selbst** in die Aufgaben-Zentrale — die Erkennung liest auch Rechnungs- und Druckdaten.

## Wie (Architektur)
- `src/lib/brain.ts`: `gehirnText(n)` = `nodeToText` + `data.ocrText` bei `image`/`file` (direkt aus data, nicht über
  `textInBildern.ts`); `syncBrainIndex` nutzt ihn, der Hash ändert sich mit dem Text → neu einbetten. `initBrain`
  hört auf das Fenster-Ereignis `pixinotes:bildtext-fertig` (gefeuert in `textInBildern.ts` → `schreiben`).
- `src/components/nodes/BildTextChips.tsx`: `bildAngaben(ocr)` über die vorhandenen Helfer `extractEntities`
  (entities.tsx) und `detectDates`/`formatDue`/`downloadIcs` (dates.ts) — keine eigenen Importe von libphonenumber
  oder chrono (M459 lädt sie künftig nach). Jeder Verweis geht durch `sichererVerweis` (`lib/sicher.ts`).
- `src/lib/bildTextAufgabe.ts`: `fristAlsAufgabe(boardId, bildId, ocr, frist)`; Ticket-Text = Zeile des Bildtextes mit
  der Frist (`fristZeile`), sonst „Frist aus ‹Bildname›". `pushHistory` + `mutedHistory`.
- `ImageCard.tsx`/`FileCard.tsx` (rahmenloses Bild): Chips nur bei `selected`; mit Chips trägt `aussen` einen Block
  `.bild-unten` (absolut unter der Karte, Name + Chips), ohne Chips bleibt alles wie in M374. `.bildtext-chips` steht
  außerdem in den drei Listen „Bedienung nur im Fokus" (M421). `data-taste="bildtext-aufgabe"` (nicht `bild-text…`:
  m452 E3 prüft, dass auf dem Bild kein Knopf der Texterkennung steht).

## Prüfreihe
A Chips nur markiert, tel/mailto/https (www. ohne Schema), Frist, sichtbar unter dem Bild, Karte unverändert ·
B Frist nicht in der Zentrale vor dem Klick, .ics für 20261215, „als Aufgabe" → Ticket mit Frist und Verweis in neuem
Kanban unter dem Bild, kein Doppel, Strg+Z in einem Schritt, danach in Ruhe keine Chips · C echte Erkennung → Neu-
Einbettung mit Bildtext in < 9 s, ausgeschlossener Bereich nie eingebettet, Strg+K „Buchhaltung" findet das Bild unter
„Nach Bedeutung" · D keine Fehler. **Für A und B ist der erkannte Text vorgegeben** (`ocrText` + passender
Fingerabdruck `ocrFuer`): Geprüft wird, was PixiNotes aus dem Text macht, nicht wie genau Tesseract Rufnummern liest.
Einbettungen per `page.route('**/api/embed')` (Muster m445).

## Grenzen / offen
- Chips nur auf dem Board am markierten Bild; Karten-Fokus und Lupe zeigen sie nicht.
- Höchstens vier Angaben und zwei Fristen je Bild; Fristen ohne Jahr deutet chrono wie in Notizen (nächstes Vorkommen).
- Die Frist-Erkennung liest den Bildtext ohne Zusammenhang — „als Aufgabe" bleibt deshalb eine bewusste Entscheidung.
