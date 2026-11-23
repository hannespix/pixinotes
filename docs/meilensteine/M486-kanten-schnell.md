# M486 — Ziehen mit vielen Verbindungen flüssig
PR: siehe Merge-Titel „… (M486)" · Prüfreihe: `pruefungen/m486-kanten-schnell.mjs` (Port 5486) · Datum: 2026-11-23

## Warum
Befund aus M485: Mit 100 Verbindungen auf 200 Karten kostete jede Mausbewegung beim Ziehen über 100 ms, weil jedes
Zug-Ereignis **alle** Kanten neu renderte und jede dabei gegen alle Karten auf Hindernisse prüfte (M132). Außerdem
wichen Kanten den Lagen im Stand aus, nicht den gerade ausweichenden Karten.

## Was
- Beim Ziehen zeichnen sich nur Verbindungen neu, deren Endpunkte sich bewegen oder deren Ausweich-Bogen sich durch
  eine bewegte Karte ändert. Alle anderen behalten ihren Pfad, ohne dass React sie anfasst.
- Kanten weichen den Karten aus, wie man sie sieht: einer ausweichenden Nachbarin (Ziel des Ausweichens) und der
  gehobenen Karte.
- Sonst unverändert: dieselben Pfade im Stand (Strg+Z bringt alle 100 Punkt für Punkt zurück), M481/M485 grün.

## Wie (Architektur)
Gefunden mit einem Zähler über den React-Entwicklerhaken (Prüfreihe Z) und Chromium-Profilen (CPU + Trace). Fünf
Ursachen, jede für sich ließ alle Kanten bei jedem Zug-Ereignis rendern oder teuer rechnen:
- **`LabeledEdge.tsx`** abonnierte `selectActiveBoard(s).nodes` und `.edges` — jede Lageänderung weckte jede Kante.
  Jetzt: `pShift` (Parallel-Versatz) als Zahl aus dem Store; das **Ergebnis des Ausweichens** (`off`, eine Zahl) über
  `useSyncExternalStore(abo, …)` (Abo auf Store **und** `zugAnzeige`). Die Prüfung läuft im Abo nur gegen Karten im
  Korridor, den die Kurve erreichen kann (`KORRIDOR` 500 + |Versatz| um die Endpunkte — Stummel 22 + Griff 110 +
  Ausweichen 240 + Griff 110 um die verschobene Mitte; die Kurve bleibt in der Hülle ihrer Stützpunkte, also exakt
  dasselbe Ergebnis wie vorher). Bleibt `off` gleich, rendert die Kante nicht. Die Kurve ist
  in `basis` (useMemo auf Endpunkte) und `geo` (useMemo auf Basis + `off`) geteilt.
- **`hindernisse()`** (LabeledEdge): die Kästen aller Karten EINMAL je Store- bzw. Anzeige-Stand für alle Kanten
  (`anzeigeStand()` in `zugAnzeige.ts` zählt jede Änderung); gleiche Karte → dasselbe Objekt, so erkennt eine Kante
  „nichts geändert" am Objekt (`vorher`-Ref, spart das Abtasten).
- **`Board.tsx`**: `defaultEdgeOptions` und `proOptions` waren je Render neue Objekte — React Flow reicht die
  Vorgabe an jede Kante (`useStore(s => s.defaultEdgeOptions)`), also renderten alle bei jedem Board-Render. Jetzt
  Konstanten `KANTEN_VORGABE`, `PRO_OPTIONEN`. `rfNodes` merkt sich gemappte Karten (WeakMap `rfCache`) — Karten mit
  Klasse (Schrift, Größe, Archiv) galten sonst bei jedem Ereignis als geändert. `rfEdges` hängt an `archivKey` (Menge
  archivierter Karten) statt an jeder Lage.
