import { ReactFlowProvider } from '@xyflow/react';
import { Board } from './components/Board';
import { Dock } from './components/Dock';
import { Tabs } from './components/Tabs';
import { SelectionToolbar } from './components/SelectionToolbar';
import { useBoard } from './store';

export default function App() {
  const toast = useBoard((s) => s.toast);

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
        <Board />
        <Dock />
        <SelectionToolbar />
        <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    </ReactFlowProvider>
  );
}
