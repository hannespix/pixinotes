// M445: Karten nach Themen ordnen (Auto-Clustering, Roadmap KONZEPT.md „Clustering").
//
// Ablauf: Vorschlag → Bestätigung → Ordnen.
//   1. VORSCHLAG: Die Chat-KI bekommt die Karten (so, wie sie sich ihr beschreiben, lib/kiModule.ts) und liefert
//      Themengruppen mit Namen. Ohne Chat-KI – oder wenn sie scheitert – gruppiert das „Gehirn" (lib/brain.ts) über
//      die Einbettungen der Karten; die Namen kommen dann aus den häufigsten Wörtern der Kartentitel.
//   2. BESTÄTIGUNG: components/ThemenDialog.tsx zeigt die Gruppen; Namen lassen sich ändern, Gruppen abwählen.
//      Erst „Ordnen" verändert das Board.
//   3. ORDNEN: Je Gruppe ein benannter Rahmen (Frame-Karte), die Karten darin als Raster; die Rahmen nebeneinander,
//      kollisionsfrei neben den übrigen Karten. Alles ist EIN Schritt im Verlauf – Strg+Z stellt die alte Lage her.
//
// Nichts geht verloren: Karten, die die KI vergisst, kommen in „Weitere Karten"; unbekannte Kennungen fallen weg;
// keine Karte steht in zwei Gruppen. Das frühere „Themen clustern & anordnen" (aiCluster, M130) legte Form-Karten
// als Überschriften und Linien zu jeder Karte an – die Rahmen ersetzen beides: Sie halten das Thema zusammen,
// wandern samt Inhalt und lassen sich mit einem Klick auflösen.
import { mutedHistory, selectActiveBoard, useBoard } from '../store';
import { uid, type AppNode } from '../types';
import { findFreeSpot, frameMembers, sizeOf } from './arrange';
import { FRAME_COLORS } from './frameOps';
import { aiReady, kiAbbruchZuruecksetzen, kiAbgebrochen } from './ai';
import { askJson, auslassungsHinweis, gather } from './aiActions';
import { nodeToText } from './serialize';
import { zahlWort } from './sprache';

export interface ThemenGruppe { titel: string; ids: string[] }
export interface ThemenVorschlag {
  boardId: string;
  gruppen: ThemenGruppe[];
  /** Wer gruppiert hat: Chat-KI oder Einbettungen des Gehirns */
  quelle: 'ki' | 'gehirn';
  /** Zusatz für die Meldung (weggelassene Karten, Rückfall aufs Gehirn) */
  hinweis: string;
}

export const REST_TITEL = 'Weitere Karten';
const MAX_GRUPPEN = 6;
const TITEL_MAX = 40;

/** Was geordnet wird: die Auswahl (ohne Rahmen) – oder ohne Auswahl alle losen Karten des Boards
 *  (nicht archiviert, keine Rahmen, in keinem Rahmen). Bereits gerahmte Inhalte bleiben, wo sie sind. */
export function themenKandidaten(alle: AppNode[], auswahl?: AppNode[]): AppNode[] {
  if (auswahl && auswahl.length) return auswahl.filter((n) => n.type !== 'frame' && !n.archived);
  const rahmen = alle.filter((n) => n.type === 'frame' && !n.archived);
  const gerahmt = new Set(rahmen.flatMap((f) => frameMembers(f, alle).map((m) => m.id)));
  return alle.filter((n) => n.type !== 'frame' && !n.archived && !gerahmt.has(n.id));
}

/** Die Antwort der KI in saubere Gruppen bringen: bekannte Kennungen, jede Karte einmal, Vergessenes in den Rest */
export function gruppenBereinigen(roh: ThemenGruppe[], karten: AppNode[]): ThemenGruppe[] {
  const bekannt = new Set(karten.map((k) => k.id));
  const vergeben = new Set<string>();
  const out: ThemenGruppe[] = [];
  for (const g of roh) {
    const ids = (g.ids ?? []).filter((id) => typeof id === 'string' && bekannt.has(id) && !vergeben.has(id));
    ids.forEach((id) => vergeben.add(id));
    if (!ids.length) continue;
    const titel = String(g.titel ?? '').replace(/\s+/g, ' ').trim().slice(0, TITEL_MAX) || `Thema ${out.length + 1}`;
    const gleich = out.find((o) => o.titel.toLowerCase() === titel.toLowerCase());
    if (gleich) gleich.ids.push(...ids); else out.push({ titel, ids });
  }
  const rest = karten.filter((k) => !vergeben.has(k.id)).map((k) => k.id);
  if (rest.length) {
    const r = out.find((o) => o.titel === REST_TITEL);
    if (r) r.ids.push(...rest); else out.push({ titel: REST_TITEL, ids: rest });
  }
  return out;
}

