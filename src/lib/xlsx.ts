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

/**
 * Excel-Datum → lesbares Datum.
 *
 * Excel zählt Tage ab dem 1.1.1900 und hat dabei den 29.2.1900 mitgezählt,
 * den es nie gab — daher die zwei Tage Versatz. Ohne diese Umrechnung stünde
 * in der Karte eine nackte Zahl wie 45678 statt eines Datums.
 */
const alsDatum = (tage: number): string => {
  const ms = (tage - 25569) * 86400000;
  const d = new Date(Math.round(ms));
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(tage);
};

/** Trägt das Zahlenformat ein Datum? (die eingebauten Formate 14–22 und 45–47) */
function datumsFormate(stylesXml: string | null): Set<number> {
  const aus = new Set<number>();
  if (!stylesXml) return aus;
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  let i = 0;
  for (const m of cellXfs.matchAll(/<xf\b([^>]*)>/g)) {
    const nr = Number(/numFmtId="(\d+)"/.exec(m[1])?.[1] ?? '0');
    if ((nr >= 14 && nr <= 22) || (nr >= 45 && nr <= 47)) aus.add(i);
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

  for (const m of xml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attr = m[1];
    const inhalt = m[2] ?? '';
    const adr = /r="([A-Z]+\d+)"/.exec(attr)?.[1];
    if (!adr) continue;
    const typ = /t="([^"]+)"/.exec(attr)?.[1] ?? 'n';
    const stil = Number(/s="(\d+)"/.exec(attr)?.[1] ?? '-1');

    const formel = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inhalt)?.[1];
    const roh = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inhalt)?.[1];
    // Text kann auch direkt in der Zelle stehen (t="inlineStr")
    const inlineText = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inhalt)?.[1];

    let wert = '';
    if (formel) {
      wert = `=${entschluessele(formel)}`;
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
    } else if (roh !== undefined) {
      const zahl = Number(roh);
      wert = datums.has(stil) && Number.isFinite(zahl) && zahl > 0 ? alsDatum(zahl) : roh;
    } else if (typ === 'str' && roh !== undefined) {
      wert = entschluessele(roh);
    }
    if (wert === '') continue;

    zellen[adr] = wert;
    const sp = adr.replace(/\d+/g, '');
    let n = 0;
    for (const z of sp) n = n * 26 + (z.charCodeAt(0) - 64);
    spalten = Math.max(spalten, n);
    zeilen = Math.max(zeilen, Number(adr.replace(/\D+/g, '')));
  }

  return { name, zellen, spalten: Math.max(spalten, 4), zeilen: Math.max(zeilen, 6) };
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
