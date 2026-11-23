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
  /**
   * M471: Kennung beim Anbieter, Ende, Ort und Web-Link. Fehlen bei Einträgen aus der Zeit vor M471 (Zwischenspeicher
   * Fassung 1) — alles Lesende muss ohne sie auskommen.
   */
  id?: string;
  /** hh:mm Ende (Ortszeit), nur bei Zeitterminen */
  end?: string;
  /** yyyy-mm-dd letzter Tag (inklusiv), nur wenn er nach dem Starttag liegt */
  endDate?: string;
  /** ganztägig (ohne Uhrzeit) */
  allDay?: boolean;
  place?: string;
  /** Adresse des Termins bei Google/Outlook — erst beim Anzeigen über lib/sicher.ts (fremdeWebAdresse) geprüft */
  link?: string;
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
  /** M184: Tatsächlich erteilte Berechtigungen. Fehlt der Eintrag, stammt die
   *  Verbindung aus der Zeit vor dem OneNote-Import und kann nur Kalender. */
  scopes?: string;
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
            /** M442: E-Mail-Adresse — Google wählt dieses Konto vor (kein Konto-Wählen, kein Tippen) */
            login_hint?: string;
            callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
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

/**
 * M317: Google-Zugriffs-Token für einen Berechtigungs-Satz — interaktiv (Popup)
 * oder still (`still`: prompt ''). Baustein für Kalender UND Konto-Sync.
 * Kann GIS das Popup nicht öffnen (außerhalb einer Geste geblockt), meldet
 * `error_callback` — sonst hinge das Versprechen für immer.
 */
export async function googleTokenFuer(clientId: string, scope: string, still: boolean, hint?: string): Promise<{ token: string; exp: number }> {
  if (!oauthAvailable()) throw new Error('Anmelden geht nur über die gehostete App (http/https), nicht aus der Einzeldatei.');
  await loadGis();
  const t = await new Promise<{ access_token: string; expires_in: number }>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      ...(still ? { prompt: '' } : {}),
      ...(hint ? { login_hint: hint } : {}),
      callback: (resp) => {
        if (resp.error || !resp.access_token) reject(new Error(still ? 'Google-Sitzung abgelaufen – bitte neu anmelden.' : `Google-Anmeldung abgebrochen (${resp.error ?? 'kein Token'})`));
        else resolve({ access_token: resp.access_token, expires_in: resp.expires_in ?? 3600 });
      },
      error_callback: (err) => reject(new Error(still ? 'Google-Sitzung abgelaufen – bitte neu anmelden.' : `Google-Anmeldung abgebrochen (${err.type ?? err.message ?? 'Popup'})`)),
    });
    client.requestAccessToken(still ? { prompt: '' } : undefined);
  });
  return { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
}

