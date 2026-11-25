import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { runDerived, useBoard } from '../../store';
import type { NoteNode, ShapeKind, ShapeNode } from '../../types';
import { IPalette } from '../Icons';
import { NotizEditor } from './NoteCard';
import { NotizRuhend } from './NotizRuhend';
import { hakenUmlegen, notizEinfach, type RuheBlock } from '../../lib/notizRuhend';
import { warEbenAngelegt, alsEbenAngelegt } from '../../lib/nodes';
import { formSchrift } from '../../lib/lesbareSchrift';

const SHAPE_COLORS = ['#eef2ff', '#e6f7ec', '#fff4e0', '#ffe9ef', '#eef7ff', '#f3eeff', '#ffffff'];

const NEXT_SHAPE: Record<ShapeKind, ShapeKind> = {
  process: 'decision',
  decision: 'terminator',
  terminator: 'note',
  note: 'process',
};
const SHAPE_LABEL: Record<ShapeKind, string> = {
  process: 'Schritt (Rechteck)',
  decision: 'Entscheidung (Raute)',
  terminator: 'Start/Ende (Stadion)',
  note: 'Notizfeld',
};

/** Klartext (ältere Formen, KI, Import) als Absätze — der Editor beginnt damit */
function textZuBlocks(text: string | undefined): RuheBlock[] {
  const t = (text ?? '').replace(/\s+$/, '');
  if (!t) return [];
  return t.split('\n').map((zeile, i) => ({ id: `t${i}`, type: 'paragraph', props: {}, content: zeile ? [{ type: 'text', text: zeile, styles: {} }] : [], children: [] }) as unknown as RuheBlock);
}

/** Raute: Der Text steht in der Mitte einer Raute — ihre halbe Breite ist nutzbar, dafür braucht sie die doppelte Höhe */
const RAUTE = 2;
const MAX_H = 900;
const MAX_W = 720;

/**
 * Prozess-Form für Flussdiagramme: Rechteck (Schritt), Raute (Entscheidung),
 * Stadion (Start/Ende), Notizfeld. Verbindungspunkte an allen 4 Seiten,
 * Form- und Farbwechsel per Klick, resizbar.
 *
 * M435: Der Text wird bearbeitet wie in einer Notiz — derselbe Editor (fett, Listen, Farben, Größen, „/"-Menü),
 * ruhend als schlichtes HTML. Doppelklick oder ein Klick in die schon gewählte Form weckt ihn, der Cursor landet an
 * der Klickstelle; eine eben aus der Palette gelegte Form ist gleich bereit zum Tippen. Wird der Text länger als die
 * Form, wächst sie mit (die Raute in Höhe und Breite) — und schrumpft wieder bis auf ihre eigene Größe, wenn Text
 * verschwindet. Wer die Form von Hand zieht, setzt damit ihre eigene Größe neu.
 */
