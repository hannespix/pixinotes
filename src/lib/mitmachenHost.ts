// M513: Mitmachen per QR — der Gastgeber. Läuft auf dem Gerät, das die Runde geöffnet hat, solange die Karte die
// Runde als offen führt — auch wenn die Karte gerade nicht im Bild ist (wer per Bildschirmfreigabe über das Board
// scrollt, soll die Beiträge trotzdem bekommen).
//
// Er hört auf die Wünsche der Teilnehmenden (Kanal `…-ein`, Fallback: der Stand-Kanal), prüft jeden gegen die
// Regeln der Karte und die GRENZEN und schreibt Angenommenes in die Karte — Ideen und Stimmen tragen als Urheber
// `t:<Abdruck des Schlüssels>`. Dann sendet er den neuen, signierten Stand. Nur diese eine Karte verlässt das Gerät,
// und von ihr nur, was die Regeln zeigen (verdeckt: keine fremden Texte; anonym: keine Namen; Zwischenstand
// verborgen: keine Punkte).
import { getWriterRole, mutedHistory, useBoard } from '../store';
import type { AppNode } from '../types';
import { blasenVon, bubblesDaten, bubblesSchritt, geordnet, meinePunkte, type BubblesData } from './bubbles';
import { liveKanal, type LiveKanal } from './liveKanal';
import { supabaseKonfig } from './kontoSupabase';
import { textVonAussen } from './sicher';
import {
  eingangKanal, entschluesseln, gemeinsam, GRENZEN, GRUND, kennungAus, MIT_VERSION, signieren, signierLaden, standKanal, tauschPaar,
  verschluesseln, VON_PRAEFIX, type MeinStand, type MitBlase, type MitStand, type Paar, type Verschluesselt, type Wunsch,
} from './mitmachenProtokoll';
import { gemerkt, gemerktSetzen, mitmachenStandSetzen, mitmachenVon } from './mitmachen';

interface Person { kennung: string; schluessel: CryptoKey; n: number; eimer: number; gefuellt: number; zuletzt: number; fehler: Array<[number, number, number]>; neu: boolean }
interface Dienst {
  token: string; board: string; karte: string;
  sign: { privat: CryptoKey; oeffentlich: string }; tausch: Paar;
  stand: LiveKanal; ein: LiveKanal;
  personen: Map<string, Person>;
  /** öffentliche Schlüssel, deren Herleitung gerade läuft */
  werden: Map<string, Promise<Person | null>>;
  /** Wünsche zum Abarbeiten — mit `grund`: schon abgelehnt (zu schnell), nur noch zu vermerken */
  warte: Array<{ p: Person; w: Wunsch; grund?: number }>;
  flushTimer?: ReturnType<typeof setTimeout>;
  sendeTimer?: ReturnType<typeof setTimeout>;
  puls: ReturnType<typeof setInterval>;
  letzterText: string; letztesSenden: number; z: number;
  sekunde: { t: number; n: number };
  daten: unknown;
  warVerbunden: boolean;
  aus: boolean;
}
const dienste = new Map<string, Dienst>();
/** Ruhe-Takt: so oft geht der Stand auch ohne Änderung hinaus (neue Teilnehmende, „Gastgeber ist da") */
const PULS_MS = 12_000;
/** Wer so lange nichts gesagt hat, zählt nicht mehr als „dabei" */
const DABEI_MS = 75_000;
const ID_MUSTER = /^[A-Za-z0-9_-]{8,30}$/;

const karteVon = (board: string, karte: string): AppNode | undefined =>
  useBoard.getState().boards.find((b) => b.id === board)?.nodes.find((n) => n.id === karte);
const aktive = (d: Dienst): number => { const jetzt = Date.now(); let n = 0; for (const p of d.personen.values()) if (jetzt - p.zuletzt < DABEI_MS) n += 1; return n; };
/** Mindestabstand zweier Stände — wächst mit der Runde (jeder Stand geht an alle) */
const abstand = (d: Dienst): number => Math.min(4000, Math.max(600, aktive(d) * 12));
const saubererText = (roh: unknown, n: number): string => textVonAussen(roh, n * 2).replace(/\s+/g, ' ').trim().slice(0, n);

