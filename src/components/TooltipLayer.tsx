import { useEffect, useState } from 'react';

/**
 * Globales Tooltip-System: fängt jedes [title]-Attribut der App ab und zeigt
 * statt des winzigen Browser-Tooltips eine gestylte, gut lesbare Sprechblase
 * (450 ms Verzögerung, Viewport-geklemmt). Der native Tooltip wird unterdrückt,
 * indem title beim ersten Hover nach data-tip verschoben wird — so bleiben
 * ALLE bestehenden Beschreibungen ohne Umbau erhalten.
 * Auf Touch-Geräten passiert nichts (dort gibt es kein Hover).
 */
interface Tip { text: string; x: number; y: number; below: boolean }

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    let timer = 0;
    let currentEl: HTMLElement | null = null;

    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      const r = el.getBoundingClientRect();
      const below = r.top < 70; // oben kein Platz → unter dem Element zeigen
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 9 : r.top - 9, below });
    };

    const hide = () => {
      window.clearTimeout(timer);
      currentEl = null;
      setTip(null);
    };

    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
      if (!el) return;
      // nativen Browser-Tooltip abschalten: title einmalig nach data-tip verschieben
      const title = el.getAttribute('title');
      if (title) {
        el.dataset.tip = title;
        el.removeAttribute('title');
      }
      if (el === currentEl) return;
      currentEl = el;
      window.clearTimeout(timer);
      setTip(null);
      timer = window.setTimeout(() => show(el), 450);
    };

    const out = (e: MouseEvent) => {
      if (!currentEl) return;
      const to = e.relatedTarget as Node | null;
      if (to && currentEl.contains(to)) return; // nur Kind-Wechsel — bleiben
      if (currentEl.contains(e.target as Node)) hide();
    };

    document.addEventListener('mouseover', over, true);
    document.addEventListener('mouseout', out, true);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', over, true);
      document.removeEventListener('mouseout', out, true);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      window.clearTimeout(timer);
    };
  }, []);

  if (!tip) return null;
  // horizontal in den Viewport klemmen (Sprechblase ist max. 300px breit)
  const x = Math.min(Math.max(tip.x, 158), window.innerWidth - 158);
  return (
    <div
      className={`tipbox ${tip.below ? 'below' : ''}`}
      style={{ left: x, top: tip.y }}
      role="tooltip"
    >
      {tip.text}
    </div>
  );
}
