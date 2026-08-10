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
export const IFilter = make(<path d="M3 4.5h18l-7 8.2V20l-4-2.2v-7.1z" />);
export const ISettings = make(<><path d="M21 5H11" /><path d="M7 5H3" /><path d="M21 12h-6" /><path d="M9 12H3" /><path d="M21 19h-4" /><path d="M11 19H3" /><path d="M9 3v4" /><path d="M15 10v4" /><path d="M13 17v4" /></>);
export const ICalendar = make(<><rect width="18" height="17" x="3" y="4.5" rx="2.5" /><path d="M16 2.5v4" /><path d="M8 2.5v4" /><path d="M3 10h18" /></>);
export const IGantt = make(<><path d="M4 6h9" /><path d="M9 12h11" /><path d="M6 18h8" /></>);
export const INote = make(<><path d="M15.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M15 3v5h5" /></>);
export const IKanban = make(<><path d="M6 5v11" /><path d="M12 5v6" /><path d="M18 5v14" /></>);
export const IDiagram = make(<><rect width="6" height="5" x="9" y="3" rx="1" /><rect width="6" height="5" x="3" y="16" rx="1" /><rect width="6" height="5" x="15" y="16" rx="1" /><path d="M12 8v3" /><path d="M12 11H6v5" /><path d="M12 11h6v5" /></>);
// M194: Seitenleiste rechts (ausfahrbarer Überblick)
export const IPanelRight = make(<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /></>);
// M193: Netz-Ansicht — Knoten mit Verbindungen (Graph, nicht Baum)
export const IGraph = make(<><circle cx="12" cy="12" r="3" /><circle cx="5" cy="6" r="2" /><circle cx="19" cy="7" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="18" r="2" /><path d="m6.8 7.4 2.8 2.8" /><path d="m17.4 8.4-3 2.4" /><path d="m7.4 17.6 2.8-2.8" /><path d="m16.6 16.6-2.6-2.4" /></>);
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

// Board-Optionen (M88)
export const IPalette = make(<><circle cx="13.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /><circle cx="17.5" cy="10.5" r=".8" fill="currentColor" stroke="none" /><circle cx="8.5" cy="7.5" r=".8" fill="currentColor" stroke="none" /><circle cx="6.5" cy="12.5" r=".8" fill="currentColor" stroke="none" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.12a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2Z" /></>);

