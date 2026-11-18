// M375: Live-Mauszeiger und Laserpointer — die Anzeige (Regeln und Kanal: lib/mauszeiger.ts)
//
//   · LiveZeiger   – gehört in ein <ViewportPortal> des Boards: zeigt die Zeiger der anderen in Board-
//                    Koordinaten und meldet den eigenen
//   · FolienLaser  – in der Folien-Präsentation: der eigene Laserpunkt (Taste L) und der des Vorführenden
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { useBoard } from '../store';
import { ichFuehreVor, VORFUEHR_EREIGNIS } from '../lib/vorfuehren';
import { ZEIGER_EREIGNIS, zeigerMelden, zeigerVon, zeigerWeg, type FernZeiger } from '../lib/mauszeiger';

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
  if (!lage || (!an && fern.length === 0)) return null;
  const bewegt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
    if (punkt.current) { punkt.current.style.left = `${x * 100}%`; punkt.current.style.top = `${y * 100}%`; punkt.current.style.opacity = '1'; }
    if (senden) zeigerMelden(boardId, x, y, { laser: true, folie });
  };
  const raus = () => { if (punkt.current) punkt.current.style.opacity = '0'; if (senden) zeigerWeg(boardId); };
  return (
    <div className={`folien-laser${an ? ' an' : ''}`} data-taste="folien-laser" style={lage} onPointerMove={an ? bewegt : undefined} onPointerLeave={an ? raus : undefined}>
      {an && <span ref={punkt} className="laser-punkt mein" data-taste="laser-mein" style={{ opacity: 0 }} />}
      {fern.map((z) => (
        <span key={z.id} className="laser-punkt fern" data-taste="laser-fern" data-name={z.name}
          style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, transitionDuration: `${z.gleiten}ms` }}>
          <span className="live-zeiger-name" translate="no"><IMegafon size={12} /> {z.name}</span>
        </span>
      ))}
    </div>
  );
}
