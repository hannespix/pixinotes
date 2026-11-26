// M554: Die Uhr bewegt nur die Tinte. Die schlanke Grundschrift steht fest.
import { WORTMARKE_GRUND, WORTMARKE_SICHTFELD, WORTMARKE_TINTE } from './agencyWortmarke';
import { agencyZeigerEinrichten } from './agencyZeiger';
import { zugBeobachten, zugLaeuft } from './zugAnzeige';

const NS = 'http://www.w3.org/2000/svg';
const DAUER = 820;
type Bewegung = readonly (readonly [ziel: number, ms: number])[];
const BEWEGUNGEN: readonly Bewegung[] = [
  [[0, 1200], [1, 4200], [1, 900], [0, 5800], [0, 2100]],
  [[0.66, 3600], [0.25, 2600], [1, 4600], [1, 700], [0, 5700], [0, 2200]],
  [[0.42, 3400], [0.08, 2400], [0.78, 4300], [0.38, 2800], [0, 3900], [0, 2600]],
];
// Die Tinte sammelt sich links, fließt um die Öffnung oder Kreuzung nach
// rechts und klingt aus. Die nächste Kontur setzt noch währenddessen ein.
const BUCHSTABEN_ZEITEN = [
  [0.001, 0.17, 0.31, 0.50, 0.68],
  [0.12, 0.29, 0.41, 0.55, 0.69],
  [0.25, 0.41, 0.54, 0.69, 0.83],
  [0.40, 0.55, 0.70, 0.83, 0.99],
] as const;
const glaetten = (t: number) => t * t * t * (t * (6 * t - 15) + 10);

function wortmarkeBauen(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', WORTMARKE_SICHTFELD);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('focusable', 'false');

  const tinte = document.createElementNS(NS, 'g');
  tinte.setAttribute('data-tinte', '');
  tinte.setAttribute('fill-rule', 'evenodd');
  const grund = document.createElementNS(NS, 'g');
  grund.setAttribute('data-grundschrift', '');

  WORTMARKE_GRUND.forEach((d) => {
    const buchstabe = document.createElementNS(NS, 'path');
    // Readex zeichnet überlappende Teile am x als gemeinsame Fläche.
    buchstabe.setAttribute('d', d);
    grund.append(buchstabe);
  });
  WORTMARKE_TINTE.forEach(([trocken, links, uebergang, rechts, ende], i) => {
    const fluessig = document.createElementNS(NS, 'path');
    fluessig.setAttribute('d', trocken);
    const [beginn, , , , ausklang] = BUCHSTABEN_ZEITEN[i];
    // Deckungsgleiche, zusammengefallene Pfade können an ihren Kanten noch
    // Pixel färben. Außerhalb des Tintenflusses malt allein die Grundschrift.
    fluessig.setAttribute('opacity', '0');
    const sichtbar = document.createElementNS(NS, 'set');
    sichtbar.setAttribute('attributeName', 'opacity');
    sichtbar.setAttribute('to', '1');
    sichtbar.setAttribute('begin', `${(beginn * DAUER).toFixed(3)}ms`);
    sichtbar.setAttribute('dur', `${((ausklang - beginn) * DAUER).toFixed(3)}ms`);
    const zug = document.createElementNS(NS, 'animate');
    const zeiten = [0, ...BUCHSTABEN_ZEITEN[i], 1];
    zug.setAttribute('attributeName', 'd');
    zug.setAttribute('dur', `${DAUER}ms`);
    zug.setAttribute('fill', 'freeze');
    zug.setAttribute('calcMode', 'spline');
    zug.setAttribute('keyTimes', zeiten.map((t) => t.toFixed(3)).join(';'));
    zug.setAttribute('keySplines', '0 0 1 1;0.33 0 0.66 0.72;0.3 0.25 0.7 0.72;0.3 0.27 0.7 0.75;0.31 0.38 0.66 1;0 0 1 1');
    zug.setAttribute('values', [trocken, trocken, links, uebergang, rechts, ende, ende].join(';'));
    fluessig.append(sichtbar, zug);
    tinte.append(fluessig);
  });
  svg.append(tinte, grund);
  return svg;
}