// ───── Stand ─────
function standVon(d: Dienst, roh: unknown): Omit<MitStand, 'z'> {
  const b = bubblesDaten(roh as Partial<BubblesData>);
  const schritt = bubblesSchritt(b);
  const r = b.regeln ?? { t: 0 };
  const verdeckt = !!r.verdeckt && schritt === 'sammeln';
  const still = !!r.still && b.abstimmung.phase === 'offen';
  const gruppen = Object.entries(b.gruppen).filter(([, g]) => g && !g.weg).sort((x, y) => x[1].t - y[1].t || x[0].localeCompare(y[0]));
  const gIndex = new Map(gruppen.map(([id], i) => [id, i]));
  const blasen: MitBlase[] = blasenVon(b, '', { jeAutor: verdeckt }).map((x) => ({
    id: x.id, i: x.ids, x: verdeckt ? '' : x.text, m: x.mal,
    ...(still ? {} : { p: x.punkte }),
    ...(x.gruppe && gIndex.has(x.gruppe) ? { g: gIndex.get(x.gruppe) } : {}),
    ...(!r.anonym && !verdeckt && x.namen.length ? { n: x.namen.slice(0, 3) } : {}),
  }));
  return {
    v: MIT_VERSION, ti: String(b.title ?? '').slice(0, 120), f: String(b.frage ?? '').slice(0, 160), s: schritt, pk: b.abstimmung.punkte,
    r: { ...(r.anonym ? { anonym: 1 } : {}), ...(r.verdeckt ? { verdeckt: 1 } : {}), ...(r.still ? { still: 1 } : {}), ...(r.zu ? { zu: 1 } : {}) },
    g: gruppen.map(([, g]) => ({ name: g.name.slice(0, 40), farbe: g.farbe })),
    b: blasen, h: d.tausch.oeffentlich, k: d.sign.oeffentlich, dabei: aktive(d),
  };
}
function meinStand(p: Person, roh: unknown): MeinStand {
  const b = bubblesDaten(roh as Partial<BubblesData>);
  const pid = VON_PRAEFIX + p.kennung;
  const i: Record<string, string> = {};
  for (const [id, x] of Object.entries(b.ideen)) if (x && !x.weg && x.von === pid && typeof x.text === 'string') i[id] = x.text;
  const pk: Record<string, number> = {};
  for (const x of blasenVon(b, pid)) if (x.meine > 0) pk[x.id] = x.meine;
  const jetzt = Date.now();
  const f = p.fehler.filter(([, , t]) => jetzt - t < 60_000).map(([n, g]): [number, number] => [n, g]);
  return { n: p.n, ...(f.length ? { f } : {}), i, p: pk };
}

async function senden(d: Dienst, ende = false): Promise<void> {
  if (d.aus && !ende) return;
  if (!d.stand.verbunden) { planen(d, 1000); return; }
  const n = karteVon(d.board, d.karte);
  const roh = n?.data ?? d.daten;
  const st = standVon(d, roh);
  const text = JSON.stringify(st);
  const offen = [...d.personen.values()].filter((p) => p.neu);
  const jetzt = Date.now();
  if (!ende && text === d.letzterText && !offen.length && jetzt - d.letztesSenden < PULS_MS - 500) return;
  d.letzterText = text; d.letztesSenden = jetzt;
  d.z = Math.max(jetzt, d.z + 1);
  const voll: MitStand = { ...st, z: d.z, ...(ende ? { ende: 1 } : {}) };
  const dText = JSON.stringify(voll);
  const s = await signieren(d.sign.privat, dText);
  // Persönliche Antworten (eigene Ideen, eigene Punkte) — verschlüsselt, je Nachricht höchstens 250
  const u: Record<string, Verschluesselt> = {};
  for (const p of offen.slice(0, 250)) { u[p.kennung] = await verschluesseln(p.schluessel, meinStand(p, roh)); p.neu = false; }
  d.stand.senden('stand', { d: dText, s, ...(Object.keys(u).length ? { u } : {}) });
  if (offen.length > 250) planen(d, abstand(d));
}
/** Den nächsten Stand vormerken — frühestens nach dem Mindestabstand seit dem letzten */
function planen(d: Dienst, warte = 150): void {
  if (d.sendeTimer || d.aus) return;
  const frueh = d.letztesSenden + abstand(d) - Date.now();
  d.sendeTimer = setTimeout(() => { d.sendeTimer = undefined; void senden(d); }, Math.max(warte, frueh));
}

