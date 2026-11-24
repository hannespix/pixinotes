// M389: Fokus-Führung für alle Fenster — an EINER Stelle.
//
// Öffnete sich ein Fenster (Einstellungen, Hilfe, Freigabe, Ticket, Suche …), blieb der Tastatur-Fokus dort, wo er
// war: auf dem Knopf dahinter oder in der Notiz. Tab wanderte dann durch das Board HINTER dem Fenster, ein
// Vorlese-Programm las weiter die Karte vor, und nach dem Schließen stand der Fokus irgendwo. Jetzt gilt für jedes
// Fenster dasselbe, ohne dass es selbst etwas dafür tun muss:
//   · Beim Öffnen geht der Fokus ins Fenster (auf das Fenster selbst — kein Knopf wird „vorgewählt"; hat das
//     Fenster sein Eingabefeld schon selbst angewählt, bleibt es dabei).
//   · Tab und Umschalt+Tab laufen im obersten Fenster im Kreis.
//   · Beim Schließen kehrt der Fokus dorthin zurück, wo er vorher war.
// M447: auch die Bild-Lupe (.pdf-backdrop) ist ein Fenster
// M456: und die ausklappbare Navigation am Telefon (.nav-backdrop, Tabs.tsx) — Fokus hinein, Tab im Kreis, zurück
import { obenauf } from './overlay';

const FENSTER = '.modal-backdrop, .ticket-modal-backdrop, .search-backdrop, .onb-backdrop, .lookup-backdrop, .pdf-backdrop, .nav-backdrop';
const ZIELE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const zieleIn = (w: Element): HTMLElement[] => [...w.querySelectorAll<HTMLElement>(ZIELE)].filter((el) => el.getClientRects().length > 0);
// M523: das oberste nach z-index, dann nach Reihenfolge im Dokument (vorher: das letzte im Dokument — die Hilfe über den
// Einstellungen stand im Dokument davor, Tab lief dann im verdeckten Fenster)
const oberstes = (): Element | null => obenauf(document.querySelectorAll(FENSTER));
const istTextfeld = (el: Element | null): boolean => !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes(el.type)) || (el as HTMLElement).isContentEditable);

export function fensterFokusStarten(): () => void {
  const vorher = new Map<Element, HTMLElement | null>();

  const geoeffnet = (w: Element) => {
    if (vorher.has(w)) return;
    /* M523: Was zuletzt aufgeht, liegt obenauf. Einstellungen, Hilfe und Suche teilen sich eine Ebene und stehen in
       fester Reihenfolge im Dokument — die Hilfe (Alt+H) öffnete sich deshalb HINTER den offenen Einstellungen, die
       Suche (Strg+K) hinter beiden. Liegt schon ein Fenster darüber, hebt sich das neue genau eine Stufe darüber. */
    const andere = [...document.querySelectorAll(FENSTER)].filter((x) => x !== w && !x.contains(w) && !w.contains(x));
    const oben = obenauf(andere);
    if (oben && obenauf([oben, w]) === oben && w instanceof HTMLElement) w.style.zIndex = String((Number(getComputedStyle(oben).zIndex) || 0) + 1);
    vorher.set(w, document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
    // Ein Bild später: Fenster mit eigenem autoFocus (Suche, Umbenennen) haben ihr Feld dann schon angewählt
    requestAnimationFrame(() => {
      if (!w.isConnected || w.contains(document.activeElement)) return;
      const kasten = (w.querySelector('[role="dialog"], .modal') ?? w.firstElementChild ?? w) as HTMLElement;
      if (!kasten.hasAttribute('tabindex')) kasten.setAttribute('tabindex', '-1');
      kasten.dataset.fenster = '1';
      kasten.focus({ preventScroll: true });
    });
  };
  const geschlossen = () => {
    for (const [w, el] of vorher) {
      if (w.isConnected) continue;
      vorher.delete(w);
      // Nur zurück, wenn der Fokus mit dem Fenster verschwunden ist — nicht, wenn der Schließen-Weg ihn schon
      // gezielt woandershin gesetzt hat. Am Finger kein Textfeld anwählen: Das klappte die Tastatur auf.
      const frei = !document.activeElement || document.activeElement === document.body;
      if (!frei || !el?.isConnected) continue;
      if (istTextfeld(el) && window.matchMedia('(pointer: coarse)').matches) continue;
      const o = oberstes();
      if (o && !o.contains(el)) continue;
      el.focus({ preventScroll: true });
    }
  };

  const beobachter = new MutationObserver((ms) => {
    let weg = false;
    for (const m of ms) {
      m.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        if (n.matches(FENSTER)) geoeffnet(n);
        else n.querySelectorAll?.(FENSTER).forEach(geoeffnet);
      });
      if (m.removedNodes.length) weg = true;
    }
    if (weg && vorher.size) geschlossen();
  });
  beobachter.observe(document.body, { childList: true, subtree: true });

  const taste = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const w = oberstes();
    if (!w) return;
    const a = document.activeElement as HTMLElement | null;
    // In einem Text-Editor gehört Tab dem Editor (Einrücken)
    if (a?.isContentEditable && w.contains(a)) return;
    const z = zieleIn(w);
    if (!z.length) { e.preventDefault(); return; }
    const erstes = z[0]; const letztes = z[z.length - 1];
    if (!a || !w.contains(a) || a.dataset.fenster === '1') { e.preventDefault(); (e.shiftKey ? letztes : erstes).focus(); return; }
    if (e.shiftKey && a === erstes) { e.preventDefault(); letztes.focus(); }
    else if (!e.shiftKey && a === letztes) { e.preventDefault(); erstes.focus(); }
  };
  window.addEventListener('keydown', taste, true);

  return () => { beobachter.disconnect(); window.removeEventListener('keydown', taste, true); };
}
