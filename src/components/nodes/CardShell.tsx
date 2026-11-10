import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import { runDerived, selectActiveBoard, useBoard } from '../../store';
import { fernBeobachten } from '../../lib/fernRuhe';
import { rolleMelden } from '../../lib/notizText';
import { kachelInfo } from '../../lib/kachel';
import type { AppNode } from '../../types';

interface Props {
  id: string;
  className?: string;
  children: ReactNode;
  /** von NodeProps durchreichen — steuert Resize-Griffe & Controls */
  selected?: boolean;
  minWidth?: number;
  minHeight?: number;
  /** M155: freie Farben — z. B. eigene Notiz-Tönung überschreibt die Palette */
  style?: CSSProperties;
  /** M323: Darf die Auto-Größe auch SCHRUMPFEN, wenn Inhalt wegfällt? (Notizen) */
  schrumpft?: boolean;
  /** M339: Der Kartenkörper scrollt, wenn der Inhalt nicht hineinpasst (Notizen) — mit schlankem Balken */
  rollt?: boolean;
  /** M339: Bedienelemente AUF der Karte, die nicht mitscrollen (Farbpunkt der Notiz) */
  aussen?: ReactNode;
}

/** M339: So hoch wächst eine Notiz von selbst — darüber scrollt sie (von Hand lässt sie sich größer ziehen) */
const NOTIZ_MAX = 640;

/**
 * Gemeinsame Hülle aller Karten: Lösch-Knopf, Verbindungs-Handles und
 * Resize-Griffe an Ecken/Kanten (sichtbar bei Selektion).
 */
