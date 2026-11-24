# M508 — SVG-Inhalte in der Präsentation mittig und groß
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m508-svg-folie-zentriert.mjs` (Port 5508) · Datum: 2026-11-24

## Warum
Fehlermeldung: „svg inhalte werden bei präsentationsansicht immer linksbündig angezeigt! ich will lieber zentriert!“
Auf dem Bildschirmfoto (pix·el dunkel, geteiltes Board, Folie 5/84) hing eine SVG-Karte klein am linken Rand der
Folie, senkrecht mittig, rechts blieb die halbe Folie leer.

## Ursache
Bild-Karten (`type: 'image'`, so landet jede abgelegte `.svg` auf dem Board, `src` = `data:image/svg+xml…`) liefen auf
der Folie durch den Serialisierer: `<div><img style="max-width:600px"></div>`. Der Kasten ist ein Flex-Kind mit
`margin: auto` (M403) und richtet sich nach der **eigenen Größe des Bildes**; das Bild selbst ist `display: block`
ohne eigene Ränder.
- **SVG breiter als 600 Punkte angegeben** (`width="1200"`, typisch für Exporte aus Figma/Illustrator/Pixel-Tools):
  Der Kasten wird folienbreit, das Bild 600 Punkte breit – und steht links im Kasten. Genau das Bild der Meldung.
  (Gilt ebenso für Fotos über 600 Punkte Breite.)
- **SVG ohne feste Größe** (nur `viewBox`, oder Breite/Höhe in Prozent): Das Bild hat keine eigene Breite, der
  schrumpfende Kasten wird 0 Punkte breit – die Folie blieb leer.
- **Kleine SVGs** (300 × 400) blieben klein, obwohl eine Vektorgrafik verlustfrei wachsen kann.

## Was
- **Bild-Karte mit SVG** (`data:image/svg+xml`, Adresse auf `.svg`, oder Name `.svg` bei einer Adresse ohne `data:`):
  eigene Folie `SvgFolie` – die Grafik steht waagrecht und senkrecht in der Mitte und füllt die Folie, so weit ihr
  Seitenverhältnis es zulässt (`object-fit: contain` auf einem folienfüllenden `<img>`). Unabhängig davon, ob das SVG
  Breite/Höhe, nur eine `viewBox` oder Prozentangaben trägt.
- **Fotos (PNG/JPG/…)** unverändert in ihrer Größe (höchstens 600 Punkte); ein Foto, das breiter angegeben ist,
  steht jetzt ebenfalls mittig statt am linken Rand (`margin-inline: auto`).
- **Datei-Karte mit `.svg`** (Dokument-Folie, M363) war schon mittig und groß – jetzt von der Reihe abgesichert.
- Zoomen (Strg + Rad, `+`/`−`/`0`, Schnellauswahl M403), „Nur Inhalt“, Klassisch/pix·el, hell/dunkel und das Vorführen
  im Team (Gäste zeigen dieselbe Folien-Komponente) funktionieren unverändert: der gezoomte Inhalt ist der
  folienfüllende Kasten, gezoomt wird um seine Mitte.

## Leseschutz
Das SVG kommt weiter als `<img>` auf die Folie, nie als eingebettetes `<svg>`: Ein Bild-SVG führt im Browser kein
Skript aus und lädt nichts nach (Reihe E: ein `<script>` im SVG läuft nicht, im DOM der Folie steht kein `<svg>`).
Die Adresse kommt unverändert aus der Karte (dieselbe, die das Board schon zeigt).

## Nicht geändert
- **Notizen mit eingebettetem Bild** (BlockNote-Bild-Block): Ausrichtung und Breite bestimmt der Block selbst (links,
  mittig, rechts in der Notiz) – das bleibt die Entscheidung der Schreibenden.
- **HTML-App-Karten** (M371/M380): die App gestaltet ihre Fläche selbst, ein SVG darin folgt deren Layout.
- **Mermaid** hat eine eigene Folie (Diagramm füllt die Breite).

## Wie (Architektur)
- `src/components/Presenter.tsx`: `istSvgBild(src, name)`, `SvgFolie` (`.slide-svg` mit `data-taste="folie-svg"`),
  `case 'image'` in `SlideContent` (Fotos weiter über `nodeToHtml`).
- `src/styles/68-vorlagen-folien-datentabelle.css` (Abschnitt M403 „Darstellung der Folien“): `.slide-svg` als
  folienfüllendes Flex-Kind (`align-self: stretch`, `flex: 1`), das Bild `width/height: 100 %`, `object-fit: contain`;
  Fotos `margin-inline: auto`.

## Prüfung
- `pruefungen/m508-svg-folie-zentriert.mjs` misst an den Bildpunkten (magentafarbene Grafik im Bildschirmfoto):
  vier SVG-Arten (nur viewBox · viewBox + 1200 × 675 · 300 × 400 ohne viewBox · Prozent) mittig (± 2 px), Folie in
  einer Richtung ≥ 90 % gefüllt, Seitenverhältnis gleich – Klassisch hell 1440 × 900, pix·el dunkel, pix·el hell
  1920 × 1080, Klassisch dunkel 1280 × 800, „Nur Inhalt“; Zoomen mit `−`, `+`, `0`, Strg + Rad; Datei-SVG; Leseschutz;
  Fotos klein (480 × 300 wie bisher) und breit (600 breit, mittig). Gegen den Stand vor M508 ist die Reihe rot.
- `werkzeug/bild-vergleich.mjs` (Board, Fokus, Präsentation mit Notiz/Kanban, Einstellungen, Telefon): pixelgleich.
