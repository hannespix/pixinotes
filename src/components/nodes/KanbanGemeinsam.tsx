// M487: Titel und Beschreibung eines Kanban-Tickets gemeinsam tippen (nachgeladen von KanbanCard, nur im Live-Board)
//
// Das Ticket-Fenster ist kein Block-Editor, sondern zwei schlichte Felder. Je Feld ein Y.Text im Dokument der Kanban-
// Karte (lib/notizGemeinsamKern.ts `kanbanOeffnen`): Wer im selben Feld tippt, dessen Zeichen landen zeichengenau neben
// denen der anderen; unter dem Feld steht, wer gerade darin schreibt („Anna tippt …", in ihrer Teilnehmerfarbe).
// Gespeichert wird wie bisher das `items`-JSON der Karte, von genau einem Schreiber — vorher schrieb jeder die ganze
// Karte, und zwei, die zugleich zwei Tickets bearbeiteten, verloren im kartenweisen Abgleich eine der Änderungen.
//
// Eine Sitzung je Kanban-Karte und Gerät, solange ein Feld sie braucht (Titel und Beschreibung teilen sie).
//
// M498: Die Sitzung trägt jetzt das ganze Kanban (Person, Frist, Checkliste, Spalte, Reihenfolge). `KanbanHalter` hält
// sie, sobald das Ticket-Fenster aufgeht ODER jemand anderes in dieser Karte arbeitet (Weckruf wie bei der Notiz), und
// meldet sie an der Brücke lib/kanbanLive.ts an — dann laufen alle Änderungen an Tickets dieses Geräts über das
// Y-Dokument, auch das Verschieben auf dem Board. Fremde Cursor stehen als schmaler Strich in ihrer Farbe im Feld.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gemeinsamGewuenscht, gemeinsamKern, NOTIZ_Y_WACH } from '../../lib/notizGemeinsam';
import type { FeldSitzung, Tippende } from '../../lib/notizGemeinsamKern';
import { kanbanLiveSetzen } from '../../lib/kanbanLive';
import { farbeAlsSchrift, lesbareSchrift, tokenFarbe, useThema } from '../../lib/lesbareSchrift';

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

/**
 * M498: Hält die Sitzung einer Kanban-Karte im Live-Board und meldet sie an der Brücke (lib/kanbanLive.ts) an — solange
 * das Ticket-Fenster offen ist oder jemand anderes in der Karte arbeitet. Einmal gehalten, bleibt sie, solange die Karte
 * zu sehen ist: Sonst sähe man nach dem Schließen kurz wieder den gespeicherten Stand, bis der Schreiber gesichert hat.
 */