- **EdgeLabelRenderer**: React Flows Baustein suchte sein Ziel bei jeder Änderung im React-Flow-Stand per
  `querySelector` im ganzen Board — je Kante. `labelZiel()` merkt es je `.react-flow` (WeakMap), die Beschriftung geht
  per `createPortal` dorthin (gleiches DOM wie vorher). Ebenso merkt `schattenEbene()` die Schatten-Ebene je Schicht.
- **`Tabs.tsx`**: der Effekt der Reiter-Reihe (`rollMessen`, M412) lief nach **jedem** Render und las `scrollWidth`
  — die Reihe rendert bei jedem Zug-Ereignis mit (hört auf `boards`), das erzwang ein Layout der ganzen Seite (im
  Profil der größte JS-Posten). Jetzt nur bei geänderten Reitern (`reiheSchluessel`), Board, Ansicht, Spalte.
- **`ziehGefuehl.ts`**: `neigungsFeder` nimmt auch eine Liste von Elementen; `--zieh-neigung` steht an den gehobenen
  Karten statt an der ganzen Fläche (die Variable erbt — vorher rechnete der Browser je Bild den Stil aller Karten
  neu). `kantenBeobachter` meldet auch Karten ohne eigene Verbindung, aber nur mit dem Ziel ihres Ausweichens
  (Inline-`translate`, ohne `getComputedStyle`) — sie sind für Kanten nur Hindernis.
- Start-JS: +≈1,3 KB (die Kanten-Komponente liegt im Start), weit unter den Grenzen nach M483.

## Messwerte (Prüf-Chromium, 200 Karten, 100 Verbindungen, Maschine mit Last 8–15 auf 4 Kernen)
| | vorher | nachher |
|---|---|---|
| Kanten-Renders je Mausbewegung (Prüfreihe Z3) | 219–223 | 21–26 |
| verschiedene Kanten, die sich überhaupt neu zeichnen (Z2) | 100 | 13 |
| JS je 30 Mausbewegungen (Trace: EventDispatch + FunctionCall) | ≈ 7,1 s | ≈ 2,3 s |
| Maus → Bild, Median (A/B im Wechsel, je 3 Läufe) | 110–169 ms | 85–116 ms |
| Bildzeit, Median | 33,3 ms | 33,3 ms |
| zum Vergleich: dasselbe Board ohne Verbindungen | 16,7 ms / 33–45 ms | 16,7 ms / 33–45 ms |

## Grenzen / offen
- **Ziel 60 fps mit 100 Verbindungen auf dieser Maschine nicht erreicht:** Was bleibt, ist Browser-Arbeit, nicht JS —
  Layerize, Stil und Rastern (der gemeinsame Weichzeichner der Pfeilschatten, M434) für die Kanten, die der Karte
  Bild für Bild folgen (M485). Ausprobiert und verworfen (gemessen nicht besser oder schlechter): eigene Ebene für die
  Schatten bewegter Kanten (mit und ohne Weichzeichner), Schatten-Ebene als eigene Compositor-Ebene (`will-change`,
  deutlich schlechter), Lesen nach dem Layout über einen ResizeObserver (spart die erzwungene Stil-Rechnung, aber die
  Kante lief dann im Animations-Rückruf ein Bild hinterher — M485 K2/K5 rot).
- Die Messungen schwanken auf der ausgelasteten Prüf-Maschine stark; die Prüfreihe vergleicht deshalb mit demselben
  Board ohne Verbindungen (bester von zwei Läufen) statt mit festen Millisekunden.
- Gehobene Karte ohne eigene Verbindung ist für andere Kanten Hindernis in ihrer Stand-Lage (ohne Neigung/Skala).

## Prüfreihe
`m486-kanten-schnell`: Z Zählung über den React-Entwicklerhaken (welche Kanten-Komponenten je Commit rendern; die
gezogene Karte ja, ferne nie, Summe je Mausbewegung), R Pfade nach dem Ablegen und nach Strg+Z, L Bildzeit und
Maus → Bild gegen das Board ohne Verbindungen, A Kante weicht der ausgewichenen Karte aus (vorher lief sie hindurch).
