// Fristen-Erkennung: chrono-node (deutsch) findet Datumsangaben wie
// „bis Freitag", „am 24.07." oder „nächste Woche" in Kartentexten.
import * as chrono from 'chrono-node';

export interface DetectedDate {
  /** Originaltext, z. B. „bis Freitag" */
  label: string;
  date: Date;
  /** dringend = < 48h, überfällig = vorbei */
  urgency: 'ok' | 'soon' | 'overdue';
}

export function detectDates(text: string, ref: Date = new Date()): DetectedDate[] {
  if (!text) return [];
  let results: chrono.ParsedResult[] = [];
  try {
    results = chrono.de.parse(text, ref, { forwardDate: true });
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: DetectedDate[] = [];
  for (const r of results) {
    const date = r.start.date();
    // Reine Uhrzeiten und Duplikate überspringen
    if (!r.start.isCertain('day') && !r.start.isCertain('weekday')) continue;
    const key = date.toDateString();
    if (seen.has(key)) continue;
    seen.add(key);
    const diffH = (date.getTime() - ref.getTime()) / 36e5;
    out.push({
      label: r.text.trim(),
      date,
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
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pixinotes-termin.ics';
  a.click();
  URL.revokeObjectURL(a.href);
}
