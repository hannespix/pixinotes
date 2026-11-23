// M394: Kommentare in der Präsentation — die Gespräche zur Karte der Folie, lesen, antworten, neu schreiben.
//
// Das Gespräch des Boards (CommentLayer) hängt an der Karte auf dem Board; während der Präsentation gibt es das
// Board nicht. Diese Spalte zeigt dieselben Gespräche neben der Folie: bei einem Dokument die der offenen Seite
// (und einen Sprung zu den anderen Seiten), sonst die der Karte. Geschrieben wird über dieselben Wege des
// Speichers — was hier entsteht, steht danach auch auf dem Board.
import { useEffect, useMemo, useRef, useState } from 'react';
import { selectActiveBoard, useBoard, selectNurLesen } from '../store';
import { getAuthor, setAuthor } from '../lib/autor';
import { IX } from './Icons';

const zeit = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function FolienKommentare({ karte, seite, faden, onFaden, geheZu, zu }: {
  karte: string;
  /** offene Seite eines Dokuments — sonst null */
  seite: number | null;
  /** hervorgehobenes Gespräch (Tipp auf einen Pin) */
  faden: string | null;
  onFaden: (id: string | null) => void;
  geheZu: (seite: number) => void;
  zu: () => void;
}) {
  const comments = useBoard((s) => selectActiveBoard(s).comments);
  const nurLesen = useBoard(selectNurLesen);
  const addCommentMsg = useBoard((s) => s.addCommentMsg);
  const toggleCommentResolved = useBoard((s) => s.toggleCommentResolved);
  const [name, setName] = useState(getAuthor());
  const [text, setText] = useState('');
  const [antwort, setAntwort] = useState<string | null>(null);
  const liste = useRef<HTMLDivElement | null>(null);

  const alle = useMemo(() => (comments ?? []).filter((c) => c.nodeId === karte)
    .sort((a, b) => (a.msgs[0]?.at ?? '').localeCompare(b.msgs[0]?.at ?? '') || a.id.localeCompare(b.id)), [comments, karte]);
  const hier = seite == null ? alle : alle.filter((c) => c.seite == null || c.seite === seite);
  const woanders = useMemo(() => {
    const m = new Map<number, number>();
    if (seite != null) for (const c of alle) if (c.seite != null && c.seite !== seite) m.set(c.seite, (m.get(c.seite) ?? 0) + 1);
    return [...m].sort((a, b) => a[0] - b[0]);
  }, [alle, seite]);

  // andere Folie, andere Seite: Entwurf und Antwort-Ziel gehören nicht dorthin
  useEffect(() => { setAntwort(null); setText(''); }, [karte, seite]);
  useEffect(() => { if (antwort && !hier.some((c) => c.id === antwort)) setAntwort(null); }, [antwort, hier]);
  // das angetippte Gespräch in den Blick holen
  useEffect(() => {
    if (!faden) return;
    liste.current?.querySelector(`[data-faden="${faden}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [faden]);

  const senden = () => {
    if (!text.trim() || !name.trim()) return;
    setAuthor(name);
    let ziel: Parameters<typeof addCommentMsg>[0];
    // Seitenmaß, wie die Folie es zeigt — für die Stelle eines neuen Kommentars
    const roh = (document.querySelector('.presenter .folie-dok-seite') as HTMLElement | null)?.dataset.mass?.split(' ').map(Number);
    const mass = roh && roh[0] > 0 && roh[1] > 0 ? { b: roh[0], h: roh[1] } : null;
    if (antwort) ziel = { threadId: antwort };
    else if (seite != null && mass) {
      // wie auf dem Board: am rechten Rand der Seite, untereinander
      const dort = alle.filter((c) => c.seite === seite).length;
      ziel = { nodeId: karte, seite, px: Math.round(mass.b - 40), py: Math.round(Math.min(mass.h - 30, 36 + dort * 34)) };
    } else ziel = { nodeId: karte };
    const id = addCommentMsg(ziel, name, text);
    setText('');
    if (id) { onFaden(id); requestAnimationFrame(() => liste.current?.scrollTo({ top: liste.current.scrollHeight })); }
  };
  const antwortAn = antwort ? hier.find((c) => c.id === antwort) : null;

  return (
    <aside className="folien-kommentare" data-taste="folien-kommentare" role="complementary" aria-label="Kommentare zur Folie">
      <div className="fk-kopf">
        <b>Kommentare</b>
        {seite != null && <span className="fk-seite">Seite {seite}</span>}
        <button onClick={zu} aria-label="Kommentare schließen" data-taste="folien-kommentare-zu"><IX size={14} /></button>
      </div>
      <div className="fk-liste" ref={liste}>
        {hier.length === 0 && <p className="fk-leer">{seite != null ? 'Zu dieser Seite gibt es noch keinen Kommentar.' : 'Zu dieser Folie gibt es noch keinen Kommentar.'}</p>}
        {hier.map((c) => (
          <div key={c.id} data-faden={c.id} className={`fk-faden${c.resolved ? ' erledigt' : ''}${faden === c.id ? ' gewaehlt' : ''}${antwort === c.id ? ' antwort' : ''}`}
            onClick={() => onFaden(c.id)}>
            {c.msgs.map((m) => (
              <div className="fk-beitrag" key={`${m.author}\u0000${m.at}`}>
                <span className="fk-meta"><b translate="no">{m.author}</b> · {zeit(m.at)}</span>
                <span className="fk-text" translate="no">{m.text}</span>
              </div>
            ))}
            {!nurLesen && (
              <span className="fk-knoepfe">
                <button data-taste="folien-antworten" onClick={(e) => { e.stopPropagation(); setAntwort(antwort === c.id ? null : c.id); onFaden(c.id); }}>Antworten</button>
                <button data-taste="folien-erledigt" onClick={(e) => { e.stopPropagation(); toggleCommentResolved(c.id); }}>{c.resolved ? 'Wieder öffnen' : 'Erledigt'}</button>
              </span>
            )}
          </div>
        ))}
        {woanders.length > 0 && (
          <div className="fk-woanders">
            <span>Auf anderen Seiten:</span>
            {woanders.map(([s, n]) => (
              <button key={s} data-taste="folien-kommentar-seite" onClick={() => geheZu(s)} title={`Zu Seite ${s} blättern`}>Seite {s}{n > 1 ? ` (${n})` : ''}</button>
            ))}
          </div>
        )}
      </div>
      {!nurLesen && (
        <div className="fk-schreiben">
          {antwortAn && (
            <span className="fk-antwort-an">
              <span>Antwort an <b translate="no">{antwortAn.msgs[0]?.author}</b></span>
              <button onClick={() => setAntwort(null)} aria-label="Doch einen neuen Kommentar schreiben"><IX size={12} /></button>
            </span>
          )}
          {!getAuthor() && (
            <input className="fk-name" placeholder="Dein Name (für Kollegen sichtbar)" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <textarea
            className="fk-eingabe" data-taste="folien-kommentar-text" rows={2} value={text}
            placeholder={antwort ? 'Antworten…' : seite != null ? 'Kommentar zu dieser Seite…' : 'Kommentar zur Folie…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); senden(); } }}
          />
          <button className="fk-senden" data-taste="folien-kommentar-senden" disabled={!text.trim() || !name.trim()} onClick={senden}>Senden</button>
        </div>
      )}
    </aside>
  );
}
