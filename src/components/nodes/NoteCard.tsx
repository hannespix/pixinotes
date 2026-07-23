import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import { de as blockNoteDe } from '@blocknote/core/locales';
import { useBoard } from '../../store';
import { STICKY_COLORS, type NoteNode } from '../../types';
import { blocksToText } from '../../lib/serialize';
import { useAndroidBackspaceFix } from '../../lib/blocknoteAndroidFix';
import { extractWikilinks, resolveLink } from '../../lib/links';
import { appStateLines, fmtHM, linkedOfType, timeSums } from '../../lib/moduleFeeds';
import { loadAppState } from '../../lib/htmlStore';
import type { TimeData } from '../../types';
import { extractEntities } from '../../lib/entities';
import { makeNote } from '../../lib/nodes';
import { aiReady, askAi, textToBlocks } from '../../lib/ai';
import { CardShell } from './CardShell';
import { DueChips } from './DueChips';



/** Fristen-Chips für Notizen: Text aus den BlockNote-Blöcken extrahieren */
function NoteDueChips({ blocks }: { blocks?: unknown[] }) {
  const text = useMemo(() => blocksToText(blocks), [blocks]);
  const title = text.split('\n')[0]?.slice(0, 60) || 'Notiz';
  return <DueChips text={text} context={title} />;
}

/** ☎/✉/🔗-Chips: erkannte Telefonnummern, Mails & Links aus dem Notiz-Text
 *  (im BlockNote-Editor selbst können wir keine Links injizieren) */
function NoteEntityChips({ blocks }: { blocks?: unknown[] }) {
  const text = useMemo(() => blocksToText(blocks), [blocks]);
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
    const blocks = data.blocks as PartialBlock[] | undefined;
    return blocks && blocks.length > 0 ? blocks : undefined;
  });

  const editor = useCreateBlockNote({ initialContent, dictionary: blockNoteDe });
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
      try { editor.replaceBlocks(editor.document, blocks); } catch { /* Editor gerade im Umbau */ }
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
  const [tableSel, setTableSel] = useState<string | null>(null);
  const trackTable = () => {
    try {
      const b = editor.getTextCursorPosition().block;
      setTableSel(b.type === 'table' ? b.id : null);
    } catch {
      setTableSel(null);
    }
  };
  const removeTable = () => {
    if (!tableSel) return;
    try {
      editor.removeBlocks([tableSel]);
      updateNodeData(id, { blocks: editor.document });
      setTableSel(null);
      showToast('Tabelle entfernt — Strg+Z im Text holt sie zurück.');
    } catch { /* Block schon weg */ }
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
      <div className="nodrag nowheel note-editor">
        <BlockNoteView
          editor={editor}
          theme="light"
          sideMenu={false}
          onChange={() => { updateNodeData(id, { blocks: editor.document }); trackTable(); }}
          onSelectionChange={trackTable}
        />
      </div>
      {tableSel && (
        <div className="due-chips nodrag">
          <button
            className="due-chip table-del-chip"
            title="Die Tabelle, in der der Cursor steht, komplett aus der Notiz entfernen"
            onClick={removeTable}
          >
            ⌫ Tabelle entfernen
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
