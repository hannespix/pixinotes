// Welche Datei-Karten lassen sich als Dokument-Folie zeigen? Eigene kleine Datei, damit die Präsentation das
// entscheiden kann, ohne die Dokument-Folie selbst zu laden (M395: sie kommt erst, wenn präsentiert wird).
import { vorschauArt } from './fileStore';

export type DokumentArt = 'pdf' | 'word' | 'bild';

/** Lässt sich diese Datei-Karte als Dokument-Folie zeigen? */
export function dokumentArt(node: { type?: string; data?: unknown }): DokumentArt | null {
  if (node.type !== 'file') return null;
  const d = node.data as { name?: string; mime?: string };
  const name = d.name ?? '';
  if (name.toLowerCase().endsWith('.docx')) return 'word';
  const art = vorschauArt(name, d.mime);
  return art === 'pdf' ? 'pdf' : art === 'bild' ? 'bild' : null;
}
