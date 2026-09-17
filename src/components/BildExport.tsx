import { useEffect, useState } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { exportBoard } from '../lib/exporter';

/**
 * M300: Bild-Export des aktuellen Boards — ein kleines Fenster aus dem Dock
 * (⋯ → „Als Bild exportieren"). Vorher stand das in den Einstellungen unter
 * „Export", dabei ist es keine Einstellung, sondern eine Aktion auf dem Board,
 * das gerade auf dem Schirm ist: Der Export fotografiert die Fläche.
 */
export function BildExport() {
  const open = useBoard((s) => s.bildExportOpen);
  const setOpen = useBoard((s) => s.setBildExportOpen);
  const activeBoard = useBoard(selectActiveBoard);
  const showToast = useBoard((s) => s.showToast);
  const [format, setFormat] = useState<'png' | 'svg' | 'print'>('png');
  const [scale, setScale] = useState(2);
  const [bg, setBg] = useState<'beige' | 'white' | 'transparent'>('beige');
  const [header, setHeader] = useState(true);
  const [selOnly, setSelOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const ausgewaehlt = activeBoard.nodes.filter((n) => !n.archived && n.selected).length;
  const nurAuswahl = selOnly && ausgewaehlt > 0;

  const los = async () => {
    setBusy(true);
    try {
      const nodes = activeBoard.nodes.filter((n) => !n.archived && (!nurAuswahl || n.selected));
      await exportBoard({ format, name: activeBoard.name, nodes, scale, background: bg, header });
      showToast(format === 'print' ? '🖨️ Druckdialog geöffnet — dort „Als PDF speichern".' : '⬇️ Bild erstellt.');
      setOpen(false);
    } catch (e) {
      showToast(`Abgebrochen: ${String((e as Error).message)}`, false, 8000);
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal bild-export" role="dialog" aria-modal="true" aria-label="Als Bild exportieren" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🖼 Als Bild exportieren</h2>
          <button className="modal-x" onClick={() => setOpen(false)} aria-label="Schließen">✕</button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            <p className="modal-hint">Das Board „{activeBoard.name}", zugeschnitten auf den Inhalt.</p>
            <label className="modal-row">
              <span>Format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                <option value="png">PNG</option>
                <option value="svg">SVG (Vektor)</option>
                <option value="print">PDF (Druckdialog)</option>
              </select>
            </label>
            <label className="modal-row">
              <span>Auflösung</span>
              <select value={scale} onChange={(e) => setScale(Number(e.target.value))} disabled={format === 'svg'}>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={3}>3× (Druck)</option>
              </select>
            </label>
            <label className="modal-row">
              <span>Hintergrund</span>
              <select value={bg} onChange={(e) => setBg(e.target.value as typeof bg)}>
                <option value="beige">Beige (wie Board)</option>
                <option value="white">Weiß</option>
                <option value="transparent">Transparent</option>
              </select>
            </label>
            <label className="modal-row modal-row-check">
              <span>Kopfzeile mit Board-Name und Datum</span>
              <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
            </label>
            <label className="modal-row modal-row-check">
              <span>Nur ausgewählte Karten{ausgewaehlt > 0 ? ` (${ausgewaehlt})` : ''}</span>
              <input type="checkbox" checked={nurAuswahl} disabled={ausgewaehlt === 0} onChange={(e) => setSelOnly(e.target.checked)} />
            </label>
            <div className="modal-buttons">
              <button disabled={busy} onClick={() => void los()}>{busy ? '…' : 'Exportieren'}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
