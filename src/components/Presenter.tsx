import { useEffect, useMemo, useState } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { nodeToHtml } from '../lib/serialize';

/**
 * Präsentationsmodus: Karten des aktiven Boards als Vollbild-Folien in
 * Lesereihenfolge (zeilenweise von links oben). Pfeiltasten/Leertaste
 * blättern, Esc beendet. Rendering läuft über den escapenden
 * HTML-Serializer — fremde Inhalte bleiben inert.
 */
export function Presenter() {
  const open = useBoard((s) => s.presenting);
  const setOpen = useBoard((s) => s.setPresenting);
  const board = useBoard(selectActiveBoard);
  const [idx, setIdx] = useState(0);

  const slides = useMemo(() => {
    if (!open) return [];
    return [...board.nodes]
      .filter((n) => n.type !== 'portal')
      .sort((a, b) => {
        const rowA = Math.round(a.position.y / 260);
        const rowB = Math.round(b.position.y / 260);
        return rowA === rowB ? a.position.x - b.position.x : a.position.y - b.position.y;
      })
      .map((n) => ({ id: n.id, html: nodeToHtml(n) }))
      .filter((s) => s.html.trim());
  }, [open, board]);

  useEffect(() => {
    if (!open) return;
    setIdx(0);
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      // Im Präsentationsmodus dürfen Board-Shortcuts (Entf/Backspace löschen
      // Karten!) nicht durchschlagen — sonst schrumpft board.nodes live.
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        setIdx((i) => Math.min(slides.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setIdx((i) => Math.max(0, i - 1));
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slides.length]);

  if (!open) return null;

  // idx robust klemmen — board.nodes kann während der Präsentation schrumpfen
  const safeIdx = Math.max(0, Math.min(idx, slides.length - 1));

  return (
    <div className="presenter" role="dialog" aria-modal="true" aria-label="Präsentation">
      <div className="presenter-head">
        <span>{board.name}</span>
        <span className="presenter-count">{slides.length ? safeIdx + 1 : 0} / {slides.length}</span>
        <button onClick={() => setOpen(false)} aria-label="Präsentation beenden">✕</button>
      </div>
      {slides.length === 0 ? (
        <div className="presenter-slide"><p>Keine präsentierbaren Karten auf diesem Board.</p></div>
      ) : (
        <div className="presenter-slide" dangerouslySetInnerHTML={{ __html: slides[safeIdx].html }} />
      )}
      <div className="presenter-foot">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={safeIdx <= 0}>‹ Zurück</button>
        <span className="presenter-dots">
          {slides.slice(0, 24).map((s, i) => (
            <button key={s.id} className={i === safeIdx ? 'on' : ''} onClick={() => setIdx(i)} aria-label={`Folie ${i + 1}`} />
          ))}
        </span>
        <button onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))} disabled={safeIdx >= slides.length - 1}>Weiter ›</button>
      </div>
    </div>
  );
}
