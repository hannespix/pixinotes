import { useEffect, useState } from 'react';

/**
 * Globales Tooltip-System: fängt jedes [title]-Attribut der App ab und zeigt
 * statt des winzigen Browser-Tooltips eine gestylte, gut lesbare Sprechblase
 * (450 ms Verzögerung, Viewport-geklemmt). Der native Tooltip wird unterdrückt,
 * indem title beim ersten Hover nach data-tip verschoben wird — so bleiben
 * ALLE bestehenden Beschreibungen ohne Umbau erhalten.
 * M175: Auf Touch-Geräten zeigt LANGES DRÜCKEN (500 ms, ohne Wegbewegen) die
 * Sprechblase — wie bei Android-Symbolleisten. Der nach dem Loslassen fällige
 * Klick wird unterdrückt: Nachschlagen löst die Aktion NICHT aus.
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

  // M175: Long-Press-Tooltips für Touch (auch Hybrid-Geräte: any-pointer)
  useEffect(() => {
    if (!window.matchMedia('(any-pointer: coarse)').matches) return;
    let timer = 0;
    let hideTimer = 0;
    let el: HTMLElement | null = null;
    let sx = 0;
    let sy = 0;
    let shown = false;

    const hide = () => {
      window.clearTimeout(timer);
      window.clearTimeout(hideTimer);
      shown = false;
      el = null;
      setTip(null);
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      hide(); // neuer Finger räumt einen stehenden Tipp weg
      const t = (e.target as HTMLElement | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
      if (!t) return;
      const title = t.getAttribute('title');
      if (title) {
        t.dataset.tip = title;
        t.removeAttribute('title');
      }
      if (!t.dataset.tip) return;
      el = t;
      sx = e.clientX;
      sy = e.clientY;
      timer = window.setTimeout(() => {
        shown = true;
        const r = t.getBoundingClientRect();
        const below = r.top < 70;
        setTip({ text: t.dataset.tip!, x: r.left + r.width / 2, y: below ? r.bottom + 9 : r.top - 9, below });
      }, 500);
    };

    const move = (e: PointerEvent) => {
      if (!el || e.pointerType !== 'touch') return;
      // Wegbewegen = Pan/Drag, kein Nachschlagen
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 12) {
        if (shown) hide();
        else { window.clearTimeout(timer); el = null; }
      }
    };

    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      window.clearTimeout(timer);
      if (shown) {
        // Tipp zum Lesen kurz stehen lassen — der Klick wird unten abgefangen
        hideTimer = window.setTimeout(hide, 1800);
      } else {
        el = null;
      }
    };

    // Nach einem gezeigten Long-Press-Tipp darf der Knopf NICHT auslösen
    const swallowClick = (e: MouseEvent) => {
      if (shown && el && el.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Android-Kontextmenü/Textauswahl beim langen Drücken unterdrücken
    const ctxMenu = (e: Event) => {
      if (el) e.preventDefault();
    };

    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('click', swallowClick, true);
    document.addEventListener('contextmenu', ctxMenu, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('click', swallowClick, true);
      document.removeEventListener('contextmenu', ctxMenu, true);
      window.clearTimeout(timer);
      window.clearTimeout(hideTimer);
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
