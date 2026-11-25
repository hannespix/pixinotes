// M530: Die lebenden Editoren der Notizen (Kennung → BlockNote-Editor). Liest nur lib/fokusEinfuegen.ts (nachgeladen):
// Strg+V im Karten-Fokus fügt über den Editor der offenen Notiz ein — der Weg selbst lädt erst beim Einfügen.
export const notizEditoren = new Map<string, unknown>();
