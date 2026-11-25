# M540 — Flüssige Schrift läuft auf jedem Bildschirm gleich schnell (60, 144, 240 Hz)
PR: siehe Merge-Titel „… (M540)" · Prüfreihe: `pruefungen/m540-fluessig-bildrate.mjs` (Port 5540, `M540_PORT`) · Datum: 2026-11-25

## Warum
Rückmeldung des Besitzers nach M537: Auf dem 60-Hz-Bildschirm fließt die Schrift, auf dem Chrome-Gerät mit
144-Hz-Bildschirm läuft sie „mega langsam, frame by frame in Zeitlupe".

## Ursache
`Flaeche.schritt` (`src/lib/fluessig/motor.ts`) rechnet die Physik in festen Schritten von 1/120 s (8,3 ms) und
**verwarf den Rest jedes Bildes**. Bei 144 Hz dauert ein Bild 6,9 ms — weniger als ein Schritt: Dann rechnete kein
Bild einen Schritt, nur gelegentlich ein verspätetes. Bei 240 Hz stand die Schrift ganz. Bei 60 Hz (16,7 ms = zwei
Schritte, Rest 0) fiel der Fehler nie auf; bei 120 Hz lag er genau an der Kante. Der Fehler stammt aus der Übernahme
in M500, nicht aus M535/M537.

## Was sich ändert
- Der Rest wandert ins nächste Bild (`zeitRest` je Fläche, beim Aufwecken auf 0). Je Sekunde rechnet die Physik
  damit bei jeder Bildrate 120 Schritte; nur das Zeichnen folgt der Bildrate des Schirms.
- Der Deckel gegen Aufholen bei schwachem Prozessor (0,04 s bzw. 1/40 s) gilt jetzt für die aufgelaufene Zeit.
- Zähler `pixinotesFluessig.physik` (Physik-Schritte) für Prüfreihen und Fehlersuche.

## Prüfreihe
`m540` ersetzt `requestAnimationFrame` vor dem Start der App durch einen Bildtakt mit eigener Uhr (je Bild genau
der bestellte Abstand; `setTimeout` allein trifft 6,9 ms im Headless-Browser nicht und hätte den Fehler versteckt)
und misst Physik-Schritte je Sekunde Bildzeit und Pixel der Fläche: A 60 Hz, B 144 Hz, C 240 Hz, D unruhig 5/9 ms,
E Verhältnis zu 60 Hz. Neu 18/18 grün; gegen den Stand davor B2, B3, C2, C3, D2, E1, E2 rot (0 Schritte je Sekunde,
keine Bewegung bei 144 und 240 Hz). m500, m535, m537 grün.

## Grenzen / offen
- Die Seite pix-el.de (`pix-el`, `site/hero.js`) sammelt die Zeit schon über die Bilder (Akkumulator) — der Fehler
  entstand erst bei der Übernahme in PixiNotes (M500), wo der Rest je Bild verworfen wurde.
