// M535: Animierte SVG-Bilder zeigen beim Ziehen und außerhalb des Bildes ein Standbild.
//
// Ein SVG mit CSS-Animationen (oder SMIL) rechnet, solange es zu sehen ist, in JEDEM Bild Stil und Zeichnung neu — ein
// eigenes Dokument je Bild (M525: acht solche Bilder hielten das Board auch im Leerlauf beschäftigt). Ein `<img>` lässt
// sich von außen nicht anhalten. Darum gibt es zu jedem animierten SVG ein Standbild: derselbe Quelltext, aber alle
// CSS-Animationen angehalten (`animation-play-state: paused` — sie stehen auf ihrem ersten Bild) und SMIL-Animationen
// ungestartet (`begin="indefinite"`). Gleiche Maße, gleiche Zeichnung, nur ohne Bewegung. Im Ruhezustand im Bild
// läuft das Original wie bisher; die Entscheidung des Besitzers (25.11.2026): Standbild beim Ziehen und außerhalb des
// sichtbaren Bereichs, sonst animiert.
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { zugBeobachten, zugLaeuft } from './zugAnzeige';

const SVG_KOPF = /^data:image\/svg\+xml/i;
/** Woran ein animiertes SVG zu erkennen ist: Keyframes, CSS-animation oder SMIL-Elemente */
const ANIMIERT = /@keyframes|animation(?:-name)?\s*:|<(?:animate|animateTransform|animateMotion|animateColor|set)\b/i;
const SMIL = ['animate', 'animateTransform', 'animateMotion', 'animateColor', 'set'];
const ANHALTEN = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}';

/** Quelltext einer SVG-Daten-Adresse (Base64 oder Prozent-kodiert); null, wenn es keine ist */
export function svgText(src: string): string | null {
  if (!SVG_KOPF.test(src)) return null;
  const komma = src.indexOf(',');
  if (komma < 0) return null;
  const kopf = src.slice(0, komma); const rumpf = src.slice(komma + 1);
  try {
    if (/;base64/i.test(kopf)) {
      const roh = atob(rumpf);
      const bytes = new Uint8Array(roh.length);
      for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(rumpf);
  } catch { return null; }
}

// Gemerkt je Adresse (die Bild-Adressen sind lang, aber dieselben Zeichenketten wie im Stand — kein zweiter Speicher)
const merk = new Map<string, string | null>();
const MERK_MAX = 64;

/** Das Standbild eines animierten SVG als Daten-Adresse — null, wenn das Bild nicht animiert ist (oder kein SVG) */
export function standbildVon(src: string): string | null {
  if (merk.has(src)) return merk.get(src) ?? null;
  let aus: string | null = null;
  const text = svgText(src);
  if (text && ANIMIERT.test(text) && typeof DOMParser === 'function') {
    try {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const wurzel = doc.documentElement;
      if (wurzel && wurzel.localName === 'svg' && !doc.getElementsByTagName('parsererror').length) {
        const stil = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
        stil.textContent = ANHALTEN;
        wurzel.insertBefore(stil, wurzel.firstChild);
        for (const name of SMIL) for (const el of Array.from(doc.getElementsByTagNameNS('*', name))) el.setAttribute('begin', 'indefinite');
        aus = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(doc))}`;
      }
    } catch { aus = null; }
  }
  if (merk.size >= MERK_MAX) merk.delete(merk.keys().next().value as string);
  merk.set(src, aus);
  return aus;
}

/** Sichtbar heißt: im Fenster oder knapp davor (so steht beim Hereinschwenken schon das laufende Bild) */
const RAND = '120px';

/**
 * Welche Adresse soll das `<img>` zeigen? Das Original — außer das Bild ist ein animiertes SVG und es wird gerade
 * gezogen (irgendeine Karte) oder es liegt außerhalb des Bildes; dann das Standbild. Nicht animierte Bilder bekommen
 * weder Beobachter noch Abo.
 */
export function useBildAnzeige(ref: RefObject<HTMLElement | null>, src: string): string {
  const standbild = useMemo(() => (typeof src === 'string' ? standbildVon(src) : null), [src]);
  const [zug, setZug] = useState(zugLaeuft);
  const [sichtbar, setSichtbar] = useState(true);
  useEffect(() => {
    if (!standbild) return;
    // Das Standbild einmal vorab entschlüsseln — der Wechsel am Zug-Beginn kostet dann kein Entschlüsseln
    const vorab = new Image(); vorab.src = standbild; void vorab.decode?.().catch(() => {});
    const weg = zugBeobachten(() => setZug(zugLaeuft()));
    const el = ref.current;
    const io = el && typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((e) => setSichtbar(e.some((x) => x.isIntersecting)), { rootMargin: RAND })
      : null;
    if (el && io) io.observe(el);
    return () => { weg(); io?.disconnect(); };
  }, [standbild, ref]);
  return standbild && (zug || !sichtbar) ? standbild : src;
}
