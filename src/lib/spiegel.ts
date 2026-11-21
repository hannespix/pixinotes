// M414: Eigene Tools beim Vorführen spiegeln — die Zuschauer sehen, was beim Vorführenden im Tool steht.
//
// Vorher lief das Tool bei jedem selbst, und nachgestellt wurden nur Eingaben (M384). Das ging schief, sobald
// ein Tool mit etwas rechnete, das nur ein Gerät kennt: dem eigenen Speicherstand (Anna hat zwei Einträge,
// Gerd sieht eine leere Liste), Zufall, Uhrzeit, Zeichenflächen, Reitern hinter Verweisen. Jetzt meldet das
// Tool des Vorführenden laufend ein Abbild seiner Seite (die Brücke in lib/htmlStore.ts), und bei den
// Zuschauern steht genau dieses Abbild — in einem Rahmen, in dem nichts ausgeführt wird.
//
// Über die Leitung (lib/liveKanal.ts):
//   · „zeigTeil"  — ein großes Stück (Bild einer Zeichenfläche, eingebettete Grafik, langer Stil) unter seiner
//                   Prüfsumme. Es reist nur einmal; das Abbild verweist danach nur noch darauf.
//   · „zeigBild"  — das Abbild selbst (Kopf, Körper, Merkmale der Seite), gepackt.
//   · „zeigBildBitte" — wer neu dazukommt, bittet um den ganzen Stand.
// Alles gepackt (gzip) und in Stücke geteilt: Supabase nimmt im freien Tarif höchstens 256 KB je Nachricht.
// Und gedrosselt nach der Zahl der Empfänger — jede Nachricht zählt beim Server einmal je Teilnehmer.
//
// Sicherheit: Der Vorführende kann jeder sein, der im Board ist. Was ankommt, wird darum wie fremder Inhalt
// behandelt: Skripte, Rahmen, Weiterleitungen, Ereignis-Merkmale und „javascript:"-Adressen fliegen heraus, und
// der Rahmen beim Zuschauer erlaubt keinerlei Ausführung (sandbox ohne allow-scripts).
import { ich, liveSenden, teilnehmerVon } from './gastSync';
import { folgeIch, spiegelMerken, werFuehrtVor } from './vorfuehren';

export interface Bild { k: string; b: string; a: [string, string][]; w: number }

const STUECK = 60_000;              // Zeichen je Nachricht (gepackt, Base64) — weit unter 256 KB
const BILD_MAX = 6_000_000;         // ungepackt
const TEIL_MAX = 8_000_000;
const TEILE_JE_BOARD_MAX = 40_000_000;
const TOKEN = /pn-teil-([at]):([0-9a-z]{4,40})/g;

/* ---------- Packen ---------- */
const packbar = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
async function packen(text: string): Promise<{ d: string; z: 0 | 1 }> {
  if (!packbar) return { d: text, z: 0 };
  const strom = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(strom).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { d: btoa(bin), z: 1 };
}
async function entpacken(d: string, z: unknown): Promise<string> {
  if (z !== 1) return d;
  const bin = atob(d);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const strom = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(strom).text();
}

/* ---------- Senden (ich führe vor) ---------- */
interface Ausgang { bild: Bild | null; teile: Record<string, string>; gesendet: Set<string>; laeuft: boolean; naechstes: number; timer?: ReturnType<typeof setTimeout>; neu: boolean }
const ausgang = new Map<string, Ausgang>();         // `${boardId}|${karte}`
let folge = 0;

function bildAus(roh: unknown): Bild | null {
  const r = roh as Partial<Bild> | null;
  if (!r || typeof r !== 'object' || typeof r.k !== 'string' || typeof r.b !== 'string' || !Array.isArray(r.a)) return null;
  if (r.k.length + r.b.length > BILD_MAX) return null;
  const a = r.a.filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string' && x[0].length < 60 && x[1].length < 4000).slice(0, 30);
  return { k: r.k, b: r.b, a, w: typeof r.w === 'number' && Number.isFinite(r.w) ? r.w : 0 };
}

