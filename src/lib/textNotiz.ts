// M332: Textdateien (Markdown, .txt) werden Notizen — nicht Datei-Karten.
//
// Der Anlass: Acht importierte .md-Dateien lagen als Datei-Karten auf dem
// Board, die Vorschau zeigte „## Überschrift" und „- [ ] Punkt" als rohe
// Zeichen, und erst ein Umweg über die KI machte daraus Notizen (und der
// brach dann auch noch ab). Markdown ist aber genau das Format, das die
// Notiz ohnehin spricht (mdToBlocks, M117) — der Weg Datei → Notiz ist
// deshalb deterministisch, ohne KI und ohne Netz.
import { mdToBlocks } from './ai';
import { docxToBlocks } from './docx';
import { loadFile, vorschauArt } from './fileStore';
import { makeNote } from './nodes';
import { mutedHistory, selectActiveBoard, useBoard } from '../store';
import type { AppNode, FileData } from '../types';

/** Ab hier bleibt eine Datei eine Datei: Eine 2-MB-Textdatei ist ein Protokoll, keine Notiz */
export const NOTIZ_MAX_ZEICHEN = 200_000;
/** Reine .txt nur bis hier als Notiz — längere sind meist Logs oder Daten */
const TXT_MAX_ZEICHEN = 60_000;

const MARKDOWN = new Set(['md', 'markdown', 'mdown', 'mkd']);

/** Wird diese Datei beim Import eine Notiz? (nach Endung und Größe) */
export function wirdNotiz(name: string, groesse: number): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (MARKDOWN.has(ext)) return groesse <= NOTIZ_MAX_ZEICHEN * 2;
  if (ext === 'txt' || ext === 'text') return groesse <= TXT_MAX_ZEICHEN;
  return false;
}

/** Dateiname ohne Endung, als Titel brauchbar */
function titelAus(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

/**
 * Markdown/Text → Notiz-Blöcke. Beginnt der Text nicht mit einer Überschrift,
 * wird der Dateiname zur Überschrift — sonst heißt die Karte „Absatz 1".
 */
export async function textZuBloecken(name: string, text: string): Promise<unknown[]> {
  const inhalt = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim().slice(0, NOTIZ_MAX_ZEICHEN);
  if (!inhalt) return [];
  const beginntMitTitel = /^#{1,3}\s+\S/.test(inhalt);
  const titel = titelAus(name);
  const md = beginntMitTitel || !titel ? inhalt : `### ${titel}\n\n${inhalt}`;
  return mdToBlocks('', md);
}

/** Ist diese Datei-Karte eine Textdatei, die zur Notiz werden kann? */
export function textKarte(node: AppNode): boolean {
  if (node.type !== 'file') return false;
  const d = node.data as FileData;
  if (d.name.toLowerCase().endsWith('.docx')) return true; // M337: Word-Dokument → Notiz (docxToBlocks)
  if (vorschauArt(d.name, d.mime) !== 'text') return false;
  const ext = d.name.split('.').pop()?.toLowerCase() ?? '';
  return MARKDOWN.has(ext) || ext === 'txt' || ext === 'text' || (d.mime ?? '').startsWith('text/plain') || (d.mime ?? '') === 'text/markdown';
}

async function dateiText(node: AppNode): Promise<string | null> {
  const d = node.data as FileData;
  const blob = await loadFile(node.id).catch(() => undefined);
  if (blob) return blob.text();
  if (d.dataUrl) return (await (await fetch(d.dataUrl)).blob()).text();
  return null;
}

/**
 * Ausgewählte Textdatei-Karten in Notizen verwandeln — an derselben Stelle,
 * in derselben Breite, Verbindungen wandern mit. EIN Undo-Schritt für alle.
 * Gibt zurück, wie viele Karten umgewandelt wurden und welche nicht gingen.
 */
export async function textDateienAlsNotizen(nodes: AppNode[]): Promise<{ fertig: number; fehler: string[] }> {
  const kandidaten = nodes.filter(textKarte);
  const fehler: string[] = [];
  const paare: Array<{ alt: AppNode; neu: AppNode }> = [];
  for (const alt of kandidaten) {
    const d = alt.data as FileData;
    try {
      let blocks: unknown[];
      if (d.name.toLowerCase().endsWith('.docx')) {
        // M337: Word → Notiz-Blöcke über den bestehenden Word-Leser (M184)
        const blob = (await loadFile(alt.id).catch(() => undefined)) ?? (d.dataUrl ? await (await fetch(d.dataUrl)).blob() : undefined);
        if (!blob) { fehler.push(`„${d.name}": Inhalt liegt nicht auf diesem Gerät`); continue; }
        blocks = (await docxToBlocks(await blob.arrayBuffer())).blocks;
      } else {
        const text = await dateiText(alt);
        if (text === null) { fehler.push(`„${d.name}": Inhalt liegt nicht auf diesem Gerät`); continue; }
        blocks = await textZuBloecken(d.name, text);
      }
      if (blocks.length === 0) { fehler.push(`„${d.name}": enthält keinen Text`); continue; }
      const neu = makeNote({ ...alt.position }, { blocks });
      neu.width = Math.max(280, Math.min(560, (alt.width as number | undefined) ?? 340));
      paare.push({ alt, neu });
    } catch (e) {
      fehler.push(`„${d.name}": ${(e as Error).message}`);
    }
  }
  if (paare.length === 0) return { fertig: 0, fehler };
  const st = useBoard.getState();
  const board = selectActiveBoard(st);
  const ersetzt = new Map(paare.map((p) => [p.alt.id, p.neu.id]));
  st.pushHistory();
  mutedHistory(() => {
    for (const p of paare) st.addNode(p.neu);
    // Verbindungen von/zur Datei-Karte auf die Notiz umhängen, dann die Datei entfernen
    for (const e of board.edges) {
      const q = ersetzt.get(e.source);
      const z = ersetzt.get(e.target);
      if (!q && !z) continue;
      st.addLabeledEdge(q ?? e.source, z ?? e.target, (e.label as string | undefined) ?? '');
    }
    st.removeNodes(paare.map((p) => p.alt.id));
  });
  return { fertig: paare.length, fehler };
}
