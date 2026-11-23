import { QR_EREIGNIS, type QrWunsch } from './lib/qr';
import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { auswahlLeisteLaden, Board, kartenVorladen, kommentareLaden } from './components/Board';
import { Dock } from './components/Dock';
import { Tabs } from './components/Tabs';
import { TopActions } from './components/TopActions';
import {
  adoptPersistedState, claimWriter, getWriterRole, hinweisKnopfDruecken, reassertPersist,
  selectActiveBoard, selectNurLesen, singleWriterSupported, takeOverWriter, useBoard, type WriterRole,
} from './store';
import { initAutoSync } from './lib/syncFolder';
import { sicherungStartFaellig, SICHERUNG_EREIGNIS } from './lib/sicherungTakt';
import { initProjectAutoSync } from './lib/projectSync';
import { cleanupOrphanHtml } from './lib/htmlStore';
import { cleanupOrphanFiles } from './lib/fileStore';
import { initBoardVersionen, versionsAnhaenge, verwaisteAufraeumen, VERSIONEN_EREIGNIS } from './lib/boardVersionen';
import { initWebdavSync } from './lib/webdav';
import { initFilesSync } from './lib/filesSync';
import { initBrain } from './lib/brainStart';
import { kiAbbrechen } from './lib/ai';
import { AboutMenu } from './components/AboutMenu';
import { FocusSheet } from './components/FocusSheet';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Onboarding } from './components/Onboarding';
import { BacklinksPanel } from './components/BacklinksPanel';
import { GeteiltHost } from './components/GeteiltHost';
import { TooltipLayer } from './components/TooltipLayer';
import { Tastatur } from './components/Tastatur';
import { collectTasks, dueTasksToRemind, notifyBrowser } from './lib/tasks';
import { kontoKennung, serienAusstehend, termineHintergrund, termineZuErinnern } from './lib/termineZentrale';
import { fristenAusstehend, fristenLaden } from './lib/dates';
import { rufnummernLaden } from './lib/rufnummer';
import { autoArchivAlleBoards } from './lib/ticketArchiv';
import { clearShareHash, cloneSharedBoard, readShareHash } from './lib/share';
import { initGrabsteine } from './lib/grabsteine';
import { einladungAnnehmen, einladungOffen, einladungTokenAbholen } from './lib/einladung';
// M502: Vorführen, Mauszeiger und Gruppenraum kommen mit dem Live-Abgleich (lib/gastSync.ts) — hier nur der leichte Teil
import { folgeIch, VORFUEHR_EREIGNIS, werFuehrtVor } from './lib/vorfuehrenLeicht';
import { PunkteLeisteSpaet, punkteLaden } from './components/PunkteSpaet';
import { rechenTabelleLaden } from './components/RechenTabelle';
import { SprachHinweis } from './components/SprachHinweis';
import { GastNameDialog, GruppenraumSpaet, LiveLeiste, NAME_FRAGEN, VorfuehrenSpaet } from './components/LiveLeiste';
import { FreigabeHost, freigabeDialogLaden } from './components/FreigabeHost';
import { BildEditorHost } from './components/BildEditorHost';
import { EbeneLoeschenHost } from './components/EbeneLoeschenDialog';
import { getAuthor } from './lib/autor';
import { loadKonto } from './lib/kontoSitzung';
import { initSyncStart } from './lib/syncStart';
import { sprache, zahlWort } from './lib/sprache';
import { ILock } from './components/Icons';
import { EINGANG_OEFFNEN, eingangWaechter } from './lib/eingang';
import { importLaden } from './lib/importSpaet';
import { seitenBreitenReparieren } from './lib/seitenBreiten'; // M355: zu dick gespeicherte Seitenstriche (M354-Fehler) einmal richten

/**
 * M377: Die Hilfe ist der größte Textblock der App (gut 100 KB) und wird selten geöffnet — sie lädt erst, wenn
 * jemand sie aufruft. So bleibt der eigene App-Teil unter seiner Grenze (m321), obwohl Funktionen dazukommen.
 * Einmal geladen, bleibt sie da (Suchbegriff und Stelle bleiben beim Schließen erhalten).
 */
