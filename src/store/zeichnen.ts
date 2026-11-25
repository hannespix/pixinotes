/**
 * Zeichnen: Freihand-Striche anlegen, radieren und von Karten lösen; Bilder ersetzen samt ihrer Striche.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import { uid, type AppNode } from '../types';
import { integrateStroke } from '../lib/strokeAnchor';
import { strichRelativ } from '../lib/pdfSeiten';
import type { Stroke, BoardState, Setzen, Holen, AufsOffene } from './typen';
import { zeitNachPatch } from './karten';

/** Radier-Geste: erster Treffer erzeugt den History-Eintrag, Rest der Geste nicht */
let eraseSnapPending = false;

/**
 * M521: Welche Punkte eines Strichs trifft der Radierer? Geprüft wird die gezeichnete LINIE, nicht nur ihre
 * Stützpunkte: Eine begradigte Linie hat zwei Punkte, ein eingerastetes Rechteck fünf — dazwischen lag vorher nichts,
 * was der Radierer treffen konnte (er wirkte nur an den Enden bzw. Ecken). Liegt die Strecke zwischen zwei Punkten im
 * Radius, gelten beide als getroffen.
 */
function radiert(rel: [number, number][], ox: number, oy: number, x: number, y: number, radius: number): boolean[] {
  const drin = rel.map((p) => Math.hypot(p[0] + ox - x, p[1] + oy - y) < radius);
  for (let i = 0; i + 1 < rel.length; i += 1) {
    if (drin[i] && drin[i + 1]) continue;
    const ax = rel[i][0] + ox; const ay = rel[i][1] + oy;
    const dx = rel[i + 1][0] + ox - ax; const dy = rel[i + 1][1] + oy - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 <= radius * radius) continue;          // dichter als der Radius: Die Punkte selbst genügen
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) < radius) { drin[i] = true; drin[i + 1] = true; }
  }
  return drin;
}

/** Geankerte Striche liegen relativ zur Karte: ihr Versatz — `null`, wenn die Karte fehlt oder archiviert und ausgeblendet ist */
const versatzVon = (nodes: AppNode[], zeigeArchiv: boolean) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (s: Stroke): [number, number] | null => {
    if (!s.anchor) return [0, 0];
    const n = byId.get(s.anchor);
    return !n || (n.archived && !zeigeArchiv) ? null : [n.position.x, n.position.y];
  };
};

