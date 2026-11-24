// M388: Liegt etwas über dem Board, dem die Tasten gehören?
//
// Das Board hört auf einzelne Tasten (N = neue Notiz, F = einpassen, + / −, Leertaste, Strg+Z). Liegt ein
// Fenster darüber — Ticket, Bild-Lupe, Einstellungen, Hilfe, Suche —, gehören die Tasten ihm: Wer dort tippte
// und den Fokus auf einem Knopf hatte, legte dahinter Notizen an oder nahm Schritte zurück.
const FENSTER = '.modal-backdrop, .ticket-modal-backdrop, .pdf-backdrop, .search-backdrop, .onb-backdrop, .lookup-backdrop, .presenter, .qr-blende.gross';

export const overlayOffen = (): boolean => !!document.querySelector(FENSTER);

/**
 * M523: Welches Fenster liegt obenauf? Fenster stapeln sich (Einstellungen, darüber die Hilfe, darüber die Suche …).
 * Gezeichnet wird nach z-index, bei Gleichstand nach der Reihenfolge im Dokument — genau so wird hier sortiert.
 */
const zVon = (el: Element): number => Number(getComputedStyle(el).zIndex) || 0;
export const liegtUeber = (a: Element, b: Element): boolean => {
  const za = zVon(a); const zb = zVon(b);
  return za !== zb ? za > zb : !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
};
export function obenauf(fenster: Iterable<Element>): Element | null {
  let oben: Element | null = null;
  for (const w of fenster) if (!oben || liegtUeber(w, oben)) oben = w;
  return oben;
}
const STAPEL = `${FENSTER}, .nav-backdrop`;
/** Offene Fenster von unten nach oben */
const stapel = (): Element[] => [...document.querySelectorAll(STAPEL)].sort((a, b) => (a === b ? 0 : liegtUeber(a, b) ? 1 : -1));
/* Der Stapel, wie er beim Drücken von Esc stand. Die Zuhörer der Fenster laufen nacheinander, und React hängt ein
   geschlossenes Fenster schon zwischen zwei Zuhörern aus: Fragte der zweite erst dann nach, sähe er das Fenster über
   sich nicht mehr und schlösse seines mit. Dieser Zuhörer ist der erste am Fenster (Capture) und hält den Stand fest. */
let escEreignis: Event | null = null;
let escStapel: Element[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { escEreignis = e; escStapel = stapel(); } }, true);
}
/**
 * M523: Esc gehört dem obersten Fenster. Jedes Fenster hört selbst auf Esc — lagen zwei übereinander (Aufgaben-Zentrale
 * und Einstellungen, Einstellungen und Hilfe), schloss ein Druck beide. Wer auf Esc hört, fragt deshalb zuerst hier:
 * Liegt über mir (`wurzel` = mein eigenes Fenster; null = ich bin kein Fenster, sondern die Ansicht darunter) noch eines?
 * `e` ist das Tasten-Ereignis — damit gilt der Stand vom Tastendruck, nicht der nach dem Schließen des oberen Fensters.
 */
export function fensterDarueber(wurzel: Element | null, e?: Event): boolean {
  const liste = e && e === escEreignis ? escStapel : stapel();
  const fremd = (w: Element) => !wurzel || (w !== wurzel && !wurzel.contains(w) && !w.contains(wurzel));
  const i = wurzel ? liste.indexOf(wurzel) : -1;
  return liste.slice(i + 1).some(fremd);
}
