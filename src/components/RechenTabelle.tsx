/**
 * M283: EINE Tabelle — und die kann rechnen.
 *
 * Bis hierher gab es zwei: die Fließtext-Tabelle in der Notiz (fett, Farbe,
 * Links — aber stur) und die Rechen-Karte auf dem Board (rechnet — liegt aber
 * neben der Notiz statt darin). Wer eine Summe brauchte, musste die Tabelle
 * verlassen. Auf die Frage „dann hätten wir doch nur noch einen Tabellentyp,
 * den man direkt in die Notiz einfügt" gibt es keine gute Gegenrede.
 *
 * M256 hatte die Trennung so begründet: „In einer Notiz ist eine Tabellenzelle
 * ein Stück Fließtext … dort ein Rechenwerk einzuhängen hieße, jede
 * Texteingabe zu überwachen." Das Argument stimmt weiterhin — deshalb wird die
 * Fließtext-Zelle NICHT zum Rechnen überredet. Stattdessen zieht das Raster in
 * die Notiz: Ein Block, der aussieht wie eine Tabelle, sich anfühlt wie
 * Excel und die Formeln von `formel.ts` benutzt.
 *
 * Was in einer Zelle geht (ausdrücklicher Wunsch):
 *  · Rechnen   — „=SUMME(A1:A3)"; angezeigt wird das Ergebnis, beim
 *                Hineinklicken die Formel (Excel-Muster)
 *  · Fett und Ausrichtung, je Zelle
 *  · Zellfarben — auch als Ampel
 *  · Links     — [[Board oder Karte]] wie überall im Programm,
 *                http(s)://… und [Beschriftung](Ziel)
 *
 * Der Zellspeicher ist derselbe wie in der Rechen-KARTE („A1" → Rohtext).
 * Damit bleibt beides austauschbar, und der bestehende Rechner passt ohne
 * Umbau.
 */
import { useMemo, useRef, useState } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { indexZuAdresse, rechneBlatt, zeigeWert } from '../lib/formel';
import { resolveLink } from '../lib/links';
import { useBoard } from '../store';
import { IPlus, ISigma, IX } from './Icons';

/** Zellformat: fett, Ausrichtung, Hintergrund — je Zelladresse gemerkt */
export interface ZellStil {
  fett?: boolean;
  aus?: 'l' | 'm' | 'r';
  bg?: string;
}
type StilKarte = Record<string, ZellStil>;

/** Ampel-Farben plus ein paar ruhige Töne — mehr braucht eine Tabelle selten */
const FARBEN: Array<{ wert: string; name: string }> = [
  { wert: '', name: 'ohne Farbe' },
  { wert: '#d8f0d8', name: 'grün' },
  { wert: '#fdf0c8', name: 'gelb' },
  { wert: '#f8d8d8', name: 'rot' },
  { wert: '#dbe7f6', name: 'blau' },
  { wert: '#ece4f6', name: 'lila' },
  { wert: '#eeeae2', name: 'grau' },
];

/** JSON-Feld einer Blockeigenschaft lesen, ohne bei Murks umzukippen */
function leseKarte<T>(roh: unknown, standard: T): T {
  if (typeof roh !== 'string' || !roh.trim()) return standard;
  try {
    const w = JSON.parse(roh);
    return (w && typeof w === 'object' ? (w as T) : standard);
  } catch {
    return standard;
  }
}

/**
 * Ist der Zellinhalt ein Link? — dann wird er angeklickt statt gerechnet.
 *
 * Drei Schreibweisen, alle schon anderswo im Programm zu Hause:
 *   [[Kaiserstuhl]]            → Board oder Karte dieses Namens
 *   https://example.org        → Webseite
 *   [Beschriftung](Ziel)       → beides, mit eigenem Text
 */
export function deuteLink(roh: string): { text: string; ziel: string; extern: boolean } | null {
  const t = roh.trim();
  let m = /^\[([^\]]{1,80})\]\(([^)]{1,300})\)$/.exec(t);
  if (m) {
    const ziel = m[2].trim();
    return { text: m[1].trim(), ziel, extern: /^https?:\/\//i.test(ziel) };
  }
  m = /^\[\[([^[\]]{1,80})\]\]$/.exec(t);
  if (m) return { text: m[1].trim(), ziel: m[1].trim(), extern: false };
  if (/^https?:\/\/\S+$/i.test(t)) return { text: t, ziel: t, extern: true };
  return null;
}

