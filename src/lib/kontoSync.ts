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
import { boardVonAussen } from './sicher';
import './sicherGestalt';   // M522: hängt die Gestalt-Prüfung in lib/sicher.ts ein
import { claimWriter, flushPersist, getWriterRole, inDerived, isImportedState, useBoard, type BoardDoc, type Space } from '../store';
import {
  alsBase64, anhangKarte, base64AlsBlob, basisLesen, basisMerken, basisVergessen, buildSyncPayloadMitDateien, DATEI_BUDGET_MB,
  emitSyncStatus, fremdStandEinarbeiten, idbDel, idbGet, idbHat, idbSet, KONTO_DIRTY_KEY, merkeUngesichert, notiereAenderung, SYNC_DIRTY_KEY,
  uebernimmDateien, WEBDAV_DIRTY_KEY, type EinarbeitenErgebnis, type SyncDatei, type SyncPayload, type SyncWeg,
} from './syncFolder';
import { googleTokenFuer, loadCalAccounts, msAnmeldung, msTokenErneuern, oauthAvailable } from './calAccounts';
import { NetzFehler, sbAbmelden, sbCodeTauschen, sbErneuern, sbKontoLoeschen, sbLinkWarErwartet, sbNutzer, sbRealtime, sbRueckkehrCode, sbRueckkehrLesen, supabaseKonfig, type RealtimeEreignis, type RealtimeGriff, type SbSitzung } from './kontoSupabase';
import { nurAuswahlAnders } from './syncMerge';
import { patchFuer, type Patch } from './gastPatch';
import { anhangLokal } from './htmlStore';

// M459: Sitzung und Anzeige liegen in lib/kontoSitzung.ts (ohne den Abgleich, für den Start) — hier weitergereicht
import { KONTO_LS_KEY, kontoIstEigenes, kontoLabel, loadKonto, type Anbieter, type KontoSitzung } from './kontoSitzung';
export { kontoIstEigenes, kontoLabel, loadKonto, type Anbieter, type KontoSitzung };

const LS_KEY = KONTO_LS_KEY;
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

function saveKonto(s: KontoSitzung): void { localStorage.setItem(LS_KEY, JSON.stringify(s)); }
export const kontoStamp = (): string | null => localStorage.getItem(STAMP_KEY);

/** Abmelden: Zugangsdaten, Stempel, Basis und Server-Kenntnis weg — die Daten bleiben lokal UND im Konto. */
export function kontoAbmelden(): void {
  const s = loadKonto();
  realtimeStoppen();
  if (s?.anbieter === 'supabase' && s.token) void sbAbmelden(s.token, { url: s.url ?? '', key: s.clientId });
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(STAMP_KEY);
  // M388: Das Merkzeichen „hier liegt Ungesichertes" bleibt. Wurde es beim Abmelden gelöscht, ersetzte der Stand
  // aus dem Konto nach dem nächsten Anmelden still alles, was seit dem letzten Abgleich hier entstanden war.
  void basisVergessen('konto');
  void idbDel(KENN_KEY);
  void basenVergessen();
  anmeldungNoetig = false;
  angewandt = null;
}

// ---------- Anmeldung ----------
let anmeldungNoetig = false;

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
export async function kontoAnmelden(anbieter: Anbieter, clientId: string, tenant = 'common', hint?: string): Promise<KontoSitzung> {
  initKontoSync();   // M459: siehe kontoAnmeldenSupabase
  if (!oauthAvailable()) throw new Error('Anmelden geht nur über die gehostete App (http/https), nicht aus der Einzeldatei.');
  if (!clientId.trim()) throw new Error(anbieter === 'google' ? 'Keine Google-Client-ID hinterlegt.' : 'Keine Microsoft-App-ID hinterlegt.');
  let s: KontoSitzung;
  if (anbieter === 'google') {
    const t = await googleTokenFuer(clientId.trim(), GOOGLE_SCOPE_DRIVE, false, hint);
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
  initKontoSync();   // M459: der Abgleich läuft ohne Konto nicht von selbst an (lib/syncStart.ts) — vor der Anmeldung starten wie früher beim Start
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
  // M388: Nach dem Löschen ist dieses Gerät die einzige Kopie — sie darf ein späteres Anmelden nicht ersetzen
  try { localStorage.setItem(KONTO_DIRTY_KEY, '1'); } catch { /* voll */ }
  void basisVergessen('konto');
  void idbDel(KENN_KEY);
  void basenVergessen();
  anmeldungNoetig = false;
  angewandt = null;
}

/** Gültiges Token — still erneuert, wenn nötig. Wirft mit Klartext, wenn eine neue Anmeldung nötig ist. */
async function tokenHolen(interaktiv = false): Promise<{ s: KontoSitzung; token: string }> {
  const s = loadKonto();
  if (!s) throw new Error('Kein Konto angemeldet.');
  if (s.token && s.tokenExp && s.tokenExp > Date.now()) return { s, token: s.token };
  if (s.anbieter === 'supabase') {
    if (!s.refreshToken) throw neueAnmeldung();
    // M388: Nur eine echte Absage ist „Anmeldung abgelaufen". Ohne Netz bleibt die Sitzung, wie sie ist —
    // sonst stand nach jedem Funkloch die Aufforderung da, sich neu anzumelden.
    const t = await sbErneuern(s.refreshToken, { url: s.url ?? '', key: s.clientId }).catch((e) => { if (e instanceof NetzFehler) throw e; throw neueAnmeldung(); });
    const next = { ...s, token: t.token, tokenExp: t.exp, refreshToken: t.refreshToken, userId: t.userId || s.userId };
    saveKonto(next);
    anmeldungNoetig = false;   // sonst blieben Live-Abgleich und Takt für den Rest der Sitzung aus
    realtime?.token(t.token);
    return { s: next, token: t.token };
  }
  if (s.anbieter === 'ms') {
    if (!s.refreshToken) throw neueAnmeldung();
    const t = await msTokenErneuern(s.clientId, s.tenant ?? 'common', s.refreshToken, MS_SCOPE_DRIVE).catch((e) => {
      if (e instanceof TypeError) throw new NetzFehler('Microsoft-Konto: nicht erreichbar – Internetverbindung prüfen.');
      throw neueAnmeldung();
    });
    const next = { ...s, token: t.token, tokenExp: t.exp, refreshToken: t.refreshToken ?? s.refreshToken };
    saveKonto(next);
    anmeldungNoetig = false;
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
  return new Error(`${kontoLabel()}: Anmeldung abgelaufen – oben auf die Wolke klicken, um sie zu erneuern.`);
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
    throw new Error(`${kontoLabel()}: nicht erreichbar – Internetverbindung prüfen.`);
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
      throw new Error(`${kontoLabel()}: Die Berechtigung für den App-Ordner fehlt – bitte abmelden und neu anmelden.`);
    }
    throw new Error(`${kontoLabel()}: Zugriff verweigert (HTTP 403).`);
  }
  if (res.status === 412) throw new VorbedingungFehler();
  if (res.status === 429 || res.status >= 500) throw new Error(`${kontoLabel()}: vorübergehend nicht erreichbar (HTTP ${res.status}).`);
  return res;
}

