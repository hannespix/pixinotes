/**
 * M501: Pixi, das Maskottchen — das Pixelbild.
 *
 * Herkunft: „Pix" aus hannespix/pix-el (`site/icons.js`, `MASCOT`, `mascotSvg()`), ein eigenes Werk des Nutzers,
 * mit seinem Einverständnis übernommen. Dort steht es im 16er-Raster. Hier liegt es im DOPPELTEN Raster (32 statt 16):
 * Körper, Kontur, Wangen und Antenne sind dieselben Pixel, nur jedes in vier Teile geteilt. So können die Augen in
 * halben Pixeln wandern (fünf Lagen je Richtung statt drei) — der Blick folgt dem Zeiger feiner, ohne dass das Bild
 * seine Pixel-Art verliert. Alles bleibt ganzzahlig, gezeichnet mit `shape-rendering: crispEdges`.
 *
 * Bewusst ohne JSX: Die Karte (PixiCard.tsx) und der Export (serialize.ts → als SVG-Bild) nutzen dieselben Pfade.
 */

/** Aus Zeilen ('#' = Pixel) einen SVG-Pfad machen — wie `iconPath` in pix-el, mit Versatz */
export function pfad(zeilen: string[], ox = 0, oy = 0): string {
  let d = '';
  zeilen.forEach((z, y) => {
    for (let x = 0; x < z.length; x++) {
      if (z[x] !== '#') continue;
      let n = 1;
      while (z[x + n] === '#') n++;
      d += `M${ox + x} ${oy + y}h${n}v1h-${n}z`;
      x += n - 1;
    }
  });
  return d;
}

/** Zeilen waagrecht spiegeln (rechtes Auge, linker Arm) */
const spiegel = (zeilen: string[]) => zeilen.map((z) => [...z].reverse().join(''));
/** Pfad an der senkrechten Mittelachse des Maskottchens (x = 16) spiegeln */
const gespiegelt = (zeilen: string[], ox: number, oy: number) => {
  const breite = Math.max(...zeilen.map((z) => z.length));
  return pfad(spiegel(zeilen.map((z) => z.padEnd(breite, '.'))), 32 - ox - breite, oy);
};

/** pix-el `MASCOT` (16er-Raster) — unverändert übernommen */
const MASCOT16 = {
  fill: 'M3 3h10v1h-10zM2 4h12v1h-12zM2 5h12v1h-12zM2 6h12v1h-12zM2 7h12v1h-12zM2 8h12v1h-12zM2 9h12v1h-12zM2 10h12v1h-12zM3 11h10v1h-10z',
  body: 'M8 1h1v1h-1zM3 2h10v1h-10zM2 3h1v1h-1zM13 3h1v1h-1zM1 4h1v1h-1zM14 4h1v1h-1zM1 5h1v1h-1zM14 5h1v1h-1zM1 6h1v1h-1zM14 6h1v1h-1zM1 7h1v1h-1zM14 7h1v1h-1zM1 8h1v1h-1zM14 8h1v1h-1zM1 9h1v1h-1zM14 9h1v1h-1zM1 10h1v1h-1zM14 10h1v1h-1zM2 11h1v1h-1zM13 11h1v1h-1zM3 12h10v1h-10zM4 13h2v1h-2zM10 13h2v1h-2zM3 14h3v1h-3zM10 14h3v1h-3z',
  cheeks: 'M3 9h2v1h-2zM11 9h2v1h-2z',
  tip: 'M9 0h1v1h-1z',
};
/** Jede Zahl des Pfads verdoppeln: dasselbe Bild im 32er-Raster (die Pfade bestehen nur aus M, h, v, z) */
const doppelt = (d: string) => d.replace(/-?\d+/g, (z) => String(Number(z) * 2));

/** Zeichenfläche: Platz rundum für Arme, Zzz, Noten und Herzen (Körper liegt in 0…32 × 0…30) */
export const ANSICHT = { x: -8, y: -16, w: 48, h: 48 } as const;
export const VIEWBOX = `${ANSICHT.x} ${ANSICHT.y} ${ANSICHT.w} ${ANSICHT.h}`;
/** Mitte zwischen den Augen im Bild — von hier aus schaut Pixi zum Zeiger */
export const AUGEN_MITTE = { x: 16, y: 12 } as const;

const L = { x: 8, y: 10 };   // linkes Auge (oben links), 4 × 4
const R = { x: 20, y: 10 };  // rechtes Auge
const MUND = { x: 12, y: 16 };

