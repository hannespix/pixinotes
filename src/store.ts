import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { buildStarter } from './lib/starter';
import { uid, type AppNode, type TimeSeg } from './types';
import { anchorStroke, integrateStroke } from './lib/strokeAnchor';
import { findFreeSpot, frameMembers } from './lib/arrange';

/** Ein Freihand-Strich (Punkte in Flow-Koordinaten) */
export interface Stroke {
  id: string;
  tool: 'pen' | 'marker';
  color: string;
  width: number;
  points: [number, number][];
  /** M127: an diese Karte geankert — die Punkte sind dann RELATIV zur
   *  Karten-Ecke und der Strich wandert bei jeder Kartenbewegung mit */
  anchor?: string;
}

/** Ebene 3: Ein Board = eine Leinwand voller Karten. */
export interface BoardDoc {
  id: string;
  name: string;
  nodes: AppNode[];
  edges: Edge[];
  drawings?: Stroke[];
  /** Dezente Hintergrund-Tönung (Palette-Schlüssel, M88) — fehlt ⇒ Standard */
  bg?: string;
  /** Kommentar-Threads (M148) — leben IM Board und wandern so automatisch
   *  im globalen Sync UND im Team-Projekt-Paket mit */
  comments?: CommentThread[];
}

/** Ein Kommentar-Pin an einer Karte mit seinem Gesprächsverlauf (M148) */
export interface CommentThread {
  id: string;
  nodeId: string;
  resolved?: boolean;
  msgs: Array<{ author: string; text: string; at: string }>;
}

export type Tool = 'select' | 'pen' | 'marker' | 'eraser';

/** Ein Undo-Schritt: kompletter Struktur-Stand eines Boards (Referenzen, kein Deep-Copy —
 *  alle Mutationen laufen immutabel, alte Objekte bleiben gültig). */
interface HistoryEntry {
  boardId: string;
  nodes: AppNode[];
  edges: Edge[];
  drawings?: Stroke[];
  /** Notiz-INHALTE haben sich geändert → Undo/Redo muss den Board-Remount
   *  erzwingen, sonst zeigen BlockNote-Editoren (lesen nur beim Mount) alten Text */
  remount?: boolean;
  /** M163 (Karten in anderes Board verschieben): der Schritt betrifft ZWEI
   *  Boards — Undo/Redo stellt Quelle UND Ziel gemeinsam wieder her */
  second?: { boardId: string; nodes: AppNode[]; edges: Edge[]; drawings?: Stroke[] };
}

const HISTORY_LIMIT = 50;

/** Wiederverwendbare Karten-Vorlage */
export interface CardTemplate {
  id: string;
  name: string;
  node: AppNode;
}

export type AiProvider = 'none' | 'free' | 'openrouter' | 'anthropic' | 'openai' | 'ollama' | 'custom';
export interface AiSettings {
  provider: AiProvider;
  model: string;
  apiKey: string;
  /** Basis-URL für Ollama / selbstgehostete OpenAI-kompatible Server */
  baseUrl: string;
}

/** Ebene 2: Ein Projekt bündelt Boards (geordnete Liste). */
export interface Project {
  id: string;
  name: string;
  boardIds: string[];
}

/** Ebene 1: Ein Bereich bündelt Projekte (z. B. „Arbeit", „Privat", „Team"). */
export interface Space {
  id: string;
  name: string;
  projects: Project[];
}

interface Toast {
  message: string;
  /** true → Toast zeigt einen „Rückgängig"-Knopf */
  undo?: boolean;
}

interface DeletedSnapshot {
  boardId: string;
  nodes: AppNode[];
  edges: Edge[];
  /** An gelöschte Karten geankerte Striche — kommen beim Wiederherstellen mit */
  drawings?: Stroke[];
}

interface BoardState {
  boards: BoardDoc[];
  spaces: Space[];
  activeId: string;
  view: 'overview' | 'board';
  toast: Toast | null;
  pendingFocus: { boardId: string; nodeId: string } | null;
  lastDeleted: DeletedSnapshot | null;
  tool: Tool;
  settingsOpen: boolean;
  presenting: boolean;
  ai: AiSettings;

