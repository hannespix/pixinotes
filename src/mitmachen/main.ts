// M513: Mitmachen per QR — die Teilnehmer-Seite. Lädt NUR, was eine Person am Telefon braucht: kein React, kein
// Board, kein Editor, keine Karten außer dieser einen (deren öffentlicher Stand kommt signiert vom Gastgeber).
// Alles, was vom Kanal kommt, landet ausschließlich als Text im DOM (textContent), nie als HTML.
import './mitmachen.css';
import { liveKanal, type LiveKanal } from '../lib/liveKanal';
import { BUBBLE_FARBEN } from '../lib/bubbles';
import {
  abdruck, echt, eingangKanal, entschluesseln, gemeinsam, GRENZEN, GRUND, kennungAus, linkLesen, pruefSchluessel, restSenden, standKanal,
  tauschPaar, tauschPaarLaden, verschluesseln, zufall,
  type MeinStand, type MitBlase, type MitStand, type Paar, type StandNachricht, type Wunsch,
} from '../lib/mitmachenProtokoll';
import type { SupabaseKonfig } from '../lib/kontoSupabase';

// ───── Texte (Deutsch, Englisch nach Sprache des Geräts) ─────
const DE = {
  marke: 'Mitmachen', verbinde: 'Verbinde …', da: (n: number) => `${n} dabei`,
  kaputt: 'Dieser Link ist unvollständig. Bitte den QR-Code noch einmal scannen.',
  keinServer: 'Diese Fassung von PixiNotes hat keinen Live-Server – Mitmachen geht hier nicht.',
  warte: 'Warte auf die Runde …',
  weg: 'Diese Runde ist gerade nicht offen – vielleicht ist sie beendet oder die Moderation ist kurz nicht verbunden. Die Seite versucht es weiter.',
  ende: 'Diese Mitmach-Runde ist beendet. Danke fürs Mitmachen!',
  schritte: ['Sammeln', 'Gruppieren', 'Abstimmen', 'Ergebnis'] as string[],
  name: 'Dein Name (freiwillig)', idee: 'Deine Idee', senden: 'Senden', ideeLabel: 'Idee',
  sammelnHinweis: 'Ideen eintragen – jede einzeln senden.',
  verdecktHinweis: 'Verdeckt: Die Ideen der anderen siehst du, sobald die Sammlung endet.',
  andere: (n: number) => (n === 1 ? '1 Idee von anderen (noch verdeckt)' : `${n} Ideen von anderen (noch verdeckt)`),
  gruppierenHinweis: 'Die Sammlung ist geschlossen. Die Moderation ordnet die Ideen – gleich wird abgestimmt.',
  abstimmenHinweis: (rest: number, alle: number) => `Noch ${rest} von ${alle} ${alle === 1 ? 'Punkt' : 'Punkten'} – mit ＋ vergeben, mit − zurücknehmen.`,
  stillHinweis: 'Der Zwischenstand ist verborgen – die Punkte erscheinen mit dem Ergebnis.',
  ergebnisHinweis: 'Das Ergebnis steht fest.',
  keineIdeen: 'Noch keine Ideen.', ohneGruppe: 'Ohne Gruppe', deine: 'deine', wartet: 'wird gesendet …',
  loeschen: 'Idee zurückziehen', plus: (t: string) => `Einen Punkt auf „${t}"`, minus: (t: string) => `Einen Punkt von „${t}" zurücknehmen`,
  punkte: (n: number) => (n === 1 ? '1 Punkt' : `${n} Punkte`), meine: (n: number) => `meine: ${n}`,
  platz: (n: number) => `${n}.`, genug: `Du hast ${GRENZEN.ideenJePerson} Ideen eingereicht – mehr geht in dieser Runde nicht.`,
  verdeckt: '•••',
  grund: {
    [GRUND.geschlossen]: 'Das geht gerade nicht – die Moderation hat den Schritt gewechselt.',
    [GRUND.zuViele]: `Mehr als ${GRENZEN.ideenJePerson} Ideen je Person gehen nicht.`,
    [GRUND.zuSchnell]: 'Etwas langsamer bitte – der letzte Beitrag kam nicht an. Einfach noch einmal senden.',
    [GRUND.ungueltig]: 'Dieser Beitrag ließ sich nicht annehmen.',
    [GRUND.keinePunkte]: 'Alle Punkte sind vergeben – nimm erst einen zurück.',
    [GRUND.voll]: 'Die Karte ist voll – es passen keine weiteren Ideen hinein.',
  } as Record<number, string>,
};
const EN: typeof DE = {
  marke: 'Join in', verbinde: 'Connecting …', da: (n) => `${n} joined`,
  kaputt: 'This link is incomplete. Please scan the QR code again.',
  keinServer: 'This version of PixiNotes has no live server – joining in does not work here.',
  warte: 'Waiting for the round …',
  weg: 'This round is not open right now – it may have ended, or the moderator is briefly offline. The page keeps trying.',
  ende: 'This round has ended. Thanks for taking part!',
  schritte: ['Collect', 'Group', 'Vote', 'Result'],
  name: 'Your name (optional)', idee: 'Your idea', senden: 'Send', ideeLabel: 'Idea',
  sammelnHinweis: 'Add your ideas – send each one separately.',
  verdecktHinweis: 'Hidden: you will see the others’ ideas once collecting ends.',
  andere: (n) => (n === 1 ? '1 idea by others (still hidden)' : `${n} ideas by others (still hidden)`),
  gruppierenHinweis: 'Collecting is closed. The moderator is grouping the ideas – voting starts soon.',
  abstimmenHinweis: (rest, alle) => `${rest} of ${alle} ${alle === 1 ? 'point' : 'points'} left – give with ＋, take back with −.`,
  stillHinweis: 'The running tally is hidden – points appear with the result.',
  ergebnisHinweis: 'The result is in.',
  keineIdeen: 'No ideas yet.', ohneGruppe: 'Ungrouped', deine: 'yours', wartet: 'sending …',
  loeschen: 'Withdraw idea', plus: (t) => `Give a point to “${t}”`, minus: (t) => `Take a point back from “${t}”`,
  punkte: (n) => (n === 1 ? '1 point' : `${n} points`), meine: (n) => `mine: ${n}`,
  platz: (n) => `${n}.`, genug: `You have sent ${GRENZEN.ideenJePerson} ideas – that is the limit for this round.`,
  verdeckt: '•••',
  grund: {
    [GRUND.geschlossen]: 'Not possible right now – the moderator has moved on.',
    [GRUND.zuViele]: `No more than ${GRENZEN.ideenJePerson} ideas per person.`,
    [GRUND.zuSchnell]: 'A little slower please – your last entry did not arrive. Just send it again.',
    [GRUND.ungueltig]: 'This entry could not be accepted.',
    [GRUND.keinePunkte]: 'All your points are used – take one back first.',
    [GRUND.voll]: 'The card is full – no more ideas fit.',
  },
};
const en = /^en\b/i.test(navigator.language || '');
const T = en ? EN : DE;
document.documentElement.lang = en ? 'en' : 'de';

