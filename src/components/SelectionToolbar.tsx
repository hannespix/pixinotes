import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeToolbar, Position, useReactFlow } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { nodesToHtml, nodesToText } from '../lib/serialize';
import { aiReady } from '../lib/ai';
import { aiBriefing, aiCommand, aiEdges, aiPolish, aiProcess, aiTasks } from '../lib/aiActions';
import { uid, type AppNode } from '../types';
import { IArchive, IArchiveRestore, IArrange, IBookmark, IComment, ICompact, ICopy, IDuplicate, IFit, IFlowH, IFlowV, IGlobe, IGrip, IGridLayout, IMail, IMore, IMoveTo, IPen, ITag, ITrash, IType, IUndo, IWand, IX } from './Icons';
import { useLeisteZiehen } from '../lib/leisteZiehen';
import { wurzelZoom } from '../lib/anzeige';
// M267: Schrift-Stapel, Stufen und Beschriftungen kommen aus lib/typo.ts —
// dieselbe Quelle wie für den markierten Text. Vorher lag hier eine zweite,
// von Hand gepflegte Kopie der Schriftliste.
import { FONT_STACKS, GROESSEN_KARTE, SCHRIFTEN } from '../lib/typo';
import { ALIGN_LABEL, computeAlign, type AlignOp } from '../lib/align';
import { mutedHistory } from '../store';
import { arrangeFrameInside, FRAME_COLORS } from '../lib/frameOps';
import type { ArrangeMode } from '../lib/arrange';

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
  /**
   * M243: Die Leiste lässt sich an ihrem Anfasser wegschieben; wohin, wird
   * gemerkt. Getrennt für Board und Fokus, weil die Leiste dort verschieden
   * sitzt — im Fokus als feste Zeile unten, auf dem Board schwebend an der
   * Karte. Ein gemeinsamer Wert würde die eine Situation zerschießen, sobald
   * man die andere zurechtrückt.
   */
  const imFokus = useBoard((s) => !!s.focusCard);
  const { versatz, anfasser, verschoben, ziehtGerade } = useLeisteZiehen(imFokus ? 'fokus' : 'board', '.sel-toolbar');
  // M168: Die Popover (KI/Attribute/Ausrichten/Verschieben) leben als PORTAL
  // mit fester Bildschirmposition — innerhalb der NodeToolbar deckelt der
  // Stacking-Kontext des Flow-Viewports sie unter Kopf- und Tab-Leiste, bei
  // Karten nahe der Oberkante fingen die Leisten dann die Klicks ab (M151-Muster)
  // M198: 'more' = das ⋯-Menü — bündelt die selteneren Aktionen; 'attr'/'ai'/
  // 'align'/'font' öffnen von dort aus als zweite Ebene am selben Anker
  type MenuKind = 'ai' | 'attr' | 'align' | 'move' | 'frame' | 'more' | 'font';
  const [menu, setMenu] = useState<MenuKind | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0, down: false });
  /**
   * M268: Gemessen wird in Bildschirm-Punkten, geschrieben in Layout-Punkten.
   *
   * Die Menüs liegen als Portal am `body`, und der trägt bei „Anzeige 130 %"
   * den Wurzel-Zoom. Ein `left: 800px` landet dort also bei 1040 Bildpunkten,
   * während `getBoundingClientRect()` schon 1040 GELIEFERT hat. Ohne Teilen
   * rutschte das Menü mit jedem Prozent weiter weg — gemessen bei 130 %:
   * 317 Punkte nach rechts und oben aus dem Bild heraus (Wert −102).
   */
  const inLayout = (v: number) => v / wurzelZoom();
  const toggleMenu = (kind: MenuKind) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (menu === kind) { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    // M174: In der Phone-Bottom-Bar über der GANZEN (ggf. mehrzeiligen) Leiste
    // öffnen — am Einzelknopf verankert überdeckte das Menü die erste Zeile
    const barRect = (e.currentTarget as HTMLElement).closest('.sel-toolbar-dock')?.getBoundingClientRect();
    const top = barRect ? barRect.top : r.top;
    const bottom = barRect ? barRect.bottom : r.bottom;
    // Zu wenig Platz über der Leiste (Kopf-/Tab-Leiste)? Dann nach unten öffnen
    const down = inLayout(top) < 340;
    const breite = inLayout(window.innerWidth);
    setMenuPos({
      x: Math.min(Math.max(8, inLayout(r.right) - 210), breite - 218),
      y: inLayout(down ? bottom + 10 : top - 10),
      down,
    });
    setMenu(kind);
  };
  /**
   * M226: Das ⋯ in der Fokus-Kopfzeile öffnet DIESES Menü.
   *
   * Vorher führte es nur zum Teilen-Dialog — zwei ⋯ mit verschiedenem Inhalt
   * auf einem Schirm, und das obere ausgerechnet ohne die Werkzeuge, die man
   * dort sucht (User-Report). Jetzt meldet die Kopfzeile nur „Menü öffnen";
   * was drinsteht, bleibt an einer Stelle gepflegt.
   */
  useEffect(() => {
    const auf = () => {
      // Am selben Ort verankern wie das ⋯ der Leiste — so öffnet es in beide
      // Richtungen dorthin, wo Platz ist
      const bar = document.querySelector('.sel-toolbar-dock') ?? document.querySelector('.sel-toolbar');
      const r = bar?.getBoundingClientRect();
      const oben = inLayout(r?.top ?? 120);
      const unten = inLayout(r?.bottom ?? 160);
      const down = oben < 340;
      setMenuPos({
        x: Math.max(8, inLayout(window.innerWidth) - 218),
        y: down ? unten + 10 : oben - 10,
        down,
      });
      setMenu((m) => (m === 'more' ? null : 'more'));
    };
    window.addEventListener('pixinotes:karten-menue', auf);
    return () => window.removeEventListener('pixinotes:karten-menue', auf);
  }, []);
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
  /**
   * M226: Nach dem Öffnen ins Bild rücken.
   *
   * Die Ankerrechnung schätzt die Menübreite (218 px); tatsächlich sind es je
   * nach Inhalt und Anzeigegröße mehr. Am rechten Rand ragte das Menü dadurch
   * heraus. Statt die Schätzung nachzujustieren wird hier GEMESSEN und einmal
   * korrigiert — das gilt dann für jeden Öffnungsweg und jede Textgröße.
   */
  const menuRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    // M268: gemessen in Bildpunkten, gesetzt in Layout-Punkten — beides trennen
    const b = el.getBoundingClientRect();
    const platz = inLayout(window.innerWidth) - 8;
    if (inLayout(b.right) > platz) el.style.left = `${Math.max(8, platz - inLayout(b.width))}px`;
    else if (inLayout(b.left) < 8) el.style.left = '8px';
  }, [menu, menuPos]);
  const menuPortal = (extraClass: string, content: React.ReactNode) => createPortal(
    <div
      ref={menuRef}
      className={`sel-ai-menu sel-menu-fixed nodrag ${extraClass}`}
      style={menuPos.down
        // nach unten: normal an der Oberkante ankern
        ? { left: menuPos.x, top: menuPos.y }
        // nach oben: über die UNTERKANTE ankern (bottom) — wächst von selbst
        // nach oben und braucht weder transform noch translate (M174)
        : { left: menuPos.x, bottom: inLayout(window.innerHeight) - menuPos.y, top: 'auto' }}
    >
      {content}
    </div>,
    document.body,
  );
  const moveNodesToBoard = useBoard((s) => s.moveNodesToBoard);
  const setCardTypo = useBoard((s) => s.setCardTypo);
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
    /* M287: Die Frage nennt das Ding beim Namen. Vorher stand dort nur
       „Name des Rahmens“ — wer eben noch ein Board vor sich hatte, hielt das
       für dessen Umbenennung (User-Report). */
    const name = window.prompt(
      'Rahmen auf dem Board umbenennen (die Karten darin bleiben unberührt):',
      (singleFrame.data as { name?: string }).name ?? 'Rahmen',
    );
    if (name?.trim()) updateNodeData(singleFrame.id, { name: name.trim().slice(0, 60) });
  };

  const bar = (
    <>
      <span className={`sel-griff${verschoben ? ' an' : ''}`} {...anfasser}><IGrip size={16} /></span>
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
          {menu === 'font' && menuPortal('sel-font-menu', (() => {
            // M200: gemeinsamer Wert der Auswahl (undefined = uneinheitlich)
            const sameFont = selected.every((n) => (n.font ?? null) === (selected[0]?.font ?? null));
            const sameSize = selected.every((n) => (n.fontSize ?? null) === (selected[0]?.fontSize ?? null));
            const curFont = sameFont ? (selected[0]?.font ?? null) : undefined;
            const curSize = sameSize ? (selected[0]?.fontSize ?? null) : undefined;
            const ids = selected.map((n) => n.id);
            return (
              <>
                {/* M267: Größe zuerst und als LEITER mit Standard in der Mitte —
                    dieselbe Reihenfolge und dieselben Wörter wie im markierten
                    Text (lib/typo.ts). Vorher hieß es hier S/M/L/XL und dort
                    A₋/A₊/A₊₊: zwei Sprachen für dieselbe Frage. */}
                <div className="sel-attr-title">Textgröße</div>
                <div className="sel-font-sizes">
                  {GROESSEN_KARTE.map((s) => (
                    <button
                      key={s.label}
                      className={curSize === s.wert ? 'on' : ''}
                      aria-label={`Textgröße ${s.label}`}
                      onClick={() => setCardTypo(ids, { fontSize: s.wert })}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="sel-attr-title">Schriftart</div>
                {SCHRIFTEN.map((s) => (
                  <button
                    key={s.label}
                    className={curFont === s.wert ? 'on' : ''}
                    style={s.wert ? { fontFamily: FONT_STACKS[s.wert] } : undefined}
                    onClick={() => setCardTypo(ids, { font: s.wert })}
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  className="sel-typo-reset"
                  onClick={() => setCardTypo(ids, { font: null, fontSize: null })}
                  title="Schriftart und Textgröße dieser Karte(n) zurück auf Standard"
                >
                  <IUndo size={13} /> Zurück auf Standard
                </button>
                <div className="sel-attr-hint">Gilt für die ganze Karte — einzelne Wörter formatierst du direkt im Text. „Sehr gut lesbar" ist die für Sehschwäche entworfene Atkinson Hyperlegible</div>
              </>
            );
          })())}
          {menu === 'more' && menuPortal('sel-more-menu', (() => {
            const allAuto = selected.every((n) => n.autoFit !== false);   // Standard AN (M111)
            const allArchived = selected.every((n) => n.archived);
            return (
              <>
                <button
                  onClick={() => { setMenu(null); useBoard.getState().setShareCards([...selected, ...selFrames].map((n) => n.id)); }}
                  title="Teilen & Export: Übernahme-Link, WhatsApp, E-Mail, Drucken, PDF, Kopieren"
                  aria-label="Teilen"
                >
                  <IMail size={14} /> Teilen &amp; Export …
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
                {/* M267: „Schrift & Größe" steht NICHT mehr hier drin — es hat
                    jetzt einen eigenen Knopf direkt in der Leiste. Zwei Wege zu
                    derselben Sache waren genau der Grund für „zu viel
                    unterschiedliche bearbeitungs-orte" (User-Befund). */}
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
                    data-taste="archivieren"
                    title="Archivieren — Karte gilt als erledigt, wird ausgeblendet und taucht nicht mehr in Aufgaben/Erinnerungen auf"
                    aria-label="Archivieren"
                  >
                    <IArchive size={14} /> Archivieren (erledigt)
                  </button>
                )}
              </>
            );
          })())}
          {/* M267: Schrift & Größe als eigener Knopf — ein Klick statt ⋯ →
              Werkzeuge → Schrift & Größe. Textformatierung ist keine seltene
              Sonderaktion und gehört nicht ins Restemenü. */}
          <button
            className={menu === 'font' ? 'ai-on' : ''}
            data-smbtn
            onClick={toggleMenu('font')}
            title="Schrift & Größe der Karte(n) — Klein · Standard · Groß · Riesig, Schriftart, zurück auf Standard"
            aria-label="Schrift & Größe"
          ><IType size={15} /></button>
          <button
            className={menu === 'more' || menu === 'attr' || menu === 'ai' || menu === 'align' || aiBusy ? 'ai-on' : ''}
            data-smbtn
            onClick={toggleMenu('more')}
            title="Mehr: Teilen · Nachschlagen · Eigenschaften · Vorlage · Kommentar · KI · Ausrichten · Auto-Größe · Archiv"
            aria-label="Mehr"
          ><IMore size={15} /></button>
        </span>
      )}
      <button onClick={remove} title={selFrames.length ? 'Löschen (Rahmen: nur der Rahmen — die Karten darin bleiben liegen)' : 'Löschen'} className="danger"><ITrash size={15} /></button>
    </>
  );

  // M243: Der gemerkte Versatz reist als CSS-Variable mit. Bewusst NICHT als
  // `transform`: Den belegt bei der schwebenden Leiste React Flow für die
  // Verankerung an der Karte, und bei der Dock-Leiste die Zentrierung
  // (-50 %). Die eigenständige `translate`-Eigenschaft legt sich sauber davor.
  const versatzStil = {
    '--lv-x': `${versatz.x}px`,
    '--lv-y': `${versatz.y}px`,
  } as React.CSSProperties;

  // Phone: feste Aktionsleiste über dem Dock (Portal — außerhalb des
  // Flow-Stacking-Kontexts, Menüs öffnen von dort automatisch nach oben)
  if (phone) {
    return createPortal(
      <div className={`sel-toolbar sel-toolbar-dock nodrag${ziehtGerade ? ' zieht' : ''}`} style={versatzStil}>{bar}</div>,
      document.body,
    );
  }

  /**
   * Desktop: schwebt über der Auswahl und wandert beim Pannen mit.
   *
   * M268: Zwei Kästen statt einem. Den äußeren positioniert React Flow an der
   * Karte — er muss deshalb in demselben Punkte-Raum liegen wie die Leinwand,
   * die den Anzeige-Zoom herausrechnet. Der innere trägt das Aussehen und holt
   * sich den Faktor zurück, damit die Knöpfe bei 130 % auch wirklich größer
   * sind. Beides an einem Element ginge nicht: Der Zoom würde die Verankerung
   * gleich mitskalieren, und die Leiste stünde neben ihrer Karte.
   */
  return (
    <NodeToolbar
      nodeId={[...selected, ...selFrames].map((n) => n.id)}
      isVisible
      position={Position.Top}
      offset={14}
      className="sel-toolbar-anker"
      // NodeToolbar mischt `style` NACH seinem eigenen `transform` ein — die
      // Variablen landen also gefahrlos auf demselben Element.
      style={versatzStil}
    >
      <div className={`sel-toolbar nodrag${ziehtGerade ? ' zieht' : ''}`}>{bar}</div>
    </NodeToolbar>
  );
}
