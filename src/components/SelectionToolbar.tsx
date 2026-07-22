import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeToolbar, Position, useReactFlow } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { nodesToHtml, nodesToText } from '../lib/serialize';
import { aiReady } from '../lib/ai';
import { aiBriefing, aiCommand, aiEdges, aiPolish, aiProcess, aiTasks } from '../lib/aiActions';
import { uid, type AppNode } from '../types';
import { IArchive, IArchiveRestore, IArrange, IBookmark, IComment, ICopy, IDuplicate, IFit, IGlobe, IMail, IMoveTo, IPen, ITag, ITrash, IWand, IX } from './Icons';
import { ALIGN_LABEL, computeAlign, type AlignOp } from '../lib/align';
import { mutedHistory } from '../store';

const MAILTO_LIMIT = 1800; // konservativ: längere mailto-URLs schlucken manche Clients

/**
 * Aktionsleiste, die direkt über der Selektion schwebt (NodeToolbar):
 * teilen, kopieren, duplizieren, löschen — verdeckt keine anderen Karten
 * und wandert beim Pannen/Zoomen mit. Muss als Kind von <ReactFlow> gerendert werden.
 */
export function SelectionToolbar() {
  const board = useBoard(selectActiveBoard);
  const addNode = useBoard((s) => s.addNode);
  const setArchived = useBoard((s) => s.setArchived);
  const setAutoFit = useBoard((s) => s.setAutoFit);
  const removeNodes = useBoard((s) => s.removeNodes);
  const detachStrokes = useBoard((s) => s.detachStrokes);
  const showToast = useBoard((s) => s.showToast);
  const ai = useBoard((s) => s.ai);
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const saveTemplate = useBoard((s) => s.saveTemplate);
  const { screenToFlowPosition } = useReactFlow();
  const [aiBusy, setAiBusy] = useState(false);
  // M168: Die Popover (KI/Attribute/Ausrichten/Verschieben) leben als PORTAL
  // mit fester Bildschirmposition — innerhalb der NodeToolbar deckelt der
  // Stacking-Kontext des Flow-Viewports sie unter Kopf- und Tab-Leiste, bei
  // Karten nahe der Oberkante fingen die Leisten dann die Klicks ab (M151-Muster)
  type MenuKind = 'ai' | 'attr' | 'align' | 'move';
  const [menu, setMenu] = useState<MenuKind | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0, down: false });
  const toggleMenu = (kind: MenuKind) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (menu === kind) { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    // Zu wenig Platz über der Leiste (Kopf-/Tab-Leiste)? Dann nach unten öffnen
    const down = r.top < 340;
    setMenuPos({
      x: Math.min(Math.max(8, r.right - 210), window.innerWidth - 218),
      y: down ? r.bottom + 10 : r.top - 10,
      down,
    });
    setMenu(kind);
  };
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.sel-menu-fixed') || t?.closest?.('[data-smbtn]')) return;
      setMenu(null);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [menu]);
  /** Popover-Inhalt als Portal auf oberster Ebene, am Knopf verankert */
  const menuPortal = (extraClass: string, content: React.ReactNode) => createPortal(
    <div
      className={`sel-ai-menu sel-menu-fixed nodrag ${extraClass}`}
      style={{
        left: menuPos.x,
        top: menuPos.y,
        // translate statt transform: so kann die Einblende-Animation (M172)
        // transform nutzen, ohne die Verankerung nach oben zu überschreiben
        translate: menuPos.down ? undefined : '0 -100%',
      }}
    >
      {content}
    </div>,
    document.body,
  );
  const moveNodesToBoard = useBoard((s) => s.moveNodesToBoard);
  const setLookup = useBoard((s) => s.setLookup);
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const [attrKey, setAttrKey] = useState('');
  const [attrVal, setAttrVal] = useState('');
  const [cmd, setCmd] = useState('');

  // Rahmen (M149) haben ihre EIGENE Titel-Leiste — die Auswahl-Leiste würde
  // sie nur überdecken, und ihre Aktionen (KI, Archiv, Kommentar …) passen
  // nicht zu einem Hintergrund-Bereich
  const selected = board.nodes.filter((n) => n.selected && n.type !== 'frame');
  // Geankerte Markierungen (M127) der ausgewählten Karten — bei Bedarf lösbar
  const anchoredCount = (board.drawings ?? []).filter(
    (s) => s.anchor && selected.some((n) => n.id === s.anchor),
  ).length;
  if (selected.length === 0) return null;

  /** KI-Aktion nur auf die ausgewählten Karten */
  const runAi = async (fn: (nodes: AppNode[], pos: { x: number; y: number }) => Promise<string>, restoreCmd?: string) => {
    setMenu(null);
    // GLOBALE Sperre teilt sich die Auswahl-Leiste mit dem Dock (Audit R6-K6)
    if (useBoard.getState().aiBusy) { showToast('Eine KI-Aktion läuft bereits — kurz warten.'); return; }
    useBoard.getState().setAiBusy(true);
    setAiBusy(true);
    showToast(`✨ KI analysiert ${selected.length} Karte(n) …`);
    try {
      const pos = screenToFlowPosition({ x: window.innerWidth / 2 + 160, y: window.innerHeight / 2 - 80 });
      showToast(`✨ ${await fn(selected, pos)}`);
    } catch (e) {
      showToast(`KI-Aktion fehlgeschlagen: ${(e as Error).message}`);
      if (restoreCmd) setCmd(restoreCmd);
    } finally {
      setAiBusy(false);
      useBoard.getState().setAiBusy(false);
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
          {menu === 'attr' && menuPortal('sel-attr-menu', (
            <>
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
            </>
          ))}
          <button className={menu === 'attr' ? 'ai-on' : ''} data-smbtn onClick={toggleMenu('attr')} title="Eigenschaften (Attribute) der Karte">
            <ITag size={15} />
            {Object.keys(attrs).length > 0 && <span className="sel-attr-count">{Object.keys(attrs).length}</span>}
          </button>
        </span>
      )}
      {single && (
        <button onClick={asTemplate} title="Karte als Vorlage speichern (＋-Menü → Vorlagen)"><IBookmark size={15} /></button>
      )}
      {single && (
        <button
          onClick={() => {
            // Gibt es schon einen offenen Thread an der Karte, diesen öffnen —
            // sonst einen neuen Kommentar beginnen (M148)
            const threads = (useBoard.getState().boards.find((b) => b.id === useBoard.getState().activeId)?.comments ?? [])
              .filter((c) => c.nodeId === single.id);
            const open = threads.find((c) => !c.resolved) ?? threads[0];
            useBoard.getState().setCommentOpen(open ? open.id : `new:${single.id}`);
          }}
          title="Kommentar an dieser Karte (für Kollegen im Team-Sync sichtbar)"
        >
          <IComment size={15} />
        </button>
      )}
      {aiReady(ai) && (
        <span className="sel-ai-wrap">
          {menu === 'ai' && menuPortal('', (
            <>
              <input
                className="ai-cmd-input ai-cmd-small"
                placeholder="Anweisung für die Auswahl …"
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cmd.trim() && !aiBusy) {
                    const wish = cmd;
                    setCmd('');
                    runAi((n, p) => aiCommand(wish, n, p), wish);
                  }
                }}
              />
              <div className="sel-attr-title">KI-Werkzeuge</div>
              {single?.type === 'note' && (
                <button disabled={aiBusy} onClick={() => runAi((n) => aiPolish(n))} title="Verbesserte Fassung als neue Notiz daneben — das Original bleibt">✨ Text verbessern</button>
              )}
              <button disabled={aiBusy} onClick={() => runAi(aiTasks)}>Aufgaben extrahieren</button>
              <button disabled={aiBusy} onClick={() => runAi(aiProcess)}>Als Workflow-Diagramm</button>
              <button disabled={aiBusy} onClick={() => runAi(aiBriefing)}>Zusammenfassen</button>
              {selected.length >= 2 && (
                <button disabled={aiBusy} onClick={() => runAi((n) => aiEdges(n))}>Verbindungen vorschlagen</button>
              )}
            </>
          ))}
          <button className={menu === 'ai' || aiBusy ? 'ai-on' : ''} data-smbtn onClick={toggleMenu('ai')} title="KI-Aktionen auf die Auswahl">
            <IWand size={15} />
          </button>
        </span>
      )}
      {(() => {
        // Standard AN (M111): nur explizit gebrochene Karten (false) zählen als aus
        const allAuto = selected.every((n) => n.autoFit !== false);
        return (
          <button
            className={allAuto ? 'on' : ''}
            onClick={() => setAutoFit(selected.map((n) => n.id), !allAuto)}
            title={allAuto
              ? 'Auto-Größe ist AN: Karte wächst mit dem Inhalt — manuelles Ziehen an den Griffen schaltet sie ab'
              : 'Auto-Größe: Karte wächst automatisch mit dem Inhalt (jederzeit per Ziehen übersteuerbar)'}
          ><IFit size={15} /></button>
        );
      })()}
      {selected.length >= 2 && (
        <span className="sel-ai-wrap">
          {menu === 'align' && menuPortal('', (
            <>
              {(['left', 'centerX', 'top', 'centerY', 'distH', 'distV', 'width'] as AlignOp[]).map((op) => (
                <button
                  key={op}
                  disabled={(op === 'distH' || op === 'distV') && selected.length < 3}
                  onClick={() => {
                    const { moves, resizes } = computeAlign(selected, op);
                    if (moves.length === 0 && resizes.length === 0) return;
                    const st = useBoard.getState();
                    st.pushHistory();
                    mutedHistory(() => {
                      if (moves.length) st.setNodePositions(moves);
                      for (const [rid, w, h] of resizes) st.resizeNode(rid, w, h);
                    });
                    setMenu(null);
                    showToast(`📏 ${ALIGN_LABEL[op].slice(2).trim()} — Strg+Z macht es rückgängig`);
                  }}
                >
                  {ALIGN_LABEL[op]}
                </button>
              ))}
            </>
          ))}
          <button
            className={menu === 'align' ? 'ai-on' : ''}
            data-smbtn
            onClick={toggleMenu('align')}
            title="Ausrichten & Verteilen (wie in PowerPoint)"
          ><IArrange size={15} /></button>
        </span>
      )}
      {boards.length > 1 && (
        <span className="sel-ai-wrap">
          {menu === 'move' && menuPortal('sel-move-menu', (
            <>
              <div className="sel-move-label">In Board verschieben</div>
              {spaces.map((sp) =>
                sp.projects.map((p) =>
                  p.boardIds
                    .map((bid) => boards.find((b) => b.id === bid))
                    .filter((b): b is typeof boards[number] => !!b && b.id !== board.id)
                    .map((b) => (
                      <button
                        key={b.id}
                        onClick={() => {
                          setMenu(null);
                          moveNodesToBoard(selected.map((n) => n.id), b.id);
                        }}
                        title={`${sp.name} › ${p.name} › ${b.name}`}
                      >
                        {b.name} <span className="sel-move-proj">{p.name}</span>
                      </button>
                    )),
                ),
              )}
            </>
          ))}
          <button
            className={menu === 'move' ? 'ai-on' : ''}
            data-smbtn
            onClick={toggleMenu('move')}
            title="In ein anderes Board verschieben — Verbindungen, Kommentare und geankerte Markierungen wandern mit"
          ><IMoveTo size={15} /></button>
        </span>
      )}
      <button
        onClick={() => {
          const first = nodesToText([selected[0]]).split('\n').find((l) => l.trim())?.trim() ?? '';
          setLookup(first.replace(/^[#\-*\d.\s☐☑]+/, '').slice(0, 80));
        }}
        title="Nachschlagen: Wikipedia fein durchsuchen (mehrere Treffer) + grobe Websuche-Links — Begriff kommt aus der ersten Zeile der Karte und ist im Panel änderbar"
      ><IGlobe size={15} /></button>
      {anchoredCount > 0 && (
        <button
          onClick={() => detachStrokes(selected.map((n) => n.id))}
          title={`${anchoredCount} Markierung${anchoredCount > 1 ? 'en' : ''} kleben an dieser Karte und wandern mit ihr mit — Klick löst sie und lässt sie frei auf dem Board liegen`}
        ><IPen size={15} /><span className="sel-badge">{anchoredCount}</span></button>
      )}
      {selected.every((n) => n.archived) ? (
        <button
          onClick={() => setArchived(selected.map((n) => n.id), false)}
          title="Aus dem Archiv zurückholen — die Karte gilt wieder als aktiv"
        ><IArchiveRestore size={15} /></button>
      ) : (
        <button
          onClick={() => setArchived(selected.map((n) => n.id), true)}
          title="Archivieren — Karte gilt als erledigt, wird ausgeblendet und taucht nicht mehr in Aufgaben/Erinnerungen auf"
        ><IArchive size={15} /></button>
      )}
      <button onClick={remove} title="Löschen" className="danger"><ITrash size={15} /></button>
    </NodeToolbar>
  );
}
