// M184: OneNote-Import über Microsoft Graph — Notizbuch → Bereich,
// Abschnitt → Board, Seite → Notiz-Karte.
//
// Bewusst ein EINBAHN-Import (lesen). Ein Rück-Sync nach OneNote bräuchte
// Schreibrechte auf sämtliche Notizbücher und wäre bei parallelen Änderungen
// konfliktanfällig — der ehrliche Weg ist: hier weiterarbeiten.
//
// Es gibt keinen PixiNotes-Server: Der Browser spricht direkt mit Graph
// (CORS ist dort offen). Das Token liegt ausschließlich im eigenen
// localStorage-Schlüssel der Konten-Verwaltung und wandert nie in Boards,
// Sync-Dateien, Share-Links oder Exporte.

import { msAccessToken } from './calAccounts';
import { htmlToBlocks, type Block } from './htmlBlocks';
import { makeImage, makeNote } from './nodes';
import { uid, type AppNode } from '../types';
import { useBoard, type BoardDoc, type Space } from '../store';

const GRAPH = 'https://graph.microsoft.com/v1.0/me/onenote';

export interface OnSection { id: string; name: string; pagesUrl: string; group?: string }
export interface OnNotebook { id: string; name: string; sections: OnSection[] }
export interface OnPage { id: string; title: string; contentUrl: string; created?: string }

/**
 * Graph drosselt OneNote hart: 120 Anfragen je Minute und höchstens FÜNF
 * gleichzeitig. Darum eine kleine Schlange mit drei Plätzen (Sicherheitsabstand)
 * und ein Wiederholversuch bei 429/503 mit der von Microsoft genannten Wartezeit.
 */
let active = 0;
const queue: Array<() => void> = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((r) => queue.push(r));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    queue.shift()?.();
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graphFetch(url: string, accept: string, needNotes = true): Promise<Response> {
  return slot(async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const token = await msAccessToken(needNotes);
      // NIE credentials:'include' — Graph antwortet mit „Allow-Origin: *",
      // die Kombination verbietet der Browser.
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
      if (res.status === 429 || res.status === 503) {
        const retry = Number(res.headers.get('Retry-After') ?? '') || (attempt + 1) * 5;
        await wait(Math.min(retry, 30) * 1000);
        continue;
      }
      if (res.status === 401) throw new Error('Microsoft hat die Anmeldung abgelehnt — bitte in den Einstellungen neu verbinden.');
      if (res.status === 403) throw new Error('Keine Berechtigung für OneNote — in den Einstellungen „Mit OneNote verbinden" wählen.');
      if (!res.ok) throw new Error(`OneNote: HTTP ${res.status}`);
      return res;
    }
    throw new Error('OneNote antwortet gerade nicht (Anfragegrenze erreicht) — bitte in ein paar Minuten erneut versuchen.');
  });
}

/** JSON-Liste inklusive Blättern (@odata.nextLink ist absolut und undurchsichtig) */
async function graphList<T>(url: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = url;
  let guard = 0;
  while (next && guard < 50) {
    guard += 1;
    const res: Response = await graphFetch(next, 'application/json');
    const json = await res.json() as { value?: T[]; '@odata.nextLink'?: string };
    out.push(...(json.value ?? []));
    next = json['@odata.nextLink'] ?? null;
  }
  return out;
}

/**
 * Notizbücher samt Abschnitten holen — inklusive der Abschnitte in
 * Abschnittsgruppen, die sonst unsichtbar blieben.
 */
