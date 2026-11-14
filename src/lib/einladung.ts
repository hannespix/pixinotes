// M360: Einladungslink für ein geteiltes Board — gemeinsam arbeiten, ohne E-Mail-Adressen einzutippen.
//
// Die Freigabe für ein Konto (M330) verlangte bisher die E-Mail jeder einzelnen Person. Mit dem Einladungslink
// legt der Besitzer je Board EIN Token an (Tabelle `board_einladungen`) und gibt `…#e=<token>` weiter. Wer den
// Link öffnet und mit dem PixiNotes-Konto angemeldet ist, wird über `einladung_annehmen` als Gast eingetragen —
// mit der Rolle des Links (bearbeiten oder nur lesen). Danach läuft alles wie bei M330: Das Board erscheint unter
// „Geteilt mit mir", Änderungen kommen live. Wer noch nicht angemeldet ist, behält die Einladung (localStorage)
// und nimmt sie nach der Anmeldung an.
//
// Abgrenzung: „Per Link teilen" (M357, #l=) gibt eine KOPIE weiter, ohne Konto. Dieser Link führt aufs ORIGINAL.
import { useBoard } from '../store';
import { checkKontoRemote, kontoAnfrage, loadKonto, type FreigabeRolle } from './kontoSync';
import { gastBeitreten, kontoKanaele } from './gastSync';

const OFFEN_KEY = 'pixinotes-einladung-offen';

/** `ohne_konto` (M364): Wer den Link öffnet, arbeitet sofort mit — ohne Anmeldung. Fehlt das Feld, kennt der Server es noch nicht. */
export interface Einladung { token: string; board_id: string; rolle: FreigabeRolle; created_at: string; ohne_konto?: boolean }

export const einladungUrl = (token: string): string => `${location.origin}${location.pathname}#e=${token}`;
const rest = (): string => `${loadKonto()?.url ?? ''}/rest/v1`;
const KOPF = { 'Content-Type': 'application/json' };

/** Der Server kennt Einladungslinks noch nicht (Tabelle `board_einladungen` fehlt) — der Dialog blendet den Abschnitt dann aus */
export class EinladungNichtEingerichtet extends Error { constructor() { super('Einladungslinks sind auf dem Server noch nicht eingerichtet.'); } }

function neuesToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Der Einladungslink eines eigenen Boards — oder null */
export async function einladungDesBoards(boardId: string): Promise<Einladung | null> {
  const s = loadKonto();
  if (s?.anbieter !== 'supabase') return null;
  const res = await kontoAnfrage(`${rest()}/board_einladungen?select=*&board_id=eq.${encodeURIComponent(boardId)}&besitzer=eq.${encodeURIComponent(s.userId ?? '')}`, { cache: 'no-store' });
  if (res.status === 404) throw new EinladungNichtEingerichtet();
  if (!res.ok) throw new Error(`Einladungslink nicht lesbar (HTTP ${res.status}).`);
  const z = (await res.json()) as Einladung[];
  return z[0] ?? null;
}

/** Link anlegen oder Rolle bzw. „ohne Konto" ändern (das Token bleibt — schon verschickte Links gelten weiter) */
export async function einladungSetzen(boardId: string, rolle: FreigabeRolle, ohneKonto?: boolean): Promise<Einladung> {
  if (loadKonto()?.anbieter !== 'supabase') throw new Error('Einladungslinks gibt es mit dem PixiNotes-Konto (E-Mail-Anmeldung).');
  const alt = await einladungDesBoards(boardId);
  const res = await kontoAnfrage(`${rest()}/board_einladungen?on_conflict=besitzer,board_id`, {
    method: 'POST', headers: { ...KOPF, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ token: alt?.token ?? neuesToken(), board_id: boardId, rolle, ...(ohneKonto === undefined ? {} : { ohne_konto: ohneKonto }) }),
  });
  if (res.status === 404) throw new EinladungNichtEingerichtet();
  if (res.status === 400 && ohneKonto !== undefined) throw new Error('Gäste ohne Konto sind auf dem Server noch nicht eingerichtet.');
  if (!res.ok) throw new Error(`Einladungslink nicht gespeichert (HTTP ${res.status}).`);
  const z = (await res.json()) as Einladung[];
  void kontoKanaele();   // M364: Live-Kanal dieses Boards öffnen
  return z[0];
}

