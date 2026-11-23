# M494 — Farben lesbar auf jeder Fläche
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m494-farben-lesbar.mjs` (Port 5494) · Werkzeug: `werkzeug/kontrast-pruefen.mjs` (`randScan`, `fokusScan`) · Datum: 2026-11-23

## Warum
Offene Punkte aus M492: (1) Schrift- und Hintergrundfarben im Text (BlockNote) sind für helles Papier gemacht — auf
einer weißen Notiz bzw. einem Protokoll im Thema im Dunkeln stand Braun mit 1,8:1, Rot mit 3,6:1. (2) Auf frei
gewählten Farben stand fest weiße Schrift (Gantt-Balken, Kalender-Streifen) oder die Farbe selbst als Schrift
(Wochenplan) — in Hell UND Dunkel zu schwach. (3) Nicht-Text-Kontrast (Ränder von Feldern, Kästchen, Fokusringe;
WCAG 1.4.11) maß niemand.

## Was (Nutzersicht)
- **Editor-Farben auf dunklem Papier:** Jede der neun Farben hat eine Nachtstufe (Schrift hell und gedeckt,
  Hintergrund dunkel getönt). Gilt auf der weißen Notiz und der Notiz ohne Farbe im Dunkeln, im Protokoll im Thema im
  Dunkeln und im Protokoll mit dunkler eigener Farbe (auch im Hellen). Jede Kombination (Farbschrift auf Papier, auf
  jedem Hintergrund; Standardschrift auf jedem Hintergrund) ≥ 4,5:1 (gemessen min 4,83). **Im Hellen und auf
  farbigem Papier unverändert** (BlockNotes Farben). Die Muster der Farbwahl zeigen dort die Nachtstufe — so, wie
  die Farbe im Text steht.
- **Schrift auf freien Farben wählt sich selbst:** Gantt-Balken, Kalender-Streifen der Wochenansicht und farbige
  Termin-Titel im Tagesdialog, Wochenplan-Blöcke (Palette und freie Farben, samt Personen-Marke). Hell oder dunkel je
  nach Helligkeit der tatsächlich gezeichneten Fläche; farbige Titel behalten ihren Farbton und werden nur so weit
  abgedunkelt bzw. aufgehellt, bis sie lesbar sind. Beim Gantt-Fortschritt wird der erledigte Teil von der Schrift
  WEG verschoben (unter heller Schrift dunkler, unter dunkler heller), damit der Name auf beiden Teilen lesbar bleibt.
- **Zeiterfassung:** Pause einen Hauch dunkler (`#9c6f1c` → `#9a6d1b`): Weiß darauf 4,59:1 statt 4,46:1, als Schrift
  auf Weiß ebenso.
- **Felder in Fenstern** haben einen Rand ≥ 3:1 (vorher 1,25–1,85:1): Einstellungen, Hilfe-Suche, Aufgaben-Zentrale,
  Kalender-Tagesdialog, Wochenplan-Block, Gantt-Zeilenleiste, Eingang, Bubbles-Feld, „Ebene entfernen". Die
  Suchleiste (Strg+K) zeigt im Dunkeln keinen grauen Kasten mehr im Feld.

## Gefunden und behoben (vorher → nachher, gemessen mit der Reihe gegen den alten Build)
| Stelle | Vorher | Nachher |
|---|---|---|
| Editor-Farben, weiße Notiz dunkel (ruhend und im Editor) | Braun 1,84:1, Rot 3,62:1 u. a. | alle 99 Stellen ≥ 4,83:1 |
| dieselben im Protokoll (Thema dunkel / dunkle eigene Farbe hell) | 1,84:1 bzw. 1,7:1 | ≥ 4,83:1 |
| Gantt-Name auf Balken, hell | Weiß auf Pastell 1,22–3,16:1 | ≥ 5,58:1 |
| Gantt-Name auf Balken, dunkel | 1,81–4,17:1 | ≥ 4,81:1 |
| Kalender-Streifen (Woche) | Weiß auf Gelb 1,27:1 | ≥ 4,5:1 |
| Wochenplan: Palette Braun/Rot (beide Themes) | 3,75:1 / 4,35:1 | ≥ 4,5:1 |
| Wochenplan: freie Farbe dunkel, Personen-Marke | 1,3–2,4:1 | ≥ 4,5:1 |
| Kalender-Tagesdialog: farbiger Titel | 4,0–4,1:1 | ≥ 4,5:1 |
| Zeiterfassung Pause | 4,46:1 | 4,59:1 |
| Feldränder in 7 Fenstern | 1,25–1,85:1 | ≥ 3:1 |

Mit `PN_DIST=<alter Build>` sind in der Reihe 28 von 50 Prüfungen rot, mit dem neuen Build 0.

## Wie (Architektur)
- **Tokens** (`src/styles/00-tokens.css`): `--nacht-hl-<farbe>` / `--nacht-hl-<farbe>-grund` für grau, braun, rot,
  orange, gelb, gruen, blau, lila, rosa (in `:root`, weil die dunkle eigene Protokollfarbe auch im Hellen gilt);
  `--auf-farbe-hell|dunkel|schwarz` (Schrift auf freier Farbe); `--feld-rand` (hell `#80868f`, dunkel `#737983`,
  ≥ 3:1 auf `--bg`, `--surface`, `--surface-card`, `--surface-2`); `--zeit-pause(-schrift)` `#9a6d1b`.
