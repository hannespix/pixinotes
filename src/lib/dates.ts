// Fristen-Erkennung: chrono-node (deutsch) findet Datumsangaben wie
// „bis Freitag", „am 24.07." oder „nächste Woche" in Kartentexten.
import { de as chronoDe, type ParsedResult } from 'chrono-node';
import { triggerDownload } from './download';

export interface DetectedDate {
  /** Originaltext, z. B. „bis Freitag" */
  label: string;
  date: Date;
  /** dringend = < 48h, überfällig = vorbei */
  urgency: 'ok' | 'soon' | 'overdue';
}

/**
 * M323: Deutsche Kurzdaten — „12.11.", „am 3.12. um 10 Uhr", „12.11.26".
 * chrono-de kennt das Datum ohne Jahr nicht und machte aus „um 10 Uhr" ein
 * „morgen 10 Uhr"; die häufigste Schreibweise in Notizen blieb so unerkannt.
 */
const KURZDATUM_RE = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(?:(\d{4}|\d{2})(?!\d))?(?!\d)(?:\s*(?:um\s*)?(\d{1,2})(?::(\d{2}))?\s*Uhr)?/gi;
function kurzdaten(text: string, ref: Date): Array<{ text: string; date: Date; index: number }> {
  const out: Array<{ text: string; date: Date; index: number }> = [];
  for (const m of text.matchAll(KURZDATUM_RE)) {
    const tag = Number(m[1]);
    const monat = Number(m[2]);
    if (tag < 1 || tag > 31 || monat < 1 || monat > 12) continue;
    const jahr = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ref.getFullYear();
    const std = m[4] !== undefined ? Math.min(23, Number(m[4])) : 12;
    const min = m[5] ? Math.min(59, Number(m[5])) : 0;
    let d = new Date(jahr, monat - 1, tag, std, min);
    if (d.getDate() !== tag) continue; // 31.02. gibt es nicht
    // Ohne Jahr: Liegt es mehr als zwei Monate zurück, ist das nächste Jahr gemeint
    if (!m[3] && d.getTime() < ref.getTime() - 60 * 864e5) d = new Date(jahr + 1, monat - 1, tag, std, min);
    out.push({ text: m[0].trim(), date: d, index: m.index ?? 0 });
  }
  return out;
}

export function detectDates(text: string, ref: Date = new Date()): DetectedDate[] {
  if (!text) return [];
  let results: ParsedResult[] = [];
  try {
    results = chronoDe.parse(text, ref, { forwardDate: true });
  } catch {
    return [];
  }
  const funde: Array<{ text: string; date: Date; index: number }> = [];
  for (const r of results) {
    // Reine Uhrzeiten überspringen
    if (!r.start.isCertain('day') && !r.start.isCertain('weekday')) continue;
    funde.push({ text: r.text, date: r.start.date(), index: r.index });
  }
  funde.push(...kurzdaten(text, ref));
  funde.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const out: DetectedDate[] = [];
  for (const f of funde) {
    const key = f.date.toDateString();
    if (seen.has(key)) continue;
    seen.add(key);
    const diffH = (f.date.getTime() - ref.getTime()) / 36e5;
    out.push({
      label: f.text.trim(),
      date: f.date,
      urgency: diffH < -12 ? 'overdue' : diffH < 48 ? 'soon' : 'ok',
    });
  }
  return out.slice(0, 3);
}

export function formatDue(d: DetectedDate, now: Date = new Date()): string {
  const days = Math.round((startOfDay(d.date).getTime() - startOfDay(now).getTime()) / 864e5);
  const dateStr = d.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  if (days < 0) return `${dateStr} · überfällig!`;
  if (days === 0) return `${dateStr} · heute`;
  if (days === 1) return `${dateStr} · morgen`;
  return `${dateStr} · in ${days} Tagen`;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Kalender-Eintrag (.ics) für eine erkannte Frist erzeugen und herunterladen. */
export function downloadIcs(title: string, date: Date): void {
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PixiNotes//DE',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@pixinotes`,
    `DTSTART;VALUE=DATE:${fmt(date)}`,
    `SUMMARY:${title.replace(/[\n,;]/g, ' ')}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT9H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title.replace(/[\n,;]/g, ' ')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  triggerDownload(url, 'pixinotes-termin.ics');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
