// M522: Gestalt-Prüfung für alles, was von außen kommt — der große Teil von lib/sicher.ts, der nicht in den Start
// gehört (Start-JS-Grenze): Regeln je Kartenart, Striche, Gespräche, ganze Boards, Bereiche, ganze Stände, und das
// Richten eines beschädigten Stands im Speicher. Wer diese Datei lädt, hängt die Prüfung in lib/sicher.ts ein
// (`gestalt`), sodass karteEntschaerfen und boardVonAussen sie überall mit anwenden.
import type { AppNode } from '../types';
import { useBoard, type BoardDoc, type Space } from '../store';
import { leererStart } from '../store/start';
import { boardVonAussen, gestalt } from './sicher';

const endlich = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/* ---------- M522: Gestalt des Karten-INHALTS ----------
   karteGueltig prüft die Hülle (Kennung, Art, Lage, `data` ist ein Objekt). Was IN `data` steht, hängt an der Art —
   und einige Felder liest nicht nur die Karte selbst, sondern die ganze App (Aufgaben über alle Boards, Suche,
   Termine, Übersicht): Ein Kanban ohne `items`, ein Zeitplan ohne `rows`, eine Notiz mit `blocks: "x"` ließ darum
   nicht die eine Karte ausfallen, sondern PixiNotes als Ganzes — und weil der Stand gespeichert wird, bei jedem
   Start wieder („PixiNotes lässt sich gerade nicht anzeigen", ohne Ausweg). Über einen geteilten Link, eine
   Einladung zum Mitarbeiten oder eine Datei genügte dafür eine einzige Karte.
   Regel je Feld: `liste` = muss eine Liste sein (sonst leer), `listeOpt` = darf fehlen (sonst weg), `text` = muss Text
   sein (sonst leer), `textOpt`, `zahl` (sonst 0), `objektOpt`. Einträge von Listen werden gerichtet, nicht verworfen:
   Was kein Objekt ist, fällt weg; fehlt einem Ticket die Spalte oder einer Zeile der Name, wird das Feld ergänzt.
   Unverändertes bleibt dasselbe Objekt — für heile Karten kostet das einen Blick je Feld. */
type Satz = Record<string, unknown>;
type FeldArt = 'liste' | 'listeOpt' | 'text' | 'textOpt' | 'zahl' | 'objektOpt' | 'texteOpt';
/** Einen Listen-Eintrag richten: derselbe Eintrag, eine gerichtete Kopie oder `undefined` (fällt weg) */
type Richten = (x: unknown, i: number) => unknown;
const istSatz = (v: unknown): v is Satz => !!v && typeof v === 'object' && !Array.isArray(v);
const textFeld = (v: unknown): v is string => typeof v === 'string';
/** Ein Objekt, dessen genannte Felder Text bzw. Zahl sind — Fehlendes wird ergänzt (leer, 0, Kennung nach Stelle),
 *  nie der ganze Eintrag verworfen: Ein Ticket ohne Spalte ist immer noch ein Ticket. */
const satzMit = (texte: string[], zahlen: string[] = []): Richten => (x, i) => {
  if (!istSatz(x)) return undefined;
  let aus = x;
  const setze = (f: string, v: unknown) => { if (aus === x) aus = { ...x }; aus[f] = v; };
  for (const f of texte) if (!textFeld(x[f])) setze(f, f === 'id' ? (endlich(x[f]) ? String(x[f]) : `e${i}`) : endlich(x[f]) ? String(x[f]) : '');
  for (const f of zahlen) if (!endlich(x[f])) setze(f, 0);
  return aus;
};
const nurText: Richten = (x) => (textFeld(x) ? x : undefined);
/** M528: ein Schritt im Umbau-Protokoll der Rechen-Tabelle (lib/tabellenUmbau.ts) */
const umbauSchritt: Richten = (x) => (istSatz(x) && textFeld(x.id) && (x.a === 'z' || x.a === 's')
  && Number.isInteger(x.bei) && (x.bei as number) >= 0 && Number.isInteger(x.n) && x.n !== 0 ? x : undefined);
