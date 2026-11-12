// M339: Striche, die auf dem TEXT einer Notiz liegen, zeichnet die Notiz selbst — im
// Scrollbereich, über dem Text. So scrollen sie ohne Rechnerei mit, werden am Kartenrand
// beschnitten, und der Textmarker mischt sich mit dem Text darunter wie auf Papier.
// Rückt der Absatz unter einem Strich (darüber kam Text dazu oder fiel weg), rückt er mit.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useBoard, type Stroke } from '../../store';
import { absatzVersatz, istAmText, rolleMelden, rolleVon } from '../../lib/notizText';
import { MarkerGruppen, StrichPfad } from '../StrichPfad';

const LEER: Stroke[] = [];
/** Striche je Karte — einmal je Strich-Liste sortiert, nicht einmal je Notiz */
const index = new WeakMap<Stroke[], Map<string, Stroke[]>>();
function stricheAn(drawings: Stroke[] | undefined, nodeId: string): Stroke[] {
  if (!drawings?.length) return LEER;
  let m = index.get(drawings);
  if (!m) {
    m = new Map();
    for (const s of drawings) if (s.anchor && s.seite == null) { const l = m.get(s.anchor); if (l) l.push(s); else m.set(s.anchor, [s]); }
    index.set(drawings, m);
  }
  return m.get(nodeId) ?? LEER;
}

export const NotizStriche = memo(function NotizStriche({ id }: { id: string }) {
  const alle = useBoard(useShallow((s) => stricheAn(s.boards.find((b) => b.id === s.activeId)?.drawings, id)));
  return alle.length ? <Ebene id={id} alle={alle} /> : null;
});

function Ebene({ id, alle }: { id: string; alle: Stroke[] }) {
  // Kartenmaße: nur für ältere Striche ohne eigene Angabe (siehe istAmText)
  const masse = useBoard((s) => {
    const n = s.boards.find((b) => b.id === s.activeId)?.nodes.find((k) => k.id === id);
    return `${n?.width ?? n?.measured?.width ?? 260}|${n?.height ?? ''}`;
  });
  const striche = useMemo(() => {
    const [w, h] = masse.split('|');
    return alle.filter((s) => istAmText(s, true, Number(w), h ? Number(h) : undefined));
  }, [alle, masse]);
  const [versatz, setVersatz] = useState<Record<string, number>>({});
  const svg = useRef<SVGSVGElement | null>(null);
  /** Der Scrollbereich (Kartenkörper). Beim ersten Aufbau hat die Hülle ihn noch nicht gemeldet
   *  (Effekte laufen von innen nach außen) — dann meldet ihn diese Ebene selbst. */
  const koerper = (): HTMLElement | null => {
    const el = (svg.current?.closest('.card-body') as HTMLElement | null) ?? rolleVon(id) ?? null;
    if (el && rolleVon(id) !== el) rolleMelden(id, el);
    return el;
  };
  const messen = () => {
    if (!koerper()) return;
    const neu: Record<string, number> = {};
    for (const s of striche) { const d = absatzVersatz(s); if (d) neu[s.id] = d; }
    setVersatz((alt) => {
      const a = Object.keys(alt); const b = Object.keys(neu);
      return a.length === b.length && b.every((k) => alt[k] === neu[k]) ? alt : neu;
    });
  };
  // nach jedem Aufbau (der Text kann sich geändert haben) …
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(messen);
  // … und wenn der Text seine Höhe ändert, ohne dass die Notiz neu aufbaut (Tippen im Editor)
  useEffect(() => {
    const el = koerper();
    if (!el || !striche.some((s) => s.block)) return;
    let raf = 0;
    const plan = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; messen(); }); };
    const ro = new ResizeObserver(plan);
    for (const k of Array.from(el.children)) if (!k.classList.contains('notiz-striche')) ro.observe(k);
    const mo = new MutationObserver(plan);
    mo.observe(el, { subtree: true, childList: true, characterData: true });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, striche]);
  if (striche.length === 0) return null;
  return (
    <svg ref={svg} className="notiz-striche" aria-hidden="true">
      {/* M356: Textmarker je Farbe als eine Fläche (kein Nachdunkeln), Stift darüber */}
      <MarkerGruppen eintraege={striche.filter((s) => s.tool === 'marker').map((s) => ({ s, dy: versatz[s.id] ?? 0 }))} />
      {striche.filter((s) => s.tool !== 'marker').map((s) => <StrichPfad key={s.id} s={s} dy={versatz[s.id] ?? 0} />)}
    </svg>
  );
}
