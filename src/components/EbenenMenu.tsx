import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBoard, type BoardSortierung } from '../store';
import { boardToShareUrl, downloadBoardFile, SHARE_URL_LIMIT } from '../lib/share';
import { kontoIstEigenes } from '../lib/kontoSync';
import { FreigabeDialog } from './FreigabeDialog';
import { LinkDialog } from './LinkDialog';
import {
  IArchive, IArchiveRestore, ICopy, IDownload, IDuplicate, IMore, IMoveTo,
  IPen, IPlay, IPlus, IShare, ITrash, IReihenfolge, ICheck,
} from './Icons';
import { MENUE_HIER } from '../lib/kontextmenue';

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

/** M347: Ein aufgeklapptes Menü ganz ins Bild holen — mit 8 Punkten Rand, nach seiner wirklichen Größe */
export function insBild(el: HTMLElement | null): void {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const rand = 8;
  const vw = window.innerWidth, vh = window.innerHeight;
  // Am Rand VERANKERN statt hinschieben: wächst das Menü danach noch (Schrift lädt), bleibt es im Bild
  if (r.right > vw - rand) { el.style.left = 'auto'; el.style.right = `${rand}px`; }
  else if (r.left < rand) el.style.left = `${rand}px`;
  if (r.bottom > vh - rand) { el.style.top = 'auto'; el.style.bottom = `${rand}px`; }
  else if (r.top < rand) { el.style.top = `${rand}px`; el.style.bottom = 'auto'; }
  el.style.maxHeight = `${vh - 2 * rand}px`;
  el.style.overflowY = 'auto';
}

export function MenuHuelle({ titel, klasse, kinder }: {
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
  useLayoutEffect(() => { if (pos) insBild(menu.current); }, [pos]);
  // M350: Rechtsklick auf die Zeile (Kontextmenue.tsx) öffnet dieses Menü am Zeiger
  const knopfRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const k = knopfRef.current;
    if (!k) return;
    const hier = (e: Event) => {
      const o = (e as CustomEvent<{ x: number; y: number }>).detail;
      if (!o) return;
      setPos({ x: o.x, y: o.y, hoch: false });
    };
    k.addEventListener(MENUE_HIER, hier);
    return () => k.removeEventListener(MENUE_HIER, hier);
  }, []);
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
        ref={knopfRef}
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
  // M330: Freigabe-Dialog (Konto) — lebt neben dem Menü, damit er offen bleibt, wenn das Menü zugeht
  const [freigabe, setFreigabe] = useState(false);
  // M357: Link-Dialog — kurzer Link mit Konto, sonst der bisherige Weg (Board im Link)
  const [linkOffen, setLinkOffen] = useState(false);
  if (!board) return null;

  const eigenesProjekt = spaces
    .flatMap((sp) => sp.projects.map((p) => ({ sp, p })))
    .find(({ p }) => p.boardIds.includes(boardId));

  const teilen = async () => {
    try {
      const url = await boardToShareUrl(board);
      if (url.length > SHARE_URL_LIMIT) {
        downloadBoardFile(board);
        showToast('Board zu groß für einen Link, als Datei gesichert.');
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        showToast('Teilen-Link kopiert, er enthält das komplette Board.');
      } catch {
        window.prompt('Link zum Kopieren (Strg+C):', url); // M340: Zwischenablage gesperrt — der Link ist trotzdem da
      }
    } catch {
      downloadBoardFile(board);
      showToast('Link nicht kopierbar, Board als Datei gesichert.');
    }
  };

  return (
    <>
    {freigabe && createPortal(<FreigabeDialog boardId={boardId} onClose={() => setFreigabe(false)} />, document.body)}
    {linkOffen && createPortal(<LinkDialog boardId={boardId} onClose={() => setLinkOffen(false)} ohneKonto={() => void teilen()} alsDatei={() => downloadBoardFile(board)} />, document.body)}
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
          {kontoIstEigenes() && (
            <button role="menuitem" onClick={() => { setFreigabe(true); zu(); }} data-taste="board-freigeben">
              <IShare size={14} /> {board.geteiltVon ? 'Geteilt mit mir …' : 'Für ein Konto freigeben …'}
            </button>
          )}
          <button role="menuitem" onClick={() => { setLinkOffen(true); zu(); }} data-taste="board-link">
            <IShare size={14} /> Per Link teilen …
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
    </>
  );
}

