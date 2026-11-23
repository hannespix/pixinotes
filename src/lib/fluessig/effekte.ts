// Herkunft: Liquid Type von Hannes Pix (github.com/hannespix/liquidtype, src/effects.mjs, Stand 02.10.2026).
// M500: nach TypeScript übertragen, Rechnung unverändert. Kein DOM; Zufallsquellen lassen sich übergeben.
import type { Fluid, PhysikWerte } from './physik';

/** Verstreut jedes Teilchen bis zu `spread` px um sein Ziel, in Ruhe — die Federn ziehen die Schrift zusammen */
export function scatterAround(fluid: Fluid, spread: number, random: () => number = Math.random): void {
  const s = fluid.spacing, cx = (v: number) => Math.max(s, Math.min(fluid.width - s, v)), cy = (v: number) => Math.max(s, Math.min(fluid.height - s, v));
  for (let i = 0; i < fluid.n; i++) {
    const a = random() * Math.PI * 2, d = spread * Math.sqrt(random());
    fluid.x[i] = cx(fluid.tx[i] + Math.cos(a) * d); fluid.y[i] = cy(fluid.ty[i] + Math.sin(a) * d); fluid.vx[i] = fluid.vy[i] = 0;
  }
}

/** Schickt jedes Teilchen von (x, y) weg, je näher, desto schneller */
export function burstFrom(fluid: Fluid, x: number, y: number, speed: number, random: () => number = Math.random): void {
  const R = Math.max(fluid.width, fluid.height);
  for (let i = 0; i < fluid.n; i++) {
    const dx = fluid.x[i] - x, dy = fluid.y[i] - y, d = Math.hypot(dx, dy) || 1, f = 1 - d / R;
    if (f <= 0) continue;
    const v = speed * Math.sqrt(f) * (0.8 + 0.4 * random());
    fluid.vx[i] = Math.max(-1500, Math.min(1500, fluid.vx[i] + dx / d * v));
    fluid.vy[i] = Math.max(-1500, Math.min(1500, fluid.vy[i] + dy / d * v));
  }
}

/** Mittlere Geschwindigkeit der Flüssigkeit in px/s, aus einer Stichprobe */
export function meanSpeed(fluid: Fluid): number {
  let sum = 0, count = 0;
  for (let i = 0; i < fluid.n; i += 37) { sum += Math.hypot(fluid.vx[i], fluid.vy[i]); count++; }
  return count ? sum / count : 0;
}

/** Größte Entfernung eines Teilchens (Stichprobe) von seinem Platz in der Schrift, in px */
export function maxAbstand(fluid: Fluid): number {
  let m = 0;
  for (let i = 0; i < fluid.n; i += 13) { const d = Math.hypot(fluid.x[i] - fluid.tx[i], fluid.y[i] - fluid.ty[i]); if (d > m) m = d; }
  return m;
}

export function isCalm(fluid: Fluid, limit = 25): boolean { return meanSpeed(fluid) < limit; }

/** Die Teilchen eines Tropfens am untersten Rand der Schrift (nach ihren Zielen) */
export function dripIndices(fluid: Fluid, size: number, random: () => number = Math.random): number[] {
  let lowest = -Infinity; for (let i = 0; i < fluid.n; i++) if (fluid.ty[i] > lowest) lowest = fluid.ty[i];
  const bottom: number[] = []; for (let i = 0; i < fluid.n; i++) if (fluid.ty[i] >= lowest - fluid.spacing * 2.5) bottom.push(i);
  if (!bottom.length) return [];
  const seed = bottom[Math.floor(random() * bottom.length)], sx = fluid.tx[seed], sy = fluid.ty[seed], r = fluid.spacing * size;
  const out: number[] = []; for (let i = 0; i < fluid.n; i++) if (Math.hypot(fluid.tx[i] - sx, fluid.ty[i] - sy) < r) out.push(i);
  return out;
}

/** Einschwingphase: blendet Zusatzwerte kurz ein und gegen Ende ruckfrei aus */
export class Settle {
  until = 0; duration = 0; extra: Partial<PhysikWerte> | null = null;
  start(now: number, ms: number, extra: Partial<PhysikWerte>): void { this.until = now + ms; this.duration = ms; this.extra = extra; }
  params(base: PhysikWerte, now: number): PhysikWerte {
    if (now >= this.until || !this.extra) return base;
    const k = Math.min(1, (this.until - now) / Math.max(1, this.duration) * 1.6), out: Record<string, number> = { ...base } as never;
    for (const key in this.extra) {
      const ziel = (this.extra as Record<string, number>)[key], basis = (base as unknown as Record<string, number | undefined>)[key];
      out[key] = basis === undefined ? 1 + (ziel - 1) * k : basis + (ziel - basis) * k;
    }
    return out as unknown as PhysikWerte;
  }
}

/** Wo eine unsichtbare Hand um `centre` nach `s` Sekunden ist: eine langsame Schleife, die sich nie ganz wiederholt */
export const idleHand = (centre: { x: number; y: number; rx: number; ry: number }, s: number) =>
  ({ x: centre.x + Math.cos(s * 0.45) * centre.rx, y: centre.y + Math.sin(s * 0.7) * centre.ry });
