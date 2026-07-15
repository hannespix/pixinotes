import { useState } from 'react';
import { NodeToolbar, Position, useReactFlow } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { nodesToHtml, nodesToText } from '../lib/serialize';
import { aiReady } from '../lib/ai';
import { aiBriefing, aiEdges, aiProcess, aiTasks } from '../lib/aiActions';
import { uid, type AppNode } from '../types';
import { ICopy, IDuplicate, IMail, ITrash, IWand } from './Icons';

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
  const ai = useBoard((s) => s.ai);
  const { screenToFlowPosition } = useReactFlow();
  const [aiMenu, setAiMenu] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const selected = board.nodes.filter((n) => n.selected);
  if (selected.length === 0) return null;

  /** KI-Aktion nur auf die ausgewählten Karten */
  const runAi = async (fn: (nodes: AppNode[], pos: { x: number; y: number }) => Promise<string>) => {
    setAiMenu(false);
    setAiBusy(true);
    showToast(`✨ KI analysiert ${selected.length} Karte(n) …`);
    try {
      const pos = screenToFlowPosition({ x: window.innerWidth / 2 + 160, y: window.innerHeight / 2 - 80 });
      showToast(`✨ ${await fn(selected, pos)}`);
    } catch (e) {
      showToast(`KI-Aktion fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setAiBusy(false);
    }
  };

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
      {aiReady(ai) && (
        <span className="sel-ai-wrap">
          {aiMenu && (
            <div className="sel-ai-menu nodrag">
              <button disabled={aiBusy} onClick={() => runAi(aiTasks)}>Aufgaben extrahieren</button>
              <button disabled={aiBusy} onClick={() => runAi(aiProcess)}>Als Workflow-Diagramm</button>
              <button disabled={aiBusy} onClick={() => runAi(aiBriefing)}>Zusammenfassen</button>
              {selected.length >= 2 && (
                <button disabled={aiBusy} onClick={() => runAi((n) => aiEdges(n))}>Verbindungen vorschlagen</button>
              )}
            </div>
          )}
          <button className={aiMenu || aiBusy ? 'ai-on' : ''} onClick={() => setAiMenu((o) => !o)} title="KI-Aktionen auf die Auswahl">
            <IWand size={15} />
          </button>
        </span>
      )}
      <button onClick={remove} title="Löschen" className="danger"><ITrash size={15} /></button>
    </NodeToolbar>
  );
}
