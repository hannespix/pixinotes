// M443: Der Operationsplan der KI – ausgeführt auf dem Board. Aus kiAnweisung.ts herausgelöst, damit ihn auch der
// MCP-Server (mcp/, ohne Browser) nutzen kann: dieselben Operationen, dieselbe Prüfung, dieselben Module.
import { makeFrame, makeGantt, makeMermaid, makeNote, makeShape, makeWeek } from './nodes';
import { uid, type AppNode, type ShapeKind, type StickyColor } from '../types';
import type { useBoard } from '../store';
import type { KiOp } from './kiModule';

export interface AiOp {
  op: string;
  id?: string;
  ids?: string[];
  title?: string;
  text?: string;
  color?: string;
  code?: string;
  shape?: string;
  source?: string;
  target?: string;
  label?: string;
  /** M131: id einer bestehenden Karte, aus der dieses neue Modul abgeleitet
   *  ist — die App zieht dann automatisch einen Pfeil Quelle → neues Modul */
  from?: string;
  items?: Array<{ text?: string; due?: string }>;
  rows?: Array<{ name?: string; start?: string; end?: string; who?: string }>;
  /** M165: Wochenplan-Blöcke (day 0 = Montag, start/dur in Minuten) */
  days?: number;
  entries?: Array<{ day?: number; start?: number; dur?: number; text?: string; who?: string }>;
  /** M165: Rahmen — Name + ids der Karten, um die er gelegt wird */
  name?: string;
  around?: string[];
  /** M410: Felder der Modul-Operationen (lib/kiModule.ts) */
  [feld: string]: unknown;
}

export const STICKY = new Set(['yellow', 'pink', 'mint', 'sky', 'white']);
export const SHAPES = new Set(['process', 'decision', 'terminator']);

/** Die Grund-Operationen (Notiz, Kanban, Zeitplan, Diagramm, Form, Wochenplan, Zeiterfassung, Rahmen, Bearbeiten, Pfeil,
 *  Löschen) – so stehen sie im Auftrag an das Modell. Die Modul-Operationen beschreibt kiModule.kiOpsText. */
export const GRUND_OPS = `{"op":"note","title":"...","text":"Markdown: '## ' Überschriften, **fett**, '- ' Punkte, '- [ ] ' Checklisten","color":"yellow|pink|mint|sky|white","from":"<optional: id der Quell-Karte>"}
{"op":"kanban","title":"...","items":[{"text":"...","due":"yyyy-mm-dd"}],"from":"<optional>"}
{"op":"gantt","title":"...","rows":[{"name":"...","start":"yyyy-mm-dd","end":"yyyy-mm-dd","who":"Name"}],"from":"<optional>"}
{"op":"mermaid","code":"flowchart TD\\n  A[Start] --> B[Ende]","from":"<optional>"}
{"op":"shape","shape":"process|decision|terminator","text":"...","from":"<optional>"}
{"op":"week","title":"...","days":5|7,"entries":[{"day":0,"start":540,"dur":90,"text":"...","who":"optional"}],"from":"<optional>"} (Stunden-/Wochen-/Dienstplan: day 0=Montag … 6=Sonntag, start/dur in MINUTEN seit Mitternacht)
{"op":"time","title":"...","from":"<optional>"} (Arbeitszeiterfassungs-Karte mit Start/Stop)
{"op":"frame","name":"...","around":["<id>","<id>"]} (benannter Rahmen-Bereich UM die genannten vorhandenen Karten – gruppiert sie)
{"op":"edit_note","id":"<existierende Notiz-id>","text":"KOMPLETTER neuer Inhalt als Markdown; erste Zeile = '## Überschrift'"}
{"op":"edit_title","id":"<id>","title":"..."} (Titel eines Moduls oder Text einer Form)
{"op":"add_tickets","id":"<Kanban-id>","items":[{"text":"...","due":"yyyy-mm-dd"}]}
{"op":"edge","source":"<id>","target":"<id>","label":"kurzes Label"}
{"op":"delete","ids":["<id>"]} (NUR wenn der Nutzer ausdrücklich löschen will)`;

export interface PlanErgebnis { done: number; editedNote: boolean; antworten: string[] }
export type KiModul = typeof import('./kiModule');

