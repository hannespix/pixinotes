/**
 * M528: Was die Rechen-Tabelle über den Grundrechner (lib/formel.ts) hinaus kann — nachgeladen mit der Tabelle,
 * damit das Start-Paket nicht wächst (der Grundrechner liegt dort, weil Suche und Export Tabellen als Text lesen).
 *
 *  · ganze Spalten und Zeilen als Bereich: =SUMME(A:A), =MITTELWERT(B:D), =ANZAHL(1:1) — es zählen nur belegte
 *    Zellen; steht die Formel selbst im Bereich, ist das ein Ring (#ZYKLUS!) wie bei jedem anderen Bezug
 *  · Datumsrechnung: =HEUTE()+1, =HEUTE()-A1, Datum − Datum = Tage, Datum ± Zahl = Datum; dazu JETZT, DATUM,
 *    JAHR, MONAT, TAG (deutsch und englisch). Ein Datum ist ein Text „2026-11-25" (so lieferte HEUTE() es schon
 *    immer) oder eine eingetippte Angabe „25.11.2026"; angezeigt wird es im Format der Oberfläche.
 *  · Fehlerwerte in Formeln (#BEZUG! bzw. #REF!) — so steht ein Bezug auf eine gelöschte Zelle in der Formel
 *  · Bezüge umschreiben: beim Einfügen/Löschen von Zeilen und Spalten (lib/tabellenUmbau.ts) und beim Kopieren
 *    (relative Bezüge wandern mit, $-Bezüge nicht) — über dieselben Zeichen, mit denen der Rechner liest
 */
import { ALIAS, FEHLER, FUNKTIONEN, adresseZuIndex, indexZuAdresse, plus, zerteile, zuZahl, type Lage, type ZellWert, type Zeichen } from './formel';
import { sprache } from './sprache';

// ───────────────────────────── ganze Spalten / Zeilen, Fehlerwerte ─────────────────────────────