/** Augenformen: Zeilen relativ zur Augen-Ecke, Versatz für größere Formen. Rechts gespiegelt. */
const AUGEN_ZEILEN: Record<string, { z: string[]; ox?: number; oy?: number }> = {
  offen: { z: ['####', '####', '####', '####'] },
  zu: { z: ['####'], oy: 2 },
  froh: { z: ['.##.', '#..#'], oy: 1 },
  halb: { z: ['####', '####'], oy: 2 },
  gross: { z: ['####', '####', '####', '####', '####', '####'], oy: -1 },
  herz: { z: ['##.##', '#####', '#####', '.###.', '..#..'], ox: -1, oy: -1 },
  spirale: { z: ['######', '.....#', '.###.#', '.#.#.#', '.#...#', '.#####'], ox: -1, oy: -1 },
  kneifen: { z: ['##..', '..##', '##..'], oy: 1 },
};
export type PixiAugen = keyof typeof AUGEN_ZEILEN;
export const AUGEN = Object.keys(AUGEN_ZEILEN) as PixiAugen[];

/** Glanzpunkt (in Körperfarbe) — nur bei offenen und großen Augen */
const GLANZ: Partial<Record<PixiAugen, { x: number; y: number }>> = { offen: { x: 1, y: 1 }, gross: { x: 1, y: 0 } };

const MUENDER: Record<string, { z: string[]; oy?: number }> = {
  laecheln: { z: ['##....##', '##....##', '..####..', '..####..'] },
  grinsen: { z: ['##....##', '.######.', '..####..'] },
  o: { z: ['...##...', '..#..#..', '..#..#..', '...##...'] },
  gaehnen: { z: ['..####..', '.######.', '.######.', '.######.', '..####..'] },
  schief: { z: ['##..##..', '..##..##'], oy: 1 },
  pfeifen: { z: ['....##..', '...#..#.', '....##..'], oy: 1 },
  klein: { z: ['...##...'], oy: 2 },
};
export type PixiMund = keyof typeof MUENDER;
export const MUNDFORMEN = Object.keys(MUENDER) as PixiMund[];

/** Arme (außerhalb des Körpers): je zwei Bilder, die sich abwechseln. Rechts gezeichnet, links gespiegelt. */
const ARM_SCHRAEG = ['...##', '...##', '..##.', '..##.', '.##..', '.##..', '##...', '##...', '##...'];   // y 6…14
const ARM_GERADE = ['##', '##', '##', '##', '##', '##', '##', '##', '##', '##', '##'];                    // y 4…14
const ARM_UNTEN = ['##..', '.##.', '..##', '..##'];                                                       // y 15…18

