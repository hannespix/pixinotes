// M200/M201: kuratierte Schrift-Stapel — EINE Quelle für Karten-Klassen
// (index.css pn-font-*), das Schrift-Menü der Auswahl-Leiste und die
// Inline-Stile im Notiz-Editor. Alle Schriften sind eingebettet (offline).
import type { CardFont } from '../types';

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
