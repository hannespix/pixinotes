// M400: Karten schräg legen. Der Winkel steht an der Karte (`winkel`, Grad, im Uhrzeigersinn) und dreht sie
// um ihre Mitte. Position und Größe bleiben die der GERADEN Karte: Alles, was mit Kästen rechnet (Auswahl,
// Rahmen, Anordnen, Übersicht), arbeitet weiter wie bisher; nur Zeichnung, Verbindungen, Pins und Griffe
// folgen der Drehung.
import type { AppNode } from '../types';

/** Karten, die sich drehen lassen: Zettel, Bilder, Mails, Portale. Module mit eigener Bedienung im Innern
 *  (Kanban, Zeitplan, Kalender, Tabelle …) bleiben gerade – dort säßen Ziehen und Tippen sonst schief. */
const DREHBAR = new Set(['note', 'image', 'email', 'portal']);
export function istDrehbar(n: Pick<AppNode, 'type' | 'data'> | undefined | null): boolean {
  if (!n) return false;
  if (DREHBAR.has(n.type ?? '')) return true;
  // Bild als Datei-Karte (randlos): dreht sich wie ein Foto; aufklappbare Dokumente bleiben gerade
  if (n.type !== 'file') return false;
  const d = n.data as { name?: string; mime?: string } | undefined;
  return /^image\//i.test(d?.mime ?? '') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(d?.name ?? '');
}

/** Winkel einer Karte in Grad (−180 … 180], 0 = gerade */
export const winkelVon = (n: { winkel?: number } | undefined | null): number => (typeof n?.winkel === 'number' && Number.isFinite(n.winkel) ? n.winkel : 0);

/** auf (−180, 180] bringen, auf Zehntel gerundet; Winzigkeiten zählen als gerade */
export function winkelNorm(grad: number): number {
  let w = ((grad % 360) + 360) % 360;
  if (w > 180) w -= 360;
  w = Math.round(w * 10) / 10;
  return Math.abs(w) < 0.05 ? 0 : w;
}

/** Beim Ziehen rastet der Winkel an Vielfachen von 15° ein (innerhalb von 3°) – mit `frei` nicht */
export function winkelRaste(grad: number, frei = false): number {
  const w = winkelNorm(grad);
  if (frei) return w;
  const naechste = Math.round(w / 15) * 15;
  return Math.abs(w - naechste) <= 3 ? winkelNorm(naechste) : Math.round(w);
}

export type Punkt = { x: number; y: number };
/** Punkt um eine Mitte drehen (Grad, im Uhrzeigersinn in Bildschirm-Koordinaten) */
export function drehe(p: Punkt, um: Punkt, grad: number): Punkt {
  if (!grad) return p;
  const r = (grad * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r);
  const dx = p.x - um.x; const dy = p.y - um.y;
  return { x: um.x + dx * c - dy * s, y: um.y + dx * s + dy * c };
}

/**
 * Größe ändern an einer gedrehten Karte: Der Zeiger bewegt sich auf dem Bildschirm, die Karte wächst in IHREN
 * Achsen, und die gegenüberliegende Ecke bleibt stehen. Liefert neue Position (der geraden Karte) und Größe.
 * `ecke`: welche Ecke gezogen wird (x: −1 links / 1 rechts, y: −1 oben / 1 unten).
 */
export function groesseGedreht(
  start: { x: number; y: number; w: number; h: number }, grad: number, ecke: { x: -1 | 1; y: -1 | 1 },
  zug: Punkt, grenzen: { minW: number; minH: number; verhaeltnis?: boolean },
): { x: number; y: number; w: number; h: number } {
  // Zug in die Achsen der Karte drehen
  const lokal = drehe(zug, { x: 0, y: 0 }, -grad);
  let w = Math.max(grenzen.minW, start.w + ecke.x * lokal.x);
  let h = Math.max(grenzen.minH, start.h + ecke.y * lokal.y);
  if (grenzen.verhaeltnis && start.w > 0 && start.h > 0) {
    const f = Math.max(w / start.w, h / start.h, grenzen.minW / start.w, grenzen.minH / start.h);
    w = start.w * f; h = start.h * f;
  }
  // Die feste (gegenüberliegende) Ecke in der Welt – vorher wie nachher dieselbe Stelle
  const mitte0 = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
  const fest = drehe({ x: mitte0.x - (ecke.x * start.w) / 2, y: mitte0.y - (ecke.y * start.h) / 2 }, mitte0, grad);
  // neue Mitte = feste Ecke + halbe neue Diagonale (gedreht)
  const halb = drehe({ x: (ecke.x * w) / 2, y: (ecke.y * h) / 2 }, { x: 0, y: 0 }, grad);
  const mitte = { x: fest.x + halb.x, y: fest.y + halb.y };
  return { x: mitte.x - w / 2, y: mitte.y - h / 2, w, h };
}
