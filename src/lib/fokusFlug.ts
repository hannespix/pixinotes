/**
 * M227: Der Flug in die Karte und zurück.
 *
 * Vorher wechselte die Ansicht schlagartig: eben noch ein Board voller Karten,
 * im nächsten Bild eine formatfüllende Fläche. Man SAH nicht, welche Karte man
 * getroffen hat — der Zusammenhang zwischen Tipp und Ergebnis fehlte, und
 * gerade das ist auf einem kleinen Schirm die halbe Orientierung.
 *
 * Technik: FLIP (First-Last-Invert-Play). Wir merken uns, wo die Karte VOR dem
 * Wechsel lag (First), lassen den Browser das neue Layout rechnen (Last),
 * setzen die Karte per transform optisch an ihren alten Platz zurück (Invert)
 * und nehmen das transform im nächsten Frame animiert weg (Play).
 *
 * Warum transform und nicht width/height animieren: Ein transform kostet kein
 * Layout. Die Karte enthält einen kompletten Editor beziehungsweise ein
 * Stundenraster — die Maße 60-mal pro Sekunde neu zu rechnen ruckelt garantiert.
 */

export interface Kasten { x: number; y: number; w: number; h: number }

/**
 * Bewegt wird die KARTENFLÄCHE, nicht der React-Flow-Knoten.
 *
 * React Flow schreibt die Position jedes Knotens als Inline-Transform und
 * erneuert sie bei jedem Render — eine eigene Animation dort würde im nächsten
 * Render weggewischt (genau das passierte beim ersten Versuch). Die Karte
 * selbst gehört uns.
 */
export const flaecheVon = (el: Element | null | undefined): HTMLElement | null =>
  (el?.querySelector?.('.card-body') as HTMLElement | null) ?? (el as HTMLElement | null);

/** Zuletzt gemerkter Startpunkt (Board-Platz der Karte) */
let start: Kasten | null = null;

export function merkeKasten(el: Element | null | undefined): void {
  const ziel = flaecheVon(el);
  if (!ziel) { start = null; return; }
  const b = ziel.getBoundingClientRect();
  start = { x: b.x, y: b.y, w: b.width, h: b.height };
}

export function letzterKasten(): Kasten | null {
  return start;
}

/** Bewegt sich hier gerade jemand? Dann keine Animation drüberlegen. */
const reduziert = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Von `von` auf die aktuelle Lage des Elements fliegen.
 *
 * Die Skalierung wird bewusst NICHT verzerrt (ein Faktor für beide Achsen):
 * Eine Notiz, die von 240×150 auf Vollbild springt, würde sonst sichtbar
 * gequetscht — das wirkt billig statt schnell.
 */
export function fliege(el: HTMLElement | null | undefined, von: Kasten | null, ms = 260): void {
  if (!el || !von || reduziert() || typeof el.animate !== 'function') return;
  const b = el.getBoundingClientRect();
  if (b.width < 2 || b.height < 2 || von.w < 2 || von.h < 2) return;
  // Ein Faktor für beide Achsen: Eine Notiz, die von 240×150 auf Vollbild
  // springt, würde sonst sichtbar gequetscht — das wirkt billig statt schnell.
  const k = Math.min(von.w / b.width, von.h / b.height);
  const dx = (von.x + von.w / 2) - (b.x + b.width / 2);
  const dy = (von.y + von.h / 2) - (b.y + b.height / 2);
  // Web Animations statt Inline-Styles: React rendert direkt nach dem Öffnen
  // erneut (die Karte wird ausgewählt, M225) und würde ein style-Attribut
  // dabei wegwischen. Eine laufende Animation überlebt jeden Render.
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0.55 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: ms, easing: 'cubic-bezier(0.22, 0.68, 0.32, 1)', composite: 'replace' },
  );
}
