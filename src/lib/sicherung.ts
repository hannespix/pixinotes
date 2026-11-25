// M476: Einfache Sicherung — ein Board oder alles als EINE Datei (.pixinotes), wieder einspielbar.
//
// Vorher gab es zwei Dateien mit fast demselben Inhalt: die Board-Datei (`.pixiboard.json`, Board-⋯ → „Als Datei
// sichern") und den kompletten Stand (`pixinotes-daten-….json`, Einstellungen → Daten). Beide trugen Anhänge als
// Base64 in einer JSON-Datei, und „Laden" ersetzte ohne Vorschau alles. Jetzt:
//
//   · EIN Format für beides: ein ZIP mit `pixinotes.json` (Boards, Bereiche, Vorlagen, Einstellungen) und den
//     Inhalten als echten Binärdaten (`anhaenge/…`: große Dateien, PDFs, Quelltexte eigener Tools; `bilder/…`:
//     eingebettete Bilder, im JSON nur noch als Verweis). Die alten JSON-Dateien werden weiter gelesen.
//   · Vor dem Einspielen eine Vorschau (components/SicherungDialog.tsx): „als Kopie hinzufügen" (Standard,
//     frische Kennungen, nichts geht verloren) oder „vorhandene ersetzen" (vorher je Board eine Version, M449).
//     Ein Rückgängig-Schritt nimmt das Einspielen als Ganzes zurück.
//   · Geheimes bleibt draußen: KI-Schlüssel, Zugangsdaten (Sync, WebDAV, Konto, Kalender) und Einladungs-Token
//     liegen nicht im Board-Stand und werden nicht mitgenommen; Boards anderer (geteilt mit mir) auch nicht.
//   · Alles von außen läuft durch lib/sicher.ts (Gestalt, Adressen, Zeiten).
//
// Diese Datei wird nur nachgeladen (Board-⋯, Einstellungen, Strg+K, Ablegen einer Datei, Auto-Sicherung).
import { claimWriter, flushPersist, useBoard, hinweisMitKnopf, type BoardDoc, type CardTemplate, type Space } from '../store';
import { uid, type AppNode, type KanbanData } from '../types';
import { boardVonAussen, karteEntschaerfen, karteGueltig } from './sicher';
import './sicherGestalt';   // M522: hängt die Gestalt-Prüfung in lib/sicher.ts ein
import { idbDel, idbGet, idbKeys, idbSet, KONTO_DIRTY_KEY, SYNC_DIRTY_KEY, WEBDAV_DIRTY_KEY, type SyncDatei, type SyncDirHandle } from './syncFolder';
import { zumWeitergeben } from './share';
import { EINGANG_ID, istEingang } from './eingangId';
import { versionSichern } from './boardVersionen';
import { VORLIEBEN_FELDER, vorliebenAuszug } from './einstellungen';
import { ZipArchive } from './unzip';
import { zipBauen, type ZipEintrag } from './zip';
import { triggerDownload } from './download';
import { t, zahlWort } from './sprache';
import {
  AUTO_KEY, AUTO_LETZTE_KEY, ERINNERT_KEY, ERINNERUNG_TAGE, LETZTE_SICHERUNG_KEY, SICHERUNG_SEIT_KEY, TAG_MS, letzteSicherung,
} from './sicherungTakt';

export const SICHERUNG_ENDUNG = '.pixinotes';
const MANIFEST = 'pixinotes.json';
/** Verweis auf ein ausgelagertes Bild im JSON (nur Pfade aus der Bilderliste werden aufgelöst) */
const MARKE = 'pixinotes-zip:';
/** Was im Gerätespeicher zu einer Karte gehört (wie lib/anhangKopie.ts) */
const VORSILBEN = ['file:', 'happ:', 'happ-state:', 'happ-state-at:'] as const;
type Vorsilbe = (typeof VORSILBEN)[number];
/** Ausgelagert werden eingebettete Inhalte ab dieser Länge (kleine Symbole bleiben, wo sie sind) */
const BILD_AB = 2048;
/** Grenzen gegen manipulierte Dateien */
const MAX_BOARDS = 5000;
const MAX_ANHAENGE = 20000;
/** Automatische Sicherungen im Ordner: so viele bleiben liegen */
export const AUTO_BEHALTEN = 7;
const AUTO_MUSTER = /^PixiNotes-Alles-\d{4}-\d{2}-\d{2}\.pixinotes$/;
const ORDNER_IDB = 'sicherung:ordner';

/** Was eine Sicherung bewusst NICHT enthält — steht in der Datei und in der Vorschau */
export const OHNE = [
  'KI-Schlüssel und Zugangsdaten (Sync, WebDAV, Konto, Kalender)',
  'Boards, die andere mit dir geteilt haben',
  'Versionen (liegen je Gerät)',
];

export type SicherungArt = 'board' | 'alles';
export interface Anhang { id: string; vorsilbe: Vorsilbe; wert: unknown }
export interface Sicherung {
  art: SicherungArt;
  savedAt: string;
  boards: BoardDoc[];
  spaces: Space[];
  activeId?: string;
  templates: CardTemplate[];
  einstellungen?: Record<string, unknown>;
  anhaenge: Anhang[];
  /** Zahl der ausgelagerten Bilder (nur zur Anzeige) */
  bilder: number;
  /** Alte JSON-Datei (vor M476) statt .pixinotes */
  alt: boolean;
  /** Was beim Prüfen weggefallen ist (ungültige Boards, Karten, Einträge) */
  entschaerft: number;
}

// ---------------------------------------------------------------- Hilfen

