/**
 * M478: Der Eingang — eine Ablage für alles, was von außen kommt.
 *
 * Browser-Erweiterung (M458), Android-Teilen (M290) und Outlook „Später" (M466) legten ihr Gesendetes sofort auf das
 * gerade offene Board — auch mitten in einer Besprechung oder auf einem Board, das man gerade nicht sortieren will.
 * Jetzt sammelt es sich (Einstellung, Vorgabe an) im Eingang und wartet, bis man es gezielt einsortiert: einzeln,
 * mehrere auf einmal oder per Ziehen aus der Liste aufs Board. Ablegen per Drag & Drop und Strg+V bleiben direkt —
 * dort hat man das Ziel ja schon gewählt.
 *
 * Gebaut als verstecktes SYSTEM-Board (Kennung EINGANG_ID, `system: 'eingang'`) statt als eigene Datenart: So reist
 * der Eingang ohne eine Zeile Sync-Code über Konto, Ordner und WebDAV (was am Telefon geteilt wird, wartet am PC),
 * steckt in Sicherung und Export, hat Versionen und wird von Strg+K gefunden. Der Preis: Alle Orte, die Boards
 * AUFZÄHLEN (Übersicht, Baum, Reiter, Zielwahl, Aufgaben), blenden es über `ohneEingang` aus, und das aktive Board
 * ist es nie (`eingangWaechter`).
 *
 * Ein Eintrag = eine Sendung; sie kann mehrere Karten haben (Android: Foto plus Text). Zusammengehalten werden sie
 * über `data.eingang.gruppe` — beim Einsortieren fällt die Marke weg, die Karten sind dann ganz normale Karten.
 */
import { useMemo } from 'react';
import { useBoard, type BoardDoc } from '../store';
import type { AppNode } from '../types';
import { findFreeSpot } from './arrange';
import { frisch } from './kartenZeit';
import { alsDateien, type Geteiltes } from './geteilt';
import { importFilesToBoard } from './importSpaet';
import { makeNote } from './nodes';
import { webAdresseVonAussen } from './sicher';
import { zahlWort } from './sprache';
import { EINGANG_ID, istEingang, ohneEingang } from './eingangId';

export { EINGANG_ID, istEingang, ohneEingang } from './eingangId';

export type Herkunft = 'erweiterung' | 'teilen' | 'outlook';
export interface EingangMarke { gruppe: string; herkunft: Herkunft; wann: number }

export interface Eintrag {
  /** Kennung der Sendung (= gruppe) */
  id: string;
  herkunft: Herkunft;
  wann: number;
  nodes: AppNode[];
}

/** Datentransfer-Typ beim Ziehen aus der Liste aufs Board (Board.tsx) */
export const EINGANG_ZIEHEN = 'application/x-pixinotes-eingang';
/** Ereignis „Eingang öffnen" (detail: { gruppe? } = diesen Eintrag zeigen) */
export const EINGANG_OEFFNEN = 'pixinotes:eingang';

const OPTION = 'pixinotes-eingang-sammeln';

/** Sammelt Eingehendes (Erweiterung, Teilen) im Eingang? Je Gerät, Vorgabe: an */
export function eingangSammeln(): boolean {
  try { return localStorage.getItem(OPTION) !== '0'; } catch { return true; }
}
export function setEingangSammeln(an: boolean): void {
  try { localStorage.setItem(OPTION, an ? '1' : '0'); } catch { /* privates Fenster: dann eben nur für jetzt */ }
}

export const herkunftText = (h: Herkunft | undefined): string =>
  h === 'erweiterung' ? 'Aus dem Browser' : h === 'outlook' ? 'Outlook' : 'Geteilt';

export const marke = (n: AppNode): EingangMarke | undefined => {
  const m = (n.data as { eingang?: EingangMarke }).eingang;
  return m && typeof m === 'object' && typeof m.gruppe === 'string' ? m : undefined;
};

/** Alle Boards außer dem Eingang — für jede Liste, die Boards zur Wahl stellt oder durchzählt */
export function useNutzerBoards(): BoardDoc[] {
  const boards = useBoard((s) => s.boards);
  return useMemo(() => ohneEingang(boards), [boards]);
}

