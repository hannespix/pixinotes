// M530: Strg+V im Karten-Fokus.
//
// Gemeldet in M521: Wer eine Karte geöffnet hatte (Fokus) und Strg+V drückte, ohne vorher in ihren Text zu klicken,
// bekam eine Notiz bzw. ein Bild HINTER der offenen Karte — mitten im Bild der Fläche, also unter der Karte, unsichtbar.
// Jetzt gilt: Was eingefügt wird, gehört der offenen Karte. Eine Notiz nimmt Text und Bilder in einem eigenen Absatz am
// Ende ihres Texts auf — über ihren eigenen Editor (lib/notizEditoren.ts): ein paste-Ereignis an seinem Text, derselbe
// Weg wie Strg+V direkt im Text (Markdown, Bilder über uploadFile, gemeinsames Tippen über Yjs, M477). Jede andere Karte
// nimmt nichts an: ein kurzer Hinweis, sonst passiert nichts. Nachgeladen — das Start-Paket trägt nur den Aufruf
// (Board.tsx) und die Liste der Editoren.
import type { BlockNoteEditor } from '@blocknote/core';
import { selectActiveBoard, useBoard } from '../store';
import { notizEditoren } from './notizEditoren';

export function fokusEinfuegen(id: string, daten: DataTransfer): void {
  const st = useBoard.getState();
  const karte = selectActiveBoard(st).nodes.find((n) => n.id === id);
  if (!karte) return;
  if (karte.type !== 'note') {
    st.showToast('In diese Karte lässt sich nichts einfügen. Esc schließt sie – dann landet Eingefügtes auf dem Board.');
    return;
  }
  const editor = notizEditoren.get(id) as BlockNoteEditor | undefined;
  if (!editor || !editor.isEditable) { st.showToast('Diese Notiz lässt sich hier nur lesen – Einfügen geht nicht.'); return; }
  // in einen eigenen Absatz unter dem bisherigen Text (ein leerer letzter Absatz wird genommen)
  const letzter = editor.document[editor.document.length - 1];
  const leer = letzter?.type === 'paragraph' && Array.isArray(letzter.content) && letzter.content.length === 0;
  try {
    const ziel = !letzter || leer ? letzter : editor.insertBlocks([{ type: 'paragraph' }], letzter, 'after')[0];
    if (ziel) editor.setTextCursorPosition(ziel, 'end');
  } catch { /* Editor gerade im Umbau: dann an der Stelle, wo der Cursor steht */ }
  editor.focus();
  editor.domElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: daten, bubbles: true, cancelable: true }));
}
