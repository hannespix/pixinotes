// M344: Fanglinien — beim Ziehen rasten Karten an den Kanten und Mitten anderer Karten ein.
// M349: … und an ABSTÄNDEN: mittig zwischen zwei Nachbarn, und im gleichen Abstand wie die Nachbarn
//       untereinander (eine Reihe gleichmäßig fortsetzen). Wie in Figma zeigen Abstandsmarken mit Maß,
//       woran die Karte sich ausrichtet.
//
// Verglichen werden je Achse:
//   · Kanten  — Anfang, Mitte, Ende der gezogenen Karte (bzw. des Kastens um alle gezogenen) gegen
//               dieselben drei Stellen jeder anderen Karte;
//   · Mitte   — liegt die Karte in einer Reihe (Spalte) zwischen zwei Nachbarn, rastet sie dort ein, wo
//               links und rechts (oben und unten) gleich viel Luft bleibt;
//   · Abstand — hat der nächste Nachbar selbst einen Nachbarn in derselben Reihe, rastet die Karte im
//               selben Abstand dahinter ein (Reihen gleichmäßig fortsetzen), in beide Richtungen.
// Der nächste Treffer innerhalb der Schwelle gewinnt, für jede Achse unabhängig. Strg (⌘) schaltet ab.
export interface Kasten { x: number; y: number; w: number; h: number }
export interface Fanglinie { art: 'v' | 'h'; pos: number; von: number; bis: number }
/** Abstandsmarke: `h` waagerecht von x=von bis x=bis auf Höhe `quer`; `v` senkrecht von y=von bis y=bis bei x=`quer` */
export interface Abstand { art: 'h' | 'v'; von: number; bis: number; quer: number }
export interface Fang { linien: Fanglinie[]; abstaende: Abstand[] }

const LEER: Fang = { linien: [], abstaende: [] };
let stand: Fang = LEER;
const hoerer = new Set<() => void>();
export const fangStand = (): Fang => stand;
/** Kompatibel zu M344: nur die Linien */
export const fangLinien = (): Fanglinie[] => stand.linien;
export const fangAktiv = (): boolean => stand.linien.length > 0 || stand.abstaende.length > 0;
export function fangAbo(cb: () => void): () => void { hoerer.add(cb); return () => { hoerer.delete(cb); }; }
export function fangSetzen(neu: Fanglinie[] | Fang): void {
  const f: Fang = Array.isArray(neu) ? { linien: neu, abstaende: [] } : neu;
  if (f.linien.length === 0 && f.abstaende.length === 0) {
    if (stand === LEER) return;
    stand = LEER;
  } else stand = f;
  hoerer.forEach((h) => h());
}

const stellen = (anfang: number, laenge: number): number[] => [anfang, anfang + laenge / 2, anfang + laenge];

/** Eine Achse, damit waagerecht und senkrecht dieselbe Rechnung sind: a = Lage/Länge längs, q = quer */
interface Achse { a: number; l: number; q: number; ql: number }
const achse = (k: Kasten, waagerecht: boolean): Achse =>
  (waagerecht ? { a: k.x, l: k.w, q: k.y, ql: k.h } : { a: k.y, l: k.h, q: k.x, ql: k.w });
/** Überlappen sich zwei Kästen quer zur Achse (stehen sie in derselben Reihe bzw. Spalte)? */
const inReihe = (p: Achse, o: Achse): boolean => o.q < p.q + p.ql - 0.5 && o.q + o.ql > p.q + 0.5;
/** Mitte des gemeinsamen Querbereichs — dort steht die Abstandsmarke */
const querMitte = (p: Achse, o: Achse): number => (Math.max(p.q, o.q) + Math.min(p.q + p.ql, o.q + o.ql)) / 2;

type Treffer =
  | { art: 'kante'; d: number; ziel: number }
  | { art: 'mitte' | 'gleich'; d: number; marken: (neu: Achse) => Array<{ von: number; bis: number; quer: number }> };

