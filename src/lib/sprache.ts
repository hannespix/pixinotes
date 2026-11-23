// M381: Eingebaute englische Oberfläche.
//
// PixiNotes ist auf Deutsch geschrieben — jeder Text steht dort, wo er gebraucht wird, im Quelltext der
// Komponente. Für Englisch wird das nicht Stelle für Stelle umgebaut: Ein Wörterbuch (src/sprache/en.json,
// Deutsch → Englisch) übersetzt die Oberfläche, während sie entsteht. Ein Beobachter sieht jeden Textknoten
// und jedes Beschriftungs-Attribut (title, aria-label, placeholder, alt), sobald React sie anlegt oder ändert,
// und setzt die englische Fassung ein — noch bevor der Browser zeichnet.
//
// Was das trägt:
//   · React bleibt ungestört. Es werden keine Knoten ersetzt oder verschoben (anders als beim Übersetzer des
//     Browsers, siehe lib/uebersetzung.ts) — nur der Text eines Knotens wird überschrieben. Ändert React den
//     Text später, schreibt es wieder Deutsch hinein, und der Beobachter übersetzt erneut.
//   · Inhalte der Nutzer bleiben, wie sie sind: Alles unter translate="no", in Editoren und Eingaben wird
//     übersprungen (dieselben Marken wie für die Übersetzung des Browsers, M368).
//   · Vorlagen mit Einsetzungen („Board „{0}" angelegt.") sind im Wörterbuch Muster; eingesetzte Namen
//     bleiben, eingesetzte Oberflächen-Wörter werden mitübersetzt.
//   · Das Wörterbuch wird erst geladen, wenn Englisch gewählt ist. Deutsch kostet nichts.
//
// Die Sprache gilt je Gerät. Ein Wechsel lädt die Seite neu: Editoren, Datumsformate und die Hilfe richten
// sich beim Start ein — ein Umschalten im laufenden Betrieb wäre nur an hundert Stellen halb richtig.
// Dass kein Text ohne Übersetzung bleibt, prüft pruefungen/m381 (werkzeug/sprache-ernten.mjs --fehlend).

export type Sprache = 'de' | 'en';
const KEY = 'pixinotes-sprache';

const gewaehlt = (): Sprache => {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'de'; } catch { return 'de'; }
};
let aktiv: Sprache = 'de';
/** Die Sprache, in der die Oberfläche gerade läuft */
export const sprache = (): Sprache => aktiv;
/** Sprache wählen — lädt die Seite neu (der Stand liegt im Speicher) */
export function spracheSetzen(s: Sprache): void {
  try { localStorage.setItem(KEY, s); } catch { /* privates Fenster: gilt dann nur bis zum Schließen nicht */ }
  if (s !== aktiv) location.reload();
}

// ---------- Wörterbuch ----------
let exakt = new Map<string, string>();
interface Muster { re: RegExp; en: string; gewicht: number; /** Gruppen, die im Deutschen eine Mehrzahl-Endung tragen („Tag{1}" → „Tage") */ endung: Set<number> }
/** Deutsche Mehrzahl-Endungen, wie der Quelltext sie anhängt — auf Englisch wird daraus „s" */
const ENDUNG = /^(e|en|n|er|ern|s|se|änge|öcke|üsse)$/;
/** … und Einzahl-Reste von Wörtern, deren Mehrzahl umlautet („Vorg{1}": ang/änge) — auf Englisch nichts */
const EINZAHL = /^(ang|ock|uss)$/;
let muster: Muster[] = [];
/** Was der Übersetzer selbst geschrieben hat — englische Texte sind keine Lücken */
const eigene = new Set<string>();
/** Geprüfte Texte: Deutsch → Englisch oder null (kein Eintrag) */
const merk = new Map<string, string | null>();
/** Deutsche Texte ohne Eintrag (für die Prüfreihe und die Pflege des Wörterbuchs) */
const luecken = new Set<string>();

