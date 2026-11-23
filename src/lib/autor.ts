// M502: Der Verfasser-Name (Kommentare, Live-Anwesenheit, „Wie heißt du?") — aus CommentLayer.tsx herausgelöst,
// damit die Kommentar-Ebene erst mit dem ersten Kommentar laden kann, der Name aber ab dem Start gilt.

/** Verfasser-Name: rein lokal (localStorage), wandert NIE ohne den Kommentar */
const AUTHOR_KEY = 'pixinotes:author';
export const getAuthor = (): string => localStorage.getItem(AUTHOR_KEY) ?? '';
export const setAuthor = (name: string) => { try { localStorage.setItem(AUTHOR_KEY, name.trim().slice(0, 40)); } catch { /* Sitzung reicht */ } };