const heute = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const datumDe = (iso: string): string => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('de-DE') : '?';
};
const dateiName = (name: string): string =>
  name.replace(/[^\p{L}\d\-_ ]/gu, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'Board';
const kennung = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

function bytesAusB64(b64: string): Uint8Array {
  const roh = atob(b64);
  const out = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) out[i] = roh.charCodeAt(i);
  return out;
}
function b64AusBytes(b: Uint8Array): string {
  let roh = '';
  for (let i = 0; i < b.length; i += 0x8000) roh += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(roh);
}

/** Alle Karten, deren Gerätespeicher-Inhalte mitreisen */
const alleKarten = (boards: BoardDoc[], templates: CardTemplate[]): AppNode[] =>
  [...boards.flatMap((b) => b.nodes), ...templates.map((t0) => t0.node)];

// ---------------------------------------------------------------- Schreiben

async function anhaengeSammeln(nodes: AppNode[]): Promise<Anhang[]> {
  const da = new Set((await idbKeys().catch(() => [] as IDBValidKey[])).map(String));
  const out: Anhang[] = [];
  const gesehen = new Set<string>();
  for (const n of nodes) {
    if (gesehen.has(n.id)) continue;
    gesehen.add(n.id);
    for (const v of VORSILBEN) {
      if (!da.has(`${v}${n.id}`)) continue;
      try {
        const wert = await idbGet<unknown>(`${v}${n.id}`);
        if (wert !== undefined && wert !== null) out.push({ id: n.id, vorsilbe: v, wert });
      } catch { /* eine unlesbare Datei hält die Sicherung nicht auf */ }
    }
  }
  return out;
}

async function alsEintrag(w: unknown): Promise<{ daten: Uint8Array; typ: 'blob' | 'text' | 'json'; mime?: string }> {
  if (w instanceof Blob) return { daten: new Uint8Array(await w.arrayBuffer()), typ: 'blob', ...(w.type ? { mime: w.type } : {}) };
  if (w instanceof ArrayBuffer) return { daten: new Uint8Array(w), typ: 'blob' };
  if (ArrayBuffer.isView(w)) return { daten: new Uint8Array(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength) as ArrayBuffer), typ: 'blob' };
  if (typeof w === 'string') return { daten: new TextEncoder().encode(w), typ: 'text' };
  return { daten: new TextEncoder().encode(JSON.stringify(w)), typ: 'json' };
}

/**
 * Eingebettete Inhalte (data:…;base64) aus dem JSON herauslösen: Sie gehen als Binärdatei ins ZIP, im JSON steht
 * nur „pixinotes-zip:bilder/3". Gleiche Inhalte (kopierte Bilder) liegen nur einmal in der Datei.
 */
function bilderAuslagern<T>(wert: T, eintraege: ZipEintrag[], liste: Array<{ pfad: string; kopf: string }>): T {
  const schon = new Map<string, string>();
  return JSON.parse(JSON.stringify(wert), (_k, v: unknown) => {
    if (typeof v !== 'string' || v.length < BILD_AB || !v.startsWith('data:')) return v;
    const komma = v.indexOf(',');
    if (komma < 0 || komma > 300) return v;
    const kopf = v.slice(0, komma);
    if (!/;base64$/i.test(kopf)) return v;
    const vorhanden = schon.get(v);
    if (vorhanden) return MARKE + vorhanden;
    let daten: Uint8Array;
    try { daten = bytesAusB64(v.slice(komma + 1)); } catch { return v; }
    const pfad = `bilder/${liste.length}`;
    liste.push({ pfad, kopf });
    eintraege.push({ name: pfad, daten });
    schon.set(v, pfad);
    return MARKE + pfad;
  }) as T;
}

export interface Gebaut { blob: Blob; name: string; karten: number; dateien: number; boards: number }

/** Die Sicherungsdatei bauen — ein Board (mit allem, was dazugehört) oder alles */
export async function sicherungBauen(art: SicherungArt, boardId?: string | BoardDoc): Promise<Gebaut | null> {
  const st = useBoard.getState();
  let boards: BoardDoc[];
  let spaces: Space[] = [];
  let name: string;
  if (art === 'board') {
    // Ein Board aus dem Stand oder ein eigens zusammengestelltes (Karten teilen, lib/shareCards.ts)
    const b = typeof boardId === 'object' ? boardId : st.boards.find((x) => x.id === boardId);
    if (!b) return null;
    // M388: Was ein Board zum GETEILTEN macht (Token, Besitzer), reist nicht mit
    boards = [zumWeitergeben(b)];
    name = `PixiNotes-${dateiName(b.name)}-${heute()}${SICHERUNG_ENDUNG}`;
  } else {
    // Boards anderer gehören nicht in meine Sicherung — sie liegen beim Besitzer (und tragen dessen Zugang)
    boards = st.boards.filter((b) => !b.geteiltVon && !b.gastLink).map(zumWeitergeben);
    const drin = new Set(boards.map((b) => b.id));
    spaces = st.spaces.filter((sp) => sp.id !== 'geteilt').map((sp) => ({
      ...sp, projects: sp.projects.map((p) => ({ ...p, boardIds: p.boardIds.filter((id) => drin.has(id)) })),
    }));
    name = `PixiNotes-Alles-${heute()}${SICHERUNG_ENDUNG}`;
  }
  const templates = st.templates;
  const roh = await anhaengeSammeln(alleKarten(boards, templates));
  const eintraege: ZipEintrag[] = [];
  const anhaenge: Array<{ id: string; vorsilbe: Vorsilbe; pfad: string; typ: string; mime?: string }> = [];
  for (const a of roh) {
    const e = await alsEintrag(a.wert);
    const pfad = `anhaenge/${anhaenge.length}`;
    eintraege.push({ name: pfad, daten: e.daten });
    anhaenge.push({ id: a.id, vorsilbe: a.vorsilbe, pfad, typ: e.typ, ...(e.mime ? { mime: e.mime } : {}) });
  }
  const bilder: Array<{ pfad: string; kopf: string }> = [];
  const inhalt = bilderAuslagern({ boards, spaces, templates }, eintraege, bilder);
  const manifest = {
    app: 'pixinotes-sicherung', version: 1, art, savedAt: new Date().toISOString(),
    boards: inhalt.boards, spaces: inhalt.spaces,
    ...(art === 'alles' ? { activeId: st.activeId, einstellungen: vorliebenAuszug() } : {}),
    templates: inhalt.templates,
    anhaenge, bilder, ohne: OHNE,
  };
  const blob = zipBauen([{ name: MANIFEST, daten: new TextEncoder().encode(JSON.stringify(manifest)) }, ...eintraege]);
  return {
    blob, name, boards: boards.filter((b) => !istEingang(b)).length,   // M478: der Eingang zählt nicht als Board
    karten: boards.reduce((s, b) => s + b.nodes.length, 0),
    dateien: new Set(roh.map((a) => a.id)).size + bilder.length,
  };
}

