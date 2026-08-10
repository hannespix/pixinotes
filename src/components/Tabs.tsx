import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { selectActiveBoard, useBoard } from '../store';
import { boardToShareUrl, downloadBoardFile, SHARE_URL_LIMIT } from '../lib/share';
import { nodeToText } from '../lib/serialize';
import { useRandZiehen } from '../lib/randZiehen';
import { InlineName } from './InlineName';
import { IChevronR, IGraph, IHome, IPlus, IShare, IX } from './Icons';

/** Kurz-Label je Karten-Typ für die Inhalts-Zeilen im Navigator (M183) */
const NAV_TYPE: Record<string, string> = {
  note: 'Notiz', kanban: 'Kanban', gantt: 'Zeitplan', calendar: 'Kalender',
  mermaid: 'Diagramm', shape: 'Form', image: 'Bild', pdf: 'PDF', email: 'E-Mail',
  file: 'Datei', week: 'Planer', time: 'Zeit', htmlapp: 'App', portal: 'Portal',
};

/**
 * Kopfleiste mit dreistufiger Gliederung: Die Tab-Reihe zeigt NUR die Boards
 * des aktiven Projekts (schnelles seitliches Wechseln); davor sitzt die
 * Brotkrume „Bereich › Projekt", die den Navigator-Baum über alle Bereiche,
 * Projekte und Boards aufklappt — so bleibt auch ein großer Bestand geordnet.
 */
