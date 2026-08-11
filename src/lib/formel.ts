/**
 * M256: Ein kleiner Formel-Rechner — das, was „=SUMME(A1:A5)" in Excel tut.
 *
 * Bewusst selbst geschrieben statt eine Tabellen-Bibliothek einzubinden: Die
 * kleinsten davon wiegen mehrere hundert Kilobyte, und PixiNotes ist EINE
 * Datei, die offline liegt. Gebraucht wird ohnehin nur der Teil, den man in
 * einer Notiz-Tabelle wirklich benutzt — Summen, Mittelwerte, Prozente,
 * Bedingungen.
 *
 * Schreibweise (wie im deutschen Excel):
 *   · Argumente werden mit  ;  getrennt      =SUMME(A1:A3; B1)
 *   · Dezimaltrenner ist  ,  ODER  .         =1,5 * 2   ·   =1.5 * 2
 *   · Bezüge sind A1, B7, AA12 — auch Bereiche A1:B9
 *
 * Warum kein Komma als Argument-Trenner: Dann wäre „=SUMME(1,5)" zweideutig —
 * eine Zahl oder zwei? Das Semikolon macht die Sache eindeutig, und wer aus
 * dem deutschen Excel kommt, tippt es ohnehin.
 */

export type ZellWert = number | string | boolean | null;

/** Fehlerwerte in der Schreibweise, die deutsche Excel-Nutzer kennen */
export const FEHLER = {
  wert: '#WERT!',
  division: '#DIV/0!',
  name: '#NAME?',
  bezug: '#BEZUG!',
  zyklus: '#ZYKLUS!',
} as const;

const istFehler = (v: ZellWert): v is string =>
  typeof v === 'string' && Object.values(FEHLER).includes(v as never);

/** „A1" → { spalte: 0, zeile: 0 }; „AA12" → { spalte: 26, zeile: 11 } */
export function adresseZuIndex(adr: string): { spalte: number; zeile: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?([0-9]{1,5})$/.exec(adr.toUpperCase());
  if (!m) return null;
  let spalte = 0;
  for (const z of m[1]) spalte = spalte * 26 + (z.charCodeAt(0) - 64);
  const zeile = Number(m[2]);
  if (!zeile) return null;
  return { spalte: spalte - 1, zeile: zeile - 1 };
}

/** { spalte: 0, zeile: 0 } → „A1" */
export function indexZuAdresse(spalte: number, zeile: number): string {
  let s = '';
  for (let n = spalte + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return `${s}${zeile + 1}`;
}

/** Eine Eingabe deuten: Zahl, Wahrheitswert oder Text */
export function deuteEingabe(roh: string): ZellWert {
  const t = roh.trim();
  if (t === '') return null;
  if (/^(wahr|true)$/i.test(t)) return true;
  if (/^(falsch|false)$/i.test(t)) return false;
  const zahl = alsZahl(t);
  return zahl === null ? roh : zahl;
}

/**
 * Text → Zahl, auch in deutscher Schreibweise.
 *
 * „1.234,50" ist eine Zahl mit Tausenderpunkt, „1.5" eine mit Dezimalpunkt.
 * Unterschieden wird an der Stellung: Kommt ein Komma vor, sind Punkte
 * Tausendertrenner. Sonst ist der Punkt der Dezimaltrenner.
 */
function alsZahl(t: string): number | null {
  let s = t.replace(/\s|€|%$/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (t.trim().endsWith('%') ? n / 100 : n) : null;
}

const zuZahl = (v: ZellWert): number | null => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null) return 0;
  return alsZahl(v);
};

// ───────────────────────────── Zerteilen ─────────────────────────────

type Zeichen =
  | { art: 'zahl'; wert: number }
  | { art: 'text'; wert: string }
  | { art: 'bezug'; wert: string }
  | { art: 'name'; wert: string }
  | { art: 'op'; wert: string };