function herunterladen(g: Gebaut): void {
  const url = URL.createObjectURL(g.blob);
  triggerDownload(url, g.name);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const inhaltText = (g: Gebaut): string =>
  `${zahlWort(g.karten, 'Karte', 'Karten')}${g.dateien ? `, ${zahlWort(g.dateien, 'Datei', 'Dateien')}` : ''}`;

/** Board-⋯ → „Sicherung herunterladen" */
export async function boardSichern(board: string | BoardDoc, still = false): Promise<boolean> {
  const g = await sicherungBauen('board', board);
  if (!g) return false;
  herunterladen(g);
  if (!still) useBoard.getState().showToast(t(`Sicherung heruntergeladen: ${inhaltText(g)}.`), false, 5000);
  return true;
}

const merkeSicherung = (): void => {
  try { localStorage.setItem(LETZTE_SICHERUNG_KEY, new Date().toISOString()); } catch { /* ohne Speicher keine Erinnerung */ }
};

/** Einstellungen → Daten „Alles sichern" (und Strg+K, und der Knopf in der Erinnerung) */
export async function allesSichern(): Promise<boolean> {
  const g = await sicherungBauen('alles');
  if (!g) return false;
  herunterladen(g);
  merkeSicherung();
  useBoard.getState().showToast(t(`Alles gesichert: ${zahlWort(g.boards, 'Board', 'Boards')}, ${inhaltText(g)}. KI-Schlüssel und Zugangsdaten sind nicht enthalten.`), false, 7000);
  window.dispatchEvent(new CustomEvent('pixinotes:sicherung-stand'));
  return true;
}

// ---------------------------------------------------------------- Lesen

const ERLAUBT_MIME = /^[\w.+-]+\/[\w.+-]+$/;

/** Die Vorlieben aus einer Datei: nur bekannte Felder, nur schlichte Werte */
function vorliebenVonAussen(roh: unknown): Record<string, unknown> | undefined {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return undefined;
  const schlicht = (v: unknown): boolean => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  const out: Record<string, unknown> = {};
  for (const f of VORLIEBEN_FELDER) {
    const v = (roh as Record<string, unknown>)[f];
    if (v === undefined) continue;
    if (typeof v === 'string' && v.length > 200) continue;
    if (schlicht(v) || (typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every(schlicht))) out[f] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Inhalt einer Datei prüfen und in die gemeinsame Gestalt bringen (alles läuft durch lib/sicher.ts) */
function normalisieren(roh: Record<string, unknown>, art: SicherungArt, anhaenge: Anhang[], bilder: number, alt: boolean): Sicherung | null {
  let weg = 0;
  const gesehen = new Set<string>();
  const boards: BoardDoc[] = [];
  for (const b of (Array.isArray(roh.boards) ? roh.boards : []).slice(0, MAX_BOARDS)) {
    const id = kennung((b as { id?: unknown })?.id) ? (b as { id: string }).id : uid();
    if (gesehen.has(id)) { weg += 1; continue; }
    const sauber = boardVonAussen(b, id);
    if (!sauber) { weg += 1; continue; }
    weg += Math.max(0, ((b as { nodes?: unknown[] }).nodes?.length ?? 0) - sauber.nodes.length);
    // Was ein Board zum geteilten macht, nimmt eine Datei nie mit (ein Token in einer fremden Datei wäre ein Zugang)
    boards.push(zumWeitergeben(sauber));
    gesehen.add(id);
  }
  if (!boards.length) return null;
  if (art === 'board') boards.splice(1);
  const ids = new Set(boards.map((b) => b.id));
  const vergeben = new Set<string>();
  const spaces: Space[] = art === 'board' ? [] : (Array.isArray(roh.spaces) ? roh.spaces : []).flatMap((sp0) => {
    const sp = sp0 as Partial<Space>;
    if (!sp || !kennung(sp.id) || sp.id === 'geteilt') { weg += 1; return []; }
    const projects = (Array.isArray(sp.projects) ? sp.projects : []).flatMap((p0) => {
      const p = p0 as Partial<Space['projects'][number]>;
      if (!p || !kennung(p.id)) { weg += 1; return []; }
      const boardIds = (Array.isArray(p.boardIds) ? p.boardIds : []).filter((x): x is string => typeof x === 'string' && ids.has(x) && !vergeben.has(x));
      boardIds.forEach((x) => vergeben.add(x));
      return [{
        id: p.id, name: typeof p.name === 'string' ? p.name.slice(0, 200) : 'Projekt', boardIds,
        ...(typeof p.sortierung === 'string' ? { sortierung: p.sortierung } : {}),
      } as Space['projects'][number]];
    });
    return [{ id: sp.id, name: typeof sp.name === 'string' ? sp.name.slice(0, 200) : 'Bereich', projects }];
  });
  const templates: CardTemplate[] = (Array.isArray(roh.templates) ? roh.templates : []).flatMap((v0) => {
    const v = v0 as Partial<CardTemplate>;
    if (!v || !kennung(v.id) || !karteGueltig(v.node)) { weg += 1; return []; }
    return [{ id: v.id, name: typeof v.name === 'string' ? v.name.slice(0, 200) : 'Vorlage', node: karteEntschaerfen(v.node) }];
  });
  // Nur Inhalte zu Karten, die mitkommen — eine Datei darf keine fremden Einträge im Gerätespeicher setzen
  const karten = new Map(alleKarten(boards, templates).map((n) => [n.id, n]));
  const gute = anhaenge.filter((a) => karten.has(a.id));
  weg += anhaenge.length - gute.length;
  return {
    art,
    savedAt: typeof roh.savedAt === 'string' && Number.isFinite(Date.parse(roh.savedAt)) ? roh.savedAt : new Date().toISOString(),
    boards, spaces,
    activeId: typeof roh.activeId === 'string' && ids.has(roh.activeId) ? roh.activeId : boards[0].id,
    templates,
    einstellungen: art === 'alles' ? vorliebenVonAussen(roh.einstellungen) : undefined,
    anhaenge: gute, bilder, alt, entschaerft: weg,
  };
}

/** Alte Dateien (vor M476): Inhalte als Base64 unter `dateien` je Karten-Kennung */
function alteDateien(dateien: unknown, karten: AppNode[]): Anhang[] {
  if (!dateien || typeof dateien !== 'object') return [];
  const typ = new Map(karten.map((n) => [n.id, n.type]));
  const out: Anhang[] = [];
  for (const [id, d0] of Object.entries(dateien as Record<string, SyncDatei>).slice(0, MAX_ANHAENGE)) {
    if (!kennung(id) || !d0 || typeof d0.b64 !== 'string') continue;
    try {
      const daten = bytesAusB64(d0.b64);
      if (typ.get(id) === 'htmlapp') out.push({ id, vorsilbe: 'happ:', wert: new TextDecoder().decode(daten) });
      else out.push({ id, vorsilbe: 'file:', wert: new Blob([daten as BlobPart], typeof d0.mime === 'string' && ERLAUBT_MIME.test(d0.mime) ? { type: d0.mime } : undefined) });
    } catch { /* kaputter Eintrag */ }
  }
  return out;
}

/** Eine Sicherungsdatei lesen (.pixinotes oder eine alte .json) — null, wenn es keine ist */
export async function sicherungLesen(datei: Blob): Promise<Sicherung | null> {
  const buf = await datei.arrayBuffer();
  const kopf = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (kopf[0] === 0x50 && kopf[1] === 0x4b) {
    let zip: ZipArchive;
    try { zip = await ZipArchive.open(buf); } catch { return null; }
    const text = await zip.text(MANIFEST).catch(() => null);
    if (!text) return null;
    let m: Record<string, unknown>;
    try { m = JSON.parse(text); } catch { return null; }
    if (m?.app !== 'pixinotes-sicherung' || (m.art !== 'board' && m.art !== 'alles')) return null;
    // Bilder: nur gelistete Pfade, nur gültige Köpfe
    const bilder = new Map<string, string>();
    for (const b of (Array.isArray(m.bilder) ? m.bilder : []).slice(0, MAX_ANHAENGE)) {
      const { pfad, kopf: k } = (b ?? {}) as { pfad?: unknown; kopf?: unknown };
      if (typeof pfad !== 'string' || !/^bilder\/\d+$/.test(pfad)) continue;
      if (typeof k !== 'string' || k.length > 300 || !/^data:[\w.+\-/]*(;[\w.+\-=]*)*;base64$/i.test(k)) continue;
      const daten = await zip.bytes(pfad).catch(() => null);
      if (daten) bilder.set(MARKE + pfad, `${k},${b64AusBytes(daten)}`);
    }
    let roh: Record<string, unknown>;
    try { roh = JSON.parse(text, (_k, v: unknown) => (typeof v === 'string' && v.startsWith(MARKE) ? (bilder.get(v) ?? '') : v)); } catch { return null; }
    const anhaenge: Anhang[] = [];
    for (const a of (Array.isArray(m.anhaenge) ? m.anhaenge : []).slice(0, MAX_ANHAENGE)) {
      const { id, vorsilbe, pfad, typ, mime } = (a ?? {}) as Record<string, unknown>;
      if (!kennung(id) || !VORSILBEN.includes(vorsilbe as Vorsilbe) || typeof pfad !== 'string' || !/^anhaenge\/\d+$/.test(pfad)) continue;
      const daten = await zip.bytes(pfad).catch(() => null);
      if (!daten) continue;
      let wert: unknown;
      if (typ === 'text') wert = new TextDecoder().decode(daten);
      else if (typ === 'json') { try { wert = JSON.parse(new TextDecoder().decode(daten)); } catch { continue; } }
      else wert = new Blob([daten as BlobPart], typeof mime === 'string' && ERLAUBT_MIME.test(mime) ? { type: mime } : undefined);
      // Ein Tool-Quelltext ist immer Text — alles andere wäre ein untergeschobener Inhalt
      if (vorsilbe === 'happ:' && typeof wert !== 'string') continue;
      anhaenge.push({ id, vorsilbe: vorsilbe as Vorsilbe, wert });
    }
    return normalisieren(roh, m.art, anhaenge, bilder.size, false);
  }
  // Alte JSON-Dateien
  let p: Record<string, unknown>;
  try { p = JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
  if (p?.app === 'pixinotes-board' && p.board && typeof p.board === 'object') {
    const board = p.board as BoardDoc;
    return normalisieren({ boards: [board], savedAt: p.savedAt }, 'board', alteDateien(p.dateien, Array.isArray(board.nodes) ? board.nodes : []), 0, true);
  }
  if (p?.app === 'pixinotes' && Array.isArray(p.boards) && p.boards.length) {
    const karten = (p.boards as BoardDoc[]).flatMap((b) => (Array.isArray(b?.nodes) ? b.nodes : []));
    return normalisieren(p, 'alles', alteDateien(p.dateien, karten), 0, true);
  }
  return null;
}

/** Ist das (dem Namen nach) eine Sicherung? Für das Ablegen von Dateien */
export const istSicherungsName = (name: string): boolean => name.toLowerCase().endsWith(SICHERUNG_ENDUNG);

// ---------------------------------------------------------------- Vorschau

export interface SicherungUeberblick {
  boards: number; karten: number; dateien: number; vorlagen: number; bereiche: number;
  /** Boards, die es hier unter derselben Kennung schon gibt (würden beim Ersetzen überschrieben) */
  schonDa: number;
  datum: string;
}
export function ueberblick(s: Sicherung): SicherungUeberblick {
  const hier = new Set(useBoard.getState().boards.map((b) => b.id));
  return {
    boards: s.boards.filter((b) => !istEingang(b)).length,
    karten: s.boards.reduce((n, b) => n + b.nodes.length, 0),
    dateien: new Set(s.anhaenge.map((a) => a.id)).size + s.bilder,
    vorlagen: s.templates.length,
    bereiche: s.spaces.length,
    schonDa: s.boards.filter((b) => hier.has(b.id)).length,
    datum: new Date(s.savedAt).toLocaleString('de-DE'),
  };
}

// ---------------------------------------------------------------- Einspielen

interface Rueck {
  boards: BoardDoc[]; spaces: Space[]; activeId: string; templates: CardTemplate[];
  /** Gerätespeicher: Schlüssel → Wert davor (undefined = gab es nicht) */
  speicher: Map<string, unknown>;
  vorlieben?: Record<string, unknown>;
}
let rueck: Rueck | null = null;

/** Board kopieren: frische Kennungen, Verweise innerhalb der Sicherung ziehen mit */
function kopiereBoard(b: BoardDoc, boardMap: Map<string, string>, karte: Map<string, string>): BoardDoc {
  const neuBoard = (x: string | undefined) => (x && boardMap.get(x)) || x;
  const neuKarte = (x: string | undefined) => (x && karte.get(x)) || x;
  const nodes = b.nodes.map((n) => {
    const k = { ...JSON.parse(JSON.stringify(n)), id: karte.get(n.id) as string, selected: false } as AppNode;
    if (n.parentId && karte.has(n.parentId)) (k as { parentId?: string }).parentId = karte.get(n.parentId);
    const d = k.data as Record<string, unknown>;
    if (k.type === 'portal' && typeof d.boardId === 'string') d.boardId = neuBoard(d.boardId);
    if (k.type === 'kanban') {
      const umb = (list: KanbanData['items'] | undefined) => (list ?? []).map((it) => ({
        ...it,
        ...(it.link ? { link: { ...it.link, boardId: neuBoard(it.link.boardId) as string, ...(it.link.nodeId ? { nodeId: neuKarte(it.link.nodeId) } : {}) } } : {}),
        ...(it.links ? { links: it.links.map((l) => ({ boardId: neuBoard(l.boardId) as string, nodeId: neuKarte(l.nodeId) as string })) } : {}),
      }));
      const kd = d as unknown as KanbanData;
      k.data = { ...kd, items: umb(kd.items), ...(kd.archiv ? { archiv: umb(kd.archiv) } : {}) } as never;
    }
    return k;
  });
  const edges = (b.edges ?? []).filter((e) => karte.has(e.source) && karte.has(e.target))
    .map((e) => ({ ...e, id: `e-${uid()}`, source: karte.get(e.source) as string, target: karte.get(e.target) as string, selected: false }));
  const drawings = (b.drawings ?? []).flatMap((s) => (!s.anchor ? [{ ...s, id: uid() }] : karte.has(s.anchor) ? [{ ...s, id: uid(), anchor: karte.get(s.anchor) }] : []));
  const comments = (b.comments ?? []).flatMap((c) => (!c.nodeId ? [{ ...c, id: uid() }] : karte.has(c.nodeId) ? [{ ...c, id: uid(), nodeId: karte.get(c.nodeId) as string }] : []));
  return { ...b, id: boardMap.get(b.id) as string, nodes, edges, drawings, ...(comments.length ? { comments } : { comments: [] }) };
}

async function speicherSchreiben(eintraege: Array<[string, unknown]>, merk: Map<string, unknown>): Promise<number> {
  let n = 0;
  for (const [k, w] of eintraege) {
    try {
      if (!merk.has(k)) merk.set(k, await idbGet<unknown>(k));
      await idbSet(k, w);
      n += 1;
    } catch { /* Platte voll — der Rest zählt trotzdem */ }
  }
  if (n) window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
  return n;
}

const vorlagenMischen = (hier: CardTemplate[], neu: CardTemplate[], ersetzen: boolean): CardTemplate[] => {
  const da = new Map(hier.map((v) => [v.id, v]));
  for (const v of neu) if (ersetzen || !da.has(v.id)) da.set(v.id, v);
  return [...da.values()];
};

const dirtyMerken = () => {
  // Der eingespielte Stand liegt in keinem Sync-Ziel → kein Fast-Forward darüber, beim nächsten Abgleich hochladen
  try { for (const k of [SYNC_DIRTY_KEY, WEBDAV_DIRTY_KEY, KONTO_DIRTY_KEY]) localStorage.setItem(k, '1'); } catch { /* unkritisch */ }
};

export type Modus = 'kopie' | 'ersetzen';

/**
 * Die Sicherung einspielen. „kopie": alles mit frischen Kennungen dazu, nichts Vorhandenes ändert sich.
 * „ersetzen": Boards mit gleicher Kennung bekommen den Stand aus der Datei (vorher je Board eine Version, M449),
 * Boards, die nur hier liegen, bleiben. Gibt den Hinweistext zurück.
 */
export async function sicherungEinspielen(s: Sicherung, modus: Modus): Promise<string> {
  claimWriter();
  const st = useBoard.getState();
  const vorher: Rueck = { boards: st.boards, spaces: st.spaces, activeId: st.activeId, templates: st.templates, speicher: new Map() };
  const datum = datumDe(s.savedAt);
  let meldung: string;

  if (modus === 'kopie') {
    const boardMap = new Map(s.boards.map((b) => [b.id, uid()]));
    const karte = new Map(s.boards.flatMap((b) => b.nodes.map((n) => [n.id, uid()] as [string, string])));
    const namen = new Set(st.boards.map((b) => b.name));
    // M478: Der Eingang ist kein Board zum Danebenlegen — seine Einträge kommen (mit frischen Kennungen) in den eigenen
    const eingangDatei = s.boards.find(istEingang);
    const boards = s.boards.filter((b) => !istEingang(b)).map((b) => {
      const k = kopiereBoard(b, boardMap, karte);
      return namen.has(k.name) ? { ...k, name: `${k.name} (Sicherung ${datum})` } : k;
    });
    const neueVorlagen = s.templates.filter((v) => !st.templates.some((x) => x.id === v.id));
    const speicher: Array<[string, unknown]> = [];
    const vorlagenKarten = new Set(neueVorlagen.map((v) => v.node.id));
    for (const a of s.anhaenge) {
      const neu = karte.get(a.id);
      if (neu) speicher.push([`${a.vorsilbe}${neu}`, a.wert]);
      else if (vorlagenKarten.has(a.id)) speicher.push([`${a.vorsilbe}${a.id}`, a.wert]);
    }
    if (s.art === 'board') {
      useBoard.getState().importBoard(boards[0]);
    } else {
      // Bereiche als Kopie daneben (mit Datum im Namen), Boards ohne Projekt in ein eigenes Projekt
      const spaces: Space[] = s.spaces.map((sp) => ({
        id: uid(), name: `${sp.name} (Sicherung ${datum})`,
        projects: sp.projects.map((p) => ({ ...p, id: uid(), boardIds: p.boardIds.map((id) => boardMap.get(id) as string) })),
      }));
      const zugeordnet = new Set(spaces.flatMap((sp) => sp.projects.flatMap((p) => p.boardIds)));
      const lose = boards.filter((b) => !zugeordnet.has(b.id)).map((b) => b.id);
      if (lose.length) {
        if (!spaces.length) spaces.push({ id: uid(), name: `Sicherung ${datum}`, projects: [] });
        spaces[0] = { ...spaces[0], projects: [...spaces[0].projects, { id: uid(), name: 'Weitere Boards', boardIds: lose }] };
      }
      useBoard.getState().importStructure({ spaces, boards, activeId: boardMap.get(s.activeId ?? '') });
    }
    if (eingangDatei?.nodes.length) {
      const dazu = kopiereBoard(eingangDatei, boardMap, karte).nodes;
      useBoard.setState((x) => (x.boards.some(istEingang)
        ? { boards: x.boards.map((b) => (istEingang(b) ? { ...b, nodes: [...b.nodes, ...dazu] } : b)) }
        : { boards: [...x.boards, { id: EINGANG_ID, name: 'Eingang', system: 'eingang', nodes: dazu, edges: [], drawings: [] }] }));
    }
    if (neueVorlagen.length) useBoard.setState({ templates: [...useBoard.getState().templates, ...neueVorlagen] });
    await speicherSchreiben(speicher, vorher.speicher);
    meldung = s.art === 'board'
      ? t(`Sicherung „${s.boards[0].name}" als Kopie hinzugefügt.`)
      : t(`Sicherung vom ${datum} als Kopie hinzugefügt: ${zahlWort(s.boards.length, 'Board', 'Boards')}.`);
  } else {
    const kommt = new Map(s.boards.map((b) => [b.id, b]));
    // M449: Was gleich überschrieben wird, vorher als Version sichern — erst danach ersetzen
    await Promise.all(st.boards.filter((b) => kommt.has(b.id)).map((b) => versionSichern(b, 'import').catch(() => null)));
    const jetzt = useBoard.getState();
    const hier = new Set(jetzt.boards.map((b) => b.id));
    const boards = [
      ...jetzt.boards.map((b) => (kommt.get(b.id) ?? b)),
      ...s.boards.filter((b) => !hier.has(b.id)),
    ];
    let spaces = jetzt.spaces;
    if (s.art === 'alles') {
      // Bereiche aus der Datei ersetzen die gleichnamigen (gleiche Kennung); eigene Bereiche bleiben
      const neu = new Map(s.spaces.map((sp) => [sp.id, sp]));
      const imPlan = new Set(s.spaces.flatMap((sp) => sp.projects.flatMap((p) => p.boardIds)));
      spaces = [
        ...jetzt.spaces.map((sp) => neu.get(sp.id) ?? {
          ...sp, projects: sp.projects.map((p) => ({ ...p, boardIds: p.boardIds.filter((id) => !imPlan.has(id)) })),
        }),
        ...s.spaces.filter((sp) => !jetzt.spaces.some((x) => x.id === sp.id)),
      ];
      // Boards, die hier lagen und durch das Ersetzen eines Bereichs kein Projekt mehr hätten, kommen zurück an ihren Platz
      const zugeordnet = new Set(spaces.flatMap((sp) => sp.projects.flatMap((p) => p.boardIds)));
      const heimat = new Map(jetzt.spaces.flatMap((sp) => sp.projects.flatMap((p) => p.boardIds.map((id) => [id, p.id] as [string, string]))));
      const lose = jetzt.boards.filter((b) => !zugeordnet.has(b.id) && heimat.has(b.id)).map((b) => b.id);
      if (lose.length) {
        const projektDa = (pid: string) => spaces.some((sp) => sp.projects.some((p) => p.id === pid));
        spaces = spaces.map((sp, i) => ({
          ...sp,
          projects: sp.projects.map((p, j) => {
            const hierher = lose.filter((id) => (projektDa(heimat.get(id)!) ? heimat.get(id) === p.id : i === 0 && j === 0));
            return hierher.length ? { ...p, boardIds: [...p.boardIds, ...hierher] } : p;
          }),
        }));
      }
      // M478: Der Eingang steht in keinem Projekt und kommt auch nach dem Einspielen in keines
      const neuLose = s.boards.filter((b) => !istEingang(b) && !hier.has(b.id) && !spaces.some((sp) => sp.projects.some((p) => p.boardIds.includes(b.id))));
      if (neuLose.length && spaces[0]?.projects[0]) {
        spaces = spaces.map((sp, i) => (i ? sp : { ...sp, projects: sp.projects.map((p, j) => (j ? p : { ...p, boardIds: [...p.boardIds, ...neuLose.map((b) => b.id)] })) }));
      }
    } else if (!hier.has(s.boards[0].id)) {
      // Ein Board, das es hier nicht gibt: wie eine Kopie ins aktive Projekt, aber mit seiner Kennung
      const aktiv = jetzt.spaces.flatMap((sp) => sp.projects).find((p) => p.boardIds.includes(jetzt.activeId)) ?? jetzt.spaces[0]?.projects[0];
      if (aktiv) spaces = jetzt.spaces.map((sp) => ({ ...sp, projects: sp.projects.map((p) => (p.id === aktiv.id ? { ...p, boardIds: [...p.boardIds, s.boards[0].id] } : p)) }));
    }
    const betroffen = new Set(s.boards.map((b) => b.id));
    const ohne = (e: { boardId: string }) => !betroffen.has(e.boardId);
    useBoard.setState({
      boards,
      spaces,
      activeId: s.art === 'board' ? s.boards[0].id : (s.activeId && betroffen.has(s.activeId) ? s.activeId : jetzt.activeId),
      templates: vorlagenMischen(jetzt.templates, s.templates, true),
      // Schritte auf ersetzten Boards passen nicht mehr zu ihrem Inhalt
      past: jetzt.past.filter(ohne),
      future: jetzt.future.filter(ohne),
      lastDeleted: null,
      view: s.art === 'board' ? 'board' : jetzt.view,
      // Notiz-Editoren lesen ihren Inhalt nur beim Aufbau
      importEpoch: jetzt.importEpoch + 1,
    });
    if (s.einstellungen) {
      const alt = vorliebenAuszug();
      vorher.vorlieben = Object.fromEntries(Object.keys(s.einstellungen).map((k) => [k, alt[k]]));
      useBoard.setState(s.einstellungen as never);
    }
    await speicherSchreiben(s.anhaenge.map((a) => [`${a.vorsilbe}${a.id}`, a.wert] as [string, unknown]), vorher.speicher);
    meldung = s.art === 'board'
      ? t(`Board „${s.boards[0].name}" aus der Sicherung wiederhergestellt. Der Stand davor liegt unter Versionen.`)
      : t(`Sicherung vom ${datum} eingespielt: ${zahlWort(s.boards.length, 'Board', 'Boards')}. Die Stände davor liegen unter Versionen.`);
  }
  rueck = vorher;
  dirtyMerken();
  flushPersist();
  if (s.art === 'alles' && modus === 'ersetzen') merkeSicherung();
  return meldung;
}

/** Hinweis nach dem Einspielen — mit „Rückgängig" */
export function eingespieltMelden(meldung: string): void {
  hinweisMitKnopf(meldung, t('Rückgängig'), () => { void sicherungRueckgaengig(); }, 15000);
}

/** Das letzte Einspielen als Ganzes zurücknehmen */
export async function sicherungRueckgaengig(): Promise<boolean> {
  const r = rueck;
  if (!r) return false;
  rueck = null;
  claimWriter();
  const st = useBoard.getState();
  useBoard.setState({
    boards: r.boards, spaces: r.spaces,
    activeId: r.boards.some((b) => b.id === st.activeId) ? st.activeId : r.activeId,
    templates: r.templates,
    past: [], future: [], lastDeleted: null,
    importEpoch: st.importEpoch + 1,
  });
  if (r.vorlieben) useBoard.setState(r.vorlieben as never);
  for (const [k, w] of r.speicher) {
    try { if (w === undefined) await idbDel(k); else await idbSet(k, w); } catch { /* bleibt, wie es ist */ }
  }
  if (r.speicher.size) window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
  dirtyMerken();
  flushPersist();
  useBoard.getState().showToast(t('Einspielen zurückgenommen – der Stand von davor ist wieder da.'), false, 5000);
  return true;
}

// ---------------------------------------------------------------- Automatisch & Erinnerung

const ordnerApi = (): boolean => typeof window !== 'undefined' && 'showDirectoryPicker' in window;
export const autoMoeglich = ordnerApi;
export const autoAn = (): boolean => { try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; } };

/** Der gewählte Ordner — in dieser Sitzung aus dem Speicher, sonst aus IndexedDB (wie der Sync-Ordner) */
let ordnerMerk: SyncDirHandle | undefined;
export async function autoOrdner(): Promise<SyncDirHandle | undefined> {
  if (ordnerMerk) return ordnerMerk;
  ordnerMerk = await idbGet<SyncDirHandle>(ORDNER_IDB).catch(() => undefined);
  return ordnerMerk;
}

let zuhoeren = false;
/** Beim Verdecken/Schließen des Fensters: fällige Auto-Sicherung (höchstens einmal am Tag) */
function verdecktSichern(): void {
  if (zuhoeren) return;
  zuhoeren = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && autoAn()) void autoSichern();
  });
}

