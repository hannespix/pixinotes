// M357: Ein Board per kurzem Link teilen — der Empfänger öffnet es direkt, ohne Konto.
//
// Bisher steckte das ganze Board IM Link (#b=…, lib/share.ts): lang, ohne Anhänge, und ab einer gewissen
// Größe gar nicht mehr. Mit dem PixiNotes-Konto geht es anders: Eine FASSUNG des Boards (Board-Datei und
// Anhänge) liegt im Dateispeicher des Besitzers, die Tabelle `board_links` merkt sich je Board ein Token und
// die signierten Adressen. Der Link ist nur noch `…#l=<token>`. Wer ihn öffnet, bekommt das Board als eigene
// Kopie — samt PDFs und anderen Dateien. Der Besitzer kann die Fassung aktualisieren oder den Link löschen.
//
// Gemeinsames Arbeiten in Echtzeit ist ein anderer Weg (Freigabe für ein Konto, M330): Dafür müssen beide
// angemeldet sein. Dieser Link ist zum Weitergeben gedacht.
import { useBoard, type BoardDoc } from '../store';
import { loadFile, saveFile } from './fileStore';
import { kontoAnfrage, kontoDateiNachladen, loadKonto } from './kontoSync';
import { supabaseKonfig } from './kontoSupabase';
import { ohneAuswahl } from './syncMerge';
import { cloneSharedBoard, parseBoardPayload } from './share';

const BUCKET = 'pixinotes';
/** Signierte Adressen gelten zehn Jahre — der Link endet, wenn der Besitzer ihn löscht (dann sind die Dateien weg) */
const GILT_SEKUNDEN = 10 * 365 * 24 * 3600;
const EMPFANGEN_KEY = 'pixinotes-links-empfangen';

export interface LinkDatei { id: string; name: string; mime?: string; groesse: number; url: string }
export interface LinkZeile { token: string; board_id: string; name: string; board_url: string; dateien: LinkDatei[]; updated_at: string }

export const linkUrl = (token: string): string => `${location.origin}${location.pathname}#l=${token}`;
/** Braucht das PixiNotes-Konto (E-Mail-Anmeldung) — Google/OneDrive haben keinen öffentlichen Dateispeicher */
export const linkMoeglich = (): boolean => loadKonto()?.anbieter === 'supabase';

function neuesToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const basis = (): string => loadKonto()?.url ?? '';
const pfad = (token: string, name: string): string => `${encodeURIComponent(loadKonto()?.userId ?? '')}/link-${token}/${encodeURIComponent(name)}`;
const eingerichtet = (res: Response): void => {
  if (res.status === 404) throw new Error('Link-Freigaben sind beim Betreiber noch nicht eingerichtet (Migration M357 fehlt).');
};

