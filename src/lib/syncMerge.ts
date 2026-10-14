// M311: Drei-Wege-Zusammenführung für die Synchronisation.
//
// Bisher kannte der Sync nur „Stand ersetzen": Lag im Ordner ein fremder
// Stand und gab es hier eigene Änderungen, blieb nur „laden ODER
// überschreiben" — eine Seite verlor immer. Für einen Ordner, den der
// Nextcloud-Client zwischen zwei Rechnern spiegelt, ist das kein Sync, sondern
// ein Münzwurf.
//
// Jetzt kennt jedes Gerät den BASIS-Stand (was es zuletzt mit dem Ordner
// getauscht hat). Mit Basis, lokalem Stand und Ordner-Stand ist für jedes
// Board, jede Karte, jeden Pfeil, Strich und Kommentar entscheidbar, WER etwas
// geändert hat:
//
//   · nur eine Seite geändert   → diese Fassung gilt
//   · beide Seiten geändert     → eine Ebene tiefer (Board → Karten); erst auf
//                                 Karten-Ebene gewinnt die hiesige Fassung
//   · drüben gelöscht           → hier auch weg, AUSSER es wurde hier bearbeitet
//   · drüben neu                → kommt dazu
//
// Ohne Basis (erster Abgleich nach dem Umstieg) wird nichts gelöscht — nur
// vereinigt; Löschungen braucht eine Basis, sonst wären sie von „neu" nicht
// zu unterscheiden.
//
// Das Modul ist absichtlich frei von Store-Zugriffen: Eingabe drei Stände,
// Ausgabe ein Stand plus Bericht. Unveränderte lokale Objekte bleiben
// referenzgleich, damit die Oberfläche nichts neu zeichnet, was sich nicht
// geändert hat.
import type { Edge } from '@xyflow/react';
import type { BoardDoc, CommentThread, Project, Space, Stroke } from '../store';
import type { AppNode } from '../types';

export interface SyncStand { boards: BoardDoc[]; spaces: Space[] }

export interface MergeBericht {
  /** Boards, die eine Fassung von drüben (ganz oder teilweise) übernommen haben */
  aktualisiert: number;
  /** Boards, die drüben neu waren */
  neu: number;
  /** Boards, die drüben gelöscht wurden und hier unverändert waren */
  entfernt: number;
  /** Karten/Pfeile/Striche, die auf BEIDEN Seiten geändert waren (hiesige gilt) */
  konflikte: number;
}

export interface MergeErgebnis extends SyncStand {
  bericht: MergeBericht;
  /** Kennungen der Boards, deren Ergebnis vom lokalen Stand abweicht */
  geaendert: string[];
  /** true = der lokale Stand muss durch das Ergebnis ersetzt werden */
  lokalNeu: boolean;
  /** true = die Gegenseite (Ordner/Server) kennt das Ergebnis noch nicht */
  fremdNeu: boolean;
}

interface Zaehler { konflikte: number }

const str = (x: unknown): string | undefined => (x === undefined ? undefined : JSON.stringify(x));

const byId = <T extends { id: string }>(xs: T[]): Map<string, T> => new Map(xs.map((x) => [x.id, x]));

/**
 * Drei-Wege-Entscheid für EIN Objekt mit Kennung. `tief` führt zwei geänderte
 * Fassungen zusammen; fehlt es, gewinnt die hiesige (und es zählt als
 * Konflikt). `undefined` als Ergebnis heißt: Objekt fällt weg.
 */
function entscheide<T>(
  basis: T | undefined,
  lokal: T | undefined,
  fremd: T | undefined,
  tief: ((basis: T | undefined, lokal: T, fremd: T) => T) | undefined,
  z: Zaehler,
  vermerk?: (was: 'fremd' | 'neu' | 'entfernt') => void,
): T | undefined {
  if (lokal !== undefined && fremd !== undefined) {
    const sL = str(lokal);
    const sF = str(fremd);
    if (sL === sF) return lokal;
    const sB = str(basis);
    if (sB !== undefined && sL === sB) { vermerk?.('fremd'); return fremd; }   // nur drüben geändert
    if (sB !== undefined && sF === sB) return lokal;                            // nur hier geändert
    if (tief) { vermerk?.('fremd'); return tief(basis, lokal, fremd); }        // beide → eine Ebene tiefer
    z.konflikte += 1;
    return lokal;
  }
  if (lokal !== undefined) {
    if (basis === undefined) return lokal;                                      // hier neu (oder Basis unbekannt)
    if (str(lokal) === str(basis)) { vermerk?.('entfernt'); return undefined; } // drüben gelöscht, hier unverändert
    return lokal;                                                               // Bearbeitung schlägt Löschen
  }
  if (fremd !== undefined) {
    if (basis === undefined) { vermerk?.('neu'); return fremd; }                // drüben neu
    if (str(fremd) === str(basis)) return undefined;                            // hier gelöscht, drüben unverändert
    vermerk?.('neu');
    return fremd;                                                               // drüben bearbeitet → kommt zurück
  }
  return undefined;
}

