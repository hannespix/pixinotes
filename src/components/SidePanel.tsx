import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { nodeToText } from '../lib/serialize';
import { GraphView } from './Overview';
import { IChevronR, IX } from './Icons';

/**
 * M194: Ausfahrbare Seitenleiste — der Überblick steht NEBEN der Arbeit,
 * statt sie zu verdrängen. Zwei Ansichten (Hierarchie · Netz), umschaltbar,
 * und der komplette Zustand (offen, Ansicht, Breite) überlebt den Neustart.
 *
 * Bewusst am RECHTEN Rand: links sitzen Logo, Aktions- und Tab-Leiste; eine
 * linke Leiste hätte das gesamte Kopf-Chrome verschoben.
 */
export function SidePanel() {
  const sb = useBoard((s) => s.sidebar);
  const setSidebar = useBoard((s) => s.setSidebar);

  // Ziehen am linken Rand ändert die Breite (Pointer-Events: Maus + Finger)
  const dragging = useRef(false);
  const onGripDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);
  const onGripMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    setSidebar({ width: Math.round(window.innerWidth - e.clientX) });
  }, [setSidebar]);
  const onGripUp = useCallback(() => { dragging.current = false; }, []);

  if (!sb.open) return null;
  return (
    <aside className="sidepanel" style={{ width: sb.width }} aria-label="Überblick">
      <div
        className="sidepanel-grip"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
        title="Breite ziehen"
      />
      <div className="sidepanel-head">
        <div className="sidepanel-tabs">
          <button
            className={sb.mode === 'hierarchie' ? 'on' : ''}
            onClick={() => setSidebar({ mode: 'hierarchie' })}
          >Hierarchie</button>
          <button
            className={sb.mode === 'netz' ? 'on' : ''}
            onClick={() => setSidebar({ mode: 'netz' })}
            title="Board-Netz: Portale & [[Wikilinks]] als Graph"
          >Netz</button>
        </div>
        <button className="sidepanel-x" title="Seitenleiste schließen" aria-label="Seitenleiste schließen" onClick={() => setSidebar({ open: false })}>
          <IX size={13} />
        </button>
      </div>
      <div className="sidepanel-body">
        {sb.mode === 'netz' ? <GraphView embedded /> : <SideTree />}
      </div>
    </aside>
  );
}

/** Kompakter Baum: Bereich › Projekt › Board — Board aufklappbar bis zur Karte */
function SideTree() {
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const setView = useBoard((s) => s.setView);
  const [open, setOpen] = useState<Set<string>>(() => new Set([activeId]));
  const [q, setQ] = useState('');

  // Das aktive Board immer aufgeklappt zeigen — man will sehen, wo man ist
  useEffect(() => { setOpen((s) => (s.has(activeId) ? s : new Set([...s, activeId]))); }, [activeId]);

  const byId = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);
  const needle = q.trim().toLowerCase();
  const cardLabel = (n: { type?: string }) =>
    (nodeToText(n as Parameters<typeof nodeToText>[0]).split('\n').find((l) => l.trim()) ?? n.type ?? 'Karte').slice(0, 60);

  return (
    <div className="side-tree">
      <input
        className="side-tree-find"
        type="search"
        placeholder="Board oder Karte suchen …"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Im Überblick suchen"
      />
      {spaces.map((sp) => {
        const projects = sp.projects
          .map((p) => ({
            p,
            list: p.boardIds
              .map((id) => byId.get(id))
              .filter((b): b is NonNullable<typeof b> => !!b)
              .filter((b) => !needle
                || b.name.toLowerCase().includes(needle)
                || b.nodes.some((n) => nodeToText(n).toLowerCase().includes(needle))),
          }))
          .filter((x) => x.list.length > 0 || !needle);
        if (needle && projects.every((x) => x.list.length === 0)) return null;
        return (
          <section key={sp.id} className="side-space">
            <div className="side-space-name">{sp.name}</div>
            {projects.map(({ p, list }) => (
              <div key={p.id} className="side-proj">
                <div className="side-proj-name">{p.name}</div>
                {list.length === 0 && <div className="side-empty">leer</div>}
                {list.map((b) => {
                  const isOpen = open.has(b.id);
                  const cards = needle
                    ? b.nodes.filter((n) => nodeToText(n).toLowerCase().includes(needle))
                    : b.nodes;
                  return (
                    <div key={b.id}>
                      <div className={`side-board ${b.id === activeId ? 'active' : ''}`}>
                        <button
                          className={`side-board-arrow ${isOpen ? 'open' : ''}`}
                          title={isOpen ? 'Karten einklappen' : 'Karten zeigen'}
                          aria-label={isOpen ? 'Karten einklappen' : 'Karten zeigen'}
                          onClick={() => setOpen((s) => {
                            const next = new Set(s);
                            if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                            return next;
                          })}
                        ><IChevronR size={11} /></button>
                        <button
                          className="side-board-name"
                          title={`„${b.name}" öffnen`}
                          onClick={() => { setView('board'); openBoard(b.id); }}
                        >{b.name}</button>
                        <span className="side-board-count">{b.nodes.length}</span>
                      </div>
                      {isOpen && (
                        <div className="side-cards">
                          {cards.length === 0 && <div className="side-empty">keine Karten</div>}
                          {cards.map((n) => (
                            <button
                              key={n.id}
                              className="side-card"
                              title="Zur Karte springen"
                              onClick={() => { setView('board'); openBoard(b.id); focusNode(b.id, n.id); }}
                            >{cardLabel(n)}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
      <Foot />
    </div>
  );
}

/** Fußzeile: woran man gerade arbeitet — der Anker im Baum */
function Foot() {
  const board = useBoard(selectActiveBoard);
  return <div className="side-foot">Aktuell: <b>{board.name}</b> · {board.nodes.length} Karten</div>;
}
