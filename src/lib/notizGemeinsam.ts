// M477: Gemeinsam in einer Notiz tippen — die leichte Weiche (Start-Paket).
//
// Steht der Live-Kanal eines geteilten Boards (lib/liveKanal.ts, gefüllt von lib/gastSync.ts), öffnen Notizen ihren
// Editor im Modus „gemeinsam": BlockNote mit Yjs-Kollaboration, die Änderungen reisen als Yjs-Änderungen über den
// VORHANDENEN Kanal (eigenes Ereignis `notiz-y`). Die Karte wird dabei nicht gesperrt — alle tippen zugleich. Ohne
// Kanal bleibt alles wie vorher (ein Schreiber, Karten-Sperre M364).
//
// Hier steht nur, was der Start braucht: die Frage „gemeinsam oder allein?" und das Nachladen. Yjs, y-protocols und
// die Kollaborations-Teile von BlockNote (rund 100 KB) liegen in lib/notizGemeinsamKern.ts und kommen erst, wenn
// wirklich eine Notiz in einem Live-Board geöffnet wird (M321: Schweres nachladen).
import { useEffect, useState } from 'react';
import { LIVE_NACHRICHT, liveVerbunden, TEILNEHMER_EREIGNIS, teilnehmerVon } from './liveStand';

/** Ereignisname im Live-Kanal */
export const NOTIZ_Y_EREIGNIS = 'notiz-y';

/** Soll eine Notiz dieses Boards jetzt gemeinsam bearbeitet werden? (Kanal steht) */
export const gemeinsamMoeglich = (boardId: string): boolean => liveVerbunden(boardId);

/** Wie gemeinsamMoeglich, als Hook: rechnet neu, sobald der Kanal auf- oder zugeht oder sich die Runde ändert */
export function useGemeinsamMoeglich(boardId: string): boolean {
  const [jetzt, setJetzt] = useState(() => gemeinsamMoeglich(boardId));
  useEffect(() => {
    setJetzt(gemeinsamMoeglich(boardId));
    const auf = (e: Event) => {
      const b = (e as CustomEvent<string>).detail;
      if (b && b !== boardId) return;
      setJetzt(gemeinsamMoeglich(boardId));
    };
    window.addEventListener(TEILNEHMER_EREIGNIS, auf);
    return () => window.removeEventListener(TEILNEHMER_EREIGNIS, auf);
  }, [boardId]);
  return jetzt;
}

/**
 * Wann wird eine Notiz gemeinsam geöffnet? Nicht jeder Editor eines Live-Boards hält eine Sitzung (ein Board mit 50
 * Notizen schickte sonst beim Öffnen 50 Fragen an jeden): Eine Notiz geht in den Modus „gemeinsam", sobald man sie
 * selbst betritt (Klick, Tastatur) — oder sobald jemand anderes in ihr arbeitet. Das meldet hier jede Frage (`hallo`)
 * und jede Änderung (`upd`) eines Anwesenden: Ereignis NOTIZ_Y_WACH, die Karte weckt ihren Editor.
 */
export const NOTIZ_Y_WACH = 'pixinotes:notiz-y-wach';
const gewuenscht = new Set<string>();
/** Arbeitet in dieser Notiz gerade jemand anderes (seit dem Öffnen des Boards)? */
export const gemeinsamGewuenscht = (boardId: string, nodeId: string): boolean => gewuenscht.has(`${boardId}\n${nodeId}`);
if (typeof window !== 'undefined') {
  window.addEventListener(LIVE_NACHRICHT, (e) => {
    const { boardId, ereignis, inhalt } = (e as CustomEvent<{ boardId?: unknown; ereignis?: unknown; inhalt?: unknown }>).detail ?? {};
    if (ereignis !== NOTIZ_Y_EREIGNIS || typeof boardId !== 'string') return;
    const m = inhalt as { von?: unknown; n?: unknown; a?: unknown; ganz?: unknown } | null;
    if (!m || typeof m.n !== 'string' || typeof m.von !== 'string') return;
    const art = m.a === 'teil' ? m.ganz : m.a;
    if (art !== 'hallo' && art !== 'upd') return;
    if (!teilnehmerVon(boardId).some((t) => t.id === m.von)) return;   // nur Anwesende (die volle Prüfung: lib/sicher.ts)
    const key = `${boardId}\n${m.n}`;
    if (gewuenscht.size > 500) gewuenscht.clear();
    gewuenscht.add(key);
    window.dispatchEvent(new CustomEvent(NOTIZ_Y_WACH, { detail: { boardId, nodeId: m.n } }));
  });
}

type Kern = typeof import('./notizGemeinsamKern');
let kernLaden: Promise<Kern> | null = null;
/** Den schweren Teil (Yjs) holen — einmal je Sitzung */
export function gemeinsamKern(): Promise<Kern> {
  if (!kernLaden) kernLaden = import('./notizGemeinsamKern').catch((e) => { kernLaden = null; throw e; });
  return kernLaden;
}