export function Tabs() {
  const boards = useBoard((s) => s.boards);
  const spaces = useBoard((s) => s.spaces);
  const activeId = useBoard((s) => s.activeId);
  const view = useBoard((s) => s.view);
  const setView = useBoard((s) => s.setView);
  const setOverviewMode = useBoard((s) => s.setOverviewMode);
  const openBoard = useBoard((s) => s.openBoard);
  const addBoard = useBoard((s) => s.addBoard);
  const renameBoard = useBoard((s) => s.renameBoard);
  const removeBoard = useBoard((s) => s.removeBoard);
  const showToast = useBoard((s) => s.showToast);
  const activeBoard = useBoard(selectActiveBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const [navOpen, setNavOpen] = useState(false);
  // M245: Der Navigator ist eine Ausstülpung am linken Rand — seine Breite
  // wird gezogen und gemerkt, genau wie beim Überblick rechts
  const navBreite = useBoard((s) => s.navBreite);
  const setNavBreite = useBoard((s) => s.setNavBreite);
  const navGriff = useRandZiehen('links', setNavBreite, 380);
  /**
   * M236: Beim Board-Wechsel den aktiven Tab ins Bild holen.
   *
   * Das Kleben (CSS `position: sticky`) sorgt dafür, dass er nie ganz
   * verschwindet — aber wer über den Navigator oder die Suche auf ein Board
   * springt, das weit rechts in der Reihe liegt, soll auch die NACHBARN
   * sehen: Erst dann versteht man, wo man gelandet ist.
   */
  const reiheRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = reiheRef.current?.querySelector('.tab.active') as HTMLElement | null;
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeId, view]);
  // M183: aufgeklappte Boards im Navigator (zeigen ihre Karten)
  const [navExpanded, setNavExpanded] = useState<Set<string>>(new Set());
  // Esc schließt den Navigator (der Backdrop fängt Klicks ohnehin ab)
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const byId = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);

  // Aktiven Kontext (Bereich + Projekt) zum aktiven Board ermitteln
  const context = useMemo(() => {
    for (const sp of spaces) {
      for (const proj of sp.projects) {
        if (proj.boardIds.includes(activeId)) return { space: sp, project: proj };
      }
    }
    const first = spaces[0]?.projects[0];
    return first ? { space: spaces[0], project: first } : null;
  }, [spaces, activeId]);

  // Boards des aktiven Projekts (in Projekt-Reihenfolge) — nur DIE als Tabs
  const projectBoards = useMemo(() => {
    const ids = context?.project.boardIds ?? [];
    const list = ids.map((id) => byId.get(id)).filter((b): b is NonNullable<typeof b> => !!b);
    // Waisen-Board aktiv? Dann wenigstens dieses zeigen.
    if (!list.some((b) => b.id === activeId) && byId.has(activeId)) list.push(byId.get(activeId)!);
    return list;
  }, [context, byId, activeId]);

  // Boards ohne Projekt (nach Imports o. Ä.) — im Navigator unter „Ohne Projekt"
  const orphans = useMemo(() => {
    const assigned = new Set(spaces.flatMap((sp) => sp.projects.flatMap((p) => p.boardIds)));
    return boards.filter((b) => !assigned.has(b.id));
  }, [spaces, boards]);

  /** Aktives Board serverlos teilen: Link in die Zwischenablage (Fallback: Datei) */
  const shareActive = async () => {
    try {
      const url = await boardToShareUrl(activeBoard);
      if (url.length > SHARE_URL_LIMIT) {
        downloadBoardFile(activeBoard);
        showToast('Board ist zu groß für einen Link (Bilder!) — stattdessen als Datei exportiert. Empfänger zieht sie einfach aufs Board.');
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast('Teilen-Link kopiert! Der Link enthält das komplette Board — einfach verschicken, Empfänger öffnet ihn im Browser.');
    } catch {
      downloadBoardFile(activeBoard);
      showToast('Link konnte nicht kopiert werden — Board stattdessen als Datei exportiert.');
    }
  };

  // ---------- M183: Navigator-Helfer ----------
  const toggleExpand = (id: string) =>
    setNavExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const jumpCard = (boardId: string, nodeId: string) => {
    openBoard(boardId);
    focusNode(boardId, nodeId);
    setNavOpen(false);
  };
  const cardLabel = (n: (typeof boards)[number]['nodes'][number]): string => {
    const first = nodeToText(n).split('\n').find((l) => l.trim())?.trim() ?? '';
    return first.replace(/^[#\-*\d.\s☐☑]+/, '').slice(0, 48) || (NAV_TYPE[n.type ?? ''] ?? 'Karte');
  };

  /** Board-Zeile im Navigator — mit ▸ zum Aufklappen der Karten (M183) */
  const navBoard = (b: (typeof boards)[number]) => {
    const cards = b.nodes.filter((n) => n.type !== 'frame');
    const open = navExpanded.has(b.id);
    return (
      <div key={b.id} className="nav-board-wrap">
        <div className="nav-board-row">
          <button
            className={`tab-tree-board ${b.id === activeId && view === 'board' ? 'active' : ''}`}
            onClick={() => { openBoard(b.id); setNavOpen(false); }}
          >
            <span className="tab-tree-board-name">{b.name}</span>
            <span className="tab-count">{b.nodes.length}</span>
          </button>
          {cards.length > 0 && (
            <button
              className={`nav-expand ${open ? 'on' : ''}`}
              title={open ? 'Karten einklappen' : 'Karten dieses Boards zeigen'}
              onClick={() => toggleExpand(b.id)}
            ><IChevronR size={11} /></button>
          )}
        </div>
        {open && (
          <div className="nav-cards">
            {cards.slice(0, 14).map((n) => (
              <button key={n.id} className="nav-card" title="Zur Karte springen" onClick={() => jumpCard(b.id, n.id)}>
                <span className="nav-card-type">{NAV_TYPE[n.type ?? ''] ?? n.type}</span>
                <span className="nav-card-name">{cardLabel(n)}</span>
              </button>
            ))}
            {cards.length > 14 && <div className="nav-more">… und {cards.length - 14} weitere — Board öffnen</div>}
          </div>
        )}
      </div>
    );
  };

  const close = (id: string) => {
    if (boards.length <= 1) {
      showToast('Das letzte Board bleibt offen 🙂');
      return;
    }
    const board = boards.find((b) => b.id === id);
    if (board && board.nodes.length > 0) {
      if (!window.confirm(`Board „${board.name}" mit ${board.nodes.length} Karten wirklich löschen?`)) return;
    }
    removeBoard(id);
  };

  return (
    <div className="tabs">
      <button
        className={`tab-home ${view === 'overview' ? 'active' : ''}`}
        title="Übersicht: alle Bereiche, Projekte & Boards"
        onClick={() => setView('overview')}
      >
        <IHome size={15} />
      </button>
      {/* Brotkrume „Bereich › Projekt" öffnet den Navigator über ALLE Ebenen.
          M183: Der Navigator ist ein ZENTRIERTES Glas-Overlay als Body-Portal —
          in der Tab-Leiste (selbst eine Glas-Fläche) blurte sein backdrop-filter
          per CSS-Spezifikation nichts mehr (Backdrop-Root), User-Screenshot. */}
      <button
        className={`tab-nav ${navOpen ? 'active' : ''}`}
        title="Navigator: alle Bereiche, Projekte, Boards & Karten"
        onClick={() => setNavOpen((o) => !o)}
      >
        <span className="tab-nav-space">{context?.space.name ?? '—'}</span>
        <IChevronR size={11} />
        <span className="tab-nav-proj">{context?.project.name ?? '—'}</span>
      </button>
      {navOpen && createPortal(
        <div className="nav-backdrop" onClick={() => setNavOpen(false)}>
          {/* M245: Kein freischwebendes Fenster mehr, sondern eine Ausstülpung
              am linken Rand — angedockt, in der Breite ziehbar, deckend. */}
          <div className="nav-panel slideout nodrag" style={{ width: navBreite }} role="dialog" aria-label="Navigator" onClick={(e) => e.stopPropagation()}>
            <div className="nav-grip" {...navGriff}><span /></div>
            <div className="nav-head">
              <b>Alle Bereiche, Projekte & Boards</b>
              <button
                className="nav-overview"
                title="Große Übersicht öffnen (alle Bereiche als Fläche)"
                onClick={() => { setOverviewMode('hierarchie'); setView('overview'); setNavOpen(false); }}
              ><IHome size={13} /> Große Übersicht</button>
              {/* M193: Das Netz war bisher nur über die Übersicht erreichbar —
                  jetzt aus JEDER Ansicht mit einem Tipp */}
              <button
                className="nav-netz"
                title="Netz-Ansicht: Boards als Graph, verbunden über Portale und [[Wikilinks]]"
                onClick={() => { setOverviewMode('netz'); setView('overview'); setNavOpen(false); }}
              ><IGraph size={13} /> Netz</button>
              <button className="nav-x" title="Schließen (Esc)" onClick={() => setNavOpen(false)}><IX size={13} /></button>
            </div>
            <div className="nav-grid">
              {spaces.map((sp) => (
                <section key={sp.id} className="nav-space">
                  <button
                    className="nav-space-name"
                    title={`Bereich „${sp.name}" in der großen Übersicht öffnen`}
                    onClick={() => { setView('overview'); setNavOpen(false); }}
                  >{sp.name}</button>
                  {sp.projects.map((proj) => (
                    <div key={proj.id} className="nav-proj">
                      <button
                        className="nav-proj-name"
                        title={proj.boardIds.length > 0 ? `Projekt „${proj.name}" öffnen (erstes Board)` : 'Projekt ist leer'}
                        onClick={() => {
                          const first = proj.boardIds.find((id) => byId.has(id));
                          if (first) { openBoard(first); setNavOpen(false); }
                        }}
                      >{proj.name}</button>
                      {proj.boardIds.map((id) => {
                        const b = byId.get(id);
                        return b ? navBoard(b) : null;
                      })}
                      {proj.boardIds.length === 0 && <div className="tab-tree-empty">leer</div>}
                    </div>
                  ))}
                </section>
              ))}
              {orphans.length > 0 && (
                <section className="nav-space">
                  <div className="nav-space-name nav-space-static">Ohne Projekt</div>
                  <div className="nav-proj">{orphans.map((b) => navBoard(b))}</div>
                </section>
              )}
            </div>
            <div className="tab-tree-foot">Bereiche öffnen die große Übersicht · Projekte ihr erstes Board · ▸ zeigt die Karten eines Boards (Klick springt hin)</div>
          </div>
        </div>,
        document.body,
      )}
      {/* Nur die Board-Tabs des AKTIVEN Projekts — scrollen bei Bedarf */}
      <div className="tabs-scroll" ref={reiheRef}>
        {projectBoards.map((b) => (
          <div
            key={b.id}
            className={`tab ${b.id === activeId && view === 'board' ? 'active' : ''}`}
            onClick={() => openBoard(b.id)}
            title="Klick = wechseln · Doppelklick auf den Namen = umbenennen"
          >
            <InlineName value={b.name} className="tab-name" onRename={(name) => renameBoard(b.id, name)} />
            <span className="tab-count">{b.nodes.length}</span>
            <button
              className="tab-x"
              title="Board schließen"
              aria-label={`Board ${b.name} schließen`}
              onClick={(e) => {
                e.stopPropagation();
                close(b.id);
              }}
            >
              <IX size={11} />
            </button>
          </div>
        ))}
      </div>
      {/* M238: Teilen und ＋ als eigene Gruppe. In der Reihe ändert das nichts
          (eine Flex-Zeile in einer Flex-Zeile), in der linken Spalte stehen sie
          dadurch nebeneinander am Fuß statt untereinander in der Mitte. */}
      <div className="tabs-foot">
      <button
        className="tab-share"
        title="Aktives Board teilen: Link mit komplettem Inhalt kopieren (serverlos)"
        aria-label="Board teilen"
        onClick={shareActive}
      >
        <IShare size={13} />
      </button>
      <button
        className="tab-add"
        title={`Neues Board in „${context?.project.name ?? 'Allgemein'}"`}
        onClick={() => {
          addBoard(undefined, context?.project.id);
          showToast(`Neues Board in „${context?.project.name ?? 'Allgemein'}" — Doppelklick auf den Tab zum Umbenennen`);
        }}
      >
        <IPlus size={14} />
      </button>
      </div>
    </div>
  );
}