/** Interaktiv mit Google verbinden (Popup). Speichert Token + Kalenderliste. */
export async function connectGoogle(clientId: string, hint?: string): Promise<string> {
  if (!oauthAvailable()) throw new Error('Anmelden geht nur über die gehostete App (http/https), nicht aus der Einzeldatei.');
  await loadGis();
  const token = await new Promise<{ access_token: string; expires_in: number }>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPE,
      ...(hint ? { login_hint: hint } : {}),
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
/**
 * M473: Ohne Antwort von GIS (Fenster geblockt, Dienst hängt) gibt die Erneuerung nach dieser Zeit auf — vorher
 * fehlte `error_callback`, und ein geblocktes Fenster ließ den Abruf für immer warten.
 */
const GOOGLE_ERNEUERN_MS = 20_000;
const GOOGLE_ABGELAUFEN = 'Google-Sitzung abgelaufen – bitte in den Einstellungen neu verbinden.';

async function refreshGoogle(acc: GoogleAccount): Promise<GoogleAccount> {
  await loadGis();
  const token = await new Promise<{ access_token: string; expires_in: number }>((resolve, reject) => {
    const uhr = window.setTimeout(() => reject(new Error(GOOGLE_ABGELAUFEN)), GOOGLE_ERNEUERN_MS);
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: acc.clientId,
      scope: GOOGLE_SCOPE,
      prompt: '',
      callback: (resp) => {
        window.clearTimeout(uhr);
        if (resp.error || !resp.access_token) reject(new Error(GOOGLE_ABGELAUFEN));
        else resolve({ access_token: resp.access_token, expires_in: resp.expires_in ?? 3600 });
      },
      error_callback: () => { window.clearTimeout(uhr); reject(new Error(GOOGLE_ABGELAUFEN)); },
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
/** M184: zusätzlich Lesezugriff auf die eigenen OneNote-Notizbücher.
 *  Bewusst ein EIGENER Satz: Bestehende Verbindungen behalten ihren alten
 *  Umfang — würde man ihn global erweitern, verweigerte Microsoft beim nächsten
 *  stillen Erneuern das Token („consent required") und der Kalender fiele aus. */
const MS_SCOPE_NOTES = 'Calendars.Read Notes.Read offline_access';

/** Deckt die Verbindung den OneNote-Lesezugriff ab? */
export function msHasNotes(acc = loadCalAccounts().ms): boolean {
  return !!acc && /Notes\.Read/i.test(acc.scopes ?? '');
}

/** M466: Deckt die Verbindung das Lesen des Postfachs (Outlook-Mails) ab? */
export function msHasMail(acc = loadCalAccounts().ms): boolean {
  return !!acc && (!!acc.token || !!acc.refreshToken) && /Mail\.Read/i.test(acc.scopes ?? '');
}

/**
 * M466: Berechtigungs-Satz aus Bausteinen. Ohne OneNote und Postfach bleibt es exakt der alte Satz (MS_SCOPE) —
 * bestehende Verbindungen erneuern damit weiter still. Das Postfach braucht User.Read für den Anzeigenamen.
 */
function msScope(notes: boolean, mail: boolean): string {
  if (!notes && !mail) return MS_SCOPE;
  if (!mail) return MS_SCOPE_NOTES;
  return ['Calendars.Read', notes ? 'Notes.Read' : '', mail ? 'Mail.Read User.Read' : '', 'offline_access'].filter(Boolean).join(' ');
}

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
  document.body.textContent = 'Anmeldung erfolgreich – dieses Fenster kann geschlossen werden.';
  setTimeout(() => window.close(), 400);
  return true;
}

/**
 * Interaktiv mit Microsoft 365 verbinden (Popup, PKCE ohne Client-Secret).
 * `withNotes` fragt zusätzlich den OneNote-Lesezugriff ab (M184).
 */
export async function connectMicrosoft(clientId: string, tenant = 'common', withNotes = false, opts: { mail?: boolean; hint?: string } = {}): Promise<string> {
  // M466: `opts.mail` fragt zusätzlich das Lesen des Postfachs ab (Outlook-Fenster); `hint` wählt das Konto vor.
  // Was dieselbe App schon darf, bleibt dabei: OneNote freischalten nimmt das Postfach nicht weg und umgekehrt.
  const alt = loadCalAccounts().ms;
  const gleich = alt?.clientId === clientId;
  const scope = msScope(withNotes || (gleich && msHasNotes(alt)), !!opts.mail || (gleich && msHasMail(alt)));
  const roh = await msAnmeldung(clientId, tenant, scope, opts.hint);
  const acc: MsAccount = {
    clientId, tenant, token: roh.token, refreshToken: roh.refreshToken, tokenExp: roh.exp,
    connectedAs: loadCalAccounts().ms?.connectedAs, scopes: roh.scopes,
  };
  patchCalAccounts({ ms: acc });
  // Anzeige-Name des Postfachs holen
  try {
    const me = await msApi<{ userPrincipalName?: string; displayName?: string }>(acc, 'https://graph.microsoft.com/v1.0/me');
    acc.connectedAs = me.displayName || me.userPrincipalName;
    patchCalAccounts({ ms: acc });
  } catch { /* Anzeige-Name ist optional */ }
  return acc.connectedAs ?? 'Microsoft 365';
}

/** Rohes Token-Paket — für Kalender UND Konto-Sync (M317) */
export interface MsRohToken { token: string; refreshToken?: string; exp: number; scopes: string }

/**
 * M317: Microsoft-Anmeldung als Baustein — Popup (PKCE ohne Client-Secret) plus
 * Code-Tausch, OHNE die Kalender-Konten anzufassen. `connectMicrosoft` baut
 * darauf auf; der Konto-Sync ebenso, mit seinem eigenen Berechtigungs-Satz.
 */
export async function msAnmeldung(clientId: string, tenant = 'common', scope = MS_SCOPE, hint?: string): Promise<MsRohToken> {
  if (!oauthAvailable()) throw new Error('Anmelden geht nur über die gehostete App (http/https), nicht aus der Einzeldatei.');
  const { verifier, challenge } = await pkcePair();
  const state = `pixinotes-ms-${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const auth = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  auth.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // M466: E-Mail-Adresse → Microsoft wählt dieses Konto vor
    ...(hint ? { login_hint: hint } : {}),
  }).toString();

  const popup = window.open(auth.toString(), 'pixinotes-ms-login', 'width=520,height=680');
  if (!popup) throw new Error('Popup blockiert – bitte Popups für diese Seite erlauben.');

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

  return msTokenAnfrage(clientId, tenant, {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier,
  }, scope);
}

/** M317: Token mit dem Refresh-Token erneuern — ohne die Kalender-Konten anzufassen. */
export function msTokenErneuern(clientId: string, tenant: string, refreshToken: string, scope: string): Promise<MsRohToken> {
  return msTokenAnfrage(clientId, tenant, { grant_type: 'refresh_token', refresh_token: refreshToken }, scope);
}

async function msTokenAnfrage(clientId: string, tenant: string, body: Record<string, string>, scope: string): Promise<MsRohToken> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope, ...body }).toString(),
  });
  const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Microsoft-Anmeldung fehlgeschlagen: ${data.error_description?.split(/\r?\n/)[0] ?? `HTTP ${res.status}`}`);
  }
  return {
    token: data.access_token,
    refreshToken: data.refresh_token,
    exp: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    // Was Microsoft WIRKLICH erteilt hat (kann weniger sein als angefragt)
    scopes: data.scope ?? scope,
  };
}

async function msToken(clientId: string, tenant: string, body: Record<string, string>, scope = MS_SCOPE): Promise<MsAccount> {
  const roh = await msTokenAnfrage(clientId, tenant, body, scope);
  const acc: MsAccount = {
    clientId, tenant,
    token: roh.token,
    refreshToken: roh.refreshToken,
    tokenExp: roh.exp,
    connectedAs: loadCalAccounts().ms?.connectedAs,
    scopes: roh.scopes,
  };
  patchCalAccounts({ ms: acc });
  return acc;
}

async function refreshMicrosoft(acc: MsAccount): Promise<MsAccount> {
  if (!acc.refreshToken) throw new Error('Microsoft-Sitzung abgelaufen – bitte in den Einstellungen neu verbinden.');
  // WICHTIG: mit dem GESPEICHERTEN Umfang erneuern. Würde hier pauschal der
  // erweiterte Satz stehen, verweigerte Microsoft bei Konten ohne
  // OneNote-Zustimmung das Token — und der Kalender fiele mit aus.
  return msToken(acc.clientId, acc.tenant ?? 'common', {
    grant_type: 'refresh_token', refresh_token: acc.refreshToken,
  }, acc.scopes ?? MS_SCOPE);
}

/**
 * Gültiges Zugriffs-Token für Graph-Aufrufe außerhalb dieses Moduls (M184).
 * Erneuert still, wenn nötig, und meldet fehlende Berechtigungen im Klartext.
 */
export async function msAccessToken(needNotes = false): Promise<string> {
  const acc = loadCalAccounts().ms;
  if (!acc || (!acc.token && !acc.refreshToken)) {
    throw new Error('Kein Microsoft-Konto verbunden – in den Einstellungen unter „Kalender" verbinden.');
  }
  if (needNotes && !msHasNotes(acc)) {
    throw new Error('Die Verbindung hat noch keinen Zugriff auf OneNote – in den Einstellungen einmal „Mit OneNote verbinden" wählen.');
  }
  const fresh = acc.token && acc.tokenExp && acc.tokenExp > Date.now() ? acc : await refreshMicrosoft(acc);
  if (!fresh.token) throw new Error('Microsoft-Sitzung abgelaufen – bitte neu verbinden.');
  return fresh.token;
}

async function msApi<T>(acc: MsAccount, url: string, zeitzone = 'Europe/Berlin'): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${acc.token}`, Prefer: `outlook.timezone="${zeitzone}"` } });
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
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const tagVerschieben = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};

/**
 * M471: Zeitangabe von Graph. Mit `Prefer: outlook.timezone="UTC"` kommt Weltzeit ohne Versatz („…T08:30:00.0000000",
 * timeZone „UTC") — dann rechnet Date in die Ortszeit. Ohne Zonenangabe gilt die Zeit, wie sie dasteht (Wandzeit).
 */
function msZeit(z?: { dateTime?: string; timeZone?: string }): Date | null {
  if (!z?.dateTime) return null;
  const roh = z.dateTime.slice(0, 19);
  const welt = /^(utc|etc\/utc|coordinated universal time)$/i.test(z.timeZone ?? '') || /[zZ]$/.test(z.dateTime);
  const d = new Date(welt ? `${roh}Z` : roh);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** M471: Zusatzfelder säubern — leere weglassen, Längen begrenzen, Enddatum nur nach dem Starttag */
function termFelder(f: { id?: string; end?: string; endDate?: string; allDay: boolean; place?: string; link?: string; date: string }): Partial<CalAccountEvent> {
  const aus: Partial<CalAccountEvent> = {};
  if (typeof f.id === 'string' && f.id) aus.id = f.id.slice(0, 300);
  if (f.end) aus.end = f.end;
  if (f.endDate && f.endDate > f.date) aus.endDate = f.endDate;
  if (f.allDay) aus.allDay = true;
  if (typeof f.place === 'string' && f.place.trim()) aus.place = f.place.trim().slice(0, 200);
  if (typeof f.link === 'string' && /^https:\/\//i.test(f.link)) aus.link = f.link.slice(0, 2000);
  return aus;
}

// Kleiner Bereichs-Cache (5 min) — die Kalender-Karte rendert oft
const cache = new Map<string, { at: number; events: CalAccountEvent[] }>();
const CACHE_MS = 5 * 60 * 1000;

/**
 * Alle Termine der verbundenen Konten im Zeitraum [from, to] (inklusive).
 * M471: `opts.still` = Hintergrund-Abruf ohne Nutzer-Geste.
 * M473: Auch im Hintergrund wird ein abgelaufenes Token erneuert (Google still über GIS, Outlook über das
 * Refresh-Token) — wie beim Öffnen der Kalender-Karte. Scheitert das, merkt sich die App den Hinweis
 * (kontoHinweise()), den die Aufgaben-Zentrale leise zeigt; der nächste gelungene Abruf nimmt ihn zurück.
 */
export async function fetchAccountEvents(from: Date, to: Date, force = false, opts: { still?: boolean } = {}): Promise<{ events: CalAccountEvent[]; errors: string[] }> {
  const key = `${isoDay(from)}|${isoDay(to)}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return { events: hit.events, errors: [] };

  const events: CalAccountEvent[] = [];
  const errors: string[] = [];
  const timeMin = new Date(from.getFullYear(), from.getMonth(), from.getDate()).toISOString();
  const timeMax = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).toISOString();

  const jobs: Array<Promise<void>> = [];
  /** M473: Konten, deren Token sich nicht erneuern ließ */
  const ohneErneuerung = new Set<'google' | 'ms'>();
  const erneuert = async <T>(konto: 'google' | 'ms', f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) { ohneErneuerung.add(konto); throw e; }
  };

  jobs.push((async () => {
    try {
      const erst = await erneuert('google', freshGoogle);
      if (!erst?.token) return;
      let acc: GoogleAccount = erst;
      const calendars = (acc.calendars ?? []).filter((c) => c.enabled);
      for (const cal of calendars) {
        type GZeit = { date?: string; dateTime?: string };
        const run = async (a: GoogleAccount) => googleApi<{ items?: Array<{ id?: string; summary?: string; start?: GZeit; end?: GZeit; location?: string; htmlLink?: string }> }>(
          a,
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${new URLSearchParams({
            timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
            // M471: Kennung, Ende, Ort und Web-Link mitnehmen
            fields: 'items(id,summary,start,end,location,htmlLink)',
          })}`,
        );
        let data;
        try {
          data = await run(acc);
        } catch (e) {
          if (!(e instanceof AuthExpired)) throw e;
          const a = acc;
          acc = await erneuert('google', () => refreshGoogle(a));
          data = await run(acc);
        }
        for (const ev of data.items ?? []) {
          const dt = ev.start?.dateTime;
          const date = ev.start?.date ?? (dt ? isoDay(new Date(dt)) : undefined);
          if (!date) continue;
          // Zeittermine tragen einen Versatz („+01:00") → new Date rechnet in die Ortszeit des Geräts
          const ende = ev.end?.dateTime ? new Date(ev.end.dateTime) : undefined;
          // Ganztägiges Ende ist bei Google exklusiv (Tag danach)
          const endTag = ev.end?.date ? tagVerschieben(ev.end.date, -1) : ende ? isoDay(ende) : undefined;
          events.push({
            date,
            title: (ev.summary || '(ohne Titel)').slice(0, 200),
            time: dt ? hhmm(new Date(dt)) : undefined,
            provider: 'google',
            ...termFelder({
              id: ev.id, end: ende ? hhmm(ende) : undefined, endDate: endTag, allDay: !dt,
              place: ev.location, link: ev.htmlLink, date,
            }),
          });
        }
      }
    } catch (e) {
      errors.push(`Google: ${(e as Error).message}`);
    }
  })());

  jobs.push((async () => {
    try {
      let acc = await erneuert('ms', freshMs);
      if (!acc) return;
      type MZeit = { dateTime?: string; timeZone?: string };
      const run = async (a: MsAccount) => msApi<{ value?: Array<{ id?: string; subject?: string; isAllDay?: boolean; start?: MZeit; end?: MZeit; location?: { displayName?: string }; webLink?: string }> }>(
        a,
        `https://graph.microsoft.com/v1.0/me/calendarview?${new URLSearchParams({
          startDateTime: timeMin, endDateTime: timeMax, $top: '200',
          // M471: Kennung, Ende, Ort und Web-Link mitnehmen
          $select: 'id,subject,start,end,isAllDay,location,webLink', $orderby: 'start/dateTime',
        })}`,
        // M471: Weltzeit anfordern und hier in die Ortszeit des Geräts rechnen — „Europe/Berlin" fest stimmte nur dort
        'UTC',
      );
      let data;
      try {
        data = await run(acc);
      } catch (e) {
        if (!(e instanceof AuthExpired)) throw e;
        const a = acc;
        acc = await erneuert('ms', () => refreshMicrosoft(a));
        data = await run(acc);
      }
      for (const ev of data.value ?? []) {
        const beginn = msZeit(ev.start);
        if (!beginn) continue;
        const ende = msZeit(ev.end);
        // Ganztägiges steht bei Graph als Mitternacht bis Mitternacht (Ende exklusiv) — der Tag gilt, wie er dasteht
        const date = ev.isAllDay ? ev.start!.dateTime!.slice(0, 10) : isoDay(beginn);
        const endTag = ev.isAllDay
          ? (ev.end?.dateTime ? tagVerschieben(ev.end.dateTime.slice(0, 10), -1) : undefined)
          : ende ? isoDay(ende) : undefined;
        events.push({
          date,
          title: (ev.subject || '(ohne Titel)').slice(0, 200),
          time: ev.isAllDay ? undefined : hhmm(beginn),
          provider: 'ms',
          ...termFelder({
            id: ev.id, end: !ev.isAllDay && ende ? hhmm(ende) : undefined, endDate: endTag, allDay: !!ev.isAllDay,
            place: ev.location?.displayName, link: ev.webLink, date,
          }),
        });
      }
    } catch (e) {
      errors.push(`Microsoft: ${(e as Error).message}`);
    }
  })());

  await Promise.all(jobs);
  if (errors.length === 0) cache.set(key, { at: Date.now(), events });
  // M469: Für die Aufgaben-Zentrale merken — je Konto, das geantwortet hat (ein abgelaufenes
  // Google-Konto soll die Outlook-Termine nicht mit ins Leere reißen)
  const fehlgeschlagen = new Set<'google' | 'ms'>();
  for (const f of errors) fehlgeschlagen.add(f.startsWith('Google') ? 'google' : 'ms');
  if (fehlgeschlagen.size < 2) termineMerken(isoDay(from), isoDay(to), events, fehlgeschlagen);
  hinweiseFuehren(fehlgeschlagen, ohneErneuerung, !!opts.still);
  return { events, errors };
}

// ------------------------------------------------- Gemerkte Termine (M469) ----
// Die Aufgaben-Zentrale zeigt „Termine heute und morgen" und kann kurz vor
// Beginn erinnern — dafür darf sie beim Start KEINEN neuen Abruf auslösen
// (m446). Deshalb merkt sich jeder erfolgreiche Abruf (Kalender-Karte,
// Zentrale) die Termine der nächsten Wochen in einem eigenen Schlüssel —
// wie die Tokens nie im Board, Sync, Link oder Export.
const TERMINE_KEY = 'pixinotes-cal-termine';
export const TERMINE_EREIGNIS = 'pixinotes-cal-termine';
const TERMINE_VOR = 1;    // Tage zurück, die aufgehoben werden
const TERMINE_NACH = 62;  // Tage voraus — genug für Heute/Morgen, ohne den Speicher zu füllen
/** M471: aktuelle Fassung des Zwischenspeichers (siehe GemerkteTermine.v) */
export const TERMINE_FASSUNG = 2;

export interface GemerkteTermine {
  /** M471: Fassung des Zwischenspeichers — 1 (M469: nur Tag, Uhrzeit, Titel, Konto) oder 2 (mit Kennung, Ende, Ort, Link) */
  v: number;
  /** Zeitpunkt des letzten erfolgreichen Abrufs, der heute abdeckte (epoch ms) */
  stand: number;
  /** abgedeckte Tage (yyyy-mm-dd) → Termine dieses Tages */
  tage: Record<string, CalAccountEvent[]>;
}

export function gemerkteTermine(): GemerkteTermine {
  try {
    const roh = JSON.parse(localStorage.getItem(TERMINE_KEY) ?? 'null') as GemerkteTermine | null;
    if (roh && typeof roh === 'object' && roh.tage && typeof roh.tage === 'object') {
      return { v: Number(roh.v) || 1, stand: Number(roh.stand) || 0, tage: roh.tage };
    }
  } catch { /* defekt → leer */ }
  return { v: TERMINE_FASSUNG, stand: 0, tage: {} };
}

function termineSchreiben(g: GemerkteTermine) {
  try {
    localStorage.setItem(TERMINE_KEY, JSON.stringify(g));
  } catch { /* M388: Speicher voll — die Kalender-Karte zeigt trotzdem */ }
  window.dispatchEvent(new CustomEvent(TERMINE_EREIGNIS));
}

function termineMerken(vonIso: string, bisIso: string, events: CalAccountEvent[], fehlgeschlagen: Set<'google' | 'ms'>) {
  const jetzt = new Date();
  const min = isoDay(new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - TERMINE_VOR));
  const max = isoDay(new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + TERMINE_NACH));
  const alt = gemerkteTermine();
  const tage: GemerkteTermine['tage'] = {};
  for (const [tag, liste] of Object.entries(alt.tage)) {
    if (tag < min || tag > max || !Array.isArray(liste)) continue;
    // Im abgerufenen Bereich bleiben nur Termine der Konten, die diesmal nicht geantwortet haben
    tage[tag] = tag < vonIso || tag > bisIso ? liste : liste.filter((e) => fehlgeschlagen.has(e.provider));
  }
  // Jeder Tag des Abrufs gilt als abgedeckt — auch ohne Termin (leere Liste = „sicher nichts")
  const lauf = new Date(`${vonIso}T12:00:00`);
  for (let i = 0; i < 400; i += 1) {
    const tag = isoDay(lauf);
    if (tag > bisIso) break;
    if (tag >= min && tag <= max && !tage[tag]) tage[tag] = [];
    lauf.setDate(lauf.getDate() + 1);
  }
  for (const ev of events) {
    const eintrag: CalAccountEvent = { date: ev.date, title: ev.title, time: ev.time, provider: ev.provider };
    for (const k of ['id', 'end', 'endDate', 'allDay', 'place', 'link'] as const) if (ev[k] !== undefined) (eintrag as unknown as Record<string, unknown>)[k] = ev[k];
    // M471: Mehrtägiges steht an jedem abgedeckten Tag (Eintrag bleibt der des Beginns; Lesende sehen am Tag ≠ date die Fortsetzung)
    const bis = ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date;
    const lauf2 = new Date(`${ev.date}T12:00:00`);
    for (let i = 0; i < 60; i += 1) {
      const tag = isoDay(lauf2);
      if (tag > bis) break;
      if (tage[tag] && tag >= vonIso && tag <= bisIso) tage[tag].push(eintrag);
      lauf2.setDate(lauf2.getDate() + 1);
    }
  }
  const heute = isoDay(jetzt);
  // Fassung 1 gilt als veraltet: ihr Stand zählt nicht — das nächste Öffnen holt Ende, Ort und Link nach
  termineSchreiben({ v: TERMINE_FASSUNG, stand: vonIso <= heute && bisIso >= heute ? Date.now() : alt.v === TERMINE_FASSUNG ? alt.stand : 0, tage });
}

// ------------------------------------------- Hinweis „Anmeldung abgelaufen" (M473) ----
// Scheitert die Erneuerung im Hintergrund (Fenster ohne Geste geblockt, Zugriff entzogen), soll die Zentrale das
// leise sagen statt still mit alten Terminen zu erinnern. Nur der Name des Kontos wird gemerkt, nie ein Token.
const HINWEIS_KEY = 'pixinotes:konto-hinweis';

/** Konten, deren Anmeldung im Hintergrund nicht erneuert werden konnte */
export function kontoHinweise(): Array<'google' | 'ms'> {
  try {
    const roh = JSON.parse(localStorage.getItem(HINWEIS_KEY) ?? '[]') as unknown;
    return Array.isArray(roh) ? roh.filter((k): k is 'google' | 'ms' => k === 'google' || k === 'ms') : [];
  } catch { return []; }
}

function hinweiseSchreiben(liste: Array<'google' | 'ms'>) {
  const alt = kontoHinweise();
  if (alt.length === liste.length && alt.every((k) => liste.includes(k))) return;
  try {
    if (liste.length) localStorage.setItem(HINWEIS_KEY, JSON.stringify(liste));
    else localStorage.removeItem(HINWEIS_KEY);
  } catch { /* privates Fenster */ }
  window.dispatchEvent(new CustomEvent(TERMINE_EREIGNIS));
}

/** Nach einem Abruf: Wer geantwortet hat, verliert seinen Hinweis; im Hintergrund gescheiterte Erneuerung setzt ihn */
function hinweiseFuehren(fehlgeschlagen: Set<'google' | 'ms'>, ohneErneuerung: Set<'google' | 'ms'>, still: boolean) {
  const verbunden = loadCalAccounts();
  const neu = new Set(kontoHinweise().filter((k) => fehlgeschlagen.has(k) && (k === 'google' ? googleConnected(verbunden.google) : msConnected(verbunden.ms))));
  if (still) for (const k of ohneErneuerung) neu.add(k);
  hinweiseSchreiben([...neu]);
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
  hinweiseSchreiben(kontoHinweise().filter((k) => k !== provider));
  // M469: Termine eines getrennten Kontos verschwinden auch aus der Aufgaben-Zentrale
  const g = gemerkteTermine();
  for (const tag of Object.keys(g.tage)) g.tage[tag] = g.tage[tag].filter((e) => e.provider !== provider);
  termineSchreiben(g);
}
