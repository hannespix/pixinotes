// Kalender-Konten (Google Kalender, Microsoft 365/Outlook) — komplett lokal:
// - Die Zugangsdaten (Tokens) liegen in einem EIGENEN localStorage-Schlüssel,
//   NICHT im Board-Store → sie können konstruktionsbedingt nie in Share-Links,
//   Sync-Dateien oder Exporten landen (dieselbe Regel wie bei den KI-Keys).
// - Es gibt keinen PixiNotes-Server: Der Login läuft direkt zwischen Browser
//   und Google/Microsoft (OAuth), gelesen wird über deren CORS-fähige APIs.
// - Voraussetzung: Die App läuft über http(s) (gehostete PWA). Unter file://
//   ist kein OAuth-Redirect möglich → dort bleibt das ICS-Abo der Weg.
// - Die Client-ID/App-ID trägt die eigene IT ein (Google Cloud Console bzw.
//   Azure-App-Registrierung als "SPA") — PixiNotes liefert bewusst keine
//   eingebaute ID aus, damit die Behörde die Kontrolle behält.

const LS_KEY = 'pixinotes-cal-accounts';

export interface CalAccountEvent {
  date: string;        // yyyy-mm-dd (Starttag)
  title: string;
  time?: string;       // hh:mm, wenn kein Ganztagstermin
  provider: 'google' | 'ms';
}

export interface GoogleAccount {
  clientId: string;
  token?: string;
  tokenExp?: number;      // epoch ms
  connectedAs?: string;   // Kalender-Name des Primärkalenders (Anzeige)
  calendars?: Array<{ id: string; name: string; enabled: boolean }>;
}

export interface MsAccount {
  clientId: string;
  tenant?: string;        // Azure-Tenant, default 'common' bzw. 'organizations'
  token?: string;
  tokenExp?: number;
  refreshToken?: string;
  connectedAs?: string;
}

export interface CalAccounts {
  google?: GoogleAccount;
  ms?: MsAccount;
}

export function loadCalAccounts(): CalAccounts {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as CalAccounts;
  } catch {
    return {};
  }
}

export function saveCalAccounts(acc: CalAccounts) {
  localStorage.setItem(LS_KEY, JSON.stringify(acc));
  // Kalender-Karten lauschen darauf (gleiche Seite → kein natives storage-Event)
  window.dispatchEvent(new CustomEvent('pixinotes-cal-accounts'));
}

export function patchCalAccounts(patch: Partial<CalAccounts>) {
  saveCalAccounts({ ...loadCalAccounts(), ...patch });
}

/** OAuth braucht eine echte Web-Origin — unter file:// gibt es keine. */
export const oauthAvailable = () => /^https?:$/.test(window.location.protocol);

const googleConnected = (a?: GoogleAccount) => !!a?.token;
const msConnected = (a?: MsAccount) => !!(a?.token || a?.refreshToken);
export const anyAccountConnected = () => {
  const acc = loadCalAccounts();
  return googleConnected(acc.google) || msConnected(acc.ms);
};

// ---------------------------------------------------------------- Google ----
// Google Identity Services (GIS) — das offizielle Browser-SDK wird erst beim
// Klick auf „Verbinden" nachgeladen (online ist man für OAuth ohnehin).
// Web-SPAs bekommen bei Google nur Access-Tokens (~1 h); Verlängerung läuft
// über einen stillen Re-Request, sonst „erneut verbinden".

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void;
          }) => { requestAccessToken: (over?: { prompt?: string }) => void };
        };
      };
    };
  }
}

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisLoading = null; reject(new Error('Google-Anmeldedienst nicht erreichbar (offline oder blockiert).')); };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

/** Interaktiv mit Google verbinden (Popup). Speichert Token + Kalenderliste. */
export async function connectGoogle(clientId: string): Promise<string> {
  if (!oauthAvailable()) throw new Error('Anmelden geht nur über die gehostete App (http/https), nicht aus der Einzeldatei.');
  await loadGis();
  const token = await new Promise<{ access_token: string; expires_in: number }>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) reject(new Error(`Google-Anmeldung abgebrochen (${resp.error ?? 'kein Token'})`));
        else resolve({ access_token: resp.access_token, expires_in: resp.expires_in ?? 3600 });
      },
    });
    client.requestAccessToken();
  });
  const acc: GoogleAccount = {
    clientId,
    token: token.access_token,
    tokenExp: Date.now() + (token.expires_in - 60) * 1000,
  };
  // Kalenderliste holen (Name des Primärkalenders = Anzeige „verbunden als")
  const list = await googleApi<{ items?: Array<{ id: string; summary: string; primary?: boolean }> }>(
    acc, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=50',
  );
  acc.calendars = (list.items ?? []).map((c) => ({ id: c.id, name: c.summary, enabled: !!c.primary }));
  acc.connectedAs = list.items?.find((c) => c.primary)?.summary ?? list.items?.[0]?.summary;
  patchCalAccounts({ google: acc });
  return acc.connectedAs ?? 'Google-Kalender';
}