export function ShapeCard({ id, data, selected }: NodeProps<ShapeNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);

  const cycleShape = () => updateNodeData(id, { shape: NEXT_SHAPE[data.shape] });
  const cycleColor = () => {
    const i = SHAPE_COLORS.indexOf(data.color);
    updateNodeData(id, { color: SHAPE_COLORS[(i + 1) % SHAPE_COLORS.length] });
  };

  const handles = [Position.Top, Position.Right, Position.Bottom, Position.Left];
  const schrift = useMemo(() => formSchrift(data.color), [data.color]);

  const blocks = useMemo<RuheBlock[]>(
    () => (Array.isArray(data.blocks) && data.blocks.length ? data.blocks as RuheBlock[] : textZuBlocks(data.text)),
    [data.blocks, data.text],
  );
  const leer = !data.text?.trim() && !blocks.length;
  // Was das schlichte HTML nicht pixelgleich zeigen kann (Tabelle, Bild …), zeigt der Editor auch in Ruhe
  const einfach = useMemo(() => leer || notizEinfach(blocks), [leer, blocks]);

  // ---- Bearbeiten: ruhend ↔ Editor ----
  const [aktiv, setAktiv] = useState(() => {
    const frisch = warEbenAngelegt(id);
    if (frisch) alsEbenAngelegt(id);   // der Editor fragt gleich selbst — und setzt dann den Cursor
    return frisch;
  });
  const startPunkt = useRef<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wecken = (x?: number, y?: number) => {
    if (typeof x === 'number' && typeof y === 'number') startPunkt.current = { x, y };
    setAktiv(true);
  };
  const imEditor = (el: Element | null) => !!el && (!!wrapRef.current?.contains(el)
    || !!el.closest('.bn-toolbar, .bn-formatting-toolbar, .bn-suggestion-menu, .mantine-Popover-dropdown, .mantine-Menu-dropdown, .bn-menu-dropdown'));
  // Der Editor schläft wieder ein, sobald die Form abgewählt ist und der Cursor woanders steht — dann zieht man sie
  // wieder an jeder Stelle übers Board
  useEffect(() => {
    if (!aktiv || selected) return;
    const t = window.setTimeout(() => { if (!imEditor(document.activeElement)) setAktiv(false); }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiv, selected]);
  const ruhen = () => window.setTimeout(() => {
    if (!wrapRef.current?.isConnected || imEditor(document.activeElement)) return;
    setAktiv(false);
  }, 200);
  // Klick in die bereits gewählte Form (ohne zu ziehen) weckt den Editor
  const druck = useRef<{ x: number; y: number; gewaehlt: boolean } | null>(null);

  const hakenSetzen = useCallback((pfad: number[], an: boolean) => {
    updateNodeData(id, { blocks: hakenUmlegen(blocks, pfad, an) });
  }, [id, blocks, updateNodeData]);

  // ---- Mitwachsen ----
  const bodyRef = useRef<HTMLDivElement>(null);
  const inhaltRef = useRef<HTMLDivElement>(null);
  const grund = data.grund as { w: number; h: number } | undefined;
  const grundRef = useRef(grund);
  grundRef.current = grund;
  // Während man am Rahmen zieht, hält sich das Mitwachsen heraus — die Hand gewinnt
  const ziehtRef = useRef(false);
  const anpassen = useCallback(() => {
    const body = bodyRef.current; const inhalt = inhaltRef.current;
    if (!body || !inhalt || ziehtRef.current) return;
    const st = useBoard.getState();
    const n = st.boards.find((b) => b.id === st.activeId)?.nodes.find((k) => k.id === id);
    if (!n) return;
    const w = (typeof n.width === 'number' ? n.width : body.offsetWidth) || body.offsetWidth;
    const h = (typeof n.height === 'number' ? n.height : body.offsetHeight) || body.offsetHeight;
    const g = grundRef.current ?? { w, h };
    // Von Hand gesetzte Breite bleibt: dann wächst auch die Raute nur noch in die Höhe
    const breiteFest = !!(g as { manuell?: boolean }).manuell;
    const cs = getComputedStyle(body);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const raute = data.shape === 'decision';
    const textH = inhalt.scrollHeight;
    const braucht = Math.ceil(raute ? textH * RAUTE + 12 : textH + padY + 4);
    let zielH = Math.min(MAX_H, Math.max(g.h, braucht));
    let zielW = w;
    // Die Raute bleibt eine Raute: Wird sie zu hoch für ihre Breite, wächst sie auch in die Breite
    if (raute && !breiteFest && zielH > w * 0.85 && w < MAX_W) zielW = Math.min(MAX_W, Math.max(g.w, Math.round(w * 1.12)));
    if (raute && !breiteFest && zielH <= g.h) zielW = Math.max(g.w, Math.min(w, Math.round(zielH / 0.85)));
    if (raute && zielW < g.w) zielW = g.w;
    zielH = Math.round(zielH);
    if (Math.abs(zielH - h) < 2 && Math.abs(zielW - w) < 2) return;
    runDerived(() => {
      if (!grundRef.current) st.updateNodeData(id, { grund: { w, h } });
      st.resizeNode(id, zielW, zielH);
      // Breiter (oder wieder schmaler) wird die Raute nach beiden Seiten — ihre Mitte bleibt, wo sie war
      if (Math.abs(zielW - w) >= 2) st.setNodePosition(id, n.position.x - (zielW - w) / 2, n.position.y);
    });
  }, [id, data.shape]);
  useLayoutEffect(() => {
    const inhalt = inhaltRef.current;
    if (!inhalt) return;
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(anpassen); });
    ro.observe(inhalt);
    const ed = inhalt.firstElementChild; if (ed) ro.observe(ed);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [anpassen, aktiv, data.shape]);

  return (
    <div className={`shape-wrap shape-${data.shape}`} ref={wrapRef}>
      <NodeResizer isVisible={!!selected} minWidth={90} minHeight={54} color="#4f7cff"
        onResizeStart={() => { ziehtRef.current = true; useBoard.getState().pushHistory(); }}
        // Von Hand gezogen: das ist ihre eigene Größe — der Text wächst von hier aus weiter (nur noch nach unten)
        onResizeEnd={(_, p) => {
          ziehtRef.current = false;
          runDerived(() => useBoard.getState().updateNodeData(id, { grund: { w: Math.round(p.width), h: Math.round(p.height), manuell: true } }));
          requestAnimationFrame(anpassen);
        }}
        handleStyle={{ width: 9, height: 9, borderRadius: 3 }} />
      {handles.map((pos) => (
        <Handle key={pos} type="source" position={pos} id={pos} className="pn-handle shape-handle" />
      ))}
      <Handle id="body" type="source" position={Position.Left} className="pn-handle-body" isConnectableStart={false} />
      <div className="shape-toolbar nodrag">
        <button title={SHAPE_LABEL[data.shape]} onClick={cycleShape}>◇</button>
        <button title="Farbe (Palette)" onClick={cycleColor}><IPalette size={13} /></button>
        <input
          type="color"
          className="pn-colorpick nodrag"
          title="Eigene Füllfarbe"
          // M519: ohne Farbe (alter Stand) oder mit einer Farbe in anderer Schreibweise verlangt das Farbfeld trotzdem #rrggbb — sonst warnt der Browser bei jedem Zeichnen
          value={/^#[0-9a-f]{6}$/i.test(data.color ?? '') ? data.color : '#ffffff'}
          onChange={(e) => updateNodeData(id, { color: e.target.value })}
        />
      </div>
      <div
        ref={bodyRef}
        // M515: Schrift nach der gezeichneten Füllung — auf einer dunklen eigenen Farbe hell, sonst wie bisher
        className={`shape-body${schrift.klasse}`}
        style={{ background: data.color, '--shape-fill': data.color, ...schrift.stil } as CSSProperties}
        onDoubleClick={(e) => { if (!aktiv) { e.stopPropagation(); wecken(e.clientX, e.clientY); } }}
        onPointerDown={(e) => { druck.current = { x: e.clientX, y: e.clientY, gewaehlt: !!selected }; }}
        onClick={(e) => {
          const d = druck.current; druck.current = null;
          if (aktiv || !d?.gewaehlt || e.shiftKey || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
          wecken(e.clientX, e.clientY);
        }}
        onBlurCapture={(e) => { if (aktiv && !imEditor(e.relatedTarget as Element | null)) ruhen(); }}
        onKeyDownCapture={(e) => { if (aktiv && e.key === 'Escape') { (document.activeElement as HTMLElement | null)?.blur(); setAktiv(false); } }}
      >
        <div className={`shape-inhalt ${aktiv || !einfach ? 'nodrag nowheel shape-inhalt-wach' : ''}`} ref={inhaltRef}>
          {aktiv || !einfach ? (
            <NotizEditor id={id} data={{ ...data, blocks } as unknown as NoteNode['data']} startPunkt={startPunkt} />
          ) : leer ? (
            <span className="shape-ph">Doppelklick…</span>
          ) : (
            <div className="note-editor shape-ruhend" translate="no">
              <NotizRuhend blocks={blocks} onHaken={hakenSetzen} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
