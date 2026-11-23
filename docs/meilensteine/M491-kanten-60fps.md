# M491 — 60 Bilder je Sekunde beim Ziehen mit vielen Verbindungen
PR: siehe Merge-Titel „… (M491)" · Prüfreihe: `pruefungen/m491-kanten-60fps.mjs` (Port 5491) · Datum: 2026-11-23

## Warum
Offen aus M486: Mit 200 Karten und 100 Verbindungen lag der Median der Bildzeit beim Ziehen bei 33,3 ms (ohne
Verbindungen 16,7 ms), Maus → Bild bei 85–116 ms (ohne 33–45 ms). M486 hatte das JS je Mausbewegung gesenkt; der
Rest galt als Browser-Arbeit (Stil, Layerize, Rastern des weichen Kanten-Schattens, M434).

## Was
- Ziehen auf einem Board mit 200 Karten und 100 Verbindungen läuft mit 60 Bildern je Sekunde wie ohne Verbindungen;
  die Karte folgt der Maus fast so schnell wie auf einem Board ohne Verbindungen.
- Eine Verbindung, die sich im Zug bewegt, blendet ihren weichen Schatten aus (0,08 s) und holt ihn nach dem Ablegen
  an der neuen Stelle zurück (0,3 s). Ruhende Verbindungen behalten ihren Schatten; im Ruhezustand sieht alles aus
  wie vorher (Bildvergleich hell/dunkel, Prüfreihe S).
- Nebenbei: auch das Board ohne Verbindungen zieht ruhiger (keine 40-ms-Hänger mehr, wenn Fanglinien kommen und
  gehen).

## Befund (Chromium-Trace, Thread-Zeit; Werkzeuge im Scratchpad, nicht im Repo)
Gemessen mit `Tracing.start` (Kategorien `devtools.timeline`, `disabled-by-default-devtools.timeline`, `blink`, `cc`,
`invalidationTracking`) und dem CPU-Profiler, je 50 Mausbewegungen über das Board aus M486. Weil die Maschine geteilt
ist (Last 2–28 auf 4 Kernen), zählt die Thread-Zeit (`tdur`) statt der Wand-Zeit, und Laufzeiten nur relativ (im
Wechsel mit dem Board ohne Verbindungen bzw. dem alten Build).

1. **Stil des ganzen Dokuments neu, 36 Mal auf 50 Mausbewegungen** (je 7 000–8 400 Elemente, gut 40 ms) — mit UND
   ohne Verbindungen. Auslöser laut `invalidationTracking`: das Ein- und Aushängen der Fanglinien-Elemente
   (`Fanglinien.tsx`, `.fang-abstand`/`.fanglinie`). Chromium prüft dann alle `:has()`-Regeln mit Subjekt an `html`,
   `body`, `.react-flow` (`html:has(.app.focus-mode) .toast`, `.react-flow:has(.react-flow__connectionline) …`), und
   weil dahinter Nachfahren-Selektoren stehen, ist der ganze Baum ungültig. Diese Rechnungen liefen oft im
   Treffer-Test der Mausbewegung (`LayoutView::HitTest`) — daher die hohe Latenz.
