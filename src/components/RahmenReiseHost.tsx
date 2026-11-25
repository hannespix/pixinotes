// M514: Die Rahmen-Reise lädt erst, wenn eine beginnt (Doppelklick auf einen Rahmentitel, Alt+Umschalt+P, Rahmen-Menü
// oder ein Vorführender, dem ich folge) — das Start-Paket trägt nur diesen Platzhalter und lib/rahmenReise.ts.
import { nachLazy } from '../lib/nachLazy';
import { Suspense, useSyncExternalStore } from 'react';
import { reiseAbo, reiseStand } from '../lib/rahmenReise';

const RahmenReiseSpaet = nachLazy(() => import('./RahmenReise'));

export function RahmenReiseHost() {
  const stand = useSyncExternalStore(reiseAbo, reiseStand);
  return stand ? <Suspense fallback={null}><RahmenReiseSpaet /></Suspense> : null;
}
