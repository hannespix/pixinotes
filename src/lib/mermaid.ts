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
import { askAi } from './ai';

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

// ---------------------------------------------------------------------------
// Farbschemata (M91): pro Diagramm wählbar, hell/dunkel je eigene Werte.
// Umgesetzt als init-Direktive (theme base + themeVariables) — der Code der
// Karte bleibt sauber, der Stil liegt als eigenes Datenfeld daneben.
export const MERMAID_STYLES: Record<string, { label: string; dot: string; light: Record<string, string>; dark: Record<string, string> }> = {
  blau: {
    label: 'Blau', dot: '#4a7dbd',
    light: { primaryColor: '#dbe9f8', primaryBorderColor: '#4a7dbd', primaryTextColor: '#1c3350', lineColor: '#4a7dbd', secondaryColor: '#eef4fb', tertiaryColor: '#f6f9fd' },
    dark: { primaryColor: '#243b57', primaryBorderColor: '#6fa3dd', primaryTextColor: '#dce9f8', lineColor: '#6fa3dd', secondaryColor: '#1d2c40', tertiaryColor: '#182433' },
  },
  gruen: {
    label: 'Grün', dot: '#4d8f5a',
    light: { primaryColor: '#ddf0e0', primaryBorderColor: '#4d8f5a', primaryTextColor: '#1e3a25', lineColor: '#4d8f5a', secondaryColor: '#edf7ef', tertiaryColor: '#f6fbf7' },
    dark: { primaryColor: '#25422b', primaryBorderColor: '#72b981', primaryTextColor: '#dcf0e0', lineColor: '#72b981', secondaryColor: '#1d3322', tertiaryColor: '#18281c' },
  },
  bernstein: {
    label: 'Bernstein', dot: '#c08a2d',
    light: { primaryColor: '#faeecf', primaryBorderColor: '#c08a2d', primaryTextColor: '#4a3510', lineColor: '#c08a2d', secondaryColor: '#fcf5e3', tertiaryColor: '#fefaf1' },
    dark: { primaryColor: '#4a3a17', primaryBorderColor: '#dfa94a', primaryTextColor: '#f8ecd0', lineColor: '#dfa94a', secondaryColor: '#3a2e14', tertiaryColor: '#2c2310' },
  },
  violett: {
    label: 'Violett', dot: '#7d5bb8',
    light: { primaryColor: '#e9e1f7', primaryBorderColor: '#7d5bb8', primaryTextColor: '#32234f', lineColor: '#7d5bb8', secondaryColor: '#f2edfa', tertiaryColor: '#f9f6fd' },
    dark: { primaryColor: '#3a2b57', primaryBorderColor: '#a181e0', primaryTextColor: '#e9e1f7', lineColor: '#a181e0', secondaryColor: '#2d2244', tertiaryColor: '#231a35' },
  },
  kontrast: {
    label: 'Kontrast', dot: '#2b2a27',
    light: { primaryColor: '#ffffff', primaryBorderColor: '#2b2a27', primaryTextColor: '#111111', lineColor: '#2b2a27', secondaryColor: '#f0f0f0', tertiaryColor: '#fafafa' },
    dark: { primaryColor: '#111111', primaryBorderColor: '#e8e5df', primaryTextColor: '#f4f2ee', lineColor: '#e8e5df', secondaryColor: '#1f1f1f', tertiaryColor: '#181818' },
  },
};

/** Vollständige Render-Quelle: Stil-/Look-Direktive + Code der Karte */
export function buildMermaidSource(code: string, style?: string, look?: string): string {
  const dark = document.documentElement.dataset.theme === 'dark';
  const init: Record<string, unknown> = {};
  const s = style ? MERMAID_STYLES[style] : undefined;
  if (s) {
    init.theme = 'base';
    init.themeVariables = dark ? s.dark : s.light;
  }
  if (look === 'hand') init.look = 'handDrawn';
  if (Object.keys(init).length === 0) return code;
  return `%%{init: ${JSON.stringify(init)}}%%\n${code}`;
}

/** ```-Zäune und Geplauder aus KI-Antworten entfernen — es zählt nur der Code */
function stripFences(raw: string): string {
  const fenced = raw.match(/```(?:mermaid)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : raw).trim();
}

/** KI-Diagramm (M91): Beschreibung/Anweisung → validierter Mermaid-Code.
 *  Ungültige Antworten werden EINMAL mit der Fehlermeldung zur Reparatur
 *  zurückgegeben (gleiches Muster wie der JSON-Reparatur-Retry, M42). */
export async function aiMermaid(instruction: string, currentCode: string): Promise<string> {
  const hasCode = currentCode.trim().length > 0;
  const prompt = [
    'Du bist Experte für Mermaid-Diagramme (Version 11).',
    hasCode
      ? `Ändere das folgende Mermaid-Diagramm gemäß der Anweisung.\nAktueller Code:\n\`\`\`mermaid\n${currentCode}\n\`\`\``
      : 'Erstelle ein Mermaid-Diagramm gemäß der Beschreibung. Wähle selbst den passendsten Typ (flowchart TD, sequenceDiagram, gantt, mindmap, pie, stateDiagram-v2, timeline, quadrantChart).',
    `Anweisung: ${instruction}`,
    'Antworte AUSSCHLIESSLICH mit dem vollständigen, gültigen Mermaid-Code — ohne Erklärungen, ohne ```-Zaun. Beschriftungen auf Deutsch, kompakt und fachlich sauber.',
  ].join('\n\n');
  const m = await getMermaid();
  let code = stripFences(await askAi(prompt));
  try {
    await m.parse(code);
  } catch (e) {
    const err = String((e as Error)?.message ?? e).split('\n').slice(0, 3).join(' ');
    code = stripFences(await askAi(
      `Dieser Mermaid-Code ist fehlerhaft.\nCode:\n\`\`\`mermaid\n${code}\n\`\`\`\nFehlermeldung: ${err}\nGib den korrigierten, vollständigen Mermaid-Code zurück — NUR den Code, ohne Erklärungen.`,
    ));
    await m.parse(code); // wirft bei erneutem Fehler → Karte zeigt die Meldung
  }
  return code;
}

export { MERMAID_TEMPLATES, LEGACY_MERMAID_DEFAULT } from './mermaidTemplates';
