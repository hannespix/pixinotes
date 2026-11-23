// Herkunft: Liquid Type von Hannes Pix (github.com/hannespix/liquidtype, src/glyphs.mjs, Stand 02.10.2026).
// M500: nach TypeScript übertragen; nur die Abtastung, die eine einzelne Karte braucht (sampleGlyphs).
import type { Punkt } from './physik';

/** Ein Teilchen je Gitterzelle, in der Tinte liegt (Alpha über `threshold`) */
function latticeScan(rgba: Uint8ClampedArray, stride: number, width: number, height: number, spacing: number, threshold: number): Punkt[] {
  const points: Punkt[] = [];
  for (let y = 0; y < height; y += spacing) for (let x = 0; x < width; x += spacing) {
    let ink = false;
    for (let yy = Math.floor(y); yy < Math.min(height, y + spacing) && !ink; yy++) for (let xx = Math.floor(x); xx < Math.min(width, x + spacing); xx++) {
      if (rgba[(yy * stride + xx) * 4 + 3] > threshold) { ink = true; break; }
    }
    if (ink) points.push({ x: x + spacing * 0.5, y: y + spacing * 0.5 });
  }
  return points;
}

/** Mittlere Strichstärke in px: doppelte Fläche durch Umrisslänge */
export function strokeWidth(rgba: Uint8ClampedArray, stride: number, rows: number): number {
  let area = 0, edge = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < stride; x++) {
    const k = (y * stride + x) * 4 + 3, a = rgba[k] / 255;
    area += a;
    const right = x + 1 < stride ? rgba[k + 4] / 255 : 0, below = y + 1 < rows ? rgba[k + stride * 4] / 255 : 0;
    const ex = right - a, ey = below - a; edge += Math.sqrt(ex * ex + ey * ey);
  }
  return edge > 0 ? 2 * area / edge : 0;
}

export interface Abtastung { points: Punkt[]; spacing: number; material: HTMLCanvasElement; readonly stroke: number }

/**
 * `draw(ctx)` malt die Tinte in CSS-Pixeln; zweimal aufgerufen: einmal 1:1 — die Deckung wird zum Teilchengitter —
 * und einmal hochaufgelöst als Materialtextur für den Zeichner. Nie ein zweites Bild über der Flüssigkeit.
 */
export function sampleGlyphs(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void, budget: number): Abtastung {
  const c = document.createElement('canvas'); c.width = Math.ceil(width); c.height = Math.ceil(height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D-Zeichenfläche nicht verfügbar');
  draw(ctx);
  const material = document.createElement('canvas'); const scale = Math.min(devicePixelRatio || 1, 2);
  material.width = Math.ceil(width * scale); material.height = Math.ceil(height * scale);
  const mc = material.getContext('2d');
  if (mc) { mc.scale(material.width / width, material.height / height); draw(mc); }
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  let area = 0; for (let i = 3; i < rgba.length; i += 4) area += rgba[i] / 255;
  let spacing = Math.max(2.5, Math.sqrt(area / (budget * 0.8)));
  let points: Punkt[] = [];
  // Jede Tintenzelle behält ihre Gitterzelle, auch feine Serifen
  for (let attempt = 0; attempt < 3; attempt++) {
    points = latticeScan(rgba, c.width, Math.floor(width), Math.floor(height), spacing, 0);
    if (points.length <= budget) break;
    spacing *= Math.sqrt(points.length / budget) * 1.03;
  }
  let stroke: number | null = null;
  return { points, spacing, material, get stroke() { return stroke ??= strokeWidth(rgba, c.width, c.height); } };
}
