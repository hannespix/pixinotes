/**
 * Typen des Board-Speichers: Board, Strich, Kommentar, Hierarchie (Bereich → Projekt → Board), der Zustand
 * `BoardState` und der `Kontext`, den jede Scheibe vom Speicher bekommt.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import type { Connection, Edge, EdgeChange, NodeChange } from '@xyflow/react';
import type { AppNode, CardFont, CardSize } from '../types';
import type { StoreApi } from 'zustand';

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

/** M509: Look eines geteilten Boards — nur bekannte Werte (lib/sicher.ts lookVonAussen) */
export interface BoardLook {
  aus?: boolean;
  theme?: 'system' | 'light' | 'dark';
  design?: 'klassisch' | 'pixel' | 'vave';
  accent?: string;
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
  /** M509: Look, den der Teilende dem Board mitgibt (Erscheinungsbild, Design, Akzent) — gilt bei Gästen für
   *  dieses Board statt ihrer eigenen Geräte-Einstellung (lib/boardLook.ts); `aus` = bewusst keinen mitgeben */
  look?: BoardLook;
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
  /**
   * M478: System-Board — „eingang" ist die Ablage für alles, was von außen kommt (Erweiterung, Teilen, Outlook
   * „Später"). Es steht in keinem Projekt, nie in Übersicht, Reitern oder Präsentation, wird nie das aktive Board
   * (lib/eingang.ts wacht darüber) — reist aber wie jedes Board mit Abgleich, Sicherung, Versionen und Suche.
   */
  system?: 'eingang';
}

/** Ein Kommentar-Pin an einer Karte mit seinem Gesprächsverlauf (M148) */
export interface CommentThread {
  id: string;
  nodeId: string;
  /** M335: Pin an einer Stelle auf einer PDF-Seite (Seitennummer + Seitenpunkte) statt an der Kartenecke */
  seite?: number;
  px?: number;
  py?: number;
  /** M546: Textblase aus dem Weg gelegt — Versatz ihrer oberen linken Ecke zum Pin, in Seitenpunkten (fehlt = neben dem Pin) */
  bx?: number;
  by?: number;
  /** M546: Pin an einer Karte (ohne Seite) verschoben — Stelle als Anteil von Breite und Höhe der Karte (fehlt = Ecke oben rechts) */
  kx?: number;
  ky?: number;
  resolved?: boolean;
  /** M362: `bearbeitet` = Zeitpunkt der letzten nachträglichen Änderung des Textes (fehlt bei unveränderten Beiträgen) */
  msgs: Array<{ author: string; text: string; at: string; bearbeitet?: string }>;
}

export type Tool = 'select' | 'pen' | 'marker' | 'eraser';

/** M546: die verschiebbaren Felder eines Gesprächs (Pin, Blase) — `null` beim Setzen nimmt das Feld heraus */
export const KOMMENTAR_LAGE = ['px', 'py', 'bx', 'by', 'kx', 'ky'] as const;
export type KommentarLage = Partial<Record<(typeof KOMMENTAR_LAGE)[number], number | null>>;

/** Ein Undo-Schritt: kompletter Struktur-Stand eines Boards (Referenzen, kein Deep-Copy —
 *  alle Mutationen laufen immutabel, alte Objekte bleiben gültig). */
export interface BoardSnap {
  boardId: string;
  nodes: AppNode[];
  edges: Edge[];
  drawings?: Stroke[];
  /** M388: Gespräche zum Zeitpunkt des Schritts — damit sie mit ihrer Karte zurückkehren (kommentareNach) */
  comments?: CommentThread[];
}

export interface HistoryEntry extends BoardSnap {
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
  /** M546: Lage von Pins/Blasen vor dem Schritt (Gespräche sind sonst kein Teil des Verlaufs, siehe kommentareNach) */
  kommentarOrte?: Record<string, KommentarLage>;
}

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
  /** M476: eigener Knopf (Beschriftung) — die Aktion liegt in `hinweisKnopfAktion` */
  knopf?: string;
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

