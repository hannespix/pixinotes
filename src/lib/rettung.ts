// M529 (M522 O2): Rettungskopie eines unlesbaren gespeicherten Stands.
//
// War der gespeicherte Stand (`pixinotes-board` in localStorage) kein lesbares JSON — möglich nur durch einen Eingriff
// von außen oder einen abgebrochenen Schreibvorgang —, startete PixiNotes leer und überschrieb ihn mit dem nächsten
// Speichern. Der Rohtext war weg. Jetzt legt store/speicher.ts ihn sofort (synchron, vor jedem Überschreiben) in
// sessionStorage (`pixinotes-rettung`, eigenes Kontingent — localStorage ist in diesem Fall oft voll). Dieser Teil
// lädt im Leerlauf mit den Einstellungen (App.tsx → ladeEinstellungen), legt den Text in die IndexedDB (die letzten
// drei), gibt einen Hinweis und bietet ihn unter Einstellungen → Daten zum Herunterladen oder Verwerfen an. So steht im
// Start-Paket nur eine Zeile.
import { idbGet, idbSet, idbDel } from './syncFolder';
import { useBoard } from '../store';

const KEY = 'pixinotes:rettung';
/** Hier legt store/speicher.ts die Kopie zuerst ab */
const SITZUNG = 'pixinotes-rettung';
export const RETTUNG_EREIGNIS = 'pixinotes:rettung';
export interface Rettung { am: string; text: string }

const ausSitzung = (): string | null => { try { return sessionStorage.getItem(SITZUNG); } catch { return null; } };

/** Die Kopie aus sessionStorage in die Geräte-Ablage übernehmen (einmal, beim Laden dieses Teils) */
async function aufnehmen(): Promise<void> {
  const roh = ausSitzung();
  if (!roh) return;
  const alt = (await idbGet<Rettung[]>(KEY).catch(() => undefined)) ?? [];
  if (!alt.some((r) => r.text === roh)) await idbSet(KEY, [...alt, { am: new Date().toISOString(), text: roh }].slice(-3));
  try { sessionStorage.removeItem(SITZUNG); } catch { /* bleibt liegen */ }
  window.dispatchEvent(new CustomEvent(RETTUNG_EREIGNIS));
  useBoard.getState().showToast('Gespeicherter Stand nicht lesbar – PixiNotes startet leer. Rettungskopie: Einstellungen → Daten.', false, 20000);
}
if (typeof window !== 'undefined') void aufnehmen().catch(() => {});

/** Alle Rettungskopien — auch eine, die noch in sessionStorage liegt */
export async function rettungen(): Promise<Rettung[]> {
  const liste = (await idbGet<Rettung[]>(KEY).catch(() => undefined)) ?? [];
  const roh = ausSitzung();
  return roh && !liste.some((r) => r.text === roh) ? [...liste, { am: new Date().toISOString(), text: roh }] : liste;
}
/** Die jüngste Rettungskopie als Datei — so, wie sie im Speicher stand */
export async function rettungHerunterladen(): Promise<boolean> {
  const r = (await rettungen()).at(-1);
  if (!r) return false;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([r.text], { type: 'text/plain;charset=utf-8' }));
  a.download = `pixinotes-rettung-${r.am.slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  return true;
}
export async function rettungVerwerfen(): Promise<void> {
  await idbDel(KEY);
  try { sessionStorage.removeItem(SITZUNG); } catch { /* egal */ }
  window.dispatchEvent(new CustomEvent(RETTUNG_EREIGNIS));
}
