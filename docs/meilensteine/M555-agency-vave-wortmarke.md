# M555 — Die Bewegung von vave.log für „pixi · notes“

Prüfreihe `pruefungen/m555-agency-vave-wortmarke.mjs` · 2026-11-26

## Vorlage

Die Agency-Wortmarke nutzt die Animation aus vave.log. Das Original enthält vier gezeichnete Buchstaben. Für PixiNotes bekommen diese vier Plätze neue Konturen für „p“, „i“, „x“ und „i“. Die Vorlage liefert die Staffelung der Bewegung, die Kurven zwischen den Schlüsselbildern und die Verschiebung innerhalb der Buchstaben. [Animationsdatei von vave.log](https://github.com/hannespix/vave.log/blob/f0447dd67dd67f7b06e948faee2fb41fbdd35937/public/vave-logo.json)

## Umsetzung

Der Lottie-Player zeichnet die neuen Konturen als Vektoren und fährt die 26 Bilder stufenlos vor und zurück. Die Leiste zeigt einen kräftigen linken Schriftzug, den violetten Punkt und ein ruhig gesetztes „notes“. Die helle Variante verwendet Schwarz für „pixi“. Im Dunkelmodus nutzt die Wortmarke die helle Tinte des Designs.

Die Abfolge aus langem Zug, Doppelwelle und kleineren Wellen übernimmt die Zeiten von vave.log. Beim Ziehen, außerhalb des Sichtfelds und im verdeckten Tab pausiert sie. Bei „Bewegung reduzieren“ oder „Besser lesbar“ steht die Wortmarke still. [Ablauf in vave.log](https://github.com/hannespix/vave.log/blob/f0447dd67dd67f7b06e948faee2fb41fbdd35937/src/web/Logo.tsx)

M555 prüft die Bildfolge und Parameter gegen die Vorlage. M553 kontrolliert die Reihenfolge der bewegten Buchstaben im Renderer. M554 prüft bei Leisten-Größe die Lesbarkeit und den pixelgenauen Rücklauf zur Grundform.
