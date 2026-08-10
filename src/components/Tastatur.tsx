import { useEffect } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { passt } from '../lib/tasten';

/**
 * M251: Die globalen Tastenkürzel an einer Stelle.
 *
 * Bewusst KEIN eigener Handler je Ansicht: Wer „Alt+E" drückt, meint immer
 * die Einstellungen — egal, ob gerade das Board, das Netz oder die
 * Aufgaben-Zentrale zu sehen ist. Deshalb hängt dieser eine Zuhörer am
 * Fenster und liest den Zustand direkt aus dem Speicher.
 *
 * Zwei Regeln, die alles zusammenhalten:
 *
 *  1. **Alt-Kürzel gelten auch beim Schreiben.** Alt+T ist keine Texteingabe;
 *     wer mitten in einer Notiz die Aufgaben aufrufen will, soll das können.
 *     Reine Buchstaben-Kürzel (N, F) dagegen sind im Text tabu — dort sind sie
 *     schlicht Buchstaben.
 *  2. **AltGr ist kein Alt.** Auf deutschen Tastaturen meldet AltGr sich als
 *     Strg+Alt. `passt()` verwirft das, sonst würde AltGr+Q (@) etwas
 *     auslösen. Die Prüfung sitzt in tasten.ts, damit sie sich nicht
 *     versehentlich verliert.
 *
 * Nicht hier, sondern dort, wo sie hingehören: N/F/Strg+Z liegen weiterhin im
 * Board (sie brauchen dessen Kamera), Esc bei den jeweiligen Fenstern.
 */
export function Tastatur() {
  useEffect(() => {
    const imText = (e: KeyboardEvent) =>
      !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

    const onKey = (e: KeyboardEvent) => {
      const st = useBoard.getState();
      /** Ausführen und die Standardwirkung des Browsers unterdrücken */
      const tun = (fn: () => void) => { e.preventDefault(); fn(); };

      // ── Überall ───────────────────────────────────────────────────────
      if (passt(e, 'hilfe')) return tun(() => st.setHelpOpen(!st.helpOpen));
      if (passt(e, 'einstellungen')) return tun(() => st.setSettingsOpen(!st.settingsOpen));
      if (passt(e, 'aufgaben')) return tun(() => st.setTasksOpen(!st.tasksOpen));

      // ── Ansichten ─────────────────────────────────────────────────────
      if (passt(e, 'ueberblick')) return tun(() => st.setSidebar({ open: !st.sidebar.open }));
      if (passt(e, 'navigator')) {
        // Der Navigator lebt als lokaler Zustand in der Reiter-Leiste — ein
        // Fenster-Ereignis ist hier ehrlicher, als seinen Zustand nur für
        // dieses Kürzel in den globalen Speicher zu heben.
        return tun(() => window.dispatchEvent(new CustomEvent('pixinotes:navigator')));
      }
      if (passt(e, 'netz')) {
        return tun(() => {
          if (st.view === 'overview') st.setView('board');
          else { st.setOverviewMode('netz'); st.setView('overview'); }
        });
      }
      if (passt(e, 'praesentation')) return tun(() => st.setPresenting(!st.presenting));

      // Board wechseln — innerhalb des Projekts, in dem das aktive Board liegt
      const projektBoards = () => {
        for (const sp of st.spaces) {
          for (const p of sp.projects) {
            if (p.boardIds.includes(st.activeId)) {
              return p.boardIds.filter((id) => st.boards.some((b) => b.id === id));
            }
          }
        }
        return st.boards.map((b) => b.id);
      };
      if (passt(e, 'boardVor') || passt(e, 'boardZurueck')) {
        return tun(() => {
          const ids = projektBoards();
          if (ids.length < 2) return;
          const i = ids.indexOf(st.activeId);
          const schritt = passt(e, 'boardVor') ? 1 : -1;
          // Umlaufend: am Ende geht es vorne weiter — sonst läuft man ins Leere
          st.openBoard(ids[(i + schritt + ids.length) % ids.length]);
        });
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        return tun(() => {
          const ids = projektBoards();
          const ziel = ids[Number(e.code.slice(5)) - 1];
          if (ziel) st.openBoard(ziel);
        });
      }

      // ── Karten & Board (nur sinnvoll, wenn ein Board offen ist) ────────
      if (passt(e, 'archivieren')) {
        return tun(() => {
          const gewaehlt = selectActiveBoard(st).nodes.filter((n) => n.selected).map((n) => n.id);
          const ids = gewaehlt.length ? gewaehlt : st.focusCard ? [st.focusCard] : [];
          if (!ids.length) {
            st.showToast('Zum Archivieren erst eine Karte auswählen.');
            return;
          }
          if (st.focusCard && ids.includes(st.focusCard)) st.setFocusCard(null);
          st.setArchived(ids, true);
        });
      }
      if (passt(e, 'archivZeigen')) return tun(() => st.setShowArchived(!st.showArchived));
      if (passt(e, 'fokus')) {
        return tun(() => {
          if (st.focusCard) { st.setFocusCard(null); return; }
          const erste = selectActiveBoard(st).nodes.find((n) => n.selected);
          if (erste) st.setFocusCard(erste.id);
          else st.showToast('Zum Öffnen im Fokus erst eine Karte auswählen.');
        });
      }
      if (passt(e, 'raster')) return tun(() => st.setGridSnap(!st.gridSnap));
      if (passt(e, 'physik')) return tun(() => st.setPhysicsEnabled(!st.physicsEnabled));
      if (passt(e, 'zeichnen')) return tun(() => st.setTool(st.tool === 'select' ? 'pen' : 'select'));

      // ── Reine Buchstaben: im Text sind das einfach Buchstaben ──────────
      if (imText(e)) return;
      if (passt(e, 'alleWaehlen') && st.view === 'board') {
        return tun(() => {
          const sichtbar = selectActiveBoard(st).nodes
            .filter((n) => !n.archived || st.showArchived)
            .map((n) => ({ id: n.id, type: 'select' as const, selected: true }));
          st.onNodesChange(sichtbar);
        });
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
