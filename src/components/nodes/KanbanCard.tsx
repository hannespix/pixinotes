import { useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import confetti from 'canvas-confetti';
import { useBoard } from '../../store';
import { kanbanCols, uid, type KanbanData, type KanbanItem, type KanbanNode } from '../../types';
import { CardShell } from './CardShell';

/**
 * Der eigentliche Kanban-Inhalt — geteilt zwischen Board-Karte und
 * Präsentations-Folie. Spalten sind frei benennbar und in der Anzahl
 * variabel (➕/✕); die letzte Spalte ist immer „Erledigt" (🎉 + Durchstreichen).
 */
export function KanbanBody({ id, data }: { id: string; data: KanbanData }) {
  const kanban = data;
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const [newText, setNewText] = useState('');

  const cols = kanbanCols(kanban);
  const done = cols.length - 1;

  const setItems = (items: KanbanItem[]) => updateNodeData(id, { items });

  const move = (item: KanbanItem, dir: -1 | 1) => {
    const col = Math.max(0, Math.min(done, item.col + dir));
    if (col === done && item.col !== col) {
      confetti({ particleCount: 60, spread: 55, origin: { y: 0.7 }, scalar: 0.8 });
    }
    setItems(kanban.items.map((it) => (it.id === item.id ? { ...it, col } : it)));
  };

  const remove = (item: KanbanItem) =>
    setItems(kanban.items.filter((it) => it.id !== item.id));

  const addItem = () => {
    const text = newText.trim();
    if (!text) return;
    setItems([...kanban.items, { id: uid(), text, col: 0 }]);
    setNewText('');
  };

  const setTitle = (title: string) => updateNodeData(id, { title });

  const renameCol = (idx: number, name: string) => {
    const next = [...cols];
    next[idx] = name;
    updateNodeData(id, { cols: next });
  };

  const addCol = () => {
    // Neue Spalte vor der Erledigt-Spalte einfügen — „Done" bleibt so immer die letzte
    const next = [...cols];
    next.splice(done, 0, `Spalte ${cols.length}`);
    const items = kanban.items.map((it) => (it.col >= done ? { ...it, col: it.col + 1 } : it));
    updateNodeData(id, { cols: next, items });
  };

  const removeCol = (idx: number) => {
    if (cols.length <= 2) {
      showToast('Mindestens zwei Spalten müssen bleiben.');
      return;
    }
    const next = cols.filter((_, i) => i !== idx);
    // Tickets der gelöschten Spalte rücken eine Spalte nach links
    const items = kanban.items.map((it) => {
      if (it.col === idx) return { ...it, col: Math.max(0, idx - 1) };
      if (it.col > idx) return { ...it, col: it.col - 1 };
      return it;
    });
    updateNodeData(id, { cols: next, items });
  };

  // Defensive: Tickets mit Spaltenindex außerhalb des Bereichs landen in der letzten Spalte
  const colOf = (it: KanbanItem) => Math.max(0, Math.min(done, it.col));

  return (
    <>
      <div className="kanban-head">
        <input
          className="kanban-title nodrag"
          value={kanban.title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="kanban-addcol nodrag" title="Spalte hinzufügen" onClick={addCol}>➕</button>
      </div>
      <div className="kanban-cols">
        {cols.map((colName, colIdx) => (
          <div className="kanban-col" key={colIdx}>
            <div className="kanban-col-head">
              <input
                className="kanban-col-name nodrag"
                value={colName}
                title="Spalte umbenennen"
                onChange={(e) => renameCol(colIdx, e.target.value)}
              />
              {cols.length > 2 && (
                <button
                  className="kanban-col-x nodrag"
                  title="Spalte löschen (Tickets rücken nach links)"
                  onClick={() => removeCol(colIdx)}
                >
                  ✕
                </button>
              )}
            </div>
            {kanban.items
              .filter((it) => colOf(it) === colIdx)
              .map((it) => (
                <div
                  className={`kanban-item nodrag ${colIdx === done ? 'col-done' : colIdx === 0 ? 'col-first' : 'col-mid'}`}
                  key={it.id}
                >
                  <span className={colIdx === done ? 'done-text' : ''}>{it.text}</span>
                  <span className="kanban-item-actions">
                    {colIdx > 0 && (
                      <button onClick={() => move(it, -1)} title="Zurück">‹</button>
                    )}
                    {colIdx < done && (
                      <button onClick={() => move(it, 1)} title="Weiter">›</button>
                    )}
                    <button onClick={() => remove(it)} title="Entfernen">✕</button>
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
      <div className="kanban-add nodrag">
        <input
          placeholder="+ Neues Ticket…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addItem()}
        />
      </div>
    </>
  );
}

/** Kanban-Board als Karte auf dem Whiteboard. */
export function KanbanCard({ id, data, selected }: NodeProps<KanbanNode>) {
  return (
    <CardShell id={id} selected={selected} minWidth={330} minHeight={200} className="kanban-card">
      <KanbanBody id={id} data={data} />
    </CardShell>
  );
}
