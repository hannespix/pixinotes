import { useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import confetti from 'canvas-confetti';
import { useBoard } from '../../store';
import { KANBAN_COLS, uid, type KanbanData, type KanbanItem } from '../../types';
import { CardShell } from './CardShell';

/** Kanban-Board als Karte. Tickets wandern mit ◀ ▶ durch die Spalten; Done = 🎉 */
export function KanbanCard({ id, data, selected }: NodeProps) {
  const kanban = data as unknown as KanbanData;
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const [newText, setNewText] = useState('');

  const setItems = (items: KanbanItem[]) => updateNodeData(id, { items });

  const move = (item: KanbanItem, dir: -1 | 1) => {
    const col = Math.max(0, Math.min(KANBAN_COLS.length - 1, item.col + dir));
    if (col === KANBAN_COLS.length - 1 && item.col !== col) {
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

  return (
    <CardShell id={id} selected={selected} minWidth={330} minHeight={200} className="kanban-card">
      <input
        className="kanban-title nodrag"
        value={kanban.title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="kanban-cols">
        {KANBAN_COLS.map((colName, colIdx) => (
          <div className="kanban-col" key={colName}>
            <h4>{colName}</h4>
            {kanban.items
              .filter((it) => it.col === colIdx)
              .map((it) => (
                <div className={`kanban-item col-${colIdx} nodrag`} key={it.id}>
                  <span className={colIdx === 2 ? 'done-text' : ''}>{it.text}</span>
                  <span className="kanban-item-actions">
                    {colIdx > 0 && (
                      <button onClick={() => move(it, -1)} title="Zurück">‹</button>
                    )}
                    {colIdx < KANBAN_COLS.length - 1 && (
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
    </CardShell>
  );
}
