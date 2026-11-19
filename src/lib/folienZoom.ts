// M402: In der Präsentation in den Inhalt einer Folie hinein- und herauszoomen.
//
// Dokument-Folien (PDF, Word, Bild-Datei) zoomen schon selbst (DokumentFolie). Alle anderen – Notiz, Kanban,
// Zeitplan, Diagramm … – bekommen hier dasselbe: Strg/⌘ + Mausrad (auch das Kneifen am Trackpad), zwei Finger
// kneifen, die Tasten + / − / 0. Gezoomt wird der Inhalt der Folie als Ganzes (CSS-Transform am ersten Kind),
// die Folie selbst rollt dann wie gewohnt; die Zeichenschicht misst sich am Inhalt aus und zoomt von selbst mit.
//
// M403: Dazu eine Darstellung, die für die ganze Präsentation gilt und gemerkt bleibt – „Standard" (100 %),
// „Einpassen" (der ganze Inhalt, so groß wie möglich) und „Volle Breite". Sie ist der Ausgangspunkt jeder Folie
// (die Taste 0 führt dorthin zurück). Was in die Folie passt, steht in ihrer Mitte; gezoomt wird um die Mitte
// des Ausschnitts, mit Rad und Fingern um die Stelle darunter.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { FOLIE_ZOOM, type FolieZoom } from './folienWerkzeug';
import { wurzelZoom } from './anzeige';
import { radSchritt } from './radZoom';

export const FOLIEN_ZOOM_MIN = 0.4;
export const FOLIEN_ZOOM_MAX = 5;

/** Darstellung der Folien – gilt für die ganze Präsentation */
export type FolienAnsicht = 'standard' | 'einpassen' | 'breite';
export const FOLIEN_ANSICHTEN: { id: FolienAnsicht; name: string; hinweis: string }[] = [
  { id: 'standard', name: 'Standard', hinweis: 'Karten in Originalgröße, Dokumente gut lesbar' },
  { id: 'einpassen', name: 'Einpassen', hinweis: 'Der ganze Inhalt, so groß wie möglich' },
  { id: 'breite', name: 'Volle Breite', hinweis: 'Der Inhalt so breit wie die Folie (Taste B)' },
];
const SCHLUESSEL = 'pixinotes-folien-ansicht';
/** Die gemerkte Darstellung dieses Geräts */
export function ansichtGemerkt(): FolienAnsicht {
  try { const v = localStorage.getItem(SCHLUESSEL); return v === 'einpassen' || v === 'breite' ? v : 'standard'; } catch { return 'standard'; }
}
export function ansichtMerken(a: FolienAnsicht): void {
  try { if (a === 'standard') localStorage.removeItem(SCHLUESSEL); else localStorage.setItem(SCHLUESSEL, a); } catch { /* ohne Speicher gilt die Wahl bis zum Schließen */ }
}

/** Stufe begrenzen; nahe 100 % rastet sie ein (sonst bleibt man bei 98 % hängen) */
export function zoomStufe(z: number, raste = true): number {
  const g = Math.max(FOLIEN_ZOOM_MIN, Math.min(FOLIEN_ZOOM_MAX, z));
  return raste && Math.abs(g - 1) < 0.04 ? 1 : Math.round(g * 1000) / 1000;
}

/**
 * Ausgangsstufe einer Folie in der gewählten Darstellung.
 * (`w`/`h`: ungezoomte Größe des Inhalts, `platzW`/`platzH`: Innenmaß der Folie, `rand`: Abstand zum Rand.)
 */
export function heimZoom(a: FolienAnsicht, w: number, h: number, platzW: number, platzH: number, randX: number, randY: number): number {
  if (a === 'standard' || w <= 0 || h <= 0 || platzW <= 2 * randX || platzH <= 2 * randY) return 1;
  const breit = (platzW - 2 * randX) / w;
  // einen Hauch darunter bleiben: Der gerundete Inhalt darf nicht um einen halben Bildpunkt überstehen
  return zoomStufe((a === 'breite' ? breit : Math.min(breit, (platzH - 2 * randY) / h)) - 0.0006);
}

/**
 * Versatz des gezoomten Inhalts. Passt er in die Folie, steht er in ihrer Mitte. Wird er größer als die Folie,
 * legt er sich an ihren Rand – was übersteht, erreicht man durch Rollen oder Ziehen. Der Übergang ist stetig:
 * Genau so groß wie die Folie liegt er in beiden Fällen an derselben Stelle – so bleibt beim Zoomen die Mitte
 * des Ausschnitts wirklich stehen. (`start`: Abstand der ungezoomten Kante vom Rand der Folie.)
 */
