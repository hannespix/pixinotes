/**
 * M283: Die Rechen-Tabelle in der Notiz — hier nur der Block fürs Notiz-Schema.
 *
 * M502: Das Raster selbst (Rechnen, Links, Zellformate; RechenTabelleGitter.tsx, ~13 KB Quelltext) lädt mit der
 * ersten Tabelle, die gezeichnet wird, bzw. still im Leerlauf nach dem Start (App.tsx, `imLeerlaufVorladen`).
 * Bis es da ist, steht ein Platzhalter in Zeilen und Spalten der Tabelle — die Notiz springt nicht.
 */
import { lazy, Suspense } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { IPlus, ISigma, IX } from './Icons';

export const rechenTabelleLaden = () => import('./RechenTabelleGitter');
const GitterSpaet = lazy(() => rechenTabelleLaden().then((m) => ({ default: m.Gitter })));

/**
 * Gleiche Gestalt wie das Raster — Zeilen × Spalten aus denselben Bausteinen und die Leiste mit denselben Knöpfen
 * (noch ohne Wirkung), damit die Notiz beim Einhängen des Rasters nicht springt (Prüfreihe m502, C3)
 */
function Platzhalter({ spalten, zeilen }: { spalten: number; zeilen: number }) {
  return (
    <div className="rt-block rt-platzhalter" contentEditable={false} aria-busy="true">
      <div className="rt-roller">
        <table className="rt-tabelle" translate="no">
          <tbody>
            {Array.from({ length: zeilen }, (_, z) => (
              <tr key={z}>{Array.from({ length: spalten }, (_, s) => <td key={s} className="rt-zelle"><button type="button" className="rt-wert" tabIndex={-1} disabled>&#8203;</button></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rt-leiste" aria-hidden="true">
        <button type="button" disabled><IPlus size={12} /> Zeile</button>
        <button type="button" disabled><IPlus size={12} /> Spalte</button>
        <button type="button" disabled><IX size={11} /> Zeile</button>
        <button type="button" disabled><IX size={11} /> Spalte</button>
        <button type="button" className="rt-summe" disabled><ISigma size={12} /> Summe</button>
      </div>
      <div className="rt-hilfe">
        Rechnen mit „=" (z. B. <code>=SUMME(A1:A3)</code>) · Links als <code>[[Board]]</code>,
        <code>https://…</code> oder <code>[Text](Ziel)</code> · Doppelklick bearbeitet eine Zelle
      </div>
    </div>
  );
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
      const spalten = Math.max(1, Math.min(26, Number(p.spalten) || 3));
      const zeilen = Math.max(1, Math.min(200, Number(p.zeilen) || 3));
      return (
        <Suspense fallback={<Platzhalter spalten={spalten} zeilen={zeilen} />}>
          <GitterSpaet
            zellenRoh={p.zellen}
            stilRoh={p.stil}
            spalten={spalten}
            zeilen={zeilen}
            schreibe={(aenderung) => editor.updateBlock(block, { props: aenderung } as never)}
          />
        </Suspense>
      );
    },
  },
);
