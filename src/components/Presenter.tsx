import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import { de as blockNoteDe, en as blockNoteEn } from '@blocknote/core/locales';
import { fensterDarueber } from '../lib/overlay';
import { sprache } from '../lib/sprache';
import { selectActiveBoard, selectNurLesen, useBoard } from '../store';
import { nodeToHtml } from '../lib/serialize';
import { buildMermaidSource, getMermaid, preloadHandFont } from '../lib/mermaid';
import { folieAb, kartenFolge } from '../lib/kartenFolge';
import { useAndroidBackspaceFix } from '../lib/blocknoteAndroidFix';
import { editorUpload } from '../lib/notizBild';
import { NoteSlashMenu, NoteToolbar, noteSchema, useNurBilderInDenText } from './NoteTypo';
import { KanbanBody } from './nodes/KanbanCard';
import { GanttBody } from './nodes/GanttCard';
import { CalendarBody } from './nodes/CalendarCard';
import { dokumentArt } from '../lib/dokumentArt';
import { letzteSeite } from '../lib/pdfSeiten';
import type { AppNode, BubblesNode, CalendarNode, FileNode, GanttNode, HtmlAppNode, ImageNode, KanbanNode, MermaidNode, MinutesNode, NoteNode, PixiNode, ShapeNode, SheetNode, TimeNode, WeekNode } from '../types';
import { HtmlAppSlide } from './nodes/HtmlAppCard';
import { useRandLeiste } from '../lib/randLeiste';
import { ReinRand, useReinAnsicht } from '../lib/reinAnsicht';
import { FOLIEN_FARBEN, type FolienWerkzeug } from '../lib/folienWerkzeug';
import { useTippGesten } from '../lib/tippGesten';
import { ansichtGemerkt, ansichtMerken, FOLIEN_ANSICHTEN, useFolienZoom, type FolienAnsicht } from '../lib/folienZoom';
import { useZiehRollen } from '../lib/ziehRollen';

// M395: Was nur WÄHREND einer Präsentation gebraucht wird, kommt erst dann — der Kern der App bleibt schlank
const DokumentFolie = lazy(() => import('./DokumentFolie').then((m) => ({ default: m.DokumentFolie })));
const FolienStift = lazy(() => import('./FolienStift').then((m) => ({ default: m.FolienStift })));
const FolienKommentare = lazy(() => import('./FolienKommentare').then((m) => ({ default: m.FolienKommentare })));
import { ICheck, IComment, IEraser, IFit, IHighlighter, IMaximize, IPen, IUndo, IMegafon } from './Icons';
import { BubblesBody } from './nodes/BubblesCard';
import { FluessigBuehne } from './nodes/FluessigCard';
import { WeekBody } from './nodes/WeekCard';
import { TimeBody } from './nodes/TimeCard';
import { MinutesBody } from './nodes/MinutesCard';
import { papierArt } from '../lib/minutes';
import { formSchrift, notizSchrift } from '../lib/lesbareSchrift';
import { SheetBody } from './nodes/SheetCard';
import { FolienLaser } from './Mauszeiger';
import { ReaktionsKnopf } from './Gruppenraum';
import { ansichtMelden, folgeIch, folgenSetzen, ichFuehreVor, VORFUEHR_EREIGNIS, vorfuehrenMitVortrag, vorfuehrenStart, vorfuehrenStopp, vortragAlleinSetzen, vortragMelden, vortragZuEnde, werFuehrtVor } from '../lib/vorfuehren';
import { ich, liveVerbunden, TEILNEHMER_EREIGNIS, teilnehmerVon } from '../lib/liveStand';
import { NotizRuhend } from './nodes/NotizRuhend';
import { PixiFigur } from './nodes/PixiCard';
import type { RuheBlock } from '../lib/notizRuhend';

