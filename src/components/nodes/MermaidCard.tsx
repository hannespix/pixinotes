import { useEffect, useRef, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { MermaidNode } from '../../types';
import { aiReady } from '../../lib/ai';
import { aiMermaid, buildMermaidSource, getMermaid, MERMAID_STYLES, MERMAID_TEMPLATES as TEMPLATES } from '../../lib/mermaid';
import { useOutsideClose } from '../../lib/useOutsideClose';
import { CardShell } from './CardShell';

/**
 * Diagramm-Karte (M91, „natürlicher"): Standard ist die reine Vorschau —
 * Flowchart-Knoten werden DIREKT im Diagramm bearbeitet (Klick → Aktionen,
 * Doppelklick → Umbenennen), Stil/Farben/Richtung über ein Menü, der rohe
 * Code bleibt als Experten-Ansicht hinter ‹/›. Die KI-Zeile unten erzeugt
 * oder ändert das Diagramm aus natürlicher Sprache (validiert + Auto-Reparatur).
 */
export function MermaidCard({ id, data, selected }: NodeProps<MermaidNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const ai = useBoard((s) => s.ai);
  const uiTheme = useBoard((s) => s.ui.theme); // Diagramm folgt Hell/Dunkel
  const [edit, setEdit] = useState(false);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [tplOpen, setTplOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const renderKey = useRef(0);
  const tplRef = useRef<HTMLElement | null>(null);
  const styleRef = useRef<HTMLElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(tplOpen, tplRef, () => setTplOpen(false));
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

  // Ausgewählten Flowchart-Knoten im SVG markieren (Klasse aufs <g>)
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    root.querySelectorAll('g.mm-selected').forEach((g) => g.classList.remove('mm-selected'));
    if (!selNode) return;
    root.querySelectorAll('g.node, g.rough-node').forEach((g) => {
      if (nodeIdOf(g as SVGGElement) === selNode) g.classList.add('mm-selected');
    });
  }, [selNode, svg]);

  /** Vorlage laden — eigenen Code nicht durch einen Fehlklick verlieren */
  const applyTemplate = (t: string) => {
    setTplOpen(false);
    const isPristine = !data.code.trim() || Object.values(TEMPLATES).includes(data.code);
    if (!isPristine && !window.confirm(`Aktuellen Diagramm-Code durch die Vorlage „${t}" ersetzen?`)) return;
    setSelNode(null);
    updateNodeData(id, { code: TEMPLATES[t] });
  };

  // ---------- WYSIWYG: Flowchart-Knoten direkt bearbeiten ----------
  /** mermaid-Element-ID → Knoten-ID im Code. Format ist
   *  „<render-id>-flowchart-<knoten>-<laufnr>" — Präfix und Laufnummer weg */
  const nodeIdOf = (g: SVGGElement): string | null => {
    const m = /flowchart-(.+)-\d+$/.exec(g.id ?? '');
    return m ? m[1] : null;
  };

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Label eines Knotens ersetzen — Klammerform ([…], {…}, ((…)), (…)) bleibt */
  const renameNode = (nid: string, label: string) => {
    const re = new RegExp(`(\\b${escapeRe(nid)})((?:\\(\\(|\\[|\\{|\\())([^\\]})]*)((?:\\)\\)|\\]|\\}|\\)))`);
    if (re.test(data.code)) {
      updateNodeData(id, { code: data.code.replace(re, `$1$2${label}$4`) });
    } else {
      updateNodeData(id, { code: `${data.code}\n  ${nid}[${label}]` });
    }
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
    if (!g || !isFlow) { setSelNode(null); return; }
    setSelNode(nodeIdOf(g));
  };

  const onPreviewDblClick = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest?.('g.node, g.rough-node') as SVGGElement | null;
    if (!g || !isFlow) return;
    const nid = nodeIdOf(g);
    if (!nid) return;
    const current = (g.textContent ?? '').trim();
    const next = window.prompt('Beschriftung des Schritts:', current);
    if (next?.trim()) renameNode(nid, next.trim());
  };

  const renameSelected = () => {
    if (!selNode) return;
    const next = window.prompt('Beschriftung des Schritts:');
    if (next?.trim()) renameNode(selNode, next.trim());
  };

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
    <CardShell id={id} selected={selected} minWidth={300} minHeight={200} className="mermaid-card">
      <div className="mermaid-head">
        <span>Diagramm</span>
        <div className="mermaid-tools nodrag">
          <span className="mm-pop-wrap" ref={tplRef}>
            <button className={tplOpen ? 'active' : ''} title="Vorlage wählen" onClick={() => { setTplOpen((o) => !o); setStyleOpen(false); }}>Vorlage ▾</button>
            {tplOpen && (
              <div className="mm-pop">
                {Object.keys(TEMPLATES).map((t) => (
                  <button key={t} onClick={() => applyTemplate(t)}>{t}</button>
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
            <button title="Neuen Schritt anfügen (an den ausgewählten Knoten, sonst frei)" onClick={() => addStepAfter(selNode)}>＋ Schritt</button>
          )}
          <button className={edit ? 'active' : ''} title="Mermaid-Code anzeigen/bearbeiten (für Profis)" onClick={() => setEdit((e) => !e)}>‹/›</button>
        </div>
      </div>
      {selNode && (
        <div className="mm-node-bar nodrag">
          <span>„{selNode}"</span>
          <button onClick={renameSelected}>✎ Umbenennen</button>
          <button onClick={() => addStepAfter(selNode)}>＋ Schritt danach</button>
          <button className="danger" onClick={() => removeNode(selNode)}>Entfernen</button>
          <button onClick={() => setSelNode(null)} title="Auswahl aufheben">✕</button>
        </div>
      )}
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
          {error && (
            <div className="mermaid-error" title={error}>
              ⚠️ {svg ? 'Code unvollständig — letztes gültiges Diagramm bleibt sichtbar' : error}
            </div>
          )}
          {isFlow && !error && (
            <div className="mm-hint">Klick auf einen Schritt = bearbeiten · Doppelklick = umbenennen</div>
          )}
        </div>
      </div>
      {aiReady(ai) && (
        <div className="mermaid-ai nodrag">
          <input
            value={aiText}
            disabled={aiBusy}
            placeholder={data.code.trim() ? '✨ Änderung beschreiben — z. B. „füge nach der Entscheidung eine Prüfung ein"' : '✨ Diagramm beschreiben — z. B. „Urlaubsantrag-Prozess mit Genehmigung"'}
            onChange={(e) => setAiText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runAi(); }}
          />
          <button disabled={aiBusy || !aiText.trim()} onClick={() => void runAi()}>{aiBusy ? '…' : '✨'}</button>
        </div>
      )}
    </CardShell>
  );
}
