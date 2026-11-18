// M367: „Folgt mir" — Band und Mitfahren der Ansicht (die Logik liegt in lib/vorfuehren.ts)
import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useBoard } from '../store';
import { dokMelden, fokusMelden, folgeIch, folgenSetzen, ichFuehreVor, lebenszeichen, sichtMelden, VORFUEHR_EREIGNIS, vorfuehrenStopp, werFuehrtVor } from '../lib/vorfuehren';
import { DOKUMENT_BEFEHL, offeneSeiten, SEITEN_EREIGNIS, seiteMerken, seiteVon, type DokumentBefehl } from '../lib/pdfSeiten';
import { focusable } from './FocusSheet';

import { IMegafon } from './Icons';
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

  // Ich führe vor: meinen Ausschnitt melden. M387: Gemerkt wird er auch ohne Vorführung (seltener) — beginnt sie
  // in der Präsentation, ist das Board nicht mehr da, um ihn zu messen.
  useEffect(() => {
    if (folge) return;
    const melde = () => {
      const el = document.querySelector('.react-flow') as HTMLElement | null;
      // M371: In der Präsentation liegt das Board nicht vor — der letzte Ausschnitt gilt weiter, das Lebenszeichen geht hinaus
      if (!el) { if (ichZeige) lebenszeichen(boardId); return; }
      const r = el.getBoundingClientRect();
      const vp = getViewport();
      if (!(vp.zoom > 0) || r.width < 10) return;
      sichtMelden(boardId, { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: r.width / vp.zoom, h: r.height / vp.zoom });
    };
    melde();
    const t = setInterval(melde, ichZeige ? 250 : 1000);
    return () => clearInterval(t);
  }, [ichZeige, folge, boardId, getViewport]);

  // ───── M387: Karte im Fokus und aufgeklappte Dokumente gehören zur Ansicht ─────
  const focusCard = useBoard((s) => s.focusCard);
  // Ich melde (gemerkt wird immer; gesendet, solange ich vorführe). Wer folgt, meldet nichts.
  useEffect(() => {
    if (folge) return;
    fokusMelden(boardId, imVortrag ? null : focusCard);
  }, [boardId, focusCard, imVortrag, folge]);
  useEffect(() => {
    if (folge) return;
    const melde = () => dokMelden(boardId, offeneSeiten());
    melde();
    window.addEventListener(SEITEN_EREIGNIS, melde);
    return () => window.removeEventListener(SEITEN_EREIGNIS, melde);
  }, [boardId, folge]);
  // Ich folge: Die Karte, die der Vorführende im Fokus hat, öffnet sich auch hier — und schließt sich mit ihm
  const fokusGefolgt = useRef<string | null>(null);
  const dortFokus = folge && z ? z.fokus : null;
  useEffect(() => {
    if (!folge) { fokusGefolgt.current = null; return; }
    if (imVortrag) return;
    const st = useBoard.getState();
    if (dortFokus) {
      if (st.focusCard !== dortFokus) {
        if (!focusable(st.boards.find((b) => b.id === boardId)?.nodes.find((n) => n.id === dortFokus))) return;
        st.setFocusCard(dortFokus);
      }
      fokusGefolgt.current = dortFokus;
    } else if (fokusGefolgt.current) {
      const war = fokusGefolgt.current;
      fokusGefolgt.current = null;
      if (st.focusCard === war) st.setFocusCard(null);
    }
  }, [folge, dortFokus, imVortrag, boardId]);
  // Wer diesen Fokus selbst schließt oder zu einer anderen Karte blättert, löst sich
  useEffect(() => {
    const g = fokusGefolgt.current;
    if (folgeIch(boardId) && g && focusCard !== g && werFuehrtVor(boardId)?.fokus === g) { fokusGefolgt.current = null; folgenSetzen(boardId, false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCard]);
  // Ich folge: Dokument-Karten klappen auf und blättern mit
  const dortDok = folge && z && !imVortrag ? JSON.stringify(z.dok) : '';
  const aufGefolgt = useRef(new Set<string>());
  useEffect(() => {
    if (!dortDok) return;
    const befehl = (d: DokumentBefehl) => window.dispatchEvent(new CustomEvent<DokumentBefehl>(DOKUMENT_BEFEHL, { detail: d }));
    const dok = JSON.parse(dortDok) as Record<string, number>;
    for (const [karte, seite] of Object.entries(dok)) {
      const hier = seiteVon(karte);
      if (hier?.seite === seite) continue;
      if (!hier) aufGefolgt.current.add(karte);
      seiteMerken(karte, seite);       // klappt die Karte erst auf, beginnt sie gleich auf dieser Seite
      befehl({ id: karte, was: 'zeige', zu: seite });
    }
    for (const karte of [...aufGefolgt.current]) {
      if (!(karte in dok)) { aufGefolgt.current.delete(karte); befehl({ id: karte, was: 'zuklappen' }); }
    }
  }, [dortDok]);

  // Ich folge: mit der Ansicht des Vorführenden mitfahren. Im Fokus führt die Karte die Kamera (jedes Gerät füllt
  // seinen Schirm mit ihr); danach und nach der Präsentation fährt die Ansicht wieder zum Ausschnitt des Vorführenden.
  const sicht = z && !ichZeige ? `${z.sicht.x},${z.sicht.y},${z.sicht.w},${z.sicht.h}` : '';
  const ebenFrei = useRef(0);
  const vorher = useRef({ fokus: !!focusCard, vortrag: imVortrag });
  if ((vorher.current.fokus && !focusCard) || (vorher.current.vortrag && !imVortrag)) ebenFrei.current = performance.now();
  vorher.current = { fokus: !!focusCard, vortrag: imVortrag };
  useEffect(() => {
    if (!folge || !z || !sicht || imVortrag || focusCard) return;
    const fahren = () => void fitBounds({ x: z.sicht.x, y: z.sicht.y, width: z.sicht.w, height: z.sicht.h }, { duration: 260, padding: 0 });
    const warte = 400 - (performance.now() - ebenFrei.current);
    if (warte <= 0) { fahren(); return; }
    const t = setTimeout(fahren, warte);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folge, sicht, focusCard, imVortrag]);

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
          <span><IMegafon size={14} /> <b>Du führst vor</b> – {imVortrag ? 'alle sehen deine Folien' : 'alle folgen deiner Ansicht'}</span>
          <button onClick={() => vorfuehrenStopp()} data-taste="zeig-ende">Beenden</button>
        </>
      ) : folge ? (
        <>
          <span><IMegafon size={14} /> <b translate="no">{z.name}</b> führt vor – du folgst</span>
          <button className="leise" onClick={() => folgenSetzen(boardId, false)} data-taste="zeig-loesen">Lösen</button>
        </>
      ) : (
        <>
          <span><IMegafon size={14} /> <b translate="no">{z.name}</b> führt vor</span>
          <button onClick={() => folgenSetzen(boardId, true)} data-taste="zeig-folgen">Wieder folgen</button>
        </>
      )}
    </div>
  );
}
