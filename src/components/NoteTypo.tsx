// M201: Inline-Schrift & -Größe für MARKIERTEN Text in Notizen.
// BlockNote-Schema mit zwei Custom-Styles (textSize, textFont) + erweiterte
// Formatier-Leiste. Die Werte sind kuratierte Stufen (keine freien px) —
// einfach zu bedienen, barrierefrei (relativ, nie unter 0.85em) und stabil
// über Export/Sync, weil sie als benannte Stile in den Blöcken liegen.
import { BlockNoteSchema, defaultStyleSpecs } from '@blocknote/core';
import {
  createReactStyleSpec, FormattingToolbar, FormattingToolbarController,
  getFormattingToolbarItems, useBlockNoteEditor, useComponentsContext,
} from '@blocknote/react';
import type { CardFont } from '../types';
import { FONT_LABELS, FONT_STACKS, INLINE_SIZE_EM } from '../lib/typo';

const TextSize = createReactStyleSpec(
  { type: 'textSize', propSchema: 'string' },
  {
    render: (props) => (
      <span style={{ fontSize: INLINE_SIZE_EM[props.value] }} ref={props.contentRef} />
    ),
  },
);

const TextFont = createReactStyleSpec(
  { type: 'textFont', propSchema: 'string' },
  {
    render: (props) => (
      <span style={{ fontFamily: FONT_STACKS[props.value as CardFont] }} ref={props.contentRef} />
    ),
  },
);

/** Gemeinsames Schema aller Notiz-Editoren (NoteCard, Protokoll, Presenter) —
 *  damit gestylte Blöcke ÜBERALL valide sind und identisch rendern. */
export const noteSchema = BlockNoteSchema.create({
  styleSpecs: { ...defaultStyleSpecs, textSize: TextSize, textFont: TextFont },
});

const SIZES: Array<[string, string, string]> = [
  ['klein', 'A₋', 'Markierten Text kleiner (0,85×)'],
  ['gross', 'A₊', 'Markierten Text größer (1,3×)'],
  ['riesig', 'A₊₊', 'Markierten Text riesig (1,7×)'],
];
const FONTS: CardFont[] = ['serif', 'lesbar', 'hand', 'mono'];

/** Größen-/Schrift-Knöpfe in der Formatier-Leiste (nur bei Textauswahl sichtbar) */
function TypoButtons() {
  // Der Hook ist default-typisiert — auf unser Schema (mit textSize/textFont) heben
  const editor = useBlockNoteEditor() as unknown as typeof noteSchema.BlockNoteEditor;
  const Components = useComponentsContext()!;
  const active = editor.getActiveStyles() as { textSize?: string; textFont?: string };
  const toggleSize = (v: string) => {
    editor.focus();
    if (active.textSize === v) editor.removeStyles({ textSize: '' });
    else editor.addStyles({ textSize: v });
  };
  const cycleFont = () => {
    editor.focus();
    const cur = active.textFont as CardFont | undefined;
    const idx = cur ? FONTS.indexOf(cur) : -1;
    const next = FONTS[idx + 1];
    if (next) editor.addStyles({ textFont: next });
    else editor.removeStyles({ textFont: '' });
  };
  return (
    <>
      {SIZES.map(([val, label, tip]) => (
        <Components.FormattingToolbar.Button
          key={val}
          label={label}
          mainTooltip={tip}
          isSelected={active.textSize === val}
          onClick={() => toggleSize(val)}
        >
          {label}
        </Components.FormattingToolbar.Button>
      ))}
      <Components.FormattingToolbar.Button
        label="Aa"
        mainTooltip={active.textFont
          ? `Schrift: ${FONT_LABELS[active.textFont as CardFont] ?? active.textFont} — Klick wechselt weiter`
          : 'Schrift des markierten Texts wechseln (Serifen → Sehr gut lesbar → Handschrift → Monospace → Standard)'}
        isSelected={!!active.textFont}
        onClick={cycleFont}
      >
        Aa
      </Components.FormattingToolbar.Button>
    </>
  );
}

/** Formatier-Leiste = Standard-Knöpfe + Typo-Knöpfe (M201) */
export function NoteToolbar() {
  return (
    <FormattingToolbarController
      formattingToolbar={() => (
        <FormattingToolbar>
          {getFormattingToolbarItems()}
          <TypoButtons key="typo" />
        </FormattingToolbar>
      )}
    />
  );
}
