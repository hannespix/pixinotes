// mermaid ist groß → nur laden, wenn wirklich ein Diagramm gebraucht wird.
// Geteilt zwischen Mermaid-Karte und Präsentations-Folie.
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

export function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
      return m.default;
    });
  }
  return mermaidPromise;
}

export const MERMAID_TEMPLATES: Record<string, string> = {
  Flow: 'flowchart TD\n  A[Start] --> B{Entscheidung}\n  B -->|Ja| C[Schritt]\n  B -->|Nein| D[Ende]',
  Sequenz: 'sequenceDiagram\n  Alice->>Bob: Anfrage\n  Bob-->>Alice: Antwort',
  Gantt: 'gantt\n  title Projektplan\n  section Phase 1\n  Aufgabe A :a1, 2026-07-01, 7d\n  Aufgabe B :after a1, 5d',
};