/** M480: Teil des Board-Speichers – Zeichnen */
export function zeichnenScheibe(set: Setzen, get: Holen, patchActive: AufsOffene) {
  return {
    addStroke: (stroke, sessionIds = []) => {
      get().pushHistory();
      patchActive((b) => ({
        drawings: integrateStroke(stroke, b.drawings ?? [], sessionIds, b.nodes).drawings,
      }));
    },

    bildErsetzen: (id, patch, verhaeltnis, neueId) => {
      const st = get();
      const board = st.boards.find((b) => b.id === st.activeId);
      const alt = board?.nodes.find((n) => n.id === id);
      if (!board || !alt) return;
      get().pushHistory();
      const ziel = neueId ?? id;
      const breite = typeof alt.width === 'number' ? alt.width : alt.measured?.width;
      const rahmen = (alt.data as { rahmen?: boolean }).rahmen === true;
      // M463: ein ersetztes Bild ist eine inhaltliche Änderung – stempeln wie updateNodeData (M453)
      const neu = zeitNachPatch({
        ...alt, id: ziel, data: { ...alt.data, ...patch },
        // rahmenlos IST die Karte das Bild — ihre Höhe folgt dem neuen Seitenverhältnis
        ...(!rahmen && breite && verhaeltnis > 0 ? { height: Math.max(8, Math.round(breite * verhaeltnis)) } : {}),
      } as AppNode, alt, patch as Record<string, unknown>);
      const um = (k: string) => (k === id ? ziel : k);
      set({
        boards: get().boards.map((b) => {
          // Tickets anderer Boards können auf die Karte zeigen
          const tickets = (n: AppNode): AppNode => {
            if (ziel === id || n.type !== 'kanban') return n;
            const items = (n.data as { items?: Array<{ link?: { boardId: string; nodeId?: string }; links?: Array<{ boardId: string; nodeId: string }> }> }).items;
            if (!items?.some((i) => (i.link?.boardId === board.id && i.link.nodeId === id) || i.links?.some((l) => l.boardId === board.id && l.nodeId === id))) return n;
            return { ...n, data: { ...n.data, items: items.map((i) => ({
              ...i,
              ...(i.link?.boardId === board.id && i.link.nodeId === id ? { link: { ...i.link, nodeId: ziel } } : {}),
              ...(i.links ? { links: i.links.map((l) => (l.boardId === board.id && l.nodeId === id ? { ...l, nodeId: ziel } : l)) } : {}),
            })) } } as AppNode;
          };
          if (b.id !== board.id) {
            if (ziel === id) return b;
            const nodes = b.nodes.map(tickets);
            return nodes.some((n, i) => n !== b.nodes[i]) ? { ...b, nodes } : b;
          }
          return {
            ...b,
            nodes: b.nodes.map((n) => (n.id === id ? neu : tickets(n.parentId === id ? ({ ...n, parentId: ziel } as AppNode) : n))),
            ...(ziel === id ? {} : {
              edges: b.edges.map((e) => (e.source === id || e.target === id ? { ...e, source: um(e.source), target: um(e.target) } : e)),
              drawings: (b.drawings ?? []).map((d) => (d.anchor === id ? { ...d, anchor: ziel } : d)),
              comments: (b.comments ?? []).map((c) => (c.nodeId === id ? { ...c, nodeId: ziel } : c)),
            }),
          };
        }),
        ...(ziel !== id && get().focusCard === id ? { focusCard: ziel } : {}),
      });
    },

    addStrokeFertig: (stroke) => {
      if (!stroke.anchor || stroke.points.length === 0) return;
      get().pushHistory();
      patchActive((b) => ({ drawings: [...(b.drawings ?? []), stroke] }));
    },

    eraseStrokesById: (ids) => {
      const idSet = new Set(ids);
      const board = get().boards.find((b) => b.id === get().activeId);
      if (!board || !(board.drawings ?? []).some((s) => idSet.has(s.id))) return;
      if (eraseSnapPending) { get().pushHistory(); eraseSnapPending = false; }
      patchActive((b) => ({ drawings: (b.drawings ?? []).filter((s) => !idSet.has(s.id)) }));
    },

    removeStrokes: (ids) => {
      const idSet = new Set(ids);
      const board = get().boards.find((b) => b.id === get().activeId);
      if (!board || !(board.drawings ?? []).some((s) => idSet.has(s.id))) return;
      get().pushHistory();
      patchActive((b) => ({ drawings: (b.drawings ?? []).filter((s) => !idSet.has(s.id)) }));
    },

    beginEraseGesture: () => { eraseSnapPending = true; },

    eraseStrokesPartial: (x, y, radius) => {
      const board = get().boards.find((b) => b.id === get().activeId);
      if (!board) return;
      const offsetOf = versatzVon(board.nodes, get().showArchived);
      let geaendert = false;
      const neu: Stroke[] = [];
      for (const s of board.drawings ?? []) {
        const o = offsetOf(s);
        if (!o) { neu.push(s); continue; }
        const rel = strichRelativ(s); // M335: Seitenstriche umgerechnet, verdeckte leer
        const drin = radiert(rel, o[0], o[1], x, y, radius);
        if (!drin.some(Boolean)) { neu.push(s); continue; }
        geaendert = true;
        // Eingerastete Formen (wenige Punkte) verschwinden ganz — ein halbes Rechteck will niemand
        if (s.points.length <= 6) continue;
        let seg: number[] = [];
        const ablegen = () => {
          if (seg.length >= 2) {
            neu.push({ ...s, id: uid(), points: seg.map((i) => s.points[i]), druck: s.druck ? seg.map((i) => s.druck![i]) : undefined });
          }
          seg = [];
        };
        drin.forEach((d, i) => { if (d) ablegen(); else seg.push(i); });
        ablegen();
      }
      if (!geaendert) return;
      if (eraseSnapPending) { get().pushHistory(); eraseSnapPending = false; }
      patchActive(() => ({ drawings: neu }));
    },

    eraseStrokesNear: (x, y, radius) => {
      const board = get().boards.find((b) => b.id === get().activeId);
      if (!board) return;
      // Geankerte Striche liegen relativ zur Karte — für den Treffer-Test
      // ihren Versatz auflösen; unsichtbare (Karte archiviert/weg) schonen
      const offsetOf = versatzVon(board.nodes, get().showArchived);
      const near = (s: Stroke) => {
        const o = offsetOf(s);
        return !!o && radiert(strichRelativ(s), o[0], o[1], x, y, radius).some(Boolean);
      };
      if (!(board.drawings ?? []).some(near)) return;
      // pro Radier-Geste genau EIN History-Eintrag (beim ersten Treffer)
      if (eraseSnapPending) { get().pushHistory(); eraseSnapPending = false; }
      patchActive((b) => ({ drawings: (b.drawings ?? []).filter((s) => !near(s)) }));
    },

    // M521: selten gebraucht (Kartenmenü „Markierungen lösen") — der Teil kommt erst mit dem Aufruf, nicht mit dem
    // Start (Start-JS, M446). Die Auswahl-Leiste holt ihn beim eigenen Laden schon einmal, auch für offline.
    detachStrokes: (nodeIds) => { void import('./stricheLoesen').then((m) => m.stricheLoesen(get, patchActive, nodeIds)); },
  } satisfies Partial<BoardState>;
}