/** Mein Tool hat ein neues Abbild gemeldet */
export function senden(boardId: string, karte: string, roh: unknown, teileRoh: unknown): void {
  const k = `${boardId}|${karte}`;
  let aus = ausgang.get(k);
  if (!aus) { aus = { bild: null, teile: {}, gesendet: new Set(), laeuft: false, naechstes: 0, neu: false }; ausgang.set(k, aus); }
  const bild = bildAus(roh);
  if (!bild) return;
  aus.bild = bild;
  const teile: Record<string, string> = {};
  if (teileRoh && typeof teileRoh === 'object') {
    for (const [h, v] of Object.entries(teileRoh as Record<string, unknown>)) if (/^[0-9a-z]{4,40}$/.test(h) && typeof v === 'string' && v.length <= TEIL_MAX) teile[h] = v;
  }
  aus.teile = teile;
  aus.neu = true;
  planen(boardId, karte, aus);
}
/** Jemand ist neu dazugekommen: alles noch einmal, samt aller Teile */
export function erbeten(boardId: string, karte: string): void {
  const aus = ausgang.get(`${boardId}|${karte}`);
  if (!aus?.bild) return;
  aus.gesendet.clear();
  aus.neu = true;
  planen(boardId, karte, aus);
}
function planen(boardId: string, karte: string, aus: Ausgang): void {
  if (aus.laeuft || aus.timer) return;
  const warte = Math.max(0, aus.naechstes - Date.now());
  aus.timer = setTimeout(() => { aus.timer = undefined; void hinaus(boardId, karte, aus); }, warte);
}
async function hinaus(boardId: string, karte: string, aus: Ausgang): Promise<void> {
  if (!aus.neu || !aus.bild) return;
  const empfaenger = teilnehmerVon(boardId).filter((t) => t.id !== ich().id).length;
  if (empfaenger === 0) { aus.gesendet.clear(); return; }      // niemand sieht zu — wer kommt, bittet um alles
  aus.neu = false; aus.laeuft = true;
  let stuecke = 0;
  try {
    const bild = aus.bild;
    const text = bild.k + bild.b;
    const braucht = new Set<string>();
    for (const m of text.matchAll(TOKEN)) braucht.add(m[2]);
    for (const h of braucht) {
      if (aus.gesendet.has(h) || !aus.teile[h]) continue;
      const p = await packen(aus.teile[h]);
      const n = Math.ceil(p.d.length / STUECK) || 1;
      for (let i = 0; i < n; i++) liveSenden(boardId, 'zeigTeil', { von: ich().id, karte, h, i, n, z: p.z, d: p.d.slice(i * STUECK, (i + 1) * STUECK) });
      aus.gesendet.add(h);
      stuecke += n;
    }
    const p = await packen(JSON.stringify(bild));
    const n = Math.ceil(p.d.length / STUECK) || 1;
    const s = ++folge;
    for (let i = 0; i < n; i++) liveSenden(boardId, 'zeigBild', { von: ich().id, karte, s, i, n, z: p.z, d: p.d.slice(i * STUECK, (i + 1) * STUECK) });
    stuecke += n;
  } catch { /* nächstes Abbild */ }
  aus.laeuft = false;
  // Rund acht Nachrichten je Sekunde, gezählt wie beim Server (Absender + jeder Empfänger); mindestens 0,3 s Abstand
  aus.naechstes = Date.now() + Math.max(300, Math.round((stuecke * 1000 * (empfaenger + 1)) / 8));
  if (aus.neu) planen(boardId, karte, aus);
}

/* ---------- Empfangen (ich folge) ---------- */
interface Eingang { teile: Map<string, string>; groesse: number; bilder: Map<string, Bild>; warten: Map<string, Bild> }
const eingang = new Map<string, Eingang>();         // boardId
const stuecke = new Map<string, { n: number; da: (string | undefined)[]; zahl: number; z: unknown; am: number }>();
const zuletzt = new Map<string, number>();          // `${boardId}|${karte}` → Folgenummer des zuletzt gezeigten Abbilds
const bitteAm = new Map<string, number>();

function eingangVon(boardId: string): Eingang {
  let e = eingang.get(boardId);
  if (!e) { e = { teile: new Map(), groesse: 0, bilder: new Map(), warten: new Map() }; eingang.set(boardId, e); }
  return e;
}
/** Stücke einer Nachricht sammeln; fertig → der ganze Text */
function sammeln(schluessel: string, i: number, n: number, d: string, z: unknown): { d: string; z: unknown } | null {
  let s = stuecke.get(schluessel);
  if (!s || s.n !== n) { s = { n, da: new Array(n), zahl: 0, z, am: Date.now() }; stuecke.set(schluessel, s); }
  if (s.da[i] === undefined) { s.da[i] = d; s.zahl += 1; }
  if (s.zahl < n) {
    // Liegengebliebenes aufräumen
    if (stuecke.size > 60) for (const [k, v] of stuecke) if (Date.now() - v.am > 60_000) stuecke.delete(k);
    return null;
  }
  stuecke.delete(schluessel);
  return { d: s.da.join(''), z: s.z };
}
const fehlt = (e: Eingang, b: Bild): string[] => {
  const f: string[] = [];
  for (const m of (b.k + b.b).matchAll(TOKEN)) if (!e.teile.has(m[2])) f.push(m[2]);
  return f;
};
function zeigen(boardId: string, karte: string, e: Eingang, b: Bild): void {
  if (fehlt(e, b).length) {
    e.warten.set(karte, b);
    const k = `${boardId}|${karte}`;
    if (Date.now() - (bitteAm.get(k) ?? 0) > 2500) { bitteAm.set(k, Date.now()); liveSenden(boardId, 'zeigBildBitte', { karte }); }
    return;
  }
  e.warten.delete(karte);
  e.bilder.set(karte, b);
  spiegelMerken(boardId, karte);
}

