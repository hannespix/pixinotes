// M356: Der Textmarker rastet auf die Textzeile ein — wie ein Leuchtstift mit Lineal.
//
// Ein freihändiger Markerstrich wackelt und macht den Text darunter eher unruhiger. Liegt er auf einer
// Zeile (Notiz, Word-Seite: Text aus dem DOM; PDF-Seite: Textlage aus der PDF), wird er beim Absetzen zum
// geraden Balken in Zeilenhöhe: genau über der Zeile, mit geraden Kanten, von Wortanfang bis Wortende.
// Liegt er UNTER der Zeile (Unterstreichen) oder auf freier Fläche, wird er nur begradigt.
export interface Kasten { l: number; t: number; r: number; b: number }
interface SeitenText { seite: number; breite: number; rects: Array<{ x: number; y: number; w: number; h: number }> }

/** Textlage der offenen PDF-Seite je Karte, in Seitenpunkten (Ursprung oben links) */
const seitenText = new Map<string, SeitenText>();
export function seitenTextMelden(nodeId: string, t: SeitenText | null): void {
  if (t) seitenText.set(nodeId, t); else seitenText.delete(nodeId);
}

/** Wort-Kästen des Textes in einem Element, soweit sie das senkrechte Band berühren (Bildschirm-Punkte) */
function domWoerter(wurzel: Element, oben: number, unten: number): Kasten[] {
  const out: Kasten[] = [];
  const lauf = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT);
  let n = 0;
  for (let k = lauf.nextNode(); k && n < 600; k = lauf.nextNode()) {
    const text = k.nodeValue ?? '';
    if (!text.trim()) continue;
    const el = k.parentElement;
    if (!el || el.closest('.notiz-striche, button, .card-grip, [aria-hidden="true"]')) continue;
    const er = el.getBoundingClientRect();
    if (er.bottom < oben || er.top > unten || er.width === 0) continue;
    n += 1;
    const r = document.createRange();
    for (const m of text.matchAll(/\S+/g)) {
      r.setStart(k, m.index ?? 0); r.setEnd(k, (m.index ?? 0) + m[0].length);
      for (const q of Array.from(r.getClientRects())) {
        if (q.width > 0 && q.bottom >= oben && q.top <= unten) out.push({ l: q.left, t: q.top, r: q.right, b: q.bottom });
      }
    }
  }
  return out;
}

/**
 * Ein waagerechter Markerstrich (Bildschirm-Punkte: von x1 bis x2 auf Höhe y) → die Zeile darunter.
 * Liefert den Balken (l…r, Mitte y, Höhe h) oder null, wenn dort kein Text liegt.
 */
export function markerEinrasten(x1: number, x2: number, y: number): { l: number; r: number; y: number; h: number } | null {
  const mx = (x1 + x2) / 2;
  const karte = document.elementsFromPoint(mx, y).map((e) => e.closest('.react-flow__node')).find(Boolean) as HTMLElement | undefined;
  if (!karte) return null;
  let kaesten: Kasten[] = [];
  let woerter = true;
  const leinwand = karte.querySelector('.pdf-seite canvas');
  const st = karte.dataset.id ? seitenText.get(karte.dataset.id) : undefined;
  if (leinwand && st && String(st.seite) === (karte.querySelector('.pdf-seite')?.getAttribute('data-seite') ?? '')) {
    const c = leinwand.getBoundingClientRect();
    const k = c.width / st.breite;
    kaesten = st.rects.map((q) => ({ l: c.left + q.x * k, t: c.top + q.y * k, r: c.left + (q.x + q.w) * k, b: c.top + (q.y + q.h) * k }))
      .filter((q) => q.b >= y - 40 && q.t <= y + 40);
    woerter = false;
  } else if (!leinwand) {
    kaesten = domWoerter(karte, y - 40, y + 40);
  }
  // Die Zeile: Kästen, in denen der Strich liegt — nicht im untersten Sechstel (das wäre Unterstreichen)
  const drin = kaesten.filter((q) => q.r > x1 && q.l < x2 && y >= q.t && y <= q.b - (q.b - q.t) * 0.16);
  if (drin.length === 0) return null;
  // bei überlappenden Zeilenkästen die, deren Mitte dem Strich am nächsten ist
  const beste = drin.reduce((a, q) => (Math.abs((q.t + q.b) / 2 - y) < Math.abs((a.t + a.b) / 2 - y) ? q : a));
  const mitte = (beste.t + beste.b) / 2; const hoehe = beste.b - beste.t;
  const zeile = kaesten.filter((q) => Math.abs((q.t + q.b) / 2 - mitte) < hoehe * 0.5 && q.r > x1 && q.l < x2
    // Wörter zählen, wenn der Strich ihre Mitte erreicht (oder das Wort den ganzen Strich enthält)
    && (!woerter || ((q.l + q.r) / 2 >= x1 && (q.l + q.r) / 2 <= x2) || (q.l <= x1 && q.r >= x2)));
  const gruppe = zeile.length ? zeile : [beste];
  let l = Math.min(...gruppe.map((q) => q.l)); let r = Math.max(...gruppe.map((q) => q.r));
  // PDF-Textläufe sind oft ganze Zeilen: dort gilt, was der Stift überstrichen hat — begrenzt auf die Zeile
  if (!woerter) { l = Math.max(l, x1); r = Math.min(r, x2); }
  if (r - l < 4) return null;
  const t = Math.min(...gruppe.map((q) => q.t)); const b = Math.max(...gruppe.map((q) => q.b));
  return { l: l - 1.5, r: r + 1.5, y: (t + b) / 2, h: b - t };
}
