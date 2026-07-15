import { NodeToolbar, Position } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { nodesToHtml, nodesToText } from '../lib/serialize';
import { uid } from '../types';
import { ICopy, IDuplicate, IMail, ITrash } from './Icons';

const MAILTO_LIMIT = 1800; // konservativ: längere mailto-URLs schlucken manche Clients

/**
 * Aktionsleiste, die direkt über der Selektion schwebt (NodeToolbar):
 * teilen, kopieren, duplizieren, löschen — verdeckt keine anderen Karten
 * und wandert beim Pannen/Zoomen mit. Muss als Kind von <ReactFlow> gerendert werden.
 */
export function SelectionToolbar() {
  const board = useBoard(selectActiveBoard);
  const addNode = useBoard((s) => s.addNode);
  const removeNodes = useBoard((s) => s.removeNodes);
  const showToast = useBoard((s) => s.showToast);

  const selected = board.nodes.filter((n) => n.selected);
  if (selected.length === 0) return null;

  const shareByMail = () => {
    let text = nodesToText(selected);
    if (text.length > MAILTO_LIMIT) {
      text = `${text.slice(0, MAILTO_LIMIT)}\n… (gekürzt — vollständigen Inhalt per „HTML kopieren" einfügen)`;
    }
    const subject = encodeURIComponent(`Notizen aus PixiNotes (${selected.length} Karte${selected.length > 1 ? 'n' : ''})`);
    window.open(`mailto:?subject=${subject}&body=${encodeURIComponent(text)}`, '_self');
  };

  const copyHtml = async () => {
    const html = nodesToHtml(selected);
    const text = nodesToText(selected);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      showToast('📋 Als formatiertes HTML kopiert — direkt in Outlook/Word einfügbar');
    } catch {
      await navigator.clipboard.writeText(text);
      showToast('📋 Als Text kopiert');
    }
  };

  const duplicate = () => {
    for (const n of selected) {
      addNode({
        ...n,
        id: uid(),
        selected: false,
        position: { x: n.position.x + 30, y: n.position.y + 30 },
        data: JSON.parse(JSON.stringify(n.data)),
      });
    }
    showToast(`${selected.length} Karte${selected.length > 1 ? 'n' : ''} dupliziert`);
  };

  const remove = () => removeNodes(selected.map((n) => n.id));

  return (
    <NodeToolbar
      nodeId={selected.map((n) => n.id)}
      isVisible
      position={Position.Top}
      offset={14}
      className="sel-toolbar"
    >
      <span className="sel-count">{selected.length} ausgewählt</span>
      <button onClick={shareByMail} title="Inhalt als E-Mail-Entwurf öffnen"><IMail size={15} /> E-Mail</button>
      <button onClick={copyHtml} title="Formatiert kopieren (Outlook/Word-tauglich)"><ICopy size={15} /> Kopieren</button>
      <button onClick={duplicate} title="Duplizieren"><IDuplicate size={15} /></button>
      <button onClick={remove} title="Löschen" className="danger"><ITrash size={15} /></button>
    </NodeToolbar>
  );
}
