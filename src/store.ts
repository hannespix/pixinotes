// M217: MUSS vor dem persist-Init stehen — danach ist der Speicher belegt
// und „erster Start" nicht mehr feststellbar
import './lib/firstRun';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { buildStarter } from './lib/starter';
import { KACHEL_TYPEN, uid, type AppNode, type CardFont, type CardSize, type TimeSeg } from './types';
import { anchorStroke, integrateStroke } from './lib/strokeAnchor';
import { drehe, istDrehbar, winkelNorm, winkelVon } from './lib/drehung';
import { istAmText } from './lib/notizText';
import { offeneSeite, seiteVon, strichRelativ } from './lib/pdfSeiten';
import { findFreeSpot, frameMembers, sizeOf } from './lib/arrange';
import { baueRueckverweis } from './lib/portale';
import { t } from './lib/sprache';
import { fristAnkerPflegen, type FristAnker } from './lib/fristAnker';
import { frisch, nachPatch } from './lib/kartenZeit';
import { blocksToText } from './lib/serialize';
import { linksUmbenennen, normalizeName } from './lib/links';

/**
 * M394: „Seite" eines Strichs, der in der Präsentation auf eine Folie gezeichnet wurde und keiner Dokument-Seite
 * gehört (Notiz, Modul, Bild, Tool). Die Punkte sind Tausendstel der Inhaltsbreite der Folie. Eine Seite −1 ist
 * auf dem Board nie offen — dort bleiben diese Striche unsichtbar und unberührt; sie reisen aber mit dem Board.
 */
export const FOLIEN_SEITE = -1;

/** Ein Freihand-Strich (Punkte in Flow-Koordinaten) */
export interface Stroke {
  /** M365: Wer den Strich gezogen hat (Gruppenarbeit) — Kennung wie bei Karten (`data.von`) */
  von?: string;
  id: string;
  tool: 'pen' | 'marker';
  color: string;
  width: number;
  points: [number, number][];
  /** M319: Druck je Punkt (0…1) bei echtem Stift — fehlt bei Maus, Finger und
   *  eingerasteten Formen; dann simuliert die Geschwindigkeit den Druck */
  druck?: number[];
  /** M127: an diese Karte geankert — die Punkte sind dann RELATIV zur
   *  Karten-Ecke und der Strich wandert bei jeder Kartenbewegung mit */
  anchor?: string;
  /** M335: auf dieser SEITE einer PDF-Karte — die Punkte sind dann Seitenpunkte
   *  (PDF-Punkte, Ursprung Seitenecke); sichtbar nur, wenn die Seite offen ist.
   *  FOLIEN_SEITE (−1): auf der Folie der Karte gezeichnet (M394). */
  seite?: number;
  /** M354: `width` ist in Seitenpunkten (wächst mit der Seite). Fehlt bei Seitenstrichen von vor M354 (Board-Punkte). */
  seitenBreite?: boolean;
  /** M356: Textmarker, der auf eine Textzeile eingerastet ist — ein Balken mit geraden Kanten */
  gerade?: boolean;
  /** M339: liegt auf dem TEXT einer Notiz (lib/notizText.ts) — die Punkte sind dann Inhaltspunkte
   *  (Kartenecke bei Scrollstand 0), der Strich scrollt mit dem Text. false = hängt am Kartenrahmen.
   *  Fehlt bei Strichen von vor M339: dann entscheidet die Lage (ganz auf der Karte = am Text). */
  amText?: boolean;
  /** M339: Absatz unter dem Strich und dessen Oberkante beim Zeichnen — rückt der Absatz, rückt der Strich mit */
  block?: string;
  blockY?: number;
}

/** Ebene 3: Ein Board = eine Leinwand voller Karten. */
export interface BoardDoc {
  id: string;
  name: string;
  nodes: AppNode[];
  edges: Edge[];
  drawings?: Stroke[];
  /** Dezente Hintergrund-Tönung (Palette-Schlüssel, M88) — fehlt ⇒ Standard */
  bg?: string;
  /** M330: Das Board gehört einem anderen PixiNotes-Konto (Nutzer-Id des Besitzers) und ist mit mir geteilt */
  geteiltVon?: string;
  /** M330: E-Mail des Besitzers — nur zur Anzeige */
  geteiltVonName?: string;
  /** M360: Der Besitzer hat das Board nur zum Lesen freigegeben — die Oberfläche ändert es nicht,
   *  nur der Abgleich bringt neue Stände (lib/kontoSync.ts) */
  geteiltRolle?: 'lesen';
  /** M364: Per Einladungslink OHNE Konto eingewählt — das Token; den Abgleich macht lib/gastSync.ts */
  gastLink?: string;
  /** M364: Eigene Kopie aus einer beendeten Einwahl per Link — wählt man sich wieder ein, bleibt sie daneben stehen */
  gastWar?: boolean;
  /** Kommentar-Threads (M148) — leben IM Board und wandern so automatisch
   *  im globalen Sync UND im Team-Projekt-Paket mit */
  comments?: CommentThread[];
  /**
   * M288: Board archiviert — dieselbe Bedeutung wie bei einer Karte, nur eine
   * Ebene höher: Es ist erledigt, verschwindet aus Reitern, Navigator und
   * Übersicht und seine Aufgaben ruhen. Gelöscht wird nichts; derselbe
   * Schalter „Archiv einblenden" holt es überall wieder ins Bild.
   */
  archived?: boolean;
}

/** Ein Kommentar-Pin an einer Karte mit seinem Gesprächsverlauf (M148) */
export interface CommentThread {
  id: string;
  nodeId: string;
  /** M335: Pin an einer Stelle auf einer PDF-Seite (Seitennummer + Seitenpunkte) statt an der Kartenecke */
  seite?: number;
  px?: number;
  py?: number;
  resolved?: boolean;
  /** M362: `bearbeitet` = Zeitpunkt der letzten nachträglichen Änderung des Textes (fehlt bei unveränderten Beiträgen) */
  msgs: Array<{ author: string; text: string; at: string; bearbeitet?: string }>;
}

export type Tool = 'select' | 'pen' | 'marker' | 'eraser';

/** Ein Undo-Schritt: kompletter Struktur-Stand eines Boards (Referenzen, kein Deep-Copy —
 *  alle Mutationen laufen immutabel, alte Objekte bleiben gültig). */
interface BoardSnap {
  boardId: string;
  nodes: AppNode[];
  edges: Edge[];
  drawings?: Stroke[];
  /** M388: Gespräche zum Zeitpunkt des Schritts — damit sie mit ihrer Karte zurückkehren (kommentareNach) */
  comments?: CommentThread[];
}

interface HistoryEntry extends BoardSnap {
  /** Notiz-INHALTE haben sich geändert → Undo/Redo muss den Board-Remount
   *  erzwingen, sonst zeigen BlockNote-Editoren (lesen nur beim Mount) alten Text */
  remount?: boolean;
  /** Weitere Boards, die derselbe Schritt verändert hat — Undo/Redo dreht sie
   *  gemeinsam zurück. M163 verschiebt Karten zwischen zwei Boards, M208 setzt
   *  Themen-Tags über eine ganze Themen-Insel hinweg. */
  others?: BoardSnap[];
  /** M365: Stand NACH dem eigenen Schritt — gesetzt, sobald danach etwas von außen kam (Abgleich, Mitlesen).
   *  Dann nimmt Rückgängig nur das zurück, was dieser Schritt selbst getan hat (`gezieltZurueck`), statt den
   *  ganzen Stand zurückzudrehen und damit die Arbeit der anderen zu verwerfen. */
  nach?: { nodes: AppNode[]; edges: Edge[]; drawings?: Stroke[] };
  /** M365: Was andere angefasst haben, während dieser Schritt der jüngste war (er also noch „offen" ist: Ziehen,
   *  Tippen laufen weiter). Diese Stellen gehören nicht zum Schritt und bleiben beim Rückgängig, wie sie sind. */
  fremd?: string[];
  /** … davon die Stellen, die der Schritt selbst schon geändert hatte — sie bleiben, mit Hinweis */
  gemischt?: string[];
}

const VORLAGEN_MAX = 40;

/** M388: Inhalte im Gerätespeicher (große Dateien, Tool-Quelltexte) zu den Karten einer Kopie mitnehmen */
export function anhaengeMitnehmen(nodes: AppNode[], karte: Map<string, string>): void {
  const paare = nodes.filter((n) => n.type === 'file' || n.type === 'htmlapp' || (n.type === 'sheet' && !!(n.data as { datei?: string }).datei)).map((n) => [n.id, karte.get(n.id) as string] as [string, string]);
  if (paare.length) void import('./lib/anhangKopie').then((m) => m.anhaengeKopieren(paare)).catch(() => {});
}

/** Momentaufnahme aller genannten Boards (für mehrbrettrige Undo-Schritte) */
const snapBoards = (boards: BoardDoc[], ids: string[]): BoardSnap[] =>
  ids.flatMap((id) => {
    const b = boards.find((x) => x.id === id);
    return b ? [{ boardId: b.id, nodes: b.nodes, edges: b.edges, drawings: b.drawings, comments: b.comments }] : [];
  });

/**
 * M388: Gespräche bei Rückgängig/Wiederholen. Sie sind kein eigener Schritt (ein Kommentar sichert nichts in den
 * Verlauf) — den alten Stand zurückzulegen, nähme darum Beiträge weg, die seither dazukamen. Stattdessen gehen sie
 * mit ihrer Karte: Verschwindet die Karte durch den Schritt, verschwinden ihre Gespräche; kehrt sie zurück, kehren
 * die Gespräche aus dem gemerkten Stand zurück. (Vorher waren sie nach „Löschen + Strg+Z" für immer weg und nach
 * „Verschieben + Strg+Z" hingen sie verwaist am Ziel-Board.)
 */
function kommentareNach(jetzt: CommentThread[] | undefined, gemerkt: CommentThread[] | undefined, vorher: AppNode[], nachher: AppNode[]): CommentThread[] | undefined {
  if (!jetzt?.length && !gemerkt?.length) return jetzt;
  const bleibt = new Set(nachher.map((n) => n.id));
  const war = new Set(vorher.map((n) => n.id));
  const aus = (jetzt ?? []).filter((c) => !c.nodeId || bleibt.has(c.nodeId));
  const da = new Set(aus.map((c) => c.id));
  let dazu = false;
  for (const c of gemerkt ?? []) {
    if (c.nodeId && bleibt.has(c.nodeId) && !war.has(c.nodeId) && !da.has(c.id)) { aus.push(c); dazu = true; }
  }
  return !dazu && aus.length === (jetzt ?? []).length ? jetzt : aus;
}

const HISTORY_LIMIT = 50;

/** Wiederverwendbare Karten-Vorlage */
export interface CardTemplate {
  id: string;
  name: string;
  node: AppNode;
}

export type AiProvider = 'none' | 'free' | 'openrouter' | 'anthropic' | 'openai' | 'ollama' | 'custom';
export interface AiSettings {
  provider: AiProvider;
  model: string;
  apiKey: string;
  /** Basis-URL für Ollama / selbstgehostete OpenAI-kompatible Server */
  baseUrl: string;
}

/** Ebene 2: Ein Projekt bündelt Boards (geordnete Liste). */
export interface Project {
  id: string;
  name: string;
  boardIds: string[];
  /** M310: Reihenfolge der Boards — fehlt ⇒ manuell (so, wie boardIds steht) */
  sortierung?: BoardSortierung;
}
/** M310: manuell = gezogene Reihenfolge; alphabetisch nach Name; erstellt = Reihenfolge des Anlegens */
export type BoardSortierung = 'manuell' | 'alphabetisch' | 'erstellt';

/**
 * M398: Was beim Löschen eines Projekts oder Bereichs mit den Boards darin geschieht.
 * `behalten`: Die Boards ziehen in das Projekt `ziel` (beim Bereich: seine Projekte in den Bereich `ziel`).
 */
export type EbeneLoeschen = { boards: 'loeschen' } | { boards: 'behalten'; ziel: string };

/** Ebene 1: Ein Bereich bündelt Projekte (z. B. „Arbeit", „Privat", „Team"). */
export interface Space {
  id: string;
  name: string;
  projects: Project[];
}

interface Toast {
  message: string;
  /** true → Toast zeigt einen „Rückgängig"-Knopf, der das zuletzt Gelöschte wiederherstellt;
   *  M388 'schritt' → der Knopf nimmt den letzten Schritt zurück (wie Strg+Z) — für alles, was kein Löschen ist */
  undo?: boolean | 'schritt' | 'ebene';
  /** M332: true → Toast zeigt „Abbrechen" für die laufende KI-Stapelaktion */
  abbruch?: boolean;
}

interface DeletedSnapshot {
  boardId: string;
  nodes: AppNode[];
  edges: Edge[];
  /** An gelöschte Karten geankerte Striche — kommen beim Wiederherstellen mit */
  drawings?: Stroke[];
  /** M388: … und die Gespräche an diesen Karten */
  comments?: CommentThread[];
}

interface BoardState {
  boards: BoardDoc[];
  spaces: Space[];
  activeId: string;
  view: 'overview' | 'board';
  toast: Toast | null;
  /** M431: `markieren: false` — nur hinfahren, die Auswahl bleibt, wie sie ist */
  pendingFocus: { boardId: string; nodeId: string; markieren?: boolean } | null;
  lastDeleted: DeletedSnapshot | null;
  tool: Tool;
  settingsOpen: boolean;
  /** M274: Recherche-Dialog (KI mit echten Quellen) offen? */
  rechercheOpen: boolean;
  setRechercheOpen: (open: boolean) => void;
  presenting: boolean;
  /** M228: Ab welcher Karte die Präsentation startet (nicht persistiert —
   *  das ist eine Absicht für den nächsten Moment, kein Dokumentzustand) */
  presentFrom: string | null;
  setPresentFrom: (id: string | null) => void;
  ai: AiSettings;
  /** M204: Gehirn — semantischer Index (Embeddings) für Suche nach Bedeutung
   *  und „Verwandte Karten". 'auto' folgt der KI-Einstellung. */
  /** M257: `embedModel` ist das Ollama-Modell für die Vektoren — wählbar,
   *  weil je nach Sprache und Rechner ein anderes passt. Leer = Voreinstellung. */
  brain: { on: boolean; provider: 'auto' | 'ollama' | 'browser' | 'cloud'; embedModel?: string };
  /** M220: Bereiche, die NICHT Teil des Gehirns sind (IDs). Ihre Karten
   *  liefern keine Embeddings, tauchen in keiner Bedeutungssuche, keinem
   *  Vorschlag, keiner KI-Antwort und keinem Puls auf — und ihre bereits
   *  berechneten Vektoren werden beim Abschalten aus dem Index gelöscht. */
  brainOffSpaces: string[];
  toggleBrainSpace: (spaceId: string) => void;
  updateBrain: (patch: Partial<BoardState['brain']>) => void;
  /** M205: abgelehnte Verknüpfungs-Vorschläge („a|b", sortiert) — nie wieder zeigen */
  rejectedLinks: string[];
  rejectLink: (a: string, b: string) => void;

