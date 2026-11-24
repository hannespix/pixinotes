# M519 — Bugfixing-Audit, Karten A: Inhaltskarten und Fokus-Ansicht
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m519-audit-karten-a.mjs` (Port 5519) · Datum: 2026-11-24

## Warum
Auftrag des Besitzers: „Prüfe das gesamte Tool auf Logikfehler und UI-Fehler, ob alles läuft." Sechs Agenten, sechs
Bereiche; dieser hier: Notiz (NoteCard, NotizRuhend, NotizStriche, NotizGemeinsam), E-Mail, Datei, Bild (mit Lupe und
Text-Chips), Portal, HTML-App, Diagramm (Mermaid), Kontakt, Form, Flüssige Schrift, Pixi, die gemeinsame Hülle
(CardShell, DragTitle) und die Fokus-Ansicht (FocusSheet).

## Vorgehen
- **Code gelesen**: alle Karten des Bereichs samt `FocusSheet.tsx`, `CardShell.tsx`, dem Fokus-Teil von `Board.tsx`
  und den zugehörigen Stücken in `src/lib/` (mermaid, vcard, lesbareSchrift, serialize, sicher, htmlBlocks).
- **Bedient** gegen den gebauten Stand (playwright-core, Chromium): je Kartentyp anlegen bzw. per Datei ablegen
  (.eml mit Anhängen, .txt, PDF, PNG, HTML, .vcf, geteilte Board-Datei), tippen, umbenennen, Größe, Fokus und zurück,
  blättern, duplizieren, löschen, Rückgängig/Wiederholen, neu laden; leer, sehr lang, kaputt; Nur-lesen-Board; hell,
  dunkel, pix·el hell und dunkel; Telefon 390 px. Dabei Seitenfehler, Konsole und Bildschirmfotos ausgewertet, alle
  Karten mit `werkzeug/kontrast-pruefen.mjs` vermessen.
- Jeder Befund unten wurde nachgestellt; die Prüfpunkte der Reihe m519 sind gegen den Stand vor den Korrekturen rot
  (14 von 19) und danach grün.

Ohne Befund blieben unter anderem: Getipptes nach Fokuswechsel, sofortigem Neuladen, Blättern im Fokus und
Board-Rückgängig (Notiz, Form, Kontakt, Flüssige Schrift); Umbenennen per Doppelklick (Enter, Esc, leeren);
E-Mail-Import mit kodiertem Betreff, Umlauten und Anhängen (Download, Bild-Anhang als eigene Karte);
PDF-Vorschau, Aufklappen und Fokus mit Seitenzahl; Bild-Lupe und Esc im Fokus; Löschen im Fokus samt Rückgängig.

## Befunde

| Nr | Schwere | Was der Nutzer merkt | Ursache | Stand |
|----|---------|----------------------|---------|-------|
| KA1 | hoch | Eine geteilte Board-Datei (`.pixiboard.json`) – ebenso Link, Abgleich oder ein Gast im Live-Board – mit einer Notiz, deren Inhalt keine Block-Liste ist (oder einen leeren Eintrag enthält), legt die ganze App lahm: „PixiNotes lässt sich gerade nicht anzeigen", auch nach jedem Neuladen (der Stand ist gespeichert). Eine Mail ohne Absender übersteht das Zeichnen, der erste Klick auf sie nicht. | `karteGueltig` prüft nur das Äußere einer Karte (Kennung, Art, Lage, „hat Daten"). Den Inhalt lesen aber auch Suche, Aufgaben, Rückverweise, Auswahl-Leiste und Fokus-Kopf – außerhalb der Fehlergrenze der Karte. | behoben: `lib/kartenDaten.ts` bringt den Inhalt von Karten von außen in die Gestalt seiner Art (Notiz, Form, Mail, Datei, Diagramm, App, Bild, Portal); eingehängt in `karteEntschaerfen` (lib/sicher.ts), durch das alle Wege von außen laufen. Prüfpunkte A1–A4. |
| KA2 | mittel | Ein Diagramm mit kaputtem oder leerem Code hängt eine Grafik „Syntax error in text / mermaid version …" (Bombe) unter die App – je ungültigem Zwischenstand im Code-Editor eine weitere. Das Dokument wird höher als das Fenster: Die Grafiken rutschen ins Bild, sobald etwas das Dokument rollt, und stehen im Ausdruck. | mermaid hängt sein Arbeits-Element an `document.body` und räumt es nur nach Erfolg weg; die Render-Kennung ist je Versuch neu (M90), also blieb jedes stehen. | behoben: `suppressErrorRendering` beim Einrichten (gilt auch für Folien), dazu `mermaidResteWeg()` nach einem gescheiterten Versuch. B1–B5. |
| KA14 | mittel | Diagramm: Einen Schritt anklicken und „Entfernen" löscht auch die Nachbarn. Im Vorlagen-Diagramm („Start → Prüfen → Fertig") bleibt nach „Prüfen entfernen" nur die Kopfzeile – ein leeres Diagramm. Steht die Kennung eines Schritts als Wort in der Beschriftung eines anderen („Zurück an A"), fällt auch dessen Zeile weg. | `removeNode` strich jede Zeile, in der die Kennung vorkam – auch `A[Start] --> B{Prüfen}`, in der die Beschriftung von A steht – und suchte die Kennung auch in Beschriftungen. | behoben: `removeFlowNode()` (lib/mermaidEdit.ts) zerlegt die Zeile an ihren Pfeilen; was links und rechts vom Schritt stand, bleibt. G1–G4. |
| KA3 | mittel | Unter dem Notiztext ist vieles kaum zu lesen: der Zähler „1/2 erledigt" im Dunkeln auf farbigem Papier (1,4–1,7:1), Telefon-, Mail- und Verweis-Chips auf Pastell (2,7–4,3:1, schon im Hellen), auf der im Dunkeln dunklen weißen Notiz (2,1:1) und auf Notizen in eigener Farbe (bis 1,4:1, Fristen-Chip auf dunkler Farbe 1,2:1). | Feste Farben (Grün `#0a7d40`, Blau `#3557c9`, Grau des Themas) statt der Schrift des Papiers; M515 hatte nur den Notiztext selbst nachgezogen. | behoben: `--notiz-zusatz` = Tinte des Papiers; Zähler und Chips nehmen sie, die Tönung der Chips bleibt. D (vier Designs). |
| KA4 | niedrig | Rufnummer im Mailtext im Dunkeln schwer lesbar (2,9:1). | festes Grün | behoben: Token `--tel-gruen` (hell/dunkel). D. |
| KA5 | niedrig | „Doppelklick…" in einer leeren Form im Dunkeln fast unsichtbar (helles Grau auf hellem Pastell, 2,1:1; auf eigener Farbe 1,5:1). | Platzhalter in `--muted` statt in der Schrift der Form | behoben: folgt der Schrift der Form. D. |
| KA6 | niedrig (Sicherheit) | Kontakt aus einer fremden vCard: Die E-Mail-Adresse `a@b.de?bcc=…&body=…` wird ein Verweis, der dem Mail-Programm stille Empfänger, Betreff und Text mitgibt. | `mailto:${encodeURI(…)}` lässt `?` und `&` stehen (dieselbe Lücke wie SEC-2 bei der Mail-Karte) | behoben: Adresse ganz kodiert, nur „@" bleibt. C1, C2. |
| KA7 | niedrig | Eine Kontakt-Karte nur mit Anschrift (oder Funktion, Webseite, Notiz, Foto) steht bei jedem Öffnen des Boards im Bearbeiten-Formular und heißt „Neuer Kontakt". | „leer" prüfte nur Name, Firma, Rufnummern, E-Mails | behoben. C3. |
| KA8 | niedrig | Telefon: Die Kontakt-Karte bleibt im Fokus so klein wie auf dem Board (300 von 390 Punkten, Rufnummern zum Antippen in kleiner Schrift), während Notiz und Mail die Breite füllen. | Kontakt (M450) stand weder in der Text-Liste der Fokus-Kamera (`Board.tsx`) noch in der Modul-Liste des Stylesheets | behoben: am Telefon zählt sie als Text. E1. |
| KA9 | niedrig | Fokus-Kopfzeile jeder Diagramm-Karte: „Diagramm:" mit hängendem Doppelpunkt (auch in „Nächste Karte: Diagramm:"). | Titel = erste Zeile von `nodeToText`, die bei Diagrammen das Etikett für KI/Export ist | behoben. F1, F2. |
| KA10 | niedrig | Markiertes Diagramm: Der Hinweis „Klick auf Schritt oder Pfeil = bearbeiten …" liegt unten über dem Diagramm und deckt in einer schmalen Karte (zweizeilig) den letzten Schritt zu. | Hinweis als Überlagerung in der Zeichenfläche (M99) | offen – braucht eine Entscheidung (Hinweis unter die Karte, in die Leiste oder nur beim ersten Mal); die Schritte bleiben anklickbar. |
| KA11 | niedrig | Nur-lesen-Board: Diagramm-Leiste („＋ Schritt"), Form-Leiste (Form/Farbe) und Farbpunkt der Notiz bleiben sichtbar. Ein Klick ändert nichts und meldet „nur zum Lesen freigegeben". | Der Leseschutz sitzt am Speicher (M360), nicht an jeder Karte | offen – kein Datenfehler; ausblenden wäre eine Änderung an vielen Karten und an der Auswahl-Leiste (fremder Bereich). |
| KA12 | niedrig | Mail-Karte: nach „mehr" und wieder „weniger" bleibt die Karte so hoch wie der ganze Text. | Auto-Größe wächst nur, schrumpfen dürfen bewusst nur Notizen (M103/M323) | offen – gewolltes Verhalten der Hülle, ändern hieße das Verhalten aller Karten ändern. |
| KA13 | niedrig | Eine Kontakt-Karte bleibt im Bearbeiten-Formular, bis „Fertig" gedrückt wird – auch wenn man woanders hinklickt; leere Zeilen (＋ Rufnummer) bleiben bis dahin gespeichert (in Ruhe werden sie nicht gezeigt). | Bearbeiten ist ein Zustand der Karte, kein Fokus-Zustand (M450) | offen – Verhaltensänderung. |

## Wie (Architektur)
- `src/lib/kartenDaten.ts` (neu): `kartenDatenGerade(node)` – je Kartenart die Felder, die Karten und Auswertungen als
  Text, Zahl oder Liste voraussetzen. Notiz/Form: `blocks` als Liste von Objekten, `children` als Liste, Inline-Inhalt
  als Text, Liste oder Tabelle. Mail: Betreff, Absender, Text als Text, Anhänge als Liste von `{name, size, …}`.
  Datei/App: Name und Größe. Diagramm: Code. Gibt dieselbe Karte zurück, wenn nichts zu tun war (der Abgleich
  vergleicht per Identität). Aufruf in `karteEntschaerfen` (`src/lib/sicher.ts`, zwei Zeilen).
- `src/lib/mermaid.ts`: `suppressErrorRendering: true` in `getMermaid()`; `mermaidResteWeg(renderId)` entfernt
  `d<id>`/`i<id>`/`<id>`, soweit sie lose am Dokument hängen. `MermaidCard.tsx` ruft es im Fehlerfall.
- `src/lib/mermaidEdit.ts`: `removeFlowNode(code, kennung)` – Beschriftungen werden für die Suche ausgeblendet
  (gleich lange Platzhalter, damit die Lagen stimmen), die Zeile an Pfeilen (`-->`, `---`, `-.->`, `==>`, `--o`,
  `-- Text -->`, mit `|Text|`) zerlegt, der Schritt herausgenommen (auch aus `A & B`); übrig bleiben Ketten mit
  mindestens zwei Schritten und einzelne Schritte mit Beschriftung. `style`/`class`/`click` des Schritts fallen weg,
  `subgraph`-Zeilen und Kommentare bleiben. `MermaidCard.removeNode` ruft es.
- `src/styles/60-dunkel-navigator-stift.css`: `--notiz-zusatz` an `.note-card` (Pastell: `--auf-farbe-dunkel`; Weiß und
  Notizen ohne Farbe: `--ink`; eigene Farbe mit eigener Schrift: `--notiz-schrift`), Regeln für `.note-fortschritt` und
  `.due-chip` in Notizen. `25-board-formen-mermaid.css`: `.shape-ph`. `10-karten-grundlagen.css` + `00-tokens.css`:
  `--tel-gruen`.
- `KontaktCard.tsx`: `leer`, `mailto:`. `Board.tsx` (Fokus-Kamera): `text || (schmal && kontakt)`. `FocusSheet.tsx`:
  `cardTitle` für Diagramme.

## Grenzen / offen
- KA10–KA13 siehe Tabelle.
- KA1 heilt Karten **beim Hereinkommen**. Ein schon gespeicherter kaputter Stand (entstanden vor dieser Korrektur)
  wird beim Laden aus dem Browser-Speicher nicht nachbehandelt – das wäre `speicherMigration` in
  `src/store/speicher.ts` (Bereich Daten/Team). Ebenso prüft der Ordner-/WebDAV-Abgleich Karten bisher nur auf ihre
  Zeitstempel (`zeitenVonAussen`), nicht über `kartenVonAussen`.
- Module (Kanban, Zeitplan, Tabelle …) haben dieselbe Art Lücke in ihren Daten; `kartenDatenGerade` deckt nur die
  Inhaltskarten ab (Bereich Karten B).
- Konsole: BlockNote meldet beim Öffnen eines Editors, dem `viewport`-Meta fehle
  `interactive-widget=resizes-content` (`index.html`, Bereich Rahmen-Oberfläche) – nur eine Warnung.
