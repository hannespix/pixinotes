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