  // Navigation
  setView: (view: 'overview' | 'board') => void;
  openBoard: (id: string) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean, section?: string | null) => void;
  /** Wunsch-Reiter beim Öffnen der Einstellungen (z. B. 'sync' vom Status-Chip) */
  settingsSection: string | null;
  /** Aufgaben-Zentrale (✅): eigene Ansicht statt Board */
  tasksOpen: boolean;
  setTasksOpen: (open: boolean) => void;
  /** M202: Teilen-Dialog für ausgewählte Karten (null = zu) — nicht persistiert */
  shareCards: string[] | null;
  setShareCards: (ids: string[] | null) => void;
  /** M212: Karte im Fokus (Handy) — Modul formatfüllend statt im Canvas.
   *  Flüchtig: ein Neustart soll immer aufs Board zurückkehren. */
  focusCard: string | null;
  setFocusCard: (id: string | null) => void;
  /**
   * M285: Woher wurde die Karte geöffnet? — damit das Blatt dorthin zurückkehrt.
   *
   * „überall das gleiche arbeitsfeeling … nicht in jeder Ansicht sich
   * umgewöhnen": Eine Karte wird IMMER im selben Blatt bearbeitet. Wer sie
   * aus der Übersicht öffnet, landet nach dem Schließen wieder dort — sonst
   * wäre jedes Bearbeiten ein Einbahnstraßen-Sprung aufs Board.
   */
  focusHerkunft: 'board' | 'overview' | null;
  /** Eine Karte von überall aus öffnen — derselbe Weg aus jeder Ansicht */
  oeffneKarte: (boardId: string, nodeId: string, herkunft?: 'board' | 'overview') => void;
  /** Fokus-Modus am Handy überhaupt anbieten? (⚙ → Design → Bedienung) */
  cardFocus: boolean;
  setCardFocus: (on: boolean) => void;
  /**
   * M235: Der Handy-Zoom, auf Wunsch auch am großen Bildschirm.
   *
   * Am Handy ist der Tipp die einzige Geste und die Karte füllt das Bild.
   * Am PC gilt beides bewusst NICHT: Ein Klick setzt dort den Cursor in den
   * Text, und das Board bleibt hinter einem Blatt sichtbar. Wer es lieber
   * wie am Handy hat, schaltet es hier ein — beides einzeln, weil es zwei
   * verschiedene Fragen sind (womit öffne ich? wie groß wird es?).
   */
  fokusEinKlick: boolean;
  setFokusEinKlick: (on: boolean) => void;
  fokusVollbild: boolean;
  setFokusVollbild: (on: boolean) => void;
  /**
   * M238: Navigation links statt oben (nur ab Tablet-Breite wirksam).
   *
   * Am großen Schirm ist Platz nach unten reichlich und nach rechts knapp —
   * eine Spalte kann zwanzig Board-Namen untereinander zeigen, wo die Reihe
   * schon bei fünf überläuft. Am Telefon gilt das Gegenteil, dort bleibt es
   * bei der Kopfleiste.
   */
  navLinks: boolean;
  setNavLinks: (on: boolean) => void;
  /** M245: Breite des linken Slideouts (Navigator) in Punkten */
  navBreite: number;
  setNavBreite: (px: number) => void;
  /** M308: Breite der linken Spalte in Punkten — am Griff ziehbar */
  spalteBreite: number;
  setSpalteBreite: (px: number) => void;
  /**
   * M246: Milchglas an oder aus — unabhängig vom Kontrast-Schalter.
   *
   * Bisher steckte das Glas im Schalter „Mehr Kontrast": Wer die Transparenz
   * loswerden wollte, bekam zwangsweise auch kräftigere Ränder, fettere
   * Schrift und keine Papiertextur. Das sind aber zwei verschiedene Fragen —
   * die eine ist Geschmack, die andere Barrierefreiheit. Also getrennt.
   */
  milchglas: boolean;
  /** M269: Wie viele Megabyte Dateiinhalte der Sync-Stand mitnimmt (0 = keine) */
  syncDateienMb: number;
  setSyncDateienMb: (mb: number) => void;
  setMilchglas: (on: boolean) => void;
  /** Karten-Daten auf einem BELIEBIGEN Board ändern (Aufgaben-Zentrale arbeitet boardübergreifend) */
  updateNodeDataOnBoard: (boardId: string, nodeId: string, data: Record<string, unknown>) => void;
  /** M390: Ergebnis von Strg+Z/Strg+Y IM Notiztext übernehmen — ohne neuen Rückgängig-Schritt */
  textRueckgaengig: (id: string, blocks: unknown[]) => void;
  /** M390: Notizen ohne Fristen-Anker bekommen ihn nachgetragen (einmal beim Start) */
  fristAnkerNachtragen: () => void;
  setPresenting: (on: boolean) => void;
  setTool: (tool: Tool) => void;
  updateAi: (patch: Partial<AiSettings>) => void;
  /** Strich übernehmen; sessionIds = Striche derselben Zeichensitzung
   *  (sich berührende entscheiden GEMEINSAM über das Ankern, M128) */
  addStroke: (stroke: Stroke, sessionIds?: string[]) => void;
  eraseStrokesNear: (x: number, y: number, radius: number) => void;
  /** M325: Teil-Radierer — nimmt nur die Punkte im Radius, der Rest bleibt als Teilstücke */
  eraseStrokesPartial: (x: number, y: number, radius: number) => void;
  /** M320: Striche nach Id entfernen (Handschrift wurde zu Text) — ein History-Eintrag */
  removeStrokes: (ids: string[]) => void;
  /**
   * M395: Ein Bild wurde bearbeitet. `patch` sind die neuen Daten der Karte, `verhaeltnis` Höhe/Breite des neuen
   * Bildes (die Karte behält ihre Breite). Mit `neueId` wird die Karte unter einer neuen Kennung fortgeführt —
   * nötig bei Bildern aus der Geräte-Ablage: Deren Inhalt hängt an der Kennung, und nur eine neue reist beim
   * Abgleich als neue Datei mit. Verbindungen, Striche, Kommentare und Ticket-Verweise ziehen mit um.
   * Ein Rückgängig-Schritt.
   */
  bildErsetzen: (id: string, patch: Record<string, unknown>, verhaeltnis: number, neueId?: string) => void;
  /** M394: Einen fertig verankerten Strich anhängen (Folie, Dokument-Seite) — ohne die Anker-Suche des Boards */
  addStrokeFertig: (stroke: Stroke) => void;
  /** M394: Striche nach Id radieren — innerhalb einer Radier-Geste (beginEraseGesture) EIN History-Eintrag */
  eraseStrokesById: (ids: string[]) => void;
  /** Geankerte Striche der Karten wieder freistellen (Punkte werden absolut) */
  detachStrokes: (nodeIds: string[]) => void;
  /** Radier-Geste beginnt: nächster tatsächlicher Lösch-Treffer macht EINEN History-Eintrag */
  beginEraseGesture: () => void;

  // Undo/Redo für Board-Struktur (Karten, Verbindungen, Striche — keine Tipp-Edits)
  past: HistoryEntry[];
  future: HistoryEntry[];
  pushHistory: () => void;
  /** M390: gebündelter Rückgängig-Schritt für eine benannte Änderung (siehe Implementierung) */
  schritt: (key: string) => void;
  /** M390: Karten um (dx, dy) verschieben — Rahmen nehmen ihren Inhalt mit; ein gebündelter Schritt */
  verschiebeUm: (ids: string[], dx: number, dy: number) => void;
  /** EIN Undo-Schritt, der mehrere Boards umfasst (z. B. Themen-Tags einer Insel) */
  pushHistoryBoards: (boardIds: string[]) => void;
  undo: () => void;
  redo: () => void;

  /** Kompletten Stand aus der Sync-Datei übernehmen (ersetzt Boards & Hierarchie).
   *  M311 `sanft`: Zusammenführung im Hintergrund — nur die genannten Boards
   *  weichen ab; Undo-Verlauf und Ansicht bleiben, wo sich nichts geändert hat. */
  importSync: (boards: BoardDoc[], spaces: Space[], activeId: string, sanft?: { geaendert: string[] }) => void;

  /** Team-Sync (M145): EIN Projekt samt Boards aus einem Projekt-Paket übernehmen —
   *  ersetzt nur dieses Projekt, alle anderen Bereiche/Projekte bleiben unberührt */
  importProject: (project: { id: string; name: string }, boards: BoardDoc[]) => void;

  // Trilium-Paket: Board-Verlauf (Revisionen) + Karten-Vorlagen
  templates: CardTemplate[];
  saveTemplate: (node: AppNode, name: string) => void;
  removeTemplate: (id: string) => void;
  /** Zählt Voll-Importe hoch — erzwingt Board-Remount (BlockNote liest nur beim Mount!) */
  importEpoch: number;

  // Hierarchie (Bereiche / Projekte / Boards)
  addSpace: (name?: string) => void;
  renameSpace: (id: string, name: string) => void;
  /** M398: mit `mit` auch, wenn noch Boards darin liegen – sie werden gelöscht oder ziehen um */
  removeSpace: (id: string, mit?: EbeneLoeschen) => void;
  addProject: (spaceId: string, name?: string) => void;
  renameProject: (id: string, name: string) => void;
  removeProject: (id: string, mit?: EbeneLoeschen) => void;
  /** M398: das zuletzt gelöschte Projekt oder den Bereich samt Boards zurückholen */
  ebeneZurueck: () => boolean;
  addBoard: (name?: string, projectId?: string) => string;
  /**
   * M379: Board aus einer Vorlage. Ohne `inBoard` entsteht ein neues Board (im Projekt `projectId`); mit
   * `inBoard` füllt die Vorlage dieses Board, solange es leer ist — rückgängig mit Strg+Z.
   */
  boardAusVorlage: (name: string, inhalt: { nodes: AppNode[]; edges: Edge[] }, wohin?: { projectId?: string; inBoard?: string }) => string;
  /** Fertiges Board (geteilt/importiert) einhängen und öffnen */
  importBoard: (doc: BoardDoc) => void;
  renameBoard: (id: string, name: string) => void;
  /** Hintergrund-Tönung eines Boards setzen (undefined = Standard, M88) */
  setBoardBg: (id: string, bg: string | undefined) => void;
  /** Gitter anzeigen + Karten am Raster einrasten (persistiert, M88) */
  gridSnap: boolean;
  setGridSnap: (on: boolean) => void;
  removeBoard: (id: string) => void;
  /** Board in ein (anderes) Projekt verschieben, optional vor ein bestimmtes Board */
  moveBoard: (boardId: string, targetProjectId: string, beforeBoardId?: string) => void;
  /** M310: Sortierart eines Projekts setzen; „manuell" friert die aktuelle Reihenfolge ein */
  setProjektSortierung: (projectId: string, art: BoardSortierung) => void;
  /**
   * M287: Board mit allem Inhalt kopieren — dieselbe Geste wie „Duplizieren"
   * bei einer Karte, nur eine Ebene höher. Die Kopie landet direkt neben dem
   * Original im selben Projekt und bekommt FRISCHE Karten-Kennungen: Zwei
   * Boards mit denselben Kennungen würden sich beim Verschieben von Karten,
   * bei Pfeilen und beim Sync gegenseitig überschreiben.
   */
  duplicateBoard: (boardId: string) => void;
  /** M287: Projekt samt aller Boards kopieren (auf derselben Ebene) */
  duplicateProject: (projectId: string) => void;
  /**
   * M449: Einen gesicherten Stand (lib/boardVersionen.ts) einsetzen. Ohne `alsKopie` bekommt das Board selbst den
   * Stand — als EIN Rückgängig-Schritt, und weil es eine gewöhnliche Änderung ist, geht sie wie jede andere in den
   * Sync. Mit `alsKopie` (Name) entsteht daneben ein neues Board mit frischen Kennungen. Rückgabe: Board-Id.
   */
  standEinsetzen: (boardId: string, stand: { nodes: AppNode[]; edges: Edge[]; drawings?: Stroke[]; comments?: CommentThread[] }, alsKopie?: string) => string | null;
  /**
   * M288: Board archivieren bzw. zurückholen. Archivieren ist das sanfte
   * Löschen — nichts geht verloren, das Board tritt nur zur Seite. Wer das
   * gerade offene Board archiviert, wird auf ein sichtbares Nachbar-Board
   * gesetzt; sonst stünde man vor einem Board, das es „nicht mehr gibt".
   */
  archiveBoard: (boardId: string, an?: boolean) => void;

  // Karten & Verbindungen (aktives Board)
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  /** Verbindung mit Label direkt anlegen (KI-Vorschläge) */
  addLabeledEdge: (source: string, target: string, label: string, kind?: string) => void;
  /** M148: Kommentar-Panel — offener Thread ('id') bzw. neuer Kommentar ('new:<nodeId>') */
  commentOpen: string | null;
  /** M335: Ort für einen NEUEN Kommentar auf einer PDF-Seite (gesetzt von der Karte, gelesen vom Panel) */
  commentOrt: { seite: number; px: number; py: number } | null;
  setCommentOpen: (id: string | null, ort?: { seite: number; px: number; py: number } | null) => void;
  /** M168: Nachschlage-Panel — null = zu, sonst der vorbefüllte Suchbegriff */
  lookup: string | null;
  setLookup: (q: string | null) => void;
  /** Kommentar anhängen: an bestehenden Thread (threadId) oder neuen an einer Karte eröffnen */
  addCommentMsg: (target: { threadId?: string; nodeId?: string; seite?: number; px?: number; py?: number }, author: string, text: string) => string | null;
  /** M362: Text eines Beitrags nachträglich ändern — der Beitrag ist über Verfasser + Zeitpunkt bestimmt */
  editCommentMsg: (threadId: string, at: string, author: string, text: string) => void;
  /** M362: einen einzelnen Beitrag löschen; der letzte Beitrag nimmt den ganzen Thread mit */
  removeCommentMsg: (threadId: string, at: string, author: string) => void;
  toggleCommentResolved: (threadId: string) => void;
  removeCommentThread: (threadId: string) => void;

  updateEdgeLabel: (id: string, label: string) => void;
  updateEdgeKind: (id: string, kind: string) => void;
  /** M146/M147: feingliedrige Verbindungsoptionen — Spitzen (Ende/Anfang),
   *  Spitzenform, Linienstärke, eigene Farbe */
  updateEdgeStyle: (id: string, patch: {
    head?: boolean; headStart?: boolean; shape?: string; width?: number; color?: string | null;
  }) => void;
  removeEdge: (id: string) => void;
  addNode: (node: AppNode) => void;
  /** M390: Karten des aktiven Boards duplizieren — ein Rückgängig-Schritt, mit Verbindungen und Anhängen; Rückgabe: Anzahl */
  dupliziere: (ids: string[]) => number;
  /** Karte in ein BELIEBIGES Board einfügen (Schnell-Eingabe der Aufgaben-Zentrale, M114) */
  addNodeToBoard: (boardId: string, node: AppNode) => void;
  /**
   * M262: Portale sind gegenseitig — beim Verlinken entsteht auf dem
   * Ziel-Board ein Rückverweis auf das Ausgangs-Board. Beides ist EIN
   * Undo-Schritt; liegt drüben schon ein Portal zurück, bleibt es dabei.
   */
  portalZielSetzen: (nodeId: string, zielBoardId: string) => void;
  /** Portal von Board zu Board neu anlegen (Netz/Übersicht) — mit Rückverweis */
  portalAnlegen: (quellBoardId: string, zielBoardId: string, position?: { x: number; y: number }) => void;
  /** Fehlenden Rückverweis nachtragen (ältere Portale, M262) */
  rueckverweisNachtragen: (quellBoardId: string, zielBoardId: string) => void;
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;
  /** M163: Karten in ein anderes Board verschieben — Rahmen nehmen ihre
   *  Mitglieder mit; interne Verbindungen, Kommentar-Pins und geankerte
   *  Zeichnungen wandern mit; EIN Undo-Schritt stellt beide Boards her */
  moveNodesToBoard: (ids: string[], targetBoardId: string) => void;
  restoreDeleted: () => void;
  /** Zuletzt angefasste Karte dauerhaft nach vorn (persistierter zIndex, ohne Undo-Eintrag) */
  touchNode: (id: string) => void;
  /**
   * M224: Barrierefreiheit — die ganze Oberfläche größer, lesbarer, kontrastreicher.
   *
   * `anzeige` skaliert ALLES (Schrift, Knöpfe, Abstände, Karteninhalte) wie
   * der Browser-Zoom, nur ohne dass man ihn im Browser suchen muss und über
   * Neustarts hinweg gemerkt. Bewusst kein reiner Schriftgrad: Wer die Schrift
   * kaum lesen kann, trifft auch die Knöpfe schlechter.
   */
  anzeige: number;
  setAnzeige: (z: number) => void;
  /** Durchgehend die für Sehschwäche entworfene Schrift (Atkinson Hyperlegible) */
  lesbareSchrift: boolean;
  setLesbareSchrift: (on: boolean) => void;
  /** Höherer Kontrast: kräftigere Schrift und Ränder, kein Milchglas, keine Textur */
  hoherKontrast: boolean;
  setHoherKontrast: (on: boolean) => void;
  /** Klick-Zoom: beim Anklicken sanft zur Karte fliegen (wenn klein/außerhalb) */
  clickZoom: boolean;
  setClickZoom: (on: boolean) => void;
  /** Mausrad zoomt statt zu scrollen (Miro-Stil) */
  wheelZoom: boolean;
  /** M320: Handschrift online erkennen lassen (Google Input Tools) — Opt-in, Striche verlassen das Gerät */
  handschriftOnline: boolean;
  setHandschriftOnline: (on: boolean) => void;
  /** M326: Finger-Gesten nach Procreate (Zwei-Finger-Tipp = Rückgängig …) */
  fingerGesten: boolean;
  setFingerGesten: (on: boolean) => void;
  /** M324: Nach einer Schreibpause den erkannten Text als Vorschlag anbieten */
  handschriftAuto: boolean;
  setHandschriftAuto: (on: boolean) => void;
  /** M324: Eine eingerichtete KI verbessert die Erkennung mit dem Kontext der Notiz */
  handschriftKi: boolean;
  setHandschriftKi: (on: boolean) => void;
  setWheelZoom: (on: boolean) => void;
  /** M193: Übersicht — Hierarchie oder Netz. Liegt im Store, damit der
   *  Navigator (und damit JEDE Ansicht) direkt ins Netz springen kann. */
  overviewMode: 'hierarchie' | 'netz';
  setOverviewMode: (m: 'hierarchie' | 'netz') => void;
  /** M193: Welche Ebenen das Netz zeigt — bleibt erhalten, statt bei jedem
   *  Öffnen auf „Karten aus" zurückzufallen (User-Wunsch). */
  graphLayers: { cards: boolean; portals: boolean; wikis: boolean; projectOnly: boolean; physik?: boolean; vorschlaege?: boolean; regionen?: boolean };
  setGraphLayer: (key: 'cards' | 'portals' | 'wikis' | 'projectOnly' | 'physik' | 'vorschlaege' | 'regionen', on: boolean) => void;
  /** M194: Ausfahrbare Seitenleiste — der Überblick bleibt neben der Arbeit
   *  stehen, statt sie zu verdrängen. Zustand komplett persistent. */
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  /** Kartengröße setzen (Auto-Größe der Diagramm-Karte, M92c) */
  resizeNode: (id: string, width: number, height: number) => void;
  /** Nur die Höhe setzen — für die Auto-Größe aller Karten (M103) */
  setNodeHeight: (id: string, height: number) => void;
  /** Auto-Größe je Karte an/aus (M103; seit M111 Standard AN — false = manuell gebrochen) */
  setAutoFit: (ids: string[], on: boolean) => void;
  /** M400: Karten schräg legen (Grad im Uhrzeigersinn, 0 = gerade) – Striche auf der Karte drehen sich mit */
  setWinkel: (entries: Array<[string, number]>) => void;
  /** M339: Vor dem Verkleinern einer Notiz festschreiben, welche älteren Striche zum Text gehören */
  textStricheFestschreiben: (nodeId: string) => void;
  /** M298: Große Module als Kachel zusammenklappen (on) oder wieder ausklappen */
  setKachel: (ids: string[], on: boolean) => void;
  /** M200: Schrift/Textgröße pro Karte — null setzt auf Standard zurück */
  setCardTypo: (ids: string[], patch: { font?: CardFont | null; fontSize?: CardSize | null }) => void;
  setNodePosition: (id: string, x: number, y: number) => void;
  /** Mehrere Positionen in EINEM Store-Update — für den Physik-Loop (60 fps) */
  setNodePositions: (entries: Array<[string, number, number]>) => void;
  focusNode: (boardId: string, nodeId: string, opt?: { markieren?: boolean }) => void;
  clearPendingFocus: () => void;

  showToast: (message: string, undo?: boolean | 'schritt' | 'ebene', durationMs?: number, abbruch?: boolean) => void;
  /** M390: Der Knopf „Rückgängig" im Hinweis */
  hinweisRueckgaengig: () => void;

  /** Globale KI-Sperre: verhindert parallele KI-Aktionen aus Dock UND Auswahl-Leiste */
  aiBusy: boolean;
  setAiBusy: (busy: boolean) => void;

  /** Starter-Umgebung „Verwaltung" zusätzlich anlegen (für Bestandsnutzer) */
  addStarter: () => void;
  /** M184: Ganze Struktur (Bereiche + Boards) in einem Rutsch einhängen —
   *  für den OneNote-Import. Merkt sich den Stand davor für „Import zurücknehmen". */
  importStructure: (payload: { spaces: Space[]; boards: BoardDoc[]; activeId?: string }) => void;
  /** Den letzten Struktur-Import wieder entfernen (Strg+Z kann das nicht) */
  undoImport: () => boolean;
  /** Liegt ein zurücknehmbarer Import vor? */
  canUndoImport: boolean;
  /** ALLES leeren: ein frisches leeres Board, Hierarchie/Versionen/Vorlagen zurückgesetzt */
  resetAll: () => void;

  /** Hilfe-Seite (❓ im Dock); section springt direkt zu einem Abschnitt (z. B. 'impressum') */
  helpOpen: boolean;
  helpSection: string | null;
  setHelpOpen: (open: boolean, section?: string | null) => void;
  /** M300: Bild-Export des aktuellen Boards — ein Fenster aus dem Dock (⋯) */
  bildExportOpen: boolean;
  setBildExportOpen: (open: boolean) => void;

  /** Physik (Verdrängung/Wurf) global an/aus — aus = Karten dürfen überlappen/stapeln.
   *  M294: Voreinstellung AUS — die ruhige Fläche ist der Normalfall, die
   *  Physik bleibt als Option (Dock → ⋯ oder ⚙ → Bedienung). */
  physicsEnabled: boolean;
  setPhysicsEnabled: (on: boolean) => void;
  /** M294: Konfetti beim Erledigen — bewusst eine Option, keine Voreinstellung */
  konfetti: boolean;
  setKonfetti: (on: boolean) => void;
  /** M434: Weicher Schatten unter Pfeilen — an; ⚙ → Darstellung schaltet ihn ab */
  pfeilSchatten: boolean;
  setPfeilSchatten: (on: boolean) => void;
  /** M294: Einmaliger Hinweis nach der Umstellung auf die ruhigen
   *  Voreinstellungen (gesetzt von lib/einstellungen.ts, nicht persistiert) */
  ruheHinweis: boolean;
  setRuheHinweis: (on: boolean) => void;
  /** M254: Stift (Apple Pencil & Co.) zeichnet sofort — ohne Zeichenmodus */
  stiftZeichnet: boolean;
  setStiftZeichnet: (on: boolean) => void;

  /** Archiv (M87): ganze Karten als erledigt ablegen bzw. zurückholen (undo-fähig) */
  setArchived: (ids: string[], archived: boolean) => void;
  /** Archivierte Karten sichtbar (gedimmt) statt ausgeblendet — persistiert */
  showArchived: boolean;
  setShowArchived: (on: boolean) => void;

  /** Design: Hell/Dunkel/System + Akzentfarbe (persistiert) */
  ui: { theme: 'system' | 'light' | 'dark'; accent: string };
  setUiTheme: (theme: 'system' | 'light' | 'dark') => void;
  setUiAccent: (accent: string) => void;
}

export const selectActiveBoard = (s: BoardState): BoardDoc =>
  s.boards.find((b) => b.id === s.activeId) ?? s.boards[0];
/** M360: Das offene Board ist nur zum Lesen geteilt */
export const selectNurLesen = (s: BoardState): boolean => selectActiveBoard(s)?.geteiltRolle === 'lesen';
export const useNurLesen = (): boolean => useBoard(selectNurLesen);
/** M365: wie useNurLesen, aber für EINE Karte — auch fest, wenn Gäste hier nur Eigenes ändern dürfen */
export function useKarteFest(von: string | undefined): boolean {
  const nurLesen = useBoard(selectNurLesen);
  const boardId = useBoard((s) => s.activeId);
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(GRUPPE_EREIGNIS, auf);
    return () => window.removeEventListener(GRUPPE_EREIGNIS, auf);
  }, []);
  return nurLesen || karteFest(boardId, von);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

// ---------- M360: Leseschutz für nur lesend geteilte Boards ----------
// Ein Board mit geteiltRolle 'lesen' gehört einem anderen Konto und darf hier
// nicht verändert werden: Der Server nähme die Änderung ohnehin nicht an, und
// lokal stünde dann ein Stand, den es nirgends sonst gibt. Der Schutz sitzt an
// EINER Stelle — am set() des Speichers —, damit keine der vielen Karten-Arten
// und Werkzeuge vergessen wird. Auswahl und gemessene Größen (Ansicht, kein
// Inhalt) gehen durch; der Abgleich schreibt über ohneLeseschutz().
let leseschutzAus = 0;
export function ohneLeseschutz<T>(fn: () => T): T {
  leseschutzAus += 1;
  try { return fn(); } finally { leseschutzAus -= 1; }
}
/** Zeitpunkt der letzten Eingabe — nur dann lohnt der Hinweis (nicht bei stillen Selbst-Korrekturen der Karten) */
let letzteEingabe = 0;
if (typeof window !== 'undefined') {
  const merken = () => { letzteEingabe = performance.now(); };
  for (const ev of ['pointerdown', 'pointerup', 'keydown', 'drop', 'paste'] as const) window.addEventListener(ev, merken, true);
}
let leseHinweisAm = 0;
export const LESE_HINWEIS = 'Dieses Board ist nur zum Lesen freigegeben. Für eigene Änderungen: oben „Eigene Kopie anlegen".';
function leseHinweis(): void {
  const jetzt = performance.now();
  if (jetzt - letzteEingabe > 1500 || jetzt - leseHinweisAm < 4000) return;
  leseHinweisAm = jetzt;
  queueMicrotask(() => useBoard.getState().showToast(LESE_HINWEIS, false, 5000));
}
const ANSICHT_FELDER = new Set(['selected', 'measured', 'dragging', 'resizing']);
/** Felder, deren verworfene Änderung einen Hinweis wert ist — also das, was ein Mensch bewusst tut (schreiben,
 *  schieben, archivieren, verbinden). Stilles Beiwerk fällt ohne Meldung weg: Ein Klick hebt die Karte nach vorn
 *  (zIndex), eine Notiz misst ihre Höhe nach — das ist keine Bearbeitung. */
const MELDE_FELDER = ['data', 'position', 'archived', 'parentId', 'type', 'source', 'target', 'label'];
function inhaltAnders(a: object, b: object): boolean {
  const x = a as Record<string, unknown>; const y = b as Record<string, unknown>;
  return MELDE_FELDER.some((k) => x[k] !== y[k]);
}
/** Vom neuen Stand nur die Ansicht (Auswahl, Maße) übernehmen; meldet, ob Inhalt verworfen wurde */
function nurAnsicht(alt: BoardDoc, neu: BoardDoc): { board: BoardDoc; verworfen: boolean } {
  let verworfen = neu.name !== alt.name || neu.bg !== alt.bg || neu.archived !== alt.archived
    || neu.drawings !== alt.drawings || neu.comments !== alt.comments
    || neu.nodes.length !== alt.nodes.length || neu.edges.length !== alt.edges.length;
  const ansicht = <T extends { id: string }>(liste: T[], neue: T[]): T[] => {
    const nach = new Map(neue.map((n) => [n.id, n]));
    let anders = false;
    const aus = liste.map((n) => {
      const m = nach.get(n.id);
      if (!m) { verworfen = true; return n; }
      if (m === n) return n;
      if (inhaltAnders(n, m)) verworfen = true;
      const a = n as Record<string, unknown>; const b = m as Record<string, unknown>;
      if ([...ANSICHT_FELDER].every((k) => a[k] === b[k])) return n;
      anders = true;
      const kopie: Record<string, unknown> = { ...a };
      for (const k of ANSICHT_FELDER) { if (b[k] === undefined) delete kopie[k]; else kopie[k] = b[k]; }
      return kopie as T;
    });
    return anders ? aus : liste;
  };
  const nodes = ansicht(alt.nodes, neu.nodes);
  const edges = ansicht(alt.edges, neu.edges);
  return { board: nodes === alt.nodes && edges === alt.edges ? alt : { ...alt, nodes, edges }, verworfen };
}
// ---------- M364: Karten-Sperre in der Gruppenarbeit ----------
// Wer eine Karte gerade bearbeitet (hineintippt, sie zieht), hat sie: Die anderen sehen ihren Stand live, ändern
// sie aber nicht — so überschreibt niemand, was ein anderer gerade schreibt. Wer was hält, kommt aus dem
// Live-Kanal (lib/gastSync.ts); hier wird nur durchgesetzt, wieder an der einen Stelle, am set() des Speichers.
/**
 * M388: Was auf die Platte geht, ist der GESICHERTE Stand. Liest man mit, während jemand anderes schreibt, steht
 * dessen Zwischenstand hier im Board (aus dem Live-Kanal, nur Anzeige). Wurde er mitgespeichert, hielt das Gerät
 * ihn nach einem Neuladen für eine eigene Änderung und schrieb ihn zum Server — den halben Satz eines anderen,
 * oder was immer jemand in den Kanal gelegt hatte. lib/gastSync.ts hängt hier ein, wie ein Board ohne
 * Mitgelesenes aussieht.
 */
export const persistHaken: { board: (b: BoardDoc) => BoardDoc } = { board: (b) => b };
/**
 * M449: Vor Vorgängen, die viel auf einmal umbauen (Abgleich mit Ordner/Konto, Import eines Projekts), den Stand der
 * betroffenen Boards sichern. lib/boardVersionen.ts hängt sich hier ein — der Store selbst kennt IndexedDB nicht.
 */
