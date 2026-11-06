// Getippten Text mit dem Stift bearbeiten (M325) — Wörter im DOM vermessen,
// Blockinhalt ohne Bereiche / mit Einfügung neu bauen.
//
// BlockNote speichert den Inhalt eines Blocks entweder als String oder als
// Liste von Inline-Knoten ({ type: 'text', text, styles } oder { type: 'link',
// content: [...] }). Für Wort-Löschen und Einfügen reicht die flache Zeichen-
// folge: Text-Knoten behalten ihre Stile, Links werden zu Text (selten, und
// besser als gar nicht bearbeitbar).

export interface Wort { text: string; start: number; end: number; rect: DOMRect }
export interface InlineKnoten { type: string; text?: string; styles?: Record<string, unknown>; content?: InlineKnoten[] }
export type BlockInhalt = string | InlineKnoten[] | undefined;

/** Flache Textknoten eines Blockinhalts (Links aufgelöst) */
export function flachen(inhalt: BlockInhalt): Array<{ text: string; styles: Record<string, unknown> }> {
  if (!inhalt) return [];
  if (typeof inhalt === 'string') return inhalt ? [{ text: inhalt, styles: {} }] : [];
  const out: Array<{ text: string; styles: Record<string, unknown> }> = [];
  const walk = (ks: InlineKnoten[]) => {
    for (const k of ks) {
      if (k.type === 'text' && typeof k.text === 'string') out.push({ text: k.text, styles: k.styles ?? {} });
      else if (Array.isArray(k.content)) walk(k.content);
    }
  };
  walk(inhalt);
  return out;
}

export const inhaltText = (inhalt: BlockInhalt): string => flachen(inhalt).map((k) => k.text).join('');

