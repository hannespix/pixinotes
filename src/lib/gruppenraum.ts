// M376: Reaktionen und gemeinsamer Timer — was eine Gruppe im selben Raum braucht, ohne dass es Inhalt wird.
//
// Beides läuft nur über den Live-Kanal des Boards (lib/gastSync.ts) und wird nirgends gespeichert:
//   · Reaktionen: Ein Symbol steigt bei allen kurz auf, mit dem Namen der Person. Für Zustimmung, Applaus,
//     „ich habe eine Frage" — auch in der Folien-Präsentation, wo der Vortragende sein Publikum sonst nicht sieht.
//   · Timer: Einer stellt die Uhr, alle sehen sie ablaufen. Verschickt wird die RESTZEIT, nicht die Uhrzeit des
//     Endes — die Uhren der Geräte gehen nicht gleich. Wer später dazukommt, bekommt sie mit der nächsten
//     Meldung (der Starter wiederholt sie alle drei Sekunden).
import { ich, ichIn, LIVE_NACHRICHT, liveSenden, teilnehmerVon } from './liveStand';

// ---------- Reaktionen ----------
export const REAKTIONEN = ['👍', '❤️', '👏', '😂', '🎉', '🤔', '✋', '✅'] as const;
export const REAKTION_EREIGNIS = 'pixinotes:reaktion';
export interface Reaktion { boardId: string; zeichen: string; name: string; farbe: string; ich: boolean }
const zeiten: number[] = [];
/** Reagieren: sofort bei mir, dann bei allen. Höchstens sechs in zwei Sekunden — kein Dauerfeuer. */
export function reagieren(boardId: string, zeichen: string): boolean {
  if (!(REAKTIONEN as readonly string[]).includes(zeichen)) return false;
  const jetzt = Date.now();
  while (zeiten.length && jetzt - zeiten[0] > 2000) zeiten.shift();
  if (zeiten.length >= 6) return false;
  zeiten.push(jetzt);
  const t = ichIn(boardId);
  window.dispatchEvent(new CustomEvent<Reaktion>(REAKTION_EREIGNIS, { detail: { boardId, zeichen, name: t.name, farbe: t.farbe, ich: true } }));
  liveSenden(boardId, 'reakt', { v: t.id, e: zeichen });
  return true;
}

// ---------- Timer ----------
export interface GruppenTimer {
  /** Kennung dieses Laufs: Startzeit beim Starter — der spätere Start gilt */
  lauf: number;
  /** Ende nach der Uhr DIESES Geräts */
  ende: number;
  dauer: number;
  von: string; name: string;
}
export const TIMER_EREIGNIS = 'pixinotes:gruppen-timer';
const timer = new Map<string, GruppenTimer>();
/** zuletzt beendete Läufe — eine verspätete Meldung des alten Laufs startet ihn nicht neu */
const beendet = new Map<string, number>();
let wiederholen: ReturnType<typeof setInterval> | null = null;
const melden = (boardId: string): void => { sichern(); window.dispatchEvent(new CustomEvent(TIMER_EREIGNIS, { detail: boardId })); };

/**
 * M531: Der Starter behält seinen Timer über ein Neuladen. Gemerkt wird das ENDE (nach der Uhr dieses Geräts), nicht
 * die Restzeit — nach dem Laden läuft die Uhr weiter, wo sie stehen müsste, oder ist abgelaufen. Nur im Speicher des
 * Tabs (sessionStorage): ein anderes Fenster startet keinen zweiten Sender. Bei den anderen ändert sich nichts — sie
 * bekommen die Restzeit weiter alle drei Sekunden (gleicher Lauf, gleiche Kennung des Starters).
 */
const TIMER_KEY = 'pixinotes-gruppen-timer';
/** So lange nach dem Ende bringt ein Neuladen noch „Zeit ist um" — später ist der Timer einfach vorbei */
const NACHLAUF_MS = 8000;
function sichern(): void {
  const meine: Record<string, Omit<GruppenTimer, 'von'>> = {};
  for (const [b, t] of timer) if (t.von === ich().id) meine[b] = { lauf: t.lauf, ende: t.ende, dauer: t.dauer, name: t.name };
  try { if (Object.keys(meine).length) sessionStorage.setItem(TIMER_KEY, JSON.stringify(meine)); else sessionStorage.removeItem(TIMER_KEY); } catch { /* privat/voll: dann eben nicht */ }
}
function zurueckholen(): void {
  let roh: unknown;
  try { roh = JSON.parse(sessionStorage.getItem(TIMER_KEY) ?? 'null'); } catch { return; }
  if (!roh || typeof roh !== 'object') return;
  const jetzt = Date.now();
  const mich = ich();
  for (const [b, t] of Object.entries(roh as Record<string, Partial<GruppenTimer>>)) {
    if (!t || typeof t.lauf !== 'number' || typeof t.ende !== 'number' || typeof t.dauer !== 'number') continue;
    if (t.ende < jetzt - NACHLAUF_MS || t.ende - jetzt > TIMER_MAX_MS + 60_000) continue;   // längst vorbei oder unsinnig
    if (!timer.has(b)) timer.set(b, { lauf: t.lauf, ende: t.ende, dauer: Math.min(TIMER_MAX_MS, Math.max(t.dauer, 0)), von: mich.id, name: mich.name });
  }
  sichern();
  takten();
  for (const b of timer.keys()) melden(b);
}
export const timerVon = (boardId: string): GruppenTimer | null => timer.get(boardId) ?? null;
/** Restzeit in Millisekunden (nie negativ) */
export const timerRest = (t: GruppenTimer | null): number => (t ? Math.max(0, t.ende - Date.now()) : 0);
/** M512: Spanne eines Laufs — frei einstellbar von zehn Sekunden bis zwölf Stunden (vorher fest 1 bis 15 Minuten) */
export const TIMER_MIN_MS = 10_000;
export const TIMER_MAX_MS = 12 * 3_600_000;
/** „4:05", ab einer Stunde „1:29:59" (M512) */
export const timerText = (ms: number): string => {
  const s = Math.ceil(ms / 1000);
  const zwei = (n: number) => String(n).padStart(2, '0');
  if (s >= 3600) return `${Math.floor(s / 3600)}:${zwei(Math.floor(s / 60) % 60)}:${zwei(s % 60)}`;
  return `${Math.floor(s / 60)}:${zwei(s % 60)}`;
};

