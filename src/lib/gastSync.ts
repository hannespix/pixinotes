// M364: Gruppenarbeit per Link — auch ohne Konto.
//
// Wer einen Einladungslink (M360) öffnet, dessen Besitzer „auch ohne Konto" erlaubt hat, arbeitet direkt im
// ORIGINAL mit: kein Konto, kein Kopieren. Der Zugang läuft über drei Server-Funktionen, die nur das Token
// prüfen (gast_lesen, gast_stand, gast_schreiben). Abgeglichen wird wie bei geteilten Boards zwischen Konten:
// kartenweise, dreiwegig (lib/syncMerge.ts) — zwei Leute an verschiedenen Karten stören sich nicht, an derselben
// Karte gewinnt die hiesige Fassung und der Abgleich meldet es.
//
// Tempo: Nach einer Änderung geht der Stand nach einer knappen Sekunde Tipp-Pause hinaus; die anderen erfahren
// es sofort über den Live-Kanal (lib/liveKanal.ts) und sonst beim Blick alle paar Sekunden. Der Kanal zeigt
// auch, wer gerade dabei ist.
//
// Maße der Karten (`measured`) misst jedes Gerät selbst — ein Telefon anders als ein Laptop. Sie reisen darum
// nicht als Änderung: Verglichen und geschrieben wird mit den Maßen des letzten gemeinsamen Stands, sonst
// schickten sich zwei verschiedene Geräte endlos „Änderungen" zu.
import { flushPersist, NOTIZ_EXTERN, ohneLeseschutz, runDerived, setzeKartenSperren, useBoard, type BoardDoc, type Space } from '../store';
import { getAuthor } from '../components/CommentLayer';
import { loadFile, saveFile } from './fileStore';
import { supabaseKonfig } from './kontoSupabase';
import { checkKontoRemote, kontoAnfrage, loadKonto, mitGeteiltBereich, stempel } from './kontoSync';
import { liveKanal, type LiveKanal, type Teilnehmer } from './liveKanal';
import { idbDel, idbGet, idbSet, liveHaken } from './syncFolder';
import { berichtAlsSatz, dreiWegeMerge, ohneAuswahl } from './syncMerge';
import type { AppNode } from '../types';

const KEY = 'pixinotes-gast';
const ICH_KEY = 'pixinotes-gast-ich';
const BLICK_MS = 3500;
const TIPP_PAUSE_MS = 800;
export const GAST_NAME = 'Per Link';
export const TEILNEHMER_EREIGNIS = 'pixinotes:teilnehmer';

type Rolle = 'bearbeiten' | 'lesen';
interface Eintrag { token: string; rolle: Rolle; version: number; kanal?: string }
interface GastDatei { id: string; name: string; mime?: string; groesse?: number; url: string }
interface Gelesen { board_id: string; rolle: Rolle; besitzer: string; inhalt: string; version: number; dateien?: GastDatei[]; kanal?: string }

const lesen = (): Record<string, Eintrag> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Eintrag>; } catch { return {}; } };
const schreiben = (m: Record<string, Eintrag>): void => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* voll */ } };
const basisKey = (boardId: string): string => `gast:basis:${boardId}`;

/** Wer bin ich im Kanal? Kennung je Gerät, Farbe aus der Kennung, Name aus den Kommentaren */
const FARBEN = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4d7c0f'];
export function ich(): Teilnehmer {
  let id = '';
  try { id = localStorage.getItem(ICH_KEY) ?? ''; if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem(ICH_KEY, id); } } catch { id = Math.random().toString(36).slice(2, 12); }
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { id, name: getAuthor().trim() || loadKonto()?.name?.split('@')[0] || 'Gast', farbe: FARBEN[h % FARBEN.length] };
}

