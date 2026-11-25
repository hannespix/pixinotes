// M351: Grabsteine — Löschungen reisen ausdrücklich mit.
//
// Der Abgleich über einen Ordner (Nextcloud, Netzlaufwerk) und WebDAV kennt kein „schreibe nur, wenn
// sich nichts geändert hat". Speichern zwei Geräte fast gleichzeitig, gewinnt die zweite Datei; in ihr
// fehlt die Karte, die das erste Gerät gerade angelegt hat. Bisher las das erste Gerät daraus „drüben
// gelöscht" und entfernte die eigene neue Karte — gleichzeitiges Arbeiten am selben Board verlor Inhalt
// (m311 D2–E3, in zwei von drei Läufen; der Fehler bestand schon vor M343).
//
// Jetzt schreibt jedes Gerät mit, was es gelöscht hat (Kennung → Zeitpunkt). Die Zusammenführung
// (syncMerge.ts) entfernt eine Karte, ein Board, einen Pfeil … nur noch, wenn die andere Seite die
// Löschung ausdrücklich nennt oder das Objekt woanders führt (verschoben). Fehlt es dort einfach, hat
// die andere Seite es nur noch nicht gesehen — es bleibt und wird beim nächsten Schreiben ergänzt.
// Dateien älterer Fassungen ohne Grabsteine werden wie bisher behandelt.
import { useBoard, type BoardDoc, type Space } from '../store';
import { alleIds } from './syncMerge';

const KEY = 'pixinotes:geloescht';
/** Wie lange ein Grabstein reist — länger als jedes Gerät realistisch ohne Abgleich bleibt */
const HALTBAR_MS = 120 * 24 * 3600 * 1000;

let steine: Record<string, string> = laden();
function laden(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
let speicherUhr: ReturnType<typeof setTimeout> | undefined;
function merken(): void {
  clearTimeout(speicherUhr);
  speicherUhr = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(steine)); } catch { /* voll — reist dann nur in dieser Sitzung */ } }, 300);
}

/** Was in `vor` stand und in `nach` fehlt — nur die Listen, die sich geändert haben, werden verglichen */
function verschwunden(vor: BoardDoc[], nach: BoardDoc[]): string[] {
  const out: string[] = [];
  const nachId = new Map(nach.map((b) => [b.id, b]));
  const liste = <T extends { id: string }>(a: T[] | undefined, b: T[] | undefined) => {
    if (!a || a === b) return;
    const da = new Set((b ?? []).map((x) => x.id));
    for (const x of a) if (!da.has(x.id)) out.push(x.id);
  };
  for (const b of vor) {
    const n = nachId.get(b.id);
    if (n === b) continue;
    if (!n) { out.push(b.id); liste(b.nodes, []); liste(b.edges, []); liste(b.drawings, []); liste(b.comments, []); continue; }
    liste(b.nodes, n.nodes); liste(b.edges, n.edges); liste(b.drawings, n.drawings); liste(b.comments, n.comments);
  }
  return out;
}

/**
 * M522: Bereiche und Projekte, die es in `vor` gab und in `nach` nirgends mehr. Bisher bekamen nur Boards, Karten,
 * Pfeile, Striche und Gespräche einen Grabstein — die Zusammenführung fragt aber auch bei Bereichen und Projekten
 * „hat die andere Seite das gelöscht oder nur nie gesehen?" (syncMerge → entscheide). Ohne Grabstein hieß die Antwort
 * immer „nie gesehen": Ein gelöschtes Projekt blieb auf dem zweiten Gerät stehen und kam von dort (leer) zurück.
 * „geteilt" ist kein eigener Bereich (ihn führt das Konto, er kommt und geht mit den Freigaben).
 */
function ebenenVerschwunden(vor: Space[], nach: Space[]): string[] {
  const da = new Set<string>();
  for (const sp of nach) { da.add(sp.id); for (const p of sp.projects) da.add(p.id); }
  const out: string[] = [];
  for (const sp of vor) {
    if (sp.id === 'geteilt') continue;
    if (!da.has(sp.id)) out.push(sp.id);
    for (const p of sp.projects) if (!da.has(p.id)) out.push(p.id);
  }
  return out;
}

export function grabsteineAufnehmen(ids: Iterable<string>, wann = new Date().toISOString()): void {
  let neu = false;
  for (const id of ids) if (!steine[id]) { steine[id] = wann; neu = true; }
  if (neu) merken();
}

/** Grabsteine der anderen Seite übernehmen — so reist eine Löschung über mehrere Geräte weiter */
export function grabsteineVereinigen(fremd: Record<string, string> | undefined): void {
  if (!fremd) return;
  let neu = false;
  for (const [id, t] of Object.entries(fremd)) if (!steine[id] || steine[id] < t) { steine[id] = t; neu = true; }
  if (neu) merken();
}

/** Für die Sync-Datei: ohne, was (wieder) da ist (Rückgängig, Verschieben), und ohne Abgelaufene */
export function grabsteineFuer(boards: BoardDoc[], spaces: Space[]): Record<string, string> {
  const da = alleIds(boards, spaces);
  const grenze = new Date(Date.now() - HALTBAR_MS).toISOString();
  const out: Record<string, string> = {};
  let aufgeraeumt = false;
  for (const [id, t] of Object.entries(steine)) {
    if (t < grenze) { delete steine[id]; aufgeraeumt = true; continue; }
    if (!da.has(id)) out[id] = t;
  }
  if (aufgeraeumt) merken();
  return out;
}

let gestartet = false;
/** Jede Löschung im Speicher wird zum Grabstein — gleich, ob per Taste, Menü, Abgleich oder KI */
export function initGrabsteine(): void {
  if (gestartet) return;
  gestartet = true;
  useBoard.subscribe((s, prev) => {
    if (s.boards === prev.boards && s.spaces === prev.spaces) return;
    const weg = s.boards === prev.boards ? [] : verschwunden(prev.boards, s.boards);
    if (s.spaces !== prev.spaces) weg.push(...ebenenVerschwunden(prev.spaces, s.spaces));   // M522
    if (weg.length) grabsteineAufnehmen(weg);
  });
}