/**
 * M312: Und noch eine Ebene höher: am Bereich. Vorher gab es dafür nur
 * „+ Projekt" und „✕" als offene Knöpfe in der Übersicht — und im Baum gar
 * nichts. Jetzt dasselbe ⋯ wie bei Board und Projekt, an beiden Orten.
 */
export function BereichMenu({ spaceId, onRename, klasse = '' }: {
  spaceId: string;
  onRename?: () => void;
  klasse?: string;
}) {
  const space = useBoard((s) => s.spaces.find((sp) => sp.id === spaceId));
  const renameSpace = useBoard((s) => s.renameSpace);
  const addProject = useBoard((s) => s.addProject);
  const removeSpace = useBoard((s) => s.removeSpace);
  if (!space) return null;
  const leer = space.projects.length === 0;
  return (
    <MenuHuelle titel={`Bereich „${space.name}": umbenennen, Projekt anlegen, löschen`} klasse={klasse} kinder={(zu) => (
      <>
        <button role="menuitem" onClick={() => { zu(); if (onRename) onRename(); else {
          const n = window.prompt('Bereich umbenennen:', space.name);
          if (n?.trim()) renameSpace(spaceId, n.trim());
        } }}><IPen size={14} /> Umbenennen</button>
        <button role="menuitem" onClick={() => { addProject(spaceId); zu(); }}>
          <IPlus size={14} /> Neues Projekt
        </button>
        <div className="ebenen-menu-titel">Aufräumen</div>
        <button
          role="menuitem"
          className="ebenen-menu-gefahr"
          disabled={!leer}
          title={leer ? undefined : 'Erst die Projekte verschieben oder löschen'}
          onClick={() => { removeSpace(spaceId); zu(); }}
        ><ITrash size={14} /> Löschen{leer ? '' : ' (nur wenn leer)'}</button>
      </>
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
  const setProjektSortierung = useBoard((s) => s.setProjektSortierung);
  // M310: Unteransicht „Reihenfolge" — wie „In Projekt verschieben" beim Board
  const [ordnen, setOrdnen] = useState(false);
  const projekt = spaces.flatMap((sp) => sp.projects).find((p) => p.id === projectId);
  if (!projekt) return null;
  const offen = projekt.boardIds.filter((id) => boards.some((b) => b.id === id && !b.archived));
  const sortierung = projekt.sortierung ?? 'manuell';
  const SORTIERUNGEN: ReadonlyArray<readonly [BoardSortierung, string, string]> = [
    ['manuell', 'Manuell', 'Boards im Baum oder in der Übersicht ziehen'],
    ['alphabetisch', 'Alphabetisch', 'A bis Z nach Name'],
    ['erstellt', 'Nach Erstellung', 'das älteste Board zuerst'],
  ];
  const sortName = SORTIERUNGEN.find(([k]) => k === sortierung)?.[1] ?? 'Manuell';

  return (
    <MenuHuelle titel={`Projekt „${projekt.name}": umbenennen, Board anlegen, sortieren, duplizieren, archivieren, löschen`} klasse={klasse} kinder={(zu) => (
      ordnen ? (
        <>
          <div className="ebenen-menu-titel">Reihenfolge der Boards</div>
          {SORTIERUNGEN.map(([art, label, hinweis]) => (
            <button
              key={art}
              role="menuitemradio"
              aria-checked={art === sortierung}
              className={art === sortierung ? 'aktiv' : ''}
              title={hinweis}
              onClick={() => { setProjektSortierung(projectId, art); setOrdnen(false); zu(); }}
            >{art === sortierung ? <ICheck size={14} /> : <span className="ebenen-menu-leer" />} {label}</button>
          ))}
          <button role="menuitem" className="ebenen-menu-zurueck" onClick={() => setOrdnen(false)}>← Zurück</button>
        </>
      ) : (
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
        <button role="menuitem" className="ebenen-menu-reihenfolge" onClick={() => setOrdnen(true)}>
          <IReihenfolge size={14} /> Reihenfolge: {sortName} …
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
      )
    )} />
  );
}
