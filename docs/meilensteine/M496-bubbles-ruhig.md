# M496 — Ideabubbles ruhig auch auf langsamen Geräten
PR: siehe Merge-Titel „… (M496)" · Prüfreihe: `pruefungen/m496-bubbles-ruhig.mjs` (Port 5496) · Datum: 2026-11-23

## Warum
M484 ließ m429 A1 („kein Gruppenname springt beim Einschwingen") offen: unter CPU-Mangel 7 von 10 grün, gemessene
Sprünge 8,8 bis 21 Punkte je Bild. Offen war, ob die Messung an der Bildfolge hängt oder die App Bewegung je Bild statt
je Zeit rechnet. Beides traf zu.

## Ursache (gemessen)
Messung mit CPU-Drosselung über CDP (`Emulation.setCPUThrottlingRate` 1×, 4×, 6×), Spur ab dem ersten Bild,
Weg je Änderung geteilt durch das Bild-Intervall, in dem die App ihn gerechnet hat (siehe „Messung"):

| Stand | Drosselung | Name, größter Weg je 16,7 ms | Weg Name „Alltagsaufnahmen" | Blasen nach 400 ms | Ruhe nach |
|---|---|---|---|---|---|
| vorher | 1× | 25,5 | 406 | 180 Punkte | 2,6–2,9 s |
| vorher | 4× | 22,9–25,5 | 405 | 99 Punkte | 2,6–3,4 s |
| vorher | 6× | 12,7–25,3 | 404 | 87 Punkte | 3,2–3,8 s |
| nachher | 1× | 5,1 | 377 | 202 Punkte | 2,0–2,3 s |
| nachher | 4× | 5,1 | 378 | 198 Punkte | 2,1–2,4 s |
| nachher | 6× | 5,0–5,1 | 377 | 200 Punkte | 2,0–2,4 s |

1. **Der Name flog beim Einschwingen, schon ohne Last.** Er glitt je Bild ein gutes Fünftel (0,22) zu seinem Ziel,
   ohne Obergrenze. Beim Start fliegen die Ideen vom Rand herein, das Ziel des Namens (Mitte der oberen Ideen) lief
   bis 1 500 Punkte je Sekunde voraus — der Name folgte mit 25 Punkten je Bild. m429 sah das nur deshalb nicht, weil
   ihre Messung (200 ms nach `networkidle`) auf einem ruhigen Rechner erst nach diesem Flug begann; unter Last startet
   die App später und der Flug fiel ins Messfenster.
2. **Die Physik rechnete genau einen Schritt je Bild, das Abklingen nach der Uhr.** Bei gedrosselter CPU (Median 33 ms
   je Bild) kamen die Blasen in 400 ms nur halb so weit, das Einschwingen dauerte länger — und ein langsames Gerät sah
   eine andere Bewegung als ein schnelles.
3. **Die Messung von m429 hing an der Bildfolge.** Ihr rAF-Rückruf lief vor dem der App, las also die Lage des vorigen
   Bilds (mit `performance.now()`) und teilte deren Weg durch das Intervall des nächsten Bilds. Nach einem langen Bild
   (die App rechnet dann einen größeren Schritt) und einem kurzen wurde aus Gleiten ein Sprung — daher die Ausnahme
   „unter Last Grenze 12" (M448), die trotzdem nicht reichte.

## Was
- Die Namen der Gruppen gleiten beim Einschwingen gemächlich hinter ihrer Gruppe her (höchstens 300 Punkte je Sekunde),
  statt quer über die Bühne zu fliegen.
- Blasen und Namen bewegen sich bei 1×, 4× und 6× CPU-Drosselung gleich: gleicher Weg je Zeit, dieselbe Ruhelage,
  Ruhe nach gut 2 Sekunden. Bei ausgelassenen Bildern wächst der Weg je Bild anteilig zum Zeitschritt.
- Hilfe (de/en) nennt es.

## Wie (Architektur)
- `src/components/nodes/BubblesCard.tsx`:
  - Konstanten `SCHRITT_MS` (1000/60), `SCHRITT_MAX_MS` (100), `NAME_TAU` (67 ms), `NAME_TEMPO` (0,3 Punkte je ms).
  - `wecken()` → `bild(jetzt)`: Zeitschritt aus dem rAF-Zeitstempel (höchstens `SCHRITT_MAX_MS`, mehr wird nicht
    nachgeholt — Zeitlupe statt Satz), Vorrat in festen Schritten: `schritte = Math.round(vorrat / SCHRITT_MS)`, Rest
    bleibt zwischen −½ und +½ Schritt. **Gerundet, nicht `while (vorrat >= Schritt)`:** Bei 60 Hz schwankt der Abstand
    der Bilder um 16,7 ms, dann fielen abwechselnd zwei und kein Schritt in ein Bild (gemessen: doppelter Satz einer
    Blase, 55,9 statt 29 Punkte). `schritt()` selbst ist unverändert (Kräfte, Dämpfung, Höchsttempo je Schritt wie
    bisher je Bild bei 60 Hz). Ruhe-Zähler (`ruhe`, `fenster`) zählen jetzt je Schritt.
  - `zeichnen(sofort, dt)`: Name gleitet mit `1 - exp(-dt / NAME_TAU)` (bei 60 Hz wie bisher ≈ 0,22 je Bild) und
    höchstens `NAME_TEMPO * dt` Punkte; `sofort` und die am Namen gezogene Gruppe (`gruppeImZug`) springen weiter direkt.
- `pruefungen/m429-bubbles-ruhig.mjs`: `spurNamen` misst nach Bildzeit (MutationObserver mit
  `document.timeline.currentTime`, dazu die rAF-Zeitstempel der Bilder; Weg je Änderung durch das Intervall seit dem
  vorigen Bild). Die Grenze ist jetzt immer 6 Punkte je 16,7 ms — die Lockerung „unter Last 12" (M448) und `os.loadavg`
  sind entfallen. Begründung: Der alte Rückruf lief vor dem der App und ordnete ihren Weg dem falschen Intervall zu.
- `pruefungen/m496-bubbles-ruhig.mjs`: drei Läufe mit Drosselung 1×/4×/6×, Spur ab dem ersten Bild. A Namen ≤ 6 je
  16,7 ms und gleicher Weg wie 1× (± 15 %); B Blasen: Fortschritt nach 400 ms App-Zeit (Bild-Intervalle, je höchstens
  100 ms) wie 1× (± 25 %), Ruhelage je Blase ≤ 12 Punkte neben 1×, Weg je 16,7 ms höchstens 1,25 × der von 1×, Ruhe
  ≤ 6 s; C Idee aus der Gruppe ziehen bei 6×; D Hilfe, Datei, keine Seitenfehler. Gegen den Stand vor M496: A1 auf
  allen drei Stufen rot (22,9–25,5), B1 rot bei 4× und 6× (99 bzw. 87 statt 180 Punkte).

## Nachweis
- `node werkzeug/alle-pruefungen.mjs m429 m496 --wiederhole 10 --bahnen 4` mit zwei zusätzlichen Dauerlast-Prozessen
  (`node -e "for(;;);"`) auf 4 Kernen: m429 10 von 10 (vorher 7 von 10), m496 10 von 10.

## Grenzen / offen
- Auf 120-Hz-Bildschirmen rechnet die Physik weiter nur jeden zweiten Bild einen Schritt (Rundung); die Namen gleiten
  jedes Bild. Eine Zwischenlage (Interpolation) wäre möglich, war hier nicht nötig.
- Mit sehr langen Bildern (über 100 ms) läuft die Bewegung bewusst in Zeitlupe; das Abklingen nach 5 s läuft weiter nach
  der Uhr, auf einem extrem langsamen Gerät kann die Bühne also vor dem vollständigen Einschwingen stehen bleiben
  (wie bisher; die Überlappungen löst jeder Schritt trotzdem auf).
- Der reduzierte-Bewegung-Pfad (`prefers-reduced-motion`) rechnet wie bisher sofort bis zur Ruhe.
