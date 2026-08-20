// M201: Inline-Schrift & -Größe für MARKIERTEN Text in Notizen.
// BlockNote-Schema mit zwei Custom-Styles (textSize, textFont) + erweiterte
// Formatier-Leiste. Die Werte sind kuratierte Stufen (keine freien px) —
// einfach zu bedienen, barrierefrei (relativ, nie unter 0.85em) und stabil
// über Export/Sync, weil sie als benannte Stile in den Blöcken liegen.
//
// M267: Aus vier Knöpfen (A₋ A₊ A₊₊ Aa) werden drei — − ／ ＋ als Leiter DURCH
// Standard hindurch und ein „Aa"-Menü mit allen Stufen zum direkten Anspringen
// plus „Formatierung entfernen". Die Wörter und die Reihenfolge sind dieselben
// wie im Schrift-Menü der Karte (lib/typo.ts), damit man nicht zwei
// verschiedene Sprachen für dieselbe Sache lernen muss.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs, filterSuggestionItems } from '@blocknote/core';
import {
  createReactStyleSpec, FormattingToolbar, FormattingToolbarController,
  getDefaultReactSlashMenuItems, getFormattingToolbarItems, SuggestionMenuController,
  useBlockNoteEditor, useComponentsContext, useEditorContentOrSelectionChange,
} from '@blocknote/react';
import { RechenTabelleBlock } from './RechenTabelle';
import { IImage, ISigma } from './Icons';
import { useBoard } from '../store';
import { bilderAusZwischenablage, notizBildHochladen } from '../lib/notizBild';
import type { CardFont } from '../types';
import {
  FONT_STACKS, GROESSEN_TEXT, INLINE_SIZE_EM, SCHRIFTEN, stufenName, stufeWeiter,
} from '../lib/typo';

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
  /**
   * M283: Die Rechen-Tabelle ist ein Block wie jeder andere.
   *
   * Die alte `table` bleibt im Schema — bestehende Notizen sollen weiter
   * öffnen und drucken. Angeboten wird sie aber nicht mehr (siehe
   * NoteSlashMenu): Neu eingefügt wird ab jetzt die Tabelle, die rechnen kann.
   */
  blockSpecs: { ...defaultBlockSpecs, rechentabelle: RechenTabelleBlock },
  styleSpecs: { ...defaultStyleSpecs, textSize: TextSize, textFont: TextFont },
});

