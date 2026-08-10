import { useCallback, useRef } from 'react';
import { wurzelZoom } from './anzeige';

/**
 * M245: Die Breite eines Slideouts am Rand ziehen.
 *
 * Der Wunsch war: „nicht freischwebende Fenster, sondern seitliche
 * Ausstülpungen — gerne beides dynamisch verschiebbar per Drag & Drop am Rand
 * oder Anfasser." Beide Leisten (Überblick rechts, Navigator links) teilen
 * sich deshalb dieselbe Mechanik; verschieden ist nur, von welcher Kante aus
 * gemessen wird.
 *
 * Gerechnet wird in LAYOUT-Punkten: Die Zeigerkoordinaten sind Schirmpunkte,
 * eine CSS-Breite ist eine Layout-Länge. Ohne Division durch den Wurzel-Zoom
 * (Anzeigegröße A− / A+, M224) würde die Leiste bei 175 % dem Finger um drei
 * Viertel davonlaufen — derselbe Fallstrick wie in M236 und M243.
 */
export function useRandZiehen(
  seite: 'links' | 'rechts',
  setzen: (px: number) => void,
  standard: number,
) {
  const zieht = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    zieht.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!zieht.current) return;
    const z = wurzelZoom();
    setzen(seite === 'rechts'
      ? (window.innerWidth - e.clientX) / z
      : e.clientX / z);
  }, [seite, setzen]);

  const beenden = useCallback(() => { zieht.current = false; }, []);

  /** Doppelklick auf den Anfasser stellt die Ausgangsbreite wieder her */
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setzen(standard);
  }, [setzen, standard]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: beenden,
    onPointerCancel: beenden,
    onDoubleClick,
    title: 'Breite ziehen — Doppelklick stellt die Ausgangsbreite her',
    'aria-label': 'Breite ändern',
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
  };
}
