import { nachLazy } from '../lib/nachLazy';
import { Suspense, useEffect, useState } from 'react';
import { useBoard } from '../store';

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

/** M483: Der Dialog (EbeneLoeschenFenster.tsx) kommt erst mit dem ersten Wunsch — hier bleibt nur der Einstieg */
const EbeneLoeschenFensterSpaet = nachLazy(() => import('./EbeneLoeschenFenster').then((m) => ({ default: m.EbeneLoeschenDialog })));

export function EbeneLoeschenHost() {
  const [wunsch, setWunsch] = useState<EbeneWunsch | null>(null);
  useEffect(() => {
    const auf = (e: Event) => setWunsch((e as CustomEvent<EbeneWunsch>).detail ?? null);
    window.addEventListener(EBENE_LOESCHEN, auf);
    return () => window.removeEventListener(EBENE_LOESCHEN, auf);
  }, []);
  return wunsch ? <Suspense fallback={null}><EbeneLoeschenFensterSpaet wunsch={wunsch} onClose={() => setWunsch(null)} /></Suspense> : null;
}
