/**
 * M304: Das Netz als Landkarte mit Inseln.
 *
 * Vorher kannte die Startlage weder Bereiche noch Projekte: Die Boards lagen
 * auf einem Kreis in Speicher-Reihenfolge, dann zogen Federn und Abstoßung
 * daran. Ein Wikilink von „Amrum 2026" (Privat) auf „Jour Fixe" (Arbeit) zog
 * das Urlaubsboard mitten in die Arbeit, und die Bereichs-Hülle wurde zur
 * langen Sichel quer über die andere. Die Live-Physik hatte dasselbe Problem:
 * Federn (0,04) schlugen die Cluster-Schwerkraft (0,015), und nichts hielt
 * zwei Projekte auseinander.
 *
 * Jetzt gilt EINE Physik für Startlage und Live-Schleife (netzSchritt):
 *   - Abstoßung zwischen allen Boards wie bisher, dazu eine Kollision über den
 *     Fußabdruck (Kugel + Satelliten + Beschriftung): nichts liegt übereinander;
 *   - Federn nach Verwandtschaft: im Projekt voll, im Bereich schwach, quer
 *     über Bereiche nur ein Hauch. Die Linie bleibt, sie verzerrt aber nichts;
 *   - Schwerkraft zum eigenen Projekt und zum eigenen Bereich;
 *   - Abstand zwischen Projekten und zwischen Bereichen: Wo sich zwei Gruppen
 *     (Mittelpunkt + Radius + Hüllen-Rand) berühren würden, rücken sie als
 *     Ganzes auseinander. So überlappen sich die Hüllen nie.
 * Die Startlage (netzStartlage) baut erst die Ordnung nach: Boards im Ring um
 * ihr Projekt, Projekte im Ring um ihren Bereich, Bereiche nebeneinander, und
 * lässt dann dieselbe Physik ausschwingen. Was die Live-Schleife zeigt, ist
 * damit von Anfang an im Gleichgewicht: nichts zappelt beim Laden.
 *
 * Kollision und Gruppen-Abstand arbeiten auf den POSITIONEN (wie d3-collide),
 * nicht auf den Geschwindigkeiten: Eine Kraft, die sich über die Dämpfung
 * aufschaukelt, drückt sonst gegen die Schwerkraft ins Dauer-Überlappen.
 */

export interface Pt { x: number; y: number }
export interface NetzKnoten extends Pt { vx: number; vy: number; fx?: number; fy?: number }
export interface NetzKante { a: string; b: string; kind: 'portal' | 'wikilink' | 'vorschlag' }

export interface NetzGruppe { id: string; boardIds: string[] }
export interface NetzBereich { id: string; projekte: NetzGruppe[] }
/** Zugehörigkeit je Board, in der Reihenfolge der Navigation */
export interface NetzGliederung {
  bereiche: NetzBereich[];
  projektVon: Map<string, string>;
  bereichVon: Map<string, string>;
}
export interface NetzOptionen {
  /** Fußabdruck je Board in SVG-Einheiten: Kugel + Satelliten + Beschriftung */
  fuss: (id: string) => number;
  /** Mitte der Fläche: hält das Netz an Ort und Stelle */
  mitte: Pt;
}

/** Rand der Hüllen um die Fußabdrücke (SVG-Einheiten) */
export const HUELLE_PROJEKT = 22;
export const HUELLE_BEREICH = 48;
/** Luft zwischen zwei Projekten eines Bereichs bzw. zwischen zwei Bereichen */
const LUFT_PROJEKT = 26;
const LUFT_BEREICH = 70;
/** Luft zwischen zwei Fußabdrücken */
const LUFT_BOARD = 12;

/**
 * Zugehörigkeit aus der Navigation, beschränkt auf die Boards im Netz.
 * Boards ohne Projekt (sollte es nicht geben, gab es aber) bilden einen
 * eigenen Bereich „lose", damit sie eine Heimat haben.
 */
export function gliederungAus(
  spaces: ReadonlyArray<{ id: string; projects: ReadonlyArray<{ id: string; boardIds: ReadonlyArray<string> }> }>,
  ids: Iterable<string>,
): NetzGliederung {
  const alle = new Set(ids);
  const projektVon = new Map<string, string>();
  const bereichVon = new Map<string, string>();
  const bereiche: NetzBereich[] = [];
  for (const sp of spaces) {
    const projekte: NetzGruppe[] = [];
    for (const p of sp.projects) {
      const boardIds = p.boardIds.filter((id) => alle.has(id) && !projektVon.has(id));
      if (boardIds.length === 0) continue;
      for (const id of boardIds) { projektVon.set(id, p.id); bereichVon.set(id, sp.id); }
      projekte.push({ id: p.id, boardIds });
    }
    if (projekte.length) bereiche.push({ id: sp.id, projekte });
  }
  const lose = [...alle].filter((id) => !projektVon.has(id));
  if (lose.length) {
    for (const id of lose) { projektVon.set(id, '_lose'); bereichVon.set(id, '_lose'); }
    bereiche.push({ id: '_lose', projekte: [{ id: '_lose', boardIds: lose }] });
  }
  return { bereiche, projektVon, bereichVon };
}

