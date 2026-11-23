// M477: Die Hülle einer Notiz im Live-Board — allein oder gemeinsam? (nachgeladen von NoteCard, nur wenn ein Kanal steht)
//
// Ohne Live-Kanal sieht NoteCard diese Datei nie (Start-Paket unverändert, M446). Im Live-Board wechselt der Editor in
// „gemeinsam", sobald man die Notiz betritt oder ein anderer in ihr arbeitet (lib/notizGemeinsam.ts) — erst dann
// entsteht eine Yjs-Sitzung (lib/notizGemeinsamKern.ts). Gewechselt wird nie unter dem Cursor: zwischen zwei Editoren
// steht kurz die ruhende Ansicht (gleicher Umbruch, der Klick setzt danach den Cursor an dieselbe Stelle), so sichert
// der alte sauber, bevor der neue liest.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { selectActiveBoard, useBoard, useKarteFest } from '../../store';
import type { NoteNode } from '../../types';
import { liveVerbunden, TEILNEHMER_EREIGNIS } from '../../lib/liveStand';
import { gemeinsamGewuenscht, gemeinsamKern, NOTIZ_Y_WACH } from '../../lib/notizGemeinsam';
import type { NotizSitzung } from '../../lib/notizGemeinsamKern';
import { repairBlocks } from '../../lib/htmlBlocks';
import { NotizRuhend } from './NotizRuhend';
import type { RuheBlock } from '../../lib/notizRuhend';
import { NotizEditor } from './NoteCard';
import { noteSchema } from '../NoteTypo';

type Modus =
  | { art: 'allein'; fokus?: boolean }
  | { art: 'pause'; danach: 'allein' | 'laedt'; fokus: boolean }
  | { art: 'laedt'; fokus: boolean }
  | { art: 'gemeinsam'; s: NotizSitzung; fokus: boolean };

/** Kanal steht? Rechnet neu, sobald er auf- oder zugeht oder sich die Runde ändert */
function useLive(boardId: string): boolean {
  const [live, setLive] = useState(() => liveVerbunden(boardId));
  useEffect(() => {
    setLive(liveVerbunden(boardId));
    const auf = () => setLive(liveVerbunden(boardId));
    window.addEventListener(TEILNEHMER_EREIGNIS, auf);
    return () => window.removeEventListener(TEILNEHMER_EREIGNIS, auf);
  }, [boardId]);
  return live;
}

