import { useReactFlow } from '@xyflow/react';
import { useBoard } from '../store';
import { uid } from '../types';

/** Das Werkzeug-Dock: bewusst nur eine Handvoll Knöpfe. */
export function Dock() {
  const addNode = useBoard((s) => s.addNode);
  const showToast = useBoard((s) => s.showToast);
  const { screenToFlowPosition } = useReactFlow();

  const centerPos = (w = 260, h = 80) =>
    screenToFlowPosition({
      x: window.innerWidth / 2 - w / 2 + (Math.random() * 60 - 30),
      y: window.innerHeight / 2 - h / 2 + (Math.random() * 60 - 30),
    });

  const addNote = () => {
    addNode({ id: uid(), type: 'note', position: centerPos(), data: { color: 'yellow', blocks: [] } });
    showToast('Notiz erstellt — Tipp: Doppelklick aufs Board geht noch schneller!');
  };

  const addKanban = () => {
    addNode({
      id: uid(),
      type: 'kanban',
      position: centerPos(420, 200),
      data: { title: '📋 Neues Board', items: [] },
    });
  };

  const addPortal = () => {
    addNode({ id: uid(), type: 'portal', position: centerPos(200, 140), data: {} });
    showToast('🗂️ Portal-Karte: verlinke damit ein anderes Projekt-Board');
  };

  return (
    <div className="dock">
      <button onClick={addNote} title="Neue Notiz (oder Doppelklick aufs Board)">📝</button>
      <button onClick={addKanban} title="Neues Kanban-Board">📋</button>
      <button onClick={addPortal} title="Portal zu einem anderen Projekt-Board">🗂️</button>
      <button
        onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
        title="Suche über alle Boards (Strg+K)"
      >
        🔍
      </button>
      <button
        onClick={() =>
          showToast('📧 E-Mails (.eml/.msg), Bilder & Dateien einfach aufs Board ziehen · Screenshots mit Strg+V')
        }
        title="Import-Hilfe"
      >
        📥
      </button>
    </div>
  );
}
