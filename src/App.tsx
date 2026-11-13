import { useEffect, useState, type CSSProperties } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Board } from './components/Board';
import { Dock } from './components/Dock';
import { Tabs } from './components/Tabs';
import { TopActions } from './components/TopActions';
import { Overview } from './components/Overview';
import { SearchOverlay } from './components/SearchOverlay';
import { Settings } from './components/Settings';
import { RechercheDialog } from './components/RechercheDialog';
import { Presenter } from './components/Presenter';
import {
  adoptPersistedState, claimWriter, getWriterRole, reassertPersist,
  selectActiveBoard, selectNurLesen, singleWriterSupported, takeOverWriter, useBoard, type WriterRole,
} from './store';
import { initAutoSync } from './lib/syncFolder';
import { initProjectAutoSync } from './lib/projectSync';
import { cleanupOrphanHtml } from './lib/htmlStore';
import { cleanupOrphanFiles } from './lib/fileStore';
import { initWebdavSync } from './lib/webdav';
import { initFilesSync } from './lib/filesSync';
import { initKontoSync } from './lib/kontoSync';
import { initBrain } from './lib/brain';
import { kiAbbrechen } from './lib/ai';
import { TaskHub } from './components/TaskHub';
import { AboutMenu } from './components/AboutMenu';
import { FocusSheet } from './components/FocusSheet';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Onboarding } from './components/Onboarding';
import { BacklinksPanel } from './components/BacklinksPanel';
import { ShareCardsModal } from './components/ShareCardsModal';
import { HelpOverlay } from './components/HelpOverlay';
import { BildExport } from './components/BildExport';
import { GeteiltDialog } from './components/GeteiltDialog';
import { LookupPanel } from './components/LookupPanel';
import { TooltipLayer } from './components/TooltipLayer';
import { Tastatur } from './components/Tastatur';
import { collectTasks, dueTasksToRemind, notifyBrowser } from './lib/tasks';
import { autoArchivAlleBoards } from './lib/ticketArchiv';
import { clearShareHash, cloneSharedBoard, readShareHash } from './lib/share';
import { initGrabsteine } from './lib/grabsteine';
import { linkOeffnen, linkTokenAbholen } from './lib/linkTeilen';
import { einladungAnnehmen, einladungOffen, einladungTokenAbholen } from './lib/einladung';
import { loadKonto } from './lib/kontoSync';
import { seitenBreitenReparieren } from './lib/seitenBreiten'; // M355: zu dick gespeicherte Seitenstriche (M354-Fehler) einmal richten

