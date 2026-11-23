// KI-Aktionen aufs ganze Board oder eine Auswahl (Clustern: lib/themenOrdnen.ts),
// Aufgaben/Termine extrahieren, Prozesse ableiten, Briefings, Verbindungen.
// Alle Aktionen sind NICHT destruktiv: sie legen neue Karten an bzw. ordnen
// nur Positionen — und jede läuft über die Undo-History.
import { tagLokal } from './tag';
import { askAi as askAiRoh, askAiVoll as askAiVollRoh, kiAbgebrochen, MD_HINT, mdToBlocks, prepImageForAi, type KiOptionen } from './ai';
import { aufDemselbenBoard } from './zielBoard';

// M388: Jede Antwort der KI kommt auf dem Board an, auf dem die Aktion begann (lib/zielBoard.ts)
const askAi: typeof askAiRoh = (...a) => aufDemselbenBoard(() => askAiRoh(...a));
const askAiVoll: typeof askAiVollRoh = (...a) => aufDemselbenBoard(() => askAiVollRoh(...a));
import { nodeToText } from './serialize';
import { makeNote } from './nodes';
import { mutedHistory, selectActiveBoard, useBoard } from '../store';
import { dateiTextVonKarte } from './dateiText';
import { loadFile, vorschauArt } from './fileStore';
import { uid, type AppNode } from '../types';
import { findFreeSpot } from './arrange';

/** Kollisionsfreie Zielposition für ein neues KI-Modul (M130): nie einfach
 *  über bestehende Karten legen — freien Platz nahe der Wunschposition suchen.
 *  Liest den Board-Stand FRISCH, damit auch gerade erst angelegte Karten
 *  desselben KI-Plans berücksichtigt werden. */
export function freeSpot(pos: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
  return findFreeSpot(selectActiveBoard(useBoard.getState()).nodes, pos, { w, h });
}

/** Abgeleitete Module mit ihren Quell-Karten verbinden (M131): Pfeil
 *  Quelle → neues Modul. Nur bei kleinen Quellmengen (Auswahl) — bei
 *  Board-weiten Aktionen entstünde sonst ein Pfeil-Spaghetti. */
const LINK_MAX_SOURCES = 4;
function linkSources(sources: AppNode[], targetId: string, label = ''): void {
  if (sources.length === 0 || sources.length > LINK_MAX_SOURCES) return;
  const st = useBoard.getState();
  for (const s of sources) {
    if (s.id !== targetId) st.addLabeledEdge(s.id, targetId, label);
  }
}

export interface Ctx { id: string; type: string; text: string; pos?: [number, number] }

// Kontext-Deckel: große Boards würden sonst Prompts >100 KB erzeugen
// (Provider-Limits, Kosten, Timeouts) — Audit R6-K4
export const CTX_MAX_NODES = 80;
export const CTX_MAX_CHARS = 30_000;

/**
 * M269: Dateien liefern jetzt ihren INHALT mit, nicht nur ihren Namen.
 *
 * Vorher wurde aus einer Datei-Karte genau eine Zeile — „Datei: bericht.pdf
 * (98 KB)". Die KI konnte damit nichts anfangen und sagte das auch
 * (User-Screenshot: „Der Dateiinhalt liegt mir nicht als Text vor"). Jetzt
 * wird die Textebene der PDF ausgelesen und angehängt.
 *
 * Der Deckel je Karte ist für Dateien bewusst höher als die 400 Zeichen einer
 * Notiz: Eine Terminliste ist erst dann brauchbar, wenn sie ganz dasteht. Das
 * Gesamtbudget bleibt unangetastet — passt der Inhalt nicht mehr hinein,
 * hören wir wie bisher am Ende der Liste auf.
 */
export const DATEI_MAX_ZEICHEN = 8_000;

/** M332: Wie viele Karten mit Inhalt beim letzten gather() NICHT in den Kontext
 *  passten — die Aktionen hängen das ihrer Meldung an, statt zu schweigen. */
