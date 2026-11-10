// M338: Wann darf eine Notiz „ruhen"?
//
// Jede Notiz trug bisher einen vollwertigen Editor (BlockNote/ProseMirror),
// auch wenn niemand in ihr schrieb. Gemessen: 300 Karten = 270 Editoren =
// 49 Sekunden bis zur Bedienbarkeit am PC, 190 MB Speicher, 22 000 DOM-Knoten.
// Eine ruhende Notiz zeigt denselben Inhalt als schlichtes HTML in exakt der
// Struktur, die der Editor erzeugt (dieselben Klassen, dasselbe CSS — also
// pixelgleich); der Editor entsteht erst, wenn jemand hineinklickt, die Karte
// in den Fokus holt oder mit dem Stift darauf schreibt.
//
// Ruhen darf nur, was sich verlustfrei nachbilden lässt: Absätze,
// Überschriften, Listen, Haken, Zitate mit den Standard-Auszeichnungen.
// Tabellen, Rechen-Tabellen, Bilder, Code und eigene Schriftgrößen bekommen
// weiter sofort ihren Editor — sie sind selten, und Raten wäre hier falsch.
import { uid } from '../types';

export interface RuheBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: RuheBlock[];
}
export type RuheInline =
  | { type: 'text'; text: string; styles?: Record<string, unknown> }
  | { type: 'link'; href: string; content: Array<{ type: 'text'; text: string; styles?: Record<string, unknown> }> };

const TYPEN = new Set(['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote']);
const PROPS = new Set(['textColor', 'backgroundColor', 'textAlignment', 'level', 'checked', 'start']);
const STILE = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'textColor', 'backgroundColor']);

function textEinfach(t: unknown): boolean {
  const o = t as { type?: string; text?: unknown; styles?: Record<string, unknown> };
  if (o?.type !== 'text' || typeof o.text !== 'string') return false;
  // Ein Zeilenumbruch am Ende braucht im Editor eine Extra-Zeile, die schlichtes HTML nicht zeigt
  if (o.text.endsWith('\n')) return false;
  for (const k of Object.keys(o.styles ?? {})) if (!STILE.has(k)) return false;
  return true;
}

function inhaltEinfach(c: unknown): boolean {
  if (c == null || typeof c === 'string') return typeof c !== 'string' || !c.endsWith('\n');
  if (!Array.isArray(c)) return false;
  for (const teil of c) {
    const o = teil as { type?: string; href?: unknown; content?: unknown };
    if (o?.type === 'text') { if (!textEinfach(o)) return false; continue; }
    if (o?.type === 'link' && typeof o.href === 'string' && Array.isArray(o.content) && o.content.every(textEinfach)) continue;
    return false;
  }
  return true;
}

function blockEinfach(b: RuheBlock, tiefe: number): boolean {
  if (!b || typeof b !== 'object' || !TYPEN.has(b.type ?? '') || tiefe > 6) return false;
  for (const k of Object.keys(b.props ?? {})) if (!PROPS.has(k)) return false;
  if (b.type === 'heading') {
    const l = b.props?.level;
    if (l != null && l !== 1 && l !== 2 && l !== 3) return false;
  }
  if (!inhaltEinfach(b.content)) return false;
  for (const k of b.children ?? []) if (!blockEinfach(k, tiefe + 1)) return false;
  return true;
}

const istLeer = (c: unknown): boolean => c == null || c === '' || (Array.isArray(c) && c.length === 0);

/** Lässt sich diese Notiz ohne Editor pixelgleich zeigen? (Leere Notizen nicht: dort wartet der Cursor.) */
export function notizEinfach(blocks: unknown[] | undefined): boolean {
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  if (blocks.every((b) => istLeer((b as RuheBlock)?.content) && !((b as RuheBlock)?.children?.length))) return false;
  return (blocks as RuheBlock[]).every((b) => blockEinfach(b, 0));
}

/**
 * Blöcke ohne Id (KI-Notizen, Handschrift, Importe) tragen in der ruhenden Ansicht eine Pfad-Id
 * (`_r0`, `_r1-0`) — Stift-Gesten und Handschrift finden den Block darüber aus dem DOM wieder.
 * Gespeichert wird sie NICHT beim bloßen Ansehen (das wäre eine Änderung, die der Abgleich
 * hochlädt), sondern erst mit der ersten echten Änderung — dann als feste Id.
 */
export const pfadId = (pfad: number[]): string => `_r${pfad.join('-')}`;
const IST_PFAD_ID = /^_r\d+(-\d+)*$/;
export function mitPfadIds<T extends { id?: string; children?: unknown[] }>(blocks: T[], pfad: number[] = []): T[] {
  return blocks.map((b, i) => {
    const hier = [...pfad, i];
    const kinder = Array.isArray(b.children) && b.children.length ? { children: mitPfadIds(b.children as T[], hier) } : {};
    return b.id && !kinder.children ? b : { ...b, id: b.id ?? pfadId(hier), ...kinder };
  });
}
/** Vor dem Speichern: fehlende und Pfad-Ids durch feste ersetzen */
export function mitFestenIds<T extends { id?: string; children?: unknown[] }>(blocks: T[]): T[] {
  return blocks.map((b) => {
    const kinder = Array.isArray(b.children) && b.children.length ? { children: mitFestenIds(b.children as T[]) } : {};
    const fest = b.id && !IST_PFAD_ID.test(b.id);
    return fest && !kinder.children ? b : { ...b, id: fest ? b.id : uid(), ...kinder };
  });
}

/** Haken an der Stelle `pfad` (Index je Ebene) umlegen — gibt neue Blöcke zurück */
export function hakenUmlegen(blocks: RuheBlock[], pfad: number[], an: boolean): RuheBlock[] {
  const [i, ...rest] = pfad;
  return blocks.map((b, k) => {
    if (k !== i) return b;
    if (rest.length === 0) return { ...b, props: { ...(b.props ?? {}), checked: an } };
    return { ...b, children: hakenUmlegen(b.children ?? [], rest, an) };
  });
}
