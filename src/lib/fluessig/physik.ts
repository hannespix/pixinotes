// Herkunft: Liquid Type von Hannes Pix (github.com/hannespix/liquidtype, src/physics.mjs, Stand 02.10.2026).
// M500: für PixiNotes nach TypeScript übertragen, Rechnung unverändert. Änderungen an der Physik bitte dort
// pflegen und hierher übernehmen.
//
// Pixelraum, fester Zeitschritt: lokaler Druck, Zusammenhalt und Zähigkeit. Die Feder zur Schriftform ist bewusst
// künstlerisch – die Flüssigkeit erinnert sich an ihren Buchstaben.

export interface Punkt { x: number; y: number }
/** Physik-Stellgrößen (0..1 bis auf strength); optionale Zusätze wie im Original */
export interface PhysikWerte {
  viscosity: number;
  tension: number;
  attraction: number;
  strength: number;
  gravityX?: number;
  gravityY?: number;
  dripGravity?: number;
  homing?: number;
  drag?: number;
}
/** Ein Pinsel: gedrückter Zeiger oder Magnet über der Schrift */
export interface Pinsel { x: number; y: number; radius: number; down: boolean }

export class Fluid {
  width: number; height: number; spacing: number; n: number; time = 0;
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array;
  tx: Float32Array; ty: Float32Array; ax: Float32Array; ay: Float32Array;
  /** 0..1 löst ein Teilchen von seiner Feder (Tropfen, Platzen) */
  free: Float32Array;
  h: number; cols: number; rows: number;
  start: Int32Array; fillAt: Int32Array; cell: Int32Array; order: Int32Array;

  constructor(points: Punkt[], width: number, height: number, spacing = 6) {
    this.width = width; this.height = height; this.spacing = spacing; this.n = points.length;
    const f = () => new Float32Array(this.n);
    this.x = f(); this.y = f(); this.vx = f(); this.vy = f(); this.tx = f(); this.ty = f(); this.ax = f(); this.ay = f(); this.free = f();
    points.forEach((p, i) => { this.x[i] = this.tx[i] = p.x; this.y[i] = this.ty[i] = p.y; });
    this.h = spacing * 2.4; this.cols = Math.ceil(width / this.h) + 1; this.rows = Math.ceil(height / this.h) + 1;
    // Nachbarschaftsgitter als sortierte Zellen: zusammenhängend schneller zu durchlaufen als verkettete Listen
    const cells = this.cols * this.rows;
    this.start = new Int32Array(cells + 1); this.fillAt = new Int32Array(cells); this.cell = new Int32Array(this.n); this.order = new Int32Array(this.n);
  }

  reset(): void { this.x.set(this.tx); this.y.set(this.ty); this.vx.fill(0); this.vy.fill(0); this.free.fill(0); this.time = 0; }

  impulse(x: number, y: number, dx: number, dy: number, radius: number): void {
    dx = Math.max(-650, Math.min(650, dx)); dy = Math.max(-650, Math.min(650, dy));
    for (let i = 0; i < this.n; i++) {
      const d = Math.hypot(this.x[i] - x, this.y[i] - y);
      if (d < radius) {
        const w = (1 - d / radius) ** 2;
        this.vx[i] = Math.max(-1500, Math.min(1500, this.vx[i] + dx * w));
        this.vy[i] = Math.max(-1500, Math.min(1500, this.vy[i] + dy * w));
      }
    }
  }

