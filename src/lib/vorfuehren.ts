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
//
// M384: … und was der Vorführende in ein eigenes Tool eingibt: Feldwerte (Text, Häkchen, Auswahl), Klicks auf
// Knöpfe, Enter und das Abschicken eines Formulars. Bei den Folgenden geschieht im selben Tool dasselbe. Was ein
// Tool daraus macht, rechnet es selbst — Zufall, Zeitabläufe, Ziehen mit der Maus und Zeichenflächen lassen
// sich so nicht nachstellen.
//
// M387: Die Präsentation nimmt das Publikum von selbst mit — wer sie auf seinem eigenen Board startet, während
// andere dabei sind, führt damit vor (abwählbar, die Wahl bleibt gemerkt). Und zur Ansicht gehört jetzt auch:
//   · der Ausschnitt in einer Folie: ganze Seite oder Seitenbreite, Zoom und Rollstand (PDF, Word, Bild, lange Folien);
//   · die Karte, die der Vorführende auf dem Board im Fokus hat;
//   · welche Dokument-Karten auf dem Board aufgeklappt sind und welche Seite darin offen liegt.
//
// M414: Eigene Tools werden gespiegelt (lib/spiegel.ts): Die Zuschauer sehen ein Abbild dessen, was beim
// Vorführenden im Tool steht — vorher rechnete jedes Gerät das Tool selbst, mit seinem eigenen Speicherstand,
// eigenem Zufall und eigener Zeit; nachgestellt wurden nur Eingaben. Das Spiegeln lädt erst nach, wenn es gebraucht wird.
import { ich, ichIn, LIVE_NACHRICHT, liveSenden, teilnehmerVon } from './gastSync';

export interface Sicht { x: number; y: number; w: number; h: number }
/** Stelle im Vortrag: die Karte, die als Folie offen ist, und die Seite darin */
export interface Vortrag { karte: string; seite: number; ansicht?: Ansicht }
/**
 * M387: Ausschnitt in einer Folie. `m` = ganze Seite oder Seitenbreite und `z` = Zoom (nur Dokumente),
 * x/y = Rollstand als Anteil des Rollwegs (0…1) — so passt er auf jedem Schirm.
 * M403: `a` = Darstellung gewöhnlicher Folien und `d` = Zoom als Vielfaches ihrer Ausgangsstufe (1 = wie gewählt).
 */
export interface Ansicht { m?: 'seite' | 'breite'; z?: number; x: number; y: number; a?: 'standard' | 'einpassen' | 'breite'; d?: number }
/** Rollstand in einem Tool: `p` = Weg zum rollenden Element ('' = die Seite selbst), x/y = Anteil des Rollwegs (0…1) */
export interface Roll { p: string; x: number; y: number }
export interface Zeiger {
  id: string; name: string; farbe: string; seit: number; zuletzt: number; sicht: Sicht;
  vortrag: Vortrag | null;
  /** Karten-Ids der Tools, die beim Vorführenden laufen */
  apps: string[];
  /** letzter Rollstand je Tool (die Seite selbst) — für alle, die später dazukommen */
  rollen: Record<string, Roll>;
  /** M387: Karte, die der Vorführende auf dem Board im Fokus hat */
  fokus: string | null;
  /** M387: aufgeklappte Dokument-Karten auf dem Board → offene Seite */
  dok: Record<string, number>;
}
/**
 * M384: Eine Eingabe in einem Tool. `p` = Ort des Elements („#kennung" oder Weg von <body> aus), `a` = was geschah.
 * Felder tragen ihren Wert absolut (`w`): Text `v`, Häkchen `c`, Mehrfachauswahl `m`, frei beschreibbarer Bereich `t`
 * (nur Text, nie HTML). Klicks tragen die Stelle im Element als Anteil (x/y).
 */
