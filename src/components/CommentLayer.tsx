import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInternalNode, useReactFlow, useStore, ViewportPortal } from '@xyflow/react';
import { selectActiveBoard, useBoard, type CommentThread } from '../store';
import { IPen, ITrash, IX } from './Icons';
import { wurzelZoom } from '../lib/anzeige';
import { blasenAn, SEITEN_EREIGNIS, seiteVon, seitenKommentare } from '../lib/pdfSeiten';

/** Verfasser-Name: rein lokal (localStorage), wandert NIE ohne den Kommentar */
const AUTHOR_KEY = 'pixinotes:author';
export const getAuthor = (): string => localStorage.getItem(AUTHOR_KEY) ?? '';
export const setAuthor = (name: string) => { try { localStorage.setItem(AUTHOR_KEY, name.trim().slice(0, 40)); } catch { /* Sitzung reicht */ } };

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

const timeOf = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('de-DE');
};

/** Ein Pin am oberen rechten Kartenrand — folgt der Karte live (M148) */
function CommentPin({ thread, nr }: { thread: CommentThread; nr?: number }) {
  const node = useInternalNode(thread.nodeId);
  const setCommentOpen = useBoard((s) => s.setCommentOpen);
  const openId = useBoard((s) => s.commentOpen);
  if (!node) return null; // Karte existiert (noch) nicht — Pin bleibt stumm
  const w = node.measured.width ?? 260;
  const last = thread.msgs[thread.msgs.length - 1];
  const erste = thread.msgs[0];
  // M335: Pin an einer STELLE auf einer PDF-Seite — nur sichtbar, wenn die Seite offen liegt
  let lage = { x: node.internals.positionAbsolute.x + w + 3, y: node.internals.positionAbsolute.y - 13 };
  const aufSeite = thread.seite != null && thread.px != null && thread.py != null;
  if (aufSeite) {
    const g = seiteVon(thread.nodeId);
    if (!g || g.seite !== thread.seite) return null;
    lage = { x: node.internals.positionAbsolute.x + g.dx + thread.px! * g.k - 13, y: node.internals.positionAbsolute.y + g.dy + thread.py! * g.k - 13 };
  }
  const oeffnen = (e: React.MouseEvent) => { e.stopPropagation(); setCommentOpen(thread.id); };
  return (
    <>
      <button
        className={`comment-pin nodrag nopan ${thread.resolved ? 'resolved' : ''} ${openId === thread.id ? 'open' : ''} ${aufSeite ? 'auf-seite' : ''}`}
        data-seite={thread.seite}
        data-nr={nr}
        // BEWUSST rechts AUSSERHALB der Ecke: genau auf der Ecke säße der Pin
        // über dem ✕-Löschknopf der ausgewählten Karte (E2E-Fund M148)
        style={{ transform: `translate(${lage.x}px, ${lage.y}px)` }}
        title={thread.resolved ? 'Erledigter Kommentar (Klick zum Öffnen)' : `Kommentar von ${last?.author ?? '?'} (Klick zum Öffnen)`}
        onClick={oeffnen}
      >
        {/* M336: Auf einer Seite zählt der Pin durch (1, 2, 3 …) — dieselbe Nummer steht in der Liste unter der Seite */}
        {thread.resolved ? '✓' : aufSeite && nr ? nr : initials(last?.author ?? '?')}
        {!thread.resolved && thread.msgs.length > 1 && <span className="comment-pin-count">{thread.msgs.length}</span>}
      </button>
      {/* M336: Textblase neben dem Seiten-Pin — Verfasser und Anfang des Kommentars, ohne Klick lesbar */}
      {aufSeite && blasenAn() && erste && (
        <div
          className={`comment-blase nodrag nopan ${thread.resolved ? 'resolved' : ''} ${openId === thread.id ? 'open' : ''}`}
          style={{ transform: `translate(${lage.x + 28}px, ${lage.y - 2}px)` }}
          onClick={oeffnen}
          role="button"
          title="Kommentar öffnen"
        >
          <b>{erste.author}</b>{thread.msgs.length > 1 ? ` · ${thread.msgs.length} Beiträge` : ''}
          <span className="comment-blase-text">{erste.text.length > 80 ? `${erste.text.slice(0, 78)}…` : erste.text}</span>
        </div>
      )}
    </>
  );
}