  // Navigation
  setView: (view: 'overview' | 'board') => void;
  openBoard: (id: string) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean, section?: string | null) => void;
  /** Wunsch-Reiter beim Öffnen der Einstellungen (z. B. 'sync' vom Status-Chip) */
  settingsSection: string | null;
  /** Aufgaben-Zentrale (✅): eigene Ansicht statt Board */
  tasksOpen: boolean;
  setTasksOpen: (open: boolean) => void;
  /** Karten-Daten auf einem BELIEBIGEN Board ändern (Aufgaben-Zentrale arbeitet boardübergreifend) */
  updateNodeDataOnBoard: (boardId: string, nodeId: string, data: Record<string, unknown>) => void;
  setPresenting: (on: boolean) => void;
  setTool: (tool: Tool) => void;
  updateAi: (patch: Partial<AiSettings>) => void;
  /** Strich übernehmen; sessionIds = Striche derselben Zeichensitzung
   *  (sich berührende entscheiden GEMEINSAM über das Ankern, M128) */
  addStroke: (stroke: Stroke, sessionIds?: string[]) => void;
  eraseStrokesNear: (x: number, y: number, radius: number) => void;
  /** Geankerte Striche der Karten wieder freistellen (Punkte werden absolut) */
  detachStrokes: (nodeIds: string[]) => void;
  /** Radier-Geste beginnt: nächster tatsächlicher Lösch-Treffer macht EINEN History-Eintrag */
  beginEraseGesture: () => void;

  // Undo/Redo für Board-Struktur (Karten, Verbindungen, Striche — keine Tipp-Edits)
  past: HistoryEntry[];
  future: HistoryEntry[];
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  /** Kompletten Stand aus der Sync-Datei übernehmen (ersetzt Boards & Hierarchie) */
  importSync: (boards: BoardDoc[], spaces: Space[], activeId: string) => void;

  /** Team-Sync (M145): EIN Projekt samt Boards aus einem Projekt-Paket übernehmen —
   *  ersetzt nur dieses Projekt, alle anderen Bereiche/Projekte bleiben unberührt */
  importProject: (project: { id: string; name: string }, boards: BoardDoc[]) => void;

  // Trilium-Paket: Board-Verlauf (Revisionen) + Karten-Vorlagen
  templates: CardTemplate[];
  saveTemplate: (node: AppNode, name: string) => void;
  removeTemplate: (id: string) => void;
  /** Zählt Voll-Importe hoch — erzwingt Board-Remount (BlockNote liest nur beim Mount!) */
  importEpoch: number;

  // Hierarchie (Bereiche / Projekte / Boards)
  addSpace: (name?: string) => void;
  renameSpace: (id: string, name: string) => void;
  removeSpace: (id: string) => void;
  addProject: (spaceId: string, name?: string) => void;
  renameProject: (id: string, name: string) => void;
  removeProject: (id: string) => void;
  addBoard: (name?: string, projectId?: string) => string;
  /** Fertiges Board (geteilt/importiert) einhängen und öffnen */
  importBoard: (doc: BoardDoc) => void;
  renameBoard: (id: string, name: string) => void;
  /** Hintergrund-Tönung eines Boards setzen (undefined = Standard, M88) */
  setBoardBg: (id: string, bg: string | undefined) => void;
  /** Gitter anzeigen + Karten am Raster einrasten (persistiert, M88) */
  gridSnap: boolean;
  setGridSnap: (on: boolean) => void;
  removeBoard: (id: string) => void;
  /** Board in ein (anderes) Projekt verschieben, optional vor ein bestimmtes Board */
  moveBoard: (boardId: string, targetProjectId: string, beforeBoardId?: string) => void;

  // Karten & Verbindungen (aktives Board)
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  /** Verbindung mit Label direkt anlegen (KI-Vorschläge) */
  addLabeledEdge: (source: string, target: string, label: string, kind?: string) => void;
  /** M148: Kommentar-Panel — offener Thread ('id') bzw. neuer Kommentar ('new:<nodeId>') */
  commentOpen: string | null;
  setCommentOpen: (id: string | null) => void;
  /** M168: Nachschlage-Panel — null = zu, sonst der vorbefüllte Suchbegriff */
  lookup: string | null;
  setLookup: (q: string | null) => void;
  /** Kommentar anhängen: an bestehenden Thread (threadId) oder neuen an einer Karte eröffnen */
  addCommentMsg: (target: { threadId?: string; nodeId?: string }, author: string, text: string) => string | null;
  toggleCommentResolved: (threadId: string) => void;
  removeCommentThread: (threadId: string) => void;

  updateEdgeLabel: (id: string, label: string) => void;
  updateEdgeKind: (id: string, kind: string) => void;
  /** M146/M147: feingliedrige Verbindungsoptionen — Spitzen (Ende/Anfang),
   *  Spitzenform, Linienstärke, eigene Farbe */
  updateEdgeStyle: (id: string, patch: {
    head?: boolean; headStart?: boolean; shape?: string; width?: number; color?: string | null;
  }) => void;
  removeEdge: (id: string) => void;
  addNode: (node: AppNode) => void;
  /** Karte in ein BELIEBIGES Board einfügen (Schnell-Eingabe der Aufgaben-Zentrale, M114) */
  addNodeToBoard: (boardId: string, node: AppNode) => void;
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;
  /** M163: Karten in ein anderes Board verschieben — Rahmen nehmen ihre
   *  Mitglieder mit; interne Verbindungen, Kommentar-Pins und geankerte
   *  Zeichnungen wandern mit; EIN Undo-Schritt stellt beide Boards her */
  moveNodesToBoard: (ids: string[], targetBoardId: string) => void;
  restoreDeleted: () => void;
  /** Zuletzt angefasste Karte dauerhaft nach vorn (persistierter zIndex, ohne Undo-Eintrag) */
  touchNode: (id: string) => void;
  /** Klick-Zoom: beim Anklicken sanft zur Karte fliegen (wenn klein/außerhalb) */
  clickZoom: boolean;
  setClickZoom: (on: boolean) => void;
  /** Mausrad zoomt statt zu scrollen (Miro-Stil) */
  wheelZoom: boolean;
  setWheelZoom: (on: boolean) => void;
  /** M193: Übersicht — Hierarchie oder Netz. Liegt im Store, damit der
   *  Navigator (und damit JEDE Ansicht) direkt ins Netz springen kann. */
  overviewMode: 'hierarchie' | 'netz';
  setOverviewMode: (m: 'hierarchie' | 'netz') => void;
  /** M193: Welche Ebenen das Netz zeigt — bleibt erhalten, statt bei jedem
   *  Öffnen auf „Karten aus" zurückzufallen (User-Wunsch). */
  graphLayers: { cards: boolean; portals: boolean; wikis: boolean; projectOnly: boolean };
  setGraphLayer: (key: 'cards' | 'portals' | 'wikis' | 'projectOnly', on: boolean) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  /** Kartengröße setzen (Auto-Größe der Diagramm-Karte, M92c) */
  resizeNode: (id: string, width: number, height: number) => void;
  /** Nur die Höhe setzen — für die Auto-Größe aller Karten (M103) */
  setNodeHeight: (id: string, height: number) => void;
  /** Auto-Größe je Karte an/aus (M103; seit M111 Standard AN — false = manuell gebrochen) */
  setAutoFit: (ids: string[], on: boolean) => void;
  setNodePosition: (id: string, x: number, y: number) => void;
  /** Mehrere Positionen in EINEM Store-Update — für den Physik-Loop (60 fps) */
  setNodePositions: (entries: Array<[string, number, number]>) => void;
  focusNode: (boardId: string, nodeId: string) => void;
  clearPendingFocus: () => void;

  showToast: (message: string, undo?: boolean, durationMs?: number) => void;

  /** Globale KI-Sperre: verhindert parallele KI-Aktionen aus Dock UND Auswahl-Leiste */
  aiBusy: boolean;
  setAiBusy: (busy: boolean) => void;

  /** Starter-Umgebung „Verwaltung" zusätzlich anlegen (für Bestandsnutzer) */
  addStarter: () => void;
  /** M184: Ganze Struktur (Bereiche + Boards) in einem Rutsch einhängen —
   *  für den OneNote-Import. Merkt sich den Stand davor für „Import zurücknehmen". */
  importStructure: (payload: { spaces: Space[]; boards: BoardDoc[]; activeId?: string }) => void;
  /** Den letzten Struktur-Import wieder entfernen (Strg+Z kann das nicht) */
  undoImport: () => boolean;
  /** Liegt ein zurücknehmbarer Import vor? */
  canUndoImport: boolean;
  /** ALLES leeren: ein frisches leeres Board, Hierarchie/Versionen/Vorlagen zurückgesetzt */
  resetAll: () => void;

  /** Hilfe-Seite (❓ im Dock); section springt direkt zu einem Abschnitt (z. B. 'impressum') */
  helpOpen: boolean;
  helpSection: string | null;
  setHelpOpen: (open: boolean, section?: string | null) => void;

  /** Physik (Verdrängung/Wurf) global an/aus — aus = Karten dürfen überlappen/stapeln */
  physicsEnabled: boolean;
  setPhysicsEnabled: (on: boolean) => void;

  /** Archiv (M87): ganze Karten als erledigt ablegen bzw. zurückholen (undo-fähig) */
  setArchived: (ids: string[], archived: boolean) => void;
  /** Archivierte Karten sichtbar (gedimmt) statt ausgeblendet — persistiert */
  showArchived: boolean;
  setShowArchived: (on: boolean) => void;

  /** Design: Hell/Dunkel/System + Akzentfarbe (persistiert) */
  ui: { theme: 'system' | 'light' | 'dark'; accent: string };
  setUiTheme: (theme: 'system' | 'light' | 'dark') => void;
  setUiAccent: (accent: string) => void;
}

export const selectActiveBoard = (s: BoardState): BoardDoc =>
  s.boards.find((b) => b.id === s.activeId) ?? s.boards[0];

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Sammel-Aktionen (z. B. KI-Pläne): innere Mutatoren pushen KEINE eigenen
 *  History-Einträge — der Aufrufer sichert vorher genau einen Snapshot.
 *  So macht wirklich EIN Strg+Z den kompletten Plan rückgängig (Audit R6-K1). */
let historyMuted = false;

/** M184: Stand vor dem letzten Struktur-Import (OneNote) — bewusst außerhalb
 *  des persistierten States: Ein Rückgängig gilt nur für die laufende Sitzung
 *  und soll nicht als riesiger Zweitstand mitgespeichert werden. */
let importUndo: { boards: BoardDoc[]; spaces: Space[]; activeId: string } | null = null;
export function mutedHistory<T>(fn: () => T): T {
  historyMuted = true;
  try {
    return fn();
  } finally {
    historyMuted = false;
  }
}

// Feingranulare History (M122): Modul-Bearbeitungen (Ticket-Felder, Diagramm-
// Code, Gantt-Zeilen, Notiz-Tipp-Bursts) werden undo-fähig. Aufeinander-
// folgende Änderungen am SELBEN Ziel innerhalb von 1,5 s teilen sich einen
// Eintrag — sonst würde jeder Tastendruck die History fluten.
let lastEditKey = '';
let lastEditAt = 0;
const EDIT_COALESCE_MS = 1500;

/** Haben sich Notiz-INHALTE zwischen zwei Ständen geändert? (Referenzvergleich)
 *  Dann muss Undo/Redo den Board-Remount erzwingen — BlockNote-Editoren lesen
 *  ihre Blöcke nur beim Mount und würden sonst alten Text zurückschreiben. */
function notesDiffer(a: AppNode[], b: AppNode[]): boolean {
  const blocksById = new Map(a.filter((n) => n.type === 'note').map((n) => [n.id, n.data.blocks]));
  return b.some((n) => {
    if (n.type !== 'note') return false;
    const prev = blocksById.get(n.id);
    return prev !== undefined && prev !== n.data.blocks;
  });
}
/** Radier-Geste: erster Treffer erzeugt den History-Eintrag, Rest der Geste nicht */
let eraseSnapPending = false;

/**
 * K1+M5-Schutz: localStorage-Writes werden gedrosselt (max. alle 400 ms statt
 * pro Tastendruck/Drag-Frame) und Quota-Fehler abgefangen statt die App zu
 * crashen. Bei vollem Speicher informiert ein Event die UI (Toast in App.tsx).
 */
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWrite: { key: string; value: string } | null = null;
let quotaWarned = false;

// ---------------------------------------------------------------------------
// Single-Writer-Schutz (Sync-Audit M81): Läuft PixiNotes doppelt (installierte
// PWA + vergessener Browser-Tab), teilen sich beide Kontexte denselben
// localStorage — bisher überschrieb der zuletzt schreibende kommentarlos den
// anderen. Genau so ging ein frisch geladener Sync-Stand nach dem Neustart
// wieder verloren. Jetzt hält genau EIN Kontext die Schreibrechte (Web Lock);
// alle weiteren Fenster laufen als Mitleser: sie schreiben nichts und
// übernehmen den Stand des Schreibers live (storage-Event → adopt).
export type WriterRole = 'writer' | 'follower';
let writerRole: WriterRole = 'writer'; // Standard: einziges Fenster schreibt
const LOCK_NAME = 'pixinotes-writer';
const hasLocks = typeof navigator !== 'undefined' && 'locks' in navigator;

