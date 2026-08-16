// M184: HTML → BlockNote-Blöcke für Notiz-Karten.
//
// Gemeinsamer Unterbau für den OneNote-Import (Graph liefert Seiten als HTML)
// und den Word-Import (.docx wird erst zu HTML aufbereitet).
//
// Bewusst ein EIGENER Parser statt `editor.tryParseHTMLToBlocks`:
//  1. OneNote kodiert Aufgabenkästchen als `data-tag="to-do"` an einem ganz
//     normalen Absatz — BlockNote macht daraus stumpf einen Absatz, der Haken
//     ginge verloren. Hier wird daraus eine echte Checkliste (und damit eine
//     Aufgabe, die Aufgaben-Zentrale und Kanban-Abo sehen).
//  2. Sicherheit: Ein Block mit unbekanntem Typ lässt BlockNote beim Mount
//     hart werfen — und die App hat keine Fehlergrenze, es bliebe ein weißer
//     Bildschirm. Dieser Parser erzeugt AUSSCHLIESSLICH die sechs Typen, die
//     das Projekt versteht; alles andere wird zu Text statt zu einem Risiko.
//
// Erzeugt wird bewusst die schlanke Form ohne `id` (wie lib/starter.ts):
// `content` als String, solange nichts formatiert ist, sonst als Segment-Liste.

/** Die EINZIGEN Blocktypen, die Editor, Export, Suche und Aufgaben verstehen */
const SAFE_TYPES = new Set([
  'paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'table',
  // M283: die rechnende Tabelle ist ein vollwertiger Block des Notiz-Schemas.
  // Ohne diesen Eintrag hielte repairBlocks sie für einen Fremdkörper und
  // machte beim nächsten Öffnen der Notiz einen leeren Absatz daraus — die
  // Tabelle wäre weg, und zwar dauerhaft.
  'rechentabelle',
]);

export type Block = Record<string, unknown>;
type Styles = Record<string, boolean>;
interface Seg { type: 'text'; text: string; styles: Styles }

export interface HtmlParseResult {
  blocks: Block[];
  /** Bilder, die im HTML steckten — der Aufrufer entscheidet, was daraus wird */
  images: Array<{ src: string; alt?: string }>;
}

const BLOCKISH = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE',
  'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'BLOCKQUOTE', 'PRE', 'SECTION',
  'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'FIGURE', 'FIGCAPTION', 'HR', 'BR',
]);

/** Weiche Leerzeichen (auch &nbsp;) zusammenziehen */
const squash = (s: string) => s.replace(/[\s ]+/g, ' ');

/** Zeichen-Ebene: Text mit Formatierungen einsammeln */
function collectSegs(node: Node, inherited: Styles, out: Seg[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = squash(node.nodeValue ?? '');
    if (t) out.push({ type: 'text', text: t, styles: { ...inherited } });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = el.tagName;
  if (tag === 'BR') { out.push({ type: 'text', text: ' ', styles: {} }); return; }
  // Verschachtelte Blöcke gehören nicht in eine Textzeile — der Aufrufer
  // (walkBlocks) hat sie bereits eigenständig eingesammelt
  if (BLOCKISH.has(tag) && tag !== 'BR') return;

  const styles: Styles = { ...inherited };
  if (tag === 'B' || tag === 'STRONG') styles.bold = true;
  if (tag === 'I' || tag === 'EM') styles.italic = true;
  if (tag === 'U' || tag === 'INS') styles.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') styles.strike = true;
  if (tag === 'CODE' || tag === 'TT' || tag === 'SAMP') styles.code = true;
  // Word/OneNote formatieren gern per style-Attribut statt per Tag
  const st = el.getAttribute('style') ?? '';
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) styles.bold = true;
  if (/font-style\s*:\s*italic/i.test(st)) styles.italic = true;
  if (/text-decoration[^;]*underline/i.test(st)) styles.underline = true;
  if (/text-decoration[^;]*line-through/i.test(st)) styles.strike = true;

  for (const c of Array.from(el.childNodes)) collectSegs(c, styles, out);
}

