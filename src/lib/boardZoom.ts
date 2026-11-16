// M392: Der Zoom des Boards, für alles, was Bildpunkte zählen muss.
//
// Eine PDF-Seite wird als Bild gemalt. Das Bild war so breit wie die Karte — wer in eine kleine Karte hineinzoomte
// (oder sie im Fokus groß sah), bekam ein kleines Bild groß gezogen: grob, Schrift kaum zu entziffern. Erst das
// Aufziehen der Karte brachte mehr Auflösung. Jetzt meldet das Board seinen Zoom hierher, sobald er ruht, und wer
// malt, fragt nach der STUFE: der nächsthöheren aus einer festen Leiter. So ist das Bild nie gröber als der Schirm,
// und nicht jeder Zoom-Schritt malt neu.

export const BOARD_ZOOM = 'pixinotes:board-zoom';
let zoom = 1;

/** Vom Board gerufen, wenn der Zoom ruht (er trägt die Anzeigegröße schon in sich, M268) */
export function boardZoomMelden(z: number): void {
  if (!Number.isFinite(z) || z <= 0 || Math.abs(z - zoom) < 0.004) return;
  zoom = z;
  window.dispatchEvent(new Event(BOARD_ZOOM));
}
export const boardZoom = (): number => zoom;

const LEITER = [1, 1.5, 2, 3, 4, 6, 8];
/**
 * Die Stufe, in der ein Bild für diesen Zoom gemalt wird. Nie unter 1: Herausgezoomt bleibt das Bild, wie es bei
 * 100 % wäre — wer wieder hineinzoomt, sieht sofort scharf.
 */
export function zoomStufe(z: number = zoom): number {
  for (const s of LEITER) if (z <= s * 1.02) return s;
  return LEITER[LEITER.length - 1];
}
