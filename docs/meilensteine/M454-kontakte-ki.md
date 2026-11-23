# M454 — Kontakte für KI und MCP, Sammel-Export als eine .vcf
PR: #130 · Prüfreihe: `pruefungen/m454-kontakte-ki.mjs` (Port 5454) · Datum: 2026-11-23

## Warum
Offen aus M450: Die App-KI konnte Kontakt-Karten nur lesen, der MCP-Server kannte sie gar nicht, und jede Karte ging
nur einzeln als .vcf hinaus. Wer zehn Ansprechpartner ins Outlook oder aufs Telefon bringen wollte, musste zehn Dateien
herunterladen und einzeln öffnen.

## Was
- KI-Assistent (Board-Anweisung, KI-Aktionen) legt Kontakte an (`kontakt`) und ändert vorhandene (`edit_kontakt`):
  Name, Funktion, Firma, Rufnummern mit Art, E-Mail, Anschrift, Webseite, Notiz. Ein Plan ist ein Schritt für
  Rückgängig; „from" zieht wie bei allen Modulen einen Pfeil von der Quell-Karte.
- MCP-Server: dieselben Operationen im Werkzeug `pixinotes_bearbeiten`, `pixinotes_board_lesen` zeigt Kontakte mit
  Kennung (über `kiLesen`). Die Server-Anweisung nennt „Ansprechpartner → kontakt".
- Sammel-Export: Im ⋯ der Auswahl (auch per Rechtsklick) „2 Kontakte als vCard", sobald Kontakte in der Auswahl sind;
  im ⋯ eines Boards (Navigator, Übersicht) „Kontakte als vCard (n)", wenn das Board Kontakte hat. Eine Datei, vCards
  hintereinander; Dateiname „<Board> - n Kontakte.vcf" in ASCII (ein einzelner Kontakt heißt wie bisher nach dem Namen).
  Keine neuen Dauer-Knöpfe.

## Wie (Architektur)
- `lib/kiModule.ts`: `kiOpsText` nennt `kontakt` immer, `edit_kontakt` nur, wenn es Kontakte auf dem Board gibt;
  `kiAusfuehren` Fälle `kontakt`/`edit_kontakt`, Prüfung in `kontaktFelder(o)` (nur genannte Felder, gekürzt,
  `\n` als Text wird Zeilenumbruch, Rufnummern als Objekt `{nummer, art}` oder Text, E-Mails nur mit „@", kein Foto).
  Leerer Kontakt (ohne Name/Firma/Nummer/E-Mail) wird abgelehnt.
- `kontaktDaten` (feste Gestalt der Felder) zog aus `components/nodes/KontaktCard.tsx` nach `lib/vcard.ts`, damit
  KI und Export ihn ohne JSX nutzen; neu `vcardSammeln(liste)`; `vcardDateiname` nimmt auch einen freien Namen.
- `lib/kontaktExport.ts` (neu): `kontakteHerunterladen(nodes, basis)` → Blob + `triggerDownload`.
- Einstiege: `SelectionToolbar.tsx` (Abschnitt „Weitergeben", `data-taste="kontakte-vcard"`) und `EbenenMenu.tsx`
  `BoardMenu` (nach „Als Datei sichern", `data-taste="board-kontakte"`).
- MCP: `mcp/motor.ts` `ALLE_MODULE` um `kontakt` ergänzt (damit `opsBeschreibung` auch `edit_kontakt` beschreibt);
  `mcp/server.ts` Anweisung. `release/pixinotes-mcp.mjs` baut `release.yml` nach dem Merge.
- Prüfreihe bündelt `src/lib/vcard.ts` mit esbuild und liest die heruntergeladenen Dateien damit wieder ein.

## Grenzen / offen
- Kein Abgleich mit Outlook/Graph-Kontakten (KONZEPT Stufe 3); kein Kontakt aus E-Mail-Signatur (§3.7) – das
  E-Mail-Destillat (M451) könnte künftig `kontakt`-Operationen erzeugen.
- Die KI setzt kein Foto (nur eingebettete Bilder wären erlaubt, und das Modell liefert keine).
