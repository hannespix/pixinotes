import { useBoard } from '../store';
import { IHelp, IPanelRight, IRedo, ISearch, ISettings, IUndo } from './Icons';
import { SyncStatus } from './SyncStatus';

/**
 * Globale Aktionen oben neben dem Logo (User-Wunsch): Rückgängig/Wiederholen,
 * Suche, Hilfe, Einstellungen — in JEDER Ansicht erreichbar, ohne
 * React-Flow-Abhängigkeit. Undo/Redo wirken aufs aktive Board und sind
 * deshalb nur in der Board-Ansicht aktiv.
 */
export function TopActions() {
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  const view = useBoard((s) => s.view);
  const canUndo = useBoard((s) => s.past.length > 0 && s.view === 'board');
  const canRedo = useBoard((s) => s.future.length > 0 && s.view === 'board');
  const setSearchOpen = useBoard((s) => s.setSearchOpen);
  const sidebarOpen = useBoard((s) => s.sidebar.open);
  const setSidebar = useBoard((s) => s.setSidebar);
  const setHelpOpen = useBoard((s) => s.setHelpOpen);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);

  return (
    <div className="top-actions">
      <button onClick={undo} disabled={!canUndo} data-taste="rueckgaengig" title={view === 'board' ? 'Rückgängig' : 'Rückgängig — nur in der Board-Ansicht'} aria-label="Rückgängig"><IUndo size={16} /></button>
      <button onClick={redo} disabled={!canRedo} data-taste="wiederholen" title={view === 'board' ? 'Wiederholen' : 'Wiederholen — nur in der Board-Ansicht'} aria-label="Wiederholen"><IRedo size={16} /></button>
      <span className="top-actions-sep" />
      <button onClick={() => setSearchOpen(true)} data-taste="suche" title="Suche über alle Boards — und Befehle" aria-label="Suche"><ISearch size={16} /></button>
      {view === 'board' && (
        <button
          className={sidebarOpen ? 'on' : ''}
          onClick={() => setSidebar({ open: !sidebarOpen })}
          data-taste="ueberblick"
          title="Überblick als Seitenleiste — Hierarchie oder Netz neben der Arbeit"
          aria-label="Seitenleiste"
        ><IPanelRight size={16} /></button>
      )}
      <button onClick={() => setHelpOpen(true)} data-taste="hilfe" title="Hilfe: alle Funktionen erklärt" aria-label="Hilfe"><IHelp size={16} /></button>
      <button onClick={() => setSettingsOpen(true)} data-taste="einstellungen" title="Einstellungen (KI, Synchronisation, Kalender, Design …)" aria-label="Einstellungen"><ISettings size={16} /></button>
      <SyncStatus />
    </div>
  );
}
