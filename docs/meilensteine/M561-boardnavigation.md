# M561 — Bereiche ordnen und Module auf dem Board öffnen

2026-11-27

## Bereiche und Projekte verschieben

In der Sidebar lassen sich die Kopfzeilen der Bereiche und Projekte ziehen. Eine Linie zeigt, an welcher Stelle der Eintrag landet. In der Kachelübersicht gibt es dafür einen Griff an jedem Bereichs- und Projektkopf. Die enthaltenen Boards bleiben in ihrer Reihenfolge. Ein Projekt lässt sich auch in einen anderen Bereich ziehen. Der Kopf des Zielbereichs nimmt es am Ende auf, auch wenn der Bereich noch leer ist. Über **⋯ → Verschieben …** sind dieselben Änderungen mit Tastatur oder Touch möglich.

`moveSpace` und `moveProject` in `src/store/struktur.ts` schreiben die Reihenfolge in die bestehenden Listen. Beim Wechsel des Bereichs werden Quelle und Ziel zusammen gespeichert. Das Projekt behält seine Kennung, seine Sortierart und seine Boardzuordnungen. Sidebar und Kacheln lesen dieselben Listen.

## Auf dem Board weiterlesen

Wer in der Seitenspalte oder in der Übersicht ein Modul auswählt, gelangt auf dessen Board. Die Karte wird ausgewählt und in den verfügbaren Ausschnitt geholt. Die offene Seitenspalte bleibt sichtbar. Kopfzeile und Werkzeugleiste bleiben beim Einpassen frei. Bei langen Notizen und breiten Tabellen zeigt die Kamera den Inhaltsanfang in lesbarer Größe. Für die separate Bearbeitung steht die Fokusansicht weiter zur Verfügung.

## Agency

Die Kopfleiste zeigt die gesetzte Wortmarke **pixi · notes** mit dem violetten Punkt. Der Browser zeigt seine üblichen Mauszeiger für die jeweilige Aktion. Der dekorative Ring und der Lottie-Player entfallen.

## Prüfung

- `pruefungen/m561-struktur-ziehen.mjs` prüft das Anordnen, den Wechsel des Bereichs und die gespeicherte Reihenfolge.
- `pruefungen/m561-modulsprung.mjs` prüft den ausgewählten Kartenausschnitt und die sichtbare Navigation.
- `pruefungen/m561-agency-ruhe.mjs` prüft Wortmarke und Mauszeiger.
