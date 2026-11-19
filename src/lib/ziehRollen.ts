// M403: Den Ausschnitt einer Folie mit der Maus verschieben – wie auf dem Board.
//
//   · Leertaste halten und ziehen (überall auf der Folie, auch während ein Stift gewählt ist)
//   · mit der mittleren Maustaste ziehen
//   · auf freier Fläche einfach ziehen (Bild, Text, Dokument, der Rand der Folie) – wo man sonst markiert,
//     schreibt oder Tickets schiebt, bleibt das Ziehen dem Inhalt
//   · Umschalt + Pfeiltasten schieben in Schritten
//
// Greift nur, wenn es etwas zu verschieben gibt (der Inhalt ragt über die Folie hinaus). Finger rollen ohnehin:
// Die Folie ist ein gewöhnlicher Rollbereich. Ein kurzer Druck auf die Leertaste blättert weiter wie bisher.
import { useEffect, useRef } from 'react';
import { wurzelZoom } from './anzeige';

const BEDIENBAR = 'a, button, input, textarea, select, summary, label, video, audio, [contenteditable="true"], [draggable="true"]';

export interface ZiehRollen {
  aktiv: boolean;
  /** Der Rollbereich der Folie, die gerade offen ist */
  finde: () => HTMLElement | null;
  /** Darf hier ein einfacher Zug mit der linken Maustaste verschieben? (sonst nur Leertaste oder mittlere Taste) */
  frei: (ziel: Element, el: HTMLElement) => boolean;
  /** Die Leertaste wurde nur kurz gedrückt, ohne zu ziehen */
  tippen: () => void;
}

const rollbar = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
/** Gehört dieser Punkt der Bühne zur Folie? (Zeichenschicht und Laser liegen als eigene Schichten darüber) */
const aufFolie = (ziel: EventTarget | null, el: HTMLElement) =>
  ziel instanceof Element && (el.contains(ziel) || (!!ziel.closest('.folien-stift') && !ziel.closest('button, input, textarea, .folien-palette')));
const tippt = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName));

