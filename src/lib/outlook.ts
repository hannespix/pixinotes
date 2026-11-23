// M466: Outlook live — Mails aus Microsoft 365 lesen und als E-Mail-Karte aufs Board holen.
//
// Nur lesen (Mail.Read): PixiNotes verschiebt, markiert oder löscht nichts im Postfach. Es gibt keinen Server —
// der Browser spricht direkt mit Microsoft Graph (CORS ist dort offen). Anmeldung und Token kommen aus den
// Kalender-Konten (lib/calAccounts.ts, eigener localStorage-Schlüssel, nie im Board, nie im Sync), dieselbe
// Microsoft-Verbindung liefert auch die Termine in die Kalender-Karte. Abmelden = Konto trennen, Token weg.
//
// Die Karte hat GENAU das Format des .eml-Imports (EmailData, lib/parseEmail.ts) — Destillat (M451) und
// Kontakt-aus-Mail (M457) arbeiten damit ohne Sonderfall. Alles, was von Microsoft kommt, läuft durch lib/sicher.ts.

import { connectMicrosoft, disconnect, loadCalAccounts, msAccessToken, msHasMail, oauthAvailable, patchCalAccounts } from './calAccounts';
import { bytesToDataUrl, MAX_EMBED_BYTES, safeMime } from './parseEmail';
import { mailTextVonAussen, textVonAussen } from './sicher';
import type { EmailData, ParsedAttachment } from '../types';

const GRAPH = 'https://graph.microsoft.com/v1.0/me';
const env = import.meta.env as Record<string, string | undefined>;

/** App-ID: Vorgabe des Betreibers aus dem Build, sonst die bereits hinterlegte der Kalender-Konten */
export const outlookClientId = (): string => (env.VITE_MS_CLIENT_ID ?? '').trim() || (loadCalAccounts().ms?.clientId ?? '').trim();
/** Bringt der Build die App-ID mit? Dann sieht kein Nutzer die Betreiber-Felder. */
export const outlookVorgabe = (): boolean => !!(env.VITE_MS_CLIENT_ID ?? '').trim();
export const outlookTenant = (): string => ((env.VITE_MS_TENANT ?? '').trim() || loadCalAccounts().ms?.tenant || 'common');

export type OutlookStand = 'ohne-id' | 'ohne-web' | 'abgemeldet' | 'ohne-postfach' | 'bereit';

export function outlookStand(): OutlookStand {
  const ms = loadCalAccounts().ms;
  if (!outlookClientId()) return 'ohne-id';
  if (!oauthAvailable()) return 'ohne-web';
  if (!ms || (!ms.token && !ms.refreshToken)) return 'abgemeldet';
  return msHasMail(ms) ? 'bereit' : 'ohne-postfach';
}

/** Anmelden bzw. das Postfach zur bestehenden Verbindung freischalten (ein Popup, Kalender bleibt dabei) */
export async function outlookAnmelden(hint?: string, clientId = outlookClientId(), tenant = outlookTenant()): Promise<string> {
  if (!clientId) throw new Error('Die Microsoft-Anmeldung ist auf dieser Installation noch nicht eingerichtet.');
  return connectMicrosoft(clientId, tenant || 'common', false, { mail: true, hint });
}

/**
 * Abmelden: Token, Refresh-Token, Kontoname und Kalender-Zwischenspeicher sind danach weg. Nur die App-ID (keine
 * Zugangsdaten, sondern die Einrichtung des Betreibers) bleibt, damit man sich wieder anmelden kann.
 */
export function outlookAbmelden() {
  const ms = loadCalAccounts().ms;
  disconnect('ms');
  if (ms?.clientId && !outlookVorgabe()) patchCalAccounts({ ms: { clientId: ms.clientId, ...(ms.tenant ? { tenant: ms.tenant } : {}) } });
}

export interface OutlookMail {
  id: string;
  betreff: string;
  vonName: string;
  vonAdresse?: string;
  datum?: string;
  vorschau: string;
  anhaenge: boolean;
  gelesen: boolean;
}

interface GraphAdresse { emailAddress?: { name?: string; address?: string } }
interface GraphMail {
  id?: string; subject?: string; from?: GraphAdresse; sender?: GraphAdresse; receivedDateTime?: string;
  bodyPreview?: string; hasAttachments?: boolean; isRead?: boolean;
  body?: { contentType?: string; content?: string };
}

async function graph(url: string, art: 'json' | 'bytes' = 'json'): Promise<Response> {
  for (let versuch = 0; versuch < 3; versuch += 1) {
    const token = await msAccessToken(false);
    // NIE credentials:'include' — Graph antwortet mit „Allow-Origin: *"
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: art === 'json' ? 'application/json' : '*/*' } });
    if (res.status === 429 || res.status === 503) {
      const warte = Number(res.headers.get('Retry-After') ?? '') || (versuch + 1) * 3;
      await new Promise((r) => setTimeout(r, Math.min(warte, 20) * 1000));
      continue;
    }
    if (res.status === 401) throw new Error('Microsoft hat die Anmeldung abgelehnt – bitte neu anmelden.');
    if (res.status === 403) throw new Error('Keine Berechtigung für das Postfach – bitte „Postfach freischalten" wählen.');
    if (!res.ok) throw new Error(`Outlook: HTTP ${res.status}`);
    return res;
  }
  throw new Error('Outlook antwortet gerade nicht (Anfragegrenze erreicht) – bitte gleich noch einmal versuchen.');
}

