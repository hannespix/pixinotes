// M477: Gemeinsam in einer Notiz tippen — die leichte Weiche.
//
// Steht der Live-Kanal eines geteilten Boards (lib/liveKanal.ts, gefüllt von lib/gastSync.ts), öffnen Notizen ihren
// Editor im Modus „gemeinsam": BlockNote mit Yjs-Kollaboration, die Änderungen reisen als Yjs-Änderungen über den
// VORHANDENEN Kanal (eigenes Ereignis `notiz-y`). Die Karte wird dabei nicht gesperrt — alle tippen zugleich. Ohne
// Kanal bleibt alles wie vorher (ein Schreiber, Karten-Sperre M364).
//
// Diese Datei lädt mit dem Abgleich (lib/gastSync.ts bindet sie ein — Kanäle gibt es nur mit ihm), nie im Start.
// Yjs, y-protocols und die Kollaborations-Teile von BlockNote (≈ 140 KB) liegen in lib/notizGemeinsamKern.ts und
// kommen erst, wenn wirklich eine Notiz gemeinsam geöffnet wird (M321: Schweres nachladen).
import { LIVE_NACHRICHT, teilnehmerVon } from './liveStand';
import { notizYVonAussen } from './sicherNotizY';

/** Ereignisname im Live-Kanal */
export const NOTIZ_Y_EREIGNIS = 'notiz-y';
/** Jemand arbeitet gemeinsam in einer Notiz ({ boardId, nodeId }) — ihr Editor geht in „gemeinsam" (NotizGemeinsam.tsx) */
export const NOTIZ_Y_WACH = 'pixinotes:notiz-y-wach';

/**
 * Wann wird eine Notiz gemeinsam geöffnet? Nicht jeder Editor eines Live-Boards hält eine Sitzung (ein Board mit 50
 * Notizen schickte sonst beim Öffnen 50 Fragen an jeden): Eine Notiz geht in den Modus „gemeinsam", sobald man sie
 * selbst betritt (Klick, Tastatur) — oder sobald jemand anderes in ihr arbeitet. Das meldet hier jede Frage (`hallo`)
 * und jede Änderung (`upd`) eines Anwesenden, und für Neue im Kanal die Liste `offen`: Ereignis NOTIZ_Y_WACH, die Karte
 * weckt ihren Editor. Nur wo jemand arbeitet, wartet das Öffnen auf dessen Stand — sonst beginnt es sofort.
 */
const gewuenscht = new Set<string>();
/** Arbeitet in dieser Notiz gerade jemand anderes (seit dem Öffnen des Boards)? */
export const gemeinsamGewuenscht = (boardId: string, nodeId: string): boolean => gewuenscht.has(`${boardId}\n${nodeId}`);
if (typeof window !== 'undefined') {
  window.addEventListener(LIVE_NACHRICHT, (e) => {
    const { boardId, ereignis, inhalt } = (e as CustomEvent<{ boardId?: unknown; ereignis?: unknown; inhalt?: unknown }>).detail ?? {};
    if (ereignis !== NOTIZ_Y_EREIGNIS || typeof boardId !== 'string') return;
    // durch lib/sicher(NotizY).ts — Gestalt, Größe, nur Anwesende
    const m = notizYVonAussen(inhalt, new Set(teilnehmerVon(boardId).map((t) => t.id)));
    if (!m) return;
    const art = m.a === 'teil' ? m.ganz : m.a;
    // `offen`: Wer schon in Notizen arbeitet, sagt es jedem, der neu in den Kanal kommt
    const notizen = art === 'offen' ? (m.ns ?? []) : art === 'hallo' || art === 'upd' ? [m.n] : [];
    if (gewuenscht.size > 500) gewuenscht.clear();
    for (const n of notizen) {
      gewuenscht.add(`${boardId}\n${n}`);
      window.dispatchEvent(new CustomEvent(NOTIZ_Y_WACH, { detail: { boardId, nodeId: n } }));
      // eine ruhende Notiz (M338) wacht über das vorhandene Ereignis auf — ohne Klickpunkt, der Cursor bleibt, wo er ist
      window.dispatchEvent(new CustomEvent('pixinotes:notiz-aktiv', { detail: { id: n } }));
    }
  });
}

type Kern = typeof import('./notizGemeinsamKern');
let kernLaden: Promise<Kern> | null = null;
/** Den schweren Teil (Yjs) holen — einmal je Sitzung */
export function gemeinsamKern(): Promise<Kern> {
  if (!kernLaden) kernLaden = import('./notizGemeinsamKern').catch((e) => { kernLaden = null; throw e; });
  return kernLaden;
}