const HelpOverlayLazy = lazy(async () => {
  // M382: bei englischer Oberfläche kommt die englische Fassung der Hilfe gleich mit
  const [m, en] = await Promise.all([
    import('./components/HelpOverlay'),
    sprache() === 'en' ? import('./components/HelpOverlayEn').catch(() => null) : null,
  ]);
  if (en) m.hilfeEnglischSetzen(en);
  return { default: m.HelpOverlay };
});
function Hilfe() {
  const offen = useBoard((s) => s.helpOpen);
  const [geladen, setGeladen] = useState(false);
  useEffect(() => { if (offen) setGeladen(true); }, [offen]);
  return offen || geladen ? <Suspense fallback={null}><HelpOverlayLazy /></Suspense> : null;
}

/**
 * M398: Die Einstellungen kommen erst mit dem ersten Öffnen – das große Blatt gehört nicht in den Start.
 * Danach bleibt es eingehängt: Reiter und Eingaben überleben das Schließen wie zuvor.
 */
const SettingsLazy = lazy(() => import('./components/Settings').then((m) => ({ default: m.Settings })));
function Einstellungen() {
  const offen = useBoard((s) => s.settingsOpen);
  const [geladen, setGeladen] = useState(false);
  useEffect(() => { if (offen) setGeladen(true); }, [offen]);
  return offen || geladen ? <Suspense fallback={null}><SettingsLazy /></Suspense> : null;
}

/**
 * M379: Der Vorlagen-Dialog wird erst geladen, wenn ihn jemand aufruft (＋ Neu → „Board aus Vorlage",
 * oder der Knopf auf dem leeren Board) — die Vorlagen selbst reisen mit ihm, nicht mit dem Start.
 */
const VorlagenDialogLazy = lazy(() => import('./components/VorlagenDialog').then((m) => ({ default: m.VorlagenDialog })));
function Vorlagen() {
  const [wunsch, setWunsch] = useState<{ projectId?: string; inBoard?: string } | null>(null);
  useEffect(() => {
    const auf = (e: Event) => setWunsch((e as CustomEvent<{ projectId?: string; inBoard?: string }>).detail ?? {});
    window.addEventListener('pixinotes:vorlagen', auf);
    return () => window.removeEventListener('pixinotes:vorlagen', auf);
  }, []);
  return wunsch ? <Suspense fallback={null}><VorlagenDialogLazy wunsch={wunsch} onClose={() => setWunsch(null)} /></Suspense> : null;
}

/** M449: Der Versionen-Dialog wird erst geladen, wenn ihn jemand aufruft (Mehr-Menü, Board-⋯, Strg+K) */
const VersionenDialogLazy = lazy(() => import('./components/VersionenDialog').then((m) => ({ default: m.VersionenDialog })));
function Versionen() {
  const [boardId, setBoardId] = useState<string | null>(null);
  useEffect(() => {
    const auf = (e: Event) => setBoardId((e as CustomEvent<{ boardId?: string }>).detail?.boardId ?? useBoard.getState().activeId);
    window.addEventListener(VERSIONEN_EREIGNIS, auf);
    return () => window.removeEventListener(VERSIONEN_EREIGNIS, auf);
  }, []);
  return boardId ? <Suspense fallback={null}><VersionenDialogLazy boardId={boardId} onClose={() => setBoardId(null)} /></Suspense> : null;
}

/** M476: Sicherung einspielen — der Dialog (samt ZIP-Leser) kommt erst, wenn jemand eine Sicherung einspielt */
const SicherungDialogLazy = lazy(() => import('./components/SicherungDialog').then((m) => ({ default: m.SicherungDialog })));
function SicherungEinspielen() {
  const [offen, setOffen] = useState<{ datei?: File } | null>(null);
  useEffect(() => {
    const auf = (e: Event) => setOffen({ datei: (e as CustomEvent<{ datei?: File }>).detail?.datei });
    window.addEventListener(SICHERUNG_EREIGNIS, auf);
    return () => window.removeEventListener(SICHERUNG_EREIGNIS, auf);
  }, []);
  return offen ? <Suspense fallback={null}><SicherungDialogLazy key={offen.datei?.name ?? '-'} datei={offen.datei} onClose={() => setOffen(null)} /></Suspense> : null;
}

