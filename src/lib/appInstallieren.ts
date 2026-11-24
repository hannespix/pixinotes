/**
 * M516: „Als App installieren" — der winzige Teil, der beim Start mitläuft.
 *
 * Chrome und Edge melden mit `beforeinstallprompt`, dass sie PixiNotes jetzt installieren würden. Das Ereignis kommt
 * nur einmal je Seitenaufruf und nur, solange die App auf diesem Browser-Profil NICHT installiert ist. Wer es
 * verpasst, kann den Installations-Dialog später nicht mehr selbst öffnen — deshalb hören wir ab dem Start zu und
 * heben es auf. Der Eintrag „Als App installieren" (⋯ der Leiste, Strg+K) ruft dann `prompt()`; gibt es kein
 * Ereignis, öffnet er das Fenster mit der Diagnose (components/AppInstallierenFenster.tsx, nachgeladen).
 *
 * Bewusst KEIN `preventDefault()`: Das unterdrückte am Telefon die Installations-Leiste, die dort heute von selbst
 * erscheint (Nutzer: „Auf meinem Mobile kann ich die PWA installieren"). `prompt()` geht trotzdem.
 */

import { useBoard } from '../store';

/** Das Ereignis von Chrome/Edge (kein Standard-Typ in lib.dom) */
interface InstallEreignis extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

/** Ereignis: Fenster „Als App installieren" (Diagnose) öffnen */
export const APP_INSTALLIEREN_EREIGNIS = 'pixinotes:app-installieren';

let ereignis: InstallEreignis | null = null;
let gestartet = false;
/** In dieser Sitzung installiert (`appinstalled`) */
let installiertJetzt = false;
/** Hat der Browser in dieser Sitzung je angeboten? (für die Diagnose: „angeboten, aber abgelehnt") */
let angeboten = false;
let abgelehnt = false;

/** Ab dem Start zuhören (main.tsx, vor dem ersten Rendern — das Ereignis kann früh kommen) */
export function appInstallierenStarten(): void {
  if (gestartet || typeof window === 'undefined') return;
  gestartet = true;
  window.addEventListener('beforeinstallprompt', (e) => { ereignis = e as InstallEreignis; angeboten = true; });
  window.addEventListener('appinstalled', () => {
    ereignis = null;
    installiertJetzt = true;
    useBoard.getState().showToast('PixiNotes ist installiert – du findest die App im Startmenü, auf dem Home-Bildschirm oder im Dock.', false, 6000);
  });
}

/** Stand für die Diagnose */
export function installStand(): { bereit: boolean; angeboten: boolean; abgelehnt: boolean; installiertJetzt: boolean } {
  return { bereit: ereignis !== null, angeboten, abgelehnt, installiertJetzt };
}

/** Eintrag „Als App installieren": den Dialog des Browsers zeigen — oder, wenn er nicht kann, die Diagnose */
export async function appInstallieren(): Promise<void> {
  const e = ereignis;
  if (e) {
    // prompt() geht nur einmal je Ereignis; danach bietet der Browser ggf. ein neues an
    ereignis = null;
    try {
      await e.prompt();
      const wahl = await e.userChoice;
      if (wahl.outcome === 'dismissed') abgelehnt = true;
      return;
    } catch { /* z. B. schon verbraucht — dann erklärt die Diagnose */ }
  }
  window.dispatchEvent(new CustomEvent(APP_INSTALLIEREN_EREIGNIS));
}
