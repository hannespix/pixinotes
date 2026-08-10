/**
 * M251: Eine einzige Quelle für alle Tastenkürzel.
 *
 * Vorher standen die Kürzel an drei Stellen: im Tastatur-Handler, als
 * „(Strg+Z)" im Titel-Text einzelner Knöpfe und in der Hilfe-Tabelle. Drei
 * Orte heißt: früher oder später widersprechen sie sich. Jetzt steht jedes
 * Kürzel genau HIER, und alle drei Stellen lesen es von hier ab:
 *
 *   · Tastatur.tsx  führt es aus
 *   · TooltipLayer  hängt es beim Überfahren in Klammern an die Sprechblase
 *   · HelpOverlay   baut daraus die Tabelle „Tastenkürzel"
 *
 * Schreibweise für den Mac: Strg → ⌘, Alt → ⌥, Entf → ⌫. Wir fragen dafür die
 * Plattform ab, denn ein Mac-Nutzer findet „Strg+K" nicht auf seiner Tastatur.
 */

export type Bereich = 'überall' | 'board' | 'lesen';

export interface Kuerzel {
  /** Kennung, mit der Knöpfe und Hilfe darauf zeigen */
  id: string;
  /** Anzeige unter Windows/Linux, z. B. 'Alt+A' */
  taste: string;
  /** Abweichende Anzeige auf dem Mac (sonst wird automatisch übersetzt) */
  mac?: string;
  /** Was es tut — Text für die Hilfe-Tabelle */
  was: string;
  /** Gruppe in der Hilfe */
  gruppe: 'Überall' | 'Board' | 'Karten' | 'Ansichten' | 'Text & Zeichnen';
  /**
   * Nur Dokumentation: Diese Kürzel kommen von React Flow, vom Editor oder vom
   * Browser — wir führen sie nicht selbst aus, sollen sie aber erklären.
   */
  fremd?: boolean;
}

export const KUERZEL: Kuerzel[] = [
  // ── Überall erreichbar ──────────────────────────────────────────────────
  { id: 'suche', taste: 'Strg+K', was: 'Suche über alles — und Befehle', gruppe: 'Überall' },
  { id: 'hilfe', taste: 'Alt+H', was: 'Hilfe öffnen und schließen', gruppe: 'Überall' },
  { id: 'einstellungen', taste: 'Alt+E', was: 'Einstellungen öffnen und schließen', gruppe: 'Überall' },
  { id: 'aufgaben', taste: 'Alt+T', was: 'Aufgaben-Zentrale öffnen und schließen', gruppe: 'Überall' },
  { id: 'schliessen', taste: 'Esc', was: 'Menü, Fenster oder Zeichenmodus schließen', gruppe: 'Überall', fremd: true },

  // ── Ansichten ───────────────────────────────────────────────────────────
  { id: 'ueberblick', taste: 'Alt+U', was: 'Überblick-Leiste aus- und einfahren', gruppe: 'Ansichten' },
  { id: 'netz', taste: 'Alt+G', was: 'Gliederung/Netz — und zurück zum Board', gruppe: 'Ansichten' },
  { id: 'navigator', taste: 'Alt+W', was: 'Navigator (Bereiche › Projekte › Boards)', gruppe: 'Ansichten' },
  { id: 'praesentation', taste: 'Alt+P', was: 'Präsentation starten', gruppe: 'Ansichten' },
  { id: 'boardVor', taste: 'Alt+→', was: 'nächstes Board im Projekt', gruppe: 'Ansichten' },
  { id: 'boardZurueck', taste: 'Alt+←', was: 'vorheriges Board im Projekt', gruppe: 'Ansichten' },
  { id: 'boardNummer', taste: 'Alt+1 … Alt+9', was: 'direkt zum 1. bis 9. Board des Projekts', gruppe: 'Ansichten' },

  // ── Karten ──────────────────────────────────────────────────────────────
  { id: 'neueNotiz', taste: 'N', was: 'neue Notiz in der Bildmitte', gruppe: 'Karten' },
  { id: 'archivieren', taste: 'Alt+A', was: 'ausgewählte Karten archivieren (Strg+Z holt sie zurück)', gruppe: 'Karten' },
  { id: 'archivZeigen', taste: 'Alt+Umschalt+A', was: 'Archiv ein- und ausblenden', gruppe: 'Karten' },
  { id: 'fokus', taste: 'Alt+F', was: 'ausgewählte Karte im Fokus öffnen und schließen', gruppe: 'Karten' },
  { id: 'alleWaehlen', taste: 'Strg+A', was: 'alle Karten des Boards auswählen', gruppe: 'Karten' },
  { id: 'loeschen', taste: 'Entf', was: 'Auswahl oder Verbindung löschen', gruppe: 'Karten', fremd: true },
  { id: 'einfuegen', taste: 'Strg+V', was: 'Screenshot, Bild oder Text einfügen', gruppe: 'Karten', fremd: true },

  // ── Board ───────────────────────────────────────────────────────────────
  { id: 'rueckgaengig', taste: 'Strg+Z', was: 'rückgängig', gruppe: 'Board' },
  { id: 'wiederholen', taste: 'Strg+Y', was: 'wiederholen', gruppe: 'Board' },
  { id: 'einpassen', taste: 'F', was: 'Auswahl einpassen — ohne Auswahl das ganze Board', gruppe: 'Board' },
  { id: 'raster', taste: 'Alt+R', was: 'Raster-Fang ein- und ausschalten', gruppe: 'Board' },
  { id: 'physik', taste: 'Alt+O', was: 'Physik (Karten weichen aus) ein- und ausschalten', gruppe: 'Board' },
  { id: 'schwenken', taste: 'Leertaste halten', was: 'Ansicht verschieben, auch über Karten', gruppe: 'Board', fremd: true },
  { id: 'zurueckfliegen', taste: 'Esc', was: 'nach einem Klick-Zoom zurück zur alten Position', gruppe: 'Board', fremd: true },

  // ── Text & Zeichnen ─────────────────────────────────────────────────────
  { id: 'zeichnen', taste: 'Alt+Z', was: 'Zeichnen (Stift) ein- und ausschalten', gruppe: 'Text & Zeichnen' },
  { id: 'blockMenue', taste: '/', was: 'Block-Menü im Notiz-Editor', gruppe: 'Text & Zeichnen', fremd: true },
  { id: 'blaettern', taste: '← → / Leertaste', was: 'in der Präsentation blättern', gruppe: 'Text & Zeichnen', fremd: true },
];

