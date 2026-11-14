import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import { de as blockNoteDe } from '@blocknote/core/locales';
import { kamVonAussen, NOTIZ_EXTERN, selectActiveBoard, useBoard, useKarteFest } from '../../store';
import { STICKY_COLORS, type NoteNode } from '../../types';
import { blocksToText } from '../../lib/serialize';
import { indexZuAdresse } from '../../lib/formel';
import { useAndroidBackspaceFix } from '../../lib/blocknoteAndroidFix';
import { extractWikilinks, resolveLink } from '../../lib/links';
import { appStateLines, fmtHM, linkedOfType, timeSums } from '../../lib/moduleFeeds';
import { loadAppState } from '../../lib/htmlStore';
import type { TimeData } from '../../types';
import { extractEntities } from '../../lib/entities';
import confetti from 'canvas-confetti';
import { checklistStand, FARB_NAMEN, noteTitle } from '../../lib/notiz';
import { repairBlocks } from '../../lib/htmlBlocks';
import { editorUpload } from '../../lib/notizBild';
import { importFilesToBoard } from '../../lib/importFiles';
import { CardShell } from './CardShell';
import { NotizRuhend } from './NotizRuhend';
import { hakenUmlegen, notizEinfach, type RuheBlock } from '../../lib/notizRuhend';
import { NotizStriche } from './NotizStriche';
import { DueChips } from './DueChips';
import { NoteSlashMenu, NoteToolbar, noteSchema, useNurBilderInDenText } from '../NoteTypo';



/**
 * M283: Der reine Text einer Tabellenzelle — für die Umwandlung in die
 * Rechen-Tabelle. Eine Zelle kann ein Objekt mit `content`, ein Array von
 * Textstücken oder schlicht eine Zeichenkette sein; alle drei kommen in
 * gespeicherten Notizen vor.
 */
function zelleZuText(zelle: unknown): string {
  if (zelle == null) return '';
  if (typeof zelle === 'string') return zelle;
  if (Array.isArray(zelle)) return zelle.map(zelleZuText).join('');
  const o = zelle as { text?: unknown; content?: unknown };
  if (typeof o.text === 'string') return o.text;
  if (o.content !== undefined) return zelleZuText(o.content);
  return '';
}

/** Fristen-Chips für Notizen (M323: der Text kommt EINMAL berechnet von der Karte) */
function NoteDueChips({ text, title }: { text: string; title: string }) {
  return <DueChips text={text} context={title} />;
}

/** ☎/✉/🔗-Chips: erkannte Telefonnummern, Mails & Links aus dem Notiz-Text
 *  (im BlockNote-Editor selbst können wir keine Links injizieren) */
function NoteEntityChips({ text }: { text: string }) {
  const ents = useMemo(() => extractEntities(text).slice(0, 4), [text]);
  if (ents.length === 0) return null;
  const ICON = { tel: '\u260e', mail: '\u2709', url: '\ud83d\udd17' } as const;
  return (
    <div className="due-chips nodrag">
      {ents.map((e) => (
        <a
          key={e.href}
          className={`due-chip ent-chip ent-chip-${e.kind}`}
          translate="no"
          href={e.href}
          target={e.kind === 'url' ? '_blank' : undefined}
          rel="noreferrer"
          title={e.kind === 'tel' ? `${e.display} anrufen` : e.kind === 'mail' ? `E-Mail an ${e.display}` : e.href}
        >
          {ICON[e.kind]} {e.display}
        </a>
      ))}
    </div>
  );
}

/** [[Wikilinks]] als Sprung-Chips (Obsidian-Gefühl): Board/Karte öffnen, sonst Board anlegen.
 *  M323: Die äußere Hülle prüft nur den Text; erst wenn es Links gibt, hört die
 *  innere auf ALLE Boards (vorher tat das jede Notiz, bei jeder Änderung irgendwo). */
