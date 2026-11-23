// M476: Winziger Teil der Sicherung, der beim Start mitläuft — nur localStorage, keine Abhängigkeiten.
// Der eigentliche Sicherungs-Code (lib/sicherung.ts, ZIP, Dialog) lädt erst nach, wenn es etwas zu tun gibt.

/** Wann zuletzt ALLES gesichert wurde (ISO-Zeit) — von Hand oder automatisch */
export const LETZTE_SICHERUNG_KEY = 'pixinotes:letzte-sicherung';
/** Seit wann dieses Gerät PixiNotes benutzt (für die Erinnerung, solange noch nie gesichert wurde) */
export const SICHERUNG_SEIT_KEY = 'pixinotes:sicherung-seit';
/** Bezugszeit, zu der schon einmal erinnert wurde — dieselbe Lücke wird nur einmal angesprochen */
export const ERINNERT_KEY = 'pixinotes:sicherung-erinnert';
/** '1' = automatisch in einen Ordner sichern (File System Access) */
export const AUTO_KEY = 'pixinotes:auto-sicherung';
/** Wann zuletzt automatisch in den Ordner gesichert wurde */
export const AUTO_LETZTE_KEY = 'pixinotes:auto-sicherung-letzte';

/** Ereignis: Dialog „Sicherung einspielen" öffnen (detail.datei: die Datei, sonst wählt man sie im Dialog) */
export const SICHERUNG_EREIGNIS = 'pixinotes:sicherung-einspielen';
export const sicherungEinspielenOeffnen = (datei?: File): void => {
  window.dispatchEvent(new CustomEvent(SICHERUNG_EREIGNIS, { detail: { datei } }));
};

export const TAG_MS = 24 * 60 * 60 * 1000;
/** Nach so vielen Tagen ohne Sicherung kommt EIN ruhiger Hinweis */
export const ERINNERUNG_TAGE = 14;

const lies = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };

/** Zeit der letzten vollständigen Sicherung (ms) oder null */
export function letzteSicherung(): number | null {
  const t = Date.parse(lies(LETZTE_SICHERUNG_KEY) ?? '');
  return Number.isFinite(t) ? t : null;
}

/**
 * Gibt es beim Start etwas zu tun? Dann (und nur dann) wird lib/sicherung.ts nachgeladen.
 * Stempelt beim ersten Mal „seit", damit die Erinnerung auch ohne je gemachte Sicherung einmal kommt.
 */
export function sicherungStartFaellig(jetzt = Date.now()): boolean {
  try {
    if (!lies(SICHERUNG_SEIT_KEY)) localStorage.setItem(SICHERUNG_SEIT_KEY, new Date(jetzt).toISOString());
  } catch { /* ohne Speicher keine Erinnerung */ }
  if (lies(AUTO_KEY) === '1') {
    const a = Date.parse(lies(AUTO_LETZTE_KEY) ?? '');
    if (!Number.isFinite(a) || jetzt - a >= TAG_MS) return true;
  }
  const bezug = letzteSicherung() ?? Date.parse(lies(SICHERUNG_SEIT_KEY) ?? '');
  if (!Number.isFinite(bezug) || jetzt - bezug < ERINNERUNG_TAGE * TAG_MS) return false;
  return lies(ERINNERT_KEY) !== String(bezug);
}