function zerteile(f: string): Zeichen[] | null {
  const aus: Zeichen[] = [];
  let i = 0;
  while (i < f.length) {
    const c = f[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '"') {
      let s = '';
      i += 1;
      while (i < f.length && f[i] !== '"') { s += f[i]; i += 1; }
      if (i >= f.length) return null;              // nicht geschlossen
      i += 1;
      aus.push({ art: 'text', wert: s });
      continue;
    }
    // Zahl: Punkt UND Komma als Dezimaltrenner zulassen — aber ein Komma nur,
    // wenn danach eine Ziffer folgt (sonst wäre es ein Trennzeichen)
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(f[i + 1] ?? ''))) {
      let s = '';
      while (i < f.length && (/[0-9]/.test(f[i])
        || ((f[i] === '.' || f[i] === ',') && /[0-9]/.test(f[i + 1] ?? '')))) {
        s += f[i];
        i += 1;
      }
      // Dieselbe Lesart wie bei einer eingetippten Zelle: „1.234,50" ist eine
      // Zahl mit Tausenderpunkt, „1.5" eine mit Dezimalpunkt (s. alsZahl).
      const n = alsZahl(s);
      if (n === null) return null;
      aus.push({ art: 'zahl', wert: n });
      continue;
    }
    if (/[A-Za-z_ÄÖÜäöüß$]/.test(c)) {
      let s = '';
      while (i < f.length && /[A-Za-z0-9_ÄÖÜäöüß$.]/.test(f[i])) { s += f[i]; i += 1; }
      aus.push(adresseZuIndex(s) ? { art: 'bezug', wert: s.toUpperCase() } : { art: 'name', wert: s.toUpperCase() });
      continue;
    }
    const zwei = f.slice(i, i + 2);
    if (['<=', '>=', '<>'].includes(zwei)) { aus.push({ art: 'op', wert: zwei }); i += 2; continue; }
    if ('+-*/^%()=<>&;:'.includes(c)) { aus.push({ art: 'op', wert: c }); i += 1; continue; }
    return null;                                    // unbekanntes Zeichen
  }
  return aus;
}

// ───────────────────────────── Auswerten ─────────────────────────────

/** Zugriff auf andere Zellen — vom Aufrufer gestellt (dort sitzt der Speicher) */
export type ZellLeser = (adresse: string) => ZellWert;

interface Lage { z: Zeichen[]; i: number; lies: ZellLeser }

const schau = (l: Lage) => l.z[l.i];
const istOp = (l: Lage, ...w: string[]) => {
  const t = schau(l);
  return !!t && t.art === 'op' && w.includes(t.wert);
};

/** Ein Bereich („A1:B3") wird zu einer Liste von Werten aufgelöst */
function bereich(von: string, bis: string, lies: ZellLeser): ZellWert[] {
  const a = adresseZuIndex(von); const b = adresseZuIndex(bis);
  if (!a || !b) return [FEHLER.bezug];
  const werte: ZellWert[] = [];
  for (let z = Math.min(a.zeile, b.zeile); z <= Math.max(a.zeile, b.zeile); z += 1) {
    for (let s = Math.min(a.spalte, b.spalte); s <= Math.max(a.spalte, b.spalte); s += 1) {
      werte.push(lies(indexZuAdresse(s, z)));
    }
  }
  return werte;
}

/** Argumente flach ausrollen — SUMME(A1:A3; 5) hat vier Zahlen */
const flach = (args: (ZellWert | ZellWert[])[]): ZellWert[] =>
  args.flatMap((a) => (Array.isArray(a) ? a : [a]));

const zahlen = (args: (ZellWert | ZellWert[])[]): number[] =>
  flach(args).map(zuZahl).filter((n): n is number => n !== null);

/**
 * Die Funktionen. Deutsche UND englische Namen, weil Vorlagen aus Excel
 * beides mitbringen — je nach Sprachfassung, in der sie gebaut wurden.
 */
const FUNKTIONEN: Record<string, (a: (ZellWert | ZellWert[])[]) => ZellWert> = {
  SUMME: (a) => zahlen(a).reduce((s, n) => s + n, 0),
  MITTELWERT: (a) => { const n = zahlen(a); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : FEHLER.division; },
  MIN: (a) => { const n = zahlen(a); return n.length ? Math.min(...n) : 0; },
  MAX: (a) => { const n = zahlen(a); return n.length ? Math.max(...n) : 0; },
  ANZAHL: (a) => zahlen(a).length,
  ANZAHL2: (a) => flach(a).filter((v) => v !== null && v !== '').length,
  PRODUKT: (a) => zahlen(a).reduce((s, n) => s * n, 1),
  RUNDEN: (a) => {
    const [w, st] = [zuZahl(flach([a[0]])[0]), zuZahl(flach([a[1] ?? 0])[0]) ?? 0];
    if (w === null) return FEHLER.wert;
    const f = 10 ** st;
    return Math.round(w * f) / f;
  },
  ABS: (a) => { const n = zuZahl(flach([a[0]])[0]); return n === null ? FEHLER.wert : Math.abs(n); },
  WENN: (a) => {
    const p = flach([a[0]])[0];
    const wahr = p === true || (typeof p === 'number' && p !== 0);
    const zweig = wahr ? a[1] : a[2];
    return zweig === undefined ? wahr : (flach([zweig])[0] ?? null);
  },
  HEUTE: () => new Date().toISOString().slice(0, 10),
  LÄNGE: (a) => String(flach([a[0]])[0] ?? '').length,
  VERKETTEN: (a) => flach(a).map((v) => (v === null ? '' : String(v))).join(''),
};
// Englische Zweitnamen — dieselbe Funktion, anderer Aufruf
const ALIAS: Record<string, string> = {
  SUM: 'SUMME', AVERAGE: 'MITTELWERT', COUNT: 'ANZAHL', COUNTA: 'ANZAHL2',
  PRODUCT: 'PRODUKT', ROUND: 'RUNDEN', IF: 'WENN', TODAY: 'HEUTE',
  LEN: 'LÄNGE', CONCATENATE: 'VERKETTEN', LAENGE: 'LÄNGE',
};