async function hochladen(token: string, name: string, body: Blob | string, mime: string): Promise<string> {
  const res = await kontoAnfrage(`${basis()}/storage/v1/object/${BUCKET}/${pfad(token, name)}`, { method: 'POST', headers: { 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'true' }, body });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 413 || /exceeded|maximum size|too large|Payload/i.test(t)) throw new Error(`„${name}" ist größer als der Dateispeicher erlaubt (50 MB).`);
    throw new Error(`Hochladen fehlgeschlagen (HTTP ${res.status}).`);
  }
  const sig = await kontoAnfrage(`${basis()}/storage/v1/object/sign/${BUCKET}/${pfad(token, name)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: GILT_SEKUNDEN }) });
  if (!sig.ok) throw new Error(`Die Adresse für „${name}" ließ sich nicht anlegen (HTTP ${sig.status}).`);
  const j = (await sig.json()) as { signedURL?: string; signedUrl?: string };
  const rel = j.signedURL ?? j.signedUrl ?? '';
  if (!rel) throw new Error(`Die Adresse für „${name}" fehlt in der Antwort.`);
  return /^https?:/.test(rel) ? rel : `${basis()}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
}
async function entfernen(token: string, name: string): Promise<void> {
  await kontoAnfrage(`${basis()}/storage/v1/object/${BUCKET}/${pfad(token, name)}`, { method: 'DELETE' }).catch(() => {});
}

/** Der Link eines eigenen Boards — oder null, wenn es keinen gibt */
export async function linkDesBoards(boardId: string): Promise<LinkZeile | null> {
  const s = loadKonto();
  if (s?.anbieter !== 'supabase') return null;
  const res = await kontoAnfrage(`${basis()}/rest/v1/board_links?select=token,board_id,name,board_url,dateien,updated_at&board_id=eq.${encodeURIComponent(boardId)}&besitzer=eq.${encodeURIComponent(s.userId ?? '')}`, { cache: 'no-store' });
  eingerichtet(res);
  if (!res.ok) throw new Error(`Link nicht lesbar (HTTP ${res.status}).`);
  const z = (await res.json()) as LinkZeile[];
  return z[0] ?? null;
}

/**
 * Link anlegen oder die geteilte Fassung auf den heutigen Stand bringen (das Token bleibt).
 * Lädt die Board-Datei und alle Anhänge hoch; `fortschritt` meldet, was gerade läuft.
 */
export async function linkErstellen(boardId: string, fortschritt?: (text: string) => void): Promise<LinkZeile> {
  if (!linkMoeglich()) throw new Error('Kurze Links gibt es mit dem PixiNotes-Konto (E-Mail-Anmeldung).');
  const board = useBoard.getState().boards.find((b) => b.id === boardId);
  if (!board) throw new Error('Das Board gibt es nicht mehr.');
  const alt = await linkDesBoards(boardId);
  const token = alt?.token ?? neuesToken();
  // Anhänge: Datei-Karten, deren Inhalt in der Geräte-Ablage liegt (kleine stecken als dataUrl in der Karte selbst)
  const karten = board.nodes.filter((n) => n.type === 'file' && !n.archived);
  const dateien: LinkDatei[] = [];
  const fehlend: string[] = [];
  let nr = 0;
  for (const n of karten) {
    const d = n.data as { name?: string; mime?: string; size?: number; dataUrl?: string };
    if (d.dataUrl) continue;
    nr += 1;
    fortschritt?.(`Anhang ${nr}: ${d.name ?? 'Datei'} …`);
    let blob = await loadFile(n.id).catch(() => undefined);
    // Große Dateien liegen manchmal nur im Konto (werden erst beim Öffnen geladen) — jetzt holen
    if (!blob) blob = (await kontoDateiNachladen(n.id).catch(() => null)) ?? undefined;
    if (!blob) { fehlend.push(d.name ?? 'Datei'); continue; }
    const url = await hochladen(token, n.id, blob, d.mime || blob.type);
    dateien.push({ id: n.id, name: d.name ?? 'Datei', mime: d.mime, groesse: blob.size, url });
  }
  fortschritt?.('Board …');
  const { geteiltVon: _g, geteiltVonName: _n, ...eigen } = ohneAuswahl(board) as BoardDoc & { geteiltVon?: string; geteiltVonName?: string };
  const boardUrl = await hochladen(token, 'board.json', JSON.stringify({ app: 'pixinotes-board', version: 2, board: eigen }), 'application/json');
  const res = await kontoAnfrage(`${basis()}/rest/v1/board_links?on_conflict=token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ token, board_id: boardId, name: board.name, board_url: boardUrl, dateien }),
  });
  eingerichtet(res);
  if (!res.ok) throw new Error(`Link nicht gespeichert (HTTP ${res.status}).`);
  const z = (await res.json()) as LinkZeile[];
  // Anhänge von Karten, die es nicht mehr gibt, aus der Fassung nehmen
  for (const a of alt?.dateien ?? []) if (!dateien.some((d) => d.id === a.id)) await entfernen(token, a.id);
  if (fehlend.length) useBoard.getState().showToast(`Nicht im Link: ${fehlend.join(', ')} — die Datei liegt auf diesem Gerät nicht vor.`, false, 8000);
  return z[0] ?? { token, board_id: boardId, name: board.name, board_url: boardUrl, dateien, updated_at: new Date().toISOString() };
}

/** Link löschen: Zeile und Dateien weg — wer den Link danach öffnet, bekommt nichts mehr */
export async function linkLoeschen(boardId: string): Promise<void> {
  const alt = await linkDesBoards(boardId);
  if (!alt) return;
  const res = await kontoAnfrage(`${basis()}/rest/v1/board_links?token=eq.${encodeURIComponent(alt.token)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Link nicht gelöscht (HTTP ${res.status}).`);
  await entfernen(alt.token, 'board.json');
  for (const d of alt.dateien) await entfernen(alt.token, d.id);
}