/** Eine Liste richten; dieselbe Liste, wenn nichts zu tun war */
function listeRichten(v: unknown[], richten: Richten | undefined): unknown[] {
  if (!richten) return v;
  let anders = false;
  const aus: unknown[] = [];
  v.forEach((x, i) => { const r = richten(x, i); if (r !== x) anders = true; if (r !== undefined) aus.push(r); });
  return anders ? aus : v;
}
/** In einem Eintrag die Listen richten, die er selbst trägt (fehlen dürfen sie; keine Liste → weg) */
const mitListen = (grund: Richten, listen: Record<string, Richten>): Richten => (x, i) => {
  const g = grund(x, i);
  if (!istSatz(g)) return g;
  let aus = g;
  for (const [k, richten] of Object.entries(listen)) {
    const v = g[k];
    if (v === undefined) continue;
    const neu = Array.isArray(v) ? listeRichten(v, richten) : undefined;
    if (neu === v) continue;
    if (aus === g) aus = { ...g };
    if (neu === undefined) delete aus[k]; else aus[k] = neu;
  }
  return aus;
};
const ticket = mitListen(satzMit(['id', 'text'], ['col']), { subs: satzMit(['id', 'text']), deps: nurText, links: satzMit(['boardId', 'nodeId']) });
/**
 * M519: Ein Block einer Notiz (auch in Formen und Protokoll-Sitzungen) — bis in die Unterblöcke. `nurSatz` prüfte
 * nur die oberste Ebene: `children: "x"` oder ein Inline-Inhalt, der weder Text noch Liste noch Tabelle ist, ließ
 * weiter die ganze App ausfallen (Klartext, Aufgaben und Suche laufen durch alle Ebenen). Unterblöcke müssen eine
 * Liste sein (sonst weg), Inline-Stücke Objekte, ein Link braucht seine Stück-Liste.
 */
const stueck: Richten = (t) => (istSatz(t) && (t.type !== 'link' || Array.isArray(t.content)) ? t : undefined);
const block: Richten = (x) => {
  if (!istSatz(x)) return undefined;
  let aus = x;
  const setze = (k: string, v: unknown) => { if (aus === x) aus = { ...x }; if (v === undefined) delete aus[k]; else aus[k] = v; };
  if (x.children !== undefined) {
    const k = Array.isArray(x.children) ? listeRichten(x.children, block) : undefined;
    if (k !== x.children) setze('children', k);
  }
  const c = x.content;
  if (Array.isArray(c)) { const s = listeRichten(c, stueck); if (s !== c) setze('content', s); }
  else if (c !== undefined && !textFeld(c) && !(istSatz(c) && Array.isArray(c.rows))) setze('content', '');
  if (x.type !== undefined && !textFeld(x.type)) setze('type', 'paragraph');
  if (x.props !== undefined && !istSatz(x.props)) setze('props', undefined);
  return aus;
};
/**
 * `bereich`: Zahlen, die Schleifen treiben (Spalten, Zeilen, Pixel je Tag, Stunden) — fehlen dürfen sie; was keine
 * Zahl ist oder außerhalb liegt, fällt weg (dann gilt die Vorgabe der Karte). Ein `dayWidth: [[]]` oder
 * `cols: 10000000` ließ sonst nicht die Karte ausfallen, sondern die Seite hängen.
 */