const TASTEN: Record<string, string> = { Strg: 'Ctrl', Umschalt: 'Shift', Entf: 'Del', Leertaste: 'Space', Eingabe: 'Enter', Rücktaste: 'Backspace', Pos1: 'Home', Ende: 'End', 'Bild↑': 'PgUp', 'Bild↓': 'PgDn', Einfg: 'Ins', Pfeiltasten: 'Arrow keys', Pfeil: 'Arrow' };
const TASTE = /Strg|Umschalt|Entf|Leertaste|Eingabe|Rücktaste|Pos1|Bild[↑↓]|Einfg|Pfeil/;
const maskiert = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function ladeWoerterbuch(wb: Record<string, string>): void {
  exakt = new Map(); muster = [];
  for (const [de, en] of Object.entries(wb)) {
    if (typeof en !== 'string' || !en) continue;
    if (!/\{\d+\}/.test(de)) { exakt.set(de, en); eigene.add(en); continue; }
    // Muster: feste Teile wörtlich, {n} als Gruppe. Zu allgemeine Muster („{0} {1}") würden alles treffen.
    const fest = de.replace(/\{\d+\}/g, '');
    if ((fest.match(/[A-Za-zÄÖÜäöüß]/g) ?? []).length < 3) continue;
    const reihenfolge: number[] = [];
    const endung = new Set<number>();
    const teile = de.split(/(\{\d+\})/);
    const quelle = teile.map((teil, i) => {
      const m = /^\{(\d+)\}$/.exec(teil);
      if (!m) return maskiert(teil);
      // direkt an ein Wort gehängt und danach kein Buchstabe: eine Endung („Ticket{1} älter"), kein Name
      if (/[A-Za-zÄÖÜäöüß]$/.test(teile[i - 1] ?? '') && !/^[A-Za-zÄÖÜäöüß„"]/.test(teile[i + 1] ?? '')) endung.add(reihenfolge.length);
      reihenfolge.push(Number(m[1]));
      return '([\\s\\S]*?)';
    }).join('');
    // die Gruppen stehen in der Reihenfolge des deutschen Textes — auf {n} zurückführen
    let en2 = en;
    reihenfolge.forEach((n, i) => { en2 = en2.replace(new RegExp(`\\{${n}\\}`, 'g'), `\u0001${i}\u0002`); });
    muster.push({ re: new RegExp(`^${quelle}$`), en: en2, gewicht: fest.length, endung });
  }
  muster.sort((a, b) => b.gewicht - a.gewicht);   // das genaueste Muster zuerst
}

/** Deutsch → Englisch für einen bereinigten Text (ohne Rand-Leerraum); null = kein Eintrag */
function schlageNach(kern: string): string | null {
  const bekannt = merk.get(kern);
  if (bekannt !== undefined) return bekannt;
  let en: string | null = exakt.get(kern) ?? null;
  if (en === null) {
    for (const m of muster) {
      const t = m.re.exec(kern);
      if (!t) continue;
      // Eingesetztes: Namen bleiben; steht dort selbst ein Wort der Oberfläche, wird es mitübersetzt
      en = m.en.replace(/\u0001(\d+)\u0002/g, (_, i: string) => {
        const teil = t[Number(i) + 1] ?? '';
        if (m.endung.has(Number(i)) && (teil === '' || ENDUNG.test(teil) || EINZAHL.test(teil))) return ENDUNG.test(teil) ? 's' : '';
        // Rand-Leerraum des Eingesetzten bleibt („zum Lesen " + „freigegeben")
        const r = /^(\s*)([\s\S]*?)(\s*)$/.exec(teil);
        const innen = r ? exakt.get(r[2]) : undefined;
        return innen !== undefined && r ? r[1] + innen + r[3] : teil;
      });
      break;
    }
  }
  // Tastenkürzel werden zusammengesetzt („Strg+Umschalt+Z") — die Namen der Tasten einzeln übersetzen
  if (en === null && TASTE.test(kern) && /^[^a-zäöü]*([A-ZÄÖÜ][A-Za-zäöü0-9↑↓]*|[^A-Za-zäöü])([+ /,·–-]+([A-ZÄÖÜ][A-Za-zäöü0-9↑↓]*|[^A-Za-zäöü]))*$/.test(kern)) {
    en = kern.replace(/Strg|Umschalt|Entf|Leertaste|Eingabe|Rücktaste|Pos1|Ende|Bild↑|Bild↓|Einfg|Pfeiltasten|Pfeil/g, (w) => TASTEN[w] ?? w);
  }
  if (merk.size > 6000) merk.clear();
  merk.set(kern, en);
  if (en !== null) eigene.add(en);
  return en;
}

const HAT_BUCHSTABEN = /[A-Za-zÄÖÜäöüß]{2}/;
/** Einen Text der Oberfläche übersetzen (für Dialoge des Browsers und Texte, die nicht im Dokument stehen) */
export function t(text: string): string {
  if (aktiv !== 'en' || !text) return text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m) return text;
  const kern = m[2].replace(/\s+/g, ' ');
  if (!HAT_BUCHSTABEN.test(kern)) return text;
  const en = schlageNach(kern);
  if (en === null) { if (!eigene.has(kern)) luecken.add(kern); return text; }
  return m[1] + en + m[3];
}

/**
 * Der Name einer Karte in Listen (Navigation): Hat die Karte keinen eigenen Titel, steht dort eine allgemeine
 * Bezeichnung aus dem Text der Karte („Kalender (Monatsansicht)", „Projekt-Portal"). Die Liste gilt als Inhalt
 * (translate="no") — eigene Titel bleiben also unberührt, nur diese allgemeinen Bezeichnungen werden englisch.
 */
export function kartenName(name: string): string {
  if (aktiv !== 'en') return name;
  const fest: Record<string, string> = { 'Diagramm:': 'Diagram', 'Projekt-Portal': 'Project portal', Karte: 'Card', Zeitplan: 'Timeline' };
  if (fest[name]) return fest[name];
  return name
    .replace(/^Kalender \(Monatsansicht( [^)]*)?\)$/, 'Calendar (month view$1)')
    .replace(/^Rahmen: /, 'Frame: ')
    .replace(/^Eigene App: /, 'HTML tool: ')
    .replace(/^E-Mail: /, 'Email: ');
}