// ───── Aussehen: Hell/Dunkel des Geräts — oder der Look, den das Board mitgibt (M509: Thema, pix·el, Akzent) ─────
const linkFrueh = linkLesen(location.hash);
if (linkFrueh?.akzent) document.documentElement.dataset.accent = linkFrueh.akzent;
const dunkel = matchMedia('(prefers-color-scheme: dark)');
const themaSetzen = () => {
  document.documentElement.dataset.theme = linkFrueh?.thema ?? (dunkel.matches ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.body).backgroundColor || '#f3f4f6');
};
dunkel.addEventListener('change', themaSetzen);

// ───── DOM-Helfer (nur Text, nie HTML) ─────
type Kind = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attr: Record<string, string | boolean | undefined> = {}, ...kinder: Kind[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kinder) if (c !== null && c !== undefined && c !== false) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

// ───── Zustand ─────
const wurzel = document.getElementById('mit')!;
const link = linkLesen(location.hash);
const env = import.meta.env as Record<string, string | undefined>;
const vorgabe: SupabaseKonfig = { url: (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, ''), key: (env.VITE_SUPABASE_ANON_KEY ?? '').trim() };
const server: SupabaseKonfig = link?.sb ?? vorgabe;
if (link?.design === 'pixel') document.documentElement.dataset.design = 'pixel';

