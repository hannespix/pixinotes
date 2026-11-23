// M444: Board-Briefing – „Was ist auf diesem Board gerade wichtig?"
//
// Eine knappe Lage des aktiven Boards als NEUE Notiz neben dem sichtbaren Ausschnitt (nichts wird verändert,
// Strg+Z nimmt die Notiz wieder weg):
//   · Aufgaben mit Fristen – überfällig zuerst, dann bald fällig, dann später; die Liste entsteht immer LOKAL
//     aus lib/tasks.ts (collectTasks), damit Daten und Reihenfolge stimmen und nichts erfunden wird.
//   · Entscheidungen – Beschlüsse aus Protokoll-Karten, Zeilen „Beschluss: …" aus Notizen.
//   · Wichtigste Inhalte – die gehaltvollsten Karten.
//   · Risiken und Blocker – überfällige Fristen (M463: mit Namen und Dauer), Tickets lange „in Arbeit" (M463, über
//     die Änderungszeit der Kanban-Karte), Pfeile mit blockierender Beziehung (M463) und Zeilen mit „Risiko" …
//   · M453: Lange unberührt – Karten, deren Inhalt seit über 30 Tagen niemand geändert hat, und E-Mail-Karten ohne
//     Folgeaktivität (keine Notiz daran, kein Ticket dazu, keine Antwort im Gespräch). Nur Karten mit bekanntem
//     Zeitpunkt; der Abschnitt erscheint nur, wenn es solche Karten gibt.
// Mit KI schreibt das Modell Lage, Entscheidungen, Inhalte und Risiken aus dem ganzen Board (kiLesen über gather,
// Platzbudget wie alle Board-Aktionen); ohne KI – oder wenn sie nicht antwortet – entsteht dasselbe Gerüst lokal.
// Bewusst keine Checklisten „- [ ]" in der Notiz: Sie würden als neue Aufgaben in der Aufgaben-Zentrale auftauchen
// und die Fristen doppelt mahnen.
import { useBoard, selectActiveBoard, mutedHistory, type BoardDoc } from '../store';
import { doneCol, kanbanCols, type AppNode, type KanbanData, type MinutesData } from '../types';
import { collectTasks, formatDueShort, type TaskRef } from './tasks';
import { fristenLaden } from './dates';
import { nodeToText } from './serialize';
import { findFreeSpot } from './arrange';
import { tagLokal } from './tag';
import { t, zahlWort } from './sprache';
import { tageSeit, zeitVon } from './kartenZeit';

export interface BoardLage {
  ueberfaellig: TaskRef[];
  bald: TaskRef[];
  spaeter: TaskRef[];
  ohneFrist: TaskRef[];
  entscheidungen: Array<{ text: string; datum?: string; karte: string }>;
  inhalte: Array<{ id: string; titel: string }>;
  risiken: Array<{ text: string; karte: string }>;
  /** M463: Risiken aus der STRUKTUR des Boards (ohne KI, vor den Wortmustern): überfällige Fristen mit Namen, Tickets
   *  lange „in Arbeit", Pfeile mit blockierender Beziehung */
  befunde: Array<{ text: string; karte: string }>;
  /** M453: Inhalt seit UNBERUEHRT_TAGE nicht geändert (älteste zuerst) */
  unberuehrt: Array<{ titel: string; tage: number }>;
  /** M453: E-Mail-Karten ohne Folgeaktivität seit MAIL_TAGE (älteste zuerst) */
  mailsOhneFolge: Array<{ titel: string; tage: number }>;
}

/** M453: ab wann eine Karte als „lange unberührt" gilt */
export const UNBERUEHRT_TAGE = 30;
/** M453: ab wann eine E-Mail ohne Folgeaktivität genannt wird */
export const MAIL_TAGE = 7;
const LISTE_MAX = 6;

/**
 * M453: Hat nach dem Eingang einer E-Mail-Karte etwas an sie angeknüpft? Die Karte selbst wurde bearbeitet, eine
 * verbundene Karte wurde danach geändert, ein Ticket verweist auf sie oder im Gespräch an ihr kam etwas dazu.
 */
