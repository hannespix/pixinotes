// Formerkennung & Glättung für Freihand-Striche (wie in OneNote/FigJam/Apple Notes):
// - beim Loslassen: entzittern + fast gerade Striche (Unterstreichungen!) begradigen
// - beim Halten am Strich-Ende: großzügige Erkennung von Linie, Pfeil, Kreis,
//   Ellipse, Dreieck, Rechteck (auch gedreht) — M319
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

/** Ramer–Douglas–Peucker: Polygonzug auf seine Ecken eindampfen */
export function vereinfachen(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const links = vereinfachen(pts.slice(0, idx + 1), eps);
  const rechts = vereinfachen(pts.slice(idx), eps);
  return [...links.slice(0, -1), ...rechts];
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

/** Rechteck (achsenparallel): alle 4 Ecken der Bounding-Box werden vom Strich fast berührt */
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

/** Ellipse/Kreis: normierter Radius aller Punkte nahe 1. Fast rund → echter Kreis. */
function asEllipse(pts: Pt[]): Pt[] | null {
  if (!isClosed(pts)) return null;
  const { minX, minY, w, h } = bbox(pts);
  if (w < 30 || h < 30) return null;
  const cx = minX + w / 2, cy = minY + h / 2;
  let rx = w / 2, ry = h / 2;
  let err = 0;
  for (const [x, y] of pts) {
    const rn = Math.hypot((x - cx) / rx, (y - cy) / ry);
    err += Math.abs(rn - 1);
  }
  // 0,14: ein Rechteck liegt im Mittel bei ~0,15 und fällt damit durch
  if (err / pts.length > 0.14) return null;
  // M319: Wer einen Kreis meint, bekommt einen Kreis — bis 12 % Unterschied
  if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) { rx = ry = (rx + ry) / 2; }
  const out: Pt[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

/** Innenwinkel an Ecke b (Grad) */
function winkel(a: Pt, b: Pt, c: Pt): number {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const d = v1[0] * v2[0] + v1[1] * v2[1];
  const n = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]);
  if (n < 1e-6) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, d / n))) * 180) / Math.PI;
}

/**
 * M319: Dreieck und GEDREHTES Rechteck über die Ecken (RDP). Das achsen-
 * parallele Rechteck kommt weiter aus `asRect` (es rastet zusätzlich die
 * Kanten gerade). Hier: drei Ecken → Dreieck; vier Ecken mit ~rechten
 * Winkeln → Viereck durch die Ecken, mit rechtwinklig nachgezogenen Seiten.
 */
function asPolygon(pts: Pt[]): Pt[] | null {
  if (!isClosed(pts)) return null;
  const { w, h } = bbox(pts);
  const size = Math.max(w, h);
  if (size < 30) return null;
  // Schließen, damit die erste Ecke nicht doppelt zählt
  const geschlossen = [...pts, pts[0]];
  let ecken = vereinfachen(geschlossen, 0.07 * size);
  ecken = ecken.slice(0, -1); // Endpunkt = Startpunkt
  // Mini-Kanten (Ansatz/Absatz des Stifts) wegnehmen
  const umfang = pathLength([...ecken, ecken[0]]);
  ecken = ecken.filter((p, i, arr) => dist(p, arr[(i + 1) % arr.length]) > 0.08 * umfang || arr.length <= 3);
  if (ecken.length === 3) {
    const kl = Math.min(...ecken.map((p, i, arr) => winkel(arr[(i + 2) % 3], p, arr[(i + 1) % 3])));
    if (kl < 18) return null; // Nadel — eher eine Linie hin und zurück
    return [...ecken, ecken[0]];
  }
  if (ecken.length === 4) {
    const winkelListe = ecken.map((p, i, arr) => winkel(arr[(i + 3) % 4], p, arr[(i + 1) % 4]));
    if (!winkelListe.every((a) => Math.abs(a - 90) < 22)) return null;
    // Rechtwinklig nachziehen: Achse = längste Kante, Ecken darauf projizieren
    let k = 0, best = 0;
    for (let i = 0; i < 4; i++) { const l = dist(ecken[i], ecken[(i + 1) % 4]); if (l > best) { best = l; k = i; } }
    const a = ecken[k], b = ecken[(k + 1) % 4];
    const ux = (b[0] - a[0]) / best, uy = (b[1] - a[1]) / best;
    const vx = -uy, vy = ux;
    // Breite = mittlere Projektion der beiden anderen Ecken auf die Normale
    const c = ecken[(k + 2) % 4], d = ecken[(k + 3) % 4];
    const tiefe = ((c[0] - b[0]) * vx + (c[1] - b[1]) * vy + (d[0] - a[0]) * vx + (d[1] - a[1]) * vy) / 2;
    const p2: Pt = [b[0] + vx * tiefe, b[1] + vy * tiefe];
    const p3: Pt = [a[0] + vx * tiefe, a[1] + vy * tiefe];
    return [a, b, p2, p3, a];
  }
  return null;
}

