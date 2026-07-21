import { useEffect, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { uid, type TimeData, type TimeNode, type TimeSeg } from '../../types';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
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

/** Ansichtsmodi (M161): Tag = editierbares Protokoll, Woche/Monat/Jahr =
 *  verdichtete Summen mit Absprung in die jeweils feinere Ebene */
type TimeView = 'tag' | 'woche' | 'monat' | 'jahr';
const VIEWS: Array<[TimeView, string]> = [['tag', 'Tag'], ['woche', 'Woche'], ['monat', 'Monat'], ['jahr', 'Jahr']];

const todayIso = () => new Date().toISOString().slice(0, 10);
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHM = (v: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2])) : null;
};
export const fmtDur = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
/** Kompakt für Zellen (Monat/Jahr): 7:30 statt „7:30 h" */
const fmtCell = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDayShort = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const addDaysIso = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00`).getTime() + n * 864e5).toISOString().slice(0, 10);
const addMonthsIso = (iso: string, n: number): string => {
  const d = new Date(`${iso.slice(0, 7)}-15T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Montag der Woche eines ISO-Datums */
const mondayOf = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  const off = (d.getDay() + 6) % 7;
  return addDaysIso(iso, -off);
};
const isoWeekNo = (iso: string): number => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - y0.getTime()) / 864e5 + 1) / 7);
};

/** Dauer eines Abschnitts — läuft er noch, zählt er bis JETZT */
const durOf = (s: TimeSeg): number => Math.max(0, (s.end ?? (s.date === todayIso() ? nowMin() : s.start)) - s.start);

/**
 * Zeiterfassung (M157/M161): so unkompliziert wie möglich.
 * - LIVE: Ein Klick auf eine Art startet sie; Klick auf eine andere Art
 *   beendet die laufende und startet nahtlos die neue. Stop beendet ohne
 *   Nachfolger — die Erfassungs-Leiste ist in JEDER Ansicht da.
 * - NACHERFASSEN: Tages-Ansicht, alle Zeilen direkt editierbar.
 * - ANSICHTEN (M161): Tag / Woche / Monat / Jahr — Woche zeigt Tageszeilen
 *   mit Arten-Aufteilung, Monat ein Kalenderraster mit Tagessummen, Jahr
 *   die Monatssummen. Klick auf Tag/Monat springt eine Ebene tiefer.
 *   Alle Summen ohne Pausen (Fahrzeit + Dienstgeschäft zählen mit).
 */