/** Einstellungen: „Automatisch sichern" einschalten — Ordner wählen und gleich die erste Sicherung schreiben */
export async function autoEinschalten(): Promise<string | null> {
  if (!ordnerApi()) return null;
  const pick = (window as unknown as { showDirectoryPicker: (o: object) => Promise<SyncDirHandle> }).showDirectoryPicker;
  const h = await pick({ id: 'pixinotes-sicherung', mode: 'readwrite' });
  ordnerMerk = h;
  await idbSet(ORDNER_IDB, h).catch(() => {});
  try { localStorage.setItem(AUTO_KEY, '1'); } catch { /* dann eben nur für diese Sitzung */ }
  verdecktSichern();
  await autoSichern(true);
  return h.name;
}

export async function autoAusschalten(): Promise<void> {
  try { localStorage.removeItem(AUTO_KEY); } catch { /* egal */ }
  ordnerMerk = undefined;
  await idbDel(ORDNER_IDB).catch(() => {});
}

let autoLaeuft = false;
/**
 * In den gewählten Ordner sichern: höchstens einmal am Tag (außer `sofort`), eine Datei je Tag
 * (PixiNotes-Alles-JJJJ-MM-TT.pixinotes), die letzten AUTO_BEHALTEN bleiben liegen.
 * Gibt 'ok', 'nicht-faellig', 'keine-erlaubnis' oder 'fehler' zurück.
 */
