/**
 * M488: Aus dem Eingang in eine Notiz einfügen.
 *
 * M478 kannte für einen Eingangs-Eintrag nur „aufs Board": Wer einen geteilten Link oder ein Foto in eine Sammel-
 * notiz („Leseliste", „Urlaubsideen") haben wollte, musste die Karte erst aufs Board holen, den Inhalt kopieren und
 * die Karte wieder löschen. Jetzt geht beides direkt: Eintrag auf eine Notiz ziehen (bei offener Notiz an die Stelle,
 * an der man loslässt, sonst ans Ende) oder in der Liste über „⋯ → In Notiz einfügen …".
 *
 * Was hineinpasst, folgt der Regel aus M289: Text (Notiz-Karten, mit ihren Verweisen) und eingebettete Bilder. Alles
 * andere (E-Mail, PDF, Datei in der Geräte-Ablage) wird eine Karte NEBEN der Notiz — es geht nichts verloren. Ein
 * Eintrag ohne Einfügbares bleibt beim Ziehen eine Karte an der Ablagestelle (wie bisher), im Menü fehlt der Punkt.
 *
 * Ein Undo-Schritt: Notiz-Board und Eingang werden gemeinsam gesichert (`pushHistoryBoards`), Strg+Z holt Notiz-
 * Inhalt und Eintrag zusammen zurück. Nachgeladen (Board.tsx beim Ablegen, die Eingangs-Liste beim Öffnen).
 */
import { NOTIZ_EXTERN, useBoard, type BoardDoc } from '../store';
import { uid, type AppNode } from '../types';
import { eingangBoard, eintraege, istEingang, ohneMarke, type Eintrag } from './eingang';
import { liveVerbunden } from './liveStand';
import { noteTitle } from './notiz';
import { rasterBildVonAussen, webAdresseVonAussen } from './sicher';
import { zahlWort } from './sprache';

type Block = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: unknown[] };

/** Verweise in Inline-Inhalten noch einmal prüfen (sie kamen von außen): nur http(s), sonst bleibt der Text */
function inlineSicher(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.flatMap((c) => {
    const o = c as { type?: string; href?: unknown; content?: unknown };
    if (o?.type !== 'link') return [c];
    const href = webAdresseVonAussen(o.href);
    return href ? [{ ...o, href }] : (Array.isArray(o.content) ? o.content : []);
  });
}

/** Tiefe Kopie mit frischen Kennungen — die Blöcke liegen danach in einer anderen Notiz (keine doppelten ids) */
function frischeBloecke(blocks: unknown[]): Block[] {
  return (blocks as Block[]).filter((b) => b && typeof b === 'object').map((b) => {
    const neu: Block = { ...b, id: uid() };
    if (b.type === 'image') {
      const url = rasterBildVonAussen(b.props?.url);
      return url ? { ...neu, props: { ...b.props, url } } : { id: neu.id, type: 'paragraph', props: {}, content: [], children: [] };
    }
    if (b.content !== undefined) neu.content = inlineSicher(b.content);
    neu.children = Array.isArray(b.children) ? frischeBloecke(b.children) : [];
    return neu;
  });
}

/** Die Blöcke, die eine Karte in einer Notiz ergibt — `null`, wenn sie nicht hineinpasst (dann Karte daneben) */
export function bloeckeAus(n: AppNode): Block[] | null {
  const d = n.data as { blocks?: unknown; src?: unknown; dataUrl?: unknown; name?: unknown };
  const name = typeof d.name === 'string' ? d.name : '';
  if (n.type === 'note') return Array.isArray(d.blocks) ? frischeBloecke(d.blocks) : [];
  const bild = n.type === 'image' ? rasterBildVonAussen(d.src) : n.type === 'file' ? rasterBildVonAussen(d.dataUrl) : null;
  return bild ? [{ id: uid(), type: 'image', props: { url: bild, name, caption: '' }, children: [] }] : null;
}

/** Passt von diesem Eintrag etwas in eine Notiz? (Sonst gibt es den Menüpunkt nicht) */
export const einfuegbar = (e: Eintrag): boolean => e.nodes.some((n) => bloeckeAus(n) !== null);

const leer = (blocks: Block[]): boolean => blocks.length === 0
  || (blocks.length === 1 && blocks[0].type === 'paragraph' && (!blocks[0].content || (Array.isArray(blocks[0].content) && blocks[0].content.length === 0))
    && !(blocks[0].children?.length));

export interface NotizWahl { id: string; boardId: string; boardName: string; titel: string; wann: number }

/** Alle Notizen zur Wahl — zuletzt bearbeitete oben; Eingang und archivierte Boards nicht */
export function notizenZurWahl(boards: BoardDoc[], aktiv: string): NotizWahl[] {
  const aus: NotizWahl[] = [];
  for (const b of boards) {
    if (istEingang(b) || (b.archived && b.id !== aktiv)) continue;
    for (const n of b.nodes) {
      if (n.type !== 'note') continue;
      const z = n as { geaendert?: number; angelegt?: number };
      aus.push({ id: n.id, boardId: b.id, boardName: b.name, titel: noteTitle(n.data.blocks as unknown[] | undefined, 'Leere Notiz'), wann: z.geaendert ?? z.angelegt ?? 0 });
    }
  }
  return aus.sort((a, b) => (b.wann - a.wann) || (Number(b.boardId === aktiv) - Number(a.boardId === aktiv)));
}