export const vorUmbauHaken: { sichern: (boards: BoardDoc[], grund: 'abgleich' | 'import') => void } = { sichern: () => {} };
const kartenSperren = new Map<string, Map<string, string>>();   // Board → Karte → Name dessen, der sie hält
export function setzeKartenSperren(boardId: string, sperren: Map<string, string>): void {
  if (sperren.size) kartenSperren.set(boardId, sperren); else kartenSperren.delete(boardId);
}
let sperrHinweisAm = 0;
function sperrHinweis(name: string): void {
  const jetzt = performance.now();
  if (jetzt - letzteEingabe > 1500 || jetzt - sperrHinweisAm < 4000) return;
  sperrHinweisAm = jetzt;
  queueMicrotask(() => useBoard.getState().showToast(`${name} bearbeitet diese Karte gerade – gleich wieder frei.`, false, 4000));
}
/** Gesperrte Karten behalten Inhalt und Lage (auch gegen Löschen); alles andere geht durch */
function sperrschutz(alt: BoardDoc, neu: BoardDoc, sperren: Map<string, string>): BoardDoc {
  const nach = new Map(neu.nodes.map((n) => [n.id, n]));
  let wer = '';
  let anders = false;
  const fehlend: AppNode[] = [];
  const zurueck = new Map<string, AppNode>();
  for (const n of alt.nodes) {
    const name = sperren.get(n.id);
    if (!name) continue;
    const m = nach.get(n.id);
    if (!m) { fehlend.push(n); wer = name; anders = true; continue; }
    if (m !== n && inhaltAnders(n, m)) {
      // Auswahl und Maße dürfen sich ändern — Inhalt und Lage nicht
      const a = n as Record<string, unknown>; const b = m as Record<string, unknown>;
      const kopie: Record<string, unknown> = { ...a };
      for (const k of ANSICHT_FELDER) { if (b[k] === undefined) delete kopie[k]; else kopie[k] = b[k]; }
      zurueck.set(n.id, kopie as AppNode); wer = name; anders = true;
    }
  }
  if (!anders) return neu;
  sperrHinweis(wer);
  if (fehlend.length === 0) return { ...neu, nodes: neu.nodes.map((n) => zurueck.get(n.id) ?? n) };
  // Eine gesperrte Karte sollte gelöscht werden: Sie bleibt an ihrem Platz in der Reihe, mit ihren Verbindungen
  const bleibt = new Set(fehlend.map((n) => n.id));
  const nodes: AppNode[] = [];
  const drin = new Set<string>();
  for (const n of alt.nodes) {
    const m = bleibt.has(n.id) ? n : zurueck.get(n.id) ?? nach.get(n.id);
    if (m) { nodes.push(m); drin.add(n.id); }
  }
  for (const n of neu.nodes) if (!drin.has(n.id)) nodes.push(n);
  const kanten = new Set(neu.edges.map((e) => e.id));
  const edges = [...neu.edges, ...alt.edges.filter((e) => !kanten.has(e.id) && (bleibt.has(e.source) || bleibt.has(e.target)) && drin.has(e.source) && drin.has(e.target))];
  return { ...neu, nodes, edges: edges.length === neu.edges.length ? neu.edges : edges };
}

// ---------- M365: Wer hat was angelegt — und was dürfen Gäste? ----------
// In einem geteilten Board trägt jede NEUE Karte und jeder neue Strich die Kennung dessen, der sie angelegt hat
// (`data.von` bzw. `von`). Der Besitzer legt am Einladungslink fest, was Gäste dürfen:
//   alles             – wie bisher
//   eigenes-loeschen  – alles bearbeiten, aber nur Eigenes löschen (oder archivieren)
//   eigenes           – nur Eigenes bearbeiten, verschieben und löschen; alles andere steht fest
// Durchgesetzt wird es hier, am set() — für jede Bedienung auf einmal. Für Gäste ohne Konto prüft zusätzlich der
// Server (gast_schreiben). Was vor der Gruppenarbeit da war, trägt keine Kennung und gehört damit dem Besitzer.
export type GastRecht = 'alles' | 'eigenes-loeschen' | 'eigenes';
export interface GruppenInfo { ich: string; recht: GastRecht; gast: boolean }
const gruppen = new Map<string, GruppenInfo>();
export const GRUPPE_EREIGNIS = 'pixinotes:gruppe';
export function setzeGruppe(boardId: string, info: GruppenInfo | null): void {
  const alt = gruppen.get(boardId);
  if (info) gruppen.set(boardId, info); else gruppen.delete(boardId);
  if (alt?.recht !== info?.recht || alt?.gast !== info?.gast || alt?.ich !== info?.ich) window.dispatchEvent(new CustomEvent(GRUPPE_EREIGNIS, { detail: boardId }));
}
/** Steht diese Karte für mich fest? (Gast, Recht „eigenes", Karte von jemand anderem) — dann nimmt ihr Editor nichts an */
export const karteFest = (boardId: string, von: string | undefined): boolean => {
  const g = gruppen.get(boardId);
  return !!g && g.gast && g.recht === 'eigenes' && von !== g.ich;
};
export const gruppeVon = (boardId: string): GruppenInfo | undefined => gruppen.get(boardId);
const vonKarte = (n: AppNode): string | undefined => (n.data as { von?: string } | undefined)?.von;
const vonKante = (e: Edge): string | undefined => (e.data as { von?: string } | undefined)?.von;
/** Während Rückgängig/Wiederholen behält Zurückgeholtes seinen Ersteller */
let stempelAus = 0;
function ohneStempel(fn: () => void): void {
  stempelAus += 1;
  try { fn(); } finally { stempelAus -= 1; }
}
let rechtHinweisAm = 0;
function rechtHinweis(text: string): void {
  const jetzt = performance.now();
  if (jetzt - letzteEingabe > 1500 || jetzt - rechtHinweisAm < 4000) return;
  rechtHinweisAm = jetzt;
  queueMicrotask(() => useBoard.getState().showToast(text, false, 5000));
}
/** Karten, die bleiben müssen, an ihrem Platz in der Reihe halten — mit ihren Verbindungen */
function mitBleibenden(alt: BoardDoc, neu: BoardDoc, bleibt: Set<string>, zurueck: Map<string, AppNode>): BoardDoc {
  if (bleibt.size === 0) return zurueck.size ? { ...neu, nodes: neu.nodes.map((n) => zurueck.get(n.id) ?? n) } : neu;
  const nach = new Map(neu.nodes.map((n) => [n.id, n]));
  const nodes: AppNode[] = [];
  const drin = new Set<string>();
  for (const n of alt.nodes) {
    const m = bleibt.has(n.id) ? n : zurueck.get(n.id) ?? nach.get(n.id);
    if (m) { nodes.push(m); drin.add(n.id); }
  }
  for (const n of neu.nodes) if (!drin.has(n.id)) nodes.push(n);
  const kanten = new Set(neu.edges.map((e) => e.id));
  const edges = [...neu.edges, ...alt.edges.filter((e) => !kanten.has(e.id) && (bleibt.has(e.source) || bleibt.has(e.target)) && drin.has(e.source) && drin.has(e.target))];
  return { ...neu, nodes, edges: edges.length === neu.edges.length ? neu.edges : edges };
}
function gruppenschutz(alt: BoardDoc, neu0: BoardDoc, g: GruppenInfo): BoardDoc {
  let neu = neu0;
  // 1) Neues gehört dem, der es anlegt (auch eine Kopie einer fremden Karte)
  if (neu.nodes !== alt.nodes) {
    const vorher = new Set(alt.nodes.map((n) => n.id));
    const mein = (n: AppNode): boolean => !vorher.has(n.id) && (stempelAus > 0 ? !vonKarte(n) : vonKarte(n) !== g.ich);
    if (neu.nodes.some(mein)) neu = { ...neu, nodes: neu.nodes.map((n) => (mein(n) ? ({ ...n, data: { ...n.data, von: g.ich } } as AppNode) : n)) };
  }
  if (neu.drawings && neu.drawings !== alt.drawings) {
    const vorher = new Set((alt.drawings ?? []).map((d) => d.id));
    const mein = (d: Stroke): boolean => !vorher.has(d.id) && (stempelAus > 0 ? !d.von : d.von !== g.ich);
    if (neu.drawings.some(mein)) neu = { ...neu, drawings: neu.drawings.map((d) => (mein(d) ? { ...d, von: g.ich } : d)) };
  }
  // M391: Auch eine Verbindung trägt, wer sie gezogen hat — sonst ließe sich „nur Eigenes" an Pfeilen nicht halten
  if (neu.edges !== alt.edges) {
    const vorher = new Set(alt.edges.map((e) => e.id));
    const mein = (e: Edge): boolean => !vorher.has(e.id) && (stempelAus > 0 ? !vonKante(e) : vonKante(e) !== g.ich);
    if (neu.edges.some(mein)) neu = { ...neu, edges: neu.edges.map((e) => (mein(e) ? { ...e, data: { ...(e.data ?? {}), von: g.ich } } : e)) };
  }
  if (!g.gast || g.recht === 'alles') return neu;
  // 2) Fremdes bleibt: nicht löschen, nicht archivieren — bei „eigenes" auch nicht ändern
  let geloescht = false; let geaendert = false; let kanteFest = false;
  if (neu.nodes !== alt.nodes) {
    const nach = new Map(neu.nodes.map((n) => [n.id, n]));
    const bleibt = new Set<string>();
    const zurueck = new Map<string, AppNode>();
    for (const n of alt.nodes) {
      if (vonKarte(n) === g.ich) continue;
      const m = nach.get(n.id);
      if (!m) { bleibt.add(n.id); geloescht = true; continue; }
      if (m === n) continue;
      const a = n as Record<string, unknown>; const b = m as Record<string, unknown>;
      if (g.recht === 'eigenes') {
        if (!inhaltAnders(n, m)) continue;
        const kopie: Record<string, unknown> = { ...a };
        for (const k of ANSICHT_FELDER) { if (b[k] === undefined) delete kopie[k]; else kopie[k] = b[k]; }
        zurueck.set(n.id, kopie as AppNode); geaendert = true;
      } else if (b.archived && !a.archived) {
        const kopie: Record<string, unknown> = { ...b };
        delete kopie.archived;
        zurueck.set(n.id, kopie as AppNode); geloescht = true;
      }
    }
    if (bleibt.size || zurueck.size) neu = mitBleibenden(alt, neu, bleibt, zurueck);
  }
  if (alt.drawings && neu.drawings !== alt.drawings) {
    const da = new Set((neu.drawings ?? []).map((d) => d.id));
    const fehlt = alt.drawings.filter((d) => !da.has(d.id) && d.von !== g.ich);
    if (fehlt.length) { neu = { ...neu, drawings: [...(neu.drawings ?? []), ...fehlt] }; geloescht = true; }
  }
  // M391: Fremde Verbindungen bleiben, solange ihre beiden Karten bleiben (mit einer gelöschten Karte gehen ihre
  // Pfeile wie immer mit) — bei „eigenes" bleiben sie auch, wie sie sind. Vorher ließen sich die Pfeile des
  // Besitzers löschen und umbeschriften, obwohl er „nur Eigenes" festgelegt hatte.
  if (neu.edges !== alt.edges) {
    const karten = new Set(neu.nodes.map((n) => n.id));
    const nach = new Map(neu.edges.map((e) => [e.id, e]));
    const zurueck: Edge[] = [];
    const ersetzt = new Map<string, Edge>();
    for (const e of alt.edges) {
      if (vonKante(e) === g.ich || !karten.has(e.source) || !karten.has(e.target)) continue;
      const m = nach.get(e.id);
      if (!m) { zurueck.push(e); geloescht = true; continue; }
      if (g.recht === 'eigenes' && m !== e && (m.source !== e.source || m.target !== e.target || JSON.stringify(m.data ?? null) !== JSON.stringify(e.data ?? null))) {
        ersetzt.set(e.id, { ...m, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, data: e.data });
        kanteFest = true;
      }
    }
    if (zurueck.length || ersetzt.size) neu = { ...neu, edges: [...neu.edges.map((e) => ersetzt.get(e.id) ?? e), ...zurueck] };
  }
  if (geloescht) rechtHinweis('Löschen kannst du hier nur, was du selbst angelegt hast.');
  else if (geaendert) rechtHinweis('Ändern kannst du hier nur deine eigenen Karten – neue anlegen geht immer.');
  else if (kanteFest) rechtHinweis('Diese Verbindung hat jemand anderes gezogen – ändern kannst du hier nur Eigenes.');
  return neu;
}

// ---------- M365: Rückgängig in der Gruppe — nur der eigene Schritt ----------
type Stand = { nodes: AppNode[]; edges: Edge[]; drawings?: Stroke[] };
const FLUECHTIG = new Set(['selected', 'dragging', 'resizing', 'measured']);
const ohneFluechtiges = (x: object): string => JSON.stringify(x, (k, v) => (FLUECHTIG.has(k) ? undefined : v));
const gleichesObjekt = (a: object, b: object): boolean => a === b || ohneFluechtiges(a) === ohneFluechtiges(b);
/**
 * Einen eigenen Schritt gezielt umkehren. Der Schritt hat das Board von `zu` nach `von` gebracht; jetzt soll alles,
 * was er anfasste, wieder wie in `zu` sein — aber nur dort, wo es noch so ist, wie der Schritt es hinterließ.
 * Was andere inzwischen geändert haben, bleibt (und wird gezählt); was andere neu angelegt haben, sowieso.
 */
function gezieltZurueck(jetzt: Stand, von: Stand, zu: Stand, fremd?: Set<string>, gemischt?: Set<string>): { stand: Stand; getan: number; uebersprungen: number } {
  let getan = 0; let uebersprungen = gemischt?.size ?? 0;
  const liste = <T extends { id: string }>(cur: T[], vonL: T[], zuL: T[]): T[] => {
    if (vonL === zuL) return cur;
    const V = new Map(vonL.map((x) => [x.id, x]));
    const Z = new Map(zuL.map((x) => [x.id, x]));
    const C = new Map(cur.map((x) => [x.id, x]));
    const ersetzt = new Map<string, T>();
    const weg = new Set<string>();
    const dazu: T[] = [];
    for (const id of new Set([...V.keys(), ...Z.keys()])) {
      if (fremd?.has(id)) continue;   // hat (auch) jemand anderes angefasst — gehört nicht zu diesem Schritt
      const v = V.get(id); const z = Z.get(id); const c = C.get(id);
      if (v && z) {
        if (v === z || gleichesObjekt(v, z)) continue;
        if (c && gleichesObjekt(c, v)) { ersetzt.set(id, z); getan += 1; } else uebersprungen += 1;
      } else if (v && !z) {            // der Schritt hat es angelegt → wieder weg
        if (!c) continue;
        if (gleichesObjekt(c, v)) { weg.add(id); getan += 1; } else uebersprungen += 1;
      } else if (z && !c) { dazu.push(z); getan += 1; }   // der Schritt hat es entfernt → wieder da
    }
    if (ersetzt.size === 0 && weg.size === 0 && dazu.length === 0) return cur;
    // Reihenfolge: die des Ziel-Stands als Rückgrat (Eltern vor Kindern), danach, was andere neu angelegt haben
    const bleibt = new Map<string, T>();
    for (const x of cur) if (!weg.has(x.id)) bleibt.set(x.id, ersetzt.get(x.id) ?? x);
    for (const x of dazu) bleibt.set(x.id, x);
    const aus: T[] = [];
    for (const x of zuL) { const m = bleibt.get(x.id); if (m) { aus.push(m); bleibt.delete(x.id); } }
    for (const m of bleibt.values()) aus.push(m);
    return aus;
  };
  const nodes = liste(jetzt.nodes, von.nodes, zu.nodes);
  let edges = liste(jetzt.edges, von.edges, zu.edges);
  const ids = new Set(nodes.map((n) => n.id));   // Verbindungen ohne Karte gibt es nicht
  if (edges.some((e) => !ids.has(e.source) || !ids.has(e.target))) edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const drawings = jetzt.drawings || zu.drawings || von.drawings ? liste(jetzt.drawings ?? [], von.drawings ?? [], zu.drawings ?? []) : jetzt.drawings;
  return { stand: { nodes, edges, drawings }, getan, uebersprungen };
}
/** Kennungen der Karten, Verbindungen und Striche, die sich zwischen zwei Ständen unterscheiden */
function geaenderteIds(a: Stand, b: Stand): string[] {
  const aus: string[] = [];
  const liste = <T extends { id: string }>(x: T[], y: T[]): void => {
    if (x === y) return;
    const Y = new Map(y.map((o) => [o.id, o]));
    for (const o of x) { const m = Y.get(o.id); if (!m || !gleichesObjekt(o, m)) aus.push(o.id); Y.delete(o.id); }
    for (const id of Y.keys()) aus.push(id);
  };
  liste(a.nodes, b.nodes); liste(a.edges, b.edges); liste(a.drawings ?? [], b.drawings ?? []);
  return aus;
}
/**
 * Es kommt etwas von außen in dieses Board (`fremdIds`: was sich dadurch ändert). Der JÜNGSTE Schritt bleibt offen —
 * Ziehen oder Tippen können noch laufen — und merkt sich nur, was die anderen angefasst haben. Ältere Schritte sind
 * abgeschlossen: Sie merken sich den Stand, den sie hinterließen (das „Vorher" ihres Nachfolgers).
 */
function schritteAbgrenzen(liste: HistoryEntry[], boardId: string, jetzt: Stand, fremdIds: string[]): HistoryEntry[] {
  if (!liste.some((e) => e.boardId === boardId)) return liste;
  const aus = [...liste];
  let danach: Stand | null = null;
  for (let i = aus.length - 1; i >= 0; i -= 1) {
    const e = aus[i];
    if (e.boardId !== boardId) continue;
    if (danach === null) {
      // der jüngste Schritt dieses Boards
      if (!e.nach && fremdIds.length) {
        const vor = new Map<string, object>([...e.nodes, ...e.edges, ...(e.drawings ?? [])].map((o) => [o.id, o]));
        const hier = new Map<string, object>([...jetzt.nodes, ...jetzt.edges, ...(jetzt.drawings ?? [])].map((o) => [o.id, o]));
        const fremd = new Set(e.fremd ?? []); const gemischt = new Set(e.gemischt ?? []);
        for (const id of fremdIds) {
          const v = vor.get(id); const h = hier.get(id);
          // Hatte der Schritt die Stelle selbst schon geändert (oder angelegt/entfernt), bevor der andere kam?
          if (!fremd.has(id) && (!!v !== !!h || (v && h && !gleichesObjekt(v, h)))) gemischt.add(id);
          fremd.add(id);
        }
        aus[i] = { ...e, fremd: [...fremd], ...(gemischt.size ? { gemischt: [...gemischt] } : {}) };
      }
    } else if (!e.nach) aus[i] = { ...e, nach: danach };
    danach = { nodes: e.nodes, edges: e.edges, drawings: e.drawings };
  }
  return aus;
}
/** M365: Gleich kommt eine Karte von außen in dieses Board (Mitlesen beim Tippen) — die eigenen Schritte abgrenzen */
export function verlaufAbgrenzen(boardId: string, fremdIds: string[]): void {
  const s = useBoard.getState();
  const b = s.boards.find((x) => x.id === boardId);
  if (!b || (s.past.length === 0 && s.future.length === 0)) return;
  const jetzt: Stand = { nodes: b.nodes, edges: b.edges, drawings: b.drawings };
  const past = schritteAbgrenzen(s.past, boardId, jetzt, fremdIds);
  const future = schritteAbgrenzen(s.future, boardId, jetzt, fremdIds);
  if (past !== s.past || future !== s.future) useBoard.setState({ past, future });
}
/**
 * Rückgängig (`zurueck`) oder Wiederholen (`vor`) eines Schritts, nach dem Fremdes dazukam: gezielt statt als
 * ganzer Stand. Der Eintrag wandert mit vertauschten Rollen auf den anderen Stapel.
 */
function schrittGezielt(
  set: (teil: Partial<BoardState>) => void, s: BoardState, entry: HistoryEntry, richtung: 'zurueck' | 'vor',
): void {
  const board = s.boards.find((b) => b.id === entry.boardId);
  if (!board) return;
  const jetzt: Stand = { nodes: board.nodes, edges: board.edges, drawings: board.drawings };
  const zu: Stand = { nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings };
  // Abgeschlossener Schritt: sein gemerkter Stand danach. Offener (jüngster) Schritt: der Stand von jetzt.
  const von: Stand = entry.nach ?? jetzt;
  const r = gezieltZurueck(jetzt, von, zu, new Set(entry.fremd ?? []), new Set(entry.gemischt ?? []));
  const gegen: HistoryEntry = { boardId: entry.boardId, ...von, nach: zu, ...(entry.fremd ? { fremd: entry.fremd } : {}) };
  const stapel = richtung === 'zurueck'
    ? { past: s.past.slice(0, -1), future: r.getan ? [...s.future, gegen] : s.future }
    : { future: s.future.slice(0, -1), past: r.getan ? [...s.past, gegen] : s.past };
  const notizen = s.activeId === entry.boardId ? geaenderteNotizen(board.nodes, r.stand.nodes) : [];
  set({
    ...stapel,
    ...(r.getan ? { boards: s.boards.map((b) => (b.id === entry.boardId ? { ...b, nodes: r.stand.nodes, edges: r.stand.edges, drawings: r.stand.drawings } : b)) } : {}),
  });
  if (notizen.length) window.dispatchEvent(new CustomEvent(NOTIZ_EXTERN, { detail: notizen }));
  const was = richtung === 'zurueck' ? 'Zurückgenommen' : 'Wiederholt';
  if (r.uebersprungen && r.getan) useBoard.getState().showToast(`↩ ${was} – ${r.uebersprungen === 1 ? 'eine Stelle blieb' : `${r.uebersprungen} Stellen blieben`}, wie sie ist: Jemand anderes hat sie inzwischen geändert.`, false, 6000);
  else if (r.uebersprungen) useBoard.getState().showToast('↩ Nichts zurückgenommen – was dieser Schritt betraf, hat inzwischen jemand anderes geändert.', false, 6000);
}

/** Die Board-Liste eines set(): nur lesend geteilte Boards behalten ihren Inhalt, gesperrte Karten ihren Stand */
function leseschutz(alt: BoardDoc[], neu: BoardDoc[]): BoardDoc[] {
  const vorher = new Map(alt.map((b) => [b.id, b]));
  let geschuetzt = false; let verworfen = false;
  const aus = neu.map((b) => {
    const a = vorher.get(b.id);
    if (!a || a === b) return b;
    if (a.geteiltRolle !== 'lesen') {
      const sperren = kartenSperren.get(b.id);
      const g = gruppen.get(b.id);
      let s = sperren ? sperrschutz(a, b, sperren) : b;
      if (g) s = gruppenschutz(a, s, g);   // M365: Ersteller vermerken, Rechte der Gäste
      if (s !== b) geschuetzt = true;
      return s;
    }
    const r = nurAnsicht(a, b);
    geschuetzt = true;
    if (r.verworfen) verworfen = true;
    return r.board;
  });
  if (verworfen) leseHinweis();
  return geschuetzt ? aus : neu;
}

/** Sammel-Aktionen (z. B. KI-Pläne): innere Mutatoren pushen KEINE eigenen
 *  History-Einträge — der Aufrufer sichert vorher genau einen Snapshot.
 *  So macht wirklich EIN Strg+Z den kompletten Plan rückgängig (Audit R6-K1). */
let historyMuted = false;
/** M390: der Rückgängig-Schritt, zu dem der Knopf im aktuellen Hinweis gehört (siehe hinweisRueckgaengig) */
let hinweisEintrag: unknown = null;

/** M184: Stand vor dem letzten Struktur-Import (OneNote) — bewusst außerhalb
 *  des persistierten States: Ein Rückgängig gilt nur für die laufende Sitzung
 *  und soll nicht als riesiger Zweitstand mitgespeichert werden. */
