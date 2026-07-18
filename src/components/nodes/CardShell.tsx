import { useEffect, useRef, useState, type ReactNode } from 'react';
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
}

/**
 * Gemeinsame Hülle aller Karten: Lösch-Knopf, Verbindungs-Handles und
 * Resize-Griffe an Ecken/Kanten (sichtbar bei Selektion).
 */
export function CardShell({ id, className, children, selected, minWidth = 170, minHeight = 70 }: Props) {
  const removeNode = useBoard((s) => s.removeNode);
  const setNodeHeight = useBoard((s) => s.setNodeHeight);
  const setAutoFit = useBoard((s) => s.setAutoFit);
  const showToast = useBoard((s) => s.showToast);
  const autoFit = useBoard((s) => {
    const b = s.boards.find((x) => x.id === s.activeId);
    return b?.nodes.find((n) => n.id === id)?.autoFit ?? false;
  });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);
  // Aktueller autoFit-Wert ohne Stale-Closure-Risiko (Resize-Callbacks)
  const autoFitRef = useRef(autoFit);
  autoFitRef.current = autoFit;
  // Schonfrist nach manuellem Ziehen: in dieser Zeit fasst die Automatik
  // die Größe GARANTIERT nicht an (M104 — „manuell gewinnt immer")
  const lastResizeEnd = useRef(0);
  const evalRef = useRef<(() => void) | null>(null);
  // Inhalt läuft über die feste Kartengröße hinaus → Einpassen ANBIETEN
  const [overflowing, setOverflowing] = useState(false);

  /** Höhe einmalig an den Inhalt anpassen (⤢-Angebots-Chip, M104) */
  const fitOnce = () => {
    const body = bodyRef.current;
    if (!body) return;
    const delta = body.scrollHeight - body.clientHeight;
    if (delta <= 0) { setOverflowing(false); return; }
    const shell = body.parentElement as HTMLElement | null;
    const current = shell?.offsetHeight ?? body.clientHeight;
    setNodeHeight(id, Math.min(current + delta + 2, 860));
    setOverflowing(false);
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
    const evalNow = () => {
      if (resizingRef.current || Date.now() - lastResizeEnd.current < 800) return;
      const delta = body.scrollHeight - body.clientHeight;
      if (autoFitRef.current) {
        setOverflowing(false);
        if (delta <= 6) return;
        const shell = body.parentElement as HTMLElement | null; // .card-shell = Kartenhöhe
        const current = shell?.offsetHeight ?? body.clientHeight;
        runDerived(() => setNodeHeight(id, Math.min(current + delta + 2, 860)));
      } else {
        setOverflowing(delta > 10);
      }
    };
    const schedule = () => { window.clearTimeout(t); t = window.setTimeout(evalNow, 300); };
    evalRef.current = schedule;
    evalNow(); // beim Einschalten sofort einpassen bzw. Überlauf prüfen
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
        onResizeStart={() => { resizingRef.current = true; }}
        onResizeEnd={() => {
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
        }}
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
      <div ref={bodyRef} className={`card-body ${className ?? ''}`}>{children}</div>
    </div>
  );
}
