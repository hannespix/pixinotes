import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import { de as blockNoteDe } from '@blocknote/core/locales';
import { selectActiveBoard, useBoard } from '../store';
import { nodeToHtml } from '../lib/serialize';
import { buildMermaidSource, getMermaid, preloadHandFont } from '../lib/mermaid';
import { presentationOrder } from '../lib/presentOrder';
import { useAndroidBackspaceFix } from '../lib/blocknoteAndroidFix';
import { notizBildHochladen } from '../lib/notizBild';
import { NoteSlashMenu, NoteToolbar, noteSchema, useNurBilderInDenText } from './NoteTypo';
import { KanbanBody } from './nodes/KanbanCard';
import { GanttBody } from './nodes/GanttCard';
import { CalendarBody } from './nodes/CalendarCard';
import type { AppNode, CalendarNode, GanttNode, KanbanNode, MermaidNode, NoteNode, ShapeNode } from '../types';

/** Kartentypen, die auf der Folie LIVE editierbar sind */
const EDITABLE = new Set(['note', 'shape', 'mermaid', 'kanban', 'gantt', 'calendar']);

/** Bedient der Nutzer gerade ein Eingabe-/Bedienelement? Dann keine Folien-Navigation.
 *  SELECT/BUTTON gehören dazu: Pfeiltasten/Leertaste wählen dort Werte (Audit R6-F4) */
function inEditable(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName))
  );
}

/** Notiz-Folie: voller BlockNote-Editor — Änderungen landen direkt auf dem Board */
function NoteSlide({ node }: { node: NoteNode }) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  // wie bei der Karte: Blocks nur beim Mount lesen, danach ist der Editor die Wahrheit
  const [initialContent] = useState<PartialBlock[] | undefined>(() => {
    const blocks = node.data.blocks as PartialBlock[] | undefined;
    return blocks && blocks.length > 0 ? blocks : undefined;
  });
  const editor = useCreateBlockNote({
    schema: noteSchema,
    initialContent: initialContent as never,
    dictionary: blockNoteDe,
    // M289: Damit Bilder überhaupt in den Text dürfen — Einfügen,
    // Ablegen und der Dateiwähler des Bild-Blocks laufen hier durch
    uploadFile: notizBildHochladen,
  });
  useAndroidBackspaceFix(editor);
  /* M289: In der Präsentation gibt es kein Board darunter — hier wird eine
     fremde Datei nur abgewiesen, nicht umgeleitet. */
  const huelle = useRef<HTMLDivElement>(null);
  useNurBilderInDenText(huelle);

  return (
    <div className={`slide-note sticky-${node.data.color} note-editor`} ref={huelle}>
      {/* M267: auch in der Präsentation dieselbe Formatier-Leiste — wer hier
          eine Folie nachbessert, soll nicht plötzlich andere Werkzeuge haben */}
      <BlockNoteView
        editor={editor}
        theme="light"
        sideMenu={false}
        formattingToolbar={false}
          slashMenu={false}   /* M283: eigenes Einfügen-Menü (NoteSlashMenu) */
        onChange={() => updateNodeData(node.id, { blocks: editor.document })}
      >
        <NoteToolbar />
        {/* M283: „/" bietet die rechnende Tabelle an */}
        <NoteSlashMenu />
      </BlockNoteView>
    </div>
  );
}

/** Form-Folie: Original-Optik (inkl. Raute/Stadion), Text direkt editierbar */
function ShapeSlide({ node }: { node: ShapeNode }) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  return (
    <div className={`shape-wrap shape-${node.data.shape} slide-shape`}>
      <div
        className="shape-body"
        style={{ background: node.data.color, '--shape-fill': node.data.color } as CSSProperties}
      >
        <textarea
          className="shape-input slide-shape-input"
          value={node.data.text}
          placeholder="Text…"
          onChange={(e) => updateNodeData(node.id, { text: e.target.value })}
        />
      </div>
    </div>
  );
}

