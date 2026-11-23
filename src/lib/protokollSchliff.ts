// M495: Feinschliff der Protokollreihe — Übergabe an die nächste Sitzung, Personen-Vorschläge, Ausgaben (Markdown,
// HTML/Druck, E-Mail bei Überlänge) und die Gliederung vieler Sitzungen. Bewusst eine eigene Datei ohne React:
// Die Karte lädt nach (React.lazy), lib/minutes.ts steckt dagegen im Start (die Kachel zählt offene Aufgaben) —
// was nur die offene Karte braucht, gehört hierher und nicht in den Start.

import { uid, type MinutesData, type MinutesEntry } from '../types';
import { isoLocal, sitzungsAnker } from './tasks';
import { detectDates } from './dates';
import { sprache, t } from './sprache';
import { langDatum, latestEntry, personVon, sortEntries, suchNorm, teilnehmende } from './minutes';

interface AnyBlock { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: AnyBlock[] }

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => {
    if (!c || typeof c !== 'object') return '';
    if ('text' in c) return String((c as { text: unknown }).text);
    // Verweise tragen ihren Text eine Ebene tiefer
    if ('content' in c) return textOf((c as { content: unknown }).content);
    return '';
  }).join('');
};

const CARRY_MARK = /\s*\(offen seit [^)]{0,20}\)\s*$/;
const UEBERGABE_KOPF = 'Offene Punkte aus der letzten Sitzung';
const kurz = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
};
const mitVermerk = (roh: string, seitIso: string): string => {
  const da = CARRY_MARK.exec(roh);
  const seit = da ? da[0].trim() : `(offen seit ${kurz(seitIso)})`;
  return `${roh.replace(CARRY_MARK, '').trim()} ${seit}`;
};

// ================= Übergabe an die nächste Sitzung =================

export interface UebergabePunkt { key: string; art: 'aufgabe' | 'top'; text: string }

/** Bedeutungstragende Wörter eines TOPs („TOP 2: Sommerfest planen" → sommerfest, planen) */
const kernWoerter = (s: string): string[] => suchNorm(s.replace(CARRY_MARK, ''))
  .split(/[^\p{L}\p{N}]+/u)
  .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !['top', 'tops', 'punkt', 'thema', 'bericht'].includes(w));

/**
 * TOPs der letzten Sitzung, zu denen kein Beschluss gefasst wurde. Beschlüsse hängen im Datenmodell an der Sitzung,
 * nicht am TOP — darum die Regel: Ein TOP gilt als beschlossen, wenn ein Beschluss eines seiner Wörter (≥ 4
 * Buchstaben) nennt („Sommerfest" ↔ „Das Sommerfest findet am 12.7. statt"). Die feste Tagesordnung kommt ohnehin
 * wieder, die Überschrift der Übergabe selbst ist kein TOP. Nur ein Vorschlag — abwählbar.
 */
export function offeneTops(data: MinutesData): string[] {
  const e = latestEntry(data);
  if (!e) return [];
  const fest = new Set((data.agenda ?? []).map((a) => suchNorm(a.trim())));
  const beschluesse = (e.decisions ?? []).map((d) => suchNorm(d.text ?? ''));
  const out: string[] = [];
  for (const b of (e.blocks as AnyBlock[] | undefined) ?? []) {
    if (b?.type !== 'heading') continue;
    const roh = textOf(b.content).trim();
    const ohne = roh.replace(CARRY_MARK, '').trim();
    if (!ohne || ohne === UEBERGABE_KOPF || fest.has(suchNorm(ohne))) continue;
    const woerter = kernWoerter(ohne);
    const beschlossen = woerter.length
      ? beschluesse.some((d) => woerter.some((w) => d.includes(w)))
      : beschluesse.some((d) => d.includes(suchNorm(ohne)));
    if (!beschlossen) out.push(roh);
  }
  return out;
}

