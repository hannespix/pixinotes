/**
 * Schutz am set() des Speichers: Leseschutz (M360), Karten-Sperren (M364), Notiz-Schutz beim gemeinsamen
 * Tippen (M477), Gruppenrechte (M365) sowie die Haken für Persistenz und Sicherung vor Umbauten (M388/M449/M460).
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types';
import type { Stroke, BoardDoc } from './typen';
import { gleichesObjekt } from './verlauf';
import { useBoard } from '../store';

// ---------- M360: Leseschutz für nur lesend geteilte Boards ----------
// Ein Board mit geteiltRolle 'lesen' gehört einem anderen Konto und darf hier
// nicht verändert werden: Der Server nähme die Änderung ohnehin nicht an, und
// lokal stünde dann ein Stand, den es nirgends sonst gibt. Der Schutz sitzt an
// EINER Stelle — am set() des Speichers —, damit keine der vielen Karten-Arten
// und Werkzeuge vergessen wird. Auswahl und gemessene Größen (Ansicht, kein
// Inhalt) gehen durch; der Abgleich schreibt über ohneLeseschutz().
export let leseschutzAus = 0;
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
export const vorUmbauHaken: {
  sichern: (boards: BoardDoc[], grund: 'abgleich' | 'import') => void;
  /**
   * M460: Änderungen anderer (Ordner, WebDAV, Konto, Gruppe — alles, was über importSync mit `sanft` kommt) wollen
   * viele Karten dieses Boards auf einmal löschen oder ändern (`anzahl` ≥ FREMD_SCHUB_AB). Davor eigens sichern —
   * die gewöhnliche Sicherung „Vor Abgleich" ist auf eine je 10 Minuten gedrosselt und fiele gerade dann oft aus.
   * Ein Haken statt eines Imports: kontoSync/gastSync dürfen nachgeladen werden, der Store bleibt die eine Stelle.
   */
  fremdSchub: (b: BoardDoc, anzahl: number) => void;
} = { sichern: () => {}, fremdSchub: () => {} };
/** M460: Ab so vielen gelöschten oder geänderten Karten in einem Schub gilt eine Änderung von außen als groß */
export const FREMD_SCHUB_AB = 5;
/** M460: Wie viele Karten von `alt` verschwinden oder ändern sich, wenn `neu` kommt (neue Karten zählen nicht) */
export function kartenSchub(alt: AppNode[], neu: AppNode[]): number {
  if (alt === neu) return 0;
  const N = new Map(neu.map((n) => [n.id, n]));
  let z = 0;
  for (const n of alt) { const m = N.get(n.id); if (!m || (m !== n && !gleichesObjekt(n, m))) z += 1; }
  return z;
}
export const kartenSperren = new Map<string, Map<string, string>>();   // Board → Karte → Name dessen, der sie hält
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
/**
 * M477: Notizen, in denen gerade ANDERE gemeinsam tippen (Yjs, lib/notizGemeinsamKern.ts). Der Text ist frei — den
 * schreiben alle zugleich —, Lage, Farbe, Archiv und Löschen nicht: Der Schreiber sichert die ganze Karte bei jedem
 * Tastendruck; eine gleichzeitige Änderung desselben Stücks ginge im kartenweisen Abgleich verloren.
 */
export const notizSchutz = new Map<string, Map<string, string>>();   // Board → Notiz → Name eines, der darin tippt
export function setzeNotizSchutz(boardId: string, schutz: Map<string, string>): void {
  if (schutz.size) notizSchutz.set(boardId, schutz); else notizSchutz.delete(boardId);
}
/**
 * M477/M487: Die Karte `alt` mit dem gemeinsam getippten Text aus `neu` — und sonst nichts von `neu`. Notiz: die Blöcke;
 * Protokoll: die Blöcke und (M493) Beschlüsse je Sitzungstermin (Datum, Teilnehmende bleiben); Kanban: Titel und Beschreibung je
 * Ticket (Spalte, Frist, Reihenfolge, neue oder entfernte Tickets bleiben).
 */
function mitTextVon(alt: AppNode, neu: AppNode): AppNode {
  const a = alt.data as Record<string, unknown>; const b = neu.data as Record<string, unknown>;
  type Mit = { id?: unknown } & Record<string, unknown>;
  const je = (feld: string, felder: string[]): AppNode => {
    const vorher = a[feld]; const nachher = b[feld];
    if (!Array.isArray(vorher) || !Array.isArray(nachher)) return alt;
    const nach = new Map((nachher as Mit[]).map((x) => [x?.id, x]));
    const liste = (vorher as Mit[]).map((x) => {
      const m = nach.get(x?.id);
      if (!m) return x;
      const y: Mit = { ...x };
      for (const f of felder) { if (m[f] === undefined) delete y[f]; else y[f] = m[f]; }
      return y;
    });
    return { ...alt, data: { ...a, [feld]: liste } } as AppNode;
  };
  // M493: die Beschlüsse der Sitzung laufen gemeinsam ebenfalls über das Y-Dokument (lib/protokollLive.ts) — der
  // Schreiber sichert sie mit dem Text, sie gehen deshalb durch wie er
  if (alt.type === 'minutes') return je('entries', ['blocks', 'decisions']);
  if (alt.type === 'kanban') return je('items', ['text', 'note']);
  return { ...alt, data: { ...a, blocks: b.blocks } } as AppNode;
}
/** Gesperrte Karten behalten Inhalt und Lage (auch gegen Löschen); alles andere geht durch.
 *  M477: `nurText` — der Text (`data.blocks`) darf sich ändern, sonst nichts (gemeinsames Tippen) */
function sperrschutz(alt: BoardDoc, neu: BoardDoc, sperren: Map<string, string>, nurText = false): BoardDoc {
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
    const text = nurText ? mitTextVon(n, m) : n;
    if (m !== n && inhaltAnders(text, m)) {
      // Auswahl und Maße dürfen sich ändern — Inhalt und Lage nicht
      const a = text as Record<string, unknown>; const b = m as Record<string, unknown>;
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
export const gruppen = new Map<string, GruppenInfo>();
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
export function ohneStempel(fn: () => void): void {
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

/** Die Board-Liste eines set(): nur lesend geteilte Boards behalten ihren Inhalt, gesperrte Karten ihren Stand */
export function leseschutz(alt: BoardDoc[], neu: BoardDoc[]): BoardDoc[] {
  const vorher = new Map(alt.map((b) => [b.id, b]));
  let geschuetzt = false; let verworfen = false;
  const aus = neu.map((b) => {
    const a = vorher.get(b.id);
    if (!a || a === b) return b;
    if (a.geteiltRolle !== 'lesen') {
      const sperren = kartenSperren.get(b.id);
      const g = gruppen.get(b.id);
      let s = sperren ? sperrschutz(a, b, sperren) : b;
      const tippen = notizSchutz.get(b.id);
      if (tippen) s = sperrschutz(a, s, tippen, true);   // M477
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