/** Mermaid-Folie: großes Diagramm, Code-Editor per ‹/› zuschaltbar */
function MermaidSlide({ node }: { node: MermaidNode }) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const uiTheme = useBoard((s) => s.ui.theme); // Folie folgt Hell/Dunkel (Audit M97)
  const [edit, setEdit] = useState(false);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const renderKey = useRef(0);

  // Folie rendert mit denselben Stil-/Look-Einstellungen wie die Karte
  // (vorher wurden Farbschema und Handschrift-Look hier ignoriert, M96)
  const style = (node.data.style as string | undefined) ?? '';
  const look = (node.data.look as string | undefined) ?? '';
  useEffect(() => {
    let cancelled = false;
    const myKey = ++renderKey.current;
    const t = setTimeout(() => {
      getMermaid()
        .then(async (mermaid) => {
          if (look === 'hand') await preloadHandFont(); // Scribble-Schrift vor der Messung
          // Render-ID pro Versuch eindeutig: mermaids ID-Cleanup löscht sonst
          // bei einem FEHLGESCHLAGENEN Versuch das angezeigte SVG (M90-Parität)
          return mermaid.render(`pn-slide-${node.id}-${myKey}`, buildMermaidSource(node.data.code, style, look));
        })
        .then(({ svg }) => { if (!cancelled && myKey === renderKey.current) { setSvg(svg); setError(''); } })
        .catch((e) => { if (!cancelled && myKey === renderKey.current) setError(String(e?.message ?? e).split('\n')[0]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [node.data.code, node.id, style, look, uiTheme]);

  return (
    <div className="slide-mermaid">
      <div className="mermaid-head">
        <span>📊 Diagramm</span>
        <div className="mermaid-tools">
          <button className={edit ? 'active' : ''} title="Code bearbeiten" onClick={() => setEdit((e) => !e)}>‹/›</button>
        </div>
      </div>
      <div className="mermaid-split slide-mermaid-split">
        {edit && (
          <textarea
            className="mermaid-code"
            value={node.data.code}
            spellCheck={false}
            onChange={(e) => updateNodeData(node.id, { code: e.target.value })}
          />
        )}
        <div className={`mermaid-preview${look === 'hand' ? ' mm-hand' : ''}`}>
          {/* Wie in der Karte (M90): letztes gültiges Diagramm bleibt sichtbar,
              der Fehler erscheint nur als Overlay-Chip */}
          <div className={`mermaid-svg ${error ? 'stale' : ''}`} dangerouslySetInnerHTML={{ __html: svg }} />
          {error && (
            <div className="mermaid-error" title={error}>
              ⚠️ {svg ? 'Code unvollständig — letztes gültiges Diagramm bleibt sichtbar' : error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Eine Folie: editierbar wo möglich, sonst sicher serialisiertes HTML */
function SlideContent({ node }: { node: AppNode }) {
  switch (node.type) {
    case 'note':
      return <NoteSlide node={node as NoteNode} />;
    case 'shape':
      return <ShapeSlide node={node as ShapeNode} />;
    case 'mermaid':
      return <MermaidSlide node={node as MermaidNode} />;
    case 'kanban':
      return (
        <div className="slide-kanban kanban-card">
          <KanbanBody id={node.id} data={(node as KanbanNode).data} />
        </div>
      );
    case 'gantt':
      return (
        <div className="slide-gantt gantt-card">
          <GanttBody id={node.id} data={(node as GanttNode).data} />
        </div>
      );
    case 'calendar':
      return (
        <div className="slide-cal cal-card">
          <CalendarBody id={node.id} data={(node as CalendarNode).data} />
        </div>
      );
    default:
      // E-Mail/Bild/Datei: Rendering über den escapenden Serializer — fremde Inhalte bleiben inert
      return <div dangerouslySetInnerHTML={{ __html: nodeToHtml(node) }} />;
  }
}

/**
 * Präsentationsmodus: Karten des aktiven Boards als Vollbild-Folien in
 * Lesereihenfolge. Pfeiltasten/Leertaste blättern, Esc beendet.
 * Notizen, Formen, Diagramme und Kanbans sind direkt auf der Folie
 * editierbar — Änderungen landen live auf dem Board.
 */
export function Presenter() {
  const open = useBoard((s) => s.presenting);
  const setOpen = useBoard((s) => s.setPresenting);
  const board = useBoard(selectActiveBoard);
  const [idx, setIdx] = useState(0);

  const slides = useMemo(() => {
    if (!open) return [];
    // Reihenfolge folgt der Gliederung: verbundene Karten als Cluster,
    // innerhalb den Pfeilen nach (Prozess-Logik); Unverbundenes in Lesereihenfolge
    return presentationOrder(board.nodes.filter((n) => !n.archived), board.edges)
      // Editierbare Typen immer zeigen (auch leere Notizen — die füllt man live);
      // statische nur, wenn sie Inhalt haben. Archivierte Karten sind erledigt
      // und gehören nicht in den Vortrag (M87)
      .filter((n) => EDITABLE.has(n.type) || nodeToHtml(n).trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, board.nodes, board.edges]);

  /** M228: Aus dem Karten-Fokus heraus startet der Vortrag bei DIESER Karte —
   *  „ab hier präsentieren" heißt genau das und nicht „von vorn". */
  const presentFrom = useBoard((s) => s.presentFrom);
  const setPresentFrom = useBoard((s) => s.setPresentFrom);
  useEffect(() => {
    if (!open) return;
    const ab = presentFrom ? slides.findIndex((n) => n.id === presentFrom) : -1;
    setIdx(ab >= 0 ? ab : 0);
    if (presentFrom) setPresentFrom(null);
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      // Tippen in Editor/Eingabefeld: Tasten durchlassen, aber nicht ans Board
      // weiterreichen (Entf/Backspace würde sonst Karten löschen).
      // Esc verlässt erst das Feld — das zweite Esc beendet dann die Präsentation.
      if (inEditable(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        setIdx((i) => Math.min(slides.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setIdx((i) => Math.max(0, i - 1));
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slides.length]);

  if (!open) return null;

  // idx robust klemmen — board.nodes kann während der Präsentation schrumpfen
  const safeIdx = Math.max(0, Math.min(idx, slides.length - 1));
  const current = slides[safeIdx];

  return (
    <div className="presenter" role="dialog" aria-modal="true" aria-label="Präsentation">
      <div className="presenter-head">
        <span>{board.name}</span>
        <span className="presenter-hint-edit">Folien sind direkt editierbar</span>
        <span className="presenter-count">{slides.length ? safeIdx + 1 : 0} / {slides.length}</span>
        <button onClick={() => setOpen(false)} aria-label="Präsentation beenden">✕</button>
      </div>
      {slides.length === 0 ? (
        <div className="presenter-slide"><p>Keine präsentierbaren Karten auf diesem Board.</p></div>
      ) : (
        <div className={`presenter-slide ${EDITABLE.has(current.type) ? 'editable' : ''}`}>
          <SlideContent key={current.id} node={current} />
        </div>
      )}
      <div className="presenter-foot">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={safeIdx <= 0}>‹ Zurück</button>
        <span className="presenter-dots">
          {slides.slice(0, 24).map((s, i) => (
            <button key={s.id} className={i === safeIdx ? 'on' : ''} onClick={() => setIdx(i)} aria-label={`Folie ${i + 1}`} />
          ))}
        </span>
        <button onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))} disabled={safeIdx >= slides.length - 1}>Weiter ›</button>
      </div>
    </div>
  );
}
