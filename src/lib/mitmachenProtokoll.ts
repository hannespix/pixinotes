// M513: Mitmachen per QR — das Protokoll zwischen Gastgeber (Board) und Teilnehmenden (Telefon).
//
// Eine Ideabubbles-Karte lässt sich einzeln teilen: Wer den QR-Code scannt, sieht NUR diese Karte (eigene schlanke
// Seite mitmachen.html), kein Board, keinen Navigator, keine anderen Karten. Einen Server braucht es dafür nicht
// über den Live-Kanal hinaus: Der Gastgeber — das Gerät, das die Runde geöffnet hat — ist selbst die Stelle, die
// prüft und schreibt. Er sendet den öffentlichen Stand der Karte, die Teilnehmenden senden Wünsche („Idee dazu",
// „Punkt auf …"), er nimmt an, was die Regeln der Karte erlauben, und schreibt es in die Karte.
//
// Zwei Kanäle je Runde (Supabase Realtime, öffentlicher Schlüssel, kein Konto):
//   · `pn-mit-<token>`      — der Gastgeber sendet hier den STAND (alle Teilnehmenden hören zu)
//   · `pn-mit-<token>-ein`  — die Teilnehmenden schicken ihre Wünsche hierher (nur der Gastgeber hört zu). Sie
//                             senden über die REST-Schnittstelle des Kanals, ohne beizutreten: Eine Nachricht
//                             geht so an EINEN Empfänger statt an alle (bei 200 Leuten 200-mal weniger Verkehr).
//
// Sicherheit, ohne dem Server zu vertrauen:
//   · Der Stand ist SIGNIERT (ECDSA P-256). Im QR-Link (im Teil hinter „#", der nie an einen Server geht) steht der
//     Abdruck des öffentlichen Schlüssels (SHA-256, 128 Bit) — kurz, damit der Code auch per Bildschirmfreigabe gut
//     lesbar bleibt; den Schlüssel selbst schickt der Gastgeber im Stand mit, die Seite prüft ihn gegen den Abdruck.
//     Niemand außer dem Gastgeber kann Teilnehmenden einen Stand unterschieben.
//   · Jede Person hat ein eigenes Schlüsselpaar (ECDH P-256, je Gerät und Runde). Ihre Kennung ist der Abdruck des
//     öffentlichen Schlüssels; ihre Wünsche sind mit dem gemeinsamen Schlüssel (ECDH → AES-GCM) verschlüsselt. Wer
//     den Kanal mitliest, kann sich darum nicht als jemand anderes ausgeben, keine fremde Idee löschen und keine
//     fremden Punkte sehen. Antworten an eine Person (eigene Ideen, eigene Punkte) reisen ebenso verschlüsselt.
//   · Grenzen gegen Fluten stehen in GRENZEN und gelten beim Gastgeber (der Teilnehmer-Code hält sie nur ein).
//
// Diese Datei kennt weder Store noch React — sie wird auch in die Teilnehmer-Seite gepackt.
import type { SupabaseKonfig } from './kontoSupabase';

export const MIT_VERSION = 1;
/** Grenzen, die der Gastgeber durchsetzt (Mitmachen per QR) */
export const GRENZEN = {
  /** Zeichen je Idee (wie in der Karte) */
  text: 140,
  /** Zeichen im Namen */
  name: 40,
  /** lebende Ideen je Person */
  ideenJePerson: 10,
  /** lebende Ideen in der Karte insgesamt — darüber nimmt der Gastgeber keine Ideen von außen mehr an */
  ideenGesamt: 400,
  /** Wünsche je Person: so viele auf einmal, dann einer je `nachfuellenMs` */
  eimer: 8,
  nachfuellenMs: 1200,
  /** Wünsche je Sekunde insgesamt (alle Personen zusammen) — der Rest fällt weg */
  jeSekunde: 60,
  /** Personen, die der Gastgeber gleichzeitig kennt */
  personen: 1000,
  /** Größe einer Nachricht (Zeichen) */
  nachricht: 4000,
} as const;
/** Ablehnungsgründe — Zahl im Stand, Text in der Teilnehmer-Seite */
export const GRUND = { ok: 0, geschlossen: 1, zuViele: 2, zuSchnell: 3, ungueltig: 4, keinePunkte: 5, voll: 6 } as const;

export interface MitLink {
  token: string;
  /** Abdruck des öffentlichen Schlüssels des Gastgebers (SHA-256 des rohen P-256-Schlüssels, 16 Byte, base64url) */
  schluessel: string;
  /** Look des Boards (M507/M509/M547): Design, Hell/Dunkel (fehlt: wie das Gerät), Akzent */
  design?: 'pixel' | 'agency';
  thema?: 'light' | 'dark';
  akzent?: string;
  /** Server, falls er nicht der vorgegebene dieser Fassung ist */
  sb?: SupabaseKonfig;
}

