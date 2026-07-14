// Formerkennung & Glättung für Freihand-Striche (wie in OneNote/FigJam):
// - beim Loslassen: entzittern + fast gerade Striche (Unterstreichungen!) begradigen
// - beim Halten am Strich-Ende: großzügige Erkennung von Linie / Rechteck / Ellipse
// Alle Koordinaten sind Flow-Koordinaten (zoomunabhängig).

export type Pt = [number, number];

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function pathLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

function bbox(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Senkrechter Abstand von p zur Geraden a→b */
function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return dist(p, a);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Gleitender Mittelwert (Endpunkte bleiben fix) — nimmt das Zittern raus */
export function smoothStroke(pts: Pt[]): Pt[] {
  if (pts.length < 5) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    out.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Linien-Erkennung: Abweichung von der Sehne klein → gerade Linie.
 * Winkel rastet auf 0°/45°/90°… ein, wenn er nah dran ist (Unterstreichen!).
 */
function asLine(pts: Pt[], tolRatio: number, angleSnapDeg: number): Pt[] | null {
  const a = pts[0], b = pts[pts.length - 1];
  const len = dist(a, b);
  if (len < 24) return null;
  // Sehne muss den Strich gut repräsentieren (sonst ist es ein Bogen/Kringel)
  if (pathLength(pts) / len > 1.25) return null;
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, perpDist(p, a, b));
  if (maxDev / len > tolRatio) return null;

  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(ang - snapped) <= (angleSnapDeg * Math.PI) / 180) ang = snapped;
  return [a, [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)]];
}

/** Geschlossener Strich? (Enden nah beieinander, gemessen an der Größe) */
function isClosed(pts: Pt[]): boolean {
  const { w, h } = bbox(pts);
  const size = Math.max(w, h);
  return size > 30 && dist(pts[0], pts[pts.length - 1]) < 0.35 * size;
}

/** Rechteck: alle 4 Ecken der Bounding-Box werden vom Strich fast berührt */
function asRect(pts: Pt[]): Pt[] | null {
  if (!isClosed(pts)) return null;
  const { minX, minY, maxX, maxY, w, h } = bbox(pts);
  if (w < 30 || h < 30) return null;
  const diag = Math.hypot(w, h);
  const corners: Pt[] = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
  for (const c of corners) {
    let best = Infinity;
    for (const p of pts) best = Math.min(best, dist(p, c));
    // eng genug, dass eine Ellipse (Abstand ~0,15·Diagonale zu den Ecken) NICHT matcht
    if (best > 0.08 * diag) return null;
  }
  return [...corners, corners[0]];
}

/** Ellipse/Kreis: normierter Radius aller Punkte nahe 1 */
function asEllipse(pts: Pt[]): Pt[] | null {
  if (!isClosed(pts)) return null;
  const { minX, minY, w, h } = bbox(pts);
  if (w < 30 || h < 30) return null;
  const cx = minX + w / 2, cy = minY + h / 2;
  const rx = w / 2, ry = h / 2;
  let err = 0;
  for (const [x, y] of pts) {
    const rn = Math.hypot((x - cx) / rx, (y - cy) / ry);
    err += Math.abs(rn - 1);
  }
  // 0,14: ein Rechteck liegt im Mittel bei ~0,15 und fällt damit durch
  if (err / pts.length > 0.14) return null;
  const out: Pt[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

/**
 * Großzügige Erkennung fürs „Halten am Ende" — Linie, Rechteck oder Ellipse.
 * null = keine saubere Form erkannt, Strich bleibt wie er ist.
 */
export function recognizeShape(pts: Pt[]): Pt[] | null {
  if (pts.length < 8) return null;
  return asLine(pts, 0.12, 10) ?? asRect(pts) ?? asEllipse(pts);
}

/**
 * Standard-Pipeline beim Loslassen: entzittern; fast gerade Striche
 * (Unterstreichungen, Pfeil-Linien) rasten konservativ gerade ein.
 */
export function finalizeStroke(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const line = asLine(pts, 0.04, 5);
  if (line) return line;
  return smoothStroke(smoothStroke(pts));
}
