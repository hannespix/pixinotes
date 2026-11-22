// M426: „Nur Inhalt" — Vollbild ohne jede Bedienung, für Präsentation und Karten-Fokus.
//
// Gewünscht: „Im Präsentations- und im Fokus-Modus bitte auch ein Vollbild anbieten, welches alle UI-Elemente
// ausblendet, für die perfekte Präsentation. Vielleicht wäre da auch ein einfacher passender Tastatur-Shortcut
// praktisch. Also 100 % Content ohne Rahmen, Menüs etc.!"
//
// Ein Zustand, zwei Orte. Am Wurzelelement steht `data-rein` (vortrag | fokus); das Stylesheet blendet damit Kopf-
// und Fußleisten, Rahmen, Auswahl, Griffe und die Bedienung der Module aus. Der Browser geht ins Vollbild, falls er
// es nicht schon ist. Taste F schaltet um (am Board heißt F „einpassen" — dieselbe Idee, nur ganz); Esc kehrt zurück.
// Der Zeiger verschwindet, solange er ruht. Für Finger (und alle, die die Taste nicht kennen) gibt es eine
// unsichtbare Kante oben: Antippen oder Überfahren zeigt kurz einen einzigen Knopf „Bedienung einblenden".
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRandLeiste } from './randLeiste';
import { FOKUS_ANSICHT_EREIGNIS } from './fokusAnsicht';

export type ReinOrt = 'vortrag' | 'fokus';

/** Steht gerade „Nur Inhalt"? (für Tasten-Behandlungen anderswo: Esc gehört dann zuerst dem Rückweg) */
export const istRein = (): boolean => !!document.documentElement.dataset.rein;

const RUHE_MS = 1800;

function tippt(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

/**
 * Zustand samt Tasten (F, Esc), Browser-Vollbild und ruhendem Zeiger. `aktiv`: Präsentation bzw. Fokus ist offen —
 * schließt er sich, endet auch „Nur Inhalt".
 */
export function useReinAnsicht(ort: ReinOrt, aktiv: boolean) {
  const [rein, setRein] = useState(false);
  /** Vollbild, das „Nur Inhalt" selbst angefordert hat — nur das wird beim Verlassen wieder beendet */
  const selbstVoll = useRef(false);
  /** Lief der Browser während „Nur Inhalt" im Vollbild? Dann beendet sein Ende (Esc des Browsers) auch „Nur Inhalt" */
  const warVoll = useRef(false);

  const aus = useCallback(() => setRein(false), []);
  const umschalten = useCallback(() => setRein((v) => !v), []);

  useEffect(() => { if (!aktiv) setRein(false); }, [aktiv]);

  // Markierung am Wurzelelement, Vollbild, Zeiger
  useEffect(() => {
    if (!rein) return;
    const r = document.documentElement;
    r.dataset.rein = ort;
    // Fokus aus Eingabefeldern nehmen: Sonst bliebe die Bedienung der Karte sichtbar (:focus-within) und F tippte
    (document.activeElement as HTMLElement | null)?.blur?.();
    warVoll.current = !!document.fullscreenElement;
    if (!document.fullscreenElement && r.requestFullscreen) {
      r.requestFullscreen().then(() => { selbstVoll.current = true; }).catch(() => { /* ohne Vollbild: trotzdem nur Inhalt */ });
    }
    const wechsel = () => {
      if (document.fullscreenElement) { warVoll.current = true; return; }
      if (warVoll.current) setRein(false);
    };
    document.addEventListener('fullscreenchange', wechsel);
    // Zeiger ausblenden, solange er ruht
    let uhr = window.setTimeout(() => { r.dataset.reinRuhe = ''; }, RUHE_MS);
    const regt = () => {
      delete r.dataset.reinRuhe;
      window.clearTimeout(uhr);
      uhr = window.setTimeout(() => { r.dataset.reinRuhe = ''; }, RUHE_MS);
    };
    window.addEventListener('pointermove', regt, true);
    window.addEventListener('pointerdown', regt, true);
    // Die Fläche hat sich geändert (keine Leisten mehr): Präsentation und Fokus passen sich neu ein
    const neuEinpassen = () => { window.dispatchEvent(new Event('resize')); if (ort === 'fokus') window.dispatchEvent(new CustomEvent(FOKUS_ANSICHT_EREIGNIS)); };
    neuEinpassen();
    return () => {
      delete r.dataset.rein;
      delete r.dataset.reinRuhe;
      window.clearTimeout(uhr);
      document.removeEventListener('fullscreenchange', wechsel);
      window.removeEventListener('pointermove', regt, true);
      window.removeEventListener('pointerdown', regt, true);
      if (selbstVoll.current && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      selbstVoll.current = false;
      neuEinpassen();
    };
  }, [rein, ort]);

  // F schaltet um, Esc kehrt zurück — vor allen anderen Tasten-Behandlungen (Capture), außer beim Schreiben
  useEffect(() => {
    if (!aktiv) return;
    const taste = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (tippt(e.target)) return;
      // stopImmediatePropagation: Der Zustand wechselt sofort — ein späterer Esc-Halter (Fokus schließen) sähe
      // „Nur Inhalt" schon beendet und schlösse gleich mit
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.repeat) setRein((v) => !v);
      } else if (e.key === 'Escape' && istRein()) {
        e.preventDefault(); e.stopImmediatePropagation();
        setRein(false);
      }
    };
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
  }, [aktiv]);

  return { rein, umschalten, aus };
}

/**
 * Der einzige Rückweg, den man sieht — und nur, wenn man ihn sucht: eine unsichtbare Kante am oberen Rand. Beim
 * Einschalten steht der Knopf kurz da (so lernt man, wo er wohnt), dann verschwindet er.
 */
export function ReinRand({ an, onAus }: { an: boolean; onAus: () => void }) {
  const rand = useRandLeiste(an, 2400);
  if (!an) return null;
  return (
    <div className={`rein-rand ${rand.da ? 'da' : ''}`} data-taste="rein-rand" {...rand.griff}>
      <button className="rein-zurueck" data-taste="rein-aus" onClick={onAus} title="Bedienung wieder einblenden (F oder Esc)" aria-label="Bedienung einblenden">
        Bedienung einblenden <kbd>F</kbd>
      </button>
    </div>
  );
}
