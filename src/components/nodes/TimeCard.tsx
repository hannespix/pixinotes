import { useEffect, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { uid, type TimeData, type TimeNode, type TimeSeg } from '../../types';
import { CardShell } from './CardShell';
import { IChevronL, IChevronR, IPlus, IX } from '../Icons';

/** Erfassungs-Arten: [Schlüssel, Label, Farbe]. Fahrzeit + Dienstgeschäft
 *  decken die Dienstreise ab; „zählt als Arbeitszeit" = alles außer Pause. */
const KINDS: Array<[TimeSeg['kind'], string, string]> = [
  ['arbeit', 'Arbeit', '#3c669c'],
  ['pause', 'Pause', '#9c6f1c'],
  ['fahrt', 'Fahrzeit', '#6a4da0'],
  ['dienst', 'Dienstgeschäft', '#35744a'],
];
const kindLabel = (k: TimeSeg['kind']) => KINDS.find(([key]) => key === k)?.[1] ?? k;
const kindColor = (k: TimeSeg['kind']) => KINDS.find(([key]) => key === k)?.[2] ?? '#5b6470';

const todayIso = () => new Date().toISOString().slice(0, 10);
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHM = (v: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2])) : null;
};
export const fmtDur = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const addDaysIso = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00`).getTime() + n * 864e5).toISOString().slice(0, 10);

/** Montag der Woche eines ISO-Datums */
const mondayOf = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  const off = (d.getDay() + 6) % 7;
  return addDaysIso(iso, -off);
};

/** Dauer eines Abschnitts — läuft er noch, zählt er bis JETZT */
const durOf = (s: TimeSeg): number => Math.max(0, (s.end ?? (s.date === todayIso() ? nowMin() : s.start)) - s.start);

/**
 * Zeiterfassung (M157): so unkompliziert wie möglich.
 * - LIVE: Ein Klick auf eine Art startet sie; Klick auf eine andere Art
 *   beendet die laufende und startet nahtlos die neue (Arbeit → Pause →
 *   Arbeit …). Stop beendet ohne Nachfolger. Bemerkung direkt am Eintrag.
 * - NACHERFASSEN: „＋ Eintrag" legt eine Zeile an; alle Zeilen sind direkt
 *   editierbar (native Zeitfelder — auch am Smartphone bequem).
 * - Tages-Navigation mit Summen je Art + Wochensumme (ohne Pausen).
 */
export function TimeCard({ id, data, selected }: NodeProps<TimeNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const [day, setDay] = useState(todayIso());
  // Live-Ticker: laufender Abschnitt zählt sichtbar hoch (minutengenau)
  const [, tick] = useState(0);
  const segs = data.segs ?? [];
  const running = segs.find((s) => s.end === undefined);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [running]);

  const patch = (next: TimeSeg[]) => updateNodeData(id, { segs: next });
  const patchSeg = (sid: string, p: Partial<TimeSeg>) =>
    patch(segs.map((s) => (s.id === sid ? { ...s, ...p } : s)));

  /** Laufenden Abschnitt beenden (falls über Mitternacht vergessen: bei 23:59) */
  const closeRunning = (list: TimeSeg[]): TimeSeg[] =>
    list.map((s) => {
      if (s.end !== undefined) return s;
      const end = s.date === todayIso() ? Math.max(s.start, nowMin()) : 1439;
      return { ...s, end };
    });

  /** Art anklicken: laufende Art nochmal = Stop, sonst nahtlos umschalten */
  const record = (kind: TimeSeg['kind']) => {
    if (running && running.kind === kind) { stop(); return; }
    const next = closeRunning(segs);
    next.push({ id: uid(), date: todayIso(), start: nowMin(), kind });
    patch(next);
    setDay(todayIso());
    if (!running) showToast(`⏱ ${kindLabel(kind)} läuft — Stop oder andere Art beendet den Eintrag.`);
  };

  const stop = () => {
    if (!running) return;
    patch(closeRunning(segs));
    showToast(`⏱ ${kindLabel(running.kind)} beendet (${fmtDur(durOf(running))}).`);
  };

  /** Nacherfassen: neue Zeile nach dem letzten Eintrag des angezeigten Tages */
  const addManual = () => {
    const dayRows = segs.filter((s) => s.date === day);
    const lastEnd = dayRows.reduce((m, s) => Math.max(m, s.end ?? s.start), 0);
    const start = dayRows.length ? Math.min(lastEnd, 1379) : 8 * 60;
    patch([...segs, { id: uid(), date: day, start, end: Math.min(start + 60, 1439), kind: 'arbeit' }]);
  };

  const rows = segs.filter((s) => s.date === day).sort((a, b) => a.start - b.start);
  const sums = new Map<TimeSeg['kind'], number>();
  for (const s of rows) sums.set(s.kind, (sums.get(s.kind) ?? 0) + durOf(s));
  const dayWork = rows.reduce((a, s) => a + (s.kind === 'pause' ? 0 : durOf(s)), 0);
  const monday = mondayOf(day);
  const sunday = addDaysIso(monday, 6);
  const weekWork = segs
    .filter((s) => s.date >= monday && s.date <= sunday && s.kind !== 'pause')
    .reduce((a, s) => a + durOf(s), 0);

  return (
    <CardShell id={id} selected={selected} minWidth={380} minHeight={300} className="time-card">
      <div className="time-wrap nodrag">
        <div className="time-head">
          <input
            className="time-title"
            value={data.title}
            onChange={(e) => updateNodeData(id, { title: e.target.value })}
            placeholder="Zeiterfassung"
          />
          {running && (
            <span className="time-live" style={{ color: kindColor(running.kind) }}>
              ● {kindLabel(running.kind)} · seit {toHM(running.start)} · {fmtDur(durOf(running))}
            </span>
          )}
        </div>
        {/* Live-Erfassung: eine Zeile Knöpfe — die laufende Art pulsiert */}
        <div className="time-rec">
          {KINDS.map(([k, label, color]) => (
            <button
              key={k}
              className={`time-kind ${running?.kind === k ? 'on' : ''}`}
              style={running?.kind === k ? { background: color, borderColor: color } : { color }}
              title={running?.kind === k ? `${label} läuft — Klick beendet` : running ? `Nahtlos zu ${label} wechseln` : `${label} jetzt starten`}
              onClick={() => record(k)}
            >
              {label}
            </button>
          ))}
          <button className="time-stop" disabled={!running} title="Laufenden Eintrag beenden" onClick={stop}>
            Stop
          </button>
        </div>
        {/* Tages-Navigation */}
        <div className="time-nav">
          <button title="Vortag" onClick={() => setDay(addDaysIso(day, -1))}><IChevronL size={14} /></button>
          <b>{fmtDay(day)}</b>
          <button title="Folgetag" onClick={() => setDay(addDaysIso(day, 1))}><IChevronR size={14} /></button>
          {day !== todayIso() && <button className="time-today" onClick={() => setDay(todayIso())}>Heute</button>}
          <span className="time-flex" />
          <button className="time-add" title="Eintrag nacherfassen (Zeile unten direkt editieren)" onClick={addManual}>
            <IPlus size={13} /> Eintrag
          </button>
        </div>
        {/* Tages-Liste: alle Zeilen direkt editierbar = Nacherfassen & Korrigieren */}
        <div className="time-rows">
          {rows.length === 0 && <div className="time-empty">Noch nichts erfasst — oben starten oder „＋ Eintrag" für die Nacherfassung.</div>}
          {rows.map((s) => (
            <div className="time-row" key={s.id} style={{ borderLeftColor: kindColor(s.kind) }}>
              <select value={s.kind} onChange={(e) => patchSeg(s.id, { kind: e.target.value as TimeSeg['kind'] })}>
                {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <input
                type="time"
                value={toHM(s.start)}
                onChange={(e) => { const m = fromHM(e.target.value); if (m !== null) patchSeg(s.id, { start: m }); }}
              />
              <span className="time-sep">–</span>
              {s.end === undefined ? (
                <span className="time-runlabel">läuft…</span>
              ) : (
                <input
                  type="time"
                  value={toHM(s.end)}
                  onChange={(e) => { const m = fromHM(e.target.value); if (m !== null) patchSeg(s.id, { end: Math.max(m, s.start) }); }}
                />
              )}
              <input
                className="time-note"
                placeholder="Bemerkung (Ort, Anlass …)"
                value={s.note ?? ''}
                onChange={(e) => patchSeg(s.id, { note: e.target.value })}
              />
              <span className="time-dur">{fmtDur(durOf(s))}</span>
              <button className="time-del" title="Eintrag löschen" onClick={() => patch(segs.filter((x) => x.id !== s.id))}><IX size={12} /></button>
            </div>
          ))}
        </div>
        {/* Summen: je Art + Tages- und Wochensumme (ohne Pausen) */}
        <div className="time-sums">
          {KINDS.filter(([k]) => sums.get(k)).map(([k, label, color]) => (
            <span key={k} className="time-sum" style={{ color }}>{label} {fmtDur(sums.get(k)!)}</span>
          ))}
          <span className="time-flex" />
          <span className="time-total" title="Tagessumme ohne Pausen (Arbeit + Fahrzeit + Dienstgeschäft)">Tag: <b>{fmtDur(dayWork)}</b></span>
          <span className="time-total" title="Wochensumme ohne Pausen (Mo–So der angezeigten Woche)">Woche: <b>{fmtDur(weekWork)}</b></span>
        </div>
      </div>
    </CardShell>
  );
}
