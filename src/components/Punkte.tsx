// M377: Punkte auf Karten — die Anzeige (Regeln: lib/punkte.ts)
//
//   · PunkteMarken  – gehört in ein <ViewportPortal>: an jeder Karte mit Punkten die Zahl (antippen = mein Punkt)
//   · PunkteLeiste  – der Punkte-Modus: Karten antippen statt auswählen, Rangliste, Zurücksetzen
import { useEffect, useMemo, useState } from 'react';
import { useInternalNode } from '@xyflow/react';
import { gruppeVon, karteFest, mutedHistory, selectActiveBoard, selectNurLesen, useBoard } from '../store';
import { meineKennung, sperrenVon } from '../lib/gastSync';
import { hatPunktVon, PUNKTE_MODUS, punkteModus, punkteModusSetzen, punkteZahl, punktSetzen } from '../lib/punkte';
import { nodeToText } from '../lib/serialize';
import type { AppNode } from '../types';

/** Unter welcher Kennung vergebe ich Punkte? (wie beim Anlegen von Karten) */
export const punkteIch = (boardId: string): string => gruppeVon(boardId)?.ich ?? meineKennung(false);

/** Meinen Punkt an dieser Karte umschalten — sagt, warum es nicht geht, wenn es nicht geht */
export function punktUmschalten(boardId: string, nodeId: string): boolean {
  const st = useBoard.getState();
  const board = st.boards.find((b) => b.id === boardId);
  const n = board?.nodes.find((k) => k.id === nodeId);
  if (!board || !n) return false;
  if (board.geteiltRolle === 'lesen') { st.showToast('Dieses Board ist nur zum Lesen geteilt — Punkte vergeben geht hier nicht.'); return false; }
  if (karteFest(boardId, (n.data as { von?: string }).von)) { st.showToast('Hier darfst du nur eigene Karten ändern — Punkte auf fremde Karten gehen nicht.'); return false; }
  // Eine Karte, die gerade ein anderer schreibt, gehört für den Moment ihm — was hier an ihr geändert würde, ginge unter
  const haelt = sperrenVon(boardId).get(nodeId);
  if (haelt) { st.showToast(`✎ ${haelt.name} bearbeitet diese Karte gerade — gib deinen Punkt gleich noch einmal.`); return false; }
  const ich = punkteIch(boardId);
  st.updateNodeData(nodeId, { punkte: punktSetzen(n.data, ich, !hatPunktVon(n.data, ich)) });
  return true;
}

