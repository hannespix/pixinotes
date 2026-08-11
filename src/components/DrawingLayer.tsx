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
 * M254: Druckstärke des Stifts auf einen Breitenfaktor abbilden.
 *
 * Apple Pencil und Wacom melden 0…1, Finger und Maus melden auf vielen
 * Geräten konstant 0.5 (oder 0). Nur bei ECHTEM Stiftdruck darf die Breite
 * wandern — sonst zappelte die Linie am Finger ohne Grund.
 */
const druckFaktor = (e: { pointerType?: string; pressure?: number }): number => {
  if (e.pointerType !== 'pen') return 1;
  const p = e.pressure ?? 0;
  if (!p) return 1;                       // kein Drucksensor → gleichmäßig
  return 0.55 + Math.min(1, p) * 0.95;    // 0.55 … 1.5
};

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
  const stiftZeichnet = useBoard((s) => s.stiftZeichnet);
  const drawing = useRef<Stroke | null>(null);
  const holdTimer = useRef<number | null>(null);
  /**
   * M254: Welcher Zeiger führt gerade den Strich?
   *
   * Zwei Dinge hängen daran. Erstens die Handballen-Abweisung: Liegt die Hand
   * beim Schreiben auf, meldet iPadOS sie als ganz normalen Touch-Zeiger — der
   * würde mitzeichnen. Solange ein STIFT zeichnet, sind alle Finger tabu.
   * Zweitens das saubere Ende: Bricht iOS den Zeiger bei einer Systemgeste ab
   * (Kontrollzentrum, App-Wechsel), kommt kein pointerup mehr; ohne
   * pointercancel bliebe der halbe Strich für immer „in Arbeit".
   */
  const fuehrend = useRef<{ id: number; art: string } | null>(null);
  /**
   * Läuft gerade ein Stift-Direktzug?
   *
   * Bewusst eine Ref und keine lokale Variable im Effekt: Der Effekt meldet
   * sich bei jedem Bild neu an (er muss die frischen Farben und den frischen
   * Ausschnitt kennen), und jedes aufgenommene Punktepaar löst ein Bild aus.
   * Eine lokale Variable stünde danach wieder auf „nein" — der Strich bräche
   * nach dem ersten Punkt ab.
   */
  const stiftZug = useRef(false);
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

  /**
   * Striche sind Board-Inhalt: IMMER sichtbar, nicht nur im Zeichenmodus.
   * Ohne aktives Werkzeug ist der Layer nur durchklick-transparent.
   *
   * M254: Früher stieg die Komponente hier aus, wenn es nichts zu zeigen gab.
   * Das ging nicht mehr, seit der Stift auch OHNE Zeichenmodus zeichnet: Der
   * Zuhörer dafür ist ein Effekt, und ein Effekt hinter einem `return` wird nie
   * angemeldet. Jetzt wird bis zum Schluss gerechnet und erst die Ausgabe
   * unterdrückt.
   */
  const nichtsZuZeigen = !active && drawings.length === 0 && !drawing.current;

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

  /** Einen Punkt aufnehmen — Mikro-Zittern wird gar nicht erst gespeichert */
  const punktAufnehmen = (x: number, y: number) => {
    const d = drawing.current;
    if (!d) return false;
    const p = screenToFlowPosition({ x, y });
    const last = d.points[d.points.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5 / zoom) return false;
    d.points.push([p.x, p.y]);
    return true;
  };

  /** Strich beginnen (gemeinsam für Layer-Zeichnen und Stift-Direktzug) */
  const strichStarten = (e: { clientX: number; clientY: number; pointerType?: string; pressure?: number },
    werkzeug: 'pen' | 'marker') => {
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    drawing.current = {
      id: uid(),
      tool: werkzeug,
      color: werkzeug === 'marker' ? markerColor : effPenColor,
      // Druck wirkt auf die Strichbreite — bewusst EINMAL beim Ansetzen und
      // nicht laufend: Ein Strich mit wandernder Breite bräuchte eine gefüllte
      // Kontur statt einer Linie, also ein anderes Datenmodell.
      width: (werkzeug === 'marker' ? MARKER.width : PEN.width) * druckFaktor(e),
      points: [[p.x, p.y]],
    };
    armHold();
    force((n) => n + 1);
  };

  const onDown = (e: React.PointerEvent) => {
    // Handballen-Abweisung: Solange der Stift zeichnet, sind Finger tabu
    if (fuehrend.current?.art === 'pen' && e.pointerType !== 'pen') return;
    // Capture kann bei exotischen/synthetischen Pointern fehlschlagen — Zeichnen geht trotzdem
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignorieren */ }
    const pt = toFlow(e);
    if (tool === 'eraser') { beginEraseGesture(); eraseStrokesNear(pt[0], pt[1], 12 / zoom); return; }
    if (tool !== 'pen' && tool !== 'marker') return; // passiver Layer (pointer-events: none)
    fuehrend.current = { id: e.pointerId, art: e.pointerType };
    strichStarten(e, tool);
  };
  const onMove = (e: React.PointerEvent) => {
    if (fuehrend.current && e.pointerId !== fuehrend.current.id) return;
    if (tool === 'eraser') {
      const pt = toFlow(e);
      if (e.buttons) eraseStrokesNear(pt[0], pt[1], 12 / zoom);
      return;
    }
    if (!drawing.current) return;
    /**
     * Zwischenpunkte auslesen: Ein iPad tastet den Stift mit 120 Hz ab, liefert
     * aber nur ~60 pointermove je Sekunde. Ohne die zusammengefassten Punkte
     * fehlt jeder zweite — schnelle Bögen bekommen dadurch Ecken.
     */
    const roh = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const punkte = typeof roh.getCoalescedEvents === 'function' ? roh.getCoalescedEvents() : [roh];
    let neu = false;
    for (const p of punkte.length ? punkte : [roh]) neu = punktAufnehmen(p.clientX, p.clientY) || neu;
    if (!neu) return;
    armHold();
    force((n) => n + 1);
  };
  const onUp = () => {
    clearHold();
    fuehrend.current = null;
    const d = drawing.current;
    if (d && d.points.length > 1) {
      // Loslassen: entzittern + fast gerade Striche konservativ begradigen
      commitStroke({ ...d, points: finalizeStroke(d.points) });
    }
    drawing.current = null;
    force((n) => n + 1);
  };

  /**
   * M254: Der Stift zeichnet sofort — ohne vorher in den Zeichenmodus zu gehen.
   *
   * Das ist der eigentliche Grund, warum sich die App am iPad mit dem Pencil
   * bisher zäh anfühlte: Man musste erst das Werkzeug umschalten, und dann
   * zeichnete auch der Finger — Schieben und Zoomen ging nur nach dem
   * Zurückschalten. Jetzt gilt die Aufteilung, die man vom Papier kennt:
   * **Stift schreibt, Hand schiebt.**
   *
   * Umgesetzt als Zuhörer in der Erfassungsphase am Fenster. Er greift NUR bei
   * `pointerType === 'pen'` und nur, wenn der Zug auf der freien Fläche
   * beginnt — über einer Karte bleibt der Stift ein normaler Zeiger, sonst
   * könnte man mit ihm keine Notiz mehr antippen oder scrollen. Einmal
   * begonnen, darf der Strich selbstverständlich über Karten hinwegziehen.
   *
   * `stopPropagation` in der Erfassungsphase hält das Ereignis von React Flow
   * fern — sonst würde die Fläche gleichzeitig mitgeschoben.
   */
  useEffect(() => {
    if (!stiftZeichnet) return;

    const runter = (e: PointerEvent) => {
      if (e.pointerType !== 'pen' || !e.isPrimary) return;
      // Im Zeichenmodus macht der Layer selbst weiter (samt Radierer)
      if (useBoard.getState().tool !== 'select') return;
      const ziel = e.target as HTMLElement | null;
      if (!ziel?.closest('.react-flow__pane')) return;
      e.preventDefault();
      e.stopPropagation();
      stiftZug.current = true;
      fuehrend.current = { id: e.pointerId, art: 'pen' };
      strichStarten(e, 'pen');
    };
    const bewegen = (e: PointerEvent) => {
      if (!stiftZug.current || e.pointerId !== fuehrend.current?.id) return;
      e.preventDefault();
      e.stopPropagation();
      const roh = e as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
      const punkte = typeof roh.getCoalescedEvents === 'function' ? roh.getCoalescedEvents() : [];
      let neu = false;
      for (const p of punkte.length ? punkte : [e]) neu = punktAufnehmen(p.clientX, p.clientY) || neu;
      if (!neu) return;
      armHold();
      force((n) => n + 1);
    };
    const hoch = (e: PointerEvent) => {
      if (!stiftZug.current || e.pointerId !== fuehrend.current?.id) return;
      stiftZug.current = false;
      onUp();
    };

    window.addEventListener('pointerdown', runter, true);
    window.addEventListener('pointermove', bewegen, true);
    window.addEventListener('pointerup', hoch, true);
    // Bricht iOS den Zeiger ab (Systemgeste, App-Wechsel), kommt KEIN pointerup
    window.addEventListener('pointercancel', hoch, true);
    return () => {
      window.removeEventListener('pointerdown', runter, true);
      window.removeEventListener('pointermove', bewegen, true);
      window.removeEventListener('pointerup', hoch, true);
      window.removeEventListener('pointercancel', hoch, true);
    };
  });

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

  if (nichtsZuZeigen) return null;
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
        onPointerCancel={onUp}
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
        <input
          type="color"
          className="pn-colorpick nodrag"
          title="Eigene Stiftfarbe"
          value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#3c669c'}
          onChange={(e) => setColor(e.target.value)}
        />
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
