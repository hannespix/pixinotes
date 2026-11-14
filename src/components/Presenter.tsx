import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import { de as blockNoteDe } from '@blocknote/core/locales';
import { selectActiveBoard, useBoard } from '../store';
import { nodeToHtml } from '../lib/serialize';
import { buildMermaidSource, getMermaid, preloadHandFont } from '../lib/mermaid';
import { presentationOrder } from '../lib/presentOrder';
import { useAndroidBackspaceFix } from '../lib/blocknoteAndroidFix';
import { editorUpload } from '../lib/notizBild';
import { NoteSlashMenu, NoteToolbar, noteSchema, useNurBilderInDenText } from './NoteTypo';
import { KanbanBody } from './nodes/KanbanCard';
import { GanttBody } from './nodes/GanttCard';
import { CalendarBody } from './nodes/CalendarCard';
import { DokumentFolie, dokumentArt } from './DokumentFolie';
import { letzteSeite } from '../lib/pdfSeiten';
import type { AppNode, CalendarNode, FileNode, GanttNode, KanbanNode, MermaidNode, NoteNode, ShapeNode } from '../types';

/** Kartentypen, die auf der Folie LIVE editierbar sind */
const EDITABLE = new Set(['note', 'shape', 'mermaid', 'kanban', 'gantt', 'calendar']);

/** Bedient der Nutzer gerade ein Eingabe-/Bedienelement? Dann keine Folien-Navigation.
 *  SELECT/BUTTON gehören dazu: Pfeiltasten/Leertaste wählen dort Werte (Audit R6-F4) */
