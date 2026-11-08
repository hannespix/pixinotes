// KI-Anbindung: ruft den in den Einstellungen gewählten Anbieter direkt aus
// dem Browser auf. Cloud (eigener Key) oder lokal (Ollama/kompatibel) —
// es gibt keinen Zwischenserver, Inhalte gehen nur an den gewählten Endpunkt.
import { useBoard, type AiSettings } from '../store';
import { textZuBloecken } from './notiz';

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

const TIMEOUT_MS = 120_000;

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

/**
 * M332: Laufende Anfragen, damit „Abbrechen" sie wirklich beendet — und ein
 * Merker, den Stapel-Aktionen zwischen zwei Portionen abfragen.
 */
const laufende = new Set<AbortController>();
let abgebrochen = false;
export function kiAbbrechen(): void {
  abgebrochen = true;
  for (const c of laufende) c.abort();
}
export function kiAbgebrochen(): boolean { return abgebrochen; }
/** Vor jeder neuen Aktion aufrufen — der Abbruch gilt nur für die laufende */
export function kiAbbruchZuruecksetzen(): void { abgebrochen = false; }

export interface KiAntwort {
  text: string;
  /** Das Modell hat an seiner Ausgabegrenze aufgehört — die Antwort ist unvollständig */
  abgeschnitten: boolean;
}
export interface KiOptionen {
  /** Obergrenze der Antwortlänge (Token); Vorgabe 4096 */
  maxTokens?: number;
}

export async function askAi(prompt: string, images: string[] = [], opt: KiOptionen = {}): Promise<string> {
  return (await askAiVoll(prompt, images, opt)).text;
}

/**
 * M332: Antwort MIT der Information, ob sie abgeschnitten wurde. Vorher stand
 * die Anthropic-Grenze fest auf 1024 Token — ein Operationsplan für acht
 * Notizen brach nach der zweiten mitten im JSON ab, die Reparatur schloss die
 * Klammern, und die App meldete fröhlich „2 Schritte". Jetzt sind 4096 Token
 * die Vorgabe, und wer fragt, erfährt vom Abschneiden.
 */
export async function askAiVoll(prompt: string, images: string[] = [], opt: KiOptionen = {}): Promise<KiAntwort> {
  const ai = useBoard.getState().ai;
  if (!aiReady(ai)) throw new Error('KI nicht konfiguriert (⚙️ Einstellungen)');
  if (abgebrochen) throw new Error('abgebrochen');
  try {
    return await askOnce(ai, prompt, images, opt);
  } catch (e) {
    if (abgebrochen) throw new Error('abgebrochen');
    // Gratis-Dienst/Ollama: das Modell versteht evtl. keine Bilder — einmal
    // ohne Fotos nachfassen, statt die ganze Aktion scheitern zu lassen
    if (images.length > 0 && (ai.provider === 'free' || ai.provider === 'ollama')) {
      return askOnce(ai, `${prompt}\n\n(Hinweis: Die Fotos konnten nicht übertragen werden — arbeite nur mit dem Kartentext.)`, [], opt);
    }
    throw e;
  }
}

async function askOnce(ai: AiSettings, prompt: string, images: string[], opt: KiOptionen): Promise<KiAntwort> {
  const maxTokens = opt.maxTokens ?? 4096;
  // OpenAI-Chat-Format: Text + Bilder als content-Array, sonst schlichter String
  const openAiContent = images.length
    ? [
      ...images.map((u) => ({ type: 'image_url', image_url: { url: u } })),
      { type: 'text', text: prompt },
    ]
    : prompt;
  const ctrl = new AbortController();
  laufende.add(ctrl);
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
            max_tokens: maxTokens,
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
        return { text: data.content?.[0]?.text ?? '', abgeschnitten: data.stop_reason === 'max_tokens' };
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
            max_tokens: maxTokens,
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
        return { text: msg?.content || msg?.reasoning || '', abgeschnitten: data.choices?.[0]?.finish_reason === 'length' };
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
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: openAiContent }],
          }),
        });
        if (!res.ok) throw new Error(`KI-Server: HTTP ${res.status}`);
        const data = await res.json();
        return { text: data.choices?.[0]?.message?.content ?? '', abgeschnitten: data.choices?.[0]?.finish_reason === 'length' };
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
            options: { num_predict: maxTokens },
            ...(images.length ? { images: images.map(b64Of) } : {}),
          }),
        });
        if (!res.ok) throw new Error(`Ollama: HTTP ${res.status} — läuft ollama serve? OLLAMA_ORIGINS gesetzt?`);
        const data = await res.json();
        return { text: data.response ?? '', abgeschnitten: data.done_reason === 'length' };
      }
      default:
        throw new Error('Unbekannter Anbieter');
    }
  } catch (e) {
    if (abgebrochen) throw new Error('abgebrochen');
    if ((e as Error).name === 'AbortError') throw new Error('Zeitüberschreitung — der KI-Dienst hat nicht rechtzeitig geantwortet.');
    throw e;
  } finally {
    clearTimeout(timer);
    laufende.delete(ctrl);
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
      mdParser = BlockNoteEditor.create({ _headless: true } as never);
    }
    // M332: GFM-Checklisten („- [ ] …") bringen BlockNotes Parser zu Fall
    // (Fehler „blockContainer … blockContent" — der Haken wird ein eigener
    // Knoten). Vorher wurde deshalb JEDE Antwort mit Checkliste stumm zum
    // Rohtext. Die Haken werden als Marker durchgeschleust und danach
    // wieder zu echten checkListItem-Blöcken — Fett/Kursiv bleiben erhalten.
    const vor = src.replace(/^(\s*)[-*+]\s+\[( |x|X)\]\s+/gm, (_m, ind: string, x: string) => `${ind}- ${x === ' ' ? '☐' : '☑'} `);
    const blocks = await mdParser.tryParseMarkdownToBlocks(vor);
    if (blocks.length > 0) return hakenZurueck(blocks as unknown[]);
  } catch (e) {
    // M332: nicht mehr stumm — der Zeilen-Parser unten kennt Überschriften,
    // Punkte, Haken, Nummern und Zitate; nur Fett/Kursiv bleiben dann roh
    console.warn('Markdown-Parser nicht verfügbar, Zeilen-Parser übernimmt:', e);
  }
  return textZuBloecken(src);
}

/** Marker-Punkte („- ☐ Text") wieder zu Checklisten-Blöcken machen (rekursiv) */
function hakenZurueck(blocks: unknown[]): unknown[] {
  return blocks.map((b) => {
    const blk = b as { type?: string; props?: Record<string, unknown>; content?: unknown; children?: unknown[] };
    const kinder = Array.isArray(blk.children) ? hakenZurueck(blk.children) : blk.children;
    if (blk.type === 'bulletListItem' && Array.isArray(blk.content) && blk.content.length > 0) {
      const erst = blk.content[0] as { type?: string; text?: string };
      const m = erst.type === 'text' && typeof erst.text === 'string' ? /^([☐☑])\s?/.exec(erst.text) : null;
      if (m) {
        const rest = erst.text!.slice(m[0].length);
        const content = rest ? [{ ...erst, text: rest }, ...blk.content.slice(1)] : blk.content.slice(1);
        return { ...blk, type: 'checkListItem', props: { ...(blk.props ?? {}), checked: m[1] === '☑' }, content, children: kinder };
      }
    }
    return kinder === blk.children ? b : { ...blk, children: kinder };
  });
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
