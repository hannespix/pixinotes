import { useEffect, useRef, useState } from 'react';
import { NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import { runDerived, useBoard } from '../../store';
import type { MermaidNode } from '../../types';
import { aiReady } from '../../lib/ai';
import { aiMermaid, buildMermaidSource, getMermaid, LEGACY_MERMAID_DEFAULT, MERMAID_STYLES, MERMAID_TEMPLATES as TEMPLATES } from '../../lib/mermaid';
import { useOutsideClose } from '../../lib/useOutsideClose';
import { CardShell } from './CardShell';

/** Form je Schritt: Symbol, Name, Klammern (Mermaid-Syntax) */
const SHAPES: Array<[string, string, string, string]> = [
  ['▭', 'Rechteck', '[', ']'],
  ['▢', 'Abgerundet', '(', ')'],
  ['◇', 'Entscheidung', '{', '}'],
  ['◯', 'Kreis', '((', '))'],
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
  const [styleOpen, setStyleOpen] = useState(false);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  // Inline-Umbenennen: Eingabefeld schwebt direkt ÜBER dem Schritt im Bild —
  // kein Browser-Dialog (User-Feedback M92)
  const [rename, setRename] = useState<{ nid: string; x: number; y: number; w: number; value: string } | null>(null);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const renderKey = useRef(0);
  const tplRef = useRef<HTMLElement | null>(null);
  const styleRef = useRef<HTMLElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(tplOpen, tplRef, () => { setTplOpen(false); setPendingTpl(null); });
  useOutsideClose(styleOpen, styleRef, () => setStyleOpen(false));

  const style = (data.style as string | undefined) ?? '';
  const look = (data.look as string | undefined) ?? '';
  const isFlow = /^\s*(flowchart|graph)\b/.test(data.code);

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
        .then((mermaid) => mermaid.render(`pn-mermaid-${id}-${myKey}`, buildMermaidSource(data.code, style, look)))
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
  // gemessen wird erst, wenn das neue SVG im DOM steht
  useEffect(() => {
    if (!svg || !fitOnRender.current) return;
    fitOnRender.current = false;
    fitToDiagram();
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

  // Karte abgewählt → Schritt-Auswahl, Verbinden-Modus, Popovers, Umbenennen aufräumen
  useEffect(() => {
    if (!selected) { setSelNode(null); setConnectFrom(null); setTplOpen(false); setStyleOpen(false); setPendingTpl(null); setRename(null); }
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
  /** Definition „id<Klammer>Label<Klammer>" im Code finden */
  const defRe = (nid: string) =>
    new RegExp(`(\\b${escapeRe(nid)})((?:\\(\\(|\\[|\\{|\\())([^\\]})]*)((?:\\)\\)|\\]|\\}|\\)))`);

  /** Label eines Schritts ersetzen — Klammerform ([…], {…}, ((…)), (…)) bleibt */
  const renameNode = (nid: string, label: string) => {
    const re = defRe(nid);
    if (re.test(data.code)) {
      updateNodeData(id, { code: data.code.replace(re, `$1$2${label}$4`) });
    } else {
      updateNodeData(id, { code: `${data.code}\n  ${nid}[${label}]` });
    }
  };

  /** Form eines Schritts wechseln (Klammern tauschen, Label bleibt) */
  const setShape = (nid: string, open: string, close: string) => {
    const re = defRe(nid);
    if (re.test(data.code)) {
      updateNodeData(id, { code: data.code.replace(re, `$1${open}$3${close}`) });
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
  };

  const onPreviewClick = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest?.('g.node, g.rough-node') as SVGGElement | null;
    if (!g || !isFlow) { setSelNode(null); setConnectFrom(null); return; }
    const nid = nodeIdOf(g);
    // Verbinden-Modus: zweiter Klick = Ziel → Pfeil ziehen
    if (connectFrom && nid && nid !== connectFrom) {
      updateNodeData(id, { code: `${data.code}\n  ${connectFrom} --> ${nid}` });
      setConnectFrom(null);
      setSelNode(nid);
      return;
    }
    setSelNode(nid);
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
    setRename({ nid, x, y, w, value: label });
  };

  const commitRename = () => {
    if (rename?.value.trim()) renameNode(rename.nid, rename.value.trim());
    setRename(null);
  };

  const onPreviewDblClick = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest?.('g.node, g.rough-node') as SVGGElement | null;
    if (!g || !isFlow) return;
    const nid = nodeIdOf(g);
    if (nid) startRename(nid);
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
      {/* Werkzeuge schweben UNTER dem Diagramm (die Auswahl-Toolbar liegt oben) */}
      <NodeToolbar isVisible={!!selected} position={Position.Bottom} offset={14} className="mm-toolbar nodrag">
        {selNode ? (
          <div className="mm-row">
            <span className="mm-sel-name">„{selNode}"</span>
            <button onClick={renameSelected}>✎ Umbenennen</button>
            <button onClick={() => addStepAfter(selNode)}>＋ Danach</button>
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
            <button className="danger" onClick={() => removeNode(selNode)}>Entfernen</button>
            <button onClick={() => { setSelNode(null); setConnectFrom(null); }} title="Schritt-Auswahl aufheben">✕</button>
          </div>
        ) : (
          <div className="mm-row">
            <span className="mm-pop-wrap" ref={tplRef}>
              <button className={tplOpen ? 'active' : ''} title="Vorlage wählen" onClick={() => { setTplOpen((o) => !o); setStyleOpen(false); }}>Vorlage ▾</button>
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
            <span className="mm-pop-wrap" ref={styleRef}>
              <button className={styleOpen ? 'active' : ''} title="Stil: Farbschema, Handschrift-Look, Richtung" onClick={() => { setStyleOpen((o) => !o); setTplOpen(false); }}>Stil ▾</button>
              {styleOpen && (
                <div className="mm-pop mm-style-pop">
                  <div className="mm-pop-label">Farbschema</div>
                  <div className="mm-dots">
                    <button className={`mm-dot mm-dot-none ${!style ? 'on' : ''}`} title="Standard" onClick={() => updateNodeData(id, { style: undefined })} />
                    {Object.entries(MERMAID_STYLES).map(([k, s]) => (
                      <button key={k} className={`mm-dot ${style === k ? 'on' : ''}`} style={{ background: s.dot }} title={s.label} onClick={() => updateNodeData(id, { style: k })} />
                    ))}
                  </div>
                  <div className="mm-pop-label">Zeichenstil</div>
                  <button className={look === 'hand' ? 'active' : ''} onClick={() => updateNodeData(id, { look: look === 'hand' ? undefined : 'hand' })}>
                    ✏️ Handgezeichnet {look === 'hand' ? 'AUS' : 'AN'}
                  </button>
                  {isFlow && (
                    <>
                      <div className="mm-pop-label">Richtung</div>
                      <button onClick={toggleDirection}>⇄ Oben/unten ⇄ links/rechts</button>
                    </>
                  )}
                </div>
              )}
            </span>
            {isFlow && (
              <button title="Neuen Schritt anfügen (an den ausgewählten, sonst frei)" onClick={() => addStepAfter(selNode)}>＋ Schritt</button>
            )}
            <button title="Kartengröße einmalig an das Diagramm anpassen" onClick={() => fitToDiagram()}>⤢ Einpassen</button>
            <button
              className={edit ? 'active' : ''}
              title="Mermaid-Code anzeigen/bearbeiten (für Profis)"
              onClick={() => { const next = !edit; setEdit(next); fitToDiagram(next); }}
            >‹/›</button>
          </div>
        )}
        {aiReady(ai) && (
          <div className="mm-row mm-ai-row">
            <input
              value={aiText}
              disabled={aiBusy}
              placeholder={data.code.trim() ? '✨ Änderung beschreiben — z. B. „füge eine Prüfung ein"' : '✨ Diagramm beschreiben — z. B. „Urlaubsantrag-Prozess"'}
              onChange={(e) => setAiText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runAi(); }}
            />
            <button disabled={aiBusy || !aiText.trim()} onClick={() => void runAi()}>{aiBusy ? '…' : '✨'}</button>
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
        <div className="mermaid-preview nowheel" ref={previewRef} onClick={onPreviewClick} onDoubleClick={onPreviewDblClick}>
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
          {isFlow && !error && !connectFrom && selected && (
            <div className="mm-hint">Klick auf einen Schritt = bearbeiten · Doppelklick = umbenennen</div>
          )}
        </div>
      </div>
    </CardShell>
  );
}