/** M466: Das Outlook-Fenster (Microsoft Graph) kommt erst mit dem ersten Aufruf — Strg+K „Outlook" oder ＋ → Outlook */
const OutlookLazy = lazy(() => import('./components/OutlookFenster').then((m) => ({ default: m.OutlookFenster })));
function Outlook() {
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    const auf = () => setOffen(true);
    window.addEventListener('pixinotes:outlook', auf);
    return () => window.removeEventListener('pixinotes:outlook', auf);
  }, []);
  return offen ? <Suspense fallback={null}><OutlookLazy onClose={() => setOffen(false)} /></Suspense> : null;
}

/** M478: Die Eingangs-Liste wird erst geladen, wenn jemand sie öffnet (Zähler in der Spalte, Strg+K, Sprung) */
const EingangLazy = lazy(() => import('./components/EingangFenster').then((m) => ({ default: m.EingangFenster })));
function Eingang() {
  const [offen, setOffen] = useState<{ gruppe?: string; n: number } | null>(null);
  useEffect(() => {
    const auf = (e: Event) => setOffen((o) => ({ gruppe: (e as CustomEvent<{ gruppe?: string }>).detail?.gruppe, n: (o?.n ?? 0) + 1 }));
    window.addEventListener(EINGANG_OEFFNEN, auf);
    const aus = eingangWaechter();
    return () => { window.removeEventListener(EINGANG_OEFFNEN, auf); aus(); };
  }, []);
  return offen ? <Suspense fallback={null}><EingangLazy gruppe={offen.gruppe} wunsch={offen.n} onClose={() => setOffen(null)} /></Suspense> : null;
}

/** M385: Die QR-Einblendung (samt Rechenbibliothek) wird erst geladen, wenn jemand sie aufruft */
const QrBlendeLazy = lazy(() => import('./components/QrBlende').then((m) => ({ default: m.QrBlende })));
function Qr() {
  const [wunsch, setWunsch] = useState<QrWunsch | null>(null);
  useEffect(() => {
    const auf = (e: Event) => setWunsch((e as CustomEvent<QrWunsch>).detail ?? null);
    window.addEventListener(QR_EREIGNIS, auf);
    return () => window.removeEventListener(QR_EREIGNIS, auf);
  }, []);
  return wunsch ? <Suspense fallback={null}><QrBlendeLazy wunsch={wunsch} onClose={() => setWunsch(null)} /></Suspense> : null;
}

/**
 * M446: Übersicht, Aufgaben-Zentrale, Präsentation, Suche und Recherche gehören nicht in den Start — sie kommen
 * mit dem ersten Aufruf (wie Hilfe und Einstellungen, M377/M398) und bleiben danach eingehängt, damit ihr
 * Zustand das Schließen überlebt wie zuvor. Kurz nach dem Start holt `imLeerlaufVorladen()` sie still nach:
 * Der erste Aufruf wartet dann nicht, und der Service Worker hat sie auch für den Offline-Betrieb.
 */
const LADER = {
  overview: () => import('./components/Overview'),
  taskhub: () => Promise.all([import('./components/TaskHub'), fristenLaden().catch(() => {})]).then(([m]) => m),   // M459: liest Fristen
  presenter: () => import('./components/Presenter'),
  suche: () => import('./components/SearchOverlay'),
  recherche: () => import('./components/RechercheDialog'),
  // M483: Karten teilen und Bild/PDF-Export — Dialoge, die erst mit dem Aufruf gebraucht werden
  teilen: () => import('./components/ShareCardsModal'),
  bildExport: () => import('./components/BildExport'),
  // M502: Nachschlagen (Wikipedia & Co.) — öffnet erst auf Wunsch
  nachschlagen: () => import('./components/LookupPanel'),
};
const OverviewLazy = lazy(() => LADER.overview().then((m) => ({ default: m.Overview })));
const TaskHubLazy = lazy(() => LADER.taskhub().then((m) => ({ default: m.TaskHub })));
const PresenterLazy = lazy(() => LADER.presenter().then((m) => ({ default: m.Presenter })));
const SearchOverlayLazy = lazy(() => LADER.suche().then((m) => ({ default: m.SearchOverlay })));
const RechercheLazy = lazy(() => LADER.recherche().then((m) => ({ default: m.RechercheDialog })));
const ShareCardsLazy = lazy(() => LADER.teilen().then((m) => ({ default: m.ShareCardsModal })));
const BildExportLazy = lazy(() => LADER.bildExport().then((m) => ({ default: m.BildExport })));
const LookupLazy = lazy(() => LADER.nachschlagen().then((m) => ({ default: m.LookupPanel })));

