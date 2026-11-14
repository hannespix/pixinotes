// M367: „Folgt mir" — Band und Mitfahren der Ansicht (die Logik liegt in lib/vorfuehren.ts)
import { useEffect, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useBoard } from '../store';
import { folgeIch, folgenSetzen, ichFuehreVor, lebenszeichen, sichtMelden, VORFUEHR_EREIGNIS, vorfuehrenStopp, werFuehrtVor } from '../lib/vorfuehren';

export function Vorfuehren() {
  const boardId = useBoard((s) => s.activeId);
  /** M371: Läuft die Folien-Präsentation, sitzt das Band über ihr (unten, damit es die Kopfzeile nicht verdeckt) */
  const imVortrag = useBoard((s) => s.presenting);
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
      // M371: In der Präsentation liegt das Board nicht vor — der letzte Ausschnitt gilt weiter, das Lebenszeichen geht hinaus
      if (!el) { lebenszeichen(boardId); return; }
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
    if (!folge || !z || !sicht || imVortrag) return;
    void fitBounds({ x: z.sicht.x, y: z.sicht.y, width: z.sicht.w, height: z.sicht.h }, { duration: 260, padding: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folge, sicht]);

  // Wer selbst schwenkt oder zoomt, löst sich. M371: erst, wenn sich die Ansicht dabei wirklich bewegt hat —
  // ein Klick auf eine Karte (auswählen, ein Tool anhalten) ist kein Wegschauen und löst nicht mehr.
  useEffect(() => {
    if (!folge || imVortrag) return;
    const el = document.querySelector('.react-flow') as HTMLElement | null;
    if (!el) return;
    const loesen = () => folgenSetzen(boardId, false);
    let ab: { x: number; y: number; vx: number; vy: number; zoom: number; gezogen: boolean } | null = null;
    const runter = (e: PointerEvent) => { const v = getViewport(); ab = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, zoom: v.zoom, gezogen: false }; };
    const bewegt = (e: PointerEvent) => { if (ab && !ab.gezogen && Math.hypot(e.clientX - ab.x, e.clientY - ab.y) > 5) ab.gezogen = true; };
    const hoch = () => {
      const a = ab; ab = null;
      if (!a?.gezogen) return;
      const v = getViewport();
      if (Math.abs(v.x - a.vx) > 2 || Math.abs(v.y - a.vy) > 2 || Math.abs(v.zoom - a.zoom) > 0.002) loesen();
    };
    el.addEventListener('wheel', loesen, { capture: true, passive: true });
    el.addEventListener('pointerdown', runter, true);
    window.addEventListener('pointermove', bewegt, true);
    window.addEventListener('pointerup', hoch, true);
    window.addEventListener('pointercancel', hoch, true);
    return () => {
      el.removeEventListener('wheel', loesen, true);
      el.removeEventListener('pointerdown', runter, true);
      window.removeEventListener('pointermove', bewegt, true);
      window.removeEventListener('pointerup', hoch, true);
      window.removeEventListener('pointercancel', hoch, true);
    };
  }, [folge, boardId, imVortrag, getViewport]);

  if (!z) return null;
  return (
    <div className={`zeig-band${ichZeige ? ' ich' : ''}${imVortrag ? ' im-vortrag' : ''}`} role="status" data-taste="zeig-band">
      {ichZeige ? (
        <>
          <span>📣 <b>Du führst vor</b> — {imVortrag ? 'alle sehen deine Folien' : 'alle folgen deiner Ansicht'}</span>
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
