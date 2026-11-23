// M397: EIN Symbol je Karten-Art und je Datei-Art — einfarbig, überall dasselbe (Suche, Tickets, Datei-Karte).
// Vorher stand an jeder dieser Stellen eine eigene Liste bunter Emojis.
import type { ComponentType, SVGProps } from 'react';
import {
  IAppWindow, IArchive, IBubbles, ICalendar, IDiagram, IFileText, IFolder, IFolien, IFrame, IGantt, IImage, IKanban, IMail, IMinutes,
  INote, IPaperclip, IPerson, ISquare, ITabelle, ITimer, IWeek,
} from './Icons';

type Symbol = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
const KARTE: Record<string, Symbol> = {
  note: INote, email: IMail, kanban: IKanban, sheet: ITabelle, gantt: IGantt, calendar: ICalendar, image: IImage, file: IPaperclip,
  portal: IFolder, shape: ISquare, mermaid: IDiagram, bubbles: IBubbles, frame: IFrame, week: IWeek, minutes: IMinutes, time: ITimer,
  htmlapp: IAppWindow, pdf: IFileText, kontakt: IPerson,
};
const ENDUNG: Record<string, Symbol> = {
  pdf: IFileText, doc: IFileText, docx: IFileText, txt: IFileText, md: IFileText, xlsx: ITabelle, xls: ITabelle, csv: ITabelle,
  vcf: IPerson, ppt: IFolien, pptx: IFolien, zip: IArchive, png: IImage, jpg: IImage, jpeg: IImage, gif: IImage, webp: IImage, svg: IImage,
};

/** Symbol einer Karten-Art (node.type); unbekannt: die Notiz */
export function KartenSymbol({ art, size = 14, ...rest }: { art: string | undefined; size?: number } & SVGProps<SVGSVGElement>) {
  const S = KARTE[art ?? ''] ?? INote;
  return <S size={size} {...rest} />;
}
/** Symbol einer Datei nach ihrer Endung; unbekannt: die Büroklammer */
export function DateiSymbol({ name, size = 14, ...rest }: { name: string; size?: number } & SVGProps<SVGSVGElement>) {
  const S = ENDUNG[name.split('.').pop()?.toLowerCase() ?? ''] ?? IPaperclip;
  return <S size={size} {...rest} />;
}