/** Einmal geöffnet, bleibt der Teil eingehängt (er schließt sich selbst über seinen Store-Schalter) */
function BeiBedarf({ offen, children }: { offen: boolean; children: ReactNode }) {
  const [geladen, setGeladen] = useState(false);
  useEffect(() => { if (offen) setGeladen(true); }, [offen]);
  return offen || geladen ? <Suspense fallback={null}>{children}</Suspense> : null;
}
/** Die Präsentation öffnet sich auch, wenn ich jemandem folge, der vorführt (M371/M387) — das entscheidet der
 *  Presenter selbst; er muss dafür nur eingehängt sein, sobald ein Vortrag läuft, dem ich folge. */
function Praesentation() {
  const presenting = useBoard((s) => s.presenting);
  const boardId = useBoard((s) => s.activeId);
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(VORFUEHR_EREIGNIS, auf);
    return () => window.removeEventListener(VORFUEHR_EREIGNIS, auf);
  }, []);
  const folgeVortrag = folgeIch(boardId) && !!werFuehrtVor(boardId)?.vortrag;
  return <BeiBedarf offen={presenting || folgeVortrag}><PresenterLazy /></BeiBedarf>;
}
/** M483: Teilen-Dialog für ausgewählte Karten (M202) und Bild-Export — beide über ihren Store-Schalter */
function KartenTeilen() {
  return <BeiBedarf offen={useBoard((s) => !!s.shareCards)}><ShareCardsLazy /></BeiBedarf>;
}
function BildExportFenster() {
  return <BeiBedarf offen={useBoard((s) => s.bildExportOpen)}><BildExportLazy /></BeiBedarf>;
}
/** M502: Nachschlagen (M168) — der Teil kommt mit dem ersten Aufruf */
function Nachschlagen() {
  return <BeiBedarf offen={useBoard((s) => s.lookup !== null)}><LookupLazy /></BeiBedarf>;
}
function Recherche() {
  return <BeiBedarf offen={useBoard((s) => s.rechercheOpen)}><RechercheLazy /></BeiBedarf>;
}
/** Die Suche öffnet auch per Strg/⌘ + K — bis der Teil da ist, hört dieser kleine Platzhalter auf die Taste */
function Suche() {
  const offen = useBoard((s) => s.searchOpen);
  const [geladen, setGeladen] = useState(false);
  useEffect(() => { if (offen) setGeladen(true); }, [offen]);
  useEffect(() => {
    if (geladen) return;   // ab jetzt fängt SearchOverlay die Taste selbst
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); useBoard.getState().setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [geladen]);
  return offen || geladen ? <Suspense fallback={null}><SearchOverlayLazy /></Suspense> : null;
}

