# M505 — Fanglinien rasten weich ein, die Zieh-Animation läuft weiter
PR: siehe Merge-Titel „… (M505)" · Prüfreihe: `pruefungen/m505-fang-weich.mjs` (Port 5505) · Datum: 2026-11-24

## Warum
Rückmeldung: „das einrasten bei den fanglinien lässt die schöne schwunganimation jedesmal ruckelig abbrechen.
bekommt man es auch hin dass fanglinien funktionieren und trotzdem die animation sauber läuft?"

## Ursache (gemessen, Lage-Spur je Bild)
Gemessen wurde die sichtbare Mitte der gezogenen Karte je Bild gegen den Zeiger (Prüfreihe A–C, Stand vor M505):
1. **Lage springt hart.** `onNodesChangeFang` (Board.tsx) setzt die gefangene Lage direkt in die Änderung von React
   Flow — die Karte stand im nächsten Bild an der Linie: **6,4 Punkte in einem Bild** beim Einrasten (Fangweite 6),
   **6 Punkte** beim Lösen (zurück unter den Zeiger).
2. **Heben und Neigung brechen ab.** `data-gerastet` an der Fläche setzte `scale: none; rotate: none`, die Feder
   `neigung.gerade()` den Winkel auf 0: **−5,3° → 0° in einem Bild**; die Skala fiel über `--zieh-heben`
   (überschwingend) unter 1 und wieder zurück.
3. **Raster:** React Flows `snapToGrid` rastet schon im Ziehen ein, die Karte sprang **19–20 Punkte** (eine
   Rasterweite) je Bild. Strg half dort nicht (React Flow kennt keine Ausnahme).
4. **Ablegen auf der Fangstelle** war unauffällig (die Karte lag schon flach dort) — außer man ließ mitten im Sprung
   los; dann gab es nichts mehr zu federn.

## Was
- Greift eine Fanglinie, **gleitet** die Karte in ~0,1 s an die Linie (statt zu springen) und ebenso wieder heraus.
- Heben und Neigung **klingen ab** (Skala und Winkel über ~0,1 s gegen flach) und kommen beim Lösen weich zurück;
  die Neigungs-Feder läuft durch, die Schwung-Animation bricht nicht mehr ab.
- Losgelassen, während sie noch gleitet: der Rest gleitet mit der gewohnten Lande-Feder; Endlage exakt auf der Linie.
- **Raster:** die Karte gleitet von Rasterpunkt zu Rasterpunkt; **Strg legt jetzt auch im Raster frei ab**.
- Unverändert: Fanglinien und Abstandsmarken, Fangweite 6 Punkte, Endlage exakt, „Aus · Fanglinien · Raster",
  Strg frei, „weniger Bewegung" = ohne Gleiten und ohne Feder (hart wie bisher), „Bewegung beim Ziehen" aus = hart wie
  bisher, Rahmen rasten über React Flow.

## Wie (Architektur)
- **Prinzip:** Die Lage im **Stand** bleibt hart gefangen (React Flow, Kanten-Endpunkte, Linien, Speicher, Live —
  alles wie vorher). Nur die **Anzeige** der gehobenen Karte trägt einen Versatz `translate` (Flächen-Punkte), der
  den Sprung der Stand-Lage aufnimmt und nach der Uhr abklingt (`e^(−dt/τ)`, `FANG_TAU_MS` 35 ms, 95 % nach ~105 ms;
  bei 30 und 60 Bildern je Sekunde gleich schnell).
- **`lib/ziehGefuehl.ts` `weichesEinrasten(els)`** (nachgeladen, Start-JS unberührt): `fang(e: Einrasten)` aus
  Board.tsx mit `{ dx, dy, zx, zy }` — Fang-Versatz gegenüber der Lage unter dem Zeiger und die Stelle, an der die
  Achse einrastet (`null` = frei). Aufgenommen wird nur, wenn sich die **Fangstelle** je Achse ändert (einrasten,
  lösen, andere Stelle, nächster Rasterpunkt): `o −= d_neu − d_alt`. Bleibt die Karte an derselben Stelle, ändert sich
  `d` nur, weil der Zeiger wandert — dann haftet sie (kein Nachziehen, sonst würde sie im schnellen Zug kaum
  einrasten). Der Versatz wird im Zeiger-Ereignis sofort geschrieben (kein Bild mit Sprung), der Bild-Rückruf lässt
  ihn abklingen.
