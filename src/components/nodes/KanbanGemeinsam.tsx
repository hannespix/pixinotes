// M487: Titel und Beschreibung eines Kanban-Tickets gemeinsam tippen (nachgeladen von KanbanCard, nur im Live-Board)
//
// Das Ticket-Fenster ist kein Block-Editor, sondern zwei schlichte Felder. Je Feld ein Y.Text im Dokument der Kanban-
// Karte (lib/notizGemeinsamKern.ts `kanbanOeffnen`): Wer im selben Feld tippt, dessen Zeichen landen zeichengenau neben
// denen der anderen; unter dem Feld steht, wer gerade darin schreibt („Anna tippt …", in ihrer Teilnehmerfarbe).
// Gespeichert wird wie bisher das `items`-JSON der Karte, von genau einem Schreiber — vorher schrieb jeder die ganze
// Karte, und zwei, die zugleich zwei Tickets bearbeiteten, verloren im kartenweisen Abgleich eine der Änderungen.
//
// Eine Sitzung je Kanban-Karte und Gerät, solange ein Feld sie braucht (Titel und Beschreibung teilen sie).
import { useEffect, useRef, useState } from 'react';
import { gemeinsamGewuenscht, gemeinsamKern } from '../../lib/notizGemeinsam';
import type { FeldSitzung, Tippende } from '../../lib/notizGemeinsamKern';

interface Eintrag { laden: Promise<FeldSitzung>; anzahl: number; zu?: ReturnType<typeof setTimeout> }
const offen = new Map<string, Eintrag>();
function holen(boardId: string, nodeId: string, darf: boolean): Promise<FeldSitzung> {
  const key = `${boardId}\n${nodeId}`;
  let e = offen.get(key);
  if (!e) {
    const laden = gemeinsamKern().then((k) => k.kanbanOeffnen(boardId, nodeId, darf, gemeinsamGewuenscht(boardId, nodeId)));
    e = { laden, anzahl: 0 };
    offen.set(key, e);
    laden.catch(() => { if (offen.get(key) === e) offen.delete(key); });
  }
  clearTimeout(e.zu);
  e.anzahl += 1;
  return e.laden;
}
function loslassen(boardId: string, nodeId: string): void {
  const key = `${boardId}\n${nodeId}`;
  const e = offen.get(key);
  if (!e) return;
  e.anzahl -= 1;
  if (e.anzahl > 0) return;
  // Kurz warten: Wer das Ticket-Fenster schließt und gleich ein anderes öffnet, behält dieselbe Sitzung
  clearTimeout(e.zu);
  e.zu = setTimeout(() => {
    if (offen.get(key) !== e || e.anzahl > 0) return;
    offen.delete(key);
    void e.laden.then((s) => { try { s.abschied(); } catch { /* egal */ } s.schliessen(); }).catch(() => { /* nie offen */ });
  }, 400);
}

export interface KanbanFeldProps {
  boardId: string;
  nodeId: string;
  itemId: string;
  feld: 'text' | 'note';
  /** gespeicherter Text — der Anfang, falls das Feld im Dokument noch fehlt */
  wert: string;
  darf: boolean;
  className?: string;
  placeholder?: string;
  rows?: number;
  /** Der Yjs-Teil lädt nicht: das Ticket-Fenster nimmt wieder die gewohnten Felder */
  onAllein: () => void;
}

export default function KanbanFeld(p: KanbanFeldProps) {
  const { boardId, nodeId, itemId, feld, darf, onAllein } = p;
  const [s, setS] = useState<FeldSitzung | null>(null);
  const [tippende, setTippende] = useState<Tippende[]>([]);
  const el = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const key = `${itemId}:${feld}`;
  const wertRef = useRef(p.wert); wertRef.current = p.wert;
  const alleinRef = useRef(onAllein); alleinRef.current = onAllein;

  useEffect(() => {
    let weg = false;
    holen(boardId, nodeId, darf)
      .then((x) => { if (!weg) setS(x); })
      .catch(() => { if (!weg) alleinRef.current(); });
    return () => { weg = true; setS(null); loslassen(boardId, nodeId); };
  }, [boardId, nodeId, darf]);
  useEffect(() => {
    if (!s || !el.current) return;
    const loesen = s.feldBinden(el.current, key, wertRef.current);
    const auf = () => setTippende(s.tippende(key));
    auf();
    const ab = s.beiAnwesenheit(auf);
    return () => { ab(); loesen(); };
  }, [s, key]);

  const gemeinsam = {
    ref: el,
    className: p.className,
    placeholder: p.placeholder,
    'data-gemeinsam': s ? '' : undefined,
    // Bis die Sitzung steht: der gespeicherte Text, ohne Eingabe (sonst schriebe dieses Gerät an der Sitzung vorbei)
    ...(s ? { defaultValue: wertRef.current, readOnly: !darf } : { value: p.wert, readOnly: true }),
  };
  return (
    <>
      {feld === 'note'
        ? <textarea key={s ? 'g' : 'w'} rows={p.rows} {...gemeinsam} />
        : <input key={s ? 'g' : 'w'} {...gemeinsam} />}
      {tippende.length > 0 && (
        <span className={`feld-tippt feld-tippt-${feld}`} data-taste="feld-tippt" aria-live="polite">
          {tippende.map((t, i) => (
            <b key={i} style={t.farbe ? { color: t.farbe } : undefined} translate="no">{t.name}</b>
          ))}
          {tippende.length === 1 ? ' tippt …' : ' tippen …'}
        </span>
      )}
    </>
  );
}