/** Spaltenbuchstaben → Nummer ab 0 („A" → 0, „AA" → 26) */
export const spalteNr = (b: string): number => [...b.toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
/** Nummer ab 0 → Spaltenbuchstaben */
export const spalteBuchstaben = (s: number): string => indexZuAdresse(s, 0).replace(/\d+/g, '');

const FEHLER_NAMEN: Record<string, string> = {
  'BEZUG!': FEHLER.bezug, 'REF!': FEHLER.bezug, 'WERT!': FEHLER.wert, 'VALUE!': FEHLER.wert, 'DIV/0!': FEHLER.division,
  'NAME?': FEHLER.name, 'ZYKLUS!': FEHLER.zyklus, 'CIRCULAR!': FEHLER.zyklus,
};
const VOR = /[A-Za-z0-9_ÄÖÜäöüß$.,]/;

plus.lex = (f: string, i: number): [Zeichen, number] | null => {
  if (f[i] === '#') {
    const m = /^#(BEZUG!|REF!|WERT!|VALUE!|DIV\/0!|NAME\?|ZYKLUS!|CIRCULAR!)/i.exec(f.slice(i));
    return m ? [{ art: 'plus', wert: `F${FEHLER_NAMEN[m[1].toUpperCase()]}` }, i + m[0].length] : null;
  }
  if (i > 0 && VOR.test(f[i - 1])) return null;
  const rest = f.slice(i, i + 24);
  const sp = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?![A-Za-z0-9_ÄÖÜäöüß$.(])/.exec(rest);
  if (sp) return [{ art: 'plus', wert: `S${sp[1].toUpperCase()}:${sp[2].toUpperCase()}` }, i + sp[0].length];
  const ze = /^\$?(\d{1,7}):\$?(\d{1,7})(?![0-9.,A-Za-z])/.exec(rest);
  if (ze && Number(ze[1]) > 0 && Number(ze[2]) > 0) return [{ art: 'plus', wert: `Z${ze[1]}:${ze[2]}` }, i + ze[0].length];
  return null;
};

plus.wert = (t: Zeichen, l: Lage): ZellWert | ZellWert[] => {
  const w = String(t.wert);
  if (w[0] === 'F') return w.slice(1);
  if (!l.belegt) return FEHLER.bezug;
  const [a, b] = w.slice(1).split(':');
  const spalten = w[0] === 'S';
  const von = spalten ? spalteNr(a) : Number(a) - 1;
  const bis = spalten ? spalteNr(b) : Number(b) - 1;
  const lo = Math.min(von, bis), hi = Math.max(von, bis);
  const treffer: Array<{ s: number; z: number; adr: string }> = [];
  for (const adr of l.belegt()) {
    const x = adresseZuIndex(adr);
    if (!x) continue;
    const k = spalten ? x.spalte : x.zeile;
    if (k >= lo && k <= hi) treffer.push({ s: x.spalte, z: x.zeile, adr });
  }
  treffer.sort((p, q) => p.z - q.z || p.s - q.s);
  return treffer.map((x) => l.lies(x.adr));
};

// ───────────────────────────── Datum ─────────────────────────────

const TAG_MS = 864e5;
/** Ein Datum als Tage seit 1.1.1970 (mit Bruchteil für die Uhrzeit) — „wie an der Wand", ohne Zeitzone */
export function tageVon(v: ZellWert): number | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  let j: number, m: number, d: number, h = 0, mi = 0, se = 0;
  let x = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (x) { [j, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])]; h = Number(x[4] ?? 0); mi = Number(x[5] ?? 0); se = Number(x[6] ?? 0); }
  else {
    x = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?:,?\s+(\d{1,2}):(\d{2}))?$/.exec(t);
    if (!x) return null;
    [d, m, j] = [Number(x[1]), Number(x[2]), Number(x[3])];
    if (x[3].length === 2) j += 2000;
    h = Number(x[4] ?? 0); mi = Number(x[5] ?? 0);
  }
  if (m < 1 || m > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return null;
  const ms = Date.UTC(j, m - 1, d, h, mi, se);
  if (new Date(ms).getUTCDate() !== d) return null;        // 31.02. gibt es nicht
  return ms / TAG_MS;
}
const istMitZeit = (v: ZellWert): boolean => typeof v === 'string' && /\d:\d{2}/.test(v);
/** Tage → „2026-11-25" bzw. mit Uhrzeit „2026-11-25T14:30" */
export function datumAus(tage: number, mitZeit: boolean): string {
  const ms = Math.round(tage * TAG_MS / 6e4) * 6e4;
  const iso = new Date(ms).toISOString();
  return mitZeit && ms % TAG_MS !== 0 ? iso.slice(0, 16) : iso.slice(0, 10);
}
const genau = (n: number): number => Math.round(n * 1e6) / 1e6;

plus.rechne = (op: string, a: ZellWert, b: ZellWert): ZellWert | undefined => {
  const da = tageVon(a), db = tageVon(b);
  if (da === null && db === null) return undefined;
  if (op === '+' || op === '-') {
    if (da !== null && db !== null) return op === '-' ? genau(da - db) : FEHLER.wert;
    if (da === null) {                                      // Zahl + Datum geht, Zahl − Datum nicht
      const n = zuZahl(a);
      return op === '+' && n !== null ? datumAus(db! + n, istMitZeit(b) || !Number.isInteger(n)) : FEHLER.wert;
    }
    const n = zuZahl(b);
    if (n === null) return FEHLER.wert;
    return datumAus(op === '+' ? da + n : da - n, istMitZeit(a) || !Number.isInteger(n));
  }
  if (da === null || db === null) return undefined;         // Datum gegen Text/Zahl: wie bisher
  switch (op) {
    case '=': return da === db;
    case '<>': return da !== db;
    case '<': return da < db;
    case '>': return da > db;
    case '<=': return da <= db;
    case '>=': return da >= db;
    default: return undefined;
  }
};

