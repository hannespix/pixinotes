// Reine Code-Umschreiber für die WYSIWYG-Bearbeitung der Nicht-Flowchart-
// Diagramme (M100): Sequenz, Gantt, Mindmap, Kreis. Alle Funktionen geben den
// NEUEN Code zurück — oder null, wenn das Ziel nicht (mehr) gefunden wurde.
// Die Zuordnung Bild ⇄ Code läuft über die Dokument-Reihenfolge: n-tes
// SVG-Element = n-te passende Code-Zeile (per Probe für alle Typen bestätigt).

export type DiagramKind = 'flow' | 'seq' | 'gantt' | 'mind' | 'pie' | 'state' | 'timeline' | 'quadrant' | 'other';

export function diagramKind(code: string): DiagramKind {
  const head = code.trimStart();
  if (/^(flowchart|graph)\b/.test(head)) return 'flow';
  if (/^sequenceDiagram/.test(head)) return 'seq';
  if (/^gantt\b/.test(head)) return 'gantt';
  if (/^mindmap\b/.test(head)) return 'mind';
  if (/^pie\b/.test(head)) return 'pie';
  if (/^stateDiagram/.test(head)) return 'state';
  if (/^timeline\b/.test(head)) return 'timeline';
  if (/^quadrantChart\b/.test(head)) return 'quadrant';
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

// ---------------------------------------------------------------------------
// Status (stateDiagram-v2) — Kanten-Pfade heißen „…-edge<N>" in Zeilen-Reihenfolge
const ST_TRANS_RE = /^(\s*)(\S+)\s*-->\s*([^:\n]+?)\s*(?::\s*(.*))?$/;

export interface StateTrans { line: number; from: string; to: string; label: string }

export function stateTransitions(code: string): StateTrans[] {
  const out: StateTrans[] = [];
  code.split('\n').forEach((l, i) => {
    const m = ST_TRANS_RE.exec(l);
    if (m) out.push({ line: i, from: m[2], to: m[3].trim(), label: m[4] ?? '' });
  });
  return out;
}

export function setStateTransLabel(code: string, idx: number, label: string): string | null {
  const t = stateTransitions(code)[idx];
  if (!t) return null;
  const lines = code.split('\n');
  const m = ST_TRANS_RE.exec(lines[t.line])!;
  // ';' beendet in stateDiagram das Statement — Resttext würde zu
  // Phantom-Zuständen (Review-Befund M101)
  lines[t.line] = `${m[1]}${m[2]} --> ${m[3].trim()}${label.trim() ? ` : ${label.replace(/[:;\n]/g, ' ').trim()}` : ''}`;
  return lines.join('\n');
}

/** Unicode-sichere Wortgrenze: \b ist in JS ASCII-basiert und versagt bei
 *  Namen, die mit Umlaut/ß beginnen oder enden (Review-Befund M101) */
const uniWord = (name: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'gu');

/** Schlüsselwörter, die als Zustandsname die Grammatik kapern würden */
const STATE_RESERVED = new Set(['state', 'note', 'end', 'direction', 'as']);

export function removeStateTrans(code: string, idx: number): string | null {
  const t = stateTransitions(code)[idx];
  if (!t) return null;
  const lines = code.split('\n');
  lines.splice(t.line, 1);
  return lines.join('\n');
}

/** Zustand überall umbenennen (Übergänge + state-Zeilen, nicht in Labels) */
export function renameState(code: string, oldName: string, next: string): string {
  let safe = next.trim().replace(/[^\p{L}\p{N}_]/gu, '_') || oldName;
  // Reservierte Wörter würden Übergänge stillschweigend schlucken (Review M101)
  if (STATE_RESERVED.has(safe.toLowerCase())) safe = `${safe}_`;
  return code.split('\n').map((l, i) => {
    if (i === 0) return l;
    const m = ST_TRANS_RE.exec(l);
    if (m) {
      const from = m[2] === oldName ? safe : m[2];
      const to = m[3].trim() === oldName ? safe : m[3].trim();
      if (from !== m[2] || to !== m[3].trim()) return `${m[1]}${from} --> ${to}${m[4] ? ` : ${m[4]}` : ''}`;
      return l;
    }
    return l.replace(uniWord(oldName), safe);
  }).join('\n');
}

/** Zustand entfernen: Übergänge, Deklarationen (auch `state "…" as X`),
 *  Beschreibungszeilen `X : …` und komplette Composite-Blöcke `state X { … }` */
export function removeState(code: string, name: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bareRe = new RegExp(`^\\s*(?:state\\s+)?${esc}(?![\\p{L}\\p{N}_])\\s*(\\{)?\\s*$`, 'u');
  const aliasRe = new RegExp(`^\\s*state\\s+"[^"\\n]*"\\s+as\\s+${esc}(?![\\p{L}\\p{N}_])\\s*(\\{)?\\s*$`, 'u');
  const descRe = new RegExp(`^\\s*${esc}(?![\\p{L}\\p{N}_])\\s*:`, 'u');
  const lines = code.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i === 0) { out.push(lines[i]); continue; }
    const l = lines[i];
    const m = ST_TRANS_RE.exec(l);
    if (m && (m[2] === name || m[3].trim() === name)) continue;
    const decl = bareRe.exec(l) ?? aliasRe.exec(l);
    if (decl) {
      // Composite-Block samt Rumpf und schließender „}" überspringen —
      // sonst bleibt eine verwaiste Klammer zurück (Parse-Fehler, M101)
      if (decl[1] === '{') {
        let depth = 1;
        while (i + 1 < lines.length && depth > 0) {
          i += 1;
          depth += (lines[i].match(/\{/g) ?? []).length;
          depth -= (lines[i].match(/\}/g) ?? []).length;
        }
      }
      continue;
    }
    if (descRe.test(l)) continue;
    out.push(l);
  }
  return out.join('\n');
}

