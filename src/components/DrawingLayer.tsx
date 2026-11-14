import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { selectNurLesen, selectActiveBoard, useBoard, type Stroke } from '../store';
import { SEITEN_EREIGNIS, seiteVon, strichRelativ } from '../lib/pdfSeiten';
import { uid } from '../types';
import { finalizeStroke, recognizeShapes, type Pt } from '../lib/strokeShapes';
import { handschriftKandidaten, handschriftWeg, kiKorrektur, textAufraeumen, type SchriftKontext } from '../lib/handschrift';
import { TEXT_ARTEN, artSetzen, artVorsatz, hauptArt, istListe, markerAusStrichen, zeilenMitArt, zeilenZuBloecken, type BlockArt, type ZeileMitArt } from '../lib/handschriftStruktur';
import { bboxVon, istKritzel, istSchleife, istWaagerechteLinie, punktInPolygon, ueberdeckung, type Box } from '../lib/stiftGesten';
import { inhaltMitEinfuegung, inhaltOhneBereiche, offsetUnterPunkt, woerterImBlock, woerterMarkieren, type BlockInhalt, type Wort } from '../lib/stiftText';
import { aiReady } from '../lib/ai';
import { noteTitle } from '../lib/notiz';
import { blocksToText } from '../lib/serialize';
import { makeNote } from '../lib/nodes';
import { mitFestenIds, mitPfadIds } from '../lib/notizRuhend';
import { linienPfad, MARKER, MarkerGruppen, PEN, StrichPfad, strichKontur } from './StrichPfad';
import { markerEinrasten } from '../lib/markerZeile';
import { istAmText } from '../lib/notizText';
import type { AppNode } from '../types';
import { IType, IX } from './Icons';

const EMPTY: Stroke[] = [];
const PEN_COLORS = ['#16191e', '#e0392b', '#e8a13a', '#3fa564', '#4f7cff', '#a05fd4'];
/** Textmarker: echte Neon-Töne wie beim Leuchtstift (gelb/grün/orange/pink/cyan/lila) */
const MARKER_COLORS = ['#fff200', '#aaff00', '#ff9100', '#ff2d95', '#00e5ff', '#c45fff'];
/** Stillhalten am Strich-Ende so lange → Form einrasten (Linie/Pfeil/Kreis/Rechteck/Dreieck).
 *  M324: 550 → 320 ms — „Formen einrasten schneller". Kürzer wäre riskant: beim
 *  Schreiben setzt der Stift zwischen Buchstaben ähnlich kurz ab. */
const HOLD_MS = 320;
/**
 * M354: Stärken in BILDSCHIRM-Punkten — so dick, wie man es beim Zeichnen sieht, gleich ob die Karte
 * gerade groß oder klein im Bild ist. Bisher galten feste Board-Punkte: Im Fokus (Zoom 1,25) oder auf
 * einer klein gezogenen PDF wirkte selbst „fein" fett. Je Werkzeug drei Stufen zum schnellen Wechseln
 * und ein Regler für alles dazwischen; die Wahl bleibt am Gerät gespeichert.
 */
export const STAERKEN = {
  pen: { stufen: [{ name: 'Fein', w: 1.2 }, { name: 'Mittel', w: 2.2 }, { name: 'Dick', w: 4 }], min: 0.4, max: 10, schritt: 0.1, vorgabe: 1.2 },
  marker: { stufen: [{ name: 'Schmal', w: 8 }, { name: 'Mittel', w: 14 }, { name: 'Breit', w: 22 }], min: 4, max: 40, schritt: 1, vorgabe: 14 },
  eraser: { stufen: [{ name: 'Klein', w: 6 }, { name: 'Mittel', w: 12 }, { name: 'Groß', w: 24 }], min: 3, max: 48, schritt: 1, vorgabe: 12 },
} as const;
type StaerkeWerkzeug = keyof typeof STAERKEN;
const STAERKEN_KEY = 'pixinotes-stift-staerken';
function staerkenLesen(): Record<StaerkeWerkzeug, number> {
  const v = { pen: STAERKEN.pen.vorgabe as number, marker: STAERKEN.marker.vorgabe as number, eraser: STAERKEN.eraser.vorgabe as number };
  try {
    const g = JSON.parse(localStorage.getItem(STAERKEN_KEY) ?? '{}') as Partial<Record<StaerkeWerkzeug, number>>;
    for (const k of Object.keys(v) as StaerkeWerkzeug[]) {
      const x = g[k];
      if (typeof x === 'number' && x >= STAERKEN[k].min && x <= STAERKEN[k].max) v[k] = x;
    }
  } catch { /* Vorgaben */ }
  return v;
}
/** Board-Breite aus Bildschirm-Punkten — der Zoom wird begrenzt, damit ein Strich aus der Vogelschau nicht riesig wird */
const aufBoard = (bild: number, zoom: number) => Math.round((bild / Math.min(4, Math.max(0.25, zoom))) * 100) / 100;
/** M324: Nach dem Absetzen so lange Ruhe → erkannter Text als Vorschlag */
const VORSCHLAG_MS = 900;
/** M325: Kürzer und stiller als das → der Stift hat getippt, nicht geschrieben (Tipp = Klick) */
const TIPP_MS = 220;
const TIPP_PX = 6;
/** M325: Zwei-/Drei-Finger-Tipp (Procreate): so kurz, so still */
const FINGER_TIPP_MS = 300;
const FINGER_TIPP_PX = 12;
/** Radierer-Art bleibt am Gerät gespeichert */
const RADIERER_KEY = 'pixinotes-radierer';
/** Worauf der Stift im Auswahlmodus schreibt: freie Fläche und Notizen — Module bedient er */
const SCHREIBFLAECHE = '.react-flow__pane, .react-flow__node-note, .pdf-seite';
/** Was auch auf einer Notiz ein Bedienelement bleibt (Tipp klickt, Ziehen zieht) */
const KARTEN_BEDIENUNG = '.card-grip, .react-flow__resize-control, .react-flow__handle, .react-flow__edge, .react-flow__edgelabel-renderer, .react-flow__viewport-portal, button, a, input, select, textarea, .due-chips, .note-farben, .color-dot, .note-fortschritt, .abo-feeds';
/** Hat dieses Gerät je einen Stift gemeldet? Dann gilt: Stift schreibt, Hand schiebt. */
const STIFT_KEY = 'pixinotes-stift';
/** Bedienelemente, die auch im Zeichenmodus Bedienelemente bleiben */
const CHROME = '.draw-palette, .dock, .sel-toolbar, .modal-backdrop, .ebenen-menu, .topbar, .tabs, .react-flow__minimap, .toast';

