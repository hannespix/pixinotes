# M537 — Flüssige Schrift fließt wieder flüssig
PR: siehe Merge-Titel „… (M537)" · Prüfreihe: `pruefungen/m537-fluessig-animation.mjs` (Port 5537) · Datum: 2026-11-25

## Meldung
„liquid type animation funktioniert jetzt nicht mehr" – genauer: „die Animation läuft noch, aber nur mega langsam,
frame by frame in Zeitlupe und sehr ruckelig".

## Ursache, in Alltagssprache
Die Flüssigkeit rechnet und zeichnet einmal je Bild des Browsers. Dafür gibt es genau eine Schleife: Am Ende jedes
Bildes bestellt sie das nächste. Seit **M535** (#231, `72e0017`) weckt sich eine „lebendige" Schrift selbst, nachdem sie
neu abgetastet wurde (das war ein Fix: vorher schlief sie dabei ein). Neu abgetastet wird aber auch **mitten im Bild** –
dann, wenn der Qualitätsregler merkt, dass das Gerät zu langsam ist, und die Zahl der Teilchen senkt. Das Wecken
bestellte schon ein Bild, und das Ende der Schleife bestellte trotzdem noch eins. Von da an liefen **zwei Schleifen**
nebeneinander: Jede rechnete und zeichnete, die zweite ohne Zeitfortschritt. Doppelte Arbeit je Bild → weniger Bilder je
Sekunde → der Regler hielt das Gerät für noch langsamer, senkte weiter und startete die dritte, vierte Schleife. Bei
wenigen Bildern je Sekunde holt die Physik nicht die ganze Zeit auf (Deckel 1/40 s je Bild) – die Schrift lief in
**Zeitlupe** und **ruckelte**. Auf einem leeren Board mit kleiner Karte trat es selten auf (der Regler schaltet dort
nicht um); auf einem vollen Board mit großer Karte fast sofort.

Gemessen (Board mit großer „lebendiger" Schrift, nur lokal, Grafik in Software): Hauptzweig 30,8 Takte je Sekunde bei
15,4 Bildern je Sekunde (zwei Schleifen); Stand vor M535 und mit diesem Fix: Takte = Bilder. In der Prüfreihe nach drei
solchen Weckrufen 4 Takte je Bild, nach dem echten Umschalten des Reglers unter CPU-Drosselung 6 Takte je Bild.

Nebenbefund, ebenfalls aus M535: Hielt die Schrift an, weil die Maus 2 s still über ihr stand, und ging die Maus dann
weg, blieb sie stehen – „lebendig" lebte nicht weiter, eine vom Magnet gehaltene Schrift blieb verbogen, bis jemand sie
wieder berührte. Grund: Das Verlassen der Karte weckte die Schleife nicht.

Eingegrenzt mit Builds von `ed4ebe8` (M525), `1f7bd8a` (M534, direkt vor M535) und `72e0017` (M535) gegen die neue
Prüfreihe: Vor M535 läuft nie mehr als ein Takt je Bild; mit M535 zwei bis sechs. M525 (Pause beim Ziehen), M527 und
M534 sind nicht beteiligt.

## Fix
`lib/fluessig/motor.ts`:
- `takt()` bestellt das nächste Bild nur, wenn während des Takts nicht schon eines bestellt wurde (`if (!raf)`) – im
  normalen Weg und im Zug-Weg aus M525. So gibt es immer höchstens eine Schleife, egal wer wann weckt.
- `pointerleave` ruft `wecken()`: Was angehalten war, fließt weiter, sobald die Maus die Karte verlässt (läuft nur an,
  wenn eine Fläche laufen will; eine ruhende Schrift bleibt ruhig).

Gewollt und unverändert: Pause beim Ziehen einer Karte (M525), Anhalten nach gut 2 s Maus-Stillstand über der Karte und
sofortiges Weiterfließen bei Bewegung (M535), „lebendig" schläft nach dem Neu-Abtasten nicht ein (M535).

## Prüfreihe m537 (Port 5537)
Misst Verhalten: Takte der Flüssigkeit je Bild des Browsers (eigener Bildzähler der Seite, lastunabhängig) und Pixel der
Fläche über die Zeit. A Anlegen (setzt sich zusammen, ≤ 1 Takt je Bild); B Wecken mitten im Takt wie der Regler (≤ 1 Takt
je Bild, ein Schritt je Takt, lebt weiter) und echter Weg mit CPU-Drosselung, bis der Regler umschaltet; C Maus (bewegt,
hält nach 2 s an, fließt bei Bewegung weiter, Maus weg → lebt weiter, gewöhnliche Schrift schwingt aus und schläft);
D Neuladen, dunkel + pix·el, gezoomt, markiert, neben anderen Karten. Gegen den Hauptzweig vor dem Fix rot: B1, B4, C4,
D4, D5.

**Regel für später:** Wer eine `requestAnimationFrame`-Schleife am Ende des Takts fortsetzt, prüft, ob nicht schon
während des Takts eines bestellt wurde. Prüfreihen für Animationen messen Takte je Bild, nicht nur „bewegt sich".
