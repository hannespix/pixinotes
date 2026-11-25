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
import { bubblesMischen, type BubblesData } from './bubbles';
import { punkteMischen } from './punkte';
import { kanonText, spaeterWert, vergleichsText, zeitenVereinen, ZEIT_FELDER_DATEN, ZEIT_FELDER_KARTE } from './abgleichZeiten';
import type { BoardDoc, CommentThread, Project, Space, Stroke } from '../store';
import type { AppNode } from '../types';
import { istEingang } from './eingangId';

export interface SyncStand {
  boards: BoardDoc[]; spaces: Space[];
  /** M351: was die Seite gelöscht hat (Kennung → Zeitpunkt) — fehlt bei älteren Ständen */
  geloescht?: Record<string, string>;
}

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

interface Zaehler {
  konflikte: number;
  /** M351: Hat die fremde Seite dieses Objekt gelöscht (oder führt sie es woanders)? Fehlt bei alten Ständen */
  kennt?: (id: string) => boolean;
}

const str = (x: unknown): string | undefined => (x === undefined ? undefined : JSON.stringify(x));

const byId = <T extends { id: string }>(xs: T[]): Map<string, T> => new Map(xs.map((x) => [x.id, x]));

/** Alle Kennungen eines Stands: Boards, Karten, Pfeile, Striche, Kommentare, Bereiche, Projekte */
export function alleIds(boards: BoardDoc[], spaces: Space[] = []): Set<string> {
  const ids = new Set<string>();
  for (const b of boards) {
    ids.add(b.id);
    for (const n of b.nodes) ids.add(n.id);
    for (const e of b.edges ?? []) ids.add(e.id);
    for (const s of b.drawings ?? []) ids.add(s.id);
    for (const c of b.comments ?? []) ids.add(c.id);
  }
  for (const sp of spaces) { ids.add(sp.id); for (const p of sp.projects) ids.add(p.id); }
  return ids;
}

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
  /** M351: auch „nur drüben geändert" eine Ebene tiefer entscheiden (Boards: drüben fehlende Karten prüfen) */
  immerTief = false,
): T | undefined {
  if (lokal !== undefined && fremd !== undefined) {
    const sL = str(lokal);
    const sF = str(fremd);
    if (sL === sF) return lokal;
    const sB = str(basis);
    if (sB !== undefined && sL === sB) {                                        // nur drüben geändert
      vermerk?.('fremd');
      return immerTief && tief ? tief(basis, lokal, fremd) : fremd;
    }
    if (sB !== undefined && sF === sB) return lokal;                            // nur hier geändert
    if (tief) { vermerk?.('fremd'); return tief(basis, lokal, fremd); }        // beide → eine Ebene tiefer
    z.konflikte += 1;
    return lokal;
  }
  if (lokal !== undefined) {
    if (basis === undefined) return lokal;                                      // hier neu (oder Basis unbekannt)
    if (str(lokal) === str(basis)) {
      // M351: Drüben fehlt es — gelöscht oder nur nie gesehen (die Datei wurde überschrieben)?
      const id = (lokal as { id?: unknown }).id;
      if (z.kennt && typeof id === 'string' && !z.kennt(id)) return lokal;   // nie gesehen: bleibt
      vermerk?.('entfernt'); return undefined;                                  // drüben gelöscht, hier unverändert
    }
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
  // M362: Beiträge lassen sich bearbeiten und einzeln löschen. Ein Beitrag ist darum über Verfasser + Zeitpunkt
  // bestimmt (nicht mehr über seinen Text — sonst stünde nach einer Korrektur die alte Fassung daneben). Von zwei
  // Fassungen gilt die zuletzt bearbeitete; fehlt ein Beitrag auf einer Seite, den der gemeinsame Vorfahre noch
  // hatte, wurde er dort gelöscht — außer die andere Seite hat ihn inzwischen geändert.
  type Msg = CommentThread['msgs'][number];
  const key = (m: Msg) => `${m.author}\u0000${m.at}`;
  const B = new Map((basis?.msgs ?? []).map((m) => [key(m), m]));
  const L = new Map(lokal.msgs.map((m) => [key(m), m]));
  const F = new Map(fremd.msgs.map((m) => [key(m), m]));
  const msgs: Msg[] = [];
  for (const k of new Set([...L.keys(), ...F.keys()])) {
    const b = B.get(k); const l = L.get(k); const f = F.get(k);
    if (l && f) msgs.push((f.bearbeitet ?? '') > (l.bearbeitet ?? '') ? f : l);
    else if (l) { if (!b || b.text !== l.text) msgs.push(l); }
    else if (f) { if (!b || b.text !== f.text) msgs.push(f); }
  }
  msgs.sort((a, b) => a.at.localeCompare(b.at));
  const resolved = basis && lokal.resolved === basis.resolved ? fremd.resolved : lokal.resolved;
  return { ...lokal, msgs, ...(resolved === undefined ? {} : { resolved }) };
}

/**
 * M373: An einer Bubbles-Karte arbeiten viele zugleich — zwei Fassungen werden nie gegeneinander entschieden,
 * sondern vereinigt (jede Idee, jede Stimme ein eigener Eintrag; lib/bubbles.ts). Das gilt auch, wenn nur eine
 * Seite „geändert" hat: Der Vergleich mit der Basis sagt bei gleichzeitigen Schreibern nicht, was verloren ginge
 * (A hat seine Idee schon gesichert, dann überschreibt B mit einer Fassung, die sie nie gesehen hat).
 */
function bubblesVereinen(nodes: AppNode[], lokal: AppNode[], fremd: AppNode[]): AppNode[] {
  const mitPunkten = (n: AppNode | undefined): boolean => !!(n?.data as { punkte?: unknown } | undefined)?.punkte;
  if (!nodes.some((n) => n.type === 'bubbles') && !lokal.some(mitPunkten) && !fremd.some(mitPunkten)) return nodes;
  const mL = new Map(lokal.map((n) => [n.id, n])); const mF = new Map(fremd.map((n) => [n.id, n]));
  let geaendert = false;
  const aus = nodes.map((n0) => {
    let n = n0;
    const l = mL.get(n.id); const f = mF.get(n.id);
    if (!l || !f) return n;
    if (n.type === 'bubbles' && l.type === 'bubbles' && f.type === 'bubbles') {
      const m = bubblesMischen(l.data as Partial<BubblesData>, f.data as Partial<BubblesData>);
      const d = n.data as Partial<BubblesData>;
      // M524: nach Inhalt vergleichen, nicht nach der Reihenfolge der Schlüssel — die hängt davon ab, welches Gerät
      // mischt; zwei Geräte schrieben sich dieselbe Karte sonst endlos in ihrer eigenen Reihenfolge zu
      if (kanonText([d.ideen, d.stimmen, d.gruppen, d.abstimmung, d.regeln ?? null]) !== kanonText([m.ideen, m.stimmen, m.gruppen, m.abstimmung, m.regeln ?? null])) {
        geaendert = true;
        n = { ...n, data: { ...n.data, ...m } } as AppNode;
      }
    }
    // M377: Punkte gehören je einer Person — die Tabellen beider Seiten werden vereinigt, nie gegeneinander entschieden
    if (mitPunkten(l) || mitPunkten(f)) {
      const m = punkteMischen((l.data as { punkte?: unknown }).punkte, (f.data as { punkte?: unknown }).punkte);
      if (kanonText((n.data as { punkte?: unknown }).punkte ?? {}) !== kanonText(m)) {
        geaendert = true;
        n = { ...n, data: { ...n.data, punkte: m } } as AppNode;
      }
    }
    return n;
  });
  return geaendert ? aus : nodes;
}
/**
 * M377: die Karte ohne ihre Punkte — für die Frage, ob zwei Fassungen sich sonst unterscheiden. Ohne das, was nur
 * dem Gerät gehört (Maße, Auswahl, Zug): Die hiesige Fassung trägt es, die vom Server nie — sonst gälte jede Karte
 * mit einem eigenen Punkt als „doppelt bearbeitet", sobald drüben jemand ihren Text geändert hat.
 */
const ohnePunkte = (n: AppNode): string => {
  const { punkte: _p, ...daten } = n.data as Record<string, unknown>;
  const { measured: _m, selected: _s, dragging: _d, ...karte } = n as AppNode & { measured?: unknown; selected?: unknown; dragging?: unknown };
  // M453/M472: ohne Zeit- und Merkfelder (Kartenzeit, Spaltenzeit der Tickets, Archiv-Uhr, OCR-Zeit; Liste in
  // abgleichZeiten.ts) — zwei Geräte mit derselben Fassung, aber verschiedenen Zeitpunkten, sind sich einig
  return vergleichsText({ ...karte, data: daten } as AppNode);
};

/** M373: Was an einer Bubbles-Karte ohnehin vereinigt wird (bubblesVereinen) — zählt nicht als „anders" */
const BUBBLES_TABELLEN = ['ideen', 'stimmen', 'gruppen', 'abstimmung', 'regeln'] as const;
/** Die Karte, wie sie verglichen wird: ohne Punkte, Geräte-Eigenes, Zeitfelder — und bei Bubbles ohne ihre Tabellen */
const vergleichsKarte = (n: AppNode): string => {
  if (n.type !== 'bubbles') return ohnePunkte(n);
  const daten = { ...(n.data as Record<string, unknown>) };
  for (const k of BUBBLES_TABELLEN) delete daten[k];
  return ohnePunkte({ ...n, data: daten } as AppNode);
};

/**
 * M524: Zwei geänderte Fassungen EINER Karte, Feld für Feld. Vorher gewann bei „beide geändert" die hiesige Karte
 * als Ganzes: Hatte ein Gerät an einem Bild nur den erkannten Text ergänzt (oder gar nichts getan — bei Bubbles-
 * Karten galt jede Fassung als „hier geändert") und ein anderes dieselbe Karte verschoben, blieb hier die alte Lage
 * und reiste von hier zurück. Jetzt gilt je Feld: nur drüben geändert → von drüben; nur hier → von hier; beide
 * verschieden → hiesig (zählt als Konflikt). Die Lage ist ein Feld, `data` wird eine Ebene tiefer entschieden.
 * Zeitfelder (abgleichZeiten.ts) nehmen den späteren Wert. Maße bleiben die hiesigen.
 */
/**
 * M528: Rechen-Tabellen mischen nach ihrem Umbau-Protokoll (lib/tabellenUmbau.ts, nachgeladen; syncFolder lädt es vor
 * dem Einarbeiten). Fügt ein Gerät eine Zeile ein und ändert ein anderes eine Zelle, wird die Änderung durch den Umbau
 * geschickt und landet in der richtigen Zelle. `null` = geht nicht (beide haben umgebaut) → Feld für Feld wie bisher.
 */
export const tabellenMischen: {
  f?: (b: Record<string, unknown>, l: Record<string, unknown>, f: Record<string, unknown>) => { daten: Record<string, unknown>; konflikt: boolean } | null;
  felder?: readonly string[];
} = {};

function karteFeldweise(b: AppNode, l: AppNode, f: AppNode, z: Zaehler): AppNode {
  type Satz = Record<string, unknown>;
  const gleich = (x: unknown, y: unknown): boolean => x === y || kanonText(x) === kanonText(y);
  let konflikt = false;
  const mische = (B: Satz, L: Satz, F: Satz, aussen: ReadonlySet<string>, zeiten: readonly string[]): Satz => {
    let aus = L;
    const setze = (k: string, v: unknown): void => {
      if (aus === L) aus = { ...L };
      if (v === undefined) delete aus[k]; else aus[k] = v;
    };
    for (const k of new Set([...Object.keys(L), ...Object.keys(F), ...Object.keys(B)])) {
      if (aussen.has(k) || gleich(L[k], F[k])) continue;
      if (zeiten.includes(k)) { const w = spaeterWert(L[k], F[k]); if (w !== L[k]) setze(k, w); continue; }
      if (gleich(L[k], B[k])) setze(k, F[k]);            // nur drüben geändert
      else if (!gleich(F[k], B[k])) konflikt = true;     // beide verschieden → die hiesige bleibt
    }
    return aus;
  };
  const tabellen: string[] = l.type === 'bubbles' && f.type === 'bubbles' ? [...BUBBLES_TABELLEN] : [];
  const karte = mische(b as unknown as Satz, l as unknown as Satz, f as unknown as Satz, new Set(['data', 'measured', 'selected', 'dragging']), ZEIT_FELDER_KARTE);
  const tab = l.type === 'sheet' && f.type === 'sheet' && tabellenMischen.f ? tabellenMischen.f((b.data ?? {}) as Satz, (l.data ?? {}) as Satz, (f.data ?? {}) as Satz) : null;
  let daten = mische((b.data ?? {}) as Satz, (l.data ?? {}) as Satz, (f.data ?? {}) as Satz, new Set(['punkte', ...tabellen, ...(tab ? tabellenMischen.felder ?? [] : [])]), ZEIT_FELDER_DATEN);
  if (tab) {
    if (tab.konflikt) konflikt = true;
    for (const [k, v] of Object.entries(tab.daten)) {
      if (gleich(daten[k], v)) continue;
      if (daten === l.data) daten = { ...daten };
      if (v === undefined) delete daten[k]; else daten[k] = v;
    }
  }
  if (konflikt) z.konflikte += 1;
  if (karte === (l as unknown as Satz) && daten === l.data) return l;
  return { ...karte, data: daten } as unknown as AppNode;
}

/**
 * M524: Im Ergebnis stehen für alles, was sich gegenüber hier nicht geändert hat, wieder die HIESIGEN Objekte
 * (Karten ohne Blick auf die Maße — die misst jedes Gerät selbst). Vorher kam ein Board, das nur drüben geändert
 * war, als Ganzes von dort: jede Karte ein neues Objekt, das ganze Board zeichnete neu — bei jeder Änderung eines
 * anderen Geräts. Ist danach alles wie hier, ist es das hiesige Board selbst.
 */
function hiesigeObjekte(w: BoardDoc, l: BoardDoc): BoardDoc {
  if (w === l) return l;
  // Hat dieses Gerät die Karte noch nie gemessen (Board hier nie geöffnet), kommt sie samt Maßen von drüben — wie bisher
  const ohneMass = (n: AppNode): string => { const { measured: m, ...rest } = n as AppNode & { measured?: unknown }; return JSON.stringify(rest) + (m === undefined ? '∅' : ''); };
  const liste = <T extends { id: string }>(neu: T[] | undefined, alt: T[] | undefined, text: (x: T) => string): T[] | undefined => {
    if (!neu || !alt || neu === alt) return neu;
    const A = new Map(alt.map((x) => [x.id, x]));
    let wieAlt = neu.length === alt.length; let ersetzt = false;
    const aus = neu.map((x, i) => {
      const a = A.get(x.id);
      if (a && (a === x || text(a) === text(x))) { if (a !== x) ersetzt = true; if (alt[i] !== a) wieAlt = false; return a; }
      wieAlt = false;
      return x;
    });
    return wieAlt ? alt : ersetzt ? aus : neu;
  };
  const roh = (x: unknown): string => JSON.stringify(x);
  const nodes = liste(w.nodes, l.nodes, ohneMass) as AppNode[];
  const edges = liste(w.edges, l.edges, roh) as Edge[];
  const drawings = liste(w.drawings, l.drawings, roh);
  const comments = liste(w.comments, l.comments, roh);
  if (nodes === w.nodes && edges === w.edges && drawings === w.drawings && comments === w.comments) return w;
  const aus: BoardDoc = { ...w, nodes, edges };
  if (drawings) aus.drawings = drawings;
  if (comments) aus.comments = comments;
  if (nodes === l.nodes && edges === l.edges && aus.drawings === l.drawings && aus.comments === l.comments) {
    const kopf = (x: BoardDoc): string => { const { nodes: _n, edges: _e, drawings: _d, comments: _c, ...rest } = x; return kanonText(rest); };
    if (kopf(aus) === kopf(l)) return l;
  }
  return aus;
}

/** Zwei geänderte Fassungen EINES Boards: Felder dreiwegig, Inhalte je Kennung */
function mergeBoard(basis: BoardDoc | undefined, lokal: BoardDoc, fremd: BoardDoc, z: Zaehler): BoardDoc {
  // M360: Nur lesend geteilt — es gilt allein der Stand des Besitzers
  if (fremd.geteiltVon && fremd.geteiltRolle === 'lesen') return fremd;
  const feld = <K extends keyof BoardDoc>(k: K): BoardDoc[K] =>
    (basis && str(lokal[k]) === str(basis[k]) ? fremd[k] : lokal[k]);
  const nodes = bubblesVereinen(
    mergeListe<AppNode>(basis?.nodes, lokal.nodes, fremd.nodes, z, (b, l, f) => {
      // M373: Die Tabellen einer Bubbles-Karte (Ideen, Stimmen …) werden danach vereinigt — hier zählt der Rest.
      // M524: Vorher gewann bei Bubbles-Karten immer die hiesige Fassung als Ganzes. „Hier geändert" ist eine solche
      // Karte aber auf jedem Gerät (allein durch die Maße): Wer sie verschob, bekam sie vom nächsten Gerät an der
      // alten Stelle zurück.
      // M377: Hat eine Seite nur Punkte vergeben, gilt der Inhalt der anderen — die Punkte werden danach vereinigt
      const lo = vergleichsKarte(l); const fo = vergleichsKarte(f);
      // M453/M472: inhaltsgleich, nur anders gestempelt — kein Konflikt; je Zeitfeld gilt der spätere Wert (auf beiden
      // Geräten gleich)
      if (lo === fo) return zeitenVereinen(l, f);
      if (b) {
        const bo = vergleichsKarte(b);
        if (bo === lo) return f;
        if (bo === fo) return l;
        return karteFeldweise(b, l, f, z);   // M524: beide geändert → Feld für Feld
      }
      if (l.type === 'bubbles' && f.type === 'bubbles') return l;
      z.konflikte += 1; return l;
    }),
    lokal.nodes, fremd.nodes);
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
  // M509: Look des Boards (beim Teilen mitgegeben) — dreiwegig wie der Hintergrund
  const look = feld('look');
  if (look === undefined) delete out.look; else out.look = look;
  const archived = feld('archived');
  if (archived === undefined) delete out.archived; else out.archived = archived;
  if (lokal.drawings || fremd.drawings) out.drawings = drawings;
  if (lokal.comments || fremd.comments) out.comments = comments;
  // M360: Mit welcher Rolle ein fremdes Board geteilt ist, sagt das Konto — nicht der hiesige Stand
  if (fremd.geteiltVon) { if (fremd.geteiltRolle) out.geteiltRolle = fremd.geteiltRolle; else delete out.geteiltRolle; }
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
 * Waisen (drüben aus dem Projekt genommen, hier bearbeitet) bleiben in ihrem
 * Projekt (M522); gibt es das nicht mehr, kommen sie ins erste Projekt —
 * lieber sichtbar am falschen Platz als unsichtbar.
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
  let waisen = boardIds.filter((id) => !gesehen.has(id));
  if (waisen.length) {
    // M522: Eine Waise bleibt in IHREM Projekt, solange es das noch gibt (hier, sonst drüben). Vorher sprang ein
    // Board, das drüben gelöscht und hier bearbeitet war, in das erste Projekt des ersten Bereichs.
    const heim = new Map<string, string>();
    for (const seite of [fremd, lokal]) for (const sp of seite) for (const p of sp.projects) for (const id of p.boardIds) heim.set(id, p.id);
    const rest: string[] = [];
    for (const id of waisen) {
      const pid = heim.get(id);
      const sp = pid ? bereiche.find((s) => s.projects.some((p) => p.id === pid)) : undefined;
      if (!sp) { rest.push(id); continue; }
      sp.projects = sp.projects.map((p) => (p.id === pid ? { ...p, boardIds: [...p.boardIds, id] } : p));
    }
    waisen = rest;
  }
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
/* ---------- Auswahl ist Sache des Geräts (M345) ----------
   React Flow hält `selected` und `dragging` AN der Karte. Beides reiste bisher mit: Was auf einem
   Gerät gewählt war, war es nach dem Abgleich auch auf dem anderen — „Entf" traf dort Karten, die
   niemand angeklickt hatte —, und bloßes Anklicken galt als Bearbeitung (lud hoch, schlug Löschen).
   Darum: ohne diese beiden Felder hochladen und zusammenführen; die Auswahl bleibt, wo sie ist. */
type Fluechtig = { id: string; selected?: boolean; dragging?: boolean };
const fluechtig = (x: Fluechtig): boolean => 'selected' in x || 'dragging' in x;
function reinListe<T extends Fluechtig>(xs: T[], zurueck?: WeakMap<object, object>): T[] {
  if (!xs.some(fluechtig)) return xs;
  return xs.map((x) => {
    if (!fluechtig(x)) return x;
    const { selected: _s, dragging: _d, ...rest } = x;
    zurueck?.set(rest, x);
    return rest as unknown as T;
  });
}
/** Board ohne Auswahl- und Zieh-Zustand seiner Karten und Pfeile; unverändert dasselbe Objekt */
export function ohneAuswahl(b: BoardDoc, zurueck?: WeakMap<object, object>): BoardDoc {
  const nodes = reinListe(b.nodes as unknown as Fluechtig[], zurueck) as unknown as AppNode[];
  const edges = b.edges ? (reinListe(b.edges as unknown as Fluechtig[], zurueck) as unknown as Edge[]) : b.edges;
  if (nodes === b.nodes && edges === b.edges) return b;
  const out: BoardDoc = { ...b, nodes, edges };
  zurueck?.set(out, b);
  return out;
}
/** Unterscheiden sich zwei Stände nur in Auswahl- und Zieh-Zustand? Dann gibt es nichts zu sichern. */
export function nurAuswahlAnders(vor: BoardDoc[], nach: BoardDoc[]): boolean {
  if (vor === nach) return true;
  if (vor.length !== nach.length) return false;
  type Satz = Record<string, unknown>;
  const gleichBis = (a: Satz, b: Satz, ohne: (k: string) => boolean): boolean => {
    for (const k in a) if (!ohne(k) && a[k] !== b[k]) return false;
    for (const k in b) if (!ohne(k) && !(k in a)) return false;
    return true;
  };
  const wahl = (k: string) => k === 'selected' || k === 'dragging';
  const liste = (a: unknown[] | undefined, b: unknown[] | undefined): boolean =>
    a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i] || gleichBis(x as Satz, b[i] as Satz, wahl)));
  return vor.every((b, i) => {
    const n = nach[i];
    if (b === n) return true;
    if (!gleichBis(b as unknown as Satz, n as unknown as Satz, (k) => k === 'nodes' || k === 'edges')) return false;
    return liste(b.nodes, n.nodes) && liste(b.edges, n.edges);
  });
}
/** Dem zusammengeführten Board die hiesige Auswahl zurückgeben (unveränderte Objekte: genau die hiesigen) */
function mitAuswahl(b: BoardDoc, hier: BoardDoc | undefined, zurueck: WeakMap<object, object>): BoardDoc {
  const original = zurueck.get(b) as BoardDoc | undefined;
  if (original) return original;
  if (!hier) return b;
  const gewaehlt = (xs: Fluechtig[] | undefined) => new Set((xs ?? []).filter((x) => x.selected).map((x) => x.id));
  const kn = gewaehlt(hier.nodes as unknown as Fluechtig[]);
  const ka = gewaehlt(hier.edges as unknown as Fluechtig[]);
  const mit = <T extends { id: string }>(xs: T[], m: Set<string>): T[] => {
    let anders = false;
    const out = xs.map((x) => {
      const o = zurueck.get(x) as T | undefined;
      if (o) { anders = true; return o; }
      if (m.has(x.id)) { anders = true; return { ...x, selected: true }; }
      return x;
    });
    return anders ? out : xs;
  };
  const nodes = mit(b.nodes, kn);
  const edges = b.edges ? mit(b.edges, ka) : b.edges;
  return nodes === b.nodes && edges === b.edges ? b : { ...b, nodes, edges };
}

