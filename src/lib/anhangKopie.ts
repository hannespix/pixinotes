// M388: Beim Kopieren eines Boards reisen die Inhalte mit, die nicht im Board stehen.
//
// Große Dateien und die Quelltexte eigener Tools liegen im Gerätespeicher (IndexedDB) unter der Kennung ihrer
// Karte. Eine Kopie bekommt frische Kennungen — ohne diesen Schritt zeigte die kopierte Datei-Karte „liegt nicht
// auf diesem Gerät", das kopierte Tool hatte keinen Quelltext. Betraf „Board duplizieren", „Projekt duplizieren"
// und „Eigene Kopie anlegen" bei einem geteilten Board.
import { idbGet, idbSet } from './syncFolder';

const VORSILBEN = ['file:', 'happ:', 'happ-state:', 'happ-state-at:'];

/** Für jedes Paar (alte Kennung → neue Kennung) die Inhalte im Gerätespeicher kopieren; danach erfahren es die Karten */
export async function anhaengeKopieren(paare: Array<[string, string]>): Promise<void> {
  let kopiert = 0;
  for (const [alt, neu] of paare) {
    for (const v of VORSILBEN) {
      try {
        const inhalt = await idbGet<unknown>(`${v}${alt}`);
        if (inhalt === undefined || inhalt === null) continue;
        await idbSet(`${v}${neu}`, inhalt);
        kopiert += 1;
      } catch { /* dieser Inhalt bleibt aus — die Karte zeigt es an */ }
    }
  }
  if (kopiert > 0) window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
}
