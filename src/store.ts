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
import { uid, type AppNode } from './types';

/** Ein Freihand-Strich (Punkte in Flow-Koordinaten) */
export interface Stroke {
  id: string;
  tool: 'pen' | 'marker';
  color: string;
  width: number;
  points: [number, number][];
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
}

const HISTORY_LIMIT = 50;

/** Gesicherter Board-Stand (Trilium-Revisionen light — manuell, max. 3 pro Board) */
export interface BoardVersion {
  ts: string;
  nodes: AppNode[];
  edges: Edge[];
  drawings?: Stroke[];
}
const VERSION_LIMIT = 3;

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
  addStroke: (stroke: Stroke) => void;
  eraseStrokesNear: (x: number, y: number, radius: number) => void;
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

  // Trilium-Paket: Board-Verlauf (Revisionen) + Karten-Vorlagen
  versions: Record<string, BoardVersion[]>;
  saveVersion: (boardId: string) => void;
  restoreVersion: (boardId: string, ts: string) => void;
  deleteVersion: (boardId: string, ts: string) => void;
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
  updateEdgeLabel: (id: string, label: string) => void;
  updateEdgeKind: (id: string, kind: string) => void;
  removeEdge: (id: string) => void;
  addNode: (node: AppNode) => void;
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;
  restoreDeleted: () => void;
  /** Zuletzt angefasste Karte dauerhaft nach vorn (persistierter zIndex, ohne Undo-Eintrag) */
  touchNode: (id: string) => void;
  /** Klick-Zoom: beim Anklicken sanft zur Karte fliegen (wenn klein/außerhalb) */
  clickZoom: boolean;
  setClickZoom: (on: boolean) => void;
  /** Mausrad zoomt statt zu scrollen (Miro-Stil) */
  wheelZoom: boolean;
  setWheelZoom: (on: boolean) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  /** Kartengröße setzen (Auto-Größe der Diagramm-Karte, M92c) */
  resizeNode: (id: string, width: number, height: number) => void;
  /** Nur die Höhe setzen — für die Auto-Größe aller Karten (M103) */
  setNodeHeight: (id: string, height: number) => void;
  /** Auto-Größe je Karte an/aus (M103) */
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
export function mutedHistory<T>(fn: () => T): T {
  historyMuted = true;
  try {
    return fn();
  } finally {
    historyMuted = false;
  }
}

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
            versions: {},
            templates: [],
            importEpoch: get().importEpoch + 1,
          });
          get().showToast('🧹 Alles geleert — frischer Start. Die Starter-Umgebung gibt es jederzeit unter ⚙️ → Daten.');
        },

        settingsSection: null,
        setSettingsOpen: (open, section = null) => set({ settingsOpen: open, settingsSection: section }),
        tasksOpen: false,
        setTasksOpen: (open) => set({ tasksOpen: open }),

        updateNodeDataOnBoard: (boardId, nodeId, data) =>
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
          }),
        setPresenting: (on) => set({ presenting: on }),
        setTool: (tool) => set({ tool }),
        updateAi: (patch) => set({ ai: { ...get().ai, ...patch } }),

        addStroke: (stroke) => {
          get().pushHistory();
          patchActive((b) => ({ drawings: [...(b.drawings ?? []), stroke] }));
        },

        beginEraseGesture: () => { eraseSnapPending = true; },

        eraseStrokesNear: (x, y, radius) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          const hit = (board?.drawings ?? []).some(
            (s) => s.points.some((p) => Math.hypot(p[0] - x, p[1] - y) < radius),
          );
          if (!hit) return;
          // pro Radier-Geste genau EIN History-Eintrag (beim ersten Treffer)
          if (eraseSnapPending) { get().pushHistory(); eraseSnapPending = false; }
          patchActive((b) => ({
            drawings: (b.drawings ?? []).filter(
              (s) => !s.points.some((p) => Math.hypot(p[0] - x, p[1] - y) < radius),
            ),
          }));
        },

        // ---------- Undo/Redo (Board-Struktur) ----------
        past: [],
        future: [],

        pushHistory: () => {
          if (historyMuted) return; // Sammel-Aktionen (KI-Pläne) sichern EINEN Snapshot selbst
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
          set({
            past: s.past.slice(0, -1),
            future: [...s.future, { boardId: board.id, nodes: board.nodes, edges: board.edges, drawings: board.drawings, remount }],
            activeId: entry.boardId,
            view: 'board',
            boards: s.boards.map((b) =>
              b.id === entry.boardId ? { ...b, nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings } : b,
            ),
            ...(remount ? { importEpoch: s.importEpoch + 1 } : {}),
          });
        },

        // ---------- Trilium-Paket: Verlauf & Vorlagen ----------
        versions: {},

        saveVersion: (boardId) => {
          const board = get().boards.find((b) => b.id === boardId);
          if (!board) return;
          const cur = get().versions[boardId] ?? [];
          set({
            versions: {
              ...get().versions,
              [boardId]: [
                { ts: new Date().toISOString(), nodes: board.nodes, edges: board.edges, drawings: board.drawings },
                ...cur,
              ].slice(0, VERSION_LIMIT),
            },
          });
          get().showToast(`Version gesichert (${Math.min(cur.length + 1, VERSION_LIMIT)}/${VERSION_LIMIT}) — Wiederherstellen über den Verlauf.`);
        },

        restoreVersion: (boardId, ts) => {
          const v = (get().versions[boardId] ?? []).find((x) => x.ts === ts);
          if (!v) return;
          get().pushHistory();
          set({
            boards: get().boards.map((b) =>
              b.id === boardId ? { ...b, nodes: v.nodes, edges: v.edges, drawings: v.drawings } : b,
            ),
            // Editor-Remount erzwingen (BlockNote liest nur beim Mount)
            importEpoch: get().importEpoch + 1,
          });
          get().showToast('Version wiederhergestellt — Strg+Z bringt den vorherigen Stand zurück.');
        },

        deleteVersion: (boardId, ts) =>
          set({
            versions: {
              ...get().versions,
              [boardId]: (get().versions[boardId] ?? []).filter((v) => v.ts !== ts),
            },
          }),

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

        redo: () => {
          const s = get();
          const entry = s.future[s.future.length - 1];
          if (!entry) return;
          const board = s.boards.find((b) => b.id === entry.boardId);
          if (!board) { set({ future: s.future.slice(0, -1) }); return; }
          const remount = entry.remount || notesDiffer(board.nodes, entry.nodes);
          set({
            future: s.future.slice(0, -1),
            past: [...s.past, { boardId: board.id, nodes: board.nodes, edges: board.edges, drawings: board.drawings, remount }],
            activeId: entry.boardId,
            view: 'board',
            boards: s.boards.map((b) =>
              b.id === entry.boardId ? { ...b, nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings } : b,
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
          // Verwaiste Versionen mit entsorgen — sonst wächst der persistierte
          // State unbegrenzt (localStorage-Quota, Audit R6-S8)
          const versions = { ...get().versions };
          delete versions[id];
          set({
            boards: rest,
            spaces: stripBoardFromHierarchy(get().spaces, id),
            activeId: get().activeId === id ? rest[0].id : get().activeId,
            versions,
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

        removeEdge: (id) => {
          get().pushHistory();
          patchActive((b) => ({ edges: b.edges.filter((e) => e.id !== id) }));
        },

        addNode: (node) => {
          get().pushHistory();
          patchActive((b) => ({ nodes: [...b.nodes, node] }));
        },

        removeNode: (id) => get().removeNodes([id]),

        removeNodes: (ids) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board) return;
          const idSet = new Set(ids);
          const removedNodes = board.nodes.filter((n) => idSet.has(n.id));
          const removedEdges = board.edges.filter((e) => idSet.has(e.source) || idSet.has(e.target));
          if (removedNodes.length === 0) return;
          get().pushHistory();
          patchActive((b) => ({
            nodes: b.nodes.filter((n) => !idSet.has(n.id)),
            edges: b.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
          }));
          set({ lastDeleted: { boardId: board.id, nodes: removedNodes, edges: removedEdges } });
          get().showToast(
            removedNodes.length === 1 ? 'Karte gelöscht' : `${removedNodes.length} Karten gelöscht`,
            true,
          );
        },

        touchNode: (id) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          const node = board?.nodes.find((n) => n.id === id);
          if (!board || !node) return;
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
              ids.includes(n.id) ? ({ ...n, autoFit: on || undefined } as AppNode) : n,
            ),
          })),

        updateNodeData: (id, data) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? ({ ...n, data: { ...n.data, ...data } } as AppNode) : n,
            ),
          })),

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
      version: 2,
      storage: createJSONStorage(() => debouncedSafeStorage),
      partialize: (s) => ({
        boards: s.boards,
        spaces: s.spaces,
        activeId: s.activeId,
        view: s.view,
        ai: s.ai,
        versions: s.versions,
        templates: s.templates,
        ui: s.ui,
        physicsEnabled: s.physicsEnabled,
        clickZoom: s.clickZoom,
        wheelZoom: s.wheelZoom,
        showArchived: s.showArchived,
        gridSnap: s.gridSnap,
      }),
      migrate: (persisted: unknown, version: number) => {
        const p = persisted as Record<string, unknown>;
        // v0: {nodes, edges} — Einzelboard
        if (version === 0 && p && 'nodes' in p) {
          const boards = [
            { id: 'main', name: '🏠 Mein Schreibtisch', nodes: p.nodes as Node[], edges: p.edges as Edge[] },
          ];
          return { boards, spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
        }
        // v1: {boards, activeId} — flache Boards ohne Hierarchie
        if (version === 1 && p && 'boards' in p) {
          const boards = (p.boards as BoardDoc[]) ?? [];
          if (boards.length === 0) {
            return { boards: [{ id: 'main', name: '🏠 Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
          }
          return {
            boards,
            spaces: defaultHierarchy(boards.map((b) => b.id)),
            activeId: (p.activeId as string) ?? boards[0]?.id,
            view: 'board',
          };
        }
        // v2: defensiv validieren (leeres boards-Array oder tote activeId reparieren)
        if (p && 'boards' in p) {
          const boards = (p.boards as BoardDoc[]) ?? [];
          if (boards.length === 0) {
            return { boards: [{ id: 'main', name: '🏠 Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
          }
          if (!boards.some((b) => b.id === (p.activeId as string))) {
            return { ...p, activeId: boards[0].id };
          }
        }
        return p;
      },
    },
  ),
);
