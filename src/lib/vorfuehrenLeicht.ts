// M502: Der leichte Teil von „Folgt mir" (lib/vorfuehren.ts) für das Start-Paket.
//
// Vorführen, Live-Mauszeiger und Gruppenraum (Reaktionen, Timer) laufen nur in einem Live-Board — ihr Code (~50 KB
// Quelltext) kommt darum mit dem Live-Abgleich (lib/gastSync.ts startet sie, bevor er den ersten Kanal öffnet), nicht
// mit dem Start. Die App selbst muss beim Start nur wissen, ob ich gerade jemandem folge, der einen Vortrag hält
// (App.tsx → Praesentation). Das kann nur der Fall sein, wenn lib/vorfuehren.ts geladen ist und eine Meldung kam;
// bis dahin heißt die Antwort „nein". lib/vorfuehren.ts meldet sich hier beim Laden an.
import type { Zeiger } from './vorfuehren';

/** Ein Vorführender kam, ging oder änderte seine Ansicht: detail = boardId */
export const VORFUEHR_EREIGNIS = 'pixinotes:vorfuehren';

interface VorfuehrenKern { folgeIch(boardId: string): boolean; werFuehrtVor(boardId: string): Zeiger | null }
let kern: VorfuehrenKern | null = null;
/** lib/vorfuehren.ts ruft das beim Laden auf */
export function vorfuehrenAnmelden(k: VorfuehrenKern): void { kern = k; }
export const folgeIch = (boardId: string): boolean => kern?.folgeIch(boardId) ?? false;
export const werFuehrtVor = (boardId: string): Zeiger | null => kern?.werFuehrtVor(boardId) ?? null;
