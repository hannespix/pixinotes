/**
 * M423: Die Tropfen-Fläche der Netzansicht — organische, ineinanderfließende Inseln mit Farbverläufen, wie bei den
 * Ideabubbles, aber ohne SVG-Filter.
 *
 * Gewünscht: „Netzansicht bitte tropfiger und mit mehr farbigen Verläufen etc. wie bei den Ideabubbles gestalten
 * … organischer." Die Ideabubbles erreichen das mit einem SVG-Filter (Weichzeichnen, dann die Deckkraft hart
 * schneiden; die Farbe stärker weichgezeichnet, damit sie dort verläuft, wo sie sich trifft). Im Netz kostete genau
 * dieser Filter beim Zoomen bis 0,5 s je Bild (M419) — er wird bei jedem Neuzeichnen über die ganze Fläche gerechnet.
 *
 * Hier dasselbe Prinzip auf einer KLEINEN Canvas-Fläche (längste Seite höchstens 420 Punkte), die das Netz-Koordinaten-
 * system abdeckt und mit der Netz-Ebene skaliert wird:
 *   1. Kreise (und Brücken) in ihrer Farbe malen — Farbe ist vormultipliziert, die Fläche zählt.
 *   2. Weichzeichnen (Box-Blur, dreimal je Richtung ≈ Gauß) — Farbe und Deckkraft getrennt.
 *   3. Deckkraft hart schneiden (Schwelle + Steilheit) → die Formen fließen mit runden Hälsen zusammen;
 *      Farbe = weichgezeichnete Farbe / weichgezeichnete Deckkraft → an Übergängen laufen die Farben ineinander.
 *   4. Eine feine Kontur an der Schnittkante (wie die Ideabubbles), leicht dunkler/heller.
 * Gerechnet wird nur, wenn sich Boards bewegen (Physik, Ziehen) oder die Gliederung ändert — Verschieben und Zoomen
 * bewegen das fertige Bild (Compositor). Die weichen Kanten verträgt das Hochskalieren gut.
 */

export interface TropfenKreis { x: number; y: number; r: number; farbe: [number, number, number] }
export interface TropfenBruecke { x1: number; y1: number; x2: number; y2: number; breite: number; farbe: [number, number, number] }
export interface TropfenBild {
  /** Ausschnitt in Netz-Koordinaten, den die Fläche abdeckt */
  x: number; y: number; w: number; h: number;
}

const MAX_SEITE = 640;

/** Kann der Browser selbst weichzeichnen (Canvas-Filter)? Chromium und Firefox ja, ältere Safari nicht. */
let filterGeht: boolean | undefined;
function browserWeich(): boolean {
  if (filterGeht !== undefined) return filterGeht;
  try {
    const c = document.createElement('canvas'); c.width = 9; c.height = 9;
    const x = c.getContext('2d');
    if (!x || typeof (x as CanvasRenderingContext2D & { filter?: string }).filter !== 'string') return (filterGeht = false);
    x.fillStyle = '#000'; x.fillRect(4, 4, 1, 1);
    const q = document.createElement('canvas'); q.width = 9; q.height = 9;
    const y = q.getContext('2d')!; y.filter = 'blur(2px)'; y.drawImage(c, 0, 0);
    // weichgezeichnet: der Nachbar des Punkts hat jetzt etwas Deckkraft
    filterGeht = y.getImageData(2, 4, 1, 1).data[3] > 0;
  } catch { filterGeht = false; }
  return filterGeht;
}
let vorlage: HTMLCanvasElement | null = null;