/** Zeichenbereiche [start, end) aus dem Inhalt entfernen; doppelte Leerzeichen an den Nahtstellen glätten */
export function inhaltOhneBereiche(inhalt: BlockInhalt, bereiche: Array<[number, number]>): InlineKnoten[] {
  const knoten = flachen(inhalt);
  const sortiert = [...bereiche].sort((a, b) => a[0] - b[0]);
  const raus = (i: number) => sortiert.some(([s, e]) => i >= s && i < e);
  const out: InlineKnoten[] = [];
  let pos = 0;
  for (const k of knoten) {
    let text = '';
    for (let i = 0; i < k.text.length; i += 1) if (!raus(pos + i)) text += k.text[i];
    pos += k.text.length;
    if (text) out.push({ type: 'text', text, styles: k.styles });
  }
  // Nahtstellen: „Milch  Butter" → „Milch Butter", Leerzeichen am Rand weg
  const gesamt = out.map((k) => k.text).join('');
  const sauber = gesamt.replace(/ {2,}/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
  if (sauber === gesamt) return out;
  // Stile neu verteilen ist bei geglätteten Leerzeichen nicht exakt möglich — ein Knoten mit den Stilen des ersten
  return sauber ? [{ type: 'text', text: sauber, styles: out[0]?.styles ?? {} }] : [];
}

/** Text an einem Zeichen-Offset einfügen (mit passenden Leerzeichen drumherum) */
export function inhaltMitEinfuegung(inhalt: BlockInhalt, offset: number, text: string): InlineKnoten[] {
  const knoten = flachen(inhalt);
  const gesamt = knoten.map((k) => k.text).join('');
  const o = Math.max(0, Math.min(gesamt.length, offset));
  const vor = gesamt.slice(0, o), nach = gesamt.slice(o);
  const einsatz = `${vor && !/\s$/.test(vor) ? ' ' : ''}${text.trim()}${nach && !/^\s/.test(nach) && !/^[,.;:!?]/.test(nach) ? ' ' : ''}`;
  if (knoten.length === 0) return [{ type: 'text', text: text.trim(), styles: {} }];
  // In den Knoten einfügen, der den Offset enthält (Stile dieses Knotens)
  const out: InlineKnoten[] = [];
  let pos = 0;
  let eingefuegt = false;
  for (const k of knoten) {
    const ende = pos + k.text.length;
    if (!eingefuegt && o >= pos && o <= ende) {
      const t = k.text.slice(0, o - pos) + einsatz + k.text.slice(o - pos);
      out.push({ type: 'text', text: t, styles: k.styles });
      eingefuegt = true;
    } else out.push({ type: 'text', text: k.text, styles: k.styles });
    pos = ende;
  }
  if (!eingefuegt) out.push({ type: 'text', text: einsatz, styles: {} });
  return out;
}

/** Textknoten eines Block-Elements in Dokumentreihenfolge mit ihren Start-Offsets */
function textKnoten(blockEl: HTMLElement): Array<{ node: Text; start: number }> {
  const wurzel = (blockEl.querySelector('.bn-inline-content') as HTMLElement | null) ?? blockEl;
  const out: Array<{ node: Text; start: number }> = [];
  const w = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let n: Node | null;
  while ((n = w.nextNode())) {
    const t = n as Text;
    out.push({ node: t, start: pos });
    pos += t.data.length;
  }
  return out;
}

/** Zeichen-Offset → (Textknoten, Offset darin) */
function stelle(knoten: Array<{ node: Text; start: number }>, offset: number): { node: Text; off: number } | null {
  for (let i = knoten.length - 1; i >= 0; i -= 1) {
    const k = knoten[i];
    if (offset >= k.start) return { node: k.node, off: Math.min(k.node.data.length, offset - k.start) };
  }
  return knoten[0] ? { node: knoten[0].node, off: 0 } : null;
}

/** Alle Wörter eines Block-Elements mit Bildschirm-Rechtecken */
export function woerterImBlock(blockEl: HTMLElement): Wort[] {
  const knoten = textKnoten(blockEl);
  if (knoten.length === 0) return [];
  const text = knoten.map((k) => k.node.data).join('');
  const out: Wort[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const start = m.index ?? 0, end = start + m[0].length;
    const a = stelle(knoten, start), b = stelle(knoten, end);
    if (!a || !b) continue;
    const r = document.createRange();
    try { r.setStart(a.node, a.off); r.setEnd(b.node, b.off); } catch { continue; }
    const rects = Array.from(r.getClientRects());
    if (rects.length === 0) continue;
    const left = Math.min(...rects.map((x) => x.left)), top = Math.min(...rects.map((x) => x.top));
    const right = Math.max(...rects.map((x) => x.right)), bottom = Math.max(...rects.map((x) => x.bottom));
    out.push({ text: m[0], start, end, rect: new DOMRect(left, top, right - left, bottom - top) });
  }
  return out;
}

/** Zeichen-Offset im Block unter dem Bildschirmpunkt (für Einfügen zwischen Wörtern) */
export function offsetUnterPunkt(blockEl: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  let node: Node | null = null;
  let off = 0;
  if (typeof document.caretRangeFromPoint === 'function') {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; off = r.startOffset; }
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; off = p.offset; }
  }
  if (!node || !blockEl.contains(node)) return null;
  const knoten = textKnoten(blockEl);
  const k = knoten.find((e) => e.node === node);
  if (k) return k.start + off;
  // Punkt traf ein Element statt eines Textknotens: Anfang oder Ende
  return off === 0 ? 0 : knoten.reduce((a, e) => a + e.node.data.length, 0);
}

/** Wörter mit einer DOM-Auswahl markieren (und den Editor fokussieren) */
export function woerterMarkieren(blockEl: HTMLElement, von: Wort, bis: Wort): boolean {
  const knoten = textKnoten(blockEl);
  const a = stelle(knoten, von.start), b = stelle(knoten, bis.end);
  if (!a || !b) return false;
  const r = document.createRange();
  try { r.setStart(a.node, a.off); r.setEnd(b.node, b.off); } catch { return false; }
  const editor = blockEl.closest('[contenteditable="true"]') as HTMLElement | null;
  editor?.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
  return true;
}