/**
 * Reihenfolge zweier Kennungslisten vereinigen. Rückgrat ist die Liste der
 * Seite, die umsortiert hat — hat nur drüben jemand sortiert, folgt die hiesige
 * Liste. Das ist wichtig, damit zwei Geräte nicht endlos abwechselnd ihre
 * eigene Reihenfolge in den Ordner schreiben. Kennungen, die nur die andere
 * Seite kennt, rücken hinter ihren dortigen Vorgänger.
 */
function reihenfolge(basis: string[] | undefined, lokal: string[], fremd: string[]): string[] {
  const gleich = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const fremdFuehrt = !!basis && gleich(lokal, basis) && !gleich(fremd, basis);
  const [erst, zweit] = fremdFuehrt ? [fremd, lokal] : [lokal, fremd];
  const out = [...erst];
  const drin = new Set(out);
  zweit.forEach((id, i) => {
    if (drin.has(id)) return;
    let pos = out.length;
    for (let j = i - 1; j >= 0; j -= 1) {
      const k = out.indexOf(zweit[j]);
      if (k >= 0) { pos = k + 1; break; }
    }
    out.splice(pos, 0, id);
    drin.add(id);
  });
  return out;
}

/** Listen gleichartiger Objekte (Karten, Pfeile, Striche, Kommentare) je Kennung zusammenführen */
function mergeListe<T extends { id: string }>(
  basis: T[] | undefined,
  lokal: T[],
  fremd: T[],
  z: Zaehler,
  tief?: (basis: T | undefined, lokal: T, fremd: T) => T,
): T[] {
  const mB = basis ? byId(basis) : undefined;
  const mL = byId(lokal);
  const mF = byId(fremd);
  const out: T[] = [];
  for (const id of reihenfolge(basis?.map((x) => x.id), lokal.map((x) => x.id), fremd.map((x) => x.id))) {
    const w = entscheide(mB?.get(id), mL.get(id), mF.get(id), tief, z);
    if (w !== undefined) out.push(w);
  }
  return out;
}

/** Zwei geänderte Fassungen eines Kommentar-Gesprächs: Beiträge vereinigen */
function mergeThread(basis: CommentThread | undefined, lokal: CommentThread, fremd: CommentThread): CommentThread {
  const key = (m: CommentThread['msgs'][number]) => `${m.author}\u0000${m.at}\u0000${m.text}`;
  const drin = new Set(lokal.msgs.map(key));
  const msgs = [...lokal.msgs];
  for (const m of fremd.msgs) if (!drin.has(key(m))) msgs.push(m);
  msgs.sort((a, b) => a.at.localeCompare(b.at));
  const resolved = basis && lokal.resolved === basis.resolved ? fremd.resolved : lokal.resolved;
  return { ...lokal, msgs, ...(resolved === undefined ? {} : { resolved }) };
}

/** Zwei geänderte Fassungen EINES Boards: Felder dreiwegig, Inhalte je Kennung */
function mergeBoard(basis: BoardDoc | undefined, lokal: BoardDoc, fremd: BoardDoc, z: Zaehler): BoardDoc {
  const feld = <K extends keyof BoardDoc>(k: K): BoardDoc[K] =>
    (basis && str(lokal[k]) === str(basis[k]) ? fremd[k] : lokal[k]);
  const nodes = mergeListe<AppNode>(basis?.nodes, lokal.nodes, fremd.nodes, z);
  const da = new Set(nodes.map((n) => n.id));
  const edges = mergeListe<Edge>(basis?.edges, lokal.edges, fremd.edges, z)
    .filter((e) => da.has(e.source) && da.has(e.target));
  const drawings = mergeListe<Stroke>(basis?.drawings, lokal.drawings ?? [], fremd.drawings ?? [], z)
    .filter((s) => !s.anchor || da.has(s.anchor));
  const comments = mergeListe<CommentThread>(basis?.comments, lokal.comments ?? [], fremd.comments ?? [], z, mergeThread)
    .filter((c) => da.has(c.nodeId));
  const out: BoardDoc = { ...lokal, nodes, edges };
  const name = feld('name');
  if (name) out.name = name;
  const bg = feld('bg');
  if (bg === undefined) delete out.bg; else out.bg = bg;
  const archived = feld('archived');
  if (archived === undefined) delete out.archived; else out.archived = archived;
  if (lokal.drawings || fremd.drawings) out.drawings = drawings;
  if (lokal.comments || fremd.comments) out.comments = comments;
  return out;
}