/* ---------- Vorschlag per Chat-KI ---------- */
async function perKi(karten: AppNode[]): Promise<{ gruppen: ThemenGruppe[]; hinweis: string }> {
  const items = await gather(karten);
  if (items.length < 3) throw new Error('Zu wenig Inhalt zum Ordnen (mindestens 3 Karten mit Text).');
  const maxG = Math.min(MAX_GRUPPEN, Math.max(2, Math.round(Math.sqrt(items.length)) + 1));
  const antwort = await askJson<{ themen?: Array<{ titel?: string; ids?: string[] }>; clusters?: Array<{ title?: string; nodeIds?: string[] }> }>(
    `Ordne die folgenden Whiteboard-Karten nach Themen. Bilde 2 bis ${maxG} Themengruppen; jede Karte gehört in genau eine Gruppe. Gib jeder Gruppe einen kurzen, treffenden deutschen Namen (höchstens 4 Wörter), so wie man einen Rahmen auf dem Board beschriften würde. Antworte NUR mit JSON, exakt in dieser Form: {"themen":[{"titel":"...","ids":["..."]}]}\n\nKarten:\n${JSON.stringify(items)}`,
  );
  const roh: ThemenGruppe[] = antwort?.themen?.map((t) => ({ titel: t.titel ?? '', ids: t.ids ?? [] }))
    ?? antwort?.clusters?.map((c) => ({ titel: c.title ?? '', ids: c.nodeIds ?? [] })) ?? [];
  if (!roh.length) throw new Error('Die KI hat keine Themen erkannt.');
  return { gruppen: roh, hinweis: auslassungsHinweis() };
}

/* ---------- Rückfall: Einbettungen des Gehirns ---------- */
const STOPP = new Set('der die das und oder mit für von zum zur den dem des ein eine einer eines im in am an auf aus bei bis nach über unter vor zu ist sind wird werden noch nicht auch als wie was wer neue neuer neues notiz karte'.split(' '));

/** Name einer Gruppe ohne KI: das häufigste tragende Wort der Kartentitel (wie topicLabel, M208) */
function nameAusTiteln(titel: string[], nr: number): string {
  const zahl = new Map<string, { n: number; wort: string }>();
  for (const t of titel) {
    const gesehen = new Set<string>();
    for (const w of t.split(/[^\p{L}\p{N}-]+/u)) {
      const k = w.toLowerCase();
      if (k.length < 4 || STOPP.has(k) || gesehen.has(k)) continue;
      gesehen.add(k);
      const e = zahl.get(k) ?? { n: 0, wort: w };
      e.n += 1; zahl.set(k, e);
    }
  }
  const best = [...zahl.values()].sort((a, b) => b.n - a.n)[0];
  return best ? best.wort.charAt(0).toUpperCase() + best.wort.slice(1) : `Thema ${nr}`;
}

const skalar = (a: number[], b: number[]): number => { let s = 0; for (let i = 0; i < Math.min(a.length, b.length); i += 1) s += a[i] * b[i]; return s; };

/** Agglomerativ (mittlere Ähnlichkeit): so lange die zwei ähnlichsten Gruppen zusammenlegen, bis keine Paarung mehr
 *  über der Schwelle liegt UND höchstens MAX_GRUPPEN übrig sind. Bei wenigen Dutzend Karten genügt das Quadrat. */