// ───── base64url ─────
export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 1) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
export function ausB64u(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
  return u;
}
export const zufall = (n = 16): string => b64u(crypto.getRandomValues(new Uint8Array(n)));
export const TOKEN_MUSTER = /^[A-Za-z0-9_-]{16,40}$/;

// ───── Link ─────
/** Der Link zur Teilnehmer-Seite. `basis` endet mit „/" (Ordner der App). */
export function linkBauen(basis: string, l: MitLink): string {
  const q = new URLSearchParams();
  q.set('m', l.token);
  q.set('k', l.schluessel);
  if (l.design) q.set('d', l.design);
  if (l.thema) q.set('t', l.thema);
  if (l.akzent) q.set('f', l.akzent);
  if (l.sb) { q.set('u', l.sb.url); q.set('a', l.sb.key); }
  return `${basis}mitmachen.html#${q.toString()}`;
}
export function linkLesen(hash: string): MitLink | null {
  try {
    const q = new URLSearchParams(hash.replace(/^#/, ''));
    const token = q.get('m') ?? '';
    const schluessel = q.get('k') ?? '';
    if (!TOKEN_MUSTER.test(token) || !/^[A-Za-z0-9_-]{22}$/.test(schluessel)) return null;
    const u = q.get('u'); const a = q.get('a');
    const sb = u && a && /^https?:\/\//.test(u) ? { url: u.replace(/\/+$/, ''), key: a } : undefined;
    const t = q.get('t'); const f = q.get('f') ?? '';
    return {
      token, schluessel, ...(q.get('d') === 'pixel' || q.get('d') === 'agency' ? { design: q.get('d') as 'pixel' | 'agency' } : {}),
      ...(t === 'light' || t === 'dark' ? { thema: t } : {}), ...(/^(gruen|violett|orange|rosa)$/.test(f) ? { akzent: f } : {}),
      ...(sb ? { sb } : {}),
    };
  } catch { return null; }
}
export const standKanal = (token: string): string => `mit-${token}`;
export const eingangKanal = (token: string): string => `mit-${token}-ein`;

// ───── Signatur (Stand des Gastgebers) ─────
const SIGN = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_HASH = { name: 'ECDSA', hash: 'SHA-256' } as const;
/** Abdruck eines öffentlichen Schlüssels (für den Link) */
export const abdruck = async (roh: string): Promise<string> => b64u(await crypto.subtle.digest('SHA-256', ausB64u(roh))).slice(0, 22);
export async function signierSchluessel(): Promise<{ privat: JsonWebKey; abdruck: string }> {
  const p = await crypto.subtle.generateKey(SIGN, true, ['sign', 'verify']);
  return { privat: await crypto.subtle.exportKey('jwk', p.privateKey), abdruck: await abdruck(b64u(await crypto.subtle.exportKey('raw', p.publicKey))) };
}
/** Privater Schlüssel zum Signieren und der öffentliche (roh) dazu, der im Stand mitreist */
export async function signierLaden(jwk: JsonWebKey): Promise<{ privat: CryptoKey; oeffentlich: string }> {
  const privat = await crypto.subtle.importKey('jwk', jwk, SIGN, false, ['sign']);
  const { d: _d, key_ops: _o, ...pub } = jwk;
  const oeffentlich = b64u(await crypto.subtle.exportKey('raw', await crypto.subtle.importKey('jwk', { ...pub, key_ops: ['verify'] }, SIGN, true, ['verify'])));
  return { privat, oeffentlich };
}
export async function signieren(k: CryptoKey, text: string): Promise<string> {
  return b64u(await crypto.subtle.sign(SIGN_HASH, k, new TextEncoder().encode(text)));
}
export const pruefSchluessel = (roh: string): Promise<CryptoKey> => crypto.subtle.importKey('raw', ausB64u(roh), SIGN, false, ['verify']);
export async function echt(k: CryptoKey, text: string, sig: string): Promise<boolean> {
  try { return await crypto.subtle.verify(SIGN_HASH, k, ausB64u(sig), new TextEncoder().encode(text)); } catch { return false; }
}

// ───── Schlüsselaustausch und Verschlüsselung (Wünsche und persönliche Antworten) ─────
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
export interface Paar { privat: CryptoKey; oeffentlich: string }
export async function tauschPaar(): Promise<Paar & { jwk: JsonWebKey }> {
  const p = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  return { privat: p.privateKey, oeffentlich: b64u(await crypto.subtle.exportKey('raw', p.publicKey)), jwk: await crypto.subtle.exportKey('jwk', p.privateKey) };
}
export async function tauschPaarLaden(jwk: JsonWebKey): Promise<Paar> {
  const privat = await crypto.subtle.importKey('jwk', jwk, ECDH, true, ['deriveKey']);
  // öffentlicher Teil aus dem privaten JWK (x, y)
  const { d: _d, key_ops: _o, ...pub } = jwk;
  const oeffentlich = b64u(await crypto.subtle.exportKey('raw', await crypto.subtle.importKey('jwk', { ...pub, key_ops: [] }, ECDH, true, [])));
  return { privat, oeffentlich };
}
/** Gemeinsamer Schlüssel aus dem eigenen privaten und dem öffentlichen der anderen Seite */
export async function gemeinsam(privat: CryptoKey, fremdRoh: string): Promise<CryptoKey | null> {
  try {
    const fremd = await crypto.subtle.importKey('raw', ausB64u(fremdRoh), ECDH, false, []);
    return await crypto.subtle.deriveKey({ name: 'ECDH', public: fremd }, privat, { name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
  } catch { return null; }
}
export interface Verschluesselt { i: string; c: string }
export async function verschluesseln(k: CryptoKey, obj: unknown): Promise<Verschluesselt> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
  return { i: b64u(iv), c: b64u(c) };
}
export async function entschluesseln<T>(k: CryptoKey, v: Verschluesselt): Promise<T | null> {
  try {
    if (typeof v?.i !== 'string' || typeof v.c !== 'string' || v.c.length > GRENZEN.nachricht * 2) return null;
    const t = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ausB64u(v.i) }, k, ausB64u(v.c));
    return JSON.parse(new TextDecoder().decode(t)) as T;
  } catch { return null; }
}
/** Kennung einer Person: Abdruck ihres öffentlichen Schlüssels (wer sie ist, lässt sich nur mit dem privaten belegen) */
export async function kennungAus(oeffentlich: string): Promise<string> {
  return b64u(await crypto.subtle.digest('SHA-256', ausB64u(oeffentlich))).slice(0, 16);
}
/** Kennung in der Karte (Feld `von` einer Idee) — eigenes Präfix neben g: (Gerät) und k: (Konto) */
export const VON_PRAEFIX = 't:';

// ───── Nachrichten ─────
/** Ein Wunsch einer Person (verschlüsselt im Feld `c`) */
export interface Wunsch {
  /** fortlaufende Nummer je Person (Wiederholungen alter Nachrichten zählen nicht) */
  n: number;
  a: 'da' | 'idee' | 'weg' | 'plus' | 'minus';
  /** Kennung der neuen Idee (idee) bzw. der eigenen Idee (weg) bzw. der Blase (plus/minus) */
  id?: string;
  x?: string;
  name?: string;
}
/** Eine Blase, wie Teilnehmende sie sehen */
export interface MitBlase {
  id: string;
  /** alle Ideen in der Blase */
  i: string[];
  /** Text — leer, solange verdeckt gesammelt wird */
  x: string;
  /** wie oft genannt */
  m: number;
  /** Punkte (fehlt, solange der Zwischenstand verborgen ist) */
  p?: number;
  /** Gruppe (Stelle in `g` des Stands) */
  g?: number;
  /** Namen (fehlen bei „anonym") */
  n?: string[];
}
export type MitSchritt = 'sammeln' | 'gruppieren' | 'abstimmen' | 'ergebnis';
/** Der öffentliche Stand der Karte — signiert, für alle gleich */
export interface MitStand {
  v: number;
  /** Zeitpunkt (ms, steigt) — ein älterer Stand zählt nicht (wiederholte alte Nachricht) */
  z: number;
  ti: string;
  f: string;
  s: MitSchritt;
  /** Punkte je Person */
  pk: number;
  r: { anonym?: 1; verdeckt?: 1; still?: 1; zu?: 1 };
  g: Array<{ name: string; farbe: number }>;
  b: MitBlase[];
  /** öffentlicher Tausch-Schlüssel des Gastgebers (für die Verschlüsselung der Wünsche) */
  h: string;
  /** öffentlicher Signier-Schlüssel des Gastgebers (roh) — passt er zum Abdruck im Link, gilt die Signatur */
  k: string;
  /** wie viele gerade dabei sind */
  dabei: number;
  /** die Runde ist beendet */
  ende?: 1;
}
/** Persönlicher Stand einer Person (verschlüsselt mit ihrem Schlüssel) */
export interface MeinStand {
  /** höchste verarbeitete Wunsch-Nummer */
  n: number;
  /** abgelehnte Wünsche der letzten Zeit: [Nummer, Grund] */
  f?: Array<[number, number]>;
  /** eigene lebende Ideen: Kennung → Text */
  i: Record<string, string>;
  /** eigene Punkte je Blase */
  p: Record<string, number>;
}
/** Nachricht auf dem Stand-Kanal */
export interface StandNachricht { d: string; s: string; u?: Record<string, Verschluesselt> }

/** Wunsch über die REST-Schnittstelle des Kanals senden (ohne beizutreten) — false: ging nicht */
export async function restSenden(k: SupabaseKonfig, kanal: string, ereignis: string, inhalt: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${k.url}/realtime/v1/api/broadcast`, {
      method: 'POST', cache: 'no-store',
      headers: { apikey: k.key, Authorization: `Bearer ${k.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `pn-${kanal}`, event: ereignis, payload: inhalt, private: false }] }),
    });
    return res.ok;
  } catch { return false; }
}
