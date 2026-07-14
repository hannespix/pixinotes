import { useEffect, useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import { de as blockNoteDe } from '@blocknote/core/locales';
import { useBoard } from '../../store';
import { STICKY_COLORS, type NoteNode } from '../../types';
import { blocksToText } from '../../lib/serialize';
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

  // Frische, leere Notiz: sofort den Cursor reinsetzen — lostippen ohne Extra-Klick
  useEffect(() => {
    if (!initialContent) {
      const t = setTimeout(() => editor.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [editor, initialContent]);

  const polish = async () => {
    const text = blocksToText(data.blocks);
    if (!text.trim()) { showToast('Notiz ist leer.'); return; }
    setAiBusy(true);
    try {
      const answer = await askAi(
        `Verbessere den folgenden Notiztext: korrigiere Rechtschreibung und Grammatik, straffe Formulierungen, behalte Bedeutung, Sprache (Deutsch) und Aufzählungsstruktur bei. Antworte NUR mit dem verbesserten Text.\n\n${text.slice(0, 6000)}`,
      );
      addNode(makeNote(
        { x: positionAbsoluteX + 300, y: positionAbsoluteY },
        { color: 'mint', blocks: textToBlocks('✨ Vorschlag', answer) },
      ));
      showToast('✨ Verbesserter Text als Vorschlag daneben — Original bleibt unangetastet');
    } catch (e) {
      showToast(`⚠️ KI-Fehler: ${(e as Error).message}`);
    } finally {
      setAiBusy(false);
    }
  };

  const cycleColor = () => {
    const next = STICKY_COLORS[(STICKY_COLORS.indexOf(data.color) + 1) % STICKY_COLORS.length];
    updateNodeData(id, { color: next });
  };

  return (
    <CardShell id={id} selected={selected} minWidth={200} minHeight={90} className={`note-card sticky-${data.color}`}>
      <button className="color-dot nodrag" title="Farbe wechseln" onClick={cycleColor} />
      <div className="nodrag nowheel note-editor">
        <BlockNoteView
          editor={editor}
          theme="light"
          sideMenu={false}
          onChange={() => updateNodeData(id, { blocks: editor.document })}
        />
      </div>
      <NoteDueChips blocks={data.blocks} />
      {aiReady(ai) && (
        <div className="card-actions note-ai">
          <button className="nodrag ai-btn" onClick={polish} disabled={aiBusy} title="KI verbessert den Text (als neuer Vorschlag daneben)">
            {aiBusy ? '⏳…' : '✨ Verbessern'}
          </button>
        </div>
      )}
    </CardShell>
  );
}
