import { useEffect, useRef, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { MermaidNode } from '../../types';
import { CardShell } from './CardShell';

// mermaid ist groß → nur laden, wenn wirklich ein Diagramm auf dem Board ist
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
      return m.default;
    });
  }
  return mermaidPromise;
}

const TEMPLATES: Record<string, string> = {
  Flow: 'flowchart TD\n  A[Start] --> B{Entscheidung}\n  B -->|Ja| C[Schritt]\n  B -->|Nein| D[Ende]',
  Sequenz: 'sequenceDiagram\n  Alice->>Bob: Anfrage\n  Bob-->>Alice: Antwort',
  Gantt: 'gantt\n  title Projektplan\n  section Phase 1\n  Aufgabe A :a1, 2026-07-01, 7d\n  Aufgabe B :after a1, 5d',
};

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
