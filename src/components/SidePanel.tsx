import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { nodeToText } from '../lib/serialize';
import { useFahne } from '../lib/fahne';
import { wurzelZoom } from '../lib/anzeige';
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
  /* M286: In der Übersicht tritt der Navigator zurück — sie hat ihren eigenen
     Umschalter und ist selbst schon Überblick (siehe Leiste). */
  const imUeberblick = useBoard((s) => s.view === 'overview');
  const zone = useRef<HTMLDivElement>(null);

  // M250: Das Fähnchen ersetzt den unsichtbaren Kanten-Anfasser aus M245 —
  // es zieht die Breite UND fährt die Leiste per Klick aus und ein
  const setzeBreite = useCallback((px: number) => setSidebar({ width: Math.round(px) }), [setSidebar]);
  const setzeOffen = useCallback((offen: boolean) => setSidebar({ open: offen }), [setSidebar]);
  const fahne = useFahne({ offen: sb.open, breite: sb.width, setzeBreite, setzeOffen });
  const hoehe = useHoeheZiehen(zone, setSidebar);

  /**
   * M248: Wie breit die Leiste gerade ist, muss das Stylesheet wissen.
   *
   * Sie belegt die rechte Seite und käme dem mittig sitzenden Dock ins
   * Gehege. Statt das Dock kleiner zu machen, rückt es zur Seite — es soll
   * in der Mitte des FREIEN Raums stehen, nicht in der Mitte des Fensters.
   * Der Wert wandert deshalb als Variable an die Wurzel; das Dock rechnet
   * damit (`translateX(calc(-50% - var(--seite-rechts) / 2))`).
   */
  useEffect(() => {
    const wurzel = document.documentElement;
    const breit = window.matchMedia('(min-width: 641px)').matches;
    wurzel.style.setProperty('--seite-rechts', sb.open && breit ? `${sb.width}px` : '0px');
    return () => wurzel.style.setProperty('--seite-rechts', '0px');
  }, [sb.open, sb.width]);

  /**
   * M250: Die Leiste sitzt jetzt vertikal mittig in einer unsichtbaren Zone
   * (Kopfleiste bis Fensterunterkante). Das Zentrieren übernimmt der Flexbox-
   * Container statt einer vh-Rechnung — `vh` ignoriert den Wurzel-Zoom und
   * hätte bei 125 % daneben gelegen (M235).
   *
   * Die Zone selbst ist für Zeiger durchlässig, sonst läge ein unsichtbarer
   * Streifen über dem Board.
   */
  return (
    /* M286: Am Telefon deckte der Navigator die ganze Übersicht zu — man sah
       das Netz nicht mehr, das man aufgerufen hatte. Dort IST die Übersicht
       schon der Navigator; die Leiste erscheint deshalb erst ab Tablet-Breite
       (Regel im Stylesheet). */
    <div className={`sidepanel-zone${imUeberblick ? ' nur-breit' : ''}`} ref={zone}>
      <button
        className={`sidepanel-fahne${sb.open ? ' auf' : ''}`}
        title={sb.open ? 'Überblick einfahren — oder ziehen für die Breite' : 'Überblick ausfahren — oder ziehen für die Breite'}
        aria-label="Überblick ein- oder ausfahren"
        aria-expanded={sb.open}
        {...fahne}
      ><span /></button>
      {sb.open && <Leiste sb={sb} setSidebar={setSidebar} hoehe={hoehe} imUeberblick={imUeberblick} />}
    </div>
  );
}

/**
 * M250: Höhe stufenlos ziehen.
 *
 * Weil die Leiste mittig sitzt, wächst sie nach oben und unten gleichzeitig.
 * Die Rechnung `2 × (Zeiger − Mitte)` sorgt dafür, dass die Unterkante trotzdem
 * exakt am Finger klebt — sonst liefe der Anfasser dem Zeiger davon.
 */
