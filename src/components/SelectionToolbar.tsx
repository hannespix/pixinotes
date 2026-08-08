import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeToolbar, Position, useReactFlow } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { nodesToHtml, nodesToText } from '../lib/serialize';
import { aiReady } from '../lib/ai';
import { aiBriefing, aiCommand, aiEdges, aiPolish, aiProcess, aiTasks } from '../lib/aiActions';
import { uid, type AppNode } from '../types';
import { IArchive, IArchiveRestore, IArrange, IBookmark, IComment, ICompact, ICopy, IDuplicate, IFit, IFlowH, IFlowV, IGlobe, IGridLayout, IMail, IMore, IMoveTo, IPen, ITag, ITrash, IWand, IX } from './Icons';
import { ALIGN_LABEL, computeAlign, type AlignOp } from '../lib/align';
import { mutedHistory } from '../store';
import { arrangeFrameInside, FRAME_COLORS } from '../lib/frameOps';
import type { ArrangeMode } from '../lib/arrange';

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
  // M174: Auf Phones schwebt die Leiste NICHT über der Karte (dort kollidierte
  // sie mit Kopf- und Tab-Leiste, User-Screenshot) — sie wird zur festen
  // Aktionsleiste über dem Dock (Standard-Muster mobiler Apps)
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // M168: Die Popover (KI/Attribute/Ausrichten/Verschieben) leben als PORTAL
  // mit fester Bildschirmposition — innerhalb der NodeToolbar deckelt der
  // Stacking-Kontext des Flow-Viewports sie unter Kopf- und Tab-Leiste, bei
  // Karten nahe der Oberkante fingen die Leisten dann die Klicks ab (M151-Muster)
  // M198: 'more' = das ⋯-Menü — bündelt die selteneren Aktionen; 'attr'/'ai'/
  // 'align' öffnen von dort aus als zweite Ebene am selben Anker
  type MenuKind = 'ai' | 'attr' | 'align' | 'move' | 'frame' | 'more';
  const [menu, setMenu] = useState<MenuKind | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0, down: false });
  const toggleMenu = (kind: MenuKind) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (menu === kind) { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    // M174: In der Phone-Bottom-Bar über der GANZEN (ggf. mehrzeiligen) Leiste
    // öffnen — am Einzelknopf verankert überdeckte das Menü die erste Zeile
    const barRect = (e.currentTarget as HTMLElement).closest('.sel-toolbar-dock')?.getBoundingClientRect();
    const top = barRect ? barRect.top : r.top;
    const bottom = barRect ? barRect.bottom : r.bottom;
    // Zu wenig Platz über der Leiste (Kopf-/Tab-Leiste)? Dann nach unten öffnen
    const down = top < 340;
    setMenuPos({
      x: Math.min(Math.max(8, r.right - 210), window.innerWidth - 218),
      y: down ? bottom + 10 : top - 10,
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
  // M198: Esc schließt das offene Menü — wie im Dock (M192) in der Capture-Phase,
  // damit Esc nicht vorher die Auswahl auflöst und die Leiste mitsamt Menü kippt
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMenu(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu]);
  /** Popover-Inhalt als Portal auf oberster Ebene, am Knopf verankert */
  const menuPortal = (extraClass: string, content: React.ReactNode) => createPortal(
    <div
      className={`sel-ai-menu sel-menu-fixed nodrag ${extraClass}`}
      style={menuPos.down
        // nach unten: normal an der Oberkante ankern
        ? { left: menuPos.x, top: menuPos.y }
        // nach oben: über die UNTERKANTE ankern (bottom) — wächst von selbst
        // nach oben und braucht weder transform noch translate (M174)
        : { left: menuPos.x, bottom: window.innerHeight - menuPos.y, top: 'auto' }}
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

  // Karten-Aktionen (KI, Kommentar, Attribute …) gelten nur für echte Karten —
  // Rahmen (M149) laufen getrennt mit: Sie zählen beim VERSCHIEBEN (M180,
  // samt Inhalt) und beim Löschen mit; bei reiner Rahmen-Auswahl zeigt die
  // Leiste eine kompakte Variante statt wie früher gar nicht zu erscheinen.
  const selected = board.nodes.filter((n) => n.selected && n.type !== 'frame');
  const selFrames = board.nodes.filter((n) => n.selected && n.type === 'frame');
  const framesOnly = selected.length === 0;
  // Geankerte Markierungen (M127) der ausgewählten Karten — bei Bedarf lösbar
  const anchoredCount = (board.drawings ?? []).filter(
    (s) => s.anchor && selected.some((n) => n.id === s.anchor),
  ).length;
  if (selected.length === 0 && selFrames.length === 0) return null;

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

  const remove = () => removeNodes([...selected, ...selFrames].map((n) => n.id));

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

  // ---------- Rahmen (M181): alle Rahmen-Aktionen leben HIER statt in einem
  // zweiten Extra-Menü am Rahmenkopf (User-Screenshot „nicht 2 extra") ----------
  const singleFrame = selFrames.length === 1 ? selFrames[0] : null;
  const frameTint = ((singleFrame ?? selFrames[0])?.data?.color as string | undefined) || '';
  const frameArrange = (mode: ArrangeMode) => {
    setMenu(null);
    for (const f of selFrames) arrangeFrameInside(f.id, mode);
  };
  /** Tönung auf ALLE ausgewählten Rahmen anwenden — Menü bleibt zum Probieren offen */
  const tintFrames = (color: string) => {
    for (const f of selFrames) updateNodeData(f.id, { color });
  };
  const renameFrame = () => {
    if (!singleFrame) return;
    setMenu(null);
    const name = window.prompt('Name des Rahmens:', (singleFrame.data as { name?: string }).name ?? 'Bereich');
    if (name?.trim()) updateNodeData(singleFrame.id, { name: name.trim().slice(0, 60) });
  };

  const bar = (
    <>
      <span className="sel-count">{selected.length + selFrames.length} ausgewählt{selFrames.length > 0 ? ` (${selFrames.length} Rahmen)` : ''}</span>
      {selFrames.length > 0 && (
        <span className="sel-ai-wrap">
          {menu === 'frame' && menuPortal('sel-frame-menu', (
            <>
              {singleFrame && (
                <button onClick={renameFrame}><IPen size={14} /> Umbenennen</button>
              )}
              <div className="sel-attr-title">Inhalt anordnen</div>
              <button onClick={() => frameArrange('flow')}><IFlowH size={14} /> Fluss horizontal</button>
              <button onClick={() => frameArrange('flowV')}><IFlowV size={14} /> Fluss vertikal</button>
              <button onClick={() => frameArrange('grid')}><IGridLayout size={14} /> Raster</button>
              <button onClick={() => frameArrange('compact')}><ICompact size={14} /> Kompakt packen</button>
              <div className="sel-attr-title">Tönung</div>
              <div className="sel-frame-tints">
                {FRAME_COLORS.map((c) => (
                  <button
                    key={c || 'none'}
                    className={`tint-dot ${c === '' ? 'none' : ''} ${frameTint === c ? 'on' : ''}`}
                    style={c ? { background: c } : undefined}
                    title={c ? 'Rahmen-Tönung' : 'Keine Tönung'}
                    onClick={() => tintFrames(c)}
                  />
                ))}
                <input
                  type="color"
                  className="pn-colorpick nodrag"
                  title="Eigene Tönung"
                  value={frameTint || '#dbe7f6'}
                  onChange={(e) => tintFrames(e.target.value)}
                />
              </div>
            </>
          ))}
          <button
            className={menu === 'frame' ? 'ai-on' : ''}
            data-smbtn
            onClick={toggleMenu('frame')}
            title="Rahmen: Inhalt anordnen · Tönung · Umbenennen"
          ><IGridLayout size={15} /><span className="sel-label"> Rahmen</span></button>
        </span>
      )}
      {!framesOnly && <button onClick={copyHtml} title="Formatiert kopieren (Outlook/Word-tauglich)"><ICopy size={15} /><span className="sel-label"> Kopieren</span></button>}
      {!framesOnly && <button onClick={duplicate} title="Duplizieren"><IDuplicate size={15} /></button>}
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
        </span>
      )}
      {aiReady(ai) && !framesOnly && (
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
        </span>
      )}
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
                          // M180: Rahmen wandern samt Inhalt mit (Store zieht Mitglieder)
                          moveNodesToBoard([...selected, ...selFrames].map((n) => n.id), b.id);
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
            title="In ein anderes Board verschieben — Rahmen nehmen ihren kompletten Inhalt mit; Verbindungen, Kommentare und geankerte Markierungen wandern ebenfalls"
          ><IMoveTo size={15} /></button>
        </span>
      )}
      {!framesOnly && (
        <span className="sel-ai-wrap">
          {menu === 'more' && menuPortal('sel-more-menu', (() => {
            const allAuto = selected.every((n) => n.autoFit !== false);   // Standard AN (M111)
            const allArchived = selected.every((n) => n.archived);
            return (
              <>
                <button onClick={() => { setMenu(null); shareByMail(); }} title="Inhalt als E-Mail-Entwurf öffnen">
                  <IMail size={14} /> Als E-Mail-Entwurf
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    const first = nodesToText([selected[0]]).split('\n').find((l) => l.trim())?.trim() ?? '';
                    setLookup(first.replace(/^[#\-*\d.\s☐☑]+/, '').slice(0, 80));
                  }}
                  title="Wikipedia fein durchsuchen (mehrere Treffer) + grobe Websuche-Links — Begriff kommt aus der ersten Zeile der Karte"
                >
                  <IGlobe size={14} /> Nachschlagen (Wikipedia &amp; Web)
                </button>
                {single && (
                  <>
                    <div className="sel-attr-title">Karte</div>
                    <button onClick={() => setMenu('attr')} title="Eigenschaften (schlüssel = wert) — über Strg+K durchsuchbar" aria-label="Eigenschaften">
                      <ITag size={14} /> Eigenschaften …{Object.keys(attrs).length > 0 ? ` (${Object.keys(attrs).length})` : ''}
                    </button>
                    <button onClick={() => { setMenu(null); asTemplate(); }} title="Karte als Vorlage speichern (＋-Menü → Vorlagen)">
                      <IBookmark size={14} /> Als Vorlage speichern
                    </button>
                    <button
                      onClick={() => {
                        setMenu(null);
                        // Gibt es schon einen offenen Thread an der Karte, diesen öffnen —
                        // sonst einen neuen Kommentar beginnen (M148)
                        const threads = (useBoard.getState().boards.find((b) => b.id === useBoard.getState().activeId)?.comments ?? [])
                          .filter((c) => c.nodeId === single.id);
                        const open = threads.find((c) => !c.resolved) ?? threads[0];
                        useBoard.getState().setCommentOpen(open ? open.id : `new:${single.id}`);
                      }}
                      title="Kommentar an dieser Karte (für Kollegen im Team-Sync sichtbar)"
                      aria-label="Kommentar"
                    >
                      <IComment size={14} /> Kommentar
                    </button>
                  </>
                )}
                <div className="sel-attr-title">Werkzeuge</div>
                {aiReady(ai) && (
                  <button onClick={() => setMenu('ai')} title="KI-Aktionen auf die Auswahl" aria-label="KI-Aktionen">
                    <IWand size={14} /> KI-Aktionen …
                  </button>
                )}
                {selected.length >= 2 && (
                  <button onClick={() => setMenu('align')} title="Ausrichten & Verteilen (wie in PowerPoint)" aria-label="Ausrichten">
                    <IArrange size={14} /> Ausrichten &amp; Verteilen …
                  </button>
                )}
                <button
                  className={allAuto ? 'on' : ''}
                  onClick={() => setAutoFit(selected.map((n) => n.id), !allAuto)}
                  title={allAuto
                    ? 'Auto-Größe ist AN: Karte wächst mit dem Inhalt — manuelles Ziehen an den Griffen schaltet sie ab'
                    : 'Auto-Größe: Karte wächst automatisch mit dem Inhalt (jederzeit per Ziehen übersteuerbar)'}
                  aria-label="Auto-Größe"
                >
                  <IFit size={14} /> Auto-Größe {allAuto ? 'AUS' : 'AN'}
                </button>
                {anchoredCount > 0 && (
                  <button
                    onClick={() => { setMenu(null); detachStrokes(selected.map((n) => n.id)); }}
                    title={`${anchoredCount} Markierung${anchoredCount > 1 ? 'en' : ''} kleben an dieser Karte und wandern mit — Klick löst sie und lässt sie frei auf dem Board liegen`}
                  >
                    <IPen size={14} /> Markierungen lösen ({anchoredCount})
                  </button>
                )}
                {allArchived ? (
                  <button
                    onClick={() => { setMenu(null); setArchived(selected.map((n) => n.id), false); }}
                    title="Aus dem Archiv zurückholen — die Karte gilt wieder als aktiv"
                    aria-label="Zurückholen"
                  >
                    <IArchiveRestore size={14} /> Aus dem Archiv zurückholen
                  </button>
                ) : (
                  <button
                    onClick={() => { setMenu(null); setArchived(selected.map((n) => n.id), true); }}
                    title="Archivieren — Karte gilt als erledigt, wird ausgeblendet und taucht nicht mehr in Aufgaben/Erinnerungen auf"
                    aria-label="Archivieren"
                  >
                    <IArchive size={14} /> Archivieren (erledigt)
                  </button>
                )}
              </>
            );
          })())}
          <button
            className={menu === 'more' || menu === 'attr' || menu === 'ai' || menu === 'align' || aiBusy ? 'ai-on' : ''}
            data-smbtn
            onClick={toggleMenu('more')}
            title="Mehr: E-Mail · Nachschlagen · Eigenschaften · Vorlage · Kommentar · KI · Ausrichten · Auto-Größe · Archiv"
            aria-label="Mehr"
          ><IMore size={15} /></button>
        </span>
      )}
      <button onClick={remove} title={selFrames.length ? 'Löschen (Rahmen: nur der Rahmen — die Karten darin bleiben liegen)' : 'Löschen'} className="danger"><ITrash size={15} /></button>
    </>
  );

  // Phone: feste Aktionsleiste über dem Dock (Portal — außerhalb des
  // Flow-Stacking-Kontexts, Menüs öffnen von dort automatisch nach oben)
  if (phone) {
    return createPortal(
      <div className="sel-toolbar sel-toolbar-dock nodrag">{bar}</div>,
      document.body,
    );
  }

  // Desktop: schwebt wie gehabt über der Auswahl und wandert beim Pannen mit
  return (
    <NodeToolbar
      nodeId={[...selected, ...selFrames].map((n) => n.id)}
      isVisible
      position={Position.Top}
      offset={14}
      className="sel-toolbar"
    >
      {bar}
    </NodeToolbar>
  );
}