/** Segmente zu Block-`content` verdichten: String, solange nichts formatiert ist */
function toContent(segs: Seg[]): string | Seg[] {
  const merged: Seg[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && JSON.stringify(last.styles) === JSON.stringify(s.styles)) last.text += s.text;
    else merged.push({ ...s });
  }
  // Ränder trimmen, leere Segmente raus (ein leerer Textknoten lässt
  // ProseMirror werfen — „Empty text nodes are not allowed")
  if (merged.length > 0) {
    merged[0].text = merged[0].text.replace(/^ +/, '');
    merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/ +$/, '');
  }
  const clean = merged.filter((s) => s.text.length > 0);
  if (clean.length === 0) return '';
  if (clean.every((s) => Object.keys(s.styles).length === 0)) return clean.map((s) => s.text).join('');
  return clean;
}

const contentText = (c: string | Seg[]): string => (typeof c === 'string' ? c : c.map((s) => s.text).join(''));

/**
 * OneNote-Aufgabenkästchen erkennen. Graph liefert z. B.
 * `<p data-tag="to-do">…` bzw. `data-tag="to-do:completed"`; Word/HTML-Exporte
 * nutzen stattdessen ein `<input type="checkbox">` in der Zeile.
 */
function checkState(el: HTMLElement): { is: boolean; checked: boolean } {
  // Erst am Element selbst …
  const own = el.getAttribute('data-tag') ?? '';
  const read = (tag: string) => (TODO_TAG.test(tag) ? { is: true, checked: /:completed/i.test(tag) } : null);
  const mine = read(own);
  if (mine) return mine;
  // … dann in einem umschließenden <span>: In Listen hängt OneNote das
  // data-tag NICHT ans <li>, sondern an ein <span> darin (Graph-Doku).
  for (const s of Array.from(el.querySelectorAll(':scope > span[data-tag], :scope > p > span[data-tag]'))) {
    const hit = read(s.getAttribute('data-tag') ?? '');
    if (hit) return hit;
  }
  const box = el.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]')
    ?? el.querySelector('input[type="checkbox"]');
  if (box) return { is: true, checked: (box as HTMLInputElement).hasAttribute('checked') };
  return { is: false, checked: false };
}

/** OneNote-Notizmarken mit Kästchen-Charakter (die übrigen sind reine Etiketten) */
const TODO_TAG = /(^|,)\s*(to-do(-priority-[12])?|client-request|discuss-with-(person-[ab]|manager)|schedule-meeting|call-back)(:completed)?\s*(,|$)/i;

/** Tabelle → BlockNote-Tabellenblock (Zellen als Inline-Listen, nie als tableCell-Objekte) */
function tableBlock(table: HTMLTableElement): Block | null {
  const rows: Array<{ cells: Array<string | Seg[]> }> = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells: Array<string | Seg[]> = [];
    for (const td of Array.from(tr.children)) {
      if (!/^(TD|TH)$/.test(td.tagName)) continue;
      const segs: Seg[] = [];
      // Zellen enthalten oft <p>-Absätze — deren Text zählt trotzdem zur Zelle
      for (const c of Array.from(td.childNodes)) {
        if (c.nodeType === Node.ELEMENT_NODE && BLOCKISH.has((c as HTMLElement).tagName)) {
          for (const cc of Array.from(c.childNodes)) collectSegs(cc, {}, segs);
          segs.push({ type: 'text', text: ' ', styles: {} });
        } else {
          collectSegs(c, {}, segs);
        }
      }
      const content = toContent(segs);
      // Leere Zelle: leeres Array — ein Textknoten mit '' würde werfen
      cells.push(content === '' ? [] : (typeof content === 'string' ? [{ type: 'text', text: content, styles: {} }] : content));
    }
    if (cells.length > 0) rows.push({ cells });
  }
  if (rows.length === 0) return null;
  // Auf gleiche Spaltenzahl auffüllen — ungleiche Zeilen lehnt BlockNote ab
  const width = Math.max(...rows.map((r) => r.cells.length));
  for (const r of rows) while (r.cells.length < width) r.cells.push([]);
  return { type: 'table', content: { type: 'tableContent', rows } };
}

