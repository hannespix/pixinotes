# M553 — Tintenfluss in der Agency-Wortmarke

Prüfreihe `pruefungen/m553-agency-tintenfluss.mjs` · 2026-11-26

## Bewegung

In „pixi“ sammelt sich die Tinte an einer Seite eines Buchstabens und wandert zur gegenüberliegenden Seite. Beim „p“ wölbt sich zuerst der linke Rand. Die Öffnung rückt zur Seite, sinkt unter der vollen oberen Kontur ab und gibt auf der rechten Seite Platz für die nächste Wölbung. Die i-Stämme biegen sich seitlich, und die Kreuzung des „x“ folgt der Bewegung.

Die Formen laufen zeitversetzt durch das Wort. Der lange Zug aus vave.log dauert 4,2 Sekunden, der Rücklauf 5,8 Sekunden. Dazwischen hält die Wortmarke kurz inne. [Referenz](https://github.com/hannespix/vave.log/blob/f0447dd67dd67f7b06e948faee2fb41fbdd35937/src/web/Logo.tsx)

## Konturen und Prüfung

Fünf Bézier-Konturen pro Readex-Pro-Buchstabe geben der SVG-Animation die Stationen vor. Der Schriftzug „notes“, der farbige Trennpunkt und die Klickfläche stehen fest. Bei reduzierter Bewegung und „Besser lesbar“ erscheint der ruhende Text.

M553 misst die sichtbare Tintenfläche auf beiden Seiten des „p“ vor, während und nach der Verlagerung. Im Browser blieben die vier Buchstaben und zwei i-Punkte in 81 geprüften Phasen getrennt. Die Öffnung des „p“ blieb auch bei 22 Pixeln sichtbar.