/** Kartentypen, die auf der Folie LIVE editierbar sind */
const EDITABLE = new Set(['note', 'shape', 'mermaid', 'kanban', 'gantt', 'calendar', 'bubbles', 'week', 'time', 'minutes', 'sheet', 'fluessig']);

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
    // M462: Strg+A markiert wie bisher die ganze Notiz (BlockNote 0.57: erst den Block)
    selectAllBehavior: 'document',
    initialContent: initialContent as never,
    dictionary: sprache() === 'en' ? blockNoteEn : blockNoteDe,   // M381
    // M289: Damit Bilder überhaupt in den Text dürfen — Einfügen,
    // Ablegen und der Dateiwähler des Bild-Blocks laufen hier durch
    uploadFile: editorUpload(),   // M303: nie eine abgewiesene Zusage
  });
  useAndroidBackspaceFix(editor);
  /* M289: In der Präsentation gibt es kein Board darunter — hier wird eine
     fremde Datei nur abgewiesen, nicht umgeleitet. */
  const huelle = useRef<HTMLDivElement>(null);
  useNurBilderInDenText(huelle);
  const hex = typeof node.data.hex === 'string' && node.data.hex ? node.data.hex : undefined;
  const schrift = notizSchrift(hex);

  return (
    // M515: wie auf dem Board — eigene Farbe als Fläche, Schrift nach dem Papier (weiß folgt dem Thema, eine dunkle
    // oder mittlere eigene Farbe bringt ihre lesbare Schrift mit). Vorher stand BlockNote-Grau auf der dunklen Folie.
    <div className={`slide-note sticky-${hex ? 'eigen' : node.data.color} papier-${papierArt(node.data)}${schrift.klasse} note-editor`}
      style={hex ? { background: hex, ...schrift.stil } as CSSProperties : undefined} ref={huelle}>
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
  const schrift = formSchrift(node.data.color);
  return (
    <div className={`shape-wrap shape-${node.data.shape} slide-shape`}>
      {/* M515: dieselbe Schrift wie auf dem Board — nach der Füllung, nicht nach dem Thema der Folie */}
      <div
        className={`shape-body${schrift.klasse}`}
        style={{ background: node.data.color, '--shape-fill': node.data.color, ...schrift.stil } as CSSProperties}
      >
        {/* M435: Formatierter Text (wie in Notizen) erscheint auf der Folie formatiert; schlichter Text bleibt direkt editierbar */}
        {Array.isArray(node.data.blocks) && node.data.blocks.length ? (
          <div className="note-editor shape-ruhend slide-shape-text" translate="no">
            <NotizRuhend blocks={node.data.blocks as RuheBlock[]} onHaken={() => undefined} />
          </div>
        ) : (
          <textarea
            className="shape-input slide-shape-input"
            value={node.data.text}
            placeholder="Text…"
            onChange={(e) => updateNodeData(node.id, { text: e.target.value })}
          />
        )}
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
        <span>Diagramm</span>
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
            data-rechtschreibung="aus"
            onChange={(e) => updateNodeData(node.id, { code: e.target.value })}
          />
        )}
        <div className={`mermaid-preview${look === 'hand' ? ' mm-hand' : ''}`}>
          {/* Wie in der Karte (M90): letztes gültiges Diagramm bleibt sichtbar,
              der Fehler erscheint nur als Overlay-Chip */}
          <div className={`mermaid-svg ${error ? 'stale' : ''}`} translate="no" dangerouslySetInnerHTML={{ __html: svg }} />
          {error && (
            <div className="mermaid-error" title={error}>
              {svg ? 'Code unvollständig – letztes gültiges Diagramm bleibt sichtbar' : error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * M508: Ist das Bild einer Bild-Karte eine Vektorgrafik? SVGs haben keine feste Größe in Pixeln (oft nur eine viewBox
 * oder eine Breite in Prozent) – als <img> mit der 600-Punkte-Grenze der Bild-Folien wurden sie unsichtbar klein
 * (ohne Größenangabe 0 × 0) oder hingen 600 Punkte breit am linken Rand (breiter als 600 Punkte angegeben).
 */
function istSvgBild(src: string, name = ''): boolean {
  return /^data:image\/svg\+xml[;,]/i.test(src) || /\.svg(?:[?#]|$)/i.test(src.split(/[?#]/)[0] ?? '') || (!src.startsWith('data:') && /\.svg$/i.test(name));
}

/** M508: Vektorgrafik auf der Folie – mittig und so groß, wie die Folie es bei gleichem Seitenverhältnis zulässt.
 *  Als <img> (nie eingebettet): ein SVG führt so kein Skript aus und lädt nichts nach, egal woher es kommt. */
function SvgFolie({ node }: { node: ImageNode }) {
  const d = node.data;
  return (
    <div className="slide-svg" translate="no" data-taste="folie-svg">
      <img src={d.src} alt={d.titel?.trim() || d.name || 'Bild'} draggable={false} />
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
    case 'bubbles':
      // M373: die Blasen leben auch auf der Folie — beitragen, abstimmen, auswerten vor Publikum
      return (
        <div className="slide-bubbles bubbles-card">
          <h3 className="slide-bubbles-titel" translate="no">{(node as BubblesNode).data.title || 'Ideen'}</h3>
          <BubblesBody id={node.id} data={(node as BubblesNode).data} gross />
        </div>
      );
    case 'fluessig':
      // M500: die Flüssigkeit lebt auch auf der Folie — anfassen, schubsen, platzen lassen
      return (
        <div className={`slide-modul slide-fluessig fluessig-card fl-farbe-${(node.data as { farbe?: string }).farbe === 'akzent' ? 'akzent' : 'schrift'}`} data-taste="folie-fluessig">
          <FluessigBuehne data={node.data as never} greifbar aussehen="folie" />
        </div>
      );
    // M380: Auch Wochenplan, Zeiterfassung, Protokoll und Rechen-Tabelle leben auf der Folie — vorher standen
    // sie dort als Standbild (Tabelle aus dem Export). Derselbe Inhalt wie auf dem Board, nur größer.
    case 'week':
      return (
        <div className="slide-modul slide-week week-card" data-taste="folie-week">
          <WeekBody id={node.id} data={(node as WeekNode).data} folie />
        </div>
      );
    case 'time':
      return (
        <div className="slide-modul slide-time time-card" data-taste="folie-time">
          <TimeBody id={node.id} data={(node as TimeNode).data} />
        </div>
      );
    case 'minutes': {
      const m = (node as MinutesNode).data;
      return (
        <div className={`slide-modul slide-minutes minutes-card sticky-${m.color ?? 'white'} papier-${papierArt(m)}`} style={m.hex ? { background: m.hex } : undefined} data-taste="folie-minutes">
          <MinutesBody id={node.id} data={m} />
        </div>
      );
    }
    case 'sheet':
      return (
        <div className="slide-modul slide-sheet sheet-card" data-taste="folie-sheet">
          <SheetBody id={node.id} data={(node as SheetNode).data} />
        </div>
      );
    case 'pixi': {
      // M501: Pixi lebt auch auf der Folie — schaut dem Zeiger nach und hat etwas vor
      const d = (node as PixiNode).data;
      return (
        <div className="slide-pixi" data-taste="folie-pixi">
          <PixiFigur farbe={d.farbe} schlafen={d.schlafen !== false} name={d.name} />
          {d.name?.trim() && <p className="slide-pixi-name" translate="no">{d.name}</p>}
        </div>
      );
    }
    case 'htmlapp':
      // M371: Tools und Webseiten laufen auf der Folie wirklich (vorher: ein Standbild mit dem Namen)
      return <HtmlAppSlide node={node as HtmlAppNode} />;
    case 'image': {
      // M508: Vektorgrafiken füllen die Folie (mittig, Seitenverhältnis bleibt); Fotos bleiben wie bisher
      const d = (node as ImageNode).data;
      if (typeof d.src === 'string' && istSvgBild(d.src, d.name)) return <SvgFolie node={node as ImageNode} />;
      return <div translate="no" dangerouslySetInnerHTML={{ __html: nodeToHtml(node) }} />;
    }
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
  /** M405: von Karte zu Karte – gleich, ob die Karte Seiten hat */
  const karteRef = useRef<(d: 1 | -1) => void>(() => {});
  /** Die Seite, auf der ein Dokument in dieser Präsentation zuletzt offen lag – dorthin kommt man zurück */
  const seitenMerker = useRef<Record<string, number>>({});
  useEffect(() => { if (!open) seitenMerker.current = {}; }, [open]);
  // M371: Vorführen im Team — die Präsentation gehört zur Ansicht, die der Vorführende mitnimmt
  const [, vorfuehrTakt] = useState(0);
  useEffect(() => {
    const auf = () => vorfuehrTakt((n) => n + 1);
    window.addEventListener(VORFUEHR_EREIGNIS, auf);
    window.addEventListener(TEILNEHMER_EREIGNIS, auf);
    return () => { window.removeEventListener(VORFUEHR_EREIGNIS, auf); window.removeEventListener(TEILNEHMER_EREIGNIS, auf); };
  }, []);
  /** Diese Präsentation hat sich geöffnet, weil ich dem Vorführenden folge — dann schließt sie sich auch mit ihm */
  const gefolgt = useRef(false);
  /** M387: … und bleibt für diese Sitzung der Präsentation „fremd": Hört der Vorführende auf, übernimmt hier niemand von selbst */
  const fremdGeoeffnet = useRef(false);
  useEffect(() => { if (!open) fremdGeoeffnet.current = false; }, [open]);
  /** M375: Laserpointer — ein roter Punkt statt des Mauszeigers; führt man vor, sehen ihn alle an derselben Stelle der Folie */
  const [laser, setLaser] = useState(false);
  // M394: Stift, Textmarker, Radierer und Kommentare auf der Folie
  const nurLesen = useBoard(selectNurLesen);
  const [werkzeug, setWerkzeug] = useState<FolienWerkzeug | null>(null);
  const [farben, setFarben] = useState<{ pen: string; marker: string }>({ pen: FOLIEN_FARBEN.pen[0], marker: FOLIEN_FARBEN.marker[0] });
  const [kommOffen, setKommOffen] = useState(false);
  const [faden, setFaden] = useState<string | null>(null);
  const werkzeugRef = useRef(werkzeug); werkzeugRef.current = werkzeug;
  const kommRef = useRef(kommOffen); kommRef.current = kommOffen;
  const nurLesenRef = useRef(nurLesen); nurLesenRef.current = nurLesen;
  const waehle = (w: FolienWerkzeug) => { setLaser(false); setWerkzeug((alt) => (alt === w ? null : w)); };
  const waehleRef = useRef(waehle); waehleRef.current = waehle;
  useEffect(() => { if (!open) { setWerkzeug(null); setKommOffen(false); setFaden(null); } }, [open]);
  // M396: Zwei-Finger-Tipp = Rückgängig, Drei-Finger-Tipp = Wiederholen — auch in der Präsentation (nicht in Textfeldern und auf Leisten)
  const fingerGesten = useBoard((st) => st.fingerGesten);
  useTippGesten(open && fingerGesten, (ziel) => !!ziel?.closest('.presenter-slide, .folien-stift')
    && !ziel.closest('input, textarea, select, button, a, [contenteditable="true"], .folie-dok-leiste, .folien-palette, .folien-kommentare'));
  useEffect(() => { if (!open) setLaser(false); }, [open]);
  const selbstRef = useRef<() => void>(() => {});
  /** Die Dokument-Folie meldet, ob auf der Seite noch etwas zu rollen ist — dann rollt der Schritt, statt zu blättern */
  const rollRef = useRef<((d: 1 | -1) => boolean) | null>(null);
  const ansichtMerker = useRef<Record<string, 'seite' | 'breite'>>({});
  // M403: Darstellung der Folien – gilt für die ganze Präsentation und bleibt gemerkt
  const [ansicht, setAnsicht] = useState<FolienAnsicht>(ansichtGemerkt);
  const ansichtRef = useRef(ansicht); ansichtRef.current = ansicht;
  /** Wohin „B" von „Volle Breite" zurückführt */
  const vorBreite = useRef<FolienAnsicht>(ansicht === 'breite' ? 'standard' : ansicht);
  const waehleAnsicht = useCallback((a: FolienAnsicht) => {
    if (a !== 'breite') vorBreite.current = a;
    ansichtMerker.current = {};      // die Wahl gilt für alle Folien – auch für Dokumente, die schon einzeln umgestellt waren
    ansichtMerken(a);
    setAnsicht(a);
  }, []);
  const [ansichtMenu, setAnsichtMenu] = useState(false);
  const ansichtMenuRef = useRef(ansichtMenu); ansichtMenuRef.current = ansichtMenu;
  const ansichtHuelle = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (!open) setAnsichtMenu(false); }, [open]);
  useEffect(() => {
    if (!ansichtMenu) return;
    const zu = (e: PointerEvent) => { if (!ansichtHuelle.current?.contains(e.target as Node)) setAnsichtMenu(false); };
    window.addEventListener('pointerdown', zu, true);
    return () => window.removeEventListener('pointerdown', zu, true);
  }, [ansichtMenu]);

  const { reihe, slides } = useMemo(() => {
    if (!open) return { reihe: [] as AppNode[], slides: [] as AppNode[] };
    // M413: dieselbe Reihenfolge wie beim Blättern im Fokus (lib/kartenFolge.ts) – Verbundenes am Stück und den
    // Pfeilen nach, Rahmen als Abschnitte, sonst Lesefolge
    const alle = kartenFolge(board.nodes.filter((n) => !n.archived), board.edges);
    return {
      reihe: alle,
      // Editierbare Typen immer zeigen (auch leere Notizen — die füllt man live);
      // statische nur, wenn sie Inhalt haben. Archivierte Karten sind erledigt
      // und gehören nicht in den Vortrag (M87)
      slides: alle.filter((n) => EDITABLE.has(n.type) || nodeToHtml(n).trim()),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, board.nodes, board.edges]);

  /** M228: Aus dem Karten-Fokus heraus startet der Vortrag bei DIESER Karte —
   *  „ab hier präsentieren" heißt genau das und nicht „von vorn". */
  const setPresentFrom = useBoard((s) => s.setPresentFrom);
  /* M387: Die Stelle wird nur beim ÖFFNEN gesetzt. Vorher hing das an der Zahl der Folien — legte jemand im
     Board während des Vortrags eine Karte an (oder löschte eine), sprang die Präsentation auf Folie 1 zurück.
     M503: … und zwar schon im RENDER, in dem die Präsentation aufgeht (nicht erst in einem Effekt danach). Sonst
     zeigte der erste Durchgang Folie 1 bzw. die Stelle des letzten Vortrags, meldete sie ans Team, und erst ein
     Durchgang später sprang es auf die gewünschte Karte. Startkarte: wem ich folge, dessen Stelle – sonst die
     gewünschte Karte (Fokus, Auswahl, Kontextmenü; siehe setPresenting) – sonst von vorn. */
  const [offenStand, setOffenStand] = useState(false);
  if (open !== offenStand) {
    setOffenStand(open);
    if (open) {
      const dort = folgeIch(board.id) ? werFuehrtVor(board.id)?.vortrag : undefined;
      const ziel = dort?.karte ?? useBoard.getState().presentFrom;
      const ab = folieAb(reihe, slides, ziel ?? null);
      // Aus dem Fokus eines Dokuments heraus geht es auf der Seite weiter, die dort offen lag
      const seite = ab < 0 ? 1 : dort && slides[ab].id === dort.karte ? dort.seite
        : slides[ab].id === ziel && dokumentArt(slides[ab]) ? letzteSeite(slides[ab].id) : 1;
      setPos({ idx: Math.max(0, ab), seite });
    }
  }
  /** Die Karte, die offen ist — bleibt sie im Board, bleibt der Vortrag auf ihr, auch wenn davor Folien dazukommen */
  const offeneKarte = useRef<string | null>(null);
  // Die Startkarte ist eine Absicht für genau dieses Öffnen – danach vergessen (Store nicht im Render ändern)
  useEffect(() => { if (open && useBoard.getState().presentFrom) setPresentFrom(null); }, [open, setPresentFrom]);
  useEffect(() => {
    if (!open) { offeneKarte.current = null; return; }
    if (offeneKarte.current) {
      const i = slides.findIndex((n) => n.id === offeneKarte.current);
      if (i >= 0) setPos((p) => (p.idx === i ? p : { ...p, idx: i }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slides.length]);
  // Vollbild und Tasten hängen nur am Öffnen — eine neue Karte im Board wirft niemanden aus dem Vollbild
  const folienZahl = useRef(0);
  folienZahl.current = slides.length;
  useEffect(() => {
    if (!open) return;
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
      // M388: Steht über der Folie ein Fenster (Ticket, Bild-Lupe), schließt Esc DAS — nicht auch noch die Präsentation.
      // Und Tab bleibt dem Browser: Die Knöpfe der Präsentation waren mit der Tastatur sonst nicht zu erreichen.
      if (e.key === 'Tab') return;
      if (e.key === 'Escape' && document.querySelector('.ticket-modal-backdrop, .modal-backdrop, .pdf-backdrop')) return;
      // M530: … und jedes andere Fenster darüber (Suche per Strg+K): Esc schließt nur das (lib/overlay.ts)
      if (e.key === 'Escape' && fensterDarueber(null, e)) return;
      const frei = !e.ctrlKey && !e.metaKey && !e.altKey;
      const taste = e.key.toLowerCase();
      // M394: Esc legt erst den Stift weg, schließt dann die Kommentare — erst das dritte beendet die Präsentation
      if (e.key === 'Escape' && ansichtMenuRef.current) setAnsichtMenu(false);
      else if (e.key === 'Escape' && werkzeugRef.current) setWerkzeug(null);
      else if (e.key === 'Escape' && kommRef.current) setKommOffen(false);
      else if (frei && !nurLesenRef.current && (taste === 'p' || taste === 'm' || taste === 'e')) waehleRef.current(taste === 'p' ? 'pen' : taste === 'm' ? 'marker' : 'eraser');
      else if (frei && taste === 'k') setKommOffen((v) => !v);
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && taste === 'z' && werkzeugRef.current) useBoard.getState().undo();
      // M405: Strg + Pfeil geht immer zur nächsten Karte – auch mitten in einem Dokument
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) karteRef.current(e.key === 'ArrowRight' ? 1 : -1);
      else
      if (e.key === 'Escape') { selbstRef.current(); selbstBeendet.current = true; setOpen(false); }
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') schrittRef.current(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') schrittRef.current(-1);
      else if (e.key === 'Home') { selbstRef.current(); setPos({ idx: 0, seite: 1 }); }          // M345
      else if (e.key === 'End') { selbstRef.current(); setPos({ idx: Math.max(0, folienZahl.current - 1), seite: -1 }); }
      else if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey && !e.altKey) { setWerkzeug(null); setLaser((v) => !v); }   // M375
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
  /** Schritt per Taste: erst die Seite zu Ende rollen, dann blättern */
  const weiter = (d: 1 | -1) => { selbst(); if (!rollRef.current?.(d)) schritt(d); };
  schrittRef.current = weiter;
  /**
   * M405: Zu einer Karte gehen – die Knöpfe der Fußleiste, die Punkte, Strg + Pfeil. Immer dieselbe Bewegung, gleich
   * welcher Kartentyp: Ein Dokument mit vielen Seiten hält niemanden auf (seine Seiten blättert die Leiste am Dokument
   * oder → / Leertaste). Zurück in einem Dokument liegt die Seite offen, auf der man es verlassen hat.
   */
  const zuKarte = (ziel: number) => {
    if (ziel < 0 || ziel >= slides.length) return;
    selbst();
    const n = slides[ziel];
    const art = dokumentArt(n);
    setPos({ idx: ziel, seite: art && art !== 'bild' ? seitenMerker.current[n.id] ?? 1 : 1 });
  };
  karteRef.current = (d) => zuKarte(Math.max(0, Math.min(idx, slides.length - 1)) + d);
  // Wischen blättert auf Folien ohne eigene Bedienung (Bild, Mail, Text) — editierbare Folien und
  // Dokumente regeln das selbst (dort gehört der waagerechte Zug dem Inhalt)
  const wisch = useRef<{ x: number; y: number; t: number } | null>(null);

  // idx robust klemmen — board.nodes kann während der Präsentation schrumpfen
  const safeIdx = Math.max(0, Math.min(idx, slides.length - 1));
  const current = slides[safeIdx] as AppNode | undefined;
  // M393: Auf einer Tool-Folie gehört der Schirm dem Tool — die Kopfzeile kommt am oberen Rand
  // M426: Nur Inhalt – Folie randlos über den ganzen Schirm, ohne Kopf- und Fußzeile (F, Esc)
  const reinAnsicht = useReinAnsicht('vortrag', open);
  const rand = useRandLeiste(open && current?.type === 'htmlapp' && !reinAnsicht.rein, 2200);
  useEffect(() => { if (reinAnsicht.rein) { setKommOffen(false); setAnsichtMenu(false); } }, [reinAnsicht.rein]);
  const art = current ? dokumentArt(current) : null;
  const seitenHier = current && art && art !== 'bild' ? seitenJe[current.id] ?? 1 : 1;
  const seiteHier = pos.seite < 0 ? seitenHier : Math.min(Math.max(1, pos.seite), seitenHier);
  // Gemerkt wird die Karte, auf die man selbst gegangen ist — nicht die, die nach einer Änderung der Folienfolge an ihrem Platz steht
  useEffect(() => { offeneKarte.current = open && current ? current.id : null; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pos, open]);
  /* M431: „Wenn man den Präsentationsmodus verlässt, soll zur letzten in der Präsentation aktiven Karte oder Modul
     gesprungen werden." Die zuletzt gezeigte Karte merken — beim Schließen fährt das Board dorthin (mittig, Zoom 1).
     Auch wenn der Vortrag im Karten-Fokus begann: zurück aufs Board, bei der Karte — nicht erneut in den Fokus (der
     schlug beim Vorführen Dokumente auf den anderen Geräten wieder auf). */
  const zuletztGezeigt = useRef<{ board: string; karte: string } | null>(null);
  /** Selbst beendet (Esc, ✕) — schließt sich die Präsentation, weil der Vorführende sie beendet, bleibt alles, wie es ist */
  const selbstBeendet = useRef(false);
  useEffect(() => { if (open && current) zuletztGezeigt.current = { board: board.id, karte: current.id }; }, [open, current, board.id]);
  useEffect(() => {
    if (open) return;
    const z = zuletztGezeigt.current;
    const selbstZu = selbstBeendet.current;
    zuletztGezeigt.current = null; selbstBeendet.current = false;
    if (!z || !selbstZu) return;
    const st = useBoard.getState();
    if (st.activeId !== z.board) return;   // inzwischen auf einem anderen Board: dort nicht hinfahren
    // nur hinfahren: Markieren wirkte bei Dokumenten wie „aufschlagen" und bei mehreren Geräten bis zu den anderen
    st.focusNode(z.board, z.karte, { markieren: false });
  }, [open]);
  useEffect(() => { if (open && current && art && art !== 'bild') seitenMerker.current[current.id] = seiteHier; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, current?.id, art, seiteHier]);

  // ───── M371: Vorführen im Team ─────
  const zeigt = werFuehrtVor(board.id);
  const ichZeige = ichFuehreVor(board.id);
  const folge = folgeIch(board.id);
  /** Wer selbst blättert oder schließt, löst sich vom Vorführenden (wie beim Schwenken auf dem Board) */
  const selbst = () => { if (folgeIch(board.id)) folgenSetzen(board.id, false); };
  selbstRef.current = selbst;
  // Meine Stelle im Vortrag bekanntgeben (gemerkt wird sie immer; gesendet, solange ich vorführe)
  const stelle = open && current ? `${current.id}|${seiteHier}` : '';
  useEffect(() => {
    if (folgeIch(board.id)) return;      // wer folgt, meldet nichts
    vortragMelden(board.id, stelle ? { karte: stelle.split('|')[0], seite: Number(stelle.split('|')[1]) } : null);
  }, [board.id, stelle, folge]);
  // Ich folge: Die Präsentation des Vorführenden öffnet sich hier, blättert mit und schließt sich mit ihm
  const dort = folge && zeigt?.vortrag ? `${zeigt.vortrag.karte}|${zeigt.vortrag.seite}` : '';
  useEffect(() => {
    if (!folge) {
      // M387: Der Vorführende hat aufgehört (nicht: ich habe mich gelöst) — die Präsentation, die sich für ihn geöffnet hat, schließt sich
      if (gefolgt.current && open && !werFuehrtVor(board.id)) setOpen(false);
      gefolgt.current = false;
      return;
    }
    if (dort) {
      gefolgt.current = true;      // auch nach „Wieder folgen" in einer schon offenen Präsentation
      // M503: mit der Stelle des Vorführenden als Start – nicht mit meiner eigenen Auswahl
      if (!open) { fremdGeoeffnet.current = true; setOpen(true, dort.split('|')[0]); return; }
      const [karte, seite] = dort.split('|');
      const i = slides.findIndex((n) => n.id === karte);
      if (i >= 0) setPos((p) => (p.idx === i && p.seite === Number(seite) ? p : { idx: i, seite: Number(seite) }));
    } else if (open && gefolgt.current) { gefolgt.current = false; setOpen(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folge, dort, open, slides]);
  /** Lässt sich hier etwas ans Team zeigen? (gemeinsames Board mit Live-Verbindung) */
  const teamDa = liveVerbunden(board.id) && teilnehmerVon(board.id).some((t) => t.id !== ich().id);
  /* M387: Wer auf seinem eigenen Board präsentiert, während andere dabei sind, nimmt sie von selbst mit — ohne
     vorher „Vorführen" zu drücken. Auch wenn das Publikum erst während des Vortrags dazukommt. Gäste entscheiden
     das weiter per Knopf (sonst risse jeder Teilnehmer mit „Präsentieren" alle anderen aus ihrer Arbeit). */
  const eigenes = !board.geteiltVon;
  const jemandZeigt = !!zeigt;
  useEffect(() => {
    if (!open || !teamDa || !eigenes || jemandZeigt || folgeIch(board.id) || fremdGeoeffnet.current) return;
    vorfuehrenMitVortrag(board.id);
  }, [open, teamDa, eigenes, jemandZeigt, board.id]);
  // … und endet die Präsentation, endet eine so begonnene Vorführung mit ihr
  const boardIdRef = useRef(board.id);
  boardIdRef.current = board.id;
  useEffect(() => {
    if (!open) return;
    return () => vortragZuEnde(boardIdRef.current);
  }, [open]);
  /** M387: Rollstand einer gewöhnlichen Folie (lange Notiz, großes Kanban) — der Vorführende meldet ihn, wer folgt, rollt mit */
  const folieRef = useRef<HTMLDivElement>(null);
  const dortAnsicht = folge && zeigt?.vortrag && current && zeigt.vortrag.karte === current.id ? zeigt.vortrag.ansicht : undefined;
  const dortRoll = dortAnsicht ? `${dortAnsicht.x}|${dortAnsicht.y}` : '';
  // M402: in den Inhalt gewöhnlicher Folien hinein- und herauszoomen (Dokumente zoomen selbst, Web-Tools laufen in ihrem Rahmen)
  // M403: … von der gewählten Darstellung aus; wer folgt, sieht Darstellung und Zoom des Vorführenden
  const zoombar = open && !art && !!current && current.type !== 'htmlapp';
  /** Folie ohne eigene Bedienung (Bild, Mail, Text): Doppelklick zoomt, ein einfacher Zug verschiebt */
  const statisch = !!current && !art && !EDITABLE.has(current.type) && current.type !== 'htmlapp';
  const fz = useFolienZoom(folieRef, {
    aktiv: zoombar, karte: current?.id, ansicht, doppel: statisch,
    fremd: dortAnsicht?.a ? { a: dortAnsicht.a, d: dortAnsicht.d ?? 1 } : null,
    wechsel: () => waehleAnsicht(ansichtRef.current === 'breite' ? vorBreite.current : 'breite'),
  });
  const zoomFaktor = fz.heim > 0 ? Math.round((fz.zoom / fz.heim) * 1000) / 1000 : 1;
  const rollGemeldet = useRef<{ karte: string; x: number; y: number } | null>(null);
  const standRef = useRef({ a: ansicht, d: zoomFaktor });
  standRef.current = { a: ansicht, d: zoomFaktor };
  // Darstellung oder Zoom geändert: den Ausschnitt melden (der Rollstand allein meldet sich beim Rollen)
  useEffect(() => {
    const el = folieRef.current;
    if (!zoombar || !el || !current || folgeIch(board.id)) return;
    // der Rollstand ist der zuletzt gemeldete dieser Folie (es rollt die Folie oder ihr Inhalt) – auf einer neuen Folie der Anfang
    const t = setTimeout(() => {
      const r = rollGemeldet.current?.karte === current.id ? rollGemeldet.current : { x: 0, y: 0 };
      ansichtMelden(board.id, current.id, { x: r.x, y: r.y, ...standRef.current });
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoombar, current?.id, ansicht, zoomFaktor, folge, board.id]);
  // M403: den Ausschnitt mit der Maus verschieben – Leertaste + Ziehen, mittlere Taste, freie Fläche
  useZiehRollen({
    aktiv: open && !!current && current.type !== 'htmlapp',
    finde: () => (art ? document.querySelector<HTMLElement>('.presenter .folie-dok-flaeche') : folieRef.current),
    frei: (ziel, el) => !!art || statisch || ziel === el || ziel === el.firstElementChild || !!ziel.closest('.mermaid-preview'),
    tippen: () => schrittRef.current(1),
  });
  useEffect(() => {
    const el = folieRef.current;
    if (!el || !dortRoll || art) return;
    const [x, y] = dortRoll.split('|').map(Number);
    // Es rollt die Folie selbst oder ihr Inhalt (eine lange Notiz rollt in sich) — je nach Schirm das eine oder das andere
    for (const r of [el, el.firstElementChild as HTMLElement | null]) {
      if (r && (r.scrollHeight > r.clientHeight + 2 || r.scrollWidth > r.clientWidth + 2)) r.scrollTo({ left: x * Math.max(0, r.scrollWidth - r.clientWidth), top: y * Math.max(0, r.scrollHeight - r.clientHeight), behavior: 'smooth' });
    }
  }, [dortRoll, art, current?.id, fz.zoom]);

  // M418: Auf dem Handy reicht die Kopfzeile nicht für alle Knöpfe — „Beenden" darf trotzdem nie
  // aus dem Bild rutschen. Die Zeile misst sich selbst und verdichtet stufenweise:
  // 1 = Knöpfe nur als Symbol, 2 = zwei Zeilen (oben Name und Beenden, darunter die Werkzeuge).
  const kopfRef = useRef<HTMLDivElement | null>(null);
  const kopfPassen = useRef(() => {});
  kopfPassen.current = () => {
    const h = kopfRef.current;
    if (!h) return;
    // voll: Sie läuft über — oder der Board-Name ist zum Strich geschrumpft
    const name = h.firstElementChild as HTMLElement | null;
    const voll = () => h.scrollWidth > h.clientWidth || (!!name && name.clientWidth < Math.min(72, name.scrollWidth));
    h.dataset.eng = '0';
    if (voll()) { h.dataset.eng = '1'; if (voll()) h.dataset.eng = '2'; }
  };
  useEffect(() => {
    const h = kopfRef.current;
    if (!h || typeof ResizeObserver === 'undefined') return;
    let breite = h.clientWidth;
    const ro = new ResizeObserver(() => { if (h.clientWidth !== breite) { breite = h.clientWidth; kopfPassen.current(); } });
    ro.observe(h);
    return () => ro.disconnect();
  }, [open]);
  useLayoutEffect(() => { kopfPassen.current(); },
    [open, board.name, slides.length, current?.type, teamDa, ichZeige, folge, laser, werkzeug, kommOffen, fz.zoom, board.comments, art]);

  if (!open) return null;
  /** im Folien-Zweig unten gibt es die Folie sicher (slides.length > 0) */
  const cur = current as AppNode;

  const offeneKomm = current ? (board.comments ?? []).reduce((n, c) => n + (c.nodeId === current.id && !c.resolved ? 1 : 0), 0) : 0;
  const amAnfang = safeIdx <= 0;
  const amEnde = safeIdx >= slides.length - 1;
  /** Hat man selbst gezoomt? Dann zeigt das Symbol die Stufe */
  const eigenerZoom = zoombar && Math.abs(fz.zoom - fz.heim) > 0.001;

  return (
    <div className={`presenter ${reinAnsicht.rein ? 'rein' : ''} ${art ? 'mit-dokument' : ''} ${kommOffen ? 'mit-kommentaren' : ''} ${werkzeug ? 'mit-stift' : ''}`} role="dialog" aria-modal="true" aria-label="Präsentation">
      <div className={`presenter-head ${rand.da ? 'da' : ''}`} ref={kopfRef} data-eng="0" {...rand.griff}>
        <span translate="no">{board.name}</span>
        <span className="presenter-hint-edit">{art ? 'Doppelklick oder + / − vergrößert · B = Seitenbreite' : current?.type === 'htmlapp' ? 'Läuft auf der Folie · blättern mit ‹ ›' : 'Folien sind direkt editierbar · Strg+Rad zoomt'}</span>
        {/* M403: Darstellung der Folien – ein kleines Symbol; wer selbst gezoomt hat, sieht dort die Stufe */}
        {slides.length > 0 && current?.type !== 'htmlapp' && (
          <span className="presenter-ansicht" ref={ansichtHuelle}>
            <button className={`presenter-team presenter-ikon presenter-zoom ${ansichtMenu ? 'an' : ''}`} data-taste="folie-zoom" aria-haspopup="menu" aria-expanded={ansichtMenu}
              title="Darstellung der Folien" aria-label="Darstellung der Folien" onClick={() => setAnsichtMenu((v) => !v)}>
              {eigenerZoom ? <span translate="no">{Math.round(fz.zoom * 100)} %</span> : <IFit size={15} />}
            </button>
            {ansichtMenu && (
              <div className="presenter-ansicht-menu" role="menu" data-taste="folie-ansicht-menu">
                {!art && (
                  <div className="presenter-ansicht-stufe">
                    <button data-taste="ansicht-kleiner" aria-label="Verkleinern" title="Verkleinern (−)" onClick={() => fz.mal(1 / 1.25)}>−</button>
                    <span translate="no" data-taste="ansicht-stufe">{Math.round(fz.zoom * 100)} %</span>
                    <button data-taste="ansicht-groesser" aria-label="Vergrößern" title="Vergrößern (+)" onClick={() => fz.mal(1.25)}>+</button>
                  </div>
                )}
                {FOLIEN_ANSICHTEN.map((a) => (
                  <button key={a.id} role="menuitemradio" aria-checked={ansicht === a.id} className={ansicht === a.id ? 'an' : ''} data-taste="folie-ansicht" data-ansicht={a.id} title={a.hinweis}
                    onClick={() => { if (ansicht === a.id) fz.zurueck(); else waehleAnsicht(a.id); setAnsichtMenu(false); }}>
                    <span className="presenter-ansicht-haken" aria-hidden="true">{ansicht === a.id && <ICheck size={14} />}</span>{a.name}
                  </button>
                ))}
                <button className="rein-wahl" data-taste="folie-rein" onClick={() => { setAnsichtMenu(false); reinAnsicht.umschalten(); }}>
                  <span className="presenter-ansicht-haken" aria-hidden="true"><IMaximize size={14} /></span>Nur Inhalt<kbd>F</kbd>
                </button>
              </div>
            )}
          </span>
        )}
        <span className="presenter-count">{slides.length ? safeIdx + 1 : 0} / {slides.length}</span>
        {/* M371: Die Präsentation dem Team zeigen — dieselbe Folie, dieselbe Seite, bei allen */}
        {(teamDa || ichZeige) && !folge && board.geteiltRolle !== 'lesen' && (
          <button className={`presenter-team ${ichZeige ? 'an' : ''}`} data-taste="vortrag-team" aria-label={ichZeige ? 'Team folgt' : 'Team mitnehmen'}
            title={ichZeige ? 'Vorführen beenden – die anderen blättern wieder selbst' : 'Alle im Board sehen diese Präsentation und blättern mit dir'}
            onClick={() => { vortragAlleinSetzen(ichZeige); if (ichZeige) vorfuehrenStopp(); else vorfuehrenStart(board.id, true); }}>
            <IMegafon size={14} /> <span className="presenter-wort">{ichZeige ? 'Team folgt' : 'Team mitnehmen'}</span>
          </button>
        )}
        {/* M376: Das Publikum reagiert — der Vortragende sieht es aufsteigen */}
        {teamDa && <ReaktionsKnopf boardId={board.id} klasse="presenter-team" />}
        {slides.length > 0 && (
          <button className={`presenter-team presenter-laser ${laser ? 'an' : ''}`} data-taste="vortrag-laser" aria-pressed={laser} aria-label="Laser"
            title={laser ? 'Laserpointer ausschalten (L)' : 'Laserpointer: ein roter Punkt statt des Mauszeigers (L)'}
            onClick={() => { setWerkzeug(null); setLaser((v) => !v); }}>
            <span className="laser-knopf-punkt" aria-hidden="true" /> <span className="presenter-wort">Laser</span>
          </button>
        )}
        {/* M394: auf die Folie zeichnen, Kommentare zur Folie — zwei kleine Knöpfe, alles Weitere erst bei Bedarf */}
        {slides.length > 0 && !nurLesen && (
          <button className={`presenter-team presenter-ikon ${werkzeug ? 'an' : ''}`} data-taste="vortrag-stift" aria-pressed={!!werkzeug}
            title={werkzeug ? 'Stift weglegen (Esc)' : 'Auf die Folie zeichnen: Stift (P), Textmarker (M), Radierer (E)'} aria-label="Auf die Folie zeichnen"
            onClick={() => waehle(werkzeug ?? 'pen')}>
            <IPen size={15} />
          </button>
        )}
        {slides.length > 0 && (
          <button className={`presenter-team presenter-ikon ${kommOffen ? 'an' : ''}`} data-taste="vortrag-kommentare" aria-pressed={kommOffen}
            title="Kommentare zur Folie (K)" aria-label="Kommentare zur Folie" onClick={() => setKommOffen((v) => !v)}>
            <IComment size={15} />{offeneKomm > 0 && <span className="presenter-zahl" data-taste="vortrag-kommentar-zahl">{offeneKomm}</span>}
          </button>
        )}
        <button className="presenter-team presenter-ikon" data-taste="vortrag-rein" onClick={reinAnsicht.umschalten}
          title="Nur Inhalt – Vollbild ohne Bedienung (F)" aria-label="Nur Inhalt (Vollbild ohne Bedienung)">
          <IMaximize size={15} />
        </button>
        <button className="presenter-zu" data-taste="vortrag-zu" onClick={() => { selbst(); selbstBeendet.current = true; setOpen(false); }} aria-label="Präsentation beenden" title="Präsentation beenden (Esc)">✕</button>
      </div>
      {slides.length === 0 ? (
        <div className="presenter-slide"><p>Keine präsentierbaren Karten auf diesem Board.</p></div>
      ) : (
        art ? (
          <div className="presenter-slide dokument">
            <Suspense fallback={null}>
              <DokumentFolie key={cur.id} node={cur as FileNode} art={art} seite={pos.seite}
                onSeiten={(n) => setSeitenJe((m) => (m[cur.id] === n ? m : { ...m, [cur.id]: n }))}
                schritt={(d) => { selbst(); schritt(d); }} geheZu={(s) => { selbst(); setPos({ idx: safeIdx, seite: s }); }} rollRef={rollRef} ansichtMerker={ansichtMerker}
                vorgabe={ansicht === 'einpassen' ? 'seite' : ansicht === 'breite' ? 'breite' : undefined}
                onAnsicht={folge ? undefined : (a) => ansichtMelden(board.id, cur.id, a)} ansicht={dortAnsicht} />
            </Suspense>
          </div>
        ) : (
          <div className={`presenter-slide ${EDITABLE.has(cur.type) ? 'editable' : ''} ${cur.type === 'htmlapp' ? 'app' : ''}`} ref={folieRef}
            onScrollCapture={(e) => {
              if (folgeIch(board.id)) return;
              const el = e.target as HTMLElement;
              if (el !== e.currentTarget && el.parentElement !== e.currentTarget) return;
              const roll = { karte: cur.id, x: el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth), y: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) };
              rollGemeldet.current = roll;
              ansichtMelden(board.id, cur.id, { x: roll.x, y: roll.y, ...standRef.current });
            }}
            onTouchStart={(e) => { wisch.current = EDITABLE.has(cur.type) || e.touches.length !== 1 ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() }; }}
            onTouchEnd={(e) => {
              const w = wisch.current; wisch.current = null;
              const t = e.changedTouches[0];
              if (!w || !t) return;
              const dx = t.clientX - w.x; const dy = t.clientY - w.y;
              // M402/M403: Ragt der Inhalt seitlich über die Folie, schiebt der Finger ihn – geblättert wird erst, wenn es nichts zu schieben gibt
              const fl = folieRef.current;
              if (fl && fl.scrollWidth > fl.clientWidth + 2) return;
              if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && performance.now() - w.t < 700) { selbst(); schritt(dx < 0 ? 1 : -1); }
            }}>
            <SlideContent key={cur.id} node={cur} />
          </div>
        )
      )}
      <ReinRand an={reinAnsicht.rein} onAus={reinAnsicht.aus} />
      {/* M375: Laser — eine Schicht genau über der Folie (misst sich selbst an ihr aus) */}
      {slides.length > 0 && <FolienLaser boardId={board.id} folie={cur.id} an={laser} senden={ichZeige} />}
      {/* M394: Zeichenschicht über der Folie, Werkzeuge erst, wenn gezeichnet wird, Kommentare als Spalte */}
      {slides.length > 0 && (
        <Suspense fallback={null}>
          <FolienStift folie={cur.id} werkzeug={werkzeug} farbe={werkzeug === 'marker' ? farben.marker : farben.pen} darf={!nurLesen}
            onPin={(id) => { setFaden(id); setKommOffen(true); }} onWisch={(d) => { selbst(); schritt(d); }} />
        </Suspense>
      )}
      {werkzeug && !nurLesen && slides.length > 0 && (
        <div className="folien-palette" data-taste="folien-palette" role="toolbar" aria-label="Zeichnen">
          <button className={werkzeug === 'pen' ? 'an' : ''} data-taste="folien-pen" aria-pressed={werkzeug === 'pen'} title="Stift (P)" aria-label="Stift" onClick={() => setWerkzeug('pen')}><IPen size={16} /></button>
          <button className={werkzeug === 'marker' ? 'an' : ''} data-taste="folien-marker" aria-pressed={werkzeug === 'marker'} title="Textmarker (M)" aria-label="Textmarker" onClick={() => setWerkzeug('marker')}><IHighlighter size={16} /></button>
          <button className={werkzeug === 'eraser' ? 'an' : ''} data-taste="folien-radierer" aria-pressed={werkzeug === 'eraser'} title="Radierer (E)" aria-label="Radierer" onClick={() => setWerkzeug('eraser')}><IEraser size={16} /></button>
          {werkzeug !== 'eraser' && (
            <span className="folien-farben">
              {FOLIEN_FARBEN[werkzeug].map((f, i) => (
                <button key={f} className={`folien-farbe ${farben[werkzeug] === f ? 'an' : ''}`} style={{ background: f }} data-taste="folien-farbe" data-farbe={f}
                  aria-label={`Farbe ${i + 1}`} aria-pressed={farben[werkzeug] === f} onClick={() => setFarben((alt) => ({ ...alt, [werkzeug]: f }))} />
              ))}
            </span>
          )}
          <button data-taste="folien-zurueck" title="Rückgängig (Strg+Z)" aria-label="Rückgängig" onClick={() => useBoard.getState().undo()}><IUndo size={16} /></button>
          <button className="folien-fertig" data-taste="folien-fertig" title="Stift weglegen (Esc)" aria-label="Stift weglegen" onClick={() => setWerkzeug(null)}><ICheck size={16} /></button>
        </div>
      )}
      {kommOffen && slides.length > 0 && (
        <Suspense fallback={null}>
          <FolienKommentare karte={cur.id} seite={art && art !== 'bild' ? seiteHier : null} faden={faden} onFaden={setFaden}
            geheZu={(nr) => { selbst(); setPos({ idx: safeIdx, seite: nr }); }} zu={() => setKommOffen(false)} />
        </Suspense>
      )}
      <div className="presenter-foot">
        {/* aria-disabled statt disabled: Ein Knopf, der mit Tastatur-Fokus „disabled" wird, verschluckt danach alle Tasten (M361) */}
        {/* M405: immer von Karte zu Karte, bei jedem Kartentyp an derselben Stelle – die Seiten eines Dokuments blättert seine eigene Leiste */}
        <button onClick={() => zuKarte(safeIdx - 1)} aria-disabled={amAnfang} data-taste="vortrag-zurueck" title="Vorherige Karte (Strg+←)">‹ Zurück</button>
        <span className="presenter-dots">
          {slides.slice(0, 24).map((s, i) => (
            <button key={s.id} className={i === safeIdx ? 'on' : ''} onClick={() => zuKarte(i)} aria-label={`Folie ${i + 1}`} />
          ))}
        </span>
        <button onClick={() => zuKarte(safeIdx + 1)} aria-disabled={amEnde} data-taste="vortrag-weiter" title="Nächste Karte (Strg+→)">Weiter ›</button>
      </div>
    </div>
  );
}
