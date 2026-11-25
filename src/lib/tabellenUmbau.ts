/**
 * M528: Zeilen und Spalten einfügen und löschen — an beliebiger Stelle, wie in Excel und LibreOffice — und das
 * Mischen zweier Geräte, wenn eines davon umgebaut hat.
 *
 * Ein Umbau verschiebt alles, was an Adressen hängt: Zellen, Links, Aussehen, verbundene Zellen, Spaltenbreiten, die
 * Kopfzeile der Datentabelle, Filter und Sortierung — und die Bezüge in JEDER Formel (lib/formelPlus.ts →
 * bezuegeUmbauen): Bezüge hinter der Einfügestelle wandern mit, Bereiche wachsen oder schrumpfen, ein Bezug auf eine
 * gelöschte Zelle wird #BEZUG!.
 *
 * Abgleich (M524 mischt Feld für Feld): `cells` ist EIN Feld — fügte Gerät A eine Zeile ein und tippte Gerät B
 * gleichzeitig in eine Zelle, galt „beide geändert, die hiesige bleibt" und eine der beiden Änderungen war weg. Darum
 * trägt jede Tabelle ihr Umbau-Protokoll (`umbau`, die letzten UMBAU_MAX Schritte mit Kennung). Beim Mischen wird die
 * Seite ohne den neuen Umbau durch ihn geschickt (dieselbe Rechnung wie beim Umbau selbst, auf jedem Gerät gleich),
 * danach entscheidet jede ZELLE für sich (dreiwegig wie M524 für Felder). Haben beide Seiten umgebaut, bleibt es beim
 * bisherigen Weg (die hiesige Fassung, mit Konflikt-Hinweis).
 */
import { adresseZuIndex, indexZuAdresse } from './formel';
import { bezuegeUmbauen, spalteBuchstaben, spalteNr, umbauNummer, umbauSpanne, type UmbauSchritt } from './formelPlus';
import { kanonText } from './abgleichZeiten';
import { tabellenMischen } from './syncMerge';
import type { SheetData } from '../types';

export interface Umbau extends UmbauSchritt { id: string }
/** So viele Schritte reisen mit — ein Gerät, das länger offline war, mischt danach wie bisher Feld für Feld */
export const UMBAU_MAX = 40;

type Daten = Record<string, unknown>;
const neueId = (): string => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const umbauNeu = (a: 'z' | 's', bei: number, n: number): Umbau => ({ id: neueId(), a, bei, n });

/** Eine Adresse durch den Umbau schicken; null = die Zelle wurde gelöscht */
function adresseUmbauen(adr: string, u: UmbauSchritt): string | null {
  const x = adresseZuIndex(adr);
  if (!x) return adr;
  const s = u.a === 's' ? umbauNummer(x.spalte, u) : x.spalte;
  const z = u.a === 'z' ? umbauNummer(x.zeile, u) : x.zeile;
  return s === null || z === null ? null : indexZuAdresse(s, z);
}
function schluessel<T>(m: Record<string, T> | undefined, neu: (k: string) => string | null, wert?: (v: T) => T): Record<string, T> | undefined {
  if (!m) return m;
  const aus: Record<string, T> = {};
  for (const [k, v] of Object.entries(m)) {
    const n = neu(k);
    if (n !== null) aus[n] = wert ? wert(v) : v;
  }
  return Object.keys(aus).length ? aus : undefined;
}

/**
 * Den Umbau auf die Daten einer Tabelle anwenden. Liefert die geänderten Felder (für EIN updateNodeData = ein
 * Rückgängig-Schritt). `protokoll: false` beim Nachspielen im Abgleich (der Schritt steht dort schon im Protokoll).
 */
