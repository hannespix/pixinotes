# M545 — Jede Kartenart steht in der Präsentation in der Mitte
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m545-praesentation-zentriert.mjs` (Port 5545) · Datum: 2026-11-25

## Warum
Auftrag: „alle module sollen im präsentationsmodus zentriert dargestellt werden auch mermaid diagramme etc"

## Gemessen
Je Kartenart eine Karte, Präsentation geöffnet, Bildschirmfoto der Folie: alles, was sich vom Grund der Folie abhebt,
ist Inhalt (Schatten für die Messung aus, die Kopfzeile „Diagramm ‹/›" der Mermaid-Folie zählt als Bedienung).
Abweichung der Inhaltsmitte von der Folienmitte in Punkten (waagrecht / senkrecht):

| Kartenart | 1440 × 900 vorher | nachher | Telefon 390 × 844 vorher | nachher |
|---|---|---|---|---|
| Mermaid (Ablauf von oben nach unten) | **−453 / 9** (am linken Rand) | 0 / 0 | **−21 / 11** | 0 / 0 |
| Mermaid (Ablauf von links nach rechts) | **−396 / 9** | 0 / 0 | 0 / **11** | 0 / 0 |
| Pixi (Figur samt Name) | 0 / **75** | 0 / 0 | 0 / **33** | 0 / 0 |
| E-Mail | 1 / **−14** | 1 / −1 | 0 / **−8** | 0 / 0 |
| Rahmen (Abschnittsfolie) | 0 / **13** | 0 / 2 | 0 / **8** | 0 / 1 |
| Zeiterfassung | 1 / 1 | 1 / 1 | 7 / 1, **50 Punkte quer über die Folie hinaus** | 0 / 1, kein Überlauf |
| Notiz, Form, Kanban, Gantt, Kalender, Wochenplan, Protokoll, Tabelle, Kontakt, Datei, Bild, Flüssige Schrift, Ideen-Bubbles, Tool | ≤ 5 | unverändert | ≤ 2 | unverändert |

(Wochenplan und Kalender sahen in einer ersten Messung nur mit dunkler Schrift schief aus — ihr Kasten steht mittig,
nur die Zeitachse links macht den Inhalt darin ungleich; das ist Gestaltung des Moduls, nicht Lage auf der Folie.)

## Ursachen und was geändert wurde
- **Mermaid** (`styles/34-praesentation.css`): Mermaid setzt ein eigenes `max-width` an das SVG (natürliche Breite).
  Das SVG blieb so klein als Zeile im folienbreiten Kasten und stand links. Jetzt füllt das SVG die Diagramm-Fläche
  (`width/height: 100% !important`) — die viewBox zentriert die Zeichnung und hält das Seitenverhältnis, wie auf der
  Karte (M389). Die Kopfzeile ist fest 32 Punkte hoch und unten liegt ein gleich hoher leerer Streifen (`::after`),
  damit die Mitte der Diagramm-Fläche auf der Mitte der Folie liegt. Mit offenem Code steht das Diagramm in der Mitte
  seiner Hälfte. Zeichnen weiter abseits über `mermaidZeichnen` (M535), unverändert.
- **Pixi** (`styles/79-maskottchen.css`): Die Zeichenfläche (viewBox −16…32) hat oben Platz für Zzz, Noten und
  Herzen; mittig gesetzt stand der Körper (0…32) um 7/48 der Fläche zu tief, der Name darunter schob noch weiter. Die
  Fläche ist jetzt ein Vielfaches von 48 Punkten (`round(down, …, 48px)`, wie die Figur in `PixiFigur`), ein negativer
  Rand nimmt den Spielraum oben aus dem Fluss — Figur samt Name steht mittig, Effekte ragen weiter darüber hinaus.
- **Folien ohne eigene Bedienung** (E-Mail, Rahmen, Kontakt, Datei — HTML aus dem Serialisierer,
  `styles/68-vorlagen-folien-datentabelle.css`): Der Kasten stand mittig, aber Außenabstände des ersten und letzten
  Absatzes (Betreff ohne Abstand oben, letzter Absatz mit Abstand unten; Rahmen-Zwischentitel mit `margin-top: 1.4em`)
  zählten mit. Im klassenlosen Kasten der Folie haben erstes und letztes Kind keinen Außenabstand mehr.
- **Zeiterfassung auf dem Telefon**: Ansichtswahl und Zeilen brechen auf der Folie unter 640 Punkten um (auf dem Board
  ist die Karte mindestens 380 Punkte breit) — nichts ragt mehr über die Folie hinaus.
- Auf dem Board ändert sich nichts: alle Regeln hängen an `.presenter-slide`/`.slide-*` (Reihe E prüft Pixi und Mermaid).

## Prüfreihe
`pruefungen/m545-praesentation-zentriert.mjs`: A alle 20 Kartenarten groß hell, B auf dem Telefon, C dunkel (Mermaid,
Pixi, E-Mail, Kanban), D Mermaid füllt die Fläche (≥ 80 % in einer Richtung), hohes Diagramm ganz sichtbar, „Nur
Inhalt" mittig, E Board unverändert. Grenze: 8 Punkte (Rundung beim Einpassen in Raster bzw. viewBox bis 3 Punkte;
schief stand vorher 13 bis 453 Punkte daneben; auf dem Telefon gut 2 % der Folie). Pixi bewegt sich — dort zählt die
Lage aus der Zeichenfläche statt aus dem Bild. Gegen den Stand davor rot für Mermaid, Pixi, E-Mail, Rahmen und die
Zeiterfassung auf dem Telefon (Stand davor: 82 grün, 17 rot; jetzt 99 grün).

## Grenzen
- Ideen-Bubbles und Tools (eigene Apps) füllen die Folie ganz; geprüft wird, dass die Fläche symmetrisch sitzt, nicht
  wo einzelne Blasen landen (Bubbles: M543).
- Dokumente (PDF, Word, Datei-SVG) zentrieren sich in ihrer eigenen Dokument-Fläche (M363/M508), hier nicht neu gemessen.
- Ein sehr kleines Diagramm (ein Kasten) wird jetzt folienfüllend groß gezeigt — wie auf der Karte.
- Rahmen-Reise (M514) fährt Rahmen samt Titel schon mittig an (`RahmenReise.tsx` `fliegen`), unverändert.
