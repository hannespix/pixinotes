// M445: Bestätigung für „Nach Themen ordnen" (lib/themenOrdnen.ts).
//
// Die KI schlägt vor, der Mensch entscheidet: Der Dialog zeigt jede Themengruppe mit Namen und den Karten darin.
// Namen lassen sich ändern, Gruppen abwählen (deren Karten bleiben dann liegen). Erst „Ordnen" ändert das Board.
// Der Dialog hängt sich selbst in die Seite (eigene Wurzel) – so braucht App.tsx keinen weiteren Zustand.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { selectActiveBoard, useBoard } from '../store';
import { nodeToText } from '../lib/serialize';
import type { ThemenGruppe, ThemenVorschlag } from '../lib/themenOrdnen';
import { IX } from './Icons';
import { zahlWort } from '../lib/sprache';

function kartenTitel(id: string): string {
  const n = selectActiveBoard(useBoard.getState()).nodes.find((k) => k.id === id);
  if (!n) return '';
  const t = nodeToText(n).split('\n').map((z) => z.trim()).find(Boolean) ?? '';
  return t.length > 48 ? `${t.slice(0, 47)}…` : t || (n.type ?? 'Karte');
}

function Dialog({ vorschlag, fertig }: { vorschlag: ThemenVorschlag; fertig: (g: ThemenGruppe[] | null) => void }) {
  const [gruppen, setGruppen] = useState(() => vorschlag.gruppen.map((g) => ({ ...g, an: true })));
  const ordnenRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    ordnenRef.current?.focus();
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fertig(null); } };
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
  }, [fertig]);
  const gewaehlt = gruppen.filter((g) => g.an);
  const anzahl = gewaehlt.reduce((a, g) => a + g.ids.length, 0);
  const ordnen = () => fertig(gewaehlt.map((g, i) => ({ titel: g.titel.trim() || `Thema ${i + 1}`, ids: g.ids })));
  return (
    <div className="modal-backdrop" onClick={() => fertig(null)}>
      <div className="modal themen-dialog" role="dialog" aria-modal="true" aria-label="Nach Themen ordnen" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Nach Themen ordnen</h2>
          <button className="modal-x" onClick={() => fertig(null)} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            <p className="modal-hint">
              {vorschlag.quelle === 'ki' ? 'Die KI schlägt diese Themen vor.' : 'Das Gehirn hat ähnliche Karten zusammengelegt.'}
            </p>
            <p className="modal-hint">Jede Gruppe wird ein beschrifteter Rahmen, die Karten liegen darin als Raster. Namen lassen sich hier ändern; abgewählte Gruppen bleiben liegen. Strg+Z stellt die alte Lage wieder her.</p>
            <ul className="themen-liste">
              {gruppen.map((g, i) => (
                <li key={i} className={g.an ? '' : 'aus'} data-thema={i}>
                  <label className="themen-kopf">
                    <input type="checkbox" checked={g.an} aria-label="Gruppe ordnen"
                      onChange={(e) => setGruppen((alt) => alt.map((x, k) => (k === i ? { ...x, an: e.target.checked } : x)))} />
                    <input type="text" className="themen-name" value={g.titel} maxLength={40} aria-label="Name des Rahmens" translate="no"
                      onChange={(e) => setGruppen((alt) => alt.map((x, k) => (k === i ? { ...x, titel: e.target.value } : x)))}
                      onKeyDown={(e) => { if (e.key === 'Enter') ordnen(); }} />
                    <span className="themen-zahl">{g.ids.length}</span>
                  </label>
                  <div className="themen-karten" translate="no">{g.ids.map(kartenTitel).filter(Boolean).join(' · ')}</div>
                </li>
              ))}
            </ul>
          </section>
          <section className="modal-section">
            <div className="modal-buttons">
              <button ref={ordnenRef} className="primaer" data-taste="themen-ordnen" disabled={!gewaehlt.length} onClick={ordnen}>
                {`${zahlWort(anzahl, 'Karte', 'Karten')} ordnen`}
              </button>
              <button data-taste="themen-abbrechen" onClick={() => fertig(null)}>Abbrechen</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Vorschlag zeigen; liefert die bestätigten Gruppen (mit geänderten Namen) oder null */
export function themenDialog(vorschlag: ThemenVorschlag): Promise<ThemenGruppe[] | null> {
  return new Promise((aufloesen) => {
    const ort = document.createElement('div');
    document.body.appendChild(ort);
    const wurzel = createRoot(ort);
    let zu = false;
    const fertig = (g: ThemenGruppe[] | null) => {
      if (zu) return;
      zu = true;
      setTimeout(() => { wurzel.unmount(); ort.remove(); }, 0);
      aufloesen(g);
    };
    wurzel.render(<Dialog vorschlag={vorschlag} fertig={fertig} />);
  });
}