function hatFolge(board: BoardDoc, mail: AppNode, seit: number): boolean {
  const g = (mail as { geaendert?: number }).geaendert;
  if (g !== undefined && g - seit > 60_000) return true;
  const zeit = new Map(board.nodes.map((n) => [n.id, zeitVon(n)]));
  for (const e of board.edges ?? []) {
    const andere = e.source === mail.id ? e.target : e.target === mail.id ? e.source : null;
    if (andere && (zeit.get(andere) ?? 0) > seit) return true;
  }
  for (const n of board.nodes) {
    if (n.type !== 'kanban') continue;
    const d = n.data as { items?: Array<{ link?: { nodeId?: string }; links?: Array<{ nodeId?: string }> }> };
    if ((d.items ?? []).some((it) => it.link?.nodeId === mail.id || (it.links ?? []).some((l) => l.nodeId === mail.id))) return true;
  }
  for (const c of board.comments ?? []) {
    if (c.nodeId === mail.id && c.msgs.some((m) => Date.parse(m.at) > seit)) return true;
  }
  return false;
}

/** M463: ab wann ein Ticket als „lange in Arbeit" gilt – gemessen an der letzten Änderung seiner Kanban-Karte (M453) */
export const IN_ARBEIT_TAGE = 14;
const BEFUND_MAX = 3;
/** M463: Beziehungsnamen an Pfeilen, die eine Blockade oder Abhängigkeit ausdrücken */
const BLOCKIERT = /\b(blockier\w*|blockt|blocker\w*|block(s|ed|ing)?|hängt\s+(an|von)|wartet\s+auf|abhängig\w*|bremst|verhinder\w*|depends?\s+on|waits?\s+(for|on))\b/i;

/** M463: Risiken aus der Struktur des Boards – ohne KI, aber mehr als ein Wortmuster */
function befundeSammeln(board: BoardDoc, karten: AppNode[], ueberfaellig: TaskRef[], name: Map<string, string>, jetzt: number): BoardLage['befunde'] {
  const out: BoardLage['befunde'] = [];
  // 1. Überfällige Fristen mit Namen und Dauer, die ältesten zuerst
  const alt = [...ueberfaellig].filter((a) => a.due).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
  for (const a of alt.slice(0, BEFUND_MAX)) {
    const tage = Math.max(1, tageSeit(Date.parse(`${a.due}T23:59:59`), jetzt) + 1);
    out.push({ text: t('Frist seit {0} überschritten: {1}').replace('{0}', zahlWort(tage, 'Tag', 'Tagen')).replace('{1}', a.text.trim().slice(0, 120)), karte: name.get(a.nodeId) ?? '' });
  }
  // 2. Tickets, die lange „in Arbeit" stehen: mittlere Spalten einer Kanban-Karte, die seit IN_ARBEIT_TAGE niemand
  //    geändert hat (Tickets tragen keine eigene Zeit – die Karte stempelt bei jedem Verschieben, M453)
  let inArbeit = 0;
  for (const n of karten) {
    if (n.type !== 'kanban' || inArbeit >= BEFUND_MAX) continue;
    const d = n.data as KanbanData;
    const z = zeitVon(n);
    if (d.autoCollect || z === undefined) continue;
    const tage = tageSeit(z, jetzt);
    if (tage < IN_ARBEIT_TAGE) continue;
    const cols = kanbanCols(d);
    for (const it of d.items ?? []) {
      if (inArbeit >= BEFUND_MAX) break;
      if (it.col <= 0 || it.col >= doneCol(d) || !it.text?.trim()) continue;
      out.push({ text: t('Seit {0} Tagen in „{1}“: {2}').replace('{0}', String(tage)).replace('{1}', cols[it.col] ?? '').replace('{2}', it.text.trim().slice(0, 120)), karte: d.title || name.get(n.id) || '' });
      inArbeit += 1;
    }
  }
  // 3. Pfeile, deren Beziehungsname eine Blockade nennt („blockiert", „wartet auf", „hängt an" …)
  const aktiv = new Set(karten.map((n) => n.id));
  let pfeile = 0;
  for (const e of board.edges ?? []) {
    if (pfeile >= BEFUND_MAX) break;
    const label = String((e.data as { label?: unknown } | undefined)?.label ?? '').trim();
    if (!label || !BLOCKIERT.test(label) || !aktiv.has(e.source) || !aktiv.has(e.target)) continue;
    out.push({ text: `„${name.get(e.source) || t('Karte')}“ ${label} „${name.get(e.target) || t('Karte')}“`, karte: '' });
    pfeile += 1;
  }
  return out;
}