/** Eine Gruppe als Kreis: Schwerpunkt, Radius bis zum äußersten Fußabdruck plus Hüllen-Rand */
interface Kreis { x: number; y: number; r: number; n: number; ids: string[] }
function gruppenKreis(ids: string[], m: Map<string, NetzKnoten>, fuss: (id: string) => number, rand: number): Kreis | null {
  // Ein Knoten am Finger zählt nicht mit: Sonst bläht er den Kreis seiner
  // Gruppe auf, und die ganze Karte rückt beim Ziehen auseinander.
  const frei = ids.filter((id) => { const p = m.get(id); return p && p.fx == null; });
  if (frei.length === 0) return null;
  let x = 0, y = 0;
  for (const id of frei) { const p = m.get(id)!; x += p.x; y += p.y; }
  x /= frei.length; y /= frei.length;
  let r = 0;
  for (const id of frei) { const p = m.get(id)!; r = Math.max(r, Math.hypot(p.x - x, p.y - y) + fuss(id)); }
  return { x, y, r: r + rand, n: frei.length, ids };
}

/** Zwei Gruppen, die sich berühren würden, rücken als Ganzes auseinander:
 *  die kleinere weiter als die große, festgehaltene Knoten bleiben stehen. */
function auseinander(A: Kreis, B: Kreis, luft: number, m: Map<string, NetzKnoten>) {
  let dx = A.x - B.x, dy = A.y - B.y;
  let d = Math.hypot(dx, dy);
  if (d < 1) { dx = 1; dy = 0; d = 1; }
  const fehlt = A.r + B.r + luft - d;
  if (fehlt <= 0) return;
  const s = fehlt * 0.5;
  const ux = dx / d, uy = dy / d;
  const teilA = B.n / (A.n + B.n), teilB = A.n / (A.n + B.n);
  for (const id of A.ids) {
    const p = m.get(id);
    if (p && p.fx == null) { p.x += ux * s * teilA; p.y += uy * s * teilA; }
  }
  for (const id of B.ids) {
    const p = m.get(id);
    if (p && p.fx == null) { p.x -= ux * s * teilB; p.y -= uy * s * teilB; }
  }
}

/**
 * Ein Schritt der Physik. `a` ist die Energie (1 = frisch, gegen 0 = Ruhe);
 * Kräfte auf die Geschwindigkeit skalieren damit, die Positions-Korrekturen
 * (Kollision, Gruppen-Abstand) nicht: Überlappen soll auch am Ende weg sein.
 */
