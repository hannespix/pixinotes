// M186: Rechenkern der Protokoll-Reihe — bewusst ohne React, damit sich die
// heikelste Stelle (die Wiedervorlage) für sich prüfen lässt.

import { uid, type MinutesData, type MinutesEntry } from '../types';
import { isoLocal, sitzungsAnker } from './tasks';
import { detectDates } from './dates';
import { sprache } from './sprache';

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
function monateWeiter(d: Date, n: number): void {
  const tag = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(tag, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
}

export function nextDate(data: MinutesData, today = new Date()): string {
  const last = latestEntry(data);
  const base = last?.date ? new Date(`${last.date}T12:00:00`) : today;
  if (Number.isNaN(base.getTime())) return isoLocal(today);
  const d = new Date(base);
  switch (data.rhythm) {
    case 'woche': d.setDate(d.getDate() + 7); break;
    case 'zweiwochen': d.setDate(d.getDate() + 14); break;
    // M388: am Monatsende nicht überlaufen — 31.01. + 1 Monat ist der 28./29.02., nicht der 03.03.
    case 'monat': monateWeiter(d, 1); break;
    case 'quartal': monateWeiter(d, 3); break;
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

// ================= M489: Protokollreihe neu gedacht =================
// Alles, was die neue Karte über die Reihe wissen muss — ohne React, damit sich die Regeln für sich prüfen lassen.
// Das Datenmodell bleibt, wie es war (entries[].blocks/decisions/attendees): Aufgaben SIND die Checklisten-Punkte
// im Protokolltext (so lesen sie auch Zentrale, Wiedervorlage, KI und Export), Person und Frist stehen im Text.

const locale = (): string => (sprache() === 'en' ? 'en-GB' : 'de-DE');
const alsDatum = (iso: string | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** „23.11." — mit Jahr, wenn es nicht das laufende ist */
export function kurzDatum(iso: string | undefined, heute = new Date()): string {
  const d = alsDatum(iso);
  if (!d) return iso || '—';
  return d.toLocaleDateString(locale(), d.getFullYear() === heute.getFullYear()
    ? { day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Frist kurz: „Fr. 27.11." */
export function fristText(iso: string | undefined): string {
  const d = alsDatum(iso);
  if (!d) return iso || '—';
  return `${d.toLocaleDateString(locale(), { weekday: 'short' })} ${kurzDatum(iso)}`;
}

/** „Mo., 23.11.2026" */
export function langDatum(iso: string | undefined): string {
  const d = alsDatum(iso);
  if (!d) return iso || '—';
  return d.toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Teilnehmende: gespeichert bleibt der Freitext („Anna Berg, Gerd Huber"), gezeigt werden Namen */
export function teilnehmende(text: string | undefined): string[] {
  const out: string[] = [];
  const gesehen = new Set<string>();
  for (const roh of (text ?? '').split(/[,;\n]/)) {
    const name = roh.trim();
    if (!name || gesehen.has(name.toLowerCase())) continue;
    gesehen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}
export const teilnehmendeText = (namen: string[]): string | undefined => (namen.length ? namen.join(', ') : undefined);

/**
 * Wer ist gemeint? „Anna: Raum buchen" oder „Raum buchen @Anna". Bewusst eng: „Hinweis: …" wäre sonst auch eine
 * Person — darum zählt der Doppelpunkt nur, wenn der Name (oder ein Teil davon) in der Runde vorkommt; @ gilt immer.
 */
export function personVon(text: string, runde: string[] = []): { person?: string; rest: string } {
  const at = /(^|\s)@([\p{L}][\p{L}.-]{1,30})/u.exec(text);
  if (at) return { person: at[2], rest: (text.slice(0, at.index) + text.slice(at.index + at[0].length)).replace(/\s{2,}/g, ' ').trim() };
  const vorn = /^\s*([\p{Lu}][\p{L}.-]{1,30}(?:\s[\p{Lu}][\p{L}.-]{1,30})?)\s*:\s+(.+)$/u.exec(text);
  if (vorn) {
    const klein = vorn[1].toLowerCase();
    const bekannt = runde.some((r) => { const rr = r.toLowerCase(); return rr === klein || rr.split(/\s+/).includes(klein); });
    if (bekannt) return { person: vorn[1], rest: vorn[2].trim() };
  }
  return { rest: text };
}

export interface OffeneAufgabe {
  entryId: string;
  /** Block-Kennung; Blöcke ohne (Altbestand) über den Positionspfad „pos:1.0" — wie lib/tasks.ts */
  blockId: string;
  text: string;
  person?: string;
  /** Frist als yyyy-mm-dd, aus dem Text erkannt („bis Freitag", „am 4.12.") */
  frist?: string;
  ueberfaellig: boolean;
  /** „01.11.26" aus dem Vermerk „(offen seit …)" — wie lange der Punkt schon mitwandert */
  seit?: string;
}

/**
 * Offene Aufgaben der Reihe = die nicht abgehakten Checklisten-Punkte der NEUESTEN Sitzung. Ältere Sitzungen zählen
 * nicht: Ihre offenen Punkte wandern beim Anlegen der nächsten mit (Wiedervorlage) — dieselbe Regel wie die
 * Aufgaben-Zentrale (lib/tasks.ts), sonst stünde ein vertagter Punkt so oft da, wie er vertagt wurde.
 */
export function offeneAufgaben(data: MinutesData, now = new Date()): OffeneAufgabe[] {
  const neueste = latestEntry(data);
  if (!neueste) return [];
  const runde = teilnehmende(neueste.attendees);
  const heute = isoLocal(now);
  const out: OffeneAufgabe[] = [];
  const walk = (bs: AnyBlock[] | undefined, prefix: string) => {
    (bs ?? []).forEach((b, i) => {
      const pfad = prefix ? `${prefix}.${i}` : String(i);
      if (b?.type === 'checkListItem' && !b.props?.checked) {
        const roh = textOf(b.content).trim();
        if (roh) {
          const seitM = /\(offen seit ([^)]{1,20})\)\s*$/.exec(roh);
          const ohneSeit = roh.replace(CARRY_MARK, '').trim();
          const { person, rest } = personVon(ohneSeit, runde);
          const fund = detectDates(ohneSeit, now, sitzungsAnker(roh, neueste.date))[0];
          const frist = fund ? isoLocal(fund.date) : undefined;
          out.push({ entryId: neueste.id, blockId: b.id ?? `pos:${pfad}`, text: rest || ohneSeit, person, frist, ueberfaellig: !!frist && frist < heute, seit: seitM?.[1] });
        }
      }
      if (b?.children?.length) walk(b.children, pfad);
    });
  };
  walk(neueste.blocks as AnyBlock[] | undefined, '');
  return out;
}

/** Offene und erledigte Punkte einer Sitzung */
export function aufgabenStand(e: MinutesEntry | undefined): { offen: number; erledigt: number } {
  let offen = 0; let erledigt = 0;
  const walk = (bs: AnyBlock[] | undefined) => {
    for (const b of bs ?? []) {
      if (b?.type === 'checkListItem' && textOf(b.content).trim()) { if (b.props?.checked) erledigt += 1; else offen += 1; }
      if (b?.children?.length) walk(b.children);
    }
  };
  walk(e?.blocks as AnyBlock[] | undefined);
  return { offen, erledigt };
}

/** Tagesordnung einer Sitzung: ihre Überschriften (eine Wahrheit — der Text) */
export function tagesordnung(e: MinutesEntry | undefined): Array<{ id?: string; text: string }> {
  const out: Array<{ id?: string; text: string }> = [];
  for (const b of (e?.blocks as AnyBlock[] | undefined) ?? []) {
    if (b?.type !== 'heading') continue;
    const t = textOf(b.content).trim();
    if (t) out.push({ id: b.id, text: t });
  }
  return out;
}

/** Wer war wie oft dabei — über alle Sitzungen */
export function anwesenheit(data: MinutesData): Array<{ name: string; mal: number }> {
  const zaehl = new Map<string, { name: string; mal: number }>();
  for (const e of data.entries ?? []) {
    for (const n of teilnehmende(e.attendees)) {
      const k = n.toLowerCase();
      const alt = zaehl.get(k);
      if (alt) alt.mal += 1; else zaehl.set(k, { name: n, mal: 1 });
    }
  }
  return [...zaehl.values()].sort((a, b) => b.mal - a.mal || a.name.localeCompare(b.name));
}

/** Suchtext: klein, ohne Akzente, ß = ss */
export const suchNorm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

export interface SuchTreffer { entryId: string; date: string; art: 'text' | 'aufgabe' | 'beschluss' | 'runde' | 'titel'; text: string }

/** Wiederfinden: jedes Wort der Suche muss in derselben Zeile stehen; neueste Sitzung zuerst */
export function sucheInReihe(data: MinutesData, frage: string, max = 40): SuchTreffer[] {
  const woerter = suchNorm(frage).split(/\s+/).filter(Boolean);
  if (woerter.length === 0) return [];
  const passt = (t: string) => { const n = suchNorm(t); return woerter.every((w) => n.includes(w)); };
  const out: SuchTreffer[] = [];
  for (const e of sortEntries(data.entries ?? [])) {
    const dazu = (art: SuchTreffer['art'], text: string) => { if (out.length < max && text.trim() && passt(text)) out.push({ entryId: e.id, date: e.date, art, text: text.trim() }); };
    if (e.title) dazu('titel', e.title);
    if (e.attendees) dazu('runde', e.attendees);
    const walk = (bs: AnyBlock[] | undefined) => {
      for (const b of bs ?? []) {
        dazu(b?.type === 'checkListItem' ? 'aufgabe' : 'text', textOf(b?.content));
        if (b?.children?.length) walk(b.children);
      }
    };
    walk(e.blocks as AnyBlock[] | undefined);
    for (const d of e.decisions ?? []) dazu('beschluss', d.text);
  }
  return out;
}

/** Eine Sitzung als schlichter Text — zum Kopieren und Versenden (E-Mail) */
export function sitzungAlsText(data: MinutesData, e: MinutesEntry): string {
  const zeilen: string[] = [];
  zeilen.push(`${data.title?.trim() || 'Protokoll'} – ${e.title?.trim() ? `${e.title.trim()}, ` : ''}${langDatum(e.date)}`);
  if (e.attendees?.trim()) zeilen.push(`Teilnehmende: ${teilnehmende(e.attendees).join(', ')}`);
  zeilen.push('');
  const walk = (bs: AnyBlock[] | undefined, tiefe: number) => {
    for (const b of bs ?? []) {
      const t = textOf(b?.content).trim();
      const einr = '  '.repeat(tiefe);
      if (b?.type === 'heading') { if (t) { zeilen.push(''); zeilen.push(t.toUpperCase()); } }
      else if (b?.type === 'checkListItem') { if (t) zeilen.push(`${einr}[${b.props?.checked ? 'x' : ' '}] ${t}`); }
      else if (b?.type === 'bulletListItem' || b?.type === 'numberedListItem') { if (t) zeilen.push(`${einr}- ${t}`); }
      else if (t) zeilen.push(`${einr}${t}`);
      if (b?.children?.length) walk(b.children, tiefe + 1);
    }
  };
  walk(e.blocks as AnyBlock[] | undefined, 0);
  const bs = (e.decisions ?? []).filter((d) => d.text?.trim());
  if (bs.length) { zeilen.push(''); zeilen.push('BESCHLÜSSE'); for (const d of bs) zeilen.push(`- ${d.text.trim()}`); }
  return zeilen.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Auf welchem Papier steht die Karte? Die Farbtöne der Palette sind auch im Dunkelmodus helles Papier (M338),
 * Weiß folgt dem Theme, eine freie Farbe nach ihrer Helligkeit. Danach richten sich Schrift- und Linienfarben
 * (styles/52-…: --pr-*). Vorher stand die dunkle Editor-Schrift auf der dunklen weißen Karte (kaum lesbar).
 */
export function papierArt(data: Pick<MinutesData, 'color' | 'hex'>): 'hell' | 'dunkel' | 'thema' {
  if (typeof data.hex === 'string' && /^#[0-9a-f]{6}$/i.test(data.hex)) {
    const hex = data.hex;
    const kanal = (i: number) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = 0.2126 * kanal(1) + 0.7152 * kanal(3) + 0.0722 * kanal(5);
    return lum > 0.18 ? 'hell' : 'dunkel';
  }
  // Nur die bekannten Farbtöne sind Papier — ein unbekannter Wert hat keine eigene Fläche (Kartenfarbe = Theme)
  return ['yellow', 'pink', 'mint', 'sky'].includes(String(data.color)) ? 'hell' : 'thema';
}