/** Das Eingangs-Board, falls es (schon) eins gibt */
export const eingangBoard = (boards: BoardDoc[]): BoardDoc | undefined => boards.find(istEingang);

/** Einträge (Sendungen), neueste zuerst */
export function eintraege(board: BoardDoc | undefined): Eintrag[] {
  if (!board) return [];
  const gruppen = new Map<string, Eintrag>();
  for (const n of board.nodes) {
    const m = marke(n);
    const id = m?.gruppe ?? n.id;
    const e = gruppen.get(id);
    if (e) { e.nodes.push(n); continue; }
    const wann = m?.wann ?? (n as { angelegt?: number }).angelegt ?? 0;
    gruppen.set(id, { id, herkunft: m?.herkunft ?? 'teilen', wann, nodes: [n] });
  }
  return [...gruppen.values()].sort((a, b) => b.wann - a.wann);
}

/** Zahl der wartenden Einträge — für den Zähler in der Spalte */
export const eingangZahl = (boards: BoardDoc[]): number => eintraege(eingangBoard(boards)).length;

const neueId = () => `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Karten als EINEN Eintrag in den Eingang legen. Kein Undo-Schritt: Man hat nichts am eigenen Board getan, und
 * Strg+Z soll dort nicht unbemerkt eine Sendung verschlucken. Löschen geht in der Liste (mit Rückgängig).
 */
export function inEingangLegen(nodes: AppNode[], herkunft: Herkunft): number {
  if (!nodes.length) return 0;
  const st = useBoard.getState();
  const vorhanden = eingangBoard(st.boards);
  const jetzt = Date.now();
  const gruppe = neueId();
  // Im Eingang liegen die Sendungen untereinander — er wird nie gezeigt, aber so bleibt die Lage innerhalb einer
  // Sendung (Foto links, Text rechts) erhalten, und Strg+K/Versionen sehen ein ordentliches Board.
  const unten = vorhanden?.nodes.length
    ? Math.max(...vorhanden.nodes.map((n) => n.position.y + (n.height ?? 200))) + 80
    : 0;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const neu = nodes.map((n) => frisch({
    ...n,
    selected: false,
    position: { x: n.position.x - minX, y: n.position.y - minY + unten },
    data: { ...n.data, eingang: { gruppe, herkunft, wann: jetzt } satisfies EingangMarke },
  } as AppNode, jetzt));
  useBoard.setState((s) => {
    const da = s.boards.find(istEingang);
    if (da) return { boards: s.boards.map((b) => (b === da ? { ...b, nodes: [...b.nodes, ...neu] } : b)) };
    // Neu angelegt: ans ENDE der Liste — Rückfallwege („erstes Board") treffen so nie den Eingang
    const board: BoardDoc = { id: EINGANG_ID, name: 'Eingang', system: 'eingang', nodes: neu, edges: [], drawings: [] };
    return { boards: [...s.boards, board] };
  });
  return neu.length;
}

/**
 * Text des Geteilten als Notiz-Blöcke. M458: Die Adresse wird ein echter Verweis (nur http/https — eine
 * „javascript:"-Adresse wäre schon im Eingang verworfen worden, hier wird es noch einmal geprüft).
 * (M478: hierher gezogen, damit Empfangs-Dialog und Eingang dieselben Blöcke bauen.)
 */
export function textBloecke(g: Geteiltes): unknown[] {
  const zeilen = [g.titel, g.text].filter(Boolean).join('\n').split('\n');
  const bloecke: unknown[] = zeilen.map((zeile) => ({
    type: 'paragraph',
    content: zeile ? [{ type: 'text', text: zeile, styles: {} }] : [],
  }));
  if (g.adresse) {
    const href = webAdresseVonAussen(g.adresse);
    bloecke.push({
      type: 'paragraph',
      content: href
        ? [{ type: 'link', href, content: [{ type: 'text', text: g.adresse, styles: {} }] }]
        : [{ type: 'text', text: g.adresse, styles: {} }],
    });
  }
  return bloecke;
}

/** Eine Sendung (Erweiterung oder Teilen) in den Eingang — dieselben Karten wie beim Übernehmen aufs Board */
export async function geteiltesInEingang(g: Geteiltes, herkunft: Herkunft): Promise<number> {
  const karten: AppNode[] = [];
  const dateien = alsDateien(g);
  if (dateien.length) await importFilesToBoard(dateien, { x: 0, y: 0 }, { ablegen: (n) => { karten.push(n); } });
  if (g.titel || g.text || g.adresse) {
    karten.push(makeNote({ x: karten.length ? 300 : 0, y: 0 }, { blocks: textBloecke(g) }));
  }
  const n = inEingangLegen(karten, herkunft);
  useBoard.getState().showToast(n > 0
    ? `${herkunft === 'erweiterung' ? 'Aus dem Browser' : 'Geteiltes'} liegt im Eingang – einsortieren über „Eingang" in der Spalte.`
    : 'Es war nichts Übernehmbares dabei.');
  return n;
}

