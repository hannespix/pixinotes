# M450 — Kontakt-Karte: Visitenkarte mit tel:, mailto:, Kartenlink; vCard rein und raus
PR: #? · Prüfreihe: `pruefungen/m450-kontakt-karte.mjs` (Port 5450) · Datum: 2026-11-23

## Warum
KONZEPT §3.7 war offen: Im Büroalltag liegen Ansprechpartner überall verstreut (Signaturen, Outlook, Zettel). Eine
Kontakt-Karte macht sie zu einem Board-Bestandteil wie jede andere Karte – mit denselben Gesten, durchsuchbar, für
die KI lesbar, und über vCard austauschbar mit Outlook, Apple, Google und Android.

## Was
- Neuer Kartentyp `kontakt` unter ＋ → **Ordnen → Kontakt** (dort war in der Zeile noch Platz; die anderen Gruppen
  haben je fünf Kacheln). Felder: Name, Funktion, Firma, beliebig viele Rufnummern (mit Art), E-Mail-Adressen,
  Anschrift, Webseite, Notiz, Foto.
- In Ruhe eine Visitenkarte: Rufnummer → `tel:` (international über libphonenumber, Inland = DE), E-Mail → `mailto:`,
  Anschrift mit „Karte“ → OpenStreetMap-Suche **nur als Link** im neuen Tab (nichts eingebettet, keine Anfrage beim
  Anzeigen), Webseite nur http(s).
- Bearbeiten (Stift) und Export (Pfeil) stehen nur im Fokus (M421, `.kontakt-tools` in allen vier Listen). Eine leere
  Karte öffnet ihre Felder selbst; aus der Palette gelegt steht der Cursor im Namen (`alsEbenAngelegt`, M388-Regel).
- `.vcf` aufs Board ziehen (oder „Datei oder Bild“) → je Kontakt eine Karte, vier je Reihe, höchstens 60 je Datei.
- Export einer Karte als vCard 3.0 (UTF-8, gefaltet auf 75 Bytes). Dateiname in ASCII (ä → ae): Chromium ohne
  UTF-8-Umgebung machte aus „Anna Müller.vcf“ sonst „download“.
- Suche (Strg+K), Fokus-Titel, Markdown-/HTML-Export und KI lesen alle Felder (`nodeToText`).

## Wie (Architektur)
- `types.ts`: `KontaktData`, `KontaktTelefon`, `KontaktNode`. `lib/nodes.ts`: `makeKontakt(pos, daten?)`.
- `lib/vcard.ts`: eigener Parser (`vcardLesen`, `vcardText` UTF-8 → Windows-1252) für 2.1/3.0/4.0 – Entfalten
  (Leerzeichen/Tab, Quoted-Printable-„=“), Gruppen-Präfixe, nackte 2.1-Parameter, `TYPE="work,voice"`,
  Quoted-Printable mit `CHARSET`, Maskierungen, strukturierte Werte (N, ADR, ORG), `tel:`/`mailto:`-Werte,
  PHOTO als Base64 oder data:-Adresse. Writer `vcardSchreiben`, `vcardDateiname`, `telAdresse`.
- `lib/sicher.ts`: `kontaktBild` (nur data:image/png|jpeg|gif|webp;base64, ≤ 1,5 MB – kein SVG, keine Webadresse);
  `karteEntschaerfen` entfernt ein anderes Foto auch aus Sync/Teilen/Live.
- `components/nodes/KontaktCard.tsx` (+ `kontaktDaten` für Karten fremder Herkunft), Registrierung in `Board.tsx`,
  Palette in `Dock.tsx`, Symbol `IPerson` in `KartenSymbol.tsx` (auch für `.vcf`), Namen in `FocusSheet.tsx` und
  `Overview.tsx`, neues Symbol `ITelefon` in `Icons.tsx`.
- `lib/importFiles.ts`: Zweig für `.vcf`/`.vcard`/`text/vcard` vor Markdown/Text.
- `lib/serialize.ts`: `kontaktZeilen` → Text, HTML, Markdown (exporter.ts nutzt Markdown). `lib/kiModule.ts`:
  `lesen` kennt `kontakt`, `TYP_WORTE` erkennt „Kontakt/Telefon/Adresse“.
- CSS: eigener Abschnitt „M450: Kontakt-Karte“ nach der Portal-Karte in `index.css`.

## Grenzen / offen
- Keine KI-Operation zum Anlegen/Ändern von Kontakten (nur Lesen) und kein MCP-Werkzeug dafür.
- Kein Export mehrerer Karten in eine .vcf und kein Abgleich mit Outlook/Graph-Kontakten (KONZEPT Stufe 3).
- „Kontakt-Karte aus E-Mail-Signatur / erkanntem Namen“ (KONZEPT §3.7, §3.8 Hover-Aktion) noch nicht.