export default function App() {
  const toast = useBoard((s) => s.toast);
  const view = useBoard((s) => s.view);
  const importEpoch = useBoard((s) => s.importEpoch);
  const presenting = useBoard((s) => s.presenting);
  const tasksOpen = useBoard((s) => s.tasksOpen);
  const focusCard = useBoard((s) => s.focusCard);
  const fokusVollbild = useBoard((s) => s.fokusVollbild);
  const navLinks = useBoard((s) => s.navLinks);
  // M308: Die Spalte ist ziehbar — ihre Breite kommt aus dem Stand, nicht aus dem Stylesheet
  const spalteBreite = useBoard((s) => s.spalteBreite);
  const restoreDeleted = useBoard((s) => s.restoreDeleted);
  const showToast = useBoard((s) => s.showToast);
  // M360: Ist das offene Board nur zum Lesen geteilt? (Kennung und Besitzer für das Hinweisband)
  const nurLesenId = useBoard((s) => (selectNurLesen(s) ? s.activeId : ''));
  const nurLesenVon = useBoard((s) => (selectNurLesen(s) ? selectActiveBoard(s).geteiltVonName ?? '' : ''));
  const nurLesenBoard = nurLesenId ? { id: nurLesenId, von: nurLesenVon } : null;

  // Auto-Sync in den verbundenen Sync-Ordner (Nextcloud & Co.) — no-op ohne Verbindung
  useEffect(() => { initAutoSync(); initProjectAutoSync(); initWebdavSync(); initFilesSync(); initKontoSync(); initBrain(); initGrabsteine(); seitenBreitenReparieren(); }, []);

  // Eigene Apps (M158): verwaiste HTML-Inhalte in IndexedDB entsorgen —
  // NUR beim Start (dann kann kein Undo eine gelöschte App-Karte zurückholen,
  // deren Inhalt hier gerade wegfiele); verzögert, damit der Boot flüssig bleibt
  useEffect(() => {
    const t = setTimeout(() => {
      const ids = new Set(
        useBoard.getState().boards.flatMap((b) => b.nodes.filter((n) => n.type === 'htmlapp').map((n) => n.id)),
      );
      void cleanupOrphanHtml(ids);
      // M259: dasselbe für die Inhalte von Datei-Karten
      const dateiIds = new Set(
        useBoard.getState().boards.flatMap((b) => b.nodes.filter((n) => n.type === 'file').map((n) => n.id)),
      );
      void cleanupOrphanFiles(dateiIds);
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  // M294: Der Gesten-Spickzettel beim Sitzungsstart ist weg — die Begrüßung
  // beim ersten Start und der Hinweis auf der leeren Fläche sagen dasselbe,
  // und der Toast lag acht Sekunden über den Dock-Menüs.
  // Einmalig nach der Umstellung auf die ruhige Fläche (lib/einstellungen.ts):
  // sagen, was sich geändert hat und wo es wieder anzuschalten ist.
  useEffect(() => {
    if (!useBoard.getState().ruheHinweis) return;
    const t = setTimeout(() => {
      useBoard.getState().setRuheHinweis(false);
      useBoard.getState().showToast('Physik und Klick-Zoom sind jetzt aus. Wieder einschalten: ⚙ → Darstellung.', false, 8000);
    }, 1500);
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

  // M357: Kurzer Link (#l=<token>) — die geteilte Fassung holen und DIREKT öffnen, ohne Rückfrage:
  // Wer auf einen Link klickt, will das Board sehen; es kommt als eigenes Board dazu und ersetzt nichts.
  useEffect(() => {
    const token = linkTokenAbholen();
    if (!token) return;
    const st = useBoard.getState();
    st.showToast('Geteiltes Board wird geladen …');
    claimWriter(); // bewusster Import — auch aus einem Mitlese-Fenster wirksam
    linkOeffnen(token, (name) => window.confirm(`Von „${name}" gibt es eine neuere Fassung.\n\nOK = neue Fassung laden (als weiteres Board, dein bisheriges bleibt)\nAbbrechen = dein bisheriges öffnen`))
      .then((wie) => useBoard.getState().showToast(wie === 'vorhanden'
        ? 'Geteiltes Board geöffnet — du hattest es schon.'
        : 'Geteiltes Board geöffnet — es ist jetzt dein eigenes; Änderungen bleiben bei dir.', false, 6000))
      .catch((e: Error) => useBoard.getState().showToast(`⚠️ ${e.message}`, false, 9000));
  }, []);

  // M360: Einladungslink (#e=<token>) — als Gast beitreten und das gemeinsame Board öffnen. Ohne Anmeldung
  // bleibt die Einladung gemerkt; nach der Anmeldung (auch per E-Mail-Link, also nach einem Neuladen) geht es weiter.
  useEffect(() => {
    let laeuft = false;
    const annehmen = (token: string, vomLink: boolean) => {
      if (laeuft) return;
      laeuft = true;
      claimWriter(); // der Abgleich läuft nur im schreibenden Fenster
      if (vomLink && loadKonto()) useBoard.getState().showToast('Einladung wird angenommen …');
      einladungAnnehmen(token).then((r) => {
        const st = useBoard.getState();
        if (r.art === 'anmelden') {
          if (!vomLink) return;
          st.showToast('👥 Einladung zu einem gemeinsamen Board: Melde dich mit E-Mail an — danach öffnet es sich von selbst.', false, 14000);
          st.setSettingsOpen(true, 'konto');
        } else if (r.art === 'eigen') {
          st.showToast('Das ist der Einladungslink zu deinem eigenen Board — gib ihn an die anderen weiter.', false, 7000);
        } else {
          const von = r.von ? ` von ${r.von}` : '';
          st.showToast(r.rolle === 'lesen'
            ? `👥 Geteiltes Board${von} geöffnet — du liest live mit (nur lesen).`
            : `👥 Geteiltes Board${von} geöffnet — ihr arbeitet jetzt gemeinsam daran.`, false, 8000);
        }
      }).catch((e: Error) => useBoard.getState().showToast(`⚠️ ${e.message}`, false, 9000))
        .finally(() => { laeuft = false; });
    };
    const token = einladungTokenAbholen();
    const offen = einladungOffen();
    if (token) annehmen(token, true);
    else if (offen && loadKonto()) annehmen(offen, false);
    const nach = () => { const t = einladungOffen(); if (t) annehmen(t, false); };
    // Link in die Adresszeile der offenen App eingefügt: nur der Anker ändert sich, die Seite lädt nicht neu
    const anker = () => { const t = einladungTokenAbholen(); if (t) annehmen(t, true); };
    window.addEventListener('pixinotes:konto-verbunden', nach);
    window.addEventListener('hashchange', anker);
    return () => { window.removeEventListener('pixinotes:konto-verbunden', nach); window.removeEventListener('hashchange', anker); };
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

  // M293: Auto-Archivierung erledigter Kanban-Tickets — beim Start und dann
  // im selben Takt wie die Erinnerungen. Meldet sich nur, wenn wirklich etwas
  // gewandert ist; das Nachtragen fehlender Erledigt-Stempel bleibt still.
  useEffect(() => {
    const lauf = () => {
      const n = autoArchivAlleBoards();
      if (n > 0) {
        useBoard.getState().showToast(`🗃 ${n} erledigte${n === 1 ? 's Ticket' : ' Tickets'} automatisch archiviert.`);
      }
    };
    const t0 = setTimeout(lauf, 4000);
    const iv = setInterval(lauf, 5 * 60_000);
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
      showToast('⚠️ Ein zweites PixiNotes-Fenster schreibt mit, bitte das andere Fenster schließen.');
    };
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('storage', onStorage); clearTimeout(adoptTimer); };
  }, [showToast]);

  // Quota-Warnung aus dem Storage-Layer (Audit K1)
  useEffect(() => {
    const warn = () =>
      showToast('⚠️ Speicher voll, Änderungen werden nicht gesichert. Große Bilder löschen oder exportieren.');
    window.addEventListener('pixinotes:quota', warn);
    return () => window.removeEventListener('pixinotes:quota', warn);
  }, [showToast]);

  return (
    // key=importEpoch: Nach „Vom Sync-Ordner laden" muss auch der React-Flow-
    // Provider-Store neu entstehen — sonst serviert er den frisch gemounteten
    // Karten für einen Moment die ALTEN Knoten, und BlockNote (liest Inhalt
    // nur beim Mount) friert den alten Text ein.
    <ReactFlowProvider key={importEpoch}>
      {/* M235: `fokus-voll` nimmt am großen Bildschirm die Blatt-Darstellung
          zurück — dann füllt die Karte das Bild wie am Handy (⚙ → Design). */}
      {/* M238: `nav-links` bittet um die linke Spalte — ob sie kommt, entscheidet
          das Stylesheet: Unterhalb der Tablet-Breite bleibt es bei der
          Kopfleiste, dort wäre eine Spalte nur verlorene Fläche. */}
      <div
        className={`app${focusCard ? ' focus-mode' : ''}${focusCard && fokusVollbild ? ' fokus-voll' : ''}${navLinks ? ' nav-links' : ''}`}
        style={{ '--nav-w': `${spalteBreite}px` } as CSSProperties}
      >
        <div className="topbar">
          <AboutMenu />
          <TopActions />
        </div>
        <Tabs />
        {view === 'overview' ? (
          <ErrorBoundary what="Die Übersicht" full>
            <Overview />
            {/* M297: Der Baum steht in der linken Spalte (Tabs) — in jeder Ansicht. */}
          </ErrorBoundary>
        ) : presenting ? null : tasksOpen ? (
          <ErrorBoundary what="Die Aufgaben-Zentrale" full><TaskHub /></ErrorBoundary>
        ) : (
          // Während Präsentation/Aufgaben-Zentrale ist das Board ausgehängt:
          // Beide editieren dieselben Karten, und die Karten-Editoren (BlockNote)
          // lesen ihren Inhalt nur beim Mount — so übernimmt das Board die
          // Änderungen beim Zurückkehren garantiert frisch.
          <>
            <ErrorBoundary what="Das Board" full><Board /></ErrorBoundary>
            <Dock />
            <ErrorBoundary what="Das Backlinks-Panel"><BacklinksPanel /></ErrorBoundary>
            {/* M202: Teilen-Dialog für ausgewählte Karten */}
            <ShareCardsModal />
            {/* M212: Karte im Fokus (Handy) — Rahmen und Bedienung; die Karte
                selbst bleibt im Board-Baum und wird per CSS formatfüllend */}
            <FocusSheet />
          </>
        )}
        <Onboarding />
        <SearchOverlay />
      <HelpOverlay />
      <BildExport />
      {/* M290: Aus einer anderen App geteilt (Android) — fragt nach dem Ziel */}
      <GeteiltDialog />
      <LookupPanel />
      <TooltipLayer />
      <Tastatur />
        <Settings />
        <RechercheDialog />
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
        {/* M360: Nur lesend geteiltes Board — sagen, warum nichts geht, und den Ausweg anbieten */}
        {nurLesenBoard && view === 'board' && !presenting && !focusCard && (
          <div className="lese-band" role="status" data-taste="lese-band">
            <span>🔒 <b>Nur lesen</b> · {nurLesenBoard.von ? `geteilt von ${nurLesenBoard.von}` : 'geteiltes Board'}</span>
            <button onClick={() => useBoard.getState().duplicateBoard(nurLesenBoard.id)} data-taste="lese-kopie">Eigene Kopie anlegen</button>
          </div>
        )}
        {writerRole === 'follower' && (
          <div className="writer-banner" role="status">
            <span>
              {/* M247: genauer sagen, WAS hier nicht gespeichert wird. „Liest nur mit"
                  klang wie „gar nichts geht" — dabei betrifft es nur die Inhalte;
                  Design und Anzeige werden auch hier dauerhaft gemerkt. */}
              👀 PixiNotes ist in einem anderen Fenster/Tab geöffnet — <b>Änderungen an Karten
              werden hier nicht gespeichert</b>, damit sich die Stände nicht gegenseitig
              überschreiben. Design- und Anzeige-Einstellungen bleiben erhalten.
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
          {toast?.abbruch && (
            <button className="toast-undo" data-taste="ki-abbrechen" onClick={() => { kiAbbrechen(); useBoard.getState().showToast('⏹ Abbruch angefordert — die laufende Portion wird noch beendet …', false, 8000); }}>
              Abbrechen
            </button>
          )}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