export interface BoardState {
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
  /** M503: `ab` = Startkarte (null = ausdrücklich von vorn); ohne `ab` startet die Präsentation bei Fokus bzw. Auswahl */
  setPresenting: (on: boolean, ab?: string | null) => void;
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
  /** M509: Look des Boards setzen (undefined = keiner festgelegt) */
  setBoardLook: (id: string, look: BoardLook | undefined) => void;
  /** Gitter anzeigen + Karten am Raster einrasten (persistiert, M88) */
  gridSnap: boolean;
  setGridSnap: (on: boolean) => void;
  /** M490: Fanglinien beim Ziehen (an Kanten/Mitten anderer Karten einrasten). Einrasten „Aus" = weder
   *  Fanglinien noch Raster; „Raster" = gridSnap (hat Vorrang, fangLinien bleibt für den Rückweg mit Alt+R stehen) */
  fangLinien: boolean;
  setFangLinien: (on: boolean) => void;
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
   * M460: Einzelne Karten aus einem gesicherten Stand zurückholen, ohne das übrige Board anzufassen: gelöschte kommen
   * wieder (samt ihren Verbindungen zu Karten, die es noch gibt), geänderte bekommen ihren damaligen Inhalt. EIN
   * Rückgängig-Schritt, eine gewöhnliche Änderung (Sync trägt sie weiter). Rückgabe: Zahl der geholten Karten.
   */
  /** M460/M470: Karten (und auf Wunsch einzelne Verbindungen und Striche) aus einem Stand zurückholen — ein Undo-Schritt */
  kartenZurueckholen: (boardId: string, ids: string[], stand: { nodes: AppNode[]; edges: Edge[]; drawings?: Stroke[] }, extra?: { pfeile?: string[]; striche?: string[] }) => { karten: number; pfeile: number; striche: number };
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
  /** M546: Pin oder Blase eines Gesprächs verschieben (oder die Blase zurücklegen: `bx/by: null`) — ein Rückgängig-Schritt */
  setCommentLage: (threadId: string, lage: KommentarLage) => void;

  updateEdgeLabel: (id: string, label: string) => void;
  updateEdgeKind: (id: string, kind: string) => void;
  /** M146/M147: feingliedrige Verbindungsoptionen — Spitzen (Ende/Anfang),
   *  Spitzenform, Linienstärke, eigene Farbe */
  /** M530: Reihenfolge der Ausgänge eines Rahmens für die Rahmen-Reise (Kanten-Kennungen in der neuen Folge) */
  ausgaengeOrdnen: (ids: string[]) => void;
  updateEdgeStyle: (id: string, patch: {
    head?: boolean; headStart?: boolean; shape?: string; width?: number; color?: string | null;
  }) => void;
  removeEdge: (id: string) => void;
  addNode: (node: AppNode) => void;
  /** M390: Karten des aktiven Boards duplizieren — ein Rückgängig-Schritt, mit Verbindungen und Anhängen; Rückgabe: Anzahl */
  dupliziere: (ids: string[]) => Promise<number>;
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
  /** `kantenIds` (M521): Verbindungen, die im selben Schritt mit entfernt werden (mitgewählt, zwischen anderen Karten) */
  removeNodes: (ids: string[], kantenIds?: string[]) => void;
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

  /** M481: Bewegung beim Ziehen — die gegriffene Karte hebt und neigt sich, Nachbarn weichen aus, beim Ablegen
   *  federt sie an ihren Platz (wie die Board-Kacheln der Übersicht, M440). Ersetzt die frühere Verdrängungs-
   *  und Wurf-Physik (`physicsEnabled`, die jedes Bild in den Stand schrieb). Voreinstellung an. */
  ziehBewegung: boolean;
  setZiehBewegung: (on: boolean) => void;
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

  /** Design: Hell/Dunkel/System + Akzentfarbe (persistiert); M507: `design` = Klassisch, pix·el oder (M547) vave.log (fehlt = Klassisch) */
  ui: { theme: 'system' | 'light' | 'dark'; accent: string; design?: 'klassisch' | 'pixel' | 'vave' };
  setUiTheme: (theme: 'system' | 'light' | 'dark') => void;
  setUiAccent: (accent: string) => void;
  setUiDesign: (design: 'klassisch' | 'pixel' | 'vave') => void;
}

/**
 * M480: Was jede Scheibe vom Speicher bekommt – das (geschützte) set, get und die Abkürzung fürs offene Board.
 * Als einzelne Parameter statt eines Objekts: Das hält das Start-JS so klein wie vor der Aufteilung.
 */
export type Setzen = StoreApi<BoardState>['setState'];
export type Holen = () => BoardState;
export type AufsOffene = (fn: (b: BoardDoc) => Partial<BoardDoc>) => void;
