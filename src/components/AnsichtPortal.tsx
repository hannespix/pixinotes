// M491: Ersatz für React Flows `ViewportPortal`. Dessen Auswahl suchte das Ziel bei JEDER Änderung im React-Flow-Stand
// per `querySelector` im ganzen Board — je Portal, also bei jedem Zug-Ereignis vier- bis fünfmal (im Profil gut 100 ms
// auf 50 Mausbewegungen). Hier wird das Ziel je Fläche gemerkt; gesucht wird nur, solange es (noch) fehlt.
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@xyflow/react';

const ziele = new WeakMap<Element, Element>();
const zielVon = (s: { domNode: HTMLDivElement | null }): Element | null => {
  const dom = s.domNode;
  if (!dom) return null;
  const z = ziele.get(dom);
  if (z?.isConnected) return z;
  const neu = dom.querySelector('.react-flow__viewport-portal');
  if (neu) ziele.set(dom, neu);
  return neu;
};

export function AnsichtPortal({ children }: { children: ReactNode }) {
  const ziel = useStore(zielVon);
  return ziel ? createPortal(children, ziel) : null;
}