/** Größen-/Schrift-Knöpfe in der Formatier-Leiste (nur bei Textauswahl sichtbar) */
function TypoButtons() {
  // Der Hook ist default-typisiert — auf unser Schema (mit textSize/textFont) heben
  const editor = useBlockNoteEditor() as unknown as typeof noteSchema.BlockNoteEditor;
  const Components = useComponentsContext()!;
  /**
   * M267: Zwei Leisten an derselben Kartenoberkante.
   *
   * Die Karten-Leiste („1 ausgewählt · Kopieren · …") schwebt 14 Punkte über
   * der Karte, die Formatier-Leiste über der Textmarkierung — die liegt bei
   * einer Notiz meist in der ersten Zeile. Beide landeten übereinander, und
   * die vordere verdeckte die hintere zur Hälfte.
   *
   * Diese Komponente lebt genau so lange, wie die Formatier-Leiste im Bild
   * ist. Also meldet sie ihr Dasein am `body` an; das Stylesheet rückt die
   * Karten-Leiste dann aus dem Weg. Bewusst kein Store-Feld: Es geht um
   * reine Darstellung und würde sonst in jedem Undo-Schritt mitreisen.
   */
  useEffect(() => {
    document.body.dataset.formatierleiste = 'an';
    return () => { delete document.body.dataset.formatierleiste; };
  }, []);
  /**
   * M267: Die aktiven Stile werden ABONNIERT.
   *
   * Vorher standen sie in einer normalen Variablen, die nur beim Neuzeichnen
   * der Leiste neu gelesen wurde. Wer die Markierung von großem auf normalen
   * Text zog, sah weiter „groß" hervorgehoben — und die Knöpfe rechneten mit
   * dem falschen Ausgangswert.
   */
  const [aktiv, setAktiv] = useState<{ textSize?: string; textFont?: string }>(
    () => editor.getActiveStyles() as { textSize?: string; textFont?: string },
  );
  useEditorContentOrSelectionChange(
    () => setAktiv(editor.getActiveStyles() as { textSize?: string; textFont?: string }),
    editor as never,
  );

  const groesse = aktiv.textSize ?? null;
  const schrift = (aktiv.textFont as CardFont | undefined) ?? null;

  const setzeGroesse = (v: string | null) => {
    editor.focus();
    if (v) editor.addStyles({ textSize: v });
    else editor.removeStyles({ textSize: '' });
    setAktiv(editor.getActiveStyles() as { textSize?: string; textFont?: string });
  };
  const setzeSchrift = (v: CardFont | null) => {
    editor.focus();
    if (v) editor.addStyles({ textFont: v });
    else editor.removeStyles({ textFont: '' });
    setAktiv(editor.getActiveStyles() as { textSize?: string; textFont?: string });
  };
  /** Radiergummi: alles zurück auf Standard — fett, kursiv, Farbe, Größe, Schrift */
  const allesZurueck = () => {
    editor.focus();
    const alle = Object.fromEntries(Object.keys(editor.schema.styleSchema).map((k) => [k, true]));
    editor.removeStyles(alle as never);
    setAktiv(editor.getActiveStyles() as { textSize?: string; textFont?: string });
  };

  const kleiner = stufeWeiter(GROESSEN_TEXT, groesse, -1);
  const groesser = stufeWeiter(GROESSEN_TEXT, groesse, 1);
  const jetzt = stufenName(GROESSEN_TEXT, groesse);

  return (
    <>
      <Components.FormattingToolbar.Button
        className="bn-button"
        label="A−"
        mainTooltip={kleiner === undefined
          ? `Textgröße: ${jetzt} — kleiner geht nicht`
          : `Eine Stufe kleiner: ${jetzt} → ${stufenName(GROESSEN_TEXT, kleiner)}`}
        isDisabled={kleiner === undefined}
        onClick={() => kleiner !== undefined && setzeGroesse(kleiner)}
      >
        A−
      </Components.FormattingToolbar.Button>
      <Components.FormattingToolbar.Button
        className="bn-button"
        label="A+"
        mainTooltip={groesser === undefined
          ? `Textgröße: ${jetzt} — größer geht nicht`
          : `Eine Stufe größer: ${jetzt} → ${stufenName(GROESSEN_TEXT, groesser)}`}
        isDisabled={groesser === undefined}
        onClick={() => groesser !== undefined && setzeGroesse(groesser)}
      >
        A+
      </Components.FormattingToolbar.Button>
      <Components.Generic.Menu.Root>
        <Components.Generic.Menu.Trigger>
          <Components.FormattingToolbar.Button
            className="bn-button pn-typo-knopf"
            label="Aa"
            mainTooltip={`Schrift & Größe des markierten Texts — jetzt: ${jetzt}${schrift ? `, ${stufenName(SCHRIFTEN, schrift)}` : ''}`}
            isSelected={!!groesse || !!schrift}
          >
            Aa
          </Components.FormattingToolbar.Button>
        </Components.Generic.Menu.Trigger>
        <Components.Generic.Menu.Dropdown className="bn-menu-dropdown pn-typo-menu">
          <Components.Generic.Menu.Label>Textgröße</Components.Generic.Menu.Label>
          {GROESSEN_TEXT.map((s) => (
            <Components.Generic.Menu.Item
              key={s.label}
              checked={groesse === s.wert}
              onClick={() => setzeGroesse(s.wert)}
            >
              {s.label}
            </Components.Generic.Menu.Item>
          ))}
          <Components.Generic.Menu.Divider />
          <Components.Generic.Menu.Label>Schriftart</Components.Generic.Menu.Label>
          {SCHRIFTEN.map((s) => (
            <Components.Generic.Menu.Item
              key={s.label}
              checked={schrift === s.wert}
              onClick={() => setzeSchrift(s.wert)}
            >
              <span style={s.wert ? { fontFamily: FONT_STACKS[s.wert] } : undefined}>{s.label}</span>
            </Components.Generic.Menu.Item>
          ))}
          <Components.Generic.Menu.Divider />
          <Components.Generic.Menu.Item onClick={allesZurueck}>
            Formatierung entfernen
          </Components.Generic.Menu.Item>
        </Components.Generic.Menu.Dropdown>
      </Components.Generic.Menu.Root>
    </>
  );
}