interface GitterProps {
  zellenRoh: string;
  stilRoh: string;
  spalten: number;
  zeilen: number;
  schreibe: (aenderung: Partial<{ zellen: string; stil: string; spalten: number; zeilen: number }>) => void;
}

function Gitter({ zellenRoh, stilRoh, spalten, zeilen, schreibe }: GitterProps) {
  const zellen = useMemo(() => leseKarte<Record<string, string>>(zellenRoh, {}), [zellenRoh]);
  const stil = useMemo(() => leseKarte<StilKarte>(stilRoh, {}), [stilRoh]);
  /** Ein Durchgang für die ganze Tabelle — Zellen dürfen aufeinander zeigen */
  const werte = useMemo(() => rechneBlatt(zellen), [zellen]);

  const [aktiv, setAktiv] = useState<string | null>(null);   // angeklickte Zelle
  const [edit, setEdit] = useState<string | null>(null);     // Zelle in Bearbeitung
  const [entwurf, setEntwurf] = useState('');
  const eingabe = useRef<HTMLInputElement | null>(null);

  const boards = useBoard((s) => s.boards);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const showToast = useBoard((s) => s.showToast);

  const setzeZellen = (neu: Record<string, string>) => schreibe({ zellen: JSON.stringify(neu) });
  const setzeStil = (neu: StilKarte) => schreibe({ stil: JSON.stringify(neu) });

  const oeffne = (adr: string) => {
    setAktiv(adr);
    setEdit(adr);
    setEntwurf(zellen[adr] ?? '');
    requestAnimationFrame(() => eingabe.current?.select());
  };

  const uebernimm = (weiter?: 'runter' | 'rechts') => {
    if (!edit) return;
    const neu = { ...zellen };
    if (entwurf.trim() === '') delete neu[edit]; else neu[edit] = entwurf;
    setzeZellen(neu);
    const pos = adresseTeilen(edit);
    setEdit(null);
    if (!pos) return;
    if (weiter === 'runter' && pos.zeile + 1 < zeilen) oeffne(indexZuAdresse(pos.spalte, pos.zeile + 1));
    else if (weiter === 'rechts' && pos.spalte + 1 < spalten) oeffne(indexZuAdresse(pos.spalte + 1, pos.zeile));
  };

  /** Format der angeklickten Zelle ändern */
  const stilAendern = (aenderung: ZellStil) => {
    if (!aktiv) return;
    const neu = { ...stil, [aktiv]: { ...stil[aktiv], ...aenderung } };
    // leere Einträge nicht mitschleppen
    const s = neu[aktiv];
    if (!s.fett && !s.aus && !s.bg) delete neu[aktiv];
    setzeStil(neu);
  };

  /**
   * Auto-Summe: unter jede Spalte mit Zahlen eine Summenzeile setzen —
   * derselbe Griff wie in der Rechen-Karte (M256).
   */
  const autoSumme = () => {
    const neu = { ...zellen };
    let gesetzt = 0;
    for (let s = 0; s < spalten; s += 1) {
      let unten = 0;
      for (let z = zeilen; z >= 1; z -= 1) {
        const w = werte[indexZuAdresse(s, z - 1)];
        if (typeof w === 'number') { unten = z; break; }
        if (w !== null && w !== undefined && w !== '') break;
      }
      if (!unten) continue;
      let oben = unten;
      while (oben > 1 && typeof werte[indexZuAdresse(s, oben - 2)] === 'number') oben -= 1;
      if (unten - oben < 1) continue;              // eine einzelne Zahl summiert niemand
      const ziel = indexZuAdresse(s, unten);       // die Zeile darunter
      if (neu[ziel]) continue;                     // nichts überschreiben
      neu[ziel] = `=SUMME(${indexZuAdresse(s, oben - 1)}:${indexZuAdresse(s, unten - 1)})`;
      gesetzt += 1;
    }
    if (!gesetzt) { showToast('Keine Zahlenspalte gefunden, unter der eine Summe Platz hat.'); return; }
    if (unten0(zeilen, spalten, neu)) schreibe({ zeilen: zeilen + 1, zellen: JSON.stringify(neu) });
    else setzeZellen(neu);
  };

  const folgeLink = (ziel: string, extern: boolean) => {
    if (extern) { window.open(ziel, '_blank', 'noopener,noreferrer'); return; }
    const t = resolveLink(ziel, boards);
    if (t?.kind === 'board') openBoard(t.boardId);
    else if (t?.kind === 'card') { openBoard(t.boardId); focusNode(t.boardId, t.nodeId); }
    else showToast(`„${ziel}" gibt es (noch) nicht — Name prüfen oder Board anlegen.`);
  };

  const aktivStil = aktiv ? stil[aktiv] ?? {} : {};

  return (
    <div className="rt-block" contentEditable={false}>
      <div className="rt-roller">
        <table className="rt-tabelle">
          <tbody>
            {Array.from({ length: zeilen }, (_, z) => (
              <tr key={z}>
                {Array.from({ length: spalten }, (_, s) => {
                  const adr = indexZuAdresse(s, z);
                  const roh = zellen[adr] ?? '';
                  const st = stil[adr] ?? {};
                  const wert = werte[adr];
                  const link = deuteLink(roh);
                  const zahl = typeof wert === 'number';
                  const klassen = [
                    'rt-zelle',
                    aktiv === adr ? 'aktiv' : '',
                    st.fett ? 'fett' : '',
                    `aus-${st.aus ?? (zahl ? 'r' : 'l')}`,
                  ].filter(Boolean).join(' ');
                  return (
                    <td key={s} className={klassen} style={st.bg ? { background: st.bg } : undefined}>
                      {edit === adr ? (
                        <input
                          ref={eingabe}
                          className="rt-eingabe"
                          value={entwurf}
                          onChange={(e) => setEntwurf(e.target.value)}
                          onBlur={() => uebernimm()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') { e.preventDefault(); uebernimm('runter'); }
                            else if (e.key === 'Tab') { e.preventDefault(); uebernimm('rechts'); }
                            else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); }
                          }}
                        />
                      ) : link ? (
                        // Ein Link wird angeklickt, nicht gerechnet — der
                        // Stift daneben führt trotzdem zum Bearbeiten
                        <span className="rt-linkzelle">
                          <button
                            type="button"
                            className="rt-link"
                            title={link.extern ? link.ziel : `Zu „${link.ziel}" springen`}
                            onClick={() => folgeLink(link.ziel, link.extern)}
                          >
                            {link.extern ? '🔗' : '⧉'} {link.text}
                          </button>
                          <button
                            type="button"
                            className="rt-linkedit"
                            title="Zelle bearbeiten"
                            onClick={() => oeffne(adr)}
                          >✎</button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="rt-wert"
                          title={roh.startsWith('=') ? `${adr}: ${roh}` : adr}
                          onClick={() => setAktiv(adr)}
                          onDoubleClick={() => oeffne(adr)}
                          onFocus={() => setAktiv(adr)}
                        >
                          {zeigeWert(wert)}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rt-leiste">
        <button type="button" title="Zeile anhängen" onClick={() => schreibe({ zeilen: Math.min(200, zeilen + 1) })}><IPlus size={12} /> Zeile</button>
        <button type="button" title="Spalte anhängen" onClick={() => schreibe({ spalten: Math.min(26, spalten + 1) })}><IPlus size={12} /> Spalte</button>
        <button
          type="button"
          title="Letzte Zeile entfernen (Inhalte der Zeile gehen verloren)"
          disabled={zeilen <= 1}
          onClick={() => {
            const neu = { ...zellen };
            for (let s = 0; s < spalten; s += 1) delete neu[indexZuAdresse(s, zeilen - 1)];
            schreibe({ zeilen: zeilen - 1, zellen: JSON.stringify(neu) });
          }}
        ><IX size={11} /> Zeile</button>
        <button
          type="button"
          title="Letzte Spalte entfernen (Inhalte der Spalte gehen verloren)"
          disabled={spalten <= 1}
          onClick={() => {
            const neu = { ...zellen };
            for (let z = 0; z < zeilen; z += 1) delete neu[indexZuAdresse(spalten - 1, z)];
            schreibe({ spalten: spalten - 1, zellen: JSON.stringify(neu) });
          }}
        ><IX size={11} /> Spalte</button>
        <button type="button" className="rt-summe" title="Auto-Summe: unter jede Zahlenspalte eine Summe setzen" onClick={autoSumme}>
          <ISigma size={12} /> Summe
        </button>
        {aktiv && (
          <>
            <span className="rt-trenner" />
            <span className="rt-adr">{aktiv}</span>
            <button
              type="button"
              className={aktivStil.fett ? 'an' : ''}
              title="Fett"
              onClick={() => stilAendern({ fett: !aktivStil.fett })}
            ><b>F</b></button>
            {([['l', '⇤', 'linksbündig'], ['m', '≡', 'zentriert'], ['r', '⇥', 'rechtsbündig']] as const).map(([w, z, t]) => (
              <button
                key={w}
                type="button"
                className={aktivStil.aus === w ? 'an' : ''}
                title={`Ausrichtung ${t}`}
                onClick={() => stilAendern({ aus: aktivStil.aus === w ? undefined : w })}
              >{z}</button>
            ))}
            {FARBEN.map((f) => (
              <button
                key={f.wert || 'ohne'}
                type="button"
                className={`rt-farbe${f.wert === '' ? ' ohne' : ''}${(aktivStil.bg ?? '') === f.wert ? ' an' : ''}`}
                style={f.wert ? { background: f.wert } : undefined}
                title={`Zellfarbe ${f.name}`}
                onClick={() => stilAendern({ bg: f.wert || undefined })}
              />
            ))}
            <button type="button" title="Zelle bearbeiten (oder Doppelklick)" onClick={() => oeffne(aktiv)}>✎</button>
          </>
        )}
      </div>
      <div className="rt-hilfe">
        Rechnen mit „=" (z. B. <code>=SUMME(A1:A3)</code>) · Links als <code>[[Board]]</code>,
        <code>https://…</code> oder <code>[Text](Ziel)</code> · Doppelklick bearbeitet eine Zelle
      </div>
    </div>
  );
}

/** „B3" → { spalte: 1, zeile: 2 } */
function adresseTeilen(adr: string): { spalte: number; zeile: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(adr);
  if (!m) return null;
  let sp = 0;
  for (const c of m[1]) sp = sp * 26 + (c.charCodeAt(0) - 64);
  return { spalte: sp - 1, zeile: Number(m[2]) - 1 };
}

/** Braucht die Auto-Summe eine zusätzliche Zeile am Ende? */
function unten0(zeilen: number, spalten: number, zellen: Record<string, string>): boolean {
  for (let s = 0; s < spalten; s += 1) {
    if (zellen[indexZuAdresse(s, zeilen)]) return true;
  }
  return false;
}

/**
 * Der Block fürs Notiz-Schema.
 *
 * Die Eigenschaften sind einfache Zeichenketten und Zahlen — BlockNote
 * speichert nichts Verschachteltes. Zellen und Formate reisen deshalb als
 * JSON-Text; das ist auch für Sync und Export das Unkomplizierteste.
 */
export const RechenTabelleBlock = createReactBlockSpec(
  {
    type: 'rechentabelle',
    propSchema: {
      zellen: { default: '{}' },
      stil: { default: '{}' },
      spalten: { default: 3 },
      zeilen: { default: 3 },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => {
      const p = block.props as { zellen: string; stil: string; spalten: number; zeilen: number };
      return (
        <Gitter
          zellenRoh={p.zellen}
          stilRoh={p.stil}
          spalten={Math.max(1, Math.min(26, Number(p.spalten) || 3))}
          zeilen={Math.max(1, Math.min(200, Number(p.zeilen) || 3))}
          schreibe={(aenderung) => editor.updateBlock(block, { props: aenderung } as never)}
        />
      );
    },
  },
);
