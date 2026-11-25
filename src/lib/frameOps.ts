import { karteFest, mutedHistory, selectActiveBoard, selectNurLesen, useBoard } from '../store';
import { computeArrangement, frameMembers, sizeOf, type ArrangeMode } from './arrange';
import type { AppNode } from '../types';

/** Pastell-Tönungen für Rahmen — bewusst blass, der Inhalt bleibt der Star */
export const FRAME_COLORS = ['', '#dbe7f6', '#dcedde', '#f6ead2', '#f4dde3', '#e6def4'];

/** Innenabstände beim Anordnen im Rahmen (M542: auch für „Größe an Inhalt anpassen" und die automatische Größe) */
const PAD = 30;
const HEAD_CLEAR = 46;
/** Mindestgröße eines Rahmens (wie der Größen-Griff in FrameCard) */
export const RAHMEN_MIN = { w: 260, h: 180 };

/**
 * Nur den INHALT eines Rahmens anordnen — alles bleibt im Rahmen, der Rahmen
 * wächst bei Bedarf mit (M150). Seit M181 hier statt in der FrameCard, weil
 * die Aktion aus der Auswahl-Leiste heraus ausgelöst wird (ein Menü statt
 * zwei, User-Screenshot).
 */
export function arrangeFrameInside(id: string, mode: ArrangeMode): void {
  const st = useBoard.getState();
  const board = selectActiveBoard(st);
  const frame = board.nodes.find((n) => n.id === id);
  if (!frame) return;
  const members = frameMembers(frame, board.nodes);
  if (members.length < 2) { st.showToast('Zu wenig Karten im Rahmen zum Anordnen.'); return; }
  const memberIds = new Set(members.map((m) => m.id));
  const innerEdges = board.edges.filter((e) => memberIds.has(e.source) && memberIds.has(e.target));
  const targets = computeArrangement(members, innerEdges, mode);
  // Ziel-Anordnung bündig in den Rahmen legen (unter die Titel-Leiste)
  const sizeById = new Map(members.map((m) => [m.id, sizeOf(m)]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [tid, x, y] of targets) {
    const s = sizeById.get(tid)!;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + s.w); maxY = Math.max(maxY, y + s.h);
  }
  const offX = frame.position.x + PAD - minX;
  const offY = frame.position.y + HEAD_CLEAR - minY;
  st.pushHistory();
  // Rahmen wachsen lassen, falls der neue Inhalt mehr Platz braucht
  const fs = sizeOf(frame);
  const needW = (maxX - minX) + PAD * 2;
  const needH = (maxY - minY) + HEAD_CLEAR + PAD;
  if (needW > fs.w || needH > fs.h) {
    mutedHistory(() => st.resizeNode(id, Math.max(fs.w, needW), Math.max(fs.h, needH)));
  }
  // Sanfter Morph an die Zielplätze (wie der Aufräumen-Knopf im Dock)
  const starts = new Map(members.map((m) => [m.id, { x: m.position.x, y: m.position.y }]));
  const DUR = 450;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / DUR);
    const k = ease(t);
    mutedHistory(() => useBoard.getState().setNodePositions(targets.map(([tid, x, y]) => {
      const s0 = starts.get(tid)!;
      return [tid, s0.x + (x + offX - s0.x) * k, s0.y + (y + offY - s0.y) * k] as [string, number, number];
    })));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  st.showToast('Rahmen-Inhalt angeordnet – Strg+Z stellt die alte Ordnung wieder her.');
}

// ---------- M542: Die Größe des Rahmens folgt seinem Inhalt ----------
interface Box { x: number; y: number; w: number; h: number }
/** Bei Rahmen zählt die gesetzte Größe vor der gemessenen — die Messung folgt erst ein Bild später und läge sonst
 *  zwischen zwei Schritten noch auf dem alten Maß */
const boxVon = (n: AppNode): Box => {
  const s = sizeOf(n);
  if (n.type !== 'frame') return { x: n.position.x, y: n.position.y, ...s };
  return { x: n.position.x, y: n.position.y, w: typeof n.width === 'number' ? n.width : s.w, h: typeof n.height === 'number' ? n.height : s.h };
};
/** Hat dieser Rahmen die automatische Größe an? (Schalter im Rahmen-Menü, `data.autoGroesse`) */
export const rahmenAuto = (n: AppNode): boolean => n.type === 'frame' && (n.data as { autoGroesse?: unknown }).autoGroesse === true;

/**
 * Kasten um den Inhalt samt Innenabstand — Mitglieder nach der Mittelpunkt-Regel wie `frameMembers` (kleinere Rahmen
 * eingeschlossen, archivierte nicht). `boxen`: schon neu berechnete Rahmen (innere wachsen vor den äußeren).
 */
function inhaltKasten(rahmen: Box, rahmenId: string, nodes: AppNode[], boxen: Map<string, Box>): Box | null {
  const flaeche = rahmen.w * rahmen.h;
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const n of nodes) {
    if (n.id === rahmenId || n.archived) continue;
    const b = boxen.get(n.id) ?? boxVon(n);
    if (n.type === 'frame' && b.w * b.h >= flaeche) continue;
    const cx = b.x + b.w / 2; const cy = b.y + b.h / 2;
    if (cx < rahmen.x || cx > rahmen.x + rahmen.w || cy < rahmen.y || cy > rahmen.y + rahmen.h) continue;
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  if (x1 === Infinity) return null;
  return { x: x1 - PAD, y: y1 - HEAD_CLEAR, w: x2 - x1 + 2 * PAD, h: y2 - y1 + HEAD_CLEAR + PAD };
}

