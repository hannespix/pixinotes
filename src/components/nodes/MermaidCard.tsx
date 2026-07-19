import { useEffect, useRef, useState } from 'react';
import { NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import { runDerived, useBoard } from '../../store';
import type { MermaidNode } from '../../types';
import { IWand } from '../Icons';
import { aiReady } from '../../lib/ai';
import { aiMermaid, buildMermaidSource, getMermaid, LEGACY_MERMAID_DEFAULT, MERMAID_STYLES, MERMAID_TEMPLATES as TEMPLATES, preloadHandFont } from '../../lib/mermaid';
import {
  addGanttSection, addGanttTask, addMindChild, addPie, addQuadrantPoint,
  addSeqActor, addSeqMsg, addSeqNote, addState, addTimelineEvent,
  addTimelinePeriod, axisLabels, diagramKind, ganttFlags, ganttSections,
  ganttTasks, getTitle, hasAutonumber, mindLines, mindText, nudgeQuadrantPoint,
  pieSlices, quadrantLabels, quadrantPoints, removeGanttTask, removeMind,
  removePie, removeQuadrantPoint, removeSeqActor, removeSeqMsg, removeState,
  removeStateTrans, removeTimelineToken, renameGanttSection, renameGanttTask,
  renameMind, renamePie, renameQuadrantPoint, renameSeqActor, renameState,
  renameTimelineToken, seqMessages, setAxisLabel, setQuadrantLabel, setSeqMsg,
  setStateTransLabel, setTitle, shiftGanttTask, shiftPie, stateTransitions,
  timelineTokens, toggleAutonumber, toggleGanttFlag,
} from '../../lib/mermaidEdit';
import { useOutsideClose } from '../../lib/useOutsideClose';
import { CardShell } from './CardShell';

/** Auswahl in Nicht-Flowchart-Diagrammen (M100/M101): Bild-Element ⇄ Code */
type SelOther =
  | { t: 'actor'; name: string; x: number; y: number }
  | { t: 'msg'; idx: number; x: number; y: number }
  | { t: 'task'; idx: number; x: number; y: number }
  | { t: 'gsec'; idx: number; x: number; y: number }
  | { t: 'mind'; line: number; x: number; y: number }
  | { t: 'pie'; idx: number; x: number; y: number }
  | { t: 'state'; name: string; x: number; y: number }
  | { t: 'stEdge'; idx: number; x: number; y: number }
  | { t: 'tl'; idx: number; x: number; y: number }
  | { t: 'qPoint'; label: string; x: number; y: number }
  | { t: 'qLabel'; n: number; x: number; y: number }
  | { t: 'axis'; axis: 'x' | 'y'; side: 0 | 1; x: number; y: number };

/** Umbenenn-Ziel des Inline-Eingabefelds */
type RenameTarget =
  | { t: 'node'; nid: string }
  | { t: 'edge' }
  | { t: 'msg'; idx: number }
  | { t: 'actor'; name: string }
  | { t: 'task'; idx: number }
  | { t: 'gsec'; idx: number }
  | { t: 'mind'; line: number }
  | { t: 'pie'; idx: number }
  | { t: 'state'; name: string }
  | { t: 'stEdge'; idx: number }
  | { t: 'tl'; idx: number }
  | { t: 'qPoint'; label: string }
  | { t: 'qLabel'; n: number }
  | { t: 'axis'; axis: 'x' | 'y'; side: 0 | 1 }
  | { t: 'title' };

/** Form je Schritt: Symbol, Name, Klammern (Mermaid-Syntax) */
const SHAPES: Array<[string, string, string, string]> = [
  ['▭', 'Rechteck', '[', ']'],
  ['▢', 'Abgerundet', '(', ')'],
  ['◇', 'Entscheidung', '{', '}'],
  ['◯', 'Kreis', '((', '))'],
  ['⬡', 'Sechseck', '{{', '}}'],
  ['⧉', 'Unterprozess', '[[', ']]'],
];

/** Füllfarben je Schritt (mermaid `style <id> fill:…`) — bewusst kräftige
 *  Pastelltöne, die auf hellen wie getönten Flächen funktionieren */
const NODE_COLORS: Array<[string, string, string]> = [
  ['Gelb', '#ffe9a8', '#c9a227'],
  ['Blau', '#cfe3f8', '#4a7dbd'],
  ['Grün', '#d3ecd8', '#4d8f5a'],
  ['Rosa', '#f8d7de', '#c25b73'],
  ['Violett', '#e5dcf5', '#7d5bb8'],
];

/**
 * Diagramm (M91/M92, „integral"): Das Diagramm liegt RAHMENLOS direkt auf der
 * Fläche — kein Karten-Kasten, keine Kopfzeile. Alle Werkzeuge schweben als
 * Leiste unter dem Diagramm, nur solange die Karte ausgewählt ist (gleiche
 * Sprache wie die Auswahl-Toolbar oben). Flowchart-Schritte werden direkt im
 * Bild bearbeitet: umbenennen, anfügen, Form, Farbe, verbinden, entfernen.
 */
export function MermaidCard({ id, data, selected, width: nodeW, height: nodeH }: NodeProps<MermaidNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const resizeNode = useBoard((s) => s.resizeNode);
  const showToast = useBoard((s) => s.showToast);
  const ai = useBoard((s) => s.ai);
  const uiTheme = useBoard((s) => s.ui.theme); // Diagramm folgt Hell/Dunkel
  const [edit, setEdit] = useState(false);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [tplOpen, setTplOpen] = useState(false);
  const [pendingTpl, setPendingTpl] = useState<string | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);
  // Ausgewählte VERBINDUNG (M99): per Klick auf den Pfeil im Bild
  const [selEdge, setSelEdge] = useState<{ from: string; to: string; x: number; y: number } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  // Auswahl in Sequenz/Gantt/Mindmap/Kreis (M100)
  const [selOther, setSelOther] = useState<SelOther | null>(null);
  // Inline-Umbenennen: Eingabefeld schwebt direkt ÜBER dem Element im Bild —
  // kein Browser-Dialog (User-Feedback M92). target sagt, was es beschreibt.
  const [rename, setRename] = useState<{ target: RenameTarget; x: number; y: number; w: number; value: string } | null>(null);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const renderKey = useRef(0);
  const tplRef = useRef<HTMLElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(tplOpen, tplRef, () => { setTplOpen(false); setPendingTpl(null); });

  const style = (data.style as string | undefined) ?? '';
  const look = (data.look as string | undefined) ?? '';
  const kind = diagramKind(data.code);
  const isFlow = kind === 'flow';

  useEffect(() => {
    let cancelled = false;
    const myKey = ++renderKey.current;
    // Debounce, damit nicht jeder Tastendruck einen (oft ungültigen)
    // Zwischenstand rendert (Audit)
    const t = setTimeout(() => {
      getMermaid()
        // Render-ID pro VERSUCH eindeutig: mermaid räumt vor dem Rendern alle
        // Elemente mit derselben ID weg — mit stabiler ID löscht ein
        // fehlgeschlagener Versuch sonst das angezeigte SVG aus dem DOM (M90)
        .then(async (mermaid) => {
          // Handschrift-Look: Scribble-Schrift VOR dem Rendern laden (Messung!)
          if (look === 'hand') await preloadHandFont();
          return mermaid.render(`pn-mermaid-${id}-${myKey}`, buildMermaidSource(data.code, style, look));
        })
        .then(({ svg }) => { if (!cancelled && myKey === renderKey.current) { setSvg(svg); setError(''); } })
        // svg NICHT leeren — beim Tippen bleibt das letzte gültige Diagramm
        // sichtbar, der Fehler erscheint nur als kleines Overlay (M90)
        .catch((e) => { if (!cancelled && myKey === renderKey.current) setError(String(e?.message ?? e).split('\n')[0]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [data.code, id, uiTheme, style, look]);

  // Auto-Größe (M92c, „gantt viel zu klein"): Nach jedem erfolgreichen Render
  // Die dauernde Automatik aus M93 sprang bei jedem Render dazwischen und
  // fühlte sich vor allem auf Smartphones „komisch" an (User-Feedback M95).
  // Jetzt passt sich die Karte NUR auf ausdrückliche Aktion an: Vorlage
  // laden, KI-Diagramm, ‹/›-Spalte auf/zu oder der ⤢-Einpassen-Knopf.
  // Manuelles Ziehen bleibt ansonsten unangetastet.
  const fitOnRender = useRef(false);

  const fitToDiagram = (editNow: boolean = edit) => {
    const el = previewRef.current?.querySelector('svg');
    if (!el) return;
    const vb = (el as SVGSVGElement).viewBox?.baseVal;
    let natW = vb?.width ?? 0;
    let natH = vb?.height ?? 0;
    if (!natW || !natH) {
      // Fallback (falls ein Diagrammtyp keine viewBox setzt): Inhalt vermessen
      try { const bb = (el as SVGSVGElement).getBBox(); natW = bb.width; natH = bb.height; } catch { return; }
    }
    if (!natW || !natH) return;
    const PAD = 12; // Karten-Innenabstand (6 px rundum)
    // Offene Code-Spalte (‹/›) braucht eigene Breite (320 px + 8 px Lücke) —
    // sonst quetscht sie das Diagramm auf die halbe Fläche (M94)
    const EXTRA = editNow ? 328 : 0;
    // Smartphone-Clamp (M95): Karte nie größer, als der Bildschirm hergibt
    const MAXW = Math.min(1100, Math.max(280, window.innerWidth - 48));
    const MAXH = Math.min(720, Math.max(200, window.innerHeight - 200));
    // SVG skaliert proportional zur Kartenbreite — bei Überbreite/-höhe
    // gemeinsam herunterskalieren, damit alles ohne Scrollen sichtbar bleibt
    const scale = Math.min(1, (MAXW - EXTRA) / natW, MAXH / natH);
    const w = Math.max(240, Math.round(natW * scale) + PAD + EXTRA);
    const h = Math.max(120, Math.round(natH * scale) + PAD);
    if (Math.abs((nodeW ?? 0) - w) < 12 && Math.abs((nodeH ?? 0) - h) < 12) return;
    // „abgeleitet": Größe folgt deterministisch aus dem Code und soll den
    // Sync-Fast-Forward nicht als Bearbeitung blockieren (M82-Muster)
    runDerived(() => resizeNode(id, w, h));
  };

  // Einmal-Einpassen nach dem NÄCHSTEN Render — Vorlage/KI setzen das Flag,
  // gemessen wird erst, wenn das neue SVG im DOM steht.
  // fitOnLoad (M122): von KI-Aktionen ERZEUGTE Diagramm-Karten tragen das
  // Flag in den Daten — nach dem ersten erfolgreichen Render passt sich die
  // Karte der Diagrammgröße an (nichts abgeschnitten), Flag wird geräumt.
  useEffect(() => {
    if (!svg) return;
    if (!fitOnRender.current && !data.fitOnLoad) return;
    fitOnRender.current = false;
    fitToDiagram();
    if (data.fitOnLoad) runDerived(() => updateNodeData(id, { fitOnLoad: undefined }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg]);

  // Ausgewählten Flowchart-Schritt im SVG markieren (Klasse aufs <g>)
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    root.querySelectorAll('g.mm-selected').forEach((g) => g.classList.remove('mm-selected'));
    if (!selNode) return;
    root.querySelectorAll('g.node, g.rough-node').forEach((g) => {
      if (nodeIdOf(g as SVGGElement) === selNode) g.classList.add('mm-selected');
    });
  }, [selNode, svg]);

  // Ausgewählte Verbindung im SVG markieren
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    root.querySelectorAll('path.mm-selected-edge').forEach((p) => p.classList.remove('mm-selected-edge'));
    if (!selEdge) return;
    root.querySelectorAll('path.flowchart-link').forEach((p) => {
      if (p.id.includes(`-L_${selEdge.from}_${selEdge.to}_`)) p.classList.add('mm-selected-edge');
    });
  }, [selEdge, svg]);

  // Auswahl in Sequenz/Gantt/Mindmap/Kreis im SVG markieren (per Index)
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    root.querySelectorAll('.mm-selected-el').forEach((el) => el.classList.remove('mm-selected-el'));
    // Status-Übergänge nutzen die Kanten-Markierung — hier mit aufräumen
    // (im Flowchart macht das der selEdge-Effekt, der davor läuft)
    if (kind === 'state') root.querySelectorAll('path.mm-selected-edge').forEach((p) => p.classList.remove('mm-selected-edge'));
    if (!selOther) return;
    const mark = (sel: string, idx: number) => root.querySelectorAll(sel)[idx]?.classList.add('mm-selected-el');
    if (selOther.t === 'msg') mark('text.messageText', selOther.idx);
    if (selOther.t === 'task') { mark('rect.task', selOther.idx); mark('text.taskText', selOther.idx); }
    if (selOther.t === 'gsec') mark('text.sectionTitle', selOther.idx);
    if (selOther.t === 'mind') mark('g.mindmap-node', mindLines(data.code).indexOf(selOther.line));
    if (selOther.t === 'pie') { mark('path.pieCircle', selOther.idx); mark('g.legend', selOther.idx); }
    if (selOther.t === 'actor') {
      root.querySelectorAll('text.actor').forEach((el) => {
        if ((el.textContent ?? '').trim() === selOther.name) el.classList.add('mm-selected-el');
      });
    }
    if (selOther.t === 'state') {
      root.querySelectorAll('g.node, g.rough-node').forEach((el) => {
        if (new RegExp(`-state-${selOther.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(el.id)) el.classList.add('mm-selected-el');
      });
    }
    if (selOther.t === 'stEdge') {
      root.querySelectorAll('.edgePaths path').forEach((el) => {
        if (el.id.endsWith(`-edge${selOther.idx}`)) el.classList.add('mm-selected-edge');
      });
    }
    if (selOther.t === 'tl') mark('g.timeline-node', selOther.idx);
    if (selOther.t === 'qPoint') {
      root.querySelectorAll('g.data-point').forEach((el) => {
        if ((el.textContent ?? '').trim() === selOther.label) el.classList.add('mm-selected-el');
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selOther, svg]);

  // Karte abgewählt → alle Auswahlen, Verbinden-Modus, Popovers, Umbenennen aufräumen
  useEffect(() => {
    if (!selected) { setSelNode(null); setSelEdge(null); setSelOther(null); setConnectFrom(null); setTplOpen(false); setPendingTpl(null); setRename(null); }
  }, [selected]);

  /** Vorlage laden — eigenen Code nicht durch einen Fehlklick verlieren.
   *  Statt Browser-confirm: der Knopf verwandelt sich in eine Rückfrage,
   *  erst der zweite Klick ersetzt wirklich (alles inline, M92). */
  const applyTemplate = (t: string) => {
    const isPristine = !data.code.trim() || data.code === LEGACY_MERMAID_DEFAULT || Object.values(TEMPLATES).includes(data.code);
    if (!isPristine && pendingTpl !== t) { setPendingTpl(t); return; }
    setPendingTpl(null);
    setTplOpen(false);
    setSelNode(null);
    setSelEdge(null);
    setSelOther(null);
    setConnectFrom(null);
    fitOnRender.current = true; // neue Vorlage → Karte einmalig einpassen
    updateNodeData(id, { code: TEMPLATES[t] });
  };

  // ---------- WYSIWYG: Flowchart-Schritte direkt bearbeiten ----------
  /** mermaid-Element-ID → Knoten-ID im Code. Format ist
   *  „<render-id>-flowchart-<knoten>-<laufnr>" — Präfix und Laufnummer weg */
  const nodeIdOf = (g: SVGGElement): string | null => {
    const m = /flowchart-(.+)-\d+$/.exec(g.id ?? '');
    return m ? m[1] : null;
  };

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Definition „id<Klammer>Label<Klammer>" im Code finden.
   *  Label-Gruppe kennt auch die "…"-Form — nur so überleben Beschriftungen
   *  mit Klammern/Sonderzeichen ein erneutes Umbenennen (Audit M97). */
  const defRe = (nid: string) =>
    new RegExp(`(\\b${escapeRe(nid)})((?:\\(\\(|\\[\\[|\\{\\{|\\[|\\{|\\())("[^"]*"|[^\\]})]*)((?:\\)\\)|\\]\\]|\\}\\}|\\]|\\}|\\)))`);

  /** Beschriftung mermaid-sicher machen: Sonderzeichen (Klammern, #, ; …)
   *  brauchen die "…"-Form; innere Anführungszeichen werden zu ' (Audit M97) */
  const asLabel = (label: string) =>
    /[[\](){}"#;|<>&]/.test(label) ? `"${label.replace(/"/g, "'")}"` : label;

  /** Label eines Schritts ersetzen — Klammerform ([…], {…}, ((…)), (…)) bleibt.
   *  Ersetzung über Callback: $-Zeichen im Label sind sonst Replacement-Muster */
  const renameNode = (nid: string, label: string) => {
    const re = defRe(nid);
    const safe = asLabel(label);
    if (re.test(data.code)) {
      updateNodeData(id, { code: data.code.replace(re, (_m, p1, p2, _p3, p4) => `${p1}${p2}${safe}${p4}`) });
    } else {
      updateNodeData(id, { code: `${data.code}\n  ${nid}[${safe}]` });
    }
  };

  /** Form eines Schritts wechseln (Klammern tauschen, Label bleibt) */
  const setShape = (nid: string, open: string, close: string) => {
    const re = defRe(nid);
    if (re.test(data.code)) {
      updateNodeData(id, { code: data.code.replace(re, (_m, p1, _p2, p3, _p4) => `${p1}${open}${p3}${close}`) });
    } else {
      updateNodeData(id, { code: `${data.code}\n  ${nid}${open}${nid}${close}` });
    }
  };

  /** Füllfarbe eines Schritts setzen/entfernen (mermaid style-Zeile) */
  const setNodeColor = (nid: string, fill?: string, stroke?: string) => {
    const styleLine = new RegExp(`^\\s*style\\s+${escapeRe(nid)}\\b.*$`, 'm');
    let code = data.code.replace(styleLine, '').replace(/\n{3,}/g, '\n\n').trimEnd();
    if (fill) code += `\n  style ${nid} fill:${fill},stroke:${stroke},color:#1f1e1b`;
    updateNodeData(id, { code });
  };

  const addStepAfter = (nid: string | null) => {
    const newId = `s${Date.now().toString(36).slice(-4)}`;
    const line = nid ? `  ${nid} --> ${newId}[Neuer Schritt]` : `  ${newId}[Neuer Schritt]`;
    updateNodeData(id, { code: `${data.code}\n${line}` });
    setSelNode(newId);
  };

  const removeNode = (nid: string) => {
    const re = new RegExp(`(^|\\s|-)${escapeRe(nid)}(\\b|\\[|\\{|\\()`);
    const lines = data.code.split('\n');
    const kept = lines.filter((l, i) => i === 0 || !re.test(l));
    updateNodeData(id, { code: kept.join('\n') });
    setSelNode(null);
    setConnectFrom(null); // ein laufender Verbinden-Modus zeigt sonst ins Leere
  };

  // ---------- Verbindungen direkt bearbeiten (M99) ----------
  /** Kanten-Pfad → {from,to}. Pfad-ID: „<render-id>-L_<von>_<nach>_<n>" —
   *  aufgelöst gegen die im SVG bekannten Knoten-IDs (IDs können _ enthalten) */
  const edgeIdsOf = (p: SVGPathElement): { from: string; to: string } | null => {
    const m = /-L_(.+)_\d+$/.exec(p.id ?? '');
    if (!m) return null;
    const known = new Set<string>();
    previewRef.current?.querySelectorAll('g.node, g.rough-node').forEach((g) => {
      const nid = nodeIdOf(g as SVGGElement);
      if (nid) known.add(nid);
    });
    for (const f of known) {
      if (m[1].startsWith(`${f}_`)) {
        const rest = m[1].slice(f.length + 1);
        if (known.has(rest)) return { from: f, to: rest };
      }
    }
    return null;
  };

  const EDGE_DEF = '(?:\\(\\(.*?\\)\\)|\\[\\[.*?\\]\\]|\\{\\{.*?\\}\\}|\\[.*?\\]|\\{.*?\\}|\\(.*?\\))?';
  const edgeLineRe = (from: string, to: string) =>
    new RegExp(`^([ \\t]*)(${escapeRe(from)}${EDGE_DEF})\\s*(={2,}>|-\\.+->|-{2,}>)\\s*(\\|.*?\\|)?\\s*(${escapeRe(to)}${EDGE_DEF})\\s*$`);

  const findEdgeFor = (from: string, to: string) => {
    const re = edgeLineRe(from, to);
    const lines = data.code.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const m = re.exec(lines[i]);
      if (m) return { i, m, lines };
    }
    return null;
  };
  const findEdgeLine = () => (selEdge ? findEdgeFor(selEdge.from, selEdge.to) : null);
  const stripEdgeLabel = (raw?: string) =>
    (raw ?? '').replace(/^\|/, '').replace(/\|$/, '').replace(/^"/, '').replace(/"$/, '');

  /** Pfeil/Beschriftung einer Verbindung neu schreiben.
   *  arrow: undefined = beibehalten; label: undefined = beibehalten, '' = entfernen */
  const rewriteEdge = (arrow?: string, label?: string) => {
    const f = findEdgeLine();
    if (!f) return;
    const [, pre, fromPart, oldArrow, oldLabel, toPart] = f.m;
    const a = arrow ?? oldArrow;
    const lbl = label === undefined ? (oldLabel ?? '') : label ? `|${asLabel(label)}|` : '';
    f.lines[f.i] = `${pre}${fromPart} ${a}${lbl} ${toPart}`;
    updateNodeData(id, { code: f.lines.join('\n') });
  };

  const removeEdge = () => {
    const f = findEdgeLine();
    if (!f || !selEdge) return;
    const [, pre, fromPart, , , toPart] = f.m;
    // Inline-Definitionen (A[Start] --> B{…}) überleben als eigene Zeilen
    const keep: string[] = [];
    if (fromPart.length > selEdge.from.length) keep.push(`${pre}${fromPart}`);
    if (toPart.length > selEdge.to.length) keep.push(`${pre}${toPart}`);
    f.lines.splice(f.i, 1, ...keep);
    updateNodeData(id, { code: f.lines.join('\n') });
    setSelEdge(null);
  };

  const startEdgeLabel = () => {
    if (!selEdge) return;
    setRename({
      target: { t: 'edge' },
      x: Math.max(4, selEdge.x - 75), y: Math.max(4, selEdge.y - 14), w: 150,
      value: stripEdgeLabel(findEdgeLine()?.m[4]),
    });
  };

  // Aktueller Pfeil der ausgewählten Verbindung (für die aktiven Stil-Knöpfe)
  const selEdgeArrow = selEdge ? (findEdgeLine()?.m[3] ?? '') : '';

  /** Klickpunkt eines SVG-Elements → lokale Vorschau-Koordinaten (Zoom raus) */
  const localCenter = (el: Element) => {
    const root = previewRef.current!;
    const rootRect = root.getBoundingClientRect();
    const scale = root.offsetWidth ? rootRect.width / root.offsetWidth : 1;
    const r = el.getBoundingClientRect();
    return {
      x: (r.left + r.width / 2 - rootRect.left) / scale + root.scrollLeft,
      y: (r.top + r.height / 2 - rootRect.top) / scale + root.scrollTop,
    };
  };

  const onPreviewClick = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest?.('g.node, g.rough-node') as SVGGElement | null;
    if (g && isFlow) {
      const nid = nodeIdOf(g);
      // Verbinden-Modus: zweiter Klick = Ziel → Pfeil ziehen
      if (connectFrom && nid && nid !== connectFrom) {
        updateNodeData(id, { code: `${data.code}\n  ${connectFrom} --> ${nid}` });
        setConnectFrom(null);
        setSelNode(nid);
        return;
      }
      setSelNode(nid);
      setSelEdge(null);
      return;
    }
    // Klick auf einen Pfeil → Verbindung auswählen (M99)
    const p = (e.target as Element).closest?.('path.flowchart-link') as SVGPathElement | null;
    if (p && isFlow) {
      const ids = edgeIdsOf(p);
      if (ids) {
        setSelEdge({ ...ids, ...localCenter(p) });
        setSelNode(null);
        setConnectFrom(null);
        return;
      }
    }
    // Sequenz/Gantt/Mindmap/Kreis/Status/Zeitstrahl/Quadrant: auswählen (M100/M101)
    const other = hitOther(e.target as Element);
    if (other) {
      // Verbinden-Modus im Statusdiagramm: zweiter Klick = Ziel → Übergang
      if (other.t === 'state' && connectFrom && other.name !== connectFrom) {
        updateNodeData(id, { code: `${data.code}\n  ${connectFrom} --> ${other.name}` });
        setConnectFrom(null);
        setSelOther(other);
        return;
      }
      setSelOther(other);
      setSelNode(null);
      setSelEdge(null);
      return;
    }
    setSelNode(null);
    setSelEdge(null);
    setSelOther(null);
    setConnectFrom(null);
  };

  /** Bild-Element unter dem Klick → Auswahl für Sequenz/Gantt/Mindmap/Kreis.
   *  Zuordnung über die Dokument-Reihenfolge (n-tes Element = n-te Zeile). */
  const hitOther = (target: Element): SelOther | null => {
    const root = previewRef.current;
    if (!root) return null;
    const idxOf = (sel: string, el: Element) => Array.prototype.indexOf.call(root.querySelectorAll(sel), el);
    if (kind === 'seq') {
      const msg = target.closest?.('text.messageText');
      if (msg) return { t: 'msg', idx: idxOf('text.messageText', msg), ...localCenter(msg) };
      const actorEl = target.closest?.('text.actor, rect.actor');
      if (actorEl) {
        const name = (actorEl.tagName.toLowerCase() === 'text'
          ? actorEl.textContent
          : actorEl.nextElementSibling?.textContent ?? '')?.trim();
        if (name) return { t: 'actor', name, ...localCenter(actorEl) };
      }
    }
    if (kind === 'gantt') {
      const bar = target.closest?.('rect.task');
      if (bar) return { t: 'task', idx: idxOf('rect.task', bar), ...localCenter(bar) };
      const txt = target.closest?.('text.taskText');
      if (txt) return { t: 'task', idx: idxOf('text.taskText', txt), ...localCenter(txt) };
      const sec = target.closest?.('text.sectionTitle');
      if (sec) return { t: 'gsec', idx: idxOf('text.sectionTitle', sec), ...localCenter(sec) };
    }
    if (kind === 'state') {
      const g = target.closest?.('g.node, g.rough-node');
      if (g) {
        const m = /-state-(.+)-\d+$/.exec(g.id ?? '');
        // Start-/Endpunkte ([*]) sind nicht bearbeitbar
        if (m && !m[1].startsWith('root_')) return { t: 'state', name: m[1], ...localCenter(g) };
        return null;
      }
      const p = target.closest?.('.edgePaths path') as SVGPathElement | null;
      if (p) {
        const m = /-edge(\d+)$/.exec(p.id ?? '');
        if (m) return { t: 'stEdge', idx: parseInt(m[1], 10), ...localCenter(p) };
      }
    }
    if (kind === 'timeline') {
      const n = target.closest?.('g.timeline-node');
      if (n) return { t: 'tl', idx: idxOf('g.timeline-node', n), ...localCenter(n) };
    }
    if (kind === 'quadrant') {
      const pt = target.closest?.('g.data-point');
      if (pt) {
        const label = (pt.textContent ?? '').trim();
        if (label) return { t: 'qPoint', label, ...localCenter(pt) };
      }
      // Quadranten-/Achsen-Beschriftungen: Zuordnung über den Textinhalt
      const txt = target.closest?.('text');
      if (txt) {
        const content = (txt.textContent ?? '').trim();
        const qn = quadrantLabels(data.code).findIndex((q) => q && q === content);
        if (qn >= 0) return { t: 'qLabel', n: qn + 1, ...localCenter(txt) };
        const ax = axisLabels(data.code);
        for (const axis of ['x', 'y'] as const) {
          for (const side of [0, 1] as const) {
            if (ax[axis][side] && ax[axis][side] === content) return { t: 'axis', axis, side, ...localCenter(txt) };
          }
        }
      }
    }
    if (kind === 'mind') {
      const n = target.closest?.('g.mindmap-node');
      if (n) {
        const line = mindLines(data.code)[idxOf('g.mindmap-node', n)];
        if (line != null) return { t: 'mind', line, ...localCenter(n) };
      }
    }
    if (kind === 'pie') {
      const leg = target.closest?.('g.legend');
      if (leg) return { t: 'pie', idx: idxOf('g.legend', leg), ...localCenter(leg) };
      const slice = target.closest?.('path.pieCircle');
      if (slice) return { t: 'pie', idx: idxOf('path.pieCircle', slice), ...localCenter(slice) };
    }
    return null;
  };

  /** Aktueller Text der Auswahl (für das Inline-Eingabefeld) */
  const otherValue = (o: SelOther): string => {
    switch (o.t) {
      case 'msg': return seqMessages(data.code)[o.idx]?.text ?? '';
      case 'actor': return o.name;
      case 'task': return ganttTasks(data.code)[o.idx]?.name ?? '';
      case 'gsec': return ganttSections(data.code)[o.idx]?.name ?? '';
      case 'mind': return mindText(data.code, o.line);
      case 'pie': return pieSlices(data.code)[o.idx]?.label ?? '';
      case 'state': return o.name;
      case 'stEdge': return stateTransitions(data.code)[o.idx]?.label ?? '';
      case 'tl': return timelineTokens(data.code)[o.idx]?.text ?? '';
      case 'qPoint': return o.label;
      case 'qLabel': return quadrantLabels(data.code)[o.n - 1] ?? '';
      case 'axis': return axisLabels(data.code)[o.axis][o.side] ?? '';
    }
  };

  /** Inline-Eingabefeld für eine Nicht-Flowchart-Auswahl öffnen */
  const startOtherRename = (o: SelOther) => {
    const target: RenameTarget = o.t === 'actor' ? { t: 'actor', name: o.name }
      : o.t === 'mind' ? { t: 'mind', line: o.line }
      : o.t === 'state' ? { t: 'state', name: o.name }
      : o.t === 'qPoint' ? { t: 'qPoint', label: o.label }
      : o.t === 'qLabel' ? { t: 'qLabel', n: o.n }
      : o.t === 'axis' ? { t: 'axis', axis: o.axis, side: o.side }
      : { t: o.t, idx: o.idx };
    setRename({ target, x: Math.max(4, o.x - 75), y: Math.max(4, o.y - 14), w: 160, value: otherValue(o) });
  };

  /** Titel-Zeile bearbeiten (gantt, Kreis, Zeitstrahl, Quadrant) */
  const startTitleRename = () => {
    setRename({ target: { t: 'title' }, x: 12, y: 8, w: 220, value: getTitle(data.code) });
  };

  /** Inline-Umbenennen starten: Eingabefeld exakt über den Schritt legen.
   *  Bildschirm-Koordinaten → lokale Karte (React-Flow-Zoom herausrechnen). */
  const startRename = (nid: string) => {
    const root = previewRef.current;
    if (!root) return;
    let target: SVGGElement | null = null;
    root.querySelectorAll('g.node, g.rough-node').forEach((g) => {
      if (!target && nodeIdOf(g as SVGGElement) === nid) target = g as SVGGElement;
    });
    const rootRect = root.getBoundingClientRect();
    const scale = root.offsetWidth ? rootRect.width / root.offsetWidth : 1;
    const r = (target as SVGGElement | null)?.getBoundingClientRect();
    const x = r ? (r.left - rootRect.left) / scale + root.scrollLeft : 12;
    const y = r ? (r.top - rootRect.top) / scale + root.scrollTop : 12;
    const w = r ? Math.max(120, r.width / scale + 16) : 160;
    const label = ((target as SVGGElement | null)?.textContent ?? '').trim();
    setSelNode(nid);
    setConnectFrom(null);
    setRename({ target: { t: 'node', nid }, x, y, w, value: label });
  };

  /** Übernahme aus dem Inline-Eingabefeld — je nach Ziel (M100) */
  const commitRename = () => {
    if (!rename) return;
    const v = rename.value.trim();
    const tg = rename.target;
    const up = (next: string | null) => { if (next != null) updateNodeData(id, { code: next }); };
    switch (tg.t) {
      case 'node': if (v) renameNode(tg.nid, v); break;
      case 'edge': rewriteEdge(undefined, v); break; // leer = Beschriftung weg
      case 'msg': if (v) up(setSeqMsg(data.code, tg.idx, { text: v })); break;
      case 'actor':
        if (v) { up(renameSeqActor(data.code, tg.name, v)); setSelOther(null); }
        break;
      case 'task': if (v) up(renameGanttTask(data.code, tg.idx, v)); break;
      case 'gsec': if (v) up(renameGanttSection(data.code, tg.idx, v)); break;
      case 'mind': if (v) up(renameMind(data.code, tg.line, v)); break;
      case 'pie': if (v) up(renamePie(data.code, tg.idx, v)); break;
      case 'state':
        // connectFrom zeigt sonst auf den alten Namen und würde beim
        // nächsten Klick den gelöschten Zustand neu anlegen (Review M101)
        if (v) { up(renameState(data.code, tg.name, v)); setSelOther(null); setConnectFrom(null); }
        break;
      case 'stEdge': up(setStateTransLabel(data.code, tg.idx, v)); break; // leer = Beschriftung weg
      case 'tl': if (v) up(renameTimelineToken(data.code, tg.idx, v)); break;
      case 'qPoint':
        if (v) { up(renameQuadrantPoint(data.code, tg.label, v)); setSelOther(null); }
        break;
      case 'qLabel': if (v) up(setQuadrantLabel(data.code, tg.n, v)); break;
      case 'axis': if (v) up(setAxisLabel(data.code, tg.axis, tg.side, v)); break;
      case 'title': up(setTitle(data.code, v)); break; // leer = Titel entfernen
    }
    setRename(null);
  };

  const onPreviewDblClick = (e: React.MouseEvent) => {
    if (isFlow) {
      const g = (e.target as Element).closest?.('g.node, g.rough-node') as SVGGElement | null;
      if (g) {
        const nid = nodeIdOf(g);
        if (nid) startRename(nid);
        return;
      }
      // Doppelklick auf einen Pfeil → Beschriftung direkt bearbeiten
      const p = (e.target as Element).closest?.('path.flowchart-link') as SVGPathElement | null;
      if (p) {
        const ids = edgeIdsOf(p);
        if (!ids) return;
        const c = localCenter(p);
        setSelEdge({ ...ids, ...c });
        setSelNode(null);
        setRename({
          target: { t: 'edge' },
          x: Math.max(4, c.x - 75), y: Math.max(4, c.y - 14), w: 150,
          value: stripEdgeLabel(findEdgeFor(ids.from, ids.to)?.m[4]),
        });
      }
      return;
    }
    // Sequenz/Gantt/Mindmap/Kreis: Doppelklick = direkt umbenennen (M100)
    const other = hitOther(e.target as Element);
    if (other) {
      setSelOther(other);
      setSelNode(null);
      setSelEdge(null);
      startOtherRename(other);
    }
  };

  const renameSelected = () => { if (selNode) startRename(selNode); };

  /** Richtung TD ⇄ LR (nur Flowchart) */
  const toggleDirection = () => {
    updateNodeData(id, {
      code: data.code.replace(/^(\s*(?:flowchart|graph)\s+)(TD|TB|LR|RL|BT)/, (_a, pre, dir) =>
        `${pre}${dir === 'LR' ? 'TD' : 'LR'}`),
    });
  };

  // ---------- KI: beschreiben oder ändern ----------
  const runAi = async () => {
    const wish = aiText.trim();
    if (!wish || aiBusy) return;
    setAiBusy(true);
    try {
      const code = await aiMermaid(wish, data.code);
      fitOnRender.current = true; // KI-Diagramm → Karte einmalig einpassen
      updateNodeData(id, { code });
      setAiText('');
      setSelNode(null);
      setSelEdge(null);
      setSelOther(null);
      setConnectFrom(null);
      showToast('✨ Diagramm aktualisiert.');
    } catch (e) {
      showToast(`KI-Diagramm fehlgeschlagen: ${String((e as Error).message).slice(0, 120)}`, false, 8000);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <CardShell
      id={id}
      selected={selected}
      minWidth={240}
      minHeight={120}
      className="mermaid-card"
    >
      {/* Werkzeuge schweben UNTER dem Diagramm — FLACH wie bei Excalidraw/
          Nextcloud-Whiteboard: alles direkt sichtbar, keine Untermenüs (M98).
          Die Schritt-Zeile erscheint ZUSÄTZLICH über der Hauptzeile. */}
      <NodeToolbar isVisible={!!selected} position={Position.Bottom} offset={14} className="mm-toolbar nodrag">
        {selNode && (
          <div className="mm-row mm-step-row">
            <span className="mm-sel-name" title="Ausgewählter Schritt">„{selNode}"</span>
            <button onClick={renameSelected}>✎ Umbenennen</button>
            <span className="mm-sep" />
            {SHAPES.map(([sym, name, o, c]) => (
              <button key={name} className="mm-shape" title={`Form: ${name}`} onClick={() => setShape(selNode, o, c)}>{sym}</button>
            ))}
            <span className="mm-sep" />
            {NODE_COLORS.map(([name, fill, stroke]) => (
              <button key={name} className="mm-dot mm-dot-s" style={{ background: fill, borderColor: stroke }} title={`Füllung ${name}`} onClick={() => setNodeColor(selNode, fill, stroke)} />
            ))}
            <button className="mm-dot mm-dot-s mm-dot-none" title="Füllung zurücksetzen" onClick={() => setNodeColor(selNode)} />
            <span className="mm-sep" />
            <button className={connectFrom ? 'active' : ''} title="Mit anderem Schritt verbinden: danach Ziel anklicken" onClick={() => setConnectFrom(connectFrom ? null : selNode)}>
              {connectFrom ? 'Ziel anklicken …' : '→ Verbinden'}
            </button>
            <button className="danger" title="Schritt aus dem Diagramm entfernen" onClick={() => removeNode(selNode)}>Entfernen</button>
            <button onClick={() => { setSelNode(null); setConnectFrom(null); }} title="Schritt-Auswahl aufheben">✕</button>
          </div>
        )}
        {selOther && (
          <div className="mm-row mm-step-row">
            {selOther.t === 'msg' && (() => {
              const m = seqMessages(data.code)[selOther.idx];
              const up = (next: string | null) => { if (next != null) updateNodeData(id, { code: next }); };
              return (
                <>
                  <span className="mm-sel-name" title="Ausgewählte Nachricht">{m ? `${m.from} → ${m.to}` : 'Nachricht'}</span>
                  <button onClick={() => startOtherRename(selOther)}>✎ Text</button>
                  <span className="mm-sep" />
                  <button className={m && !m.arrow.startsWith('--') ? 'active' : ''} title="Pfeil: durchgezogen" onClick={() => up(setSeqMsg(data.code, selOther.idx, { arrow: '->>' }))}>─</button>
                  <button className={m?.arrow.startsWith('--') ? 'active' : ''} title="Pfeil: gestrichelt (Antwort)" onClick={() => up(setSeqMsg(data.code, selOther.idx, { arrow: '-->>' }))}>┄</button>
                  <span className="mm-sep" />
                  <button title="Nachricht danach einfügen (Gegenrichtung)" onClick={() => { updateNodeData(id, { code: addSeqMsg(data.code, selOther.idx) }); }}>＋ Danach</button>
                  <button title="Notiz unter dieser Nachricht (Note over)" onClick={() => updateNodeData(id, { code: addSeqNote(data.code, selOther.idx) })}>Notiz</button>
                  <button className="danger" onClick={() => { up(removeSeqMsg(data.code, selOther.idx)); setSelOther(null); }}>Entfernen</button>
                </>
              );
            })()}
            {selOther.t === 'actor' && (
              <>
                <span className="mm-sel-name" title="Ausgewählte Person">„{selOther.name}"</span>
                <button onClick={() => startOtherRename(selOther)}>✎ Umbenennen</button>
                <button className="danger" title="Person samt ihrer Nachrichten entfernen" onClick={() => { updateNodeData(id, { code: removeSeqActor(data.code, selOther.name) }); setSelOther(null); }}>Entfernen</button>
              </>
            )}
            {selOther.t === 'task' && (() => {
              const t = ganttTasks(data.code)[selOther.idx];
              const up = (next: string | null) => { if (next != null) updateNodeData(id, { code: next }); };
              const hasDays = t ? /\d+\s*d\s*$/.test(t.meta) : false;
              return (
                <>
                  <span className="mm-sel-name" title="Ausgewählte Aufgabe">„{t?.name ?? 'Aufgabe'}"</span>
                  <button onClick={() => startOtherRename(selOther)}>✎ Umbenennen</button>
                  {hasDays && (
                    <>
                      <span className="mm-sep" />
                      <button title="Einen Tag kürzer" onClick={() => up(shiftGanttTask(data.code, selOther.idx, -1))}>−1 Tag</button>
                      <button title="Einen Tag länger" onClick={() => up(shiftGanttTask(data.code, selOther.idx, 1))}>＋1 Tag</button>
                    </>
                  )}
                  <span className="mm-sep" />
                  {(['done', 'active', 'crit'] as const).map((f) => (
                    <button
                      key={f}
                      className={ganttFlags(data.code, selOther.idx).includes(f) ? 'active' : ''}
                      title={f === 'done' ? 'Erledigt markieren' : f === 'active' ? 'Als laufend markieren' : 'Als kritisch markieren'}
                      onClick={() => up(toggleGanttFlag(data.code, selOther.idx, f))}
                    >{f === 'done' ? '✓' : f === 'active' ? '▶' : '⚠'}</button>
                  ))}
                  <span className="mm-sep" />
                  <button title="Neue Aufgabe direkt danach" onClick={() => updateNodeData(id, { code: addGanttTask(data.code, selOther.idx) })}>＋ Danach</button>
                  <button className="danger" onClick={() => { up(removeGanttTask(data.code, selOther.idx)); setSelOther(null); }}>Entfernen</button>
                </>
              );
            })()}
            {selOther.t === 'gsec' && (
              <>
                <span className="mm-sel-name" title="Ausgewählter Abschnitt">Abschnitt „{ganttSections(data.code)[selOther.idx]?.name ?? ''}"</span>
                <button onClick={() => startOtherRename(selOther)}>✎ Umbenennen</button>
              </>
            )}
            {selOther.t === 'state' && (
              <>
                <span className="mm-sel-name" title="Ausgewählter Zustand">„{selOther.name}"</span>
                <button onClick={() => startOtherRename(selOther)}>✎ Umbenennen</button>
                <button className={connectFrom ? 'active' : ''} title="Übergang zu anderem Zustand: danach Ziel anklicken" onClick={() => setConnectFrom(connectFrom ? null : selOther.name)}>
                  {connectFrom ? 'Ziel anklicken …' : '→ Übergang'}
                </button>
                <button className="danger" title="Zustand samt Übergängen entfernen" onClick={() => { updateNodeData(id, { code: removeState(data.code, selOther.name) }); setSelOther(null); setConnectFrom(null); }}>Entfernen</button>
              </>
            )}
            {selOther.t === 'stEdge' && (() => {
              const tr = stateTransitions(data.code)[selOther.idx];
              const up = (next: string | null) => { if (next != null) updateNodeData(id, { code: next }); };
              return (
                <>
                  <span className="mm-sel-name" title="Ausgewählter Übergang">{tr ? `${tr.from} → ${tr.to}` : 'Übergang'}</span>
                  <button onClick={() => startOtherRename(selOther)}>✎ Beschriften</button>
                  <button className="danger" onClick={() => { up(removeStateTrans(data.code, selOther.idx)); setSelOther(null); }}>Entfernen</button>
                </>
              );
            })()}
            {selOther.t === 'tl' && (() => {
              const tk = timelineTokens(data.code)[selOther.idx];
              const up = (next: string | null) => { if (next != null) updateNodeData(id, { code: next }); };
              return (
                <>
                  <span className="mm-sel-name" title={tk?.isPeriod ? 'Ausgewählte Periode' : 'Ausgewähltes Ereignis'}>
                    {tk?.isPeriod ? '🕘' : '•'} „{tk?.text ?? ''}"
                  </span>
                  <button onClick={() => startOtherRename(selOther)}>✎ Umbenennen</button>
                  <button title="Ereignis in dieser Periode anfügen" onClick={() => updateNodeData(id, { code: addTimelineEvent(data.code, selOther.idx) })}>＋ Ereignis</button>
                  <button className="danger" title={tk?.isPeriod ? 'Periode samt Ereignissen entfernen' : 'Ereignis entfernen'} onClick={() => { up(removeTimelineToken(data.code, selOther.idx)); setSelOther(null); }}>Entfernen</button>
                </>
              );
            })()}
            {selOther.t === 'qPoint' && (() => {
              const up = (next: string | null) => { if (next != null) updateNodeData(id, { code: next }); };
              return (
                <>
                  <span className="mm-sel-name" title="Ausgewählter Punkt">„{selOther.label}"</span>
                  <button onClick={() => startOtherRename(selOther)}>✎ Umbenennen</button>
                  <span className="mm-sep" />
                  <button title="Nach links (−0,1)" onClick={() => up(nudgeQuadrantPoint(data.code, selOther.label, -0.1, 0))}>◀</button>
                  <button title="Nach rechts (+0,1)" onClick={() => up(nudgeQuadrantPoint(data.code, selOther.label, 0.1, 0))}>▶</button>
                  <button title="Nach oben (+0,1)" onClick={() => up(nudgeQuadrantPoint(data.code, selOther.label, 0, 0.1))}>▲</button>
                  <button title="Nach unten (−0,1)" onClick={() => up(nudgeQuadrantPoint(data.code, selOther.label, 0, -0.1))}>▼</button>
                  <span className="mm-sep" />
                  <button className="danger" onClick={() => { up(removeQuadrantPoint(data.code, selOther.label)); setSelOther(null); }}>Entfernen</button>
                </>
              );
            })()}
            {selOther.t === 'qLabel' && (
              <>
                <span className="mm-sel-name" title="Quadranten-Beschriftung">Quadrant {selOther.n}</span>
                <button onClick={() => startOtherRename(selOther)}>✎ Umbenennen</button>
              </>
            )}
            {selOther.t === 'axis' && (
              <>
                <span className="mm-sel-name" title="Achsen-Beschriftung">{selOther.axis === 'x' ? 'X-Achse' : 'Y-Achse'} ({selOther.side === 0 ? 'links/unten' : 'rechts/oben'})</span>
                <button onClick={() => startOtherRename(selOther)}>✎ Umbenennen</button>
              </>
            )}
            {selOther.t === 'mind' && (
              <>
                <span className="mm-sel-name" title="Ausgewählter Punkt">„{mindText(data.code, selOther.line)}"</span>
                <button onClick={() => startOtherRename(selOther)}>✎ Umbenennen</button>
                <button title="Unterpunkt anfügen" onClick={() => updateNodeData(id, { code: addMindChild(data.code, selOther.line) })}>＋ Unterpunkt</button>
                {selOther.line !== mindLines(data.code)[0] && (
                  <button className="danger" title="Punkt samt Unterpunkten entfernen" onClick={() => { const c = removeMind(data.code, selOther.line); if (c != null) updateNodeData(id, { code: c }); setSelOther(null); }}>Entfernen</button>
                )}
              </>
            )}
            {selOther.t === 'pie' && (() => {
              const s = pieSlices(data.code)[selOther.idx];
              const up = (next: string | null) => { if (next != null) updateNodeData(id, { code: next }); };
              return (
                <>
                  <span className="mm-sel-name" title="Ausgewähltes Segment">„{s?.label ?? 'Segment'}" ({s?.value ?? '–'})</span>
                  <button onClick={() => startOtherRename(selOther)}>✎ Umbenennen</button>
                  <span className="mm-sep" />
                  <button title="Wert −5" onClick={() => up(shiftPie(data.code, selOther.idx, -5))}>−5</button>
                  <button title="Wert +5" onClick={() => up(shiftPie(data.code, selOther.idx, 5))}>＋5</button>
                  <span className="mm-sep" />
                  <button className="danger" onClick={() => { up(removePie(data.code, selOther.idx)); setSelOther(null); }}>Entfernen</button>
                </>
              );
            })()}
            <button onClick={() => setSelOther(null)} title="Auswahl aufheben">✕</button>
          </div>
        )}
        {selEdge && !selNode && (
          <div className="mm-row mm-step-row">
            <span className="mm-sel-name" title="Ausgewählte Verbindung">{selEdge.from} → {selEdge.to}</span>
            <button onClick={startEdgeLabel}>✎ Beschriften</button>
            <span className="mm-sep" />
            <button className={/^-{2,}>$/.test(selEdgeArrow) ? 'active' : ''} title="Linie: durchgezogen" onClick={() => rewriteEdge('-->')}>─</button>
            <button className={selEdgeArrow.startsWith('-.') ? 'active' : ''} title="Linie: gepunktet" onClick={() => rewriteEdge('-.->')}>┄</button>
            <button className={selEdgeArrow.startsWith('=') ? 'active' : ''} title="Linie: dick (Betonung)" onClick={() => rewriteEdge('==>')}>━</button>
            <span className="mm-sep" />
            <button className="danger" title="Verbindung entfernen (Schritte bleiben)" onClick={removeEdge}>Entfernen</button>
            <button onClick={() => setSelEdge(null)} title="Auswahl aufheben">✕</button>
          </div>
        )}
        <div className="mm-row">
          <span className="mm-pop-wrap" ref={tplRef}>
            <button className={tplOpen ? 'active' : ''} title="Vorlage wählen" onClick={() => setTplOpen((o) => !o)}>Vorlage ▾</button>
            {tplOpen && (
              <div className="mm-pop">
                {Object.keys(TEMPLATES).map((t) => (
                  <button key={t} className={pendingTpl === t ? 'mm-confirm' : ''} onClick={() => applyTemplate(t)}>
                    {pendingTpl === t ? `„${t}" ersetzt dein Diagramm — sicher?` : t}
                  </button>
                ))}
              </div>
            )}
          </span>
          <span className="mm-sep" />
          <button className={`mm-dot mm-dot-none ${!style ? 'on' : ''}`} title="Standardfarben" onClick={() => updateNodeData(id, { style: undefined })} />
          {Object.entries(MERMAID_STYLES).map(([k, s]) => (
            <button key={k} className={`mm-dot ${style === k ? 'on' : ''}`} style={{ background: s.dot }} title={`Farbschema ${s.label}`} onClick={() => updateNodeData(id, { style: k })} />
          ))}
          <span className="mm-sep" />
          <button className={look === 'hand' ? 'active' : ''} title={look === 'hand' ? 'Handgezeichneter Look ist AN (Kritzel-Formen + Handschrift)' : 'Handgezeichneter Look: Kritzel-Formen + Handschrift'} onClick={() => updateNodeData(id, { look: look === 'hand' ? undefined : 'hand' })}>✏️</button>
          {isFlow && <button title="Richtung wechseln: oben/unten ⇄ links/rechts" onClick={toggleDirection}>⇄</button>}
          <span className="mm-sep" />
          {isFlow && (
            <button title="Neuen Schritt anfügen (an den ausgewählten, sonst frei)" onClick={() => addStepAfter(selNode)}>＋ Schritt</button>
          )}
          {kind === 'seq' && (
            <>
              <button title="Neue Person (participant)" onClick={() => updateNodeData(id, { code: addSeqActor(data.code) })}>＋ Person</button>
              <button title="Neue Nachricht am Ende" onClick={() => updateNodeData(id, { code: addSeqMsg(data.code, selOther?.t === 'msg' ? selOther.idx : null) })}>＋ Nachricht</button>
              <button className={hasAutonumber(data.code) ? 'active' : ''} title="Nachrichten fortlaufend nummerieren (autonumber)" onClick={() => updateNodeData(id, { code: toggleAutonumber(data.code) })}>№</button>
            </>
          )}
          {kind === 'gantt' && (
            <>
              <button title="Neue Aufgabe (nach der ausgewählten, sonst am Ende)" onClick={() => updateNodeData(id, { code: addGanttTask(data.code, selOther?.t === 'task' ? selOther.idx : null) })}>＋ Aufgabe</button>
              <button title="Neuer Abschnitt (section)" onClick={() => updateNodeData(id, { code: addGanttSection(data.code) })}>＋ Abschnitt</button>
            </>
          )}
          {kind === 'mind' && (
            <button title="Neuen Punkt anfügen (unter dem ausgewählten, sonst unter der Wurzel)" onClick={() => updateNodeData(id, { code: addMindChild(data.code, selOther?.t === 'mind' ? selOther.line : null) })}>＋ Punkt</button>
          )}
          {kind === 'pie' && (
            <button title="Neues Segment" onClick={() => updateNodeData(id, { code: addPie(data.code) })}>＋ Segment</button>
          )}
          {kind === 'state' && (
            <button title="Neuen Zustand anlegen" onClick={() => updateNodeData(id, { code: addState(data.code) })}>＋ Zustand</button>
          )}
          {kind === 'timeline' && (
            <button title="Neue Periode am Ende" onClick={() => updateNodeData(id, { code: addTimelinePeriod(data.code) })}>＋ Periode</button>
          )}
          {kind === 'quadrant' && (
            <button title="Neuen Punkt in der Mitte anlegen" onClick={() => updateNodeData(id, { code: addQuadrantPoint(data.code) })}>＋ Punkt</button>
          )}
          {['gantt', 'pie', 'timeline', 'quadrant'].includes(kind) && (
            <button title={getTitle(data.code) ? `Titel bearbeiten: „${getTitle(data.code)}"` : 'Titel hinzufügen'} onClick={startTitleRename}>✎ Titel</button>
          )}
          <button title="Kartengröße einmalig an das Diagramm anpassen" onClick={() => fitToDiagram()}>⤢</button>
          <button
            className={edit ? 'active' : ''}
            title="Mermaid-Code anzeigen/bearbeiten (für Profis)"
            onClick={() => { const next = !edit; setEdit(next); fitToDiagram(next); }}
          >‹/›</button>
        </div>
        {aiReady(ai) && (
          <div className="mm-row mm-ai-row">
            <input
              value={aiText}
              disabled={aiBusy}
              placeholder={data.code.trim() ? '✨ Änderung beschreiben — z. B. „füge eine Prüfung ein"' : '✨ Diagramm beschreiben — z. B. „Urlaubsantrag-Prozess"'}
              onChange={(e) => setAiText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runAi(); }}
            />
            <button disabled={aiBusy || !aiText.trim()} onClick={() => void runAi()}>{aiBusy ? '…' : <IWand size={14} />}</button>
          </div>
        )}
      </NodeToolbar>
      <div className="mermaid-split">
        {edit && (
          <textarea
            className="mermaid-code nodrag nowheel"
            value={data.code}
            spellCheck={false}
            onChange={(e) => updateNodeData(id, { code: e.target.value })}
          />
        )}
        <div className={`mermaid-preview nowheel${look === 'hand' ? ' mm-hand' : ''}`} data-kind={kind} ref={previewRef} onClick={onPreviewClick} onDoubleClick={onPreviewDblClick}>
          <div className={`mermaid-svg ${error ? 'stale' : ''}`} dangerouslySetInnerHTML={{ __html: svg }} />
          {rename && (
            <input
              className="mm-rename nodrag"
              style={{ left: rename.x, top: rename.y, width: rename.w }}
              autoFocus
              value={rename.value}
              placeholder="Beschriftung …"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setRename({ ...rename, value: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRename(null);
              }}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          )}
          {error && (
            <div className="mermaid-error" title={error}>
              ⚠️ {svg ? 'Code unvollständig — letztes gültiges Diagramm bleibt sichtbar' : error}
            </div>
          )}
          {connectFrom && !error && (
            <div className="mm-hint mm-hint-connect">→ Ziel-Schritt anklicken, um „{connectFrom}" zu verbinden</div>
          )}
          {kind !== 'other' && !error && !connectFrom && selected && (
            <div className="mm-hint">
              {isFlow
                ? 'Klick auf Schritt oder Pfeil = bearbeiten · Doppelklick = umbenennen/beschriften'
                : 'Klick auf ein Element = bearbeiten · Doppelklick = direkt umbenennen'}
            </div>
          )}
        </div>
      </div>
    </CardShell>
  );
}