export default function NotizGemeinsam({ id, data, startPunkt }: { id: string; data: NoteNode['data']; startPunkt: MutableRefObject<{ x: number; y: number } | null> }) {
  const boardId = useBoard((s) => s.activeId);
  const live = useLive(boardId);
  const nurLesen = useKarteFest((data as { von?: string }).von);
  const nurLesenRef = useRef(nurLesen); nurLesenRef.current = nurLesen;
  /** Der Yjs-Teil lädt nicht: allein weiter, mit Karten-Sperre wie vor M477 */
  const kernKaputt = useRef(false);
  const [modus, setModus] = useState<Modus>(() => (live && (startPunkt.current || gemeinsamGewuenscht(boardId, id)) ? { art: 'laedt', fokus: false } : { art: 'allein' }));
  const huelle = useRef<HTMLDivElement>(null);
  const gemeinsam = modus.art === 'laedt' || modus.art === 'gemeinsam';
  const fokussiert = (): boolean => !!huelle.current?.contains(document.activeElement);

  /** Betreten (Klick oder Tastatur) im Live-Board: gemeinsam weiter */
  const wechselt = useRef(false);
  const betreten = (p: { x: number; y: number } | null) => {
    if (!live || kernKaputt.current || modus.art !== 'allein' || wechselt.current) return;
    wechselt.current = true;
    if (p) startPunkt.current = p;
    setModus({ art: 'pause', danach: 'laedt', fokus: !p });
  };
  useEffect(() => { if (modus.art !== 'pause') wechselt.current = false; }, [modus.art]);
  // Jemand anderes arbeitet in dieser Notiz: mitsehen (nicht, wenn ich gerade selbst im Editor bin)
  useEffect(() => {
    if (!live || modus.art !== 'allein') return;
    const auf = (e: Event) => {
      const d = (e as CustomEvent<{ boardId?: string; nodeId?: string }>).detail;
      if (d?.boardId !== boardId || d.nodeId !== id || fokussiert() || kernKaputt.current) return;
      setModus({ art: 'pause', danach: 'laedt', fokus: false });
    };
    window.addEventListener(NOTIZ_Y_WACH, auf);
    return () => window.removeEventListener(NOTIZ_Y_WACH, auf);
  }, [live, modus.art, boardId, id]);
  // Kanal weg: zurück zu allein — sobald der Cursor die Notiz verlassen hat
  useEffect(() => {
    if (live || !gemeinsam) return;
    const pruefen = () => { if (!fokussiert()) setModus({ art: 'pause', danach: 'allein', fokus: false }); };
    pruefen();
    const spaeter = () => setTimeout(pruefen, 0);
    document.addEventListener('focusout', spaeter, true);
    return () => document.removeEventListener('focusout', spaeter, true);
  }, [live, gemeinsam]);
  useEffect(() => {
    if (modus.art !== 'pause') return;
    const danach = modus.danach; const fokus = modus.fokus;
    const t = setTimeout(() => setModus(danach === 'laedt' ? { art: 'laedt', fokus } : { art: 'allein' }), 0);
    return () => clearTimeout(t);
  }, [modus]);
  useEffect(() => {
    if (modus.art !== 'laedt') return;
    let weg = false;
    const fokus = modus.fokus;
    const blocks = (selectActiveBoard(useBoard.getState()).nodes.find((n) => n.id === id)?.data.blocks ?? []) as unknown[];
    gemeinsamKern()
      // Auf den Stand der anderen wird nur gewartet, wo schon jemand arbeitet — sonst sofort (keine verschluckten Tasten)
      .then((k) => k.sitzungOeffnen(boardId, id, repairBlocks(blocks), noteSchema, !nurLesenRef.current, gemeinsamGewuenscht(boardId, id)))
      .then((s) => { if (weg) { s.schliessen(); return; } setModus({ art: 'gemeinsam', s, fokus }); })
      .catch(() => { kernKaputt.current = true; if (!weg) setModus({ art: 'allein', fokus }); });   // Yjs lädt nicht: allein, Cursor zurück
    return () => { weg = true; };
  }, [modus, boardId, id]);
  // Sitzung verlassen: zuerst sichern (wer Schreiber ist), dann zu
  useEffect(() => {
    if (modus.art !== 'gemeinsam') return;
    const s = modus.s;
    return () => { try { s.abschied(); } catch { /* egal */ } s.schliessen(); };
  }, [modus]);
  // Betreten per Tastatur (oder nach einem Rückweg): den Cursor in den neuen Editor setzen
  const fokusGewuenscht = (modus.art === 'gemeinsam' || modus.art === 'allein') && !!modus.fokus;
  useEffect(() => {
    if (!fokusGewuenscht) return;
    let n = 0;
    const t = setInterval(() => {
      const el = huelle.current?.querySelector('[contenteditable="true"]') as HTMLElement | null;
      if (el) { el.focus({ preventScroll: true }); clearInterval(t); } else if (++n > 20) clearInterval(t);
    }, 30);
    return () => clearInterval(t);
  }, [fokusGewuenscht, modus]);

  return (
    <div
      ref={huelle}
      className={`note-wahl${modus.art === 'gemeinsam' ? ' note-gemeinsam' : ''}`}
      // Im Live-Board nimmt das Schreiben in Notizen keine Karten-Sperre (lib/gastSync.ts) — außer auf dem Rückweg
      {...(kernKaputt.current ? {} : { 'data-ohne-sperre': '' })}
      onPointerDownCapture={(e) => { if (e.button === 0) betreten({ x: e.clientX, y: e.clientY }); }}
      onFocusCapture={() => betreten(null)}
    >
      {modus.art === 'allein' && <NotizEditor id={id} data={data} startPunkt={startPunkt} />}
      {modus.art === 'gemeinsam' && <NotizEditor key={modus.s.doc.clientID} id={id} data={data} startPunkt={startPunkt} sitzung={modus.s} />}
      {(modus.art === 'pause' || modus.art === 'laedt') && (
        <div className="nodrag nowheel note-editor" translate="no">
          <NotizRuhend blocks={data.blocks as RuheBlock[]} onHaken={() => { /* gleich wieder ein Editor */ }} />
        </div>
      )}
    </div>
  );
}