interface Gespeichert { jwk?: JsonWebKey; name?: string; n?: number; eigene?: Record<string, string> }
const SPEICHER = link ? `pixinotes-mit:${link.token}` : '';
const laden = (): Gespeichert => { try { return JSON.parse(localStorage.getItem(SPEICHER) ?? '{}') as Gespeichert; } catch { return {}; } };
const speichern = (g: Gespeichert): void => { try { localStorage.setItem(SPEICHER, JSON.stringify(g)); } catch { /* privat */ } };

const z = {
  paar: null as Paar | null, kennung: '', pruef: null as CryptoKey | null,
  hostPub: '', hostKey: null as CryptoKey | null,
  stand: null as MitStand | null, mein: null as MeinStand | null, letztesZ: 0, zuletzt: 0,
  /** Wünsche, die der Gastgeber noch nicht bestätigt hat */
  offen: [] as Array<{ w: Wunsch; gesendet: number }>,
  n: 0, name: '', eigene: {} as Record<string, string>,
  zustand: 'verbinde' as 'verbinde' | 'da' | 'weg' | 'ende' | 'kaputt' | 'keinServer',
  meldung: '', meldungBis: 0, gesehen: new Set<number>(),
  kanal: null as LiveKanal | null, erstesHallo: true, sperreBis: 0,
};

// ───── Senden ─────
async function rausschicken(ereignis: string, inhalt: unknown): Promise<void> {
  if (!link) return;
  // Über die REST-Schnittstelle direkt zum Gastgeber — geht das nicht, über den eigenen Kanal (dann hören alle mit,
  // sehen aber nur Verschlüsseltes)
  if (await restSenden(server, eingangKanal(link.token), ereignis, inhalt)) return;
  z.kanal?.senden(ereignis, inhalt);
}
function hallo(): void {
  if (!z.paar) return;
  void rausschicken('hallo', { p: z.paar.oeffentlich, ...(z.erstesHallo ? { neu: 1 } : {}) });
  z.erstesHallo = false;
}
async function wunschSenden(o: { w: Wunsch; gesendet: number }): Promise<void> {
  if (!z.hostKey || !z.paar) return;
  o.gesendet = Date.now();
  const v = await verschluesseln(z.hostKey, o.w);
  await rausschicken('op', { p: z.paar.oeffentlich, ...v });
}
function wunsch(w: Omit<Wunsch, 'n'>): void {
  z.n = Math.max(Date.now(), z.n + 1);
  const o = { w: { ...w, n: z.n } as Wunsch, gesendet: 0 };
  z.offen.push(o);
  merken();
  void wunschSenden(o);
  zeichnen();
}
function merken(): void { speichern({ jwk: laden().jwk, name: z.name, n: z.n, eigene: z.eigene }); }

