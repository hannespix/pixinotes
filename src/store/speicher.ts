/**
 * Speichern: gedrosselter localStorage-Schreiber, Single-Writer (M81), Import-Merker, abgeleitete Änderungen und
 * die Persist-Auswahl samt Migration alter Speicherstände.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import type { Edge, Node } from '@xyflow/react';
import type { TimeSeg } from '../types';
import { anchorStroke } from '../lib/strokeAnchor';
import type { BoardDoc, Space, BoardState } from './typen';
import { persistHaken } from './schutz';
import { defaultHierarchy } from './start';
import { useBoard } from '../store';

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
export const debouncedSafeStorage = {
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
      useBoard.getState().showToast('Das andere Fenster ist zu – dieses Fenster speichert jetzt wieder selbst.');
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
  useBoard.getState().showToast('Ein anderes Fenster hat die Bearbeitung übernommen – dieses Fenster liest nur noch mit.');
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

/** Was vom Board-Stand auf die Platte geht (persist → partialize) */
export const speicherAuswahl = (s: BoardState) => ({
  boards: s.boards.map((b) => persistHaken.board(b)),
  spaces: s.spaces,
  activeId: s.activeId,
  view: s.view,
  ai: s.ai,
  brain: s.brain,
  brainOffSpaces: s.brainOffSpaces,
  rejectedLinks: s.rejectedLinks,
  templates: s.templates,
  ui: s.ui,
  physicsEnabled: s.physicsEnabled,
  konfetti: s.konfetti,
  pfeilSchatten: s.pfeilSchatten,
  stiftZeichnet: s.stiftZeichnet,
  clickZoom: s.clickZoom,
  cardFocus: s.cardFocus,
  fokusEinKlick: s.fokusEinKlick,
  fokusVollbild: s.fokusVollbild,
  navLinks: s.navLinks,
  navBreite: s.navBreite,
  spalteBreite: s.spalteBreite,
  milchglas: s.milchglas,
  syncDateienMb: s.syncDateienMb,
  anzeige: s.anzeige,
  lesbareSchrift: s.lesbareSchrift,
  hoherKontrast: s.hoherKontrast,
  wheelZoom: s.wheelZoom,
  handschriftOnline: s.handschriftOnline,
  handschriftAuto: s.handschriftAuto,
  fingerGesten: s.fingerGesten,
  handschriftKi: s.handschriftKi,
  showArchived: s.showArchived,
  gridSnap: s.gridSnap,
  overviewMode: s.overviewMode,
  graphLayers: s.graphLayers,
});

/** Ältere Speicherstände auf den heutigen bringen (persist → migrate) */
export const speicherMigration = (persisted: unknown, version: number) => {
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
      { id: 'main', name: 'Mein Schreibtisch', nodes: p.nodes as Node[], edges: p.edges as Edge[] },
    ];
    return anchorLegacyStrokes({ boards, spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' });
  }
  // v1: {boards, activeId} — flache Boards ohne Hierarchie
  if (version === 1 && p && 'boards' in p) {
    const boards = (p.boards as BoardDoc[]) ?? [];
    if (boards.length === 0) {
      return { boards: [{ id: 'main', name: 'Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
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
      return { boards: [{ id: 'main', name: 'Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
    }
    if (!boards.some((b) => b.id === (p.activeId as string))) {
      return mergeTimeKinds(stripHappHandle(anchorLegacyStrokes({ ...p, activeId: boards[0].id })));
    }
  }
  return mergeTimeKinds(stripHappHandle(anchorLegacyStrokes(p)));
};