export function addState(code: string): string {
  let n = 1;
  while (new RegExp(`\\bZustand_${n}\\b`).test(code)) n += 1;
  return `${code.trimEnd()}\n  Zustand_${n}`;
}

// ---------------------------------------------------------------------------
// Zeitstrahl (timeline) — g.timeline-node in Dokument-Reihenfolge entspricht
// der Token-Reihenfolge: je Zeile erst die Periode, dann ihre Ereignisse
const TL_META = /^\s*(timeline|title|section)\b/;

export interface TlToken { line: number; part: number; text: string; isPeriod: boolean }

export function timelineTokens(code: string): TlToken[] {
  const out: TlToken[] = [];
  code.split('\n').forEach((l, i) => {
    if (i === 0 || !l.trim() || TL_META.test(l)) return;
    l.split(':').forEach((p, j) => {
      if (p.trim()) out.push({ line: i, part: j, text: p.trim(), isPeriod: j === 0 });
    });
  });
  return out;
}

export function renameTimelineToken(code: string, idx: number, text: string): string | null {
  const t = timelineTokens(code)[idx];
  if (!t) return null;
  const lines = code.split('\n');
  const parts = lines[t.line].split(':');
  const indent = /^(\s*)/.exec(parts[0])![1];
  parts[t.part] = `${t.part === 0 ? indent : ' '}${text.replace(/[:\n]/g, ' ').trim()}${t.part < parts.length - 1 ? ' ' : ''}`;
  lines[t.line] = parts.join(':');
  return lines.join('\n');
}

/** Ereignis entfernen — eine Periode nimmt ihre ganze Zeile mit */
export function removeTimelineToken(code: string, idx: number): string | null {
  const t = timelineTokens(code)[idx];
  if (!t) return null;
  const lines = code.split('\n');
  if (t.isPeriod) {
    // Auch Fortsetzungszeilen („: Ereignis") mitnehmen — verwaist wären sie
    // ein harter mermaid-Parse-Fehler (Review-Befund M101)
    let count = 1;
    while (t.line + count < lines.length && /^\s*:/.test(lines[t.line + count])) count += 1;
    lines.splice(t.line, count);
  } else {
    const parts = lines[t.line].split(':');
    parts.splice(t.part, 1);
    lines[t.line] = parts.join(':');
  }
  return lines.join('\n');
}

export function addTimelineEvent(code: string, idx: number | null): string {
  const toks = timelineTokens(code);
  const t = idx != null ? toks[idx] : toks[toks.length - 1];
  if (!t) return `${code.trimEnd()}\n  Neue Periode : Neues Ereignis`;
  const lines = code.split('\n');
  lines[t.line] = `${lines[t.line].trimEnd()} : Neues Ereignis`;
  return lines.join('\n');
}

export function addTimelinePeriod(code: string): string {
  return `${code.trimEnd()}\n  Neue Periode : Neues Ereignis`;
}

// ---------------------------------------------------------------------------
// Quadrant — Punkt-Reihenfolge im SVG ist SORTIERT, deshalb Zuordnung über
// den Beschriftungstext; Quadranten-/Achsen-Beschriftungen über ihre Zeilen
const QUAD_POINT_RE = /^(\s*)"(.*)"\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]\s*$/;