/** Mitte des sichtbaren Ausschnitts in Board-Koordinaten (ohne React-Flow-Kontext: aus der Transformation) */
export function sichtMitte(w: number, h: number): { x: number; y: number } {
  const vp = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  const flaeche = document.querySelector('.react-flow') as HTMLElement | null;
  if (!vp || !flaeche) return { x: 120, y: 120 };
  const m = new DOMMatrixReadOnly(getComputedStyle(vp).transform);
  const r = flaeche.getBoundingClientRect();
  const z = m.a || 1;
  return { x: (r.width / 2 - m.e) / z - w / 2, y: (r.height / 2 - m.f) / z - h / 2 };
}

const breite = (n: AppNode) => n.width ?? n.measured?.width ?? 300;
const hoehe = (n: AppNode) => n.height ?? n.measured?.height ?? 200;

/** Die Marke weg: Eingesammeltes ist eine ganz normale Karte */
const ohneMarke = (n: AppNode): AppNode => {
  if (!marke(n)) return n;
  const { eingang: _e, ...data } = n.data as Record<string, unknown>;
  return { ...n, data } as AppNode;
};

/**
 * Einträge aufs Board holen (EIN Undo-Schritt für Ziel und Eingang). `an` = Stelle auf dem Ziel (Ziehen); ohne
 * sie landen die Karten in der Mitte des sichtbaren Ausschnitts an einer freien Stelle. Mehrere Einträge liegen
 * nebeneinander, jeder in seiner eigenen Anordnung. Gibt die Zahl der Karten zurück.
 */
export function eingangHolen(gruppen: string[], zielId?: string, an?: { x: number; y: number }): number {
  const st0 = useBoard.getState();
  const eb = eingangBoard(st0.boards);
  const ziel = zielId ?? st0.activeId;
  if (!eb || istEingang(st0.boards.find((b) => b.id === ziel)) || !st0.boards.some((b) => b.id === ziel)) return 0;
  const wahl = new Set(gruppen);
  const liste = eintraege(eb).filter((e) => wahl.has(e.id)).reverse();   // älteste zuerst: links
  if (!liste.length) return 0;
  if (st0.view !== 'board') st0.setView('board');
  if (st0.tasksOpen) st0.setTasksOpen(false);
  if (st0.activeId !== ziel) st0.openBoard(ziel);
  // Ziel und Eingang in EINEM Schritt sichern — Strg+Z legt die Karten zurück in den Eingang, ohne das Board zu wechseln
  useBoard.getState().pushHistoryBoards([eb.id]);

  // Jede Sendung als Block, nebeneinander mit Abstand
  const bloecke: Array<{ nodes: AppNode[]; dx: number }> = [];
  let x = 0;
  let h = 0;
  for (const e of liste) {
    const minX = Math.min(...e.nodes.map((n) => n.position.x));
    const maxX = Math.max(...e.nodes.map((n) => n.position.x + breite(n)));
    const minY = Math.min(...e.nodes.map((n) => n.position.y));
    const maxY = Math.max(...e.nodes.map((n) => n.position.y + hoehe(n)));
    bloecke.push({ nodes: e.nodes.map((n) => ({ ...n, position: { x: n.position.x - minX + x, y: n.position.y - minY } }) as AppNode), dx: x });
    x += maxX - minX + 40;
    h = Math.max(h, maxY - minY);
  }
  const w = x - 40;
  const zielBoard = useBoard.getState().boards.find((b) => b.id === ziel) as BoardDoc;
  const lage = an ?? findFreeSpot(zielBoard.nodes, sichtMitte(w, h), { w, h });
  const ids = new Set(liste.flatMap((e) => e.nodes.map((n) => n.id)));
  const geholt = bloecke.flatMap((b) => b.nodes).map((n) => ohneMarke({
    ...n, selected: true, position: { x: n.position.x + lage.x, y: n.position.y + lage.y },
  } as AppNode));
  useBoard.setState((s) => ({
    boards: s.boards.map((b) => {
      if (istEingang(b)) return { ...b, nodes: b.nodes.filter((n) => !ids.has(n.id)) };
      if (b.id === ziel) return { ...b, nodes: [...b.nodes.map((n) => (n.selected ? { ...n, selected: false } as AppNode : n)), ...geholt] };
      return b;
    }),
  }));
  useBoard.getState().showToast(
    `${zahlWort(geholt.length, 'Karte', 'Karten')} aus dem Eingang auf „${zielBoard.name}" – Strg+Z legt sie zurück.`,
    'schritt',
  );
  return geholt.length;
}

