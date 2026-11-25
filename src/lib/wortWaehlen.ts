// M527: Doppelklick auf ein Wort einer eben geweckten Notiz markiert das Wort.
//
// Der erste Klick des Doppelklicks weckte den Editor (M338), der zweite traf schon den neuen — ProseMirror zählte ihn
// als ersten Klick und ließ nichts markieren. Bleibt die Auswahl nach dem Doppelklick leer, wählt diese Funktion das
// Wort unter dem Zeiger. Nachgeladen (NoteCard), damit das Start-Paket nicht wächst.

export function wortWaehlen(el: HTMLElement | null, x: number, y: number) {
  const s = window.getSelection();
  if (!el || !s || !s.isCollapsed) return;
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  const c = document.caretRangeFromPoint?.(x, y);
  const p = c ? { offsetNode: c.startContainer, offset: c.startOffset } : doc.caretPositionFromPoint?.(x, y);
  const t = p?.offsetNode;
  if (!p || !t || t.nodeType !== 3 || !el.contains(t)) return;
  const text = t.textContent ?? ''; const w = /[\p{L}\p{N}_]/u;
  let a = p.offset; let b = p.offset;
  while (a > 0 && w.test(text[a - 1])) a -= 1;
  while (b < text.length && w.test(text[b])) b += 1;
  if (b > a) s.setBaseAndExtent(t, a, t, b);
}