class GastFehler extends Error { constructor(public art: 'vorbedingung' | 'keine-freigabe' | 'netz' | 'fehlt', text: string) { super(text); } }
/** Server-Funktion mit dem öffentlichen Schlüssel aufrufen — kein Konto nötig */
async function rpc<T>(name: string, body: unknown): Promise<T> {
  const k = supabaseKonfig();
  if (!k.url || !k.key) throw new GastFehler('fehlt', 'Kein Server hinterlegt.');
  let res: Response;
  try {
    res = await fetch(`${k.url}/rest/v1/rpc/${name}`, {
      method: 'POST', cache: 'no-store',
      headers: { apikey: k.key, Authorization: `Bearer ${k.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { throw new GastFehler('netz', 'Keine Verbindung.'); }
  if (res.status === 404) throw new GastFehler('fehlt', 'Gäste ohne Konto sind auf dem Server noch nicht eingerichtet.');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (/vorbedingung/i.test(t)) throw new GastFehler('vorbedingung', 'vorbedingung');
    if (/keine freigabe/i.test(t)) throw new GastFehler('keine-freigabe', 'keine freigabe');
    throw new GastFehler('netz', `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Board ohne die Angaben, die nur dieses Gerät betreffen (Besitzer-Kennung, Rolle, Token) */
function rein(b: BoardDoc): BoardDoc {
  const { geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, gastWar: _w, ...rest } = b;
  return rest as BoardDoc;
}
/** Nach dem Ende der Einwahl: eigene Kopie, als solche gemerkt */
const alsKopie = (b: BoardDoc): BoardDoc => ({ ...rein(b), gastWar: true });
/** Server-Stand als hiesiges Board: mit Besitzer, Rolle und Token */
function gezeichnet(roh: BoardDoc, g: { besitzer: string; rolle: Rolle }, token: string): BoardDoc {
  const b: BoardDoc = { ...roh, geteiltVon: g.besitzer, geteiltVonName: GAST_NAME, gastLink: token };
  if (g.rolle === 'lesen') b.geteiltRolle = 'lesen'; else delete b.geteiltRolle;
  return b;
}
type Mass = AppNode & { measured?: unknown };
/** Karten des einen Stands mit den Maßen des anderen (nach Kennung); wo der andere die Karte nicht kennt, bleiben die eigenen */
function mitMassenVon(b: BoardDoc, quelle: BoardDoc | undefined): BoardDoc {
  if (!quelle) return b;
  const q = new Map(quelle.nodes.map((n) => [n.id, n as Mass]));
  let anders = false;
  const nodes = b.nodes.map((n) => {
    const m = q.get(n.id);
    if (!m || (n as Mass).measured === m.measured) return n;
    if (JSON.stringify((n as Mass).measured) === JSON.stringify(m.measured)) return n;
    anders = true;
    const kopie = { ...n } as Mass;
    if (m.measured === undefined) delete kopie.measured; else kopie.measured = m.measured;
    return kopie as AppNode;
  });
  return anders ? { ...b, nodes } : b;
}
const kern = (b: BoardDoc): string => JSON.stringify(ohneAuswahl(rein(b)));

// ---------- Laufender Abgleich ----------
const kanaele = new Map<string, LiveKanal>();                 // boardId → Kanal
const anwesend = new Map<string, Teilnehmer[]>();             // boardId → wer ist dabei
const laeuft = new Map<string, Promise<unknown>>();           // boardId → Kette (nie zwei Abgleiche zugleich)
const schreibTimer = new Map<string, ReturnType<typeof setTimeout>>();
let letzteAenderung = 0;
let gestartet = false;

export const teilnehmerVon = (boardId: string): Teilnehmer[] => anwesend.get(boardId) ?? [];
/** Auf diesem Board läuft ein Live-Kanal (geteiltes Board: Besitzer, Gast mit Konto oder Gast per Link) */
export const liveAuf = (boardId: string): boolean => kanaele.has(boardId);
/** Steht die Live-Verbindung gerade? (sonst gleicht der regelmäßige Blick ab — nur ohne „wer ist dabei") */
export const liveVerbunden = (boardId: string): boolean => !!kanaele.get(boardId)?.verbunden;
/** Nachricht an alle anderen auf diesem Board (für „Folgt mir") */
export const liveSenden = (boardId: string, ereignis: string, inhalt?: unknown): void => kanaele.get(boardId)?.senden(ereignis, inhalt);
export const LIVE_NACHRICHT = 'pixinotes:live-nachricht';

function exklusiv<T>(boardId: string, fn: () => Promise<T>): Promise<T> {
  const p = (laeuft.get(boardId) ?? Promise.resolve()).then(fn, fn);
  laeuft.set(boardId, p.catch(() => {}));
  return p;
}

function kanalOeffnen(boardId: string, kanalName: string, beiStand: () => void): void {
  if (kanaele.has(boardId)) return;
  const k = supabaseKonfig();
  kanaele.set(boardId, liveKanal(k, kanalName, { ...ich(), ...meineKarte(boardId) }, {
    nachricht: (ereignis, inhalt) => {
      if (ereignis === 'stand') beiStand();
      else if (ereignis === 'karte') karteVonAussen(boardId, inhalt);
      else window.dispatchEvent(new CustomEvent(LIVE_NACHRICHT, { detail: { boardId, ereignis, inhalt } }));
    },
    teilnehmer: (liste) => { anwesend.set(boardId, liste); sperrenRechnen(boardId); window.dispatchEvent(new CustomEvent(TEILNEHMER_EREIGNIS, { detail: boardId })); },
  }));
  window.dispatchEvent(new CustomEvent(TEILNEHMER_EREIGNIS, { detail: boardId }));
}
function kanalSchliessen(boardId: string): void {
  if (!kanaele.has(boardId)) return;
  kanaele.get(boardId)?.stop();
  kanaele.delete(boardId);
  meine.delete(boardId);
  anwesend.delete(boardId);
  sperrenRechnen(boardId);   // löst alle Sperren dieses Boards (und beendet das Mitlesen)
  window.dispatchEvent(new CustomEvent(TEILNEHMER_EREIGNIS, { detail: boardId }));
}

// ---------- Karten-Sperre: Wer zuerst anfasst, hat die Karte ----------
// „Anfassen" heißt: in der Karte steht der Schreib-Cursor (Text, Eingabefeld) oder sie wird gerade gezogen.
// Auswählen, Lesen, Blättern und Zeichnen auf einer PDF-Seite sperren nicht — Striche sind eigene Objekte und
// stören einander nicht. Die Sperre steckt in den Presence-Angaben („ich bearbeite Karte X seit …"): Sie fällt
// von selbst, wenn jemand die Karte verlässt oder die Verbindung verliert. Greifen zwei im selben Augenblick
// zu, gewinnt der frühere Zeitpunkt (bei Gleichstand die kleinere Kennung) — auf allen Geräten gleich.
const meine = new Map<string, { karte: string; seit: number }>();   // boardId → Karte, die ich halte
const meineKarte = (boardId: string): { karte?: string; seit?: number } => meine.get(boardId) ?? {};
/** Wer hält welche Karte (ohne mich)? → an den Speicher (Schutz) und an die Anzeige */
export const SPERREN_EREIGNIS = 'pixinotes:karten-sperren';
const sperren = new Map<string, Map<string, Teilnehmer>>();          // boardId → Karte → Halter
export const sperrenVon = (boardId: string): Map<string, Teilnehmer> => sperren.get(boardId) ?? new Map();
function sperrenRechnen(boardId: string): void {
  const selbst = ich().id;
  const halter = new Map<string, Teilnehmer>();
  for (const t of anwesend.get(boardId) ?? []) {
    if (!t.karte) continue;
    const alt = halter.get(t.karte);
    if (!alt || (t.seit ?? 0) < (alt.seit ?? 0) || ((t.seit ?? 0) === (alt.seit ?? 0) && t.id < alt.id)) halter.set(t.karte, t);
  }
  // Habe ich eine Karte, die ein anderer früher hatte? Dann lasse ich sie los.
  const m = meine.get(boardId);
  if (m) {
    const h = halter.get(m.karte);
    if (h && h.id !== selbst && ((h.seit ?? 0) < m.seit || ((h.seit ?? 0) === m.seit && h.id < selbst))) {
      meine.delete(boardId);
      kanaele.get(boardId)?.ich({ ...ich() });
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }
  const fremd = new Map<string, Teilnehmer>();
  for (const [karte, t] of halter) if (t.id !== selbst) fremd.set(karte, t);
  const vorher = sperren.get(boardId);
  const gleich = !!vorher && vorher.size === fremd.size && [...fremd].every(([k, t]) => vorher.get(k)?.id === t.id);
  // Losgelassen: Der Schreiber sichert seinen Text selbst — kommt der gesicherte Stand nicht bald, endet das Mitlesen
  for (const karte of vorher?.keys() ?? []) {
    if (fremd.has(karte)) continue;
    const key = `${boardId}\n${karte}`;
    clearTimeout(endeTimer.get(key));
    endeTimer.set(key, setTimeout(() => { endeTimer.delete(key); if (!sperren.get(boardId)?.has(karte)) mitschriftBeenden(boardId, karte); }, MITLESEN_ENDE_MS));
  }
  sperren.set(boardId, fremd);
  setzeKartenSperren(boardId, new Map([...fremd].map(([k, t]) => [k, t.name])));
  if (!gleich) window.dispatchEvent(new CustomEvent(SPERREN_EREIGNIS, { detail: boardId }));
}
/** Welche Karte fasse ich gerade an? (Schreib-Cursor in der Karte oder Karte im Zug) */
function angefassteKarte(boardId: string): string | null {
  const st = useBoard.getState();
  if (st.activeId !== boardId || st.view !== 'board') return null;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) && !el.closest('.pdf-seite-bar, .comment-panel')) {
    const k = el.closest('.react-flow__node') as HTMLElement | null;
    if (k?.dataset.id) return k.dataset.id;
  }
  const gezogen = st.boards.find((b) => b.id === boardId)?.nodes.find((n) => (n as { dragging?: boolean }).dragging);
  return gezogen?.id ?? null;
}
let anfassTimer: ReturnType<typeof setTimeout> | undefined;
function anfassenPruefen(): void {
  clearTimeout(anfassTimer);
  anfassTimer = setTimeout(() => {
    for (const [boardId, kanal] of kanaele) {
      // Wer nur lesen darf, hält nie eine Karte
      const nurLesen = useBoard.getState().boards.find((b) => b.id === boardId)?.geteiltRolle === 'lesen';
      const karte = nurLesen ? null : angefassteKarte(boardId);
      const alt = meine.get(boardId);
      if ((alt?.karte ?? null) === karte) continue;
      if (karte && sperren.get(boardId)?.has(karte)) {
        // Die Karte hält schon jemand: nicht hineinschreiben lassen
        (document.activeElement as HTMLElement | null)?.blur?.();
        continue;
      }
      if (karte) meine.set(boardId, { karte, seit: Date.now() }); else meine.delete(boardId);
      kanal.ich({ ...ich(), ...meineKarte(boardId) });
    }
  }, 60);
}
/** Meine gehaltene Karte hat sich geändert → allen sofort zeigen (nicht erst nach dem Speichern) */
const kartenTimer = new Map<string, ReturnType<typeof setTimeout>>();
function karteSenden(boardId: string): void {
  if (kartenTimer.has(boardId)) return;
  kartenTimer.set(boardId, setTimeout(() => {
    kartenTimer.delete(boardId);
    const m = meine.get(boardId);
    const node = m && useBoard.getState().boards.find((b) => b.id === boardId)?.nodes.find((n) => n.id === m.karte);
    if (!m || !node) return;
    const { selected: _s, dragging: _d, measured: _m, ...rest } = node as AppNode & { selected?: boolean; dragging?: boolean; measured?: unknown };
    kanaele.get(boardId)?.senden('karte', { von: ich().id, node: rest });
  }, 220));
}
/** Live-Stand einer Karte, die ein anderer gerade bearbeitet — nur vom Halter der Karte angenommen */
function karteVonAussen(boardId: string, inhalt: unknown): void {
  const d = inhalt as { von?: string; node?: AppNode } | undefined;
  if (!d?.node?.id || !d.von) return;
  if (sperren.get(boardId)?.get(d.node.id)?.id !== d.von) return;
  const st = useBoard.getState();
  const board = st.boards.find((b) => b.id === boardId);
  const alt = board?.nodes.find((n) => n.id === d.node!.id);
  if (!board || !alt) return;
  // Den Stand VOR dem Mitschreiben merken: Er ist der letzte gesicherte — der Live-Stand gehört dem Schreiber
  const o = originale.get(boardId) ?? new Map<string, AppNode>();
  if (!o.has(alt.id)) { o.set(alt.id, alt); originale.set(boardId, o); }
  const neu = mitAnsichtVon(d.node, alt);
  einspielen(boardId, neu, alt);
  const l = liveStaende.get(boardId) ?? new Map<string, AppNode>();
  l.set(neu.id, neu); liveStaende.set(boardId, l);
}
/** Auswahl und Maße gehören dem Gerät: die hiesigen bleiben */
function mitAnsichtVon(node: AppNode, hier: AppNode): AppNode {
  const a = hier as AppNode & { selected?: boolean; measured?: unknown };
  const { selected: _s, dragging: _d, measured: _m, ...rest } = node as AppNode & { selected?: boolean; dragging?: boolean; measured?: unknown };
  return { ...rest, ...(a.selected !== undefined ? { selected: a.selected } : {}), ...(a.measured !== undefined ? { measured: a.measured } : {}) } as AppNode;
}
/** Eine Karte von außen in den Speicher legen — als „abgeleitet": Das ist nicht meine Änderung, sie löst hier kein Speichern aus */
function einspielen(boardId: string, neu: AppNode, alt: AppNode): void {
  const bl = (n: AppNode): unknown => (n.data as { blocks?: unknown }).blocks;
  const notiz = neu.type === 'note' && bl(neu) !== bl(alt) && JSON.stringify(bl(neu)) !== JSON.stringify(bl(alt));
  liveEinspielung = true;
  try {
    runDerived(() => ohneLeseschutz(() => useBoard.setState((s) => ({
      boards: s.boards.map((b) => (b.id === boardId ? { ...b, nodes: b.nodes.map((n) => (n.id === neu.id ? neu : n)) } : b)),
    }))));
  } finally { liveEinspielung = false; }
  if (notiz && useBoard.getState().activeId === boardId) window.dispatchEvent(new CustomEvent(NOTIZ_EXTERN, { detail: [neu.id] }));
}
let liveEinspielung = false;
/**
 * Mitgelesene Karten: `originale` = ihr letzter GESICHERTER Stand, `liveStaende` = was hier gerade zu sehen ist.
 * Das Mitlesen ist nur Anzeige: Geschrieben und verglichen wird hier weiter mit dem gesicherten Stand
 * (liveHaken) — der Schreiber sichert seinen Text selbst, über den Server und mit dessen Rechteprüfung. So kann
 * über den Kanal niemand etwas in ein Board schreiben, der es nicht auch über den Server dürfte. Das Mitlesen
 * endet, sobald der gesicherte Stand der Karte ankommt oder man sie selbst bearbeitet; bleibt der gesicherte
 * Stand nach dem Loslassen aus (Verbindung des Schreibers weg), zeigt die Karte wieder den letzten gesicherten —
 * sein Text liegt bei ihm und kommt mit seinem nächsten Abgleich.
 */
const MITLESEN_ENDE_MS = 20_000;
const endeTimer = new Map<string, ReturnType<typeof setTimeout>>();
const originale = new Map<string, Map<string, AppNode>>();
const liveStaende = new Map<string, Map<string, AppNode>>();
function mitschriftVergessen(boardId: string, nodeId: string): void {
  originale.get(boardId)?.delete(nodeId);
  liveStaende.get(boardId)?.delete(nodeId);
}
const gleicherInhalt = (a: AppNode, b: AppNode): boolean => a === b
  || ((a.data === b.data || JSON.stringify(a.data) === JSON.stringify(b.data)) && a.position.x === b.position.x && a.position.y === b.position.y);
/** Mitlesen ohne gesicherten Stand beenden: zurück zum letzten gesicherten */
function mitschriftBeenden(boardId: string, nodeId: string): void {
  const orig = originale.get(boardId)?.get(nodeId);
  const live = liveStaende.get(boardId)?.get(nodeId);
  mitschriftVergessen(boardId, nodeId);
  if (!orig || !live) return;
  const n = useBoard.getState().boards.find((b) => b.id === boardId)?.nodes.find((x) => x.id === nodeId);
  if (!n || !gleicherInhalt(n, live) || gleicherInhalt(n, orig)) return;
  einspielen(boardId, mitAnsichtVon(orig, n), n);
}
liveHaken.vor = (b) => {
  const o = originale.get(b.id); const l = liveStaende.get(b.id);
  if (!o?.size || !l) return b;
  let anders = false;
  const nodes = b.nodes.map((n) => { const live = l.get(n.id); const orig = o.get(n.id); if (live && orig && gleicherInhalt(n, live)) { anders = true; return orig; } return n; });
  return anders ? { ...b, nodes } : b;
};
liveHaken.nach = (b) => {
  const o = originale.get(b.id); const l = liveStaende.get(b.id);
  if (!o?.size || !l) return b;
  let anders = false;
  const nodes = b.nodes.map((n) => {
    const live = l.get(n.id); const orig = o.get(n.id);
    if (!live || !orig) return n;
    // Der Abgleich hat die Karte nicht angerührt → der Live-Stand bleibt zu sehen
    if (gleicherInhalt(n, orig)) { anders = true; return live; }
    // Neuer gesicherter Stand, der Schreiber ist aber noch dran → das ist der neue gesicherte, zu sehen bleibt live
    if (sperren.get(b.id)?.has(n.id)) { o.set(n.id, n); anders = true; return live; }
    mitschriftVergessen(b.id, n.id);
    return n;
  });
  return anders ? { ...b, nodes } : b;
};
/** Der eigene Name hat sich geändert (Namensfeld beim Einwählen, Kommentar-Name) — allen Kanälen sagen */
export function nameGeaendert(): void {
  const t = ich();
  for (const k of kanaele.values()) k.ich(t);
}

/** Anhänge des Besitzers nachladen, die hier noch fehlen (die Karten zeigen sie, sobald sie liegen) */
async function dateienHolen(board: BoardDoc, dateien: GastDatei[] | undefined): Promise<void> {
  if (!dateien?.length) return;
  const gebraucht = new Set(board.nodes.filter((n) => n.type === 'file' && !(n.data as { dataUrl?: string }).dataUrl).map((n) => n.id));
  let n = 0;
  for (const d of dateien) {
    if (!gebraucht.has(d.id) || !/^https:\/\//.test(d.url)) continue;
    try {
      if (await loadFile(d.id)) continue;
      const r = await fetch(d.url);
      if (!r.ok) continue;
      const blob = await r.blob();
      await saveFile(d.id, d.mime && blob.type !== d.mime ? new Blob([blob], { type: d.mime }) : blob);
      n += 1;
    } catch { /* eine klemmende Datei hält die anderen nicht auf */ }
  }
  if (n > 0) window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
}

/** Der Link gilt nicht mehr (widerrufen oder „ohne Konto" aus): Das Board bleibt als eigene Kopie */
function beendet(boardId: string): void {
  const m = lesen();
  if (!m[boardId]) return;
  delete m[boardId];
  schreiben(m);
  kanalSchliessen(boardId);
  void idbDel(basisKey(boardId)).catch(() => {});
  ohneLeseschutz(() => useBoard.setState((s) => ({ boards: s.boards.map((b) => (b.id === boardId ? alsKopie(b) : b)) })));
  flushPersist();
  useBoard.getState().showToast('Der Link zu diesem Board wurde beendet — es bleibt als eigene Kopie bei dir.', false, 8000);
}

/** Server-Stand holen und einarbeiten; schreibt danach, wenn hier Eigenes dazukam */
async function holen(boardId: string): Promise<void> {
  const e = lesen()[boardId];
  if (!e) return;
  const st0 = useBoard.getState();
  if (!st0.boards.some((b) => b.id === boardId)) { beendetStill(boardId); return; }
  // Mitten im Tippen auf genau diesem Board: gleich noch einmal (der Editor liest seinen Text nur beim Aufbau)
  if (st0.activeId === boardId && Date.now() - letzteAenderung < 1500) { setTimeout(() => void abgleichen(boardId), 1600); return; }
  let g: Gelesen | null;
  try { g = await rpc<Gelesen | null>('gast_lesen', { p_token: e.token }); } catch { return; }
  if (!g) { beendet(boardId); return; }
  let fremd: BoardDoc;
  try { fremd = gezeichnet(JSON.parse(g.inhalt) as BoardDoc, g, e.token); } catch { return; }
  const basis = await idbGet<BoardDoc>(basisKey(boardId)).catch(() => undefined);
  const st = useBoard.getState();
  const lokal = st.boards.find((b) => b.id === boardId);
  // Kein Board oder eines, das hier nicht (mehr) als gemeinsames liegt: nichts abgleichen — eine eigene Kopie
  // darf nie von selbst auf den Server des Besitzers wandern. Der Link lässt sich jederzeit neu öffnen.
  if (!lokal || !lokal.gastLink) { beendetStill(boardId); return; }
  // Verglichen wird mit den Maßen des letzten gemeinsamen Stands (siehe Kopf der Datei)
  const lokalV = mitMassenVon(liveHaken.vor(lokal), basis);
  const erg = dreiWegeMerge(basis ? { boards: [basis], spaces: [] } : null, { boards: [lokalV], spaces: [] }, { boards: [fremd], spaces: [] });
  const neu = erg.boards.find((b) => b.id === boardId) ?? fremd;
  // In den Speicher mit den HIESIGEN Maßen — sonst blitzte jede Karte kurz weg, bis sie neu gemessen ist;
  // Karten, die gerade ein anderer schreibt, behalten dessen Live-Stand (liveHaken.nach)
  const fuerHier = liveHaken.nach(mitMassenVon(neu, lokal));
  if (kern(fuerHier) !== kern(lokal) || fuerHier.geteiltRolle !== lokal.geteiltRolle) {
    ohneLeseschutz(() => st.importSync(st.boards.map((b) => (b.id === boardId ? fuerHier : b)), st.spaces, st.activeId, { geaendert: [boardId] }));
    flushPersist();   // der neue Stand soll einen Absturz oder ein schnelles Schließen überstehen
    if (erg.bericht.konflikte) st.showToast(`👥 Abgeglichen: ${berichtAlsSatz(erg.bericht)}.`, false, 6000);
  }
  await idbSet(basisKey(boardId), fremd).catch(() => {});
  const m = lesen();
  if (m[boardId]) { m[boardId] = { ...m[boardId], version: g.version, rolle: g.rolle, ...(g.kanal ? { kanal: g.kanal } : {}) }; schreiben(m); }
  void dateienHolen(fremd, g.dateien);
  // Hier ist etwas dazugekommen, das der Server noch nicht hat → hinaus
  if (g.rolle === 'bearbeiten' && kern(mitMassenVon(neu, fremd)) !== kern(fremd)) await hinaus(boardId);
}
/** Board lokal nicht mehr da (gelöscht): Eintrag still entfernen */
function beendetStill(boardId: string): void {
  const m = lesen();
  if (m[boardId]) { delete m[boardId]; schreiben(m); }
  kanalSchliessen(boardId);
}

/** Eigene Änderungen zum Server; bei einem fremden Stand dazwischen erst einarbeiten */
async function hinaus(boardId: string, versuch = 0): Promise<void> {
  const e = lesen()[boardId];
  if (!e || e.rolle !== 'bearbeiten') return;
  const lokal = useBoard.getState().boards.find((b) => b.id === boardId);
  if (!lokal) return;
  const basis = await idbGet<BoardDoc>(basisKey(boardId)).catch(() => undefined);
  const zuSchreiben = mitMassenVon(liveHaken.vor(lokal), basis);
  const text = kern(zuSchreiben);
  if (basis && text === kern(basis)) return;
  try {
    const v = await rpc<number | string>('gast_schreiben', { p_token: e.token, p_inhalt: text, p_stempel: stempel(text), p_wenn_version: e.version });
    const m = lesen();
    if (m[boardId]) { m[boardId] = { ...m[boardId], version: Number(v) }; schreiben(m); }
    await idbSet(basisKey(boardId), ohneAuswahl(zuSchreiben)).catch(() => {});
    kanaele.get(boardId)?.senden('stand', { v: Number(v) });
  } catch (f) {
    const art = f instanceof GastFehler ? f.art : 'netz';
    if (art === 'vorbedingung' && versuch < 3) { await holen(boardId); return; }
    if (art === 'keine-freigabe') { await holen(boardId); return; }   // Rolle geändert oder Link beendet — der Blick klärt es
    // Netz: der nächste Blick oder die nächste Änderung versucht es wieder
  }
}

const abgleichen = (boardId: string): Promise<void> => exklusiv(boardId, () => holen(boardId));
const schreibenBald = (boardId: string): void => {
  clearTimeout(schreibTimer.get(boardId));
  schreibTimer.set(boardId, setTimeout(() => void exklusiv(boardId, () => hinaus(boardId)), TIPP_PAUSE_MS));
};

/** Hat sich drüben etwas getan? (billiger Blick — nur Version und Rolle) */
async function blick(boardId: string): Promise<void> {
  const e = lesen()[boardId];
  if (!e) return;
  let s: { version: number; rolle: Rolle } | null;
  try { s = await rpc<{ version: number; rolle: Rolle } | null>('gast_stand', { p_token: e.token }); } catch { return; }
  if (!s) { beendet(boardId); return; }
  if (Number(s.version) !== e.version || s.rolle !== e.rolle) await abgleichen(boardId);
}

function gastBoardStarten(boardId: string, kanalName: string): void {
  kanalOeffnen(boardId, kanalName, () => void abgleichen(boardId));
}

// ---------- Mit Konto: Kanäle der geteilten Boards (Besitzer und Gäste mit Konto) ----------
interface EigenerLink { token: string; board_id: string; ohne_konto?: boolean; dateien?: GastDatei[] }
let eigeneLinks: EigenerLink[] = [];
const kontoKanal = new Map<string, string>();   // boardId → Besitzer (Kanäle, die über das Konto laufen)
let kontoLauf = 0;
/**
 * Für jedes geteilte Board des angemeldeten Kontos den Live-Kanal öffnen: eigene Boards mit Einladungslink oder
 * Freigabe, und Boards anderer, die für dieses Konto freigegeben sind. Den Kanalnamen gibt der Server nur dem,
 * der das Board lesen darf (board_kanal). Abgeglichen wird weiter über das Konto — der Kanal stößt nur früher an.
 */
export async function kontoKanaele(): Promise<void> {
  const s = loadKonto();
  if (s?.anbieter !== 'supabase' || !s.userId) {
    for (const id of kontoKanal.keys()) kanalSchliessen(id);
    kontoKanal.clear(); eigeneLinks = [];
    return;
  }
  kontoLauf += 1;
  const lauf = kontoLauf;
  const basisUrl = `${s.url ?? ''}/rest/v1`;
  const uid = encodeURIComponent(s.userId);
  try {
    const [rl, rf] = await Promise.all([
      kontoAnfrage(`${basisUrl}/board_einladungen?select=*&besitzer=eq.${uid}`, { cache: 'no-store' }),
      kontoAnfrage(`${basisUrl}/board_freigaben?select=board_id&besitzer=eq.${uid}`, { cache: 'no-store' }),
    ]);
    if (lauf !== kontoLauf) return;
    if (rl.ok) eigeneLinks = (await rl.json()) as EigenerLink[];
    const st = useBoard.getState();
    const eigen = (id: string): boolean => st.boards.some((b) => b.id === id && !b.geteiltVon);
    const ziel = new Map<string, string>();
    for (const l of eigeneLinks) if (eigen(l.board_id)) ziel.set(l.board_id, s.userId);
    if (rf.ok) for (const f of (await rf.json()) as Array<{ board_id: string }>) if (eigen(f.board_id)) ziel.set(f.board_id, s.userId);
    for (const b of st.boards) if (b.geteiltVon && !b.gastLink) ziel.set(b.id, b.geteiltVon);
    for (const id of [...kontoKanal.keys()]) if (ziel.get(id) !== kontoKanal.get(id)) { kanalSchliessen(id); kontoKanal.delete(id); }
    for (const [id, besitzer] of ziel) {
      if (kontoKanal.has(id) || kanaele.has(id)) continue;
      const res = await kontoAnfrage(`${basisUrl}/rpc/board_kanal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_besitzer: besitzer, p_board_id: id }) });
      if (lauf !== kontoLauf) return;
      if (!res.ok) continue;   // 404: Der Server kennt Live-Kanäle noch nicht — dann bleibt es beim Abgleich
      const antwort = (await res.json()) as { kanal?: unknown } | null;
      const name = antwort?.kanal;
      if (typeof name !== 'string' || !name || kanaele.has(id)) continue;
      kontoKanal.set(id, besitzer);
      kanalOeffnen(id, name, () => void checkKontoRemote(true).catch(() => null));
    }
    void anhaengeFreigeben();
  } catch { /* ohne Netz: beim nächsten Mal */ }
}
let kontoKanalTimer: ReturnType<typeof setTimeout> | undefined;
const kontoKanaeleBald = (): void => { clearTimeout(kontoKanalTimer); kontoKanalTimer = setTimeout(() => void kontoKanaele(), 600); };
/** Welche Boards sind (von mir aus gesehen) mit einem Konto geteilt? — ändert sich das, die Kanäle neu ordnen */
const geteiltKennung = (boards: BoardDoc[]): string => boards.filter((b) => b.geteiltVon && !b.gastLink).map((b) => `${b.id}:${b.geteiltVon}`).join('|');
/**
 * Anhänge (Dateien, die nicht im Board selbst stecken) für Gäste erreichbar machen: signierte Adressen der
 * schon im Konto liegenden Dateien, gemerkt am Link. Läuft nach jedem eigenen Schreiben — neue Dateien kommen so nach.
 */
async function anhaengeFreigeben(): Promise<void> {
  const s = loadKonto();
  if (s?.anbieter !== 'supabase' || !s.userId || eigeneLinks.length === 0) return;
  for (const l of eigeneLinks) {
    if (!l.ohne_konto) continue;   // Gäste mit Konto holen Anhänge nicht über den Link
    const board = useBoard.getState().boards.find((b) => b.id === l.board_id && !b.geteiltVon);
    if (!board) continue;
    const karten = board.nodes.filter((n) => n.type === 'file' && !n.archived && !(n.data as { dataUrl?: string }).dataUrl);
    const bekannt = new Set((l.dateien ?? []).map((d) => d.id));
    if (karten.length === bekannt.size && karten.every((n) => bekannt.has(n.id))) continue;
    const dateien: GastDatei[] = [];
    for (const n of karten) {
      const alt = (l.dateien ?? []).find((d) => d.id === n.id);
      if (alt) { dateien.push(alt); continue; }
      try {
        const pfad = `${encodeURIComponent(s.userId)}/${encodeURIComponent(`datei-${n.id}`)}`;
        const sig = await kontoAnfrage(`${s.url ?? ''}/storage/v1/object/sign/pixinotes/${pfad}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 10 * 365 * 24 * 3600 }) });
        if (!sig.ok) continue;   // liegt (noch) nicht im Konto — beim nächsten Schreiben wieder
        const j = (await sig.json()) as { signedURL?: string; signedUrl?: string };
        const relativ = j.signedURL ?? j.signedUrl ?? '';
        if (!relativ) continue;
        const d = n.data as { name?: string; mime?: string; size?: number };
        dateien.push({ id: n.id, name: d.name ?? 'Datei', mime: d.mime, groesse: d.size, url: /^https?:/.test(relativ) ? relativ : `${s.url ?? ''}/storage/v1${relativ.startsWith('/') ? '' : '/'}${relativ}` });
      } catch { /* diese Datei beim nächsten Mal */ }
    }
    if (JSON.stringify(dateien.map((d) => d.id)) === JSON.stringify((l.dateien ?? []).map((d) => d.id))) continue;
    try {
      const res = await kontoAnfrage(`${s.url ?? ''}/rest/v1/board_einladungen?token=eq.${encodeURIComponent(l.token)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ dateien }) });
      if (res.ok) l.dateien = dateien;
    } catch { /* beim nächsten Mal */ }
  }
}

// ---------- Einwählen ----------
export type GastErgebnis = { art: 'beigetreten' | 'vorhanden'; boardId: string; rolle: Rolle } | null;
/**
 * Mit einem Einladungslink ohne Konto einwählen. `null`: Dieser Link lässt keine Gäste ohne Konto zu (oder der
 * Server kennt das noch nicht) — dann bleibt der Weg über die Anmeldung.
 */
export async function gastBeitreten(token: string): Promise<GastErgebnis> {
  let g: Gelesen | null;
  try { g = await rpc<Gelesen | null>('gast_lesen', { p_token: token }); } catch (f) {
    if (f instanceof GastFehler && f.art === 'fehlt') return null;
    throw new Error('Die Einladung ließ sich nicht laden — Internetverbindung prüfen.');
  }
  if (!g?.inhalt) return null;
  let roh: BoardDoc;
  try { roh = JSON.parse(g.inhalt) as BoardDoc; } catch { throw new Error('Das geteilte Board ist beschädigt.'); }
  if (!roh?.id || !Array.isArray(roh.nodes)) throw new Error('Das geteilte Board ist beschädigt.');
  const st = useBoard.getState();
  let da = st.boards.find((b) => b.id === roh.id);
  let boardsVor = st.boards; let spacesVor = st.spaces; let aktiv = st.activeId;
  if (da && !da.gastLink) {
    if (!da.gastWar) {
      // Dasselbe Board liegt hier schon als eigenes (z. B. der Besitzer, gerade nicht angemeldet) — nichts überschreiben
      st.setView('board'); st.openBoard(roh.id);
      return { art: 'vorhanden', boardId: roh.id, rolle: g.rolle };
    }
    // Die Kopie aus einer früheren, beendeten Einwahl bleibt als eigenes Board daneben stehen
    const neuId = Math.random().toString(36).slice(2, 10);
    const { gastWar: _w, ...kopie } = da;
    boardsVor = st.boards.map((b) => (b.id === roh.id ? { ...kopie, id: neuId, name: `${da!.name} (Kopie)` } as BoardDoc : b));
    spacesVor = st.spaces.map((sp) => ({ ...sp, projects: sp.projects.map((p) => ({ ...p, boardIds: p.boardIds.map((id) => (id === roh.id ? neuId : id)) })) }));
    if (aktiv === roh.id) aktiv = neuId;
    da = undefined;
  }
  const board = gezeichnet(roh, g, token);
  const boards = da ? boardsVor.map((b) => (b.id === board.id ? mitMassenVon(board, da!) : b)) : [...boardsVor, board];
  const spaces: Space[] = mitGeteiltBereich(spacesVor, boards.filter((b) => b.geteiltVon));
  // Erst der Eintrag, dann das Board, beides sofort fest — wird die Seite genau jetzt geschlossen, passt es zusammen
  schreiben({ ...lesen(), [board.id]: { token, rolle: g.rolle, version: g.version, ...(g.kanal ? { kanal: g.kanal } : {}) } });
  ohneLeseschutz(() => st.importSync(boards, spaces, aktiv, { geaendert: [board.id] }));
  flushPersist();
  await idbSet(basisKey(board.id), board).catch(() => {});
  const s2 = useBoard.getState();
  s2.setView('board'); s2.openBoard(board.id);
  kanalSchliessen(board.id);
  gastBoardStarten(board.id, g.kanal ?? token);
  void dateienHolen(board, g.dateien);
  return { art: da ? 'vorhanden' : 'beigetreten', boardId: board.id, rolle: g.rolle };
}

/** Als Gast ein Board verlassen: Es bleibt als eigene Kopie */
export function gastVerlassen(boardId: string): void {
  const m = lesen();
  if (!m[boardId]) return;
  delete m[boardId];
  schreiben(m);
  kanalSchliessen(boardId);
  void idbDel(basisKey(boardId)).catch(() => {});
  ohneLeseschutz(() => useBoard.setState((s) => ({ boards: s.boards.map((b) => (b.id === boardId ? alsKopie(b) : b)) })));
  flushPersist();
}

/** Einmal beim App-Start: laufende Gast-Boards weiterführen, Besitzer-Kanäle öffnen */
export function initGastSync(): void {
  if (gestartet) return;
  gestartet = true;
  {
    // Selbstheilung: Ein Board, das als „per Link" markiert ist, aber keinen Eintrag (mehr) hat, bekommt ihn wieder —
    // der erste Abgleich holt Version, Rolle und Kanal. (Eintrag ohne solches Board: räumt der Abgleich weg.)
    const m = lesen(); let neu = false;
    for (const b of useBoard.getState().boards) {
      if (b.gastLink && !m[b.id]) { m[b.id] = { token: b.gastLink, rolle: b.geteiltRolle === 'lesen' ? 'lesen' : 'bearbeiten', version: -1 }; neu = true; }
    }
    if (neu) schreiben(m);
  }
  for (const [boardId, e] of Object.entries(lesen())) {
    if (e.kanal) gastBoardStarten(boardId, e.kanal);
    void abgleichen(boardId).then(() => { const k = lesen()[boardId]; if (k && !kanaele.has(boardId)) gastBoardStarten(boardId, k.kanal ?? k.token); });
  }
  // Änderungen an einem Gast-Board → nach kurzer Tipp-Pause hinaus
  useBoard.subscribe((s, prev) => {
    if (s.boards === prev.boards || liveEinspielung) return;
    const vorher = new Map(prev.boards.map((b) => [b.id, b]));
    // Meine gehaltene Karte hat sich geändert → live an alle im Kanal
    for (const [boardId, m] of meine) {
      const b = s.boards.find((x) => x.id === boardId);
      const a = vorher.get(boardId);
      if (!b || !a || b === a) continue;
      if (b.nodes.find((n) => n.id === m.karte) !== a.nodes.find((n) => n.id === m.karte)) karteSenden(boardId);
    }
    if (kanaele.size) anfassenPruefen();   // Ziehen beginnt/endet
    if (geteiltKennung(s.boards) !== geteiltKennung(prev.boards)) kontoKanaeleBald();
    // Eine mitgeschriebene Karte wurde hier anders ersetzt (Abgleich, eigene Bearbeitung) → ab jetzt gilt das
    for (const [boardId, l] of liveStaende) {
      if (l.size === 0) continue;
      const b = s.boards.find((x) => x.id === boardId);
      for (const [nodeId, live] of [...l]) {
        const n = b?.nodes.find((x) => x.id === nodeId);
        if (!n || !gleicherInhalt(n, live)) mitschriftVergessen(boardId, nodeId);
      }
    }
    const m = lesen();
    const ids = Object.keys(m);
    if (ids.length === 0) return;
    for (const id of ids) {
      const b = s.boards.find((x) => x.id === id);
      if (!b || b === vorher.get(id) || m[id].rolle !== 'bearbeiten') continue;
      letzteAenderung = Date.now();
      schreibenBald(id);
    }
  });
  // Schreib-Cursor wandert in eine Karte oder heraus → Sperre nehmen bzw. lösen
  document.addEventListener('focusin', anfassenPruefen, true);
  document.addEventListener('focusout', anfassenPruefen, true);
  // Regelmäßiger Blick (auch ohne Live-Kanal aktuell) — nur im sichtbaren Fenster
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    for (const id of Object.keys(lesen())) void blick(id);
    if (kontoKanal.size && !loadKonto()) void kontoKanaele();   // abgemeldet → Kanäle zu
  }, BLICK_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') for (const id of Object.keys(lesen())) void blick(id); });
  // Mit Konto: Kanäle der geteilten Boards; nach jedem eigenen Schreiben den anderen Bescheid geben
  void kontoKanaele();
  window.addEventListener('pixinotes:konto-verbunden', () => void kontoKanaele());
  window.addEventListener('pixinotes:konto-geschrieben', () => {
    for (const id of kontoKanal.keys()) kanaele.get(id)?.senden('stand', {});
    void anhaengeFreigeben();
  });
}
