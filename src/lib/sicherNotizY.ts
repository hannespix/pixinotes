// M477: Teil von lib/sicher.ts — die Prüfung der Nachrichten „gemeinsam tippen" aus dem Live-Kanal.
// Eigene Datei nur, damit sie mit dem Abgleich (lib/notizGemeinsam.ts, lib/notizGemeinsamKern.ts) nachlädt; alles, was
// von außen kommt, läuft weiter durch diese Schicht.

/** Höchstens so viele Zeichen (Base64) trägt eine einzelne Kanal-Nachricht; Größeres reist in Teilen */
export const NOTIZ_Y_TEIL_ZEICHEN = 48_000;
/** Höchstens so viele Teile hat eine zerlegte Nachricht (≈ 4 MB Base64) — mehr ist kein Tippen mehr */
export const NOTIZ_Y_TEILE_MAX = 90;
export type NotizYArt = 'hallo' | 'stand' | 'upd' | 'aw' | 'teil' | 'offen';
/** Eine Nachricht des gemeinsamen Tippens, so wie sie nach der Prüfung weitergegeben wird */
export interface NotizYNachricht {
  /** Kennung des Absenders im Kanal (ich().id) */
  von: string;
  /** Yjs-Kennung seines Dokuments (je Fenster und Öffnen eine andere) */
  c: number;
  /** die Notiz (Karten-Kennung) */
  n: string;
  a: NotizYArt;
  /** Empfänger (Yjs-Kennung) einer gezielten Antwort */
  an?: number;
  /** Yjs-Änderung bzw. Anwesenheit (d) und Stand-Vektor (sv) — Base64 */
  d?: string;
  sv?: string;
  /** Teile einer zerlegten Nachricht: Schlüssel, Nummer, Anzahl, Art der ganzen Nachricht */
  k?: string; i?: number; z?: number; ganz?: Exclude<NotizYArt, 'teil' | 'offen'>;
  /** `offen`: die Notizen, die der Absender gerade gemeinsam offen hat (für Neue im Kanal) */
  ns?: string[];
}
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const ARTEN_Y = new Set<string>(['hallo', 'stand', 'upd', 'aw', 'teil', 'offen']);
/**
 * M477: Eine Nachricht „gemeinsam tippen" aus dem Live-Kanal. Wie patchSaeubern: Die Gestalt muss stimmen, sonst fällt
 * sie weg — und sie muss von jemandem kommen, der gerade im Kanal ANWESEND ist (Presence). Größen sind begrenzt (eine
 * Nachricht, die Zahl der Teile); Base64 nur aus seinen Zeichen. Ob die Bytes eine gültige Yjs-Änderung sind, prüft
 * erst das Einspielen (in einem try) — Yjs wirft bei Unsinn, das Dokument bleibt dann, wie es war.
 */
export function notizYVonAussen(roh: unknown, anwesend: ReadonlySet<string>): NotizYNachricht | null {
  const m = roh as Partial<Record<keyof NotizYNachricht, unknown>> | null;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  if (typeof m.von !== 'string' || !m.von || m.von.length > 64 || !anwesend.has(m.von)) return null;
  if (typeof m.c !== 'number' || !Number.isInteger(m.c) || m.c <= 0 || m.c > 0xffffffff) return null;
  if (typeof m.n !== 'string' || !/^[\w:.-]{1,200}$/.test(m.n)) return null;
  if (typeof m.a !== 'string' || !ARTEN_Y.has(m.a)) return null;
  const b64 = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && B64.test(v);
  const aus: NotizYNachricht = { von: m.von, c: m.c, n: m.n, a: m.a as NotizYArt };
  if (m.an !== undefined) { if (typeof m.an !== 'number' || !Number.isInteger(m.an)) return null; aus.an = m.an; }
  if (m.d !== undefined) { if (!b64(m.d, NOTIZ_Y_TEIL_ZEICHEN)) return null; aus.d = m.d; }
  if (m.sv !== undefined) { if (!b64(m.sv, 20_000)) return null; aus.sv = m.sv; }
  if (aus.a === 'teil') {
    if (typeof m.k !== 'string' || !/^\w{1,24}$/.test(m.k)) return null;
    if (typeof m.z !== 'number' || !Number.isInteger(m.z) || m.z < 2 || m.z > NOTIZ_Y_TEILE_MAX) return null;
    if (typeof m.i !== 'number' || !Number.isInteger(m.i) || m.i < 0 || m.i >= m.z) return null;
    if (m.ganz !== 'hallo' && m.ganz !== 'stand' && m.ganz !== 'upd' && m.ganz !== 'aw') return null;
    if (aus.d === undefined) return null;
    aus.k = m.k; aus.i = m.i; aus.z = m.z; aus.ganz = m.ganz;
  } else if (aus.a === 'offen') {
    if (!Array.isArray(m.ns) || m.ns.length > 200 || !m.ns.every((x) => typeof x === 'string' && /^[\w:.-]{1,200}$/.test(x))) return null;
    aus.ns = [...m.ns as string[]];
  } else if ((aus.a === 'upd' || aus.a === 'aw') && aus.d === undefined) return null;
  return aus;
}
