# M517 — Prüfreihe m391: „ein Tipp daneben“ misst den Punkt statt ihn zu raten
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m391-team-audit.mjs` (Punkt D3, Port 4705) · Datum: 2026-11-24

## Warum
Die Reihe m391 war auf dem Hauptzweig im Punkt **D3 „ein Tipp daneben schließt sie“** rot (gemeldet vom
M513-Agenten), auch allein und ohne Last.

## Ursache
Kein Fehler der App. D3 tippte am Telefon (390 × 780) fest auf **(190, 600)**, um die Liste der Gruppe hinter der
Live-Leiste zu schließen. Seit **M512** (Timer für alle frei einstellbar: Schnellwahl bis 60 Minuten in zwei Reihen,
darunter das Feld „Eigene Dauer“ mit „Start“ und Vorschau-Zeile) reicht die Liste dort bis etwa y = 625. An (190, 600)
liegt seitdem das Eingabefeld `timer-eingabe` **in** der Liste – der Tipp setzte den Fokus ins Feld, und eine Liste,
in die man tippt, bleibt richtigerweise offen. Das Schließen bei einem Tipp außerhalb (`pointerdown` im Fangmodus in
`LiveLeisteVoll.tsx`) arbeitet unverändert.

## Was
- D3 sucht den Tipp-Punkt jetzt per `elementFromPoint`: von unten nach oben die erste Stelle, an der die leere Fläche
  des Boards (`.react-flow__pane`) liegt und nicht die Live-Leiste samt Liste. Gibt es keine solche Stelle, ist D3 rot.
- Danach wartet D3 (bis 3 s, `warteBis`) darauf, dass die Liste verschwindet, statt nach fester Pause einmal zu
  schauen (Regel aus `docs/AGENTEN.md`, M484).
- Geprüft wird weiter dasselbe Verhalten: ein Tipp auf die Fläche neben der Liste schließt sie. Wächst die Liste
  später weiter, bleibt die Prüfung gültig.

## Grenzen / offen
Keine Änderung an der App. D2 („die Liste bleibt im Bild“) prüft weiterhin, dass die längere Liste am Telefon
vollständig sichtbar ist.