/** Schwebendes Gesprächs-Panel für den offenen Thread bzw. einen neuen Kommentar */
function CommentPanel() {
  const openId = useBoard((s) => s.commentOpen);
  const setCommentOpen = useBoard((s) => s.setCommentOpen);
  const addCommentMsg = useBoard((s) => s.addCommentMsg);
  const toggleCommentResolved = useBoard((s) => s.toggleCommentResolved);
  const removeCommentThread = useBoard((s) => s.removeCommentThread);
  const board = useBoard(selectActiveBoard);
  const [name, setName] = useState(getAuthor());
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  // M362: Beitrag, der gerade bearbeitet wird (Verfasser + Zeitpunkt), und sein Entwurf
  const editCommentMsg = useBoard((s) => s.editCommentMsg);
  const removeCommentMsg = useBoard((s) => s.removeCommentMsg);
  const [bearbeite, setBearbeite] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState('');
  useEffect(() => { setBearbeite(null); }, [openId]);

  const isNew = openId?.startsWith('new:') ?? false;
  const thread = isNew ? null : (board.comments ?? []).find((c) => c.id === openId);
  const nodeId = isNew ? openId!.slice(4) : thread?.nodeId;

  /**
   * M263: Die Blase steht AN der Karte, nicht in der Ecke des Fensters.
   *
   * Vorher lag das Gespräch fest oben rechts — bei einer Karte unten links
   * musste man zwischen Fähnchen und Text hin- und herschauen und hatte
   * keinen Anhaltspunkt, zu welcher Karte der Kommentar gehört
   * (User-Screenshot). Jetzt wird die Bildschirmposition der Karte
   * ausgerechnet und die Blase daneben gesetzt — sie folgt beim Schwenken
   * und Zoomen mit, behält aber ihre Lesegröße (der Text soll nicht
   * mitzoomen, sonst ist er bei 40 % Zoom unlesbar).
   */
  const rf = useReactFlow();
  const transform = useStore((s) => s.transform);
  const node = useInternalNode(nodeId ?? '');
  const blaseRef = useRef<HTMLDivElement | null>(null);
  const [lage, setLage] = useState<{ left: number; top: number; seite: 'rechts' | 'links' } | null>(null);
  useLayoutEffect(() => {
    // Am Telefon ist für eine Blase neben der Karte kein Platz — dort bleibt
    // es beim festen Blatt am Rand (CSS), also gar nicht erst rechnen.
    if (!node || document.body.offsetWidth < 620) { setLage(null); return; }
    const w = node.measured.width ?? 260;
    const p = node.internals.positionAbsolute;
    /**
     * M268: Alles in LAYOUT-Punkten rechnen.
     *
     * Die Blase hängt als Portal am `body` — dort zählen Layout-Punkte. Was
     * hier gemessen wird (Bildschirmposition der Karte, eigene Größe,
     * Fenstermaße), kommt dagegen in Bildpunkten und trägt bei „Anzeige
     * 130 %" den Wurzel-Zoom. Ungeteilt stand die Blase mit jedem Prozent
     * weiter neben ihrer Karte.
     */
    const z = wurzelZoom();
    const box = blaseRef.current?.getBoundingClientRect();
    const bw = box ? box.width / z : 330;
    const bh = box ? box.height / z : 220;
    const rechtsOben = rf.flowToScreenPosition({ x: p.x + w, y: p.y });
    const linksOben = rf.flowToScreenPosition({ x: p.x, y: p.y });
    const schirmB = window.innerWidth / z;
    const schirmH = window.innerHeight / z;
    const rand = 12;
    let seite: 'rechts' | 'links' = 'rechts';
    let left = rechtsOben.x / z + 16;
    if (left + bw > schirmB - rand) {
      const alternativ = linksOben.x / z - bw - 16;
      if (alternativ >= rand) { left = alternativ; seite = 'links'; }
      else left = Math.max(rand, schirmB - bw - rand);
    }
    const top = Math.min(Math.max(rand, rechtsOben.y / z - 8), Math.max(rand, schirmH - bh - rand));
    setLage({ left, top, seite });
  }, [node, transform, rf, thread?.msgs.length, isNew]);

  // Neue Nachrichten: ans Ende scrollen
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [thread?.msgs.length]);

  if (!openId || (!isNew && !thread)) return null;

  const send = () => {
    if (!text.trim()) return;
    setAuthor(name);
    const ort = useBoard.getState().commentOrt; // M335: Stelle auf einer PDF-Seite, wenn von der Karte gesetzt
    const tid = addCommentMsg(thread ? { threadId: thread.id } : { nodeId, ...(ort ?? {}) }, name, text);
    setText('');
    if (isNew && tid) setCommentOpen(tid); // frisch eröffneter Thread bleibt offen
  };

  return createPortal(
    <div
      className={`comment-panel ${lage ? 'an-karte' : 'fest'}`}
      ref={blaseRef}
      data-seite={lage?.seite}
      style={lage ? { left: lage.left, top: lage.top } : undefined}
      role="dialog"
      aria-label="Kommentare"
    >
      <div className="comment-panel-head">
        <b>{isNew ? 'Neuer Kommentar' : 'Kommentare'}</b>
        {/* M336: Zu welcher Seite gehört das Gespräch? */}
        {(thread?.seite ?? useBoard.getState().commentOrt?.seite) != null && (
          <span className="comment-seite" data-taste="kommentar-seite">Seite {thread?.seite ?? useBoard.getState().commentOrt?.seite}</span>
        )}
        <span className="comment-panel-tools">
          {thread && (
            <>
              <button onClick={() => toggleCommentResolved(thread.id)} title={thread.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'}>
                {thread.resolved ? 'Wieder öffnen' : 'Erledigt'}
              </button>
              <button
                className="danger"
                title="Thread komplett löschen"
                onClick={() => { if (window.confirm('Diesen Kommentar-Thread löschen?')) removeCommentThread(thread.id); }}
              >
                Löschen
              </button>
            </>
          )}
          <button onClick={() => setCommentOpen(null)} aria-label="Schließen"><IX size={13} /></button>
        </span>
      </div>
      {thread && (
        <div className="comment-msgs" ref={listRef}>
          {thread.msgs.map((m) => {
            const k = `${m.author}\u0000${m.at}`;
            const speichern = () => { if (entwurf.trim()) editCommentMsg(thread.id, m.at, m.author, entwurf); setBearbeite(null); };
            return (
              <div className={`comment-msg ${bearbeite === k ? 'bearbeiten' : ''}`} key={k}>
                <span className="comment-msg-meta">
                  <span><b>{m.author}</b> · {timeOf(m.at)}{m.bearbeitet ? <span title={`Bearbeitet am ${new Date(m.bearbeitet).toLocaleString('de-DE')}`}> · bearbeitet</span> : null}</span>
                  {bearbeite !== k && (
                    <span className="comment-msg-tools">
                      <button onClick={() => { setBearbeite(k); setEntwurf(m.text); }} title="Kommentar bearbeiten" aria-label="Kommentar bearbeiten" data-taste="kommentar-bearbeiten"><IPen size={12} /></button>
                      <button className="danger" title="Diesen Beitrag löschen" aria-label="Diesen Beitrag löschen" data-taste="kommentar-beitrag-loeschen"
                        onClick={() => { if (window.confirm(thread.msgs.length === 1 ? 'Diesen Kommentar löschen?' : 'Diesen Beitrag löschen?')) removeCommentMsg(thread.id, m.at, m.author); }}><ITrash size={12} /></button>
                    </span>
                  )}
                </span>
                {bearbeite === k ? (
                  <>
                    <textarea
                      className="comment-input" autoFocus value={entwurf} rows={Math.min(8, Math.max(2, entwurf.split('\n').length))}
                      aria-label="Kommentar bearbeiten" data-taste="kommentar-entwurf"
                      onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n); }}
                      onChange={(e) => setEntwurf(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); speichern(); }
                        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setBearbeite(null); }
                      }}
                    />
                    <span className="comment-msg-knoepfe">
                      <button onClick={() => setBearbeite(null)}>Abbrechen</button>
                      <button className="comment-send" disabled={!entwurf.trim()} onClick={speichern} data-taste="kommentar-speichern">Speichern</button>
                    </span>
                  </>
                ) : (
                  <span className="comment-msg-text" onDoubleClick={() => { setBearbeite(k); setEntwurf(m.text); }}>{m.text}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="comment-compose">
        {!getAuthor() && (
          <input
            className="comment-name"
            placeholder="Dein Name (für Kollegen sichtbar)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <textarea
          className="comment-input"
          placeholder={isNew ? (useBoard.getState().commentOrt ? 'Kommentar zu dieser Stelle…' : 'Kommentar zur Karte…') : 'Antworten…'}
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="comment-send" disabled={!text.trim() || !name.trim()} onClick={send}>
          Senden
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Kommentar-Ebene (M148): Pins in Board-Koordinaten (ViewportPortal — zoomt
 * und schwenkt mit), das Gesprächs-Panel als fixes Overlay. Kommentare leben
 * im Board-Dokument und wandern so im Sync-Ordner UND im Team-Projekt mit.
 */
export function CommentLayer() {
  const board = useBoard(selectActiveBoard);
  const threads = board.comments ?? [];
  // M335: Blättert eine PDF-Karte, wandern oder verschwinden ihre Seiten-Pins
  const [, seitenTakt] = useState(0);
  useEffect(() => {
    const auf = () => seitenTakt((n) => n + 1);
    window.addEventListener(SEITEN_EREIGNIS, auf);
    return () => window.removeEventListener(SEITEN_EREIGNIS, auf);
  }, []);
  return (
    <>
      <ViewportPortal>
        {threads.map((t) => (
          <CommentPin key={t.id} thread={t}
            nr={t.seite != null ? seitenKommentare(threads, t.nodeId, t.seite).findIndex((c) => c.id === t.id) + 1 : undefined} />
        ))}
      </ViewportPortal>
      <CommentPanel />
    </>
  );
}
