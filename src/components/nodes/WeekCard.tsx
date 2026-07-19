import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { uid, type WeekData, type WeekEntry, type WeekNode } from '../../types';
import { CardShell } from './CardShell';
import { IX } from '../Icons';

const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** Block-Farben: [Fläche, Balken/Schrift] — kräftig genug für hell und dunkel */
const ENTRY_COLORS: Array<[string, string]> = [
  ['#dbe7f6', '#3c669c'], ['#dcedde', '#35744a'], ['#f6ead2', '#9c6f1c'],
  ['#f4dde3', '#a84a4a'], ['#e6def4', '#6a4da0'], ['#eceae4', '#5b6470'],
];

export const fmtTime = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

/** Nebenläufigkeits-Bahnen je Tag: überlappende Blöcke stehen nebeneinander */
function lanesFor(entries: WeekEntry[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...entries].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const laneEnd: number[] = [];
  const laneOf = new Map<string, number>();
  for (const e of sorted) {
    let lane = laneEnd.findIndex((end) => end <= e.start);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(0); }
    laneEnd[lane] = e.start + e.dur;
    laneOf.set(e.id, lane);
  }
  const lanes = Math.max(1, laneEnd.length);
  const out = new Map<string, { lane: number; lanes: number }>();
  for (const e of sorted) out.set(e.id, { lane: laneOf.get(e.id) ?? 0, lanes });
  return out;
}

/**
 * Wochenplan (M153): klassisches Stundenraster — Tage als Spalten, Uhrzeiten
 * als Zeilen. Klick auf einen freien Slot legt einen Block an (30-Minuten-
 * Raster), Klick auf einen Block öffnet den Editor (Text, Tag, Von/Bis,
 * Farbe, Löschen) als Portal-Popover. Zeitbereich und Mo–Fr/Mo–So sind je
 * Karte umschaltbar — so wird daraus Stundenplan, Arbeitswoche oder Dienstplan.
 */