/** Was die nächste Sitzung übernehmen kann: offene Aufgaben und TOPs ohne Beschluss */
export function uebergabeVorschlag(data: MinutesData): UebergabePunkt[] {
  if (data.carryOpen === false) return [];
  const e = latestEntry(data);
  if (!e) return [];
  const out: UebergabePunkt[] = [];
  let i = 0;
  const walk = (bs: AnyBlock[] | undefined) => {
    for (const b of bs ?? []) {
      if (b?.type === 'checkListItem' && !b.props?.checked) {
        const roh = textOf(b.content).trim();
        if (roh) out.push({ key: `a${i++}`, art: 'aufgabe', text: roh });
      }
      if (b?.children?.length) walk(b.children);
    }
  };
  walk(e.blocks as AnyBlock[] | undefined);
  offeneTops(data).forEach((text, j) => out.push({ key: `t${j}`, art: 'top', text }));
  return out;
}

/**
 * Die nächste Sitzung: Runde der letzten, die gewählten offenen Aufgaben (mit „offen seit"), die gewählten TOPs
 * ohne Beschluss als Überschriften (ebenfalls mit „offen seit") und die feste Tagesordnung.
 */
export function neueSitzung(data: MinutesData, date: string, gewaehlt: Set<string>): MinutesEntry {
  const letzte = latestEntry(data);
  const punkte = uebergabeVorschlag(data).filter((p) => gewaehlt.has(p.key));
  const blocks: unknown[] = [];
  const aufgaben = punkte.filter((p) => p.art === 'aufgabe');
  if (aufgaben.length && letzte) {
    blocks.push({ type: 'heading', props: { level: 3 }, content: UEBERGABE_KOPF });
    for (const a of aufgaben) blocks.push({ type: 'checkListItem', props: { checked: false }, content: mitVermerk(a.text, letzte.date) });
  }
  for (const top of punkte.filter((p) => p.art === 'top')) {
    if (!letzte) break;
    blocks.push({ type: 'heading', props: { level: 3 }, content: mitVermerk(top.text, letzte.date) });
    blocks.push({ type: 'paragraph', content: '' });
  }
  for (const top of data.agenda ?? []) {
    if (!top.trim()) continue;
    blocks.push({ type: 'heading', props: { level: 3 }, content: top.trim() });
    blocks.push({ type: 'paragraph', content: '' });
  }
  if (blocks.length === 0) blocks.push({ type: 'paragraph', content: '' });
  return { id: uid(), date, attendees: letzte?.attendees, blocks, decisions: [] };
}

// ================= Personen =================

/** Wörter, die am Zeilenanfang mit Doppelpunkt stehen, aber keine Person sind */
const KEINE_PERSON = new Set([
  'hinweis', 'achtung', 'wichtig', 'info', 'frage', 'fragen', 'notiz', 'todo', 'status', 'ergebnis', 'ziel', 'thema',
  'termin', 'frist', 'aufgabe', 'beschluss', 'nachtrag', 'update', 'note', 'bitte', 'offen', 'idee', 'problem',
  'risiko', 'kommentar', 'anmerkung', 'antwort', 'ort', 'zeit', 'datum', 'tipp', 'beispiel', 'vorschlag', 'neu',
  'erledigt', 'vertagt', 'warnung', 'fazit', 'stand', 'next', 'action', 'question', 'answer', 'warning',
]);

/**
 * „Mia: Raum buchen" — Mia ist nicht in der Runde. Bisher zählte die Zeile still als Aufgabe ohne Person; jetzt
 * schlägt die Karte vor, Mia aufzunehmen. Nur Aufgaben (Checklisten-Punkte) der Sitzung, nur Namen, die nicht wie
 * eine Beschriftung aussehen („Hinweis:"), höchstens drei.
 */