const erstes = (a: (ZellWert | ZellWert[])[], i = 0): ZellWert => { const x = a[i]; return Array.isArray(x) ? x[0] ?? null : x ?? null; };
const teil = (welcher: 0 | 1 | 2) => (a: (ZellWert | ZellWert[])[]): ZellWert => {
  const t = tageVon(erstes(a));
  if (t === null) return FEHLER.wert;
  const d = new Date(Math.floor(t) * TAG_MS);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()][welcher];
};
Object.assign(FUNKTIONEN, {
  JETZT: () => {
    const d = new Date();
    return datumAus(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / TAG_MS, true);
  },
  DATUM: (a: (ZellWert | ZellWert[])[]) => {
    const [j, m, t] = [0, 1, 2].map((i) => zuZahl(erstes(a, i)));
    if (j === null || m === null || t === null) return FEHLER.wert;
    return datumAus(Date.UTC(Math.trunc(j), Math.trunc(m) - 1, Math.trunc(t)) / TAG_MS, false);
  },
  JAHR: teil(0), MONAT: teil(1), TAG: teil(2),
});
Object.assign(ALIAS, { NOW: 'JETZT', DATE: 'DATUM', YEAR: 'JAHR', MONTH: 'MONAT', DAY: 'TAG' });

// ───────────────────────────── Anzeige ─────────────────────────────

const EN_FEHLER: Record<string, string> = { [FEHLER.bezug]: '#REF!', [FEHLER.wert]: '#VALUE!', [FEHLER.zyklus]: '#CIRCULAR!' };
plus.zeige = (v: string): string | undefined => {
  const en = sprache() === 'en';
  if (v[0] === '#') return en ? EN_FEHLER[v] : undefined;
  const x = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?$/.exec(v);
  if (!x || tageVon(v) === null) return undefined;
  return (en ? `${x[3]}/${x[2]}/${x[1]}` : `${x[3]}.${x[2]}.${x[1]}`) + (x[4] ? ` ${x[4]}` : '');
};

// ───────────────────────────── Bezüge umschreiben ─────────────────────────────

/** Eine Stelle eines Bezugs: Nummer ab 0 und ob sie mit $ festgehalten ist */
export interface Stelle { i: number; fest: boolean }
export type Bezug =
  | { art: 'zelle'; s: Stelle; z: Stelle }
  | { art: 'bereich'; a: { s: Stelle; z: Stelle }; b: { s: Stelle; z: Stelle } }
  | { art: 'spalten'; a: Stelle; b: Stelle }
  | { art: 'zeilen'; a: Stelle; b: Stelle };

/** Größte Spalte und Zeile, die ein Bezug nennen darf (wie Excel: XFD, 1 048 576) */
export const SPALTEN_MAX = 16384, ZEILEN_MAX = 1048576;

function zelleLesen(roh: string): { s: Stelle; z: Stelle } | null {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/.exec(roh);
  if (!m) return null;
  return { s: { i: spalteNr(m[2]), fest: !!m[1] }, z: { i: Number(m[4]) - 1, fest: !!m[3] } };
}
const spalteText = (x: Stelle): string => `${x.fest ? '$' : ''}${spalteBuchstaben(x.i)}`;
const zeileText = (x: Stelle): string => `${x.fest ? '$' : ''}${x.i + 1}`;
const zelleText = (c: { s: Stelle; z: Stelle }): string => spalteText(c.s) + zeileText(c.z);
export function bezugText(b: Bezug): string {
  switch (b.art) {
    case 'zelle': return zelleText(b);
    case 'bereich': return `${zelleText(b.a)}:${zelleText(b.b)}`;
    case 'spalten': return `${spalteText(b.a)}:${spalteText(b.b)}`;
    default: return `${zeileText(b.a)}:${zeileText(b.b)}`;
  }
}
const imRahmen = (b: Bezug): boolean => {
  const ok = (s: Stelle | null, max: number): boolean => !s || (s.i >= 0 && s.i < max);
  switch (b.art) {
    case 'zelle': return ok(b.s, SPALTEN_MAX) && ok(b.z, ZEILEN_MAX);
    case 'bereich': return ok(b.a.s, SPALTEN_MAX) && ok(b.a.z, ZEILEN_MAX) && ok(b.b.s, SPALTEN_MAX) && ok(b.b.z, ZEILEN_MAX);
    case 'spalten': return ok(b.a, SPALTEN_MAX) && ok(b.b, SPALTEN_MAX);
    default: return ok(b.a, ZEILEN_MAX) && ok(b.b, ZEILEN_MAX);
  }
};
/** So steht ein Bezug auf eine gelöschte Zelle in der Formel (in der Sprache der Oberfläche; gelesen wird beides) */
export const bezugFehlerText = (): string => (sprache() === 'en' ? '#REF!' : FEHLER.bezug);

