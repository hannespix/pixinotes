// M464: Mauszeiger an einem Ort.
//
// Nutzermeldung: „Mauszeiger ist in manchen Modulen/Situationen in Windows kaum sichtbar". Ursache: Das
// System-Fadenkreuz von Windows (`cursor: crosshair`) ist ein 1-px-Kreuz, das die Pixel darunter invertiert —
// auf mittelgrauen Flächen, auf Screenshots und bei 150 % Anzeige verschwindet es fast. Eigene Zeiger stehen
// darum als CSS-Variablen im ersten `:root`-Block von src/styles/00-tokens.css (mit Doppelkontur, 24 px, Hotspot, System-
// Fallback); Inline-Styles nehmen sie über diese Namen. Regel: wo der Systemzeiger gut sichtbar ist (Pfeil,
// Hand, Text, cell, Größenpfeile), bleibt der Systemzeiger. `cursor: none` nur, wenn ein Ersatz sicher
// gezeichnet ist.
export const ZEIGER = {
  /** Zeichnen, Stift, Pins setzen, Verbinden: Fadenkreuz mit Kontur, dahinter `crosshair` */
  fadenkreuz: 'var(--zeiger-fadenkreuz)',
  /** Radierer: das System-`cell` (dickes weißes Plus mit schwarzem Rand) ist unter Windows gut sichtbar */
  radierer: 'cell',
} as const;
