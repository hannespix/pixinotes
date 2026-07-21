import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { mutedHistory, selectActiveBoard, useBoard } from '../../store';
import type { FrameNode } from '../../types';
import { computeArrangement, frameMembers, sizeOf, type ArrangeMode } from '../../lib/arrange';
import { IArrange, ICompact, IFlowH, IFlowV, IGridLayout, IMoveTo, IPalette, IX } from '../Icons';

/** Pastell-Tönungen für Rahmen — bewusst blass, der Inhalt bleibt der Star */
const FRAME_COLORS = ['', '#dbe7f6', '#dcedde', '#f6ead2', '#f4dde3', '#e6def4'];

/** Innenabstände beim Anordnen im Rahmen */
const PAD = 30;
const HEAD_CLEAR = 46;

/**
 * Frame (M149/M150): benannter Rahmen-Bereich à la Miro. Liegt hinter allen
 * Karten, wird NUR an der Titel-Leiste gezogen und nimmt dabei seine
 * Mitglieder mit (Mittelpunkt-Regel, Logik in Board.tsx). Seit M150 eine
 * echte Struktur-Ebene: eigenes Anordnen-Menü NUR für den Inhalt (der Rahmen
 * wächst bei Bedarf mit), Verbindungspunkte an den Seiten (Rahmen lassen sich
 * wie Module verbinden), und das Board-Aufräumen behandelt Rahmen+Inhalt als
 * EIN Modul.
 */
export function FrameCard({ id, data, selected }: NodeProps<FrameNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const removeNode = useBoard((s) => s.removeNode);
  const showToast = useBoard((s) => s.showToast);
  const moveNodesToBoard = useBoard((s) => s.moveNodesToBoard);
  // M163: Ziel-Boards fürs Verschieben (Rahmen fehlt in der Auswahl-Leiste —
  // er hat seine eigene Titel-Leiste, also wandert die Aktion in SEIN Menü)
  const allBoards = useBoard((s) => s.boards);
  const activeBoardId = useBoard((s) => s.activeId);
  const otherBoards = allBoards.filter((b) => b.id !== activeBoardId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // M151: Das Menü lebt als PORTAL auf oberster Ebene — im Frame-Node säße es
  // hinter den Karten (der Rahmen liegt bewusst auf z-Index −5, User-Screenshot)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menuPos) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.frame-menu') || t?.closest?.(`[data-fmbtn="${id}"]`)) return;
      setMenuPos(null);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [menuPos, id]);

  // Mitglieder-Zähler in der Titel-Leiste — macht das „Einfangen" sichtbar
  const memberCount = useBoard((s) => {
    const b = selectActiveBoard(s);
    const me = b.nodes.find((n) => n.id === id);
    return me ? frameMembers(me, b.nodes).length : 0;
  });

  const tint = (data.color as string) || '';
  const commit = () => {
    updateNodeData(id, { name: draft.trim() || 'Bereich' });
    setEditing(false);
  };
  const cycleColor = () => {
    const i = FRAME_COLORS.indexOf(tint);
    updateNodeData(id, { color: FRAME_COLORS[(i + 1) % FRAME_COLORS.length] });
  };

  /** Nur den INHALT dieses Rahmens anordnen — alles bleibt im Rahmen,
   *  der Rahmen wächst bei Bedarf mit (M150) */
  const arrangeInside = (mode: ArrangeMode) => {
    setMenuPos(null);
    const st = useBoard.getState();
    const board = selectActiveBoard(st);
    const frame = board.nodes.find((n) => n.id === id);
    if (!frame) return;
    const members = frameMembers(frame, board.nodes);
    if (members.length < 2) { showToast('Zu wenig Karten im Rahmen zum Anordnen.'); return; }
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
    showToast('Rahmen-Inhalt angeordnet — Strg+Z stellt die alte Ordnung wieder her.');
  };

  return (
    <div className={`frame-wrap ${selected ? 'selected' : ''}`}>
      {/* M152: Die Standard-Resizer-LINIEN sind eckig und ragen über die
          abgerundeten Rahmen-Ecken hinaus (User-Screenshot „Kanten nicht
          sauber") — unsichtbar schalten (ziehbar bleiben sie), die Auswahl
          zeigt der abgerundete Akzent-Rand des Rahmens selbst; Griffe als
          dezente runde Punkte im Karten-Stil */}
      <NodeResizer
        isVisible={selected}
        minWidth={260}
        minHeight={180}
        lineStyle={{ border: 'none' }}
        handleStyle={{
          width: 11, height: 11, borderRadius: 999,
          background: '#fff', border: '2px solid var(--accent)', boxShadow: '0 1px 3px rgba(50,40,20,.25)',
        }}
      />
      {/* Verbindungspunkte (M150): Rahmen lassen sich wie Module verbinden */}
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map((pos) => (
        <Handle key={pos} type="source" position={pos} id={pos} className="pn-handle frame-handle" />
      ))}
      <div className="frame-head" title="Ziehen verschiebt den Rahmen SAMT Inhalt · Doppelklick benennt um">
        {editing ? (
          <input
            autoFocus
            className="frame-name-input nodrag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <span className="frame-name" onDoubleClick={() => { setDraft(data.name); setEditing(true); }}>
            {data.name}
          </span>
        )}
        {memberCount > 0 && <span className="frame-count" title={`${memberCount} Karte(n) in diesem Rahmen — sie wandern mit dem Rahmen mit`}>{memberCount}</span>}
        {selected && !editing && (
          <span className="frame-tools nodrag">
            <button
              title="Nur den INHALT dieses Rahmens anordnen"
              className={menuPos ? 'on' : ''}
              data-fmbtn={id}
              onClick={(e) => {
                if (menuPos) { setMenuPos(null); return; }
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenuPos({ x: Math.max(8, r.right - 180), y: r.bottom + 8 });
              }}
            >
              <IArrange size={12} />
            </button>
            <button title="Rahmen-Tönung wechseln (Palette)" onClick={cycleColor}><IPalette size={12} /></button>
            <input
              type="color"
              className="pn-colorpick nodrag"
              title="Eigene Tönung"
              value={tint || '#dbe7f6'}
              onChange={(e) => updateNodeData(id, { color: e.target.value })}
            />
            <button
              title="Nur den Rahmen löschen — die Karten darin bleiben"
              onClick={() => removeNode(id)}
            >
              <IX size={12} />
            </button>
          </span>
        )}
      </div>
      <div className="frame-body" style={tint ? { background: `${tint}55` } : undefined} />
      {menuPos && createPortal(
        <div className="frame-menu nodrag" style={{ left: menuPos.x, top: menuPos.y }}>
          <button onClick={() => arrangeInside('flow')}><IFlowH size={14} /> Fluss horizontal</button>
          <button onClick={() => arrangeInside('flowV')}><IFlowV size={14} /> Fluss vertikal</button>
          <button onClick={() => arrangeInside('grid')}><IGridLayout size={14} /> Raster</button>
          <button onClick={() => arrangeInside('compact')}><ICompact size={14} /> Kompakt packen</button>
          {otherBoards.length > 0 && (
            <>
              <div className="frame-menu-label">Samt Inhalt verschieben nach …</div>
              {otherBoards.map((b) => (
                <button key={b.id} onClick={() => { setMenuPos(null); moveNodesToBoard([id], b.id); }}>
                  <IMoveTo size={14} /> {b.name}
                </button>
              ))}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