export function WeekCard({ id, data, selected }: NodeProps<WeekNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const [pop, setPop] = useState<{ entryId: string; x: number; y: number } | null>(null);

  const days = data.days === 7 ? 7 : 5;
  const from = typeof data.from === 'number' ? data.from : 480;
  const to = typeof data.to === 'number' && data.to > from ? data.to : from + 540;
  const span = to - from;
  const entries = data.entries ?? [];

  useEffect(() => {
    if (!pop) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.week-pop')) return;
      setPop(null);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [pop]);

  const patch = (p: Partial<WeekData>) => updateNodeData(id, p);
  const patchEntry = (eid: string, p: Partial<WeekEntry>) =>
    patch({ entries: entries.map((e) => (e.id === eid ? { ...e, ...p } : e)) });
  const removeEntry = (eid: string) => {
    patch({ entries: entries.filter((e) => e.id !== eid) });
    setPop(null);
  };

  /** Klick auf freie Fläche einer Tagesspalte → neuer Block im 30-min-Raster */
  const addAt = (day: number, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const raw = from + ((e.clientY - rect.top) / rect.height) * span;
    const start = Math.max(from, Math.min(to - 30, Math.round(raw / 30) * 30));
    const entry: WeekEntry = { id: uid(), day, start, dur: Math.min(60, to - start), text: '' };
    patch({ entries: [...entries, entry] });
    setPop({ entryId: entry.id, x: e.clientX, y: e.clientY });
  };

  const hours: number[] = [];
  for (let m = from; m < to; m += 60) hours.push(m);
  // 15-Minuten-Auswahl für Von/Bis im Editor
  const steps: number[] = [];
  for (let m = from; m <= to; m += 15) steps.push(m);

  const popEntry = pop ? entries.find((e) => e.id === pop.entryId) : null;

  return (
    <CardShell id={id} selected={selected} minWidth={380} minHeight={280} className="week-card">
      <div className="week-wrap nodrag">
        <div className="week-head">
          <input
            className="week-title"
            value={data.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Wochenplan"
          />
          {selected && (
            <span className="week-tools">
              <select value={days} title="Mo–Fr oder ganze Woche" onChange={(e) => patch({ days: Number(e.target.value) })}>
                <option value={5}>Mo–Fr</option>
                <option value={7}>Mo–So</option>
              </select>
              <select value={from} title="Raster-Beginn" onChange={(e) => patch({ from: Math.min(Number(e.target.value), to - 60) })}>
                {[5, 6, 7, 8, 9, 10, 11, 12].map((h) => <option key={h} value={h * 60}>{h}:00</option>)}
              </select>
              <span className="week-sep">–</span>
              <select value={to} title="Raster-Ende" onChange={(e) => patch({ to: Math.max(Number(e.target.value), from + 60) })}>
                {[12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((h) => <option key={h} value={h * 60}>{h}:00</option>)}
              </select>
            </span>
          )}
        </div>
        <div className="week-daynames">
          <span className="week-gutter" />
          {DAY_SHORT.slice(0, days).map((d) => <span key={d} className="week-dayname">{d}</span>)}
        </div>
        <div className="week-grid" style={{ ['--week-hour' as string]: `${(60 / span) * 100}%` }}>
          <div className="week-gutter week-times">
            {hours.map((m) => (
              <span key={m} style={{ top: `${((m - from) / span) * 100}%` }}>{fmtTime(m)}</span>
            ))}
          </div>
          {Array.from({ length: days }, (_, day) => {
            const dayEntries = entries.filter((e) => e.day === day);
            const lanes = lanesFor(dayEntries);
            return (
              <div
                key={day}
                className="week-day"
                title="Klick legt einen Block an"
                onClick={(e) => addAt(day, e)}
              >
                {dayEntries.map((en) => {
                  const l = lanes.get(en.id) ?? { lane: 0, lanes: 1 };
                  const [bg, strong] = ENTRY_COLORS[(en.color ?? 0) % ENTRY_COLORS.length];
                  return (
                    <button
                      key={en.id}
                      className="week-entry"
                      style={{
                        top: `${((en.start - from) / span) * 100}%`,
                        height: `${(en.dur / span) * 100}%`,
                        left: `${(l.lane / l.lanes) * 100}%`,
                        width: `${100 / l.lanes}%`,
                        background: bg,
                        borderLeftColor: strong,
                        color: strong,
                      }}
                      title={`${fmtTime(en.start)}–${fmtTime(en.start + en.dur)} ${en.text}`}
                      onClick={(e) => { e.stopPropagation(); setPop({ entryId: en.id, x: e.clientX, y: e.clientY }); }}
                    >
                      <span className="week-entry-time">{fmtTime(en.start)}</span>
                      <span className="week-entry-text">{en.text || '…'}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {pop && popEntry && createPortal(
        <div
          className="week-pop nodrag"
          style={{ left: Math.min(pop.x, window.innerWidth - 260), top: Math.min(pop.y + 10, window.innerHeight - 230) }}
        >
          <input
            autoFocus
            className="week-pop-text"
            placeholder="Was ist geplant?"
            value={popEntry.text}
            onChange={(e) => patchEntry(popEntry.id, { text: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setPop(null); }}
          />
          <div className="week-pop-row">
            <select value={popEntry.day} onChange={(e) => patchEntry(popEntry.id, { day: Number(e.target.value) })}>
              {DAY_LONG.slice(0, days).map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <div className="week-pop-row">
            <select
              value={popEntry.start}
              onChange={(e) => {
                const start = Number(e.target.value);
                patchEntry(popEntry.id, { start, dur: Math.min(popEntry.dur, to - start) });
              }}
            >
              {steps.filter((m) => m < to).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
            </select>
            <span className="week-sep">bis</span>
            <select
              value={popEntry.start + popEntry.dur}
              onChange={(e) => patchEntry(popEntry.id, { dur: Number(e.target.value) - popEntry.start })}
            >
              {steps.filter((m) => m > popEntry.start).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
            </select>
          </div>
          <div className="week-pop-row week-pop-colors">
            {ENTRY_COLORS.map(([bg, strong], i) => (
              <button
                key={bg}
                className={`week-color-dot ${(popEntry.color ?? 0) === i ? 'on' : ''}`}
                style={{ background: bg, borderColor: strong }}
                title="Block-Farbe"
                onClick={() => patchEntry(popEntry.id, { color: i })}
              />
            ))}
            <span style={{ flex: 1 }} />
            <button className="week-pop-del" title="Block löschen" onClick={() => removeEntry(popEntry.id)}><IX size={13} /></button>
          </div>
        </div>,
        document.body,
      )}
    </CardShell>
  );
}
