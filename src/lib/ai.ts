// KI-Anbindung: ruft den in den Einstellungen gewählten Anbieter direkt aus
// dem Browser auf. Cloud (eigener Key) oder lokal (Ollama/kompatibel) —
// es gibt keinen Zwischenserver, Inhalte gehen nur an den gewählten Endpunkt.
import { useBoard, type AiSettings } from '../store';

export function aiReady(ai: AiSettings): boolean {
  switch (ai.provider) {
    case 'anthropic':
    case 'openai':
      return !!ai.apiKey && !!ai.model;
    case 'ollama':
      return !!ai.baseUrl && !!ai.model;
    case 'custom':
      return !!ai.baseUrl && !!ai.model;
    default:
      return false;
  }
}

const TIMEOUT_MS = 60_000;

export async function askAi(prompt: string): Promise<string> {
  const ai = useBoard.getState().ai;
  if (!aiReady(ai)) throw new Error('KI nicht konfiguriert (⚙️ Einstellungen)');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    switch (ai.provider) {
      case 'anthropic': {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': ai.apiKey,
            'anthropic-version': '2023-06-01',
            // offizieller Opt-in-Header für Browser-Direktzugriff
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: ai.model,
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!res.ok) throw new Error(`Anthropic: HTTP ${res.status}`);
        const data = await res.json();
        return data.content?.[0]?.text ?? '';
      }
      case 'openai':
      case 'custom': {
        const base = ai.provider === 'openai' ? 'https://api.openai.com/v1' : ai.baseUrl.replace(/\/$/, '');
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'content-type': 'application/json',
            ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: ai.model,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!res.ok) throw new Error(`KI-Server: HTTP ${res.status}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? '';
      }
      case 'ollama': {
        const base = ai.baseUrl.replace(/\/$/, '');
        const res = await fetch(`${base}/api/generate`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: ai.model, prompt, stream: false }),
        });
        if (!res.ok) throw new Error(`Ollama: HTTP ${res.status} — läuft ollama serve? OLLAMA_ORIGINS gesetzt?`);
        const data = await res.json();
        return data.response ?? '';
      }
      default:
        throw new Error('Unbekannter Anbieter');
    }
  } finally {
    clearTimeout(timer);
  }
}

/** KI-Antwort (Zeilen/Stichpunkte) → BlockNote-Blöcke für eine Notiz-Karte */
export function textToBlocks(title: string, text: string): unknown[] {
  const blocks: unknown[] = [{ type: 'heading', props: { level: 3 }, content: title }];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-•*]\s+/.test(line)) {
      blocks.push({ type: 'bulletListItem', content: line.replace(/^[-•*]\s+/, '') });
    } else {
      blocks.push({ type: 'paragraph', content: line });
    }
  }
  return blocks;
}
