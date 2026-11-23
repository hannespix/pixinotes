// M328: Eigenes PixiNotes-Konto — Anmeldung mit E-Mail, Ablage bei Supabase.
//
// Warum: Der Konto-Sync (M317) braucht auf jedem Gerät Google Drive oder
// OneDrive. Auf einem fremden Tablet, einem Firmen-PC oder im Browser eines
// Freundes fehlt das. Ein eigenes Konto braucht nur eine E-Mail-Adresse.
//
// Was hier liegt: die schlanken REST-Aufrufe an Supabase — ohne SDK, damit
// das Paket klein bleibt und die Einzeldatei keine Abhängigkeit zieht.
//  · Auth (GoTrue): Link per E-Mail (Magic Link), E-Mail + Passwort,
//    Registrieren, Token erneuern, Nutzer lesen, Abmelden.
//  · Realtime: ein minimaler Phoenix-Kanal (WebSocket) auf die eigenen
//    Zeilen in `konto_dateien`. Fällt er aus, bleibt der 10-Sekunden-Takt.
// Die Ablage selbst (Tabelle + Storage-Bucket) spricht das Laufwerk in
// kontoSync.ts an — es ist dort der dritte Anbieter neben Google und Microsoft.
//
// Einrichtung durch den Betreiber: ein Supabase-Projekt, die Migration unter
// supabase/migrations, dann URL und Anon-Key als Repository-Variablen
// (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) — oder einmalig in ⚙ → Daten.

const env = import.meta.env as Record<string, string | undefined>;
const KONFIG_KEY = 'pixinotes-supabase';

export interface SupabaseKonfig { url: string; key: string }

/** Vorgabe aus dem Build (Repository-Variablen des Betreibers) */
export const vorgabeSupabase = (): SupabaseKonfig => ({ url: (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, ''), key: (env.VITE_SUPABASE_ANON_KEY ?? '').trim() });

/** Konfiguration: Vorgabe aus dem Build, sonst die einmalig hinterlegte — der Nutzer tippt nichts. */
export function supabaseKonfig(): SupabaseKonfig {
  const v = vorgabeSupabase();
  if (v.url && v.key) return v;
  try {
    const k = JSON.parse(localStorage.getItem(KONFIG_KEY) ?? 'null') as SupabaseKonfig | null;
    if (k?.url && k.key) return { url: k.url.trim().replace(/\/+$/, ''), key: k.key.trim() };
  } catch { /* egal */ }
  return { url: '', key: '' };
}
export function supabaseKonfigSpeichern(k: SupabaseKonfig): void {
  const url = k.url.trim().replace(/\/+$/, ''), key = k.key.trim();
  if (!url || !key) localStorage.removeItem(KONFIG_KEY);
  else localStorage.setItem(KONFIG_KEY, JSON.stringify({ url, key }));
}
export const supabaseKonfiguriert = (): boolean => { const k = supabaseKonfig(); return !!(k.url && k.key); };

/** Eine Sitzung, wie GoTrue sie liefert */
export interface SbSitzung { token: string; refreshToken: string; exp: number; userId: string; email?: string }

interface TokenAntwort { access_token?: string; refresh_token?: string; expires_in?: number; expires_at?: number; user?: { id?: string; email?: string }; error?: string; error_description?: string; msg?: string; message?: string; code?: string | number }

const fehlerText = (j: TokenAntwort, status: number): string => {
  const roh = j.error_description ?? j.msg ?? j.message ?? j.error ?? '';
  if (/invalid login credentials|invalid_grant/i.test(roh)) return 'E-Mail oder Passwort stimmen nicht.';
  if (/email not confirmed/i.test(roh)) return 'Die E-Mail-Adresse ist noch nicht bestätigt – bitte den Link aus der Mail öffnen.';
  if (/rate limit|too many/i.test(roh) || status === 429) return 'Zu viele Versuche – bitte kurz warten.';
  if (/user already registered|already been registered/i.test(roh)) return 'Für diese E-Mail gibt es schon ein Konto – bitte anmelden.';
  if (/signups not allowed/i.test(roh)) return 'Neue Konten sind beim Betreiber gerade nicht freigeschaltet.';
  if (/password should be|weak password/i.test(roh)) return 'Das Passwort ist zu kurz – mindestens 6 Zeichen.';
  if (/refresh_token|invalid refresh/i.test(roh)) return 'Anmeldung abgelaufen – bitte neu anmelden.';
  if (/unsupported provider|provider is not enabled/i.test(roh)) return ANBIETER_AUS_TEXT;
  if (/flow state|code verifier|auth code/i.test(roh)) return 'Die Anmeldung ist abgelaufen – bitte noch einmal auf „Mit Google anmelden" tippen.';
  return roh ? `PixiNotes-Konto: ${roh}` : `PixiNotes-Konto: HTTP ${status}`;
};

