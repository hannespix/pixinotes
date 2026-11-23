// M459: Konto- und Team-Abgleich erst, wenn es etwas abzugleichen gibt.
//
// lib/kontoSync.ts und lib/gastSync.ts (zusammen über 100 KB Quelltext) liefen vorher bei jedem Start an — auch
// ohne Konto und ohne geteiltes Board, wo beide nur Zuhörer anmeldeten und auf ihren Takt warteten. Jetzt lädt der
// Abgleich sofort beim Start, wenn
//   · ein Konto angemeldet ist (Google Drive, OneDrive, PixiNotes-Konto),
//   · die Adresse von einem Anmelde-Link kommt (#access_token=…),
//   · dieses Gerät als Gast per Link in einem Board ist oder ein geteiltes Board trägt,
// und sonst in dem Augenblick, in dem eines davon eintritt (Anmeldung in den Einstellungen, in einem anderen Fenster,
// Einladung angenommen). Wer die Module direkt braucht (Einladung annehmen, Freigabe-Dialog), holt sie über
// `syncLaden()` — das startet beide genau einmal, in der alten Reihenfolge (erst Konto, dann Gast).
// Das Merkzeichen „hier liegt Ungesichertes" (KONTO_DIRTY_KEY) setzen weiter die Ordner- und WebDAV-Zuhörer im Start
// (lib/syncFolder.ts, lib/webdav.ts) — der Konto-Zuhörer setzte es nur ein drittes Mal.
import { useBoard } from '../store';
import { KONTO_LS_KEY, loadKonto } from './kontoSitzung';

type SyncModule = { konto: typeof import('./kontoSync'); gast: typeof import('./gastSync') };
let ladung: Promise<SyncModule> | null = null;
let geladen: SyncModule | null = null;

/** Konto- und Gast-Abgleich laden und starten (einmal) */
export function syncLaden(): Promise<SyncModule> {
  if (!ladung) {
    ladung = Promise.all([import('./kontoSync'), import('./gastSync')]).then(([konto, gast]) => {
      konto.initKontoSync();
      gast.initGastSync();
      geladen = { konto, gast };
      return geladen;
    });
    ladung.catch(() => { ladung = null; });
  }
  return ladung;
}
/** Läuft der Abgleich schon? */
export const syncGeladen = (): boolean => !!geladen;

const GAST_KEY = 'pixinotes-gast';
/** Gibt es auf diesem Gerät etwas, das der Abgleich betreut? */
export function syncNoetig(): boolean {
  if (loadKonto()) return true;
  // Rückkehr vom E-Mail-Link (lib/kontoSupabase.ts `sbRueckkehrLesen`) — auch mit Fehlermeldung
  if (/(?:^#|&)(?:access_token|error|error_description)=/.test(location.hash)) return true;
  // M479: Rückkehr von „Mit Google anmelden" (?code=… bzw. ?error=…), nur wenn dieses Gerät die Anmeldung begonnen hat
  if (/[?&](?:code|error|error_description)=/.test(location.search) && localStorage.getItem('pixinotes-sb-pkce')) return true;
  try {
    const m = JSON.parse(localStorage.getItem(GAST_KEY) ?? '{}') as Record<string, unknown> | null;
    if (m && typeof m === 'object' && Object.keys(m).length > 0) return true;
  } catch { /* unlesbar: unten weiter */ }
  return useBoard.getState().boards.some((b) => b.gastLink || b.geteiltVon);
}

let gestartet = false;
/** Einmal beim App-Start: gleich laden, wenn nötig — sonst warten, bis es nötig wird */
export function initSyncStart(): void {
  if (gestartet) return;
  gestartet = true;
  if (syncNoetig()) { void syncLaden(); return; }
  const pruefen = () => {
    if (geladen || ladung || !syncNoetig()) return;
    void syncLaden();
  };
  // Angemeldet (Einstellungen → Konto), Einladung angenommen, Konto verbunden
  window.addEventListener('pixinotes:konto', pruefen);
  window.addEventListener('pixinotes:konto-verbunden', pruefen);
  window.addEventListener('hashchange', pruefen);
  // In einem anderen Fenster angemeldet oder als Gast beigetreten (vorher bemerkte das der Takt des Abgleichs)
  window.addEventListener('storage', (e) => { if (e.key === KONTO_LS_KEY || e.key === GAST_KEY || e.key === null) pruefen(); });
  // Ein geteiltes Board kam dazu (Import, anderes Fenster) — nur prüfen, wenn sich die Boards ändern
  const ab = useBoard.subscribe((s, prev) => {
    if (geladen || ladung) { ab(); return; }
    if (s.boards !== prev.boards && s.boards.some((b) => b.gastLink || b.geteiltVon)) pruefen();
  });
  // Anmelden schreibt die Sitzung in den Speicher, bevor es Bescheid gibt — ein ruhiger Blick fängt alles übrige
  window.setInterval(() => { if (!geladen && !ladung && document.visibilityState === 'visible') pruefen(); }, 10_000);
}

/**
 * Anhang aus dem PixiNotes-Konto holen (große Anhänge reisen erst beim Öffnen, M329). Ohne PixiNotes-Konto gibt es
 * dort nichts — dann wird der Konto-Teil gar nicht erst geladen.
 */
export async function kontoDateiHolen(id: string): Promise<Blob | null> {
  if (loadKonto()?.anbieter !== 'supabase') return null;
  return (await import('./kontoSync')).kontoDateiNachladen(id);
}
