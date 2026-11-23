# M452 — Text in Bildern finden
PR: #137 · Prüfreihe: `pruefungen/m452-text-in-bildern.mjs` (Port 5452) · Datum: 2026-11-23

## Warum
KONZEPT §9 (offen, BACKLOG): Screenshots sind im Büro die häufigste Bild-Karte, aber für Suche und KI
unsichtbar — wer nach „Rechnungsnummer" sucht, fand den Screenshot der Rechnung nicht.

## Was
- PixiNotes liest den Text in Bild-Karten selbst — Deutsch und Englisch, lokal im Browser, im Hintergrund
  und nur im Leerlauf. Auch Bilder, die als Datei abgelegt sind (Datei-Karte mit Bild-Vorschau, Inhalt in
  der IndexedDB), werden gelesen.
- **Suche (Strg+K)** findet Wörter aus dem Bild; stammt der Treffer nur aus dem Bild, steht vor dem
  Ausschnitt „Treffer im Bild", der Ausschnitt zeigt die Stelle im erkannten Text.
- **KI-Module** lesen den Text mit (`kiLesen` → „Text im Bild (automatisch erkannt)").
- **Kopieren** über Bild markieren → ⋯ (auch Rechtsklick) → „Text im Bild kopieren". Noch nicht erkannt:
  „Text im Bild erkennen" (sofort, ohne auf den Leerlauf zu warten). Nichts gefunden: ausgegrauter Eintrag
  „Kein Text im Bild erkannt". Kein Dauer-Knopf auf dem Bild.
- **Abschalten:** Einstellungen → Dienste → „Text in Bildern" (Standard: an).

## Wie (Architektur)
- `src/lib/textInBildern.ts` (am Start, klein, ohne Engine): Einstellung (`localStorage` `pixinotes-bildtext`
  = `an`/`aus`, `useBildTextAn`, `setBildTextAn`), Warteschlange (`bildTextStarten` aus `App.tsx`: erst nach
  `load` + 4 s, dann bei jeder Board-Änderung entprellt; `requestIdleCallback`, ein Bild nach dem anderen,
  offenes Board zuerst, Leser-Boards (`geteiltRolle === 'lesen'`) nie, verdeckter Tab wartet),
  `bildTextJetzt` (⋯-Menü), Bild vorbereiten (`alsPng`: auf weißen Grund — freigestellte Grafiken und SVG —,
  > 2400 px verkleinert, < 900 px bis 2× vergrößert).
- `src/lib/ocrEngine.ts` — nur per `import()`: tesseract.js 7 (`createWorker(['deu','eng'], 1)`, LSTM),
  Worker als Blob-Worker, nach 60 s ohne Bild beendet (gut 100 MB Speicher). `textAufraeumen` wirft leere
  und Rausch-Zeilen raus.
- Datenfelder an der Karte (`types.ts`, ImageData und FileData): `ocrText` (leer = nichts gefunden),
  `ocrAm` (ms), `ocrFuer` (Fingerabdruck des Bildes: Länge + Stichproben-Streuwert der Daten-URL bzw.
  Größe + Name bei abgelegten Dateien). Ändert sich das Bild (Bild bearbeiten, M395), passt `ocrFuer` nicht
  mehr → neu erkennen. Geschrieben mit `runDerived` + `mutedHistory` über `updateNodeDataOnBoard`:
  kein Undo-Schritt, kein „lokal bearbeitet" für den Sync-Abgleich (der Text ist jederzeit neu zu gewinnen),
  reist aber mit dem Board-Stand (Teilen, Sync) mit.
- Suche: `SearchOverlay.tsx` hängt `bildText(n)` an den Suchtext; `Hit.imBild`, Marke `.hit-im-bild`.
- KI: `kiModule.ts` `lesen()` Fall `image`/`file` — liest `data.ocrText` direkt (kein Import aus
  textInBildern, sonst zöge der MCP-Server React und den Store mit).
- Menü: `components/BildTextMenue.tsx`, eingehängt in `SelectionToolbar.tsx` hinter „Mit Rahmen".
- Auslieferung: Vite-Plugin `ocrDateienKopieren` (`vite.config.ts`) legt beim Web-Build nach `dist/ocr/`:
  `worker.min.js`, drei Kern-Fassungen `tesseract-core{,-simd,-relaxedsimd}-lstm.wasm.js` (tesseract.js wählt
  nach Browser-Fähigkeit, geladen wird eine), `deu.traineddata.gz`, `eng.traineddata.gz`
  (`@tesseract.js-data/*` 4.0.0_best_int) und die Lizenztexte. Kein fremdes CDN. Der Service Worker
  (stale-while-revalidate) behält die Dateien nach dem ersten Laden; die Sprachdaten legt tesseract.js
  zusätzlich in der IndexedDB ab.
- **Portable Datei:** bekommt `dist/ocr/` nicht (16 MB in einer HTML-Datei, die man per Mail weitergibt, wäre
  unbrauchbar; `release/` wird außerdem committet). `ocrBasis()` zeigt im Modus `single` auf
  `https://hannespix.github.io/pixinotes/ocr/` — die App-eigene Web-Adresse (GitHub Pages liefert mit CORS
  `*`). Die Bilder verlassen das Gerät nie, nur die Engine kommt herein. Ohne Netz scheitert das Laden
  einmal, dann bleibt die Erkennung für diese Sitzung aus (`engineFehlt`); der Hinweis in den Einstellungen
  und im ⋯-Eintrag sagt das.

## Größen
| Was | Größe |
|---|---|
| Start-Bundle | + ~2 KB (textInBildern.ts, Suche, Menü); Engine nicht enthalten (Prüfreihe A, Anfragen beim Start) |
| Nachlade-Teil `ocrEngine-*.js` | 16 KB (gzip 7 KB) |
| `dist/ocr/` auf GitHub Pages | 16 MB (Worker 0,1 MB · je Kern 3,9 MB × 3 · deu 1,3 MB · eng 3,0 MB) |
| Download beim ersten Erkennen | ≈ 8,3 MB (Worker + ein Kern + beide Sprachen), danach aus dem Cache |
| `release/pixinotes.html` | 11,81 MB → 11,84 MB (+ 27 KB: Nachlade-Teil eingebettet, ohne Kern/Sprachdaten) |

## Prüfreihe
A Start und Leerlauf ohne Bild laden keine Engine-Datei · B Erkennung im Leerlauf, gespeichert, alle Dateien
aus `ocr/` neben der App · C Strg+K findet ein Wort aus dem Bild mit Marke „Treffer im Bild", Treffer im
Namen ohne Marke, Enter springt hin · D nach Neuladen bleibt der Text, keine zweite Erkennung · E ⋯ →
„Text im Bild kopieren" füllt die Zwischenablage, kein Knopf auf dem Bild · F Einstellungen → Dienste
schaltet ab; abgeschaltet keine Erkennung, kein ⋯-Eintrag · G keine Seitenfehler.

## Grenzen / offen
- Handschrift im Foto, schräge Fotos und sehr kleine Schrift erkennt Tesseract schlecht; gedruckter Text in
  Screenshots gut. Keine Vorverarbeitung (Entzerren, Kontrast) über das Weiß-Hinterlegen hinaus.
- ~~Das Gehirn (Bedeutungssuche, M204) bettet den Bildtext noch nicht ein~~ → erledigt in M465.
- ~~Telefonnummern/Links im Bildtext klickbar machen (KONZEPT §3)~~ → erledigt in M465 (Chips am markierten Bild,
  Frist nur auf Klick als Aufgabe).
- Nur Deutsch + Englisch; weitere Sprachen wären je ~1–3 MB in `dist/ocr/`.
- Portable Datei ohne Netz: keine Erkennung (bewusst, siehe oben).
