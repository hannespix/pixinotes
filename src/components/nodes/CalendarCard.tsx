import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { CalendarData, CalendarNode, GanttData } from '../../types';
import { collectTasks } from '../../lib/tasks';
import { downloadIcsEvents, fetchIcsUrl, mergeEvents, parseIcs, type IcsEvent } from '../../lib/ics';
import { anyAccountConnected, fetchAccountEvents, invalidateAccountEvents, type CalAccountEvent } from '../../lib/calAccounts';
import { IChevronL, IChevronR, ISettings } from '../Icons';
import { CardShell } from './CardShell';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY = 864e5;

interface CalEntry {
  icon: string;
  text: string;
  boardId?: string;
  nodeId?: string;
  color?: string;
  urgent?: boolean;
  ext?: boolean;
}
interface CalStrip {
  text: string;
  color: string;
  boardId?: string;
  nodeId?: string;
  startsHere: boolean;
  ext?: boolean;
}

interface ShowFlags { tasks: boolean; gantt: boolean; miles: boolean; ics: boolean; konto: boolean }
const SHOW_DEFAULT: ShowFlags = { tasks: true, gantt: true, miles: true, ics: true, konto: true };
const SHOW_LABEL: Record<keyof ShowFlags, string> = {
  tasks: 'Kanban-Fristen',
  gantt: 'Zeitplan-Balken',
  miles: 'Meilensteine',
  ics: 'Externe Termine (ICS)',
  konto: 'Konto-Termine (Google/M365)',
};
/** Anzeigefarben der verbundenen Konten (Google-Blau, Microsoft-Blau) */
const PROVIDER_COLOR: Record<CalAccountEvent['provider'], string> = { google: '#4285f4', ms: '#0f6cbd' };

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOf = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);

/**
 * Kalender-Karte: Monat/Woche mit wählbaren Quellen — Kanban-Fristen,
 * Zeitplan-Balken/Meilensteine und EXTERNE Termine (.ics-Import & URL-Abos:
 * Outlook, Google, Apple, Nextcloud). Export des Sichtbaren als .ics.
 */
