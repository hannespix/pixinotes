import { useEffect, useMemo, useRef, useState } from 'react';
import { useBoard } from '../store';
import { IX } from './Icons';

/**
 * M398: Ein Projekt oder einen Bereich löschen, in dem noch Boards liegen.
 *
 * Vorher hieß es „erst verschieben oder löschen" – bei zehn Boards zehnmal öffnen, löschen, bestätigen.
 * Jetzt fragt EIN Dialog, was mit den Boards geschehen soll: mit löschen oder behalten und umziehen.
 * Er zeigt, was betroffen ist; danach lässt sich alles über „Rückgängig" in der Meldung zurückholen.
 * Leere Projekte und Bereiche brauchen den Dialog nicht (siehe ebeneLoeschenFragen).
 */
export const EBENE_LOESCHEN = 'pixinotes:ebene-loeschen';
export interface EbeneWunsch { art: 'projekt' | 'bereich'; id: string }

/** Der eine Einstieg für alle Menüs: leer → sofort weg (mit „Rückgängig"), sonst der Dialog */
export function ebeneLoeschenFragen(art: EbeneWunsch['art'], id: string): void {
  const s = useBoard.getState();
  const bereich = art === 'bereich' ? s.spaces.find((sp) => sp.id === id) : undefined;
  const projekt = art === 'projekt' ? s.spaces.flatMap((sp) => sp.projects).find((p) => p.id === id) : undefined;
  const boards = bereich ? bereich.projects.reduce((n, p) => n + p.boardIds.length, 0) : projekt?.boardIds.length ?? 0;
  if (boards === 0) { if (art === 'bereich') s.removeSpace(id); else s.removeProject(id); return; }
  window.dispatchEvent(new CustomEvent<EbeneWunsch>(EBENE_LOESCHEN, { detail: { art, id } }));
}

export function EbeneLoeschenHost() {
  const [wunsch, setWunsch] = useState<EbeneWunsch | null>(null);
  useEffect(() => {
    const auf = (e: Event) => setWunsch((e as CustomEvent<EbeneWunsch>).detail ?? null);
    window.addEventListener(EBENE_LOESCHEN, auf);
    return () => window.removeEventListener(EBENE_LOESCHEN, auf);
  }, []);
  return wunsch ? <EbeneLoeschenDialog wunsch={wunsch} onClose={() => setWunsch(null)} /> : null;
}