export function gruppierenNachVektoren(vek: Array<{ id: string; vec: number[] }>, schwelle = 0.6): string[][] {
  let gruppen = vek.map((v) => [v]);
  const aehnlich = (a: typeof gruppen[0], b: typeof gruppen[0]) => {
    let s = 0;
    for (const x of a) for (const y of b) s += skalar(x.vec, y.vec);
    return s / (a.length * b.length);
  };
  while (gruppen.length > 1) {
    let bi = -1, bj = -1, bs = -Infinity;
    for (let i = 0; i < gruppen.length; i += 1) for (let j = i + 1; j < gruppen.length; j += 1) {
      const s = aehnlich(gruppen[i], gruppen[j]);
      if (s > bs) { bs = s; bi = i; bj = j; }
    }
    if (bs < schwelle && gruppen.length <= MAX_GRUPPEN) break;
    gruppen = [...gruppen.filter((_, k) => k !== bi && k !== bj), [...gruppen[bi], ...gruppen[bj]]];
  }
  return gruppen.map((g) => g.map((x) => x.id));
}

/** M451: Meldung, wenn der Bereich des Boards vom Gehirn ausgeschlossen ist */
export const GEHIRN_AUSGESCHLOSSEN = 'Dieser Bereich ist vom Gehirn ausgeschlossen – ohne Chat-KI lassen sich seine Karten nicht nach Themen ordnen. Einschalten unter Einstellungen → Gehirn → Bereiche.';

async function perGehirn(boardId: string, karten: AppNode[]): Promise<{ gruppen: ThemenGruppe[]; hinweis: string }> {
  const { brainBoardIds, kartenVektoren } = await import('./brain');
  // M451: Liegt das Board in einem vom Gehirn ausgeschlossenen Bereich, hat keine Karte einen Vektor — das ist kein
  // Mangel an Inhalt (früher stand hier „Zu wenig Inhalt"), sondern eine Einstellung, und die soll die Meldung nennen.
  if (!brainBoardIds().has(boardId)) throw new Error(GEHIRN_AUSGESCHLOSSEN);
  const vek = await kartenVektoren(boardId, karten.map((k) => k.id));
  const mit = karten.filter((k) => vek.has(k.id)).map((k) => ({ id: k.id, vec: vek.get(k.id)!.vec }));
  if (mit.length < 3) throw new Error('Zu wenig Inhalt zum Ordnen (mindestens 3 Karten mit Text).');
  const titelVon = (id: string) => vek.get(id)?.title || nodeToText(karten.find((k) => k.id === id)!).split('\n')[0] || '';
  const roh = gruppierenNachVektoren(mit)
    .sort((a, b) => b.length - a.length)
    .map((ids, i) => ({ titel: ids.length > 1 ? nameAusTiteln(ids.map(titelVon), i + 1) : REST_TITEL, ids }));
  return { gruppen: roh, hinweis: '' };
}

/** Themengruppen vorschlagen: Chat-KI, sonst (oder wenn sie scheitert) das Gehirn */
export async function themenVorschlagen(karten: AppNode[]): Promise<ThemenVorschlag> {
  const st = useBoard.getState();
  const boardId = st.activeId;
  const kiDa = aiReady(st.ai);
  const gehirnDa = st.brain.on;
  if (!kiDa && !gehirnDa) throw new Error('Dafür braucht es eine KI oder das Gehirn (Einstellungen → KI).');
  let quelle: ThemenVorschlag['quelle'] = kiDa ? 'ki' : 'gehirn';
  let erg: { gruppen: ThemenGruppe[]; hinweis: string };
  try {
    erg = kiDa ? await perKi(karten) : await perGehirn(boardId, karten);
  } catch (e) {
    if (!kiDa || !gehirnDa || kiAbgebrochen() || /Zu wenig Inhalt/.test((e as Error).message)) throw e;
    // M451: Ist der Bereich vom Gehirn ausgeschlossen, gibt es keinen Rückfall — dann zählt der Fehler der KI
    try { erg = await perGehirn(boardId, karten); } catch (g) {
      if ((g as Error).message === GEHIRN_AUSGESCHLOSSEN) throw new Error(`${(e as Error).message} (Der Rückfall über das Gehirn geht nicht: Dieser Bereich ist vom Gehirn ausgeschlossen.)`);
      throw g;
    }
    erg.hinweis = ` – die KI war nicht erreichbar (${(e as Error).message}), gruppiert hat das Gehirn`;
    quelle = 'gehirn';
  }
  const gruppen = gruppenBereinigen(erg.gruppen, karten);
  if (gruppen.length < 2 && gruppen.every((g) => g.titel === REST_TITEL)) throw new Error('Keine Themen erkannt.');
  return { boardId, gruppen, quelle, hinweis: erg.hinweis };
}

