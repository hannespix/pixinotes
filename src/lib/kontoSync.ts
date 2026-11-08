// Konto-Sync (M317): Anmeldung mit Google oder Microsoft, die Daten liegen im
// App-Ordner des EIGENEN Google Drive (appDataFolder) bzw. OneDrive (approot).
//
// - Null Einrichtung für Nutzer: ein Klick „Mit Google anmelden". Die Client-ID
//   kommt aus dem Build (Repository-Variablen des Betreibers) oder aus den
//   Kalender-Konten; die Anmeldung selbst ist dieselbe wie dort (calAccounts).
// - Kein Server, keine Datenbank des Betreibers: Alles bleibt im Konto des
//   Nutzers. Zugangsdaten liegen in einem EIGENEN localStorage-Schlüssel —
//   nie in Share-Links, Sync-Dateien oder Exporten.
// - Ablage je Board (board-<id>.json) plus umgebung.json (Bereiche, Reihenfolge,
//   Stempel je Board, Dateiliste); Dateien (PDF, Bilder) als echte Binärdateien.
//   Geschrieben wird nur, was sich geändert hat; gelesen nur, was fremd ist.
// - Dieselbe Drei-Wege-Zusammenführung wie Ordner und WebDAV (M311):
//   SyncWeg + fremdStandEinarbeiten. Abgleich alle zehn Sekunden über einen
//   Mini-Abruf (eTag / Version von umgebung.json); erst eine Änderung lädt.
import { claimWriter, flushPersist, getWriterRole, inDerived, isImportedState, useBoard, type BoardDoc, type Space } from '../store';
import {
  alsBase64, base64AlsBlob, basisLesen, basisMerken, basisVergessen, buildSyncPayloadMitDateien, DATEI_BUDGET_MB,
  emitSyncStatus, fremdStandEinarbeiten, idbDel, idbGet, idbSet, KONTO_DIRTY_KEY, notiereAenderung, SYNC_DIRTY_KEY,
  uebernimmDateien, WEBDAV_DIRTY_KEY, type SyncDatei, type SyncPayload, type SyncWeg,
} from './syncFolder';
import { googleTokenFuer, loadCalAccounts, msAnmeldung, msTokenErneuern, oauthAvailable } from './calAccounts';
import { sbAbmelden, sbErneuern, sbKontoLoeschen, sbNutzer, sbRealtime, sbRueckkehrLesen, supabaseKonfig, type RealtimeGriff, type SbSitzung } from './kontoSupabase';

/** M328: 'supabase' = das eigene PixiNotes-Konto (E-Mail), Ablage beim Betreiber */
export type Anbieter = 'google' | 'ms' | 'supabase';

export interface KontoSitzung {
  anbieter: Anbieter;
  /** OAuth-Client-ID — beim PixiNotes-Konto der öffentliche Anon-Key */
  clientId: string;
  tenant?: string;
  token?: string;
  tokenExp?: number;      // epoch ms
  refreshToken?: string;  // Microsoft und PixiNotes-Konto (Google-SPAs bekommen keinen)
  name?: string;          // Anzeige: E-Mail oder Name des Kontos
  /** PixiNotes-Konto: Adresse des Projekts und die eigene Nutzer-Id (für Realtime-Filter) */
  url?: string;
  userId?: string;
}

const LS_KEY = 'pixinotes-konto-sync';
const STAMP_KEY = 'pixinotes:konto-stamp';
const KENN_KEY = 'konto:kenn';
const UMGEBUNG = 'umgebung.json';
const BOARD_PREFIX = 'board-';
const DATEI_PREFIX = 'datei-';
/** Einfacher Upload (ohne Sitzung) — bis hierhin reisen Dateien bei Google Drive und OneDrive mit */
export const DATEI_MAX_BYTES = 4 * 1024 * 1024;
/** M329: Beim PixiNotes-Konto liegen Anhänge im Dateispeicher (Storage-Bucket) — bis 50 MB */
export const DATEI_MAX_BYTES_KONTO = 50 * 1024 * 1024;
/** M329: Bis hierhin lädt der Abgleich Anhänge sofort mit; größere holt die Karte beim Öffnen */
export const DATEI_SOFORT_BYTES = 8 * 1024 * 1024;
export const dateiMaxBytes = (s: KontoSitzung | null = loadKonto()): number => (s?.anbieter === 'supabase' ? DATEI_MAX_BYTES_KONTO : DATEI_MAX_BYTES);
export const kontoDateiMaxMb = (s: KontoSitzung | null = loadKonto()): number => Math.round(dateiMaxBytes(s) / (1024 * 1024));
const BUCKET = 'pixinotes';
export const GOOGLE_SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.appdata';
export const MS_SCOPE_DRIVE = 'Files.ReadWrite.AppFolder User.Read offline_access';

// ---------- Konfiguration & Sitzung ----------
const env = import.meta.env as Record<string, string | undefined>;
/** Vorgabe aus dem Build (Repository-Variablen des Betreibers) */
export const vorgabeClientId = (a: Anbieter): string => (a === 'google' ? env.VITE_GOOGLE_CLIENT_ID : env.VITE_MS_CLIENT_ID) ?? '';
/** Client-ID: Vorgabe aus dem Build, sonst die der Kalender-Konten — der Nutzer tippt nichts. */
export function bekannteClientId(a: Anbieter): string {
  const v = vorgabeClientId(a).trim();
  if (v) return v;
  const c = loadCalAccounts();
  return (a === 'google' ? c.google?.clientId : c.ms?.clientId) ?? '';
}
export const bekannterTenant = (): string => (env.VITE_MS_TENANT ?? loadCalAccounts().ms?.tenant ?? 'common') || 'common';

export function loadKonto(): KontoSitzung | null {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') as KontoSitzung | null;
    return s?.anbieter && s.clientId && (s.token || s.refreshToken) ? s : null;
  } catch {
    return null;
  }
}
function saveKonto(s: KontoSitzung): void { localStorage.setItem(LS_KEY, JSON.stringify(s)); }
export const kontoStamp = (): string | null => localStorage.getItem(STAMP_KEY);
export const kontoLabel = (s: KontoSitzung | null = loadKonto()): string => (s?.anbieter === 'supabase' ? 'PixiNotes-Konto' : s?.anbieter === 'ms' ? 'OneDrive' : 'Google Drive');
/** M328: Ist das angemeldete Konto das eigene PixiNotes-Konto? */
export const kontoIstEigenes = (s: KontoSitzung | null = loadKonto()): boolean => s?.anbieter === 'supabase';

/** Abmelden: Zugangsdaten, Stempel, Basis und Server-Kenntnis weg — die Daten bleiben lokal UND im Konto. */
export function kontoAbmelden(): void {
  const s = loadKonto();
  realtimeStoppen();
  if (s?.anbieter === 'supabase' && s.token) void sbAbmelden(s.token, { url: s.url ?? '', key: s.clientId });
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(STAMP_KEY);
  localStorage.removeItem(KONTO_DIRTY_KEY);
  void basisVergessen('konto');
  void idbDel(KENN_KEY);
  void idbDel(BASEN_KEY);
  anmeldungNoetig = false;
}

