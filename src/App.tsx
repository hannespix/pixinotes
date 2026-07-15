import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Board } from './components/Board';
import { Dock } from './components/Dock';
import { Tabs } from './components/Tabs';
import { Overview } from './components/Overview';
import { SearchOverlay } from './components/SearchOverlay';
import { Settings } from './components/Settings';
import { Presenter } from './components/Presenter';
import { useBoard } from './store';
import { initAutoSync } from './lib/syncFolder';
import { TaskHub } from './components/TaskHub';
import { collectTasks, dueTasksToRemind, notifyBrowser } from './lib/tasks';

export default function App() {
  const toast = useBoard((s) => s.toast);
  const view = useBoard((s) => s.view);
  const importEpoch = useBoard((s) => s.importEpoch);
  const presenting = useBoard((s) => s.presenting);
  const tasksOpen = useBoard((s) => s.tasksOpen);
  const restoreDeleted = useBoard((s) => s.restoreDeleted);
  const showToast = useBoard((s) => s.showToast);

  // Auto-Sync in den verbundenen Sync-Ordner (Nextcloud & Co.) — no-op ohne Verbindung
  useEffect(() => { initAutoSync(); }, []);

  // Erinnerungen: beim Start und dann alle 5 Minuten fällige Aufgaben melden
  useEffect(() => {
    const remind = () => {
      const { boards, showToast } = useBoard.getState();
      const hits = dueTasksToRemind(collectTasks(boards));
      if (hits.length === 0) return;
      if (hits.length === 1) {
        showToast(`⏰ Fällig: „${hits[0].text}" (${hits[0].boardName}) — Details unter ✅`);
        notifyBrowser('PixiNotes ⏰ Aufgabe fällig', `${hits[0].text} (${hits[0].boardName})`);
      } else {
        showToast(`⏰ ${hits.length} Aufgaben fällig — Details unter ✅`);
        notifyBrowser('PixiNotes ⏰', `${hits.length} Aufgaben sind fällig`);
      }
    };
    const t0 = setTimeout(remind, 2500);
    const iv = setInterval(remind, 5 * 60_000);
    return () => { clearTimeout(t0); clearInterval(iv); };
  }, []);

  // Zweiter Browser-Tab? Letzter Schreiber gewinnt — ehrlich warnen (Backlog M6)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'pixinotes-board' && e.newValue !== null) {
        showToast('⚠️ PixiNotes ist in einem weiteren Tab geöffnet — bitte nur einen Tab nutzen, sonst überschreiben sich die Stände.');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [showToast]);

  // Quota-Warnung aus dem Storage-Layer (Audit K1)
  useEffect(() => {
    const warn = () =>
      showToast('⚠️ Browser-Speicher voll — Änderungen werden nicht mehr gesichert! Große Bilder löschen oder Inhalte exportieren.');
    window.addEventListener('pixinotes:quota', warn);
    return () => window.removeEventListener('pixinotes:quota', warn);
  }, [showToast]);

  return (
    // key=importEpoch: Nach „Vom Sync-Ordner laden" muss auch der React-Flow-
    // Provider-Store neu entstehen — sonst serviert er den frisch gemounteten
    // Karten für einen Moment die ALTEN Knoten, und BlockNote (liest Inhalt
    // nur beim Mount) friert den alten Text ein.
    <ReactFlowProvider key={importEpoch}>
      <div className="app">
        <div className="topbar">
          <div className="logo">
            Pixi<span>Notes</span>
          </div>
          <div className="hint">
            Doppelklick = Notiz · E-Mails &amp; Dateien reinziehen · Strg+V für Screenshots · Karten werfen 🚀
          </div>
        </div>
        <Tabs />
        {view === 'overview' ? (
          <Overview />
        ) : presenting ? null : tasksOpen ? (
          <TaskHub />
        ) : (
          // Während Präsentation/Aufgaben-Zentrale ist das Board ausgehängt:
          // Beide editieren dieselben Karten, und die Karten-Editoren (BlockNote)
          // lesen ihren Inhalt nur beim Mount — so übernimmt das Board die
          // Änderungen beim Zurückkehren garantiert frisch.
          <>
            <Board />
            <Dock />
          </>
        )}
        <SearchOverlay />
        <Settings />
        <Presenter />
        <div className={`toast ${toast ? 'show' : ''}`}>
          {toast?.message}
          {toast?.undo && (
            <button className="toast-undo" onClick={restoreDeleted}>
              Rückgängig
            </button>
          )}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