/**
 * HTML in Blöcke übersetzen. Robust gegen alles, was OneNote und Word an
 * Verschachtelung, Positionierungs-Divs und leeren Absätzen mitschicken.
 */
export function htmlToBlocks(html: string): HtmlParseResult {
  const blocks: Block[] = [];
  const images: Array<{ src: string; alt?: string }> = [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return { blocks: [{ type: 'paragraph', content: squash(html).trim() }], images };
  }

  const push = (b: Block | null) => { if (b) blocks.push(b); };

  /** Bilder aus einem Teilbaum bergen. Wichtig: `<img>` steckt fast immer IN
   *  einem Absatz oder Listenpunkt — die Textsammlung sieht es dort nicht, und
   *  ohne diesen Aufruf ginge das Bild samt (leerem) Absatz verloren. */
  const harvestImages = (el: HTMLElement): void => {
    const own = el.tagName === 'IMG' ? [el] : Array.from(el.querySelectorAll('img'));
    for (const im of own) {
      const src = im.getAttribute('src') ?? '';
      const alt = im.getAttribute('alt') ?? undefined;
      if (src) images.push({ src, alt });
    }
  };

  /** Einen Absatz-artigen Knoten in genau einen Block gießen */
  const leafBlock = (el: HTMLElement, forcedType?: string, extraProps?: Record<string, unknown>): Block | null => {
    const segs: Seg[] = [];
    for (const c of Array.from(el.childNodes)) collectSegs(c, {}, segs);
    const content = toContent(segs);
    if (content === '' && !forcedType) return null;   // leere Absätze schlucken
    const tag = el.tagName;
    let type = forcedType ?? 'paragraph';
    const props: Record<string, unknown> = { ...extraProps };
    if (!forcedType && /^H[1-6]$/.test(tag)) {
      type = 'heading';
      // BlockNote kennt nur 1–3
      props.level = Math.min(3, Math.max(1, Number(tag[1])));
    }
    const b: Block = { type, content };
    if (Object.keys(props).length > 0) b.props = props;
    return b;
  };

  /** Listen (auch verschachtelte) einsammeln */
  const walkList = (list: HTMLElement, ordered: boolean, into: Block[]): void => {
    for (const li of Array.from(list.children)) {
      if (li.tagName !== 'LI') continue;
      const el = li as HTMLElement;
      const state = checkState(el);
      const type = state.is ? 'checkListItem' : ordered ? 'numberedListItem' : 'bulletListItem';
      const block = leafBlock(el, type, state.is ? { checked: state.checked } : undefined);
      if (!block) continue;
      const kids: Block[] = [];
      for (const sub of Array.from(el.children)) {
        if (sub.tagName === 'UL') walkList(sub as HTMLElement, false, kids);
        else if (sub.tagName === 'OL') walkList(sub as HTMLElement, true, kids);
        else if (sub.tagName === 'TABLE') { const t = tableBlock(sub as HTMLTableElement); if (t) kids.push(t); }
      }
      if (kids.length > 0) block.children = kids;
      into.push(block);
    }
  };

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = squash(node.nodeValue ?? '').trim();
      if (t) push({ type: 'paragraph', content: t });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;

    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD' || tag === 'NOSCRIPT') return;

    if (tag === 'IMG') {
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? undefined;
      if (src) images.push({ src, alt });
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      harvestImages(el);
      const into: Block[] = [];
      walkList(el, tag === 'OL', into);
      for (const b of into) push(b);
      return;
    }
    if (tag === 'TABLE') { harvestImages(el); push(tableBlock(el as HTMLTableElement)); return; }
    if (tag === 'HR') { return; }

    // Absatz-artig UND ohne Block-Kinder → genau ein Block.
    // OneNote verschachtelt Absätze gern in positionierte <div>-Container;
    // die laufen hier als reine Durchreiche weiter.
    const hasBlockChild = Array.from(el.children).some((c) => BLOCKISH.has(c.tagName) && c.tagName !== 'BR');
    const isLeafish = /^(P|H[1-6]|BLOCKQUOTE|PRE|FIGCAPTION|DIV|SECTION|ARTICLE|TD|TH|LI)$/.test(tag);

    if (isLeafish && !hasBlockChild) {
      harvestImages(el);   // Bilder stecken fast immer IN einem Absatz
      const state = checkState(el);
      if (state.is) push(leafBlock(el, 'checkListItem', { checked: state.checked }));
      else push(leafBlock(el));
      return;
    }
    // Container: Kinder einzeln behandeln, aber eigenen direkten Text nicht verlieren
    for (const c of Array.from(el.childNodes)) walk(c);
  };

  for (const c of Array.from(doc.body.childNodes)) walk(c);

  // Mehrfache Leerzeilen zusammenziehen; führende/abschließende entfernen
  const tidy = blocks.filter((b, i) => {
    if (b.type !== 'paragraph') return true;
    const empty = contentText(b.content as string | Seg[]).trim() === '';
    if (!empty) return true;
    const prev = blocks[i - 1];
    return !!prev && prev.type === 'paragraph' && contentText(prev.content as string | Seg[]).trim() !== '';
  });
  while (tidy.length > 0 && tidy[0].type === 'paragraph' && contentText(tidy[0].content as string | Seg[]).trim() === '') tidy.shift();
  while (tidy.length > 0 && tidy[tidy.length - 1].type === 'paragraph' && contentText(tidy[tidy.length - 1].content as string | Seg[]).trim() === '') tidy.pop();

  return { blocks: sanitizeBlocks(tidy), images };
}