/** M446: Nachgeladenes still holen, sobald der Start durch ist — nicht, wenn der Browser Daten sparen soll */
function imLeerlaufVorladen() {
  const sparen = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (sparen) return;
  const los = () => {
    void kartenVorladen();
    for (const l of Object.values(LADER)) void l().catch(() => null);
    // M459: Fristen- und Rufnummern-Erkennung, Freigabe-Dialog und der Konto-/Team-Abgleich (nur geladen, nicht
    // gestartet) — für den Service Worker, damit sie auch offline da sind
    void fristenLaden().catch(() => null);
    void rufnummernLaden().catch(() => null);
    void freigabeDialogLaden().catch(() => null);
    void import('./lib/gastSync').catch(() => null);
    // M483: Auswahl-Leiste, Datei-Import und Beispiele — damit die erste Auswahl, das erste Ablegen und „Beispiele
    // laden" ohne Verzug gehen und der Service Worker sie auch offline hat
    void auswahlLeisteLaden().catch(() => null);
    void importLaden().catch(() => null);
    void import('./lib/starter').catch(() => null);
    void import('./components/GeteiltDialog').catch(() => null);
    void import('./components/EbeneLoeschenFenster').catch(() => null);
    void import('./lib/kontaktExport').catch(() => null);
    // M502: Rechen-Tabelle in Notizen, Live-Team (Vorführen, Zeiger, Gruppenraum kommen mit gastSync bzw. dem
    // Presenter), Handschrift-Struktur und das Gehirn — damit der erste Aufruf nicht wartet und alles offline da ist
    void rechenTabelleLaden().catch(() => null);
    void kommentareLaden().catch(() => null);
    void punkteLaden().catch(() => null);
    void import('./components/Vorfuehren').catch(() => null);
    void import('./components/Mauszeiger').catch(() => null);
    void import('./components/Gruppenraum').catch(() => null);
    void import('./lib/handschriftStruktur').catch(() => null);
    void import('./lib/brain').catch(() => null);
  };
  const ric = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  window.setTimeout(() => (ric ? ric(los, { timeout: 4000 }) : los()), VORLADEN_NACH_MS);
}
/** So lange nach dem Laden warten — der Start selbst (erstes Board, Editor) hat Vorrang */
const VORLADEN_NACH_MS = 4000;
/** M502: Texterkennung in Bildern — Wächter laden und die erste Runde planen (vorher: 4 s nach dem Laden) */
const BILDTEXT_NACH_MS = 4000;

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
  const showToast = useBoard((s) => s.showToast);
  // M360: Ist das offene Board nur zum Lesen geteilt? (Kennung und Besitzer für das Hinweisband)
  const nurLesenId = useBoard((s) => (selectNurLesen(s) ? s.activeId : ''));
  const nurLesenVon = useBoard((s) => (selectNurLesen(s) ? selectActiveBoard(s).geteiltVonName ?? '' : ''));
  const nurLesenBoard = nurLesenId ? { id: nurLesenId, von: nurLesenVon } : null;

  // Auto-Sync in den verbundenen Sync-Ordner (Nextcloud & Co.) — no-op ohne Verbindung
  useEffect(() => { initAutoSync(); initProjectAutoSync(); initWebdavSync(); initFilesSync(); initSyncStart(); initBrain(); initGrabsteine(); initBoardVersionen(); seitenBreitenReparieren();
    // M476: Auto-Sicherung bzw. die Erinnerung nach 14 Tagen — der Code dafür lädt nur nach, wenn etwas fällig ist
    window.setTimeout(() => { if (sicherungStartFaellig()) void import('./lib/sicherung').then((m) => m.sicherungStart()); }, 6000); imLeerlaufVorladen(); window.setTimeout(() => useBoard.getState().fristAnkerNachtragen(), 1200); }, []);

  // Eigene Apps (M158): verwaiste HTML-Inhalte in IndexedDB entsorgen —
  // NUR beim Start (dann kann kein Undo eine gelöschte App-Karte zurückholen,
  // deren Inhalt hier gerade wegfiele); verzögert, damit der Boot flüssig bleibt
  useEffect(() => {
    const t = setTimeout(async () => {
      // M449: Inhalte, die ein gesicherter Board-Stand noch braucht, bleiben liegen — sonst käme eine Datei-Karte
      // aus einer älteren Version leer zurück
      const ausVersionen = await versionsAnhaenge();
      void verwaisteAufraeumen(new Set(useBoard.getState().boards.map((b) => b.id)));
      const ids = new Set(
        [...useBoard.getState().boards.flatMap((b) => b.nodes.filter((n) => n.type === 'htmlapp').map((n) => n.id)),
          // M390: … und der Vorlagen — ihr Tool-Quelltext liegt unter der Kennung der Vorlage
          ...useBoard.getState().templates.filter((t) => t.node.type === 'htmlapp').map((t) => t.node.id), ...ausVersionen],
      );
      void cleanupOrphanHtml(ids);
      // M259: dasselbe für die Inhalte von Datei-Karten
      const dateiIds = new Set(
        // M388: … und der Tool-Karten: Ein Quelltext, der per Ordner/WebDAV kam, liegt bis zum ersten Öffnen der Karte
        // noch unter der Datei-Kennung — das Aufräumen löschte ihn sonst, bevor er je gezeigt wurde
        // M406: … und der Rechen-Tabellen aus einer Excel-Datei – ihr Original liegt unter der Kennung der Karte
        [...useBoard.getState().boards.flatMap((b) => b.nodes.filter((n) => n.type === 'file' || n.type === 'htmlapp' || n.type === 'sheet').map((n) => n.id)),
          ...useBoard.getState().templates.filter((t) => t.node.type === 'file' || t.node.type === 'htmlapp' || t.node.type === 'sheet').map((t) => t.node.id), ...ausVersionen],
      );
      void cleanupOrphanFiles(dateiIds);
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  // M452: Text in Bildern erkennen — die Engine kommt erst im Leerlauf und nur, wenn ein Bild wartet
  // M502: … und auch ihr Wächter (lib/textInBildern.ts) lädt erst nach dem Start — die erste Runde lief ohnehin erst
  // 4 s nach dem Laden der Seite
  useEffect(() => {
    let stopp: (() => void) | null = null;
    let weg = false;
    const t = window.setTimeout(() => {
      void import('./lib/textInBildern').then((m) => { if (!weg) stopp = m.bildTextStarten(0); }).catch(() => {});
    }, BILDTEXT_NACH_MS);
    return () => { weg = true; window.clearTimeout(t); stopp?.(); };
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
      useBoard.getState().showToast('Physik ist jetzt aus. Bewegung beim Ziehen: Einstellungen → Darstellung.', false, 8000);
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  // Design anwenden: data-theme/-accent am <html>; „System" folgt dem Gerät live
  const ui = useBoard((s) => s.ui);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    // M397: Die Statusleiste des Geräts trägt die Farbe des App-Grunds, nicht
    // mehr den Akzent – ein kräftig blauer Balken über einer ruhigen App
    // wirkt wie ein Fremdkörper (vorher M178: Akzentfarbe)
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
      meta.content = dark ? '#141618' : '#f3f4f6';
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
      if (window.confirm(`Geteiltes Board „${shared.name ?? 'Board'}" (${zahlWort(shared.nodes?.length ?? 0, 'Karte', 'Karten')}) übernehmen?`)) {
        claimWriter(); // bewusster Import — auch aus einem Mitlese-Fenster wirksam
        st.importBoard(cloneSharedBoard(shared));
        st.showToast('Geteiltes Board übernommen – liegt als eigenes Board in deiner Tab-Leiste.');
      }
    })();
  }, []);

  // M357: Kurzer Link (#l=<token>) — die geteilte Fassung holen und DIREKT öffnen, ohne Rückfrage:
  // Wer auf einen Link klickt, will das Board sehen; es kommt als eigenes Board dazu und ersetzt nichts.
  useEffect(() => {
    // M459: nur das Erkennen ist im Start — Laden und Öffnen (lib/linkTeilen.ts) kommen mit dem Link
    const m = location.hash.match(/^#l=([A-Za-z0-9_-]{20,64})$/);
    if (!m) return;
    void import('./lib/linkTeilen').then(({ linkOeffnen, linkTokenAbholen }) => {
      const token = linkTokenAbholen();
      if (!token) return;
      const st = useBoard.getState();
      st.showToast('Geteiltes Board wird geladen …');
      claimWriter(); // bewusster Import — auch aus einem Mitlese-Fenster wirksam
      linkOeffnen(token, (name) => window.confirm(`Von „${name}" gibt es eine neuere Fassung.\n\nOK = neue Fassung laden (als weiteres Board, dein bisheriges bleibt)\nAbbrechen = dein bisheriges öffnen`))
        .then((wie) => useBoard.getState().showToast(wie === 'vorhanden'
          ? 'Geteiltes Board geöffnet – du hattest es schon.'
          : 'Geteiltes Board geöffnet – es ist jetzt dein eigenes; Änderungen bleiben bei dir.', false, 6000))
        .catch((e: Error) => useBoard.getState().showToast(`${e.message}`, false, 9000));
    }).catch((e: Error) => useBoard.getState().showToast(`${e.message}`, false, 9000));
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
          st.showToast('Einladung zu einem gemeinsamen Board: Melde dich mit E-Mail an – danach öffnet es sich von selbst.', false, 14000);
          st.setSettingsOpen(true, 'konto');
        } else if (r.art === 'eigen') {
          st.showToast('Das ist der Einladungslink zu deinem eigenen Board – gib ihn an die anderen weiter.', false, 7000);
        } else if (r.art === 'gast') {
          // M364: ohne Konto dabei — einmal nach dem Namen fragen, damit die anderen sehen, wer schreibt
          st.showToast(r.rolle === 'lesen'
            ? 'Gemeinsames Board geöffnet – du liest live mit (nur lesen).'
            : 'Du bist dabei – alle arbeiten live im selben Board. Eine Karte gehört dem, der sie gerade bearbeitet.', false, 9000);
          if (!getAuthor().trim()) window.dispatchEvent(new CustomEvent(NAME_FRAGEN));
        } else {
          const von = r.von ? ` von ${r.von}` : '';
          st.showToast(r.rolle === 'lesen'
            ? `Geteiltes Board${von} geöffnet – du liest live mit (nur lesen).`
            : `Geteiltes Board${von} geöffnet – ihr arbeitet jetzt gemeinsam daran.`, false, 8000);
        }
      }).catch((e: Error) => useBoard.getState().showToast(`${e.message}`, false, 9000))
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
      const aufgaben = collectTasks(boards);
      // M459: Die Fristen-Erkennung wurde eben erst angestoßen — mit ihr zählen, sonst fehlten die fälligen
      const ausstehend = fristenAusstehend();
      if (ausstehend) { void ausstehend.then(remind, () => {}); return; }
      // M473: Serientermine aus ICS-Abos — die Auflösung lädt nach, bevor erinnert wird
      const serienFehlen = serienAusstehend(useBoard.getState().boards);
      if (serienFehlen) { void serienFehlen.then(remind, () => {}); return; }
      const hits = dueTasksToRemind(aufgaben);
      if (hits.length === 1) {
        showToast(`Fällig: „${hits[0].text}" (${hits[0].boardName}) – Details in der Aufgaben-Zentrale`);
        notifyBrowser('PixiNotes Aufgabe fällig', `${hits[0].text} (${hits[0].boardName})`);
      } else if (hits.length > 1) {
        showToast(`${zahlWort(hits.length, 'Aufgabe', 'Aufgaben')} fällig – Details in der Aufgaben-Zentrale`);
        notifyBrowser('PixiNotes', `${hits.length} Aufgaben sind fällig`);
      }
      // M469: Termine kurz vor Beginn — nur mit Einstellung, aus gemerkten Abrufen und den Kalender-Karten (M471)
      const termineMelden = (verzoegert: boolean) => {
        const termine = termineZuErinnern(aufgaben, new Date(), useBoard.getState().boards);
        if (!termine.length) return;
        const t = termine[0];
        const melden = () => {
          if (termine.length === 1) showToast(`Termin um ${t.time}: „${t.title}" (${kontoKennung(t.quelle)})`, false, 9000);
          else showToast(`${zahlWort(termine.length, 'Termin', 'Termine')} beginnen gleich – ab ${t.time}: „${t.title}"`, false, 9000);
          notifyBrowser('PixiNotes Termin', `${t.time} ${t.title}`);
        };
        if (verzoegert) setTimeout(melden, 6000); else melden();
      };
      termineMelden(hits.length > 0);
      // M471: Mit eingeschalteter Erinnerung Heute/Morgen sparsam nachholen (höchstens alle 15 Minuten, sonst kein Netz)
      // — danach noch einmal prüfen, damit ein eben erst eingetragener Termin nicht verpasst wird
      termineHintergrund()?.then(() => termineMelden(hits.length > 0));
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
        useBoard.getState().showToast(`${n} erledigte${n === 1 ? 's Ticket' : ' Tickets'} automatisch archiviert.`);
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
      showToast('Ein zweites PixiNotes-Fenster schreibt mit, bitte das andere Fenster schließen.');
    };
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('storage', onStorage); clearTimeout(adoptTimer); };
  }, [showToast]);

  // Quota-Warnung aus dem Storage-Layer (Audit K1)
  useEffect(() => {
    const warn = () =>
      showToast('Speicher voll, Änderungen werden nicht gesichert. Große Bilder löschen oder exportieren.');
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
            <Suspense fallback={null}><OverviewLazy /></Suspense>
            {/* M297: Der Baum steht in der linken Spalte (Tabs) — in jeder Ansicht. */}
          </ErrorBoundary>
        ) : presenting ? null : tasksOpen ? (
          <ErrorBoundary what="Die Aufgaben-Zentrale" full><Suspense fallback={null}><TaskHubLazy /></Suspense></ErrorBoundary>
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
            <KartenTeilen />
            {/* M212: Karte im Fokus (Handy) — Rahmen und Bedienung; die Karte
                selbst bleibt im Board-Baum und wird per CSS formatfüllend */}
            <FocusSheet />
          </>
        )}
        <Onboarding />
        <Suche />
      <Hilfe />
      <Vorlagen />
      <Qr />
      <Versionen />
      <SicherungEinspielen />
      <Outlook />
      <Eingang />
      <BildExportFenster />
      {/* M290: Aus einer anderen App geteilt (Android) — fragt nach dem Ziel */}
      <GeteiltHost />
      <Nachschlagen />
      <TooltipLayer />
      <Tastatur />
        <Einstellungen />
        <Recherche />
        <Praesentation />
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
        {/* M364: Gruppenarbeit — wer ist gerade im Board */}
        {view === 'board' && !presenting && !focusCard && !tasksOpen && <LiveLeiste />}
        {/* M367: „Folgt mir" — wer vorführt, wer folgt */}
        {/* M371: auch während der Präsentation — sie gehört jetzt zur Ansicht, die der Vorführende mitnimmt */}
        {view === 'board' && !tasksOpen && <VorfuehrenSpaet />}
        {/* M376: aufsteigende Reaktionen und die gemeinsame Uhr — über Board und Präsentation */}
        {view === 'board' && !tasksOpen && <GruppenraumSpaet />}
        {/* M377: Punkte-Modus — Karten antippen statt auswählen */}
        {view === 'board' && !tasksOpen && !presenting && <PunkteLeisteSpaet />}
        <GastNameDialog />
        <FreigabeHost />
        <BildEditorHost />
        <EbeneLoeschenHost />
        {/* M368: anderssprachigen Nutzern sagen, dass der Browser die Oberfläche übersetzen kann */}
        {!presenting && <SprachHinweis />}
        {/* M360: Nur lesend geteiltes Board — sagen, warum nichts geht, und den Ausweg anbieten */}
        {nurLesenBoard && view === 'board' && !presenting && !focusCard && (
          <div className="lese-band" role="status" data-taste="lese-band">
            <span><ILock size={13} /> <b>Nur lesen</b> · {nurLesenBoard.von ? `geteilt von ${nurLesenBoard.von}` : 'geteiltes Board'}</span>
            <button onClick={() => useBoard.getState().duplicateBoard(nurLesenBoard.id)} data-taste="lese-kopie">Eigene Kopie anlegen</button>
          </div>
        )}
        {writerRole === 'follower' && (
          <div className="writer-banner" role="status">
            <span>
              {/* M247: genauer sagen, WAS hier nicht gespeichert wird. „Liest nur mit"
                  klang wie „gar nichts geht" — dabei betrifft es nur die Inhalte;
                  Design und Anzeige werden auch hier dauerhaft gemerkt. */}
              PixiNotes ist in einem anderen Fenster/Tab geöffnet – <b>Änderungen an Karten
              werden hier nicht gespeichert</b>, damit sich die Stände nicht gegenseitig
              überschreiben. Design- und Anzeige-Einstellungen bleiben erhalten.
            </span>
            <button onClick={takeOverWriter}>Hier weiterarbeiten</button>
          </div>
        )}
        <div className={`toast ${toast ? 'show' : ''}`}>
          {toast?.message}
          {toast?.undo && (
            <button className="toast-undo" onClick={() => useBoard.getState().hinweisRueckgaengig()}>
              Rückgängig
            </button>
          )}
          {toast?.knopf && (
            <button className="toast-undo" data-taste="hinweis-knopf" onClick={hinweisKnopfDruecken}>{toast.knopf}</button>
          )}
          {toast?.abbruch && (
            <button className="toast-undo" data-taste="ki-abbrechen" onClick={() => { kiAbbrechen(); useBoard.getState().showToast('Abbruch angefordert – die laufende Portion wird noch beendet …', false, 8000); }}>
              Abbrechen
            </button>
          )}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
