import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { selectActiveBoard, useBoard, type Stroke } from '../store';
import { uid } from '../types';
import { finalizeStroke, recognizeShape } from '../lib/strokeShapes';

const EMPTY: Stroke[] = [];
const PEN = { width: 2.5, opacity: 1 };
const MARKER = { width: 16, opacity: 0.5 };
const PEN_COLORS = ['#2b2a27', '#e0392b', '#e8a13a', '#3fa564', '#4f7cff', '#a05fd4'];
/** Textmarker: echte Neon-Töne wie beim Leuchtstift (gelb/grün/orange/pink/cyan/lila) */
const MARKER_COLORS = ['#fff200', '#aaff00', '#ff9100', '#ff2d95', '#00e5ff', '#c45fff'];
/** Stillhalten am Strich-Ende so lange → Form einrasten (Linie/Rechteck/Ellipse) */
const HOLD_MS = 550;

/**
 * Freihand-Zeichnen über dem Board: Stift (deckend) und Textmarker (breit,
 * transparent) in mehreren Farben, plus Radierer. Striche werden in
 * Flow-Koordinaten gespeichert und wandern mit Pan/Zoom mit.
 * Beim Loslassen werden Striche entzittert (fast gerade → schnurgerade);
 * wer am Ende kurz stillhält, bekommt Linien/Rechtecke/Ellipsen sauber
 * eingerastet — wie man es von OneNote & Co. kennt.
 */
