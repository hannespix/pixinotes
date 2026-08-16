// KI-Anbindung: ruft den in den Einstellungen gewählten Anbieter direkt aus
// dem Browser auf. Cloud (eigener Key) oder lokal (Ollama/kompatibel) —
// es gibt keinen Zwischenserver, Inhalte gehen nur an den gewählten Endpunkt.
import { useBoard, type AiSettings } from '../store';

export function aiReady(ai: AiSettings): boolean {
  switch (ai.provider) {
    case 'free':
      // Gratis-Dienst ohne Schlüssel — sofort einsatzbereit
      return true;
    case 'anthropic':
    case 'openai':
    case 'openrouter':
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

/* ---------- Bilder für die KI (M199) ----------
   Bild-Karten gehen als ECHTE Foto-Anhänge mit (Vision) — vorher wurde nur der
   Dateiname serialisiert („Bild: IMG-….jpg"), und selbst ein Opus-Modell konnte
   dann ehrlich nur antworten, dass es nichts lesen kann. Vor dem Versand wird
   verkleinert und als JPEG kodiert: hält Payload und Kosten klein
   (Anthropic-Limit 5 MB pro Bild) und beschleunigt die Antwort. */
const IMG_MAX_DIM = 1400;
export async function prepImageForAi(src: string): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Bild nicht lesbar'));
      i.src = src;
    });
    const k = Math.min(1, IMG_MAX_DIM / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * k));
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    // Weißer Grund: transparente PNG-Bereiche würden als JPEG sonst schwarz
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}
const b64Of = (u: string) => u.slice(u.indexOf(',') + 1);
const mediaOf = (u: string) => /^data:([^;,]+)/.exec(u)?.[1] ?? 'image/jpeg';

export async function askAi(prompt: string, images: string[] = []): Promise<string> {
  const ai = useBoard.getState().ai;
  if (!aiReady(ai)) throw new Error('KI nicht konfiguriert (⚙️ Einstellungen)');
  try {
    return await askOnce(ai, prompt, images);
  } catch (e) {
    // Gratis-Dienst/Ollama: das Modell versteht evtl. keine Bilder — einmal
    // ohne Fotos nachfassen, statt die ganze Aktion scheitern zu lassen
    if (images.length > 0 && (ai.provider === 'free' || ai.provider === 'ollama')) {
      return askOnce(ai, `${prompt}\n\n(Hinweis: Die Fotos konnten nicht übertragen werden — arbeite nur mit dem Kartentext.)`, []);
    }
    throw e;
  }
}

