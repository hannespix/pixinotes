/**
 * Ansicht und Einstellungen: offene Dialoge, Werkzeug, Fokus, Darstellung, Bedienung, KI- und Brain-Einstellungen.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import type { AppNode } from '../types';
import type { BoardState, Setzen, Holen } from './typen';
import { selectNurLesen } from './selektoren';
import { LESE_HINWEIS } from './schutz';
import { lookNachziehen } from '../lib/boardLook';

const lookFuerBoards = (boards: BoardState['boards'], ui: BoardState['ui']): Partial<BoardState> => {
  const b = lookNachziehen(boards, ui);
  return b ? { boards: b } : {};
};


/** M503: Die Karte, bei der eine Präsentation ohne ausdrückliche Startkarte beginnt – Fokus, sonst genau eine
 *  markierte Karte (mehrere markierte sind keine „Stelle"; dafür gibt es „Als Präsentation" in der Auswahl-Leiste) */
function startKarte(s: BoardState): string | null {
  const board = s.boards.find((b) => b.id === s.activeId);
  if (!board) return null;
  if (s.focusCard && board.nodes.some((n) => n.id === s.focusCard)) return s.focusCard;
  const markiert = board.nodes.filter((n) => n.selected && !n.archived);
  return markiert.length === 1 ? markiert[0].id : null;
}

