/**
 * Karten: anlegen, ändern, duplizieren, verschieben, löschen und wiederherstellen, Größe, Drehung, Kachel,
 * Schrift, Fristen-Anker, Vorlagen.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import { applyNodeChanges, type NodeChange } from '@xyflow/react';
import { KACHEL_TYPEN, uid, type AppNode } from '../types';
import { drehe, istDrehbar, winkelNorm, winkelVon } from '../lib/drehung';
import { istAmText } from '../lib/notizText';
import { findFreeSpot, frameMembers, sizeOf } from '../lib/arrange';
import { baueRueckverweis } from '../lib/portale';
import { blockeMitDatum, fristAnkerPflegen, type FristAnker } from '../lib/fristAnker';
import { fristenBereit, fristenLaden } from '../lib/dates';
import { frisch, nachPatch } from '../lib/kartenZeit';
import { blocksToText } from '../lib/serialize';
import type { BoardState, Setzen, Holen, AufsOffene } from './typen';
import { selectActiveBoard } from './selektoren';
import { snapBoards, HISTORY_LIMIT, historyMuted, mutedHistory, lastEditKey, lastEditAt, tippBuendelEnde, tippBuendelMerken, EDIT_COALESCE_MS } from './verlauf';
import { runDerived, inDerived } from './speicher';

const VORLAGEN_MAX = 40;

/** M388: Inhalte im Gerätespeicher (große Dateien, Tool-Quelltexte) zu den Karten einer Kopie mitnehmen */
export function anhaengeMitnehmen(nodes: AppNode[], karte: Map<string, string>): void {
  const paare = nodes.filter((n) => n.type === 'file' || n.type === 'htmlapp' || (n.type === 'sheet' && !!(n.data as { datei?: string }).datei)).map((n) => [n.id, karte.get(n.id) as string] as [string, string]);
  if (paare.length) void import('../lib/anhangKopie').then((m) => m.anhaengeKopieren(paare)).catch(() => {});
}

/** M453: Inhaltliche Änderung von Hand stempelt die Karte — Automatik (runDerived) nicht */
export const zeitNachPatch = (neu: AppNode, alt: AppNode, patch: Record<string, unknown>): AppNode =>
  (inDerived() ? neu : nachPatch(neu, alt, patch));

/** M390: Ändern sich die Blöcke einer Notiz, wandern die Fristen-Anker mit (lib/fristAnker.ts). */
const mitFristAnker = (n: AppNode, data: Record<string, unknown>): Record<string, unknown> => {
  // M435: Formen (Schritt, Entscheidung, Start/Ende) tragen formatierten Text wie Notizen — `text` bleibt die
  // Klartext-Fassung für KI, Suche, Export und Vortrag. Neue Blöcke schreiben den Klartext nach; wer nur den
  // Klartext setzt (KI, Vortrag, Import), dem gehört der Inhalt: die alten Blöcke fallen weg.
  if (n.type === 'shape') {
    if ('blocks' in data) return { ...data, text: blocksToText(data.blocks as unknown[] | undefined).trim() };
    if ('text' in data) return { ...data, blocks: undefined };
    return data;
  }
  if (n.type !== 'note' || !('blocks' in data) || 'fristAnker' in data) return data;
  const alt = (n.data as { fristAnker?: FristAnker }).fristAnker;
  const neu = fristAnkerPflegen(data.blocks, alt);
  return neu === alt ? data : { ...data, fristAnker: neu };
};

