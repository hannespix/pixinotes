// M410: Was die KI von jedem Modul weiß – lesen und bedienen.
//
// Bisher bekam das Modell von jeder Karte die ersten 400 Zeichen ihres Suchtexts und durfte eine Handvoll Karten
// anlegen. Eine Tabelle konnte es weder vollständig lesen noch füllen, ein Ticket nicht verschieben, ein Protokoll
// nicht ergänzen. Hier steht für jedes Modul beides an einer Stelle:
//
//   · LESEN  (kiLesen):      der ganze Inhalt, gegliedert – und jedes Teil (Ticket, Vorgang, Eintrag, Sitzung) mit
//                            seiner Kennung, damit das Modell genau dieses Teil ansprechen kann.
//   · BEDIENEN (kiAusfuehren): die Operationen, die es dafür gibt – geprüft, bevor etwas geschrieben wird.
//   · BESCHREIBEN (kiOpsText): was davon im Auftrag an das Modell steht – nur für Module, die es auf dem Board gibt.
//
// Wird erst geladen, wenn eine Anweisung an die KI geht (aiActions.ts lädt es nach).
import { blocksToText, nodeToText } from './serialize';
import { rechneBlatt, zeigeWert } from './formel';
import { ersteZeile, spaltenName } from './tabellenAnsicht';
import { bubblesAlsText, bubblesDaten } from './bubbles';
import { sortEntries } from './minutes';
import { makeBubbles, makeKanban, makeKontakt, makeMinutes, makeSheet, makeTime } from './nodes';
import { kontaktDaten } from './vcard';
import { selectActiveBoard, useBoard } from '../store';
import {
  doneCol, kanbanCols, mitSpalte, uid,
  type AppNode, type GanttRow, type KanbanData, type KanbanItem, type KontaktData, type KontaktTelefon, type MinutesData, type MinutesEntry,
  type SheetData, type TimeSeg, type WeekData, type WeekEntry, type ZellStil,
} from '../types';

/** Eine Operation aus dem Plan des Modells – Felder je nach `op` */
export type KiOp = { op: string } & Record<string, unknown>;

export interface KiUmfeld {
  /** Alle Karten des Boards (für Rahmen: was liegt darin) */
  alle: AppNode[];
  /** Namen der Boards (für Portale) */
  boards: Array<{ id: string; name: string }>;
}

/** So viel von einer einzelnen Karte geht höchstens mit */
export const KARTE_MAX = 6000;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const zahl = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const PRIO_NAME = ['', 'hoch', 'mittel', 'niedrig'];
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const kuerzen = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max - 70).trimEnd()}\n… (gekürzt – die Karte hat insgesamt ${t.length} Zeichen)`);

/* ════════════════════════════ LESEN ════════════════════════════ */

function leseKanban(k: KanbanData): string {
  const cols = kanbanCols(k); const dc = doneCol(k);
  const zeile = (it: KanbanItem) => {
    const subs = it.subs ?? [];
    return `[${it.id}] ${cols[Math.max(0, Math.min(dc, it.col))]} · ${it.text}`
      + (it.due ? ` · fällig ${it.due}` : '') + (it.who ? ` · @${it.who}` : '') + (it.prio ? ` · Prio ${PRIO_NAME[it.prio]}` : '')
      + (it.note ? ` · Notiz: ${it.note.replace(/\s+/g, ' ').slice(0, 240)}` : '')
      + (subs.length ? ` · Checkliste ${subs.filter((s) => s.done).length}/${subs.length}: ${subs.map((s) => `${s.done ? '☑' : '☐'} ${s.text}`).join('; ').slice(0, 300)}` : '')
      + (it.deps?.length ? ` · wartet auf ${it.deps.join(', ')}` : '');
  };
  const sortiert = [...(k.items ?? [])].sort((a, b) => Math.min(a.col, dc) - Math.min(b.col, dc));
  const archiv = (k.archiv as unknown[] | undefined)?.length ?? 0;
  return `Kanban „${k.title || 'Kanban'}" · Spalten: ${cols.join(' | ')} (die letzte bedeutet erledigt)\n${sortiert.map(zeile).join('\n') || '(keine Tickets)'}${archiv ? `\nArchiv: ${archiv} Tickets` : ''}`;
}

function leseSheet(s: SheetData): string {
  const zellen = s.cells ?? {}; const spalten = Math.max(1, s.cols ?? 5);
  const werte = rechneBlatt(zellen);
  let letzte = 0;
  for (const adr of Object.keys(zellen)) { if ((zellen[adr] ?? '').trim() === '') continue; const z = Number(adr.replace(/\D+/g, '')); if (z > letzte) letzte = z; }
  const reihe = (z: number) => {
    const teile: string[] = [];
    for (let sp = 0; sp < spalten; sp += 1) {
      const adr = `${spaltenName(sp)}${z}`; const roh = zellen[adr] ?? '';
      const link = s.links?.[adr];
      teile.push(roh.startsWith('=') ? `${roh} → ${zeigeWert(werte[adr] ?? null)}` : `${roh}${link ? ` ⟨${link}⟩` : ''}`);
    }
    while (teile.length && teile[teile.length - 1] === '') teile.pop();
    return `${z}: ${teile.join(' | ')}`;
  };
  const zeilen: string[] = [];
  const GANZ = 70;
  if (letzte <= GANZ) for (let z = 1; z <= letzte; z += 1) zeilen.push(reihe(z));
  else {
    for (let z = 1; z <= GANZ - 12; z += 1) zeilen.push(reihe(z));
    zeilen.push(`… (Zeilen ${GANZ - 11} bis ${letzte - 12} ausgelassen)`);
    for (let z = letzte - 11; z <= letzte; z += 1) zeilen.push(reihe(z));
  }
  const ansicht = s.filterAn ? ` · Datentabelle mit Kopfzeile ${s.kopf ?? 1}${s.sort ? `, sortiert nach ${s.sort.spalte}${s.sort.ab ? ' absteigend' : ''}` : ''}${s.filter && Object.keys(s.filter).length ? `, gefiltert in ${Object.keys(s.filter).join(', ')}` : ''}` : '';
  return `Rechen-Tabelle „${s.title || 'Rechen-Tabelle'}" · Spalten A–${spaltenName(spalten - 1)} · ${letzte} Zeilen mit Inhalt${ansicht}\n`
    + `(Zeile: Zellen von A an, getrennt mit |; Formeln mit ihrem Ergebnis hinter →)\n${zeilen.join('\n') || '(leer)'}`;
}

function leseWeek(w: WeekData): string {
  const cols = w.cols?.length ? w.cols : TAGE.slice(0, w.days === 7 ? 7 : 5);
  const slots = w.axis === 'slots';
  const kopf = `Planer „${w.title || 'Planer'}" · Spalten (day 0 bis ${cols.length - 1}): ${cols.join(' | ')}`
    + (slots ? ` · Zeilen statt Uhrzeiten (start = Zeilennummer × 60, dur = Anzahl × 60): ${(w.slots ?? []).join(' | ')}` : ` · Raster ${hm(w.from)}–${hm(w.to)} (start und dur in Minuten)`);
  const zeilen = [...(w.entries ?? [])].sort((a, b) => a.day - b.day || a.start - b.start)
    .map((e) => `[${e.id}] day ${e.day} (${cols[e.day] ?? '?'}) · start ${e.start} dur ${e.dur}${slots ? '' : ` (${hm(e.start)}–${hm(e.start + e.dur)})`} · ${e.text}${e.who ? ` · ${e.who}` : ''}`);
  return `${kopf}\n${zeilen.join('\n') || '(keine Einträge)'}`;
}

