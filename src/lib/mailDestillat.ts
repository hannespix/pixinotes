// M451: E-Mail-Destillat (KONZEPT.md §5 Punkt 3).
//
// Aus einem langen Mail-Verlauf macht die KI ein Destillat: Kernaussage (2–3 Sätze), offene Fragen, Aufgaben mit
// Frist und Verantwortlichem, wichtige Termine und Zahlen. Das Ergebnis ist eine NEUE Notiz-Karte neben der Mail,
// mit Pfeil (Beschriftung „Destillat") – die Mail selbst bleibt unverändert. Ersetzt das frühere „Zusammenfassen"
// der E-Mail-Karte (3–5 Stichpunkte ohne Gliederung, Aufgaben nur als Text).
//
// Die erkannten Aufgaben stehen zunächst als Aufzählung in der Notiz. Erst ein Klick an der Mail übernimmt sie –
// wahlweise als Checkliste in derselben Notiz oder als Tickets einer neuen Kanban-Karte. Beides landet in der
// Aufgaben-Zentrale samt Frist (Checkliste: Datum im Text, „bis TT.MM.JJJJ"; Ticket: Feld `due`). Bewusst nur EIN
// Weg je Destillat, sonst stünde jede Aufgabe doppelt in der Zentrale.
//
// Bewusst KEIN Pfeil zwischen Destillat und Kanban: Ein Pfeil Notiz → Kanban abonniert alle Listenpunkte der Notiz
// (M182) – Fragen und Termine würden zu Tickets. Die Kanban-Karte hängt deshalb an der Mail.
import { mutedHistory, selectActiveBoard, useBoard } from '../store';
import { uid, type EmailData, type KanbanItem } from '../types';
import { askJson } from './aiActions';
import { findFreeSpot, sizeOf } from './arrange';
import { makeKanban, makeNote } from './nodes';
import { isoLocal } from './tasks';
import { t } from './sprache';

/** Platzbudget für den Mailtext: Anfang (neueste Nachricht) und Ende (Anfang des Verlaufs) */
const TEXT_MAX = 12_000;
const KOPF = 9_000;
const LISTE_MAX = 12;

export interface DestillatAufgabe { text: string; wer: string; frist: string }
export interface Destillat { kern: string; fragen: string[]; aufgaben: DestillatAufgabe[]; termine: string[] }

/** An der Mail gemerkt: welche Notiz das jüngste Destillat ist und ob die Aufgaben schon übernommen wurden */
export interface DestillatStand {
  notizId: string;
  aufgaben: DestillatAufgabe[];
  /** Block-Kennungen der Aufgaben-Punkte in der Notiz (für „Als Checkliste") */
  blockIds: string[];
  uebernommen?: 'checkliste' | 'kanban';
  kanbanId?: string;
}

