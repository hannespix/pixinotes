# M557 — Fließende Innenkonturen und besser lesbare Beschriftungen in Agency

2026-11-26

## Vergleich mit VAVE.LOG

Die vier Buchstaben der Vorlage setzen bei Bild 0, 3, 7 und 9 ein. Beim ersten V wandert die Kerbe zwischen den Schenkeln nach oben. Beim E öffnen sich die Rundungen zwischen den Balken. Über den ganzen Zug liegen die waagerechten Abschlüsse auf derselben Höhe. PixiNotes hatte die zeitliche Staffelung und die drei langsamen Bewegungsfolgen bereits übernommen. In der bisherigen Endform schrumpfte die Öffnung des „p“ allerdings fast genau um ihre eigene Mitte. [Lottie-Vorlage](https://github.com/hannespix/vave.log/blob/f0447dd67dd67f7b06e948faee2fb41fbdd35937/public/vave-logo.json) · [Abspielzeiten](https://github.com/hannespix/vave.log/blob/f0447dd67dd67f7b06e948faee2fb41fbdd35937/src/web/Logo.tsx)

In der neuen Kontur zieht die Öffnung des „p“ schräg nach rechts oben. Unter dem Bauch geht die Tinte in einem durchgehenden Bogen in den Stamm über. Das „x“ hat eine zusammenhängende Außenkontur. Seine Diagonalen laufen in vier weichen Innenwinkeln zusammen. Die waagerechten Abschlüsse und die Oberkante der beiden i-Punkte halten ihre Höhe. Bei 25 Pixeln Schriftgröße legt die Mitte der Öffnung im „p“ rund 1,2 Pixel nach rechts und 1,1 nach oben zurück.

## Kontrast

Kleine Beschriftungen und Hinweise verwenden ein dunkleres Grau auf hellen und ein helleres Grau auf dunklen Flächen. Abschnittsüberschriften und Gruppen im Werkzeugmenü haben etwas mehr Schriftgewicht. In Umschaltern markiert eine feine violette Innenkante die aktuelle Auswahl auch unter dem Mauszeiger. Die Einstellung „Besser lesbar“ kann die Schrift und die Ränder weiter verstärken.

Im Browser stieg das Kontrastverhältnis beim Hinweis zur Systemdarstellung in Hell von 6,13 auf 7,79 und in Dunkel von 7,09 auf 8,17. Bei inaktiven Optionen im Design-Umschalter stieg es von 5,57 auf 6,83 und von 7,02 auf 9,01.

## Prüfung

- `pruefungen/m557-agency-innenkontur.mjs` prüft die gezeichneten Konturen im Lottie-Renderer.
- `pruefungen/m557-agency-lesbarkeit.mjs` misst die Darstellung in den Einstellungen für beide Farbschemata, den Tastaturfokus und die Auswahl unter dem Mauszeiger.
