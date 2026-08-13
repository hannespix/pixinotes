// M200/M201: kuratierte Schrift-Stapel — EINE Quelle für Karten-Klassen
// (index.css pn-font-*), das Schrift-Menü der Auswahl-Leiste und die
// Inline-Stile im Notiz-Editor. Alle Schriften sind eingebettet (offline).
import type { CardFont, CardSize } from '../types';

export const FONT_STACKS: Record<CardFont, string> = {
  serif: "Georgia, 'Iowan Old Style', Cambria, 'Times New Roman', serif",
  lesbar: "'Atkinson Hyperlegible', system-ui, sans-serif",
  hand: "'Kalam', 'Segoe Print', 'Comic Sans MS', cursive",
  mono: "ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace",
};

export const FONT_LABELS: Record<CardFont, string> = {
  serif: 'Serifen',
  lesbar: 'Sehr gut lesbar',
  hand: 'Handschrift',
  mono: 'Monospace',
};

/** Inline-Textgrößen (M201) — relativ (em), damit sie mit der Karten-Größe
 *  (pn-size-*) sauber zusammenspielen statt sie zu überschreiben */
export const INLINE_SIZE_EM: Record<string, string> = {
  klein: '0.85em',
  gross: '1.3em',
  riesig: '1.7em',
};

/**
 * M267: Eine Leiter, überall dieselbe.
 *
 * Der Anlass ist ein User-Befund: „man kann kleiner oder größer machen... aber
 * nicht zurück auf standart". Die alten Größen-Knöpfe waren SCHALTER (klein /
 * groß / riesig, jeder für sich an und aus). Wer bei „groß" stand und kleiner
 * wollte, drückte „klein" — und landete eine Stufe UNTER Standard, ohne dass
 * Standard je als Ziel angeboten wurde. Zurück kam nur, wer zufällig genau den
 * Knopf noch einmal traf, der gerade an war.
 *
 * Deshalb ist Größe jetzt eine LEITER mit Standard als fester Sprosse in der
 * Mitte. − und ＋ gehen eine Sprosse; über Standard führt der Weg immer
 * hindurch, nie daran vorbei. Dieselbe Leiter, dieselben Wörter, dieselbe
 * Reihenfolge gelten für den markierten Text UND für die ganze Karte — vorher
 * hieß dasselbe hier „A₋/A₊/A₊₊" und dort „S/M/L/XL".
 *
 * `null` ist Standard und wird bewusst mitgeführt statt weggelassen: Standard
 * ist eine WAHL, kein Fehlen einer Wahl, und muss im Menü anklickbar sein.
 */
export type Stufe<T> = { wert: T | null; label: string };

/** Leiter für markierten Text (Inline-Stile im Notiz-Editor) */
export const GROESSEN_TEXT: Array<Stufe<string>> = [
  { wert: 'klein', label: 'Klein' },
  { wert: null, label: 'Standard' },
  { wert: 'gross', label: 'Groß' },
  { wert: 'riesig', label: 'Riesig' },
];

/** Leiter für die ganze Karte — gleiche Wörter, gleiche Reihenfolge */
export const GROESSEN_KARTE: Array<Stufe<CardSize>> = [
  { wert: 's', label: 'Klein' },
  { wert: null, label: 'Standard' },
  { wert: 'l', label: 'Groß' },
  { wert: 'xl', label: 'Riesig' },
];

/** Schriftauswahl — Standard steht oben und ist anklickbar */
export const SCHRIFTEN: Array<Stufe<CardFont>> = [
  { wert: null, label: 'Standard' },
  { wert: 'serif', label: 'Serifen' },
  { wert: 'lesbar', label: 'Sehr gut lesbar' },
  { wert: 'hand', label: 'Handschrift' },
  { wert: 'mono', label: 'Monospace' },
];

/**
 * Eine Sprosse weiter — ohne Umlauf.
 *
 * Am Ende der Leiter passiert nichts mehr (statt heimlich ans andere Ende zu
 * springen): Ein Knopf, der bei „Riesig" plötzlich „Klein" macht, verliert den
 * Nutzer. Die Knöpfe werden dort stattdessen ausgegraut.
 */
export function stufeWeiter<T>(leiter: Array<Stufe<T>>, aktuell: T | null, richtung: 1 | -1): T | null | undefined {
  const i = leiter.findIndex((s) => s.wert === (aktuell ?? null));
  const ziel = (i < 0 ? leiter.findIndex((s) => s.wert === null) : i) + richtung;
  if (ziel < 0 || ziel >= leiter.length) return undefined;    // Ende der Leiter
  return leiter[ziel].wert;
}

/** Name der aktuellen Sprosse — für Kurzhinweise und die Anzeige im Menü */
export function stufenName<T>(leiter: Array<Stufe<T>>, aktuell: T | null | undefined): string {
  return leiter.find((s) => s.wert === (aktuell ?? null))?.label ?? 'Gemischt';
}