function sitzungAus(j: TokenAntwort): SbSitzung {
  if (!j.access_token || !j.refresh_token) throw new Error('PixiNotes-Konto: keine Sitzung erhalten.');
  const exp = j.expires_at ? j.expires_at * 1000 : Date.now() + ((j.expires_in ?? 3600) - 60) * 1000;
  return { token: j.access_token, refreshToken: j.refresh_token, exp, userId: j.user?.id ?? jwtSub(j.access_token), email: j.user?.email };
}
/** Die Nutzer-Id aus dem JWT (sub) — ohne Prüfung, nur zum Filtern der eigenen Zeilen */
export function jwtSub(token: string): string {
  try {
    const teil = token.split('.')[1] ?? '';
    const j = JSON.parse(atob(teil.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string };
    return j.sub ?? '';
  } catch { return ''; }
}

/** M388: Der Server war nicht erreichbar (kein Netz, 5xx) — das ist keine Absage */
export class NetzFehler extends Error {}

async function authRuf(pfad: string, body: unknown, k = supabaseKonfig()): Promise<TokenAntwort> {
  if (!k.url || !k.key) throw new Error('PixiNotes-Konto: Der Betreiber hat noch kein Konto-Backend hinterlegt.');
  let res: Response;
  try {
    res = await fetch(`${k.url}/auth/v1/${pfad}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: k.key }, body: JSON.stringify(body) });
  } catch {
    throw new NetzFehler('PixiNotes-Konto: nicht erreichbar – Internetverbindung prüfen.');
  }
  const j = (await res.json().catch(() => ({}))) as TokenAntwort;
  if (res.status >= 500) throw new NetzFehler('PixiNotes-Konto: vorübergehend nicht erreichbar.');
  if (!res.ok) throw new Error(fehlerText(j, res.status));
  return j;
}

/** Link per E-Mail schicken (Magic Link). Der Link führt zurück in die App; `sbRueckkehrLesen` nimmt ihn an. */
export async function sbLinkSenden(email: string): Promise<void> {
  const ziel = `${location.origin}${location.pathname}${location.search}`;
  linkErwartet();
  await authRuf(`otp?redirect_to=${encodeURIComponent(ziel)}`, { email: email.trim(), create_user: true, options: { email_redirect_to: ziel } });
}

/** Mit E-Mail und Passwort anmelden */
export async function sbPasswortAnmelden(email: string, passwort: string): Promise<SbSitzung> {
  const j = await authRuf('token?grant_type=password', { email: email.trim(), password: passwort });
  return sitzungAus(j);
}

/** Konto mit Passwort anlegen. Ist die Bestätigung per Mail an, kommt keine Sitzung — dann `null` (Hinweis anzeigen). */
export async function sbRegistrieren(email: string, passwort: string): Promise<SbSitzung | null> {
  const ziel = `${location.origin}${location.pathname}${location.search}`;
  linkErwartet();
  const j = await authRuf(`signup?redirect_to=${encodeURIComponent(ziel)}`, { email: email.trim(), password: passwort, options: { email_redirect_to: ziel } });
  if (!j.access_token) return null;
  return sitzungAus(j);
}

/** Sitzung still erneuern */
export async function sbErneuern(refreshToken: string, k = supabaseKonfig()): Promise<SbSitzung> {
  const j = await authRuf('token?grant_type=refresh_token', { refresh_token: refreshToken }, k);
  return sitzungAus(j);
}

/** E-Mail des angemeldeten Nutzers */
export async function sbNutzer(token: string, k = supabaseKonfig()): Promise<{ id?: string; email?: string } | null> {
  try {
    const res = await fetch(`${k.url}/auth/v1/user`, { headers: { apikey: k.key, Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return (await res.json()) as { id?: string; email?: string };
  } catch { return null; }
}

/** Abmelden beim Server (Refresh-Token ungültig machen) — Fehler sind egal.
 *  M388: nur DIESE Sitzung (scope=local). Ohne die Angabe meldet der Server alle Geräte des Kontos ab. */
export async function sbAbmelden(token: string, k = supabaseKonfig()): Promise<void> {
  try { await fetch(`${k.url}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: k.key, Authorization: `Bearer ${token}` } }); } catch { /* egal */ }
}

