// M548: Das Zeichen im Design „Agency" — „PX" mit zwei i-Punkten, über das schwarzes Wasser läuft.
//
// Das Zeichen: ein geometrisches „P" und ein „X", dessen beide oberen Arm-Enden abgetrennt sind. Die abgetrennten
// Stücke stehen wie i-Punkte über dem X — man liest „P-i-X-i". Eigene Pfade (Einheiten: Versalhöhe 100, Strich 20),
// keine Schrift. Klassisch und pix·el kennen es nicht; dieses Modul wird nur im Design Agency nachgeladen.
//
// Die Bewegung (Wunsch des Besitzers: „als würde die Schrift mit schwarzem Wasser mit viel Oberflächenspannung benetzt
// und wieder dünner werden, wobei dann das Wasser an eine andere Stelle fließt", Vorbild vave.studio): Ein Wasserkörper
// aus acht Kreisen wandert über das Gerüst der Striche (Mittellinien als Graph). An einer Haltestelle zieht er sich zu
// einem runden, satten Tropfen zusammen, der am Strich hängt und nachzittert; dann zieht der Kopf los, der Körper wird
// lang und dünn (ein laufender Tropfen mit dünner Spur), bis er an der nächsten Stelle wieder zusammenläuft. Über die
// Lücke zum i-Punkt spannt er eine Brücke und lässt den Punkt volllaufen; unter dem Fuß des P hängt ein Tropfen, der
// fast abreißt und zurückschnellt; zwischen den Buchstaben rollt er als Perle über die Grundlinie.
//
// Technik: kein Lottie. Lottie kann Formen nur nach vorgezeichneten Bildern morphen; das Verschmelzen zweier Flüssigkeiten
// (Hals, Brücke, Abreißen) ist dort Handarbeit je Bild — und kostete ~70 kB Bibliothek. Hier verschmilzt ein SVG-Filter
// („Goo"/Metaballs) Kreise und Zeichen: weichzeichnen, dann die Deckkraft hart bei 50 % schneiden — wo zwei Formen nahe
// sind, wächst ein runder Hals wie bei Wasser mit Oberflächenspannung. Damit das trockene Zeichen dabei genau bleibt
// (sonst liefen Winkel, Punze und die Lücke zu den i-Punkten zu), wirkt der Goo nur in der Nähe des Wassers: Das Zeichen
// ist rot gemalt, das Wasser grün darüber; der Filter liest daraus, wo Wasser ist (Deckkraft − Rot), dehnt es weich und
// gewichtet die weiche Form damit, BEVOR er schneidet — eine einzige Schwelle, also scharfe Kanten ohne Säume, und der
// Hals läuft zum Rand der Nähe sanft aus. Darüber liegt das scharfe Original (Zeichen und Kreise). Ergebnis in Tinte
// (`currentColor`), hell und dunkel.
//
// Leistung (M491/M525/M535): gerechnet wird nur, wenn das Zeichen zu sehen ist — nicht im verdeckten Tab, nicht außerhalb
// des Bildes, nicht während eines Zugs. Je Bild ändert sich ein Attribut (das Wasser ist ein Pfad), höchstens 30 Bilder je Sekunde. Hält der Tropfen still, ruht der
// Takt bis zum Ende der Haltezeit (ein Zeitgeber). `prefers-reduced-motion` und „Besser lesbar": das reine Zeichen ohne
// Filter und ohne Wasser.
import { zugBeobachten, zugLaeuft } from './zugAnzeige';

const NS = 'http://www.w3.org/2000/svg';
/** Weichzeichner des Goo (Einheiten): bestimmt, wie weit der Hals zwischen Wasser und Strich reicht */
const SIGMA = 5.5;
/** Weichzeichner der Nähe (Einheiten): wie weit um das Wasser herum der Goo wirkt */
const NAH = 8;
/** Breite des Zeichens in Einheiten (Versalhöhe 100) */
export const BREITE = 171;