/**
 * M277: Am Telefon dockt die Formatier-Leiste als PORTAL am `body` an.
 *
 * Die M226-Regel setzt die schwebende Leiste per CSS auf `position: fixed`
 * unten über die Tastatur. Das funktionierte nur im Fokus. Auf BOARD-Ebene
 * steckt die Leiste im React-Flow-Knoten, und dessen `transform` macht die
 * Karte zum Bezugsrahmen von `fixed` — gemessen am Telefon: Die Leiste war
 * exakt kartenbreit (280 statt 390 Punkte) und klebte mitten im Bild an der
 * Karte statt unten am Schirm. Dazu skaliert der Board-Zoom sie mit.
 *
 * CSS kann einem transform-Bezugsrahmen nicht entkommen — also verlässt die
 * Leiste den Knoten: Am Telefon rendert sie als Portal direkt am `body`.
 * Dieselbe M226-Regel (`div:has(> .bn-formatting-toolbar)`) greift weiter
 * und meint nun wirklich den Schirm. Sichtbar ist sie wie bisher genau
 * solange, wie Text markiert ist.
 */
const TELEFON_ABFRAGE = '(max-width: 700px), ((pointer: coarse) and (max-width: 900px))';

function PhoneFormatDock() {
  const editor = useBlockNoteEditor() as unknown as typeof noteSchema.BlockNoteEditor;
  const [auswahl, setAuswahl] = useState(false);
  useEditorContentOrSelectionChange(
    () => {
      let txt = '';
      try { txt = editor.getSelectedText(); } catch { txt = ''; }
      setAuswahl(txt.length > 0);
    },
    editor as never,
  );
  /**
   * ProseMirror behält seine Auswahl auch ohne Fokus — wer aufs Board tippt,
   * hätte die Leiste sonst dauerhaft im Bild. Ein Tipp außerhalb von Editor,
   * Leiste und ihren Menüs (das Aa-Menü lebt als eigenes Portal) blendet aus.
   */
  useEffect(() => {
    if (!auswahl) return;
    const dom = (editor as unknown as { domElement?: Element }).domElement ?? null;
    const pruef = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest) return;
      if (t.closest('.pn-format-dock, .bn-menu-dropdown, [class*="mantine-Menu"], .mantine-Popover-dropdown')) return;
      if (dom && dom.contains(t)) return;
      setAuswahl(false);
    };
    window.addEventListener('pointerdown', pruef, true);
    return () => window.removeEventListener('pointerdown', pruef, true);
  }, [auswahl, editor]);
  if (!auswahl) return null;
  return createPortal(
    <div className="pn-format-dock nodrag">
      <FormattingToolbar>
        {getFormattingToolbarItems()}
        <TypoButtons key="typo" />
      </FormattingToolbar>
    </div>,
    document.body,
  );
}

/**
 * M283: Das Einfügen-Menü („/") bietet EINE Tabelle an — die rechnende.
 *
 * Der Eintrag der alten Fließtext-Tabelle fällt heraus. Nicht, weil sie
 * schlecht wäre, sondern weil zwei Tabellentypen im selben Menü genau die
 * Frage aufwerfen, die niemand beantworten will: „Welche nehme ich jetzt?"
 * Bestehende Tabellen bleiben unberührt und lassen sich in der Notiz per
 * Knopf umwandeln (NoteCard).
 */