function EbeneLoeschenDialog({ wunsch, onClose }: { wunsch: EbeneWunsch; onClose: () => void }) {
  const spaces = useBoard((s) => s.spaces);
  const alleBoards = useBoard((s) => s.boards);
  const { art, id } = wunsch;
  const bereich = art === 'bereich' ? spaces.find((sp) => sp.id === id) : spaces.find((sp) => sp.projects.some((p) => p.id === id));
  const projekt = art === 'projekt' ? bereich?.projects.find((p) => p.id === id) : undefined;
  const projekte = useMemo(() => (art === 'bereich' ? bereich?.projects ?? [] : projekt ? [projekt] : []), [art, bereich, projekt]);
  const boards = useMemo(
    () => projekte.flatMap((p) => p.boardIds.map((b) => alleBoards.find((x) => x.id === b)).filter((b): b is NonNullable<typeof b> => !!b)),
    [projekte, alleBoards],
  );
  // Wohin die Boards umziehen können: jedes andere Projekt (beim Bereich: jeder andere Bereich)
  const ziele = useMemo(() => (art === 'bereich'
    ? spaces.filter((sp) => sp.id !== id).map((sp) => ({ id: sp.id, name: sp.name, gruppe: '' }))
    : spaces.flatMap((sp) => sp.projects.filter((p) => p.id !== id).map((p) => ({ id: p.id, name: p.name, gruppe: sp.name })))),
  [art, id, spaces]);
  const [weise, setWeise] = useState<'loeschen' | 'behalten'>('loeschen');
  const [ziel, setZiel] = useState('');
  const zielId = ziele.some((z) => z.id === ziel) ? ziel : ziele[0]?.id ?? '';
  const knopf = useRef<HTMLButtonElement>(null);
  useEffect(() => { knopf.current?.focus(); }, []);
  useEffect(() => {
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
  }, [onClose]);
  // Inzwischen von anderswo gelöscht oder geleert (Abgleich) – dann gibt es nichts mehr zu fragen
  useEffect(() => { if (!bereich || (art === 'projekt' && !projekt)) onClose(); }, [art, bereich, projekt, onClose]);
  if (!bereich || (art === 'projekt' && !projekt)) return null;

  const name = art === 'bereich' ? bereich.name : projekt!.name;
  const karten = boards.reduce((n, b) => n + b.nodes.length, 0);
  const fremde = boards.filter((b) => b.geteiltVon || b.gastLink).length;
  const loeschen = () => {
    const st = useBoard.getState();
    const mit = weise === 'behalten' && zielId ? { boards: 'behalten' as const, ziel: zielId } : { boards: 'loeschen' as const };
    if (art === 'bereich') st.removeSpace(id, mit); else st.removeProject(id, mit);
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ebene-weg" role="dialog" aria-modal="true" aria-label={art === 'bereich' ? 'Bereich löschen' : 'Projekt löschen'}
        data-taste="ebene-weg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{art === 'bereich' ? 'Bereich löschen' : 'Projekt löschen'}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            <p className="ebene-weg-inhalt" data-taste="ebene-weg-inhalt">
              <b translate="no">{name}</b>{' · '}
              {art === 'bereich' && <><span>{projekte.length} {projekte.length === 1 ? 'Projekt' : 'Projekte'}</span> · </>}
              <span>{boards.length} {boards.length === 1 ? 'Board' : 'Boards'}</span> · <span>{karten} {karten === 1 ? 'Karte' : 'Karten'}</span>
            </p>
            <ul className="ebene-weg-liste" data-taste="ebene-weg-liste">
              {projekte.map((p) => p.boardIds.map((b) => alleBoards.find((x) => x.id === b)).filter((b): b is NonNullable<typeof b> => !!b).map((b) => (
                <li key={b.id}>
                  <span className="ebene-weg-name" translate="no">{b.name}</span>
                  {art === 'bereich' && <span className="ebene-weg-ort" translate="no">{p.name}</span>}
                  {(b.geteiltVon || b.gastLink) ? <span className="ebene-weg-marke">geteilt</span> : b.archived ? <span className="ebene-weg-marke">Archiv</span> : null}
                  <span className="ebene-weg-zahl">{b.nodes.length} {b.nodes.length === 1 ? 'Karte' : 'Karten'}</span>
                </li>
              )))}
            </ul>
            <fieldset className="ebene-weg-wahl">
              <legend>Was soll mit den Boards geschehen?</legend>
              <label>
                <input type="radio" name="ebene-weg" checked={weise === 'loeschen'} onChange={() => setWeise('loeschen')} data-taste="ebene-weg-loeschen" />
                <span><b>Mit löschen</b><small>Die Boards und ihre Karten werden entfernt.</small></span>
              </label>
              <label className={ziele.length ? '' : 'aus'}>
                <input type="radio" name="ebene-weg" disabled={!ziele.length} checked={weise === 'behalten'} onChange={() => setWeise('behalten')} data-taste="ebene-weg-behalten" />
                <span>
                  <b>Behalten und verschieben</b>
                  {ziele.length ? (
                    <select value={zielId} aria-label="Ziel" data-taste="ebene-weg-ziel"
                      onChange={(e) => { setZiel(e.target.value); setWeise('behalten'); }} onFocus={() => setWeise('behalten')}>
                      {art === 'bereich'
                        ? ziele.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)
                        : spaces.map((sp) => {
                          const hier = ziele.filter((z) => z.gruppe === sp.name && sp.projects.some((p) => p.id === z.id));
                          return hier.length ? <optgroup key={sp.id} label={sp.name}>{hier.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</optgroup> : null;
                        })}
                    </select>
                  ) : <small>{art === 'bereich' ? 'Es gibt keinen anderen Bereich.' : 'Es gibt kein anderes Projekt.'}</small>}
                </span>
              </label>
            </fieldset>
            {weise === 'loeschen' && fremde > 0 && (
              <p className="modal-note" data-taste="ebene-weg-fremd">
                {fremde === 1 ? 'Ein Board gehört einem anderen Konto und bleibt erhalten.' : `${fremde} Boards gehören einem anderen Konto und bleiben erhalten.`}
              </p>
            )}
            <p className="modal-note">Danach holt „Rückgängig" in der Meldung alles zurück. Archivieren legt Boards stattdessen nur zur Seite.</p>
            <div className="modal-buttons ebene-weg-knoepfe">
              <button onClick={onClose} data-taste="ebene-weg-abbrechen">Abbrechen</button>
              <button ref={knopf} className="danger" onClick={loeschen} data-taste="ebene-weg-tun">{weise === 'behalten' ? 'Löschen und verschieben' : 'Löschen'}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