/** Stiller Token-Refresh (ohne Popup); wirft, wenn eine neue Anmeldung nötig ist. */
async function refreshGoogle(acc: GoogleAccount): Promise<GoogleAccount> {
  await loadGis();
  const token = await new Promise<{ access_token: string; expires_in: number }>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: acc.clientId,
      scope: GOOGLE_SCOPE,
      prompt: '',
      callback: (resp) => {
        if (resp.error || !resp.access_token) reject(new Error('Google-Sitzung abgelaufen — bitte in den Einstellungen neu verbinden.'));
        else resolve({ access_token: resp.access_token, expires_in: resp.expires_in ?? 3600 });
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
  const next = { ...acc, token: token.access_token, tokenExp: Date.now() + (token.expires_in - 60) * 1000 };
  patchCalAccounts({ google: next });
  return next;
}

async function googleApi<T>(acc: GoogleAccount, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${acc.token}` } });
  if (res.status === 401) throw new AuthExpired('google');
  if (!res.ok) throw new Error(`Google Kalender: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ------------------------------------------------------------- Microsoft ----
// Roher OAuth-2.0-PKCE-Flow gegen Microsoft Identity Platform (v2.0) — die
// App selbst ist die Redirect-URI: Öffnet sich PixiNotes im Popup mit ?code=…,
// reicht handleOAuthRedirect() den Code ans Hauptfenster durch und schließt.

const MS_SCOPE = 'Calendars.Read offline_access';

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

const redirectUri = () => window.location.origin + window.location.pathname;

/**
 * MUSS früh beim App-Start laufen: Sind wir das OAuth-Popup (?code=&state=),
 * Code ans Hauptfenster melden und Fenster schließen. Gibt true zurück, wenn
 * diese Seite nur als Redirect-Ziel diente (App dann nicht weiter rendern).
 */
export function handleOAuthRedirect(): boolean {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state || !state.startsWith('pixinotes-ms-') || !window.opener) return false;
  (window.opener as Window).postMessage({ type: 'pixinotes-oauth', code, state }, window.location.origin);
  document.body.textContent = 'Anmeldung erfolgreich — dieses Fenster kann geschlossen werden.';
  setTimeout(() => window.close(), 400);
  return true;
}

/** Interaktiv mit Microsoft 365 verbinden (Popup, PKCE ohne Client-Secret). */
export async function connectMicrosoft(clientId: string, tenant = 'common'): Promise<string> {
  if (!oauthAvailable()) throw new Error('Anmelden geht nur über die gehostete App (http/https), nicht aus der Einzeldatei.');
  const { verifier, challenge } = await pkcePair();
  const state = `pixinotes-ms-${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const auth = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  auth.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: MS_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  const popup = window.open(auth.toString(), 'pixinotes-ms-login', 'width=520,height=680');
  if (!popup) throw new Error('Popup blockiert — bitte Popups für diese Seite erlauben.');

  const code = await new Promise<string>((resolve, reject) => {
    const timer = window.setInterval(() => {
      if (popup.closed) { cleanup(); reject(new Error('Anmeldung abgebrochen.')); }
    }, 500);
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; code?: string; state?: string };
      if (d?.type !== 'pixinotes-oauth' || d.state !== state || !d.code) return;
      cleanup();
      resolve(d.code);
    };
    const cleanup = () => { window.clearInterval(timer); window.removeEventListener('message', onMsg); };
    window.addEventListener('message', onMsg);
  });

  const acc = await msToken(clientId, tenant, {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier,
  });
  // Anzeige-Name des Postfachs holen
  try {
    const me = await msApi<{ userPrincipalName?: string; displayName?: string }>(acc, 'https://graph.microsoft.com/v1.0/me');
    acc.connectedAs = me.displayName || me.userPrincipalName;
    patchCalAccounts({ ms: acc });
  } catch { /* Anzeige-Name ist optional */ }
  return acc.connectedAs ?? 'Microsoft 365';
}

async function msToken(clientId: string, tenant: string, body: Record<string, string>): Promise<MsAccount> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: MS_SCOPE, ...body }).toString(),
  });
  const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Microsoft-Anmeldung fehlgeschlagen: ${data.error_description?.split(/\r?\n/)[0] ?? `HTTP ${res.status}`}`);
  }
  const acc: MsAccount = {
    clientId, tenant,
    token: data.access_token,
    refreshToken: data.refresh_token,
    tokenExp: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    connectedAs: loadCalAccounts().ms?.connectedAs,
  };
  patchCalAccounts({ ms: acc });
  return acc;
}

async function refreshMicrosoft(acc: MsAccount): Promise<MsAccount> {
  if (!acc.refreshToken) throw new Error('Microsoft-Sitzung abgelaufen — bitte in den Einstellungen neu verbinden.');
  return msToken(acc.clientId, acc.tenant ?? 'common', {
    grant_type: 'refresh_token', refresh_token: acc.refreshToken,
  });
}