export function NoteSlashMenu() {
  const editor = useBlockNoteEditor() as unknown as typeof noteSchema.BlockNoteEditor;
  return (
    <SuggestionMenuController
      triggerCharacter="/"
      getItems={async (query) => {
        const standard = getDefaultReactSlashMenuItems(editor as never)
          // die alte Tabelle aus dem Angebot nehmen (Titel je nach Sprache)
          .filter((i) => !/^(tabelle|table)$/i.test(i.title ?? ''))
          /**
           * M289: Bild JA, Video/Ton/Datei NEIN.
           *
           * Seit die Editoren Dateien annehmen (uploadFile), böte BlockNote
           * auch Video, Audio und beliebige Dateien an. Die steckten dann als
           * Base64 IM Text — ein einziges Handyvideo sprengt den Speicher der
           * Anwendung (~5 MB) und reißt den ganzen Board-Stand mit. Für alles
           * außer Bildern gibt es die Datei-Karte auf dem Board (Geräte-Ablage,
           * M269). Gefiltert wird über den sprachunabhängigen Schlüssel.
           *
           * Aus dem SCHEMA werden sie bewusst NICHT entfernt: BlockNote greift
           * beim Einfügen intern auf diese Blöcke zu und stolpert sonst
           * (gemessen: „Cannot read properties of undefined (reading
           * 'isInGroup')"). Den Weg dorthin sperrt stattdessen `nurBilder`
           * unten — vor dem Editor, nicht in ihm.
           */
          .filter((i) => !['video', 'audio', 'file'].includes((i as { key?: string }).key ?? ''));
        const eigene = [{
          title: 'Bild aus Zwischenablage',
          subtext: 'Screenshot oder kopiertes Foto direkt in den Text',
          aliases: ['bild', 'foto', 'zwischenablage', 'einfügen', 'screenshot', 'paste', 'clipboard'],
          group: 'Medien',
          icon: <IImage size={16} />,
          onItemClick: () => { void ausZwischenablageInDenText(editor); },
        }, {
          title: 'Tabelle',
          subtext: 'Rechnet mit „=" — Summen, Prozente, Bedingungen',
          aliases: ['tabelle', 'table', 'rechnen', 'summe', 'excel', 'kalkulation'],
          group: 'Basisblöcke',
          icon: <ISigma size={16} />,
          onItemClick: () => {
            const block = editor.getTextCursorPosition().block;
            editor.insertBlocks(
              [{ type: 'rechentabelle', props: { zellen: '{}', stil: '{}', spalten: 3, zeilen: 3 } } as never],
              block,
              'after',
            );
          },
        }];
        return filterSuggestionItems([...eigene, ...standard], query);
      }}
    />
  );
}

/**
 * M289: Wächter vor dem Editor — nur Bilder dürfen in den Text.
 *
 * Fängt Einfügen und Ablegen in der Erfassungsphase ab und lässt Dateien nur
 * durch, wenn es Bilder sind. Alles andere (PDF, Word, Tabellen, Videos) wird
 * gestoppt, bevor BlockNote es sieht:
 *  - beim EINFÜGEN mit einem Hinweis, wo solche Dateien hingehören,
 *  - beim ABLEGEN wortlos, weil das Board darunter genau dafür schon eine
 *    Datei-Karte anlegt — dort ist die Datei richtig aufgehoben.
 */
export function useNurBilderInDenText(
  ref: React.RefObject<HTMLElement | null>,
  /** Was mit abgelegten Nicht-Bildern geschehen soll (Datei-Karte aufs Board) */
  aufsBoard?: (dateien: File[], x: number, y: number) => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pruefe = (dt: DataTransfer | null): 'egal' | 'stopp' => {
      const dateien = Array.from(dt?.files ?? []);
      if (dateien.length === 0) return 'egal';       // Text, HTML, Bild-Rohdaten
      return dateien.every((f) => f.type.startsWith('image/')) ? 'egal' : 'stopp';
    };
    const beimEinfuegen = (e: ClipboardEvent) => {
      if (pruefe(e.clipboardData) === 'egal') return;
      e.preventDefault();
      e.stopPropagation();
      useBoard.getState().showToast('In eine Notiz passen Bilder. Andere Dateien aufs Board ziehen — sie werden dort eine Datei-Karte.');
    };
    const beimAblegen = (e: DragEvent) => {
      if (pruefe(e.dataTransfer) === 'egal') return;
      /* Die Datei gehört aufs Board — aber der Weg dorthin läuft NICHT über
         „einfach weiterreichen": `stopPropagation` hier hält das Ereignis
         zwangsläufig auch von der Board-Ebene fern (es hört in der Blasenphase
         zu). Die Notiz übergibt deshalb selbst — an derselben Stelle, an der
         der Finger losgelassen hat. */
      e.preventDefault();
      e.stopPropagation();
      const dateien = Array.from(e.dataTransfer?.files ?? []);
      if (dateien.length) aufsBoard?.(dateien, e.clientX, e.clientY);
    };
    el.addEventListener('paste', beimEinfuegen, true);
    el.addEventListener('drop', beimAblegen, true);
    return () => {
      el.removeEventListener('paste', beimEinfuegen, true);
      el.removeEventListener('drop', beimAblegen, true);
    };
  }, [ref, aufsBoard]);
}