- **Zuordnung** (`src/styles/60-dunkel-navigator-stift.css`, Block „M494: Editor-Farben auf dunklem Papier"):
  setzt `--bn-colors-highlights-*` auf die Nachtstufen in `.bn-root` unter weißer/farbloser Notiz (dunkel),
  `.minutes-card.papier-thema` (dunkel) und `.minutes-card.papier-dunkel`; dazu für die Notizen
  `--bn-colors-editor-text/-background` auf `--ink`/`--surface-card` (Farbwahl-Muster). Das ruhende Abbild
  (`NotizRuhend`) trägt selbst `.bn-root`, deshalb greift dieselbe Regel.
- **`src/lib/lesbareSchrift.ts`**: `lesbareSchrift(fläche, { grund, deckkraft })` → Token-CSS; `schriftArt(rgb)` →
  'hell' | 'dunkel' | 'schwarz' (Schwarz nur in der Mitte um Leuchtdichte 0,2, wo Weiß und Tinte beide knapp unter
  4,5:1 bleiben — Schwarz erreicht dort immer ≥ 4,58:1); `farbeAlsSchrift(farbe, grund | grund[])` behält den Farbton;
  `gezeichneteFlaeche`, `geschichteterGrund(['--surface', '--surface-dim'])`, `tokenFarbe`, `istHell`; `useThema()`
  (MutationObserver auf `data-theme`) zeichnet beim Themenwechsel neu. Klein, ohne Abhängigkeiten.
- **Gantt** (`GanttCard.tsx`): Balken 0,82 über `--surface` → `schriftArt` → `style.fill` am Innen-Namen
  (`data-schrift`), Fortschritts-Überzug je nach Schrift dunkel oder hell.
- **Kalender** (`CalendarCard.tsx` `streifenStil`): In der Wochenansicht steckt die Blässe in der Fläche
  (`color-mix(… 85 % bzw. 65 % extern …, var(--surface))`), nicht mehr in `opacity` (die verblasste die Schrift mit);
  CSS `.cal-grid.week .cal-strip { opacity: 1 }`. Monatsansicht unverändert (Streifen ohne Schrift).
- **Wochenplan** (`WeekCard.tsx` `blockSchrift`): Schrift = `farbeAlsSchrift(Blockfarbe, gezeichnete Blockfläche)`;
  Klasse `schrift-hell` legt die Personen-Marke dunkel unter helle Schrift; `.week-entry-time` ohne `opacity: .8`.
- **Werkzeug** (`werkzeug/kontrast-pruefen.mjs`): `randScan(page, sel)` — Eingabefelder, Auswahllisten, Textfelder,
  Schalter, Kästchen: das Stärkste aus Rand, eigener Fläche und Ring (box-shadow ohne Unschärfe) gegen den Grund
  außerhalb; Felder ganz ohne Rand und Fläche zählen nicht (stehen wie Text da); weggescrollte Elemente
  (elementFromPoint) zählen nicht; native Kästchen/Optionsfelder/Regler über die Bildpunkte (kräftigster Punkt gegen
  den Grund). `fokusScan(page, sel)` drückt Tab und misst den Ring des fokussierten Elements (Umriss, Ring, sonst
  Rand); Übergänge werden vorher beendet (`getAnimations().finish()`), sonst misst man den Zustand vor dem Fokus.
  Von Hand `--rand` / `--fokus`. Regel 9 in `docs/AGENTEN.md` ergänzt.
- **m492**: Ausnahmeliste gestrichen (Kalender-Streifen, Gantt-Balken) — grün ohne Ausnahmen. **m273** (T2d) erkennt
  den Fortschritts-Überzug in beiden Fassungen.
- **Bildvergleich** (`werkzeug/bild-vergleich.mjs`, alter Build gegen neuen): alle 11 Ansichten pixelgleich (Board
  hell/dunkel, Auswahl, Fokus, Präsentation, Einstellungen hell/dunkel, Telefon) — Hell und farbiges Papier unverändert.

## Grenzen / offen
- **Im Hellen bleiben BlockNotes Farben** (Vorgabe „Hell unverändert"): Grau 2,8:1, Gelb 2,1:1, Orange 3,3:1, Rot
  4,3:1 als Schrift auf Weiß; auf den hellen Hintergründen teils noch weniger. Eigene Hellstufen wären ein eigener
  Schritt (sichtbare Änderung bestehender Notizen).
- **Dunkle eigene Protokollfarbe:** Die Nachtstufen halten auf sehr dunklem Papier (geprüft `#1f2a44`). Auf einer
  mitteldunklen eigenen Farbe (Leuchtdichte knapp unter 0,18, die Grenze von `papierArt`) reicht der Kontrast für
  farbige Schrift nicht immer.
- **Ränder:** nur die Felder in Fenstern (siehe oben) haben `--feld-rand`; Felder IN Karten, die erst beim Darüberfahren
  einen Rand zeigen (Zeiterfassung, Tabelle), sind bewusst randlos und zählen wie Text. Native Kästchen zeichnet der
  Browser (≥ 3,7:1 gemessen). Fokusringe: überall `--accent` (≥ 3,7:1 hell, ≥ 4,4:1 dunkel).
- Der Text-Scan berücksichtigt `opacity` eines Elements nicht (nur ganz unsichtbar); verblasste Inhalte (z. B. Tage
  außerhalb des Monats im Kalender, 0,38) misst er zu gut.
