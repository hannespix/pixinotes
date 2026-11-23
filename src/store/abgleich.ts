/**
 * Abgleich und Import: Beispiele (addStarter), Struktur-Import (OneNote, M184), Zurücksetzen, importSync
 * (Ordner, WebDAV, Konto, Gruppe) und importProject.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import { buildStarter } from '../lib/starter';
import { uid } from '../types';
import type { BoardDoc, HistoryEntry, Project, Space, BoardState, Setzen, Holen } from './typen';
import { ohneLeseschutz, vorUmbauHaken, FREMD_SCHUB_AB, kartenSchub } from './schutz';
import { geaenderteIds, schritteAbgrenzen, geaenderteNotizen, fremdeNotizenMerken, NOTIZ_EXTERN } from './verlauf';
import { claimWriter, markImported } from './speicher';
import { leererStart, leeresStartboard } from './start';

/** M184: Stand vor dem letzten Struktur-Import (OneNote) — bewusst außerhalb
 *  des persistierten States: Ein Rückgängig gilt nur für die laufende Sitzung
 *  und soll nicht als riesiger Zweitstand mitgespeichert werden. */
let importUndo: { boards: BoardDoc[]; spaces: Space[]; activeId: string } | null = null;

/** M480: Teil des Board-Speichers – Abgleich und Import */
export function abgleichScheibe(set: Setzen, get: Holen) {
  return {
    addStarter: () => {
      const fresh = buildStarter();
      // M370: Steht nur das unberührte Startboard da, ersetzen die Beispiele es samt seinem leeren Bereich
      const nurStart = !!leeresStartboard(get().boards) && get().spaces.length === 1 && get().spaces[0].projects.length === 1;
      set({
        boards: [...(nurStart ? [] : get().boards), ...fresh.boards],
        spaces: [...(nurStart ? [] : get().spaces), ...fresh.spaces],
        activeId: fresh.firstBoardId,
        view: 'overview',
        // Voll-Remount: neue Boards mit BlockNote-Inhalten sauber mounten
        importEpoch: get().importEpoch + 1,
      });
      get().showToast(`Beispiele geladen: ${fresh.spaces.length} Bereiche, ${fresh.boards.length} Boards zum Ausprobieren.`);
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
      /* M388: Zurückgenommen wird der IMPORT — was er an Boards, Bereichen und Projekten gebracht hat. Vorher
         wurde der ganze Stand von davor zurückgelegt: Alles, was man seit dem Import auf seinen übrigen Boards
         gearbeitet hatte, war weg (der Knopf steht die ganze Sitzung lang da). */
      const st = get();
      const vorher = new Set(snap.boards.map((b) => b.id));
      const boards = st.boards.filter((b) => vorher.has(b.id));
      if (boards.length === 0) {
        set({ boards: snap.boards, spaces: snap.spaces, activeId: snap.activeId, canUndoImport: false, importEpoch: st.importEpoch + 1 });
        return true;
      }
      const bleibt = new Set(boards.map((b) => b.id));
      const raeume = new Set(snap.spaces.map((sp) => sp.id));
      const projekte = new Set(snap.spaces.flatMap((sp) => sp.projects.map((pr) => pr.id)));
      const spaces = st.spaces.filter((sp) => raeume.has(sp.id)).map((sp) => ({
        ...sp,
        projects: sp.projects.filter((pr) => projekte.has(pr.id)).map((pr) => ({ ...pr, boardIds: pr.boardIds.filter((id) => bleibt.has(id)) })),
      }));
      set({
        boards,
        spaces,
        activeId: bleibt.has(st.activeId) ? st.activeId : bleibt.has(snap.activeId) ? snap.activeId : boards[0].id,
        canUndoImport: false,
        importEpoch: st.importEpoch + 1,
      });
      return true;
    },

    canUndoImport: false,

    resetAll: () => {
      importUndo = null;   // M388: „Import zurücknehmen" darf nach „Alles leeren" nichts wiederbeleben
      // Bewusst KEIN Undo: das ist der „frischer Start"-Schalter.
      // KI-Einstellungen bleiben erhalten (nur Inhalte werden geleert).
      claimWriter(); // bewusste Aktion — auch aus einem Mitlese-Fenster wirksam
      set({
        ...leererStart(),
        canUndoImport: false,
        view: 'board',
        past: [],
        future: [],
        lastDeleted: null,
        pendingFocus: null,
        templates: [],
        importEpoch: get().importEpoch + 1,
      });
      get().showToast('Alles geleert – frischer Start. Beispiele gibt es jederzeit unter ＋ Neu.');
    },

    importEpoch: 0,

    importSync: (boards, spaces, activeId, sanft) => ohneLeseschutz(() => {
      if (!Array.isArray(boards) || boards.length === 0 || !Array.isArray(spaces)) return;
      // Auto-Sync-Bremse: dieser Stand kam von außen — nicht gleich wieder
      // mit neuem Zeitstempel hochladen (falsche Konflikte auf anderen Geräten)
      markImported(boards, spaces);
      fremdeNotizenMerken(get().boards, boards);
      // M449: Was gleich überschrieben wird, vorher als Version sichern (der Abgleich höchstens alle 10 Minuten je Board)
      {
        const kommt = new Map(boards.map((b) => [b.id, b]));
        const nimmt = sanft ? new Set(sanft.geaendert) : null;
        let betroffen = get().boards.filter((b) => kommt.has(b.id) && kommt.get(b.id) !== b && (!nimmt || nimmt.has(b.id)));
        // M460: Große Änderung anderer → eigene, nur knapp gedrosselte Sicherung statt der 10-Minuten-Bremse
        if (sanft) {
          const gross = new Set<string>();
          for (const b of betroffen) {
            const n = kartenSchub(b.nodes, (kommt.get(b.id) as BoardDoc).nodes ?? []);
            if (n >= FREMD_SCHUB_AB) { gross.add(b.id); vorUmbauHaken.fremdSchub(b, n); }
          }
          if (gross.size) betroffen = betroffen.filter((b) => !gross.has(b.id));
        }
        vorUmbauHaken.sichern(betroffen, sanft ? 'abgleich' : 'import');
      }
      if (sanft) {
        // M311: Hintergrund-Abgleich mit dem Sync-Ordner. Undo-Schritte zu
        // Boards, die drüben anders geworden sind, fallen weg — ein Undo
        // würde sonst still die Änderung des anderen Geräts zurückdrehen.
        // Die Ansicht wird nur neu aufgebaut, wenn sich auf dem AKTIVEN
        // Board Notiz-Inhalte geändert haben (Editoren lesen ihren Text
        // nur beim Aufbau); alles andere zeichnet React Flow selbst nach.
        const s = get();
        const betroffen = new Set(sanft.geaendert);
        // M365: Schritte auf betroffenen Boards fallen nicht mehr weg — sie merken sich ihren Stand danach und
        // nehmen später nur noch das Eigene zurück. Nur Mehr-Board-Schritte (selten) verfallen wie bisher.
        const frei = (e: HistoryEntry) => !(e.others ?? []).some((o) => betroffen.has(o.boardId) || betroffen.has(e.boardId));
        let past = s.past.filter(frei); let future = s.future.filter(frei);
        for (const id of betroffen) {
          const b = s.boards.find((x) => x.id === id);
          if (!b) { past = past.filter((e) => e.boardId !== id); future = future.filter((e) => e.boardId !== id); continue; }
          const jetzt = { nodes: b.nodes, edges: b.edges, drawings: b.drawings };
          const n = boards.find((x) => x.id === id);
          const fremdIds = n ? geaenderteIds(jetzt, { nodes: n.nodes, edges: n.edges, drawings: n.drawings }) : [];
          past = schritteAbgrenzen(past, id, jetzt, fremdIds); future = schritteAbgrenzen(future, id, jetzt, fremdIds);
        }
        const aktiv = boards.some((b) => b.id === s.activeId) ? s.activeId : boards[0].id;
        const alt = s.boards.find((b) => b.id === aktiv);
        const neu = boards.find((b) => b.id === aktiv);
        /* M364: Geänderte Notizen frischen ihren Editor an Ort und Stelle auf (NoteCard hört auf das Ereignis) —
           vorher wurde dafür das ganze Board neu aufgebaut: Wer gerade in einer ANDEREN Karte schrieb, verlor
           Cursor und Rollstand, sobald irgendwo eine Notiz von außen geändert wurde. In der Gruppenarbeit
           geschieht das im Sekundentakt. Neu aufgebaut wird nur noch, wenn das offene Board selbst wechselt. */
        const remount = betroffen.has(aktiv) && (!alt || !neu);
        const notizen = !remount && alt && neu && betroffen.has(aktiv) ? geaenderteNotizen(alt.nodes, neu.nodes) : [];
        set({
          boards,
          spaces,
          activeId: aktiv,
          past,
          future,
          importEpoch: remount ? s.importEpoch + 1 : s.importEpoch,
        });
        if (notizen.length) window.dispatchEvent(new CustomEvent(NOTIZ_EXTERN, { detail: notizen }));
        return;
      }
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
    }),

    importProject: (proj, boards) => {
      if (!proj?.id || !proj.name || !Array.isArray(boards) || boards.length === 0) return;
      const s = get();
      // M449: Die Boards des Projekts, die gleich ersetzt werden, vorher als Version sichern
      {
        const alt = new Set(s.spaces.flatMap((sp) => sp.projects).find((p) => p.id === proj.id)?.boardIds ?? []);
        vorUmbauHaken.sichern(s.boards.filter((b) => alt.has(b.id)), 'import');
      }
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
  } satisfies Partial<BoardState>;
}
