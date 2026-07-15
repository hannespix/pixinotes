import { useState } from 'react';
import { NodeToolbar, Position, useReactFlow } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { nodesToHtml, nodesToText } from '../lib/serialize';
import { aiReady } from '../lib/ai';
import { aiBriefing, aiCommand, aiEdges, aiProcess, aiTasks } from '../lib/aiActions';
import { uid, type AppNode } from '../types';
import { IBookmark, ICopy, IDuplicate, IMail, ITag, ITrash, IWand, IX } from './Icons';

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
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const saveTemplate = useBoard((s) => s.saveTemplate);
  const { screenToFlowPosition } = useReactFlow();
  const [aiMenu, setAiMenu] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [attrMenu, setAttrMenu] = useState(false);
  const [attrKey, setAttrKey] = useState('');
  const [attrVal, setAttrVal] = useState('');
  const [cmd, setCmd] = useState('');

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

  // ---------- Attribute (Trilium-Stil, nur bei EINER Karte) ----------
  const single = selected.length === 1 ? selected[0] : null;
  const attrs = (single?.data?.attrs as Record<string, string> | undefined) ?? {};

  const addAttr = () => {
    const k = attrKey.trim().slice(0, 30);
    const v = attrVal.trim().slice(0, 60);
    if (!single || !k || !v) return;
    updateNodeData(single.id, { attrs: { ...attrs, [k]: v } });
    setAttrKey('');
    setAttrVal('');
  };

  const removeAttr = (k: string) => {
    if (!single) return;
    const next = { ...attrs };
    delete next[k];
    updateNodeData(single.id, { attrs: Object.keys(next).length ? next : undefined });
  };

  const asTemplate = () => {
    if (!single) return;
    const name = window.prompt('Name der Vorlage:', nodesToText([single]).split('\n')[0]?.slice(0, 30) || 'Vorlage');
    if (name) saveTemplate(single, name);
  };

  return (
    <NodeToolbar
      nodeId={selected.map((n) => n.id)}
      isVisible
      position={Position.Top}
      offset={14}
      className="sel-toolbar"
    >
      <span className="sel-count">{selected.length} ausgewählt</span>
      <button onClick={shareByMail} title="Inhalt als E-Mail-Entwurf öffnen"><IMail size={15} /><span className="sel-label"> E-Mail</span></button>
      <button onClick={copyHtml} title="Formatiert kopieren (Outlook/Word-tauglich)"><ICopy size={15} /><span className="sel-label"> Kopieren</span></button>
      <button onClick={duplicate} title="Duplizieren"><IDuplicate size={15} /></button>
      {single && (
        <span className="sel-ai-wrap">
          {attrMenu && (
            <div className="sel-ai-menu sel-attr-menu nodrag">
              <div className="sel-attr-title">Eigenschaften (schlüssel = wert)</div>
              {Object.entries(attrs).map(([k, v]) => (
                <div key={k} className="sel-attr-row">
                  <b>{k}</b><span>{v}</span>
                  <button title="Eigenschaft entfernen" onClick={() => removeAttr(k)}><IX size={10} /></button>
                </div>
              ))}
              <div className="sel-attr-add">
                <input placeholder="schlüssel" value={attrKey} onChange={(e) => setAttrKey(e.target.value)} />
                <input
                  placeholder="wert" value={attrVal}
                  onChange={(e) => setAttrVal(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addAttr()}
                />
                <button onClick={addAttr} title="Hinzufügen">＋</button>
              </div>
              <div className="sel-attr-hint">z. B. status = wartet · kunde = ACME — über Strg+K durchsuchbar</div>
            </div>
          )}
          <button className={attrMenu ? 'ai-on' : ''} onClick={() => { setAttrMenu((o) => !o); setAiMenu(false); }} title="Eigenschaften (Attribute) der Karte">
            <ITag size={15} />
            {Object.keys(attrs).length > 0 && <span className="sel-attr-count">{Object.keys(attrs).length}</span>}
          </button>
        </span>
      )}
      {single && (
        <button onClick={asTemplate} title="Karte als Vorlage speichern (➕-Menü → Vorlagen)"><IBookmark size={15} /></button>
      )}
      {aiReady(ai) && (
        <span className="sel-ai-wrap">
          {aiMenu && (
            <div className="sel-ai-menu nodrag">
              <input
                className="ai-cmd-input ai-cmd-small"
                placeholder="Anweisung für die Auswahl …"
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cmd.trim()) {
                    const wish = cmd;
                    setCmd('');
                    runAi((n, p) => aiCommand(wish, n, p));
                  }
                }}
              />
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
