// M375: Live-Mauszeiger und Laserpointer.
//
// In einem gemeinsamen Board sieht jeder, wo die anderen gerade sind: ein kleiner Zeiger in der Farbe der
// Person, mit ihrem Namen. Wer vorführt („Folgt mir"), zeigt statt des Zeigers einen Laserpunkt — auf dem
// Board und in der Folien-Präsentation.
//
// Über den Live-Kanal läuft dafür nur die Stelle (Board-Koordinaten, auf Folien als Anteil der Folie), nie
// Inhalt. Name und Farbe kennt jeder schon aus der Anwesenheitsliste — sie reisen nicht mit.
//
// Für große Gruppen: Je mehr Leute im Board sind, desto seltener meldet jeder seine Stelle (zeigerTakt) —
// die Summe aller Meldungen bleibt klein, egal ob zu zweit oder zu sechzigst. Die Anzeige gleitet zwischen
// zwei Meldungen, darum wirkt auch ein langsamer Takt ruhig. Wer stillhält, sendet nichts.
//
// M414: Supabase zählt jede Nachricht einmal beim Absender und einmal je Empfänger, und im freien Tarif sind
// es höchstens 100 je Sekunde im ganzen Projekt – darüber trennt der Server die Leitung, und bei allen steht
// alles (auch die Präsentation). Der Takt rechnet darum mit den Empfängern (zeigerTakt). Der Laser bleibt beim
// Stillhalten stehen: Solange er an ist, meldet er sich gut jede Sekunde neu (vorher verschwand er bei den
// anderen nach zwei Sekunden Stillstand, beim Vorführenden blieb er stehen). Und auf einer Folie hängt er am
// Inhalt unter dem Zeiger (`anker`): Auf einem Telefon liegt eine PDF-Seite anders in der Folie als am Beamer.
import { ich, LIVE_NACHRICHT, liveSenden, liveVerbunden, TEILNEHMER_EREIGNIS, teilnehmerVon } from './gastSync';

export interface FernZeiger {
  id: string; name: string; farbe: string;
  /** Board-Koordinaten — auf einer Folie (folie ≠ '') Anteile der Folie, 0…1 */
  x: number; y: number;
  laser: boolean;
  /** '' = auf dem Board; sonst die Karte, die als Folie offen ist */
  folie: string;
  /** M414: Auf einer Folie: das Element unter dem Laser (Weg ab der Folie oder „@kennung") und die Stelle darin (0…1);
   *  in einem eigenen Tool dazu hinter „~" der Weg im Tool (ab dessen <body>; leer = die Seite selbst) */
  anker?: Anker;
  zuletzt: number;
  /** Zeit seit der vorigen Meldung (ms) — so lange gleitet die Anzeige */
  gleiten: number;
}
export interface Anker { p: string; x: number; y: number }
export const ZEIGER_EREIGNIS = 'pixinotes:mauszeiger';
const KEY = 'pixinotes-mauszeiger';
const HALTEN = 12000;        // so lange bleibt ein Zeiger ohne neue Meldung stehen
const HALTEN_LASER = 4000;
/** M414: So oft meldet sich ein stillstehender Laser neu */
const NACHHALL = 1500;

/** Zeiger der anderen zeigen und den eigenen senden? (je Gerät; der Laser beim Vorführen gilt immer) */
export const zeigerAn = (): boolean => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };

const alle = new Map<string, Map<string, FernZeiger>>();     // boardId → Teilnehmer → Zeiger
const melden = (boardId: string): void => { window.dispatchEvent(new CustomEvent(ZEIGER_EREIGNIS, { detail: boardId })); };
export const zeigerVon = (boardId: string): FernZeiger[] => [...(alle.get(boardId)?.values() ?? [])];

/**
 * Abstand zwischen zwei Meldungen (ms). Jede Meldung zählt beim Server einmal je Teilnehmer (M414).
 *  · Zeiger: Bewegen sich alle zugleich, sind das anzahl × anzahl × 1000/Takt Nachrichten je Sekunde – mit
 *    20 × anzahl² ms bleiben es rund fünfzig. Zu zweit flüssig (90 ms), zu fünft alle 0,5 s, ab zehn alle 2 s.
 *  · Laser: nur einer sendet — rund 24 Nachrichten je Sekunde: zu zweit alle 90 ms, zu sechst alle 0,25 s,
 *    ab 24 Leuten einmal je Sekunde. Die Anzeige gleitet dazwischen.
 */