let letzteAuslassung = 0;
/** Hinweis für die Ergebnis-Meldung, wenn Karten weggelassen wurden */
export function auslassungsHinweis(): string {
  return letzteAuslassung > 0
    ? ` – ${letzteAuslassung} Karte(n) passten nicht mehr in den Kontext und blieben unberücksichtigt (weniger Karten auswählen oder die Freitext-Anweisung nutzen, die in Portionen arbeitet)`
    : '';
}

/** Alle Karten mit Inhalt, OHNE Kontext-Deckel (M332: Grundlage der Portionen) */
async function gatherAlle(nodes: AppNode[]): Promise<Ctx[]> {
  const dateien = await Promise.all(nodes.map((n) => (n.type === 'file' && !n.archived
    ? dateiTextVonKarte(n).catch(() => null)
    : Promise.resolve(null))));
  /* M410: Jede Karte so, wie ihr Modul sich der KI beschreibt (lib/kiModule.ts) – gegliedert und, solange der Platz
     reicht, ganz. Vorher: die ersten 400 Zeichen des Suchtexts; von einer Tabelle, einem Protokoll oder einem
     großen Kanban kam nur der Anfang an. Reicht der Platz nicht für alles, bekommt jede Karte ihren Anteil –
     nie weniger als die 400 Zeichen von früher. */
  const km = await import('./kiModule');
  const st0 = useBoard.getState();
  const umfeld = { alle: selectActiveBoard(st0)?.nodes ?? nodes, boards: st0.boards.map((b) => ({ id: b.id, name: b.name })) };
  const voll = nodes.map((n) => { try { return km.kiLesen(n, umfeld, 3000); } catch { return nodeToText(n).trim().slice(0, 400); } });
  const summe = voll.reduce((a, t) => a + t.length + 60, 0);
  const anteil = summe <= CTX_MAX_CHARS ? 3000 : Math.max(400, Math.floor((CTX_MAX_CHARS * 0.8) / Math.max(1, nodes.length)));
  const all = nodes
    .map((n, i) => {
      const kurz = voll[i].length <= anteil ? voll[i] : `${voll[i].slice(0, anteil).trimEnd()} …`;
      const inhalt = dateien[i]?.trim();
      return {
        id: n.id,
        type: n.type ?? '?',
        text: inhalt ? `${kurz}\nInhalt der Datei:\n${inhalt.slice(0, DATEI_MAX_ZEICHEN)}` : kurz,
      };
    })
    .filter((c) => c.text);
  return all;
}

/** M444: auch fürs Board-Briefing (lib/boardBriefing.ts) – derselbe Platzdeckel wie alle Board-Aktionen */
export async function gather(nodes: AppNode[]): Promise<Ctx[]> {
  const all = await gatherAlle(nodes);
  let budget = CTX_MAX_CHARS;
  const out: Ctx[] = [];
  for (const c of all.slice(0, CTX_MAX_NODES)) {
    budget -= c.text.length + 60;
    if (budget < 0) break;
    out.push(c);
  }
  letzteAuslassung = all.length - out.length;
  return out;
}

/* ---------- Bild-Karten als Foto-Anhänge (M199) ----------
   Screenshots (Einkaufszettel, Tafelbilder, Whiteboard-Fotos) werden der KI
   als echte Bilder mitgegeben — sie liest den Inhalt selbst, statt nur den
   Dateinamen zu sehen. Deckel: die 4 zuerst gefundenen Bilder (Payload/Kosten). */
