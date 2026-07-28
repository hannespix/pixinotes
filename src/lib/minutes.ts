// M186: Rechenkern der Protokoll-Reihe — bewusst ohne React, damit sich die
// heikelste Stelle (die Wiedervorlage) für sich prüfen lässt.

import { uid, type MinutesData, type MinutesEntry } from '../types';
import { isoLocal } from './tasks';

/** Sitzungen: neueste zuerst. Gleiches Datum → stabil über die id. */
export function sortEntries(entries: MinutesEntry[]): MinutesEntry[] {
  return [...entries].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id));
}

/** Die inhaltlich aktuelle Sitzung — Grundlage für Aufgaben und Wiedervorlage */
export function latestEntry(data: MinutesData): MinutesEntry | undefined {
  return sortEntries(data.entries ?? [])[0];
}

/** Gerade angezeigte Sitzung (fehlt der Zeiger, ist es die neueste) */
export function currentEntry(data: MinutesData): MinutesEntry | undefined {
  const sorted = sortEntries(data.entries ?? []);
  return sorted.find((e) => e.id === data.current) ?? sorted[0];
}

/** Anzeigename: eigener Titel, sonst das Datum in deutscher Schreibweise */
export function entryLabel(e: MinutesEntry | undefined): string {
  if (!e) return '—';
  if (e.title?.trim()) return e.title.trim();
  const d = new Date(`${e.date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return e.date || 'Sitzung';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Datumsvorschlag für die nächste Sitzung — folgt dem Rhythmus der Reihe */
export function nextDate(data: MinutesData, today = new Date()): string {
  const last = latestEntry(data);
  const base = last?.date ? new Date(`${last.date}T12:00:00`) : today;
  if (Number.isNaN(base.getTime())) return isoLocal(today);
  const d = new Date(base);
  switch (data.rhythm) {
    case 'woche': d.setDate(d.getDate() + 7); break;
    case 'zweiwochen': d.setDate(d.getDate() + 14); break;
    case 'monat': d.setMonth(d.getMonth() + 1); break;
    case 'quartal': d.setMonth(d.getMonth() + 3); break;
    default: return isoLocal(today);
  }
  // Läge der Vorschlag noch in der Vergangenheit, ist „heute" ehrlicher
  return d.getTime() < today.getTime() ? isoLocal(today) : isoLocal(d);
}

interface AnyBlock { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: AnyBlock[] }

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join('');
};

/** Vermerk „(offen seit …)" — beim erneuten Übertragen nicht stapeln */
const CARRY_MARK = /\s*\(offen seit [^)]{0,20}\)\s*$/;

/**
 * Die Wiedervorlage: alle NICHT abgehakten Checklisten-Punkte einsammeln und
 * für die neue Sitzung aufbereiten. Erledigtes bleibt im alten Protokoll —
 * dort gehört es hin, ein Protokoll wird nicht rückwirkend umgeschrieben.
 *
 * Der Vermerk nennt das Datum der ERSTEN Sitzung, in der der Punkt auftauchte
 * (steht er schon dran, bleibt er stehen) — so sieht man auf einen Blick,
 * was sich seit Monaten mitschleppt.
 */
export function carryOverBlocks(from: MinutesEntry | undefined): unknown[] {
  if (!from?.blocks) return [];
  const out: AnyBlock[] = [];
  const walk = (blocks: AnyBlock[] | undefined) => {
    for (const b of blocks ?? []) {
      if (b?.type === 'checkListItem' && !b.props?.checked) {
        const raw = textOf(b.content).trim();
        if (raw) {
          const had = CARRY_MARK.test(raw);
          const since = had ? raw.match(CARRY_MARK)![0].trim() : `(offen seit ${shortDate(from.date)})`;
          const clean = raw.replace(CARRY_MARK, '').trim();
          out.push({ type: 'checkListItem', props: { checked: false }, content: `${clean} ${since}` });
        }
      }
      if (b?.children?.length) walk(b.children);
    }
  };
  walk(from.blocks as AnyBlock[]);
  return out;
}

const shortDate = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

/**
 * Neue Sitzung bauen: feste Tagesordnung als Überschriften, darunter die
 * übernommenen offenen Punkte (falls eingeschaltet).
 */
export function buildEntry(data: MinutesData, date: string): MinutesEntry {
  const blocks: unknown[] = [];
  const carried = data.carryOpen === false ? [] : carryOverBlocks(latestEntry(data));
  if (carried.length > 0) {
    blocks.push({ type: 'heading', props: { level: 3 }, content: 'Offene Punkte aus der letzten Sitzung' });
    blocks.push(...carried);
  }
  for (const top of data.agenda ?? []) {
    if (!top.trim()) continue;
    blocks.push({ type: 'heading', props: { level: 3 }, content: top.trim() });
    blocks.push({ type: 'paragraph', content: '' });
  }
  if (blocks.length === 0) blocks.push({ type: 'paragraph', content: '' });
  return {
    id: uid(),
    date,
    attendees: latestEntry(data)?.attendees,   // Runde bleibt meist dieselbe
    blocks,
    decisions: [],
  };
}

/** Alle Beschlüsse der Reihe, neueste zuerst — die „Beschlusslage" */
export function allDecisions(data: MinutesData): Array<{ text: string; date: string }> {
  const out: Array<{ text: string; date: string }> = [];
  for (const e of sortEntries(data.entries ?? [])) {
    for (const d of e.decisions ?? []) {
      if (d.text?.trim()) out.push({ text: d.text.trim(), date: e.date });
    }
  }
  return out;
}