export function useZiehRollen(wahl: ZiehRollen): void {
  const w = useRef(wahl); w.current = wahl;
  const { aktiv } = wahl;
  useEffect(() => {
    if (!aktiv) return;
    let hand = false;                 // Leertaste gehalten
    let handSeit = 0;
    let handGezogen = false;
    let ueber: Element | null = null; // worüber der Mauszeiger gerade steht
    let zug: { el: HTMLElement; id: number; x: number; y: number; sl: number; st: number; laeuft: boolean } | null = null;
    let bereit: HTMLElement | null = null;

    const zeiger = () => {
      const el = w.current.finde();
      const an = !!el && !zug?.laeuft && rollbar(el) && !!ueber && aufFolie(ueber, el) && (hand || (el.contains(ueber) && !ueber.closest(BEDIENBAR) && w.current.frei(ueber, el)));
      if (bereit && (!an || bereit !== el)) { bereit.classList.remove('zieh-bereit'); bereit = null; }
      if (an && el && bereit !== el) { el.classList.add('zieh-bereit'); bereit = el; }
      document.documentElement.classList.toggle('folie-hand', hand && !!el && rollbar(el));
    };
    const ende = () => {
      if (!zug) return;
      const z = zug; zug = null;
      z.el.classList.remove('zieht');
      document.documentElement.classList.remove('folie-zieht');
      if (z.laeuft) {
        window.getSelection()?.removeAllRanges();
        // der Klick, der dem Loslassen folgt, gehört zum Ziehen – nicht zum Inhalt
        const schluck = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); };
        window.addEventListener('click', schluck, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', schluck, { capture: true }), 60);
      }
      zeiger();
    };

    const runter = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || zug) return;
      const el = w.current.finde();
      if (!el || !aufFolie(e.target, el) || !rollbar(el)) return;
      const ziel = e.target as Element;
      const sofort = e.button === 1 || (e.button === 0 && hand);
      const spaeter = e.button === 0 && !hand && el.contains(ziel) && !ziel.closest(BEDIENBAR) && w.current.frei(ziel, el);
      if (!sofort && !spaeter) return;
      zug = { el, id: e.pointerId, x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, laeuft: sofort };
      if (sofort) {
        // nichts darunter soll den Griff bekommen: kein Markieren, kein Ticket-Zug, kein Strich, kein Auto-Rollen
        e.preventDefault(); e.stopPropagation();
        if (hand) handGezogen = true;
        el.classList.add('zieht');
        document.documentElement.classList.add('folie-zieht');
      }
    };
    const bewegt = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && !zug) { ueber = e.target instanceof Element ? e.target : null; zeiger(); }
      if (!zug || e.pointerId !== zug.id) return;
      const dx = e.clientX - zug.x; const dy = e.clientY - zug.y;
      if (!zug.laeuft) {
        if (Math.hypot(dx, dy) < 5) return;
        zug.laeuft = true;
        window.getSelection()?.removeAllRanges();
        zug.el.classList.add('zieht');
        document.documentElement.classList.add('folie-zieht');
      }
      e.preventDefault();
      const wz = wurzelZoom() || 1;
      zug.el.scrollLeft = zug.sl - dx / wz;
      zug.el.scrollTop = zug.st - dy / wz;
    };
    const hoch = (e: PointerEvent) => { if (zug && e.pointerId === zug.id) ende(); };
    // mittlere Taste: kein Auto-Rollen des Browsers, kein Einfügen (Linux)
    // … und auf freier Fläche kein Markieren, kein Bild, das sich aus der Folie ziehen lässt
    const mausRunter = (e: MouseEvent) => { if (zug) e.preventDefault(); };
    const bildZug = (e: DragEvent) => { if (zug) e.preventDefault(); };
    const mitte = (e: MouseEvent) => { const el = w.current.finde(); if (e.button === 1 && el && aufFolie(e.target, el) && rollbar(el)) e.preventDefault(); };

    const taste = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || tippt(e.target)) return;
      const el = w.current.finde();
      if (!el || !rollbar(el)) return;
      if (e.key === ' ' && !e.shiftKey) {
        // Die Leertaste wird zur Hand; geblättert wird erst beim Loslassen – und nur, wenn nicht gezogen wurde
        e.preventDefault(); e.stopPropagation();
        if (!hand) { hand = true; handSeit = performance.now(); handGezogen = false; zeiger(); }
        return;
      }
      if (e.shiftKey && e.key.startsWith('Arrow')) {
        e.preventDefault(); e.stopPropagation();
        const weg = e.repeat ? 60 : 120;
        el.scrollBy({ left: e.key === 'ArrowLeft' ? -weg : e.key === 'ArrowRight' ? weg : 0, top: e.key === 'ArrowUp' ? -weg : e.key === 'ArrowDown' ? weg : 0, behavior: e.repeat ? 'auto' : 'smooth' });
      }
    };
    const tasteHoch = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !hand) return;
      hand = false;
      e.preventDefault(); e.stopPropagation();
      const kurz = !handGezogen && !zug && performance.now() - handSeit < 400;
      zeiger();
      if (kurz) w.current.tippen();
    };
    const weg = () => { hand = false; ende(); zeiger(); };

    window.addEventListener('pointerdown', runter, true);
    window.addEventListener('pointermove', bewegt, true);
    window.addEventListener('pointerup', hoch, true);
    window.addEventListener('pointercancel', hoch, true);
    window.addEventListener('mousedown', mausRunter, true);
    window.addEventListener('dragstart', bildZug, true);
    window.addEventListener('auxclick', mitte, true);
    window.addEventListener('keydown', taste, true);
    window.addEventListener('keyup', tasteHoch, true);
    window.addEventListener('blur', weg);
    return () => {
      window.removeEventListener('pointerdown', runter, true);
      window.removeEventListener('pointermove', bewegt, true);
      window.removeEventListener('pointerup', hoch, true);
      window.removeEventListener('pointercancel', hoch, true);
      window.removeEventListener('mousedown', mausRunter, true);
      window.removeEventListener('dragstart', bildZug, true);
      window.removeEventListener('auxclick', mitte, true);
      window.removeEventListener('keydown', taste, true);
      window.removeEventListener('keyup', tasteHoch, true);
      window.removeEventListener('blur', weg);
      hand = false; ende();
      bereit?.classList.remove('zieh-bereit');
      document.documentElement.classList.remove('folie-hand', 'folie-zieht');
    };
  }, [aktiv]);
}
