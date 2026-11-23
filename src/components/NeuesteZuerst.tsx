import { Children, isValidElement, type ReactNode } from 'react';

/** Text eines React-Knotens (rekursiv) – nur zum Lesen der Meilenstein-Nummer */
const textVon = (n: ReactNode): string => {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textVon).join('');
  if (isValidElement(n)) return textVon((n.props as { children?: ReactNode }).children);
  return '';
};

/** Erste Meilenstein-Nummer eines Eintrags: „(M469)", „(M433/M434)", „(M429–M431)" → 469 / 433 / 429 */
export const meilensteinVon = (n: ReactNode): number => {
  const m = /\(M(\d+)/.exec(textVon(n));
  return m ? Number(m[1]) : -1;
};

/**
 * Hält „Was ist neu" absteigend nach Meilenstein-Nummer, egal in welcher
 * Reihenfolge die Einträge im Quelltext stehen. Parallel arbeitende Agenten
 * fügen ihre Zeile oben ein; nach mehreren Merges stand dann M469 vor M471,
 * M464 vor M470 (Prüfreihe m299 wurde rot, Befund aus M448/M462). Einträge
 * ohne Nummer behalten ihren Platz relativ zueinander und rücken ans Ende.
 */
export function NeuesteZuerst({ children }: { children: ReactNode }) {
  const liste = Children.toArray(children).map((kind, i) => ({ kind, i, nr: meilensteinVon(kind) }));
  liste.sort((a, b) => (b.nr - a.nr) || (a.i - b.i));
  return <>{liste.map((e) => e.kind)}</>;
}
