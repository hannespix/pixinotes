// M454: Mehrere Kontakt-Karten als EINE .vcf herunterladen – aus der Auswahl (⋯ der Auswahl-Leiste, Rechtsklick)
// oder alle eines Boards (⋯ am Board). Eine Datei statt vieler: Outlook, Apple, Google und Android lesen so ein
// ganzes Adressbuch in einem Zug ein, und der Browser fragt nicht bei jeder Datei nach.
import type { AppNode, KontaktData } from '../types';
import { triggerDownload } from './download';
import { kontaktDaten, vcardDateiname, vcardSammeln } from './vcard';

/** Die Kontakt-Karten einer Kartenliste (archivierte zählen mit – das Adressbuch soll vollständig sein) */
export function kontaktKarten(nodes: AppNode[]): AppNode[] {
  return nodes.filter((n) => n.type === 'kontakt');
}

/** Herunterladen; `basis` benennt die Datei bei mehreren Kontakten. Gibt die Zahl der Kontakte zurück. */
export function kontakteHerunterladen(nodes: AppNode[], basis: string): number {
  const liste = kontaktKarten(nodes).map((n) => kontaktDaten(n.data as Partial<KontaktData>));
  if (liste.length === 0) return 0;
  const name = liste.length === 1 ? vcardDateiname(liste[0]) : vcardDateiname(`${basis.trim() || 'Kontakte'} - ${liste.length} Kontakte`);
  const url = URL.createObjectURL(new Blob([vcardSammeln(liste)], { type: 'text/vcard;charset=utf-8' }));
  triggerDownload(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return liste.length;
}
