// M335: PDF-Karten mit Seiten — Anmerkungen gehören zur SEITE, nicht zur Karte.
//
// Eine aufgeklappte PDF-Karte zeigt genau eine Seite in Kartenbreite. Striche
// und Kommentar-Pins darauf werden in SEITENPUNKTEN gespeichert (PDF-Punkte,
// Ursprung oben links der Seite, Maßstab 1), zusammen mit der Seitennummer.
// So sitzen sie nach jeder Breitenänderung, in jedem Zoom und auf jedem Gerät
// exakt an derselben Stelle — und lassen sich später eins zu eins in die PDF
// exportieren. Die Karte meldet hier, WO die Seite gerade in ihr liegt
// (Versatz zur Kartenecke und Maßstab); Zeichen- und Kommentar-Ebene rechnen
// damit um. Ohne Meldung (Karte zugeklappt, andere Seite) bleiben die
// Anmerkungen unsichtbar — der Zähler auf der Karte sagt, dass es sie gibt.
import type { CommentThread, Stroke } from '../store';

export interface SeitenGeometrie {
  /** Angezeigte Seite (1-basiert) */
  seite: number;
  /** Anzahl Seiten des Dokuments */
  seiten: number;
  /** Lage der Seiten-Ecke oben links, relativ zur Kartenecke (Flow-Einheiten) */
  dx: number;
  dy: number;
  /** Flow-Einheiten je PDF-Punkt (Seitenbreite in der Karte / Seitenbreite in Punkten) */
  k: number;
  /** Seitengröße in PDF-Punkten */
  breite: number;
  hoehe: number;
}

const geometrien = new Map<string, SeitenGeometrie>();
export const SEITEN_EREIGNIS = 'pixinotes:pdf-seite';

/** Die Karte meldet ihre sichtbare Seite — oder null beim Zuklappen/Abbauen */
export function seiteMelden(nodeId: string, g: SeitenGeometrie | null): void {
  const alt = geometrien.get(nodeId);
  if (!g) {
    if (!alt) return;
    geometrien.delete(nodeId);
  } else {
    if (alt && alt.seite === g.seite && alt.seiten === g.seiten && Math.abs(alt.dx - g.dx) < 0.01 && Math.abs(alt.dy - g.dy) < 0.01
      && Math.abs(alt.k - g.k) < 1e-6 && alt.breite === g.breite && alt.hoehe === g.hoehe) return;
    geometrien.set(nodeId, g);
  }
  window.dispatchEvent(new CustomEvent(SEITEN_EREIGNIS, { detail: nodeId }));
}

export function seiteVon(nodeId: string): SeitenGeometrie | undefined {
  return geometrien.get(nodeId);
}

/** Kartenrelative Punkte → Seitenpunkte (beim Ankern eines Strichs auf einer aufgeklappten Seite) */
export function aufSeite(points: [number, number][], g: SeitenGeometrie): [number, number][] {
  return points.map(([x, y]) => [(x - g.dx) / g.k, (y - g.dy) / g.k] as [number, number]);
}

/** Seitenpunkte → kartenrelative Punkte (zum Zeichnen) */
export function vonSeite(points: [number, number][], g: SeitenGeometrie): [number, number][] {
  return points.map(([x, y]) => [g.dx + x * g.k, g.dy + y * g.k] as [number, number]);
}

/**
 * Punkte eines geankerten Strichs RELATIV zur Kartenecke — für normale Striche
 * die gespeicherten, für Seitenstriche umgerechnet. Leer, wenn die Seite gerade
 * nicht zu sehen ist (Karte zugeklappt oder andere Seite aufgeschlagen).
 */
export function strichRelativ(s: Stroke): [number, number][] {
  if (s.seite == null || !s.anchor) return s.points;
  const g = geometrien.get(s.anchor);
  if (!g || g.seite !== s.seite) return [];
  return vonSeite(s.points, g);
}

/** Welche Seite liegt gerade offen? (für das Ankern neuer Striche) */
export function offeneSeite(nodeId: string): SeitenGeometrie | undefined {
  return geometrien.get(nodeId);
}

/* ---------- Auf-/zugeklappt: Geräte-Ansicht, nicht Inhalt ---------- */
const AUF_KEY = 'pixinotes-pdf-auf';
function aufLesen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(AUF_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; }
}
export function pdfAufgeklappt(nodeId: string): boolean {
  return !!aufLesen()[nodeId];
}
export function pdfAufklappen(nodeId: string, auf: boolean): void {
  const m = aufLesen();
  if (auf) m[nodeId] = true; else delete m[nodeId];
  try { localStorage.setItem(AUF_KEY, JSON.stringify(m)); } catch { /* Sitzung reicht */ }
}

/* ---------- M336: Kommentare je Seite ---------- */
/** Kommentare einer Karte auf einer Seite, in Entstehungsreihenfolge — die Nummer ist der Index + 1 (Pin, Liste, Blase stimmen überein) */
export function seitenKommentare(threads: CommentThread[] | undefined, nodeId: string, seite: number): CommentThread[] {
  return (threads ?? [])
    .filter((c) => c.nodeId === nodeId && c.seite === seite)
    .sort((a, b) => (a.msgs[0]?.at ?? '').localeCompare(b.msgs[0]?.at ?? '') || a.id.localeCompare(b.id));
}

/** Textblasen neben den Seiten-Pins — Geräte-Einstellung, Vorgabe an */
const BLASEN_KEY = 'pixinotes-pdf-blasen';
export function blasenAn(): boolean {
  try { return localStorage.getItem(BLASEN_KEY) !== '0'; } catch { return true; }
}
export function blasenSetzen(an: boolean): void {
  try { localStorage.setItem(BLASEN_KEY, an ? '1' : '0'); } catch { /* Sitzung reicht */ }
  window.dispatchEvent(new CustomEvent(SEITEN_EREIGNIS, { detail: 'blasen' }));
}
