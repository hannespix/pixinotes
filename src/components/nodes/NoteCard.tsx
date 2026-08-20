import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import { de as blockNoteDe } from '@blocknote/core/locales';
import { useBoard } from '../../store';
import { STICKY_COLORS, type NoteNode } from '../../types';
import { blocksToText } from '../../lib/serialize';
import { indexZuAdresse } from '../../lib/formel';
import { useAndroidBackspaceFix } from '../../lib/blocknoteAndroidFix';
import { extractWikilinks, resolveLink } from '../../lib/links';
import { appStateLines, fmtHM, linkedOfType, timeSums } from '../../lib/moduleFeeds';
import { loadAppState } from '../../lib/htmlStore';
import type { TimeData } from '../../types';
import { extractEntities } from '../../lib/entities';
import { makeNote } from '../../lib/nodes';
import { aiReady, askAi, textToBlocks } from '../../lib/ai';
import { repairBlocks } from '../../lib/htmlBlocks';
import { notizBildHochladen } from '../../lib/notizBild';
import { importFilesToBoard } from '../../lib/importFiles';
import { CardShell } from './CardShell';
import { DueChips } from './DueChips';
import { bildBlockEinfuegen, NoteSlashMenu, NoteToolbar, noteSchema, useNurBilderInDenText, waehleBildDatei } from '../NoteTypo';



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

/** Fristen-Chips für Notizen: Text aus den BlockNote-Blöcken extrahieren */
function NoteDueChips({ blocks }: { blocks?: unknown[] }) {
  const text = useMemo(() => blocksToText(blocks), [blocks]);
  const title = text.split('\n')[0]?.slice(0, 60) || 'Notiz';
  return <DueChips text={text} context={title} />;
}

/** ☎/✉/🔗-Chips: erkannte Telefonnummern, Mails & Links aus dem Notiz-Text
 *  (im BlockNote-Editor selbst können wir keine Links injizieren) */
function NoteEntityChips({ blocks }: { blocks?: unknown[] }) {
  /**
   * M283: Zahlen aus der Rechen-Tabelle bleiben hier außen vor.
   *
   * Seit die Tabelle IN der Notiz liegt, wandert ihr Inhalt in den Notiz-Text
   * — und die Rufnummern-Erkennung machte aus „1.200" prompt ein „☎ 1.200"
   * (im Bildschirmfoto der Probe gleich dreimal). Eine Zahlenspalte ist keine
   * Prosa: Für die Chips wird die Tabelle deshalb übersprungen. Suche, Export
   * und KI sehen sie unverändert vollständig.
   */
  const text = useMemo(
    () => blocksToText((blocks ?? []).filter((b) => (b as { type?: string })?.type !== 'rechentabelle')),
    [blocks],
  );
  const ents = useMemo(() => extractEntities(text).slice(0, 4), [text]);
  if (ents.length === 0) return null;
  const ICON = { tel: '\u260e', mail: '\u2709', url: '\ud83d\udd17' } as const;
  return (
    <div className="due-chips nodrag">
      {ents.map((e) => (
        <a
          key={e.href}
          className={`due-chip ent-chip ent-chip-${e.kind}`}
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

/** [[Wikilinks]] als Sprung-Chips (Obsidian-Gefühl): Board/Karte öffnen, sonst Board anlegen */
function NoteLinkChips({ blocks }: { blocks?: unknown[] }) {
  const boards = useBoard((s) => s.boards);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const addBoard = useBoard((s) => s.addBoard);
  const showToast = useBoard((s) => s.showToast);
  const text = useMemo(() => blocksToText(blocks), [blocks]);
  const links = useMemo(() => extractWikilinks(text), [text]);
  if (links.length === 0) return null;

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
            <b>📟 {(a.data.name as string) || 'App'}</b>
            {lines.length === 0
              ? <span className="abo-extract-empty">noch nichts gespeichert</span>
              : lines.map((l, i) => <span key={i}>{l}</span>)}
          </div>
        );
      })}
    </div>
  );
}