export async function autoSichern(sofort = false, jetzt = Date.now()): Promise<'ok' | 'nicht-faellig' | 'keine-erlaubnis' | 'aus' | 'fehler'> {
  if (!autoAn()) return 'aus';
  if (autoLaeuft) return 'nicht-faellig';
  if (!sofort) {
    const a = Date.parse(localStorage.getItem(AUTO_LETZTE_KEY) ?? '');
    if (Number.isFinite(a) && jetzt - a < TAG_MS) return 'nicht-faellig';
  }
  const h = await autoOrdner();
  if (!h) return 'fehler';
  autoLaeuft = true;
  try {
    const erlaubt = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (erlaubt !== 'granted') return 'keine-erlaubnis';
    const g = await sicherungBauen('alles');
    if (!g) return 'fehler';
    const f = await h.getFileHandle(g.name, { create: true });
    const w = await f.createWritable();
    await w.write(g.blob);
    await w.close();
    // Ältere automatische Sicherungen ausdünnen — nur Dateien nach unserem Muster
    if (h.values && h.removeEntry) {
      const namen: string[] = [];
      for await (const e of h.values()) if (e.kind === 'file' && AUTO_MUSTER.test(e.name)) namen.push(e.name);
      namen.sort().reverse();
      for (const alt of namen.slice(AUTO_BEHALTEN)) await h.removeEntry(alt).catch(() => {});
    }
    const iso = new Date(jetzt).toISOString();
    localStorage.setItem(AUTO_LETZTE_KEY, iso);
    localStorage.setItem(LETZTE_SICHERUNG_KEY, iso);
    window.dispatchEvent(new CustomEvent('pixinotes:sicherung-stand'));
    return 'ok';
  } catch {
    return 'fehler';
  } finally {
    autoLaeuft = false;
  }
}