/**
 * M455: Kalenderwoche als kurzes Schild („KW 48" / „Wk 48"). Das Wörterbuch kann „KW {0}" nicht als Muster
 * führen (zu wenig feste Buchstaben, siehe ladeWoerterbuch) — und wer die Breite des Schilds misst
 * (Gantt-Kopfzeile), braucht den Text, der wirklich gezeichnet wird, nicht den deutschen.
 */
export const kwText = (n: number | string): string => (aktiv === 'en' ? `Wk ${n}` : `KW ${n}`);

// ---------- Beobachter ----------
/** Bereiche, in denen nichts übersetzt wird: Inhalte der Nutzer, Editoren, Code */
const AUS = '[translate="no"], [contenteditable="true"], [contenteditable=""], .bn-editor, .ProseMirror, script, style, textarea, code, [data-sprache="aus"]';
const ATTRIBUTE = ['title', 'aria-label', 'placeholder', 'alt'] as const;

/** Was zuletzt in einen Knoten bzw. ein Attribut geschrieben wurde — das eigene Englisch wird nicht noch einmal übersetzt */
const geschrieben = new WeakMap<Node, string>();
const geschriebenAttr = new WeakMap<Element, Partial<Record<(typeof ATTRIBUTE)[number], string>>>();

function textKnoten(n: Text): void {
  const roh = n.data;
  if (!roh || geschrieben.get(n) === roh) return;
  // Eine Mehrzahl-Endung als eigener Knoten („Tag" + „e"): Sie gehört zum übersetzten Wort davor
  if ((ENDUNG.test(roh) || EINZAHL.test(roh)) && n.previousSibling?.nodeType === 3 && geschrieben.has(n.previousSibling) && !n.parentElement?.closest(AUS)) {
    const en = ENDUNG.test(roh) ? 's' : '';
    geschrieben.set(n, en); n.data = en;
    return;
  }
  if (!HAT_BUCHSTABEN.test(roh)) return;
  const eltern = n.parentElement;
  if (!eltern || eltern.closest(AUS)) return;
  const en = t(roh);
  if (en !== roh) { geschrieben.set(n, en); n.data = en; }
}
function attribute(el: Element): void {
  for (const a of ATTRIBUTE) {
    const roh = el.getAttribute(a);
    if (!roh || !HAT_BUCHSTABEN.test(roh) || geschriebenAttr.get(el)?.[a] === roh) continue;
    // Beschriftungen gelten auch in Bereichen mit eigenen Inhalten (ein Knopf in einer Karte) — nur nicht dort,
    // wo das Attribut selbst Inhalt ist (Bild-Beschreibung eines Nutzers: alt unter translate="no")
    if (a === 'alt' && el.closest('[translate="no"]')) continue;
    const en = t(roh);
    if (en !== roh) { geschriebenAttr.set(el, { ...geschriebenAttr.get(el), [a]: en }); el.setAttribute(a, en); }
  }
}
function baum(wurzel: Node): void {
  if (wurzel.nodeType === 3) { textKnoten(wurzel as Text); return; }
  if (wurzel.nodeType !== 1) return;
  const el = wurzel as Element;
  if (el.matches('script, style')) return;
  attribute(el);
  const lauf = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let k = lauf.nextNode(); k; k = lauf.nextNode()) {
    if (k.nodeType === 3) textKnoten(k as Text); else attribute(k as Element);
  }
}