function leseMinutes(m: MinutesData): string {
  const sitzungen = sortEntries(m.entries ?? []);
  const teile = sitzungen.map((e, i) => {
    const kopf = `[${e.id}] Sitzung ${e.date}${e.title?.trim() ? ` „${e.title.trim()}"` : ''}${e.attendees ? ` · Teilnehmende: ${e.attendees}` : ''}`;
    const inhalt = blocksToText(e.blocks).trim();
    const beschluesse = (e.decisions ?? []).map((d) => `§ ${d.text}`).join('\n');
    return [kopf, i < 3 ? inhalt.slice(0, 1800) : inhalt.slice(0, 220), beschluesse].filter(Boolean).join('\n');
  });
  return `Protokoll-Reihe „${m.title || 'Besprechungsreihe'}"${m.agenda?.length ? ` · feste Tagesordnung: ${m.agenda.join(' | ')}` : ''} · ${sitzungen.length} Sitzungen (neueste zuerst)\n${teile.join('\n\n') || '(noch keine Sitzung)'}`;
}

function lesen(n: AppNode, u: KiUmfeld): string {
  switch (n.type) {
    case 'kanban': return leseKanban(n.data);
    case 'sheet': return leseSheet(n.data);
    case 'week': return leseWeek(n.data);
    case 'minutes': return leseMinutes(n.data);
    case 'gantt': {
      const g = n.data;
      return `Zeitplan „${g.title || 'Zeitplan'}"\n${(g.rows ?? []).map((r) => `[${r.id}] ${r.name} · ${r.start} → ${r.end}${r.start === r.end ? ' (Meilenstein)' : ''}${r.progress ? ` · ${r.progress} %` : ''}${r.who ? ` · @${r.who}` : ''}${r.dep ? ` · nach ${r.dep}` : ''}`).join('\n') || '(keine Vorgänge)'}`;
    }
    case 'time': {
      const t = n.data;
      const segs = [...(t.segs ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.start - a.start);
      const minuten = segs.filter((s) => s.kind === 'arbeit' && s.end !== undefined).reduce((sum, s) => sum + (s.end! - s.start), 0);
      return `Zeiterfassung „${t.title || 'Zeiterfassung'}" · Arbeit gesamt ${hm(minuten)} Stunden · ${segs.length} Abschnitte (neueste zuerst)\n`
        + segs.slice(0, 80).map((s) => `[${s.id}] ${s.date} ${hm(s.start)}–${s.end !== undefined ? hm(s.end) : 'läuft'} ${s.kind === 'pause' ? 'Pause' : 'Arbeit'}${s.note ? ` · ${s.note}` : ''}`).join('\n');
    }
    case 'bubbles': return `Ideen-Sammlung (Bubbles)\n${bubblesAlsText(n.data)}`;
    case 'frame': {
      const x = n.position.x; const y = n.position.y; const w = n.width ?? n.measured?.width ?? 0; const h = n.height ?? n.measured?.height ?? 0;
      const drin = u.alle.filter((k) => k.id !== n.id && k.type !== 'frame').filter((k) => {
        const mx = k.position.x + (k.width ?? k.measured?.width ?? 200) / 2; const my = k.position.y + (k.height ?? k.measured?.height ?? 120) / 2;
        return mx >= x && mx <= x + w && my >= y && my <= y + h;
      });
      return `Rahmen „${n.data.name}"${drin.length ? ` · enthält die Karten: ${drin.map((k) => k.id).join(', ')}` : ' · leer'}`;
    }
    case 'portal': {
      const ziel = u.boards.find((b) => b.id === n.data.boardId);
      return ziel ? `Portal zum Board „${ziel.name}"` : 'Portal (noch ohne Ziel-Board)';
    }
    case 'calendar': return `Kalender${n.data.month ? ` (${n.data.month})` : ''} – zeigt Fristen und Zeitplan-Einträge aller Boards; hat keinen eigenen Inhalt`;
    case 'shape': return `Form (${n.data.shape}): ${n.data.text || ''}`;
    // M450: Kontakt-Karte — die Felder als Zeilen (Name, Funktion · Firma, Tel., E-Mail, Anschrift …)
    case 'kontakt': return `Kontakt\n${nodeToText(n)}`;
    default: return nodeToText(n);
  }
}

/** Der ganze Inhalt einer Karte für das Modell – gegliedert, Teile mit Kennung */
export function kiLesen(n: AppNode, u: KiUmfeld, max = KARTE_MAX): string {
  let t = '';
  try { t = lesen(n, u).trim(); } catch { t = nodeToText(n).trim(); }
  const attrs = n.data?.attrs as Record<string, string> | undefined;
  if (attrs && Object.keys(attrs).length && !['note', 'email', 'file', 'image', 'mermaid', 'htmlapp'].includes(n.type ?? '')) t += `\n${Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
  return kuerzen(t, max);
}

/** Steckbrief: wovon die Karte handelt – wenn der Platz nicht für alles reicht */
export function kiKurz(n: AppNode, u: KiUmfeld, max = 260): string {
  const voll = kiLesen(n, u, 2000);
  if (voll.length <= max) return voll;
  return `${voll.slice(0, max - 40).trimEnd()} … (nur Anfang – ${voll.length}+ Zeichen)`;
}

/* ════════════════════════════ BESCHREIBEN ════════════════════════════ */

/** Die Operationen, die das Modell zusätzlich zu den Grund-Operationen kennt – nur für vorhandene Modultypen */
export function kiOpsText(typen: Set<string>): string {
  const z: string[] = [];
  z.push('{"op":"answer","text":"..."} (wenn der Nutzer nur etwas WISSEN will – eine Frage zum Inhalt: antworte knapp und genau; dann sind keine weiteren Operationen nötig)');
  z.push('{"op":"sheet","title":"...","rows":[["Posten","Betrag"],["Miete","850"],["Summe","=SUMME(B2:B2)"]],"filter":true,"from":"<optional>"} (Rechen-Tabelle: erste Zeile = Kopf; Zahlen als "12,5"; Formeln beginnen mit "=", Argumente mit ";" getrennt – SUMME MITTELWERT MIN MAX ANZAHL ANZAHL2 PRODUKT RUNDEN ABS WENN HEUTE LÄNGE VERKETTEN HYPERLINK, Rechenzeichen + - * / ^; "filter":true setzt Filter- und Sortierknöpfe in die Kopfzeile)');
  z.push('{"op":"minutes","title":"...","agenda":["TOP 1"],"sessions":[{"date":"yyyy-mm-dd","attendees":"Anna, Ben","text":"Markdown","decisions":["Beschluss ..."]}],"from":"<optional>"} (Protokoll-Reihe für wiederkehrende Besprechungen)');
  z.push('{"op":"bubbles","title":"...","question":"...","ideas":["..."],"groups":[{"name":"...","ideas":[0,2]}],"from":"<optional>"} (Ideen-Sammlung zum Gruppieren und Abstimmen; "ideas" in groups = Nummern aus der Ideenliste, ab 0)');
  if (typen.has('note')) {
    z.push('{"op":"append_note","id":"<Notiz-id>","text":"Markdown – wird UNTEN an die Notiz angehängt, der bisherige Text bleibt"}');
    z.push('{"op":"set_color","ids":["<Notiz-id>"],"color":"yellow|pink|mint|sky|white"}');
  }
  if (typen.has('sheet')) {
    z.push('{"op":"set_cells","id":"<Tabellen-id>","cells":{"B7":"=SUMME(B2:B6)","A7":"Summe"}} (einzelne Zellen setzen oder überschreiben; "" leert eine Zelle; die Tabelle wächst von selbst)');
    z.push('{"op":"add_rows","id":"<Tabellen-id>","rows":[["Strom","95"]]} (Zeilen unten anhängen; eine Summenzeile am Ende rückt nach unten und rechnet die neuen Zeilen mit)');
    z.push('{"op":"format_cells","id":"<Tabellen-id>","range":"A1:D1","bold":true,"italic":false,"color":"#ffffff","bg":"#1f4e79","align":"l|m|r","format":"#,##0.00 \\"€\\"","border":"all|bottom|none"} (Aussehen; "format" ist ein Excel-Zahlenformat wie 0.0% oder dd.mm.yyyy; nur die genannten Eigenschaften ändern sich)');
    z.push('{"op":"sheet_view","id":"<Tabellen-id>","sort":{"column":"B","desc":true},"filter":{"C":["Kiel","Hamburg"]}} (Ansicht der Datentabelle: sortieren, nur bestimmte Werte einer Spalte zeigen; "filter":null und "sort":null heben auf – die Zellen bleiben, wo sie sind)');
  }
  z.push('{"op":"kanban", ... } kennt zusätzlich "columns":["Offen","In Arbeit","Erledigt"] und je Ticket "column":"<Spaltenname>","who":"Name","prio":1|2|3 (1 = hoch),"note":"Beschreibung","subs":["Checklistenpunkt"]');
  if (typen.has('kanban')) {
    z.push('{"op":"add_tickets", ... } nimmt je Ticket dieselben Felder (column, who, prio, note, subs, due)');
    z.push('{"op":"edit_ticket","id":"<Kanban-id>","ticket":"<Ticket-Kennung in [..]>","text":"...","column":"<Spaltenname>","due":"yyyy-mm-dd","who":"...","prio":1|2|3,"note":"..."} (nur die genannten Felder ändern sich; "column" verschiebt das Ticket – die letzte Spalte erledigt es; "" bei due/who/note entfernt den Wert)');
    z.push('{"op":"delete_tickets","id":"<Kanban-id>","tickets":["<Ticket-Kennung>"]} (NUR wenn ausdrücklich gewünscht)');
  }
  if (typen.has('gantt')) {
    z.push('{"op":"add_gantt_rows","id":"<Zeitplan-id>","rows":[{"name":"...","start":"yyyy-mm-dd","end":"yyyy-mm-dd","who":"...","progress":0,"after":"<Vorgang-Kennung>"}]} (start = end ergibt einen Meilenstein; "after" = Vorgänger)');
    z.push('{"op":"edit_gantt_row","id":"<Zeitplan-id>","row":"<Vorgang-Kennung>","name":"...","start":"...","end":"...","who":"...","progress":0-100,"after":"<Vorgang-Kennung oder \\"\\">"}');
    z.push('{"op":"delete_gantt_rows","id":"<Zeitplan-id>","rows":["<Vorgang-Kennung>"]} (NUR wenn ausdrücklich gewünscht)');
  }
  if (typen.has('week')) {
    z.push('{"op":"add_week_entries","id":"<Planer-id>","entries":[{"day":0,"start":540,"dur":90,"text":"...","who":"optional"}]}');
    z.push('{"op":"edit_week_entry","id":"<Planer-id>","entry":"<Eintrag-Kennung>","day":0,"start":540,"dur":90,"text":"...","who":"..."}');
    z.push('{"op":"delete_week_entries","id":"<Planer-id>","entries":["<Eintrag-Kennung>"]} (NUR wenn ausdrücklich gewünscht)');
  }
  if (typen.has('minutes')) {
    z.push('{"op":"add_session","id":"<Protokoll-id>","date":"yyyy-mm-dd","attendees":"...","text":"Markdown","decisions":["..."]} (neue Sitzung in der Reihe)');
    z.push('{"op":"add_decisions","id":"<Protokoll-id>","session":"<Sitzungs-Kennung; fehlt = neueste>","decisions":["..."]}');
  }
  z.push('{"op":"time", ... } kennt zusätzlich "segments":[{"date":"yyyy-mm-dd","start":540,"end":720,"kind":"arbeit|pause","note":"..."}] (Minuten seit Mitternacht)');
  if (typen.has('time')) z.push('{"op":"add_time","id":"<Zeiterfassung-id>","segments":[{"date":"yyyy-mm-dd","start":540,"end":720,"kind":"arbeit|pause","note":"..."}]}');
  if (typen.has('bubbles')) z.push('{"op":"add_ideas","id":"<Ideen-id>","ideas":["..."]}');
  if (typen.has('mermaid')) z.push('{"op":"edit_mermaid","id":"<Diagramm-id>","code":"vollständiger neuer Mermaid-Code"}');
  // M454: Kontakte anlegen und pflegen – Felder wie in der Kontakt-Karte (lib/vcard.ts schreibt daraus die vCard)
  z.push('{"op":"kontakt","name":"Vorname Nachname","funktion":"...","firma":"...","telefone":[{"nummer":"+49 761 123456","art":"Dienstlich|Mobil|Privat|Fax"}],"emails":["..."],"adresse":"Straße 1\\n79098 Freiburg","web":"...","notiz":"...","from":"<optional>"} (Kontakt-Karte für eine Person; nur die bekannten Felder angeben)');
  if (typen.has('kontakt')) z.push('{"op":"edit_kontakt","id":"<Kontakt-id>","name":"...","funktion":"...","firma":"...","telefone":[{"nummer":"...","art":"..."}],"emails":["..."],"adresse":"...","web":"...","notiz":"..."} (nur die genannten Felder ändern sich; "telefone" und "emails" ersetzen die ganze Liste – bisherige Nummern, die bleiben sollen, mit angeben; "" entfernt einen Wert)');
  return z.join('\n');
}

/* ════════════════════════════ BEDIENEN ════════════════════════════ */

export interface KiUmgebung {
  /** Karten, die es beim Start gab (zum Prüfen von ids) */
  known: Map<string, AppNode>;
  st: ReturnType<typeof useBoard.getState>;
  place: (h: number) => { x: number; y: number };
  /** Pfeil von der Quell-Karte („from") zum neuen Modul */
  linkFrom: (o: KiOp, neu: string) => void;
  /** Vorab aus Markdown gebaute Blöcke (vorbereiten) */
  bloecke: Map<KiOp, unknown[][]>;
  /** Eine Notiz wurde geändert – das Board muss ihren Editor neu aufbauen */
  notizGeaendert: () => void;
  antwort: (t: string) => void;
}

/** Der Stand einer Karte JETZT – frühere Schritte desselben Plans können sie schon geändert haben */
const frisch = (id: unknown): AppNode | undefined => (typeof id === 'string' ? selectActiveBoard(useBoard.getState())?.nodes.find((n) => n.id === id) : undefined);

/** Welche Operationen brauchen vorab Blöcke aus Markdown? (mdToBlocks ist asynchron, ausgeführt wird in einem Zug) */
export async function kiVorbereiten(plan: KiOp[], mdToBlocks: (titel: string, md: string) => Promise<unknown[]>): Promise<Map<KiOp, unknown[][]>> {
  const aus = new Map<KiOp, unknown[][]>();
  for (const o of plan) {
    if (o.op === 'append_note' || o.op === 'add_session') {
      const md = text(o.text, 20000);
      aus.set(o, [md ? await mdToBlocks('', md) : []]);
    } else if (o.op === 'minutes') {
      const je: unknown[][] = [];
      for (const s of liste(o.sessions).slice(0, 20)) { const md = text((s as Record<string, unknown>)?.text, 20000); je.push(md ? await mdToBlocks('', md) : []); }
      aus.set(o, je);
    }
  }
  return aus;
}

/* ---------- Kanban ---------- */
const prioVon = (v: unknown): 1 | 2 | 3 | undefined => {
  const n = zahl(v);
  if (n === 1 || n === 2 || n === 3) return n;
  const t = text(v).toLowerCase();
  return /hoch|high|dringend/.test(t) ? 1 : /mittel|medium|normal/.test(t) ? 2 : /niedrig|low|gering/.test(t) ? 3 : undefined;
};
const spalteVon = (v: unknown, cols: string[]): number | null => {
  const n = zahl(v);
  if (typeof v === 'number' && n !== null) return Math.max(0, Math.min(cols.length - 1, Math.round(n)));
  const t = text(v).toLowerCase();
  if (!t) return null;
  const genau = cols.findIndex((c) => c.toLowerCase() === t);
  if (genau >= 0) return genau;
  const etwa = cols.findIndex((c) => c.toLowerCase().includes(t) || t.includes(c.toLowerCase()));
  if (etwa >= 0) return etwa;
  if (/erledigt|fertig|done|abgeschlossen/.test(t)) return cols.length - 1;
  if (/arbeit|doing|läuft|progress/.test(t)) return Math.min(1, cols.length - 1);
  return null;
};
function ticketsAus(roh: unknown, data: KanbanData): KanbanItem[] {
  const cols = kanbanCols(data);
  return liste(roh).map((r) => (typeof r === 'string' ? { text: r } : r) as Record<string, unknown>).filter((r) => r && text(r.text))
    .slice(0, 60).map((r) => {
      const col = spalteVon(r.column ?? r.col, cols) ?? 0;
      const subs = liste(r.subs).map((s) => text(typeof s === 'string' ? s : (s as Record<string, unknown>)?.text, 120)).filter(Boolean).slice(0, 20).map((s) => ({ id: uid(), text: s }));
      const it: KanbanItem = { id: uid(), text: text(r.text, 140), col: 0 };
      if (ISO.test(text(r.due))) it.due = text(r.due);
      if (text(r.who, 40)) it.who = text(r.who, 40);
      const p = prioVon(r.prio); if (p) it.prio = p;
      if (text(r.note, 600)) it.note = text(r.note, 600);
      if (subs.length) it.subs = subs;
      return col > 0 ? mitSpalte(it, col, data) : it;
    });
}

/* ---------- Rechen-Tabelle ---------- */
const ADR = /^([A-Z]{1,2})(\d{1,4})$/;
/** Was das Modell in eine Zelle schreibt → Rohtext der Zelle (Zahlen in hiesiger Schreibweise) */
const zellText = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v).replace('.', ',') : typeof v === 'boolean' ? (v ? 'WAHR' : 'FALSCH') : typeof v === 'string' ? v.trim().slice(0, 500) : '');
const spalteNr = (name: string): number => { let n = 0; for (const c of name) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
function masse(s: SheetData, zellen: Record<string, string>): { cols: number; rows: number } {
  let cols = s.cols ?? 5; let rows = s.rows ?? 8;
  for (const adr of Object.keys(zellen)) { const m = ADR.exec(adr); if (!m) continue; cols = Math.max(cols, spalteNr(m[1]) + 1); rows = Math.max(rows, Number(m[2])); }
  return { cols: Math.min(cols, 60), rows: Math.min(rows, 2000) };
}
const letzteZeile = (zellen: Record<string, string>): number => { let l = 0; for (const adr of Object.keys(zellen)) { if ((zellen[adr] ?? '').trim() === '') continue; const z = Number(adr.replace(/\D+/g, '')); if (z > l) l = z; } return l; };
const HEX = /^#[0-9a-f]{6}$/i;
/** Bereich „A1:D3" oder „B2" → Adressen (gedeckelt) */
function bereich(roh: unknown): string[] {
  const m = /^\s*\$?([A-Z]{1,2})\$?(\d{1,4})(?:\s*:\s*\$?([A-Z]{1,2})\$?(\d{1,4}))?\s*$/i.exec(text(roh, 20).toUpperCase());
  if (!m) return [];
  const s1 = spalteNr(m[1]); const z1 = Number(m[2]); const s2 = m[3] ? spalteNr(m[3]) : s1; const z2 = m[4] ? Number(m[4]) : z1;
  const aus: string[] = [];
  for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z += 1) for (let s = Math.min(s1, s2); s <= Math.max(s1, s2); s += 1) { aus.push(`${spaltenName(s)}${z}`); if (aus.length >= 3000) return aus; }
  return aus;
}

/* ---------- Planer, Zeitplan, Zeit ---------- */
function wochenEintraege(roh: unknown, w: WeekData): WeekEntry[] {
  const tage = w.cols?.length ? w.cols.length : (w.days === 7 ? 7 : 5);
  return liste(roh).map((e) => e as Record<string, unknown>).filter((e) => e && text(e.text) && zahl(e.day) !== null && zahl(e.day)! >= 0 && zahl(e.day)! < tage && zahl(e.start) !== null && zahl(e.start)! >= 0 && zahl(e.start)! < 1440)
    .slice(0, 60).map((e) => {
      const raster = w.axis === 'slots' ? 60 : 30;
      const neu: WeekEntry = { id: uid(), day: Math.round(zahl(e.day)!), start: Math.round(zahl(e.start)! / raster) * raster, dur: Math.min(720, Math.max(raster, Math.round((zahl(e.dur) ?? 60) / raster) * raster)), text: text(e.text, 80) };
      if (text(e.who, 30)) neu.who = text(e.who, 30);
      return neu;
    });
}
function vorgaenge(roh: unknown, vorhanden: GanttRow[]): GanttRow[] {
  const aus: GanttRow[] = [];
  for (const r0 of liste(roh).slice(0, 40)) {
    const r = r0 as Record<string, unknown>;
    if (!r || !text(r.name) || !ISO.test(text(r.start)) || !ISO.test(text(r.end))) continue;
    const start = text(r.start); const end = text(r.end) >= start ? text(r.end) : start;
    const neu: GanttRow = { id: uid(), name: text(r.name, 80), start, end };
    if (text(r.who, 40)) neu.who = text(r.who, 40);
    const p = zahl(r.progress); if (p !== null && p > 0) neu.progress = Math.max(0, Math.min(100, Math.round(p)));
    const nach = vorgaengerVon(r.after ?? r.dep, [...vorhanden, ...aus]); if (nach) neu.dep = nach;
    aus.push(neu);
  }
  return aus;
}
const vorgaengerVon = (v: unknown, rows: GanttRow[]): string | undefined => {
  const t = text(v, 80); if (!t) return undefined;
  return (rows.find((r) => r.id === t) ?? rows.find((r) => r.name.toLowerCase() === t.toLowerCase()))?.id;
};
function abschnitte(roh: unknown): TimeSeg[] {
  return liste(roh).map((s) => s as Record<string, unknown>).filter((s) => s && ISO.test(text(s.date)) && zahl(s.start) !== null && zahl(s.end) !== null && zahl(s.start)! >= 0 && zahl(s.end)! <= 1440 && zahl(s.end)! > zahl(s.start)!)
    .slice(0, 120).map((s) => ({ id: uid(), date: text(s.date), start: Math.round(zahl(s.start)!), end: Math.round(zahl(s.end)!), kind: text(s.kind) === 'pause' ? 'pause' as const : 'arbeit' as const, ...(text(s.note, 120) ? { note: text(s.note, 120) } : {}) }));
}

/* ---------- Kontakt (M454) ---------- */
const KONTAKT_TEXTE: Array<[keyof KontaktData, number]> = [['name', 120], ['funktion', 120], ['firma', 160], ['adresse', 400], ['web', 300], ['notiz', 2000]];
/** Nur die Felder, die die Operation nennt – geprüft und gekürzt; "" leert einen Wert. Ein Foto nimmt die KI nie an. */
function kontaktFelder(o: KiOp): Partial<KontaktData> {
  const aus: Partial<KontaktData> = {};
  for (const [feld, max] of KONTAKT_TEXTE) {
    if (!(feld in o)) continue;
    const roh = o[feld as string];
    if (roh === null || roh === '') { aus[feld] = ''; continue; }
    const t = typeof roh === 'string' ? roh.replace(/\\n/g, '\n').trim().slice(0, max) : '';
    if (t) aus[feld] = t;
  }
  if ('telefone' in o) {
    aus.telefone = liste(o.telefone).slice(0, 12).map((t): KontaktTelefon | null => {
      if (typeof t === 'string') return text(t, 60) ? { nummer: text(t, 60) } : null;
      const r = t as Record<string, unknown> | null;
      const nummer = text(r?.nummer ?? r?.number, 60);
      const art = text(r?.art ?? r?.type, 30);
      return nummer ? { nummer, ...(art ? { art } : {}) } : null;
    }).filter((t): t is KontaktTelefon => !!t);
  }
  if ('emails' in o) aus.emails = liste(o.emails).map((m) => text(m, 200)).filter((m) => /^[^\s@]+@[^\s@]+$/.test(m)).slice(0, 8);
  return aus;
}

/**
 * Eine Operation ausführen. `undefined`: Diese Operation gehört nicht hierher (die Grund-Operationen in aiActions
 * übernehmen). `false`: erkannt, aber nicht ausführbar (unbekannte id, nichts Gültiges). `true`: ausgeführt.
 */
export function kiAusfuehren(o: KiOp, u: KiUmgebung): boolean | undefined {
  const { st } = u;
  const ziel = (typ: string): AppNode | undefined => { const n = frisch(o.id); return n && u.known.has(n.id) && n.type === typ ? n : undefined; };
  switch (o.op) {
    case 'answer': { const t = text(o.text, 4000); if (!t) return false; u.antwort(t); return true; }

    /* ----- Notiz ----- */
    case 'append_note': {
      const n = ziel('note'); const neu = u.bloecke.get(o)?.[0] ?? [];
      if (!n || neu.length === 0) return false;
      st.updateNodeData(n.id, { blocks: [...((n.data as { blocks?: unknown[] }).blocks ?? []), ...neu] });
      u.notizGeaendert();
      return true;
    }
    case 'set_color': {
      const farbe = text(o.color);
      if (!['yellow', 'pink', 'mint', 'sky', 'white'].includes(farbe)) return false;
      const ids = liste(o.ids).map((i) => frisch(i)).filter((n): n is AppNode => !!n && u.known.has(n.id) && (n.type === 'note' || n.type === 'minutes'));
      for (const n of ids) st.updateNodeData(n.id, { color: farbe, hex: undefined });
      return ids.length > 0;
    }

    /* ----- Rechen-Tabelle ----- */
    case 'sheet': {
      const rows = liste(o.rows).filter(Array.isArray).slice(0, 300) as unknown[][];
      if (rows.length === 0) return false;
      const cols = Math.min(40, Math.max(2, ...rows.map((r) => r.length)));
      const cells: Record<string, string> = {};
      rows.forEach((r, z) => r.slice(0, cols).forEach((v, s) => { const t = zellText(v); if (t !== '') cells[`${spaltenName(s)}${z + 1}`] = t; }));
      const kopf: Record<string, number> = {};
      if (rows.length > 1) for (let s = 0; s < cols; s += 1) if (cells[`${spaltenName(s)}1`]) kopf[`${spaltenName(s)}1`] = 0;
      const node = makeSheet(u.place(Math.min(560, rows.length * 28 + 120)), {
        title: text(o.title, 60) || 'Rechen-Tabelle', cells, cols, rows: Math.max(rows.length + 1, 4),
        ...(Object.keys(kopf).length ? { stilListe: [{ f: 1 }], stile: kopf } : {}),
        ...(o.filter === true && rows.length > 2 ? { filterAn: true, kopf: 1 } : {}),
      });
      node.width = Math.max(320, Math.min(900, 64 + cols * 110));
      node.height = Math.max(220, Math.min(560, rows.length * 28 + 120));
      st.addNode(node); u.linkFrom(o, node.id);
      return true;
    }
    case 'set_cells': {
      const n = ziel('sheet'); const roh = o.cells;
      if (!n || !roh || typeof roh !== 'object') return false;
      const s = n.data as SheetData; const cells = { ...(s.cells ?? {}) }; let geaendert = 0;
      for (const [k, v] of Object.entries(roh as Record<string, unknown>).slice(0, 3000)) {
        const adr = k.trim().toUpperCase().replace(/\$/g, '');
        if (!ADR.test(adr)) continue;
        const t = zellText(v);
        if (t === '') delete cells[adr]; else cells[adr] = t;
        geaendert += 1;
      }
      if (!geaendert) return false;
      st.updateNodeData(n.id, { cells, ...masse(s, cells) });
      return true;
    }
    case 'add_rows': {
      const n = ziel('sheet'); const rows = liste(o.rows).filter(Array.isArray).slice(0, 300) as unknown[][];
      if (!n || rows.length === 0) return false;
      const s = n.data as SheetData; const cells = { ...(s.cells ?? {}) }; const stile = { ...(s.stile ?? {}) };
      const letzte = letzteZeile(cells); const k = rows.length;
      // Fasst die letzte Zeile mehrere Zeilen zusammen (=SUMME(B2:B9)), ist sie eine Summenzeile: Sie rückt nach unten
      const inZeile = (z: number) => Object.keys(cells).filter((a) => Number(a.replace(/\D+/g, '')) === z);
      const summe = letzte > 1 && inZeile(letzte).some((a) => cells[a].startsWith('=') && [...cells[a].matchAll(/\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)/g)].some((m) => m[1] !== m[2]));
      let ab = letzte + 1;
      if (summe) {
        ab = letzte;
        for (const a of Object.keys({ ...cells, ...stile }).filter((x) => Number(x.replace(/\D+/g, '')) === letzte)) {
          const sp = a.replace(/\d+/g, ''); const ziel2 = `${sp}${letzte + k}`;
          if (cells[a] !== undefined) {
            // Bereiche, die bis zur letzten Datenzeile reichten, reichen jetzt bis zur neuen letzten
            cells[ziel2] = cells[a].startsWith('=') ? cells[a].replace(/(\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?)(\d+)/g, (g, vorn: string, z: string) => (Number(z) === letzte - 1 ? `${vorn}${letzte - 1 + k}` : g)) : cells[a];
            delete cells[a];
          }
          if (stile[a] !== undefined) { stile[ziel2] = stile[a]; delete stile[a]; }
        }
      }
      rows.forEach((r, i) => r.slice(0, 60).forEach((v, sp) => {
        const adr = `${spaltenName(sp)}${ab + i}`; const t = zellText(v);
        if (t !== '') cells[adr] = t;
        // neue Zeilen sehen aus wie die Datenzeile darüber
        const vorbild = stile[`${spaltenName(sp)}${ab - 1}`];
        if (vorbild !== undefined && ab - 1 > (s.kopf ?? 0)) stile[adr] = vorbild;
      }));
      const patch: Record<string, unknown> = { cells, ...masse(s, cells) };
      if (s.stile) patch.stile = stile;
      if (typeof s.bis === 'number' && s.bis >= ab - 1) patch.bis = s.bis + k;
      st.updateNodeData(n.id, patch);
      return true;
    }
    case 'format_cells': {
      const n = ziel('sheet'); const adrn = bereich(o.range);
      if (!n || adrn.length === 0) return false;
      const s = n.data as SheetData; const stilListe: ZellStil[] = [...(s.stilListe ?? [])]; const stile = { ...(s.stile ?? {}) };
      const index = new Map(stilListe.map((x, i) => [JSON.stringify(x), i]));
      const an = (v: unknown) => v === true || v === 1;
      const setze = (alt: ZellStil): ZellStil => {
        const neu: ZellStil = { ...alt };
        const schalter = (feld: 'f' | 'k' | 'u' | 'd' | 'um', v: unknown) => { if (v === undefined) return; if (an(v)) neu[feld] = 1; else delete neu[feld]; };
        schalter('f', o.bold); schalter('k', o.italic); schalter('u', o.underline); schalter('d', o.strike); schalter('um', o.wrap);
        if (o.color !== undefined) { if (HEX.test(text(o.color))) neu.fa = text(o.color).toLowerCase(); else delete neu.fa; }
        if (o.bg !== undefined) { if (HEX.test(text(o.bg))) neu.bg = text(o.bg).toLowerCase(); else delete neu.bg; }
        if (o.align !== undefined) { const a = text(o.align).toLowerCase(); const w = /^(l|left|links)$/.test(a) ? 'l' : /^(m|c|center|mitte|zentriert)$/.test(a) ? 'm' : /^(r|right|rechts)$/.test(a) ? 'r' : null; if (w) neu.a = w; else delete neu.a; }
        if (o.format !== undefined) { const f = typeof o.format === 'string' ? o.format.trim().slice(0, 60) : ''; if (f && !/^(general|standard)$/i.test(f)) neu.z = f; else delete neu.z; }
        if (o.border !== undefined) {
          const b = text(o.border).toLowerCase(); const linie = '1px solid #000000';
          delete neu.ro; delete neu.rr; delete neu.ru; delete neu.rl;
          if (b === 'all') { neu.ro = linie; neu.rr = linie; neu.ru = linie; neu.rl = linie; } else if (b === 'bottom') neu.ru = linie; else if (b === 'top') neu.ro = linie;
        }
        return neu;
      };
      for (const adr of adrn) {
        const neu = setze(stile[adr] !== undefined ? (stilListe[stile[adr]] ?? {}) : {});
        if (Object.keys(neu).length === 0) { delete stile[adr]; continue; }
        const schluessel = JSON.stringify(neu);
        let i = index.get(schluessel);
        if (i === undefined) { i = stilListe.length; stilListe.push(neu); index.set(schluessel, i); }
        stile[adr] = i;
      }
      st.updateNodeData(n.id, { stilListe, stile, ...masse(s, Object.fromEntries(adrn.map((a) => [a, 'x']))) });
      return true;
    }
    case 'sheet_view': {
      const n = ziel('sheet');
      if (!n) return false;
      const s = n.data as SheetData; const patch: Record<string, unknown> = {};
      const spalte = (v: unknown) => { const t = text(v, 3).toUpperCase(); return /^[A-Z]{1,2}$/.test(t) ? t : null; };
      if (o.sort === null) patch.sort = undefined;
      else if (o.sort && typeof o.sort === 'object') { const sp = spalte((o.sort as Record<string, unknown>).column); if (sp) patch.sort = { spalte: sp, ...((o.sort as Record<string, unknown>).desc === true ? { ab: true } : {}) }; }
      if (o.filter === null) patch.filter = undefined;
      else if (o.filter && typeof o.filter === 'object') {
        const f: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(o.filter as Record<string, unknown>)) { const sp = spalte(k); if (sp && Array.isArray(v)) f[sp] = v.map((x) => zellText(x)).slice(0, 500); }
        patch.filter = Object.keys(f).length ? f : undefined;
      }
      if (Object.keys(patch).length === 0) return false;
      st.updateNodeData(n.id, { filterAn: true, kopf: s.kopf ?? ersteZeile(s.cells ?? {}, s.rows ?? 8), ...patch });
      return true;
    }

    /* ----- Kanban ----- */
    case 'kanban': {
      const node = makeKanban(u.place(220), text(o.title, 60) || 'Aufgaben');
      const data = node.data as KanbanData;
      const cols = liste(o.columns).map((c) => text(c, 30)).filter(Boolean).slice(0, 8);
      if (cols.length >= 2) data.cols = cols;
      data.items = ticketsAus(o.items, data);
      st.addNode(node); u.linkFrom(o, node.id);
      return true;
    }
    case 'add_tickets': {
      const n = ziel('kanban');
      if (!n) return false;
      const data = n.data as KanbanData; const neu = ticketsAus(o.items, data);
      if (neu.length === 0) return false;
      st.updateNodeData(n.id, { items: [...(data.items ?? []), ...neu] });
      return true;
    }
    case 'edit_ticket': {
      const n = ziel('kanban');
      if (!n) return false;
      const data = n.data as KanbanData; const cols = kanbanCols(data); const ref = text(o.ticket, 160);
      const treffer = data.items.find((it) => it.id === ref) ?? data.items.find((it) => it.text.toLowerCase() === ref.toLowerCase());
      if (!treffer) return false;
      let neu: KanbanItem = { ...treffer }; let geaendert = false;
      const feld = <K extends 'due' | 'who' | 'note'>(k: K, v: unknown, gut: (t: string) => boolean, max: number) => {
        if (v === undefined) return;
        const t = text(v, max);
        if (t === '') { if (neu[k] !== undefined) { delete neu[k]; geaendert = true; } } else if (gut(t)) { neu[k] = t; geaendert = true; }
      };
      if (text(o.text, 140)) { neu.text = text(o.text, 140); geaendert = true; }
      feld('due', o.due, (t) => ISO.test(t), 10); feld('who', o.who, () => true, 40); feld('note', o.note, () => true, 600);
      if (o.prio !== undefined) { const p = prioVon(o.prio); if (p) neu.prio = p; else delete neu.prio; geaendert = true; }
      const col = o.done === true ? cols.length - 1 : spalteVon(o.column ?? o.col, cols);
      if (col !== null && col !== Math.min(neu.col, cols.length - 1)) { neu = mitSpalte(neu, col, data); geaendert = true; }
      if (!geaendert) return false;
      st.updateNodeData(n.id, { items: data.items.map((it) => (it.id === treffer.id ? neu : it)) });
      return true;
    }
    case 'delete_tickets': {
      const n = ziel('kanban');
      if (!n) return false;
      const data = n.data as KanbanData; const weg = new Set(liste(o.tickets).map((t) => text(t, 40)));
      const bleibt = data.items.filter((it) => !weg.has(it.id));
      if (bleibt.length === data.items.length) return false;
      st.updateNodeData(n.id, { items: bleibt.map((it) => (it.deps?.some((d) => weg.has(d)) ? { ...it, deps: it.deps.filter((d) => !weg.has(d)) } : it)) });
      return true;
    }

    /* ----- Zeitplan ----- */
    case 'add_gantt_rows': {
      const n = ziel('gantt');
      if (!n) return false;
      const alt = (n.data as { rows?: GanttRow[] }).rows ?? []; const neu = vorgaenge(o.rows, alt);
      if (neu.length === 0) return false;
      st.updateNodeData(n.id, { rows: [...alt, ...neu] });
      return true;
    }
    case 'edit_gantt_row': {
      const n = ziel('gantt');
      if (!n) return false;
      const rows = (n.data as { rows?: GanttRow[] }).rows ?? []; const ref = text(o.row, 80);
      const treffer = rows.find((r) => r.id === ref) ?? rows.find((r) => r.name.toLowerCase() === ref.toLowerCase());
      if (!treffer) return false;
      const neu: GanttRow = { ...treffer };
      if (text(o.name, 80)) neu.name = text(o.name, 80);
      if (ISO.test(text(o.start))) neu.start = text(o.start);
      if (ISO.test(text(o.end))) neu.end = text(o.end);
      if (neu.end < neu.start) { if (ISO.test(text(o.start)) && !ISO.test(text(o.end))) neu.end = neu.start; else neu.start = neu.end; }
      if (o.who !== undefined) { if (text(o.who, 40)) neu.who = text(o.who, 40); else delete neu.who; }
      const p = zahl(o.progress); if (p !== null) neu.progress = Math.max(0, Math.min(100, Math.round(p)));
      if (o.after !== undefined || o.dep !== undefined) { const nach = vorgaengerVon(o.after ?? o.dep, rows.filter((r) => r.id !== treffer.id)); if (nach) neu.dep = nach; else delete neu.dep; }
      if (JSON.stringify(neu) === JSON.stringify(treffer)) return false;
      st.updateNodeData(n.id, { rows: rows.map((r) => (r.id === treffer.id ? neu : r)) });
      return true;
    }
    case 'delete_gantt_rows': {
      const n = ziel('gantt');
      if (!n) return false;
      const rows = (n.data as { rows?: GanttRow[] }).rows ?? []; const weg = new Set(liste(o.rows).map((t) => text(t, 40)));
      const bleibt = rows.filter((r) => !weg.has(r.id));
      if (bleibt.length === rows.length) return false;
      st.updateNodeData(n.id, { rows: bleibt.map((r) => (r.dep && weg.has(r.dep) ? { ...r, dep: undefined } : r)) });
      return true;
    }

    /* ----- Planer ----- */
    case 'add_week_entries': {
      const n = ziel('week');
      if (!n) return false;
      const w = n.data as WeekData; const neu = wochenEintraege(o.entries, w);
      if (neu.length === 0) return false;
      const patch: Record<string, unknown> = { entries: [...(w.entries ?? []), ...neu] };
      if (w.axis !== 'slots') {   // das Raster wächst mit, wenn ein Eintrag davor oder dahinter liegt
        patch.from = Math.max(0, Math.floor(Math.min(w.from, ...neu.map((e) => e.start)) / 60) * 60);
        patch.to = Math.min(1440, Math.ceil(Math.max(w.to, ...neu.map((e) => e.start + e.dur)) / 60) * 60);
      }
      st.updateNodeData(n.id, patch);
      return true;
    }
    case 'edit_week_entry': {
      const n = ziel('week');
      if (!n) return false;
      const w = n.data as WeekData; const ref = text(o.entry, 80);
      const treffer = (w.entries ?? []).find((e) => e.id === ref) ?? (w.entries ?? []).find((e) => e.text.toLowerCase() === ref.toLowerCase());
      if (!treffer) return false;
      const tage = w.cols?.length ? w.cols.length : (w.days === 7 ? 7 : 5); const raster = w.axis === 'slots' ? 60 : 30;
      const neu: WeekEntry = { ...treffer };
      const d = zahl(o.day); if (d !== null && d >= 0 && d < tage) neu.day = Math.round(d);
      const s0 = zahl(o.start); if (s0 !== null && s0 >= 0 && s0 < 1440) neu.start = Math.round(s0 / raster) * raster;
      const du = zahl(o.dur); if (du !== null && du > 0) neu.dur = Math.min(720, Math.max(raster, Math.round(du / raster) * raster));
      if (text(o.text, 80)) neu.text = text(o.text, 80);
      if (o.who !== undefined) { if (text(o.who, 30)) neu.who = text(o.who, 30); else delete neu.who; }
      if (JSON.stringify(neu) === JSON.stringify(treffer)) return false;
      const patch: Record<string, unknown> = { entries: w.entries.map((e) => (e.id === treffer.id ? neu : e)) };
      if (w.axis !== 'slots') { patch.from = Math.max(0, Math.floor(Math.min(w.from, neu.start) / 60) * 60); patch.to = Math.min(1440, Math.ceil(Math.max(w.to, neu.start + neu.dur) / 60) * 60); }
      st.updateNodeData(n.id, patch);
      return true;
    }
    case 'delete_week_entries': {
      const n = ziel('week');
      if (!n) return false;
      const w = n.data as WeekData; const weg = new Set(liste(o.entries).map((t) => text(t, 40)));
      const bleibt = (w.entries ?? []).filter((e) => !weg.has(e.id));
      if (bleibt.length === (w.entries ?? []).length) return false;
      st.updateNodeData(n.id, { entries: bleibt });
      return true;
    }

    /* ----- Protokoll ----- */
    case 'minutes': {
      const node = makeMinutes(u.place(420)); const data = node.data as MinutesData;
      data.title = text(o.title, 60) || 'Besprechungsreihe';
      const agenda = liste(o.agenda).map((a) => text(a, 80)).filter(Boolean).slice(0, 12);
      if (agenda.length) data.agenda = agenda;
      const bloecke = u.bloecke.get(o) ?? [];
      data.entries = sortEntries(liste(o.sessions).slice(0, 20).map((s0, i): MinutesEntry | null => {
        const s = s0 as Record<string, unknown>;
        if (!s || !ISO.test(text(s.date))) return null;
        return {
          id: uid(), date: text(s.date), ...(text(s.title, 60) ? { title: text(s.title, 60) } : {}), ...(text(s.attendees, 200) ? { attendees: text(s.attendees, 200) } : {}),
          blocks: bloecke[i]?.length ? bloecke[i] : [{ type: 'paragraph', content: '' }],
          decisions: liste(s.decisions).map((d) => text(d, 300)).filter(Boolean).slice(0, 30).map((d) => ({ id: uid(), text: d })),
        };
      }).filter((e): e is MinutesEntry => !!e));
      st.addNode(node); u.linkFrom(o, node.id);
      return true;
    }
    case 'add_session': {
      const n = ziel('minutes');
      if (!n || !ISO.test(text(o.date))) return false;
      const data = n.data as MinutesData; const bloecke = u.bloecke.get(o)?.[0] ?? [];
      const neu: MinutesEntry = {
        id: uid(), date: text(o.date), ...(text(o.title, 60) ? { title: text(o.title, 60) } : {}),
        attendees: text(o.attendees, 200) || sortEntries(data.entries ?? [])[0]?.attendees,
        blocks: bloecke.length ? bloecke : [{ type: 'paragraph', content: '' }],
        decisions: liste(o.decisions).map((d) => text(d, 300)).filter(Boolean).slice(0, 30).map((d) => ({ id: uid(), text: d })),
      };
      st.updateNodeData(n.id, { entries: sortEntries([...(data.entries ?? []), neu]), current: neu.id });
      return true;
    }
    case 'add_decisions': {
      const n = ziel('minutes');
      if (!n) return false;
      const data = n.data as MinutesData; const sortiert = sortEntries(data.entries ?? []);
      const sitzung = sortiert.find((e) => e.id === text(o.session, 40)) ?? sortiert.find((e) => e.date === text(o.session, 10)) ?? sortiert[0];
      const neu = liste(o.decisions).map((d) => text(d, 300)).filter(Boolean).slice(0, 30).map((d) => ({ id: uid(), text: d }));
      if (!sitzung || neu.length === 0) return false;
      st.updateNodeData(n.id, { entries: data.entries.map((e) => (e.id === sitzung.id ? { ...e, decisions: [...(e.decisions ?? []), ...neu] } : e)) });
      return true;
    }

    /* ----- Zeiterfassung ----- */
    case 'time': {
      const node = makeTime(u.place(380));
      (node.data as { title: string }).title = text(o.title, 60) || 'Zeiterfassung';
      (node.data as { segs: TimeSeg[] }).segs = abschnitte(o.segments);
      st.addNode(node); u.linkFrom(o, node.id);
      return true;
    }
    case 'add_time': {
      const n = ziel('time'); const neu = abschnitte(o.segments);
      if (!n || neu.length === 0) return false;
      st.updateNodeData(n.id, { segs: [...((n.data as { segs?: TimeSeg[] }).segs ?? []), ...neu] });
      return true;
    }

    /* ----- Ideen ----- */
    case 'bubbles':
    case 'add_ideas': {
      const neuAnlegen = o.op === 'bubbles';
      const n = neuAnlegen ? makeBubbles(u.place(440)) : ziel('bubbles');
      if (!n) return false;
      const d = bubblesDaten(n.data as never); const jetzt = Date.now();
      const ideen = { ...d.ideen }; const gruppen = { ...d.gruppen }; const kennungen: string[] = [];
      liste(o.ideas).map((i) => text(i, 140)).filter(Boolean).slice(0, 80).forEach((t, i) => { const k = uid(); kennungen.push(k); ideen[k] = { text: t, von: 'ki', name: 'KI', t: jetzt + i }; });
      if (kennungen.length === 0 && !neuAnlegen) return false;
      if (neuAnlegen) liste(o.groups).slice(0, 12).forEach((g0, gi) => {
        const g = g0 as Record<string, unknown>; const name = text(g?.name, 40);
        if (!name) return;
        const gid = uid(); gruppen[gid] = { name, farbe: gi % 6, t: jetzt + gi };
        for (const nr of liste(g.ideas)) { const k = kennungen[zahl(nr) ?? -1]; if (k) ideen[k] = { ...ideen[k], g: gid }; }
      });
      if (neuAnlegen) {
        Object.assign(n.data, { title: text(o.title, 60) || 'Ideen', frage: text(o.question, 200), ideen, gruppen });
        st.addNode(n); u.linkFrom(o, n.id);
      } else st.updateNodeData(n.id, { ideen });
      return true;
    }

    /* ----- Kontakt (M454) ----- */
    case 'kontakt':
    case 'edit_kontakt': {
      const neuAnlegen = o.op === 'kontakt';
      const n = neuAnlegen ? undefined : ziel('kontakt');
      if (!neuAnlegen && !n) return false;
      const felder = kontaktFelder(o);
      if (neuAnlegen) {
        const d = kontaktDaten(felder);
        if (!d.name && !d.firma && !d.telefone.length && !d.emails.length) return false;
        const node = makeKontakt(u.place(220), d);
        st.addNode(node); u.linkFrom(o, node.id);
        return true;
      }
      if (Object.keys(felder).length === 0) return false;
      st.updateNodeData(n!.id, felder);
      return true;
    }

    /* ----- Diagramm ----- */
    case 'edit_mermaid': {
      const n = ziel('mermaid'); const code = (typeof o.code === 'string' ? o.code : '').replace(/```(mermaid)?/g, '').trim();
      if (!n || !code) return false;
      st.updateNodeData(n.id, { code });
      return true;
    }
    default: return undefined;
  }
}

