// M264: Zoomen in Vorschauen — PDF-Seiten und Bilder.
//
// Eine Vorschau, die man nicht vergrößern kann, ist bei einem gescannten
// Schreiben oder einem Screenshot mit Fehlermeldung wertlos: Genau die
// Kleingedruckten sind der Grund, warum man hineinschaut. Diese Lupe liefert
// die Bedienung dafür einmal für alle Vorschauen — Tasten, Rad, Doppelklick
// und Zwei-Finger-Kneifen.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface LupenGriffe {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
}

const klemme = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Zoom- und Schiebe-Verhalten für eine scrollbare Vorschaufläche.
 *
 * Die Fläche selbst scrollt (`overflow: auto`) — deshalb braucht es kein
 * eigenes Transform-Gerüst: Der Inhalt wird schlicht `zoom`-mal so groß
 * gezeichnet, und der Browser übernimmt Bildlauf, Trägheit und Finger-Panning.
 *
 * @param maxZoom Obergrenze; 1 heißt „eingepasst"
 */
export function useLupe(maxZoom = 6) {
  const [zoom, setZoom] = useState(1);
  const flaecheRef = useRef<HTMLDivElement | null>(null);
  /**
   * Der ANGESTREBTE Zoom — nicht der gerenderte.
   *
   * Beim Kneifen kommen mehrere Bewegungen in EINEN Frame; React bündelt die
   * Zustandsänderungen, `zoom` bliebe für alle davon der alte Wert und jede
   * Bewegung rechnete wieder vom Anfang los. Das Ergebnis wäre der letzte
   * kleine Schritt statt der ganzen Geste (gemessen: 106 % statt 325 %).
   */
  const zielRef = useRef(1);

  /* Was beim Zoomen unter dem Zeiger lag, soll dort bleiben. Gemerkt wird die
     INHALTS-Koordinate; nach dem Neuzeichnen wird der Bildlauf so gesetzt,
     dass sie wieder unter demselben Bildschirmpunkt sitzt. */
  const anker = useRef<{ ix: number; iy: number; px: number; py: number } | null>(null);
  useLayoutEffect(() => {
    const el = flaecheRef.current;
    const a = anker.current;
    anker.current = null;
    if (!el || !a) return;
    el.scrollLeft = a.ix * zoom - a.px;
    el.scrollTop = a.iy * zoom - a.py;
  }, [zoom]);

  const zoomAnPunkt = useCallback((faktor: number, klientX?: number, klientY?: number) => {
    const el = flaecheRef.current;
    const alt = zielRef.current;
    const neu = klemme(alt * faktor, 1, maxZoom);
    if (Math.abs(neu - alt) < 0.001) return;
    zielRef.current = neu;
    if (el) {
      const r = el.getBoundingClientRect();
      const px = (klientX ?? r.left + r.width / 2) - r.left;
      const py = (klientY ?? r.top + r.height / 2) - r.top;
      anker.current = { ix: (el.scrollLeft + px) / alt, iy: (el.scrollTop + py) / alt, px, py };
    }
    setZoom(neu);
  }, [maxZoom]);

  const rein = useCallback(() => zoomAnPunkt(1.25), [zoomAnPunkt]);
  const raus = useCallback(() => zoomAnPunkt(1 / 1.25), [zoomAnPunkt]);
  const einpassen = useCallback(() => { anker.current = null; zielRef.current = 1; setZoom(1); }, []);

  // Tastatur: +/− wie in jedem Betrachter, 0 passt wieder ein
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); rein(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); raus(); }
      else if (e.key === '0') { e.preventDefault(); einpassen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rein, raus, einpassen]);

  /**
   * Rad: Strg/⌘ + Rad zoomt, das Rad allein blättert weiter durch die Seite.
   * Trackpad-Kneifen schickt der Browser als ctrlKey-Rad — damit ist die
   * Zwei-Finger-Geste am Notebook mit abgedeckt, ohne Sonderweg.
   *
   * BEWUSST als eigener Listener statt als React-`onWheel`: React hängt
   * Rad-Ereignisse passiv an die Wurzel, dort läuft `preventDefault()` ins
   * Leere — der Browser würde also zusätzlich die ganze Seite zoomen.
   */
  useEffect(() => {
    const el = flaecheRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAnPunkt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAnPunkt]);

  // Zwei-Finger-Kneifen am Touchscreen
  const zeiger = useRef(new Map<number, { x: number; y: number }>());
  const spanne = useRef(0);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    zeiger.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (zeiger.current.size === 2) {
      const [a, b] = [...zeiger.current.values()];
      spanne.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || !zeiger.current.has(e.pointerId)) return;
    zeiger.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (zeiger.current.size !== 2) return;
    const [a, b] = [...zeiger.current.values()];
    const jetzt = Math.hypot(a.x - b.x, a.y - b.y);
    if (spanne.current > 0 && jetzt > 0) {
      const faktor = jetzt / spanne.current;
      // Kleine Zittern nicht als Zoom deuten — sonst wackelt das Bild beim Halten
      if (Math.abs(faktor - 1) > 0.01) {
        zoomAnPunkt(faktor, (a.x + b.x) / 2, (a.y + b.y) / 2);
        spanne.current = jetzt;
      }
    }
  }, [zoomAnPunkt]);
  const beenden = useCallback((e: React.PointerEvent) => {
    zeiger.current.delete(e.pointerId);
    if (zeiger.current.size < 2) spanne.current = 0;
  }, []);

  /** Doppelklick/-tipp: heran oder wieder einpassen — der schnelle Weg */
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (zielRef.current > 1.01) einpassen();
    else zoomAnPunkt(2.5, e.clientX, e.clientY);
  }, [einpassen, zoomAnPunkt]);

  const griffe: LupenGriffe = {
    onPointerDown, onPointerMove, onPointerUp: beenden, onPointerCancel: beenden, onDoubleClick,
  };

  return { zoom, rein, raus, einpassen, flaecheRef, griffe, maxZoom };
}
