import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { CalendarData, CalendarNode, GanttData } from '../../types';
import { collectTasks } from '../../lib/tasks';
import { linkedNeighborIds } from '../../lib/links';
import { nodeToText } from '../../lib/serialize';
import { downloadIcsEvents, fetchIcsUrl, mergeEvents, parseIcs, type IcsEvent } from '../../lib/ics';
import { notizTermine } from '../../lib/notizTermine';
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
  /** M176: eigener, direkt im Kalender eingetragener Termin (Datum = Sprung in den Tages-Editor) */
  own?: boolean;
  /** M177: ausführlicher Tooltip (Zeitraum, Ort, Notiz) */
  tip?: string;
}

/** M176/M177: Eigener Termin — direkt in der Kalender-Karte eingetragen */
export interface MyEvent {
  id: string;
  /** ISO yyyy-mm-dd (Beginn) */
  date: string;
  title: string;
  /** optional HH:MM (Beginn) */
  time?: string;
  /** M177: optional HH:MM (Ende) */
  end?: string;
  /** M177: ISO-Enddatum → mehrtägiger Termin (farbiger Streifen) */
  endDate?: string;
  /** M177: Ort */
  place?: string;
  /** M177: Notiz/Beschreibung */
  note?: string;
  /** M177: eigene Farbe (Hex) */
  color?: string;
  /** M177: verknüpfte Karte bzw. verknüpftes Board (↗ Sprung) */
  link?: { boardId: string; nodeId?: string };
}

/** M177: Farb-Palette für eigene Termine */
const EV_COLORS = ['#4f7cff', '#3fa564', '#e07a3f', '#a05fd4', '#d44f6e'];
interface CalStrip {
  text: string;
  color: string;
  boardId?: string;
  nodeId?: string;
  startsHere: boolean;
  ext?: boolean;
  /** M177: eigener mehrtägiger Termin — Klick öffnet den Tages-Editor am Beginn */
  ownDate?: string;
}