/** M480: Teil des Board-Speichers – Karten */
export function kartenScheibe(set: Setzen, get: Holen, patchActive: AufsOffene) {
  return {
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
      // M408: Der Hinweis sagt, wo das Archiv ist (vorher nur „Strg+Z holt sie zurück" – danach suchte man es vergeblich)
      get().showToast(
        // (Einzahl und Mehrzahl als ganze Sätze – ein angehängtes „n" lässt sich nicht übersetzen)
        archived
          ? (ids.length === 1 ? 'Karte archiviert. Wiederfinden: Mehr → „Archiv einblenden".' : `${ids.length} Karten archiviert. Wiederfinden: Mehr → „Archiv einblenden".`)
          : (ids.length === 1 ? 'Karte aus dem Archiv zurückgeholt.' : `${ids.length} Karten aus dem Archiv zurückgeholt.`),
        archived ? true : undefined,
      );
    },

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
        tippBuendelMerken(key, now);
      }
      // M323: Wer von außen die BLÖCKE einer Notiz schreibt (Aufgaben-
      // Zentrale, Kanban-Rücksync, Teilen-Ziel), muss den lebenden Editor
      // erreichen — der liest seinen Inhalt sonst nur beim Mount und
      // schrieb beim nächsten Tastendruck den alten Stand zurück. extEpoch
      // zählt deshalb automatisch hoch, wenn der Aufrufer es nicht selbst tut.
      const patch = data as Record<string, unknown>;
      const bumpt = 'blocks' in patch && !('extEpoch' in patch);
      set({
        boards: get().boards.map((b) =>
          b.id === boardId
            ? {
                ...b,
                nodes: b.nodes.map((n) =>
                  n.id === nodeId
                    ? zeitNachPatch({ ...n, data: { ...n.data, ...mitFristAnker(n, data), ...(bumpt ? { extEpoch: (((n.data as { extEpoch?: number }).extEpoch) ?? 0) + 1 } : {}) } } as AppNode, n, patch)
                    : n,
                ),
              }
            : b,
        ),
      });
    },
    textRueckgaengig: (id, blocks) => {
      /**
       * M390: Strg+Z IM Notiztext ist das Rückgängig des Editors — fein, Wort für Wort. Sein Ergebnis kam bisher
       * als gewöhnliche Änderung im Verlauf des Boards an: als NEUER Schritt. Wer danach auf der Fläche Strg+Z
       * drückte, nahm damit das Zurücknehmen zurück — der entfernte Text stand wieder da. Jetzt legt das
       * Editor-Rückgängig keinen Schritt an; und ist es genau bei einem gesicherten Stand angekommen, gilt
       * dieser Schritt als verbraucht.
       */
      const s0 = get();
      const board = s0.boards.find((b) => b.id === s0.activeId);
      if (!board) return;
      const gleich = (n: AppNode | undefined) => !!n && JSON.stringify((n.data as { blocks?: unknown }).blocks ?? null) === JSON.stringify(blocks ?? null);
      let past = s0.past;
      const oben = past[past.length - 1];
      if (oben && oben.boardId === board.id && !oben.others?.length && gleich(oben.nodes.find((n) => n.id === id))) {
        // nur verbrauchen, wenn der Schritt sonst nichts anderes sichert als diesen Text
        const sonstGleich = oben.nodes.length === board.nodes.length && oben.edges === board.edges
          && oben.nodes.every((n) => n.id === id || board.nodes.find((x) => x.id === n.id) === n);
        if (sonstGleich) past = past.slice(0, -1);
      }
      tippBuendelEnde();
      set({
        past,
        boards: s0.boards.map((b) => (b.id !== board.id ? b : {
          ...b,
          // M463: auch das Rückgängig im Editor ändert den Text von Hand – stempeln (M453)
          nodes: b.nodes.map((n) => (n.id === id ? zeitNachPatch({ ...n, data: { ...n.data, ...mitFristAnker(n, { blocks }) } } as AppNode, n, { blocks }) : n)),
        })),
      });
    },
    fristAnkerNachtragen: () => {
      // Bestehende Notizen (vor M390 geschrieben, importiert, aus Vorlagen): Ihr Anker ist der Tag, an dem die
      // App sie zum ersten Mal sieht. Nur eigene Boards — in einem geteilten ändert jeder nur, was er anfasst.
      // M459: Die Erkennung lädt bei Bedarf — steht irgendwo ein möglicher Termin, erst laden, dann nachtragen.
      if (!fristenBereit()) {
        const brauchts = get().boards.some((b) => !b.geteiltVon && b.nodes.some((n) => n.type === 'note' && blockeMitDatum((n.data as { blocks?: unknown }).blocks)));
        if (brauchts) { void fristenLaden().then(() => get().fristAnkerNachtragen(), () => {}); return; }
      }
      let geaendert = false;
      const boards = get().boards.map((b) => {
        if (b.geteiltVon) return b;
        let anders = false;
        const nodes = b.nodes.map((n) => {
          if (n.type !== 'note') return n;
          const alt = (n.data as { fristAnker?: FristAnker }).fristAnker;
          const neu = fristAnkerPflegen((n.data as { blocks?: unknown }).blocks, alt);
          if (neu === alt) return n;
          anders = true;
          return { ...n, data: { ...n.data, fristAnker: neu } } as AppNode;
        });
        if (!anders) return b;
        geaendert = true;
        return { ...b, nodes };
      });
      if (geaendert) runDerived(() => set({ boards }));
    },
    // ---------- Trilium-Paket: Vorlagen ----------
    templates: [],

    saveTemplate: (node, name) => {
      // M390: Die 21. Vorlage verdrängte still die älteste. Jetzt gibt es Platz für 40 — und wenn er voll ist,
      // sagt es der Hinweis, statt etwas wegzunehmen.
      if (get().templates.length >= VORLAGEN_MAX) {
        get().showToast(`Es gibt schon ${VORLAGEN_MAX} Vorlagen – erst eine löschen (＋-Menü, ✕ an der Vorlage).`, false, 7000);
        return;
      }
      // M390: Die Vorlage bekommt eine eigene Kennung, und was im Gerätespeicher liegt (große Datei, Tool-
      // Quelltext), wird dorthin kopiert — vorher kam eine Datei- oder Tool-Karte aus der Vorlage leer an.
      const clean = JSON.parse(JSON.stringify({ ...node, id: uid(), selected: false })) as AppNode;
      anhaengeMitnehmen([node], new Map([[node.id, clean.id]]));
      set({ templates: [...get().templates, { id: uid(), name: name.trim().slice(0, 40) || 'Vorlage', node: clean }] });
      get().showToast(`Vorlage „${name}" gespeichert – im ＋-Menü unter „Vorlagen".`);
    },

    removeTemplate: (id) =>
      set({ templates: get().templates.filter((t) => t.id !== id) }),

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
        // M542: … außer der Größe, die jemand am Griff zieht (NodeResizer meldet `resizing`) — die ist Bearbeitung und
        // muss hochgeladen werden (am rechten/unteren Griff kommt sie ohne Positions-Änderung, galt also als Mechanik)
        const mechanical = rest.every((c) => (c.type === 'dimensions' && typeof c.resizing !== 'boolean') || c.type === 'select');
        const apply = () => patchActive((b) => ({ nodes: applyNodeChanges(rest, b.nodes) as AppNode[] }));
        if (mechanical) runDerived(apply); else apply();
      }
      if (removeIds.length) get().removeNodes(removeIds);
    },

    verschiebeUm: (ids, dx, dy) => {
      const b = selectActiveBoard(get());
      const wahl = new Set(ids);
      const rahmen = b.nodes.filter((n) => wahl.has(n.id) && n.type === 'frame');
      // Rahmen nehmen ihren Inhalt mit — auch per Tastatur
      for (const f of rahmen) for (const m of frameMembers(f, b.nodes, true, true)) wahl.add(m.id);
      get().schritt(`pfeil:${[...ids].sort().join(',')}`);
      patchActive((bb) => ({
        nodes: bb.nodes.map((n) => (wahl.has(n.id) ? ({ ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } as AppNode) : n)),
      }));
    },

    addNode: (node) => {
      get().pushHistory();
      patchActive((b) => ({ nodes: [...b.nodes, frisch(node)] }));
    },

    // M530: nachgeladen (store/duplizieren.ts, Start-JS) — Rückgabe: Anzahl der Kopien, sobald sie liegen
    dupliziere: (ids) => import('./duplizieren').then((m) => m.dupliziere(get, patchActive, ids)),

    addNodeToBoard: (boardId, node) => {
      // M388: gesichert wird das ZIEL-Board (wie bei updateNodeDataOnBoard) — vorher das gerade offene: Ein
      // Schnelleintrag aus der Aufgaben-Zentrale auf ein anderes Board ließ sich nicht zurücknehmen.
      const s0 = get();
      const ziel = s0.boards.find((b) => b.id === boardId);
      if (!ziel) return;
      if (!historyMuted) {
        tippBuendelEnde();
        set({ past: [...s0.past.slice(-(HISTORY_LIMIT - 1)), { boardId: ziel.id, nodes: ziel.nodes, edges: ziel.edges, drawings: ziel.drawings, comments: ziel.comments }], future: [] });
      }
      set({
        boards: get().boards.map((b) =>
          b.id === boardId ? { ...b, nodes: [...b.nodes, frisch(node)] } : b),
      });
    },

    /**
     * M262: Portal-Ziel wählen — und drüben den Rückverweis anlegen.
     *
     * Beide Änderungen liegen in EINEM Undo-Schritt (pushHistoryBoards):
     * Ein Portal ist eine Beziehung, kein Objekt auf einem Board; sie in
     * zwei Schritten zurückzunehmen hieße, kurzzeitig eine halbe Beziehung
     * zu haben.
     */
    portalZielSetzen: (nodeId, zielBoardId) => {
      const s = get();
      const quelle = s.boards.find((b) => b.id === s.activeId);
      const ziel = s.boards.find((b) => b.id === zielBoardId);
      if (!quelle || !ziel) return;
      const rueck = baueRueckverweis(ziel, quelle.id);
      get().pushHistoryBoards([zielBoardId]);
      set({
        boards: get().boards.map((b) => {
          if (b.id === quelle.id) {
            return { ...b, nodes: b.nodes.map((n) => (n.id === nodeId
              ? ({ ...n, data: { ...n.data, boardId: zielBoardId } } as AppNode) : n)) };
          }
          if (b.id === ziel.id && rueck) return { ...b, nodes: [...b.nodes, rueck] };
          return b;
        }),
      });
      get().showToast(rueck
        ? `Portal zu „${ziel.name}" – und dort liegt jetzt ein Rückverweis auf „${quelle.name}". Strg+Z macht beides rückgängig.`
        : `Portal zu „${ziel.name}" – von dort führt bereits ein Portal zurück.`);
    },

    portalAnlegen: (quellBoardId, zielBoardId, position) => {
      const s = get();
      const quelle = s.boards.find((b) => b.id === quellBoardId);
      const ziel = s.boards.find((b) => b.id === zielBoardId);
      if (!quelle || !ziel || quelle.id === ziel.id) return;
      const wunsch = position ?? { x: 80, y: 80 };
      const hin: AppNode = {
        id: uid(), type: 'portal', width: 200,
        position: findFreeSpot(quelle.nodes, wunsch, { w: 200, h: 140 }),
        data: { boardId: zielBoardId },
      };
      const rueck = baueRueckverweis(ziel, quelle.id);
      get().pushHistoryBoards([quellBoardId, zielBoardId]);
      set({
        boards: get().boards.map((b) => {
          if (b.id === quelle.id) return { ...b, nodes: [...b.nodes, hin] };
          if (b.id === ziel.id && rueck) return { ...b, nodes: [...b.nodes, rueck] };
          return b;
        }),
      });
      get().showToast(rueck
        ? `Portal „${quelle.name}" ⇄ „${ziel.name}" – auf beiden Boards liegt jetzt eine Karte. Strg+Z macht beides rückgängig.`
        : `Portal „${quelle.name}" → „${ziel.name}" – zurück führte schon eines. Strg+Z macht es rückgängig.`);
    },

    rueckverweisNachtragen: (quellBoardId, zielBoardId) => {
      const s = get();
      const quelle = s.boards.find((b) => b.id === quellBoardId);
      const ziel = s.boards.find((b) => b.id === zielBoardId);
      if (!quelle || !ziel) return;
      const rueck = baueRueckverweis(ziel, quelle.id);
      if (!rueck) { get().showToast(`„${ziel.name}" verweist bereits zurück.`); return; }
      get().pushHistoryBoards([zielBoardId]);
      set({
        boards: get().boards.map((b) => (b.id === ziel.id ? { ...b, nodes: [...b.nodes, rueck] } : b)),
      });
      get().showToast(`„${ziel.name}" verweist jetzt auf „${quelle.name}" zurück. Strg+Z macht es rückgängig.`);
    },

    removeNode: (id) => get().removeNodes([id]),

    removeNodes: (ids, kantenIds) => {
      const board = get().boards.find((b) => b.id === get().activeId);
      if (!board) return;
      const idSet = new Set(ids);
      // M521: mitgewählte Verbindungen zwischen ANDEREN Karten gehen im selben Schritt mit (Entf mit Karte + Verbindung)
      const kanteWeg = (e: { id: string; source: string; target: string }) => idSet.has(e.source) || idSet.has(e.target) || !!kantenIds?.includes(e.id);
      const removedNodes = board.nodes.filter((n) => idSet.has(n.id));
      const removedEdges = board.edges.filter(kanteWeg);
      if (removedNodes.length === 0) return;
      // Geankerte Markierungen gehören zur Karte — sie gehen (undo-fähig) mit
      const removedDrawings = (board.drawings ?? []).filter((s) => s.anchor && idSet.has(s.anchor));
      const removedComments = (board.comments ?? []).filter((c) => idSet.has(c.nodeId));
      get().pushHistory();
      patchActive((b) => ({
        nodes: b.nodes.filter((n) => !idSet.has(n.id)),
        edges: b.edges.filter((e) => !kanteWeg(e)),
        drawings: (b.drawings ?? []).filter((s) => !s.anchor || !idSet.has(s.anchor)),
        // Kommentar-Pins hängen an der Karte — mit ihr verschwinden sie (M148)
        comments: (b.comments ?? []).filter((c) => !idSet.has(c.nodeId)),
      }));
      set({ lastDeleted: { boardId: board.id, nodes: removedNodes, edges: removedEdges, drawings: removedDrawings, comments: removedComments } });
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
      // M521: auch die archivierten — sie blieben sonst unsichtbar auf dem alten Board zurück (wie M390 beim Ziehen)
      for (const n of src.nodes) {
        if (n.type === 'frame' && idSet.has(n.id)) {
          for (const m of frameMembers(n, src.nodes, true, true)) idSet.add(m.id);
        }
      }
      const moving = src.nodes.filter((n) => idSet.has(n.id));
      if (moving.length === 0) return;

      // EIN Undo-Schritt für BEIDE Boards (HistoryEntry.others)
      tippBuendelEnde();
      set({
        lastDeleted: null,   // M388: der Hinweis-Knopf gehört jetzt diesem Schritt, nicht einem früheren Löschen
        past: [...s.past.slice(-(HISTORY_LIMIT - 1)), {
          boardId: src.id, nodes: src.nodes, edges: src.edges, drawings: src.drawings, comments: src.comments,
          others: snapBoards(s.boards, [tgt.id]),
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
        `${moving.length === 1 ? 'Karte' : `${moving.length} Karten`} nach „${tgt.name}" verschoben – Strg+Z holt alles zurück.`,
        'schritt',   // M388: „Rückgängig" nimmt das Verschieben zurück (vorher: stellte irgendein früher Gelöschtes wieder her)
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
      // M388: nur, was nicht (wieder) da ist — nach Strg+Z lag die Karte sonst doppelt, mit derselben Kennung
      const ziel = get().boards.find((b) => b.id === snap.boardId)!;
      const fehlt = <T extends { id: string }>(da: T[] | undefined, neu: T[] | undefined): T[] => { const ids = new Set((da ?? []).map((x) => x.id)); return (neu ?? []).filter((x) => !ids.has(x.id)); };
      const nodes = fehlt(ziel.nodes, snap.nodes);
      if (nodes.length === 0) { set({ lastDeleted: null }); return; }
      // M390: gesichert wird das Board, auf dem wiederhergestellt wird — nicht das gerade offene
      if (snap.boardId !== get().activeId) get().pushHistoryBoards([snap.boardId]); else get().pushHistory();
      set({
        boards: get().boards.map((b) =>
          b.id === snap.boardId
            ? {
                ...b,
                nodes: [...b.nodes, ...nodes.map((n) => ({ ...n, selected: false }) as AppNode)],
                edges: [...b.edges, ...fehlt(b.edges, snap.edges)],
                drawings: snap.drawings?.length ? [...(b.drawings ?? []), ...fehlt(b.drawings, snap.drawings)] : b.drawings,
                comments: snap.comments?.length ? [...(b.comments ?? []), ...fehlt(b.comments, snap.comments)] : b.comments,
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

    textStricheFestschreiben: (nodeId) => {
      const board = get().boards.find((b) => b.id === get().activeId);
      const n = board?.nodes.find((k) => k.id === nodeId);
      if (!board || !n || n.type !== 'note') return;
      const offen = (board.drawings ?? []).filter((s) => s.anchor === nodeId && s.seite == null && s.amText == null);
      if (offen.length === 0) return;
      const w = n.width ?? n.measured?.width ?? 260;
      const h = n.height ?? undefined; // ohne feste Höhe reichte die Karte bis zum Ende ihres Inhalts
      const ids = new Set(offen.map((s) => s.id));
      // gehört zur folgenden Größenänderung — kein eigener Rückgängig-Schritt
      mutedHistory(() => patchActive((b) => ({
        drawings: (b.drawings ?? []).map((s) => (ids.has(s.id) ? { ...s, amText: istAmText(s, true, w, h) } : s)),
      })));
    },

    setAutoFit: (ids, on) =>
      patchActive((b) => ({
        nodes: b.nodes.map((n) =>
          ids.includes(n.id) ? ({ ...n, autoFit: on ? undefined : false } as AppNode) : n,
        ),
      })),

    setWinkel: (entries) => {
      if (entries.length === 0) return;
      const ziel = new Map(entries);
      patchActive((b) => {
        const gedreht = new Map<string, { d: number; mx: number; my: number; n: AppNode }>();
        const nodes = b.nodes.map((n) => {
          if (!ziel.has(n.id) || !istDrehbar(n)) return n;
          const neu = winkelNorm(ziel.get(n.id)!);
          const alt = winkelVon(n);
          if (neu === alt) return n;
          const g = sizeOf(n);
          gedreht.set(n.id, { d: neu - alt, mx: g.w / 2, my: g.h / 2, n });
          return { ...n, winkel: neu || undefined } as AppNode;
        });
        if (gedreht.size === 0) return {};
        // Striche, die auf der Brett-Ebene an der Karte hängen, drehen sich um deren Mitte mit. Was die Karte
        // selbst zeichnet (auf dem Text einer Notiz, auf einer Dokument-Seite), dreht sich schon mit ihr.
        const drawings = (b.drawings ?? []).map((st) => {
          const g = st.anchor ? gedreht.get(st.anchor) : undefined;
          if (!g || st.seite != null) return st;
          if (g.n.type === 'note' && !g.n.kachel && istAmText(st, true, g.mx * 2, g.n.height ?? undefined)) return st;
          return { ...st, points: st.points.map(([x, y]) => {
            const q = drehe({ x, y }, { x: g.mx, y: g.my }, g.d);
            return [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100] as [number, number];
          }) };
        });
        return { nodes, drawings };
      });
    },

    setKachel: (ids, on) => {
      if (ids.length === 0) return;
      get().pushHistory();
      const idSet = new Set(ids);
      patchActive((b) => ({
        nodes: b.nodes.map((n) => {
          if (!idSet.has(n.id) || !KACHEL_TYPEN.has(n.type ?? '')) return n;
          if (on) {
            if (n.kachel) return n;
            // Größe merken, damit „Ausklappen" die Karte so zurückbringt, wie sie war
            const w = (typeof n.width === 'number' ? n.width : n.measured?.width) ?? 420;
            const h = (typeof n.height === 'number' ? n.height : n.measured?.height) ?? 260;
            return { ...n, kachel: true, kachelMass: { w, h }, width: 300, height: undefined, autoFit: undefined } as AppNode;
          }
          if (!n.kachel) return n;
          const m = n.kachelMass;
          return { ...n, kachel: undefined, kachelMass: undefined, width: m?.w ?? n.width, height: m?.h ?? n.height } as AppNode;
        }),
      }));
    },

    setCardTypo: (ids, patch) => {
      if (ids.length === 0) return;
      get().pushHistory();
      const idSet = new Set(ids);
      patchActive((b) => ({
        nodes: b.nodes.map((n) => {
          if (!idSet.has(n.id)) return n;
          const next = { ...n } as AppNode;
          if (patch.font !== undefined) next.font = patch.font ?? undefined;
          if (patch.fontSize !== undefined) next.fontSize = patch.fontSize ?? undefined;
          return next;
        }),
      }));
    },

    updateNodeData: (id, data) => {
      // Feingranulare History (M122): gebündelter Snapshot vor der Änderung —
      // Automatik (runDerived) und Sammel-Aktionen (mutedHistory) ausgenommen
      if (!historyMuted && !inDerived()) {
        const key = `n:${get().activeId}:${id}`;
        const now = Date.now();
        if (key !== lastEditKey || now - lastEditAt > EDIT_COALESCE_MS) get().pushHistory();
        tippBuendelMerken(key, now);
      }
      patchActive((b) => ({
        nodes: b.nodes.map((n) =>
          n.id === id ? zeitNachPatch({ ...n, data: { ...n.data, ...mitFristAnker(n, data) } } as AppNode, n, data) : n,
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

    focusNode: (boardId, nodeId, opt) => {
      // M523: Wer zu einer Karte springt (Suche, Baum, Verweis), will sie sehen — die Aufgaben-Zentrale lag sonst weiter davor
      set({ pendingFocus: { boardId, nodeId, markieren: opt?.markieren }, activeId: boardId, view: 'board', tasksOpen: false });
    },

    clearPendingFocus: () => set({ pendingFocus: null }),
  } satisfies Partial<BoardState>;
}