export interface Eingabe {
  p: string; a: 'input' | 'change' | 'click' | 'submit' | 'taste';
  w?: { v?: string; c?: boolean; m?: number[]; t?: string };
  x?: number; y?: number;
}
const EINGABE_ARTEN = ['input', 'change', 'click', 'submit', 'taste'];
const WERT_MAX = 4000;
/** Eingaben kommen aus dem Tool oder aus dem Kanal — beides fremde Angaben: nur Sauberes geht weiter */
export function eingabeAus(roh: unknown): Eingabe | null {
  const r = roh as Partial<Eingabe> | null;
  if (!r || typeof r !== 'object' || typeof r.p !== 'string' || !r.p || r.p.length > 200 || !EINGABE_ARTEN.includes(r.a as string)) return null;
  const aus: Eingabe = { p: r.p, a: r.a as Eingabe['a'] };
  if (aus.a === 'input' || aus.a === 'change') {
    const w = r.w;
    if (!w || typeof w !== 'object') return null;
    if (typeof w.v === 'string') { if (w.v.length > WERT_MAX) return null; aus.w = { v: w.v }; }
    else if (typeof w.c === 'boolean') aus.w = { c: w.c };
    else if (Array.isArray(w.m)) aus.w = { m: w.m.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 5000).slice(0, 200) };
    else if (typeof w.t === 'string') { if (w.t.length > WERT_MAX) return null; aus.w = { t: w.t }; }
    else return null;
  } else if (aus.a === 'click') {
    aus.x = typeof r.x === 'number' && r.x >= 0 && r.x <= 1 ? r.x : 0.5;
    aus.y = typeof r.y === 'number' && r.y >= 0 && r.y <= 1 ? r.y : 0.5;
  }
  return aus;
}
export const VORFUEHR_EREIGNIS = 'pixinotes:vorfuehren';
/** Eingaben des Vorführenden kamen an: detail = { boardId, karte, liste } */
export const EINGABE_EREIGNIS = 'pixinotes:zeig-eingabe';
/** Ein Rollstand kam an: detail = { boardId, karte, roll } */
export const ROLL_EREIGNIS = 'pixinotes:zeig-roll';

const zeiger = new Map<string, Zeiger>();      // boardId → wer gerade vorführt (auch ich selbst)
const geloest = new Set<string>();             // Boards, auf denen ich mich vom Vorführenden gelöst habe
let meinBoard: string | null = null;
let meinSeit = 0;
let gesendet = ''; let gesendetAm = 0;
let meineSicht: Sicht = { x: 0, y: 0, w: 0, h: 0 };
/** Das Board, auf dem meineSicht gemessen wurde — der Ausschnitt eines anderen Boards gilt hier nicht */
let sichtBoard: string | null = null;
/** M387: Ersatz, solange kein Ausschnitt gemessen ist (Präsentation aus der Übersicht gestartet) — ohne gültigen
 *  Ausschnitt verwirft der Empfänger die Meldung, und niemand sähe die Präsentation */
const ERSATZ_SICHT: Sicht = { x: 0, y: 0, w: 1200, h: 800 };
let meinVortrag: Vortrag | null = null;
const meineApps = new Set<string>();
const meineRollen: Record<string, Roll> = {};
let meineAnsicht: { karte: string; a: Ansicht } | null = null;
let meinFokus: string | null = null;
let meineDok: Record<string, number> = {};
/** M387: Diese Vorführung hat die Präsentation von selbst begonnen — sie endet dann auch mit ihr */
let mitVortrag = false;
/** M384: letzter Wert je Feld und Tool — für alle, die später dazukommen (höchstens 150 Felder je Tool) */
const meineFelder = new Map<string, Map<string, Eingabe>>();
const eingabeOffen = new Map<string, Eingabe[]>();                              // Tool → noch nicht Gesendetes, in Reihenfolge
const eingabeWarte = new Map<string, ReturnType<typeof setTimeout>>();
const melden = (boardId: string): void => { window.dispatchEvent(new CustomEvent(VORFUEHR_EREIGNIS, { detail: boardId })); };

