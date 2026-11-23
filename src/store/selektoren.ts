/**
 * Selektoren und kleine Hooks auf den Speicher (offenes Board, nur lesen, Karte fest).
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import { useEffect, useState } from 'react';
import type { BoardDoc, BoardState } from './typen';
import { GRUPPE_EREIGNIS, karteFest } from './schutz';
import { useBoard } from '../store';

export const selectActiveBoard = (s: BoardState): BoardDoc =>
  s.boards.find((b) => b.id === s.activeId) ?? s.boards[0];
/** M360: Das offene Board ist nur zum Lesen geteilt */
export const selectNurLesen = (s: BoardState): boolean => selectActiveBoard(s)?.geteiltRolle === 'lesen';
export const useNurLesen = (): boolean => useBoard(selectNurLesen);
/** M365: wie useNurLesen, aber für EINE Karte — auch fest, wenn Gäste hier nur Eigenes ändern dürfen */
export function useKarteFest(von: string | undefined): boolean {
  const nurLesen = useBoard(selectNurLesen);
  const boardId = useBoard((s) => s.activeId);
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(GRUPPE_EREIGNIS, auf);
    return () => window.removeEventListener(GRUPPE_EREIGNIS, auf);
  }, []);
  return nurLesen || karteFest(boardId, von);
}