- **`--zieh-hub`** (1 gehoben … 0 flach, `HUB_TAU_MS` 40 ms) an der Karte; CSS (`34-praesentation.css`, „Ziehen"):
  `scale: calc(1 + (var(--zieh-skala) - 1) * var(--zieh-hub, 1))`, `rotate: calc(var(--zieh-neigung) * var(--zieh-hub, 1))`.
  Solange JS den Hub führt, trägt die Karte `data-hub` — dort ohne `scale`-Übergang (der liefe sonst jedes Bild neu
  an). `data-gerastet` und die Regel `scale: none; rotate: none` sind entfallen; `neigung.gerade()` wird beim Board
  nicht mehr gerufen (die Feder rechnet unsichtbar weiter).
- **`erwartet()`** (Kanten-Beobachter, M491) rechnet Skala und Winkel mit dem Hub; `gerastetJetzt` entfällt.
- **Reihenfolge der Bild-Rückrufe:** `zugStarten` legt Fang-Gleiten und Neigungs-Feder **vor** dem Kanten-Beobachter
  an, das Gleiten läuft während des Zugs durchgehend (leer, wenn nichts gleitet) — so lesen die Kanten in jedem Bild
  schon die Lage dieses Bilds (sonst hinkten sie beim Gleiten ein Bild nach, bis 2,4 Punkte). Sicherheitsnetz: der
  Rückruf endet, wenn die Karte weg ist oder nach 10 min ohne `ende`.
- **Ablegen:** `weich.ende()` nimmt den Rest-Versatz im selben Stil-Wechsel wie `data-gehoben="landet"` weg — der
  CSS-Übergang `translate` mit `--zieh-feder` übernimmt ihn (gewohnte Lande-Feder). `--zieh-hub` wird nach
  `LANDEN_MS` entfernt, nur vom Zug, der die Karte zuletzt geführt hat (`weichBesitzer`).
- **Raster selbst** (`Board.tsx`): Beim Greifen einer Karte (keine Rahmen in der Auswahl) setzt `onNodeDragStart`
  React Flows `snapToGrid` im Stand auf `false` (`useStoreApi`, `rasterSelbst`), `onNodesChangeFang` rastet wie React
  Flow ein (Versatz der ersten Karte für alle, Raster 20) und meldet ihn über `fang`; `onNodeDragStop` stellt
  `snapToGrid` zurück. React Flow liest den Wert je Mausbewegung aus seinem Stand; neue Karten, Größe ändern,
  Pfeiltasten und `screenToFlowPosition` rasten weiter über React Flow. Strg/⌘ legt dadurch auch im Raster frei ab.
- **`lib/fang.ts` `fangen()`** liefert zusätzlich `gx`/`gy` (die Achse rastet ein, auch mit Versatz 0).
- Start-JS: nur die paar Zeilen in Board.tsx/fang.ts; die Rechnung liegt im nachgeladenen `ziehGefuehl.ts`.

## Messwerte (Prüf-Chromium, Zoom 1, Prüfreihe m505)
| | vorher | nachher |
|---|---|---|
| größter Sprung beim Einrasten (je 16,7 ms) | 6,4 px | 2,3 px |
| größter Sprung beim Lösen | 6,0 px | 2,3 px |
| Neigung je Bild ab dem Einrasten | −5,3° → 0° (ein Bild) | −3,9 → −2,6 → −1,7 → −1,1 → −0,7 → … (Abfall ≤ 35 %) |
| größter Sprung im Raster (Rasterweite 20 px) | 19 px | 7,2 px |
| Kante ↔ sichtbare Karte beim Gleiten | — | ≤ 1,5 px je Bild |

## Grenzen / offen
- Mit „Bewegung beim Ziehen" aus (oder mehr als `ZIEH_HEBEN_MAX` gezogenen Karten) gibt es keinen Zug — dort rastet
  es weiter hart ein, wie vorher.
- Rahmen (und Auswahlen mit Rahmen) rasten im Raster weiter über React Flow, hart: ihr Inhalt zieht über Deltas der
  React-Flow-Lage mit.
- Die Kante der **gehobenen** Karte steht erst nach dem Abklingen genau auf der Linie (wie M481: gehoben lässt sich
  nicht ausrichten); in Ruhe und abgelegt exakt.

## Prüfreihe
`m505-fang-weich`: A Annähern (Sprung ≤ 3 px je 16,7 ms, gleitet über mehrere Bilder, in Ruhe flach auf der Linie,
Verbindung folgt Bild für Bild), B Lösen, C schnell auf die Kante (Neigung fällt höchstens 75 % je Bild, klingt über
≥ 3 Bilder ab), D Ablegen (auf der Fangstelle ohne Sprung, mitten im Gleiten mit Feder, Stand exakt), E Raster
(gleitet, Vielfache von 20, Strg frei), F Strg frei, G weniger Bewegung (hart wie bisher), H Doku. Gemessen wird nach
allen Bild-Rückrufen eines Bilds (ResizeObserver einer Sonde, die am Bildanfang ihre Breite kippt) — also das, was
gemalt wird.