// ───── Wünsche ─────
function grenzeGesamt(d: Dienst): boolean {
  const s = Math.floor(Date.now() / 1000);
  if (d.sekunde.t !== s) d.sekunde = { t: s, n: 0 };
  d.sekunde.n += 1;
  return d.sekunde.n > GRENZEN.jeSekunde;
}
function person(d: Dienst, pub: unknown): Promise<Person | null> {
  if (typeof pub !== 'string' || !/^[A-Za-z0-9_-]{86,88}$/.test(pub)) return Promise.resolve(null);
  const da = d.personen.get(pub);
  if (da) return Promise.resolve(da);
  const w = d.werden.get(pub);
  if (w) return w;
  if (d.personen.size >= GRENZEN.personen) return Promise.resolve(null);
  const neu = (async () => {
    const k = await gemeinsam(d.tausch.privat, pub);
    if (!k) return null;
    const p: Person = { kennung: await kennungAus(pub), schluessel: k, n: 0, eimer: GRENZEN.eimer, gefuellt: Date.now(), zuletzt: Date.now(), fehler: [], neu: true };
    d.personen.set(pub, p);
    return p;
  })().finally(() => d.werden.delete(pub));
  d.werden.set(pub, neu);
  return neu;
}
async function nachricht(d: Dienst, ereignis: string, inhalt: unknown): Promise<void> {
  if (d.aus || (ereignis !== 'hallo' && ereignis !== 'op')) return;
  if (grenzeGesamt(d)) return;
  let roh: string;
  try { roh = JSON.stringify(inhalt); } catch { return; }
  if (!roh || roh.length > GRENZEN.nachricht) return;
  const m = inhalt as { p?: unknown; neu?: unknown } & Partial<Verschluesselt>;
  const p = await person(d, m.p);
  if (!p) return;
  p.zuletzt = Date.now();
  if (ereignis === 'hallo') {
    // Neu geladen (oder neues Gerät): der persönliche Stand geht mit dem nächsten Stand hinaus
    if (m.neu) p.neu = true;
    planen(d);
    return;
  }
  const w = await entschluesseln<Wunsch>(p.schluessel, { i: String(m.i ?? ''), c: String(m.c ?? '') });
  if (!w || typeof w.n !== 'number' || !Number.isFinite(w.n) || w.n <= p.n) return;   // gefälscht, kaputt oder alt
  // Eimer: so viele Wünsche auf einmal, dann einer je nachfuellenMs
  const jetzt = Date.now();
  p.eimer = Math.min(GRENZEN.eimer, p.eimer + (jetzt - p.gefuellt) / GRENZEN.nachfuellenMs); p.gefuellt = jetzt;
  if (p.eimer < 1) d.warte.push({ p, w, grund: GRUND.zuSchnell });
  else { p.eimer -= 1; d.warte.push({ p, w }); }
  if (!d.flushTimer) d.flushTimer = setTimeout(() => { d.flushTimer = undefined; abarbeiten(d); }, 80);
}
/** Gesammelte Wünsche auf einmal in die Karte schreiben (ein Schreibvorgang statt vieler) */
function abarbeiten(d: Dienst): void {
  // je Person in der Reihenfolge ihrer Nummern (die Entschlüsselung läuft nebenher und kann die Reihenfolge drehen)
  const liste = d.warte.splice(0).sort((x, y) => x.w.n - y.w.n);
  const n = karteVon(d.board, d.karte);
  if (!liste.length) return;
  if (!n) { planen(d); return; }
  const b = bubblesDaten(n.data as Partial<BubblesData>);
  const ideen = { ...b.ideen }; const stimmen = { ...b.stimmen };
  let geaendert = false;
  for (const { p, w, grund } of liste) {
    if (w.n <= p.n) continue;
    p.n = w.n; p.neu = true;
    const g = grund ?? anwenden(b, ideen, stimmen, VON_PRAEFIX + p.kennung, w);
    if (g === true) geaendert = true;
    else if (g !== GRUND.ok) p.fehler = [...p.fehler.slice(-4), [w.n, g, Date.now()]];
  }
  if (geaendert) {
    mutedHistory(() => useBoard.getState().updateNodeDataOnBoard(d.board, d.karte, { ideen: geordnet(ideen), stimmen: geordnet(stimmen) }));
  }
  planen(d);
}
/** Einen Wunsch prüfen und (auf den Kopien) ausführen — true: geändert, sonst ein Grund (0 = ok ohne Änderung) */
function anwenden(b: BubblesData, ideen: BubblesData['ideen'], stimmen: BubblesData['stimmen'], pid: string, w: Wunsch): true | number {
  const r = b.regeln ?? { t: 0 };
  const jetzt = Date.now();
  const lebend = (x: { weg?: boolean; text?: unknown } | undefined) => !!x && !x.weg && typeof x.text === 'string' && !!x.text.trim();
  switch (w.a) {
    case 'da': return GRUND.ok;
    case 'idee': {
      if (r.zu) return GRUND.geschlossen;
      if (typeof w.id !== 'string' || !ID_MUSTER.test(w.id)) return GRUND.ungueltig;
      if (ideen[w.id]) return ideen[w.id].von === pid ? GRUND.ok : GRUND.ungueltig;   // wiederholt gesendet
      const text = saubererText(w.x, GRENZEN.text);
      if (!text) return GRUND.ungueltig;
      const alle = Object.values(ideen).filter(lebend);
      if (alle.filter((x) => x.von === pid).length >= GRENZEN.ideenJePerson) return GRUND.zuViele;
      if (alle.length >= GRENZEN.ideenGesamt) return GRUND.voll;
      const name = r.anonym ? '' : saubererText(w.name, GRENZEN.name);
      ideen[w.id] = { text, von: pid, ...(name ? { name } : {}), t: jetzt };
      return true;
    }
    case 'weg': {
      const x = typeof w.id === 'string' ? ideen[w.id] : undefined;
      if (!x || x.von !== pid || x.weg) return GRUND.ungueltig;
      if (r.zu) return GRUND.geschlossen;
      ideen[w.id!] = { ...x, weg: true, t: Math.max(jetzt, x.t + 1) };
      return true;
    }
    case 'plus': case 'minus': {
      if (b.abstimmung.phase !== 'offen') return GRUND.geschlossen;
      const dd = { ...b, ideen, stimmen };
      const blase = blasenVon(dd, pid).find((x) => x.id === w.id || x.ids.includes(String(w.id)));
      if (!blase) return GRUND.ungueltig;
      if (w.a === 'plus') {
        if (meinePunkte(dd, pid) >= b.abstimmung.punkte) return GRUND.keinePunkte;
        const k = `${blase.id}|${pid}`;
        stimmen[k] = { n: (stimmen[k]?.n ?? 0) + 1, t: Math.max(jetzt, (stimmen[k]?.t ?? 0) + 1) };
        return true;
      }
      const k = blase.ids.map((i) => `${i}|${pid}`).find((x) => (stimmen[x]?.n ?? 0) > 0);
      if (!k) return GRUND.ungueltig;
      stimmen[k] = { n: stimmen[k].n - 1, t: Math.max(jetzt, stimmen[k].t + 1) };
      return true;
    }
    default: return GRUND.ungueltig;
  }
}

