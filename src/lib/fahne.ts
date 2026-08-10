import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { wurzelZoom } from './anzeige';

/**
 * M250: Das Fähnchen am rechten Rand — ein Anfasser, zwei Bedeutungen.
 *
 * Es schaut immer aus der Seitenkante heraus, auch wenn die Leiste
 * eingefahren ist. Damit ist die Seitenleiste nicht mehr nur über einen
 * Knopf in der Kopfzeile erreichbar, sondern dort, wo sie erscheint.
 *
 *  · Kurzer Tipp/Klick  → aus- oder einfahren
 *  · Ziehen             → stufenlos breiter/schmaler; wer im Eingefahrenen
 *                         nach links zieht, fährt sie dabei aus, und wer sie
 *                         ganz an die Kante schiebt, fährt sie wieder ein
 *
 * Warum die Unterscheidung über eine Schwelle und nicht über getrennte
 * Flächen: Ein 15 Punkte breites Fähnchen lässt sich nicht sinnvoll in eine
 * Klick- und eine Ziehzone teilen — am Finger schon gar nicht.
 */

/** Ab dieser Bewegung ist es ein Ziehen und kein Klick mehr (Bildschirmpunkte) */
const SCHWELLE = 4;
/** Schmaler als das gezogen, ist „zu" gemeint */
const ZU_UNTER = 200;

export function useFahne(opt: {
  offen: boolean;
  breite: number;
  setzeBreite: (px: number) => void;
  setzeOffen: (offen: boolean) => void;
}) {
  const zug = useRef<{ x: number; breite: number; bewegt: boolean } | null>(null);

  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      zug.current = { x: e.clientX, breite: opt.breite, bewegt: false };
      e.preventDefault();
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const z = zug.current;
      if (!z) return;
      if (!z.bewegt) {
        if (Math.abs(e.clientX - z.x) < SCHWELLE) return;
        z.bewegt = true;
      }
      // Die linke Kante folgt dem Zeiger — Zeigerwerte sind Bildschirmpunkte,
      // die Breite im Stylesheet sind Layoutpunkte (M235)
      const roh = (window.innerWidth - e.clientX) / wurzelZoom();
      if (roh < ZU_UNTER) {
        if (opt.offen) {
          opt.setzeOffen(false);
          // Einfahren heißt zuklappen, nicht schrumpfen: die zuletzt
          // eingestellte Breite bleibt für das nächste Ausfahren stehen
          opt.setzeBreite(z.breite);
        }
        return;
      }
      if (!opt.offen) opt.setzeOffen(true);
      opt.setzeBreite(roh);
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const z = zug.current;
      zug.current = null;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      // Nicht bewegt = es war ein Klick
      if (!z?.bewegt) opt.setzeOffen(!opt.offen);
    },
    onPointerCancel: () => { zug.current = null; },
  };
}