export function agencyBewegen(marke: HTMLElement): () => void {
  const wegZeiger = agencyZeigerEinrichten();
  const svg = wortmarkeBauen();
  marke.append(svg);
  svg.pauseAnimations();
  svg.setCurrentTime(0);
  marke.dataset.animiert = '';

  const bewegung = window.matchMedia('(prefers-reduced-motion: reduce)');
  const wurzel = document.documentElement;
  let imBild = !('IntersectionObserver' in window);
  let beendet = false;
  let variante = 0;
  let folge = BEWEGUNGEN[0];
  let abschnitt = 0;
  let vergangen = 0;
  let von = 0;
  let gezeichnet = 0;
  let bild: number | undefined;
  let pause: number | undefined;
  let pausiertSeit: number | undefined;
  let zuletzt: number | undefined;
  const still = () => bewegung.matches || wurzel.dataset.lesbar === 'an';
  const darf = () => !beendet && !still() && imBild && !document.hidden && !zugLaeuft();

  const zeichnen = (lage: number) => {
    if (lage === gezeichnet) return;
    svg.setCurrentTime(lage * DAUER / 1000);
    gezeichnet = lage;
  };
  const naechsterAbschnitt = () => {
    von = folge[abschnitt][0];
    vergangen = 0;
    zuletzt = undefined;
    abschnitt += 1;
    if (abschnitt < folge.length) return;
    variante = (variante + 1 + Math.floor(Math.random() * (BEWEGUNGEN.length - 1))) % BEWEGUNGEN.length;
    folge = BEWEGUNGEN[variante].map(([ziel, ms]) => [ziel, ms * (0.9 + Math.random() * 0.3)] as const);
    abschnitt = 0;
  };

  const anhalten = () => {
    if (bild !== undefined) cancelAnimationFrame(bild);
    if (pause !== undefined) clearTimeout(pause);
    if (pausiertSeit !== undefined) {
      vergangen = Math.min(folge[abschnitt][1], vergangen + performance.now() - pausiertSeit);
    }
    bild = undefined;
    pause = undefined;
    pausiertSeit = undefined;
    zuletzt = undefined;
  };
  const weiter = () => {
    if (!darf() || bild !== undefined || pause !== undefined) return;
    const [nach, dauer] = folge[abschnitt];
    if (nach !== von) {
      bild = requestAnimationFrame(takt);
      return;
    }
    pausiertSeit = performance.now();
    pause = window.setTimeout(() => {
      pause = undefined;
      pausiertSeit = undefined;
      if (!darf()) return;
      naechsterAbschnitt();
      weiter();
    }, dauer - vergangen);
  };
  function takt(jetzt: number) {
    bild = undefined;
    if (!darf()) { anhalten(); return; }
    const [nach, dauer] = folge[abschnitt];
    // Nach einem verdeckten Tab oder einem hängenden Bild an der sichtbaren Stelle fortsetzen.
    vergangen = Math.min(dauer, vergangen + Math.min(jetzt - (zuletzt ?? jetzt), 80));
    zuletzt = jetzt;
    zeichnen(von + (nach - von) * glaetten(vergangen / dauer));
    if (vergangen === dauer) naechsterAbschnitt();
    weiter();
  }
  const abgleichen = () => {
    if (!darf()) anhalten();
    if (still()) {
      variante = 0;
      folge = BEWEGUNGEN[0];
      abschnitt = 0;
      vergangen = 0;
      von = 0;
      zeichnen(0);
    }
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
  document.addEventListener('visibilitychange', abgleichen);
  bewegung.addEventListener('change', abgleichen);
  abgleichen();

  return () => {
    beendet = true;
    anhalten();
    wegZeiger();
    wegZug();
    sichtbar?.disconnect();
    lesbarkeit.disconnect();
    document.removeEventListener('visibilitychange', abgleichen);
    bewegung.removeEventListener('change', abgleichen);
    delete marke.dataset.animiert;
    svg.remove();
  };
}