// ───── Starten und Beenden ─────
async function starten(token: string, e: { jwk: JsonWebKey; board: string; karte: string }): Promise<void> {
  const k = supabaseKonfig();
  if (!k.url || !k.key || dienste.has(token)) return;
  const sign = await signierLaden(e.jwk);
  const tausch = await tauschPaar();
  if (dienste.has(token)) return;
  const ich = { id: `h-${token.slice(0, 6)}`, name: 'Gastgeber', farbe: '#6b7280' };
  const d = {} as Dienst;
  const auf = { nachricht: (ev: string, inh: unknown) => { void nachricht(d, ev, inh); }, teilnehmer: () => {} };
  Object.assign(d, {
    token, board: e.board, karte: e.karte, sign, tausch,
    stand: liveKanal(k, standKanal(token), ich, auf, undefined, { stumm: true }),
    ein: liveKanal(k, eingangKanal(token), ich, auf, undefined, { stumm: true }),
    personen: new Map(), werden: new Map(), warte: [], letzterText: '', letztesSenden: 0, z: 0, sekunde: { t: 0, n: 0 },
    daten: karteVon(e.board, e.karte)?.data, warVerbunden: false, aus: false,
  } satisfies Omit<Dienst, 'puls'>);
  d.puls = setInterval(() => {
    const v = d.stand.verbunden;
    if (v && !d.warVerbunden) planen(d, 0);
    d.warVerbunden = v;
    if (Date.now() - d.letztesSenden >= PULS_MS) planen(d, 0);
    // Wer lange still war, vergessen (die Ideen bleiben in der Karte; kommt die Person wieder, meldet sie sich neu)
    for (const [pub, p] of d.personen) if (Date.now() - p.zuletzt > 30 * 60_000) d.personen.delete(pub);
    mitmachenStandSetzen(token, aktive(d), v);
  }, 1000);
  dienste.set(token, d);
  mitmachenStandSetzen(token, 0, false);
}
function anhalten(token: string, ende: boolean): void {
  const d = dienste.get(token);
  if (!d) return;
  d.aus = true;
  dienste.delete(token);
  clearInterval(d.puls); clearTimeout(d.flushTimer); clearTimeout(d.sendeTimer);
  mitmachenStandSetzen(token, 0, false);
  if (!ende) { d.stand.stop(); d.ein.stop(); return; }
  // „Mitmachen beenden": den Schluss dreimal sagen (wer gerade neu verbindet, hört es auch), dann auflegen
  void senden(d, true);
  setTimeout(() => void senden(d, true), 1500);
  setTimeout(() => { void senden(d, true).finally(() => setTimeout(() => { d.stand.stop(); d.ein.stop(); }, 500)); }, 4000);
}

