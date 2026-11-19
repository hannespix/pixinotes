// M404: Das Mausrad zoomt gleichmäßig – unabhängig davon, wie die Maus eingestellt ist.
//
// Ein Rad-Ereignis trägt eine Strecke (deltaY), und die hängt an Maus, Treiber und Systemeinstellung: eine Raste
// meldet 100, 120 oder – bei „drei Zeilen je Raste" – 300; manche Browser zählen in Zeilen statt in Bildpunkten.
// Wer die Strecke direkt in einen Zoomfaktor umrechnet, zoomt je nach Gerät doppelt oder dreimal so weit, und mit
// Strg (dort war der Faktor für das feine Kneifen am Trackpad gedacht) sprang eine einzige Raste auf das Doppelte.
//
// Hier wird jede Raste zum selben Schritt: 14 %, egal was sie meldet. Feine Ereignisse – Kneifen am Trackpad,
// stufenlose Räder – bleiben proportional, aber nie mehr als eine Raste auf einmal. Das Board fährt die Rasten
// dann weich an (Board.tsx), statt zu springen.

/** Zoom einer Raste (als Exponent zur Basis 2): 14 % */
export const RAD_STUFE = Math.log2(1.14);
/** Höchste und niedrigste Zoomstufe des Boards (mal Anzeigegröße) */
export const BOARD_ZOOM_MAX = 6;
export const BOARD_ZOOM_MIN = 0.15;
/** Ab dieser Stufe wächst die Bedienung aufgeklappter Dokument-Karten nicht mehr mit */
export const BEDIENUNG_BIS = 1.3;

/**
 * Schritt eines Rad-Ereignisses: `hoch` ist der Exponent (Zoom mal 2^hoch), `raste`, ob es die Raste eines Mausrads
 * war (dann fährt das Board den Schritt weich an) oder ein feines Ereignis (das folgt dem Finger sofort).
 */
export function radSchritt(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): { hoch: number; raste: boolean } {
  // in Bildpunkte: eine Raste sind 100 – in Zeilen gezählt drei Zeilen, in Seiten eine
  const dy = e.deltaMode === 1 ? e.deltaY * (100 / 3) : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
  const betrag = Math.abs(dy);
  if (!betrag || !Number.isFinite(betrag)) return { hoch: 0, raste: false };
  const raste = betrag >= 40;
  // Kneifen am Trackpad kommt als Strg + kleine Werte und darf kräftiger wirken; alles andere im Maß der Raste
  const jePunkt = e.ctrlKey && !raste ? 0.01 : RAD_STUFE / 100;
  return { hoch: -Math.sign(dy) * Math.min(betrag * jePunkt, RAD_STUFE), raste };
}

/** Anteil des Wegs zum Ziel, den ein Bild von `ms` Dauer zurücklegt (weiches Anfahren, unabhängig von der Bildrate) */
export function radAnteil(ms: number): number {
  return 1 - Math.exp(-Math.max(0, Math.min(ms, 80)) / 55);
}

/** Maß, in dem die Bedienung einer Dokument-Karte dargestellt wird (1 = wächst mit; kleiner = bleibt auf dem Schirm gleich groß) */
export function bedienMass(rel: number): number {
  return rel <= BEDIENUNG_BIS ? 1 : Math.round((BEDIENUNG_BIS / rel) * 50) / 50;
}
