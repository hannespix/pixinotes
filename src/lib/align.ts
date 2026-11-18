// M142: Ausrichten & Verteilen der Auswahl — das PowerPoint-Handwerkszeug.
// M399: … und alles, was man braucht, um viele Karten auf einmal in Form zu bringen: an jede Kante, als Zeile
// oder Spalte, gleiche Höhe und Größe, gemeinsam größer und kleiner, ins Raster, kompakt gepackt, aufgeräumt.
// Reine Geometrie: liefert Ziel-Positionen/-Größen, der Aufrufer schreibt sie
// (mit EINEM History-Eintrag) in den Store.
import type { AppNode } from '../types';
import { sizeOf } from './arrange';

export type AlignOp =
  | 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'
  | 'distH' | 'distV' | 'row' | 'column'
  | 'width' | 'height' | 'size' | 'bigger' | 'smaller'
  | 'grid' | 'pack' | 'tidy';

export const ALIGN_LABEL: Record<AlignOp, string> = {
  left: 'Links ausrichten',
  centerX: 'Horizontal zentrieren',
  right: 'Rechts ausrichten',
  top: 'Oben ausrichten',
  centerY: 'Vertikal zentrieren',
  bottom: 'Unten ausrichten',
  distH: 'Horizontal verteilen',
  distV: 'Vertikal verteilen',
  row: 'Als Zeile nebeneinander',
  column: 'Als Spalte untereinander',
  width: 'Gleiche Breite',
  height: 'Gleiche Höhe',
  size: 'Gleiche Größe',
  bigger: 'Größer',
  smaller: 'Kleiner',
  grid: 'Raster',
  pack: 'Kompakt packen',
  tidy: 'Aufräumen',
};

/** Wie viele Karten ein Befehl mindestens braucht */
export const ALIGN_MIN: Partial<Record<AlignOp, number>> = { distH: 3, distV: 3, bigger: 1, smaller: 1 };

export interface AlignResult {
  moves: Array<[string, number, number]>;
  resizes: Array<[string, number, number]>;
}

/** Abstand zwischen Karten, wenn ein Befehl sie selbst setzt (Zeile, Spalte, Raster, Packen, Aufräumen) */
export const ALIGN_ABSTAND = 24;
const STUFE = 1.15;
const MIN_W = 90; const MIN_H = 56;

interface Kasten { id: string; x: number; y: number; w: number; h: number }

/**
 * Lesereihenfolge: Zeilen von oben nach unten, darin von links nach rechts. Eine Karte gehört noch zur Zeile,
 * wenn sie im oberen Dreiviertel einer Karte dieser Zeile beginnt — so bleibt eine grob gelegte Anordnung erhalten,
 * auch wenn die Karten verschieden hoch sind und nicht auf einer Linie stehen.
 */
export function inZeilen(kaesten: Kasten[]): Kasten[][] {
  const nachOben = [...kaesten].sort((a, b) => a.y - b.y || a.x - b.x);
  const zeilen: Kasten[][] = [];
  for (const k of nachOben) {
    const letzte = zeilen[zeilen.length - 1];
    if (letzte && k.y < Math.max(...letzte.map((z) => z.y + z.h * 0.75))) letzte.push(k);
    else zeilen.push([k]);
  }
  return zeilen.map((z) => z.sort((a, b) => a.x - b.x || a.y - b.y));
}

/** Spaltenzahl, bei der der Block am ehesten quer liegt (3:2) — das liest sich auf dem Bildschirm am ruhigsten */
function spaltenFuer(karten: Kasten[]): number {
  let beste = 1; let abstand = Infinity;
  for (let c = 1; c <= karten.length; c++) {
    const zeilen = Math.ceil(karten.length / c);
    let breite = 0; let hoehe = 0;
    for (let s = 0; s < c; s++) breite += Math.max(0, ...karten.filter((_, i) => i % c === s).map((k) => k.w)) + (s ? ALIGN_ABSTAND : 0);
    for (let z = 0; z < zeilen; z++) hoehe += Math.max(...karten.slice(z * c, z * c + c).map((k) => k.h)) + (z ? ALIGN_ABSTAND : 0);
    const d = Math.abs(Math.log((breite / hoehe) / 1.5));
    if (d < abstand - 1e-9) { abstand = d; beste = c; }
  }
  return beste;
}

