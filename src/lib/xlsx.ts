/**
 * M256: Excel-Dateien lesen — ohne Bibliothek.
 *
 * Eine .xlsx ist ein ZIP mit XML darin, genau wie eine .docx. Den ZIP-Leser
 * gibt es hier seit dem Word-Import (lib/unzip.ts); es fehlten nur die paar
 * Regeln, wie Excel seine Zellen ablegt:
 *
 *   · xl/worksheets/sheet1.xml   die Zellen des ersten Blattes
 *   · xl/sharedStrings.xml       alle Texte, zentral abgelegt und nummeriert
 *   · xl/workbook.xml            die Namen der Blätter
 *
 * Übernommen werden Werte UND Formeln: Steht in der Datei `<f>SUM(A1:A5)</f>`,
 * landet in der Karte `=SUMME(A1:A5)` — die Tabelle rechnet danach selbst
 * weiter, statt nur ein totes Ergebnis zu zeigen. Deshalb werden die
 * englischen Funktionsnamen beim Einlesen NICHT übersetzt: Der Rechner
 * versteht beide Schreibweisen (lib/formel.ts).
 */
import { ZipArchive } from './unzip';

export interface ExcelBlatt {
  name: string;
  /** Zelle → Rohinhalt, so wie man ihn eintippen würde („12,5" oder „=SUMME(A1:A3)") */
  zellen: Record<string, string>;
  spalten: number;
  zeilen: number;
  /** M407: Zelle → Adresse eines Links, der in Excel an der Zelle hing */
  links?: Record<string, string>;
  /** M407: Kopfzeile und letzte Datenzeile, wenn das Blatt einen Filter oder eine „Tabelle" trägt */
  kopf?: number;
  bis?: number;
}

/** XML-Entitäten zurückübersetzen (der Rest des Textes bleibt, wie er ist) */
const entschluessele = (s: string): string => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&');

/** Die Texttabelle: `<si>` mit beliebig vielen `<t>`-Stücken je Eintrag */
function leseTexte(xml: string | null): string[] {
  if (!xml) return [];
  const aus: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    let text = '';
    for (const t of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += entschluessele(t[1]);
    aus.push(text);
  }
  return aus;
}

const spalteNr = (b: string): number => [...b].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
const spalteName = (n: number): string => { let s = ''; let x = n; while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); } return s; };
const adresseTeile = (adr: string): { zeile: number; spalte: number } => { const m = /^([A-Z]+)(\d+)$/.exec(adr); return m ? { zeile: Number(m[2]), spalte: spalteNr(m[1]) } : { zeile: 1, spalte: 1 }; };
/** Außerhalb von "Text": Stück für Stück umformen */
const ausserhalbText = (f: string, fn: (teil: string) => string): string => f.split(/("(?:[^"]|"")*")/).map((t, i) => (i % 2 ? t : fn(t))).join('');
/** Bezüge einer Formel um Zeilen/Spalten versetzen — mit $ festgehaltene bleiben */
function versetzeFormel(f: string, dz: number, ds: number): string {
  return ausserhalbText(f, (teil) => teil.replace(/(^|[^A-Za-z0-9_.$])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (_g, vor: string, fs: string, sp: string, fz: string, zl: string) => {
    const s = fs ? spalteNr(sp) : spalteNr(sp) + ds; const z = fz ? Number(zl) : Number(zl) + dz;
    return s < 1 || z < 1 ? `${vor}#BEZUG!` : `${vor}${fs}${spalteName(s)}${fz}${z}`;
  }));
}
/**
 * M388: Formel aus der Datei in die hiesige Schreibweise. In der Datei stehen Formeln immer amerikanisch: Komma
 * trennt die Angaben einer Funktion. Hier trennt das Semikolon (das Komma ist Dezimalzeichen) — =ROUND(A1/3,2)
 * rechnete darum still mit „3,2", =IF(A1>5,"a","b") meldete einen Fehler.
 */
const hiesigeFormel = (f: string): string => ausserhalbText(f, (teil) => teil.replace(/,/g, ';'));

/**
 * Excel-Datum → lesbares Datum.
 *
 * Excel zählt Tage ab dem 1.1.1900 und hat dabei den 29.2.1900 mitgezählt,
 * den es nie gab — daher die zwei Tage Versatz. Ohne diese Umrechnung stünde
 * in der Karte eine nackte Zahl wie 45678 statt eines Datums.
 */
const alsDatum = (tage: number): string => {
  // M388: nur eine Uhrzeit (Bruchteil eines Tages) — vorher stand dort „1899-12-30"
  if (tage > 0 && tage < 1) {
    const min = Math.round(tage * 1440);
    return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }
  const ms = (tage - 25569) * 86400000;
  const d = new Date(Math.round(ms));
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(tage);
};

