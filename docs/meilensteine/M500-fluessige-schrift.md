# M500 — Flüssige Schrift: ein kurzer Text als Flüssigkeit (Liquid Type als Karte)
PR: #191 · Prüfreihe: `pruefungen/m500-fluessige-schrift.mjs` (Port 5500) · Datum: 2026-11-23

## Warum
Wunsch des Nutzers: „Schau dir die liquid type engine im entsprechenden repository an … Ich hätte gerne eine einfache
liquid type Schrift als extra Modul in pixinotes.“ Liquid Type (github.com/hannespix/liquidtype) ist ein eigenes Werk
des Nutzers: Schrift als 2D-Flüssigkeit mit WebGL2-Oberfläche. pix·el bettet es bereits als Modul ein
(`site/liquid/`); hier wird es zur Karte.

## Was
- Neuer Kartentyp `fluessig` unter ＋ → **Ordnen → Flüssige Schrift** (Suchwörter u. a. „liquid“, „tropfen“,
  „überschrift“). Startet mit „Hallo“, 440 × 220, feste Größe (Auto-Größe aus).
- Beim Erscheinen setzt sich die Schrift aus verstreuten Tropfen zusammen. Die Maus über der Karte schubst die
  Flüssigkeit, über der Schrift zieht sie sie wie ein Magnet an. **Markiert** (oder im Fokus, auf der Folie) zieht ein
  Druck die Flüssigkeit mit, **gedrückt halten** lässt sie platzen, sie findet wieder zusammen. Unmarkiert zieht ein
  Druck wie überall die Karte (die Fläche bekommt `nodrag` erst mit der Markierung).
- Bedienung nur im Fokus (M421): Textfeld (bis 32 Zeichen, wie im Original), Zähigkeit „Flüssig / Mittel / Zäh“,
  **Akzent** (Flüssigkeit in `--accent-strong` statt `--ink`), **Lebendig** (Tropfen fallen, eine unsichtbare Hand
  bewegt die Oberfläche — aus als Standard, weil es Rechenzeit kostet, solange die Karte zu sehen ist).
- Farbe aus Tokens, folgt Hell/Dunkel und dem Akzent sofort; die Schriftart folgt der Karte (Schrift-Wahl M200),
  ohne Wahl Georgia wie im Original. Langer Text bricht am Leerzeichen nahe der Mitte in zwei Zeilen um, wenn das die
  Schrift deutlich größer macht.
- Präsentation: die Karte lebt auf der Folie (anfassen, platzen lassen). Suche, Export (Text/HTML/Markdown) und KI
  lesen den Text; der MCP-Server liest ihn über dieselbe Stelle (`kiModule.lesen`).
- Ohne WebGL2: der Text als normale Schrift mit „Flüssig nur mit WebGL2 – hier als normale Schrift.“
- Reduzierte Bewegung (Systemeinstellung): ruhend gezeichnet, keine Animation, kein Takt.