/** P mit Bauch (Punze als zweiter Pfad, evenodd) */
const P_PFAD = 'M0 0H40A31 31 0 0 1 40 62H20V100H0ZM20 20V42H40A11 11 0 0 0 40 20Z';
/** X: zwei Arme (unten), zwei i-Punkte (oben, abgetrennt durch eine Lücke von y 17 bis 26) — alle im Uhrzeigersinn,
 *  damit sich die Arme in der Mitte vereinigen (nonzero). Arm-Neigung 0,63, waagrechte Breite 25 (quer gemessen 21). */
const X_PFAD = 'M83 100L129.62 26H154.62L108 100Z'
  + 'M99.38 26H124.38L171 100H146Z'
  + 'M135.29 17L146 0H171L160.29 17Z'
  + 'M83 0H108L118.71 17H93.71Z';

type Punkt = readonly [x: number, y: number];
/** Knoten des Strich-Gerüsts (Mittellinien) */
const KNOTEN: Record<string, Punkt> = {
  ecke: [10, 10], bauchOben: [40, 10], bauch: [61, 31], bauchUnten: [40, 52], ansatz: [10, 52], fuss: [10, 94],
  fussA: [99.28, 94], mitte: [127, 50], armA: [139.6, 30], punktA: [153.15, 8.5], armB: [114.4, 30], punktB: [100.86, 8.5],
  fussB: [154.72, 94],
};
const bogen = (a0: number, a1: number): Punkt[] => {
  const p: Punkt[] = [];
  for (let k = 0; k <= 12; k += 1) { const a = a0 + ((a1 - a0) * k) / 12; p.push([40 + 21 * Math.cos(a), 31 + 21 * Math.sin(a)]); }
  return p;
};
/** Kanten: [von, nach, Zwischenpunkte, Boden] — Boden: die Perle rollt über die Grundlinie */
const KANTEN: readonly (readonly [string, string, Punkt[], boolean?])[] = [
  ['ecke', 'bauchOben', []], ['bauchOben', 'bauch', bogen(-Math.PI / 2, 0).slice(1, -1)], ['bauch', 'bauchUnten', bogen(0, Math.PI / 2).slice(1, -1)],
  ['bauchUnten', 'ansatz', []], ['ecke', 'ansatz', []], ['ansatz', 'fuss', []],
  ['fuss', 'fussA', [[16, 96.5], [93, 96.5]], true],
  ['fussA', 'mitte', []], ['mitte', 'armA', []], ['armA', 'punktA', []], ['mitte', 'armB', []], ['armB', 'punktB', []], ['mitte', 'fussB', []],
];

/** Haltestellen: wohin der Tropfen ausweicht (vom Strich weg) und wie groß er wird; `tropfen`: hängt und zieht nach unten */
type Halt = { knoten: string; weg: Punkt; r: number; tropfen?: boolean };
const HALTE: Record<string, Halt> = {
  bauch: { knoten: 'bauch', weg: [7, 0], r: 17 },
  fuss: { knoten: 'fuss', weg: [0, 8], r: 14, tropfen: true },
  fussA: { knoten: 'fussA', weg: [-4, 6], r: 15 },
  punktA: { knoten: 'punktA', weg: [1, -3], r: 15 },
  mitte: { knoten: 'mitte', weg: [0, 0], r: 20 },
  punktB: { knoten: 'punktB', weg: [-1, -3], r: 15 },
  fussB: { knoten: 'fussB', weg: [4, 6], r: 15 },
  ecke: { knoten: 'ecke', weg: [-5, -5], r: 16 },
};
/** Die Runde: Bauch → Fuß (Tropfen) → über den Boden zum X → rechter i-Punkt → Mitte → linker i-Punkt → Fuß rechts → zurück */
const RUNDE = ['bauch', 'fuss', 'fussA', 'punktA', 'mitte', 'punktB', 'fussB', 'ecke'];

/** Anzahl Kreise des Wasserkörpers; Kopf = letzter */
const N = 8;
const ease = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * x * (x * (x * 6 - 15) + 10); };
const glatt = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

type Weg = { x: Float32Array; y: Float32Array; s: Float32Array; boden: Float32Array; laenge: number };

