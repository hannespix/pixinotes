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
        .then((mermaid) => mermaid.render(`pn-mermaid-${id}`, data.code))
        .then(({ svg }) => { if (!cancelled && myKey === renderKey.current) { setSvg(svg); setError(''); } })
        .catch((e) => { if (!cancelled && myKey === renderKey.current) setError(String(e?.message ?? e).split('\n')[0]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [data.code, id]);

  return (
    <CardShell id={id} selected={selected} minWidth={280} minHeight={180} className="mermaid-card">
      <div className="mermaid-head">
        <span>📊 Diagramm</span>
        <div className="mermaid-tools nodrag">
          {Object.keys(TEMPLATES).map((t) => (
            <button key={t} title={`Vorlage ${t}`} onClick={() => updateNodeData(id, { code: TEMPLATES[t] })}>{t}</button>
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
          {error ? (
            <div className="mermaid-error">⚠️ {error}</div>
          ) : (
            <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          )}
        </div>
      </div>
    </CardShell>
  );
}
