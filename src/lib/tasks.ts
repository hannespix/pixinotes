// Aufgaben-Zentrale: sammelt alle offenen Aufgaben über ALLE Boards ein —
// Kanban-Tickets (nicht-erledigte Spalten), unerledigte Checklisten-Punkte
// aus Notizen und laufende Gantt-Vorgänge (M113). Dazu Fälligkeits-Logik,
// Erinnerungs-Merkliste und Sammel-ICS.
import type { BoardDoc } from '../store';
import { doneCol, type GanttData, type KanbanData } from '../types';
import { detectDates } from './dates';
import { triggerDownload } from './download';

export type TaskUrgency = 'none' | 'ok' | 'soon' | 'overdue';

export interface TaskRef {
  /** stabil & eindeutig — auch Schlüssel für „schon erinnert" */
  key: string;
  kind: 'kanban' | 'check' | 'gantt';
  boardId: string;
  boardName: string;
  nodeId: string;
  /** Kanban-Item-ID, BlockNote-Block-ID bzw. Gantt-Zeilen-ID */
  itemId: string;
  text: string;
  due?: string;
  urgency: TaskUrgency;
  /** Verantwortliche Person (Kanban „who" / Gantt-Ressource) — M113 */
  who?: string;
  /** Priorität (nur Kanban, M114): 1 = hoch, 2 = mittel, 3 = niedrig */
  prio?: 1 | 2 | 3;
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

/** M182: Spalten-Vermerk des Rück-Syncs „(→ Spalte)" am Textende — muss beim
 *  Einsammeln/Text-Folgen wieder RAUS, sonst schwappt der eigene Vermerk als
 *  Textänderung ins Ticket zurück (Echo). */
const STATUS_MARK = /\s*\(→ [^)]{0,40}\)\s*$/;
export function stripStatusMark(text: string): string {
  return text.replace(STATUS_MARK, '');
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

/** ISO-Datum (lokal) aus einem Date — toISOString() würde per UTC den Tag verschieben */
export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO-Datum um N Tage verschieben (Schlummern, M113) */
export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return isoLocal(d);
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
      // Archivierte Karten gelten als erledigt: ihre Aufgaben tauchen weder in
      // der Aufgaben-Zentrale noch in Erinnerungen oder Sammel-Kanbans auf (M87)
      if (node.archived) continue;
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
            who: item.who?.trim() || undefined,
            prio: item.prio,
          });
        }
      } else if (node.type === 'gantt') {
        // Gantt-Vorgänge (M113): alles unter 100 % ist eine offene Aufgabe,
        // Frist = Ende des Balkens, Person = Ressource
        const g = node.data as GanttData;
        for (const row of g.rows ?? []) {
          if ((row.progress ?? 0) >= 100) continue;
          if (!row.name?.trim()) continue;
          out.push({
            key: `g:${board.id}:${node.id}:${row.id}`,
            kind: 'gantt',
            boardId: board.id,
            boardName: board.name,
            nodeId: node.id,
            itemId: row.id,
            text: row.name,
            due: row.end,
            urgency: urgencyFor(row.end, now),
            who: row.who?.trim() || undefined,
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
                // Fristen-Erkennung (M113): „bis Freitag", „am 24.07." usw. im
                // Text zählen als Fälligkeit — wie bei den Fristen-Chips (M3)
                const detected = detectDates(text, now)[0];
                const due = detected ? isoLocal(detected.date) : undefined;
                out.push({
                  key: `c:${board.id}:${node.id}:${itemId}`,
                  kind: 'check',
                  boardId: board.id,
                  boardName: board.name,
                  nodeId: node.id,
                  itemId,
                  text,
                  due,
                  urgency: urgencyFor(due, now),
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
  return sortTasks(out);
}

function sortTasks(out: TaskRef[]): TaskRef[] {
  const rank: Record<TaskUrgency, number> = { overdue: 0, soon: 1, ok: 2, none: 3 };
  return out.sort((a, b) =>
    rank[a.urgency] - rank[b.urgency]
    || (a.prio ?? 9) - (b.prio ?? 9) // Priorität schlägt Datum innerhalb der Dringlichkeit (M114)
    || (a.due ?? '9999').localeCompare(b.due ?? '9999')
    || a.boardName.localeCompare(b.boardName),
  );
}

/**
 * M182: LISTEN-Punkte (Aufzählung/Nummerierung) einer Notiz als Aufgaben —
 * gedacht für per Pfeil VERBUNDENE Notizen (Kanban-Abo): Die Verbindung
 * erklärt die ganze Notiz zum Aufgaben-Lieferanten, nicht nur ihre
 * Checklisten. Bewusst NICHT Teil von collectTasks: global würde jede
 * Aufzählung in jeder Notiz die Aufgaben-Zentrale fluten.
 */
export function collectListTasks(
  board: Pick<BoardDoc, 'id' | 'name'>,
  node: { id: string; archived?: boolean; data: Record<string, unknown> },
  now: Date = new Date(),
): TaskRef[] {
  const out: TaskRef[] = [];
  if (node.archived) return out;
  const walk = (blocks: AnyBlock[] | undefined, prefix: string) => {
    (blocks ?? []).forEach((b, i) => {
      const path = prefix ? `${prefix}.${i}` : String(i);
      if (b.type === 'bulletListItem' || b.type === 'numberedListItem') {
        const text = inlineText(b.content).trim();
        if (text) {
          const itemId = b.id ?? `pos:${path}`;
          const detected = detectDates(text, now)[0];
          const due = detected ? isoLocal(detected.date) : undefined;
          out.push({
            key: `c:${board.id}:${node.id}:${itemId}`,
            kind: 'check',
            boardId: board.id,
            boardName: board.name,
            nodeId: node.id,
            itemId,
            text,
            due,
            urgency: urgencyFor(due, now),
          });
        }
      }
      walk(b.children, path);
    });
  };
  walk(node.data.blocks as AnyBlock[] | undefined, '');
  return out;
}

// ---------- Schlaue Schnell-Eingabe (M114) ----------
export interface QuickParse {
  text: string;
  who?: string;
  due?: string;
  prio?: 1 | 2 | 3;
}

/**
 * „Bericht ans RP bis Freitag @Anna #haushalt !!" →
 * Frist (chrono), Person (@…), Priorität (!=niedrig … !!!=hoch); #Tags
 * bleiben bewusst im Text — dort liest sie der Kanban-Tag-Filter (M65).
 */
export function parseQuickTask(input: string, now: Date = new Date()): QuickParse {
  let text = input.trim();
  let prio: 1 | 2 | 3 | undefined;
  const bang = text.match(/(?:^|\s)(!{1,3})(?=\s|$)/);
  if (bang) {
    prio = (4 - bang[1].length) as 1 | 2 | 3;
    text = text.replace(bang[0], ' ');
  }
  let who: string | undefined;
  const at = text.match(/(?:^|\s)@([\p{L}\p{N}._-]+)/u);
  if (at) {
    who = at[1];
    text = text.replace(at[0], ' ');
  }
  let due: string | undefined;
  const d = detectDates(text, now)[0];
  if (d) {
    due = isoLocal(d.date);
    const esc = d.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Frist-Phrase samt führendem „bis/am/zum/ab" aus dem Titel nehmen
    text = text.replace(new RegExp(`(?:\\b(?:bis|am|zum|ab)\\s+)?${esc}`, 'i'), ' ');
  }
  return { text: text.replace(/\s{2,}/g, ' ').trim(), who, due, prio };
}

// ---------- „Mein Tag" (M115): handverlesene Fokusliste, gilt nur heute ----------
const MYDAY_KEY = 'pixinotes:myday';

export function myDayKeys(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(MYDAY_KEY) ?? 'null') as { d: string; keys: string[] } | null;
    if (!raw || raw.d !== isoLocal(new Date())) return new Set(); // neuer Tag = leere Liste
    return new Set(raw.keys);
  } catch {
    return new Set();
  }
}

export function toggleMyDay(key: string): Set<string> {
  const keys = myDayKeys();
  if (keys.has(key)) keys.delete(key); else keys.add(key);
  localStorage.setItem(MYDAY_KEY, JSON.stringify({ d: isoLocal(new Date()), keys: [...keys].slice(0, 100) }));
  return keys;
}

// ---------- „Heute geschafft" (M114): Erledigt-Protokoll ----------
const DONE_LOG_KEY = 'pixinotes:donelog';

export interface DoneEntry { d: string; text: string; board: string }

export function doneLog(): DoneEntry[] {
  try {
    return JSON.parse(localStorage.getItem(DONE_LOG_KEY) ?? '[]') as DoneEntry[];
  } catch {
    return [];
  }
}

/** Erledigung protokollieren (Basis für „Heute geschafft" + Wochen-Balken) */
export function logDone(t: TaskRef): void {
  const list = doneLog();
  list.push({ d: isoLocal(new Date()), text: t.text.slice(0, 120), board: t.boardName });
  localStorage.setItem(DONE_LOG_KEY, JSON.stringify(list.slice(-400)));
}

/** #Tags aus Aufgabentexten einsammeln (für den Tag-Filter der Zentrale) */
export function collectTaskTags(tasks: TaskRef[]): string[] {
  const seen = new Map<string, number>();
  for (const t of tasks) {
    for (const m of t.text.matchAll(/#([\p{L}\p{N}_-]{2,})/gu)) {
      const tag = m[1].toLowerCase();
      seen.set(tag, (seen.get(tag) ?? 0) + 1);
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12);
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

/**
 * M170 Rück-Sync Kanban → Checkliste: den Punkt gezielt abhaken/aufmachen und
 * einen Spalten-Vermerk „(→ Spalte)" im Text hinterlassen bzw. wieder räumen.
 * Bewusst SETZEN statt toggeln — der Aufrufer kennt den Zielzustand.
 * M182: Auch LISTEN-Punkte (Aufzählung/Nummerierung) sind Rück-Sync-Ziele —
 * sie werden dabei zu Checklisten-Punkten umgewandelt, damit der Haken in der
 * Notiz sichtbar wird (nur eingesammelte Listen verbundener Notizen).
 */
export function annotateCheckBlock(
  blocks: unknown[] | undefined,
  blockId: string,
  opts: { checked: boolean; note: string | null },
): unknown[] | undefined {
  if (!blocks) return blocks;
  const byPos = blockId.startsWith('pos:') ? blockId.slice(4) : null;
  const stamp = (text: string): string => {
    const clean = stripStatusMark(text);
    return opts.note ? `${clean} (→ ${opts.note.slice(0, 30)})` : clean;
  };
  const stampContent = (content: unknown): unknown => {
    if (typeof content === 'string') return stamp(content);
    if (Array.isArray(content) && content.length > 0) {
      // Vermerk am LETZTEN Text-Baustein an-/abhängen (Formatierung davor bleibt)
      const next = content.map((c) => ({ ...(c as Record<string, unknown>) }));
      for (let i = next.length - 1; i >= 0; i--) {
        if (typeof next[i].text === 'string') {
          next[i].text = stamp(next[i].text as string);
          return next;
        }
      }
    }
    return content;
  };
  const walk = (bs: AnyBlock[], prefix: string): AnyBlock[] =>
    bs.map((b, i) => {
      const path = prefix ? `${prefix}.${i}` : String(i);
      const next: AnyBlock = { ...b };
      const hit = byPos ? path === byPos : b.id === blockId;
      if (hit && b.type === 'checkListItem') {
        next.props = { ...b.props, checked: opts.checked };
        next.content = stampContent(b.content);
      } else if (hit && (b.type === 'bulletListItem' || b.type === 'numberedListItem')) {
        // Umwandlung Liste → Checkliste; listenspezifische Props (z. B. `start`
        // bei Nummerierungen) fliegen raus, sonst lehnt BlockNote den Block ab
        const { start: _start, ...rest } = (b.props ?? {}) as Record<string, unknown>;
        next.type = 'checkListItem';
        next.props = { ...rest, checked: opts.checked };
        next.content = stampContent(b.content);
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
