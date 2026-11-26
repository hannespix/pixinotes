// M547: Die Wortmarke im Design „Agency" (nach vave.log) atmet — in den Gesten des vave-Logos (vave.log src/web/Logo.tsx).
//
// vave.log spielt sein Logo mit Lottie: die Buchstaben schwellen an und ab (Formmorph), „gescrubbt" in drei Gesten —
// langer, ruhiger Atem · Doppelwelle · kleine Wellen. Jede Geste beginnt und endet bei 0, die nächste ist nie dieselbe,
// die Dauern schwanken um 0,9–1,2. Hier dieselbe Rhythmik ohne Lottie: Die Lage 0…1 wird zum Gewicht der variablen
// Schrift (Readex Pro, 560…700) und darüber hinaus zu einer feinen Kontur in Schriftfarbe (bis 0,04 em) — so schwillt
// das Wort wie im vave-Logo über den fettesten Schnitt hinaus. Jeder Buchstabe folgt der Lage mit kurzem Versatz, die
// Schwellung läuft als Welle durch „PIXI". Jeder Buchstabe hat eine feste Breite (gemessen beim fettesten Schnitt), damit nichts daneben
// verrutscht: Je Bild ändert sich nur das Gewicht von vier Zeichen.
//
// Leistung (M491/M525/M535): rechnet nur, wenn die Marke zu sehen ist — nicht im verdeckten Tab, nicht außerhalb des
// Bildes (Fokus-Modus blendet sie aus), nicht während eines Zugs auf dem Board. In den Haltephasen der Gesten (bis
// knapp 6 s) läuft kein Bild-Takt, sondern ein einziger Zeitgeber. `prefers-reduced-motion` und „Besser lesbar"
// (Atkinson hat keine Zwischenstufen): steht still in der Ruhelage. Nachgeladen — nur im Design Agency.
import { zugBeobachten, zugLaeuft } from './zugAnzeige';

type Geste = readonly (readonly [lage: number, ms: number])[];
// Wie in vave.log: Ziel-Lage und Dauer je Abschnitt
const GESTEN: readonly Geste[] = [
  [[0, 1200], [1, 4200], [1, 900], [0, 5800], [0, 2100]],                          // langer, ruhiger Atem
  [[0.66, 3600], [0.25, 2600], [1, 4600], [1, 700], [0, 5700], [0, 2200]],         // Doppelwelle
  [[0.42, 3400], [0.08, 2400], [0.78, 4300], [0.38, 2800], [0, 3900], [0, 2600]],  // kleine Wellen
];
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
/** Gewicht in der Ruhelage und auf dem Gipfel (Readex Pro kann 160…700) */
export const LEICHT = 560;
export const SCHWER = 700;
/** zusätzliche Kontur auf dem Gipfel (em) — schwillt über den fettesten Schnitt hinaus */
const KONTUR = 0.04;
/** Versatz je Buchstabe — die Schwellung läuft von links nach rechts durch das Wort */
const VERSATZ = 170;
/** Laufweite: vave.log setzt seine Wortmarke eng (−0,09 em) — von der gemessenen Breite abgezogen */
const ENG = 0.06;

