// M170: Daten-Abos zwischen Modulen — reine Ableitungs-Helfer.
// Verbundene Karten (linkedNeighborIds) tauschen Daten NUR lesend aus:
// abgeleitete Anzeigen statt kopierter Daten, damit nichts doppelt gepflegt
// werden muss und keine Sync-Schleifen entstehen können.
import type { BoardDoc } from '../store';
import type { AppNode, TimeData, TimeSeg, WeekData } from '../types';
import { blocksToText } from './serialize';

// ---------- Zeiterfassung: Summen für Chips & Soll/Ist ----------

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

export const fmtHM = (min: number) => `${Math.floor(Math.abs(min) / 60)}:${String(Math.abs(min) % 60).padStart(2, '0')}`;
/** Differenz mit Vorzeichen: +0:12 / −1:05 */
export const fmtDiff = (min: number) => `${min < 0 ? '−' : '+'}${fmtHM(min)}`;

const segDur = (s: TimeSeg, today: string): number =>
  Math.max(0, (s.end ?? (s.date === today ? nowMin() : s.start)) - s.start);

const mondayOf = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoOf(d);
};
const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};

/** Arbeitszeit ohne Pausen im Bereich [from, to] (laufender Abschnitt zählt bis jetzt) */
export function timeWorkIn(data: TimeData, from: string, to: string): number {
  const today = isoOf(new Date());
  return (data.segs ?? [])
    .filter((s) => s.date >= from && s.date <= to && s.kind !== 'pause')
    .reduce((a, s) => a + segDur(s, today), 0);
}

/** Heute- und Wochensumme (ohne Pausen) — für die ⏱-Chips an verbundenen Karten */
export function timeSums(data: TimeData): { day: number; week: number } {
  const today = isoOf(new Date());
  const mon = mondayOf(today);
  return { day: timeWorkIn(data, today, today), week: timeWorkIn(data, mon, addDaysIso(mon, 6)) };
}

// ---------- Wochenplan: Soll-Zeiten für die Zeiterfassung ----------

/**
 * Soll-Minuten je Wochentag (0 = Montag … 6 = Sonntag) aus einem Wochenplan —
 * nur sinnvoll, wenn die Spalten Wochentage sind (keine freien Spalten) und
 * die Zeilen Uhrzeiten (keine eigenen Einheiten). Sonst null.
 */
export function weekSollByDay(data: WeekData): number[] | null {
  if (data.cols?.length || data.axis === 'slots') return null;
  const out = Array.from({ length: 7 }, () => 0);
  for (const e of data.entries ?? []) {
    if (e.day >= 0 && e.day < 7) out[e.day] += Math.max(0, e.dur);
  }
  return out;
}

/** Soll für ein konkretes Datum aus allen verbundenen Wochenplänen (summiert) */
export function sollForDate(weeks: WeekData[], iso: string): number | null {
  const wd = (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;
  let sum = 0;
  let any = false;
  for (const w of weeks) {
    const byDay = weekSollByDay(w);
    if (!byDay) continue;
    any = true;
    sum += byDay[wd];
  }
  return any ? sum : null;
}

// ---------- Verbundene Nachbarn eines Typs einsammeln ----------

/** Verbundene Nachbar-Karten eines Typs (auf dem Board der Karte `nodeId`) */
export function linkedOfType(boards: BoardDoc[], nodeId: string, type: AppNode['type']): AppNode[] {
  const b = boards.find((x) => x.nodes.some((n) => n.id === nodeId));
  if (!b) return [];
  const ids = new Set<string>();
  for (const e of b.edges) {
    if (e.source === nodeId) ids.add(e.target);
    else if (e.target === nodeId) ids.add(e.source);
  }
  return b.nodes.filter((n) => ids.has(n.id) && n.type === type);
}

// ---------- HTML-App: Speicherstand als lesbarer Auszug ----------

/**
 * Lesbarer Auszug aus dem Speicherstand einer eigenen App (der localStorage-
 * Bag der Sandbox): bis zu 6 Zeilen „schlüssel: wert". JSON-Werte werden
 * flach zusammengefasst, lange Werte gekürzt — ein Blick statt Rohdaten.
 */
export function appStateLines(state: Record<string, string> | undefined | null): string[] {
  if (!state) return [];
  const short = (v: string): string => {
    const t = v.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const o = JSON.parse(t) as unknown;
        if (Array.isArray(o)) return `${o.length} Einträge`;
        if (o && typeof o === 'object') {
          return Object.entries(o as Record<string, unknown>)
            .slice(0, 3)
            .map(([k, val]) => `${k}=${String(typeof val === 'object' ? '…' : val).slice(0, 18)}`)
            .join(' · ') || '{}';
        }
      } catch { /* kein JSON — als Text zeigen */ }
    }
    return t.slice(0, 60);
  };
  return Object.entries(state)
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${short(String(v))}`);
}

// ---------- Notiz-Checkliste → Mermaid-Diagramm ----------

/**
 * Aus einer verbundenen Notiz ein Mermaid-Flussdiagramm ableiten: Titel als
 * Startknoten, Checklisten-Punkte als Kette; Erledigtes wird grün markiert.
 * Ohne Checkliste dienen die ersten Textzeilen als Kette.
 */
export function mermaidFromNote(node: AppNode): string | null {
  if (node.type !== 'note') return null;
  const blocks = (node.data.blocks as Array<{ type?: string; props?: { checked?: boolean }; content?: unknown }> | undefined) ?? [];
  const esc = (s: string) => s.replace(/"/g, '”').slice(0, 48).trim() || '…';
  const text = blocksToText(node.data.blocks as unknown[] | undefined);
  const title = esc(text.split('\n').find((l) => l.trim()) ?? 'Checkliste');
  const items: Array<{ label: string; done: boolean }> = [];
  const walk = (bs: typeof blocks) => {
    for (const b of bs) {
      if (b.type === 'checkListItem') {
        const t = typeof b.content === 'string'
          ? b.content
          : Array.isArray(b.content)
            ? (b.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
            : '';
        if (t.trim()) items.push({ label: esc(t), done: !!b.props?.checked });
      }
      const kids = (b as { children?: typeof blocks }).children;
      if (kids?.length) walk(kids);
    }
  };
  walk(blocks);
  // Ohne Checkliste: die nächsten Textzeilen als einfache Kette
  if (items.length === 0) {
    for (const l of text.split('\n').slice(1)) {
      if (l.trim()) items.push({ label: esc(l), done: false });
      if (items.length >= 8) break;
    }
  }
  if (items.length === 0) return null;
  const lines = [`flowchart TD`, `  T(["${title}"])`];
  items.slice(0, 14).forEach((it, i) => {
    lines.push(`  ${i === 0 ? 'T' : `A${i - 1}`} --> A${i}["${it.done ? '✓ ' : ''}${it.label}"]`);
  });
  const doneIds = items.slice(0, 14).map((it, i) => (it.done ? `A${i}` : null)).filter(Boolean);
  if (doneIds.length) {
    lines.push(`  classDef pnDone fill:#d9efdc,stroke:#3fa564,color:#1d5c31;`);
    lines.push(`  class ${doneIds.join(',')} pnDone;`);
  }
  return lines.join('\n');
}
