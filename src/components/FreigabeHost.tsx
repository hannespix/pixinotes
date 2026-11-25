// M459: Der Freigabe-Dialog (Einladen, Freigaben, Einladungslink) zieht Konto- und Gast-Abgleich nach sich — er
// kommt darum erst mit dem ersten Öffnen. Hier steht nur, was der Start braucht: das Ereignis und der Ort, an dem
// der Dialog aufgeht.
import { nachLazy } from '../lib/nachLazy';
import { Suspense, useEffect, useState } from 'react';
import { useBoard } from '../store';

/** M391: Den Einladungs-Dialog von überall öffnen */
export const FREIGABE_OEFFNEN = 'pixinotes:freigabe-oeffnen';

export const freigabeDialogLaden = () => import('./FreigabeDialog');
const FreigabeDialogLazy = nachLazy(() => freigabeDialogLaden().then((m) => ({ default: m.FreigabeDialog })));

/** Der Dialog, nachgeladen (bis er da ist: nichts — lokal wenige Millisekunden) */
export function FreigabeDialogSpaet(props: { boardId: string; onClose: () => void }) {
  return <Suspense fallback={null}><FreigabeDialogLazy {...props} /></Suspense>;
}

/** M391: Ein Ort, an dem der Dialog von überall aufgeht (Leiste „Einladen …", Befehle) */
export function FreigabeHost() {
  const [boardId, setBoardId] = useState<string | null>(null);
  useEffect(() => {
    const auf = (e: Event) => setBoardId((e as CustomEvent<{ boardId?: string }>).detail?.boardId ?? useBoard.getState().activeId);
    window.addEventListener(FREIGABE_OEFFNEN, auf);
    return () => window.removeEventListener(FREIGABE_OEFFNEN, auf);
  }, []);
  return boardId ? <FreigabeDialogSpaet boardId={boardId} onClose={() => setBoardId(null)} /> : null;
}
