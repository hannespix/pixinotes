/**
 * M530: Ein Board löschen — mit „Rückgängig" in der Meldung (wie Bereich und Projekt), statt der Browser-Rückfrage
 * ohne Weg zurück. Nachgeladen (Start-JS, M446/M502); die Aktionen `removeBoard` und `ebeneZurueck` bleiben in
 * store/struktur.ts und rufen hierher.
 *
 * Zurück kommt das Board mit Inhalt und Kennung an seine Stelle im Projekt und ist wieder offen, wenn es das vorher
 * war. Auf anderen Geräten kommt es mit dem nächsten Abgleich wieder: Seine Grabsteine reisen nur, solange es fehlt
 * (lib/grabsteine.ts `grabsteineFuer`), und im Konto schreibt der nächste Takt die Board-Datei neu (Prüfreihe m530 K).
 */
import { t } from '../lib/sprache';
import { mutedHistory } from './verlauf';
import type { BoardDoc, Holen, Setzen } from './typen';

/** Stand vor dem letzten Löschen eines Boards — nur für die laufende Sitzung */
let weg: { board: BoardDoc; index: number; projektId?: string; stelle: number; activeId: string } | null = null;

export function boardLoeschen(id: string, set: Setzen, get: Holen): void {
  const s = get();
  const boards = s.boards;
  const board = boards.find((b) => b.id === id);
  const rest = boards.filter((b) => b.id !== id);
  // M390: Archivierte Boards zählen nicht als Arbeitsfläche — das letzte SICHTBARE bleibt (beim Archivieren ebenso)
  if (boards.length <= 1 || (board && !board.archived && !rest.some((b) => !b.archived))) { s.showToast('Das letzte Board bleibt offen'); return; }
  const projekt = s.spaces.flatMap((sp) => sp.projects).find((p) => p.boardIds.includes(id));
  let activeId = s.activeId;
  if (activeId === id) {
    activeId = projekt?.boardIds.find((x) => x !== id && rest.some((b) => b.id === x && !b.archived))
      ?? rest.find((b) => !b.archived)?.id ?? rest[0].id;
  }
  weg = board ? { board, index: boards.indexOf(board), projektId: projekt?.id, stelle: projekt ? projekt.boardIds.indexOf(id) : 0, activeId: s.activeId } : null;
  set({
    boards: rest,
    spaces: s.spaces.map((sp) => ({ ...sp, projects: sp.projects.map((p) => ({ ...p, boardIds: p.boardIds.filter((b) => b !== id) })) })),
    activeId,
  });
  if (board) get().showToast(t(`Board „${board.name}" gelöscht.`), 'ebene', 12000);
}

export function boardZurueck(set: Setzen, get: Holen): void {
  const bu = weg;
  weg = null;
  const s = get();
  if (!bu || s.boards.some((b) => b.id === bu.board.id)) return;
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
