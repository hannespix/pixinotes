import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { uid, type WeekData, type WeekEntry, type WeekNode } from '../../types';
import { CardShell } from './CardShell';
import { IPlus, IX } from '../Icons';

const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** Block-Farben: [Fläche, Balken/Schrift] — kräftig genug für hell und dunkel */
const ENTRY_COLORS: Array<[string, string]> = [
  ['#dbe7f6', '#3c669c'], ['#dcedde', '#35744a'], ['#f6ead2', '#9c6f1c'],
  ['#f4dde3', '#a84a4a'], ['#e6def4', '#6a4da0'], ['#eceae4', '#5b6470'],
];

export const fmtTime = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

/** Nebenläufigkeits-Bahnen je Spalte: überlappende Blöcke stehen nebeneinander */
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
 * Universeller Planer (M153/M154): Raster aus SPALTEN × ZEILEN.
 * - Spalten: Wochentage (Mo–Fr/Mo–So) ODER frei benennbar — Personen, Räume,
 *   Maschinen, Projektphasen … beliebig ergänzen und entfernen.
 * - Zeilen: Uhrzeiten (Stundenraster) ODER eigene Einheiten — Schulstunden,
 *   Schichten, Sprints … frei benannt.
 * - Blöcke: Klick auf freien Slot legt an, Klick auf Block öffnet den Editor
 *   (Text, optionales Label/Person als Badge, Spalte, Von/Bis, Farbe, Löschen).
 * Damit deckt EINE Karte Stundenplan, Arbeitswoche, Dienstplan, Raumbelegung
 * und Schichtplan ab.
 */
