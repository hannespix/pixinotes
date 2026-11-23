# M472 — Abgleich: Zeitstempel erzeugen keine Schein-Konflikte
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m472-abgleich-zeiten.mjs` (Port 5472) · Datum: 2026-11-23

## Warum
Offen aus M470: Ziehen zwei Geräte dasselbe Ticket in dieselbe Spalte, stempelt jedes `spalteSeit` mit seiner eigenen
Uhr – der Drei-Wege-Abgleich sah zwei verschiedene Fassungen, zählte „1 Karte doppelt bearbeitet" und behielt auf
jedem Gerät die eigene Zeit. M453 hatte dasselbe nur für die Kartenzeit `geaendert` gelöst (eine Sonderregel in
`ohnePunkte`). Dieselbe Falle steckte in der Archiv-Uhr (`erledigtAm`, `archiviertAm`: die Auto-Archivierung läuft
auf jedem Gerät und stempelt selbst), in `zurueckAm` und in der OCR-Zeit `ocrAm`.

## Was
- Zwei Geräte, die dasselbe tun (Ticket in dieselbe Spalte, denselben Titel, dasselbe Ticket archivieren oder
  zurückholen, dasselbe Bild erkennen), sind sich einig: kein Konflikt, je Zeitfeld gilt der **spätere** Wert – auf
  beiden Geräten derselbe, kein Hin und Her beim nächsten Abgleich.
- Echte Inhaltsänderungen entscheiden wie bisher: verschiedene Spalten oder verschiedener Text auf beiden Seiten →
  Konflikt, die hiesige Fassung gilt.
- Gilt für Ordner, WebDAV, Konto und Live-Team (Gäste wie Konten): alle laufen durch `dreiWegeMerge`.

## Wie (Architektur)
- **`src/lib/abgleichZeiten.ts`** (neu) – die eine Liste und die eine Regel:
  | Liste | Felder | Woher |
  |---|---|---|
  | `ZEIT_FELDER_KARTE` (an der Karte, neben `data`) | `geaendert` | M453 |
  | `ZEIT_FELDER_DATEN` (in `data`) | `ocrAm` | M452 (Bild- und Datei-Karten) |
  | `ZEIT_FELDER_TICKET` (Tickets in `data.items` / `data.archiv`, nur Kanban) | `spalteSeit`, `erledigtAm`, `archiviertAm`, `zurueckAm` | M470, M293, M390 |

  `ohneZeiten(n)` (Karte ohne diese Felder), `vergleichsText(n)` (kanonisches JSON, Schlüssel sortiert – eine andere
  Feldreihenfolge ist kein Unterschied), `spaeterWert(a, b)` (ms oder ISO; fehlt einer, gilt der andere;
  deterministisch), `zeitenVereinen(a, b)` (Grundlage = später geänderte Fassung, jedes Zeitfeld der spätere Wert, bei
  Tickets je Kennung; Unverändertes bleibt referenzgleich).
- **`src/lib/syncMerge.ts`**: `ohnePunkte` nutzt `vergleichsText` (statt nur `geaendert` auszulassen); bei Gleichheit
  `zeitenVereinen(l, f)` statt `spaetere(l, f)`. `spaetere` aus `kartenZeit.ts` ist entfallen.
- **`src/lib/gastPatch.ts`**: unverändert in der Logik, Kommentar: Patches tragen Zeitfelder bewusst mit, damit der
  spätere Wert nach dem Zusammenführen zu den anderen reist; ob ein Widerspruch vorliegt, entscheidet allein
  `dreiWegeMerge` (gastSync → `mischen`, syncFolder → `fremdStandEinarbeiten`, Konto und WebDAV ebenso).
- **`src/lib/kartenZeit.ts`** → `ticketZeitSaeubern` (aus `zeitSaeubern`, also `karteEntschaerfen` und
  `zeitenVonAussen`): prüft jetzt alle Felder aus `ZEIT_FELDER_TICKET` und `ZEIT_FELDER_DATEN` (ms oder ISO) auf
  Glaubhaftigkeit (ab 2020, höchstens einen Tag in der Zukunft) – mit „spätere gilt" gewönne ein Stempel aus der
  Zukunft sonst für immer.
- Bewusst **nicht** in der Liste: `angelegt` (wird nur einmal gesetzt; zwei verschiedene Anlagezeiten derselben
  Kennung sind kein Alltagsfall), Kommentar-Zeiten (`at` ist Teil der Kennung eines Beitrags, `bearbeitet` entscheidet
  schon in `mergeThread`).

### Regel für künftige Agenten
Ein neues Feld, das **jedes Gerät selbst stempelt** (Zeitpunkt, Zähler einer Automatik, Merker „schon gesehen"),
gehört in eine der drei Listen in `abgleichZeiten.ts` – sonst erzeugt es Schein-Konflikte. Was der Nutzer sieht und
ändern will (Spalte, Text, Frist, Person), gehört **nicht** hinein. Liegt das Feld an einer anderen Stelle (neue
Liste in `data`, anderer Kartentyp), die Liste und `ohneZeiten`/`zeitenVereinen` dort erweitern und in
`pruefungen/m472-abgleich-zeiten.mjs` Block L einen Fall ergänzen.

## Prüfreihe
Block L bündelt `syncMerge.ts` mit esbuild und spielt zwei Geräte mit gemeinsamem Vorfahren (auch überkreuz: beide
Geräte rechnen dasselbe aus). Block E: echte App als Gerät A am nachgebauten Sync-Ordner, der Test schreibt als
Gerät B in den Ordner, sobald A seine Änderung gemacht hat (beim nächsten Lesen von A) – dieselbe Spalte (B später /
A später), verschiedene Spalten, gleicher Titel, verschiedener Titel; danach tragen A und der Ordner denselben Stand.

## Grenzen / offen
- Unterscheiden sich zwei Fassungen in Zeit **und** Inhalt, entscheidet der Inhalt wie bisher (Konflikt → hiesige
  Fassung samt ihren Zeiten); ein „spätere Änderung gewinnt" für Inhalte bleibt ein eigenes Thema.
- Kein eigener Browser-Fall für Stempel aus der Zukunft bei den neuen Feldern (die Säuberung ist dieselbe Funktion
  wie für `spalteSeit`, die m470 Block C prüft).