// ---------- Anmeldung ----------
let anmeldungNoetig = false;
/** Braucht der Konto-Sync eine neue Anmeldung (Google-Token abgelaufen, still nicht erneuerbar)? */
export const kontoBrauchtAnmeldung = (): boolean => anmeldungNoetig;

async function kontoName(s: KontoSitzung): Promise<string | undefined> {
  try {
    if (s.anbieter === 'supabase') return (await sbNutzer(s.token ?? '', { url: s.url ?? '', key: s.clientId }))?.email;
    if (s.anbieter === 'google') {
      const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', { headers: { Authorization: `Bearer ${s.token}` } });
      const j = (await r.json()) as { user?: { emailAddress?: string; displayName?: string } };
      return j.user?.emailAddress ?? j.user?.displayName;
    }
    const r = await fetch('https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,displayName', { headers: { Authorization: `Bearer ${s.token}` } });
    const j = (await r.json()) as { userPrincipalName?: string; displayName?: string };
    return j.userPrincipalName ?? j.displayName;
  } catch {
    return undefined;
  }
}

/** Interaktiv anmelden (Popup). Speichert die Sitzung; Verbinden/Abgleich macht `kontoVerbinden`. */
export async function kontoAnmelden(anbieter: Anbieter, clientId: string, tenant = 'common'): Promise<KontoSitzung> {
  if (!oauthAvailable()) throw new Error('Anmelden geht nur über die gehostete App (http/https), nicht aus der Einzeldatei.');
  if (!clientId.trim()) throw new Error(anbieter === 'google' ? 'Keine Google-Client-ID hinterlegt.' : 'Keine Microsoft-App-ID hinterlegt.');
  let s: KontoSitzung;
  if (anbieter === 'google') {
    const t = await googleTokenFuer(clientId.trim(), GOOGLE_SCOPE_DRIVE, false);
    s = { anbieter, clientId: clientId.trim(), token: t.token, tokenExp: t.exp };
  } else {
    const t = await msAnmeldung(clientId.trim(), tenant, MS_SCOPE_DRIVE);
    s = { anbieter, clientId: clientId.trim(), tenant, token: t.token, tokenExp: t.exp, refreshToken: t.refreshToken };
  }
  s.name = await kontoName(s);
  saveKonto(s);
  anmeldungNoetig = false;
  return s;
}

/**
 * M328: Mit dem eigenen PixiNotes-Konto anmelden — die Sitzung kommt von der
 * E-Mail-Anmeldung (Link oder Passwort) oder von der Rückkehr über den Link.
 * Speichert die Sitzung und startet Realtime; Verbinden/Abgleich macht `kontoVerbinden`.
 */
export async function kontoAnmeldenSupabase(sitz: SbSitzung): Promise<KontoSitzung> {
  const k = supabaseKonfig();
  if (!k.url || !k.key) throw new Error('PixiNotes-Konto: Der Betreiber hat noch kein Konto-Backend hinterlegt.');
  const s: KontoSitzung = { anbieter: 'supabase', clientId: k.key, url: k.url, token: sitz.token, tokenExp: sitz.exp, refreshToken: sitz.refreshToken, userId: sitz.userId, name: sitz.email };
  if (!s.name) s.name = await kontoName(s);
  saveKonto(s);
  anmeldungNoetig = false;
  laufwerkCache = null;
  realtimeStarten();
  return s;
}

/** M328: Das eigene Konto samt aller Daten beim Betreiber löschen; danach abgemeldet. */
export async function kontoLoeschen(): Promise<void> {
  const { s, token } = await tokenHolen();
  if (s.anbieter !== 'supabase') throw new Error('Nur das PixiNotes-Konto lässt sich hier löschen.');
  await sbKontoLoeschen(token, { url: s.url ?? '', key: s.clientId });
  realtimeStoppen();
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(STAMP_KEY);
  localStorage.removeItem(KONTO_DIRTY_KEY);
  void basisVergessen('konto');
  void idbDel(KENN_KEY);
  void idbDel(BASEN_KEY);
  anmeldungNoetig = false;
}

/** Gültiges Token — still erneuert, wenn nötig. Wirft mit Klartext, wenn eine neue Anmeldung nötig ist. */
async function tokenHolen(interaktiv = false): Promise<{ s: KontoSitzung; token: string }> {
  const s = loadKonto();
  if (!s) throw new Error('Kein Konto angemeldet.');
  if (s.token && s.tokenExp && s.tokenExp > Date.now()) return { s, token: s.token };
  if (s.anbieter === 'supabase') {
    if (!s.refreshToken) throw neueAnmeldung();
    const t = await sbErneuern(s.refreshToken, { url: s.url ?? '', key: s.clientId }).catch(() => { throw neueAnmeldung(); });
    const next = { ...s, token: t.token, tokenExp: t.exp, refreshToken: t.refreshToken, userId: t.userId || s.userId };
    saveKonto(next);
    realtime?.token(t.token);
    return { s: next, token: t.token };
  }
  if (s.anbieter === 'ms') {
    if (!s.refreshToken) throw neueAnmeldung();
    const t = await msTokenErneuern(s.clientId, s.tenant ?? 'common', s.refreshToken, MS_SCOPE_DRIVE).catch(() => { throw neueAnmeldung(); });
    const next = { ...s, token: t.token, tokenExp: t.exp, refreshToken: t.refreshToken ?? s.refreshToken };
    saveKonto(next);
    return { s: next, token: t.token };
  }
  // Google: stille Erneuerung — klappt, solange der Nutzer bei Google
  // angemeldet ist. Außerhalb einer Geste kann der Browser das Popup
  // blocken: dann merken wir uns das, zeigen es an der Wolke und holen das
  // Token beim nächsten Klick in der App nach (`beiNaechsterGeste`).
  try {
    const t = await googleTokenFuer(s.clientId, GOOGLE_SCOPE_DRIVE, !interaktiv);
    const next = { ...s, token: t.token, tokenExp: t.exp };
    saveKonto(next);
    anmeldungNoetig = false;
    return { s: next, token: t.token };
  } catch {
    throw neueAnmeldung();
  }
}
function neueAnmeldung(): Error {
  anmeldungNoetig = true;
  emitSyncStatus('konto', 'noperm');
  beiNaechsterGeste();
  return new Error(`${kontoLabel()}: Anmeldung abgelaufen — oben auf die Wolke klicken, um sie zu erneuern.`);
}
let gesteWartet = false;
function beiNaechsterGeste(): void {
  if (gesteWartet) return;
  gesteWartet = true;
  const weiter = () => {
    window.removeEventListener('pointerdown', weiter, true);
    window.removeEventListener('keydown', weiter, true);
    gesteWartet = false;
    // Innerhalb der Geste: still erneuern (das Popup darf jetzt auf),
    // danach den liegengebliebenen Abgleich nachholen
    void tokenHolen(false).then(() => checkKontoRemote(true)).catch(() => {});
  };
  window.addEventListener('pointerdown', weiter, true);
  window.addEventListener('keydown', weiter, true);
}
/** Vom Status-Chip aus (innerhalb eines Klicks): Anmeldung erneuern. */
export async function kontoNeuAnmelden(): Promise<boolean> {
  try {
    await tokenHolen(true);
    await checkKontoRemote(true);
    return true;
  } catch {
    return false;
  }
}

