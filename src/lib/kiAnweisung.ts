// M410: Die Freitext-Anweisung an die KI – Auftrag bauen, Plan prüfen und ausführen.
//
// Aus aiActions.ts herausgelöst und erst geladen, wenn jemand eine Anweisung abschickt: Der Teil ist mit den
// Modul-Operationen (lib/kiModule.ts) der größte der KI-Anbindung und gehört nicht in den Start der App.
import { tagLokal } from './tag';
import { kiAbgebrochen, mdToBlocks } from './ai';
import { makeFrame, makeGantt, makeMermaid, makeNote, makeShape, makeWeek } from './nodes';
import { mutedHistory, selectActiveBoard, useBoard } from '../store';
import { dateiTextVonKarte } from './dateiText';
import { uid, type AppNode, type ShapeKind, type StickyColor } from '../types';
import { askJsonVoll, CTX_MAX_CHARS, CTX_MAX_NODES, DATEI_MAX_ZEICHEN, freeSpot, gatherImages, imgHint, type Ctx, type Fortschritt } from './aiActions';
import { kiMerken, kiVerlauf } from './kiVerlauf';
import type { KiOp } from './kiModule';

/* ---------- Freitext-Kommando: die KI darf (fast) alles ---------- */

interface AiOp {
  op: string;
  id?: string;
  ids?: string[];
  title?: string;
  text?: string;
  color?: string;
  code?: string;
  shape?: string;
  source?: string;
  target?: string;
  label?: string;
  /** M131: id einer bestehenden Karte, aus der dieses neue Modul abgeleitet
   *  ist — die App zieht dann automatisch einen Pfeil Quelle → neues Modul */
  from?: string;
  items?: Array<{ text?: string; due?: string }>;
  rows?: Array<{ name?: string; start?: string; end?: string; who?: string }>;
  /** M165: Wochenplan-Blöcke (day 0 = Montag, start/dur in Minuten) */
  days?: number;
  entries?: Array<{ day?: number; start?: number; dur?: number; text?: string; who?: string }>;
  /** M165: Rahmen — Name + ids der Karten, um die er gelegt wird */
  name?: string;
  around?: string[];
  /** M410: Felder der Modul-Operationen (lib/kiModule.ts) */
  [feld: string]: unknown;
}

const STICKY = new Set(['yellow', 'pink', 'mint', 'sky', 'white']);
const SHAPES = new Set(['process', 'decision', 'terminator']);

/* M332: Portionen. Ein Wunsch über viele inhaltsschwere Karten (acht
   importierte Markdown-Dateien → acht Notizen) passt weder in EINEN Prompt
   noch in EINE Antwort: Der Kontext-Deckel ließ Karten stumm weg, die
   Ausgabegrenze schnitt den Plan nach der zweiten Notiz ab, und die
   JSON-Reparatur machte daraus einen „Erfolg" mit zwei Schritten. Jetzt
   werden die Karten in Portionen geschnitten, jede Portion ist ein eigener
   Aufruf mit eigenem Plan, zwischen den Portionen gibt es Fortschritt und
   die Möglichkeit abzubrechen — und am Ende steht, was geschafft wurde und
   was nicht. Eine abgeschnittene Antwort halbiert die Portion und versucht
   es erneut; bei einer einzelnen Karte wird das Abschneiden gemeldet. */
const PORTION_ZEICHEN = 14_000;
const PORTION_KARTEN = 12;
const OPS_MAX = 40;

function portionieren(items: Ctx[]): Ctx[][] {
  const aus: Ctx[][] = [];
  let akt: Ctx[] = [];
  let zeichen = 0;
  for (const c of items) {
    const groesse = c.text.length + 60;
    if (akt.length > 0 && (zeichen + groesse > PORTION_ZEICHEN || akt.length >= PORTION_KARTEN)) {
      aus.push(akt); akt = []; zeichen = 0;
    }
    akt.push(c); zeichen += groesse;
  }
  if (akt.length) aus.push(akt);
  return aus;
}

/** Kurzname einer Portion für Meldungen: die ersten Kartentitel */
function portionsName(items: Ctx[]): string {
  const titel = items.slice(0, 2).map((c) => c.text.split('\n')[0].replace(/^(Datei|Bild): /, '').slice(0, 28).trim());
  return titel.join(', ') + (items.length > 2 ? ' …' : '');
}