const kennung = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length < 1000 && !/[\s/?#]/.test(v) ? v : null);
const adresse = (a?: GraphAdresse) => {
  const name = textVonAussen(a?.emailAddress?.name, 200);
  const mail = textVonAussen(a?.emailAddress?.address, 200);
  return { name, mail: /^[^\s@]+@[^\s@]+$/.test(mail) ? mail : '' };
};
const datum = (v: unknown): string | undefined => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

/** Die letzten Mails des Posteingangs bzw. eine Suche über das ganze Postfach (neueste zuerst) */
export async function outlookListe(suche = '', anzahl = 25): Promise<OutlookMail[]> {
  const felder = 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments,isRead';
  const q = suche.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const url = q
    // $search sortiert selbst nach Datum; $orderby ist zusammen mit $search nicht erlaubt
    ? `${GRAPH}/messages?${new URLSearchParams({ $search: `"${q}"`, $top: String(anzahl), $select: felder })}`
    : `${GRAPH}/mailFolders/inbox/messages?${new URLSearchParams({ $top: String(anzahl), $select: felder, $orderby: 'receivedDateTime desc' })}`;
  const json = await (await graph(url)).json() as { value?: GraphMail[] };
  return (Array.isArray(json.value) ? json.value : []).flatMap((m): OutlookMail[] => {
    const id = kennung(m.id);
    if (!id) return [];
    const von = adresse(m.from ?? m.sender);
    return [{
      id,
      betreff: textVonAussen(m.subject, 300) || '(kein Betreff)',
      vonName: von.name || von.mail || 'Unbekannt',
      vonAdresse: von.mail || undefined,
      datum: datum(m.receivedDateTime),
      vorschau: textVonAussen(m.bodyPreview, 400).replace(/\s+/g, ' '),
      anhaenge: m.hasAttachments === true,
      gelesen: m.isRead !== false,
    }];
  });
}

/** Eine Mail vollständig holen — als EmailData wie beim .eml-Import; Anhänge nur auf Wunsch */
export async function outlookMail(id: string, mitAnhaengen: boolean): Promise<EmailData> {
  const sicher = kennung(id);
  if (!sicher) throw new Error('Ungültige Mail-Kennung.');
  const pfad = `${GRAPH}/messages/${encodeURIComponent(sicher)}`;
  const m = await (await graph(`${pfad}?${new URLSearchParams({ $select: 'subject,from,sender,receivedDateTime,body,hasAttachments' })}`)).json() as GraphMail;
  const von = adresse(m.from ?? m.sender);
  const art = /text/i.test(m.body?.contentType ?? '') && !/html/i.test(m.body?.contentType ?? '') ? 'text' : 'html';
  const attachments: ParsedAttachment[] = mitAnhaengen && m.hasAttachments ? await anhaenge(pfad) : [];
  return {
    subject: textVonAussen(m.subject, 300) || '(kein Betreff)',
    fromName: von.name || von.mail || 'Unbekannt',
    fromAddress: von.mail || undefined,
    date: datum(m.receivedDateTime),
    text: mailTextVonAussen(m.body?.content ?? '', art),
    attachments,
    // Herkunft — damit ein zweites Holen derselben Mail auffällt (nur die Graph-Kennung, kein Token)
    outlookId: sicher,
  };
}

interface GraphAnhang { id?: string; name?: string; contentType?: string; size?: number; isInline?: boolean; '@odata.type'?: string }

async function anhaenge(pfad: string): Promise<ParsedAttachment[]> {
  const json = await (await graph(`${pfad}/attachments?${new URLSearchParams({ $select: 'id,name,contentType,size,isInline' })}`)).json() as { value?: GraphAnhang[] };
  const liste = (Array.isArray(json.value) ? json.value : []).filter((a) => !a.isInline).slice(0, 30);
  const aus: ParsedAttachment[] = [];
  for (const a of liste) {
    const name = textVonAussen(a.name, 200).replace(/[\\/]/g, '_') || 'Anhang';
    const groesse = typeof a.size === 'number' && Number.isFinite(a.size) && a.size >= 0 ? a.size : 0;
    const mime = safeMime(textVonAussen(a.contentType, 100) || undefined);
    const datei = (a['@odata.type'] ?? '#microsoft.graph.fileAttachment') === '#microsoft.graph.fileAttachment';
    const aid = kennung(a.id);
    let dataUrl: string | undefined;
    // Wie beim .eml-Import: nur bis MAX_EMBED_BYTES einbetten, größere Anhänge bleiben Chip mit Namen und Größe
    if (datei && aid && groesse > 0 && groesse <= MAX_EMBED_BYTES) {
      try {
        const bytes = new Uint8Array(await (await graph(`${pfad}/attachments/${encodeURIComponent(aid)}/$value`, 'bytes')).arrayBuffer());
        if (bytes.byteLength > 0 && bytes.byteLength <= MAX_EMBED_BYTES) dataUrl = bytesToDataUrl(bytes, mime);
      } catch { /* dann eben nur als Chip */ }
    }
    aus.push({ name, mime, size: groesse, dataUrl });
  }
  return aus;
}