/** Link widerrufen — wer schon beigetreten ist, bleibt (steht in der Liste und lässt sich dort entfernen) */
export async function einladungLoeschen(boardId: string): Promise<void> {
  const s = loadKonto();
  if (s?.anbieter !== 'supabase') return;
  const res = await kontoAnfrage(`${rest()}/board_einladungen?board_id=eq.${encodeURIComponent(boardId)}&besitzer=eq.${encodeURIComponent(s.userId ?? '')}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Einladungslink nicht gelöscht (HTTP ${res.status}).`);
  void kontoKanaele();
}

// ---------- Empfänger ----------

/** `#e=<token>` aus der Adresse nehmen (und die Adresse aufräumen) */
export function einladungTokenAbholen(): string | null {
  const m = /^#e=([A-Za-z0-9_-]{16,64})$/.exec(location.hash);
  if (!m) return null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* egal */ }
  return m[1];
}
export const einladungOffen = (): string | null => { try { return localStorage.getItem(OFFEN_KEY); } catch { return null; } };
export function einladungMerken(token: string | null): void {
  try { if (token) localStorage.setItem(OFFEN_KEY, token); else localStorage.removeItem(OFFEN_KEY); } catch { /* voll */ }
}

export type AnnahmeErgebnis =
  | { art: 'beigetreten'; boardId: string; rolle: FreigabeRolle; von?: string }
  | { art: 'eigen'; boardId: string }
  /** M364: ohne Konto eingewählt (der Link erlaubt es) */
  | { art: 'gast'; boardId: string; rolle: FreigabeRolle; schonDa: boolean }
  | { art: 'anmelden' };

/**
 * Eine Einladung annehmen. Ohne PixiNotes-Konto bleibt sie gemerkt ('anmelden') und wird nach der Anmeldung
 * angenommen. Danach holt der Abgleich das Board und es wird geöffnet.
 */
export async function einladungAnnehmen(token: string): Promise<AnnahmeErgebnis> {
  // M364: Ohne PixiNotes-Konto zuerst als Gast versuchen — erlaubt der Link das, ist man sofort dabei
  const alsGast = async (): Promise<AnnahmeErgebnis> => {
    const g = await gastBeitreten(token);
    if (g) { einladungMerken(null); return { art: 'gast', boardId: g.boardId, rolle: g.rolle, schonDa: g.art === 'vorhanden' }; }
    einladungMerken(token);
    return { art: 'anmelden' };
  };
  if (loadKonto()?.anbieter !== 'supabase') return alsGast();
  let res: Response;
  try {
    res = await kontoAnfrage(`${rest()}/rpc/einladung_annehmen`, { method: 'POST', headers: KOPF, body: JSON.stringify({ p_token: token }) });
  } catch { throw new Error('Die Einladung ließ sich nicht annehmen — Internetverbindung prüfen.'); }
  if (res.status === 404) { einladungMerken(null); throw new EinladungNichtEingerichtet(); }
  if (res.status === 401) return alsGast();
  if (!res.ok) throw new Error(`Die Einladung ließ sich nicht annehmen (HTTP ${res.status}).`);
  const info = (await res.json()) as { board_id: string; rolle: FreigabeRolle; eigen?: boolean; besitzer_email?: string } | null;
  einladungMerken(null);
  if (!info?.board_id) throw new Error('Diese Einladung gibt es nicht mehr — der Link wurde widerrufen.');
  const st = useBoard.getState();
  if (info.eigen) {
    if (st.boards.some((b) => b.id === info.board_id)) { st.setView('board'); st.openBoard(info.board_id); }
    return { art: 'eigen', boardId: info.board_id };
  }
  // Das Board kommt mit dem nächsten Abgleich — gleich anstoßen und öffnen, sobald es da ist
  await checkKontoRemote(true).catch(() => null);
  const oeffnen = (): boolean => {
    const s = useBoard.getState();
    if (!s.boards.some((b) => b.id === info.board_id)) return false;
    s.setView('board'); s.openBoard(info.board_id);
    return true;
  };
  if (!oeffnen()) {
    // Mitten im Tippen oder ein zweiter Abgleich lief gerade: kurz nachfassen
    for (let i = 0; i < 6 && !oeffnen(); i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      await checkKontoRemote(true).catch(() => null);
    }
  }
  return { art: 'beigetreten', boardId: info.board_id, rolle: info.rolle === 'lesen' ? 'lesen' : 'bearbeiten', von: info.besitzer_email };
}