// ---------- Empfänger ----------

/** Beim App-Start: steht ein Link-Token in der Adresse? (#l=…) — wird sofort aus der Adresse genommen */
export function linkTokenAbholen(): string | null {
  const m = location.hash.match(/^#l=([A-Za-z0-9_-]{20,64})$/);
  if (!m) return null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* egal */ }
  return m[1];
}

interface Empfangen { boardId: string; stand: string }
function empfangenLesen(): Record<string, Empfangen> {
  try { return JSON.parse(localStorage.getItem(EMPFANGEN_KEY) ?? '{}') as Record<string, Empfangen>; } catch { return {}; }
}

/**
 * Einen Link öffnen: Fassung holen, als eigenes Board einhängen und öffnen; Anhänge laden im Hintergrund nach.
 * Wurde derselbe Link schon geöffnet und das Board gibt es noch, wird das geöffnet — außer es gibt eine
 * neuere Fassung: Dann fragt `neuerLaden`, ob sie (als weiteres Board) geladen werden soll.
 */
export async function linkOeffnen(token: string, neuerLaden: (name: string) => boolean = () => true): Promise<'geoeffnet' | 'vorhanden'> {
  const k = supabaseKonfig();
  if (!k.url || !k.key) throw new Error('Diese Fassung der App kennt den PixiNotes-Server nicht — den Link bitte auf der Web-Version öffnen.');
  let res: Response;
  try {
    res = await fetch(`${k.url}/rest/v1/rpc/link_lesen`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: k.key, Authorization: `Bearer ${k.key}` }, body: JSON.stringify({ p_token: token }) });
  } catch { throw new Error('Der Link ließ sich nicht laden — Internetverbindung prüfen.'); }
  if (res.status === 404) throw new Error('Link-Freigaben sind beim Betreiber noch nicht eingerichtet.');
  if (!res.ok) throw new Error(`Der Link ließ sich nicht laden (HTTP ${res.status}).`);
  const info = (await res.json()) as { name: string; board_url: string; dateien: LinkDatei[]; stand: string } | null;
  if (!info?.board_url) throw new Error('Diesen Link gibt es nicht mehr — er wurde gelöscht oder ist unvollständig.');

  const st = useBoard.getState();
  const bekannt = empfangenLesen()[token];
  if (bekannt && st.boards.some((b) => b.id === bekannt.boardId)) {
    if (bekannt.stand === info.stand || !neuerLaden(info.name)) {
      st.setView('board'); st.openBoard(bekannt.boardId);
      return 'vorhanden';
    }
  }
  const roh = await fetch(info.board_url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).catch(() => { throw new Error('Die geteilte Fassung ließ sich nicht laden — der Link wurde vermutlich gelöscht.'); });
  const board = parseBoardPayload(roh);
  if (!board) throw new Error('Die geteilte Fassung ist beschädigt.');
  const ids = new Map<string, string>();
  const kopie = cloneSharedBoard(board, ids);
  st.importBoard(kopie);
  const neu = useBoard.getState().activeId;
  try { localStorage.setItem(EMPFANGEN_KEY, JSON.stringify({ ...empfangenLesen(), [token]: { boardId: neu, stand: info.stand } })); } catch { /* voll */ }
  // Anhänge im Hintergrund: Das Board ist sofort da, die Dateien trudeln ein (die Karten zeigen sie, sobald sie liegen)
  void (async () => {
    let n = 0;
    for (const d of info.dateien ?? []) {
      const ziel = ids.get(d.id);
      if (!ziel) continue;
      try {
        const r = await fetch(d.url);
        if (!r.ok) continue;
        const blob = await r.blob();
        await saveFile(ziel, d.mime && blob.type !== d.mime ? new Blob([blob], { type: d.mime }) : blob);
        n += 1;
        window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
      } catch { /* eine klemmende Datei hält die anderen nicht auf */ }
    }
    if ((info.dateien ?? []).length > n) useBoard.getState().showToast(`${(info.dateien ?? []).length - n} Anhang/Anhänge ließen sich nicht laden.`, false, 6000);
  })();
  return 'geoeffnet';
}
