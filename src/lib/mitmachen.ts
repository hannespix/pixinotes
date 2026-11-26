// M513: Mitmachen per QR — der leichte Teil fürs Board (Karte, App). Das Protokoll steht in mitmachenProtokoll.ts,
// der Gastgeber (Kanal, Prüfen, Schreiben) in mitmachenHost.ts und lädt erst, wenn eine Runde läuft.
//
// In der Karte steht nur, DASS eine Runde läuft: `mitmachen = { token, k, an, t, buehne? }` (k = Abdruck des
// öffentlichen Schlüssels, mit dem die Teilnehmer-Seite die Signatur des Gastgebers prüft). Der private Schlüssel bleibt auf dem Gerät, das die Runde geöffnet hat
// (localStorage) — nur dieses Gerät ist Gastgeber. Andere Geräte im Board sehen die Beiträge über den normalen
// Abgleich der Karte.
import { supabaseKonfig, vorgabeSupabase } from './kontoSupabase';
import { linkBauen, signierSchluessel, zufall, type MitLink } from './mitmachenProtokoll';
import { lookAktiv } from './boardLook';
import { useBoard } from '../store';

export const MITMACHEN_KEY = 'pixinotes-mitmachen';
/** Teilnehmerzahl oder Verbindung einer Runde hat sich geändert (detail: { token }) */
export const MITMACHEN_EREIGNIS = 'pixinotes:mitmachen';
/** Web-Adresse der App — für Links aus der portablen Datei (file://), die selbst keine Adresse hat */
export const WEB_ADRESSE = 'https://hannespix.github.io/pixinotes/';

export interface MitmachenKarte {
  token: string; k: string; an: boolean; t: number; buehne?: boolean;
  /** M520: Kennung der Karte, in der die Runde geöffnet wurde (fehlt bei Runden von vor M520) */
  karte?: string;
}
/**
 * Was dieses Gerät sich je Runde merkt. M531: `ende` (ohne Schlüssel) = die Karte wurde hier gelöscht, die Runde ist
 * vorbei. Holt Strg+Z die Karte zurück, steht in ihren Daten noch „an" — der Vermerk sagt, dass niemand mehr
 * Gastgeber ist (`hierBeendet`).
 */
interface Gemerkt { jwk?: JsonWebKey; board: string; karte: string; seit: number; ende?: number }

/**
 * Die Runde einer Karte. M520: `karte` = Kennung der fragenden Karte. Eine KOPIE (Duplizieren, Board kopieren,
 * Vorlage, Import) trägt dasselbe Feld wie ihr Original — sie zeigte denselben Code, und wer ihn scannte, schrieb
 * in die Ur-Karte. Steht im Feld eine andere Karte, gibt es für die fragende Karte keine Runde.
 */
export function mitmachenVon(data: unknown, karte?: string): MitmachenKarte | null {
  const m = (data as { mitmachen?: Partial<MitmachenKarte> } | null)?.mitmachen;
  if (!m || typeof m.token !== 'string' || typeof m.k !== 'string') return null;
  if (karte && typeof m.karte === 'string' && m.karte !== karte) return null;
  return { token: m.token, k: m.k, an: !!m.an, t: Number(m.t) || 0, ...(m.buehne ? { buehne: true } : {}), ...(typeof m.karte === 'string' ? { karte: m.karte } : {}) };
}
export function gemerkt(): Record<string, Gemerkt> {
  try { const r = JSON.parse(localStorage.getItem(MITMACHEN_KEY) ?? '{}') as Record<string, Gemerkt>; return r && typeof r === 'object' ? r : {}; } catch { return {}; }
}
export function gemerktSetzen(m: Record<string, Gemerkt>): void {
  try { if (Object.keys(m).length) localStorage.setItem(MITMACHEN_KEY, JSON.stringify(m)); else localStorage.removeItem(MITMACHEN_KEY); } catch { /* voll */ }
}
/** Ist dieses Gerät Gastgeber der Runde dieser Karte? */
export const hierGastgeber = (token: string | undefined, karte: string): boolean => {
  const e = token ? gemerkt()[token] : undefined;
  return !!e && e.karte === karte && !e.ende;
};
/** M531: Ging die Runde dieser Karte auf diesem Gerät zu Ende (Karte gelöscht), auch wenn die Karte noch „an" sagt? */
export const hierBeendet = (token: string | undefined, karte: string): boolean => {
  const e = token ? gemerkt()[token] : undefined;
  return !!e && e.karte === karte && !!e.ende;
};