/** Einträge aus dem Eingang löschen — mit Rückgängig (der Schritt sichert das offene Board mit, bleibt also dort) */
export function eingangLoeschen(gruppen: string[]): number {
  const st = useBoard.getState();
  const eb = eingangBoard(st.boards);
  if (!eb) return 0;
  const wahl = new Set(gruppen);
  const liste = eintraege(eb).filter((e) => wahl.has(e.id));
  if (!liste.length) return 0;
  const ids = new Set(liste.flatMap((e) => e.nodes.map((n) => n.id)));
  st.pushHistoryBoards([eb.id]);
  useBoard.setState((s) => ({ boards: s.boards.map((b) => (istEingang(b) ? { ...b, nodes: b.nodes.filter((n) => !ids.has(n.id)) } : b)) }));
  useBoard.getState().showToast(`${zahlWort(liste.length, 'Eintrag', 'Einträge')} aus dem Eingang gelöscht.`, 'schritt');
  return liste.length;
}

/** Eingang öffnen, optional bei einem bestimmten Eintrag */
export function eingangOeffnen(gruppe?: string): void {
  window.dispatchEvent(new CustomEvent(EINGANG_OEFFNEN, { detail: { gruppe } }));
}

/**
 * Der Eingang ist nie das aktive Board. Rückfallwege („erstes Board"), Sprünge aus Suche und Gehirn (focusNode),
 * ein Abgleich, der ihn an den Anfang der Liste legt — was auch immer ihn aktiv setzt, landet wieder auf dem
 * zuletzt offenen Board; ein Sprung zu einer Eingangs-Karte öffnet stattdessen die Eingangs-Liste.
 */
export function eingangWaechter(): () => void {
  let zuletzt = istEingang(useBoard.getState().boards.find((b) => b.id === useBoard.getState().activeId)) ? '' : useBoard.getState().activeId;
  return useBoard.subscribe((s) => {
    if (s.activeId !== EINGANG_ID && !istEingang(s.boards.find((b) => b.id === s.activeId))) { zuletzt = s.activeId; return; }
    const zurueck = s.boards.find((b) => b.id === zuletzt && !istEingang(b))?.id
      ?? s.boards.find((b) => !istEingang(b) && !b.archived)?.id
      ?? s.boards.find((b) => !istEingang(b))?.id;
    if (!zurueck) return;
    // Wer zu einer Karte im Eingang springen wollte (focusNode merkt sie), bekommt die Liste bei diesem Eintrag
    const fokus = s.pendingFocus;
    const karte = fokus?.boardId === s.activeId ? s.boards.find((b) => b.id === s.activeId)?.nodes.find((n) => n.id === fokus.nodeId) : undefined;
    useBoard.setState({ activeId: zurueck, ...(fokus?.boardId === s.activeId ? { pendingFocus: null } : {}) });
    eingangOeffnen(karte ? (marke(karte)?.gruppe ?? karte.id) : undefined);
  });
}
