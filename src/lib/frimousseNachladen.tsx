/**
 * M462: Die Emoji-Auswahl von BlockNote 0.57 (frimousse) nachladen statt im Start mitzuschleppen.
 *
 * `@blocknote/react` importiert `EmojiPicker` und `useSkinTone` aus „frimousse" STATISCH — die
 * Bibliothek (rund 27 KB) landete so im Editor-Paket, das jeder Start lädt, obwohl die Auswahl nur
 * beim Einfügen eines Emojis aufgeht. BlockNote 0.31 lud seine Emoji-Auswahl (emoji-mart) selbst
 * per import() nach. vite.config.ts (`frimousseNachladen()`) lenkt „frimousse" für alle anderen
 * Module hierher; diese Datei lädt das echte Paket beim ersten Öffnen der Auswahl.
 *
 * Alle Teile (Root, Search, List …) gehören zu EINEM Modul, damit ihr gemeinsamer Kontext stimmt.
 * Nur `Root` kann warten (eigene Suspense-Grenze) — alle anderen Teile und `useSkinTone` werden
 * ausschließlich INNERHALB von Root gezeichnet, also erst, wenn das Paket da ist.
 */
import { createElement, forwardRef, Suspense, type ComponentType } from 'react';
import type * as Frimousse from 'frimousse';

type Modul = typeof Frimousse;
let echt: Modul | null = null;
let laden: Promise<void> | null = null;
const holen = (): Promise<void> => (laden ??= import('frimousse').then((m) => { echt = m; }));

type Teil = keyof Modul['EmojiPicker'];

/** Ein Teil der Auswahl: zeichnet das echte Gegenstück; fehlt das Paket noch, wartet es (Suspense). */
function teil(name: Teil) {
  const Innen = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    if (!echt) throw holen();
    const K = echt.EmojiPicker[name] as unknown as ComponentType<Record<string, unknown>>;
    return createElement(K, { ...props, ref });
  });
  Innen.displayName = `EmojiPicker.${String(name)}`;
  return Innen;
}

const RootInnen = teil('Root');
const Root = forwardRef<unknown, Record<string, unknown>>((props, ref) =>
  createElement(Suspense, { fallback: null }, createElement(RootInnen, { ...props, ref })));
Root.displayName = 'EmojiPicker.Root';

export const EmojiPicker = {
  Root,
  Search: teil('Search'),
  Viewport: teil('Viewport'),
  List: teil('List'),
  Loading: teil('Loading'),
  Empty: teil('Empty'),
  SkinToneSelector: teil('SkinToneSelector'),
  ActiveEmoji: teil('ActiveEmoji'),
  SkinTone: teil('SkinTone'),
} as unknown as Modul['EmojiPicker'];

/** Nur innerhalb von Root aufgerufen (dann ist das Paket geladen); sonst neutraler Hautton. */
export const useSkinTone: Modul['useSkinTone'] = (...args) =>
  (echt ? echt.useSkinTone(...args) : ['none', () => undefined, []]) as ReturnType<Modul['useSkinTone']>;