/** Liste der Funktionsnamen — für Hilfe und Autovervollständigung */
export const FUNKTIONSNAMEN = Object.keys(FUNKTIONEN);

function wert(l: Lage): ZellWert | ZellWert[] {
  const t = schau(l);
  if (!t) return FEHLER.wert;

  if (t.art === 'op' && (t.wert === '-' || t.wert === '+')) {
    l.i += 1;
    const v = wert(l);
    const f = durchreichen(v);
    if (f) return f;
    const n = zuZahl(einzel(v));
    if (n === null) return FEHLER.wert;
    return t.wert === '-' ? -n : n;
  }
  if (t.art === 'zahl') { l.i += 1; return t.wert; }
  if (t.art === 'text') { l.i += 1; return t.wert; }
  if (t.art === 'bezug') {
    l.i += 1;
    // Bereich?
    if (istOp(l, ':') && l.z[l.i + 1]?.art === 'bezug') {
      const bis = (l.z[l.i + 1] as { wert: string }).wert;
      l.i += 2;
      return bereich(t.wert, bis, l.lies);
    }
    return l.lies(t.wert);
  }
  if (t.art === 'name') {
    const name = ALIAS[t.wert] ?? t.wert;
    l.i += 1;
    if (!istOp(l, '(')) return FEHLER.name;
    l.i += 1;
    const args: (ZellWert | ZellWert[])[] = [];
    if (!istOp(l, ')')) {
      for (;;) {
        args.push(vergleich(l));
        if (istOp(l, ';')) { l.i += 1; continue; }
        break;
      }
    }
    if (!istOp(l, ')')) return FEHLER.wert;
    l.i += 1;
    const fn = FUNKTIONEN[name];
    if (!fn) return FEHLER.name;
    const schlecht = flach(args).find(istFehler);
    return schlecht ?? fn(args);
  }
  if (istOp(l, '(')) {
    l.i += 1;
    const v = vergleich(l);
    if (!istOp(l, ')')) return FEHLER.wert;
    l.i += 1;
    return v;
  }
  return FEHLER.wert;
}

/** Ein Bereich in einer Rechnung zählt mit seinem ersten Wert (wie in Excel) */
const einzel = (v: ZellWert | ZellWert[]): ZellWert => (Array.isArray(v) ? v[0] ?? null : v);

/**
 * Fehler reichen durch, statt sich in einen anderen Fehler zu verwandeln.
 *
 * Ohne das wurde aus „=A1+1" bei einem Ring #WERT! statt #ZYKLUS!: Der
 * Zahlenwandler kann mit „#ZYKLUS!" nichts anfangen und meldete einen
 * Wertfehler — die eigentliche Ursache wäre damit verschwunden.
 */
const durchreichen = (...v: (ZellWert | ZellWert[])[]): string | null => {
  for (const x of v) { const e = einzel(x); if (istFehler(e)) return e; }
  return null;
};

/** Potenz und Prozent binden am stärksten */
function potenz(l: Lage): ZellWert | ZellWert[] {
  let links = wert(l);
  while (istOp(l, '^', '%')) {
    const op = (schau(l) as { wert: string }).wert;
    l.i += 1;
    if (op === '%') {
      const f = durchreichen(links);
      if (f) { links = f; continue; }
      const n = zuZahl(einzel(links));
      links = n === null ? FEHLER.wert : n / 100;
      continue;
    }
    const rechts = wert(l);
    const f = durchreichen(links, rechts);
    if (f) { links = f; continue; }
    const a = zuZahl(einzel(links));
    const b = zuZahl(einzel(rechts));
    links = a === null || b === null ? FEHLER.wert : a ** b;
  }
  return links;
}

