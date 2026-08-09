/**
 * M215: Ticket-Ziehen für Maus UND Finger.
 *
 * Der bisherige Weg war HTML5-Drag-and-Drop (`draggable` + dragstart/drop).
 * Der feuert auf Touchscreens grundsätzlich nicht — weder iOS noch Android
 * kennen dort Drag-Events. Deshalb ließen sich Tickets nur mit der Maus
 * verschieben, und am Handy blieb nur der Umweg über das Ticket-Menü.
 *
 * Pointer-Events sprechen beide Eingabearten in einer API. Zwei Eigenheiten
 * muss man dabei bedienen:
 *
 * 1. Der Finger scrollt. Würde ein Zug sofort als Drag gelten, könnte man
 *    eine lange Spalte nicht mehr durchblättern. Darum startet der Drag am
 *    Finger erst nach kurzem Halten (wie in Trello), an der Maus dagegen
 *    sofort ab wenigen Pixeln Bewegung.
 * 2. Ohne Pointer-Capture verliert man den Zeiger, sobald er die Karte
 *    verlässt — genau das passiert beim Ziehen in eine andere Spalte.
 */

/** Wie lange der Finger stillhalten muss, bevor gezogen wird (ms) */
const HOLD_MS = 220;
/** Ab wie vielen Pixeln die Maus als „ziehend" gilt */
const MOUSE_SLOP = 6;
/** Wie weit der Finger währenddessen wackeln darf, ohne abzubrechen */
const HOLD_SLOP = 10;

export interface DropTarget {
  /** Spalten-Index unter dem Zeiger */
  col: number;
  /** Einfügeposition innerhalb der Spalte (0 = ganz oben) */
  index: number;
}

interface Options {
  /** Der Zug hat begonnen — ab hier Ticket als „in Bewegung" zeigen */
  onStart: () => void;
  /** Zeiger bewegt sich; Ziel ist null, wenn er über keiner Spalte steht */
  onMove: (target: DropTarget | null, x: number, y: number) => void;
  /** Losgelassen: ablegen (Ziel) oder abbrechen (null) */
  onDrop: (target: DropTarget | null) => void;
}

/** Welche Spalte und welche Einfügeposition liegen unter (x, y)? */
export function targetAt(x: number, y: number, root: HTMLElement | null): DropTarget | null {
  if (!root) return null;
  const cols = [...root.querySelectorAll<HTMLElement>('.kanban-col')];
  const colIdx = cols.findIndex((c) => {
    const r = c.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  if (colIdx < 0) return null;
  // Einfügeposition: vor dem ersten Ticket, dessen Mitte unter dem Zeiger liegt
  const items = [...cols[colIdx].querySelectorAll<HTMLElement>('.kanban-item')]
    .filter((el) => !el.classList.contains('dragging'));
  let index = items.length;
  for (let i = 0; i < items.length; i += 1) {
    const r = items[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) { index = i; break; }
  }
  return { col: colIdx, index };
}

/**
 * Hängt einen Zug an ein Ticket. Rückgabe: der pointerdown-Handler.
 * `rootOf` liefert das Element, in dem die Spalten liegen (die Kanban-Karte).
 */
export function makeTicketDrag(rootOf: () => HTMLElement | null, opts: Options) {
  return (e: React.PointerEvent) => {
    // In Eingabefeldern und auf Knöpfen wird getippt, nicht gezogen
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
    if (e.button !== undefined && e.button > 0) return; // nur linke Maustaste

    const node = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    const touch = e.pointerType !== 'mouse';
    let dragging = false;
    let holdTimer = 0;

    const begin = () => {
      if (dragging) return;
      dragging = true;
      window.clearTimeout(holdTimer);
      try { node.setPointerCapture(e.pointerId); } catch { /* Zeiger schon weg */ }
      // Kurzes Rütteln als Rückmeldung, dass der Zug greift (nur wo vorhanden)
      navigator.vibrate?.(12);
      opts.onStart();
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        const far = Math.hypot(dx, dy);
        // Finger: Bewegung vor Ablauf der Haltezeit heißt „scrollen", nicht ziehen
        if (touch) { if (far > HOLD_SLOP) cleanup(); return; }
        if (far < MOUSE_SLOP) return;
        begin();
      }
      ev.preventDefault(); // kein Textmarkieren/Scrollen während des Zugs
      opts.onMove(targetAt(ev.clientX, ev.clientY, rootOf()), ev.clientX, ev.clientY);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const wasDragging = dragging;
      const target = wasDragging ? targetAt(ev.clientX, ev.clientY, rootOf()) : null;
      cleanup();
      if (wasDragging) opts.onDrop(target);
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const wasDragging = dragging;
      cleanup();
      if (wasDragging) opts.onDrop(null);
    };

    function cleanup() {
      dragging = false;
      window.clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      try { node.releasePointerCapture(e.pointerId); } catch { /* schon frei */ }
    }

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    if (touch) holdTimer = window.setTimeout(begin, HOLD_MS);
  };
}