const IMG_MAX = 4;
export async function gatherImages(nodes: AppNode[]): Promise<string[]> {
  const srcs = nodes
    .filter((n) => n.type === 'image' && !n.archived)
    .map((n) => (n.data as { src?: string }).src)
    .filter((s): s is string => !!s)
    .slice(0, IMG_MAX);
  /**
   * M276: Auch Bild-DATEIKARTEN gehen als Foto mit.
   *
   * Ein Foto über der Einbett-Grenze (1,5 MB) wird zur Datei-Karte, sein
   * Inhalt liegt in der lokalen Ablage (M259). Für die KI war so ein Bild
   * bisher nur ein Dateiname — dabei sind gerade abfotografierte Zettel und
   * Tafelbilder groß. Der Blob wird zur data:-URL und läuft durch dieselbe
   * Verkleinerung wie jede Bild-Karte (prepImageForAi).
   */
  for (const n of nodes) {
    if (srcs.length >= IMG_MAX) break;
    if (n.type !== 'file' || n.archived) continue;
    const d = n.data as { name?: string; mime?: string; dataUrl?: string };
    if (vorschauArt(d.name ?? '', d.mime) !== 'bild') continue;
    let url = d.dataUrl ?? null;
    if (!url) {
      const blob = await loadFile(n.id).catch(() => undefined);
      if (blob) {
        url = await new Promise<string | null>((res) => {
          const r = new FileReader();
          r.onload = () => res(typeof r.result === 'string' ? r.result : null);
          r.onerror = () => res(null);
          r.readAsDataURL(blob);
        });
      }
    }
    if (url) srcs.push(url);
  }
  const prepped = await Promise.all(srcs.map(prepImageForAi));
  return prepped.filter((s): s is string => !!s);
}
export const imgHint = (imgs: string[]): string => (imgs.length
  ? '\n\nDie angehängten Fotos sind die Bild-Karten und Bild-Dateien (in derselben Reihenfolge). Lies ihren Inhalt (Text, Listen, Termine, Tabellen) direkt aus dem Bild und behandle ihn wie Kartentext.'
  : '');

/* ---------- Robustes JSON-Parsen ----------
   Gerade Gratis-/kleine Modelle liefern gern kaputtes JSON: Markdown-Zäune,
   Geschwätz drumherum, fehlende Kommas, abgeschnittene Antworten. Statt mit
   einer kryptischen Fehlermeldung aufzugeben (User-Screenshot: "Expected ','
   or ']' …"), wird hier repariert — und zur Not einmal strenger nachgefragt. */

/** Abgeschnittene Antwort: offenen String + offene Klammern schließen */
function autoClose(s: string): string {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (inStr && ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = inStr ? `${s}"` : s;
  // hängenden Schlüssel ohne Wert bzw. hängendes Komma abschneiden
  out = out.replace(/"[^"\n]*"\s*:\s*$/, '').replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

/** Fehlende Kommas zwischen Elementen einfügen — String-bewusst: innerhalb
 *  von "…" wird NICHTS angefasst, sonst verfälscht die Reparatur Inhalte,
 *  die selbst `}{` o. Ä. enthalten (Audit R6-K5) */
function insertMissingCommas(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  const boundary = (i: number) => {
    // nächstes Nicht-Whitespace-Zeichen: beginnt dort ein neues Element?
    let j = i + 1;
    while (j < s.length && /\s/.test(s[j])) j++;
    return j < s.length && (s[j] === '{' || s[j] === '[' || s[j] === '"');
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += ch;
    if (esc) { esc = false; continue; }
    if (inStr && ch === '\\') { esc = true; continue; }
    if (ch === '"') {
      inStr = !inStr;
      // gerade einen String GESCHLOSSEN → Element-Grenze prüfen
      if (!inStr && boundary(i)) out += ',';
      continue;
    }
    if (inStr) continue;
    if ((ch === '}' || ch === ']') && boundary(i)) out += ',';
  }
  return out;
}

/** Reparatur-Kandidaten in aufsteigender Aggressivität */
function repairCandidates(core: string): string[] {
  const noTrail = core.replace(/,\s*([}\]])/g, '$1'); // trailing commas
  const commas = insertMissingCommas(noTrail);
  return [core, noTrail, commas, autoClose(noTrail), autoClose(commas)];
}

