# M541 — Flüssige Schrift bleibt schnell, während sich Maus oder Stift bewegen
PR: siehe Merge-Titel „… (M541)" · Prüfreihe: `pruefungen/m540-fluessig-bildrate.mjs` (neu Abschnitt F) · Datum: 2026-11-25

## Warum
Rückmeldung des Besitzers nach M540: Auf dem 144-Hz-Bildschirm fließt die Schrift jetzt deutlich flüssiger, aber
sobald sich Maus oder Stift bewegen, wird sie wieder langsamer.

## Ursache
Fehler aus M540: `aufwecken()` setzte den gesammelten Zeitrest (`zeitRest`) auf 0. Jede Zeigerbewegung über der
Fläche weckt sie (`bewegen` → `aufwecken`), bei bewegter Maus also in jedem Bild — der Rest wurde wieder je Bild
verworfen wie vor M540. Gemessen bei 144 Hz mit laufender Mausbewegung: 53 statt 120 Physik-Schritte je Sekunde.

## Was sich ändert
`aufwecken()` lässt den Zeitrest stehen (er ist nie größer als ein Schritt von 1/120 s, ein Rest von vor einer
Ruhepause schadet nicht).

## Prüfreihe
`m540` Abschnitt F: Maus fährt ununterbrochen über der Schrift (60 und 144 Hz, Bildtakt mit eigener Uhr wie A–D),
gezählt werden Physik-Schritte je Sekunde. Neu 24/24 grün; gegen den Stand M540 F (144 Hz) rot (53 Schritte je
Sekunde). m500, m535, m537 grün.

## Grenzen / offen
- `m537` B3 („lebendig" bewegt sich weiter, mehr als 3 geänderte Pixel in 1,6 s) liegt nahe an seiner Schwelle:
  gemessen ohne und mit Fremdlast vor M540 3 bis 13, danach 2 bis 10 — beide Stände streuen, die Reihe fällt unter
  starker Fremdlast gelegentlich im ersten Lauf und ist allein grün. Seit M540 rechnet die Physik auch bei 60 Hz mit
  schwankenden Bildabständen die volle Zeit (vorher fielen Schritte weg), die Schrift fängt den Stoß der
  unsichtbaren Hand darum etwas schneller wieder auf. Nicht verändert.
