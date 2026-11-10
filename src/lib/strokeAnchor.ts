import type { AppNode } from '../types';
import type { Stroke } from '../store';
import { aufSeite, offeneSeite, strichRelativ } from './pdfSeiten';
import { blockBei, kastenInnen, strichKasten, textLage } from './notizText';

/**
 * M127: Freihand-Striche an Karten ankern. Ein Strich, der beim Absetzen
 * überwiegend auf einer Karte liegt, gehört zu ihr: seine Punkte werden
 * RELATIV zur Karten-Ecke gespeichert, damit er bei jedem Bewegungspfad
 * (Drag, Physik, Aufräumen, KI-Anordnung) automatisch mitwandert —
 * ganz ohne Hooks in den einzelnen Bewegungs-Codepfaden.
 */

const FALLBACK_W = 260;
const FALLBACK_H = 160;
/** Mindestanteil der Strich-Fläche auf der Karte — bewusst NIEDRIG (M129):
 *  schon eine kleine, sichtbare Überlappung weist die Zeichnung der Karte zu;
 *  frei bleibt nur, was gar keine Karte berührt. Die 2 % filtern lediglich
 *  Pixel-Streifschüsse an Kartenrändern heraus. */
const MIN_SHARE = 0.02;
/** Geraden hätten Fläche 0 — Mindestausdehnung gibt ihnen eine faire Box */
const MIN_EXTENT = 14;

interface Rect { x: number; y: number; w: number; h: number }

const nodeRect = (n: AppNode): Rect => ({
  x: n.position.x,
  y: n.position.y,
  w: n.width ?? n.measured?.width ?? FALLBACK_W,
  h: n.height ?? n.measured?.height ?? FALLBACK_H,
});

const strokeRect = (points: [number, number][]): Rect => {
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const [x, y] of points) {
    if (x < x1) x1 = x; if (x > x2) x2 = x;
    if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  if (x2 - x1 < MIN_EXTENT) { const c = (x1 + x2) / 2; x1 = c - MIN_EXTENT / 2; x2 = c + MIN_EXTENT / 2; }
  if (y2 - y1 < MIN_EXTENT) { const c = (y1 + y2) / 2; y1 = c - MIN_EXTENT / 2; y2 = c + MIN_EXTENT / 2; }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Karte mit der größten Schnittmenge finden — schon eine kleine sichtbare
 * Überlappung genügt (M129); frei bleibt nur, was keine Karte berührt.
 */
export function findAnchorNode(points: [number, number][], nodes: AppNode[]): AppNode | null {
  if (points.length === 0) return null;
  const sr = strokeRect(points);
  const area = sr.w * sr.h;
  let best: AppNode | null = null;
  let bestArea = 0;
  for (const n of nodes) {
    if (n.archived || n.type === 'frame') continue; // Rahmen ankern keine Striche (M149)
    const a = overlapArea(sr, nodeRect(n));
    if (a > bestArea) { bestArea = a; best = n; }
  }
  return best && bestArea >= area * MIN_SHARE ? best : null;
}

/** Strich ggf. ankern: Punkte werden dann relativ zur Karten-Ecke gespeichert */
export function anchorStroke(stroke: Stroke, nodes: AppNode[]): Stroke {
  if (stroke.anchor) return stroke;
  const n = findAnchorNode(stroke.points, nodes);
  if (!n) return stroke;
  return anSeite({
    ...stroke,
    anchor: n.id,
    points: stroke.points.map(([x, y]) => [x - n.position.x, y - n.position.y] as [number, number]),
  });
}

/** M335: Liegt die Karte als aufgeklappte PDF-Seite vor, gehört der Strich zur Seite (Seitenpunkte) */
function anSeite(s: Stroke): Stroke {
  if (!s.anchor) return s;
  const g = offeneSeite(s.anchor);
  if (!g) return s.seite != null ? { ...s, seite: undefined } : s;
  return { ...s, seite: g.seite, points: aufSeite(s.points, g) };
}

/** Zwei Strich-Boxen gelten als „berührend", wenn sie sich (aufgebläht) schneiden */
const TOUCH_DIST = 24;

const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });
const rectsTouch = (a: Rect, b: Rect) => overlapArea(inflate(a, TOUCH_DIST / 2), inflate(b, TOUCH_DIST / 2)) > 0;

/** Punkte eines (ggf. geankerten) Strichs in absolute Board-Koordinaten */
const absPoints = (s: Stroke, byId: Map<string, AppNode>): [number, number][] => {
  if (!s.anchor) return s.points;
  const n = byId.get(s.anchor);
  const rel = strichRelativ(s); // M335: Seitenstriche in Kartenpunkte (leer, wenn verdeckt)
  return n ? rel.map(([x, y]) => [x + n.position.x, y + n.position.y] as [number, number]) : rel;
};

