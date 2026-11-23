import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeToolbar, Position, useReactFlow, useStore } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { nodesToText } from '../lib/serialize';
import { aiReady, kiAbbruchZuruecksetzen } from '../lib/ai';
import { textDateienAlsNotizen, textKarte } from '../lib/textNotiz';
import { kontakteHerunterladen } from '../lib/kontaktExport';
import { aiBriefing, aiEdges, aiPolish, aiPraesentation, aiPraesentationUeberarbeiten, aiProcess, aiTasks } from '../lib/aiActions';
/** M410: Die Freitext-Anweisung wird erst geladen, wenn sie gebraucht wird (lib/kiAnweisung.ts) */
const aiCommand: typeof import('../lib/kiAnweisung').aiCommand = (...a) => import('../lib/kiAnweisung').then((m) => m.aiCommand(...a));
import { kiBeispiel, kiBlaettern } from '../lib/kiVerlauf';
import { KACHEL_TYPEN, STICKY_COLORS, type AppNode } from '../types';
import { FARB_NAMEN } from '../lib/notiz';
import { IArchive, IArchiveRestore, IArrange, IBookmark, IDownload, IComment, ICompact, ICrop, IDuplicate, IFit, IFrame, IFlowH, IFlowV, IGlobe, IGridLayout, IImage, IMore, IMoveTo, IPalette, IPen, IShare, ITag, ITrash, IType, IUndo, IWand, IX, IMaximize } from './Icons';
import { wurzelZoom } from '../lib/anzeige';
// M267: Schrift-Stapel, Stufen und Beschriftungen kommen aus lib/typo.ts —
// dieselbe Quelle wie für den markierten Text. Vorher lag hier eine zweite,
// von Hand gepflegte Kopie der Schriftliste.
import { FONT_STACKS, GROESSEN_KARTE, SCHRIFTEN } from '../lib/typo';
import { ALIGN_LABEL, ALIGN_MIN, computeAlign, type AlignOp } from '../lib/align';
import { sizeOf } from '../lib/arrange';
import { istDrehbar, winkelVon } from '../lib/drehung';
import {
  IKanteLinks, IKanteMitteX, IKanteRechts, IKanteOben, IKanteMitteY, IKanteUnten, IVerteilenX, IVerteilenY, IAlsZeile, IAlsSpalte,
  IGleichBreit, IGleichHoch, IGleichGross, IGroesser, IKleiner, IRaster, IPacken, IOrdnen, ISchraeg,
} from './Icons';
import { vorschauArt } from '../lib/fileStore';
import { bildBearbeitbar, bildBearbeiten } from './BildEditorHost';
import { mutedHistory } from '../store';
import { arrangeFrameInside, FRAME_COLORS } from '../lib/frameOps';
import type { ArrangeMode } from '../lib/arrange';
import { KARTEN_EREIGNIS, kartenWunschNehmen } from '../lib/kontextmenue';

/**
 * Aktionsleiste, die direkt über der Selektion schwebt (NodeToolbar):
 * teilen, kopieren, duplizieren, löschen — verdeckt keine anderen Karten
 * und wandert beim Pannen/Zoomen mit. Muss als Kind von <ReactFlow> gerendert werden.
 */
