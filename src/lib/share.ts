// Serverloses Teilen: Ein komplettes Board wird gzip-komprimiert und
// base64url-codiert in den URL-HASH gepackt (#b=…). Der Hash verlässt den
// Browser nie Richtung Server — der Link IST die Datei. Der Empfänger
// öffnet ihn auf der Web-Version (oder jeder lokalen Kopie) und bekommt
// das Board als neues Board importiert.
import type { BoardDoc } from '../store';
import { uid, type AppNode, type KanbanData } from '../types';
import { triggerDownload } from './download';

interface SharePayload {
  app: 'pixinotes-board';
  version: 2;
  board: BoardDoc;
}

const b64url = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function gzip(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([text]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Response(stream).text();
}

/** Praktische Obergrenze für Links (Clipboard/Browser vertragen mehr, aber Messenger nicht) */
export const SHARE_URL_LIMIT = 60_000;

export async function boardToShareUrl(board: BoardDoc): Promise<string> {
  const payload: SharePayload = { app: 'pixinotes-board', version: 2, board };
  const packed = b64url(await gzip(JSON.stringify(payload)));
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#b=${packed}`;
}

/** Fallback für große Boards (Bilder!): als .pixiboard.json herunterladen */
export function downloadBoardFile(board: BoardDoc): void {
  const payload: SharePayload = { app: 'pixinotes-board', version: 2, board };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  triggerDownload(url, `${board.name.replace(/[^\p{L}\d\-_ ]/gu, '').trim().slice(0, 40) || 'board'}.pixiboard.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Board aus geteiltem Payload klonen: frische IDs, damit nichts kollidiert */
export function cloneSharedBoard(board: BoardDoc): BoardDoc {
  const idMap = new Map<string, string>();
  const nodes = (board.nodes ?? []).map((n) => {
    const nid = uid();
    idMap.set(n.id, nid);
    const clone = { ...n, id: nid, selected: false } as AppNode;
    // Referenzen auf die Welt des ABSENDERS entwerten (Audit R6-S5):
    // Portale zeigen auf Board-IDs, die es beim Empfänger nicht gibt …
    if (clone.type === 'portal' && (clone.data as { boardId?: string }).boardId) {
      clone.data = { ...clone.data, boardId: undefined };
    }
    // … und Ticket-Verknüpfungen ebenso (nodeIds werden gleich neu vergeben)
    if (clone.type === 'kanban') {
      const data = clone.data as KanbanData;
      const ohneLink = (list: KanbanData['items']) => list.map((it) => ({ ...it, link: undefined }));
      // … auch im Ticket-Archiv (M293)
      if (data.items?.some((it) => it.link) || data.archiv?.some((it) => it.link)) {
        clone.data = { ...data, items: ohneLink(data.items ?? []), archiv: data.archiv ? ohneLink(data.archiv) : undefined };
      }
    }
    return clone;
  });
  const edges = (board.edges ?? [])
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ ...e, id: `e-${uid()}`, source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
  return {
    id: uid(),
    name: `${board.name ?? 'Board'} (geteilt)`,
    nodes,
    edges,
    drawings: board.drawings,
  };
}

/** Share-Payload aus JSON-Text (Link-Hash oder .pixiboard.json) validieren */
export function parseBoardPayload(text: string): BoardDoc | null {
  try {
    const p = JSON.parse(text) as SharePayload;
    if (p?.app !== 'pixinotes-board' || !p.board || !Array.isArray(p.board.nodes)) return null;
    return p.board;
  } catch {
    return null;
  }
}

/** Beim App-Start: liegt ein geteiltes Board im URL-Hash? */
export async function readShareHash(): Promise<BoardDoc | null> {
  const m = window.location.hash.match(/^#b=([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const board = parseBoardPayload(await gunzip(fromB64url(m[1])));
    return board;
  } catch {
    return null;
  }
}

export function clearShareHash(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}
