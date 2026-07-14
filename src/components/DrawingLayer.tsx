import { useRef, useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { selectActiveBoard, useBoard, type Stroke } from '../store';
import { uid } from '../types';

const EMPTY: Stroke[] = [];
const PEN = { width: 2.5, opacity: 1 };
const MARKER = { width: 16, opacity: 0.35 };
const COLORS = ['#2b2a27', '#e0392b', '#e8a13a', '#3fa564', '#4f7cff', '#a05fd4'];

/**
 * Freihand-Zeichnen über dem Board: Stift (deckend) und Textmarker (breit,
 * transparent) in mehreren Farben, plus Radierer. Striche werden in
 * Flow-Koordinaten gespeichert und wandern mit Pan/Zoom mit.
 */
export function DrawingLayer() {
  const tool = useBoard((s) => s.tool);
  const setTool = useBoard((s) => s.setTool);
  // WICHTIG: kein `?? []` im Selektor — das erzeugt jedes Mal ein neues Array
  // und löst mit useSyncExternalStore eine Endlosschleife aus.
  const drawings = useBoard((s) => selectActiveBoard(s).drawings) ?? EMPTY;
  const addStroke = useBoard((s) => s.addStroke);
  const eraseStrokesNear = useBoard((s) => s.eraseStrokesNear);
  const { screenToFlowPosition } = useReactFlow();
  const { x: tx, y: ty, zoom } = useViewport();
  const [color, setColor] = useState('#2b2a27');
  const drawing = useRef<Stroke | null>(null);
  const [, force] = useState(0);

  const active = tool === 'pen' || tool === 'marker' || tool === 'eraser';
  if (!active) return null;

  const toFlow = (e: React.PointerEvent): [number, number] => {
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    return [p.x, p.y];
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const pt = toFlow(e);
    if (tool === 'eraser') { eraseStrokesNear(pt[0], pt[1], 12 / zoom); return; }
    drawing.current = {
      id: uid(),
      tool,
      color,
      width: (tool === 'marker' ? MARKER.width : PEN.width),
      points: [pt],
    };
    force((n) => n + 1);
  };
  const onMove = (e: React.PointerEvent) => {
    const pt = toFlow(e);
    if (tool === 'eraser') { if (e.buttons) eraseStrokesNear(pt[0], pt[1], 12 / zoom); return; }
    if (!drawing.current) return;
    drawing.current.points.push(pt);
    force((n) => n + 1);
  };
  const onUp = () => {
    if (drawing.current && drawing.current.points.length > 1) addStroke(drawing.current);
    drawing.current = null;
    force((n) => n + 1);
  };

  const toPath = (s: Stroke) =>
    s.points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

  const all = drawing.current ? [...drawings, drawing.current] : drawings;

  return (
    <>
      <svg
        className="drawing-layer"
        style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <g transform={`translate(${tx},${ty}) scale(${zoom})`}>
          {all.map((s) => (
            <path
              key={s.id}
              d={toPath(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={s.tool === 'marker' ? MARKER.opacity : PEN.opacity}
            />
          ))}
        </g>
      </svg>
      <div className="draw-palette">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`draw-swatch ${color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Farbe ${c}`}
          />
        ))}
        <span className="draw-hint">{tool === 'eraser' ? 'Radierer' : tool === 'marker' ? 'Textmarker' : 'Stift'}</span>
        <button className="draw-done" onClick={() => setTool('select')}>Fertig</button>
      </div>
    </>
  );
}
