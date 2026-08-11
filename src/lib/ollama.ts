/**
 * M257: Welche Modelle hat der lokale Server wirklich?
 *
 * Bisher standen in den Einstellungen vier fest verdrahtete Namen
 * (llama3.1, mistral, qwen2.5, phi3). Das ist gleich doppelt falsch: Wer
 * `gemma3:12b` installiert hat, fand es nicht — und wer eines der vier
 * NICHT installiert hat, bekam beim Abschicken nur ein „HTTP 404".
 *
 * Ollama beantwortet die Frage selbst: `GET /api/tags` listet, was auf dem
 * Rechner liegt. OpenAI-kompatible Server (llama.cpp, LM Studio, vLLM,
 * LocalAI …) tun dasselbe über `GET /v1/models`. Gefragt wird also den
 * Server, nicht eine Liste im Quelltext.
 *
 * Die Vorschlagsliste weiter unten bleibt trotzdem — aber nur als das, was
 * sie ist: eine Starthilfe mit dem passenden `ollama pull`-Befehl, wenn noch
 * gar nichts installiert ist.
 */

export interface OllamaModell {
  /** Voller Name samt Variante, z. B. „gemma3:12b" */
  name: string;
  /** Größe auf der Platte in Bytes (0 = unbekannt) */
  bytes: number;
  /** Parameterzahl laut Server, z. B. „12,2B" */
  groesse?: string;
  /** Quantisierung, z. B. „Q4_K_M" */
  quant?: string;
}

/**
 * Einbettungs-Modelle taugen nicht zum Antworten und umgekehrt.
 *
 * Ollama sagt im Verzeichnis nicht, wozu ein Modell da ist. Die Namen sind
 * aber eindeutig genug: Alles mit „embed" im Namen (plus die bekannten
 * Ausnahmen bge/gte/e5/minilm) ist ein Einbettungs-Modell. Getrennt gezeigt
 * erspart das den Griff ins falsche Regal — ein Chat mit nomic-embed-text
 * endet sonst in einer Fehlermeldung, die niemand erklärt.
 */
export function istEinbettungsModell(name: string): boolean {
  return /embed|bge-|gte-|e5-|minilm|arctic/i.test(name);
}

/** Bytes → „7,4 GB" */
export function zeigeGroesse(bytes: number): string {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1
    ? `${gb.toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;
}

const TIMEOUT_MS = 8000;

/** Gemeinsamer Fehlertext — die drei Ursachen, die es praktisch immer sind */
function deuteFehler(e: unknown, url: string): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(m)) return `Keine Antwort von ${url} (Zeitüberschreitung). Läuft der Server?`;
  // Ein fehlgeschlagenes fetch ohne HTTP-Status heißt im Browser fast immer:
  // Server nicht erreichbar ODER CORS verweigert. Beides ist hier lösbar.
  if (/failed to fetch|networkerror|load failed/i.test(m)) {
    return `${url} nicht erreichbar. Entweder läuft „ollama serve" nicht — oder der Browser darf nicht zugreifen. `
      + 'Dann Ollama mit OLLAMA_ORIGINS="*" starten (unter Windows als Systemvariable setzen und Ollama neu starten).';
  }
  return m;
}