// ---------- Laufwerk: Google Drive (appDataFolder) und OneDrive (approot) ----------
interface Eintrag { name: string; id: string; etag: string; size: number; modifiedTime?: string }
class VorbedingungFehler extends Error { constructor() { super('Vorbedingung verletzt'); } }

async function anfrage(url: string, init: RequestInit = {}, nochmal = true): Promise<Response> {
  const { s, token } = await tokenHolen();
  // Supabase will neben dem Bearer-Token den öffentlichen Anon-Key
  const extra: Record<string, string> = s.anbieter === 'supabase' ? { apikey: s.clientId } : {};
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), ...extra, Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error(`${kontoLabel()}: nicht erreichbar — Internetverbindung prüfen.`);
  }
  if (res.status === 401 && nochmal) {
    // Token serverseitig ungültig (Kennwort geändert o. Ä.): einmal erneuern
    const s = loadKonto();
    if (s) saveKonto({ ...s, tokenExp: 0 });
    return anfrage(url, init, false);
  }
  if (res.status === 401) throw neueAnmeldung();
  if (res.status === 403) {
    const t = await res.text().catch(() => '');
    if (/insufficient|scope|permission|accessNotConfigured/i.test(t)) {
      throw new Error(`${kontoLabel()}: Die Berechtigung für den App-Ordner fehlt — bitte abmelden und neu anmelden.`);
    }
    throw new Error(`${kontoLabel()}: Zugriff verweigert (HTTP 403).`);
  }
  if (res.status === 412) throw new VorbedingungFehler();
  if (res.status === 429 || res.status >= 500) throw new Error(`${kontoLabel()}: vorübergehend nicht erreichbar (HTTP ${res.status}).`);
  return res;
}

interface Laufwerk {
  liste(): Promise<Eintrag[]>;
  /** eTag/Version einer Datei — null, wenn es sie nicht gibt (der Mini-Abruf für den Takt) */
  kopf(name: string): Promise<string | null>;
  lesenText(name: string): Promise<string | null>;
  lesenBlob(name: string): Promise<Blob | null>;
  /** Schreiben; `wennEtag` = nur, wenn die Datei noch diesen Stand hat (OneDrive prüft es, Drive kann es nicht) */
  schreiben(name: string, body: string | Blob, mime: string, wennEtag?: string | null): Promise<string>;
  loeschen(name: string): Promise<void>;
  /** M328: Alles in einem Zug — Dateien schreiben, löschen, Umgebung mit Vorbedingung — oder nichts (atomar) */
  stapel?(schreiben: Array<{ name: string; body: string | Blob; mime: string }>, loeschen: string[], umgebung: string, wennEtag: string | null): Promise<string>;
}
interface Schreibplan { schreiben: Array<{ name: string; body: string | Blob; mime: string }>; loeschen: string[] }

