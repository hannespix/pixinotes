import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutsideClose } from '../lib/useOutsideClose';
import { useReactFlow } from '@xyflow/react';
import { mutedHistory, useBoard } from '../store';
import { makeCalendar, makeFrame, makeGantt, makeKanban, makeMermaid, makeMinutes, makeNote, makePortal, makeShape, makeSheet, makeTime, makeWeek } from '../lib/nodes';
import { importFilesToBoard, importHtmlAppFromUrl } from '../lib/importFiles';
import { aiReady, kiAbbruchZuruecksetzen } from '../lib/ai';
import { aiBriefing, aiCluster, aiCommand, aiEdges, aiProcess, aiTasks } from '../lib/aiActions';
import { selectActiveBoard } from '../store';
import { uid, type AppNode, type ShapeKind } from '../types';
import { arrangeQuadrantFull, computeArrangement, findFreeSpot, type ArrangeMode } from '../lib/arrange';
import {
  IAppWindow, IArchive, IArrange, IBookmark, ICalendar, ICircles, ICompact, IDiagram, IDiamond, IDownload, IEraser, IFlowH, IFlowV,
  IFolder, IFrame, IGantt, IGridLayout, IGridSnap, IHighlighter, IKanban, ILanes, IMinutes, IMore, IMousePointer, INote,
  ICopy, IImage, IPaperclip, IPen, IPill, IPlay, IPlus, IQuadrant, ISearch, ISigma, ISquare, IStack, ITasks, ITimelineIcon, ITimer, IWand, IWeek, IX,
} from './Icons';
import { ablageNehmen, ablageVerwerfen } from '../lib/kontextmenue';

/**
 * Das Werkzeug-Dock — drei Knöpfe: ＋ öffnet die Modul-Palette (M316: alle
 * Module auf einen Blick, gruppiert, mit Suche — kein zweites Menü mehr),
 * ✎ die Zeichenwerkzeuge, ⋯ alles, was das Board als Ganzes betrifft (KI,
 * Anordnen, Präsentieren, Bild-Export, Einpassen).
 *
 * M312: „Aufgaben" steht in der Navigation (es ist keine Board-Aktion),
 * „Präsentieren" im ⋯ (selten genug), „Aufräumen" war „Fluss horizontal" ein
 * zweites Mal, und „Archiv einblenden" lebt am Fuß des Baums.
 */