/** Erstes JSON-Objekt aus einer (evtl. geschwätzigen) LLM-Antwort schälen */
function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```[a-z]*\n?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('Die KI hat kein verwertbares JSON geliefert.');
  const end = cleaned.lastIndexOf('}');
  const core = cleaned.slice(start, end > start ? end + 1 : undefined);
  for (const candidate of repairCandidates(core)) {
    try {
      return JSON.parse(candidate) as T;
    } catch { /* nächsten Kandidaten probieren */ }
  }
  throw new Error('Die KI hat kein verwertbares JSON geliefert.');
}

/** askAi + parseJson mit einem automatischen, strengeren zweiten Versuch */
export async function askJson<T>(prompt: string, images: string[] = []): Promise<T> {
  return (await askJsonVoll<T>(prompt, images)).wert;
}

/** M332: wie askJson, meldet aber, ob das Modell an seiner Ausgabegrenze
 *  abbrach — dann ist der Plan unvollständig, und der Aufrufer darf das
 *  nicht als Erfolg verkaufen. */
export async function askJsonVoll<T>(prompt: string, images: string[] = [], opt: KiOptionen = {}): Promise<{ wert: T; abgeschnitten: boolean }> {
  const first = await askAiVoll(prompt, images, opt);
  try {
    return { wert: parseJson<T>(first.text), abgeschnitten: first.abgeschnitten };
  } catch { /* einmal strenger nachfragen */ }
  if (kiAbgebrochen()) throw new Error('abgebrochen');
  const second = await askAiVoll(
    `${prompt}\n\nWICHTIG: Antworte AUSSCHLIESSLICH mit dem vollständigen, gültigen JSON-Objekt – keine Einleitung, kein Markdown, keine Kommentare, nichts danach.`,
    images,
    opt,
  );
  try {
    return { wert: parseJson<T>(second.text), abgeschnitten: second.abgeschnitten };
  } catch {
    throw new Error('Die KI hat zweimal kein sauberes JSON geliefert – einfach nochmal versuchen (bei Gratis-Modellen passiert das öfter) oder in den Einstellungen ein stärkeres Modell wählen.');
  }
}

/**
 * M427: Präsentation per KI. Die KI liefert eine Gliederung (JSON), lib/kiPraesentation.ts prüft sie und baut daraus
 * Folien in der Vorlage von Vibe Studio; das Ergebnis ist eine Präsentations-Karte wie aus der Modul-Palette.
 * Quelle: die übergebenen Karten (Auswahl oder ganzes Board) und der Wunsch (Thema, Publikum, Länge, Ton).
 */
export async function aiPraesentation(nodes: AppNode[], pos: { x: number; y: number }, fortschritt?: (m: string) => void, wunsch = ''): Promise<string> {
  const kp = await import('./kiPraesentation');
  const { vibeStudioVorlage } = await import('./vibeStudio');
  const quellen = nodes.filter((n) => !n.archived && n.type !== 'htmlapp' && n.type !== 'portal');
  const items = await gather(quellen);
  if (items.length === 0 && !wunsch.trim()) throw new Error('Keine Inhalte gefunden – Karten aufs Board legen oder im Feld beschreiben, worum es gehen soll.');
  fortschritt?.('Vorlage laden …');
  const vorlage = await vibeStudioVorlage().catch(() => { throw new Error('Die Vorlage für Präsentationen ist gerade nicht erreichbar – bitte mit Internet erneut versuchen.'); });
  fortschritt?.('Gliederung und Folien schreiben …');
  const imgs = await gatherImages(quellen);
  const inhalt = items.map((c) => `[${c.type}] ${c.text}`).join('\n\n');
  const heute = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const { wert, abgeschnitten } = await askJsonVoll<unknown>(`${kp.gliederungPrompt(wunsch, inhalt, heute)}${imgHint(imgs)}`, imgs, { maxTokens: 8000 });
  const g = kp.gliederungPruefen(wert);
  const html = kp.deckBauen(vorlage, g);
  const { praesentationAnlegen } = await import('./importFiles');
  // Die Karte legt ihren eigenen Rückgängig-Schritt an; die Pfeile zu den Quellen gehören zu ihm
  const id = await praesentationAnlegen(freeSpot(pos, 800, 520), { html, name: g.titel });
  if (!id) throw new Error('Die Präsentation ließ sich nicht anlegen.');
  mutedHistory(() => linkSources(quellen, id));
  const st = useBoard.getState();
  st.focusNode(st.activeId, id);
  return `Präsentation „${g.titel}" mit ${g.folien.length} Folien angelegt – „Bearbeiten" in der Folie öffnet Vibe Studio.${abgeschnitten ? ' Die Antwort der KI war am Ende abgeschnitten; es fehlen eventuell die letzten Folien.' : ''}${auslassungsHinweis()}`;
}

/**
 * M428: Eine bestehende Präsentation (Vibe Studio) per KI überarbeiten. Die Folien werden aus der laufenden
 * Präsentation gelesen — mit allem, was im Editor geändert wurde —, die KI liefert die überarbeitete Gliederung, und
 * die Karte bekommt die neuen Folien. Gestaltung (Logo, Design, Schriften) bleibt; die vorige Fassung lässt sich über
 * das Menü der Karte zurückholen. Quellen: die Karten mit einem Pfeil zur Präsentation.
 */
export async function aiPraesentationUeberarbeiten(id: string, wunsch: string, fortschritt?: (m: string) => void): Promise<string> {
  const kp = await import('./kiPraesentation');
  const vs = await import('./vibeStudio');
  const hs = await import('./htmlStore');
  const st0 = useBoard.getState();
  const board = selectActiveBoard(st0);
  const karte = board?.nodes.find((n) => n.id === id);
  if (!karte || karte.type !== 'htmlapp') throw new Error('Diese Karte ist keine Präsentation.');
  fortschritt?.('Folien lesen …');
  const stand = await vs.vibeLesen(id);
  if (!stand.folien.length) throw new Error('In der Präsentation stehen keine Folien.');
  const bisher = kp.standAlsGliederung(stand.titel, stand.folien);
  // Quellen: Karten mit einem Pfeil zur oder von der Präsentation
  const quellIds = new Set((board?.edges ?? []).flatMap((e) => (e.target === id ? [e.source] : e.source === id ? [e.target] : [])));
  const quellen = (board?.nodes ?? []).filter((n) => quellIds.has(n.id) && !n.archived && n.type !== 'htmlapp');
  const items = quellen.length ? await gather(quellen) : [];
  const inhalt = items.map((c) => `[${c.type}] ${c.text}`).join('\n\n');
  fortschritt?.('Überarbeiten …');
  const vorlage = await vs.vibeStudioVorlage().catch(() => { throw new Error('Die Vorlage für Präsentationen ist gerade nicht erreichbar – bitte mit Internet erneut versuchen.'); });
  const heute = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const { wert, abgeschnitten } = await askJsonVoll<unknown>(kp.ueberarbeitenPrompt(wunsch, bisher, inhalt, heute), [], { maxTokens: 12000 });
  const g = kp.gliederungPruefen(wert);
  // Eine abgeschnittene Antwort ersetzt nie eine ganze Präsentation (es fehlten Folien am Ende)
  if (abgeschnitten) throw new Error('Die Antwort der KI war abgeschnitten – die Präsentation bleibt unverändert. Bitte erneut versuchen oder in Teilen überarbeiten lassen.');
  // Gestaltung aus dem Editor übernehmen (Logo, Design, Schriften); Texte und Folien kommen neu
  const altStand = (await hs.loadAppState(id)) ?? {};
  const schluessel = Object.keys(altStand).find((k) => k.startsWith('vibecoding-editor-')) ?? 'vibecoding-editor-v8:srcdoc';
  let gestaltung: Record<string, unknown> = {};
  try { const alt = JSON.parse(altStand[schluessel] ?? '{}') as Record<string, unknown>; gestaltung = { logo: alt.logo ?? null, design: alt.design ?? null, typography: alt.typography ?? null, fontFiles: alt.fontFiles ?? [], assets: alt.logo ? alt.assets ?? [] : [] }; } catch { /* ohne Gestaltung */ }
  const html = kp.deckBauen(vorlage, g);
  const neuerStand: Record<string, string> = { ...Object.fromEntries(Object.entries(altStand).filter(([k]) => !k.startsWith('vibecoding-editor-'))),
    [schluessel]: JSON.stringify({ schema: 1, updatedAt: Date.now(), texts: {}, added: [], slideLogos: {}, studio: null, ...gestaltung }) };
  await hs.fassungSichern(id);
  await hs.saveHtml(id, html);
  await hs.saveAppState(id, neuerStand);
  const st = useBoard.getState();
  const name = String(karte.data.name ?? '');
  mutedHistory(() => st.updateNodeData(id, { size: html.length, ...(name === bisher.titel || name === 'Präsentation' ? { name: g.titel } : {}) }));
  window.dispatchEvent(new CustomEvent(vs.HAPP_NEU, { detail: id }));
  return `Präsentation überarbeitet: ${bisher.folien.length + 1} → ${g.folien.length} Folien. Die vorige Fassung holt das Menü der Karte (⋮) zurück.`;
}

// M445: „Themen clustern & anordnen“ (aiCluster) ist nach lib/themenOrdnen.ts umgezogen – mit Vorschau und Rahmen.

/** Aufgaben & Termine aus dem Inhalt ziehen → Kanban mit Fälligkeiten */
export async function aiTasks(nodes: AppNode[], pos: { x: number; y: number }): Promise<string> {
  const items = await gather(nodes);
  if (items.length === 0) throw new Error('Keine Inhalte gefunden.');
  const imgs = await gatherImages(nodes);
  const today = tagLokal();
  const { tasks } = await askJson<{ tasks: Array<{ text: string; due?: string }> }>(
    `Heute ist ${today}. Extrahiere aus den folgenden Karten alle konkreten Aufgaben/TODOs. Erkenne Termine/Fristen und setze sie als ISO-Datum (yyyy-mm-dd). Antworte NUR mit JSON: {"tasks":[{"text":"...","due":"yyyy-mm-dd"}]} – "due" nur, wenn wirklich ein Termin erkennbar ist.${imgHint(imgs)}\n\nKarten:\n${JSON.stringify(items)}`,
    imgs,
  );
  const clean = (tasks ?? []).filter((t) => t.text?.trim()).slice(0, 30);
  if (clean.length === 0) throw new Error('Keine Aufgaben im Inhalt erkannt.');
  const st = useBoard.getState();
  const kanbanId = uid();
  st.pushHistory();
  mutedHistory(() => {
    st.addNode({
      id: kanbanId, type: 'kanban', width: 430, position: freeSpot(pos, 430, 300),
      data: {
        title: 'Extrahierte Aufgaben',
        items: clean.map((t) => ({
          id: uid(), text: t.text.trim().slice(0, 140), col: 0,
          due: /^\d{4}-\d{2}-\d{2}$/.test(t.due ?? '') ? t.due : undefined,
        })),
      },
    } as AppNode);
    linkSources(nodes, kanbanId);
  });
  const withDue = clean.filter((t) => t.due).length;
  return `${clean.length} Aufgabe(n) extrahiert${withDue ? `, davon ${withDue} mit Termin` : ''} – als Kanban aufs Board gelegt${auslassungsHinweis()}`;
}

/** Prozess/Workflow aus dem Inhalt ableiten → Mermaid-Flowchart */
export async function aiProcess(nodes: AppNode[], pos: { x: number; y: number }): Promise<string> {
  const items = await gather(nodes);
  if (items.length === 0) throw new Error('Keine Inhalte gefunden.');
  const imgs = await gatherImages(nodes);
  const res = await askAi(
    `Leite aus den folgenden Karten den beschriebenen Ablauf/Workflow ab und modelliere ihn als Mermaid-Flowchart (flowchart TD, deutsche Beschriftung, max. 12 Knoten, Entscheidungen als {Raute}). Antworte NUR mit dem Mermaid-Code, ohne Markdown-Zaun.${imgHint(imgs)}\n\nKarten:\n${JSON.stringify(items)}`,
    imgs,
  );
  const code = res.replace(/```(mermaid)?/g, '').trim();
  if (!/^(flowchart|graph)\s/.test(code)) throw new Error('Die KI hat kein gültiges Flowchart geliefert.');
  const st = useBoard.getState();
  // fitOnLoad (M122): Karte passt sich nach dem ersten Render der Diagramm-
  // größe an — nichts wird abgeschnitten
  const mermaidId = uid();
  st.pushHistory();
  mutedHistory(() => {
    st.addNode({ id: mermaidId, type: 'mermaid', width: 420, height: 280, position: freeSpot(pos, 420, 280), data: { code, fitOnLoad: true } } as AppNode);
    linkSources(nodes, mermaidId);
  });
  return `Workflow als Mermaid-Diagramm aufs Board gelegt${auslassungsHinweis()}`;
}