/** M335: Seitenstriche werden je Seitenlage einmal in Kartenpunkte umgerechnet (gleiches Objekt → Kontur aus dem Cache) */
const seitenStrichCache = new WeakMap<Stroke, { g: object; s: Stroke }>();

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
  // M335: Blättert oder wächst eine PDF-Karte, liegen ihre Seitenstriche woanders — neu zeichnen
  const [, seitenTakt] = useState(0);
  useEffect(() => {
    const auf = () => seitenTakt((n) => n + 1);
    window.addEventListener(SEITEN_EREIGNIS, auf);
    return () => window.removeEventListener(SEITEN_EREIGNIS, auf);
  }, []);
  const nodes = useBoard((s) => selectActiveBoard(s).nodes);
  const showArchived = useBoard((s) => s.showArchived);
  const addStroke = useBoard((s) => s.addStroke);
  const showToast = useBoard((s) => s.showToast);
  const eraseStrokesNear = useBoard((s) => s.eraseStrokesNear);
  const beginEraseGesture = useBoard((s) => s.beginEraseGesture);
  const removeStrokes = useBoard((s) => s.removeStrokes);
  const addNode = useBoard((s) => s.addNode);
  const onNodesChange = useBoard((s) => s.onNodesChange);
  const eraseStrokesPartial = useBoard((s) => s.eraseStrokesPartial);
  /** M325: Teil-Radierer (Punkte im Radius) oder Strich-Radierer (ganzer Strich) */
  const [radiererArt, setRadiererArt] = useState<'teil' | 'strich'>(() => {
    try { return localStorage.getItem(RADIERER_KEY) === 'strich' ? 'strich' : 'teil'; } catch { return 'teil'; }
  });
  const radiererWaehlen = (art: 'teil' | 'strich') => { setRadiererArt(art); try { localStorage.setItem(RADIERER_KEY, art); } catch { /* egal */ } };
  /** M325: Beginn des aktuellen Stift-Zugs — für „Tipp oder Strich?" */
  const tipp = useRef<{ t: number; x: number; y: number; weit: boolean } | null>(null);
  /** M325: Finger-Tipps (Procreate): wann begann welcher Finger, wie viele gleichzeitig */
  const fingerTipps = useRef<Map<number, { t: number; x: number; y: number; weit: boolean }>>(new Map());
  const fingerMax = useRef(0);
  const updateNodeDataOnBoard = useBoard((s) => s.updateNodeDataOnBoard);
  const activeId = useBoard((s) => s.activeId);
  const boardName = useBoard((s) => selectActiveBoard(s)?.name ?? '');
  const handschriftAuto = useBoard((s) => s.handschriftAuto);
  const handschriftKi = useBoard((s) => s.handschriftKi);
  const ai = useBoard((s) => s.ai);
  const [erkennt, setErkennt] = useState(false);
  const [staerken, setStaerken] = useState(staerkenLesen);
  const staerkeSetzen = (w: StaerkeWerkzeug, x: number) => setStaerken((alt) => {
    const neu = { ...alt, [w]: Math.min(STAERKEN[w].max, Math.max(STAERKEN[w].min, x)) };
    try { localStorage.setItem(STAERKEN_KEY, JSON.stringify(neu)); } catch { /* egal */ }
    return neu;
  });
  /** M324: Vorschlag nach der Schreibpause — Text (oder „erkenne…"), Lage in Flow-Koordinaten */
  const [vorschlag, setVorschlag] = useState<{ ids: string[]; text: string; zeilen: ZeileMitArt[]; x: number; y: number; oben: number; status: 'erkennt' | 'ki' | 'fertig' } | null>(null);
  const vorschlagTimer = useRef<number | null>(null);
  const vorschlagLauf = useRef(0);
  const { screenToFlowPosition, getNodes, getViewport, setViewport } = useReactFlow();
  /** M326: Ohne Stift-Gerät nimmt die Ebene alle Zeiger — zwei Finger zoomen und schwenken dann hier selbst */
  const fingerZeiger = useRef<Map<number, [number, number]>>(new Map());
  const pinch = useRef<{ d0: number; mitte0: [number, number]; vp0: { x: number; y: number; zoom: number } } | null>(null);
  const { x: tx, y: ty, zoom } = useViewport();
  const uiTheme = useBoard((s) => s.ui.theme);
  // Im dunklen Design wäre die Tinten-Farbe unsichtbar → helle „Kreide" anbieten
  const dark = uiTheme === 'dark'
    || (uiTheme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  const penColors = dark ? ['#f0ead9', ...PEN_COLORS.slice(1)] : PEN_COLORS;
  // Stift und Textmarker merken sich ihre Farbe getrennt — der Marker startet neongelb
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [markerColor, setMarkerColor] = useState(MARKER_COLORS[0]);
  // M360: Auf einem nur lesend geteilten Board zeichnet auch der Stift nicht
  const nurLesen = useBoard(selectNurLesen);
  const stiftZeichnet = useBoard((s) => s.stiftZeichnet) && !nurLesen;
  useEffect(() => { if (nurLesen && tool !== 'select') useBoard.setState({ tool: 'select' }); }, [nurLesen, tool]);
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
  /**
   * M348: Der laufende Strich wird DIREKT gezeichnet — im Zeiger-Ereignis, am eigenen Pfad, ohne React.
   * Seit M339 lief er über die gespeicherte (memo) StrichPfad-Komponente; die zeichnet nur neu, wenn
   * sich ihr Strich-OBJEKT ändert — beim Schreiben wächst aber dasselbe Objekt. Gemessen: Der Pfad
   * blieb vom ersten Punkt bis zum Absetzen stehen, die Schrift erschien erst danach. Dazu rendete jede
   * Bewegung die ganze Ebene mit allen Strichen neu. Jetzt: ein Pfad, dessen `d` jede Bewegung setzt,
   * plus die vom Browser vorhergesagten nächsten Stiftpunkte (getPredictedEvents) — die Spitze läuft
   * dem Stift so nicht hinterher; die Vorhersage wird nie gespeichert.
   */
  const liveRef = useRef<SVGPathElement | null>(null);
  const vorhersage = useRef<[number, number][]>([]);
  const liveD = (d: Stroke): string => {
    const vor = vorhersage.current;
    const s: Stroke = vor.length
      ? { ...d, points: [...d.points, ...vor], ...(d.druck ? { druck: [...d.druck, ...vor.map(() => d.druck![d.druck!.length - 1] ?? 0.5)] } : {}) }
      : d;
    return d.tool === 'marker' ? linienPfad(s) : strichKontur(s, true);
  };
  const liveZeichnen = () => {
    const d = drawing.current;
    const el = liveRef.current;
    if (d && el) el.setAttribute('d', liveD(d));
  };
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
  const stiftZug = useRef<'strich' | 'radierer' | 'griff' | null>(null);
  /** M325: Seitentaste greift — welche Karte, wo begann der Zug (Flow), wo stand sie */
  const griff = useRef<{ id: string; start: Pt; pos: { x: number; y: number } } | null>(null);
  /** M322: Touch-Kennungen, die zu einem laufenden Stift-Zug gehören (Stift selbst, Handballen) */
  const geschluckt = useRef<Set<number>>(new Set());
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
  /** Laufenden Strich als Form einrasten (Halten am Ende — oder zweiter Finger tippt, M325/Procreate) */
  const formEinrasten = () => {
    const d = drawing.current;
    if (!d || d.points.length < 8) return;
    // M324: Eine Schleife um Karten ist ein Lasso, keine Kreis-Form
    if (gesteAusfuehren(d)) { drawing.current = null; force((n) => n + 1); return; }
    const formen = recognizeShapes(d.points);
    if (formen) {
      // Form einrasten und Strich sofort abschließen — Finger/Maus kann loslassen.
      // Eingerastete Formen sind gleichmäßig breit (kein Druckverlauf).
      formen.forEach((pts, i) => commitStroke({ ...d, id: i === 0 ? d.id : uid(), points: pts, druck: undefined }));
      drawing.current = null;
      tipp.current = null;
      showToast(formen.length > 1 ? '✨ Pfeil eingerastet' : '✨ Form eingerastet');
      force((n) => n + 1);
    }
  };
  const armHold = () => {
    clearHold();
    holdTimer.current = window.setTimeout(formEinrasten, HOLD_MS);
  };

  /* ───────────── M325: Tipp = Klick, Radierer, Finger-Tipps ───────────── */

  /**
   * Seitentaste greift (OneNote: „Taste halten = Auswahl/Verschieben"): Mit
   * gedrückter Seitentaste zieht der Stift die Karte unter sich — React Flow
   * ignoriert die rechte Taste, deshalb bewegt die Ebene die Karte selbst.
   */
  const griffStarten = (e: PointerEvent, ziel: HTMLElement) => {
    const nodeEl = ziel.closest('.react-flow__node') as HTMLElement | null;
    const id = nodeEl?.dataset.id;
    const n = id ? nodes.find((k) => k.id === id) : undefined;
    if (!n) return; // freie Fläche: normaler Zeiger (Kontextmenü, Schwenken)
    e.preventDefault(); e.stopPropagation();
    fuehrend.current = { id: e.pointerId, art: 'pen' };
    stiftZug.current = 'griff';
    stiftZugMelden(true);
    griff.current = { id: n.id, start: toFlow(e), pos: { ...n.position } };
    onNodesChange([{ id: n.id, type: 'select', selected: true }]);
  };
  const griffBewegen = (e: PointerEvent) => {
    const g = griff.current;
    if (!g) return;
    const p = toFlow(e);
    onNodesChange([{ id: g.id, type: 'position', position: { x: g.pos.x + p[0] - g.start[0], y: g.pos.y + p[1] - g.start[1] }, dragging: true }]);
  };
  const griffEnde = () => {
    const g = griff.current;
    griff.current = null;
    if (!g) return;
    const n = nodes.find((k) => k.id === g.id) ?? (getNodes() as AppNode[]).find((k) => k.id === g.id);
    if (n) onNodesChange([{ id: g.id, type: 'position', position: n.position, dragging: false }]);
  };
  /** Radieren an einem Flow-Punkt — Teil (Punkte im Radius) oder ganzer Strich */
  const radieren = (x: number, y: number) => {
    // M354: Radius in Bildschirm-Punkten (wählbar); der Strich-Radierer greift etwas großzügiger
    if (radiererArt === 'teil') eraseStrokesPartial(x, y, staerken.eraser / zoom);
    else eraseStrokesNear(x, y, (staerken.eraser * 1.2) / zoom);
  };
  const tippMerken = (e: { clientX: number; clientY: number }) => { tipp.current = { t: Date.now(), x: e.clientX, y: e.clientY, weit: false }; };
  const tippPruefen = (e: { clientX: number; clientY: number }) => {
    const t = tipp.current;
    if (t && !t.weit && Math.hypot(e.clientX - t.x, e.clientY - t.y) > TIPP_PX) t.weit = true;
  };
  const tippIst = (e?: { clientX: number; clientY: number }): boolean => {
    const t = tipp.current;
    if (!t || t.weit || !e) return false;
    return Date.now() - t.t < TIPP_MS && Math.hypot(e.clientX - t.x, e.clientY - t.y) <= TIPP_PX;
  };
  /**
   * Ein Stift-Tipp klickt, was unter ihm liegt — Karte wählen, Haken setzen,
   * Fläche abwählen erledigt der Browser selbst: Das abgefangene pointerdown
   * unterdrückt zwar mousedown/mouseup, den `click` schickt er trotzdem. Was
   * fehlt, ist der Cursor im Text (den setzt sonst das mousedown): den holt
   * die Ebene hier nach, samt Fokus für den Editor.
   */
  const tippAusfuehren = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const editor = el?.closest('[contenteditable="true"]') as HTMLElement | null;
    if (!editor) return;
    const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    let r: Range | null = null;
    if (typeof document.caretRangeFromPoint === 'function') r = document.caretRangeFromPoint(x, y);
    else if (typeof doc.caretPositionFromPoint === 'function') { const p = doc.caretPositionFromPoint(x, y); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); } }
    editor.focus({ preventScroll: true });
    if (r) { const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r); }
  };
  /**
   * Finger-Tipps wie in Procreate: zwei Finger = Rückgängig, drei = Wiederholen —
   * im Zeichenmodus, wenn gerade kein Stift schreibt. Und: Tippt ein zweiter
   * Finger, WÄHREND der Stift einen Strich hält, rastet die Form sofort ein.
   */
  const fingerTippBuchen = (e: TouchEvent) => {
    const jetzt = Date.now();
    const m = fingerTipps.current;
    if (e.type === 'touchstart') {
      for (const t of Array.from(e.changedTouches)) m.set(t.identifier, { t: jetzt, x: t.clientX, y: t.clientY, weit: false });
      fingerMax.current = Math.max(fingerMax.current, e.touches.length);
      return;
    }
    if (e.type === 'touchmove') {
      for (const t of Array.from(e.changedTouches)) { const f = m.get(t.identifier); if (f && Math.hypot(t.clientX - f.x, t.clientY - f.y) > FINGER_TIPP_PX) f.weit = true; }
      return;
    }
    // touchend / touchcancel
    const beendet = Array.from(e.changedTouches).map((t) => m.get(t.identifier)).filter(Boolean) as Array<{ t: number; weit: boolean }>;
    for (const t of Array.from(e.changedTouches)) m.delete(t.identifier);
    const kurz = e.type === 'touchend' && beendet.length > 0 && beendet.every((f) => !f.weit && jetzt - f.t < FINGER_TIPP_MS);
    if (e.touches.length === 0) {
      const n = fingerMax.current;
      fingerMax.current = 0;
      if (!kurz) return;
      // Zwei-/Drei-Finger-Tipp (Rückgängig/Wiederholen) übernimmt seit M326 FingerGesten — überall auf dem Board
      if (drawing.current && drawing.current.tool !== 'marker' && stiftZug.current === 'strich' && n === 1) { formEinrasten(); return; }
    } else if (kurz && drawing.current && stiftZug.current === 'strich' && drawing.current.tool !== 'marker') {
      // Zweiter Finger tippt, während der Stift noch unten ist → sofort einrasten
      formEinrasten();
    }
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
  /** M326: Die Finger-Gesten (FingerGesten.tsx) pausieren, solange ein Stift-Zug läuft */
  const stiftZugMelden = (an: boolean) => { if (an) document.body.dataset.stiftZug = '1'; else delete document.body.dataset.stiftZug; };
  const strichStarten = (e: { clientX: number; clientY: number; pointerType?: string; pressure?: number },
    werkzeug: 'pen' | 'marker') => {
    stiftZugMelden(true);
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // M319: Druck je Punkt — nur bei echtem Stift mit Sensor. Maus und Finger
    // bekommen den simulierten Druck aus der Geschwindigkeit (perfect-freehand).
    const sensor = werkzeug === 'pen' && e.pointerType === 'pen' && !!e.pressure;
    vorhersage.current = [];
    drawing.current = {
      id: uid(),
      tool: werkzeug,
      color: werkzeug === 'marker' ? markerColor : effPenColor,
      width: aufBoard(werkzeug === 'marker' ? staerken.marker : staerken.pen, zoom),
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
    // M348: höchstens zwei vorhergesagte Punkte — genug, um die Verzögerung eines Bildes aufzuholen
    const v = roh as PointerEvent & { getPredictedEvents?: () => PointerEvent[] };
    const vor = typeof v.getPredictedEvents === 'function' ? v.getPredictedEvents().slice(0, 2) : [];
    const alt = vorhersage.current.length;
    vorhersage.current = vor.map((p) => { const f = screenToFlowPosition({ x: p.clientX, y: p.clientY }); return [f.x, f.y]; });
    return neu || alt > 0 || vor.length > 0;
  };

  /** Zwei Finger auf der Ebene: Zoom um die Fingermitte, Schwenken mit der Mitte (M326) */
  const pinchBewegen = () => {
    const p = pinch.current;
    const [a, b] = Array.from(fingerZeiger.current.values());
    if (!p || !a || !b) return;
    const rf = document.querySelector('.react-flow')?.getBoundingClientRect();
    const ox = rf?.left ?? 0, oy = rf?.top ?? 0;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mitte: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const zoom = Math.max(0.1, Math.min(4, p.vp0.zoom * (d / Math.max(1, p.d0))));
    // Der Flow-Punkt unter der Anfangs-Mitte bleibt unter der aktuellen Mitte
    const fx = (p.mitte0[0] - ox - p.vp0.x) / p.vp0.zoom;
    const fy = (p.mitte0[1] - oy - p.vp0.y) / p.vp0.zoom;
    void setViewport({ x: mitte[0] - ox - fx * zoom, y: mitte[1] - oy - fy * zoom, zoom });
  };
  const onDown = (e: React.PointerEvent) => {
    // Handballen-Abweisung: Solange der Stift zeichnet, sind Finger tabu
    if (fuehrend.current?.art === 'pen' && e.pointerType !== 'pen') return;
    if (e.pointerType === 'touch') {
      fingerZeiger.current.set(e.pointerId, [e.clientX, e.clientY]);
      // Ein zweiter Finger beendet den Strich des ersten — und ab jetzt zoomen und schwenken die zwei (M326)
      if (fingerZeiger.current.size >= 2) {
        drawing.current = null; clearHold(); fuehrend.current = null;
        const [a, b] = Array.from(fingerZeiger.current.values());
        pinch.current = { d0: Math.hypot(b[0] - a[0], b[1] - a[1]), mitte0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], vp0: getViewport() };
        try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* egal */ }
        force((n) => n + 1);
        return;
      }
    }
    // Capture kann bei exotischen/synthetischen Pointern fehlschlagen — Zeichnen geht trotzdem
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignorieren */ }
    const pt = toFlow(e);
    // M325: Das Radierer-Ende des Stifts radiert immer — egal, welches Werkzeug gewählt ist
    const radierEnde = e.pointerType === 'pen' && ((e.buttons & 32) !== 0 || e.button === 5);
    if (tool === 'eraser' || radierEnde) { fuehrend.current = { id: e.pointerId, art: e.pointerType }; stiftZug.current = radierEnde ? 'radierer' : stiftZug.current; beginEraseGesture(); radieren(pt[0], pt[1]); return; }
    if (tool !== 'pen' && tool !== 'marker') return; // passiver Layer (pointer-events: none)
    fuehrend.current = { id: e.pointerId, art: e.pointerType };
    tippMerken(e);
    strichStarten(e, tool);
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && fingerZeiger.current.has(e.pointerId)) {
      fingerZeiger.current.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch.current && fingerZeiger.current.size >= 2) { pinchBewegen(); return; }
    }
    if (fuehrend.current && e.pointerId !== fuehrend.current.id) return;
    if (tool === 'eraser' || (fuehrend.current && stiftZug.current === 'radierer')) {
      const pt = toFlow(e);
      if (e.buttons) radieren(pt[0], pt[1]);
      return;
    }
    tippPruefen(e);
    if (!drawing.current) return;
    if (!punkteAufnehmen(e.nativeEvent)) return;
    armHold();
    liveZeichnen();
  };
  const fingerWeg = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    fingerZeiger.current.delete(e.pointerId);
    if (fingerZeiger.current.size < 2) pinch.current = null;
  };
  const onUp = (e?: { clientX: number; clientY: number }) => {
    clearHold();
    fuehrend.current = null;
    stiftZug.current = null;
    stiftZugMelden(false);
    const d = drawing.current;
    // M355: Ein kurzer, stiller Kontakt beim Schreiben ist ein i-Punkt (oder Umlaut-Punkt), kein Klick
    if (d && d.tool === 'pen' && (d.points.length === 1 || tippIst(e)) && punktStattTipp(e)) {
      punktSetzen(d);
      return;
    }
    // M325: Ein kurzer, stiller Stift-Kontakt ist ein Tipp — er klickt, was darunter liegt
    if (d && d.tool === 'pen' && tippIst(e)) {
      drawing.current = null;
      tipp.current = null;
      force((n) => n + 1);
      if (e) tippAusfuehren(e.clientX, e.clientY);
      return;
    }
    tipp.current = null;
    if (d && d.points.length > 1) {
      // M324: Gesten zuerst — Umkreisen markiert, Durchstreichen löscht
      if (gesteAusfuehren(d)) {
        drawing.current = null;
        force((n) => n + 1);
        return;
      }
      // M356: Der Textmarker wird zum geraden Balken — auf einer Textzeile in Zeilenhöhe
      if (d.tool === 'marker') {
        commitStroke(markerFertig(d));
        letzterStrich.current = Date.now();
        drawing.current = null;
        force((n) => n + 1);
        return;
      }
      // Loslassen: entzittern + fast gerade Striche konservativ begradigen
      const points = finalizeStroke(d.points);
      commitStroke({ ...d, points, druck: d.druck && d.druck.length === points.length ? d.druck : undefined });
      letzterStrich.current = Date.now();
      if (d.tool === 'pen') vorschlagPlanen();
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
      if (!ziel.closest('.react-flow')) return;
      const stift = e.pointerType === 'pen';
      /**
       * M325: Das Radierer-Ende des Stifts (Surface Pen, Wacom: buttons 32)
       * radiert immer — in jedem Werkzeug, auch in der Auswahl.
       */
      if (stift && ((e.buttons & 32) !== 0 || e.button === 5)) {
        e.preventDefault(); e.stopPropagation();
        fuehrend.current = { id: e.pointerId, art: 'pen' };
        stiftZug.current = 'radierer';
        stiftZugMelden(true);
        beginEraseGesture();
        const pt = toFlow(e);
        radieren(pt[0], pt[1]);
        return;
      }
      if (werkzeug === 'select') {
        /**
         * M325: „Der Stift schreibt, der Finger bedient" (Procreate, OneNote,
         * Apple). Im Auswahlmodus schreibt der Stift auf der freien Fläche UND
         * auf Notizen — ein Tipp klickt (Cursor setzen, Haken, Karte wählen),
         * die Seitentaste (buttons 2) macht ihn zum normalen Zeiger (Karte
         * ziehen, Text markieren), der Griff und die Bedienelemente bleiben
         * Bedienelemente. Module (Kanban, Tabellen …) bedient der Stift weiter.
         */
        if (!stift) return;
        if ((e.buttons & 2) !== 0) { griffStarten(e, ziel); return; }
        if (!ziel.closest(SCHREIBFLAECHE) || ziel.closest(KARTEN_BEDIENUNG)) return;
        e.preventDefault(); e.stopPropagation();
        stiftZug.current = 'strich';
        fuehrend.current = { id: e.pointerId, art: 'pen' };
        tippMerken(e);
        strichStarten(e, 'pen');
        return;
      }
      // Zeichenmodus mit Durchgriff: Finger schieben (React Flow), Stift und Maus zeichnen
      if (!durchgriff || e.pointerType === 'touch') return;
      if (stift && (e.buttons & 2) !== 0) { griffStarten(e, ziel); return; } // Seitentaste greift — auch im Zeichenmodus
      e.preventDefault(); e.stopPropagation();
      fuehrend.current = { id: e.pointerId, art: e.pointerType };
      if (werkzeug === 'eraser') {
        stiftZug.current = 'radierer';
        beginEraseGesture();
        const pt = toFlow(e);
        radieren(pt[0], pt[1]);
        return;
      }
      stiftZug.current = 'strich';
      if (stift) tippMerken(e);
      strichStarten(e, werkzeug === 'marker' ? 'marker' : 'pen');
    };
    const bewegen = (e: PointerEvent) => {
      if (!stiftZug.current || e.pointerId !== fuehrend.current?.id) return;
      e.preventDefault();
      e.stopPropagation();
      if (stiftZug.current === 'radierer') {
        const pt = toFlow(e);
        radieren(pt[0], pt[1]);
        return;
      }
      if (stiftZug.current === 'griff') { griffBewegen(e); return; }
      tippPruefen(e);
      if (!punkteAufnehmen(e)) return;
      armHold();
      liveZeichnen();
    };
    const hoch = (e: PointerEvent) => {
      if (!stiftZug.current || e.pointerId !== fuehrend.current?.id) return;
      const art = stiftZug.current;
      stiftZug.current = null;
      if (art === 'radierer') { fuehrend.current = null; stiftZugMelden(false); return; }
      if (art === 'griff') { griffEnde(); fuehrend.current = null; stiftZugMelden(false); return; }
      onUp(e);
    };
    // Seitentaste = rechte Taste: das Kontextmenü des Browsers hat beim Greifen nichts verloren
    const kontext = (e: MouseEvent) => { if (stiftZug.current === 'griff' || griff.current) e.preventDefault(); };
    window.addEventListener('contextmenu', kontext, true);

    /**
     * M322: React Flow schwenkt (d3-zoom) und zieht Karten (d3-drag) nicht über
     * Pointer-, sondern über TOUCH-Ereignisse. iPadOS und Android melden den
     * Stift zusätzlich als Touch — `stopPropagation` am pointerdown erreicht
     * die nicht, und seit die Ebene bei Stift-Geräten durchlässig ist (M319),
     * schwenkte die Seite unter jedem Strich weg (User-Meldung). Deshalb: Jeder
     * Touch, der beginnt, während ein Stift-Zug läuft (der Stift selbst — das
     * pointerdown kommt vor dem touchstart — und der Handballen), wird samt
     * seiner Folge-Ereignisse hier geschluckt, bevor React Flow ihn sieht.
     * Finger ohne laufenden Stift-Zug gehen weiter durch: Schieben und Zoomen
     * bleiben, auch mit dem Stift als normalem Zeiger über einer Karte.
     */
    const beruehren = (e: TouchEvent) => {
      const kennungen = geschluckt.current;
      let treffer = false;
      fingerTippBuchen(e);
      for (const t of Array.from(e.changedTouches)) {
        if (e.type === 'touchstart') {
          if (stiftZug.current) { kennungen.add(t.identifier); treffer = true; }
        } else if (kennungen.has(t.identifier)) {
          treffer = true;
          if (e.type !== 'touchmove') kennungen.delete(t.identifier);
        }
      }
      if (!treffer) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    };

    window.addEventListener('pointerdown', runter, true);
    window.addEventListener('pointermove', bewegen, true);
    window.addEventListener('pointerup', hoch, true);
    // Bricht iOS den Zeiger ab (Systemgeste, App-Wechsel), kommt KEIN pointerup
    window.addEventListener('pointercancel', hoch, true);
    // passive: false — sonst darf touchstart/touchmove am Fenster kein preventDefault
    window.addEventListener('touchstart', beruehren, { capture: true, passive: false });
    window.addEventListener('touchmove', beruehren, { capture: true, passive: false });
    window.addEventListener('touchend', beruehren, true);
    window.addEventListener('touchcancel', beruehren, true);
    return () => {
      window.removeEventListener('contextmenu', kontext, true);
      window.removeEventListener('pointerdown', runter, true);
      window.removeEventListener('pointermove', bewegen, true);
      window.removeEventListener('pointerup', hoch, true);
      window.removeEventListener('pointercancel', hoch, true);
      window.removeEventListener('touchstart', beruehren, true);
      window.removeEventListener('touchmove', beruehren, true);
      window.removeEventListener('touchend', beruehren, true);
      window.removeEventListener('touchcancel', beruehren, true);
    };
  });

  /* ───────────── M324: Gesten, Ziel-Logik, Vorschlag, KI-Korrektur ───────────── */

  /** Vorschlag verwerfen — samt laufender Erkennung, damit sie nicht nachträglich wieder auftaucht */
  const vorschlagVerwerfen = () => {
    if (vorschlagTimer.current !== null) { window.clearTimeout(vorschlagTimer.current); vorschlagTimer.current = null; }
    vorschlagLauf.current += 1;
    setVorschlag(null);
  };
  /** Absolute Flow-Punkte eines Strichs (geankerte liegen relativ zur Karte) */
  const absolut = (s: Stroke): Pt[] => {
    const n = s.anchor ? nodes.find((k) => k.id === s.anchor) : undefined;
    const dx = n?.position.x ?? 0, dy = n?.position.y ?? 0;
    const rel = strichRelativ(s); // M335: Seitenstriche umgerechnet (leer, wenn verdeckt) · M339: Text-Striche, wo man sie sieht
    return dx || dy ? rel.map((p) => [p[0] + dx, p[1] + dy] as Pt) : rel;
  };
  /** Die Stift-Striche dieser Schreibsitzung — das, was gerade geschrieben wurde */
  /**
   * M355: i-Punkte und Umlaut-Punkte. Ein Punkt ist ein kurzer, stiller Stift-Kontakt — genau das, was seit
   * M325 als Tipp (= Klick) galt. Er wurde deshalb verworfen; ein stillstehender Kontakt (ein einziger
   * Messpunkt) ebenso, und zwei schnelle Tipps für ein „ü" lösten obendrein einen Doppelklick aus.
   * Jetzt ist er ein Punkt, wenn
   *   · kurz davor (4 s) in der Nähe geschrieben wurde — dicht am Geschriebenen (bis ~1,5 Zeilen darüber), oder
   *   · der Stift-/Marker-Modus an ist und darunter nichts Bedienbares liegt (Knopf, Haken, Feld, Text im Editor).
   * Ein Tipp auf Bedienbares oder in Text ohne frisches Schreiben bleibt ein Klick (Cursor setzen, Haken).
   */
  const letzterStrich = useRef(0);
  const klickSchlucken = useRef(0);
  const punktStattTipp = (e?: { clientX: number; clientY: number }): boolean => {
    if (!e) return false;
    const unter = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (unter?.closest('button, a[href], input, select, textarea, label, [role="checkbox"], [role="button"], [role="menuitem"], .card-grip, .ebenen-menu-knopf')) return false;
    if (Date.now() - letzterStrich.current < 4000) {
      const eigene = sessionStriche().slice(-12);
      if (eigene.length) {
        const box = bboxVon(eigene.map(absolut).flat());
        const [l, t] = zumSchirm([box.minX, box.minY]);
        const [r, b] = zumSchirm([box.maxX, box.maxY]);
        const zeile = Math.max(24, Math.min(80, b - t));
        if (e.clientX > l - 60 && e.clientX < r + 60 && e.clientY > t - zeile * 1.5 && e.clientY < b + 16) return true;
      }
    }
    const werkzeug = useBoard.getState().tool;
    return (werkzeug === 'pen' || werkzeug === 'marker') && !unter?.closest('[contenteditable="true"]');
  };
  const punktSetzen = (d: Stroke) => {
    const [x, y] = d.points[0];
    // Zwei Punkte, kaum auseinander: eine Linie der Länge ~0 mit runden Enden — ein runder Punkt.
    // Etwas kräftiger als der Strich (wie ein aufgesetzter Stift), damit er neben „fein" sichtbar bleibt.
    commitStroke({ ...d, points: [[x, y], [x + 0.1, y + 0.1]], druck: undefined, width: Math.round(d.width * 1.6 * 100) / 100 });
    drawing.current = null;
    tipp.current = null;
    letzterStrich.current = Date.now();
    klickSchlucken.current = Date.now();
    vorschlagPlanen();
    force((n) => n + 1);
  };
  // Der Browser schickt nach dem abgefangenen pointerdown trotzdem click und dblclick — nach einem Punkt
  // darf das nichts auslösen (zwei Umlaut-Punkte = Doppelklick = neue Notiz / Fokus)
  useEffect(() => {
    const schlucken = (ev: MouseEvent) => {
      if (Date.now() - klickSchlucken.current < 450) { ev.preventDefault(); ev.stopPropagation(); }
    };
    window.addEventListener('click', schlucken, true);
    window.addEventListener('dblclick', schlucken, true);
    return () => { window.removeEventListener('click', schlucken, true); window.removeEventListener('dblclick', schlucken, true); };
  }, []);

  /**
   * M356: Markerstrich fertig machen. Annähernd waagerecht → gerade gezogen (auf mittlerer Höhe, von ganz
   * links bis ganz rechts). Liegt er auf einer Textzeile, wird er zum Balken in Zeilenhöhe mit geraden
   * Kanten, von Wortanfang bis Wortende (lib/markerZeile.ts). Alles andere bleibt Freihand (entzittert).
   * Die Zwischenpunkte sind für den Radierer da: Er trifft Punkte, und ein Balken soll sich teilen lassen.
   */
  const markerFertig = (d: Stroke): Stroke => {
    const box = bboxVon(d.points);
    const waagerecht = box.w >= 24 / zoom && box.h <= Math.max(d.width * 0.9, box.w * 0.2);
    if (!waagerecht) return { ...d, points: finalizeStroke(d.points), druck: undefined };
    let x1 = box.minX; let x2 = box.maxX;
    let y = d.points.reduce((s, p) => s + p[1], 0) / d.points.length;
    let breite = d.width; let gerade = false;
    const [sx1, sy] = zumSchirm([x1, y]); const [sx2] = zumSchirm([x2, y]);
    const z = markerEinrasten(sx1, sx2, sy);
    if (z) {
      const a = zumFlow(z.l, z.y); const b = zumFlow(z.r, z.y);
      x1 = a[0]; x2 = b[0]; y = a[1];
      breite = Math.round((z.h / zoom) * 100) / 100;
      gerade = true;
    }
    const schritt = Math.max(4, 8 / zoom);
    const n = Math.max(1, Math.ceil((x2 - x1) / schritt));
    const points: Pt[] = Array.from({ length: n + 1 }, (_, i) => [x1 + ((x2 - x1) * i) / n, y] as Pt);
    return { ...d, points, druck: undefined, width: breite, ...(gerade ? { gerade: true } : {}) };
  };

  const sessionStriche = (): Stroke[] => {
    const ids = sessionIds.current;
    return (selectActiveBoard(useBoard.getState()).drawings ?? []).filter((s) => ids.includes(s.id) && s.tool === 'pen');
  };

  /**
   * Umkreisen markiert, Durchstreichen löscht. Läuft VOR dem Speichern eines
   * Strichs; liefert true, wenn der Strich eine Geste war (und nicht gespeichert wird).
   */
  const gesteAusfuehren = (d: Stroke): boolean => {
    if (d.tool !== 'pen') return false;
    const pts = d.points;
    // M325: Getippten Text bearbeiten — Kritzel/Durchstreichen löscht Wörter, kleine Schleife markiert
    if (textGesteAusfuehren(pts)) return true;
    // Lasso: eine geschlossene Schleife, in deren Mitte Karten liegen
    if (istSchleife(pts)) {
      const alle = getNodes() as AppNode[];
      const treffer = alle.filter((n) => !n.hidden && !n.archived && n.type !== 'frame').filter((n) => {
        const w = n.measured?.width ?? (typeof n.width === 'number' ? n.width : 200);
        const h = n.measured?.height ?? (typeof n.height === 'number' ? n.height : 100);
        return punktInPolygon([n.position.x + w / 2, n.position.y + h / 2], pts);
      });
      if (treffer.length > 0) {
        const ids = new Set(treffer.map((n) => n.id));
        onNodesChange(alle.map((n) => ({ id: n.id, type: 'select' as const, selected: ids.has(n.id) })));
        setTool('select');
        showToast(treffer.length === 1 ? '◯ 1 Karte markiert' : `◯ ${treffer.length} Karten markiert`);
        return true;
      }
    }
    // Durchstreichen: ein Kritzel, der andere Striche überdeckt
    if (istKritzel(pts)) {
      const box = bboxVon(pts);
      const opfer = (selectActiveBoard(useBoard.getState()).drawings ?? [])
        .filter((s) => s.id !== d.id && ueberdeckung(box, bboxVon(absolut(s))) >= 0.5);
      if (opfer.length > 0) {
        removeStrokes(opfer.map((s) => s.id));
        sessionIds.current = sessionIds.current.filter((id) => !opfer.some((s) => s.id === id));
        vorschlagVerwerfen();
        showToast(opfer.length === 1 ? '✂️ Durchgestrichen — Strich gelöscht (↶ holt ihn zurück)' : `✂️ Durchgestrichen — ${opfer.length} Striche gelöscht (↶ holt sie zurück)`);
        return true;
      }
    }
    return false;
  };

  /** Flow → Bildschirm (für DOM-Treffer) */
  const zumSchirm = (p: Pt): [number, number] => {
    const rf = document.querySelector('.react-flow')?.getBoundingClientRect();
    return [(rf?.left ?? 0) + p[0] * zoom + tx, (rf?.top ?? 0) + p[1] * zoom + ty];
  };
  /** Bildschirm → Flow */
  const zumFlow = (x: number, y: number): Pt => {
    const p = screenToFlowPosition({ x, y });
    return [p.x, p.y];
  };
  /** Alle Wörter einer Notiz mit Block-Element und Block-Id (Bildschirm-Rechtecke) */
  const woerterDerNotiz = (noteEl: Element): Array<Wort & { blockId: string; blockEl: HTMLElement }> => {
    const out: Array<Wort & { blockId: string; blockEl: HTMLElement }> = [];
    for (const b of Array.from(noteEl.querySelectorAll('.bn-editor .bn-block[data-id]')) as HTMLElement[]) {
      const typ = (b.querySelector('.bn-block-content') as HTMLElement | null)?.dataset.contentType ?? '';
      if (typ === 'rechentabelle' || typ === 'table' || typ === 'image') continue;
      for (const w of woerterImBlock(b)) out.push({ ...w, blockId: b.dataset.id!, blockEl: b });
    }
    return out;
  };
  /** Bereiche je Block aus dem Inhalt löschen und die Notiz schreiben */
  const woerterLoeschen = (noteId: string, treffer: Array<Wort & { blockId: string }>) => {
    const node = nodes.find((n) => n.id === noteId);
    if (!node) return;
    const proBlock = new Map<string, Array<[number, number]>>();
    for (const w of treffer) proBlock.set(w.blockId, [...(proBlock.get(w.blockId) ?? []), [w.start, w.end]]);
    // M338: Blöcke ohne Id finden sich über ihre Pfad-Id (wie die ruhende Ansicht sie zeigt); gespeichert werden feste
    const alt = mitPfadIds(((node.data as { blocks?: unknown[] }).blocks ?? []) as Array<{ id?: string; content?: BlockInhalt; children?: unknown[] }>);
    const neu = alt.map((b) => (b.id && proBlock.has(b.id) ? { ...b, content: inhaltOhneBereiche(b.content, proBlock.get(b.id)!) } : b));
    updateNodeDataOnBoard(activeId, noteId, { blocks: mitFestenIds(neu) });
  };
  /**
   * Getippten Text mit dem Stift bearbeiten (Nebo, Scribble): Ein Kritzel oder
   * ein waagerechter Strich durch Wörter löscht sie; eine kleine Schleife um
   * Wörter markiert sie (Formatierleiste erscheint). Nur über einer Notiz.
   */
  const textGesteAusfuehren = (pts: Pt[]): boolean => {
    const box = bboxVon(pts);
    const [mx, my] = zumSchirm([box.minX + box.w / 2, box.minY + box.h / 2]);
    const noteEl = (document.elementFromPoint(mx, my) as HTMLElement | null)?.closest('.react-flow__node-note');
    if (!noteEl) return false;
    const noteId = (noteEl as HTMLElement).dataset.id;
    if (!noteId) return false;
    const woerter = woerterDerNotiz(noteEl);
    if (woerter.length === 0) return false;
    const [l, t] = zumSchirm([box.minX, box.minY]);
    const [r, b] = zumSchirm([box.maxX, box.maxY]);
    const schirmBox: Box = { minX: l, minY: t, maxX: r, maxY: b, w: r - l, h: b - t };
    const wortBox = (w: Wort): Box => ({ minX: w.rect.left, minY: w.rect.top, maxX: w.rect.right, maxY: w.rect.bottom, w: w.rect.width, h: w.rect.height });
    // Kritzel über Wörtern → löschen
    if (istKritzel(pts)) {
      const treffer = woerter.filter((w) => ueberdeckung(schirmBox, wortBox(w)) >= 0.5);
      if (treffer.length > 0) {
        woerterLoeschen(noteId, treffer);
        showToast(treffer.length === 1 ? `✂️ „${treffer[0].text}" gelöscht (↶ holt es zurück)` : `✂️ ${treffer.length} Wörter gelöscht (↶ holt sie zurück)`);
        return true;
      }
    }
    // Waagerechter Strich MITTEN durch Wörter → durchgestrichen = gelöscht; unter der Zeile bleibt er eine Unterstreichung
    if (istWaagerechteLinie(pts)) {
      const y = (t + b) / 2;
      const treffer = woerter.filter((w) => {
        const band = y > w.rect.top + w.rect.height * 0.3 && y < w.rect.top + w.rect.height * 0.72;
        const ueber = Math.max(0, Math.min(r, w.rect.right) - Math.max(l, w.rect.left)) / Math.max(1, w.rect.width);
        return band && ueber >= 0.6;
      });
      if (treffer.length > 0) {
        woerterLoeschen(noteId, treffer);
        showToast(treffer.length === 1 ? `✂️ „${treffer[0].text}" durchgestrichen — gelöscht (↶)` : `✂️ ${treffer.length} Wörter durchgestrichen — gelöscht (↶)`);
        return true;
      }
    }
    // Kleine Schleife um Wörter → markieren (eine Schleife um die ganze Karte ist ein Karten-Lasso, M324)
    const kr = noteEl.getBoundingClientRect();
    const umKarte = punktInPolygon(zumFlow(kr.left + kr.width / 2, kr.top + kr.height / 2), pts);
    if (!umKarte && istSchleife(pts, 600, 90)) {
      const drin = woerter.filter((w) => punktInPolygon(zumFlow(w.rect.left + w.rect.width / 2, w.rect.top + w.rect.height / 2), pts));
      if (drin.length > 0 && drin.every((w) => w.blockId === drin[0].blockId)) {
        const von = drin[0], bis = drin[drin.length - 1];
        const meldung = drin.length === 1 ? `◯ „${von.text}" markiert` : `◯ ${drin.length} Wörter markiert`;
        // M338: Die Notiz ruht (kein Editor) — eine Markierung braucht ihn. Wecken, dann im lebenden Text markieren.
        if (!von.blockEl.closest('[contenteditable="true"]')) {
          window.dispatchEvent(new CustomEvent('pixinotes:notiz-aktiv', { detail: { id: noteId } }));
          let versuche = 0;
          const dann = () => {
            const el = Array.from(document.querySelectorAll(`.react-flow__node[data-id="${noteId}"] [contenteditable="true"] .bn-block[data-id]`))
              .find((b) => (b as HTMLElement).dataset.id === von.blockId) as HTMLElement | undefined;
            if (el) { woerterMarkieren(el, von, bis); return; }
            versuche += 1;
            if (versuche < 90) requestAnimationFrame(dann);
          };
          requestAnimationFrame(dann);
          showToast(meldung);
          return true;
        }
        if (woerterMarkieren(von.blockEl, von, bis)) {
          showToast(meldung);
          return true;
        }
      }
    }
    return false;
  };

  /** Wohin gehört die Schrift? In die Notiz, über der (die meisten) Striche liegen — sonst ins Leere */
  const zielNotiz = (striche: Stroke[]): AppNode | null => {
    const zaehler = new Map<string, number>();
    for (const s of striche) if (s.anchor) zaehler.set(s.anchor, (zaehler.get(s.anchor) ?? 0) + 1);
    const [best] = [...zaehler.entries()].sort((a, b) => b[1] - a[1]);
    if (!best || best[1] * 2 < striche.length) return null;
    const n = nodes.find((k) => k.id === best[0]);
    return n && n.type === 'note' && !n.archived ? n : null;
  };

  /** Kontext für die KI-Korrektur: Zielnotiz, Board, Begriffe der anderen Karten */
  const kontextFuer = (ziel: AppNode | null): SchriftKontext => {
    const begriffe = nodes
      .filter((n) => n.id !== ziel?.id && !n.archived)
      .map((n) => noteTitle((n.data as { blocks?: unknown[] }).blocks, (n.data as { name?: string; title?: string }).name ?? (n.data as { title?: string }).title ?? ''))
      .filter((t) => t && t !== 'Notiz')
      .slice(0, 12);
    const bloecke = (ziel?.data as { blocks?: unknown[] } | undefined)?.blocks;
    return {
      board: boardName || undefined,
      notiz: ziel ? blocksToText(bloecke).slice(0, 600) : undefined,
      begriffe,
    };
  };

  /** Welcher Block der Notiz liegt unter der linken oberen Ecke der Schrift? (DOM) */
  const blockUnter = (nodeId: string, box: { minX: number; minY: number; h: number }): { id: string; type: string } | null => {
    const rf = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (!rf) return null;
    const sx = rf.left + (box.minX + 6) * zoom + tx;
    const sy = rf.top + (box.minY + Math.min(box.h, 18) / 2) * zoom + ty;
    const wurzel = document.querySelector(`.react-flow__node[data-id="${nodeId}"] .bn-editor`);
    if (!wurzel) return null;
    for (const el of document.elementsFromPoint(sx, sy)) {
      if (!wurzel.contains(el)) continue;
      const block = (el as HTMLElement).closest('[data-id][data-node-type="blockContainer"], .bn-block[data-id]') as HTMLElement | null;
      if (block?.dataset.id) {
        const inhalt = block.querySelector('.bn-block-content') as HTMLElement | null;
        return { id: block.dataset.id, type: inhalt?.dataset.contentType ?? 'paragraph' };
      }
    }
    return null;
  };

  /** M325/M327: Der Block der Notiz, auf den sich die Schrift bezieht — unter ihr oder in derselben Zeile */
  const bezugFinden = (ziel: AppNode, box: { minX: number; minY: number; h: number }): { id: string; type: string } | null => {
    let bezug = blockUnter(ziel.id, box);
    // Links im Rand oder rechts hinter dem Zeilenende trifft der Punkt keinen Block — dann zählt die Zeilenhöhe
    if (!bezug) {
      const [, sy] = zumSchirm([box.minX, box.minY + Math.min(box.h, 18) / 2]);
      const treffer = (Array.from(document.querySelectorAll(`.react-flow__node[data-id="${ziel.id}"] .bn-editor .bn-block[data-id]`)) as HTMLElement[])
        .find((b) => { const r = b.getBoundingClientRect(); return sy >= r.top && sy <= r.bottom; });
      if (treffer?.dataset.id) bezug = { id: treffer.dataset.id, type: (treffer.querySelector('.bn-block-content') as HTMLElement | null)?.dataset.contentType ?? 'paragraph' };
    }
    return bezug;
  };

  /**
   * M327: Welche Textart legt die Notiz nahe? Die des Blocks, neben dem
   * geschrieben wird; unterhalb des letzten Blocks die des letzten Blocks mit
   * Inhalt. Nur Listenarten setzen sich fort (eine Überschrift nicht). Beginnt
   * die Schrift links der Listen-Einrückung — unter dem Punkt statt unter dem
   * Text —, will der Schreiber zurück zu normalem Text, wie auf Papier.
   */
  const kontextArt = (ziel: AppNode | null, box: { minX: number; minY: number; h: number }): BlockArt | null => {
    if (!ziel) return null;
    const bezug = bezugFinden(ziel, box);
    let art: string | null = bezug?.type ?? null;
    let blockEl: HTMLElement | null = bezug ? (document.querySelector(`.react-flow__node[data-id="${ziel.id}"] .bn-block[data-id="${bezug.id}"]`) as HTMLElement | null) : null;
    if (!bezug) {
      const bloecke = Array.from(document.querySelectorAll(`.react-flow__node[data-id="${ziel.id}"] .bn-editor .bn-block[data-id]`)) as HTMLElement[];
      const [, sy] = zumSchirm([box.minX, box.minY]);
      // Der letzte Block mit Inhalt — der leere Schluss-Absatz von BlockNote zählt nicht
      const letzter = [...bloecke].reverse().find((b) => (b.querySelector('.bn-inline-content')?.textContent ?? '').trim() !== '');
      if (letzter && sy >= letzter.getBoundingClientRect().top) { art = (letzter.querySelector('.bn-block-content') as HTMLElement | null)?.dataset.contentType ?? null; blockEl = letzter; }
    }
    if (!istListe(art)) return null;
    // Nur unterhalb der Liste: Schrift auf einer bestehenden Zeile wird dort eingefügt (M325), auch vor dem Zeilenanfang
    const inhalt = !bezug ? (blockEl?.querySelector('.bn-inline-content') as HTMLElement | null) : null;
    if (inhalt) {
      const [sx] = zumSchirm([box.minX, box.minY]);
      if (sx < inhalt.getBoundingClientRect().left - 8) return 'paragraph';
    }
    return art;
  };

  /**
   * M327: Die Schrift dieser Sitzung erkennen — erst die Form-Marker lesen
   * (Kästchen, Punkt, Strich, Unterstreichung, Größe), dann den Rest erkennen
   * lassen, dann Text-Marker („- ", „1. ", „[ ] ", „# ") und den Kontext der
   * Zielnotiz anwenden. `ki`: die KI-korrigierten Zeilen, wenn eine KI läuft.
   */
  const schriftErkennen = async (eigene: Stroke[], mitKi: boolean): Promise<{ zeilen: ZeileMitArt[]; ki: Promise<ZeileMitArt[]> | null }> => {
    const punkte = eigene.map(absolut);
    const box = bboxVon(punkte.flat());
    const ziel = zielNotiz(eigene);
    const form = markerAusStrichen(punkte);
    const k = await handschriftKandidaten(form.ohneMarker.length > 0 ? form.ohneMarker : punkte);
    const text = textAufraeumen(k.text);
    if (!text) return { zeilen: [], ki: null };
    const kontext = kontextArt(ziel, box);
    const zeilen = zeilenMitArt(text.split('\n'), form.zeilen, kontext);
    let ki: Promise<ZeileMitArt[]> | null = null;
    if (mitKi) {
      ki = kiKorrektur(text, k.alternativen, kontextFuer(ziel)).then((besser) => {
        const neu = zeilenMitArt(besser.split('\n'), form.zeilen, kontext);
        if (neu.length !== zeilen.length) return neu;
        // Die KI korrigiert Lesefehler, nicht die Struktur — Form und Kontext bleiben
        return neu.map((z, i) => (z.quelle === 'text' ? z : { ...z, art: zeilen[i].art, checked: zeilen[i].checked, level: zeilen[i].level, quelle: zeilen[i].quelle }));
      });
    }
    return { zeilen, ki };
  };

  /**
   * Text in die Notiz einfügen. M325: Steht die Schrift IN einer Zeile (links
   * am Zeilenanfang, zwischen zwei Wörtern oder hinter dem Zeilenende), wird
   * sie dort eingefügt — mitten in den getippten Text. Sonst wie M324: als
   * Block nach dem Block unter der Schrift (neben einer Liste als Listenpunkt),
   * ohne Bezug ans Ende.
   */
  const inNotizEinfuegen = (ziel: AppNode, zeilen: ZeileMitArt[], box: { minX: number; minY: number; h: number }) => {
    const alt = mitPfadIds(((ziel.data as { blocks?: unknown[] }).blocks ?? []) as Array<{ id?: string; type?: string; content?: unknown; children?: unknown[] }>);
    const bezug = bezugFinden(ziel, box);
    const text = zeilen.map((z) => z.text).join('\n');
    // M327: Nur eine Zeile ohne eigenen Marker darf mitten in den getippten Text — mit Marker wird sie ein eigener Block
    if (bezug && zeilen.length === 1 && (zeilen[0].quelle === 'keine' || zeilen[0].quelle === 'kontext')) {
      const blockEl = document.querySelector(`.react-flow__node[data-id="${ziel.id}"] .bn-block[data-id="${bezug.id}"]`) as HTMLElement | null;
      const typ = (blockEl?.querySelector('.bn-block-content') as HTMLElement | null)?.dataset.contentType ?? '';
      const woerter = blockEl && !['rechentabelle', 'table', 'image'].includes(typ) ? woerterImBlock(blockEl) : [];
      if (blockEl && woerter.length > 0) {
        const [sx, sy] = zumSchirm([box.minX, box.minY + Math.min(box.h, 18) / 2]);
        const zeile = woerter.filter((w) => sy >= w.rect.top - 2 && sy <= w.rect.bottom + 2);
        if (zeile.length > 0) {
          const rechts = Math.max(...zeile.map((w) => w.rect.right));
          const links = Math.min(...zeile.map((w) => w.rect.left));
          let offset: number | null = null;
          if (sx >= rechts - 4) offset = zeile[zeile.length - 1].end;            // hinter dem Zeilenende
          else if (sx <= links + 4) offset = zeile[0].start;                      // vor dem Zeilenanfang
          else offset = offsetUnterPunkt(blockEl, sx, sy);                        // zwischen zwei Wörtern
          // Mitten in einem Wort gelandet → an die nähere Wortgrenze
          if (offset !== null) {
            const mitten = zeile.find((w) => offset! > w.start && offset! < w.end);
            if (mitten) offset = sx - mitten.rect.left < mitten.rect.right - sx ? mitten.start : mitten.end;
          }
          if (offset !== null) {
            const i = alt.findIndex((b) => b.id === bezug.id);
            if (i >= 0) {
              const neu = alt.map((b, k) => (k === i ? { ...b, content: inhaltMitEinfuegung(b.content as BlockInhalt, offset!, text) } : b));
              updateNodeDataOnBoard(activeId, ziel.id, { blocks: mitFestenIds(neu) });
              return;
            }
          }
        }
      }
    }
    // M327: Die Zeilen tragen ihre Art schon (Form, Text-Marker oder Kontext der Notiz)
    const neue = zeilenZuBloecken(zeilen);
    // Ein leerer Schluss-Absatz (BlockNote hält ihn bereit) soll nicht zwischen Text und Schrift stehen
    const leer = (b: { type?: string; content?: unknown }) => b.type === 'paragraph' && Array.isArray(b.content) && b.content.length === 0;
    let out: unknown[];
    const i = bezug ? alt.findIndex((b) => b.id === bezug.id) : -1;
    if (i >= 0) out = [...alt.slice(0, i + 1), ...neue, ...alt.slice(i + 1)];
    else {
      const basis = alt.length > 1 && leer(alt[alt.length - 1]) ? alt.slice(0, -1) : alt;
      out = [...basis, ...neue];
    }
    updateNodeDataOnBoard(activeId, ziel.id, { blocks: mitFestenIds(out as Array<{ id?: string; children?: unknown[] }>) });
  };

  /**
   * M320/M324: Handschrift → Text. Nimmt die Striche dieser Schreibsitzung,
   * lässt sie erkennen (mit KI-Korrektur, wenn eingerichtet) und bringt den
   * Text dahin, wo er hingehört: in die Notiz unter der Schrift oder in eine
   * neue Notiz an Ort und Stelle. Die Striche verschwinden; ↶ holt beides zurück.
   * `fertig`: schon erkannter Text (vom Vorschlag) — dann keine zweite Erkennung.
   */
  const handschriftUebernehmen = async (fertig?: ZeileMitArt[]) => {
    const eigene = sessionStriche();
    if (eigene.length === 0) { showToast('Erst mit dem Stift schreiben, dann „Text".'); return; }
    setErkennt(true);
    vorschlagVerwerfen();
    try {
      const punkte = eigene.map(absolut);
      const box = bboxVon(punkte.flat());
      const ziel = zielNotiz(eigene);
      let zeilen = fertig ?? [];
      if (zeilen.length === 0) {
        const e = await schriftErkennen(eigene, handschriftKi && aiReady(ai));
        zeilen = e.ki ? await e.ki : e.zeilen;
      }
      const text = zeilen.map((z) => z.text).join('\n');
      if (!text) { showToast('Keine Schrift erkannt — deutlicher schreiben oder größer.'); return; }
      const kurz = text.length > 40 ? `${text.slice(0, 40)}…` : text;
      if (ziel) {
        inNotizEinfuegen(ziel, zeilen, box);
        showToast(`✍️ In „${noteTitle((ziel.data as { blocks?: unknown[] }).blocks)}" eingefügt: „${kurz}"`);
      } else {
        addNode(makeNote({ x: box.minX, y: box.minY }, { color: 'white', blocks: zeilenZuBloecken(zeilen) }));
        showToast(`✍️ Neue Notiz: „${kurz}"`);
      }
      removeStrokes(eigene.map((s) => s.id));
      sessionIds.current = sessionIds.current.filter((id) => !eigene.some((s) => s.id === id));
    } catch (e) {
      showToast((e as Error).message, false, 7000);
    } finally {
      setErkennt(false);
    }
  };

  /** Nach jedem Stift-Strich: Vorschlag neu planen — Ruhe von VORSCHLAG_MS → erkennen */
  const vorschlagPlanen = () => {
    vorschlagVerwerfen();
    if (!handschriftAuto || handschriftWeg() === 'keine') return;
    vorschlagTimer.current = window.setTimeout(() => { void vorschlagErmitteln(); }, VORSCHLAG_MS);
  };
  const vorschlagErmitteln = async () => {
    const eigene = sessionStriche();
    if (eigene.length === 0) return;
    const lauf = ++vorschlagLauf.current;
    const punkte = eigene.map(absolut);
    const box = bboxVon(punkte.flat());
    const ids = eigene.map((s) => s.id);
    // M354: Lage OBEN am Geschriebenen (unten nur, wenn oben kein Platz ist) — darunter versperrte der Vorschlag die nächste Zeile
    const lage = { ids, x: box.minX, y: box.maxY, oben: box.minY };
    setVorschlag({ ...lage, text: '', zeilen: [], status: 'erkennt' });
    try {
      const e = await schriftErkennen(eigene, handschriftKi && aiReady(ai));
      if (lauf !== vorschlagLauf.current) return;
      if (e.zeilen.length === 0) { setVorschlag(null); return; }
      const textVon = (z: ZeileMitArt[]) => z.map((x) => x.text).join('\n');
      setVorschlag({ ...lage, text: textVon(e.zeilen), zeilen: e.zeilen, status: e.ki ? 'ki' : 'fertig' });
      if (e.ki) {
        const besser = await e.ki;
        if (lauf !== vorschlagLauf.current) return;
        // Hat der Nutzer die Textart inzwischen umgeschaltet, bleibt seine Wahl
        setVorschlag((v) => (v && v.ids === ids
          ? { ...v, text: textVon(besser), status: 'fertig', zeilen: besser.map((z, i) => (v.zeilen.length === besser.length ? { ...z, art: v.zeilen[i].art, checked: v.zeilen[i].checked, level: v.zeilen[i].level } : z)) }
          : v));
      }
    } catch {
      if (lauf === vorschlagLauf.current) setVorschlag(null);
    }
  };
  // Zeichenmodus verlassen oder Esc: Vorschlag weg
  useEffect(() => {
    if (!active) vorschlagVerwerfen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    if (!vorschlag) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); vorschlagVerwerfen(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [vorschlag]);
  const schriftDa = sessionIds.current.some((id) => drawings.some((s) => s.id === id && s.tool === 'pen'));
  const rfRect = vorschlag ? document.querySelector('.react-flow')?.getBoundingClientRect() : null;
  /** M354: Der Vorschlag steht über dem Geschriebenen — außer ganz oben am Rand (Kopfzeile, Fokus-Kopf) */
  const vorschlagOben = !!vorschlag && !!rfRect && rfRect.top + vorschlag.oben * zoom + ty - 8 > rfRect.top + Math.max(56, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--focus-top')) || 0) + 44;

  // M348: der laufende Strich hat seinen eigenen Pfad (unten), er läuft nicht über die Liste
  const all = drawings;
  const lauf = drawing.current;
  // Geankerte Striche: Versatz = aktuelle Kartenposition (sie wandern so bei
  // Drag/Physik/Aufräumen automatisch mit); Karte weg/archiviert → unsichtbar
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const placed = all.flatMap((s) => {
    if (!s.anchor) return [{ s, dx: 0, dy: 0, dim: false }];
    const n = nodeById.get(s.anchor);
    if (!n || (n.archived && !showArchived)) return [];
    // M335: Seitenstriche nur, wenn ihre Seite offen liegt — in Kartenpunkte umgerechnet
    if (s.seite != null) {
      const g = seiteVon(s.anchor);
      if (!g || g.seite !== s.seite) return [];
      const t = seitenStrichCache.get(s);
      // M354: Breite in Seitenpunkten mit der Seite skaliert (ältere Seitenstriche: Board-Punkte, wie sie sind)
      const abgeleitet = t && t.g === g ? t.s : { ...s, points: strichRelativ(s), width: s.seitenBreite ? s.width * g.k : s.width, seitenBreite: undefined };
      if (!t || t.g !== g) seitenStrichCache.set(s, { g, s: abgeleitet });
      return [{ s: abgeleitet, dx: n.position.x, dy: n.position.y, dim: !!n.archived }];
    }
    // M339: Was auf dem Text einer Notiz liegt, zeichnet die Notiz selbst (scrollt mit) — hier nur der laufende Strich
    if (n.type === 'note' && !n.kachel && istAmText(s, true, n.width ?? n.measured?.width ?? 260, n.height ?? undefined)) return [];
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
        onPointerUp={(e) => { const war = pinch.current; fingerWeg(e); if (war) { force((n) => n + 1); return; } onUp(e); }}
        onPointerCancel={(e) => { const war = pinch.current; fingerWeg(e); if (war) { force((n) => n + 1); return; } onUp(e); }}
        // M326: Das Mausrad zoomt und scrollt auch beim Zeichnen — die Ebene reicht es an die Fläche durch
        onWheel={(e) => {
          const pane = document.querySelector('.react-flow__pane');
          if (!pane) return;
          const n = e.nativeEvent;
          // M339: Über einer scrollbaren Notiz rollt das Rad auch beim Zeichnen den Text — man will weiter unten markieren
          if (!n.ctrlKey && !n.metaKey && Math.abs(n.deltaY) >= Math.abs(n.deltaX)) {
            const rolle = document.elementsFromPoint(n.clientX, n.clientY).find((el) => el.matches('.card-body.note-card')) as HTMLElement | undefined;
            const max = rolle ? rolle.scrollHeight - rolle.clientHeight : 0;
            if (rolle && max > 4 && ((n.deltaY > 0 && rolle.scrollTop < max - 1) || (n.deltaY < 0 && rolle.scrollTop > 0))) {
              rolle.scrollTop += n.deltaMode === 1 ? n.deltaY * 16 : n.deltaY;
              return;
            }
          }
          pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: n.clientX, clientY: n.clientY, deltaX: n.deltaX, deltaY: n.deltaY, deltaMode: n.deltaMode, ctrlKey: n.ctrlKey, metaKey: n.metaKey, shiftKey: n.shiftKey }));
        }}
      >
        <g transform={`translate(${tx},${ty}) scale(${zoom})`}>
          {/* Eingerastete Formen (Linie, Pfeil, Rechteck, Dreieck: wenige Punkte) bleiben
              scharfkantige Linien — die Freihand-Kontur würde ihre Ecken runden. */}
          {/* M356: Textmarker zuerst und je Farbe als eine Fläche (kein Nachdunkeln), Stift darüber */}
          <MarkerGruppen eintraege={placed.filter((p) => p.s.tool === 'marker')} />
          {placed.filter((p) => p.s.tool !== 'marker').map(({ s, dx, dy, dim }) => (
            <StrichPfad key={s.id} s={s} dx={dx} dy={dy} dim={dim} />
          ))}
          {lauf && (lauf.tool === 'marker'
            ? (
              <path
                key={lauf.id}
                ref={liveRef}
                className="strich-laufend"
                d={liveD(lauf)}
                fill="none"
                stroke={lauf.color}
                strokeWidth={lauf.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={MARKER.opacity}
                style={{ mixBlendMode: 'multiply' }}
              />
            )
            : <path key={lauf.id} ref={liveRef} className="strich strich-laufend" d={liveD(lauf)} fill={lauf.color} stroke="none" opacity={PEN.opacity} />)}
        </g>
      </svg>
      {vorschlag && rfRect && (
        <div
          className={`schrift-vorschlag nodrag ${vorschlagOben ? 'oben' : ''}`}
          style={{ left: Math.max(8, rfRect.left + vorschlag.x * zoom + tx), top: vorschlagOben ? rfRect.top + vorschlag.oben * zoom + ty - 8 : Math.min(window.innerHeight - 60, rfRect.top + vorschlag.y * zoom + ty + 8) }}
          role="status"
        >
          {vorschlag.status === 'erkennt' ? (
            <span className="vorschlag-text erkennt">erkenne …</span>
          ) : (
            <button
              className="vorschlag-text"
              translate="no"
              title={vorschlag.status === 'ki' ? 'Erkannt — die KI prüft noch; Tipp übernimmt sofort' : 'Tipp: Text übernehmen (in die Notiz darunter oder als neue Notiz) — rechts die Textart wechseln'}
              aria-label="Erkannten Text übernehmen"
              onClick={() => void handschriftUebernehmen(vorschlag.zeilen)}
            >
              <b>{vorschlag.status === 'ki' ? '✍️…' : '✍️'}</b>{vorschlag.zeilen.map((z) => artVorsatz(z) + z.text).join('\n')}
            </button>
          )}
          {vorschlag.status !== 'erkennt' && (
            // M327: Textart umschalten — Text, Aufzählung, Nummern, Kästchen, Überschrift
            <span className="vorschlag-arten" role="group" aria-label="Textart">
              {TEXT_ARTEN.map((a) => (
                <button
                  key={a.art}
                  className={`vorschlag-art ${hauptArt(vorschlag.zeilen) === a.art ? 'on' : ''}`}
                  title={`Als ${a.name} übernehmen`}
                  aria-label={`Als ${a.name} übernehmen`}
                  aria-pressed={hauptArt(vorschlag.zeilen) === a.art}
                  onClick={() => setVorschlag((v) => (v ? { ...v, zeilen: artSetzen(v.zeilen, a.art) } : v))}
                >{a.kurz}</button>
              ))}
            </span>
          )}
          <button className="vorschlag-weg" title="Vorschlag ausblenden (Esc)" aria-label="Vorschlag ausblenden" onClick={vorschlagVerwerfen}><IX size={13} /></button>
        </div>
      )}
      {active && (
      <div className="draw-palette">
        {tool === 'eraser' && (
          <>
            {(['teil', 'strich'] as const).map((art) => (
              <button
                key={art}
                className={`draw-radierer-art ${radiererArt === art ? 'on' : ''}`}
                title={art === 'teil' ? 'Teil-Radierer: nimmt nur weg, was der Stift berührt' : 'Strich-Radierer: ein ganzer Strich auf einmal'}
                aria-label={art === 'teil' ? 'Teil-Radierer' : 'Strich-Radierer'}
                onClick={() => radiererWaehlen(art)}
              >
                {art === 'teil' ? 'Teil' : 'Strich'}
              </button>
            ))}
            <span className="draw-trenner" aria-hidden="true" />
          </>
        )}
        {(() => {
          // M354: Stärke für Stift, Textmarker UND Radierer — drei Stufen und stufenlos
          const w: StaerkeWerkzeug = tool === 'eraser' ? 'eraser' : isMarker ? 'marker' : 'pen';
          const def = STAERKEN[w];
          const jetzt = staerken[w];
          const was = w === 'eraser' ? 'Radierergröße' : w === 'marker' ? 'Markerbreite' : 'Strichstärke';
          return (
            <>
              {def.stufen.map((st, i) => (
                <button
                  key={st.name}
                  className={`draw-dicke ${Math.abs(jetzt - st.w) < 0.05 ? 'on' : ''}`}
                  title={`${st.name} (${st.w} Pt.)`}
                  aria-label={`${was} ${st.name.toLowerCase()}`}
                  data-staerke={st.w}
                  onClick={() => staerkeSetzen(w, st.w)}
                >
                  <i className={w === 'eraser' ? 'ring' : w === 'marker' ? 'balken' : ''} style={{ width: 4 + i * 3.5, height: w === 'marker' ? 3 + i * 2.5 : 4 + i * 3.5 }} />
                </button>
              ))}
              <input
                type="range" className="draw-regler nodrag" aria-label={`${was} stufenlos`}
                title={`${was}: ${jetzt} Pt. — stufenlos`}
                min={def.min} max={def.max} step={def.schritt} value={jetzt}
                onChange={(e) => staerkeSetzen(w, Number(e.target.value))}
              />
              <span className="draw-staerke-wert" aria-hidden="true">{jetzt < 10 ? jetzt.toFixed(1).replace('.', ',') : Math.round(jetzt)}</span>
              {/* M369: Der Radierer hat keine Farbe — nach der Größe kommt bei ihm nichts mehr, was abzutrennen wäre */}
              {w !== 'eraser' && <span className="draw-trenner" aria-hidden="true" />}
            </>
          );
        })()}
        {/* M369: Farben nur für Werkzeuge, die malen. Beim Radierer standen sie auch da und taten nichts. */}
        {tool !== 'eraser' && palette.map((c) => (
          <button
            key={c}
            className={`draw-swatch ${color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Farbe ${c}`}
          />
        ))}
        {tool !== 'eraser' && (
          <input
            type="color"
            className="pn-colorpick nodrag"
            title={isMarker ? 'Eigene Markerfarbe' : 'Eigene Stiftfarbe'}
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#3c669c'}
            onChange={(e) => setColor(e.target.value)}
          />
        )}
        {/* M354: Der lange Hinweis steht jetzt im Tooltip — mit Stärke-Regler passte die Leiste sonst nicht mehr in eine Zeile */}
        {tool === 'eraser' ? (
          // M369: kein ✨ und kein „kurz halten = Form" — der Radierer erkennt keine Formen
          <span className="draw-hint" title={radiererArt === 'teil' ? 'Nimmt weg, was der Stift berührt' : 'Nimmt ganze Striche auf einmal weg'}>Radierer</span>
        ) : (
          <span className="draw-hint" title={`${durchgriff ? 'Stift schreibt, Finger bedient, Seitentaste greift · ' : ''}kurz halten = Form`}>
            {tool === 'marker' ? 'Textmarker' : 'Stift'} ✨
          </span>
        )}
        {schriftDa && (
          <button className="draw-text" disabled={erkennt} onClick={() => void handschriftUebernehmen()} title="Geschriebenes in eine Notiz mit Text umwandeln (Striche dieser Sitzung)" aria-label="Handschrift in Text umwandeln">
            <IType size={14} /> {erkennt ? '…' : 'Text'}
          </button>
        )}
        <button className="draw-done" onClick={() => setTool('select')}>Fertig</button>
      </div>
      )}
    </>
  );
}
