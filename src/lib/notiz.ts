// Notiz-Helfer (M323): Titel, Checklisten-Stand, Klartext → Blöcke, Vorlagen.
//
// Der Titel einer Notiz ist ihre erste Zeile — das stand vorher an sechs
// Stellen je eigens im Code (Fristen-Chips, Fokus, Wikilinks, Rückverweise,
// Vorlage, Nachschlagen). Jetzt gibt es EINE Antwort auf „wie heißt die Notiz?".
import { blocksToText } from './serialize';
import type { StickyColor } from '../types';

export const FARB_NAMEN: Record<StickyColor, string> = { yellow: 'Gelb', pink: 'Rosa', mint: 'Mint', sky: 'Himmel', white: 'Weiß' };

/** Erste nicht-leere Zeile ohne Markierungszeichen, höchstens 60 Zeichen */
export function noteTitle(blocks: unknown[] | undefined, fallback = 'Notiz'): string {
  const erste = blocksToText(blocks).split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const t = erste.replace(/^(?:#+\s*|[☐☑•\-]\s*)/, '').trim();
  return t ? t.slice(0, 60) : fallback;
}

export interface ChecklistStand { gesamt: number; erledigt: number }
/** Wie viele Haken hat die Notiz, wie viele davon sind gesetzt (auch verschachtelt)? */
export function checklistStand(blocks: unknown[] | undefined): ChecklistStand {
  let gesamt = 0;
  let erledigt = 0;
  const walk = (bs: unknown[]) => {
    for (const b of bs as Array<{ type?: string; props?: { checked?: boolean }; children?: unknown[] }>) {
      if (b?.type === 'checkListItem') { gesamt += 1; if (b.props?.checked) erledigt += 1; }
      if (Array.isArray(b?.children) && b.children.length) walk(b.children);
    }
  };
  if (Array.isArray(blocks)) walk(blocks);
  return { gesamt, erledigt };
}

/**
 * Klartext (auch leichtes Markdown) → Blöcke: „# Überschrift", „- Punkt",
 * „- [ ] Aufgabe", „1. Nummer", „> Zitat", sonst Absätze. Leere Zeilen fallen weg.
 */
export function textZuBloecken(text: string): unknown[] {
  const out: unknown[] = [];
  for (const roh of text.replace(/\r\n?/g, '\n').split('\n')) {
    const t = roh.trim();
    if (!t) continue;
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(t))) out.push({ type: 'heading', props: { level: m[1].length }, content: m[2] });
    else if ((m = /^[-*•]\s+\[( |x|X)\]\s+(.*)$/.exec(t))) out.push({ type: 'checkListItem', props: { checked: m[1] !== ' ' }, content: m[2] });
    else if ((m = /^[☐☑]\s+(.*)$/.exec(t))) out.push({ type: 'checkListItem', props: { checked: t.startsWith('☑') }, content: m[1] });
    else if ((m = /^[-*•]\s+(.*)$/.exec(t))) out.push({ type: 'bulletListItem', content: m[1] });
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) out.push({ type: 'numberedListItem', content: m[1] });
    else if ((m = /^>\s?(.*)$/.exec(t))) out.push({ type: 'quote', content: m[1] });
    else out.push({ type: 'paragraph', content: t });
  }
  return out.length ? out : [{ type: 'paragraph', content: '' }];
}

/** „Do., 05.11.2026" — für Tagesplan, Besprechung und „/heute" */
export const heuteText = (d = new Date()): string =>
  d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

export interface NotizVorlage { key: string; title: string; subtext: string; aliases: string[]; blocks: () => unknown[] }
/** Eingebaute Vorlagen im „/"-Menü — die vier Notizen, die im Alltag immer wieder gleich anfangen */
export const NOTIZ_VORLAGEN: NotizVorlage[] = [
  {
    key: 'besprechung', title: 'Besprechung', subtext: 'Teilnehmer · Themen · Entscheidungen · Aufgaben',
    aliases: ['meeting', 'besprechung', 'protokoll', 'termin', 'sitzung'],
    blocks: () => [
      { type: 'heading', props: { level: 2 }, content: `Besprechung ${heuteText()}` },
      { type: 'paragraph', content: 'Teilnehmer: ' },
      { type: 'heading', props: { level: 3 }, content: 'Themen' }, { type: 'bulletListItem', content: '' },
      { type: 'heading', props: { level: 3 }, content: 'Entscheidungen' }, { type: 'bulletListItem', content: '' },
      { type: 'heading', props: { level: 3 }, content: 'Aufgaben' }, { type: 'checkListItem', content: '' },
    ],
  },
  {
    key: 'tagesplan', title: 'Tagesplan', subtext: 'Die drei wichtigsten Dinge, Termine, Notizen',
    aliases: ['tag', 'heute', 'plan', 'daily', 'tagesplan', 'top 3'],
    blocks: () => [
      { type: 'heading', props: { level: 2 }, content: heuteText() },
      { type: 'heading', props: { level: 3 }, content: 'Top 3' },
      { type: 'checkListItem', content: '' }, { type: 'checkListItem', content: '' }, { type: 'checkListItem', content: '' },
      { type: 'heading', props: { level: 3 }, content: 'Termine' }, { type: 'bulletListItem', content: '' },
      { type: 'heading', props: { level: 3 }, content: 'Notizen' }, { type: 'paragraph', content: '' },
    ],
  },
  {
    key: 'procontra', title: 'Pro & Contra', subtext: 'Dafür, dagegen, Fazit',
    aliases: ['pro', 'contra', 'abwägen', 'vergleich', 'vor- und nachteile'],
    blocks: () => [
      { type: 'heading', props: { level: 2 }, content: 'Pro & Contra: ' },
      { type: 'heading', props: { level: 3 }, content: '＋ Dafür' }, { type: 'bulletListItem', content: '' },
      { type: 'heading', props: { level: 3 }, content: '－ Dagegen' }, { type: 'bulletListItem', content: '' },
      { type: 'heading', props: { level: 3 }, content: 'Fazit' }, { type: 'paragraph', content: '' },
    ],
  },
  {
    key: 'entscheidung', title: 'Entscheidung', subtext: 'Frage · Optionen · Entschieden · Warum',
    aliases: ['entscheidung', 'decision', 'beschluss', 'optionen'],
    blocks: () => [
      { type: 'heading', props: { level: 2 }, content: 'Entscheidung: ' },
      { type: 'paragraph', content: 'Frage: ' },
      { type: 'heading', props: { level: 3 }, content: 'Optionen' }, { type: 'numberedListItem', content: '' },
      { type: 'heading', props: { level: 3 }, content: 'Entschieden' }, { type: 'paragraph', content: '' },
      { type: 'paragraph', content: 'Warum: ' },
      { type: 'paragraph', content: `Datum: ${heuteText()}` },
    ],
  },
];
