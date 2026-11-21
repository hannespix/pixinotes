// M414: Das Abbild eines Tools beim Zuschauer (Regeln und Leitung: lib/spiegel.ts).
//
// Ein Rahmen, in dem nichts läuft (sandbox ohne allow-scripts): Er zeigt, was beim Vorführenden im Tool steht,
// und rollt mit ihm. Bedienen lässt er sich nicht — wer selbst ausprobieren will, löst sich („Lösen" im Band)
// und bekommt sein eigenes, laufendes Tool.
import { useEffect, useRef } from 'react';
import { anwenden } from '../lib/spiegel';
import { ROLL_EREIGNIS, SPIEGEL_EREIGNIS, werFuehrtVor, type Roll } from '../lib/vorfuehren';

const LEER = '<!doctype html><html><head></head><body></body></html>';

/** Das Element zu einem Weg (wie in der Brücke: '' = die Seite, sonst Kindstellen ab <body>) */
function finde(doc: Document, p: string): Element | null {
  if (p === '') return doc.scrollingElement ?? doc.documentElement;
  let el: Element | null = doc.body;
  for (const t of p.split('.')) { el = el?.children[Number(t)] ?? null; if (!el) return null; }
  return el;
}

export default function SpiegelRahmen({ boardId, karte, className, title }: { boardId: string; karte: string; className: string; title: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const bereit = useRef(false);
  const rollen = useRef(new Map<string, Roll>());

  useEffect(() => {
    rollen.current.clear();
    const start = werFuehrtVor(boardId)?.rollen[karte];
    if (start) rollen.current.set('', start);
    const doc = () => (bereit.current ? ref.current?.contentDocument ?? null : null);
    const rollenSetzen = (d: Document) => {
      for (const [p, r] of rollen.current) {
        const el = finde(d, p);
        if (!el) continue;
        el.scrollTop = r.y * Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollLeft = r.x * Math.max(0, el.scrollWidth - el.clientWidth);
      }
    };
    const auftragen = () => { const d = doc(); if (d && anwenden(d, boardId, karte)) rollenSetzen(d); };
    const neu = (e: Event) => {
      const x = (e as CustomEvent<{ boardId: string; karte: string }>).detail;
      if (x?.boardId === boardId && (x.karte === karte || x.karte === '')) auftragen();
    };
    const gerollt = (e: Event) => {
      const x = (e as CustomEvent<{ boardId: string; karte: string; roll: Roll }>).detail;
      if (x?.boardId !== boardId || x.karte !== karte) return;
      rollen.current.set(x.roll.p, x.roll);
      if (rollen.current.size > 60) rollen.current.delete(rollen.current.keys().next().value as string);
      const d = doc(); if (d) rollenSetzen(d);
    };
    const geladen = () => { bereit.current = true; auftragen(); };
    const f = ref.current;
    f?.addEventListener('load', geladen);
    if (f?.contentDocument?.readyState === 'complete' && f.contentDocument.body) geladen();
    window.addEventListener(SPIEGEL_EREIGNIS, neu);
    window.addEventListener(ROLL_EREIGNIS, gerollt);
    return () => { f?.removeEventListener('load', geladen); window.removeEventListener(SPIEGEL_EREIGNIS, neu); window.removeEventListener(ROLL_EREIGNIS, gerollt); };
  }, [boardId, karte]);

  return <iframe ref={ref} className={`${className} spiegel`} title={title} sandbox="allow-same-origin" srcDoc={LEER} data-taste="tool-spiegel" tabIndex={-1} />;
}
