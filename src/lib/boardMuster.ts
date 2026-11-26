export type BoardMuster = 'clean' | 'dots' | 'linien' | 'kreuze';

/** Ohne eigene Auswahl bleibt das bisherige Muster für den Raster-Fang erhalten. */
export function sichtbaresBoardMuster(muster: unknown, gridSnap: boolean): BoardMuster {
  if (muster === 'clean' || muster === 'dots' || muster === 'linien' || muster === 'kreuze') return muster;
  return gridSnap ? 'linien' : 'dots';
}
