// Mermaid als KOMPLETT-Bundle einbetten (M90): Die normale ESM-Variante lädt
// Diagrammtypen (Mindmap, Kreis, Status …) zur Laufzeit als gehashte Chunks
// nach — nach jedem Deploy existieren die alten Chunk-Namen nicht mehr, und
// laufende/PWA-gecachte Sitzungen bekommen beim Vorlagen-Klick „Failed to
// fetch dynamically imported module" (User-Screenshots).
//
// Deshalb: das IIFE-Vollbundle als ROHTEXT mitliefern (?raw) und beim ersten
// Bedarf als klassisches <script> injizieren. Warum nicht einfach importieren?
// Das IIFE endet mit `globalThis.__esbuild_esm_mermaid_nm…` — als ES-Modul
// gebündelt ist diese var aber modul-scoped statt global und der Zugriff
// crasht. Als klassisches Script sind var-Deklarationen global, genau wie
// vom Bundle erwartet. Bonus: geparst wird erst, wenn wirklich ein Diagramm
// gebraucht wird — Boards ohne Diagramme zahlen nichts.
import mermaidSource from 'mermaid/dist/mermaid.min.js?raw';

type MermaidApi = typeof import('mermaid').default;

let initializedTheme: string | null = null;

function ensureLoaded(): MermaidApi {
  const w = globalThis as unknown as { mermaid?: MermaidApi };
  if (!w.mermaid) {
    const s = document.createElement('script');
    s.textContent = mermaidSource;
    document.head.appendChild(s); // führt synchron aus und setzt globalThis.mermaid
    s.remove();
  }
  return w.mermaid!;
}

/** Promise-API beibehalten (Karte + Presenter-Folien nutzen sie bereits) */
export function getMermaid(): Promise<MermaidApi> {
  const m = ensureLoaded();
  // Theme folgt dem App-Design; bei Wechsel neu initialisieren (dark ⇄ neutral)
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'neutral';
  if (theme !== initializedTheme) {
    m.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
    initializedTheme = theme;
  }
  return Promise.resolve(m);
}

export const MERMAID_TEMPLATES: Record<string, string> = {
  Flow: 'flowchart TD\n  A[Start] --> B{Entscheidung}\n  B -->|Ja| C[Schritt]\n  B -->|Nein| D[Ende]',
  Sequenz: 'sequenceDiagram\n  Alice->>Bob: Anfrage\n  Bob-->>Alice: Antwort',
  Gantt: 'gantt\n  title Projektplan\n  section Phase 1\n  Aufgabe A :a1, 2026-07-01, 7d\n  Aufgabe B :after a1, 5d',
  Mindmap: 'mindmap\n  root((Projekt))\n    Ziele\n      Umsatz\n      Qualität\n    Team\n      Rollen\n    Risiken',
  Kreis: 'pie showData\n  title Verteilung\n  "Vorbereitung" : 20\n  "Umsetzung" : 55\n  "Abnahme" : 25',
  Status: 'stateDiagram-v2\n  [*] --> Entwurf\n  Entwurf --> Review\n  Review --> Freigabe : ok\n  Review --> Entwurf : Änderungen\n  Freigabe --> [*]',
  Zeitstrahl: 'timeline\n  title Projektverlauf\n  2026 Q1 : Konzept : Abstimmung\n  2026 Q2 : Umsetzung\n  2026 Q3 : Pilot : Schulung\n  2026 Q4 : Rollout',
  Quadrant: 'quadrantChart\n  title Priorisierung\n  x-axis "Geringer Aufwand" --> "Hoher Aufwand"\n  y-axis "Geringer Nutzen" --> "Hoher Nutzen"\n  quadrant-1 "Sofort machen"\n  quadrant-2 "Einplanen"\n  quadrant-3 "Verwerfen"\n  quadrant-4 "Nebenbei"\n  "Portal-Relaunch": [0.7, 0.85]\n  "Ablage aufräumen": [0.25, 0.4]\n  "Neues Formular": [0.3, 0.75]',
};
