// Stift-Gesten (M324): Umkreisen markiert, Durchstreichen löscht.
// Alle Koordinaten sind Flow-Koordinaten (zoomunabhängig).
import type { Pt } from './strokeShapes';

export interface Box { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number }

export function bboxVon(pts: Pt[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function weglaenge(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i += 1) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/**
 * Geschlossene Schleife? Anfang und Ende liegen nah beieinander (gemessen an
 * der Weglänge), der Weg ist lang genug und umschließt eine echte Fläche —
 * ein „o" beim Schreiben ist klein, eine Lasso-Schleife um eine Karte groß.
 */
export function istSchleife(pts: Pt[], mindestFlaeche = 2500): boolean {
  if (pts.length < 12) return false;
  const l = weglaenge(pts);
  if (l < 160) return false;
  const a = pts[0], e = pts[pts.length - 1];
  const luecke = Math.hypot(e[0] - a[0], e[1] - a[1]);
  if (luecke > Math.max(24, l * 0.18)) return false;
  const b = bboxVon(pts);
  return b.w * b.h >= mindestFlaeche && Math.abs(flaeche(pts)) >= mindestFlaeche * 0.5;
}

/** Vorzeichenbehaftete Fläche (Schnürsenkelformel) */
function flaeche(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Liegt der Punkt im Polygon (Strahlmethode)? */
export function punktInPolygon(p: Pt, poly: Pt[]): boolean {
  let drin = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const schneidet = (yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / ((yj - yi) || 1e-9) + xi;
    if (schneidet) drin = !drin;
  }
  return drin;
}

/**
 * Kritzel (Durchstreichen)? Der Stift fährt mehrfach hin und her: viele
 * Richtungswechsel in x auf kurzem Raum. Ein „m" oder „w" hat zwei, drei —
 * ein Durchstreichen deutlich mehr. Gemessen auf dem vereinfachten Weg,
 * damit Zittern nicht zählt.
 */
export function istKritzel(pts: Pt[]): boolean {
  if (pts.length < 10) return false;
  const b = bboxVon(pts);
  if (b.w < 20) return false;
  let wechsel = 0;
  let richtung = 0;
  let lauf = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const dx = pts[i][0] - pts[i - 1][0];
    lauf += dx;
    if (Math.abs(lauf) < Math.max(6, b.w * 0.12)) continue; // erst ab einem echten Stück Weg zählt die Richtung
    const r = Math.sign(lauf);
    if (richtung !== 0 && r !== richtung) wechsel += 1;
    richtung = r;
    lauf = 0;
  }
  // flach und dicht: mindestens fünf Kehren, und der Weg ist viel länger als die Box breit
  return wechsel >= 5 && weglaenge(pts) > b.w * 2.5;
}

/** Welcher Anteil der Fläche von b liegt in a? (0 … 1) */
export function ueberdeckung(a: Box, b: Box): number {
  const bw = Math.max(1, b.w), bh = Math.max(1, b.h);
  const w = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const h = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return (w * h) / (bw * bh);
}