export function SelectionToolbar() {
  const board = useBoard(selectActiveBoard);
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
  const imFokus = useBoard((s) => !!s.focusCard);
  /**
   * M292: Wo die Leiste steht, ist keine Geschmacksfrage mehr.
   *
   * Vorher (M243) ließ sie sich frei wegschieben, und der Versatz wurde
   * gemerkt — gedacht als Ausweg, weil „über der Auswahl" mal den Inhalt
   * verdeckte und mal am Bildrand keinen Platz hatte. In der Praxis stand sie
   * dadurch überall woanders (User-Bildschirmfoto: mitten auf der Karte).
   *
   * Statt Freiheit gibt es jetzt eine Regel, die man nach einmal Sehen kennt:
   *   1. ÜBER der Karte — die Standardstelle, dort verdeckt sie nichts.
   *   2. Passt oben nichts mehr hin (Karte klebt unter der Kopfleiste),
   *      geht sie UNTER die Karte.
   *   3. Passt auch das nicht (Karte größer als der Schirm, Telefon), wird
   *      sie zur festen Zeile am unteren Bildrand — dieselbe, die der Fokus
   *      und das Telefon ohnehin benutzen.
   *
   * Gemessen wird in Bildpunkten am echten Layout: Kopfleisten oben, Dock,
   * Blätter- und Formatier-Leiste unten. Damit gilt dieselbe Regel auf jedem
   * Schirm — sie fällt nur je nach Platz anders aus.
   */
  const leisteRef = useRef<HTMLDivElement | null>(null);
  // Beim Pannen und Zoomen ändert sich der Platz — die Regel rechnet mit
  const transform = useStore((z) => z.transform);
  const [seite, setSeite] = useState<'oben' | 'unten' | 'dock'>('oben');
  // M168: Die Popover (KI/Attribute/Ausrichten/Verschieben) leben als PORTAL
  // mit fester Bildschirmposition — innerhalb der NodeToolbar deckelt der
  // Stacking-Kontext des Flow-Viewports sie unter Kopf- und Tab-Leiste, bei
  // Karten nahe der Oberkante fingen die Leisten dann die Klicks ab (M151-Muster)
  // M198: 'more' = das ⋯-Menü — bündelt die selteneren Aktionen; 'attr'/'ai'/
  // 'align'/'font' öffnen von dort aus als zweite Ebene am selben Anker
  type MenuKind = 'ai' | 'attr' | 'align' | 'move' | 'frame' | 'more' | 'font';
  const [menu, setMenu] = useState<MenuKind | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0, down: false });
  /** M350: per Rechtsklick geöffnet — dann am Zeiger und mit den Knöpfen der Leiste dazu */
  const [amZeiger, setAmZeiger] = useState(false);
  useEffect(() => { if (!menu) setAmZeiger(false); }, [menu]);
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
  // M350: Rechtsklick auf eine Karte öffnet das „Mehr"-Menü am Zeiger (Kontextmenue.tsx wählt die Karte vorher).
  // Die Leiste entsteht evtl. erst mit dieser Auswahl — darum liegt der Wunsch zwischengespeichert bereit.
  useEffect(() => {
    const auf = () => {
      const w = kartenWunschNehmen();
      if (!w) return;
      const nurRahmen = selectActiveBoard(useBoard.getState()).nodes.filter((n) => n.selected).every((n) => n.type === 'frame');
      setMenuPos({ x: inLayout(w.x), y: inLayout(w.y), down: true });
      setAmZeiger(true);
      setMenu(nurRahmen ? 'frame' : 'more');
    };
    auf();
    window.addEventListener(KARTEN_EREIGNIS, auf);
    return () => window.removeEventListener(KARTEN_EREIGNIS, auf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    // M350: am Zeiger geöffnet kann es unten aus dem Bild ragen — dann nach oben verankern
    const unten = inLayout(window.innerHeight) - 8;
    if (inLayout(b.bottom) > unten) { el.style.top = `${Math.max(8, unten - inLayout(b.height))}px`; el.style.bottom = 'auto'; }
    // M389: Nach oben geöffnet kann es OBEN aus dem Bild ragen (Tablet im Karten-Fokus: Leiste mitten im Bild, Menü
    // 420 hoch) — die ersten Einträge lagen dann unter der Kopfzeile. Es bleibt unter ihr und rollt, wenn es muss.
    const kopf = document.querySelector('.focus-head')?.getBoundingClientRect().bottom ?? 0;
    const oben = Math.max(8, inLayout(kopf) + 6);
    if (inLayout(b.top) < oben) {
      el.style.top = `${oben}px`; el.style.bottom = 'auto';
      el.style.maxHeight = `${Math.max(160, unten - oben)}px`;
    }
  }, [menu, menuPos, amZeiger]);
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
  /** M390: Eine Änderung an mehreren Karten ist EIN Rückgängig-Schritt (vorher: je Karte einer). */
  const fuerAlle = (fn: (n: AppNode) => void) => {
    useBoard.getState().pushHistory();
    mutedHistory(() => { for (const n of selected) fn(n); });
  };
  const selFrames = board.nodes.filter((n) => n.selected && n.type === 'frame');
  /** M399: Ein Anordnungs-Befehl auf die Auswahl – ein Rückgängig-Schritt, gleich wie viele Karten sich bewegen */
  const anordnen = (op: AlignOp, offenLassen = false) => {
    const { moves, resizes } = computeAlign(selected, op);
    if (moves.length === 0 && resizes.length === 0) {
      if (!offenLassen) { setMenu(null); showToast('Die Karten stehen schon so.'); }
      return;
    }
    const st = useBoard.getState();
    st.pushHistory();
    mutedHistory(() => {
      // Eine von Hand gesetzte Höhe soll bleiben: wie beim Ziehen am Griff endet die Auto-Größe
      const hoehe = resizes.filter(([rid, , h]) => Math.abs(h - sizeOf(selected.find((n) => n.id === rid)!).h) > 0.01).map(([rid]) => rid);
      if (hoehe.length) st.setAutoFit(hoehe, false);
      for (const [rid, w, h] of resizes) st.resizeNode(rid, w, h);
      if (moves.length) st.setNodePositions(moves);
    });
    if (offenLassen) return;
    setMenu(null);
    showToast(`${ALIGN_LABEL[op]} – Strg+Z macht es rückgängig`);
  };
  /** M400: markierte Karten locker schräg legen (jede anders, zwischen 2° und 7°) oder gerade richten */
  const drehen = (art: 'schraeg' | 'gerade') => {
    const karten = selected.filter((n) => istDrehbar(n));
    const neu: Array<[string, number]> = art === 'gerade'
      ? karten.filter((n) => winkelVon(n)).map((n) => [n.id, 0])
      : karten.map((n, i) => [n.id, (i % 2 ? 1 : -1) * (2 + Math.round(Math.random() * 50) / 10)]);
    setMenu(null);
    if (neu.length === 0) return;
    const st = useBoard.getState();
    st.pushHistory();
    mutedHistory(() => st.setWinkel(neu));
    showToast(art === 'gerade' ? 'Gerade gerichtet – Strg+Z macht es rückgängig' : 'Schräg gelegt – Strg+Z macht es rückgängig');
  };
  const anordnenKnopf = (op: AlignOp, Bild: (p: { size?: number }) => JSX.Element, offenLassen = false) => (
    <button
      key={op}
      className="anordnen-knopf"
      data-anordnen={op}
      title={ALIGN_LABEL[op]}
      aria-label={ALIGN_LABEL[op]}
      disabled={selected.length < (ALIGN_MIN[op] ?? 2)}
      onClick={() => anordnen(op, offenLassen)}
    ><Bild size={17} /></button>
  );
  const framesOnly = selected.length === 0;
  // Geankerte Markierungen (M127) der ausgewählten Karten — bei Bedarf lösbar
  const anchoredCount = (board.drawings ?? []).filter(
    (s) => s.anchor && selected.some((n) => n.id === s.anchor),
  ).length;
  /** Unterkante des Kopf-Chromes bzw. Oberkante des Fuß-Chromes — gemessen */
  const grenzen = () => {
    const unterkante = (sel: string) => {
      const e = document.querySelector(sel) as HTMLElement | null;
      if (!e || e.offsetHeight === 0) return null;
      return e.getBoundingClientRect().bottom;
    };
    const oberkante = (sel: string) => {
      const e = document.querySelector(sel) as HTMLElement | null;
      if (!e || e.offsetHeight === 0) return null;
      return e.getBoundingClientRect().top;
    };
    // M318: Die linke Spalte (.tabs.spalte) ist KEINE Kopfleiste — sie reicht bis
    // unten; mit ihr als „Kopf" war nie Platz an der Karte, und die Leiste
    // dockte am PC immer unten an (zweite Leiste über dem Dock).
    const kopf = ['.focus-head', '.tabs:not(.spalte)', '.topbar']
      .map(unterkante).filter((v): v is number => v !== null);
    const fuss = ['.focus-nav', '.pn-format-dock', '.dock']
      .map(oberkante).filter((v): v is number => v !== null);
    return {
      kopf: kopf.length ? Math.max(...kopf) : 0,
      fuss: fuss.length ? Math.min(...fuss) : window.innerHeight,
    };
  };

  const auswahlIds = [...selected, ...selFrames].map((n) => n.id).join(',');
  useLayoutEffect(() => {
    if (!auswahlIds || (phone && imFokus)) return;
    const kaesten = auswahlIds.split(',')
      .map((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r && r.height > 0);
    if (!kaesten.length) return;
    const oben = Math.min(...kaesten.map((r) => r.top));
    const unten = Math.max(...kaesten.map((r) => r.bottom));
    // Höhe der Leiste selbst messen statt zu schätzen — sie wächst mit dem
    // Anzeige-Zoom und bei mehreren Zeilen
    const hoch = (leisteRef.current?.getBoundingClientRect().height || 46) + 22;
    const g = grenzen();
    /* „Unten" gilt nur, wenn die Unterkante der Karte überhaupt SICHTBAR ist:
       Ist die Karte nach oben aus dem Bild gescrollt, läge die Leiste dort
       zwar unter der Karte, aber hinter der Kopfleiste (gemessen: 45 Punkte
       Überdeckung). Dann ist die feste Zeile unten der ehrlichere Platz. */
    const naechste = oben - g.kopf >= hoch ? 'oben'
      : (g.fuss - unten >= hoch && unten >= g.kopf) ? 'unten'
        : 'dock';
    setSeite((alt) => (alt === naechste ? alt : naechste));
  }, [auswahlIds, transform, phone, imFokus]);


  if (selected.length === 0 && selFrames.length === 0) return null;
  // Hinweis: Der Platz-Effekt oben steht bewusst VOR dieser Rückgabe — React
  // verlangt, dass Hooks bei jedem Aufruf in derselben Reihenfolge laufen.
  // Unterhalb einer bedingten Rückgabe platziert, riss er die ganze
  // Board-Ansicht in die Fehlergrenze (gemessen in der Prüfreihe m292).

  /** KI-Aktion nur auf die ausgewählten Karten */
  const runAi = async (fn: (nodes: AppNode[], pos: { x: number; y: number }, fortschritt: (m: string) => void) => Promise<string>, restoreCmd?: string) => {
    setMenu(null);
    // GLOBALE Sperre teilt sich die Auswahl-Leiste mit dem Dock (Audit R6-K6)
    if (useBoard.getState().aiBusy) { showToast('Eine KI-Aktion läuft bereits – kurz warten.'); return; }
    useBoard.getState().setAiBusy(true);
    kiAbbruchZuruecksetzen();
    setAiBusy(true);
    showToast(`KI analysiert ${selected.length} Karte(n) …`, false, 120000, true);
    try {
      const pos = screenToFlowPosition({ x: window.innerWidth / 2 + 160, y: window.innerHeight / 2 - 80 });
      // M332: Stapel-Aktionen melden ihren Fortschritt; der Toast bietet „Abbrechen"
      const fortschritt = (m: string) => showToast(`KI: ${m}`, false, 180000, true);
      const msg = await fn(selected, pos, fortschritt);
      showToast(`${msg}`, false, msg.includes('unberücksichtigt') || msg.includes('Nicht geschafft') || msg.startsWith('Abgebrochen') ? 12000 : Math.max(5000, msg.length * 75));
    } catch (e) {
      showToast(`KI-Aktion fehlgeschlagen: ${(e as Error).message}`, false, 8000);
      if (restoreCmd) setCmd(restoreCmd);
    } finally {
      setAiBusy(false);
      useBoard.getState().setAiBusy(false);
    }
  };

  const duplicate = () => {
    const n = useBoard.getState().dupliziere(selected.map((x) => x.id));
    if (n) showToast(`${n} Karte${n > 1 ? 'n' : ''} dupliziert`);
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
      {/* M296/M313: Fünf Elemente — Duplizieren, Teilen, ⋯, Löschen und der
          Zähler. Verschieben, Schrift & Größe, KI, Ausrichten, Nachschlagen,
          Vorlage, Kommentar, Eigenschaften und Archivieren liegen im ⋯;
          „Formatiert kopieren" lebt nur noch im Teilen-Dialog. */}
      {!framesOnly && <button onClick={duplicate} title="Duplizieren" aria-label="Duplizieren"><IDuplicate size={15} /></button>}
      {single && (
        <span className="sel-ai-wrap">
          {menu === 'attr' && menuPortal('sel-attr-menu', (
            <>
              <div className="sel-attr-title">Eigenschaften (schlüssel = wert)</div>
              {Object.entries(attrs).map(([k, v]) => (
                <div key={k} className="sel-attr-row">
                  <b translate="no">{k}</b><span translate="no">{v}</span>
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
              <div className="sel-attr-hint">z. B. status = wartet · kunde = ACME – über Strg+K durchsuchbar</div>
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
                placeholder={selected.length === 1 ? kiBeispiel(selected[0].type) : 'Anweisung für die Auswahl …'}
                data-taste="ki-auswahl-eingabe"
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => {
                  // M410: Pfeil hoch/runter blättert durch die früheren Anweisungen auf diesem Board
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    const frueher = kiBlaettern(useBoard.getState().activeId, cmd, e.key === 'ArrowUp');
                    if (frueher !== null) { e.preventDefault(); setCmd(frueher); }
                    return;
                  }
                  if (e.key === 'Enter' && cmd.trim() && !aiBusy) {
                    const wish = cmd;
                    setCmd('');
                    runAi((n, p, f) => aiCommand(wish, n, p, f), wish);
                  }
                }}
              />
              <div className="sel-attr-title">KI-Werkzeuge</div>
              {selected.some((n) => n.type === 'note') && (
                <button disabled={aiBusy} onClick={() => runAi((n, _p, f) => aiPolish(n, f))} title="Verbesserte Fassung als neue Notiz daneben – das Original bleibt" data-taste="ki-verbessern">
                  <IWand size={14} /> {selected.filter((n) => n.type === 'note').length > 1 ? `Texte verbessern (${selected.filter((n) => n.type === 'note').length})` : 'Text verbessern'}
                </button>
              )}
              {/* M445: Auswahl in benannte Rahmen ordnen – mit Vorschau (lib/themenOrdnen.ts) */}
              {selected.length >= 3 && (
                <button disabled={aiBusy} data-taste="ki-themen" title="Die markierten Karten nach Themen in benannte Rahmen ordnen – erst nach deiner Bestätigung"
                  onClick={() => { setMenu(null); void import('../lib/themenOrdnen').then((m) => m.themenOrdnenStarten(selected)); }}>Nach Themen ordnen …</button>
              )}
              <button disabled={aiBusy} onClick={() => runAi(aiTasks)}>Aufgaben extrahieren</button>
              <button disabled={aiBusy} onClick={() => runAi(aiProcess)}>Als Workflow-Diagramm</button>
              <button disabled={aiBusy} onClick={() => runAi(aiBriefing)}>Zusammenfassen</button>
              {/* M428: eine markierte Präsentation überarbeiten — der Wunsch steht im Feld darüber */}
              {selected.length === 1 && selected[0].type === 'htmlapp' && (selected[0].data as { vorlage?: string }).vorlage === 'vibestudio' && (
                <button disabled={aiBusy} data-taste="ki-praesentation-ueberarbeiten" title="Die Präsentation nach dem Wunsch im Feld darüber überarbeiten – die vorige Fassung bleibt im Menü der Karte"
                  onClick={() => {
                    const wunsch = cmd.trim() || window.prompt('Was soll die KI an der Präsentation ändern?', '') || '';
                    if (!wunsch.trim()) return;
                    setCmd('');
                    runAi((n, _p, f) => aiPraesentationUeberarbeiten(n[0].id, wunsch, f));
                  }}>Präsentation überarbeiten</button>
              )}
              {/* M427: aus den markierten Karten eine Präsentation (Vibe Studio); steht im Feld etwas, ist es der Wunsch */}
              <button disabled={aiBusy} data-taste="ki-praesentation-auswahl" title="Folien aus den markierten Karten – was im Feld darüber steht, gilt als Wunsch (Publikum, Länge, Ton)"
                onClick={() => { const wunsch = cmd; setCmd(''); runAi((n, p, f) => aiPraesentation(n, p, f, wunsch)); }}>Als Präsentation</button>
              {selected.length >= 2 && (
                <button disabled={aiBusy} onClick={() => runAi((n) => aiEdges(n))}>Verbindungen vorschlagen</button>
              )}
            </>
          ))}
        </span>
      )}
      {selected.length >= 2 && (
        <span className="sel-ai-wrap">
          {menu === 'align' && menuPortal('anordnen-menu', (
            <>
              {/* M399: vier Gruppen statt einer Liste – Kanten, Verteilen, Größe als Symbol-Zeilen, die großen
                  Umordnungen (Raster, Packen, Aufräumen) mit Namen */}
              <div className="sel-attr-title">Ausrichten</div>
              <div className="anordnen-reihe">
                {anordnenKnopf('left', IKanteLinks)}{anordnenKnopf('centerX', IKanteMitteX)}{anordnenKnopf('right', IKanteRechts)}
                <i aria-hidden="true" />
                {anordnenKnopf('top', IKanteOben)}{anordnenKnopf('centerY', IKanteMitteY)}{anordnenKnopf('bottom', IKanteUnten)}
              </div>
              <div className="sel-attr-title">Verteilen</div>
              <div className="anordnen-reihe">
                {anordnenKnopf('distH', IVerteilenX)}{anordnenKnopf('distV', IVerteilenY)}
                <i aria-hidden="true" />
                {anordnenKnopf('row', IAlsZeile)}{anordnenKnopf('column', IAlsSpalte)}
              </div>
              <div className="sel-attr-title">Größe</div>
              <div className="anordnen-reihe">
                {anordnenKnopf('width', IGleichBreit)}{anordnenKnopf('height', IGleichHoch)}{anordnenKnopf('size', IGleichGross)}
                <i aria-hidden="true" />
                {anordnenKnopf('smaller', IKleiner, true)}{anordnenKnopf('bigger', IGroesser, true)}
              </div>
              <div className="sel-attr-title">Anordnen</div>
              <button data-anordnen="grid" onClick={() => anordnen('grid')} title="Spalten und Zeilen bündig, Reihenfolge wie gelesen"><IRaster size={14} /> Raster</button>
              <button data-anordnen="pack" onClick={() => anordnen('pack')} title="Dicht aneinander, ohne Lücken und Überlappen"><IPacken size={14} /> Kompakt packen</button>
              <button data-anordnen="tidy" onClick={() => anordnen('tidy')} title="Anordnung bleibt, Abstände werden gleich, nichts überlappt"><IOrdnen size={14} /> Aufräumen</button>
              {/* M445: auch hier, weil es ohne Chat-KI über das Gehirn geht (die KI-Werkzeuge erscheinen nur mit KI) */}
              {selected.length >= 3 && (
                <button data-anordnen="themen" onClick={() => { setMenu(null); void import('../lib/themenOrdnen').then((m) => m.themenOrdnenStarten(selected)); }} title="Nach Themen in benannte Rahmen ordnen – per KI oder Gehirn, erst nach deiner Bestätigung"><IFrame size={14} /> Nach Themen …</button>
              )}
              {/* M400: Zettel locker hinlegen – und wieder gerade */}
              {selected.some((n) => istDrehbar(n)) && (
                <>
                  <button data-anordnen="schraeg" onClick={() => drehen('schraeg')} title="Jede Karte leicht anders geneigt, wie hingelegte Zettel"><ISchraeg size={14} /> Schräg legen</button>
                  <button data-anordnen="gerade" disabled={!selected.some((n) => winkelVon(n))} onClick={() => drehen('gerade')} title="Alle markierten Karten wieder gerade stellen"><IRaster size={14} /> Gerade richten</button>
                </>
              )}
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
                        translate="no"
                        title={`${sp.name} › ${p.name} › ${b.name}`}
                      >
                        {b.name} <span className="sel-move-proj">{p.name}</span>
                      </button>
                    )),
                ),
              )}
            </>
          ))}
        </span>
      )}
      {!framesOnly && (
        <button
          onClick={() => useBoard.getState().setShareCards([...selected, ...selFrames].map((n) => n.id))}
          title="Teilen"
          aria-label="Teilen"
        ><IShare size={15} /></button>
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
                <div className="sel-attr-hint">Gilt für die ganze Karte – einzelne Wörter formatierst du direkt im Text. „Sehr gut lesbar" ist die für Sehschwäche entworfene Atkinson Hyperlegible</div>
              </>
            );
          })())}
          {menu === 'more' && menuPortal(amZeiger ? 'sel-more-menu am-zeiger' : 'sel-more-menu', (() => {
            const allAuto = selected.every((n) => n.autoFit !== false);   // Standard AN (M111)
            const allArchived = selected.every((n) => n.archived);
            return (
              <>
                {/* M350: per Rechtsklick geöffnet — die Knöpfe der Leiste stehen mit drin */}
                {amZeiger && (
                  <>
                    {single && (
                      <button onClick={() => { setMenu(null); useBoard.getState().setFocusCard(single.id); }} title="Karte im Fokus öffnen (Enter)">
                        <IMaximize size={14} /> Öffnen
                      </button>
                    )}
                    <button onClick={() => { setMenu(null); duplicate(); }} title="Duplizieren (Strg+D)"><IDuplicate size={14} /> Duplizieren</button>
                    <button onClick={() => { setMenu(null); useBoard.getState().setShareCards([...selected, ...selFrames].map((n) => n.id)); }} title="Teilen und exportieren">
                      <IShare size={14} /> Teilen …
                    </button>
                  </>
                )}
                {/* M313: Reihenfolge wie in jedem ⋯ der App — Tun · Werkzeuge ·
                    Weitergeben · Aufräumen. Verschieben kam aus der Leiste hierher. */}
                {single && (
                  <>
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
                    <button onClick={() => setMenu('attr')} title="Eigenschaften (schlüssel = wert) – über Strg+K durchsuchbar" aria-label="Eigenschaften">
                      <ITag size={14} /> Eigenschaften …{Object.keys(attrs).length > 0 ? ` (${Object.keys(attrs).length})` : ''}
                    </button>
                  </>
                )}
                {boards.length > 1 && (
                  <button onClick={() => setMenu('move')} title="In ein anderes Board verschieben" aria-label="Verschieben">
                    <IMoveTo size={14} /> In Board verschieben …
                  </button>
                )}
                <div className="sel-attr-title">Werkzeuge</div>
                {/* M323: Farbe für Notizen — auch für mehrere auf einmal, und am
                    Telefon ohne Zeigen auf die Karte erreichbar */}
                {selected.every((n) => n.type === 'note') && (
                  <div className="sel-farben" role="group" aria-label="Farbe">
                    <span className="sel-farben-label"><IPalette size={14} /> Farbe</span>
                    {STICKY_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`sel-farbe note-farbe-${c} ${selected.every((n) => (n.data as { color?: string }).color === c && !(n.data as { hex?: string }).hex) ? 'on' : ''}`}
                        title={FARB_NAMEN[c]}
                        aria-label={`Farbe ${FARB_NAMEN[c]}`}
                        onClick={() => fuerAlle((n) => updateNodeData(n.id, { color: c, hex: undefined }))}
                      />
                    ))}
                  </div>
                )}
                {/* M395: ein einzelnes Bild bearbeiten (zuschneiden, drehen, …) */}
                {selected.length === 1 && bildBearbeitbar(selected[0]) && (
                  <button data-taste="bild-bearbeiten" onClick={() => { setMenu(null); bildBearbeiten(selected[0].id); }}>
                    <ICrop size={14} /> Bild bearbeiten …
                  </button>
                )}
                {/* M374: Bilder liegen rahmenlos auf dem Board — hier kommt die Karte mit Rand zurück (und wieder weg) */}
                {selected.every((n) => n.type === 'image' || (n.type === 'file' && vorschauArt(String((n.data as { name?: string }).name ?? ''), (n.data as { mime?: string }).mime) === 'bild')) && (() => {
                  const alleMit = selected.every((n) => (n.data as { rahmen?: boolean }).rahmen === true);
                  return (
                    <button
                      data-taste="bild-rahmen"
                      aria-pressed={alleMit}
                      title={alleMit ? 'Nur das Bild zeigen – ohne Rand, Fläche und Schatten' : 'Als Karte mit Rand, Fläche und Schatten zeigen'}
                      onClick={() => { setMenu(null); fuerAlle((n) => updateNodeData(n.id, { rahmen: alleMit ? undefined : true })); }}
                    >
                      <IImage size={14} /> {alleMit ? 'Ohne Rahmen (nur das Bild)' : 'Mit Rahmen (als Karte)'}
                    </button>
                  );
                })()}
                {/* M296: „Schrift & Größe" liegt hier — und NUR hier. M267 hatte
                    ihm einen eigenen Knopf in der Leiste gegeben; die Leiste soll
                    aber sechs Elemente haben, und ein Weg reicht. */}
                <button onClick={() => setMenu('font')} title="Schrift & Größe" aria-label="Schrift & Größe">
                  <IType size={14} /> Schrift &amp; Größe …
                </button>
                {aiReady(ai) && (
                  <button onClick={() => setMenu('ai')} title="KI-Aktionen auf die Auswahl" aria-label="KI-Aktionen">
                    <IWand size={14} /> KI-Aktionen …
                  </button>
                )}
                {selected.length >= 2 && (
                  <button onClick={() => setMenu('align')} title="Ausrichten, verteilen, gleiche Größe, Raster" aria-label="Anordnen" data-taste="anordnen-auf">
                    <IArrange size={14} /> Anordnen …
                  </button>
                )}
                {selected.every((n) => KACHEL_TYPEN.has(n.type ?? '')) && (() => {
                  // M298: Große Module als Kachel — nur, wenn die ganze Auswahl das kann
                  const alle = selected.every((n) => n.kachel);
                  return (
                    <button
                      onClick={() => { setMenu(null); useBoard.getState().setKachel(selected.map((n) => n.id), !alle); }}
                      title={alle ? 'Kachel ausklappen' : 'Als Kachel zeigen'}
                      aria-label={alle ? 'Kachel ausklappen' : 'Als Kachel zeigen'}
                    >
                      <ICompact size={14} /> {alle ? 'Kachel ausklappen' : 'Als Kachel zeigen'}
                    </button>
                  );
                })()}
                <button
                  className={allAuto ? 'on' : ''}
                  onClick={() => setAutoFit(selected.map((n) => n.id), !allAuto)}
                  title={allAuto
                    ? 'Auto-Größe ist AN: Karte wächst mit dem Inhalt – manuelles Ziehen an den Griffen schaltet sie ab'
                    : 'Auto-Größe: Karte wächst automatisch mit dem Inhalt (jederzeit per Ziehen übersteuerbar)'}
                  aria-label="Auto-Größe"
                >
                  <IFit size={14} /> Auto-Größe {allAuto ? 'AUS' : 'AN'}
                </button>
                {selected.some((n) => winkelVon(n)) && (
                  <button onClick={() => drehen('gerade')} title="Schräg liegende Karten wieder gerade stellen" data-taste="gerade-richten">
                    <IRaster size={14} /> Gerade richten
                  </button>
                )}
                <div className="sel-attr-title">Weitergeben</div>
                <button
                  onClick={() => {
                    setMenu(null);
                    const first = nodesToText([selected[0]]).split('\n').find((l) => l.trim())?.trim() ?? '';
                    setLookup(first.replace(/^[#\-*\d.\s☐☑]+/, '').slice(0, 80));
                  }}
                  title="Wikipedia und Websuche zur ersten Zeile der Karte"
                >
                  <IGlobe size={14} /> Nachschlagen (Wikipedia &amp; Web)
                </button>
                {/* M454: Kontakte der Auswahl als EINE .vcf – fürs Adressbuch (Outlook, Telefon) */}
                {selected.some((n) => n.type === 'kontakt') && (() => {
                  const zahl = selected.filter((n) => n.type === 'kontakt').length;
                  return (
                    <button
                      data-taste="kontakte-vcard"
                      onClick={() => { setMenu(null); kontakteHerunterladen(selected, board.name); }}
                      title="Die gewählten Kontakte in einer vCard-Datei (.vcf) – für Outlook, Telefon, Adressbuch"
                    >
                      <IDownload size={14} /> {zahl === 1 ? 'Kontakt als vCard' : `${zahl} Kontakte als vCard`}
                    </button>
                  );
                })()}
                {single && (
                  <button onClick={() => { setMenu(null); asTemplate(); }} title="Karte als Vorlage speichern (＋-Menü → Vorlagen)">
                    <IBookmark size={14} /> Als Vorlage speichern
                  </button>
                )}
                <div className="sel-attr-title">Aufräumen</div>
                {anchoredCount > 0 && (
                  <button
                    onClick={() => { setMenu(null); detachStrokes(selected.map((n) => n.id)); }}
                    title={`${anchoredCount} Markierung${anchoredCount > 1 ? 'en' : ''} kleben an dieser Karte und wandern mit – Klick löst sie und lässt sie frei auf dem Board liegen`}
                  >
                    <IPen size={14} /> Markierungen lösen ({anchoredCount})
                  </button>
                )}
                {selected.some(textKarte) && (
                  // M332: Markdown-/Textdatei → formatierte Notiz, ohne KI, an derselben Stelle
                  <button
                    onClick={async () => {
                      setMenu(null);
                      const { fertig, fehler } = await textDateienAlsNotizen(selected);
                      showToast(fertig
                        ? `${fertig} Textdatei${fertig > 1 ? 'en' : ''} als Notiz übernommen${fehler.length ? ` – nicht geschafft: ${fehler.join(' · ')}` : ''}`
                        : `Keine Textdatei ließ sich übernehmen: ${fehler.join(' · ')}`, false, fehler.length ? 9000 : 4000);
                    }}
                    data-taste="als-notiz"
                    title="Als formatierte Notiz übernehmen – Überschriften und Listen bleiben; die Datei-Karte wird ersetzt"
                    aria-label="Als Notiz übernehmen"
                  >
                    Als Notiz übernehmen ({selected.filter(textKarte).length})
                  </button>
                )}
                {allArchived ? (
                  <button
                    onClick={() => { setMenu(null); setArchived(selected.map((n) => n.id), false); }}
                    title="Aus dem Archiv zurückholen – die Karte gilt wieder als aktiv"
                    aria-label="Zurückholen"
                  >
                    <IArchiveRestore size={14} /> Aus dem Archiv zurückholen
                  </button>
                ) : (
                  <button
                    onClick={() => { setMenu(null); setArchived(selected.map((n) => n.id), true); }}
                    data-taste="archivieren"
                    title="Archivieren – Karte gilt als erledigt, wird ausgeblendet und taucht nicht mehr in Aufgaben/Erinnerungen auf"
                    aria-label="Archivieren"
                  >
                    <IArchive size={14} /> Archivieren (erledigt)
                  </button>
                )}
                {amZeiger && (
                  <button className="sel-menu-gefahr" onClick={() => { setMenu(null); remove(); }} title="Löschen (Entf)">
                    <ITrash size={14} /> Löschen
                  </button>
                )}
              </>
            );
          })())}
          <button
            className={menu === 'more' || menu === 'attr' || menu === 'ai' || menu === 'align' || menu === 'font' || aiBusy ? 'ai-on' : ''}
            data-smbtn
            data-taste="auswahl-mehr"
            onClick={toggleMenu('more')}
            title="Mehr"
            aria-label="Mehr"
          ><IMore size={15} /></button>
        </span>
      )}
      <button onClick={remove} title={selFrames.length ? 'Löschen (Rahmen: nur der Rahmen – die Karten darin bleiben liegen)' : 'Löschen'} className="danger"><ITrash size={15} /></button>
    </>
  );

  /**
   * M292: Im Karten-Fokus bleibt es bei der festen Zeile unten.
   *
   * Dort füllt die Karte den Schirm; „über der Karte" gäbe es gar nicht, und
   * der Fuß ist seit M291 ohnehin fest gestapelt (Blättern · Formatieren ·
   * Werkzeuge). Am Telefon ist der Fokus der Normalfall.
   */
  if (phone && imFokus) {
    return createPortal(
      <div className="sel-toolbar sel-toolbar-dock nodrag" ref={leisteRef}>{bar}</div>,
      document.body,
    );
  }

  /**
   * M292: Sonst dockt die Leiste an der Karte an — oben, sonst unten, sonst
   * als feste Zeile am unteren Bildrand. Welche der drei Stellen es wird,
   * rechnet `seite` aus (siehe oben); frei verschieben lässt sie sich nicht
   * mehr, damit man sie überall an derselben Stelle sucht und findet.
   */
  if (seite === 'dock') {
    return createPortal(
      <div className="sel-toolbar sel-toolbar-dock sel-toolbar-frei nodrag" ref={leisteRef}>{bar}</div>,
      document.body,
    );
  }

  /**
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
      position={seite === 'unten' ? Position.Bottom : Position.Top}
      offset={12}
      className="sel-toolbar-anker"
    >
      <div className="sel-toolbar nodrag" ref={leisteRef}>{bar}</div>
    </NodeToolbar>
  );
}