export function zoomVersatz(z: number, start: number, mass: number, platz: number): number {
  if (z === 1) return 0;
  return (mass * z > platz ? 0 : (platz - mass * z) / 2) - start;
}

export interface FolienZoomStand { a: FolienAnsicht; d: number }
export interface FolienZoomWahl {
  aktiv: boolean;
  /** Karte der Folie – jede neue Folie beginnt in der gewählten Darstellung */
  karte: string | undefined;
  ansicht: FolienAnsicht;
  /** Doppelklick/Doppeltipp zoomt heran und zurück (Folien ohne eigene Bedienung: Bild, Mail, Text) */
  doppel?: boolean;
  /** Wer folgt, bekommt Darstellung und Zoom des Vorführenden (`d`: Vielfaches der Ausgangsstufe) */
  fremd?: FolienZoomStand | null;
  /** Taste B: zwischen „Volle Breite" und der Darstellung davor wechseln */
  wechsel?: () => void;
}
export interface FolienZoomGriff {
  /** Aktuelle Stufe (1 = Originalgröße) */
  zoom: number;
  /** Ausgangsstufe dieser Folie in der gewählten Darstellung */
  heim: number;
  /** Auf eine Stufe gehen – die Mitte des Ausschnitts bleibt stehen */
  setzen: (z: number) => void;
  /** Um einen Faktor zoomen */
  mal: (f: number) => void;
  /** Zurück zur gewählten Darstellung */
  zurueck: () => void;
}

