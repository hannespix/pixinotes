// M483: Der leichte Teil der Kalender-Konten — was der Start braucht (Konto verbunden? gemerkte Termine für die
// Erinnerung, OAuth-Rücksprung im Popup). Anmelden, Token erneuern und Abrufen (lib/calAccounts.ts) kommen erst, wenn
// ein Konto wirklich etwas tun soll. lib/calAccounts.ts reicht alles hier weiter, für die Aufrufer ändert sich nichts.

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

export const googleConnected = (a?: GoogleAccount) => !!a?.token;
export const msConnected = (a?: MsAccount) => !!(a?.token || a?.refreshToken);
export const anyAccountConnected = () => {
  const acc = loadCalAccounts();
  return googleConnected(acc.google) || msConnected(acc.ms);
};

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

// ------------------------------------------------- Gemerkte Termine (M469) ----
// Erklärung siehe lib/calAccounts.ts (termineMerken)
export const TERMINE_KEY = 'pixinotes-cal-termine';
export const TERMINE_EREIGNIS = 'pixinotes-cal-termine';
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
