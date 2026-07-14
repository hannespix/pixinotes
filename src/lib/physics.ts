// Kollisionsgeometrie für die Karten-Physik: Verdrängung à la FigJam.
// Karten sind achsenparallele Rechtecke; überlappt ein „Schieber" eine
// andere Karte (plus Wunschabstand), wird sie entlang der Achse mit der
// geringsten Eindringtiefe hinausgedrückt.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Minimaler Verschiebe-Vektor, um `other` aus `pusher` (+`gap` Abstand)
 * herauszudrücken — oder null, wenn sich beide nicht zu nahe kommen.
 */
export function computePush(pusher: Rect, other: Rect, gap = 12): [number, number] | null {
  const ox = Math.min(pusher.x + pusher.w, other.x + other.w) - Math.max(pusher.x, other.x);
  const oy = Math.min(pusher.y + pusher.h, other.y + other.h) - Math.max(pusher.y, other.y);
  const px = ox + gap;
  const py = oy + gap;
  if (px <= 0 || py <= 0) return null;

  const cxp = pusher.x + pusher.w / 2;
  const cyp = pusher.y + pusher.h / 2;
  const cxo = other.x + other.w / 2;
  const cyo = other.y + other.h / 2;
  if (px < py) return [Math.sign(cxo - cxp || 1) * px, 0];
  return [0, Math.sign(cyo - cyp || 1) * py];
}
