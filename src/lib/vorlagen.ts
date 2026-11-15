// M379: Vorlagen beim Anlegen eines Boards.
//
// Ein leeres Board ist für viele die höchste Hürde: Womit fange ich an? Eine Vorlage legt die Karten für
// einen bekannten Anlass schon hin — Besprechung, Rückblick, Projektplan, Brainstorming … Die Karten sind
// beschriftet, aber leer: Überschriften und Spalten stehen, fremde Beispiel-Inhalte gibt es nicht. Wer eine
// Vorlage wählt, hat eigene Inhalte im Kopf und soll nichts wegräumen müssen.
//
// Jede Vorlage baut ihre Karten bei jedem Aufruf frisch (neue Ids, Daten ab heute).
import type { Edge } from '@xyflow/react';
import { leereBubbles } from './bubbles';
import { uid, type AppNode, type StickyColor } from '../types';

type Pos = { x: number; y: number };
type Block = Record<string, unknown>;

const h = (text: string): Block => ({ type: 'heading', props: { level: 3 }, content: text });
const p = (text = ''): Block => ({ type: 'paragraph', content: text });
const li = (text = ''): Block => ({ type: 'bulletListItem', content: text });
const nr = (text = ''): Block => ({ type: 'numberedListItem', content: text });
const haken = (text = ''): Block => ({ type: 'checkListItem', props: { checked: false }, content: text });

const notiz = (pos: Pos, color: StickyColor, blocks: Block[], width = 270): AppNode =>
  ({ id: uid(), type: 'note', width, position: pos, data: { color, blocks } } as AppNode);
const rahmen = (pos: Pos, w: number, hoehe: number, name: string, color = ''): AppNode =>
  ({ id: uid(), type: 'frame', width: w, height: hoehe, position: pos, dragHandle: '.frame-head', data: { name, ...(color ? { color } : {}) } } as AppNode);
const kanban = (pos: Pos, title: string, cols?: string[], width = 430): AppNode =>
  ({ id: uid(), type: 'kanban', width, position: pos, data: { title, items: [], ...(cols ? { cols } : {}) } } as AppNode);
const bubbles = (pos: Pos, title: string, frage: string, w = 560, hoehe = 440): AppNode =>
  ({ id: uid(), type: 'bubbles', width: w, height: hoehe, position: pos, data: { title, frage, ...leereBubbles() } } as AppNode);
const protokoll = (pos: Pos, title: string, agenda: string[]): AppNode =>
  ({ id: uid(), type: 'minutes', width: 380, height: 420, position: pos, data: { title, color: 'white', entries: [], agenda, rhythm: '', carryOpen: true } } as AppNode);
const woche = (pos: Pos, title: string): AppNode =>
  ({ id: uid(), type: 'week', width: 620, height: 440, position: pos, data: { title, days: 5, from: 8 * 60, to: 17 * 60, entries: [] } } as AppNode);

const TAG = 864e5;
const iso = (tage: number): string => new Date(Date.now() + tage * TAG).toISOString().slice(0, 10);
const zeitplan = (pos: Pos, title: string, zeilen: Array<[name: string, von: number, bis: number, farbe: string]>, w = 620, hoehe = 250): AppNode =>
  ({
    id: uid(), type: 'gantt', width: w, height: hoehe, position: pos,
    data: { title, dayWidth: 24, rows: zeilen.map(([name, von, bis, color]) => ({ id: uid(), name, start: iso(von), end: iso(bis), color })) },
  } as AppNode);

// Rahmen-Tönungen (wie lib/frameOps.ts FRAME_COLORS)
const BLAU = '#dbe7f6', GRUEN = '#dcedde', SAND = '#f6ead2', ROSE = '#f4dde3', LILA = '#e6def4';

export interface VorlagenInhalt { nodes: AppNode[]; edges: Edge[] }
export interface Vorlage {
  id: string;
  /** Name der Vorlage — und des Boards, das daraus entsteht */
  name: string;
  /** Ein Satz: wofür sie gedacht ist */
  text: string;
  bauen: () => VorlagenInhalt;
}

