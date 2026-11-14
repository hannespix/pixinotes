// M367: „Folgt mir" — wer vorführt, nimmt die anderen mit seiner Ansicht mit.
//
// Der Vorführende gibt über den Live-Kanal des Boards (lib/gastSync.ts) laufend bekannt, welchen Ausschnitt er
// sieht — in Board-Koordinaten, nicht in Bildschirmpunkten: Ein Telefon zeigt dann denselben Ausschnitt wie der
// Beamer, nur kleiner. Wer folgt, dessen Ansicht fährt mit; wer selbst schwenkt oder zoomt, löst sich (und kann
// mit einem Tipp wieder folgen). Es führt immer nur einer vor: Wer später beginnt, übernimmt.
//
// Über den Kanal läuft dabei nur die Ansicht. Inhalte ändern sich weiter ausschließlich über den Abgleich.
//
// M371: Zur Ansicht gehört mehr als der Ausschnitt des Boards:
//   · die Folien-Präsentation — welche Karte als Folie offen ist und welche Seite darin (PDF, Word);
//   · welche Tools (HTML-Karten) beim Vorführenden laufen — sie starten dann auch bei den Folgenden;
//   · wohin in einem eigenen Tool gerollt wurde. Das geht nur bei eigenen Tools: Deren Inhalt liefert PixiNotes
//     selbst aus und kann eine kleine Brücke hineinlegen (lib/htmlStore.ts). In eine fremde Webseite lässt der
//     Browser niemanden hineinsehen — sie öffnet sich bei allen, aber jeder rollt sie selbst.
import { ich, LIVE_NACHRICHT, liveSenden } from './gastSync';

export interface Sicht { x: number; y: number; w: number; h: number }
/** Stelle im Vortrag: die Karte, die als Folie offen ist, und die Seite darin */
export interface Vortrag { karte: string; seite: number }
/** Rollstand in einem Tool: `p` = Weg zum rollenden Element ('' = die Seite selbst), x/y = Anteil des Rollwegs (0…1) */
export interface Roll { p: string; x: number; y: number }
export interface Zeiger {
  id: string; name: string; farbe: string; seit: number; zuletzt: number; sicht: Sicht;
  vortrag: Vortrag | null;
  /** Karten-Ids der Tools, die beim Vorführenden laufen */
  apps: string[];
  /** letzter Rollstand je Tool (die Seite selbst) — für alle, die später dazukommen */
  rollen: Record<string, Roll>;
}
export const VORFUEHR_EREIGNIS = 'pixinotes:vorfuehren';
/** Ein Rollstand kam an: detail = { boardId, karte, roll } */
export const ROLL_EREIGNIS = 'pixinotes:zeig-roll';