export function dreiWegeMerge(basis0: SyncStand | null, lokal0: SyncStand, fremd0: SyncStand): MergeErgebnis {
  const zurueck = new WeakMap<object, object>();
  const basis = basis0 ? { ...basis0, boards: basis0.boards.map((b) => ohneAuswahl(b)) } : null;
  const lokal = { ...lokal0, boards: lokal0.boards.map((b) => ohneAuswahl(b, zurueck)) };
  const fremd = { ...fremd0, boards: fremd0.boards.map((b) => ohneAuswahl(b)) };
  const z: Zaehler = { konflikte: 0 };
  // M351: Mit Grabsteinen löscht nur, was drüben ausdrücklich gelöscht ist oder woanders liegt
  const g = fremd0.geloescht;
  if (g) {
    const drueben = alleIds(fremd0.boards, fremd0.spaces);
    z.kennt = (id) => !!g[id] || drueben.has(id);
  }
  const bericht: MergeBericht = { aktualisiert: 0, neu: 0, entfernt: 0, konflikte: 0 };
  const mB = basis ? byId(basis.boards) : undefined;
  const mL = byId(lokal.boards);
  const mF = byId(fremd.boards);
  const boards: BoardDoc[] = [];
  /** M524: dasselbe Ergebnis, aber mit den hiesigen Objekten für alles Unveränderte — das kommt in den Speicher */
  const hier0: BoardDoc[] = [];
  const geaendert: string[] = [];
  const ids = reihenfolge(basis?.boards.map((b) => b.id), lokal.boards.map((b) => b.id), fremd.boards.map((b) => b.id));
  for (const id of ids) {
    const l = mL.get(id);
    const w0 = entscheide<BoardDoc>(mB?.get(id), l, mF.get(id), (b, lo, fr) => mergeBoard(b, lo, fr, z), z, (was) => {
      if (was === 'fremd') bericht.aktualisiert += 1;
      else if (was === 'neu') bericht.neu += 1;
      else bericht.entfernt += 1;
    }, !!z.kennt);   // M351: mit Grabsteinen jede Karte einzeln — die fremde Datei kann eigene Neue nie gesehen haben
    // M373: Bubbles-Karten immer vereinigen — auch wenn das Board als Ganzes von einer Seite übernommen wurde
    const f = mF.get(id);
    const w = w0 !== undefined && l !== undefined && f !== undefined
      ? (() => { const nodes = bubblesVereinen(w0.nodes, l.nodes, f.nodes); return nodes === w0.nodes ? w0 : { ...w0, nodes }; })()
      : w0;
    const wh = w !== undefined && l !== undefined ? hiesigeObjekte(w, l) : w;
    if (w !== undefined && wh !== undefined) { boards.push(w); hier0.push(wh); }
    // Abweichung vom lokalen Stand merken (für Undo-Verlauf und Neuaufbau der Ansicht)
    if ((w === undefined) !== (l === undefined) || (wh !== undefined && l !== undefined && wh !== l && str(wh) !== str(l))) geaendert.push(id);
  }
  bericht.konflikte = z.konflikte;
  // M478: Der Eingang ist ein System-Board ohne Projekt — er gehört nicht zu den „Waisen“, die ins erste Projekt wandern
  const spaces = mergeHierarchie(basis?.spaces, lokal.spaces, fremd.spaces, boards.filter((b) => !istEingang(b)).map((b) => b.id), z);

  const gleicheBoards = (a: BoardDoc[], b: BoardDoc[]) =>
    a.length === b.length && a.every((x, i) => x === b[i] || (x.id === b[i].id && str(x) === str(b[i])));
  const fremdNeu = !gleicheBoards(boards, fremd.boards) || str(spaces) !== str(fremd.spaces);
  // die Auswahl dieses Geräts kommt zurück — verglichen wird danach mit dem Stand, wie er hier im Speicher liegt
  const hier = byId(lokal0.boards);
  const mitWahl = hier0.map((b) => mitAuswahl(b, hier.get(b.id), zurueck));
  const lokalNeu = !gleicheBoards(mitWahl, lokal0.boards) || str(spaces) !== str(lokal.spaces);
  return { boards: mitWahl, spaces, bericht, geaendert, lokalNeu, fremdNeu };
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