/**
 * M319: Pfeil = langer Schaft, am Ende zwei kurze Schenkel. Gezeichnet in
 * einem Zug (Schaft → Spitze → Schenkel → zurück zur Spitze → Schenkel) oder
 * als Schaft mit nur einem Haken. Ergebnis: Schaft als gerade Linie plus eine
 * saubere Spitze (zwei Schenkel à 30°) — zwei Striche.
 */
function asArrow(pts: Pt[]): Pt[][] | null {
  const { w, h } = bbox(pts);
  const size = Math.max(w, h);
  if (size < 40) return null;
  const ecken = vereinfachen(pts, 0.06 * size);
  if (ecken.length < 3 || ecken.length > 6) return null;
  // Schaft: die mit Abstand längste Kante, sie muss vorn stehen
  const kanten = ecken.slice(0, -1).map((p, i) => dist(p, ecken[i + 1]));
  const schaft = kanten[0];
  const rest = kanten.slice(1);
  if (schaft < 30 || rest.some((l) => l > 0.55 * schaft) || rest.length < 1) return null;
  const a = ecken[0], spitze = ecken[1];
  // Schenkel müssen zur Spitze zurückweisen: Winkel zwischen Schaft und Schenkel 20°…75°
  const schaftWinkel = Math.atan2(spitze[1] - a[1], spitze[0] - a[0]);
  for (let i = 1; i < ecken.length - 1; i += 1) {
    const q = ecken[i + 1];
    const wq = Math.atan2(q[1] - spitze[1], q[0] - spitze[0]);
    let diff = Math.abs(((wq - schaftWinkel + Math.PI) % (2 * Math.PI)) - Math.PI); // 0 = weiter geradeaus
    diff = Math.PI - diff; // 0 = exakt zurück
    const grad = (diff * 180) / Math.PI;
    if (i === 1 && (grad < 15 || grad > 80)) return null;
  }
  const len = Math.min(26, 0.3 * schaft);
  const l1 = schaftWinkel + Math.PI - Math.PI / 6, l2 = schaftWinkel + Math.PI + Math.PI / 6;
  const s1: Pt = [spitze[0] + len * Math.cos(l1), spitze[1] + len * Math.sin(l1)];
  const s2: Pt = [spitze[0] + len * Math.cos(l2), spitze[1] + len * Math.sin(l2)];
  return [[a, spitze], [s1, spitze, s2]];
}

/**
 * Großzügige Erkennung fürs „Halten am Ende" — Linie, Rechteck oder Ellipse.
 * null = keine saubere Form erkannt, Strich bleibt wie er ist.
 */
export function recognizeShape(pts: Pt[]): Pt[] | null {
  if (pts.length < 8) return null;
  return asLine(pts, 0.12, 10) ?? asRect(pts) ?? asEllipse(pts) ?? asPolygon(pts);
}

/**
 * M319: Wie `recognizeShape`, liefert aber ein oder mehrere Striche —
 * der Pfeil besteht aus Schaft und Spitze.
 */
export function recognizeShapes(pts: Pt[]): Pt[][] | null {
  if (pts.length < 8) return null;
  const einfach = recognizeShape(pts);
  if (einfach) return [einfach];
  return asArrow(pts);
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