/** Alle Treffer mit dem kleinsten Versatz — fallen Kante und Abstand auf dieselbe Stelle, zeigt die Anzeige beide */
function achseFangen(k: Kasten, andere: Kasten[], schwelle: number, waagerecht: boolean): Treffer[] {
  const p = achse(k, waagerecht);
  const os = andere.map((o) => achse(o, waagerecht));
  const alle: Treffer[] = [];
  const nimm = (t: Treffer) => { if (Math.abs(t.d) <= schwelle + 1e-6) alle.push(t); };
  // ── Kanten und Mitten ─────────────────────────────────────────────────────
  for (const o of os) {
    for (const m of stellen(p.a, p.l)) for (const t of stellen(o.a, o.l)) nimm({ art: 'kante', d: t - m, ziel: t });
  }
  // ── Abstände in der Reihe ─────────────────────────────────────────────────
  const reihe = os.filter((o) => inReihe(p, o));
  // nächster Nachbar davor (Ende ≤ eigener Anfang, mit Spielraum) und dahinter
  const vorher = reihe.filter((o) => o.a + o.l <= p.a + schwelle).sort((x, y) => (y.a + y.l) - (x.a + x.l))[0];
  const nachher = reihe.filter((o) => o.a >= p.a + p.l - schwelle).sort((x, y) => x.a - y.a)[0];
  if (vorher && nachher) {
    const luft = nachher.a - (vorher.a + vorher.l) - p.l;
    if (luft >= 0) {
      const ziel = vorher.a + vorher.l + luft / 2;
      nimm({
        art: 'mitte', d: ziel - p.a,
        marken: (n) => [
          { von: vorher.a + vorher.l, bis: n.a, quer: querMitte(n, vorher) },
          { von: n.a + n.l, bis: nachher.a, quer: querMitte(n, nachher) },
        ],
      });
    }
  }
  // Reihe fortsetzen: der Nachbar hat in SEINER Reihe einen Nachbarn — derselbe Abstand noch einmal
  if (vorher) {
    const vv = os.filter((o) => o !== vorher && inReihe(vorher, o) && o.a + o.l <= vorher.a + 0.5)
      .sort((x, y) => (y.a + y.l) - (x.a + x.l))[0];
    if (vv) {
      const gap = vorher.a - (vv.a + vv.l);
      if (gap > 0) {
        nimm({
          art: 'gleich', d: vorher.a + vorher.l + gap - p.a,
          marken: (n) => [
            { von: vv.a + vv.l, bis: vorher.a, quer: querMitte(vorher, vv) },
            { von: vorher.a + vorher.l, bis: n.a, quer: querMitte(n, vorher) },
          ],
        });
      }
    }
  }
  if (nachher) {
    const nn = os.filter((o) => o !== nachher && inReihe(nachher, o) && o.a >= nachher.a + nachher.l - 0.5)
      .sort((x, y) => x.a - y.a)[0];
    if (nn) {
      const gap = nn.a - (nachher.a + nachher.l);
      if (gap > 0) {
        nimm({
          art: 'gleich', d: nachher.a - gap - p.l - p.a,
          marken: (n) => [
            { von: n.a + n.l, bis: nachher.a, quer: querMitte(n, nachher) },
            { von: nachher.a + nachher.l, bis: nn.a, quer: querMitte(nachher, nn) },
          ],
        });
      }
    }
  }
  if (!alle.length) return [];
  const min = Math.min(...alle.map((t) => Math.abs(t.d)));
  const beste = alle.filter((t) => Math.abs(t.d) - min < 0.25);
  // derselbe Versatz für alle (der kleinste) — sonst stünden Linie und Marken einen Bruchteil daneben
  const d = beste.sort((x, y) => Math.abs(x.d) - Math.abs(y.d))[0].d;
  return beste.filter((t) => Math.abs(t.d - d) < 0.25);
}

/** Versatz, der den Kasten an den anderen ausrichtet, und was dabei zu zeigen ist */
export function fangen(k: Kasten, andere: Kasten[], schwelle: number): { dx: number; dy: number; linien: Fanglinie[]; abstaende: Abstand[] } {
  const tx = achseFangen(k, andere, schwelle, true);
  const ty = achseFangen(k, andere, schwelle, false);
  const dx = tx[0]?.d ?? 0; const dy = ty[0]?.d ?? 0;
  const neu: Kasten = { x: k.x + dx, y: k.y + dy, w: k.w, h: k.h };
  const linien: Fanglinie[] = [];
  const abstaende: Abstand[] = [];
  const nah = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const schon = new Set<string>();
  for (const t of tx) {
    if (t.art === 'kante') {
      // eine Linie je Achse (wie M344) — bei gleich breiten Karten fluchten sonst drei auf einmal
      if (schon.has('v')) continue;
      schon.add('v');
      // die Linie reicht über alle Karten, die an derselben Stelle liegen
      let von = neu.y; let bis = neu.y + neu.h;
      for (const a of andere) if (stellen(a.x, a.w).some((s) => nah(s, t.ziel))) { von = Math.min(von, a.y); bis = Math.max(bis, a.y + a.h); }
      linien.push({ art: 'v', pos: t.ziel, von, bis });
    } else for (const m of t.marken(achse(neu, true))) abstaende.push({ art: 'h', ...m });
  }
  for (const t of ty) {
    if (t.art === 'kante') {
      // eine Linie je Achse (wie M344) — bei gleich breiten Karten fluchten sonst drei auf einmal
      if (schon.has('h')) continue;
      schon.add('h');
      let von = neu.x; let bis = neu.x + neu.w;
      for (const a of andere) if (stellen(a.y, a.h).some((s) => nah(s, t.ziel))) { von = Math.min(von, a.x); bis = Math.max(bis, a.x + a.w); }
      linien.push({ art: 'h', pos: t.ziel, von, bis });
    } else for (const m of t.marken(achse(neu, false))) abstaende.push({ art: 'v', ...m });
  }
  // dieselbe Strecke nur einmal markieren
  const gesehen = new Set<string>();
  return { dx, dy, linien, abstaende: abstaende.filter((a) => { const s = `${a.art}${Math.round(a.von)}:${Math.round(a.bis)}:${Math.round(a.quer)}`; if (gesehen.has(s)) return false; gesehen.add(s); return true; }) };
}
