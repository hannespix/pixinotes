# M548 — Zeichen „PX" mit zwei i-Punkten, über das schwarzes Wasser läuft (Design Agency)
PR: #247 · Prüfreihe: `pruefungen/m548-agency-logo.mjs` (Port 5548) · Datum: 2026-11-26

## Warum
Wunsch des Besitzers zur Marke aus M547 („PIXI · NOTES", atmend über Strichstärke): „das agency logo soll schöner und
einfacher und cooler werden … Pixi soll aus einem PX bestehen, wobei beim X zwei i-Punkte aus dem X ragen, damit es
aussieht wie PIXI … die Liquid-Animation soll viel deutlicher sein und so aussehen, als würde die Schrift mit schwarzem
Wasser mit viel Oberflächenspannung benetzt und wieder dünner werden, wobei dann das Wasser an eine andere Stelle
fließt … so wie bei der vave.studio-Webseite." Dazu ein Entwurf (geometrisches „PX", die oberen Arm-Enden des X
abgetrennt, gelber Grund — im Logo ohne Grund).

## Was
- In Agency steht oben links das **Zeichen „PX"**: geometrisches P mit Bauch und Punze, X aus zwei Armen, deren obere
  Enden über einer waagrechten Lücke abgetrennt sind und als **zwei i-Punkte** darüber stehen („P-i-X-i"). Daneben leicht
  **„NOTES"** (Readex Pro 400, 14 px, leicht gesperrt). Der violette Punkt der M547-Wortmarke ist weg — die i-Punkte sind
  jetzt die Punkte; ein dritter hätte mit ihnen konkurriert. „NOTES" bleibt, weil ein „PX" allein wie eine Abkürzung für
  „Pixel" liest; mit „NOTES" liest man „Pixi Notes". Kein Hintergrund, Farbe = Tinte des Designs (hell `#1b1b1b`,
  dunkel `#ecede8`, Kontrast zur Fläche 17:1 bzw. 14,5:1). Versalhöhe 22 px (Telefon 20 px), Kopfleiste unverändert hoch.
- **Wasser:** Ein schwarzer Wasserkörper läuft eine Runde über das Zeichen (~25 s): sammelt sich am Bauch des P zu einem
  runden, satten Tropfen, der mit weichem Hals am Strich hängt und nachzittert; zieht los (runder Kopf, dünne Spur), läuft
  den Bauch hinunter zum Fuß, hängt dort als Tropfen, der sich lang zieht, fast abreißt und zurückschnellt; rollt als
  Perle über die Grundlinie zum Fuß des X, steigt den Arm hinauf, spannt über die Lücke eine Brücke und lässt den rechten
  i-Punkt volllaufen; sammelt sich in der Kreuzung (füllt die Winkel), läuft in den linken i-Punkt, hinunter zum rechten
  Fuß und über Boden und Stamm zurück zur oberen Ecke des P und um den Bauch. Haltezeiten schwanken (1,1–2,4 s).
- Steht still als trockenes Zeichen (ohne Filter): „Bewegung reduzieren" des Geräts, „Besser lesbar". Hält an, ohne zu
  rechnen: verdeckter Tab, Zeichen nicht im Bild (Fokus-Modus), Zug einer Karte. Klassisch und pix·el unverändert.

## Wie (Architektur)
- `src/lib/agencyLogo.ts` (nachgeladen, nur in Agency, 7,7 kB / 3,7 kB gzip): `zeichenBauen(ziel)` setzt das SVG
  (`svg.agency-px`, viewBox `0 0 171 100`, Einheiten: Versalhöhe 100, Strich 20) in den Platzhalter; `logoBewegen(ziel)`
  lässt das Wasser laufen und liefert das Aufräumen. Pfade `P_PFAD` (evenodd) und `X_PFAD` (vier Teile im Uhrzeigersinn,
  nonzero → Vereinigung der Arme; Neigung 0,63, waagrechte Breite 25, Lücke y 17…26).
- **Gerüst:** `KNOTEN`/`KANTEN` = Mittellinien der Striche als Graph (Bauch als Bogen abgetastet, Boden-Kante als
  Perlen-Strecke); `wegFinden` (Dijkstra, abgetastet alle ~2 Einheiten, mit Boden-Anteil je Punkt); `HALTE` (Ausweichen
  vom Strich, Tropfengröße, `tropfen` = hängt am Fuß), `RUNDE` (Reihenfolge der Haltestellen).
- **Wasserkörper:** `abschnittBauen(i)` (Weg, Dauer nach Länge ~48 Einheiten/s, Nachlauf des Schwanzes, Haltezeit),
  `wasserBild(ab, t)` rein rechnerisch: acht Kreise zwischen Schwanz und Kopf; beisammen = runder Tropfen
  (Radius der Haltestelle, zur Seite versetzt), gestreckt = Spur 11 bis Kopf 15; am Boden rücken sie zur Perle (≤ 7,6);
  Nachzittern gedämpft (`exp(−t/480)`); am Fuß ein neunter Kreis, der sich lang zieht. `kreisPfad` macht daraus **einen**
  Pfad (zwei Halbbögen je Kreis, gleicher Umlaufsinn, Zehntel) — je Bild ein Attribut.