/** Haftnotiz mit vollem Notion-artigem Block-Editor (BlockNote, MPL-2.0). */
export function NoteCard({ id, data, selected, positionAbsoluteX, positionAbsoluteY }: NodeProps<NoteNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const addNode = useBoard((s) => s.addNode);
  const showToast = useBoard((s) => s.showToast);
  const ai = useBoard((s) => s.ai);
  const [aiBusy, setAiBusy] = useState(false);

  // bewusst nur beim Mount gelesen — danach ist der Editor die Quelle der Wahrheit
  const [initialContent] = useState<PartialBlock[] | undefined>(() => {
    // M184: vor dem Mount schonend prüfen. Ein einziger Block mit unbekanntem
    // Typ oder unmöglichem Wert (etwa Überschrift-Ebene 9) lässt BlockNote
    // hart werfen — und ohne Fehlergrenze bliebe ein weißer Bildschirm statt
    // eines Boards. repairBlocks fasst nur an, was sonst zum Absturz führt.
    const blocks = repairBlocks(data.blocks) as PartialBlock[];
    return blocks.length > 0 ? blocks : undefined;
  });

  // M201: gemeinsames Schema mit Inline-Schrift/-Größe (textSize/textFont)
  const editor = useCreateBlockNote({
    schema: noteSchema,
    initialContent: initialContent as never,
    dictionary: blockNoteDe,
    // M289: Damit Bilder überhaupt in den Text dürfen — Einfügen,
    // Ablegen und der Dateiwähler des Bild-Blocks laufen hier durch
    uploadFile: notizBildHochladen,
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

  // Frische, leere Notiz: sofort den Cursor reinsetzen — lostippen ohne Extra-Klick
  useEffect(() => {
    if (!initialContent) {
      const t = setTimeout(() => editor.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [editor, initialContent]);

  const cycleColor = () => {
    const next = STICKY_COLORS[(STICKY_COLORS.indexOf(data.color) + 1) % STICKY_COLORS.length];
    updateNodeData(id, { color: next, hex: undefined }); // zurück zur Palette
  };

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
  const { screenToFlowPosition } = useReactFlow();
  const aufsBoard = useCallback((dateien: File[], x: number, y: number) => {
    void importFilesToBoard(dateien, screenToFlowPosition({ x, y }));
  }, [screenToFlowPosition]);
  useNurBilderInDenText(editorRef, aufsBoard);
  const [tableSel, setTableSel] = useState<string | null>(null);
  /* M289: Steht der Cursor gerade in dieser Notiz? (zeigt den Bild-Chip) */
  const [imText, setImText] = useState(false);
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

  return (
    <CardShell id={id} selected={selected} minWidth={200} minHeight={90} className={`note-card sticky-${data.color}`} style={data.hex ? { background: data.hex as string } : undefined}>
      <button className="color-dot nodrag" title="Farbe wechseln (Palette)" onClick={cycleColor} />
      <input
        type="color"
        className="pn-colorpick note-colorpick nodrag"
        title="Eigene Farbe wählen"
        value={(data.hex as string) ?? '#fff8c5'}
        onChange={(e) => updateNodeData(id, { hex: e.target.value })}
      />
      <div
        className="nodrag nowheel note-editor"
        ref={editorRef}
        /* M289: Der Bild-Chip erscheint nur, solange der Cursor wirklich im
           Text steht — sonst trüge jede Notiz auf dem Board einen Knopf, den
           sie in diesem Moment nicht braucht. */
        onFocus={() => setImText(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setImText(false);
        }}
      >
        <BlockNoteView
          editor={editor}
          theme="light"
          sideMenu={false}
          formattingToolbar={false}
          slashMenu={false}   /* M283: eigenes Einfügen-Menü (NoteSlashMenu) */
          onChange={() => { updateNodeData(id, { blocks: editor.document }); trackTable(); }}
          onSelectionChange={trackTable}
        >
          {/* M201: Standard-Leiste + A₋/A₊/A₊₊/Aa für den markierten Text */}
          <NoteToolbar />
          {/* M283: „/" bietet die rechnende Tabelle an */}
          <NoteSlashMenu />
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
      {imText && (
        /**
         * M289: Der sichtbare Weg für ein Bild — vor allem am Telefon.
         *
         * Dort gibt es kein Strg+V, und wer „/" tippt, muss erst wissen, dass
         * es das Menü gibt. Der Chip führt direkt in die Fotomediathek bzw.
         * zur Kamera. `preventDefault` beim Aufsetzen des Fingers hält den
         * Cursor im Text — sonst landete das Bild nicht dort, wo man stand.
         */
        <div className="due-chips nodrag" onPointerDown={(e) => e.preventDefault()}>
          <button
            className="due-chip bild-chip"
            title={'Bild in die Notiz einfügen — am Telefon öffnet das die Fotomediathek oder die Kamera. '
              + 'Ein kopiertes Bild geht auch mit Strg+V oder über das Einfügen-Menü („/" → „Bild aus Zwischenablage").'}
            onClick={() => waehleBildDatei((f) => { void bildBlockEinfuegen(editor, f); })}
          >
            🖼 Bild
          </button>
        </div>
      )}
      <NoteDueChips blocks={data.blocks} />
      <NoteEntityChips blocks={data.blocks} />
      <NoteLinkChips blocks={data.blocks} />
      <NoteAboFeeds id={id} />
      {/* KI-Politur wohnt jetzt im ✨-Menü der Auswahl-Leiste (KI-Werkzeuge) —
          kein Dauer-Button mehr auf jeder Notiz (User-Feedback) */}
    </CardShell>
  );
}