/**
 * Letzte Sicherung vor dem Editor: Nur bekannte Typen, gültige Props.
 * Ein einziger unbekannter Blocktyp lässt BlockNote beim Mount werfen — und
 * da die App keine Fehlergrenze hat, bliebe ein weißer Bildschirm. Diese
 * Funktion ist deshalb auch für fremde Block-Listen gedacht (Sicherheitsnetz).
 */
export function sanitizeBlocks(blocks: unknown): Block[] {
  if (!Array.isArray(blocks)) return [];
  const out: Block[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') continue;
    const b = { ...(raw as Block) };
    const type = typeof b.type === 'string' ? b.type : 'paragraph';
    const props = (b.props && typeof b.props === 'object' ? { ...(b.props as Record<string, unknown>) } : {}) as Record<string, unknown>;

    if (!SAFE_TYPES.has(type)) {
      // Nicht wegwerfen: Inhalt retten, damit Suche und Export ihn sehen
      const text = contentText((b.content ?? '') as string | Seg[]);
      if (text.trim()) out.push({ type: 'paragraph', content: text });
      continue;
    }

    const next: Block = { type };
    if (type === 'heading') {
      next.props = { level: Math.min(3, Math.max(1, Number(props.level ?? 3) || 3)) };
    } else if (type === 'checkListItem') {
      next.props = { checked: props.checked === true };
    } else if (type === 'numberedListItem') {
      // `start` ist listenspezifisch und macht BlockNote bei falschem Typ ärgerlich
      if (typeof props.start === 'number' && props.start > 1) next.props = { start: props.start };
    }

    if (type === 'table') {
      const c = b.content as { rows?: Array<{ cells?: unknown[] }> } | undefined;
      const rows = Array.isArray(c?.rows) ? c!.rows! : [];
      const cleanRows = rows
        .map((r) => ({
          cells: (Array.isArray(r?.cells) ? r.cells : []).map((cell) => {
            if (typeof cell === 'string') return cell ? [{ type: 'text', text: cell, styles: {} }] : [];
            if (Array.isArray(cell)) return cell.filter((s) => s && typeof s === 'object' && String((s as Seg).text ?? '') !== '');
            // tableCell-Objektform → auf Inline-Liste zurückführen
            const inner = (cell as { content?: unknown })?.content;
            if (Array.isArray(inner)) return inner.filter((s) => s && typeof s === 'object' && String((s as Seg).text ?? '') !== '');
            return [];
          }),
        }))
        .filter((r) => r.cells.length > 0);
      if (cleanRows.length === 0) continue;
      next.content = { type: 'tableContent', rows: cleanRows };
    } else {
      const c = b.content;
      if (typeof c === 'string') next.content = c;
      else if (Array.isArray(c)) {
        const segs = c
          .filter((s) => s && typeof s === 'object' && typeof (s as Seg).text === 'string' && (s as Seg).text !== '')
          .map((s) => ({ type: 'text', text: (s as Seg).text, styles: (s as Seg).styles ?? {} }));
        next.content = segs.length > 0 ? segs : '';
      } else next.content = '';
    }

    if (Array.isArray(b.children) && b.children.length > 0) {
      const kids = sanitizeBlocks(b.children);
      if (kids.length > 0) next.children = kids;
    }
    out.push(next);
  }
  return out;
}