let importUndo: { boards: BoardDoc[]; spaces: Space[]; activeId: string } | null = null;
/** M398: Stand vor dem letzten Löschen eines Projekts oder Bereichs – wie der Import nur für die laufende Sitzung */
let ebenenUndo: {
  art: 'projekt' | 'bereich';
  bereich: Space; bereichIndex: number;
  projekt?: Project; projektIndex?: number;
  /** die gelöschten Boards mit ihrer Stelle in der Liste (Reihenfolge des Anlegens) */
  boards: Array<{ board: BoardDoc; index: number }>;
  activeId: string;
  /** dabei von selbst angelegt, weil sonst nichts Sichtbares geblieben wäre */
  neuesBoard?: string; neuesProjekt?: string;
} | null = null;
export function mutedHistory<T>(fn: () => T): T {
  historyMuted = true;
  try {
    return fn();
  } finally {
    historyMuted = false;
  }
}

// Feingranulare History (M122): Modul-Bearbeitungen (Ticket-Felder, Diagramm-
// Code, Gantt-Zeilen, Notiz-Tipp-Bursts) werden undo-fähig. Aufeinander-
// folgende Änderungen am SELBEN Ziel innerhalb von 1,5 s teilen sich einen
// Eintrag — sonst würde jeder Tastendruck die History fluten.
let lastEditKey = '';
let lastEditAt = 0;
const EDIT_COALESCE_MS = 1500;

/** Haben sich Notiz-INHALTE zwischen zwei Ständen geändert? (Referenzvergleich)
 *  Dann muss Undo/Redo den Board-Remount erzwingen — BlockNote-Editoren lesen
 *  ihre Blöcke nur beim Mount und würden sonst alten Text zurückschreiben. */
function notesDiffer(a: AppNode[], b: AppNode[]): boolean {
  const blocksById = new Map(a.filter((n) => n.type === 'note').map((n) => [n.id, n.data.blocks]));
  return b.some((n) => {
    if (n.type !== 'note') return false;
    const prev = blocksById.get(n.id);
    return prev !== undefined && prev !== n.data.blocks;
  });
}
/** M364: Kennungen der Notizen, deren Inhalt sich zwischen zwei Ständen geändert hat (Referenzvergleich) */
function geaenderteNotizen(a: AppNode[], b: AppNode[]): string[] {
  const blocksById = new Map(a.filter((n) => n.type === 'note').map((n) => [n.id, n.data.blocks]));
  return b.filter((n) => n.type === 'note' && blocksById.has(n.id) && blocksById.get(n.id) !== n.data.blocks).map((n) => n.id);
}
/** M365: Notizen, die von außen ins Board kamen (Abgleich) — sie ziehen den Schreib-Cursor nicht an sich. Eine
 *  frische, leere Notiz setzt den Cursor sonst sofort hinein; das gilt nur für selbst angelegte: Legt in der
 *  Gruppenarbeit jemand eine Notiz an, spränge bei allen anderen der Cursor dorthin (und sie „hielten" die Karte). */
const vonAussen = new Set<string>();
export const kamVonAussen = (id: string): boolean => vonAussen.has(id);
function fremdeNotizenMerken(alt: BoardDoc[], neu: BoardDoc[]): void {
  const da = new Set<string>();
  for (const b of alt) for (const n of b.nodes) da.add(n.id);
  if (vonAussen.size > 4000) vonAussen.clear();
  for (const b of neu) for (const n of b.nodes) if (n.type === 'note' && !da.has(n.id)) vonAussen.add(n.id);
}
/** M364: „Diese Notizen wurden von außen geändert" — `detail`: Kennungen. Der Editor der Karte übernimmt den Stand. */
export const NOTIZ_EXTERN = 'pixinotes:notiz-extern';
/** Radier-Geste: erster Treffer erzeugt den History-Eintrag, Rest der Geste nicht */
let eraseSnapPending = false;

/**
 * K1+M5-Schutz: localStorage-Writes werden gedrosselt (max. alle 400 ms statt
 * pro Tastendruck/Drag-Frame) und Quota-Fehler abgefangen statt die App zu
 * crashen. Bei vollem Speicher informiert ein Event die UI (Toast in App.tsx).
 */
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWrite: { key: string; value: string } | null = null;
let quotaWarned = false;

// ---------------------------------------------------------------------------
// Single-Writer-Schutz (Sync-Audit M81): Läuft PixiNotes doppelt (installierte
// PWA + vergessener Browser-Tab), teilen sich beide Kontexte denselben
// localStorage — bisher überschrieb der zuletzt schreibende kommentarlos den
// anderen. Genau so ging ein frisch geladener Sync-Stand nach dem Neustart
// wieder verloren. Jetzt hält genau EIN Kontext die Schreibrechte (Web Lock);
// alle weiteren Fenster laufen als Mitleser: sie schreiben nichts und
// übernehmen den Stand des Schreibers live (storage-Event → adopt).
export type WriterRole = 'writer' | 'follower';
let writerRole: WriterRole = 'writer'; // Standard: einziges Fenster schreibt
const LOCK_NAME = 'pixinotes-writer';
const hasLocks = typeof navigator !== 'undefined' && 'locks' in navigator;

export const getWriterRole = (): WriterRole => writerRole;
export const singleWriterSupported = (): boolean => hasLocks;

function setWriterRole(role: WriterRole): void {
  if (writerRole === role) return;
  writerRole = role;
  // Nie einen veralteten Puffer nachschieben (z. B. via visibilitychange-Flush)
  if (role === 'follower') pendingWrite = null;
  window.dispatchEvent(new CustomEvent('pixinotes:writer-change'));
}

/** Ausstehenden (gedrosselten) Persist-Write sofort schreiben.
 *  true = der aktuelle Stand liegt jetzt sicher in localStorage.
 *  Bei Quota-Fehler bleibt der Write gepuffert (Retry beim nächsten Flush). */
export function flushPersist(): boolean {
  if (!pendingWrite) return true;
  try {
    localStorage.setItem(pendingWrite.key, pendingWrite.value);
    pendingWrite = null;
    quotaWarned = false;
    return true;
  } catch {
    if (!quotaWarned) {
      quotaWarned = true;
      window.dispatchEvent(new CustomEvent('pixinotes:quota'));
    }
    return false;
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPersist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersist();
  });
}
const debouncedSafeStorage = {
  // pendingWrite mitlesen: ein getItem direkt nach setItem darf nie den
  // schon überholten localStorage-Stand liefern
  getItem: (k: string) => (pendingWrite?.key === k ? pendingWrite.value : localStorage.getItem(k)),
  setItem: (k: string, v: string) => {
    if (writerRole !== 'writer') return; // Mitlese-Fenster schreibt NIE
    pendingWrite = { key: k, value: v };
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushPersist, 400);
  },
  removeItem: (k: string) => {
    if (writerRole !== 'writer') return;
    pendingWrite = null;
    localStorage.removeItem(k);
  },
};

/** Persistierten Stand aus localStorage in den laufenden Store übernehmen —
 *  Mitleser folgen so dem Schreiber; ein Nachfolger übernimmt vor dem ersten
 *  eigenen Write, was der alte Schreiber zuletzt gesichert hat. */
export function adoptPersistedState(): boolean {
  try {
    const raw = localStorage.getItem('pixinotes-board');
    if (!raw) return false;
    const st = (JSON.parse(raw) as { state?: { boards?: BoardDoc[]; spaces?: Space[]; activeId?: string } }).state;
    if (!st || !Array.isArray(st.boards) || st.boards.length === 0 || !Array.isArray(st.spaces)) return false;
    useBoard.getState().importSync(st.boards, st.spaces, st.activeId ?? st.boards[0].id);
    return true;
  } catch {
    return false;
  }
}

const holdForever = () => new Promise<never>(() => {});
let succession: AbortController | null = null;

/** In die Warteschlange: sobald der aktuelle Schreiber schließt, übernehmen wir. */
function queueSuccession(): void {
  succession?.abort();
  const ctl = new AbortController();
  succession = ctl;
  void navigator.locks
    .request(LOCK_NAME, { signal: ctl.signal }, () => {
      adoptPersistedState(); // der alte Schreiber kann Neueres hinterlassen haben
      setWriterRole('writer');
      useBoard.getState().showToast('Das andere Fenster ist zu – dieses Fenster speichert jetzt wieder selbst.');
      return holdForever();
    })
    .catch(() => {
      // Eigener abort() (Übernahme-Klick) → nichts tun; sonst wurde uns der
      // gerade gewonnene Lock gestohlen → zurück in die Mitleser-Rolle
      if (!ctl.signal.aborted && writerRole === 'writer') demoted();
    });
}

/** Wir haben die Schreibrechte verloren (anderes Fenster hat übernommen). */
function demoted(): void {
  setWriterRole('follower');
  adoptPersistedState();
  useBoard.getState().showToast('Ein anderes Fenster hat die Bearbeitung übernommen – dieses Fenster liest nur noch mit.');
  queueSuccession();
}

/** Schreibrechte JETZT in dieses Fenster holen (bewusste Nutzer-Aktion wie
 *  Import/Zurücksetzen). Wirkt sofort; der Web-Lock-Steal bestätigt asynchron. */
export function claimWriter(): void {
  if (!hasLocks || writerRole === 'writer') return;
  succession?.abort();
  succession = null;
  setWriterRole('writer');
  void navigator.locks
    .request(LOCK_NAME, { steal: true }, () => holdForever())
    .catch(() => demoted());
}

/** „Hier weiterarbeiten"-Banner: letzten Speicherstand übernehmen, dann schreiben. */
export function takeOverWriter(): void {
  if (writerRole === 'writer') return;
  adoptPersistedState();
  claimWriter();
}

function initSingleWriter(): void {
  if (!hasLocks) return; // sehr alte Browser: bisheriges Verhalten (nur Warn-Toast)
  void navigator.locks
    .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        // Ein anderes Fenster schreibt bereits → mitlesen und Nachfolge anmelden
        setWriterRole('follower');
        queueSuccession();
        return;
      }
      return holdForever();
    })
    .catch(() => {
      if (writerRole === 'writer') demoted(); // Lock gestohlen („Hier weiterarbeiten" woanders)
    });
}
if (typeof window !== 'undefined') initSingleWriter();

// Sync-Audit M81: Nach einem Import (Sync-Ordner/WebDAV/Datei/anderes Fenster)
// darf der Auto-Sync denselben Stand nicht gleich wieder MIT NEUEM Zeitstempel
// hochladen — andere Geräte sähen sonst grundlos „fremden Stand" (Konflikt).
let importedRefs: { boards: unknown; spaces: unknown } = { boards: null, spaces: null };
export const isImportedState = (boards: unknown, spaces: unknown): boolean =>
  importedRefs.boards === boards && importedRefs.spaces === spaces;
export const markImported = (boards: unknown, spaces: unknown): void => {
  importedRefs = { boards, spaces };
};

// Abgeleitete Änderungen (z. B. Auto-Einsammeln des Kanbans beim Start):
// verändern zwar die Boards, sind aber jederzeit aus ihnen rekonstruierbar —
// sie dürfen darum NICHT als „eigene lokale Bearbeitung" zählen, sonst
// blockieren sie das automatische Übernehmen eines neueren Sync-Stands.
// zustand-Subscriber laufen synchron innerhalb von set(), daher reicht ein
// einfacher Tiefenzähler um den Aufruf herum.
let derivedDepth = 0;
export function runDerived<T>(fn: () => T): T {
  derivedDepth += 1;
  try { return fn(); } finally { derivedDepth -= 1; }
}
export const inDerived = (): boolean => derivedDepth > 0;

/** Eigenen Stand erneut nach localStorage durchsetzen — der Schreiber wehrt
 *  damit fremde Writes ab (z. B. ein alter Tab mit einer App-Version ohne
 *  Single-Writer-Schutz), statt Daten zu verlieren. */
export function reassertPersist(): void {
  useBoard.setState({}); // no-op-Merge: stößt den persist-Layer neu an
  flushPersist();
}

/** „Board 2", „Board 3" … statt fünfmal „Neues Board" */
function nextName(base: string, existing: string[]): string {
  let n = existing.filter((e) => e.startsWith(base)).length + 1;
  let candidate = n === 1 ? base : `${base} ${n}`;
  while (existing.includes(candidate)) candidate = `${base} ${++n}`;
  return candidate;
}

const defaultHierarchy = (boardIds: string[]): Space[] => [
  {
    id: 'space-work',
    name: 'Arbeit',
    projects: [{ id: 'proj-general', name: 'Allgemein', boardIds }],
  },
];

/**
 * M370: Der leere Start. Wer PixiNotes zum ersten Mal öffnet, bekommt ein leeres Board — nicht mehr die
 * Beispiel-Umgebung mit ihren vielen Boards. Die verwirrte vor allem dort, wo jemand über einen geteilten Link kam:
 * neben dem einen Board, um das es ging, stand eine fremde Welt. Beispiele gibt es weiter, aber auf Wunsch
 * (Begrüßung, leeres Board, ＋ Neu).
 */
export const START_BOARD_NAME = 'Mein Board';
/** M381: … und so heißt es, wenn die Oberfläche englisch läuft (siehe startNamenAufEnglisch) */
export const START_BOARD_NAME_EN = 'My board';
/** Bis M396 trugen die vorgegebenen Namen ein Emoji vorweg – ein unberührtes Board von damals zählt weiter als unberührt */
const ohneVorsatz = (n: string): string => n.replace(/^[^\p{L}\p{N}]+\s+/u, '');
const istStartName = (n: string): boolean => { const k = ohneVorsatz(n); return k === START_BOARD_NAME || k === START_BOARD_NAME_EN; };
function leererStart(): { boards: BoardDoc[]; spaces: Space[]; activeId: string } {
  const boardId = uid();
  return {
    boards: [{ id: boardId, name: START_BOARD_NAME, nodes: [], edges: [], drawings: [] }],
    spaces: [{ id: uid(), name: 'Arbeit', projects: [{ id: uid(), name: 'Allgemein', boardIds: [boardId] }] }],
    activeId: boardId,
  };
}
/**
 * Das unberührte Startboard — oder null. „Unberührt" heißt: Es ist das einzige Board, trägt noch seinen Namen
 * und ist leer. Dann darf es Platz machen, wenn ein Board von außen kommt (geteilter Link, Einladung,
 * Beispiele): Wer nichts Eigenes hat, soll danach genau das sehen, was er geöffnet hat.
 */
export function leeresStartboard(boards: BoardDoc[]): BoardDoc | null {
  if (boards.length !== 1) return null;
  const b = boards[0];
  const leer = istStartName(b.name) && !b.nodes.length && !b.edges.length && !(b.drawings?.length) && !(b.comments?.length)
    && !b.geteiltVon && !b.gastLink;
  return leer ? b : null;
}
/** Boards und Hierarchie ohne das Startboard (Bereich und Projekt bleiben — dort ist Platz für Eigenes) */
export function ohneStartboard<T extends { boards: BoardDoc[]; spaces: Space[] }>(stand: T, startId: string): { boards: BoardDoc[]; spaces: Space[] } {
  return {
    boards: stand.boards.filter((b) => b.id !== startId),
    spaces: stand.spaces.map((sp) => ({ ...sp, projects: sp.projects.map((pr) => ({ ...pr, boardIds: pr.boardIds.filter((id) => id !== startId) })) })),
  };
}

/** M453: Inhaltliche Änderung von Hand stempelt die Karte — Automatik (runDerived) nicht */
const zeitNachPatch = (neu: AppNode, alt: AppNode, patch: Record<string, unknown>): AppNode =>
  (inDerived() ? neu : nachPatch(neu, alt, patch));

/** M390: Ändern sich die Blöcke einer Notiz, wandern die Fristen-Anker mit (lib/fristAnker.ts). */
const mitFristAnker = (n: AppNode, data: Record<string, unknown>): Record<string, unknown> => {
  // M435: Formen (Schritt, Entscheidung, Start/Ende) tragen formatierten Text wie Notizen — `text` bleibt die
  // Klartext-Fassung für KI, Suche, Export und Vortrag. Neue Blöcke schreiben den Klartext nach; wer nur den
  // Klartext setzt (KI, Vortrag, Import), dem gehört der Inhalt: die alten Blöcke fallen weg.
  if (n.type === 'shape') {
    if ('blocks' in data) return { ...data, text: blocksToText(data.blocks as unknown[] | undefined).trim() };
    if ('text' in data) return { ...data, blocks: undefined };
    return data;
  }
  if (n.type !== 'note' || !('blocks' in data) || 'fristAnker' in data) return data;
  const alt = (n.data as { fristAnker?: FristAnker }).fristAnker;
  const neu = fristAnkerPflegen(data.blocks, alt);
  return neu === alt ? data : { ...data, fristAnker: neu };
};