export function WeekCard({ id, data, selected }: NodeProps<WeekNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const [pop, setPop] = useState<{ entryId: string; x: number; y: number } | null>(null);

  const days = data.days === 7 ? 7 : 5;
  const customCols = Array.isArray(data.cols) && data.cols.length >= 2;
  const cols: string[] = customCols ? (data.cols as string[]) : DAY_SHORT.slice(0, days);
  const axis: 'time' | 'slots' = data.axis === 'slots' ? 'slots' : 'time';
  const slots: string[] = Array.isArray(data.slots) && data.slots.length > 0
    ? (data.slots as string[])
    : ['1. Einheit', '2. Einheit', '3. Einheit', '4. Einheit'];
  const from = axis === 'slots' ? 0 : (typeof data.from === 'number' ? data.from : 480);
  const to = axis === 'slots' ? slots.length * 60 : (typeof data.to === 'number' && data.to > from ? data.to : from + 540);
  const span = to - from;
  const entries = (data.entries ?? []).filter((e) => e.day < cols.length && e.start < to);

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
    patch({ entries: (data.entries ?? []).map((e) => (e.id === eid ? { ...e, ...p } : e)) });
  const removeEntry = (eid: string) => {
    patch({ entries: (data.entries ?? []).filter((e) => e.id !== eid) });
    setPop(null);
  };

  // ---------- Spalten frei bearbeiten (M154) ----------
  const renameCol = (i: number, name: string) => {
    const next = [...cols];
    next[i] = name;
    patch({ cols: next }); // ab der ersten Umbenennung sind die Spalten „frei"
  };
  const addCol = () => patch({ cols: [...cols, `Spalte ${cols.length + 1}`] });
  const removeCol = (i: number) => {
    if (cols.length <= 2) return;
    patch({
      cols: cols.filter((_, k) => k !== i),
      entries: (data.entries ?? [])
        .filter((e) => e.day !== i)
        .map((e) => (e.day > i ? { ...e, day: e.day - 1 } : e)),
    });
  };

  // ---------- Eigene Zeilen bearbeiten (M154) ----------
  const renameSlot = (i: number, name: string) => {
    const next = [...slots];
    next[i] = name;
    patch({ slots: next });
  };
  const addSlot = () => patch({ axis: 'slots', slots: [...slots, `${slots.length + 1}. Einheit`] });
  const removeSlot = (i: number) => {
    if (slots.length <= 2) return;
    const s = i * 60;
    patch({
      slots: slots.filter((_, k) => k !== i),
      entries: (data.entries ?? []).flatMap((e) => {
        const end = e.start + e.dur;
        if (e.start >= s + 60) return [{ ...e, start: e.start - 60 }];
        if (end <= s) return [e];
        const dur = e.dur - 60;
        return dur <= 0 ? [] : [{ ...e, dur, start: Math.min(e.start, s) }];
      }),
    });
  };

  /** Klick auf freie Fläche einer Spalte → neuer Block im Raster */
  const addAt = (day: number, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const raw = from + ((e.clientY - rect.top) / rect.height) * span;
    const grid = axis === 'slots' ? 60 : 30;
    const start = Math.max(from, Math.min(to - grid, Math.floor(raw / grid) * grid));
    const entry: WeekEntry = { id: uid(), day, start, dur: Math.min(60, to - start), text: '' };
    patch({ entries: [...(data.entries ?? []), entry] });
    setPop({ entryId: entry.id, x: e.clientX, y: e.clientY });
  };

  const hours: number[] = [];
  if (axis === 'time') for (let m = from; m < to; m += 60) hours.push(m);
  // 15-Minuten-Auswahl für Von/Bis im Editor (Zeit-Achse)
  const steps: number[] = [];
  if (axis === 'time') for (let m = from; m <= to; m += 15) steps.push(m);

  const popEntry = pop ? entries.find((e) => e.id === pop.entryId) : null;
  const labelOf = (start: number, dur: number) =>
    axis === 'slots'
      ? (dur <= 60 ? slots[start / 60] ?? '' : `${slots[start / 60] ?? ''}–${slots[(start + dur) / 60 - 1] ?? ''}`)
      : fmtTime(start);

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
              <select
                value={customCols ? 'frei' : String(days)}
                title="Spalten: Wochentage oder frei benennbar (Personen, Räume …)"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'frei') patch({ cols: [...cols] });
                  else patch({ days: Number(v), cols: undefined });
                }}
              >
                <option value={5}>Mo–Fr</option>
                <option value={7}>Mo–So</option>
                <option value="frei">Freie Spalten</option>
              </select>
              <select
                value={axis}
                title="Zeilen: Uhrzeiten oder eigene Einheiten (Schulstunden, Schichten …)"
                onChange={(e) => patch({ axis: e.target.value === 'slots' ? 'slots' : 'time', ...(e.target.value === 'slots' ? { slots: [...slots] } : {}) })}
              >
                <option value="time">Uhrzeit</option>
                <option value="slots">Eigene Zeilen</option>
              </select>
              {axis === 'time' && (
                <>
                  <select value={from} title="Raster-Beginn" onChange={(e) => patch({ from: Math.min(Number(e.target.value), to - 60) })}>
                    {[5, 6, 7, 8, 9, 10, 11, 12].map((h) => <option key={h} value={h * 60}>{h}:00</option>)}
                  </select>
                  <span className="week-sep">–</span>
                  <select value={to} title="Raster-Ende" onChange={(e) => patch({ to: Math.max(Number(e.target.value), from + 60) })}>
                    {[12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((h) => <option key={h} value={h * 60}>{h}:00</option>)}
                  </select>
                </>
              )}
            </span>
          )}
        </div>
        <div className={`week-daynames ${axis === 'slots' ? 'wide-gutter' : ''}`}>
          <span className="week-gutter" />
          {cols.map((c, i) => (
            <span key={i} className="week-dayname">
              {selected ? (
                <input
                  className="week-col-input"
                  value={c}
                  title="Spalte umbenennen — schaltet auf freie Spalten um"
                  onChange={(e) => renameCol(i, e.target.value)}
                />
              ) : c}
              {selected && customCols && cols.length > 2 && (
                <button className="week-mini-x" title="Spalte entfernen (samt Blöcken)" onClick={() => removeCol(i)}><IX size={9} /></button>
              )}
            </span>
          ))}
          {selected && customCols && (
            <button className="week-mini-add" title="Spalte hinzufügen" onClick={addCol}><IPlus size={11} /></button>
          )}
        </div>
        <div className={`week-grid ${axis === 'slots' ? 'wide-gutter' : ''}`} style={{ ['--week-hour' as string]: `${(60 / span) * 100}%` }}>
          <div className="week-gutter week-times">
            {axis === 'time'
              ? hours.map((m) => (
                <span key={m} style={{ top: `${((m - from) / span) * 100}%` }}>{fmtTime(m)}</span>
              ))
              : slots.map((s, i) => (
                <span key={i} className="week-slot-label" style={{ top: `${((i * 60 + 30) / span) * 100}%` }}>
                  {selected ? (
                    <>
                      <input className="week-slot-input" value={s} onChange={(e) => renameSlot(i, e.target.value)} />
                      {slots.length > 2 && (
                        <button className="week-mini-x" title="Zeile entfernen" onClick={() => removeSlot(i)}><IX size={9} /></button>
                      )}
                    </>
                  ) : s}
                </span>
              ))}
            {axis === 'slots' && selected && (
              <button className="week-mini-add week-slot-add" title="Zeile hinzufügen" onClick={addSlot}><IPlus size={11} /></button>
            )}
          </div>
          {cols.map((_, day) => {
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
                      title={`${labelOf(en.start, en.dur)} ${en.text}${en.who ? ` (${en.who})` : ''}`}
                      onClick={(e) => { e.stopPropagation(); setPop({ entryId: en.id, x: e.clientX, y: e.clientY }); }}
                    >
                      <span className="week-entry-time">
                        {axis === 'time' ? fmtTime(en.start) : ''}
                        {en.who && <span className="week-entry-who">{en.who}</span>}
                      </span>
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
          style={{ left: Math.min(pop.x, window.innerWidth - 260), top: Math.min(pop.y + 10, window.innerHeight - 260) }}
        >
          <input
            autoFocus
            className="week-pop-text"
            placeholder="Was ist geplant?"
            value={popEntry.text}
            onChange={(e) => patchEntry(popEntry.id, { text: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setPop(null); }}
          />
          <input
            className="week-pop-text week-pop-who"
            placeholder="Label / Person / Raum (optional)"
            value={popEntry.who ?? ''}
            onChange={(e) => patchEntry(popEntry.id, { who: e.target.value })}
          />
          <div className="week-pop-row">
            <select value={popEntry.day} onChange={(e) => patchEntry(popEntry.id, { day: Number(e.target.value) })}>
              {(customCols ? cols : DAY_LONG.slice(0, days)).map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div className="week-pop-row">
            {axis === 'time' ? (
              <>
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
              </>
            ) : (
              <>
                <select
                  value={popEntry.start}
                  onChange={(e) => {
                    const start = Number(e.target.value);
                    patchEntry(popEntry.id, { start, dur: Math.min(popEntry.dur, to - start) });
                  }}
                >
                  {slots.map((s, i) => <option key={i} value={i * 60}>{s}</option>)}
                </select>
                <span className="week-sep">bis</span>
                <select
                  value={popEntry.start + popEntry.dur}
                  onChange={(e) => patchEntry(popEntry.id, { dur: Number(e.target.value) - popEntry.start })}
                >
                  {slots.map((s, i) => ((i + 1) * 60 > popEntry.start ? <option key={i} value={(i + 1) * 60}>{s}</option> : null))}
                </select>
              </>
            )}
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