/* ---------- Ordnen ---------- */
const PAD = 30;       // Innenrand des Rahmens (wie frameOps)
const KOPF = 46;      // Platz unter der Titel-Leiste
const LUECKE = 24;    // zwischen den Karten
const ABSTAND = 64;   // zwischen den Rahmen
const JE_ZEILE = 3;   // Rahmen nebeneinander, dann neue Reihe

interface Plan { rahmen: Array<{ titel: string; x: number; y: number; w: number; h: number }>; lagen: Array<[string, number, number]>; w: number; h: number }

/** Ziel-Lage relativ zum Ursprung (0,0): Rahmen in Reihen, Karten je Rahmen als Raster in gelesener Reihenfolge */
export function themenPlan(gruppen: ThemenGruppe[], karten: AppNode[]): Plan {
  const byId = new Map(karten.map((k) => [k.id, k]));
  const bloecke = gruppen.map((g) => {
    // Lesereihenfolge der bisherigen Lage behalten: erst oben, dann links
    const ks = g.ids.map((id) => byId.get(id)!).filter(Boolean)
      .sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x));
    const spalten = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(ks.length))));
    const breiten = Array.from({ length: spalten }, (_, c) => Math.max(0, ...ks.filter((_, i) => i % spalten === c).map((k) => sizeOf(k).w)));
    const reihen = Math.ceil(ks.length / spalten);
    const hoehen = Array.from({ length: reihen }, (_, r) => Math.max(0, ...ks.slice(r * spalten, r * spalten + spalten).map((k) => sizeOf(k).h)));
    const innen: Array<[string, number, number]> = ks.map((k, i) => {
      const c = i % spalten, r = Math.floor(i / spalten);
      const x = PAD + breiten.slice(0, c).reduce((a, b) => a + b + LUECKE, 0);
      const y = KOPF + hoehen.slice(0, r).reduce((a, b) => a + b + LUECKE, 0);
      return [k.id, x, y];
    });
    const w = PAD * 2 + breiten.reduce((a, b) => a + b, 0) + LUECKE * (spalten - 1);
    const h = KOPF + PAD + hoehen.reduce((a, b) => a + b, 0) + LUECKE * (reihen - 1);
    return { titel: g.titel, w: Math.max(320, w), h: Math.max(200, h), innen };
  });
  const plan: Plan = { rahmen: [], lagen: [], w: 0, h: 0 };
  let y = 0;
  for (let r = 0; r < bloecke.length; r += JE_ZEILE) {
    const reihe = bloecke.slice(r, r + JE_ZEILE);
    let x = 0;
    for (const b of reihe) {
      plan.rahmen.push({ titel: b.titel, x, y, w: b.w, h: b.h });
      for (const [id, ix, iy] of b.innen) plan.lagen.push([id, x + ix, y + iy]);
      x += b.w + ABSTAND;
    }
    plan.w = Math.max(plan.w, x - ABSTAND);
    y += Math.max(...reihe.map((b) => b.h)) + ABSTAND;
  }
  plan.h = y - ABSTAND;
  return plan;
}