/** Alle installierten Ollama-Modelle — direkt vom Server */
export async function holeOllamaModelle(baseUrl: string): Promise<OllamaModell[]> {
  const base = baseUrl.replace(/\/$/, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} von ${base}/api/tags`);
    const data = await res.json();
    const liste = Array.isArray(data?.models) ? data.models : [];
    return liste
      .map((m: Record<string, unknown>) => ({
        name: String(m.name ?? m.model ?? ''),
        bytes: Number(m.size ?? 0),
        groesse: (m.details as Record<string, string> | undefined)?.parameter_size,
        quant: (m.details as Record<string, string> | undefined)?.quantization_level,
      }))
      .filter((m: OllamaModell) => m.name)
      .sort((a: OllamaModell, b: OllamaModell) => a.name.localeCompare(b.name, 'de'));
  } catch (e) {
    throw new Error(deuteFehler(e, base));
  } finally {
    clearTimeout(t);
  }
}

/**
 * Modelle eines OpenAI-kompatiblen Servers (llama.cpp, LM Studio, vLLM …).
 * Dieselbe Idee, anderer Pfad — und der Schlüssel ist dort oft optional.
 */
export async function holeOpenAiModelle(baseUrl: string, apiKey?: string): Promise<OllamaModell[]> {
  const base = baseUrl.replace(/\/$/, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/models`, {
      signal: ctrl.signal,
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} von ${base}/models`);
    const data = await res.json();
    const liste = Array.isArray(data?.data) ? data.data : [];
    return liste
      .map((m: Record<string, unknown>) => ({ name: String(m.id ?? ''), bytes: 0 }))
      .filter((m: OllamaModell) => m.name)
      .sort((a: OllamaModell, b: OllamaModell) => a.name.localeCompare(b.name, 'de'));
  } catch (e) {
    throw new Error(deuteFehler(e, base));
  } finally {
    clearTimeout(t);
  }
}

export interface Vorschlag {
  name: string;
  /** Ungefährer Platzbedarf — die Zahl, die über „läuft das hier?" entscheidet */
  platz: string;
  zweck: string;
}

/**
 * Starthilfe, KEINE abschließende Liste.
 *
 * Was es bei Ollama gibt, ändert sich schneller, als eine App aktualisiert
 * wird. Deshalb steht hier nur eine Handvoll gängiger Modelle mit dem, was
 * man vorher wissen will — wie viel Platz und wofür. Alles andere aus
 * ollama.com/library funktioniert genauso: Namen eintippen, fertig.
 */
export const VORSCHLAEGE: Vorschlag[] = [
  { name: 'gemma3:12b', platz: '~8 GB', zweck: 'Googles Mittelklasse, sehr gutes Deutsch — versteht auch Bilder' },
  { name: 'gemma3:4b', platz: '~3 GB', zweck: 'dieselbe Familie für schwächere Rechner und Notebooks' },
  { name: 'gemma3:27b', platz: '~17 GB', zweck: 'die große Fassung — braucht eine kräftige Grafikkarte' },
  { name: 'qwen3:14b', platz: '~9 GB', zweck: 'stark bei Struktur und Aufzählungen, denkt vor dem Antworten' },
  { name: 'qwen3:8b', platz: '~5 GB', zweck: 'flott und genügsam, guter Allrounder' },
  { name: 'llama3.1:8b', platz: '~5 GB', zweck: 'der bewährte Klassiker von Meta' },
  { name: 'llama3.2:3b', platz: '~2 GB', zweck: 'sehr klein — läuft zur Not auch ohne Grafikkarte' },
  { name: 'mistral-small', platz: '~14 GB', zweck: 'europäisches Modell, kräftig im Deutschen' },
  { name: 'phi4', platz: '~9 GB', zweck: 'Microsofts kompaktes Modell, stark im Schlussfolgern' },
  { name: 'deepseek-r1:14b', platz: '~9 GB', zweck: 'Denkmodell — langsamer, dafür sorgfältiger' },
];

/** Einbettungs-Modelle fürs Gehirn (M204) */
export const EINBETTUNGS_VORSCHLAEGE: Vorschlag[] = [
  { name: 'nomic-embed-text', platz: '~280 MB', zweck: 'bewährt, klein, mehrsprachig — die Voreinstellung' },
  { name: 'mxbai-embed-large', platz: '~670 MB', zweck: 'genauer, dafür größer und langsamer' },
  { name: 'bge-m3', platz: '~1,2 GB', zweck: 'ausdrücklich mehrsprachig, gut für deutsche Texte' },
  { name: 'all-minilm', platz: '~45 MB', zweck: 'winzig und schnell, dafür grober' },
];
