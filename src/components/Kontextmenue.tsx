// M350: Eigenes Rechtsklick-Menü (siehe lib/kontextmenue.ts).
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { makeNote } from '../lib/nodes';
import { ablageSetzen, kartenMenueWuenschen, kontextAbo, kontextSetzen, kontextZiel, MENUE_HIER, type KontextOrt } from '../lib/kontextmenue';
import { insBild } from './EbenenMenu';
import { taste } from '../lib/tasten';
import { IFit, IGridLayout, IPen, IPlus, ITag, ITrash, INote } from './Icons';

/** Wo das Menü erscheint: am Zeiger — per Tastatur (Kontextmenü-Taste, Umschalt+F10) an der fokussierten Stelle */
function ortVon(e: MouseEvent, el: Element): KontextOrt {
  if (e.clientX !== 0 || e.clientY !== 0) return { x: e.clientX, y: e.clientY };
  const r = el.getBoundingClientRect();
  return { x: r.left + Math.min(r.width / 2, 40), y: r.top + Math.min(r.height / 2, 24) };
}

/**
 * Die Sperre gilt überall in der App: Browser-Menü weg, eigenes Menü auf.
 * Ausnahmen: Textfelder und Text im Bearbeiten (dort hilft das Browser-Menü: Rechtschreibung,
 * Einfügen) und Umschalt+Rechtsklick (der Ausweg, wenn man es doch braucht).
 */
export function useKontextSperre(): void {
  useEffect(() => {
    // Wurde mit gedrückter rechter Taste gezogen (Schwenken, Auswahl), ist das kein Rechtsklick
    let ab: { x: number; y: number } | null = null;
    const runter = (e: PointerEvent) => { if (e.button === 2) ab = { x: e.clientX, y: e.clientY }; };
    const kontext = (e: MouseEvent) => {
      if (e.shiftKey) return;
      const gezogen = !!ab && Math.hypot(e.clientX - ab.x, e.clientY - ab.y) > 6;
      ab = null;
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== 'function') return;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      if (gezogen) return;
      // Langer Finger-Druck (Android): nur das Browser-Menü verhindern — eigene Gesten haben dort Vorrang
      if ((e as PointerEvent).pointerType === 'touch') return;
      const st = useBoard.getState();
      if (st.presenting) return;
      // Netz: hat sein eigenes Menü am Board-Knoten (Overview.tsx)
      if (t.closest('.ov-graph-svg')) return;
      const o = ortVon(e, t);
      // Zeilen im Baum und Kacheln der Übersicht: ihr ⋯-Menü am Zeiger
      const zeile = t.closest('.side-board, .side-proj-head, .side-space-head, .ov-board, .ovc-project-head, .ovc-space-head');
      const knopf = zeile?.querySelector('.ebenen-menu-knopf');
      if (knopf) { knopf.dispatchEvent(new CustomEvent(MENUE_HIER, { detail: o })); return; }
      // Board
      if (st.view !== 'board' || !t.closest('.react-flow') || t.closest('.ov-canvas')) return;
      const knoten = t.closest('.react-flow__node') as HTMLElement | null;
      if (knoten?.dataset.id) {
        const id = knoten.dataset.id;
        const board = selectActiveBoard(st);
        const n = board.nodes.find((k) => k.id === id);
        if (!n) return;
        // Rechtsklick auf eine nicht gewählte Karte wählt genau diese — wie in jedem Programm
        if (!n.selected) st.onNodesChange(board.nodes.map((k) => ({ id: k.id, type: 'select' as const, selected: k.id === id })));
        kontextSetzen(null);
        kartenMenueWuenschen(o);
        return;
      }
      const kante = t.closest('.react-flow__edge, .edge-label') as HTMLElement | null;
      const kid = kante?.dataset.id ?? kante?.closest('[data-edge-id]')?.getAttribute('data-edge-id') ?? undefined;
      if (kante && kid) {
        const board = selectActiveBoard(st);
        st.onEdgesChange(board.edges.map((k) => ({ id: k.id, type: 'select' as const, selected: k.id === kid })));
        kontextSetzen({ art: 'kante', id: kid, ...o });
        return;
      }
      if (t.closest('.react-flow__pane, .react-flow__renderer, .drawing-layer')) {
        kontextSetzen({ art: 'flaeche', ...o });
      }
    };
    window.addEventListener('pointerdown', runter, true);
    window.addEventListener('contextmenu', kontext, true);
    return () => { window.removeEventListener('pointerdown', runter, true); window.removeEventListener('contextmenu', kontext, true); };
  }, []);
}