export function Dock() {
  const addNode = useBoard((s) => s.addNode);
  const showToast = useBoard((s) => s.showToast);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const setPresenting = useBoard((s) => s.setPresenting);
  const tool = useBoard((s) => s.tool);
  const setTool = useBoard((s) => s.setTool);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [arranging, setArranging] = useState(false);

  /**
   * Aufräumen & Anordnen — reiner Algorithmus (lib/arrange): Cluster nach
   * Verbindungen, Typ-Gruppen für den Rest, Shelf-Packing. Die Karten
   * morphen animiert (cubic-out, leicht gestaffelt) an ihre Zielplätze.
   */
  const [arrangeMenu, setArrangeMenu] = useState(false);
  const setPhysicsEnabled = useBoard((s) => s.setPhysicsEnabled);
  const gridSnap = useBoard((s) => s.gridSnap);
  const setGridSnap = useBoard((s) => s.setGridSnap);
  // Hintergrund-Tönung des aktiven Boards — seit M126 hier statt in der Tab-Leiste
  const setBoardBg = useBoard((s) => s.setBoardBg);
  const activeBoardId = useBoard((s) => s.activeId);
  const activeBoardBg = useBoard((s) => selectActiveBoard(s).bg);

  const arrange = (mode: ArrangeMode) => {
    setArrangeMenu(false);
    if (arranging) return;
    const st = useBoard.getState();
    const board = selectActiveBoard(st);
    if (board.nodes.length < 2) { showToast('Zu wenig Karten zum Anordnen.'); return; }
    // Archivierte Karten bleiben liegen — sie sind meist unsichtbar und sollen
    // beim Aufräumen weder mitmischen noch heimlich verschoben werden
    let targets: Array<[string, number, number]>;
    // M156: Quadrant sortiert die KARTEN neu in vier benannte, umbenennbare
    // Rahmen — Rahmen selbst bleiben außen vor (die Quadranten-Rahmen werden
    // unten neu positioniert, fremde Rahmen stehen gelassen)
    let qBoxes: Array<{ x: number; y: number; w: number; h: number }> | null = null;
    if (mode === 'quadrant') {
      const q = arrangeQuadrantFull(board.nodes.filter((n) => !n.archived && n.type !== 'frame'));
      targets = q.moves;
      qBoxes = q.boxes;
    } else {
      targets = computeArrangement(board.nodes.filter((n) => !n.archived), board.edges, mode);
    }
    // Stapel-Modus: Physik MUSS aus, sonst drückt der nächste Drag alles wieder auseinander
    if (mode === 'stack' && useBoard.getState().physicsEnabled) {
      setPhysicsEnabled(false);
    }
    const starts = new Map(board.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
    st.pushHistory();
    // M156: Quadranten-Rahmen anlegen bzw. wiederverwenden (Namen bleiben frei
    // änderbar — beim nächsten Quadrant-Aufräumen werden sie nur neu platziert)
    if (qBoxes) {
      const names = ['Wichtig & dringend', 'Nur wichtig', 'Nur dringend', 'Später'];
      const QP = 30;
      const QH = 50;
      mutedHistory(() => {
        qBoxes.forEach((b, i) => {
          const fx = b.x - QP;
          const fy = b.y - QH;
          const fw = b.w + QP * 2;
          const fh = b.h + QH + QP;
          const existing = board.nodes.find(
            (n) => n.type === 'frame' && (n.data as { quadrant?: number }).quadrant === i + 1);
          if (existing) {
            st.setNodePositions([[existing.id, fx, fy]]);
            st.resizeNode(existing.id, fw, fh);
          } else {
            st.addNode({
              id: uid(), type: 'frame', width: fw, height: fh, position: { x: fx, y: fy },
              dragHandle: '.frame-head', data: { name: names[i], quadrant: i + 1 },
            } as AppNode);
          }
        });
      });
    }
    // M140: Doppelte Verbindungen (gleiche Richtung zwischen denselben Karten)
    // beim Aufräumen zusammenfassen — die beschriftete Fassung überlebt
    const keep = new Map<string, { id: string; hasLabel: boolean }>();
    const dupes: string[] = [];
    for (const e of board.edges) {
      const key = `${e.source}>${e.target}`;
      const hasLabel = !!(e.data as { label?: string } | undefined)?.label;
      const prev = keep.get(key);
      if (!prev) keep.set(key, { id: e.id, hasLabel });
      else if (hasLabel && !prev.hasLabel) { dupes.push(prev.id); keep.set(key, { id: e.id, hasLabel }); }
      else dupes.push(e.id);
    }
    if (dupes.length) {
      mutedHistory(() => st.onEdgesChange(dupes.map((id) => ({ type: 'remove' as const, id }))));
      showToast(`🧹 ${dupes.length} doppelte Verbindung(en) zusammengefasst.`);
    }
    setArranging(true);
    const DUR = 700;
    const STAGGER = 14; // ms pro Karte — wirkt organisch statt mechanisch
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const t0 = performance.now();
    const step = (now: number) => {
      let done = true;
      const frame: Array<[string, number, number]> = [];
      targets.forEach(([id, tx, ty], i) => {
        const s = starts.get(id);
        if (!s) return;
        const t = Math.min(1, Math.max(0, (now - t0 - i * STAGGER) / DUR));
        if (t < 1) done = false;
        const k = ease(t);
        frame.push([id, s.x + (tx - s.x) * k, s.y + (ty - s.y) * k]);
      });
      useBoard.getState().setNodePositions(frame);
      if (!done) {
        requestAnimationFrame(step);
      } else {
        setArranging(false);
        // M268: Einpass-Obergrenze läuft mit dem Anzeige-Faktor (siehe Board.tsx)
        fitView({ padding: 0.12, duration: 500, maxZoom: useBoard.getState().anzeige ?? 1 });
        const msg = {
          flow: 'Fluss von links nach rechts', flowV: 'Fluss von oben nach unten', lanes: 'Schwimmbahnen je Person',
          timeline: 'Zeitstrahl nach Fristen', compact: 'kompakt gepackt', quadrant: 'Quadrant in vier Rahmen',
          grid: 'Raster nach Modultyp', circles: 'Kreis-Bündel', stack: 'Stapel je Modultyp',
        }[mode];
        showToast(`🧹 Aufgeräumt: ${msg}.`);
      }
    };
    requestAnimationFrame(step);
  };
  const ai = useBoard((s) => s.ai);
  const templates = useBoard((s) => s.templates);
  const removeTemplate = useBoard((s) => s.removeTemplate);
  const focusNode = useBoard((s) => s.focusNode);
  const [addMenu, setAddMenu] = useState(false);
  // M350: Palette ohne Wahl geschlossen — der Ablage-Wunsch vom Rechtsklick verfällt
  useEffect(() => { if (!addMenu) ablageVerwerfen(); }, [addMenu]);
  // M316: Die Modul-Palette — alle Module auf einen Blick, gruppiert, mit
  // Suchfeld. Kein zweites Menü mehr („Weitere Module" aus M296).
  const [suche, setSuche] = useState('');
  const sucheRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (!addMenu) setSuche(''); }, [addMenu]);
  // M326: Drei Finger nach unten (ohne Auswahl) öffnen die Palette
  useEffect(() => {
    const auf = () => { setDrawMenu(false); setAiMenu(false); setArrangeMenu(false); setMoreMenu(false); setAddMenu(true); };
    window.addEventListener('pixinotes:palette', auf);
    return () => window.removeEventListener('pixinotes:palette', auf);
  }, []);
  const [drawMenu, setDrawMenu] = useState(false);
  const [aiMenu, setAiMenu] = useState(false);
  // M198: ⋯-Menü bündelt die selteneren Aktionen (KI, Anordnen, Physik, Archiv) —
  // sichtbar bleiben nur noch fünf Primärknöpfe: ＋ · ✎ · Aufgaben · ⋯ · ▶
  const [moreMenu, setMoreMenu] = useState(false);
  // Hintergrund-Klick/-Tipp schließt alle Dock-Flyouts (User-Wunsch)
  const dockRef = useRef<HTMLDivElement | null>(null);
  const dockMenuOpen = addMenu || drawMenu || aiMenu || arrangeMenu || moreMenu;
  const closeDockMenus = useCallback(() => {
    setAddMenu(false); setDrawMenu(false); setAiMenu(false); setArrangeMenu(false); setMoreMenu(false);
  }, []);
  useOutsideClose(dockMenuOpen, dockRef, closeDockMenus);
  // M192: Esc schließt sie ebenfalls — überall sonst in der App tut es das.
  // Capture-Phase, damit das Menü zuerst schließt und Esc nicht schon vorher
  // die Auswahl aufhebt oder aus dem Board herausfliegt.
  useEffect(() => {
    if (!dockMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // M316: In der Palette leert Esc zuerst die Suche
      if (addMenu && suche) { setSuche(''); return; }
      closeDockMenus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dockMenuOpen, closeDockMenus, addMenu, suche]);
  const [aiBusy, setAiBusy] = useState('');
  const [cmd, setCmd] = useState('');

  /** KI-Aktion aufs ganze Board ausführen (mit Fortschritts-Toast + Fehlerbehandlung) */
  const runAi = async (label: string, fn: (nodes: import('../types').AppNode[], pos: { x: number; y: number }, fortschritt: (m: string) => void) => Promise<string>, restoreCmd?: string) => {
    setAiMenu(false);
    if (!aiReady(ai)) { showToast('Zuerst die KI in den Einstellungen konfigurieren (Ollama, Anthropic, OpenAI …).'); setSettingsOpen(true); return; }
    // GLOBALE Sperre: auch die Auswahl-Leiste darf währenddessen nichts starten
    if (useBoard.getState().aiBusy) { showToast('Eine KI-Aktion läuft bereits — kurz warten.'); return; }
    useBoard.getState().setAiBusy(true);
    kiAbbruchZuruecksetzen();
    setAiBusy(label);
    showToast('✨ KI analysiert das Board …', false, 120000, true);
    try {
      const st = useBoard.getState();
      const nodes = selectActiveBoard(st).nodes;
      // M332: Stapel-Aktionen melden ihren Fortschritt; der Toast bietet „Abbrechen"
      const fortschritt = (m: string) => showToast(`✨ KI: ${m}`, false, 180000, true);
      const msg = await fn(nodes, screenToFlowPosition({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 120 }), fortschritt);
      showToast(`✨ ${msg}`, false, msg.includes('⚠️') || msg.startsWith('Abgebrochen') ? 12000 : 5000);
    } catch (e) {
      showToast(`KI-Aktion fehlgeschlagen: ${(e as Error).message}`, false, 8000);
      // Freitext-Eingabe bei Fehler zurückgeben — nicht neu tippen müssen
      if (restoreCmd) setCmd(restoreCmd);
    } finally {
      setAiBusy('');
      useBoard.getState().setAiBusy(false);
    }
  };

  // Wunschposition Bildmitte — aber nie ÜBER bestehende Karten (M130):
  // findFreeSpot weicht auf die nächste freie Stelle aus
  const centerPos = (w = 260, h = 80) => {
    // M350: ‚Modul hier einfügen‘ (Rechtsklick) legt es dorthin, wo geklickt wurde
    const hier = ablageNehmen();
    const p = screenToFlowPosition(hier ? { x: hier.x - 12, y: hier.y - 12 } : { x: window.innerWidth / 2 - w / 2, y: window.innerHeight / 2 - h / 2 });
    return findFreeSpot(selectActiveBoard(useBoard.getState()).nodes, p, { w, h });
  };

  /** Modul anlegen + direkt hinfliegen (Pan & Zoom über die pendingFocus-Mechanik) */
  const add = (make: () => AppNode) => {
    const node = make();
    addNode(node);
    focusNode(useBoard.getState().activeId, node.id);
    setAddMenu(false);
  };
  const addShape = (shape: ShapeKind) => add(() => makeShape(centerPos(150, 70), shape));

  // Datei einfügen (M159): der Dialog-Weg für ALLE integrierbaren Typen —
  // am Smartphone gibt es kein Drag & Drop, dieser Weg ist dort der einzige
  const anyFileRef = useRef<HTMLInputElement | null>(null);
  /**
   * M254: Eigene Eingabe nur für Bilder.
   *
   * Auf iPhone und iPad entscheidet `accept` darüber, WAS das System anbietet:
   * Mit `image/*` erscheinen „Fotomediathek" und „Foto aufnehmen" ganz oben —
   * ohne dieses Attribut landet man zuerst in der Dateien-App und muss sich
   * zur Mediathek durchhangeln. Genau daran scheiterte das Einfügen von Fotos.
   */
  const fotoRef = useRef<HTMLInputElement | null>(null);
  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setAddMenu(false);
    const placed = await importFilesToBoard(Array.from(list), centerPos(320, 200));
    if (placed > 1) showToast(`${placed} Dateien eingefügt.`);
  };

  // App von URL (M164): Kopie laden, wenn die Quelle es erlaubt — sonst live
  const addHtmlAppUrl = async () => {
    const url = window.prompt('Adresse (URL) der HTML-App — z. B. ein Tool auf GitHub:');
    setAddMenu(false);
    if (!url?.trim()) return;
    await importHtmlAppFromUrl(url, centerPos(560, 440));
  };

  /**
   * M254: Bild aus der Zwischenablage holen.
   *
   * Der Weg für iPhone/iPad, weil iOS Web-Apps NICHT in sein Teilen-Menü
   * aufnimmt (das kann dort nur eine echte App aus dem Store). In der Fotos-App
   * „Kopieren" antippen, hier auf den Knopf — fertig. Am PC macht Strg+V
   * dasselbe; der Knopf ist für alle da, die keine Tastatur haben.
   */
  const ausZwischenablage = async () => {
    closeDockMenus();
    try {
      const eintraege = await navigator.clipboard.read();
      const dateien: File[] = [];
      for (const e of eintraege) {
        const typ = e.types.find((t) => t.startsWith('image/'));
        if (!typ) continue;
        const blob = await e.getType(typ);
        dateien.push(new File([blob], `Einfügen.${typ.split('/')[1] || 'png'}`, { type: typ }));
      }
      if (!dateien.length) {
        showToast('In der Zwischenablage liegt gerade kein Bild.');
        return;
      }
      await addFiles(dateien as unknown as FileList);
    } catch {
      showToast('Die Zwischenablage ist nicht freigegeben, das Bild mit Strg+V einfügen.');
    }
  };

  // Eigene App (M158): HTML-Datei über den Datei-Dialog wählen — läuft seit
  // M159 durch dieselbe Import-Pipeline (inkl. Kopie in den Team-Ordner)
  const happFileRef = useRef<HTMLInputElement | null>(null);
  const addHtmlApp = async (f: File | undefined) => {
    if (!f) return;
    setAddMenu(false);
    await importFilesToBoard([f], centerPos(560, 440));
  };
  const pickTool = (t: typeof tool) => { setTool(t); setDrawMenu(false); };
  const drawing = tool !== 'select';

  /**
   * M316: Die Modul-Palette. Jedes Modul hat genau einen Platz in einer von
   * fünf Gruppen — nach dem, was man damit TUT, nicht nach Technik. Die Suche
   * findet über Name, Hinweis und Stichwörter (z. B. „Excel" → Rechen-Tabelle).
   */
  type Modul = { id: string; name: string; gruppe: string; hinweis?: string; suchwort?: string; icon: JSX.Element; tun: () => void };
  const module: Modul[] = [
    { id: 'notiz', gruppe: 'Notieren & Rechnen', name: 'Notiz', suchwort: 'text schreiben markdown checkliste', icon: <INote size={18} />, tun: () => add(() => makeNote(centerPos())) },
    {
      id: 'tagesnotiz', gruppe: 'Notieren & Rechnen', name: 'Tagesnotiz', hinweis: 'Notiz mit dem heutigen Datum als Überschrift', suchwort: 'heute datum journal tagebuch',
      icon: <ICalendar size={18} />,
      tun: () => add(() => {
        const heading = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        return makeNote(centerPos(), {
          color: 'white',
          blocks: [
            { type: 'heading', props: { level: 3 }, content: heading },
            { type: 'paragraph', content: '' },
          ],
        });
      }),
    },
    { id: 'protokoll', gruppe: 'Notieren & Rechnen', name: 'Protokoll-Reihe', hinweis: 'Alle Sitzungen einer Besprechung in einer Karte', suchwort: 'besprechung sitzung meeting minutes', icon: <IMinutes size={18} />, tun: () => add(() => makeMinutes(centerPos(380, 420))) },
    { id: 'tabelle', gruppe: 'Notieren & Rechnen', name: 'Rechen-Tabelle', hinweis: 'Tabelle, die rechnet — Excel-Dateien lassen sich auch aufs Board ziehen', suchwort: 'excel csv summe zahlen', icon: <ISigma size={18} />, tun: () => add(() => makeSheet(centerPos(460, 300))) },
    { id: 'kanban', gruppe: 'Planen', name: 'Kanban-Board', hinweis: 'Spalten und Karten: Offen, In Arbeit, Erledigt', suchwort: 'aufgaben todo spalten tickets', icon: <IKanban size={18} />, tun: () => add(() => makeKanban(centerPos(420, 200))) },
    { id: 'zeitplan', gruppe: 'Planen', name: 'Zeitplan', hinweis: 'Zeitplan (Gantt): Vorgänge als Balken auf der Zeitachse', suchwort: 'gantt projekt termine balken', icon: <IGantt size={18} />, tun: () => add(() => makeGantt(centerPos(560, 240))) },
    { id: 'kalender', gruppe: 'Planen', name: 'Kalender', hinweis: 'Kalender (Monat), auch mit Google- und Microsoft-Terminen', suchwort: 'monat termine', icon: <ICalendar size={18} />, tun: () => add(() => makeCalendar(centerPos(430, 340))) },
    { id: 'woche', gruppe: 'Planen', name: 'Wochenplan', hinweis: 'Stundenraster: Tage als Spalten, Uhrzeiten als Zeilen', suchwort: 'stunden woche stundenplan', icon: <IWeek size={18} />, tun: () => add(() => makeWeek(centerPos(620, 440))) },
    { id: 'zeit', gruppe: 'Planen', name: 'Zeiterfassung', hinweis: 'Arbeitszeit per Start/Stop erfassen', suchwort: 'stoppuhr timer arbeitszeit', icon: <ITimer size={18} />, tun: () => add(() => makeTime(centerPos(460, 380))) },
    { id: 'diagramm', gruppe: 'Ablauf', name: 'Diagramm', hinweis: 'Diagramm (Mermaid): Flussdiagramm, Mindmap, Sequenz …', suchwort: 'mermaid mindmap fluss sequenz chart', icon: <IDiagram size={18} />, tun: () => add(() => makeMermaid(centerPos(380, 240))) },
    { id: 'schritt', gruppe: 'Ablauf', name: 'Schritt', hinweis: 'Prozess-Schritt (Rechteck) — verbinden per Ziehen am Rand', suchwort: 'prozess form rechteck kasten', icon: <ISquare size={18} />, tun: () => addShape('process') },
    { id: 'entscheidung', gruppe: 'Ablauf', name: 'Entscheidung', hinweis: 'Entscheidung (Raute): ja / nein', suchwort: 'raute ja nein verzweigung', icon: <IDiamond size={18} />, tun: () => addShape('decision') },
    { id: 'start', gruppe: 'Ablauf', name: 'Start/Ende', hinweis: 'Start oder Ende eines Ablaufs', suchwort: 'terminator anfang schluss', icon: <IPill size={18} />, tun: () => addShape('terminator') },
    { id: 'datei', gruppe: 'Einfügen', name: 'Datei oder Bild', hinweis: 'Bilder, PDFs, E-Mails, Excel, Word und mehr', suchwort: 'pdf upload anhang dokument foto', icon: <IPaperclip size={18} />, tun: () => anyFileRef.current?.click() },
    { id: 'foto', gruppe: 'Einfügen', name: 'Foto', hinweis: 'Foto aufnehmen oder aus der Mediathek wählen (iPhone/iPad)', suchwort: 'kamera mediathek bild aufnehmen', icon: <IImage size={18} />, tun: () => fotoRef.current?.click() },
    { id: 'zwischenablage', gruppe: 'Einfügen', name: 'Zwischen\u00adablage', hinweis: 'Bild aus der Zwischenablage einfügen (am PC: Strg+V)', suchwort: 'einfügen paste screenshot kopiert', icon: <ICopy size={18} />, tun: () => void ausZwischenablage() },
    { id: 'app', gruppe: 'Einfügen', name: 'Eigene App', hinweis: 'Eine HTML-Datei als lauffähige App-Karte', suchwort: 'html widget programm', icon: <IAppWindow size={18} />, tun: () => happFileRef.current?.click() },
    { id: 'appurl', gruppe: 'Einfügen', name: 'App von URL', hinweis: 'HTML-App von einer Internet-Adresse', suchwort: 'link einbetten web adresse', icon: <IAppWindow size={18} />, tun: () => void addHtmlAppUrl() },
    { id: 'rahmen', gruppe: 'Ordnen', name: 'Rahmen', hinweis: 'Benannter Rahmen auf dem Board, nimmt seine Karten mit — nicht der Bereich in der Übersicht', suchwort: 'gruppe bereich zusammenfassen', icon: <IFrame size={18} />, tun: () => add(() => makeFrame(centerPos(640, 420))) },
    { id: 'portal', gruppe: 'Ordnen', name: 'Portal', hinweis: 'Portal zu einem anderen Board', suchwort: 'link verweis board sprung', icon: <IFolder size={18} />, tun: () => { add(() => makePortal(centerPos(200, 140))); showToast('Portal: verlinke ein anderes Board.'); } },
  ];
  const GRUPPEN = ['Notieren & Rechnen', 'Planen', 'Ablauf', 'Einfügen', 'Ordnen'];
  const q = suche.trim().toLowerCase();
  const passt = (m: Modul) => !q || `${m.name} ${m.hinweis ?? ''} ${m.suchwort ?? ''}`.toLowerCase().includes(q);
  const treffer = module.filter(passt);
  const vorlagenTreffer = templates.filter((t) => !q || t.name.toLowerCase().includes(q));
  const vorlageEinfuegen = (t: (typeof templates)[number]) => add(() => {
    const clone = JSON.parse(JSON.stringify(t.node)) as AppNode;
    const size = { w: clone.width ?? 260, h: clone.height ?? 120 };
    return { ...clone, id: uid(), position: centerPos(size.w, size.h), selected: false };
  });
  const grobeZeiger = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  return (
    <div className="dock" ref={dockRef}>
      {addMenu && (
        <div className="dock-menu modul-palette" role="dialog" aria-label="Modul hinzufügen">
          <div className="modul-suche">
            <ISearch size={14} />
            <input
              ref={sucheRef}
              type="search"
              value={suche}
              placeholder="Modul suchen …"
              aria-label="Modul suchen"
              autoFocus={!grobeZeiger}
              onChange={(e) => setSuche(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (treffer[0]) treffer[0].tun();
                  else if (vorlagenTreffer[0]) vorlageEinfuegen(vorlagenTreffer[0]);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  (e.currentTarget.closest('.modul-palette')?.querySelector('.modul-kachel') as HTMLElement | null)?.focus();
                }
              }}
            />
          </div>
          {GRUPPEN.map((g) => {
            const liste = treffer.filter((m) => m.gruppe === g);
            if (liste.length === 0) return null;
            return (
              <div key={g} className="modul-gruppe">
                <div className="dock-menu-label">{g}</div>
                <div className="modul-raster">
                  {liste.map((m) => (
                    <button key={m.id} className="modul-kachel" data-modul={m.id} title={m.hinweis} onClick={m.tun}>
                      {m.icon}
                      <span>{m.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {vorlagenTreffer.length > 0 && (
            <div className="modul-gruppe">
              <div className="dock-menu-label">Vorlagen</div>
              <div className="modul-raster">
                {vorlagenTreffer.map((t) => (
                  <button key={t.id} className="modul-kachel modul-vorlage" title="Vorlage als neue Karte einfügen" onClick={() => vorlageEinfuegen(t)}>
                    <IBookmark size={18} />
                    <span>{t.name}</span>
                    <span
                      className="dock-menu-template-x"
                      role="button"
                      title="Vorlage löschen"
                      aria-label={`Vorlage „${t.name}" löschen`}
                      onClick={(e) => { e.stopPropagation(); removeTemplate(t.id); }}
                    >
                      <IX size={11} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {treffer.length === 0 && vorlagenTreffer.length === 0 && (
            <div className="modul-leer">Nichts gefunden. Dateien lassen sich auch direkt aufs Board ziehen.</div>
          )}
          <div className="dock-menu-foot">Dateien und E-Mails einfach aufs Board ziehen · Strg+V für Screenshots</div>
        </div>
      )}
      <div className="dock-add-wrap">
        <button
          className={addMenu ? 'active' : ''}
          onClick={() => { const o = addMenu; closeDockMenus(); setAddMenu(!o); }}
          title="Objekt hinzufügen"
          aria-label="Objekt hinzufügen"
        >
          <IPlus />
        </button>
      </div>

      {/* Zeichenwerkzeuge als Flyout — ein Slot statt drei */}
      <div className="dock-add-wrap">
        {drawMenu && (
          <div className="dock-menu dock-menu-draw">
            <button className={tool === 'pen' ? 'on' : ''} onClick={() => pickTool('pen')}><IPen size={16} /> Stift</button>
            <button className={tool === 'marker' ? 'on' : ''} onClick={() => pickTool('marker')}><IHighlighter size={16} /> Textmarker</button>
            <button className={tool === 'eraser' ? 'on' : ''} onClick={() => pickTool('eraser')}><IEraser size={16} /> Radierer</button>
            <button onClick={() => pickTool('select')}><IMousePointer size={16} /> Auswahl (Esc)</button>
          </div>
        )}
        <button
          className={drawing ? 'active' : ''}
          onClick={() => { const o = drawMenu; closeDockMenus(); setDrawMenu(!o); }}
          data-taste="zeichnen"
          title="Zeichnen (Stift, Textmarker, Radierer)"
          aria-label="Zeichnen"
        >
          {tool === 'marker' ? <IHighlighter /> : tool === 'eraser' ? <IEraser /> : <IPen />}
        </button>
      </div>

      {/* M198: ⋯ „Mehr" — das Board-Menü. Die beiden großen Untermenüs (KI,
          Anordnen) öffnen als eigene Flyouts am selben Anker — maximal zwei Ebenen. */}
      <div className="dock-add-wrap">
        {moreMenu && (
          <div className="dock-menu dock-menu-more">
            <button
              onClick={() => { setMoreMenu(false); setAiMenu(true); }}
              title="KI-Assistent (Clustern, Aufgaben, Briefing …)"
              aria-label="KI-Assistent"
            >
              <IWand size={16} /> KI-Assistent …
            </button>
            {/* Die neun Anordnungen, Gitter und Hintergrund liegen in einem Flyout;
                die Voreinstellung (Fluss horizontal) steht dort an erster Stelle. */}
            <button
              onClick={() => { setMoreMenu(false); setArrangeMenu(true); }}
              disabled={arranging}
              title="Anordnung wählen, Gitter, Hintergrund"
              aria-label="Anordnen"
            >
              <IArrange size={16} /> Anordnen &amp; Hintergrund …
            </button>
            <div className="dock-menu-label">Board</div>
            <button
              onClick={() => { setMoreMenu(false); setPresenting(true); }}
              data-taste="praesentieren"
              title="Präsentationsmodus (Karten als Folien)"
              aria-label="Präsentieren"
            >
              <IPlay size={16} /> Präsentieren
            </button>
            {/* M300: Der Bild-Export gehört zum Board, nicht in die Einstellungen —
                er braucht das Board auf dem Schirm (er fotografiert die Fläche). */}
            <button
              onClick={() => { setMoreMenu(false); useBoard.getState().setBildExportOpen(true); }}
              title="Als Bild exportieren"
              aria-label="Als Bild exportieren"
            >
              <IDownload size={16} /> Als Bild exportieren …
            </button>
            <button
              onClick={() => { setMoreMenu(false); void fitView({ padding: 0.2, duration: 350 }); }}
              title="Alle Karten ins Bild holen (Taste F)"
              aria-label="Alles einpassen"
            >
              <ICompact size={16} /> Alles einpassen
            </button>
          </div>
        )}
        {aiMenu && (
          <div className="dock-menu dock-menu-ai">
            <div className="dock-menu-label">Freitext-Anweisung</div>
            <textarea
              className="ai-cmd-input"
              rows={2}
              placeholder={'z. B. „Erstelle einen Wochenplan als Kanban" oder „Fasse alle Notizen zu einer zusammen"'}
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && cmd.trim() && !aiBusy) {
                  e.preventDefault();
                  const wish = cmd;
                  setCmd('');
                  runAi('cmd', (n, p, f) => aiCommand(wish, n, p, f), wish);
                }
              }}
            />
            <button
              className="ai-cmd-go"
              disabled={!!aiBusy || !cmd.trim()}
              onClick={() => { const wish = cmd; setCmd(''); runAi('cmd', (n, p, f) => aiCommand(wish, n, p, f), wish); }}
            >
              <IWand size={14} /> Ausführen (erstellen, ändern, verbessern …)
            </button>
            <div className="dock-menu-label">KI-Assistent (ganzes Board)</div>
            <button
              disabled={!!aiBusy}
              onClick={() => { setAiMenu(false); useBoard.getState().setRechercheOpen(true); }}
              title="Recherche mit echten Quellen: Wikipedia, Wikivoyage, Wetter (Open-Meteo) — mit Rückfragen-Dialog"
            >
              🔎 Recherche mit Quellen …
            </button>
            <button disabled={!!aiBusy} onClick={() => runAi('cluster', (n) => aiCluster(n))}>Themen clustern &amp; anordnen</button>
            <button disabled={!!aiBusy} onClick={() => runAi('tasks', aiTasks)}>Aufgaben &amp; Termine extrahieren</button>
            <button disabled={!!aiBusy} onClick={() => runAi('process', aiProcess)}>Workflow als Diagramm ableiten</button>
            <button disabled={!!aiBusy} onClick={() => runAi('brief', aiBriefing)}>Analytisches Briefing erstellen</button>
            <button disabled={!!aiBusy} onClick={() => runAi('edges', (n) => aiEdges(n))}>Verbindungen vorschlagen</button>
            <div className="dock-menu-foot">
              {aiReady(ai)
                ? 'Nicht destruktiv: legt neue Karten an bzw. ordnet nur an — Strg+Z macht alles rückgängig.'
                : 'KI zuerst in den Einstellungen wählen — „Gratis" geht ohne Schlüssel, Ollama = alles lokal.'}
            </div>
          </div>
        )}
        {arrangeMenu && (
          <div className="dock-menu dock-menu-arrange">
            <div className="dock-menu-label">Anordnungs-Modus</div>
            <button onClick={() => arrange('flow')} title="Verbundene Karten als Prozess von links nach rechts, der Rest als Typ-Gruppen"><IFlowH size={15} /> Fluss horizontal</button>
            <button onClick={() => arrange('flowV')} title="Verbundene Karten als Prozess von oben nach unten, der Rest als Typ-Gruppen"><IFlowV size={15} /> Fluss vertikal</button>
            <button onClick={() => arrange('grid')} title="Alles in ein sauberes Raster, sortiert nach Modultyp"><IGridLayout size={15} /> Raster</button>
            <button onClick={() => arrange('compact')} title="Minimale Fläche — dicht gepackt, ideal vor dem Bild-Export"><ICompact size={15} /> Kompakt packen</button>
            <button onClick={() => arrange('lanes')} title="Eine Bahn pro Person (Eigenschaft wer/who oder Personen aus Tickets/Zeitplänen)"><ILanes size={15} /> Schwimmbahnen (Personen)</button>
            <button onClick={() => arrange('timeline')} title="Karten mit Fristen chronologisch von links nach rechts, Undatiertes darunter"><ITimelineIcon size={15} /> Zeitstrahl (Fristen)</button>
            <button onClick={() => arrange('quadrant')} title="Eisenhower: links oben wichtig+dringend · rechts oben wichtig · links unten dringend · rechts unten Rest"><IQuadrant size={15} /> Quadrant (wichtig/dringend)</button>
            <button onClick={() => arrange('circles')} title="Zusammenhängendes und Typ-Gruppen jeweils als Kreis-Bündel"><ICircles size={15} /> Kreis-Bündel</button>
            <button onClick={() => arrange('stack')} title="Karten pro Modultyp überlappend stapeln — Überschriften bleiben sichtbar; Physik wird dafür ausgeschaltet"><IStack size={15} /> Stapeln (überlappend)</button>
            <div className="dock-menu-label">Raster</div>
            <button
              className={gridSnap ? 'active' : ''}
              onClick={() => {
                setGridSnap(!gridSnap);
                showToast(gridSnap
                  ? '⊞ Gitter aus — Karten bewegen sich wieder frei.'
                  : '⊞ Gitter an — Karten rasten beim Verschieben am Raster ein.');
              }}
              title="Linien-Gitter anzeigen und Karten beim Verschieben am Raster einrasten lassen"
            >
              <IGridSnap size={15} /> Gitter &amp; Raster-Fang {gridSnap ? 'AUS' : 'AN'}
            </button>
            <div className="dock-menu-label">Board-Hintergrund</div>
            <div className="tab-bg-swatches">
              {([
                [undefined, 'Standard'], ['grau', 'Grau'], ['blau', 'Blau'], ['gelb', 'Gelb'],
                ['gruen', 'Grün'], ['rosa', 'Rosa'], ['flieder', 'Flieder'],
              ] as Array<[string | undefined, string]>).map(([key, label]) => (
                <button
                  key={label}
                  className={`tab-bg-swatch bg-${key ?? 'none'} ${activeBoardBg === key ? 'on' : ''}`}
                  title={label}
                  aria-label={`Hintergrund ${label}`}
                  onClick={() => setBoardBg(activeBoardId, key)}
                />
              ))}
            </div>
            <div className="dock-menu-foot">Strg+Z stellt die vorherige Anordnung komplett wieder her</div>
          </div>
        )}
        <button
          className={moreMenu || aiMenu || arrangeMenu || arranging || aiBusy ? 'active' : ''}
          onClick={() => { const o = moreMenu || aiMenu || arrangeMenu; closeDockMenus(); setMoreMenu(!o); }}
          title="Mehr"
          aria-label="Mehr"
        >
          <IMore />
        </button>
      </div>

      <input
        ref={happFileRef}
        type="file"
        accept=".html,.htm,text/html"
        style={{ display: 'none' }}
        onChange={(e) => { void addHtmlApp(e.target.files?.[0]); e.target.value = ''; }}
      />
      <input
        ref={fotoRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={anyFileRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