async function askOnce(ai: AiSettings, prompt: string, images: string[]): Promise<string> {
  // OpenAI-Chat-Format: Text + Bilder als content-Array, sonst schlichter String
  const openAiContent = images.length
    ? [
      ...images.map((u) => ({ type: 'image_url', image_url: { url: u } })),
      { type: 'text', text: prompt },
    ]
    : prompt;
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
            messages: [{
              role: 'user',
              content: images.length
                ? [
                  ...images.map((u) => ({
                    type: 'image', source: { type: 'base64', media_type: mediaOf(u), data: b64Of(u) },
                  })),
                  { type: 'text', text: prompt },
                ]
                : prompt,
            }],
          }),
        });
        if (!res.ok) throw new Error(`Anthropic: HTTP ${res.status}`);
        const data = await res.json();
        return data.content?.[0]?.text ?? '';
      }
      case 'free': {
        // Pollinations.ai: kostenloser, OpenAI-kompatibler Endpunkt ohne
        // Schlüssel oder Konto. Ehrlich gesagt: Inhalte gehen an einen
        // Community-Dienst ohne Verfügbarkeits-/Datenschutz-Garantien —
        // für sensible Daten Ollama (lokal) nutzen.
        // Anonym gibt es aktuell NUR das Modell "openai" (GPT-OSS 20B) —
        // alte gespeicherte Namen (z. B. "mistral") liefern 404 → sanieren.
        const model = ['openai', 'openai-fast', 'gpt-oss', 'gpt-oss-20b'].includes(ai.model) ? ai.model : 'openai';
        const doFetch = () => fetch('https://text.pollinations.ai/openai', {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: openAiContent }],
          }),
        });
        let res = await doFetch();
        if (res.status >= 500) {
          // Community-Dienst wackelt gern kurz — einmal kurz warten und nochmal
          await new Promise((r) => setTimeout(r, 1500));
          if (ctrl.signal.aborted) throw new Error('Zeitüberschreitung — der Gratis-Dienst antwortet gerade nicht.');
          res = await doFetch();
        }
        if (!res.ok) throw new Error(`Gratis-KI: HTTP ${res.status} — der kostenlose Dienst ist gerade ausgelastet. Kurz warten und nochmal versuchen, oder in den Einstellungen OpenRouter/Ollama wählen.`);
        const data = await res.json();
        const msg = data.choices?.[0]?.message;
        // Reasoning-Modell: manchmal steht die Antwort nur im reasoning-Feld
        return msg?.content || msg?.reasoning || '';
      }
      case 'openai':
      case 'openrouter':
      case 'custom': {
        const base = ai.provider === 'openai'
          ? 'https://api.openai.com/v1'
          : ai.provider === 'openrouter'
            ? 'https://openrouter.ai/api/v1'
            : ai.baseUrl.replace(/\/$/, '');
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'content-type': 'application/json',
            ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: ai.model,
            messages: [{ role: 'user', content: openAiContent }],
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
          // images: multimodale Modelle (llava, moondream …) lesen sie,
          // reine Textmodelle ignorieren das Feld
          body: JSON.stringify({
            model: ai.model, prompt, stream: false,
            ...(images.length ? { images: images.map(b64Of) } : {}),
          }),
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

/* ---------- M278: Websuche über den KI-Anbieter ----------
   Anthropic führt die Suche SERVERSEITIG aus (web_search-Tool): Das Modell
   sucht selbst, liest die Treffer und belegt seine Antwort mit Zitaten.
   Das ist der Recherche-Weg mit der größten Reichweite — er steht aber nur
   offen, wenn der eigene Anthropic-Schlüssel hinterlegt ist. Alle anderen
   Anbieter behalten den M274-Weg (Wikipedia/Wikivoyage/Open-Meteo). */

export interface WebSuchErgebnis {
  text: string;
  quellen: Array<{ titel: string; url: string }>;
}

/** Kann der aktuelle Anbieter serverseitig suchen? */
export function webSucheBereit(ai: AiSettings): boolean {
  return ai.provider === 'anthropic' && aiReady(ai);
}

/**
 * Eine Frage MIT Websuche beantworten (nur Anthropic). Wirft bei jedem
 * Fehler — der Aufrufer fällt dann auf die Nachschlagewerke (M274) zurück.
 */
export async function askAnthropicWebSuche(prompt: string): Promise<WebSuchErgebnis> {
  const ai = useBoard.getState().ai;
  if (!webSucheBereit(ai)) throw new Error('Websuche nur mit Anthropic-Schlüssel');
  const ctrl = new AbortController();
  // Suchen + Lesen + Schreiben dauert länger als eine reine Antwort
  const timer = setTimeout(() => ctrl.abort(), 150_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': ai.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: 2048,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic-Websuche: HTTP ${res.status}`);
    const data = await res.json();
    let text = '';
    const quellen: WebSuchErgebnis['quellen'] = [];
    const bekannt = new Set<string>();
    for (const block of data.content ?? []) {
      if (block.type !== 'text') continue;
      text += block.text ?? '';
      // Zitate hängen an den Textblöcken — daraus wird die Quellenliste
      for (const c of block.citations ?? []) {
        const url = typeof c?.url === 'string' ? c.url : '';
        if (!url || bekannt.has(url)) continue;
        bekannt.add(url);
        quellen.push({ titel: typeof c?.title === 'string' && c.title.trim() ? c.title : url, url });
      }
    }
    if (!text.trim()) throw new Error('Websuche ohne Antworttext');
    return { text, quellen };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Zentraler Formatier-Steckbrief für alle Text-Antworten der KI (M117) —
 * bewusst kurz gehalten (Token) und überall identisch angehängt.
 */
export const MD_HINT = 'Formatiere die Antwort als Markdown: "## " für Zwischenüberschriften, '
  + '**fett** für Schlüsselbegriffe, "- " für Stichpunkte und für ALLES Abhakbare '
  + 'Checklisten im Format "- [ ] …". Keine Codeblöcke, kompakt bleiben.';

// Kopfloser BlockNote-Editor NUR zum Markdown-Parsen (wird nie gemountet)
let mdParser: import('@blocknote/core').BlockNoteEditor | null = null;

/**
 * KI-Markdown → echte BlockNote-Blöcke (M117): Überschriften, Fett/Kursiv,
 * Aufzählungen und "- [ ]"-Checklisten werden korrekt umgesetzt — vorher
 * landeten "**" und "#" als roher Text in der Notiz (User-Screenshot).
 */
export async function mdToBlocks(title: string, md: string): Promise<unknown[]> {
  const src = title ? `### ${title}\n\n${md}` : md;
  try {
    if (!mdParser) {
      const { BlockNoteEditor } = await import('@blocknote/core');
      mdParser = BlockNoteEditor.create();
    }
    const blocks = await mdParser.tryParseMarkdownToBlocks(src);
    if (blocks.length > 0) return blocks as unknown[];
  } catch { /* Netz: alter Zeilen-Parser */ }
  return textToBlocks(title, md);
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
