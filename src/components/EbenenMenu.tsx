import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '../store';
import { boardToShareUrl, downloadBoardFile, SHARE_URL_LIMIT } from '../lib/share';
import {
  IArchive, IArchiveRestore, ICopy, IDownload, IDuplicate, IMore, IMoveTo,
  IPen, IPlay, IPlus, IShare, ITrash,
} from './Icons';

/**
 * M288: Ein Menü für die Ebenen ÜBER der Karte.
 *
 * Karten konnten längst alles — kopieren, duplizieren, verschieben,
 * archivieren, teilen, löschen. Boards und Projekte konnten je nach Ansicht
 * etwas anderes: in der Tab-Leiste umbenennen und schließen, auf der Kachel
 * umbenennen, präsentieren und löschen, im Navigator gar nichts. Wer die
 * Ansicht wechselte, musste umdenken.
 *
 * Deshalb steht dieses Menü hinter EINEM Knopf (⋯) und wird überall
 * eingehängt, wo ein Board oder ein Projekt sichtbar ist. Die Reihenfolge ist
 * fest: erst die harmlosen Handgriffe, dann das Weggeben, ganz unten das
 * Löschen — dieselbe Dramaturgie wie im ⋯-Menü der Auswahl-Leiste.
 */

/** Gemeinsame Hülle: Knopf + schwebendes Menü (Portal, damit es aus jeder
 *  Leiste, Kachel und Baumzeile herausragen darf) */
function MenuHuelle({ titel, klasse, kinder }: {
  titel: string;
  klasse: string;
  kinder: (schliessen: () => void) => React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; hoch: boolean } | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  /**
   * Schließen bei einem Zeiger AUSSERHALB — und zwar außerhalb von BEIDEM.
   *
   * Der übliche Helfer (useOutsideClose) prüft nur einen Container; das Menü
   * hängt aber als Portal am <body> und liegt damit außerhalb des Knopfes.
   * Gemessen: Jeder Klick im Menü galt so als „draußen", das Menü schloss
   * schon beim Aufsetzen des Zeigers, und der Klick erreichte den Eintrag nie.
   */
  useEffect(() => {
    if (!pos) return;
    const zu = (e: PointerEvent) => {
      const z = e.target;
      if (!(z instanceof Node)) return;
      if (box.current?.contains(z) || menu.current?.contains(z)) return;
      setPos(null);
    };
    window.addEventListener('pointerdown', zu, true);
    return () => window.removeEventListener('pointerdown', zu, true);
  }, [pos]);
  return (
    <span className="ebenen-menu-wrap" ref={box}>
      <button
        className={`ebenen-menu-knopf ${klasse}${pos ? ' auf' : ''}`}
        title={titel}
        aria-label={titel}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (pos) { setPos(null); return; }
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          // Nach unten aufklappen, außer es ist kein Platz mehr — dann nach oben
          const hoch = r.bottom + 280 > window.innerHeight;
          setPos({ x: Math.min(r.left, window.innerWidth - 240), y: hoch ? r.top : r.bottom + 4, hoch });
        }}
        onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      ><IMore size={13} /></button>
      {pos && createPortal(
        <div
          ref={menu}
          className="ebenen-menu"
          role="menu"
          style={pos.hoch
            ? { left: pos.x, bottom: window.innerHeight - pos.y + 4, top: 'auto' }
            : { left: pos.x, top: pos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {kinder(() => setPos(null))}
        </div>,
        document.body,
      )}
    </span>
  );
}

