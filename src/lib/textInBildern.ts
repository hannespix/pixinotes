/**
 * M452: Text in Bildern finden.
 *
 * Screenshots sind im Büro die häufigste Bild-Karte — und bisher für die Suche unsichtbar: Wer nach
 * „Rechnungsnummer" sucht, fand den Screenshot der Rechnung nicht. Jetzt liest PixiNotes den Text im
 * Bild selbst, lokal im Browser (Deutsch + Englisch), und legt ihn an der Karte ab (`ocrText`,
 * `ocrAm`, `ocrFuer` in data). Die Suche (Strg+K) findet ihn, die KI-Module lesen ihn mit, und über
 * ⋯ lässt er sich kopieren.
 *
 * Leitlinien:
 *   · Nie den Start bremsen: Diese Datei ist klein und hängt am Start; die Engine (ocrEngine.ts mit
 *     tesseract.js) kommt per `import()` erst, wenn wirklich ein Bild ohne Text wartet — und dann nur,
 *     wenn der Rechner ruhig ist (requestIdleCallback), ein Bild nach dem anderen.
 *   · Die Erkennung selbst läuft im Web Worker von tesseract.js, nicht im Haupt-Thread.
 *   · Der erkannte Text ist abgeleitet (jederzeit neu zu gewinnen): Er wird mit runDerived +
 *     mutedHistory geschrieben — kein Undo-Schritt, kein „lokal bearbeitet" für den Sync-Abgleich.
 *   · Abschaltbar unter Einstellungen → Dienste → „Text in Bildern" (eigener localStorage-Schlüssel,
 *     wie eine Vorliebe — kein Board-Inhalt).
 */
import { useSyncExternalStore } from 'react';
import { mutedHistory, runDerived, useBoard } from '../store';
import type { AppNode } from '../types';
import { loadFile, vorschauArt } from './fileStore';

/* ───────────── Einstellung ───────────── */

const SCHLUESSEL = 'pixinotes-bildtext';
const hoerer = new Set<() => void>();

export function bildTextAn(): boolean {
  try { return localStorage.getItem(SCHLUESSEL) !== 'aus'; } catch { return true; }
}

export function setBildTextAn(an: boolean): void {
  try { localStorage.setItem(SCHLUESSEL, an ? 'an' : 'aus'); } catch { /* privates Fenster */ }
  hoerer.forEach((f) => f());
  if (an) planen(800);
}

export function useBildTextAn(): boolean {
  return useSyncExternalStore((f) => { hoerer.add(f); return () => { hoerer.delete(f); }; }, bildTextAn, () => true);
}

/* ───────────── Welche Karten ───────────── */

/** Ist diese Karte ein Bild, dessen Text sich erkennen lässt? */
export function istBildKarte(n: AppNode): boolean {
  if (n.type === 'image') return typeof n.data.src === 'string' && n.data.src.length > 0;
  if (n.type === 'file') {
    const d = n.data;
    return vorschauArt(String(d.name ?? ''), d.mime) === 'bild' && (!!d.dataUrl || d.lokal === true);
  }
  return false;
}

