/**
 * M269: Was in einer Datei-Karte DRINSTEHT — für die KI lesbar gemacht.
 *
 * Der Anlass ist ein Screenshot aus der Praxis: Neben einer PDF mit
 * Prüfungsterminen legte die KI eine Notiz an mit dem Satz „Der Dateiinhalt
 * liegt mir nicht als Text vor, daher konnte ich keine konkreten Daten
 * übernehmen." Die Datei lag auf dem Gerät, die Vorschau zeigte sie sogar —
 * aber im Kontext, den die KI bekommt, stand nur eine einzige Zeile:
 *
 *     Datei: 03_Tischvorlage Prüfungstermine … .pdf (98 KB)
 *
 * Kein Wort Inhalt. Die KI konnte gar nicht anders, als das ehrlich zu
 * melden. pdf.js liegt längst im Programm (für die Vorschau) und bringt die
 * Textebene gleich mit — sie wird hier ausgelesen.
 *
 * Grenzen, die bewusst so sind:
 *  · Nur PDFs mit TEXTEBENE. Ein reiner Scan enthält Bildpunkte, keine
 *    Buchstaben; ohne Texterkennung ist da nichts zu holen. Das wird gemeldet,
 *    statt die KI raten zu lassen.
 *  · Nur so viele Seiten und Zeichen, wie in einen Kontext passen. Ein 200-
 *    Seiten-Dokument komplett mitzuschicken wäre teuer, langsam und für die
 *    meisten Fragen nutzlos.
 *  · Gelesen wird ausschließlich von DIESEM Gerät (lokale Ablage oder
 *    eingebetteter Inhalt). Es wird nichts nachgeladen und nichts verschickt,
 *    was nicht ohnehin schon zur Karte gehört.
 */
import { loadFile, vorschauArt } from './fileStore';
import type { AppNode, FileData } from '../types';

/** Höchstens so viele Seiten je Dokument auswerten */
const MAX_SEITEN = 40;
/** Höchstens so viele Zeichen je Dokument an die KI geben */
export const MAX_ZEICHEN = 12_000;

/** Einmal gelesener Text bleibt für die Sitzung liegen — Auslesen kostet Zeit */
const merker = new Map<string, string>();

/**
 * Textebene einer PDF auslesen.
 *
 * pdf.js liefert je Seite eine Liste von Textstücken samt Position. Aus den
 * Stücken wieder lesbare Zeilen zu machen, ist der eigentliche Kniff: Stur
 * aneinandergehängt ergäbe eine Tabelle Buchstabensalat. Deshalb wird an den
 * Zeilenumbrüchen getrennt, die pdf.js selbst meldet (`hasEOL`).
 */
async function pdfText(quelle: string | Blob): Promise<string> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline'),
  ]);
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new worker.default();
  }
  const daten = typeof quelle === 'string'
    ? { url: quelle }
    : { data: new Uint8Array(await quelle.arrayBuffer()) };
  const doc = await pdfjs.getDocument(daten).promise;
  const seiten: string[] = [];
  let zeichen = 0;
  for (let i = 1; i <= Math.min(doc.numPages, MAX_SEITEN) && zeichen < MAX_ZEICHEN; i++) {
    const seite = await doc.getPage(i);
    const inhalt = await seite.getTextContent();
    let zeile = '';
    const zeilen: string[] = [];
    for (const st of inhalt.items) {
      const t = st as { str?: string; hasEOL?: boolean };
      if (typeof t.str !== 'string') continue;
      zeile += t.str;
      if (t.hasEOL) { zeilen.push(zeile.trimEnd()); zeile = ''; }
    }
    if (zeile.trim()) zeilen.push(zeile.trimEnd());
    const text = zeilen.filter((z) => z.trim()).join('\n');
    if (text) { seiten.push(`— Seite ${i} —\n${text}`); zeichen += text.length; }
  }
  try { await doc.destroy(); } catch { /* egal */ }
  return seiten.join('\n\n').slice(0, MAX_ZEICHEN);
}

/** Ist das eine PDF? (Typ ODER Endung — der Typ fehlt oft, M254) */
export function istPdf(d: FileData): boolean {
  return (d.mime ?? '').toLowerCase() === 'application/pdf'
    || d.name.toLowerCase().endsWith('.pdf');
}

/**
 * M276: Word- und Excel-Dateien — die Leser liegen längst im Programm
 * (docx.ts fürs Umwandeln in Notizen, xlsx.ts für die Rechen-Tabelle).
 * Hier wird nur der TEXT gebraucht, deshalb je ein schlanker Weg:
 * Word direkt aus word/document.xml, Excel als CSV-artige Zeilen.
 */
