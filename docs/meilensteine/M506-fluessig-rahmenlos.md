# M506 — Flüssige Schrift ohne Rahmen und Hintergrund
PR: #… · Prüfreihe: `pruefungen/m506-fluessig-rahmenlos.mjs` (Port 5506) · Datum: 2026-11-24

## Warum
Nutzerwunsch: „liquid text bitte rahmenlos und ohne hintergrund anbieten wenn ohne fokus“. Die Karte aus M500 stand
mit Kartenpapier, Rand und Schatten auf dem Board — die Schrift wirkte wie ein Schild, nicht wie Flüssigkeit auf der
Fläche.

## Was
- **Ruhend** (nicht markiert, nicht im Fokus) zeigt die Karte nur die Flüssigkeit: kein Rand, keine Fläche, kein
  Schatten, keine runden Ecken, kein Griff, keine Anschlusspunkte — auch nicht, wenn der Zeiger darauf ruht. Hell,
  dunkel und auf getönten Boards (die Tönung steht auch dort, wo die Karte liegt). Gleiches Muster wie Bilder (M374)
  und Pixi (M501).
- **Markiert**: der übliche Auswahlrahmen (Akzent, eckig 2 px) mit den Griffen zum Skalieren, die Bedienung unter der
  Karte (M500) — weiter ohne Fläche.
- **Karten-Fokus**: dort bekommt die Karte ihre Fläche und einen dezenten Rand zurück (sie liegt dann vor dem
  abgedunkelten Board, Bedienung in der Karte). „Nur die Karte“ (`html[data-rein=fokus]`) nimmt den Rand wie bei allen Karten weg.
- **Präsentation** und **Bild-Export** ohne Kartenrahmen: Export „Transparent“ lässt die Kartenfläche durchsichtig,
  „Wie das Board“ zeigt dort den Board-Grund.
- Schubsen und Magnet bleiben (ruhend über der Schrift), markiert gehört der Druck wie bisher der Flüssigkeit.

## Entscheidung: Klickfläche
**Ruhend greift die Karte nur über der Schrift** — dem Rechteck um die gezeichneten Buchstaben plus dem Rand, in dem der
Magnet zieht (`Schriftgröße × 0,13`, mindestens 10 px). Daneben verhält sich die (unsichtbare) Kartenfläche wie das
Board: ein Klick wählt ab bzw. trifft die Karte darunter, ein Zug schwenkt das Board oder zieht einen Auswahlrahmen auf.
Begründung: Wer nichts sieht, darf dort nicht unerwartet eine Karte greifen — eine Karte mit kurzem Wort ist oft viel
größer als ihre Schrift. Wo die Schrift anzieht, lässt sie sich auch anfassen; so passen Gefühl (Magnet) und Treffer
zusammen. **Markiert, im Karten-Fokus, mit Tastaturfokus darin und beim Verbinden** gehört wieder die ganze Karte dem
Zeiger (Griffe an den Ecken, Flüssigkeit, die beim Spielen über die Schrift hinausfließt). Ohne Text, ohne WebGL2
(Ersatzschrift) und solange die Engine noch lädt, ist die ganze Karte die Klickfläche.

## Wie (Architektur)
- `src/styles/67-fluessige-schrift.css`: `.fluessig-card` ohne `background`/`border`/`border-radius`;
  `.react-flow__node-fluessig` (auch `:hover`, `.dragging`) ohne `box-shadow`, `.selected` mit `border-radius: 2px`;
  hoher Kontrast ohne Rand; `.focus-mode .pn-focused .fluessig-card` mit `--surface-card` und `--border`.
  Klickfläche: `.react-flow__node-fluessig:not(.selected):not(.pn-focused):not(:focus-within)` bekommt
  `pointer-events: none !important` (React Flow setzt `pointer-events: all` inline am Knoten), darin nur
  `.fl-treffer` `pointer-events: auto`; beim Verbinden (`.react-flow:has(.react-flow__connectionline)`) die ganze Karte.
- `src/components/nodes/FluessigCard.tsx`: `CardShell … ruhig` (Griff/Anschlusspunkte erst markiert, M374);
  `.fl-treffer` als erstes Kind der Bühne; `f.umrissMelden` schreibt `inset` (Prozent) und `data-umriss` direkt am DOM.
- `src/lib/fluessig/motor.ts`: `Umriss` (Anteile 0…1), `Flaeche.umrissMelden`, in `vermessen()` aus der Punktwolke
  berechnet (`umrissSetzen`; leerer Text → `null`), `zustand().umriss` für Prüfreihen. Zeiger-Ereignisse hört die Fläche
  jetzt an einem wählbaren Element (`flaecheAnlegen(canvas, e, ereignisse)` → die Bühne): ruhend ist die Zeichenfläche
  selbst nicht anfassbar, Bewegungen über `.fl-treffer` kommen über die Bühne an (Schubsen, Magnet).
- Präsentation war schon ohne Rahmen (`.slide-fluessig`); die Kartenregel trägt jetzt nichts mehr nach.
- Hilfe: „Was ist neu“ DE/EN, Kurzbeschreibung der Karte ergänzt.
- `pruefungen/m500-fluessige-schrift.mjs`: markiert über der Schrift (`anSchrift`) statt in der Kartenecke.

## Prüfung
`m506`: berechnete Stile ruhend/markiert/Fokus/Folie; Bild-Vergleich „nur Flüssigkeit ausgeblendet“ gegen „Karte
ausgeblendet“ im Ausschnitt Karte ± 14 px (0 abweichende Bildpunkte — hell, mit Zeiger darauf, dunkel, getönt);
Kontrast der Tinte zum Board-Grund (hell 16:1, dunkel 15:1, Akzent dunkel 8:1, getönt ≥ 3:1); Klickfläche deckt die
Schrift, die leere Ecke trifft die Notiz darunter, ein Zug dort schwenkt das Board und lässt die Karte liegen, ein Zug
auf der Schrift verschiebt sie; Schubsen ruhend; Bild-Export transparent bzw. Board-Grund an den Kartenecken.

## Grenzen / offen
- Die Klickfläche ist ein Rechteck um die Schrift, kein Umriss der Buchstaben (zwischen zwei Zeilen oder in einem
  großen „O“ greift man die Karte). Ein Buchstaben-genauer Treffer bräuchte eine Abfrage der Tinte je Zeigerbewegung.
- Ruhend schubst die Maus nur über der Klickfläche; markiert über der ganzen Karte.
- Mit „Lebendig“ fallende Tropfen können unterhalb der Klickfläche liegen — dort greift man sie ruhend nicht.