/**
 * M542: Wie weit müssen die Rahmen mit automatischer Größe wachsen, damit sie ihren Inhalt samt Innenabstand
 * umschließen? Nur wachsen, nie von selbst schrumpfen — sonst zöge der Rahmen sich zusammen, sobald eine Karte
 * herausgezogen wird, und finge dabei Nachbarn ein oder verlöre Platz, den man für später freigehalten hat. Kleine
 * Rahmen zuerst: Wächst ein innerer, wächst ein äußerer im selben Zug mit. Reine Rechnung, schreibt nichts.
 */
export function rahmenWachstum(nodes: AppNode[]): Array<{ id: string } & Box> {
  const autos = nodes.filter((n) => rahmenAuto(n) && !n.archived);
  if (autos.length === 0) return [];
  const boxen = new Map<string, Box>();
  const neu: Array<{ id: string } & Box> = [];
  for (const f of autos.map((n) => ({ n, b: boxVon(n) })).sort((a, b) => a.b.w * a.b.h - b.b.w * b.b.h)) {
    const b = boxen.get(f.n.id) ?? f.b;
    const k = inhaltKasten(b, f.n.id, nodes, boxen);
    if (!k) continue;
    const x = Math.floor(Math.min(b.x, k.x)); const y = Math.floor(Math.min(b.y, k.y));
    const w = Math.ceil(Math.max(b.x + b.w, k.x + k.w) - x); const h = Math.ceil(Math.max(b.y + b.h, k.y + k.h) - y);
    if (x > b.x - 0.5 && y > b.y - 0.5 && w < b.w + 0.5 && h < b.h + 0.5) continue;
    const g = { x: Math.min(x, b.x), y: Math.min(y, b.y), w: Math.max(w, b.w), h: Math.max(h, b.h) };
    boxen.set(f.n.id, g);
    neu.push({ id: f.n.id, ...g });
  }
  return neu;
}

/** Rahmen auf neue Kästen setzen — der Inhalt bleibt, wo er ist (anders als beim Ziehen des Rahmens) */
function rahmenSetzen(kaesten: Array<{ id: string } & Box>): void {
  const st = useBoard.getState();
  st.setNodePositions(kaesten.map((k) => [k.id, k.x, k.y] as [string, number, number]));
  for (const k of kaesten) st.resizeNode(k.id, k.w, k.h);
}

/**
 * M542: Automatische Größe nachziehen. Als was es zählt, entscheidet der Aufrufer: nach einem Zug oder einer Größe von
 * Hand im selben Rückgängig-Schritt (hier immer ohne eigenen Schritt), nach einer bloßen Messung als abgeleitete
 * Änderung (runDerived, kein Hochladen — jedes Gerät misst selbst). Was nicht verändert werden darf (nur lesen,
 * fremde Karte für Gäste), hält der Schutz am set() fest.
 */
export function rahmenWachsen(): number {
  const st = useBoard.getState();
  // Nur lesen oder fremder Rahmen für einen Gast: nicht erst versuchen (der Schutz hielte es fest und meldete es)
  if (selectNurLesen(st)) return 0;
  const nodes = selectActiveBoard(st).nodes;
  const neu = rahmenWachstum(nodes).filter((k) => !karteFest(st.activeId, (nodes.find((n) => n.id === k.id)?.data as { von?: string } | undefined)?.von));
  if (neu.length) mutedHistory(() => rahmenSetzen(neu));
  return neu.length;
}

/** M542: „Größe an Inhalt anpassen" — der Rahmen umschließt seine Karten mit dem üblichen Innenabstand (ein Schritt) */
export function rahmenAnpassen(ids: string[]): number {
  const st = useBoard.getState();
  const nodes = selectActiveBoard(st).nodes;
  const neu: Array<{ id: string } & Box> = [];
  for (const id of ids) {
    const f = nodes.find((n) => n.id === id && n.type === 'frame');
    if (!f) continue;
    const b = boxVon(f);
    const k = inhaltKasten(b, f.id, nodes, new Map());
    if (!k) continue;
    const g = { x: Math.floor(k.x), y: Math.floor(k.y), w: Math.max(RAHMEN_MIN.w, Math.ceil(k.w)), h: Math.max(RAHMEN_MIN.h, Math.ceil(k.h)) };
    if (Math.abs(g.x - b.x) < 0.5 && Math.abs(g.y - b.y) < 0.5 && Math.abs(g.w - b.w) < 0.5 && Math.abs(g.h - b.h) < 0.5) continue;
    neu.push({ id, ...g });
  }
  if (neu.length === 0) {
    st.showToast(ids.length > 1 ? 'Die Rahmen passen schon um ihren Inhalt (oder sind leer).' : 'Der Rahmen passt schon um seinen Inhalt (oder ist leer).');
    return 0;
  }
  st.pushHistory();
  mutedHistory(() => rahmenSetzen(neu));
  st.showToast('Größe an den Inhalt angepasst – Strg+Z macht es rückgängig');
  return neu.length;
}

/** M542: Schalter „Auto-Größe" — an: der Rahmen wächst mit seinem Inhalt (gleich jetzt einmal); ein Schritt */
export function rahmenAutoSetzen(ids: string[], an: boolean): void {
  const st = useBoard.getState();
  st.pushHistory();
  mutedHistory(() => {
    for (const id of ids) st.updateNodeData(id, { autoGroesse: an });
    if (an) rahmenWachsen();
  });
  st.showToast(an ? 'Auto-Größe an: Der Rahmen wächst mit seinem Inhalt.' : 'Auto-Größe aus – die Größe bleibt, wie sie ist.');
}