function useHoeheZiehen(
  zone: React.RefObject<HTMLDivElement | null>,
  setSidebar: (patch: { height: number }) => void,
) {
  const zug = useRef<{ mitte: number; platz: number } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      const r = zone.current?.getBoundingClientRect();
      if (!r) return;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      zug.current = { mitte: r.top + r.height / 2, platz: r.height };
      e.preventDefault();
      e.stopPropagation();
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const z = zug.current;
      if (!z) return;
      const zoom = wurzelZoom();
      const roh = (2 * (e.clientY - z.mitte)) / zoom;
      setSidebar({ height: Math.min(z.platz / zoom, Math.max(200, roh)) });
    },
    onPointerUp: (e: ReactPointerEvent) => {
      zug.current = null;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    },
    onPointerCancel: () => { zug.current = null; },
    // Zurück auf Standardmaß — beide Achsen, denn wer hier doppelklickt,
    // will die Leiste aufräumen und nicht nur eine Kante zurücksetzen
    onDoubleClick: () => setSidebar({ height: 0, width: 330 } as { height: number }),
  };
}

function Leiste({ sb, setSidebar, hoehe, imUeberblick }: {
  sb: { open: boolean; mode: 'hierarchie' | 'netz'; width: number; height?: number };
  setSidebar: (patch: Partial<{ open: boolean; mode: 'hierarchie' | 'netz'; width: number; height: number }>) => void;
  hoehe: Record<string, unknown>;
  imUeberblick: boolean;
}) {
  return (
    <aside
      className="sidepanel slideout"
      style={{ width: sb.width, height: sb.height ? `${sb.height}px` : undefined }}
      aria-label="Überblick"
    >
      <div className="sidepanel-head">
        {/**
         * M286: In der ÜBERSICHT gibt es diese Wahl schon — dort steht der
         * Umschalter „Hierarchie | Netz" als Hauptbedienung. Beide zugleich
         * anzuzeigen brachte zwei gleich aussehende Schalter mit
         * WIDERSPRÜCHLICHEM Zustand nebeneinander (Bildschirmfoto: links Netz
         * aktiv, rechts Hierarchie). Hier bleibt deshalb nur der Baum — das
         * ist ohnehin das, was die Übersicht selbst nicht kann: bis zur
         * einzelnen Karte hinunter.
         */}
        {imUeberblick ? (
          <div className="sidepanel-titel">Boards &amp; Karten</div>
        ) : (
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
        )}
        <button className="sidepanel-x" title="Seitenleiste schließen" aria-label="Seitenleiste schließen" onClick={() => setSidebar({ open: false })}>
          <IX size={13} />
        </button>
      </div>
      <div className="sidepanel-body">
        {!imUeberblick && sb.mode === 'netz' ? <GraphView embedded /> : <SideTree />}
      </div>
      {/* Unterkante als Höhen-Anfasser — sichtbarer Strich, sonst bliebe die
          Funktion geheim (dieselbe Überlegung wie beim Fähnchen) */}
      <div className="sidepanel-hoehe" title="Höhe ziehen · Doppelklick: Standardmaß" {...hoehe}><span /></div>
    </aside>
  );
}

/** Kompakter Baum: Bereich › Projekt › Board — Board aufklappbar bis zur Karte */
function SideTree() {
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const openBoard = useBoard((s) => s.openBoard);
  const setView = useBoard((s) => s.setView);
  const oeffneKarte = useBoard((s) => s.oeffneKarte);
  /* M285: Der Navigator steht jetzt auch in der Übersicht — von dort geöffnete
     Karten sollen nach dem Schließen wieder die Übersicht zeigen. */
  const herkunft = useBoard((s) => (s.view === 'overview' ? 'overview' as const : 'board' as const));
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
                              /* M285: Derselbe Weg wie überall — die Karte
                                 öffnet sich im Karten-Blatt und kehrt beim
                                 Schließen dorthin zurück, wo man war. */
                              title="Karte öffnen und bearbeiten"
                              onClick={() => oeffneKarte(b.id, n.id, herkunft)}
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
