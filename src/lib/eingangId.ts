/**
 * M478: Kennung und Erkennung des Eingangs-Boards — bewusst ohne Importe, damit auch Module, die der Store selbst
 * lädt (Aufgaben, Termine, Übersicht), das System-Board ausblenden können, ohne einen Kreis zu bilden.
 *
 * Die Kennung ist auf allen Geräten dieselbe: Was am Telefon geteilt wird und über Konto/Ordner abgeglichen wird,
 * landet am PC im SELBEN Board (Drei-Wege-Abgleich je Karte, lib/syncMerge.ts) statt in einem zweiten Eingang.
 */
export const EINGANG_ID = 'pixinotes-eingang';

export const istEingang = (b: { id: string; system?: string } | null | undefined): boolean =>
  !!b && (b.id === EINGANG_ID || b.system === 'eingang');

/** Boards ohne den Eingang — dieselbe Liste (Referenz), wenn es keinen gibt (teure Ansichten hängen an ihr) */
export function ohneEingang<T extends { id: string; system?: string }>(boards: T[]): T[] {
  return boards.some(istEingang) ? boards.filter((b) => !istEingang(b)) : boards;
}