const GESTALT: Record<string, { felder: Record<string, FeldArt>; eintraege?: Record<string, Richten>; bereich?: Record<string, [number, number]> }> = {
  note: { felder: { blocks: 'listeOpt', hex: 'textOpt' }, eintraege: { blocks: block } },
  email: { felder: { subject: 'text', fromName: 'text', fromAddress: 'textOpt', date: 'textOpt', text: 'text', attachments: 'liste' }, eintraege: { attachments: satzMit(['name'], ['size']) } },
  image: { felder: { src: 'text', name: 'textOpt', titel: 'textOpt' } },
  file: { felder: { name: 'text', size: 'zahl', mime: 'textOpt', titel: 'textOpt' } },
  kanban: {
    felder: { title: 'text', items: 'liste', cols: 'listeOpt', archiv: 'listeOpt', collectFrom: 'listeOpt', collectExcludeNodes: 'listeOpt', ignoreKeys: 'listeOpt', wip: 'listeOpt' },
    eintraege: { items: ticket, archiv: ticket, cols: nurText, collectFrom: nurText, collectExcludeNodes: nurText, ignoreKeys: nurText },
  },
  portal: { felder: { boardId: 'textOpt' } },
  shape: { felder: { text: 'text', shape: 'textOpt', color: 'textOpt', blocks: 'listeOpt' }, eintraege: { blocks: block } },
  mermaid: { felder: { code: 'text' } },
  gantt: { felder: { title: 'text', rows: 'liste' }, eintraege: { rows: satzMit(['id', 'name', 'start', 'end']) }, bereich: { dayWidth: [0.01, 1000] } },
  calendar: { felder: { month: 'textOpt' } },
  frame: { felder: { name: 'text', color: 'textOpt' } },
  week: { felder: { title: 'text', entries: 'liste', cols: 'listeOpt', slots: 'listeOpt' }, eintraege: { entries: satzMit(['id', 'text'], ['day', 'start', 'dur']), cols: nurText, slots: nurText }, bereich: { from: [0, 1440], to: [0, 2880] } },
  sheet: { felder: { title: 'textOpt', cells: 'texteOpt', colW: 'objektOpt', links: 'texteOpt', stile: 'objektOpt', filter: 'objektOpt', stilListe: 'listeOpt', verbunden: 'listeOpt', umbau: 'listeOpt' }, eintraege: { verbunden: nurText, umbau: umbauSchritt }, bereich: { cols: [1, 702], rows: [1, 1048576], kopf: [0, 1048576], bis: [0, 1048576] } },   // Zeilen: so viele fasst Excel
  minutes: {
    felder: { title: 'text', entries: 'liste', agenda: 'listeOpt', personenAbgelehnt: 'listeOpt' },
    eintraege: { entries: mitListen(satzMit(['id', 'date']), { blocks: block, decisions: satzMit(['id', 'text']), infoTops: nurText }), agenda: nurText, personenAbgelehnt: nurText },
  },
  time: { felder: { title: 'text', segs: 'liste' }, eintraege: { segs: satzMit(['id', 'date'], ['start']) } },
  htmlapp: { felder: { name: 'text', size: 'zahl' } },
  bubbles: { felder: { title: 'textOpt', frage: 'textOpt', ideen: 'objektOpt', stimmen: 'objektOpt', gruppen: 'objektOpt', abstimmung: 'objektOpt', regeln: 'objektOpt', ki: 'objektOpt' } },   // M543: ki = „KI gruppiert gerade"
  kontakt: { felder: { name: 'text', telefone: 'liste', emails: 'liste', funktion: 'textOpt', firma: 'textOpt', adresse: 'textOpt', web: 'textOpt', notiz: 'textOpt' }, eintraege: { telefone: satzMit(['nummer']), emails: nurText } },
  fluessig: { felder: { text: 'text' } },
  pixi: { felder: { name: 'textOpt' } },
};
/**
 * M522: Inhalt einer Karte in die Gestalt ihrer Art bringen (siehe oben). Unbekannte Arten und Felder bleiben, wie sie
 * sind. Gibt dieselbe Karte zurück, wenn nichts zu tun war.
 */
/** M529: Speicherstand eines eigenen Tools von außen (Konto) — eine flache Liste aus Texten, höchstens 5 MB.
 *  (Hier statt in lib/sicher.ts: Nur der nachgeladene Konto-Abgleich braucht es, nicht der Start.) */
export function toolSpeicherVonAussen(roh: unknown): Record<string, string> | null {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null;
  let summe = 0;
  for (const [k, v] of Object.entries(roh as Record<string, unknown>)) {
    if (typeof v !== 'string') return null;
    summe += k.length + v.length;
    if (summe > 5_000_000) return null;
  }
  return roh as Record<string, string>;
}