/** Hex (#rrggbb) → RGB */
export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Farbton drehen (Grad) und Sättigung/Helligkeit leicht ändern — für verwandte, aber verschiedene Töne */
export function tonDrehen([r, g, b]: [number, number, number], grad: number, hell = 0): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  let h = 0; let s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h /= 6;
  }
  h = (((h * 360 + grad) % 360) + 360) % 360 / 360;
  const l2 = Math.min(0.92, Math.max(0.08, l + hell));
  const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s; const p = 2 * l2 - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return s === 0 ? [l2 * 255, l2 * 255, l2 * 255] : [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Box-Blur in einer Richtung über alle vier Kanäle (Float32, vormultipliziert) */
function boxRichtung(q: Float32Array, z: Float32Array, w: number, h: number, rad: number, waagerecht: boolean): void {
  const n = waagerecht ? w : h; const m = waagerecht ? h : w;
  const schritt = waagerecht ? 4 : w * 4;
  const teiler = 1 / (2 * rad + 1);
  for (let j = 0; j < m; j++) {
    const basis = waagerecht ? j * w * 4 : j * 4;
    for (let c = 0; c < 4; c++) {
      let summe = 0;
      for (let i = -rad; i <= rad; i++) summe += q[basis + Math.min(n - 1, Math.max(0, i)) * schritt + c];
      for (let i = 0; i < n; i++) {
        z[basis + i * schritt + c] = summe * teiler;
        const raus = Math.max(0, i - rad); const rein = Math.min(n - 1, i + rad + 1);
        summe += q[basis + rein * schritt + c] - q[basis + raus * schritt + c];
      }
    }
  }
}

export interface MalOptionen {
  /** Weichzeichnung in Netz-Einheiten (wie stdDeviation) */
  weich: number;
  /** Deckkraft, ab der Fläche entsteht (0–1) und wie steil die Kante ist */
  schwelle?: number; steil?: number;
  /** Kontur: Stärke (0 = keine) und Richtung (negativ = dunkler, positiv = heller) */
  kontur?: number;
  /** Längste Seite der Fläche in Bildpunkten — in Bewegung kleiner (die Kante ist weich), in Ruhe scharf */
  maxSeite?: number;
}

/** Wiederverwendete Rechenpuffer (in Bewegung wird jedes dritte Bild gemalt — keine neuen Felder je Bild) */
let pufferA = new Float32Array(0); let pufferB = new Float32Array(0);
const puffer = (n: number) => { if (pufferA.length < n) { pufferA = new Float32Array(n); pufferB = new Float32Array(n); } return [pufferA, pufferB] as const; };

/**
 * Malt die Tropfen-Fläche in `canvas` und gibt den abgedeckten Ausschnitt zurück (die Aufrufer setzen damit Lage und
 * Größe des Elements). Leere Liste → leere Fläche.
 */
export function tropfenMalen(canvas: HTMLCanvasElement, kreise: TropfenKreis[], bruecken: TropfenBruecke[], opt: MalOptionen): TropfenBild | null {
  if (!kreise.length) { canvas.width = 1; canvas.height = 1; return null; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of kreise) { x0 = Math.min(x0, k.x - k.r); y0 = Math.min(y0, k.y - k.r); x1 = Math.max(x1, k.x + k.r); y1 = Math.max(y1, k.y + k.r); }
  const rand = opt.weich * 3 + 8;
  x0 -= rand; y0 -= rand; x1 += rand; y1 += rand;
  const W = x1 - x0, H = y1 - y0;
  const s = Math.min(1, (opt.maxSeite ?? MAX_SEITE) / Math.max(W, H));
  const w = Math.max(8, Math.ceil(W * s)); const h = Math.max(8, Math.ceil(H * s));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const schnell = browserWeich();
  // Mit Browser-Weichzeichnung: erst auf eine Vorlage malen, dann weichgezeichnet herüberholen
  let mal: CanvasRenderingContext2D = ctx;
  if (schnell) {
    vorlage = vorlage ?? document.createElement('canvas');
    if (vorlage.width !== w) vorlage.width = w;
    if (vorlage.height !== h) vorlage.height = h;
    mal = vorlage.getContext('2d')!;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.clearRect(0, 0, w, h);
  mal.setTransform(1, 0, 0, 1, 0, 0);
  if (mal !== ctx) mal.clearRect(0, 0, w, h);
  mal.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  // 1. Brücken zuerst (runde Enden), dann die Kreise darüber
  mal.lineCap = 'round';
  for (const b of bruecken) {
    mal.strokeStyle = `rgb(${b.farbe[0] | 0},${b.farbe[1] | 0},${b.farbe[2] | 0})`;
    mal.lineWidth = b.breite;
    mal.beginPath(); mal.moveTo(b.x1, b.y1); mal.lineTo(b.x2, b.y2); mal.stroke();
  }
  for (const k of kreise) {
    mal.fillStyle = `rgb(${k.farbe[0] | 0},${k.farbe[1] | 0},${k.farbe[2] | 0})`;
    mal.beginPath(); mal.arc(k.x, k.y, k.r, 0, Math.PI * 2); mal.fill();
  }
  mal.setTransform(1, 0, 0, 1, 0, 0);
  // 2. Weichzeichnen — Browser (schnell) oder selbst: drei Box-Durchgänge je Richtung ≈ Gauß mit σ ≈ weich
  const sigma = Math.max(1, opt.weich * s);
  if (schnell && vorlage) { ctx.filter = `blur(${sigma.toFixed(2)}px)`; ctx.drawImage(vorlage, 0, 0); ctx.filter = 'none'; }
  const bild = ctx.getImageData(0, 0, w, h);
  const d = bild.data;
  const [a, b] = puffer(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    const al = d[i + 3] / 255;
    a[i] = d[i] * al; a[i + 1] = d[i + 1] * al; a[i + 2] = d[i + 2] * al; a[i + 3] = al;
  }
  if (!schnell) {
    const rad = Math.max(1, Math.round(sigma * 0.95));
    for (let p = 0; p < 3; p++) { boxRichtung(a, b, w, h, rad, true); boxRichtung(b, a, w, h, rad, false); }
  }
  // 3. Deckkraft schneiden, Farbe entmultiplizieren; 4. Kontur an der Kante
  // Steilheit über die Bildpunkte gerechnet: Die Kante soll gut zwei Punkte der Fläche breit sein — so glättet das
  // Hochskalieren sie, statt Treppen zu zeigen
  const schwelle = opt.schwelle ?? 0.42; const steil = opt.steil ?? Math.max(2.2, Math.min(9, sigma * 0.9)); const kontur = opt.kontur ?? 0;
  for (let i = 0; i < d.length; i += 4) {
    const al = a[i + 3];
    let o = (al - schwelle) * steil + 0.5;
    o = o < 0 ? 0 : o > 1 ? 1 : o;
    if (o === 0 || al < 1e-4) { d[i + 3] = 0; continue; }
    let r = a[i] / al, g = a[i + 1] / al, bl = a[i + 2] / al;
    if (kontur) {
      // die Kante: dort, wo die geschnittene Deckkraft zwischen 0 und 1 liegt — als schmaler Saum
      const saum = 1 - Math.abs(o - 0.5) * 2;
      const f = saum * kontur;
      if (f > 0) { const ziel = kontur > 0 ? 255 : 0; const ff = Math.abs(f); r += (ziel - r) * ff; g += (ziel - g) * ff; bl += (ziel - bl) * ff; }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = bl; d[i + 3] = o * 255;
  }
  ctx.putImageData(bild, 0, 0);
  return { x: x0, y: y0, w: W, h: H };
}