/** Einen validierten Operationsplan ausführen — synchron, innerhalb von mutedHistory */
export function planAusfuehren(
  plan: AiOp[],
  preBlocks: Map<AiOp, unknown[]>,
  known: Map<string, AppNode>,
  st: ReturnType<typeof useBoard.getState>,
  place: (h: number) => { x: number; y: number },
  modul?: { km: KiModul; bloecke: Map<KiOp, unknown[][]> },
): PlanErgebnis {
  let done = 0;
  let editedNote = false;
  const antworten: string[] = [];
  // M131: „from" an Erzeugungs-Ops → Pfeil von der Quell-Karte zum neuen Modul
  const linkFrom = (o: AiOp, newId: string) => {
    if (o.from && known.has(o.from)) st.addLabeledEdge(o.from, newId, '');
  };
    for (const o of plan) {
      /* M410: Erst die Module fragen (lib/kiModule.ts) – sie kennen ihre eigenen Operationen: Tabelle füllen,
         Ticket verschieben, Sitzung anlegen … Was dort nicht hingehört, übernehmen die Grund-Operationen unten. */
      if (modul) {
        const r = modul.km.kiAusfuehren(o as KiOp, {
          known, st, place, bloecke: modul.bloecke,
          linkFrom: (op, neu) => linkFrom(op as AiOp, neu),
          notizGeaendert: () => { editedNote = true; },
          antwort: (t) => antworten.push(t),
        });
        if (r !== undefined) { if (r) done++; continue; }
      }
      switch (o.op) {
        case 'note': {
          const blocks = preBlocks.get(o);
          if (!blocks || blocks.length === 0) break;
          const color = STICKY.has(o.color ?? '') ? (o.color as StickyColor) : undefined;
          const node = makeNote(place(180), { color, blocks: blocks as never[] });
          st.addNode(node);
          linkFrom(o, node.id);
          done++;
          break;
        }
        case 'gantt': {
          const iso = /^\d{4}-\d{2}-\d{2}$/;
          const rows = (o.rows ?? [])
            .filter((r) => r.name?.trim() && iso.test(r.start ?? '') && iso.test(r.end ?? ''))
            .slice(0, 20)
            .map((r) => ({
              id: uid(), name: r.name!.trim().slice(0, 80),
              start: r.start!, end: r.end! >= r.start! ? r.end! : r.start!,
              who: r.who?.trim().slice(0, 40) || undefined,
            }));
          if (rows.length === 0) break;
          const node = makeGantt(place(240));
          (node.data as { title: string; rows: unknown[] }).title = (o.title ?? 'Zeitplan').slice(0, 60);
          (node.data as { rows: unknown[] }).rows = rows;
          st.addNode(node);
          linkFrom(o, node.id);
          done++;
          break;
        }
        case 'mermaid': {
          const code = (o.code ?? '').replace(/```(mermaid)?/g, '').trim();
          if (!code) break;
          const node = makeMermaid(place(260));
          (node.data as { code: string; fitOnLoad?: boolean }).code = code;
          (node.data as { fitOnLoad?: boolean }).fitOnLoad = true; // Karte ans Diagramm anpassen (M122)
          st.addNode(node);
          linkFrom(o, node.id);
          done++;
          break;
        }
        case 'shape': {
          const node = makeShape(place(90), SHAPES.has(o.shape ?? '') ? (o.shape as ShapeKind) : 'process');
          (node.data as { text: string }).text = (o.text ?? '').slice(0, 60);
          st.addNode(node);
          linkFrom(o, node.id);
          done++;
          break;
        }
        case 'week': {
          // Wochen-/Stundenplan (M165): Blöcke validieren, Zeitfenster ableiten
          const days = o.days === 7 ? 7 : 5;
          const entries = (o.entries ?? [])
            .filter((e) => e.text?.trim()
              && Number.isFinite(e.day) && e.day! >= 0 && e.day! < days
              && Number.isFinite(e.start) && e.start! >= 0 && e.start! < 1440)
            .slice(0, 40)
            .map((e) => ({
              id: uid(), day: e.day!, start: Math.round(e.start! / 30) * 30,
              dur: Math.min(720, Math.max(30, Math.round((e.dur ?? 60) / 30) * 30)),
              text: e.text!.trim().slice(0, 80),
              who: e.who?.trim().slice(0, 30) || undefined,
            }));
          const node = makeWeek(place(440));
          const minStart = Math.min(8 * 60, ...entries.map((e) => e.start));
          const maxEnd = Math.max(17 * 60, ...entries.map((e) => e.start + e.dur));
          Object.assign(node.data, {
            title: (o.title ?? 'Wochenplan').slice(0, 60),
            days,
            from: Math.max(0, Math.floor(minStart / 60) * 60),
            to: Math.min(24 * 60, Math.ceil(maxEnd / 60) * 60),
            entries,
          });
          st.addNode(node);
          linkFrom(o, node.id);
          done++;
          break;
        }
        case 'frame': {
          // Rahmen UM vorhandene Karten legen (M165) — Bounding-Box + Luft
          const members = (o.around ?? []).map((mid) => known.get(mid)).filter((n): n is AppNode => !!n && n.type !== 'frame');
          if (members.length === 0) break;
          const sx = Math.min(...members.map((n) => n.position.x));
          const sy = Math.min(...members.map((n) => n.position.y));
          const ex = Math.max(...members.map((n) => n.position.x + (n.width ?? n.measured?.width ?? 260)));
          const ey = Math.max(...members.map((n) => n.position.y + (n.height ?? n.measured?.height ?? 160)));
          const node = makeFrame({ x: sx - 30, y: sy - 56 }, (o.name ?? o.title ?? 'Bereich').slice(0, 50));
          node.width = ex - sx + 60;
          node.height = ey - sy + 86;
          st.addNode(node);
          done++;
          break;
        }
        case 'edit_note': {
          const target = known.get(o.id ?? '');
          const blocks = preBlocks.get(o);
          if (!target || target.type !== 'note' || !blocks || blocks.length === 0) break;
          st.updateNodeData(target.id, { blocks });
          editedNote = true;
          done++;
          break;
        }
        case 'edit_title': {
          const target = known.get(o.id ?? '');
          if (!target || !o.title?.trim()) break;
          const title = o.title.trim().slice(0, 80);
          if (target.type === 'kanban' || target.type === 'gantt' || target.type === 'week' || target.type === 'time') st.updateNodeData(target.id, { title });
          else if (target.type === 'shape') st.updateNodeData(target.id, { text: title });
          else if (target.type === 'frame' || target.type === 'htmlapp') st.updateNodeData(target.id, { name: title });
          else break;
          done++;
          break;
        }
        case 'edge': {
          if (!known.has(o.source ?? '') || !known.has(o.target ?? '') || o.source === o.target) break;
          st.addLabeledEdge(o.source!, o.target!, (o.label ?? '').slice(0, 30));
          done++;
          break;
        }
        case 'delete': {
          const ids = (o.ids ?? []).filter((id) => known.has(id));
          if (ids.length === 0) break;
          st.removeNodes(ids);
          done++;
          break;
        }
        default:
          break;
      }
    }
  return { done, editedNote, antworten };
}