export const zeigerTakt = (anzahl: number, laser = false): number => (laser
  ? Math.max(90, Math.min(1000, Math.round((1000 * anzahl) / 24)))
  : Math.max(90, Math.min(2000, Math.round(20 * anzahl * anzahl))));

// ---------- senden ----------
interface Meldung { x: number; y: number; laser: boolean; folie: string; anker?: Anker }
let gesendetAm = 0;
let gesendetAuf: string | null = null;      // Board, auf dem mein Zeiger gerade zu sehen ist
let wartet: { boardId: string; m: Meldung; timer: ReturnType<typeof setTimeout> } | null = null;
let stillTimer: ReturnType<typeof setTimeout> | null = null;

function hinaus(boardId: string, m: Meldung): void {
  gesendetAm = Date.now(); gesendetAuf = boardId;
  liveSenden(boardId, 'maus', { v: ich().id, x: m.x, y: m.y, ...(m.laser ? { l: 1 } : {}), ...(m.folie ? { f: m.folie } : {}), ...(m.anker ? { a: m.anker } : {}) });
  if (stillTimer) clearTimeout(stillTimer);
  // M414: Ein Laser steht, solange er an ist — er meldet sich still neu (zeigerWeg beendet das). Ein Zeiger, der
  // stillhält, verschwindet bei den anderen von selbst; das Abmelden hier spart ihnen das Warten.
  stillTimer = m.laser
    ? setTimeout(() => { if (gesendetAuf === boardId && liveVerbunden(boardId)) hinaus(boardId, m); }, NACHHALL)
    : setTimeout(() => zeigerWeg(boardId), HALTEN - 800);
}
/** Meine Stelle melden — gedrosselt nach Gruppengröße; die letzte Stelle kommt immer an */
export function zeigerMelden(boardId: string, x: number, y: number, opt: { laser?: boolean; folie?: string; anker?: Anker | null } = {}): void {
  const laser = !!opt.laser;
  if (!laser && !zeigerAn()) return;
  if (!liveVerbunden(boardId)) return;
  const anzahl = teilnehmerVon(boardId).length;
  if (anzahl < 2) return;           // allein im Board: niemand, der zusieht
  const folie = opt.folie ?? '';
  const anteil = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
  const a = folie && opt.anker ? ankerAus(opt.anker) : null;
  const m: Meldung = folie
    ? { x: anteil(x), y: anteil(y), laser, folie, ...(a ? { anker: { p: a.p, x: anteil(a.x), y: anteil(a.y) } } : {}) }
    : { x: Math.round(x), y: Math.round(y), laser, folie };
  if (wartet) { clearTimeout(wartet.timer); wartet = null; }
  const rest = zeigerTakt(anzahl, laser) - (Date.now() - gesendetAm);
  if (rest <= 0) hinaus(boardId, m);
  else wartet = { boardId, m, timer: setTimeout(() => { const w = wartet; wartet = null; if (w) hinaus(w.boardId, w.m); }, rest) };
}
/** Mein Zeiger ist weg (Maus hat das Board verlassen, Laser aus, Fenster zu) */
export function zeigerWeg(boardId?: string): void {
  if (wartet) { clearTimeout(wartet.timer); wartet = null; }
  if (stillTimer) { clearTimeout(stillTimer); stillTimer = null; }
  const b = boardId ?? gesendetAuf;
  if (!b || gesendetAuf !== b) return;
  gesendetAuf = null;
  liveSenden(b, 'maus', { v: ich().id, weg: 1 });
}
export function zeigerSetzen(an: boolean): void {
  try { localStorage.setItem(KEY, an ? '1' : '0'); } catch { /* privat */ }
  if (!an) {
    zeigerWeg();
    // die Zeiger der anderen verschwinden — ein Laser bleibt (er gehört zur Vorführung)
    for (const [boardId, m] of alle) {
      for (const [id, z] of m) if (!z.laser) m.delete(id);
      melden(boardId);
    }
  }
  window.dispatchEvent(new CustomEvent(ZEIGER_EREIGNIS, { detail: '' }));
}