/**
 * Link zur Teilnehmer-Seite. Look: Gibt das Board einen Look mit (M509), reist er mit (Hell/Dunkel, Design, Akzent);
 * sonst nur das Design dieses Geräts — Hell/Dunkel folgt dann dem Telefon.
 */
export function mitmachenLink(m: Pick<MitmachenKarte, 'token' | 'k'>, boardId?: string): string {
  const basis = /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname.replace(/[^/]*$/, '')}` : WEB_ADRESSE;
  const k = supabaseKonfig(); const v = vorgabeSupabase();
  const l: MitLink = {
    token: m.token, schluessel: m.k,
    ...lookFuerLink(boardId),
    // Server nur mitschicken, wenn er nicht der vorgegebene dieser Fassung ist (sonst wird der Code unnötig groß)
    ...(k.url && (k.url !== v.url || k.key !== v.key) ? { sb: k } : {}),
  };
  return linkBauen(basis, l);
}

function lookFuerLink(boardId: string | undefined): Pick<MitLink, 'design' | 'thema' | 'akzent'> {
  const look = boardId ? useBoard.getState().boards.find((b) => b.id === boardId)?.look : undefined;
  if (lookAktiv(look)) {
    return {
      ...(look.design === 'pixel' || look.design === 'agency' ? { design: look.design } : {}),
      ...(look.theme === 'light' || look.theme === 'dark' ? { thema: look.theme } : {}),
      ...((look.design ?? 'klassisch') === 'klassisch' && look.accent && look.accent !== 'blau' ? { akzent: look.accent } : {}),
    };
  }
  // M547: auch Agency reist mit (pix·el seit M507)
  const d = document.documentElement.dataset.design;
  return d === 'pixel' || d === 'agency' ? { design: d } : {};
}

// ───── Teilnehmerzahl (vom Gastgeber gefüllt) ─────
const zahlen = new Map<string, { dabei: number; verbunden: boolean }>();
export const mitmachenStand = (token: string | undefined): { dabei: number; verbunden: boolean } => (token && zahlen.get(token)) || { dabei: 0, verbunden: false };
export function mitmachenStandSetzen(token: string, dabei: number, verbunden: boolean): void {
  const alt = zahlen.get(token);
  if (alt && alt.dabei === dabei && alt.verbunden === verbunden) return;
  zahlen.set(token, { dabei, verbunden });
  window.dispatchEvent(new CustomEvent(MITMACHEN_EREIGNIS, { detail: { token } }));
}

/** Gastgeber nachladen und abgleichen (welche Runden laufen auf diesem Gerät?) */
export const gastgeberLaden = (): Promise<void> => import('./mitmachenHost').then((m) => m.mitmachenDienste());

/**
 * Eine neue Runde öffnen: Schlüssel erzeugen, privat merken, die Karte vermerken und den Gastgeber starten.
 * `schreiben` setzt Daten an der Karte (die Karte ruft es mit ihrem eigenen Schreibweg auf).
 */
export async function mitmachenOeffnen(board: string, karte: string, schreiben: (m: MitmachenKarte) => void): Promise<MitmachenKarte> {
  const s = await signierSchluessel();
  const token = zufall(16);
  const g = gemerkt();
  // Alte, beendete Runden dieser Karte vergessen
  for (const [t, e] of Object.entries(g)) if (e.karte === karte) delete g[t];
  g[token] = { jwk: s.privat, board, karte, seit: Date.now() };
  gemerktSetzen(g);
  const m: MitmachenKarte = { token, k: s.abdruck, an: true, t: Date.now(), karte };
  schreiben(m);
  await gastgeberLaden();
  return m;
}
