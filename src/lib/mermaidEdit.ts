// Reine Code-Umschreiber für die WYSIWYG-Bearbeitung der Nicht-Flowchart-
// Diagramme (M100): Sequenz, Gantt, Mindmap, Kreis. Alle Funktionen geben den
// NEUEN Code zurück — oder null, wenn das Ziel nicht (mehr) gefunden wurde.
// Die Zuordnung Bild ⇄ Code läuft über die Dokument-Reihenfolge: n-tes
// SVG-Element = n-te passende Code-Zeile (per Probe für alle Typen bestätigt).

export type DiagramKind = 'flow' | 'seq' | 'gantt' | 'mind' | 'pie' | 'other';

export function diagramKind(code: string): DiagramKind {
  const head = code.trimStart();
  if (/^(flowchart|graph)\b/.test(head)) return 'flow';
  if (/^sequenceDiagram/.test(head)) return 'seq';
  if (/^gantt\b/.test(head)) return 'gantt';
  if (/^mindmap\b/.test(head)) return 'mind';
  if (/^pie\b/.test(head)) return 'pie';
  return 'other';
}

// ---------------------------------------------------------------------------
// Sequenzdiagramm
const NAME = '[A-Za-z0-9_ÄÖÜäöüß]+';
const SEQ_MSG_RE = new RegExp(`^(\\s*)(${NAME})\\s*(-{1,2}(?:>>|>|\\)|x))\\s*(${NAME})\\s*:\\s*(.*)$`);

export interface SeqMsg { line: number; from: string; to: string; arrow: string; text: string }

export function seqMessages(code: string): SeqMsg[] {
  const out: SeqMsg[] = [];
  code.split('\n').forEach((l, i) => {
    const m = SEQ_MSG_RE.exec(l);
    if (m) out.push({ line: i, from: m[2], to: m[4], arrow: m[3], text: m[5] });
  });
  return out;
}

/** Alle Akteure in Auftritts-Reihenfolge (participant-Zeilen + Nachrichten) */
export function seqActors(code: string): string[] {
  const seen: string[] = [];
  const add = (n: string) => { if (!seen.includes(n)) seen.push(n); };
  for (const l of code.split('\n')) {
    const p = new RegExp(`^\\s*(?:participant|actor)\\s+(${NAME})`).exec(l);
    if (p) add(p[1]);
    const m = SEQ_MSG_RE.exec(l);
    if (m) { add(m[2]); add(m[4]); }
  }
  return seen;
}

export function setSeqMsg(code: string, idx: number, patch: { text?: string; arrow?: string }): string | null {
  const msg = seqMessages(code)[idx];
  if (!msg) return null;
  const lines = code.split('\n');
  const m = SEQ_MSG_RE.exec(lines[msg.line])!;
  lines[msg.line] = `${m[1]}${m[2]}${patch.arrow ?? m[3]}${m[4]}: ${patch.text ?? m[5]}`;
  return lines.join('\n');
}

export function removeSeqMsg(code: string, idx: number): string | null {
  const msg = seqMessages(code)[idx];
  if (!msg) return null;
  const lines = code.split('\n');
  lines.splice(msg.line, 1);
  return lines.join('\n');
}

/** Nachricht anfügen — nach der ausgewählten (gleiche Richtung zurück) oder
 *  ans Ende zwischen den ersten beiden Akteuren */
export function addSeqMsg(code: string, afterIdx: number | null): string {
  const msgs = seqMessages(code);
  const lines = code.split('\n');
  const ref = afterIdx != null ? msgs[afterIdx] : msgs[msgs.length - 1];
  const actors = seqActors(code);
  const from = ref ? ref.to : (actors[0] ?? 'A');
  const to = ref ? ref.from : (actors[1] ?? 'B');
  const line = `  ${from}->>${to}: Nachricht`;
  const at = ref ? ref.line + 1 : lines.length;
  lines.splice(at, 0, line);
  return lines.join('\n');
}

/** Neue Person: participant-Zeile direkt nach dem Kopf */
export function addSeqActor(code: string): string {
  const lines = code.split('\n');
  const used = seqActors(code);
  let n = used.length + 1;
  while (used.includes(`Person${n}`)) n += 1;
  lines.splice(1, 0, `  participant Person${n}`);
  return lines.join('\n');
}