function Marke({ id, zahl, mein, boardId }: { id: string; zahl: number; mein: boolean; boardId: string }) {
  const node = useInternalNode(id);
  if (!node) return null;
  const w = node.measured?.width ?? node.width ?? 0;
  if (!w) return null;
  const p = node.internals.positionAbsolute;
  return (
    <button className={`punkte-marke nodrag nopan${mein ? ' mein' : ''}`} data-taste="punkte-marke" data-karte={id} data-zahl={zahl} aria-pressed={mein}
      style={{ transform: `translate(${p.x + w}px, ${p.y}px)` }}
      title={`${zahl} ${zahl === 1 ? 'Punkt' : 'Punkte'}${mein ? ' — einer davon von dir (antippen nimmt ihn zurück)' : ' — antippen gibt deinen dazu'}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); punktUmschalten(boardId, id); }}>
      <span className="punkte-punkt" aria-hidden="true" />{zahl}
    </button>
  );
}
/** Gehört in ein <ViewportPortal>: die Marken sitzen an der rechten oberen Ecke ihrer Karte und zoomen mit */
export function PunkteMarken() {
  const boardId = useBoard((s) => s.activeId);
  const showArchived = useBoard((s) => s.showArchived);
  // nur neu rechnen, wenn sich an den Punkten etwas geändert hat
  const kennung = useBoard((s) => (selectActiveBoard(s)?.nodes ?? []).map((n) => {
    const z = punkteZahl(n.data);
    return z && (showArchived || !n.archived) ? `${n.id}:${z}:${hatPunktVon(n.data, punkteIch(s.activeId)) ? 1 : 0}` : '';
  }).filter(Boolean).join('|'));
  if (!kennung) return null;
  return (
    <>
      {kennung.split('|').map((e) => {
        const [id, zahl, mein] = e.split(':');
        return <Marke key={id} id={id} zahl={Number(zahl)} mein={mein === '1'} boardId={boardId} />;
      })}
    </>
  );
}

const etikett = (n: AppNode): string =>
  ((nodeToText(n).split('\n').find((l) => l.trim()) ?? n.type ?? 'Karte').replace(/^[#\-*\d.\s☐☑]+/, '').slice(0, 70)) || 'Karte';

export function PunkteLeiste() {
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(PUNKTE_MODUS, auf);
    return () => window.removeEventListener(PUNKTE_MODUS, auf);
  }, []);
  const an = punkteModus();
  const boardId = useBoard((s) => s.activeId);
  const nurLesen = useBoard(selectNurLesen);
  const nodes = useBoard((s) => selectActiveBoard(s)?.nodes);
  const [rang, setRang] = useState(false);
  const ich = punkteIch(boardId);
  const liste = useMemo(() => (an ? (nodes ?? []).filter((n) => !n.archived && punkteZahl(n.data) > 0)
    .map((n) => ({ id: n.id, zahl: punkteZahl(n.data), mein: hatPunktVon(n.data, ich), name: etikett(n) }))
    .sort((a, b) => b.zahl - a.zahl || a.name.localeCompare(b.name, 'de')) : []), [an, nodes, ich]);

  // Board gewechselt: der Modus endet (er gehört zu dem, was man gerade vor sich hat)
  useEffect(() => () => punkteModusSetzen(false), [boardId]);
  useEffect(() => { if (!an) setRang(false); }, [an]);

  // Im Modus: Karte antippen = Punkt. Der Tipp wählt nicht aus, setzt keinen Cursor und zieht nichts.
  useEffect(() => {
    if (!an) return;
    const el = document.querySelector('.react-flow') as HTMLElement | null;
    if (!el) return;
    let ab: { x: number; y: number; id: string } | null = null;
    const karteVon = (e: Event): string | null => {
      const t = e.target as HTMLElement | null;
      if (!t || t.closest('.punkte-marke')) return null;
      return (t.closest('.react-flow__node') as HTMLElement | null)?.dataset.id ?? null;
    };
    const runter = (e: PointerEvent) => {
      const id = karteVon(e);
      if (!id || e.button > 0) return;
      ab = { x: e.clientX, y: e.clientY, id };
      e.stopPropagation(); e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    const hoch = (e: PointerEvent) => {
      const a = ab; ab = null;
      if (!a || Math.hypot(e.clientX - a.x, e.clientY - a.y) > 8) return;
      punktUmschalten(useBoard.getState().activeId, a.id);
    };
    const schlucken = (e: Event) => { if (karteVon(e)) { e.stopPropagation(); e.preventDefault(); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { punkteModusSetzen(false); e.stopPropagation(); } };
    el.addEventListener('pointerdown', runter, true);
    el.addEventListener('mousedown', schlucken, true);
    el.addEventListener('click', schlucken, true);
    el.addEventListener('dblclick', schlucken, true);
    window.addEventListener('pointerup', hoch, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      el.removeEventListener('pointerdown', runter, true);
      el.removeEventListener('mousedown', schlucken, true);
      el.removeEventListener('click', schlucken, true);
      el.removeEventListener('dblclick', schlucken, true);
      window.removeEventListener('pointerup', hoch, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [an]);

  if (!an) return null;
  const meine = liste.filter((e) => e.mein).length;
  const gesamt = liste.reduce((s, e) => s + e.zahl, 0);
  const zuruecksetzen = () => {
    if (!window.confirm(`Alle ${gesamt} Punkte auf diesem Board entfernen?`)) return;
    const st = useBoard.getState();
    const board = st.boards.find((b) => b.id === boardId);
    if (!board) return;
    // jeder Punkt wird als „zurückgenommen" vermerkt — so bleibt er auch nach dem Abgleich weg
    mutedHistory(() => {
      for (const n of board.nodes) {
        const p = (n.data as { punkte?: Record<string, { n: number; t: number }> }).punkte;
        if (!p || !Object.values(p).some((x) => x.n > 0)) continue;
        const neu: Record<string, { n: number; t: number }> = {};
        for (const [k, v] of Object.entries(p)) neu[k] = v.n > 0 ? { n: 0, t: Math.max(Date.now(), v.t + 1) } : v;
        st.updateNodeData(n.id, { punkte: neu });
      }
    });
    st.showToast('Alle Punkte entfernt.');
  };
  return (
    <div className="punkte-leiste" role="toolbar" aria-label="Punkte vergeben" data-taste="punkte-leiste">
      <span className="punkte-leiste-text"><span className="punkte-punkt" aria-hidden="true" /> <b>Punkte vergeben</b> — Karte antippen</span>
      <span className="punkte-leiste-zahl" data-taste="punkte-stand">deine: <b>{meine}</b> · gesamt: <b>{gesamt}</b></span>
      <span className="punkte-rang-wrap">
        <button className={rang ? 'an' : ''} aria-expanded={rang} disabled={liste.length === 0} onClick={() => setRang((o) => !o)} data-taste="punkte-rang-auf">Rangliste</button>
        {rang && (
          <div className="punkte-rang" role="list" data-taste="punkte-rang">
            {liste.slice(0, 15).map((e, i) => (
              <button key={e.id} role="listitem" className="punkte-rang-zeile" data-taste="punkte-rang-zeile" data-karte={e.id} data-zahl={e.zahl}
                onClick={() => useBoard.getState().focusNode(boardId, e.id)} title="Zur Karte springen">
                <span className="punkte-rang-platz">{i + 1}.</span>
                <span className="punkte-rang-name" translate="no">{e.name}</span>
                <span className={`punkte-rang-zahl${e.mein ? ' mein' : ''}`}><span className="punkte-punkt" aria-hidden="true" />{e.zahl}</span>
              </button>
            ))}
            {liste.length > 15 && <div className="punkte-rang-mehr">… und {liste.length - 15} weitere</div>}
          </div>
        )}
      </span>
      {!nurLesen && <button className="leise" disabled={gesamt === 0} onClick={zuruecksetzen} data-taste="punkte-weg" title="Alle Punkte auf diesem Board entfernen">Zurücksetzen</button>}
      <button className="haupt" onClick={() => punkteModusSetzen(false)} data-taste="punkte-fertig">Fertig</button>
    </div>
  );
}
