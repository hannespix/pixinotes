import { nachLazy } from '../lib/nachLazy';
import { fokusAnsicht, fokusAnsichtMarkieren, fokusStufeLoesen, fokusZoomFuer, FOKUS_ANSICHT_EREIGNIS, FOKUS_ZOOM_EREIGNIS } from '../lib/fokusAnsicht';
import { overlayOffen } from '../lib/overlay';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStoreApi,
  useUpdateNodeInternals,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import { fangAktiv, fangen, fangSetzen, groesseFangen, type Kasten } from '../lib/fang';
import { zugSetzen } from '../lib/zugAnzeige';
import { sichtbaresBoardMuster } from '../lib/boardMuster';
import { ablegenGenauAn } from '../lib/ablegenGenau';
import { Fanglinien } from './Fanglinien';
import { AnsichtPortal } from './AnsichtPortal';
import { LiveSperren, LiveZeigerSpaet } from './LiveLeiste';
import { PunkteMarkenSpaet } from './PunkteSpaet';
import { useBoardTasten } from './boardTasten';
import { leeresStartboard, mutedHistory, runDerived, selectActiveBoard, selectNurLesen, useBoard } from '../store';
import { DOKUMENT_BEFEHL, SEITEN_EREIGNIS, seiteVon } from '../lib/pdfSeiten';
import { frameMembers, sizeOf } from '../lib/arrange';
import { RAHMEN_MIN, rahmenAuto, rahmenWachsen } from '../lib/frameOps';
import { bildMasse, imageFileToDataUrl } from '../lib/image';
import { canEmbed, makeImage, makeNote } from '../lib/nodes';
import { textZuBloecken } from '../lib/notiz';
import { importFilesToBoard } from '../lib/importSpaet';
import type { AppNode } from '../types';
import { NoteCard } from './nodes/NoteCard';
import { EmailCard } from './nodes/EmailCard';
import { ImageCard } from './nodes/ImageCard';
import { boardZoomMelden, modulAusschnitt } from '../lib/boardZoom';
import { bedienMass, BOARD_ZOOM_MAX, BOARD_ZOOM_MIN, radAnteil, radSchritt } from '../lib/radZoom';
import { FileCard } from './nodes/FileCard';
import { PortalCard } from './nodes/PortalCard';
import { FrameCard } from './nodes/FrameCard';
import { EdgeMarkerDefs, LabeledEdge } from './LabeledEdge';
import { focusable } from './FocusSheet';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * M228: „Karte im Fokus" gilt jetzt auf ALLEN Geräten.
 *
 * Vorher gab es zwei Mechanismen für dieselbe Absicht — am Handy öffnete ein
 * Tipp die Karte formatfüllend, am Desktop flog die Ansicht zu ihr hin. Zwei
 * Wege zum selben Ziel sind genau die Verwirrung, über die man stolpert
 * („warum sieht das hier anders aus als dort?"). Geblieben ist der Fokus: Er
 * hat Kopfzeile, Blättern, alle Karten-Werkzeuge und den Flug, der zeigt,
 * welche Karte gemeint ist. Am Desktop erscheint er nicht randlos, sondern als
 * großes Blatt über dem Board (siehe Stylesheet) — dort ist der Zusammenhang
 * zum Board wertvoll, am Telefon wäre er verschenkter Platz.
 *
 * M490: Den Klick-Zoom (Ansicht fliegt zur angeklickten Karte) gibt es nicht mehr — seit M314 ist der
 * Fokus immer an und hat ihn verdrängt; hinfliegen tun Doppelklick (Fokus), Suche und Übersicht.
 */
const isPhoneFocus = () => window.matchMedia('(pointer: coarse)').matches;

/** M296: Ab so vielen Karten zeigt das Board seine Minimap */
const MINIMAP_AB = 10;

const HINTERGRUND_MUSTER = {
  dots: { variant: BackgroundVariant.Dots, gap: 26, size: 1.6 },
  linien: { variant: BackgroundVariant.Lines, gap: 20, lineWidth: 0.6 },
  kreuze: { variant: BackgroundVariant.Cross, gap: 26, size: 5, lineWidth: 0.7 },
} as const;

/** Mit Maus: Doppelklick öffnet den Fokus (siehe onNodeDoubleClick) */
const istMaus = () => window.matchMedia('(pointer: fine)').matches;
import { DrawingLayer } from './DrawingLayer';
import { FingerGesten } from './FingerGesten';
import { BoardKontextmenue } from './Kontextmenue';
import { RahmenReiseHost } from './RahmenReiseHost';
import { REISE_RUHT, reiseFliegt } from '../lib/rahmenReise';
import { fristenLaden } from '../lib/dates';
import { rufnummernLaden } from '../lib/rufnummer';
import { EINGANG_ZIEHEN, eingangHolen, eingangZielWeg } from '../lib/eingang';

/** M213: Jede Karte bekommt ihre eigene Fehlergrenze. Stolpert eine — etwa
 *  über kaputte Daten aus einem Import —, bleibt der Schaden auf sie
 *  beschränkt, statt das ganze Board weiß werden zu lassen. Der Wrapper wird
 *  EINMAL auf Modulebene gebaut; täte man das im Render, remounteten bei jeder
 *  Änderung sämtliche Karten (und BlockNote verlöre den Editor-Zustand). */
const guard = <P extends object>(C: React.ComponentType<P>, mitLage = false): React.ComponentType<P> => {
  const Guarded = (props: P) => (
    <ErrorBoundary what="Diese Karte"><C {...props} /></ErrorBoundary>
  );
  Guarded.displayName = `Guarded(${C.displayName ?? C.name ?? 'Card'})`;
  // M525: React Flow reicht jeder Karte ihre Lage herein (positionAbsoluteX/Y) — beim Ziehen ändert die sich mit jeder
  // Mausbewegung, und die gezogene Karte zeichnete ihren ganzen Inhalt jedes Mal neu (ein Kanban mit hundert Tickets,
  // ein Editor, ein Tool). Verschoben wird sie per CSS an ihrer Hülle; der Inhalt hängt nicht an der Lage. Nur wer sie
  // wirklich liest, meldet sich mit `mitLage` (E-Mail: legt Anhänge neben die Karte).
  return mitLage ? Guarded : memo(Guarded, ohneLageGleich) as unknown as React.ComponentType<P>;
};
const ohneLageGleich = (a: object, b: object): boolean => {
  const x = a as Record<string, unknown>; const y = b as Record<string, unknown>;
  for (const k in y) if (x[k] !== y[k] && k !== 'positionAbsoluteX' && k !== 'positionAbsoluteY') return false;
  for (const k in x) if (!(k in y)) return false;
  return true;
};

/**
 * M446: Seltenere Kartentypen kommen erst, wenn eine solche Karte auf dem Board liegt (oder angelegt wird) —
 * Kanban, Gantt, Kalender, Tabelle, Diagramm & Co. gehören nicht in den Start. Notiz, E-Mail, Bild, Datei,
 * Rahmen und Portal bleiben fest dabei: Sie sind auf fast jedem Board und sollen ohne Verzug stehen.
 * Bis der Teil da ist (lokal wenige Millisekunden), steht an der Stelle eine leere Fläche in Kartengröße —
 * kein Spinner, kein Text, damit nichts flackert. `kartenVorladen()` holt alle Teile kurz nach dem Start im
 * Leerlauf nach, damit das Anlegen später ohne Wartezeit geht und der Service Worker sie auch offline hat.
 */
/** M459: Karten, die Fristen bzw. Rufnummern lesen, kommen erst mit der (nachgeladenen) Erkennung — kein Nachrücken */
const mitFristen = <T,>(teil: Promise<T>): Promise<T> => Promise.all([teil, fristenLaden().catch(() => {})]).then(([t]) => t);
const KARTEN_LADER = {
  kanban: () => mitFristen(import('./nodes/KanbanCard').then((m) => m.KanbanCard)),
  shape: () => import('./nodes/ShapeCard').then((m) => m.ShapeCard),
  mermaid: () => import('./nodes/MermaidCard').then((m) => m.MermaidCard),
  gantt: () => mitFristen(import('./nodes/GanttCard').then((m) => m.GanttCard)),
  calendar: () => mitFristen(import('./nodes/CalendarCard').then((m) => m.CalendarCard)),
  week: () => import('./nodes/WeekCard').then((m) => m.WeekCard),
  sheet: () => import('./nodes/SheetCard').then((m) => m.SheetCard),
  minutes: () => import('./nodes/MinutesCard').then((m) => m.MinutesCard),
  time: () => import('./nodes/TimeCard').then((m) => m.TimeCard),
  htmlapp: () => import('./nodes/HtmlAppCard').then((m) => m.HtmlAppCard),
  bubbles: () => import('./nodes/BubblesCard').then((m) => m.BubblesCard),
  kontakt: () => Promise.all([import('./nodes/KontaktCard'), rufnummernLaden().catch(() => {})]).then(([m]) => m.KontaktCard),
  // M500: die Karte selbst ist klein — die Engine (WebGL2) holt sie erst, wenn sie sichtbar wird
  fluessig: () => import('./nodes/FluessigCard').then((m) => m.FluessigCard),
  pixi: () => import('./nodes/PixiCard').then((m) => m.PixiCard),
} satisfies Record<string, () => Promise<React.ComponentType<any>>>;

/**
 * M544: Nach dem Nachladen die Anschlusspunkte neu vermessen. React Flow merkt sich je Karte, wo ihre Anschlusspunkte
 * liegen, und misst nur neu, wenn sich die Größe ändert. Der Platzhalter hat keine Anschlusspunkte und dieselbe Größe
 * wie die fertige Karte (Breite/Höhe stehen fest) — von solchen Karten ließ sich darum kein Pfeil ziehen (Kanban,
 * Diagramm, Tabelle, Gantt, Kalender, Form, HTML-Tool, flüssige Schrift …), Pfeile zu ihnen gingen. Steht im selben
 * Suspense wie die Karte: er hängt sich erst ein, wenn sie da ist.
 */
function AnschluesseVermessen({ id }: { id: string }) {
  const vermessen = useUpdateNodeInternals();
  useEffect(() => { vermessen(id); }, [id, vermessen]);
  return null;
}

const spaet = (laden: () => Promise<React.ComponentType<any>>): React.ComponentType<any> => {
  const Teil = nachLazy(() => laden().then((C) => ({ default: C })));
  const Spaet = (props: { id: string }) => (
    <Suspense fallback={<div className="karte-laedt" aria-hidden="true" />}><Teil {...props} /><AnschluesseVermessen id={props.id} /></Suspense>
  );
  return Spaet;
};

/** M446: alle nachgeladenen Kartentypen holen (im Leerlauf nach dem Start, siehe App.tsx) */
export function kartenVorladen(): Promise<unknown> {
  return Promise.all(Object.values(KARTEN_LADER).map((l) => l().catch(() => null)));
}

const nodeTypes: NodeTypes = {
  note: guard(NoteCard),
  email: guard(EmailCard, true),   // M525: liest ihre Lage (Anhang als Karte daneben)
  image: guard(ImageCard),
  file: guard(FileCard),
  kanban: guard(spaet(KARTEN_LADER.kanban)),
  portal: guard(PortalCard),
  shape: guard(spaet(KARTEN_LADER.shape)),
  mermaid: guard(spaet(KARTEN_LADER.mermaid)),
  gantt: guard(spaet(KARTEN_LADER.gantt)),
  calendar: guard(spaet(KARTEN_LADER.calendar)),
  frame: guard(FrameCard),
  week: guard(spaet(KARTEN_LADER.week)),
  sheet: guard(spaet(KARTEN_LADER.sheet)),
  minutes: guard(spaet(KARTEN_LADER.minutes)),
  time: guard(spaet(KARTEN_LADER.time)),
  htmlapp: guard(spaet(KARTEN_LADER.htmlapp)),
  bubbles: guard(spaet(KARTEN_LADER.bubbles)),
  kontakt: guard(spaet(KARTEN_LADER.kontakt)),
  fluessig: guard(spaet(KARTEN_LADER.fluessig)),
  pixi: guard(spaet(KARTEN_LADER.pixi)),
};

const edgeTypes: EdgeTypes = { labeled: LabeledEdge };
// M486: fest statt je Render neu — ein neues Objekt hier zeichnete bei jedem Zug-Ereignis jede Verbindung neu
// (React Flow reicht die Vorgabe an jede Kante weiter)
const KANTEN_VORGABE = {
  style: { stroke: 'var(--edge)', strokeWidth: 2 },
  labelStyle: { fontSize: 11, fill: 'var(--muted)' },
  labelBgStyle: { fill: 'var(--bg)', fillOpacity: 0.9 },
};
const PRO_OPTIONEN = { hideAttribution: true };

/**
 * M483: Die Auswahl-Leiste (samt KI-Aktionen, Ausrichten, Rahmen-Werkzeugen) gehört nicht in den Start — auf einem
 * frisch geöffneten Board ist nichts ausgewählt. Sie lädt mit der ersten Auswahl; vorher holt App.tsx sie im Leerlauf
 * still nach (`imLeerlaufVorladen`), dann steht sie bei der ersten Auswahl ohne Verzug. Einmal da, bleibt sie
 * eingehängt (auch über einen Board-Wechsel hinweg), wie vorher. Den Rechtsklick-Wunsch („Mehr"-Menü am Zeiger)
 * holt sie sich beim Einhängen selbst ab (kartenWunschNehmen, M350). Schon die erste Berührung/Taste stößt das Laden an.
 */
/**
 * M502: Die Kommentar-Ebene (Pins, Gesprächs-Panel; ~15 KB Quelltext) lädt, sobald das Board Kommentare hat oder
 * einer geöffnet wird — bei einem Board mit Kommentaren also gleich beim Öffnen, sonst still im Leerlauf (App.tsx).
 * Einmal da, bleibt sie eingehängt (auch über einen Board-Wechsel). Der Verfasser-Name liegt in lib/autor.ts.
 */
export const kommentareLaden = () => import('./CommentLayer');
const KommentareSpaet = nachLazy(() => kommentareLaden().then((m) => ({ default: m.CommentLayer })));
let kommentareEingehaengt = false;
function Kommentare() {
  const da = useBoard((s) => (selectActiveBoard(s).comments?.length ?? 0) > 0 || s.commentOpen !== null);
  if (da) kommentareEingehaengt = true;
  return kommentareEingehaengt ? <Suspense fallback={null}><KommentareSpaet /></Suspense> : null;
}

export const auswahlLeisteLaden = () => import('./SelectionToolbar');
const AuswahlLeisteSpaet = nachLazy(() => auswahlLeisteLaden().then((m) => ({ default: m.SelectionToolbar })));
let auswahlLeisteEingehaengt = false;
// M525: memo — das Board zeichnet beim Ziehen je Mausbewegung neu; die Leiste (gut 130 Symbole) nur, wenn sie selbst Anlass hat
const AuswahlLeiste = memo(function AuswahlLeiste() {
  const gewaehlt = useBoard((s) => selectActiveBoard(s).nodes.some((n) => n.selected));
  const [an, setAn] = useState(auswahlLeisteEingehaengt);
  useEffect(() => { if (gewaehlt && !an) { auswahlLeisteEingehaengt = true; setAn(true); } }, [gewaehlt, an]);
  // Die erste Berührung oder Taste kündigt eine Auswahl an — dann schon holen, nicht erst mit ihr (spart den Abruf)
  useEffect(() => {
    if (an) return;
    const vorab = () => { void auswahlLeisteLaden().catch(() => null); };
    window.addEventListener('pointerdown', vorab, { capture: true, once: true });
    window.addEventListener('keydown', vorab, { capture: true, once: true });
    return () => { window.removeEventListener('pointerdown', vorab, true); window.removeEventListener('keydown', vorab, true); };
  }, [an]);
  return an || gewaehlt ? <Suspense fallback={null}><AuswahlLeisteSpaet /></Suspense> : null;
});


/**
 * M249: Jedes Board merkt sich, wo man zuletzt hingeschaut hat.
 *
 * Der Befund: „Sobald man im Netz einen Knoten aktiviert, wird neu geladen und
 * der Knoten zentriert … das holt den User durch den sprunghaften Reload und
 * die Neupositionierung aus der Immersion."
 *
 * Gemessen wird nichts neu geladen — kein Navigationsvorgang, gesetzte
 * Variablen überleben den Klick. Was so wirkt, ist der Schlüssel am
 * React-Flow-Element (`key={activeId}`): Beim Board-Wechsel wird die ganze
 * Leinwand neu aufgebaut, und die Eigenschaft `fitView` passt dabei JEDES MAL
 * den kompletten Board-Inhalt neu ein. Ausschnitt und Zoom, die man sich
 * eingerichtet hatte, sind weg — das ist der Sprung.
 *
 * Eine Karte außerhalb der Komponente hält deshalb je Board den zuletzt
 * gesehenen Ausschnitt fest. Bewusst NICHT im Store: Das ist keine Information
 * über den Inhalt, sie muss nichts überleben und würde als Zustand nur bei
 * jedem Schwenk eine Speicher-Runde auslösen.
 */
const gemerkteAnsicht = new Map<string, { x: number; y: number; zoom: number }>();
/** M530: Die Rahmen-Reise endet, während das Board nicht zu sehen ist — beim Wiederkommen gilt die Ansicht von vor ihr */
export const ansichtVormerken = (boardId: string, v: { x: number; y: number; zoom: number }): void => { gemerkteAnsicht.set(boardId, v); };

export function Board() {
  const activeId = useBoard((s) => s.activeId);
  const ziehBewegung = useBoard((s) => s.ziehBewegung); // M481
  const importEpoch = useBoard((s) => s.importEpoch);
  const nodes = useBoard((s) => selectActiveBoard(s).nodes);
  const edges = useBoard((s) => selectActiveBoard(s).edges);
  const onNodesChange = useBoard((s) => s.onNodesChange);
  const onEdgesChange = useBoard((s) => s.onEdgesChange);
  const onConnect = useBoard((s) => s.onConnect);
  const addNode = useBoard((s) => s.addNode);
  const removeNodes = useBoard((s) => s.removeNodes);
  const showToast = useBoard((s) => s.showToast);

  const { screenToFlowPosition, setCenter, fitView, getViewport, setViewport, getInternalNode, zoomIn, zoomOut, zoomTo } = useReactFlow();
  const rfStore = useStoreApi();
  const wheelZoom = useBoard((s) => s.wheelZoom);
  /**
   * M268: Der Anzeige-Faktor läuft im Board-Zoom mit.
   *
   * Die Leinwand rechnet den Wurzel-Zoom heraus (index.css, `--pn-gegen`) —
   * sonst stimmt keine einzige Trefferfläche. Damit die Karten bei „Anzeige
   * 130 %" trotzdem größer sind, wandert der Faktor in den Board-Zoom: Alle
   * Grenzen und Einpass-Obergrenzen laufen mit ihm. Für die Bedienung ändert
   * sich dadurch nichts — der Spielraum zum Heraus- und Hineinzoomen bleibt
   * derselbe, er liegt nur um den Faktor verschoben.
   */
  const anzeige = useBoard((s) => s.anzeige ?? 1);
  const anzRef = useRef(anzeige);
  anzRef.current = anzeige;

  /**
   * M249: Den gemerkten Ausschnitt greifen, BEVOR die neue Leinwand ihn
   * überschreibt.
   *
   * Das ist der heikle Teil. React Flows eigenes Einpassen läuft beim
   * Aufbauen und meldet sofort einen neuen Ausschnitt — der landete in der
   * Karte und überschriebe genau den Wert, den wir wiederherstellen wollen.
   * Deshalb wird er hier im RENDER gelesen, also vor dem Mounten, und bis
   * zum Anwenden in einem Ref geparkt.
   */
  /**
   * M268: Ändert sich der Anzeige-Faktor, wandert der Board-Zoom mit.
   *
   * Ohne das würde die Einstellung auf dem offenen Board erst beim nächsten
   * Einpassen wirken — man stellte 130 % ein und die Karten blieben, wie sie
   * waren. Skaliert wird um die Mitte des sichtbaren Ausschnitts, damit man
   * nachher dieselbe Stelle vor sich hat und nicht in einer Ecke landet. Die
   * gemerkten Ausschnitte der anderen Boards laufen mit, sonst kämen sie beim
   * nächsten Aufschlagen in der alten Größe zurück.
   */
  const anzVorher = useRef(anzeige);
  useEffect(() => {
    const k = anzeige / anzVorher.current;
    anzVorher.current = anzeige;
    if (Math.abs(k - 1) < 0.001) return;
    /* Gemessen wird in BILDPUNKTEN (getBoundingClientRect), denn genau darin
       rechnet die Leinwand, seit der Renderer den Anzeige-Zoom ausgleicht.
       `clientWidth` gäbe Layout-Punkte — die Mitte läge dann daneben, und das
       Board rutschte beim Umschalten ein Stück zur Seite. */
    const kasten = document.querySelector('.react-flow')?.getBoundingClientRect();
    const cx = (kasten?.width ?? window.innerWidth) / 2;
    const cy = (kasten?.height ?? window.innerHeight) / 2;
    const mitte = (v: { x: number; y: number; zoom: number }) => ({
      x: cx - (cx - v.x) * k,
      y: cy - (cy - v.y) * k,
      zoom: v.zoom * k,
    });
    for (const [id, v] of gemerkteAnsicht) gemerkteAnsicht.set(id, mitte(v));
    void setViewport(mitte(getViewport()));
  }, [anzeige, getViewport, setViewport]);

  // M379: Eine Vorlage hat das Board gefüllt → alles ins Bild holen. Der gemerkte Ausschnitt gilt nicht mehr
  // (er stammt vom leeren Board oder von einer zurückgenommenen Vorlage); mehrfach, weil Notizen ihre Höhe erst
  // nach dem Messen kennen.
  useEffect(() => {
    let timer: number[] = [];
    const auf = () => {
      gemerkteAnsicht.delete(useBoard.getState().activeId);
      timer.forEach((t) => window.clearTimeout(t));
      timer = [60, 260, 520].map((ms) => window.setTimeout(() => { void fitView({ padding: 0.12, maxZoom: 1, duration: 0 }); }, ms));
    };
    window.addEventListener('pixinotes:einpassen', auf);
    return () => { window.removeEventListener('pixinotes:einpassen', auf); timer.forEach((t) => window.clearTimeout(t)); };
  }, [fitView]);

  const letztesBoard = useRef(activeId);
  const wunschAnsicht = useRef(gemerkteAnsicht.get(activeId) ?? null);
  if (letztesBoard.current !== activeId) {
    wunschAnsicht.current = gemerkteAnsicht.get(activeId) ?? null;
    letztesBoard.current = activeId;
  }
  useEffect(() => {
    const wunsch = wunschAnsicht.current;
    wunschAnsicht.current = null;
    if (!wunsch) return;   // Board zum ersten Mal offen → fitView darf einpassen
    // Ein gezielter Sprung auf eine Karte (Suche, Aufgaben, Backlink) hat
    // Vorrang: Wer irgendwo hin WILL, soll nicht am alten Ausschnitt landen.
    if (useBoard.getState().pendingFocus?.boardId === activeId) return;
    // Zwei Frames: Erst danach hat React Flow gemessen und selbst eingepasst;
    // vorher gesetzt, würde unser Ausschnitt wieder überschrieben.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      void setViewport(wunsch);   // ohne Dauer — kein Flug, kein Sprung
    }));
    return () => cancelAnimationFrame(id);
  }, [activeId, importEpoch, setViewport]);

  // ---------- Zoom-Durchgriff ÜBER Modulen (M123) ----------
  // Karteninhalte (Notiz-Editor, Kanban, Diagramm …) tragen nowheel/eigene
  // Scroller — Strg+Rad, Trackpad-Pinch (= Rad mit ctrlKey) und der
  // Zwei-Finger-Pinch sollen trotzdem IMMER das Board zoomen. Normales
  // Scrollen im Modul bleibt unangetastet. Native Listener (non-passive),
  // weil React Wheel/Touch am Root passiv registriert.
  const zoomWrapRef = useRef<HTMLDivElement | null>(null);
  const wheelZoomRef = useRef(wheelZoom);
  wheelZoomRef.current = wheelZoom;
  const pinchRef = useRef<{ dist: number; zoom: number; fx: number; fy: number } | null>(null);
  // Ein-Finger-Panning über Modulen (M125): Drag aus „toten" nodrag-Zonen
  // der Karten schwenkt das Board; pending bis der 8-px-Schwellwert fällt
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number; zoom: number; active: boolean; el: Element; fokus?: boolean; ly?: number; lx?: number; rolle?: HTMLElement; kandidat?: boolean; lt?: number; v?: number; dok?: boolean; wisch?: boolean; t0?: number } | null>(null);
  // M339: Nachlauf beim Finger-Scrollen in einer langen Notiz
  const schwungRef = useRef(0);
  /**
   * M334: Scrollen im Fokus. Eine Notiz, die länger als der Schirm ist, ließ
   * sich im Fokus nicht nach unten bewegen: Der Editor trägt nowheel (React
   * Flow ignoriert das Rad dort), wächst selbst statt zu scrollen, und der
   * Finger auf contenteditable galt nicht als Schwenk-Kandidat. Jetzt rollt
   * das Rad bzw. der Finger die Kamera senkrecht über die Karte — geklemmt,
   * damit die Karte nie den Schirm verlässt; passt sie ganz hinein, bewegt
   * sich nichts. Der Kamera-Effekt (unten) hält die Maße hier aktuell.
   */
  const fokusRef = useRef<{ id: string; oben: number; hoehe: number; rand: number; breite: number; fit: number } | null>(null);
  /**
   * M363: Im Fokus frei gezoomt (zwei Finger, Doppeltipp, Strg+Rad). Solange das gilt, passt die Kamera nicht
   * von selbst neu ein — wer in eine PDF-Seite hineingezoomt hat, bleibt dort, auch beim Blättern.
   */
  const fokusFrei = useRef(false);
  /**
   * M413: Wer im Fokus näher herangeht, will das bei der nächsten Karte nicht wiederholen. Gemerkt wird die
   * Zoomstufe selbst (nicht „so viel mehr als eingepasst") – der Text ist dann auf jeder Karte gleich groß.
   * `null`: eingepasst. Gilt, solange der Fokus offen ist; beim Schließen vergessen.
   */
  const fokusWunsch = useRef<number | null>(null);
  const fokusEinpassen = useRef<() => void>(() => {});
  const letzterTipp = useRef<{ x: number; y: number; t: number } | null>(null);
  const fokusGrenzen = useCallback((): { min: number; max: number; passt: boolean } | null => {
    const f = fokusRef.current;
    if (!f) return null;
    const el = document.querySelector(`.react-flow__node[data-id="${f.id}"]`) as HTMLElement | null;
    if (!el) return null;
    const { zoom } = getViewport();
    const fy = getInternalNode(f.id)?.internals.positionAbsolute.y ?? 0;
    const h = el.offsetHeight;
    const passt = h * zoom <= f.hoehe - 2 * f.rand;
    if (passt) {
      const y = f.oben + (f.hoehe - h * zoom) / 2 - fy * zoom;
      return { min: y, max: y, passt };
    }
    return { min: f.oben + f.hoehe - f.rand - (fy + h) * zoom, max: f.oben + f.rand - fy * zoom, passt };
  }, [getInternalNode, getViewport]);
  /** M363: dasselbe waagerecht — passt die Karte in die Breite, steht sie mittig fest; sonst lässt sie sich bis an ihre Kanten schieben */
  const fokusGrenzenX = useCallback((): { min: number; max: number; passt: boolean } | null => {
    const f = fokusRef.current;
    if (!f) return null;
    const el = document.querySelector(`.react-flow__node[data-id="${f.id}"]`) as HTMLElement | null;
    if (!el) return null;
    const { zoom } = getViewport();
    const fx = getInternalNode(f.id)?.internals.positionAbsolute.x ?? 0;
    const w = el.offsetWidth;
    const passt = w * zoom <= f.breite - 2 * f.rand + 0.5;
    if (passt) {
      const x = (f.breite - w * zoom) / 2 - fx * zoom;
      return { min: x, max: x, passt };
    }
    return { min: f.breite - f.rand - (fx + w) * zoom, max: f.rand - fx * zoom, passt };
  }, [getInternalNode, getViewport]);
  /** M363: Kamera im Fokus in beide Richtungen schieben (geklemmt). (0, 0) klemmt nur — nach einem Zoom. */
  const fokusSchieben = useCallback((dx: number, dy: number): boolean => {
    const gy = fokusGrenzen(); const gx = fokusGrenzenX();
    if (!gy || !gx) return false;
    const v = getViewport();
    const x = Math.max(gx.min, Math.min(gx.max, v.x - dx));
    const y = Math.max(gy.min, Math.min(gy.max, v.y - dy));
    if (Math.abs(x - v.x) < 0.5 && Math.abs(y - v.y) < 0.5) return false;
    void setViewport({ x, y, zoom: v.zoom });
    return true;
  }, [fokusGrenzen, fokusGrenzenX, getViewport, setViewport]);
  /** Kamera um dy Bildpunkte rollen (positiv = Inhalt nach oben, wie ein Scroll nach unten) */
  const fokusScroll = useCallback((dy: number): boolean => {
    const g = fokusGrenzen();
    if (!g) return false;
    const v = getViewport();
    const y = Math.max(g.min, Math.min(g.max, v.y - dy));
    if (Math.abs(y - v.y) < 0.5) return false;
    void setViewport({ x: v.x, y, zoom: v.zoom });
    return true;
  }, [fokusGrenzen, getViewport, setViewport]);
  /**
   * M346: Scrollbalken des Fokus. Dort rollt nicht die Karte, sondern die Kamera über sie (M334) —
   * dass es weitergeht und wo man steht, sah man bisher nicht. Der Balken am rechten Rand zeigt es
   * und lässt sich ziehen. Lage und Größe direkt am Element (kein Render je Kamerabild).
   */
  const fokusSpurRef = useRef<HTMLDivElement | null>(null);
  const fokusZug = useRef<{ y: number; vy: number; k: number } | null>(null);
  const fokusBalken = useCallback((kameraY?: number) => {
    const spur = fokusSpurRef.current;
    const daumen = spur?.firstElementChild as HTMLElement | null;
    if (!spur || !daumen) return;
    const f = fokusRef.current;
    const g = f ? fokusGrenzen() : null;
    if (!f || !g || g.passt || g.max - g.min < 4) { spur.removeAttribute('data-an'); return; }
    const spurH = Math.max(60, f.hoehe - 16);
    const weg = g.max - g.min;
    const dh = Math.max(40, Math.round((spurH * f.hoehe) / (f.hoehe + weg)));
    // `kameraY`: React Flow meldet die neue Kamera, BEVOR getViewport() sie kennt
    const pos = Math.max(0, Math.min(1, (g.max - (kameraY ?? getViewport().y)) / weg));
    spur.style.top = `${f.oben + 8}px`;
    spur.style.height = `${spurH}px`;
    daumen.style.height = `${dh}px`;
    daumen.style.transform = `translateY(${Math.round((spurH - dh) * pos)}px)`;
    spur.setAttribute('data-an', '');
  }, [fokusGrenzen, getViewport]);
  useEffect(() => {
    const wrap = zoomWrapRef.current;
    if (!wrap) return;
    const clampZoom = (z: number) => Math.max(BOARD_ZOOM_MIN * anzRef.current, Math.min(BOARD_ZOOM_MAX * anzRef.current, z));
    const zoomAt = (clientX: number, clientY: number, newZoom: number, fx?: number, fy?: number) => {
      const rect = wrap.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const { x, y, zoom } = getViewport();
      const flowX = fx ?? (px - x) / zoom;
      const flowY = fy ?? (py - y) / zoom;
      void setViewport({ x: px - flowX * newZoom, y: py - flowY * newZoom, zoom: newZoom });
      return { flowX, flowY };
    };
    // M143: Solange ein Menü/Popup offen ist und der Zeiger darüber steht,
    // pausieren ALLE Board-Gesten (Rad-Zoom, Pinch, Finger-Pan) — im Menü
    // wird ganz normal gescrollt und navigiert.
    const OVERLAY_SEL = '.bn-suggestion-menu, .bn-side-menu, .mantine-Menu-dropdown, .mantine-Popover-dropdown, '
      + '[role="menu"], [role="listbox"], [role="dialog"], .modal-backdrop, .ticket-modal-backdrop, '
      + '.dock-menu, .sel-ai-menu, .sel-attr-menu, .tab-tree, .tab-bg-menu, .mm-pop, .draw-palette, .comment-panel, .frame-menu, .week-pop, .happ-menu';
    const inOverlay = (t: Element | null) => !!t?.closest?.(OVERLAY_SEL);
    /** Kann irgendein Container zwischen Ziel und Karte in Zugrichtung scrollen? */
    const canScrollTowards = (from: Element, stopAt: Element, dx: number, dy: number): boolean => {
      const vertical = Math.abs(dy) >= Math.abs(dx);
      let cur: Element | null = from;
      while (cur && cur !== stopAt) {
        const st = getComputedStyle(cur);
        if (vertical && /auto|scroll/.test(st.overflowY) && cur.scrollHeight > cur.clientHeight + 4) {
          if ((dy < 0 && cur.scrollTop + cur.clientHeight < cur.scrollHeight - 1) || (dy > 0 && cur.scrollTop > 0)) return true;
        }
        if (!vertical && /auto|scroll/.test(st.overflowX) && cur.scrollWidth > cur.clientWidth + 4) {
          if ((dx < 0 && cur.scrollLeft + cur.clientWidth < cur.scrollWidth - 1) || (dx > 0 && cur.scrollLeft > 0)) return true;
        }
        cur = cur.parentElement;
      }
      return false;
    };
    /**
     * M404: Zoomen mit dem Rad. Jede Raste ist derselbe Schritt (lib/radZoom.ts) und wird weich angefahren: Das Ziel
     * sammelt die Rasten, jedes Bild legt einen festen Anteil des Rests zurück. Feine Ereignisse (Kneifen am
     * Trackpad, stufenlose Räder) folgen dem Finger sofort. Die Stelle unter dem Zeiger bleibt stehen.
     */
    const rad = { ziel: 0, x: 0, y: 0, bild: 0, zeit: 0, laeuft: false };
    const radGrenze = (z: number) => { const f = fokusRef.current; return f ? Math.max(f.fit, clampZoom(z)) : clampZoom(z); };   // M363: im Fokus nie kleiner als eingepasst
    const radSetzen = (z: number) => {
      const neu = radGrenze(z);
      // erst die Bedienung der Dokument-Karten auf die neue Stufe bringen – rutscht der Inhalt unter dem Zeiger dabei, zieht der Zoom-Anker mit
      const rutsch = uiMeldenRef.current(neu, rad.x, rad.y);
      if (rutsch) {
        const rect = wrap.getBoundingClientRect();
        const { x, y, zoom } = getViewport();
        zoomAt(rad.x, rad.y, neu, (rad.x - rect.left - x) / zoom, (rad.y - rect.top - y) / zoom + rutsch);
      } else zoomAt(rad.x, rad.y, neu);
      const f = fokusRef.current;
      if (f) { fokusFrei.current = neu > f.fit * 1.02; fokusWunsch.current = fokusFrei.current ? neu : null; requestAnimationFrame(() => { fokusSchieben(0, 0); fokusBalken(); }); window.dispatchEvent(new CustomEvent(FOKUS_ZOOM_EREIGNIS, { detail: { zoom: neu } })); }   // danach an die Kartenkanten klemmen
    };
    const radBild = (jetzt: number) => {
      const ist = Math.log2(getViewport().zoom);
      const rest = rad.ziel - ist;
      const anteil = radAnteil(jetzt - rad.zeit);
      rad.zeit = jetzt;
      if (Math.abs(rest) < 0.004) { radSetzen(2 ** rad.ziel); rad.laeuft = false; return; }
      radSetzen(2 ** (ist + rest * anteil));
      rad.bild = requestAnimationFrame(radBild);
    };
    const radZoomen = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { hoch, raste } = radSchritt(e);
      if (!hoch) return;
      rad.x = e.clientX; rad.y = e.clientY;
      const ist = Math.log2(getViewport().zoom);
      if (!raste) {
        // fein: sofort, ohne Nachlauf
        cancelAnimationFrame(rad.bild); rad.laeuft = false;
        radSetzen(2 ** (ist + hoch));
        return;
      }
      // Raste: aufs Ziel sammeln (in den Grenzen) und anfahren; die erste Raste bewegt sich schon in diesem Bild
      rad.ziel = Math.log2(radGrenze(2 ** ((rad.laeuft ? rad.ziel : ist) + hoch)));
      if (rad.laeuft) return;
      rad.laeuft = true;
      rad.zeit = performance.now() - 16;
      radBild(performance.now());
    };
    const onWheel = (e: WheelEvent) => {
      const target = e.target as Element | null;
      if (inOverlay(target)) return; // Menü offen → Menü scrollt, Board bleibt ruhig
      const inNode = target?.closest?.('.react-flow__node');
      if (!inNode) {
        // M404: Auch auf der freien Fläche zoomt das Rad hier – derselbe Schritt, dasselbe weiche Anfahren wie über
        // einer Karte. Schwenken per Rad (ohne Strg, wenn das Rad nicht zoomt) bleibt bei React Flow.
        if ((e.ctrlKey || e.metaKey || wheelZoomRef.current) && target?.closest?.('.react-flow__renderer')) radZoomen(e);
        return;
      }
      // M334: Im Fokus rollt das Rad über der Karte die Kamera — außer ein
      // Inhalt (Code-Feld, Tabelle) kann selbst noch in diese Richtung scrollen
      if (fokusRef.current && !e.ctrlKey && !e.metaKey && inNode.classList.contains('pn-focused') && target) {
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        if (!canScrollTowards(target, inNode, -e.deltaX, -dy)) {
          e.preventDefault();
          e.stopPropagation();
          // M363: hineingezoomt rollt das Rad auch seitwärts (Umschalt+Rad oder Zwei-Finger-Wisch am Trackpad)
          if (fokusFrei.current) fokusSchieben(e.shiftKey && !e.deltaX ? dy : e.deltaX, e.shiftKey && !e.deltaX ? 0 : dy);
          else fokusScroll(dy);
          return;
        }
      }
      /* M409: Eine ausgewählte Rechen-Tabelle (auch im Fokus oder beim Bearbeiten einer Zelle) rollt mit dem Rad ihren
         Inhalt – senkrecht, mit Umschalt oder dem Trackpad auch seitwärts. Vorher bekam das Board jedes Rad-Ereignis:
         Es schwenkte, und im Fokus verschob sich die ganze Karte. Unausgewählt gehört das Rad weiter dem Board (wer
         darüber fährt, bleibt nicht an jeder Tabelle hängen); am Ende des Inhalts ebenfalls. */
      if (!e.ctrlKey && !e.metaKey && target && inNode.classList.contains('react-flow__node-sheet')
        && (inNode.classList.contains('selected') || inNode.classList.contains('pn-focused') || inNode.contains(document.activeElement))) {
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        const quer = e.shiftKey && !e.deltaX;
        if (canScrollTowards(target, inNode, quer ? -dy : -e.deltaX, quer ? 0 : -dy)) { e.stopPropagation(); return; }
      }
      // M339: Eine ausgewählte (oder gerade beschriebene) lange Notiz scrollt mit dem Rad ihren Text —
      // auch wenn das Rad sonst zoomt. Unausgewählt zoomt es weiter: Wer über das Board zoomt,
      // soll nicht an jeder langen Notiz hängen bleiben.
      if (!e.ctrlKey && !e.metaKey && wheelZoomRef.current && target && inNode.classList.contains('react-flow__node-note')
        && (inNode.classList.contains('selected') || inNode.contains(document.activeElement))) {
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        if (canScrollTowards(target, inNode, -e.deltaX, -dy)) return;
      }
      // M346: Im weiten Zoom nimmt der Kartenkörper keine Zeiger an (die ganze Karte ist der Griff) — das Rad
      // käme nie beim Text an. Über einer GEWÄHLTEN langen Notiz rollt es darum von Hand ihren Text.
      if (!e.ctrlKey && !e.metaKey && weitRef.current && inNode.classList.contains('react-flow__node-note') && inNode.classList.contains('selected')) {
        const text = inNode.querySelector('.card-body.note-card') as HTMLElement | null;
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        if (text && text.scrollHeight > text.clientHeight + 4
          && ((dy > 0 && text.scrollTop + text.clientHeight < text.scrollHeight - 1) || (dy < 0 && text.scrollTop > 0))) {
          e.preventDefault();
          e.stopPropagation();
          text.scrollTop += dy / (getViewport().zoom || 1);
          return;
        }
      }
      if (!e.ctrlKey && !e.metaKey && !wheelZoomRef.current) return; // Modul-Scroll bleibt
      radZoomen(e);
    };
    // M143: Klicks im Slash-Menü (z. B. auf dessen Scrollleiste) dürfen weder
    // dem Editor den Fokus klauen noch BlockNotes „außerhalb geklickt"-
    // Schließer erreichen — sonst verschwindet das Menü. window-CAPTURE läuft
    // vor allen document-Listenern von BlockNote/Mantine.
    const onMenuPointerDown = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('.bn-suggestion-menu')) {
        e.stopPropagation();
        // Fokus-Klau nur beim mousedown unterbinden — preventDefault auf
        // pointerdown würde auch die Klick-Erzeugung abwürgen
        if (e.type === 'mousedown') e.preventDefault();
      }
    };
    const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const touchMid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (inOverlay(target)) { panRef.current = null; return; } // Menü offen → keine Board-Gesten
      const node = target?.closest?.('.react-flow__node');
      if (e.touches.length === 2) {
        panRef.current = null; // zweiter Finger: Pinch übernimmt
        if (!node) return; // Pinch auf der Fläche gehört React Flow
        e.preventDefault(); // Modul-Scroll/Textauswahl nicht starten lassen
        const mid = touchMid(e.touches);
        const rect = wrap.getBoundingClientRect();
        const { x, y, zoom } = getViewport();
        pinchRef.current = {
          dist: touchDist(e.touches),
          zoom,
          fx: (mid.x - rect.left - x) / zoom,
          fy: (mid.y - rect.top - y) / zoom,
        };
        return;
      }
      if (e.touches.length !== 1 || !node || !target) return;
      const t = e.touches[0];
      const { x, y, zoom } = getViewport();
      /**
       * M343: Weiter Zoom am Finger. Die ganze Karte ist dort der Griff — damit ein Wisch über die
       * (dicht stehenden) Karten nicht ständig eine davon verschiebt, gilt wie in Miro: Erst antippen
       * (auswählen), dann ziehen. Auf einer nicht gewählten Karte schwenkt der Finger das Board.
       */
      if (weitRef.current && !fokusRef.current) {
        if (target.closest('.react-flow__resize-control, .react-flow__handle, .note-daumen')) return;   // M346: der Scrollbalken bleibt bedienbar
        if (node.classList.contains('selected')) return; // React Flow zieht die Karte
        e.stopPropagation(); // React Flow beginnt keinen Karten-Zug; der Tipp (click) wählt weiterhin aus
        panRef.current = { x: t.clientX, y: t.clientY, vx: x, vy: y, zoom, active: false, el: target };
        return;
      }
      // M334: Im Fokus rollt EIN Finger die lange Karte — auch aus dem Text heraus
      // (ein Tipp setzt weiter den Cursor, erst der Zug über 8 px scrollt)
      if (fokusRef.current && node.classList.contains('pn-focused')) {
        if (target.closest('input, textarea, select, button, a, .react-flow__handle, .react-flow__resize-control')) return;
        panRef.current = { x: t.clientX, y: t.clientY, vx: x, vy: y, zoom, active: false, el: target, fokus: true, ly: t.clientY, lx: t.clientX,
          dok: !!target.closest('.pdf-seite'), t0: performance.now() };
        return;
      }
      const kandidat = !!target.closest('.nodrag')
        && !target.closest('input, textarea, select, button, a, [contenteditable="true"], .react-flow__handle, .react-flow__resize-control');
      /**
       * M339: Der Finger rollt eine lange Notiz. Bewusst von Hand statt nativ: Der Scrollbereich
       * trägt touch-action none, damit der STIFT darauf schreibt statt zu scrollen (unter Windows
       * scrollt ein Stift sonst wie ein Finger). Ein Tipp bleibt Tipp; kann die Notiz in die
       * Zugrichtung nicht weiter, schwenkt der Zug wie bisher das Board.
       */
      const rolle = target.closest('.card-body.note-card') as HTMLElement | null;
      if (rolle && rolle.scrollHeight > rolle.clientHeight + 4 && !document.body.dataset.stiftZug
        && (t as Touch & { touchType?: string }).touchType !== 'stylus'
        && !target.closest('input, select, button, a, .react-flow__handle, .react-flow__resize-control, .note-daumen')) {
        cancelAnimationFrame(schwungRef.current);
        panRef.current = { x: t.clientX, y: t.clientY, vx: x, vy: y, zoom, active: false, el: target, rolle, kandidat, ly: t.clientY, lt: performance.now(), v: 0 };
        return;
      }
      // Panning-Kandidat (M125): nur aus nodrag-Zonen (dort verschiebt React
      // Flow NICHT die Karte) und nie aus interaktiven Elementen heraus
      if (!kandidat) return;
      panRef.current = { x: t.clientX, y: t.clientY, vx: x, vy: y, zoom, active: false, el: target };
    };
    const onTouchMove = (e: TouchEvent) => {
      const p = pinchRef.current;
      if (p && e.touches.length === 2) {
        e.preventDefault();
        e.stopPropagation();
        const mid = touchMid(e.touches);
        const f = fokusRef.current;
        const roh = clampZoom(p.zoom * (touchDist(e.touches) / p.dist));
        const newZoom = f ? Math.max(f.fit, roh) : roh;
        p.fy += uiMeldenRef.current(newZoom, mid.x, mid.y);   // M404: rutscht der Inhalt unter den Fingern, zieht der Anker mit
        zoomAt(mid.x, mid.y, newZoom, p.fx, p.fy);
        if (f) { fokusFrei.current = newZoom > f.fit * 1.02; fokusWunsch.current = fokusFrei.current ? newZoom : null; }
        return;
      }
      const pan = panRef.current;
      if (!pan || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - pan.x;
      const dy = t.clientY - pan.y;
      if (!pan.active) {
        if (Math.hypot(dx, dy) < 8) return; // Tipp bleibt Tipp
        if (pan.rolle) {
          const max = pan.rolle.scrollHeight - pan.rolle.clientHeight;
          const kann = Math.abs(dy) > Math.abs(dx) && ((dy < 0 && pan.rolle.scrollTop < max - 1) || (dy > 0 && pan.rolle.scrollTop > 0));
          if (!kann) {
            // am Anschlag oder quer: das Board schwenkt, wenn die Stelle das erlaubt
            if (!pan.kandidat) { panRef.current = null; return; }
            pan.rolle = undefined;
          }
        }
        // Kann der Modul-Inhalt selbst in diese Richtung scrollen? Dann darf er.
        const node = pan.el.closest('.react-flow__node');
        if (!pan.rolle && node && canScrollTowards(pan.el, node, dx, dy)) { panRef.current = null; return; }
        // Im Fokus nur senkrecht; ein waagerechter Zug im Text bleibt dem Editor.
        // M363: Auf einer Dokument-Seite schiebt er das hineingezoomte Blatt — passt es in die Breite, blättert der Wisch.
        if (pan.fokus && Math.abs(dx) > Math.abs(dy) * 1.5) {
          const gx = pan.dok ? fokusGrenzenX() : null;
          if (!gx) { panRef.current = null; return; }
          if (gx.passt) { pan.wisch = true; return; }
        }
        if (pan.wisch) return;
        pan.active = true;
      }
      e.preventDefault();
      e.stopPropagation();
      if (pan.rolle) {
        const k = pan.rolle.clientHeight > 0 ? pan.rolle.getBoundingClientRect().height / pan.rolle.clientHeight : 1;
        const weg = ((pan.ly ?? t.clientY) - t.clientY) / (k || 1);
        const jetzt = performance.now();
        const dt = Math.max(1, jetzt - (pan.lt ?? jetzt));
        pan.v = 0.7 * (weg / dt) + 0.3 * (pan.v ?? 0); // geglättete Geschwindigkeit (Inhaltspunkte je ms)
        pan.ly = t.clientY; pan.lt = jetzt;
        pan.rolle.scrollTop += weg;
        return;
      }
      if (pan.fokus) {
        fokusSchieben((pan.lx ?? t.clientX) - t.clientX, (pan.ly ?? t.clientY) - t.clientY);
        pan.ly = t.clientY; pan.lx = t.clientX;
        return;
      }
      void setViewport({ x: pan.vx + dx, y: pan.vy + dy, zoom: pan.zoom });
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && pinchRef.current) {
        pinchRef.current = null;
        // M363: nach dem Zoomen im Fokus an die Kartenkanten klemmen
        if (fokusRef.current) requestAnimationFrame(() => { fokusSchieben(0, 0); fokusBalken(); });
      }
      if (e.touches.length === 0) {
        const pan = panRef.current;
        const t = e.changedTouches[0];
        // M363: Dokument im Fokus — Wischen blättert, Doppeltipp zoomt heran und wieder zurück
        if (pan?.fokus && pan.dok && t && useBoard.getState().tool === 'select' && !pan.el.closest('.pin-modus')) {
          const dx = t.clientX - pan.x; const dy = t.clientY - pan.y;
          if (pan.wisch) {
            if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && performance.now() - (pan.t0 ?? 0) < 800) {
              window.dispatchEvent(new CustomEvent(DOKUMENT_BEFEHL, { detail: { id: fokusRef.current?.id, was: dx < 0 ? 'vor' : 'zurueck' } }));
            }
          } else if (!pan.active && Math.hypot(dx, dy) < 10) {
            const vor = letzterTipp.current;
            const jetzt = performance.now();
            if (vor && jetzt - vor.t < 320 && Math.hypot(vor.x - t.clientX, vor.y - t.clientY) < 40) {
              letzterTipp.current = null;
              e.preventDefault();
              const f = fokusRef.current;
              if (f) {
                if (fokusFrei.current) { fokusFrei.current = false; fokusWunsch.current = null; fokusEinpassen.current(); }
                else {
                  fokusFrei.current = true;
                  fokusWunsch.current = clampZoom(f.fit * 2.4);
                  zoomAt(t.clientX, t.clientY, clampZoom(f.fit * 2.4));
                  requestAnimationFrame(() => { fokusSchieben(0, 0); fokusBalken(); });
                }
              }
            } else letzterTipp.current = { x: t.clientX, y: t.clientY, t: jetzt };
          }
        }
        // Nachlauf: der Schwung des Fingers rollt aus (nur nach einem frischen Zug)
        if (pan?.rolle && pan.active && Math.abs(pan.v ?? 0) > 0.25 && performance.now() - (pan.lt ?? 0) < 90) {
          const el = pan.rolle;
          let v = Math.max(-4, Math.min(4, pan.v ?? 0));
          let zuletzt = performance.now();
          const lauf = (jetzt: number) => {
            const dt = Math.min(32, jetzt - zuletzt); zuletzt = jetzt;
            const vorher = el.scrollTop;
            el.scrollTop += v * dt;
            v *= Math.pow(0.995, dt);
            if (Math.abs(v) > 0.02 && el.scrollTop !== vorher) schwungRef.current = requestAnimationFrame(lauf);
          };
          schwungRef.current = requestAnimationFrame(lauf);
        }
        panRef.current = null;
      }
    };
    wrap.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('pointerdown', onMenuPointerDown, true);
    window.addEventListener('mousedown', onMenuPointerDown, true);
    window.addEventListener('touchstart', onMenuPointerDown, true);
    wrap.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    wrap.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    wrap.addEventListener('touchend', onTouchEnd, true);
    wrap.addEventListener('touchcancel', onTouchEnd, true);
    return () => {
      wrap.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      cancelAnimationFrame(rad.bild);
      window.removeEventListener('pointerdown', onMenuPointerDown, true);
      window.removeEventListener('mousedown', onMenuPointerDown, true);
      window.removeEventListener('touchstart', onMenuPointerDown, true);
      wrap.removeEventListener('touchstart', onTouchStart, { capture: true } as EventListenerOptions);
      wrap.removeEventListener('touchmove', onTouchMove, { capture: true } as EventListenerOptions);
      wrap.removeEventListener('touchend', onTouchEnd, true);
      wrap.removeEventListener('touchcancel', onTouchEnd, true);
    };
  }, [getViewport, setViewport, fokusScroll, fokusSchieben, fokusGrenzenX, fokusBalken]);
  const pendingFocus = useBoard((s) => s.pendingFocus);
  const clearPendingFocus = useBoard((s) => s.clearPendingFocus);
  const leinwandKey = `${activeId}:${importEpoch}`;
  const startEinpassen = useRef({ key: '', an: true });
  // M561: Beim gezielten Sprung montiert die Leinwand ohne Gesamteinpassung.
  // React Flow reiht fitView auch nachträglich ein, wenn die Prop wieder wahr wird.
  if (startEinpassen.current.key !== leinwandKey) {
    startEinpassen.current = { key: leinwandKey, an: !(pendingFocus?.boardId === activeId && pendingFocus.einpassen) };
  }

  // Board-Optionen (M88): Hintergrund-Tönung + Gitter/Raster-Fang
  const boardBg = useBoard((s) => selectActiveBoard(s).bg);
  // M360: Nur lesend geteiltes Board — nichts ziehen, verbinden oder tippen (der Speicher verwirft Änderungen ohnehin)
  const nurLesen = useBoard(selectNurLesen);
  /** M370: Steht nur das unberührte Startboard da? Dann bietet das leere Board die Beispiele an. */
  const nurStart = useBoard((s) => !!leeresStartboard(s.boards));
  useEffect(() => {
    if (!nurLesen) return;
    const imBoard = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('.board-wrap');
    const stopp = (e: Event) => { if (imBoard(e)) e.preventDefault(); };
    for (const ev of ['beforeinput', 'cut'] as const) document.addEventListener(ev, stopp, true);
    return () => { for (const ev of ['beforeinput', 'cut'] as const) document.removeEventListener(ev, stopp, true); };
  }, [nurLesen]);
  const gridSnap = useBoard((s) => s.gridSnap);
  const boardMuster = useBoard((s) => sichtbaresBoardMuster(s.boardMuster, s.gridSnap));

  // Archiv (M87): archivierte Karten sind ausgeblendet (React-Flow `hidden`),
  // bei aktivem Archiv-Schalter gedimmt sichtbar. Anhängende Kanten wandern mit.
  const showArchived = useBoard((s) => s.showArchived);
  // M212: Die fokussierte Karte bekommt nur eine Klasse — sie BLEIBT im
  // React-Flow-Baum. Würde man sie woanders neu rendern, verlören Handle,
  // NodeResizer & Co. ihren Kontext; das CSS stellt sie stattdessen
  // formatfüllend (siehe .focus-mode im Stylesheet).
  const focusCard = useBoard((s) => s.focusCard);
  // M486: Gleiche Karte → dasselbe Objekt. Sonst hielte React Flow jede Karte mit Klasse (Schrift, Größe, Archiv)
  // bei jedem Zug-Ereignis für geändert und zeichnete sie samt ihrer Verbindungen neu.
  const rfCache = useRef(new WeakMap<AppNode, AppNode>());
  const rfNodes = useMemo(
    () => nodes.map((n) => {
      // M200: Schrift/Größe pro Karte als Klassen am Node-Wrapper — das CSS
      // erledigt den Rest, kein Durchreichen in jede Karten-Komponente nötig
      const cls = [
        n.archived ? 'archived-card' : '',
        n.font ? `pn-font-${n.font}` : '',
        n.fontSize ? `pn-size-${n.fontSize}` : '',
        n.id === focusCard ? 'pn-focused' : '',
      ].filter(Boolean).join(' ');
      if (!cls && !n.archived) return n;
      const alt = rfCache.current.get(n);
      if (alt && alt.className === (cls || undefined) && alt.hidden === (n.archived ? !showArchived : undefined)) return alt;
      const neu = { ...n, hidden: n.archived ? !showArchived : undefined, className: cls || undefined };
      rfCache.current.set(n, neu);
      return neu;
    }),
    [nodes, showArchived, focusCard],
  );
  // M486: hängt nur an der Menge archivierter Karten, nicht an jeder Lage — sonst neue Kanten-Objekte je Zug-Ereignis
  const archivKey = useMemo(() => nodes.filter((n) => n.archived).map((n) => n.id).join('\n'), [nodes]);
  const rfEdges = useMemo(() => {
    const arch = new Set(archivKey ? archivKey.split('\n') : []);
    if (arch.size === 0) return edges;
    return edges.map((e) =>
      arch.has(e.source) || arch.has(e.target)
        ? { ...e, hidden: !showArchived, className: 'archived-edge' }
        : e,
    );
  }, [archivKey, edges, showArchived]);

  // Tastatur: N = neue Notiz; Strg+Z/Strg+Y = Undo/Redo (außerhalb von Eingabefeldern —
  // in Editoren gilt deren eigenes Undo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* `closest` gibt es nur an Elementen. Kommt das Ereignis von `window`
         oder `document` — was Bibliotheken und Testwerkzeuge durchaus tun —,
         warf die alte Zeile einen Fehler und riss den ganzen Handler mit. */
      const target = e.target as HTMLElement | null;
      if (typeof target?.closest === 'function'
        && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (overlayOffen()) return;   // M388: Die Tasten gehören dem Fenster darüber, nicht der Fläche
      const st = useBoard.getState();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo(); else st.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      // F = Auswahl formatfüllend einpassen (Figma-Gewohnheit); ohne Auswahl: alles
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const selected = selectActiveBoard(st).nodes.filter((n) => n.selected);
        void fitView({
          nodes: selected.length ? selected.map((n) => ({ id: n.id })) : undefined,
          padding: selected.length ? 0.3 : 0.15,
          duration: 400,
          maxZoom: 1.2 * anzRef.current,
        });
        return;
      }
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      // M521: Im Karten-Fokus liegt die Bildmitte unter der offenen Karte — die neue Notiz entstand dahinter, unsichtbar,
      // und nahm den Schreib-Cursor mit
      if (st.focusCard) return;
      addNode(makeNote(screenToFlowPosition({ x: window.innerWidth / 2 - 130, y: window.innerHeight / 2 - 40 })));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addNode, screenToFlowPosition, fitView]);

  // ---------- M481: Ziehen mit Gefühl — wie die Board-Kacheln der Übersicht (M440) ----------
  // Die gegriffene Karte hebt sich und neigt sich mit dem Tempo, Nachbarn weichen weich aus und kehren zurück,
  // beim Loslassen federt sie an ihren Platz. Rechnung in lib/ziehGefuehl.ts (gemeinsam mit der Übersicht),
  // Kurven und Dauern in den --zieh-*-Tokens. Ersetzt die frühere Verdrängungs-/Wurf-Physik: Die schrieb jedes
  // Bild alle angestoßenen Karten in den Stand (Live-Team, Kettenreaktion, Wurf hinter die Fanglinie). Jetzt
  // weicht nur die Anzeige aus; übernommen wird beim Ablegen, im selben Rückgängig-Schritt wie der Zug.
  // Die Bewegungs-Datei kommt erst mit dem ersten Druck auf die Fläche (Start-JS, M446) — bis die Maus die
  // Zieh-Schwelle überschreitet, ist sie längst da.
  const zg = useRef<typeof import('../lib/ziehGefuehl') | null>(null);
  const zieh = useRef<import('../lib/ziehGefuehl').Zug | null>(null);
  // M534: ohne Netz nicht geladen — dann ziehen die Karten eben ohne das Gefühl (kein unbehandelter Fehler)
  const zgLaden = useCallback(() => import('../lib/ziehGefuehl').then((m) => { zg.current = m; return m; }, () => null), []);
  useEffect(() => {
    const wrap = zoomWrapRef.current;
    if (!wrap) return;
    const laden = () => { if (!zg.current) void zgLaden(); };
    wrap.addEventListener('pointerover', laden, { capture: true, once: true });
    wrap.addEventListener('pointerdown', laden, { capture: true, once: true });
    return () => { wrap.removeEventListener('pointerover', laden, { capture: true }); wrap.removeEventListener('pointerdown', laden, { capture: true }); };
  }, [zgLaden]);
  const ziehBeginnen = useCallback((node: Node) => {
    zieh.current = null;
    const st = useBoard.getState();
    const wurzel = zoomWrapRef.current;
    if (!st.ziehBewegung || !wurzel) return;
    const starten = (m: typeof import('../lib/ziehGefuehl')) => {
      const b = selectActiveBoard(useBoard.getState());
      const jetzt = b.nodes.find((n) => n.id === node.id);
      // M485: Karten mit Verbindung — deren Kanten folgen der sichtbaren (gehobenen, ausweichenden) Lage
      // M504: der Einmal-Hinweis aufs Stapeln kommt als kurzer Toast
      if (jetzt) zieh.current = m.zugStarten(wurzel, jetzt, b.nodes, getViewport().zoom || 1, new Set(b.edges.flatMap((e) => [e.source, e.target])), (t) => useBoard.getState().showToast(t, false, 7000));
    };
    if (zg.current) { starten(zg.current); return; }
    // Allererster Zug (Finger: kein Überfahren vorher) — die Datei kommt noch; dann setzt das Gefühl mitten im Zug ein
    void zgLaden().then((m) => { if (m && zugSchritt.current && !zieh.current) starten(m); });
  }, [getViewport, zgLaden]);
  const ziehSchritt = useCallback((node: Node, e?: MouseEvent | TouchEvent) => {
    const z = zieh.current;
    if (!z) return;
    // M504: Alt/⌥ = frei übereinander (niemand weicht aus); der Zeiger zeigt auf das Stapel-Ziel
    const p = e && ('touches' in e ? e.touches[0] ?? e.changedTouches[0] : e);
    z.schritt(node.position.x, node.position.y, getViewport().zoom || 1, fangAktiv(), e && { alt: e.altKey, finger: 'touches' in e, zeiger: p ? screenToFlowPosition({ x: p.clientX, y: p.clientY }) : undefined });
  }, [getViewport, screenToFlowPosition]);
  /** Loslassen: Karte senkt sich federnd, was noch ausweicht, bleibt dort (selber Rückgängig-Schritt wie der Zug) */
  const ziehEnde = useCallback((abbrechen = false) => {
    const z = zieh.current;
    zieh.current = null;
    if (!z) return;
    const lagen = z.ende(abbrechen);
    if (lagen.length === 0) return;
    // M504: auf einen Stapel gelegt — die Karten liegen obenauf (in der Reihenfolge des Stapels); selber Rückgängig-Schritt
    mutedHistory(() => { const st = useBoard.getState(); for (const id of z.gestapelt) st.touchNode(id); st.setNodePositions(lagen); });
    z.aufloesen(lagen);
  }, []);
  // Board gewechselt oder Fläche weg mitten im Zug: nichts hängen lassen
  useEffect(() => () => ziehEnde(true), [activeId, ziehEnde]);

  // Frame-Mitzug (M149): Beim Greifen eines Rahmens werden alle Karten
  // eingesammelt, deren MITTELPUNKT im Rahmen liegt — sie folgen dem Rahmen
  // dann live mit jedem Drag-Delta (eine History-Stufe, keine Physik).
  // M542: Der Mitzug läuft in onNodesChangeFang mit dem Versatz NACH dem Einrasten (vorher in onNodeDrag mit der
  // ungefangenen Lage aus React Flow — mit Fangen wären Rahmen und Inhalt auseinandergelaufen). `x`/`y` = zuletzt
  // geschriebene Lage der gegriffenen Karte.
  const frameDrag = useRef<{ id: string; ids: Set<string>; x: number; y: number } | null>(null);
  // M542: Größe ändern mit Fangen — Kasten beim Greifen, Mitglieder (Rahmen), zuletzt geschriebene Größe
  const groesseZug = useRef<{ id: string; start: Kasten; mit: Set<string>; min: { w: number; h: number }; fest: boolean; letzte: { w: number; h: number } | null } | null>(null);

  /**
   * M344: Fanglinien. Beim Ziehen rastet die Karte (bzw. der Kasten um alle gezogenen Karten) an
   * Kanten und Mitten der übrigen Karten ein — 6 Bildpunkte Fangweite, in jeder Zoomstufe gleich.
   * Strg/⌘ gedrückt: frei ablegen. Mit Raster-Fang hat das Raster Vorrang; Rahmen (seit M542) rasten
   * genauso ein, ihr Inhalt geht im selben Schub mit. M490: Einrasten „Aus" (fangLinien false) = frei.
   * M505: Das Einrasten setzt weiter die Lage im Stand (exakt), meldet den Versatz aber dem Zug
   * (`zieh.current.fang`) — die Anzeige gleitet dann an die Stelle, statt zu springen (lib/ziehGefuehl.ts).
   * Das Raster rastet beim Ziehen von Karten deshalb hier ein statt in React Flow (`rasterSelbst`): React Flows
   * `snapToGrid` liefert nur die schon gerastete Lage, der Sprung wäre nicht mehr zu erkennen.
   */
  const strgRef = useRef(false);
  const ziehtRef = useRef(false);
  const rasterSelbst = useRef(false);
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      strgRef.current = e.ctrlKey || e.metaKey;
      // M504: Alt/⌥ während des Zugs — niemand weicht aus, frei übereinander legen (auch ohne die Maus zu bewegen).
      // preventDefault: unter Windows holte das Loslassen von Alt sonst das Browser-Menü
      if (e.key === 'Alt' && zieh.current && !overlayOffen()) { e.preventDefault(); zieh.current.frei(e.type === 'keydown'); }
    };
    const weg = () => { strgRef.current = false; zieh.current?.frei(false); };
    window.addEventListener('keydown', taste, true); window.addEventListener('keyup', taste, true); window.addEventListener('blur', weg);
    return () => { window.removeEventListener('keydown', taste, true); window.removeEventListener('keyup', taste, true); window.removeEventListener('blur', weg); };
  }, []);
  /**
   * M542: Fangen beim Ändern der Größe (Griffe von React Flow an Rahmen und Karten). Die bewegte Kante rastet an
   * Kanten und Mitten der anderen ein, mit Linie wie beim Ziehen; die gegenüberliegende bleibt stehen. Strg/⌘ = frei,
   * mit Raster-Fang rastet React Flow selbst aufs Raster. React Flow rechnet jeden Schritt aus dem Zeigerweg seit dem
   * Greifen (Einrasten sammelt sich also nicht an); seine letzte Meldung (resizing: false) trägt wieder die rohe Größe
   * und bekommt deshalb die zuletzt gefangene. Rahmen fangen nicht an ihrem eigenen Inhalt. Karten mit festem
   * Seitenverhältnis (Bild, Datei, Pixi) bleiben frei — eine Kante allein bräche das Verhältnis.
   */
  const groesseImZug = useCallback((changes: NodeChange[]): 'laeuft' | 'ende' | null => {
    const rz = changes.find((c): c is Extract<NodeChange, { type: 'dimensions' }> => c.type === 'dimensions' && typeof c.resizing === 'boolean' && !!c.dimensions);
    if (!rz?.dimensions) return null;
    const st = useBoard.getState();
    const g0 = groesseZug.current;
    if (!rz.resizing) {
      fangSetzen([], true);
      groesseZug.current = null;
      if (g0?.id === rz.id && g0.letzte) rz.dimensions = { width: g0.letzte.w, height: g0.letzte.h };
      return 'ende';
    }
    const alle = selectActiveBoard(st).nodes;
    let g = g0?.id === rz.id ? g0 : null;
    if (!g) {
      const n = alle.find((k) => k.id === rz.id);
      if (!n) return 'laeuft';
      const s = sizeOf(n);
      const rahmen = n.type === 'frame';
      const w = rahmen && typeof n.width === 'number' ? n.width : s.w;
      const h = rahmen && typeof n.height === 'number' ? n.height : s.h;
      g = {
        id: n.id, start: { x: n.position.x, y: n.position.y, w, h },
        mit: new Set(rahmen ? frameMembers(n, alle, true, true).map((m) => m.id) : []),
        min: rahmen ? RAHMEN_MIN : { w: 60, h: 40 },
        fest: n.type === 'file' || n.type === 'pixi' || (n.type === 'image' && !(n.data as { rahmen?: boolean }).rahmen),
        letzte: null,
      };
      groesseZug.current = g;
    }
    const pc = changes.find((c): c is Extract<NodeChange, { type: 'position' }> => c.type === 'position' && c.id === rz.id && !!c.position);
    const k = { x: pc?.position?.x ?? g.start.x, y: pc?.position?.y ?? g.start.y, w: rz.dimensions.width, h: rz.dimensions.height };
    if (g.fest || strgRef.current || st.gridSnap || !st.fangLinien) { fangSetzen([]); g.letzte = null; return 'laeuft'; }
    const e = 0.01; const s0 = g.start;
    const kanten = { l: Math.abs(k.x - s0.x) > e, r: Math.abs(k.x + k.w - s0.x - s0.w) > e, o: Math.abs(k.y - s0.y) > e, u: Math.abs(k.y + k.h - s0.y - s0.h) > e };
    const mit = g.mit; const eigen = g.id;
    const andere: Kasten[] = alle
      .filter((n) => n.id !== eigen && !mit.has(n.id) && !n.hidden && (!n.archived || st.showArchived))
      .map((n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? n.width ?? 260, h: n.measured?.height ?? n.height ?? 120 }));
    const f = groesseFangen(k, kanten, andere, 6 / (getViewport().zoom || 1), g.min);
    rz.dimensions = { width: f.k.w, height: f.k.h };
    if (pc) pc.position = { x: f.k.x, y: f.k.y };
    g.letzte = { w: f.k.w, h: f.k.h };
    fangSetzen({ linien: f.linien, abstaende: [] });
    return 'laeuft';
  }, [getViewport]);
  const onNodesChangeFang = useCallback((changes: NodeChange[]) => {
    // Auch die LETZTE Meldung eines Zugs (dragging: false) trägt die ungefangene Lage — sie muss genauso
    // einrasten, sonst springt die Karte beim Loslassen zurück. Pfeiltasten melden ebenfalls dragging: false,
    // gehören aber zu keinem Zug: Sie sollen aus einer Fangstelle herausschieben können.
    const laeuft = changes.some((c) => c.type === 'position' && !!c.dragging);
    const ende = !laeuft && ziehtRef.current && changes.some((c) => c.type === 'position' && c.dragging === false);
    if (laeuft) ziehtRef.current = true;
    const zuege = changes.filter((c): c is Extract<NodeChange, { type: 'position' }> => c.type === 'position' && !!c.position && (!!c.dragging || ende));
    if (ende) ziehtRef.current = false;
    if (zuege.length) {
      const st = useBoard.getState();
      const alle = selectActiveBoard(st).nodes;
      const ids = new Set(zuege.map((c) => c.id));
      const mass = (n: AppNode) => ({ w: n.measured?.width ?? n.width ?? 260, h: n.measured?.height ?? n.height ?? 120 });
      const bewegt = alle.filter((n) => ids.has(n.id));
      // eingerastet = exakt dort (Rundungsreste der Gleitkommarechnung weg, sonst läge 0 bei 8,9e-16)
      const glatt = (v: number) => Math.round(v * 1e6) / 1e6;
      // M542: Rahmen rasten jetzt wie Karten ein — ihr Inhalt folgt unten mit demselben Versatz
      const frei = strgRef.current || bewegt.length === 0;
      const roh = { rx: zuege[0].position!.x, ry: zuege[0].position!.y };   // M505: Lage unter dem Zeiger
      const fd = frameDrag.current;
      if (st.gridSnap && rasterSelbst.current && !frei) {
        // M505: Raster wie React Flow (Versatz der ersten Karte für alle), aber mit gemeldetem Versatz
        fangSetzen([], ende);
        const ref = zuege[0].position!;
        const dx = Math.round(ref.x / 20) * 20 - ref.x; const dy = Math.round(ref.y / 20) * 20 - ref.y;
        for (const c of zuege) if (c.position) c.position = { x: glatt(c.position.x + dx), y: glatt(c.position.y + dy) };
        zieh.current?.fang({ dx, dy, zx: glatt(ref.x + dx), zy: glatt(ref.y + dy), ...roh });
      } else if (st.gridSnap || !st.fangLinien || frei) {
        fangSetzen([], ende);
        zieh.current?.fang({ dx: 0, dy: 0, zx: null, zy: null, ...roh });
      } else {
        let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
        for (const c of zuege) {
          const n = bewegt.find((k) => k.id === c.id);
          if (!n || !c.position) continue;
          const m = mass(n);
          x1 = Math.min(x1, c.position.x); y1 = Math.min(y1, c.position.y);
          x2 = Math.max(x2, c.position.x + m.w); y2 = Math.max(y2, c.position.y + m.h);
        }
        // M542: Was ein gezogener Rahmen mitnimmt, ist kein „anderer" — sonst rastete er an seinem eigenen Inhalt ein
        const andere: Kasten[] = alle
          .filter((n) => !ids.has(n.id) && !n.selected && !fd?.ids.has(n.id) && (!n.archived || st.showArchived))
          .map((n) => ({ x: n.position.x, y: n.position.y, ...mass(n) }));
        const f = fangen({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, andere, 6 / (getViewport().zoom || 1));
        if (f.dx || f.dy) for (const c of zuege) if (c.position) c.position = { x: f.dx ? glatt(c.position.x + f.dx) : c.position.x, y: f.dy ? glatt(c.position.y + f.dy) : c.position.y };
        fangSetzen(ende ? [] : { linien: f.linien, abstaende: f.abstaende }, ende);
        // M505: den Sprung (einrasten, lösen, andere Stelle) gleitet die Anzeige ab
        zieh.current?.fang({ dx: f.dx, dy: f.dy, zx: f.gx ? glatt(x1 + f.dx) : null, zy: f.gy ? glatt(y1 + f.dy) : null, ...roh });
      }
      // M390/M542: Rahmen-Mitzug im selben Schub wie der Rahmen — exakt derselbe Versatz wie die gegriffene Karte nach
      // dem Einrasten (auch beim Einrasten und Lösen springt der Inhalt nicht gegen den Rahmen)
      const greif = fd && zuege.find((c) => c.id === fd.id);
      if (fd && greif?.position && fd.ids.size) {
        const dx = greif.position.x - fd.x; const dy = greif.position.y - fd.y;
        fd.x = greif.position.x; fd.y = greif.position.y;
        if (dx || dy) {
          for (const n of alle) {
            if (!fd.ids.has(n.id)) continue;
            changes.push({ id: n.id, type: 'position', position: { x: glatt(n.position.x + dx), y: glatt(n.position.y + dy) } });
          }
        }
      } else if (fd && greif?.position) { fd.x = greif.position.x; fd.y = greif.position.y; }
    }
    const groesse = groesseImZug(changes);
    onNodesChange(changes as Parameters<typeof onNodesChange>[0]);
    if (groesse === 'ende') rahmenWachsen();   // M542: Größe von Hand zu Ende — Rahmen mit Auto-Größe ziehen nach
    // M542: Eine Karte misst sich neu (wächst mit ihrem Inhalt) — Rahmen mit Auto-Größe wachsen mit. Abgeleitet: kein
    // eigener Rückgängig-Schritt, kein Hochladen (jedes Gerät misst selbst, CLAUDE.md §6 „Abgleich"). Mitten in einer
    // Größenänderung von Hand oder einem Zug nicht: das übernimmt deren Ende als echte Änderung (im selben Schritt)
    else if (!groesseZug.current && !ziehtRef.current && changes.some((c) => c.type === 'dimensions' && c.resizing === undefined)) {
      const alle = selectActiveBoard(useBoard.getState()).nodes;
      if (alle.some(rahmenAuto)) runDerived(() => rahmenWachsen());
    }
  }, [onNodesChange, getViewport, groesseImZug]);
  useBoardTasten({ getViewport, setCenter, zoomIn, zoomOut, zoomTo }, anzRef);

  const zugSchritt = useRef<{ eintrag: unknown; x: number; y: number } | null>(null);
  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    zugSetzen(true); // M491: bewegte Kanten blenden ihren Schatten bis zum Ablegen aus
    // M491: leere Beschriftungen (unsichtbar, `opacity: 0`) liegen im Zug nicht mehr im Bild — jede verschobene war eine
    // eigene Ebene, die Chromium Bild für Bild neu einordnen musste (Layerize)
    zoomWrapRef.current?.setAttribute('data-zug', '');
    // M390: JEDER Rahmen, der sich bewegt, nimmt seinen Inhalt mit — nicht nur der gegriffene. Vorher blieb der
    // Inhalt liegen, sobald zwei Rahmen gewählt waren oder man an einer mitgewählten Karte zog.
    {
      const all = selectActiveBoard(useBoard.getState()).nodes;
      const gewaehlt = node.selected ? all.filter((n) => n.selected) : [];
      const rahmen = [...(node.type === 'frame' ? [node as AppNode] : []), ...gewaehlt.filter((n) => n.type === 'frame' && n.id !== node.id)];
      if (rahmen.length) {
        const bewegt = new Set([node.id, ...gewaehlt.map((n) => n.id)]);
        // Mitglieder inkl. verschachtelter (kleinerer) Rahmen — deren Karten liegen ohnehin im äußeren Rahmen und
        // bewegen sich genau EINMAL (M150); archivierte wandern mit
        const ids = [...new Set(rahmen.flatMap((f) => frameMembers(f, all, true, true).map((n) => n.id)))].filter((id) => !bewegt.has(id));
        frameDrag.current = { id: node.id, ids: new Set(ids), x: node.position.x, y: node.position.y };
      } else frameDrag.current = null;
    }
    // M505: Raster beim Ziehen selbst einrasten (onNodesChangeFang) — React Flow liest `snapToGrid` je Mausbewegung aus
    // seinem Stand. M542: auch für Rahmen (der Mitzug läuft jetzt im selben Schub mit dem gefangenen Versatz)
    if (useBoard.getState().gridSnap) {
      rasterSelbst.current = true;
      rfStore.setState({ snapToGrid: false });
    }
    if (node.type === 'frame') {
      useBoard.getState().pushHistory();
      return;
    }
    ziehBeginnen(node); // M481: heben, neigen, Nachbarn ausweichen lassen
    // M365: Auch das Verschieben ist ein Schritt, den Strg+Z zurücknimmt (bisher nur bei Rahmen) — in der
    // Gruppenarbeit holt man so eine versehentlich weggezogene Karte zurück, ohne anderen etwas zu nehmen.
    useBoard.getState().pushHistory();
    const past = useBoard.getState().past;
    zugSchritt.current = { eintrag: past[past.length - 1], x: node.position.x, y: node.position.y };
  }, [ziehBeginnen, rfStore]);

  // Leertaste halten + ziehen = Pannen, auch ÜBER Karten (Photoshop-Gewohnheit).
  // React Flow startet den Flächen-Pan nur auf der Fläche selbst — deshalb werden
  // Karten während gehaltener Leertaste durchklick-transparent (CSS .space-pan).
  const [spaceHeld, setSpaceHeld] = useState(false);
  /**
   * M343: Bedienung in jeder Zoomstufe. Die Griffe der Karten liegen in der gezoomten Fläche; damit
   * sie ihre Bildschirm-Größe behalten, bekommt das Stylesheet den Kehrwert des Zooms (`--pn-inv`).
   * Gesetzt wird er erst, wenn der Zoom kurz ruht — eine Variable an der Wurzel der Fläche lässt den
   * Browser alle Karten neu bewerten, und während des Zoomens greift ohnehin niemand nach einem Griff.
   * Unter ~45 % gilt „weit": Die ganze Karte ist der Griff (noDragClassName aus), ihr Inhalt ruht.
   */
  const [weit, setWeit] = useState(false);
  const weitRef = useRef(false);
  /**
   * M404: Die Bedienung aufgeklappter Dokument-Karten (Titel, Blätterleiste, Kommentarliste) wächst nur bis 130 % mit –
   * wer zum Lesen weiter hineinzoomt, bekommt mehr Seite statt größerer Knöpfe. `--pn-ui` trägt das Maß (CSS `zoom`
   * an diesen Teilen); anders als `--pn-inv` wird es sofort gesetzt, in kleinen Stufen, damit beim Zoomen nichts springt.
   * Weil die Karte dabei flacher wird, rutscht die Seite nach oben: Liegt die Stelle (x, y) auf einer Seite, kommt
   * zurück, um wie viele Flächenpunkte – der Zoom-Anker zieht dann mit, und die Zeile unter dem Zeiger bleibt stehen.
   */
  const uiStand = useRef(1);
  const uiMelden = useCallback((zoom: number, x?: number, y?: number): number => {
    const wrap = zoomWrapRef.current;
    if (!wrap) return 0;
    // Im Fokus nicht: Dort misst sich die Ansicht an der Karte aus (würde sie flacher, passte sie sich neu ein), und die
    // Leisten des Fokus liegen ohnehin fest auf dem Schirm
    const ui = fokusRef.current ? 1 : bedienMass(zoom / (anzRef.current || 1));
    if (ui === uiStand.current) return 0;
    uiStand.current = ui;
    const seite = x !== undefined && y !== undefined ? (document.elementFromPoint(x, y)?.closest('.pdf-seite') as HTMLElement | null) : null;
    const vor = seite?.getBoundingClientRect().top;
    if (ui === 1) wrap.style.removeProperty('--pn-ui'); else wrap.style.setProperty('--pn-ui', String(ui));
    if (!seite || vor === undefined) return 0;
    const nach = seite.getBoundingClientRect().top;
    const fl = wrap.querySelector('.react-flow__viewport');
    const jetzt = fl ? new DOMMatrixReadOnly(getComputedStyle(fl).transform).a : 0;
    return jetzt > 0 ? (nach - vor) / jetzt : 0;
  }, []);
  const uiMeldenRef = useRef(uiMelden);
  uiMeldenRef.current = uiMelden;
  const zoomZeit = useRef<number | undefined>(undefined);
  const zoomMelden = useCallback((zoom: number, sofort = false) => {
    window.clearTimeout(zoomZeit.current);
    const setzen = () => {
      boardZoomMelden(zoom);   // M392: Wer Bilder malt (PDF-Seiten), malt sie jetzt in der passenden Feinheit
      const wrap = zoomWrapRef.current;
      if (!wrap) return;
      const rel = zoom / (anzRef.current || 1);
      // M404: über 250 % hinaus (bis 600 %) bleiben Griffe und Rahmen so groß wie bei 250 %
      const inv = String(Math.round((rel > 2.5 ? 1.5 / rel : Math.max(0.6, Math.min(7, 1 / rel))) * 20) / 20);
      if (wrap.style.getPropertyValue('--pn-inv') !== inv) {
        wrap.style.setProperty('--pn-inv', inv);
        window.dispatchEvent(new Event('pixinotes:zoom-ruht'));   // M346: Scrollbalken passen ihre Größe an
      }
      /**
       * M401: Linienstärke im weiten Zoom. Vorher blieb die Linie dort 2 Bildpunkte stark – und weil die Pfeilspitze
       * an der Linienstärke hängt, stand sie mit 16 Bildpunkten vor Karten, die nur noch 20 breit waren. Jetzt
       * schrumpft die Linie mit (knapp ein Bildpunkt an der Grenze, nie unter 0,75), die Spitze entsprechend auf
       * 6 bis 7 Bildpunkte. Der Wert steht in Flächenpunkten, ohne Deckel wie bei `--pn-inv`.
       */
      const kante = String(Math.round((Math.max(0.75, 0.9 * Math.sqrt(Math.min(rel, 0.5) / 0.45)) / Math.max(rel, 0.01)) * 100) / 100);
      if (wrap.style.getPropertyValue('--pn-kante') !== kante) wrap.style.setProperty('--pn-kante', kante);
      // mit Spielraum, damit die Grenze beim Zoomen nicht flattert
      const jetzt = weitRef.current ? rel < 0.5 : rel < 0.45;
      if (jetzt !== weitRef.current) { weitRef.current = jetzt; setWeit(jetzt); }
    };
    if (sofort) setzen(); else zoomZeit.current = window.setTimeout(setzen, 90);
  }, []);
  // M514: Im Flug der Rahmen-Reise ruht die Bedien-Größe (siehe lib/rahmenReise.ts) — nach der Landung beides auf einmal
  // nachziehen (Bedien-Größe und Zoom-Werte im selben Bild: EINE Stilrechnung statt zwei)
  useEffect(() => {
    const ruht = () => { const z = getViewport().zoom; uiMeldenRef.current(z); zoomMelden(z, true); };
    window.addEventListener(REISE_RUHT, ruht);
    return () => window.removeEventListener(REISE_RUHT, ruht);
  }, [getViewport, zoomMelden]);
  useEffect(() => {
    const id = requestAnimationFrame(() => { uiMelden(getViewport().zoom); zoomMelden(getViewport().zoom, true); });
    return () => { cancelAnimationFrame(id); window.clearTimeout(zoomZeit.current); };
  }, [activeId, anzeige, getViewport, zoomMelden, uiMelden]);
  const letzterSprung = useRef<typeof pendingFocus>(null);
  // Nach Board-Wechsel zur gefundenen Karte fliegen und sie markieren.
  useEffect(() => {
    if (!pendingFocus || pendingFocus.boardId !== activeId) return;
    letzterSprung.current = pendingFocus;
    const node = nodes.find((n) => n.id === pendingFocus.nodeId);
    if (!node) { clearPendingFocus(); return; }
    // Treffer liegt im (ausgeblendeten) Archiv → Archiv einblenden, sonst
    // fliegt die Suche ins Leere
    if (node.archived && !useBoard.getState().showArchived) {
      useBoard.getState().setShowArchived(true);
      useBoard.getState().showToast('Der Treffer liegt im Archiv – archivierte Karten sind jetzt eingeblendet.');
    }
    const ungueltig = () => {
      const stand = useBoard.getState();
      return stand.activeId !== activeId || stand.view !== 'board' || stand.tasksOpen || stand.presenting;
    };
    const markieren = () => {
      if (pendingFocus.markieren === false) return;
      const karten = selectActiveBoard(useBoard.getState()).nodes;
      if (karten.some((n) => n.id === node.id)) onNodesChange(
        karten.filter((n) => !!n.selected !== (n.id === node.id))
          .map((n) => ({ id: n.id, type: 'select' as const, selected: n.id === node.id })),
      );
    };
    if (pendingFocus.einpassen) {
      let bild = 0;
      const ende = performance.now() + 700;
      const fliegen = () => {
        const stand = useBoard.getState();
        if (stand.pendingFocus !== pendingFocus) return;
        if (ungueltig() || stand.focusCard) {
          clearPendingFocus();
          return;
        }
        const leinwand = zoomWrapRef.current?.querySelector('.react-flow');
        const flaeche = leinwand?.getBoundingClientRect();
        const { domNode, panZoom } = rfStore.getState();
        // Der gemeinsame React-Flow-Store kann noch den Renderer des vorigen Boards tragen.
        if (!panZoom || domNode !== leinwand || !flaeche?.width) {
          bild = requestAnimationFrame(fliegen);
          return;
        }
        const intern = getInternalNode(node.id);
        const { width, height } = intern?.measured ?? {};
        if ((!width || !height) && performance.now() < ende) {
          bild = requestAnimationFrame(fliegen);
          return;
        }
        const lage = intern?.internals.positionAbsolute ?? node.position;
        const mass = sizeOf(node);
        const ziel = modulAusschnitt(flaeche, { ...lage, w: width || mass.w, h: height || mass.h }, anzRef.current);
        clearPendingFocus();
        if (!ziel) return;
        if (pendingFocus.markieren !== false) onNodesChange(
          selectActiveBoard(stand).nodes.filter((n) => n.selected)
            .map((n) => ({ id: n.id, type: 'select' as const, selected: false })),
        );
        const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 440;
        void setViewport(ziel, { duration }).then((angekommen) => {
          const aktuell = useBoard.getState();
          if (!angekommen || letzterSprung.current !== pendingFocus || aktuell.pendingFocus || ungueltig()
            || aktuell.focusCard || zoomWrapRef.current?.querySelector('.react-flow') !== leinwand) return;
          // Die Griffe bekommen ihr richtiges Maß, bevor sie mit der Auswahl erscheinen.
          zoomMelden(ziel.zoom, true);
          markieren();
        });
      };
      bild = requestAnimationFrame(() => { bild = requestAnimationFrame(fliegen); });
      return () => {
        cancelAnimationFrame(bild);
        if (useBoard.getState().pendingFocus === pendingFocus && ungueltig()) clearPendingFocus();
      };
    }
    const t = setTimeout(() => {
      const w = node.measured?.width ?? 280;
      const h = node.measured?.height ?? 120;
      setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1, duration: 650 });
      markieren();
      clearPendingFocus();
    }, 80);
    return () => clearTimeout(t);
  }, [pendingFocus, activeId, nodes, setCenter, setViewport, rfStore, getInternalNode, clearPendingFocus, onNodesChange, zoomMelden]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      /* `closest` gibt es nur an Elementen. Kommt das Ereignis von `window`
         oder `document` — was Bibliotheken und Testwerkzeuge durchaus tun —,
         warf die alte Zeile einen Fehler und riss den ganzen Handler mit. */
      const target = e.target as HTMLElement | null;
      if (typeof target?.closest === 'function'
        && target.closest('input, textarea, [contenteditable="true"]')) return;
      // M388: Auf einem Knopf, einer Auswahl oder einem Aufklapper löst die Leertaste DIESEN aus — und über einem
      // Fenster schwenkt sie nichts. (Vorher schluckte das Board sie: Knöpfe ließen sich nur mit Enter bedienen.)
      if (typeof target?.closest === 'function' && target.closest('button, a[href], select, summary, [role="button"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"]')) return;
      if (overlayOffen()) return;
      e.preventDefault(); // Seite darf nicht scrollen
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false); };
    const reset = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const flyingUntil = useRef(0);

  /**
   * M228: Wie man den Fokus öffnet, hängt am EINGABEGERÄT, nicht an der Größe.
   *
   * Am Finger ist ein Tipp die einzige Geste — dort öffnet er den Fokus.
   * Mit Maus ist ein Klick etwas anderes: Damit setzt man den Cursor in eine
   * Notiz und schreibt. Würde jeder Klick das große Blatt öffnen, wäre das
   * direkte Arbeiten auf dem Board kaputt. Darum dort der DOPPELKLICK — und
   * auch der nur außerhalb von Textfeldern, wo er Wörter markiert.
   */
  const oeffneFokus = useCallback((node: Node): boolean => {
    const st = useBoard.getState();
    if (!st.cardFocus || st.focusCard) return false;
    const full = selectActiveBoard(st).nodes.find((n) => n.id === node.id);
    if (!focusable(full)) return false;
    st.setFocusCard(node.id);
    return true;
  }, []);

  /**
   * M333: Fokus = Zoom. Die Karte bleibt, wo sie ist; die Kamera fährt so, dass
   * sie den Schirm zwischen Kopf- und Fußleiste füllt. Beim Schließen fährt sie
   * zur vorherigen Ansicht zurück. Blättern fährt weiter, ohne den Rückweg zu
   * vergessen. Kein zweiter Editor, keine Vollbild-Position — Stift, Finger und
   * Gesten arbeiten auf derselben Fläche weiter.
   */
  /* M353: Platz der Leisten unten im Fokus. `--focus-bottom` ist eine calc()-Summe — als nicht registrierte
     Eigenschaft liefert getComputedStyle sie als TEXT („calc(var(--focus-nav-h) + …)"), parseFloat ergab NaN → 0.
     Die Kamera ließ darum nie Platz für Blätter-, Werkzeug- und Formatier-Leiste. Die drei Summanden sind
     schlichte Pixelwerte und lassen sich lesen. */
  const fokusUnten = (css: CSSStyleDeclaration) =>
    ['--focus-nav-h', '--focus-tools-h', '--focus-format-h'].reduce((s, v) => s + (parseFloat(css.getPropertyValue(v)) || 0), 0);
  const fokusRueckkehr = useRef<{ x: number; y: number; zoom: number } | null>(null);
  // M413: Startet aus dem Fokus die Präsentation, wird das Board ausgehängt, bevor es zur Ansicht von vorher
  // zurückgefahren ist – es kam dann in der Fokus-Ansicht zurück (hineingezoomt, mitten auf der Karte). Beim
  // Aushängen wird deshalb die Ansicht von vor dem Fokus gemerkt, auch wenn die Rückfahrt gerade noch läuft.
  const fokusRueckfahrt = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const aktivesBoard = useRef(activeId);
  aktivesBoard.current = activeId;
  useEffect(() => () => {
    const zurueck = fokusRueckkehr.current ?? fokusRueckfahrt.current;
    if (zurueck) gemerkteAnsicht.set(aktivesBoard.current, zurueck);
  }, []);
  useEffect(() => {
    if (focusCard) {
      if (!fokusRueckkehr.current) fokusRueckkehr.current = getViewport();
      let versuche = 0;
      let raf = 0;
      let beobachter: ResizeObserver | null = null;
      let zuletzt = { w: 0, h: 0, p: 0 };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let platzUnten = -1;
      const fahren = (dauer = 320, nachfahren = false) => {
        const el = document.querySelector(`.react-flow__node[data-id="${focusCard}"]`) as HTMLElement | null;
        const pane = document.querySelector('.react-flow') as HTMLElement | null;
        const n = useBoard.getState().boards.find((b) => b.id === useBoard.getState().activeId)?.nodes.find((k) => k.id === focusCard);
        if (!el || !pane || !n || el.offsetWidth < 2) { if (versuche++ < 10) raf = requestAnimationFrame(() => fahren(dauer)); return; }
        /* M409: Die Karte wird im Fokus so breit wie die FLÄCHE – nicht wie das Fenster. Steht links die Navigation,
           ist die Fläche schmaler; ein Modul (bis 1200 breit) ragte dann rechts aus dem Bild und war dort abgeschnitten. */
        document.documentElement.style.setProperty('--fokus-platz', `${pane.clientWidth}px`);
        // Wächst die Karte nach dem Einpassen (Bild oder PDF lädt, Text wird länger), zieht die Kamera nach
        if (!beobachter && typeof ResizeObserver !== 'undefined') {
          beobachter = new ResizeObserver(() => {
            if (Math.abs(el.offsetWidth - zuletzt.w) < 4 && Math.abs(el.offsetHeight - zuletzt.h) < 4 && Math.abs(pane.clientWidth - zuletzt.p) < 4) return;
            clearTimeout(timer);
            timer = setTimeout(() => fahren(220, true), 120);
          });
          beobachter.observe(el);
          beobachter.observe(pane);
        }
        zuletzt = { w: el.offsetWidth, h: el.offsetHeight, p: pane.clientWidth };
        const css = getComputedStyle(document.documentElement);
        // M426: 0 ist ein gültiger Wert („Nur Inhalt") — „|| 52" machte daraus wieder 52
        const obenWert = parseFloat(css.getPropertyValue('--focus-top'));
        const oben = Number.isFinite(obenWert) ? obenWert : 52;
        const unten = fokusUnten(css);
        const tastatur = parseFloat(css.getPropertyValue('--kb')) || 0;
        platzUnten = unten + tastatur;
        const breite = pane.clientWidth;
        const hoehe = Math.max(160, pane.clientHeight - oben - unten - tastatur);
        // Lage (absolut, auch in Rahmen) aus React Flow, Größe als Layout-Maß aus dem DOM —
        // beides unabhängig von der gerade laufenden Kamerafahrt (ein animiertes Rechteck
        // gegen den Ziel-Zoom gerechnet ergab sonst falsche Maße und eine Rückkopplung)
        const intern = getInternalNode(focusCard);
        const fx = intern?.internals.positionAbsolute.x ?? n.position.x;
        const fy = intern?.internals.positionAbsolute.y ?? n.position.y;
        const w = el.offsetWidth, h = el.offsetHeight;
        /* M346: Die Karte ist im Fokus breiter (und als Notiz länger) als auf dem Board — sie legte sich über
           ihre Nachbarn, die abgedunkelt durchschienen: ein Überlappen, das es auf dem Board nicht gibt.
           Was unter der vergrößerten Karte läge, tritt darum ganz zurück; der Rest bleibt als Umgebung. */
        const luft = 16;
        for (const k of Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[]) {
          const kid = k.dataset.id;
          const i = kid && kid !== focusCard ? getInternalNode(kid) : null;
          if (!i) { k.removeAttribute('data-fokus-weg'); continue; }
          const kx = i.internals.positionAbsolute.x, ky = i.internals.positionAbsolute.y;
          const kw = i.measured?.width ?? k.offsetWidth, kh = i.measured?.height ?? k.offsetHeight;
          k.toggleAttribute('data-fokus-weg', kx < fx + w + luft && kx + kw > fx - luft && ky < fy + h + luft && ky + kh > fy - luft);
        }
        // Am Finger fast randlos (jeder Punkt zählt für Spalten und Zellen), mit Maus etwas Luft
        const grob = window.matchMedia('(pointer: coarse)').matches;
        // M426: „Nur Inhalt" (reinAnsicht.tsx) — keine Leisten, kein Rand: die Karte bekommt den ganzen Schirm
        const rein = document.documentElement.dataset.rein === 'fokus';
        const rand = rein ? 0 : grob ? 4 : 16;
        const passt = Math.min((breite - 2 * rand) / w, (hoehe - 2 * rand) / h);
        // Die Karte ist im Fokus schon verbreitert (CSS min-width: Schirmbreite, Text bis 720,
        // Module bis 1200). TEXT (Notiz, Bild, Datei, Mail) wird zusätzlich hochskaliert, bis es
        // den Schirm füllt — am Finger kräftig, mit Maus maßvoll. MODULE (Zeitplan, Kanban,
        // Planer …) bleiben bei Zoom 1: mehr Spalten und Zellen statt größerer Pixel — das war
        // der Grund für den alten Fokus (M212), und bleibt.
        const text = ['note', 'image', 'file', 'email', 'shape'].includes(n.type ?? '');
        /* M353: Eine aufgeschlagene PDF-/Word-Seite passt GANZ zwischen Kopfzeile und Leisten — wie „ganze
           Seite" im PDF-Programm. Bisher galt auch hier „nie kleiner als 1": Eine Seite, die etwas höher war als
           der freie Platz, lief unter Werkzeug- und Blätter-Leiste weiter, und man sah ihr unteres Ende nicht.
           Nur wenn sie dafür wenig schrumpfen muss (bis 0,75): Eine A4-Seite im Hochformat am Querformat-Schirm
           würde sonst kaum größer als auf dem Board — sie bleibt lesbar breit, und ihr unteres Ende lässt sich
           bis über die Leisten rollen (seit `fokusUnten` stimmt der Platz dafür). */
        const dokument = n.type === 'file' && !!el.querySelector('.pdf-seite');
        /* M363: Ein Dokument ist nie breiter als der Schirm. Am Telefon war die Karte (520 breit auf 390) rechts
           abgeschnitten und ließ sich nicht seitlich schieben. Jetzt gilt „Seitenbreite": Die Seite füllt die
           Breite und rollt senkrecht; am Finger wird eine schmale Karte dafür auch vergrößert. Hineinzoomen
           geht mit zwei Fingern, Doppeltipp oder Strg+Rad. */
        const inBreite = (breite - 2 * rand) / w;
        /* M413: Der Fokus zeigt die Karte, WIE SIE IST – nur größer. Bisher wurde sie dafür umgeformt: Notizen
           auf 720 Punkte verbreitert (der Text brach neu um), Module auf bis zu 1200 (aus einem Hochformat wurde
           ein Querformat). Jetzt behält jede Karte ihre Maße, und die Kamera fährt heran:
             · Text (Notiz, Mail …): bis zu einer guten Lesebreite, höchstens 1,6-fach (am Finger 2,4-fach) – eine lange Notiz rollt senkrecht.
             · Bilder: ganz ins Bild.
             · Module: ganz ins Bild, aber nie unter ihre Größe auf dem Board, solange sie in die Breite passen.
           Ausnahme Telefon: Dort füllt ein Modul weiter die Schirmbreite (Stylesheet) – zusammengeschoben auf
           390 Punkte wäre ein Kanban nicht zu bedienen. Dokumente behalten ihre eigene Regel (M353/M363). */
        const schmal = breite <= 640;
        const hoechstens = grob ? 2.4 : 1.6;
        const bild = n.type === 'image' || (n.type === 'file' && !dokument && !!el.querySelector('img, video'));
        /* Dokumente: dieselbe Größe auf dem Schirm wie bisher – eine gut lesbare Seitenbreite (um 720 Punkte), die
           ganze Seite nur, wenn sie dafür wenig schrumpfen muss (M353/M363). Früher wurde dazu die KARTE auf 720
           verbreitert; jetzt wird um denselben Faktor `kd` gezoomt, und die Karte bleibt, wie sie ist. */
        const kd = dokument ? Math.max(1, Math.min(breite - 2 * rand, 720) / w) : 1;
        const passtD = Math.min((breite - 2 * rand) / (w * kd), (hoehe - 2 * rand) / (h * kd));
        const inBreiteD = (breite - 2 * rand) / (w * kd);
        const automatisch = dokument
          ? kd * (passtD < 1 && passtD >= 0.75 ? passtD : inBreiteD < 1 ? Math.max(0.3, inBreiteD) : grob ? Math.min(2.2, inBreiteD) : 1)
                : bild ? Math.max(0.2, Math.min(grob ? 4 : 3, passt))
                  // Text: am Finger so breit wie der Schirm; mit der Maus auf eine gute Lesebreite (um 640 Punkte)
                  // M519: am Telefon zählt auch die Kontakt-Karte als Text — sie blieb sonst so klein wie auf dem Board
                  // (Rufnummern zum Antippen in 11 Punkt), weil sie weder hier noch in der Modul-Liste des Stylesheets stand
                  : text || (schmal && n.type === 'kontakt') ? Math.max(0.3, Math.min(hoechstens, inBreite, grob ? hoechstens : Math.max(1.25, 640 / w)))
                    : schmal ? Math.min(1, Math.max(0.3, inBreite))
                      : Math.max(0.3, Math.min(hoechstens, Math.max(passt, Math.min(inBreite, 1))));
        // M424: die gewählte Darstellung (Automatisch = die Regel oben, Einpassen, Seitenbreite, Originalgröße) samt Stufe
        // M426: In „Nur Inhalt" heißt Automatisch: so groß wie möglich (ganze Karte, ganze Seite) – nur Text bleibt
        // bei seiner Lesebreite, eine kurze Notiz würde sonst riesig
        const automatischRein = !rein ? automatisch : dokument ? kd * passtD : text ? automatisch : passt;
        const eingepasst = fokusZoomFuer(fokusAnsicht(), automatischRein, passt, inBreite);
        const zoom = eingepasst;
        fokusRef.current = { id: focusCard, oben, hoehe, rand, breite, fit: eingepasst };
        // Frei gezoomt: nicht zurück auf „eingepasst" springen (Seite blättert, Leiste dockt an) — nur klemmen
        if (nachfahren && fokusFrei.current) {
          requestAnimationFrame(() => { fokusSchieben(0, 0); fokusBalken(); });
          return;
        }
        requestAnimationFrame(() => fokusBalken());
        // M334: Wächst eine Karte, die ohnehin länger als der Schirm ist (Tippen am
        // Ende), bleibt die Kamera, wo der Nutzer sie hingerollt hat — nur klemmen,
        // nicht zurück an den Anfang springen
        if (nachfahren && h * zoom > hoehe - 2 * rand && Math.abs(getViewport().zoom - zoom) < 0.001) {
          fokusScroll(0);
          return;
        }
        document.documentElement.style.setProperty('--fokus-zoom', String(eingepasst));
        document.documentElement.style.setProperty('--fokus-rand', `${2 * rand}px`);
        // M413: der gemerkte Zoom der vorigen Karte – nie kleiner als eingepasst
        const ziel = fokusWunsch.current && fokusWunsch.current > eingepasst * 1.02 ? Math.min(BOARD_ZOOM_MAX, fokusWunsch.current) : eingepasst;
        fokusFrei.current = ziel > eingepasst * 1.02;
        // Waagerecht mittig, sobald die Karte in die Breite passt — sonst bündig links (schwenken)
        const x = (w * ziel <= breite - 2 * rand ? (breite - w * ziel) / 2 : rand) - fx * ziel;
        const frei = hoehe - h * ziel;
        const y = oben + Math.max(rand, frei / 2) - fy * ziel;
        flyingUntil.current = performance.now() + dauer + 180;
        void setViewport({ x, y, zoom: ziel }, { duration: dauer });
        window.dispatchEvent(new CustomEvent(FOKUS_ZOOM_EREIGNIS, { detail: { zoom: ziel } }));
      };
      fokusFrei.current = false;
      fokusEinpassen.current = () => fahren(220);
      // M424: jede Karte beginnt in der gewählten Darstellung (ohne eigene Stufe); ändert man sie, fährt die Kamera neu
      fokusStufeLoesen();
      fokusAnsichtMarkieren();
      const ansichtNeu = () => { fokusFrei.current = false; fokusWunsch.current = null; fahren(220); };
      window.addEventListener(FOKUS_ANSICHT_EREIGNIS, ansichtNeu);
      fahren();
      // M363: Eine neue Seite beginnt oben — auch wenn die vorige bis ans Ende gerollt war
      let seiteZuletzt = seiteVon(focusCard)?.seite;
      const neueSeite = (e: Event) => {
        if ((e as CustomEvent).detail !== focusCard) return;
        const jetzt = seiteVon(focusCard)?.seite;
        if (jetzt == null || jetzt === seiteZuletzt) { seiteZuletzt = jetzt; return; }
        seiteZuletzt = jetzt;
        requestAnimationFrame(() => { const g = fokusGrenzen(); if (g && !g.passt) { const v = getViewport(); void setViewport({ x: v.x, y: g.max, zoom: v.zoom }); fokusSchieben(0, 0); } fokusBalken(); });
      };
      window.addEventListener(SEITEN_EREIGNIS, neueSeite);
      // M363: Telefon gedreht (oder Fenster deutlich schmaler/breiter): neu einpassen. Nur die BREITE zählt —
      // die Bildschirmtastatur ändert die Höhe und soll die Karte nicht hin- und herzoomen.
      let breiteZuletzt = window.innerWidth;
      let drehTimer: ReturnType<typeof setTimeout> | undefined;
      const gedreht = () => {
        if (Math.abs(window.innerWidth - breiteZuletzt) < 24) return;
        breiteZuletzt = window.innerWidth;
        clearTimeout(drehTimer);
        drehTimer = setTimeout(() => { fokusFrei.current = false; fahren(200); }, 180);
      };
      window.addEventListener('resize', gedreht);
      /* M353: Die Leisten unten kommen oft NACH der ersten Kamerafahrt — die Werkzeugleiste dockt erst an, wenn
         über der eingepassten Karte kein Platz mehr ist, die Formatier-Leiste erscheint beim Schreiben. Dann
         lag die Karte unter ihnen. Ändert sich der Platz unten, passt die Kamera neu ein (CSS-:has() meldet
         keine Ereignisse, darum ein leiser Blick alle 200 ms, nur solange der Fokus offen ist). */
      const platzWacht = setInterval(() => {
        if (platzUnten < 0 || performance.now() < flyingUntil.current) return;
        const css = getComputedStyle(document.documentElement);
        const jetzt = fokusUnten(css) + (parseFloat(css.getPropertyValue('--kb')) || 0);
        if (Math.abs(jetzt - platzUnten) > 1) fahren(220, true);
      }, 200);
      // M334: Der Schreib-Cursor bleibt im Bild. Der Browser kann ihn nicht
      // selbst nachscrollen (die Karte liegt in einer Transform-Ebene, nicht in
      // einem Scroller) — also rollt die Kamera nach, sobald die Auswahl unter
      // die Fußleiste oder über die Kopfzeile wandert.
      let cursorTimer: ReturnType<typeof setTimeout> | undefined;
      const cursorFolgen = () => {
        clearTimeout(cursorTimer);
        cursorTimer = setTimeout(() => {
          const f = fokusRef.current;
          const sel = document.getSelection();
          if (!f || !sel || sel.rangeCount === 0 || !sel.isCollapsed || performance.now() < flyingUntil.current) return;
          const knoten = sel.anchorNode;
          const el = (knoten?.nodeType === 1 ? knoten as Element : knoten?.parentElement) ?? null;
          if (!el?.closest('.react-flow__node.pn-focused')) return;
          let r = sel.getRangeAt(0).getBoundingClientRect();
          if (!r.height) { const rs = sel.getRangeAt(0).getClientRects(); if (rs.length) r = rs[0]; else { const b = el.getBoundingClientRect(); if (!b.height) return; r = b; } }
          const pane = document.querySelector('.react-flow') as HTMLElement | null;
          if (!pane) return;
          const top = pane.getBoundingClientRect().top;
          const sichtOben = top + f.oben + 12;
          const sichtUnten = top + f.oben + f.hoehe - 12;
          if (r.bottom > sichtUnten) fokusScroll(r.bottom - sichtUnten + 48);
          else if (r.top < sichtOben) fokusScroll(r.top - sichtOben - 48);
        }, 60);
      };
      document.addEventListener('selectionchange', cursorFolgen);
      return () => { if (raf) cancelAnimationFrame(raf); clearTimeout(timer); clearTimeout(cursorTimer); clearInterval(platzWacht); beobachter?.disconnect(); document.removeEventListener('selectionchange', cursorFolgen); window.removeEventListener(SEITEN_EREIGNIS, neueSeite); window.removeEventListener(FOKUS_ANSICHT_EREIGNIS, ansichtNeu); window.removeEventListener('resize', gedreht); clearTimeout(drehTimer); };
    }
    fokusRef.current = null;
    fokusFrei.current = false;
    fokusWunsch.current = null;
    fokusBalken();
    document.querySelectorAll('.react-flow__node[data-fokus-weg]').forEach((k) => k.removeAttribute('data-fokus-weg'));
    document.documentElement.style.removeProperty('--fokus-zoom');
    document.documentElement.style.removeProperty('--fokus-platz');
    document.documentElement.style.removeProperty('--fokus-rand');
    if (fokusRueckkehr.current) {
      const prev = fokusRueckkehr.current;
      fokusRueckkehr.current = null;
      if (useBoard.getState().pendingFocus?.einpassen) return undefined;
      fokusRueckfahrt.current = prev;
      window.setTimeout(() => { if (fokusRueckfahrt.current === prev) fokusRueckfahrt.current = null; }, 400);
      flyingUntil.current = performance.now() + 500;
      void setViewport(prev, { duration: 300 });
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCard]);

  const onNodeDoubleClick = useCallback((e: React.MouseEvent, node: Node) => {
    // M325: Der Stift ist so präzise wie die Maus — Doppeltipp öffnet den Fokus auch am Tablet
    const stift = (e.nativeEvent as PointerEvent).pointerType === 'pen';
    if (!istMaus() && !stift) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, [contenteditable="true"], .nodrag')) return;
    oeffneFokus(node);
  }, [oeffneFokus]);

  const onNodeClick = useCallback((e: React.MouseEvent, node: Node) => {
    const st0 = useBoard.getState();
    // M212: Am Handy öffnet ein Tipp die Karte formatfüllend. Ziehen löst
    // keinen Klick aus, Verschieben bleibt also unberührt; und wer schon im
    // Fokus ist, tippt in der Karte und soll dort nicht erneut auslösen.
    // M235: … und am PC auf Wunsch genauso (⚙ → Design → „Mit einem Klick
    // öffnen"). Der Preis steht in der Einstellung: Notizen bearbeitet man
    // dann im großen Blatt statt direkt auf dem Board — dieselbe Abmachung
    // wie am Handy. Wer sie nicht will, bleibt beim Doppelklick.
    // M325: Ein STIFT-Tipp ist ein Klick wie mit der Maus (Cursor setzen, Haken,
    // Karte wählen) — nicht der Finger-Tipp, der am Tablet das Blatt öffnet.
    const stift = (e.nativeEvent as PointerEvent).pointerType === 'pen';
    if (e.shiftKey || stift || !(isPhoneFocus() || st0.fokusEinKlick) || !oeffneFokus(node)) return;
    // M519: Traf der öffnende Tipp einen Verweis der verkleinerten Karte (Telefonnummer, E-Mail, Web), ging die Karte auf
    // UND der Wähldialog bzw. die Seite — ein Tipp, zwei Wirkungen. Der Tipp, der öffnet, öffnet nur.
    if ((e.target as HTMLElement).closest?.('a[href]')) e.preventDefault();
    // M521: Doppeltipp — der zweite Tipp kam an, während die Karte schon aufging, und traf, was dann unter dem Finger
    // lag (im Kanban verschob er ein Ticket oder löschte eine Spalte). Eine halbe Sekunde lang gehört kein Tipp dem
    // Inhalt: so lange fährt die Kamera ohnehin noch. Gemessen wird an der Zeit der EREIGNISSE, nicht mit einer Uhr —
    // das Aufgehen der Karte kann den Browser länger beschäftigen, der zweite Tipp wartet dann schon in der Schlange.
    const t0 = e.timeStamp;
    const arten = ['pointerdown', 'pointerup', 'click', 'dblclick'];
    let unten = false;   // der Druck dieses Tipps wurde geschluckt — dann auch sein Loslassen und sein Klick
    const stopp = (ev: Event) => {
      if (ev.type === 'pointerdown') unten = ev.timeStamp - t0 < 500;
      if (!unten) { if (ev.type === 'pointerdown') for (const a of arten) window.removeEventListener(a, stopp, true); return; }
      ev.stopPropagation(); ev.preventDefault();
    };
    for (const a of arten) window.addEventListener(a, stopp, true);
  }, [oeffneFokus]);

  /**
   * M227: Nach dem Fokus die Karte GANZ ins Bild holen.
   *
   * Ohne das landet man nach dem Schließen an der Stelle, an der man das Board
   * verlassen hat — bei einer Karte, die halb außerhalb lag, sucht man sich
   * dumm. Eingepasst wird nur, wenn nötig; wer die Karte ohnehin vor sich hat,
   * wird nicht herumgeworfen.
   */
  useEffect(() => {
    const zurueck = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const st = useBoard.getState();
      const n = selectActiveBoard(st).nodes.find((x) => x.id === id);
      if (!n) return;
      const { x, y, zoom } = getViewport();
      const w = (n.measured?.width ?? n.width ?? 260) * zoom;
      const h = (n.measured?.height ?? n.height ?? 160) * zoom;
      const sx = n.position.x * zoom + x;
      const sy = n.position.y * zoom + y;
      const ganzDrin = sx >= 8 && sy >= 64 && sx + w <= window.innerWidth - 8 && sy + h <= window.innerHeight - 76;
      if (ganzDrin) return;
      // Erst wenn der Fokus-Modus wirklich aus dem DOM ist: Solange die Klasse
      // hängt, steht der Canvas-Transform per !important auf „none" und der
      // Flug von React Flow liefe gegen eine Wand.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        void fitView({ nodes: [{ id }], padding: 0.3, duration: 380, maxZoom: 1.05 * anzRef.current });
      }));
    };
    window.addEventListener('pixinotes:fokus-zurueck', zurueck);
    return () => window.removeEventListener('pixinotes:fokus-zurueck', zurueck);
  }, [fitView, getViewport]);

  // Angefasst = dauerhaft nach vorn: Capture-Listener statt onNodeClick, damit
  // auch Klicks in Editor/nodrag-Bereiche zählen (die erreichen onNodeClick nicht)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.react-flow__node');
      const id = el?.getAttribute('data-id');
      if (id) useBoard.getState().touchNode(id);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);
  useEffect(ablegenGenauAn, []);   // M535: Loslassen ohne letzte Bewegung → Karte trotzdem am Zeiger

  const onNodeDrag = useCallback((ev: MouseEvent | TouchEvent, node: Node) => {
    // Rahmen-Mitzug: seit M542 in onNodesChangeFang (mit dem Versatz nach dem Einrasten, im selben Schub)
    if (node.type === 'frame') return; // Rahmen heben und neigen sich nicht
    ziehSchritt(node, ev);
  }, [ziehSchritt]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      fangSetzen([], true);
      zugSetzen(false);
      if (rasterSelbst.current) { rasterSelbst.current = false; rfStore.setState({ snapToGrid: useBoard.getState().gridSnap }); }
      zoomWrapRef.current?.removeAttribute('data-zug');
      frameDrag.current = null;
      // M542: Rahmen mit Auto-Größe wachsen um das Abgelegte — im selben Rückgängig-Schritt wie der Zug
      if (node.type === 'frame') { rahmenWachsen(); return; }
      // M365: Nichts bewegt (nur gezuckt)? Dann ist es kein Schritt.
      const zug = zugSchritt.current;
      zugSchritt.current = null;
      const still = !!zug && node.position.x === zug.x && node.position.y === zug.y;
      if (zug && still) {
        useBoard.setState((s) => (s.past[s.past.length - 1] === zug.eintrag ? { past: s.past.slice(0, -1) } : {}));
      }
      ziehEnde(); // M481: federnd ablegen, Ausgewichenes übernehmen
      if (!still) rahmenWachsen();
    },
    [ziehEnde, rfStore],
  );

  // ---------- Karten erstellen ----------
  const addNote = useCallback(
    (pos: { x: number; y: number }) => {
      addNode(makeNote(pos));
    },
    [addNode],
  );

  const createNoteAt = useCallback(
    (clientX: number, clientY: number) => {
      /**
       * M268: Der halbe Kartenversatz gehört in BOARD-Punkte, nicht in
       * Bildpunkte. Vorher wurden 130 Bildpunkte abgezogen und erst danach
       * umgerechnet — bei jedem anderen Zoom als 100 % lag die neue Notiz
       * deshalb verschieden weit neben dem Zeiger. Jetzt liegt sie immer
       * gleich, denn 130 ist die halbe Kartenbreite auf dem Board.
       */
      const p = screenToFlowPosition({ x: clientX, y: clientY });
      addNote({ x: p.x - 130, y: p.y - 30 });
      showToast('Notiz erstellt – lostippen! „/" öffnet das Block-Menü');
    },
    [addNote, screenToFlowPosition, showToast],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('react-flow__pane')) return;
      createNoteAt(e.clientX, e.clientY);
    },
    [createNoteAt],
  );

  // Doppel-Tap auf Touch-Geräten (dblclick feuert dort nicht zuverlässig)
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('react-flow__pane')) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const now = performance.now();
      const prev = lastTap.current;
      lastTap.current = { x: touch.clientX, y: touch.clientY, t: now };
      if (prev && now - prev.t < 350 && Math.hypot(touch.clientX - prev.x, touch.clientY - prev.y) < 32) {
        lastTap.current = null;
        createNoteAt(touch.clientX, touch.clientY);
      }
    },
    [createNoteAt],
  );

  // ---------- Drag & Drop von Dateien (E-Mails! Bilder! Alles!) ----------
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      // Kanban-Ticket-Drags (M119) gehören den Spalten — hier ignorieren,
      // sonst würde aus dem Ticket-Text eine Notiz-Karte erzeugt
      if (e.dataTransfer.types.includes('application/x-pixinotes-ticket')) return;
      const basePos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // M478: aus der Eingangs-Liste gezogen — genau dort einsortieren, wo losgelassen wurde
      if (e.dataTransfer.types.includes(EINGANG_ZIEHEN)) {
        eingangZielWeg();
        let gruppen: string[] = [];
        try {
          const roh = JSON.parse(e.dataTransfer.getData(EINGANG_ZIEHEN)) as unknown;
          if (Array.isArray(roh)) gruppen = roh.filter((g): g is string => typeof g === 'string');
        } catch { /* kein gültiger Eintrag */ }
        if (!gruppen.length) return;
        // M488: auf eine Notiz gezogen → in die Notiz (offen: an die Ablagestelle); nachgeladen, nur hier gebraucht
        const karte = (e.target as HTMLElement | null)?.closest?.('.react-flow__node-note') as HTMLElement | null;
        const notizId = karte?.dataset.id;
        if (karte && notizId) {
          const y = e.clientY;
          const { ablageIndex, eingangInNotiz } = await import('../lib/eingangNotiz');
          const blocks = selectActiveBoard(useBoard.getState()).nodes.find((n) => n.id === notizId)?.data.blocks;
          if (eingangInNotiz(gruppen, notizId, ablageIndex(karte, Array.isArray(blocks) ? blocks : [], y))) return;
        }
        eingangHolen(gruppen, undefined, basePos);
        return;
      }
      const files = Array.from(e.dataTransfer.files);

      if (files.length === 0) {
        const text = e.dataTransfer.getData('text/plain');
        if (text) {
          addNode(makeNote(basePos, { blocks: [{ type: 'paragraph', content: text }] }));
          showToast('Text als Notiz abgelegt');
        }
        return;
      }

      // Gemeinsame Import-Pipeline (M159) — dieselbe Weiche bedient auch den
      // „Datei einfügen"-Dialog im ＋-Menü und spiegelt in den Team-Ordner
      await importFilesToBoard(files, basePos);
    },
    [addNode, screenToFlowPosition, showToast],
  );

  // ---------- Strg+V: Screenshots & Bilder direkt aufs Board ----------
  // Globaler Listener statt onPaste am Wrapper: Paste-Events landen beim
  // FOKUSSIERTEN Element — nach einem Klick auf Dock/Canvas liegt der Fokus
  // oft auf <body>, dort kam das React-Event nie an (User-Report).
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      // Nicht eingreifen, wenn in einem Editor/Input eingefügt wird
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.note-editor, input, textarea, [contenteditable="true"]')) return;
      // Offene Overlays (Suche, Einstellungen, Aufgaben, Hilfe, Präsentation) nicht unterlaufen
      const st = useBoard.getState();
      if (st.searchOpen || st.settingsOpen || st.tasksOpen || st.helpOpen || st.presenting) return;
      // M521: … und jedes andere Fenster (Teilen, Versionen, Vorlagen, Ticket): Lag der Fokus dort auf einem Knopf,
      // entstand hinter dem Fenster eine Notiz bzw. ein Bild
      if (overlayOffen()) return;

      const dt = e.clipboardData;
      if (!dt) return;
      // M530: Im Karten-Fokus legte Strg+V eine Notiz bzw. ein Bild HINTER der offenen Karte an (unsichtbar). Jetzt geht
      // es in die offene Karte, wenn sie das kann (Notiz) — sonst ein Hinweis, und nichts passiert (lib/fokusEinfuegen.ts)
      if (st.focusCard && !e.defaultPrevented) {
        e.preventDefault();
        const kopie = new DataTransfer();
        for (const art of ['text/plain', 'text/html']) { const v = dt.getData(art); if (v) kopie.setData(art, v); }
        for (const f of Array.from(dt.files ?? [])) kopie.items.add(f);
        void import('../lib/fokusEinfuegen').then((m) => m.fokusEinfuegen(st.focusCard as string, kopie));
        return;
      }
      // Manche Quellen (Snipping Tool, Explorer-Kopie) liefern nur `files`,
      // andere (Browser-„Bild kopieren") nur `items` — beide abklappern
      let files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) {
        files = Array.from(dt.items ?? [])
          .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
          .map((it) => it.getAsFile())
          .filter((f): f is File => !!f);
      }
      if (files.length === 0) {
        // M323: Text aus der Zwischenablage wird zur Notiz — mitten im Blick,
        // mit Überschriften, Aufzählungen und Haken aus leichtem Markdown
        const text = (dt.getData('text/plain') ?? '').trim();
        if (!text || text.length > 20000) return;
        e.preventDefault();
        const pos = screenToFlowPosition({ x: window.innerWidth / 2 - 135, y: window.innerHeight / 2 - 60 });
        addNode(makeNote(pos, { blocks: textZuBloecken(text) }));
        showToast('Notiz aus der Zwischenablage');
        return;
      }
      e.preventDefault();

      let placed = 0;
      let ausgewichen = 0;
      for (const file of files) {
        try {
          const src = await imageFileToDataUrl(file);
          if (src === null) continue;   // Format nicht dekodierbar (HEIC außerhalb Safari)
          const pos = screenToFlowPosition({
            x: window.innerWidth / 2 - 130 + (placed + ausgewichen) * 34,
            y: window.innerHeight / 2 - 90 + (placed + ausgewichen) * 34,
          });
          if (!canEmbed(src.length)) {
            // M303: nicht verwerfen — als Datei-Karte in die Geräte-Ablage
            // (importFilesToBoard legt sie an und sagt Bescheid)
            ausgewichen += await importFilesToBoard([file], pos);
            continue;
          }
          addNode(makeImage(pos, src, file.name && file.name !== 'image.png' ? file.name : 'Screenshot', await bildMasse(src)));
          placed++;
        } catch (err) {
          console.error('Einfügen fehlgeschlagen:', err);
          showToast('Bild aus der Zwischenablage konnte nicht gelesen werden');
        }
      }
      if (placed > 0) showToast(placed === 1 ? 'Screenshot eingefügt' : `${placed} Bilder eingefügt`);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addNode, screenToFlowPosition, showToast]);

  return (
    <div
      ref={zoomWrapRef}
      data-weit={weit && !focusCard ? '' : undefined}
      data-zieh={ziehBewegung ? '' : undefined}
      className={`board-wrap ${spaceHeld ? 'space-pan' : ''} ${boardBg ? `board-bg-${boardBg}` : ''} ${nurLesen ? 'nur-lesen' : ''}`}
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        // M488: Die Notiz unter einem gezogenen Eingangs-Eintrag leise markieren — dort landet er IN der Notiz
        if (!e.dataTransfer.types.includes(EINGANG_ZIEHEN)) return;
        const karte = (e.target as HTMLElement | null)?.closest?.('.react-flow__node-note');
        if (karte?.hasAttribute('data-eingang-ziel')) return;
        eingangZielWeg();
        karte?.setAttribute('data-eingang-ziel', '');
      }}
      onDoubleClick={handleDoubleClick}
      onTouchEnd={handleTouchEnd}
    >
      <EdgeMarkerDefs />
      {nodes.length === 0 && !nurLesen && (
        <div className="empty-board-hint">
          {/* M397: ein ruhiger Block statt gestrichelter Kästchen – und am Finger
              stehen keine Maus- und Tastatur-Wege */}
          <div className="leer-block">
            <p className="leer-titel">Dieses Board ist leer</p>
            <dl className="leer-wege leer-maus">
              <dt>Doppelklick</dt><dd>Neue Notiz (auch Taste N)</dd>
              <dt>Strg+V</dt><dd>Bild oder Text einfügen</dd>
              <dt>Hineinziehen</dt><dd>Dateien, Bilder, E-Mails</dd>
            </dl>
            <p className="leer-wege leer-finger">Doppeltipp legt eine Notiz an. Alles andere liegt unten im Plus.</p>
            <div className="leer-knoepfe">
              {/* M379: Statt bei null anzufangen — Karten für einen bekannten Anlass hinlegen lassen */}
              <button className="empty-beispiele" data-taste="leer-vorlage"
                title="Besprechung, Rückblick, Projektplan, Brainstorming …"
                onClick={() => window.dispatchEvent(new CustomEvent('pixinotes:vorlagen', { detail: { inBoard: activeId } }))}>
                Mit Vorlage beginnen
              </button>
              {/* M370: Der Start ist leer — wer sehen will, was geht, holt sich die Beispiele mit einem Klick */}
              {nurStart && (
                <button className="empty-beispiele still" onClick={() => useBoard.getState().addStarter()} data-taste="leer-beispiele"
                  title="Fertige Boards zum Ausprobieren – alle Module im Einsatz">
                  Beispiele laden
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <ReactFlow
        key={leinwandKey}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChangeFang}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onBeforeDelete={async ({ nodes: delNodes, edges: delEdges }) => {
          // Entf-Taste: durch removeNodes leiten, damit Undo auch die Kanten kennt (M1)
          if (delNodes.length === 0) return true;
          // M521: … samt der mitgewählten Verbindungen — vorher blieb eine gewählte Verbindung zwischen anderen Karten stehen
          removeNodes(delNodes.map((n) => n.id), delEdges.map((k) => k.id));
          return false;
        }}
        onNodeDragStart={onNodeDragStart}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={42}
        connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 2.5 }}
        panOnScroll={!wheelZoom}
        nodesDraggable={!focusCard && !nurLesen}
        nodesConnectable={!nurLesen}
        snapToGrid={gridSnap}
        snapGrid={[20, 20]}
        zoomOnScroll={wheelZoom}
        panActivationKeyCode="Space"
                // M249: Ausschnitt je Board festhalten — jede Änderung zählt, auch
        // Zoom-Knöpfe und Flüge, nicht nur das Schwenken mit der Maus.
        // (M315: Die Papiertextur ist weg — und mit ihr die Kachel-Variablen,
        // die hier bei jedem Schwenk ins DOM geschrieben wurden.)
        onViewportChange={(vp) => { gemerkteAnsicht.set(activeId, vp); if (!reiseFliegt()) uiMelden(vp.zoom); zoomMelden(vp.zoom); if (fokusRef.current) fokusBalken(vp.y); }}
        // M343: im weiten Zoom gibt es keine „nicht ziehen"-Zonen — die ganze Karte ist der Griff, das Rad gehört dem Board.
        // M527: … außer den Anschlusspunkten: Dort zog der Griff sonst die Karte statt eines Pfeils (der Zug erreichte den
        // Anschluss nie), Verbinden ging unter ~45 % gar nicht.
        noDragClassName={weit && !focusCard ? 'react-flow__handle' : 'nodrag'}
        noWheelClassName={weit && !focusCard ? 'nowheel-aus' : 'nowheel'}
        zoomOnDoubleClick={false}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Meta', 'Shift']}
        minZoom={BOARD_ZOOM_MIN * anzeige}
        maxZoom={BOARD_ZOOM_MAX * anzeige}
        fitView={startEinpassen.current.an}
        fitViewOptions={{ padding: 0.25, maxZoom: anzeige }}
        defaultEdgeOptions={KANTEN_VORGABE}
        // M373: der „React Flow"-Schriftzug unten rechts ist ausgeblendet (Nutzerwunsch); die Bibliothek ist in der Hilfe genannt
        proOptions={PRO_OPTIONEN}
      >
        <AnsichtPortal><Fanglinien /></AnsichtPortal>
        {/* M364: Karten, die gerade ein anderer bearbeitet — Rahmen mit Namen */}
        <AnsichtPortal><LiveSperren /></AnsichtPortal>
        {/* M375: Zeiger der anderen (und der Laser des Vorführenden) — in Board-Koordinaten */}
        {/* M377: Punkte an den Karten */}
        <AnsichtPortal><PunkteMarkenSpaet /></AnsichtPortal>
        <AnsichtPortal><LiveZeigerSpaet /></AnsichtPortal>
        {boardMuster !== 'clean' && <Background {...HINTERGRUND_MUSTER[boardMuster]} />}
        {/* M296: Die Minimap erst, wenn das Board groß genug ist, um sich darin
            zu verlaufen — bei fünf Karten ist sie nur ein grauer Kasten. */}
        {nodes.length >= MINIMAP_AB && (
          <MiniMap
            pannable zoomable className="pn-minimap"
            onClick={(_, pos) => { void setCenter(pos.x, pos.y, { duration: 350, zoom: getViewport().zoom }); }}
          />
        )}
        <AuswahlLeiste />
        <BoardKontextmenue />
        <DrawingLayer />
        <FingerGesten />
        <Kommentare />
      </ReactFlow>
      {/* M514: Rahmen für Rahmen präsentieren — lädt erst mit der ersten Reise */}
      <RahmenReiseHost />
      <div className="fokus-spur" ref={fokusSpurRef} aria-hidden="true">
        <div
          className="fokus-daumen"
          title="Ziehen zum Scrollen"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            const g = fokusGrenzen();
            const spur = fokusSpurRef.current;
            if (!g || !spur) return;
            e.preventDefault(); e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.setAttribute('data-zug', '');
            fokusZug.current = { y: e.clientY, vy: getViewport().y, k: (g.max - g.min) / Math.max(1, spur.clientHeight - e.currentTarget.offsetHeight) };
          }}
          onPointerMove={(e) => {
            const z = fokusZug.current;
            const g = z ? fokusGrenzen() : null;
            if (!z || !g) return;
            const v = getViewport();
            const y = Math.max(g.min, Math.min(g.max, z.vy - ((e.clientY - z.y) / (anzRef.current || 1)) * z.k));
            void setViewport({ x: v.x, y, zoom: v.zoom });
          }}
          onPointerUp={(e) => { fokusZug.current = null; e.currentTarget.removeAttribute('data-zug'); }}
          onPointerCancel={(e) => { fokusZug.current = null; e.currentTarget.removeAttribute('data-zug'); }}
        />
      </div>
    </div>
  );
}


