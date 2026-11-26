# M552 — Board-Hintergrund wählen

Prüfreihe `pruefungen/m552-board-hintergrund.mjs` · 2026-11-26

## Warum

Die Punkte auf der Leinwand sollten sich ausschalten lassen. Mit unterschiedlichen Mustern lässt sich die Fläche an das Board und die eigene Arbeitsweise anpassen.

## Was

- Unter **Einstellungen → Darstellung → Board-Hintergrund** gibt es **Clean** für eine glatte Fläche, **Dots** für Punkte, **Linien** und **Kreuze**.
- Die Einstellung gilt für alle Boards auf dem Gerät. Die Tönung wählst du pro Board im Dock unter **⋯ → Anordnen & Hintergrund**.
- Die gewählte Darstellung gilt unabhängig vom Raster-Fang. Bis zur ersten Auswahl zeigt die App wie gewohnt Punkte und mit Raster-Fang Linien.

## Wie

`lib/einstellungen.ts` speichert `boardMuster` in den Geräte-Vorlieben. `Board.tsx` zeichnet Linien, Punkte oder Kreuze mit dem Hintergrund von React Flow. Bei **Clean** erscheint die getönte oder vom Design vorgegebene Fläche ohne Muster. Raster-Fang steuert das Einrasten der Karten beim Verschieben.

M552 prüft die vier Muster, die gespeicherte Auswahl nach einem Neuladen und das Zusammenspiel mit der Tönung und dem Raster-Fang.