/** Analytisches Briefing: Überblick, offene Punkte, nächste Schritte */
export async function aiBriefing(nodes: AppNode[], pos: { x: number; y: number }): Promise<string> {
  const items = await gather(nodes);
  if (items.length === 0) throw new Error('Keine Inhalte gefunden.');
  const imgs = await gatherImages(nodes);
  const res = await askAi(
    `Erstelle aus den folgenden Projekt-Karten ein knappes analytisches Briefing auf Deutsch mit genau diesen drei Abschnitten (als "## "-Überschriften): Überblick, Offene Punkte, Nächste Schritte. Maximal 12 Inhaltszeilen gesamt. ${MD_HINT}${imgHint(imgs)}\n\nKarten:\n${JSON.stringify(items)}`,
    imgs,
  );
  const st = useBoard.getState();
  const briefNote = makeNote(freeSpot(pos, 280, 340), { color: 'sky', blocks: await mdToBlocks('Board-Briefing', res.trim()) });
  st.pushHistory();
  mutedHistory(() => {
    st.addNode(briefNote);
    linkSources(nodes, briefNote.id);
  });
  return `Briefing als Notiz aufs Board gelegt${auslassungsHinweis()}`;
}

/** Wochenbriefing aus den offenen Aufgaben (Aufgaben-Zentrale, M115) */
export async function aiWeekPlan(
  tasks: Array<{ text: string; due?: string; who?: string; prio?: number; boardName: string }>,
  pos: { x: number; y: number },
): Promise<string> {
  if (tasks.length === 0) throw new Error('Keine offenen Aufgaben gefunden.');
  const items = tasks.slice(0, 60).map((t) => ({
    aufgabe: t.text.slice(0, 160),
    frist: t.due,
    person: t.who,
    prio: t.prio === 1 ? 'hoch' : t.prio === 2 ? 'mittel' : t.prio === 3 ? 'niedrig' : undefined,
    board: t.boardName,
  }));
  const res = await askAi(
    `Heute ist ${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}. `
    + 'Erstelle aus den folgenden offenen Aufgaben ein knappes Wochen-Briefing auf Deutsch mit genau diesen '
    + '"## "-Abschnitten: Diese Woche zuerst, Fristen im Blick, Bei anderen nachhaken, Empfehlung. '
    + 'Alle konkret erledigbaren Aufgaben als Checklisten-Punkte "- [ ] …" (die Empfehlung als normale Stichpunkte). '
    + `Priorisiere nach Frist und Priorität, nenne Personen beim Namen. Maximal 16 Inhaltszeilen gesamt. ${MD_HINT}\n\nAufgaben:\n`
    + JSON.stringify(items),
  );
  const st = useBoard.getState();
  st.addNode(makeNote(freeSpot(pos, 280, 380), { color: 'sky', blocks: await mdToBlocks('Wochenplan', res.trim()) }));
  return 'Wochenplan als Notiz aufs Board gelegt';
}