/**
 * M128: Neuen Strich einfügen — aber GRUPPENWEISE ankern. Striche derselben
 * Zeichensitzung, die sich berühren (z. B. ein Pfeil aus Schaft + Spitze),
 * bilden eine zusammenhängende Zeichnung: Überlappt die GESAMTE Gruppe eine
 * Karte sichtbar, ankern alle an der Karte mit der größten Schnittmenge;
 * berührt sie keine, bleibt sie komplett frei (auch schon geankerte
 * Sitzungs-Striche werden dann wieder gelöst). So kann eine Kartenbewegung
 * nie eine Zeichnung zerreißen. Striche aus früheren Sitzungen bleiben
 * unangetastet.
 */
export function integrateStroke(
  stroke: Stroke,
  drawings: Stroke[],
  sessionIds: string[],
  nodes: AppNode[],
): { drawings: Stroke[]; anchor: string | null } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const session = new Set(sessionIds);
  const candidates = drawings.filter((s) => session.has(s.id) && absPoints(s, byId).length > 0);

  // Zusammenhangskomponente des neuen Strichs unter den Sitzungs-Strichen
  const boxes = new Map<string, Rect>(candidates.map((s) => [s.id, strokeRect(absPoints(s, byId))]));
  const newBox = strokeRect(stroke.points);
  const component: Stroke[] = [];
  const queue: Rect[] = [newBox];
  const remaining = new Set(candidates);
  while (queue.length) {
    const box = queue.pop()!;
    for (const s of [...remaining]) {
      if (rectsTouch(box, boxes.get(s.id)!)) {
        remaining.delete(s);
        component.push(s);
        queue.push(boxes.get(s.id)!);
      }
    }
  }

  // Gesamtdeckung der Gruppe je Karte (flächengewichtet über alle Strich-Boxen)
  const allBoxes = [newBox, ...component.map((s) => boxes.get(s.id)!)];
  const totalArea = allBoxes.reduce((sum, r) => sum + r.w * r.h, 0);
  let best: AppNode | null = null;
  let bestArea = 0;
  for (const n of nodes) {
    if (n.archived || n.type === 'frame') continue; // Rahmen ankern keine Striche (M149)
    const nr = nodeRect(n);
    const a = allBoxes.reduce((sum, r) => sum + overlapArea(r, nr), 0);
    if (a > bestArea) { bestArea = a; best = n; }
  }
  const target = best && bestArea >= totalArea * MIN_SHARE ? best : null;

  const componentIds = new Set(component.map((s) => s.id));
  // Absolute Punkte der ganzen Gruppe — VOR dem Umhängen gelesen (danach gelten neue Bezüge)
  const gruppe: Array<{ s: Stroke; abs: [number, number][] }> = [
    ...component.map((s) => ({ s, abs: absPoints(s, byId) })),
    { s: stroke, abs: stroke.points },
  ];
  /**
   * M339: Liegt die ganze Gruppe auf dem sichtbaren Text einer Notiz, gehört sie zum TEXT:
   * Inhaltspunkte (Scrollstand eingerechnet) und der Absatz unter ihrer Mitte als Bezug —
   * für alle Striche der Gruppe derselbe, damit ein Pfeil nicht auseinanderläuft.
   */
  let text: { scroll: number; block?: string; blockY?: number } | null = null;
  let notizDa = false; // Notiz mit vermessbarem Scrollbereich — nur dann ist „nicht am Text" eine Aussage
  if (target && target.type === 'note') {
    const lage = textLage(target.id);
    if (lage) {
      notizDa = true;
      const rel = gruppe.map((g) => strichKasten(g.abs.map(([x, y]) => [x - target.position.x, y - target.position.y] as [number, number]), g.s.width / 2));
      if (rel.every((k) => kastenInnen(k, lage.w, lage.h))) {
        const mitte = (Math.min(...rel.map((k) => k.minY)) + Math.max(...rel.map((k) => k.maxY))) / 2 + lage.scroll;
        const b = blockBei(target.id, mitte);
        text = { scroll: lage.scroll, block: b?.id, blockY: b?.oben };
      }
    }
  }
  const frei = { amText: undefined, block: undefined, blockY: undefined };
  const place = (s: Stroke, abs: [number, number][]): Stroke => {
    if (!target) return { ...s, ...frei, anchor: undefined, seite: undefined, points: abs };
    const rel = abs.map(([x, y]) => [x - target.position.x, y - target.position.y + (text ? text.scroll : 0)] as [number, number]);
    if (text) return { ...s, anchor: target.id, seite: undefined, amText: true, block: text.block, blockY: text.blockY, points: rel };
    return anSeite({ ...s, ...frei, anchor: target.id, seite: undefined, amText: notizDa ? false : undefined, points: rel });
  };
  return {
    drawings: [
      ...drawings.map((s) => { const g = gruppe.find((x) => x.s === s); return g && componentIds.has(s.id) ? place(s, g.abs) : s; }),
      place(stroke, stroke.points),
    ],
    anchor: target?.id ?? null,
  };
}
