// M487: Die Hülle des Protokolltexts im Live-Board — allein oder gemeinsam? (nachgeladen von MinutesCard, nur wenn ein
// Kanal steht)
//
// Wie die Notiz (NotizGemeinsam.tsx, M477), nur ohne das „Betreten": Eine Protokoll-Karte gibt es auf einem Board
// meist ein-, zweimal, und in einer Besprechung schreiben mehrere zugleich mit — darum öffnet die angezeigte Sitzung
// ihre Yjs-Sitzung gleich, sobald der Kanal steht. Gewechselt wird nie unter dem Cursor: Wer schon tippt, wenn der
// Kanal aufgeht, behält seinen Editor, bis er die Karte verlässt; dazwischen steht kurz die ruhende Ansicht, so sichert
// der alte Editor sauber, bevor der neue liest.
import { useEffect, useRef, useState } from 'react';
import { selectActiveBoard, useBoard, useNurLesen } from '../../store';
import { liveVerbunden, TEILNEHMER_EREIGNIS } from '../../lib/liveStand';
import { gemeinsamKern, NOTIZ_Y_WACH } from '../../lib/notizGemeinsam';
import type { ProtokollSitzung } from '../../lib/notizGemeinsamKern';
import { protokollLiveSetzen } from '../../lib/protokollLive';
import { repairBlocks } from '../../lib/htmlBlocks';
import type { MinutesData } from '../../types';
import { EntryEditor, ProtokollRuhend, type EntryEditorProps } from './MinutesCard';
import { noteSchema } from '../NoteTypo';

type Modus =
  | { art: 'allein' }
  | { art: 'pause'; danach: 'allein' | 'laedt' }
  | { art: 'laedt' }
  | { art: 'gemeinsam'; s: ProtokollSitzung };

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

