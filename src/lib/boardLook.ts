// M509: Der Look des Boards reist beim Teilen mit.
//
// Wer ein Board teilt (Einladungslink, QR-Code, Freigabe per E-Mail), gibt seinen Look mit: Erscheinungsbild
// (System/Hell/Dunkel), Design (Klassisch/pix·el/vave.log) und Akzentfarbe. Der Look ist ein Feld des Boards (`look`) und
// reist darum mit jedem Abgleich — Konto, Gast-Link, Live-Kanal — ohne neues Server-Feld. Bei Gästen gilt er nur,
// solange dieses Board offen ist; ihre eigenen Geräte-Einstellungen bleiben unberührt (es wird nie `ui` geschrieben).
// Lesbarkeit (Anzeigegröße, „Besser lesbar", weniger Bewegung) gehört immer dem Gast — sie steckt nicht im Look.
//
// Klein, nur mit lib/sprache.ts (ohnehin im Start): App.tsx braucht das beim Start (Start-JS-Grenze).
import type { BoardDoc, BoardLook } from '../store/typen';
import { t } from './sprache';

type Ui = { theme: 'system' | 'light' | 'dark'; accent: string; design?: 'klassisch' | 'pixel' | 'vave' };

const THEMEN = ['system', 'light', 'dark'] as const;
const DESIGNS = ['klassisch', 'pixel', 'vave'] as const;
export const AKZENTE = ['blau', 'gruen', 'violett', 'orange', 'rosa'] as const;

/** Look aus den eigenen Einstellungen — alle drei Werte ausdrücklich (fehlendes Design = Klassisch) */
export const lookAusUi = (ui: Ui): BoardLook => ({ theme: ui.theme, design: ui.design ?? 'klassisch', accent: ui.accent });

/** Look von außen (Abgleich, Kanal, Sicherung): nur bekannte Werte; Unbekanntes fällt weg, nichts Gültiges → undefined */
export function lookVonAussen(roh: unknown): BoardLook | undefined {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return undefined;
  const r = roh as Record<string, unknown>;
  const aus: BoardLook = {};
  if (r.aus === true) aus.aus = true;
  if ((THEMEN as readonly unknown[]).includes(r.theme)) aus.theme = r.theme as BoardLook['theme'];
  if ((DESIGNS as readonly unknown[]).includes(r.design)) aus.design = r.design as BoardLook['design'];
  if ((AKZENTE as readonly unknown[]).includes(r.accent)) aus.accent = r.accent as string;
  return Object.keys(aus).length ? aus : undefined;
}

/** Gibt dieses Board einen Look mit (und ist er nicht abgeschaltet)? */
export const lookAktiv = (l: BoardLook | undefined): l is BoardLook => !!l && !l.aus && !!(l.theme || l.design || l.accent);

const WORT_THEMA = { system: 'System', light: 'Hell', dark: 'Dunkel' } as const;
const WORT_AKZENT: Record<string, string> = { blau: 'Blau', gruen: 'Grün', violett: 'Violett', orange: 'Orange', rosa: 'Rosa' };
/** „Dunkel · pix·el" bzw. „Hell · Klassisch · Grün" — pix·el (M507) und vave.log (M547) bringen ihren Akzent mit, der
 *  gewählte zählt dort nicht */
export function lookWort(l: BoardLook): string {
  const teile: string[] = [WORT_THEMA[l.theme ?? 'system']];
  const eigen = l.design === 'pixel' || l.design === 'vave';
  teile.push(l.design === 'pixel' ? 'pix·el' : l.design === 'vave' ? 'vave.log' : 'Klassisch');
  if (!eigen && l.accent) teile.push(WORT_AKZENT[l.accent] ?? l.accent);
  return teile.map((w) => t(w)).join(' · ');   // englische Oberfläche: Wort für Wort (M381)
}

