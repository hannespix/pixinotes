import { useBoard } from '../store';
import { InlineName } from './InlineName';

/**
 * Projekt-Tabs: jedes Board ist ein Raum. Doppelklick = umbenennen,
 * ✕ = schließen (Inhalte bleiben weg — bewusst simpel in v0.2).
 */
export function Tabs() {
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const view = useBoard((s) => s.view);
  const setView = useBoard((s) => s.setView);
  const openBoard = useBoard((s) => s.openBoard);
  const addBoard = useBoard((s) => s.addBoard);
  const renameBoard = useBoard((s) => s.renameBoard);
  const removeBoard = useBoard((s) => s.removeBoard);
  const showToast = useBoard((s) => s.showToast);

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
        🏠
      </button>
      {boards.map((b) => (
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
            ✕
          </button>
        </div>
      ))}
      <button
        className="tab-add"
        title="Neues Projekt-Board"
        onClick={() => {
          addBoard();
          showToast('Neues Board — Doppelklick auf den Tab zum Umbenennen');
        }}
      >
        +
      </button>
    </div>
  );
}
