/**
 * Hinweise (Toast): eigener Knopf, „Rückgängig" im Hinweis, Anzeigen und Ausblenden.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import type { BoardState, Setzen, Holen } from './typen';
import { useBoard } from '../store';

/** M476: Aktion zum Knopf im Hinweis (Sicherung: „Rückgängig", „Jetzt sichern") — eine Funktion hat im Store-Zustand nichts verloren */
let hinweisKnopfAktion: (() => void) | null = null;
/** M476: Hinweis mit eigenem Knopf zeigen; der Knopf führt `aktion` genau einmal aus */
export function hinweisMitKnopf(message: string, knopf: string, aktion: () => void, durationMs = 12000): void {
  useBoard.getState().showToast(message, false, durationMs);
  hinweisKnopfAktion = aktion;
  useBoard.setState((s) => (s.toast ? { toast: { ...s.toast, knopf } } : {}));
}
/** M476: Den Knopf im Hinweis drücken */
export function hinweisKnopfDruecken(): void {
  const f = hinweisKnopfAktion;
  hinweisKnopfAktion = null;
  useBoard.setState({ toast: null });
  f?.();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** M390: der Rückgängig-Schritt, zu dem der Knopf im aktuellen Hinweis gehört (siehe hinweisRueckgaengig) */
let hinweisEintrag: unknown = null;

/** M480: Teil des Board-Speichers – Hinweise (Toast) */
export function hinweiseScheibe(set: Setzen, get: Holen) {
  return {
    hinweisRueckgaengig: () => {
      /**
       * M390: Der Knopf „Rückgängig" im Hinweis nimmt GENAU den Schritt zurück, zu dem der Hinweis gehört.
       * Ist seither nichts dazwischengekommen, ist das ein gewöhnliches Strg+Z — danach gibt es keinen
       * übriggebliebenen Schritt, der die wiederhergestellte Karte beim nächsten Strg+Z erneut löscht, und der
       * Verlauf stimmt auch, wenn man inzwischen auf einem anderen Board steht. Kam etwas dazwischen, wird nur
       * Gelöschtes zurückgelegt; für alles andere sagt der Hinweis, wie es weitergeht.
       */
      const s0 = get();
      const art = s0.toast?.undo;
      if (art === 'ebene') { s0.ebeneZurueck(); return; }
      if (hinweisEintrag && s0.past[s0.past.length - 1] === hinweisEintrag) { hinweisEintrag = null; s0.undo(); return; }
      if (art === 'schritt') { s0.showToast('Inzwischen ist anderes dazugekommen – Strg+Z nimmt Schritt für Schritt zurück.', false, 6000); return; }
      s0.restoreDeleted();
    },
    showToast: (message, undo, durationMs, abbruch) => {
      if (toastTimer) clearTimeout(toastTimer);
      hinweisKnopfAktion = null;
      hinweisEintrag = undo && undo !== 'ebene' && !abbruch ? (get().past[get().past.length - 1] ?? null) : null;
      set({ toast: { message, undo, abbruch } });
      toastTimer = setTimeout(() => set({ toast: null }), durationMs ?? (undo ? 6000 : 3000));
    },
  } satisfies Partial<BoardState>;
}
