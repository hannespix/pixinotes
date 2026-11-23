// M375: Live-Mauszeiger und Laserpointer — die Anzeige (Regeln und Kanal: lib/mauszeiger.ts)
//
//   · LiveZeiger   – gehört in ein <ViewportPortal> des Boards: zeigt die Zeiger der anderen in Board-
//                    Koordinaten und meldet den eigenen
//   · FolienLaser  – in der Folien-Präsentation: der eigene Laserpunkt (Taste L) und der des Vorführenden
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { useBoard } from '../store';
import { ichFuehreVor, ROLL_EREIGNIS, SPIEGEL_EREIGNIS, VORFUEHR_EREIGNIS } from '../lib/vorfuehren';
import { ZEIGER_EREIGNIS, zeigerMelden, zeigerVon, zeigerWeg, type Anker, type FernZeiger } from '../lib/mauszeiger';

import { IMegafon } from './Icons';
/** Höchstens so viele Zeiger gleichzeitig — die, die sich zuletzt bewegt haben */
const HOECHSTENS = 40;

/** Neu zeichnen, wenn sich Zeiger geändert haben — höchstens einmal je Bild */
function useZeigerTakt(): void {
  const [, takt] = useState(0);
  useEffect(() => {
    let bild = 0;
    const auf = () => { if (!bild) bild = requestAnimationFrame(() => { bild = 0; takt((n) => n + 1); }); };
    window.addEventListener(ZEIGER_EREIGNIS, auf);
    window.addEventListener(VORFUEHR_EREIGNIS, auf);
    return () => { window.removeEventListener(ZEIGER_EREIGNIS, auf); window.removeEventListener(VORFUEHR_EREIGNIS, auf); if (bild) cancelAnimationFrame(bild); };
  }, []);
}
const neueste = (liste: FernZeiger[]): FernZeiger[] => (liste.length > HOECHSTENS ? [...liste].sort((a, b) => b.zuletzt - a.zuletzt).slice(0, HOECHSTENS) : liste);