/** Sinnvolle Verbindungen zwischen den Karten vorschlagen und ziehen */
export async function aiEdges(nodes: AppNode[]): Promise<string> {
  const items = await gather(nodes);
  if (items.length < 2) throw new Error('Mindestens 2 Karten mit Inhalt nötig.');
  const { edges } = await askJson<{ edges: Array<{ source: string; target: string; label?: string }> }>(
    `Welche der folgenden Karten hängen inhaltlich zusammen? Schlage 1-6 gerichtete Verbindungen vor, jede mit knappem deutschen Beziehungs-Label (z. B. "blockiert", "gehört zu", "liefert Input für"). Antworte NUR mit JSON: {"edges":[{"source":"id","target":"id","label":"..."}]}\n\nKarten:\n${JSON.stringify(items)}`,
  );
  const valid = new Set(items.map((i) => i.id));
  const st = useBoard.getState();
  const existing = new Set(
    useBoard.getState().boards.flatMap((b) => b.edges.map((e) => `${e.source}>${e.target}`)),
  );
  let created = 0;
  st.pushHistory();
  mutedHistory(() => {
    for (const e of (edges ?? []).slice(0, 8)) {
      if (!valid.has(e.source) || !valid.has(e.target) || e.source === e.target) continue;
      if (existing.has(`${e.source}>${e.target}`) || existing.has(`${e.target}>${e.source}`)) continue;
      st.addLabeledEdge(e.source, e.target, (e.label ?? '').slice(0, 30));
      created++;
    }
  });
  if (created === 0) throw new Error('Keine neuen sinnvollen Verbindungen gefunden.');
  return `${created} Verbindung(en) mit Beziehungs-Label gezogen${auslassungsHinweis()}`;
}

