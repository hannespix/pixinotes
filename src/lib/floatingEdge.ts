// Floating-Edge-Geometrie: Verbindungen docken immer an der Kartenseite an,
// die dem anderen Knoten zugewandt ist — egal, an welchem Handle sie erstellt
// wurden. Seit M134 docken sie dabei GENAU an den ＋-Konnektor-Punkten
// (Seitenmitten) an, wie man es von Visio & Co. kennt: Mehrere Pfeile auf
// dieselbe Seite bündeln sich sauber am Konnektor, statt an beliebigen
// Randpunkten zu zerfasern.
import { Position, type InternalNode } from '@xyflow/react';
import { drehe, winkelVon } from './drehung';

/** M400: Winkel einer schräg liegenden Karte (0 = gerade) */
const schraeg = (n: InternalNode): number => winkelVon(n as unknown as { winkel?: number });

/** Zugewandte Seite: dominante Richtung zur Mitte des anderen Knotens */
function facingSide(node: InternalNode, other: InternalNode): Position {
  const cx = node.internals.positionAbsolute.x + (node.measured.width ?? 0) / 2;
  const cy = node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2;
  const ox = other.internals.positionAbsolute.x + (other.measured.width ?? 0) / 2;
  const oy = other.internals.positionAbsolute.y + (other.measured.height ?? 0) / 2;
  // M400: Bei einer schrägen Karte zählt die Richtung in IHREN Achsen – sonst dockte der Pfeil an der falschen Seite an
  const lokal = drehe({ x: ox - cx, y: oy - cy }, { x: 0, y: 0 }, -schraeg(node));
  const dx = lokal.x;
  const dy = lokal.y;
  // Leichte Bevorzugung von links/rechts: Prozesse fließen meist horizontal,
  // und die Seiten-Konnektoren liegen dort auch optisch am natürlichsten
  if (Math.abs(dx) * 1.15 >= Math.abs(dy)) return dx >= 0 ? Position.Right : Position.Left;
  return dy >= 0 ? Position.Bottom : Position.Top;
}

/** ＋-Konnektor-Punkt (Seitenmitte) der gegebenen Seite */
function sidePoint(node: InternalNode, side: Position): { x: number; y: number } {
  const x = node.internals.positionAbsolute.x;
  const y = node.internals.positionAbsolute.y;
  const w = node.measured.width ?? 0;
  const h = node.measured.height ?? 0;
  const gerade = (() => {
    switch (side) {
      case Position.Left: return { x, y: y + h / 2 };
      case Position.Right: return { x: x + w, y: y + h / 2 };
      case Position.Top: return { x: x + w / 2, y };
      default: return { x: x + w / 2, y: y + h };
    }
  })();
  // M400: Der Anschlusspunkt dreht sich mit der Karte um ihre Mitte
  return drehe(gerade, { x: x + w / 2, y: y + h / 2 }, schraeg(node));
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
  const sourceSide = facingSide(source, target);
  const targetSide = facingSide(target, source);
  const sourcePoint = sidePoint(source, sourceSide);
  const targetPoint = sidePoint(target, targetSide);
  return {
    sx: sourcePoint.x,
    sy: sourcePoint.y,
    tx: targetPoint.x,
    ty: targetPoint.y,
    sourcePos: sourceSide,
    targetPos: targetSide,
  };
}