export async function fetchNotebooks(): Promise<OnNotebook[]> {
  const books = await graphList<{ id: string; displayName?: string; name?: string; sectionsUrl?: string; sectionGroupsUrl?: string }>(
    `${GRAPH}/notebooks?$top=100&$select=id,displayName,sectionsUrl,sectionGroupsUrl&$orderby=displayName`,
  );
  const out: OnNotebook[] = [];
  for (const b of books) {
    const sections: OnSection[] = [];
    const readSections = async (url: string, group?: string) => {
      const list = await graphList<{ id: string; displayName?: string; name?: string; pagesUrl?: string }>(`${url}?$top=100&$select=id,displayName,pagesUrl`);
      for (const s of list) {
        sections.push({
          id: s.id,
          name: (s.displayName ?? s.name ?? 'Abschnitt').trim() || 'Abschnitt',
          pagesUrl: s.pagesUrl ?? `${GRAPH}/sections/${s.id}/pages`,
          group,
        });
      }
    };
    if (b.sectionsUrl) await readSections(b.sectionsUrl);
    // Abschnittsgruppen eine Ebene tief auflösen (mehr verschachtelt praktisch niemand)
    if (b.sectionGroupsUrl) {
      const groups = await graphList<{ id: string; displayName?: string; sectionsUrl?: string }>(`${b.sectionGroupsUrl}?$top=100&$select=id,displayName,sectionsUrl`);
      for (const g of groups) {
        if (g.sectionsUrl) await readSections(g.sectionsUrl, (g.displayName ?? '').trim() || undefined);
      }
    }
    out.push({ id: b.id, name: (b.displayName ?? b.name ?? 'Notizbuch').trim() || 'Notizbuch', sections });
  }
  return out;
}

/** Seiten eines Abschnitts (neueste zuerst wäre unpraktisch — wir sortieren nach Reihenfolge im Abschnitt) */
export async function fetchPages(section: OnSection, max = 100): Promise<OnPage[]> {
  const list = await graphList<{ id: string; title?: string; contentUrl?: string; createdDateTime?: string; order?: number }>(
    `${section.pagesUrl}?$top=100&$select=id,title,contentUrl,createdDateTime,order&pagelevel=true`,
  );
  return list.slice(0, max).map((p) => ({
    id: p.id,
    title: (p.title ?? '').trim() || 'Ohne Titel',
    contentUrl: p.contentUrl ?? `${GRAPH}/pages/${p.id}/content`,
    created: p.createdDateTime,
  }));
}

/** Seiteninhalt als HTML — `contentUrl` wörtlich verwenden (IDs sind heikel kodiert) */
export async function fetchPageHtml(page: OnPage): Promise<string> {
  const res = await graphFetch(page.contentUrl, 'text/html');
  return res.text();
}