export async function empfangen(boardId: string, ereignis: string, roh: unknown): Promise<void> {
  const r = roh as { von?: unknown; karte?: unknown; h?: unknown; s?: unknown; i?: unknown; n?: unknown; z?: unknown; d?: unknown } | null;
  if (!r || typeof r.karte !== 'string' || r.karte.length > 80 || typeof r.d !== 'string' || r.d.length > STUECK + 100) return;
  const n = Number(r.n); const i = Number(r.i);
  if (!Number.isInteger(n) || n < 1 || n > 400 || !Number.isInteger(i) || i < 0 || i >= n) return;
  const karte = r.karte;
  const e = eingangVon(boardId);
  if (ereignis === 'zeigTeil') {
    if (typeof r.h !== 'string' || !/^[0-9a-z]{4,40}$/.test(r.h)) return;
    const fertig = sammeln(`${boardId}|t|${r.h}`, i, n, r.d, r.z);
    if (!fertig) return;
    let wert: string;
    try { wert = await entpacken(fertig.d, fertig.z); } catch { return; }
    if (wert.length > TEIL_MAX) return;
    if (!e.teile.has(r.h)) {
      e.teile.set(r.h, wert); e.groesse += wert.length;
      // Zu viel beisammen: die ältesten Teile gehen (ein Abbild, das sie braucht, bittet sie neu an)
      for (const [h, v] of e.teile) { if (e.groesse <= TEILE_JE_BOARD_MAX) break; e.teile.delete(h); e.groesse -= v.length; }
    }
    const wartet = e.warten.get(karte);
    if (wartet && !fehlt(e, wartet).length) zeigen(boardId, karte, e, wartet);
    return;
  }
  if (ereignis !== 'zeigBild') return;
  const s = Number(r.s);
  if (!Number.isInteger(s) || s < 0) return;
  const fertig = sammeln(`${boardId}|b|${karte}|${s}`, i, n, r.d, r.z);
  if (!fertig) return;
  let bild: Bild | null = null;
  try { bild = bildAus(JSON.parse(await entpacken(fertig.d, fertig.z))); } catch { return; }
  if (!bild) return;
  // Unterwegs überholt? Ein älteres Abbild ersetzt kein neueres
  const k = `${boardId}|${karte}`;
  if (s < (zuletzt.get(k) ?? -1) && s > (zuletzt.get(k) ?? 0) - 1000) return;
  zuletzt.set(k, s);
  if (!folgeIch(boardId) || !werFuehrtVor(boardId)) return;
  zeigen(boardId, karte, e, bild);
}

/** Vorführung vorbei, gewechselt oder gelöst: Abbilder und Teile dieses Boards verwerfen */
export function vergessen(boardId: string): void {
  eingang.delete(boardId);
  for (const k of [...ausgang.keys()]) if (k.startsWith(`${boardId}|`)) { clearTimeout(ausgang.get(k)?.timer); ausgang.delete(k); }
  for (const k of [...zuletzt.keys()]) if (k.startsWith(`${boardId}|`)) zuletzt.delete(k);
  for (const k of [...stuecke.keys()]) if (k.startsWith(`${boardId}|`)) stuecke.delete(k);
}