/** Suche über Titel und Board: jedes Wort muss vorkommen, Groß/Klein und Akzente egal (ä = a) */
export function notizSuche(liste: NotizWahl[], q: string): NotizWahl[] {
  const norm = (s: string) => s.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  const woerter = norm(q).split(/\s+/).filter(Boolean);
  if (!woerter.length) return liste;
  return liste.filter((n) => { const t = norm(`${n.titel} ${n.boardName}`); return woerter.every((w) => t.includes(w)); });
}

/**
 * Wo in der offenen Notiz wurde losgelassen? Index unter den obersten Blöcken (vor dem Block, über dessen oberer
 * Hälfte der Zeiger steht) — nur, wenn der lebende Editor da ist; `undefined` = ans Ende.
 */
export function ablageIndex(karte: Element, blocks: unknown[], y: number): number | undefined {
  if (!karte.querySelector('.ProseMirror[contenteditable="true"]')) return undefined;
  const ids = (blocks as Block[]).map((b) => b?.id);
  const oben = [...karte.querySelectorAll<HTMLElement>('.bn-block-outer[data-id]')].filter((el) => ids.includes(el.dataset.id));
  if (!oben.length) return undefined;
  for (const el of oben) {
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height / 2) return ids.indexOf(el.dataset.id);
  }
  return blocks.length;
}

/**
 * Einträge in eine Notiz einfügen (EIN Undo-Schritt für Notiz und Eingang). `index` = Stelle unter den obersten
 * Blöcken (Ablegen in die offene Notiz), sonst ans Ende. Gibt die Zahl der Einträge zurück — 0 heißt: nichts davon
 * passt in eine Notiz, nichts ist geschehen (der Aufrufer legt dann wie bisher aufs Board).
 */
export function eingangInNotiz(gruppen: string[], notizId: string, index?: number): number {
  const st0 = useBoard.getState();
  const eb = eingangBoard(st0.boards);
  const ziel = st0.boards.find((b) => !istEingang(b) && b.nodes.some((n) => n.id === notizId && n.type === 'note'));
  if (!eb || !ziel) return 0;
  const wahl = new Set(gruppen);
  const liste = eintraege(eb).filter((e) => wahl.has(e.id)).reverse();   // älteste zuerst — wie auf dem Board von links
  const neu: Block[] = [];
  const daneben: AppNode[] = [];
  for (const e of liste) {
    for (const n of e.nodes) {
      const b = bloeckeAus(n);
      if (b) neu.push(...b); else daneben.push(n);
    }
  }
  if (!liste.some(einfuegbar)) return 0;

  if (st0.view !== 'board') st0.setView('board');
  if (st0.tasksOpen) st0.setTasksOpen(false);
  if (st0.activeId !== ziel.id) st0.openBoard(ziel.id);
  // Notiz-Board und Eingang in EINEM Schritt — Strg+Z holt Inhalt und Eintrag zusammen zurück
  useBoard.getState().pushHistoryBoards([eb.id]);

  const jetzt = Date.now();
  const notiz = ziel.nodes.find((n) => n.id === notizId) as AppNode;
  const alt = (Array.isArray(notiz.data.blocks) ? notiz.data.blocks : []) as Block[];
  const stelle = leer(alt) ? 0 : Math.max(0, Math.min(alt.length, index ?? alt.length));
  const blocks = leer(alt) ? neu : [...alt.slice(0, stelle), ...neu, ...alt.slice(stelle)];
  // Was nicht in eine Notiz gehört, liegt rechts neben ihr — untereinander, ohne Marke
  const breite = notiz.width ?? notiz.measured?.width ?? 300;
  let y = notiz.position.y;
  const karten = daneben.map((n) => {
    const k = ohneMarke({ ...n, selected: false, position: { x: notiz.position.x + breite + 40, y } } as AppNode);
    y += (n.height ?? n.measured?.height ?? 200) + 24;
    return k;
  });
  const ids = new Set(liste.flatMap((e) => e.nodes.map((n) => n.id)));
  // Gemeinsam getippte Notiz (M477): Dort ist das Y-Dokument die Quelle, M364 greift nicht — der Zähler extEpoch
  // lässt den Schreiber den Stand übernehmen und an alle weitergeben (wie beim Kanban-Rück-Sync, M170)
  const live = liveVerbunden(ziel.id);
  useBoard.setState((s) => ({
    boards: s.boards.map((b) => {
      if (istEingang(b)) return { ...b, nodes: b.nodes.filter((n) => !ids.has(n.id)) };
      if (b.id !== ziel.id) return b;
      return {
        ...b,
        nodes: [...b.nodes.map((n) => (n.id === notizId ? { ...n, geaendert: jetzt, data: { ...n.data, blocks, ...(live ? { extEpoch: ((n.data.extEpoch as number | undefined) ?? 0) + 1 } : {}) } } as AppNode : n)), ...karten],
      };
    }),
  }));
  // Der lebende Editor übernimmt den Stand an Ort und Stelle, ohne ihn als eigenes Tippen zurückzuschreiben (M364)
  if (!live) window.dispatchEvent(new CustomEvent(NOTIZ_EXTERN, { detail: [notizId] }));

  const titel = noteTitle(blocks, 'Notiz').slice(0, 30);
  const was = zahlWort(liste.length, 'Eintrag', 'Einträge');
  useBoard.getState().showToast(karten.length
    ? `${was} in die Notiz „${titel}" eingefügt, ${zahlWort(karten.length, 'Karte', 'Karten')} daneben – Strg+Z holt alles zurück.`
    : `${was} in die Notiz „${titel}" eingefügt – Strg+Z holt alles zurück.`, 'schritt');
  return liste.length;
}
