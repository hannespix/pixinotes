import { useEffect, type RefObject } from 'react';

/**
 * Schließt ein offenes Menü/Flyout, sobald außerhalb des Containers getippt
 * oder geklickt wird (Capture-Phase, funktioniert mit Maus & Touch).
 * Klicks IM Container (Menü-Buttons, der Auslöser selbst) bleiben unberührt.
 */
export function useOutsideClose(active: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) close();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [active, ref, close]);
}
