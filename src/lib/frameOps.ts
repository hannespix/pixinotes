import { mutedHistory, selectActiveBoard, useBoard } from '../store';
import { computeArrangement, frameMembers, sizeOf, type ArrangeMode } from './arrange';

/** Pastell-Tönungen für Rahmen — bewusst blass, der Inhalt bleibt der Star */
export const FRAME_COLORS = ['', '#dbe7f6', '#dcedde', '#f6ead2', '#f4dde3', '#e6def4'];

/** Innenabstände beim Anordnen im Rahmen */
const PAD = 30;
const HEAD_CLEAR = 46;

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
  st.showToast('Rahmen-Inhalt angeordnet — Strg+Z stellt die alte Ordnung wieder her.');
}