export function logoBewegen(wort: HTMLElement): () => void {
  const buchstaben = [...wort.querySelectorAll<HTMLElement>('.agency-b')];
  const reduziert = window.matchMedia('(prefers-reduced-motion: reduce)');
  const verzug = VERSATZ * Math.max(0, buchstaben.length - 1);
  let aus = false;
  let imBild = !('IntersectionObserver' in window);
  let raf: number | undefined;
  let zeitgeber: ReturnType<typeof setTimeout> | undefined;
  let zuletzt: number | undefined;
  let variante = 0;
  let abschnitt = 0;
  let vergangen = 0;
  let von = 0;
  let lage = 0;
  let geaendert = 0;
  const gewicht = buchstaben.map(() => -1);
  // Verlauf der Lage für die nachlaufenden Buchstaben: [Zeit, Lage]
  const verlauf: [number, number][] = [];
  const zeiten = () => GESTEN[variante].map(([l, ms]) => [l, ms * (0.9 + Math.random() * 0.3)] as const);
  let folge = zeiten();

  const setzen = (i: number, l: number) => {
    // in Stufen von 1/280: genau ein Gewichtsschritt — feiner sieht man nicht, gröber ruckelt es
    const stufe = Math.round(l * 280);
    if (stufe === gewicht[i]) return;
    gewicht[i] = stufe;
    const b = buchstaben[i].style;
    b.fontWeight = String(Math.round(LEICHT + ((SCHWER - LEICHT) * stufe) / 280));
    b.setProperty('-webkit-text-stroke', stufe ? `${((KONTUR * stufe) / 280).toFixed(4)}em currentColor` : '');
  };
  const lageVor = (t: number): number => {
    for (let k = verlauf.length - 1; k >= 0; k -= 1) if (verlauf[k][0] <= t) return verlauf[k][1];
    return verlauf.length ? verlauf[0][1] : lage;
  };
  const zeichnen = (jetzt: number) => {
    verlauf.push([jetzt, lage]);
    while (verlauf.length > 2 && verlauf[1][0] < jetzt - verzug - 200) verlauf.shift();
    buchstaben.forEach((_, i) => setzen(i, lageVor(jetzt - i * VERSATZ)));
  };
  const ruhelage = () => { lage = 0; von = 0; abschnitt = 0; vergangen = 0; verlauf.length = 0; buchstaben.forEach((_, i) => setzen(i, 0)); };

  /** Feste Breite je Buchstabe (beim fettesten Schnitt gemessen, in em — wächst mit der Schriftgröße mit) */
  const messen = () => {
    const gross = parseFloat(getComputedStyle(wort).fontSize) || 22;
    for (const [i, b] of buchstaben.entries()) {
      b.style.width = '';
      b.style.fontWeight = String(SCHWER);
      const breite = b.getBoundingClientRect().width;
      b.style.width = `${Math.max(0.3, breite / gross - ENG).toFixed(3)}em`;
      b.style.fontWeight = String(Math.round(LEICHT + ((SCHWER - LEICHT) * Math.max(0, gewicht[i])) / 280));
    }
  };

  const still = () => reduziert.matches || document.documentElement.dataset.lesbar === 'an';
  const darf = () => !aus && imBild && !document.hidden && !still() && !zugLaeuft();
  const anhalten = () => {
    if (raf !== undefined) cancelAnimationFrame(raf);
    if (zeitgeber !== undefined) clearTimeout(zeitgeber);
    raf = undefined; zeitgeber = undefined; zuletzt = undefined;
  };
  const takt = (jetzt: number) => {
    raf = undefined;
    if (!darf()) { zuletzt = undefined; return; }
    // Ein verdeckter Tab oder ein hängendes Bild spult die Marke nicht vor (wie in vave.log)
    if (zuletzt !== undefined) vergangen += Math.min(jetzt - zuletzt, 100);
    zuletzt = jetzt;
    while (vergangen >= folge[abschnitt][1]) {
      vergangen -= folge[abschnitt][1];
      von = folge[abschnitt][0];
      abschnitt += 1;
      if (abschnitt === folge.length) {
        // eine der beiden anderen Gesten — nie dieselbe gleich noch einmal
        variante = (variante + 1 + Math.floor(Math.random() * (GESTEN.length - 1))) % GESTEN.length;
        folge = zeiten();
        abschnitt = 0;
      }
    }
    const [nach, dauer] = folge[abschnitt];
    const neu = von + (nach - von) * ease(vergangen / dauer);
    if (Math.abs(neu - lage) > 0.0005) geaendert = jetzt;
    lage = neu;
    zeichnen(jetzt);
    // Haltephase und alle Buchstaben angekommen: bis zu ihrem Ende ruhen statt jedes Bild zu rechnen
    const rest = dauer - vergangen;
    if (nach === von && jetzt - geaendert > verzug + 40 && rest > 150) {
      zeitgeber = setTimeout(() => { zeitgeber = undefined; vergangen += rest; zuletzt = undefined; weiter(); }, rest);
      return;
    }
    raf = requestAnimationFrame(takt);
  };
  const weiter = () => { if (raf === undefined && zeitgeber === undefined && darf()) raf = requestAnimationFrame(takt); };
  const abgleichen = () => {
    anhalten();
    if (still()) ruhelage();
    weiter();
  };

  const beobachter = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { imBild = e.isIntersecting; abgleichen(); }) : undefined;
  beobachter?.observe(wort);
  const attribute = new MutationObserver(abgleichen);
  attribute.observe(document.documentElement, { attributes: true, attributeFilter: ['data-lesbar'] });
  const zugAbo = zugBeobachten(abgleichen);
  const schrift = () => { if (!aus) messen(); };
  reduziert.addEventListener('change', abgleichen);
  document.addEventListener('visibilitychange', abgleichen);
  document.fonts?.addEventListener?.('loadingdone', schrift);
  ruhelage();
  messen();
  void document.fonts?.load?.(`${SCHWER} 22px "PN Readex"`).then(schrift, () => {});
  abgleichen();

  return () => {
    aus = true;
    anhalten();
    beobachter?.disconnect();
    attribute.disconnect();
    zugAbo();
    reduziert.removeEventListener('change', abgleichen);
    document.removeEventListener('visibilitychange', abgleichen);
    document.fonts?.removeEventListener?.('loadingdone', schrift);
  };
}