export function CalendarBody({ id, data }: { id: string; data: CalendarData }) {
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const presenting = useBoard((s) => s.presenting);
  const setPresenting = useBoard((s) => s.setPresenting);
  const showToast = useBoard((s) => s.showToast);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Termine aus verbundenen Konten (Google/Microsoft) — live gefetcht,
  // NICHT persistiert (die Tokens liegen ohnehin nur lokal)
  const [accEvents, setAccEvents] = useState<CalAccountEvent[]>([]);
  const [accError, setAccError] = useState('');
  const [accTick, setAccTick] = useState(0);
  useEffect(() => {
    const onAcc = () => setAccTick((t) => t + 1);
    window.addEventListener('pixinotes-cal-accounts', onAcc);
    return () => window.removeEventListener('pixinotes-cal-accounts', onAcc);
  }, []);

  const view = (data.view as 'month' | 'week') ?? 'month';
  const scope = (data.scope as 'all' | 'board') ?? 'all';
  const show = { ...SHOW_DEFAULT, ...(data.show as Partial<ShowFlags> | undefined) };
  const icsEvents = (data.icsEvents as IcsEvent[] | undefined) ?? [];
  const icsUrls = (data.icsUrls as string[] | undefined) ?? [];
  const sourceBoards = scope === 'board' ? boards.filter((b) => b.id === activeId) : boards;

  const todayIso = isoOf(new Date());
  const ym = (data.month as string) ?? ymOf(new Date());
  const [year, month] = ym.split('-').map(Number);
  const anchorIso = (data.anchor as string) ?? todayIso;

  useEffect(() => {
    const showKonto = (data.show as Partial<ShowFlags> | undefined)?.konto ?? true;
    if (!showKonto || !anyAccountConnected()) { setAccEvents([]); setAccError(''); return; }
    let cancelled = false;
    // Sichtbarer Bereich plus Puffer (Monat: ±2 Wochen, Woche: −1/+2 Wochen)
    const from = view === 'week'
      ? new Date(new Date(`${anchorIso}T12:00:00`).getTime() - 7 * DAY)
      : new Date(year, month - 1, -7);
    const to = view === 'week'
      ? new Date(new Date(`${anchorIso}T12:00:00`).getTime() + 14 * DAY)
      : new Date(year, month, 14);
    fetchAccountEvents(from, to)
      .then(({ events, errors }) => {
        if (cancelled) return;
        setAccEvents(events);
        setAccError(errors.join(' · '));
      })
      .catch((e) => { if (!cancelled) setAccError((e as Error).message); });
    return () => { cancelled = true; };
  }, [data.show, view, ym, anchorIso, year, month, accTick]);

  const { byDay, stripsByDay } = useMemo(() => {
    const byDay = new Map<string, CalEntry[]>();
    const stripsByDay = new Map<string, CalStrip[]>();
    const push = <T,>(m: Map<string, T[]>, k: string, v: T) => {
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(v);
    };
    if (show.tasks) {
      for (const t of collectTasks(sourceBoards)) {
        if (t.due) push(byDay, t.due, { icon: '☐', text: t.text, boardId: t.boardId, nodeId: t.nodeId, urgent: t.urgency === 'overdue' });
      }
    }
    for (const b of sourceBoards) {
      for (const n of b.nodes) {
        if (n.type !== 'gantt') continue;
        for (const r of (n.data as GanttData).rows) {
          if (r.start === r.end) {
            if (show.miles) push(byDay, r.start, { icon: '◆', text: r.name, boardId: b.id, nodeId: n.id, color: r.color });
          } else if (show.gantt) {
            const s = dayOf(r.start);
            const e = dayOf(r.end);
            for (let d = s; d <= e && d - s < 120; d++) {
              push(stripsByDay, new Date(d * DAY).toISOString().slice(0, 10), {
                text: r.name, color: r.color ?? '#4f7cff', boardId: b.id, nodeId: n.id, startsHere: d === s,
              });
            }
          }
        }
      }
    }
    if (show.ics) {
      for (const ev of icsEvents) {
        if (!ev.end) {
          push(byDay, ev.start, { icon: '▪', text: ev.title, ext: true });
        } else {
          const s = dayOf(ev.start);
          const e = dayOf(ev.end);
          for (let d = s; d <= e && d - s < 120; d++) {
            push(stripsByDay, new Date(d * DAY).toISOString().slice(0, 10), {
              text: ev.title, color: '#8a8375', startsHere: d === s, ext: true,
            });
          }
        }
      }
    }
    if (show.konto) {
      for (const ev of accEvents) {
        push(byDay, ev.date, {
          icon: '●',
          text: ev.time ? `${ev.time} ${ev.title}` : ev.title,
          color: PROVIDER_COLOR[ev.provider],
          ext: true,
        });
      }
    }
    return { byDay, stripsByDay };
  }, [sourceBoards, show.tasks, show.gantt, show.miles, show.ics, show.konto, icsEvents, accEvents]);

  const nav = (delta: number) => {
    if (view === 'week') {
      const a = new Date(`${anchorIso}T12:00:00`);
      updateNodeData(id, { anchor: isoOf(new Date(a.getTime() + delta * 7 * DAY)) });
    } else {
      const d = new Date(year, month - 1 + delta, 1);
      updateNodeData(id, { month: ymOf(d) });
    }
  };

  const jump = (e: { boardId?: string; nodeId?: string }) => {
    if (!e.boardId || !e.nodeId) return;
    if (presenting) setPresenting(false);
    openBoard(e.boardId);
    focusNode(e.boardId, e.nodeId);
  };

  // ---------- ICS: Import, Abo, Export ----------
  const importIcsFile = async (file: File) => {
    const events = parseIcs(await file.text());
    if (events.length === 0) { showToast('Keine Termine in der Datei gefunden.'); return; }
    updateNodeData(id, { icsEvents: mergeEvents(icsEvents, events) });
    showToast(`${events.length} Termin(e) importiert — als „Externe Termine" eingeblendet`);
  };

  const subscribeUrl = () => {
    const url = window.prompt('ICS-/webcal-URL abonnieren (z. B. veröffentlichter Outlook-/Google-Kalender):');
    if (!url?.trim()) return;
    updateNodeData(id, { icsUrls: [...icsUrls, url.trim()] });
    void refreshSubscriptions([...icsUrls, url.trim()]);
  };

  const refreshSubscriptions = async (urls = icsUrls) => {
    if (urls.length === 0) { showToast('Keine ICS-Abos vorhanden — erst eine URL abonnieren.'); return; }
    setBusy(true);
    let ok = 0, fail = 0, added = 0;
    let merged = icsEvents;
    for (const url of urls) {
      try {
        const events = await fetchIcsUrl(url);
        // „neu" über die Dedupe-Schlüssel zählen — die Längendifferenz lügt,
        // sobald mergeEvents auf 800 kappt (Audit R6-F8)
        const seen = new Set(merged.map((e) => `${e.title}|${e.start}`));
        added += events.filter((e) => !seen.has(`${e.title}|${e.start}`)).length;
        merged = mergeEvents(merged, events);
        ok++;
      } catch {
        fail++;
      }
    }
    updateNodeData(id, { icsEvents: merged });
    setBusy(false);
    showToast(fail === 0
      ? `Abos aktualisiert: ${added} neue Termin(e) aus ${ok} Kalender(n)`
      : `${ok} Abo(s) aktualisiert, ${fail} fehlgeschlagen — viele Server erlauben Browser-Zugriff (CORS) nicht; dann die .ics-Datei importieren.`);
  };

  const exportVisible = () => {
    // Wirklich nur die SICHTBARE Ansicht exportieren — und mehrtägige
    // Streifen (Zeitpläne, externe Termine) als EINEN Termin mit Zeitspanne
    // statt sie ganz zu verlieren (Audit R6-F1)
    const visible = new Set(cells.map((c) => c.iso));
    const events: IcsEvent[] = [];
    for (const [day, entries] of byDay) {
      if (!visible.has(day)) continue;
      for (const e of entries) events.push({ title: e.text, start: day });
    }
    const spans = new Map<string, { start: string; end: string }>();
    for (const [day, strips] of stripsByDay) {
      if (!visible.has(day)) continue;
      for (const s of strips) {
        const cur = spans.get(s.text);
        if (!cur) spans.set(s.text, { start: day, end: day });
        else {
          if (day < cur.start) cur.start = day;
          if (day > cur.end) cur.end = day;
        }
      }
    }
    for (const [title, span] of spans) events.push({ title, start: span.start, end: span.end });
    const n = downloadIcsEvents(events);
    showToast(n ? `${n} sichtbare Einträge als .ics exportiert — in Outlook importierbar.` : 'Nichts zu exportieren.');
  };

  const clearIcs = () => {
    updateNodeData(id, { icsEvents: [], icsUrls: [] });
    showToast('Externe Termine & Abos entfernt.');
  };

  // ---------- Raster ----------
  let cells: Array<{ iso: string; day: number; inMonth: boolean }>;
  let title: string;
  if (view === 'week') {
    const a = new Date(`${anchorIso}T12:00:00`);
    const mondayT = a.getTime() - ((a.getDay() + 6) % 7) * DAY;
    cells = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mondayT + i * DAY);
      return { iso: isoOf(d), day: d.getDate(), inMonth: true };
    });
    const mo = new Date(mondayT);
    const so = new Date(mondayT + 6 * DAY);
    title = `${mo.getDate()}.${mo.getMonth() + 1}. – ${so.getDate()}.${so.getMonth() + 1}.${so.getFullYear()}`;
  } else {
    const first = new Date(year, month - 1, 1);
    const startOffset = (first.getDay() + 6) % 7;
    cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(year, month - 1, i - startOffset + 1);
      return { iso: isoOf(d), day: d.getDate(), inMonth: d.getMonth() === month - 1 };
    });
    title = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }

  const maxEntries = view === 'week' ? 8 : 3;

  return (
    <div className="cal-body">
      <div className="cal-head nodrag">
        <span className="cal-title">{title}</span>
        <span className="cal-nav">
          <button
            className={menu ? 'on' : ''}
            onClick={() => setMenu((o) => !o)}
            title="Anzeige & ICS-Import/-Abo/-Export"
            aria-label="Kalender-Optionen"
          >
            <ISettings size={13} />
          </button>
          <button
            className={scope === 'board' ? 'on' : ''}
            onClick={() => updateNodeData(id, { scope: scope === 'all' ? 'board' : 'all' })}
            title={scope === 'all' ? 'Zeigt: alle Boards — Klick: nur dieses Board' : 'Zeigt: nur dieses Board — Klick: alle Boards'}
          >
            {scope === 'all' ? 'Alle Boards' : 'Dieses Board'}
          </button>
          <button
            onClick={() => updateNodeData(id, { view: view === 'month' ? 'week' : 'month', anchor: todayIso })}
            title="Monats-/Wochenansicht umschalten"
          >
            {view === 'month' ? 'Woche' : 'Monat'}
          </button>
          <button onClick={() => nav(-1)} title="Zurück" aria-label="Zurück"><IChevronL size={13} /></button>
          <button onClick={() => updateNodeData(id, { month: undefined, anchor: undefined })} title="Zu heute">heute</button>
          <button onClick={() => nav(1)} title="Weiter" aria-label="Weiter"><IChevronR size={13} /></button>
        </span>
      </div>
      {menu && (
        <div className="cal-menu nodrag">
          <div className="cal-menu-col">
            <div className="cal-menu-label">Anzeigen</div>
            {(Object.keys(SHOW_LABEL) as Array<keyof ShowFlags>).map((k) => (
              <label key={k} className="cal-menu-check">
                <input
                  type="checkbox"
                  checked={show[k]}
                  onChange={(e) => updateNodeData(id, { show: { ...show, [k]: e.target.checked } })}
                />
                {SHOW_LABEL[k]}
              </label>
            ))}
          </div>
          <div className="cal-menu-col">
            <div className="cal-menu-label">Termine (ICS — Outlook/Google/Apple)</div>
            <button disabled={busy} onClick={() => fileRef.current?.click()}>.ics-Datei importieren…</button>
            <button disabled={busy} onClick={subscribeUrl}>ICS-URL abonnieren…</button>
            <button disabled={busy} onClick={() => void refreshSubscriptions()}>
              {busy ? 'aktualisiere…' : `Abos aktualisieren (${icsUrls.length})`}
            </button>
            <button disabled={busy} onClick={exportVisible}>Sichtbares als .ics exportieren</button>
            {(icsEvents.length > 0 || icsUrls.length > 0) && (
              <button disabled={busy} onClick={clearIcs}>Externe Termine entfernen ({icsEvents.length})</button>
            )}
            <input
              ref={fileRef} type="file" accept=".ics,text/calendar" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importIcsFile(f); e.target.value = ''; }}
            />
            <div className="cal-menu-label">Konten (Google/Microsoft 365)</div>
            {anyAccountConnected() ? (
              <>
                <button
                  disabled={busy}
                  title="Termine der verbundenen Konten neu laden"
                  onClick={() => { invalidateAccountEvents(); setAccTick((t) => t + 1); showToast('⟳ Konto-Termine werden aktualisiert …'); }}
                >
                  Konto-Termine aktualisieren ({accEvents.length})
                </button>
                {accError && <div className="cal-menu-err">⚠️ {accError}</div>}
              </>
            ) : (
              <button
                title="Google Kalender oder Microsoft 365 direkt verbinden — Einrichtung in den Einstellungen"
                onClick={() => useBoard.getState().setSettingsOpen(true)}
              >
                Konto verbinden… (Einstellungen)
              </button>
            )}
          </div>
        </div>
      )}
      <div className={`cal-grid nodrag nowheel ${view === 'week' ? 'week' : ''}`}>
        {WEEKDAYS.map((w) => <div key={w} className="cal-dow">{w}</div>)}
        {cells.map((c) => (
          <div key={c.iso} className={`cal-cell ${c.inMonth ? '' : 'out'} ${c.iso === todayIso ? 'today' : ''}`}>
            <span className="cal-daynum">{c.day}</span>
            {(stripsByDay.get(c.iso) ?? []).slice(0, 3).map((s, i) => (
              <button
                key={`s${i}`}
                className={`cal-strip ${s.ext ? 'ext' : ''}`}
                style={{ background: s.color }}
                title={`${s.text}${s.ext ? ' (extern)' : ' — zur Karte springen'}`}
                onClick={() => jump(s)}
              >
                {s.startsHere || cells[0].iso === c.iso ? s.text : ' '}
              </button>
            ))}
            {(byDay.get(c.iso) ?? []).slice(0, maxEntries).map((e, i) => (
              <button
                key={i}
                className={`cal-chip ${e.urgent ? 'urgent' : ''} ${e.ext ? 'ext' : ''}`}
                style={e.color ? { borderLeftColor: e.color } : undefined}
                title={`${e.text}${e.ext ? ' (externer Termin)' : ' — zur Karte springen'}`}
                onClick={() => jump(e)}
              >
                {e.icon} {e.text}
              </button>
            ))}
            {(byDay.get(c.iso)?.length ?? 0) > maxEntries && (
              <span className="cal-more">+{byDay.get(c.iso)!.length - maxEntries}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Kalender als Karte auf dem Whiteboard. */
export function CalendarCard({ id, data, selected }: NodeProps<CalendarNode>) {
  return (
    <CardShell id={id} selected={selected} minWidth={340} minHeight={280} className="cal-card">
      <CalendarBody id={id} data={data} />
    </CardShell>
  );
}
