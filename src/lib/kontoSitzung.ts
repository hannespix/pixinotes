// M459: Die Konto-Sitzung, ohne den Abgleich.
//
// lib/kontoSync.ts (Abgleich mit Google Drive, OneDrive, PixiNotes-Konto) ist groß und wird nur gebraucht, wenn ein
// Konto angemeldet ist. Was der Start trotzdem wissen muss — ist eins angemeldet, welches, wie heißt es —, steht
// hier. kontoSync reicht alles weiter; wer kontoSync ohnehin lädt, ändert nichts.

/** M328: 'supabase' = das eigene PixiNotes-Konto (E-Mail), Ablage beim Betreiber */
export type Anbieter = 'google' | 'ms' | 'supabase';

export interface KontoSitzung {
  anbieter: Anbieter;
  /** OAuth-Client-ID — beim PixiNotes-Konto der öffentliche Anon-Key */
  clientId: string;
  tenant?: string;
  token?: string;
  tokenExp?: number;      // epoch ms
  refreshToken?: string;  // Microsoft und PixiNotes-Konto (Google-SPAs bekommen keinen)
  name?: string;          // Anzeige: E-Mail oder Name des Kontos
  /** PixiNotes-Konto: Adresse des Projekts und die eigene Nutzer-Id (für Realtime-Filter) */
  url?: string;
  userId?: string;
}

export const KONTO_LS_KEY = 'pixinotes-konto-sync';

export function loadKonto(): KontoSitzung | null {
  try {
    const s = JSON.parse(localStorage.getItem(KONTO_LS_KEY) ?? 'null') as KontoSitzung | null;
    return s?.anbieter && s.clientId && (s.token || s.refreshToken) ? s : null;
  } catch {
    return null;
  }
}
export const kontoLabel = (s: KontoSitzung | null = loadKonto()): string => (s?.anbieter === 'supabase' ? 'PixiNotes-Konto' : s?.anbieter === 'ms' ? 'OneDrive' : 'Google Drive');
/** M328: Ist das angemeldete Konto das eigene PixiNotes-Konto? */
export const kontoIstEigenes = (s: KontoSitzung | null = loadKonto()): boolean => s?.anbieter === 'supabase';
