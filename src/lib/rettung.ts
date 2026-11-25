// M529 (M522 O2): Rettungskopie eines unlesbaren gespeicherten Stands.
//
// War der gespeicherte Stand (`pixinotes-board` in localStorage) kein lesbares JSON — möglich nur durch einen Eingriff
// von außen oder einen abgebrochenen Schreibvorgang —, startete PixiNotes leer und überschrieb ihn mit dem nächsten
// Speichern. Der Rohtext war weg. Jetzt wird er vorher in IndexedDB aufgehoben (die letzten drei), es gibt einen
// Hinweis, und unter Einstellungen → Daten lässt er sich herunterladen oder verwerfen. store/speicher.ts hält das
// erste Speichern zurück, bis die Kopie liegt.
import { idbGet, idbSet, idbDel } from './syncFolder';

const KEY = 'pixinotes:rettung';
export const RETTUNG_EREIGNIS = 'pixinotes:rettung';
export interface Rettung { am: string; text: string }

export async function rettungSichern(roh: string): Promise<void> {
  const alt = (await idbGet<Rettung[]>(KEY).catch(() => undefined)) ?? [];
  await idbSet(KEY, [...alt, { am: new Date().toISOString(), text: roh }].slice(-3));
  window.dispatchEvent(new CustomEvent(RETTUNG_EREIGNIS));
  // Der Hinweis kommt, wenn die Oberfläche steht
  setTimeout(() => {
    void import('../store/hinweise').then(({ hinweisMitKnopf }) => hinweisMitKnopf(
      'Der gespeicherte Stand war nicht lesbar – PixiNotes startet leer. Eine Rettungskopie liegt unter Einstellungen → Daten.',
      'Herunterladen', () => { void rettungHerunterladen(); }, 20000,
    ));
  }, 1500);
}
export const rettungen = async (): Promise<Rettung[]> => (await idbGet<Rettung[]>(KEY).catch(() => undefined)) ?? [];
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
  window.dispatchEvent(new CustomEvent(RETTUNG_EREIGNIS));
}