/** Nach einer Lücke von ERINNERUNG_TAGE Tagen EIN ruhiger Hinweis mit „Jetzt sichern" */
export function erinnern(jetzt = Date.now()): boolean {
  let seit: number;
  try { seit = Date.parse(localStorage.getItem(SICHERUNG_SEIT_KEY) ?? ''); } catch { return false; }
  const bezug = letzteSicherung() ?? seit;
  if (!Number.isFinite(bezug) || jetzt - bezug < ERINNERUNG_TAGE * TAG_MS) return false;
  if (localStorage.getItem(ERINNERT_KEY) === String(bezug)) return false;
  // Wer noch gar nichts angelegt hat, hat nichts zu verlieren
  if (!useBoard.getState().boards.some((b) => b.nodes.length > 0)) return false;
  localStorage.setItem(ERINNERT_KEY, String(bezug));
  const tage = Math.floor((jetzt - bezug) / TAG_MS);
  const text = letzteSicherung()
    ? t(`Letzte Sicherung vor ${zahlWort(tage, 'Tag', 'Tagen')}. Der Browser-Speicher allein ist kein Backup.`)
    : t('Noch keine Sicherung. Der Browser-Speicher allein ist kein Backup.');
  hinweisMitKnopf(text, t('Jetzt sichern'), () => { void allesSichern(); }, 15000);
  return true;
}

/** Beim Start (verzögert): fällige Auto-Sicherung, sonst ggf. die Erinnerung */
export async function sicherungStart(): Promise<void> {
  if (autoAn()) {
    verdecktSichern();
    const r = await autoSichern();
    if (r === 'keine-erlaubnis') {
      const h = await autoOrdner();
      hinweisMitKnopf(t('Automatische Sicherung: Der Ordner braucht deine Erlaubnis.'), t('Erlauben'), () => {
        void (async () => { if ((await h?.requestPermission?.({ mode: 'readwrite' })) === 'granted') await autoSichern(true); })();
      }, 15000);
      return;
    }
    if (r === 'ok' || r === 'nicht-faellig') return;
  }
  erinnern();
}