const istDocx = (d: FileData): boolean => d.name.toLowerCase().endsWith('.docx');
const istXlsx = (d: FileData): boolean => d.name.toLowerCase().endsWith('.xlsx');
const istText = (d: FileData): boolean => vorschauArt(d.name, d.mime) === 'text';

async function docxText(blob: Blob): Promise<string> {
  const { ZipArchive } = await import('./unzip');
  const zip = await ZipArchive.open(await blob.arrayBuffer());
  const xml = await zip.text('word/document.xml');
  if (!xml) return '';
  // Absätze als Zeilen; innerhalb eines Absatzes alle Textläufe aneinander
  const absaetze = [...xml.matchAll(/<w:p\b[\s\S]*?(?:<\/w:p>|\/>)/g)].map((m) => {
    let t = '';
    for (const r of m[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) t += r[1];
    return t
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  });
  return absaetze.filter((z) => z.trim()).join('\n').slice(0, MAX_ZEICHEN);
}

async function xlsxText(blob: Blob): Promise<string> {
  const { leseXlsx } = await import('./xlsx');
  const buf = await blob.arrayBuffer();
  const teile: string[] = [];
  // höchstens zwei Blätter — mehr sprengt jeden Kontext
  for (let i = 0; i < 2; i++) {
    let blatt;
    try {
      blatt = await leseXlsx(buf, i);
    } catch { break; }
    const zeilen: string[] = [];
    for (let z = 1; z <= Math.min(blatt.zeilen, 200); z++) {
      const felder: string[] = [];
      for (let sp = 0; sp < Math.min(blatt.spalten, 26); sp++) {
        let name = '';
        for (let n = sp + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
        felder.push(blatt.zellen[`${name}${z}`] ?? '');
      }
      if (felder.some((f) => f !== '')) zeilen.push(felder.join(' | '));
    }
    if (zeilen.length) teile.push(`— Blatt „${blatt.name}" —\n${zeilen.join('\n')}`);
    if (i === 0 && blatt.zeilen === 0) break;
  }
  return teile.join('\n\n').slice(0, MAX_ZEICHEN);
}

/**
 * Der lesbare Inhalt einer Datei-Karte — oder null, wenn es keinen gibt.
 *
 * Zurückgegeben wird auch ein HINWEIS, wenn nichts zu holen war. Der ist
 * wichtiger, als er aussieht: Ohne ihn behauptet ein Modell gern etwas über
 * eine Datei, die es nie gesehen hat. Mit ihm weiß es, dass es nichts weiß.
 */
export async function dateiTextVonKarte(node: AppNode): Promise<string | null> {
  if (node.type !== 'file') return null;
  const d = node.data as FileData;
  const art = istPdf(d) ? 'pdf' : istDocx(d) ? 'docx' : istXlsx(d) ? 'xlsx' : istText(d) ? 'text' : null;
  if (!art) return null;
  const cache = merker.get(node.id);
  if (cache !== undefined) return cache;

  let text = '';
  try {
    // Erst die lokale Ablage (jede Größe), sonst der eingebettete Inhalt
    let blob = await loadFile(node.id);
    if (!blob && d.dataUrl) {
      if (art === 'pdf') {
        text = await pdfText(d.dataUrl);
      } else {
        blob = await (await fetch(d.dataUrl)).blob();
      }
    }
    if (!text && blob) {
      text = art === 'pdf' ? await pdfText(blob)
        : art === 'docx' ? await docxText(blob)
          : art === 'xlsx' ? await xlsxText(blob)
            : (await blob.text()).slice(0, MAX_ZEICHEN);
    } else if (!text) {
      const aus = 'Der Inhalt dieser Datei liegt nicht auf diesem Gerät — nichts daraus ist bekannt.';
      merker.set(node.id, aus);
      return aus;
    }
  } catch {
    const aus = 'Diese Datei ließ sich nicht auslesen.';
    merker.set(node.id, aus);
    return aus;
  }

  const aus = text.trim()
    ? text
    : (art === 'pdf'
      ? 'Diese PDF enthält keine Textebene (vermutlich ein Scan) — der Inhalt ist ohne Texterkennung nicht lesbar.'
      : 'Diese Datei enthält keinen lesbaren Text.');
  merker.set(node.id, aus);
  return aus;
}

/** Nach dem Nachreichen oder Ersetzen einer Datei den gemerkten Text vergessen */
export function textVergessen(nodeId: string): void {
  merker.delete(nodeId);
}