/** Kurzer Fingerabdruck einer Zeichenkette (Länge + Stichproben) — reicht, um ein geändertes Bild zu bemerken */
function streuwert(s: string): string {
  let h = 5381;
  const schritt = Math.max(1, Math.floor(s.length / 4096));
  for (let i = 0; i < s.length; i += schritt) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length.toString(36)}-${h.toString(36)}`;
}

export function bildFingerabdruck(n: AppNode): string {
  if (n.type === 'image') return streuwert(n.data.src);
  if (n.type === 'file') {
    const d = n.data;
    return d.dataUrl ? streuwert(d.dataUrl) : `datei-${d.size}-${streuwert(String(d.name ?? ''))}`;
  }
  return '';
}

/** Erkannter Text einer Karte (nur, wenn er zum aktuellen Bild gehört) */
export function bildText(n: AppNode): string {
  if (n.type !== 'image' && n.type !== 'file') return '';
  const t = (n.data as { ocrText?: unknown }).ocrText;
  return typeof t === 'string' ? t : '';
}

const wartet = (n: AppNode): boolean =>
  istBildKarte(n) && (n.data as { ocrFuer?: string }).ocrFuer !== bildFingerabdruck(n);

/* ───────────── Bild vorbereiten ───────────── */

/**
 * Bild auf weißen Grund malen und als PNG übergeben: Freigestellte Grafiken (schwarze Schrift auf
 * Durchsichtigem) läse die Engine sonst als Schwarz auf Schwarz, und SVG kennt sie gar nicht.
 * Sehr große Bilder werden verkleinert, kleine Ausschnitte vergrößert (die Engine mag ~30 px hohe Schrift).
 */
async function alsPng(quelle: string): Promise<Blob> {
  const bild = new Image();
  bild.decoding = 'async';
  bild.src = quelle;
  await bild.decode();
  const w0 = bild.naturalWidth || 800;
  const h0 = bild.naturalHeight || 600;
  const lang = Math.max(w0, h0);
  const faktor = lang > 2400 ? 2400 / lang : lang < 900 ? Math.min(2, 1600 / lang) : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * faktor));
  c.height = Math.max(1, Math.round(h0 * faktor));
  const g = c.getContext('2d');
  if (!g) throw new Error('Kein Canvas');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bild, 0, 0, c.width, c.height);
  return new Promise((ok, fehler) => c.toBlob((b) => (b ? ok(b) : fehler(new Error('Kein PNG'))), 'image/png'));
}

async function bildDaten(n: AppNode): Promise<Blob | null> {
  if (n.type === 'image') return alsPng(n.data.src);
  if (n.type === 'file') {
    if (n.data.dataUrl) return alsPng(n.data.dataUrl);
    const blob = await loadFile(n.id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    try { return await alsPng(url); } finally { URL.revokeObjectURL(url); }
  }
  return null;
}

/* ───────────── Erkennen ───────────── */

/** In dieser Sitzung gescheitert (Bild kaputt) — nicht in Dauerschleife wiederholen */
const gescheitert = new Set<string>();
/** Die Engine ließ sich nicht laden (portable Datei ohne Netz) — für diese Sitzung aufgeben */
let engineFehlt = false;
let laeuft = false;
let geplant: ReturnType<typeof setTimeout> | null = null;

function finde(boardId: string, nodeId: string): AppNode | undefined {
  return useBoard.getState().boards.find((b) => b.id === boardId)?.nodes.find((n) => n.id === nodeId);
}

function schreiben(boardId: string, n: AppNode, fp: string, text: string): void {
  runDerived(() => mutedHistory(() => useBoard.getState().updateNodeDataOnBoard(boardId, n.id, {
    ocrText: text, ocrAm: Date.now(), ocrFuer: fp,
  })));
}

/** Ein Bild erkennen und den Text an der Karte ablegen. Liefert den Text (oder null bei Fehler). */
async function erkenneKarte(boardId: string, nodeId: string): Promise<string | null> {
  const n = finde(boardId, nodeId);
  if (!n || !istBildKarte(n)) return null;
  const fp = bildFingerabdruck(n);
  const schluessel = `${nodeId}:${fp}`;
  let engine: typeof import('./ocrEngine');
  try {
    engine = await import('./ocrEngine');
  } catch {
    engineFehlt = true;
    return null;
  }
  try {
    const daten = await bildDaten(n);
    if (!daten) { gescheitert.add(schluessel); return null; }
    const text = await engine.erkenne(daten);
    // Inzwischen gelöscht oder bearbeitet? Dann gehört der Text nicht mehr zu diesem Bild.
    const jetzt = finde(boardId, nodeId);
    if (!jetzt || bildFingerabdruck(jetzt) !== fp) return null;
    schreiben(boardId, jetzt, fp, text);
    return text;
  } catch (e) {
    // Netz/Engine (Worker, Kern, Sprachdaten) — nicht Karte für Karte erneut versuchen
    if (/fetch|network|load|importScripts|worker|NetworkError/i.test(String((e as Error)?.message ?? e))) engineFehlt = true;
    gescheitert.add(schluessel);
    return null;
  }
}

/** Nächstes wartendes Bild — das offene Board zuerst, Leser-Boards (geteilt, nur lesen) nie */
function naechstes(): { boardId: string; nodeId: string } | null {
  const s = useBoard.getState();
  const boards = [...s.boards].sort((a, b) => Number(b.id === s.activeId) - Number(a.id === s.activeId));
  for (const b of boards) {
    if (b.geteiltRolle === 'lesen') continue;
    for (const n of b.nodes) {
      if (wartet(n) && !gescheitert.has(`${n.id}:${bildFingerabdruck(n)}`)) return { boardId: b.id, nodeId: n.id };
    }
  }
  return null;
}

const imLeerlauf = (f: () => void): void => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 15_000 });
  else setTimeout(f, 1500);
};

function planen(verzug = 2500): void {
  if (geplant || laeuft || engineFehlt || !bildTextAn()) return;
  geplant = setTimeout(() => {
    geplant = null;
    imLeerlauf(() => { void arbeiten(); });
  }, verzug);
}

async function arbeiten(): Promise<void> {
  if (laeuft || engineFehlt || !bildTextAn()) return;
  // Verdeckter Tab: warten, bis wieder jemand hinschaut (Akku, Lüfter)
  if (document.visibilityState === 'hidden') { planen(10_000); return; }
  const auftrag = naechstes();
  if (!auftrag) return;
  laeuft = true;
  try { await erkenneKarte(auftrag.boardId, auftrag.nodeId); } finally { laeuft = false; }
  planen(600);
}

/** Sofort erkennen (⋯ → „Text im Bild erkennen") — wartet nicht auf den Leerlauf */
export async function bildTextJetzt(boardId: string, nodeId: string): Promise<string | null> {
  engineFehlt = false;
  const n = finde(boardId, nodeId);
  if (n) gescheitert.delete(`${nodeId}:${bildFingerabdruck(n)}`);
  while (laeuft) await new Promise((ok) => setTimeout(ok, 200));
  laeuft = true;
  try { return await erkenneKarte(boardId, nodeId); } finally { laeuft = false; planen(1500); }
}

let gestartet = false;
/**
 * Einmal beim Start (App.tsx): Erst nach dem Laden und einer Atempause schauen, ob Bilder warten; danach
 * bei jeder Änderung der Boards (eingefügtes Bild) erneut — entprellt, die Arbeit selbst im Leerlauf.
 */
export function bildTextStarten(): () => void {
  if (gestartet) return () => {};
  gestartet = true;
  let letzteBoards = useBoard.getState().boards;
  const ab = useBoard.subscribe((s) => {
    if (s.boards === letzteBoards) return;
    letzteBoards = s.boards;
    planen();
  });
  const los = () => planen(4000);
  if (document.readyState === 'complete') los();
  else window.addEventListener('load', los, { once: true });
  const sichtbar = () => { if (document.visibilityState === 'visible') planen(); };
  document.addEventListener('visibilitychange', sichtbar);
  return () => {
    gestartet = false;
    ab();
    window.removeEventListener('load', los);
    document.removeEventListener('visibilitychange', sichtbar);
    if (geplant) { clearTimeout(geplant); geplant = null; }
  };
}

/** Für Prüfreihen und Fehlersuche: Stand der Warteschlange */
export function bildTextStand(): { wartend: number; laeuft: boolean; engineFehlt: boolean; an: boolean } {
  const s = useBoard.getState();
  const wartend = s.boards.reduce((z, b) => z + b.nodes.filter((n) => wartet(n)).length, 0);
  return { wartend, laeuft, engineFehlt, an: bildTextAn() };
}
