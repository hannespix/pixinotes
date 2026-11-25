/**
 * M519: Lupe und Text-Chips der Bilder kommen erst bei Bedarf.
 *
 * Bild- und Datei-Karte gehören zum Start (sie liegen auf fast jedem Board, M446). Die Lupe öffnet aber erst ein
 * Klick auf ⤢, und die Chips (Telefon, Mail, Frist aus dem Text im Bild) stehen nur unter einem MARKIERTEN Bild mit
 * erkanntem Text — beides samt Zoom-Rechnung (lib/lupe.ts) und Aufgaben-Anlage (lib/bildTextAufgabe.ts) lag
 * trotzdem im Start-Paket. Hier sind sie nachgeladen; `bildTeileVorladen()` holt sie ein paar Sekunden, nachdem
 * das erste Bild auf einem Board erschienen ist — dann stehen sie beim ersten Klick ohne Verzug, und der Service
 * Worker hat sie auch offline.
 */
import { nachLazy } from '../../lib/nachLazy';
import { Suspense, type ComponentProps } from 'react';

const lupeLaden = () => import('./BildLupe');
const chipsLaden = () => import('./BildTextChips');
const Lupe = nachLazy(() => lupeLaden().then((m) => ({ default: m.BildLupe })));
const Chips = nachLazy(() => chipsLaden().then((m) => ({ default: m.BildTextChips })));

export const BildLupe = (p: ComponentProps<typeof Lupe>) => <Suspense fallback={null}><Lupe {...p} /></Suspense>;
export const BildTextChips = (p: ComponentProps<typeof Chips>) => <Suspense fallback={null}><Chips {...p} /></Suspense>;

let geholt = false;
export function bildTeileVorladen(): void {
  if (geholt) return;
  geholt = true;
  // erst nach dem Start (nicht im ersten Laden des Boards) — und bei einem Fehlschlag später noch einmal
  setTimeout(() => { void Promise.all([lupeLaden(), chipsLaden()]).catch(() => { geholt = false; }); }, 4000);
}