interface PlanMehr {
  /** Operationen der Module (lib/kiModule.ts) */
  ops: string;
  /** Frühere Anweisungen auf diesem Board */
  verlauf: string;
  /** Karten außerhalb der Auswahl – nur zur Orientierung */
  rest: Ctx[];
  /** Pfeile zwischen den Karten */
  kanten: string;
}

function planPrompt(wish: string, items: Ctx[], imgs: string[], teil?: { i: number; n: number }, mehr?: PlanMehr): string {
  const teilHinweis = teil
    ? `\n\nDies ist Teil ${teil.i} von ${teil.n} einer größeren Aufgabe: Die Karten sind in Portionen aufgeteilt. Setze den Wunsch VOLLSTÄNDIG für JEDE hier gelistete Karte um (z. B. je Karte eine eigene Notiz, wenn der Wunsch das verlangt). Die übrigen Karten kommen in weiteren Teilen und sind hier nicht zu sehen – fasse nichts über diese Portion hinaus zusammen.`
    : '';
  const umgebung = mehr?.rest.length
    ? `Übrige Karten des Boards (NICHT ausgewählt – nur zur Orientierung; lies sie, wenn der Wunsch sie braucht, ändere sie nur, wenn er es ausdrücklich verlangt):\n${JSON.stringify(mehr.rest)}\n\nAusgewählt sind die Karten der folgenden Liste – auf sie bezieht sich der Wunsch.\n\n`
    : '';
  return `Du bist der Assistent eines Whiteboard-Tools (Karten auf einer Leinwand). Setze den Wunsch des Nutzers als Operationsplan um.
Heute ist ${tagLokal(new Date())}.
${mehr?.verlauf ?? ''}
Wunsch: "${wish}"

Zu den Karten: "pos" ist die Lage [x, y] auf der Leinwand (x nach rechts, y nach unten). Teile eines Moduls (Ticket, Vorgang, Eintrag, Sitzung) stehen im Text mit ihrer Kennung in eckigen Klammern – verwende genau diese Kennung, um das Teil anzusprechen.
${mehr?.kanten ?? ''}${umgebung}Vorhandene Karten (id, type, text):
${JSON.stringify(items)}${teilHinweis}

Antworte NUR mit JSON: {"summary":"1 kurzer deutscher Satz, was du getan hast","ops":[...]}
Erlaubte Operationen (max. ${OPS_MAX}):
{"op":"note","title":"...","text":"Markdown: '## ' Überschriften, **fett**, '- ' Punkte, '- [ ] ' Checklisten","color":"yellow|pink|mint|sky|white","from":"<optional: id der Quell-Karte>"}
{"op":"kanban","title":"...","items":[{"text":"...","due":"yyyy-mm-dd"}],"from":"<optional>"}
{"op":"gantt","title":"...","rows":[{"name":"...","start":"yyyy-mm-dd","end":"yyyy-mm-dd","who":"Name"}],"from":"<optional>"}
{"op":"mermaid","code":"flowchart TD\\n  A[Start] --> B[Ende]","from":"<optional>"}
{"op":"shape","shape":"process|decision|terminator","text":"...","from":"<optional>"}
{"op":"week","title":"...","days":5|7,"entries":[{"day":0,"start":540,"dur":90,"text":"...","who":"optional"}],"from":"<optional>"} (Stunden-/Wochen-/Dienstplan: day 0=Montag … 6=Sonntag, start/dur in MINUTEN seit Mitternacht)
{"op":"time","title":"...","from":"<optional>"} (Arbeitszeiterfassungs-Karte mit Start/Stop)
{"op":"frame","name":"...","around":["<id>","<id>"]} (benannter Rahmen-Bereich UM die genannten vorhandenen Karten – gruppiert sie)
{"op":"edit_note","id":"<existierende Notiz-id>","text":"KOMPLETTER neuer Inhalt als Markdown; erste Zeile = '## Überschrift'"}
{"op":"edit_title","id":"<id>","title":"..."} (Titel eines Moduls oder Text einer Form)
{"op":"add_tickets","id":"<Kanban-id>","items":[{"text":"...","due":"yyyy-mm-dd"}]}
{"op":"edge","source":"<id>","target":"<id>","label":"kurzes Label"}
{"op":"delete","ids":["<id>"]} (NUR wenn der Nutzer ausdrücklich löschen will)
${mehr?.ops ?? ''}
Modulwahl: Prozesse/Abläufe → mermaid · Aufgabenlisten → kanban · Phasen/Zeiträume/Termine → gantt · Stundenplan/Wochenplan/Dienstplan → week · Arbeitszeit erfassen → time · Zahlen, Kalkulationen, Vergleiche, Listen mit Spalten → sheet · wiederkehrende Besprechungen → minutes · Ideen sammeln und abstimmen → bubbles · Karten thematisch gruppieren → frame · Wissen/Text → note (Markdown voll ausnutzen, erledigbare Punkte als '- [ ] ' Checklisten).
Regeln: verwende nur existierende ids und Kennungen aus den Listen; setze keine Emojis in Titel, Namen und Texte; bezieht sich der Wunsch auf ein vorhandenes Modul, ÄNDERE es (Zeile ergänzen, Ticket verschieben, Text anhängen) statt ein neues anzulegen; bei "verbessern/umschreiben" nutze edit_note mit dem vollständigen neuen Text; erfinde keine Fakten – rechne und zähle anhand der Karten. Leitest du ein neues Modul aus dem Inhalt einer bestehenden Karte ab (oder bezieht es sich klar auf sie), setze deren id als "from" – das Board verbindet beide dann automatisch mit einem Pfeil.${imgHint(imgs)}`;
}

