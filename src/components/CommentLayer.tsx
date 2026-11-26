import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInternalNode, useReactFlow, useStore } from '@xyflow/react';
import { AnsichtPortal } from './AnsichtPortal';
import { selectActiveBoard, selectNurLesen, useBoard, type CommentThread } from '../store';
import { useKarteFestId } from '../store/selektoren';
import { drehe, winkelVon } from '../lib/drehung';
import { IPen, ITrash, IX } from './Icons';
import { wurzelZoom } from '../lib/anzeige';
import { blasenAn, SEITEN_EREIGNIS, seiteVon, seitenKommentare } from '../lib/pdfSeiten';

import { getAuthor, setAuthor } from '../lib/autor';
// M502: Verfasser-Name im leichten Teil (Start-Paket) — hier weitergereicht für alle bisherigen Importe
export { getAuthor, setAuthor } from '../lib/autor';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

const timeOf = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('de-DE');
};

/** M546: Ab wie vielen Bildpunkten aus einem Tipp ein Zug wird (Finger zittern mehr als Maus und Stift) */
const ZUG_AB = { maus: 4, finger: 9 };
const grenze = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * M546: Ein Zug an Pin oder Blase. `a`/`b` sind die Werte, die sich ändern: Seitenpunkte (`px/py`) eines Seiten-Pins,
 * Anteile an der Karte (`kx/ky`) eines Karten-Pins oder der Versatz der Blase (`bx/by`, Seitenpunkte). `sa/sb` =
 * Bildpunkte je Einheit, beim Anfassen einmal gemessen — gezogen wird ohne Messen und ohne Speichern; erst das
 * Loslassen schreibt (ein Rückgängig-Schritt).
 */
interface Zug {
  pid: number; art: 'pin' | 'blase'; x0: number; y0: number; sa: number; sb: number; grad: number;
  a0: number; b0: number; min: [number, number]; max: [number, number]; ab: number; bewegt: boolean;
}