export const TEILE = {
  fill: doppelt(MASCOT16.fill),
  kontur: doppelt(MASCOT16.body),
  wangen: doppelt(MASCOT16.cheeks),
  spitze: doppelt(MASCOT16.tip),
  /** Schatten unter den Füßen */
  schatten: pfad(['..################..', '....############....'], 6, 30),
  augen: Object.fromEntries(AUGEN.map((a) => {
    const v = AUGEN_ZEILEN[a];
    return [a, pfad(v.z, L.x + (v.ox ?? 0), L.y + (v.oy ?? 0)) + gespiegelt(v.z, L.x + (v.ox ?? 0), L.y + (v.oy ?? 0))];
  })) as Record<PixiAugen, string>,
  glanz: Object.fromEntries(Object.entries(GLANZ).map(([a, g]) => [a, pfad(['#'], L.x + g!.x, L.y + g!.y) + pfad(['#'], R.x + g!.x, R.y + g!.y)])) as Partial<Record<PixiAugen, string>>,
  muender: Object.fromEntries(MUNDFORMEN.map((m) => [m, pfad(MUENDER[m].z, MUND.x, MUND.y + (MUENDER[m].oy ?? 0))])) as Record<PixiMund, string>,
  arme: {
    rechtsSchraeg: pfad(ARM_SCHRAEG, 30, 6),
    rechtsGerade: pfad(ARM_GERADE, 30, 4),
    rechtsUnten: pfad(ARM_UNTEN, 30, 15),
    linksSchraeg: gespiegelt(ARM_SCHRAEG, 30, 6),
    linksGerade: gespiegelt(ARM_GERADE, 30, 4),
    linksUnten: gespiegelt(ARM_UNTEN, 30, 15),
  },
  effekte: {
    z1: pfad(['#####', '...#.', '..#..', '.#...', '#####'], 24, -6),
    z2: pfad(['####', '..#.', '.#..', '####'], 30, -11),
    z3: pfad(['###', '.#.', '###'], 35, -15),
    note1: pfad(['..##', '..#.', '..#.', '###.', '###.'], 31, -4),
    note2: pfad(['..##', '..#.', '..#.', '###.', '###.'], 24, -11),
    herz1: pfad(['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'], -6, -9),
    herz2: pfad(['##.##', '#####', '.###.', '..#..'], 31, -12),
    herz3: pfad(['##.##', '#####', '.###.', '..#..'], 12, -15),
    funkeA: pfad(['##'], 18, -4) + pfad(['##'], 18, -3) + pfad(['##', '##'], 14, 0) + pfad(['##', '##'], 22, 0),
    funkeB: pfad(['##', '##'], 15, -3) + pfad(['##', '##'], 21, -3) + pfad(['##'], 18, -7),
    ausruf: pfad(['##', '##', '##', '##', '..', '##'], 33, -12),
    puff: pfad(['##'], -6, 14) + pfad(['##'], -6, 15) + pfad(['##', '##'], -3, 18) + pfad(['##', '##'], -7, 21)
      + pfad(['##', '##'], 36, 14) + pfad(['##', '##'], 33, 18) + pfad(['##', '##'], 37, 21),
    sterneA: pfad(['.#.', '###', '.#.'], 1, -7) + pfad(['.#.', '###', '.#.'], 28, -7),
    sterneB: pfad(['.#.', '###', '.#.'], 14, -11) + pfad(['.#.', '###', '.#.'], 7, -4) + pfad(['.#.', '###', '.#.'], 23, -4),
    kicherA: pfad(['##'], -5, 9) + pfad(['##'], 35, 9),
    kicherB: pfad(['##'], -6, 13) + pfad(['##'], 36, 13),
  },
};

/**
 * Körperfarben zur Auswahl (gespeichert wird die Hex-Zahl — so sieht ein anderes Gerät dieselbe Farbe).
 * Ohne Wahl nimmt die Karte das Token `--pixi-koerper` (Hell/Dunkel).
 */
export const PIXI_FARBEN: Array<{ hex: string; name: string }> = [
  { hex: '#e3efa8', name: 'Display-Grün' },
  { hex: '#ffe9a6', name: 'Sonnengelb' },
  { hex: '#f7cfd9', name: 'Rosa' },
  { hex: '#cfe3f7', name: 'Himmelblau' },
  { hex: '#ece6f8', name: 'Flieder' },
];
/** Nur glatte Hex-Farben — alles andere (url(), var(), Text) fällt auf die Standardfarbe zurück */
export const pixiFarbe = (f: unknown): string | undefined => (typeof f === 'string' && /^#[0-9a-f]{6}$/i.test(f) ? f.toLowerCase() : undefined);

/** Feste Farben für das Standbild im Export (Datei, Präsentation ohne Board, Zwischenablage) */
const EXPORT = { koerper: '#e3efa8', tinte: '#0f380f', wangen: '#7a9a1c', spitze: '#e0b400', schatten: 'rgba(15,56,15,0.18)' };

/** M501: Pixi als eigenständige SVG-Datei (Export) — still, freundlich, ohne Bewegung */
export function pixiSvgText(farbe?: string, groesse = 192): string {
  const k = pixiFarbe(farbe) ?? EXPORT.koerper;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" width="${groesse}" height="${groesse}" shape-rendering="crispEdges">`
    + `<path fill="${EXPORT.schatten}" d="${TEILE.schatten}"/>`
    + `<path fill="${k}" d="${TEILE.fill}"/><path fill="${EXPORT.tinte}" d="${TEILE.kontur}"/>`
    + `<path fill="${EXPORT.wangen}" d="${TEILE.wangen}"/><path fill="${EXPORT.spitze}" d="${TEILE.spitze}"/>`
    + `<path fill="${EXPORT.tinte}" d="${TEILE.augen.offen}"/><path fill="${k}" d="${TEILE.glanz.offen}"/>`
    + `<path fill="${EXPORT.tinte}" d="${TEILE.muender.laecheln}"/></svg>`;
}

/** Als Bildadresse (data:) — für HTML-Export und Präsentation */
export const pixiBildAdresse = (farbe?: string, groesse?: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pixiSvgText(farbe, groesse))}`;
