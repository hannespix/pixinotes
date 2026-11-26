// M547: Welches Design zeigt das Dokument gerade (html[data-design])? App.tsx setzt das Attribut aus dem wirksamen Look
// (eigene Wahl oder der Look eines geteilten Boards, M509) — wer nur wissen muss, was zu SEHEN ist (die Wortmarke),
// liest hier statt die Look-Regeln nachzubauen. Bewusst winzig: liegt im Start-Paket.
import { useSyncExternalStore } from 'react';

const abo = (melden: () => void): (() => void) => {
  const mo = new MutationObserver(melden);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-design'] });
  return () => mo.disconnect();
};
const lesen = (): string => document.documentElement.dataset.design ?? 'klassisch';

/** 'klassisch' | 'pixel' | 'agency' — folgt dem Attribut live */
export const useDesign = (): string => useSyncExternalStore(abo, lesen, () => 'klassisch');