  step(dt: number, p: PhysikWerte, pointer: Pinsel | null = null): void {
    dt = Math.max(0, Math.min(1 / 60, dt)); if (!dt) return; this.time += dt;
    const { n, x, y, vx, vy, ax, ay, tx, ty, free, h, cols, rows, start, fillAt, cell, order, spacing: s } = this;
    const gx = p.gravityX || 0, gy = p.gravityY || 0, drip = p.dripGravity || 0, homing = p.homing || 1;
    const cells = cols * rows; start.fill(0);
    const brush = pointer?.down ? pointer : null;
    for (let i = 0; i < n; i++) {
      const c = Math.max(0, Math.min(cols - 1, Math.floor(x[i] / h))) + Math.max(0, Math.min(rows - 1, Math.floor(y[i] / h))) * cols;
      cell[i] = c; start[c + 1]++;
      const bx = x[i] - (brush ? brush.x : 0), by = y[i] - (brush ? brush.y : 0);
      const b = brush ? Math.max(0, 1 - Math.sqrt(bx * bx + by * by) / brush.radius) : 0;
      const hx = tx[i] - x[i], hy = ty[i] - y[i];
      const spring = (22 + 230 * Math.exp(-(hx * hx + hy * hy) / (s * s * 12))) * homing * (1 - 0.98 * b) * (1 - free[i]);
      ax[i] = hx * spring; ay[i] = hy * spring + drip * free[i];
      if (brush) { ax[i] += (brush.x - x[i]) * b * 22 * p.strength; ay[i] += (brush.y - y[i]) * b * 22 * p.strength; }
    }
    for (let c = 0; c < cells; c++) { start[c + 1] += start[c]; fillAt[c] = start[c]; }
    for (let i = 0; i < n; i++) order[fillAt[cell[i]]++] = i;
    const h2 = h * h, core = s * 0.93, bond = 28 + 85 * p.tension + 70 * p.attraction, thick = 0.25 + 3 * p.viscosity;
    // Kräfte zwischen zwei Teilchen in Reichweite; i ist der kleinere Index
    const pair = (a: number, b: number) => {
      const i = a < b ? a : b, j = a < b ? b : a;
      let dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy; if (d2 >= h2) return;
      if (d2 < 0.0001) { dx = (i % 2 ? 1 : -1) * 0.01; dy = 0.007; d2 = dx * dx + dy * dy; }
      const d = Math.sqrt(d2), q = 1 - d / h, nx = dx / d, ny = dy / d;
      const f = (d < core ? -650 * (core - d) : 0) + bond * q;
      const visc = thick * q;
      const rx = tx[j] - tx[i], ry = ty[j] - ty[i], rd = Math.sqrt(rx * rx + ry * ry);
      let restX = 0, restY = 0;
      if (rd > 0.0001 && rd < h) {
        const restForce = (rd < core ? -650 * (core - rd) : 0) + bond * (1 - rd / h);
        restX = rx / rd * restForce; restY = ry / rd * restForce;
      }
      const fx = nx * f - restX + (vx[j] - vx[i]) * visc, fy = ny * f - restY + (vy[j] - vy[i]) * visc;
      ax[i] += fx; ay[i] += fy; ax[j] -= fx; ay[j] -= fy;
    };
    // Jedes Paar einmal: in der Zelle, dann die Zelle rechts und die drei darunter
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const c = cx + cy * cols, a0 = start[c], a1 = start[c + 1]; if (a0 === a1) continue;
      const right = cx + 1 < cols, down = cy + 1 < rows, below = c + cols;
      for (let ai = a0; ai < a1; ai++) {
        const a = order[ai];
        for (let k = ai + 1; k < a1; k++) pair(a, order[k]);
        if (right) for (let k = start[c + 1], e = start[c + 2]; k < e; k++) pair(a, order[k]);
        if (down) {
          if (cx > 0) for (let k = start[below - 1], e = start[below]; k < e; k++) pair(a, order[k]);
          for (let k = start[below], e = start[below + 1]; k < e; k++) pair(a, order[k]);
          if (right) for (let k = start[below + 1], e = start[below + 2]; k < e; k++) pair(a, order[k]);
        }
      }
    }
    const damping = Math.exp(-(1.05 + p.viscosity * 3.4 + (p.drag || 0)) * dt);
    for (let i = 0; i < n; i++) {
      vx[i] = Math.max(-1600, Math.min(1600, (vx[i] + (ax[i] + gx) * dt) * damping));
      vy[i] = Math.max(-1600, Math.min(1600, (vy[i] + (ay[i] + gy) * dt) * damping));
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
      if (x[i] < s) { x[i] = s; vx[i] = Math.abs(vx[i]) * 0.3; } else if (x[i] > this.width - s) { x[i] = this.width - s; vx[i] = -Math.abs(vx[i]) * 0.3; }
      if (y[i] < s) { y[i] = s; vy[i] = Math.abs(vy[i]) * 0.3; } else if (y[i] > this.height - s) { y[i] = this.height - s; vy[i] = -Math.abs(vy[i]) * 0.3; }
    }
  }
}