const NACH_ID = new Map(KUERZEL.map((k) => [k.id, k]));

/** Läuft die App auf einem Mac oder iPad? Dort heißen die Tasten anders. */
function istApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** Anzeigetext eines Kürzels — auf dem Mac mit ⌘/⌥ statt Strg/Alt */
export function taste(id: string): string {
  const k = NACH_ID.get(id);
  if (!k) return '';
  if (!istApple()) return k.taste;
  if (k.mac) return k.mac;
  return k.taste
    .replace(/Strg\+/g, '⌘')
    .replace(/Alt\+/g, '⌥')
    .replace(/Umschalt\+/g, '⇧')
    .replace(/Entf/g, '⌫');
}

/**
 * Titel für eine Sprechblase: „Karte archivieren (Alt+A)".
 *
 * Am Touchgerät bleibt das Kürzel weg — dort gibt es keine Tastatur, und der
 * Zusatz würde die ohnehin knappe Sprechblase nur zustellen.
 */
export function mitTaste(titel: string, id: string): string {
  const t = taste(id);
  if (!t) return titel;
  if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return titel;
  return `${titel} (${t})`;
}

/**
 * Passt das Tastatur-Ereignis zu diesem Kürzel?
 *
 * Wichtig für deutsche Tastaturen: AltGr meldet sich als Strg+Alt. Ein reines
 * Alt-Kürzel darf deshalb NIE zünden, wenn zusätzlich Strg gedrückt ist —
 * sonst würde AltGr+Q (@) die Anwendung fernsteuern.
 */
export function passt(e: KeyboardEvent, id: string): boolean {
  const k = NACH_ID.get(id);
  if (!k || k.fremd) return false;
  const teile = k.taste.split('+');
  const brauchtAlt = teile.includes('Alt');
  const brauchtStrg = teile.includes('Strg');
  const brauchtShift = teile.includes('Umschalt');
  const taste_ = teile[teile.length - 1];

  if (brauchtAlt !== e.altKey) return false;
  if (brauchtStrg !== (e.ctrlKey || e.metaKey)) return false;
  if (brauchtAlt && (e.ctrlKey || e.metaKey)) return false; // AltGr-Falle
  if (brauchtShift !== e.shiftKey) return false;

  if (taste_ === '→') return e.key === 'ArrowRight';
  if (taste_ === '←') return e.key === 'ArrowLeft';
  // e.key liefert unter Alt je nach Layout Sonderzeichen (Alt+A → 'å' auf dem
  // Mac). e.code ist layoutunabhängig und damit die verlässliche Quelle.
  if (/^[A-Za-z]$/.test(taste_)) return e.code === `Key${taste_.toUpperCase()}`;
  return e.key.toLowerCase() === taste_.toLowerCase();
}