export function computeAlign(nodes: AppNode[], op: AlignOp): AlignResult {
  const moves: Array<[string, number, number]> = [];
  const resizes: Array<[string, number, number]> = [];
  if (nodes.length < (ALIGN_MIN[op] ?? 2)) return { moves, resizes };
  const boxes = nodes.map((n) => ({ n, s: sizeOf(n) }));
  const kaesten: Kasten[] = boxes.map((b) => ({ id: b.n.id, x: b.n.position.x, y: b.n.position.y, w: b.s.w, h: b.s.h }));
  const links = Math.min(...kaesten.map((k) => k.x));
  const oben = Math.min(...kaesten.map((k) => k.y));
  /** nur schreiben, was sich wirklich bewegt — sonst entstünde ein leerer Rückgängig-Schritt */
  const nach = (k: Kasten, x: number, y: number) => { if (Math.abs(k.x - x) > 0.01 || Math.abs(k.y - y) > 0.01) moves.push([k.id, x, y]); };
  const gross = (k: Kasten, w: number, h: number) => { if (Math.abs(k.w - w) > 0.01 || Math.abs(k.h - h) > 0.01) resizes.push([k.id, w, h]); };

  switch (op) {
    case 'left': for (const k of kaesten) nach(k, links, k.y); break;
    case 'right': { const r = Math.max(...kaesten.map((k) => k.x + k.w)); for (const k of kaesten) nach(k, r - k.w, k.y); break; }
    case 'centerX': {
      const c = kaesten.reduce((a, k) => a + k.x + k.w / 2, 0) / kaesten.length;
      for (const k of kaesten) nach(k, c - k.w / 2, k.y);
      break;
    }
    case 'top': for (const k of kaesten) nach(k, k.x, oben); break;
    case 'bottom': { const u = Math.max(...kaesten.map((k) => k.y + k.h)); for (const k of kaesten) nach(k, k.x, u - k.h); break; }
    case 'centerY': {
      const c = kaesten.reduce((a, k) => a + k.y + k.h / 2, 0) / kaesten.length;
      for (const k of kaesten) nach(k, k.x, c - k.h / 2);
      break;
    }
    case 'distH': {
      const sorted = [...kaesten].sort((a, b) => a.x - b.x);
      const first = sorted[0]; const last = sorted[sorted.length - 1];
      const gap = (last.x + last.w - first.x - sorted.reduce((a, k) => a + k.w, 0)) / (sorted.length - 1);
      let x = first.x;
      for (const k of sorted) { nach(k, x, k.y); x += k.w + gap; }
      break;
    }
    case 'distV': {
      const sorted = [...kaesten].sort((a, b) => a.y - b.y);
      const first = sorted[0]; const last = sorted[sorted.length - 1];
      const gap = (last.y + last.h - first.y - sorted.reduce((a, k) => a + k.h, 0)) / (sorted.length - 1);
      let y = first.y;
      for (const k of sorted) { nach(k, k.x, y); y += k.h + gap; }
      break;
    }
    case 'row': {
      let x = links;
      for (const k of [...kaesten].sort((a, b) => a.x - b.x || a.y - b.y)) { nach(k, x, oben); x += k.w + ALIGN_ABSTAND; }
      break;
    }
    case 'column': {
      let y = oben;
      for (const k of [...kaesten].sort((a, b) => a.y - b.y || a.x - b.x)) { nach(k, links, y); y += k.h + ALIGN_ABSTAND; }
      break;
    }
    case 'width': { const w = Math.max(...kaesten.map((k) => k.w)); for (const k of kaesten) gross(k, w, k.h); break; }
    case 'height': { const h = Math.max(...kaesten.map((k) => k.h)); for (const k of kaesten) gross(k, k.w, h); break; }
    case 'size': {
      const w = Math.max(...kaesten.map((k) => k.w)); const h = Math.max(...kaesten.map((k) => k.h));
      for (const k of kaesten) gross(k, w, h);
      break;
    }
    case 'bigger':
    case 'smaller': {
      // Jede Karte wächst um ihre eigene Mitte — die Anordnung bleibt, wie sie ist
      const f = op === 'bigger' ? STUFE : 1 / STUFE;
      for (const k of kaesten) {
        const w = Math.max(MIN_W, Math.round(k.w * f)); const h = Math.max(MIN_H, Math.round(k.h * f));
        gross(k, w, h);
        nach(k, k.x - (w - k.w) / 2, k.y - (h - k.h) / 2);
      }
      break;
    }
    case 'grid': {
      // Reihenfolge wie gelesen. Liegen die Karten schon in gleich langen Zeilen, bleibt diese Aufteilung.
      const zeilen = inZeilen(kaesten);
      const folge = zeilen.flat();
      const laengen = zeilen.map((z) => z.length);
      const gleich = zeilen.length > 1 && Math.max(...laengen.slice(0, -1)) === Math.min(...laengen.slice(0, -1)) && laengen[laengen.length - 1] <= laengen[0];
      const c = gleich ? laengen[0] : spaltenFuer(folge);
      const breiten = Array.from({ length: c }, (_, s) => Math.max(0, ...folge.filter((_, i) => i % c === s).map((k) => k.w)));
      let y = oben;
      for (let z = 0; z * c < folge.length; z++) {
        const reihe = folge.slice(z * c, z * c + c);
        let x = links;
        reihe.forEach((k, s) => { nach(k, x, y); x += breiten[s] + ALIGN_ABSTAND; });
        y += Math.max(...reihe.map((k) => k.h)) + ALIGN_ABSTAND;
      }
      break;
    }
    case 'tidy': {
      // Die grobe Anordnung bleibt: Zeile für Zeile, überall derselbe Abstand, nichts überlappt
      let y = oben;
      for (const reihe of inZeilen(kaesten)) {
        let x = links;
        for (const k of reihe) { nach(k, x, y); x += k.w + ALIGN_ABSTAND; }
        y += Math.max(...reihe.map((k) => k.h)) + ALIGN_ABSTAND;
      }
      break;
    }
    case 'pack': {
      // Dicht packen: hohe Karten zuerst, jede an die tiefste freie Stelle eines Streifens (Skyline-Verfahren)
      const flaeche = kaesten.reduce((a, k) => a + (k.w + ALIGN_ABSTAND) * (k.h + ALIGN_ABSTAND), 0);
      const streifen = Math.max(Math.max(...kaesten.map((k) => k.w)), Math.sqrt(flaeche * 1.5));
      /** die Oberkante des Belegten als Stufen von links nach rechts */
      let stufen: Array<{ x: number; b: number; y: number }> = [{ x: 0, b: Infinity, y: 0 }];
      const folge = [...kaesten].sort((a, b) => b.h - a.h || b.w - a.w || a.y - b.y || a.x - b.x);
      for (const k of folge) {
        const breit = k.w + ALIGN_ABSTAND;
        let best: { x: number; y: number } | null = null;
        for (const s of stufen) {
          if (s.x + k.w > streifen + 0.01 && s.x > 0) continue;
          // Höhe, auf der die Karte ab dieser Stufe aufliegt
          let y = 0;
          for (const t of stufen) if (t.x < s.x + breit && t.x + t.b > s.x) y = Math.max(y, t.y);
          if (!best || y < best.y - 0.01 || (Math.abs(y - best.y) <= 0.01 && s.x < best.x)) best = { x: s.x, y };
        }
        const ort = best ?? { x: 0, y: Math.max(...stufen.map((s) => s.y)) };
        nach(k, links + ort.x, oben + ort.y);
        // Stufen neu schneiden: der Bereich unter der Karte liegt jetzt auf ihrer Unterkante
        const a = ort.x; const e = ort.x + breit; const hoch = ort.y + k.h + ALIGN_ABSTAND;
        const neu: typeof stufen = [];
        for (const s of stufen) {
          const se = s.x + s.b;
          if (se <= a || s.x >= e) { neu.push(s); continue; }
          if (s.x < a) neu.push({ x: s.x, b: a - s.x, y: s.y });
          if (se > e) neu.push({ x: e, b: se - e, y: s.y });
        }
        neu.push({ x: a, b: breit, y: hoch });
        stufen = neu.sort((p, q) => p.x - q.x);
      }
      break;
    }
  }
  return { moves, resizes };
}