async function msApi<T>(acc: MsAccount, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${acc.token}`, Prefer: 'outlook.timezone="Europe/Berlin"' } });
  if (res.status === 401) throw new AuthExpired('ms');
  if (!res.ok) throw new Error(`Microsoft Graph: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ------------------------------------------------------------ Event-Fetch ----

class AuthExpired extends Error {
  constructor(public provider: 'google' | 'ms') { super('Token abgelaufen'); }
}

/** Token-Gültigkeit sicherstellen (stiller Refresh), sonst Fehler mit Klartext. */
async function freshGoogle(): Promise<GoogleAccount | null> {
  const acc = loadCalAccounts().google;
  if (!acc?.token) return null;
  if (acc.tokenExp && acc.tokenExp > Date.now()) return acc;
  return refreshGoogle(acc);
}

async function freshMs(): Promise<MsAccount | null> {
  const acc = loadCalAccounts().ms;
  if (!acc || (!acc.token && !acc.refreshToken)) return null;
  if (acc.token && acc.tokenExp && acc.tokenExp > Date.now()) return acc;
  return refreshMicrosoft(acc);
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Kleiner Bereichs-Cache (5 min) — die Kalender-Karte rendert oft
const cache = new Map<string, { at: number; events: CalAccountEvent[] }>();
const CACHE_MS = 5 * 60 * 1000;

/** Alle Termine der verbundenen Konten im Zeitraum [from, to] (inklusive). */
export async function fetchAccountEvents(from: Date, to: Date, force = false): Promise<{ events: CalAccountEvent[]; errors: string[] }> {
  const key = `${isoDay(from)}|${isoDay(to)}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return { events: hit.events, errors: [] };

  const events: CalAccountEvent[] = [];
  const errors: string[] = [];
  const timeMin = new Date(from.getFullYear(), from.getMonth(), from.getDate()).toISOString();
  const timeMax = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).toISOString();

  const jobs: Array<Promise<void>> = [];

  jobs.push((async () => {
    try {
      let acc = await freshGoogle();
      if (!acc) return;
      const calendars = (acc.calendars ?? []).filter((c) => c.enabled);
      for (const cal of calendars) {
        const run = async (a: GoogleAccount) => googleApi<{ items?: Array<{ summary?: string; start?: { date?: string; dateTime?: string } }> }>(
          a,
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${new URLSearchParams({
            timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', fields: 'items(summary,start)',
          })}`,
        );
        let data;
        try {
          data = await run(acc);
        } catch (e) {
          if (!(e instanceof AuthExpired)) throw e;
          acc = await refreshGoogle(acc);
          data = await run(acc);
        }
        for (const ev of data.items ?? []) {
          const dt = ev.start?.dateTime;
          const date = ev.start?.date ?? (dt ? isoDay(new Date(dt)) : undefined);
          if (!date) continue;
          events.push({
            date,
            title: ev.summary || '(ohne Titel)',
            time: dt ? `${pad(new Date(dt).getHours())}:${pad(new Date(dt).getMinutes())}` : undefined,
            provider: 'google',
          });
        }
      }
    } catch (e) {
      errors.push(`Google: ${(e as Error).message}`);
    }
  })());

  jobs.push((async () => {
    try {
      let acc = await freshMs();
      if (!acc) return;
      const run = async (a: MsAccount) => msApi<{ value?: Array<{ subject?: string; isAllDay?: boolean; start?: { dateTime?: string } }> }>(
        a,
        `https://graph.microsoft.com/v1.0/me/calendarview?${new URLSearchParams({
          startDateTime: timeMin, endDateTime: timeMax, $top: '200', $select: 'subject,start,isAllDay', $orderby: 'start/dateTime',
        })}`,
      );
      let data;
      try {
        data = await run(acc);
      } catch (e) {
        if (!(e instanceof AuthExpired)) throw e;
        acc = await refreshMicrosoft(acc);
        data = await run(acc);
      }
      for (const ev of data.value ?? []) {
        const dt = ev.start?.dateTime;
        if (!dt) continue;
        // Graph liefert (per Prefer-Header) lokale Zeit ohne Offset
        events.push({
          date: dt.slice(0, 10),
          title: ev.subject || '(ohne Titel)',
          time: ev.isAllDay ? undefined : dt.slice(11, 16),
          provider: 'ms',
        });
      }
    } catch (e) {
      errors.push(`Microsoft: ${(e as Error).message}`);
    }
  })());

  await Promise.all(jobs);
  if (errors.length === 0) cache.set(key, { at: Date.now(), events });
  return { events, errors };
}

/** Cache verwerfen (manueller ⟳ in der Kalender-Karte). */
export function invalidateAccountEvents() {
  cache.clear();
}

export function disconnect(provider: 'google' | 'ms') {
  const acc = loadCalAccounts();
  delete acc[provider];
  saveCalAccounts(acc);
  cache.clear();
}
