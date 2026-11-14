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
  if (/email not confirmed/i.test(roh)) return 'Die E-Mail-Adresse ist noch nicht bestätigt — bitte den Link aus der Mail öffnen.';
  if (/rate limit|too many/i.test(roh) || status === 429) return 'Zu viele Versuche — bitte kurz warten.';
  if (/user already registered|already been registered/i.test(roh)) return 'Für diese E-Mail gibt es schon ein Konto — bitte anmelden.';
  if (/signups not allowed/i.test(roh)) return 'Neue Konten sind beim Betreiber gerade nicht freigeschaltet.';
  if (/password should be|weak password/i.test(roh)) return 'Das Passwort ist zu kurz — mindestens 6 Zeichen.';
  if (/refresh_token|invalid refresh/i.test(roh)) return 'Anmeldung abgelaufen — bitte neu anmelden.';
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

async function authRuf(pfad: string, body: unknown, k = supabaseKonfig()): Promise<TokenAntwort> {
  if (!k.url || !k.key) throw new Error('PixiNotes-Konto: Der Betreiber hat noch kein Konto-Backend hinterlegt.');
  let res: Response;
  try {
    res = await fetch(`${k.url}/auth/v1/${pfad}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: k.key }, body: JSON.stringify(body) });
  } catch {
    throw new Error('PixiNotes-Konto: nicht erreichbar — Internetverbindung prüfen.');
  }
  const j = (await res.json().catch(() => ({}))) as TokenAntwort;
  if (!res.ok) throw new Error(fehlerText(j, res.status));
  return j;
}

/** Link per E-Mail schicken (Magic Link). Der Link führt zurück in die App; `sbRueckkehrLesen` nimmt ihn an. */
export async function sbLinkSenden(email: string): Promise<void> {
  const ziel = `${location.origin}${location.pathname}${location.search}`;
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

/** Abmelden beim Server (Refresh-Token ungültig machen) — Fehler sind egal */
export async function sbAbmelden(token: string, k = supabaseKonfig()): Promise<void> {
  try { await fetch(`${k.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: k.key, Authorization: `Bearer ${token}` } }); } catch { /* egal */ }
}

/** Konto samt aller Daten löschen (RPC konto_loeschen aus der Migration, läuft als Besitzer) */
export async function sbKontoLoeschen(token: string, k = supabaseKonfig()): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${k.url}/rest/v1/rpc/konto_loeschen`, { method: 'POST', headers: { apikey: k.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  } catch { throw new Error('PixiNotes-Konto: nicht erreichbar — Internetverbindung prüfen.'); }
  if (res.status === 404) throw new Error('PixiNotes-Konto: Das Löschen ist beim Betreiber noch nicht freigeschaltet (Funktion konto_loeschen fehlt). Bis dahin: Abmelden — oder dem Betreiber schreiben.');
  if (!res.ok) throw new Error(`PixiNotes-Konto: Löschen fehlgeschlagen (HTTP ${res.status}).`);
}

/**
 * Rückkehr vom E-Mail-Link: Supabase hängt die Sitzung an die Adresse
 * (#access_token=…&refresh_token=…&type=magiclink|signup|recovery). Liest sie
 * aus, räumt die Adresse auf und liefert die Sitzung — sonst null.
 */
export function sbRueckkehrLesen(): SbSitzung | null {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!/access_token=/.test(hash)) return null;
  const p = new URLSearchParams(hash);
  const token = p.get('access_token'), refresh = p.get('refresh_token');
  const fehler = p.get('error_description') ?? p.get('error');
  try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* egal */ }
  if (fehler) throw new Error(`PixiNotes-Konto: ${decodeURIComponent(fehler.replace(/\+/g, ' '))}`);
  if (!token || !refresh) return null;
  const expiresIn = Number(p.get('expires_in') ?? 3600);
  const expiresAt = Number(p.get('expires_at') ?? 0);
  return { token, refreshToken: refresh, exp: expiresAt ? expiresAt * 1000 : Date.now() + (expiresIn - 60) * 1000, userId: jwtSub(token) };
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
export function sbRealtime(k: SupabaseKonfig, token: string, userId: string, onChange: (ev: RealtimeEreignis) => void, besitzer: string[] = [], email = ''): RealtimeGriff {
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
      senden('phx_join', { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: aenderungen }, access_token: jwt });
      clearInterval(herz);
      // M364: spätestens alle 25 s (Supabase trennt sonst) — vorher 30 s, der Kanal riss regelmäßig ab
      herz = setInterval(() => senden('heartbeat', {}, 'phoenix'), 20_000);
    };
    ws.onmessage = (m) => {
      try {
        const j = JSON.parse(String(m.data)) as { event?: string; payload?: { status?: string; data?: { type?: string; table?: string; record?: { name?: string; user_id?: string; besitzer?: string }; old_record?: { name?: string; user_id?: string; besitzer?: string } } } };
        if (j.event === 'phx_reply' && j.payload?.status === 'ok') verbunden = true;
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
