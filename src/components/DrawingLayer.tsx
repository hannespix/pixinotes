import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { getStroke } from 'perfect-freehand';
import { selectActiveBoard, useBoard, type Stroke } from '../store';
import { uid } from '../types';
import { finalizeStroke, recognizeShapes } from '../lib/strokeShapes';

const EMPTY: Stroke[] = [];
const PEN = { width: 2.5, opacity: 1 };
const MARKER = { width: 16, opacity: 0.5 };
const PEN_COLORS = ['#16191e', '#e0392b', '#e8a13a', '#3fa564', '#4f7cff', '#a05fd4'];
/** Textmarker: echte Neon-Töne wie beim Leuchtstift (gelb/grün/orange/pink/cyan/lila) */
const MARKER_COLORS = ['#fff200', '#aaff00', '#ff9100', '#ff2d95', '#00e5ff', '#c45fff'];
/** Stillhalten am Strich-Ende so lange → Form einrasten (Linie/Pfeil/Kreis/Rechteck/Dreieck) */
const HOLD_MS = 550;
/** Hat dieses Gerät je einen Stift gemeldet? Dann gilt: Stift schreibt, Hand schiebt. */
const STIFT_KEY = 'pixinotes-stift';
/** Bedienelemente, die auch im Zeichenmodus Bedienelemente bleiben */
const CHROME = '.draw-palette, .dock, .sel-toolbar, .modal-backdrop, .ebenen-menu, .topbar, .tabs, .react-flow__minimap, .toast';

/**
 * M319: Strichkontur mit perfect-freehand — druckempfindlich, geglättet,
 * sauber verjüngt. `size` ist der Durchmesser bei mittlerem Druck; dünne
 * Stellen bei leichtem Druck, kräftige bei festem. Ohne Drucksensor (Maus,
 * Finger) simuliert die Geschwindigkeit den Druck: schnell = dünn.
 */
function strichKontur(s: Stroke, laufend: boolean): string {
  const punkte = s.druck && s.druck.length === s.points.length
    ? s.points.map((p, i) => [p[0], p[1], s.druck![i]])
    : s.points.map((p) => [p[0], p[1], 0.5]);
  const kontur = getStroke(punkte, {
    size: s.width * 1.4,
    thinning: 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: !s.druck,
    start: { taper: 2, cap: true },
    end: { taper: s.points.length > 6 ? 8 : 0, cap: true },
    last: !laufend,
  });
  if (kontur.length === 0) return '';
  const d: string[] = ['M', kontur[0][0].toFixed(1), kontur[0][1].toFixed(1), 'Q'];
  for (let i = 0; i < kontur.length; i += 1) {
    const [x0, y0] = kontur[i];
    const [x1, y1] = kontur[(i + 1) % kontur.length];
    d.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1));
  }
  d.push('Z');
  return d.join(' ');
}
/** Fertige Striche ändern sich nie — ihre Kontur wird einmal gerechnet */
const konturCache = new WeakMap<Stroke, string>();
const konturFuer = (s: Stroke): string => {
  let k = konturCache.get(s);
  if (!k) { k = strichKontur(s, false); konturCache.set(s, k); }
  return k;
};