/** Trägt das Zahlenformat ein Datum? (die eingebauten Formate 14–22 und 45–47) */
function datumsFormate(stylesXml: string | null): Set<number> {
  const aus = new Set<number>();
  if (!stylesXml) return aus;
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  // M388: eigene Formate (ab Nummer 164, z. B. „TT.MM.JJJJ") — am Formatcode erkannt; sonst blieb die nackte Tageszahl stehen
  const eigene = new Set<number>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const code = entschluessele(m[2]).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
    if (/[dy]/i.test(code) || /(^|[^a-z])(h{1,2}|m{1,2}|s{1,2})([^a-z]|$)/i.test(code) && /[hs]/i.test(code)) eigene.add(Number(m[1]));
  }
  let i = 0;
  for (const m of cellXfs.matchAll(/<xf\b([^>]*)>/g)) {
    const nr = Number(/numFmtId="(\d+)"/.exec(m[1])?.[1] ?? '0');
    if ((nr >= 14 && nr <= 22) || (nr >= 45 && nr <= 47) || eigene.has(nr)) aus.add(i);
    i += 1;
  }
  return aus;
}

/**
 * Ein Blatt einer Excel-Datei lesen (standardmäßig das erste).
 *
 * Eine Karte zeigt EIN Blatt — deshalb der Index: Eine Mappe mit drei Blättern
 * wird zu drei Karten nebeneinander, statt zwei Blätter stillschweigend unter
 * den Tisch fallen zu lassen.
 */