/* ---------- M414: Spiegel eigener Tools ---------- */
/** Ein neues Abbild eines Tools ist da: detail = { boardId, karte } */
export const SPIEGEL_EREIGNIS = 'pixinotes:spiegel';
const spiegelKarten = new Set<string>();       // `${boardId}|${karte}` — davon liegt hier ein Abbild vor
const spiegelModul = () => import('./spiegel');
/** Liegt ein Abbild dieses Tools vor (ich folge, der Vorführende hat es offen)? */
export const spiegelDa = (boardId: string, karte: string): boolean => spiegelKarten.has(`${boardId}|${karte}`);
/** (vom Spiegel-Modul) */
export function spiegelMerken(boardId: string, karte: string): void {
  spiegelKarten.add(`${boardId}|${karte}`);
  window.dispatchEvent(new CustomEvent(SPIEGEL_EREIGNIS, { detail: { boardId, karte } }));
}
function spiegelVergessen(boardId: string): void {
  let weg = false;
  for (const k of [...spiegelKarten]) if (k.startsWith(`${boardId}|`)) { spiegelKarten.delete(k); weg = true; }
  if (weg) { void spiegelModul().then((m) => m.vergessen(boardId)); window.dispatchEvent(new CustomEvent(SPIEGEL_EREIGNIS, { detail: { boardId, karte: '' } })); }
}
/** Mein Tool meldet sein Abbild — führe ich vor, geht es (gepackt, gedrosselt) an die anderen */
export function spiegelBild(boardId: string, karte: string, bild: unknown, teile: unknown): void {
  if (meinBoard !== boardId) return;
  void spiegelModul().then((m) => m.senden(boardId, karte, bild, teile));
}
/** Ich folge und habe von diesem Tool noch kein Abbild: den Vorführenden darum bitten */
export function spiegelErbitten(boardId: string, karte: string): void {
  if (folgeIch(boardId) && !spiegelDa(boardId, karte)) liveSenden(boardId, 'zeigBildBitte', { karte });
}

export const werFuehrtVor = (boardId: string): Zeiger | null => zeiger.get(boardId) ?? null;
export const ichFuehreVor = (boardId: string): boolean => meinBoard === boardId;
export const folgeIch = (boardId: string): boolean => !!zeiger.get(boardId) && meinBoard !== boardId && !geloest.has(boardId);
export function folgenSetzen(boardId: string, an: boolean): void {
  if (an) geloest.delete(boardId); else { geloest.add(boardId); spiegelVergessen(boardId); }
  melden(boardId);
}
/** `ausVortrag`: in der Präsentation begonnen — dann endet die Vorführung auch mit ihr (M387) */
export function vorfuehrenStart(boardId: string, ausVortrag = false): void {
  if (meinBoard && meinBoard !== boardId) vorfuehrenStopp();
  spiegelVergessen(boardId);      // M414: Abbilder eines anderen Vorführenden gelten nicht mehr
  meinBoard = boardId; meinSeit = Date.now(); gesendet = '';
  const t = ichIn(boardId);
  mitVortrag = ausVortrag;
  zeiger.set(boardId, { id: t.id, name: t.name, farbe: t.farbe, seit: meinSeit, zuletzt: Date.now(), sicht: { x: 0, y: 0, w: 0, h: 0 }, vortrag: vortragJetzt(), apps: [...meineApps], rollen: { ...meineRollen }, fokus: meinFokus, dok: { ...meineDok } });
  melden(boardId);
}
/** Meine Stelle im Vortrag samt Ausschnitt (der gilt nur für die Folie, auf der er gemessen wurde) */
function vortragJetzt(): Vortrag | null {
  if (!meinVortrag) return null;
  return meineAnsicht && meineAnsicht.karte === meinVortrag.karte ? { ...meinVortrag, ansicht: meineAnsicht.a } : meinVortrag;
}