function senden(boardId: string): void {
  const t = timer.get(boardId);
  if (!t || t.von !== ich().id) return;
  liveSenden(boardId, 'timer', { v: t.von, lauf: t.lauf, rest: timerRest(t), dauer: t.dauer });
}
function takten(): void {
  const meine = [...timer.entries()].filter(([, t]) => t.von === ich().id);
  if (meine.length && !wiederholen) wiederholen = setInterval(() => { for (const [b] of timer) senden(b); }, 3000);
  if (!meine.length && wiederholen) { clearInterval(wiederholen); wiederholen = null; }
}
export function timerStart(boardId: string, minuten: number): void { timerStartMs(boardId, minuten * 60_000); }
/** M512: Start mit beliebiger Dauer in Millisekunden — auf die erlaubte Spanne begrenzt */
export function timerStartMs(boardId: string, ms: number): void {
  if (!Number.isFinite(ms)) return;
  const dauer = Math.round(Math.min(TIMER_MAX_MS, Math.max(TIMER_MIN_MS, ms)));
  const t = ich();
  timer.set(boardId, { lauf: Date.now(), ende: Date.now() + dauer, dauer, von: t.id, name: t.name });
  senden(boardId); takten(); melden(boardId);
}
/** Anhalten darf jeder — die Uhr gehört der Gruppe */
export function timerStopp(boardId: string): void {
  const t = timer.get(boardId);
  if (!t) return;
  timer.delete(boardId); beendet.set(boardId, t.lauf);
  liveSenden(boardId, 'timer', { v: ich().id, lauf: t.lauf, rest: 0, stopp: 1 });
  takten(); melden(boardId);
}
/** Die Anzeige räumt einen abgelaufenen Timer nach der Schlussmeldung weg */
export function timerVergessen(boardId: string, lauf: number): void {
  const t = timer.get(boardId);
  if (!t || t.lauf !== lauf) return;
  timer.delete(boardId); beendet.set(boardId, lauf);
  takten(); melden(boardId);
}

let gestartet = false;
export function initGruppenraum(): void {
  if (gestartet) return;
  gestartet = true;
  zurueckholen();
  window.addEventListener(LIVE_NACHRICHT, (e) => {
    const d = (e as CustomEvent<{ boardId: string; ereignis: string; inhalt: unknown }>).detail;
    if (d?.ereignis === 'reakt') {
      const m = d.inhalt as { v?: unknown; e?: unknown } | undefined;
      if (typeof m?.v !== 'string' || typeof m.e !== 'string' || !(REAKTIONEN as readonly string[]).includes(m.e)) return;
      const wer = teilnehmerVon(d.boardId).find((t) => t.id === m.v);
      if (!wer || wer.id === ich().id) return;
      window.dispatchEvent(new CustomEvent<Reaktion>(REAKTION_EREIGNIS, { detail: { boardId: d.boardId, zeichen: m.e, name: wer.name, farbe: wer.farbe, ich: false } }));
      return;
    }
    if (d?.ereignis !== 'timer') return;
    const m = d.inhalt as { v?: unknown; lauf?: unknown; rest?: unknown; dauer?: unknown; stopp?: unknown } | undefined;
    if (typeof m?.v !== 'string' || typeof m.lauf !== 'number' || typeof m.rest !== 'number' || !Number.isFinite(m.rest)) return;
    const wer = teilnehmerVon(d.boardId).find((t) => t.id === m.v);
    if (!wer) return;
    const alt = timer.get(d.boardId);
    if (m.stopp) {
      if (alt && alt.lauf === m.lauf) { timer.delete(d.boardId); beendet.set(d.boardId, alt.lauf); takten(); melden(d.boardId); }
      return;
    }
    // M512: bis zwölf Stunden (plus eine Minute Spiel für abweichende Uhren); ältere Fassungen nahmen nur bis 121 Minuten an
    if (m.rest <= 0 || m.rest > TIMER_MAX_MS + 60_000) return;
    if (beendet.get(d.boardId) === m.lauf) return;
    if (alt && alt.lauf > m.lauf) return;             // der spätere Start gilt
    const dauer = typeof m.dauer === 'number' && m.dauer >= m.rest && m.dauer <= TIMER_MAX_MS + 60_000 ? m.dauer : m.rest;
    const ende = Date.now() + m.rest;
    // derselbe Lauf: nur nachstellen, wenn die Uhr merklich abweicht (sonst zittert die Anzeige)
    if (alt && alt.lauf === m.lauf && Math.abs(alt.ende - ende) < 1500) return;
    timer.set(d.boardId, { lauf: m.lauf, ende, dauer, von: m.v, name: wer.name });
    takten(); melden(d.boardId);
  });
}
