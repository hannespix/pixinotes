# M556 — Deutlichere Welle in der Agency-Wortmarke

Prüfreihe `pruefungen/m556-agency-ausdruck.mjs` · 2026-11-26

Die Welle in „pixi“ ist in der Kopfleiste deutlicher zu sehen. In den bewegten Konturen wölbt sich der Bauch des „p“ stärker um die Öffnung. Das „x“ und das letzte „i“ werden schlanker, wenn die Bewegung sie erreicht.

In `src/assets/pixi-logo.json` wachsen die Abstände der Endkonturpunkte und ihrer Bézier-Griffe zur Grundform um 22 Prozent.

Der Lottie-Player zeichnet die Konturen im Takt von vave.log. Die Buchstaben setzen nacheinander ein, halten am Ende des Zugs kurz inne und fließen zurück. Mit „Bewegung reduzieren“ und „Besser lesbar“ zeigt die Kopfleiste die ruhende Wortmarke. [Zeitachse von vave.log](https://github.com/hannespix/vave.log/blob/f0447dd67dd67f7b06e948faee2fb41fbdd35937/public/vave-logo.json)

M556 misst, wie sich die sichtbare Fläche der Buchstaben zwischen Ruhe und voller Ausprägung verteilt. M554 prüft, ob „pixi“ auch in der mobilen Kopfleiste lesbar bleibt und pixelgenau zur Ausgangsform zurückkehrt.
