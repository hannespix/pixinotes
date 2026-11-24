// M514: Rahmen für Rahmen präsentieren — direkt auf dem Board (der leichte Teil fürs Start-Paket).
//
// Wunsch: „Rahmen auch mit speziellen Rahmenpfeilen verbinden, und dann bekommt ein Rahmen bei Doppelklick auf den
// Titel einen bildschirmfüllenden Rahmenfokus, und dann kann man mit typischer Weiter-Geste und Shortcuts zum nächsten
// Rahmen springen." Anders als die Präsentation (Presenter.tsx) baut die Rahmen-Reise keine Folien nach: Die Kamera
// fährt auf der echten Fläche von Rahmen zu Rahmen, die Karten darin bleiben live und bedienbar.
//
// Hier stehen nur die Reihenfolge (sie braucht auch die Verbindung für ihre Nummer) und der Zustand „Reise läuft".
// Kamera, Leiste, Tasten und Gesten lädt components/RahmenReise.tsx erst, wenn eine Reise beginnt.
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types';
import { kartenFolge, richtung } from './kartenFolge';
import { zugLaeuft } from './zugAnzeige';

/**
 * Die Reihenfolge der Reise.
 *
 *   · Ohne Rahmenpfeile: die Reihenfolge der Kartenfolge (lib/kartenFolge.ts — dieselbe wie im Vortrag).
 *   · Mit Rahmenpfeilen (gerichtete Verbindung von Rahmen zu Rahmen): den Pfeilen nach. Eine Kette beginnt an einem
 *     Rahmen, in den kein Pfeil führt; die Ketten (und Rahmen ohne Pfeile) kommen in der Kartenfolge ihres Anfangs.
 *   · Verzweigung: Es gewinnt der zuerst gezogene Pfeil (Reihenfolge der Verbindungen im Board). Führt er zu einem
 *     schon besuchten Rahmen, gilt der nächste — so laufen Kreise nicht endlos.
 */
export function rahmenReise(nodes: AppNode[], edges: Edge[]): AppNode[] {
  const sichtbar = nodes.filter((n) => !n.archived);
  const rahmen = sichtbar.filter((n) => n.type === 'frame');
  if (!rahmen.length) return [];
  const folge = kartenFolge(sichtbar, edges).filter((n) => n.type === 'frame');
  const { aus, rein } = rahmenPfeile(rahmen, edges);
  if (!aus.size) return folge;
  const vonId = new Map(rahmen.map((n) => [n.id, n]));
  const besucht = new Set<string>(); const reise: AppNode[] = [];
  const laufe = (start: string) => {
    let id: string | undefined = start;
    while (id && !besucht.has(id)) {
      besucht.add(id); reise.push(vonId.get(id)!);
      id = (aus.get(id) ?? []).find((z) => !besucht.has(z));
    }
  };
  for (const f of folge) if (!rein.get(f.id)) laufe(f.id);
  for (const f of folge) laufe(f.id);         // Kreise ohne Anfang: am ersten Rahmen in der Kartenfolge
  return reise;
}

/** Rahmenpfeile: gerichtete Verbindungen von Rahmen zu Rahmen (ohne Selbstbezug), je Rahmen in Zieh-Reihenfolge */
function rahmenPfeile(rahmen: AppNode[], edges: Edge[]) {
  const ids = new Set(rahmen.map((n) => n.id));
  const aus = new Map<string, string[]>(); const rein = new Map<string, number>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    const r = richtung(e);
    if (!r) continue;
    const l = aus.get(r.von); if (l) l.push(r.nach); else aus.set(r.von, [r.nach]);
    rein.set(r.nach, (rein.get(r.nach) ?? 0) + 1);
  }
  return { aus, rein };
}

/**
 * Nummer eines Rahmenpfeils für die Marke auf der Fläche: der Platz seines Ziels in der Reise (1 = erster Rahmen) —
 * 0, wenn der Pfeil nicht auf dem Weg der Reise liegt (Abzweig, Rückweg in einen Kreis). Einmal je Stand gerechnet;
 * während eines Zugs (lib/zugAnzeige) gilt der letzte Stand, damit das Ziehen von Karten nicht jedes Mal die ganze
 * Kartenfolge neu rechnet (M491).
 */