export function karteGestalt<T extends AppNode>(n: T): T {
  const regel = GESTALT[n.type as string];
  if (!regel) return n;
  const d = n.data as Satz;
  let aus = d;
  const setze = (k: string, v: unknown) => { if (aus === d) aus = { ...d }; if (v === undefined) delete aus[k]; else aus[k] = v; };
  for (const [k, art] of Object.entries(regel.felder)) {
    const v = d[k];
    if (art === 'liste' || art === 'listeOpt') {
      if (!Array.isArray(v)) { if (v !== undefined || art === 'liste') setze(k, art === 'liste' ? [] : undefined); continue; }
      const liste = listeRichten(v, regel.eintraege?.[k]);
      if (liste !== v) setze(k, liste);
    } else if (art === 'text' || art === 'textOpt') {
      if (!textFeld(v) && (v !== undefined || art === 'text')) setze(k, endlich(v) ? String(v) : art === 'text' ? '' : undefined);
    } else if (art === 'zahl') {
      if (!endlich(v)) setze(k, 0);
    } else if (v !== undefined && !istSatz(v)) setze(k, undefined);
    else if (art === 'texteOpt' && istSatz(v) && !Object.values(v).every(textFeld)) {
      // Zellen einer Tabelle: Text je Zelle (eine Zahl wird ihr Text, alles andere fällt weg)
      setze(k, Object.fromEntries(Object.entries(v).flatMap(([z, w]) => (textFeld(w) ? [[z, w]] : endlich(w) ? [[z, String(w)]] : []))));
    }
  }
  for (const [k, [von, bis]] of Object.entries(regel.bereich ?? {})) {
    const v = d[k];
    if (v !== undefined && !(endlich(v) && v >= von && v <= bis)) setze(k, undefined);
  }
  return aus === d ? n : ({ ...n, data: aus } as T);
}

type Strich = NonNullable<BoardDoc['drawings']>[number];
type Gespraech = NonNullable<BoardDoc['comments']>[number];
/** M522: Strich von außen — nur Punkte aus endlichen Zahlen (x, y, optional Druck); derselbe Strich, wenn alles stimmt */
export function strichVonAussen(s: Strich): Strich {
  if (!Array.isArray(s.points)) return { ...s, points: [] };
  const gut = (p: unknown): boolean => Array.isArray(p) && p.length >= 2 && p.every(endlich);
  const punkte = s.points as unknown[];
  return punkte.every(gut) ? s : { ...s, points: punkte.filter(gut) as Strich['points'] };
}
/** M522: Gespräch von außen — Beiträge mit Verfasser, Text und Zeitpunkt als Text; dasselbe Gespräch, wenn alles stimmt */
export function gespraechVonAussen(c: Gespraech): Gespraech {
  const gut = (m: unknown): boolean => istSatz(m) && textFeld(m.author) && textFeld(m.text) && textFeld(m.at);
  return (c.msgs as unknown[]).every(gut) ? c : { ...c, msgs: (c.msgs as unknown[]).filter(gut) as Gespraech['msgs'] };
}

/**
 * M522: Ein ganzes Board prüfen und — wenn alles stimmt — GENAU dieses Objekt zurückgeben (Reihenfolge der Felder
 * und alle Referenzen bleiben; der Drei-Wege-Abgleich vergleicht Fassungen als Text). Sonst die gesäuberte Fassung
 * (boardVonAussen), null, wenn es kein Board ist.
 */
export function boardGeprueft(roh: unknown): BoardDoc | null {
  const b = roh as BoardDoc | null;
  if (!istSatz(b) || !textFeld(b.id) || !b.id || b.id.length > 200) return null;
  const neu = boardVonAussen(b, b.id);
  if (!neu) return null;
  const gleich = <T,>(x: T[] | undefined, y: T[] | undefined): boolean => x === y || (!!x && !!y && x.length === y.length && x.every((e, i) => e === y[i]));
  const heil = neu.name === b.name && gleich(neu.nodes, b.nodes) && gleich(neu.edges, b.edges) && gleich(neu.drawings, b.drawings)
    && gleich(neu.comments, b.comments) && JSON.stringify(neu.look) === JSON.stringify(b.look);
  return heil ? b : neu;
}