2. **Layerize in jedem Bild 6–7 ms** (ohne Verbindungen 0,7 ms, dort nur ab und zu). Chromium ordnet die Ebenen voll
   neu ein, wenn sich die Ausdehnung eines Mal-Abschnitts ändert; eine Kante, die der Karte folgt, ändert ihre
   Ausdehnung in jedem Bild (Karten verschiebt React Flow per `transform`, das zählt nicht). Bewiesen mit
   `visibility: hidden` auf den Kanten (0,9 ms) und mit einem festen, durchsichtigen Rechteck je Kante (0,9 ms).
   Dazu kamen die leeren Beschriftungen („+", `opacity: 0`), je eine eigene Ebene mit `transform`.
3. **Rastern des Weichzeichners** (M434): Je Bild rasterte Chromium die Kacheln, die Karte und bewegte Kanten
   berühren, samt Weichzeichner der Schatten-Ebene — Raster-Threads ≈ 1 150 ms statt 135 ms ohne Verbindungen.
4. **JS**, Rest nach M486: `getComputedStyle` im Kanten-Beobachter (erzwingt je Bild eine Stil-Rechnung mitten im
   Bild, größter JS-Posten), React Flows `ViewportPortal` (sucht sein Ziel bei jeder Store-Änderung per
   `querySelector`, viermal), je Kante der Parallel-Versatz über alle Kanten und die Hindernis-Schleife über alle
   Karten bei jedem Zug-Ereignis.

## Wie (Architektur)
- **`Fanglinien.tsx` + `lib/fang.ts`:** Plätze statt Ein-/Aushängen. Je Art (v/h) ein Vorrat an Elementen, so viele
  wie im Zug je gleichzeitig gebraucht; freie Plätze tragen `display: none` (Inline-Stil) und die Klasse
  `fang-platz` (in keinem `:has()`), die Prüfreihen zählen weiter `.fanglinie`/`.fang-abstand`. `fangSetzen(neu,
  ende)`: erst das Zug-Ende (`FANG_ENDE`, aus `onNodesChange` mit `ende` und `onNodeDragStop`) gibt die Plätze frei.
  **Regel: Mitten im Zug nichts ins DOM hängen oder aushängen** — jedes Element kostet eine Stil-Rechnung über alles.
- **`lib/zugAnzeige.ts`:** `zugSetzen(an)`, `zugLaeuft()`, `nachZug(f)` — Board.tsx setzt den Zug in
  `onNodeDragStart`/`onNodeDragStop` (auch Rahmen) und dazu `data-zug` an `.board-wrap`.
- **`LabeledEdge.tsx`, Schatten:** Ändert sich der Schatten-Pfad einer Kante, während `zugLaeuft()`, merkt sie sich
  den Pfad von vorher (`ruhe`), behält ihn in der gemeinsamen Ebene und trägt die Klasse `im-zug`
  (`stroke-opacity: 0`, 72-netz…css). `nachZug` weckt sie nach dem Ablegen: neuer Pfad, Übergang zurück auf voll.
  Die Schatten-Ebene ändert sich im Zug so nicht und wird nicht neu gerastert. **Nicht `opacity: 0`:** ein
  durchsichtiger Pfad in der Ebene mit `filter: blur()` ließ Chromium die Ebene vom Compositor zeichnen (51 Ebenen,
  8 s Software-Rendern auf 50 Mausbewegungen).
- **`LabeledEdge.tsx`, Rahmen:** `<rect class="pn-kante-rahmen">` je Kante, ±10⁶ Flächen-Punkte, durchsichtig, ohne
  Treffer; sichtbar nur mit `[data-zug]` (CSS-Umschalten statt Einhängen, siehe Regel oben). So bleibt die
  Ausdehnung jedes Kanten-Abschnitts im Zug gleich, und Chromium nimmt den schnellen Weg (nur neu gemalte Ebenen
  auffrischen). Skia malt durchsichtige Flächen nicht (`nothingToDraw`).
- **Leere Beschriftungen im Zug:** `.board-wrap[data-zug] .edge-label.empty:not(.selected) { display: none }`
  (25-board…css) — unsichtbar waren sie ohnehin.
- **`lib/ziehGefuehl.ts` `kantenBeobachter`:** liest `getComputedStyle` nur noch, solange an einer Karte ein Übergang
  laufen kann. `erwartet(e)` leitet aus Inline-Stil und denselben Regeln wie das CSS ab, was die Karte ruhend zeigt
  (`translate`, `--zieh-skala`, `--zieh-neigung`, flach bei „weniger Bewegung" und an der Fanglinie); stimmt der
  berechnete Stil zweimal hintereinander damit überein, ist die Karte „ruhig" (`ruhe`, WeakMap) und der Beobachter
  nimmt das Erwartete. `stoeren(el)` an jeder Stelle, die einen Übergang startet (Ausweichen setzen/zurück,
  `versatzAufloesen`, Heben, Landen, Fanglinie greift/lässt los). Weicht das CSS einmal ab, bleibt es beim
  berechneten Stil (sicher, nur teurer).
- **`AnsichtPortal.tsx`** ersetzt React Flows `ViewportPortal` (Board.tsx, CommentLayer.tsx): Ziel je Fläche gemerkt.
- **`LabeledEdge.tsx`:** `parallelVersatz(edges)` einmal je Kanten-Liste (WeakMap) statt je Kante;
  `hindernisse()` zählt `version` und liefert `geaendert` (alte und neue Kästen bewegter Karten) — eine Kante, die die
  Vorgänger-Version kennt, prüft nur diese gegen ihren Korridor.
- **`60-dunkel-navigator-stift.css` (Fund beim Einmischen von M492):** Die Regel für Notizen ohne bekannte Farbe im
  Dunkeln stand als `.react-flow__node-note:has(.note-card:not(…):not([style*='background']))`. Ein
  Attribut-Selektor auf `style` in einem `:has()` ließ Chromium bei **jeder** Änderung eines Inline-Stils (React
  Flow verschiebt Karten per `style`) den Stil des ganzen Dokuments neu rechnen — auch im hellen Design: 162 Mal auf
  50 Mausbewegungen, Bildzeit 83 ms, Maus → Bild 183 ms. Jetzt steht die Regel ohne `:has()` direkt an
  `.note-card` (gleiche Wirkung, M492 grün). **Regel: keine `style`-Attribut-Selektoren (und nichts, was sich je Bild
  ändert) in `:has()`; Prüfreihe m491 T2 fängt das.**
- Start-JS: winzig mehr (Rahmen, Plätze, Portal), Grenzen aus M459/M467/M483 unverändert.

## Messwerte
Prüf-Chromium, 200 Karten, Zug über das Board wie M486, je Lauf 50 Mausbewegungen; Median Bildzeit / Median
Maus → Bild. A = Stand vor M491, B = M491, im Wechsel, Last 8–14 (`uptime`):

| | ohne Verbindungen | 100 Verbindungen |
|---|---|---|
| vorher (A) | 16,7 ms / 28–35 ms | 16,7–33,4 ms (meist 33,3) / 77–88 ms |
| nachher (B) | 16,7 ms / 26–32 ms | 16,7 ms / 32–44 ms |

Trace (Thread-Zeit, je Bild bzw. je 50 Mausbewegungen):

| | vorher | nachher |
|---|---|---|
| Stil-Rechnungen über > 1 000 Elemente | 36–37 (≈ 1 500 ms) | 0–1 |
| Layerize je Bild (Median), 100 Verbindungen | 6,5–7,0 ms | 0,9–1,8 ms |
| Raster-Threads, 100 Verbindungen | ≈ 1 150 ms | ≈ 300–500 ms |
| JS-Selbstzeit `lesen` (Kanten-Beobachter, Profil) | 150–350 ms | siehe unten |

## Grenzen / offen
- Die Zahlen schwanken auf der geteilten Maschine stark; die Prüfreihe misst deshalb im Wechsel mit dem Board ohne
  Verbindungen (bester von drei Läufen) und prüft die Browser-Arbeit über die Thread-Zeit im Trace.
- Verworfen (gemessen nicht besser): die Schatten-Ebene in eine Hülle mit eigener Compositor-Ebene legen
  (`will-change: opacity`/`transform`; der Compositor zeichnet dann mehr, `transform` rastert ein Vielfaches),
  bewegte Kanten als eigene Ebenen (`will-change` am Kanten-`svg`, Layerize unverändert), `.react-flow__edges` als
  eigene Ebene.
- Der Rest-Abstand zum Board ohne Verbindungen ist JS (React Flow rechnet je Store-Änderung die Lage aller 100
  Kanten, `memoizedSelector`; bewegte Kanten rendern je Bild zweimal: Lage und Anzeige) und Malen der bewegten
  Kanten.
- Eine gewählte, leere Beschriftung bleibt im Zug sichtbar (wie vorher).
- Nebenbefund, nicht angefasst: Ein Klick auf das unsichtbare „+" einer leeren Beschriftung öffnet das Feld nicht
  (trifft das ✕ bzw. öffnet nichts) — schon vor M491 so.

## Prüfreihe
`m491-kanten-60fps`: L Bildzeit ≤ 20 ms und Maus → Bild ≤ Board ohne Verbindungen + 15 ms (bester von drei, im
Wechsel), T Layerize je Bild und Stil-Rechnungen über das ganze Dokument aus dem Trace, S Schatten im Zug aus und
unbewegt, ruhende Schatten bleiben, nach dem Ablegen zurück an der neuen Stelle, hin- und zurückgezogen Bildpunkt
für Bildpunkt wie vorher (hell und dunkel), B leere Beschriftung im Zug weg und danach wieder oben, der Rahmen fängt
keinen Treffer. `M491_NUR=SB` führt nur einzelne Abschnitte aus (Fehlersuche).
Ruhezustand gegen den Stand vor M491: `node werkzeug/bild-vergleich.mjs <alt> dist` — 11 von 11 Ansichten
pixelgleich (Board hell/dunkel mit Verbindung, Auswahl, Fokus, Präsentation, Einstellungen, Telefon).
