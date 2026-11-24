import { useEffect } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { passt } from '../lib/tasten';
import { usePfeilTasten } from './pfeilTasten';
import { overlayOffen } from '../lib/overlay';
import { useKontextSperre } from './Kontextmenue';
import { rahmenReiseBeenden, rahmenReiseStarten, reiseStand, reiseStart } from '../lib/rahmenReise';

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
  usePfeilTasten();   // M345: Pfeiltasten in Menüs, Leisten, Baum, Übersicht, Aufgaben
  useKontextSperre(); // M350: eigenes Rechtsklick-Menü statt des Browser-Menüs
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
      // M297: Alt+U schaltet die linke Navigationsspalte — am Telefon (keine
      // Spalte) öffnet es die Ausstülpung wie Alt+W
      if (passt(e, 'ueberblick')) {
        return tun(() => {
          if (window.matchMedia('(min-width: 861px)').matches) st.setNavLinks(!st.navLinks);
          else window.dispatchEvent(new CustomEvent('pixinotes:navigator'));
        });
      }
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
      /**
       * M390: Was am Board etwas ÄNDERT oder die Ansicht wechselt, gehört dem Fenster darüber.
       *
       * N, F und Strg+Z waren seit M388 gesperrt, sobald ein Fenster offen ist — die Alt-Kürzel hier nicht: Mit
       * offenen Einstellungen archivierte Alt+A die gewählte Karte dahinter, Alt+→ wechselte das Board, Alt+P legte
       * die Präsentation über die Einstellungen; in der Präsentation wechselte Alt+→ zusätzlich zum Blättern das
       * Board. `fenster` = irgendein Fenster oder die Präsentation liegt darüber; `amBoard` = das Board ist zu sehen.
       */
      const fenster = overlayOffen();
      const amBoard = st.view === 'board' && !st.tasksOpen && !fenster;
      // M514: Rahmen für Rahmen präsentieren (und wieder beenden)
      if (passt(e, 'rahmenReise')) {
        if (reiseStand()) return tun(() => rahmenReiseBeenden());
        if (!amBoard || st.presenting) return;
        return tun(() => {
          const b = selectActiveBoard(st);
          const start = reiseStart(b.nodes, b.edges);
          if (start) rahmenReiseStarten(st.activeId, start);
          else st.showToast('Auf diesem Board gibt es noch keinen Rahmen – lege einen an, dann geht es Rahmen für Rahmen.');
        });
      }
      if (passt(e, 'praesentation')) { if (!st.presenting && fenster) return; return tun(() => st.setPresenting(!st.presenting)); }

      // Board wechseln — innerhalb des Projekts, in dem das aktive Board liegt
      const projektBoards = () => {
        for (const sp of st.spaces) {
          for (const p of sp.projects) {
            if (p.boardIds.includes(st.activeId)) {
              // M390: archivierte Boards nur, wenn das Archiv eingeblendet ist — sonst blätterte man ins Unsichtbare
              return p.boardIds.filter((id) => st.boards.some((b) => b.id === id && (!b.archived || st.showArchived || id === st.activeId)));
            }
          }
        }
        return st.boards.map((b) => b.id);
      };
      if (passt(e, 'boardVor') || passt(e, 'boardZurueck')) {
        if (fenster) return;
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
        if (fenster) return;
        return tun(() => {
          const ids = projektBoards();
          const ziel = ids[Number(e.code.slice(5)) - 1];
          if (ziel) st.openBoard(ziel);
        });
      }

      // ── Karten & Board (nur sinnvoll, wenn ein Board offen ist) ────────
      if (passt(e, 'archivieren')) {
        if (!amBoard) return;
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
      if (passt(e, 'archivZeigen')) { if (fenster) return; return tun(() => st.setShowArchived(!st.showArchived)); }
      if (passt(e, 'fokus')) {
        if (!amBoard) return;
        return tun(() => {
          if (st.focusCard) { st.setFocusCard(null); return; }
          const erste = selectActiveBoard(st).nodes.find((n) => n.selected);
          if (erste) st.setFocusCard(erste.id);
          else st.showToast('Zum Öffnen im Fokus erst eine Karte auswählen.');
        });
      }
      if (passt(e, 'raster')) { if (!amBoard) return; return tun(() => st.setGridSnap(!st.gridSnap)); }
      if (passt(e, 'physik')) { if (!amBoard) return; return tun(() => { st.setZiehBewegung(!st.ziehBewegung); st.showToast(st.ziehBewegung ? 'Bewegung beim Ziehen aus' : 'Bewegung beim Ziehen an'); }); }
      if (passt(e, 'zeichnen')) { if (!amBoard) return; return tun(() => st.setTool(st.tool === 'select' ? 'pen' : 'select')); }

      // ── Reine Buchstaben: im Text sind das einfach Buchstaben ──────────
      if (imText(e)) return;
      if (passt(e, 'alleWaehlen') && amBoard) {
        return tun(() => {
          const sichtbar = selectActiveBoard(st).nodes
            .filter((n) => !n.archived || st.showArchived)
            .map((n) => ({ id: n.id, type: 'select' as const, selected: true }));
          st.onNodesChange(sichtbar);
        });
      }
    };

    /**
     * M390: Entf / Rücktaste löschen keine Karten hinter einem Fenster. Das Löschen übernimmt die Bibliothek des
     * Boards mit einem eigenen Zuhörer am Dokument — er bekommt die Taste nicht mehr zu sehen, solange ein Fenster
     * darüber liegt. In Textfeldern bleibt alles, wie es ist.
     */
    const entfSperre = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (imText(e) || !overlayOffen()) return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', entfSperre, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keydown', entfSperre, true); };
  }, []);

  return null;
}