let nrStand: { nodes: AppNode[] | null; edges: Edge[] | null; nr: Map<string, number> } = { nodes: null, edges: null, nr: new Map() };
export function rahmenPfeilNr(nodes: AppNode[], edges: Edge[], edgeId: string): number {
  if (nrStand.nodes !== nodes || nrStand.edges !== edges) {
    if (!(zugLaeuft() && nrStand.nodes && nrStand.edges === edges)) {
      const reise = rahmenReise(nodes, edges);
      const platz = new Map(reise.map((n, i) => [n.id, i]));
      const nr = new Map<string, number>(); const genommen = new Set<string>();
      for (const e of edges) {
        const r = richtung(e);
        const a = r ? platz.get(r.von) : undefined; const b = r ? platz.get(r.nach) : undefined;
        if (r && a !== undefined && b === a + 1 && !genommen.has(r.von)) { nr.set(e.id, b + 1); genommen.add(r.von); }
      }
      nrStand = { nodes, edges, nr };
    }
  }
  return nrStand.nr.get(edgeId) ?? 0;
}

/* ---------- Fliegt die Kamera gerade? ---------- */
// Während des Flugs rechnet das Board seine Bedien-Größe (`--pn-ui`, Board.tsx uiMelden) nicht nach: Jede Stufe davon
// ist eine Stilrechnung über das ganze Board (bei 200 Karten 5 000 Elemente, gemessen um 180 ms) — im Flug zoomt die
// Kamera durch viele Stufen. Nach der Landung einmal (Ereignis REISE_RUHT).
let fliegt = false;
export const REISE_RUHT = 'pixinotes:reise-ruht';
export const reiseFliegt = (): boolean => fliegt;
export function reiseFlugSetzen(an: boolean): void {
  if (fliegt === an) return;
  fliegt = an;
  if (!an) window.dispatchEvent(new Event(REISE_RUHT));
}

/* ---------- Läuft eine Reise? ---------- */
export interface ReiseStand {
  boardId: string;
  /** Rahmen, der gerade bildschirmfüllend zu sehen ist */
  rahmen: string;
  /** Ich folge einem Vorführenden (Live): seine Reise, nicht meine */
  gefolgt: boolean;
}
let stand: ReiseStand | null = null;
const hoerer = new Set<() => void>();
export const reiseStand = (): ReiseStand | null => stand;
export function reiseAbo(cb: () => void): () => void { hoerer.add(cb); return () => { hoerer.delete(cb); }; }
const melden = () => hoerer.forEach((h) => h());

/** Die Reise beginnt (oder springt) bei diesem Rahmen */
export function rahmenReiseStarten(boardId: string, rahmen: string, gefolgt = false): void {
  if (stand && stand.boardId === boardId && stand.rahmen === rahmen && stand.gefolgt === gefolgt) return;
  stand = { boardId, rahmen, gefolgt };
  melden();
}
/** Die Reise steht jetzt bei diesem Rahmen (RahmenReise.tsx beim Blättern) */
export function reiseRahmenSetzen(rahmen: string): void {
  if (!stand || stand.rahmen === rahmen) return;
  stand = { ...stand, rahmen };
  melden();
}
/** Wer folgt und selbst blättert, reist ab hier allein weiter */
export function reiseLoesen(): void {
  if (!stand?.gefolgt) return;
  stand = { ...stand, gefolgt: false };
  melden();
}
export function rahmenReiseBeenden(): void {
  if (!stand) return;
  stand = null;
  melden();
}

/**
 * Wo beginnt eine Reise, die nicht am Titel eines Rahmens gestartet wird (Kürzel, Menü)? Beim gewählten Rahmen, sonst
 * beim Rahmen, in dem die gewählte Karte liegt, sonst beim ersten der Reise. `null`: Das Board hat keinen Rahmen.
 */
export function reiseStart(nodes: AppNode[], edges: Edge[]): string | null {
  const reise = rahmenReise(nodes, edges);
  if (!reise.length) return null;
  const gewaehlt = nodes.filter((n) => n.selected && !n.archived);
  const rahmen = gewaehlt.find((n) => n.type === 'frame');
  if (rahmen) return rahmen.id;
  const karte = gewaehlt[0];
  if (karte) {
    const w = karte.measured?.width ?? karte.width ?? 260; const h = karte.measured?.height ?? karte.height ?? 120;
    const mx = karte.position.x + w / 2; const my = karte.position.y + h / 2;
    const drin = reise.filter((f) => {
      const fw = f.measured?.width ?? f.width ?? 0; const fh = f.measured?.height ?? f.height ?? 0;
      return mx >= f.position.x && mx <= f.position.x + fw && my >= f.position.y && my <= f.position.y + fh;
    }).sort((a, b) => ((a.width ?? 0) * (a.height ?? 0)) - ((b.width ?? 0) * (b.height ?? 0)))[0];
    if (drin) return drin.id;
  }
  return reise[0].id;
}
