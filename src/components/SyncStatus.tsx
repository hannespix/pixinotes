import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { regrantSyncAccess, type SyncState } from '../lib/syncFolder';
import { ICloud, ICloudAlert, ICloudCheck, ICloudOff } from './Icons';

type Entry = { state: SyncState; at?: string };
const SOURCE_LABEL: Record<string, string> = { ordner: 'Sync-Ordner', webdav: 'WebDAV' };
// Der „schlimmste" Zustand gewinnt die Anzeige (Handeln nötig vor Wohlfühlen)
const RANK: Record<SyncState, number> = { noperm: 0, error: 1, conflict: 2, pending: 3, ok: 4 };

/**
 * Sync-Status als Wolken-Symbol in der Aktionsleiste (M85): gleiche
 * Formensprache wie Undo/Suche/Einstellungen — monochrome Outline, kein Text,
 * Details im Tooltip. Braucht Aufmerksamkeit etwas (Freigabe weg, Konflikt,
 * Fehler), wird das Symbol dezent amber; ein Klick tut das jeweils Nötige.
 * Ohne verbundenes Sync-Ziel erscheint es gar nicht.
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
  const label = SOURCE_LABEL[source] ?? source;
  const openSync = () => useBoard.getState().setSettingsOpen(true, 'sync');

  const byState = {
    noperm: {
      cls: 'sync-status sync-warn sync-noperm',
      tip: 'Auto-Sync pausiert: Der Browser hat die Ordner-Freigabe nach dem Neustart zurückgesetzt — klicken, um sie neu zu erteilen',
      icon: <ICloudOff size={16} />,
      onClick: () => { void regrantSyncAccess().then((ok) => { if (!ok) openSync(); }); },
    },
    error: {
      cls: 'sync-status sync-warn',
      tip: `${label}: Speichern fehlgeschlagen — klicken für Details`,
      icon: <ICloudAlert size={16} />,
      onClick: openSync,
    },
    conflict: {
      cls: 'sync-status sync-warn',
      tip: `${label}: dort liegt ein anderer Stand — klicken zum Laden oder Überschreiben`,
      icon: <ICloudAlert size={16} />,
      onClick: openSync,
    },
    pending: {
      cls: 'sync-status sync-pending',
      tip: 'Änderungen werden gespeichert…',
      icon: <ICloud size={16} />,
      onClick: openSync,
    },
    ok: {
      cls: 'sync-status sync-ok',
      tip: `${label}: zuletzt gespeichert ${st.at ? new Date(st.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—'}`,
      icon: <ICloudCheck size={16} />,
      onClick: openSync,
    },
  }[st.state];

  return (
    <>
      <span className="top-actions-sep" />
      <button className={byState.cls} data-tip={byState.tip} aria-label="Synchronisations-Status" onClick={byState.onClick}>
        {byState.icon}
      </button>
    </>
  );
}