function inEditable(t: EventTarget | null, key = ''): boolean {
  if (!(t instanceof HTMLElement)) return false;
  // M363: Ein Knopf braucht nur Leertaste und Enter — die Pfeile blättern weiter, auch nachdem man
  // „Weiter" oder einen Zoom-Knopf angeklickt hat (der Knopf behält den Tastatur-Fokus)
  if (t.tagName === 'BUTTON') return key === ' ' || key === 'Enter';
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
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
    uploadFile: editorUpload(),   // M303: nie eine abgewiesene Zusage
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
          <div className={`mermaid-svg ${error ? 'stale' : ''}`} translate="no" dangerouslySetInnerHTML={{ __html: svg }} />
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
      return <div translate="no" dangerouslySetInnerHTML={{ __html: nodeToHtml(node) }} />;
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
  // M363: Stelle im Vortrag = Folie + Seite darin (Dokument-Folien haben mehrere; −1 = die letzte)
  const [pos, setPos] = useState<{ idx: number; seite: number }>({ idx: 0, seite: 1 });
  const idx = pos.idx;
  const [seitenJe, setSeitenJe] = useState<Record<string, number>>({});
  const seitenRef = useRef(seitenJe);
  seitenRef.current = seitenJe;
  const schrittRef = useRef<(d: 1 | -1) => void>(() => {});
  /** Die Dokument-Folie meldet, ob auf der Seite noch etwas zu rollen ist — dann rollt der Schritt, statt zu blättern */
  const rollRef = useRef<((d: 1 | -1) => boolean) | null>(null);
  const ansichtMerker = useRef<Record<string, 'seite' | 'breite'>>({});

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
    // Aus dem Fokus eines Dokuments heraus geht es auf der Seite weiter, die dort offen lag
    setPos({ idx: ab >= 0 ? ab : 0, seite: ab >= 0 && dokumentArt(slides[ab]) ? letzteSeite(slides[ab].id) : 1 });
    if (presentFrom) setPresentFrom(null);
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      // Tippen in Editor/Eingabefeld: Tasten durchlassen, aber nicht ans Board
      // weiterreichen (Entf/Backspace würde sonst Karten löschen).
      // Esc verlässt erst das Feld — das zweite Esc beendet dann die Präsentation.
      if (inEditable(e.target, e.key)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') schrittRef.current(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') schrittRef.current(-1);
      else if (e.key === 'Home') setPos({ idx: 0, seite: 1 });          // M345
      else if (e.key === 'End') setPos({ idx: Math.max(0, slides.length - 1), seite: -1 });
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

  /**
   * M363: Ein Schritt im Vortrag. In einem Dokument (PDF, Word) geht es erst Seite für Seite, dann zur
   * nächsten Folie; rückwärts landet man auf der letzten Seite des Dokuments davor.
   */
  const schritt = useCallback((d: 1 | -1) => setPos((p) => {
    const i = Math.max(0, Math.min(p.idx, slides.length - 1));
    const cur = slides[i];
    const art = cur ? dokumentArt(cur) : null;
    if (cur && art && art !== 'bild') {
      const n = seitenRef.current[cur.id] ?? 1;
      const jetzt = p.seite < 0 ? n : Math.min(Math.max(1, p.seite), n);
      if (jetzt + d >= 1 && jetzt + d <= n) return { idx: i, seite: jetzt + d };
    }
    if (i + d < 0 || i + d >= slides.length) return p;
    return { idx: i + d, seite: d === 1 ? 1 : -1 };
  }), [slides]);
  /** Schritt per Taste oder Fußleiste: erst die Seite zu Ende rollen, dann blättern */
  const weiter = (d: 1 | -1) => { if (!rollRef.current?.(d)) schritt(d); };
  schrittRef.current = weiter;
  // Wischen blättert auf Folien ohne eigene Bedienung (Bild, Mail, Text) — editierbare Folien und
  // Dokumente regeln das selbst (dort gehört der waagerechte Zug dem Inhalt)
  const wisch = useRef<{ x: number; y: number; t: number } | null>(null);

  if (!open) return null;

  // idx robust klemmen — board.nodes kann während der Präsentation schrumpfen
  const safeIdx = Math.max(0, Math.min(idx, slides.length - 1));
  const current = slides[safeIdx];
  const art = current ? dokumentArt(current) : null;
  const seitenHier = current && art && art !== 'bild' ? seitenJe[current.id] ?? 1 : 1;
  const seiteHier = pos.seite < 0 ? seitenHier : Math.min(Math.max(1, pos.seite), seitenHier);
  const amAnfang = safeIdx <= 0 && seiteHier <= 1;
  const amEnde = safeIdx >= slides.length - 1 && seiteHier >= seitenHier;

  return (
    <div className={`presenter ${art ? 'mit-dokument' : ''}`} role="dialog" aria-modal="true" aria-label="Präsentation">
      <div className="presenter-head">
        <span translate="no">{board.name}</span>
        <span className="presenter-hint-edit">{art ? 'Doppelklick oder + / − vergrößert · B = Seitenbreite' : 'Folien sind direkt editierbar'}</span>
        <span className="presenter-count">{slides.length ? safeIdx + 1 : 0} / {slides.length}</span>
        <button onClick={() => setOpen(false)} aria-label="Präsentation beenden">✕</button>
      </div>
      {slides.length === 0 ? (
        <div className="presenter-slide"><p>Keine präsentierbaren Karten auf diesem Board.</p></div>
      ) : (
        art ? (
          <div className="presenter-slide dokument">
            <DokumentFolie key={current.id} node={current as FileNode} art={art} seite={pos.seite}
              onSeiten={(n) => setSeitenJe((m) => (m[current.id] === n ? m : { ...m, [current.id]: n }))}
              schritt={schritt} geheZu={(s) => setPos({ idx: safeIdx, seite: s })} rollRef={rollRef} ansichtMerker={ansichtMerker} />
          </div>
        ) : (
          <div className={`presenter-slide ${EDITABLE.has(current.type) ? 'editable' : ''}`}
            onTouchStart={(e) => { wisch.current = EDITABLE.has(current.type) || e.touches.length !== 1 ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() }; }}
            onTouchEnd={(e) => {
              const w = wisch.current; wisch.current = null;
              const t = e.changedTouches[0];
              if (!w || !t) return;
              const dx = t.clientX - w.x; const dy = t.clientY - w.y;
              if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && performance.now() - w.t < 700) schritt(dx < 0 ? 1 : -1);
            }}>
            <SlideContent key={current.id} node={current} />
          </div>
        )
      )}
      <div className="presenter-foot">
        {/* aria-disabled statt disabled: Ein Knopf, der mit Tastatur-Fokus „disabled" wird, verschluckt danach alle Tasten (M361) */}
        <button onClick={() => weiter(-1)} aria-disabled={amAnfang} data-taste="vortrag-zurueck">‹ Zurück</button>
        <span className="presenter-dots">
          {slides.slice(0, 24).map((s, i) => (
            <button key={s.id} className={i === safeIdx ? 'on' : ''} onClick={() => setPos({ idx: i, seite: 1 })} aria-label={`Folie ${i + 1}`} />
          ))}
        </span>
        <button onClick={() => weiter(1)} aria-disabled={amEnde} data-taste="vortrag-weiter">Weiter ›</button>
      </div>
    </div>
  );
}
