// M471: „Diesen Termin zeigen" — von der Aufgaben-Zentrale zur Kalender-Karte.
//
// Die Markierung ist flüchtig: Sie steht nur im Speicher dieser Seite, nicht im Board (kein Sync, kein
// Rückgängig-Schritt, kein Export). Die Kalender-Karte, deren Kennung passt, öffnet den Termin und hebt ihn
// hervor; sie wird beim Sprung oft erst gerade gezeichnet und liest die Marke deshalb auch beim Einhängen.
import type { ZentralTermin } from './termineZentrale';

export interface TerminMarke {
  /** Kennung der Kalender-Karte */
  kartenId: string;
  termin: ZentralTermin;
}

export const TERMIN_MARKE_EREIGNIS = 'pixinotes-termin-marke';
let marke: TerminMarke | null = null;

export function terminMarke(): TerminMarke | null {
  return marke;
}

export function setTerminMarke(m: TerminMarke | null): void {
  marke = m;
  window.dispatchEvent(new CustomEvent(TERMIN_MARKE_EREIGNIS));
}