/* ════════════════════════════ AUSWÄHLEN ════════════════════════════ */

const TYP_WORTE: Array<[RegExp, string]> = [
  [/tabelle|excel|zelle|spalte|zeile|summe|formel|rechne|sheet/i, 'sheet'], [/kanban|ticket|aufgabe|todo|to-do|erledig/i, 'kanban'],
  [/zeitplan|gantt|vorgang|meilenstein|phase/i, 'gantt'], [/protokoll|sitzung|beschluss|besprechung|meeting/i, 'minutes'],
  [/wochenplan|stundenplan|dienstplan|planer|schicht/i, 'week'], [/zeiterfassung|arbeitszeit|stunden/i, 'time'],
  [/diagramm|ablauf|flowchart|mermaid|workflow/i, 'mermaid'], [/notiz|text|absatz/i, 'note'], [/mail/i, 'email'],
  [/datei|pdf|dokument|word/i, 'file'], [/idee|bubble|brainstorm/i, 'bubbles'], [/bild|foto|screenshot/i, 'image'], [/kontakt|telefon|anruf|ansprechpartner|adresse|visitenkarte/i, 'kontakt'],
];

/**
 * Wie viel hat eine Karte mit dem Wunsch zu tun? Wörter des Wunsches im Titel (stark) und im Text, das genannte
 * Modul („die Tabelle"), zuletzt von der KI berührte Karten und – wenn das Gehirn läuft – die Nähe der Bedeutung.
 */
export function kiRang(wunsch: string, karten: Array<{ id: string; type: string; text: string }>, zuletzt: Set<string>, naehe: Map<string, number>): Map<string, number> {
  const worte = [...new Set(wunsch.toLowerCase().split(/[^a-zäöüß0-9]+/i).filter((w) => w.length >= 4))];
  const typen = new Set(TYP_WORTE.filter(([re]) => re.test(wunsch)).map(([, t]) => t));
  const rang = new Map<string, number>();
  for (const k of karten) {
    const t = k.text.toLowerCase(); const titel = t.split('\n')[0];
    let p = 0;
    for (const w of worte) { const stamm = w.length > 6 ? w.slice(0, w.length - 2) : w; if (titel.includes(stamm)) p += 3; else if (t.includes(stamm)) p += 1; }
    if (typen.has(k.type)) p += 4;
    if (zuletzt.has(k.id)) p += 4;
    p += (naehe.get(k.id) ?? 0) * 8;
    rang.set(k.id, p);
  }
  return rang;
}
