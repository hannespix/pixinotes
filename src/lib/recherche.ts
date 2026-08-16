/**
 * M274: Die Recherche mit echten Quellen — in drei Schritten.
 *
 *  1. PLANEN   — das Modell macht aus dem Auftrag Suchbegriffe, erkennt ein
 *                Wetter-Thema und stellt bis zu drei RÜCKFRAGEN (gewünschter
 *                Dialog: „gerne auch mit einem Rückfragen Dialog").
 *  2. HOLEN    — Wikipedia/Wikivoyage/Open-Meteo liefern echtes Material
 *                (webQuellen.ts). Ohne Schlüssel, direkt vom Gerät.
 *  3. ANTWORTEN— das Modell schreibt die Antwort NUR aus diesem Material
 *                plus dem Kartenkontext, mit Quellenliste. Wo die Quellen
 *                nichts hergeben, steht das ehrlich da — erfinden verboten.
 *
 * Das Ergebnis wird eine Notiz-Karte mit Quellenangaben am Ende.
 */
import { askAi, mdToBlocks } from './ai';
import { askJson } from './aiActions';
import { nodesToText } from './serialize';
import { makeNote } from './nodes';
import { findFreeSpot } from './arrange';
import { mutedHistory, selectActiveBoard, useBoard } from '../store';
import { sammleQuellen, type Quelle } from './webQuellen';
import type { AppNode } from '../types';

export interface RecherchePlan {
  fragen: string[];
  suchbegriffe: string[];
  reise: boolean;
  wetterOrt: string | null;
}

/** Schritt 1: Suchplan + Rückfragen aus dem Auftrag */
export async function planeRecherche(auftrag: string, kontext: string): Promise<RecherchePlan> {
  const heute = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const p = await askJson<Partial<RecherchePlan>>(
    `Heute ist ${heute}. Du planst eine Recherche mit deutschsprachigen Nachschlagewerken (Wikipedia, Wikivoyage) und einer Wettervorhersage.

Auftrag: "${auftrag}"
${kontext ? `Kontext von den ausgewählten Karten:\n${kontext.slice(0, 2000)}\n` : ''}
Antworte NUR mit JSON:
{"suchbegriffe": ["2-4 Lexikon-taugliche Suchbegriffe (Orte, Dinge, Themen — KEINE ganzen Sätze)"],
 "reise": true/false (geht es um Ausflüge, Reisen, Orte?),
 "wetterOrt": "Ortsname" oder null (nur wenn Wetter für die Antwort wichtig ist),
 "fragen": ["höchstens 3 kurze Rückfragen, deren Antwort die Recherche WIRKLICH besser machen würde — [] wenn der Auftrag klar ist"]}`,
  );
  return {
    fragen: (p.fragen ?? []).filter((f) => typeof f === 'string' && f.trim()).slice(0, 3),
    suchbegriffe: (p.suchbegriffe ?? []).filter((b) => typeof b === 'string' && b.trim()).slice(0, 4),
    reise: p.reise === true,
    wetterOrt: typeof p.wetterOrt === 'string' && p.wetterOrt.trim() ? p.wetterOrt.trim() : null,
  };
}

const ART_LABEL: Record<Quelle['art'], string> = {
  wikipedia: 'Wikipedia', wikivoyage: 'Wikivoyage', wetter: 'Open-Meteo',
};

export interface RechercheErgebnis {
  quellen: number;
  titel: string;
}

/**
 * Schritt 2 + 3: Quellen holen, Antwort schreiben, Notiz anlegen.
 *
 * @param antworten Antworten auf die Rückfragen (gleiche Reihenfolge, leere
 *   Einträge = übersprungen) — sie schärfen den Auftrag, nicht die Suche.
 * @param melde Fortschritts-Zeile für den Dialog („Hole Wetter…")
 */
export async function fuehreRechercheAus(
  auftrag: string,
  plan: RecherchePlan,
  antworten: string[],
  melde: (schritt: string) => void,
): Promise<RechercheErgebnis> {
  const st = useBoard.getState();
  const board = selectActiveBoard(st);
  const ausgewaehlt = board.nodes.filter((n) => n.selected && n.type !== 'frame');
  const kontext = ausgewaehlt.length ? nodesToText(ausgewaehlt).slice(0, 3000) : '';

  melde(`Hole Quellen (${plan.suchbegriffe.join(', ')})…`);
  const quellen = await sammleQuellen({
    suchbegriffe: plan.suchbegriffe,
    reise: plan.reise,
    wetterOrt: plan.wetterOrt,
  });

  melde(quellen.length
    ? `${quellen.length} Quelle(n) gefunden — schreibe die Antwort…`
    : 'Keine Quellen erreichbar — schreibe eine ehrliche Antwort…');

  const dialog = plan.fragen
    .map((f, i) => (antworten[i]?.trim() ? `Rückfrage: ${f}\nAntwort: ${antworten[i].trim()}` : ''))
    .filter(Boolean)
    .join('\n');
  const material = quellen
    .map((q, i) => `[${i + 1}] ${ART_LABEL[q.art]} — ${q.titel}\n${q.text}`)
    .join('\n\n---\n\n');
  const heute = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

  const md = await askAi(
    `Heute ist ${heute}. Beantworte den Recherche-Auftrag AUSSCHLIESSLICH mit dem folgenden Quellenmaterial${kontext ? ' und dem Kartenkontext' : ''}. Regeln:
- NICHTS erfinden. Was die Quellen nicht hergeben, benennst du offen als Lücke (z. B. Öffnungszeiten, Preise).
- Verweise im Text mit [1], [2] … auf die Quellen.
- Konkret und knapp; Markdown mit "## "-Zwischenüberschriften und "- "-Listen.
- Sprich Deutsch.

Auftrag: "${auftrag}"
${dialog ? `\nPräzisierungen aus dem Rückfragen-Dialog:\n${dialog}\n` : ''}${kontext ? `\nKartenkontext:\n${kontext}\n` : ''}
Quellenmaterial:
${material || '(keine Quelle erreichbar — sage das ehrlich und gib an, was der Nutzer selbst prüfen sollte)'}`,
  );

  // Quellenliste ans Ende — klickbare Links, damit jede Angabe prüfbar ist
  const fussnoten = quellen.length
    ? `\n\n## Quellen\n${quellen.map((q, i) => `- [${i + 1}] ${ART_LABEL[q.art]}: [${q.titel}](${q.url})`).join('\n')}`
    : '';
  const titel = `🔎 ${auftrag.slice(0, 60)}`;
  const blocks = await mdToBlocks(titel, `${md.trim()}${fussnoten}`);

  melde('Lege die Notiz an…');
  const mitte = board.nodes.length
    ? {
      x: board.nodes.reduce((s, n) => s + n.position.x, 0) / board.nodes.length + 380,
      y: board.nodes.reduce((s, n) => s + n.position.y, 0) / board.nodes.length,
    }
    : { x: 120, y: 120 };
  st.pushHistory();
  mutedHistory(() => {
    const note: AppNode = {
      ...makeNote(findFreeSpot(board.nodes, mitte, { w: 460, h: 400 }), { color: 'sky', blocks }),
      width: 460,
    } as AppNode;
    st.addNode(note);
  });
  return { quellen: quellen.length, titel };
}