export function KanbanHalter({ boardId, nodeId, darf, offen: fensterOffen }: { boardId: string; nodeId: string; darf: boolean; offen: boolean }) {
  const [geweckt, setGeweckt] = useState(() => gemeinsamGewuenscht(boardId, nodeId));
  useEffect(() => {
    const auf = (e: Event) => {
      const d = (e as CustomEvent<{ boardId?: string; nodeId?: string }>).detail;
      if (d?.boardId === boardId && d?.nodeId === nodeId) setGeweckt(true);
    };
    window.addEventListener(NOTIZ_Y_WACH, auf);
    return () => window.removeEventListener(NOTIZ_Y_WACH, auf);
  }, [boardId, nodeId]);
  const halten = useRef(false);
  if (geweckt || fensterOffen) halten.current = true;
  const an = halten.current;
  useEffect(() => {
    if (!an) return;
    let weg = false;
    let s: FeldSitzung | null = null;
    holen(boardId, nodeId, darf)
      .then((x) => { if (weg) return; s = x; x.darfSchreiben(darf); kanbanLiveSetzen(boardId, nodeId, x); })
      .catch(() => { /* Yjs lädt nicht: alles über den Speicher (das Ticket-Fenster meldet den Rückweg selbst) */ });
    return () => {
      weg = true;
      if (s) kanbanLiveSetzen(boardId, nodeId, null);
      loslassen(boardId, nodeId);
    };
  }, [an, boardId, nodeId, darf]);
  return null;
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

/** Wie lange der Name am fremden Cursor nach dessen letzter Bewegung stehen bleibt (wie in der Notiz) */
const NAME_MS = 2500;
interface Rechteck { x: number; y: number; w: number; h: number }
/**
 * M498: Wo steht im Feld die Stelle `a` (bzw. die Markierung a…k)? Über ein unsichtbares Spiegel-Element mit derselben
 * Schrift, denselben Abständen und demselben Umbruch — Eingabefelder verraten ihre Zeichenpositionen sonst nicht.
 * Koordinaten relativ zur Rahmenkante des Felds, das Scrollen ist schon abgezogen.
 */
function stellen(el: HTMLInputElement | HTMLTextAreaElement, a: number, k: number): { strich: Rechteck; flaeche: Rechteck[] } | null {
  const cs = getComputedStyle(el);
  const sp = document.createElement('div');
  const zeile = el.tagName === 'INPUT';
  for (const p of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
    'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle', 'fontFamily', 'fontSize',
    'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'letterSpacing', 'wordSpacing', 'lineHeight', 'textTransform', 'textIndent', 'tabSize'] as const) {
    (sp.style as unknown as Record<string, string>)[p] = cs[p] as string;
  }
  Object.assign(sp.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-99999px', overflow: 'hidden', height: 'auto',
    whiteSpace: zeile ? 'pre' : 'pre-wrap', overflowWrap: zeile ? 'normal' : 'break-word', borderColor: 'transparent',
  });
  if (zeile) sp.style.width = 'auto';
  const v = el.value;
  const von = Math.max(0, Math.min(v.length, Math.min(a, k)));
  const bis = Math.max(0, Math.min(v.length, Math.max(a, k)));
  const mark = document.createElement('span');
  // Ein unsichtbares Zeichen hält die leere Markierung (Cursor) an ihrer Stelle, auch am Zeilenende
  mark.textContent = bis > von ? v.slice(von, bis) : '​';
  sp.append(document.createTextNode(v.slice(0, von)), mark, document.createTextNode(`${v.slice(bis)}​`));
  document.body.append(sp);
  try {
    const r0 = sp.getBoundingClientRect();
    const rs = [...mark.getClientRects()];
    if (!rs.length) return null;
    // Einzeilige Felder setzen ihren Text senkrecht in die Mitte
    const dy = zeile ? (el.offsetHeight - sp.offsetHeight) / 2 : 0;
    const um = (r: DOMRect): Rechteck => ({ x: r.left - r0.left - el.scrollLeft, y: r.top - r0.top - el.scrollTop + dy, w: r.width, h: r.height });
    const erst = um(rs[0]);
    const vorne = a <= k;
    const ende = um(rs[rs.length - 1]);
    const strich = vorne && bis > von ? { x: ende.x + ende.w, y: ende.y, w: 0, h: ende.h } : { x: erst.x, y: erst.y, w: 0, h: erst.h };
    return { strich, flaeche: bis > von ? rs.map(um).filter((r) => r.w > 0.5) : [] };
  } finally { sp.remove(); }
}