/**
 * Freihand-Zeichnen über dem Board: Stift (deckend, druckempfindlich) und
 * Textmarker (breit, transparent) in mehreren Farben, plus Radierer. Striche
 * werden in Flow-Koordinaten gespeichert und wandern mit Pan/Zoom mit.
 * Beim Loslassen werden Striche entzittert (fast gerade → schnurgerade);
 * wer am Ende kurz stillhält, bekommt Linien, Pfeile, Kreise, Ellipsen,
 * Rechtecke und Dreiecke sauber eingerastet — wie in Apple Notes & OneNote.
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
  /**
   * M319: Sobald dieses Gerät einmal einen Stift gemeldet hat, gilt auch im
   * Zeichenmodus die Papier-Regel: Stift (und Maus) zeichnen, Finger schieben
   * und zoomen — auch mit zwei Fingern mitten im Zeichnen. Ohne Stift bleibt
   * der Finger der Stift (Handy ohne Pencil).
   */
  const [stiftGesehen, setStiftGesehen] = useState(() => {
    try { return localStorage.getItem(STIFT_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (stiftGesehen) return;
    const merken = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return;
      try { localStorage.setItem(STIFT_KEY, '1'); } catch { /* egal */ }
      setStiftGesehen(true);
    };
    window.addEventListener('pointerdown', merken, true);
    return () => window.removeEventListener('pointerdown', merken, true);
  }, [stiftGesehen]);
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
   * Läuft gerade ein Zug über den Fenster-Zuhörer (Stift-Direktzug oder
   * Durchgriff im Zeichenmodus)?
   *
   * Bewusst eine Ref und keine lokale Variable im Effekt: Der Effekt meldet
   * sich bei jedem Bild neu an (er muss die frischen Farben und den frischen
   * Ausschnitt kennen), und jedes aufgenommene Punktepaar löst ein Bild aus.
   */
  const stiftZug = useRef<'strich' | 'radierer' | null>(null);
  const [, force] = useState(0);
  // Striche der AKTUELLEN Zeichensitzung: sich berührende entscheiden
  // gemeinsam über das Ankern (M128) — ältere bleiben unangetastet
  const sessionIds = useRef<string[]>([]);

  const active = tool === 'pen' || tool === 'marker' || tool === 'eraser';
  /** Ebene lässt Finger durch (Schieben/Zoomen); Stift und Maus zeichnen über den Fenster-Zuhörer */
  const durchgriff = active && stiftGesehen && stiftZeichnet;

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
   */
  const nichtsZuZeigen = !active && drawings.length === 0 && !drawing.current;

  const isMarker = tool === 'marker';
  const palette = isMarker ? MARKER_COLORS : penColors;
  // Gewählte „Tinte" folgt dem Theme-Wechsel automatisch (dunkel ⇄ hell)
  const effPenColor = penColor === PEN_COLORS[0] || penColor === '#f0ead9' ? penColors[0] : penColor;
  const color = isMarker ? markerColor : effPenColor;
  const setColor = isMarker ? setMarkerColor : setPenColor;

  const toFlow = (e: { clientX: number; clientY: number }): [number, number] => {
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
      const formen = recognizeShapes(d.points);
      if (formen) {
        // Form einrasten und Strich sofort abschließen — Finger/Maus kann loslassen.
        // Eingerastete Formen sind gleichmäßig breit (kein Druckverlauf).
        formen.forEach((pts, i) => commitStroke({ ...d, id: i === 0 ? d.id : uid(), points: pts, druck: undefined }));
        drawing.current = null;
        showToast(formen.length > 1 ? '✨ Pfeil eingerastet' : '✨ Form eingerastet');
        force((n) => n + 1);
      }
    }, HOLD_MS);
  };

  /** Einen Punkt aufnehmen — Mikro-Zittern wird gar nicht erst gespeichert */
  const punktAufnehmen = (x: number, y: number, druck?: number) => {
    const d = drawing.current;
    if (!d) return false;
    const p = screenToFlowPosition({ x, y });
    const last = d.points[d.points.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5 / zoom) return false;
    d.points.push([p.x, p.y]);
    if (d.druck) d.druck.push(druck && druck > 0 ? Math.min(1, druck) : d.druck[d.druck.length - 1] ?? 0.5);
    return true;
  };

  /** Strich beginnen (gemeinsam für Layer-Zeichnen und Fenster-Zuhörer) */
  const strichStarten = (e: { clientX: number; clientY: number; pointerType?: string; pressure?: number },
    werkzeug: 'pen' | 'marker') => {
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // M319: Druck je Punkt — nur bei echtem Stift mit Sensor. Maus und Finger
    // bekommen den simulierten Druck aus der Geschwindigkeit (perfect-freehand).
    const sensor = werkzeug === 'pen' && e.pointerType === 'pen' && !!e.pressure;
    drawing.current = {
      id: uid(),
      tool: werkzeug,
      color: werkzeug === 'marker' ? markerColor : effPenColor,
      width: werkzeug === 'marker' ? MARKER.width : PEN.width,
      points: [[p.x, p.y]],
      ...(sensor ? { druck: [Math.min(1, e.pressure ?? 0.5)] } : {}),
    };
    armHold();
    force((n) => n + 1);
  };

  /** Zwischenpunkte auslesen: Ein iPad tastet den Stift mit 120 Hz ab, liefert
   *  aber nur ~60 pointermove je Sekunde. Ohne die zusammengefassten Punkte
   *  fehlt jeder zweite — schnelle Bögen bekommen dadurch Ecken. */
  const punkteAufnehmen = (roh: PointerEvent): boolean => {
    const r = roh as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const punkte = typeof r.getCoalescedEvents === 'function' ? r.getCoalescedEvents() : [];
    let neu = false;
    for (const p of punkte.length ? punkte : [roh]) neu = punktAufnehmen(p.clientX, p.clientY, p.pressure) || neu;
    return neu;
  };

  const onDown = (e: React.PointerEvent) => {
    // Handballen-Abweisung: Solange der Stift zeichnet, sind Finger tabu
    if (fuehrend.current?.art === 'pen' && e.pointerType !== 'pen') return;
    // Ein zweiter Finger beendet den Strich des ersten — das ist eine Geste, keine Zeichnung
    if (e.pointerType === 'touch' && fuehrend.current?.art === 'touch') { drawing.current = null; clearHold(); fuehrend.current = null; force((n) => n + 1); return; }
    // Capture kann bei exotischen/synthetischen Pointern fehlschlagen — Zeichnen geht trotzdem
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignorieren */ }
    const pt = toFlow(e);
    if (tool === 'eraser') { fuehrend.current = { id: e.pointerId, art: e.pointerType }; beginEraseGesture(); eraseStrokesNear(pt[0], pt[1], 12 / zoom); return; }
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
    if (!punkteAufnehmen(e.nativeEvent)) return;
    armHold();
    force((n) => n + 1);
  };
  const onUp = () => {
    clearHold();
    fuehrend.current = null;
    const d = drawing.current;
    if (d && d.points.length > 1) {
      // Loslassen: entzittern + fast gerade Striche konservativ begradigen
      const points = finalizeStroke(d.points);
      commitStroke({ ...d, points, druck: d.druck && d.druck.length === points.length ? d.druck : undefined });
    }
    drawing.current = null;
    force((n) => n + 1);
  };

  /**
   * M254/M319: Der Fenster-Zuhörer in der Erfassungsphase.
   *
   * Zwei Aufgaben. Erstens der Stift-Direktzug (M254): Der Stift zeichnet
   * sofort, ohne vorher in den Zeichenmodus zu gehen — nur auf der freien
   * Fläche, über einer Karte bleibt er ein normaler Zeiger. Zweitens der
   * Durchgriff im Zeichenmodus (M319): Auf Geräten mit Stift lässt die Ebene
   * Finger durch (eine Hand schiebt und zoomt — auch mit zwei Fingern mitten
   * im Zeichnen), während Stift und Maus über diesen Zuhörer zeichnen oder
   * radieren. `stopPropagation` hält das Ereignis von React Flow fern.
   */
  useEffect(() => {
    if (!stiftZeichnet) return;

    const runter = (e: PointerEvent) => {
      if (!e.isPrimary && e.pointerType !== 'touch') return;
      const werkzeug = useBoard.getState().tool;
      const ziel = e.target as HTMLElement | null;
      if (!ziel?.closest) return;
      if (ziel.closest(CHROME)) return;
      if (werkzeug === 'select') {
        // Direktzug: nur Stift, nur freie Fläche
        if (e.pointerType !== 'pen' || !ziel.closest('.react-flow__pane')) return;
        e.preventDefault(); e.stopPropagation();
        stiftZug.current = 'strich';
        fuehrend.current = { id: e.pointerId, art: 'pen' };
        strichStarten(e, 'pen');
        return;
      }
      // Zeichenmodus mit Durchgriff: Finger schieben (React Flow), Stift und Maus zeichnen
      if (!durchgriff || e.pointerType === 'touch' || !ziel.closest('.react-flow')) return;
      e.preventDefault(); e.stopPropagation();
      fuehrend.current = { id: e.pointerId, art: e.pointerType };
      if (werkzeug === 'eraser') {
        stiftZug.current = 'radierer';
        beginEraseGesture();
        const pt = toFlow(e);
        eraseStrokesNear(pt[0], pt[1], 12 / zoom);
        return;
      }
      stiftZug.current = 'strich';
      strichStarten(e, werkzeug === 'marker' ? 'marker' : 'pen');
    };
    const bewegen = (e: PointerEvent) => {
      if (!stiftZug.current || e.pointerId !== fuehrend.current?.id) return;
      e.preventDefault();
      e.stopPropagation();
      if (stiftZug.current === 'radierer') {
        const pt = toFlow(e);
        eraseStrokesNear(pt[0], pt[1], 12 / zoom);
        return;
      }
      if (!punkteAufnehmen(e)) return;
      armHold();
      force((n) => n + 1);
    };
    const hoch = (e: PointerEvent) => {
      if (!stiftZug.current || e.pointerId !== fuehrend.current?.id) return;
      const art = stiftZug.current;
      stiftZug.current = null;
      if (art === 'radierer') { fuehrend.current = null; return; }
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
          // Durchgriff: Finger erreichen React Flow (Schieben, Zoomen); Stift & Maus zeichnen über den Fenster-Zuhörer
          pointerEvents: active && !durchgriff ? 'auto' : 'none',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <g transform={`translate(${tx},${ty}) scale(${zoom})`}>
          {/* Eingerastete Formen (Linie, Pfeil, Rechteck, Dreieck: wenige Punkte) bleiben
              scharfkantige Linien — die Freihand-Kontur würde ihre Ecken runden. */}
          {placed.map(({ s, dx, dy, dim }) => (s.tool === 'marker' || s.points.length <= 6 ? (
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
          ) : (
            <path
              key={s.id}
              className="strich"
              d={s === drawing.current ? strichKontur(s, true) : konturFuer(s)}
              transform={dx || dy ? `translate(${dx},${dy})` : undefined}
              fill={s.color}
              stroke="none"
              opacity={PEN.opacity * (dim ? 0.35 : 1)}
            />
          )))}
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
          <span className="draw-hint-tip">{durchgriff ? ' · Hand schiebt, Stift zeichnet' : ''} · am Ende kurz halten = Form einrasten ✨</span>
        </span>
        <button className="draw-done" onClick={() => setTool('select')}>Fertig</button>
      </div>
      )}
    </>
  );
}