export const getWriterRole = (): WriterRole => writerRole;
export const singleWriterSupported = (): boolean => hasLocks;

function setWriterRole(role: WriterRole): void {
  if (writerRole === role) return;
  writerRole = role;
  // Nie einen veralteten Puffer nachschieben (z. B. via visibilitychange-Flush)
  if (role === 'follower') pendingWrite = null;
  window.dispatchEvent(new CustomEvent('pixinotes:writer-change'));
}

/** Ausstehenden (gedrosselten) Persist-Write sofort schreiben.
 *  true = der aktuelle Stand liegt jetzt sicher in localStorage.
 *  Bei Quota-Fehler bleibt der Write gepuffert (Retry beim nächsten Flush). */
export function flushPersist(): boolean {
  if (!pendingWrite) return true;
  try {
    localStorage.setItem(pendingWrite.key, pendingWrite.value);
    pendingWrite = null;
    quotaWarned = false;
    return true;
  } catch {
    if (!quotaWarned) {
      quotaWarned = true;
      window.dispatchEvent(new CustomEvent('pixinotes:quota'));
    }
    return false;
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPersist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersist();
  });
}
const debouncedSafeStorage = {
  // pendingWrite mitlesen: ein getItem direkt nach setItem darf nie den
  // schon überholten localStorage-Stand liefern
  getItem: (k: string) => (pendingWrite?.key === k ? pendingWrite.value : localStorage.getItem(k)),
  setItem: (k: string, v: string) => {
    if (writerRole !== 'writer') return; // Mitlese-Fenster schreibt NIE
    pendingWrite = { key: k, value: v };
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushPersist, 400);
  },
  removeItem: (k: string) => {
    if (writerRole !== 'writer') return;
    pendingWrite = null;
    localStorage.removeItem(k);
  },
};

/** Persistierten Stand aus localStorage in den laufenden Store übernehmen —
 *  Mitleser folgen so dem Schreiber; ein Nachfolger übernimmt vor dem ersten
 *  eigenen Write, was der alte Schreiber zuletzt gesichert hat. */
export function adoptPersistedState(): boolean {
  try {
    const raw = localStorage.getItem('pixinotes-board');
    if (!raw) return false;
    const st = (JSON.parse(raw) as { state?: { boards?: BoardDoc[]; spaces?: Space[]; activeId?: string } }).state;
    if (!st || !Array.isArray(st.boards) || st.boards.length === 0 || !Array.isArray(st.spaces)) return false;
    useBoard.getState().importSync(st.boards, st.spaces, st.activeId ?? st.boards[0].id);
    return true;
  } catch {
    return false;
  }
}

const holdForever = () => new Promise<never>(() => {});
let succession: AbortController | null = null;

/** In die Warteschlange: sobald der aktuelle Schreiber schließt, übernehmen wir. */
function queueSuccession(): void {
  succession?.abort();
  const ctl = new AbortController();
  succession = ctl;
  void navigator.locks
    .request(LOCK_NAME, { signal: ctl.signal }, () => {
      adoptPersistedState(); // der alte Schreiber kann Neueres hinterlassen haben
      setWriterRole('writer');
      useBoard.getState().showToast('✍️ Das andere Fenster ist zu — dieses Fenster speichert jetzt wieder selbst.');
      return holdForever();
    })
    .catch(() => {
      // Eigener abort() (Übernahme-Klick) → nichts tun; sonst wurde uns der
      // gerade gewonnene Lock gestohlen → zurück in die Mitleser-Rolle
      if (!ctl.signal.aborted && writerRole === 'writer') demoted();
    });
}

/** Wir haben die Schreibrechte verloren (anderes Fenster hat übernommen). */
function demoted(): void {
  setWriterRole('follower');
  adoptPersistedState();
  useBoard.getState().showToast('👀 Ein anderes Fenster hat die Bearbeitung übernommen — dieses Fenster liest nur noch mit.');
  queueSuccession();
}

/** Schreibrechte JETZT in dieses Fenster holen (bewusste Nutzer-Aktion wie
 *  Import/Zurücksetzen). Wirkt sofort; der Web-Lock-Steal bestätigt asynchron. */
export function claimWriter(): void {
  if (!hasLocks || writerRole === 'writer') return;
  succession?.abort();
  succession = null;
  setWriterRole('writer');
  void navigator.locks
    .request(LOCK_NAME, { steal: true }, () => holdForever())
    .catch(() => demoted());
}

/** „Hier weiterarbeiten"-Banner: letzten Speicherstand übernehmen, dann schreiben. */
export function takeOverWriter(): void {
  if (writerRole === 'writer') return;
  adoptPersistedState();
  claimWriter();
}

function initSingleWriter(): void {
  if (!hasLocks) return; // sehr alte Browser: bisheriges Verhalten (nur Warn-Toast)
  void navigator.locks
    .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        // Ein anderes Fenster schreibt bereits → mitlesen und Nachfolge anmelden
        setWriterRole('follower');
        queueSuccession();
        return;
      }
      return holdForever();
    })
    .catch(() => {
      if (writerRole === 'writer') demoted(); // Lock gestohlen („Hier weiterarbeiten" woanders)
    });
}
if (typeof window !== 'undefined') initSingleWriter();

// Sync-Audit M81: Nach einem Import (Sync-Ordner/WebDAV/Datei/anderes Fenster)
// darf der Auto-Sync denselben Stand nicht gleich wieder MIT NEUEM Zeitstempel
// hochladen — andere Geräte sähen sonst grundlos „fremden Stand" (Konflikt).
let importedRefs: { boards: unknown; spaces: unknown } = { boards: null, spaces: null };
export const isImportedState = (boards: unknown, spaces: unknown): boolean =>
  importedRefs.boards === boards && importedRefs.spaces === spaces;
export const markImported = (boards: unknown, spaces: unknown): void => {
  importedRefs = { boards, spaces };
};

// Abgeleitete Änderungen (z. B. Auto-Einsammeln des Kanbans beim Start):
// verändern zwar die Boards, sind aber jederzeit aus ihnen rekonstruierbar —
// sie dürfen darum NICHT als „eigene lokale Bearbeitung" zählen, sonst
// blockieren sie das automatische Übernehmen eines neueren Sync-Stands.
// zustand-Subscriber laufen synchron innerhalb von set(), daher reicht ein
// einfacher Tiefenzähler um den Aufruf herum.
let derivedDepth = 0;
export function runDerived<T>(fn: () => T): T {
  derivedDepth += 1;
  try { return fn(); } finally { derivedDepth -= 1; }
}
export const inDerived = (): boolean => derivedDepth > 0;

/** Eigenen Stand erneut nach localStorage durchsetzen — der Schreiber wehrt
 *  damit fremde Writes ab (z. B. ein alter Tab mit einer App-Version ohne
 *  Single-Writer-Schutz), statt Daten zu verlieren. */
export function reassertPersist(): void {
  useBoard.setState({}); // no-op-Merge: stößt den persist-Layer neu an
  flushPersist();
}

/** „Board 2", „Board 3" … statt fünfmal „Neues Board" */
function nextName(base: string, existing: string[]): string {
  let n = existing.filter((e) => e.startsWith(base)).length + 1;
  let candidate = n === 1 ? base : `${base} ${n}`;
  while (existing.includes(candidate)) candidate = `${base} ${++n}`;
  return candidate;
}

const defaultHierarchy = (boardIds: string[]): Space[] => [
  {
    id: 'space-work',
    name: '🏢 Arbeit',
    projects: [{ id: 'proj-general', name: 'Allgemein', boardIds }],
  },
];

