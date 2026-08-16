import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { doneCol, uid, type GanttData, type GanttNode, type GanttRow, type KanbanData } from '../../types';
import { collectTasks } from '../../lib/tasks';
import { linkedOfType } from '../../lib/moduleFeeds';
import {
  IArrowDown, IArrowUp, IDownload, IFit, IPalette, IPlus, ITarget, IUsers, IWand, IX, IZoomIn, IZoomOut,
} from '../Icons';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';

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
  /** M273: Während des Ziehens zeigt eine kleine Fahne die aktuellen Daten
   *  — man sieht BEIM Ziehen, wo der Vorgang landet, statt es hinterher am
   *  Tooltip nachzulesen (Muster aller professionellen Gantt-Werkzeuge). */
  const [dragRow, setDragRow] = useState<string | null>(null);
  const drag = useRef<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const dw = data.dayWidth ?? 24;
  /**
   * M271: Die Namensspalte ist verstellbar (Griff am Trenner).
   *
   * 128 Punkte fest schnitten jeden echten Vorgangsnamen ab — „Abstimmung
   * Fachbereich" wurde zu „Abstimmung Fachb…", und verbreitern ging nicht.
   */
  const labelW = Math.max(80, Math.min(320, (data.labelW as number | undefined) ?? LABEL_W));
  /**
   * M271: Der Scroll-Stand lebt im Zustand, damit die Monatsnamen KLEBEN.
   *
   * Vorher scrollten sie mit dem Inhalt weg — in der Tages-Skala stand oben
   * nur noch „26", weil „Aug. 26" längst links aus dem Bild war. Man wusste
   * schlicht nicht mehr, in welchem Monat man sich befindet.
   */
  const [scrollX, setScrollX] = useState(0);
  /**
   * M273: Auch der SENKRECHTE Scroll-Stand wird verfolgt — die Kopfzeile
   * (Monate, Tage, KW) fährt als Gruppe mit und bleibt immer im Bild, wie
   * in jedem professionellen Zeitplan-Werkzeug. Vorher scrollte sie bei
   * vielen Vorgängen aus dem Fenster, und man wusste nicht mehr, über
   * welchem Monat man gerade stand.
   */
  const [scrollY, setScrollY] = useState(0);
  const scrollRaf = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      setScrollX(scrollRef.current?.scrollLeft ?? 0);
      setScrollY(scrollRef.current?.scrollTop ?? 0);
    });
  };
  const rows = data.rows;
  const setRows = (next: GanttRow[]) => updateNodeData(id, { rows: next });

  // M170: Abo-Zeilen aus VERBUNDENEN Kanbans — offene Tickets mit Frist als
  // abgeleitete Meilensteine (id „abo:…"). Reine Anzeige: nicht persistiert,
  // nicht editierbar; sie verschwinden mit dem Pfeil oder wenn das Ticket
  // erledigt ist. Bearbeitet wird die Frist am Ticket selbst.
  const boards = useBoard((s) => s.boards);
  const aboRows = useMemo<GanttRow[]>(() => {
    const out: GanttRow[] = [];
    for (const n of linkedOfType(boards, id, 'kanban')) {
      const k = n.data as KanbanData;
      const kDone = doneCol(k);
      for (const it of k.items) {
        if (!it.due || it.col === kDone) continue;
        // Echo-Schutz: Tickets, die das Kanban aus DIESEM Zeitplan eingesammelt
        // hat, nicht als Abo-Meilenstein zurückspiegeln
        if (it.link?.nodeId === id) continue;
        out.push({ id: `abo:${n.id}:${it.id}`, name: it.text.slice(0, 60), start: it.due, end: it.due, color: '#8a8375' });
      }
    }
    return out.slice(0, 40);
  }, [boards, id]);
  const allRows = aboRows.length ? [...rows, ...aboRows] : rows;
  const isAbo = (rowId: string) => rowId.startsWith('abo:');

  // Zeitfenster: von frühestem Start bis spätestem Ende, plus Rand
  const allDays = allRows.flatMap((r) => [toDays(r.start), toDays(r.end)]);
  const todayD = Math.round(Date.now() / DAY);
  const minD = (allDays.length ? Math.min(...allDays) : todayD) - PAD_DAYS;
  /**
   * M279: Der rechte Auslauf ist in BILDPUNKTEN bemessen, nicht in Tagen.
   *
   * Zwei feste Puffertage sind bei 24 px/Tag genug — in der Jahres-Skala
   * (unter 1 px/Tag) aber praktisch nichts: Die letzte Raute wurde am Rand
   * abgeschnitten und die Namen neben den Balken liefen aus dem Bild
   * (Screenshot-Audit). 160 px reichen für Raute plus Beschriftung.
   */
  const maxD = (allDays.length ? Math.max(...allDays) : todayD + 14) + Math.max(PAD_DAYS, Math.ceil(160 / dw));
  const nDays = maxD - minD + 1;
  const chartW = nDays * dw;
  /**
   * M279: Das Raster füllt die Karte.
   *
   * Unter der letzten Zeile klaffte eine weiße Fläche ohne Bänder und Linien
   * (Screenshot-Audit) — sah aus wie ein abgeschnittenes Werkzeug. Jetzt
   * werden Geisterzeilen bis zur Unterkante gezeichnet: gleiche Bänder,
   * gleiche Trenner, nur ohne Inhalt. Doppelklick legt dort einen Vorgang an.
   */
  const [freiPx, setFreiPx] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const messen = () => setFreiPx(Math.max(0, el.clientHeight - HEAD_H));
    messen();
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /* Die Diagrammhöhe ist EXAKT der freie Platz (nie ein angefangenes
     Zeilen-Vielfaches darüber) — sonst stünde dauerhaft eine senkrechte
     Rollleiste da, die wiederum die Breite fräße. Das letzte Band wird vom
     SVG-Rand beschnitten, das ist unsichtbar und gewollt. */
  const chartH = Math.max(Math.max(1, allRows.length) * ROW_H, freiPx);
  const zeilenGesamt = Math.ceil(chartH / ROW_H);

  const x = (iso: string) => (toDays(iso) - minD) * dw;

  // Kopfzeilen-Segmente: normalerweise Monate — bei der Jahres-Skala (M188)
  // ganze JAHRE, sonst stünden bei einer Mehrjahres-Planung hundert
  // Monatskürzel übereinander und die Kopfzeile wäre unlesbar.
  const yearScale = dw < 1.2;
  const months: Array<{ label: string; x0: number; w: number }> = [];
  for (let d = minD; d <= maxD; d++) {
    const dt = new Date(d * DAY);
    const label = yearScale
      ? String(dt.getFullYear())
      : dt.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
    const last = months[months.length - 1];
    if (last && last.label === label) last.w += dw;
    else months.push({ label, x0: (d - minD) * dw, w: dw });
  }
  // Quartals-Striche als feine Zwischengliederung der Jahres-Ansicht
  const quarters: Array<{ x0: number; label: string; linie: boolean }> = [];
  if (yearScale) {
    for (let d = minD; d <= maxD; d++) {
      const dt = new Date(d * DAY);
      if (dt.getDate() !== 1 || dt.getMonth() % 3 !== 0) continue;
      // M279: Q1 bekommt sein LABEL (fehlte im Audit) — nur die Linie bleibt
      // weg, die zeichnet dort schon die Jahresgrenze
      quarters.push({ x0: (d - minD) * dw, label: `Q${Math.floor(dt.getMonth() / 3) + 1}`, linie: dt.getMonth() !== 0 });
    }
    // Beginnt das Fenster MITTEN im Quartal, hat das angeschnittene erste
    // Quartal keinen Anfangstag im Fenster — sein Schild fehlte dann ganz
    if (!quarters.length || quarters[0].x0 >= 24) {
      const dt = new Date(minD * DAY);
      quarters.unshift({ x0: 0, label: `Q${Math.floor(dt.getMonth() / 3) + 1}`, linie: false });
    }
  }

  // ---------- Drag: verschieben / Enden ziehen ----------
  const startDrag = (e: React.PointerEvent, row: GanttRow, mode: DragState['mode']) => {
    if (isAbo(row.id)) return; // Abo-Meilensteine: Frist wird am Ticket gepflegt
    e.stopPropagation();
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    // Screen-px pro Tag aus dem echten DOM ableiten — funktioniert bei jedem Zoom
    const pxPerDay = (svg.getBoundingClientRect().width / (chartW || 1)) * dw;
    drag.current = { rowId: row.id, mode, originX: e.clientX, origStart: row.start, origEnd: row.end, pxPerDay };
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* synthetische Pointer */ }
    setSelected(row.id);
    setDragRow(row.id);
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

  const endDrag = () => { drag.current = null; setDragRow(null); };

  /** M271: Trenner der Namensspalte ziehen */
  const spaltenzug = useRef<{ id: number; x0: number; w0: number } | null>(null);
  const spalteAnfassen = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    spaltenzug.current = { id: e.pointerId, x0: e.clientX, w0: labelW };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const spalteZiehen = (e: React.PointerEvent) => {
    const z = spaltenzug.current;
    if (!z || z.id !== e.pointerId) return;
    // Bildschirm-Punkte in Karten-Punkte umrechnen (Board-Zoom!): am eigenen
    // Element gemessen, wie beim Balken-Ziehen
    const el = scrollRef.current;
    const massstab = el ? el.getBoundingClientRect().width / el.offsetWidth : 1;
    updateNodeData(id, { labelW: Math.max(80, Math.min(320, z.w0 + (e.clientX - z.x0) / (massstab || 1))) });
  };
  const spalteLoslassen = () => { spaltenzug.current = null; };

  // ---------- Zeilen-Aktionen ----------
  const addRow = (startIso?: string) => {
    const start = startIso ?? fromDays(todayD);
    setRows([...rows, { id: uid(), name: `Vorgang ${rows.length + 1}`, start, end: addDays(start, 4), color: COLORS[rows.length % COLORS.length] }]);
  };

  /** M273: Doppelklick auf freie Fläche legt den Vorgang GENAU dort an —
   *  am angeklickten Tag, statt erst ＋ zu drücken und dann zu schieben. */
  const chartDoppelklick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('.gantt-bar')) return;
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const tag = minD + Math.floor(((e.clientX - r.left) / (r.width || 1)) * nDays);
    addRow(fromDays(Math.max(minD, Math.min(maxD, tag))));
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

  /**
   * M271: Das ganze Projekt ins Fenster einpassen.
   *
   * Beim Öffnen sah man in der Tages-Skala anderthalb Vorgänge und musste
   * quer scrollen; welchen Zoom man für „alles auf einen Blick" braucht,
   * musste man raten. Ein Klick rechnet ihn aus.
   */
  const einpassen = () => {
    const el = scrollRef.current;
    if (!el || allDays.length === 0) return;
    /**
     * M279: Der rechte Auslauf ist in PIXELN fest (160) — er darf nicht in
     * die Tagesbreite eingerechnet werden, sonst rechnet man im Kreis
     * (nDays hängt an dw, dw an nDays) und das Diagramm ragt hinterher doch
     * über das Fenster hinaus. Gerechnet wird über die reinen DATEN-Tage.
     */
    const datenTage = Math.max(...allDays) - Math.min(...allDays) + 1 + PAD_DAYS;
    const platz = el.clientWidth - labelW - 8 - 165;
    updateNodeData(id, { dayWidth: Math.max(0.3, Math.min(48, platz / Math.max(1, datenTage))) });
    el.scrollLeft = 0;
  };

  /**
   * M279: Zoomen und Skalenwechsel halten den ZEITPUNKT fest.
   *
   * Vorher blieb die Bildpunkt-Position stehen: Wer von Tagen auf Monate
   * schaltete, landete an einem beliebigen Datum irgendwo im Plan
   * (Screenshot-Audit: Sprung von „heute" mitten in den April des
   * Folgejahres). Jetzt wird das Datum in der Fenstermitte gemerkt und nach
   * der Änderung wieder dorthin gescrollt — wie in Miro & Co.
   */
  const setzeDw = (neu: number) => {
    const el = scrollRef.current;
    const dwNeu = Math.max(0.3, Math.min(48, neu));
    if (el) {
      const fenster = Math.max(50, el.clientWidth - labelW);
      const mitteTag = minD + (el.scrollLeft + fenster / 2) / dw;
      updateNodeData(id, { dayWidth: dwNeu });
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, (mitteTag - minD) * dwNeu - fenster / 2);
      });
    } else {
      updateNodeData(id, { dayWidth: dwNeu });
    }
  };

  const zoom = (dir: -1 | 1) =>
    // Schrittweite folgt der Größenordnung: im Jahres-Bereich sind ganze
    // Pixel pro Tag ein Riesensprung (ein Jahr = 365 × dayWidth)
    setzeDw(dw + dir * (dw <= 1.2 ? 0.15 : dw <= 8 ? 2 : 6));

  // M156: Zeit-Skala als Preset — Tage/Wochen/Monate sind nur dayWidth-Stufen,
  // Kopfzeile und Raster passen sich automatisch an
  const scale = dw >= 14 ? 'tage' : dw >= 4 ? 'wochen' : dw >= 1.2 ? 'monate' : 'jahre';
  const setScale = (v: string) => {
    const preset = v === 'tage' ? 24 : v === 'wochen' ? 6 : v === 'monate' ? 2 : 0.6;
    /**
     * M279: Eine Skala ist eine OBERGRENZE der Dichte, kein Zwang zur Lücke.
     *
     * Beim Bauprojekt über 2,5 Jahre füllte die Jahres-Skala nur die halbe
     * Karte, der Rest war weiß (Screenshot-Audit). Ist der Plan kürzer, als
     * die Skala hergibt, wird mindestens fensterfüllend gerechnet.
     */
    const platz = (scrollRef.current?.clientWidth ?? 800) - labelW - 8;
    setzeDw(Math.max(preset, nDays > 0 ? platz / nDays : preset));
  };

  /** ISO-Kalenderwoche (für die Wochen-Skala) */
  const isoWeek = (dt: Date): number => {
    const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  };

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
    el.scrollLeft = Math.max(0, labelW + (todayD - minD) * dw - el.clientWidth * 0.45);
  };
  // beim Öffnen automatisch zu heute springen
  useEffect(() => { scrollToToday(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
  const sel = rows.find((r) => r.id === selected);

  return (
    <div className="gantt-body">
      <div className="gantt-head">
        <DragTitle className="kanban-title" value={data.title} onChange={(v) => updateNodeData(id, { title: v })} placeholder="Zeitplan" />
        <div className="gantt-tools nodrag">
          <button title="Vorgang hinzufügen" onClick={() => addRow()}><IPlus size={14} /></button>
          <button title="Offene Aufgaben mit Frist als Meilensteine übernehmen" onClick={importTasks}><IDownload size={14} /></button>
          <button title="Konflikte auflösen (Terminkette nachziehen)" onClick={resolveConflicts}><IWand size={14} /></button>
          <button title="Nach Ressource gruppieren" onClick={groupByResource}><IUsers size={14} /></button>
          <button title="Zu heute springen" onClick={scrollToToday}><ITarget size={14} /></button>
          <button title="Alles einpassen — der ganze Zeitplan auf einen Blick" onClick={einpassen}><IFit size={14} /></button>
          <select
            className="gantt-scale"
            value={scale}
            title="Zeit-Skala: Tage, Wochen, Monate oder Jahre (Mehrjahres-Planung)"
            onChange={(e) => setScale(e.target.value)}
          >
            <option value="tage">Tage</option>
            <option value="wochen">Wochen</option>
            <option value="monate">Monate</option>
            <option value="jahre">Jahre</option>
          </select>
          <button title="Rauszoomen" onClick={() => zoom(-1)}><IZoomOut size={14} /></button>
          <button title="Reinzoomen" onClick={() => zoom(1)}><IZoomIn size={14} /></button>
        </div>
      </div>
      {sel && (
        <div className="gantt-rowbar nodrag">
          <span className="gantt-rowbar-name">{sel.name || 'Vorgang'}</span>
          {/* M271: Termine ALS DATUM eingeben — vorher ging Start/Ende nur
              durch tageweises Ziehen am Balken. Wer den 07.09. wollte, zog
              und zählte Kästchen. Start ändern VERSCHIEBT den Vorgang (die
              Dauer bleibt), Ende ändern verlängert/verkürzt ihn. */}
          <label title="Beginn — Ändern verschiebt den Vorgang, die Dauer bleibt">
            <input
              type="date"
              className="gantt-datum"
              value={sel.start}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const dauer = toDays(sel.end) - toDays(sel.start);
                patchRow(sel.id, { start: v, end: addDays(v, dauer) });
              }}
            />
          </label>
          <span className="gantt-bis">–</span>
          <label title="Ende — nie vor dem Beginn">
            <input
              type="date"
              className="gantt-datum"
              value={sel.end}
              min={sel.start}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                patchRow(sel.id, { end: toDays(v) < toDays(sel.start) ? sel.start : v });
              }}
            />
          </label>
          <span className="gantt-dauer" title="Dauer in Kalendertagen">
            {toDays(sel.end) - toDays(sel.start) + 1} Tg.
          </span>
          <button title="Farbe" onClick={() => patchRow(sel.id, { color: COLORS[(COLORS.indexOf(sel.color ?? COLORS[0]) + 1) % COLORS.length] })}><IPalette size={13} /></button>
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
      <div className="gantt-scroll nodrag nowheel" ref={scrollRef} onScroll={onScroll}>
        {/* Zeilen-Namen (fixe Spalte, Breite am Griff verstellbar — M271) */}
        <div className="gantt-labels" style={{ width: labelW, minWidth: labelW }}>
          {/* M273: Kopfzelle der Namensspalte — klebt oben wie die Zeitleiste,
              sonst stünden die Namen beim Scrollen über der Kopfzeile */}
          <div className="gantt-labels-kopf" style={{ height: HEAD_H, minHeight: HEAD_H }}>Vorgang</div>
          {allRows.map((r) => (
            <input
              key={r.id}
              className={`gantt-label ${selected === r.id ? 'sel' : ''} ${isAbo(r.id) ? 'abo' : ''}`}
              style={{ height: ROW_H }}
              value={r.name}
              readOnly={isAbo(r.id)}
              title={isAbo(r.id)
                ? `Abo aus verbundenem Kanban: „${r.name}" ist am ${fmtShort(r.start)} fällig — Frist am Ticket ändern, Pfeil löschen beendet das Abo`
                : `${fmtShort(r.start)} – ${fmtShort(r.end)}`}
              onFocus={() => { if (!isAbo(r.id)) setSelected(r.id); }}
              onChange={(e) => { if (!isAbo(r.id)) patchRow(r.id, { name: e.target.value }); }}
            />
          ))}
          <button className="gantt-addzeile" title="Neuen Vorgang anlegen (oder Doppelklick auf die freie Fläche am Wunschtag)" onClick={() => addRow()}>＋ Vorgang</button>
          <div
            className="gantt-spaltengriff"
            title="Ziehen: Namensspalte breiter oder schmaler"
            onPointerDown={spalteAnfassen}
            onPointerMove={spalteZiehen}
            onPointerUp={spalteLoslassen}
            onPointerCancel={spalteLoslassen}
          />
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
            onDoubleClick={chartDoppelklick}
          >
            <defs>
              <marker id={`gdep-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#8a8375" />
              </marker>
              <marker id={`gdep-warn-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#d84b3d" />
              </marker>
            </defs>
            {/* Wochenenden — bei Wochen-/Monats-Skala nur noch Rauschen */}
            {dw >= 6 && Array.from({ length: nDays }, (_, i) => {
              const dow = new Date((minD + i) * DAY).getDay();
              return dow === 0 || dow === 6 ? (
                <rect key={i} x={i * dw} y={HEAD_H} width={dw} height={chartH} fill="rgba(0,0,0,.045)" />
              ) : null;
            })}
            {/* Wochen-Raster (M156) — die KW-Beschriftung lebt in der Kopf-Gruppe */}
            {/* M279: Schwelle 1.8 statt 3 — in der Monats-Skala (2 px/Tag) gab
                es sonst GAR KEIN Feinraster zwischen den Monatslinien */}
            {dw < 16 && dw >= 1.8 && Array.from({ length: nDays }, (_, i) => {
              const dt = new Date((minD + i) * DAY);
              if (dt.getDay() !== 1) return null;
              return <line key={`w${i}`} x1={i * dw} y1={HEAD_H} x2={i * dw} y2={HEAD_H + chartH} stroke="rgba(0,0,0,.07)" />;
            })}
            {/* Quartals-Striche (nur Jahres-Skala) */}
            {quarters.filter((q) => q.linie).map((q, i) => (
              <line key={`q${i}`} x1={q.x0} y1={HEAD_H} x2={q.x0} y2={HEAD_H + chartH} stroke="rgba(0,0,0,.06)" />
            ))}
            {/* Monats-Striche über die volle Höhe */}
            {months.map((m, i) => (
              <line key={i} x1={m.x0} y1={HEAD_H} x2={m.x0} y2={HEAD_H + chartH} stroke="rgba(0,0,0,.12)" />
            ))}
            {/* M273: Zeilen-Bänder — jede zweite Zeile leicht getönt, die
                Zeile unter dem Zeiger hebt sich (CSS); Klick wählt den
                Vorgang auch auf freier Fläche aus. Das Auge hält so die Spur
                vom Namen bis zum Balken — das Grundmuster jedes
                professionellen Zeitplans. */}
            {Array.from({ length: zeilenGesamt }, (_, i) => {
              const r = allRows[i];
              return (
                <rect
                  key={`z${r?.id ?? `leer${i}`}`}
                  className={`gantt-zeile ${r && selected === r.id ? 'sel' : ''}`}
                  x={0} y={HEAD_H + i * ROW_H} width={chartW} height={ROW_H}
                  fill={i % 2 ? 'rgba(0,0,0,.02)' : 'transparent'}
                  onClick={() => { if (r && !isAbo(r.id)) setSelected(r.id); }}
                />
              );
            })}
            {/* Zeilen-Trenner */}
            {Array.from({ length: zeilenGesamt }, (_, i) => (
              <line key={i} x1={0} y1={HEAD_H + (i + 1) * ROW_H} x2={chartW} y2={HEAD_H + (i + 1) * ROW_H} stroke="rgba(0,0,0,.06)" pointerEvents="none" />
            ))}
            {/* Balken & Meilensteine (inkl. Abo-Meilensteine aus verbundenen Kanbans) */}
            {allRows.map((r, i) => {
              const y = HEAD_H + i * ROW_H + (ROW_H - BAR_H) / 2;
              const color = r.color ?? COLORS[0];
              const isMile = r.start === r.end;
              const title = isAbo(r.id)
                ? `Abo aus Kanban: „${r.name}" fällig am ${r.start}`
                : `${r.name}: ${r.start} → ${r.end}`;
              if (isMile) {
                const cx = x(r.start) + dw / 2;
                const cy = y + BAR_H / 2;
                return (
                  <g key={r.id} className="gantt-bar" onPointerDown={(e) => startDrag(e, r, 'move')}>
                    <title>{title}</title>
                    <polygon
                      points={`${cx},${cy - 9} ${cx + 9},${cy} ${cx},${cy + 9} ${cx - 9},${cy}`}
                      fill={isAbo(r.id) ? 'transparent' : color}
                      stroke={isAbo(r.id) ? color : selected === r.id ? '#2b2a27' : 'none'}
                      strokeWidth={isAbo(r.id) ? 2 : 1.5}
                      strokeDasharray={isAbo(r.id) ? '3 2' : undefined}
                      data-row={r.id}
                      data-start={r.start}
                      data-end={r.end}
                    />
                    {/* M273: Name neben der Raute — wie am Balken */}
                    {r.name && <text x={cx + 13} y={cy + 3.2} className="gantt-barlabel" pointerEvents="none">{r.name}</text>}
                  </g>
                );
              }
              const bx = x(r.start);
              // Mindestbreite 4px: In der Jahres-Skala (M188) ist ein Tag
              // deutlich schmaler als ein Pixel — kurze Vorgänge wären sonst
              // unsichtbar und damit auch nicht mehr anklickbar.
              const bw = Math.max(4, Math.max(dw, (toDays(r.end) - toDays(r.start) + 1) * dw) - 2);
              const prog = Math.max(0, Math.min(100, r.progress ?? 0));
              /**
               * M273: Der Name steht AM Balken (Miro/TeamGantt-Muster) —
               * vorher nur in der Spalte links, und wer weit gescrollt
               * hatte, sah bloß noch bunte Rechtecke. Passt der Name in den
               * Balken, steht er weiß darin (hinter dem Initialen-Kreis
               * beginnend); sonst grau daneben.
               */
              const nameB = (r.name?.length ?? 0) * 6.4 + 10;
              const innenX = bx + (r.who ? 22 : 8);
              const passtRein = bw - (r.who ? 24 : 10) >= nameB;
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
                  {/* M273: Fortschritt füllt den Balken in voller Höhe — der
                      4-Punkte-Strich von früher war auf einen Blick nicht von
                      einem Schatten zu unterscheiden. */}
                  {prog > 0 && (
                    <rect x={bx + 1} y={y} width={(bw * prog) / 100} height={BAR_H} rx={4} fill="rgba(0,0,0,.26)" pointerEvents="none" />
                  )}
                  {/* M279: Das Innen-Label klemmt am sichtbaren linken Rand —
                      bei einem Balken, dessen Anfang aus dem Bild gescrollt
                      ist, stand der Name sonst unsichtbar weit links */}
                  {r.name && (passtRein ? (
                    <text
                      x={Math.min(Math.max(innenX, scrollX + 6), bx + bw - nameB + 4)}
                      y={y + BAR_H / 2 + 3.2} className="gantt-barlabel innen" pointerEvents="none"
                    >{r.name}</text>
                  ) : (
                    <text x={bx + bw + 6} y={y + BAR_H / 2 + 3.2} className="gantt-barlabel" pointerEvents="none">{r.name}</text>
                  ))}
                  {/* M273: Beim ausgewählten Vorgang sind die Zieh-Enden
                      SICHTBAR (kleine Griffleisten) — vorher musste man
                      wissen, dass die unsichtbaren Ränder ziehbar sind. */}
                  {selected === r.id && (
                    <g pointerEvents="none">
                      <rect x={bx + 2} y={y + 3} width={3} height={BAR_H - 6} rx={1.5} fill="#fff" opacity={0.9} />
                      <rect x={bx + bw - 5} y={y + 3} width={3} height={BAR_H - 6} rx={1.5} fill="#fff" opacity={0.9} />
                    </g>
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
                <line x1={(todayD - minD) * dw + dw / 2} y1={HEAD_H} x2={(todayD - minD) * dw + dw / 2} y2={HEAD_H + chartH} stroke="#d84b3d" strokeWidth={1.5} strokeDasharray="4 3" />
              </g>
            )}
            {/**
              * M273: Die Kopfzeile KLEBT. Sie ist die letzte Gruppe im SVG
              * und fährt mit dem senkrechten Scroll-Stand mit — die Balken
              * schieben sich beim Scrollen unter sie, Monate/Tage/KW bleiben
              * immer lesbar. Genau das Verhalten von Miro, MS Project & Co.
              */}
            <g className="gantt-kopf" transform={`translate(0, ${scrollY})`}>
              <rect x={0} y={0} width={chartW} height={HEAD_H} className="gantt-kopfgrund" />
              <line x1={0} y1={HEAD_H} x2={chartW} y2={HEAD_H} stroke="rgba(0,0,0,.14)" />
              {months.map((m, i) => {
                /* M271: Der Monatsname klebt zusätzlich am linken Rand seines
                   sichtbaren Stücks, solange der Monat im Bild ist. */
                const textB = m.label.length * 7 + 8;
                const tx = Math.min(Math.max(m.x0 + 4, scrollX + 4), Math.max(m.x0 + 4, m.x0 + m.w - textB));
                return (
                  <g key={i}>
                    <line x1={m.x0} y1={0} x2={m.x0} y2={HEAD_H} stroke="rgba(0,0,0,.12)" />
                    <text x={tx} y={13} className="gantt-month">{m.label}</text>
                  </g>
                );
              })}
              {dw >= 16 && Array.from({ length: nDays }, (_, i) => (
                <text key={i} x={i * dw + dw / 2} y={HEAD_H - 6} className="gantt-day" textAnchor="middle">
                  {new Date((minD + i) * DAY).getDate()}
                </text>
              ))}
              {dw < 16 && dw >= 3 && dw * 7 >= 34 && Array.from({ length: nDays }, (_, i) => {
                const dt = new Date((minD + i) * DAY);
                if (dt.getDay() !== 1) return null;
                return <text key={`kw${i}`} x={i * dw + 3} y={HEAD_H - 6} className="gantt-day">KW {isoWeek(dt)}</text>;
              })}
              {quarters.map((q, i) => (dw * 91 >= 30
                ? <text key={`ql${i}`} x={q.x0 + 3} y={HEAD_H - 6} className="gantt-day">{q.label}</text>
                : null))}
              {/* M273: Heute-Fahne — die rote Linie hat jetzt einen Namen */}
              {/* M279: Die Fahne sitzt UNTER der Kopfzeile im Raster — in der
                  Zeile selbst verdeckte sie Tageszahlen und Quartalslabels */}
              {todayD >= minD && todayD <= maxD && (() => {
                const hx = (todayD - minD) * dw + dw / 2;
                return (
                  <g pointerEvents="none">
                    <rect x={hx - 21} y={HEAD_H + 2} width={42} height={13} rx={6.5} fill="#d84b3d" />
                    <text x={hx} y={HEAD_H + 11.5} textAnchor="middle" className="gantt-heute-text">Heute</text>
                  </g>
                );
              })()}
            </g>
          </svg>
          {/* M273: Datums-Fahne am Vorgang, solange gezogen wird */}
          {dragRow && (() => {
            const r = rows.find((x) => x.id === dragRow);
            if (!r) return null;
            const i = rowIndex.get(r.id) ?? 0;
            const tage = toDays(r.end) - toDays(r.start) + 1;
            return (
              <div
                className="gantt-dragtip"
                style={{ left: x(r.start), top: HEAD_H + i * ROW_H - 24 }}
              >
                {fmtShort(r.start)} – {fmtShort(r.end)} · {tage} Tg.
              </div>
            );
          })()}
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
