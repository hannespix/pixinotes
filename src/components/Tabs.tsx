import { useState } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { boardToShareUrl, downloadBoardFile, SHARE_URL_LIMIT } from '../lib/share';
import { InlineName } from './InlineName';
import { IHistory, IHome, IPlus, IShare, IX } from './Icons';

/**
 * Projekt-Tabs: jedes Board ist ein Raum. Doppelklick = umbenennen,
 * ✕ = schließen (Inhalte bleiben weg — bewusst simpel in v0.2).
 */
export function Tabs() {
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const view = useBoard((s) => s.view);
  const setView = useBoard((s) => s.setView);
  const openBoard = useBoard((s) => s.openBoard);
  const addBoard = useBoard((s) => s.addBoard);
  const renameBoard = useBoard((s) => s.renameBoard);
  const removeBoard = useBoard((s) => s.removeBoard);
  const showToast = useBoard((s) => s.showToast);
  const activeBoard = useBoard(selectActiveBoard);
  // Map selektieren und erst außerhalb indizieren — `?? []` im Selector
  // würde bei jedem Snapshot ein neues Array liefern (Endlos-Render, React #185)
  const versionsMap = useBoard((s) => s.versions);
  const versions = versionsMap[activeId] ?? [];
  const saveVersion = useBoard((s) => s.saveVersion);
  const restoreVersion = useBoard((s) => s.restoreVersion);
  const deleteVersion = useBoard((s) => s.deleteVersion);
  const [historyOpen, setHistoryOpen] = useState(false);

  /** Aktives Board serverlos teilen: Link in die Zwischenablage (Fallback: Datei) */
  const shareActive = async () => {
    try {
      const url = await boardToShareUrl(activeBoard);
      if (url.length > SHARE_URL_LIMIT) {
        downloadBoardFile(activeBoard);
        showToast('Board ist zu groß für einen Link (Bilder!) — stattdessen als Datei exportiert. Empfänger zieht sie einfach aufs Board.');
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast('Teilen-Link kopiert! Der Link enthält das komplette Board — einfach verschicken, Empfänger öffnet ihn im Browser.');
    } catch {
      downloadBoardFile(activeBoard);
      showToast('Link konnte nicht kopiert werden — Board stattdessen als Datei exportiert.');
    }
  };

  const close = (id: string) => {
    if (boards.length <= 1) {
      showToast('Das letzte Board bleibt offen 🙂');
      return;
    }
    const board = boards.find((b) => b.id === id);
    if (board && board.nodes.length > 0) {
      if (!window.confirm(`Board „${board.name}" mit ${board.nodes.length} Karten wirklich löschen?`)) return;
    }
    removeBoard(id);
  };

  return (
    <div className="tabs">
      <button
        className={`tab-home ${view === 'overview' ? 'active' : ''}`}
        title="Übersicht: alle Bereiche, Projekte & Boards"
        onClick={() => setView('overview')}
      >
        <IHome size={15} />
      </button>
      {/* Nur die Board-Tabs scrollen — Home & Aktions-Buttons bleiben immer erreichbar */}
      <div className="tabs-scroll">
        {boards.map((b) => (
          <div
            key={b.id}
            className={`tab ${b.id === activeId && view === 'board' ? 'active' : ''}`}
            onClick={() => openBoard(b.id)}
            title="Klick = wechseln · Doppelklick auf den Namen = umbenennen"
          >
            <InlineName value={b.name} className="tab-name" onRename={(name) => renameBoard(b.id, name)} />
            <span className="tab-count">{b.nodes.length}</span>
            <button
              className="tab-x"
              title="Board schließen"
              aria-label={`Board ${b.name} schließen`}
              onClick={(e) => {
                e.stopPropagation();
                close(b.id);
              }}
            >
              <IX size={11} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="tab-share"
        title="Aktives Board teilen: Link mit komplettem Inhalt kopieren (serverlos)"
        aria-label="Board teilen"
        onClick={shareActive}
      >
        <IShare size={13} />
      </button>
      <span className="tab-history-wrap">
        <button
          className={`tab-share ${historyOpen ? 'active' : ''}`}
          title="Board-Verlauf: Versionen sichern & wiederherstellen"
          aria-label="Board-Verlauf"
          onClick={() => setHistoryOpen((o) => !o)}
        >
          <IHistory size={13} />
        </button>
        {historyOpen && (
          <div className="tab-history">
            <div className="tab-history-title">Verlauf „{activeBoard.name}"</div>
            <button
              className="tab-history-save"
              onClick={() => saveVersion(activeBoard.id)}
            >
              ＋ Version jetzt sichern
            </button>
            {versions.length === 0 && (
              <div className="tab-history-empty">Noch keine Version — sichere einen Stand, bevor du groß umbaust.</div>
            )}
            {versions.map((v) => (
              <div key={v.ts} className="tab-history-row">
                <span>{new Date(v.ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <em>{v.nodes.length} Karten</em>
                <button
                  title="Diesen Stand wiederherstellen (Strg+Z macht es rückgängig)"
                  onClick={() => { restoreVersion(activeBoard.id, v.ts); setHistoryOpen(false); }}
                >
                  Wiederherstellen
                </button>
                <button className="tab-history-x" title="Version löschen" onClick={() => deleteVersion(activeBoard.id, v.ts)}>
                  <IX size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </span>
      <button
        className="tab-add"
        title="Neues Projekt-Board"
        onClick={() => {
          addBoard();
          showToast('Neues Board — Doppelklick auf den Tab zum Umbenennen');
        }}
      >
        <IPlus size={14} />
      </button>
    </div>
  );
}