const idSafe = (s: string) => s.replace(/[^\p{L}\p{N}_]/gu, '_');

/** Akteur überall umbenennen (participant-Zeilen + Nachrichten-Endpunkte) */
export function renameSeqActor(code: string, oldName: string, next: string): string {
  const safe = idSafe(next.trim()) || oldName;
  return code.split('\n').map((l) => {
    const p = new RegExp(`^(\\s*(?:participant|actor)\\s+)(${NAME})(.*)$`).exec(l);
    if (p && p[2] === oldName) return `${p[1]}${safe}${p[3]}`;
    const m = SEQ_MSG_RE.exec(l);
    if (m && (m[2] === oldName || m[4] === oldName)) {
      return `${m[1]}${m[2] === oldName ? safe : m[2]}${m[3]}${m[4] === oldName ? safe : m[4]}: ${m[5]}`;
    }
    return l;
  }).join('\n');
}

export function removeSeqActor(code: string, name: string): string {
  return code.split('\n').filter((l, i) => {
    if (i === 0) return true;
    const p = new RegExp(`^\\s*(?:participant|actor)\\s+(${NAME})`).exec(l);
    if (p && p[1] === name) return false;
    const m = SEQ_MSG_RE.exec(l);
    if (m && (m[2] === name || m[4] === name)) return false;
    if (new RegExp(`^\\s*Note\\b.*\\b${name}\\b`, 'i').test(l)) return false;
    return true;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Gantt
const GANTT_META = /^\s*(title|dateFormat|axisFormat|excludes|includes|todayMarker|tickInterval|weekday|section)\b/i;
const GANTT_TASK_RE = /^(\s*)([^:\n]+?)\s*:\s*(.+)$/;

export interface GanttTask { line: number; name: string; meta: string }

export function ganttTasks(code: string): GanttTask[] {
  const out: GanttTask[] = [];
  code.split('\n').forEach((l, i) => {
    if (i === 0 || GANTT_META.test(l)) return;
    const m = GANTT_TASK_RE.exec(l);
    if (m) out.push({ line: i, name: m[2], meta: m[3] });
  });
  return out;
}

export function renameGanttTask(code: string, idx: number, name: string): string | null {
  const t = ganttTasks(code)[idx];
  if (!t) return null;
  const lines = code.split('\n');
  const m = GANTT_TASK_RE.exec(lines[t.line])!;
  lines[t.line] = `${m[1]}${name.replace(/[:#\n]/g, ' ').trim()} :${m[3]}`;
  return lines.join('\n');
}

/** Dauer ±Tage (nur wenn die Aufgabe mit „<n>d" endet) */
export function shiftGanttTask(code: string, idx: number, deltaDays: number): string | null {
  const t = ganttTasks(code)[idx];
  if (!t) return null;
  const m = /(\d+)\s*d\s*$/.exec(t.meta);
  if (!m) return null;
  const next = Math.max(1, parseInt(m[1], 10) + deltaDays);
  const lines = code.split('\n');
  lines[t.line] = lines[t.line].replace(/(\d+)\s*d\s*$/, `${next}d`);
  return lines.join('\n');
}

export function removeGanttTask(code: string, idx: number): string | null {
  const t = ganttTasks(code)[idx];
  if (!t) return null;
  const lines = code.split('\n');
  lines.splice(t.line, 1);
  return lines.join('\n');
}

/** Neue Aufgabe nach der ausgewählten (bzw. am Ende) — ohne Startdatum
 *  beginnt sie in mermaid automatisch nach der vorherigen Aufgabe */
export function addGanttTask(code: string, afterIdx: number | null): string {
  const tasks = ganttTasks(code);
  const ref = afterIdx != null ? tasks[afterIdx] : tasks[tasks.length - 1];
  const lines = code.split('\n');
  lines.splice(ref ? ref.line + 1 : lines.length, 0, '  Neue Aufgabe :3d');
  return lines.join('\n');
}

export function addGanttSection(code: string): string {
  return `${code.trimEnd()}\n  section Neuer Abschnitt\n  Neue Aufgabe :3d`;
}

// ---------------------------------------------------------------------------
// Mindmap (Einrückung = Hierarchie)
/** Zeilennummern aller Inhalts-Zeilen (Reihenfolge = SVG-Knoten-Reihenfolge) */
export function mindLines(code: string): number[] {
  const out: number[] = [];
  code.split('\n').forEach((l, i) => { if (i > 0 && l.trim()) out.push(i); });
  return out;
}

const MIND_WRAP_RE = /^([A-Za-z0-9_]*)(\(\(|\{\{|\[|\()(.*)(\)\)|\}\}|\]|\))$/;

/** Reiner Text eines Mindmap-Knotens (Formklammern abgestreift) */
export function mindText(code: string, line: number): string {
  const content = (code.split('\n')[line] ?? '').trim();
  const w = MIND_WRAP_RE.exec(content);
  return (w ? w[3] : content).trim();
}

export function renameMind(code: string, line: number, text: string): string | null {
  const lines = code.split('\n');
  if (!lines[line]?.trim()) return null;
  const indent = /^(\s*)/.exec(lines[line])![1];
  const content = lines[line].trim();
  const w = MIND_WRAP_RE.exec(content);
  const clean = text.replace(/[()[\]{}\n]/g, ' ').trim();
  lines[line] = w ? `${indent}${w[1]}${w[2]}${clean}${w[4]}` : `${indent}${clean}`;
  return lines.join('\n');
}

/** Unterpunkt anfügen: ans Ende des Teilbaums der Zeile, eine Ebene tiefer */
export function addMindChild(code: string, line: number | null): string {
  const lines = code.split('\n');
  const all = mindLines(code);
  const target = line ?? all[0];
  if (target == null) return `${code.trimEnd()}\n  Neuer Punkt`;
  const indent = /^(\s*)/.exec(lines[target])![1].length;
  let end = target + 1;
  while (end < lines.length && (!lines[end].trim() || (/^(\s*)/.exec(lines[end])![1].length > indent))) end += 1;
  lines.splice(end, 0, `${' '.repeat(indent + 2)}Neuer Punkt`);
  return lines.join('\n');
}

/** Knoten samt Teilbaum entfernen — die Wurzel bleibt geschützt */
export function removeMind(code: string, line: number): string | null {
  const all = mindLines(code);
  if (line === all[0]) return null; // Wurzel nicht löschbar
  const lines = code.split('\n');
  if (!lines[line]?.trim()) return null;
  const indent = /^(\s*)/.exec(lines[line])![1].length;
  let end = line + 1;
  while (end < lines.length && (!lines[end].trim() || (/^(\s*)/.exec(lines[end])![1].length > indent))) end += 1;
  lines.splice(line, end - line);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Kreis (pie) — Zuordnung über die Legenden-Reihenfolge (= Code-Reihenfolge)
const PIE_RE = /^(\s*)"(.*)"\s*:\s*([\d.]+)\s*$/;

export interface PieSlice { line: number; label: string; value: number }

export function pieSlices(code: string): PieSlice[] {
  const out: PieSlice[] = [];
  code.split('\n').forEach((l, i) => {
    const m = PIE_RE.exec(l);
    if (m) out.push({ line: i, label: m[2], value: parseFloat(m[3]) });
  });
  return out;
}

export function renamePie(code: string, idx: number, label: string): string | null {
  const s = pieSlices(code)[idx];
  if (!s) return null;
  const lines = code.split('\n');
  lines[s.line] = lines[s.line].replace(PIE_RE, (_m, pre, _l, v) => `${pre}"${label.replace(/"/g, "'").trim()}" : ${v}`);
  return lines.join('\n');
}

export function shiftPie(code: string, idx: number, delta: number): string | null {
  const s = pieSlices(code)[idx];
  if (!s) return null;
  const lines = code.split('\n');
  lines[s.line] = lines[s.line].replace(PIE_RE, (_m, pre, l, v) => `${pre}"${l}" : ${Math.max(1, parseFloat(v) + delta)}`);
  return lines.join('\n');
}

export function removePie(code: string, idx: number): string | null {
  const s = pieSlices(code)[idx];
  if (!s) return null;
  const lines = code.split('\n');
  lines.splice(s.line, 1);
  return lines.join('\n');
}

export function addPie(code: string): string {
  return `${code.trimEnd()}\n  "Neues Segment" : 10`;
}
