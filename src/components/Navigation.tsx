import { useEffect, useMemo, useState } from 'react';
import { useBoard } from '../store';
import { nodeToText } from '../lib/serialize';
import { IChevronR, IPen } from './Icons';
import { InlineName } from './InlineName';
import { BoardMenu, ProjektMenu } from './EbenenMenu';

/**
 * M297: DER Baum der App — Bereich › Projekt › Board › Karte.
 *
 * Bis M296 gab es ihn dreimal: als Navigator-Ausstülpung aus der Brotkrume
 * (M183), als rechte Seitenleiste (M194) und, verkürzt auf das aktive
 * Projekt, als linke Spalte (M238/M263). Jede Fassung hatte eigene Regeln,
 * eigene Suche und eigene Knöpfe. Jetzt gibt es einen Baum und zwei Orte,
 * an denen er hängt: ab Tablet-Breite fest in der linken Spalte (Tabs.tsx),
 * am Telefon als Ausstülpung hinter der Brotkrume.
 *
 * Was zu sehen ist, folgt OneNotes Seitenliste: alle Bereiche und Projekte,
 * die Boards nur des aufgeklappten Projekts (das aktive ist es immer), die
 * Karten nur des aufgeklappten Boards (das aktive ist es immer). Die Suche
 * oben klappt alles auf, was passt.
 */
