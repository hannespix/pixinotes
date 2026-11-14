// M367: „Folgt mir" — wer vorführt, nimmt die anderen mit seiner Ansicht mit.
//
// Der Vorführende gibt über den Live-Kanal des Boards (lib/gastSync.ts) laufend bekannt, welchen Ausschnitt er
// sieht — in Board-Koordinaten, nicht in Bildschirmpunkten: Ein Telefon zeigt dann denselben Ausschnitt wie der
// Beamer, nur kleiner. Wer folgt, dessen Ansicht fährt mit; wer selbst schwenkt oder zoomt, löst sich (und kann
// mit einem Tipp wieder folgen). Es führt immer nur einer vor: Wer später beginnt, übernimmt.
//
// Über den Kanal läuft dabei nur die Ansicht. Inhalte ändern sich weiter ausschließlich über den Abgleich.
import { ich, LIVE_NACHRICHT, liveSenden } from './gastSync';

export interface Sicht { x: number; y: number; w: number; h: number }
export interface Zeiger { id: string; name: string; farbe: string; seit: number; zuletzt: number; sicht: Sicht }
export const VORFUEHR_EREIGNIS = 'pixinotes:vorfuehren';

const zeiger = new Map<string, Zeiger>();      // boardId → wer gerade vorführt (auch ich selbst)
const geloest = new Set<string>();             // Boards, auf denen ich mich vom Vorführenden gelöst habe
let meinBoard: string | null = null;
let meinSeit = 0;
let gesendet = ''; let gesendetAm = 0;
const melden = (boardId: string): void => { window.dispatchEvent(new CustomEvent(VORFUEHR_EREIGNIS, { detail: boardId })); };

export const werFuehrtVor = (boardId: string): Zeiger | null => zeiger.get(boardId) ?? null;
export const ichFuehreVor = (boardId: string): boolean => meinBoard === boardId;
export const folgeIch = (boardId: string): boolean => !!zeiger.get(boardId) && meinBoard !== boardId && !geloest.has(boardId);
export function folgenSetzen(boardId: string, an: boolean): void {
  if (an) geloest.delete(boardId); else geloest.add(boardId);
  melden(boardId);
}
export function vorfuehrenStart(boardId: string): void {
  if (meinBoard && meinBoard !== boardId) vorfuehrenStopp();
  meinBoard = boardId; meinSeit = Date.now(); gesendet = '';
  const t = ich();
  zeiger.set(boardId, { id: t.id, name: t.name, farbe: t.farbe, seit: meinSeit, zuletzt: Date.now(), sicht: { x: 0, y: 0, w: 0, h: 0 } });
  melden(boardId);
}
export function vorfuehrenStopp(): void {
  const b = meinBoard;
  if (!b) return;
  meinBoard = null;
  liveSenden(b, 'zeig', { von: ich().id, seit: meinSeit, ende: true });
  if (zeiger.get(b)?.id === ich().id) zeiger.delete(b);
  melden(b);
}
/** Der Vorführende meldet seinen Ausschnitt (das Bauteil ruft das im Takt) — gesendet wird bei Änderung, sonst alle 2,5 s */
export function sichtMelden(boardId: string, sicht: Sicht): void {
  if (meinBoard !== boardId) return;
  const s = { x: Math.round(sicht.x), y: Math.round(sicht.y), w: Math.round(sicht.w), h: Math.round(sicht.h) };
  const text = JSON.stringify(s);
  const jetzt = Date.now();
  if (text === gesendet && jetzt - gesendetAm < 2500) return;
  gesendet = text; gesendetAm = jetzt;
  const t = ich();
  const z = zeiger.get(boardId);
  if (z) { z.sicht = s; z.zuletzt = jetzt; }
  liveSenden(boardId, 'zeig', { von: t.id, name: t.name, farbe: t.farbe, seit: meinSeit, sicht: s });
}

let gestartet = false;
export function initVorfuehren(): void {
  if (gestartet) return;
  gestartet = true;
  window.addEventListener(LIVE_NACHRICHT, (e) => {
    const d = (e as CustomEvent<{ boardId: string; ereignis: string; inhalt: unknown }>).detail;
    if (d?.ereignis !== 'zeig') return;
    const m = d.inhalt as { von?: unknown; name?: unknown; farbe?: unknown; seit?: unknown; ende?: unknown; sicht?: Partial<Sicht> } | undefined;
    if (typeof m?.von !== 'string' || typeof m.seit !== 'number') return;
    const alt = zeiger.get(d.boardId);
    if (m.ende) {
      if (alt?.id === m.von) { zeiger.delete(d.boardId); geloest.delete(d.boardId); melden(d.boardId); }
      return;
    }
    const s = m.sicht;
    if (!s || ![s.x, s.y, s.w, s.h].every((v) => typeof v === 'number' && Number.isFinite(v)) || !(s.w! > 0) || !(s.h! > 0)) return;
    // Es führt der vor, der zuletzt begonnen hat
    if (alt && alt.id !== m.von && alt.seit > m.seit) return;
    if (meinBoard === d.boardId) {
      if (meinSeit > m.seit) return;        // ich habe später begonnen — der andere hört auf, sobald ihn meine Meldung erreicht
      meinBoard = null;                      // jemand hat übernommen
    }
    if (alt?.id !== m.von) geloest.delete(d.boardId);
    zeiger.set(d.boardId, {
      id: m.von, name: typeof m.name === 'string' ? m.name.slice(0, 40) : 'Jemand', farbe: typeof m.farbe === 'string' ? m.farbe : '#6b7280',
      seit: m.seit, zuletzt: Date.now(), sicht: { x: s.x!, y: s.y!, w: s.w!, h: s.h! },
    });
    melden(d.boardId);
  });
  // Meldet sich der Vorführende nicht mehr (Verbindung weg, Fenster zu), endet die Vorführung von selbst
  setInterval(() => {
    for (const [boardId, z] of zeiger) {
      if (z.id !== ich().id && Date.now() - z.zuletzt > 9000) { zeiger.delete(boardId); geloest.delete(boardId); melden(boardId); }
    }
  }, 3000);
}