export const VORLAGEN: Vorlage[] = [
  {
    id: 'besprechung',
    name: '🗓️ Besprechung',
    text: 'Tagesordnung, Protokoll und die Aufgaben, die daraus entstehen.',
    bauen: () => ({
      nodes: [
        notiz({ x: 0, y: 0 }, 'yellow', [h('Ziel der Besprechung'), p(), h('Teilnehmende'), li()], 280),
        protokoll({ x: 320, y: 0 }, 'Besprechung', ['Stand der Dinge', 'Themen', 'Beschlüsse', 'Nächste Schritte']),
        kanban({ x: 740, y: 0 }, 'Aufgaben aus der Besprechung'),
        notiz({ x: 0, y: 260 }, 'sky', [h('Offene Fragen'), li()], 280),
      ],
      edges: [],
    }),
  },
  {
    id: 'rueckblick',
    name: '🔁 Rückblick',
    text: 'Retro im Team: Was lief gut, was hakte, was probieren wir aus — mit Abstimmung.',
    bauen: () => {
      const spalte = (x: number, name: string, ton: string, farbe: StickyColor): AppNode[] => [
        rahmen({ x, y: 0 }, 340, 420, name, ton),
        notiz({ x: x + 30, y: 64 }, farbe, [p()], 280),
        notiz({ x: x + 30, y: 180 }, farbe, [p()], 280),
      ];
      return {
        nodes: [
          ...spalte(0, '😀 Gut gelaufen', GRUEN, 'mint'),
          ...spalte(370, '😕 Hat gehakt', ROSE, 'pink'),
          ...spalte(740, '💡 Probieren wir aus', BLAU, 'sky'),
          bubbles({ x: 0, y: 460 }, 'Maßnahmen', 'Was nehmen wir uns bis zum nächsten Mal vor?', 620, 440),
          kanban({ x: 650, y: 460 }, 'Das setzen wir um'),
        ],
        edges: [],
      };
    },
  },
  {
    id: 'projektplan',
    name: '🚀 Projektplan',
    text: 'Ziel und Umfang, Zeitplan mit Meilenstein, Aufgaben, Beteiligte und Risiken.',
    bauen: () => ({
      nodes: [
        notiz({ x: 0, y: 0 }, 'yellow', [h('Ziel'), p(), h('Gehört dazu'), li(), h('Gehört nicht dazu'), li()], 290),
        zeitplan({ x: 330, y: 0 }, '📅 Zeitplan', [
          ['Vorbereitung', 0, 4, '#4f7cff'],
          ['Umsetzung', 5, 15, '#3fa564'],
          ['Abschluss', 16, 20, '#8a63d2'],
          ['Fertig', 21, 21, '#e07a3f'],
        ], 760, 270),
        kanban({ x: 330, y: 310 }, 'Aufgaben'),
        notiz({ x: 0, y: 330 }, 'sky', [h('Beteiligte'), li()], 290),
        notiz({ x: 800, y: 310 }, 'pink', [h('Risiken'), li()], 290),
      ],
      edges: [],
    }),
  },
  {
    id: 'brainstorming',
    name: '🫧 Brainstorming',
    text: 'Ideen als Blasen sammeln, gruppieren und mit Punkten abstimmen.',
    bauen: () => ({
      nodes: [
        bubbles({ x: 0, y: 0 }, 'Ideen', 'Wie könnten wir …?', 720, 520),
        notiz({ x: 760, y: 0 }, 'yellow', [
          h('So läuft es'),
          nr('Frage oben in der Karte eintragen'),
          nr('Alle sammeln Ideen — eine je Blase'),
          nr('Ähnliches aufeinander ziehen: Gruppen'),
          nr('Punkte vergeben, Ergebnis ansehen'),
        ], 300),
        rahmen({ x: 760, y: 250 }, 340, 270, '🅿️ Parkplatz', SAND),
      ],
      edges: [],
    }),
  },
  {
    id: 'aufgaben',
    name: '✅ Aufgaben-Board',
    text: 'Ein großes Kanban mit vier Spalten und einer Notiz für das Wichtigste.',
    bauen: () => ({
      nodes: [
        kanban({ x: 0, y: 0 }, 'Aufgaben', ['Offen', 'In Arbeit', 'Prüfen', 'Erledigt'], 760),
        notiz({ x: 800, y: 0 }, 'yellow', [h('Diese Woche wichtig'), haken(), haken(), haken()], 280),
      ],
      edges: [],
    }),
  },
  {
    id: 'woche',
    name: '📆 Wochenplanung',
    text: 'Wochenplan, die drei wichtigsten Dinge und offene Punkte.',
    bauen: () => ({
      nodes: [
        woche({ x: 0, y: 0 }, 'Wochenplan'),
        notiz({ x: 660, y: 0 }, 'yellow', [h('Das Wichtigste'), haken(), haken(), haken()], 300),
        kanban({ x: 660, y: 230 }, 'Offene Punkte'),
      ],
      edges: [],
    }),
  },
  {
    id: 'entscheidung',
    name: '⚖️ Entscheidung',
    text: 'Frage, Gründe dafür und dagegen, Optionen zur Abstimmung, Ergebnis.',
    bauen: () => ({
      nodes: [
        notiz({ x: 0, y: 0 }, 'yellow', [h('Worüber entscheiden wir?'), p(), h('Bis wann?'), p()], 290),
        rahmen({ x: 330, y: 0 }, 340, 360, '👍 Dafür', GRUEN),
        notiz({ x: 360, y: 64 }, 'mint', [p()], 280),
        rahmen({ x: 700, y: 0 }, 340, 360, '👎 Dagegen', ROSE),
        notiz({ x: 730, y: 64 }, 'pink', [p()], 280),
        bubbles({ x: 0, y: 400 }, 'Optionen', 'Welchen Weg gehen wir?', 620, 440),
        notiz({ x: 660, y: 400 }, 'sky', [h('So machen wir es'), p(), h('Begründung'), p()], 320),
      ],
      edges: [],
    }),
  },
  {
    id: 'swot',
    name: '🧭 SWOT',
    text: 'Stärken, Schwächen, Chancen und Risiken in vier Feldern.',
    bauen: () => {
      const feld = (x: number, y: number, name: string, ton: string, farbe: StickyColor): AppNode[] => [
        rahmen({ x, y }, 400, 300, name, ton),
        notiz({ x: x + 30, y: y + 64 }, farbe, [p()], 280),
      ];
      return {
        nodes: [
          ...feld(0, 0, '💪 Stärken', GRUEN, 'mint'),
          ...feld(430, 0, '🩹 Schwächen', ROSE, 'pink'),
          ...feld(0, 330, '🌱 Chancen', BLAU, 'sky'),
          ...feld(430, 330, '⚠️ Risiken', SAND, 'yellow'),
        ],
        edges: [],
      };
    },
  },
  {
    id: 'workshop',
    name: '🎪 Workshop',
    text: 'Für große Runden: Ankommen, Arbeiten, Ergebnis — mit Erwartungen, Ideen und Verabredungen.',
    bauen: () => ({
      nodes: [
        notiz({ x: 0, y: 0 }, 'yellow', [h('Ablauf'), nr('Ankommen'), nr('Arbeiten'), nr('Ergebnis sichern'), h('Spielregeln'), li()], 280),
        rahmen({ x: 320, y: 0 }, 680, 560, '1 · Ankommen', BLAU),
        bubbles({ x: 350, y: 64 }, 'Erwartungen', 'Was soll heute für dich herauskommen?', 620, 460),
        rahmen({ x: 1030, y: 0 }, 680, 560, '2 · Arbeiten', LILA),
        bubbles({ x: 1060, y: 64 }, 'Ideen', 'Wie könnten wir …?', 620, 460),
        rahmen({ x: 1740, y: 0 }, 520, 560, '3 · Ergebnis', GRUEN),
        kanban({ x: 1770, y: 64 }, 'Wer macht was bis wann?', undefined, 460),
      ],
      edges: [],
    }),
  },
];

