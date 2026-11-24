# M517 — Zwei rote Prüfpunkte auf dem Hauptzweig: m391 D3 und m475 B2
PR: siehe Merge-Commit · Prüfreihen: `pruefungen/m391-team-audit.mjs` (D3, Port 4705), `pruefungen/m475-css-teile.mjs` (B2), `pruefungen/m513-bubbles-qr.mjs` (neu A1b) · Datum: 2026-11-24

## Teil 1: m391 D3 „ein Tipp daneben schließt sie“

### Warum
Die Reihe m391 war auf dem Hauptzweig im Punkt **D3 „ein Tipp daneben schließt sie“** rot (gemeldet vom
M513-Agenten), auch allein und ohne Last.

### Ursache
Kein Fehler der App. D3 tippte am Telefon (390 × 780) fest auf **(190, 600)**, um die Liste der Gruppe hinter der
Live-Leiste zu schließen. Seit **M512** (Timer für alle frei einstellbar: Schnellwahl bis 60 Minuten in zwei Reihen,
darunter das Feld „Eigene Dauer“ mit „Start“ und Vorschau-Zeile) reicht die Liste dort bis etwa y = 625. An (190, 600)
liegt seitdem das Eingabefeld `timer-eingabe` **in** der Liste – der Tipp setzte den Fokus ins Feld, und eine Liste,
in die man tippt, bleibt richtigerweise offen. Das Schließen bei einem Tipp außerhalb (`pointerdown` im Fangmodus in
`LiveLeisteVoll.tsx`) arbeitet unverändert.

### Was
- D3 sucht den Tipp-Punkt jetzt per `elementFromPoint`: von unten nach oben die erste Stelle, an der die leere Fläche
  des Boards (`.react-flow__pane`) liegt und nicht die Live-Leiste samt Liste. Gibt es keine solche Stelle, ist D3 rot.
- Danach wartet D3 (bis 3 s, `warteBis`) darauf, dass die Liste verschwindet, statt nach fester Pause einmal zu
  schauen (Regel aus `docs/AGENTEN.md`, M484).
- Geprüft wird weiter dasselbe Verhalten: ein Tipp auf die Fläche neben der Liste schließt sie. Wächst die Liste
  später weiter, bleibt die Prüfung gültig.

### Grenzen / offen
Keine Änderung an der App. D2 („die Liste bleibt im Bild“) prüft weiterhin, dass die längere Liste am Telefon
vollständig sichtbar ist.

## Teil 2: m475 B2 „die Listen ‚Bedienung nur im Fokus‘ sind gleich“

### Ursache
B2 liest `src/styles/99-bedienung-im-fokus.css` und verlangt, dass alle Listen der Bedien-Klassen (M421) gleich
sind. Seit **M510** („Oberfläche ausblenden“) steht die Liste dort **fünfmal**: Übergang, Zeiger ruht, Zeiger mit
Verzug, Finger und `html[data-nur-board]`. **M513** (Ideabubbles per QR) hat `.bub-mitmachen` in die ersten vier
eingetragen, die fünfte vergessen – B2 schlug zu Recht an. Sichtbar wurde der Fehler nicht: der Knopf trägt auch die
Klasse `.bub-ansicht` und war darüber schon erfasst (Gegenprobe: ohne Eintrag bleibt er bei „Oberfläche ausblenden“
unsichtbar).

### Was
- `.bub-mitmachen` steht jetzt auch in der fünften Liste; der Kopfkommentar der Datei sagt „fünfmal … in alle fünf
  eintragen“ (vorher „viermal“).
- B2 verlangt mindestens fünf Listen (vorher drei), heißt „alle fünf Listen (Übergang, Zeiger, Finger, Oberfläche
  ausblenden)“ und nennt bei Rot die abweichenden Listen (`{ anzahl, abweichend: [4] }`) statt nur die Anzahl.
- Neu **m513 A1b**: mit `data-nur-board` ist der Knopf „Mitmachen per QR“ unsichtbar (`opacity 0`) und fängt keinen
  Klick (`pointer-events: none`), ohne ist er wieder da – gemessen am berechneten Stil, nach dem Übergang.

### Grenzen / offen
`CLAUDE.md` §6 spricht noch von „den drei Listen“ in `99-bedienung-im-fokus.css`; richtig sind fünf. Die Datei
pflegt der Orchestrator.