export function useFolienZoom(ref: RefObject<HTMLElement | null>, wahl: FolienZoomWahl): FolienZoomGriff {
  const { aktiv, karte, doppel } = wahl;
  const ansicht = wahl.fremd?.a ?? wahl.ansicht;
  const fremdD = wahl.fremd ? wahl.fremd.d : null;
  const [stand, setStand] = useState<{ zoom: number; heim: number }>({ zoom: 1, heim: 1 });
  const zRef = useRef(1);
  const heimRef = useRef(1);
  /** Hat der Mensch selbst gezoomt? Dann bleibt seine Stufe, auch wenn sich Folie oder Inhalt in der Größe ändern */
  const eigen = useRef(false);
  const ansichtRef = useRef(ansicht); ansichtRef.current = ansicht;
  const wechselRef = useRef(wahl.wechsel); wechselRef.current = wahl.wechsel;

  const melden = useCallback(() => setStand((alt) => (alt.zoom === zRef.current && alt.heim === heimRef.current ? alt : { zoom: zRef.current, heim: heimRef.current })), []);

  /** Ungezoomte Lage und Größe des Inhalts (das Layout kennt den Transform nicht) */
  const messen = useCallback(() => {
    const el = ref.current;
    const kind = el?.firstElementChild as HTMLElement | null;
    if (!el || !kind) return null;
    const st = getComputedStyle(el);
    // Abstand vom Innenrand der Folie: Ist die Folie nicht selbst der Bezug, teilen sich beide denselben
    const selbst = kind.offsetParent === el;
    return {
      el, kind, w: kind.offsetWidth, h: kind.offsetHeight,
      links: selbst ? kind.offsetLeft : kind.offsetLeft - el.offsetLeft - el.clientLeft,
      oben: selbst ? kind.offsetTop : kind.offsetTop - el.offsetTop - el.clientTop,
      randX: Math.min(parseFloat(st.paddingLeft) || 0, 24), randY: Math.min(parseFloat(st.paddingTop) || 0, 24),
    };
  }, [ref]);

  /** Die Ausgangsstufe der gewählten Darstellung für diese Folie */
  const heimRechnen = useCallback((): number => {
    const a = ansichtRef.current;
    const el = ref.current;
    if (!el) return 1;
    // In „Volle Breite" und „Einpassen" hält die Folie den Platz für den Rollbalken frei – sonst änderte sein
    // Erscheinen die Breite, damit die Stufe, damit wieder den Rollbalken
    el.classList.toggle('fz-modus', a !== 'standard');
    if (a !== 'breite') { el.classList.remove('fz-fest'); el.style.removeProperty('--fz-hoch'); }
    let m = messen();
    if (!m || a === 'standard') return 1;
    let z = heimZoom(a, m.w, m.h, el.clientWidth, el.clientHeight, m.randX, m.randY);
    if (a === 'breite') {
      // Was in sich selbst rollt (eine lange Notiz), bleibt so hoch wie die Folie: Es füllt die Breite, und der
      // Text rollt weiter in der Notiz – nicht Notiz UND Folie
      el.style.setProperty('--fz-hoch', `${Math.max(80, Math.floor((el.clientHeight - 2 * m.randY) / z))}px`);
      el.classList.add('fz-fest');
      m = messen();
      if (m) z = heimZoom(a, m.w, m.h, el.clientWidth, el.clientHeight, m.randX, m.randY);
    }
    return z;
  }, [ref, messen]);

  /** Die Stufe an die Folie schreiben – sofort, damit der Punkt unter dem Zeiger stehen bleiben kann */
  const anlegen = useCallback((z: number, gleiten = false) => {
    const m = messen();
    if (!m) return;
    const { el, w, h } = m;
    if (gleiten && (el.classList.contains('gezoomt') || z !== 1)) { el.classList.add('fz-heim'); window.setTimeout(() => el.classList.remove('fz-heim'), 220); }
    if (z === 1) {
      el.classList.remove('gezoomt', 'fz-kurz', 'fz-ohne-x', 'fz-ohne-y');
      for (const v of ['--fz', '--fz-x', '--fz-y', '--fz-unten']) el.style.removeProperty(v);
      return;
    }
    const x = zoomVersatz(z, m.links, w, el.clientWidth);
    const y = zoomVersatz(z, m.oben, h, el.clientHeight);
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
  }, [messen]);

  /** Zur Ausgangsstufe der Darstellung (mal `faktor`, wenn man dem Vorführenden folgt) */
  const heimwaerts = useCallback((faktor = 1, gleiten = false, anfang = true) => {
    const el = ref.current;
    if (!el) return;
    const heim = heimRechnen();
    const z = faktor === 1 ? heim : zoomStufe(heim * faktor, false);
    heimRef.current = heim; zRef.current = z; eigen.current = false;
    anlegen(z, gleiten);
    if (anfang) { el.scrollLeft = 0; el.scrollTop = 0; }
    melden();
  }, [ref, heimRechnen, anlegen, melden]);

  /** Zoomen; mit `punkt` (Bildschirm) bleibt die Stelle darunter stehen, sonst die Mitte des Ausschnitts */
  const setzen = useCallback((ziel: number, punkt?: { x: number; y: number }, raste = true) => {
    const el = ref.current;
    const kind = el?.firstElementChild as HTMLElement | null;
    let z = zoomStufe(ziel, raste);
    // nahe der Ausgangsstufe rastet der Zoom dort ein – „Einpassen" bleibt „Einpassen"
    if (raste && Math.abs(z / heimRef.current - 1) < 0.04) z = heimRef.current;
    if (!el || !kind || z === zRef.current) return;
    const r0 = kind.getBoundingClientRect();
    const p = punkt ?? (() => { const e = el.getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 }; })();
    const rel = { x: r0.width ? (p.x - r0.left) / r0.width : 0.5, y: r0.height ? (p.y - r0.top) / r0.height : 0.5 };
    const wz = wurzelZoom() || 1;
    zRef.current = z;
    eigen.current = z !== heimRef.current;
    anlegen(z);
    const r1 = kind.getBoundingClientRect();
    el.scrollLeft += (r1.left + rel.x * r1.width - p.x) / wz;
    el.scrollTop += (r1.top + rel.y * r1.height - p.y) / wz;
    melden();
  }, [ref, anlegen, melden]);

  // Neue Folie, andere Darstellung, der Vorführende zoomt: zur Ausgangsstufe (mal seinem Faktor)
  useEffect(() => {
    if (!aktiv) {
      const el = ref.current;
      if (el) { el.classList.remove('fz-modus', 'fz-fest'); el.style.removeProperty('--fz-hoch'); }
      zRef.current = 1; heimRef.current = 1; eigen.current = false;
      anlegen(1); melden();
      return;
    }
    heimwaerts(fremdD ?? 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiv, karte, ansicht, fremdD]);

  // Ändert sich die Größe der Folie oder ihres Inhalts, wird neu gerechnet: Wer nicht selbst gezoomt hat, bleibt in
  // der Darstellung (ein Bild lädt nach, die Notiz wächst beim Tippen) – sonst bleibt die eigene Stufe
  useEffect(() => {
    const el = ref.current;
    if (!aktiv || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (eigen.current) { anlegen(zRef.current); return; }
      const faktor = heimRef.current > 0 ? zRef.current / heimRef.current : 1;
      const heim = heimRechnen();
      heimRef.current = heim;
      zRef.current = Math.abs(faktor - 1) < 0.001 ? heim : zoomStufe(heim * faktor, false);
      anlegen(zRef.current);
      melden();
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [aktiv, karte, ref, anlegen, heimRechnen, melden]);

  useEffect(() => {
    const el = ref.current;
    if (!aktiv || !el) return;
    /** Heran und zurück: von der Ausgangsstufe auf das Zweieinhalbfache, sonst wieder dorthin */
    const hinUndHer = (x: number, y: number) => {
      if (zRef.current > heimRef.current * 1.05) heimwaerts(1, true);
      else setzen(heimRef.current * 2.5, { x, y });
    };
    // Strg/⌘ + Rad – und das Kneifen am Trackpad, das der Browser als Strg+Rad meldet
    const rad = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setzen(zRef.current * 2 ** radSchritt(e).hoch, { x: e.clientX, y: e.clientY }, false);   // M404: jede Raste derselbe Schritt
    };
    // Zwei Finger: kneifen zoomt um die Mitte, gemeinsames Schieben rollt
    let alt: { d: number; x: number; y: number } | null = null;
    let tipp: { x: number; y: number; t: number } | null = null;
    let davor: { x: number; y: number; t: number } | null = null;
    const lage = (t: TouchList) => ({ d: Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY), x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const an = (e: TouchEvent) => {
      alt = e.touches.length === 2 ? lage(e.touches) : null;
      tipp = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() } : null;
    };
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
      if (e.touches.length === 0 && eigen.current) setzen(zRef.current);   // nach dem Loslassen nahe 100 % und nahe der Darstellung einrasten
      // Doppeltipp (nur auf Folien ohne eigene Bedienung)
      const s = tipp; tipp = null;
      const t = e.changedTouches[0];
      if (!doppel || !s || !t || e.touches.length > 0) return;
      const jetzt = performance.now();
      if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10 || jetzt - s.t > 350) { davor = null; return; }
      if (davor && jetzt - davor.t < 320 && Math.hypot(davor.x - t.clientX, davor.y - t.clientY) < 40) {
        davor = null;
        e.preventDefault();
        hinUndHer(t.clientX, t.clientY);
        return;
      }
      davor = { x: t.clientX, y: t.clientY, t: jetzt };
    };
    const doppelklick = (e: MouseEvent) => {
      if (!doppel || (e.target as HTMLElement | null)?.closest('a, button, input, textarea, select, summary, video, audio, [contenteditable="true"]')) return;
      window.getSelection()?.removeAllRanges();
      hinUndHer(e.clientX, e.clientY);
    };
    // Die Zeichenschicht meldet das Kneifen, während ein Stift gewählt ist
    const vonSchicht = (e: Event) => { const d = (e as CustomEvent<FolieZoom>).detail; if (d) setzen(zRef.current * d.faktor, { x: d.x, y: d.y }, false); };
    const taste = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === '+' || e.key === '=') setzen(zRef.current * 1.25);
      else if (e.key === '-') setzen(zRef.current / 1.25);
      else if (e.key === '0') heimwaerts(1, true);
      else if (e.key.toLowerCase() === 'b') wechselRef.current?.();
    };
    el.addEventListener('wheel', rad, { passive: false });
    el.addEventListener('touchstart', an, { passive: true });
    el.addEventListener('touchmove', zieh, { passive: false });
    el.addEventListener('touchend', aus, { passive: false });
    el.addEventListener('touchcancel', aus, { passive: false });
    el.addEventListener('dblclick', doppelklick);
    window.addEventListener(FOLIE_ZOOM, vonSchicht);
    window.addEventListener('keydown', taste);
    return () => {
      el.removeEventListener('wheel', rad);
      el.removeEventListener('touchstart', an);
      el.removeEventListener('touchmove', zieh);
      el.removeEventListener('touchend', aus);
      el.removeEventListener('touchcancel', aus);
      el.removeEventListener('dblclick', doppelklick);
      window.removeEventListener(FOLIE_ZOOM, vonSchicht);
      window.removeEventListener('keydown', taste);
    };
  }, [aktiv, karte, doppel, ref, setzen, heimwaerts]);

  const aufStufe = useCallback((z: number) => setzen(z), [setzen]);
  const mal = useCallback((f: number) => setzen(zRef.current * f), [setzen]);
  const zurueck = useCallback(() => heimwaerts(1, true), [heimwaerts]);
  return { zoom: stand.zoom, heim: stand.heim, setzen: aufStufe, mal, zurueck };
}