/**
 * SCHONENDE Reparatur bestehender Blöcke (M184).
 *
 * Anders als `sanitizeBlocks` wird hier nichts normalisiert und nichts
 * weggeworfen: Block-IDs, Farben, Ausrichtung und alle übrigen Eigenschaften
 * bleiben unangetastet. Eingegriffen wird nur dort, wo BlockNote sonst beim
 * Aufbau des Editors WERFEN würde — und weil die App keine Fehlergrenze hat,
 * hieße das: weißer Bildschirm statt Notiz.
 *
 * Auslöser gab es genug: ein älterer Sync-Stand, eine fremde Board-Datei, ein
 * abgebrochener Import. Die Reparatur kostet fast nichts und macht den Start
 * unkaputtbar.
 */
export function repairBlocks(blocks: unknown): unknown[] {
  if (!Array.isArray(blocks)) return [];
  let touched = false;
  const walk = (list: unknown[]): unknown[] => list.map((raw) => {
    if (!raw || typeof raw !== 'object') { touched = true; return { type: 'paragraph', content: '' }; }
    const b = raw as Record<string, unknown>;
    const type = typeof b.type === 'string' ? b.type : 'paragraph';
    let next = b;

    if (!SAFE_TYPES.has(type) && type !== 'image' && type !== 'codeBlock' && type !== 'quote') {
      // Unbekannter Typ: Inhalt als Absatz retten (sonst wirft BlockNote hart)
      touched = true;
      const text = contentText((b.content ?? '') as string | Seg[]);
      return { ...b, type: 'paragraph', content: text };
    }
    if (type === 'heading') {
      const lvl = Number((b.props as Record<string, unknown> | undefined)?.level ?? 3);
      if (!Number.isFinite(lvl) || lvl < 1 || lvl > 3) {
        touched = true;
        next = { ...b, props: { ...(b.props as object ?? {}), level: Math.min(3, Math.max(1, Number.isFinite(lvl) ? lvl : 3)) } };
      }
    }
    if (type === 'checkListItem') {
      const p = (b.props ?? {}) as Record<string, unknown>;
      if (typeof p.checked !== 'boolean') {
        touched = true;
        next = { ...next, props: { ...p, checked: p.checked === true } };
      }
    }
    const kids = (next as Record<string, unknown>).children;
    if (Array.isArray(kids) && kids.length > 0) {
      const fixed = walk(kids);
      if (fixed !== kids) next = { ...next, children: fixed };
    }
    return next;
  });
  const out = walk(blocks);
  return touched ? out : blocks;
}
