// M367: „Folgt mir" — Band und Mitfahren der Ansicht (die Logik liegt in lib/vorfuehren.ts)
import { useEffect, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useBoard } from '../store';
import { folgeIch, folgenSetzen, ichFuehreVor, sichtMelden, VORFUEHR_EREIGNIS, vorfuehrenStopp, werFuehrtVor } from '../lib/vorfuehren';

export function Vorfuehren() {
  const boardId = useBoard((s) => s.activeId);
  const { getViewport, fitBounds } = useReactFlow();
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(VORFUEHR_EREIGNIS, auf);
    return () => window.removeEventListener(VORFUEHR_EREIGNIS, auf);
  }, []);
  const ichZeige = ichFuehreVor(boardId);
  const z = werFuehrtVor(boardId);
  const folge = folgeIch(boardId);

  // Ich führe vor: meinen Ausschnitt melden
  useEffect(() => {
    if (!ichZeige) return;
    const melde = () => {
      const el = document.querySelector('.react-flow') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vp = getViewport();
      if (!(vp.zoom > 0) || r.width < 10) return;
      sichtMelden(boardId, { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: r.width / vp.zoom, h: r.height / vp.zoom });
    };
    melde();
    const t = setInterval(melde, 250);
    return () => clearInterval(t);
  }, [ichZeige, boardId, getViewport]);

  // Ich folge: mit der Ansicht des Vorführenden mitfahren
  const sicht = z && !ichZeige ? `${z.sicht.x},${z.sicht.y},${z.sicht.w},${z.sicht.h}` : '';
  useEffect(() => {
    if (!folge || !z || !sicht) return;
    void fitBounds({ x: z.sicht.x, y: z.sicht.y, width: z.sicht.w, height: z.sicht.h }, { duration: 260, padding: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folge, sicht]);

  // Wer selbst schwenkt oder zoomt, löst sich
  useEffect(() => {
    if (!folge) return;
    const el = document.querySelector('.react-flow') as HTMLElement | null;
    if (!el) return;
    const loesen = () => folgenSetzen(boardId, false);
    el.addEventListener('wheel', loesen, { capture: true, passive: true });
    el.addEventListener('pointerdown', loesen, true);
    return () => { el.removeEventListener('wheel', loesen, true); el.removeEventListener('pointerdown', loesen, true); };
  }, [folge, boardId]);

  if (!z) return null;
  return (
    <div className={`zeig-band${ichZeige ? ' ich' : ''}`} role="status" data-taste="zeig-band">
      {ichZeige ? (
        <>
          <span>📣 <b>Du führst vor</b> — alle folgen deiner Ansicht</span>
          <button onClick={() => vorfuehrenStopp()} data-taste="zeig-ende">Beenden</button>
        </>
      ) : folge ? (
        <>
          <span>📣 <b translate="no">{z.name}</b> führt vor — du folgst</span>
          <button className="leise" onClick={() => folgenSetzen(boardId, false)} data-taste="zeig-loesen">Lösen</button>
        </>
      ) : (
        <>
          <span>📣 <b translate="no">{z.name}</b> führt vor</span>
          <button onClick={() => folgenSetzen(boardId, true)} data-taste="zeig-folgen">Wieder folgen</button>
        </>
      )}
    </div>
  );
}