export function netzSchritt(
  m: Map<string, NetzKnoten>,
  kanten: readonly NetzKante[],
  g: NetzGliederung,
  o: NetzOptionen,
  a: number,
): void {
  const arr = [...m.entries()];
  const { fuss } = o;
  // Abstoßung zwischen allen Paaren (Board-Zahlen bleiben klein genug)
  for (let i = 0; i < arr.length; i += 1) {
    const A = arr[i][1];
    for (let j = i + 1; j < arr.length; j += 1) {
      const B = arr[j][1];
      let dx = A.x - B.x, dy = A.y - B.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.sin(i * 7 + j) || 0.5; dy = Math.cos(i + j * 5) || 0.5; d2 = 1; }
      const f = (14000 / d2) * a;
      const d = Math.sqrt(d2);
      A.vx += (dx / d) * f; A.vy += (dy / d) * f;
      B.vx -= (dx / d) * f; B.vy -= (dy / d) * f;
    }
  }
  // Federn nach Verwandtschaft: Vorschläge sind Angebote, keine Kräfte
  for (const l of kanten) {
    if (l.kind === 'vorschlag') continue;
    const A = m.get(l.a), B = m.get(l.b);
    if (!A || !B) continue;
    const gleichesProjekt = g.projektVon.get(l.a) === g.projektVon.get(l.b);
    const gleicherBereich = g.bereichVon.get(l.a) === g.bereichVon.get(l.b);
    const k = gleichesProjekt ? 0.04 : gleicherBereich ? 0.01 : 0.001;
    const ruhe = gleichesProjekt ? 190 : gleicherBereich ? 240 : 400;
    const dx = B.x - A.x, dy = B.y - A.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    // gedeckelt: Eine lange Quer-Verbindung darf ziehen, aber nicht schleppen
    const f = (Math.max(-300, Math.min(300, d - ruhe)) / d) * k * a;
    A.vx += dx * f; A.vy += dy * f;
    B.vx -= dx * f; B.vy -= dy * f;
  }
  // Schwerkraft zum Projekt, zum Bereich und (je Bereich gleichmäßig) zur Mitte
  const projekte: Kreis[][] = [];
  const bereiche: Kreis[] = [];
  for (const sp of g.bereiche) {
    const pk: Kreis[] = [];
    for (const pr of sp.projekte) {
      const k = gruppenKreis(pr.boardIds, m, fuss, HUELLE_PROJEKT);
      if (k) pk.push(k);
    }
    projekte.push(pk);
    for (const k of pk) {
      if (k.n < 2) continue;
      for (const id of k.ids) {
        const p = m.get(id);
        if (!p) continue;
        p.vx += (k.x - p.x) * 0.006 * a; p.vy += (k.y - p.y) * 0.006 * a;
        // Leine: Wer weit außerhalb des Kreises der ANDEREN liegt (losgelassen
        // in einem fremden Bereich), wird kräftig heimgeholt. Innerhalb gilt
        // nur die sanfte Schwerkraft oben.
        const andere = gruppenKreis(k.ids.filter((x) => x !== id), m, fuss, 0);
        if (!andere) continue;
        const dx = andere.x - p.x, dy = andere.y - p.y;
        const d = Math.hypot(dx, dy);
        const weit = d - (andere.r + fuss(id) + LUFT_BOARD + 40);
        if (weit <= 0) continue;
        const f = (Math.min(weit, 200) * 0.03 * Math.max(a, 0.3)) / d;
        p.vx += dx * f; p.vy += dy * f;
      }
    }
    // Dieselbe Leine eine Ebene höher: Ein Projekt, das weit außerhalb der
    // anderen Projekte seines Bereichs liegt, kehrt als Ganzes zurück.
    if (pk.length > 1) {
      for (let i = 0; i < pk.length; i += 1) {
        const k = pk[i];
        const andere = gruppenKreis(sp.projekte.filter((_, j) => j !== i).flatMap((p) => p.boardIds), m, fuss, 0);
        if (!andere) continue;
        const dx = andere.x - k.x, dy = andere.y - k.y;
        const d = Math.hypot(dx, dy);
        const weit = d - (andere.r + k.r + LUFT_PROJEKT + 40);
        if (weit <= 0) continue;
        const f = (Math.min(weit, 200) * 0.03 * Math.max(a, 0.3)) / d;
        for (const id of k.ids) { const p = m.get(id); if (p) { p.vx += dx * f; p.vy += dy * f; } }
      }
    }
    const ks = gruppenKreis(sp.projekte.flatMap((p) => p.boardIds), m, fuss, HUELLE_BEREICH);
    if (!ks) continue;
    bereiche.push(ks);
    const zx = (o.mitte.x - ks.x) * 0.0022 * a, zy = (o.mitte.y - ks.y) * 0.0022 * a;
    for (const id of ks.ids) {
      const p = m.get(id);
      if (!p) continue;
      if (pk.length > 1) { p.vx += (ks.x - p.x) * 0.003 * a; p.vy += (ks.y - p.y) * 0.003 * a; }
      p.vx += zx; p.vy += zy;
    }
  }
  // Integrieren + Dämpfung; festgehaltene Knoten (Drag) bleiben am Finger
  for (const p of m.values()) {
    if (p.fx != null && p.fy != null) { p.x = p.fx; p.y = p.fy; p.vx = 0; p.vy = 0; continue; }
    p.vx *= 0.82; p.vy *= 0.82;
    p.x += p.vx; p.y += p.vy;
  }
  // Kollision der Fußabdrücke: direkt auseinanderrücken
  for (let i = 0; i < arr.length; i += 1) {
    const [ia, A] = arr[i];
    const fa = fuss(ia);
    for (let j = i + 1; j < arr.length; j += 1) {
      const [ib, B] = arr[j];
      const need = fa + fuss(ib) + LUFT_BOARD;
      let dx = A.x - B.x, dy = A.y - B.y;
      let d = Math.hypot(dx, dy);
      if (d >= need) continue;
      if (d < 1) { dx = Math.sin(i * 7 + j) || 0.5; dy = Math.cos(i + j * 5) || 0.5; d = Math.hypot(dx, dy); }
      const s = (need - d) * 0.5;
      const ux = dx / d, uy = dy / d;
      const aFest = A.fx != null, bFest = B.fx != null;
      if (aFest && bFest) continue;
      if (aFest) { B.x -= ux * s; B.y -= uy * s; continue; }
      if (bFest) { A.x += ux * s; A.y += uy * s; continue; }
      A.x += ux * s * 0.5; A.y += uy * s * 0.5;
      B.x -= ux * s * 0.5; B.y -= uy * s * 0.5;
    }
  }
  // Abstand der Gruppen: Projekte im Bereich, dann die Bereiche untereinander.
  // Die Kreise sind aus den Positionen VOR der Kollision gerechnet: gut genug,
  // beim nächsten Schritt stimmt es wieder.
  for (const pk of projekte) {
    for (let i = 0; i < pk.length; i += 1) for (let j = i + 1; j < pk.length; j += 1) auseinander(pk[i], pk[j], LUFT_PROJEKT, m);
  }
  for (let i = 0; i < bereiche.length; i += 1) for (let j = i + 1; j < bereiche.length; j += 1) auseinander(bereiche[i], bereiche[j], LUFT_BEREICH, m);
}