export function NavTree({ onNavigate }: { onNavigate?: () => void }) {
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const openBoard = useBoard((s) => s.openBoard);
  const setView = useBoard((s) => s.setView);
  const oeffneKarte = useBoard((s) => s.oeffneKarte);
  const renameBoard = useBoard((s) => s.renameBoard);
  const showArchived = useBoard((s) => s.showArchived);
  const herkunft = useBoard((s) => (s.view === 'overview' ? 'overview' as const : 'board' as const));
  const [umbenennen, setUmbenennen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);

  // Das Projekt des aktiven Boards ist immer aufgeklappt, das aktive Board auch
  const aktivesProjekt = useMemo(() => {
    for (const sp of spaces) for (const p of sp.projects) if (p.boardIds.includes(activeId)) return p.id;
    return null;
  }, [spaces, activeId]);
  const [offeneProjekte, setOffeneProjekte] = useState<Set<string>>(() => new Set(aktivesProjekt ? [aktivesProjekt] : []));
  const [offeneBoards, setOffeneBoards] = useState<Set<string>>(() => new Set([activeId]));
  useEffect(() => {
    if (aktivesProjekt) setOffeneProjekte((s) => (s.has(aktivesProjekt) ? s : new Set([...s, aktivesProjekt])));
  }, [aktivesProjekt]);
  useEffect(() => { setOffeneBoards((s) => (s.has(activeId) ? s : new Set([...s, activeId]))); }, [activeId]);

  const toggle = (setter: (f: (s: Set<string>) => Set<string>) => void, id: string) =>
    setter((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const needle = q.trim().toLowerCase();
  const cardLabel = (n: { type?: string }) =>
    (nodeToText(n as Parameters<typeof nodeToText>[0]).split('\n').find((l) => l.trim()) ?? n.type ?? 'Karte')
      .replace(/^[#\-*\d.\s☐☑]+/, '').slice(0, 60);
  const geheZu = (id: string) => { setView('board'); openBoard(id); onNavigate?.(); };

  // Boards ohne Projekt (nach Imports o. Ä.) — unten unter „Ohne Projekt"
  const waisen = useMemo(() => {
    const zugeordnet = new Set(spaces.flatMap((sp) => sp.projects.flatMap((p) => p.boardIds)));
    return boards.filter((b) => !zugeordnet.has(b.id));
  }, [spaces, boards]);

  const passt = (b: (typeof boards)[number]) => !needle
    || b.name.toLowerCase().includes(needle)
    || b.nodes.some((n) => nodeToText(n).toLowerCase().includes(needle));

  const boardZeile = (b: (typeof boards)[number]) => {
    const auf = needle ? true : offeneBoards.has(b.id);
    const karten = (needle ? b.nodes.filter((n) => nodeToText(n).toLowerCase().includes(needle)) : b.nodes)
      .filter((n) => n.type !== 'frame');
    return (
      <div key={b.id}>
        <div className={`side-board ${b.id === activeId ? 'active' : ''}${b.archived ? ' archiviert' : ''}`}>
          <button
            className={`side-board-arrow ${auf ? 'open' : ''}`}
            title={auf ? 'Karten einklappen' : 'Karten zeigen'}
            aria-label={auf ? 'Karten einklappen' : 'Karten zeigen'}
            aria-expanded={auf}
            onClick={() => toggle(setOffeneBoards, b.id)}
          ><IChevronR size={11} /></button>
          {umbenennen === b.id ? (
            <InlineName
              value={b.name}
              className="side-board-name"
              editing
              onEditingChange={(an) => { if (!an) setUmbenennen(null); }}
              onRename={(name) => { renameBoard(b.id, name); setUmbenennen(null); }}
            />
          ) : (
            <button
              className="side-board-name"
              title={b.name}
              onClick={() => geheZu(b.id)}
              onDoubleClick={(e) => { e.preventDefault(); setUmbenennen(b.id); }}
            >{b.name}</button>
          )}
          <button
            className="side-board-pen"
            title="Umbenennen"
            aria-label="Board umbenennen"
            onClick={(e) => { e.stopPropagation(); setUmbenennen(b.id); }}
          ><IPen size={11} /></button>
          <BoardMenu boardId={b.id} onRename={() => setUmbenennen(b.id)} />
          {b.archived && <span className="archiv-marke">Archiv</span>}
          <span className="side-board-count">{b.nodes.length}</span>
        </div>
        {auf && (
          <div className="side-cards">
            {karten.length === 0 && <div className="side-empty">keine Karten</div>}
            {karten.map((n) => (
              <button
                key={n.id}
                className="side-card"
                title="Karte öffnen und bearbeiten"
                onClick={() => { oeffneKarte(b.id, n.id, herkunft); onNavigate?.(); }}
              >{cardLabel(n)}</button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="side-tree nav-tree">
      <input
        className="side-tree-find"
        type="search"
        placeholder="Board oder Karte suchen …"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Navigation durchsuchen"
      />
      {spaces.map((sp) => {
        const projekte = sp.projects
          .map((p) => ({
            p,
            liste: p.boardIds
              .map((id) => byId.get(id))
              .filter((b): b is NonNullable<typeof b> => !!b)
              .filter((b) => showArchived || !b.archived || b.id === activeId)
              .filter(passt),
          }))
          .filter((x) => x.liste.length > 0 || !needle);
        if (needle && projekte.every((x) => x.liste.length === 0)) return null;
        return (
          <section key={sp.id} className="side-space">
            <div className="side-space-name">{sp.name}</div>
            {projekte.map(({ p, liste }) => {
              const auf = needle ? true : offeneProjekte.has(p.id);
              return (
                <div key={p.id} className={`side-proj ${auf ? 'auf' : ''}`}>
                  <div className="side-proj-head">
                    <button
                      className={`side-board-arrow ${auf ? 'open' : ''}`}
                      title={auf ? 'Boards einklappen' : 'Boards zeigen'}
                      aria-label={auf ? 'Boards einklappen' : 'Boards zeigen'}
                      aria-expanded={auf}
                      onClick={() => toggle(setOffeneProjekte, p.id)}
                    ><IChevronR size={11} /></button>
                    <button
                      className="side-proj-name"
                      title={liste.length > 0 ? `${p.name} öffnen` : 'Projekt ist leer'}
                      onClick={() => { if (liste.length > 0) geheZu(liste[0].id); else toggle(setOffeneProjekte, p.id); }}
                    >{p.name}</button>
                    {!auf && <span className="side-board-count">{liste.length}</span>}
                    <ProjektMenu projectId={p.id} />
                  </div>
                  {auf && liste.length === 0 && <div className="side-empty">leer</div>}
                  {auf && liste.map(boardZeile)}
                </div>
              );
            })}
          </section>
        );
      })}
      {waisen.filter(passt).length > 0 && (
        <section className="side-space">
          <div className="side-space-name">Ohne Projekt</div>
          <div className="side-proj auf">{waisen.filter(passt).map(boardZeile)}</div>
        </section>
      )}
    </div>
  );
}