const OHNE_INHALT = new Set(['shape', 'frame', 'portal', 'calendar', 'time']);
const RISIKO = /\b(risik\w*|blocker\w*|blockier\w*|verzug|verzöger\w*|verspät\w*|engpass\w*|gefahr\w*|gefährd\w*|eskal\w*|kritisch\w*|problem\w*|hängt|offen ist,? ob|risk\w*|blocked|delay\w*)\b/i;
const BESCHLUSS = /^\s*[-*•]?\s*(beschluss|beschlossen|entscheidung|entschieden|festgelegt)\s*[:–-]\s*(.+)$/i;

/** Erste sinnvolle Zeile einer Karte – ihr Titel in Listen */
function titelVon(n: AppNode): string {
  const zeile = nodeToText(n).split('\n').map((z) => z.replace(/^[#\s>*-]+/, '').trim()).find((z) => z.length > 1) ?? '';
  return zeile.length > 80 ? `${zeile.slice(0, 77).trimEnd()} …` : zeile;
}

/** Die Lage des Boards ohne KI: Aufgaben, Beschlüsse, gehaltvollste Karten, Risiken */
export function lageSammeln(board: BoardDoc, now: Date = new Date()): BoardLage {
  // Ein archiviertes Board soll trotzdem sein Briefing bekommen – collectTasks überspränge es
  const aufgaben = collectTasks([{ ...board, archived: false }], now);
  const karten = board.nodes.filter((n) => !n.archived);
  const name = new Map(karten.map((n) => [n.id, titelVon(n)]));

  const entscheidungen: BoardLage['entscheidungen'] = [];
  const risiken: BoardLage['risiken'] = [];
  const gesehen = new Set<string>();
  for (const n of karten) {
    if (n.type === 'minutes') {
      const d = n.data as MinutesData;
      const sitzungen = [...(d.entries ?? [])].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
      for (const s of sitzungen) {
        for (const b of s.decisions ?? []) if (b.text?.trim()) entscheidungen.push({ text: b.text.trim(), datum: s.date, karte: d.title || name.get(n.id) || '' });
      }
    }
    if (OHNE_INHALT.has(n.type ?? '')) continue;
    for (const zeile of nodeToText(n).split('\n')) {
      const z = zeile.trim();
      if (!z || z.length > 240) continue;
      const m = BESCHLUSS.exec(z);
      if (m && n.type !== 'minutes') entscheidungen.push({ text: m[2].trim(), karte: name.get(n.id) ?? '' });
      else if (RISIKO.test(z)) {
        const text = z.replace(/^[#\s>*•-]+/, '').replace(/^\[[ x]\]\s*/i, '');
        const schluessel = text.toLowerCase();
        if (!gesehen.has(schluessel)) { gesehen.add(schluessel); risiken.push({ text, karte: name.get(n.id) ?? '' }); }
      }
    }
  }

  // Gehaltvollste Karten zuerst; Aufgaben-Listen und Protokolle zählen etwas mehr, weil dort die Arbeit steht
  const inhalte = karten
    .filter((n) => !OHNE_INHALT.has(n.type ?? '') && name.get(n.id))
    .map((n) => ({ id: n.id, titel: name.get(n.id) ?? '', gewicht: nodeToText(n).length * (n.type === 'kanban' || n.type === 'minutes' || n.type === 'gantt' ? 1.5 : 1) }))
    .sort((a, b) => b.gewicht - a.gewicht)
    .slice(0, 5)
    .map(({ id, titel }) => ({ id, titel }));

  // M453: lange unberührt — nur mit bekanntem Zeitpunkt (ältere Stände: unbekannt, kein erfundenes Datum)
  const jetzt = now.getTime();
  const unberuehrt: BoardLage['unberuehrt'] = [];
  const mailsOhneFolge: BoardLage['mailsOhneFolge'] = [];
  for (const n of karten) {
    const z = zeitVon(n);
    if (z === undefined) continue;
    if (n.type === 'email') {
      const seit = (n as { angelegt?: number }).angelegt ?? z;
      const tage = tageSeit(seit, jetzt);
      if (tage >= MAIL_TAGE && !hatFolge(board, n, seit)) mailsOhneFolge.push({ titel: (n.data as { subject?: string }).subject?.trim() || name.get(n.id) || t('(ohne Betreff)'), tage });
      continue;
    }
    if (OHNE_INHALT.has(n.type ?? '')) continue;
    const tage = tageSeit(z, jetzt);
    if (tage >= UNBERUEHRT_TAGE && name.get(n.id)) unberuehrt.push({ titel: name.get(n.id) ?? '', tage });
  }
  unberuehrt.sort((a, b) => b.tage - a.tage);
  mailsOhneFolge.sort((a, b) => b.tage - a.tage);

  return {
    ueberfaellig: aufgaben.filter((a) => a.urgency === 'overdue'),
    bald: aufgaben.filter((a) => a.urgency === 'soon'),
    spaeter: aufgaben.filter((a) => a.urgency === 'ok'),
    ohneFrist: aufgaben.filter((a) => a.urgency === 'none'),
    entscheidungen: entscheidungen.slice(0, 8),
    inhalte,
    risiken: risiken.slice(0, 6),
    befunde: befundeSammeln(board, karten, aufgaben.filter((a) => a.urgency === 'overdue'), name, jetzt),
    unberuehrt: unberuehrt.slice(0, LISTE_MAX),
    mailsOhneFolge: mailsOhneFolge.slice(0, LISTE_MAX),
  };
}

const AUFGABEN_MAX = 10;
function aufgabeZeile(a: TaskRef, now: Date): string {
  const wer = a.who ? ` · @${a.who}` : '';
  return `- ${a.due ? `**${formatDueShort(a.due, now)}** – ` : ''}${a.text.trim().slice(0, 140)}${wer}`;
}

/** Abschnitt „Aufgaben und Fristen": überfällig → bald → später, danach die Zahl ohne Frist */
export function aufgabenMarkdown(l: BoardLage, now: Date = new Date()): string {
  const z: string[] = [`## ${t('Aufgaben und Fristen')}`];
  const mitFrist = [...l.ueberfaellig, ...l.bald, ...l.spaeter];
  if (mitFrist.length === 0 && l.ohneFrist.length === 0) z.push(`- ${t('Keine offenen Aufgaben auf diesem Board.')}`);
  for (const a of mitFrist.slice(0, AUFGABEN_MAX)) z.push(aufgabeZeile(a, now));
  if (mitFrist.length > AUFGABEN_MAX) z.push(`- ${t('… und {0} weitere mit Frist').replace('{0}', String(mitFrist.length - AUFGABEN_MAX))}`);
  if (l.ohneFrist.length) {
    const beispiele = l.ohneFrist.slice(0, 3).map((a) => a.text.trim().slice(0, 60)).join(' · ');
    z.push(`- ${t('{0} offene ohne Frist').replace('{0}', String(l.ohneFrist.length))}: ${beispiele}${l.ohneFrist.length > 3 ? ' …' : ''}`);
  }
  return z.join('\n');
}

/** M453: Abschnitt „Lange unberührt" — leer, wenn es nichts zu nennen gibt */
export function unberuehrtMarkdown(l: BoardLage): string {
  if (!l.unberuehrt.length && !l.mailsOhneFolge.length) return '';
  return [
    `## ${t('Lange unberührt')}`,
    ...l.mailsOhneFolge.map((m) => `- ${t('E-Mail')}: ${m.titel} – ${t('seit {0} Tagen ohne Folgeaktivität').replace('{0}', String(m.tage))}`),
    ...l.unberuehrt.map((u) => `- ${u.titel} – ${t('seit {0} Tagen unverändert').replace('{0}', String(u.tage))}`),
  ].join('\n');
}

/** Das ganze Briefing ohne KI */
export function lageMarkdown(l: BoardLage, now: Date = new Date()): string {
  const teile = [aufgabenMarkdown(l, now)];
  const ent = l.entscheidungen.map((e) => `- ${e.datum ? `${e.datum}: ` : ''}${e.text}${e.karte ? ` (${e.karte})` : ''}`);
  teile.push([`## ${t('Entscheidungen')}`, ...(ent.length ? ent : [`- ${t('Keine Beschlüsse gefunden.')}`])].join('\n'));
  teile.push([`## ${t('Wichtigste Inhalte')}`, ...(l.inhalte.length ? l.inhalte.map((i) => `- ${i.titel}`) : [`- ${t('Das Board ist noch leer.')}`])].join('\n'));
  const ris = [
    ...(l.ueberfaellig.length ? [`- **${t('{0} überfällig').replace('{0}', zahlWort(l.ueberfaellig.length, 'Aufgabe', 'Aufgaben'))}**`] : []),
    ...l.befunde.map((b) => `- ${b.text}${b.karte ? ` (${b.karte})` : ''}`),
    ...l.risiken.map((r) => `- ${r.text}${r.karte && r.karte !== r.text ? ` (${r.karte})` : ''}`),
  ];
  teile.push([`## ${t('Risiken und Blocker')}`, ...(ris.length ? ris : [`- ${t('Nichts erkannt.')}`])].join('\n'));
  const alt = unberuehrtMarkdown(l);
  if (alt) teile.push(alt);
  return teile.join('\n\n');
}

/** KI-Antwort säubern: keine Checklisten (würden zu Aufgaben), keine eigene Titelzeile, keine Codezäune */
export function kiTextSaeubern(md: string): string {
  return md
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^\s*[-*]\s*\[[ xX]\]\s*/gm, '- ')
    .replace(/^#{1,3}\s*(Board-)?Briefing.*\n+/i, '')
    .trim();
}

/** Wunschposition „neben dem sichtbaren Ausschnitt": rechts davon, frei von anderen Karten */
export function platzNeben(rechtsOben: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
  return findFreeSpot(selectActiveBoard(useBoard.getState()).nodes, { x: rechtsOben.x + 40, y: rechtsOben.y }, { w, h });
}

export const BRIEFING_BREITE = 380;

/**
 * Board-Briefing anlegen. `mitKi` = ein KI-Anbieter ist eingerichtet. Ohne KI – oder wenn sie scheitert –
 * entsteht das Briefing lokal; abgebrochen wird ohne Karte.
 */
export async function boardBriefing(rechtsOben: { x: number; y: number }, mitKi: boolean, fortschritt?: (m: string) => void): Promise<string> {
  await fristenLaden().catch(() => {});   // M459: die Fristen-Erkennung lädt bei Bedarf
  const st0 = useBoard.getState();
  const board = selectActiveBoard(st0);
  const boardId = st0.activeId;
  const now = new Date();
  const lage = lageSammeln(board, now);
  let md = lageMarkdown(lage, now);
  let wie = t('ohne KI');
  let ausgelassen = '';
  if (mitKi) {
    const [{ askAi, kiAbgebrochen }, { gather, auslassungsHinweis },{ aufDemselbenBoard }] = await Promise.all([import('./ai'), import('./aiActions'), import('./zielBoard')]);
    try {
      fortschritt?.(t('Lage wird zusammengefasst …'));
      const items = await gather(board.nodes.filter((n) => !n.archived));
      const fakten = {
        ueberfaellig: lage.ueberfaellig.map((a) => ({ aufgabe: a.text, frist: a.due, wer: a.who })),
        bald: lage.bald.map((a) => ({ aufgabe: a.text, frist: a.due, wer: a.who })),
        beschluesse: lage.entscheidungen.map((e) => ({ text: e.text, datum: e.datum, karte: e.karte })),
        risikozeilen: lage.risiken.map((r) => r.text),
        befunde: lage.befunde.map((b) => b.text),
      };
      const antwort = await aufDemselbenBoard(() => askAi(
        `Heute ist ${tagLokal()}. Erstelle ein knappes Board-Briefing für das Board „${board.name}" auf Deutsch. `
        + 'Die Aufgaben mit Fristen stehen bereits als eigener Abschnitt im Briefing – wiederhole sie NICHT einzeln. '
        + 'Schreibe genau diese Abschnitte als "## "-Überschriften: Lage (ein bis zwei Sätze: worum es geht, wo es steht), '
        + 'Entscheidungen (nur, was in Protokollen/Beschlüssen wirklich steht – nichts erfinden), Wichtigste Inhalte (höchstens fünf Stichpunkte), '
        + 'Risiken und Blocker (überfällige Fristen, Abhängigkeiten, offene Fragen – die lokal erkannten Befunde gehören dazu). '
        + 'Nur Stichpunkte mit "- " und **fett** für Schlüsselbegriffe; KEINE Checklisten "- [ ]", keine Emojis, keine Codeblöcke, höchstens 16 Zeilen.\n\n'
        + `Lokal erkannte Fakten:\n${JSON.stringify(fakten)}\n\nKarten:\n${JSON.stringify(items)}`,
      ));
      if (kiAbgebrochen()) return t('Abgebrochen – kein Briefing angelegt.');
      const ki = kiTextSaeubern(antwort);
      // M332: Karten, die nicht mehr in den Kontext passten, nennt die Meldung – wie bei allen Board-Aktionen
      // M453: „Lange unberührt" ist ein lokaler Befund wie die Fristen – er bleibt auch mit KI stehen
      const alt = unberuehrtMarkdown(lage);
      if (ki) { md = `${aufgabenMarkdown(lage, now)}\n\n${ki}${alt ? `\n\n${alt}` : ''}`; wie = t('mit KI'); ausgelassen = auslassungsHinweis(); }
    } catch (e) {
      if (kiAbgebrochen()) return t('Abgebrochen – kein Briefing angelegt.');
      wie = `${t('ohne KI')} – ${t('die KI antwortete nicht')} (${(e as Error).message.slice(0, 80)})`;
    }
  }
  const { mdToBlocks } = await import('./ai');
  const { makeNote } = await import('./nodes');
  const titel = `${t('Board-Briefing')} · ${now.toLocaleDateString('de-DE')}`;
  const blocks = await mdToBlocks(titel, md);
  const st = useBoard.getState();
  // M388: zurück auf das Board, auf dem das Briefing begann – dort gehört die Notiz hin
  if (st.activeId !== boardId && st.boards.some((b) => b.id === boardId)) st.openBoard(boardId);
  const notiz = makeNote(platzNeben(rechtsOben, BRIEFING_BREITE, 420), { color: 'sky', blocks });
  notiz.width = BRIEFING_BREITE;
  st.pushHistory();
  mutedHistory(() => st.addNode(notiz));
  st.focusNode(boardId, notiz.id);
  const zahl = lage.ueberfaellig.length;
  return `${t('Board-Briefing angelegt')} (${wie})${zahl ? ` – ${t('{0} überfällig').replace('{0}', zahlWort(zahl, 'Aufgabe', 'Aufgaben'))}` : ''}${ausgelassen}.`;
}
