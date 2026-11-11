// M344: Fanglinien — beim Ziehen rasten Karten an den Kanten und Mitten anderer Karten ein.
//
// Verglichen werden je Achse drei Stellen der gezogenen Karte (bzw. des Kastens um alle gezogenen
// Karten): Anfang, Mitte, Ende — gegen dieselben drei Stellen jeder anderen Karte. Die nächste
// Übereinstimmung innerhalb der Schwelle gewinnt; die Karte springt dorthin und eine Linie zeigt,
// woran sie sich ausrichtet. Strg (⌘) beim Ziehen schaltet das Einrasten ab.
export interface Kasten { x: number; y: number; w: number; h: number }
export interface Fanglinie { art: 'v' | 'h'; pos: number; von: number; bis: number }

let linien: Fanglinie[] = [];
const hoerer = new Set<() => void>();
export const fangLinien = (): Fanglinie[] => linien;
export function fangAbo(cb: () => void): () => void { hoerer.add(cb); return () => { hoerer.delete(cb); }; }
export function fangSetzen(neu: Fanglinie[]): void {
  if (neu.length === 0 && linien.length === 0) return;
  linien = neu;
  hoerer.forEach((h) => h());
}

const stellen = (anfang: number, laenge: number): number[] => [anfang, anfang + laenge / 2, anfang + laenge];

/** Versatz, der den Kasten an den anderen ausrichtet, und die Linien dazu */
export function fangen(k: Kasten, andere: Kasten[], schwelle: number): { dx: number; dy: number; linien: Fanglinie[] } {
  let dx = 0; let dy = 0;
  let bestX = schwelle + 1e-6; let bestY = schwelle + 1e-6;
  let zielX: number | null = null; let zielY: number | null = null;
  for (const a of andere) {
    for (const m of stellen(k.x, k.w)) for (const t of stellen(a.x, a.w)) {
      const d = Math.abs(t - m);
      if (d < bestX) { bestX = d; dx = t - m; zielX = t; }
    }
    for (const m of stellen(k.y, k.h)) for (const t of stellen(a.y, a.h)) {
      const d = Math.abs(t - m);
      if (d < bestY) { bestY = d; dy = t - m; zielY = t; }
    }
  }
  const neu: Kasten = { x: k.x + dx, y: k.y + dy, w: k.w, h: k.h };
  const out: Fanglinie[] = [];
  const nah = (a: number, b: number) => Math.abs(a - b) < 0.5;
  if (zielX != null) {
    // die Linie reicht über alle Karten, die an derselben Stelle liegen
    let von = neu.y; let bis = neu.y + neu.h;
    for (const a of andere) if (stellen(a.x, a.w).some((t) => nah(t, zielX!))) { von = Math.min(von, a.y); bis = Math.max(bis, a.y + a.h); }
    out.push({ art: 'v', pos: zielX, von, bis });
  }
  if (zielY != null) {
    let von = neu.x; let bis = neu.x + neu.w;
    for (const a of andere) if (stellen(a.y, a.h).some((t) => nah(t, zielY!))) { von = Math.min(von, a.x); bis = Math.max(bis, a.x + a.w); }
    out.push({ art: 'h', pos: zielY, von, bis });
  }
  return { dx, dy, linien: out };
}
