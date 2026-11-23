/**
 * M483: Der Datei-Import (lib/importFiles.ts samt Word-, vCard-, Board-Datei- und Präsentations-Lesern) kommt erst,
 * wenn jemand etwas ablegt, einfügt oder anlegt — er gehört nicht in den Start. Hier stehen nur Weichen mit denselben
 * Signaturen; alle Wege waren schon vorher asynchron, für die Aufrufer ändert sich nichts. Im Leerlauf nach dem Start
 * holt App.tsx den Teil still nach (für den ersten Import ohne Verzug und den Offline-Betrieb).
 */
type Import = typeof import('./importFiles');

export const importLaden = (): Promise<Import> => import('./importFiles');

export const importFilesToBoard: Import['importFilesToBoard'] = (...a) => importLaden().then((m) => m.importFilesToBoard(...a));
export const importHtmlAppFromUrl: Import['importHtmlAppFromUrl'] = (...a) => importLaden().then((m) => m.importHtmlAppFromUrl(...a));
export const praesentationAnlegen: Import['praesentationAnlegen'] = (...a) => importLaden().then((m) => m.praesentationAnlegen(...a));
