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
import { ich, LIVE_NACHRICHT, liveSenden, liveVerbunden, TEILNEHMER_EREIGNIS, teilnehmerVon } from './gastSync';

export interface FernZeiger {
  id: string; name: string; farbe: string;
  /** Board-Koordinaten — auf einer Folie (folie ≠ '') Anteile der Folie, 0…1 */
  x: number; y: number;
  laser: boolean;
  /** '' = auf dem Board; sonst die Karte, die als Folie offen ist */
  folie: string;
  zuletzt: number;
  /** Zeit seit der vorigen Meldung (ms) — so lange gleitet die Anzeige */
  gleiten: number;
}
export const ZEIGER_EREIGNIS = 'pixinotes:mauszeiger';
const KEY = 'pixinotes-mauszeiger';
const HALTEN = 12000;        // so lange bleibt ein Zeiger ohne neue Meldung stehen
const HALTEN_LASER = 2500;

/** Zeiger der anderen zeigen und den eigenen senden? (je Gerät; der Laser beim Vorführen gilt immer) */
export const zeigerAn = (): boolean => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };

const alle = new Map<string, Map<string, FernZeiger>>();     // boardId → Teilnehmer → Zeiger
const melden = (boardId: string): void => { window.dispatchEvent(new CustomEvent(ZEIGER_EREIGNIS, { detail: boardId })); };
export const zeigerVon = (boardId: string): FernZeiger[] => [...(alle.get(boardId)?.values() ?? [])];

/**
 * Abstand zwischen zwei Meldungen (ms). Zu zweit flüssig (90 ms), mit jedem weiteren etwas seltener, ab etwa
 * fünfzig Leuten höchstens alle 0,7 s — zusammen sind das dann rund siebzig Meldungen je Sekunde im ganzen
 * Board statt mehrerer hundert. Der Laser des Vorführenden ist einer und darf schnell sein.
 */
export const zeigerTakt = (anzahl: number, laser = false): number => (laser ? 70 : Math.max(90, Math.min(700, Math.round(anzahl * 14))));

// ---------- senden ----------
interface Meldung { x: number; y: number; laser: boolean; folie: string }
let gesendetAm = 0;
let gesendetAuf: string | null = null;      // Board, auf dem mein Zeiger gerade zu sehen ist
let wartet: { boardId: string; m: Meldung; timer: ReturnType<typeof setTimeout> } | null = null;
let stillTimer: ReturnType<typeof setTimeout> | null = null;

function hinaus(boardId: string, m: Meldung): void {
  gesendetAm = Date.now(); gesendetAuf = boardId;
  liveSenden(boardId, 'maus', { v: ich().id, x: m.x, y: m.y, ...(m.laser ? { l: 1 } : {}), ...(m.folie ? { f: m.folie } : {}) });
  // Wer stillhält, verschwindet bei den anderen von selbst — das Abmelden hier spart ihnen das Warten
  if (stillTimer) clearTimeout(stillTimer);
  stillTimer = setTimeout(() => zeigerWeg(boardId), m.laser ? HALTEN_LASER - 400 : HALTEN - 800);
}
/** Meine Stelle melden — gedrosselt nach Gruppengröße; die letzte Stelle kommt immer an */
export function zeigerMelden(boardId: string, x: number, y: number, opt: { laser?: boolean; folie?: string } = {}): void {
  const laser = !!opt.laser;
  if (!laser && !zeigerAn()) return;
  if (!liveVerbunden(boardId)) return;
  const anzahl = teilnehmerVon(boardId).length;
  if (anzahl < 2) return;           // allein im Board: niemand, der zusieht
  const folie = opt.folie ?? '';
  const m: Meldung = folie
    ? { x: Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000, y: Math.round(Math.min(1, Math.max(0, y)) * 10000) / 10000, laser, folie }
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

// ---------- empfangen ----------
let gestartet = false;
export function initMauszeiger(): void {
  if (gestartet) return;
  gestartet = true;
  window.addEventListener(LIVE_NACHRICHT, (e) => {
    const d = (e as CustomEvent<{ boardId: string; ereignis: string; inhalt: unknown }>).detail;
    if (d?.ereignis !== 'maus') return;
    const m = d.inhalt as { v?: unknown; x?: unknown; y?: unknown; l?: unknown; f?: unknown; weg?: unknown } | undefined;
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
    tafel.set(m.v, {
      id: m.v, name: wer.name, farbe: wer.farbe, x: m.x, y: m.y, laser, folie, zuletzt: jetzt,
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
