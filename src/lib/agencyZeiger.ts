// M549: Der Ring gehört zur Kopfleiste, den Reitern und dem Dock. Die Zeichenfläche
// nutzt ihre eigenen Zeiger für Stift, Text, Verbindungen und das Verschieben.
import { zugLaeuft } from './zugAnzeige';

const LEISTEN = '.topbar, .tabs, .dock';
const BEDIENUNG = 'button, a[href], [role="button"], [role="tab"]';
const EINGABE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export function agencyZeigerEinrichten(): () => void {
  const maus = window.matchMedia('(any-hover: hover) and (any-pointer: fine) and (prefers-reduced-motion: no-preference)');
  const wurzel = document.documentElement;
  const ring = document.createElement('div');
  ring.className = 'agency-zeiger';
  ring.setAttribute('aria-hidden', 'true');
  ring.hidden = true;
  document.body.append(ring);

  let ziel: Element | null = null;
  const standardZeiger = () => wurzel.dataset.lesbar === 'an' || wurzel.dataset.kontrast === 'hoch';
  const ausblenden = () => {
    if (!ziel) return;
    ziel.removeAttribute('data-agency-zeiger');
    ziel = null;
    ring.hidden = true;
  };
  const bewegen = (e: PointerEvent) => {
    if (!maus.matches || e.pointerType !== 'mouse' || e.buttons || zugLaeuft() || standardZeiger()) {
      ausblenden();
      return;
    }
    const element = e.target instanceof Element ? e.target : null;
    if (!element || element.closest(EINGABE)) { ausblenden(); return; }
    const leiste = element.closest(LEISTEN);
    const knopf = element.closest(BEDIENUNG);
    const bedienbar = knopf && leiste?.contains(knopf) && !knopf.matches(':disabled, [aria-disabled="true"]');
    const naechstes = bedienbar ? knopf : element === leiste ? leiste : null;
    if (!naechstes) { ausblenden(); return; }
    ring.style.translate = `${e.clientX}px ${e.clientY}px`;
    if (ziel === naechstes) return;
    ziel?.removeAttribute('data-agency-zeiger');
    ziel = naechstes;
    ring.hidden = false;
    ring.classList.toggle('aktiv', !!bedienbar);
    ziel.setAttribute('data-agency-zeiger', '');
  };
  const verlassen = (e: PointerEvent) => {
    if (ziel && (!(e.relatedTarget instanceof Node) || !ziel.contains(e.relatedTarget))) ausblenden();
  };
  const optionen = new MutationObserver(() => { if (standardZeiger()) ausblenden(); });
  optionen.observe(wurzel, { attributes: true, attributeFilter: ['data-lesbar', 'data-kontrast'] });
  document.addEventListener('pointermove', bewegen, { passive: true });
  document.addEventListener('pointerout', verlassen);
  document.addEventListener('pointercancel', ausblenden);
  document.addEventListener('pointerdown', ausblenden);
  document.addEventListener('visibilitychange', ausblenden);
  window.addEventListener('blur', ausblenden);
  maus.addEventListener('change', ausblenden);

  return () => {
    ausblenden();
    optionen.disconnect();
    ring.remove();
    document.removeEventListener('pointermove', bewegen);
    document.removeEventListener('pointerout', verlassen);
    document.removeEventListener('pointercancel', ausblenden);
    document.removeEventListener('pointerdown', ausblenden);
    document.removeEventListener('visibilitychange', ausblenden);
    window.removeEventListener('blur', ausblenden);
    maus.removeEventListener('change', ausblenden);
  };
}
