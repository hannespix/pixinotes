/**
 * Struktur: Bereiche, Projekte und Boards anlegen, umbenennen, sortieren, verschieben, duplizieren, löschen
 * (mit Rückgängig, M398), Stände einsetzen, Karten zurückholen, archivieren.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import type { Edge } from '@xyflow/react';
import { uid, type AppNode } from '../types';
import { t, zahlWort } from '../lib/sprache';
import { linksUmbenennen, normalizeName } from '../lib/links';
import type { Stroke, BoardDoc, Project, EbeneLoeschen, Space, BoardState, Setzen, Holen } from './typen';
import { HISTORY_LIMIT, mutedHistory, tippBuendelEnde, NOTIZ_EXTERN } from './verlauf';
import { nextName, defaultHierarchy, START_BOARD_NAME, ohneVorsatz, istStartName, leererStart, leeresStartboard, ohneStartboard } from './start';
import { anhaengeMitnehmen } from './karten';

/** M398: Stand vor dem letzten Löschen eines Projekts oder Bereichs – wie der Import nur für die laufende Sitzung */
let ebenenUndo: {
  art: 'projekt' | 'bereich';
  bereich: Space; bereichIndex: number;
  projekt?: Project; projektIndex?: number;
  /** die gelöschten Boards mit ihrer Stelle in der Liste (Reihenfolge des Anlegens) */
  boards: Array<{ board: BoardDoc; index: number }>;
  activeId: string;
  /** dabei von selbst angelegt, weil sonst nichts Sichtbares geblieben wäre */
  neuesBoard?: string; neuesProjekt?: string;
} | null = null;
/** M530: Das letzte Gelöschte war ein Board — „Rückgängig" in der Meldung holt es zurück (store/boardZurueck.ts) */
let boardWeg = false;