## Wie (Architektur)
- **Engine** `src/lib/fluessig/` — übernommen aus Liquid Type (Herkunft im Kopf jeder Datei, Stand 02.10.2026), nach
  TypeScript übertragen, Rechnung unverändert:
  - `physik.ts` (`Fluid`, src/physics.mjs), `effekte.ts` (Zusammensetzen, Platzen, Tropfen, Ruhe, `Settle`,
    `idleHand`, dazu `maxAbstand`), `glyphen.ts` (`sampleGlyphs`), `qualitaet.ts` (`createQuality`, eigener
    sessionStorage-Schlüssel `pixinotes-fluessig-qualitaet`, ohne `?quality=`).
  - `zeichner.ts` (`Zeichner`, src/render.mjs): dieselben Shader, aber **ein WebGL2-Kontext für alle Karten** (Browser
    erlauben ~16): je Karte ein `Ziel` (Materialtextur + Dichtefeld + FBO); gezeichnet wird reihum in eine gemeinsame,
    unsichtbare Fläche (wächst nur) und im selben Durchlauf per `drawImage` in die 2D-Fläche der Karte kopiert.
    Die Oberfläche liefert **vormultiplierte Tinte mit Deckung** statt `mix(paper, ink)` — durchsichtig auf jeder
    Kartenfarbe.
  - `motor.ts`: Ablauf. EIN `requestAnimationFrame`-Takt für alle Karten, nur solange eine läuft (`wecken()` fragt
    erst `willLaufen()`); `MAX_AKTIV = 3` Karten rechnen gleichzeitig (die zuletzt berührten), weitere stehen bis
    dahin still. Ruhe-Erkennung (kein Druck, keine Einschwingphase, nichts Lebendiges, mittlere Geschwindigkeit < 6 px/s,
    alle Teilchen fast am Platz, 500 ms lang) → ein letztes scharfes Bild (`calm = 1`), dann schläft die Fläche.
    `IntersectionObserver` je Fläche (außerhalb: kein Takt), `visibilitychange` (verdeckt: Takt aus, Druck los),
    `MutationObserver` auf `data-theme`/`data-accent` (Tinte neu lesen), `prefers-reduced-motion`. Werte: `FX` und
    `GRUND` vom Sweet Spot der MS-Seite (Zähigkeit 0,55, Spannung 0,7, Anziehung 0,85, Impuls 1,8); „Flüssig“ und
    „Zäh“ verschieben nur Zähigkeit/Spannung/Anziehung. Teilchenbudget nach Fläche (500…2 400) × Qualitätsregler.
    Für Prüfreihen: `window.pixinotesFluessig = { takte, laufend, flaechen }`, `canvas.__fluessig.zustand()`.
- `src/lib/fluessigDaten.ts` (leicht, ohne Engine): `FluessigData { text, zaeh?, farbe?, lebendig? }`,
  `fluessigText` (Steuerzeichen raus, 32 Zeichen), `fluessigDaten` (fremde Daten in Form). Gespeichert, abgeglichen
  und exportiert wird nur das — nie der Simulationszustand; normale Karten-Zusammenführung reicht.
- `src/components/nodes/FluessigCard.tsx`: `FluessigBuehne` (Canvas, holt `motor` per `import()` erst beim ersten
  Sichtbarwerden, `ResizeObserver` → `groesse`, Text-Änderungen 130 ms gesammelt) und `FluessigCard` (CardShell +
  `.fl-werkzeuge`). Registrierung: `types.ts` (`FluessigNode`), `lib/nodes.ts` (`makeFluessig`), `Board.tsx`
  (`KARTEN_LADER.fluessig`), `Dock.tsx`, `Icons.tsx` (`IFluessig`), `KartenSymbol.tsx`, Namen in `FocusSheet.tsx`,
  `Overview.tsx`, `VersionenDialog.tsx`; `Presenter.tsx` (`EDITABLE`, `slide-fluessig`); `serialize.ts` (Text, HTML,
  Markdown); `kiModule.ts` (`lesen`).
- CSS: neue Teildatei `src/styles/67-fluessige-schrift.css`; `.fl-werkzeuge` in allen Listen von
  `99-bedienung-im-fokus.css`.
- Start-JS unverändert unter der Grenze von M483: die Karte ist ein Nachlade-Teil (`FluessigCard-*.js`), die Engine
  ein eigener (`motor-*.js`) und kommt erst mit einer sichtbaren Karte. Die Ein-Datei-Fassung bettet beide ein.

## Leistung (gemessen in der Prüfreihe, Software-Grafik SwiftShader, 1280 × 800)
Unter ständiger Mausbewegung: 1 Karte ~55 Bilder/s, 4 Karten ~31 Bilder/s (davon höchstens 3 rechnend). In Ruhe
0 Takte; außerhalb des Bildes, bei verdecktem Tab und bei reduzierter Bewegung ebenfalls 0.

## Grenzen / offen
- Kein Mauszeiger-Tropfen (`cursor.mjs`) und kein Bewegungssensor (`sensors.mjs`) — bewusst „einfach“.
- Die Zeichenauflösung folgt `devicePixelRatio`, nicht dem Board-Zoom: stark hineingezoomt wird die Kante weicher.
- Keine KI-Operation zum Anlegen (nur Lesen); keine Kachel (die Karte ist selbst klein).
- Die Engine-Dateien sind eine Übernahme — Änderungen an Physik und Shadern besser im Liquid-Type-Repo pflegen und
  hierher kopieren.