// ───── Empfangen ─────
async function standDa(roh: unknown): Promise<void> {
  const m = roh as StandNachricht;
  if (!link || typeof m?.d !== 'string' || typeof m.s !== 'string' || m.d.length > 400_000) return;
  let st: MitStand;
  try { st = JSON.parse(m.d) as MitStand; } catch { return; }
  if (!st || typeof st !== 'object') return;
  // Der Schlüssel reist im Stand mit — er gilt nur, wenn sein Abdruck der aus dem Link ist
  if (!z.pruef) {
    if (typeof st.k !== 'string' || st.k.length > 200 || (await abdruck(st.k).catch(() => '')) !== link.schluessel) return;
    try { z.pruef = await pruefSchluessel(st.k); } catch { return; }
  }
  if (!(await echt(z.pruef, m.d, m.s))) return;                 // nicht vom Gastgeber signiert: übergehen
  if (typeof st.z !== 'number' || st.z <= z.letztesZ) return;   // alte Nachricht noch einmal gesendet
  z.letztesZ = st.z; z.zuletzt = Date.now();
  if (st.ende) { z.zustand = 'ende'; z.stand = st; z.kanal?.stop(); zeichnen(); return; }
  z.stand = st; z.zustand = 'da';
  if (st.h !== z.hostPub && z.paar) {
    z.hostPub = st.h;
    z.hostKey = await gemeinsam(z.paar.privat, st.h);
    // neuer Gastgeber-Schlüssel (Gastgeber neu gestartet): sich melden und Offenes neu schicken
    z.erstesHallo = true; hallo();
    for (const o of z.offen) void wunschSenden(o);
  }
  const u = m.u?.[z.kennung];
  if (u && z.hostKey) {
    const mein = await entschluesseln<MeinStand>(z.hostKey, u);
    if (mein && typeof mein.n === 'number') {
      z.mein = mein;
      z.offen = z.offen.filter((o) => o.w.n > mein.n);
      for (const [n, g] of mein.f ?? []) {
        if (z.gesehen.has(n)) continue;
        z.gesehen.add(n);
        meldung(T.grund[g] ?? T.grund[GRUND.ungueltig]);
      }
      // eigene Ideen: was der Gastgeber führt, plus was noch unterwegs ist
      const eigene: Record<string, string> = { ...mein.i };
      for (const o of z.offen) if (o.w.a === 'idee' && o.w.id) eigene[o.w.id] = o.w.x ?? '';
      z.eigene = eigene;
      if (mein.n > z.n) z.n = mein.n;
      merken();
    }
  }
  zeichnen();
}
function meldung(text: string): void { z.meldung = text; z.meldungBis = Date.now() + 6000; }

// ───── Zeichnen ─────
const eingabe = {
  form: null as HTMLFormElement | null, name: null as HTMLInputElement | null, idee: null as HTMLInputElement | null, knopf: null as HTMLButtonElement | null, rest: null as HTMLElement | null,
};
function formularBauen(): HTMLFormElement {
  const name = el('input', { class: 'mit-feld', id: 'mit-name', name: 'name', maxlength: String(GRENZEN.name), autocomplete: 'nickname', placeholder: T.name, 'aria-label': T.name, 'data-taste': 'mit-name', enterkeyhint: 'next' });
  name.value = z.name;
  name.addEventListener('input', () => { z.name = name.value.slice(0, GRENZEN.name); merken(); });
  const idee = el('input', { class: 'mit-feld mit-idee', id: 'mit-idee', name: 'idee', maxlength: String(GRENZEN.text), autocomplete: 'off', placeholder: T.idee, 'aria-label': T.idee, 'data-taste': 'mit-idee', enterkeyhint: 'send' });
  const knopf = el('button', { class: 'mit-knopf haupt', type: 'submit', 'data-taste': 'mit-senden' }, T.senden);
  const rest = el('p', { class: 'mit-klein', 'data-taste': 'mit-rest' });
  const form = el('form', { class: 'mit-eingabe', 'data-taste': 'mit-eingabe' }, name, el('div', { class: 'mit-zeile' }, idee, knopf), rest);
  idee.addEventListener('input', () => { knopf.disabled = !idee.value.trim() || Date.now() < z.sperreBis; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = idee.value.replace(/\s+/g, ' ').trim().slice(0, GRENZEN.text);
    if (!text || Date.now() < z.sperreBis) return;
    if (Object.keys(z.eigene).length >= GRENZEN.ideenJePerson) { meldung(T.genug); zeichnen(); return; }
    const id = zufall(12);
    z.eigene = { ...z.eigene, [id]: text };
    wunsch({ a: 'idee', id, x: text, ...(z.name.trim() && !z.stand?.r.anonym ? { name: z.name.trim() } : {}) });
    idee.value = ''; knopf.disabled = true;
    // ein kurzer Abstand zwischen zwei Ideen (der Gastgeber nimmt sonst ab der achten in Folge nicht mehr an)
    z.sperreBis = Date.now() + 700;
    setTimeout(() => { knopf.disabled = !idee.value.trim(); }, 720);
    idee.focus();
  });
  knopf.disabled = true;
  Object.assign(eingabe, { form, name, idee, knopf, rest });
  return form;
}