/** Zwei geänderte Fassungen EINES Projekts: Name/Sortierung dreiwegig, Board-Liste vereinigt */
function mergeProjekt(basis: Project | undefined, lokal: Project, fremd: Project): Project {
  const out: Project = { ...lokal, boardIds: reihenfolge(basis?.boardIds, lokal.boardIds, fremd.boardIds) };
  if (basis && lokal.name === basis.name) out.name = fremd.name;
  if (basis && lokal.sortierung === basis.sortierung) {
    if (fremd.sortierung === undefined) delete out.sortierung; else out.sortierung = fremd.sortierung;
  }
  return out;
}

/** Hülle eines Bereichs: entscheidet über „geändert" und „gelöscht", ohne die Projekte selbst */
interface BereichHuelle { id: string; name: string; projekte: string[] }
const huelle = (sp: Space): BereichHuelle => ({ id: sp.id, name: sp.name, projekte: sp.projects.map((p) => p.id) });

interface Platz { space: string; p: Project }
const flach = (spaces: Space[]): Map<string, Platz> => {
  const m = new Map<string, Platz>();
  for (const sp of spaces) for (const p of sp.projects) m.set(p.id, { space: sp.id, p });
  return m;
};

/**
 * Bereiche und Projekte zusammenführen. Jedes übrig gebliebene Board landet
 * in genau einem Projekt: Doppelte werden auf das erste Vorkommen reduziert,
 * Waisen (Projekt drüben gelöscht, Board hier bearbeitet) kommen ins erste
 * Projekt — lieber sichtbar am falschen Platz als unsichtbar.
 */
function mergeHierarchie(basis: Space[] | undefined, lokal: Space[], fremd: Space[], boardIds: string[], z: Zaehler): Space[] {
  const hB = basis ? byId(basis.map(huelle)) : undefined;
  const hL = byId(lokal.map(huelle));
  const hF = byId(fremd.map(huelle));
  const pB = basis ? flach(basis) : undefined;
  const pL = flach(lokal);
  const pF = flach(fremd);
  const nachName = byId(lokal).size ? byId([...lokal, ...fremd]) : byId(fremd);

  // 1) Bereiche
  const bereiche: Array<BereichHuelle & { projects: Project[] }> = [];
  for (const id of reihenfolge(basis?.map((s) => s.id), lokal.map((s) => s.id), fremd.map((s) => s.id))) {
    const w = entscheide<BereichHuelle>(hB?.get(id), hL.get(id), hF.get(id), (b, l, f) => ({
      id,
      name: b && l.name === b.name ? f.name : l.name,
      projekte: reihenfolge(b?.projekte, l.projekte, f.projekte),
    }), z);
    if (w) bereiche.push({ ...w, projects: [] });
  }
  if (bereiche.length === 0) {
    const erster = nachName.values().next().value as Space | undefined;
    bereiche.push({ id: erster?.id ?? 'bereich', name: erster?.name ?? 'Allgemein', projekte: [], projects: [] });
  }

  // 2) Projekte entscheiden und platzieren
  const projekte = new Map<string, { space: string; p: Project }>();
  const ids = reihenfolge(pB ? [...pB.keys()] : undefined, [...pL.keys()], [...pF.keys()]);
  for (const id of ids) {
    const b = pB?.get(id);
    const l = pL.get(id);
    const f = pF.get(id);
    const p = entscheide<Project>(b?.p, l?.p, f?.p, mergeProjekt, z);
    if (!p) continue;
    // Platz: folgt der Seite, die das Projekt verschoben hat
    let space = l?.space ?? f?.space ?? bereiche[0].id;
    if (l && f && b && l.space === b.space && f.space !== b.space) space = f.space;
    if (!bereiche.some((s) => s.id === space)) space = (l && bereiche.some((s) => s.id === l.space) ? l.space : f && bereiche.some((s) => s.id === f.space) ? f.space : bereiche[0].id);
    projekte.set(id, { space, p });
  }
  for (const sp of bereiche) {
    for (const pid of sp.projekte) {
      const e = projekte.get(pid);
      if (e && e.space === sp.id) sp.projects.push(e.p);
    }
    for (const [pid, e] of projekte) {
      if (e.space === sp.id && !sp.projects.some((p) => p.id === pid)) sp.projects.push(e.p);
    }
  }

  // 3) Jedes Board genau einmal, Waisen ins erste Projekt
  const erlaubt = new Set(boardIds);
  const gesehen = new Set<string>();
  for (const sp of bereiche) {
    sp.projects = sp.projects.map((p) => {
      const liste = p.boardIds.filter((id) => erlaubt.has(id) && !gesehen.has(id) && (gesehen.add(id), true));
      return liste.length === p.boardIds.length && liste.every((id, i) => id === p.boardIds[i]) ? p : { ...p, boardIds: liste };
    });
  }
  const waisen = boardIds.filter((id) => !gesehen.has(id));
  if (waisen.length) {
    const ziel = bereiche.find((s) => s.projects.length > 0) ?? bereiche[0];
    if (ziel.projects.length === 0) ziel.projects.push({ id: `projekt-${ziel.id}`, name: 'Allgemein', boardIds: [] });
    ziel.projects[0] = { ...ziel.projects[0], boardIds: [...ziel.projects[0].boardIds, ...waisen] };
  }
  return bereiche.map(({ id, name, projects }) => ({ id, name, projects }));
}