export const vorlageVon = (id: string): Vorlage | undefined => VORLAGEN.find((v) => v.id === id);

/** Ereignis, das den Vorlagen-Dialog öffnet: neues Board im Projekt — oder das leere Board `inBoard` füllen */
export const VORLAGEN_EREIGNIS = 'pixinotes:vorlagen';
export interface VorlagenWunsch { projectId?: string; inBoard?: string }
export const vorlagenOeffnen = (wunsch: VorlagenWunsch = {}): void => {
  window.dispatchEvent(new CustomEvent<VorlagenWunsch>(VORLAGEN_EREIGNIS, { detail: wunsch }));
};

// ---------- Skizze für die Kachel ----------
export interface SkizzenTeil { art: string; x: number; y: number; w: number; h: number; farbe: string }
const NOTIZ_FARBE: Record<string, string> = { yellow: '#f6e58d', pink: '#f5c2d0', mint: '#bfe5cf', sky: '#c3dcf5', white: '#ffffff' };
const ART_FARBE: Record<string, string> = { kanban: '#d9dfea', bubbles: '#dfe6f6', minutes: '#e9e4d6', gantt: '#dde6dc', week: '#e2def0' };
/** Geschätzte Höhe einer Karte ohne feste Höhe (Notiz, Kanban) — nur für die Skizze */
const hoeheVon = (n: AppNode): number => {
  if (typeof n.height === 'number') return n.height;
  if (n.type === 'note') return 44 + 30 * ((n.data as { blocks?: unknown[] }).blocks?.length ?? 1);
  if (n.type === 'kanban') return 240;
  return 160;
};
/** Die Karten einer Vorlage als Rechtecke in einem 0…1-Feld (Rahmen zuerst — sie liegen hinten) */
export function skizzeVon(inhalt: VorlagenInhalt): { teile: SkizzenTeil[]; verhaeltnis: number } {
  const roh = inhalt.nodes.map((n) => ({
    art: n.type ?? 'note', x: n.position.x, y: n.position.y, w: n.width ?? 270, h: hoeheVon(n),
    farbe: n.type === 'note' ? NOTIZ_FARBE[String((n.data as { color?: string }).color)] ?? NOTIZ_FARBE.yellow
      : n.type === 'frame' ? String((n.data as { color?: string }).color || '#eceff3')
      : ART_FARBE[n.type ?? ''] ?? '#e3e6ec',
  }));
  if (!roh.length) return { teile: [], verhaeltnis: 1.6 };
  const x0 = Math.min(...roh.map((r) => r.x)), y0 = Math.min(...roh.map((r) => r.y));
  const b = Math.max(...roh.map((r) => r.x + r.w)) - x0, hh = Math.max(...roh.map((r) => r.y + r.h)) - y0;
  const teile = roh
    .map((r) => ({ ...r, x: (r.x - x0) / b, y: (r.y - y0) / hh, w: r.w / b, h: r.h / hh }))
    .sort((a, c) => Number(c.art === 'frame') - Number(a.art === 'frame'));
  return { teile, verhaeltnis: b / hh };
}
