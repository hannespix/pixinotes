# M481 — Karten ziehen wie die Boards in der Übersicht
PR: #… · Prüfreihe: `pruefungen/m481-karten-ziehen.mjs` (Port 5481) · Datum: 2026-11-23

## Warum
Nutzerwunsch: „Die Animation und Art und Weise der Drag-and-Drop-Geschichte der Boards in der Übersicht ist super!
Kannst du diese super Animation auch auf alle Module etc im Board anwenden?!" Vorlage ist M440 (Board-Kacheln in der
Übersicht: heben, neigen, ausweichen, federnd ablegen).

## Was
- **Heben:** Die gegriffene Karte wird größer (je nach Größe 1,2–6 %, kleine Karten wie die Kacheln 6 %, große höchstens
  ~14 Punkte je Seite) und trägt einen tieferen Schatten.
- **Neigen:** Beim schnellen Ziehen kippt sie in Zugrichtung (Feder, gedeckelt: 7° für kleine Karten, weniger für große),
  im Stillstand schwingt die Neigung aus.
- **Ausweichen:** Karten, über die man zieht, gleiten beiseite (kürzester Weg + 12 Punkte Abstand) und kehren gleitend
  zurück, wenn die Karte weiterzieht. Wird auf einer Karte abgelegt, bleibt sie beiseite.
- **Landen:** Beim Loslassen senkt sich die Karte federnd an ihren Platz, die Neigung schwingt aus.
- **Haften (M344/M349 bleiben):** Greift eine Fanglinie oder Abstandsmarke, liegt die Karte flach und gerade — ihre Kante
  steht genau auf der Linie (die M344-Lehre: gehobene/geneigte Kanten lassen sich nicht ausrichten).
- **Ein Schritt:** Strg+Z nimmt Zug und Ausweichen zusammen zurück.
- **Schalter** „Bewegung beim Ziehen" (Einstellungen → Darstellung → Bedienung, Standard an; Alt+O schaltet um).
  `prefers-reduced-motion`: kein Heben, keine Neigung, keine Feder, Ausweichen nur kurz.

## Wie (Architektur)
- **Gemeinsame Datei `src/lib/ziehGefuehl.ts`** für Übersicht und Board: `neigungsFeder(el, variable, grenze)`
  (Ziel ×0,86 je Bild, Winkel folgt ×0,22 — die Werte aus M440), `tempoMesser` (Punkte/ms, geglättet 0,6/0,4;
  9° je Punkt/ms), `neigungsGrenze(w, h)`, `hebeSkala(w, h)`, `wegVektor` (früher `lib/physics.ts` `computePush`,
  Datei entfernt), `ausweichen(kandidaten)` (nur Anzeige über `translate` am Knoten; `ende()` liefert die Lagen zum
  Übernehmen), `versatzAufloesen(el, x, y)` (nimmt `translate` erst weg, wenn React Flow die neue Lage gesetzt hat —
  kein Ruck), `bewegungArm()`.
- **Tokens** in `styles/00-tokens.css`: `--zieh-feder` (`cubic-bezier(0.22, 1.28, 0.42, 1)`, 0,46 s),
  `--zieh-heben` (`cubic-bezier(0.3, 1.4, 0.5, 1)`, 0,18 s), `--zieh-landen` (`cubic-bezier(0.22, 1.3, 0.42, 1)`,
  0,38 s), `--zieh-schatten` (hell/dunkel). Die Übersicht (`72-netz-nur-inhalt-formen.css`) nutzt jetzt dieselben
  Tokens und die Variable `--zieh-neigung` (vorher `--ovc-neigung`).
- **Board** (`Board.tsx`): `ziehBeginnen` / `ziehSchritt` / `ziehEnde` aus `onNodeDragStart` / `onNodeDrag` /
  `onNodeDragStop`; die eigentliche Rechnung je Zug ist `zugStarten()` in `ziehGefuehl.ts` (gibt `schritt`, `ende`,
  `aufloesen`). Die Datei wird **nachgeladen** — beim ersten Überfahren bzw. Druck auf die Fläche (Start-JS-Grenze
  M446: ohne das lag der Start 2,4 KB über 2 240 000 B); kommt sie beim allerersten Fingerzug erst während des Zugs,
  setzt das Gefühl dort ein. Die Karte bekommt `data-gehoben="an"` (dann `"landet"` für `LANDEN_MS` 650 ms), `--zieh-skala`,
  `--zieh-x/-y`; die Fläche `data-zieh` (Schalter an), `data-gerastet` (Fanglinie greift) und `--zieh-neigung`.
  CSS in `styles/34-praesentation.css` (Abschnitt „Ziehen"): Heben und Neigen über die Einzel-Eigenschaften
  `scale`/`rotate` am Knoten — React Flow setzt die Lage als Inline-`transform`, die Einzel-Eigenschaften wirken davor;
  `transform-origin: calc(var(--zieh-x) + 50%) …` rückt den Drehpunkt deshalb auf die Kartenmitte. Der tiefere
  Schatten kommt über ein lokales `--card-shadow-lift` (wer keinen Schatten trägt — Bilder ohne Rand, Formen —, bekommt
  auch keinen).
- **Ausweichen nur, wo es Sinn ergibt:** höchstens `ZIEH_HEBEN_MAX` (6) gezogene Karten (darüber weder Heben noch
  Ausweichen), keine Rahmen (weder gezogen noch ausweichend), kein Rahmen-Inhalt (Mitte in einem Rahmen),
  nichts Archiviertes, nichts, was beim Greifen schon unter der Karte lag (Stapel bleiben Stapel — darum schaltet
  „Stapeln" im Dock auch nichts mehr ab).
- **Verlauf/Live:** Während des Zugs wird für die Nachbarn nichts in den Stand geschrieben (also auch nichts ans
  Live-Team); beim Ablegen eine `setNodePositions` unter `mutedHistory` — im Rückgängig-Schritt vom Zug-Beginn (M365).
- **Alte Physik zusammengeführt:** `physicsEnabled` (Verdrängung mit Kettenreaktion + Wurf, schrieb jedes Bild in den
  Stand) und `lib/physics.ts` sind entfernt; neu `ziehBewegung` (Store + Vorlieben `pixinotes-einstellungen`).
  „Lebendige Fläche" schaltet nur noch Klick-Zoom und Konfetti. Die M294-Umstellung (Hinweis „Physik und Klick-Zoom
  sind jetzt aus") liest ein altes `physicsEnabled` weiterhin aus Haupt- und Vorlieben-Stand.
- **Übersicht** (`Overview.tsx`): Feder und Tempo aus `ziehGefuehl.ts` statt eigener Kopie; das Ausweichen dort bleibt
  die Raster-Vorschau (`vorschau` → `layoutHierarchy`).

## Messwerte
200 Karten (weiter Zoom, 0,25): Median 16,7 ms je Bild beim Ziehen über Nachbarn (Prüfreihe I2).

## Grenzen / offen
- Kein Wurf mehr: Er vertrug sich nicht mit „federt an den Platz, endet exakt dort" und mit den Fanglinien.
- Ausweichen ist einstufig (keine Kettenreaktion): Ein Nachbar kann auf einen dritten gleiten — bewusst, weil sonst
  jedes Bild viele Karten neu rechnen und schreiben müsste. → M485: Kette bis drei Stufen, nur als Anzeige.
- Kanten zeigen während des Zugs auf die ungehobene Lage (bei 1–6 % Heben kaum sichtbar). → M485: sie folgen der sichtbaren Lage.
