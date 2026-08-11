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

/**
 * M258: „läuft nicht" und „darf nicht" sind zwei verschiedene Dinge.
 *
 * Ein blockierter Zugriff sieht im Browser exakt aus wie ein toter Server:
 * beide Male nur „TypeError: Failed to fetch", ohne Status, ohne Grund. Die
 * alte Meldung nannte deshalb beide Ursachen in einem Satz — und stellte die
 * falsche nach vorn. Wer im Terminal gerade nachgewiesen hat, dass Ollama
 * läuft, sucht dann an der falschen Stelle weiter.
 *
 * Die Unterscheidung ist aber möglich: Eine zweite Anfrage mit
 * `mode: 'no-cors'` verzichtet auf das Lesen der Antwort. Kommt sie durch
 * (undurchsichtige Antwort), war das Netz in Ordnung und nur die Erlaubnis
 * fehlte. Scheitert auch sie, lauscht dort wirklich niemand.
 */
export type Lage = 'ok' | 'verboten' | 'weg' | 'fehler';

async function erreichbar(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    await fetch(url, { mode: 'no-cors', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Welches Betriebssystem sitzt davor? Für die passende Anleitung. */
export function system(): 'linux' | 'mac' | 'windows' | 'sonst' {
  const s = `${navigator.userAgent} ${navigator.platform ?? ''}`.toLowerCase();
  if (/android/.test(s)) return 'sonst';
  if (/linux|x11/.test(s)) return 'linux';
  if (/mac|iphone|ipad/.test(s)) return 'mac';
  if (/win/.test(s)) return 'windows';
  return 'sonst';
}

/**
 * Die Anleitung, die zu DIESEM Rechner und DIESER Seite passt.
 *
 * Statt „*" wird die eigene Herkunft vorgeschlagen: Damit darf genau diese
 * Seite an Ollama — und nicht jede beliebige, die man später einmal öffnet.
 * Bei einer lokal geöffneten Datei (file://) meldet der Browser die Herkunft
 * „null"; dort hilft nur „*", und das steht dann auch so da.
 */
export function erlaubnisHilfe(): { herkunft: string; befehle: string[]; hinweis: string } {
  const herkunft = window.location.origin === 'null' || window.location.protocol === 'file:'
    ? '*' : window.location.origin;
  const wert = `OLLAMA_ORIGINS=${herkunft}`;
  const hinweis = herkunft === '*'
    ? 'Die Seite wurde als lokale Datei geöffnet — sie hat dann keine benennbare Herkunft, deshalb hier „*".'
    : 'So darf genau diese Seite an Ollama — keine andere.';
  switch (system()) {
    case 'linux':
      return { herkunft, hinweis, befehle: [
        'sudo systemctl edit ollama',
        '# in den Editor eintragen:',
        '[Service]',
        `Environment="${wert}"`,
        'sudo systemctl daemon-reload && sudo systemctl restart ollama',
        '# ohne systemd stattdessen:  ' + `${wert} ollama serve`,
      ] };
    case 'mac':
      return { herkunft, hinweis, befehle: [
        `launchctl setenv OLLAMA_ORIGINS "${herkunft}"`,
        '# danach Ollama beenden und neu starten',
      ] };
    case 'windows':
      return { herkunft, hinweis, befehle: [
        `setx OLLAMA_ORIGINS "${herkunft}"`,
        '# danach Ollama komplett beenden (Symbol in der Taskleiste) und neu starten',
      ] };
    default:
      return { herkunft, hinweis, befehle: [`${wert} ollama serve`] };
  }
}

/** Fehlertext für alles, was keine Erlaubnisfrage ist */
function deuteFehler(e: unknown, url: string): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(m)) return `Keine Antwort von ${url} (Zeitüberschreitung).`;
  return m;
}

export interface Befund {
  lage: Lage;
  modelle: OllamaModell[];
  /** Nur bei lage === 'fehler' gefüllt */
  text?: string;
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

/**
 * Modelle holen UND im Fehlerfall herausfinden, woran es lag.
 *
 * Das ist der Einstiegspunkt für die Einstellungen: Er liefert entweder die
 * Liste — oder eine Lage, zu der es eine brauchbare Anleitung gibt, statt
 * eines Fehlertexts, der alle Möglichkeiten aufzählt und keine benennt.
 */
export async function befrageServer(
  baseUrl: string, art: 'ollama' | 'openai', apiKey?: string,
): Promise<Befund> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    const modelle = art === 'ollama'
      ? await holeOllamaModelle(base)
      : await holeOpenAiModelle(base, apiKey);
    return { lage: 'ok', modelle };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    // Ein echter HTTP-Status ist eine Antwort — dann lief die Verbindung.
    if (/^HTTP \d+/.test(text)) return { lage: 'fehler', modelle: [], text };
    // Sonst: kam überhaupt etwas an? Das trennt „verboten" von „weg".
    const dran = await erreichbar(`${base}${art === 'ollama' ? '/api/tags' : '/models'}`);
    return { lage: dran ? 'verboten' : 'weg', modelle: [], text };
  }
}