const blaseText = (b: MitBlase): string => {
  if (b.x) return b.x;
  const eig = b.i.find((i) => z.eigene[i] !== undefined);
  return eig ? z.eigene[eig] : T.verdeckt;
};
const istEigen = (b: MitBlase): boolean => b.i.some((i) => z.eigene[i] !== undefined);
/** Meine Punkte auf einer Blase: was der Gastgeber führt, plus was noch unterwegs ist */
function meinePunkte(b: MitBlase): number {
  let n = z.mein?.p?.[b.id] ?? 0;
  for (const o of z.offen) if (o.w.id === b.id || (o.w.id && b.i.includes(o.w.id))) n += o.w.a === 'plus' ? 1 : o.w.a === 'minus' ? -1 : 0;
  return Math.max(0, n);
}

let inhalt: HTMLElement | null = null;
let kopfStatus: HTMLElement | null = null;
let meldungEl: HTMLElement | null = null;
function geruest(): void {
  wurzel.textContent = '';
  kopfStatus = el('span', { class: 'mit-status', 'data-taste': 'mit-status', 'aria-live': 'polite' });
  meldungEl = el('p', { class: 'mit-meldung', role: 'status', 'data-taste': 'mit-meldung', hidden: true });
  inhalt = el('div', { class: 'mit-inhalt', 'data-taste': 'mit-inhalt' });
  wurzel.append(el('main', { class: 'mit' },
    el('header', { class: 'mit-kopf' }, el('span', { class: 'mit-marke' }, T.marke), kopfStatus),
    meldungEl, inhalt, formularBauen()));
}