export default function KanbanFeld(p: KanbanFeldProps) {
  const { boardId, nodeId, itemId, feld, darf, onAllein } = p;
  const [s, setS] = useState<FeldSitzung | null>(null);
  const [tippende, setTippende] = useState<Tippende[]>([]);
  const [, neuZeichnen] = useState(0);
  const el = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const key = `${itemId}:${feld}`;
  const wertRef = useRef(p.wert); wertRef.current = p.wert;
  const alleinRef = useRef(onAllein); alleinRef.current = onAllein;
  /** M498: wann sich der Cursor eines anderen zuletzt bewegt hat (für den Namen am Strich) */
  const bewegt = useRef(new Map<number, { a: number; k: number; t: number }>());
  useThema();   // Farben der Striche richten sich nach dem Thema

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
    // M498: Die Stelle der anderen hängt auch am Text (eigenes Tippen davor verschiebt sie) und am Scrollen des Felds
    const abText = s.bei(auf);
    const f = el.current;
    const tick = () => neuZeichnen((n) => n + 1);
    f.addEventListener('scroll', tick);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(tick) : null;
    ro?.observe(f);
    return () => { ab(); abText(); loesen(); f.removeEventListener('scroll', tick); ro?.disconnect(); };
  }, [s, key]);
  // Name am Strich nur kurz nach einer Bewegung — danach still (wie BlockNote in der Notiz)
  const jetzt = Date.now();
  for (const t of tippende) {
    const alt = bewegt.current.get(t.cid);
    if (!alt || alt.a !== t.a || alt.k !== t.k) bewegt.current.set(t.cid, { a: t.a, k: t.k, t: jetzt });
  }
  const naechster = tippende.map((t) => (bewegt.current.get(t.cid)?.t ?? 0) + NAME_MS - jetzt).filter((ms) => ms > 0);
  const bald = naechster.length ? Math.min(...naechster) : 0;
  useEffect(() => {
    if (!bald) return;
    const t = setTimeout(() => neuZeichnen((n) => n + 1), bald + 30);
    return () => clearTimeout(t);
  }, [bald, tippende]);
  // Positionen nach dem Zeichnen messen (das Feld steht dann mit seinem aktuellen Text)
  const [lagen, setLagen] = useState<Array<{ t: Tippende; l: ReturnType<typeof stellen> }>>([]);
  useLayoutEffect(() => {
    const f = el.current;
    if (!f || !s || !tippende.length) { if (lagen.length) setLagen([]); return; }
    const neu = tippende.map((t) => ({ t, l: stellen(f, t.a, t.k) }));
    if (JSON.stringify(neu) !== JSON.stringify(lagen)) setLagen(neu);
  });

  const gemeinsam = {
    ref: el,
    className: p.className,
    placeholder: p.placeholder,
    'data-gemeinsam': s ? '' : undefined,
    // Bis die Sitzung steht: der gespeicherte Text, ohne Eingabe (sonst schriebe dieses Gerät an der Sitzung vorbei)
    ...(s ? { defaultValue: wertRef.current, readOnly: !darf } : { value: p.wert, readOnly: true }),
  };
  const grund = tokenFarbe('--surface-card');
  const f = el.current;
  return (
    <>
      <span className={`feld-huelle feld-huelle-${feld}`}>
        {feld === 'note'
          ? <textarea key={s ? 'g' : 'w'} rows={p.rows} {...gemeinsam} />
          : <input key={s ? 'g' : 'w'} {...gemeinsam} />}
        {f && lagen.length > 0 && (
          <span
            className="feld-cursor-lage"
            aria-hidden="true"
            style={{ left: f.offsetLeft, top: f.offsetTop, width: f.offsetWidth, height: f.offsetHeight }}
          >
            {lagen.map(({ t, l }) => {
              // Was weggescrollt ist, zeigt keinen Strich (die Lage schneidet nicht ab — der Name darf über das Feld hinaus)
              const sichtbar = (r: Rechteck) => r.y + r.h > 1 && r.y < f.offsetHeight - 1 && r.x + r.w >= 0 && r.x <= f.offsetWidth;
              if (!l || !sichtbar(l.strich)) return null;
              // M498: der Strich in der Farbe der Person, so weit nachgedunkelt bzw. aufgehellt, dass er sich vom Feld abhebt
              const farbe = farbeAlsSchrift(t.farbe || '#6b7280', grund, 3);
              const name = (bewegt.current.get(t.cid)?.t ?? 0) + NAME_MS > jetzt;
              return (
                <span key={t.cid} className="feld-cursor" data-taste="feld-cursor" data-name={t.name}>
                  {l.flaeche.filter(sichtbar).map((r, i) => (
                    <i key={i} className="feld-cursor-markierung" style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: farbe }} />
                  ))}
                  <i className="feld-cursor-strich" style={{ left: l.strich.x, top: l.strich.y, height: l.strich.h, background: farbe }} />
                  {name && (
                    <b className="feld-cursor-name" translate="no" style={{ left: l.strich.x, top: l.strich.y, background: farbe, color: lesbareSchrift(farbe) }}>{t.name}</b>
                  )}
                </span>
              );
            })}
          </span>
        )}
      </span>
      {tippende.length > 0 && (
        <span className={`feld-tippt feld-tippt-${feld}`} data-taste="feld-tippt" aria-live="polite">
          {tippende.map((t) => (
            <b key={t.cid} style={t.farbe ? { color: farbeAlsSchrift(t.farbe, grund) } : undefined} translate="no">{t.name}</b>
          ))}
          {tippende.length === 1 ? ' tippt …' : ' tippen …'}
        </span>
      )}
    </>
  );
}
