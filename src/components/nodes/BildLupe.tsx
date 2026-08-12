import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { useLupe } from '../../lib/lupe';
import { IDownload, IX } from '../Icons';

/**
 * M264: Bild groß ansehen — und hineinzoomen.
 *
 * Auf der Karte ist ein Screenshot so groß wie die Karte; die Fehlermeldung
 * darin ist damit meist unlesbar. Diese Ansicht legt das Bild formatfüllend
 * über die Fläche und lässt es vergrößern: Knöpfe, Strg/⌘ + Rad,
 * Zwei-Finger-Kneifen, Doppelklick — und im vergrößerten Bild wird geschoben.
 */
export function BildLupe({ quelle, name, onClose, onDownload }: {
  quelle: string;
  name: string;
  onClose: () => void;
  onDownload?: () => void;
}) {
  const { zoom, rein, raus, einpassen, flaecheRef, griffe, maxZoom } = useLupe();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="pdf-backdrop nodrag" onClick={onClose}>
      <div className="pdf-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-bar">
          <b>{name}</b>
          <span className="pdf-nav">
            <ZoomKnoepfe {...{ zoom, rein, raus, einpassen, maxZoom }} />
            {onDownload && <button onClick={onDownload} title="Herunterladen"><IDownload size={14} /></button>}
            <button onClick={onClose} aria-label="Schließen"><IX size={13} /></button>
          </span>
        </div>
        <div
          className={`pdf-page ${zoom > 1.01 ? 'gezoomt' : ''}`}
          ref={flaecheRef}
          {...griffe}
          title="Doppelklick vergrößert · Strg + Rad zoomt · zwei Finger kneifen"
        >
          <img src={quelle} alt={name} draggable={false} style={{ width: `${zoom * 100}%` }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Die Zoom-Bedienung — gleich für Bild und PDF (M264) */
export function ZoomKnoepfe({ zoom, rein, raus, einpassen, maxZoom }: {
  zoom: number; rein: () => void; raus: () => void; einpassen: () => void; maxZoom: number;
}) {
  return (
    <span className="lupe-knoepfe">
      <button onClick={raus} disabled={zoom <= 1.01} aria-label="Verkleinern" title="Verkleinern (−)">−</button>
      <button
        className="lupe-stand"
        onClick={einpassen}
        disabled={zoom <= 1.01}
        title="Wieder einpassen (0)"
      >{Math.round(zoom * 100)} %</button>
      <button onClick={rein} disabled={zoom >= maxZoom - 0.01} aria-label="Vergrößern" title="Vergrößern (+)">＋</button>
    </span>
  );
}