/** Notiz-Politur: verbesserte Fassung als NEUE Notiz daneben (Original bleibt) */
export type Fortschritt = (meldung: string) => void;

export async function aiPolish(nodes: AppNode[], fortschritt?: Fortschritt): Promise<string> {
  const notizen = nodes.filter((n) => n.type === 'note' && nodeToText(n).trim());
  if (notizen.length === 0) throw new Error(nodes.some((n) => n.type === 'note') ? 'Die Notiz ist leer.' : 'Bitte eine Notiz auswählen.');
  const st = useBoard.getState();
  let gesichert = false;
  let fertig = 0;
  const fehler: string[] = [];
  // M332: jede Notiz einzeln — eine lange Auswahl bricht nicht mehr nach der ersten ab
  for (const [i, note] of notizen.entries()) {
    if (kiAbgebrochen()) break;
    if (notizen.length > 1) fortschritt?.(`Text ${i + 1} von ${notizen.length} wird verbessert …`);
    const text = nodeToText(note);
    try {
      const answer = await askAi(
        `Verbessere den folgenden Notiztext: korrigiere Rechtschreibung und Grammatik, straffe Formulierungen, behalte Bedeutung, Sprache (Deutsch) und Aufzählungsstruktur bei. Du darfst Markdown nutzen (## Überschriften, **fett**, "- " Punkte, "- [ ] " Checklisten). Antworte NUR mit dem verbesserten Text.\n\n${text.slice(0, 6000)}`,
      );
      const blocks = await mdToBlocks('Vorschlag', answer);
      const suggestion = makeNote(
        freeSpot({ x: note.position.x + ((note.width as number | undefined) ?? 280) + 40, y: note.position.y }, 280, 320),
        { color: 'mint', blocks },
      );
      if (!gesichert) { st.pushHistory(); gesichert = true; }
      mutedHistory(() => {
        st.addNode(suggestion);
        st.addLabeledEdge(note.id, suggestion.id, 'Vorschlag');
      });
      fertig += 1;
    } catch (e) {
      if ((e as Error).message === 'abgebrochen') break;
      fehler.push(`„${nodeToText(note).split('\n')[0].slice(0, 30)}": ${(e as Error).message}`);
    }
  }
  if (fertig === 0 && fehler.length) throw new Error(fehler[0]);
  const basis = notizen.length === 1
    ? 'Verbesserter Text liegt als Vorschlag daneben – das Original bleibt unangetastet'
    : `${fertig} von ${notizen.length} Texten verbessert – die Vorschläge liegen jeweils daneben, die Originale bleiben`;
  if (kiAbgebrochen() && fertig < notizen.length) return `Abgebrochen – ${basis}`;
  return fehler.length ? `${basis}. Nicht geschafft: ${fehler.join(' · ')}` : basis;
}