/* ---------- Zeigen ---------- */
const escAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
function einsetzen(text: string, teile: Map<string, string>): string {
  return text.replace(TOKEN, (_, art: string, h: string) => {
    const v = teile.get(h) ?? '';
    return art === 'a' ? escAttr(v) : v.replace(/<\/(style)/gi, '<\\/$1');
  });
}
const WEG = 'script,iframe,frame,frameset,object,embed,applet,portal,noscript';
const ADRESSE = /^(href|src|action|formaction|xlink:href|data|poster|background|srcset|lowsrc|ping|codebase|cite|manifest)$/i;
const BOESE = /^\s*(javascript|vbscript|data:(?!image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp)|font\/|application\/(font|x-font))|blob:)/i;
/** Fremdes Abbild entschärfen: nichts, was ausführt, weiterleitet oder nachlädt, was es nicht soll */
function saeubern(doc: Document): void {
  // Ersetzt statt entfernt: Die Lage der übrigen Elemente bleibt (Rollstände kommen als Weg von <body> aus)
  for (const el of Array.from(doc.querySelectorAll(WEG))) el.replaceWith(doc.createElement('template'));
  for (const el of Array.from(doc.querySelectorAll('meta,base,link:not([rel~="stylesheet" i])'))) el.remove();
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const at of Array.from(el.attributes)) {
      const name = at.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'target' || name === 'formaction' || name === 'http-equiv' || name === 'autofocus') el.removeAttribute(at.name);
      else if (ADRESSE.test(name) && BOESE.test(at.value)) el.removeAttribute(at.name);
      else if (name === 'style' && /expression\s*\(|javascript:/i.test(at.value)) el.removeAttribute(at.name);
    }
  }
}
/** Das Abbild in den Rahmen übertragen — nur, was sich geändert hat (kein Flackern, Rollstände bleiben) */
function angleichen(doc: Document, alt: Element, neu: Element): void {
  for (const at of Array.from(alt.attributes)) if (!neu.hasAttribute(at.name)) alt.removeAttribute(at.name);
  for (const at of Array.from(neu.attributes)) if (alt.getAttribute(at.name) !== at.value) alt.setAttribute(at.name, at.value);
  const a = alt.childNodes; const n = neu.childNodes;
  for (let i = 0; i < n.length; i++) {
    const nk = n[i]; const ak = a[i];
    if (!ak) { alt.appendChild(doc.importNode(nk, true)); continue; }
    if (ak.nodeType !== nk.nodeType || (nk.nodeType === 1 && (ak as Element).tagName !== (nk as Element).tagName)) { alt.replaceChild(doc.importNode(nk, true), ak); continue; }
    if (nk.nodeType === 1) {
      angleichen(doc, ak as Element, nk as Element);
      // Felder zeigen ihren Wert über die Eigenschaft (das Merkmal allein reicht nach einer Änderung nicht)
      const el = ak as HTMLInputElement;
      if (el.tagName === 'INPUT') { if (/^(checkbox|radio)$/i.test(el.type)) el.checked = (nk as Element).hasAttribute('checked'); else el.value = (nk as Element).getAttribute('value') ?? ''; }
      else if (el.tagName === 'TEXTAREA') (el as unknown as HTMLTextAreaElement).value = nk.textContent ?? '';
      else if (el.tagName === 'OPTION') (el as unknown as HTMLOptionElement).selected = (nk as Element).hasAttribute('selected');
    } else if (ak.nodeValue !== nk.nodeValue) ak.nodeValue = nk.nodeValue;
  }
  while (a.length > n.length) alt.removeChild(alt.lastChild as ChildNode);
}

/** Das aktuelle Abbild eines Tools in diesen (ausführungsfreien) Rahmen schreiben — false, wenn keins da ist */
export function anwenden(doc: Document, boardId: string, karte: string): boolean {
  const e = eingang.get(boardId);
  const b = e?.bilder.get(karte);
  if (!e || !b) return false;
  const neu = new DOMParser().parseFromString(`<!doctype html><html><head>${einsetzen(b.k, e.teile)}</head>${einsetzen(b.b, e.teile)}</html>`, 'text/html');
  saeubern(neu);
  for (const [name, wert] of b.a) {
    const nm = name.toLowerCase();
    if (/^[a-z][a-z0-9:_-]*$/.test(nm) && !nm.startsWith('on') && nm !== 'manifest') try { neu.documentElement.setAttribute(nm, wert); } catch { /* ungültig */ }
  }
  // Zeichenflächen als Bild: in ihrer Fläche bleiben, auch wenn sie beim Vorführenden breiter war
  const st = neu.createElement('style');
  st.textContent = 'img[data-pn-leinwand]{max-width:100%;height:auto}';
  neu.head.appendChild(st);
  for (const at of Array.from(doc.documentElement.attributes)) if (!neu.documentElement.hasAttribute(at.name)) doc.documentElement.removeAttribute(at.name);
  for (const at of Array.from(neu.documentElement.attributes)) doc.documentElement.setAttribute(at.name, at.value);
  angleichen(doc, doc.head, neu.head);
  angleichen(doc, doc.body, neu.body);
  return true;
}
