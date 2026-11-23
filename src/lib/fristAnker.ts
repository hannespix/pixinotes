// M390: Relative Fristen merken sich, wann sie geschrieben wurden.
//
// „Bericht bis Freitag" meint den Freitag nach dem Schreiben. Die Notiz speichert aber nur den Text — und der wurde bei
// jedem Ansehen neu gegen „jetzt" gelesen. Die Frist wanderte mit und wurde nie überfällig; das eingesammelte Kanban-
// Ticket (das seine Frist einmal festhält) widersprach der Notiz. Jetzt trägt die Notiz je Block mit relativer Angabe
// einen ANKER: den Tag, an dem dieser Text entstand, und den Text selbst. Ändert sich der Text, entsteht ein neuer
// Anker; bleibt er, bleibt die Frist stehen. Feste Daten („am 20.11.") brauchen keinen.
import { detectDates, fristenLaden, hatRelativesDatumOderOffen, kannDatumSein, type DetectedDate } from './dates';
import { tagLokal } from './tag';

/** blockId → [Tag (JJJJ-MM-TT), Text des Blocks an diesem Tag] */
export type FristAnker = Record<string, [string, string]>;
interface B { id?: string; type?: string; props?: { checked?: boolean }; content?: unknown; children?: B[] }

export function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => { const x = c as { text?: string; content?: unknown }; return typeof x?.text === 'string' ? x.text : blockText(x?.content); }).join('');
}

/**
 * M459: Die Fristen-Erkennung lädt erst bei Bedarf (lib/dates.ts). Wer hier Anker setzt, solange sie noch fehlt,
 * wüsste nicht, ob ein Text relativ ist — der Speicher meldet sich darum mit diesem Haken und trägt nach dem Laden
 * nach (`fristAnkerNachtragen`).
 */
let nachLaden: (() => void) | null = null;
let nachLadenAngestossen = false;
export function fristAnkerNachLaden(fn: () => void): void { nachLaden = fn; }
function spaeterNachtragen(): void {
  if (nachLadenAngestossen) return;
  nachLadenAngestossen = true;
  void fristenLaden().then(() => nachLaden?.(), () => { nachLadenAngestossen = false; });
}
/** M459: Hat irgendein Block einen Text, in dem ein Datum stehen KANN? (dann lohnt das Laden der Erkennung) */
export function blockeMitDatum(blocks: unknown): boolean {
  const lauf = (bs: B[] | undefined): boolean => (bs ?? []).some((b) => kannDatumSein(blockText(b?.content)) || lauf(b?.children));
  return lauf(Array.isArray(blocks) ? (blocks as B[]) : []);
}

/** Anker nach einer Text-Änderung nachführen. Gibt DASSELBE Objekt zurück, wenn sich nichts ändert. */
export function fristAnkerPflegen(blocks: unknown, alt: FristAnker | undefined, heute: string = tagLokal()): FristAnker | undefined {
  const neu: FristAnker = {};
  let gleich = true;
  const lauf = (bs: B[] | undefined) => {
    for (const b of bs ?? []) {
      if (b?.id) {
        const text = blockText(b.content).trim();
        const relativ = text ? hatRelativesDatumOderOffen(text) : false;
        const a = alt?.[b.id];
        if (relativ === null) {
          // M459: noch unbekannt — ein bestehender Anker zum selben Text bleibt, ein neuer folgt nach dem Laden
          if (a && a[1] === text) neu[b.id] = a; else spaeterNachtragen();
        } else if (relativ) {
          if (a && a[1] === text) neu[b.id] = a;
          else { neu[b.id] = [heute, text]; gleich = false; }
        }
      }
      lauf(b?.children);
    }
  };
  lauf(Array.isArray(blocks) ? (blocks as B[]) : []);
  const n = Object.keys(neu).length;
  if (gleich && n === Object.keys(alt ?? {}).length) return alt;
  return n ? neu : undefined;
}

/** Der Tag, an dem dieser Block-Text geschrieben wurde — nur wenn der Text noch derselbe ist. */
export function ankerFuer(anker: FristAnker | undefined, blockId: string | undefined, text: string): Date | undefined {
  const a = blockId ? anker?.[blockId] : undefined;
  if (!a || a[1] !== text.trim()) return undefined;
  const d = new Date(`${a[0]}T00:00:01`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Fristen einer ganzen Notiz, Block für Block gelesen — jede mit ihrem Anker. Abgehakte Punkte liefern keine Frist
 * mehr (vorher blieb „überfällig!" an der Notiz stehen, obwohl der Punkt erledigt war).
 */
export function fristenDerNotiz(blocks: unknown, anker: FristAnker | undefined, now: Date = new Date()): DetectedDate[] {
  const out: DetectedDate[] = [];
  const tage = new Set<string>();
  const lauf = (bs: B[] | undefined) => {
    for (const b of bs ?? []) {
      if (out.length >= 3) return;
      if (!(b?.type === 'checkListItem' && b.props?.checked)) {
        const text = blockText(b?.content).trim();
        if (text) {
          for (const d of detectDates(text, now, ankerFuer(anker, b?.id, text))) {
            // Eine Überschrift, die NUR ein Datum ist („Montag, 16. November 2026" der Tagesnotiz), ist ein
            // Datumsstempel, keine Frist — sie stand ab dem Folgetag als „überfällig!" an der Notiz.
            if (b?.type === 'heading' && text.replace(d.label, '').replace(/[\s,.:;–—-]/g, '') === '') continue;
            const k = d.date.toDateString();
            if (tage.has(k) || out.length >= 3) continue;
            tage.add(k); out.push(d);
          }
        }
      }
      lauf(b?.children);
    }
  };
  lauf(Array.isArray(blocks) ? (blocks as B[]) : []);
  return out;
}