function Pfeil() {
  return (
    <svg className="live-zeiger-pfeil" width="18" height="20" viewBox="0 0 18 20" aria-hidden="true">
      <path d="M2 1.5 15.5 11l-6.2.9-3.4 5.6Z" fill="var(--farbe)" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function LiveZeiger() {
  const boardId = useBoard((s) => s.activeId);
  const zoom = useStore((s) => s.transform[2]);
  const { screenToFlowPosition } = useReactFlow();
  useZeigerTakt();

  // Den eigenen Zeiger melden (Maus und Stift — ein Finger zeigt nicht, er schiebt)
  useEffect(() => {
    const el = document.querySelector('.react-flow') as HTMLElement | null;
    if (!el) return;
    const bewegt = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      zeigerMelden(boardId, p.x, p.y, { laser: ichFuehreVor(boardId) });
    };
    const raus = () => zeigerWeg(boardId);
    el.addEventListener('pointermove', bewegt, { passive: true });
    el.addEventListener('pointerleave', raus);
    return () => { el.removeEventListener('pointermove', bewegt); el.removeEventListener('pointerleave', raus); zeigerWeg(boardId); };
  }, [boardId, screenToFlowPosition]);

  const liste = neueste(zeigerVon(boardId).filter((z) => !z.folie));
  if (liste.length === 0) return null;
  const k = 1 / (zoom || 1);
  return (
    <>
      {liste.map((z) => (
        <div key={z.id} className={`live-zeiger${z.laser ? ' laser' : ''}`} data-taste="live-zeiger" data-name={z.name} data-laser={z.laser ? '' : undefined}
          style={{ '--farbe': z.farbe, transform: `translate(${z.x}px, ${z.y}px) scale(${k})`, transitionDuration: `${z.gleiten}ms` } as CSSProperties}>
          {z.laser ? <span className="laser-punkt" /> : <Pfeil />}
          <span className="live-zeiger-name" translate="no">{z.laser && <><IMegafon size={12} /> </>}{z.name}</span>
        </div>
      ))}
    </>
  );
}

/**
 * M414: Woran hängt der Laser? Am Element unter dem Zeiger — nicht an der Folienfläche: Am Telefon liegt eine
 * PDF-Seite, ein Absatz oder ein Bild anders in der Folie als am Beamer, der Inhalt selbst ist derselbe.
 * Gewählt wird das nächste Element, das als Block steht und groß genug ist (ein Wort in einer Zeile wäre zu
 * unruhig); trägt es eine Kennung (`data-anker`, etwa die Seite einer PDF), zählt die — sonst der Weg von der
 * Folie aus. Die Stelle darin als Anteil.
 */
function ankerBei(folie: HTMLElement, cx: number, cy: number): Anker | null {
  const unter = document.elementsFromPoint(cx, cy).find((e) => e !== folie && folie.contains(e)) as HTMLElement | undefined;
  if (!unter) return null;
  let el: HTMLElement | null = unter.closest<HTMLElement>('[data-anker]');
  if (!el || !folie.contains(el)) {
    el = unter;
    while (el && el !== folie) {
      const r = el.getBoundingClientRect();
      if (!getComputedStyle(el).display.startsWith('inline') && r.width >= 12 && r.height >= 12) break;
      el = el.parentElement;
    }
  }
  if (!el || el === folie) return null;
  let p: string;
  if (el.dataset.anker) p = `@${el.dataset.anker}`;
  else {
    const weg: number[] = [];
    for (let k: HTMLElement | null = el; k && k !== folie; k = k.parentElement) {
      const eltern: HTMLElement | null = k.parentElement;
      if (!eltern || weg.length >= 40) return null;
      weg.unshift(Array.prototype.indexOf.call(eltern.children, k));
    }
    p = weg.join('.');
  }
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { p, x: Math.min(1, Math.max(0, (cx - r.left) / r.width)), y: Math.min(1, Math.max(0, (cy - r.top) / r.height)) };
}
/** Den Anker auf diesem Gerät finden: die Bildschirmstelle — oder null, wenn es das Element hier nicht gibt */
function ankerOrt(folie: HTMLElement, a: Anker): { x: number; y: number } | null {
  const [aussen, innen] = a.p.split('~');
  let el: Element | null = null;
  if (aussen.startsWith('@')) el = folie.querySelector(`[data-anker="${aussen.slice(1)}"]`);
  else {
    el = folie;
    for (const t of aussen.split('.')) { el = el?.children[Number(t)] ?? null; if (!el) break; }
  }
  if (!el || el === folie) return null;
  if (innen !== undefined) {
    // Stelle im Tool: Hier steht das Abbild des Vorführenden (lesbar) — ein eigenes, laufendes Tool ist verschlossen
    let doc: Document | null = null;
    try { doc = el instanceof HTMLIFrameElement ? el.contentDocument : null; } catch { doc = null; }
    if (!doc?.body) return null;
    const f = el.getBoundingClientRect();
    if (innen === '') return { x: f.left + f.width * a.x, y: f.top + f.height * a.y };
    let k: Element | null = doc.body;
    for (const t of innen.split('.')) { k = k?.children[Number(t)] ?? null; if (!k) return null; }
    const ri = k.getBoundingClientRect();
    if (ri.width < 1 || ri.height < 1) return null;
    return { x: f.left + ri.left + ri.width * a.x, y: f.top + ri.top + ri.height * a.y };
  }
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { x: r.left + r.width * a.x, y: r.top + r.height * a.y };
}

/**
 * Der Laser auf einer Folie. Liegt als Schicht genau über der Folie — als Geschwister, nicht als Kind: Die
 * Folie rollt ihren Inhalt, eine Schicht darin rollte mit. Die Stelle zählt als Anteil der sichtbaren Folie.
 *   an      – mein Laser ist eingeschaltet: Die Schicht fängt den Zeiger, der Punkt folgt ihm
 *   senden  – ich führe vor: Die Stelle geht an alle
 * Der Laser des Vorführenden wird immer gezeigt, wenn er auf DIESER Folie steht.
 */
export function FolienLaser({ boardId, folie, an, senden }: { boardId: string; folie: string; an: boolean; senden: boolean }) {
  useZeigerTakt();
  const punkt = useRef<HTMLSpanElement | null>(null);
  const [lage, setLage] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const buehne = document.querySelector('.presenter') as HTMLElement | null;
    const blatt = buehne?.querySelector('.presenter-slide') as HTMLElement | null;
    if (!buehne || !blatt) { setLage(null); return; }
    const messen = () => {
      const b = buehne.getBoundingClientRect(); const r = blatt.getBoundingClientRect();
      setLage((alt) => {
        const neu = { left: r.left - b.left, top: r.top - b.top, width: r.width, height: r.height };
        return alt && alt.left === neu.left && alt.top === neu.top && alt.width === neu.width && alt.height === neu.height ? alt : neu;
      });
    };
    messen();
    const ro = new ResizeObserver(messen);
    ro.observe(blatt); ro.observe(buehne);
    return () => ro.disconnect();
  }, [folie]);
  useEffect(() => {
    if (!an || !senden) return;
    return () => zeigerWeg(boardId);
  }, [an, senden, boardId, folie]);
  const fern = zeigerVon(boardId).filter((z) => z.laser && z.folie === folie);
  const fernDa = fern.length > 0;
  // M414: Ein Laser am Inhalt wandert mit, wenn hier gerollt, gezoomt oder umgebrochen wird
  const [, nachfuehren] = useState(0);
  useEffect(() => {
    if (!fernDa) return;
    const blatt = document.querySelector('.presenter .presenter-slide');
    if (!blatt) return;
    let bild = 0;
    const auf = () => { if (!bild) bild = requestAnimationFrame(() => { bild = 0; nachfuehren((n) => n + 1); }); };
    blatt.addEventListener('scroll', auf, true);
    // … auch, wenn das Abbild eines Tools neu kommt oder darin gerollt wird
    window.addEventListener(SPIEGEL_EREIGNIS, auf);
    window.addEventListener(ROLL_EREIGNIS, auf);
    const ro = new ResizeObserver(auf);
    ro.observe(blatt);
    for (const k of Array.from(blatt.children)) ro.observe(k);
    return () => { blatt.removeEventListener('scroll', auf, true); window.removeEventListener(SPIEGEL_EREIGNIS, auf); window.removeEventListener(ROLL_EREIGNIS, auf); ro.disconnect(); if (bild) cancelAnimationFrame(bild); };
  }, [fernDa, folie]);
  // M414: Am Finger bleibt der Punkt nach dem Loslassen noch einen Augenblick stehen (sonst sieht ihn niemand)
  const fingerWeg = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(fingerWeg.current), []);
  // M414: Über einem eigenen Tool fragt die Schicht das Tool, welches Element unter dem Laser liegt (Antwort in einem Augenblick)
  const frage = useRef<{ n: number; x: number; y: number; anker: Anker; rahmen: HTMLIFrameElement; t: ReturnType<typeof setTimeout> } | null>(null);
  const fragen = useRef(0);
  useEffect(() => {
    if (!an || !senden) return;
    const antwort = (e: MessageEvent) => {
      const f = frage.current;
      const w = (e.data as { wo?: { n?: unknown; p?: unknown; x?: unknown; y?: unknown } } | null)?.wo;
      if (!f || !w || e.source !== f.rahmen.contentWindow || w.n !== f.n) return;
      clearTimeout(f.t); frage.current = null;
      const gut = typeof w.p === 'string' && /^(\d{1,4}(\.\d{1,4}){0,39})?$/.test(w.p) && typeof w.x === 'number' && typeof w.y === 'number';
      zeigerMelden(boardId, f.x, f.y, { laser: true, folie, anker: gut ? { p: `${f.anker.p}~${w.p as string}`, x: w.x as number, y: w.y as number } : f.anker });
    };
    window.addEventListener('message', antwort);
    return () => { window.removeEventListener('message', antwort); if (frage.current) { clearTimeout(frage.current.t); frage.current = null; } };
  }, [an, senden, boardId, folie]);
  if (!lage || (!an && !fernDa)) return null;
  const bewegt = (e: ReactPointerEvent<HTMLDivElement>) => {
    clearTimeout(fingerWeg.current);
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
    if (punkt.current) { punkt.current.style.left = `${x * 100}%`; punkt.current.style.top = `${y * 100}%`; punkt.current.style.opacity = '1'; punkt.current.dataset.sichtbar = ''; }
    if (!senden) return;
    const blatt = document.querySelector('.presenter .presenter-slide') as HTMLElement | null;
    const anker = blatt ? ankerBei(blatt, e.clientX, e.clientY) : null;
    const rahmen = blatt && anker ? document.elementsFromPoint(e.clientX, e.clientY).find((k) => k.tagName === 'IFRAME' && blatt.contains(k)) as HTMLIFrameElement | undefined : undefined;
    if (anker && rahmen?.classList.contains('slide-app-frame') && !rahmen.classList.contains('spiegel') && rahmen.contentWindow) {
      const r = rahmen.getBoundingClientRect();
      const n = ++fragen.current;
      if (frage.current) clearTimeout(frage.current.t);
      // Antwortet das Tool nicht (fremde Webseite), zählt der Rahmen selbst
      const t = setTimeout(() => { if (frage.current?.n === n) { frage.current = null; zeigerMelden(boardId, x, y, { laser: true, folie, anker }); } }, 150);
      frage.current = { n, x, y, anker, rahmen, t };
      rahmen.contentWindow.postMessage({ __pixiWo: folie, x: e.clientX - r.left, y: e.clientY - r.top, n }, '*');
      return;
    }
    zeigerMelden(boardId, x, y, { laser: true, folie, anker });
  };
  // M464: data-sichtbar sagt dem CSS, dass der Punkt als Ersatz zu sehen ist — erst dann verschwindet der Systemzeiger
  const weg = () => { if (punkt.current) { punkt.current.style.opacity = '0'; delete punkt.current.dataset.sichtbar; } if (senden) zeigerWeg(boardId); };
  const raus = (e: ReactPointerEvent<HTMLDivElement>) => {
    clearTimeout(fingerWeg.current);
    if (e.pointerType === 'touch') fingerWeg.current = setTimeout(weg, 1500); else weg();
  };
  // Die Laser der anderen: am Inhalt, wenn es ihn hier gibt — sonst an derselben Stelle der Folie (wie bisher)
  const blatt = fernDa ? document.querySelector('.presenter .presenter-slide') as HTMLElement | null : null;
  const schicht = blatt?.getBoundingClientRect();
  const stelle = (z: FernZeiger): { x: number; y: number; rand: boolean } => {
    const o = blatt && schicht && z.anker ? ankerOrt(blatt, z.anker) : null;
    if (!o || !schicht || schicht.width < 4 || schicht.height < 4) return { x: z.x, y: z.y, rand: false };
    const x = (o.x - schicht.left) / schicht.width; const y = (o.y - schicht.top) / schicht.height;
    // Liegt die Stelle hier gerade außerhalb (anders gerollt), steht der Punkt blass am Rand — in ihrer Richtung
    const rand = x < 0 || x > 1 || y < 0 || y > 1;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), rand };
  };
  return (
    <div className={`folien-laser${an ? ' an' : ''}`} data-taste="folien-laser" style={lage} onPointerMove={an ? bewegt : undefined} onPointerLeave={an ? raus : undefined}>
      {an && <span ref={punkt} className="laser-punkt mein" data-taste="laser-mein" style={{ opacity: 0 }} />}
      {fern.map((z) => {
        const o = stelle(z);
        return (
          <span key={z.id} className={`laser-punkt fern${o.rand ? ' rand' : ''}`} data-taste="laser-fern" data-name={z.name}
            style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, transitionDuration: `${z.gleiten}ms` }}>
            <span className="live-zeiger-name" translate="no"><IMegafon size={12} /> {z.name}</span>
          </span>
        );
      })}
    </div>
  );
}