/** Konto samt aller Daten löschen (RPC konto_loeschen aus der Migration, läuft als Besitzer) */
export async function sbKontoLoeschen(token: string, k = supabaseKonfig()): Promise<void> {
  /* M388: Erst die Dateien im Dateispeicher (Anhänge, Tool-Quelltexte). Die Löschfunktion entfernt nur den Nutzer
     und seine Tabellenzeilen — die Dateien blieben beim Betreiber liegen, und wo der Speicher einen Nutzer mit
     Dateien schützt, scheiterte das Löschen des Kontos daran ganz. */
  const kopf = { apikey: k.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const ordner = jwtSub(token);
  if (ordner) {
    try {
      for (let runde = 0; runde < 50; runde += 1) {
        const l = await fetch(`${k.url}/storage/v1/object/list/pixinotes`, { method: 'POST', headers: kopf, body: JSON.stringify({ prefix: `${ordner}/`, limit: 500 }) });
        if (!l.ok) break;
        const namen = ((await l.json()) as Array<{ name?: string }>).map((o) => o.name).filter((n): n is string => !!n);
        if (namen.length === 0) break;
        const d = await fetch(`${k.url}/storage/v1/object/pixinotes`, { method: 'DELETE', headers: kopf, body: JSON.stringify({ prefixes: namen.map((n) => `${ordner}/${n}`) }) });
        if (!d.ok) break;
      }
    } catch { /* ohne Netz scheitert gleich auch das Löschen des Kontos — mit Meldung */ }
  }
  let res: Response;
  try {
    res = await fetch(`${k.url}/rest/v1/rpc/konto_loeschen`, { method: 'POST', headers: { apikey: k.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  } catch { throw new Error('PixiNotes-Konto: nicht erreichbar – Internetverbindung prüfen.'); }
  if (res.status === 404) throw new Error('PixiNotes-Konto: Das Löschen ist beim Betreiber noch nicht freigeschaltet (Funktion konto_loeschen fehlt). Bis dahin: Abmelden – oder dem Betreiber schreiben.');
  if (!res.ok) throw new Error(`PixiNotes-Konto: Löschen fehlgeschlagen (HTTP ${res.status}).`);
}

/**
 * Rückkehr vom E-Mail-Link: Supabase hängt die Sitzung an die Adresse
 * (#access_token=…&refresh_token=…&type=magiclink|signup|recovery). Liest sie
 * aus, räumt die Adresse auf und liefert die Sitzung — sonst null.
 */
/**
 * M388: Hat DIESES Gerät einen Anmelde-Link angefordert? Die Rückkehr-Adresse trägt eine fertige Sitzung — wer
 * jemandem einen Link mit seiner EIGENEN Sitzung schickt, meldete dessen Gerät damit in sein Konto ein, und die
 * Boards des Opfers wanderten dorthin. Ein Link, den dieses Gerät nicht selbst angefordert hat (oder der eine
 * bestehende Anmeldung ersetzen würde), wird darum erst nach Rückfrage angenommen (lib/kontoSync.ts).
 */
const LINK_KEY = 'pixinotes-sb-link';
function linkErwartet(): void { try { localStorage.setItem(LINK_KEY, String(Date.now())); } catch { /* ohne Merkzeichen kommt die Rückfrage */ } }
export function sbLinkWarErwartet(): boolean {
  try {
    const t = Number(localStorage.getItem(LINK_KEY) ?? 0);
    localStorage.removeItem(LINK_KEY);
    return t > 0 && Date.now() - t < 24 * 3600_000;
  } catch { return false; }
}

export function sbRueckkehrLesen(): SbSitzung | null {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  // M479: Auch eine Absage von Google kommt (beim impliziten Ablauf) als #error=… zurück — aber nur, wenn dieses
  // Gerät gerade eine Anmeldung über einen Anbieter begonnen hat; fremde #error-Adressen bleiben unberührt.
  const nurFehler = !/access_token=/.test(hash) && /(?:^|&)error(?:_description)?=/.test(hash) && oauthOffen();
  if (!/access_token=/.test(hash) && !nurFehler) return null;
  const p = new URLSearchParams(hash);
  const token = p.get('access_token'), refresh = p.get('refresh_token');
  const fehler = p.get('error_description') ?? p.get('error');
  try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* egal */ }
  try { localStorage.removeItem(PKCE_KEY); } catch { /* egal */ }   // M479: kam die Sitzung im Fragment, ist der Code-Weg erledigt
  if (fehler) throw new Error(oauthFehlerText(p.get('error') ?? '', fehler));
  if (!token || !refresh) return null;
  const expiresIn = Number(p.get('expires_in') ?? 3600);
  const expiresAt = Number(p.get('expires_at') ?? 0);
  return { token, refreshToken: refresh, exp: expiresAt ? expiresAt * 1000 : Date.now() + (expiresIn - 60) * 1000, userId: jwtSub(token) };
}

/* ───────────── M479: Mit Google (oder Microsoft) anmelden — über Supabase ───────────── */
//
// Warum: „google anmeldung fehlt noch! (per email adresse)". Die Drive-Verknüpfung (M317/M442) braucht eine
// Google-Client-ID im Build; die Anmeldung am PixiNotes-Konto über Supabase braucht nur, dass der Betreiber den
// Anbieter Google im Supabase-Dashboard einschaltet. Ablauf: Weiterleitung an /auth/v1/authorize mit PKCE
// (code_challenge) — Google zeigt die Kontowahl, vorgewählt mit der eingetippten Adresse (login_hint reicht
// Supabase an Google durch). Zurück kommt `?code=…`; der Tausch gegen die Sitzung braucht den hier gemerkten
// code_verifier, darum kann ein fremder Link dieses Gerät nicht in ein anderes Konto holen (vgl. M388). Liefert
// der Server doch eine Sitzung im Fragment (impliziter Ablauf), nimmt sie `sbRueckkehrLesen` wie beim E-Mail-Link.

export type SbAnbieter = 'google' | 'azure';
export const ANBIETER_AUS_TEXT = 'Google-Anmeldung ist beim Betreiber noch nicht eingeschaltet – bis dahin mit E-Mail-Link anmelden.';
const anbieterAusText = (a: SbAnbieter): string => (a === 'google' ? ANBIETER_AUS_TEXT : 'Microsoft-Anmeldung ist beim Betreiber noch nicht eingeschaltet – bis dahin mit E-Mail-Link anmelden.');
/** Der Anbieter ist im Supabase-Projekt nicht eingeschaltet — kein technischer Fehler, ein Hinweis für den Nutzer */
export class AnbieterAusFehler extends Error {}

const PKCE_KEY = 'pixinotes-sb-pkce';
interface PkceMerk { verifier: string; t: number; anbieter: SbAnbieter }
function pkceLesen(): PkceMerk | null {
  try {
    const m = JSON.parse(localStorage.getItem(PKCE_KEY) ?? 'null') as PkceMerk | null;
    if (m?.verifier && Date.now() - m.t < 3600_000) return m;
  } catch { /* unlesbar */ }
  return null;
}
const oauthOffen = (): boolean => !!pkceLesen();

function oauthFehlerText(code: string, beschreibung: string): string {
  const t = decodeURIComponent(beschreibung.replace(/\+/g, ' '));
  if (/unsupported provider|provider is not enabled/i.test(t)) return ANBIETER_AUS_TEXT;
  if (/access_denied/i.test(code) && !/email/i.test(t)) return 'Anmeldung abgebrochen – nichts geändert.';
  return `PixiNotes-Konto: ${t}`;
}

const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Welche Anmeldewege das Projekt eingeschaltet hat (öffentlich: GET /auth/v1/settings). null = nicht erreichbar */
export async function sbAnbieterAn(k = supabaseKonfig()): Promise<Record<string, boolean> | null> {
  if (!k.url || !k.key) return null;
  try {
    const res = await fetch(`${k.url}/auth/v1/settings`, { headers: { apikey: k.key } });
    if (!res.ok) return null;
    const j = (await res.json()) as { external?: Record<string, boolean> };
    return j.external && typeof j.external === 'object' ? j.external : null;
  } catch { return null; }
}

/** Die Adresse, zu der Google bzw. Supabase zurückleiten (ohne Fragment, ohne Reste einer früheren Rückkehr) */
function rueckkehrZiel(): string {
  const u = new URL(location.href);
  u.hash = '';
  for (const n of ['code', 'error', 'error_code', 'error_description', 'state']) u.searchParams.delete(n);
  return u.toString();
}

/**
 * Anmeldung über einen Anbieter beginnen: prüft, ob er eingeschaltet ist, merkt den code_verifier und leitet weiter.
 * Liefert die Ziel-Adresse (für Prüfreihen); `weiter = false` leitet nicht selbst weiter.
 */
export async function sbOAuthStarten(anbieter: SbAnbieter, hint?: string, weiter = true, k = supabaseKonfig()): Promise<string> {
  if (!k.url || !k.key) throw new Error('PixiNotes-Konto: Der Betreiber hat noch kein Konto-Backend hinterlegt.');
  if (!/^https?:$/.test(location.protocol)) throw new Error('Die Einzeldatei kann keine Anmeldung über Google – dafür die gehostete App nutzen oder mit E-Mail und Passwort anmelden.');
  const an = await sbAnbieterAn(k);
  // Nicht eingeschaltet: Supabase würde mit einer nackten JSON-Fehlerseite antworten (400 „Unsupported provider")
  if (an && an[anbieter] !== true) throw new AnbieterAusFehler(anbieterAusText(anbieter));
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  try { localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, t: Date.now(), anbieter } satisfies PkceMerk)); } catch { /* ohne Merkzeichen scheitert gleich der Tausch – mit Meldung */ }
  linkErwartet();
  const q = new URLSearchParams({ provider: anbieter, redirect_to: rueckkehrZiel(), code_challenge: challenge, code_challenge_method: 's256' });
  if (anbieter === 'azure') q.set('scopes', 'email');   // Microsoft liefert die Adresse sonst nicht mit
  const mail = (hint ?? '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) q.set('login_hint', mail);   // Supabase reicht weitere Parameter an Google durch
  const ziel = `${k.url}/auth/v1/authorize?${q.toString()}`;
  if (weiter) location.assign(ziel);
  return ziel;
}

/**
 * Rückkehr mit `?code=…` (PKCE): Liest Code bzw. Fehler aus der Adresse und räumt sie auf. Nur, wenn dieses Gerät
 * die Anmeldung begonnen hat — ein `?code=` anderer Herkunft (z. B. Microsoft-Popup, M184) bleibt unberührt.
 */
export function sbRueckkehrCode(): { code: string; verifier: string } | null {
  const merk = pkceLesen();
  if (!merk) return null;
  const p = new URLSearchParams(location.search);
  const code = p.get('code'), fehler = p.get('error_description') ?? p.get('error');
  if (!code && !fehler) return null;
  try {
    const u = new URL(location.href);
    for (const n of ['code', 'error', 'error_code', 'error_description', 'state']) u.searchParams.delete(n);
    history.replaceState(null, '', `${u.pathname}${u.search}${location.hash}`);
  } catch { /* egal */ }
  try { localStorage.removeItem(PKCE_KEY); } catch { /* egal */ }
  if (fehler) throw new Error(oauthFehlerText(p.get('error') ?? '', fehler));
  return code ? { code, verifier: merk.verifier } : null;
}

/** Code gegen die Sitzung tauschen (grant_type=pkce) */
export async function sbCodeTauschen(code: string, verifier: string, k = supabaseKonfig()): Promise<SbSitzung> {
  return sitzungAus(await authRuf('token?grant_type=pkce', { auth_code: code, code_verifier: verifier }, k));
}

/* ───────────── Realtime (Phoenix-Kanal, minimal) ───────────── */

export interface RealtimeGriff { stop(): void; token(neu: string): void; readonly verbunden: boolean }
/** Was der Kanal meldet: Tabelle, Dateiname (bei konto_dateien), Besitzer der Zeile, Art der Änderung */
export interface RealtimeEreignis { tabelle: string; name: string; userId: string; typ: string }

/**
 * Lauscht auf Änderungen der eigenen Zeilen in `konto_dateien`. Ruft `onChange`
 * mit dem Dateinamen — der Aufrufer entscheidet, ob er lesen muss. Verbindet
 * sich nach einem Abbruch mit wachsender Pause neu (bis 60 s). Kein Fehler
 * nach außen: ohne Realtime bleibt der Takt.
 */
export function sbRealtime(k: SupabaseKonfig, token: string, userId: string, onChange: (ev: RealtimeEreignis) => void, besitzer: string[] = [], email = '', holeToken?: () => Promise<string>): RealtimeGriff {
  let ws: WebSocket | null = null;
  let aktiv = true, verbunden = false, ref = 0, pause = 1000;
  let herz: ReturnType<typeof setInterval> | undefined;
  let neuTimer: ReturnType<typeof setTimeout> | undefined;
  let jwt = token;
  const topic = 'realtime:konto';
  const senden = (ev: string, payload: unknown, t = topic) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ref += 1;
    ws.send(JSON.stringify({ topic: t, event: ev, payload, ref: String(ref), ...(ev === 'phx_join' ? { join_ref: String(ref) } : {}) }));
  };
  const verbinden = () => {
    if (!aktiv || typeof WebSocket === 'undefined') return;
    const url = `${k.url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(k.key)}&vsn=1.0.0`;
    try { ws = new WebSocket(url); } catch { return; }
    ws.onopen = () => {
      pause = 1000;
      // Eigene Zeilen, die Zeilen der Besitzer geteilter Boards (RLS lässt nur die freigegebenen durch) und die Freigaben selbst
      const aenderungen = [
        { event: '*', schema: 'public', table: 'konto_dateien', filter: `user_id=eq.${userId}` },
        ...besitzer.filter((b) => b && b !== userId).map((b) => ({ event: '*', schema: 'public', table: 'konto_dateien', filter: `user_id=eq.${b}` })),
        { event: '*', schema: 'public', table: 'board_freigaben', filter: `gast_id=eq.${userId}` },
        { event: '*', schema: 'public', table: 'board_freigaben', filter: `besitzer=eq.${userId}` },
        // Eine neue Einladung trägt noch keine gast_id — sie kommt über die E-Mail (RLS lässt sie durch)
        ...(email ? [{ event: '*', schema: 'public', table: 'board_freigaben', filter: `gast_email=eq.${email.toLowerCase()}` }] : []),
      ];
      /* M388: mit einem GÜLTIGEN Token beitreten. Nach mehr als einer Stunde Pause war das gemerkte abgelaufen — der
         Beitritt wurde abgewiesen, niemand versuchte es erneut, und die Antwort auf den Herzschlag ließ die Anzeige
         trotzdem „live verbunden" melden. */
      const beitreten = () => senden('phx_join', { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: aenderungen }, access_token: jwt });
      if (holeToken) void holeToken().then((t) => { jwt = t; }).catch(() => { /* dann mit dem gemerkten */ }).finally(beitreten);
      else beitreten();
      clearInterval(herz);
      // M364: spätestens alle 25 s (Supabase trennt sonst) — vorher 30 s, der Kanal riss regelmäßig ab
      herz = setInterval(() => senden('heartbeat', {}, 'phoenix'), 20_000);
    };
    ws.onmessage = (m) => {
      try {
        const j = JSON.parse(String(m.data)) as { topic?: string; event?: string; payload?: { status?: string; data?: { type?: string; table?: string; record?: { name?: string; user_id?: string; besitzer?: string }; old_record?: { name?: string; user_id?: string; besitzer?: string } } } };
        // nur die Antwort auf den eigenen Kanal zählt; eine Absage → neu verbinden (mit Pause, dann frischem Token)
        if (j.event === 'phx_reply' && j.topic === topic) {
          if (j.payload?.status === 'ok') verbunden = true;
          else if (j.payload?.status === 'error') { verbunden = false; try { ws?.close(); } catch { /* egal */ } }
        }
        if (j.event === 'postgres_changes') {
          const d = j.payload?.data;
          const r = d?.record ?? d?.old_record ?? {};
          onChange({ tabelle: d?.table ?? 'konto_dateien', name: r.name ?? '', userId: r.user_id ?? r.besitzer ?? '', typ: d?.type ?? '' });
        }
      } catch { /* egal */ }
    };
    ws.onclose = () => {
      verbunden = false;
      clearInterval(herz);
      if (!aktiv) return;
      neuTimer = setTimeout(verbinden, pause);
      pause = Math.min(pause * 2, 60_000);
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* egal */ } };
  };
  verbinden();
  return {
    stop() { aktiv = false; clearInterval(herz); clearTimeout(neuTimer); try { ws?.close(); } catch { /* egal */ } ws = null; },
    token(neu) { jwt = neu; senden('access_token', { access_token: neu }); },
    get verbunden() { return verbunden; },
  };
}