export interface QuadPoint { line: number; label: string; x: number; y: number }

export function quadrantPoints(code: string): QuadPoint[] {
  const out: QuadPoint[] = [];
  code.split('\n').forEach((l, i) => {
    const m = QUAD_POINT_RE.exec(l);
    if (m) out.push({ line: i, label: m[2], x: parseFloat(m[3]), y: parseFloat(m[4]) });
  });
  return out;
}

export function renameQuadrantPoint(code: string, label: string, next: string): string | null {
  const p = quadrantPoints(code).find((q) => q.label === label);
  if (!p) return null;
  // Punkte werden über ihr Label identifiziert — Duplikate wären danach
  // per Klick nicht mehr unterscheidbar (Review-Befund M101)
  const others = quadrantPoints(code).filter((q) => q.line !== p.line).map((q) => q.label);
  const base = next.replace(/"/g, "'").trim();
  let clean = base;
  for (let n = 2; others.includes(clean); n += 1) clean = `${base} ${n}`;
  const lines = code.split('\n');
  lines[p.line] = lines[p.line].replace(QUAD_POINT_RE, (_m, pre, _l, x, y) => `${pre}"${clean}": [${x}, ${y}]`);
  return lines.join('\n');
}

export function nudgeQuadrantPoint(code: string, label: string, dx: number, dy: number): string | null {
  const p = quadrantPoints(code).find((q) => q.label === label);
  if (!p) return null;
  const cl = (v: number) => Math.min(1, Math.max(0, Math.round(v * 100) / 100));
  const lines = code.split('\n');
  lines[p.line] = lines[p.line].replace(QUAD_POINT_RE, (_m, pre, l) => `${pre}"${l}": [${cl(p.x + dx)}, ${cl(p.y + dy)}]`);
  return lines.join('\n');
}

export function removeQuadrantPoint(code: string, label: string): string | null {
  const p = quadrantPoints(code).find((q) => q.label === label);
  if (!p) return null;
  const lines = code.split('\n');
  lines.splice(p.line, 1);
  return lines.join('\n');
}

export function addQuadrantPoint(code: string): string {
  const labels = new Set(quadrantPoints(code).map((p) => p.label));
  let label = 'Neuer Punkt';
  for (let n = 2; labels.has(label); n += 1) label = `Neuer Punkt ${n}`;
  return `${code.trimEnd()}\n  "${label}": [0.5, 0.5]`;
}

export function quadrantLabels(code: string): string[] {
  const out = ['', '', '', ''];
  code.split('\n').forEach((l) => {
    const m = /^\s*quadrant-([1-4])\s+"?(.*?)"?\s*$/.exec(l);
    if (m) out[parseInt(m[1], 10) - 1] = m[2];
  });
  return out;
}

export function setQuadrantLabel(code: string, n: number, text: string): string | null {
  const re = new RegExp(`^(\\s*quadrant-${n}\\s+).*$`, 'm');
  if (!re.test(code)) return null;
  // Callback statt Ersetzungs-String: $-Zeichen im Nutzertext würden sonst
  // als Replacement-Muster expandiert (Review-Befund M101)
  const clean = text.replace(/"/g, "'").trim();
  return code.replace(re, (_m, pre) => `${pre}"${clean}"`);
}

/** Achsen-Zeile: zeilengebunden ([^"\n]) und mit optionaler rechter Seite —
 *  einseitige Achsen (`x-axis "Nur links"`) sind gültige mermaid-Syntax
 *  und dürfen nicht zu `"" --> …` kaputtgeschrieben werden (Review M101) */
const axisRe = (axis: string) =>
  new RegExp(`^(\\s*${axis}-axis\\s+)(?:"([^"\\n]*)"|([^"\\n]+?))(?:\\s*-->\\s*(?:"([^"\\n]*)"|([^"\\n]+?)))?\\s*$`, 'm');

export function axisLabels(code: string): { x: [string, string]; y: [string, string] } {
  const get = (axis: string): [string, string] => {
    const m = axisRe(axis).exec(code);
    return m ? [(m[2] ?? m[3] ?? '').trim(), (m[4] ?? m[5] ?? '').trim()] : ['', ''];
  };
  return { x: get('x'), y: get('y') };
}

export function setAxisLabel(code: string, axis: 'x' | 'y', side: 0 | 1, text: string): string | null {
  const m = axisRe(axis).exec(code);
  if (!m) return null;
  const next: [string, string] = [(m[2] ?? m[3] ?? '').trim(), (m[4] ?? m[5] ?? '').trim()];
  next[side] = text.replace(/"/g, "'").trim();
  const left = next[0] || ' ';
  const right = next[1] ? ` --> "${next[1]}"` : '';
  return code.replace(axisRe(axis), (_a, pre) => `${pre}"${left}"${right}`);
}

// ---------------------------------------------------------------------------
// Titel (gantt, pie, timeline, quadrant) + Gantt-Abschnitte/-Status + Sequenz-Extras
export function getTitle(code: string): string {
  const m = /^\s*title\s+(.*)$/m.exec(code);
  return m ? m[1].trim() : '';
}

export function setTitle(code: string, text: string): string {
  const clean = text.replace(/\n/g, ' ').trim();
  if (/^\s*title\s+/m.test(code)) {
    if (!clean) return code.split('\n').filter((l) => !/^\s*title\s+/.test(l)).join('\n');
    // Callback: $-Zeichen im Titel dürfen nicht expandieren (Review M101)
    return code.replace(/^(\s*title\s+).*$/m, (_m, pre) => `${pre}${clean}`);
  }
  if (!clean) return code;
  const lines = code.split('\n');
  lines.splice(1, 0, `  title ${clean}`);
  return lines.join('\n');
}

export function ganttSections(code: string): Array<{ line: number; name: string }> {
  const out: Array<{ line: number; name: string }> = [];
  code.split('\n').forEach((l, i) => {
    const m = /^\s*section\s+(.*)$/.exec(l);
    if (m) out.push({ line: i, name: m[1].trim() });
  });
  return out;
}

export function renameGanttSection(code: string, idx: number, name: string): string | null {
  const s = ganttSections(code)[idx];
  if (!s) return null;
  const lines = code.split('\n');
  const clean = name.replace(/[:\n]/g, ' ').trim();
  lines[s.line] = lines[s.line].replace(/^(\s*section\s+).*$/, (_m, pre) => `${pre}${clean}`);
  return lines.join('\n');
}

export const GANTT_FLAGS = ['done', 'active', 'crit', 'milestone'] as const;

/** Status-Markierung einer Aufgabe umschalten (done/active/crit/milestone) */
export function toggleGanttFlag(code: string, idx: number, flag: (typeof GANTT_FLAGS)[number]): string | null {
  const t = ganttTasks(code)[idx];
  if (!t) return null;
  const parts = t.meta.split(',').map((p) => p.trim()).filter(Boolean);
  let flags = parts.filter((p) => (GANTT_FLAGS as readonly string[]).includes(p));
  const rest = parts.filter((p) => !(GANTT_FLAGS as readonly string[]).includes(p));
  flags = flags.includes(flag) ? flags.filter((f) => f !== flag) : [...flags, flag];
  const lines = code.split('\n');
  const m = GANTT_TASK_RE.exec(lines[t.line])!;
  lines[t.line] = `${m[1]}${m[2]} :${[...flags, ...rest].join(', ')}`;
  return lines.join('\n');
}

/** Aktive Status-Markierungen einer Aufgabe */
export function ganttFlags(code: string, idx: number): string[] {
  const t = ganttTasks(code)[idx];
  if (!t) return [];
  return t.meta.split(',').map((p) => p.trim()).filter((p) => (GANTT_FLAGS as readonly string[]).includes(p));
}

/** Sequenz: fortlaufende Nummerierung an/aus (autonumber) */
export function toggleAutonumber(code: string): string {
  if (/^\s*autonumber\s*$/m.test(code)) {
    return code.split('\n').filter((l) => !/^\s*autonumber\s*$/.test(l)).join('\n');
  }
  const lines = code.split('\n');
  lines.splice(1, 0, '  autonumber');
  return lines.join('\n');
}

export function hasAutonumber(code: string): boolean {
  return /^\s*autonumber\s*$/m.test(code);
}

/** Notiz nach einer Nachricht einfügen (Note over Von,Nach) */
export function addSeqNote(code: string, msgIdx: number | null): string {
  const msgs = seqMessages(code);
  const m = msgIdx != null ? msgs[msgIdx] : msgs[msgs.length - 1];
  const lines = code.split('\n');
  const line = m ? `  Note over ${m.from},${m.to}: Notiz` : '  Note over A: Notiz';
  lines.splice(m ? m.line + 1 : lines.length, 0, line);
  return lines.join('\n');
}