function zeichnen(): void {
  if (!inhalt || !kopfStatus || !meldungEl) return;
  const st = z.stand;
  const jetzt = Date.now();
  meldungEl.hidden = !(z.meldung && jetzt < z.meldungBis);
  meldungEl.textContent = meldungEl.hidden ? '' : z.meldung;
  kopfStatus.textContent = z.zustand === 'da' && st ? T.da(st.dabei) : z.zustand === 'verbinde' ? T.verbinde : '';
  kopfStatus.dataset.zustand = z.zustand;
  inhalt.textContent = '';
  const form = eingabe.form!;
  const nurText = (t: string, taste: string) => { inhalt!.append(el('p', { class: 'mit-hinweis gross', 'data-taste': taste }, t)); form.hidden = true; };
  if (z.zustand === 'kaputt') return nurText(T.kaputt, 'mit-kaputt');
  if (z.zustand === 'keinServer') return nurText(T.keinServer, 'mit-kein-server');
  if (z.zustand === 'ende') { if (st) inhalt.append(el('h1', { class: 'mit-titel' }, st.ti || T.ideeLabel)); return nurText(T.ende, 'mit-ende'); }
  if (!st) return nurText(z.zustand === 'weg' ? T.weg : T.warte, z.zustand === 'weg' ? 'mit-weg' : 'mit-warte');
  if (z.zustand === 'weg') inhalt.append(el('p', { class: 'mit-hinweis warn', 'data-taste': 'mit-weg' }, T.weg));

  inhalt.append(el('h1', { class: 'mit-titel', 'data-taste': 'mit-titel' }, st.ti || T.ideeLabel));
  if (st.f) inhalt.append(el('p', { class: 'mit-frage', 'data-taste': 'mit-frage' }, st.f));
  const schritte = ['sammeln', 'gruppieren', 'abstimmen', 'ergebnis'];
  const jetztI = schritte.indexOf(st.s);
  inhalt.append(el('ol', { class: 'mit-schritte', 'aria-label': 'Ablauf', 'data-taste': 'mit-schritte', 'data-schritt': st.s },
    ...T.schritte.map((t, i) => el('li', { class: i === jetztI ? 'jetzt' : i < jetztI ? 'war' : '', 'aria-current': i === jetztI ? 'step' : undefined }, el('i', {}, String(i + 1)), t))));

  const sammeln = st.s === 'sammeln' && !st.r.zu;
  form.hidden = !sammeln;
  if (sammeln) {
    eingabe.name!.hidden = !!st.r.anonym;
    const anzahl = Object.keys(z.eigene).length;
    eingabe.rest!.textContent = anzahl >= GRENZEN.ideenJePerson ? T.genug : '';
    if (eingabe.idee) eingabe.idee.disabled = anzahl >= GRENZEN.ideenJePerson;
  }
  const hinweis = st.s === 'sammeln' ? (st.r.verdeckt ? T.verdecktHinweis : T.sammelnHinweis)
    : st.s === 'gruppieren' ? T.gruppierenHinweis
      : st.s === 'abstimmen' ? T.abstimmenHinweis(Math.max(0, st.pk - st.b.reduce((s, b) => s + meinePunkte(b), 0)), st.pk)
        : T.ergebnisHinweis;
  inhalt.append(el('p', { class: 'mit-hinweis', 'data-taste': 'mit-hinweis' }, hinweis));
  if (st.s === 'abstimmen' && st.r.still) inhalt.append(el('p', { class: 'mit-klein' }, T.stillHinweis));

  const verdeckt = st.s === 'sammeln' && !!st.r.verdeckt;
  let blasen = st.b;
  let fremd = 0;
  if (verdeckt) {
    fremd = blasen.filter((b) => !istEigen(b)).length;
    blasen = blasen.filter(istEigen);
    if (fremd) inhalt.append(el('p', { class: 'mit-klein', 'data-taste': 'mit-verdeckt' }, T.andere(fremd)));
  }
  // noch unterwegs: eigene Ideen, die im Stand noch fehlen
  const imStand = new Set(st.b.flatMap((b) => b.i));
  const unterwegs = z.offen.filter((o) => o.w.a === 'idee' && o.w.id && !imStand.has(o.w.id));
  const liste = el('div', { class: 'mit-liste', 'data-taste': 'mit-liste' });
  if (!blasen.length && !unterwegs.length && !fremd) liste.append(el('p', { class: 'mit-klein' }, T.keineIdeen));
  for (const o of unterwegs) liste.append(el('div', { class: 'mit-idee-zeile wartet', 'data-taste': 'mit-zeile' }, el('span', { class: 'mit-text' }, o.w.x ?? ''), el('span', { class: 'mit-klein' }, T.wartet)));
  const ergebnis = st.s === 'ergebnis';
  if (ergebnis) blasen = [...blasen].sort((a, b) => (b.p ?? 0) - (a.p ?? 0) || b.m - a.m || a.x.localeCompare(b.x));
  const platz = new Map<string, number>();
  if (ergebnis) blasen.forEach((b, i) => platz.set(b.id, i > 0 && (blasen[i - 1].p ?? 0) === (b.p ?? 0) ? platz.get(blasen[i - 1].id)! : i + 1));
  const rest = st.pk - st.b.reduce((s, b) => s + meinePunkte(b), 0);
  const zeile = (b: MitBlase): HTMLElement => {
    const eigen = istEigen(b);
    const text = blaseText(b);
    const meta: Kind[] = [];
    if (b.m > 1) meta.push(el('span', { class: 'mit-mal' }, `×${b.m}`));
    if (eigen) meta.push(el('span', { class: 'mit-marke-eigen' }, T.deine));
    else if (b.n?.length) meta.push(el('span', { class: 'mit-von' }, b.n.join(', ')));
    if (b.p !== undefined && b.p > 0 && st.s !== 'sammeln') meta.push(el('span', { class: 'mit-punkte', 'data-taste': 'mit-punkte' }, T.punkte(b.p)));
    const r = el('div', { class: `mit-idee-zeile${eigen ? ' eigen' : ''}`, 'data-taste': 'mit-zeile', 'data-id': b.id },
      ergebnis && (b.p ?? 0) > 0 ? el('b', { class: `mit-platz p${Math.min(platz.get(b.id)!, 4)}`, 'data-taste': 'mit-platz' }, T.platz(platz.get(b.id)!)) : null,
      el('span', { class: 'mit-text' }, text),
      el('span', { class: 'mit-meta' }, ...meta));
    if (st.s === 'sammeln' && !st.r.zu && eigen) {
      const id = b.i.find((i) => z.mein?.i?.[i] !== undefined);
      if (id) {
        const weg = el('button', { class: 'mit-knopf klein', type: 'button', 'aria-label': `${T.loeschen}: ${text}`, title: T.loeschen, 'data-taste': 'mit-weg-idee' }, '✕');
        weg.addEventListener('click', () => { const e = { ...z.eigene }; delete e[id]; z.eigene = e; wunsch({ a: 'weg', id }); });
        r.append(weg);
      }
    }
    if (st.s === 'abstimmen') {
      const meine = meinePunkte(b);
      const minus = el('button', { class: 'mit-knopf rund', type: 'button', 'aria-label': T.minus(text), 'data-taste': 'mit-minus', disabled: meine <= 0 }, '−');
      const plus = el('button', { class: 'mit-knopf rund haupt', type: 'button', 'aria-label': T.plus(text), 'data-taste': 'mit-plus', disabled: rest <= 0 }, '＋');
      minus.addEventListener('click', () => wunsch({ a: 'minus', id: b.id }));
      plus.addEventListener('click', () => wunsch({ a: 'plus', id: b.id }));
      r.append(el('span', { class: 'mit-stimmen' }, minus, el('b', { class: 'mit-meine', 'data-taste': 'mit-meine', 'aria-label': T.meine(meine) }, String(meine)), plus));
    }
    return r;
  };
  // Nach Gruppen (wie in der Karte), freie Ideen am Ende
  if (st.g.length && !verdeckt && !ergebnis) {
    st.g.forEach((g, gi) => {
      const drin = blasen.filter((b) => b.g === gi);
      if (!drin.length) return;
      const kasten = el('section', { class: 'mit-gruppe', 'data-taste': 'mit-gruppe' }, el('h2', {}, g.name));
      kasten.style.setProperty('--g', BUBBLE_FARBEN[g.farbe % BUBBLE_FARBEN.length]);
      for (const b of drin) kasten.append(zeile(b));
      liste.append(kasten);
    });
    const frei = blasen.filter((b) => b.g === undefined);
    if (frei.length) { const k = el('section', { class: 'mit-gruppe frei' }, el('h2', {}, T.ohneGruppe)); for (const b of frei) k.append(zeile(b)); liste.append(k); }
  } else for (const b of blasen) liste.append(zeile(b));
  inhalt.append(liste);
}

