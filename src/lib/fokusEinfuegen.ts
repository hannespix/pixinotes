// M530: Strg+V im Karten-Fokus.
//
// Gemeldet in M521: Wer eine Karte geöffnet hatte (Fokus) und Strg+V drückte, ohne vorher in ihren Text zu klicken,
// bekam eine Notiz bzw. ein Bild HINTER der offenen Karte — mitten im Bild der Fläche, also unter der Karte, unsichtbar.
// Jetzt gilt: Was eingefügt wird, gehört der offenen Karte. Eine Notiz nimmt Text und Bilder am Ende ihres Texts auf —
// über ihren eigenen Editor (NoteCard.tsx `NOTIZ_EINFUEGEN`), damit Markdown, Bilder und gemeinsames Tippen (Yjs, M477)
// denselben Weg gehen wie ein Einfügen direkt im Text. Jede andere Karte nimmt nichts an: ein kurzer Hinweis, sonst
// passiert nichts. Nachgeladen — das Start-Paket trägt nur den Aufruf (Board.tsx).
import { selectActiveBoard, useBoard } from '../store';

/** Ereignis an den Editor einer Notiz: `detail = { id, daten }` */
export const NOTIZ_EINFUEGEN = 'pixinotes:notiz-einfuegen';

export function fokusEinfuegen(id: string, daten: DataTransfer): void {
  const st = useBoard.getState();
  const karte = selectActiveBoard(st).nodes.find((n) => n.id === id);
  if (!karte) return;
  if (karte.type === 'note') {
    const hatEditor = !!document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"] [contenteditable="true"]`);
    if (hatEditor) { window.dispatchEvent(new CustomEvent(NOTIZ_EINFUEGEN, { detail: { id, daten } })); return; }
    st.showToast('Diese Notiz lässt sich hier nur lesen – Einfügen geht nicht.');
    return;
  }
  st.showToast('In diese Karte lässt sich nichts einfügen. Esc schließt sie – dann landet Eingefügtes auf dem Board.');
}
