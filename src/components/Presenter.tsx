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
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        setIdx((i) => Math.min(slides.length - 1, i + 1));
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slides.length]);

  if (!open) return null;

  return (
    <div className="presenter" role="dialog" aria-modal="true" aria-label="Präsentation">
      <div className="presenter-head">
        <span>{board.name}</span>
        <span className="presenter-count">{slides.length ? idx + 1 : 0} / {slides.length}</span>
        <button onClick={() => setOpen(false)} aria-label="Präsentation beenden">✕</button>
      </div>
      {slides.length === 0 ? (
        <div className="presenter-slide"><p>Keine präsentierbaren Karten auf diesem Board.</p></div>
      ) : (
        <div className="presenter-slide" dangerouslySetInnerHTML={{ __html: slides[idx].html }} />
      )}
      <div className="presenter-foot">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx <= 0}>‹ Zurück</button>
        <span className="presenter-dots">
          {slides.slice(0, 24).map((s, i) => (
            <button key={s.id} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} aria-label={`Folie ${i + 1}`} />
          ))}
        </span>
        <button onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))} disabled={idx >= slides.length - 1}>Weiter ›</button>
      </div>
    </div>
  );
}
