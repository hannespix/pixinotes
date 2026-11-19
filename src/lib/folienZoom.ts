// M402: In der Präsentation in den Inhalt einer Folie hinein- und herauszoomen.
//
// Dokument-Folien (PDF, Word, Bild-Datei) zoomen schon selbst (DokumentFolie). Alle anderen – Notiz, Kanban,
// Zeitplan, Diagramm … – bekommen hier dasselbe: Strg/⌘ + Mausrad (auch das Kneifen am Trackpad), zwei Finger
// kneifen, die Tasten + / − / 0. Gezoomt wird der Inhalt der Folie als Ganzes (CSS-Transform am ersten Kind),
// die Folie selbst rollt dann wie gewohnt; die Zeichenschicht misst sich am Inhalt aus und zoomt von selbst mit.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { FOLIE_ZOOM, type FolieZoom } from './folienWerkzeug';
import { wurzelZoom } from './anzeige';

export const FOLIEN_ZOOM_MIN = 0.4;
export const FOLIEN_ZOOM_MAX = 5;

/** Stufe begrenzen; nahe 100 % rastet sie ein (sonst bleibt man bei 98 % hängen) */
export function zoomStufe(z: number, raste = true): number {
  const g = Math.max(FOLIEN_ZOOM_MIN, Math.min(FOLIEN_ZOOM_MAX, z));
  return raste && Math.abs(g - 1) < 0.04 ? 1 : Math.round(g * 1000) / 1000;
}

/**
 * Versatz des gezoomten Inhalts. Solange er in die Folie passt, wächst und schrumpft er um seine eigene Mitte.
 * Wird er größer als die Folie, legt er sich an ihren Rand – was übersteht, erreicht man durch Rollen, und
 * dabei bleibt die Stelle unter dem Zeiger stehen (useFolienZoom rollt entsprechend nach). Zurück bei 100 %
 * gleitet er an seinen Platz (kurzer Übergang im Stylesheet), statt zu springen.
 * (`start`: Abstand der ungezoomten Kante vom Rand der Folie, `rand`: Innenabstand der Folie.)
 */
export function zoomVersatz(z: number, start: number, mass: number, platz: number, rand: number): number {
  if (z === 1) return 0;
  if (mass * z + 2 * rand > platz) return rand - start;
  const um = start + (mass - mass * z) / 2;            // um die eigene Mitte
  return Math.max(rand, Math.min(um, platz - rand - mass * z)) - start;
}

