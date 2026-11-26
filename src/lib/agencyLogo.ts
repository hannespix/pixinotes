// M549: Die Flüssigkeit ist Teil der Buchstaben. Der Browser interpoliert ihre Konturen;
// JavaScript bewegt die gemeinsame SVG-Uhr nur während eines Ein- oder Auslaufs.
import { WORTMARKE, WORTMARKE_SICHTFELD } from './agencyWortmarke';
import { agencyZeigerEinrichten } from './agencyZeiger';
import { zugBeobachten, zugLaeuft } from './zugAnzeige';

const NS = 'http://www.w3.org/2000/svg';
const DAUER = 820;

function wortmarkeBauen(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', WORTMARKE_SICHTFELD);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('focusable', 'false');

  WORTMARKE.forEach(([grund, nass, ende], i) => {
    const buchstabe = document.createElementNS(NS, 'path');
    // Readex zeichnet überlappende Teile etwa am x und t als gemeinsame Fläche.
    buchstabe.setAttribute('d', grund);
    const zug = document.createElementNS(NS, 'animate');
    const zeiten = [0, 0.025 + i * 0.058, 0.22 + i * 0.065, 0.48 + i * 0.06, 1];
    zug.setAttribute('attributeName', 'd');
    zug.setAttribute('dur', `${DAUER}ms`);
    zug.setAttribute('fill', 'freeze');
    zug.setAttribute('calcMode', 'spline');
    zug.setAttribute('keyTimes', zeiten.map((t) => t.toFixed(3)).join(';'));
    zug.setAttribute('keySplines', '0 0 1 1;0.33 0 0.40 1;0.46 0 0.52 1;0 0 1 1');
    zug.setAttribute('values', [grund, grund, nass, ende, ende].join(';'));
    buchstabe.append(zug);
    svg.append(buchstabe);
  });
  return svg;
}

export function agencyBewegen(marke: HTMLElement): () => void {
  const knopf = marke.closest('button');
  if (!knopf) return () => {};
  const wegZeiger = agencyZeigerEinrichten();
  const svg = wortmarkeBauen();
  marke.append(svg);
  svg.pauseAnimations();
  svg.setCurrentTime(0);
  marke.dataset.animiert = '';

  const bewegung = window.matchMedia('(prefers-reduced-motion: reduce)');
  const wurzel = document.documentElement;
  let imBild = !('IntersectionObserver' in window);
  let maus = false;
  let einlauf = true;
  let fortschritt = 0;
  let bild: number | undefined;
  let zuletzt: number | undefined;
  const still = () => bewegung.matches || wurzel.dataset.lesbar === 'an';
  const darf = () => !still() && imBild && !document.hidden && !zugLaeuft();
  const ziel = () => maus || knopf.matches(':focus-visible') || einlauf ? 1 : 0;

  const anhalten = () => {
    if (bild !== undefined) cancelAnimationFrame(bild);
    bild = undefined;
    zuletzt = undefined;
  };
  const weiter = () => {
    if (bild === undefined && darf() && fortschritt !== ziel()) bild = requestAnimationFrame(takt);
  };
  function takt(jetzt: number) {
    bild = undefined;
    if (!darf()) { anhalten(); return; }
    const ende = ziel();
    const schritt = Math.min(jetzt - (zuletzt ?? jetzt), 45) / DAUER;
    fortschritt = ende === 1 ? Math.min(1, fortschritt + schritt) : Math.max(0, fortschritt - schritt * 1.24);
    svg.setCurrentTime(fortschritt * DAUER / 1000);
    if (fortschritt === 1) einlauf = false;
    zuletzt = fortschritt === ziel() ? undefined : jetzt;
    weiter();
  }
  const abgleichen = () => {
    if (!darf()) anhalten();
    if (still() && (einlauf || fortschritt !== 0)) {
      einlauf = false;
      fortschritt = 0;
      svg.setCurrentTime(0);
    }
    weiter();
  };
  const hinein = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    maus = true;
    weiter();
  };
  const hinaus = () => {
    maus = false;
    weiter();
  };
  const sichtbar = 'IntersectionObserver' in window
    ? new IntersectionObserver(([e]) => {
      imBild = e.isIntersecting;
      abgleichen();
    })
    : undefined;
  sichtbar?.observe(marke);
  const lesbarkeit = new MutationObserver(abgleichen);
  lesbarkeit.observe(wurzel, { attributes: true, attributeFilter: ['data-lesbar'] });
  const wegZug = zugBeobachten(abgleichen);
  knopf.addEventListener('pointerenter', hinein);
  knopf.addEventListener('pointerleave', hinaus);
  knopf.addEventListener('focus', weiter);
  knopf.addEventListener('blur', weiter);
  document.addEventListener('visibilitychange', abgleichen);
  bewegung.addEventListener('change', abgleichen);
  abgleichen();

  return () => {
    anhalten();
    wegZeiger();
    wegZug();
    sichtbar?.disconnect();
    lesbarkeit.disconnect();
    knopf.removeEventListener('pointerenter', hinein);
    knopf.removeEventListener('pointerleave', hinaus);
    knopf.removeEventListener('focus', weiter);
    knopf.removeEventListener('blur', weiter);
    document.removeEventListener('visibilitychange', abgleichen);
    bewegung.removeEventListener('change', abgleichen);
    delete marke.dataset.animiert;
    svg.remove();
  };
}
