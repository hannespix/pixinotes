// M424: Darstellung im Karten-Fokus — einstellbar wie in der Präsentation.
//
// Gemeldet: „Im Fokus-Modus wird der Inhalt immer auf die volle Seitenbreite gestreckt und das UI auch unnötig groß
// dargestellt. Man kann die Skalierung nicht umstellen … Immer Seitenbreite ist nicht immer sinnvoll! Bitte
// einstellbar machen wie beim Präsentationsmodus."
//
// Der Fokus streckt die Karte nicht selbst: Die Kamera fährt heran und zoomt (Board.tsx, M333/M413) — mit dem
// Zoom wird auch die Bedienung der Karte größer. Hier liegt die Wahl, wie weit: „Automatisch" (die bisherige Regel
// je Kartentyp), „Einpassen" (die ganze Karte), „Seitenbreite", „Originalgröße" (100 %) — dazu eine Stufe (− / +),
// die von dort aus vergrößert oder verkleinert. Die Darstellung gilt für alle Karten und bleibt auf dem Gerät
// gemerkt; die Stufe beginnt bei jeder Karte neu (wie bei den Folien der Präsentation).

export type FokusAnsicht = 'auto' | 'einpassen' | 'breite' | 'original';
export const FOKUS_ANSICHTEN: { id: FokusAnsicht; name: string; hinweis: string }[] = [
  { id: 'auto', name: 'Automatisch', hinweis: 'Je nach Karte: Text gut lesbar, Module mit Platz für Spalten' },
  { id: 'einpassen', name: 'Einpassen', hinweis: 'Die ganze Karte, so groß wie möglich' },
  { id: 'breite', name: 'Seitenbreite', hinweis: 'Die Karte so breit wie der Bildschirm' },
  { id: 'original', name: 'Originalgröße', hinweis: 'Wie auf dem Board (100 %) – Bedienung in normaler Größe' },
];

/** Board → Fokus-Leiste: die aktuelle Stufe (detail: { zoom }) */
export const FOKUS_ZOOM_EREIGNIS = 'pixinotes:fokus-zoom';
/** Fokus-Leiste → Board: Darstellung oder Stufe geändert — neu heranfahren */
export const FOKUS_ANSICHT_EREIGNIS = 'pixinotes:fokus-ansicht';

const SCHLUESSEL = 'pixinotes-fokus-ansicht';
const STUFE_MIN = 0.25;
const STUFE_MAX = 6;
let stufe = 1;

/** Die gemerkte Darstellung dieses Geräts */
export function fokusAnsicht(): FokusAnsicht {
  try {
    const v = localStorage.getItem(SCHLUESSEL);
    return v === 'einpassen' || v === 'breite' || v === 'original' ? v : 'auto';
  } catch { return 'auto'; }
}

/** Am Wurzelelement vermerken (das Stylesheet verbreitert Module am Telefon nur bei „Automatisch") */
export function fokusAnsichtMarkieren(a: FokusAnsicht = fokusAnsicht()): void {
  const r = document.documentElement;
  if (a === 'auto') delete r.dataset.fokusAnsicht; else r.dataset.fokusAnsicht = a;
}

const melden = () => window.dispatchEvent(new CustomEvent(FOKUS_ANSICHT_EREIGNIS));

export function fokusAnsichtSetzen(a: FokusAnsicht): void {
  try { if (a === 'auto') localStorage.removeItem(SCHLUESSEL); else localStorage.setItem(SCHLUESSEL, a); } catch { /* ohne Speicher gilt die Wahl bis zum Neuladen */ }
  stufe = 1;
  fokusAnsichtMarkieren(a);
  melden();
}

/** Vervielfacher auf die Darstellung (1 = genau die gewählte Darstellung) */
export function fokusStufe(): number { return stufe; }
export function fokusStufeMal(f: number): void {
  const neu = Math.max(STUFE_MIN, Math.min(STUFE_MAX, stufe * f));
  // nahe 1 einrasten — sonst bleibt man bei 98 % hängen
  stufe = Math.abs(neu - 1) < 0.04 ? 1 : neu;
  melden();
}
/** Zurück auf die gewählte Darstellung (ohne Meldung: beim Wechsel der Karte) */
export function fokusStufeLoesen(): void { stufe = 1; }

/**
 * Zoom der Kamera für eine Karte in der gewählten Darstellung.
 * `auto`: die bisherige Regel (Board.tsx); `passt`: ganze Karte; `inBreite`: Breite des Platzes.
 */
export function fokusZoomFuer(a: FokusAnsicht, auto: number, passt: number, inBreite: number): number {
  const basis = a === 'einpassen' ? passt : a === 'breite' ? inBreite : a === 'original' ? 1 : auto;
  return Math.max(0.15, basis * stufe);
}
