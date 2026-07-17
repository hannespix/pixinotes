import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { regrantSyncAccess, type SyncState } from '../lib/syncFolder';

type Entry = { state: SyncState; at?: string };
const SOURCE_LABEL: Record<string, string> = { ordner: 'Sync-Ordner', webdav: 'WebDAV' };
// Der „schlimmste" Zustand gewinnt die Anzeige (Handeln nötig vor Wohlfühlen)
const RANK: Record<SyncState, number> = { noperm: 0, error: 1, conflict: 2, pending: 3, ok: 4 };

/**
 * Sync-Status in der Kopfleiste (M85): Der Auto-Sync war bisher unsichtbar —
 * schlief er (Ordner-Freigabe nach Neustart weg, Konflikt, Fehler), wirkte das
 * wie „speichert nicht". Der Chip zeigt den Zustand dauerhaft und macht das
 * Nötige per Klick: Freigabe erteilen bzw. ⚙ → Synchronisation öffnen.
 * Ohne verbundenes Sync-Ziel erscheint er gar nicht.
 */
export function SyncStatus() {
  const [map, setMap] = useState<Record<string, Entry>>({});

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { source: string; state: SyncState; at?: string };
      setMap((m) => ({ ...m, [d.source]: { state: d.state, at: d.at } }));
    };
    window.addEventListener('pixinotes:sync-status', on);
    return () => window.removeEventListener('pixinotes:sync-status', on);
  }, []);

  const entries = Object.entries(map);
  if (entries.length === 0) return null;
  const [source, st] = entries.sort((a, b) => RANK[a[1].state] - RANK[b[1].state])[0];
  const openSync = () => useBoard.getState().setSettingsOpen(true, 'sync');

  if (st.state === 'noperm') {
    return (
      <button
        className="sync-chip warn"
        data-tip="Der Browser hat die Ordner-Freigabe nach dem Neustart zurückgesetzt — der Auto-Sync pausiert, bis du sie neu erteilst"
        onClick={() => { void regrantSyncAccess().then((ok) => { if (!ok) openSync(); }); }}
      >
        ⚠️ Zugriff erlauben
      </button>
    );
  }
  if (st.state === 'error') {
    return (
      <button className="sync-chip warn" data-tip={`${SOURCE_LABEL[source] ?? source}: letzter Sync fehlgeschlagen — Details in den Einstellungen`} onClick={openSync}>
        ⚠️ Sync-Fehler
      </button>
    );
  }
  if (st.state === 'conflict') {
    return (
      <button className="sync-chip warn" data-tip={`${SOURCE_LABEL[source] ?? source}: dort liegt ein anderer Stand — in den Einstellungen laden oder überschreiben`} onClick={openSync}>
        ⚠️ Anderer Stand
      </button>
    );
  }
  if (st.state === 'pending') {
    return <button className="sync-chip" data-tip="Änderungen werden gerade gespeichert…" onClick={openSync}>☁️ speichert…</button>;
  }
  return (
    <button
      className="sync-chip ok"
      data-tip={`${SOURCE_LABEL[source] ?? source}: zuletzt gespeichert ${st.at ? new Date(st.at).toLocaleTimeString('de-DE') : '—'}`}
      onClick={openSync}
    >
      ☁️ ✓
    </button>
  );
}