export const useBoard = create<BoardState>()(
  persist(
    (setRoh, get) => {
      // M360: jeder Schreibzugriff der Oberfläche läuft durch den Leseschutz (siehe oben)
      const set: typeof setRoh = ((teil: unknown, ersetzen?: boolean) => {
        if (leseschutzAus > 0) return (setRoh as (t: unknown, e?: boolean) => void)(teil, ersetzen);
        const vor = get();
        if (kartenSperren.size === 0 && gruppen.size === 0 && !vor.boards.some((b) => b.geteiltRolle === 'lesen')) return (setRoh as (t: unknown, e?: boolean) => void)(teil, ersetzen);
        let neu = (typeof teil === 'function' ? (teil as (s: BoardState) => Partial<BoardState>)(vor) : teil) as Partial<BoardState>;
        if (neu.boards && neu.boards !== vor.boards) neu = { ...neu, boards: leseschutz(vor.boards, neu.boards) };
        return (setRoh as (t: unknown, e?: boolean) => void)(neu, ersetzen);
      }) as typeof setRoh;
      const patchActive = (fn: (b: BoardDoc) => Partial<BoardDoc>) => {
        const active = selectActiveBoard(get());
        if (!active) return;
        set({
          boards: get().boards.map((b) =>
            b.id === active.id ? { ...b, ...fn(b) } : b,
          ),
        });
      };

      /**
       * M310: Projekte mit automatischer Reihenfolge sortieren — alphabetisch
       * nach Name (deutsch, Zahlen natürlich) oder in der Reihenfolge des
       * Anlegens (die Stellung im Board-Stand: addBoard und duplizieren hängen
       * hinten an). Manuelle Projekte bleiben unberührt; unveränderte Projekte
       * behalten ihre Objekt-Identität, damit nichts umsonst neu rendert.
       * Wird überall angewandt, wo sich Boards oder Namen ändern — so stimmt
       * die Reihenfolge in Baum, Reitern, Übersicht und Netz von selbst.
       */
      const sortiereProjekte = (spaces: Space[], boards: BoardDoc[]): Space[] => {
        const name = new Map(boards.map((b) => [b.id, b.name]));
        const stelle = new Map(boards.map((b, i) => [b.id, i]));
        let geaendert = false;
        const out = spaces.map((sp) => {
          const projects = sp.projects.map((p) => {
            if (!p.sortierung || p.sortierung === 'manuell') return p;
            const ids = [...p.boardIds];
            if (p.sortierung === 'alphabetisch') {
              ids.sort((a, b) => (name.get(a) ?? '').localeCompare(name.get(b) ?? '', 'de', { numeric: true, sensitivity: 'base' }));
            } else {
              ids.sort((a, b) => (stelle.get(a) ?? 0) - (stelle.get(b) ?? 0));
            }
            if (ids.every((id, i) => id === p.boardIds[i])) return p;
            geaendert = true;
            return { ...p, boardIds: ids };
          });
          return projects.some((p, i) => p !== sp.projects[i]) ? { ...sp, projects } : sp;
        });
        return geaendert ? out : spaces;
      };

      /** Board-ID aus allen Projekten entfernen (Hilfsfunktion für move/delete) */
      /**
       * M398: Ein Projekt oder einen Bereich löschen – auch mit Inhalt. Vorher ging das nur leer: Wer aufräumen
       * wollte, musste jedes Board einzeln öffnen und löschen. Jetzt entscheidet `mit`, was mit den Boards
       * geschieht (löschen oder umziehen); der Stand davor bleibt für „Rückgängig" in der Meldung liegen.
       * Boards, die einem anderen Konto gehören, werden nie gelöscht – sie ziehen in ein verbleibendes Projekt.
       */
      const ebeneLoeschen = (art: 'projekt' | 'bereich', id: string, mit?: EbeneLoeschen): void => {
        const s0 = get();
        const bereich = art === 'bereich' ? s0.spaces.find((sp) => sp.id === id) : s0.spaces.find((sp) => sp.projects.some((p) => p.id === id));
        const projekt = art === 'projekt' ? bereich?.projects.find((p) => p.id === id) : undefined;
        if (!bereich || (art === 'projekt' && !projekt)) return;
        if (art === 'bereich' && s0.spaces.length <= 1) { s0.showToast('Der letzte Bereich bleibt bestehen'); return; }
        const name = art === 'bereich' ? bereich.name : projekt!.name;
        const ids = art === 'bereich' ? bereich.projects.flatMap((p) => p.boardIds) : projekt!.boardIds;
        if (ids.length > 0 && !mit) {
          s0.showToast(art === 'bereich' ? 'Bereich enthält noch Boards – erst verschieben oder löschen.' : 'Projekt enthält noch Boards – erst verschieben oder löschen.');
          return;
        }
        const bereichIndex = s0.spaces.indexOf(bereich);
        const projektIndex = projekt ? bereich.projects.indexOf(projekt) : undefined;
        let spaces = art === 'bereich'
          ? s0.spaces.filter((sp) => sp.id !== id)
          : s0.spaces.map((sp) => (sp === bereich ? { ...sp, projects: sp.projects.filter((p) => p.id !== id) } : sp));
        let boards = s0.boards;
        let activeId = s0.activeId;
        let neuesBoard: string | undefined; let neuesProjekt: string | undefined;
        let weg: Array<{ board: BoardDoc; index: number }> = [];
        let meldung = art === 'bereich' ? t(`Bereich „${name}" gelöscht.`) : t(`Projekt „${name}" gelöscht.`);
        /** ein Projekt, das Boards aufnehmen kann – notfalls wird „Allgemein" angelegt */
        const auffang = (): string => {
          const da = spaces.flatMap((sp) => sp.projects)[0];
          if (da) return da.id;
          neuesProjekt = uid();
          spaces = spaces.map((sp, i) => (i === 0 ? { ...sp, projects: [...sp.projects, { id: neuesProjekt!, name: t('Allgemein'), boardIds: [] }] } : sp));
          return neuesProjekt;
        };
        const hinein = (projektId: string, neue: string[]) => {
          spaces = spaces.map((sp) => ({ ...sp, projects: sp.projects.map((p) => (p.id === projektId ? { ...p, boardIds: [...p.boardIds, ...neue] } : p)) }));
        };
        if (ids.length > 0 && mit?.boards === 'behalten') {
          if (art === 'bereich') {
            const ziel = spaces.find((sp) => sp.id === mit.ziel);
            if (!ziel) return;
            spaces = spaces.map((sp) => (sp.id === mit.ziel ? { ...sp, projects: [...sp.projects, ...bereich.projects] } : sp));
            meldung = t(`Bereich „${name}" gelöscht – die Projekte liegen jetzt in „${ziel.name}".`);
          } else {
            const ziel = spaces.flatMap((sp) => sp.projects).find((p) => p.id === mit.ziel);
            if (!ziel) return;
            hinein(ziel.id, ids);
            spaces = sortiereProjekte(spaces, boards);
            meldung = t(`Projekt „${name}" gelöscht – die Boards liegen jetzt in „${ziel.name}".`);
          }
        } else if (ids.length > 0) {
          const betroffen = new Set(ids);
          const fremd = (b: BoardDoc) => !!(b.geteiltVon || b.gastLink);
          const bleiben = boards.filter((b) => betroffen.has(b.id) && fremd(b));
          weg = boards.map((board, index) => ({ board, index })).filter(({ board }) => betroffen.has(board.id) && !fremd(board));
          boards = boards.filter((b) => !betroffen.has(b.id) || fremd(b));
          if (bleiben.length) hinein(auffang(), bleiben.map((b) => b.id));
          // Ohne sichtbares Board gäbe es keine Arbeitsfläche mehr – dann liegt ein leeres bereit
          if (!boards.some((b) => !b.archived)) {
            neuesBoard = uid();
            boards = [...boards, { id: neuesBoard, name: t(START_BOARD_NAME), nodes: [], edges: [], drawings: [] }];
            hinein(auffang(), [neuesBoard]);
          }
          if (!boards.some((b) => b.id === activeId && !b.archived)) activeId = (boards.find((b) => !b.archived) ?? boards[0]).id;
          const n = weg.length;
          if (bleiben.length) {
            meldung = art === 'bereich'
              ? t(`Bereich „${name}" mit ${n} Board(s) gelöscht – geteilte Boards anderer bleiben.`)
              : t(`Projekt „${name}" mit ${n} Board(s) gelöscht – geteilte Boards anderer bleiben.`);
          } else {
            meldung = art === 'bereich' ? t(`Bereich „${name}" mit ${n} Board(s) gelöscht.`) : t(`Projekt „${name}" mit ${n} Board(s) gelöscht.`);
          }
        }
        ebenenUndo = { art, bereich, bereichIndex, projekt, projektIndex, boards: weg, activeId: s0.activeId, neuesBoard, neuesProjekt };
        mutedHistory(() => set({ boards, spaces, activeId }));
        get().showToast(meldung, 'ebene', 12000);
      };

      const stripBoardFromHierarchy = (spaces: Space[], boardId: string): Space[] =>
        spaces.map((sp) => ({
          ...sp,
          projects: sp.projects.map((p) => ({
            ...p,
            boardIds: p.boardIds.filter((id) => id !== boardId),
          })),
        }));

      // M370: Erststart mit EINEM leeren Board. (Bis M369 lag hier die Starter-Umgebung „Verwaltung" —
      // mehrere Bereiche, viele Boards; sie kommt jetzt nur noch auf Wunsch, siehe addStarter.) Wird bei
      // vorhandenem persistierten Stand vollständig überschrieben (rehydrate).
      const start = leererStart();

      return {
        boards: start.boards,
        spaces: start.spaces,
        activeId: start.activeId,
        view: 'board',
        searchOpen: false,
        settingsOpen: false,
        rechercheOpen: false,
        setRechercheOpen: (open) => set({ rechercheOpen: open }),
        presenting: false,
        presentFrom: null,
        setPresentFrom: (id) => set({ presentFrom: id }),
        tool: 'select',
        ai: { provider: 'none', model: 'claude-opus-4-8', apiKey: '', baseUrl: '' },
        toast: null,
        pendingFocus: null,
        lastDeleted: null,
        aiBusy: false,
        setAiBusy: (busy) => set({ aiBusy: busy }),

        helpOpen: false,
        helpSection: null,
        setHelpOpen: (open, section = null) => set({ helpOpen: open, helpSection: section }),
        bildExportOpen: false,
        setBildExportOpen: (open) => set({ bildExportOpen: open }),

        physicsEnabled: false,
        setPhysicsEnabled: (on) => set({ physicsEnabled: on }),
        konfetti: false,
        setKonfetti: (on) => set({ konfetti: on }),
        pfeilSchatten: true,
        setPfeilSchatten: (on) => set({ pfeilSchatten: on }),
        ruheHinweis: false,
        setRuheHinweis: (on) => set({ ruheHinweis: on }),
        stiftZeichnet: true,
        setStiftZeichnet: (on) => set({ stiftZeichnet: on }),

        setArchived: (ids, archived) => {
          if (ids.length === 0) return;
          get().pushHistory();
          const idSet = new Set(ids);
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              // Beim Archivieren auch abwählen — sonst schwebt die
              // Auswahl-Leiste über einer unsichtbaren Karte
              idSet.has(n.id) ? { ...n, archived: archived || undefined, selected: false } : n,
            ),
          }));
          // M408: Der Hinweis sagt, wo das Archiv ist (vorher nur „Strg+Z holt sie zurück" – danach suchte man es vergeblich)
          get().showToast(
            // (Einzahl und Mehrzahl als ganze Sätze – ein angehängtes „n" lässt sich nicht übersetzen)
            archived
              ? (ids.length === 1 ? 'Karte archiviert. Wiederfinden: Mehr → „Archiv einblenden".' : `${ids.length} Karten archiviert. Wiederfinden: Mehr → „Archiv einblenden".`)
              : (ids.length === 1 ? 'Karte aus dem Archiv zurückgeholt.' : `${ids.length} Karten aus dem Archiv zurückgeholt.`),
            archived ? true : undefined,
          );
        },

        showArchived: false,
        setShowArchived: (on) => {
          // M390: Mit dem Archiv verschwindet auch die Auswahl archivierter Karten — sonst blieb „1 ausgewählt"
          // stehen und Entf löschte eine Karte, die niemand sah
          if (on) { set({ showArchived: true }); return; }
          set({
            showArchived: false,
            boards: get().boards.map((b) => (b.nodes.some((n) => n.archived && n.selected)
              ? { ...b, nodes: b.nodes.map((n) => (n.archived && n.selected ? ({ ...n, selected: false } as AppNode) : n)) }
              : b)),
          });
        },

        setBoardBg: (id, bg) =>
          set({ boards: get().boards.map((b) => (b.id === id ? { ...b, bg } : b)) }),

        gridSnap: false,
        setGridSnap: (on) => set({ gridSnap: on }),
        anzeige: 1,
        setAnzeige: (z) => set({ anzeige: Math.min(1.8, Math.max(1, z)) }),
        lesbareSchrift: false,
        setLesbareSchrift: (on) => set({ lesbareSchrift: on }),
        hoherKontrast: false,
        setHoherKontrast: (on) => set({ hoherKontrast: on }),
        // M294: aus — die Ansicht bleibt, wo sie ist; wer den Flug mag,
        // schaltet ihn unter ⚙ → Bedienung wieder ein
        clickZoom: false,
        setClickZoom: (on) => set({ clickZoom: on }),
        wheelZoom: false,
        setWheelZoom: (on) => set({ wheelZoom: on }),
        handschriftOnline: false,
        setHandschriftOnline: (on) => set({ handschriftOnline: on }),
        handschriftAuto: true,
        setHandschriftAuto: (on) => set({ handschriftAuto: on }),
        fingerGesten: true,
        setFingerGesten: (on) => set({ fingerGesten: on }),
        handschriftKi: true,
        setHandschriftKi: (on) => set({ handschriftKi: on }),
        overviewMode: 'hierarchie',
        setOverviewMode: (m) => set({ overviewMode: m }),
        graphLayers: { cards: false, portals: true, wikis: true, projectOnly: false },
        setGraphLayer: (key, on) => set((s) => ({ graphLayers: { ...s.graphLayers, [key]: on } })),
        ui: { theme: 'system', accent: 'blau' },
        setUiTheme: (theme) => set({ ui: { ...get().ui, theme } }),
        setUiAccent: (accent) => set({ ui: { ...get().ui, accent } }),

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

        settingsSection: null,
        setSettingsOpen: (open, section = null) => set({ settingsOpen: open, settingsSection: section }),
        tasksOpen: false,
        setTasksOpen: (open) => set({ tasksOpen: open }),
        shareCards: null,
        setShareCards: (ids) => set({ shareCards: ids }),

        focusCard: null,
        setFocusCard: (id) => set({ focusCard: id, ...(id ? {} : { focusHerkunft: null }) }),
        focusHerkunft: null,
        /**
         * M285: Der eine Weg zur Karte — aus Übersicht, Navigator, Suche
         * oder Board.
         *
         * Ist das Karten-Blatt abgeschaltet (⚙ → Bedienung) oder trägt die
         * Karte gar keinen Inhalt zum Bearbeiten (Rahmen, Portal, Form), wird
         * stattdessen wie bisher hingeflogen und ausgewählt. So bleibt die
         * Zusage „von überall erreichbar" auch dort wahr, wo es kein Blatt gibt.
         */
        oeffneKarte: (boardId, nodeId, herkunft = 'board') => {
          const st = get();
          const board = st.boards.find((b) => b.id === boardId);
          const node = board?.nodes.find((n) => n.id === nodeId);
          const blattfaehig = !!node
            && !['portal', 'frame', 'shape'].includes(node.type ?? '')
            && !node.archived;
          if (st.cardFocus && blattfaehig) {
            set({ activeId: boardId, view: 'board', focusCard: nodeId, focusHerkunft: herkunft });
          } else {
            set({ pendingFocus: { boardId, nodeId }, activeId: boardId, view: 'board', focusCard: null, focusHerkunft: null });
          }
        },
        cardFocus: true,
        setCardFocus: (on) => set({ cardFocus: on, ...(on ? {} : { focusCard: null }) }),
        // M235: beide AUS voreingestellt — am PC bleibt alles, wie es war,
        // bis jemand es ausdrücklich anders will
        fokusEinKlick: false,
        setFokusEinKlick: (on) => set({ fokusEinKlick: on }),
        fokusVollbild: false,
        setFokusVollbild: (on) => set({ fokusVollbild: on }),
        /**
         * M263: Am großen Schirm ist die linke Spalte die Voreinstellung.
         *
         * „auf großen Screens bitte die Header-Navigation immer links
         * vertikal anzeigen! ist einfach besser!" — und das deckt sich mit
         * der Geometrie aus M238: nach unten ist Platz, nach rechts nicht.
         * Das Stylesheet lässt die Spalte ohnehin erst ab 861 Punkten
         * wirken, am Telefon bleibt es bei der Kopfleiste. Wer sie nicht
         * will, schaltet sie in den Einstellungen ab; diese Wahl wird
         * gespeichert und überschreibt die Voreinstellung.
         */
        navLinks: true,
        setNavLinks: (on) => set({ navLinks: on }),
        navBreite: 380,
        setNavBreite: (px) => set({ navBreite: Math.max(280, Math.min(760, Math.round(px))) }),
        spalteBreite: 268,
        setSpalteBreite: (px) => set({ spalteBreite: Math.max(200, Math.min(480, Math.round(px))) }),
        milchglas: true,
        setMilchglas: (on) => set({ milchglas: on }),
        /**
         * M269: Dateiinhalte reisen im Sync-Stand mit — bis zu dieser Grenze.
         *
         * 25 MB als Voreinstellung: Das deckt Handouts, Tischvorlagen und
         * Protokolle ab, für die eine Datei-Karte typischerweise angelegt
         * wird, und hält die Sync-Datei in einer Größe, die auch über die
         * Dateien-App und WebDAV noch zügig durchgeht. 0 schaltet es ab.
         */
        syncDateienMb: 25,
        setSyncDateienMb: (mb) => set({ syncDateienMb: Math.max(0, Math.min(500, Math.round(mb))) }),

        updateNodeDataOnBoard: (boardId, nodeId, data) => {
          // Feingranulare History (M122) — Snapshot des ZIEL-Boards (die
          // Aufgaben-Zentrale bearbeitet auch fremde Boards); undo() kann
          // dank boardId im Eintrag boardübergreifend zurückspringen
          if (!historyMuted && !inDerived()) {
            const key = `b:${boardId}:${nodeId}`;
            const now = Date.now();
            if (key !== lastEditKey || now - lastEditAt > EDIT_COALESCE_MS) {
              const b = get().boards.find((x) => x.id === boardId);
              if (b) {
                set({
                  past: [...get().past.slice(-(HISTORY_LIMIT - 1)), { boardId, nodes: b.nodes, edges: b.edges, drawings: b.drawings }],
                  future: [],
                });
              }
            }
            lastEditKey = key;
            lastEditAt = now;
          }
          // M323: Wer von außen die BLÖCKE einer Notiz schreibt (Aufgaben-
          // Zentrale, Kanban-Rücksync, Teilen-Ziel), muss den lebenden Editor
          // erreichen — der liest seinen Inhalt sonst nur beim Mount und
          // schrieb beim nächsten Tastendruck den alten Stand zurück. extEpoch
          // zählt deshalb automatisch hoch, wenn der Aufrufer es nicht selbst tut.
          const patch = data as Record<string, unknown>;
          const bumpt = 'blocks' in patch && !('extEpoch' in patch);
          set({
            boards: get().boards.map((b) =>
              b.id === boardId
                ? {
                    ...b,
                    nodes: b.nodes.map((n) =>
                      n.id === nodeId
                        ? zeitNachPatch({ ...n, data: { ...n.data, ...mitFristAnker(n, data), ...(bumpt ? { extEpoch: (((n.data as { extEpoch?: number }).extEpoch) ?? 0) + 1 } : {}) } } as AppNode, n, patch)
                        : n,
                    ),
                  }
                : b,
            ),
          });
        },
        textRueckgaengig: (id, blocks) => {
          /**
           * M390: Strg+Z IM Notiztext ist das Rückgängig des Editors — fein, Wort für Wort. Sein Ergebnis kam bisher
           * als gewöhnliche Änderung im Verlauf des Boards an: als NEUER Schritt. Wer danach auf der Fläche Strg+Z
           * drückte, nahm damit das Zurücknehmen zurück — der entfernte Text stand wieder da. Jetzt legt das
           * Editor-Rückgängig keinen Schritt an; und ist es genau bei einem gesicherten Stand angekommen, gilt
           * dieser Schritt als verbraucht.
           */
          const s0 = get();
          const board = s0.boards.find((b) => b.id === s0.activeId);
          if (!board) return;
          const gleich = (n: AppNode | undefined) => !!n && JSON.stringify((n.data as { blocks?: unknown }).blocks ?? null) === JSON.stringify(blocks ?? null);
          let past = s0.past;
          const oben = past[past.length - 1];
          if (oben && oben.boardId === board.id && !oben.others?.length && gleich(oben.nodes.find((n) => n.id === id))) {
            // nur verbrauchen, wenn der Schritt sonst nichts anderes sichert als diesen Text
            const sonstGleich = oben.nodes.length === board.nodes.length && oben.edges === board.edges
              && oben.nodes.every((n) => n.id === id || board.nodes.find((x) => x.id === n.id) === n);
            if (sonstGleich) past = past.slice(0, -1);
          }
          lastEditKey = '';
          set({
            past,
            boards: s0.boards.map((b) => (b.id !== board.id ? b : {
              ...b,
              nodes: b.nodes.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...mitFristAnker(n, { blocks }) } } as AppNode) : n)),
            })),
          });
        },
        fristAnkerNachtragen: () => {
          // Bestehende Notizen (vor M390 geschrieben, importiert, aus Vorlagen): Ihr Anker ist der Tag, an dem die
          // App sie zum ersten Mal sieht. Nur eigene Boards — in einem geteilten ändert jeder nur, was er anfasst.
          let geaendert = false;
          const boards = get().boards.map((b) => {
            if (b.geteiltVon) return b;
            let anders = false;
            const nodes = b.nodes.map((n) => {
              if (n.type !== 'note') return n;
              const alt = (n.data as { fristAnker?: FristAnker }).fristAnker;
              const neu = fristAnkerPflegen((n.data as { blocks?: unknown }).blocks, alt);
              if (neu === alt) return n;
              anders = true;
              return { ...n, data: { ...n.data, fristAnker: neu } } as AppNode;
            });
            if (!anders) return b;
            geaendert = true;
            return { ...b, nodes };
          });
          if (geaendert) runDerived(() => set({ boards }));
        },
        setPresenting: (on) => set({ presenting: on }),
        setTool: (tool) => {
          // M360: Auf einem nur lesend geteilten Board gibt es nichts zu zeichnen
          if (tool !== 'select' && selectNurLesen(get())) { get().showToast(LESE_HINWEIS, false, 5000); return; }
          set({ tool });
        },
        updateAi: (patch) => set({ ai: { ...get().ai, ...patch } }),
        brain: { on: false, provider: 'auto', embedModel: 'nomic-embed-text' },
        updateBrain: (patch) => set({ brain: { ...get().brain, ...patch } }),

        brainOffSpaces: [],
        toggleBrainSpace: (spaceId) => {
          const off = get().brainOffSpaces;
          const next = off.includes(spaceId) ? off.filter((x) => x !== spaceId) : [...off, spaceId];
          set({ brainOffSpaces: next });
          // Der Index räumt verwaiste Einträge beim nächsten Lauf selbst weg —
          // abgeschaltete Bereiche verlieren ihre Vektoren also von allein.
          window.dispatchEvent(new CustomEvent('pixinotes:brain-scope'));
        },
        rejectedLinks: [],
        rejectLink: (a, b) => {
          const key = [a, b].sort().join('|');
          const cur = get().rejectedLinks;
          if (!cur.includes(key)) set({ rejectedLinks: [...cur, key] });
        },

        addStroke: (stroke, sessionIds = []) => {
          get().pushHistory();
          patchActive((b) => ({
            drawings: integrateStroke(stroke, b.drawings ?? [], sessionIds, b.nodes).drawings,
          }));
        },

        bildErsetzen: (id, patch, verhaeltnis, neueId) => {
          const st = get();
          const board = st.boards.find((b) => b.id === st.activeId);
          const alt = board?.nodes.find((n) => n.id === id);
          if (!board || !alt) return;
          get().pushHistory();
          const ziel = neueId ?? id;
          const breite = typeof alt.width === 'number' ? alt.width : alt.measured?.width;
          const rahmen = (alt.data as { rahmen?: boolean }).rahmen === true;
          const neu = {
            ...alt, id: ziel, data: { ...alt.data, ...patch },
            // rahmenlos IST die Karte das Bild — ihre Höhe folgt dem neuen Seitenverhältnis
            ...(!rahmen && breite && verhaeltnis > 0 ? { height: Math.max(8, Math.round(breite * verhaeltnis)) } : {}),
          } as AppNode;
          const um = (k: string) => (k === id ? ziel : k);
          set({
            boards: get().boards.map((b) => {
              // Tickets anderer Boards können auf die Karte zeigen
              const tickets = (n: AppNode): AppNode => {
                if (ziel === id || n.type !== 'kanban') return n;
                const items = (n.data as { items?: Array<{ link?: { boardId: string; nodeId?: string }; links?: Array<{ boardId: string; nodeId: string }> }> }).items;
                if (!items?.some((i) => (i.link?.boardId === board.id && i.link.nodeId === id) || i.links?.some((l) => l.boardId === board.id && l.nodeId === id))) return n;
                return { ...n, data: { ...n.data, items: items.map((i) => ({
                  ...i,
                  ...(i.link?.boardId === board.id && i.link.nodeId === id ? { link: { ...i.link, nodeId: ziel } } : {}),
                  ...(i.links ? { links: i.links.map((l) => (l.boardId === board.id && l.nodeId === id ? { ...l, nodeId: ziel } : l)) } : {}),
                })) } } as AppNode;
              };
              if (b.id !== board.id) {
                if (ziel === id) return b;
                const nodes = b.nodes.map(tickets);
                return nodes.some((n, i) => n !== b.nodes[i]) ? { ...b, nodes } : b;
              }
              return {
                ...b,
                nodes: b.nodes.map((n) => (n.id === id ? neu : tickets(n.parentId === id ? ({ ...n, parentId: ziel } as AppNode) : n))),
                ...(ziel === id ? {} : {
                  edges: b.edges.map((e) => (e.source === id || e.target === id ? { ...e, source: um(e.source), target: um(e.target) } : e)),
                  drawings: (b.drawings ?? []).map((d) => (d.anchor === id ? { ...d, anchor: ziel } : d)),
                  comments: (b.comments ?? []).map((c) => (c.nodeId === id ? { ...c, nodeId: ziel } : c)),
                }),
              };
            }),
            ...(ziel !== id && get().focusCard === id ? { focusCard: ziel } : {}),
          });
        },

        addStrokeFertig: (stroke) => {
          if (!stroke.anchor || stroke.points.length === 0) return;
          get().pushHistory();
          patchActive((b) => ({ drawings: [...(b.drawings ?? []), stroke] }));
        },

        eraseStrokesById: (ids) => {
          const idSet = new Set(ids);
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board || !(board.drawings ?? []).some((s) => idSet.has(s.id))) return;
          if (eraseSnapPending) { get().pushHistory(); eraseSnapPending = false; }
          patchActive((b) => ({ drawings: (b.drawings ?? []).filter((s) => !idSet.has(s.id)) }));
        },

        removeStrokes: (ids) => {
          const idSet = new Set(ids);
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board || !(board.drawings ?? []).some((s) => idSet.has(s.id))) return;
          get().pushHistory();
          patchActive((b) => ({ drawings: (b.drawings ?? []).filter((s) => !idSet.has(s.id)) }));
        },

        beginEraseGesture: () => { eraseSnapPending = true; },

        eraseStrokesPartial: (x, y, radius) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board) return;
          const byId = new Map(board.nodes.map((n) => [n.id, n]));
          const showArchived = get().showArchived;
          const offsetOf = (s: Stroke): [number, number] | null => {
            if (!s.anchor) return [0, 0];
            const n = byId.get(s.anchor);
            if (!n || (n.archived && !showArchived)) return null;
            return [n.position.x, n.position.y];
          };
          let geaendert = false;
          const neu: Stroke[] = [];
          for (const s of board.drawings ?? []) {
            const o = offsetOf(s);
            if (!o) { neu.push(s); continue; }
            const rel = strichRelativ(s); // M335: Seitenstriche umgerechnet, verdeckte leer
            const drin = rel.map((p) => Math.hypot(p[0] + o[0] - x, p[1] + o[1] - y) < radius);
            if (!drin.some(Boolean)) { neu.push(s); continue; }
            geaendert = true;
            // Eingerastete Formen (wenige Punkte) verschwinden ganz — ein halbes Rechteck will niemand
            if (s.points.length <= 6) continue;
            let seg: number[] = [];
            const ablegen = () => {
              if (seg.length >= 2) {
                neu.push({ ...s, id: uid(), points: seg.map((i) => s.points[i]), druck: s.druck ? seg.map((i) => s.druck![i]) : undefined });
              }
              seg = [];
            };
            drin.forEach((d, i) => { if (d) ablegen(); else seg.push(i); });
            ablegen();
          }
          if (!geaendert) return;
          if (eraseSnapPending) { get().pushHistory(); eraseSnapPending = false; }
          patchActive(() => ({ drawings: neu }));
        },

        eraseStrokesNear: (x, y, radius) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board) return;
          // Geankerte Striche liegen relativ zur Karte — für den Treffer-Test
          // ihren Versatz auflösen; unsichtbare (Karte archiviert/weg) schonen
          const byId = new Map(board.nodes.map((n) => [n.id, n]));
          const showArchived = get().showArchived;
          const offsetOf = (s: Stroke): [number, number] | null => {
            if (!s.anchor) return [0, 0];
            const n = byId.get(s.anchor);
            if (!n || (n.archived && !showArchived)) return null;
            return [n.position.x, n.position.y];
          };
          const near = (s: Stroke) => {
            const o = offsetOf(s);
            return !!o && strichRelativ(s).some((p) => Math.hypot(p[0] + o[0] - x, p[1] + o[1] - y) < radius);
          };
          if (!(board.drawings ?? []).some(near)) return;
          // pro Radier-Geste genau EIN History-Eintrag (beim ersten Treffer)
          if (eraseSnapPending) { get().pushHistory(); eraseSnapPending = false; }
          patchActive((b) => ({ drawings: (b.drawings ?? []).filter((s) => !near(s)) }));
        },

        detachStrokes: (nodeIds) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board) return;
          const idSet = new Set(nodeIds);
          const affected = (board.drawings ?? []).filter((s) => s.anchor && idSet.has(s.anchor));
          if (affected.length === 0) return;
          const byId = new Map(board.nodes.map((n) => [n.id, n]));
          get().pushHistory();
          patchActive((b) => ({
            drawings: (b.drawings ?? []).map((s) => {
              if (!s.anchor || !idSet.has(s.anchor)) return s;
              const n = byId.get(s.anchor);
              // M335: Seitenstriche kommen in Kartenpunkten zurück — verdeckte (Seite nicht offen) bleiben, wie sie sind
              const rel = strichRelativ(s); // M339: Text-Striche dort, wo man sie gerade sieht
              if (s.seite != null && rel.length === 0) return s;
              const g = s.seitenBreite && s.anchor ? seiteVon(s.anchor) : undefined;
              return {
                ...s,
                width: g ? s.width * g.k : s.width,
                seitenBreite: undefined,
                anchor: undefined,
                seite: undefined,
                amText: undefined,
                block: undefined,
                blockY: undefined,
                points: n ? rel.map(([px, py]) => [px + n.position.x, py + n.position.y] as [number, number]) : rel,
              };
            }),
          }));
          get().showToast(affected.length === 1
            ? 'Markierung von der Karte gelöst – sie bleibt frei auf dem Board.'
            : `${affected.length} Markierungen von der Karte gelöst – sie bleiben frei auf dem Board.`);
        },

        // ---------- Undo/Redo (Board-Struktur) ----------
        past: [],
        future: [],

        pushHistory: () => {
          if (historyMuted) return; // Sammel-Aktionen (KI-Pläne) sichern EINEN Snapshot selbst
          lastEditKey = ''; // Struktur-Snapshot beendet jede Tipp-Bündelung (M122)
          const s = get();
          const b = s.boards.find((x) => x.id === s.activeId);
          if (!b) return;
          set({
            past: [...s.past.slice(-(HISTORY_LIMIT - 1)), { boardId: b.id, nodes: b.nodes, edges: b.edges, drawings: b.drawings, comments: b.comments }],
            future: [],
          });
        },

        pushHistoryBoards: (boardIds) => {
          if (historyMuted) return;
          lastEditKey = '';
          const s = get();
          const b = s.boards.find((x) => x.id === s.activeId);
          if (!b) return;
          const others = snapBoards(s.boards, [...new Set(boardIds)].filter((id) => id !== b.id));
          set({
            past: [...s.past.slice(-(HISTORY_LIMIT - 1)), {
              boardId: b.id, nodes: b.nodes, edges: b.edges, drawings: b.drawings, comments: b.comments, others,
            }],
            future: [],
          });
        },

        undo: () => ohneStempel(() => {
          const s = get();
          const entry = s.past[s.past.length - 1];
          if (!entry) return;
          const board = s.boards.find((b) => b.id === entry.boardId);
          if (!board) { set({ past: s.past.slice(0, -1) }); return; }
          // M365: Seit diesem Schritt kam Fremdes dazu → nur das Eigene zurücknehmen
          if (entry.nach || entry.fremd) { schrittGezielt(set, s, entry, 'zurueck'); return; }
          // Remount, wenn Notiz-Inhalte betroffen sind — egal woher der Eintrag
          // stammt (Versions-Restore, KI-Edit, Struktur-Undo über Tipp-Grenzen)
          const remount = entry.remount || notesDiffer(board.nodes, entry.nodes);
          // Mehr-Board-Schritt: alle Mitbetroffenen gemeinsam zurückdrehen
          const restore = new Map((entry.others ?? []).map((o) => [o.boardId, o]));
          // M388: Strg+Z beendet die Tipp-Bündelung (sonst sicherte die nächste Eingabe in dieselbe Karte keinen Schritt
          // und „Wiederholen" legte danach den alten Text über den neuen) — und das „zuletzt Gelöschte" ist mit dem
          // Zurücknehmen erledigt: Der Hinweis-Knopf legte es sonst ein zweites Mal aufs Board.
          lastEditKey = '';
          set({
            lastDeleted: null,
            past: s.past.slice(0, -1),
            future: [...s.future, {
              boardId: board.id, nodes: board.nodes, edges: board.edges, drawings: board.drawings, comments: board.comments, remount,
              others: snapBoards(s.boards, [...restore.keys()]),
            }],
            activeId: entry.boardId,
            view: 'board',
            boards: s.boards.map((b) => {
              if (b.id === entry.boardId) return { ...b, nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings, comments: kommentareNach(b.comments, entry.comments, b.nodes, entry.nodes) };
              const o = restore.get(b.id);
              return o ? { ...b, nodes: o.nodes, edges: o.edges, drawings: o.drawings, comments: kommentareNach(b.comments, o.comments, b.nodes, o.nodes) } : b;
            }),
            ...(remount ? { importEpoch: s.importEpoch + 1 } : {}),
          });
        }),

        // ---------- Trilium-Paket: Vorlagen ----------
        templates: [],

        saveTemplate: (node, name) => {
          // M390: Die 21. Vorlage verdrängte still die älteste. Jetzt gibt es Platz für 40 — und wenn er voll ist,
          // sagt es der Hinweis, statt etwas wegzunehmen.
          if (get().templates.length >= VORLAGEN_MAX) {
            get().showToast(`Es gibt schon ${VORLAGEN_MAX} Vorlagen – erst eine löschen (＋-Menü, ✕ an der Vorlage).`, false, 7000);
            return;
          }
          // M390: Die Vorlage bekommt eine eigene Kennung, und was im Gerätespeicher liegt (große Datei, Tool-
          // Quelltext), wird dorthin kopiert — vorher kam eine Datei- oder Tool-Karte aus der Vorlage leer an.
          const clean = JSON.parse(JSON.stringify({ ...node, id: uid(), selected: false })) as AppNode;
          anhaengeMitnehmen([node], new Map([[node.id, clean.id]]));
          set({ templates: [...get().templates, { id: uid(), name: name.trim().slice(0, 40) || 'Vorlage', node: clean }] });
          get().showToast(`Vorlage „${name}" gespeichert – im ＋-Menü unter „Vorlagen".`);
        },

        removeTemplate: (id) =>
          set({ templates: get().templates.filter((t) => t.id !== id) }),

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
            vorUmbauHaken.sichern(get().boards.filter((b) => kommt.has(b.id) && kommt.get(b.id) !== b && (!nimmt || nimmt.has(b.id))), sanft ? 'abgleich' : 'import');
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

        redo: () => ohneStempel(() => {
          const s = get();
          const entry = s.future[s.future.length - 1];
          if (!entry) return;
          const board = s.boards.find((b) => b.id === entry.boardId);
          if (!board) { set({ future: s.future.slice(0, -1) }); return; }
          if (entry.nach || entry.fremd) { schrittGezielt(set, s, entry, 'vor'); return; }
          const remount = entry.remount || notesDiffer(board.nodes, entry.nodes);
          const restore = new Map((entry.others ?? []).map((o) => [o.boardId, o]));
          lastEditKey = '';
          set({
            lastDeleted: null,
            future: s.future.slice(0, -1),
            past: [...s.past, {
              boardId: board.id, nodes: board.nodes, edges: board.edges, drawings: board.drawings, comments: board.comments, remount,
              others: snapBoards(s.boards, [...restore.keys()]),
            }],
            activeId: entry.boardId,
            view: 'board',
            boards: s.boards.map((b) => {
              if (b.id === entry.boardId) return { ...b, nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings, comments: kommentareNach(b.comments, entry.comments, b.nodes, entry.nodes) };
              const o = restore.get(b.id);
              return o ? { ...b, nodes: o.nodes, edges: o.edges, drawings: o.drawings, comments: kommentareNach(b.comments, o.comments, b.nodes, o.nodes) } : b;
            }),
            ...(remount ? { importEpoch: s.importEpoch + 1 } : {}),
          });
        }),

        setView: (view) => set({ view }),

        openBoard: (id) => {
          if (get().boards.some((b) => b.id === id)) set({ activeId: id, view: 'board' });
        },

        setSearchOpen: (open) => set({ searchOpen: open }),

        addSpace: (name) =>
          set({
            spaces: [
              ...get().spaces,
              { id: uid(), name: name ?? nextName(t('Neuer Bereich'), get().spaces.map((s) => s.name)), projects: [] },
            ],
          }),

        renameSpace: (id, name) =>
          set({ spaces: get().spaces.map((sp) => (sp.id === id ? { ...sp, name } : sp)) }),

        removeSpace: (id, mit) => ebeneLoeschen('bereich', id, mit),

        addProject: (spaceId, name) =>
          set({
            spaces: get().spaces.map((sp) =>
              sp.id === spaceId
                ? {
                    ...sp,
                    projects: [
                      ...sp.projects,
                      { id: uid(), name: name ?? nextName(t('Projekt'), sp.projects.map((p) => p.name)), boardIds: [] },
                    ],
                  }
                : sp,
            ),
          }),

        renameProject: (id, name) =>
          set({
            spaces: get().spaces.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) => (p.id === id ? { ...p, name } : p)),
            })),
          }),

        removeProject: (id, mit) => ebeneLoeschen('projekt', id, mit),

        ebeneZurueck: () => {
          const u = ebenenUndo;
          if (!u) return false;
          ebenenUndo = null;
          const s0 = get();
          let boards = s0.boards;
          // Das von selbst angelegte Startboard geht wieder, solange nichts darauf liegt
          const start = u.neuesBoard ? boards.find((b) => b.id === u.neuesBoard) : undefined;
          const startWeg = !!start && !start.nodes.length && !start.edges.length && !(start.drawings?.length);
          if (startWeg) boards = boards.filter((b) => b !== start);
          const da = new Set(boards.map((b) => b.id));
          boards = [...boards];
          for (const { board, index } of [...u.boards].sort((x, y) => x.index - y.index)) {
            if (!da.has(board.id)) boards.splice(Math.min(index, boards.length), 0, board);
          }
          // Was zur gelöschten Ebene gehörte, kommt aus den übrigen Projekten heraus – dann steht die Ebene wieder an ihrer Stelle
          const projekte = u.art === 'bereich' ? u.bereich.projects : [u.projekt!];
          const zurueck = new Set(projekte.flatMap((p) => p.boardIds));
          const projektIds = new Set(u.art === 'bereich' ? projekte.map((p) => p.id) : []);
          let spaces = s0.spaces.map((sp) => ({
            ...sp,
            projects: sp.projects
              .filter((p) => !projektIds.has(p.id))
              .map((p) => ({ ...p, boardIds: p.boardIds.filter((b) => !zurueck.has(b) && !(startWeg && b === u.neuesBoard)) }))
              .filter((p) => !(p.id === u.neuesProjekt && p.boardIds.length === 0)),
          }));
          if (u.art === 'bereich') {
            spaces.splice(Math.min(u.bereichIndex, spaces.length), 0, u.bereich);
          } else if (spaces.some((sp) => sp.id === u.bereich.id)) {
            spaces = spaces.map((sp) => {
              if (sp.id !== u.bereich.id) return sp;
              const projects = [...sp.projects];
              projects.splice(Math.min(u.projektIndex ?? projects.length, projects.length), 0, u.projekt!);
              return { ...sp, projects };
            });
          } else {
            spaces.splice(Math.min(u.bereichIndex, spaces.length), 0, { ...u.bereich, projects: [u.projekt!] });
          }
          const activeId = boards.some((b) => b.id === u.activeId) ? u.activeId
            : boards.some((b) => b.id === s0.activeId) ? s0.activeId : (boards.find((b) => !b.archived) ?? boards[0]).id;
          mutedHistory(() => set({ boards, spaces, activeId }));
          const name = u.art === 'bereich' ? u.bereich.name : u.projekt!.name;
          get().showToast(`„${name}" ist wieder da.`);
          return true;
        },

        addBoard: (name, projectId) => {
          const id = uid();
          const spaces = get().spaces;
          // Ziel: angegebenes Projekt, sonst das erste existierende (notfalls anlegen)
          let target = projectId && spaces.some((sp) => sp.projects.some((p) => p.id === projectId))
            ? projectId
            : undefined;
          let newSpaces = spaces;
          if (!target) {
            const first = spaces.flatMap((sp) => sp.projects)[0];
            if (first) {
              target = first.id;
            } else {
              const pid = uid();
              newSpaces = spaces.length
                ? spaces.map((sp, i) =>
                    i === 0
                      ? { ...sp, projects: [{ id: pid, name: t('Allgemein'), boardIds: [] }] }
                      : sp,
                  )
                : defaultHierarchy([]);
              target = newSpaces[0].projects[0]?.id ?? pid;
            }
          }
          const boards = [...get().boards, { id, name: name ?? nextName('Board', get().boards.map((b) => b.name)), nodes: [], edges: [] }];
          set({
            boards,
            spaces: sortiereProjekte(newSpaces.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) =>
                p.id === target ? { ...p, boardIds: [...p.boardIds, id] } : p,
              ),
            })), boards),
            activeId: id,
          });
          return id;
        },

        boardAusVorlage: (name, inhalt, wohin) => {
          const ziel = wohin?.inBoard ? get().boards.find((x) => x.id === wohin.inBoard) : undefined;
          const leer = !!ziel && !ziel.nodes.length && !ziel.edges.length && ziel.geteiltRolle !== 'lesen';
          let id: string;
          if (ziel && leer) {
            id = ziel.id;
            if (get().activeId !== id) set({ activeId: id });
            get().pushHistory();
            // Ein Board, das noch seinen Anfangsnamen trägt, heißt danach wie die Vorlage
            const unbenannt = istStartName(ziel.name) || /^Board( \d+)?$/.test(ohneVorsatz(ziel.name));
            const neuerName = unbenannt ? nextName(name, get().boards.map((x) => x.name)) : ziel.name;
            set({ boards: get().boards.map((x) => (x.id === id ? { ...x, name: neuerName, nodes: inhalt.nodes, edges: inhalt.edges } : x)) });
          } else {
            id = get().addBoard(nextName(name, get().boards.map((x) => x.name)), wohin?.projectId);
            set({ boards: get().boards.map((x) => (x.id === id ? { ...x, nodes: inhalt.nodes, edges: inhalt.edges } : x)) });
          }
          // Voll-Remount: Notizen lesen ihren Inhalt nur beim Mount
          set({ activeId: id, view: 'board', importEpoch: get().importEpoch + 1 });
          return id;
        },

        importBoard: (doc) => {
          // M370: Wer nichts Eigenes hat, sieht danach nur das Board, das er geöffnet hat
          const start = leeresStartboard(get().boards);
          // leeres Board über addBoard anlegen (kümmert sich um die Hierarchie) …
          const id = get().addBoard(doc.name);
          // … und mit dem geteilten Inhalt füllen
          const boards = get().boards.map((b) =>
            // M388: Kommentare und Hintergrund kamen nie an, obwohl cloneSharedBoard sie vorbereitet
            b.id === id ? { ...b, nodes: doc.nodes, edges: doc.edges, drawings: doc.drawings, ...(doc.comments?.length ? { comments: doc.comments } : {}), ...(doc.bg ? { bg: doc.bg } : {}) } : b,
          );
          set({
            ...(start ? ohneStartboard({ boards, spaces: get().spaces }, start.id) : { boards }),
            activeId: id,
            view: 'board',
          });
        },

        renameBoard: (id, name) => {
          // M390: [[Verknüpfungen]] gehen über den NAMEN. Nach dem Umbenennen zeigten sie ins Leere — der Klick legte
          // ein leeres Board mit dem alten Namen an. Die Texte ziehen jetzt mit, solange der alte Name eindeutig war.
          const alt = get().boards.find((b) => b.id === id)?.name ?? '';
          const eindeutig = !!alt && normalizeName(alt) !== normalizeName(name)
            && get().boards.filter((b) => normalizeName(b.name) === normalizeName(alt)).length === 1;
          const boards = get().boards.map((b) => {
            if (b.id === id) return { ...b, name };
            if (!eindeutig || b.geteiltVon) return b;
            let anders = false;
            const nodes = b.nodes.map((n) => {
              if (n.type !== 'note') return n;
              const neu = linksUmbenennen((n.data as { blocks?: unknown }).blocks, alt, name);
              if (!neu) return n;
              anders = true;
              return { ...n, data: { ...n.data, blocks: neu, extEpoch: (((n.data as { extEpoch?: number }).extEpoch) ?? 0) + 1 } } as AppNode;
            });
            return anders ? { ...b, nodes } : b;
          }).map((b) => {
            // … auch im umbenannten Board selbst (Notizen, die auf ihr eigenes Board zeigen)
            if (b.id !== id || !eindeutig) return b;
            let anders = false;
            const nodes = b.nodes.map((n) => {
              if (n.type !== 'note') return n;
              const neu = linksUmbenennen((n.data as { blocks?: unknown }).blocks, alt, name);
              if (!neu) return n;
              anders = true;
              return { ...n, data: { ...n.data, blocks: neu, extEpoch: (((n.data as { extEpoch?: number }).extEpoch) ?? 0) + 1 } } as AppNode;
            });
            return anders ? { ...b, nodes } : b;
          });
          // M310: Ein alphabetisch sortiertes Projekt rückt das Board an seinen neuen Platz
          set({ boards, spaces: sortiereProjekte(get().spaces, boards) });
        },

        removeBoard: (id) => {
          const boards = get().boards;
          if (boards.length <= 1) {
            get().showToast('Das letzte Board bleibt offen');
            return;
          }
          const rest = boards.filter((b) => b.id !== id);
          // M390: Archivierte Boards zählen nicht als Arbeitsfläche. Vorher sprang die Ansicht nach dem Löschen auf
          // ein archiviertes Board, und das letzte SICHTBARE ließ sich löschen (beim Archivieren war das verboten).
          const weg = boards.find((b) => b.id === id);
          if (weg && !weg.archived && !rest.some((b) => !b.archived)) {
            get().showToast('Das letzte Board bleibt offen');
            return;
          }
          let activeId = get().activeId;
          if (activeId === id) {
            const projekt = get().spaces.flatMap((sp) => sp.projects).find((p) => p.boardIds.includes(id));
            activeId = projekt?.boardIds.find((x) => x !== id && rest.some((b) => b.id === x && !b.archived))
              ?? rest.find((b) => !b.archived)?.id ?? rest[0].id;
          }
          set({
            boards: rest,
            spaces: stripBoardFromHierarchy(get().spaces, id),
            activeId,
          });
        },

        moveBoard: (boardId, targetProjectId, beforeBoardId) => {
          // Geister-Boards verhindern: Ziel muss existieren, sonst no-op
          const targetExists = get().spaces.some((sp) => sp.projects.some((p) => p.id === targetProjectId));
          if (!targetExists) return;
          const stripped = stripBoardFromHierarchy(get().spaces, boardId);
          set({
            spaces: sortiereProjekte(stripped.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) => {
                if (p.id !== targetProjectId) return p;
                const ids = [...p.boardIds];
                const at = beforeBoardId ? ids.indexOf(beforeBoardId) : -1;
                if (at >= 0) ids.splice(at, 0, boardId);
                else ids.push(boardId);
                return { ...p, boardIds: ids };
              }),
            })), get().boards),
          });
        },

        setProjektSortierung: (projectId, art) => {
          const spaces = get().spaces.map((sp) => ({
            ...sp,
            projects: sp.projects.map((p) => (p.id === projectId
              ? { ...p, sortierung: art === 'manuell' ? undefined : art }
              : p)),
          }));
          set({ spaces: sortiereProjekte(spaces, get().boards) });
        },

        duplicateBoard: (boardId) => {
          const st = get();
          const quelle = st.boards.find((b) => b.id === boardId);
          if (!quelle) return;
          const neueId = () => Math.random().toString(36).slice(2, 10);
          /* Kennungen neu vergeben und die Pfeile mitziehen — sonst zeigten
             die Verbindungen der Kopie auf die Karten des Originals. */
          const karte = new Map(quelle.nodes.map((n) => [n.id, neueId()]));
          const nodes = quelle.nodes.map((n) => ({
            ...JSON.parse(JSON.stringify(n)),
            id: karte.get(n.id) as string,
            selected: false,
          }));
          const edges = (quelle.edges ?? [])
            .filter((e) => karte.has(e.source) && karte.has(e.target))
            .map((e) => ({
              ...e,
              id: neueId(),
              source: karte.get(e.source) as string,
              target: karte.get(e.target) as string,
            }));
          const drawings = (quelle.drawings ?? []).map((d) => ({
            ...JSON.parse(JSON.stringify(d)),
            id: neueId(),
            anchor: d.anchor ? karte.get(d.anchor) : undefined,
          }));
          // M360: Die Kopie eines geteilten Boards gehört mir — ohne Besitzer-Kennung und ohne Leseschutz
          const { geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, ...eigen } = quelle;
          const kopie = {
            ...eigen, id: neueId(), name: `${quelle.name} (Kopie)`,
            nodes, edges, drawings, comments: [],
          };
          const boards = [...st.boards, kopie];
          anhaengeMitnehmen(quelle.nodes, karte);
          // M360: Die Kopie eines fremden Boards gehört nicht unter „Geteilt mit mir" — sie kommt ins erste eigene Projekt und geht auf
          const eigenes = quelle.geteiltVon ? st.spaces.filter((sp) => sp.id !== 'geteilt').flatMap((sp) => sp.projects)[0] : undefined;
          set({
            boards,
            spaces: sortiereProjekte(st.spaces.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) => (eigenes
                ? (p.id === eigenes.id ? { ...p, boardIds: [...p.boardIds, kopie.id] } : p)
                : p.boardIds.includes(boardId)
                  ? { ...p, boardIds: p.boardIds.flatMap((id) => (id === boardId ? [id, kopie.id] : [id])) }
                  : p)),
            })), boards),
          });
          if (eigenes) {
            get().openBoard(kopie.id);
            get().showToast(`Kopie von „${quelle.name}" angelegt – sie gehört dir und liegt in „${eigenes.name}".`, false, 6000);
            return;
          }
          get().showToast(`Board „${quelle.name}" kopiert – die Kopie liegt daneben.`);
        },

        standEinsetzen: (boardId, stand, alsKopie) => {
          const st = get();
          const quelle = st.boards.find((b) => b.id === boardId);
          if (!quelle || !Array.isArray(stand?.nodes) || !Array.isArray(stand?.edges)) return null;
          if (alsKopie === undefined) {
            if (quelle.geteiltRolle === 'lesen') { st.showToast('Dieses Board ist nur zum Lesen freigegeben – als Kopie öffnen geht.'); return null; }
            lastEditKey = '';
            set({
              activeId: boardId,
              view: 'board',
              lastDeleted: null,
              past: [...st.past.slice(-(HISTORY_LIMIT - 1)), {
                boardId, nodes: quelle.nodes, edges: quelle.edges, drawings: quelle.drawings, comments: quelle.comments, remount: true,
              }],
              future: [],
              boards: st.boards.map((b) => (b.id === boardId
                ? { ...b, nodes: stand.nodes, edges: stand.edges, drawings: stand.drawings ?? [], comments: stand.comments ?? b.comments }
                : b)),
              // Notiz-Editoren lesen ihren Text nur beim Aufbau — sonst zeigten sie den alten Inhalt
              importEpoch: st.importEpoch + 1,
            });
            return boardId;
          }
          // Als Kopie: frische Kennungen (wie duplicateBoard), Pfeile, Rahmen-Kinder und Striche ziehen mit
          const karte = new Map(stand.nodes.map((n) => [n.id, uid()]));
          const nodes = stand.nodes.map((n) => {
            const k = { ...JSON.parse(JSON.stringify(n)), id: karte.get(n.id) as string, selected: false } as AppNode;
            if (n.parentId && karte.has(n.parentId)) (k as { parentId?: string }).parentId = karte.get(n.parentId);
            return k;
          });
          const edges = stand.edges.filter((e) => karte.has(e.source) && karte.has(e.target))
            .map((e) => ({ ...e, id: uid(), source: karte.get(e.source) as string, target: karte.get(e.target) as string, selected: false }));
          const drawings = (stand.drawings ?? []).map((d) => ({ ...JSON.parse(JSON.stringify(d)), id: uid(), anchor: d.anchor ? karte.get(d.anchor) : undefined }));
          const { geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, archived: _a, ...eigen } = quelle;
          const kopie: BoardDoc = { ...eigen, id: uid(), name: alsKopie.slice(0, 80) || `${quelle.name} (Stand)`, nodes, edges, drawings, comments: [] };
          anhaengeMitnehmen(stand.nodes, karte);
          const boards = [...st.boards, kopie];
          const eigenes = quelle.geteiltVon ? st.spaces.filter((sp) => sp.id !== 'geteilt').flatMap((sp) => sp.projects)[0] : undefined;
          set({
            boards,
            spaces: sortiereProjekte(st.spaces.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) => (eigenes
                ? (p.id === eigenes.id ? { ...p, boardIds: [...p.boardIds, kopie.id] } : p)
                : p.boardIds.includes(boardId)
                  ? { ...p, boardIds: p.boardIds.flatMap((id) => (id === boardId ? [id, kopie.id] : [id])) }
                  : p)),
            })), boards),
          });
          get().openBoard(kopie.id);
          return kopie.id;
        },
        duplicateProject: (projectId) => {
          const st = get();
          const raum = st.spaces.find((sp) => sp.projects.some((p) => p.id === projectId));
          const projekt = raum?.projects.find((p) => p.id === projectId);
          if (!raum || !projekt) return;
          const neueId = () => Math.random().toString(36).slice(2, 10);
          const neueBoards: BoardDoc[] = [];
          const ids: string[] = [];
          const boardKarte = new Map<string, string>();   // M390: Original-Board → Kopie (für die Portale)
          for (const bid of projekt.boardIds) {
            const quelle = st.boards.find((b) => b.id === bid);
            if (!quelle) continue;
            const karte = new Map(quelle.nodes.map((n) => [n.id, neueId()]));
            const { geteiltVon: _g, geteiltVonName: _n, geteiltRolle: _r, gastLink: _l, ...eigen } = quelle; // M360: Kopien gehören mir
            const kopie: BoardDoc = {
              ...eigen, id: neueId(), name: quelle.name,
              nodes: quelle.nodes.map((n) => ({ ...JSON.parse(JSON.stringify(n)), id: karte.get(n.id) as string, selected: false })),
              edges: (quelle.edges ?? [])
                .filter((e) => karte.has(e.source) && karte.has(e.target))
                .map((e) => ({ ...e, id: neueId(), source: karte.get(e.source) as string, target: karte.get(e.target) as string })),
              drawings: (quelle.drawings ?? []).map((d) => ({ ...JSON.parse(JSON.stringify(d)), id: neueId(), anchor: d.anchor ? karte.get(d.anchor) : undefined })),
              comments: [],
            };
            neueBoards.push(kopie);
            ids.push(kopie.id);
            boardKarte.set(quelle.id, kopie.id);
            anhaengeMitnehmen(quelle.nodes, karte);
          }
          // M390: Portale ZWISCHEN den kopierten Boards zeigen auf die Kopien. Vorher führte das Portal in der Kopie
          // von „Planung" ins ORIGINAL-„Ziel" — wer in der Kopie weiterarbeitete, landete unbemerkt im alten Projekt.
          for (const b of neueBoards) {
            b.nodes = b.nodes.map((n) => {
              const z = (n.data as { boardId?: string }).boardId;
              return n.type === 'portal' && z && boardKarte.has(z) ? ({ ...n, data: { ...n.data, boardId: boardKarte.get(z) } } as AppNode) : n;
            });
          }
          set({
            boards: [...st.boards, ...neueBoards],
            spaces: st.spaces.map((sp) => (sp.id === raum.id
              ? {
                ...sp,
                projects: sp.projects.flatMap((p) => (p.id === projectId
                  ? [p, { id: neueId(), name: `${p.name} (Kopie)`, boardIds: ids, sortierung: p.sortierung }]
                  : [p])),
              }
              : sp)),
          });
          get().showToast(`Projekt „${projekt.name}" mit ${ids.length} Board(s) kopiert.`);
        },

        archiveBoard: (boardId, an = true) => {
          const st = get();
          const board = st.boards.find((b) => b.id === boardId);
          if (!board) return;
          const boards = st.boards.map((b) => (b.id === boardId ? { ...b, archived: an } : b));
          /* Beim Archivieren des aktiven Boards weiterziehen — bevorzugt ins
             gleiche Projekt, sonst irgendein sichtbares Board. */
          let activeId = st.activeId;
          if (an && st.activeId === boardId) {
            const projekt = st.spaces.flatMap((sp) => sp.projects).find((p) => p.boardIds.includes(boardId));
            const nachbar = projekt?.boardIds.find((id) => id !== boardId && boards.some((b) => b.id === id && !b.archived))
              ?? boards.find((b) => b.id !== boardId && !b.archived)?.id;
            if (nachbar) activeId = nachbar;
            else {
              // Das LETZTE sichtbare Board bleibt sichtbar — sonst stünde die
              // Anwendung ohne Arbeitsfläche da (dieselbe Regel wie beim Löschen)
              get().showToast('Das letzte Board bleibt offen');
              return;
            }
          }
          set({ boards, activeId });
          get().showToast(an
            ? `Board „${board.name}" archiviert. Wiederfinden: Mehr → „Archiv einblenden".`
            : `Board „${board.name}" zurückgeholt.`);
        },

        onNodesChange: (changes) => {
          // Entfernen-Änderungen (Entf-Taste) durch die Undo-Logik schleusen
          const removeIds = changes
            .filter((c): c is Extract<NodeChange, { type: 'remove' }> => c.type === 'remove')
            .map((c) => c.id);
          const rest = changes.filter((c) => c.type !== 'remove');
          if (rest.length) {
            // Maß-/Auswahl-Änderungen schreibt React Flow schon beim Mount in
            // den Store — das ist Mechanik, keine Bearbeitung, und darf das
            // automatische Übernehmen eines Sync-Stands nicht blockieren
            const mechanical = rest.every((c) => c.type === 'dimensions' || c.type === 'select');
            const apply = () => patchActive((b) => ({ nodes: applyNodeChanges(rest, b.nodes) as AppNode[] }));
            if (mechanical) runDerived(apply); else apply();
          }
          if (removeIds.length) get().removeNodes(removeIds);
        },

        onEdgesChange: (changes) => {
          // Kantenlöschung (Entf-Taste) muss undo-fähig sein — wie bei Nodes (Audit R6-S2)
          if (changes.some((c) => c.type === 'remove')) get().pushHistory();
          patchActive((b) => ({ edges: applyEdgeChanges(changes, b.edges) }));
        },

        onConnect: (connection) => {
          get().pushHistory();
          patchActive((b) => ({
            edges: addEdge({ ...connection, type: 'labeled', data: { label: '', kind: 'arrow' } }, b.edges),
          }));
          // M169: Verbindungen sind Daten-Abos — beim Andocken an ein
          // Sammel-Modul einmal kurz erklären, was jetzt automatisch passiert
          const b = get().boards.find((x) => x.id === get().activeId);
          const t1 = b?.nodes.find((n) => n.id === connection.source)?.type;
          const t2 = b?.nodes.find((n) => n.id === connection.target)?.type;
          const src = new Set(['note', 'kanban', 'gantt']);
          const pair = (consumer: string, sources: Set<string> | string = src) =>
            (t1 === consumer && (typeof sources === 'string' ? t2 === sources : sources.has(t2 ?? '')))
            || (t2 === consumer && (typeof sources === 'string' ? t1 === sources : sources.has(t1 ?? '')));
          if ((t1 === 'kanban' && t2 === 'gantt') || (t1 === 'gantt' && t2 === 'kanban')) {
            get().showToast('Verbunden: Fristen werden Meilensteine, Vorgänge werden Tickets.');
          } else if (pair('kanban')) {
            get().showToast('Verbunden: Offene Punkte der Karte landen als Tickets im Kanban.');
          } else if (pair('calendar')) {
            get().showToast('Verbunden: Der Kalender zeigt Termine und Fristen der Karte.');
          } else if (pair('time', 'week')) {
            get().showToast('Verbunden: Der Wochenplan liefert die Sollzeit für die Zeiterfassung.');
          } else if (pair('time', 'note') || pair('time', 'kanban')) {
            get().showToast('Verbunden: Die Karte zeigt die Arbeitszeit aus der Zeiterfassung.');
          } else if (pair('mermaid', 'note')) {
            get().showToast('Verbunden: Das Diagramm folgt der Checkliste der Notiz.');
          } else if (pair('note', 'htmlapp')) {
            get().showToast('Verbunden: Die Notiz zeigt den Speicherstand der App.');
          }
        },

        addLabeledEdge: (source, target, label, kind = 'arrow') => {
          get().pushHistory();
          patchActive((b) => ({
            edges: addEdge(
              { id: `e-${uid()}`, source, target, type: 'labeled', data: { label, kind } },
              b.edges,
            ),
          }));
        },

        // ---------- Kommentar-Pins (M148) ----------
        commentOpen: null,
        commentOrt: null,
        setCommentOpen: (id, ort) => set({ commentOpen: id, commentOrt: ort ?? null }),
        lookup: null,
        setLookup: (q) => set({ lookup: q }),

        addCommentMsg: (target, author, text) => {
          const msg = { author: author.trim().slice(0, 40) || 'Anonym', text: text.trim(), at: new Date().toISOString() };
          if (!msg.text) return null;
          let threadId: string | null = null;
          patchActive((b) => {
            const comments = [...(b.comments ?? [])];
            if (target.threadId) {
              const i = comments.findIndex((c) => c.id === target.threadId);
              if (i < 0) return {};
              threadId = target.threadId;
              comments[i] = { ...comments[i], resolved: false, msgs: [...comments[i].msgs, msg] };
            } else if (target.nodeId) {
              threadId = uid();
              let ort: { seite: number; px: number; py: number } | Record<string, never> = target.seite != null && target.px != null && target.py != null
                ? { seite: target.seite, px: target.px, py: target.py } : {};
              // M336: Liegt die Karte als PDF-Seite offen, gehört auch ein Kommentar ohne Stelle zu DIESER
              // Seite — am rechten Rand, untereinander gestapelt, damit er beim Blättern mitgeht
              const g = !('seite' in ort) ? offeneSeite(target.nodeId) : undefined;
              if (g) {
                const dort = comments.filter((c) => c.nodeId === target.nodeId && c.seite === g.seite).length;
                ort = { seite: g.seite, px: Math.round(g.breite - 40), py: Math.round(Math.min(g.hoehe - 30, 36 + dort * 34)) };
              }
              comments.push({ id: threadId, nodeId: target.nodeId, ...ort, msgs: [msg] });
            }
            return { comments };
          });
          return threadId;
        },

        editCommentMsg: (threadId, at, author, text) => {
          const neu = text.trim();
          if (!neu) return;
          patchActive((b) => {
            const alt = (b.comments ?? []).find((c) => c.id === threadId)?.msgs.find((m) => m.at === at && m.author === author);
            if (!alt || alt.text === neu) return {};
            return {
              comments: (b.comments ?? []).map((c) => (c.id === threadId
                ? { ...c, msgs: c.msgs.map((m) => (m === alt ? { ...m, text: neu, bearbeitet: new Date().toISOString() } : m)) }
                : c)),
            };
          });
        },

        removeCommentMsg: (threadId, at, author) => {
          const thread = (selectActiveBoard(get()).comments ?? []).find((c) => c.id === threadId);
          if (!thread) return;
          const rest = thread.msgs.filter((m) => !(m.at === at && m.author === author));
          if (rest.length === thread.msgs.length) return;
          if (rest.length === 0) { get().removeCommentThread(threadId); return; }
          patchActive((b) => ({ comments: (b.comments ?? []).map((c) => (c.id === threadId ? { ...c, msgs: rest } : c)) }));
        },

        toggleCommentResolved: (threadId) =>
          patchActive((b) => ({
            comments: (b.comments ?? []).map((c) => (c.id === threadId ? { ...c, resolved: !c.resolved } : c)),
          })),

        removeCommentThread: (threadId) => {
          patchActive((b) => ({ comments: (b.comments ?? []).filter((c) => c.id !== threadId) }));
          set({ commentOpen: null });
        },

        /**
         * M390: Ein eigener Rückgängig-Schritt für Änderungen, die bisher keinen hatten (Etikett, Art und Aussehen
         * einer Verbindung, Größe ziehen, mit Pfeiltasten schieben). Ohne ihn nahm Strg+Z den Schritt DAVOR mit
         * zurück. Gebündelt wie beim Tippen: Dieselbe Sache innerhalb kurzer Zeit ist EIN Schritt.
         */
        schritt: (key) => {
          if (historyMuted || inDerived()) return;
          const now = Date.now();
          const k = `${get().activeId}:${key}`;
          const neu = k !== lastEditKey || now - lastEditAt > EDIT_COALESCE_MS;
          if (neu) get().pushHistory();
          lastEditKey = k;
          lastEditAt = now;
        },

        verschiebeUm: (ids, dx, dy) => {
          const b = selectActiveBoard(get());
          const wahl = new Set(ids);
          const rahmen = b.nodes.filter((n) => wahl.has(n.id) && n.type === 'frame');
          // Rahmen nehmen ihren Inhalt mit — auch per Tastatur
          for (const f of rahmen) for (const m of frameMembers(f, b.nodes, true, true)) wahl.add(m.id);
          get().schritt(`pfeil:${[...ids].sort().join(',')}`);
          patchActive((bb) => ({
            nodes: bb.nodes.map((n) => (wahl.has(n.id) ? ({ ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } as AppNode) : n)),
          }));
        },

        updateEdgeLabel: (id, label) => {
          get().schritt(`kante:${id}:etikett`);
          patchActive((b) => ({
            edges: b.edges.map((e) =>
              e.id === id ? { ...e, data: { ...e.data, label } } : e,
            ),
          }));
        },

        updateEdgeKind: (id, kind) => {
          get().schritt(`kante:${id}:art`);
          patchActive((b) => ({
            edges: b.edges.map((e) =>
              e.id === id ? { ...e, data: { ...e.data, kind } } : e,
            ),
          }));
        },

        updateEdgeStyle: (id, patch) => {
          get().schritt(`kante:${id}:stil`);
          patchActive((b) => ({
            edges: b.edges.map((e) => {
              if (e.id !== id) return e;
              const data: Record<string, unknown> = { ...e.data };
              if (patch.head !== undefined) data.head = patch.head;
              if (patch.headStart !== undefined) data.headStart = patch.headStart;
              if (patch.shape !== undefined) data.shape = patch.shape;
              if (patch.width !== undefined) data.width = patch.width;
              if (patch.color !== undefined) {
                // null = zurück zur Standardfarbe (Schlüssel ganz entfernen)
                if (patch.color === null) delete data.color;
                else data.color = patch.color;
              }
              return { ...e, data };
            }),
          }));
        },

        removeEdge: (id) => {
          get().pushHistory();
          patchActive((b) => ({ edges: b.edges.filter((e) => e.id !== id) }));
        },

        addNode: (node) => {
          get().pushHistory();
          patchActive((b) => ({ nodes: [...b.nodes, frisch(node)] }));
        },

        dupliziere: (ids) => {
          // M390: EIN Schritt für alle gewählten Karten (vorher je Karte einer — Strg+Z ließ Kopien zurück), die
          // Verbindungen ZWISCHEN den Kopierten kommen mit, große Dateien und Tool-Quelltexte ebenfalls, und die
          // Kopien landen nie deckungsgleich auf einer früheren Kopie.
          const b = selectActiveBoard(get());
          const wahl = b.nodes.filter((n) => ids.includes(n.id));
          if (!wahl.length) return 0;
          let k = 1;
          const belegt = (kk: number) => wahl.some((n) => b.nodes.some((x) => x.type === n.type && Math.abs(x.position.x - (n.position.x + 30 * kk)) < 2 && Math.abs(x.position.y - (n.position.y + 30 * kk)) < 2));
          while (k < 40 && belegt(k)) k += 1;
          const karte = new Map(wahl.map((n) => [n.id, uid()]));
          const neu = wahl.map((n) => frisch({
            ...n, id: karte.get(n.id) as string, selected: true,
            position: { x: n.position.x + 30 * k, y: n.position.y + 30 * k },
            data: JSON.parse(JSON.stringify(n.data)),
          }) as AppNode);
          const kanten = b.edges.filter((e) => karte.has(e.source) && karte.has(e.target))
            .map((e) => ({ ...e, id: uid(), source: karte.get(e.source) as string, target: karte.get(e.target) as string, selected: false }));
          get().pushHistory();
          patchActive((bb) => ({
            nodes: [...bb.nodes.map((n) => (n.selected ? ({ ...n, selected: false } as AppNode) : n)), ...neu],
            edges: [...bb.edges, ...kanten],
          }));
          anhaengeMitnehmen(wahl, karte);
          return neu.length;
        },

        addNodeToBoard: (boardId, node) => {
          // M388: gesichert wird das ZIEL-Board (wie bei updateNodeDataOnBoard) — vorher das gerade offene: Ein
          // Schnelleintrag aus der Aufgaben-Zentrale auf ein anderes Board ließ sich nicht zurücknehmen.
          const s0 = get();
          const ziel = s0.boards.find((b) => b.id === boardId);
          if (!ziel) return;
          if (!historyMuted) {
            lastEditKey = '';
            set({ past: [...s0.past.slice(-(HISTORY_LIMIT - 1)), { boardId: ziel.id, nodes: ziel.nodes, edges: ziel.edges, drawings: ziel.drawings, comments: ziel.comments }], future: [] });
          }
          set({
            boards: get().boards.map((b) =>
              b.id === boardId ? { ...b, nodes: [...b.nodes, frisch(node)] } : b),
          });
        },

        /**
         * M262: Portal-Ziel wählen — und drüben den Rückverweis anlegen.
         *
         * Beide Änderungen liegen in EINEM Undo-Schritt (pushHistoryBoards):
         * Ein Portal ist eine Beziehung, kein Objekt auf einem Board; sie in
         * zwei Schritten zurückzunehmen hieße, kurzzeitig eine halbe Beziehung
         * zu haben.
         */
        portalZielSetzen: (nodeId, zielBoardId) => {
          const s = get();
          const quelle = s.boards.find((b) => b.id === s.activeId);
          const ziel = s.boards.find((b) => b.id === zielBoardId);
          if (!quelle || !ziel) return;
          const rueck = baueRueckverweis(ziel, quelle.id);
          get().pushHistoryBoards([zielBoardId]);
          set({
            boards: get().boards.map((b) => {
              if (b.id === quelle.id) {
                return { ...b, nodes: b.nodes.map((n) => (n.id === nodeId
                  ? ({ ...n, data: { ...n.data, boardId: zielBoardId } } as AppNode) : n)) };
              }
              if (b.id === ziel.id && rueck) return { ...b, nodes: [...b.nodes, rueck] };
              return b;
            }),
          });
          get().showToast(rueck
            ? `Portal zu „${ziel.name}" – und dort liegt jetzt ein Rückverweis auf „${quelle.name}". Strg+Z macht beides rückgängig.`
            : `Portal zu „${ziel.name}" – von dort führt bereits ein Portal zurück.`);
        },

        portalAnlegen: (quellBoardId, zielBoardId, position) => {
          const s = get();
          const quelle = s.boards.find((b) => b.id === quellBoardId);
          const ziel = s.boards.find((b) => b.id === zielBoardId);
          if (!quelle || !ziel || quelle.id === ziel.id) return;
          const wunsch = position ?? { x: 80, y: 80 };
          const hin: AppNode = {
            id: uid(), type: 'portal', width: 200,
            position: findFreeSpot(quelle.nodes, wunsch, { w: 200, h: 140 }),
            data: { boardId: zielBoardId },
          };
          const rueck = baueRueckverweis(ziel, quelle.id);
          get().pushHistoryBoards([quellBoardId, zielBoardId]);
          set({
            boards: get().boards.map((b) => {
              if (b.id === quelle.id) return { ...b, nodes: [...b.nodes, hin] };
              if (b.id === ziel.id && rueck) return { ...b, nodes: [...b.nodes, rueck] };
              return b;
            }),
          });
          get().showToast(rueck
            ? `Portal „${quelle.name}" ⇄ „${ziel.name}" – auf beiden Boards liegt jetzt eine Karte. Strg+Z macht beides rückgängig.`
            : `Portal „${quelle.name}" → „${ziel.name}" – zurück führte schon eines. Strg+Z macht es rückgängig.`);
        },

        rueckverweisNachtragen: (quellBoardId, zielBoardId) => {
          const s = get();
          const quelle = s.boards.find((b) => b.id === quellBoardId);
          const ziel = s.boards.find((b) => b.id === zielBoardId);
          if (!quelle || !ziel) return;
          const rueck = baueRueckverweis(ziel, quelle.id);
          if (!rueck) { get().showToast(`„${ziel.name}" verweist bereits zurück.`); return; }
          get().pushHistoryBoards([zielBoardId]);
          set({
            boards: get().boards.map((b) => (b.id === ziel.id ? { ...b, nodes: [...b.nodes, rueck] } : b)),
          });
          get().showToast(`„${ziel.name}" verweist jetzt auf „${quelle.name}" zurück. Strg+Z macht es rückgängig.`);
        },

        removeNode: (id) => get().removeNodes([id]),

        removeNodes: (ids) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board) return;
          const idSet = new Set(ids);
          const removedNodes = board.nodes.filter((n) => idSet.has(n.id));
          const removedEdges = board.edges.filter((e) => idSet.has(e.source) || idSet.has(e.target));
          if (removedNodes.length === 0) return;
          // Geankerte Markierungen gehören zur Karte — sie gehen (undo-fähig) mit
          const removedDrawings = (board.drawings ?? []).filter((s) => s.anchor && idSet.has(s.anchor));
          const removedComments = (board.comments ?? []).filter((c) => idSet.has(c.nodeId));
          get().pushHistory();
          patchActive((b) => ({
            nodes: b.nodes.filter((n) => !idSet.has(n.id)),
            edges: b.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
            drawings: (b.drawings ?? []).filter((s) => !s.anchor || !idSet.has(s.anchor)),
            // Kommentar-Pins hängen an der Karte — mit ihr verschwinden sie (M148)
            comments: (b.comments ?? []).filter((c) => !idSet.has(c.nodeId)),
          }));
          set({ lastDeleted: { boardId: board.id, nodes: removedNodes, edges: removedEdges, drawings: removedDrawings, comments: removedComments } });
          get().showToast(
            removedNodes.length === 1 ? 'Karte gelöscht' : `${removedNodes.length} Karten gelöscht`,
            true,
          );
        },

        moveNodesToBoard: (ids, targetBoardId) => {
          const s = get();
          const src = s.boards.find((b) => b.id === s.activeId);
          const tgt = s.boards.find((b) => b.id === targetBoardId);
          if (!src || !tgt || src.id === tgt.id) return;
          const idSet = new Set(ids);
          // Rahmen nehmen ihre Mitglieder mit (dieselbe Regel wie beim Ziehen)
          for (const n of src.nodes) {
            if (n.type === 'frame' && idSet.has(n.id)) {
              for (const m of frameMembers(n, src.nodes, true)) idSet.add(m.id);
            }
          }
          const moving = src.nodes.filter((n) => idSet.has(n.id));
          if (moving.length === 0) return;

          // EIN Undo-Schritt für BEIDE Boards (HistoryEntry.others)
          lastEditKey = '';
          set({
            lastDeleted: null,   // M388: der Hinweis-Knopf gehört jetzt diesem Schritt, nicht einem früheren Löschen
            past: [...s.past.slice(-(HISTORY_LIMIT - 1)), {
              boardId: src.id, nodes: src.nodes, edges: src.edges, drawings: src.drawings, comments: src.comments,
              others: snapBoards(s.boards, [tgt.id]),
            }],
            future: [],
          });

          // Freie Stelle im Ziel suchen — die RELATIVE Anordnung der Gruppe bleibt
          const minX = Math.min(...moving.map((n) => n.position.x));
          const minY = Math.min(...moving.map((n) => n.position.y));
          const maxX = Math.max(...moving.map((n) => n.position.x + (n.width ?? n.measured?.width ?? 260)));
          const maxY = Math.max(...moving.map((n) => n.position.y + (n.height ?? n.measured?.height ?? 160)));
          const spot = findFreeSpot(tgt.nodes, { x: minX, y: minY }, { w: maxX - minX, h: maxY - minY });
          const dx = spot.x - minX;
          const dy = spot.y - minY;

          const movedNodes = moving.map((n) => ({
            ...n,
            selected: false,
            position: { x: n.position.x + dx, y: n.position.y + dy },
          }) as AppNode);
          // Nur Verbindungen, deren BEIDE Enden mitwandern — Misch-Kanten entfallen
          const movedEdges = src.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
          // Geankerte Striche sind RELATIV zur Karte (M127) — wandern unverändert mit
          const movedDrawings = (src.drawings ?? []).filter((d) => d.anchor && idSet.has(d.anchor));
          const movedComments = (src.comments ?? []).filter((c) => idSet.has(c.nodeId));

          set({
            boards: get().boards.map((b) => {
              if (b.id === src.id) {
                return {
                  ...b,
                  nodes: b.nodes.filter((n) => !idSet.has(n.id)),
                  edges: b.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
                  drawings: (b.drawings ?? []).filter((d) => !d.anchor || !idSet.has(d.anchor)),
                  comments: (b.comments ?? []).filter((c) => !idSet.has(c.nodeId)),
                };
              }
              if (b.id === tgt.id) {
                return {
                  ...b,
                  nodes: [...b.nodes, ...movedNodes],
                  edges: [...b.edges, ...movedEdges],
                  drawings: [...(b.drawings ?? []), ...movedDrawings],
                  comments: [...(b.comments ?? []), ...movedComments],
                };
              }
              return b;
            }),
          });
          get().showToast(
            `${moving.length === 1 ? 'Karte' : `${moving.length} Karten`} nach „${tgt.name}" verschoben – Strg+Z holt alles zurück.`,
            'schritt',   // M388: „Rückgängig" nimmt das Verschieben zurück (vorher: stellte irgendein früher Gelöschtes wieder her)
          );
        },

        touchNode: (id) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          const node = board?.nodes.find((n) => n.id === id);
          if (!board || !node) return;
          if (node.type === 'frame') return; // Rahmen bleiben IMMER Hintergrund (M149)
          // zIndex statt Array-Umsortierung: das DOM-Element bleibt an Ort und
          // Stelle, sonst verlöre der Notiz-Editor beim Anklicken den Fokus.
          // Kein pushHistory — das Anfassen ist eine implizite Geste, kein Edit.
          const maxZ = Math.max(0, ...board.nodes.map((n) => n.zIndex ?? 0));
          const alreadyTop = (node.zIndex ?? 0) === maxZ
            && board.nodes.filter((n) => (n.zIndex ?? 0) === maxZ).length === 1;
          if (alreadyTop) return;
          patchActive((b) => ({
            nodes: b.nodes.map((n) => (n.id === id ? ({ ...n, zIndex: maxZ + 1 }) as AppNode : n)),
          }));
        },

        restoreDeleted: () => {
          const snap = get().lastDeleted;
          if (!snap) return;
          if (!get().boards.some((b) => b.id === snap.boardId)) {
            set({ lastDeleted: null });
            get().showToast('Das Board dieser Karten existiert nicht mehr.');
            return;
          }
          // M388: nur, was nicht (wieder) da ist — nach Strg+Z lag die Karte sonst doppelt, mit derselben Kennung
          const ziel = get().boards.find((b) => b.id === snap.boardId)!;
          const fehlt = <T extends { id: string }>(da: T[] | undefined, neu: T[] | undefined): T[] => { const ids = new Set((da ?? []).map((x) => x.id)); return (neu ?? []).filter((x) => !ids.has(x.id)); };
          const nodes = fehlt(ziel.nodes, snap.nodes);
          if (nodes.length === 0) { set({ lastDeleted: null }); return; }
          // M390: gesichert wird das Board, auf dem wiederhergestellt wird — nicht das gerade offene
          if (snap.boardId !== get().activeId) get().pushHistoryBoards([snap.boardId]); else get().pushHistory();
          set({
            boards: get().boards.map((b) =>
              b.id === snap.boardId
                ? {
                    ...b,
                    nodes: [...b.nodes, ...nodes.map((n) => ({ ...n, selected: false }) as AppNode)],
                    edges: [...b.edges, ...fehlt(b.edges, snap.edges)],
                    drawings: snap.drawings?.length ? [...(b.drawings ?? []), ...fehlt(b.drawings, snap.drawings)] : b.drawings,
                    comments: snap.comments?.length ? [...(b.comments ?? []), ...fehlt(b.comments, snap.comments)] : b.comments,
                  }
                : b,
            ),
            lastDeleted: null,
          });
          get().showToast('Wiederhergestellt ✓');
        },

        resizeNode: (id, width, height) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? ({ ...n, width, height } as AppNode) : n,
            ),
          })),

        setNodeHeight: (id, height) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? ({ ...n, height } as AppNode) : n,
            ),
          })),

        textStricheFestschreiben: (nodeId) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          const n = board?.nodes.find((k) => k.id === nodeId);
          if (!board || !n || n.type !== 'note') return;
          const offen = (board.drawings ?? []).filter((s) => s.anchor === nodeId && s.seite == null && s.amText == null);
          if (offen.length === 0) return;
          const w = n.width ?? n.measured?.width ?? 260;
          const h = n.height ?? undefined; // ohne feste Höhe reichte die Karte bis zum Ende ihres Inhalts
          const ids = new Set(offen.map((s) => s.id));
          // gehört zur folgenden Größenänderung — kein eigener Rückgängig-Schritt
          mutedHistory(() => patchActive((b) => ({
            drawings: (b.drawings ?? []).map((s) => (ids.has(s.id) ? { ...s, amText: istAmText(s, true, w, h) } : s)),
          })));
        },

        setAutoFit: (ids, on) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              ids.includes(n.id) ? ({ ...n, autoFit: on ? undefined : false } as AppNode) : n,
            ),
          })),

        setWinkel: (entries) => {
          if (entries.length === 0) return;
          const ziel = new Map(entries);
          patchActive((b) => {
            const gedreht = new Map<string, { d: number; mx: number; my: number; n: AppNode }>();
            const nodes = b.nodes.map((n) => {
              if (!ziel.has(n.id) || !istDrehbar(n)) return n;
              const neu = winkelNorm(ziel.get(n.id)!);
              const alt = winkelVon(n);
              if (neu === alt) return n;
              const g = sizeOf(n);
              gedreht.set(n.id, { d: neu - alt, mx: g.w / 2, my: g.h / 2, n });
              return { ...n, winkel: neu || undefined } as AppNode;
            });
            if (gedreht.size === 0) return {};
            // Striche, die auf der Brett-Ebene an der Karte hängen, drehen sich um deren Mitte mit. Was die Karte
            // selbst zeichnet (auf dem Text einer Notiz, auf einer Dokument-Seite), dreht sich schon mit ihr.
            const drawings = (b.drawings ?? []).map((st) => {
              const g = st.anchor ? gedreht.get(st.anchor) : undefined;
              if (!g || st.seite != null) return st;
              if (g.n.type === 'note' && !g.n.kachel && istAmText(st, true, g.mx * 2, g.n.height ?? undefined)) return st;
              return { ...st, points: st.points.map(([x, y]) => {
                const q = drehe({ x, y }, { x: g.mx, y: g.my }, g.d);
                return [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100] as [number, number];
              }) };
            });
            return { nodes, drawings };
          });
        },

        setKachel: (ids, on) => {
          if (ids.length === 0) return;
          get().pushHistory();
          const idSet = new Set(ids);
          patchActive((b) => ({
            nodes: b.nodes.map((n) => {
              if (!idSet.has(n.id) || !KACHEL_TYPEN.has(n.type ?? '')) return n;
              if (on) {
                if (n.kachel) return n;
                // Größe merken, damit „Ausklappen" die Karte so zurückbringt, wie sie war
                const w = (typeof n.width === 'number' ? n.width : n.measured?.width) ?? 420;
                const h = (typeof n.height === 'number' ? n.height : n.measured?.height) ?? 260;
                return { ...n, kachel: true, kachelMass: { w, h }, width: 300, height: undefined, autoFit: undefined } as AppNode;
              }
              if (!n.kachel) return n;
              const m = n.kachelMass;
              return { ...n, kachel: undefined, kachelMass: undefined, width: m?.w ?? n.width, height: m?.h ?? n.height } as AppNode;
            }),
          }));
        },

        setCardTypo: (ids, patch) => {
          if (ids.length === 0) return;
          get().pushHistory();
          const idSet = new Set(ids);
          patchActive((b) => ({
            nodes: b.nodes.map((n) => {
              if (!idSet.has(n.id)) return n;
              const next = { ...n } as AppNode;
              if (patch.font !== undefined) next.font = patch.font ?? undefined;
              if (patch.fontSize !== undefined) next.fontSize = patch.fontSize ?? undefined;
              return next;
            }),
          }));
        },

        updateNodeData: (id, data) => {
          // Feingranulare History (M122): gebündelter Snapshot vor der Änderung —
          // Automatik (runDerived) und Sammel-Aktionen (mutedHistory) ausgenommen
          if (!historyMuted && !inDerived()) {
            const key = `n:${get().activeId}:${id}`;
            const now = Date.now();
            if (key !== lastEditKey || now - lastEditAt > EDIT_COALESCE_MS) get().pushHistory();
            lastEditKey = key;
            lastEditAt = now;
          }
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? zeitNachPatch({ ...n, data: { ...n.data, ...mitFristAnker(n, data) } } as AppNode, n, data) : n,
            ),
          }));
        },

        setNodePosition: (id, x, y) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? ({ ...n, position: { x, y } } as AppNode) : n,
            ),
          })),

        setNodePositions: (entries) =>
          patchActive((b) => {
            const map = new Map(entries.map(([id, x, y]) => [id, { x, y }]));
            return {
              nodes: b.nodes.map((n) => {
                const p = map.get(n.id);
                return p ? ({ ...n, position: p } as AppNode) : n;
              }),
            };
          }),

        focusNode: (boardId, nodeId, opt) => {
          set({ pendingFocus: { boardId, nodeId, markieren: opt?.markieren }, activeId: boardId, view: 'board' });
        },

        clearPendingFocus: () => set({ pendingFocus: null }),

        hinweisRueckgaengig: () => {
          /**
           * M390: Der Knopf „Rückgängig" im Hinweis nimmt GENAU den Schritt zurück, zu dem der Hinweis gehört.
           * Ist seither nichts dazwischengekommen, ist das ein gewöhnliches Strg+Z — danach gibt es keinen
           * übriggebliebenen Schritt, der die wiederhergestellte Karte beim nächsten Strg+Z erneut löscht, und der
           * Verlauf stimmt auch, wenn man inzwischen auf einem anderen Board steht. Kam etwas dazwischen, wird nur
           * Gelöschtes zurückgelegt; für alles andere sagt der Hinweis, wie es weitergeht.
           */
          const s0 = get();
          const art = s0.toast?.undo;
          if (art === 'ebene') { s0.ebeneZurueck(); return; }
          if (hinweisEintrag && s0.past[s0.past.length - 1] === hinweisEintrag) { hinweisEintrag = null; s0.undo(); return; }
          if (art === 'schritt') { s0.showToast('Inzwischen ist anderes dazugekommen – Strg+Z nimmt Schritt für Schritt zurück.', false, 6000); return; }
          s0.restoreDeleted();
        },
        showToast: (message, undo, durationMs, abbruch) => {
          if (toastTimer) clearTimeout(toastTimer);
          hinweisEintrag = undo && undo !== 'ebene' && !abbruch ? (get().past[get().past.length - 1] ?? null) : null;
          set({ toast: { message, undo, abbruch } });
          toastTimer = setTimeout(() => set({ toast: null }), durationMs ?? (undo ? 6000 : 3000));
        },
      };
    },
    {
      name: 'pixinotes-board',
      version: 5,
      storage: createJSONStorage(() => debouncedSafeStorage),
      partialize: (s) => ({
        boards: s.boards.map((b) => persistHaken.board(b)),
        spaces: s.spaces,
        activeId: s.activeId,
        view: s.view,
        ai: s.ai,
        brain: s.brain,
        brainOffSpaces: s.brainOffSpaces,
        rejectedLinks: s.rejectedLinks,
        templates: s.templates,
        ui: s.ui,
        physicsEnabled: s.physicsEnabled,
        konfetti: s.konfetti,
        pfeilSchatten: s.pfeilSchatten,
        stiftZeichnet: s.stiftZeichnet,
        clickZoom: s.clickZoom,
        cardFocus: s.cardFocus,
        fokusEinKlick: s.fokusEinKlick,
        fokusVollbild: s.fokusVollbild,
        navLinks: s.navLinks,
        navBreite: s.navBreite,
        spalteBreite: s.spalteBreite,
        milchglas: s.milchglas,
        syncDateienMb: s.syncDateienMb,
        anzeige: s.anzeige,
        lesbareSchrift: s.lesbareSchrift,
        hoherKontrast: s.hoherKontrast,
        wheelZoom: s.wheelZoom,
        handschriftOnline: s.handschriftOnline,
        handschriftAuto: s.handschriftAuto,
        fingerGesten: s.fingerGesten,
        handschriftKi: s.handschriftKi,
        showArchived: s.showArchived,
        gridSnap: s.gridSnap,
        overviewMode: s.overviewMode,
        graphLayers: s.graphLayers,
      }),
      migrate: (persisted: unknown, version: number) => {
        const p = persisted as Record<string, unknown>;
        // v3 (M127): bestehende freie Striche EINMALIG nach derselben Regel wie
        // beim Zeichnen ankern (größte Schnittmenge ≥ 50 % der Strich-Fläche)
        const anchorLegacyStrokes = <T,>(out: T): T => {
          if (version >= 3 || !out || !Array.isArray((out as Record<string, unknown>).boards)) return out;
          const boards = (out as unknown as { boards: BoardDoc[] }).boards.map((b) =>
            b.drawings?.length ? { ...b, drawings: b.drawings.map((s) => anchorStroke(s, b.nodes ?? [])) } : b);
          return { ...out, boards };
        };
        // v4 (M160): App-Karten hatten ein dragHandle auf die Kopfzeile — die
        // war aber fast komplett vom Titel-Eingabefeld (nodrag) bedeckt und
        // der Universal-Griff lag AUSSERHALB des Handles: die Karte war
        // praktisch unverschiebbar. Jetzt ziehen sie wie alle Karten (die
        // App-Fläche schluckt ihre Eingaben ohnehin selbst) — gespeicherte
        // dragHandle-Einträge werden hier einmalig entfernt.
        const stripHappHandle = <T,>(out: T): T => {
          if (!out || !Array.isArray((out as Record<string, unknown>).boards)) return out;
          const boards = (out as unknown as { boards: BoardDoc[] }).boards.map((b) => ({
            ...b,
            nodes: (b.nodes ?? []).map((n) =>
              n.type === 'htmlapp' && n.dragHandle ? { ...n, dragHandle: undefined } : n),
          }));
          return { ...out, boards };
        };
        // v5 (M171): Zeiterfassung nur noch Arbeit & Pause — alte Fahrzeit-/
        // Dienstgeschäft-Abschnitte werden zu Arbeit (sie zählten ohnehin als
        // Arbeitszeit, die Summen bleiben also identisch); die frühere Art
        // wandert als Vermerk in die Bemerkung, damit nichts verloren geht.
        const mergeTimeKinds = <T,>(out: T): T => {
          if (!out || !Array.isArray((out as Record<string, unknown>).boards)) return out;
          const LABEL: Record<string, string> = { fahrt: 'Fahrzeit', dienst: 'Dienstgeschäft' };
          const boards = (out as unknown as { boards: BoardDoc[] }).boards.map((b) => ({
            ...b,
            nodes: (b.nodes ?? []).map((n) => {
              if (n.type !== 'time') return n;
              const segs = (n.data as { segs?: TimeSeg[] }).segs ?? [];
              if (!segs.some((s) => LABEL[s.kind as string])) return n;
              return {
                ...n,
                data: {
                  ...n.data,
                  segs: segs.map((s) => (LABEL[s.kind as string]
                    ? { ...s, kind: 'arbeit' as const, note: s.note ? `${LABEL[s.kind as string]} · ${s.note}` : LABEL[s.kind as string] }
                    : s)),
                },
              } as typeof n;
            }),
          }));
          return { ...out, boards };
        };
        // v0: {nodes, edges} — Einzelboard
        if (version === 0 && p && 'nodes' in p) {
          const boards = [
            { id: 'main', name: 'Mein Schreibtisch', nodes: p.nodes as Node[], edges: p.edges as Edge[] },
          ];
          return anchorLegacyStrokes({ boards, spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' });
        }
        // v1: {boards, activeId} — flache Boards ohne Hierarchie
        if (version === 1 && p && 'boards' in p) {
          const boards = (p.boards as BoardDoc[]) ?? [];
          if (boards.length === 0) {
            return { boards: [{ id: 'main', name: 'Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
          }
          return anchorLegacyStrokes({
            boards,
            spaces: defaultHierarchy(boards.map((b) => b.id)),
            activeId: (p.activeId as string) ?? boards[0]?.id,
            view: 'board',
          });
        }
        // v2: defensiv validieren (leeres boards-Array oder tote activeId reparieren)
        if (p && 'boards' in p) {
          const boards = (p.boards as BoardDoc[]) ?? [];
          if (boards.length === 0) {
            return { boards: [{ id: 'main', name: 'Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
          }
          if (!boards.some((b) => b.id === (p.activeId as string))) {
            return mergeTimeKinds(stripHappHandle(anchorLegacyStrokes({ ...p, activeId: boards[0].id })));
          }
        }
        return mergeTimeKinds(stripHappHandle(anchorLegacyStrokes(p)));
      },
    },
  ),
);

/**
 * M397: PixiNotes vergibt keine Emojis mehr. Namen, die die App früher selbst vergeben hat („🏠 Mein Board",
 * „🏢 Arbeit", die Beispiel-Boards, „✨ Board 2" …), verlieren ihren Vorsatz – einmal je Gerät. Eigene Namen
 * bleiben unangetastet: Es zählt nur, was nach dem Vorsatz genau einem alten Standardnamen entspricht.
 */
const ALTE_STANDARDNAMEN = new Set(
  'Arbeit|Work|Mein Board|My board|Mein Schreibtisch|My desk|Board|Projekt|Project|Arbeitsplatz|Wissen & Nachschlagen|Zusammenarbeit & Projekte|Privat|Schreibtisch|Aufgaben-Zentrale|Zeiterfassung & Abwesenheit|Dienstreise|Dienstwagen|Wissen|Software & Tipps|Datenschutz & IT-Sicherheit|Ansprechpartner|Jour fixe|Mitarbeitergespräche|Beispielprojekt: E-Akte|Onboarding neue Kolleg:innen|Prozesse & Mindmap|Eigene Apps & Dateien|Familienplan|Routinen & Ziele|Verträge & Fristen|Besprechung|Meeting|Rückblick|Retrospective|Projektplan|Project plan|Brainstorming|Aufgaben-Board|Task board|Wochenplanung|Weekly planning|Entscheidung|Decision|SWOT|Workshop'.split('|'),
);
export function alteNamenOhneEmoji(): void {
  try {
    if (localStorage.getItem('pixinotes-ohne-emoji')) return;
    localStorage.setItem('pixinotes-ohne-emoji', '1');
  } catch { return; }
  const neu = (n: string): string => {
    const kern = ohneVorsatz(n);
    return kern !== n && ALTE_STANDARDNAMEN.has(kern.replace(/ \d+$/, '')) ? kern : n;
  };
  const s = useBoard.getState();
  const boards = s.boards.map((b) => (neu(b.name) === b.name ? b : { ...b, name: neu(b.name) }));
  const spaces = s.spaces.map((sp) => {
    const projects = sp.projects.map((p) => (neu(p.name) === p.name ? p : { ...p, name: neu(p.name) }));
    const gleich = projects.every((p, i) => p === sp.projects[i]) && neu(sp.name) === sp.name;
    return gleich ? sp : { ...sp, name: neu(sp.name), projects };
  });
  if (boards.every((b, i) => b === s.boards[i]) && spaces.every((sp, i) => sp === s.spaces[i])) return;
  mutedHistory(() => useBoard.setState({ boards, spaces }));
}

/**
 * M381: Der unberührte Start trägt seine Namen in der Sprache der Oberfläche. Nur solange nichts angefasst
 * wurde — eigene Namen bleiben, wie sie sind (auch auf einem Gerät, das später die Sprache wechselt).
 */
export function startNamenAufEnglisch(): void {
  const s = useBoard.getState();
  const start = leeresStartboard(s.boards);
  const bereich = s.spaces[0];
  if (!start || start.name !== START_BOARD_NAME || s.spaces.length !== 1 || bereich.projects.length !== 1) return;
  if (bereich.name !== 'Arbeit' || bereich.projects[0].name !== 'Allgemein') return;
  useBoard.setState({
    boards: [{ ...start, name: START_BOARD_NAME_EN }],
    spaces: [{ ...bereich, name: 'Work', projects: [{ ...bereich.projects[0], name: 'General' }] }],
  });
}