/* ---------- M387: Die Präsentation nimmt das Publikum von selbst mit ---------- */
const ALLEIN_KEY = 'pixinotes-vortrag-allein';
/** Hat der Mensch „Team folgt" in der Präsentation abgewählt? Dann präsentiert er bis auf Weiteres für sich. */
export function vortragAllein(): boolean {
  try { return localStorage.getItem(ALLEIN_KEY) === '1'; } catch { return false; }
}
export function vortragAlleinSetzen(an: boolean): void {
  try { if (an) localStorage.setItem(ALLEIN_KEY, '1'); else localStorage.removeItem(ALLEIN_KEY); } catch { /* Sitzung reicht */ }
}
/** Die Präsentation beginnt und andere sind im Board: vorführen — außer es läuft schon oder ist abgewählt */
export function vorfuehrenMitVortrag(boardId: string): boolean {
  if (meinBoard === boardId || vortragAllein()) return false;
  vorfuehrenStart(boardId, true);
  return true;
}
/** Die Präsentation endet: Eine Vorführung, die in ihr begann, endet mit ihr (wer vorher schon auf dem Board vorführte, führt weiter vor) */
export function vortragZuEnde(boardId: string): void {
  if (meinBoard === boardId && mitVortrag) vorfuehrenStopp();
}
export function vorfuehrenStopp(): void {
  const b = meinBoard;
  if (!b) return;
  meinBoard = null; mitVortrag = false;
  liveSenden(b, 'zeig', { von: ich().id, seit: meinSeit, ende: true });
  void spiegelModul().then((m) => m.vergessen(b));
  if (zeiger.get(b)?.id === ich().id) zeiger.delete(b);
  melden(b);
}
/** Den ganzen Stand senden — bei Änderung sofort, sonst alle 2,5 s als Lebenszeichen */
function standSenden(boardId: string, sofort = false): void {
  if (meinBoard !== boardId) return;
  const v = vortragJetzt();
  /* M387: Vorher ging ohne gemessenen Ausschnitt gar nichts hinaus. Wer „Team mitnehmen" in der Präsentation
     drückte, ohne vorher auf dem Board vorgeführt zu haben, nahm darum niemanden mit: In der Präsentation gibt
     es kein Board, das sich messen ließe. Jetzt wird der Ausschnitt laufend gemerkt (auch ohne Vorführung). */
  const sicht = sichtBoard === boardId && meineSicht.w > 0 ? meineSicht : ERSATZ_SICHT;
  const stand = {
    sicht, ...(v ? { vortrag: v } : {}), ...(meineApps.size ? { apps: [...meineApps] } : {}), ...(Object.keys(meineRollen).length ? { rollen: meineRollen } : {}),
    ...(meinFokus ? { fokus: meinFokus } : {}), ...(Object.keys(meineDok).length ? { dok: meineDok } : {}),
  };
  const text = JSON.stringify(stand);
  const jetzt = Date.now();
  if (!sofort && text === gesendet && jetzt - gesendetAm < 2500) return;
  gesendet = text; gesendetAm = jetzt;
  const t = ichIn(boardId);
  const z = zeiger.get(boardId);
  if (z) { z.sicht = sicht; z.zuletzt = jetzt; z.vortrag = v; z.apps = [...meineApps]; z.rollen = { ...meineRollen }; z.fokus = meinFokus; z.dok = { ...meineDok }; }
  liveSenden(boardId, 'zeig', { von: t.id, name: t.name, farbe: t.farbe, seit: meinSeit, ...stand });
}
/** Der Vorführende meldet seinen Ausschnitt (das Bauteil ruft das im Takt) */
export function sichtMelden(boardId: string, sicht: Sicht): void {
  meineSicht = { x: Math.round(sicht.x), y: Math.round(sicht.y), w: Math.round(sicht.w), h: Math.round(sicht.h) };
  sichtBoard = boardId;
  if (meinBoard === boardId) standSenden(boardId);
}
/** Lebenszeichen ohne neuen Ausschnitt — in der Folien-Präsentation gibt es das Board nicht, die Vorführung läuft trotzdem weiter */
export function lebenszeichen(boardId: string): void { standSenden(boardId); }
/** Die Präsentation meldet ihre Stelle (null = beendet). Gemerkt wird sie immer — wer danach „Vorführen" drückt, nimmt sie mit. */
export function vortragMelden(boardId: string, v: Vortrag | null): void {
  if (JSON.stringify(v) === JSON.stringify(meinVortrag)) return;
  meinVortrag = v;
  if (!v || meineAnsicht?.karte !== v.karte) meineAnsicht = null;     // andere Folie: Der Ausschnitt von vorhin gilt nicht mehr
  if (meinBoard === boardId) { standSenden(boardId, true); melden(boardId); }
}
const runden = (n: number, stellen: number): number => Math.round(n * 10 ** stellen) / 10 ** stellen;
let ansichtZeit = 0;
let ansichtWarte: ReturnType<typeof setTimeout> | undefined;
/** M387: Ausschnitt in der offenen Folie (Ansicht, Zoom, Rollstand) — höchstens acht Meldungen je Sekunde, die letzte kommt immer an */
export function ansichtMelden(boardId: string, karte: string, a: Ansicht): void {
  const sauber: Ansicht = { ...(a.m ? { m: a.m } : {}), ...(typeof a.z === 'number' ? { z: runden(a.z, 2) } : {}), x: runden(Math.min(1, Math.max(0, a.x)), 3), y: runden(Math.min(1, Math.max(0, a.y)), 3),
    ...(a.a ? { a: a.a, d: runden(typeof a.d === 'number' ? a.d : 1, 3) } : {}) };
  if (meineAnsicht?.karte === karte && JSON.stringify(meineAnsicht.a) === JSON.stringify(sauber)) return;
  meineAnsicht = { karte, a: sauber };
  if (meinBoard !== boardId) return;
  const senden = () => { ansichtZeit = Date.now(); ansichtWarte = undefined; standSenden(boardId, true); };
  clearTimeout(ansichtWarte);
  const warte = 120 - (Date.now() - ansichtZeit);
  if (warte <= 0) senden(); else ansichtWarte = setTimeout(senden, warte);
}
/** M387: Die Karte im Fokus (null = keine) — gemerkt wird sie immer, gesendet, solange ich vorführe */
export function fokusMelden(boardId: string, karte: string | null): void {
  if (karte === meinFokus) return;
  meinFokus = karte;
  if (meinBoard === boardId) standSenden(boardId, true);
}
/** M387: aufgeklappte Dokument-Karten und ihre offene Seite */
export function dokMelden(boardId: string, dok: Record<string, number>): void {
  if (JSON.stringify(dok) === JSON.stringify(meineDok)) return;
  meineDok = dok;
  if (meinBoard === boardId) standSenden(boardId, true);
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
  meineFelder.delete(karte); eingabeOffen.delete(karte);     // M384: … und seine Felder sind wieder leer
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

/** In Portionen senden — eine Nachricht bleibt klein, die Reihenfolge bleibt */
function eingabenSenden(boardId: string, karte: string, liste: Eingabe[]): void {
  let teil: Eingabe[] = []; let laenge = 0;
  const los = () => { if (teil.length) liveSenden(boardId, 'zeigEin', { von: ich().id, karte, e: teil }); teil = []; laenge = 0; };
  for (const e of liste) {
    const l = JSON.stringify(e).length;
    if (teil.length >= 40 || laenge + l > 12000) los();
    teil.push(e); laenge += l;
  }
  los();
}
function eingabenHinaus(boardId: string, karte: string): void {
  clearTimeout(eingabeWarte.get(karte)); eingabeWarte.delete(karte);
  const liste = eingabeOffen.get(karte);
  eingabeOffen.delete(karte);
  if (liste?.length && meinBoard === boardId) eingabenSenden(boardId, karte, liste);
}
/**
 * M384: Im Tool wurde etwas eingegeben. Getipptes sammelt sich kurz (ein Feld = sein letzter Wert); ein Klick,
 * Enter oder Abschicken geht sofort hinaus — mit allem davor, damit der Text vor dem Knopfdruck ankommt.
 */
export function eingabeMelden(boardId: string, karte: string, e: Eingabe): void {
  const feld = e.a === 'input' || e.a === 'change';
  // Feldwerte merken — auch vor der Vorführung: Wer dann folgt, soll dasselbe sehen wie ich
  if (feld) {
    let felder = meineFelder.get(karte);
    if (!felder) { felder = new Map(); meineFelder.set(karte, felder); }
    if (felder.has(e.p) || felder.size < 150) felder.set(e.p, { ...e, a: 'change' });
  }
  if (meinBoard !== boardId) return;
  let liste = eingabeOffen.get(karte);
  if (!liste) { liste = []; eingabeOffen.set(karte, liste); }
  const letzter = liste[liste.length - 1];
  if (feld && letzter && letzter.p === e.p && letzter.a === 'input' ) liste[liste.length - 1] = e; else liste.push(e);
  if (!feld || liste.length >= 40) { eingabenHinaus(boardId, karte); return; }
  if (!eingabeWarte.has(karte)) eingabeWarte.set(karte, setTimeout(() => eingabenHinaus(boardId, karte), 110));
}
/** Mein Tool ist (neu) geladen und ich folge: den Vorführenden um die Feldwerte bitten, die er schon eingegeben hat */
export function eingabenErbitten(boardId: string, karte: string): void {
  if (folgeIch(boardId)) liveSenden(boardId, 'zeigEinBitte', { karte });
}

function ansichtAus(roh: unknown): Ansicht | undefined {
  const r = roh as Partial<Ansicht> | null;
  const anteil = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
  if (!r || typeof r !== 'object' || !anteil(r.x) || !anteil(r.y)) return undefined;
  return {
    ...(r.m === 'seite' || r.m === 'breite' ? { m: r.m } : {}),
    ...(typeof r.z === 'number' && r.z >= 1 && r.z <= 6 ? { z: r.z } : {}),
    x: r.x, y: r.y,
    ...(r.a === 'standard' || r.a === 'einpassen' || r.a === 'breite' ? { a: r.a, d: typeof r.d === 'number' && r.d >= 0.05 && r.d <= 20 ? r.d : 1 } : {}),
  };
}
function dokAus(roh: unknown): Record<string, number> {
  const aus: Record<string, number> = {};
  if (!roh || typeof roh !== 'object') return aus;
  for (const [karte, n] of Object.entries(roh as Record<string, unknown>).slice(0, 40)) {
    if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n < 100000 && karte.length <= 80) aus[karte] = n;
  }
  return aus;
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
    // M414: Abbilder eigener Tools — nur vom Vorführenden an die, die folgen; die Bitte darum nur an ihn
    if (d?.ereignis === 'zeigBild' || d?.ereignis === 'zeigTeil') {
      const r = d.inhalt as { von?: unknown } | undefined;
      const z = zeiger.get(d.boardId);
      if (z && z.id === r?.von && folgeIch(d.boardId)) void spiegelModul().then((m) => m.empfangen(d.boardId, d.ereignis, d.inhalt));
      return;
    }
    if (d?.ereignis === 'zeigBildBitte') {
      const r = d.inhalt as { karte?: unknown } | undefined;
      if (meinBoard === d.boardId && typeof r?.karte === 'string' && r.karte.length <= 80) void spiegelModul().then((m) => m.erbeten(d.boardId, r.karte as string));
      return;
    }
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
    if (d?.ereignis === 'zeigEin') {
      const r = d.inhalt as { von?: unknown; karte?: unknown; e?: unknown } | undefined;
      const z = zeiger.get(d.boardId);
      if (!z || z.id !== r?.von || typeof r.karte !== 'string' || !Array.isArray(r.e) || !folgeIch(d.boardId)) return;
      const liste = r.e.slice(0, 60).map(eingabeAus).filter((x): x is Eingabe => !!x);
      if (liste.length) window.dispatchEvent(new CustomEvent(EINGABE_EREIGNIS, { detail: { boardId: d.boardId, karte: r.karte, liste } }));
      return;
    }
    if (d?.ereignis === 'zeigEinBitte') {
      const r = d.inhalt as { karte?: unknown } | undefined;
      if (meinBoard !== d.boardId || typeof r?.karte !== 'string') return;
      eingabenHinaus(d.boardId, r.karte);
      const felder = meineFelder.get(r.karte);
      if (felder?.size) eingabenSenden(d.boardId, r.karte, [...felder.values()]);
      return;
    }
    if (d?.ereignis !== 'zeig') return;
    const m = d.inhalt as { von?: unknown; name?: unknown; farbe?: unknown; seit?: unknown; ende?: unknown; sicht?: Partial<Sicht>; vortrag?: Partial<Vortrag>; apps?: unknown; rollen?: unknown; fokus?: unknown; dok?: unknown } | undefined;
    if (typeof m?.von !== 'string' || typeof m.seit !== 'number') return;
    // M388: Vorführen kann nur, wer im Board anwesend ist — und nicht „seit übermorgen": Mit einer Zeit in der
    // Zukunft ließe sich die Vorführung sonst dauerhaft an sich reißen (es führt vor, wer zuletzt begonnen hat).
    if (m.von === ich().id || m.von.length > 80 || !Number.isFinite(m.seit) || m.seit > Date.now() + 60_000) return;
    if (!m.ende && !teilnehmerVon(d.boardId).some((t) => t.id === m.von)) return;
    const alt = zeiger.get(d.boardId);
    if (m.ende) {
      if (alt?.id === m.von) { zeiger.delete(d.boardId); geloest.delete(d.boardId); spiegelVergessen(d.boardId); melden(d.boardId); }
      return;
    }
    const s = m.sicht;
    if (!s || ![s.x, s.y, s.w, s.h].every((v) => typeof v === 'number' && Number.isFinite(v)) || !(s.w! > 0) || !(s.h! > 0)) return;
    // Es führt der vor, der zuletzt begonnen hat
    if (alt && alt.id !== m.von && alt.seit > m.seit) return;
    if (meinBoard === d.boardId) {
      if (meinSeit > m.seit) return;        // ich habe später begonnen — der andere hört auf, sobald ihn meine Meldung erreicht
      meinBoard = null; mitVortrag = false;  // jemand hat übernommen
      void spiegelModul().then((sm) => sm.vergessen(d.boardId));
    }
    if (alt?.id !== m.von) { geloest.delete(d.boardId); spiegelVergessen(d.boardId); }
    zeiger.set(d.boardId, {
      id: m.von, name: typeof m.name === 'string' ? m.name.slice(0, 40) : 'Jemand',
      // M385: die Farbe, in der alle den Vorführenden sehen (verteilt, lib/gastSync.ts) — sonst die gemeldete
      farbe: teilnehmerVon(d.boardId).find((t) => t.id === m.von)?.farbe ?? (typeof m.farbe === 'string' ? m.farbe : '#6b7280'),
      seit: m.seit, zuletzt: Date.now(), sicht: { x: s.x!, y: s.y!, w: s.w!, h: s.h! },
      vortrag: typeof m.vortrag?.karte === 'string' && typeof m.vortrag.seite === 'number'
        ? { karte: m.vortrag.karte, seite: m.vortrag.seite, ...(ansichtAus(m.vortrag.ansicht) ? { ansicht: ansichtAus(m.vortrag.ansicht) } : {}) } : null,
      apps: Array.isArray(m.apps) ? m.apps.filter((a): a is string => typeof a === 'string').slice(0, 40) : [],
      rollen: rollenAus(m.rollen),
      fokus: typeof m.fokus === 'string' && m.fokus.length <= 80 ? m.fokus : null,
      dok: dokAus(m.dok),
    });
    melden(d.boardId);
  });
  // Meldet sich der Vorführende nicht mehr (Verbindung weg, Fenster zu), endet die Vorführung von selbst
  setInterval(() => {
    for (const [boardId, z] of zeiger) {
      if (z.id !== ich().id && Date.now() - z.zuletzt > 9000) { zeiger.delete(boardId); geloest.delete(boardId); spiegelVergessen(boardId); melden(boardId); }
    }
  }, 3000);
}