export function useFolienZoom(ref: RefObject<HTMLElement | null>, aktiv: boolean, karte: string | undefined): { zoom: number; setzen: (z: number) => void } {
  const [zoom, setZoom] = useState(1);
  const zRef = useRef(1);

  /** Die Stufe an die Folie schreiben – sofort, damit der Punkt unter dem Zeiger stehen bleiben kann */
  const anlegen = useCallback((z: number) => {
    const el = ref.current;
    const kind = el?.firstElementChild as HTMLElement | null;
    if (!el || !kind) return;
    if (z === 1) {
      // zurück an den Platz gleiten: der Übergang gilt nur für diesen einen Wechsel
      if (el.classList.contains('gezoomt')) { el.classList.add('fz-heim'); window.setTimeout(() => el.classList.remove('fz-heim'), 220); }
      el.classList.remove('gezoomt', 'fz-kurz', 'fz-ohne-x', 'fz-ohne-y');
      for (const v of ['--fz', '--fz-x', '--fz-y', '--fz-unten']) el.style.removeProperty(v);
      return;
    }
    // ungezoomte Lage und Größe des Inhalts (das Layout kennt den Transform nicht)
    const w = kind.offsetWidth; const h = kind.offsetHeight;
    const st = getComputedStyle(el);
    // Abstand vom Innenrand der Folie: Ist die Folie nicht selbst der Bezug, teilen sich beide denselben
    const eigen = kind.offsetParent === el;
    const links = eigen ? kind.offsetLeft : kind.offsetLeft - el.offsetLeft - el.clientLeft;
    const oben = eigen ? kind.offsetTop : kind.offsetTop - el.offsetTop - el.clientTop;
    const x = zoomVersatz(z, links, w, el.clientWidth, Math.min(parseFloat(st.paddingLeft) || 0, 24));
    const y = zoomVersatz(z, oben, h, el.clientHeight, Math.min(parseFloat(st.paddingTop) || 0, 24));
    el.style.setProperty('--fz', String(z));
    el.style.setProperty('--fz-x', `${Math.round(x * 10) / 10}px`);
    el.style.setProperty('--fz-y', `${Math.round(y * 10) / 10}px`);
    // Verkleinert: Der Platz, den das Layout noch für die volle Größe hält, soll nicht leer mitrollen –
    // passt der Inhalt ganz hinein, rollt die Richtung gar nicht, sonst endet sie am verkleinerten Inhalt
    const kurz = z < 1 && h * z > el.clientHeight;
    el.style.setProperty('--fz-unten', kurz ? `${Math.round(h * (z - 1))}px` : '0px');
    el.classList.add('gezoomt');
    el.classList.toggle('fz-kurz', kurz);
    el.classList.toggle('fz-ohne-x', z < 1 && w * z <= el.clientWidth);
    el.classList.toggle('fz-ohne-y', z < 1 && h * z <= el.clientHeight);
    if (z < 1 && w * z <= el.clientWidth) el.scrollLeft = 0;
    if (z < 1 && h * z <= el.clientHeight) el.scrollTop = 0;
  }, [ref]);

  /** Zoomen; mit `punkt` (Bildschirm) bleibt die Stelle darunter stehen */
  const setzen = useCallback((ziel: number, punkt?: { x: number; y: number }, raste = true) => {
    const el = ref.current;
    const kind = el?.firstElementChild as HTMLElement | null;
    const z = zoomStufe(ziel, raste);
    if (!el || !kind || z === zRef.current) return;
    const r0 = kind.getBoundingClientRect();
    // Ohne Zeiger (Tasten) bleibt die linke obere Ecke der Folie stehen – der Anfang des Inhalts bleibt im Blick,
    // wie beim Vergrößern einer Seite im Browser
    const p = punkt ?? (() => { const e = el.getBoundingClientRect(); return { x: e.left + 24, y: e.top + 24 }; })();
    const rel = { x: r0.width ? (p.x - r0.left) / r0.width : 0.5, y: r0.height ? (p.y - r0.top) / r0.height : 0.5 };
    const wz = wurzelZoom() || 1;
    zRef.current = z;
    anlegen(z);
    const r1 = kind.getBoundingClientRect();
    el.scrollLeft += (r1.left + rel.x * r1.width - p.x) / wz;
    el.scrollTop += (r1.top + rel.y * r1.height - p.y) / wz;
    setZoom(z);
  }, [ref, anlegen]);

  // Neue Folie: wieder 100 %
  useEffect(() => { zRef.current = 1; setZoom(1); anlegen(1); }, [karte, anlegen]);
  // Ändert sich die Größe der Folie oder ihres Inhalts, wird der Versatz neu gerechnet
  useEffect(() => {
    const el = ref.current;
    if (!aktiv || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (zRef.current !== 1) anlegen(zRef.current); });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [aktiv, karte, ref, anlegen]);

  useEffect(() => {
    const el = ref.current;
    if (!aktiv || !el) return;
    // Strg/⌘ + Rad – und das Kneifen am Trackpad, das der Browser als Strg+Rad meldet
    const rad = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setzen(zRef.current * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022)), { x: e.clientX, y: e.clientY }, false);
    };
    // Zwei Finger: kneifen zoomt um die Mitte, gemeinsames Schieben rollt
    let alt: { d: number; x: number; y: number } | null = null;
    const lage = (t: TouchList) => ({ d: Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY), x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const an = (e: TouchEvent) => { alt = e.touches.length === 2 ? lage(e.touches) : null; };
    const zieh = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !alt) return;
      e.preventDefault();
      const neu = lage(e.touches);
      const wz = wurzelZoom() || 1;
      el.scrollLeft += (alt.x - neu.x) / wz; el.scrollTop += (alt.y - neu.y) / wz;
      if (alt.d > 24 && neu.d > 24) setzen(zRef.current * (neu.d / alt.d), { x: neu.x, y: neu.y }, false);
      alt = neu;
    };
    const aus = (e: TouchEvent) => {
      alt = e.touches.length === 2 ? lage(e.touches) : null;
      if (e.touches.length === 0 && zRef.current !== 1) setzen(zRef.current);   // nach dem Loslassen nahe 100 % einrasten
    };
    // Die Zeichenschicht meldet das Kneifen, während ein Stift gewählt ist
    const vonSchicht = (e: Event) => { const d = (e as CustomEvent<FolieZoom>).detail; if (d) setzen(zRef.current * d.faktor, { x: d.x, y: d.y }, false); };
    const taste = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === '+' || e.key === '=') setzen(zRef.current * 1.25);
      else if (e.key === '-') setzen(zRef.current / 1.25);
      else if (e.key === '0') setzen(1);
    };
    el.addEventListener('wheel', rad, { passive: false });
    el.addEventListener('touchstart', an, { passive: true });
    el.addEventListener('touchmove', zieh, { passive: false });
    el.addEventListener('touchend', aus, { passive: true });
    el.addEventListener('touchcancel', aus, { passive: true });
    window.addEventListener(FOLIE_ZOOM, vonSchicht);
    window.addEventListener('keydown', taste);
    return () => {
      el.removeEventListener('wheel', rad);
      el.removeEventListener('touchstart', an);
      el.removeEventListener('touchmove', zieh);
      el.removeEventListener('touchend', aus);
      el.removeEventListener('touchcancel', aus);
      window.removeEventListener(FOLIE_ZOOM, vonSchicht);
      window.removeEventListener('keydown', taste);
    };
  }, [aktiv, karte, ref, setzen]);

  return { zoom, setzen: (z: number) => setzen(z) };
}
