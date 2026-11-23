// M385: QR-Code zum Mitmachen einblenden.
//
// Groß in der Mitte, damit ihn der ganze Raum vom Beamer scannen kann — oder klein in einer Ecke, während man
// weiterarbeitet (die Ecke lässt sich verschieben und bleibt auch über der Folien-Präsentation stehen). Der Code
// trägt den Einladungslink des Boards; wer ihn scannt, landet im Board (mit „auch ohne Konto": sofort).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useBoard } from '../store';
import { EINLADUNG_EREIGNIS, TEILNEHMER_EREIGNIS, teilnehmerVon } from '../lib/liveStand';
import { qrBild, qrWunschFuer, qrZeigen, type QrBild, type QrWunsch } from '../lib/qr';
import { sprache } from '../lib/sprache';
import { IMaximize, IMinimize, IX } from './Icons';

export function QrBlende({ wunsch, onClose }: { wunsch: QrWunsch; onClose: () => void }) {
  const name = useBoard((s) => s.boards.find((b) => b.id === wunsch.boardId)?.name ?? '');
  const showToast = useBoard((s) => s.showToast);
  const [bild, setBild] = useState<QrBild | null>(null);
  const [fehler, setFehler] = useState(false);
  const [ecke, setEcke] = useState(false);
  /** Lage der Ecke (linke obere Ecke, Bildschirmpunkte) — null: Vorgabe unten rechts */
  const [lage, setLage] = useState<{ x: number; y: number } | null>(null);
  const [dabei, setDabei] = useState(() => teilnehmerVon(wunsch.boardId).length);
  const kasten = useRef<HTMLDivElement | null>(null);
  const en = sprache() === 'en';
  const zug = useRef<{ dx: number; dy: number; bewegt: boolean } | null>(null);

  useEffect(() => {
    let da = true;
    setBild(null); setFehler(false);
    qrBild(wunsch.url).then((b) => { if (da) setBild(b); }).catch(() => { if (da) setFehler(true); });
    return () => { da = false; };
  }, [wunsch.url]);
  useEffect(() => {
    const auf = () => setDabei(teilnehmerVon(wunsch.boardId).length);
    auf();
    window.addEventListener(TEILNEHMER_EREIGNIS, auf);
    return () => window.removeEventListener(TEILNEHMER_EREIGNIS, auf);
  }, [wunsch.boardId]);
  // Der Besitzer hat den Link widerrufen oder umgestellt (mit/ohne Konto): Ein toter Code darf nicht stehen bleiben
  useEffect(() => {
    const auf = () => {
      if (useBoard.getState().boards.find((b) => b.id === wunsch.boardId)?.gastLink) return;   // als Gast: der eigene Zugang gilt
      const w = qrWunschFuer(wunsch.boardId);
      if (!w) onClose();
      else if (w.url !== wunsch.url || w.ohneKonto !== wunsch.ohneKonto) qrZeigen(wunsch.boardId);
    };
    window.addEventListener(EINLADUNG_EREIGNIS, auf);
    return () => window.removeEventListener(EINLADUNG_EREIGNIS, auf);
  }, [wunsch, onClose]);
  // Esc schließt die große Ansicht. In der Ecke bleibt Esc frei — dort soll es die Präsentation oder den Fokus
  // beenden, nicht den Code.
  useEffect(() => {
    if (ecke) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ecke, onClose]);
  // Fenster kleiner geworden: Die Ecke bleibt im Bild
  useEffect(() => {
    if (!ecke || !lage) return;
    const passt = () => setLage((l) => (l ? einpassen(l.x, l.y) : l));
    window.addEventListener('resize', passt);
    return () => window.removeEventListener('resize', passt);
  }, [ecke, lage]);

  const einpassen = (x: number, y: number) => {
    const r = kasten.current?.getBoundingClientRect();
    const w = r?.width ?? 200, h = r?.height ?? 240;
    return { x: Math.max(8, Math.min(window.innerWidth - w - 8, x)), y: Math.max(8, Math.min(window.innerHeight - h - 8, y)) };
  };
  const greifen = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!ecke || (e.target as HTMLElement).closest('button')) return;
    const r = kasten.current!.getBoundingClientRect();
    zug.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, bewegt: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const ziehen = (e: ReactPointerEvent<HTMLDivElement>) => {
    const z = zug.current;
    if (!z) return;
    z.bewegt = true;
    setLage(einpassen(e.clientX - z.dx, e.clientY - z.dy));
  };
  const loslassen = (e: ReactPointerEvent<HTMLDivElement>) => {
    const z = zug.current;
    zug.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* schon frei */ }
    // nur angetippt, nicht gezogen: wieder groß
    if (z && !z.bewegt && !(e.target as HTMLElement).closest('button')) setEcke(false);
  };
  const kopieren = async () => {
    try { await navigator.clipboard.writeText(wunsch.url); showToast('Link kopiert.'); }
    catch { showToast('Kopieren ging nicht – den Link bitte im Board-Menü ⋯ → „Gemeinsam bearbeiten" markieren.', false, 7000); }
  };

  const code = (
    <div className="qr-code" data-taste="qr-code" role="img" aria-label={`QR-Code: Einladung zum Board ${name}`}>
      {bild ? (
        // immer Schwarz auf Weiß, mit Ruhezone — unabhängig vom Farbschema, sonst liest ihn keine Kamera
        <svg viewBox={`0 0 ${bild.n} ${bild.n}`} shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
          <rect width={bild.n} height={bild.n} fill="#fff" />
          <path d={bild.pfad} fill="#000" />
        </svg>
      ) : <span className="qr-warte">{fehler ? 'Der Code ließ sich nicht erzeugen.' : 'Code wird erzeugt …'}</span>}
    </div>
  );

  if (ecke) {
    return (
      <div key="ecke" ref={kasten} className="qr-blende ecke" data-taste="qr-blende" data-form="ecke" role="dialog" aria-label="QR-Code zum Mitmachen"
        style={lage ? { left: lage.x, top: lage.y, right: 'auto', bottom: 'auto' } : undefined}
        onPointerDown={greifen} onPointerMove={ziehen} onPointerUp={loslassen} onPointerCancel={loslassen}
        title="Ziehen verschiebt · Antippen zeigt den Code groß">
        <div className="qr-ecke-kopf">
          <span>Mitmachen</span>
          <button onClick={() => setEcke(false)} aria-label="QR-Code groß zeigen" title="Groß zeigen" data-taste="qr-gross"><IMaximize size={13} /></button>
          <button onClick={onClose} aria-label="QR-Code ausblenden" title="Ausblenden" data-taste="qr-zu"><IX size={13} /></button>
        </div>
        {code}
        <div className="qr-ecke-fuss" data-taste="qr-dabei">{dabei > 1 ? `${dabei} dabei` : 'Scannen & mitmachen'}</div>
      </div>
    );
  }
  return (
    <div key="gross" className="qr-blende gross" data-taste="qr-blende" data-form="gross" role="dialog" aria-modal="true" aria-label="QR-Code zum Mitmachen" onClick={onClose}>
      <div ref={kasten} className="qr-karte" onClick={(e) => e.stopPropagation()}>
        <div className="qr-kopf">
          <h2>Mach mit!</h2>
          <button className="modal-x" onClick={onClose} aria-label="Schließen" data-taste="qr-zu"><IX size={18} /></button>
        </div>
        <p className="qr-text">
          Code mit der Handy-Kamera scannen –<br />
          {wunsch.ohneKonto ? 'du bist sofort im Board' : 'du kommst ins Board'} {en ? '“' : '„'}<b translate="no">{name}</b>{en ? '”' : '"'}.
          {!wunsch.ohneKonto && <> <span className="qr-konto" data-taste="qr-konto">Dafür ist ein PixiNotes-Konto nötig.</span></>}
        </p>
        {code}
        <div className="qr-adresse" translate="no" data-taste="qr-adresse">{wunsch.url}</div>
        <div className="qr-fuss">
          <span className="qr-dabei" data-taste="qr-dabei" aria-live="polite">{dabei > 1 ? `${dabei} dabei` : 'Noch niemand sonst dabei'}</span>
          <span className="qr-knoepfe">
            <button onClick={() => void kopieren()} data-taste="qr-kopieren">Link kopieren</button>
            <button onClick={() => { setLage(null); setEcke(true); }} data-taste="qr-ecke" title="Klein in die Ecke legen und weiterarbeiten – der Code bleibt sichtbar"><IMinimize size={14} /> In die Ecke</button>
          </span>
        </div>
      </div>
    </div>
  );
}