/** M522: Bereiche und Projekte von außen — Kennung und Name als Text, Board-Listen aus Kennungen; Heiles bleibt dasselbe Objekt */
export function bereicheVonAussen(roh: unknown): Space[] {
  if (!Array.isArray(roh)) return [];
  const kenn = (v: unknown): v is string => textFeld(v) && v.length > 0 && v.length <= 200;
  const projekt = (p: unknown): Space['projects'][number] | null => {
    if (!istSatz(p) || !kenn(p.id)) return null;
    const heil = textFeld(p.name) && Array.isArray(p.boardIds) && p.boardIds.every(kenn) && (p.sortierung === undefined || textFeld(p.sortierung));
    if (heil) return p as unknown as Space['projects'][number];
    const { sortierung: _s, ...rest } = p;
    return { ...rest, name: textFeld(p.name) ? p.name : 'Projekt', boardIds: Array.isArray(p.boardIds) ? p.boardIds.filter(kenn) : [], ...(textFeld(p.sortierung) ? { sortierung: p.sortierung } : {}) } as unknown as Space['projects'][number];
  };
  const aus: Space[] = [];
  for (const sp of roh) {
    if (!istSatz(sp) || !kenn(sp.id)) continue;
    const roheProjekte = Array.isArray(sp.projects) ? sp.projects : [];
    const projekte = roheProjekte.map(projekt).filter((p): p is Space['projects'][number] => !!p);
    const heil = textFeld(sp.name) && Array.isArray(sp.projects) && projekte.length === roheProjekte.length && projekte.every((p, i) => p === roheProjekte[i]);
    aus.push(heil ? (sp as unknown as Space) : ({ ...sp, name: textFeld(sp.name) ? sp.name : 'Bereich', projects: projekte } as unknown as Space));
  }
  return aus.length === roh.length && aus.every((sp, i) => sp === roh[i]) ? (roh as Space[]) : aus;
}

/**
 * M522: Ein ganzer Stand aus einer Datei, die nicht diese App in diesem Augenblick geschrieben hat — Sync-Ordner,
 * WebDAV, „Stand laden", Konfliktkopie, Team-Paket. Bisher lief daraus nur die Zeit durch die Prüfung (M470): Ein
 * Board ohne Kartenliste oder eine Karte ohne Lage ließ den Abgleich abbrechen oder — über „Stand übernehmen" — die
 * App nach jedem Start abstürzen. Boards ohne Kennung oder Kartenliste fallen weg (doppelte Kennungen: das erste
 * zählt), Karten laufen durch kartenVonAussen. Heiles bleibt dasselbe Objekt. null, wenn kein Board übrig bleibt.
 * Wurde etwas herausgenommen, trägt das Ergebnis eine Grabstein-Liste (siehe unten).
 */
export function standVonAussen<T extends { boards: BoardDoc[]; spaces: Space[]; geloescht?: Record<string, string> }>(p: T): T | null {
  if (!istSatz(p) || !Array.isArray(p.boards)) return null;
  const gesehen = new Set<string>();
  const boards: BoardDoc[] = [];
  for (const roh of p.boards) {
    const b = boardGeprueft(roh);
    if (!b || gesehen.has(b.id)) continue;
    gesehen.add(b.id);
    boards.push(b);
  }
  if (!boards.length) return null;
  const spaces = bereicheVonAussen(p.spaces);
  const heil = spaces === p.spaces && boards.length === p.boards.length && boards.every((b, i) => b === p.boards[i]);
  if (heil) return p;
  // Was die Prüfung herausnahm, ist nicht „drüben gelöscht": Mit einer (notfalls leeren) Grabstein-Liste gilt
  // Fehlendes in der Zusammenführung als „nie gesehen" und bleibt hier bestehen (M351, syncMerge → kennt)
  return { ...p, boards, spaces, geloescht: p.geloescht && typeof p.geloescht === 'object' ? p.geloescht : {} };
}


/**
 * M522: Ein Projekt-Paket aus dem Team-Ordner (lib/projectSync.ts) haben ANDERE geschrieben — seine Boards laufen
 * durch die Prüfung wie jedes Board von außen (Karten ohne Lage oder mit kaputtem Inhalt ließen sonst nach „Projekt
 * beitreten" die App bei jedem Start ausfallen). Kennung und Name des Projekts sind Text. null, wenn kein gültiges
 * Board darin ist. `istPaket`: die Grundprüfung der Datei (bleibt bei projectSync).
 */
export function paketVonAussen<T extends { savedAt: string; project: { id: string; name: string }; boards: BoardDoc[] }>(p: unknown, istPaket: (x: unknown) => x is T): T | null {
  if (!istPaket(p) || typeof p.project.id !== 'string' || typeof p.project.name !== 'string' || p.project.id.length > 200) return null;
  const gesehen = new Set<string>();
  const boards: BoardDoc[] = [];
  for (const roh of p.boards) {
    const b = boardGeprueft(roh);
    if (!b || gesehen.has(b.id)) continue;
    gesehen.add(b.id);
    boards.push(b);
  }
  if (!boards.length) return null;
  return { ...p, savedAt: typeof p.savedAt === 'string' ? p.savedAt : '', project: { id: p.project.id, name: p.project.name.slice(0, 200) }, boards };
}

