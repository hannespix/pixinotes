/**
 * M272: Termine aus NORMALEN Notizen — für den Kalender.
 *
 * Der Befund: Wer in eine Notiz „Sitzung der Kommission am 11.11.2025"
 * schreibt, sah davon im Kalender nichts. Nur Checklisten-Punkte wurden
 * eingesammelt (als Aufgaben, M113) — normaler Fließtext nicht. Dabei ist
 * genau das die natürliche Arbeitsweise: Man notiert, und der verbundene
 * Kalender soll es aufgreifen.
 *
 * Gescannt werden Absätze, Überschriften und Aufzählungen. Bewusst NICHT:
 *  · Checklisten-Punkte — die laufen bereits als Aufgaben in den Kalender
 *    (Schalter „Kanban-Fristen"); doppelt wäre derselbe Termin zweimal.
 *  · Tabellenzellen — dort stehen Datumsspalten, deren massenhafte Übernahme
 *    mehr Rauschen als Nutzen wäre.
 *
 * Erkannt wird nur, was ein BESTIMMTES Datum nennt (Tag oder Wochentag
 * ausdrücklich): „am 24.07.", „12.05.2027", „bis Freitag". Vages wie „heute",
 * „bald", „nächstens" fällt durch — sonst stünde der halbe Notizbestand im
 * Kalender.
 *
 * Die Erkennung (chrono) ist nicht gratis. Deshalb wird das Ergebnis je
 * Blocks-Referenz gemerkt: Zustandsänderungen erzeugen neue Arrays, eine
 * unveränderte Notiz trifft also immer ihren Cache. Relative Angaben
 * („Freitag") hängen am heutigen Tag — der Cache gilt darum nur für den Tag,
 * an dem er entstand.
 */
import { ankerFuer, type FristAnker } from './fristAnker';
import { de as chronoDe, type ParsedResult } from 'chrono-node';
import { kurzdaten, nurWortKeinTag } from './dates';

export interface NotizTermin {
  /** ISO yyyy-mm-dd */
  iso: string;
  /** HH:MM, wenn die Notiz eine Uhrzeit nennt */
  zeit?: string;
  /** Die Zeile, in der das Datum steht — gekürzt */
  text: string;
}

/** Höchstens so viele Termine je Notiz — eine Terminliste ja, ein Kalender-Klon nein */
const MAX_JE_NOTIZ = 12;

interface Eintrag { tag: string; termine: NotizTermin[]; anker?: FristAnker }
const cache = new WeakMap<object, Eintrag>();

const heute = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Blocktypen, deren Text gescannt wird */
const SCAN_TYPEN = new Set(['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'quote']);

interface AnyBlock {
  type?: string;
  content?: unknown;
  children?: AnyBlock[];
}

function inlineText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => (c as { text?: string })?.text ?? '').join('');
}

function scanne(blocks: AnyBlock[] | undefined, out: NotizTermin[], anker?: FristAnker): void {
  for (const b of blocks ?? []) {
    if (out.length >= MAX_JE_NOTIZ) return;
    if (b.type && SCAN_TYPEN.has(b.type)) {
      const text = inlineText(b.content).trim();
      if (text && text.length >= 6) {
        // M390: gelesen wird vom Tag aus, an dem der Text geschrieben wurde — „am Freitag" bleibt DIESER Freitag
        const ref = ankerFuer(anker, (b as { id?: string }).id, text) ?? new Date();
        let ergebnisse: ParsedResult[];
        try {
          ergebnisse = chronoDe.parse(text, ref, { forwardDate: true });
        } catch {
          ergebnisse = [];
        }
        for (const r of ergebnisse.slice(0, 2)) {
          // Nur ausdrückliche Tage/Wochentage — kein „heute", kein Vages
          if (!r.start.isCertain('day') && !r.start.isCertain('weekday')) continue;
          if (nurWortKeinTag(text, r)) continue;   // M379: „So läuft es" ist kein Sonntag
          const zeit = r.start.isCertain('hour')
            ? `${String(r.start.get('hour')).padStart(2, '0')}:${String(r.start.get('minute') ?? 0).padStart(2, '0')}`
            : undefined;
          out.push({ iso: isoLocal(r.start.date()), zeit, text: text.slice(0, 90) });
          if (out.length >= MAX_JE_NOTIZ) return;
        }
        // M388: deutsche Kurzdaten („am 3.12.", „12.11. um 10 Uhr") — die erkennt die Bibliothek nicht; die Frist-
        // Marke der Notiz fand sie schon (lib/dates.ts), der Kalender nicht
        for (const k of kurzdaten(text, ref).slice(0, 2)) {
          const iso = isoLocal(k.date);
          if (out.some((o) => o.iso === iso && o.text === text.slice(0, 90))) continue;
          out.push({ iso, zeit: k.mitZeit ? `${String(k.date.getHours()).padStart(2, '0')}:${String(k.date.getMinutes()).padStart(2, '0')}` : undefined, text: text.slice(0, 90) });
          if (out.length >= MAX_JE_NOTIZ) return;
        }
      }
    }
    // Checklisten-Punkte NICHT scannen (laufen als Aufgaben) — aber ihre
    // Kinder schon: eingerückte Absätze unter einem Punkt sind normaler Text
    scanne(b.children, out, anker);
  }
}

/** Alle erkannten Termine einer Notiz (blocks = data.blocks der Karte) */
export function notizTermine(blocks: unknown, anker?: FristAnker): NotizTermin[] {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];
  const key = blocks as object;
  const tag = heute();
  const alt = cache.get(key);
  if (alt && alt.tag === tag && alt.anker === anker) return alt.termine;
  const out: NotizTermin[] = [];
  // Checklisten-Text überspringt scanne() selbst (Typ nicht in SCAN_TYPEN)
  scanne(blocks as AnyBlock[], out, anker);
  cache.set(key, { tag, termine: out, anker });
  return out;
}
