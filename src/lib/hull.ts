/**
 * M221: Weiche Hüllen um Punktgruppen — die Gliederung als „Gelände".
 *
 * Bereiche und Projekte werden im Netz NICHT zu weiteren Knoten. Drei
 * Knotenarten würden um Aufmerksamkeit kämpfen, und das Netz würde genau das
 * unlesbare Fadenknäuel, das große Graphen sonst werden. Stattdessen liegen
 * die Board-Knoten auf eingefärbten Flächen — wie Länder auf einer Landkarte.
 * Struktur im Hintergrund, Inhalt im Vordergrund.
 *
 * Der Weg dorthin: konvexe Hülle (Andrew's Monotone Chain), nach außen
 * aufgeblasen, dann als geschlossene Catmull-Rom-Kurve gezeichnet. Das Ergebnis
 * wirkt organisch statt technisch — wichtig, damit die Flächen als Untergrund
 * gelesen werden und nicht als weitere Objekte.
 */

export interface Pt { x: number; y: number }

/** Konvexe Hülle gegen den Uhrzeigersinn (Andrew's Monotone Chain, O(n log n)) */
export function convexHull(pts: Pt[]): Pt[] {
  if (pts.length < 3) return [...pts];
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (src: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** Hülle nach außen schieben, damit die Knoten Luft haben */
function inflate(hull: Pt[], pad: number): Pt[] {
  if (hull.length === 0) return hull;
  const cx = hull.reduce((a, p) => a + p.x, 0) / hull.length;
  const cy = hull.reduce((a, p) => a + p.y, 0) / hull.length;
  return hull.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * pad, y: p.y + (dy / len) * pad };
  });
}

/** Geschlossene, glatte Kurve durch die Punkte (Catmull-Rom → kubische Bézier) */
function smoothPath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const at = (i: number) => pts[((i % n) + n) % n];
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    // Catmull-Rom mit Spannung 1/6 — genug Rundung, ohne auszubeulen
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

/**
 * Fertiger SVG-Pfad für eine Punktgruppe.
 *
 * Sonderfälle bewusst behandelt: Ein einzelner Knoten bekommt einen Kreis,
 * zwei Knoten eine Kapsel — sonst hätte ein Projekt mit einem Board gar keine
 * sichtbare Heimat, und genau die soll die Karte ja zeigen.
 */
export function hullPath(points: Pt[], pad = 46): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const { x, y } = points[0];
    return `M ${x - pad} ${y} a ${pad} ${pad} 0 1 0 ${pad * 2} 0 a ${pad} ${pad} 0 1 0 ${-pad * 2} 0 Z`;
  }
  if (points.length === 2) {
    // Zwei Punkte: Rechteck quer zur Verbindung, an den Enden gerundet
    const [a, b] = points;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * pad;
    const ny = (dx / len) * pad;
    return smoothPath(inflate([
      { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny },
    ], pad * 0.35));
  }
  return smoothPath(inflate(convexHull(points), pad));
}

/** Mittelpunkt einer Punktgruppe — Ankerpunkt für die Beschriftung */
export function centroid(points: Pt[]): Pt {
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((a, p) => a + p.x, 0) / points.length,
    y: points.reduce((a, p) => a + p.y, 0) / points.length,
  };
}

/** Oberster Punkt — dort sitzt die Beschriftung, damit sie nichts verdeckt */
export function topAnchor(points: Pt[], pad = 46): Pt {
  const c = centroid(points);
  const top = Math.min(...points.map((p) => p.y));
  return { x: c.x, y: top - pad - 10 };
}