function punkt(l: Lage): ZellWert | ZellWert[] {
  let links = potenz(l);
  while (istOp(l, '*', '/')) {
    const op = (schau(l) as { wert: string }).wert;
    l.i += 1;
    const rechts = potenz(l);
    const f = durchreichen(links, rechts);
    if (f) { links = f; continue; }
    const a = zuZahl(einzel(links));
    const b = zuZahl(einzel(rechts));
    if (a === null || b === null) { links = FEHLER.wert; continue; }
    if (op === '/' && b === 0) { links = FEHLER.division; continue; }
    links = op === '*' ? a * b : a / b;
  }
  return links;
}

function strich(l: Lage): ZellWert | ZellWert[] {
  let links = punkt(l);
  while (istOp(l, '+', '-', '&')) {
    const op = (schau(l) as { wert: string }).wert;
    l.i += 1;
    const rechts = punkt(l);
    const f = durchreichen(links, rechts);
    if (f) { links = f; continue; }
    const lv = einzel(links);
    const rv = einzel(rechts);
    if (op === '&') { links = `${lv ?? ''}${rv ?? ''}`; continue; }
    const a = zuZahl(lv); const b = zuZahl(rv);
    if (a === null || b === null) { links = FEHLER.wert; continue; }
    links = op === '+' ? a + b : a - b;
  }
  return links;
}

function vergleich(l: Lage): ZellWert | ZellWert[] {
  const links = strich(l);
  if (!istOp(l, '=', '<', '>', '<=', '>=', '<>')) return links;
  const op = (schau(l) as { wert: string }).wert;
  l.i += 1;
  const rechts = strich(l);
  const f = durchreichen(links, rechts);
  if (f) return f;
  const lv = einzel(links);
  const rv = einzel(rechts);
  const a = zuZahl(lv); const b = zuZahl(rv);
  const [x, y] = a !== null && b !== null ? [a, b] : [String(lv ?? ''), String(rv ?? '')];
  switch (op) {
    case '=': return x === y;
    case '<>': return x !== y;
    case '<': return x < y;
    case '>': return x > y;
    case '<=': return x <= y;
    default: return x >= y;
  }
}

/**
 * Eine Formel ausrechnen. `formel` OHNE führendes „=" übergeben.
 * Liefert bei Unsinn einen Fehlerwert statt zu werfen — eine Tabelle soll
 * wegen einer schiefen Zelle nicht die ganze Karte mitreißen.
 */
export function rechne(formel: string, lies: ZellLeser): ZellWert {
  const z = zerteile(formel);
  if (!z || !z.length) return FEHLER.wert;
  const l: Lage = { z, i: 0, lies };
  const v = vergleich(l);
  if (l.i < z.length) return FEHLER.wert;          // Rest nicht verstanden
  return einzel(v);
}

/**
 * Ein ganzes Blatt durchrechnen.
 *
 * Zellen können auf Zellen zeigen, die selbst rechnen — deshalb wird jede
 * Zelle bei Bedarf ausgewertet und das Ergebnis gemerkt. Ein Ring
 * (A1 zeigt auf B1, B1 zurück auf A1) endet in #ZYKLUS! statt in einer
 * Endlosschleife.
 */
export function rechneBlatt(zellen: Record<string, string>): Record<string, ZellWert> {
  const fertig: Record<string, ZellWert> = {};
  const laufend = new Set<string>();

  const hole = (adr: string): ZellWert => {
    const A = adr.toUpperCase();
    if (A in fertig) return fertig[A];
    if (laufend.has(A)) return FEHLER.zyklus;
    const roh = zellen[A];
    if (roh === undefined || roh === '') return null;
    // Auch reine Eingaben landen im Ergebnis — sonst wüsste die Karte für
    // „12,5" nicht, dass dort eine ZAHL steht (rechtsbündig, Auto-Summe).
    if (!roh.startsWith('=')) { fertig[A] = deuteEingabe(roh); return fertig[A]; }
    laufend.add(A);
    const v = rechne(roh.slice(1), hole);
    laufend.delete(A);
    fertig[A] = v;
    return v;
  };

  for (const adr of Object.keys(zellen)) hole(adr);
  return fertig;
}

/** Anzeigetext einer Zelle — Zahlen deutsch formatiert, Fehler unverändert */
export function zeigeWert(v: ZellWert): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return FEHLER.wert;
    const gerundet = Math.round(v * 1e10) / 1e10;
    return gerundet.toLocaleString('de-DE', { maximumFractionDigits: 10 });
  }
  return v;
}