interface PlanErgebnis { done: number; editedNote: boolean; antworten: string[] }
type KiModul = typeof import('./kiModule');

/** Einen validierten Operationsplan ausführen — synchron, innerhalb von mutedHistory */
function planAusfuehren(
  plan: AiOp[],
  preBlocks: Map<AiOp, unknown[]>,
  known: Map<string, AppNode>,
  st: ReturnType<typeof useBoard.getState>,
  place: (h: number) => { x: number; y: number },
  modul?: { km: KiModul; bloecke: Map<KiOp, unknown[][]> },
): PlanErgebnis {
  let done = 0;
  let editedNote = false;
  const antworten: string[] = [];
  // M131: „from" an Erzeugungs-Ops → Pfeil von der Quell-Karte zum neuen Modul
  const linkFrom = (o: AiOp, newId: string) => {
    if (o.from && known.has(o.from)) st.addLabeledEdge(o.from, newId, '');
  };
    for (const o of plan) {
      /* M410: Erst die Module fragen (lib/kiModule.ts) – sie kennen ihre eigenen Operationen: Tabelle füllen,
         Ticket verschieben, Sitzung anlegen … Was dort nicht hingehört, übernehmen die Grund-Operationen unten. */
      if (modul) {
        const r = modul.km.kiAusfuehren(o as KiOp, {
          known, st, place, bloecke: modul.bloecke,
          linkFrom: (op, neu) => linkFrom(op as AiOp, neu),
          notizGeaendert: () => { editedNote = true; },
          antwort: (t) => antworten.push(t),
        });
        if (r !== undefined) { if (r) done++; continue; }
      }
      switch (o.op) {
        case 'note': {
          const blocks = preBlocks.get(o);
          if (!blocks || blocks.length === 0) break;
          const color = STICKY.has(o.color ?? '') ? (o.color as StickyColor) : undefined;
          const node = makeNote(place(180), { color, blocks: blocks as never[] });
          st.addNode(node);
          linkFrom(o, node.id);
          done++;
          break;
        }
        case 'gantt': {
          const iso = /^\d{4}-\d{2}-\d{2}$/;
          const rows = (o.rows ?? [])
            .filter((r) => r.name?.trim() && iso.test(r.start ?? '') && iso.test(r.end ?? ''))
            .slice(0, 20)
            .map((r) => ({
              id: uid(), name: r.name!.trim().slice(0, 80),
              start: r.start!, end: r.end! >= r.start! ? r.end! : r.start!,
              who: r.who?.trim().slice(0, 40) || undefined,
            }));
          if (rows.length === 0) break;
          const node = makeGantt(place(240));
          (node.data as { title: string; rows: unknown[] }).title = (o.title ?? 'Zeitplan').slice(0, 60);
          (node.data as { rows: unknown[] }).rows = rows;
          st.addNode(node);
          linkFrom(o, node.id);
          done++;
          break;
        }
        case 'mermaid': {
          const code = (o.code ?? '').replace(/```(mermaid)?/g, '').trim();
          if (!code) break;
          const node = makeMermaid(place(260));
          (node.data as { code: string; fitOnLoad?: boolean }).code = code;
          (node.data as { fitOnLoad?: boolean }).fitOnLoad = true; // Karte ans Diagramm anpassen (M122)
          st.addNode(node);
          linkFrom(o, node.id);
          done++;
          break;
        }
        case 'shape': {
          const node = makeShape(place(90), SHAPES.has(o.shape ?? '') ? (o.shape as ShapeKind) : 'process');
          (node.data as { text: string }).text = (o.text ?? '').slice(0, 60);
          st.addNode(node);
          linkFrom(o, node.id);
          done++;
          break;
        }
        case 'week': {
          // Wochen-/Stundenplan (M165): Blöcke validieren, Zeitfenster ableiten
          const days = o.days === 7 ? 7 : 5;
          const entries = (o.entries ?? [])
            .filter((e) => e.text?.trim()
              && Number.isFinite(e.day) && e.day! >= 0 && e.day! < days
              && Number.isFinite(e.start) && e.start! >= 0 && e.start! < 1440)
            .slice(0, 40)
            .map((e) => ({
              id: uid(), day: e.day!, start: Math.round(e.start! / 30) * 30,
              dur: Math.min(720, Math.max(30, Math.round((e.dur ?? 60) / 30) * 30)),
              text: e.text!.trim().slice(0, 80),
              who: e.who?.trim().slice(0, 30) || undefined,
            }));
          const node = makeWeek(place(440));
          const minStart = Math.min(8 * 60, ...entries.map((e) => e.start));
          const maxEnd = Math.max(17 * 60, ...entries.map((e) => e.start + e.dur));
          Object.assign(node.data, {
            title: (o.title ?? 'Wochenplan').slice(0, 60),
            days,
            from: Math.max(0, Math.floor(minStart / 60) * 60),
            to: Math.min(24 * 60, Math.ceil(maxEnd / 60) * 60),
            entries,
          });
          st.addNode(node);
          linkFrom(o, node.id);
          done++;
          break;
        }
        case 'frame': {
          // Rahmen UM vorhandene Karten legen (M165) — Bounding-Box + Luft
          const members = (o.around ?? []).map((mid) => known.get(mid)).filter((n): n is AppNode => !!n && n.type !== 'frame');
          if (members.length === 0) break;
          const sx = Math.min(...members.map((n) => n.position.x));
          const sy = Math.min(...members.map((n) => n.position.y));
          const ex = Math.max(...members.map((n) => n.position.x + (n.width ?? n.measured?.width ?? 260)));
          const ey = Math.max(...members.map((n) => n.position.y + (n.height ?? n.measured?.height ?? 160)));
          const node = makeFrame({ x: sx - 30, y: sy - 56 }, (o.name ?? o.title ?? 'Bereich').slice(0, 50));
          node.width = ex - sx + 60;
          node.height = ey - sy + 86;
          st.addNode(node);
          done++;
          break;
        }
        case 'edit_note': {
          const target = known.get(o.id ?? '');
          const blocks = preBlocks.get(o);
          if (!target || target.type !== 'note' || !blocks || blocks.length === 0) break;
          st.updateNodeData(target.id, { blocks });
          editedNote = true;
          done++;
          break;
        }
        case 'edit_title': {
          const target = known.get(o.id ?? '');
          if (!target || !o.title?.trim()) break;
          const title = o.title.trim().slice(0, 80);
          if (target.type === 'kanban' || target.type === 'gantt' || target.type === 'week' || target.type === 'time') st.updateNodeData(target.id, { title });
          else if (target.type === 'shape') st.updateNodeData(target.id, { text: title });
          else if (target.type === 'frame' || target.type === 'htmlapp') st.updateNodeData(target.id, { name: title });
          else break;
          done++;
          break;
        }
        case 'edge': {
          if (!known.has(o.source ?? '') || !known.has(o.target ?? '') || o.source === o.target) break;
          st.addLabeledEdge(o.source!, o.target!, (o.label ?? '').slice(0, 30));
          done++;
          break;
        }
        case 'delete': {
          const ids = (o.ids ?? []).filter((id) => known.has(id));
          if (ids.length === 0) break;
          st.removeNodes(ids);
          done++;
          break;
        }
        default:
          break;
      }
    }
  return { done, editedNote, antworten };
}

/* M410: Wie viel Inhalt in EINEN Auftrag passt. Große Modelle lesen ein ganzes Board; kleine (Gratis-Dienst,
   lokales Ollama) verlieren bei langen Aufträgen den Faden oder brechen ab – sie bekommen den alten Deckel. */
const platzFuer = (anbieter: string): number => (anbieter === 'free' || anbieter === 'ollama' ? CTX_MAX_CHARS : 80_000);
/** Der Wunsch verlangt etwas für JEDE Karte („alle Dateien", „jede Notiz") – dann wird in Portionen gearbeitet */
const FUER_JEDE = /(^|[^a-zäöüß])(jede[rsnm]?|jeweils|alle[nrs]?|sämtliche[nrs]?|each|every|all)(?![a-zäöüß])/i;

/** M427: Der Wunsch verlangt eine Präsentation (anlegen – nicht eine Notiz ZUR Präsentation oder eine Frage danach) */
export function willPraesentation(wunsch: string): boolean {
  const s = wunsch.toLowerCase();
  const m = /(präsentation|praesentation|foliensatz|folien|slides?|slide ?deck|presentation)(?![a-zäöüß])/.exec(s);
  if (!m) return false;
  const davor = s.slice(Math.max(0, m.index - 14), m.index);
  if (/(zur|zum|der|des|die|dem|den|in|im|auf|the)\s+$/.test(davor)) return false;
  return /(^|[^a-zäöüß])(erstell|mach|bau|generier|entwirf|entwerf|schreib|leg\S* .{0,40}an\b|bereite?\S* .{0,40}vor\b|vorbereit|create|make|build|generate|draft|prepare)/.test(s);
}

/**
 * Freitext-Anweisung ausführen: „Erstelle …", „Verbessere …", „Verbinde …", „Wie viel …?".
 * Die KI liefert einen Operationsplan (JSON), der validiert und über die
 * Undo-History ausgeführt wird — Strg+Z macht ALLES auf einmal rückgängig.
 * M332: bei vielen/inhaltsschweren Karten in Portionen mit Fortschritt.
 * M410: Jedes Modul wird vollständig gelesen und lässt sich bedienen (lib/kiModule.ts); bei einer Auswahl sieht
 * das Modell den Rest des Boards zur Orientierung; frühere Anweisungen auf dem Board gehen mit (lib/kiVerlauf.ts).
 */
export async function aiCommand(instruction: string, nodes: AppNode[], pos: { x: number; y: number }, fortschritt?: Fortschritt): Promise<string> {
  const wish = instruction.trim();
  if (!wish) throw new Error('Bitte zuerst eine Anweisung eingeben.');
  /* M427: „Mach eine Präsentation …" / „Erstelle Folien zu …" – ein eigener Weg (Gliederung → Vibe-Studio-Folien),
     nicht der Operationsplan: Folien sind kein Modul, das man Schritt für Schritt füllt. */
  if (willPraesentation(wish)) {
    const { aiPraesentation } = await import('./aiActions');
    const st0 = useBoard.getState();
    const alle = selectActiveBoard(st0)?.nodes ?? nodes;
    const ergebnis = await aiPraesentation(nodes.length ? nodes : alle, pos, fortschritt, wish);
    const b0 = selectActiveBoard(useBoard.getState());
    if (b0) kiMerken(b0.id, { t: Date.now(), wunsch: wish, ergebnis, karten: [] });
    return ergebnis;
  }
  const km = await import('./kiModule');
  const st = useBoard.getState();
  const board = selectActiveBoard(st);
  const boardNodes = board?.nodes ?? nodes;
  const umfeld = { alle: boardNodes, boards: st.boards.map((b) => ({ id: b.id, name: b.name })) };
  const gewaehlt = new Set(nodes.map((n) => n.id));
  const restNodes = boardNodes.filter((n) => !gewaehlt.has(n.id) && !n.archived);
  const known = new Map([...boardNodes, ...nodes].map((n) => [n.id, n]));
  const verlauf = board ? kiVerlauf(board.id) : [];
  const platz = platzFuer(st.ai.provider);

  // Inhalt je Karte: ganz (gedeckelt), Dateien mit ihrem Text
  const dateien = await Promise.all(nodes.map((n) => (n.type === 'file' && !n.archived ? dateiTextVonKarte(n).catch(() => null) : Promise.resolve(null))));
  const lage = (n: AppNode): [number, number] => [Math.round(n.position.x / 10) * 10, Math.round(n.position.y / 10) * 10];
  const ganz = (n: AppNode, i: number): Ctx => {
    const eigen = km.kiLesen(n, umfeld);
    const inhalt = dateien[i]?.trim();
    return { id: n.id, type: n.type ?? '?', text: inhalt ? `${eigen}\nInhalt der Datei:\n${inhalt.slice(0, DATEI_MAX_ZEICHEN)}` : eigen, pos: lage(n) };
  };
  let alle = nodes.map(ganz).filter((c) => c.text);
  const gesamtZeichen = alle.reduce((a, c) => a + c.text.length + 60, 0);
  /* Gilt der Wunsch JEDER Karte („wandle alle Dateien um"), begrenzt nicht der Auftrag, sondern die ANTWORT: Acht
     umgeschriebene Dokumente passen in keine. Dann bleibt es beim engen Maß, und es wird in Portionen gearbeitet. */
  const jede = FUER_JEDE.test(wish);
  let einzeln = alle.length <= CTX_MAX_NODES && gesamtZeichen <= (jede ? CTX_MAX_CHARS : platz);
  let ausgelassen = 0;

  // Rangfolge: was hat mit dem Wunsch zu tun? (Wörter, genanntes Modul, zuletzt Berührtes, Nähe der Bedeutung)
  const rangfolge = async (karten: Ctx[]): Promise<Map<string, number>> => {
    const naehe = new Map<string, number>();
    if (st.brain.on && board) {
      try {
        const { brainSearch } = await import('./brain');
        const treffer = await Promise.race([brainSearch(wish, 16), new Promise<never[]>((r) => setTimeout(() => r([]), 2500))]);
        for (const t of treffer) if (t.boardId === board.id) naehe.set(t.nodeId, t.score);
      } catch { /* ohne Gehirn zählen die Wörter */ }
    }
    return km.kiRang(wish, karten, new Set(verlauf[verlauf.length - 1]?.karten ?? []), naehe);
  };

  if (!einzeln && !jede) {
    /* Zu viel für einen Auftrag, aber der Wunsch gilt nicht jeder Karte einzeln: EIN Auftrag, in dem die Karten,
       die mit dem Wunsch zu tun haben, ganz stehen und die übrigen als Steckbrief. Früher wurde auch dann in
       Portionen gearbeitet – jede Portion legte ihr eigenes Kanban an, keine sah das ganze Board. */
    const rang = await rangfolge(alle);
    const nachRang = [...alle].sort((a, b) => (rang.get(b.id) ?? 0) - (rang.get(a.id) ?? 0));
    const vollIds = new Set<string>(); let frei = platz * 0.75;
    for (const c of nachRang) { const g = c.text.length + 60; if (g > frei) continue; vollIds.add(c.id); frei -= g; }
    const knapp = Math.max(160, Math.min(400, Math.floor((platz * 0.2) / Math.max(1, alle.length - vollIds.size))));
    const behalten = new Set(nachRang.slice(0, 200).map((c) => c.id));
    ausgelassen = alle.length - behalten.size;
    alle = alle.filter((c) => behalten.has(c.id)).map((c) => (vollIds.has(c.id) ? c : { ...c, text: km.kiKurz(known.get(c.id)!, umfeld, knapp) }));
    einzeln = true;
  }

  // Bei einer Auswahl: der Rest des Boards als Steckbrief – damit „trage die Tickets aus dem Kanban ein" geht
  let rest: Ctx[] = [];
  if (nodes.length < boardNodes.length && restNodes.length) {
    const steckbriefe = restNodes.map((n) => ({ id: n.id, type: n.type ?? '?', text: km.kiLesen(n, umfeld, 1200), pos: lage(n) })).filter((c) => c.text);
    const rang = await rangfolge(steckbriefe);
    let frei = Math.min(12_000, platz * 0.25);
    for (const c of [...steckbriefe].sort((a, b) => (rang.get(b.id) ?? 0) - (rang.get(a.id) ?? 0)).slice(0, 40)) {
      const t = (rang.get(c.id) ?? 0) > 0 ? c.text : km.kiKurz(known.get(c.id)!, umfeld, 200);
      if (t.length + 60 > frei) continue;
      rest.push({ ...c, text: t }); frei -= t.length + 60;
    }
    rest = restNodes.map((n) => rest.find((c) => c.id === n.id)).filter((c): c is Ctx => !!c);
  }

  // Pfeile zwischen den Karten, die das Modell sieht
  const sichtbar = new Set([...alle, ...rest].map((c) => c.id));
  const pfeile = (board?.edges ?? []).filter((e) => sichtbar.has(e.source) && sichtbar.has(e.target)).slice(0, 80)
    .map((e) => `${e.source} → ${e.target}${typeof e.label === 'string' && e.label ? ` (${e.label})` : ''}`);
  const frueher = verlauf.slice(-5).map((e, i) => {
    const da = e.karten.filter((id) => known.has(id));
    return `${i + 1}. „${e.wunsch.slice(0, 240)}" → ${e.ergebnis.slice(0, 200)}${da.length ? ` (Karten: ${da.join(', ')})` : ''}`;
  });
  const mehr: PlanMehr = {
    ops: km.kiOpsText(new Set(boardNodes.map((n) => n.type ?? ''))),
    verlauf: frueher.length ? `\nBisher auf diesem Board verlangt (älteste zuerst; „es", „das", „die Tabelle", „noch", „auch" im Wunsch beziehen sich meist auf das Letzte):\n${frueher.join('\n')}\n` : '',
    rest,
    kanten: pfeile.length ? `Pfeile zwischen den Karten: ${pfeile.join(' · ')}\n` : '',
  };

  const warteschlange: Ctx[][] = einzeln ? [alle] : portionieren(alle);
  const inPortionen = warteschlange.length > 1;
  const vorher = new Set(boardNodes.map((n) => n.id));
  const beruehrt = new Set<string>();

  let y = pos.y;
  const place = (h: number) => {
    // Kollisionsfrei (M130): freien Platz suchen — dank frischem Store-Stand
    // stapeln sich auch mehrere Module EINES Plans sauber untereinander
    const p = freeSpot({ x: pos.x, y }, 420, h);
    y = p.y + h + 40;
    return p;
  };

  let gesichert = false;
  let done = 0;
  let editedNote = false;
  let teilNr = 0;
  let geschafft = 0;
  let abgebrochen = false;
  const zusammenfassungen: string[] = [];
  const fehler: string[] = [];
  const antworten: string[] = [];

  while (warteschlange.length) {
    if (kiAbgebrochen()) { abgebrochen = true; break; }
    const items = warteschlange.shift()!;
    teilNr += 1;
    const gesamt = teilNr + warteschlange.length;
    if (inPortionen || gesamt > 1) fortschritt?.(`Teil ${teilNr} von ${gesamt} (${items.length} Karte${items.length === 1 ? '' : 'n'}) …`);
    const teilNodes = einzeln ? nodes : items.map((c) => known.get(c.id)).filter((n): n is AppNode => !!n);
    try {
      const imgs = await gatherImages(teilNodes);
      const { wert, abgeschnitten } = await askJsonVoll<{ summary?: string; ops: AiOp[] }>(
        planPrompt(wish, items, imgs, gesamt > 1 ? { i: teilNr, n: gesamt } : undefined, mehr),
        imgs,
      );
      if (abgeschnitten && items.length > 1) {
        // Antwort unvollständig: Portion halbieren und beide Hälften erneut anfragen
        const h = Math.ceil(items.length / 2);
        warteschlange.unshift(items.slice(0, h), items.slice(h));
        teilNr -= 1;
        continue;
      }
      const plan = (Array.isArray(wert.ops) ? wert.ops : []).filter((o) => o && typeof o.op === 'string').slice(0, OPS_MAX);
      if (plan.length === 0) {
        fehler.push(`Teil ${teilNr} (${portionsName(items)}): keine ausführbaren Schritte geliefert`);
        continue;
      }
      // Markdown VOR dem synchronen Ausführen parsen (mdToBlocks ist async, M117)
      const preBlocks = new Map<AiOp, unknown[]>();
      for (const o of plan) {
        if (o.op === 'note') {
          const md = [o.title?.trim() ? `### ${o.title.trim()}` : '', o.text ?? ''].filter(Boolean).join('\n\n');
          if (md) preBlocks.set(o, await mdToBlocks('', md));
        } else if (o.op === 'edit_note' && o.text?.trim()) {
          preBlocks.set(o, await mdToBlocks('', o.text));
        }
      }
      const bloecke = await km.kiVorbereiten(plan as KiOp[], mdToBlocks);
      // EIN Snapshot für die ganze Aktion: innere Mutatoren pushen keine eigenen Einträge
      const nurAntwort = plan.every((o) => o.op === 'answer');
      if (!gesichert && !nurAntwort) { st.pushHistory(); gesichert = true; }
      const erg = mutedHistory(() => planAusfuehren(plan, preBlocks, known, st, place, { km, bloecke }));
      done += erg.done;
      editedNote = editedNote || erg.editedNote;
      antworten.push(...erg.antworten);
      for (const o of plan) { if (typeof o.id === 'string' && known.has(o.id)) beruehrt.add(o.id); for (const id of o.ids ?? []) if (known.has(id)) beruehrt.add(id); }
      if (erg.done > 0) geschafft += 1;
      else fehler.push(`Teil ${teilNr} (${portionsName(items)}): kein Schritt war ausführbar (unbekannte ids?)`);
      if (wert.summary?.trim()) zusammenfassungen.push(wert.summary.trim());
      if (abgeschnitten) fehler.push(`Teil ${teilNr} (${portionsName(items)}): die Antwort des Modells war abgeschnitten – das Ergebnis ist vermutlich unvollständig`);
    } catch (e) {
      if ((e as Error).message === 'abgebrochen') { abgebrochen = true; break; }
      fehler.push(`Teil ${teilNr} (${portionsName(items)}): ${(e as Error).message}`);
    }
  }

  if (done === 0) {
    if (abgebrochen) return 'Abgebrochen – es wurde noch nichts geändert.';
    throw new Error(fehler.length
      ? (teilNr > 1 ? `Nichts umgesetzt. ${fehler.join(' · ')}` : fehler[0].replace(/^Teil 1 \([^)]*\): /, ''))
      : 'Die KI hat keine ausführbaren Schritte geliefert – Anweisung bitte konkreter formulieren.');
  }

  /* M410: Eine Antwort auf eine Frage. Kurz steht sie in der Meldung; was länger ist, wird eine Notiz – dort lässt
     sie sich lesen, behalten und weiterverwenden. */
  const antwort = antworten.join('\n\n').trim();
  const nurAntwort = !!antwort && done === antworten.length;
  let antwortKurz = '';
  if (antwort) {
    if (antwort.length <= 220 && !antwort.includes('\n')) antwortKurz = antwort;
    else {
      const blocks = await mdToBlocks('', `### ${wish.slice(0, 90)}\n\n${antwort}`);
      if (!gesichert) { st.pushHistory(); gesichert = true; }
      mutedHistory(() => { const node = makeNote(place(200), { color: 'white', blocks: blocks as never[] }); st.addNode(node); });
    }
  }

  if (editedNote) {
    // BlockNote liest Inhalte nur beim Mount — geänderte Notizen brauchen
    // einen Board-Remount, sonst zeigt der Editor den alten Text. Der
    // History-Eintrag wird markiert, damit auch Undo/Redo neu mountet.
    useBoard.setState((s) => ({
      importEpoch: s.importEpoch + 1,
      past: s.past.map((e, i) => (i === s.past.length - 1 ? { ...e, remount: true } : e)),
    }));
  }

  // Gedächtnis: was verlangt wurde, was daraus wurde, welche Karten es betraf
  const jetzt = selectActiveBoard(useBoard.getState());
  if (board && jetzt && jetzt.id === board.id) {
    for (const n of jetzt.nodes) if (!vorher.has(n.id)) beruehrt.add(n.id);
    kiMerken(board.id, { t: Date.now(), wunsch: wish, ergebnis: antwortKurz || zusammenfassungen[0] || (antwort ? antwort.slice(0, 300) : 'umgesetzt'), karten: [...beruehrt].filter((id) => jetzt.nodes.some((n) => n.id === id)) });
  }

  const knapp = ausgelassen > 0 ? ` – ${ausgelassen} Karten passten nicht in den Auftrag (Karten auswählen grenzt ein)` : '';
  if (nurAntwort) return antwortKurz || `Die Antwort liegt als Notiz auf dem Board${knapp}`;
  const schritte = `${done} Schritt${done > 1 ? 'e' : ''}`;
  if (abgebrochen) return `Abgebrochen nach Teil ${teilNr - 1} – ${schritte} bleiben (Strg+Z macht sie rückgängig)`;
  if (fehler.length) {
    return `${geschafft} von ${teilNr} Teilen umgesetzt (${schritte}). Nicht geschafft: ${fehler.join(' · ')}. Tipp: die betroffenen Karten auswählen und die Anweisung dort erneut ausführen.`;
  }
  const kopf = antwortKurz || zusammenfassungen[0] || 'Anweisung umgesetzt';
  if (teilNr > 1) return `${kopf} – ${schritte} in ${teilNr} Teilen (Strg+Z macht alles rückgängig)${knapp}`;
  return `${kopf} (${schritte} – Strg+Z macht alles rückgängig)${knapp}`;
}
