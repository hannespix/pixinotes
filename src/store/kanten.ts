/**
 * Verbindungen (Kanten): Änderungen aus React Flow, verbinden, beschriften, Art und Aussehen, löschen.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import { addEdge, applyEdgeChanges } from '@xyflow/react';
import { uid } from '../types';
import type { BoardState, Setzen, Holen, AufsOffene } from './typen';


/** M480: Teil des Board-Speichers – Verbindungen (Kanten) */
export function kantenScheibe(_set: Setzen, get: Holen, patchActive: AufsOffene) {
  return {
    onEdgesChange: (changes) => {
      // Kantenlöschung (Entf-Taste) muss undo-fähig sein — wie bei Nodes (Audit R6-S2)
      if (changes.some((c) => c.type === 'remove')) get().pushHistory();
      patchActive((b) => ({ edges: applyEdgeChanges(changes, b.edges) }));
    },

    onConnect: (connection) => {
      // M521: Auf der eigenen Karte losgelassen — eine Verbindung von einer Karte zu sich selbst wird nirgends
      // gezeichnet, lag aber im Board (und als leerer Rückgängig-Schritt im Verlauf)
      if (connection.source === connection.target) return;
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
      // M514: Von Rahmen zu Rahmen entsteht ein Rahmenpfeil — er legt die Reihenfolge der Rahmen-Reise fest
      if (t1 === 'frame' && t2 === 'frame' && connection.source !== connection.target) {
        get().showToast('Rahmenpfeil: legt die Reihenfolge fest – Doppelklick auf einen Rahmentitel präsentiert Rahmen für Rahmen.');
      } else if ((t1 === 'kanban' && t2 === 'gantt') || (t1 === 'gantt' && t2 === 'kanban')) {
        get().showToast('Verbunden: Fristen werden Meilensteine, Vorgänge werden Tickets.');
      } else if (pair('kanban')) {
        get().showToast('Verbunden: Offene Punkte der Karte landen als Tickets im Kanban.');
      } else if (pair('calendar')) {
        get().showToast('Verbunden: Der Kalender zeigt Termine und Fristen der Karte.');
      } else if (pair('time', 'week')) {
        get().showToast('Verbunden: Der Wochenplan liefert die Sollzeit für die Zeiterfassung.');
      } else if (pair('time', 'note') || pair('time', 'kanban')) {
        get().showToast('Verbunden: Die Karte zeigt die Arbeitszeit aus der Zeiterfassung.');
      } else if (pair('mermaid', 'note')) {
        get().showToast('Verbunden: Das Diagramm folgt der Checkliste der Notiz.');
      } else if (pair('note', 'htmlapp')) {
        get().showToast('Verbunden: Die Notiz zeigt den Speicherstand der App.');
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

    updateEdgeLabel: (id, label) => {
      get().schritt(`kante:${id}:etikett`);
      patchActive((b) => ({
        edges: b.edges.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, label } } : e,
        ),
      }));
    },

    updateEdgeKind: (id, kind) => {
      get().schritt(`kante:${id}:art`);
      patchActive((b) => ({
        edges: b.edges.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, kind } } : e,
        ),
      }));
    },

    updateEdgeStyle: (id, patch) => {
      get().schritt(`kante:${id}:stil`);
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
      }));
    },

    // M530: Reihenfolge der Ausgänge eines Rahmens (Rahmen-Reise an einer Verzweigung) — `ids` in der neuen Folge
    ausgaengeOrdnen: (ids) => { void import('./ausgaenge').then((m) => m.ausgaengeOrdnen(get, patchActive, ids)); },

    removeEdge: (id) => {
      get().pushHistory();
      patchActive((b) => ({ edges: b.edges.filter((e) => e.id !== id) }));
    },
  } satisfies Partial<BoardState>;
}
