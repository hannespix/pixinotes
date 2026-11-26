# M549 — Agency-Wortmarke und Mauszeiger

Prüfreihe `pruefungen/m549-agency-marke.mjs` · 2026-11-26

## Warum

Die beiden abgesetzten i-Punkte aus M548 machten den Namen schwer erkennbar. Gewünscht war „PixiNotes“ in einer passenden Schrift mit dem flüssigen Verlauf und dem reagierenden Zeiger von VAVE als Referenz. [vave.studio](https://www.vave.studio/)

## Was

- Die Kopfleiste zeigt PixiNotes in Readex Pro. Über den Buchstaben läuft beim Start einmal eine Welle. Maus oder Tastaturfokus lassen sie einlaufen, beim Verlassen läuft sie zurück.
- Die Buchstaben werden nacheinander voller und an den Übergängen weicher. Laufweite und Klickfläche bleiben währenddessen fest.
- Der Mauszeiger in den Leisten wird über Knöpfen zum invertierenden Kreis. Auf dem Board greifen die Zeiger der Werkzeuge.
- „Bewegung reduzieren“ und „Besser lesbar“ zeigen die ruhende Wortmarke mit Systemzeiger. Beim Ziehen, außerhalb des Bildes und im verdeckten Tab ruht die Animation.

## Wie

`AboutMenu.tsx` rendert zuerst den Text. `agencyWortmarke.ts` enthält die Konturen der mitgelieferten Readex Pro in drei Formen mit gleichen Bézier-Segmenten. `agencyLogo.ts` steuert die gemeinsame SVG-Zeit für Ein- und Rücklauf. `agencyZeiger.ts` zeichnet den Ring in den Leisten und räumt ihn beim Designwechsel auf.

M548 prüft die gerenderten Buchstaben während des Flusses, Rücklauf, Ruhe und Kontrast. M549 prüft den Text bei ausgefallenem Animationsmodul, Tastaturbedienung, mobile Breite und den reagierenden Zeiger.