export function unbekanntePersonen(e: MinutesEntry | undefined): string[] {
  if (!e) return [];
  const runde = teilnehmende(e.attendees);
  const bekannt = (n: string) => {
    const k = n.toLowerCase();
    return runde.some((r) => { const rr = r.toLowerCase(); return rr === k || rr.split(/\s+/).includes(k); });
  };
  const out: string[] = [];
  const walk = (bs: AnyBlock[] | undefined) => {
    for (const b of bs ?? []) {
      if (b?.type === 'checkListItem') {
        const roh = textOf(b.content).trim();
        const vorn = /^\s*([\p{Lu}][\p{L}.-]{1,30}(?:\s[\p{Lu}][\p{L}.-]{1,30})?)\s*:\s+\S/u.exec(roh);
        const name = vorn?.[1].trim();
        if (name && !KEINE_PERSON.has(name.toLowerCase()) && !bekannt(name) && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
      }
      if (b?.children?.length) walk(b.children);
    }
  };
  walk(e.blocks as AnyBlock[] | undefined);
  return out.slice(0, 3);
}

/** Was „@" einfügt: der Vorname, wenn er in der Runde eindeutig ist, sonst der volle Name */
export function erwaehnung(name: string, runde: string[]): string {
  const vor = name.trim().split(/\s+/)[0];
  const gleich = runde.filter((r) => r.trim().split(/\s+/)[0].toLowerCase() === vor.toLowerCase());
  return gleich.length > 1 ? name.trim() : vor;
}

// ================= Aufgaben einer Sitzung (für Druck und Datei) =================

export interface SitzungsAufgabe { text: string; person?: string; frist?: string; erledigt: boolean }

export function aufgabenDerSitzung(e: MinutesEntry): SitzungsAufgabe[] {
  const runde = teilnehmende(e.attendees);
  const out: SitzungsAufgabe[] = [];
  const walk = (bs: AnyBlock[] | undefined) => {
    for (const b of bs ?? []) {
      if (b?.type === 'checkListItem') {
        const roh = textOf(b.content).trim();
        if (roh) {
          const ohne = roh.replace(CARRY_MARK, '').trim();
          const { person, rest } = personVon(ohne, runde);
          const fund = detectDates(ohne, new Date(`${e.date}T12:00:00`), sitzungsAnker(roh, e.date))[0];
          out.push({ text: rest || ohne, person, frist: fund ? isoLocal(fund.date) : undefined, erledigt: !!b.props?.checked });
        }
      }
      if (b?.children?.length) walk(b.children);
    }
  };
  walk(e.blocks as AnyBlock[] | undefined);
  return out;
}

const datumKurz = (iso: string | undefined): string => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(sprache() === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const kopfzeile = (data: MinutesData, e: MinutesEntry): string =>
  `${data.title?.trim() || t('Protokoll')} – ${e.title?.trim() ? `${e.title.trim()}, ` : ''}${langDatum(e.date)}`;

/** Dateiname ohne Zeichen, die Betriebssysteme nicht mögen */
export function dateiName(data: MinutesData, e: MinutesEntry, endung: string): string {
  const roh = `${data.title?.trim() || 'Protokoll'} ${e.date}`;
  const sauber = roh.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);
  return `${sauber || 'Protokoll'}.${endung}`;
}

// ================= Markdown =================

export function sitzungAlsMarkdown(data: MinutesData, e: MinutesEntry): string {
  const z: string[] = [];
  const md = (s: string) => s.replace(/([\\`*_[\]#|])/g, '\\$1');
  z.push(`# ${md(kopfzeile(data, e))}`);
  z.push('');
  const runde = teilnehmende(e.attendees);
  if (runde.length) z.push(`**${t('Teilnehmende')}:** ${md(runde.join(', '))}`, '');
  const walk = (bs: AnyBlock[] | undefined, tiefe: number) => {
    for (const b of bs ?? []) {
      const text = md(textOf(b?.content).trim());
      const einr = '  '.repeat(tiefe);
      if (b?.type === 'heading') { if (text) z.push('', `## ${text}`, ''); }
      else if (b?.type === 'checkListItem') { if (text) z.push(`${einr}- [${b.props?.checked ? 'x' : ' '}] ${text}`); }
      else if (b?.type === 'bulletListItem') { if (text) z.push(`${einr}- ${text}`); }
      else if (b?.type === 'numberedListItem') { if (text) z.push(`${einr}1. ${text}`); }
      else if (text) z.push(`${einr}${text}`, '');
      if (b?.children?.length) walk(b.children, tiefe + 1);
    }
  };
  walk(e.blocks as AnyBlock[] | undefined, 0);
  const bs = (e.decisions ?? []).filter((d) => d.text?.trim());
  if (bs.length) { z.push('', `## ${t('Beschlüsse')}`, ''); bs.forEach((d, i) => z.push(`${i + 1}. ${md(d.text.trim())}`)); }
  const aufg = aufgabenDerSitzung(e);
  if (aufg.length) {
    z.push('', `## ${t('Aufgaben')}`, '', `| ${t('Aufgabe')} | ${t('Wer')} | ${t('Frist')} | ${t('Stand')} |`, '|---|---|---|---|');
    for (const a of aufg) z.push(`| ${md(a.text)} | ${md(a.person ?? '')} | ${datumKurz(a.frist)} | ${a.erledigt ? t('erledigt') : t('offen')} |`);
  }
  return `${z.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// ================= HTML (Datei und Druckansicht) =================

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Ruhig und sauber: schwarze Schrift auf Weiß, eine Linie unter dem Kopf, keine Farben des Boards */
const DRUCK_CSS = `
  body { font: 11pt/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1d1d1f; background: #fff; max-width: 760px; margin: 28px auto; padding: 0 22px; }
  header { border-bottom: 1px solid #c9c9cf; padding-bottom: 10px; margin-bottom: 14px; }
  .reihe { font-size: 10pt; color: #55555c; margin: 0 0 2px; }
  h1 { font-size: 17pt; margin: 0; } h2 { font-size: 12.5pt; margin: 18px 0 6px; } h3 { font-size: 11pt; margin: 14px 0 4px; }
  .meta { margin: 6px 0 0; color: #3a3a40; } .meta b { color: #1d1d1f; }
  ol.tops { margin: 4px 0 0; padding-left: 22px; }
  p { margin: 0 0 6px; } ul { margin: 0 0 6px; padding-left: 22px; } li { margin: 1px 0; }
  li.aufgabe { list-style: none; margin-left: -18px; } .kasten { display: inline-block; width: 10px; height: 10px; border: 1px solid #55555c; margin-right: 6px; vertical-align: -1px; }
  .kasten.voll { background: #55555c; } .erledigt { color: #66666c; text-decoration: line-through; }
  ol.beschluesse li { margin: 3px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; } th, td { border: 1px solid #c9c9cf; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #f2f2f4; } td.zahl { white-space: nowrap; }
  footer { margin-top: 26px; border-top: 1px solid #dedee3; padding-top: 6px; font-size: 9pt; color: #66666c; }
  h1, h2, h3 { break-after: avoid; } li, tr { break-inside: avoid; } @page { margin: 16mm 15mm; }
  @media print { body { margin: 0 auto; } }
`;

export function sitzungAlsHtml(data: MinutesData, e: MinutesEntry): string {
  const lang = sprache() === 'en' ? 'en' : 'de';
  const teile: string[] = [];
  const runde = teilnehmende(e.attendees);
  const tops = ((e.blocks as AnyBlock[] | undefined) ?? []).filter((b) => b?.type === 'heading').map((b) => textOf(b.content).trim()).filter(Boolean);
  teile.push('<header>');
  teile.push(`<p class="reihe">${esc(data.title?.trim() || t('Protokoll'))}</p>`);
  teile.push(`<h1>${esc(e.title?.trim() ? `${e.title.trim()} – ${langDatum(e.date)}` : langDatum(e.date))}</h1>`);
  if (runde.length) teile.push(`<p class="meta"><b>${esc(t('Teilnehmende'))}:</b> ${esc(runde.join(', '))}</p>`);
  teile.push('</header>');
  if (tops.length) {
    teile.push(`<h2>${esc(t('Tagesordnung'))}</h2><ol class="tops">${tops.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`);
    teile.push(`<h2>${esc(t('Protokoll'))}</h2>`);
  }
  const walk = (bs: AnyBlock[] | undefined): string => {
    let html = '';
    let liste: string | null = null;
    const zu = () => { if (liste) { html += `</${liste}>`; liste = null; } };
    for (const b of bs ?? []) {
      const text = esc(textOf(b?.content).trim());
      const kinder = b?.children?.length ? walk(b.children) : '';
      const art = b?.type === 'numberedListItem' ? 'ol' : (b?.type === 'bulletListItem' || b?.type === 'checkListItem') ? 'ul' : null;
      if (art) {
        if (liste !== art) { zu(); html += `<${art}>`; liste = art; }
        if (b?.type === 'checkListItem') {
          const fertig = !!b.props?.checked;
          html += `<li class="aufgabe"><span class="kasten${fertig ? ' voll' : ''}"></span><span${fertig ? ' class="erledigt"' : ''}>${text}</span>${kinder}</li>`;
        } else html += `<li>${text}${kinder}</li>`;
        continue;
      }
      zu();
      if (b?.type === 'heading') { if (text) html += `<h3>${text}</h3>`; }
      else if (text) html += `<p>${text}</p>`;
      html += kinder;
    }
    zu();
    return html;
  };
  teile.push(walk(e.blocks as AnyBlock[] | undefined));
  const bs = (e.decisions ?? []).filter((d) => d.text?.trim());
  if (bs.length) teile.push(`<h2>${esc(t('Beschlüsse'))}</h2><ol class="beschluesse">${bs.map((d) => `<li>${esc(d.text.trim())}</li>`).join('')}</ol>`);
  const aufg = aufgabenDerSitzung(e);
  if (aufg.length) {
    teile.push(`<h2>${esc(t('Aufgaben'))}</h2><table><thead><tr><th>${esc(t('Aufgabe'))}</th><th>${esc(t('Wer'))}</th><th>${esc(t('Frist'))}</th><th>${esc(t('Stand'))}</th></tr></thead><tbody>`
      + aufg.map((a) => `<tr><td>${esc(a.text)}</td><td>${esc(a.person ?? '')}</td><td class="zahl">${esc(datumKurz(a.frist))}</td><td>${esc(a.erledigt ? t('erledigt') : t('offen'))}</td></tr>`).join('')
      + '</tbody></table>');
  }
  teile.push(`<footer>${esc(kopfzeile(data, e))} · ${esc(datumKurz(isoLocal(new Date())))}</footer>`);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(kopfzeile(data, e))}</title>`
    + `<style>${DRUCK_CSS}</style></head><body>${teile.join('\n')}</body></html>`;
}

// ================= E-Mail =================

/** Ab dieser Länge kürzen Mailprogramme (Outlook, Windows) eine mailto-Adresse — gemessen an der fertigen Adresse */
export const MAILTO_MAX = 1800;

export function mailAdresse(data: MinutesData, e: MinutesEntry, text: string, hinweis: string): { adresse: string; lang: boolean } {
  const betreff = kopfzeile(data, e);
  const voll = `mailto:?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`;
  if (voll.length <= MAILTO_MAX) return { adresse: voll, lang: false };
  return { adresse: `mailto:?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(hinweis)}`, lang: true };
}

// ================= Viele Sitzungen =================

export interface SitzungsGruppe { label: string; sitzungen: MinutesEntry[] }

/** Ältere Sitzungen nach Monat gruppiert (neueste zuerst) — für die Auswahl „Ältere …" */
export function nachMonat(entries: MinutesEntry[]): SitzungsGruppe[] {
  const gruppen: SitzungsGruppe[] = [];
  const loc = sprache() === 'en' ? 'en-GB' : 'de-DE';
  for (const e of sortEntries(entries)) {
    const d = new Date(`${e.date}T12:00:00`);
    const label = Number.isNaN(d.getTime()) ? t('Ohne Datum') : d.toLocaleDateString(loc, { month: 'long', year: 'numeric' });
    const letzte = gruppen[gruppen.length - 1];
    if (letzte?.label === label) letzte.sitzungen.push(e); else gruppen.push({ label, sitzungen: [e] });
  }
  return gruppen;
}