/**
 * Drei Stände zusammenführen. `basis` = null, wenn dieses Gerät noch keinen
 * gemeinsamen Stand kennt — dann wird nur vereinigt, nie gelöscht.
 */
export function dreiWegeMerge(basis: SyncStand | null, lokal: SyncStand, fremd: SyncStand): MergeErgebnis {
  const z: Zaehler = { konflikte: 0 };
  const bericht: MergeBericht = { aktualisiert: 0, neu: 0, entfernt: 0, konflikte: 0 };
  const mB = basis ? byId(basis.boards) : undefined;
  const mL = byId(lokal.boards);
  const mF = byId(fremd.boards);
  const boards: BoardDoc[] = [];
  const geaendert: string[] = [];
  const ids = reihenfolge(basis?.boards.map((b) => b.id), lokal.boards.map((b) => b.id), fremd.boards.map((b) => b.id));
  for (const id of ids) {
    const l = mL.get(id);
    const w = entscheide<BoardDoc>(mB?.get(id), l, mF.get(id), (b, lo, fr) => mergeBoard(b, lo, fr, z), z, (was) => {
      if (was === 'fremd') bericht.aktualisiert += 1;
      else if (was === 'neu') bericht.neu += 1;
      else bericht.entfernt += 1;
    });
    if (w !== undefined) boards.push(w);
    // Abweichung vom lokalen Stand merken (für Undo-Verlauf und Neuaufbau der Ansicht)
    if ((w === undefined) !== (l === undefined) || (w !== undefined && l !== undefined && w !== l && str(w) !== str(l))) geaendert.push(id);
  }
  bericht.konflikte = z.konflikte;
  const spaces = mergeHierarchie(basis?.spaces, lokal.spaces, fremd.spaces, boards.map((b) => b.id), z);

  const gleicheBoards = (a: BoardDoc[], b: BoardDoc[]) =>
    a.length === b.length && a.every((x, i) => x === b[i] || (x.id === b[i].id && str(x) === str(b[i])));
  const lokalNeu = !gleicheBoards(boards, lokal.boards) || str(spaces) !== str(lokal.spaces);
  const fremdNeu = !gleicheBoards(boards, fremd.boards) || str(spaces) !== str(fremd.spaces);
  return { boards, spaces, bericht, geaendert, lokalNeu, fremdNeu };
}

/** Ein Satz für den Toast: was der Abgleich gebracht hat */
export function berichtAlsSatz(b: MergeBericht): string {
  const teile: string[] = [];
  if (b.aktualisiert) teile.push(`${b.aktualisiert} Board${b.aktualisiert === 1 ? '' : 's'} aktualisiert`);
  if (b.neu) teile.push(`${b.neu} neu`);
  if (b.entfernt) teile.push(`${b.entfernt} entfernt`);
  if (b.konflikte) teile.push(`${b.konflikte} Karte${b.konflikte === 1 ? '' : 'n'} doppelt bearbeitet (hiesige Fassung gilt)`);
  return teile.length ? teile.join(', ') : 'nichts zu ändern';
}