/** Kürzester Weg zwischen zwei Knoten über das Gerüst, fein abgetastet (alle ~2 Einheiten) */
function wegFinden(von: string, nach: string): Weg {
  const nachbarn = new Map<string, { zu: string; punkte: Punkt[]; boden: boolean }[]>();
  for (const [a, b, mitte, boden] of KANTEN) {
    const hin = [KNOTEN[a], ...mitte, KNOTEN[b]];
    (nachbarn.get(a) ?? nachbarn.set(a, []).get(a)!).push({ zu: b, punkte: hin, boden: !!boden });
    (nachbarn.get(b) ?? nachbarn.set(b, []).get(b)!).push({ zu: a, punkte: [...hin].reverse(), boden: !!boden });
  }
  const laengeVon = (p: Punkt[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
  const dist = new Map<string, number>([[von, 0]]);
  const zurueck = new Map<string, { von: string; punkte: Punkt[]; boden: boolean }>();
  const offen = new Set(Object.keys(KNOTEN));
  while (offen.size) {
    let u = ''; let best = Infinity;
    for (const k of offen) { const d = dist.get(k) ?? Infinity; if (d < best) { best = d; u = k; } }
    if (!u || u === nach) break;
    offen.delete(u);
    for (const n of nachbarn.get(u) ?? []) {
      const d = best + laengeVon(n.punkte);
      if (d < (dist.get(n.zu) ?? Infinity)) { dist.set(n.zu, d); zurueck.set(n.zu, { von: u, punkte: n.punkte, boden: n.boden }); }
    }
  }
  const stuecke: { punkte: Punkt[]; boden: boolean }[] = [];
  for (let k = nach; k !== von; k = zurueck.get(k)!.von) stuecke.unshift(zurueck.get(k)!);
  const xs: number[] = []; const ys: number[] = []; const ss: number[] = []; const bs: number[] = [];
  let s = 0;
  const dazu = (p: Punkt, b: number) => {
    if (xs.length) s += Math.hypot(p[0] - xs[xs.length - 1], p[1] - ys[ys.length - 1]);
    xs.push(p[0]); ys.push(p[1]); ss.push(s); bs.push(b);
  };
  dazu(KNOTEN[von], 0);
  for (const st of stuecke) {
    const p = st.punkte;
    const ganz = laengeVon(p);
    let lauf = 0;
    for (let i = 1; i < p.length; i += 1) {
      const [x0, y0] = p[i - 1]; const [x1, y1] = p[i];
      const l = Math.hypot(x1 - x0, y1 - y0);
      const teile = Math.max(1, Math.ceil(l / 2));
      for (let k = 1; k <= teile; k += 1) {
        const t = k / teile;
        const hier = lauf + l * t;
        // Boden: in der Mitte der Strecke ganz Perle, an den Füßen wieder Strich
        const b = st.boden ? glatt(Math.min(hier, ganz - hier) / 14) : 0;
        dazu([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t], b);
      }
      lauf += l;
    }
  }
  return { x: Float32Array.from(xs), y: Float32Array.from(ys), s: Float32Array.from(ss), boden: Float32Array.from(bs), laenge: s };
}

/** Lage auf dem Weg bei Bogenlänge s */
function auf(w: Weg, s: number): [number, number, number] {
  if (s <= 0) return [w.x[0], w.y[0], w.boden[0]];
  const n = w.s.length - 1;
  if (s >= w.laenge) return [w.x[n], w.y[n], w.boden[n]];
  let lo = 0; let hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (w.s[m] <= s) lo = m; else hi = m; }
  const t = (s - w.s[lo]) / Math.max(1e-6, w.s[hi] - w.s[lo]);
  return [w.x[lo] + (w.x[hi] - w.x[lo]) * t, w.y[lo] + (w.y[hi] - w.y[lo]) * t, w.boden[lo] + (w.boden[hi] - w.boden[lo]) * t];
}

/** Ein Abschnitt der Runde: von Halt a nach Halt b, danach Haltezeit */
export type Abschnitt = { a: Halt; b: Halt; weg: Weg; dauer: number; nachlauf: number; halten: number };
export function abschnittBauen(i: number): Abschnitt {
  const a = HALTE[RUNDE[i % RUNDE.length]];
  const b = HALTE[RUNDE[(i + 1) % RUNDE.length]];
  const weg = wegFinden(a.knoten, b.knoten);
  // Kopf: im Mittel ~48 Einheiten je Sekunde (geglättet, Spitze knapp doppelt); der Schwanz folgt verzögert
  const dauer = Math.max(950, (weg.laenge / 48) * 1000) * (0.92 + Math.random() * 0.16);
  const nachlauf = Math.min(420, dauer * 0.32);
  const halten = (b.tropfen ? 2300 : 1100) + Math.random() * 1300;
  return { a, b, weg, dauer, nachlauf, halten };
}

/** Kreise eines Bildes: [x, y, r] × N plus der Tropfen unter dem Fuß */
export type Bild = { kreise: [number, number, number][]; tropfen: [number, number, number] | null };

/** Stand des Wassers zur Zeit t (ms) in einem Abschnitt — rein rechnerisch, ohne DOM */
export function wasserBild(ab: Abschnitt, t: number): Bild {
  const { a, b, weg, dauer, nachlauf } = ab;
  const L = weg.laenge;
  const kopf = L * ease(t / dauer);
  const schwanz = L * ease((t - nachlauf) / dauer);
  const lang = kopf - schwanz;
  // 0 = beisammen (runder Tropfen), 1 = gestreckt (laufender Tropfen mit dünner Spur)
  const f = glatt(lang / 26);
  const u = glatt((t - nachlauf * 0.5) / dauer);
  const rTropfen = a.r + (b.r - a.r) * u;
  const wegX = (a.weg[0] + (b.weg[0] - a.weg[0]) * u) * (1 - f);
  const wegY = (a.weg[1] + (b.weg[1] - a.weg[1]) * u) * (1 - f);
  // Nachzittern nach dem Ankommen (Oberflächenspannung): kurz, gedämpft
  const da = t - dauer - nachlauf;
  const zittern = da > 0 ? 0.06 * Math.sin(da / 85) * Math.exp(-da / 480) : 0;
  // am Boden rückt der Körper zur Perle zusammen (sonst eine Raupe aus Kreisen)
  const bodenKopf = auf(weg, kopf)[2];
  const kreise: [number, number, number][] = [];
  for (let k = 0; k < N; k += 1) {
    const q = k / (N - 1);
    const [x, y, boden] = auf(weg, kopf - lang * (1 - q) * (1 - 0.92 * bodenKopf));
    // gestreckt: dünne Spur (11) bis runder Kopf (15); am Boden eine kleine Perle
    let r = (1 - f) * rTropfen + f * (11 + 4 * q ** 1.6);
    r = r * (1 - boden) + Math.min(r, 7 + q * 0.6) * boden;
    kreise.push([x + wegX, y + wegY, r * (1 + zittern * (k % 2 ? 1 : -0.6))]);
  }
  let tropfen: [number, number, number] | null = null;
  if (b.tropfen && da > 0) {
    // hängt, zieht sich lang (fast abgerissen) und schnellt zurück
    const h = Math.min(1, da / Math.max(1, ab.halten - 200));
    const zug = Math.sin(Math.PI * h) ** 2;
    const [x, y] = KNOTEN[b.knoten];
    tropfen = [x + b.weg[0], y + b.weg[1] + 3 + 14 * zug, 7.5 - 1.5 * zug];
  }
  return { kreise, tropfen };
}

/** Kreise [x, y, r] als ein Pfad (zwei Halbbögen je Kreis, alle im selben Umlaufsinn); Zehntel genügen */
export function kreisPfad(kreise: readonly (readonly [number, number, number])[]): string {
  let d = '';
  for (const [x, y, r0] of kreise) {
    const r = Math.max(0, r0);
    if (r < 0.05) continue;
    const a = (x - r).toFixed(1); const b = (x + r).toFixed(1); const yy = y.toFixed(1); const rr = r.toFixed(1);
    d += `M${a} ${yy}A${rr} ${rr} 0 1 0 ${b} ${yy}A${rr} ${rr} 0 1 0 ${a} ${yy}Z`;
  }
  return d;
}

/** Das Zeichen in ein Element setzen (SVG); liefert den Wasser-Pfad und den Filter-Schalter */
let zaehler = 0;
export function zeichenBauen(ziel: HTMLElement): { svg: SVGSVGElement; wasser: SVGPathElement; nass: (an: boolean) => void } {
  zaehler += 1;
  const id = `pn-agency-nass-${zaehler}`;
  const el = <K extends keyof SVGElementTagNameMap>(name: K, attr: Record<string, string | number>, kinder: SVGElement[] = []) => {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attr)) e.setAttribute(k, String(v));
    for (const c of kinder) e.appendChild(c);
    return e;
  };
  // Deckkraft-Matrix: nur der Alphakanal zählt (Zeilen R, G, B leer)
  const alpha = (r: number, g: number, a: number, k: number) => `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${r} ${g} 0 ${a} ${k}`;
  const filter = el('filter', { id, filterUnits: 'userSpaceOnUse', x: -40, y: -40, width: BREITE + 80, height: 190, 'color-interpolation-filters': 'sRGB' }, [
    // Wo ist Wasser? Deckkraft − Rot (das Zeichen ist rot, das Wasser grün und liegt darüber). Um die Kreise gedehnt
    // und hart geschnitten ist das die Nähe, in der Wasser und Strich verschmelzen — fern davon bleibt das Zeichen genau.
    el('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: alpha(-1, 0, 1, 0), result: 'wasser' }),
    el('feGaussianBlur', { in: 'wasser', stdDeviation: NAH, result: 'nahWeich' }),
    el('feColorMatrix', { in: 'nahWeich', type: 'matrix', values: alpha(0, 0, 8, 0), result: 'nah' }),
    // Goo: alles weich, dann bei 50 % hart geschnitten (gerade Kanten bleiben, wo sie waren; nahe Formen bekommen einen
    // runden Hals wie Wasser mit Oberflächenspannung) — nur in der Nähe des Wassers
    el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: SIGMA, result: 'weich' }),
    el('feComposite', { in: 'weich', in2: 'nah', operator: 'arithmetic', k1: 1, k2: 0, k3: 0, k4: 0, result: 'gewichtet' }),
    el('feColorMatrix', { in: 'gewichtet', type: 'matrix', values: alpha(0, 0, 30, -14.5), result: 'hals' }),
    el('feMerge', { result: 'form' }, [el('feMergeNode', { in: 'hals' }), el('feMergeNode', { in: 'SourceAlpha' })]),
    el('feFlood', { 'flood-color': 'currentColor', result: 'tinte' }),
    el('feComposite', { in: 'tinte', in2: 'form', operator: 'in' }),
  ]);
  // Das Wasser ist EIN Pfad aus Kreisen (gleicher Umlaufsinn → Vereinigung): je Bild ein Attribut statt 27
  const wasser = el('path', { class: 'agency-wasser', fill: '#00ff00', d: '' });
  const zeichen = el('g', { class: 'agency-zeichen-form' }, [el('path', { d: P_PFAD, 'fill-rule': 'evenodd' }), el('path', { d: X_PFAD })]);
  const nassGruppe = el('g', {}, [zeichen, wasser]);
  const svg = el('svg', { viewBox: `0 0 ${BREITE} 100`, class: 'agency-px', 'aria-hidden': 'true', focusable: 'false', overflow: 'visible' }, [el('defs', {}, [filter]), nassGruppe]);
  ziel.replaceChildren(svg);
  // Trocken in Tinte; nass malt der Filter (Zeichen rot, Wasser grün — nur Kanäle, sichtbar wird allein die Tinte)
  let istNass: boolean | undefined;
  const nass = (an: boolean) => {
    if (an === istNass) return;
    istNass = an;
    zeichen.setAttribute('fill', an ? '#ff0000' : 'currentColor');
    if (an) { nassGruppe.setAttribute('filter', `url(#${id})`); svg.dataset.nass = ''; } else { nassGruppe.removeAttribute('filter'); delete svg.dataset.nass; }
  };
  nass(false);
  return { svg, wasser, nass };
}

