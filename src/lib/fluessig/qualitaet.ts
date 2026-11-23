// Herkunft: Liquid Type von Hannes Pix (github.com/hannespix/liquidtype, src/quality.mjs, Stand 02.10.2026).
// M500: nach TypeScript übertragen. Zwei Regler — Zeichenauflösung (schwacher Grafikchip) und Anteil der Teilchen
// (schwacher Prozessor). Erste Schätzung aus den Gerätemeldungen, danach entscheidet die Bildrate. Regler drehen
// innerhalb eines Besuchs nie zurück, damit das Bild nicht pumpt. Abweichung vom Original: eigener Speicherschlüssel,
// kein `?quality=` aus der Adresse (die gehört PixiNotes).
export const RESOLUTION = [2, 1.5, 1, 0.75];
export const PARTICLES = [1, 0.8, 0.62, 0.48];
const KEY = 'pixinotes-fluessig-qualitaet', SLOW_MS = 22, VERY_SLOW_MS = 40, WINDOW = 40, WARMUP = 45, LONGEST_MS = 250;
const clampLevel = (v: number) => Math.max(0, Math.min(RESOLUTION.length - 1, v | 0));

export function guessLevels(gl: WebGL2RenderingContext | null, floatSurface = true): { res: number; part: number } {
  const nav = globalThis.navigator as Navigator & { deviceMemory?: number };
  const cores = nav?.hardwareConcurrency, memory = nav?.deviceMemory;
  let res = 0, part = 0, name = '';
  try {
    name = String(gl?.getParameter(gl.RENDERER) || '');
    if (/^webkit webgl$/i.test(name)) { const info = gl?.getExtension('WEBGL_debug_renderer_info'); if (info) name = String(gl?.getParameter(info.UNMASKED_RENDERER_WEBGL) || name); }
  } catch { /* Name des Grafikchips ist freiwillig */ }
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) { res = Math.max(res, 2); part = Math.max(part, 1); }
  if (cores && cores > 0 && cores <= 2) part = Math.max(part, 2); else if (cores && cores > 0 && cores <= 4) part = Math.max(part, 1);
  if (memory && memory > 0 && memory <= 2) { part = Math.max(part, 2); res = Math.max(res, 1); } else if (memory && memory > 0 && memory <= 4) res = Math.max(res, 1);
  if (!floatSurface) res = Math.max(res, 1);
  return { res, part };
}

export interface Qualitaet {
  readonly resolution: number;
  readonly particles: number;
  readonly level: { res: number; part: number };
  reset(): void;
  frame(interval: number, work: number): void;
}

/** `onChange` läuft, nachdem ein Regler gedreht hat ('resolution' oder 'particles') */
export function createQuality(gl: WebGL2RenderingContext, { floatSurface = true, onChange = () => {} }: { floatSurface?: boolean; onChange?: (w: { changed: 'resolution' | 'particles' }) => void } = {}): Qualitaet {
  const guess = guessLevels(gl, floatSurface);
  let saved: { res?: number; part?: number } = {};
  try { saved = JSON.parse(globalThis.sessionStorage?.getItem(KEY) || '{}'); } catch { /* Speicher nicht verfügbar */ }
  let res = clampLevel(Math.max(guess.res, saved.res ?? 0)), part = clampLevel(Math.max(guess.part, saved.part ?? 0)), watching = true;
  const intervals: number[] = [], works: number[] = []; let warm = WARMUP;
  const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
  const q: Qualitaet = {
    get resolution() { return RESOLUTION[res]; },
    get particles() { return PARTICLES[part]; },
    get level() { return { res, part }; },
    reset() { intervals.length = works.length = 0; warm = WARMUP; },
    frame(interval, work) {
      if (!watching || !(interval > 0)) return;
      if (interval > LONGEST_MS) { q.reset(); return; }
      if (warm > 0) { warm--; return; }
      intervals.push(interval); works.push(work);
      if (intervals.length < WINDOW) return;
      const spans = sorted(intervals), slow = spans[spans.length >> 1], busy = sorted(works)[works.length >> 1];
      intervals.shift(); works.shift();
      if (slow <= SLOW_MS) return;
      let changed: 'resolution' | 'particles' | null = null;
      // Gleichmäßig um 30 Bilder je Sekunde bei wenig eigener Arbeit: eher ein gedrosselter Schirm als ein schwaches Gerät
      const steady = slow > 28 && slow < 38 && spans[Math.floor(spans.length * 0.9)] - spans[Math.floor(spans.length * 0.1)] < 4 && busy < slow * 0.3;
      if (steady) { if (res > 0) { watching = false; return; } res++; changed = 'resolution'; }
      else {
        const room = (level: number) => level < RESOLUTION.length - 2 || (level < RESOLUTION.length - 1 && slow > VERY_SLOW_MS);
        if (busy > slow * 0.55 && room(part)) { part++; changed = 'particles'; }
        else if (room(res)) { res++; changed = 'resolution'; }
        else if (room(part)) { part++; changed = 'particles'; }
        if (!changed) { if (res === RESOLUTION.length - 1 && part === PARTICLES.length - 1) watching = false; return; }
      }
      try { globalThis.sessionStorage?.setItem(KEY, JSON.stringify({ res, part })); } catch { /* Speicher nicht verfügbar */ }
      q.reset();
      onChange({ changed });
    },
  };
  return q;
}