/** Alle Handgriffe an EINEM Board — überall dieselbe Reihenfolge */
export function BoardMenu({ boardId, onRename, klasse = '' }: {
  boardId: string;
  /** Wie das Umbenennen an dieser Stelle aussieht (Inline-Feld). Fehlt es,
   *  fragt das Menü selbst nach — besser als gar kein Umbenennen. */
  onRename?: () => void;
  klasse?: string;
}) {
  const board = useBoard((s) => s.boards.find((b) => b.id === boardId));
  const spaces = useBoard((s) => s.spaces);
  const renameBoard = useBoard((s) => s.renameBoard);
  const duplicateBoard = useBoard((s) => s.duplicateBoard);
  const archiveBoard = useBoard((s) => s.archiveBoard);
  const moveBoard = useBoard((s) => s.moveBoard);
  const removeBoard = useBoard((s) => s.removeBoard);
  const openBoard = useBoard((s) => s.openBoard);
  const setView = useBoard((s) => s.setView);
  const setPresenting = useBoard((s) => s.setPresenting);
  const showToast = useBoard((s) => s.showToast);
  const [verschieben, setVerschieben] = useState(false);
  if (!board) return null;

  const eigenesProjekt = spaces
    .flatMap((sp) => sp.projects.map((p) => ({ sp, p })))
    .find(({ p }) => p.boardIds.includes(boardId));

  const teilen = async () => {
    try {
      const url = await boardToShareUrl(board);
      if (url.length > SHARE_URL_LIMIT) {
        downloadBoardFile(board);
        showToast('Board ist zu groß für einen Link (Bilder!) — stattdessen als Datei gesichert.');
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast('Teilen-Link kopiert — er enthält das komplette Board (serverlos).');
    } catch {
      downloadBoardFile(board);
      showToast('Link ging nicht in die Zwischenablage — Board stattdessen als Datei gesichert.');
    }
  };

  return (
    <MenuHuelle titel={`Board „${board.name}": umbenennen, duplizieren, verschieben, archivieren, teilen, löschen`} klasse={klasse} kinder={(zu) => (
      verschieben ? (
        <>
          <div className="ebenen-menu-titel">In welches Projekt?</div>
          {spaces.flatMap((sp) => sp.projects.map((p) => (
            <button
              key={p.id}
              role="menuitem"
              disabled={p.id === eigenesProjekt?.p.id}
              onClick={() => { moveBoard(boardId, p.id); showToast(`„${board.name}" liegt jetzt in „${p.name}".`); zu(); }}
            >
              <IMoveTo size={14} />
              <span>{sp.name} › {p.name}{p.id === eigenesProjekt?.p.id ? ' (hier)' : ''}</span>
            </button>
          )))}
          <button role="menuitem" className="ebenen-menu-zurueck" onClick={() => setVerschieben(false)}>← Zurück</button>
        </>
      ) : (
        <>
          <button role="menuitem" onClick={() => { zu(); if (onRename) onRename(); else {
            const n = window.prompt('Board umbenennen:', board.name);
            if (n?.trim()) renameBoard(boardId, n.trim());
          } }}><IPen size={14} /> Umbenennen</button>
          <button role="menuitem" onClick={() => { duplicateBoard(boardId); zu(); }}>
            <IDuplicate size={14} /> Duplizieren
          </button>
          <button role="menuitem" onClick={() => setVerschieben(true)}>
            <IMoveTo size={14} /> In Projekt verschieben …
          </button>
          <div className="ebenen-menu-titel">Weitergeben</div>
          <button role="menuitem" onClick={() => { teilen(); zu(); }}>
            <IShare size={14} /> Teilen-Link kopieren
          </button>
          <button role="menuitem" onClick={() => { downloadBoardFile(board); zu(); }}>
            <IDownload size={14} /> Als Datei sichern
          </button>
          <button role="menuitem" onClick={() => { setView('board'); openBoard(boardId); setPresenting(true); zu(); }}>
            <IPlay size={14} /> Präsentieren
          </button>
          <div className="ebenen-menu-titel">Aufräumen</div>
          <button role="menuitem" onClick={() => { archiveBoard(boardId, !board.archived); zu(); }}>
            {board.archived ? <><IArchiveRestore size={14} /> Zurückholen</> : <><IArchive size={14} /> Archivieren</>}
          </button>
          <button
            role="menuitem"
            className="ebenen-menu-gefahr"
            onClick={() => {
              const frage = board.nodes.length > 0
                ? `Board „${board.name}" mit ${board.nodes.length} Karten wirklich LÖSCHEN? Archivieren legt es stattdessen nur zur Seite.`
                : `Board „${board.name}" wirklich löschen?`;
              if (window.confirm(frage)) removeBoard(boardId);
              zu();
            }}
          ><ITrash size={14} /> Löschen</button>
        </>
      )
    )} />
  );
}

/** Dieselben Handgriffe eine Ebene höher: am Projekt */
export function ProjektMenu({ projectId, onRename, klasse = '' }: {
  projectId: string;
  onRename?: () => void;
  klasse?: string;
}) {
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const renameProject = useBoard((s) => s.renameProject);
  const duplicateProject = useBoard((s) => s.duplicateProject);
  const removeProject = useBoard((s) => s.removeProject);
  const addBoard = useBoard((s) => s.addBoard);
  const archiveBoard = useBoard((s) => s.archiveBoard);
  const showToast = useBoard((s) => s.showToast);
  const projekt = spaces.flatMap((sp) => sp.projects).find((p) => p.id === projectId);
  if (!projekt) return null;
  const offen = projekt.boardIds.filter((id) => boards.some((b) => b.id === id && !b.archived));

  return (
    <MenuHuelle titel={`Projekt „${projekt.name}": umbenennen, Board anlegen, duplizieren, archivieren, löschen`} klasse={klasse} kinder={(zu) => (
      <>
        <button role="menuitem" onClick={() => { zu(); if (onRename) onRename(); else {
          const n = window.prompt('Projekt umbenennen:', projekt.name);
          if (n?.trim()) renameProject(projectId, n.trim());
        } }}><IPen size={14} /> Umbenennen</button>
        <button role="menuitem" onClick={() => { addBoard(undefined, projectId); zu(); }}>
          <IPlus size={14} /> Neues Board
        </button>
        <button role="menuitem" onClick={() => { duplicateProject(projectId); zu(); }}>
          <ICopy size={14} /> Duplizieren (mit allen Boards)
        </button>
        <div className="ebenen-menu-titel">Aufräumen</div>
        <button
          role="menuitem"
          disabled={offen.length === 0}
          onClick={() => {
            /* Ein Projekt gilt als abgeschlossen, wenn seine Boards ruhen —
               einzeln wäre das bei zehn Boards zehnmal dieselbe Geste. */
            if (!window.confirm(`Alle ${offen.length} Boards in „${projekt.name}" archivieren? Sie bleiben erhalten und lassen sich einzeln zurückholen.`)) return;
            offen.forEach((id) => archiveBoard(id, true));
            showToast(`„${projekt.name}": ${offen.length} Board(s) archiviert.`);
            zu();
          }}
        ><IArchive size={14} /> Alle Boards archivieren ({offen.length})</button>
        <button
          role="menuitem"
          className="ebenen-menu-gefahr"
          onClick={() => {
            /* Der Store löscht bewusst nur LEERE Projekte und sagt das selbst —
               hier wird deshalb nichts vorweggenommen. */
            if (projekt.boardIds.length === 0 && !window.confirm(`Projekt „${projekt.name}" löschen?`)) { zu(); return; }
            removeProject(projectId);
            zu();
          }}
        ><ITrash size={14} /> Löschen</button>
      </>
    )} />
  );
}