// ───── Start ─────
async function start(): Promise<void> {
  themaSetzen();
  geruest();
  if (!link) { z.zustand = 'kaputt'; zeichnen(); return; }
  if (!server.url || !server.key || !crypto?.subtle) { z.zustand = 'keinServer'; zeichnen(); return; }
  const g = laden();
  z.name = g.name ?? ''; if (eingabe.name) eingabe.name.value = z.name;
  z.n = Number(g.n) || 0;
  z.eigene = g.eigene && typeof g.eigene === 'object' ? g.eigene : {};
  try {
    if (g.jwk) z.paar = await tauschPaarLaden(g.jwk);
  } catch { z.paar = null; }
  if (!z.paar) { const p = await tauschPaar(); z.paar = p; speichern({ ...g, jwk: p.jwk }); }
  z.kennung = await kennungAus(z.paar.oeffentlich);
  zeichnen();
  z.kanal = liveKanal(server, standKanal(link.token), { id: `p-${z.kennung.slice(0, 10)}`, name: 'T', farbe: '#6b7280' }, {
    nachricht: (ev, inh) => { if (ev === 'stand') void standDa(inh); },
    teilnehmer: () => {},
  }, undefined, { stumm: true });
  hallo();
  // Melden, dass man noch da ist; Unbestätigtes erneut schicken; Verbindung zum Gastgeber beobachten
  setInterval(() => { if (z.zustand !== 'ende') hallo(); }, 25_000);
  setInterval(() => {
    if (z.zustand === 'ende') return;
    const jetzt = Date.now();
    for (const o of z.offen) if (jetzt - o.gesendet > 6000) void wunschSenden(o);
    const vorher = z.zustand;
    if (jetzt - z.zuletzt > 30_000 && (z.zustand === 'da' || (z.zustand === 'verbinde' && jetzt - startZeit > 12_000))) z.zustand = 'weg';
    if (vorher !== z.zustand || (z.meldung && jetzt >= z.meldungBis)) { if (jetzt >= z.meldungBis) z.meldung = ''; zeichnen(); }
  }, 2000);
}
const startZeit = Date.now();
void start();