export async function leseXlsx(daten: ArrayBuffer, index = 0): Promise<ExcelBlatt> {
  const zip = await ZipArchive.open(daten);

  const blattPfade = zip.names
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1]));
  if (!blattPfade.length) throw new Error('In der Datei steckt kein Tabellenblatt.');
  const nr = Math.min(Math.max(0, index), blattPfade.length - 1);

  const workbook = await zip.text('xl/workbook.xml').catch(() => null);
  const namen = workbook
    ? [...workbook.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map((m) => entschluessele(m[1]))
    : [];
  const name = namen[nr] ?? (blattPfade.length > 1 ? `Tabelle ${nr + 1}` : 'Tabelle');

  const texte = leseTexte(await zip.text('xl/sharedStrings.xml').catch(() => null));
  const datums = datumsFormate(await zip.text('xl/styles.xml').catch(() => null));
  const xml = (await zip.text(blattPfade[nr])) ?? '';

  const zellen: Record<string, string> = {};
  let spalten = 0; let zeilen = 0;
  const geteilt = new Map<string, { formel: string; zeile: number; spalte: number }>();

  for (const m of xml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attr = m[1];
    const inhalt = m[2] ?? '';
    const adr = /r="([A-Z]+\d+)"/.exec(attr)?.[1];
    if (!adr) continue;
    const typ = /t="([^"]+)"/.exec(attr)?.[1] ?? 'n';
    const stil = Number(/s="(\d+)"/.exec(attr)?.[1] ?? '-1');

    let formel = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inhalt)?.[1];
    /* M388: „Geteilte" Formeln — jedes Herunterziehen in Excel. Nur die erste Zelle trägt den Text, die übrigen
       verweisen darauf (<f t="shared" si="0"/>). Vorher kamen sie als ihr zuletzt gerechneter Wert an und
       rechneten nie wieder. Jetzt bekommt jede ihre Formel, um ihre Lage versetzt. */
    const fAttr = /<f\b([^>]*?)\/?>/.exec(inhalt)?.[1] ?? '';
    const geteiltNr = /t="shared"/.test(fAttr) ? /si="(\d+)"/.exec(fAttr)?.[1] : undefined;
    if (geteiltNr !== undefined) {
      const hier = adresseTeile(adr);
      if (formel) geteilt.set(geteiltNr, { formel: entschluessele(formel), ...hier });
      else { const g = geteilt.get(geteiltNr); if (g) formel = versetzeFormel(g.formel, hier.zeile - g.zeile, hier.spalte - g.spalte); }
    }
    const roh = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inhalt)?.[1];
    // Text kann auch direkt in der Zelle stehen (t="inlineStr")
    const inlineText = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inhalt)?.[1];

    let wert = '';
    if (formel) {
      wert = `=${hiesigeFormel(entschluessele(formel))}`;
    } else if (typ === 's' && roh !== undefined) {
      wert = texte[Number(roh)] ?? '';
    } else if (typ === 'inlineStr' && inlineText) {
      let t = '';
      for (const st of inlineText.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) t += entschluessele(st[1]);
      wert = t;
    } else if (typ === 'b' && roh !== undefined) {
      wert = roh === '1' ? 'WAHR' : 'FALSCH';
    } else if (typ === 'e' && roh !== undefined) {
      wert = entschluessele(roh);
    } else if (typ === 'str' && roh !== undefined) {
      // M388: Text-Ergebnis einer Formel. Stand hinter dem allgemeinen Zweig und wurde nie erreicht —
      // „Müller &amp; Söhne" kam darum mit dem rohen „&amp;" an.
      wert = entschluessele(roh);
    } else if (roh !== undefined) {
      const zahl = Number(roh);
      // M390: Zahlen kommen in hiesiger Schreibweise in die Zelle (Komma) — „1.234" aus der Datei ist 1,234 und
      // darf nicht als Tausender gelesen werden
      wert = datums.has(stil) && Number.isFinite(zahl) && zahl > 0 ? alsDatum(zahl)
        : Number.isFinite(zahl) && /^-?\d+\.\d+$/.test(roh) ? roh.replace('.', ',') : roh;
    }
    if (wert === '') continue;

    zellen[adr] = wert;
    const sp = adr.replace(/\d+/g, '');
    let n = 0;
    for (const z of sp) n = n * 26 + (z.charCodeAt(0) - 64);
    spalten = Math.max(spalten, n);
    zeilen = Math.max(zeilen, Number(adr.replace(/\D+/g, '')));
  }

  /**
   * M407: Was Excel neben den Zellen ablegt – Links und der Bereich eines Filters bzw. einer „Tabelle".
   * Die Ziele der Links und die Tabellen stehen nicht im Blatt selbst, sondern in dessen Beziehungen
   * (xl/worksheets/_rels/sheetN.xml.rels).
   */
  const rels = (await zip.text(blattPfade[nr].replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels')).catch(() => null)) ?? '';
  const beziehung = new Map<string, { ziel: string; art: string }>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[1])?.[1];
    const ziel = /\bTarget="([^"]*)"/.exec(m[1])?.[1];
    if (id && ziel) beziehung.set(id, { ziel: entschluessele(ziel), art: /\bType="[^"]*\/([a-zA-Z]+)"/.exec(m[1])?.[1] ?? '' });
  }
  const links: Record<string, string> = {};
  for (const m of xml.matchAll(/<hyperlink\b([^>]*)\/?>/g)) {
    const ref = /\bref="([A-Z]+\d+)(?::([A-Z]+\d+))?"/.exec(m[1]);
    const ziel = beziehung.get(/\br:id="([^"]*)"/.exec(m[1])?.[1] ?? '')?.ziel;
    if (!ref || !ziel || !/^(https?:|mailto:|tel:)/i.test(ziel)) continue;   // Sprünge im Blatt (location=…) haben hier kein Ziel
    const a = adresseTeile(ref[1]); const b = ref[2] ? adresseTeile(ref[2]) : a;
    for (let z = a.zeile; z <= Math.min(b.zeile, a.zeile + 500); z += 1) for (let s = a.spalte; s <= Math.min(b.spalte, a.spalte + 30); s += 1) links[`${spalteName(s)}${z}`] = ziel;
  }
  // Filterbereich: am Blatt selbst (Daten → Filtern) oder an einer „Tabelle" (Als Tabelle formatieren)
  let kopf: number | undefined; let bis: number | undefined;
  const bereich = (ref: string | undefined, ohneKopf = false, summen = 0) => {
    const r = /^([A-Z]+\d+):([A-Z]+\d+)$/.exec(ref ?? '');
    if (!r || ohneKopf || kopf !== undefined) return;
    kopf = adresseTeile(r[1]).zeile; bis = adresseTeile(r[2]).zeile - summen;
  };
  bereich(/<autoFilter\b[^>]*\bref="([^"]*)"/.exec(xml)?.[1]);
  for (const b of beziehung.values()) {
    if (b.art !== 'table' || kopf !== undefined) continue;
    const pfad = b.ziel.replace(/^\.\.\//, 'xl/').replace(/^\/(?=xl\/)/, '');
    const t = (await zip.text(pfad).catch(() => null)) ?? '';
    const kopfzeile = /<table\b([^>]*)>/.exec(t)?.[1] ?? '';
    bereich(/\bref="([^"]*)"/.exec(kopfzeile)?.[1], /\bheaderRowCount="0"/.test(kopfzeile), Number(/\btotalsRowCount="(\d+)"/.exec(kopfzeile)?.[1] ?? '0'));
  }

  return {
    name, zellen, spalten: Math.max(spalten, 4), zeilen: Math.max(zeilen, 6),
    ...(Object.keys(links).length ? { links } : {}),
    ...(kopf !== undefined && bis !== undefined && bis > kopf ? { kopf, bis } : {}),
  };
}

/** Namen aller Blätter — für den ehrlichen Hinweis „Blatt 1 von 3 übernommen" */
export async function blattNamen(daten: ArrayBuffer): Promise<string[]> {
  try {
    const zip = await ZipArchive.open(daten);
    const wb = (await zip.text('xl/workbook.xml')) ?? '';
    return [...wb.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map((m) => entschluessele(m[1]));
  } catch {
    return [];
  }
}

/** Tabelle als CSV — öffnet sich in Excel, LibreOffice und Numbers */
export function alsCsv(zellen: Record<string, string>, werte: Record<string, string>,
  spalten: number, zeilen: number): string {
  const raus: string[] = [];
  for (let z = 1; z <= zeilen; z += 1) {
    const zeile: string[] = [];
    for (let s = 0; s < spalten; s += 1) {
      let name = '';
      for (let n = s + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
      }
      // Ausgegeben wird der ERRECHNETE Wert — eine CSV kennt keine Formeln
      const v = werte[`${name}${z}`] ?? zellen[`${name}${z}`] ?? '';
      zeile.push(/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    }
    raus.push(zeile.join(';'));
  }
  return `﻿${raus.join('\r\n')}`;   // BOM, damit Excel die Umlaute erkennt
}