const G_API = 'https://www.googleapis.com/drive/v3';
const G_UP = 'https://www.googleapis.com/upload/drive/v3';
function googleLaufwerk(): Laufwerk {
  let ids = new Map<string, Eintrag>();
  let listeZeit = 0;
  const liste = async (): Promise<Eintrag[]> => {
    listeZeit = Date.now();
    const res = await anfrage(`${G_API}/files?${new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'files(id,name,version,size,modifiedTime)' })}`);
    if (!res.ok) throw new Error(`Google Drive: HTTP ${res.status}`);
    const j = (await res.json()) as { files?: Array<{ id: string; name: string; version?: string; size?: string; modifiedTime?: string }> };
    ids = new Map();
    for (const f of j.files ?? []) {
      const e: Eintrag = { name: f.name, id: f.id, etag: f.version ?? '', size: Number(f.size ?? 0), modifiedTime: f.modifiedTime };
      // Doppelte Namen (zwei Geräte legten zugleich an): der jüngste gilt
      const alt = ids.get(f.name);
      if (!alt || (e.modifiedTime ?? '') > (alt.modifiedTime ?? '')) ids.set(f.name, e);
    }
    return [...ids.values()];
  };
  /** Name → Eintrag. Fehlt der Name im Cache, kann ein anderes Gerät die Datei
   *  inzwischen angelegt haben (neues Board, neuer Anhang): dann einmal frisch
   *  auflisten — höchstens alle 5 s, damit ein Schreib-Schub mit vielen neuen
   *  Dateien nicht je Datei die Liste holt. */
  const id = async (name: string): Promise<Eintrag | undefined> => {
    if (ids.size === 0 || (!ids.has(name) && Date.now() - listeZeit > 5000)) await liste();
    return ids.get(name);
  };
  return {
    liste,
    async kopf(name) {
      const e = await id(name);
      if (!e) return null;
      const res = await anfrage(`${G_API}/files/${e.id}?fields=version`);
      if (res.status === 404) { ids.delete(name); return null; }
      if (!res.ok) throw new Error(`Google Drive: HTTP ${res.status}`);
      const j = (await res.json()) as { version?: string };
      e.etag = j.version ?? '';
      return e.etag;
    },
    async lesenText(name) {
      const e = await id(name);
      if (!e) return null;
      const res = await anfrage(`${G_API}/files/${e.id}?alt=media`, { cache: 'no-store' });
      if (res.status === 404) { ids.delete(name); return null; }
      if (!res.ok) throw new Error(`Google Drive: HTTP ${res.status}`);
      return res.text();
    },
    async lesenBlob(name) {
      const e = await id(name);
      if (!e) return null;
      const res = await anfrage(`${G_API}/files/${e.id}?alt=media`, { cache: 'no-store' });
      if (res.status === 404) { ids.delete(name); return null; }
      if (!res.ok) throw new Error(`Google Drive: HTTP ${res.status}`);
      return res.blob();
    },
    async schreiben(name, body, mime) {
      const e = await id(name);
      let res: Response;
      if (e) {
        res = await anfrage(`${G_UP}/files/${e.id}?uploadType=media&fields=id,version`, { method: 'PATCH', headers: { 'Content-Type': mime }, body });
        if (res.status === 404) { ids.delete(name); return this.schreiben(name, body, mime); }
      } else {
        const grenze = 'pixinotes-' + Math.random().toString(36).slice(2);
        const kopf = `--${grenze}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n--${grenze}\r\nContent-Type: ${mime}\r\n\r\n`;
        const paket = new Blob([kopf, body, `\r\n--${grenze}--`], { type: `multipart/related; boundary=${grenze}` });
        res = await anfrage(`${G_UP}/files?uploadType=multipart&fields=id,version`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${grenze}` }, body: paket });
      }
      if (!res.ok) throw new Error(`Google Drive: Schreiben fehlgeschlagen (HTTP ${res.status}).`);
      const j = (await res.json()) as { id: string; version?: string };
      const neu: Eintrag = { name, id: j.id, etag: j.version ?? '', size: typeof body === 'string' ? body.length : body.size };
      ids.set(name, neu);
      return neu.etag;
    },
    async loeschen(name) {
      const e = await id(name);
      if (!e) return;
      const res = await anfrage(`${G_API}/files/${e.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`Google Drive: Löschen fehlgeschlagen (HTTP ${res.status}).`);
      ids.delete(name);
    },
  };
}

const MS_ROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
function msLaufwerk(): Laufwerk {
  const pfad = (name: string) => `${MS_ROOT}:/${encodeURIComponent(name)}`;
  return {
    async liste() {
      const aus: Eintrag[] = [];
      let url: string | undefined = `${MS_ROOT}/children?$select=name,id,eTag,size&$top=999`;
      while (url) {
        const res: Response = await anfrage(url);
        if (!res.ok) throw new Error(`OneDrive: HTTP ${res.status}`);
        const j = (await res.json()) as { value?: Array<{ name: string; id: string; eTag?: string; size?: number }>; '@odata.nextLink'?: string };
        for (const f of j.value ?? []) aus.push({ name: f.name, id: f.id, etag: f.eTag ?? '', size: f.size ?? 0 });
        url = j['@odata.nextLink'];
      }
      return aus;
    },
    async kopf(name) {
      const res = await anfrage(`${pfad(name)}?$select=eTag`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`OneDrive: HTTP ${res.status}`);
      const j = (await res.json()) as { eTag?: string };
      return j.eTag ?? '';
    },
    async lesenText(name) {
      const res = await anfrage(`${pfad(name)}:/content`, { cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`OneDrive: HTTP ${res.status}`);
      return res.text();
    },
    async lesenBlob(name) {
      const res = await anfrage(`${pfad(name)}:/content`, { cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`OneDrive: HTTP ${res.status}`);
      return res.blob();
    },
    async schreiben(name, body, mime, wennEtag) {
      const headers: Record<string, string> = { 'Content-Type': mime };
      if (wennEtag) headers['If-Match'] = wennEtag;
      const res = await anfrage(`${pfad(name)}:/content`, { method: 'PUT', headers, body });
      if (!res.ok) throw new Error(`OneDrive: Schreiben fehlgeschlagen (HTTP ${res.status}).`);
      const j = (await res.json()) as { eTag?: string };
      return j.eTag ?? '';
    },
    async loeschen(name) {
      const res = await anfrage(pfad(name), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`OneDrive: Löschen fehlgeschlagen (HTTP ${res.status}).`);
    },
  };
}

/**
 * M328: Das eigene PixiNotes-Konto — eine Tabelle `konto_dateien` bei Supabase
 * (PostgREST), je Nutzer eine Zeile pro „Datei"; Anhänge als Base64 im
 * Inhalt. `version` ist der eTag: ein bedingtes Schreiben filtert darauf und
 * gilt als Vorbedingungsfehler, wenn keine Zeile mehr passt. Ein Schreiben
 * mit `wennEtag === null` erwartet, dass die Datei noch fehlt (Insert; 409 =
 * ein anderes Gerät war schneller). Ohne Vorbedingung: Upsert.
 */
function supabaseLaufwerk(): Laufwerk {
  interface Zeile { name: string; version: number; groesse?: number; mime?: string; inhalt?: string; updated_at?: string }
  const basis = (): string => `${loadKonto()?.url ?? ''}/rest/v1/konto_dateien`;
  const eq = (name: string) => `name=eq.${encodeURIComponent(name)}`;
  const zeilen = async (res: Response): Promise<Zeile[]> => {
    if (!res.ok) throw new Error(`PixiNotes-Konto: HTTP ${res.status}`);
    return (await res.json()) as Zeile[];
  };
  const json = { 'Content-Type': 'application/json' };
  // M329: Anhänge (datei-<id>) liegen im Dateispeicher, Pfad <user_id>/<name>; Boards und Umgebung in der Tabelle
  const istAnhang = (name: string) => name.startsWith(DATEI_PREFIX);
  const objekt = (name: string, lesen = false): string => {
    const s = loadKonto();
    return `${s?.url ?? ''}/storage/v1/object/${lesen ? 'authenticated/' : ''}${BUCKET}/${encodeURIComponent(s?.userId ?? '')}/${encodeURIComponent(name)}`;
  };
  const anhangSchreiben = async (name: string, body: string | Blob, mime: string): Promise<string> => {
    const res = await anfrage(objekt(name), { method: 'POST', headers: { 'Content-Type': mime, 'x-upsert': 'true' }, body });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      if (/exceeded|maximum size|too large|Payload/i.test(t) || res.status === 413) throw new Error('PixiNotes-Konto: Die Datei ist größer als der Dateispeicher erlaubt (50 MB).');
      if (res.status === 404 || res.status === 400 && /[Bb]ucket not found/.test(t)) throw new Error('PixiNotes-Konto: Der Dateispeicher (Bucket „pixinotes") fehlt noch — Migration M329 beim Betreiber einspielen.');
      throw new Error(`PixiNotes-Konto: Datei-Upload fehlgeschlagen (HTTP ${res.status}).`);
    }
    return res.headers.get('etag') ?? '';
  };
  return {
    async liste() {
      const z = await zeilen(await anfrage(`${basis()}?select=name,version,groesse,updated_at&order=name`, { cache: 'no-store' }));
      return z.map((r) => ({ name: r.name, id: r.name, etag: String(r.version), size: r.groesse ?? 0, modifiedTime: r.updated_at }));
    },
    async kopf(name) {
      const z = await zeilen(await anfrage(`${basis()}?select=version&${eq(name)}`, { cache: 'no-store' }));
      return z.length ? String(z[0].version) : null;
    },
    async lesenText(name) {
      const z = await zeilen(await anfrage(`${basis()}?select=inhalt&${eq(name)}`, { cache: 'no-store' }));
      return z.length ? (z[0].inhalt ?? '') : null;
    },
    async lesenBlob(name) {
      if (istAnhang(name)) {
        const res = await anfrage(objekt(name, true), { cache: 'no-store' });
        if (res.status === 404 || res.status === 400) {
          // Ältere Stände (vor M329) hatten den Anhang noch in der Tabelle
          const z = await zeilen(await anfrage(`${basis()}?select=inhalt,mime&${eq(name)}`, { cache: 'no-store' }));
          return z.length ? base64AlsBlob(z[0].inhalt ?? '', z[0].mime || undefined) : null;
        }
        if (!res.ok) throw new Error(`PixiNotes-Konto: HTTP ${res.status}`);
        return res.blob();
      }
      const z = await zeilen(await anfrage(`${basis()}?select=inhalt,mime&${eq(name)}`, { cache: 'no-store' }));
      if (!z.length) return null;
      return base64AlsBlob(z[0].inhalt ?? '', z[0].mime || undefined);
    },
    async schreiben(name, body, mime, wennEtag) {
      if (istAnhang(name)) return anhangSchreiben(name, body, mime);
      const inhalt = typeof body === 'string' ? body : await alsBase64(body);
      const groesse = typeof body === 'string' ? body.length : body.size;
      const satz = JSON.stringify({ name, inhalt, mime, groesse });
      let res: Response;
      if (typeof wennEtag === 'string' && wennEtag) {
        // Bedingt: nur, wenn die Zeile noch diesen Stand hat
        res = await anfrage(`${basis()}?${eq(name)}&version=eq.${encodeURIComponent(wennEtag)}`, { method: 'PATCH', headers: { ...json, Prefer: 'return=representation' }, body: satz });
        const z = await zeilen(res);
        if (!z.length) throw new VorbedingungFehler();
        return String(z[0].version);
      }
      if (wennEtag === null) {
        // Erwartet: die Datei fehlt noch — sonst war ein anderes Gerät schneller
        res = await anfrage(basis(), { method: 'POST', headers: { ...json, Prefer: 'return=representation' }, body: satz });
        if (res.status === 409) throw new VorbedingungFehler();
        const z = await zeilen(res);
        return String(z[0]?.version ?? 1);
      }
      res = await anfrage(`${basis()}?on_conflict=user_id,name`, { method: 'POST', headers: { ...json, Prefer: 'resolution=merge-duplicates,return=representation' }, body: satz });
      const z = await zeilen(res);
      return String(z[0]?.version ?? 1);
    },
    async loeschen(name) {
      if (istAnhang(name)) {
        const res = await anfrage(objekt(name), { method: 'DELETE' });
        if (!res.ok && res.status !== 404 && res.status !== 400) throw new Error(`PixiNotes-Konto: Löschen fehlgeschlagen (HTTP ${res.status}).`);
        // Ein Rest aus der Zeit vor M329 in der Tabelle darf mit
        await anfrage(`${basis()}?${eq(name)}`, { method: 'DELETE' }).catch(() => {});
        return;
      }
      const res = await anfrage(`${basis()}?${eq(name)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`PixiNotes-Konto: Löschen fehlgeschlagen (HTTP ${res.status}).`);
    },
    /** Ein Zug, eine Transaktion: Anhänge wandern zuerst in den Dateispeicher (sie gelten erst,
     *  wenn die Umgebung sie nennt); dann prüft konto_schreiben die Version der Umgebung und
     *  schreibt Boards und Umgebung — oder nichts. Verwaistes wird danach gelöscht (Fehler egal:
     *  eine Leiche in der Tabelle schadet nicht, der nächste Lauf räumt sie auf). */
    async stapel(schreiben, loeschen, umgebung, wennEtag) {
      const dateien = [];
      for (const d of schreiben) {
        if (istAnhang(d.name)) { await anhangSchreiben(d.name, d.body, d.mime); continue; }
        const inhalt = typeof d.body === 'string' ? d.body : await alsBase64(d.body);
        dateien.push({ name: d.name, inhalt, mime: d.mime, groesse: typeof d.body === 'string' ? d.body.length : d.body.size });
      }
      const res = await anfrage(`${loadKonto()?.url ?? ''}/rest/v1/rpc/konto_schreiben`, {
        method: 'POST', headers: json,
        body: JSON.stringify({ p_dateien: dateien, p_umgebung: umgebung, p_wenn_version: wennEtag === null ? null : Number(wennEtag) }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        if (/vorbedingung/i.test(t)) throw new VorbedingungFehler();
        if (res.status === 404) throw new Error('PixiNotes-Konto: Die Datenbank ist noch nicht eingerichtet (Funktion konto_schreiben fehlt) — Migration beim Betreiber einspielen.');
        throw new Error(`PixiNotes-Konto: Schreiben fehlgeschlagen (HTTP ${res.status}).`);
      }
      const v = (await res.json()) as number | string;
      for (const name of loeschen) await this.loeschen(name).catch(() => {});
      return String(v);
    },
  };
}

let laufwerkCache: { anbieter: Anbieter; lw: Laufwerk } | null = null;
function laufwerk(): Laufwerk {
  const s = loadKonto();
  if (!s) throw new Error('Kein Konto angemeldet.');
  if (!laufwerkCache || laufwerkCache.anbieter !== s.anbieter) {
    laufwerkCache = { anbieter: s.anbieter, lw: s.anbieter === 'google' ? googleLaufwerk() : s.anbieter === 'ms' ? msLaufwerk() : supabaseLaufwerk() };
  }
  return laufwerkCache.lw;
}

/**
 * M329: Einen Anhang, der nur im Konto liegt, auf dieses Gerät holen (die Karte
 * ruft das beim Öffnen). Liefert den Blob und legt ihn in der lokalen Ablage ab.
 */
export async function kontoDateiNachladen(id: string): Promise<Blob | null> {
  const s = loadKonto();
  if (!s || s.anbieter !== 'supabase' || getWriterRole() !== 'writer') return null;
  const blob = await laufwerk().lesenBlob(`${DATEI_PREFIX}${id}`);
  if (!blob) return null;
  try { await idbSet(`file:${id}`, blob); } catch { /* Platte voll — die Karte zeigt den Blob trotzdem */ }
  return blob;
}

// ---------- M328: Realtime — Änderungen anderer Geräte sofort ----------
let realtime: RealtimeGriff | null = null;
let realtimeTimer: ReturnType<typeof setTimeout> | undefined;
/** Ist das Live-Abonnement gerade verbunden? (Anzeige in den Einstellungen) */
export const kontoLiveVerbunden = (): boolean => !!realtime?.verbunden;
function realtimeStarten(): void {
  realtimeStoppen();
  const s = loadKonto();
  if (!s || s.anbieter !== 'supabase' || !s.token || !s.userId) return;
  realtime = sbRealtime({ url: s.url ?? '', key: s.clientId }, s.token, s.userId, (name) => {
    // Erst die Umgebung macht einen neuen Stand gültig — Board-Dateien allein sind noch im Fluss
    if (name && name !== UMGEBUNG) return;
    if (getWriterRole() !== 'writer' || anmeldungNoetig || !loadKonto()) return;
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => {
      void (async () => {
        const kenn = await kennLesen();
        const kopf = await laufwerk().kopf(UMGEBUNG);
        if (kopf === null || kopf === kenn.etag) return; // die eigene Änderung
        await checkKontoRemote(true);
      })().catch(() => {});
    }, 400);
  });
}
function realtimeStoppen(): void {
  clearTimeout(realtimeTimer);
  realtime?.stop();
  realtime = null;
}

// ---------- Ablage-Format ----------
interface Umgebung {
  app: 'pixinotes';
  version: 1;
  savedAt: string;
  activeId: string;
  spaces: Space[];
  reihe: string[];                   // Board-Ids in Reihenfolge
  boards: Record<string, string>;    // Board-Id → Stempel (Hash des Inhalts)
  dateien: Record<string, { name: string; mime?: string; groesse?: number }>;
  /** eTag/Version des Server-Stands, auf dem dieser Schreibvorgang aufbaute —
   *  damit ein Leser den RICHTIGEN gemeinsamen Vorfahren für die Zusammen-
   *  führung wählt, auch wenn zwei Geräte sich gegenseitig überschrieben haben */
  basisEtag?: string | null;
}
/** Die letzten Server-Stände, die dieses Gerät gesehen oder geschrieben hat,
 *  je eTag — der Ring, aus dem die Zusammenführung ihren Vorfahren holt. */
interface BasisEintrag { etag: string; boards: BoardDoc[]; spaces: Space[] }
const BASEN_KEY = 'konto:basen';
async function basenMerken(etag: string, stand: { boards: BoardDoc[]; spaces: Space[] }): Promise<void> {
  const alt = ((await idbGet<BasisEintrag[]>(BASEN_KEY)) ?? []).filter((b) => b.etag !== etag);
  alt.push({ etag, boards: stand.boards, spaces: stand.spaces });
  await idbSet(BASEN_KEY, alt.slice(-6));
}
async function basisFinden(etag: string | null | undefined): Promise<BasisEintrag | null> {
  if (!etag) return null;
  return ((await idbGet<BasisEintrag[]>(BASEN_KEY)) ?? []).find((b) => b.etag === etag) ?? null;
}
/** Was wir zuletzt vom Konto wissen — damit nur Geändertes reist */
interface Kenn { boards: Record<string, string>; dateien: string[]; etag: string | null; savedAt: string | null; kern?: string }
const leereKenn = (): Kenn => ({ boards: {}, dateien: [], etag: null, savedAt: null });
/** M328: Der Inhalt der Umgebung ohne Zeitstempel und aktives Board — gleicher Kern = nichts zu schreiben */
const umgebungKern = (u: { spaces: Space[]; reihe: string[]; boards: Record<string, string>; dateien: Record<string, unknown> }): string =>
  stempel(JSON.stringify({ spaces: u.spaces, reihe: u.reihe, boards: u.boards, dateien: Object.keys(u.dateien ?? {}).sort() }));
const kennLesen = async (): Promise<Kenn> => (await idbGet<Kenn>(KENN_KEY)) ?? leereKenn();

/** FNV-1a über den JSON-Text plus Länge — schnell und für „gleich/anders" völlig ausreichend */
function stempel(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}:${text.length}`;
}

async function dateiLokal(id: string): Promise<boolean> {
  try { return !!(await idbGet(`file:${id}`)); } catch { return false; }
}

/** Stand aus dem Konto lesen — null, wenn dort noch nichts liegt. Merkt sich die Server-Kenntnis. */
export async function kontoLesen(): Promise<{ payload: SyncPayload; kenn: Kenn } | null> {
  const lw = laufwerk();
  const etag = await lw.kopf(UMGEBUNG);
  if (etag === null) return null;
  const text = await lw.lesenText(UMGEBUNG);
  if (!text) return null;
  let u: Umgebung;
  try { u = JSON.parse(text) as Umgebung; } catch { throw new Error(`${kontoLabel()}: umgebung.json ist beschädigt.`); }
  if (u.app !== 'pixinotes' || !Array.isArray(u.spaces) || !u.boards) throw new Error(`${kontoLabel()}: umgebung.json ist kein PixiNotes-Stand.`);
  const alt = await kennLesen();
  const basis = await basisLesen('konto');
  const basisBoards = new Map((basis?.boards ?? []).map((b) => [b.id, b] as const));
  const boards: BoardDoc[] = [];
  const reihe = Array.isArray(u.reihe) && u.reihe.length ? u.reihe : Object.keys(u.boards);
  for (const id of reihe) {
    const st = u.boards[id];
    if (!st) continue;
    const bekannt = basisBoards.get(id);
    if (bekannt && alt.boards[id] === st) { boards.push(bekannt); continue; }
    const t = await lw.lesenText(`${BOARD_PREFIX}${id}.json`);
    if (!t) continue; // gerade gelöscht — der nächste Takt holt den passenden Stand
    try { boards.push(JSON.parse(t) as BoardDoc); } catch { /* kaputte Datei überlesen */ }
  }
  if (boards.length === 0) return null;
  const dateien: Record<string, SyncDatei> = {};
  for (const [id, meta] of Object.entries(u.dateien ?? {})) {
    if (await dateiLokal(id)) continue;
    // M329: Große Anhänge holt die Karte beim Öffnen (kontoDateiNachladen) — nicht jeder Abgleich
    if ((meta.groesse ?? 0) > DATEI_SOFORT_BYTES) continue;
    try {
      const blob = await lw.lesenBlob(`${DATEI_PREFIX}${id}`);
      if (blob) dateien[id] = { name: meta.name, mime: meta.mime ?? (blob.type || undefined), b64: await alsBase64(blob) };
    } catch { /* eine Datei darf den Abgleich nicht aufhalten */ }
  }
  const kenn: Kenn = { boards: { ...u.boards }, dateien: Object.keys(u.dateien ?? {}), etag, savedAt: u.savedAt, kern: umgebungKern({ spaces: u.spaces, reihe, boards: u.boards, dateien: u.dateien ?? {} }) };
  await idbSet(KENN_KEY, kenn);
  const payload: SyncPayload = { app: 'pixinotes', version: 2, savedAt: u.savedAt, boards, spaces: u.spaces, activeId: u.activeId, ...(Object.keys(dateien).length ? { dateien } : {}) };
  // Zwei Geräte, die sich überschrieben haben (Drive kennt keine Vorbedingung):
  // Der Schreiber nennt den Stand, auf dem er aufbaute. Haben wir den noch,
  // ist ER der gemeinsame Vorfahre — nicht unser letzter eigener Stand, der
  // sonst eine fremde Lücke als „gelöscht" deuten ließe.
  const vorfahre = await basisFinden(u.basisEtag);
  if (vorfahre && vorfahre.etag !== etag) await basisMerken('konto', { boards: vorfahre.boards, spaces: vorfahre.spaces });
  await basenMerken(etag, { boards, spaces: u.spaces });
  return { payload, kenn };
}

let kette: Promise<unknown> = Promise.resolve();
function exklusiv<T>(fn: () => Promise<T>): Promise<T> {
  const p = kette.then(fn, fn);
  kette = p.catch(() => {});
  return p;
}

/** Aktuellen Stand ins Konto schreiben — nur Geändertes. Setzt Stempel, Basis, Kenntnis und Status. */
export async function kontoWrite(): Promise<string> {
  return exklusiv(() => kontoWriteRoh(true));
}
async function kontoWriteRoh(nochmal: boolean): Promise<string> {
  const lw = laufwerk();
  const s = useBoard.getState();
  const kenn = await kennLesen();
  const sitz = loadKonto();
  // M329: Beim PixiNotes-Konto reisen nur NEUE Anhänge (bis 50 MB) — bekannte liegen schon im Dateispeicher
  const bekanntVorab = new Set(kenn.dateien);
  const payload = sitz?.anbieter === 'supabase'
    ? await buildSyncPayloadMitDateien(Math.max(s.syncDateienMb ?? DATEI_BUDGET_MB, 256), (id) => !bekanntVorab.has(id))
    : await buildSyncPayloadMitDateien(s.syncDateienMb ?? DATEI_BUDGET_MB);
  const stempelNeu: Record<string, string> = {};
  const texte = new Map<string, string>();
  for (const b of payload.boards) {
    const t = JSON.stringify(b);
    texte.set(b.id, t);
    stempelNeu[b.id] = stempel(t);
  }
  try {
    const plan: Schreibplan = { schreiben: [], loeschen: [] };
    // 1) Boards, die sich geändert haben
    for (const b of payload.boards) {
      if (kenn.boards[b.id] === stempelNeu[b.id]) continue;
      plan.schreiben.push({ name: `${BOARD_PREFIX}${b.id}.json`, body: texte.get(b.id)!, mime: 'application/json' });
    }
    // 2) Boards, die es nicht mehr gibt
    for (const id of Object.keys(kenn.boards)) {
      if (!stempelNeu[id]) plan.loeschen.push(`${BOARD_PREFIX}${id}.json`);
    }
    // 3) Dateien: neue hinauf (Drive/OneDrive bis 4 MB, PixiNotes-Konto bis 50 MB), verwaiste weg
    const dateienMeta: Record<string, { name: string; mime?: string; groesse?: number }> = {};
    const bekannt = new Set(kenn.dateien);
    const maxBytes = dateiMaxBytes(sitz);
    // Name, Typ und Größe jeder Datei-Karte — damit bekannte Dateien ihre Angaben behalten, auch ohne Beipack
    const kartenMeta = new Map<string, { name: string; mime?: string; groesse?: number }>();
    for (const b of payload.boards) {
      for (const n of b.nodes) {
        if (n.type !== 'file') continue;
        const d = n.data as { name?: string; mime?: string; size?: number };
        kartenMeta.set(n.id, { name: d.name ?? 'Datei', mime: d.mime, groesse: d.size });
      }
    }
    for (const [id, d] of Object.entries(payload.dateien ?? {})) {
      const blob = base64AlsBlob(d.b64, d.mime);
      if (blob.size > maxBytes) continue;
      dateienMeta[id] = { name: d.name, mime: d.mime, groesse: blob.size };
      if (bekannt.has(id)) continue;
      plan.schreiben.push({ name: `${DATEI_PREFIX}${id}`, body: blob, mime: d.mime ?? 'application/octet-stream' });
    }
    // Bekannte Dateien, die diesmal nicht im Beipack sind (Budget oder schon hochgeladen),
    // bleiben erhalten, solange ihre Karte noch existiert
    for (const id of kenn.dateien) {
      if (dateienMeta[id]) continue;
      const meta = kartenMeta.get(id);
      if (meta) { dateienMeta[id] = meta; continue; }
      plan.loeschen.push(`${DATEI_PREFIX}${id}`);
    }
    // 4) Die Umgebung zuletzt — sie macht den neuen Stand gültig
    const u: Umgebung = {
      app: 'pixinotes', version: 1, savedAt: payload.savedAt, activeId: payload.activeId, spaces: payload.spaces,
      reihe: payload.boards.map((b) => b.id), boards: stempelNeu, dateien: dateienMeta, basisEtag: kenn.etag,
    };
    const kern = umgebungKern(u);
    // M328: Nichts geändert (gleiche Boards, Bereiche, Reihe, Dateien)? Dann nicht schreiben —
    // jeder Schreibvorgang bumpt sonst die Version und lässt andere Geräte unnötig zusammenführen.
    if (kenn.etag && kenn.kern === kern && plan.schreiben.length === 0 && plan.loeschen.length === 0 && kenn.savedAt) {
      localStorage.setItem(STAMP_KEY, kenn.savedAt);
      await basisMerken('konto', payload);
      const jetzt = useBoard.getState();
      if (jetzt.boards === s.boards && jetzt.spaces === s.spaces) localStorage.removeItem(KONTO_DIRTY_KEY);
      emitSyncStatus('konto', 'ok', kenn.savedAt);
      return kenn.savedAt;
    }
    let etag: string;
    if (lw.stapel) {
      etag = await lw.stapel(plan.schreiben, plan.loeschen, JSON.stringify(u), kenn.etag);
    } else {
      for (const d of plan.schreiben) await lw.schreiben(d.name, d.body, d.mime);
      for (const name of plan.loeschen) await lw.loeschen(name);
      etag = await lw.schreiben(UMGEBUNG, JSON.stringify(u), 'application/json', kenn.etag);
    }
    await idbSet(KENN_KEY, { boards: stempelNeu, dateien: Object.keys(dateienMeta), etag, savedAt: payload.savedAt, kern } satisfies Kenn);
    await basenMerken(etag, { boards: payload.boards, spaces: payload.spaces });
  } catch (e) {
    if (e instanceof VorbedingungFehler && nochmal) {
      // Ein anderes Gerät hat zwischendurch geschrieben: dessen Stand einarbeiten —
      // das schreibt selbst mit beiden Anteilen, wenn es Eigenes gab
      const r = await kontoLesen();
      if (r && r.payload.savedAt !== kontoStamp()) {
        const erg = await fremdStandEinarbeiten(r.payload, kontoWeg());
        if (erg === 'spaeter') throw new SpaeterFehler();
        if (erg === 'konflikt') { emitSyncStatus('konto', 'conflict'); throw new Error(`${kontoLabel()} und lokaler Stand weichen ab, nichts überschrieben. Unter ⚙ → Daten → Synchronisation wählen.`); }
        if (erg === 'fehler') throw new Error('Der Stand aus dem Konto konnte nicht gespeichert werden (Browser-Speicher voll?).');
        return kontoStamp() ?? payload.savedAt;
      }
      return kontoWriteRoh(false);
    }
    throw e;
  }
  localStorage.setItem(STAMP_KEY, payload.savedAt);
  await basisMerken('konto', payload);
  const cur = useBoard.getState();
  if (cur.boards === s.boards && cur.spaces === s.spaces) localStorage.removeItem(KONTO_DIRTY_KEY);
  emitSyncStatus('konto', 'ok', payload.savedAt);
  return payload.savedAt;
}

/** Geladenen Stand ohne Zusammenführung übernehmen (Umstieg ohne Basis). */
export function applyKonto(p: SyncPayload): boolean {
  claimWriter();
  useBoard.getState().importSync(p.boards, p.spaces, p.activeId);
  if (!flushPersist()) return false;
  try {
    localStorage.setItem(STAMP_KEY, p.savedAt);
    localStorage.removeItem(KONTO_DIRTY_KEY);
    // Gegenüber Ordner/WebDAV ist der Stand jetzt neu
    localStorage.setItem(SYNC_DIRTY_KEY, '1');
    localStorage.setItem(WEBDAV_DIRTY_KEY, '1');
  } catch { return false; }
  emitSyncStatus('konto', 'ok', p.savedAt);
  void basisMerken('konto', p);
  void uebernimmDateien(p).then((n) => {
    if (n > 0) window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
  });
  return true;
}

/** Der Weg aus Sicht der Zusammenführung. `schreiben` läuft bewusst OHNE den
 *  Mutex: fremdStandEinarbeiten wird nur aus kritischen Abschnitten gerufen
 *  (checkKontoRemote, kontoVerbinden, der 412-Pfad von kontoWriteRoh) — ein
 *  zweites exklusiv() darin wartete auf sich selbst. */
const kontoWeg = (): SyncWeg => ({
  source: 'konto',
  stampKey: STAMP_KEY,
  dirtyKey: KONTO_DIRTY_KEY,
  schreiben: () => kontoWriteRoh(true),
  uebernehmen: applyKonto,
});
class SpaeterFehler extends Error { constructor() { super('Der Nutzer tippt gerade — gleich noch einmal.'); } }

// ---------- Abgleich ----------
let started = false;
let conflictWarned = false;
let lastRemoteCheck = 0;
let staleHintShown = false;

export type VerbindenErgebnis = 'hochgeladen' | 'uebernommen' | 'zusammengefuehrt' | 'gleich' | 'konflikt';
/** Nach der Anmeldung: Was liegt im Konto? Leer → hochladen; fremd → einarbeiten; eigenes UND fremdes ohne Basis → der Nutzer entscheidet. */
export async function kontoVerbinden(): Promise<VerbindenErgebnis> {
  return exklusiv(async () => {
    const r = await kontoLesen();
    if (!r) { await kontoWriteRoh(true); return 'hochgeladen'; }
    const e = await fremdStandEinarbeiten(r.payload, kontoWeg());
    if (e === 'konflikt') { emitSyncStatus('konto', 'conflict'); return 'konflikt'; }
    if (e === 'fehler') throw new Error('Der Stand aus dem Konto konnte nicht gespeichert werden (Browser-Speicher voll?).');
    if (e === 'uebernommen') return 'uebernommen';
    if (e === 'zusammengefuehrt' || e === 'geschrieben' || e === 'spaeter') return 'zusammengefuehrt';
    return 'gleich';
  });
}

/** Konto prüfen und einen fremden Stand einarbeiten. */
export async function checkKontoRemote(erzwingen = false): Promise<void> {
  const now = Date.now();
  if (!erzwingen && now - lastRemoteCheck < 20_000) return;
  if (getWriterRole() !== 'writer') return;
  if (!loadKonto()) return;
  lastRemoteCheck = now;
  await exklusiv(async () => {
    const r = await kontoLesen();
    if (!r) return;
    if (r.payload.savedAt === kontoStamp()) { staleHintShown = false; emitSyncStatus('konto', 'ok', r.payload.savedAt); return; }
    const e = await fremdStandEinarbeiten(r.payload, kontoWeg());
    if (e === 'uebernommen') {
      useBoard.getState().showToast(`☁️ Neuerer Stand aus ${kontoLabel()} übernommen (${new Date(r.payload.savedAt).toLocaleString('de-DE')}).`);
      staleHintShown = false;
    } else if (e === 'konflikt') {
      emitSyncStatus('konto', 'conflict');
      if (!staleHintShown) {
        staleHintShown = true;
        useBoard.getState().showToast(`☁️ ${kontoLabel()} und lokaler Stand weichen ab, nichts überschrieben. Unter ⚙ → Daten → Synchronisation wählen.`);
      }
    } else if (e === 'fehler') {
      emitSyncStatus('konto', 'error');
    } else if (e === 'spaeter') {
      setTimeout(() => { void checkKontoRemote(true).catch(() => {}); }, 3000);
    } else {
      staleHintShown = false;
    }
  });
}

async function autoPush(): Promise<void> {
  if (getWriterRole() !== 'writer') return;
  if (!loadKonto()) return;
  emitSyncStatus('konto', 'pending');
  try {
    const lw = laufwerk();
    const kenn = await kennLesen();
    const kopf = await lw.kopf(UMGEBUNG);
    if (kopf !== null && kopf !== kenn.etag) {
      // Fremder Stand: erst einarbeiten (schreibt selbst mit beiden Anteilen)
      await checkKontoRemote(true);
      if (localStorage.getItem(KONTO_DIRTY_KEY)) await kontoWrite();
      return;
    }
    await kontoWrite();
    conflictWarned = false;
  } catch (e) {
    if (e instanceof SpaeterFehler) { setTimeout(() => { void autoPush(); }, 3000); return; }
    if (!anmeldungNoetig) emitSyncStatus('konto', 'error');
    if (!conflictWarned && !anmeldungNoetig) {
      conflictWarned = true;
      useBoard.getState().showToast(`⚠️ ${(e as Error).message}`);
    }
  }
}

const TAKT_MS = 10_000;
/** Einmal beim App-Start aufrufen: hält das Konto in beide Richtungen aktuell. */
export function initKontoSync(): void {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // M328: Rückkehr vom E-Mail-Link — die Sitzung hängt an der Adresse
  try {
    const rk = sbRueckkehrLesen();
    if (rk) {
      void kontoAnmeldenSupabase(rk).then(async (s) => {
        const r = await kontoVerbinden();
        const wo = s.name ? `als „${s.name}"` : 'mit dem PixiNotes-Konto';
        useBoard.getState().showToast(r === 'konflikt'
          ? `✅ Angemeldet ${wo}. Im Konto liegt schon ein Stand und hier Eigenes — unter ⚙ → Daten → Synchronisation wählen.`
          : `✅ Angemeldet ${wo} — Änderungen gleichen sich ab jetzt automatisch ab.`, false, 7000);
        window.dispatchEvent(new CustomEvent('pixinotes:konto'));
      }).catch((e) => useBoard.getState().showToast(`⚠️ ${(e as Error).message}`, false, 8000));
    }
  } catch (e) {
    useBoard.getState().showToast(`⚠️ ${(e as Error).message}`, false, 8000);
  }
  useBoard.subscribe((s, prev) => {
    if (s.boards === prev.boards && s.spaces === prev.spaces) return;
    if (isImportedState(s.boards, s.spaces)) return;
    if (getWriterRole() !== 'writer') return;
    if (!inDerived()) {
      notiereAenderung();
      try { localStorage.setItem(KONTO_DIRTY_KEY, '1'); } catch { /* voll */ }
    }
    if (!loadKonto()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void autoPush(); }, 2500);
  });
  if (loadKonto()) {
    realtimeStarten();
    void checkKontoRemote(true).then(() => {
      if (localStorage.getItem(KONTO_DIRTY_KEY)) void autoPush();
    }).catch(() => {});
  }
  // Takt: nur der Mini-Abruf (eTag / Version); erst eine Änderung lädt
  setInterval(() => {
    void (async () => {
      if (document.visibilityState !== 'visible' || getWriterRole() !== 'writer' || !loadKonto() || anmeldungNoetig) return;
      const kenn = await kennLesen();
      const kopf = await laufwerk().kopf(UMGEBUNG);
      if (kopf === null || kopf === kenn.etag) return;
      await checkKontoRemote(true);
    })().catch(() => {});
  }, TAKT_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkKontoRemote().catch(() => {});
    else if (loadKonto() && localStorage.getItem(KONTO_DIRTY_KEY)) { clearTimeout(timer); void autoPush(); }
  });
}