/** Zeichen setzen und das Wasser laufen lassen; liefert das Aufräumen */
export function logoBewegen(ziel: HTMLElement): () => void {
  const { wasser, nass } = zeichenBauen(ziel);
  const reduziert = window.matchMedia('(prefers-reduced-motion: reduce)');
  let aus = false;
  let imBild = !('IntersectionObserver' in window);
  let raf: number | undefined;
  let zeitgeber: ReturnType<typeof setTimeout> | undefined;
  let zuletzt: number | undefined;
  // Start: der Tropfen sitzt schon am Bauch (Ende des letzten Abschnitts der Runde) und zieht bald los
  let nr = RUNDE.length - 1;
  let ab = { ...abschnittBauen(nr), halten: 1600 };
  let t = ab.dauer + ab.nachlauf + 600;
  let gesetzt = '';

  let gezeichnet = -Infinity;
  const setzen = (bild: Bild) => {
    const d = kreisPfad(bild.tropfen ? [...bild.kreise, bild.tropfen] : bild.kreise);
    if (d === gesetzt) return;
    gesetzt = d;
    wasser.setAttribute('d', d);
  };
  const trocken = () => { gesetzt = ''; gezeichnet = -Infinity; wasser.setAttribute('d', ''); nass(false); };

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
    // ein verdeckter Tab oder ein hängendes Bild spult nicht vor
    if (zuletzt !== undefined) t += Math.min(jetzt - zuletzt, 100);
    zuletzt = jetzt;
    const ende = ab.dauer + ab.nachlauf + ab.halten;
    if (t >= ende) {
      t -= ende;
      nr = (nr + 1) % RUNDE.length;
      ab = abschnittBauen(nr);
    }
    // höchstens 30 Bilder je Sekunde: in Kopfleisten-Größe wandert der Tropfen dabei unter einem halben Punkt je Bild,
    // und jedes Bild kostet Stil, Malen und Ebenen der Seite (Hauptthread) — halb so oft, halb so teuer
    if (jetzt - gezeichnet >= 30) {
      gezeichnet = jetzt;
      nass(true);
      setzen(wasserBild(ab, t));
    }
    // Der Tropfen sitzt still (Zittern abgeklungen, kein Tropfen unter dem Fuß): bis zum Losziehen ruhen
    const ruhigAb = ab.dauer + ab.nachlauf + 1300;
    if (!ab.b.tropfen && t > ruhigAb && ende - t > 150) {
      const rest = ende - t;
      zeitgeber = setTimeout(() => { zeitgeber = undefined; t += rest; zuletzt = undefined; weiter(); }, rest);
      return;
    }
    raf = requestAnimationFrame(takt);
  };
  const weiter = () => { if (raf === undefined && zeitgeber === undefined && darf()) raf = requestAnimationFrame(takt); };
  const abgleichen = () => {
    anhalten();
    if (still()) trocken();
    weiter();
  };

  const beobachter = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { imBild = e.isIntersecting; abgleichen(); }) : undefined;
  beobachter?.observe(ziel);
  const attribute = new MutationObserver(abgleichen);
  attribute.observe(document.documentElement, { attributes: true, attributeFilter: ['data-lesbar'] });
  const zugAbo = zugBeobachten(abgleichen);
  reduziert.addEventListener('change', abgleichen);
  document.addEventListener('visibilitychange', abgleichen);
  abgleichen();

  return () => {
    aus = true;
    anhalten();
    beobachter?.disconnect();
    attribute.disconnect();
    zugAbo();
    reduziert.removeEventListener('change', abgleichen);
    document.removeEventListener('visibilitychange', abgleichen);
  };
}