export function CardShell({ id, className, children, selected, minWidth = 170, minHeight = 70, style, schrumpft = false, rollt = false, aussen }: Props) {
  const removeNode = useBoard((s) => s.removeNode);
  const setNodeHeight = useBoard((s) => s.setNodeHeight);
  const setAutoFit = useBoard((s) => s.setAutoFit);
  const showToast = useBoard((s) => s.showToast);
  // Auto-Größe ist STANDARDMÄSSIG AN (M111) — false heißt: manuell gebrochen
  const autoFit = useBoard((s) => {
    const b = s.boards.find((x) => x.id === s.activeId);
    return (b?.nodes.find((n) => n.id === id)?.autoFit ?? true) !== false;
  });
  /**
   * M298: Als Kachel zeigt die Karte nur ihre Kennzahlen (lib/kachel.ts) —
   * außer im Fokus, dort steht das ganze Modul. Der Node bleibt derselbe,
   * nur der Inhalt der Hülle wechselt.
   */
  // M339: Notiz ohne feste Höhe (wächst mit dem Inhalt) — das Stylesheet deckelt sie bei NOTIZ_MAX
  const ohneHoehe = useBoard((s) => rollt && selectActiveBoard(s)?.nodes.find((x) => x.id === id)?.height == null);
  const kachelNode = useBoard((s) => {
    const n = selectActiveBoard(s)?.nodes.find((x) => x.id === id);
    return n?.kachel ? n : null;
  });
  const imFokus = useBoard((s) => s.focusCard === id);
  const imFokusRef = useRef(imFokus);
  imFokusRef.current = imFokus;
  const schrumpftRef = useRef(schrumpft);
  schrumpftRef.current = schrumpft;
  const rolltRef = useRef(rollt);
  rolltRef.current = rollt;
  // M323: Geschrumpft wird erst, nachdem jemand IN dieser Karte geschrieben hat —
  // nie beim bloßen Laden (Vorlagen, geteilte Boards und Beispiele behalten
  // ihre gesetzten Höhen, bis man sie anfasst)
  const bearbeitetRef = useRef(false);
  const alsKachel = !!kachelNode && !imFokus;
  const kachelRef = useRef(alsKachel);
  kachelRef.current = alsKachel || !!kachelNode;
  const setKachel = useBoard((s) => s.setKachel);
  const oeffneKarte = useBoard((s) => s.oeffneKarte);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);
  // Maus/Finger irgendwo auf der Karte gedrückt? Dann fasst KEINE Automatik
  // die Größe an — unabhängig davon, ob der Resize-Handler feuert (M106,
  // „manuell gewinnt immer", ohne jede Lücke)
  const pointerDownRef = useRef(false);
  // Aktueller autoFit-Wert ohne Stale-Closure-Risiko (Resize-Callbacks)
  const autoFitRef = useRef(autoFit);
  autoFitRef.current = autoFit;
  // Schonfrist nach manuellem Ziehen: in dieser Zeit fasst die Automatik
  // die Größe GARANTIERT nicht an (M104 — „manuell gewinnt immer")
  const lastResizeEnd = useRef(0);
  // Struktur-Erkennung (M106): Layouts mit 100%-Höhen „wachsen mit" — der
  // Überlauf schrumpft nach dem Wachsen nicht → nicht endlos weiterwachsen
  const lastDelta = useRef<number | null>(null);
  const evalRef = useRef<(() => void) | null>(null);

  // Begann der aktuelle Druck auf einem Resize-Griff? (M108-Sicherheitsnetz)
  const resizeGestureRef = useRef(false);

  // Pointer-Wache: down auf der Karte → Automatik pausiert; up → Schonfrist.
  // WICHTIG (M108): Unter Touch feuert onResizeEnd der Resize-Bibliothek
  // NICHT zuverlässig — die resizing-Sperre blieb dann für immer gesetzt
  // (Automatik komplett tot) und Auto-Größe brach beim Finger-Ziehen nicht.
  // Deshalb wird das Gesten-Ende hier zusätzlich auf Pointer-Ebene erkannt,
  // unabhängig von der Bibliothek. Doppelt ausgeführt ist alles idempotent.
  useEffect(() => {
    const shell = bodyRef.current?.parentElement;
    if (!shell) return;
    const down = (e: PointerEvent) => {
      pointerDownRef.current = true;
      resizeGestureRef.current = !!(e.target as Element | null)?.closest?.('.react-flow__resize-control');
      // M339: Gleich wird die Größe geändert — vorher festhalten, welche älteren Striche zum Text gehören
      if (resizeGestureRef.current && rolltRef.current) useBoard.getState().textStricheFestschreiben(id);
    };
    const up = () => {
      if (pointerDownRef.current) {
        pointerDownRef.current = false;
        lastResizeEnd.current = Date.now();
        if (resizeGestureRef.current) {
          resizeGestureRef.current = false;
          resizingRef.current = false; // Sicherheitsnetz: d3-„end" kann unter Touch ausbleiben
          if (autoFitRef.current) {
            setAutoFit([id], false);
            showToast('Auto-Größe aus, deine Größe bleibt.');
          }
          window.setTimeout(() => evalRef.current?.(), 900); // danach ggf. ⤢-Chip anbieten
        }
      }
    };
    shell.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      shell.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  /**
   * M339: Überlauf mit Scrollbalken. Der Kartenkörper scrollt selbst (CSS); hier entsteht der
   * schlanke Balken dazu — eigener Daumen statt der Leiste des Browsers, weil ein Zug an der
   * Browser-Leiste zugleich die Karte verschöbe. Lage und Größe werden direkt am Element gesetzt
   * (kein Render je Scrollschritt). Zwei Schatten zeigen, dass oben bzw. unten noch Text folgt.
   */
  const daumenRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!rollt) return;
    const body = bodyRef.current;
    const shell = body?.parentElement;
    const daumen = daumenRef.current;
    if (!body || !shell || !daumen) return;
    rolleMelden(id, body);
    let raf = 0;
    let merk = 0; // letzter Scrollstand — die Fern-Ruhe setzt ihn zurück, beim Wiederkommen wird er hergestellt
    const stand = () => {
      raf = 0;
      if (shell.hasAttribute('data-fern')) return;
      const max = body.scrollHeight - body.clientHeight;
      const an = max > 4;
      shell.toggleAttribute('data-rollt', an);
      if (!an) { merk = 0; shell.removeAttribute('data-mehr-oben'); shell.removeAttribute('data-mehr-unten'); return; }
      if (merk > 0 && body.scrollTop === 0) body.scrollTop = Math.min(merk, max);
      merk = body.scrollTop;
      const spur = body.clientHeight - 8;
      const hoehe = Math.max(28, Math.round((spur * body.clientHeight) / body.scrollHeight));
      daumen.style.height = `${hoehe}px`;
      daumen.style.transform = `translateY(${Math.round(4 + (spur - hoehe) * (body.scrollTop / max))}px)`;
      shell.toggleAttribute('data-mehr-oben', body.scrollTop > 2);
      shell.toggleAttribute('data-mehr-unten', body.scrollTop < max - 2);
    };
    const plan = () => { if (!raf) raf = requestAnimationFrame(stand); };
    const beimScrollen = () => { if (!shell.hasAttribute('data-fern')) merk = body.scrollTop; plan(); };
    body.addEventListener('scroll', beimScrollen, { passive: true });
    const ro = new ResizeObserver(plan);
    ro.observe(body);
    const mo = new MutationObserver(plan);
    mo.observe(body, { subtree: true, childList: true, characterData: true });
    const moFern = new MutationObserver(plan);
    moFern.observe(shell, { attributes: true, attributeFilter: ['data-fern'] });
    // Daumen ziehen: Zeigerweg → Scrollweg, im Maßstab des Boards
    let zug: { y: number; top: number } | null = null;
    const runter = (e: PointerEvent) => {
      e.preventDefault(); e.stopPropagation();
      daumen.setPointerCapture(e.pointerId);
      zug = { y: e.clientY, top: body.scrollTop };
      shell.setAttribute('data-rollzug', '');
    };
    const zieh = (e: PointerEvent) => {
      if (!zug) return;
      const k = body.clientHeight > 0 ? body.getBoundingClientRect().height / body.clientHeight : 1;
      const max = body.scrollHeight - body.clientHeight;
      const weg = Math.max(1, body.clientHeight - 8 - daumen.offsetHeight);
      body.scrollTop = zug.top + ((e.clientY - zug.y) / (k || 1)) * (max / weg);
    };
    const los = () => { zug = null; shell.removeAttribute('data-rollzug'); };
    daumen.addEventListener('pointerdown', runter);
    daumen.addEventListener('pointermove', zieh);
    daumen.addEventListener('pointerup', los);
    daumen.addEventListener('pointercancel', los);
    plan();
    return () => {
      rolleMelden(id, null);
      cancelAnimationFrame(raf);
      body.removeEventListener('scroll', beimScrollen);
      ro.disconnect(); mo.disconnect(); moFern.disconnect();
      daumen.removeEventListener('pointerdown', runter);
      daumen.removeEventListener('pointermove', zieh);
      daumen.removeEventListener('pointerup', los);
      daumen.removeEventListener('pointercancel', los);
      shell.removeAttribute('data-rollt');
    };
  }, [rollt, id, alsKachel]);
  // M338: Fern-Ruhe — weit außerhalb des Bildes wird der Inhalt nicht gerechnet (lib/fernRuhe.ts)
  useEffect(() => {
    const shell = bodyRef.current?.parentElement;
    return shell ? fernBeobachten(shell) : undefined;
  }, []);
  // Inhalt läuft über die feste Kartengröße hinaus → Einpassen ANBIETEN
  const [overflowing, setOverflowing] = useState(false);

  // Resize-Callbacks MÜSSEN referenzstabil sein (M109): React Flow zerstört
  // den d3-Drag des Griffs und bindet ihn neu, sobald sich die Callback-Props
  // ändern. Inline-Funktionen (neue Identität pro Render) killten so beim
  // ERSTEN Resize-Schritt die laufende Geste — unter Touch fror die Größe
  // ein („Pixel für Pixel"), unter Maus überlebte sie nur dank Window-Listenern.
  const onManualResizeStart = useCallback(() => { resizingRef.current = true; }, []);
  const onManualResizeEnd = useCallback(() => {
    resizingRef.current = false;
    lastResizeEnd.current = Date.now(); // Schonfrist gegen jede Automatik
    // Manuell gezogen schlägt Automatik: Auto-Größe bricht (M103/M104)
    if (autoFitRef.current) {
      setAutoFit([id], false);
      showToast('Auto-Größe aus, deine Größe bleibt.');
    }
    // Nach der Schonfrist einmal prüfen: läuft der Inhalt jetzt über,
    // erscheint der ⤢-Angebots-Chip (nur Angebot, kein Eingriff)
    window.setTimeout(() => evalRef.current?.(), 900);
  }, [id, setAutoFit, showToast]);

  /** Höhe einmalig an den Inhalt anpassen (⤢-Angebots-Chip, M104) */
  const fitOnce = () => {
    const body = bodyRef.current;
    if (!body) return;
    const delta = body.scrollHeight - body.clientHeight;
    if (delta <= 0) { setOverflowing(false); return; }
    lastDelta.current = delta; // Struktur-Erkennung: erneutes Angebot nur bei echter Änderung
    const shell = body.parentElement as HTMLElement | null;
    const current = shell?.offsetHeight ?? body.clientHeight;
    // (ausdrücklicher Wunsch: hier gilt der alte Deckel, auch für Notizen — und nie kleiner als jetzt)
    setNodeHeight(id, Math.max(current, Math.min(current + delta + 2, 860)));
    setOverflowing(false);
    evalRef.current?.(); // Nachkontrolle: lastDelta zurücksetzen, sobald behoben (M108)
  };

  // Auto-Größe (M103/M104): Bewusst zurückhaltend —
  // - gedrosselt (300 ms), nur bei echtem Überlauf (> 6 px): offene
  //   Untermenüs/Popovers werden nicht durch Dauer-Resizes gestört
  // - nur WACHSEN, nie schrumpfen — nichts springt unter dem Zeiger weg
  // - pausiert beim Ziehen + 800 ms Schonfrist danach (manuell gewinnt immer)
  // - OHNE Auto-Größe wird bei Überlauf nur der ⤢-Angebots-Chip eingeblendet
  // - Wachsen läuft als „abgeleitet" (Sync-Fast-Forward bleibt frei, M82)
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let t: number | undefined;
    const later = (ms: number, force = false) => { window.clearTimeout(t); t = window.setTimeout(() => evalNow(force), ms); };
    const evalNow = (force = false) => {
      // M298: Eine Kachel wächst nie — und im Fokus stellt das Stylesheet die
      // Größe; ein Wachsen dort bliebe nach dem Schließen an der Kachel hängen
      if (kachelRef.current) return;
      // M338: Ruht die Karte fern vom Bild, ist ihr Inhalt nicht vermessbar — nichts anfassen
      if (body.parentElement?.hasAttribute('data-fern')) return;
      // Sperren WARTEN statt verwerfen (M108): am Smartphone folgt fast jede
      // Inhaltsänderung direkt auf eine Berührung der Karte — wurde die
      // Prüfung hier einfach verworfen, kam nie wieder eine nach und die
      // Auto-Größe war unter Touch praktisch tot. Manuell gewinnt weiterhin:
      // gehandelt wird erst NACH Loslassen + Schonfrist.
      if (resizingRef.current || pointerDownRef.current) { later(400, force); return; }
      const rest = 800 - (Date.now() - lastResizeEnd.current);
      if (!force && rest > 0) { later(rest + 60); return; }
      // M323: Das offene „/"-Menü liegt IM Kartenkörper und blähte die Messung
      // auf — die Karte wuchs um die Menühöhe und blieb so (User-Screenshot).
      // Solange es offen ist, wird nicht gemessen.
      if (body.querySelector('.bn-suggestion-menu')) { later(400, force); return; }
      const delta = body.scrollHeight - body.clientHeight;
      /**
       * M323: Schrumpfen — nur für Karten, die es erlauben (Notizen), nur wenn
       * niemand gerade darin schreibt (sonst springt der Text unter dem Cursor
       * weg) und nicht im Fokus (dort stellt das Stylesheet die Größe).
       * scrollHeight sinkt nie unter clientHeight, deshalb wird der Inhalt
       * selbst vermessen: Unterkante des letzten Kindes, bereinigt um den Zoom.
       */
      if (autoFitRef.current && schrumpftRef.current && bearbeitetRef.current && !imFokusRef.current && !body.contains(document.activeElement)) {
        const shell = body.parentElement as HTMLElement | null;
        const rb = body.getBoundingClientRect();
        const massstab = body.clientHeight > 0 ? rb.height / body.clientHeight : 1;
        let unten = rb.top;
        for (const k of Array.from(body.children)) unten = Math.max(unten, k.getBoundingClientRect().bottom);
        const inhalt = (unten - rb.top) / (massstab || 1) + 10;
        const rahmen = (shell?.offsetHeight ?? body.clientHeight) - body.clientHeight;
        const ziel = Math.max(minHeight, Math.ceil(inhalt + rahmen));
        const jetzt = shell?.offsetHeight ?? 0;
        if (delta <= 6 && jetzt - ziel > 40) {
          lastDelta.current = null;
          runDerived(() => setNodeHeight(id, ziel));
          later(350);
          return;
        }
      }
      // Struktur-Erkennung: Überlauf blieb nach dem letzten Wachsen gleich →
      // 100%-Layout, das einfach mitwächst — nie endlos vergrößern (M106)
      const structural = lastDelta.current != null && Math.abs(lastDelta.current - delta) < 3;
      if (autoFitRef.current) {
        setOverflowing(false);
        if (delta <= 6) { lastDelta.current = null; return; }
        if (structural) return;
        lastDelta.current = delta;
        const shell = body.parentElement as HTMLElement | null; // .card-shell = Kartenhöhe
        const current = shell?.offsetHeight ?? body.clientHeight;
        // M339: Eine Notiz am Deckel scrollt — nicht weiter wachsen (und keine Höhe festschreiben)
        if (rolltRef.current && current >= NOTIZ_MAX - 2) { lastDelta.current = null; return; }
        runDerived(() => setNodeHeight(id, Math.min(current + delta + 2, rolltRef.current ? NOTIZ_MAX : 860)));
        // Nachkontrolle (M108): hat das Wachsen den Überlauf behoben, wird
        // lastDelta gleich wieder auf null gesetzt — sonst blockierte die
        // Struktur-Erkennung die NÄCHSTE, zufällig gleich große Änderung
        // (z. B. zwei gleich hohe Listenzeilen nacheinander). Bleibt der
        // Überlauf identisch, greift sie zu Recht (100%-Layout).
        later(350);
      } else {
        if (delta <= 10) { lastDelta.current = null; setOverflowing(false); return; }
        setOverflowing(!structural);
      }
    };
    const schedule = () => later(300);
    evalRef.current = schedule;
    evalNow(true); // beim Einschalten sofort einpassen bzw. Überlauf prüfen
    const mo = new MutationObserver(schedule);
    mo.observe(body, { subtree: true, childList: true, characterData: true, attributes: true });
    body.addEventListener('load', schedule, true); // nachladende Bilder
    // M323: Verlässt der Cursor die Karte, darf sie schrumpfen (Notizen) —
    // aber nur, wenn vorher darin geschrieben wurde (focusin)
    const rein = () => { bearbeitetRef.current = true; };
    const raus = () => later(450);
    body.addEventListener('focusin', rein);
    body.addEventListener('focusout', raus);
    return () => { mo.disconnect(); body.removeEventListener('load', schedule, true); body.removeEventListener('focusin', rein); body.removeEventListener('focusout', raus); window.clearTimeout(t); evalRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFit, id]);

  // Wichtig: Lösch-Knopf & Handles liegen AUSSERHALB des card-body,
  // damit dessen overflow:hidden sie nicht abschneidet.
  return (
    <div className="card-shell" data-ohne-hoehe={ohneHoehe ? '' : undefined} style={rollt ? ({ '--notiz-max': `${NOTIZ_MAX}px` } as CSSProperties) : undefined}>
      {/* Resize-Griffe: weiße Quadrate mit neutralem Rand (klassischer
          Auswahlrahmen) — bewusst ANDERS als die runden Akzent-Verbindungs-
          punkte, damit beides auf einen Blick unterscheidbar ist (M102).
          Farben kommen aus dem CSS (theme-fähig), nicht aus der color-Prop. */}
      <NodeResizer
        isVisible={!!selected}
        minWidth={minWidth}
        minHeight={minHeight}
        onResizeStart={onManualResizeStart}
        onResizeEnd={onManualResizeEnd}
      />
      {/* Sichtbarer Griff: hier packt man die Karte IMMER — auch wenn sie
          innen komplett aus Editor/Eingabefeldern besteht */}
      <div className="card-grip" title="Ziehen zum Verschieben" aria-hidden="true">
        <svg width="18" height="8" viewBox="0 0 18 8" fill="currentColor">
          <circle cx="3" cy="2" r="1.3" /><circle cx="9" cy="2" r="1.3" /><circle cx="15" cy="2" r="1.3" />
          <circle cx="3" cy="6" r="1.3" /><circle cx="9" cy="6" r="1.3" /><circle cx="15" cy="6" r="1.3" />
        </svg>
      </div>
      {/* Anschlusspunkte an allen 4 Seiten — die Linie selbst dockt dank
          Floating Edges immer automatisch an der zugewandten Seite an */}
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map((pos) => (
        <Handle
          key={pos}
          id={pos}
          type="source"
          position={pos}
          className="pn-handle"
          title="Verbindung ziehen — auf einer anderen Karte loslassen"
        />
      ))}
      {/* Ganzkarten-Ziel: während einer Verbindung reicht es, IRGENDWO auf der
          Karte loszulassen (CSS aktiviert diesen Handle nur beim Verbinden) */}
      <Handle id="body" type="source" position={Position.Left} className="pn-handle-body" isConnectableStart={false} />
      {/* Angebots-Chip (M104): Inhalt größer als die Karte → EINMAL einpassen.
          Nur ein Angebot — die manuelle Größe wird nie von selbst geändert. */}
      {!autoFit && overflowing && (
        <button
          className="fit-hint nodrag"
          title="Höhe einmalig an den Inhalt anpassen"
          onClick={(e) => { e.stopPropagation(); fitOnce(); }}
        >⤢</button>
      )}
      <div ref={bodyRef} className={`card-body ${className ?? ''}${alsKachel ? ' kachel' : ''}`} style={style}>
        {alsKachel && kachelNode
          ? <Kachel node={kachelNode} onAuf={() => setKachel([id], false)} onOeffnen={() => oeffneKarte(useBoard.getState().activeId, id)} />
          : children}
      </div>
      {rollt && (
        <>
          <div className="note-mehr oben" aria-hidden="true" />
          <div className="note-mehr unten" aria-hidden="true" />
          <div className="note-spur" aria-hidden="true">
            <div ref={daumenRef} className="note-daumen nodrag nopan" title="Ziehen zum Scrollen" />
          </div>
        </>
      )}
      {!alsKachel && aussen}
    </div>
  );
}

/** M298: Die Kachel — Typ, Titel, zwei bis drei Zeilen Kennzahlen, zwei Knöpfe */
function Kachel({ node, onAuf, onOeffnen }: { node: AppNode; onAuf: () => void; onOeffnen: () => void }) {
  const info = kachelInfo(node);
  if (!info) return null;
  return (
    <div className="kachel">
      <div className="kachel-typ">{info.typ}</div>
      <div className="kachel-titel">{info.titel}</div>
      {info.zeilen.filter((z) => z.text).map((z, i) => (
        <div key={i} className={`kachel-zeile${z.warn ? ' warn' : ''}`}>{z.text}</div>
      ))}
      <div className="kachel-fuss">
        <button className="kachel-knopf nodrag" title="Im Fokus öffnen" onClick={(e) => { e.stopPropagation(); onOeffnen(); }}>Öffnen</button>
        <button className="kachel-knopf nodrag" title="Auf dem Board ausklappen" onClick={(e) => { e.stopPropagation(); onAuf(); }}>⤢ Ausklappen</button>
      </div>
    </div>
  );
}