// Archiv (M87)
export const IArchive = make(<><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>);
// Auto-Größe (M103): Rahmen mit nach außen weisenden Ecken
export const IFit = make(<><polyline points="4 9 4 4 9 4" /><polyline points="15 4 20 4 20 9" /><polyline points="20 15 20 20 15 20" /><polyline points="9 20 4 20 4 15" /></>);
export const IArchiveRestore = make(<><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h2" /><path d="M20 8v11a2 2 0 0 1-2 2h-2" /><path d="m9 15 3-3 3 3" /><path d="M12 12v9" /></>);

// Sync-Status (M85): gleiche Formensprache wie der Rest des UI-Chromes
export const ICloud = make(<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />);
export const ICloudCheck = make(<><path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24" /><path d="m9 16 2.5 2.5L17 13" /></>);
export const ICloudAlert = make(<><path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24" /><path d="M12 12v4" /><path d="M12 20h.01" /></>);
export const ICloudOff = make(<><path d="M6.28 6.3a7 7 0 0 0 2.72 13.7h8.5a4.5 4.5 0 0 0 2.63-.86" /><path d="M10.6 3.24A7 7 0 0 1 15.71 8h1.79a4.5 4.5 0 0 1 3.86 6.82" /><path d="m2 2 20 20" /></>);
// M190: „muss noch gesichert werden" — Wolke mit Pfeil nach oben
export const ICloudUp = make(<><path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.06 8.5" /><path d="M12 21v-8" /><path d="m9 16 3-3 3 3" /></>);
export const IWand = make(<><path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8 19 13" /><path d="M17.8 6.2 19 5" /><path d="m3 21 9-9" /><path d="M12.2 6.2 11 5" /></>);
export const ISquare = make(<rect width="16" height="12" x="4" y="6" rx="2" />);
export const IDiamond = make(<path d="M12 3l9 9-9 9-9-9Z" />);
export const IPill = make(<rect width="18" height="10" x="3" y="7" rx="5" />);
export const IMousePointer = make(<><path d="m4 3 7.1 17 2.4-7.5L21 10Z" /></>);
export const IShare = make(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4" /><path d="m15.4 6.5-6.8 4" /></>);
/** M224: Sehen & Bedienen — Barrierefreiheits-Einstellungen */
export const IEye = make(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>);
export const ITag = make(<><path d="M12 2H4a2 2 0 0 0-2 2v8l10 10 10-10Z" /><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" /></>);
export const IBookmark = make(<path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />);
export const IArrange = make(<><rect width="7" height="7" x="3" y="3" rx="1.5" /><rect width="7" height="7" x="14" y="3" rx="1.5" /><rect width="7" height="7" x="3" y="14" rx="1.5" /><path d="M17.5 14.5v6" /><path d="M14.5 17.5h6" /></>);
export const IHelp = make(<><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.4-3 4" /><path d="M12 17.5h.01" /></>);
export const IMagnet = make(<><path d="M5 3v7a7 7 0 0 0 14 0V3" /><path d="M5 3h4v7a3 3 0 0 0 6 0V3h4" /><path d="M5 8h4" /><path d="M15 8h4" /></>);

/* ---------- M144: Anordnungs- & Export-Icons (statt Emojis in Menüs) ---------- */
export const IFlowH = make(<><path d="M3 12h14" /><path d="m12 7 5 5-5 5" /></>);
export const IFlowV = make(<><path d="M12 3v14" /><path d="m7 12 5 5 5-5" /></>);
export const IMetro = make(<><path d="M4 17h5l6-10h5" /><circle cx="4" cy="17" r="1.8" /><circle cx="20" cy="7" r="1.8" /></>);
export const IGridLayout = make(<><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></>);
export const ICompact = make(<><path d="m14 10 6-6" /><path d="M14 4v6h6" /><path d="m10 14-6 6" /><path d="M10 20v-6H4" /></>);
export const ILanes = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9.3h18" /><path d="M3 14.6h18" /></>);
export const ITimelineIcon = make(<><path d="M3 12h18" /><path d="M7 9.5v5" /><path d="M12 9.5v5" /><path d="M17 9.5v5" /></>);
export const IQuadrant = make(<><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M12 3.5v17" /><path d="M3.5 12h17" /></>);
export const ICircles = make(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /></>);
export const IStack = make(<><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 12.5 9 5 9-5" /><path d="m3 16.5 9 5 9-5" /></>);
export const IGridSnap = make(<><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" /><path d="M9.2 3.5v17" /><path d="M14.8 3.5v17" /><path d="M3.5 9.2h17" /><path d="M3.5 14.8h17" /></>);
export const IComment = make(<><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.9 8.9 0 0 1-3.2-.6L3 21l1.8-5.2a8 8 0 0 1-.8-3.3A8.4 8.4 0 0 1 12.5 4.2a8.4 8.4 0 0 1 8.5 7.3Z" /></>);
export const IFrame = make(<><rect x="4" y="6.5" width="16" height="13" rx="2" /><path d="M4 6.5V5a1.5 1.5 0 0 1 1.5-1.5h5" /></>);
export const IWeek = make(<><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18" /><path d="M9 9.5V20.5" /><path d="M15 9.5V20.5" /></>);
export const IMinutes = make(<><path d="M6.5 3.5h8L19 8v10.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" /><path d="M14 3.5V8h4.5" /><path d="M8 12h7" /><path d="M8 15.5h7" /><path d="M8 18.5h4" /></>);
export const ITimer = make(<><circle cx="12" cy="13.5" r="7.5" /><path d="M12 10v3.5l2.5 2" /><path d="M9.5 2.5h5" /><path d="M12 2.5V6" /></>);
export const IPaperclip = make(<path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />);
export const IMoveTo = make(<><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /><path d="M9 13h6" /><path d="m12.5 10.5 2.5 2.5-2.5 2.5" /></>);
export const IExternal = make(<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>);
export const IGlobe = make(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14.5 14.5 0 0 1 0 18" /><path d="M12 3a14.5 14.5 0 0 0 0 18" /></>);
export const IType = make(<><path d="M5 7V5h14v2" /><path d="M12 5v14" /><path d="M9 19h6" /></>);
export const IMore = make(<><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" /></>);
export const IAppWindow = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8.5h18" /><path d="M6 6.3h.01" /><path d="M8.6 6.3h.01" /><path d="m10 13 2.2 2.2L10 17.4" /><path d="M13.5 17.4h3.5" /></>);
export const IMaximize = make(<><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></>);
export const IMinimize = make(<><path d="M4 14h6v6" /><path d="M20 10h-6V4" /><path d="M14 10l7-7" /><path d="M3 21l7-7" /></>);
export const IReload = make(<><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>);
export const IStopSq = make(<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />);
// M243: Anfasser der Bearbeiten-Leiste — die sechs Punkte sind die
// eingebürgerte Form für „hier anfassen und schieben" (Trello, Notion, Jira).
export const IGrip = make(<>
  <circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none" />
  <circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none" />
  <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
  <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
  <circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none" />
  <circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none" />
</>);