export function umbauAnwenden(d: SheetData, u: Umbau, protokoll = true): Partial<SheetData> {
  const zeilen = u.a === 'z';
  const patch: Partial<SheetData> = {};
  patch.cells = schluessel(d.cells, (k) => adresseUmbauen(k, u), (v) => (typeof v === 'string' && v.startsWith('=') ? bezuegeUmbauen(v, u) : v)) ?? {};
  if (d.links) patch.links = schluessel(d.links, (k) => adresseUmbauen(k, u));
  if (d.stile) patch.stile = schluessel(d.stile, (k) => adresseUmbauen(k, u));
  if (zeilen) {
    patch.rows = Math.max(1, (d.rows ?? 8) + u.n);
    if (d.kopf !== undefined) { const k = umbauNummer(d.kopf - 1, u); patch.kopf = k === null ? undefined : k + 1; }
    if (d.bis !== undefined) {
      const b = umbauNummer(d.bis - 1, u) ?? u.bei - 1;
      patch.bis = b < 0 || (patch.kopf ?? d.kopf ?? 1) > b + 1 ? undefined : b + 1;
    }
  } else {
    patch.cols = Math.max(1, (d.cols ?? 5) + u.n);
    const sp = (k: string): string | null => { const n = umbauNummer(spalteNr(k), u); return n === null ? null : spalteBuchstaben(n); };
    if (d.colW) patch.colW = schluessel(d.colW, sp);
    if (d.filter) patch.filter = schluessel(d.filter, sp);
    if (d.sort) { const n = sp(d.sort.spalte); patch.sort = n === null ? undefined : { ...d.sort, spalte: n }; }
  }
  if (d.verbunden) {
    const v: string[] = [];
    for (const ref of d.verbunden) {
      const [p, q] = ref.split(':').map((x) => adresseZuIndex(x));
      if (!p || !q) { v.push(ref); continue; }
      const sp = umbauSpanne(zeilen ? p.zeile : p.spalte, zeilen ? q.zeile : q.spalte, u);
      if (!sp) continue;
      v.push(zeilen
        ? `${indexZuAdresse(p.spalte, sp[0])}:${indexZuAdresse(q.spalte, sp[1])}`
        : `${indexZuAdresse(sp[0], p.zeile)}:${indexZuAdresse(sp[1], q.zeile)}`);
    }
    patch.verbunden = v.length ? v : undefined;
  }
  if (protokoll) patch.umbau = [...((d.umbau as Umbau[] | undefined) ?? []), u].slice(-UMBAU_MAX);
  return patch;
}

// ───────────────────────────── Abgleich ─────────────────────────────

const FELDER = ['cells', 'links', 'stile', 'colW', 'filter', 'rows', 'cols', 'kopf', 'bis', 'sort', 'verbunden', 'umbau'] as const;
const gleich = (x: unknown, y: unknown): boolean => x === y || kanonText(x) === kanonText(y);

/** Mehrere Umbauten nacheinander auf die Tabellen-Felder anwenden */
function nachspielen(d: Daten, schritte: Umbau[]): Daten {
  let x = d;
  for (const u of schritte) x = { ...x, ...umbauAnwenden(x as SheetData, u, false) };
  return x;
}
/** Je Schlüssel dreiwegig: nur drüben geändert → drüben; beide verschieden → hier (Konflikt) */
function je3<T>(B: Record<string, T> | undefined, L: Record<string, T> | undefined, F: Record<string, T> | undefined, k: { konflikt: boolean }): Record<string, T> | undefined {
  const b = B ?? {}, l = L ?? {}, f = F ?? {};
  let aus: Record<string, T> | null = null;
  for (const s of new Set([...Object.keys(l), ...Object.keys(f), ...Object.keys(b)])) {
    if (gleich(l[s], f[s])) continue;
    if (gleich(l[s], b[s])) { aus ??= { ...l }; if (f[s] === undefined) delete aus[s]; else aus[s] = f[s]; }
    else if (!gleich(f[s], b[s])) k.konflikt = true;
  }
  if (!aus) return L;
  return Object.keys(aus).length ? aus : undefined;
}
function eins3(B: unknown, L: unknown, F: unknown, k: { konflikt: boolean }): unknown {
  if (gleich(L, F) || gleich(F, B)) return L;
  if (gleich(L, B)) return F;
  k.konflikt = true;
  return L;
}

/**
 * Die Tabellen-Felder zweier Fassungen mischen. null: geht nicht nach Protokoll (beide haben umgebaut, oder das
 * gemeinsame Protokoll reicht nicht so weit zurück) → der Aufrufer mischt Feld für Feld wie bisher.
 */
