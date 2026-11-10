// M338: Die ruhende Notiz — derselbe Inhalt wie im Editor, als schlichtes HTML.
//
// Die Struktur ist bewusst eins zu eins die des Editors (bn-block-group →
// bn-block-outer → bn-block → bn-block-content → Inline-Inhalt), mit denselben
// Klassen und Datenattributen. So greift dasselbe CSS, und die Karte ändert
// beim Aufwachen des Editors weder Höhe noch Umbruch. Die Handschrift liest
// Blöcke über `.bn-block[data-id]` — auch das bleibt gültig.
import { Fragment, memo, type ReactNode } from 'react';
import { pfadId, type RuheBlock, type RuheInline } from '../../lib/notizRuhend';

function auszeichnen(text: string, stile: Record<string, unknown> | undefined, key: number): ReactNode {
  let k: ReactNode = text;
  const s = stile ?? {};
  if (s.code) k = <code>{k}</code>;
  if (s.strike) k = <s>{k}</s>;
  if (s.underline) k = <u>{k}</u>;
  if (s.italic) k = <em>{k}</em>;
  if (s.bold) k = <strong>{k}</strong>;
  if (typeof s.textColor === 'string' && s.textColor !== 'default') k = <span data-text-color={s.textColor}>{k}</span>;
  if (typeof s.backgroundColor === 'string' && s.backgroundColor !== 'default') k = <span data-background-color={s.backgroundColor}>{k}</span>;
  return <Fragment key={key}>{k}</Fragment>;
}

function inline(c: unknown): ReactNode {
  if (c == null || c === '' || (Array.isArray(c) && c.length === 0)) return <br className="ProseMirror-trailingBreak" />;
  if (typeof c === 'string') return c;
  return (c as RuheInline[]).map((t, i) => (t.type === 'link'
    ? <a key={i} target="_blank" rel="noopener noreferrer nofollow" href={t.href} onClick={(e) => e.preventDefault()}>{t.content.map((x, j) => auszeichnen(x.text, x.styles, j))}</a>
    : auszeichnen(t.text, t.styles, i)));
}

const farbe = (v: unknown): string | undefined => (typeof v === 'string' && v !== 'default' ? v : undefined);

function Gruppe({ blocks, pfad, onHaken }: { blocks: RuheBlock[]; pfad: number[]; onHaken: (pfad: number[], an: boolean) => void }) {
  let nummer = 0;
  return (
    <div className="bn-block-group" data-node-type="blockGroup">
      {blocks.map((b, i) => {
        const p = b.props ?? {};
        // Nummerierung wie im Editor: fortlaufend über benachbarte Nummern-Punkte, `start` setzt den Anfang
        if (b.type === 'numberedListItem') nummer = nummer === 0 ? (typeof p.start === 'number' ? p.start : 1) : nummer + 1;
        else nummer = 0;
        const tc = farbe(p.textColor); const bc = farbe(p.backgroundColor);
        const ausrichtung = typeof p.textAlignment === 'string' && p.textAlignment !== 'left' ? p.textAlignment : undefined;
        const hier = [...pfad, i];
        const id = b.id ?? pfadId(hier);
        let innen: ReactNode;
        if (b.type === 'heading') {
          const H = (`h${p.level === 1 || p.level === 2 || p.level === 3 ? p.level : 1}`) as 'h1' | 'h2' | 'h3';
          innen = <H className="bn-inline-content">{inline(b.content)}</H>;
        } else if (b.type === 'quote') {
          innen = <blockquote className="bn-inline-content">{inline(b.content)}</blockquote>;
        } else if (b.type === 'checkListItem') {
          innen = (
            <div>
              <div contentEditable={false} suppressContentEditableWarning>
                <input type="checkbox" checked={p.checked === true} aria-labelledby={`label-${id}`}
                  onChange={(e) => onHaken(hier, e.target.checked)} onClick={(e) => e.stopPropagation()} />
              </div>
              <p className="bn-inline-content" id={`label-${id}`}>{inline(b.content)}</p>
            </div>
          );
        } else {
          innen = <p className="bn-inline-content">{inline(b.content)}</p>;
        }
        return (
          <div key={id} className="bn-block-outer" data-node-type="blockOuter" data-id={id} data-text-color={tc} data-background-color={bc}>
            <div className="bn-block" data-node-type="blockContainer" data-id={id} data-text-color={tc} data-background-color={bc}>
              <div className="bn-block-content" data-content-type={b.type}
                data-level={b.type === 'heading' ? (p.level === 2 || p.level === 3 ? p.level : 1) : undefined}
                data-index={b.type === 'numberedListItem' ? nummer : undefined}
                data-checked={b.type === 'checkListItem' && p.checked === true ? 'true' : undefined}
                data-text-alignment={ausrichtung}>
                {innen}
              </div>
              {b.children?.length ? <Gruppe blocks={b.children} pfad={hier} onHaken={onHaken} /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Der Editor hängt nach der ERSTEN Änderung einen leeren Schluss-Absatz an. Bei Notizen mit
 * Nummern-Listen passiert diese „Änderung" schon beim Aufbau (die Nummern werden gesetzt) —
 * die ruhende Ansicht zeigt den Absatz dann ebenfalls, sonst spränge die Karte beim Wecken um eine Zeile.
 */
const hatNummern = (bs: RuheBlock[]): boolean => bs.some((b) => b.type === 'numberedListItem' || (b.children?.length ? hatNummern(b.children) : false));
const leer = (c: unknown): boolean => c == null || c === '' || (Array.isArray(c) && c.length === 0);
const SCHLUSS: RuheBlock = { id: 'r-schluss', type: 'paragraph', content: [] };

export const NotizRuhend = memo(function NotizRuhend({ blocks: roh, onHaken }: { blocks: RuheBlock[]; onHaken: (pfad: number[], an: boolean) => void }) {
  const letzter = roh[roh.length - 1];
  const blocks = hatNummern(roh) && !(letzter && leer(letzter.content) && !letzter.children?.length) ? [...roh, SCHLUSS] : roh;
  return (
    <div className="bn-container light bn-mantine notiz-ruhend" data-color-scheme="light" data-mantine-color-scheme="light">
      <div className="ProseMirror bn-editor bn-default-styles" translate="no">
        <Gruppe blocks={blocks} pfad={[]} onHaken={onHaken} />
      </div>
    </div>
  );
});
