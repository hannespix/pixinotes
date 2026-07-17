// Monochromes Icon-Set fürs UI-Chrome (Lucide-artige Outlines, currentColor).
// Bewusst ohne Abhängigkeit: ~20 handgezeichnete 24er-Pfade reichen.
// Emojis bleiben dem INHALT vorbehalten — die Bedienung ist neutral.
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function make(children: ReactNode) {
  return function Icon({ size = 18, ...rest }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {children}
      </svg>
    );
  };
}

export const IPlus = make(<><path d="M12 5v14" /><path d="M5 12h14" /></>);
export const IX = make(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>);
export const IPen = make(<><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>);
export const IHighlighter = make(<><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4Z" /></>);
export const IEraser = make(<><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" /></>);
export const IUndo = make(<><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></>);
export const IRedo = make(<><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></>);
export const ITasks = make(<><rect width="18" height="18" x="3" y="3" rx="3" /><path d="m8.5 12 2.5 2.5L16 9" /></>);
export const IPlay = make(<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />);
export const ISearch = make(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /></>);
export const ISettings = make(<><path d="M21 5H11" /><path d="M7 5H3" /><path d="M21 12h-6" /><path d="M9 12H3" /><path d="M21 19h-4" /><path d="M11 19H3" /><path d="M9 3v4" /><path d="M15 10v4" /><path d="M13 17v4" /></>);
export const ICalendar = make(<><rect width="18" height="17" x="3" y="4.5" rx="2.5" /><path d="M16 2.5v4" /><path d="M8 2.5v4" /><path d="M3 10h18" /></>);
export const IGantt = make(<><path d="M4 6h9" /><path d="M9 12h11" /><path d="M6 18h8" /></>);
export const INote = make(<><path d="M15.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M15 3v5h5" /></>);
export const IKanban = make(<><path d="M6 5v11" /><path d="M12 5v6" /><path d="M18 5v14" /></>);
export const IDiagram = make(<><rect width="6" height="5" x="9" y="3" rx="1" /><rect width="6" height="5" x="3" y="16" rx="1" /><rect width="6" height="5" x="15" y="16" rx="1" /><path d="M12 8v3" /><path d="M12 11H6v5" /><path d="M12 11h6v5" /></>);
export const IFolder = make(<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />);
export const IHome = make(<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 22V12h6v10" /></>);
export const IChevronL = make(<path d="m15 18-6-6 6-6" />);
export const IChevronR = make(<path d="m9 18 6-6-6-6" />);
export const IArrowUp = make(<><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>);
export const IArrowDown = make(<><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>);
export const IMail = make(<><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>);
export const ICopy = make(<><rect width="13" height="13" x="8" y="8" rx="2" /><path d="M4 16V5a1 1 0 0 1 1-1h11" /></>);
export const ITrash = make(<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>);
export const IDuplicate = make(<><rect width="12" height="12" x="9" y="9" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /><path d="M15 12v6" /><path d="M12 15h6" /></>);
export const IUsers = make(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M17.8 14.2A6.5 6.5 0 0 1 21.5 20" /></>);
export const IBell = make(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>);
export const IDownload = make(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>);
export const ITarget = make(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 3v2" /><path d="M12 19v2" /><path d="M3 12h2" /><path d="M19 12h2" /></>);
export const IZoomIn = make(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /><path d="M11 8v6" /><path d="M8 11h6" /></>);
export const IZoomOut = make(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /><path d="M8 11h6" /></>);

// Sync-Status (M85): gleiche Formensprache wie der Rest des UI-Chromes
export const ICloud = make(<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />);
export const ICloudCheck = make(<><path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24" /><path d="m9 16 2.5 2.5L17 13" /></>);
export const ICloudAlert = make(<><path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24" /><path d="M12 12v4" /><path d="M12 20h.01" /></>);
export const ICloudOff = make(<><path d="M6.28 6.3a7 7 0 0 0 2.72 13.7h8.5a4.5 4.5 0 0 0 2.63-.86" /><path d="M10.6 3.24A7 7 0 0 1 15.71 8h1.79a4.5 4.5 0 0 1 3.86 6.82" /><path d="m2 2 20 20" /></>);
export const IWand = make(<><path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8 19 13" /><path d="M17.8 6.2 19 5" /><path d="m3 21 9-9" /><path d="M12.2 6.2 11 5" /></>);
export const ISquare = make(<rect width="16" height="12" x="4" y="6" rx="2" />);
export const IDiamond = make(<path d="M12 3l9 9-9 9-9-9Z" />);
export const IPill = make(<rect width="18" height="10" x="3" y="7" rx="5" />);
export const IMousePointer = make(<><path d="m4 3 7.1 17 2.4-7.5L21 10Z" /></>);
export const IShare = make(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4" /><path d="m15.4 6.5-6.8 4" /></>);
export const IHistory = make(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3.5 2" /></>);
export const ITag = make(<><path d="M12 2H4a2 2 0 0 0-2 2v8l10 10 10-10Z" /><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" /></>);
export const IBookmark = make(<path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />);
export const IArrange = make(<><rect width="7" height="7" x="3" y="3" rx="1.5" /><rect width="7" height="7" x="14" y="3" rx="1.5" /><rect width="7" height="7" x="3" y="14" rx="1.5" /><path d="M17.5 14.5v6" /><path d="M14.5 17.5h6" /></>);
export const IHelp = make(<><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.4-3 4" /><path d="M12 17.5h.01" /></>);
export const IMagnet = make(<><path d="M5 3v7a7 7 0 0 0 14 0V3" /><path d="M5 3h4v7a3 3 0 0 0 6 0V3h4" /><path d="M5 8h4" /><path d="M15 8h4" /></>);
