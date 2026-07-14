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

export default function App() {
  const toast = useBoard((s) => s.toast);
  const view = useBoard((s) => s.view);
  const restoreDeleted = useBoard((s) => s.restoreDeleted);
  const showToast = useBoard((s) => s.showToast);

  // Quota-Warnung aus dem Storage-Layer (Audit K1)
  useEffect(() => {
    const warn = () =>
      showToast('⚠️ Browser-Speicher voll — Änderungen werden nicht mehr gesichert! Große Bilder löschen oder Inhalte exportieren.');
    window.addEventListener('pixinotes:quota', warn);
    return () => window.removeEventListener('pixinotes:quota', warn);
  }, [showToast]);

  return (
    <ReactFlowProvider>
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
        ) : (
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