function NoteLinkChips({ text }: { text: string }) {
  const links = useMemo(() => extractWikilinks(text), [text]);
  if (links.length === 0) return null;
  return <NoteLinkChipsInnen links={links} />;
}
function NoteLinkChipsInnen({ links }: { links: string[] }) {
  const boards = useBoard((s) => s.boards);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const addBoard = useBoard((s) => s.addBoard);
  const showToast = useBoard((s) => s.showToast);

  const follow = (name: string) => {
    const target = resolveLink(name, boards);
    if (target?.kind === 'board') openBoard(target.boardId);
    else if (target?.kind === 'card') { openBoard(target.boardId); focusNode(target.boardId, target.nodeId); }
    else {
      addBoard(name);
      showToast(`Board „${name}" angelegt und verlinkt`);
    }
  };

  return (
    <div className="due-chips nodrag">
      {links.map((name) => {
        const resolved = resolveLink(name, boards) !== null;
        return (
          <button
            key={name}
            className={`due-chip link-chip ${resolved ? '' : 'unresolved'}`}
            translate="no"
            title={resolved ? `Zu „${name}" springen` : `Board „${name}" anlegen`}
            onClick={() => follow(name)}
          >
            ⧉ {name}{resolved ? '' : ' +'}
          </button>
        );
      })}
    </div>
  );
}

/** M170: Abo-Fußzeile — Daten aus per Pfeil verbundenen Karten.
 *  ⏱ Zeiterfassung: Arbeitszeit heute/Woche als Chip.
 *  📟 Eigene App: lesbarer Auszug aus ihrem Speicherstand (live, sobald die
 *  App speichert). Reine Anzeige — der Notiz-Text bleibt unberührt. */
