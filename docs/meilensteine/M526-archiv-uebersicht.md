# M526 — Archivierte Boards lassen in der Übersicht keine Lücken mehr
PR: siehe Merge · Prüfreihe: `pruefungen/m526-archiv-uebersicht.mjs` (Port 5526) · Datum: 2026-11-25

## Warum
Fehlerbericht des Besitzers: „archivierte Boards besetzen Platzhalter in der Übersicht … das ist komisch".
Nachgestellt: In der Hierarchie-Ansicht der Übersicht war ein archiviertes Board unsichtbar, sein Platz im Raster
blieb aber frei. War das erste Board eines Projekts archiviert, begann die Reihe in der zweiten Spalte; ein
archiviertes Board in der Mitte riss ein Loch und schob das letzte in eine zweite Reihe; Projekte waren so breit und
hoch, als stünden die archivierten noch da; ein Projekt, dessen Boards alle archiviert waren, war eine leere Fläche
ohne den Hinweis „Boards hierher ziehen". Folgefehler beim Ziehen: Die Vorschau während des Zugs rechnete lückenlos,
das Raster danach mit Lücken — eine Kachel, die man vor Gamma fallen ließ, landete hinter Gamma.

## Was
- Die sichtbaren Kacheln eines Projekts stehen lückenlos; Breite und Höhe des Projekts richten sich nur nach ihnen.
- Ein Projekt mit nur archivierten Boards zeigt „Boards hierher ziehen" wie ein leeres Projekt.
- Ziehen mit archivierten Boards dazwischen: Die Kachel landet genau dort, wo die Vorschau sie zeigte.
- Unverändert: „Archiv einblenden" zeigt archivierte Boards mit Marke an ihrem alten Platz; „Zurückholen" bringt sie
  dorthin zurück — die gespeicherte Reihenfolge (`project.boardIds`) wird nicht angefasst.

## Wie (Architektur)
`src/components/Overview.tsx`, `layoutHierarchy()`: `sichtbareIds` je Projekt = `boardIds` gefiltert auf die Boards,
die `ohneArchiv()` durchlässt (archiviert, Eingang). Spalten, Reihen, Platz-Index und das neue Flag `leer` in
`ProjectZoneData` rechnen damit; vorher liefen `bi` und `boardIds.length` über die ganze Liste. `mindestens` (M440:
kein Schrumpfen während des Zugs) zählt ebenfalls nur sichtbare Boards. `platzFuer()` und das Ablegen rechneten schon
mit sichtbaren Boards — jetzt passt das Raster dazu.

Andere Stellen geprüft und in Ordnung: Navigation/Baum, Reiter, Alt+→ (M390), Aufgaben-Zentrale (M288),
Präsentation, Netz-Ansicht (`ohneArchiv` vor `gliederungAus`), Fokus-Stopps (archivierte Boards bekommen keinen Knoten).

## Grenzen / offen
- Strg+K findet archivierte Boards weiter über den Namen (Wiederfinden) — bewusst nicht geändert.
- Die Zahl hinter einem Projekt im Baum zählt sichtbare Boards; „Bereich löschen" zählt alle (die archivierten werden
  mitgelöscht) — beides richtig, nicht geändert.