export default function ProtokollGemeinsam(p: EntryEditorProps) {
  const { nodeId, entryId } = p;
  const boardId = useBoard((s) => s.activeId);
  const live = useLive(boardId);
  const nurLesen = useNurLesen();
  const nurLesenRef = useRef(nurLesen); nurLesenRef.current = nurLesen;
  /** Der Yjs-Teil lädt nicht: allein weiter, mit Karten-Sperre wie vor M487 */
  const kernKaputt = useRef(false);
  const [modus, setModus] = useState<Modus>(() => (live ? { art: 'laedt' } : { art: 'allein' }));
  const huelle = useRef<HTMLDivElement>(null);
  const gemeinsam = modus.art === 'laedt' || modus.art === 'gemeinsam';
  const fokussiert = (): boolean => !!huelle.current?.contains(document.activeElement);
  const n = `${nodeId}:${entryId}`;

  // Kanal da (oder wieder da): gemeinsam — sobald der Cursor nicht gerade im Protokoll steht
  useEffect(() => {
    if (!live || modus.art !== 'allein' || kernKaputt.current) return;
    const pruefen = () => { if (!fokussiert() && !kernKaputt.current) setModus({ art: 'pause', danach: 'laedt' }); };
    pruefen();
    const spaeter = () => setTimeout(pruefen, 0);
    document.addEventListener('focusout', spaeter, true);
    return () => document.removeEventListener('focusout', spaeter, true);
  }, [live, modus.art]);
  // Kanal weg: zurück zu allein — sobald der Cursor das Protokoll verlassen hat
  useEffect(() => {
    if (live || !gemeinsam) return;
    const pruefen = () => { if (!fokussiert()) setModus({ art: 'pause', danach: 'allein' }); };
    pruefen();
    const spaeter = () => setTimeout(pruefen, 0);
    document.addEventListener('focusout', spaeter, true);
    return () => document.removeEventListener('focusout', spaeter, true);
  }, [live, gemeinsam]);
  useEffect(() => {
    if (modus.art !== 'pause') return;
    const danach = modus.danach;
    const t = setTimeout(() => setModus(danach === 'laedt' ? { art: 'laedt' } : { art: 'allein' }), 0);
    return () => clearTimeout(t);
  }, [modus]);
  useEffect(() => {
    if (modus.art !== 'laedt') return;
    let weg = false;
    const node = selectActiveBoard(useBoard.getState()).nodes.find((x) => x.id === nodeId);
    const eintrag = ((node?.data as MinutesData | undefined)?.entries ?? []).find((e) => e.id === entryId);
    const blocks = eintrag?.blocks ?? [];
    gemeinsamKern()
      // M493: Immer kurz auf den Stand der anderen warten (nur wenn andere im Kanal sind). Das Protokoll öffnet sich
      // bei allen von selbst — wer nicht wartete, begann aus seinem gespeicherten Stand, während ein anderer schon
      // einen hatte; zwei Anfänge übereinander verloren unter Last den Text (m487 B5/B8). Die ruhende Ansicht steht so lange.
      .then((k) => k.protokollOeffnen(boardId, nodeId, entryId, repairBlocks(blocks as unknown[]), noteSchema, !nurLesenRef.current, true, eintrag?.decisions ?? [], eintrag?.infoTops ?? []))
      .then((s) => { if (weg) { s.schliessen(); return; } setModus({ art: 'gemeinsam', s }); })
      .catch(() => { kernKaputt.current = true; if (!weg) setModus({ art: 'allein' }); });   // Yjs lädt nicht: allein (mit Sperre)
    return () => { weg = true; };
  }, [modus, boardId, nodeId, entryId, n]);
  // Sitzung verlassen: zuerst sichern (wer Schreiber ist), dann zu
  useEffect(() => {
    if (modus.art !== 'gemeinsam') return;
    const s = modus.s;
    // M493: Die Karte zeigt und ändert die Beschlüsse dieser Sitzung jetzt über das Y-Dokument (lib/protokollLive.ts)
    // (nur, wenn das Dokument sie trägt — eines von einem Gerät mit älterer Fassung hat sie nicht, dann gilt der Speicher)
    const mit = s.mitBeschluessen();
    if (mit) protokollLiveSetzen(n, s);
    return () => { if (mit) protokollLiveSetzen(n, null); try { s.abschied(); } catch { /* egal */ } s.schliessen(); };
  }, [modus]);
  // Ein anderer schreibt in diesem Protokoll, während es hier noch allein läuft (Kanal kam eben erst): mitsehen,
  // sobald der Cursor frei ist — der Effekt oben erledigt das; der Weckruf beschleunigt nur
  useEffect(() => {
    if (!live || modus.art !== 'allein') return;
    const auf = (e: Event) => {
      const d = (e as CustomEvent<{ boardId?: string; nodeId?: string }>).detail;
      if (d?.boardId !== boardId || d.nodeId !== n || fokussiert() || kernKaputt.current) return;
      setModus({ art: 'pause', danach: 'laedt' });
    };
    window.addEventListener(NOTIZ_Y_WACH, auf);
    return () => window.removeEventListener(NOTIZ_Y_WACH, auf);
  }, [live, modus.art, boardId, n]);

  const blocksJetzt = () => {
    const node = selectActiveBoard(useBoard.getState()).nodes.find((x) => x.id === nodeId);
    return ((node?.data as MinutesData | undefined)?.entries ?? []).find((e) => e.id === entryId)?.blocks as unknown[] | undefined;
  };
  return (
    <div
      ref={huelle}
      className={`note-wahl protokoll-wahl${modus.art === 'gemeinsam' ? ' note-gemeinsam' : ''}`}
      // Im Live-Board nimmt das Schreiben im Protokolltext keine Karten-Sperre (lib/gastSync.ts) — außer auf dem Rückweg
      {...(kernKaputt.current ? {} : { 'data-ohne-sperre': '' })}
    >
      {modus.art === 'allein' && <EntryEditor {...p} blocks={blocksJetzt() ?? p.blocks} />}
      {modus.art === 'gemeinsam' && <EntryEditor key={modus.s.doc.clientID} {...p} sitzung={modus.s} />}
      {(modus.art === 'pause' || modus.art === 'laedt') && <ProtokollRuhend blocks={blocksJetzt() ?? p.blocks} />}
    </div>
  );
}
