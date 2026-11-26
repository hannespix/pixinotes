# M551 — Mehr Bewegung im Pixi-Logo und helleres Agency Dunkel

Prüfreihe `pruefungen/m551-agency-form-und-dunkel.mjs` · 2026-11-26

## Warum

Die Welle aus M550 wirkte schneller und schwächer als die Vorlage. Der ursprüngliche Agency-Dunkelmodus wirkte fast schwarz. [vave.log](https://github.com/hannespix/vave.log/blob/f0447dd67dd67f7b06e948faee2fb41fbdd35937/src/web/Logo.tsx)

## Was

- „pixi“ übernimmt die drei langsameren Taktfolgen aus vave.log. Im ersten Durchgang dauert der Hinweg 4,2 Sekunden und der Rückweg 5,8 Sekunden. Dazwischen und am Ende steht die Form kurz.
- Die bewegten Konturen verteilen Tinte: Der Bauch und Stamm des „p“ wachsen nach links. Das erste „i“ wird etwas kräftiger, das „x“ und das letzte „i“ werden zeitversetzt schlanker.
- Agency Dunkel verwendet warmes Anthrazit für Leinwand, Kopfleiste und Karten. Leinwand `#282b25`, Leisten `#30332c`, Karten `#33362f`. Violett markiert den Trennpunkt und die Bedienakzente.

## Wie

`agencyLogo.ts` behält den SVG-Zeitgeber für sichtbare Bewegung und den Timer für Haltephasen. `agencyWortmarke.ts` setzt für jede Glyphe drei kompatible Konturen aus Readex Pro. Die stärkste „p“-Form verlängert die Formänderung des fettesten Schriftschnitts. `00-tokens.css` und das Agency-Raster definieren die neuen dunklen Oberflächen.

M551 misst das Tempo und die gefüllte Fläche der Pixi-Konturen im Browser. Die Farbe von Leinwand, Kopfleiste und Punkt wird separat erfasst. M547 deckt den Kontrast in Karte und Dialog ab.
