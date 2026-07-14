import { selectActiveBoard, useBoard } from '../store';
import { nodesToHtml, nodesToText } from '../lib/serialize';
import { uid } from '../types';

const MAILTO_LIMIT = 1800; // konservativ: längere mailto-URLs schlucken manche Clients

/**
 * Schwebende Aktionsleiste, sobald Karten selektiert sind:
 * teilen, kopieren, duplizieren, löschen. Der kürzeste Weg von der
 * Karte zurück in den Office-Alltag.
 */
export function SelectionToolbar() {
  const board = useBoard(selectActiveBoard);
  const addNode = useBoard((s) => s.addNode);
  const removeNode = useBoard((s) => s.removeNode);
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

  const remove = () => {
    for (const n of selected) removeNode(n.id);
  };

  return (
    <div className="sel-toolbar">
      <span className="sel-count">{selected.length} ausgewählt</span>
      <button onClick={shareByMail} title="Inhalt als E-Mail-Entwurf öffnen">📤 E-Mail</button>
      <button onClick={copyHtml} title="Formatiert kopieren (Outlook/Word-tauglich)">📋 Kopieren</button>
      <button onClick={duplicate} title="Duplizieren">⧉</button>
      <button onClick={remove} title="Löschen" className="danger">🗑️</button>
    </div>
  );
}
