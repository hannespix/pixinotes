/**
 * M494: Schrift auf frei gewählten Farben — automatisch lesbar (≥ 4,5:1, WCAG 1.4.3).
 *
 * Gantt-Balken, Kalender-Streifen und freie Wochenplan-Blöcke tragen eine Farbe, die der Nutzer wählt. Vorher
 * stand darauf fest weiße Schrift (Gantt-Blau über Weiß gemischt: 2,9:1) bzw. die Blockfarbe selbst als Schrift
 * (im Dunkeln kaum lesbar). Hier entscheidet die Helligkeit der tatsächlich gezeichneten Fläche:
 *   - `lesbareSchrift(fläche)` wählt zwischen heller und dunkler Schrift (Tokens `--auf-farbe-*`),
 *   - `farbeAlsSchrift(farbe, grund)` behält den Farbton einer farbigen Schrift und hellt bzw. dunkelt ihn nur so
 *     weit ab, bis er auf seinem Grund lesbar ist.
 * Halbdurchsichtige Flächen (`deckkraft`) werden wie im Browser über ihren Grund gemischt. Den Grund liefert
 * `tokenFarbe('--surface-card')` aus dem aktuellen Thema; `useThema()` zeichnet bei einem Wechsel neu.
 */
import { useSyncExternalStore } from 'react';

export type Rgb = [number, number, number];

/** Schriftfarben auf einer Farbfläche — dieselben Werte wie die Tokens `--auf-farbe-*` in styles/00-tokens.css */
const HELL: Rgb = [255, 255, 255];
const DUNKEL: Rgb = [22, 25, 30];
const SCHWARZ: Rgb = [0, 0, 0];
export const GRENZE = 4.5;

/** „#rgb", „#rrggbb", „#rrggbbaa", „rgb(…)"/„rgba(…)" → [r, g, b] (Alpha zählt hier nicht); sonst null */
export function farbeZuRgb(farbe: string | undefined | null): Rgb | null {
  if (!farbe) return null;
  const s = farbe.trim();
  const h = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (h) {
    const x = h[1];
    if (x.length === 3 || x.length === 4) return [0, 1, 2].map((i) => parseInt(x[i] + x[i], 16)) as Rgb;
    if (x.length === 6 || x.length === 8) return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as Rgb;
    return null;
  }
  const r = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null;
}

export const rgbZuHex = (c: Rgb) => `#${c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')}`;

/** Relative Leuchtdichte nach WCAG 2.x */
export function leuchtdichte([r, g, b]: Rgb): number {
  const k = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
}