const zeiger = new Map<string, Zeiger>();      // boardId → wer gerade vorführt (auch ich selbst)
const geloest = new Set<string>();             // Boards, auf denen ich mich vom Vorführenden gelöst habe
let meinBoard: string | null = null;
let meinSeit = 0;
let gesendet = ''; let gesendetAm = 0;
let meineSicht: Sicht = { x: 0, y: 0, w: 0, h: 0 };
let meinVortrag: Vortrag | null = null;
const meineApps = new Set<string>();
const meineRollen: Record<string, Roll> = {};
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
  zeiger.set(boardId, { id: t.id, name: t.name, farbe: t.farbe, seit: meinSeit, zuletzt: Date.now(), sicht: { x: 0, y: 0, w: 0, h: 0 }, vortrag: meinVortrag, apps: [...meineApps], rollen: { ...meineRollen } });
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
/** Den ganzen Stand senden — bei Änderung sofort, sonst alle 2,5 s als Lebenszeichen */
function standSenden(boardId: string, sofort = false): void {
  if (meinBoard !== boardId) return;
  const stand = { sicht: meineSicht, ...(meinVortrag ? { vortrag: meinVortrag } : {}), ...(meineApps.size ? { apps: [...meineApps] } : {}), ...(Object.keys(meineRollen).length ? { rollen: meineRollen } : {}) };
  const text = JSON.stringify(stand);
  const jetzt = Date.now();
  if (!sofort && text === gesendet && jetzt - gesendetAm < 2500) return;
  if (!(meineSicht.w > 0)) return;       // noch kein Ausschnitt gemessen
  gesendet = text; gesendetAm = jetzt;
  const t = ich();
  const z = zeiger.get(boardId);
  if (z) { z.sicht = meineSicht; z.zuletzt = jetzt; z.vortrag = meinVortrag; z.apps = [...meineApps]; z.rollen = { ...meineRollen }; }
  liveSenden(boardId, 'zeig', { von: t.id, name: t.name, farbe: t.farbe, seit: meinSeit, ...stand });
}
/** Der Vorführende meldet seinen Ausschnitt (das Bauteil ruft das im Takt) */
export function sichtMelden(boardId: string, sicht: Sicht): void {
  if (meinBoard !== boardId) return;
  meineSicht = { x: Math.round(sicht.x), y: Math.round(sicht.y), w: Math.round(sicht.w), h: Math.round(sicht.h) };
  standSenden(boardId);
}
/** Lebenszeichen ohne neuen Ausschnitt — in der Folien-Präsentation gibt es das Board nicht, die Vorführung läuft trotzdem weiter */
export function lebenszeichen(boardId: string): void { standSenden(boardId); }
/** Die Präsentation meldet ihre Stelle (null = beendet). Gemerkt wird sie immer — wer danach „Vorführen" drückt, nimmt sie mit. */
export function vortragMelden(boardId: string, v: Vortrag | null): void {
  if (JSON.stringify(v) === JSON.stringify(meinVortrag)) return;
  meinVortrag = v;
  if (meinBoard === boardId) { standSenden(boardId, true); melden(boardId); }
}
/** Ein Tool läuft / läuft nicht mehr */
export function appMelden(boardId: string, karte: string, an: boolean): void {
  if (an === meineApps.has(karte)) return;
  delete meineRollen[karte];     // frisch gestartet steht das Tool oben — ein Rollstand von vorhin gilt nicht mehr
  if (an) meineApps.add(karte); else meineApps.delete(karte);
  if (meinBoard === boardId) standSenden(boardId, true);
}
/** Das Tool wurde (neu) geladen oder geschlossen — sein Rollstand von vorhin gilt nicht mehr */
export function rollVergessen(boardId: string, karte: string): void {
  if (!(karte in meineRollen)) return;
  delete meineRollen[karte];
  if (meinBoard === boardId) standSenden(boardId, true);
}
const rollZeit = new Map<string, number>();
const rollWarte = new Map<string, ReturnType<typeof setTimeout>>();
/** Im Tool wurde gerollt — höchstens sieben Meldungen je Sekunde und Element, die letzte kommt immer an */
export function rollMelden(boardId: string, karte: string, roll: Roll): void {
  if (meinBoard !== boardId) return;
  if (roll.p === '') meineRollen[karte] = roll;
  const k = `${karte}|${roll.p}`;
  const senden = () => { rollZeit.set(k, Date.now()); rollWarte.delete(k); liveSenden(boardId, 'zeigRoll', { von: ich().id, karte, roll }); };
  clearTimeout(rollWarte.get(k));
  const warte = 140 - (Date.now() - (rollZeit.get(k) ?? 0));
  if (warte <= 0) senden(); else rollWarte.set(k, setTimeout(senden, warte));
}

function rollenAus(roh: unknown): Record<string, Roll> {
  const aus: Record<string, Roll> = {};
  if (!roh || typeof roh !== 'object') return aus;
  for (const [karte, r] of Object.entries(roh as Record<string, Partial<Roll>>).slice(0, 40)) {
    if (r && typeof r.x === 'number' && typeof r.y === 'number' && r.x >= 0 && r.x <= 1 && r.y >= 0 && r.y <= 1) aus[karte] = { p: '', x: r.x, y: r.y };
  }
  return aus;
}

let gestartet = false;
export function initVorfuehren(): void {
  if (gestartet) return;
  gestartet = true;
  window.addEventListener(LIVE_NACHRICHT, (e) => {
    const d = (e as CustomEvent<{ boardId: string; ereignis: string; inhalt: unknown }>).detail;
    if (d?.ereignis === 'zeigRoll') {
      const r = d.inhalt as { von?: unknown; karte?: unknown; roll?: Partial<Roll> } | undefined;
      const z = zeiger.get(d.boardId);
      const roll = r?.roll;
      if (!z || z.id !== r?.von || typeof r.karte !== 'string' || !roll || typeof roll.p !== 'string' || roll.p.length > 200) return;
      if (!(typeof roll.x === 'number' && roll.x >= 0 && roll.x <= 1 && typeof roll.y === 'number' && roll.y >= 0 && roll.y <= 1)) return;
      const sauber: Roll = { p: roll.p, x: roll.x, y: roll.y };
      if (sauber.p === '') z.rollen[r.karte] = sauber;
      if (folgeIch(d.boardId)) window.dispatchEvent(new CustomEvent(ROLL_EREIGNIS, { detail: { boardId: d.boardId, karte: r.karte, roll: sauber } }));
      return;
    }
    if (d?.ereignis !== 'zeig') return;
    const m = d.inhalt as { von?: unknown; name?: unknown; farbe?: unknown; seit?: unknown; ende?: unknown; sicht?: Partial<Sicht>; vortrag?: Partial<Vortrag>; apps?: unknown; rollen?: unknown } | undefined;
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
      vortrag: typeof m.vortrag?.karte === 'string' && typeof m.vortrag.seite === 'number' ? { karte: m.vortrag.karte, seite: m.vortrag.seite } : null,
      apps: Array.isArray(m.apps) ? m.apps.filter((a): a is string => typeof a === 'string').slice(0, 40) : [],
      rollen: rollenAus(m.rollen),
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