export function TimeCard({ id, data, selected }: NodeProps<TimeNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const [day, setDay] = useState(todayIso());
  const view: TimeView = (data.view as TimeView) ?? 'tag';
  const setView = (v: TimeView) => updateNodeData(id, { view: v });
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

  // ---------- Summen-Helfer (alle „ohne Pausen" außer je-Art-Aufteilung) ----------
  const workIn = (from: string, to: string) =>
    segs.filter((s) => s.date >= from && s.date <= to && s.kind !== 'pause').reduce((a, s) => a + durOf(s), 0);
  const kindsIn = (from: string, to: string) => {
    const m = new Map<TimeSeg['kind'], number>();
    for (const s of segs) if (s.date >= from && s.date <= to) m.set(s.kind, (m.get(s.kind) ?? 0) + durOf(s));
    return m;
  };

  const monday = mondayOf(day);
  const sunday = addDaysIso(monday, 6);
  const month = day.slice(0, 7);
  const monthDays = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0).getDate();
  const year = day.slice(0, 4);

  // ---------- Navigation je Ansicht ----------
  const step = (dir: 1 | -1) => {
    if (view === 'tag') setDay(addDaysIso(day, dir));
    else if (view === 'woche') setDay(addDaysIso(day, 7 * dir));
    else if (view === 'monat') setDay(addMonthsIso(day, dir));
    else setDay(addMonthsIso(day, 12 * dir));
  };
  const navLabel =
    view === 'tag' ? fmtDay(day)
      : view === 'woche' ? `KW ${isoWeekNo(day)} · ${fmtDayShort(monday)} – ${fmtDayShort(sunday)}`
        : view === 'monat' ? `${MONTHS[Number(day.slice(5, 7)) - 1]} ${year}`
          : year;
  const notToday =
    view === 'tag' ? day !== todayIso()
      : view === 'woche' ? mondayOf(todayIso()) !== monday
        : view === 'monat' ? todayIso().slice(0, 7) !== month
          : todayIso().slice(0, 4) !== year;

  // ---------- Tages-Ansicht ----------
  const rows = segs.filter((s) => s.date === day).sort((a, b) => a.start - b.start);
  const daySums = kindsIn(day, day);
  const dayWork = workIn(day, day);
  const weekWork = workIn(monday, sunday);

  return (
    <CardShell id={id} selected={selected} minWidth={380} minHeight={300} className="time-card">
      <div className="time-wrap">
        <div className="time-head">
          <DragTitle
            className="time-title"
            value={data.title}
            onChange={(v) => updateNodeData(id, { title: v })}
            placeholder="Zeiterfassung"
          />
          {running && (
            <span className="time-live" style={{ color: kindColor(running.kind) }}>
              ● {kindLabel(running.kind)} · seit {toHM(running.start)} · {fmtDur(durOf(running))}
            </span>
          )}
        </div>
        {/* Live-Erfassung: in JEDER Ansicht verfügbar — die laufende Art ist gefüllt */}
        <div className="time-rec nodrag">
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
        {/* Navigation + Ansichts-Umschalter */}
        <div className="time-nav nodrag">
          <button title="Zurück" onClick={() => step(-1)}><IChevronL size={14} /></button>
          <b>{navLabel}</b>
          <button title="Weiter" onClick={() => step(1)}><IChevronR size={14} /></button>
          {notToday && <button className="time-today" onClick={() => setDay(todayIso())}>Heute</button>}
          <span className="time-flex" />
          <span className="time-views">
            {VIEWS.map(([v, label]) => (
              <button key={v} className={view === v ? 'on' : ''} title={`${label}es-Ansicht`} onClick={() => setView(v)}>{label}</button>
            ))}
          </span>
          {view === 'tag' && (
            <button className="time-add" title="Eintrag nacherfassen (Zeile unten direkt editieren)" onClick={addManual}>
              <IPlus size={13} /> Eintrag
            </button>
          )}
        </div>

        {view === 'tag' && (
          /* Tages-Liste: alle Zeilen direkt editierbar = Nacherfassen & Korrigieren */
          <div className="time-rows nodrag">
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
        )}

        {view === 'woche' && (
          /* Wochen-Ansicht: eine Zeile je Tag mit Arten-Aufteilung — Klick = Tages-Protokoll */
          <div className="time-rows nodrag">
            {Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i)).map((d) => {
              const total = workIn(d, d);
              const ks = kindsIn(d, d);
              return (
                <button
                  key={d}
                  className={`time-wday ${d === todayIso() ? 'is-today' : ''} ${total === 0 ? 'is-empty' : ''}`}
                  title="Klick öffnet das Tages-Protokoll"
                  onClick={() => { setDay(d); setView('tag'); }}
                >
                  <span className="time-wday-name">{fmtDayShort(d)}</span>
                  <span className="time-wday-kinds">
                    {KINDS.filter(([k]) => ks.get(k)).map(([k, label, color]) => (
                      <span key={k} style={{ color }} title={label}>{label.slice(0, label === 'Dienstgeschäft' ? 6 : 5)} {fmtCell(ks.get(k)!)}</span>
                    ))}
                  </span>
                  <span className="time-wday-total">{total ? fmtDur(total) : '—'}</span>
                </button>
              );
            })}
          </div>
        )}

        {view === 'monat' && (
          /* Monats-Raster: Tagessummen ohne Pausen — Klick = Tages-Protokoll */
          <div className="time-month nodrag">
            {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => <span key={w} className="time-month-wd">{w}</span>)}
            {Array.from({ length: (new Date(`${month}-01T12:00:00`).getDay() + 6) % 7 }, (_, i) => <span key={`pad${i}`} />)}
            {Array.from({ length: monthDays }, (_, i) => {
              const d = `${month}-${String(i + 1).padStart(2, '0')}`;
              const total = workIn(d, d);
              return (
                <button
                  key={d}
                  className={`time-mday ${d === todayIso() ? 'is-today' : ''}`}
                  title={`${fmtDay(d)}${total ? ` — ${fmtDur(total)} (ohne Pausen)` : ''} · Klick öffnet den Tag`}
                  onClick={() => { setDay(d); setView('tag'); }}
                >
                  <span>{i + 1}</span>
                  {total > 0 && <b>{fmtCell(total)}</b>}
                </button>
              );
            })}
          </div>
        )}

        {view === 'jahr' && (
          /* Jahres-Übersicht: Monatssummen — Klick = Monats-Raster */
          <div className="time-year nodrag">
            {MONTHS.map((name, i) => {
              const m = `${year}-${String(i + 1).padStart(2, '0')}`;
              const last = new Date(Number(year), i + 1, 0).getDate();
              const total = workIn(`${m}-01`, `${m}-${String(last).padStart(2, '0')}`);
              return (
                <button
                  key={m}
                  className={`time-ymonth ${todayIso().slice(0, 7) === m ? 'is-today' : ''}`}
                  title={`${name} ${year}${total ? ` — ${fmtDur(total)} (ohne Pausen)` : ''} · Klick öffnet den Monat`}
                  onClick={() => { setDay(`${m}-15`); setView('monat'); }}
                >
                  <span>{name.slice(0, 3)}</span>
                  <b>{total ? fmtCell(total) : '—'}</b>
                </button>
              );
            })}
          </div>
        )}

        {/* Summen-Fuß je Ansicht (immer ohne Pausen; je-Art-Aufteilung im Tag) */}
        <div className="time-sums">
          {view === 'tag' && KINDS.filter(([k]) => daySums.get(k)).map(([k, label, color]) => (
            <span key={k} className="time-sum" style={{ color }}>{label} {fmtDur(daySums.get(k)!)}</span>
          ))}
          {view === 'woche' && KINDS.filter(([k]) => k !== 'pause' && kindsIn(monday, sunday).get(k)).map(([k, label, color]) => (
            <span key={k} className="time-sum" style={{ color }}>{label} {fmtDur(kindsIn(monday, sunday).get(k)!)}</span>
          ))}
          <span className="time-flex" />
          {view === 'tag' && (
            <>
              <span className="time-total" title="Tagessumme ohne Pausen (Arbeit + Fahrzeit + Dienstgeschäft)">Tag: <b>{fmtDur(dayWork)}</b></span>
              <span className="time-total" title="Wochensumme ohne Pausen (Mo–So der angezeigten Woche)">Woche: <b>{fmtDur(weekWork)}</b></span>
            </>
          )}
          {view === 'woche' && <span className="time-total">Woche: <b>{fmtDur(weekWork)}</b></span>}
          {view === 'monat' && <span className="time-total" title="Monatssumme ohne Pausen">Monat: <b>{fmtDur(workIn(`${month}-01`, `${month}-${String(monthDays).padStart(2, '0')}`))}</b></span>}
          {view === 'jahr' && <span className="time-total" title="Jahressumme ohne Pausen">Jahr: <b>{fmtDur(workIn(`${year}-01-01`, `${year}-12-31`))}</b></span>}
        </div>
      </div>
    </CardShell>
  );
}