export function kontrast(a: Rgb, b: Rgb): number {
  const A = leuchtdichte(a); const B = leuchtdichte(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

/** `oben` mit `anteil` (0…1) über `unten` — so zeichnet der Browser eine halbdurchsichtige Fläche */
export const mischen = (oben: Rgb, unten: Rgb, anteil: number): Rgb =>
  [0, 1, 2].map((i) => oben[i] * anteil + unten[i] * (1 - anteil)) as Rgb;

/** Wert eines Farb-Tokens im aktuellen Thema (z. B. `--surface-card`); ohne DOM oder unbekannt: `ersatz` */
export function tokenFarbe(name: string, ersatz = '#ffffff'): string {
  if (typeof document === 'undefined') return ersatz;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return farbeZuRgb(v) ? v : ersatz;
}

/** Alpha einer Farbangabe („rgba(…, 0.08)", „#rrggbbaa"); deckend = 1 */
export function farbAlpha(farbe: string): number {
  const s = farbe.trim();
  const r = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (r) {
    const t = r[1].split(/[\s,/]+/).filter(Boolean);
    if (t.length < 4) return 1;
    return t[3].endsWith('%') ? parseFloat(t[3]) / 100 : Number(t[3]);
  }
  const h = /^#([0-9a-f]{8})$/i.exec(s);
  return h ? parseInt(h[1].slice(6, 8), 16) / 255 : 1;
}

/**
 * Grund aus mehreren Token-Schichten, unten zuerst — z. B. `['--surface', '--surface-dim']` für eine leicht getönte
 * Fläche über der Karte. Halbdurchsichtige Schichten werden gemischt wie im Browser. Liefert Hex.
 */
export function geschichteterGrund(tokens: string[], ersatz = '#ffffff'): string {
  let c: Rgb = farbeZuRgb(ersatz) ?? HELL;
  for (const t of tokens) {
    if (typeof document === 'undefined') break;
    const v = getComputedStyle(document.documentElement).getPropertyValue(t).trim();
    const f = farbeZuRgb(v);
    if (f) c = mischen(f, c, farbAlpha(v));
  }
  return rgbZuHex(c);
}

/** Die Fläche, wie sie gezeichnet wird: mit `deckkraft` < 1 über den `grund` gemischt */
export function gezeichneteFlaeche(flaeche: string, opt: { grund?: string; deckkraft?: number } = {}): Rgb | null {
  const f = farbeZuRgb(flaeche);
  if (!f) return null;
  const d = opt.deckkraft ?? 1;
  if (d >= 1) return f;
  return mischen(f, farbeZuRgb(opt.grund ?? '#ffffff') ?? HELL, d);
}

/** Welche der drei Schriften auf der Fläche steht: 'hell', 'dunkel' oder — wenn beide knapp scheitern — 'schwarz' */
export function schriftArt(flaeche: Rgb): 'hell' | 'dunkel' | 'schwarz' {
  const h = kontrast(HELL, flaeche); const d = kontrast(DUNKEL, flaeche);
  if (Math.max(h, d) >= GRENZE) return h >= d ? 'hell' : 'dunkel';
  // Mittlere Helligkeit (Leuchtdichte um 0,2): Weiß und Tinte bleiben beide knapp unter 4,5:1, reines Schwarz
  // erreicht dort immer mindestens 4,58:1
  return kontrast(SCHWARZ, flaeche) >= h ? 'schwarz' : 'hell';
}

const SCHRIFT: Record<ReturnType<typeof schriftArt>, string> = {
  hell: 'var(--auf-farbe-hell, #ffffff)',
  dunkel: 'var(--auf-farbe-dunkel, #16191e)',
  schwarz: 'var(--auf-farbe-schwarz, #000000)',
};
const SCHRIFT_RGB: Record<ReturnType<typeof schriftArt>, Rgb> = { hell: HELL, dunkel: DUNKEL, schwarz: SCHWARZ };

/** CSS-Farbe (Token) zu einer Schrift-Art aus `schriftArt` */
export const schriftFarbe = (art: ReturnType<typeof schriftArt>) => SCHRIFT[art];

/**
 * Schriftfarbe (CSS, als Token) für Text auf der Fläche `flaeche` — ≥ 4,5:1, solange die Fläche deckend gezeichnet
 * wird; mit `deckkraft` < 1 wird sie über `grund` gemischt. Unbekannte Farbe: dunkle Schrift.
 */
export function lesbareSchrift(flaeche: string | undefined, opt: { grund?: string; deckkraft?: number } = {}): string {
  const f = flaeche ? gezeichneteFlaeche(flaeche, opt) : null;
  return SCHRIFT[f ? schriftArt(f) : 'dunkel'];
}

/** Dieselbe Entscheidung als Farbwert (für Messungen und Fälle ohne CSS-Variablen) */
export function lesbareSchriftRgb(flaeche: Rgb): Rgb { return SCHRIFT_RGB[schriftArt(flaeche)]; }

/**
 * Eine farbige Schrift (Nutzerfarbe, Palettenfarbe) auf `grund` lesbar machen, ohne den Farbton zu verlieren:
 * Reicht der Kontrast nicht, wird die Farbe in kleinen Schritten zu Schwarz (heller Grund) bzw. zu Weiß
 * (dunkler Grund) gemischt, bis sie ≥ `grenze` hat. Liefert Hex.
 */
export function farbeAlsSchrift(farbe: string, grund: string | string[], grenze = GRENZE): string {
  const f = farbeZuRgb(farbe);
  // Mehrere Gründe (z. B. Menü- und Kartenfläche): die Schrift muss auf jedem lesbar sein
  const gruende = (Array.isArray(grund) ? grund : [grund]).map(farbeZuRgb).filter((g): g is Rgb => !!g);
  if (!f || !gruende.length) return farbe;
  const reicht = (c: Rgb) => gruende.every((g) => kontrast(c, g) >= grenze);
  if (reicht(f)) return farbe;
  const hellerGrund = gruende.reduce((s, g) => s + leuchtdichte(g), 0) / gruende.length > 0.18;
  const ziel = hellerGrund ? SCHWARZ : HELL;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mischen(ziel, f, t);
    if (reicht(c)) return rgbZuHex(c);
  }
  return rgbZuHex(ziel);
}

/** Ob eine (berechnete) Schriftfarbe hell ist — dann gehört eine Marke darunter dunkel, nicht weiß */
export const istHell = (farbe: string) => { const c = farbeZuRgb(farbe); return !!c && leuchtdichte(c) > 0.18; };

// ---------- Thema beobachten (Hell/Dunkel wechselt zur Laufzeit) ----------
const themaJetzt = () => (typeof document === 'undefined' ? 'light' : document.documentElement.dataset.theme ?? 'light');
function themaAbonnieren(neu: () => void) {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const mo = new MutationObserver(neu);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
/** Aktuelles Thema ('light' | 'dark'); die Komponente zeichnet neu, sobald es wechselt */
export const useThema = () => useSyncExternalStore(themaAbonnieren, themaJetzt, () => 'light');