/** Den bestätigten Vorschlag umsetzen — EIN Schritt im Verlauf. Liefert die Kennungen der neuen Rahmen. */
export function themenAnwenden(gruppen: ThemenGruppe[]): string[] {
  const st = useBoard.getState();
  const board = selectActiveBoard(st);
  const ids = new Set(gruppen.flatMap((g) => g.ids));
  const karten = board.nodes.filter((n) => ids.has(n.id));
  const gueltig = gruppen.map((g) => ({ ...g, ids: g.ids.filter((id) => karten.some((k) => k.id === id)) })).filter((g) => g.ids.length);
  if (!gueltig.length) return [];
  const plan = themenPlan(gueltig, karten);
  // Wunschort: wo die Karten bisher lagen (oben links) – aber nie über unbeteiligte Karten oder Rahmen
  const wunsch = { x: Math.min(...karten.map((k) => k.position.x)), y: Math.min(...karten.map((k) => k.position.y)) };
  const hindernisse = board.nodes
    .filter((n) => !ids.has(n.id))
    // findFreeSpot übergeht Rahmen (hinein legen ist dort erwünscht) – hier sind sie Hindernisse
    .map((n) => (n.type === 'frame' ? ({ ...n, type: 'shape' } as unknown as AppNode) : n));
  const o = findFreeSpot(hindernisse, wunsch, { w: plan.w, h: plan.h });
  const neueRahmen: string[] = [];
  st.pushHistory();
  mutedHistory(() => {
    plan.rahmen.forEach((r, i) => {
      const id = uid();
      neueRahmen.push(id);
      st.addNode({
        id, type: 'frame', width: r.w, height: r.h, position: { x: o.x + r.x, y: o.y + r.y },
        dragHandle: '.frame-head',
        data: { name: r.titel, color: FRAME_COLORS[1 + (i % (FRAME_COLORS.length - 1))] },
      } as AppNode);
    });
    st.setNodePositions(plan.lagen.map(([id, x, y]) => [id, o.x + x, o.y + y]));
  });
  return neueRahmen;
}

/** Einstieg aus Auswahl-Leiste und Dock: Vorschlag holen, bestätigen lassen, ordnen */
export async function themenOrdnenStarten(auswahl?: AppNode[]): Promise<void> {
  const st = useBoard.getState();
  if (st.aiBusy) { st.showToast('Eine KI-Aktion läuft bereits – kurz warten.'); return; }
  const karten = themenKandidaten(selectActiveBoard(st).nodes, auswahl);
  if (karten.length < 3) {
    st.showToast(auswahl?.length ? 'Zum Ordnen nach Themen mindestens 3 Karten markieren.' : 'Zu wenig lose Karten zum Ordnen nach Themen.');
    return;
  }
  if (!aiReady(st.ai) && !st.brain.on) {
    st.showToast('Ordnen nach Themen braucht eine KI oder das Gehirn – beides in den Einstellungen unter KI.', false, 7000);
    st.setSettingsOpen(true);
    return;
  }
  st.setAiBusy(true);
  kiAbbruchZuruecksetzen();
  st.showToast(`Suche Themen in ${zahlWort(karten.length, 'Karte', 'Karten')} …`, false, 120000, aiReady(st.ai));
  let vorschlag: ThemenVorschlag;
  try {
    vorschlag = await themenVorschlagen(karten);
  } catch (e) {
    const m = (e as Error).message;
    useBoard.getState().showToast(kiAbgebrochen() || m === 'abgebrochen' ? 'Abgebrochen – am Board hat sich nichts geändert.' : `Ordnen nach Themen fehlgeschlagen: ${m}`, false, 8000);
    return;
  } finally {
    useBoard.getState().setAiBusy(false);
  }
  useBoard.getState().showToast(`${zahlWort(vorschlag.gruppen.length, 'Thema', 'Themen')} gefunden – bitte prüfen.`, false, 2500);
  const { themenDialog } = await import('../components/ThemenDialog');
  const bestaetigt = await themenDialog(vorschlag);
  const st2 = useBoard.getState();
  if (!bestaetigt) { st2.showToast('Nicht geordnet – am Board hat sich nichts geändert.', false, 3000); return; }
  if (st2.activeId !== vorschlag.boardId) {
    if (!st2.boards.some((b) => b.id === vorschlag.boardId)) return;
    st2.openBoard(vorschlag.boardId);
  }
  const rahmen = themenAnwenden(bestaetigt);
  const n = bestaetigt.reduce((a, g) => a + g.ids.length, 0);
  st2.showToast(`${zahlWort(n, 'Karte', 'Karten')} in ${zahlWort(rahmen.length, 'Rahmen', 'Rahmen')} geordnet: ${bestaetigt.map((g) => g.titel).join(' · ')}${vorschlag.hinweis}`, 'schritt', 9000);
}