/** Kreisförmige Anordnung von Gruppen: nebeneinander, ohne dass sich ihre Radien berühren */
function ring(radien: number[], luft: number): { lage: Pt[]; radius: number } {
  const n = radien.length;
  if (n === 0) return { lage: [], radius: 0 };
  if (n === 1) return { lage: [{ x: 0, y: 0 }], radius: radien[0] };
  if (n === 2) {
    const d = radien[0] + radien[1] + luft;
    return { lage: [{ x: -d / 2, y: 0 }, { x: d / 2, y: 0 }], radius: d / 2 + Math.max(radien[0], radien[1]) };
  }
  let R = 0;
  for (let i = 0; i < n; i += 1) {
    const paar = radien[i] + radien[(i + 1) % n] + luft;
    R = Math.max(R, paar / (2 * Math.sin(Math.PI / n)));
  }
  const lage = radien.map((_, i) => {
    const w = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: Math.cos(w) * R, y: Math.sin(w) * R };
  });
  return { lage, radius: R + Math.max(...radien) };
}

/**
 * Startlage: die Ordnung als Inseln, danach mit derselben Physik ausgeschwungen.
 * Deterministisch: Dieselben Daten ergeben immer dieselbe Karte.
 */
export function netzStartlage(
  ids: readonly string[],
  kanten: readonly NetzKante[],
  g: NetzGliederung,
  o: NetzOptionen,
): Map<string, Pt> {
  const m = new Map<string, NetzKnoten>();
  const bereichRadien: number[] = [];
  const bereichLagen: Array<Array<{ id: string; x: number; y: number }>> = [];
  for (const sp of g.bereiche) {
    const projRadien: number[] = [];
    const projLagen: Array<Array<{ id: string; x: number; y: number }>> = [];
    for (const pr of sp.projekte) {
      const r = ring(pr.boardIds.map((id) => o.fuss(id)), LUFT_BOARD);
      projLagen.push(pr.boardIds.map((id, i) => ({ id, ...r.lage[i] })));
      projRadien.push(r.radius + HUELLE_PROJEKT);
    }
    const r = ring(projRadien, LUFT_PROJEKT);
    bereichLagen.push(projLagen.flatMap((boards, i) => boards.map((b) => ({ id: b.id, x: b.x + r.lage[i].x, y: b.y + r.lage[i].y }))));
    bereichRadien.push(r.radius + HUELLE_BEREICH);
  }
  // Gleich um die Mitte gebaut, damit die Live-Schleife später nichts mehr
  // zu verschieben hat: Sie findet das Netz dort, wo ihre Kräfte es lassen.
  const r = ring(bereichRadien, LUFT_BEREICH);
  bereichLagen.forEach((boards, i) => {
    for (const b of boards) m.set(b.id, { x: o.mitte.x + b.x + r.lage[i].x, y: o.mitte.y + b.y + r.lage[i].y, vx: 0, vy: 0 });
  });
  // Boards, die die Gliederung nicht kennt (sollte nicht vorkommen): an den Rand
  let extra = 0;
  for (const id of ids) {
    if (m.has(id)) continue;
    extra += 1;
    m.set(id, { x: o.mitte.x + r.radius + 120 * extra, y: o.mitte.y, vx: 0, vy: 0 });
  }
  // Ausschwingen wie die Live-Schleife (die hält bei a < 0,005 an)
  let a = 1;
  for (let i = 0; i < 340; i += 1) { netzSchritt(m, kanten, g, o, a); a *= 0.985; }
  const out = new Map<string, Pt>();
  for (const [id, p] of m) out.set(id, { x: p.x, y: p.y });
  return out;
}

/** Umriss des ganzen Netzes samt Fußabdrücken und Hüllen-Rand: für „Alles einpassen" */
export function netzGrenzen(pos: Iterable<[string, Pt]>, fuss: (id: string) => number, rand = HUELLE_BEREICH + 24) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [id, p] of pos) {
    const f = fuss(id) + rand;
    x0 = Math.min(x0, p.x - f); y0 = Math.min(y0, p.y - f);
    x1 = Math.max(x1, p.x + f); y1 = Math.max(y1, p.y + f);
  }
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