/**
 * Jeden Bezug einer Formel durch `fn` schicken. `fn` gibt den neuen Bezug zurück, `null` (der Bezug ist weg →
 * #BEZUG!) oder `undefined` (bleibt). Unveränderte Bezüge behalten ihre Schreibweise; Texte in "…" bleiben unberührt.
 * Kein Formeltext (oder nicht lesbar): unverändert zurück.
 */
export function bezuegeUmschreiben(roh: string, fn: (b: Bezug) => Bezug | null | undefined): string {
  if (!roh.startsWith('=')) return roh;
  const f = roh.slice(1);
  const z = zerteile(f);
  if (!z) return roh;
  let aus = ''; let bis = 0;
  for (let k = 0; k < z.length; k += 1) {
    const t = z[k];
    let b: Bezug | null = null; let ende = t.e ?? 0;
    if (t.art === 'bezug') {
      const c = zelleLesen(f.slice(t.p, t.e));
      const n1 = z[k + 1], n2 = z[k + 2];
      const c2 = n1?.art === 'op' && n1.wert === ':' && n2?.art === 'bezug' ? zelleLesen(f.slice(n2.p, n2.e)) : null;
      if (c && c2) { b = { art: 'bereich', a: c, b: c2 }; ende = n2!.e ?? ende; k += 2; }
      else if (c) b = { art: 'zelle', ...c };
    } else if (t.art === 'plus' && /^[SZ]/.test(t.wert)) {
      const m = /^(\$?)(\w+):(\$?)(\w+)$/.exec(f.slice(t.p, t.e));
      if (m) {
        const sp = t.wert[0] === 'S';
        const st = (fest: string, w: string): Stelle => ({ i: sp ? spalteNr(w) : Number(w) - 1, fest: !!fest });
        b = { art: sp ? 'spalten' : 'zeilen', a: st(m[1], m[2]), b: st(m[3], m[4]) };
      }
    }
    if (!b) continue;
    const neu = fn(b);
    if (neu === undefined) continue;
    const text = neu === null || !imRahmen(neu) ? bezugFehlerText() : bezugText(neu);
    if (neu && text === bezugText(b)) continue;
    aus += f.slice(bis, t.p) + text;
    bis = ende;
  }
  return bis === 0 ? roh : `=${aus}${f.slice(bis)}`;
}

/** Kopieren: relative Teile wandern um (dz Zeilen, ds Spalten), $-Teile bleiben; was über den Rand fällt, wird #BEZUG! */
export function bezuegeVerschieben(roh: string, dz: number, ds: number): string {
  if (!dz && !ds) return roh;
  const sp = (x: Stelle): Stelle => (x.fest ? x : { ...x, i: x.i + ds });
  const ze = (x: Stelle): Stelle => (x.fest ? x : { ...x, i: x.i + dz });
  const c = (x: { s: Stelle; z: Stelle }) => ({ s: sp(x.s), z: ze(x.z) });
  return bezuegeUmschreiben(roh, (b) => {
    switch (b.art) {
      case 'zelle': return { art: 'zelle', ...c(b) };
      case 'bereich': return { art: 'bereich', a: c(b.a), b: c(b.b) };
      case 'spalten': return { art: 'spalten', a: sp(b.a), b: sp(b.b) };
      default: return { art: 'zeilen', a: ze(b.a), b: ze(b.b) };
    }
  });
}

/** Ausschneiden + Einfügen: Bezüge auf Zellen im verschobenen Rechteck folgen ihnen (auch $-Bezüge, wie in Excel) */
export function bezuegeVerlegen(roh: string, r: { s0: number; s1: number; z0: number; z1: number }, dz: number, ds: number): string {
  const drin = (x: { s: Stelle; z: Stelle }) => x.s.i >= r.s0 && x.s.i <= r.s1 && x.z.i >= r.z0 && x.z.i <= r.z1;
  const weg = (x: { s: Stelle; z: Stelle }) => ({ s: { ...x.s, i: x.s.i + ds }, z: { ...x.z, i: x.z.i + dz } });
  return bezuegeUmschreiben(roh, (b) => {
    if (b.art === 'zelle') return drin(b) ? { art: 'zelle', ...weg(b) } : undefined;
    if (b.art === 'bereich') return drin(b.a) && drin(b.b) ? { art: 'bereich', a: weg(b.a), b: weg(b.b) } : undefined;
    return undefined;
  });
}

