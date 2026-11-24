import { useEffect, type RefObject } from 'react';

/**
 * M523: Esc schließt ein Menü oder einen Dialog — und nur das.
 *
 * „＋ Neu", die ⋯-Menüs an Bereich, Projekt und Board, der Recherche- und der Teilen-Dialog hörten nicht auf Esc
 * (die Hilfe verspricht es für jedes Menü und Fenster); wer sie mit der Tastatur geöffnet hatte, kam nur über einen
 * Eintrag oder einen Klick daneben wieder heraus. Capture-Phase mit stopPropagation: Der Druck gehört dem, was
 * zuoberst offen ist — das Fenster oder die Ausstülpung dahinter bleibt stehen. `knopf` bekommt danach den Fokus
 * zurück (der Auslöser), `wenn` kann das Schließen aussetzen (laufender Vorgang).
 */
export function useEscSchliesst(aktiv: boolean, zu: () => void, knopf?: RefObject<HTMLElement | null>, wenn?: () => boolean): void {
  useEffect(() => {
    if (!aktiv) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (wenn && !wenn()) return;
      e.stopPropagation();
      zu();
      knopf?.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
}
