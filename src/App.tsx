import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Board } from './components/Board';
import { Dock } from './components/Dock';
import { Tabs } from './components/Tabs';
import { MiniDock } from './components/MiniDock';
import { TopActions } from './components/TopActions';
import { Overview } from './components/Overview';
import { SearchOverlay } from './components/SearchOverlay';
import { Settings } from './components/Settings';
import { Presenter } from './components/Presenter';
import {
  adoptPersistedState, claimWriter, getWriterRole, reassertPersist,
  singleWriterSupported, takeOverWriter, useBoard, type WriterRole,
} from './store';
import { initAutoSync } from './lib/syncFolder';
import { initProjectAutoSync } from './lib/projectSync';
import { cleanupOrphanHtml } from './lib/htmlStore';
import { initWebdavSync } from './lib/webdav';
import { TaskHub } from './components/TaskHub';
import { BacklinksPanel } from './components/BacklinksPanel';
import { HelpOverlay } from './components/HelpOverlay';
import { LookupPanel } from './components/LookupPanel';
import { TooltipLayer } from './components/TooltipLayer';
import { collectTasks, dueTasksToRemind, notifyBrowser } from './lib/tasks';
import { clearShareHash, cloneSharedBoard, readShareHash } from './lib/share';

export default function App() {
  const toast = useBoard((s) => s.toast);
  const view = useBoard((s) => s.view);
  const importEpoch = useBoard((s) => s.importEpoch);
  const presenting = useBoard((s) => s.presenting);
  const tasksOpen = useBoard((s) => s.tasksOpen);
  const restoreDeleted = useBoard((s) => s.restoreDeleted);
  const showToast = useBoard((s) => s.showToast);

  // Auto-Sync in den verbundenen Sync-Ordner (Nextcloud & Co.) — no-op ohne Verbindung
  useEffect(() => { initAutoSync(); initProjectAutoSync(); initWebdavSync(); }, []);

  // Eigene Apps (M158): verwaiste HTML-Inhalte in IndexedDB entsorgen —
  // NUR beim Start (dann kann kein Undo eine gelöschte App-Karte zurückholen,
  // deren Inhalt hier gerade wegfiele); verzögert, damit der Boot flüssig bleibt
  useEffect(() => {
    const t = setTimeout(() => {
      const ids = new Set(
        useBoard.getState().boards.flatMap((b) => b.nodes.filter((n) => n.type === 'htmlapp').map((n) => n.id)),
      );
      void cleanupOrphanHtml(ids);
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  // Gesten-Spickzettel: statt Dauer-Pille im Header (kollidierte mit den
  // Bedienelementen) einmal pro Sitzung kurz als Toast beim Start
  useEffect(() => {
    const t = setTimeout(() => {
      if (sessionStorage.getItem('pixinotes-hint-shown')) return;
      sessionStorage.setItem('pixinotes-hint-shown', '1');
      useBoard.getState().showToast(
        '💡 Doppelklick = Notiz · E-Mails & Dateien reinziehen · Strg+V für Screenshots · Karten werfen 🚀',
        false,
        8000,
      );
    }, 900);
    return () => clearTimeout(t);
  }, []);

  // Design anwenden: data-theme/-accent am <html>; „System" folgt dem Gerät live
  const ui = useBoard((s) => s.ui);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    // M178: Browser-/Statusleisten-Farbe (meta theme-color) folgt der
    // Akzentfarbe — vorher stand sie fest auf Blau, egal welcher Akzent
    const ACCENT_HEX: Record<string, string> = {
      blau: '#4f7cff', gruen: '#2e9e63', violett: '#7c5cff', orange: '#e0762e', rosa: '#d44f6e',
    };
    const apply = () => {
      const dark = ui.theme === 'dark' || (ui.theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.accent = ui.accent;
      let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.appendChild(meta);
      }
      meta.content = ACCENT_HEX[ui.accent] ?? ACCENT_HEX.blau;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [ui]);

  // Geteiltes Board im URL-Hash? (#b=… — der Link IST die Datei)
  useEffect(() => {
    void (async () => {
      const shared = await readShareHash();
      if (!shared) return;
      clearShareHash();
      const st = useBoard.getState();
      if (window.confirm(`Geteiltes Board „${shared.name ?? 'Board'}" (${shared.nodes?.length ?? 0} Karten) übernehmen?`)) {
        claimWriter(); // bewusster Import — auch aus einem Mitlese-Fenster wirksam
        st.importBoard(cloneSharedBoard(shared));
        st.showToast('Geteiltes Board übernommen — liegt als eigenes Board in deiner Tab-Leiste.');
      }
    })();
  }, []);

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

  // Mitlese-Banner: genau EIN Fenster darf schreiben (Web Lock, Sync-Audit M81) —
  // alle weiteren zeigen den Hinweis mit „Hier weiterarbeiten"-Übernahme
  const [writerRole, setWriterRoleUi] = useState<WriterRole>(getWriterRole());
  useEffect(() => {
    const upd = () => setWriterRoleUi(getWriterRole());
    window.addEventListener('pixinotes:writer-change', upd);
    return () => window.removeEventListener('pixinotes:writer-change', upd);
  }, []);

  // Fremder Write in unseren Speicher (zweiter Browsing-Kontext):
  //  - Mitleser: Stand des Schreibers übernehmen (kurz gebündelt, Schreib-Bursts)
  //  - Schreiber: darf eigentlich nie passieren (Lock) — also ein ALTER Kontext
  //    ohne Single-Writer-Schutz → warnen und eigenen Stand wieder durchsetzen,
  //    statt ihn wie früher still überschreiben zu lassen (Sync-Audit M81)
  useEffect(() => {
    let adoptTimer: ReturnType<typeof setTimeout> | undefined;
    let lastDefense = 0;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'pixinotes-board' || e.newValue === null) return;
      if (getWriterRole() === 'follower') {
        clearTimeout(adoptTimer);
        adoptTimer = setTimeout(() => { adoptPersistedState(); }, 800);
        return;
      }
      const now = Date.now();
      if (now - lastDefense < 10_000) return; // gedrosselt: kein Toast/Write-Ping-Pong
      lastDefense = now;
      if (singleWriterSupported()) reassertPersist();
      showToast('⚠️ Ein weiteres PixiNotes-Fenster schreibt in den Speicher (vermutlich mit alter App-Version) — bitte das andere Fenster schließen. Dieses Fenster behält seinen Stand.');
    };
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('storage', onStorage); clearTimeout(adoptTimer); };
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
          <TopActions />
        </div>
        <Tabs />
        {view === 'overview' ? (
          <>
            <Overview />
            <MiniDock />
          </>
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
            <BacklinksPanel />
          </>
        )}
        <SearchOverlay />
      <HelpOverlay />
      <LookupPanel />
      <TooltipLayer />
        <Settings />
        <Presenter />
        {/* §5 DDG: Impressum muss leicht erkennbar und unmittelbar erreichbar
            sein — darum dauerhaft sichtbare, klar beschriftete Links (1 Klick),
            nicht nur versteckt in Hilfe/Einstellungen */}
        {!presenting && (
          <div className="legal-corner">
            <button className="link-btn" onClick={() => useBoard.getState().setHelpOpen(true, 'impressum')}>Impressum</button>
            <span aria-hidden="true">·</span>
            <button className="link-btn" onClick={() => useBoard.getState().setHelpOpen(true, 'datenschutz')}>Datenschutz</button>
          </div>
        )}
        {writerRole === 'follower' && (
          <div className="writer-banner" role="status">
            <span>
              👀 PixiNotes ist in einem anderen Fenster/Tab geöffnet — dieses Fenster liest nur
              mit, damit sich die Stände nicht gegenseitig überschreiben.
            </span>
            <button onClick={takeOverWriter}>Hier weiterarbeiten</button>
          </div>
        )}
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
