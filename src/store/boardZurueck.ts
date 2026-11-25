/**
 * M530: Ein gelöschtes Board zurückholen („Rückgängig" in der Meldung) — nachgeladen, das Start-Paket trägt nur den
 * Aufruf (struktur.ts `ebeneZurueck`). Das Board kommt mit Inhalt und Kennung an seine Stelle im Projekt zurück und ist
 * wieder offen, wenn es das vorher war. Auf anderen Geräten kommt es mit dem nächsten Abgleich wieder: Seine Grabsteine
 * reisen nur, solange es fehlt (lib/grabsteine.ts `grabsteineFuer`), und im Konto schreibt es der nächste Takt neu.
 */
import { t } from '../lib/sprache';
import { mutedHistory } from './verlauf';
import type { BoardDoc, Holen, Setzen } from './typen';

export interface BoardUndo { board: BoardDoc; index: number; projektId?: string; stelle: number; activeId: string }

export function boardZurueck(bu: BoardUndo, set: Setzen, get: Holen): void {
  const s = get();
  if (s.boards.some((b) => b.id === bu.board.id)) return;
  const boards = [...s.boards];
  boards.splice(Math.min(bu.index, boards.length), 0, bu.board);
  // In sein Projekt — gibt es das nicht mehr, ins erste (sonst stünde das Board nirgends in der Navigation)
  const da = s.spaces.some((sp) => sp.projects.some((p) => p.id === bu.projektId));
  let erstes = !da;
  const spaces = s.spaces.map((sp) => ({
    ...sp,
    projects: sp.projects.map((p) => {
      if (p.id !== bu.projektId && !erstes) return p;
      erstes = false;
      const ids = [...p.boardIds];
      ids.splice(da ? Math.min(bu.stelle, ids.length) : ids.length, 0, bu.board.id);
      return { ...p, boardIds: ids };
    }),
  }));
  mutedHistory(() => set({ boards, spaces, activeId: bu.activeId === bu.board.id ? bu.board.id : s.activeId }));
  get().showToast(t(`„${bu.board.name}" ist wieder da.`));
}
