// M394: Werkzeuge und Farben der Zeichenschicht in der Präsentation — getrennt von der Schicht selbst, damit die
// Präsentation sie kennt, ohne die Schicht zu laden (sie kommt erst, wenn präsentiert wird).
export type FolienWerkzeug = 'pen' | 'marker' | 'eraser';
export const FOLIEN_FARBEN = { pen: ['#e0392b', '#16191e', '#4f7cff', '#3fa564', '#e8a13a'], marker: ['#fff200', '#aaff00', '#ff9100', '#ff2d95', '#00e5ff'] };
