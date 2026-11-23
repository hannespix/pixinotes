/**
 * M500: Daten der Karte „Flüssige Schrift“ — gespeichert, abgeglichen und exportiert wird nur, was der Mensch
 * einstellt (Text und drei Optionen), nie der Zustand der Simulation. Leicht: kein Bezug zur Engine
 * (lib/fluessig/), damit Export, Suche, KI und MCP-Server die Karte lesen können, ohne WebGL zu laden.
 */
export type FluessigZaeh = 'fluessig' | 'mittel' | 'zaeh';
export type FluessigFarbe = 'schrift' | 'akzent';

export interface FluessigData {
  /** Der kurze Text (höchstens FLUESSIG_MAX Zeichen) */
  text: string;
  /** Zähigkeit — fehlt ⇒ „mittel“ (der abgestimmte Sweet Spot aus Liquid Type) */
  zaeh?: FluessigZaeh;
  /** Farbe der Flüssigkeit aus den Tokens — fehlt ⇒ Schriftfarbe */
  farbe?: FluessigFarbe;
  /** Tropfen fallen, eine unsichtbare Hand bewegt die Oberfläche — fehlt ⇒ aus (ruhiges Board, keine Rechenlast) */
  lebendig?: boolean;
  [key: string]: unknown;
}

export const FLUESSIG_MAX = 32;
export const FLUESSIG_START = 'Hallo';

/** Text säubern: keine Steuerzeichen, eine Zeile, höchstens FLUESSIG_MAX Zeichen (nach Zeichen, nicht Bytes) */
export function fluessigText(roh: unknown): string {
  const t = typeof roh === 'string' ? roh : '';
  // eslint-disable-next-line no-control-regex
  return Array.from(t.replace(/[\u0000-\u001f\u007f]+/g, ' ')).slice(0, FLUESSIG_MAX).join('');
}

/** Daten einer Karte fremder Herkunft (Sync, Datei, KI) in die bekannte Form bringen */
export function fluessigDaten(d: Partial<FluessigData> | undefined): { text: string; zaeh: FluessigZaeh; farbe: FluessigFarbe; lebendig: boolean } {
  const zaeh: FluessigZaeh = d?.zaeh === 'fluessig' || d?.zaeh === 'zaeh' ? d.zaeh : 'mittel';
  return { text: fluessigText(d?.text), zaeh, farbe: d?.farbe === 'akzent' ? 'akzent' : 'schrift', lebendig: d?.lebendig === true };
}
