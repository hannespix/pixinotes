# M544 — Pfeile lassen sich von jeder Kartenart aus ziehen
PR: siehe Merge-Titel „… (M544)" · Prüfreihe: `pruefungen/m544-pfeile-alle-karten.mjs` (Port 5544, `M544_PORT`) · Datum: 2026-11-26

## Warum
Frage des Besitzers: „warum lassen sich manche module nicht mit pfeilen verknüpfen? bug?" — Ja, drei Fehler.

## Ursachen und was sich ändert
1. **Nachgeladene Karten** (Kanban, Diagramm, Tabelle, Gantt, Kalender, Wochenplan, Protokoll, Zeiterfassung, Form,
   HTML-Tool, Kontakt, flüssige Schrift, Pixi): `spaet()` in `Board.tsx` zeigt zuerst einen Platzhalter ohne
   Anschlusspunkte. React Flow merkt sich je Karte, wo ihre Anschlusspunkte liegen, und misst nur bei einer
   Größenänderung neu — die fertige Karte hat dieselbe (feste) Größe. Von ihr ließ sich kein Pfeil ziehen, Pfeile zu
   ihr gingen. Jetzt vermisst `AnschluesseVermessen` (im selben Suspense wie die Karte, also erst wenn sie da ist) die
   Karte einmal neu (`useUpdateNodeInternals`).
2. **Rahmen und flüssige Schrift** sind innen für den Zeiger durchlässig (M150 bzw. M500: nur Titel bzw. Text fangen).
   Wer vom Inhalt zum Anschlusspunkt am Rand fuhr, verließ dabei die Karte; der Punkt verschwand (`visibility: hidden`
   an nicht berührten Karten) und war nicht zu greifen. Bei diesen beiden Arten bleibt er unsichtbar, aber greifbar
   (`opacity: 0`); bei der flüssigen Schrift fängt er jetzt auch Zeiger (`pointer-events: all`, der Kartenknoten ist
   dort sonst durchlässig). `src/styles/10-karten-grundlagen.css`.
3. **Rahmen hatten kein Ganzkarten-Ziel:** Ein Pfeil zu einem Rahmen zählte nur auf einem der vier Punkte. `FrameCard`
   hat jetzt das Ziel `pn-handle-body` wie Karten — nur während des Verbindens aktiv, die Fläche bleibt sonst
   durchklickbar. Es reicht während des Verbindens auch über den Titel, der über dem Rahmen steht
   (`40-verbinden-attribute.css`). Karten im Rahmen liegen darüber und bleiben selbst Ziel.

Gewollt und unverändert: Bei „ruhigen" Karten (rahmenloses Bild, Pixi) erscheinen die Anschlusspunkte erst an der
gewählten Karte.

## Prüfreihe
`m544`: je Kartenart (20) Pfeil von der Karte zur Notiz und von der Notiz zur Karte, mit der Maus wie ein Mensch
(zum Anschlusspunkt, 150 ms ruhen, ziehen, loslassen), beim Rahmen zusätzlich losgelassen auf dem Titel; gezählt
werden die Verbindungen im gespeicherten Stand. Neu 40/40 grün; gegen den Stand davor 15 rot (alle nachgeladenen
Karten als Start, Rahmen hin und her, flüssige Schrift).

## Grenzen / offen
- Flüssige Schrift: Wer ohne jede Pause vom Text auf den Anschlusspunkt fährt und sofort drückt, beginnt im Test
  keinen Pfeil; mit kurzem Verweilen (150 ms) gelingt es. Nicht weiter verfolgt.
