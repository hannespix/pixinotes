// Diagramm-Vorlagen in eigenem, leichtem Modul: wird auch von der
// Karten-Fabrik (nodes.ts) gebraucht — die soll das Mermaid-Bundle-Modul
// (mermaid.ts mit ?raw-Vollbundle + KI-Import) nicht mitziehen.
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

/** Standard-Code älterer Karten (vor M92) — zählt weiter als „unberührt",
 *  damit der Vorlagen-Wechsel dort keine Bestätigung verlangt. */
export const LEGACY_MERMAID_DEFAULT =
  'flowchart TD\n  A[Start] --> B{Prüfen}\n  B -->|OK| C[Fertig]\n  B -->|Fehler| A';
