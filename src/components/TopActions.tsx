import { useBoard } from '../store';
import { IRedo, ISearch, ISettings, IUndo } from './Icons';
import { SyncStatus } from './SyncStatus';

/**
 * Globale Aktionen oben neben dem Logo: Rückgängig/Wiederholen, Suche,
 * Einstellungen — in JEDER Ansicht erreichbar, ohne React-Flow-Abhängigkeit.
 * Undo/Redo wirken aufs aktive Board und sind deshalb nur dort aktiv.
 *
 * M312: Die Hilfe hängt am Logo (ein Ort statt zwei), und der Suche-Knopf
 * erscheint nur, wenn keine Spalte mit Suchfeld zu sehen ist (Handy, Spalte
 * eingeklappt) — das Stylesheet blendet ihn sonst aus.
 */
export function TopActions() {
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  const view = useBoard((s) => s.view);
  const canUndo = useBoard((s) => s.past.length > 0 && s.view === 'board');
  const canRedo = useBoard((s) => s.future.length > 0 && s.view === 'board');
  const setSearchOpen = useBoard((s) => s.setSearchOpen);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);

  return (
    <div className="top-actions">
      <button onClick={undo} disabled={!canUndo} data-taste="rueckgaengig" title={view === 'board' ? 'Rückgängig' : 'Rückgängig — nur in der Board-Ansicht'} aria-label="Rückgängig"><IUndo size={16} /></button>
      <button onClick={redo} disabled={!canRedo} data-taste="wiederholen" title={view === 'board' ? 'Wiederholen' : 'Wiederholen — nur in der Board-Ansicht'} aria-label="Wiederholen"><IRedo size={16} /></button>
      <span className="top-actions-sep" />
      <button className="ta-suche" onClick={() => setSearchOpen(true)} data-taste="suche" title="Suche" aria-label="Suche"><ISearch size={16} /></button>
      <button onClick={() => setSettingsOpen(true)} data-taste="einstellungen" title="Einstellungen" aria-label="Einstellungen"><ISettings size={16} /></button>
      <SyncStatus />
    </div>
  );
}
