# M501 — Pixi, das Maskottchen, als Karte: Augen folgen dem Zeiger, nie langweilig
PR: #… · Prüfreihe: `pruefungen/m501-maskottchen.mjs` (Port 5501) · Datum: 2026-11-23

## Warum
Nutzerwunsch: „gerne auch das pixi Maskottchen … und pix-el.de … also kleines Maskottchen zum hinzufügen. Es soll mit
seinen Augen Maus/touch verfolgen und lustige kleine abwechslungsreiche Animationen ausführen, dass es nie langweilig
wird es anzuschauen.“ Die Figur ist „Pix“ aus dem eigenen Repo `hannespix/pix-el` (`site/icons.js`, `MASCOT`) —
eigenes Werk des Nutzers, Übernahme erwünscht, Herkunft im Dateikopf von `lib/pixiBild.ts` genannt.

## Was
- Neuer Kartentyp `pixi` unter ＋ → **Ordnen → Pixi** (Suchwörter u. a. „maskottchen“, „figur“). Rahmenlos wie ein
  Bild (M374), quadratisch, an den Griffen frei skalierbar mit festem Seitenverhältnis. Die Figur steht in einem
  Vielfachen von 48 Bildschirm-Pixeln (ganze Pixel je Rasterpunkt), gezeichnet mit `crispEdges`.
- **Augen folgen Maus und Finger** über das ganze Board (nicht nur über der Karte): fünf Lagen je Achse im
  verdoppelten Raster; ganz nah schaut Pixi geradeaus, bei Touch zum letzten Berührpunkt. Kommt vier Sekunden kein
  Zeiger, schaut er selbst irgendwohin (zur Seite, nach unten, schräg hoch).
- **20 Animationen**, zufällig gewichtet, nie zweimal dieselbe hintereinander, 2,2–7 s Pause dazwischen:
  - von selbst (13): blinzeln, doppelt blinzeln, umsehen, hüpfen, Freudensprung (Ärmchen hoch), winken, niesen
    (Puff), Antenne funkelt, tanzen (Ärmchen und Noten), Kopf schief, pfeifen (Noten), staunen, gähnen;
  - als Reaktion (7): Herzchen (Klick/Tipp – im Wechsel mit Freudensprung, Winken, Kichern), kichern (schnelles
    Hin-und-her über ihn), schwindelig (schnelle Kreise: Spiralaugen, Sterne, Taumeln), erschrecken (plötzlich ganz
    nah: große Augen, „!“), einschlafen → schlafen (Zzz, langsames Atmen) nach 45 s Ruhe, aufwachen, wenn der Zeiger
    nah kommt oder getippt wird (ferne Bewegung weckt nicht).
  - Im Ruhezustand atmet er (1 Pixel Wippen); Schatten unter den Füßen wird beim Sprung schmaler.
- **Unter der markierten Figur** (M421, nur im Fokus): fünf Körperfarben + Standard, Mond = „Schlafen erlauben“, Name
  per Doppelklick als Unterschrift.
- **Hell/Dunkel**: Körper bleibt hell mit dunkler Kontur (wie pix-el); Arme, Zzz und Noten stehen neben dem Körper
  auf dem Board-Grund und werden im Dunkeln hell. Eigene Körperfarbe wählt die Kontur über `istHell`.
- Präsentation: Pixi lebt auf der Folie (`slide-pixi`). Export (HTML, Zwischenablage, E-Mail): Standbild als SVG.
  Suche/KI lesen „Maskottchen Pixi“ (+ Name); im Sync stehen nur die Optionen `name`, `farbe`, `schlafen`.

## Wie (Architektur)
- `lib/pixiBild.ts` (ohne JSX): `MASCOT` aus pix-el, alle Zahlen verdoppelt (`doppelt`), `pfad(zeilen, ox, oy)` wie
  `iconPath`; `TEILE` mit Körper, Kontur, Wangen, Spitze, Schatten, acht Augenformen (offen, zu, froh, halb, groß,
  Herz, Spirale, kneifen; rechts gespiegelt), sieben Mündern, Armen (schräg, gerade, unten) und Effekten (Zzz, Noten,
  Herzen, Funken, „!“, Puff, Sterne, Kichern). `ANSICHT` = viewBox −8 −16 48 48. `PIXI_FARBEN`, `pixiFarbe` (nur
  `#rrggbb`), `pixiSvgText`/`pixiBildAdresse` fürs Standbild.