const kurz = (s: unknown, max = 400): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const istDatum = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00`).getTime());
const deDatum = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Mailtext ins Platzbudget: lange Verläufe behalten Anfang UND Ende, die Mitte wird ausgelassen */
export function mailImBudget(text: string): { text: string; gekuerzt: boolean } {
  if (text.length <= TEXT_MAX) return { text, gekuerzt: false };
  return { text: `${text.slice(0, KOPF)}\n\n[… Mitte des Verlaufs ausgelassen …]\n\n${text.slice(-(TEXT_MAX - KOPF))}`, gekuerzt: true };
}

/** KI-Antwort prüfen und begrenzen: nur Texte, Fristen nur als echtes Datum */
export function destillatBereinigen(roh: unknown): Destillat {
  const o = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  const liste = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => kurz(x)).filter(Boolean).slice(0, LISTE_MAX);
  const aufgaben = (Array.isArray(o.aufgaben) ? o.aufgaben : []).map((a) => {
    const x = (a && typeof a === 'object' ? a : { text: a }) as Record<string, unknown>;
    const frist = kurz(x.frist, 10);
    return { text: kurz(x.text, 200), wer: kurz(x.wer, 60), frist: istDatum(frist) ? frist : '' };
  }).filter((a) => a.text).slice(0, LISTE_MAX);
  return { kern: kurz(o.kern, 900), fragen: liste(o.fragen), aufgaben, termine: liste(o.termine) };
}

/** Zeile eines Aufgaben-Punkts: „Angebot prüfen – Anna – bis 05.12.2026" (die Frist liest die Aufgaben-Zentrale) */
export function aufgabenZeile(a: DestillatAufgabe): string {
  return [a.text, a.wer, a.frist ? `bis ${deDatum(a.frist)}` : ''].filter(Boolean).join(' – ');
}

function notizBloecke(betreff: string, d: Destillat): { blocks: unknown[]; blockIds: string[] } {
  const blocks: unknown[] = [{ type: 'heading', props: { level: 2 }, content: `${t('Destillat')}: ${betreff || t('E-Mail')}` }];
  const abschnitt = (titel: string) => blocks.push({ type: 'heading', props: { level: 3 }, content: titel });
  const punkt = (text: string, id = uid()) => { blocks.push({ id, type: 'bulletListItem', content: text }); return id; };
  abschnitt(t('Kernaussage'));
  blocks.push({ type: 'paragraph', content: d.kern || t('Keine Kernaussage erkannt.') });
  if (d.fragen.length) { abschnitt(t('Offene Fragen')); d.fragen.forEach((f) => punkt(f)); }
  const blockIds: string[] = [];
  if (d.aufgaben.length) { abschnitt(t('Aufgaben')); d.aufgaben.forEach((a) => blockIds.push(punkt(aufgabenZeile(a)))); }
  if (d.termine.length) { abschnitt(t('Termine und Zahlen')); d.termine.forEach((t) => punkt(t)); }
  return { blocks, blockIds };
}

/** Die KI destilliert die Mail; Ergebnis: Notiz neben der Mail, Pfeil „Destillat". Rückgabe = Meldung für den Nutzer. */
export async function mailDestillieren(mailId: string): Promise<string> {
  const st = useBoard.getState();
  const mail = selectActiveBoard(st).nodes.find((n) => n.id === mailId);
  if (!mail || mail.type !== 'email') throw new Error('Die E-Mail ist nicht mehr da.');
  const e = mail.data as EmailData;
  const { text, gekuerzt } = mailImBudget(e.text ?? '');
  const datum = e.date && !Number.isNaN(new Date(e.date).getTime()) ? isoLocal(new Date(e.date)) : '';
  const roh = await askJson<unknown>(
    'Du bekommst eine E-Mail – oft ein ganzer Verlauf mit zitierten älteren Nachrichten. Erstelle daraus ein Destillat auf Deutsch.\n'
    + `Heute ist ${isoLocal(new Date())}.${datum ? ` Die Mail ist vom ${datum}.` : ''} Rechne relative Angaben („bis Freitag", „nächste Woche") in ein Datum um – bezogen auf das Datum der Nachricht, in der sie stehen.\n`
    + 'Antworte NUR mit JSON, exakt in dieser Form:\n'
    + '{"kern":"2–3 Sätze: worum es geht und wie der Stand ist","fragen":["noch offene Frage"],"aufgaben":[{"text":"was zu tun ist, kurz und mit Verb","wer":"verantwortliche Person oder leer","frist":"YYYY-MM-DD oder leer"}],"termine":["wichtiger Termin, Betrag oder Zahl mit kurzer Einordnung"]}\n'
    + 'Leere Listen sind erlaubt. Erfinde nichts, was nicht in der Mail steht.\n\n'
    + `Betreff: ${e.subject ?? ''}\nVon: ${e.fromName ?? ''}${e.fromAddress ? ` <${e.fromAddress}>` : ''}\n${datum ? `Datum: ${datum}\n` : ''}\n${text}`,
  );
  const d = destillatBereinigen(roh);
  if (!d.kern && !d.fragen.length && !d.aufgaben.length && !d.termine.length) throw new Error('Die KI hat nichts Verwertbares geliefert – einfach nochmal versuchen.');
  const { blocks, blockIds } = notizBloecke(e.subject ?? '', d);
  const jetzt = useBoard.getState();
  const nodes = selectActiveBoard(jetzt).nodes;
  const m = nodes.find((n) => n.id === mailId) ?? mail;
  const pos = findFreeSpot(nodes, { x: m.position.x + sizeOf(m).w + 60, y: m.position.y }, { w: 300, h: 380 });
  const notiz = makeNote(pos, { color: 'yellow', blocks });
  notiz.width = 300;
  const stand: DestillatStand = { notizId: notiz.id, aufgaben: d.aufgaben, blockIds };
  // EIN Schritt im Verlauf: Notiz, Pfeil und der Merker an der Mail
  jetzt.pushHistory();
  mutedHistory(() => {
    jetzt.addNode(notiz);
    jetzt.addLabeledEdge(mailId, notiz.id, 'Destillat');
    jetzt.updateNodeData(mailId, { destillat: stand });
  });
  return gekuerzt
    ? `Destillat als Notiz daneben gelegt – offene Fragen: ${d.fragen.length}, Aufgaben: ${d.aufgaben.length}. Der Verlauf war sehr lang, die Mitte wurde ausgelassen.`
    : `Destillat als Notiz daneben gelegt – offene Fragen: ${d.fragen.length}, Aufgaben: ${d.aufgaben.length}`;
}

/** Aufgaben als Checkliste: die Aufgaben-Punkte der Notiz werden Haken (die Frist steht im Text) */
export function alsCheckliste(mailId: string): string {
  const st = useBoard.getState();
  const nodes = selectActiveBoard(st).nodes;
  const stand = nodes.find((n) => n.id === mailId)?.data.destillat as DestillatStand | undefined;
  const notiz = stand && nodes.find((n) => n.id === stand.notizId);
  if (!stand || !notiz) return 'Die Destillat-Notiz ist nicht mehr da.';
  const ids = new Set(stand.blockIds);
  const texte = new Set(stand.aufgaben.map(aufgabenZeile));
  let n = 0;
  const blocks = ((notiz.data.blocks as Array<Record<string, unknown>> | undefined) ?? []).map((b) => {
    const inhalt = typeof b.content === 'string' ? b.content
      : Array.isArray(b.content) ? b.content.map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join('') : '';
    // Die Kennung trägt; hat der Editor sie (unerwartet) neu vergeben, hilft der unveränderte Text
    if (b.type !== 'bulletListItem' || !(ids.has(String(b.id)) || texte.has(inhalt.trim()))) return b;
    n += 1;
    return { ...b, type: 'checkListItem', props: { ...((b.props as object) ?? {}), checked: false } };
  });
  if (!n) return 'Die Aufgaben stehen nicht mehr in der Notiz – nichts übernommen.';
  st.pushHistory();
  mutedHistory(() => {
    st.updateNodeData(notiz.id, { blocks, extEpoch: ((notiz.data.extEpoch as number | undefined) ?? 0) + 1 });
    st.updateNodeData(mailId, { destillat: { ...stand, uebernommen: 'checkliste' } });
  });
  return `Als Checkliste übernommen: ${n} – zu sehen in der Aufgaben-Zentrale`;
}

/** Aufgaben als Tickets: neue Kanban-Karte neben dem Destillat, verbunden mit der Mail */
export function alsKanban(mailId: string): string {
  const st = useBoard.getState();
  const board = selectActiveBoard(st);
  const mail = board.nodes.find((n) => n.id === mailId);
  const stand = mail?.data.destillat as DestillatStand | undefined;
  if (!mail || !stand?.aufgaben.length) return 'Keine Aufgaben zum Übernehmen.';
  const notiz = board.nodes.find((n) => n.id === stand.notizId);
  const anker = notiz ?? mail;
  const pos = findFreeSpot(board.nodes, { x: anker.position.x, y: anker.position.y + sizeOf(anker).h + 50 }, { w: 430, h: 320 });
  const betreff = kurz((mail.data as EmailData).subject, 60);
  const kanban = makeKanban(pos, betreff ? `${t('Aufgaben')}: ${betreff}` : t('Aufgaben aus der E-Mail'));
  const items: KanbanItem[] = stand.aufgaben.map((a) => ({
    id: uid(), text: a.text, col: 0,
    ...(a.frist ? { due: a.frist } : {}),
    ...(a.wer ? { who: a.wer } : {}),
    links: [{ boardId: board.id, nodeId: mailId }],
  }));
  (kanban.data as { items: KanbanItem[] }).items = items;
  st.pushHistory();
  mutedHistory(() => {
    st.addNode(kanban);
    st.addLabeledEdge(mailId, kanban.id, 'Aufgaben');
    st.updateNodeData(mailId, { destillat: { ...stand, uebernommen: 'kanban', kanbanId: kanban.id } });
  });
  return `Als Tickets angelegt: ${items.length} – zu sehen in der Aufgaben-Zentrale`;
}