export function DrawingLayer() {
  const tool = useBoard((s) => s.tool);
  const setTool = useBoard((s) => s.setTool);
  // WICHTIG: kein `?? []` im Selektor — das erzeugt jedes Mal ein neues Array
  // und löst mit useSyncExternalStore eine Endlosschleife aus.
  const drawings = useBoard((s) => selectActiveBoard(s).drawings) ?? EMPTY;
  const nodes = useBoard((s) => selectActiveBoard(s).nodes);
  const showArchived = useBoard((s) => s.showArchived);
  const addStroke = useBoard((s) => s.addStroke);
  const showToast = useBoard((s) => s.showToast);
  const eraseStrokesNear = useBoard((s) => s.eraseStrokesNear);
  const beginEraseGesture = useBoard((s) => s.beginEraseGesture);
  const { screenToFlowPosition } = useReactFlow();
  const { x: tx, y: ty, zoom } = useViewport();
  const uiTheme = useBoard((s) => s.ui.theme);
  // Im dunklen Design wäre die Tinten-Farbe unsichtbar → helle „Kreide" anbieten
  const dark = uiTheme === 'dark'
    || (uiTheme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  const penColors = dark ? ['#f0ead9', ...PEN_COLORS.slice(1)] : PEN_COLORS;
  // Stift und Textmarker merken sich ihre Farbe getrennt — der Marker startet neongelb
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [markerColor, setMarkerColor] = useState(MARKER_COLORS[0]);
  const drawing = useRef<Stroke | null>(null);
  const holdTimer = useRef<number | null>(null);
  const [, force] = useState(0);
  // Striche der AKTUELLEN Zeichensitzung: sich berührende entscheiden
  // gemeinsam über das Ankern (M128) — ältere bleiben unangetastet
  const sessionIds = useRef<string[]>([]);

  const active = tool === 'pen' || tool === 'marker' || tool === 'eraser';

  // Neue Zeichensitzung beginnt mit dem Aktivieren eines Zeichenwerkzeugs
  useEffect(() => {
    if (active) sessionIds.current = [];
  }, [active]);

  // Esc beendet den Zeichenmodus (QoL)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, setTool]);

  // Striche sind Board-Inhalt: IMMER sichtbar, nicht nur im Zeichenmodus.
  // Ohne aktives Werkzeug ist der Layer nur durchklick-transparent.
  if (!active && drawings.length === 0) return null;

  const isMarker = tool === 'marker';
  const palette = isMarker ? MARKER_COLORS : penColors;
  // Gewählte „Tinte" folgt dem Theme-Wechsel automatisch (dunkel ⇄ hell)
  const effPenColor = penColor === PEN_COLORS[0] || penColor === '#f0ead9' ? penColors[0] : penColor;
  const color = isMarker ? markerColor : effPenColor;
  const setColor = isMarker ? setMarkerColor : setPenColor;

  const toFlow = (e: React.PointerEvent): [number, number] => {
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    return [p.x, p.y];
  };

  const clearHold = () => {
    if (holdTimer.current !== null) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
  };

  /**
   * Fertigen Strich übernehmen — überlappt die zusammenhängende Zeichnung
   * (sich berührende Striche dieser Sitzung) eine Karte sichtbar, wird sie
   * an sie geankert (M127–M129) und wandert fortan mit ihr mit.
   * Die Zielkarte blitzt kurz auf, damit klar ist, wohin sie gehört.
   */
  const commitStroke = (raw: Stroke) => {
    addStroke(raw, sessionIds.current);
    sessionIds.current.push(raw.id);
    const anchor = (selectActiveBoard(useBoard.getState()).drawings ?? []).find((s) => s.id === raw.id)?.anchor;
    if (anchor) {
      const el = document.querySelector(`.react-flow__node[data-id="${anchor}"]`);
      if (el) {
        el.classList.remove('anchor-flash');
        // Reflow erzwingen, damit die Animation auch bei schnellen Folge-Strichen neu startet
        void (el as HTMLElement).offsetWidth;
        el.classList.add('anchor-flash');
        window.setTimeout(() => el.classList.remove('anchor-flash'), 800);
      }
    }
  };

  /** Timer neu aufziehen: feuert nur, wenn der Stift wirklich stillsteht */
  const armHold = () => {
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      const d = drawing.current;
      if (!d || d.points.length < 8) return;
      const snapped = recognizeShape(d.points);
      if (snapped) {
        // Form einrasten und Strich sofort abschließen — Finger/Maus kann loslassen
        commitStroke({ ...d, points: snapped });
        drawing.current = null;
        showToast('✨ Form eingerastet');
        force((n) => n + 1);
      }
    }, HOLD_MS);
  };

  const onDown = (e: React.PointerEvent) => {
    // Capture kann bei exotischen/synthetischen Pointern fehlschlagen — Zeichnen geht trotzdem
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignorieren */ }
    const pt = toFlow(e);
    if (tool === 'eraser') { beginEraseGesture(); eraseStrokesNear(pt[0], pt[1], 12 / zoom); return; }
    if (tool !== 'pen' && tool !== 'marker') return; // passiver Layer (pointer-events: none)
    drawing.current = {
      id: uid(),
      tool,
      color,
      width: (tool === 'marker' ? MARKER.width : PEN.width),
      points: [pt],
    };
    armHold();
    force((n) => n + 1);
  };
  const onMove = (e: React.PointerEvent) => {
    const pt = toFlow(e);
    if (tool === 'eraser') { if (e.buttons) eraseStrokesNear(pt[0], pt[1], 12 / zoom); return; }
    const d = drawing.current;
    if (!d) return;
    // Punkt-Ausdünnung: Mikro-Bewegungen (Zittern) gar nicht erst aufnehmen
    const last = d.points[d.points.length - 1];
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1.5 / zoom) return;
    d.points.push(pt);
    armHold();
    force((n) => n + 1);
  };
  const onUp = () => {
    clearHold();
    const d = drawing.current;
    if (d && d.points.length > 1) {
      // Loslassen: entzittern + fast gerade Striche konservativ begradigen
      commitStroke({ ...d, points: finalizeStroke(d.points) });
    }
    drawing.current = null;
    force((n) => n + 1);
  };

  const toPath = (s: Stroke) =>
    s.points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

  const all = drawing.current ? [...drawings, drawing.current] : drawings;
  // Geankerte Striche: Versatz = aktuelle Kartenposition (sie wandern so bei
  // Drag/Physik/Aufräumen automatisch mit); Karte weg/archiviert → unsichtbar
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const placed = all.flatMap((s) => {
    if (!s.anchor) return [{ s, dx: 0, dy: 0, dim: false }];
    const n = nodeById.get(s.anchor);
    if (!n || (n.archived && !showArchived)) return [];
    return [{ s, dx: n.position.x, dy: n.position.y, dim: !!n.archived }];
  });

  return (
    <>
      <svg
        className="drawing-layer"
        style={{
          cursor: tool === 'eraser' ? 'cell' : 'crosshair',
          pointerEvents: active ? 'auto' : 'none',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <g transform={`translate(${tx},${ty}) scale(${zoom})`}>
          {placed.map(({ s, dx, dy, dim }) => (
            <path
              key={s.id}
              d={toPath(s)}
              transform={dx || dy ? `translate(${dx},${dy})` : undefined}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={(s.tool === 'marker' ? MARKER.opacity : PEN.opacity) * (dim ? 0.35 : 1)}
              // Multiply lässt den Text unter dem Marker durchscheinen — wie beim echten Leuchtstift
              style={s.tool === 'marker' ? { mixBlendMode: 'multiply' } : undefined}
            />
          ))}
        </g>
      </svg>
      {active && (
      <div className="draw-palette">
        {palette.map((c) => (
          <button
            key={c}
            className={`draw-swatch ${color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Farbe ${c}`}
          />
        ))}
        <span className="draw-hint">
          {tool === 'eraser' ? 'Radierer' : tool === 'marker' ? 'Textmarker' : 'Stift'}
          <span className="draw-hint-tip"> · am Ende kurz halten = Form einrasten ✨</span>
        </span>
        <button className="draw-done" onClick={() => setTool('select')}>Fertig</button>
      </div>
      )}
    </>
  );
}
