# M550 — pixi · notes atmet wie vave.log

Prüfreihe `pruefungen/m550-agency-pixi-notes.mjs` · 2026-11-26

## Warum

Der Nutzer wünschte die ruhige Logo-Animation und den farbigen Trennpunkt aus vave.log für „pixi · notes“. Die Referenz kombiniert eine bewegte linke Wortmarke mit einem violetten Punkt und einem leichter gesetzten Zusatz. [vave.log](https://github.com/hannespix/vave.log/blob/f0447dd67dd67f7b06e948faee2fb41fbdd35937/src/web/Logo.tsx)

## Was

- In Agency steht „pixi · notes“ in Readex Pro. Links verformen sich die vier Buchstaben, rechts bleibt „notes“ leicht und ruhig. Dazwischen steht der violette Punkt des Agency-Designs.
- Ein langer Atem, eine doppelte Welle und kleinere Wellen wechseln sich ab. Die Formen gehen weich ineinander über und kommen zwischen den Bewegungen zur Ruhe. Die Animation läuft auch auf Touch-Geräten.
- Die Klickfläche bleibt stabil. Bei reduzierter Bewegung oder „Besser lesbar“ steht die Wortmarke in der Grundform. Beim Ziehen, im verdeckten Tab und außerhalb des Bildes hält die Animation an.

## Wie

`AboutMenu.tsx` zeichnet den Text und den Punkt sofort. `agencyWortmarke.ts` enthält die aus Readex Pro geformten Pixi-Konturen in drei Zuständen. `agencyLogo.ts` interpoliert die SVG-Uhr mit sanften Übergängen und nutzt in den Ruhephasen nur einen Zeitgeber. Der Wechsel zwischen den Folgen behält die sichtbare Form bei.

M550 prüft Punktfarbe, Standfestigkeit von Punkt und Schriftzug, mehrere Bewegungen auf Touch-Geräten und die Übersicht als erstes Tippziel. M548 prüft die gerenderten Konturen und die Pausen.
