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
/** M478: Eingang (Ablage für alles, was von außen kommt) */
export const IEingang = make(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>);
export const IPlay = make(<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />);
export const ISearch = make(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /></>);
export const IFilter = make(<path d="M3 4.5h18l-7 8.2V20l-4-2.2v-7.1z" />);
export const ISettings = make(<><path d="M21 5H11" /><path d="M7 5H3" /><path d="M21 12h-6" /><path d="M9 12H3" /><path d="M21 19h-4" /><path d="M11 19H3" /><path d="M9 3v4" /><path d="M15 10v4" /><path d="M13 17v4" /></>);
export const ICalendar = make(<><rect width="18" height="17" x="3" y="4.5" rx="2.5" /><path d="M16 2.5v4" /><path d="M8 2.5v4" /><path d="M3 10h18" /></>);
export const IGantt = make(<><path d="M4 6h9" /><path d="M9 12h11" /><path d="M6 18h8" /></>);
export const INote = make(<><path d="M15.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M15 3v5h5" /></>);
export const IKanban = make(<><path d="M6 5v11" /><path d="M12 5v6" /><path d="M18 5v14" /></>);
export const IDiagram = make(<><rect width="6" height="5" x="9" y="3" rx="1" /><rect width="6" height="5" x="3" y="16" rx="1" /><rect width="6" height="5" x="15" y="16" rx="1" /><path d="M12 8v3" /><path d="M12 11H6v5" /><path d="M12 11h6v5" /></>);
export const IPanelLeft = make(<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></>);
export const IFolder = make(<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />);
/** M412: Hilfe – Kreis mit Fragezeichen */
export const IHelp = make(<><circle cx="12" cy="12" r="9.5" /><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.5-2.8 4" /><path d="M12 17.3h.01" /></>);
export const IHome = make(<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 22V12h6v10" /></>);
export const IChevronL = make(<path d="m15 18-6-6 6-6" />);
export const IChevronR = make(<path d="m9 18 6-6-6-6" />);
/** M310: Häkchen — die gewählte Sortierart */
export const ICheck = make(<path d="m5 12 5 5L20 7" />);
/** M310: Reihenfolge (Liste mit Pfeil) */
export const IReihenfolge = make(<><path d="M3 6h11" /><path d="M3 12h8" /><path d="M3 18h5" /><path d="m16 10 3-3 3 3" /><path d="M19 7v14" /></>);
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
/** M385: QR-Code — drei Suchmuster und ein paar Felder */
export const IQr = make(<><rect width="6" height="6" x="3" y="3" rx="1" /><rect width="6" height="6" x="15" y="3" rx="1" /><rect width="6" height="6" x="3" y="15" rx="1" /><path d="M15 15h2v2h-2zM19 15h2M15 19h2v2M19 19h2v2h-2" /></>);
export const IMousePointer = make(<><path d="m4 3 7.1 17 2.4-7.5L21 10Z" /></>);
export const IShare = make(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4" /><path d="m15.4 6.5-6.8 4" /></>);
export const ITag = make(<><path d="M12 2H4a2 2 0 0 0-2 2v8l10 10 10-10Z" /><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" /></>);
export const IBookmark = make(<path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />);
export const IArrange = make(<><rect width="7" height="7" x="3" y="3" rx="1.5" /><rect width="7" height="7" x="14" y="3" rx="1.5" /><rect width="7" height="7" x="3" y="14" rx="1.5" /><path d="M17.5 14.5v6" /><path d="M14.5 17.5h6" /></>);

/* ---------- M144: Anordnungs- & Export-Icons (statt Emojis in Menüs) ---------- */
export const IFlowH = make(<><path d="M3 12h14" /><path d="m12 7 5 5-5 5" /></>);
export const IFlowV = make(<><path d="M12 3v14" /><path d="m7 12 5 5 5-5" /></>);
export const IGridLayout = make(<><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></>);
export const ICompact = make(<><path d="m14 10 6-6" /><path d="M14 4v6h6" /><path d="m10 14-6 6" /><path d="M10 20v-6H4" /></>);
export const ILanes = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9.3h18" /><path d="M3 14.6h18" /></>);
export const ITimelineIcon = make(<><path d="M3 12h18" /><path d="M7 9.5v5" /><path d="M12 9.5v5" /><path d="M17 9.5v5" /></>);
export const IQuadrant = make(<><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M12 3.5v17" /><path d="M3.5 12h17" /></>);
export const ICircles = make(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /></>);
/** M379: Vorlage — ein Board mit vorgezeichneten Feldern */
export const IVorlage = make(<><rect x="3" y="3.5" width="18" height="17" rx="2" /><path d="M3 9h18" /><path d="M9.5 9v11.5" /></>);
/** M373: Entscheidungs-Bubbles — drei Blasen verschiedener Größe */
export const IBubbles = make(<><circle cx="8.5" cy="14.5" r="5.5" /><circle cx="17" cy="8" r="3.6" /><circle cx="18" cy="18" r="2.2" /></>);
/** M500: Flüssige Schrift — ein Buchstabe, von dem ein Tropfen fällt */
export const IFluessig = make(<><path d="M5 18c0-6 2.5-12 7-12s7 6 7 12" /><path d="M8 14h8" /><path d="M12 18.5c-1.2 1.4-1.8 2.3-1.8 3a1.8 1.8 0 0 0 3.6 0c0-.7-.6-1.6-1.8-3Z" /></>);
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

/** M254: Bild/Foto — Rahmen mit Bergspitze und Sonne, das übliche Bildsymbol */
export const IImage = make(<><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="1.6" /><path d="m21 15-4.5-4.5L9 18" /></>);

/** M256: Sigma — das Zeichen für die Auto-Summe */
export const ISigma = make(<><path d="M18 4H6l6 8-6 8h12" /></>);
// M395: Bildbearbeitung
export const ICrop = make(<><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></>);
export const IDrehLinks = make(<><path d="M3 12a9 9 0 1 0 2.64-6.36" /><path d="M3 3v6h6" /></>);
export const IDrehRechts = make(<><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>);
export const ISpiegeln = make(<><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" /><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" /><path d="M12 2v2" /><path d="M12 8v2" /><path d="M12 14v2" /><path d="M12 20v2" /></>);
export const ISonne = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m4.9 19.1 1.4-1.4" /><path d="m17.7 6.3 1.4-1.4" /></>);
export const IVerpixeln = make(<><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" /><path d="M3.5 9.2h17" /><path d="M3.5 14.8h17" /><path d="M9.2 3.5v17" /><path d="M14.8 3.5v17" /></>);
// M397: Symbole, die vorher Emojis waren — einfarbig, in der Strichstärke der übrigen
export const ILock = make(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const IWarn = make(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>);
export const IMegafon = make(<><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>);
export const IFileText = make(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h6" /></>);
export const ITabelle = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M3 15h18" /><path d="M9 4v16" /></>);
export const IFolien = make(<><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M12 16v4" /><path d="M8 20h8" /></>);
export const IOrt = make(<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>);
export const IUhr = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IPerson = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
/** M450: Telefonhörer (Kontakt-Karte) */
export const ITelefon = make(<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />);
export const IDrucker = make(<><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></>);
export const ILink = make(<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>);
export const ILaecheln = make(<><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01" /><path d="M15 9h.01" /></>);
export const INetz = make(<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="10" cy="18" r="2.5" /><path d="M8.4 6.4 15.6 7.6" /><path d="M6.8 8.4 9.2 15.6" /><path d="M16.5 10 11.5 16" /></>);
export const IBuch = make(<><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" /><path d="M8 3v18" /></>);

// M399: Anordnen – Kanten, Verteilen, Größe, Raster (eigene, einfache Zeichnungen im selben Strich)
export const IKanteLinks = make(<><path d="M3 3v18" /><rect x="7" y="5" width="13" height="5" rx="1" /><rect x="7" y="14" width="8" height="5" rx="1" /></>);
export const IKanteMitteX = make(<><path d="M12 2v3" /><path d="M12 10v4" /><path d="M12 19v3" /><rect x="4" y="5" width="16" height="5" rx="1" /><rect x="7" y="14" width="10" height="5" rx="1" /></>);
export const IKanteRechts = make(<><path d="M21 3v18" /><rect x="4" y="5" width="13" height="5" rx="1" /><rect x="9" y="14" width="8" height="5" rx="1" /></>);
export const IKanteOben = make(<><path d="M3 3h18" /><rect x="5" y="7" width="5" height="13" rx="1" /><rect x="14" y="7" width="5" height="8" rx="1" /></>);
export const IKanteMitteY = make(<><path d="M2 12h3" /><path d="M10 12h4" /><path d="M19 12h3" /><rect x="5" y="4" width="5" height="16" rx="1" /><rect x="14" y="7" width="5" height="10" rx="1" /></>);
export const IKanteUnten = make(<><path d="M3 21h18" /><rect x="5" y="4" width="5" height="13" rx="1" /><rect x="14" y="9" width="5" height="8" rx="1" /></>);
export const IVerteilenX = make(<><path d="M3 3v18" /><path d="M21 3v18" /><rect x="9" y="6" width="6" height="12" rx="1" /></>);
export const IVerteilenY = make(<><path d="M3 3h18" /><path d="M3 21h18" /><rect x="6" y="9" width="12" height="6" rx="1" /></>);
export const IAlsZeile = make(<><rect x="2" y="7" width="5" height="10" rx="1" /><rect x="9.5" y="7" width="5" height="10" rx="1" /><rect x="17" y="7" width="5" height="10" rx="1" /></>);
export const IAlsSpalte = make(<><rect x="7" y="2" width="10" height="5" rx="1" /><rect x="7" y="9.5" width="10" height="5" rx="1" /><rect x="7" y="17" width="10" height="5" rx="1" /></>);
export const IGleichBreit = make(<><path d="M4 6h16" /><path d="m7 3-3 3 3 3" /><path d="m17 3 3 3-3 3" /><rect x="4" y="13" width="16" height="7" rx="1" /></>);
export const IGleichHoch = make(<><path d="M6 4v16" /><path d="m3 7 3-3 3 3" /><path d="m3 17 3 3 3-3" /><rect x="13" y="4" width="7" height="16" rx="1" /></>);
export const IGleichGross = make(<><rect x="3" y="6" width="8" height="12" rx="1" /><rect x="13" y="6" width="8" height="12" rx="1" /></>);
export const IGroesser = make(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 8v8" /><path d="M8 12h8" /></>);
export const IKleiner = make(<><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 12h6" /></>);
export const IRaster = make(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>);
export const IPacken = make(<><rect x="3" y="3" width="7" height="10" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="17" width="7" height="4" rx="1" /></>);
export const IOrdnen = make(<><rect x="3" y="4" width="6" height="6" rx="1" /><rect x="12" y="4" width="9" height="6" rx="1" /><rect x="3" y="14" width="10" height="6" rx="1" /><rect x="16" y="14" width="5" height="6" rx="1" /></>);

// M400: Drehen (Bogen mit Pfeilspitze)
export const IDrehen = make(<><path d="M20 11a8 8 0 1 0-2.6 5.9" /><path d="M20 4v7h-7" /></>);
export const ISchraeg = make(<><rect x="5" y="6" width="13" height="12" rx="1.5" transform="rotate(-10 11.5 12)" /></>);