/** Ein Zeilen- oder Spaltenumbau: `a` = Achse, `bei` = erste betroffene Nummer ab 0, `n` > 0 einfügen, < 0 löschen */
export interface UmbauSchritt { a: 'z' | 's'; bei: number; n: number }

/** Eine Nummer durch den Umbau schicken — null: sie wurde gelöscht */
export function umbauNummer(x: number, u: UmbauSchritt): number | null {
  if (u.n > 0) return x >= u.bei ? x + u.n : x;
  const d = -u.n;
  return x < u.bei ? x : x < u.bei + d ? null : x - d;
}
/** Eine Spanne (von–bis) durch den Umbau: Einfügen darin weitet sie, Löschen darin kürzt sie; ganz gelöscht: null */
export function umbauSpanne(von: number, bis: number, u: UmbauSchritt): [number, number] | null {
  const lo = Math.min(von, bis), hi = Math.max(von, bis);
  if (u.n > 0) return [lo >= u.bei ? lo + u.n : lo, hi >= u.bei ? hi + u.n : hi];
  const d = -u.n;
  const nlo = lo < u.bei ? lo : lo < u.bei + d ? u.bei : lo - d;
  const nhi = hi < u.bei ? hi : hi < u.bei + d ? u.bei - 1 : hi - d;
  return nhi < nlo ? null : [nlo, nhi];
}

/** Bezüge beim Einfügen/Löschen von Zeilen oder Spalten nachführen — wie Excel und LibreOffice, auch $-Bezüge */
export function bezuegeUmbauen(roh: string, u: UmbauSchritt): string {
  const zeilen = u.a === 'z';
  const st = (x: Stelle, i: number): Stelle => ({ ...x, i });
  return bezuegeUmschreiben(roh, (b) => {
    if (b.art === 'zelle') {
      const x = zeilen ? b.z : b.s;
      const n = umbauNummer(x.i, u);
      if (n === null) return null;
      return n === x.i ? undefined : zeilen ? { ...b, z: st(b.z, n) } : { ...b, s: st(b.s, n) };
    }
    if (b.art === 'bereich') {
      const [p, q] = zeilen ? [b.a.z, b.b.z] : [b.a.s, b.b.s];
      const sp = umbauSpanne(p.i, q.i, u);
      if (!sp) return null;
      const lo = p.i <= q.i ? [p, q] : [q, p];
      if (sp[0] === Math.min(p.i, q.i) && sp[1] === Math.max(p.i, q.i)) return undefined;
      // geordnet zurückschreiben: oben links : unten rechts
      const a = { s: b.a.s.i <= b.b.s.i ? b.a.s : b.b.s, z: b.a.z.i <= b.b.z.i ? b.a.z : b.b.z };
      const e = { s: b.a.s.i <= b.b.s.i ? b.b.s : b.a.s, z: b.a.z.i <= b.b.z.i ? b.b.z : b.a.z };
      if (zeilen) { a.z = st(lo[0], sp[0]); e.z = st(lo[1], sp[1]); } else { a.s = st(lo[0], sp[0]); e.s = st(lo[1], sp[1]); }
      return { art: 'bereich', a, b: e };
    }
    if ((b.art === 'spalten') !== !zeilen) return undefined;
    const sp = umbauSpanne(b.a.i, b.b.i, u);
    if (!sp) return null;
    if (sp[0] === Math.min(b.a.i, b.b.i) && sp[1] === Math.max(b.a.i, b.b.i)) return undefined;
    const [p, q] = b.a.i <= b.b.i ? [b.a, b.b] : [b.b, b.a];
    return { ...b, a: st(p, sp[0]), b: st(q, sp[1]) };
  });
}
