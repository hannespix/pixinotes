import { useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { uid, type GanttData, type GanttNode, type GanttRow } from '../../types';
import { collectTasks } from '../../lib/tasks';
import {
  IArrowDown, IArrowUp, IDownload, IPlus, ITarget, IUsers, IWand, IX, IZoomIn, IZoomOut,
} from '../Icons';
import { CardShell } from './CardShell';

const DAY = 864e5;
const ROW_H = 26;
const BAR_H = 15;
const HEAD_H = 34;
const LABEL_W = 128;
const PAD_DAYS = 2;
const COLORS = ['#4f7cff', '#3fa564', '#e07a3f', '#a05fd4', '#d44f6e', '#2b2a27'];

// UTC-reine Tagesarithmetik — T12:00-Local + round kippt in UTC-Zeitzonen (exakt ,5) um einen Tag
const toDays = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
const fromDays = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => fromDays(toDays(iso) + n);
const fmtShort = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

interface DragState {
  rowId: string;
  mode: 'move' | 'start' | 'end';
  originX: number;
  origStart: string;
  origEnd: string;
  /** Screen-Pixel pro Tag (berücksichtigt Board-Zoom — per DOM gemessen) */
  pxPerDay: number;
}

/**
 * Interaktiver Zeitplan (Gantt): Balken per Drag verschieben, an den Enden
 * ziehen zum Verlängern, Meilensteine als Rauten (start = end), Fortschritt,
 * Heute-Linie, Wochenend-Raster, Zoom. Läuft identisch auf dem Board und
 * als editierbare Präsentations-Folie.
 */
export function GanttBody({ id, data }: { id: string; data: GanttData }) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const dw = data.dayWidth ?? 24;
  const rows = data.rows;
  const setRows = (next: GanttRow[]) => updateNodeData(id, { rows: next });

  // Zeitfenster: von frühestem Start bis spätestem Ende, plus Rand
  const allDays = rows.flatMap((r) => [toDays(r.start), toDays(r.end)]);
  const todayD = Math.round(Date.now() / DAY);
  const minD = (allDays.length ? Math.min(...allDays) : todayD) - PAD_DAYS;
  const maxD = (allDays.length ? Math.max(...allDays) : todayD + 14) + PAD_DAYS;
  const nDays = maxD - minD + 1;
  const chartW = nDays * dw;
  const chartH = Math.max(1, rows.length) * ROW_H;

  const x = (iso: string) => (toDays(iso) - minD) * dw;

  // Monats-Segmente für die Kopfzeile
  const months: Array<{ label: string; x0: number; w: number }> = [];
  for (let d = minD; d <= maxD; d++) {
    const dt = new Date(d * DAY);
    const label = dt.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
    const last = months[months.length - 1];
    if (last && last.label === label) last.w += dw;
    else months.push({ label, x0: (d - minD) * dw, w: dw });
  }

  // ---------- Drag: verschieben / Enden ziehen ----------
  const startDrag = (e: React.PointerEvent, row: GanttRow, mode: DragState['mode']) => {
    e.stopPropagation();
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    // Screen-px pro Tag aus dem echten DOM ableiten — funktioniert bei jedem Zoom
    const pxPerDay = (svg.getBoundingClientRect().width / (chartW || 1)) * dw;
    drag.current = { rowId: row.id, mode, originX: e.clientX, origStart: row.start, origEnd: row.end, pxPerDay };
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* synthetische Pointer */ }
    setSelected(row.id);
  };

  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.originX) / (d.pxPerDay || 1));
    if (delta === 0) return;
    setRows(rows.map((r) => {
      if (r.id !== d.rowId) return r;
      if (d.mode === 'move') return { ...r, start: addDays(d.origStart, delta), end: addDays(d.origEnd, delta) };
      if (d.mode === 'start') {
        const ns = addDays(d.origStart, delta);
        return { ...r, start: toDays(ns) > toDays(r.end) ? r.end : ns };
      }
      const ne = addDays(d.origEnd, delta);
      return { ...r, end: toDays(ne) < toDays(r.start) ? r.start : ne };
    }));
  };

  const endDrag = () => { drag.current = null; };

  // ---------- Zeilen-Aktionen ----------
  const addRow = () => {
    const start = fromDays(todayD);
    setRows([...rows, { id: uid(), name: `Vorgang ${rows.length + 1}`, start, end: addDays(start, 4), color: COLORS[rows.length % COLORS.length] }]);
  };
  const patchRow = (rowId: string, patch: Partial<GanttRow>) =>
    setRows(rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  const removeRow = (rowId: string) => setRows(rows.filter((r) => r.id !== rowId));

  /** Offene Kanban-Tickets mit Frist (alle Boards) als Meilensteine übernehmen */
  const importTasks = () => {
    const tasks = collectTasks(useBoard.getState().boards).filter((t) => t.due);
    const known = new Set(rows.map((r) => `${r.name}|${r.start}`));
    const fresh = tasks
      .filter((t) => !known.has(`${t.text}|${t.due}`))
      .map((t, i) => ({ id: uid(), name: t.text, start: t.due!, end: t.due!, color: COLORS[(rows.length + i) % COLORS.length] }));
    if (fresh.length === 0) { showToast('Keine (neuen) Aufgaben mit Fälligkeitsdatum gefunden.'); return; }
    setRows([...rows, ...fresh]);
    showToast(`📅 ${fresh.length} Frist(en) als Meilensteine übernommen`);
  };

  const zoom = (dir: -1 | 1) =>
    updateNodeData(id, { dayWidth: Math.max(10, Math.min(48, dw + dir * 6)) });

  /** Vorgänger setzen — mit Zyklus-Schutz (A→B→A wäre Endlosschleife) */
  const setDep = (rowId: string, dep: string) => {
    if (dep) {
      let cur: string | undefined = dep;
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (let i = 0; cur && i <= rows.length; i++) {
        if (cur === rowId) { showToast('⚠️ Zirkuläre Abhängigkeit — nicht möglich.'); return; }
        cur = byId.get(cur)?.dep;
      }
    }
    patchRow(rowId, { dep: dep || undefined });
  };

  /** Nach Ressource gruppieren: Zeilen stabil nach `who` sortieren (ohne Ressource ans Ende) */
  const groupByResource = () => {
    setRows([...rows].sort((a, b) => {
      const aw = a.who?.trim() ?? '';
      const bw = b.who?.trim() ?? '';
      if (!aw && bw) return 1;
      if (aw && !bw) return -1;
      return aw.localeCompare(bw);
    }));
    showToast('👥 Nach Ressource gruppiert');
  };

  const initials = (who?: string) =>
    (who ?? '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  /** Konflikte auflösen: abhängige Vorgänge topologisch nach ihren Vorgängern terminieren */
  const resolveConflicts = () => {
    let next = [...rows];
    let changed = false;
    // genug Pässe für lineare Ketten beliebiger Länge (Audit R6-F10)
    for (let pass = 0; pass < next.length + 2; pass++) {
      let any = false;
      next = next.map((r) => {
        if (!r.dep) return r;
        const d = next.find((x) => x.id === r.dep);
        if (!d) return r;
        const delta = toDays(d.end) + 1 - toDays(r.start);
        if (delta > 0) {
          any = true;
          changed = true;
          return { ...r, start: addDays(r.start, delta), end: addDays(r.end, delta) };
        }
        return r;
      });
      if (!any) break;
    }
    if (changed) { setRows(next); showToast('Terminkette aufgelöst — abhängige Vorgänge nachgezogen'); }
    else showToast('Keine Terminkonflikte vorhanden.');
  };

  /** Zeile in der Reihenfolge verschieben */
  const moveRow = (rowId: string, dir: -1 | 1) => {
    const i = rows.findIndex((r) => r.id === rowId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };

  /** Heute-Linie ins Blickfeld scrollen */
  const scrollToToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, LABEL_W + (todayD - minD) * dw - el.clientWidth * 0.45);
  };
  // beim Öffnen automatisch zu heute springen
  useEffect(() => { scrollToToday(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
  const sel = rows.find((r) => r.id === selected);

  return (
    <div className="gantt-body">
      <div className="gantt-head">
        <input className="kanban-title nodrag" value={data.title} onChange={(e) => updateNodeData(id, { title: e.target.value })} />
        <div className="gantt-tools nodrag">
          <button title="Vorgang hinzufügen" onClick={addRow}><IPlus size={14} /></button>
          <button title="Offene Aufgaben mit Frist als Meilensteine übernehmen" onClick={importTasks}><IDownload size={14} /></button>
          <button title="Konflikte auflösen (Terminkette nachziehen)" onClick={resolveConflicts}><IWand size={14} /></button>
          <button title="Nach Ressource gruppieren" onClick={groupByResource}><IUsers size={14} /></button>
          <button title="Zu heute springen" onClick={scrollToToday}><ITarget size={14} /></button>
          <button title="Rauszoomen" onClick={() => zoom(-1)}><IZoomOut size={14} /></button>
          <button title="Reinzoomen" onClick={() => zoom(1)}><IZoomIn size={14} /></button>
        </div>
      </div>
      {sel && (
        <div className="gantt-rowbar nodrag">
          <span className="gantt-rowbar-name">{sel.name || 'Vorgang'}</span>
          <button title="Farbe" onClick={() => patchRow(sel.id, { color: COLORS[(COLORS.indexOf(sel.color ?? COLORS[0]) + 1) % COLORS.length] })}>🎨</button>
          <label>Fortschritt
            <select value={sel.progress ?? 0} onChange={(e) => patchRow(sel.id, { progress: Number(e.target.value) })}>
              {[0, 25, 50, 75, 100].map((p) => <option key={p} value={p}>{p}%</option>)}
            </select>
          </label>
          {sel.start === sel.end ? (
            <button title="Zurück zum Balken (4 Tage Dauer — Enden danach ziehbar)" onClick={() => patchRow(sel.id, { end: addDays(sel.start, 3) })}>▬</button>
          ) : (
            <button title="Zum Meilenstein machen (Dauer 0 — ▬ macht es rückgängig)" onClick={() => patchRow(sel.id, { end: sel.start })}>◆</button>
          )}
          <label title="Ressource/Person">👤
            <input
              className="gantt-who"
              placeholder="wer?"
              value={sel.who ?? ''}
              onChange={(e) => patchRow(sel.id, { who: e.target.value || undefined })}
            />
          </label>
          <label title="Vorgänger (Finish-to-Start)">↳
            <select value={sel.dep ?? ''} onChange={(e) => setDep(sel.id, e.target.value)}>
              <option value="">— kein Vorgänger —</option>
              {rows.filter((r) => r.id !== sel.id).map((r) => (
                <option key={r.id} value={r.id}>{r.name || 'Vorgang'}</option>
              ))}
            </select>
          </label>
          <button title="Zeile nach oben" onClick={() => moveRow(sel.id, -1)}><IArrowUp size={12} /></button>
          <button title="Zeile nach unten" onClick={() => moveRow(sel.id, 1)}><IArrowDown size={12} /></button>
          <button title="Vorgang löschen" onClick={() => { removeRow(sel.id); setSelected(null); }}><IX size={12} /></button>
          <button title="Auswahl schließen" onClick={() => setSelected(null)}>—</button>
        </div>
      )}
      <div className="gantt-scroll nodrag nowheel" ref={scrollRef}>
        {/* Zeilen-Namen (fixe Spalte) */}
        <div className="gantt-labels" style={{ paddingTop: HEAD_H }}>
          {rows.map((r) => (
            <input
              key={r.id}
              className={`gantt-label ${selected === r.id ? 'sel' : ''}`}
              style={{ height: ROW_H }}
              value={r.name}
              title={`${fmtShort(r.start)} – ${fmtShort(r.end)}`}
              onFocus={() => setSelected(r.id)}
              onChange={(e) => patchRow(r.id, { name: e.target.value })}
            />
          ))}
        </div>
        {/* Diagramm */}
        <div className="gantt-chartwrap">
          <svg
            ref={svgRef}
            className="gantt-svg"
            width={chartW}
            height={HEAD_H + chartH}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <defs>
              <marker id={`gdep-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#8a8375" />
              </marker>
              <marker id={`gdep-warn-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#d84b3d" />
              </marker>
            </defs>
            {/* Wochenenden */}
            {Array.from({ length: nDays }, (_, i) => {
              const dow = new Date((minD + i) * DAY).getDay();
              return dow === 0 || dow === 6 ? (
                <rect key={i} x={i * dw} y={HEAD_H} width={dw} height={chartH} fill="rgba(0,0,0,.045)" />
              ) : null;
            })}
            {/* Monats-Kopf */}
            {months.map((m, i) => (
              <g key={i}>
                <line x1={m.x0} y1={0} x2={m.x0} y2={HEAD_H + chartH} stroke="rgba(0,0,0,.12)" />
                <text x={m.x0 + 4} y={13} className="gantt-month">{m.label}</text>
              </g>
            ))}
            {/* Tages-Kopf (nur wenn genug Platz) */}
            {dw >= 16 && Array.from({ length: nDays }, (_, i) => (
              <text key={i} x={i * dw + dw / 2} y={HEAD_H - 6} className="gantt-day" textAnchor="middle">
                {new Date((minD + i) * DAY).getDate()}
              </text>
            ))}
            {/* Zeilen-Trenner */}
            {rows.map((_, i) => (
              <line key={i} x1={0} y1={HEAD_H + (i + 1) * ROW_H} x2={chartW} y2={HEAD_H + (i + 1) * ROW_H} stroke="rgba(0,0,0,.06)" />
            ))}
            {/* Balken & Meilensteine */}
            {rows.map((r, i) => {
              const y = HEAD_H + i * ROW_H + (ROW_H - BAR_H) / 2;
              const color = r.color ?? COLORS[0];
              const isMile = r.start === r.end;
              const title = `${r.name}: ${r.start} → ${r.end}`;
              if (isMile) {
                const cx = x(r.start) + dw / 2;
                const cy = y + BAR_H / 2;
                return (
                  <g key={r.id} className="gantt-bar" onPointerDown={(e) => startDrag(e, r, 'move')}>
                    <title>{title}</title>
                    <polygon
                      points={`${cx},${cy - 9} ${cx + 9},${cy} ${cx},${cy + 9} ${cx - 9},${cy}`}
                      fill={color}
                      stroke={selected === r.id ? '#2b2a27' : 'none'}
                      strokeWidth={1.5}
                      data-row={r.id}
                      data-start={r.start}
                      data-end={r.end}
                    />
                  </g>
                );
              }
              const bx = x(r.start);
              const bw = Math.max(dw, (toDays(r.end) - toDays(r.start) + 1) * dw) - 2;
              const prog = Math.max(0, Math.min(100, r.progress ?? 0));
              return (
                <g key={r.id} className="gantt-bar">
                  <title>{title}</title>
                  <rect
                    x={bx + 1} y={y} width={bw} height={BAR_H} rx={4}
                    fill={color} opacity={0.82}
                    stroke={selected === r.id ? '#2b2a27' : 'none'} strokeWidth={1.5}
                    data-row={r.id} data-start={r.start} data-end={r.end}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => startDrag(e, r, 'move')}
                  />
                  {prog > 0 && (
                    <rect x={bx + 1} y={y + BAR_H - 4} width={(bw * prog) / 100} height={4} rx={2} fill="rgba(0,0,0,.45)" pointerEvents="none" />
                  )}
                  <rect x={bx - 2} y={y} width={7} height={BAR_H} fill="transparent" style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, r, 'start')} />
                  <rect x={bx + bw - 4} y={y} width={8} height={BAR_H} fill="transparent" style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startDrag(e, r, 'end')} />
                </g>
              );
            })}
            {/* Ressourcen-Initialen an Balken/Meilensteinen */}
            {rows.map((r, i) => {
              if (!r.who) return null;
              const y = HEAD_H + i * ROW_H + ROW_H / 2;
              const isMile = r.start === r.end;
              const cx = isMile ? x(r.start) + dw / 2 : x(r.start) + 1 + 9;
              const cy = isMile ? y - 13 : y;
              return (
                <g key={`w${r.id}`} pointerEvents="none">
                  <circle cx={cx} cy={cy} r={7.5} fill="#fff" stroke={r.color ?? COLORS[0]} strokeWidth={1.5} />
                  <text x={cx} y={cy + 2.6} textAnchor="middle" className="gantt-who-badge">{initials(r.who)}</text>
                </g>
              );
            })}
            {/* Abhängigkeits-Pfeile (Finish-to-Start); rot = Konflikt (Start vor Vorgänger-Ende) */}
            {rows.map((r) => {
              if (!r.dep) return null;
              const d = rows.find((rr) => rr.id === r.dep);
              const di = rowIndex.get(r.dep ?? '');
              const ri = rowIndex.get(r.id);
              if (!d || di === undefined || ri === undefined) return null;
              const dMile = d.start === d.end;
              const rMile = r.start === r.end;
              const ex = dMile
                ? x(d.start) + dw / 2 + 9
                : x(d.start) + Math.max(dw, (toDays(d.end) - toDays(d.start) + 1) * dw) - 1;
              const ey = HEAD_H + di * ROW_H + ROW_H / 2;
              const sx = rMile ? x(r.start) + dw / 2 - 9 : x(r.start) + 1;
              const sy = HEAD_H + ri * ROW_H + ROW_H / 2;
              // auch Meilensteine rot markieren — „Konflikte auflösen" verschiebt
              // sie ja ebenfalls, das Feedback muss dazu passen (Audit R6-F6)
              const conflict = toDays(r.start) <= toDays(d.end);
              const midX = Math.max(ex + 8, sx - 8);
              const path = `M${ex},${ey} L${ex + 8},${ey} L${ex + 8},${sy} L${midX},${sy} L${sx - 2},${sy}`;
              return (
                <path
                  key={`d${r.id}`}
                  d={path}
                  fill="none"
                  stroke={conflict ? '#d84b3d' : '#8a8375'}
                  strokeWidth={1.4}
                  strokeDasharray={conflict ? '4 3' : undefined}
                  markerEnd={`url(#gdep${conflict ? '-warn' : ''}-${id})`}
                  pointerEvents="none"
                  data-dep-of={r.id}
                  data-conflict={conflict ? '1' : '0'}
                />
              );
            })}
            {/* Heute-Linie */}
            {todayD >= minD && todayD <= maxD && (
              <g className="gantt-today">
                <line x1={(todayD - minD) * dw + dw / 2} y1={HEAD_H - 4} x2={(todayD - minD) * dw + dw / 2} y2={HEAD_H + chartH} stroke="#d84b3d" strokeWidth={1.5} strokeDasharray="4 3" />
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

/** Gantt als Karte auf dem Whiteboard. */
export function GanttCard({ id, data, selected }: NodeProps<GanttNode>) {
  return (
    <CardShell id={id} selected={selected} minWidth={420} minHeight={190} className="gantt-card">
      <GanttBody id={id} data={data} />
    </CardShell>
  );
}
