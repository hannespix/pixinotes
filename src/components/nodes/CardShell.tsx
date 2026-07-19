import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import { runDerived, useBoard } from '../../store';

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
}

/**
 * Gemeinsame Hülle aller Karten: Lösch-Knopf, Verbindungs-Handles und
 * Resize-Griffe an Ecken/Kanten (sichtbar bei Selektion).
 */
export function CardShell({ id, className, children, selected, minWidth = 170, minHeight = 70, style }: Props) {
  const removeNode = useBoard((s) => s.removeNode);
  const setNodeHeight = useBoard((s) => s.setNodeHeight);
  const setAutoFit = useBoard((s) => s.setAutoFit);
  const showToast = useBoard((s) => s.showToast);
  // Auto-Größe ist STANDARDMÄSSIG AN (M111) — false heißt: manuell gebrochen
  const autoFit = useBoard((s) => {
    const b = s.boards.find((x) => x.id === s.activeId);
    return (b?.nodes.find((n) => n.id === id)?.autoFit ?? true) !== false;
  });
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
            showToast('Auto-Größe aus — deine Größe bleibt. Wieder einschalten: Auswahl-Leiste ⤢');
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
      showToast('Auto-Größe aus — deine Größe bleibt. Wieder einschalten: Auswahl-Leiste ⤢');
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
    setNodeHeight(id, Math.min(current + delta + 2, 860));
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
      // Sperren WARTEN statt verwerfen (M108): am Smartphone folgt fast jede
      // Inhaltsänderung direkt auf eine Berührung der Karte — wurde die
      // Prüfung hier einfach verworfen, kam nie wieder eine nach und die
      // Auto-Größe war unter Touch praktisch tot. Manuell gewinnt weiterhin:
      // gehandelt wird erst NACH Loslassen + Schonfrist.
      if (resizingRef.current || pointerDownRef.current) { later(400, force); return; }
      const rest = 800 - (Date.now() - lastResizeEnd.current);
      if (!force && rest > 0) { later(rest + 60); return; }
      const delta = body.scrollHeight - body.clientHeight;
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
        runDerived(() => setNodeHeight(id, Math.min(current + delta + 2, 860)));
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
    return () => { mo.disconnect(); body.removeEventListener('load', schedule, true); window.clearTimeout(t); evalRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFit, id]);

  // Wichtig: Lösch-Knopf & Handles liegen AUSSERHALB des card-body,
  // damit dessen overflow:hidden sie nicht abschneidet.
  return (
    <div className="card-shell">
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
      <button
        className="card-x nodrag"
        title="Karte löschen (oder Entf-Taste)"
        onClick={() => removeNode(id)}
      >
        ✕
      </button>
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
          title="Der Inhalt ist größer als die Karte — Klick passt die Höhe einmalig an (dauerhafte Auto-Größe: ⤢ in der Auswahl-Leiste)"
          onClick={(e) => { e.stopPropagation(); fitOnce(); }}
        >⤢</button>
      )}
      <div ref={bodyRef} className={`card-body ${className ?? ''}`} style={style}>{children}</div>
    </div>
  );
}