/** Das Menü für Fläche und Verbindung — lebt im Board, weil es dessen Kamera braucht */
export function BoardKontextmenue() {
  const ziel = useSyncExternalStore(kontextAbo, kontextZiel);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => { if (ziel) insBild(ref.current); }, [ziel]);
  useEffect(() => {
    if (!ziel) return;
    const zu = (e: Event) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); kontextSetzen(null); } return; }
      if (ref.current?.contains(e.target as Node)) return;
      kontextSetzen(null);
    };
    // erster Fokus aufs Menü: Pfeiltasten (M345) gehen dann sofort
    requestAnimationFrame(() => (ref.current?.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus({ preventScroll: true }));
    window.addEventListener('pointerdown', zu, true);
    window.addEventListener('keydown', zu, true);
    window.addEventListener('wheel', zu, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', zu, true);
      window.removeEventListener('keydown', zu, true);
      window.removeEventListener('wheel', zu, true);
    };
  }, [ziel]);
  if (!ziel) return null;
  const st = useBoard.getState();
  const tun = (fn: () => void) => () => { kontextSetzen(null); fn(); };
  const tk = (id: string) => { const k = taste(id); return k ? <kbd className="kontext-taste">{k}</kbd> : null; };

  let inhalt: React.ReactNode;
  if (ziel.art === 'flaeche') {
    const { x, y } = ziel;
    inhalt = (
      <>
        <button role="menuitem" onClick={tun(() => st.addNode(makeNote(screenToFlowPosition({ x: x - 20, y: y - 16 }))))}>
          <INote size={14} /><span>Notiz hier</span>{tk('neueNotiz')}
        </button>
        <button role="menuitem" onClick={tun(() => { ablageSetzen({ x, y }); window.dispatchEvent(new Event('pixinotes:palette')); })}>
          <IPlus size={14} /><span>Modul hier einfügen …</span>
        </button>
        <div className="ebenen-menu-titel">Ansicht</div>
        <button role="menuitem" onClick={tun(() => { void fitView({ padding: 0.15, duration: 400 }); })}>
          <IFit size={14} /><span>Alles einpassen</span>{tk('einpassen')}
        </button>
        <button role="menuitem" onClick={tun(() => {
          const b = selectActiveBoard(useBoard.getState());
          useBoard.getState().onNodesChange(b.nodes.filter((n) => !n.archived || useBoard.getState().showArchived).map((n) => ({ id: n.id, type: 'select' as const, selected: true })));
        })}
        >
          <IGridLayout size={14} /><span>Alles auswählen</span>{tk('alleWaehlen')}
        </button>
        <div className="ebenen-menu-titel">Werkzeuge</div>
        <button role="menuitem" onClick={tun(() => st.setTool('pen'))}>
          <IPen size={14} /><span>Zeichnen</span>{tk('zeichnen')}
        </button>
        <button role="menuitemcheckbox" aria-checked={st.gridSnap} onClick={tun(() => st.setGridSnap(!st.gridSnap))}>
          <IGridLayout size={14} /><span>Raster-Fang {st.gridSnap ? 'aus' : 'an'}</span>{tk('raster')}
        </button>
      </>
    );
  } else {
    const id = ziel.id;
    inhalt = (
      <>
        <button role="menuitem" onClick={tun(() => {
          // die Beschriftung der Verbindung sitzt in LabeledEdge — ein Klick darauf öffnet das Feld
          const el = document.querySelector(`.edge-label[data-edge-id="${id}"] .edge-label-text`) as HTMLElement | null;
          el?.click();
        })}
        >
          <ITag size={14} /><span>Beziehung benennen</span>
        </button>
        <button role="menuitem" className="ebenen-menu-gefahr" onClick={tun(() => st.removeEdge(id))}>
          <ITrash size={14} /><span>Verbindung löschen</span>{tk('loeschen')}
        </button>
      </>
    );
  }
  return createPortal(
    <div
      ref={ref}
      className="ebenen-menu kontext-menue"
      role="menu"
      aria-label={ziel.art === 'flaeche' ? 'Board' : 'Verbindung'}
      style={{ left: ziel.x, top: ziel.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {inhalt}
    </div>,
    document.body,
  );
}