function NoteAboFeeds({ id }: { id: string }) {
  const boards = useBoard((s) => s.boards);
  const times = linkedOfType(boards, id, 'time');
  const apps = linkedOfType(boards, id, 'htmlapp');
  const [states, setStates] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    if (apps.length === 0) return;
    let gone = false;
    const load = () => {
      for (const a of apps) {
        void loadAppState(a.id).then((st) => {
          if (!gone && st) setStates((cur) => ({ ...cur, [a.id]: st }));
        });
      }
    };
    load();
    // Live: die App-Karte meldet jede Speicherung per Event (HtmlAppCard)
    const onSave = (e: Event) => {
      const appId = (e as CustomEvent<string>).detail;
      if (apps.some((a) => a.id === appId)) load();
    };
    window.addEventListener('pixinotes:happ-state', onSave);
    return () => { gone = true; window.removeEventListener('pixinotes:happ-state', onSave); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps.map((a) => a.id).join('|')]);

  if (times.length === 0 && apps.length === 0) return null;
  const sums = times.map((n) => timeSums(n.data as TimeData));
  const day = sums.reduce((a, s) => a + s.day, 0);
  const week = sums.reduce((a, s) => a + s.week, 0);
  return (
    <div className="abo-feeds nodrag">
      {times.length > 0 && (
        <span className="abo-time-chip" title="Aus der verbundenen Zeiterfassung: Arbeitszeit heute · diese Woche (ohne Pausen)">
          ⏱ {fmtHM(day)} · W {fmtHM(week)}
        </span>
      )}
      {apps.map((a) => {
        const lines = appStateLines(states[a.id]);
        return (
          <div key={a.id} className="abo-extract" title="Speicherstand der verbundenen App (lesbarer Auszug) — aktualisiert sich, sobald die App speichert">
            <b translate="no">📟 {(a.data.name as string) || 'App'}</b>
            {lines.length === 0
              ? <span className="abo-extract-empty">noch nichts gespeichert</span>
              : lines.map((l, i) => <span key={i} translate="no">{l}</span>)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Der lebende Editor einer Notiz (BlockNote, MPL-2.0) — entsteht erst bei Bedarf (M338).
 * `startPunkt`: Bildschirmstelle des Klicks, der ihn geweckt hat; dort landet der Cursor.
 */
function NotizEditor({ id, data, startPunkt }: { id: string; data: NoteNode['data']; startPunkt: MutableRefObject<{ x: number; y: number } | null> }) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);

  // bewusst nur beim Mount gelesen — danach ist der Editor die Quelle der Wahrheit
  const [initialContent] = useState<PartialBlock[] | undefined>(() => {
    // M184: vor dem Mount schonend prüfen. Ein einziger Block mit unbekanntem
    // Typ oder unmöglichem Wert (etwa Überschrift-Ebene 9) lässt BlockNote
    // hart werfen — und ohne Fehlergrenze bliebe ein weißer Bildschirm statt
    // eines Boards. repairBlocks fasst nur an, was sonst zum Absturz führt.
    const blocks = repairBlocks(data.blocks) as PartialBlock[];
    return blocks.length > 0 ? blocks : undefined;
  });

  /** M302/M303: Dateien (und Bilder, die nicht mehr in den Stand passen)
   *  werden zu Karten rechts neben dieser Notiz. Steht vor dem Editor, weil
   *  der seinen Anschluss beim Anlegen bekommt. */
  const { screenToFlowPosition, getNode } = useReactFlow();
  const dateienNebenDieNotiz = useCallback((dateien: File[]) => {
    const n = getNode(id);
    const breite = n?.measured?.width ?? (typeof n?.width === 'number' ? n.width : 320);
    const pos = n?.position ?? { x: 0, y: 0 };
    void importFilesToBoard(dateien, { x: pos.x + breite + 40, y: pos.y });
  }, [getNode, id]);
  // M201: gemeinsames Schema mit Inline-Schrift/-Größe (textSize/textFont)
  // M360: nur lesend geteiltes Board — der Editor zeigt, nimmt aber nichts an; M365: ebenso eine fremde Karte,
  // wenn Gäste hier nur Eigenes ändern dürfen
  const nurLesen = useKarteFest((data as { von?: string }).von);
  const editor = useCreateBlockNote({
    schema: noteSchema,
    initialContent: initialContent as never,
    dictionary: blockNoteDe,
    // M289: Damit Bilder überhaupt in den Text dürfen — Einfügen,
    // Ablegen und der Dateiwähler des Bild-Blocks laufen hier durch.
    // M303: Passt ein Bild nicht mehr in den Stand, wird es zur Karte daneben.
    uploadFile: editorUpload((f) => dateienNebenDieNotiz([f])),
  });
  useAndroidBackspaceFix(editor);

  // M170: Externer Schreiber (Kanban-Rück-Sync) hat die Blöcke geändert —
  // der lebende Editor liest Inhalt sonst nur beim Mount. extEpoch zählt bei
  // jedem externen Write hoch; wir übernehmen den Stand in den Editor.
  const extEpoch = data.extEpoch as number | undefined;
  const lastEpoch = useRef(extEpoch);
  useEffect(() => {
    if (extEpoch === lastEpoch.current) return;
    lastEpoch.current = extEpoch;
    const blocks = data.blocks as PartialBlock[] | undefined;
    if (blocks?.length) {
      // `as never`: Die Blöcke kommen als gespeicherte Daten herein, ihr Typ ist
      // erst zur Laufzeit bekannt — seit M289 ist das Schema enger als die
      // Standard-Blöcke (kein video/audio/file), und TypeScript kann die
      // Zuordnung deshalb nicht mehr selbst herstellen.
      try { editor.replaceBlocks(editor.document, blocks as never); } catch { /* Editor gerade im Umbau */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extEpoch]);

  // M364: Der Inhalt wurde von außen geändert (Abgleich, Mitschreiben eines anderen in der Gruppenarbeit) — der
  // lebende Editor übernimmt ihn an Ort und Stelle. Währenddessen schreibt onChange nichts zurück.
  const externRef = useRef(false);
  useEffect(() => {
    const auf = (e: Event) => {
      if (!(e as CustomEvent<string[]>).detail?.includes(id)) return;
      const blocks = selectActiveBoard(useBoard.getState()).nodes.find((n) => n.id === id)?.data.blocks as PartialBlock[] | undefined;
      externRef.current = true;
      // M365: Der Cursor bleibt, wo er war — der fremde Inhalt darf ihn nicht in diese Karte holen
      const vorher = document.activeElement as HTMLElement | null;
      const eigener = (): HTMLElement | null => editorRef.current?.querySelector('[contenteditable="true"]') ?? null;
      const hatteFokus = !!vorher && !!eigener()?.contains(vorher);
      setTimeout(() => {
        const jetzt = document.activeElement as HTMLElement | null;
        if (hatteFokus || !jetzt || !eigener()?.contains(jetzt)) return;
        jetzt.blur();
        if (vorher?.isConnected && vorher !== document.body) vorher.focus({ preventScroll: true });
      }, 0);
      try { editor.replaceBlocks(editor.document, (blocks?.length ? blocks : [{ type: 'paragraph' }]) as never); }
      catch { useBoard.setState((s) => ({ importEpoch: s.importEpoch + 1 })); }   // Editor im Umbau: sicherer Weg, Board neu aufbauen
      finally { setTimeout(() => { externRef.current = false; }, 60); }
    };
    window.addEventListener(NOTIZ_EXTERN, auf);
    return () => window.removeEventListener(NOTIZ_EXTERN, auf);
  }, [id, editor]);

  // Frische, leere Notiz: sofort den Cursor reinsetzen — lostippen ohne Extra-Klick
  // M365: … aber nur in der selbst angelegten. Eine leere Notiz, die jemand anderes gerade angelegt hat und die
  // per Abgleich hier ankommt, nähme sonst jedem den Cursor weg.
  useEffect(() => {
    if (!initialContent && !kamVonAussen(id)) {
      const t = setTimeout(() => editor.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [editor, initialContent, id]);

  // M176: Tabellen ließen sich nicht löschen — das Seiten-Menü (Drag-Griff mit
  // Block-Löschen) ist bewusst aus, und per Tastatur ist eine Tabelle in
  // BlockNote praktisch unlöschbar. Steht der Cursor in einer Tabelle,
  // erscheint deshalb unten ein „Tabelle entfernen"-Chip.
  //
  // M229: Dasselbe gilt für ZEILEN und SPALTEN. Die eingebauten Griffe von
  // BlockNote verweigern die letzte Zeile und die letzte Spalte — eine
  // Tabelle darf dort nie leer werden. Für den Nutzer heißt das: Ein Rest
  // bleibt immer stehen, und was er eigentlich wollte („weg damit"), geht
  // nicht (User-Report). Hier gilt darum: Wer die letzte Zeile oder Spalte
  // löscht, löscht die Tabelle — das ist die Absicht dahinter.
  const editorRef = useRef<HTMLDivElement>(null);
  /**
   * M289: Nur Bilder dürfen in den Text — alles andere gehört aufs Board.
   * Eine auf der Notiz abgelegte PDF wird deshalb genau dort zur Datei-Karte,
   * wo man losgelassen hat (dieselbe Pipeline wie beim Ablegen aufs Board).
   */
  const aufsBoard = useCallback((dateien: File[], x: number, y: number) => {
    void importFilesToBoard(dateien, screenToFlowPosition({ x, y }));
  }, [screenToFlowPosition]);
  useNurBilderInDenText(editorRef, aufsBoard);
  const [tableSel, setTableSel] = useState<string | null>(null);
  const [tabZelle, setTabZelle] = useState<{ zeile: number; spalte: number } | null>(null);
  const trackTable = () => {
    try {
      const b = editor.getTextCursorPosition().block;
      const inTabelle = b.type === 'table';
      setTableSel(inTabelle ? b.id : null);
      if (!inTabelle) { setTabZelle(null); return; }
      // Welche Zelle? Der Editor-Zustand verrät es nicht, das DOM schon.
      const sel = document.getSelection();
      const knoten = sel?.anchorNode ?? null;
      const el = knoten instanceof Element ? knoten : knoten?.parentElement ?? null;
      // M230: Liegt die Auswahl gar nicht in DIESEM Editor, ist sie meist auf
      // einem unserer Chips gelandet (Antippen setzt den Fokus um). Dann den
      // gemerkten Zellen-Ort BEHALTEN. Vorher wurde er genullt, die Chips
      // verschwanden mitten im Tippen — und die Tabelle blieb halb stehen.
      if (!el || !editorRef.current?.contains(el)) return;
      const zelle = el.closest('td, th') as HTMLTableCellElement | null;
      const zeile = zelle?.parentElement as HTMLTableRowElement | null;
      if (zelle && zeile) { setTabZelle({ zeile: zeile.rowIndex, spalte: zelle.cellIndex }); return; }
      // Keine Zelle greifbar, aber der Cursor steckt weiter in DERSELBEN Tabelle:
      // Nach dem Umbau (updateBlock) steht die Auswahl kurz „zwischen" den
      // Zellen. Merker behalten — sonst wäre nach jedem Löschen Schluss.
      if (b.id !== tableSel) setTabZelle(null);
    } catch {
      setTableSel(null);
      setTabZelle(null);
    }
  };
  const removeTable = () => {
    if (!tableSel) return;
    try {
      editor.removeBlocks([tableSel]);
      updateNodeData(id, { blocks: editor.document });
      setTableSel(null);
      setTabZelle(null);
      showToast('Tabelle entfernt — Strg+Z im Text holt sie zurück.');
    } catch { /* Block schon weg */ }
  };
  /**
   * M283: Eine bestehende Fließtext-Tabelle in die rechnende umwandeln.
   *
   * Neu eingefügt wird ab jetzt nur noch die Rechen-Tabelle. Alte Tabellen
   * bleiben aber, wo sie sind — niemandem ist gedient, wenn eine Notiz beim
   * Öffnen anders aussieht als gestern. Wer rechnen WILL, drückt hier: Die
   * Zellinhalte wandern als Text hinüber, danach steht in jeder Zelle ein
   * „=" zur Verfügung. Fett und Farben aus der alten Tabelle gehen dabei
   * verloren — das steht auch so im Hinweis.
   */
  const inRechenTabelle = () => {
    if (!tableSel) return;
    try {
      const block = editor.getBlock(tableSel) as unknown as {
        content?: { rows?: Array<{ cells: unknown[] }> };
      } | undefined;
      const rows = block?.content?.rows ?? [];
      if (!rows.length) return;
      const zellen: Record<string, string> = {};
      let spalten = 1;
      rows.forEach((r, z) => {
        spalten = Math.max(spalten, r.cells.length);
        r.cells.forEach((c, s) => {
          const t = zelleZuText(c).trim();
          if (t) zellen[indexZuAdresse(s, z)] = t;
        });
      });
      editor.replaceBlocks([tableSel], [{
        type: 'rechentabelle',
        props: {
          zellen: JSON.stringify(zellen),
          stil: '{}',
          spalten: Math.min(26, spalten),
          zeilen: Math.min(200, rows.length),
        },
      } as never]);
      updateNodeData(id, { blocks: editor.document });
      setTableSel(null);
      setTabZelle(null);
      showToast('Umgewandelt — jetzt rechnet die Tabelle: „=SUMME(A1:A3)" in eine Zelle schreiben.');
    } catch {
      showToast('Diese Tabelle ließ sich nicht umwandeln.');
    }
  };

  /** Zeile oder Spalte löschen — die letzte nimmt die ganze Tabelle mit */
  const entferne = (was: 'zeile' | 'spalte') => {
    if (!tableSel || !tabZelle) return;
    try {
      const block = editor.getBlock(tableSel) as unknown as {
        content?: { rows?: Array<{ cells: unknown[] }>; columnWidths?: unknown[] };
      } | undefined;
      const rows = block?.content?.rows;
      if (!rows) return;
      const letzte = was === 'zeile'
        ? rows.length <= 1
        : rows.every((r) => (r.cells?.length ?? 0) <= 1);
      if (letzte) { removeTable(); return; }
      const neu = was === 'zeile'
        ? rows.filter((_, i) => i !== tabZelle.zeile)
        : rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== tabZelle.spalte) }));
      const breiten = block?.content?.columnWidths;
      editor.updateBlock(tableSel, {
        type: 'table',
        content: {
          type: 'tableContent',
          ...(was === 'spalte' && Array.isArray(breiten)
            ? { columnWidths: breiten.filter((_, i) => i !== tabZelle.spalte) }
            : {}),
          rows: neu,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      updateNodeData(id, { blocks: editor.document });
      // M230: Nach dem Umbau steht der Cursor nicht mehr IN der Tabelle —
      // BlockNote meldet dann einen anderen Block, die Chips verschwanden
      // schlagartig. Für den Nutzer sah das aus, als ginge nur ein einziger
      // Löschschritt und der Rest bleibe „einfach stehen" (User-Report).
      // Also den Cursor zurück in die Tabelle setzen und den Merker gleich
      // mit nachziehen — dann löscht jedes weitere Antippen den nächsten
      // Rest, bis nichts mehr da ist.
      try { editor.setTextCursorPosition(tableSel, 'start'); } catch { /* gleich weg */ }
      setTableSel(tableSel);
      setTabZelle((z) => (z ? (was === 'zeile'
        ? { ...z, zeile: Math.min(z.zeile, neu.length - 1) }
        : { ...z, spalte: Math.min(z.spalte, (neu[0]?.cells.length ?? 1) - 1) }) : z));
      showToast(was === 'zeile'
        ? 'Zeile entfernt — Strg+Z im Text holt sie zurück.'
        : 'Spalte entfernt — Strg+Z im Text holt sie zurück.');
    } catch { /* Tabelle inzwischen weg */ }
  };

  // M338: Der Klick, der den Editor geweckt hat, setzt auch den Cursor — an genau der Stelle
  // (die ruhende Ansicht hat denselben Umbruch, die Koordinaten stimmen also)
  useLayoutEffect(() => {
    const p = startPunkt.current;
    startPunkt.current = null;
    if (!p) return;
    let n = 0; let raf = 0;
    const setzen = () => {
      const el = editorRef.current?.querySelector('[contenteditable="true"]') as HTMLElement | null;
      if (!el) { if (n++ < 30) raf = requestAnimationFrame(setzen); return; }
      const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
      let r: Range | null = null;
      if (typeof document.caretRangeFromPoint === 'function') r = document.caretRangeFromPoint(p.x, p.y);
      else if (typeof doc.caretPositionFromPoint === 'function') { const c = doc.caretPositionFromPoint(p.x, p.y); if (c) { r = document.createRange(); r.setStart(c.offsetNode, c.offset); r.collapse(true); } }
      el.focus({ preventScroll: true });
      if (r && el.contains(r.startContainer)) { const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r); }
    };
    setzen();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div
        className="nodrag nowheel note-editor"
        ref={editorRef}
      >
        <BlockNoteView
          editor={editor}
          editable={!nurLesen}
          theme="light"
          sideMenu={false}
          formattingToolbar={false}
          slashMenu={false}   /* M283: eigenes Einfügen-Menü (NoteSlashMenu) */
          onChange={() => { if (!externRef.current) updateNodeData(id, { blocks: editor.document }); trackTable(); }}
          onSelectionChange={trackTable}
        >
          {/* M201: Standard-Leiste + A₋/A₊/A₊₊/Aa für den markierten Text */}
          <NoteToolbar />
          {/* M283: „/" bietet die rechnende Tabelle an; M302: Bilder und Dateien */}
          <NoteSlashMenu dateienAufsBoard={dateienNebenDieNotiz} />
        </BlockNoteView>
      </div>
      {tableSel && (
        // M230: `onPointerDown` mit preventDefault hält den Cursor in der
        // Tabelle. Ohne das nimmt der Browser dem Editor beim Antippen den
        // Fokus, am Telefon fährt zusätzlich die Tastatur ein — die Karte
        // springt, der Finger landet daneben, und nichts passiert.
        <div className="due-chips nodrag" onPointerDown={(e) => e.preventDefault()}>
          {tabZelle && (
            <>
              <button
                className="due-chip table-del-chip"
                title="Die Zeile mit dem Cursor löschen — ist es die letzte, verschwindet die Tabelle"
                onClick={() => entferne('zeile')}
              >
                ⌫ Zeile
              </button>
              <button
                className="due-chip table-del-chip"
                title="Die Spalte mit dem Cursor löschen — ist es die letzte, verschwindet die Tabelle"
                onClick={() => entferne('spalte')}
              >
                ⌫ Spalte
              </button>
            </>
          )}
          {/* M283: der Weg von der alten Tabelle zur rechnenden */}
          <button
            className="due-chip"
            title={'In eine Rechen-Tabelle umwandeln: Danach rechnet „=SUMME(A1:A3)" wirklich. '
              + 'Texte bleiben erhalten, Fett und Farben der alten Tabelle gehen dabei verloren.'}
            onClick={inRechenTabelle}
          >
            Σ Rechnen lassen
          </button>
          <button
            className="due-chip table-del-chip"
            title="Die Tabelle, in der der Cursor steht, komplett aus der Notiz entfernen"
            onClick={removeTable}
          >
            ⌫ Tabelle
          </button>
        </div>
      )}
    </>
  );
}

/** Haftnotiz: ruhend als schlichtes HTML, mit vollem Block-Editor, sobald jemand schreibt (M338). */
export function NoteCard({ id, data, selected }: NodeProps<NoteNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const konfetti = useBoard((s) => s.konfetti);

  // M323: EIN Klartext je Notiz — Fristen, Chips und Wikilinks lasen ihn
  // vorher je dreimal pro Änderung
  const text = useMemo(() => blocksToText(data.blocks), [data.blocks]);
  const titel = useMemo(() => noteTitle(data.blocks), [data.blocks]);
  /** M283: Zahlen aus der Rechen-Tabelle bleiben bei den ☎-Chips außen vor
   *  („1.200" ist keine Rufnummer); Suche, Export und KI sehen sie vollständig. */
  const chipText = useMemo(() => {
    const bs = data.blocks ?? [];
    return bs.some((b) => (b as { type?: string })?.type === 'rechentabelle')
      ? blocksToText(bs.filter((b) => (b as { type?: string })?.type !== 'rechentabelle'))
      : text;
  }, [data.blocks, text]);
  // M323: Checklisten-Stand — Fortschritt unter der Notiz, Konfetti beim letzten Haken
  const stand = useMemo(() => checklistStand(data.blocks), [data.blocks]);
  const vorherOffen = useRef(stand.gesamt - stand.erledigt);
  useEffect(() => {
    const offen = stand.gesamt - stand.erledigt;
    if (stand.gesamt > 0 && offen === 0 && vorherOffen.current > 0 && konfetti) {
      confetti({ particleCount: 60, spread: 55, origin: { y: 0.7 }, scalar: 0.8 });
    }
    vorherOffen.current = offen;
  }, [stand.gesamt, stand.erledigt, konfetti]);
  // M323: Farbwahl als kleine Palette statt Durchblättern
  const [farbenOffen, setFarbenOffen] = useState(false);
  useEffect(() => { if (!selected) setFarbenOffen(false); }, [selected]);

  const waehleFarbe = (farbe: (typeof STICKY_COLORS)[number]) => {
    updateNodeData(id, { color: farbe, hex: undefined }); // zurück zur Palette
    setFarbenOffen(false);
  };

  /**
   * M338: Die Notiz ruht, bis jemand in ihr schreibt.
   *
   * Solange `aktiv` falsch ist, steht der Inhalt als schlichtes HTML da
   * (NotizRuhend) — kein Editor, keine 150 ms Aufbauzeit, kein eigener
   * Stil-Block je Karte. Der Editor entsteht beim Klick in den Text (der
   * Cursor landet an der Klickstelle), im Fokus, beim Verweilen mit der Maus
   * (dann ist er schon da, wenn man klickt oder Text markiert) und wenn die
   * Zeichenebene ihn ruft (Stift-Schleife markiert Wörter). Einmal wach, bleibt er wach.
   * Stift-Gesten und Handschrift arbeiten auch auf der ruhenden Notiz — sie lesen dieselben Klassen.
   */
  const einfach = useMemo(() => notizEinfach(data.blocks), [data.blocks]);
  const imFokus = useBoard((s) => s.focusCard === id);
  const [aktiv, setAktiv] = useState(() => !einfach);
  const startPunkt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { if (!einfach || imFokus) setAktiv(true); }, [einfach, imFokus]);
  useEffect(() => {
    if (aktiv) return;
    const auf = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; x?: number; y?: number }>).detail;
      if (d?.id !== id) return;
      if (typeof d.x === 'number' && typeof d.y === 'number') startPunkt.current = { x: d.x, y: d.y };
      setAktiv(true);
    };
    window.addEventListener('pixinotes:notiz-aktiv', auf);
    return () => window.removeEventListener('pixinotes:notiz-aktiv', auf);
  }, [aktiv, id]);
  const verweilen = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(verweilen.current), []);
  const hakenSetzen = useCallback((pfad: number[], an: boolean) => {
    const st = useBoard.getState();
    const n = st.boards.find((b) => b.id === st.activeId)?.nodes.find((k) => k.id === id);
    const bs = ((n?.data as { blocks?: RuheBlock[] } | undefined)?.blocks ?? []);
    updateNodeData(id, { blocks: hakenUmlegen(bs, pfad, an) });
  }, [id, updateNodeData]);

  return (
    <CardShell
      id={id} selected={selected} minWidth={200} minHeight={90} className={`note-card sticky-${data.color}`} style={data.hex ? { background: data.hex as string } : undefined} schrumpft
      // M339: Lange Notizen scrollen in der Karte; der Farbpunkt liegt auf der Hülle und scrollt nicht mit
      rollt
      aussen={<>
      {/* M323: Der Farbpunkt öffnet eine Palette — fünf Farben auf einen Blick
          plus eigene Farbe, statt blind durchzublättern */}
      <button
        className={`color-dot nodrag ${farbenOffen ? 'on' : ''}`}
        title="Farbe der Notiz"
        aria-label="Farbe der Notiz"
        aria-expanded={farbenOffen}
        onClick={() => setFarbenOffen((o) => !o)}
      />
      {farbenOffen && (
        <div className="note-farben nodrag nowheel" role="group" aria-label="Notizfarbe" onPointerDown={(e) => e.stopPropagation()}>
          {STICKY_COLORS.map((c) => (
            <button
              key={c}
              className={`note-farbe note-farbe-${c} ${data.color === c && !data.hex ? 'on' : ''}`}
              title={FARB_NAMEN[c]}
              aria-label={`Farbe ${FARB_NAMEN[c]}`}
              onClick={() => waehleFarbe(c)}
            />
          ))}
          <input
            type="color"
            className="pn-colorpick note-colorpick nodrag"
            title="Eigene Farbe wählen"
            aria-label="Eigene Farbe"
            value={(data.hex as string) ?? '#fff8c5'}
            onChange={(e) => updateNodeData(id, { hex: e.target.value })}
          />
        </div>
      )}
      </>}
    >
      {aktiv ? (
        <NotizEditor id={id} data={data} startPunkt={startPunkt} />
      ) : (
        <div
          className="nodrag nowheel note-editor"
          translate="no"
          // Klick in den Text weckt den Editor; der Cursor landet an der Klickstelle
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('input')) return;
            startPunkt.current = { x: e.clientX, y: e.clientY };
            setAktiv(true);
          }}
          // Maus ruht auf der Notiz: Editor vorwärmen — dann ist er da, bevor man klickt oder markiert
          onPointerEnter={(e) => {
            if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
            window.clearTimeout(verweilen.current);
            verweilen.current = window.setTimeout(() => setAktiv(true), 260);
          }}
          onPointerLeave={() => window.clearTimeout(verweilen.current)}
          onPointerDown={() => window.clearTimeout(verweilen.current)}
        >
          <NotizRuhend blocks={data.blocks as RuheBlock[]} onHaken={hakenSetzen} />
        </div>
      )}
      {/* M302: Der 🖼-Chip unter der Notiz ist weg — Bild aus Datei und Datei als
          Karte liegen im „/"-Menü, Strg+V und Ablegen bleiben. Ein Knopf, den
          jede Notiz beim Tippen trug, für etwas, das selten vorkommt. */}
      {/* M323: Checklisten-Fortschritt — ab zwei Punkten, mit Balken */}
      {stand.gesamt >= 2 && (
        <div
          className={`note-fortschritt nodrag ${stand.erledigt === stand.gesamt ? 'fertig' : ''}`}
          title={stand.erledigt === stand.gesamt ? 'Alles erledigt' : `${stand.gesamt - stand.erledigt} offen`}
        >
          <span className="note-fortschritt-balken" aria-hidden="true"><i style={{ width: `${Math.round((stand.erledigt / stand.gesamt) * 100)}%` }} /></span>
          <span className="note-fortschritt-text">{stand.erledigt}/{stand.gesamt} erledigt</span>
        </div>
      )}
      <NoteDueChips text={text} title={titel} />
      <NoteEntityChips text={chipText} />
      <NoteLinkChips text={text} />
      <NoteAboFeeds id={id} />
      {/* M339: Stift- und Textmarker-Striche auf dem Text — scrollen mit, haften am Absatz */}
      <NotizStriche id={id} />
      {/* KI-Politur wohnt jetzt im ✨-Menü der Auswahl-Leiste (KI-Werkzeuge) —
          kein Dauer-Button mehr auf jeder Notiz (User-Feedback) */}
    </CardShell>
  );
}