- **Filter** (`filter` in `zeichenBauen`, `color-interpolation-filters: sRGB`, `userSpaceOnUse`): Zeichen rot gemalt
  (`fill` nur, solange nass), Wasser grün darüber. `wasser` = Deckkraft − Rot (wo Wasser ist), weich gedehnt (`NAH` 8)
  und ×8 = Nähe; `weich` = SourceAlpha weich (`SIGMA` 5,5); `arithmetic k1` = weich × Nähe; Schwelle 50 % (×30) =
  Hals; `feMerge` Hals über SourceAlpha; `feFlood currentColor`. Warum so:
  - Goo über alles (Weichzeichner + Schwelle) rundet die Winkel, schließt die Punze halb und überbrückt die Lücke zu den
    i-Punkten — das trockene Zeichen muss genau bleiben.
  - Goo nur im Bereich des **herausragenden** Wassers (Deckkraft − Rot mit Wasser UNTER dem Zeichen) schnitt die Hälse
    an der Ansatzstelle ab — dort ist das Herausragende eine spitz auslaufende Sichel.
  - Hart zugeschnittener Nähe-Bereich (`in`) hinterlässt Kerben und Säume an seiner Grenze; Goo vom Zeichen allein
    abziehen hinterlässt graue Bögen. **Gewichten vor dem Schneiden** hat genau eine Schwelle: scharfe Kanten, keine
    Säume, der Hals läuft zum Rand der Nähe hin sanft aus.
- **Takt** (wie M547): `requestAnimationFrame`, gezeichnet höchstens alle 30 ms (30 Bilder/s; in Kopfleisten-Größe
  wandert der Tropfen dabei unter einem halben Punkt je Bild); Zeitschritt ≤ 100 ms (kein Vorspulen nach hängenden
  Bildern); nach dem Abklingen des Zitterns ruht der Takt bis zum Losziehen (ein Zeitgeber). Aus: `document.hidden`,
  IntersectionObserver, `zugBeobachten/zugLaeuft` (M535), `prefers-reduced-motion`, `data-lesbar`.
- `src/components/AboutMenu.tsx` `AgencyMarke`: leerer Platz `.agency-zeichen` (fest 37,6 × 22 px, kein Springen beim
  Laden) + `.agency-zusatz` „NOTES"; das Modul füllt den Platz. Klassisch/pix·el: unverändert `Pixi<span>Notes</span>`.
- CSS: `src/styles/91-design-agency.css`, Abschnitt „Marke" (Grundlinie des SVG auf der von „NOTES", `overflow: visible`
  — Tropfen und Perle dürfen aus dem Kasten ragen). Kein neues Farb-Token: Rot/Grün sind nur Filter-Kanäle (im Modul),
  sichtbar wird allein `currentColor`.
- m547 angepasst (Marke statt Buchstaben-Gewichte; „Besser lesbar" = trockenes Zeichen).

## Messungen
- m548: Form (zwei Pfade, kein Text/Grund; an den Bildpunkten: über dem X zwei getrennte Läufe, darunter eine
  durchgehende Lücke, darunter zwei Arme); Wasser über einen Zyklus (Bezug: dieselbe Seite mit reduzierter Bewegung,
  Kantenband ±1 Punkt ausgenommen): Tropfen ragt ≥ 1,5 Strichstärken über das Zeichen (Schwelle 0,4 — M547 wuchs um eine
  Kontur von 0,04 em, je Seite ~0,07 Strichstärken), Abweichung Spitze ~7 %, Mittel ~3 % der Tinte, Schwerpunkt an
  sieben Orten über 60 % der Breite; Kanten ≤ 10 % Zwischentöne; Hauptthread beim Fließen ~25–30 ms je Sekunde
  (Grundlast der ruhenden App ~18; ohne Grafikkarte; Grenze 80); verdeckter Tab und Zeichen außer Sicht: 0 Bild-Rückrufe
  je Sekunde (fließend ~60); Zug: Wasser steht; reduzierte Bewegung und „Besser lesbar": ohne Filter, Bildpunkte gleich;
  hell/dunkel Kontrast; Klassisch und pix·el: altes Markup, Modul nicht geladen.
- Vorher (erster Entwurf mit 27 Kreis-Attributen und 60 Bildern/s): ~56 ms je Sekunde netto. Ein Pfad statt Kreisen und
  30 Bilder/s halbierten das.
- Bildvergleich (`werkzeug/bild-vergleich.mjs`, Stand vor M548 gegen M548, dazu dieselbe Messung mit gewähltem pix·el):
  Klassisch 11/11 und pix·el 11/11 Ansichten pixelgleich.

## Grenzen / offen
- Kein Lottie: Lottie morpht vorgezeichnete Formen; Verschmelzen, Brücke und Abreißen wären Handarbeit je Bild, dazu
  ~70 kB Bibliothek. Die Bewegung von vave.studio wurde nicht angesehen (eine Animation lässt sich per Textabruf nicht
  beurteilen) — gebaut nach der Beschreibung des Besitzers.
- Die Runde ist fest (Haltezeiten schwanken); kein Zufallsweg, damit das Wasser jede Stelle des Zeichens erreicht.
- Ein Tropfen kann kurz in die Punze des P ragen — das ist gewollt (Wasser kennt keine Innenseite).
- Kein eigenes App-Zeichen/Favicon für Agency: Kein Design tauscht bisher das Favicon (auch pix·el nicht).
- `prefers-reduced-motion` per `page.emulateMedia` löst in Chromium headless kein `change` aus; die Prüfreihe nimmt
  deshalb eine eigene Seite mit reduzierter Bewegung als trockenen Bezug.