/** M357: angemeldete Anfrage ans Konto — für Bausteine außerhalb dieser Datei (Link-Freigabe) */
export const kontoAnfrage = (url: string, init: RequestInit = {}): Promise<Response> => anfrage(url, init);

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
  /* M388: immer nur die EIGENEN Zeilen. Die Leseregel gibt auch Zeilen heraus, die andere mit mir geteilt haben
     — hat ein geteiltes Board dieselbe Kennung wie ein eigenes (das alte „main", eine behaltene Kopie), kamen
     zwei Zeilen zurück und irgendeine wurde gelesen: Das eigene Board nahm den Inhalt des fremden an. */
  const mein = (): string => { const u = loadKonto()?.userId; return u ? `&user_id=eq.${encodeURIComponent(u)}` : ''; };
  const eq = (name: string) => `name=eq.${encodeURIComponent(name)}${mein()}`;
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
      if (res.status === 404 || res.status === 400 && /[Bb]ucket not found/.test(t)) throw new Error('PixiNotes-Konto: Der Dateispeicher (Bucket „pixinotes") fehlt noch – Migration M329 beim Betreiber einspielen.');
      throw new Error(`PixiNotes-Konto: Datei-Upload fehlgeschlagen (HTTP ${res.status}).`);
    }
    return res.headers.get('etag') ?? '';
  };
  return {
    async liste() {
      const z = await zeilen(await anfrage(`${basis()}?select=name,version,groesse,updated_at&order=name${mein()}`, { cache: 'no-store' }));
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
        if (res.status === 404) throw new Error('PixiNotes-Konto: Die Datenbank ist noch nicht eingerichtet (Funktion konto_schreiben fehlt) – Migration beim Betreiber einspielen.');
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
  // M529: Fehlt die Datei im Konto, fragt die Karte nicht bei jedem Aufbau und jedem Abgleich wieder (HTTP 400)
  if (!(await fehltFaellig(id))) return null;
  const blob = await laufwerk().lesenBlob(`${DATEI_PREFIX}${id}`);
  if (!blob) { await fehltMerken(id); return null; }
  await fehltVergessen(id);
  try { await idbSet(`file:${id}`, blob); } catch { /* Platte voll — die Karte zeigt den Blob trotzdem */ }
  return blob;
}

// ---------- M529: Dateien, die im Konto fehlen ----------
// Befund beim Besitzer: Karten (eigene Tools) verwiesen auf `datei-<Kennung>`, die es im Dateispeicher nicht gab —
// jedes Gerät fragte bei jedem Aufbau der Karte und bei jedem Abgleich erneut (HTTP 400 in der Konsole), und niemand
// lud die Datei je nach. Zwei Lücken:
//   1. Eine Datei, die ein Gerät hat, die aber nicht im Konto steht (Import oder Kopie: die Karten kamen vor ihren
//      Inhalten, das Gerät wurde danach geschlossen), ging erst mit der NÄCHSTEN Änderung dieses Geräts hinaus — gab
//      es keine, nie.
//   2. Steht eine Datei in der Umgebung, gilt sie überall als „liegt im Konto" — auch wenn das Objekt fehlt. Kein Gerät
//      lud sie je wieder hoch.
// Jetzt: (a) Ein fehlendes Objekt wird gemerkt und erst nach wachsender Pause wieder angefragt (2 min … 6 h), sofort
// wieder, wenn die Umgebung meldet, dass es nachgereicht wurde (`am`); die Karte sagt, dass es auch im Konto fehlt.
// (b) Einmal je Sitzung (und alle 6 h) prüft das Gerät, ob Dateien, die es selbst hat, im Konto fehlen, und lädt sie hoch.
const FEHLT_KEY = 'konto:fehlt';
const FEHLT_STUFEN = [2 * 60_000, 10 * 60_000, 3600_000, 6 * 3600_000];
interface FehltEintrag { seit: number; naechster: number; n: number }
let fehlt: Record<string, FehltEintrag> | null = null;
export const FEHLT_EREIGNIS = 'pixinotes:konto-datei-fehlt';
async function fehltLaden(): Promise<Record<string, FehltEintrag>> {
  fehlt ??= (await idbGet<Record<string, FehltEintrag>>(FEHLT_KEY).catch(() => undefined)) ?? {};
  return fehlt;
}
/** Fehlt diese Datei (nach dem letzten Versuch) auch im Konto? Für den Hinweis an der Karte */
export const kontoDateiFehlt = async (id: string): Promise<boolean> => !!(await fehltLaden())[id];
async function fehltFaellig(id: string): Promise<boolean> {
  const e = (await fehltLaden())[id];
  return !e || Date.now() >= e.naechster;
}
async function fehltMerken(id: string): Promise<void> {
  const f = await fehltLaden();
  const n = (f[id]?.n ?? 0) + 1;
  f[id] = { seit: f[id]?.seit ?? Date.now(), n, naechster: Date.now() + FEHLT_STUFEN[Math.min(n, FEHLT_STUFEN.length) - 1] };
  await idbSet(FEHLT_KEY, f).catch(() => {});
  window.dispatchEvent(new CustomEvent(FEHLT_EREIGNIS, { detail: id }));
}
async function fehltVergessen(id: string): Promise<void> {
  const f = await fehltLaden();
  if (!f[id]) return;
  delete f[id];
  await idbSet(FEHLT_KEY, f).catch(() => {});
  window.dispatchEvent(new CustomEvent(FEHLT_EREIGNIS, { detail: id }));
}
/** Nachgereicht (die Umgebung nennt einen Zeitpunkt nach dem Merken): sofort wieder fragen */
async function fehltNachgereicht(id: string, am: number | undefined): Promise<void> {
  const e = (await fehltLaden())[id];
  if (e && am && am > e.seit) e.naechster = 0;
}

/** M529: Alle Objekte im eigenen Ordner des Dateispeichers (Name → Größe, letzte Änderung). `null`: nicht lesbar */
export async function kontoObjekte(): Promise<Map<string, { groesse: number; am: string }> | null> {
  const s = loadKonto();
  if (s?.anbieter !== 'supabase' || !s.userId) return null;
  const aus = new Map<string, { groesse: number; am: string }>();
  const SEITE = 1000;
  try {
    for (let offset = 0; offset < 100_000; offset += SEITE) {
      const res = await anfrage(`${s.url ?? ''}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST', headers: JSON_KOPF,
        body: JSON.stringify({ prefix: s.userId, limit: SEITE, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!res.ok) return null;
      const z = (await res.json()) as Array<{ name?: unknown; id?: unknown; updated_at?: unknown; created_at?: unknown; metadata?: { size?: unknown } | null }>;
      if (!Array.isArray(z)) return null;
      for (const o of z) {
        if (typeof o.name !== 'string' || !o.id) continue;    // Unterordner
        aus.set(o.name, { groesse: typeof o.metadata?.size === 'number' ? o.metadata.size : 0, am: String(o.updated_at ?? o.created_at ?? '') });
      }
      if (z.length < SEITE) break;
    }
    return aus;
  } catch { return null; }
}
/** Liegt dieses Objekt im Dateispeicher? true/false — `null`: nicht feststellbar */
async function objektDa(name: string): Promise<boolean | null> {
  const s = loadKonto();
  try {
    const res = await anfrage(`${s?.url ?? ''}/storage/v1/object/info/authenticated/${BUCKET}/${encodeURIComponent(s?.userId ?? '')}/${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (res.ok) return true;
    return res.status === 400 || res.status === 404 ? false : null;
  } catch { return null; }
}

/**
 * M529: Worauf das Konto verweist — für „Speicher aufräumen" (lib/kontoAufraeumen.ts). Liest die Umgebung und jede
 * Board-Zeile so, wie sie auf dem Server stehen (ohne den Abgleich anzufassen): Kennungen aller Karten und alle
 * Dateien, die die Umgebung nennt. `null`: nicht vollständig lesbar — dann darf nichts als verwaist gelten.
 */
export async function kontoVerweise(): Promise<{ karten: Set<string>; dateien: Set<string> } | null> {
  if (loadKonto()?.anbieter !== 'supabase') return null;
  try {
    const lw = laufwerk();
    const text = await lw.lesenText(UMGEBUNG);
    if (!text) return { karten: new Set(), dateien: new Set() };
    const u = JSON.parse(text) as Umgebung;
    if (!u || typeof u !== 'object' || !u.boards) return null;
    const karten = new Set<string>();
    const dateien = new Set(Object.keys(u.dateien ?? {}));
    for (const z of await lw.liste()) {
      if (!z.name.startsWith(BOARD_PREFIX) || !z.name.endsWith('.json')) continue;
      const t = await lw.lesenText(z.name);
      if (!t) continue;
      const b = JSON.parse(t) as { nodes?: Array<{ id?: unknown }> };
      if (!Array.isArray(b?.nodes)) return null;
      for (const n of b.nodes) if (typeof n?.id === 'string') karten.add(n.id);
    }
    return { karten, dateien };
  } catch { return null; }
}
/** M529: Objekte im eigenen Ordner des Dateispeichers löschen (nur nach Bestätigung, lib/kontoAufraeumen.ts) */
export async function kontoObjekteLoeschen(namen: string[]): Promise<number> {
  const s = loadKonto();
  if (s?.anbieter !== 'supabase' || !s.userId) return 0;
  let n = 0;
  for (const name of namen) {
    const res = await anfrage(`${s.url ?? ''}/storage/v1/object/${BUCKET}/${encodeURIComponent(s.userId)}/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => null);
    if (res && (res.ok || res.status === 404 || res.status === 400)) n += 1;
  }
  return n;
}

let nachreichenAm = 0;
/**
 * M529 (b): Dateien, die dieses Gerät hat und die im Konto fehlen, hochladen. Zwei Fälle: Die Umgebung nennt die
 * Datei gar nicht (sie kam nie hinaus) — oder sie nennt sie, aber das Objekt ist nicht da. Für den zweiten Fall
 * zählt das Verzeichnis des Dateispeichers (eine Anfrage), und jede vermisste Datei wird einzeln nachgesehen, bevor
 * sie als fehlend gilt. Dateien, die auch hier fehlen, werden nur gemerkt (die Karte zeigt es).
 */
export async function dateienNachreichen(erzwingen = false, nurUngenannte = false): Promise<number> {
  if (!nurUngenannte && !erzwingen && Date.now() - nachreichenAm < 6 * 3600_000) return 0;
  const s = loadKonto();
  if (s?.anbieter !== 'supabase' || !s.userId || getWriterRole() !== 'writer') return 0;
  if (!nurUngenannte) nachreichenAm = Date.now();
  const kenn = await kennLesen();
  if (!kenn.etag) return 0;
  const karten = new Map<string, true>();
  for (const b of useBoard.getState().boards) {
    if (b.geteiltVon || b.gastLink) continue;
    // zu groß für den Dateispeicher: bleibt außen vor (sonst stieße jede Prüfung ein Hochladen an, das nichts tut)
    for (const n of b.nodes) { const k = anhangKarte(n); if (k && k.size <= dateiMaxBytes(s)) karten.set(n.id, true); }
  }
  const bekannt = new Set(kenn.dateien);
  const ersetzt = new Set(kenn.ersetzt ?? []);
  const hoch: string[] = [];
  for (const id of karten.keys()) if (!bekannt.has(id) && !ersetzt.has(id) && await dateiLokal(id)) hoch.push(id);
  const genannt = kenn.dateien.filter((id) => karten.has(id));
  if (genannt.length && !nurUngenannte) {
    const objekte = await kontoObjekte();
    if (objekte) {
      // Dateien aus der Zeit vor M329 liegen noch in der Tabelle
      const zeilen = new Set((await laufwerk().liste().catch(() => [])).map((z) => z.name));
      for (const id of genannt) {
        const name = `${DATEI_PREFIX}${id}`;
        if (objekte.has(name) || zeilen.has(name)) continue;
        if ((await objektDa(name)) !== false) continue;
        if (await dateiLokal(id)) hoch.push(id); else await fehltMerken(id);
      }
    }
  }
  if (!hoch.length) return 0;
  // Als „nicht im Konto" verbuchen: Das nächste Schreiben nimmt sie in den Beipack und lädt sie hoch
  await exklusiv(async () => {
    const k = await kennLesen();
    await idbSet(KENN_KEY, { ...k, dateien: k.dateien.filter((id) => !hoch.includes(id)) } satisfies Kenn);
  });
  try { localStorage.setItem(KONTO_DIRTY_KEY, '1'); } catch { /* voll */ }
  void autoPush();
  return hoch.length;
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
  const uid = s.userId;
  const besitzer = [...new Set(fremdeFreigaben.map((f) => f.besitzer))].sort();
  realtimeBesitzer = besitzer.join(',');
  const planen = (fn: () => Promise<unknown>) => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => { void fn().catch(() => {}); }, 400);
  };
  realtime = sbRealtime({ url: s.url ?? '', key: s.clientId }, s.token, uid, (ev: RealtimeEreignis) => {
    if (getWriterRole() !== 'writer' || anmeldungNoetig || !loadKonto()) return;
    // M330: Eine Freigabe kam dazu oder fiel weg — Liste neu holen, Boards nachziehen (Realtime startet bei Bedarf neu)
    if (ev.tabelle === 'board_freigaben') {
      planen(() => checkKontoRemote(true));
      // M384: An der Freigabe stehen auch die Adressen der Anhänge — der Gast zieht nach (lib/gastSync.ts)
      window.dispatchEvent(new CustomEvent('pixinotes:freigaben-geaendert'));
      return;
    }
    // M330: Zeile eines Besitzers, dessen Board mit mir geteilt ist — sofort lesen
    if (ev.userId && ev.userId !== uid) { if (ev.name.startsWith(BOARD_PREFIX)) planen(() => checkKontoRemote(true)); return; }
    // Eigene Zeilen: erst die Umgebung macht einen neuen Stand gültig — Board-Dateien allein sind noch im Fluss
    if (ev.name && ev.name !== UMGEBUNG) return;
    planen(async () => {
      const kenn = await kennLesen();
      const kopf = await laufwerk().kopf(UMGEBUNG);
      if (kopf === null || kopf === kenn.etag) return; // die eigene Änderung
      await checkKontoRemote(true, true);
    });
  }, besitzer, s.name ?? '', () => (anmeldungNoetig ? Promise.reject(new Error('Anmeldung nötig')) : tokenHolen().then((r) => r.token)));
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
  /** M529 `am`: wann die Datei (wieder) hochgeladen wurde — wer sie als fehlend gemerkt hat, fragt dann sofort neu */
  dateien: Record<string, { name: string; mime?: string; groesse?: number; am?: number }>;
  /** eTag/Version des Server-Stands, auf dem dieser Schreibvorgang aufbaute —
   *  damit ein Leser den RICHTIGEN gemeinsamen Vorfahren für die Zusammen-
   *  führung wählt, auch wenn zwei Geräte sich gegenseitig überschrieben haben */
  basisEtag?: string | null;
}
/** Die letzten Server-Stände, die dieses Gerät gesehen oder geschrieben hat,
 *  je eTag — der Ring, aus dem die Zusammenführung ihren Vorfahren holt. */
interface BasisEintrag {
  etag: string; boards: BoardDoc[]; spaces: Space[];
  /** M383: Welcher Stand genau (eigene Umgebung UND die Versionen der geteilten Boards anderer) */
  marke?: string;
  /** M383: Steckt dieser Stand im lokalen? `false` = nur gelesen, noch nicht eingearbeitet (der Nutzer tippte,
   *  Konflikt). Ein solcher Stand taugt weder als Vorfahre der Zusammenführung noch als Ausgangspunkt eines
   *  Patches — beides hielte fremde Karten, die hier noch fehlen, für hier gelöscht. */
  drin?: boolean;
}
const BASEN_KEY = 'konto:basen';
/** Board ohne die Maße der Karten — die misst jedes Gerät selbst (Telefon anders als Laptop) */
function ohneMasse(b: BoardDoc): BoardDoc {
  return { ...b, nodes: b.nodes.map((n) => { const { measured: _m, ...rest } = n as typeof n & { measured?: unknown }; return rest as typeof n; }) };
}
const SERVER_STEMPEL = /^v\d+$/;
const fingerabdruck = (b: BoardDoc): string => stempel(JSON.stringify(ohneMasse(b)));
/**
 * M529: Der Ring liegt nicht mehr als EIN Wert in der Ablage. Bisher wurden bei jedem Lesen und Schreiben alle sechs
 * Stände ganz gelesen und ganz neu geschrieben — bei Boards mit großen Bildern mehrere Megabyte je Abgleich, obwohl
 * sich meist ein Board geändert hatte. Jetzt: ein kleines Verzeichnis (`konto:basen`, je Stand Kennung, Marke,
 * „eingearbeitet" und die Schlüssel seiner Boards) und je Board-Fassung ein eigener Eintrag (`konto:bb:<Board>:<n>`).
 * Ein Board, das sich nicht geändert hat, ist dasselbe Objekt (M524) — es wird nicht noch einmal geschrieben, der neue
 * Stand nennt nur seinen Schlüssel. Was kein Stand mehr nennt, wird gelöscht.
 */
interface BasisVerzeichnis { etag: string; marke?: string; drin?: boolean; boards: string[]; spaces: Space[] }
const BB = 'konto:bb:';
/** Board-Objekt → Schlüssel, unter dem genau diese Fassung liegt (nur solange er im Verzeichnis steht: `bbLebt`) */
const bbSchluessel = new WeakMap<BoardDoc, string>();
const bbLebt = new Set<string>();
let bbZaehler = Date.now();
/** Messwerte für die Prüfreihe (window.pixinotesKontoBasen): wie viele Board-Fassungen geschrieben wurden */
const basenZaehler = { boardsGeschrieben: 0, verzeichnisGeschrieben: 0 };
if (typeof window !== 'undefined') (window as unknown as { pixinotesKontoBasen?: typeof basenZaehler }).pixinotesKontoBasen = basenZaehler;
async function verzeichnisLesen(): Promise<BasisVerzeichnis[]> {
  const roh = (await idbGet<Array<BasisVerzeichnis | BasisEintrag>>(BASEN_KEY)) ?? [];
  // Altes Format (bis M528: ganze Stände im Verzeichnis) — einmal aufteilen
  if (roh.some((e) => Array.isArray(e.boards) && e.boards.some((b) => typeof b !== 'string'))) {
    const neu: BasisVerzeichnis[] = [];
    for (const e of roh) {
      const boards = await Promise.all((e.boards as Array<BoardDoc | string>).map((b) => (typeof b === 'string' ? b : boardAblegen(b))));
      neu.push({ etag: e.etag, marke: e.marke, drin: e.drin, boards, spaces: e.spaces ?? [] });
    }
    await idbSet(BASEN_KEY, neu);
    return neu;
  }
  const v = roh as BasisVerzeichnis[];
  for (const e of v) for (const k of e.boards) bbLebt.add(k);
  return v;
}
async function boardAblegen(b: BoardDoc): Promise<string> {
  const k = bbSchluessel.get(b);
  if (k && bbLebt.has(k)) return k;
  const neu = `${BB}${b.id}:${(bbZaehler++).toString(36)}`;
  await idbSet(neu, b);
  basenZaehler.boardsGeschrieben += 1;
  bbSchluessel.set(b, neu); bbLebt.add(neu);
  return neu;
}
async function verzeichnisSchreiben(v: BasisVerzeichnis[], vorher: BasisVerzeichnis[]): Promise<void> {
  await idbSet(BASEN_KEY, v);
  basenZaehler.verzeichnisGeschrieben += 1;
  const genannt = new Set(v.flatMap((e) => e.boards));
  for (const k of new Set(vorher.flatMap((e) => e.boards))) {
    if (genannt.has(k)) continue;
    bbLebt.delete(k);
    await idbDel(k).catch(() => {});
  }
}
async function basenMerken(etag: string, stand: { boards: BoardDoc[]; spaces: Space[] }, marke: string, drin: boolean): Promise<void> {
  const alle = await verzeichnisLesen();
  const vorher = alle.find((b) => b.etag === etag);
  const boards: string[] = [];
  for (const b of stand.boards) boards.push(await boardAblegen(b));
  // derselbe Stand noch einmal gelesen: Was schon eingearbeitet war, bleibt es
  const eintrag: BasisVerzeichnis = { etag, boards, spaces: stand.spaces, marke, drin: drin || (vorher?.drin === true && vorher.marke === marke) };
  if (vorher && vorher.marke === eintrag.marke && vorher.drin === eintrag.drin && vorher.spaces === eintrag.spaces
    && vorher.boards.length === boards.length && vorher.boards.every((k, i) => k === boards[i]) && alle[alle.length - 1] === vorher) return;
  await verzeichnisSchreiben([...alle.filter((b) => b.etag !== etag), eintrag].slice(-6), alle);
}
/** M383: Der gelesene Stand steckt jetzt im lokalen */
async function basisIstDrin(k: Kenn): Promise<void> {
  if (!k.etag) return;
  const alle = await verzeichnisLesen();
  const e = alle.find((b) => b.etag === k.etag);
  if (!e || e.drin === true || (e.marke !== undefined && e.marke !== kennMarke(k))) return;
  e.drin = true;
  await idbSet(BASEN_KEY, alle);
  basenZaehler.verzeichnisGeschrieben += 1;
}
async function basisFinden(etag: string | null | undefined): Promise<BasisEintrag | null> {
  if (!etag) return null;
  const e = (await verzeichnisLesen()).find((b) => b.etag === etag);
  if (!e) return null;
  const boards: BoardDoc[] = [];
  for (const k of e.boards) {
    const b = await idbGet<BoardDoc>(k);
    if (!b) return null;   // ein Teil fehlt (Ablage geleert): lieber kein Vorfahre als ein falscher
    bbSchluessel.set(b, k);
    boards.push(b);
  }
  return { etag: e.etag, boards, spaces: e.spaces, marke: e.marke, drin: e.drin };
}
/** M529: Ring und alle Board-Fassungen vergessen (Abmelden, Konto löschen) */
async function basenVergessen(): Promise<void> {
  const v = await verzeichnisLesen().catch(() => [] as BasisVerzeichnis[]);
  await idbDel(BASEN_KEY).catch(() => {});
  for (const k of new Set(v.flatMap((e) => e.boards))) { bbLebt.delete(k); await idbDel(k).catch(() => {}); }
}
/** Was wir zuletzt vom Konto wissen — damit nur Geändertes reist */
interface Kenn {
  boards: Record<string, string>; dateien: string[]; etag: string | null; savedAt: string | null; kern?: string;
  /** M330: geteilte Boards anderer Konten — Besitzer, zuletzt gesehene Zeilen-Version und Stempel */
  fremd?: Record<string, { besitzer: string; version: string; stempel: string }>;
  /** M366: Boards, deren Stempel der SERVER gesetzt hat („v<Version>", nach einer kartenweisen Änderung eines
   *  Gasts): der Stempel und der Fingerabdruck des Inhalts, wie er dabei gelesen wurde (ohne Maße). Stimmt der
   *  Inhalt hier noch damit überein, hat sich nichts geändert — sonst schriebe dieses Gerät nach JEDER Änderung
   *  eines Gasts das ganze Board zurück, nur weil sein eigener Stempel anders gerechnet ist. */
  alias?: Record<string, { st: string; hash: string }>;
  /** M524: Größe jeder Datei im Konto, wie zuletzt gesehen — daran zeigt sich, ob dort eine andere Fassung liegt,
   *  ohne den hiesigen Inhalt zu laden */
  groessen?: Record<string, number>;
  /** M524: Tools, deren Quelltext HIER ersetzt wurde und noch nicht im Konto liegt — die dortige Fassung ist die
   *  ältere und darf die hiesige nicht überschreiben */
  ersetzt?: string[];
}
const leereKenn = (): Kenn => ({ boards: {}, dateien: [], etag: null, savedAt: null });
/** M383: Kennzeichen eines Server-Stands — Version der eigenen Umgebung und der geteilten Boards anderer Konten */
const kennMarke = (k: Pick<Kenn, 'etag' | 'fremd'>): string =>
  `${k.etag ?? ''}|${Object.entries(k.fremd ?? {}).map(([id, f]) => `${id}:${f.version}`).sort().join(',')}`;
/** M328: Der Inhalt der Umgebung ohne Zeitstempel und aktives Board — gleicher Kern = nichts zu schreiben */
const umgebungKern = (u: { spaces: Space[]; reihe: string[]; boards: Record<string, string>; dateien: Record<string, unknown> }): string =>
  stempel(JSON.stringify(kanonisch({ spaces: u.spaces, reihe: u.reihe, boards: u.boards, dateien: Object.keys(u.dateien ?? {}).sort() })));
/** M383: Schlüssel sortiert — der Server legt die Umgebung nach einer kartenweisen Änderung mit anderer
 *  Schlüsselfolge ab (jsonb); derselbe Inhalt muss denselben Kern ergeben, sonst schriebe jedes Gerät sie neu */
function kanonisch(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(kanonisch);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, kanonisch((x as Record<string, unknown>)[k])]));
  return x;
}
const kennLesen = async (): Promise<Kenn> => (await idbGet<Kenn>(KENN_KEY)) ?? leereKenn();

/** FNV-1a über den JSON-Text plus Länge — schnell und für „gleich/anders" völlig ausreichend */
export function stempel(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}:${text.length}`;
}

/** M371: Datei-Anhang oder Tool-Quelltext — M524: nur nachsehen, ob er da ist (nicht laden) */
const dateiLokal = async (id: string): Promise<boolean> => {
  try { return (await idbHat(`file:${id}`)) || (await idbHat(`happ:${id}`)); } catch { return anhangLokal(id); }
};

/** Zuletzt gelesene Board-Inhalte je Stempel (nur Arbeitsspeicher) — spart das erneute Laden unveränderter Boards */
const gelesen = new Map<string, { st: string; board: BoardDoc }>();
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
  const boards: BoardDoc[] = [];
  const alias: NonNullable<Kenn['alias']> = {};
  const reihe = Array.isArray(u.reihe) && u.reihe.length ? u.reihe : Object.keys(u.boards);
  for (const id of reihe) {
    const st = u.boards[id];
    if (!st) continue;
    // Unverändert seit dem letzten Lesen? Dann aus dem Lese-Speicher — NICHT aus der Basis:
    // Die Basis trägt nur eingearbeitete Stände; nach einem „später" (der Nutzer tippte)
    // hielte sie den alten Inhalt und die Zusammenführung sähe fremde Karten als gelöscht.
    const c = gelesen.get(id);
    if (c && c.st === st) {
      boards.push(c.board);
      if (SERVER_STEMPEL.test(st)) alias[id] = alt.alias?.[id]?.st === st ? alt.alias[id] : { st, hash: fingerabdruck(c.board) };
      continue;
    }
    const t = await lw.lesenText(`${BOARD_PREFIX}${id}.json`);
    if (!t) continue; // gerade gelöscht — der nächste Takt holt den passenden Stand
    // M388: In diese Datei schreiben auch Gäste. Ihr Inhalt wird geprüft, und die Kennung bestimmt der Dateiname —
    // nie der Inhalt (lib/sicher.ts). Ist die Datei kein Board mehr, gilt sie NICHT als gelöscht: Der hiesige Stand
    // bleibt und repariert sie mit dem nächsten Schreiben. (Vorher löschte ein kaputter Inhalt das Board überall.)
    let b: BoardDoc | null = null;
    try { b = boardVonAussen(JSON.parse(t), id); } catch { b = null; }
    if (b) {
      gelesen.set(id, { st, board: b }); boards.push(b);
      if (SERVER_STEMPEL.test(st)) alias[id] = { st, hash: fingerabdruck(b) };
    } else {
      const hier = useBoard.getState().boards.find((x) => x.id === id && !x.geteiltVon);
      if (hier) boards.push(hier);
    }
  }
  if (boards.length === 0) return null;
  // M330: Boards, die andere Konten mit mir geteilt haben — aus deren Zeilen, mit Besitzer-Kennung
  let savedAt = u.savedAt;
  const fremd: NonNullable<Kenn['fremd']> = {};
  let spaces = u.spaces;
  const sitzLesen = loadKonto();
  if (sitzLesen?.anbieter === 'supabase') {
    let liste: FremdFreigabe[] = fremdeFreigaben;
    let listeFrisch = false;
    try { liste = await freigabenLaden(); listeFrisch = true; } catch { /* ohne Netz: die zuletzt bekannten */ }
    // M364: Der Besitzer hat eine Freigabe zum Bearbeiten beendet → das Board bleibt hier als eigene Kopie, mit
    // Hinweis. (Bisher ergab sich das nur nebenbei — über einen veralteten Vorfahren in der Zusammenführung;
    // ohne ihn wäre das Board still verschwunden. Nur lesend geteilte Boards verschwinden weiterhin, M360.)
    if (listeFrisch) {
      for (const b of useBoard.getState().boards) {
        if (!b.geteiltVon || b.gastLink || b.geteiltRolle === 'lesen') continue;
        if (liste.some((f) => f.board_id === b.id && f.besitzer === b.geteiltVon)) continue;
        alsEigeneKopie(b.id);
        useBoard.getState().showToast('Die Freigabe für dieses Board wurde beendet – es bleibt als eigene Kopie bei dir.', false, 8000);
      }
    }
    for (const f of liste) {
      if (boards.some((b) => b.id === f.board_id && !b.geteiltVon)) continue;
      try {
        const z = await fremdZeile(f.besitzer, f.board_id);
        if (!z) continue;
        const altF = alt.fremd?.[f.board_id];
        const c = gelesen.get(f.board_id);
        let b: BoardDoc | null = null;
        if (c && altF && c.st === `v${z.version}` && altF.version === String(z.version)) b = c.board;
        else {
          // M388: geprüft und mit der Kennung der Freigabe (nicht der aus dem Inhalt); kein Board → wie „nicht lesbar"
          b = boardVonAussen(JSON.parse(z.inhalt), f.board_id);
          if (!b) throw new Error('kein Board');
          gelesen.set(f.board_id, { st: `v${z.version}`, board: b });
        }
        b = { ...b, geteiltVon: f.besitzer, geteiltVonName: f.besitzer_email };
        // M360: nur lesend geteilt — die Oberfläche ändert das Board nicht (Leseschutz im Speicher)
        if (f.rolle === 'lesen') b.geteiltRolle = 'lesen'; else delete b.geteiltRolle;
        boards.push(b);
        fremd[f.board_id] = { besitzer: f.besitzer, version: String(z.version), stempel: stempel(z.inhalt) };
        if (z.updated_at && z.updated_at > savedAt) savedAt = z.updated_at;
      } catch {
        // Ein fremdes Board darf den Abgleich nicht aufhalten. M360: Ließ sich seine Zeile gerade nicht lesen
        // (Netz), gilt der hiesige Stand weiter — sonst hielte die Zusammenführung das Board für entfernt.
        // M388: … und zwar der zuletzt GELESENE Stand des Servers, nicht das Board, wie es hier gerade aussieht.
        // Sonst galt Ungesichertes als „schon auf dem Server" und ging nie hinaus (verschobene, gelöschte Karten,
        // Striche); mit der nächsten Änderung des Besitzers verschwand es. Nur ohne gemerkten Stand der hiesige.
        const lokal = useBoard.getState().boards.find((x) => x.id === f.board_id && x.geteiltVon === f.besitzer);
        const zuletzt = gelesen.get(f.board_id)?.board
          ?? (await basisLesen('konto'))?.boards.find((x) => x.id === f.board_id && x.geteiltVon === f.besitzer);
        const hier = lokal && zuletzt ? { ...zuletzt, geteiltVon: f.besitzer, geteiltVonName: lokal.geteiltVonName, ...(lokal.geteiltRolle ? { geteiltRolle: lokal.geteiltRolle } : {}) } as BoardDoc : lokal;
        if (hier && !boards.some((x) => x.id === hier.id)) {
          boards.push(hier);
          if (alt.fremd?.[f.board_id]) fremd[f.board_id] = alt.fremd[f.board_id];
        }
      }
    }
    spaces = mitGeteiltBereich(u.spaces, boards.filter((b) => b.geteiltVon));
  }
  const dateien: Record<string, SyncDatei> = {};
  const groessen: Record<string, number> = {};
  // M524: hier ersetzte, noch nicht hochgeladene Tools — solange die Karte im Konto steht
  const ersetzt = (alt.ersetzt ?? []).filter((id) => !!u.dateien?.[id]);
  for (const [id, meta] of Object.entries(u.dateien ?? {})) {
    if (meta.groesse) groessen[id] = meta.groesse;
    if (ersetzt.includes(id)) continue;
    // M371: Ein Tool, dessen Quelltext im Konto inzwischen ein anderer ist (Datei ersetzt), wird neu geholt.
    // M524: Ob er ein anderer ist, sagt die Größe im Konto, verglichen mit der zuletzt dort gesehenen — nicht mehr
    // der hiesige Inhalt. Vorher wurde bei JEDEM Lesen der Quelltext jedes Tools dreimal aus der Ablage geladen
    // (bei 16 Tools mit 5 MB dauerte ein einziger Abgleich viele Sekunden, alles andere wartete dahinter), und
    // ein hier gerade ersetzter Quelltext galt als „veraltet": Die alte Fassung aus dem Konto überschrieb ihn.
    // Der alte Vergleich schlug außerdem bei jedem Tool mit Umlauten DAUERHAFT an: Die Karte nennt die Länge in
    // Zeichen, die Ablage misst Bytes — solche Tools wurden bei jedem Lesen auf jedem Gerät neu heruntergeladen
    // (mehrere Megabyte je Abgleich). Ein Gerät, das die Größen noch nie gemerkt hat, holt deshalb nichts nach.
    const gesehen = alt.groessen?.[id];
    const veraltet = meta.mime === 'text/html' && !!meta.groesse && alt.dateien.includes(id) && gesehen !== undefined && gesehen !== meta.groesse;
    if (!veraltet && await dateiLokal(id)) continue;
    // M329: Große Anhänge holt die Karte beim Öffnen (kontoDateiNachladen) — nicht jeder Abgleich
    if ((meta.groesse ?? 0) > DATEI_SOFORT_BYTES) continue;
    // M529: Fehlt sie im Konto, nicht bei jedem Lesen wieder fragen — außer, sie wurde inzwischen nachgereicht
    await fehltNachgereicht(id, meta.am);
    if (!(await fehltFaellig(id))) continue;
    try {
      const blob = await lw.lesenBlob(`${DATEI_PREFIX}${id}`);
      if (blob) { dateien[id] = { name: meta.name, mime: meta.mime ?? (blob.type || undefined), b64: await alsBase64(blob) }; await fehltVergessen(id); }
      else await fehltMerken(id);
    } catch { /* eine Datei darf den Abgleich nicht aufhalten */ }
  }
  const kenn: Kenn = {
    boards: { ...u.boards }, dateien: Object.keys(u.dateien ?? {}).filter((id) => !ersetzt.includes(id)), etag, savedAt,
    kern: umgebungKern({ spaces: u.spaces, reihe, boards: u.boards, dateien: u.dateien ?? {} }), fremd, groessen,
    ...(Object.keys(alias).length ? { alias } : {}), ...(ersetzt.length ? { ersetzt } : {}),
  };
  await idbSet(KENN_KEY, kenn);
  const payload: SyncPayload = { app: 'pixinotes', version: 2, savedAt, boards, spaces, activeId: u.activeId, ...(Object.keys(dateien).length ? { dateien } : {}) };
  // Zwei Geräte, die sich überschrieben haben (Drive kennt keine Vorbedingung):
  // Der Schreiber nennt den Stand, auf dem er aufbaute. Haben wir den noch,
  // ist ER der gemeinsame Vorfahre — nicht unser letzter eigener Stand, der
  // sonst eine fremde Lücke als „gelöscht" deuten ließe.
  const vorfahre = await basisFinden(u.basisEtag);
  // M364: Schreibt ein Gast in die Zeile des Besitzers, bleibt in der Umgebung der Vorfahre des LETZTEN EIGENEN
  // Schreibens stehen — älter als das, was dieses Gerät schon kennt. Nähme man ihn, sähe die Zusammenführung die
  // eigene, längst gesicherte Fassung einer Karte als „hier geändert" und verwürfe die des Gasts. Beim
  // PixiNotes-Konto (Versionen zählen hoch, Schreiben hat eine Vorbedingung) gilt darum: nie hinter den
  // bekannten Stand zurück. (Neue Server tragen den richtigen Vorfahren selbst ein, siehe Migration M364.)
  const veraltet = sitzLesen?.anbieter === 'supabase' && !!alt.etag && !!u.basisEtag && Number(u.basisEtag) < Number(alt.etag);
  // M383: … und nur, wenn dieser Stand hier auch eingearbeitet wurde (nicht bloß gelesen, während der Nutzer tippte)
  if (vorfahre && vorfahre.drin !== false && vorfahre.etag !== etag && !veraltet) await basisMerken('konto', { boards: vorfahre.boards, spaces: vorfahre.spaces });
  await basenMerken(etag, { boards, spaces }, kennMarke(kenn), false);
  return { payload, kenn };
}

// ---------- M330: Geteilte Boards ----------
export interface Freigabe { id: string; besitzer: string; board_id: string; gast_email: string; gast_id: string | null; rolle: string; created_at: string }
interface FremdFreigabe { besitzer: string; besitzer_email: string; board_id: string; rolle: string }
/** Die zuletzt geladenen Freigaben anderer Konten für mich */
let fremdeFreigaben: FremdFreigabe[] = [];
/** M360: Die Liste oben stammt aus einer geglückten Abfrage dieser Sitzung (nicht nur der leere Anfangswert) */
let freigabenGeladen = false;
/** Besitzer, auf deren Zeilen Realtime gerade lauscht (um einen Neustart zu erkennen) */
let realtimeBesitzer = '';
const restUrl = (): string => `${loadKonto()?.url ?? ''}/rest/v1`;
const JSON_KOPF = { 'Content-Type': 'application/json' };
async function rpc<T>(name: string, body: unknown): Promise<T> {
  const res = await anfrage(`${restUrl()}/rpc/${name}`, { method: 'POST', headers: JSON_KOPF, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 404) throw new Error('PixiNotes-Konto: Freigaben sind beim Betreiber noch nicht eingerichtet (Migration M330 fehlt).');
    throw new Error(/vorbedingung/i.test(t) ? 'vorbedingung' : /keine freigabe/i.test(t) ? 'keine freigabe' : `PixiNotes-Konto: ${name} fehlgeschlagen (HTTP ${res.status}).`);
  }
  return (await res.json()) as T;
}
const nurEigenesKonto = (): void => { if (loadKonto()?.anbieter !== 'supabase') throw new Error('Freigaben gibt es nur mit dem PixiNotes-Konto (E-Mail-Anmeldung).'); };
/** Offene Einladungen annehmen und die Liste der mit mir geteilten Boards holen; startet Realtime neu, wenn Besitzer dazukommen */
async function freigabenLaden(): Promise<FremdFreigabe[]> {
  await rpc<number>('freigaben_annehmen', {}).catch(() => 0);
  const liste = await rpc<FremdFreigabe[]>('freigaben_fuer_mich', {});
  fremdeFreigaben = Array.isArray(liste) ? liste : [];
  freigabenGeladen = true;
  const schluessel = [...new Set(fremdeFreigaben.map((f) => f.besitzer))].sort().join(',');
  if (schluessel !== realtimeBesitzer && realtime) setTimeout(() => realtimeStarten(), 0);
  return fremdeFreigaben;
}
/**
 * M360: Weicht bei den geteilten Boards etwas ab, das kein Zeitstempel verrät? Eine neue Freigabe für ein
 * Board, das der Besitzer länger nicht angefasst hat (es fehlt hier noch), oder ein Rollenwechsel
 * (bearbeiten ↔ nur lesen). Ohne diese Prüfung galt der Stand als „gleich" und das Board erschien erst,
 * wenn der Besitzer es das nächste Mal änderte.
 */
function rollenAnders(fremd: Array<Pick<BoardDoc, 'id' | 'geteiltVon' | 'geteiltRolle'>>): boolean {
  const hier = new Map(useBoard.getState().boards.map((b) => [b.id, b]));
  if (fremd.some((f) => {
    if (!f.geteiltVon) return false;
    const b = hier.get(f.id);
    if (!b) return true;
    return !!b.geteiltVon && (b.geteiltRolle ?? '') !== (f.geteiltRolle ?? '');
  })) return true;
  // Eine beendete Freigabe „nur lesen": Das Board darf hier nicht gesperrt und veraltet liegen bleiben.
  // Maßgeblich ist die zuletzt erfolgreich geladene Liste — ein Netzfehler beim Lesen einer Zeile zählt nicht.
  if (!freigabenGeladen) return false;
  return [...hier.values()].some((b) => b.geteiltRolle === 'lesen' && !!b.geteiltVon
    && !fremdeFreigaben.some((f) => f.board_id === b.id && f.besitzer === b.geteiltVon));
}
/** Die Board-Zeile eines Besitzers (RLS: nur, wenn er sie mit mir geteilt hat) */
async function fremdZeile(besitzer: string, boardId: string): Promise<{ inhalt: string; version: number; updated_at?: string } | null> {
  const res = await anfrage(`${restUrl()}/konto_dateien?select=inhalt,version,updated_at&user_id=eq.${encodeURIComponent(besitzer)}&name=eq.${encodeURIComponent(`${BOARD_PREFIX}${boardId}.json`)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`PixiNotes-Konto: HTTP ${res.status}`);
  const z = (await res.json()) as Array<{ inhalt: string; version: number; updated_at?: string }>;
  return z[0] ?? null;
}
/** Geteilte Boards, die in keinem Projekt stehen, landen unter „Geteilt mit mir" → ein Projekt je Besitzer */
export function mitGeteiltBereich(spaces: Space[], geteilt: BoardDoc[]): Space[] {
  const fehlt = geteilt.filter((b) => !spaces.some((sp) => sp.projects.some((p) => p.boardIds.includes(b.id))));
  if (fehlt.length === 0) return spaces;
  const aus = spaces.map((sp) => ({ ...sp, projects: sp.projects.map((p) => ({ ...p, boardIds: [...p.boardIds] })) }));
  let bereich = aus.find((sp) => sp.id === 'geteilt');
  if (!bereich) { bereich = { id: 'geteilt', name: 'Geteilt mit mir', projects: [] }; aus.push(bereich); }
  for (const b of fehlt) {
    const pid = `geteilt-${b.geteiltVon}`;
    let p = bereich.projects.find((x) => x.id === pid);
    if (!p) { p = { id: pid, name: b.geteiltVonName ?? 'Freigaben', boardIds: [] }; bereich.projects.push(p); }
    if (!p.boardIds.includes(b.id)) p.boardIds.push(b.id);
  }
  return aus;
}
/** Ein Board ohne Freigabe weiterführen: als eigene Kopie (die Kennung des Besitzers fällt weg) */
function alsEigeneKopie(boardId: string): void {
  useBoard.setState((s) => ({ boards: s.boards.map((b) => (b.id === boardId ? (({ geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, ...rest }) => rest)(b) as BoardDoc : b)) }));
  fremdeFreigaben = fremdeFreigaben.filter((f) => f.board_id !== boardId);
}
/** Freigaben eines eigenen Boards (Besitzer-Sicht) */
export async function freigabenDesBoards(boardId: string): Promise<Freigabe[]> {
  nurEigenesKonto();
  const s = loadKonto()!;
  const res = await anfrage(`${restUrl()}/board_freigaben?select=*&board_id=eq.${encodeURIComponent(boardId)}&besitzer=eq.${encodeURIComponent(s.userId ?? '')}&order=created_at`, { cache: 'no-store' });
  if (res.status === 404) throw new Error('PixiNotes-Konto: Freigaben sind beim Betreiber noch nicht eingerichtet (Migration M330 fehlt).');
  if (!res.ok) throw new Error(`PixiNotes-Konto: Freigaben nicht lesbar (HTTP ${res.status}).`);
  return (await res.json()) as Freigabe[];
}
/** Ein eigenes Board für eine E-Mail freigeben. Das Board muss schon im Konto liegen — notfalls jetzt schreiben. */
export type FreigabeRolle = 'bearbeiten' | 'lesen';
export async function freigabeAnlegen(boardId: string, email: string, rolle: FreigabeRolle = 'bearbeiten'): Promise<Freigabe> {
  nurEigenesKonto();
  const s = loadKonto()!;
  if (s.name && s.name.toLowerCase() === email.trim().toLowerCase()) throw new Error('Das ist deine eigene E-Mail.');
  if (localStorage.getItem(KONTO_DIRTY_KEY)) await kontoWrite().catch(() => {});
  const res = await anfrage(`${restUrl()}/board_freigaben?on_conflict=besitzer,board_id,gast_email`, {
    method: 'POST', headers: { ...JSON_KOPF, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ board_id: boardId, gast_email: email.trim().toLowerCase(), rolle }),
  });
  if (res.status === 404) throw new Error('PixiNotes-Konto: Freigaben sind beim Betreiber noch nicht eingerichtet (Migration M330 fehlt).');
  if (!res.ok) throw new Error(`PixiNotes-Konto: Freigabe nicht gespeichert (HTTP ${res.status}).`);
  const z = (await res.json()) as Freigabe[];
  return z[0];
}
/** M360: Rolle einer bestehenden Freigabe ändern — der Gast sieht den Wechsel live (Realtime auf board_freigaben) */
export async function freigabeRolleSetzen(id: string, rolle: FreigabeRolle): Promise<void> {
  nurEigenesKonto();
  const res = await anfrage(`${restUrl()}/board_freigaben?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { ...JSON_KOPF, Prefer: 'return=minimal' }, body: JSON.stringify({ rolle }) });
  if (!res.ok) throw new Error(`PixiNotes-Konto: Rolle nicht gespeichert (HTTP ${res.status}).`);
}
export async function freigabeEntfernen(id: string): Promise<void> {
  nurEigenesKonto();
  const res = await anfrage(`${restUrl()}/board_freigaben?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`PixiNotes-Konto: Freigabe nicht entfernt (HTTP ${res.status}).`);
}
/** Als Gast eine Freigabe verlassen — das Board bleibt als eigene Kopie */
export async function freigabeVerlassen(boardId: string): Promise<void> {
  nurEigenesKonto();
  const s = loadKonto()!;
  const res = await anfrage(`${restUrl()}/board_freigaben?board_id=eq.${encodeURIComponent(boardId)}&gast_id=eq.${encodeURIComponent(s.userId ?? '')}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`PixiNotes-Konto: Freigabe nicht verlassen (HTTP ${res.status}).`);
  alsEigeneKopie(boardId);
  const kenn = await kennLesen();
  if (kenn.fremd?.[boardId]) { delete kenn.fremd[boardId]; await idbSet(KENN_KEY, kenn); }
  try { localStorage.setItem(KONTO_DIRTY_KEY, '1'); } catch { /* voll */ }
}
/** Ein geteiltes Board in die Zeile des Besitzers schreiben (RPC mit Vorbedingung) */
async function fremdSchreiben(besitzer: string, boardId: string, text: string, st: string, wennVersion: string | null): Promise<string> {
  try {
    const v = await rpc<number | string>('freigabe_schreiben', { p_besitzer: besitzer, p_board_id: boardId, p_inhalt: text, p_stempel: st, p_wenn_version: wennVersion === null ? null : Number(wennVersion) });
    return String(v);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'vorbedingung') throw new VorbedingungFehler();
    if (msg === 'keine freigabe') {
      // M360: Vielleicht hat der Besitzer nur die Rolle auf „Nur lesen" gestellt — dann bleibt das Board geteilt,
      // der Stand des Besitzers gilt und die eigene, nicht mehr annehmbare Änderung fällt weg.
      const liste = await freigabenLaden().catch(() => null);
      if (liste?.some((f) => f.board_id === boardId && f.besitzer === besitzer && f.rolle === 'lesen')) {
        useBoard.setState((s) => ({ boards: s.boards.map((b) => (b.id === boardId ? { ...b, geteiltRolle: 'lesen' as const } : b)) }));
        const z = await fremdZeile(besitzer, boardId).catch(() => null);
        if (z) {
          try {
            const gelesenesBoard = boardVonAussen(JSON.parse(z.inhalt), boardId);
            if (!gelesenesBoard) throw new Error('kein Board');
            const frisch = { ...gelesenesBoard, geteiltVon: besitzer, geteiltVonName: liste.find((f) => f.board_id === boardId)?.besitzer_email, geteiltRolle: 'lesen' as const };
            const st = useBoard.getState();
            st.importSync(st.boards.map((b) => (b.id === boardId ? frisch : b)), st.spaces, st.activeId, { geaendert: [boardId] });
            const kenn = await kennLesen();
            await idbSet(KENN_KEY, { ...kenn, fremd: { ...(kenn.fremd ?? {}), [boardId]: { besitzer, version: String(z.version), stempel: stempel(z.inhalt) } } } satisfies Kenn);
          } catch { /* der nächste Abgleich holt den Stand */ }
        }
        useBoard.getState().showToast('Der Besitzer hat dieses Board auf „Nur lesen" gestellt – deine letzte Änderung wurde nicht übernommen.', false, 8000);
        throw new SpaeterFehler();
      }
      alsEigeneKopie(boardId);
      useBoard.getState().showToast('Die Freigabe für dieses Board wurde beendet – es bleibt als eigene Kopie bei dir.', false, 8000);
      throw new SpaeterFehler();
    }
    throw e;
  }
}

// ---------- M383: Änderungen kartenweise schreiben ----------
// Bisher reiste nach jeder Änderung das ganze Board (bei tausend Karten jedes Mal alle tausend), und wer zugleich
// mit einem anderen schrieb, scheiterte an der Vorbedingung und musste erst zusammenführen. board_aendern nimmt
// nur, was sich geändert hat, und fügt es auf dem Server unter der Zeilensperre ein — wie gast_aendern (M366)
// für Gäste per Link, hier für den Besitzer und für Gäste mit Konto. Kennt der Server die Funktion nicht
// (Migration fehlt), bleibt es beim bisherigen Weg.
/** Der Server kennt board_aendern nicht — bis zum nächsten Laden nicht mehr fragen */
let ohneBoardAendern = false;
/** Größere Patches reisen als ganzes Board (der Server nimmt bis 6 Mio. Zeichen) */
const PATCH_MAX_ZEICHEN = 4_000_000;
interface AendernAntwort { version: number; vor: number; umgebung: number | null; umgebung_vor: number | null }
/**
 * M529: Vorbedingung beim kartenweisen Schreiben. Mit der Migration 20261125100000 nimmt board_aendern
 * `p_wenn_umgebung` (Version der Umgebung des Besitzers, die das Gerät kennt) bzw. `p_wenn_version` (Version der
 * Board-Zeile, für Gäste mit Konto) und schreibt NICHTS, wenn inzwischen ein anderer geschrieben hat („vorbedingung").
 * Das Gerät liest dann neu, führt Feld für Feld zusammen und schreibt erneut — vorher ersetzte die später eintreffende
 * ganze Karte die eines anderen Geräts (M524, „Grenzen"). Ohne Migration antwortet der Server mit 404 (Funktion mit
 * diesen Parametern unbekannt): dann ohne Vorbedingung wie bisher, und vor dem Schreiben bleibt der Mini-Abruf.
 * 'ja' erst, wenn der Server bestätigt, geprüft zu haben (`geprueft`) — ein Server, der die Parameter nur hinnähme,
 * gilt als 'nein'.
 */
let vorbedingung: 'unbekannt' | 'ja' | 'nein' = 'unbekannt';
/** `null`: auf diesem Weg nicht möglich (Funktion fehlt, abgelehnt) → das ganze Board schreiben. Wirft
 *  VorbedingungFehler, wenn der Server wegen einer fremden Änderung nichts geschrieben hat. */
async function boardAendern(besitzer: string, boardId: string, p: Patch, savedAt?: string, wenn?: { umgebung?: string | null; version?: string | null }): Promise<AendernAntwort | null> {
  const wennU = wenn?.umgebung ? Number(wenn.umgebung) : null;
  const wennV = wenn?.version ? Number(wenn.version) : null;
  const mitWenn = vorbedingung !== 'nein' && (wennU !== null || wennV !== null);
  const res = await anfrage(`${restUrl()}/rpc/board_aendern`, { method: 'POST', headers: JSON_KOPF, body: JSON.stringify({
    p_besitzer: besitzer, p_board_id: boardId, p_patch: p, p_saved_at: savedAt ?? null,
    ...(mitWenn ? { p_wenn_umgebung: wennU, p_wenn_version: wennV } : {}),
  }) });
  if (res.status === 404 && mitWenn) { vorbedingung = 'nein'; return boardAendern(besitzer, boardId, p, savedAt); }
  if (res.status === 404) { ohneBoardAendern = true; return null; }
  if (res.status >= 400 && res.status < 500) {
    const t = await res.text().catch(() => '');
    if (mitWenn && /vorbedingung/i.test(t)) { vorbedingung = 'ja'; throw new VorbedingungFehler(); }
    return null;     // keine Freigabe, Board fehlt, ungültig: der bisherige Weg klärt es
  }
  if (!res.ok) throw new Error(`PixiNotes-Konto: Schreiben fehlgeschlagen (HTTP ${res.status}).`);
  const j = (await res.json().catch(() => null)) as (Partial<AendernAntwort> & { geprueft?: unknown }) | null;
  if (!j || typeof j.version !== 'number' || typeof j.vor !== 'number') { ohneBoardAendern = true; return null; }
  if (mitWenn) vorbedingung = j.geprueft === true ? 'ja' : 'nein';
  return { version: j.version, vor: j.vor, umgebung: typeof j.umgebung === 'number' ? j.umgebung : null, umgebung_vor: typeof j.umgebung_vor === 'number' ? j.umgebung_vor : null };
}
/** Geteiltes Board ohne die Angaben, die nur dieses Gerät betreffen */
function ohneFreigabeFelder(b: BoardDoc): BoardDoc {
  const { geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, ...rein } = b;
  return rein as BoardDoc;
}

let kette: Promise<unknown> = Promise.resolve();
function exklusiv<T>(fn: () => Promise<T>): Promise<T> {
  const p = kette.then(fn, fn);
  kette = p.catch(() => {});
  return p;
}

/** Aktuellen Stand ins Konto schreiben — nur Geändertes. Setzt Stempel, Basis, Kenntnis und Status. */
export async function kontoWrite(): Promise<string> {
  const r = await exklusiv(() => kontoWriteRoh(true));
  // M364: Gäste, die per Link (ohne Konto) dabei sind, erfahren es über den Live-Kanal (lib/gastSync.ts)
  window.dispatchEvent(new CustomEvent('pixinotes:konto-geschrieben'));
  return r;
}
async function kontoWriteRoh(nochmal: boolean, nachMerge = false): Promise<string> {
  const lw = laufwerk();
  const vorab = await kennLesen();
  if (!nachMerge && vorab.etag && kennMarke(vorab) !== angewandt) {
    // Der zuletzt gelesene Stand steckt noch nicht im lokalen (der Nutzer tippte, Konflikt,
    // Neustart): erst einarbeiten — sonst überschriebe die Vorbedingung fremde Karten.
    const r = await kontoLesen();
    if (r) {
      const erg = await einarbeiten(r.payload);
      if (erg === 'spaeter') throw new SpaeterFehler();
      if (erg === 'konflikt') { emitSyncStatus('konto', 'conflict'); throw new Error(`${kontoLabel()} und lokaler Stand weichen ab, nichts überschrieben. Unter Einstellungen → Daten → Synchronisation wählen.`); }
      if (erg === 'fehler') throw new Error('Der Stand aus dem Konto konnte nicht gespeichert werden (Browser-Speicher voll?).');
      // zusammengeführt/geschrieben: die Zusammenführung hat selbst geschrieben; gleich/übernommen: jetzt der eigene Anteil
      if (erg === 'zusammengefuehrt' || erg === 'geschrieben') return kontoStamp() ?? new Date().toISOString();
    } else {
      angewandt = null;
    }
  }
  const s = useBoard.getState();
  let kenn = await kennLesen();
  const sitz = loadKonto();
  // M329: Beim PixiNotes-Konto reisen nur NEUE Anhänge (bis 50 MB) — bekannte liegen schon im Dateispeicher
  const bekanntVorab = new Set(kenn.dateien);
  const payload = sitz?.anbieter === 'supabase'
    ? await buildSyncPayloadMitDateien(Math.max(s.syncDateienMb ?? DATEI_BUDGET_MB, 256), (id) => !bekanntVorab.has(id))
    : await buildSyncPayloadMitDateien(s.syncDateienMb ?? DATEI_BUDGET_MB);
  // M330: Geteilte Boards gehören einem anderen Konto — sie gehen über freigabe_schreiben, nicht in die eigene Umgebung
  const eigene = payload.boards.filter((b) => !b.geteiltVon);
  // M360: nur lesend geteilte Boards reisen nie zurück — sie ändern sich hier nicht
  // M364: Boards, in die man sich nur per Link eingewählt hat (ohne Konto), gleicht lib/gastSync.ts ab
  const fremde = sitz?.anbieter === 'supabase' ? payload.boards.filter((b) => b.geteiltVon && b.geteiltRolle !== 'lesen' && !b.gastLink) : [];
  const stempelNeu: Record<string, string> = {};
  const aliasBleibt: NonNullable<Kenn['alias']> = {};
  const texte = new Map<string, string>();
  for (const b of eigene) {
    const t = JSON.stringify(b);
    texte.set(b.id, t);
    stempelNeu[b.id] = stempel(t);
    // M366: Der Stempel stammt vom Server und der Inhalt ist noch der gelesene → unverändert, nichts schreiben
    const al = kenn.alias?.[b.id];
    if (al && kenn.boards[b.id] === al.st && al.hash === fingerabdruck(b)) { stempelNeu[b.id] = al.st; aliasBleibt[b.id] = al; }
  }
  const fremdPlan: Array<{ b: BoardDoc; text: string; st: string }> = [];
  for (const b of fremde) {
    const { geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, ...rein } = b;
    const text = JSON.stringify(rein);
    const st = stempel(text);
    if (kenn.fremd?.[b.id]?.stempel === st) continue;
    fremdPlan.push({ b, text, st });
  }
  // M383: was kartenweise hinausging — eigene Boards (Kennung → Stempel davor) und geteilte Boards anderer
  const gepatcht = new Map<string, string>();
  const fremdErledigt = new Set<string>();
  const fremdNeu: NonNullable<Kenn['fremd']> = { ...(kenn.fremd ?? {}) };
  const kernBekannt = kenn.kern;
  try {
    // M524: board_aendern prüft nichts — eine Karte, die hier auf einem älteren Stand beruht, ersetzt auf dem Server
    // die neuere eines anderen Geräts (dessen Änderung ist dann überall weg). Zwischen dem Blick auf den Server
    // (autoPush) und hier liegen die Warteschlange und das Zusammenstellen des Stands, bei großen Boards Sekunden.
    // Darum unmittelbar vor dem Schreiben noch einmal der Mini-Abruf: Hat inzwischen ein anderer geschrieben, erst
    // dessen Stand einarbeiten (das schreibt dann selbst, mit beiden Anteilen).
    // M529: Prüft der Server die Vorbedingung selbst (board_aendern mit p_wenn_umgebung), braucht es den Blick nicht
    if (nochmal && sitz?.anbieter === 'supabase' && !ohneBoardAendern && kenn.etag && vorbedingung !== 'ja') {
      const kopf = await lw.kopf(UMGEBUNG);
      if (kopf !== null && kopf !== kenn.etag) throw new VorbedingungFehler();
    }
    // M383: Geänderte Boards, die der Server schon kennt, kartenweise — nur was sich geändert hat
    if (sitz?.anbieter === 'supabase' && sitz.userId && !ohneBoardAendern && kenn.etag) {
      const basis = await basisFinden(kenn.etag);
      // nur von einem Stand aus, der im lokalen steckt (nach einer Zusammenführung: der eben gelesene)
      if (basis && (nachMerge || basis.drin !== false)) {
        // Der Stand des Servers nach jedem Schritt — nur was wirklich hinausging, gilt als bekannt
        const basisBoards = [...basis.boards];
        let basisNeu = false;
        const basisSetzen = (id: string, fremd: boolean, b: BoardDoc): void => {
          const i = basisBoards.findIndex((x) => x.id === id && !!x.geteiltVon === fremd);
          if (i >= 0) { basisBoards[i] = b; basisNeu = true; }
        };
        try {
          for (const b of eigene) {
            if (ohneBoardAendern) break;
            const alt = kenn.boards[b.id];
            if (!alt || alt === stempelNeu[b.id]) continue;      // neu (das ganze Board) oder unverändert
            const vor = basis.boards.find((x) => x.id === b.id && !x.geteiltVon);
            const f = vor ? patchFuer(vor, b) : null;
            if (!f) continue;                                     // Name, Reihenfolge … geändert: das ganze Board
            if (!f.p) { stempelNeu[b.id] = alt; aliasBleibt[b.id] = { st: alt, hash: fingerabdruck(b) }; continue; }   // nur anders gemessen
            if (JSON.stringify(f.p).length > PATCH_MAX_ZEICHEN) continue;
            const r = await boardAendern(sitz.userId, b.id, f.p, payload.savedAt, { umgebung: kenn.etag });
            if (!r || r.umgebung === null) continue;
            // Hat inzwischen ein anderer geschrieben, liegt die eigene Änderung jetzt auf dessen Stand — den erst holen
            if (String(r.umgebung_vor) !== kenn.etag) throw new VorbedingungFehler();
            const st = `v${r.version}`;
            gepatcht.set(b.id, alt);
            stempelNeu[b.id] = st; aliasBleibt[b.id] = { st, hash: fingerabdruck(b) };
            gelesen.set(b.id, { st, board: f.stand });
            basisSetzen(b.id, false, f.stand);
            kenn = { ...kenn, boards: { ...kenn.boards, [b.id]: st }, etag: String(r.umgebung), savedAt: payload.savedAt, kern: undefined, alias: { ...(kenn.alias ?? {}), [b.id]: aliasBleibt[b.id] } };
            await idbSet(KENN_KEY, kenn);
            angewandt = kennMarke(kenn);
          }
          for (const f of fremdPlan) {
            if (ohneBoardAendern) break;
            const kf = kenn.fremd?.[f.b.id];
            const vor = basis.boards.find((x) => x.id === f.b.id && !!x.geteiltVon);
            const pf = vor && kf ? patchFuer(ohneFreigabeFelder(vor), ohneFreigabeFelder(f.b)) : null;
            if (!pf || !vor || !kf) continue;
            if (!pf.p) { fremdNeu[f.b.id] = { ...kf, stempel: f.st }; fremdErledigt.add(f.b.id); continue; }
            if (JSON.stringify(pf.p).length > PATCH_MAX_ZEICHEN) continue;
            const r = await boardAendern(f.b.geteiltVon!, f.b.id, pf.p, undefined, { version: kf.version });
            if (!r) continue;                                     // etwa: Freigabe beendet oder nur noch lesend — das klärt der bisherige Weg
            if (String(r.vor) !== kf.version) throw new VorbedingungFehler();
            fremdNeu[f.b.id] = { besitzer: f.b.geteiltVon!, version: String(r.version), stempel: f.st };
            fremdErledigt.add(f.b.id);
            gelesen.set(f.b.id, { st: `v${r.version}`, board: pf.stand });
            basisSetzen(f.b.id, true, { ...vor, ...pf.stand });
            kenn = { ...kenn, fremd: { ...fremdNeu } };
            await idbSet(KENN_KEY, kenn);
            angewandt = kennMarke(kenn);
          }
        } finally {
          if (basisNeu && kenn.etag) await basenMerken(kenn.etag, { boards: basisBoards, spaces: basis.spaces }, kennMarke(kenn), true);
        }
      }
    }
    const plan: Schreibplan = { schreiben: [], loeschen: [] };
    // 1) Boards, die sich geändert haben
    for (const b of eigene) {
      if (kenn.boards[b.id] === stempelNeu[b.id]) continue;
      plan.schreiben.push({ name: `${BOARD_PREFIX}${b.id}.json`, body: texte.get(b.id)!, mime: 'application/json' });
    }
    // 2) Boards, die es nicht mehr gibt
    for (const id of Object.keys(kenn.boards)) {
      if (!stempelNeu[id]) plan.loeschen.push(`${BOARD_PREFIX}${id}.json`);
    }
    // 3) Dateien: neue hinauf (Drive/OneDrive bis 4 MB, PixiNotes-Konto bis 50 MB), verwaiste weg
    const dateienMeta: Record<string, { name: string; mime?: string; groesse?: number; am?: number }> = {};
    const bekannt = new Set(kenn.dateien);
    const maxBytes = dateiMaxBytes(sitz);
    // Name, Typ und Größe jeder Datei-Karte — damit bekannte Dateien ihre Angaben behalten, auch ohne Beipack
    const kartenMeta = new Map<string, { name: string; mime?: string; groesse?: number }>();
    for (const b of payload.boards) {
      for (const n of b.nodes) {
        const k = anhangKarte(n);   // M371: auch eigene HTML-Tools
        if (k) kartenMeta.set(n.id, { name: k.name, mime: k.mime, groesse: k.size });
      }
    }
    for (const [id, d] of Object.entries(payload.dateien ?? {})) {
      const blob = base64AlsBlob(d.b64, d.mime);
      if (blob.size > maxBytes) continue;
      dateienMeta[id] = { name: d.name, mime: d.mime, groesse: blob.size };
      if (bekannt.has(id)) continue;
      dateienMeta[id].am = Date.now();   // M529: neu oder nachgereicht
      plan.schreiben.push({ name: `${DATEI_PREFIX}${id}`, body: blob, mime: d.mime ?? 'application/octet-stream' });
    }
    // Bekannte Dateien, die diesmal nicht im Beipack sind (Budget oder schon hochgeladen),
    // bleiben erhalten, solange ihre Karte noch existiert
    for (const id of kenn.dateien) {
      if (dateienMeta[id]) continue;
      const meta = kartenMeta.get(id);
      // M524: … mit der Größe, die beim Hochladen galt (Bytes). Die Karte nennt bei Tools die Länge in Zeichen —
      // stand mal die eine, mal die andere Zahl in der Umgebung, hielten die anderen Geräte die Datei für ersetzt
      if (meta) { dateienMeta[id] = kenn.groessen?.[id] ? { ...meta, groesse: kenn.groessen[id] } : meta; continue; }
      plan.loeschen.push(`${DATEI_PREFIX}${id}`);
    }
    // 4) Die Umgebung zuletzt — sie macht den neuen Stand gültig
    const u: Umgebung = {
      app: 'pixinotes', version: 1, savedAt: payload.savedAt, activeId: payload.activeId, spaces: payload.spaces,
      reihe: eigene.map((b) => b.id), boards: stempelNeu, dateien: dateienMeta, basisEtag: kenn.etag,
    };
    const kern = umgebungKern(u);
    // M330: Erst die geteilten Boards in die Zeilen ihrer Besitzer (jedes mit Vorbedingung auf seine Version)
    for (const f of fremdPlan) {
      if (fremdErledigt.has(f.b.id)) continue;
      const v = await fremdSchreiben(f.b.geteiltVon!, f.b.id, f.text, f.st, kenn.fremd?.[f.b.id]?.version ?? null);
      fremdNeu[f.b.id] = { besitzer: f.b.geteiltVon!, version: v, stempel: f.st };
      kenn = { ...kenn, fremd: { ...fremdNeu } };
      await idbSet(KENN_KEY, kenn);
      angewandt = kennMarke(kenn);
    }
    // M383: Ging Eigenes kartenweise hinaus, hat der Server die Stempel dieser Boards schon in die Umgebung
    // gesetzt. Ist sonst nichts anders (Bereiche, Reihe, Dateien, übrige Boards), ist sie damit auf dem Stand.
    if (gepatcht.size > 0) {
      const davor = { ...stempelNeu };
      for (const [id, st] of gepatcht) davor[id] = st;
      if (kernBekannt && kernBekannt === umgebungKern({ ...u, boards: davor })) kenn = { ...kenn, kern };
    }
    if (gepatcht.size > 0 || fremdErledigt.size > 0) { kenn = { ...kenn, fremd: fremdNeu }; await idbSet(KENN_KEY, kenn); }
    // M328: Nichts Eigenes geändert (gleiche Boards, Bereiche, Reihe, Dateien)? Dann die Umgebung nicht schreiben —
    // jeder Schreibvorgang bumpt sonst die Version und lässt andere Geräte unnötig zusammenführen.
    if (kenn.etag && kenn.kern === kern && plan.schreiben.length === 0 && plan.loeschen.length === 0 && kenn.savedAt) {
      angewandt = kennMarke(kenn);
      localStorage.setItem(STAMP_KEY, kenn.savedAt);
      await basisMerken('konto', payload);
      const jetzt = useBoard.getState();
      if (jetzt.spaces === s.spaces && nurAuswahlAnders(s.boards, jetzt.boards)) localStorage.removeItem(KONTO_DIRTY_KEY);
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
    const groessen = Object.fromEntries(Object.entries(dateienMeta).filter(([, m]) => !!m.groesse).map(([id, m]) => [id, m.groesse as number]));
    await idbSet(KENN_KEY, { boards: stempelNeu, dateien: Object.keys(dateienMeta), etag, savedAt: payload.savedAt, kern, fremd: fremdNeu, groessen, ...(Object.keys(aliasBleibt).length ? { alias: aliasBleibt } : {}) } satisfies Kenn);
    angewandt = kennMarke({ etag, fremd: fremdNeu });
    await basenMerken(etag, { boards: payload.boards, spaces: payload.spaces }, angewandt, true);
  } catch (e) {
    if (e instanceof VorbedingungFehler && nochmal) {
      // Ein anderes Gerät hat zwischendurch geschrieben: dessen Stand einarbeiten —
      // das schreibt selbst mit beiden Anteilen, wenn es Eigenes gab
      const r = await kontoLesen();
      if (r && r.payload.savedAt !== kontoStamp()) {
        const erg = await einarbeiten(r.payload);
        if (erg === 'spaeter') throw new SpaeterFehler();
        if (erg === 'konflikt') { emitSyncStatus('konto', 'conflict'); throw new Error(`${kontoLabel()} und lokaler Stand weichen ab, nichts überschrieben. Unter Einstellungen → Daten → Synchronisation wählen.`); }
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
  if (cur.spaces === s.spaces && nurAuswahlAnders(s.boards, cur.boards)) localStorage.removeItem(KONTO_DIRTY_KEY);
  emitSyncStatus('konto', 'ok', payload.savedAt);
  return payload.savedAt;
}

/** Geladenen Stand ohne Zusammenführung übernehmen (Umstieg ohne Basis). */
export function applyKonto(p: SyncPayload): boolean {
  claimWriter();
  useBoard.getState().importSync(p.boards, p.spaces, p.activeId);
  if (!flushPersist()) return false;
  void kennLesen().then((k) => { angewandt = kennMarke(k); return basisIstDrin(k); }).catch(() => {});
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
  schreiben: () => kontoWriteRoh(true, true),
  uebernehmen: applyKonto,
  vereinen: true,
});
class SpaeterFehler extends Error { constructor() { super('Der Nutzer tippt gerade – gleich noch einmal.'); } }

/**
 * M330: Welcher Server-Stand (eTag) ist wirklich im lokalen Stand eingearbeitet?
 * kontoLesen schreibt die Kenntnis (etag) schon beim Lesen fort — auch wenn die
 * Zusammenführung danach mit „später" (der Nutzer tippt) oder „konflikt" endet.
 * Ein eigener Schreibvorgang bestünde dann die Vorbedingung und überführe den
 * fremden Stand mit dem alten lokalen: Karten anderer Geräte gingen verloren
 * (im Wettlauf mit 1 s Tipp-Pause reproduziert). Darum zählt fürs Schreiben
 * nur dieser Wert; weicht die Kenntnis ab, wird erst eingearbeitet.
 *
 * M383: Gemerkt wird die Marke des Stands (kennMarke) — die Version der eigenen Umgebung UND die der geteilten
 * Boards anderer Konten. Vorher zählte nur die eigene Umgebung: Ein Gast, der gerade tippte, las das Board des
 * Besitzers neu, arbeitete es nicht ein und schrieb danach mit bestandener Vorbedingung darüber.
 */
let angewandt: string | null = null;
async function einarbeiten(p: SyncPayload, nebenkopie = false): Promise<EinarbeitenErgebnis> {
  const e = await fremdStandEinarbeiten(p, kontoWeg(), nebenkopie);
  if (e === 'gleich' || e === 'uebernommen' || e === 'zusammengefuehrt' || e === 'geschrieben') {
    const k = await kennLesen();
    angewandt = kennMarke(k);
    await basisIstDrin(k);
  }
  return e;
}

// ---------- Abgleich ----------
let started = false;
let conflictWarned = false;
let lastRemoteCheck = 0;
let staleHintShown = false;

export type VerbindenErgebnis = 'hochgeladen' | 'uebernommen' | 'zusammengefuehrt' | 'gleich' | 'konflikt';
/** Nach der Anmeldung: Was liegt im Konto? Leer → hochladen; fremd → einarbeiten; eigenes UND fremdes ohne Basis → der Nutzer entscheidet. */
export async function kontoVerbinden(): Promise<VerbindenErgebnis> {
  const r = await kontoVerbindenRoh();
  // M360: Eine wartende Einladung (Link vor der Anmeldung geöffnet) kann jetzt angenommen werden
  window.dispatchEvent(new CustomEvent('pixinotes:konto-verbunden'));
  return r;
}
function kontoVerbindenRoh(): Promise<VerbindenErgebnis> {
  return exklusiv(async () => {
    const r = await kontoLesen();
    if (!r) {
      await kontoWriteRoh(true);
      // M330: Ein frisches Konto kann schon Einladungen haben — jetzt, mit eigener Umgebung, holen
      if (loadKonto()?.anbieter === 'supabase') {
        const liste = await freigabenLaden().catch(() => [] as FremdFreigabe[]);
        if (liste.length > 0) {
          const r2 = await kontoLesen();
          if (r2) await einarbeiten(r2.payload);
        }
      }
      return 'hochgeladen';
    }
    const e = await einarbeiten(r.payload);
    if (e === 'konflikt') { emitSyncStatus('konto', 'conflict'); return 'konflikt'; }
    if (e === 'fehler') throw new Error('Der Stand aus dem Konto konnte nicht gespeichert werden (Browser-Speicher voll?).');
    if (e === 'uebernommen') return 'uebernommen';
    if (e === 'zusammengefuehrt' || e === 'geschrieben' || e === 'spaeter') return 'zusammengefuehrt';
    return 'gleich';
  });
}

/** Konto prüfen und einen fremden Stand einarbeiten. */
/** Liefert das Ergebnis der Zusammenführung — `null`, wenn nichts zu tun war oder nicht geprüft wurde. */
/**
 * M524 `nurWennNeu`: Der Aufrufer hat am Mini-Abruf gesehen, dass auf dem Server etwas anderes liegt, als dieses
 * Gerät kennt. Das stimmt oft schon nicht mehr, wenn der Blick an die Reihe kommt: Während des eigenen Schreibens
 * kennt der Server den neuen Stand, das Gerät verbucht ihn erst mit der Antwort — jeder Schreibvorgang zog so ein,
 * zwei volle Lesevorgänge des EIGENEN Stands nach sich, und jeder wartende Blick stellte sich hinten an, auch wenn
 * schon drei davor standen. Auf einem großen Board dauerte das Lesen länger, als neue dazukamen: Das Hochladen kam
 * minutenlang nicht an die Reihe. Darum: höchstens EIN solcher Blick steht an, und er prüft erst, ob es noch etwas
 * zu holen gibt.
 */
let blickWartet: Promise<EinarbeitenErgebnis | null> | null = null;
export async function checkKontoRemote(erzwingen = false, nurWennNeu = false): Promise<EinarbeitenErgebnis | null> {
  const now = Date.now();
  if (!erzwingen && now - lastRemoteCheck < 20_000) return null;
  if (getWriterRole() !== 'writer') return null;
  if (!loadKonto()) return null;
  if (nurWennNeu && blickWartet) return blickWartet;
  lastRemoteCheck = now;
  const blick = exklusiv(async (): Promise<EinarbeitenErgebnis | null> => {
    if (nurWennNeu) {
      blickWartet = null;   // er läuft — ein neuer Wunsch stellt sich wieder an
      const k = await kennLesen();
      const kopf = await laufwerk().kopf(UMGEBUNG);
      // der eigene, inzwischen verbuchte Schreibvorgang (oder längst gelesen und eingearbeitet): nichts zu holen
      if (kopf !== null && kopf === k.etag && kennMarke(k) === angewandt) return null;
    }
    const r = await kontoLesen();
    if (!r) return null;
    // M360: Ein Rollenwechsel (bearbeiten ↔ nur lesen) ändert keinen Inhalt und keinen Zeitstempel — er zählt trotzdem
    if (r.payload.savedAt === kontoStamp() && !rollenAnders(r.payload.boards)) { staleHintShown = false; emitSyncStatus('konto', 'ok', r.payload.savedAt); return 'gleich'; }
    const e = await einarbeiten(r.payload);
    if (e === 'uebernommen') {
      useBoard.getState().showToast(`Neuerer Stand aus ${kontoLabel()} übernommen (${new Date(r.payload.savedAt).toLocaleString('de-DE')}).`);
      staleHintShown = false;
    } else if (e === 'konflikt') {
      emitSyncStatus('konto', 'conflict');
      if (!staleHintShown) {
        staleHintShown = true;
        useBoard.getState().showToast(`${kontoLabel()} und lokaler Stand weichen ab, nichts überschrieben. Unter Einstellungen → Daten → Synchronisation wählen.`);
      }
    } else if (e === 'fehler') {
      emitSyncStatus('konto', 'error');
    } else if (e === 'spaeter') {
      setTimeout(() => { void checkKontoRemote(true, true).catch(() => {}); }, 3000);
    } else {
      staleHintShown = false;
    }
    return e;
  });
  if (nurWennNeu) blickWartet = blick;
  return blick;
}

/** M524: Es läuft immer nur EIN Hochladen; was währenddessen dazukommt, stößt danach genau eines an (statt sich mit
 *  eigenen Lese- und Schreibvorgängen dahinter einzureihen) */
let pushLaeuft = false;
let pushNochmal = false;
async function autoPush(): Promise<void> {
  if (pushLaeuft) { pushNochmal = true; return; }
  pushLaeuft = true;
  try {
    await autoPushEinmal();
  } finally {
    pushLaeuft = false;
    if (pushNochmal) {
      pushNochmal = false;
      if (localStorage.getItem(KONTO_DIRTY_KEY)) setTimeout(() => { void autoPush(); }, 0);
    }
  }
}
async function autoPushEinmal(): Promise<void> {
  if (getWriterRole() !== 'writer') return;
  if (!loadKonto()) return;
  emitSyncStatus('konto', 'pending');
  try {
    const lw = laufwerk();
    const kenn = await kennLesen();
    const kopf = await lw.kopf(UMGEBUNG);
    if (kopf !== null && kopf !== kenn.etag) {
      // Fremder Stand: erst einarbeiten (schreibt selbst mit beiden Anteilen).
      // Konnte er NICHT eingearbeitet werden (der Nutzer tippt gerade, Konflikt, Fehler),
      // darf jetzt nichts geschrieben werden — die Kenntnis trägt schon den fremden
      // Stand, ein Schreiben überführe ihn mit dem alten lokalen (M330: verlor im
      // Wettlauf mit 1 s Tipp-Pause eine Karte). checkKontoRemote holt es später nach.
      const erg = await checkKontoRemote(true, true);
      if (erg === 'spaeter' || erg === 'konflikt' || erg === 'fehler') { setTimeout(() => { void autoPush(); }, 3000); return; }
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
      useBoard.getState().showToast(`${(e as Error).message}`);
    }
  }
}

const TAKT_MS = 10_000;
/** Einmal beim App-Start aufrufen: hält das Konto in beide Richtungen aktuell. */
export function initKontoSync(): void {
  if (started) return;
  started = true;
  // M371: Der Quelltext eines Tools wurde ersetzt — die Fassung im Konto gilt nicht mehr als bekannt, der
  // nächste Abgleich lädt die neue hinauf
  window.addEventListener('pixinotes:anhang-neu', (e) => {
    const id = (e as CustomEvent<string>).detail;
    if (typeof id !== 'string') return;
    void exklusiv(async () => {
      const kenn = await kennLesen();
      if (!kenn.dateien.includes(id)) return;
      // M524: … und merken, dass die Fassung im Konto die ÄLTERE ist — ein Lesen vor dem Hochladen holte sie sonst
      // zurück und überschrieb den eben ersetzten Quelltext
      await idbSet(KENN_KEY, { ...kenn, dateien: kenn.dateien.filter((d) => d !== id), ersetzt: [...new Set([...(kenn.ersetzt ?? []), id])] });
    }).then(() => { try { localStorage.setItem(KONTO_DIRTY_KEY, '1'); } catch { /* voll */ } }).catch(() => {});
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** M524: seit wann eine Änderung auf das Hochladen wartet (0 = keine) */
  let wartetSeit = 0;
  const WARTE_HOECHSTENS = 6000;
  // M328: Rückkehr vom E-Mail-Link — die Sitzung hängt an der Adresse
  try {
    const rkLink = sbRueckkehrLesen();
    // M479: Rückkehr von „Mit Google anmelden" (PKCE: ?code=…, nur wenn dieses Gerät die Anmeldung begonnen hat)
    const rkCode = rkLink ? null : sbRueckkehrCode();
    if (rkLink || rkCode) {
      // M388: Ein Link, den dieses Gerät nicht angefordert hat oder der eine andere Anmeldung ersetzt: erst fragen.
      // Ein Code lässt sich nur mit dem hier gemerkten Verifier tauschen — er ist immer selbst angefordert.
      const erwartet = sbLinkWarErwartet() || !!rkCode;
      const bisher = loadKonto();
      let rk = rkLink as SbSitzung;
      void (async () => {
        if (rkCode) rk = await sbCodeTauschen(rkCode.code, rkCode.verifier);
        if (erwartet && (!bisher || bisher.userId === rk.userId)) return true;
        const wer = (await sbNutzer(rk.token))?.email ?? '…';
        return window.confirm(`Mit dem PixiNotes-Konto ${wer} anmelden?\n\nDieser Anmelde-Link wurde nicht auf diesem Gerät angefordert${bisher ? ' – und hier ist schon ein Konto angemeldet' : ''}. Nach dem Anmelden gleichen sich die Boards dieses Geräts mit diesem Konto ab. Bestätige nur, wenn es dein eigenes Konto ist.`);
      })().then((ja) => {
        if (!ja) { useBoard.getState().showToast('Nicht angemeldet – der Link wurde verworfen.', false, 6000); return undefined; }
        return kontoAnmeldenSupabase(rk).then(async (s) => {
        const r = await kontoVerbinden();
        const wo = s.name ? `als „${s.name}"` : 'mit dem PixiNotes-Konto';
        useBoard.getState().showToast(r === 'konflikt'
          ? `Angemeldet ${wo}. Im Konto liegt schon ein Stand und hier Eigenes – unter Einstellungen → Daten → Synchronisation wählen.`
          : `Angemeldet ${wo} – Änderungen gleichen sich ab jetzt automatisch ab.`, false, 7000);
        window.dispatchEvent(new CustomEvent('pixinotes:konto'));
        });
      }).catch((e) => useBoard.getState().showToast(`${(e as Error).message}`, false, 8000));
    }
  } catch (e) {
    useBoard.getState().showToast(`${(e as Error).message}`, false, 8000);
  }
  useBoard.subscribe((s, prev) => {
    if (s.spaces === prev.spaces && nurAuswahlAnders(prev.boards, s.boards)) return;   // M345: Auswählen ist keine Änderung
    if (isImportedState(s.boards, s.spaces)) return;
    if (getWriterRole() !== 'writer') return;
    if (!inDerived()) {
      notiereAenderung();
      try { merkeUngesichert(KONTO_DIRTY_KEY); } catch { /* voll */ }
    }
    if (!loadKonto()) return;
    // M524: Abgeleitetes (erkannter Text eines Bilds, gemessene Kartenhöhe, eingesammelte Tickets) entsteht auf
    // jedem Gerät von selbst — auch auf einem, das nur offen steht. Es löst allein kein Hochladen mehr aus: Ein
    // ruhendes Gerät schrieb sonst ganze Karten (mit seiner vielleicht älteren Lage) ins Konto und stieß bei allen
    // anderen einen Abgleich an. Es reist mit der nächsten echten Änderung dieses Geräts.
    if (inDerived() && !localStorage.getItem(KONTO_DIRTY_KEY)) return;
    clearTimeout(timer);
    // M330: Mit Live-Verbindung reicht eine Sekunde Tipp-Pause — die anderen Geräte warten.
    // M524: … aber nicht endlos: Wer ohne Pause weiterarbeitet (ziehen, tippen, ziehen), lud sonst gar nichts hoch,
    // solange er arbeitete. Spätestens WARTE_HOECHSTENS nach der ersten ungesicherten Änderung geht der Stand hinaus.
    const jetzt = Date.now();
    if (!wartetSeit) wartetSeit = jetzt;
    const pause = kontoLiveVerbunden() ? 1000 : 2500;
    // Nur beim PixiNotes-Konto: Dort reist je Änderung die Karte. Google Drive und OneDrive laden das ganze Board —
    // alle sechs Sekunden wäre das zu viel Verkehr; dort bleibt es bei „nach der Pause".
    const rest = kontoIstEigenes() ? wartetSeit + WARTE_HOECHSTENS - jetzt : pause;
    timer = setTimeout(() => { wartetSeit = 0; void autoPush(); }, Math.max(0, Math.min(pause, rest)));
  });
  // M388: Das Netz ist wieder da → Ungesichertes gleich hochladen (vorher erst mit der nächsten Änderung)
  window.addEventListener('online', () => { if (loadKonto() && localStorage.getItem(KONTO_DIRTY_KEY)) void autoPush(); });
  if (loadKonto()) {
    realtimeStarten();
    void checkKontoRemote(true).then(() => {
      if (localStorage.getItem(KONTO_DIRTY_KEY)) void autoPush();
    }).catch(() => {});
    // M529: Was dieses Gerät hat und im Konto fehlt, nachreichen — nach dem Start, wenn Ruhe ist
    setTimeout(() => { void dateienNachreichen().catch(() => {}); }, 20_000);
  }
  // M529: Inhalte, die nach ihren Karten ankommen (Import einer Board-Datei, Kopie), gehen gleich hinaus — nicht erst
  // mit der nächsten Änderung dieses Geräts (gab es keine, kamen sie nie ins Konto)
  let nachTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('pixinotes:dateien-da', () => {
    if (loadKonto()?.anbieter !== 'supabase') return;
    clearTimeout(nachTimer);
    nachTimer = setTimeout(() => { void dateienNachreichen(false, true).catch(() => {}); }, 3000);
  });
  // Takt: nur der Mini-Abruf (eTag / Version); erst eine Änderung lädt
  let takt = 0;
  setInterval(() => {
    void (async () => {
      if (document.visibilityState !== 'visible' || getWriterRole() !== 'writer' || !loadKonto() || anmeldungNoetig) return;
      takt += 1;
      if (takt % 30 === 0) void dateienNachreichen().catch(() => {});   // M529: höchstens alle 6 h (zählt selbst)
      const kenn = await kennLesen();
      // M330: Alle 60 s die Freigaben prüfen — neue Einladungen oder fremde Änderungen ohne Realtime
      if (loadKonto()?.anbieter === 'supabase' && takt % 6 === 0) {
        const liste = await freigabenLaden().catch(() => null);
        if (liste) {
          const bekannt = Object.keys(kenn.fremd ?? {}).sort().join(',');
          const jetzt = liste.map((f) => f.board_id).sort().join(',');
          let fremdNeu = bekannt !== jetzt || rollenAnders(liste.map((f) => ({ id: f.board_id, geteiltVon: f.besitzer, geteiltRolle: f.rolle === 'lesen' ? 'lesen' as const : undefined })));
          if (!fremdNeu) {
            for (const f of liste) {
              const z = await fremdZeile(f.besitzer, f.board_id).catch(() => null);
              if (z && String(z.version) !== kenn.fremd?.[f.board_id]?.version) { fremdNeu = true; break; }
            }
          }
          if (fremdNeu) { await checkKontoRemote(true); return; }
        }
      }
      const kopf = await laufwerk().kopf(UMGEBUNG);
      if (kopf === null || kopf === kenn.etag) return;
      await checkKontoRemote(true, true);
    })().catch(() => {});
  }, TAKT_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkKontoRemote().catch(() => {});
    else if (loadKonto() && localStorage.getItem(KONTO_DIRTY_KEY)) { clearTimeout(timer); wartetSeit = 0; void autoPush(); }
  });
}
