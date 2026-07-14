// Floating-Edge-Geometrie: Verbindungen docken immer an der Kartenseite an,
// die dem anderen Knoten zugewandt ist — egal, an welchem Handle sie erstellt
// wurden. Mathematik nach dem offiziellen React-Flow-Beispiel „Floating Edges" (MIT).
import { Position, type InternalNode } from '@xyflow/react';

/** Schnittpunkt der Mittellinie beider Knoten mit dem Rand von `node` */
function getNodeIntersection(node: InternalNode, other: InternalNode): { x: number; y: number } {
  const w = (node.measured.width ?? 0) / 2;
  const h = (node.measured.height ?? 0) / 2;

  const x2 = node.internals.positionAbsolute.x + w;
  const y2 = node.internals.positionAbsolute.y + h;
  const x1 = other.internals.positionAbsolute.x + (other.measured.width ?? 0) / 2;
  const y1 = other.internals.positionAbsolute.y + (other.measured.height ?? 0) / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;

  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

/** Auf welcher Seite des Knotens liegt der Schnittpunkt? (steuert die Kurvenrichtung) */
function getEdgePosition(node: InternalNode, point: { x: number; y: number }): Position {
  const nx = Math.round(node.internals.positionAbsolute.x);
  const ny = Math.round(node.internals.positionAbsolute.y);
  const px = Math.round(point.x);
  const py = Math.round(point.y);

  if (px <= nx + 1) return Position.Left;
  if (px >= nx + (node.measured.width ?? 0) - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  return Position.Bottom;
}

export interface FloatingEdgeParams {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
}

/** Start-/Endpunkt + Seiten für eine frei andockende Verbindung zwischen zwei Knoten */
export function getFloatingEdgeParams(source: InternalNode, target: InternalNode): FloatingEdgeParams {
  const sourcePoint = getNodeIntersection(source, target);
  const targetPoint = getNodeIntersection(target, source);
  return {
    sx: sourcePoint.x,
    sy: sourcePoint.y,
    tx: targetPoint.x,
    ty: targetPoint.y,
    sourcePos: getEdgePosition(source, sourcePoint),
    targetPos: getEdgePosition(target, targetPoint),
  };
}
