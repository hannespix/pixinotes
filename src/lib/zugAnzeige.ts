// M485: Was eine Karte während eines Zugs SICHTBAR anders macht als ihre Lage im Stand — als Brücke zwischen dem
// Ziehen (lib/ziehGefuehl.ts, nachgeladen) und den Verbindungen (LabeledEdge, Start). Gehoben, geneigt und
// ausgewichen wird nur über CSS am Knoten (M481), React Flow kennt davon nichts; die Kanten zeigten deshalb auf die
// ungehobene Lage. Hier steht je Karte [dx, dy, Skala, Winkel°] (Mitte als Drehpunkt), die Kanten rechnen damit.
// Bewusst winzig und ohne Stand: nichts davon wird gespeichert oder ans Live-Team geschickt.
import { useSyncExternalStore } from 'react';

export type Anzeige = readonly [dx: number, dy: number, skala: number, winkel: number];

const lage = new Map<string, Anzeige>();
const hoerer = new Set<() => void>();

/** Anzeige einer Karte setzen (ohne Wert: wieder wie im Stand). Erst `anzeigeMelden` weckt die Kanten. */
let stand = 0;
export const anzeigeSetzen = (id: string, a?: Anzeige): void => { stand += 1; if (a) lage.set(id, a); else lage.delete(id); };
/** M486: zählt jede Änderung — Kanten rechnen ihre Hindernisse nur bei neuem Stand neu */
export const anzeigeStand = (): number => stand;
/** Kanten neu zeichnen lassen — einmal je Bild, nicht je Karte */
export const anzeigeMelden = (): void => hoerer.forEach((f) => f());

export const hoeren = (f: () => void) => { hoerer.add(f); return () => { hoerer.delete(f); }; };
/** M486: Anzeige einer Karte ohne Abo (Hindernisse der Kanten) */
export const anzeigeVon = (id: string): Anzeige | undefined => lage.get(id);
/** Die Anzeige einer Karte als React-Wert (undefined = wie im Stand) */
export const useAnzeige = (id: string): Anzeige | undefined => useSyncExternalStore(hoeren, () => lage.get(id));

/**
 * M491: Läuft gerade ein Zug? Kanten, die sich darin bewegen, blenden ihren weichen Schatten aus (der gemeinsame
 * Weichzeichner, M434, müsste sonst Bild für Bild neu gerastert werden) und holen ihn nach dem Ablegen zurück.
 */
let zug = false;
const nachZugHoerer = new Set<() => void>();
export const zugLaeuft = (): boolean => zug;
/** M535: hören, wann ein Zug beginnt und endet (animierte Bilder zeigen im Zug ihr Standbild) */
const zugHoerer = new Set<() => void>();
export const zugBeobachten = (f: () => void): (() => void) => { zugHoerer.add(f); return () => { zugHoerer.delete(f); }; };
export function zugSetzen(an: boolean): void {
  if (zug === an) return;
  zug = an;
  zugHoerer.forEach((f) => f());
  if (!an) { const h = [...nachZugHoerer]; nachZugHoerer.clear(); h.forEach((f) => f()); }
}
/** Einmal rufen, sobald der laufende Zug vorbei ist */
export const nachZug = (f: () => void): void => { nachZugHoerer.add(f); };
/**
 * M539: Was die App nach dem Start von selbst nachlädt (Vorladen im Leerlauf, Zurück-Taste, Texterkennung,
 * Sicherung), nicht mitten in einen Zug legen. Jedes `import()` hängt `<link rel="modulepreload">` in den Kopf — das
 * prüft Chromium gegen alle `:has()`-Regeln mit Subjekt `html` und rechnet den Stil des ganzen Dokuments neu (gut
 * 40 ms, ein Ruckler; Regel aus M491). Läuft ein Zug, kommt es kurz nach dem Ablegen.
 */
export function ausserhalbZug(f: () => void): void {
  if (!zug) { f(); return; }
  nachZug(() => { window.setTimeout(() => ausserhalbZug(f), 400); });
}
