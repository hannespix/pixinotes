import { useEffect } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';

/**
 * Android-Rücktasten-Fix (M110): Die Bildschirmtastatur sendet für die
 * Rücktaste keine echten "Backspace"-Keydown-Events (nur IME-Keycode 229 +
 * beforeinput "deleteContentBackward"). Damit läuft die gesamte
 * Tastatur-Sonderlogik von BlockNote/ProseMirror an BLOCKGRENZEN ins Leere:
 * Zeichen löschen geht (DOM-Abgleich), aber ein leerer Checklisten-/Listen-
 * Eintrag lässt sich nicht entfernen und Blöcke verschmelzen nicht —
 * die „Bubble" hängt fest.
 *
 * Lösung: beforeinput abfangen und NUR wenn der Cursor am Blockanfang steht
 * (der einzige kaputte Fall — mitten im Text funktioniert das native Löschen)
 * die reguläre Backspace-Keymap der Bibliothek programmatisch abspielen.
 * Am Desktop feuert in diesem Fall gar kein beforeinput (die Keymap fängt
 * das Keydown vorher ab) — der Hook ändert dort also nichts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useAndroidBackspaceFix(editor: BlockNoteEditor<any, any, any>) {
  useEffect(() => {
    let dom: HTMLElement | null = null;
    let tries = 0;
    const handler = (e: Event) => {
      const ie = e as InputEvent;
      if (ie.inputType !== 'deleteContentBackward') return;
      const view = editor.prosemirrorView;
      if (!view) return;
      const sel = view.state.selection;
      // Nur am Blockanfang eingreifen — alles andere kann die native
      // Bearbeitung selbst (und IME-Kompositionen bleiben ungestört)
      if (!sel.empty || sel.$from.parentOffset !== 0) return;
      const kb = new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true, cancelable: true });
      const handled = view.someProp('handleKeyDown', (f) => f(view, kb));
      if (handled) {
        ie.preventDefault();
        ie.stopPropagation();
      }
    };
    // Die ProseMirror-View existiert erst, wenn BlockNoteView gemountet ist
    const timer = window.setInterval(() => {
      const v = editor.prosemirrorView;
      if (v?.dom) {
        dom = v.dom as HTMLElement;
        dom.addEventListener('beforeinput', handler, true);
        window.clearInterval(timer);
      } else if ((tries += 1) > 50) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => {
      window.clearInterval(timer);
      dom?.removeEventListener('beforeinput', handler, true);
    };
  }, [editor]);
}