/** Ein Anker aus fremder Hand: ein kurzer Weg (Ziffern und Punkte) oder eine Kennung, Stelle 0…1 */
function ankerAus(roh: unknown): Anker | null {
  const a = roh as Partial<Anker> | null;
  if (!a || typeof a !== 'object' || typeof a.p !== 'string' || !/^(@[a-z0-9-]{1,40}|\d{1,4}(\.\d{1,4}){0,39})(~(\d{1,4}(\.\d{1,4}){0,39})?)?$/.test(a.p)) return null;
  if (typeof a.x !== 'number' || typeof a.y !== 'number' || !(a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1)) return null;
  return { p: a.p, x: a.x, y: a.y };
}

// ---------- empfangen ----------
let gestartet = false;
export function initMauszeiger(): void {
  if (gestartet) return;
  gestartet = true;
  window.addEventListener(LIVE_NACHRICHT, (e) => {
    const d = (e as CustomEvent<{ boardId: string; ereignis: string; inhalt: unknown }>).detail;
    if (d?.ereignis !== 'maus') return;
    const m = d.inhalt as { v?: unknown; x?: unknown; y?: unknown; l?: unknown; f?: unknown; a?: unknown; weg?: unknown } | undefined;
    if (typeof m?.v !== 'string' || !m.v || m.v.length > 60 || m.v === ich().id) return;
    let tafel = alle.get(d.boardId);
    if (m.weg) {
      if (tafel?.delete(m.v)) melden(d.boardId);
      return;
    }
    if (typeof m.x !== 'number' || typeof m.y !== 'number' || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    const laser = m.l === 1;
    if (!laser && !zeigerAn()) return;
    const folie = typeof m.f === 'string' ? m.f.slice(0, 80) : '';
    if (folie && (m.x < 0 || m.x > 1 || m.y < 0 || m.y > 1)) return;
    // Name und Farbe aus der Anwesenheitsliste — wer dort nicht steht, hat hier keinen Zeiger
    const wer = teilnehmerVon(d.boardId).find((t) => t.id === m.v);
    if (!wer) return;
    if (!tafel) { tafel = new Map(); alle.set(d.boardId, tafel); }
    const alt = tafel.get(m.v);
    const jetzt = Date.now();
    const anker = folie ? ankerAus(m.a) : null;
    // M414: Ein stiller Laser meldet sich nur neu — dieselbe Stelle, kein neues Bild
    if (alt && alt.x === m.x && alt.y === m.y && alt.laser === laser && alt.folie === folie && JSON.stringify(alt.anker ?? null) === JSON.stringify(anker)) { alt.zuletzt = jetzt; return; }
    tafel.set(m.v, {
      id: m.v, name: wer.name, farbe: wer.farbe, x: m.x, y: m.y, laser, folie, zuletzt: jetzt, ...(anker ? { anker } : {}),
      // gleiten, solange die Meldungen dicht aufeinander folgen; nach einer Pause oder einem Ortswechsel springt der Zeiger
      gleiten: alt && alt.folie === folie && jetzt - alt.zuletzt < 1200 ? Math.max(60, Math.min(760, jetzt - alt.zuletzt)) : 0,
    });
    melden(d.boardId);
  });
  // Wer geht, nimmt seinen Zeiger mit
  window.addEventListener(TEILNEHMER_EREIGNIS, (e) => {
    const boardId = (e as CustomEvent<string>).detail;
    const tafel = alle.get(boardId);
    if (!tafel?.size) return;
    const da = new Set(teilnehmerVon(boardId).map((t) => t.id));
    let geaendert = false;
    for (const id of tafel.keys()) if (!da.has(id)) { tafel.delete(id); geaendert = true; }
    if (geaendert) melden(boardId);
  });
  // Meldet sich jemand nicht mehr, verblasst sein Zeiger
  setInterval(() => {
    const jetzt = Date.now();
    for (const [boardId, tafel] of alle) {
      let geaendert = false;
      for (const [id, z] of tafel) if (jetzt - z.zuletzt > (z.laser ? HALTEN_LASER : HALTEN)) { tafel.delete(id); geaendert = true; }
      if (geaendert) melden(boardId);
    }
  }, 1000);
  window.addEventListener('pagehide', () => zeigerWeg());
}
