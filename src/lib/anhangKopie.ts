// M388: Beim Kopieren eines Boards reisen die Inhalte mit, die nicht im Board stehen.
//
// Große Dateien und die Quelltexte eigener Tools liegen im Gerätespeicher (IndexedDB) unter der Kennung ihrer
// Karte. Eine Kopie bekommt frische Kennungen — ohne diesen Schritt zeigte die kopierte Datei-Karte „liegt nicht
// auf diesem Gerät", das kopierte Tool hatte keinen Quelltext. Betraf „Board duplizieren", „Projekt duplizieren"
// und „Eigene Kopie anlegen" bei einem geteilten Board.
import { idbGet, idbSet } from './syncFolder';
import { kontoIstEigenes } from './kontoSitzung';

const VORSILBEN = ['file:', 'happ:', 'happ-state:', 'happ-state-at:'];

/** Für jedes Paar (alte Kennung → neue Kennung) die Inhalte im Gerätespeicher kopieren; danach erfahren es die Karten */
export async function anhaengeKopieren(paare: Array<[string, string]>): Promise<void> {
  let kopiert = 0;
  for (const [alt, neu] of paare) {
    let inhaltDa = false;
    for (const v of VORSILBEN) {
      try {
        const inhalt = await idbGet<unknown>(`${v}${alt}`);
        if (inhalt === undefined || inhalt === null) continue;
        await idbSet(`${v}${neu}`, inhalt);
        kopiert += 1;
        if (v === 'file:' || v === 'happ:') inhaltDa = true;
      } catch { /* dieser Inhalt bleibt aus — die Karte zeigt es an */ }
    }
    // M529: Liegt der Inhalt nur im Konto (große Datei, noch nie geöffnet), ihn von dort holen. Sonst bekam die Kopie
    // eine neue Kennung ohne Inhalt — auf keinem Gerät und nicht im Konto (HTTP 400 bei jedem Aufbau der Karte).
    // Nur, wenn das Konto die Datei nennt (ein Live-Tool hat keinen Inhalt — sonst fragte jede Kopie vergeblich).
    if (!inhaltDa && kontoIstEigenes()) {
      try {
        const k = await import('./kontoSync');
        const blob = (await k.kontoDateiBekannt(alt)) ? await k.kontoDateiNachladen(alt) : null;
        if (blob) { await idbSet(`file:${neu}`, blob); kopiert += 1; }
      } catch { /* nicht im Konto — die Karte sagt es */ }
    }
  }
  if (kopiert > 0) window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
}