/** Ein Bild aus OneNote nachladen und als data:-URL einbetten */
async function fetchResource(url: string): Promise<string | null> {
  try {
    const res = await graphFetch(url, 'application/octet-stream');
    const blob = await res.blob();
    if (blob.size > 1_500_000) return null;       // zu groß fürs Board
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface PageContent {
  title: string;
  blocks: Block[];
  images: string[];
}

/**
 * Eine Seite vollständig aufbereiten. Bilder werden nur auf Wunsch geladen —
 * jedes Bild ist ein eigener Graph-Aufruf und landet als data:-URL im Board.
 */
export async function fetchPageContent(page: OnPage, withImages: boolean): Promise<PageContent> {
  const html = await fetchPageHtml(page);
  const parsed = htmlToBlocks(html);
  const images: string[] = [];
  if (withImages) {
    for (const img of parsed.images.slice(0, 6)) {
      if (/^data:/i.test(img.src)) { images.push(img.src); continue; }
      if (!/^https:\/\/graph\.microsoft\.com\//i.test(img.src)) continue;
      const url = await fetchResource(img.src);
      if (url) images.push(url);
    }
  }
  return { title: page.title, blocks: parsed.blocks, images };
}

// ------------------------------------------------------------- Import ----

export interface ImportChoice { notebook: OnNotebook; sections: OnSection[] }

export interface ImportOptions {
  /** Bilder der Seiten mitladen (jedes Bild ist ein eigener Abruf) */
  withImages: boolean;
  /** Obergrenze je Abschnitt — schützt vor Riesen-Notizbüchern */
  maxPages: number;
}

export interface ImportSummary { notebooks: number; boards: number; pages: number; skipped: string[] }

const CARD_W = 300;
const GAP = 36;
const COLS = 3;

/** Karten spaltenweise setzen: neue Karte kommt in die derzeit kürzeste Spalte */
class Layouter {
  private y = new Array(COLS).fill(60) as number[];

  place(height: number): { x: number; y: number } {
    let col = 0;
    for (let i = 1; i < COLS; i += 1) if (this.y[i] < this.y[col]) col = i;
    const pos = { x: 60 + col * (CARD_W + GAP), y: this.y[col] };
    this.y[col] += height + GAP;
    return pos;
  }
}

/** Grobe Höhenschätzung einer Notiz — nur fürs Layout, die Karte wächst selbst */
const guessHeight = (blocks: Block[]): number =>
  Math.min(520, 90 + blocks.length * 26);

/**
 * Ausgewählte Notizbücher/Abschnitte holen und als Bereiche/Boards/Karten
 * einhängen. Meldet den Fortschritt, damit der Nutzer bei großen Notizbüchern
 * sieht, dass etwas passiert.
 */
export async function runOneNoteImport(
  choices: ImportChoice[],
  opts: ImportOptions,
  onProgress?: (msg: string, done: number, total: number) => void,
): Promise<ImportSummary> {
  const spaces: Space[] = [];
  const boards: BoardDoc[] = [];
  const skipped: string[] = [];
  let pageCount = 0;

  const totalSections = choices.reduce((n, c) => n + c.sections.length, 0);
  let doneSections = 0;

  for (const choice of choices) {
    const projects: Space['projects'] = [];
    // Abschnittsgruppen werden zu Projekten; alles Übrige sammelt „Abschnitte"
    const byGroup = new Map<string, OnSection[]>();
    for (const s of choice.sections) {
      const key = s.group ?? '';
      const list = byGroup.get(key) ?? [];
      list.push(s);
      byGroup.set(key, list);
    }

    for (const [group, sections] of byGroup) {
      const boardIds: string[] = [];
      for (const section of sections) {
        onProgress?.(`Abschnitt „${section.name}" …`, doneSections, totalSections);
        let pages: OnPage[] = [];
        try {
          pages = await fetchPages(section, opts.maxPages);
        } catch (e) {
          skipped.push(`${section.name}: ${(e as Error).message}`);
          doneSections += 1;
          continue;
        }
        const layout = new Layouter();
        const nodes: AppNode[] = [];
        for (const page of pages) {
          try {
            const content = await fetchPageContent(page, opts.withImages);
            const blocks: Block[] = [
              { type: 'heading', props: { level: 3 }, content: content.title },
              ...content.blocks,
            ];
            const pos = layout.place(guessHeight(blocks));
            const note = makeNote(pos, { blocks });
            note.width = CARD_W;
            nodes.push(note);
            for (const src of content.images) {
              const ipos = layout.place(200);
              nodes.push(makeImage(ipos, src, `Bild aus „${content.title}"`));
            }
            pageCount += 1;
          } catch (e) {
            skipped.push(`${page.title}: ${(e as Error).message}`);
          }
        }
        boards.push({ id: uid(), name: section.name, nodes, edges: [] });
        boardIds.push(boards[boards.length - 1].id);
        doneSections += 1;
        onProgress?.(`Abschnitt „${section.name}" fertig`, doneSections, totalSections);
      }
      if (boardIds.length > 0) {
        projects.push({ id: uid(), name: group || 'Abschnitte', boardIds });
      }
    }
    if (projects.length > 0) {
      spaces.push({ id: uid(), name: `📓 ${choice.notebook.name}`, projects });
    }
  }

  if (boards.length === 0) throw new Error('Nichts zu importieren — die gewählten Abschnitte enthalten keine Seiten.');

  useBoard.getState().importStructure({ spaces, boards, activeId: boards[0].id });
  return { notebooks: spaces.length, boards: boards.length, pages: pageCount, skipped };
}
