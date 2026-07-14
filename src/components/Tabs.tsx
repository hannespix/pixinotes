import { useState } from 'react';
import { useBoard } from '../store';

/**
 * Projekt-Tabs: jedes Board ist ein Raum. Doppelklick = umbenennen,
 * ✕ = schließen (Inhalte bleiben weg — bewusst simpel in v0.2).
 */
export function Tabs() {
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const setActiveBoard = useBoard((s) => s.setActiveBoard);
  const addBoard = useBoard((s) => s.addBoard);
  const renameBoard = useBoard((s) => s.renameBoard);
  const removeBoard = useBoard((s) => s.removeBoard);
  const showToast = useBoard((s) => s.showToast);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const startEdit = (id: string, name: string) => {
    setEditing(id);
    setDraft(name);
  };

  const commitEdit = () => {
    if (editing && draft.trim()) renameBoard(editing, draft.trim());
    setEditing(null);
  };

  const close = (id: string) => {
    if (boards.length <= 1) {
      showToast('Das letzte Board bleibt offen 🙂');
      return;
    }
    removeBoard(id);
  };

  return (
    <div className="tabs">
      {boards.map((b) => (
        <div
          key={b.id}
          className={`tab ${b.id === activeId ? 'active' : ''}`}
          onClick={() => setActiveBoard(b.id)}
          onDoubleClick={() => startEdit(b.id, b.name)}
          title="Klick = wechseln · Doppelklick = umbenennen"
        >
          {editing === b.id ? (
            <input
              autoFocus
              value={draft}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditing(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="tab-name">{b.name}</span>
              <span className="tab-count">{b.nodes.length}</span>
              <button
                className="tab-x"
                title="Board schließen"
                onClick={(e) => {
                  e.stopPropagation();
                  close(b.id);
                }}
              >
                ✕
              </button>
            </>
          )}
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