export const useBoard = create<BoardState>()(
  persist(
    (set, get) => {
      const patchActive = (fn: (b: BoardDoc) => Partial<BoardDoc>) => {
        const active = selectActiveBoard(get());
        if (!active) return;
        set({
          boards: get().boards.map((b) =>
            b.id === active.id ? { ...b, ...fn(b) } : b,
          ),
        });
      };

      /** Board-ID aus allen Projekten entfernen (Hilfsfunktion für move/delete) */
      const stripBoardFromHierarchy = (spaces: Space[], boardId: string): Space[] =>
        spaces.map((sp) => ({
          ...sp,
          projects: sp.projects.map((p) => ({
            ...p,
            boardIds: p.boardIds.filter((id) => id !== boardId),
          })),
        }));

      // Erststart: komplette Starter-Umgebung „Verwaltung" (Bereiche → Projekte
      // → Boards) — erklärt jedes Modul im echten Einsatz. Wird bei vorhandenem
      // persistierten Stand vollständig überschrieben (rehydrate).
      const starter = buildStarter();

      return {
        boards: starter.boards,
        spaces: starter.spaces,
        activeId: starter.firstBoardId,
        view: 'board',
        searchOpen: false,
        settingsOpen: false,
        presenting: false,
        tool: 'select',
        ai: { provider: 'none', model: 'claude-opus-4-8', apiKey: '', baseUrl: '' },
        toast: null,
        pendingFocus: null,
        lastDeleted: null,
        aiBusy: false,
        setAiBusy: (busy) => set({ aiBusy: busy }),

        helpOpen: false,
        helpSection: null,
        setHelpOpen: (open, section = null) => set({ helpOpen: open, helpSection: section }),

        physicsEnabled: true,
        setPhysicsEnabled: (on) => set({ physicsEnabled: on }),

        setArchived: (ids, archived) => {
          if (ids.length === 0) return;
          get().pushHistory();
          const idSet = new Set(ids);
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              // Beim Archivieren auch abwählen — sonst schwebt die
              // Auswahl-Leiste über einer unsichtbaren Karte
              idSet.has(n.id) ? { ...n, archived: archived || undefined, selected: false } : n,
            ),
          }));
          get().showToast(
            archived
              ? `🗃 ${ids.length} Karte${ids.length > 1 ? 'n' : ''} archiviert — über das Archiv-Symbol im Dock wieder einblendbar (Strg+Z macht es rückgängig).`
              : `${ids.length} Karte${ids.length > 1 ? 'n' : ''} aus dem Archiv zurückgeholt.`,
          );
        },

        showArchived: false,
        setShowArchived: (on) => set({ showArchived: on }),

        setBoardBg: (id, bg) =>
          set({ boards: get().boards.map((b) => (b.id === id ? { ...b, bg } : b)) }),

        gridSnap: false,
        setGridSnap: (on) => set({ gridSnap: on }),
        clickZoom: true,
        setClickZoom: (on) => set({ clickZoom: on }),
        wheelZoom: false,
        setWheelZoom: (on) => set({ wheelZoom: on }),
        overviewMode: 'hierarchie',
        setOverviewMode: (m) => set({ overviewMode: m }),
        graphLayers: { cards: false, portals: true, wikis: true, projectOnly: false },
        setGraphLayer: (key, on) => set((s) => ({ graphLayers: { ...s.graphLayers, [key]: on } })),

        ui: { theme: 'system', accent: 'blau' },
        setUiTheme: (theme) => set({ ui: { ...get().ui, theme } }),
        setUiAccent: (accent) => set({ ui: { ...get().ui, accent } }),

        addStarter: () => {
          const fresh = buildStarter();
          set({
            boards: [...get().boards, ...fresh.boards],
            spaces: [...get().spaces, ...fresh.spaces],
            activeId: fresh.firstBoardId,
            view: 'overview',
            // Voll-Remount: neue Boards mit BlockNote-Inhalten sauber mounten
            importEpoch: get().importEpoch + 1,
          });
          get().showToast('🧭 Starter-Umgebung „Verwaltung" hinzugefügt: 3 Bereiche, 14 Boards — viel Spaß beim Erkunden!');
        },

        // M184: Struktur-Import (OneNote). Bewusst EIN set() statt vieler
        // addBoard-Aufrufe: Letztere setzen jedes Mal activeId neu und legen
        // nutzlose History-Einträge an. Das normale Strg+Z deckt Bereiche und
        // Boards ohnehin nicht ab — deshalb hier ein eigener Rücknahme-Stand.
        importStructure: ({ spaces, boards, activeId }) => {
          claimWriter(); // bewusste Nutzer-Aktion, auch aus einem Mitlese-Fenster
          const st = get();
          importUndo = { boards: st.boards, spaces: st.spaces, activeId: st.activeId };
          set({
            boards: [...st.boards, ...boards],
            spaces: [...st.spaces, ...spaces],
            activeId: activeId ?? boards[0]?.id ?? st.activeId,
            view: 'overview',
            canUndoImport: true,
            // Voll-Remount: Notiz-Karten mit Blöcken sauber mounten (BlockNote
            // liest seinen Inhalt NUR beim Mount)
            importEpoch: st.importEpoch + 1,
          });
        },

        undoImport: () => {
          if (!importUndo) return false;
          const snap = importUndo;
          importUndo = null;
          set({
            boards: snap.boards,
            spaces: snap.spaces,
            activeId: snap.activeId,
            canUndoImport: false,
            importEpoch: get().importEpoch + 1,
          });
          return true;
        },

        canUndoImport: false,

        resetAll: () => {
          // Bewusst KEIN Undo: das ist der „frischer Start"-Schalter.
          // KI-Einstellungen bleiben erhalten (nur Inhalte werden geleert).
          claimWriter(); // bewusste Aktion — auch aus einem Mitlese-Fenster wirksam
          const boardId = uid();
          set({
            boards: [{ id: boardId, name: '🏠 Mein Board', nodes: [], edges: [], drawings: [] }],
            spaces: [{ id: uid(), name: '🏢 Arbeit', projects: [{ id: uid(), name: 'Allgemein', boardIds: [boardId] }] }],
            activeId: boardId,
            view: 'board',
            past: [],
            future: [],
            lastDeleted: null,
            pendingFocus: null,
            templates: [],
            importEpoch: get().importEpoch + 1,
          });
          get().showToast('🧹 Alles geleert — frischer Start. Die Starter-Umgebung gibt es jederzeit unter ⚙️ → Daten.');
        },

        settingsSection: null,
        setSettingsOpen: (open, section = null) => set({ settingsOpen: open, settingsSection: section }),
        tasksOpen: false,
        setTasksOpen: (open) => set({ tasksOpen: open }),

        updateNodeDataOnBoard: (boardId, nodeId, data) => {
          // Feingranulare History (M122) — Snapshot des ZIEL-Boards (die
          // Aufgaben-Zentrale bearbeitet auch fremde Boards); undo() kann
          // dank boardId im Eintrag boardübergreifend zurückspringen
          if (!historyMuted && !inDerived()) {
            const key = `b:${boardId}:${nodeId}`;
            const now = Date.now();
            if (key !== lastEditKey || now - lastEditAt > EDIT_COALESCE_MS) {
              const b = get().boards.find((x) => x.id === boardId);
              if (b) {
                set({
                  past: [...get().past.slice(-(HISTORY_LIMIT - 1)), { boardId, nodes: b.nodes, edges: b.edges, drawings: b.drawings }],
                  future: [],
                });
              }
            }
            lastEditKey = key;
            lastEditAt = now;
          }
          set({
            boards: get().boards.map((b) =>
              b.id === boardId
                ? {
                    ...b,
                    nodes: b.nodes.map((n) =>
                      n.id === nodeId ? ({ ...n, data: { ...n.data, ...data } } as AppNode) : n,
                    ),
                  }
                : b,
            ),
          });
        },
        setPresenting: (on) => set({ presenting: on }),
        setTool: (tool) => set({ tool }),
        updateAi: (patch) => set({ ai: { ...get().ai, ...patch } }),

        addStroke: (stroke, sessionIds = []) => {
          get().pushHistory();
          patchActive((b) => ({
            drawings: integrateStroke(stroke, b.drawings ?? [], sessionIds, b.nodes).drawings,
          }));
        },

        beginEraseGesture: () => { eraseSnapPending = true; },

        eraseStrokesNear: (x, y, radius) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board) return;
          // Geankerte Striche liegen relativ zur Karte — für den Treffer-Test
          // ihren Versatz auflösen; unsichtbare (Karte archiviert/weg) schonen
          const byId = new Map(board.nodes.map((n) => [n.id, n]));
          const showArchived = get().showArchived;
          const offsetOf = (s: Stroke): [number, number] | null => {
            if (!s.anchor) return [0, 0];
            const n = byId.get(s.anchor);
            if (!n || (n.archived && !showArchived)) return null;
            return [n.position.x, n.position.y];
          };
          const near = (s: Stroke) => {
            const o = offsetOf(s);
            return !!o && s.points.some((p) => Math.hypot(p[0] + o[0] - x, p[1] + o[1] - y) < radius);
          };
          if (!(board.drawings ?? []).some(near)) return;
          // pro Radier-Geste genau EIN History-Eintrag (beim ersten Treffer)
          if (eraseSnapPending) { get().pushHistory(); eraseSnapPending = false; }
          patchActive((b) => ({ drawings: (b.drawings ?? []).filter((s) => !near(s)) }));
        },

        detachStrokes: (nodeIds) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board) return;
          const idSet = new Set(nodeIds);
          const affected = (board.drawings ?? []).filter((s) => s.anchor && idSet.has(s.anchor));
          if (affected.length === 0) return;
          const byId = new Map(board.nodes.map((n) => [n.id, n]));
          get().pushHistory();
          patchActive((b) => ({
            drawings: (b.drawings ?? []).map((s) => {
              if (!s.anchor || !idSet.has(s.anchor)) return s;
              const n = byId.get(s.anchor);
              return {
                ...s,
                anchor: undefined,
                points: n ? s.points.map(([px, py]) => [px + n.position.x, py + n.position.y] as [number, number]) : s.points,
              };
            }),
          }));
          get().showToast(affected.length === 1
            ? '✍ Markierung von der Karte gelöst — sie bleibt frei auf dem Board.'
            : `✍ ${affected.length} Markierungen von der Karte gelöst — sie bleiben frei auf dem Board.`);
        },

        // ---------- Undo/Redo (Board-Struktur) ----------
        past: [],
        future: [],

        pushHistory: () => {
          if (historyMuted) return; // Sammel-Aktionen (KI-Pläne) sichern EINEN Snapshot selbst
          lastEditKey = ''; // Struktur-Snapshot beendet jede Tipp-Bündelung (M122)
          const s = get();
          const b = s.boards.find((x) => x.id === s.activeId);
          if (!b) return;
          set({
            past: [...s.past.slice(-(HISTORY_LIMIT - 1)), { boardId: b.id, nodes: b.nodes, edges: b.edges, drawings: b.drawings }],
            future: [],
          });
        },

        undo: () => {
          const s = get();
          const entry = s.past[s.past.length - 1];
          if (!entry) return;
          const board = s.boards.find((b) => b.id === entry.boardId);
          if (!board) { set({ past: s.past.slice(0, -1) }); return; }
          // Remount, wenn Notiz-Inhalte betroffen sind — egal woher der Eintrag
          // stammt (Versions-Restore, KI-Edit, Struktur-Undo über Tipp-Grenzen)
          const remount = entry.remount || notesDiffer(board.nodes, entry.nodes);
          // Zwei-Board-Schritt (M163): auch das zweite Board zurückdrehen
          const secondBoard = entry.second ? s.boards.find((b) => b.id === entry.second!.boardId) : undefined;
          set({
            past: s.past.slice(0, -1),
            future: [...s.future, {
              boardId: board.id, nodes: board.nodes, edges: board.edges, drawings: board.drawings, remount,
              second: secondBoard ? { boardId: secondBoard.id, nodes: secondBoard.nodes, edges: secondBoard.edges, drawings: secondBoard.drawings } : undefined,
            }],
            activeId: entry.boardId,
            view: 'board',
            boards: s.boards.map((b) =>
              b.id === entry.boardId ? { ...b, nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings }
                : entry.second && b.id === entry.second.boardId ? { ...b, nodes: entry.second.nodes, edges: entry.second.edges, drawings: entry.second.drawings }
                  : b,
            ),
            ...(remount ? { importEpoch: s.importEpoch + 1 } : {}),
          });
        },

        // ---------- Trilium-Paket: Vorlagen ----------
        templates: [],

        saveTemplate: (node, name) => {
          const clean = JSON.parse(JSON.stringify({ ...node, selected: false })) as AppNode;
          set({ templates: [...get().templates, { id: uid(), name: name.trim().slice(0, 40) || 'Vorlage', node: clean }].slice(-20) });
          get().showToast(`Vorlage „${name}" gespeichert — im ➕-Menü unter „Vorlagen".`);
        },

        removeTemplate: (id) =>
          set({ templates: get().templates.filter((t) => t.id !== id) }),

        importEpoch: 0,

        importSync: (boards, spaces, activeId) => {
          if (!Array.isArray(boards) || boards.length === 0 || !Array.isArray(spaces)) return;
          // Auto-Sync-Bremse: dieser Stand kam von außen — nicht gleich wieder
          // mit neuem Zeitstempel hochladen (falsche Konflikte auf anderen Geräten)
          markImported(boards, spaces);
          set({
            boards,
            spaces,
            activeId: boards.some((b) => b.id === activeId) ? activeId : boards[0].id,
            past: [],
            future: [],
            lastDeleted: null,
            pendingFocus: null,
            // WICHTIG: Remount erzwingen — sonst zeigen Notiz-Editoren (BlockNote,
            // liest Inhalt nur beim Mount) nach dem Laden den ALTEN Text und
            // würden ihn beim nächsten Tastendruck sogar zurückschreiben
            importEpoch: get().importEpoch + 1,
          });
        },

        importProject: (proj, boards) => {
          if (!proj?.id || !proj.name || !Array.isArray(boards) || boards.length === 0) return;
          const s = get();
          // Bestehendes Projekt (egal in welchem Bereich) ersetzen …
          let oldIds: string[] = [];
          let found = false;
          let spaces = s.spaces.map((sp) => ({
            ...sp,
            projects: sp.projects.map((p) => {
              if (p.id !== proj.id) return p;
              found = true;
              oldIds = p.boardIds;
              return { ...p, name: proj.name, boardIds: boards.map((b) => b.id) };
            }),
          }));
          // … oder als neues Projekt einhängen (erster Bereich; notfalls „Team" anlegen)
          if (!found) {
            const entry: Project = { id: proj.id, name: proj.name, boardIds: boards.map((b) => b.id) };
            spaces = spaces.length === 0
              ? [{ id: uid(), name: 'Team', projects: [entry] }]
              : spaces.map((sp, i) => (i === 0 ? { ...sp, projects: [...sp.projects, entry] } : sp));
          }
          // Boards des Projekts komplett durch das Paket ersetzen — Boards, die das
          // Team entfernt hat, verschwinden auch lokal; alle fremden Boards bleiben
          const incoming = new Set(boards.map((b) => b.id));
          const kept = s.boards.filter((b) => !incoming.has(b.id) && !oldIds.includes(b.id));
          const nextBoards = [...kept, ...boards];
          markImported(nextBoards, spaces);
          set({
            boards: nextBoards,
            spaces,
            activeId: nextBoards.some((b) => b.id === s.activeId) ? s.activeId : nextBoards[0].id,
            past: [],
            future: [],
            lastDeleted: null,
            pendingFocus: null,
            importEpoch: s.importEpoch + 1,
          });
        },

        redo: () => {
          const s = get();
          const entry = s.future[s.future.length - 1];
          if (!entry) return;
          const board = s.boards.find((b) => b.id === entry.boardId);
          if (!board) { set({ future: s.future.slice(0, -1) }); return; }
          const remount = entry.remount || notesDiffer(board.nodes, entry.nodes);
          const secondBoard = entry.second ? s.boards.find((b) => b.id === entry.second!.boardId) : undefined;
          set({
            future: s.future.slice(0, -1),
            past: [...s.past, {
              boardId: board.id, nodes: board.nodes, edges: board.edges, drawings: board.drawings, remount,
              second: secondBoard ? { boardId: secondBoard.id, nodes: secondBoard.nodes, edges: secondBoard.edges, drawings: secondBoard.drawings } : undefined,
            }],
            activeId: entry.boardId,
            view: 'board',
            boards: s.boards.map((b) =>
              b.id === entry.boardId ? { ...b, nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings }
                : entry.second && b.id === entry.second.boardId ? { ...b, nodes: entry.second.nodes, edges: entry.second.edges, drawings: entry.second.drawings }
                  : b,
            ),
            ...(remount ? { importEpoch: s.importEpoch + 1 } : {}),
          });
        },

        setView: (view) => set({ view }),

        openBoard: (id) => {
          if (get().boards.some((b) => b.id === id)) set({ activeId: id, view: 'board' });
        },

        setSearchOpen: (open) => set({ searchOpen: open }),

        addSpace: (name) =>
          set({
            spaces: [
              ...get().spaces,
              { id: uid(), name: name ?? nextName('Neuer Bereich', get().spaces.map((s) => s.name)), projects: [] },
            ],
          }),

        renameSpace: (id, name) =>
          set({ spaces: get().spaces.map((sp) => (sp.id === id ? { ...sp, name } : sp)) }),

        removeSpace: (id) => {
          const space = get().spaces.find((sp) => sp.id === id);
          if (!space) return;
          if (space.projects.some((p) => p.boardIds.length > 0)) {
            get().showToast('Bereich enthält noch Boards — erst verschieben oder löschen.');
            return;
          }
          if (get().spaces.length <= 1) {
            get().showToast('Der letzte Bereich bleibt bestehen 🙂');
            return;
          }
          set({ spaces: get().spaces.filter((sp) => sp.id !== id) });
        },

        addProject: (spaceId, name) =>
          set({
            spaces: get().spaces.map((sp) =>
              sp.id === spaceId
                ? {
                    ...sp,
                    projects: [
                      ...sp.projects,
                      { id: uid(), name: name ?? nextName('📁 Projekt', sp.projects.map((p) => p.name)), boardIds: [] },
                    ],
                  }
                : sp,
            ),
          }),

        renameProject: (id, name) =>
          set({
            spaces: get().spaces.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) => (p.id === id ? { ...p, name } : p)),
            })),
          }),

        removeProject: (id) => {
          const project = get().spaces.flatMap((sp) => sp.projects).find((p) => p.id === id);
          if (!project) return;
          if (project.boardIds.length > 0) {
            get().showToast('Projekt enthält noch Boards — erst verschieben oder löschen.');
            return;
          }
          set({
            spaces: get().spaces.map((sp) => ({
              ...sp,
              projects: sp.projects.filter((p) => p.id !== id),
            })),
          });
        },

        addBoard: (name, projectId) => {
          const id = uid();
          const spaces = get().spaces;
          // Ziel: angegebenes Projekt, sonst das erste existierende (notfalls anlegen)
          let target = projectId && spaces.some((sp) => sp.projects.some((p) => p.id === projectId))
            ? projectId
            : undefined;
          let newSpaces = spaces;
          if (!target) {
            const first = spaces.flatMap((sp) => sp.projects)[0];
            if (first) {
              target = first.id;
            } else {
              const pid = uid();
              newSpaces = spaces.length
                ? spaces.map((sp, i) =>
                    i === 0
                      ? { ...sp, projects: [{ id: pid, name: 'Allgemein', boardIds: [] }] }
                      : sp,
                  )
                : defaultHierarchy([]);
              target = newSpaces[0].projects[0]?.id ?? pid;
            }
          }
          set({
            boards: [...get().boards, { id, name: name ?? nextName('✨ Board', get().boards.map((b) => b.name)), nodes: [], edges: [] }],
            spaces: newSpaces.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) =>
                p.id === target ? { ...p, boardIds: [...p.boardIds, id] } : p,
              ),
            })),
            activeId: id,
          });
          return id;
        },

        importBoard: (doc) => {
          // leeres Board über addBoard anlegen (kümmert sich um die Hierarchie) …
          const id = get().addBoard(doc.name);
          // … und mit dem geteilten Inhalt füllen
          set({
            boards: get().boards.map((b) =>
              b.id === id ? { ...b, nodes: doc.nodes, edges: doc.edges, drawings: doc.drawings } : b,
            ),
            view: 'board',
          });
        },

        renameBoard: (id, name) =>
          set({ boards: get().boards.map((b) => (b.id === id ? { ...b, name } : b)) }),

        removeBoard: (id) => {
          const boards = get().boards;
          if (boards.length <= 1) {
            get().showToast('Das letzte Board bleibt offen 🙂');
            return;
          }
          const rest = boards.filter((b) => b.id !== id);
          set({
            boards: rest,
            spaces: stripBoardFromHierarchy(get().spaces, id),
            activeId: get().activeId === id ? rest[0].id : get().activeId,
          });
        },

        moveBoard: (boardId, targetProjectId, beforeBoardId) => {
          // Geister-Boards verhindern: Ziel muss existieren, sonst no-op
          const targetExists = get().spaces.some((sp) => sp.projects.some((p) => p.id === targetProjectId));
          if (!targetExists) return;
          const stripped = stripBoardFromHierarchy(get().spaces, boardId);
          set({
            spaces: stripped.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) => {
                if (p.id !== targetProjectId) return p;
                const ids = [...p.boardIds];
                const at = beforeBoardId ? ids.indexOf(beforeBoardId) : -1;
                if (at >= 0) ids.splice(at, 0, boardId);
                else ids.push(boardId);
                return { ...p, boardIds: ids };
              }),
            })),
          });
        },

        onNodesChange: (changes) => {
          // Entfernen-Änderungen (Entf-Taste) durch die Undo-Logik schleusen
          const removeIds = changes
            .filter((c): c is Extract<NodeChange, { type: 'remove' }> => c.type === 'remove')
            .map((c) => c.id);
          const rest = changes.filter((c) => c.type !== 'remove');
          if (rest.length) {
            // Maß-/Auswahl-Änderungen schreibt React Flow schon beim Mount in
            // den Store — das ist Mechanik, keine Bearbeitung, und darf das
            // automatische Übernehmen eines Sync-Stands nicht blockieren
            const mechanical = rest.every((c) => c.type === 'dimensions' || c.type === 'select');
            const apply = () => patchActive((b) => ({ nodes: applyNodeChanges(rest, b.nodes) as AppNode[] }));
            if (mechanical) runDerived(apply); else apply();
          }
          if (removeIds.length) get().removeNodes(removeIds);
        },

        onEdgesChange: (changes) => {
          // Kantenlöschung (Entf-Taste) muss undo-fähig sein — wie bei Nodes (Audit R6-S2)
          if (changes.some((c) => c.type === 'remove')) get().pushHistory();
          patchActive((b) => ({ edges: applyEdgeChanges(changes, b.edges) }));
        },

        onConnect: (connection) => {
          get().pushHistory();
          patchActive((b) => ({
            edges: addEdge({ ...connection, type: 'labeled', data: { label: '', kind: 'arrow' } }, b.edges),
          }));
          // M169: Verbindungen sind Daten-Abos — beim Andocken an ein
          // Sammel-Modul einmal kurz erklären, was jetzt automatisch passiert
          const b = get().boards.find((x) => x.id === get().activeId);
          const t1 = b?.nodes.find((n) => n.id === connection.source)?.type;
          const t2 = b?.nodes.find((n) => n.id === connection.target)?.type;
          const src = new Set(['note', 'kanban', 'gantt']);
          const pair = (consumer: string, sources: Set<string> | string = src) =>
            (t1 === consumer && (typeof sources === 'string' ? t2 === sources : sources.has(t2 ?? '')))
            || (t2 === consumer && (typeof sources === 'string' ? t1 === sources : sources.has(t1 ?? '')));
          if ((t1 === 'kanban' && t2 === 'gantt') || (t1 === 'gantt' && t2 === 'kanban')) {
            get().showToast('🔗 Abo in beide Richtungen: Tickets mit Frist erscheinen als Meilensteine im Zeitplan, Zeitplan-Vorgänge als Tickets im Kanban.');
          } else if (pair('kanban')) {
            get().showToast('🔗 Aufgaben-Abo aktiv: Offene Punkte der verbundenen Karte landen automatisch in diesem Kanban — abwählbar im Einsammeln-Panel (⚙) oder durch Löschen des Pfeils. Erledigte Tickets haken die Quelle zurück ab.');
          } else if (pair('calendar')) {
            get().showToast('🔗 Kalender-Fokus aktiv: Der Kalender zeigt jetzt Termine & Fristen der verbundenen Karten — der Bereich-Schalter in der Kopfzeile stellt jederzeit um.');
          } else if (pair('time', 'week')) {
            get().showToast('🔗 Soll/Ist aktiv: Der verbundene Wochenplan liefert die Sollzeit — die Zeiterfassung zeigt in Tag- und Wochenansicht die Differenz.');
          } else if (pair('time', 'note') || pair('time', 'kanban')) {
            get().showToast('🔗 ⏱-Chip aktiv: Die verbundene Karte zeigt jetzt Arbeitszeit von heute und dieser Woche aus der Zeiterfassung.');
          } else if (pair('mermaid', 'note')) {
            get().showToast('🔗 Diagramm-Abo: Ein leeres bzw. Vorlagen-Diagramm folgt jetzt automatisch der Checkliste der verbundenen Notiz (Erledigtes grün) — bei eigenem Inhalt schaltet der „⇢ Abo"-Chip im Diagramm das Abo bewusst zu.');
          } else if (pair('note', 'htmlapp')) {
            get().showToast('🔗 App-Auszug aktiv: Die verbundene Notiz zeigt den Speicherstand der App als lesbaren Auszug — live bei jedem Speichern.');
          }
        },

        addLabeledEdge: (source, target, label, kind = 'arrow') => {
          get().pushHistory();
          patchActive((b) => ({
            edges: addEdge(
              { id: `e-${uid()}`, source, target, type: 'labeled', data: { label, kind } },
              b.edges,
            ),
          }));
        },

        // ---------- Kommentar-Pins (M148) ----------
        commentOpen: null,
        setCommentOpen: (id) => set({ commentOpen: id }),
        lookup: null,
        setLookup: (q) => set({ lookup: q }),

        addCommentMsg: (target, author, text) => {
          const msg = { author: author.trim().slice(0, 40) || 'Anonym', text: text.trim(), at: new Date().toISOString() };
          if (!msg.text) return null;
          let threadId: string | null = null;
          patchActive((b) => {
            const comments = [...(b.comments ?? [])];
            if (target.threadId) {
              const i = comments.findIndex((c) => c.id === target.threadId);
              if (i < 0) return {};
              threadId = target.threadId;
              comments[i] = { ...comments[i], resolved: false, msgs: [...comments[i].msgs, msg] };
            } else if (target.nodeId) {
              threadId = uid();
              comments.push({ id: threadId, nodeId: target.nodeId, msgs: [msg] });
            }
            return { comments };
          });
          return threadId;
        },

        toggleCommentResolved: (threadId) =>
          patchActive((b) => ({
            comments: (b.comments ?? []).map((c) => (c.id === threadId ? { ...c, resolved: !c.resolved } : c)),
          })),

        removeCommentThread: (threadId) => {
          patchActive((b) => ({ comments: (b.comments ?? []).filter((c) => c.id !== threadId) }));
          set({ commentOpen: null });
        },

        updateEdgeLabel: (id, label) =>
          patchActive((b) => ({
            edges: b.edges.map((e) =>
              e.id === id ? { ...e, data: { ...e.data, label } } : e,
            ),
          })),

        updateEdgeKind: (id, kind) =>
          patchActive((b) => ({
            edges: b.edges.map((e) =>
              e.id === id ? { ...e, data: { ...e.data, kind } } : e,
            ),
          })),

        updateEdgeStyle: (id, patch) =>
          patchActive((b) => ({
            edges: b.edges.map((e) => {
              if (e.id !== id) return e;
              const data: Record<string, unknown> = { ...e.data };
              if (patch.head !== undefined) data.head = patch.head;
              if (patch.headStart !== undefined) data.headStart = patch.headStart;
              if (patch.shape !== undefined) data.shape = patch.shape;
              if (patch.width !== undefined) data.width = patch.width;
              if (patch.color !== undefined) {
                // null = zurück zur Standardfarbe (Schlüssel ganz entfernen)
                if (patch.color === null) delete data.color;
                else data.color = patch.color;
              }
              return { ...e, data };
            }),
          })),

        removeEdge: (id) => {
          get().pushHistory();
          patchActive((b) => ({ edges: b.edges.filter((e) => e.id !== id) }));
        },

        addNode: (node) => {
          get().pushHistory();
          patchActive((b) => ({ nodes: [...b.nodes, node] }));
        },

        addNodeToBoard: (boardId, node) => {
          get().pushHistory();
          set({
            boards: get().boards.map((b) =>
              b.id === boardId ? { ...b, nodes: [...b.nodes, node] } : b),
          });
        },

        removeNode: (id) => get().removeNodes([id]),

        removeNodes: (ids) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board) return;
          const idSet = new Set(ids);
          const removedNodes = board.nodes.filter((n) => idSet.has(n.id));
          const removedEdges = board.edges.filter((e) => idSet.has(e.source) || idSet.has(e.target));
          if (removedNodes.length === 0) return;
          // Geankerte Markierungen gehören zur Karte — sie gehen (undo-fähig) mit
          const removedDrawings = (board.drawings ?? []).filter((s) => s.anchor && idSet.has(s.anchor));
          get().pushHistory();
          patchActive((b) => ({
            nodes: b.nodes.filter((n) => !idSet.has(n.id)),
            edges: b.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
            drawings: (b.drawings ?? []).filter((s) => !s.anchor || !idSet.has(s.anchor)),
            // Kommentar-Pins hängen an der Karte — mit ihr verschwinden sie (M148)
            comments: (b.comments ?? []).filter((c) => !idSet.has(c.nodeId)),
          }));
          set({ lastDeleted: { boardId: board.id, nodes: removedNodes, edges: removedEdges, drawings: removedDrawings } });
          get().showToast(
            removedNodes.length === 1 ? 'Karte gelöscht' : `${removedNodes.length} Karten gelöscht`,
            true,
          );
        },

        moveNodesToBoard: (ids, targetBoardId) => {
          const s = get();
          const src = s.boards.find((b) => b.id === s.activeId);
          const tgt = s.boards.find((b) => b.id === targetBoardId);
          if (!src || !tgt || src.id === tgt.id) return;
          const idSet = new Set(ids);
          // Rahmen nehmen ihre Mitglieder mit (dieselbe Regel wie beim Ziehen)
          for (const n of src.nodes) {
            if (n.type === 'frame' && idSet.has(n.id)) {
              for (const m of frameMembers(n, src.nodes, true)) idSet.add(m.id);
            }
          }
          const moving = src.nodes.filter((n) => idSet.has(n.id));
          if (moving.length === 0) return;

          // EIN Undo-Schritt für BEIDE Boards (HistoryEntry.second)
          lastEditKey = '';
          set({
            past: [...s.past.slice(-(HISTORY_LIMIT - 1)), {
              boardId: src.id, nodes: src.nodes, edges: src.edges, drawings: src.drawings,
              second: { boardId: tgt.id, nodes: tgt.nodes, edges: tgt.edges, drawings: tgt.drawings },
            }],
            future: [],
          });

          // Freie Stelle im Ziel suchen — die RELATIVE Anordnung der Gruppe bleibt
          const minX = Math.min(...moving.map((n) => n.position.x));
          const minY = Math.min(...moving.map((n) => n.position.y));
          const maxX = Math.max(...moving.map((n) => n.position.x + (n.width ?? n.measured?.width ?? 260)));
          const maxY = Math.max(...moving.map((n) => n.position.y + (n.height ?? n.measured?.height ?? 160)));
          const spot = findFreeSpot(tgt.nodes, { x: minX, y: minY }, { w: maxX - minX, h: maxY - minY });
          const dx = spot.x - minX;
          const dy = spot.y - minY;

          const movedNodes = moving.map((n) => ({
            ...n,
            selected: false,
            position: { x: n.position.x + dx, y: n.position.y + dy },
          }) as AppNode);
          // Nur Verbindungen, deren BEIDE Enden mitwandern — Misch-Kanten entfallen
          const movedEdges = src.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
          // Geankerte Striche sind RELATIV zur Karte (M127) — wandern unverändert mit
          const movedDrawings = (src.drawings ?? []).filter((d) => d.anchor && idSet.has(d.anchor));
          const movedComments = (src.comments ?? []).filter((c) => idSet.has(c.nodeId));

          set({
            boards: get().boards.map((b) => {
              if (b.id === src.id) {
                return {
                  ...b,
                  nodes: b.nodes.filter((n) => !idSet.has(n.id)),
                  edges: b.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
                  drawings: (b.drawings ?? []).filter((d) => !d.anchor || !idSet.has(d.anchor)),
                  comments: (b.comments ?? []).filter((c) => !idSet.has(c.nodeId)),
                };
              }
              if (b.id === tgt.id) {
                return {
                  ...b,
                  nodes: [...b.nodes, ...movedNodes],
                  edges: [...b.edges, ...movedEdges],
                  drawings: [...(b.drawings ?? []), ...movedDrawings],
                  comments: [...(b.comments ?? []), ...movedComments],
                };
              }
              return b;
            }),
          });
          get().showToast(
            `${moving.length === 1 ? 'Karte' : `${moving.length} Karten`} nach „${tgt.name}" verschoben — Strg+Z holt alles zurück.`,
            true,
          );
        },

        touchNode: (id) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          const node = board?.nodes.find((n) => n.id === id);
          if (!board || !node) return;
          if (node.type === 'frame') return; // Rahmen bleiben IMMER Hintergrund (M149)
          // zIndex statt Array-Umsortierung: das DOM-Element bleibt an Ort und
          // Stelle, sonst verlöre der Notiz-Editor beim Anklicken den Fokus.
          // Kein pushHistory — das Anfassen ist eine implizite Geste, kein Edit.
          const maxZ = Math.max(0, ...board.nodes.map((n) => n.zIndex ?? 0));
          const alreadyTop = (node.zIndex ?? 0) === maxZ
            && board.nodes.filter((n) => (n.zIndex ?? 0) === maxZ).length === 1;
          if (alreadyTop) return;
          patchActive((b) => ({
            nodes: b.nodes.map((n) => (n.id === id ? ({ ...n, zIndex: maxZ + 1 }) as AppNode : n)),
          }));
        },

        restoreDeleted: () => {
          const snap = get().lastDeleted;
          if (!snap) return;
          if (!get().boards.some((b) => b.id === snap.boardId)) {
            set({ lastDeleted: null });
            get().showToast('Das Board dieser Karten existiert nicht mehr.');
            return;
          }
          get().pushHistory();
          set({
            boards: get().boards.map((b) =>
              b.id === snap.boardId
                ? {
                    ...b,
                    nodes: [...b.nodes, ...snap.nodes.map((n) => ({ ...n, selected: false }) as AppNode)],
                    edges: [...b.edges, ...snap.edges],
                    drawings: snap.drawings?.length ? [...(b.drawings ?? []), ...snap.drawings] : b.drawings,
                  }
                : b,
            ),
            lastDeleted: null,
          });
          get().showToast('Wiederhergestellt ✓');
        },

        resizeNode: (id, width, height) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? ({ ...n, width, height } as AppNode) : n,
            ),
          })),

        setNodeHeight: (id, height) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? ({ ...n, height } as AppNode) : n,
            ),
          })),

        setAutoFit: (ids, on) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              ids.includes(n.id) ? ({ ...n, autoFit: on ? undefined : false } as AppNode) : n,
            ),
          })),

        updateNodeData: (id, data) => {
          // Feingranulare History (M122): gebündelter Snapshot vor der Änderung —
          // Automatik (runDerived) und Sammel-Aktionen (mutedHistory) ausgenommen
          if (!historyMuted && !inDerived()) {
            const key = `n:${get().activeId}:${id}`;
            const now = Date.now();
            if (key !== lastEditKey || now - lastEditAt > EDIT_COALESCE_MS) get().pushHistory();
            lastEditKey = key;
            lastEditAt = now;
          }
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? ({ ...n, data: { ...n.data, ...data } } as AppNode) : n,
            ),
          }));
        },

        setNodePosition: (id, x, y) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? ({ ...n, position: { x, y } } as AppNode) : n,
            ),
          })),

        setNodePositions: (entries) =>
          patchActive((b) => {
            const map = new Map(entries.map(([id, x, y]) => [id, { x, y }]));
            return {
              nodes: b.nodes.map((n) => {
                const p = map.get(n.id);
                return p ? ({ ...n, position: p } as AppNode) : n;
              }),
            };
          }),

        focusNode: (boardId, nodeId) => {
          set({ pendingFocus: { boardId, nodeId }, activeId: boardId, view: 'board' });
        },

        clearPendingFocus: () => set({ pendingFocus: null }),

        showToast: (message, undo, durationMs) => {
          if (toastTimer) clearTimeout(toastTimer);
          set({ toast: { message, undo } });
          toastTimer = setTimeout(() => set({ toast: null }), durationMs ?? (undo ? 6000 : 3000));
        },
      };
    },
    {
      name: 'pixinotes-board',
      version: 5,
      storage: createJSONStorage(() => debouncedSafeStorage),
      partialize: (s) => ({
        boards: s.boards,
        spaces: s.spaces,
        activeId: s.activeId,
        view: s.view,
        ai: s.ai,
        templates: s.templates,
        ui: s.ui,
        physicsEnabled: s.physicsEnabled,
        clickZoom: s.clickZoom,
        wheelZoom: s.wheelZoom,
        showArchived: s.showArchived,
        gridSnap: s.gridSnap,
        overviewMode: s.overviewMode,
        graphLayers: s.graphLayers,
      }),
      migrate: (persisted: unknown, version: number) => {
        const p = persisted as Record<string, unknown>;
        // v3 (M127): bestehende freie Striche EINMALIG nach derselben Regel wie
        // beim Zeichnen ankern (größte Schnittmenge ≥ 50 % der Strich-Fläche)
        const anchorLegacyStrokes = <T,>(out: T): T => {
          if (version >= 3 || !out || !Array.isArray((out as Record<string, unknown>).boards)) return out;
          const boards = (out as unknown as { boards: BoardDoc[] }).boards.map((b) =>
            b.drawings?.length ? { ...b, drawings: b.drawings.map((s) => anchorStroke(s, b.nodes ?? [])) } : b);
          return { ...out, boards };
        };
        // v4 (M160): App-Karten hatten ein dragHandle auf die Kopfzeile — die
        // war aber fast komplett vom Titel-Eingabefeld (nodrag) bedeckt und
        // der Universal-Griff lag AUSSERHALB des Handles: die Karte war
        // praktisch unverschiebbar. Jetzt ziehen sie wie alle Karten (die
        // App-Fläche schluckt ihre Eingaben ohnehin selbst) — gespeicherte
        // dragHandle-Einträge werden hier einmalig entfernt.
        const stripHappHandle = <T,>(out: T): T => {
          if (!out || !Array.isArray((out as Record<string, unknown>).boards)) return out;
          const boards = (out as unknown as { boards: BoardDoc[] }).boards.map((b) => ({
            ...b,
            nodes: (b.nodes ?? []).map((n) =>
              n.type === 'htmlapp' && n.dragHandle ? { ...n, dragHandle: undefined } : n),
          }));
          return { ...out, boards };
        };
        // v5 (M171): Zeiterfassung nur noch Arbeit & Pause — alte Fahrzeit-/
        // Dienstgeschäft-Abschnitte werden zu Arbeit (sie zählten ohnehin als
        // Arbeitszeit, die Summen bleiben also identisch); die frühere Art
        // wandert als Vermerk in die Bemerkung, damit nichts verloren geht.
        const mergeTimeKinds = <T,>(out: T): T => {
          if (!out || !Array.isArray((out as Record<string, unknown>).boards)) return out;
          const LABEL: Record<string, string> = { fahrt: 'Fahrzeit', dienst: 'Dienstgeschäft' };
          const boards = (out as unknown as { boards: BoardDoc[] }).boards.map((b) => ({
            ...b,
            nodes: (b.nodes ?? []).map((n) => {
              if (n.type !== 'time') return n;
              const segs = (n.data as { segs?: TimeSeg[] }).segs ?? [];
              if (!segs.some((s) => LABEL[s.kind as string])) return n;
              return {
                ...n,
                data: {
                  ...n.data,
                  segs: segs.map((s) => (LABEL[s.kind as string]
                    ? { ...s, kind: 'arbeit' as const, note: s.note ? `${LABEL[s.kind as string]} · ${s.note}` : LABEL[s.kind as string] }
                    : s)),
                },
              } as typeof n;
            }),
          }));
          return { ...out, boards };
        };
        // v0: {nodes, edges} — Einzelboard
        if (version === 0 && p && 'nodes' in p) {
          const boards = [
            { id: 'main', name: '🏠 Mein Schreibtisch', nodes: p.nodes as Node[], edges: p.edges as Edge[] },
          ];
          return anchorLegacyStrokes({ boards, spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' });
        }
        // v1: {boards, activeId} — flache Boards ohne Hierarchie
        if (version === 1 && p && 'boards' in p) {
          const boards = (p.boards as BoardDoc[]) ?? [];
          if (boards.length === 0) {
            return { boards: [{ id: 'main', name: '🏠 Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
          }
          return anchorLegacyStrokes({
            boards,
            spaces: defaultHierarchy(boards.map((b) => b.id)),
            activeId: (p.activeId as string) ?? boards[0]?.id,
            view: 'board',
          });
        }
        // v2: defensiv validieren (leeres boards-Array oder tote activeId reparieren)
        if (p && 'boards' in p) {
          const boards = (p.boards as BoardDoc[]) ?? [];
          if (boards.length === 0) {
            return { boards: [{ id: 'main', name: '🏠 Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
          }
          if (!boards.some((b) => b.id === (p.activeId as string))) {
            return mergeTimeKinds(stripHappHandle(anchorLegacyStrokes({ ...p, activeId: boards[0].id })));
          }
        }
        return mergeTimeKinds(stripHappHandle(anchorLegacyStrokes(p)));
      },
    },
  ),
);
