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

/** M561: Die angeheftete Navigation liegt schon außerhalb der React-Flow-Fläche. */
export function modulAusschnitt(flaeche: DOMRect, karte: { x: number; y: number; w: number; h: number }, anzeige: number) {
  const links = Math.max(0, flaeche.left);
  const rechts = Math.min(window.innerWidth, flaeche.right);
  const ueberlappt = (r: DOMRect) => r.width > 0 && r.height > 0 && r.right > links && r.left < rechts;
  let oben = Math.max(0, flaeche.top);
  for (const el of document.querySelectorAll('.topbar, .tabs:not(.spalte)')) {
    const r = el.getBoundingClientRect();
    if (ueberlappt(r)) oben = Math.max(oben, r.bottom);
  }
  const dock = document.querySelector('.dock')?.getBoundingClientRect();
  const unten = Math.min(window.innerHeight, flaeche.bottom, dock && ueberlappt(dock) ? dock.top : Infinity);
  const breite = rechts - links;
  const hoehe = unten - oben;
  if (breite <= 0 || hoehe <= 0) return null;
  const rand = Math.min(24, breite * 0.08, hoehe * 0.08);
  const platzX = breite - 2 * rand;
  const platzY = hoehe - 2 * rand;
  // Auf schmaler Fläche passen übliche Karten auch unter 90 % noch lesbar hinein.
  const lesbar = (breite < 640 ? 0.72 : 0.9) * anzeige;
  const zoom = Math.max(lesbar, Math.min(1.6 * anzeige, platzX / karte.w, platzY / karte.h));
  // Bei Übergröße bleibt der Inhaltsanfang im Bild, statt die Schrift winzig zu machen.
  return { zoom,
    x: links - flaeche.left + rand + Math.max(0, (platzX - karte.w * zoom) / 2) - karte.x * zoom,
    y: oben - flaeche.top + rand + Math.max(0, (platzY - karte.h * zoom) / 2) - karte.y * zoom };
}