interface ShowFlags { tasks: boolean; gantt: boolean; miles: boolean; ics: boolean; konto: boolean; notiz: boolean }
const SHOW_DEFAULT: ShowFlags = { tasks: true, gantt: true, miles: true, ics: true, konto: true, notiz: true };
const SHOW_LABEL: Record<keyof ShowFlags, string> = {
  tasks: 'Kanban-Fristen',
  gantt: 'Zeitplan-Balken',
  miles: 'Meilensteine',
  ics: 'Externe Termine (ICS)',
  konto: 'Konto-Termine (Google/M365)',
  notiz: 'Termine aus Notizen',
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

  /**
   * M270: Drei Ansichten statt zwei.
   *
   * Gewünscht war der Jahresüberblick — „wann ist eigentlich was los?". Der
   * Monat beantwortet das nicht, und zwölfmal weiterblättern ist keine
   * Antwort. Die Jahresansicht zeigt alle zwölf Monate nebeneinander und
   * markiert die Tage, an denen etwas liegt; ein Klick führt in den Monat.
   */
  const view = (data.view as 'month' | 'week' | 'jahr') ?? 'month';
  // M169: Verbindungen (Pfeile) an den Kalender fokussieren ihn automatisch
  // auf genau diese Quell-Karten (Bereich „Verbunden") — ohne gespeicherte
  // Wahl gilt: Verbindungen da → verbunden, sonst alle Boards. Der Schalter
  // in der Kopfzeile übersteuert das jederzeit (Wahl wird gespeichert);
  // fallen alle Verbindungen weg, greift wieder „Alle Boards".
  const linkedIds = useMemo(() => linkedNeighborIds(boards, id), [boards, id]);
  const scopeChoice = (data.scope as 'all' | 'board' | 'linked') ?? (linkedIds.size ? 'linked' : 'all');
  const scope = scopeChoice === 'linked' && linkedIds.size === 0 ? 'all' : scopeChoice;
  const show = { ...SHOW_DEFAULT, ...(data.show as Partial<ShowFlags> | undefined) };
  const icsEvents = (data.icsEvents as IcsEvent[] | undefined) ?? [];
  const icsUrls = (data.icsUrls as string[] | undefined) ?? [];
  // M176: eigene Termine — direkt im Kalender eintragbar (Klick auf den Tag)
  const myEvents = (data.myEvents as MyEvent[] | undefined) ?? [];
  const [dayEdit, setDayEdit] = useState<string | null>(null);
  const [evTitle, setEvTitle] = useState('');
  const [evTime, setEvTime] = useState('');
  // M177: Termin-Editor (Details) + Karten-Picker
  const [evEdit, setEvEdit] = useState<MyEvent | null>(null);
  const [evIsNew, setEvIsNew] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');

  /** M177: Zeile für den Detail-Tooltip eines eigenen Termins */
  const ownTip = (ev: MyEvent): string => {
    const parts = [ev.title];
    if (ev.time) parts.push(`🕐 ${ev.time}${ev.end ? `–${ev.end}` : ''}`);
    if (ev.endDate) parts.push(`bis ${new Date(`${ev.endDate}T12:00:00`).toLocaleDateString('de-DE')}`);
    if (ev.place) parts.push(`📍 ${ev.place}`);
    if (ev.note) parts.push(ev.note.slice(0, 140));
    return `${parts.join(' · ')} — Klick öffnet den Termin`;
  };
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
    const from = view === 'jahr' ? new Date(year, 0, 1)
      : view === 'week' ? new Date(new Date(`${anchorIso}T12:00:00`).getTime() - 7 * DAY)
        : new Date(year, month - 1, -7);
    const to = view === 'jahr' ? new Date(year, 11, 31)
      : view === 'week' ? new Date(new Date(`${anchorIso}T12:00:00`).getTime() + 14 * DAY)
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
        if (scope === 'linked' && !linkedIds.has(t.nodeId)) continue; // M169: nur verbundene Quellen
        if (t.due) push(byDay, t.due, { icon: '☐', text: t.text, boardId: t.boardId, nodeId: t.nodeId, urgent: t.urgency === 'overdue' });
      }
    }
    /**
     * M272: Termine aus NORMALEN Notizen — „Sitzung am 11.11." im Fließtext
     * erscheint jetzt im Kalender, wie gewünscht besonders bei per Pfeil
     * VERBUNDENEN Notizen (Bereich „Verbunden"). Checklisten-Punkte sind
     * bewusst außen vor: Die laufen als Aufgaben (Schalter oben) und stünden
     * sonst doppelt da. Klick auf den Eintrag springt zur Notiz.
     */
    if (show.notiz) {
      for (const b of sourceBoards) {
        for (const n of b.nodes) {
          if (n.type !== 'note' || n.archived) continue;
          if (scope === 'linked' && !linkedIds.has(n.id)) continue;
          for (const t of notizTermine((n.data as { blocks?: unknown[] }).blocks)) {
            push(byDay, t.iso, {
              icon: '✎',
              text: t.zeit ? `${t.zeit} ${t.text}` : t.text,
              boardId: b.id,
              nodeId: n.id,
            });
          }
        }
      }
    }
    for (const b of sourceBoards) {
      for (const n of b.nodes) {
        if (n.type !== 'gantt') continue;
        if (scope === 'linked' && !linkedIds.has(n.id)) continue; // M169
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
    // M176/M177: eigene Termine — eintägig als ★-Chip, mehrtägig als farbiger
    // Streifen; Klick öffnet jeweils den Tages-Editor
    for (const ev of myEvents) {
      if (ev.endDate && ev.endDate > ev.date) {
        const s = dayOf(ev.date);
        const e2 = dayOf(ev.endDate);
        for (let d = s; d <= e2 && d - s < 120; d++) {
          push(stripsByDay, new Date(d * DAY).toISOString().slice(0, 10), {
            text: ev.title, color: ev.color ?? '#4f7cff', startsHere: d === s, ownDate: ev.date,
          });
        }
      } else {
        push(byDay, ev.date, {
          icon: '★',
          text: ev.time ? `${ev.time} ${ev.title}` : ev.title,
          own: true,
          color: ev.color,
          tip: ownTip(ev),
        });
      }
    }
    return { byDay, stripsByDay };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceBoards, scope, linkedIds, show.tasks, show.gantt, show.miles, show.ics, show.konto, show.notiz, icsEvents, accEvents, myEvents]);

  const nav = (delta: number) => {
    if (view === 'jahr') {
      updateNodeData(id, { month: `${year + delta}-${String(month).padStart(2, '0')}` });
      return;
    }
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

  // ---------- M176/M177: eigene Termine (Klick auf einen Tag) ----------
  const addMyEvent = () => {
    if (!dayEdit || !evTitle.trim()) return;
    const ev: MyEvent = {
      id: Math.random().toString(36).slice(2, 10),
      date: dayEdit,
      title: evTitle.trim().slice(0, 80),
      time: /^\d{2}:\d{2}$/.test(evTime) ? evTime : undefined,
    };
    updateNodeData(id, { myEvents: [...myEvents, ev] });
    setEvTitle('');
    setEvTime('');
  };
  const removeMyEvent = (evId: string) =>
    updateNodeData(id, { myEvents: myEvents.filter((e) => e.id !== evId) });

  /** M177: Termin (neu oder geändert) speichern — bereinigt leere Felder */
  const saveEvent = () => {
    if (!evEdit || !evEdit.title.trim()) return;
    const clean: MyEvent = {
      ...evEdit,
      title: evEdit.title.trim().slice(0, 80),
      time: evEdit.time || undefined,
      end: evEdit.end || undefined,
      endDate: evEdit.endDate && evEdit.endDate > evEdit.date ? evEdit.endDate : undefined,
      place: evEdit.place?.trim() || undefined,
      note: evEdit.note?.trim() || undefined,
    };
    updateNodeData(id, {
      myEvents: evIsNew ? [...myEvents, clean] : myEvents.map((e) => (e.id === clean.id ? clean : e)),
    });
    setDayEdit(clean.date);
    setEvEdit(null);
    setLinkQuery('');
  };

  /** M177: Verknüpfungs-Ziel auflösen (Karte/Board) — null = gelöscht */
  const linkLabel = (link: NonNullable<MyEvent['link']>): string | null => {
    const b = boards.find((x) => x.id === link.boardId);
    if (!b) return null;
    if (!link.nodeId) return `Board: ${b.name}`;
    const n = b.nodes.find((x) => x.id === link.nodeId);
    if (!n) return null;
    return nodeToText(n).split('\n').find((l) => l.trim())?.trim().slice(0, 40) || 'Karte';
  };
  const jumpLink = (link: NonNullable<MyEvent['link']>) => {
    if (presenting) setPresenting(false);
    openBoard(link.boardId);
    if (link.nodeId) focusNode(link.boardId, link.nodeId);
  };
  /** M177: Karten-/Board-Suche für den Picker (ab 2 Zeichen, max. 8 Treffer) */
  const linkResults = (() => {
    const q = linkQuery.trim().toLowerCase();
    if (!evEdit || q.length < 2) return [];
    const out: Array<{ boardId: string; nodeId?: string; label: string; first?: string }> = [];
    for (const b of boards) {
      if (b.name.toLowerCase().includes(q)) out.push({ boardId: b.id, label: `Board: ${b.name}` });
      for (const n of b.nodes) {
        if (n.id === id || n.type === 'frame') continue;
        const first = nodeToText(n).split('\n').find((l) => l.trim())?.trim() ?? '';
        if (first.toLowerCase().includes(q)) {
          out.push({ boardId: b.id, nodeId: n.id, label: `${b.name} › ${first.slice(0, 40)}`, first });
        }
        if (out.length >= 8) return out;
      }
      if (out.length >= 8) break;
    }
    return out;
  })();

  /** Termin an Google Kalender ÜBERGEBEN: vorbefüllte Vorlage-URL — der
   *  Nutzer bestätigt in Google mit einem Klick (kein Schreib-Zugriff nötig).
   *  M177: mit Ende, Ort und Notiz. */
  const toGoogle = (ev: MyEvent) => {
    let dates: string;
    if (ev.time) {
      const f = (x: Date) =>
        `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}T${String(x.getHours()).padStart(2, '0')}${String(x.getMinutes()).padStart(2, '0')}00`;
      const start = new Date(`${ev.date}T${ev.time}:00`);
      const end = ev.end
        ? new Date(`${ev.endDate ?? ev.date}T${ev.end}:00`)
        : new Date(start.getTime() + 36e5);
      dates = `${f(start)}/${f(end <= start ? new Date(start.getTime() + 36e5) : end)}`;
    } else {
      const next = new Date(`${ev.endDate ?? ev.date}T12:00:00`);
      next.setDate(next.getDate() + 1);
      dates = `${ev.date.replace(/-/g, '')}/${isoOf(next).replace(/-/g, '')}`;
    }
    const extra = `${ev.note ? `&details=${encodeURIComponent(ev.note.slice(0, 500))}` : ''}${ev.place ? `&location=${encodeURIComponent(ev.place)}` : ''}`;
    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${dates}${extra}`, '_blank');
  };
  const evIcs = (ev: MyEvent) => {
    downloadIcsEvents([{ title: ev.time ? `${ev.time} ${ev.title}` : ev.title, start: ev.date, end: ev.endDate }]);
    showToast('.ics erstellt — in Outlook/Apple Kalender öffnen und bestätigen.');
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

  /**
   * M270: Exportieren, was WIRKLICH gefragt ist — nicht nur das Sichtbare.
   *
   * Bisher ging ausschließlich der angezeigte Ausschnitt in die Datei. Wer
   * alle Termine eines Jahres nach Outlook bringen wollte, musste Monat für
   * Monat exportieren und zwölf Dateien zusammenführen. Jetzt entscheidet ein
   * Zeitraum, und „alles" ist ausdrücklich erlaubt.
   *
   * Wichtig ist der Unterschied zwischen den Quellen: Aufgaben, Zeitpläne,
   * importierte ICS-Termine und eigene Termine liegen VOLLSTÄNDIG vor — sie
   * lassen sich einfach filtern. Die Termine verbundener Konten (Google,
   * Microsoft 365) werden dagegen immer nur für den gerade sichtbaren
   * Zeitraum geholt. Für einen größeren Export müssen sie deshalb eigens
   * nachgeladen werden, sonst fehlten sie stillschweigend — und genau das
   * wäre der Fehler, den man erst in Outlook bemerkt.
   */
  const [exportOffen, setExportOffen] = useState(false);
  const [exVon, setExVon] = useState(`${new Date().getFullYear()}-01-01`);
  const [exBis, setExBis] = useState(`${new Date().getFullYear()}-12-31`);

  /** Eigener Termin → ICS-Eintrag (mit Uhrzeit, Ort und Notiz) */
  const alsIcs = (ev: MyEvent): IcsEvent => ({
    title: ev.title,
    start: ev.date,
    end: ev.endDate,
    startTime: ev.time,
    endTime: ev.end,
    place: ev.place,
    note: ev.note,
  });

  /**
   * Termine für einen Zeitraum einsammeln. `von`/`bis` leer = ohne Grenze.
   * Gibt zusätzlich zurück, ob Konto-Termine nachgeladen wurden — das gehört
   * in die Rückmeldung, damit niemand rätselt, was in der Datei steht.
   */
  const sammle = async (von?: string, bis?: string): Promise<{ events: IcsEvent[]; konto: number }> => {
    const drin = (iso: string) => (!von || iso >= von) && (!bis || iso <= bis);
    const events: IcsEvent[] = [];
    const eigeneIds = new Set(myEvents.map((e) => e.id));

    // Eigene Termine zuerst — nur sie tragen Uhrzeit, Ort und Notiz
    for (const ev of myEvents) {
      if (!drin(ev.date) && !(ev.endDate && drin(ev.endDate))) continue;
      events.push(alsIcs(ev));
    }
    // Aufgaben, Meilensteine, importierte Termine: aus dem Tagesraster,
    // aber OHNE die eigenen (die stehen schon vollständig oben)
    for (const [day, entries] of byDay) {
      if (!drin(day)) continue;
      for (const e of entries) {
        if (e.own) continue;
        events.push({ title: e.text, start: day });
      }
    }
    // Mehrtägiges (Zeitpläne, externe Termine) als EIN Termin mit Zeitspanne
    const spans = new Map<string, { start: string; end: string }>();
    for (const [day, strips] of stripsByDay) {
      if (!drin(day)) continue;
      for (const st of strips) {
        if (st.ownDate) continue;   // eigener mehrtägiger Termin — schon dabei
        const cur = spans.get(st.text);
        if (!cur) spans.set(st.text, { start: day, end: day });
        else {
          if (day < cur.start) cur.start = day;
          if (day > cur.end) cur.end = day;
        }
      }
    }
    for (const [t, span] of spans) events.push({ title: t, start: span.start, end: span.end });

    // Konto-Termine für GENAU diesen Zeitraum nachladen
    let konto = 0;
    if (show.konto && anyAccountConnected() && von && bis) {
      try {
        const { events: acc } = await fetchAccountEvents(new Date(`${von}T00:00:00`), new Date(`${bis}T23:59:59`));
        for (const ev of acc) {
          if (!drin(ev.date)) continue;
          events.push({ title: ev.title, start: ev.date, startTime: ev.time });
          konto += 1;
        }
      } catch { /* ohne Konto-Termine exportieren ist besser als gar nicht */ }
    }
    void eigeneIds;
    return { events, konto };
  };

  const exportVisible = () => {
    // Wirklich nur die SICHTBARE Ansicht exportieren — und mehrtägige
    // Streifen (Zeitpläne, externe Termine) als EINEN Termin mit Zeitspanne
    // statt sie ganz zu verlieren (Audit R6-F1)
    const visible = new Set(cells.map((c) => c.iso));
    const events: IcsEvent[] = [];
    for (const [day, entries] of byDay) {
      if (!visible.has(day)) continue;
      for (const e of entries) {
        const eigen = e.own ? myEvents.find((m) => m.date === day && e.text.includes(m.title)) : undefined;
        events.push(eigen ? alsIcs(eigen) : { title: e.text, start: day });
      }
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
    const n = downloadIcsEvents(events, 'pixinotes-kalender-sichtbar.ics');
    showToast(n ? `${n} sichtbare Einträge als .ics exportiert — in Outlook importierbar.` : 'Nichts zu exportieren.');
  };

  /** Export über einen Zeitraum (oder ohne Grenzen: alles) */
  const exportZeitraum = async (von?: string, bis?: string) => {
    setBusy(true);
    try {
      const { events, konto } = await sammle(von, bis);
      const name = von && bis
        ? `pixinotes-kalender-${von}-bis-${bis}.ics`
        : 'pixinotes-kalender-alle-termine.ics';
      const n = downloadIcsEvents(events, name);
      setExportOffen(false);
      if (!n) { showToast('In diesem Zeitraum liegt kein Termin.'); return; }
      const spanne = von && bis
        ? `${new Date(`${von}T12:00:00`).toLocaleDateString('de-DE')} – ${new Date(`${bis}T12:00:00`).toLocaleDateString('de-DE')}`
        : 'alle Zeiträume';
      showToast(`📅 ${n} Termine exportiert (${spanne})${konto ? `, davon ${konto} aus verbundenen Konten` : ''} — in Outlook über „Datei → Öffnen & Exportieren → Importieren" einlesen.`, false, 9000);
    } finally {
      setBusy(false);
    }
  };

  const clearIcs = () => {
    updateNodeData(id, { icsEvents: [], icsUrls: [] });
    showToast('Externe Termine & Abos entfernt.');
  };

  // ---------- Raster ----------
  let cells: Array<{ iso: string; day: number; inMonth: boolean }>;
  let title: string;
  if (view === 'jahr') {
    // Das Jahresraster baut sich unten selbst auf (zwölf Mini-Monate) —
    // `cells` bleibt leer und dient nur noch dem Export „Sichtbares".
    cells = [];
    for (let m = 0; m < 12; m++) {
      const tage = new Date(year, m + 1, 0).getDate();
      for (let t = 1; t <= tage; t++) {
        cells.push({ iso: `${year}-${String(m + 1).padStart(2, '0')}-${String(t).padStart(2, '0')}`, day: t, inMonth: true });
      }
    }
    title = String(year);
  } else if (view === 'week') {
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
      {/* M160: Kopfzeile ziehbar — nur die Knopfleiste rechts ist Bedienfläche */}
      <div className="cal-head">
        <span className="cal-title">{title}</span>
        <span className="cal-nav nodrag">
          <button
            className={menu ? 'on' : ''}
            onClick={() => setMenu((o) => !o)}
            title="Anzeige & ICS-Import/-Abo/-Export"
            aria-label="Kalender-Optionen"
          >
            <ISettings size={13} />
          </button>
          <button
            className={scope !== 'all' ? 'on' : ''}
            onClick={() => {
              // M169: Mit Verbindungen gibt es drei Bereiche (… → Verbunden),
              // ohne wie bisher zwei — die Wahl wird an der Karte gespeichert
              const order: Array<'all' | 'board' | 'linked'> = linkedIds.size ? ['all', 'board', 'linked'] : ['all', 'board'];
              updateNodeData(id, { scope: order[(order.indexOf(scope as never) + 1) % order.length] });
            }}
            title={
              scope === 'all' ? `Zeigt: alle Boards — Klick: nur dieses Board${linkedIds.size ? ' (dann: nur verbundene Karten)' : ''}`
              : scope === 'board' ? `Zeigt: nur dieses Board — Klick: ${linkedIds.size ? 'nur die per Pfeil verbundenen Karten' : 'alle Boards'}`
              : 'Zeigt: nur Termine & Fristen der per Pfeil verbundenen Karten — Klick: alle Boards'
            }
          >
            {scope === 'all' ? 'Alle Boards' : scope === 'board' ? 'Dieses Board' : `Verbunden (${linkedIds.size})`}
          </button>
          <button
            onClick={() => updateNodeData(id, {
              view: view === 'month' ? 'week' : view === 'week' ? 'jahr' : 'month',
              anchor: todayIso,
            })}
            title="Ansicht umschalten: Monat → Woche → Jahr"
          >
            {view === 'month' ? 'Woche' : view === 'week' ? 'Jahr' : 'Monat'}
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
            <button disabled={busy} onClick={() => setExportOffen((o) => !o)}>
              Alle Termine / Zeitraum exportieren…
            </button>
            {exportOffen && (
              <div className="cal-export">
                <div className="cal-export-schnell">
                  <button disabled={busy} onClick={() => void exportZeitraum()}>Alle Termine</button>
                  <button
                    disabled={busy}
                    onClick={() => void exportZeitraum(`${year}-01-01`, `${year}-12-31`)}
                  >
                    Jahr {year}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      const heute = new Date();
                      const bis = new Date(heute.getFullYear(), heute.getMonth() + 12, heute.getDate());
                      void exportZeitraum(isoOf(heute), isoOf(bis));
                    }}
                  >
                    Nächste 12 Monate
                  </button>
                </div>
                <div className="cal-export-spanne">
                  <label>von <input type="date" value={exVon} onChange={(e) => setExVon(e.target.value)} /></label>
                  <label>bis <input type="date" value={exBis} onChange={(e) => setExBis(e.target.value)} /></label>
                  <button
                    disabled={busy || !exVon || !exBis || exBis < exVon}
                    onClick={() => void exportZeitraum(exVon, exBis)}
                  >
                    Zeitraum exportieren
                  </button>
                </div>
                <div className="cal-export-hinweis">
                  Nimmt <b>alle</b> Termine des Zeitraums mit, nicht nur die angezeigten — mit
                  Uhrzeit, Ort und Notiz. Termine verbundener Konten werden für den Zeitraum
                  eigens nachgeladen (bei „Alle Termine" nicht, dort fehlt die Zeitgrenze).
                </div>
              </div>
            )}
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
      {/* M270: Jahresansicht — zwölf Mini-Monate. Gezeigt wird nicht der
          Inhalt jedes Tages (dafür ist kein Platz), sondern WO etwas liegt:
          Ein Tag mit Einträgen ist gefüllt, je mehr desto kräftiger. Klick auf
          einen Tag führt in den Monat, Klick auf den Monatsnamen ebenfalls. */}
      {view === 'jahr' ? (
        <div className="cal-jahr nodrag nowheel">
          {Array.from({ length: 12 }, (_, m) => {
            const erster = new Date(year, m, 1);
            const versatz = (erster.getDay() + 6) % 7;
            const tage = new Date(year, m + 1, 0).getDate();
            const felder = Array.from({ length: versatz + tage }, (_, i) => (i < versatz
              ? null
              : `${year}-${String(m + 1).padStart(2, '0')}-${String(i - versatz + 1).padStart(2, '0')}`));
            return (
              <div className="cal-jahr-monat" key={m}>
                <button
                  className="cal-jahr-kopf"
                  title={`${erster.toLocaleDateString('de-DE', { month: 'long' })} ${year} öffnen`}
                  onClick={() => updateNodeData(id, { view: 'month', month: `${year}-${String(m + 1).padStart(2, '0')}` })}
                >
                  {erster.toLocaleDateString('de-DE', { month: 'short' })}
                </button>
                <div className="cal-jahr-raster">
                  {WEEKDAYS.map((w) => <span key={w} className="cal-jahr-dow">{w[0]}</span>)}
                  {felder.map((iso, i) => {
                    if (!iso) return <span key={`l${i}`} />;
                    const anzahl = (byDay.get(iso)?.length ?? 0) + (stripsByDay.get(iso)?.length ?? 0);
                    const namen = [
                      ...(byDay.get(iso) ?? []).map((e) => e.text),
                      ...(stripsByDay.get(iso) ?? []).map((x) => x.text),
                    ].slice(0, 6);
                    return (
                      <button
                        key={iso}
                        className={`cal-jahr-tag ${anzahl ? `voll v${Math.min(anzahl, 3)}` : ''} ${iso === todayIso ? 'heute' : ''}`}
                        title={anzahl
                          ? `${new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE')} — ${anzahl} Eintrag/Einträge:\n${namen.join('\n')}`
                          : `${new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE')} — Klick öffnet den Monat`}
                        onClick={() => updateNodeData(id, { view: 'month', month: `${year}-${String(m + 1).padStart(2, '0')}` })}
                      >
                        {i - versatz + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div className={`cal-grid nodrag nowheel ${view === 'week' ? 'week' : ''}`}>
        {WEEKDAYS.map((w) => <div key={w} className="cal-dow">{w}</div>)}
        {cells.map((c) => (
          <div
            key={c.iso}
            className={`cal-cell ${c.inMonth ? '' : 'out'} ${c.iso === todayIso ? 'today' : ''}`}
            title="Klick: eigenen Termin an diesem Tag eintragen"
            onClick={() => { setDayEdit(c.iso); setEvEdit(null); setEvTitle(''); setEvTime(''); }}
          >
            <span className="cal-daynum">{c.day}</span>
            {(stripsByDay.get(c.iso) ?? []).slice(0, 3).map((s, i) => (
              <button
                key={`s${i}`}
                className={`cal-strip ${s.ext ? 'ext' : ''}`}
                style={{ background: s.color }}
                title={s.ownDate ? `${s.text} (eigener Termin — Klick öffnet ihn)` : `${s.text}${s.ext ? ' (extern)' : ' — zur Karte springen'}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (s.ownDate) { setDayEdit(s.ownDate); setEvEdit(null); }
                  else jump(s);
                }}
              >
                {s.startsHere || cells[0].iso === c.iso ? s.text : ' '}
              </button>
            ))}
            {(byDay.get(c.iso) ?? []).slice(0, maxEntries).map((e, i) => (
              <button
                key={i}
                className={`cal-chip ${e.urgent ? 'urgent' : ''} ${e.ext ? 'ext' : ''} ${e.own ? 'own' : ''}`}
                style={e.color ? { borderLeftColor: e.color } : undefined}
                title={e.own ? (e.tip ?? e.text) : `${e.text}${e.ext ? ' (externer Termin)' : ' — zur Karte springen'}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (e.own) { setDayEdit(c.iso); setEvEdit(null); setEvTitle(''); setEvTime(''); }
                  else jump(e);
                }}
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
      )}
      {dayEdit && !evEdit && (
        /* M176: Tages-Editor — Schnell-Eingabe + Terminliste; Klick auf einen
           Termin öffnet den Detail-Editor (M177) */
        <div className="cal-menu cal-dayedit nodrag">
          <div className="cal-dayedit-head">
            <b>{new Date(`${dayEdit}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</b>
            <button title="Schließen" onClick={() => setDayEdit(null)}>✕</button>
          </div>
          <div className="cal-dayedit-add">
            <input
              autoFocus
              placeholder="Neuer Termin …"
              value={evTitle}
              onChange={(e) => setEvTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addMyEvent(); if (e.key === 'Escape') setDayEdit(null); }}
            />
            <input
              type="time"
              value={evTime}
              title="Uhrzeit (optional)"
              onChange={(e) => setEvTime(e.target.value)}
            />
            <button disabled={!evTitle.trim()} title="Termin eintragen" onClick={addMyEvent}>＋</button>
          </div>
          {myEvents.filter((e) => e.date === dayEdit || (e.endDate && e.date <= dayEdit && e.endDate >= dayEdit)).map((ev) => (
            <div key={ev.id} className="cal-dayedit-row">
              <button
                className="cal-dayedit-title"
                style={ev.color ? { color: ev.color } : undefined}
                title={`${ownTip(ev)} — Klick: bearbeiten`}
                onClick={() => { setEvEdit({ ...ev }); setEvIsNew(false); setLinkQuery(''); }}
              >
                ★ {ev.time ? `${ev.time} · ` : ''}{ev.title}
                {ev.place ? <span className="cal-dayedit-sub"> 📍{ev.place}</span> : null}
                {ev.link ? <span className="cal-dayedit-sub"> 🔗</span> : null}
              </button>
              <button title="An Google Kalender übergeben — öffnet Google mit vorausgefülltem Termin, dort mit einem Klick speichern" onClick={() => toGoogle(ev)}>→G</button>
              <button title="Als .ics-Datei — in Outlook/Apple Kalender öffnen" onClick={() => evIcs(ev)}>.ics</button>
              <button title="Termin löschen" onClick={() => removeMyEvent(ev.id)}>✕</button>
            </div>
          ))}
          <div className="cal-dayedit-more">
            <button
              onClick={() => {
                setEvEdit({ id: Math.random().toString(36).slice(2, 10), date: dayEdit, title: evTitle.trim() });
                setEvIsNew(true);
                setLinkQuery('');
              }}
            >＋ Termin mit Details</button>
            <button
              title="Eine vorhandene Karte als Termin eintragen: Karte suchen — Titel und Verknüpfung werden übernommen"
              onClick={() => {
                setEvEdit({ id: Math.random().toString(36).slice(2, 10), date: dayEdit, title: '' });
                setEvIsNew(true);
                setLinkQuery('');
              }}
            >📎 Karte als Termin…</button>
          </div>
          <div className="cal-dayedit-foot">
            Klick auf einen Termin = bearbeiten · „→G"/.ics übergibt an deinen echten Kalender · Rückrichtung: Konto/ICS-Abo (⚙)
          </div>
        </div>
      )}
      {dayEdit && evEdit && (
        /* M177: Detail-Editor — alle Termin-Felder + Karten-/Board-Verknüpfung */
        <div className="cal-menu cal-dayedit cal-evform nodrag">
          <div className="cal-dayedit-head">
            <b>{evIsNew ? 'Neuer Termin' : 'Termin bearbeiten'}</b>
            <button title="Zurück zur Tagesliste (ohne Speichern)" onClick={() => { setEvEdit(null); setLinkQuery(''); }}>✕</button>
          </div>
          <input
            className="cal-evform-title"
            autoFocus
            placeholder="Titel …"
            value={evEdit.title}
            onChange={(e) => setEvEdit({ ...evEdit, title: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') saveEvent(); }}
          />
          <div className="cal-evform-grid">
            <label>Datum
              <input type="date" value={evEdit.date} onChange={(e) => e.target.value && setEvEdit({ ...evEdit, date: e.target.value })} />
            </label>
            <label>Von
              <input type="time" value={evEdit.time ?? ''} onChange={(e) => setEvEdit({ ...evEdit, time: e.target.value || undefined })} />
            </label>
            <label>Bis
              <input type="time" value={evEdit.end ?? ''} onChange={(e) => setEvEdit({ ...evEdit, end: e.target.value || undefined })} />
            </label>
            <label title="Enddatum für mehrtägige Termine — erscheint als farbiger Streifen">Bis-Datum
              <input type="date" value={evEdit.endDate ?? ''} onChange={(e) => setEvEdit({ ...evEdit, endDate: e.target.value || undefined })} />
            </label>
          </div>
          <input
            placeholder="Ort (optional)"
            value={evEdit.place ?? ''}
            onChange={(e) => setEvEdit({ ...evEdit, place: e.target.value })}
          />
          <textarea
            className="cal-evform-note"
            placeholder="Notiz (optional)"
            rows={2}
            value={evEdit.note ?? ''}
            onChange={(e) => setEvEdit({ ...evEdit, note: e.target.value })}
          />
          <div className="cal-evform-colors">
            {EV_COLORS.map((c) => (
              <button
                key={c}
                className={`cal-evform-dot ${evEdit.color === c ? 'on' : ''}`}
                style={{ background: c }}
                title="Termin-Farbe"
                onClick={() => setEvEdit({ ...evEdit, color: evEdit.color === c ? undefined : c })}
              />
            ))}
          </div>
          {evEdit.link ? (
            <div className="cal-evform-link">
              🔗
              <button
                className="cal-dayedit-title"
                title={linkLabel(evEdit.link) ? 'Zur verknüpften Karte springen' : 'Ziel wurde gelöscht'}
                onClick={() => linkLabel(evEdit.link!) && jumpLink(evEdit.link!)}
              >
                {linkLabel(evEdit.link) ?? '⚠ Ziel gelöscht'}
              </button>
              <button title="Verknüpfung entfernen" onClick={() => setEvEdit({ ...evEdit, link: undefined })}>✕</button>
            </div>
          ) : (
            <div className="cal-evform-pick">
              <input
                placeholder="🔗 Karte/Board verknüpfen — suchen …"
                value={linkQuery}
                onChange={(e) => setLinkQuery(e.target.value)}
              />
              {linkResults.map((r) => (
                <button
                  key={`${r.boardId}|${r.nodeId ?? ''}`}
                  className="cal-evform-hit"
                  onClick={() => {
                    setEvEdit({
                      ...evEdit,
                      link: { boardId: r.boardId, nodeId: r.nodeId },
                      // „Karte als Termin": leerer Titel übernimmt die Kartenzeile
                      title: evEdit.title.trim() ? evEdit.title : (r.first ?? evEdit.title),
                    });
                    setLinkQuery('');
                  }}
                >{r.label}</button>
              ))}
            </div>
          )}
          <div className="cal-evform-actions">
            <button className="cal-evform-save" disabled={!evEdit.title.trim()} onClick={saveEvent}>💾 Speichern</button>
            {!evIsNew && (
              <>
                <button title="An Google Kalender übergeben" onClick={() => toGoogle(evEdit)}>→G</button>
                <button title="Als .ics-Datei" onClick={() => evIcs(evEdit)}>.ics</button>
                <button
                  title="Termin löschen"
                  onClick={() => { removeMyEvent(evEdit.id); setEvEdit(null); }}
                >🗑</button>
              </>
            )}
          </div>
        </div>
      )}
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