export function tabelleMischen(B: Daten, L: Daten, F: Daten): { daten: Daten; konflikt: boolean } | null {
  const pb = (B.umbau as Umbau[] | undefined) ?? [], pl = (L.umbau as Umbau[] | undefined) ?? [], pf = (F.umbau as Umbau[] | undefined) ?? [];
  const ids = (p: Umbau[]) => new Set(p.map((u) => u.id));
  const letzte = pb[pb.length - 1]?.id;
  if (letzte && (!ids(pl).has(letzte) || !ids(pf).has(letzte))) return null;
  const inB = ids(pb);
  const neuL = pl.filter((u) => !inB.has(u.id)), neuF = pf.filter((u) => !inB.has(u.id));
  // gemeinsam Neues (ein Gerät hat den Umbau des anderen schon übernommen) muss vorn stehen
  let g = 0;
  while (g < neuL.length && g < neuF.length && neuL[g].id === neuF[g].id) g += 1;
  const nurL = neuL.slice(g), nurF = neuF.slice(g);
  if (nurL.length && nurF.length) return null;
  const B1 = nachspielen(B, neuL.slice(0, g));
  const [B2, L2, F2] = nurF.length
    ? [nachspielen(B1, nurF), nachspielen(L, nurF), F]
    : [nachspielen(B1, nurL), L, nachspielen(F, nurL)];
  const k = { konflikt: false };
  const daten: Daten = {};
  for (const f of ['cells', 'links', 'stile', 'colW', 'filter'] as const) daten[f] = je3(B2[f] as Daten, L2[f] as Daten, F2[f] as Daten, k);
  for (const f of ['kopf', 'bis', 'sort', 'verbunden'] as const) daten[f] = eins3(B2[f], L2[f], F2[f], k);
  // Zeilen und Spalten: hat jede Seite angehängt, gilt das Größere (nichts fällt heraus)
  for (const f of ['rows', 'cols'] as const) {
    daten[f] = gleich(L2[f], B2[f]) ? F2[f] : gleich(F2[f], B2[f]) ? L2[f] : Math.max(Number(L2[f] ?? 0), Number(F2[f] ?? 0)) || L2[f];
  }
  daten.umbau = [...pb, ...neuL.slice(0, g), ...nurF, ...nurL].slice(-UMBAU_MAX);
  // Was sich gegenüber hier nicht geändert hat, bleibt das hiesige Objekt (M524)
  for (const f of FELDER) if (gleich(daten[f], L[f])) daten[f] = L[f];
  return { daten, konflikt: k.konflikt };
}

tabellenMischen.f = tabelleMischen;
tabellenMischen.felder = FELDER;

// ───────────────────────────── Zwischenablage ─────────────────────────────

/** Tabulator-Text (Excel, LibreOffice, Google Sheets) → Zeilen und Zellen; Zellen in "…" dürfen Tabs und Umbrüche tragen */
export function tsvLesen(text: string): string[][] {
  const zeilen: string[][] = [];
  let zeile: string[] = []; let zelle = ''; let i = 0;
  const t = text.replace(/\r\n?/g, '\n');
  while (i <= t.length) {
    const c = t[i];
    if (zelle === '' && c === '"' && t.indexOf('"', i + 1) > 0) {
      // in Anführungszeichen: bis zum schließenden ", "" ist ein "
      let j = i + 1; let s = '';
      for (;;) {
        const q = t.indexOf('"', j);
        if (q < 0) { s += t.slice(j); j = t.length; break; }
        s += t.slice(j, q);
        if (t[q + 1] === '"') { s += '"'; j = q + 2; continue; }
        j = q + 1; break;
      }
      if (j >= t.length || t[j] === '\t' || t[j] === '\n') { zelle = s; i = j; continue; }
      zelle = t.slice(i, j); i = j; continue;   // kein sauberes Ende: wörtlich nehmen
    }
    if (c === undefined || c === '\n') {
      zeile.push(zelle); zeilen.push(zeile); zeile = []; zelle = ''; i += 1; continue;
    }
    if (c === '\t') { zeile.push(zelle); zelle = ''; i += 1; continue; }
    zelle += c; i += 1;
  }
  // die letzte Zeile ist leer, wenn der Text mit einem Umbruch endete (Excel tut das)
  while (zeilen.length > 1 && zeilen[zeilen.length - 1].every((x) => x === '')) zeilen.pop();
  return zeilen;
}

/** Zeilen und Zellen → Tabulator-Text; Zellen mit Tab, Umbruch oder " in Anführungszeichen (wie Excel) */
export function tsvSchreiben(zeilen: string[][]): string {
  return zeilen.map((z) => z.map((x) => (/[\t\n"]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join('\t')).join('\n');
}