// ───── Abgleich mit dem Store ─────
let horcht = false;
let letzteBoards: unknown = null;
/** Welche Runden sollen auf diesem Gerät laufen? (nach jedem Laden, jeder Änderung an den Boards und Schreiberwechsel) */
export function mitmachenDienste(): void {
  if (!horcht) {
    horcht = true;
    useBoard.subscribe((s) => { if (s.boards !== letzteBoards) { letzteBoards = s.boards; abgleichen(); } });
    window.addEventListener('pixinotes:writer-change', abgleichen);
    window.addEventListener('storage', (e) => { if (e.key === 'pixinotes-mitmachen') abgleichen(); });
  }
  abgleichen();
}
function abgleichen(): void {
  const g = gemerkt();
  const schreiber = getWriterRole() === 'writer';
  let weg = false;
  for (const [token, e] of Object.entries(g)) {
    const n = karteVon(e.board, e.karte);
    const m = n && n.type === 'bubbles' ? mitmachenVon(n.data) : null;
    const boardDa = useBoard.getState().boards.some((b) => b.id === e.board);
    if (!n || !m || m.token !== token || !m.an) {
      // Runde beendet (oder Karte gelöscht): Schluss sagen, Schlüssel vergessen. Fehlt nur das Board (noch nicht
      // geladen), bleibt der Schlüssel.
      if (dienste.has(token)) anhalten(token, true);
      if (boardDa || Date.now() - e.seit > 30 * 86_400_000) { delete g[token]; weg = true; }
      continue;
    }
    const d = dienste.get(token);
    if (!schreiber) { if (d) anhalten(token, false); continue; }
    if (!d) { void starten(token, e); continue; }
    if (n.data !== d.daten) { d.daten = n.data; planen(d); }
  }
  for (const token of [...dienste.keys()]) if (!g[token]) anhalten(token, true);
  if (weg) gemerktSetzen(g);
}
