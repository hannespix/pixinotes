// M388: Liegt etwas über dem Board, dem die Tasten gehören?
//
// Das Board hört auf einzelne Tasten (N = neue Notiz, F = einpassen, + / −, Leertaste, Strg+Z). Liegt ein
// Fenster darüber — Ticket, Bild-Lupe, Einstellungen, Hilfe, Suche —, gehören die Tasten ihm: Wer dort tippte
// und den Fokus auf einem Knopf hatte, legte dahinter Notizen an oder nahm Schritte zurück.
const FENSTER = '.modal-backdrop, .ticket-modal-backdrop, .pdf-backdrop, .search-backdrop, .onb-backdrop, .lookup-backdrop, .presenter, .qr-blende.gross';

export const overlayOffen = (): boolean => !!document.querySelector(FENSTER);