/** Ist das Board hier ein geteiltes (ich bin Gast) — nur dann gilt sein Look statt meines */
export const binGast = (b: BoardDoc | undefined): boolean => !!b?.geteiltVon;

// ---------- „Eigenen Look verwenden" — je Gerät und Board, nie im Board selbst ----------
const EIGEN_KEY = 'pixinotes-eigener-look';
const HINWEIS_KEY = 'pixinotes-look-hinweis';
export const EIGENER_LOOK_EREIGNIS = 'pn-eigener-look';
const liste = (k: string): string[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
const setzen = (k: string, l: string[]): void => { try { localStorage.setItem(k, JSON.stringify(l.slice(-200))); } catch { /* voll */ } };
export const eigenerLook = (boardId: string): boolean => liste(EIGEN_KEY).includes(boardId);
export function eigenerLookSetzen(boardId: string, an: boolean): void {
  const l = liste(EIGEN_KEY).filter((x) => x !== boardId);
  if (an) l.push(boardId);
  setzen(EIGEN_KEY, l);
  window.dispatchEvent(new CustomEvent(EIGENER_LOOK_EREIGNIS, { detail: boardId }));
}
/** Den Hinweis „Board im Look des Teilenden" je Board nur einmal zeigen */
export function hinweisEinmal(boardId: string): boolean {
  const l = liste(HINWEIS_KEY);
  if (l.includes(boardId)) return false;
  l.push(boardId); setzen(HINWEIS_KEY, l);
  return true;
}

/**
 * Welcher Look gilt gerade? Der eigene — außer auf einem geteilten Board, dessen Look aktiv ist und für das der Gast
 * nicht „eigenen Look verwenden" gewählt hat. `fremd` sagt, ob der Look des Boards gerade wirkt.
 */
export function wirksamerLook(ui: Ui, look: BoardLook | undefined, eigen: boolean): { ui: Ui; fremd: BoardLook | null } {
  if (!lookAktiv(look) || eigen) return { ui, fremd: null };
  return { ui: { theme: look.theme ?? ui.theme, design: look.design ?? 'klassisch', accent: look.accent ?? ui.accent }, fremd: look };
}
/**
 * Für den Selektor in App.tsx: Kennung und Look des offenen geteilten Boards als EIN Text — so zeichnet App nur neu,
 * wenn sich der Look ändert, nicht bei jeder Änderung an einer Karte. Leer = kein fremder Look im Spiel.
 */
export function lookRohVon(boards: BoardDoc[], activeId: string, view: string): string {
  if (view !== 'board') return '';
  const b = boards.find((x) => x.id === activeId);
  return binGast(b) && lookAktiv(b?.look) ? `${b!.id}\t${JSON.stringify(b!.look)}` : '';
}
export function lookAusRoh(roh: string): { id: string; look: BoardLook } | null {
  if (!roh) return null;
  const i = roh.indexOf('\t');
  try { return { id: roh.slice(0, i), look: JSON.parse(roh.slice(i + 1)) as BoardLook }; } catch { return null; }
}
/** Unterscheidet sich der Look sichtbar von meinem? (sonst kein Hinweis) */
export const lookAnders = (a: Ui, b: Ui): boolean => a.theme !== b.theme || (a.design ?? 'klassisch') !== (b.design ?? 'klassisch')
  || ((a.design ?? 'klassisch') === 'klassisch' && a.accent !== b.accent);

/** M509: Teilender ändert seinen Look → die Boards, die seinen Look mitgeben, ziehen nach (für die Gäste live) */
export function lookNachziehen(boards: BoardDoc[], ui: Ui): BoardDoc[] | null {
  const neu = lookAusUi(ui);
  let anders = false;
  const aus = boards.map((b) => {
    if (b.geteiltVon || b.gastLink || !lookAktiv(b.look)) return b;
    if (b.look.theme === neu.theme && b.look.design === neu.design && b.look.accent === neu.accent) return b;
    anders = true;
    return { ...b, look: neu };
  });
  return anders ? aus : null;
}