/** Ein Pin am oberen rechten Kartenrand — folgt der Karte live (M148) */
function CommentPin({ thread, nr, werkzeug }: { thread: CommentThread; nr?: number; werkzeug: boolean }) {
  const node = useInternalNode(thread.nodeId);
  const setCommentOpen = useBoard((s) => s.setCommentOpen);
  const openId = useBoard((s) => s.commentOpen);
  const nurLesen = useBoard(selectNurLesen);
  const fest = useKarteFestId(thread.nodeId);
  const zugRef = useRef<Zug | null>(null);
  const [zug, setZug] = useState<{ art: 'pin' | 'blase'; a: number; b: number } | null>(null);
  const offenAm = useRef(0);
  if (!node) return null; // Karte existiert (noch) nicht — Pin bleibt stumm
  const w = node.measured.width ?? 260;
  const h = node.measured.height ?? 160;
  const last = thread.msgs[thread.msgs.length - 1];
  const erste = thread.msgs[0];
  // M546: verschieben darf, wer das Board bearbeiten darf — als Gast mit „nur Eigenes" an fremden Karten nur den eigenen Kommentar
  const darf = !nurLesen && (!fest || erste?.author === getAuthor());
  const ecke = node.internals.positionAbsolute;
  // M400: An der schrägen Karte sitzt der Pin an der gedrehten Ecke
  const grad = winkelVon(node as unknown as { winkel?: number });
  const mitte = { x: ecke.x + w / 2, y: ecke.y + h / 2 };
  const gedreht = (p: { x: number; y: number }) => (grad ? drehe(p, mitte, grad) : p);
  const aufSeite = thread.seite != null && thread.px != null && thread.py != null;
  const g = aufSeite ? seiteVon(thread.nodeId) : undefined;
  // M335: Pin an einer STELLE auf einer PDF-Seite — nur sichtbar, wenn die Seite offen liegt
  if (aufSeite && (!g || g.seite !== thread.seite)) return null;
  const pinZug = zug?.art === 'pin' ? zug : null;
  const blaseZug = zug?.art === 'blase' ? zug : null;
  // M546: verschobener Karten-Pin (kx/ky) — sonst rechts außerhalb der Ecke wie bisher
  const kx = pinZug && !aufSeite ? pinZug.a : thread.kx;
  const ky = pinZug && !aufSeite ? pinZug.b : thread.ky;
  const versetzt = !aufSeite && kx != null && ky != null;
  /** Die Stelle, auf die der Pin zeigt (Flächenpunkte) — um sie wächst und schrumpft er mit dem Zoom (M527) */
  let anker: { x: number; y: number };
  if (aufSeite && g) {
    const px = pinZug ? pinZug.a : thread.px!;
    const py = pinZug ? pinZug.b : thread.py!;
    anker = gedreht({ x: ecke.x + g.dx + px * g.k, y: ecke.y + g.dy + py * g.k });
  } else if (versetzt) anker = gedreht({ x: ecke.x + kx * w, y: ecke.y + ky * h });
  else anker = gedreht({ x: ecke.x + w + 16, y: ecke.y });
  const lage = { x: anker.x - 13, y: anker.y - 13 };
  const oeffnen = () => { offenAm.current = performance.now(); setCommentOpen(thread.id); };

  /** M546: Pin oder Blase anfassen — gemessen wird hier einmal, gezogen ohne weiteres Messen */
  const runter = (art: 'pin' | 'blase') => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation();
    const knoten = document.querySelector(`.react-flow__node[data-id="${CSS.escape(thread.nodeId)}"]`);
    const kasten = knoten?.getBoundingClientRect();
    const fl = kasten && kasten.width > 0 ? kasten.width / w : 0;   // Bildpunkte je Flächenpunkt (Zoom × Anzeige-Größe)
    if (!fl) return;
    const z = {
      pid: e.pointerId, art, x0: e.clientX, y0: e.clientY, grad: art === 'pin' ? grad : 0,
      ab: e.pointerType === 'touch' ? ZUG_AB.finger : ZUG_AB.maus, bewegt: false,
    };
    if (art === 'blase' && g) {
      // Liegt die Blase noch neben dem Pin, steht sie 15 Bildpunkte (× Zoom-Kehrwert) daneben — von dort geht es los
      const inv = parseFloat(getComputedStyle(e.currentTarget).getPropertyValue('--pn-inv')) || 1;
      const bx0 = thread.bx ?? (15 * inv) / g.k; const by0 = thread.by ?? (-15 * inv) / g.k;
      zugRef.current = { ...z, sa: fl * g.k, sb: fl * g.k, a0: bx0, b0: by0, min: [-g.breite, -g.hoehe], max: [g.breite, g.hoehe] };
    } else if (art === 'pin' && aufSeite && g) {
      zugRef.current = { ...z, sa: fl * g.k, sb: fl * g.k, a0: thread.px!, b0: thread.py!, min: [0, 0], max: [g.breite, g.hoehe] };
    } else if (art === 'pin') {
      zugRef.current = {
        ...z, sa: fl * w, sb: fl * h, a0: thread.kx ?? (w + 16) / w, b0: thread.ky ?? 0,
        min: [-16 / w, -16 / h], max: [1 + 16 / w, 1 + 16 / h],
      };
    } else return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetischer Zeiger — Ziehen geht trotzdem */ }
  };
  const wohin = (z: Zug, e: { clientX: number; clientY: number }): [number, number] => {
    let dx = e.clientX - z.x0; let dy = e.clientY - z.y0;
    if (z.grad) { const d = drehe({ x: dx, y: dy }, { x: 0, y: 0 }, -z.grad); dx = d.x; dy = d.y; }
    return [grenze(z.a0 + dx / z.sa, z.min[0], z.max[0]), grenze(z.b0 + dy / z.sb, z.min[1], z.max[1])];
  };
  const bewegt = (e: React.PointerEvent<HTMLElement>) => {
    const z = zugRef.current;
    if (!z || e.pointerId !== z.pid) return;
    if (!z.bewegt && Math.hypot(e.clientX - z.x0, e.clientY - z.y0) < z.ab) return;
    z.bewegt = true;
    e.stopPropagation();
    const [a, b] = wohin(z, e);
    setZug({ art: z.art, a, b });
  };
  const hoch = (e: React.PointerEvent<HTMLElement>) => {
    const z = zugRef.current;
    if (!z || e.pointerId !== z.pid) return;
    zugRef.current = null;
    e.stopPropagation();
    if (!z.bewegt) { oeffnen(); return; }
    offenAm.current = performance.now();   // der Klick nach dem Loslassen öffnet nicht
    const [a, b] = wohin(z, e);
    useBoard.getState().setCommentLage(thread.id, z.art === 'blase' ? { bx: a, by: b } : aufSeite ? { px: a, py: b } : { kx: a, ky: b });
    setZug(null);
  };
  const abbruch = () => { zugRef.current = null; setZug(null); };
  const klick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (performance.now() - offenAm.current < 700) return;   // Tipp oder Zug hat schon entschieden
    setCommentOpen(thread.id);
  };
  const zeiger = (art: 'pin' | 'blase') => (darf ? { onPointerDown: runter(art), onPointerMove: bewegt, onPointerUp: hoch, onPointerCancel: abbruch } : {});

  // M336/M546: Textblase — neben dem Pin, oder dort, wo sie hingelegt wurde (Versatz in Seitenpunkten, mit Linie)
  const blase = aufSeite && g && blasenAn() && erste;
  const bx = blaseZug ? blaseZug.a : thread.bx;
  const by = blaseZug ? blaseZug.b : thread.by;
  const weg = !!blase && bx != null && by != null;
  const ziel = weg && g ? { x: anker.x + bx! * g.k, y: anker.y + by! * g.k } : anker;
  const laenge = Math.hypot(ziel.x - anker.x, ziel.y - anker.y);
  return (
    <>
      <button
        className={`comment-pin nodrag nopan ${thread.resolved ? 'resolved' : ''} ${openId === thread.id ? 'open' : ''} ${aufSeite ? 'auf-seite' : ''} ${pinZug ? 'zieht' : ''} ${darf ? 'verschiebbar' : ''}`}
        data-seite={thread.seite}
        data-nr={nr}
        data-taste="kommentar-pin"
        translate="no"
        // BEWUSST rechts AUSSERHALB der Ecke: genau auf der Ecke säße der Pin
        // über dem ✕-Löschknopf der ausgewählten Karte (E2E-Fund M148)
        // M546: feste Bildschirm-Größe in jeder Zoomstufe (M527) — er wächst um die Stelle, auf die er zeigt
        style={{ transform: `translate(${lage.x}px, ${lage.y}px) scale(var(--pn-inv, 1))`, transformOrigin: aufSeite || versetzt ? '13px 13px' : '0 50%' }}
        title={thread.resolved ? 'Erledigter Kommentar (Klick zum Öffnen)' : `Kommentar von ${last?.author ?? '?'} (Klick zum Öffnen${darf ? ', ziehen zum Verschieben' : ''})`}
        onClick={klick}
        {...zeiger('pin')}
      >
        {/* M336: Auf einer Seite zählt der Pin durch (1, 2, 3 …) — dieselbe Nummer steht in der Liste unter der Seite */}
        {thread.resolved ? '✓' : aufSeite && nr ? nr : initials(last?.author ?? '?')}
        {!thread.resolved && thread.msgs.length > 1 && <span className="comment-pin-count">{thread.msgs.length}</span>}
      </button>
      {/* M546: Linie zur weggelegten Blase — immer da (nichts wird mitten im Zug eingehängt), sichtbar nur mit Versatz */}
      {blase && (
        <div
          className={`comment-blase-linie ${werkzeug ? 'durchlaessig' : ''}`}
          aria-hidden="true"
          style={{
            display: weg ? undefined : 'none', width: laenge,
            transform: `translate(${anker.x}px, ${anker.y}px) rotate(${Math.atan2(ziel.y - anker.y, ziel.x - anker.x)}rad)`,
          }}
        />
      )}
      {/* M336: Textblase neben dem Seiten-Pin — Verfasser und Anfang des Kommentars, ohne Klick lesbar */}
      {blase && (
        <div
          className={`comment-blase nodrag nopan ${thread.resolved ? 'resolved' : ''} ${openId === thread.id ? 'open' : ''} ${weg ? 'weg' : ''} ${blaseZug ? 'zieht' : ''} ${werkzeug ? 'durchlaessig' : ''} ${darf ? 'verschiebbar' : ''}`}
          // M546: Die Blase liest sich in Bildschirm-Größe, wächst beim Hineinzoomen aber nicht mit (sie verdeckte sonst immer mehr der Seite)
          style={{
            transform: weg
              ? `translate(${ziel.x}px, ${ziel.y}px) scale(min(1, var(--pn-inv, 1)))`
              : `translate(calc(${anker.x}px + 15px * var(--pn-inv, 1)), calc(${anker.y}px - 15px * var(--pn-inv, 1))) scale(min(1, var(--pn-inv, 1)))`,
          }}
          onClick={klick}
          // M546: Doppelklick legt eine weggelegte Blase wieder neben den Pin
          onDoubleClick={(e) => { e.stopPropagation(); if (weg && darf) useBoard.getState().setCommentLage(thread.id, { bx: null, by: null }); }}
          {...zeiger('blase')}
          role="button"
          data-taste="kommentar-blase"
          title={darf ? 'Kommentar öffnen – ziehen legt die Blase aus dem Weg' : 'Kommentar öffnen'}
        >
          <b translate="no">{erste.author}</b>{thread.msgs.length > 1 ? ` · ${thread.msgs.length} Beiträge` : ''}
          <span className="comment-blase-text" translate="no">{erste.text.length > 80 ? `${erste.text.slice(0, 78)}…` : erste.text}</span>
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
  // M388: … und der Antwort-Entwurf gehört zu SEINEM Faden — er wanderte sonst in den nächsten und wurde dort gesendet
  useEffect(() => { setBearbeite(null); setText(''); }, [openId]);

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
          {/* M546: Die Blase wurde aus dem Weg gelegt — hier kommt sie wieder neben den Pin */}
          {thread && thread.bx != null && board.geteiltRolle !== 'lesen' && (
            <button onClick={() => useBoard.getState().setCommentLage(thread.id, { bx: null, by: null })} title="Blase wieder neben den Pin legen" data-taste="kommentar-blase-zurueck">
              Blase zurück
            </button>
          )}
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
                  <span><b translate="no">{m.author}</b> · {timeOf(m.at)}{m.bearbeitet ? <span title={`Bearbeitet am ${new Date(m.bearbeitet).toLocaleString('de-DE')}`}> · bearbeitet</span> : null}</span>
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
                  <span className="comment-msg-text" translate="no" onDoubleClick={() => { setBearbeite(k); setEntwurf(m.text); }}>{m.text}</span>
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
  // M546: Stift, Textmarker oder Radierer in der Hand — die Blasen treten zurück, damit man sieht und erreicht, was darunter liegt
  const werkzeug = useBoard((s) => s.tool !== 'select');
  // M335: Blättert eine PDF-Karte, wandern oder verschwinden ihre Seiten-Pins
  const [, seitenTakt] = useState(0);
  useEffect(() => {
    const auf = () => seitenTakt((n) => n + 1);
    window.addEventListener(SEITEN_EREIGNIS, auf);
    return () => window.removeEventListener(SEITEN_EREIGNIS, auf);
  }, []);
  return (
    <>
      <AnsichtPortal>
        {threads.map((t) => (
          <CommentPin key={t.id} thread={t} werkzeug={werkzeug}
            nr={t.seite != null ? seitenKommentare(threads, t.nodeId, t.seite).findIndex((c) => c.id === t.id) + 1 : undefined} />
        ))}
      </AnsichtPortal>
      <CommentPanel />
    </>
  );
}
