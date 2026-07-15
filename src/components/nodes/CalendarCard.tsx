import { useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { CalendarData, CalendarNode, GanttData } from '../../types';
import { collectTasks } from '../../lib/tasks';
import { IChevronL, IChevronR } from '../Icons';
import { CardShell } from './CardShell';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY = 864e5;

interface CalEntry {
  icon: string;
  text: string;
  boardId: string;
  nodeId: string;
  color?: string;
  urgent?: boolean;
}
interface CalStrip {
  text: string;
  color: string;
  boardId: string;
  nodeId: string;
  startsHere: boolean;
}

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Kalender-Karte: Monats- ODER Wochenansicht mit allen Terminen aus den
 * Boards — Kanban-Fristen als Einträge, Zeitplan-Vorgänge als Laufzeit-
 * Streifen über die komplette Dauer. Filter: alle Boards / nur dieses.
 * Klick springt zur Quell-Karte.
 */
export function CalendarBody({ id, data }: { id: string; data: CalendarData }) {
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const presenting = useBoard((s) => s.presenting);
  const setPresenting = useBoard((s) => s.setPresenting);

  const view = (data.view as 'month' | 'week') ?? 'month';
  const scope = (data.scope as 'all' | 'board') ?? 'all';
  const sourceBoards = scope === 'board' ? boards.filter((b) => b.id === activeId) : boards;

  const todayIso = isoOf(new Date());
  const ym = (data.month as string) ?? ymOf(new Date());
  const [year, month] = ym.split('-').map(Number);
  // Wochenansicht ankert auf einem beliebigen Datum (Montag der Woche wird berechnet)
  const anchorIso = (data.anchor as string) ?? todayIso;

  // Punkt-Einträge (Fristen) und Laufzeit-Streifen (Gantt) pro Tag
  const { byDay, stripsByDay } = useMemo(() => {
    const byDay = new Map<string, CalEntry[]>();
    const stripsByDay = new Map<string, CalStrip[]>();
    const push = <T,>(m: Map<string, T[]>, k: string, v: T) => {
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(v);
    };
    for (const t of collectTasks(sourceBoards)) {
      if (t.due) push(byDay, t.due, { icon: '☐', text: t.text, boardId: t.boardId, nodeId: t.nodeId, urgent: t.urgency === 'overdue' });
    }
    for (const b of sourceBoards) {
      for (const n of b.nodes) {
        if (n.type !== 'gantt') continue;
        for (const r of (n.data as GanttData).rows) {
          if (r.start === r.end) {
            push(byDay, r.start, { icon: '◆', text: r.name, boardId: b.id, nodeId: n.id, color: r.color });
          } else {
            // Laufzeit-Streifen über JEDEN Tag der Dauer (K1) — UTC-rein, sonst 1-Tag-Versatz
            const dayOf = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
            const s = dayOf(r.start);
            const e = dayOf(r.end);
            for (let d = s; d <= e && d - s < 120; d++) {
              push(stripsByDay, new Date(d * DAY).toISOString().slice(0, 10), {
                text: r.name, color: r.color ?? '#4f7cff', boardId: b.id, nodeId: n.id, startsHere: d === s,
              });
            }
          }
        }
      }
    }
    return { byDay, stripsByDay };
  }, [sourceBoards]);

  const nav = (delta: number) => {
    if (view === 'week') {
      const a = new Date(`${anchorIso}T12:00:00`);
      updateNodeData(id, { anchor: isoOf(new Date(a.getTime() + delta * 7 * DAY)) });
    } else {
      const d = new Date(year, month - 1 + delta, 1);
      updateNodeData(id, { month: ymOf(d) });
    }
  };

  const jump = (boardId: string, nodeId: string) => {
    if (presenting) setPresenting(false);
    openBoard(boardId);
    focusNode(boardId, nodeId);
  };

  // Zellen berechnen: Monat = 6×7-Raster, Woche = 7 Tage ab Montag
  let cells: Array<{ iso: string; day: number; inMonth: boolean }>;
  let title: string;
  if (view === 'week') {
    const a = new Date(`${anchorIso}T12:00:00`);
    const mondayT = a.getTime() - ((a.getDay() + 6) % 7) * DAY;
    cells = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mondayT + i * DAY);
      return { iso: isoOf(d), day: d.getDate(), inMonth: true };
    });
    const mo = new Date(mondayT);
    const so = new Date(mondayT + 6 * DAY);
    title = `${mo.getDate()}.${mo.getMonth() + 1}. – ${so.getDate()}.${so.getMonth() + 1}.${so.getFullYear()}`;
  } else {
    const first = new Date(year, month - 1, 1);
    const startOffset = (first.getDay() + 6) % 7;
    cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(year, month - 1, i - startOffset + 1);
      return { iso: isoOf(d), day: d.getDate(), inMonth: d.getMonth() === month - 1 };
    });
    title = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }

  const maxEntries = view === 'week' ? 8 : 3;

  return (
    <div className="cal-body">
      <div className="cal-head nodrag">
        <span className="cal-title">{title}</span>
        <span className="cal-nav">
          <button
            className={scope === 'board' ? 'on' : ''}
            onClick={() => updateNodeData(id, { scope: scope === 'all' ? 'board' : 'all' })}
            title={scope === 'all' ? 'Zeigt: alle Boards — Klick: nur dieses Board' : 'Zeigt: nur dieses Board — Klick: alle Boards'}
          >
            {scope === 'all' ? 'Alle Boards' : 'Dieses Board'}
          </button>
          <button
            onClick={() => updateNodeData(id, { view: view === 'month' ? 'week' : 'month', anchor: todayIso })}
            title="Monats-/Wochenansicht umschalten"
          >
            {view === 'month' ? 'Woche' : 'Monat'}
          </button>
          <button onClick={() => nav(-1)} title="Zurück" aria-label="Zurück"><IChevronL size={13} /></button>
          <button onClick={() => updateNodeData(id, { month: undefined, anchor: undefined })} title="Zu heute">heute</button>
          <button onClick={() => nav(1)} title="Weiter" aria-label="Weiter"><IChevronR size={13} /></button>
        </span>
      </div>
      <div className={`cal-grid nodrag nowheel ${view === 'week' ? 'week' : ''}`}>
        {WEEKDAYS.map((w) => <div key={w} className="cal-dow">{w}</div>)}
        {cells.map((c) => (
          <div key={c.iso} className={`cal-cell ${c.inMonth ? '' : 'out'} ${c.iso === todayIso ? 'today' : ''}`}>
            <span className="cal-daynum">{c.day}</span>
            {(stripsByDay.get(c.iso) ?? []).slice(0, 3).map((s, i) => (
              <button
                key={`s${i}`}
                className="cal-strip"
                style={{ background: s.color }}
                title={`${s.text} — zur Karte springen`}
                onClick={() => jump(s.boardId, s.nodeId)}
              >
                {s.startsHere || cells[0].iso === c.iso ? s.text : ' '}
              </button>
            ))}
            {(byDay.get(c.iso) ?? []).slice(0, maxEntries).map((e, i) => (
              <button
                key={i}
                className={`cal-chip ${e.urgent ? 'urgent' : ''}`}
                style={e.color ? { borderLeftColor: e.color } : undefined}
                title={`${e.text} — zur Karte springen`}
                onClick={() => jump(e.boardId, e.nodeId)}
              >
                {e.icon} {e.text}
              </button>
            ))}
            {(byDay.get(c.iso)?.length ?? 0) > maxEntries && (
              <span className="cal-more">+{byDay.get(c.iso)!.length - maxEntries}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Kalender als Karte auf dem Whiteboard. */
export function CalendarCard({ id, data, selected }: NodeProps<CalendarNode>) {
  return (
    <CardShell id={id} selected={selected} minWidth={340} minHeight={280} className="cal-card">
      <CalendarBody id={id} data={data} />
    </CardShell>
  );
}