/**
 * M289: Ein kopiertes Bild an die Cursor-Stelle setzen.
 *
 * Der Weg für alles ohne Tastatur: Am iPhone/iPad tippt man in der Fotos-App
 * auf „Kopieren" und hier auf den Eintrag. Verweigert der Browser die
 * Zwischenablage (Firefox, fehlende Erlaubnis), bleibt es nicht bei einer
 * Fehlermeldung — dann öffnet sich der Dateiwähler, der am Telefon direkt in
 * die Fotomediathek führt.
 */
async function ausZwischenablageInDenText(editor: typeof noteSchema.BlockNoteEditor) {
  const dateien = await bilderAusZwischenablage();
  if (dateien !== 'verweigert' && dateien.length > 0) {
    for (const f of dateien) await bildBlockEinfuegen(editor, f);
    return;
  }
  if (dateien !== 'verweigert') {
    useBoard.getState().showToast('In der Zwischenablage liegt gerade kein Bild.');
    return;
  }
  waehleBildDatei((f) => { void bildBlockEinfuegen(editor, f); });
}

/** Dateiwähler öffnen — am Telefon die Fotomediathek bzw. die Kamera */
export function waehleBildDatei(nimm: (f: File) => void) {
  const feld = document.createElement('input');
  feld.type = 'file';
  feld.accept = 'image/*';
  feld.multiple = true;
  feld.style.display = 'none';
  feld.onchange = () => {
    for (const f of Array.from(feld.files ?? [])) nimm(f);
    feld.remove();
  };
  document.body.appendChild(feld);
  feld.click();
}

/** Bild hochladen (verkleinern, Speicher prüfen) und als Block setzen */
export async function bildBlockEinfuegen(editor: typeof noteSchema.BlockNoteEditor, datei: File) {
  let url: string;
  try {
    url = await notizBildHochladen(datei);
  } catch {
    return;   // notizBildHochladen hat den Grund bereits gesagt
  }
  const block = editor.getTextCursorPosition().block;
  editor.insertBlocks(
    [{ type: 'image', props: { url, name: datei.name || 'Bild' } } as never],
    block,
    'after',
  );
}

/** Formatier-Leiste = Standard-Knöpfe + Typo-Knöpfe (M201) */
export function NoteToolbar() {
  // Dieselbe Abfrage wie die M226-CSS-Regel — beide müssen sich einig sein,
  // wer die Leiste unten andockt
  const [telefon, setTelefon] = useState(() => window.matchMedia(TELEFON_ABFRAGE).matches);
  useEffect(() => {
    const mq = window.matchMedia(TELEFON_ABFRAGE);
    const auf = () => setTelefon(mq.matches);
    mq.addEventListener('change', auf);
    return () => mq.removeEventListener('change', auf);
  }, []);
  if (telefon) return <PhoneFormatDock />;
  return (
    <FormattingToolbarController
      /**
       * M267: Die Leiste wird am Kartenrand ABGESCHNITTEN.
       *
       * Gemessen an einer 300 Punkte breiten Notiz: Die Leiste ist 601 Punkte
       * breit, die Karte kappt bei 300 — gut die Hälfte lag unsichtbar hinter
       * dem Rand, und ausgerechnet die hinteren Knöpfe (Größe, Schrift, Link)
       * waren nicht einmal anklickbar. Wer den Text größer gemacht hatte, fand
       * den Weg zurück also nicht, weil der Knopf dafür gar nicht auf dem
       * Schirm war. Das ist der harte Kern von „nicht zurück auf standart".
       *
       * Ursache ist `overflow: hidden` an `.card-body` — nötig, damit
       * Karteninhalt nicht über die abgerundeten Ecken hinausquillt. Statt das
       * aufzugeben, wird die schwebende Leiste `fixed` gesetzt: Ihr
       * Bezugsrahmen ist dann der Knoten-Container (er trägt ein transform),
       * die Karte liegt gar nicht mehr in der Kette — und kann nichts mehr
       * abschneiden. Die Platzierung an der Auswahl rechnet floating-ui
       * unverändert weiter.
       *
       * Am Telefon greift zusätzlich M226 (angedockt über der Tastatur, quer
       * scrollbar) — die Regel dort setzt ihre eigenen Werte und bleibt
       * unberührt.
       */
      floatingOptions={{ strategy: 'fixed' }}
      formattingToolbar={() => (
        <FormattingToolbar>
          {getFormattingToolbarItems()}
          <TypoButtons key="typo" />
        </FormattingToolbar>
      )}
    />
  );
}