- `lib/pixiVerhalten.ts`: `PIXI_ANIMATIONEN` (Dauer, Gewicht, ruhig, augen, mund, arme, effekt, eigenerBlick),
  `PixiHirn` (Zustandsmaschine mit eingespeister Uhr und Zufall; `schritt()` liefert die ms bis zum nächsten Aufruf,
  `aktivitaet`, `nah`, `tippen`, `reaktion`, `optionen`), `blickZu`, Gesten `istKitzeln`, `istKreisen`,
  `istPloetzlichNah`. Konstanten `SCHLAF_NACH` 45 s, `PAUSE_MIN/MAX`, `BLICK_RUHE_NACH` 4 s.
- `lib/pixiZeiger.ts`: EIN `pointermove`/`pointerdown`-Listener (capture, passiv) für alle Pixis, Ring der letzten 128
  Punkte, `requestAnimationFrame` nur bei Bewegung und nur, wenn ein Abonnent `aktiv()` ist.
- `components/nodes/PixiCard.tsx` (nachgeladen, Chunk `PixiCard-…`): `PixiFigur` zeichnet das SVG einmal; `beleben()`
  setzt `data-anim/-augen/-mund/-arme/-effekt/-schlaf` und `--pixi-d` direkt am DOM (kein React-Render je
  Animation), `transform` der Augengruppe nur bei Änderung, EIN `setTimeout`. `IntersectionObserver` +
  `visibilitychange` → `data-ruht` (Zeitgeber aus, CSS pausiert). `prefers-reduced-motion` → nur Blinzeln.
- CSS `src/styles/79-maskottchen.css`: Formen per `display` je data-Attribut, alle Bewegungen als `steps`-Keyframes,
  `data-ruht` pausiert, Media-Query für reduzierte Bewegung. Tokens `--pixi-*` (hell/dunkel) in `00-tokens.css`.
  `.pixi-tools` in den vier M421-Listen.
- Registrierung: `types.ts` (`PixiData`, `PixiNode`), `lib/nodes.ts` (`makePixi`), `Board.tsx` (`KARTEN_LADER.pixi`),
  `Dock.tsx`, `KartenSymbol.tsx`/`Icons.tsx` (`IPixi`, `IMond`), `FocusSheet`, `Overview`, `VersionenDialog`,
  `Presenter.tsx`, `serialize.ts` (Text/HTML), `kiModule.ts` (lesen, `TYP_WORTE`), `sicher.ts` (Farbe nur Hex).

## Prüfung
`m501` misst die Augenlage (Anker-Rechteck relativ zum Körper) in vier Richtungen und nah, Touch-Tipps, Klick,
Kitzeln, Kreisen, Erschrecken; mit Playwrights beschleunigter Uhr 10 Minuten Verhalten (≥ 12 verschiedene, keine
Wiederholung, Pausen), Schlafen/Aufwachen, reduzierte Bewegung; zählt rAF aus dem Pixi-Chunk (keine Dauerschleife,
außerhalb des Bildes und bei verdecktem Tab null), Bildzeit und DOM-Mutationen beim Ziehen einer Karte; Optionen
über das Neuladen; Bilder hell/dunkel und ein Kontaktbogen der Zustände in `pruefungen/ablage/`.

## Grenzen / offen
- Die Iris-Seite (Tailnet) war aus der Umgebung nicht erreichbar; die Figur folgt pix-el.
- Kein KI-Werkzeug zum Anlegen („leg einen Pixi an“) und kein MCP-Werkzeug — bewusst, es ist Schmuck.
- Reaktionen auf Gesten dürfen sich wiederholen (zweimal kitzeln = zweimal kichern); „nie zweimal dasselbe“ gilt für
  den Zufall und für Klicks.
