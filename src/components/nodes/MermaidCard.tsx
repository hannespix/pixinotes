import { useEffect, useRef, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { MermaidNode } from '../../types';
import { getMermaid, MERMAID_TEMPLATES as TEMPLATES } from '../../lib/mermaid';
import { CardShell } from './CardShell';

/**
 * Mermaid-Diagramm mit Live-Vorschau (WYSIWYG-nah): links Code, rechts
 * gerendertes Diagramm, das bei jeder Änderung sofort aktualisiert. Vorlagen
 * für Flowchart/Sequenz/Gantt. Ideal fürs Prozessmanagement.
 */
export function MermaidCard({ id, data, selected }: NodeProps<MermaidNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const uiTheme = useBoard((s) => s.ui.theme); // Diagramm folgt Hell/Dunkel
  const [edit, setEdit] = useState(true);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const renderKey = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const myKey = ++renderKey.current;
    // Stabile Render-ID pro Karte + kleines Debounce, damit nicht jeder
    // Tastendruck einen (oft ungültigen) Zwischenstand rendert (Audit).
    const t = setTimeout(() => {
      getMermaid()
        // Render-ID pro VERSUCH eindeutig: mermaid räumt vor dem Rendern alle
        // Elemente mit derselben ID weg — mit stabiler ID löscht ein
        // fehlgeschlagener Versuch sonst das angezeigte SVG aus dem DOM (M90)
        .then((mermaid) => mermaid.render(`pn-mermaid-${id}-${myKey}`, data.code))
        .then(({ svg }) => { if (!cancelled && myKey === renderKey.current) { setSvg(svg); setError(''); } })
        // WICHTIG: svg NICHT leeren — beim Tippen bleibt so das letzte gültige
        // Diagramm sichtbar, der Fehler erscheint nur als kleines Overlay (M90)
        .catch((e) => { if (!cancelled && myKey === renderKey.current) setError(String(e?.message ?? e).split('\n')[0]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [data.code, id, uiTheme]);

  /** Vorlage laden — eigenen Code nicht durch einen Fehlklick verlieren */
  const applyTemplate = (t: string) => {
    const isPristine = !data.code.trim() || Object.values(TEMPLATES).includes(data.code);
    if (!isPristine && !window.confirm(`Aktuellen Diagramm-Code durch die Vorlage „${t}" ersetzen?`)) return;
    updateNodeData(id, { code: TEMPLATES[t] });
  };

  return (
    <CardShell id={id} selected={selected} minWidth={280} minHeight={180} className="mermaid-card">
      <div className="mermaid-head">
        <span>Diagramm</span>
        <div className="mermaid-tools nodrag">
          {Object.keys(TEMPLATES).map((t) => (
            <button key={t} title={`Vorlage ${t}`} onClick={() => applyTemplate(t)}>{t}</button>
          ))}
          <button className={edit ? 'active' : ''} title="Code/Vorschau" onClick={() => setEdit((e) => !e)}>‹/›</button>
        </div>
      </div>
      <div className="mermaid-split">
        {edit && (
          <textarea
            className="mermaid-code nodrag nowheel"
            value={data.code}
            spellCheck={false}
            onChange={(e) => updateNodeData(id, { code: e.target.value })}
          />
        )}
        <div className="mermaid-preview nowheel">
          <div className={`mermaid-svg ${error ? 'stale' : ''}`} dangerouslySetInnerHTML={{ __html: svg }} />
          {error && (
            <div className="mermaid-error" title={error}>
              ⚠️ {svg ? 'Code unvollständig — letztes gültiges Diagramm bleibt sichtbar' : error}
            </div>
          )}
        </div>
      </div>
    </CardShell>
  );
}
