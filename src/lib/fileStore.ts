/**
 * M259: Wo eine eingefügte Datei wirklich liegt.
 *
 * Bisher lag der Inhalt im Board-Stand — und der lebt im localStorage, den
 * Browser bei etwa 5 MB abriegeln. Deshalb gab es die Bremse bei 1,5 MB
 * (MAX_EMBED_BYTES): Eine größere Datei wurde gar nicht erst gespeichert.
 * Die Bremse war richtig — ohne sie hätte eine einzige PDF jeden weiteren
 * Speichervorgang des ganzen Boards zerstört, also echten Datenverlust
 * verursacht. Falsch war der Lagerort.
 *
 * Für eigene HTML-Apps (M158) gibt es die Lösung längst: IndexedDB. Dort
 * zählt kein 5-MB-Deckel, sondern der freie Platz auf der Platte. Genau
 * dorthin gehören auch Dateien. Die Arbeitsteilung ist damit:
 *
 *   · Board-Stand (localStorage) — was mitreisen soll: Name, Größe, Typ.
 *     Kleine Dateien zusätzlich als Inhalt, damit Teilen-Links und Exporte
 *     wie bisher funktionieren.
 *   · IndexedDB (dieses Gerät) — der vollständige Inhalt, in jeder Größe.
 *     Daraus kommt die Vorschau.
 *
 * Das ist auch der Grund, warum eine 40-MB-PDF hier eine Vorschau hat, ein
 * Teammitglied über einen Teilen-Link aber nur die Karte sieht: Der Link
 * trägt den Board-Stand, nicht die Festplatte. Für den Weg ins Team gibt es
 * den Anlagen-Ordner (M159).
 */
import { idbDel, idbGet, idbKeys, idbSet } from './syncFolder';

const KEY = (id: string) => `file:${id}`;

/** Inhalt einer Datei-Karte ablegen — als Blob, ohne Base64-Aufblähung */
export const saveFile = (id: string, blob: Blob) => idbSet(KEY(id), blob);

export async function loadFile(id: string): Promise<Blob | undefined> {
  const v = await idbGet<Blob | ArrayBuffer>(KEY(id));
  if (!v) return undefined;
  // Ältere Stände könnten einen ArrayBuffer enthalten — beides annehmen
  return v instanceof Blob ? v : new Blob([v]);
}

export const deleteFile = (id: string) => idbDel(KEY(id));

/**
 * Verwaiste Dateien entsorgen — NUR beim Start aufrufen.
 *
 * Beim Löschen einer Karte wird bewusst NICHT sofort aufgeräumt: Strg+Z soll
 * die Karte mitsamt Inhalt zurückholen können. Beim Start ist der Verlauf
 * leer, also kann nichts mehr wiederkommen, was hier verschwindet.
 */
export async function cleanupOrphanFiles(gueltigeIds: Set<string>): Promise<void> {
  try {
    const keys = await idbKeys();
    for (const roh of keys) {
      const k = String(roh);
      if (!k.startsWith('file:')) continue;
      if (!gueltigeIds.has(k.slice(5))) await idbDel(k);
    }
  } catch {
    // Aufräumen ist Kür — ein Fehler hier darf den Start nicht aufhalten
  }
}

/**
 * Welche Vorschau passt zu dieser Datei?
 *
 * Entschieden wird nach Typ UND Endung: Der Browser liefert beim Weg über
 * die Dateien-App regelmäßig einen leeren Typ (dieselbe Falle wie bei den
 * Fotos, M254), und manche Systeme melden für .md schlicht nichts.
 */
export type Vorschau = 'pdf' | 'bild' | 'text' | 'audio' | 'video' | 'keine';

const TEXT_ENDUNGEN = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'yaml', 'yml',
  'ini', 'conf', 'cfg', 'srt', 'vtt', 'sql', 'py', 'js', 'ts', 'css', 'sh',
  'bat', 'ps1', 'java', 'c', 'h', 'cpp', 'rs', 'go', 'php', 'rb', 'toml', 'env',
]);

export function vorschauArt(name: string, mime?: string): Vorschau {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const m = (mime ?? '').toLowerCase();
  if (ext === 'pdf' || m === 'application/pdf') return 'pdf';
  if (m.startsWith('image/')
    || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'heif'].includes(ext)) return 'bild';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'opus'].includes(ext)) return 'audio';
  if (m.startsWith('video/') || ['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(ext)) return 'video';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml'
    || TEXT_ENDUNGEN.has(ext)) return 'text';
  return 'keine';
}

/**
 * Warum es bei manchen Dateien keine Vorschau geben kann — im Klartext.
 *
 * Ein Browser kann nur zeigen, was er selbst versteht. Für Word, Excel und
 * PowerPoint gibt es in PixiNotes eigene Wege (die Datei wird zur Notiz bzw.
 * zur Rechen-Tabelle); ein Archiv oder ein Programm bleibt eine Datei.
 */
export function warumKeineVorschau(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) {
    return 'Ein Archiv zeigt erst etwas, wenn man es auspackt — das gehört ins Dateisystem, nicht ins Board.';
  }
  if (['doc', 'ppt', 'pptx', 'odt', 'odp', 'ods'].includes(ext)) {
    return 'Dieses Office-Format kann der Browser nicht darstellen. Aus dem Programm heraus als PDF speichern — das zeigt PixiNotes dann direkt an.';
  }
  if (['exe', 'msi', 'dmg', 'deb', 'rpm', 'appimage', 'bin'].includes(ext)) {
    return 'Ein Programm wird nicht angezeigt und hier auch nicht ausgeführt.';
  }
  return 'Für dieses Format bringt der Browser keine Anzeige mit. Herunterladen und im passenden Programm öffnen.';
}
