// M350: Eigenes Rechtsklick-Menü statt des Browser-Menüs.
//
// Das Kontextmenü von Chrome („Zurück", „Seite speichern unter", „Untersuchen") hat auf einem
// Whiteboard nichts zu tun und schob sich bei jedem Rechtsklick zwischen die Bedienung. Es bleibt
// nur dort, wo es hilft: in Textfeldern und im Notiz-Text beim Schreiben (Rechtschreibung,
// Einfügen) — und mit Umschalt+Rechtsklick überall als Ausweg. Sonst öffnet PixiNotes sein eigenes
// Menü mit dem, was an dieser Stelle geht:
//   · Karte(n)        → das „Mehr"-Menü der Auswahl-Leiste, dazu Öffnen, Duplizieren, Teilen, Löschen
//   · freie Fläche    → Notiz hier, Modul hier einfügen, Einpassen, Alles auswählen, Zeichnen, Raster
//   · Verbindung      → Benennen, Löschen
//   · Baum, Kacheln   → das ⋯-Menü der Zeile (Board, Projekt, Bereich)
// Hier steht nur der gemeinsame Zustand; die Menüs bauen die Komponenten, die die Aktionen kennen.

export interface KontextOrt { x: number; y: number }
export type KontextZiel =
  | ({ art: 'flaeche' } & KontextOrt)
  | ({ art: 'kante'; id: string } & KontextOrt);

let ziel: KontextZiel | null = null;
const hoerer = new Set<() => void>();
export const kontextZiel = (): KontextZiel | null => ziel;
export function kontextAbo(cb: () => void): () => void { hoerer.add(cb); return () => { hoerer.delete(cb); }; }
export function kontextSetzen(z: KontextZiel | null): void {
  if (z === ziel) return;
  ziel = z;
  hoerer.forEach((h) => h());
}

/** Wunsch an die Auswahl-Leiste: ihr „Mehr"-Menü am Zeiger öffnen (sie entsteht evtl. erst mit der Auswahl) */
let kartenWunsch: (KontextOrt & { t: number }) | null = null;
export const KARTEN_EREIGNIS = 'pixinotes:karten-kontext';
export function kartenMenueWuenschen(o: KontextOrt): void {
  kartenWunsch = { ...o, t: Date.now() };
  window.dispatchEvent(new Event(KARTEN_EREIGNIS));
}
export function kartenWunschNehmen(): KontextOrt | null {
  const w = kartenWunsch;
  kartenWunsch = null;
  return w && Date.now() - w.t < 1500 ? { x: w.x, y: w.y } : null;
}

/** „Modul hier einfügen": Die Palette legt das nächste Modul an diesen Bildschirmpunkt statt in die Bildmitte */
let ablage: (KontextOrt & { t: number }) | null = null;
export const ablageSetzen = (o: KontextOrt): void => { ablage = { ...o, t: Date.now() }; };
export const ablageVerwerfen = (): void => { ablage = null; };
export function ablageNehmen(): KontextOrt | null {
  const a = ablage;
  ablage = null;
  return a && Date.now() - a.t < 120000 ? { x: a.x, y: a.y } : null;
}

/** Zeilen-Menüs (⋯) im Baum und in der Übersicht am Zeiger öffnen */
export const MENUE_HIER = 'pixinotes:menue-hier';