// Einhängen: ab jetzt prüfen karteEntschaerfen und boardVonAussen (lib/sicher.ts) die Gestalt mit
gestalt.karte = karteGestalt;
gestalt.strich = strichVonAussen as typeof gestalt.strich;
gestalt.gespraech = gespraechVonAussen as typeof gestalt.gespraech;

/**
 * M522: Den Stand im Speicher richten — der Ausweg, wenn die App an ihrem eigenen gespeicherten Stand scheitert
 * (components/ErrorBoundary.tsx ruft das beim ersten abgefangenen Fehler). Ein Board ohne Kartenliste, eine Karte
 * ohne Lage oder mit kaputtem Inhalt ließ PixiNotes sonst bei jedem Start ausfallen („lässt sich gerade nicht
 * anzeigen"), ohne Ausweg — der Stand liegt ja im Browser und kommt mit jedem Neuladen wieder. Gerichtet wird nur,
 * woran die App scheitert; nichts Lesbares fällt weg (eine Karte ohne Lage bekommt eine, statt zu verschwinden).
 * true = es wurde etwas gerichtet (dann lohnt ein neuer Versuch).
 */
export function standRichten(): boolean {
  const st = useBoard.getState();
  const satz = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const kenn = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const gleich = (x: unknown[], y: unknown[]): boolean => x.length === y.length && x.every((e, i) => e === y[i]);
  let anders = false;
  const boards: BoardDoc[] = [];
  for (const b of (Array.isArray(st.boards) ? st.boards : []) as unknown[]) {
    if (!satz(b) || !kenn(b.id)) { anders = true; continue; }
    const nodes = (Array.isArray(b.nodes) ? b.nodes : []).flatMap((n: unknown) => {
      if (!satz(n) || !kenn(n.id) || !kenn(n.type)) return [];
      const lage = n.position as { x?: unknown; y?: unknown } | undefined;
      const lageGut = satz(lage) && endlich(lage.x) && endlich(lage.y);
      const karte = lageGut && satz(n.data) ? n : { ...n, position: lageGut ? lage : { x: 0, y: 0 }, data: satz(n.data) ? n.data : {} };
      return [karteGestalt(karte as unknown as AppNode)];
    });
    const edges = (Array.isArray(b.edges) ? b.edges : []).filter((e: unknown) => satz(e) && kenn(e.id) && kenn(e.source) && kenn(e.target));
    const striche = Array.isArray(b.drawings) ? b.drawings.filter((s: unknown) => satz(s) && kenn(s.id) && Array.isArray(s.points)).map(strichVonAussen) : undefined;
    const reden = Array.isArray(b.comments) ? b.comments.filter((c: unknown) => satz(c) && kenn(c.id) && kenn(c.nodeId) && Array.isArray(c.msgs)).map(gespraechVonAussen) : undefined;
    const heil = typeof b.name === 'string' && Array.isArray(b.nodes) && gleich(nodes, b.nodes) && Array.isArray(b.edges) && gleich(edges, b.edges)
      && (b.drawings === undefined || (Array.isArray(b.drawings) && gleich(striche ?? [], b.drawings)))
      && (b.comments === undefined || (Array.isArray(b.comments) && gleich(reden ?? [], b.comments)));
    if (heil) { boards.push(b as unknown as BoardDoc); continue; }
    anders = true;
    const neu = { ...b, name: typeof b.name === 'string' ? b.name : 'Board', nodes, edges } as Record<string, unknown>;
    if (b.drawings !== undefined) neu.drawings = striche ?? [];
    if (b.comments !== undefined) neu.comments = reden ?? [];
    boards.push(neu as unknown as BoardDoc);
  }
  if (!boards.length) {
    // Kein einziges Board: der leere Start (ein Board, ein Bereich)
    useBoard.setState({ ...leererStart(), view: 'board', past: [], future: [] });
    return true;
  }
  const spaces = Array.isArray(st.spaces) ? bereicheVonAussen(st.spaces) : [];
  const activeId = boards.some((b) => b.id === st.activeId) ? st.activeId : boards[0].id;
  if (!anders && spaces === st.spaces && activeId === st.activeId) return false;
  // Schritte von vor dem Richten zeigen auf den beschädigten Stand — sie verfallen
  useBoard.setState({ boards, spaces, activeId, past: [], future: [] });
  return true;
}
