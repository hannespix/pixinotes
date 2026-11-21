import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { IHelp, IRedo, ISearch, ISettings, IUndo } from './Icons';
import { SyncStatus } from './SyncStatus';

/**
 * Globale Aktionen oben neben dem Logo: Rückgängig/Wiederholen, Suche,
 * Einstellungen — in JEDER Ansicht erreichbar, ohne React-Flow-Abhängigkeit.
 * Undo/Redo wirken aufs aktive Board und sind deshalb nur dort aktiv.
 *
 * M312: Der Suche-Knopf erscheint nur, wenn keine Spalte mit Suchfeld zu sehen
 * ist (Handy, Spalte eingeklappt) — das Stylesheet blendet ihn sonst aus.
 * M412: Die Hilfe hat hier ihren Knopf (das Logo führt jetzt zur Übersicht).
 */
export function TopActions() {
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  const view = useBoard((s) => s.view);
  const canUndo = useBoard((s) => s.past.length > 0 && s.view === 'board');
  const canRedo = useBoard((s) => s.future.length > 0 && s.view === 'board');
  const setSearchOpen = useBoard((s) => s.setSearchOpen);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const setHelpOpen = useBoard((s) => s.setHelpOpen);
  /* M412: Steht links die Spalte, sitzt die Hilfe an deren Fuß (Tabs.tsx) – die schmale Kopfzeile über der Spalte
     bräche sonst in zwei Zeilen um. Dieselbe Grenze wie im Stylesheet und in Tabs.tsx (861 Punkte). */
  const navLinks = useBoard((s) => s.navLinks);
  const [breit, setBreit] = useState(() => window.matchMedia('(min-width: 861px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 861px)');
    const on = () => setBreit(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  return (
    <div className="top-actions" role="toolbar" aria-label="Aktionen">
      <button onClick={undo} disabled={!canUndo} data-taste="rueckgaengig" title={view === 'board' ? 'Rückgängig' : 'Rückgängig – nur in der Board-Ansicht'} aria-label="Rückgängig"><IUndo size={16} /></button>
      <button onClick={redo} disabled={!canRedo} data-taste="wiederholen" title={view === 'board' ? 'Wiederholen' : 'Wiederholen – nur in der Board-Ansicht'} aria-label="Wiederholen"><IRedo size={16} /></button>
      <span className="top-actions-sep" />
      <button className="ta-suche" onClick={() => setSearchOpen(true)} data-taste="suche" title="Suche" aria-label="Suche"><ISearch size={16} /></button>
      <button onClick={() => setSettingsOpen(true)} data-taste="einstellungen" title="Einstellungen" aria-label="Einstellungen"><ISettings size={16} /></button>
      <SyncStatus />
      {!(navLinks && breit) && (
        <button onClick={() => setHelpOpen(true)} data-taste="hilfe" title="Hilfe · Was ist neu · Impressum" aria-label="Hilfe"><IHelp size={16} /></button>
      )}
    </div>
  );
}