/** M480: Teil des Board-Speichers – Struktur */
export function strukturScheibe(set: Setzen, get: Holen) {
  /**
   * M310: Projekte mit automatischer Reihenfolge sortieren — alphabetisch
   * nach Name (deutsch, Zahlen natürlich) oder in der Reihenfolge des
   * Anlegens (die Stellung im Board-Stand: addBoard und duplizieren hängen
   * hinten an). Manuelle Projekte bleiben unberührt; unveränderte Projekte
   * behalten ihre Objekt-Identität, damit nichts umsonst neu rendert.
   * Wird überall angewandt, wo sich Boards oder Namen ändern — so stimmt
   * die Reihenfolge in Baum, Reitern, Übersicht und Netz von selbst.
   */
  const sortiereProjekte = (spaces: Space[], boards: BoardDoc[]): Space[] => {
    const name = new Map(boards.map((b) => [b.id, b.name]));
    const stelle = new Map(boards.map((b, i) => [b.id, i]));
    let geaendert = false;
    const out = spaces.map((sp) => {
      const projects = sp.projects.map((p) => {
        if (!p.sortierung || p.sortierung === 'manuell') return p;
        const ids = [...p.boardIds];
        if (p.sortierung === 'alphabetisch') {
          ids.sort((a, b) => (name.get(a) ?? '').localeCompare(name.get(b) ?? '', 'de', { numeric: true, sensitivity: 'base' }));
        } else {
          ids.sort((a, b) => (stelle.get(a) ?? 0) - (stelle.get(b) ?? 0));
        }
        if (ids.every((id, i) => id === p.boardIds[i])) return p;
        geaendert = true;
        return { ...p, boardIds: ids };
      });
      return projects.some((p, i) => p !== sp.projects[i]) ? { ...sp, projects } : sp;
    });
    return geaendert ? out : spaces;
  };

  /** Board-ID aus allen Projekten entfernen (Hilfsfunktion für move/delete) */
  /**
   * M398: Ein Projekt oder einen Bereich löschen – auch mit Inhalt. Vorher ging das nur leer: Wer aufräumen
   * wollte, musste jedes Board einzeln öffnen und löschen. Jetzt entscheidet `mit`, was mit den Boards
   * geschieht (löschen oder umziehen); der Stand davor bleibt für „Rückgängig" in der Meldung liegen.
   * Boards, die einem anderen Konto gehören, werden nie gelöscht – sie ziehen in ein verbleibendes Projekt.
   */
  const ebeneLoeschen = (art: 'projekt' | 'bereich', id: string, mit?: EbeneLoeschen): void => {
    const s0 = get();
    const bereich = art === 'bereich' ? s0.spaces.find((sp) => sp.id === id) : s0.spaces.find((sp) => sp.projects.some((p) => p.id === id));
    const projekt = art === 'projekt' ? bereich?.projects.find((p) => p.id === id) : undefined;
    if (!bereich || (art === 'projekt' && !projekt)) return;
    if (art === 'bereich' && s0.spaces.length <= 1) { s0.showToast('Der letzte Bereich bleibt bestehen'); return; }
    const name = art === 'bereich' ? bereich.name : projekt!.name;
    const ids = art === 'bereich' ? bereich.projects.flatMap((p) => p.boardIds) : projekt!.boardIds;
    if (ids.length > 0 && !mit) {
      s0.showToast(art === 'bereich' ? 'Bereich enthält noch Boards – erst verschieben oder löschen.' : 'Projekt enthält noch Boards – erst verschieben oder löschen.');
      return;
    }
    const bereichIndex = s0.spaces.indexOf(bereich);
    const projektIndex = projekt ? bereich.projects.indexOf(projekt) : undefined;
    let spaces = art === 'bereich'
      ? s0.spaces.filter((sp) => sp.id !== id)
      : s0.spaces.map((sp) => (sp === bereich ? { ...sp, projects: sp.projects.filter((p) => p.id !== id) } : sp));
    let boards = s0.boards;
    let activeId = s0.activeId;
    let neuesBoard: string | undefined; let neuesProjekt: string | undefined;
    let weg: Array<{ board: BoardDoc; index: number }> = [];
    let meldung = art === 'bereich' ? t(`Bereich „${name}" gelöscht.`) : t(`Projekt „${name}" gelöscht.`);
    /** ein Projekt, das Boards aufnehmen kann – notfalls wird „Allgemein" angelegt */
    const auffang = (): string => {
      const da = spaces.flatMap((sp) => sp.projects)[0];
      if (da) return da.id;
      neuesProjekt = uid();
      spaces = spaces.map((sp, i) => (i === 0 ? { ...sp, projects: [...sp.projects, { id: neuesProjekt!, name: t('Allgemein'), boardIds: [] }] } : sp));
      return neuesProjekt;
    };
    const hinein = (projektId: string, neue: string[]) => {
      spaces = spaces.map((sp) => ({ ...sp, projects: sp.projects.map((p) => (p.id === projektId ? { ...p, boardIds: [...p.boardIds, ...neue] } : p)) }));
    };
    if (ids.length > 0 && mit?.boards === 'behalten') {
      if (art === 'bereich') {
        const ziel = spaces.find((sp) => sp.id === mit.ziel);
        if (!ziel) return;
        spaces = spaces.map((sp) => (sp.id === mit.ziel ? { ...sp, projects: [...sp.projects, ...bereich.projects] } : sp));
        meldung = t(`Bereich „${name}" gelöscht – die Projekte liegen jetzt in „${ziel.name}".`);
      } else {
        const ziel = spaces.flatMap((sp) => sp.projects).find((p) => p.id === mit.ziel);
        if (!ziel) return;
        hinein(ziel.id, ids);
        spaces = sortiereProjekte(spaces, boards);
        meldung = t(`Projekt „${name}" gelöscht – die Boards liegen jetzt in „${ziel.name}".`);
      }
    } else if (ids.length > 0) {
      const betroffen = new Set(ids);
      const fremd = (b: BoardDoc) => !!(b.geteiltVon || b.gastLink);
      const bleiben = boards.filter((b) => betroffen.has(b.id) && fremd(b));
      weg = boards.map((board, index) => ({ board, index })).filter(({ board }) => betroffen.has(board.id) && !fremd(board));
      boards = boards.filter((b) => !betroffen.has(b.id) || fremd(b));
      if (bleiben.length) hinein(auffang(), bleiben.map((b) => b.id));
      // Ohne sichtbares Board gäbe es keine Arbeitsfläche mehr – dann liegt ein leeres bereit
      if (!boards.some((b) => !b.archived)) {
        neuesBoard = uid();
        boards = [...boards, { id: neuesBoard, name: t(START_BOARD_NAME), nodes: [], edges: [], drawings: [] }];
        hinein(auffang(), [neuesBoard]);
      }
      if (!boards.some((b) => b.id === activeId && !b.archived)) activeId = (boards.find((b) => !b.archived) ?? boards[0]).id;
      const n = weg.length;
      if (bleiben.length) {
        meldung = art === 'bereich'
          ? t(`Bereich „${name}" mit ${zahlWort(n, 'Board', 'Boards')} gelöscht – geteilte Boards anderer bleiben.`)
          : t(`Projekt „${name}" mit ${zahlWort(n, 'Board', 'Boards')} gelöscht – geteilte Boards anderer bleiben.`);
      } else {
        meldung = art === 'bereich' ? t(`Bereich „${name}" mit ${zahlWort(n, 'Board', 'Boards')} gelöscht.`) : t(`Projekt „${name}" mit ${zahlWort(n, 'Board', 'Boards')} gelöscht.`);
      }
    }
    ebenenUndo = { art, bereich, bereichIndex, projekt, projektIndex, boards: weg, activeId: s0.activeId, neuesBoard, neuesProjekt };
    boardWeg = false;
    mutedHistory(() => set({ boards, spaces, activeId }));
    get().showToast(meldung, 'ebene', 12000);
  };

  const stripBoardFromHierarchy = (spaces: Space[], boardId: string): Space[] =>
    spaces.map((sp) => ({
      ...sp,
      projects: sp.projects.map((p) => ({
        ...p,
        boardIds: p.boardIds.filter((id) => id !== boardId),
      })),
    }));

  // M370: Erststart mit EINEM leeren Board. (Bis M369 lag hier die Starter-Umgebung „Verwaltung" —
  // mehrere Bereiche, viele Boards; sie kommt jetzt nur noch auf Wunsch, siehe addStarter.) Wird bei
  // vorhandenem persistierten Stand vollständig überschrieben (rehydrate).
  const start = leererStart();

  return {
    boards: start.boards,
    spaces: start.spaces,
    activeId: start.activeId,
    setBoardBg: (id, bg) =>
      set({ boards: get().boards.map((b) => (b.id === id ? { ...b, bg } : b)) }),
    // M509: Look des Boards (beim Teilen mitgegeben) — wie der Hintergrund ein Feld des Boards, reist mit jedem Abgleich
    setBoardLook: (id, look) =>
      set({ boards: get().boards.map((b) => { if (b.id !== id) return b; const n = { ...b }; if (look) n.look = look; else delete n.look; return n; }) }),

    setView: (view) => set({ view }),

    openBoard: (id) => {
      // M523: Wer ein Board öffnet (Baum, Reiter, Suche, Alt+→), will es sehen — die Aufgaben-Zentrale blieb sonst davor stehen
      if (get().boards.some((b) => b.id === id)) set({ activeId: id, view: 'board', tasksOpen: false });
    },

    setSearchOpen: (open) => set({ searchOpen: open }),

    addSpace: (name) =>
      set({
        spaces: [
          ...get().spaces,
          { id: uid(), name: name ?? nextName(t('Neuer Bereich'), get().spaces.map((s) => s.name)), projects: [] },
        ],
      }),

    renameSpace: (id, name) =>
      set({ spaces: get().spaces.map((sp) => (sp.id === id ? { ...sp, name } : sp)) }),

    removeSpace: (id, mit) => ebeneLoeschen('bereich', id, mit),

    addProject: (spaceId, name) =>
      set({
        spaces: get().spaces.map((sp) =>
          sp.id === spaceId
            ? {
                ...sp,
                projects: [
                  ...sp.projects,
                  { id: uid(), name: name ?? nextName(t('Projekt'), sp.projects.map((p) => p.name)), boardIds: [] },
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

    removeProject: (id, mit) => ebeneLoeschen('projekt', id, mit),

    ebeneZurueck: () => {
      // M530: ein gelöschtes Board — der Weg zurück lädt nach (store/boardZurueck.ts)
      if (boardWeg) { boardWeg = false; void import('./boardZurueck').then((m) => m.boardZurueck(set, get)); return true; }
      const u = ebenenUndo;
      if (!u) return false;
      ebenenUndo = null;
      const s0 = get();
      let boards = s0.boards;
      // Das von selbst angelegte Startboard geht wieder, solange nichts darauf liegt
      const start = u.neuesBoard ? boards.find((b) => b.id === u.neuesBoard) : undefined;
      const startWeg = !!start && !start.nodes.length && !start.edges.length && !(start.drawings?.length);
      if (startWeg) boards = boards.filter((b) => b !== start);
      const da = new Set(boards.map((b) => b.id));
      boards = [...boards];
      for (const { board, index } of [...u.boards].sort((x, y) => x.index - y.index)) {
        if (!da.has(board.id)) boards.splice(Math.min(index, boards.length), 0, board);
      }
      // Was zur gelöschten Ebene gehörte, kommt aus den übrigen Projekten heraus – dann steht die Ebene wieder an ihrer Stelle
      const projekte = u.art === 'bereich' ? u.bereich.projects : [u.projekt!];
      const zurueck = new Set(projekte.flatMap((p) => p.boardIds));
      const projektIds = new Set(u.art === 'bereich' ? projekte.map((p) => p.id) : []);
      let spaces = s0.spaces.map((sp) => ({
        ...sp,
        projects: sp.projects
          .filter((p) => !projektIds.has(p.id))
          .map((p) => ({ ...p, boardIds: p.boardIds.filter((b) => !zurueck.has(b) && !(startWeg && b === u.neuesBoard)) }))
          .filter((p) => !(p.id === u.neuesProjekt && p.boardIds.length === 0)),
      }));
      if (u.art === 'bereich') {
        spaces.splice(Math.min(u.bereichIndex, spaces.length), 0, u.bereich);
      } else if (spaces.some((sp) => sp.id === u.bereich.id)) {
        spaces = spaces.map((sp) => {
          if (sp.id !== u.bereich.id) return sp;
          const projects = [...sp.projects];
          projects.splice(Math.min(u.projektIndex ?? projects.length, projects.length), 0, u.projekt!);
          return { ...sp, projects };
        });
      } else {
        spaces.splice(Math.min(u.bereichIndex, spaces.length), 0, { ...u.bereich, projects: [u.projekt!] });
      }
      const activeId = boards.some((b) => b.id === u.activeId) ? u.activeId
        : boards.some((b) => b.id === s0.activeId) ? s0.activeId : (boards.find((b) => !b.archived) ?? boards[0]).id;
      mutedHistory(() => set({ boards, spaces, activeId }));
      const name = u.art === 'bereich' ? u.bereich.name : u.projekt!.name;
      get().showToast(`„${name}" ist wieder da.`);
      return true;
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
                  ? { ...sp, projects: [{ id: pid, name: t('Allgemein'), boardIds: [] }] }
                  : sp,
              )
            : defaultHierarchy([]);
          target = newSpaces[0].projects[0]?.id ?? pid;
        }
      }
      const boards = [...get().boards, { id, name: name ?? nextName('Board', get().boards.map((b) => b.name)), nodes: [], edges: [] }];
      set({
        boards,
        spaces: sortiereProjekte(newSpaces.map((sp) => ({
          ...sp,
          projects: sp.projects.map((p) =>
            p.id === target ? { ...p, boardIds: [...p.boardIds, id] } : p,
          ),
        })), boards),
        activeId: id,
      });
      return id;
    },

    boardAusVorlage: (name, inhalt, wohin) => {
      const ziel = wohin?.inBoard ? get().boards.find((x) => x.id === wohin.inBoard) : undefined;
      const leer = !!ziel && !ziel.nodes.length && !ziel.edges.length && ziel.geteiltRolle !== 'lesen';
      let id: string;
      if (ziel && leer) {
        id = ziel.id;
        if (get().activeId !== id) set({ activeId: id });
        get().pushHistory();
        // Ein Board, das noch seinen Anfangsnamen trägt, heißt danach wie die Vorlage
        const unbenannt = istStartName(ziel.name) || /^Board( \d+)?$/.test(ohneVorsatz(ziel.name));
        const neuerName = unbenannt ? nextName(name, get().boards.map((x) => x.name)) : ziel.name;
        set({ boards: get().boards.map((x) => (x.id === id ? { ...x, name: neuerName, nodes: inhalt.nodes, edges: inhalt.edges } : x)) });
      } else {
        id = get().addBoard(nextName(name, get().boards.map((x) => x.name)), wohin?.projectId);
        set({ boards: get().boards.map((x) => (x.id === id ? { ...x, nodes: inhalt.nodes, edges: inhalt.edges } : x)) });
      }
      // Voll-Remount: Notizen lesen ihren Inhalt nur beim Mount
      set({ activeId: id, view: 'board', importEpoch: get().importEpoch + 1 });
      return id;
    },

    importBoard: (doc) => {
      // M370: Wer nichts Eigenes hat, sieht danach nur das Board, das er geöffnet hat
      const start = leeresStartboard(get().boards);
      // leeres Board über addBoard anlegen (kümmert sich um die Hierarchie) …
      const id = get().addBoard(doc.name);
      // … und mit dem geteilten Inhalt füllen
      const boards = get().boards.map((b) =>
        // M388: Kommentare und Hintergrund kamen nie an, obwohl cloneSharedBoard sie vorbereitet
        b.id === id ? { ...b, nodes: doc.nodes, edges: doc.edges, drawings: doc.drawings, ...(doc.comments?.length ? { comments: doc.comments } : {}), ...(doc.bg ? { bg: doc.bg } : {}) } : b,
      );
      set({
        ...(start ? ohneStartboard({ boards, spaces: get().spaces }, start.id) : { boards }),
        activeId: id,
        view: 'board',
      });
    },

    renameBoard: (id, name) => {
      // M390: [[Verknüpfungen]] gehen über den NAMEN. Nach dem Umbenennen zeigten sie ins Leere — der Klick legte
      // ein leeres Board mit dem alten Namen an. Die Texte ziehen jetzt mit, solange der alte Name eindeutig war.
      const alt = get().boards.find((b) => b.id === id)?.name ?? '';
      const eindeutig = !!alt && normalizeName(alt) !== normalizeName(name)
        && get().boards.filter((b) => normalizeName(b.name) === normalizeName(alt)).length === 1;
      const boards = get().boards.map((b) => {
        if (b.id === id) return { ...b, name };
        if (!eindeutig || b.geteiltVon) return b;
        let anders = false;
        const nodes = b.nodes.map((n) => {
          if (n.type !== 'note') return n;
          const neu = linksUmbenennen((n.data as { blocks?: unknown }).blocks, alt, name);
          if (!neu) return n;
          anders = true;
          return { ...n, data: { ...n.data, blocks: neu, extEpoch: (((n.data as { extEpoch?: number }).extEpoch) ?? 0) + 1 } } as AppNode;
        });
        return anders ? { ...b, nodes } : b;
      }).map((b) => {
        // … auch im umbenannten Board selbst (Notizen, die auf ihr eigenes Board zeigen)
        if (b.id !== id || !eindeutig) return b;
        let anders = false;
        const nodes = b.nodes.map((n) => {
          if (n.type !== 'note') return n;
          const neu = linksUmbenennen((n.data as { blocks?: unknown }).blocks, alt, name);
          if (!neu) return n;
          anders = true;
          return { ...n, data: { ...n.data, blocks: neu, extEpoch: (((n.data as { extEpoch?: number }).extEpoch) ?? 0) + 1 } } as AppNode;
        });
        return anders ? { ...b, nodes } : b;
      });
      // M310: Ein alphabetisch sortiertes Projekt rückt das Board an seinen neuen Platz
      set({ boards, spaces: sortiereProjekte(get().spaces, boards) });
    },

    // M530: nachgeladen, mit „Rückgängig" in der Meldung (store/boardZurueck.ts) — wie Bereich und Projekt
    removeBoard: (id) => { boardWeg = true; ebenenUndo = null; void import('./boardZurueck').then((m) => m.boardLoeschen(id, set, get)); },

    moveBoard: (boardId, targetProjectId, beforeBoardId) => {
      // Geister-Boards verhindern: Ziel muss existieren, sonst no-op
      const targetExists = get().spaces.some((sp) => sp.projects.some((p) => p.id === targetProjectId));
      if (!targetExists) return;
      const stripped = stripBoardFromHierarchy(get().spaces, boardId);
      set({
        spaces: sortiereProjekte(stripped.map((sp) => ({
          ...sp,
          projects: sp.projects.map((p) => {
            if (p.id !== targetProjectId) return p;
            const ids = [...p.boardIds];
            const at = beforeBoardId ? ids.indexOf(beforeBoardId) : -1;
            if (at >= 0) ids.splice(at, 0, boardId);
            else ids.push(boardId);
            return { ...p, boardIds: ids };
          }),
        })), get().boards),
      });
    },

    setProjektSortierung: (projectId, art) => {
      const spaces = get().spaces.map((sp) => ({
        ...sp,
        projects: sp.projects.map((p) => (p.id === projectId
          ? { ...p, sortierung: art === 'manuell' ? undefined : art }
          : p)),
      }));
      set({ spaces: sortiereProjekte(spaces, get().boards) });
    },

    duplicateBoard: (boardId) => {
      const st = get();
      const quelle = st.boards.find((b) => b.id === boardId);
      if (!quelle) return;
      const neueId = () => Math.random().toString(36).slice(2, 10);
      /* Kennungen neu vergeben und die Pfeile mitziehen — sonst zeigten
         die Verbindungen der Kopie auf die Karten des Originals. */
      const karte = new Map(quelle.nodes.map((n) => [n.id, neueId()]));
      const nodes = quelle.nodes.map((n) => ({
        ...JSON.parse(JSON.stringify(n)),
        id: karte.get(n.id) as string,
        selected: false,
      }));
      const edges = (quelle.edges ?? [])
        .filter((e) => karte.has(e.source) && karte.has(e.target))
        .map((e) => ({
          ...e,
          id: neueId(),
          source: karte.get(e.source) as string,
          target: karte.get(e.target) as string,
        }));
      const drawings = (quelle.drawings ?? []).map((d) => ({
        ...JSON.parse(JSON.stringify(d)),
        id: neueId(),
        anchor: d.anchor ? karte.get(d.anchor) : undefined,
      }));
      // M360: Die Kopie eines geteilten Boards gehört mir — ohne Besitzer-Kennung und ohne Leseschutz
      const { geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, ...eigen } = quelle;
      const kopie = {
        ...eigen, id: neueId(), name: `${quelle.name} (Kopie)`,
        nodes, edges, drawings, comments: [],
      };
      const boards = [...st.boards, kopie];
      anhaengeMitnehmen(quelle.nodes, karte);
      // M360: Die Kopie eines fremden Boards gehört nicht unter „Geteilt mit mir" — sie kommt ins erste eigene Projekt und geht auf
      const eigenes = quelle.geteiltVon ? st.spaces.filter((sp) => sp.id !== 'geteilt').flatMap((sp) => sp.projects)[0] : undefined;
      set({
        boards,
        spaces: sortiereProjekte(st.spaces.map((sp) => ({
          ...sp,
          projects: sp.projects.map((p) => (eigenes
            ? (p.id === eigenes.id ? { ...p, boardIds: [...p.boardIds, kopie.id] } : p)
            : p.boardIds.includes(boardId)
              ? { ...p, boardIds: p.boardIds.flatMap((id) => (id === boardId ? [id, kopie.id] : [id])) }
              : p)),
        })), boards),
      });
      if (eigenes) {
        get().openBoard(kopie.id);
        get().showToast(`Kopie von „${quelle.name}" angelegt – sie gehört dir und liegt in „${eigenes.name}".`, false, 6000);
        return;
      }
      get().showToast(`Board „${quelle.name}" kopiert – die Kopie liegt daneben.`);
    },

    standEinsetzen: (boardId, stand, alsKopie) => {
      const st = get();
      const quelle = st.boards.find((b) => b.id === boardId);
      if (!quelle || !Array.isArray(stand?.nodes) || !Array.isArray(stand?.edges)) return null;
      if (alsKopie === undefined) {
        if (quelle.geteiltRolle === 'lesen') { st.showToast('Dieses Board ist nur zum Lesen freigegeben – als Kopie öffnen geht.'); return null; }
        tippBuendelEnde();
        set({
          activeId: boardId,
          view: 'board',
          lastDeleted: null,
          past: [...st.past.slice(-(HISTORY_LIMIT - 1)), {
            boardId, nodes: quelle.nodes, edges: quelle.edges, drawings: quelle.drawings, comments: quelle.comments, remount: true,
          }],
          future: [],
          boards: st.boards.map((b) => (b.id === boardId
            ? { ...b, nodes: stand.nodes, edges: stand.edges, drawings: stand.drawings ?? [], comments: stand.comments ?? b.comments }
            : b)),
          // Notiz-Editoren lesen ihren Text nur beim Aufbau — sonst zeigten sie den alten Inhalt
          importEpoch: st.importEpoch + 1,
        });
        return boardId;
      }
      // Als Kopie: frische Kennungen (wie duplicateBoard), Pfeile, Rahmen-Kinder und Striche ziehen mit
      const karte = new Map(stand.nodes.map((n) => [n.id, uid()]));
      const nodes = stand.nodes.map((n) => {
        const k = { ...JSON.parse(JSON.stringify(n)), id: karte.get(n.id) as string, selected: false } as AppNode;
        if (n.parentId && karte.has(n.parentId)) (k as { parentId?: string }).parentId = karte.get(n.parentId);
        return k;
      });
      const edges = stand.edges.filter((e) => karte.has(e.source) && karte.has(e.target))
        .map((e) => ({ ...e, id: uid(), source: karte.get(e.source) as string, target: karte.get(e.target) as string, selected: false }));
      const drawings = (stand.drawings ?? []).map((d) => ({ ...JSON.parse(JSON.stringify(d)), id: uid(), anchor: d.anchor ? karte.get(d.anchor) : undefined }));
      const { geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, archived: _a, ...eigen } = quelle;
      const kopie: BoardDoc = { ...eigen, id: uid(), name: alsKopie.slice(0, 80) || `${quelle.name} (Stand)`, nodes, edges, drawings, comments: [] };
      anhaengeMitnehmen(stand.nodes, karte);
      const boards = [...st.boards, kopie];
      const eigenes = quelle.geteiltVon ? st.spaces.filter((sp) => sp.id !== 'geteilt').flatMap((sp) => sp.projects)[0] : undefined;
      set({
        boards,
        spaces: sortiereProjekte(st.spaces.map((sp) => ({
          ...sp,
          projects: sp.projects.map((p) => (eigenes
            ? (p.id === eigenes.id ? { ...p, boardIds: [...p.boardIds, kopie.id] } : p)
            : p.boardIds.includes(boardId)
              ? { ...p, boardIds: p.boardIds.flatMap((id) => (id === boardId ? [id, kopie.id] : [id])) }
              : p)),
        })), boards),
      });
      get().openBoard(kopie.id);
      return kopie.id;
    },
    kartenZurueckholen: (boardId, ids, stand, extra) => {
      const st = get();
      const quelle = st.boards.find((b) => b.id === boardId);
      const nichts = { karten: 0, pfeile: 0, striche: 0 };
      const pfeilIds = extra?.pfeile ?? [];
      const strichIds = extra?.striche ?? [];
      if (!quelle || !Array.isArray(stand?.nodes) || !(ids.length || pfeilIds.length || strichIds.length)) return nichts;
      if (quelle.geteiltRolle === 'lesen') { st.showToast('Dieses Board ist nur zum Lesen freigegeben – als Kopie öffnen geht.'); return nichts; }
      const dann = new Map(stand.nodes.map((n) => [n.id, n]));
      const jetzt = new Map(quelle.nodes.map((n) => [n.id, n]));
      const zeit = Date.now();
      /** Lage auf der Fläche, falls der Rahmen von damals nicht mehr da ist */
      const absolut = (n: AppNode, tiefe = 0): { x: number; y: number } => {
        const p = n.parentId ? dann.get(n.parentId) : undefined;
        if (!p || tiefe > 8) return n.position;
        const o = absolut(p, tiefe + 1);
        return { x: o.x + n.position.x, y: o.y + n.position.y };
      };
      const geholt = new Map<string, AppNode>();
      for (const id of ids) {
        const alt = dann.get(id);
        if (!alt) continue;
        const hier = jetzt.get(id);
        let k = { ...(JSON.parse(JSON.stringify(alt)) as AppNode), selected: false } as AppNode;
        if (hier) {
          // Geändert: nur der Inhalt kommt zurück — Lage, Größe und Rahmen bleiben, wie sie jetzt sind
          k = { ...hier, data: k.data, selected: false } as AppNode;
        } else if (k.parentId && !jetzt.has(k.parentId)) {
          const { parentId: _p, extent: _e, ...frei } = k as AppNode & { extent?: unknown };
          k = { ...frei, position: absolut(alt) } as AppNode;
        }
        // Zurückholen ist eine Änderung von Hand (M453): jetzt geändert, angelegt bleibt
        geholt.set(id, { ...k, geaendert: zeit } as AppNode);
      }
      const nodes = quelle.nodes.map((n) => geholt.get(n.id) ?? n);
      for (const [id, k] of geholt) if (!jetzt.has(id)) nodes.push(k);
      // Verbindungen gelöschter Karten, deren anderes Ende es noch (oder wieder) gibt
      const da = new Set(nodes.map((n) => n.id));
      const kanten = new Set(quelle.edges.map((e) => e.id));
      let edges = [...quelle.edges, ...(stand.edges ?? []).filter((e) => !kanten.has(e.id)
        && (geholt.has(e.source) || geholt.has(e.target)) && da.has(e.source) && da.has(e.target)).map((e) => ({ ...e, selected: false }))];
      // M470: einzeln gewählte Verbindungen — nur, wenn beide Karten da sind (oder eben mit zurückkamen)
      let pfeile = 0;
      const altPfeile = new Map((stand.edges ?? []).map((e) => [e.id, e]));
      for (const id of new Set(pfeilIds)) {
        const e = altPfeile.get(id);
        if (!e || !da.has(e.source) || !da.has(e.target)) continue;
        const kopie = { ...(JSON.parse(JSON.stringify(e)) as Edge), selected: false };
        edges = edges.some((x) => x.id === id) ? edges.map((x) => (x.id === id ? kopie : x)) : [...edges, kopie];
        pfeile += 1;
      }
      // M470: einzeln gewählte Striche — ein an eine Karte geankerter nur, wenn die Karte da ist
      let striche = 0;
      let drawings = quelle.drawings;
      const altStriche = new Map((stand.drawings ?? []).map((d) => [d.id, d]));
      for (const id of new Set(strichIds)) {
        const d = altStriche.get(id);
        if (!d || (d.anchor && !da.has(d.anchor))) continue;
        const kopie = JSON.parse(JSON.stringify(d)) as Stroke;
        const liste = drawings ?? [];
        drawings = liste.some((x) => x.id === id) ? liste.map((x) => (x.id === id ? kopie : x)) : [...liste, kopie];
        striche += 1;
      }
      if (!geholt.size && !pfeile && !striche) return nichts;
      tippBuendelEnde();
      set({
        activeId: boardId,
        view: 'board',
        lastDeleted: null,
        past: [...st.past.slice(-(HISTORY_LIMIT - 1)), {
          boardId, nodes: quelle.nodes, edges: quelle.edges, drawings: quelle.drawings, comments: quelle.comments,
        }],
        future: [],
        boards: st.boards.map((b) => (b.id === boardId ? { ...b, nodes, edges, ...(drawings !== quelle.drawings ? { drawings } : {}) } : b)),
      });
      // Notiz-Editoren lesen ihren Text nur beim Aufbau — die geänderten frischen sich an Ort und Stelle auf
      const notizen = [...geholt.values()].filter((n) => n.type === 'note' && jetzt.has(n.id)).map((n) => n.id);
      if (notizen.length) window.dispatchEvent(new CustomEvent(NOTIZ_EXTERN, { detail: notizen }));
      return { karten: geholt.size, pfeile, striche };
    },
    duplicateProject: (projectId) => {
      const st = get();
      const raum = st.spaces.find((sp) => sp.projects.some((p) => p.id === projectId));
      const projekt = raum?.projects.find((p) => p.id === projectId);
      if (!raum || !projekt) return;
      const neueId = () => Math.random().toString(36).slice(2, 10);
      const neueBoards: BoardDoc[] = [];
      const ids: string[] = [];
      const boardKarte = new Map<string, string>();   // M390: Original-Board → Kopie (für die Portale)
      for (const bid of projekt.boardIds) {
        const quelle = st.boards.find((b) => b.id === bid);
        if (!quelle) continue;
        const karte = new Map(quelle.nodes.map((n) => [n.id, neueId()]));
        const { geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, ...eigen } = quelle; // M360: Kopien gehören mir
        const kopie: BoardDoc = {
          ...eigen, id: neueId(), name: quelle.name,
          nodes: quelle.nodes.map((n) => ({ ...JSON.parse(JSON.stringify(n)), id: karte.get(n.id) as string, selected: false })),
          edges: (quelle.edges ?? [])
            .filter((e) => karte.has(e.source) && karte.has(e.target))
            .map((e) => ({ ...e, id: neueId(), source: karte.get(e.source) as string, target: karte.get(e.target) as string })),
          drawings: (quelle.drawings ?? []).map((d) => ({ ...JSON.parse(JSON.stringify(d)), id: neueId(), anchor: d.anchor ? karte.get(d.anchor) : undefined })),
          comments: [],
        };
        neueBoards.push(kopie);
        ids.push(kopie.id);
        boardKarte.set(quelle.id, kopie.id);
        anhaengeMitnehmen(quelle.nodes, karte);
      }
      // M390: Portale ZWISCHEN den kopierten Boards zeigen auf die Kopien. Vorher führte das Portal in der Kopie
      // von „Planung" ins ORIGINAL-„Ziel" — wer in der Kopie weiterarbeitete, landete unbemerkt im alten Projekt.
      for (const b of neueBoards) {
        b.nodes = b.nodes.map((n) => {
          const z = (n.data as { boardId?: string }).boardId;
          return n.type === 'portal' && z && boardKarte.has(z) ? ({ ...n, data: { ...n.data, boardId: boardKarte.get(z) } } as AppNode) : n;
        });
      }
      set({
        boards: [...st.boards, ...neueBoards],
        spaces: st.spaces.map((sp) => (sp.id === raum.id
          ? {
            ...sp,
            projects: sp.projects.flatMap((p) => (p.id === projectId
              ? [p, { id: neueId(), name: `${p.name} (Kopie)`, boardIds: ids, sortierung: p.sortierung }]
              : [p])),
          }
          : sp)),
      });
      get().showToast(`Projekt „${projekt.name}" mit ${zahlWort(ids.length, 'Board', 'Boards')} kopiert.`);
    },

    archiveBoard: (boardId, an = true) => {
      const st = get();
      const board = st.boards.find((b) => b.id === boardId);
      if (!board) return;
      const boards = st.boards.map((b) => (b.id === boardId ? { ...b, archived: an } : b));
      /* Beim Archivieren des aktiven Boards weiterziehen — bevorzugt ins
         gleiche Projekt, sonst irgendein sichtbares Board. */
      let activeId = st.activeId;
      if (an && st.activeId === boardId) {
        const projekt = st.spaces.flatMap((sp) => sp.projects).find((p) => p.boardIds.includes(boardId));
        const nachbar = projekt?.boardIds.find((id) => id !== boardId && boards.some((b) => b.id === id && !b.archived))
          ?? boards.find((b) => b.id !== boardId && !b.archived)?.id;
        if (nachbar) activeId = nachbar;
        else {
          // Das LETZTE sichtbare Board bleibt sichtbar — sonst stünde die
          // Anwendung ohne Arbeitsfläche da (dieselbe Regel wie beim Löschen)
          get().showToast('Das letzte Board bleibt offen');
          return;
        }
      }
      set({ boards, activeId });
      get().showToast(an
        ? `Board „${board.name}" archiviert. Wiederfinden: Mehr → „Archiv einblenden".`
        : `Board „${board.name}" zurückgeholt.`);
    },
  } satisfies Partial<BoardState>;
}
