// Serverloses Teilen: Ein komplettes Board wird gzip-komprimiert und
// base64url-codiert in den URL-HASH gepackt (#b=…). Der Hash verlässt den
// Browser nie Richtung Server — der Link IST die Datei. Der Empfänger
// öffnet ihn auf der Web-Version (oder jeder lokalen Kopie) und bekommt
// das Board als neues Board importiert.
import { boardVonAussen, gestaltLaden, kartenVonAussen } from './sicher';
import type { BoardDoc } from '../store';
import { uid, type AppNode, type KanbanData } from '../types';
import { anhangKarte, uebernimmDateien, type SyncDatei } from './syncFolder';

interface SharePayload {
  app: 'pixinotes-board';
  version: 2;
  board: BoardDoc;
  /** M390: Inhalte aus der Geräte-Ablage (große Dateien, Tool-Quelltexte) — nur in der Datei, nie im Link */
  dateien?: Record<string, SyncDatei>;
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

/**
 * M388: Was ein Board zum GETEILTEN macht, reist nicht mit hinaus. Ein Board, das man selbst nur als Gast hat,
 * trägt das Einladungs-Token und die E-Mail des Besitzers — wer eine Kopie weitergab, gab damit auch den
 * Zugang zum Original weiter. (lib/linkTeilen.ts nimmt dieselben Felder heraus.)
 */
export function zumWeitergeben(board: BoardDoc): BoardDoc {
  const { geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, ...eigen } = board as BoardDoc & { gastWar?: unknown };
  delete (eigen as { gastWar?: unknown }).gastWar;
  return { ...eigen, nodes: eigen.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)) } as BoardDoc;
}

export async function boardToShareUrl(board: BoardDoc): Promise<string> {
  const payload: SharePayload = { app: 'pixinotes-board', version: 2, board: zumWeitergeben(board) };
  const packed = b64url(await gzip(JSON.stringify(payload)));
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#b=${packed}`;
}

/**
 * Fallback für große Boards (Bilder!) und Board-⋯ → „Sicherung herunterladen": EINE Datei mit allem.
 * M476: Das ist jetzt die Sicherung (.pixinotes, lib/sicherung.ts) — Anhänge als Binärdaten, eingespielt über die
 * Vorschau. Die alte `.pixiboard.json` wird weiter gelesen.
 */
export function downloadBoardFile(board: BoardDoc, still = true): void {
  void import('./sicherung').then((m) => m.boardSichern(board, still));
}

/** M390: Hat das Board Inhalte, die in keinen Link passen (sie liegen in der Geräte-Ablage, nicht im Board)? */
export function hatAblageInhalt(board: BoardDoc): boolean {
  return board.nodes.some((n) => !!anhangKarte(n) && !(n.data as { dataUrl?: string }).dataUrl);
}

/** M390: Board-Datei lesen — das Board und, wenn vorhanden, die mitgereisten Inhalte */
export function parseBoardDatei(text: string): { board: BoardDoc; dateien?: Record<string, SyncDatei> } | null {
  const board = parseBoardPayload(text);
  if (!board) return null;
  try { const d = (JSON.parse(text) as SharePayload).dateien; return { board, dateien: d && typeof d === 'object' ? d : undefined }; } catch { return { board }; }
}

/** M390: Mitgereiste Inhalte unter den NEUEN Karten-Kennungen ablegen (idMap: alte → neue Kennung) */
export async function boardDateienUebernehmen(dateien: Record<string, SyncDatei> | undefined, idMap: Map<string, string>): Promise<void> {
  if (!dateien) return;
  const neu: Record<string, SyncDatei> = {};
  for (const [alt, d] of Object.entries(dateien)) { const id = idMap.get(alt); if (id) neu[id] = d; }
  const n = await uebernimmDateien({ dateien: neu } as never);
  if (n > 0) window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
}

/** Board aus geteiltem Payload klonen: frische IDs, damit nichts kollidiert */
export function cloneSharedBoard(board0: BoardDoc, idMap: Map<string, string> = new Map()): BoardDoc {
  // M522: Das GANZE Board prüfen, nicht nur die Karten — Verbindungen, Striche und Gespräche kamen ungeprüft an: ein
  // Strich ohne Punkte oder `edges: "x"` in einem Link ließ den Import abbrechen oder die Fläche nach jedem Start ausfallen
  const board: BoardDoc = boardVonAussen(board0, 'geteilt') ?? { id: 'geteilt', name: 'Board', nodes: [], edges: [] };
  // M357: Wer die Zuordnung alte → neue Karten-Id braucht (Anhänge liegen unter der Karten-Id), reicht die Karte herein
  // M388: Ein geteiltes Board stammt von anderen — ungültige Karten fallen weg, Adressen werden entschärft (lib/sicher.ts)
  const nodes = kartenVonAussen(board.nodes).map((n) => {
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
  /**
   * M340: Zeichnungen und Kommentare mitnehmen — an den NEUEN Karten.
   * Vorher wanderten die Striche unverändert mit: Ihr Anker zeigte auf die Karten-Id des Absenders,
   * die es nach dem Klonen nicht mehr gibt. Jede Markierung auf einer Karte war beim Empfänger
   * unsichtbar. Freie Striche bleiben frei; Striche an Karten, die nicht mitkamen, entfallen.
   */
  const drawings = (board.drawings ?? []).flatMap((s) => {
    if (!s.anchor) return [{ ...s, id: uid() }];
    const ziel = idMap.get(s.anchor);
    return ziel ? [{ ...s, id: uid(), anchor: ziel }] : [];
  });
  const comments = (board.comments ?? []).flatMap((c) => {
    if (!c.nodeId) return [{ ...c, id: uid() }];
    const ziel = idMap.get(c.nodeId);
    return ziel ? [{ ...c, id: uid(), nodeId: ziel }] : [];
  });
  return {
    id: uid(),
    name: `${board.name ?? 'Board'} (geteilt)`,
    nodes,
    edges,
    drawings,
    ...(comments.length ? { comments } : {}),
    ...(typeof board.bg === 'string' && board.bg ? { bg: board.bg.slice(0, 40) } : {}),
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
    if (board) await gestaltLaden();   // M522: bevor cloneSharedBoard das Board prüft
    return board;
  } catch {
    return null;
  }
}

export function clearShareHash(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}
