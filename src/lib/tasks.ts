// Aufgaben-Zentrale: sammelt alle offenen Aufgaben über ALLE Boards ein —
// Kanban-Tickets (nicht-erledigte Spalten) und unerledigte Checklisten-Punkte
// aus Notizen. Dazu Fälligkeits-Logik, Erinnerungs-Merkliste und Sammel-ICS.
import type { BoardDoc } from '../store';
import { doneCol, type KanbanData } from '../types';
import { triggerDownload } from './download';

export type TaskUrgency = 'none' | 'ok' | 'soon' | 'overdue';

export interface TaskRef {
  /** stabil & eindeutig — auch Schlüssel für „schon erinnert" */
  key: string;
  kind: 'kanban' | 'check';
  boardId: string;
  boardName: string;
  nodeId: string;
  /** Kanban-Item-ID bzw. BlockNote-Block-ID */
  itemId: string;
  text: string;
  due?: string;
  urgency: TaskUrgency;
}

interface AnyBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: AnyBlock[];
}

function inlineText(content: unknown): string {
  if (typeof content === 'string') return content; // Seed-Daten nutzen die Kurzform
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (typeof c === 'object' && c && 'text' in c ? String((c as { text: unknown }).text) : ''))
    .join('');
}

export function urgencyFor(due: string | undefined, now: Date = new Date()): TaskUrgency {
  if (!due) return 'none';
  const d = new Date(`${due}T23:59:59`);
  if (Number.isNaN(d.getTime())) return 'none';
  const diffH = (d.getTime() - now.getTime()) / 36e5;
  if (diffH < 0) return 'overdue';
  if (diffH < 48) return 'soon';
  return 'ok';
}

export function formatDueShort(due: string, now: Date = new Date()): string {
  const d = new Date(`${due}T12:00:00`);
  if (Number.isNaN(d.getTime())) return due;
  const days = Math.round((d.setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
  const dateStr = new Date(`${due}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  if (days < 0) return `${dateStr} · überfällig!`;
  if (days === 0) return `${dateStr} · heute`;
  if (days === 1) return `${dateStr} · morgen`;
  return `${dateStr} · in ${days} T.`;
}

/** Alle offenen Aufgaben aus allen Boards, sortiert: überfällig → bald → Datum → Rest */
export function collectTasks(boards: BoardDoc[], now: Date = new Date()): TaskRef[] {
  const out: TaskRef[] = [];
  for (const board of boards) {
    for (const node of board.nodes) {
      if (node.type === 'kanban') {
        const k = node.data as KanbanData;
        const done = doneCol(k);
        for (const item of k.items) {
          if (Math.min(item.col, done) >= done) continue;
          // Eingesammelte Kopien (Auto-Sammler) nicht als eigene Aufgaben zählen —
          // sonst füttern sich zwei Sammler gegenseitig und die Aufgaben-Zentrale
          // zeigt Duplikate (Audit R6-S7)
          if (item.link?.itemId) continue;
          out.push({
            key: `k:${board.id}:${node.id}:${item.id}`,
            kind: 'kanban',
            boardId: board.id,
            boardName: board.name,
            nodeId: node.id,
            itemId: item.id,
            text: item.text,
            due: item.due,
            urgency: urgencyFor(item.due, now),
          });
        }
      } else if (node.type === 'note') {
        // Blöcke ohne id (Seed-Daten) werden über ihren Positionspfad adressiert
        const walk = (blocks: AnyBlock[] | undefined, prefix: string) => {
          (blocks ?? []).forEach((b, i) => {
            const path = prefix ? `${prefix}.${i}` : String(i);
            if (b.type === 'checkListItem' && !b.props?.checked) {
              const text = inlineText(b.content).trim();
              if (text) {
                const itemId = b.id ?? `pos:${path}`;
                out.push({
                  key: `c:${board.id}:${node.id}:${itemId}`,
                  kind: 'check',
                  boardId: board.id,
                  boardName: board.name,
                  nodeId: node.id,
                  itemId,
                  text,
                  urgency: 'none',
                });
              }
            }
            walk(b.children, path);
          });
        };
        walk(node.data.blocks as AnyBlock[] | undefined, '');
      }
    }
  }
  const rank: Record<TaskUrgency, number> = { overdue: 0, soon: 1, ok: 2, none: 3 };
  return out.sort((a, b) =>
    rank[a.urgency] - rank[b.urgency]
    || (a.due ?? '9999').localeCompare(b.due ?? '9999')
    || a.boardName.localeCompare(b.boardName),
  );
}

/** Checklisten-Block per ID oder Positionspfad (`pos:2.0`) abhaken — liefert neuen Block-Baum */
export function toggleCheckBlock(blocks: unknown[] | undefined, blockId: string): unknown[] | undefined {
  if (!blocks) return blocks;
  const byPos = blockId.startsWith('pos:') ? blockId.slice(4) : null;
  const walk = (bs: AnyBlock[], prefix: string): AnyBlock[] =>
    bs.map((b, i) => {
      const path = prefix ? `${prefix}.${i}` : String(i);
      const next: AnyBlock = { ...b };
      const hit = byPos ? path === byPos : b.id === blockId;
      if (hit && b.type === 'checkListItem') {
        next.props = { ...b.props, checked: !b.props?.checked };
      }
      if (b.children?.length) next.children = walk(b.children, path);
      return next;
    });
  return walk(blocks as AnyBlock[], '');
}

// ---------- Erinnerungen: pro Aufgabe+Fälligkeit nur einmal melden ----------
const REMINDED_KEY = 'pixinotes:reminded';

function remindedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(REMINDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** Fällige (heute/überfällige) Aufgaben, an die noch nicht erinnert wurde — und gleich vormerken */
export function dueTasksToRemind(tasks: TaskRef[]): TaskRef[] {
  const done = remindedSet();
  const hits = tasks.filter((t) => {
    if (t.urgency !== 'overdue' && !(t.due && urgencyFor(t.due) !== 'none' && formatDueShort(t.due).includes('heute'))) return false;
    return !done.has(`${t.key}|${t.due}`);
  });
  if (hits.length) {
    for (const t of hits) done.add(`${t.key}|${t.due}`);
    localStorage.setItem(REMINDED_KEY, JSON.stringify([...done].slice(-200)));
  }
  return hits;
}

/** Optional: echte Browser-Benachrichtigung (falls erlaubt) — Toast gibt es immer */
export function notifyBrowser(title: string, body: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch { /* z. B. file:// ohne Support — Toast reicht */ }
}

// ---------- Sammel-Export: alle Fristen als Kalender ----------
export function downloadTasksIcs(tasks: TaskRef[]): number {
  const withDue = tasks.filter((t) => t.due);
  if (withDue.length === 0) return 0;
  const fmt = (iso: string) => iso.replace(/-/g, '');
  const events = withDue.map((t) => [
    'BEGIN:VEVENT',
    `UID:${t.key}@pixinotes`,
    `DTSTART;VALUE=DATE:${fmt(t.due!)}`,
    `SUMMARY:${t.text.replace(/[\n,;]/g, ' ')} (${t.boardName.replace(/[\n,;]/g, ' ')})`,
    'BEGIN:VALARM',
    'TRIGGER:-PT9H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${t.text.replace(/[\n,;]/g, ' ')}`,
    'END:VALARM',
    'END:VEVENT',
  ].join('\r\n'));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PixiNotes//DE', ...events, 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  triggerDownload(url, 'pixinotes-aufgaben.ics');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return withDue.length;
}
