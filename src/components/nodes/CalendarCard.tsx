import { useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { CalendarData, CalendarNode, GanttData } from '../../types';
import { collectTasks } from '../../lib/tasks';
import { CardShell } from './CardShell';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

interface CalEntry {
  icon: string;
  text: string;
  boardId: string;
  nodeId: string;
  color?: string;
  urgent?: boolean;
}

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Kalender-Karte: Monatsraster (Mo–So) mit allen Terminen aus ALLEN Boards —
 * Kanban-Fristen und Zeitplan-Vorgänge (Start/Meilenstein). Klick auf einen
 * Eintrag springt zur Karte. ‹ heute › blättert durch die Monate.
 */
export function CalendarBody({ id, data }: { id: string; data: CalendarData }) {
  const boards = useBoard((s) => s.boards);
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const presenting = useBoard((s) => s.presenting);
  const setPresenting = useBoard((s) => s.setPresenting);

  const now = new Date();
  const ym = data.month ?? ymOf(now);
  const [year, month] = ym.split('-').map(Number);

  // Einträge pro Tag (yyyy-mm-dd) einsammeln
  const byDay = useMemo(() => {
    const map = new Map<string, CalEntry[]>();
    const push = (day: string, e: CalEntry) => {
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(e);
    };
    // Kanban-Fristen (offene Tickets)
    for (const t of collectTasks(boards)) {
      if (t.due) push(t.due, { icon: '📋', text: t.text, boardId: t.boardId, nodeId: t.nodeId, urgent: t.urgency === 'overdue' });
    }
    // Zeitplan-Vorgänge: Meilenstein am Tag, Balken am Start-Tag
    for (const b of boards) {
      for (const n of b.nodes) {
        if (n.type !== 'gantt') continue;
        for (const r of (n.data as GanttData).rows) {
          push(r.start, { icon: r.start === r.end ? '◆' : '▬', text: r.name, boardId: b.id, nodeId: n.id, color: r.color });
        }
      }
    }
    return map;
  }, [boards]);

  const nav = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    updateNodeData(id, { month: ymOf(d) });
  };

  const jump = (e: CalEntry) => {
    if (presenting) setPresenting(false);
    openBoard(e.boardId);
    focusNode(e.boardId, e.nodeId);
  };

  // 6 Wochen à 7 Tage, Montag-basiert
  const first = new Date(year, month - 1, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const todayIso = new Date().toISOString().slice(0, 10);
  const monthLabel = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month - 1, i - startOffset + 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { iso, day: d.getDate(), inMonth: d.getMonth() === month - 1, entries: byDay.get(iso) ?? [] };
  });

  return (
    <div className="cal-body">
      <div className="cal-head nodrag">
        <span className="cal-title">🗓️ {monthLabel}</span>
        <span className="cal-nav">
          <button onClick={() => nav(-1)} title="Voriger Monat">‹</button>
          <button onClick={() => updateNodeData(id, { month: undefined })} title="Zum aktuellen Monat">heute</button>
          <button onClick={() => nav(1)} title="Nächster Monat">›</button>
        </span>
      </div>
      <div className="cal-grid nodrag nowheel">
        {WEEKDAYS.map((w) => <div key={w} className="cal-dow">{w}</div>)}
        {cells.map((c) => (
          <div key={c.iso} className={`cal-cell ${c.inMonth ? '' : 'out'} ${c.iso === todayIso ? 'today' : ''}`}>
            <span className="cal-daynum">{c.day}</span>
            {c.entries.slice(0, 3).map((e, i) => (
              <button
                key={i}
                className={`cal-chip ${e.urgent ? 'urgent' : ''}`}
                style={e.color ? { borderLeftColor: e.color } : undefined}
                title={`${e.text} — zur Karte springen`}
                onClick={() => jump(e)}
              >
                {e.icon} {e.text}
              </button>
            ))}
            {c.entries.length > 3 && <span className="cal-more">+{c.entries.length - 3}</span>}
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
