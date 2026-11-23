// M459: Rufnummern-Erkennung (libphonenumber-js samt Länderdaten, ~140 KB) bei Bedarf.
//
// Vorher kam sie im Start mit, weil Notizen und E-Mails ihre Nummern beim Zeichnen synchron suchen. Jetzt lädt sie
// erst, wenn ein Text überhaupt eine Nummer enthalten KANN (`kannRufnummerSein`: mindestens sechs Ziffern — weniger
// verwirft lib/entities.tsx ohnehin). Bis dahin steht der Text ohne Telefon-Verknüpfung da; `useRufnummernStand()`
// zeichnet ihn danach still neu.
import { useSyncExternalStore } from 'react';

type Lp = typeof import('./rufnummerKern');
let lp: Lp | null = null;
let ladung: Promise<void> | null = null;
let stand = 0;
const hoerer = new Set<() => void>();

/** Die geladene Bibliothek — oder null, solange sie fehlt */
export const rufnummern = (): Lp | null => lp;
export function rufnummernLaden(): Promise<void> {
  if (!ladung) {
    ladung = import('./rufnummerKern').then((m) => {
      lp = m;
      stand += 1;
      for (const h of [...hoerer]) h();
    });
    ladung.catch(() => { ladung = null; });   // offline und nicht im Cache: beim nächsten Text erneut versuchen
  }
  return ladung;
}
/** Zahl, die sich ändert, sobald die Erkennung geladen ist — in die Abhängigkeiten der Anzeigen */
export function useRufnummernStand(): number {
  return useSyncExternalStore((h) => { hoerer.add(h); return () => { hoerer.delete(h); }; }, () => stand);
}
/** Mindestens sechs Ziffern — eine kürzere Folge gilt nie als Rufnummer (lib/entities.tsx `keineRufnummer`) */
export const kannRufnummerSein = (text: string): boolean => (text.match(/\d/g)?.length ?? 0) >= 6;
/**
 * Bibliothek für diesen Text: geladen → her damit; fehlt sie und könnte der Text eine Nummer tragen → Laden
 * anstoßen und vorerst null (der Text steht ohne Verknüpfung, bis sie da ist).
 */
export function rufnummernFuer(text: string): Lp | null {
  if (lp || !kannRufnummerSein(text)) return lp;
  void rufnummernLaden().catch(() => {});
  return null;
}
