// M339: Lange Notizen scrollen in der Karte — und was auf dem Text liegt, haftet am Text.
//
// Der Kartenkörper einer Notiz ist ein Scrollbereich. Ein Strich (Stift, Textmarker), der beim
// Absetzen ganz auf dem sichtbaren Text liegt, gehört zum TEXT (`amText`): Seine Punkte sind
// dann Inhaltspunkte — relativ zur Kartenecke bei Scrollstand 0 —, er wird IN der Notiz
// gezeichnet (nodes/NotizStriche.tsx) und scrollt so von selbst mit, sauber am Kartenrand
// beschnitten. Zusätzlich merkt er sich den Absatz unter sich (`block`, `blockY`): Rückt der
// Absatz, weil darüber Text dazukommt oder wegfällt, rückt der Strich mit.
// Was über den Kartenrand hinausragt (ein Pfeil zur Nachbarkarte), bleibt wie bisher an der
// KARTE verankert und liegt in der Zeichenebene über dem Board.
//
// Hier steht, was Zeichenebene, Radierer und Handschrift dafür wissen müssen: wo der
// Scrollbereich einer Notiz gerade steht — gelesen aus dem DOM, wenn es gebraucht wird.
import type { Stroke } from '../store';

const rollen = new Map<string, HTMLElement>();

/** Die Notiz meldet ihren Scrollbereich (den Kartenkörper) an bzw. ab */
export function rolleMelden(nodeId: string, el: HTMLElement | null): void {
  if (el) rollen.set(nodeId, el); else rollen.delete(nodeId);
}
export function rolleVon(nodeId: string): HTMLElement | undefined {
  return rollen.get(nodeId);
}

export interface TextLage {
  /** Scrollstand in Inhaltspunkten */
  scroll: number;
  /** Sichtbarer Bereich des Scrollbereichs, relativ zur Kartenecke */
  w: number;
  h: number;
  /** Höhe des ganzen Inhalts */
  inhalt: number;
}

/** Maßstab Bildschirm ↔ Inhalt (Board-Zoom) und Bildschirm-Lage des Scrollbereichs */
function mass(el: HTMLElement): { k: number; r: DOMRect } {
  const r = el.getBoundingClientRect();
  return { k: el.offsetWidth > 0 ? r.width / el.offsetWidth : 1, r };
}

export function textLage(nodeId: string): TextLage | null {
  const el = rollen.get(nodeId);
  if (!el || !el.isConnected) return null;
  return { scroll: el.scrollTop, w: el.clientWidth, h: el.clientHeight, inhalt: el.scrollHeight };
}

const blockEl = (el: HTMLElement, blockId: string): HTMLElement | null => {
  for (const b of Array.from(el.querySelectorAll('.bn-block[data-id]')) as HTMLElement[]) if (b.dataset.id === blockId) return b;
  return null;
};

/** Oberkante eines Absatzes in Inhaltspunkten — null, wenn es ihn (gerade) nicht gibt */
export function blockOben(nodeId: string, blockId: string): number | null {
  const el = rollen.get(nodeId);
  if (!el || !el.isConnected) return null;
  const b = blockEl(el, blockId);
  if (!b) return null;
  const { k, r } = mass(el);
  const br = b.getBoundingClientRect();
  if (br.width === 0 && br.height === 0) return null; // nicht vermessbar (Fern-Ruhe)
  return (br.top - r.top) / (k || 1) + el.scrollTop;
}

/** Der Absatz auf Höhe `y` (Inhaltspunkte) — sonst der nächstgelegene darüber */
export function blockBei(nodeId: string, y: number): { id: string; oben: number } | null {
  const el = rollen.get(nodeId);
  if (!el || !el.isConnected) return null;
  const { k, r } = mass(el);
  let best: { id: string; oben: number } | null = null;
  for (const b of Array.from(el.querySelectorAll('.bn-block[data-id]')) as HTMLElement[]) {
    // nur Blätter: ein Absatz mit Unterpunkten umschließt diese, der Unterpunkt selbst ist genauer
    const br = (b.querySelector(':scope > .bn-block-content') ?? b).getBoundingClientRect();
    if (br.height === 0) continue;
    const oben = (br.top - r.top) / (k || 1) + el.scrollTop;
    const unten = oben + br.height / (k || 1);
    if (y >= oben && y <= unten) return { id: b.dataset.id!, oben };
    if (oben <= y && (!best || oben > best.oben)) best = { id: b.dataset.id!, oben };
  }
  return best;
}

/* ---------- Welche Striche gehören zum Text? ---------- */

interface Kasten { minX: number; minY: number; maxX: number; maxY: number }
export function strichKasten(points: [number, number][], rand = 0): Kasten {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX: minX - rand, minY: minY - rand, maxX: maxX + rand, maxY: maxY + rand };
}
/** Liegt der Kasten ganz in der Fläche 0…w × 0…h? (`h` unbekannt: nach unten offen) */
export function kastenInnen(k: Kasten, w: number, h: number | undefined, spiel = 3): boolean {
  return k.minX >= -spiel && k.maxX <= w + spiel && k.minY >= -spiel && (h == null || k.maxY <= h + spiel);
}

/**
 * Gehört der Strich zum Text seiner Notiz? Neue Striche tragen die Antwort (`amText`).
 * Ältere (vor M339 gab es kein Scrollen) gehören dazu, wenn sie ganz auf der Karte liegen —
 * `w`/`h` sind die Kartenmaße; `h` fehlt bei Notizen ohne feste Höhe (sie reichten bis zum Ende
 * ihres Inhalts). Vor dem ersten Verkleinern schreibt der Speicher das fest.
 */
export function istAmText(s: Stroke, istNotiz: boolean, w: number, h: number | undefined): boolean {
  if (!s.anchor || s.seite != null || !istNotiz) return false;
  if (s.amText != null) return s.amText;
  if (s.points.length === 0) return false;
  return kastenInnen(strichKasten(s.points, s.width / 2), w, h);
}

/** Zuletzt bekannter Versatz je Strich — hält die Stelle, wenn der Absatz gelöscht wurde */
const letzterVersatz = new WeakMap<Stroke, number>();
const versatzNachId = new Map<string, number>();

/** Um wie viel ist der Absatz des Strichs seit dem Zeichnen gerückt? (Inhaltspunkte) */
export function absatzVersatz(s: Stroke): number {
  if (!s.anchor || !s.block || s.blockY == null) return 0;
  const oben = blockOben(s.anchor, s.block);
  if (oben == null) return letzterVersatz.get(s) ?? versatzNachId.get(s.id) ?? 0;
  const d = Math.round((oben - s.blockY) * 10) / 10;
  letzterVersatz.set(s, d);
  versatzNachId.set(s.id, d);
  return d;
}

/**
 * Senkrechter Versatz eines Text-Strichs von seinen gespeicherten Inhaltspunkten zur Lage
 * relativ zur Kartenecke, wie man ihn gerade SIEHT: Absatz gerückt, Notiz gescrollt.
 */
export function textVersatz(s: Stroke): number {
  if (!s.anchor) return 0;
  const el = rollen.get(s.anchor);
  if (!el || !el.isConnected) return 0;
  if (s.amText == null) {
    // ältere Striche: nur wenn sie ganz auf der Karte liegen (siehe istAmText)
    if (s.seite != null || !kastenInnen(strichKasten(s.points, s.width / 2), el.offsetWidth, el.parentElement?.hasAttribute('data-ohne-hoehe') ? undefined : el.offsetHeight)) return 0;
  } else if (!s.amText) return 0;
  return absatzVersatz(s) - el.scrollTop;
}
