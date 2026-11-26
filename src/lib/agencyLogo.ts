// M555: Originaler Lottie-Zeittakt aus vave.log, mit Konturen für „pixi“.
import lottie from 'lottie-web/build/player/lottie_light';
import wortmarke from '../assets/pixi-logo.json';
import { agencyZeigerEinrichten } from './agencyZeiger';
import { zugBeobachten, zugLaeuft } from './zugAnzeige';

type Bewegung = readonly (readonly [ziel: number, ms: number])[];
const BEWEGUNGEN: readonly Bewegung[] = [
  [[0, 1200], [1, 4200], [1, 900], [0, 5800], [0, 2100]],
  [[0.66, 3600], [0.25, 2600], [1, 4600], [1, 700], [0, 5700], [0, 2200]],
  [[0.42, 3400], [0.08, 2400], [0.78, 4300], [0.38, 2800], [0, 3900], [0, 2600]],
];
const glaetten = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
const folgeVariieren = (variante: number): Bewegung =>
  BEWEGUNGEN[variante].map(([ziel, ms]) => [ziel, ms * (0.9 + Math.random() * 0.3)]);

export function wortmarkeBauen(marke: HTMLElement) {
  return lottie.loadAnimation({
    container: marke,
    renderer: 'svg',
    loop: false,
    autoplay: false,
    // Lottie ergänzt die Daten beim Laden. Der Nachlader und die portable
    // Datei brauchen bei jedem Öffnen eine frische Kopie, auch ohne Netz.
    animationData: structuredClone(wortmarke),
    rendererSettings: { progressiveLoad: true, preserveAspectRatio: 'xMidYMid meet' },
  });
}

export function agencyBewegen(marke: HTMLElement): () => void {
  // Der Player verwaltet den Inhalt seines Containers, auch beim Aufräumen.
  // Die Textfassung bleibt daher ein Geschwisterelement der Animation.
  const flaeche = document.createElement('span');
  flaeche.className = 'agency-animation';
  flaeche.setAttribute('aria-hidden', 'true');
  const logo = wortmarkeBauen(flaeche);
  marke.append(flaeche);
  const wegZeiger = agencyZeigerEinrichten();

  const bewegung = window.matchMedia('(prefers-reduced-motion: reduce)');
  const wurzel = document.documentElement;
  let imBild = !('IntersectionObserver' in window);
  let beendet = false;
  let fertig = false;
  let variante = 0;
  let folge = folgeVariieren(variante);
  let abschnitt = 0;
  let vergangen = 0;
  let von = 0;
  let gezeichnet = -1;
  let bild: number | undefined;
  let pause: number | undefined;
  let pausiertSeit: number | undefined;
  let zuletzt: number | undefined;
  const still = () => bewegung.matches || wurzel.dataset.lesbar === 'an';
  const darf = () => fertig && !beendet && !still() && imBild && !document.hidden && !zugLaeuft();

  const zeichnen = (lage: number) => {
    const frame = lage * Math.max(0, logo.totalFrames - 1);
    if (frame === gezeichnet) return;
    logo.goToAndStop(frame, true);
    marke.dataset.agencyFrame = frame.toFixed(5);
    gezeichnet = frame;
  };
  const naechsterAbschnitt = () => {
    von = folge[abschnitt][0];
    vergangen = 0;
    zuletzt = undefined;
    abschnitt += 1;
    if (abschnitt < folge.length) return;
    variante = (variante + 1 + Math.floor(Math.random() * (BEWEGUNGEN.length - 1))) % BEWEGUNGEN.length;
    folge = folgeVariieren(variante);
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
    vergangen = Math.min(dauer, vergangen + Math.min(jetzt - (zuletzt ?? jetzt), 100));
    zuletzt = jetzt;
    zeichnen(von + (nach - von) * glaetten(vergangen / dauer));
    if (vergangen === dauer) naechsterAbschnitt();
    weiter();
  }
  const abgleichen = () => {
    if (!darf()) anhalten();
    if (fertig && still()) {
      variante = 0;
      folge = folgeVariieren(variante);
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
  const geladen = () => {
    if (beendet || fertig) return;
    fertig = true;
    flaeche.querySelector('svg')?.setAttribute('focusable', 'false');
    logo.setSubframe(true);
    zeichnen(0);
    marke.dataset.animiert = '';
    abgleichen();
  };
  logo.addEventListener('DOMLoaded', geladen);
  if (logo.isLoaded) geladen();

  return () => {
    beendet = true;
    anhalten();
    wegZeiger();
    wegZug();
    sichtbar?.disconnect();
    lesbarkeit.disconnect();
    document.removeEventListener('visibilitychange', abgleichen);
    bewegung.removeEventListener('change', abgleichen);
    logo.removeEventListener('DOMLoaded', geladen);
    delete marke.dataset.animiert;
    delete marke.dataset.agencyFrame;
    logo.destroy();
    flaeche.remove();
  };
}
