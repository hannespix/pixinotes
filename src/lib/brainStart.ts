// M502: Der Start des „Gehirns" (semantischer Index, lib/brain.ts) — im Start-Paket nur dieser Wächter.
//
// lib/brain.ts (~16 KB Quelltext samt Einbettung, Index und Abfragen) tut nur etwas, wenn das Gehirn in den
// Einstellungen an ist; sein Abgleich kehrt sonst sofort zurück. Darum lädt es erst, wenn es gebraucht wird:
// Die Zeitpunkte (3,5 s nach dem Start, 12 s nach einer Änderung, sofort bei einem anderen Bereich, 1,5 s nach
// fertiger Texterkennung) sind dieselben wie vorher in `initBrain` (M204, M220, M465).
import { useBoard } from '../store';

let dirtyTimer: ReturnType<typeof setTimeout> | null = null;
/** Index abgleichen — lädt lib/brain.ts nur, wenn das Gehirn an ist */
function abgleichen(): void {
  if (!useBoard.getState().brain.on) return;
  void import('./brain').then((m) => m.syncBrainIndex()).catch(() => {});
}
function bald(ms: number): void {
  if (dirtyTimer) clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(abgleichen, ms);
}

/** Start: Erst-Indexierung kurz nach dem Boot, danach nach Änderungen (entprellt) */
export function initBrain(): void {
  setTimeout(abgleichen, 3500);
  useBoard.subscribe((s, prev) => {
    if (!s.brain.on || s.boards === prev.boards) return;
    bald(12_000);
  });
  // M220: Ein Bereich wurde zu-/abgeschaltet — SOFORT abgleichen, nicht erst nach der üblichen Wartezeit
  window.addEventListener('pixinotes:brain-scope', () => {
    if (dirtyTimer) clearTimeout(dirtyTimer);
    abgleichen();
  });
  // M465: Die Texterkennung eines Bildes ist fertig — bald neu einbetten, nicht erst nach zwölf Sekunden
  window.addEventListener('pixinotes:bildtext-fertig', () => {
    if (!useBoard.getState().brain.on) return;
    bald(1500);
  });
}