/** Datumsangaben: Die Oberfläche formatiert mit 'de-DE' — auf Englisch wird daraus 'en-GB' (Tag vor Monat bleibt) */
function datumAufEnglisch(): void {
  const ort = (l: unknown): unknown => (typeof l === 'string' && /^de\b/i.test(l) ? 'en-GB' : l);
  for (const name of ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'] as const) {
    const alt = Date.prototype[name] as (this: Date, l?: unknown, o?: unknown) => string;
    Date.prototype[name] = function (this: Date, l?: unknown, o?: unknown) { return alt.call(this, ort(l), o); } as typeof Date.prototype.toLocaleString;
  }
  const Alt = Intl.DateTimeFormat;
  const Neu = function (this: unknown, l?: unknown, o?: Intl.DateTimeFormatOptions) { return new Alt(ort(l) as string | undefined, o); } as unknown as typeof Intl.DateTimeFormat;
  Object.defineProperty(Neu, 'prototype', { value: Alt.prototype });
  Neu.supportedLocalesOf = Alt.supportedLocalesOf.bind(Alt);
  Intl.DateTimeFormat = Neu;
}

/**
 * Vor dem ersten Rendern aufrufen. Ist Englisch gewählt, wird das Wörterbuch geladen und der Beobachter
 * gestartet; scheitert das Laden (offline, alte Fassung), bleibt die Oberfläche deutsch.
 */
export async function initSprache(): Promise<void> {
  if (gewaehlt() !== 'en' || typeof MutationObserver === 'undefined') return;
  try {
    const wb = (await import('../sprache/en.json')).default as Record<string, string>;
    ladeWoerterbuch(wb);
  } catch {
    return;
  }
  aktiv = 'en';
  document.documentElement.lang = 'en';
  datumAufEnglisch();
  // Dialoge des Browsers stehen nicht im Dokument — ihr Text wird beim Aufruf übersetzt
  const frage = window.confirm.bind(window), eingabe = window.prompt.bind(window), meldung = window.alert.bind(window);
  window.confirm = (m?: string) => frage(m === undefined ? m : t(m));
  window.prompt = (m?: string, v?: string) => eingabe(m === undefined ? m : t(m), v);
  window.alert = (m?: unknown) => meldung(typeof m === 'string' ? t(m) : m);
  baum(document.documentElement);
  new MutationObserver((liste) => {
    for (const m of liste) {
      if (m.type === 'characterData') { if (m.target.nodeType === 3) textKnoten(m.target as Text); }
      else if (m.type === 'attributes') attribute(m.target as Element);
      else m.addedNodes.forEach(baum);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTE] });
  // Für die Prüfreihe und die Pflege: welche deutschen Texte hatten keinen Eintrag?
  (window as unknown as { __pnSprachLuecken?: () => string[] }).__pnSprachLuecken = () => [...luecken];
}