/** M480: Teil des Board-Speichers – Ansicht und Einstellungen */
export function ansichtScheibe(set: Setzen, get: Holen) {
  return {
    view: 'board',
    searchOpen: false,
    settingsOpen: false,
    rechercheOpen: false,
    setRechercheOpen: (open) => set({ rechercheOpen: open }),
    presenting: false,
    presentFrom: null,
    setPresentFrom: (id) => set({ presentFrom: id }),
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
    bildExportOpen: false,
    setBildExportOpen: (open) => set({ bildExportOpen: open }),

    ziehBewegung: true,
    setZiehBewegung: (on) => set({ ziehBewegung: on }),
    konfetti: false,
    setKonfetti: (on) => set({ konfetti: on }),
    pfeilSchatten: true,
    setPfeilSchatten: (on) => set({ pfeilSchatten: on }),
    ruheHinweis: false,
    setRuheHinweis: (on) => set({ ruheHinweis: on }),
    stiftZeichnet: true,
    setStiftZeichnet: (on) => set({ stiftZeichnet: on }),

    showArchived: false,
    setShowArchived: (on) => {
      // M390: Mit dem Archiv verschwindet auch die Auswahl archivierter Karten — sonst blieb „1 ausgewählt"
      // stehen und Entf löschte eine Karte, die niemand sah
      if (on) { set({ showArchived: true }); return; }
      set({
        showArchived: false,
        boards: get().boards.map((b) => (b.nodes.some((n) => n.archived && n.selected)
          ? { ...b, nodes: b.nodes.map((n) => (n.archived && n.selected ? ({ ...n, selected: false } as AppNode) : n)) }
          : b)),
      });
    },

    gridSnap: false,
    setGridSnap: (on) => set({ gridSnap: on }),
    fangLinien: true,
    setFangLinien: (on) => set({ fangLinien: on }),
    anzeige: 1,
    setAnzeige: (z) => set({ anzeige: Math.min(1.8, Math.max(1, z)) }),
    lesbareSchrift: false,
    setLesbareSchrift: (on) => set({ lesbareSchrift: on }),
    hoherKontrast: false,
    setHoherKontrast: (on) => set({ hoherKontrast: on }),
    wheelZoom: false,
    setWheelZoom: (on) => set({ wheelZoom: on }),
    handschriftOnline: false,
    setHandschriftOnline: (on) => set({ handschriftOnline: on }),
    handschriftAuto: true,
    setHandschriftAuto: (on) => set({ handschriftAuto: on }),
    fingerGesten: true,
    setFingerGesten: (on) => set({ fingerGesten: on }),
    handschriftKi: true,
    setHandschriftKi: (on) => set({ handschriftKi: on }),
    overviewMode: 'hierarchie',
    setOverviewMode: (m) => set({ overviewMode: m }),
    graphLayers: { cards: false, portals: true, wikis: true, projectOnly: false },
    setGraphLayer: (key, on) => set((s) => ({ graphLayers: { ...s.graphLayers, [key]: on } })),
    ui: { theme: 'system', accent: 'blau' },
    // M509: Boards, die meinen Look mitgeben (beim Teilen), ziehen nach — die Gäste sehen die Änderung live
    setUiTheme: (theme) => { const ui = { ...get().ui, theme }; set({ ui, ...lookFuerBoards(get().boards, ui) }); },
    setUiAccent: (accent) => { const ui = { ...get().ui, accent }; set({ ui, ...lookFuerBoards(get().boards, ui) }); },
    setUiDesign: (design) => { const ui = { ...get().ui, design }; set({ ui, ...lookFuerBoards(get().boards, ui) }); },

    settingsSection: null,
    setSettingsOpen: (open, section = null) => set({ settingsOpen: open, settingsSection: section }),
    tasksOpen: false,
    // M523: Die Zentrale liegt in der Board-Ansicht. Aus der Übersicht geöffnet (Alt+T, Strg+K) blieb sie unsichtbar
    // und sprang erst beim nächsten Board-Wechsel auf — sie holt sich ihre Ansicht jetzt selbst.
    setTasksOpen: (open) => set(open ? { tasksOpen: true, view: 'board' } : { tasksOpen: false }),
    shareCards: null,
    setShareCards: (ids) => set({ shareCards: ids }),

    focusCard: null,
    setFocusCard: (id) => set({ focusCard: id, ...(id ? {} : { focusHerkunft: null }) }),
    focusHerkunft: null,
    /**
     * M285: Der eine Weg zur Karte — aus Übersicht, Navigator, Suche
     * oder Board.
     *
     * Ist das Karten-Blatt abgeschaltet (⚙ → Bedienung) oder trägt die
     * Karte gar keinen Inhalt zum Bearbeiten (Rahmen, Portal, Form), wird
     * stattdessen wie bisher hingeflogen und ausgewählt. So bleibt die
     * Zusage „von überall erreichbar" auch dort wahr, wo es kein Blatt gibt.
     */
    oeffneKarte: (boardId, nodeId, herkunft = 'board') => {
      const st = get();
      const board = st.boards.find((b) => b.id === boardId);
      const node = board?.nodes.find((n) => n.id === nodeId);
      const blattfaehig = !!node
        && !['portal', 'frame', 'shape'].includes(node.type ?? '')
        && !node.archived;
      if (st.cardFocus && blattfaehig) {
        set({ activeId: boardId, view: 'board', focusCard: nodeId, focusHerkunft: herkunft, tasksOpen: false });
      } else {
        set({ pendingFocus: { boardId, nodeId }, activeId: boardId, view: 'board', focusCard: null, focusHerkunft: null, tasksOpen: false });
      }
    },
    cardFocus: true,
    setCardFocus: (on) => set({ cardFocus: on, ...(on ? {} : { focusCard: null }) }),
    // M235: beide AUS voreingestellt — am PC bleibt alles, wie es war,
    // bis jemand es ausdrücklich anders will
    fokusEinKlick: false,
    setFokusEinKlick: (on) => set({ fokusEinKlick: on }),
    fokusVollbild: false,
    setFokusVollbild: (on) => set({ fokusVollbild: on }),
    /**
     * M263: Am großen Schirm ist die linke Spalte die Voreinstellung.
     *
     * „auf großen Screens bitte die Header-Navigation immer links
     * vertikal anzeigen! ist einfach besser!" — und das deckt sich mit
     * der Geometrie aus M238: nach unten ist Platz, nach rechts nicht.
     * Das Stylesheet lässt die Spalte ohnehin erst ab 861 Punkten
     * wirken, am Telefon bleibt es bei der Kopfleiste. Wer sie nicht
     * will, schaltet sie in den Einstellungen ab; diese Wahl wird
     * gespeichert und überschreibt die Voreinstellung.
     */
    navLinks: true,
    setNavLinks: (on) => set({ navLinks: on }),
    navBreite: 380,
    setNavBreite: (px) => set({ navBreite: Math.max(280, Math.min(760, Math.round(px))) }),
    spalteBreite: 268,
    setSpalteBreite: (px) => set({ spalteBreite: Math.max(200, Math.min(480, Math.round(px))) }),
    milchglas: true,
    setMilchglas: (on) => set({ milchglas: on }),
    /**
     * M269: Dateiinhalte reisen im Sync-Stand mit — bis zu dieser Grenze.
     *
     * 25 MB als Voreinstellung: Das deckt Handouts, Tischvorlagen und
     * Protokolle ab, für die eine Datei-Karte typischerweise angelegt
     * wird, und hält die Sync-Datei in einer Größe, die auch über die
     * Dateien-App und WebDAV noch zügig durchgeht. 0 schaltet es ab.
     */
    syncDateienMb: 25,
    setSyncDateienMb: (mb) => set({ syncDateienMb: Math.max(0, Math.min(500, Math.round(mb))) }),

    /* M503: „Präsentieren" öffnet dort, wo ich bin. Ohne ausdrückliche Startkarte (`ab` fehlt) gilt: eine schon
       gewünschte Startkarte (presentFrom) – sonst die Karte im Fokus – sonst die EINE markierte Karte des Boards –
       sonst von vorn. `ab: null` heißt ausdrücklich „von vorn" (ein anderes Board, das ganze Board aus dem Menü).
       Vorher setzte nur der Fokus-Knopf eine Startkarte; Dock, Alt+P und Suche begannen immer bei Folie 1. */
    setPresenting: (on, ab) => {
      if (!on) { set({ presenting: false }); return; }
      const s = get();
      set({ presenting: true, presentFrom: ab !== undefined ? ab : (s.presentFrom ?? startKarte(s)) });
    },
    setTool: (tool) => {
      // M360: Auf einem nur lesend geteilten Board gibt es nichts zu zeichnen
      if (tool !== 'select' && selectNurLesen(get())) { get().showToast(LESE_HINWEIS, false, 5000); return; }
      set({ tool });
    },
    updateAi: (patch) => set({ ai: { ...get().ai, ...patch } }),
    brain: { on: false, provider: 'auto', embedModel: 'nomic-embed-text' },
    updateBrain: (patch) => set({ brain: { ...get().brain, ...patch } }),

    brainOffSpaces: [],
    toggleBrainSpace: (spaceId) => {
      const off = get().brainOffSpaces;
      const next = off.includes(spaceId) ? off.filter((x) => x !== spaceId) : [...off, spaceId];
      set({ brainOffSpaces: next });
      // Der Index räumt verwaiste Einträge beim nächsten Lauf selbst weg —
      // abgeschaltete Bereiche verlieren ihre Vektoren also von allein.
      window.dispatchEvent(new CustomEvent('pixinotes:brain-scope'));
    },
    rejectedLinks: [],
    rejectLink: (a, b) => {
      const key = [a, b].sort().join('|');
      const cur = get().rejectedLinks;
      if (!cur.includes(key)) set({ rejectedLinks: [...cur, key] });
    },
  } satisfies Partial<BoardState>;
}
