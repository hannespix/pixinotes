import { useEffect, useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import * as locales from '@blocknote/core/locales';
import { useBoard } from '../../store';
import type { NoteData, StickyColor } from '../../types';
import { CardShell } from './CardShell';

const COLORS: StickyColor[] = ['yellow', 'pink', 'mint', 'sky', 'white'];

/** Haftnotiz mit vollem Notion-artigem Block-Editor (BlockNote, MPL-2.0). */
export function NoteCard({ id, data }: NodeProps) {
  const noteData = data as unknown as NoteData;
  const updateNodeData = useBoard((s) => s.updateNodeData);

  const initialContent = useMemo<PartialBlock[] | undefined>(() => {
    const blocks = noteData.blocks as PartialBlock[] | undefined;
    return blocks && blocks.length > 0 ? blocks : undefined;
  }, []);

  const editor = useCreateBlockNote({ initialContent, dictionary: locales.de });

  // Frische, leere Notiz: sofort den Cursor reinsetzen — lostippen ohne Extra-Klick
  useEffect(() => {
    if (!initialContent) {
      const t = setTimeout(() => editor.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [editor, initialContent]);

  const cycleColor = () => {
    const next = COLORS[(COLORS.indexOf(noteData.color) + 1) % COLORS.length];
    updateNodeData(id, { color: next });
  };

  return (
    <CardShell id={id} className={`note-card sticky-${noteData.color}`}>
      <button className="color-dot nodrag" title="Farbe wechseln" onClick={cycleColor} />
      <div className="nodrag nowheel note-editor">
        <BlockNoteView
          editor={editor}
          theme="light"
          sideMenu={false}
          onChange={() => updateNodeData(id, { blocks: editor.document })}
        />
      </div>
    </CardShell>
  );
}
