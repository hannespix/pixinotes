import { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import { mutedHistory, useBoard } from '../store';
import { doneCol, kanbanCols, mitSpalte, openSubs, ticketBlockers, uid, type GanttData, type KanbanData } from '../types';
import { makeKanban, makeNote } from '../lib/nodes';
import {
  collectTaskTags, collectTasks, doneLog, downloadTasksIcs, formatDueShort, logDone,
  myDayKeys, parseQuickTask, shiftIso, toggleCheckBlock, toggleMyDay, type TaskRef,
} from '../lib/tasks';
import { aiReady, mdToBlocks } from '../lib/ai';
import { applyTopicTag, brainDigest, buildTopicOverview, type DigestLine, type TopicCluster } from '../lib/brain';
import { aiWeekPlan } from '../lib/aiActions';
import { IBell, ICalendar, IChevronR, IFilter, IGantt, IKanban, INote, ISearch, IUsers, IWand, IX } from './Icons';

const PRIO_LABEL: Record<1 | 2 | 3, string> = { 1: '!!!', 2: '!!', 3: '!' };

type Filter = 'all' | 'myday' | 'today' | 'overdue';

/**
 * M231: Kennung des Board-Filters „nur das gerade offene Board".
 *
 * Bewusst KEINE Board-ID: Der Filter soll dem aktiven Board folgen, wenn man
 * die Zentrale schließt, das Board wechselt und sie wieder öffnet. Eine fest
 * eingetragene ID würde beim nächsten Mal auf das falsche Board zeigen.
 */
const AKTIV = '__aktiv__';

/** Fristen-Gruppen der Aufgabenliste (M113) */
type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'none';
const BUCKETS: Array<[Bucket, string]> = [
  ['overdue', 'Überfällig'],
  ['today', 'Heute'],
  ['week', 'Diese Woche'],
  ['later', 'Später'],
  ['none', 'Ohne Frist'],
];

/**
 * M227: Merkzettel für den Gehirn-Puls.
 *
 * Bewusst localStorage und nicht der Board-Store: Das ist eine Ansichts-
 * Vorliebe dieses Geräts, kein Inhalt — sie gehört weder in die Historie
 * (Strg+Z) noch in einen Export. Zugriffe sind gekapselt, weil `localStorage`
 * in privaten Fenstern werfen kann.
 */
const PULS_KEY = 'pn-puls-auf';
const pulsStand = (() => {
  try { return localStorage.getItem(PULS_KEY) === '1'; } catch { return false; }
})();
function merkePuls(auf: boolean) {
  try { localStorage.setItem(PULS_KEY, auf ? '1' : '0'); } catch { /* privates Fenster */ }
}

function bucketOf(t: TaskRef, todayIso: string): Bucket {
  if (!t.due) return 'none';
  if (t.urgency === 'overdue') return 'overdue';
  if (t.due === todayIso) return 'today';
  const days = Math.round((new Date(`${t.due}T12:00:00`).getTime() - new Date(`${todayIso}T12:00:00`).getTime()) / 864e5);
  return days <= 7 ? 'week' : 'later';
}

/**
 * Aufgaben-Zentrale: alle offenen Kanban-Tickets und Checklisten-Punkte aus
 * ALLEN Boards. Filter (Alle/Heute/Überfällig + Board), Fälligkeit direkt
 * editierbar, Schnell-Eingabe legt neue Tickets an. Abhaken hier, Klick
 * springt zur Karte.
 */
export function TaskHub() {
  const open = useBoard((s) => s.tasksOpen);
  const setOpen = useBoard((s) => s.setTasksOpen);
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const updateNodeDataOnBoard = useBoard((s) => s.updateNodeDataOnBoard);
  const showToast = useBoard((s) => s.showToast);
  const [, tick] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  // M231: Voreinstellung ist das AKTIVE Board, nicht das ganze Werkzeug.
  // Wer die Zentrale öffnet, arbeitet gerade an einem Board — 56 Aufgaben aus
  // allen Bereichen sind an der Stelle keine Übersicht, sondern eine Wand
  // (User-Report). „Alle Boards" steht direkt darunter weiter bereit.
  const [boardFilter, setBoardFilter] = useState(AKTIV);
  const [personFilter, setPersonFilter] = useState('all');
  const [groupByPerson, setGroupByPerson] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [quick, setQuick] = useState('');
  const [quickBoard, setQuickBoard] = useState(''); // '' = aktives Board
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false); // M227: Trichter, nur schmal wirksam
  const [doneOpen, setDoneOpen] = useState(false);
  const [myDay, setMyDay] = useState<Set<string>>(() => myDayKeys());
  // M207: Gehirn-Puls — Themen, Knotenpunkte und offene Vorschläge auf einen Blick
  const brainOn = useBoard((s) => s.brain.on);
  const rejectedLinks = useBoard((s) => s.rejectedLinks);
  const [digest, setDigest] = useState<DigestLine[]>([]);
  // M227: Der Puls merkt sich seinen Zustand. Zugeklappt ist die Voreinstellung —
  // wer ihn aber täglich liest, soll ihn nicht täglich neu aufklappen müssen.
  const [pulseOpen, setPulseOpen] = useState(pulsStand);
  // M231: Beim Öffnen zurück auf das aktive Board. Wer während einer Sitzung
  // bewusst auf „alle Boards" stellt, behält das — beim nächsten Öffnen zählt
  // aber wieder, woran gerade gearbeitet wird.
  useEffect(() => { if (open) setBoardFilter(AKTIV); }, [open]);
  useEffect(() => {
    if (!open || !brainOn) { setDigest([]); return; }
    let gone = false;
    brainDigest(new Set(rejectedLinks))
      .then((d) => { if (!gone) setDigest(d); })
      .catch(() => { if (!gone) setDigest([]); });
    return () => { gone = true; };
  }, [open, brainOn, rejectedLinks]);
  // M208: Strg+Z/Strg+Y wirken auch hier. Das Board ist ausgehängt, solange die
  // Zentrale offen ist — ohne diesen Handler ginge das Rückgängig-Versprechen
  // der Puls-Aktionen ins Leere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      e.preventDefault();
      const st = useBoard.getState();
      if (key === 'y' || e.shiftKey) st.redo(); else st.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  /** M209: Übersichts-Notiz aus einer Themen-Insel aufs aktive Board legen */
  const makeOverview = async (cluster: TopicCluster, label: string) => {
    const { title, markdown } = buildTopicOverview(cluster, label);
    const st = useBoard.getState();
    const note = makeNote({ x: 120, y: 120 }, {
      color: 'sky',
      blocks: await mdToBlocks(title, markdown) as never,
    });
    st.pushHistory();
    mutedHistory(() => st.addNode(note));
    setOpen(false);
    st.focusNode(st.activeId, note.id);
    showToast(`📝 Übersichts-Notiz „${label}" angelegt — Strg+Z macht es rückgängig.`);
  };
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null); // Accordion-Werkzeuge (M116)
  const [aiBusy, setAiBusy] = useState(false);
  const ai = useBoard((s) => s.ai);

  const todayIso = new Date().toISOString().slice(0, 10);
  const allTasks = useMemo(() => collectTasks(boards), [boards]);
  const persons = useMemo(
    () => [...new Set(allTasks.map((t) => t.who).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [allTasks],
  );
  const tags = useMemo(() => collectTaskTags(allTasks), [allTasks]);
  /**
   * M227: Wie viele der eingeklappten Filter greifen gerade?
   *
   * Das ist der Preis fürs Wegräumen: Eine kurze Liste kann jetzt an einem
   * Filter liegen, den man nicht sieht. Die Zahl am Trichter ist die Antwort
   * darauf — sie muss deshalb GENAU die Filter zählen, die hinter ihm liegen
   * (die vier Zeitchips bleiben ja sichtbar).
   */
  // M231: Der eingestellte Board-Filter als echte ID — AKTIV zeigt aufs
  // gerade offene Board, alles andere steht schon direkt drin.
  const boardId = boardFilter === AKTIV ? activeId : boardFilter;
  const aktivName = boards.find((b) => b.id === activeId)?.name ?? 'Aktives Board';
  const versteckteFilter =
    // Das aktive Board ist seit M231 der Normalfall — es zählt nicht als
    // „versteckter" Filter, sonst leuchtete der Trichter dauerhaft und die
    // Zahl sagte nichts mehr aus. Der Kopf nennt den Umfang ohnehin.
    (boardFilter !== 'all' && boardFilter !== AKTIV ? 1 : 0) +
    (personFilter !== 'all' ? 1 : 0) +
    (groupByPerson ? 1 : 0) +
    (search.trim() ? 1 : 0) +
    (tagFilter ? 1 : 0);
  const tasks = allTasks.filter((t) => {
    if (boardFilter !== 'all' && t.boardId !== boardId) return false;
    if (personFilter !== 'all' && t.who !== personFilter) return false;
    if (tagFilter && !t.text.toLowerCase().includes(`#${tagFilter}`)) return false;
    if (search && !t.text.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'myday') return myDay.has(t.key);
    if (filter === 'today') return t.urgency === 'overdue' || t.due === todayIso;
    if (filter === 'overdue') return t.urgency === 'overdue';
    return true;
  });
  const detailTask = detailKey ? allTasks.find((t) => t.key === detailKey) ?? null : null;
  // M231: Überfällig zählt im gewählten Board-Umfang. Vorher stand im Kopf
  // die Zahl aus dem ganzen Werkzeug — neben „12 angezeigt · Kochen" wirkten
  // „30 überfällig" wie ein Widerspruch.
  const overdue = allTasks.filter((t) =>
    t.urgency === 'overdue' && (boardFilter === 'all' || t.boardId === boardId)).length;

  // Gruppierte Ansicht (M113): nach Frist-Abschnitten oder nach Person
  const groups = useMemo(() => {
    if (groupByPerson) {
      const by = new Map<string, TaskRef[]>();
      for (const t of tasks) {
        const k = t.who ?? '— ohne Person —';
        by.set(k, [...(by.get(k) ?? []), t]);
      }
      return [...by.entries()].sort((a, b) =>
        (a[0].startsWith('—') ? 1 : 0) - (b[0].startsWith('—') ? 1 : 0) || a[0].localeCompare(b[0]));
    }
    return BUCKETS
      .map(([b, label]) => [label, tasks.filter((t) => bucketOf(t, todayIso) === b)] as [string, TaskRef[]])
      .filter(([, list]) => list.length > 0);
  }, [tasks, groupByPerson, todayIso]);

  const toggleGroup = (name: string) =>
    setCollapsed((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') { t.blur(); return; }
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const complete = (t: TaskRef) => {
    const board = boards.find((b) => b.id === t.boardId);
    const node = board?.nodes.find((n) => n.id === t.nodeId);
    if (!board || !node) return;
    if (t.kind === 'kanban') {
      const k = node.data as KanbanData;
      const item = k.items.find((it) => it.id === t.itemId);
      // Abhängigkeiten & Ticket-Checkliste (M118): erst erledigen, dann abhaken
      if (item) {
        const blk = ticketBlockers(item, k);
        if (blk.length > 0) { showToast(`🔒 Erst erledigen: ${blk.join(' · ')}`); return; }
        if (openSubs(item) > 0) { showToast(`☑ Noch ${openSubs(item)} Checklisten-Punkt(e) im Ticket offen.`); return; }
      }
      logDone(t); // „Heute geschafft"-Protokoll (M114)
      // mitSpalte stempelt das Erledigt-Datum — Uhr der Auto-Archivierung (M293)
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        items: k.items.map((it) => (it.id === t.itemId ? mitSpalte(it, doneCol(k), k) : it)),
      });
      confetti({ particleCount: 45, spread: 50, origin: { y: 0.4 }, scalar: 0.75 });
    } else if (t.kind === 'gantt') {
      logDone(t);
      // Gantt-Vorgang erledigen = Fortschritt auf 100 % (M113)
      const g = node.data as GanttData;
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        rows: g.rows.map((r) => (r.id === t.itemId ? { ...r, progress: 100 } : r)),
      });
      confetti({ particleCount: 45, spread: 50, origin: { y: 0.4 }, scalar: 0.75 });
    } else {
      logDone(t);
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        blocks: toggleCheckBlock(node.data.blocks as unknown[] | undefined, t.itemId),
      });
    }
  };

  /** Fälligkeit direkt in der Liste ändern — Kanban-Frist bzw. Gantt-Ende (T2/M113) */
  const setDue = (t: TaskRef, due: string) => {
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    if (!node) return;
    if (t.kind === 'gantt') {
      if (!due) return; // ein Gantt-Balken braucht immer ein Ende
      const g = node.data as GanttData;
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        rows: g.rows.map((r) => (r.id === t.itemId
          ? { ...r, end: due, start: r.start > due ? due : r.start }
          : r)),
      });
      return;
    }
    const k = node.data as KanbanData;
    updateNodeDataOnBoard(t.boardId, t.nodeId, {
      items: k.items.map((it) => (it.id === t.itemId ? { ...it, due: due || undefined } : it)),
    });
  };

  /** Schlummern (M113): Frist ehrlich verschieben — +1 Tag / +1 Woche */
  const snooze = (t: TaskRef, days: number) => {
    const base = t.due && t.urgency !== 'overdue' ? t.due : todayIso;
    setDue(t, shiftIso(base, days));
  };

  /** Priorität durchschalten (M114): hoch → mittel → niedrig → keine */
  const cyclePrio = (t: TaskRef) => {
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    if (!node || t.kind !== 'kanban') return;
    const k = node.data as KanbanData;
    const next = t.prio === undefined ? 1 : t.prio >= 3 ? undefined : ((t.prio + 1) as 1 | 2 | 3);
    updateNodeDataOnBoard(t.boardId, t.nodeId, {
      items: k.items.map((it) => (it.id === t.itemId ? { ...it, prio: next } : it)),
    });
  };

  /** Kanban-Spalte direkt aus der Liste umstellen (M114) */
  const moveToCol = (t: TaskRef, col: number) => {
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    if (!node || t.kind !== 'kanban') return;
    const k = node.data as KanbanData;
    const item = k.items.find((it) => it.id === t.itemId);
    // Vorwärts gilt die Abhängigkeits-Sperre auch hier (M118)
    if (item && col > item.col) {
      const blk = ticketBlockers(item, k);
      if (blk.length > 0) { showToast(`🔒 Erst erledigen: ${blk.join(' · ')}`); return; }
    }
    if (col >= doneCol(k)) { complete(t); return; } // letzte Spalte = erledigt (inkl. Checklisten-Gate)
    updateNodeDataOnBoard(t.boardId, t.nodeId, {
      items: k.items.map((it) => (it.id === t.itemId ? mitSpalte(it, col, k) : it)),
    });
  };

  /** Kanban-Ticket hinter einer Aufgabe direkt ändern (Detail-Spalte, M115) */
  const patchItem = (t: TaskRef, patch: Record<string, unknown>) => {
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    if (!node || t.kind !== 'kanban') return;
    const k = node.data as KanbanData;
    updateNodeDataOnBoard(t.boardId, t.nodeId, {
      items: k.items.map((it) => (it.id === t.itemId ? { ...it, ...patch } : it)),
    });
  };
  const itemOf = (t: TaskRef) => {
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    return (node?.data as KanbanData | undefined)?.items.find((it) => it.id === t.itemId);
  };

  /** Gantt-Zeile hinter einer Aufgabe ändern (Detail-Spalte, M115) */
  const patchRow = (t: TaskRef, patch: Record<string, unknown>) => {
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    if (!node || t.kind !== 'gantt') return;
    const g = node.data as GanttData;
    updateNodeDataOnBoard(t.boardId, t.nodeId, {
      rows: g.rows.map((r) => (r.id === t.itemId ? { ...r, ...patch } : r)),
    });
  };
  const rowOf = (t: TaskRef) => {
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    return (node?.data as GanttData | undefined)?.rows.find((r) => r.id === t.itemId);
  };

  /** KI-Wochenplan aus den offenen Aufgaben (M115) */
  const planWeek = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    showToast('✨ KI plant die Woche …');
    try {
      showToast(`✨ ${await aiWeekPlan(allTasks, { x: 140, y: 120 })}`);
    } catch (e) {
      showToast(`Wochenplan fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setAiBusy(false);
    }
  };

  /** Spaltennamen des Kanbans hinter einer Aufgabe (für das Spalten-Menü) */
  const colsOf = (t: TaskRef): string[] | null => {
    if (t.kind !== 'kanban') return null;
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    return node ? kanbanCols(node.data as KanbanData) : null;
  };
  const colOf = (t: TaskRef): number => {
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    const k = node?.data as KanbanData | undefined;
    return k?.items.find((it) => it.id === t.itemId)?.col ?? 0;
  };

  /** Schlaue Schnell-Eingabe (T3/M114): „… bis Freitag @Anna #tag !!" */
  const quickAdd = () => {
    if (!quick.trim()) return;
    const parsed = parseQuickTask(quick);
    if (!parsed.text) { showToast('Bitte auch einen Aufgabentext angeben.'); return; }
    const st = useBoard.getState();
    const board = st.boards.find((b) => b.id === (quickBoard || st.activeId)) ?? st.boards[0];
    let kanban = board.nodes.find((n) => n.type === 'kanban') as import('../types').AppNode | undefined;
    if (!kanban) {
      kanban = makeKanban({ x: 140, y: 140 }, 'Aufgaben');
      st.addNodeToBoard(board.id, kanban);
    }
    const k = kanban.data as KanbanData;
    st.updateNodeDataOnBoard(board.id, kanban.id, {
      items: [...k.items, {
        id: uid(), text: parsed.text, col: 0,
        due: parsed.due, who: parsed.who, prio: parsed.prio,
      }],
    });
    setQuick('');
    const extras = [
      parsed.due ? `Frist ${formatDueShort(parsed.due)}` : '',
      parsed.who ? `@${parsed.who}` : '',
      parsed.prio ? `Prio ${PRIO_LABEL[parsed.prio]}` : '',
    ].filter(Boolean).join(' · ');
    showToast(`Aufgabe in „${board.name}" angelegt${extras ? ` (${extras})` : ''}`);
  };

  const jumpTo = (t: TaskRef) => {
    setOpen(false);
    openBoard(t.boardId);
    focusNode(t.boardId, t.nodeId);
  };

  const enableNotifications = async () => {
    try {
      const perm = await Notification.requestPermission();
      showToast(perm === 'granted'
        ? 'Browser-Benachrichtigungen aktiv — Erinnerungen kommen auch als System-Meldung.'
        : 'Benachrichtigungen nicht erlaubt — Erinnerungen erscheinen weiter in der App.');
      tick((n) => n + 1);
    } catch {
      showToast('Dieser Browser unterstützt keine Benachrichtigungen.');
    }
  };

  const exportIcs = () => {
    const n = downloadTasksIcs(tasks);
    showToast(n > 0
      ? `${n} Aufgabe(n) mit Frist als Kalender-Datei exportiert — in Outlook öffnen.`
      : 'Keine Aufgaben mit Fälligkeitsdatum in dieser Ansicht.');
  };

  const canAskNotify = 'Notification' in window && Notification.permission === 'default';

  return (
    <div className={`taskhub${filtersOpen ? ' filters-open' : ''}`} role="dialog" aria-label="Aufgaben">
      <div className="taskhub-head">
        <h2>Aufgaben</h2>
        {/* M231: Der Umfang gehört in den Kopf. Auf schmalen Schirmen liegt die
            Board-Auswahl hinter dem Trichter — ohne diesen Zusatz wüsste man
            nicht, dass gerade nur ein Board gezeigt wird. */}
        <span className="taskhub-meta">
          {tasks.length} angezeigt{boardFilter !== 'all'
            ? ` · ${boardFilter === AKTIV ? aktivName : boards.find((b) => b.id === boardFilter)?.name ?? 'Board'}`
            : ' · alle Boards'}{overdue > 0 ? ` · ${overdue} überfällig` : ''}
        </span>
        <span className="taskhub-actions">
          {canAskNotify && (
            <button onClick={enableNotifications} title="Erinnerungen zusätzlich als System-Benachrichtigung"><IBell size={14} /> Benachrichtigungen</button>
          )}
          {aiReady(ai) && (
            <button disabled={aiBusy} onClick={planWeek} title="KI erstellt aus den offenen Aufgaben ein Wochen-Briefing als Notiz auf dem aktiven Board"><IWand size={14} /><span className="th-label"> Woche planen</span></button>
          )}
          <button onClick={exportIcs} title="Angezeigte Aufgaben mit Frist als .ics (Outlook-Kalender)"><ICalendar size={14} /><span className="th-label"> Kalender-Export</span></button>
          <button className="taskhub-x" onClick={() => setOpen(false)} aria-label="Schließen"><IX size={14} /></button>
        </span>
      </div>

      {/* M207: Gehirn-Puls — was das Gehirn im Wissensnetz sieht */}
      {brainOn && digest.length > 0 && (
        <div className="brain-pulse">
          <button
            className="brain-pulse-head"
            onClick={() => setPulseOpen((o) => { merkePuls(!o); return !o; })}
            aria-expanded={pulseOpen}
            title="Was das Gehirn gerade in deinem Wissensnetz sieht — Themen, Knotenpunkte, fehlende Verknüpfungen"
          >
            🧠 Gehirn-Puls <span className="brain-pulse-count">{digest.length}</span>
            <span className="brain-pulse-caret">{pulseOpen ? '▾' : '▸'}</span>
          </button>
          {pulseOpen && (
            <div className="brain-pulse-body">
              {digest.map((d, i) => (
                <div key={i} className={`brain-pulse-item kind-${d.kind}`}>
                  <button
                    className={`brain-pulse-row kind-${d.kind}`}
                    onClick={() => { if (d.boardId) { setOpen(false); openBoard(d.boardId); } }}
                    title={d.boardId ? 'Zum Board springen' : undefined}
                  >
                    <span className="brain-pulse-kind">
                      {d.kind === 'thema' ? 'Thema' : d.kind === 'knoten' ? 'Knoten' : 'Vorschlag'}
                    </span>
                    <span className="brain-pulse-text">{d.text}</span>
                  </button>
                  {/* M208/M209: Was man mit einer Themen-Insel direkt tun kann */}
                  {d.kind === 'thema' && d.cluster && d.label && (
                    <div className="brain-pulse-acts">
                      <button
                        onClick={() => {
                          const n = applyTopicTag(d.cluster!, d.label!);
                          showToast(n > 0
                            ? `🏷 „thema = ${d.label}" auf ${n} Karte(n) gesetzt — über Strg+K findbar, Strg+Z macht es rückgängig.`
                            : `Alle Karten tragen „thema = ${d.label}" bereits.`);
                        }}
                        title={'Allen Karten dieser Themen-Insel die Eigenschaft „thema" geben — danach über Strg+K und Schwimmbahnen nutzbar'}
                      >
                        🏷 Als Thema markieren
                      </button>
                      <button
                        onClick={() => void makeOverview(d.cluster!, d.label!)}
                        title="Eine Übersichts-Notiz anlegen, die alle Karten dieses Themas bündelt (mit Board-Links und Checkliste)"
                      >
                        📝 Übersichts-Notiz anlegen
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <div className="brain-pulse-foot">
                Rein rechnerisch aus dem semantischen Index — keine KI-Anfrage, keine Kosten.
                Vorschläge lassen sich im Netz annehmen oder ablehnen.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter (T1) — inkl. „Mein Tag"-Fokusliste (M115) */}
      <div className="taskhub-filters">
        {([['all', 'Alle'], ['myday', `☀ Mein Tag${myDay.size > 0 ? ` (${myDay.size})` : ''}`], ['today', 'Heute'], ['overdue', 'Überfällig']] as const).map(([f, label]) => (
          <button key={f} className={`th-chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{label}</button>
        ))}
        {/* M227: Der Trichter existiert nur auf schmalen Schirmen (CSS, kein JS-
            Breakpoint) — am Telefon standen hier fünf Bedienelemente in drei
            Zeilen, bevor die erste Aufgabe zu sehen war. Auf dem Desktop ist
            er ausgeblendet und alles steht wie bisher offen. */}
        <button
          className={`th-chip th-funnel${filtersOpen || versteckteFilter > 0 ? ' on' : ''}`}
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          title={versteckteFilter > 0
            ? `Filter (${versteckteFilter} aktiv): Board, Person, Gruppieren, Suche, #tags`
            : 'Weitere Filter: Board, Person, Gruppieren, Suche, #tags'}
        >
          <IFilter size={13} />
          {versteckteFilter > 0 && <span className="th-funnel-n">{versteckteFilter}</span>}
        </button>
        {/* M231: Reihenfolge ist Absicht — erst das aktive Board (Voreinstellung),
            dann alle, dann die einzelnen. Der häufigste Fall steht oben. */}
        <select className="th-board th-adv" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)} title="Nach Board filtern">
          <option value={AKTIV}>Aktives Board — {aktivName}</option>
          <option value="all">Auf allen Boards</option>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {persons.length > 0 && (
          <select className="th-board th-adv" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} title="Nach Person filtern (Ticket-Zuständigkeit / Gantt-Ressource)">
            <option value="all">Alle Personen</option>
            {persons.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {persons.length > 0 && (
          <button
            className={`th-chip th-adv ${groupByPerson ? 'on' : ''}`}
            onClick={() => setGroupByPerson((g) => !g)}
            title="Nach Person gruppieren — wer macht was?"
          ><IUsers size={13} /></button>
        )}
      </div>

      {/* Suche + #Tag-Filter (M114) */}
      <div className="taskhub-filters th-searchrow">
        <span className="th-search">
          <ISearch size={13} />
          <input
            placeholder="In Aufgaben suchen …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </span>
        {tags.map((tag) => (
          <button
            key={tag}
            className={`th-chip ${tagFilter === tag ? 'on' : ''}`}
            onClick={() => setTagFilter((t) => (t === tag ? null : tag))}
            title={`Nur Aufgaben mit #${tag}`}
          >#{tag}</button>
        ))}
      </div>

      {/* Schlaue Schnell-Eingabe (T3/M114) */}
      <div className="taskhub-quickrow">
        <input
          className="taskhub-quick"
          placeholder={'Neue Aufgabe … — versteht „bis Freitag", @Person, #tag und !/!!/!!! als Priorität'}
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && quickAdd()}
        />
        <select
          className="th-board th-quickboard"
          value={quickBoard}
          onChange={(e) => setQuickBoard(e.target.value)}
          title="Ziel-Board der Schnell-Eingabe"
        >
          <option value="">→ aktives Board</option>
          {boards.map((b) => <option key={b.id} value={b.id}>→ {b.name}</option>)}
        </select>
      </div>

      {tasks.length === 0 ? (
        <div className="taskhub-empty">
          {filter === 'all' && boardFilter === 'all'
            ? 'Nichts offen! Neue Aufgaben entstehen aus Kanban-Tickets und Checklisten in Notizen — oder oben per Schnell-Eingabe.'
            : filter === 'all' && boardFilter === AKTIV && allTasks.length > 0
              // M231: Der häufigste Leerfall seit der neuen Voreinstellung —
              // hier ist nichts, anderswo schon. Das gehört dazugesagt.
              ? `Auf „${aktivName}" ist nichts offen. Über die Board-Auswahl siehst du alle Boards (${allTasks.length} Aufgaben).`
              : 'Keine Aufgaben in dieser Ansicht.'}
        </div>
      ) : (
        <div className="taskhub-list">
          {groups.map(([name, list]) => (
            <section key={name} className="th-group">
              <button className="th-group-head" onClick={() => toggleGroup(name)} aria-expanded={!collapsed.has(name)}>
                <span className="th-group-caret">{collapsed.has(name) ? '▸' : '▾'}</span>
                {name}
                <span className="th-group-count">{list.length}</span>
              </button>
              {!collapsed.has(name) && (
                <ul>
                  {list.map((t) => {
                    const open = expandedKey === t.key;
                    return (
                      <li key={t.key} className={`task-row urgency-${t.urgency} ${open ? 'open' : ''}`}>
                        {/* Kompakte Hauptzeile (M116): Klick klappt die Werkzeuge auf */}
                        <div
                          className="task-main"
                          role="button"
                          aria-expanded={open}
                          title={open ? 'Werkzeuge einklappen' : 'Antippen für Werkzeuge (Frist, Spalte, Mein Tag …)'}
                          onClick={() => setExpandedKey(open ? null : t.key)}
                        >
                          <input
                            type="checkbox"
                            title={t.kind === 'gantt' ? 'Erledigt (Fortschritt 100 %)' : 'Erledigt'}
                            onChange={() => complete(t)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`„${t.text}" erledigen`}
                          />
                          <span className="task-kind">
                            {t.kind === 'kanban' ? <IKanban size={13} /> : t.kind === 'gantt' ? <IGantt size={13} /> : <INote size={13} />}
                          </span>
                          <span className="task-text">
                            {t.prio && <b className={`task-prio-mark prio-${t.prio}`}>{PRIO_LABEL[t.prio]} </b>}
                            {t.text}
                          </span>
                          {myDay.has(t.key) && <span className="task-myday-mark" title={'In „Mein Tag" vorgenommen'}>☀</span>}
                          {t.who && !groupByPerson && <span className="task-who" title="Zuständig">{t.who}</span>}
                          {t.due && <span className={`task-due urgency-${t.urgency}`}>{formatDueShort(t.due)}</span>}
                          <span className="task-board">{t.boardName}</span>
                          <span className="task-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
                        </div>

                        {/* Aufgeklappte Werkzeugleiste (M116) */}
                        {open && (
                          <div className="task-tools">
                            {t.kind === 'kanban' && (() => {
                              const cols = colsOf(t);
                              if (!cols) return null;
                              return (
                                <select
                                  className="task-col"
                                  value={colOf(t)}
                                  title="Kanban-Spalte umstellen"
                                  onChange={(e) => moveToCol(t, Number(e.target.value))}
                                >
                                  {cols.map((c, i) => <option key={i} value={i}>{c}</option>)}
                                </select>
                              );
                            })()}
                            {(t.kind === 'kanban' || t.kind === 'gantt') && (
                              <input
                                type="date"
                                className={`task-due-input urgency-${t.urgency}`}
                                value={t.due ?? ''}
                                title={t.kind === 'gantt' ? 'Ende des Vorgangs ändern' : 'Fälligkeit ändern'}
                                onChange={(e) => setDue(t, e.target.value)}
                              />
                            )}
                            {(t.kind === 'kanban' || t.kind === 'gantt') && (
                              <span className="task-snooze" role="group" aria-label="Schlummern">
                                <button title="Um 1 Tag verschieben" onClick={() => snooze(t, 1)}>+1T</button>
                                <button title="Um 1 Woche verschieben" onClick={() => snooze(t, 7)}>+1W</button>
                              </span>
                            )}
                            {t.kind === 'kanban' && (
                              <button
                                className={`task-prio prio-${t.prio ?? 0}`}
                                title={t.prio ? `Priorität ${t.prio === 1 ? 'hoch' : t.prio === 2 ? 'mittel' : 'niedrig'} — Klick schaltet weiter` : 'Priorität setzen (Klick: hoch → mittel → niedrig → keine)'}
                                onClick={() => cyclePrio(t)}
                              >{t.prio ? PRIO_LABEL[t.prio] : '!'}</button>
                            )}
                            <button
                              className={`task-myday ${myDay.has(t.key) ? 'on' : ''}`}
                              title={myDay.has(t.key) ? 'Aus „Mein Tag" entfernen' : 'Für heute vornehmen („Mein Tag")'}
                              onClick={() => setMyDay(new Set(toggleMyDay(t.key)))}
                            >Mein Tag</button>
                            <span className="task-board task-board-tools">{t.boardName}</span>
                            <button className="task-jump" title="Zur Karte auf dem Board springen" onClick={() => jumpTo(t)}>↗ Karte</button>
                            <button
                              className={`task-detail-btn ${detailKey === t.key ? 'on' : ''}`}
                              title="Details bearbeiten (rechte Spalte)"
                              onClick={() => setDetailKey(detailKey === t.key ? null : t.key)}
                            ><IChevronR size={13} /> Details</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      {/* „Heute geschafft" (M114): Erledigt-Protokoll + Wochen-Balken */}
      {(() => {
        const log = doneLog();
        const today = log.filter((e) => e.d === todayIso);
        const week = [...Array(7)].map((_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i));
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          return { iso, n: log.filter((e) => e.d === iso).length, label: d.toLocaleDateString('de-DE', { weekday: 'short' }) };
        });
        const max = Math.max(1, ...week.map((w) => w.n));
        if (log.length === 0) return null;
        return (
          <section className="th-done">
            <button className="th-group-head" onClick={() => setDoneOpen((o) => !o)} aria-expanded={doneOpen}>
              <span className="th-group-caret">{doneOpen ? '▾' : '▸'}</span>
              Heute geschafft
              <span className="th-group-count">{today.length}</span>
              <span className="th-week" title="Erledigte Aufgaben der letzten 7 Tage" aria-hidden="true">
                {week.map((w) => (
                  <span key={w.iso} className="th-week-bar" title={`${w.label}: ${w.n}`}>
                    <i style={{ height: `${Math.round((w.n / max) * 100)}%` }} className={w.iso === todayIso ? 'today' : ''} />
                  </span>
                ))}
              </span>
            </button>
            {doneOpen && (
              today.length === 0
                ? <div className="th-done-empty">Heute noch nichts abgehakt — die Woche zeigt die letzten 7 Tage.</div>
                : (
                  <ul>
                    {today.slice(-30).reverse().map((e, i) => (
                      <li key={i} className="task-row th-done-row">
                        <span className="th-done-check">✓</span>
                        <span className="task-text">{e.text}</span>
                        <span className="task-board">{e.board}</span>
                      </li>
                    ))}
                  </ul>
                )
            )}
          </section>
        );
      })()}

      <div className="taskhub-foot">
        Fällige Aufgaben melden sich beim Öffnen der App und danach regelmäßig als Erinnerung.
      </div>

      {/* Detail-Spalte (M115): Aufgabe direkt hier bearbeiten */}
      {detailTask && (() => {
        const t = detailTask;
        const item = t.kind === 'kanban' ? itemOf(t) : undefined;
        const row = t.kind === 'gantt' ? rowOf(t) : undefined;
        return (
          <aside className="th-detail" aria-label="Aufgaben-Details">
            <div className="th-detail-head">
              <span className="task-kind">
                {t.kind === 'kanban' ? <IKanban size={14} /> : t.kind === 'gantt' ? <IGantt size={14} /> : <INote size={14} />}
              </span>
              <b>{t.kind === 'kanban' ? 'Ticket' : t.kind === 'gantt' ? 'Zeitplan-Vorgang' : 'Checklisten-Punkt'}</b>
              <button className="taskhub-x" onClick={() => setDetailKey(null)} aria-label="Details schließen"><IX size={13} /></button>
            </div>

            {t.kind === 'kanban' && item ? (
              <>
                <label className="th-field"><span>Titel</span>
                  <input value={item.text} onChange={(e) => patchItem(t, { text: e.target.value })} />
                </label>
                <label className="th-field"><span>Beschreibung</span>
                  <textarea
                    rows={4}
                    placeholder="Details, Kontext, nächste Schritte …"
                    value={item.note ?? ''}
                    onChange={(e) => patchItem(t, { note: e.target.value || undefined })}
                  />
                </label>
                <label className="th-field"><span>Person</span>
                  <input placeholder="z. B. Anna" value={item.who ?? ''} onChange={(e) => patchItem(t, { who: e.target.value || undefined })} />
                </label>
                <label className="th-field"><span>Fälligkeit</span>
                  <input type="date" value={item.due ?? ''} onChange={(e) => patchItem(t, { due: e.target.value || undefined })} />
                </label>
                <div className="th-field"><span>Priorität</span>
                  <div className="th-prio-row">
                    {([['1', '!!! hoch'], ['2', '!! mittel'], ['3', '! niedrig'], ['', 'keine']] as const).map(([v, label]) => (
                      <button
                        key={v || 'none'}
                        className={`th-chip ${String(item.prio ?? '') === v ? 'on' : ''}`}
                        onClick={() => patchItem(t, { prio: v ? (Number(v) as 1 | 2 | 3) : undefined })}
                      >{label}</button>
                    ))}
                  </div>
                </div>
              </>
            ) : t.kind === 'gantt' && row ? (
              <>
                <label className="th-field"><span>Vorgang</span>
                  <input value={row.name} onChange={(e) => patchRow(t, { name: e.target.value })} />
                </label>
                <label className="th-field"><span>Person/Ressource</span>
                  <input placeholder="z. B. Anna" value={row.who ?? ''} onChange={(e) => patchRow(t, { who: e.target.value || undefined })} />
                </label>
                <div className="th-field th-field-2col">
                  <label><span>Start</span>
                    <input type="date" value={row.start} onChange={(e) => e.target.value && patchRow(t, { start: e.target.value, end: row.end < e.target.value ? e.target.value : row.end })} />
                  </label>
                  <label><span>Ende</span>
                    <input type="date" value={row.end} onChange={(e) => e.target.value && patchRow(t, { end: e.target.value, start: row.start > e.target.value ? e.target.value : row.start })} />
                  </label>
                </div>
                <label className="th-field"><span>Fortschritt: {row.progress ?? 0} %</span>
                  <input type="range" min={0} max={100} step={5} value={row.progress ?? 0} onChange={(e) => patchRow(t, { progress: Number(e.target.value) })} />
                </label>
              </>
            ) : (
              <p className="th-detail-hint">
                Checklisten-Punkte werden direkt in ihrer Notiz bearbeitet — unten zur Karte springen.
                Erkannte Frist: {t.due ? formatDueShort(t.due) : 'keine'}.
              </p>
            )}

            <div className="th-detail-foot">
              <span className="task-board">{t.boardName}</span>
              <button className="th-chip" onClick={() => jumpTo(t)}>Zur Karte springen ↗</button>
            </div>
          </aside>
        );
      })()}
    </div>
  );
}
