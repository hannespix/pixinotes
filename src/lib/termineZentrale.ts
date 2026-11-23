// M469: Termine aus Kalender-Konten in der Aufgaben-Zentrale.
//
// Termine sind keine Aufgaben: Sie bekommen keinen Haken und keine Frist, sondern einen eigenen,
// ruhigen Abschnitt „Termine heute und morgen". Gelesen wird nur, was ein Abruf ohnehin schon
// geholt hat (gemerkteTermine() in calAccounts) — die Zentrale und die Erinnerung lösen beim Start
// keinen Netzverkehr aus (m446). Optional erinnert die App kurz vor Beginn (Standard: aus).
import { anyAccountConnected, gemerkteTermine, type CalAccountEvent } from './calAccounts';
import { tagLokal } from './tag';

export interface ZentralTermin extends CalAccountEvent {
  /** stabil je Termin und Tag — Listen-Schlüssel und Merker „schon erinnert" */
  key: string;
}

/** Kurzname des Kontos, wie ihn Nutzer kennen */
export function kontoKennung(p: CalAccountEvent['provider']): string {
  return p === 'google' ? 'Google' : 'Outlook';
}

const norm = (s: string) => s.toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim();

/** Ganztägige zuerst, dann nach Uhrzeit, dann nach Titel */
function folge(a: CalAccountEvent, b: CalAccountEvent): number {
  if (!a.time !== !b.time) return a.time ? 1 : -1;
  return (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'de');
}

/**
 * Die gemerkten Termine von heute und morgen (Ortszeit).
 *
 * Nicht doppeln: Ein Termin, der in beiden Konten steht (gleicher Tag, Uhrzeit, Titel), erscheint
 * einmal. Ebenso entfällt ein Termin, der schon als Aufgabe mit gleichem Titel am gleichen Tag in der
 * Zentrale steht — vor allem Vorgänge und Meilensteine aus dem Zeitplan, die dort mit Haken stehen.
 */
export function termineHeuteMorgen(
  aufgaben: Array<{ text: string; due?: string }>,
  jetzt: Date = new Date(),
): { heute: ZentralTermin[]; morgen: ZentralTermin[]; heuteIso: string; morgenIso: string; abgedeckt: boolean; stand: number } {
  const heuteIso = tagLokal(jetzt);
  const morgenIso = tagLokal(new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 1));
  const g = gemerkteTermine();
  const schonAufgabe = new Set(aufgaben.filter((a) => a.due).map((a) => `${a.due}|${norm(a.text)}`));
  const fuer = (tag: string): ZentralTermin[] => {
    const gesehen = new Set<string>();
    const aus: ZentralTermin[] = [];
    for (const ev of [...(g.tage[tag] ?? [])].sort(folge)) {
      if (!ev || typeof ev.title !== 'string') continue;
      const titel = norm(ev.title);
      if (schonAufgabe.has(`${tag}|${titel}`)) continue;
      const k = `${tag}|${ev.time ?? ''}|${titel}`;
      if (gesehen.has(k)) continue;
      gesehen.add(k);
      aus.push({ ...ev, date: tag, key: `${ev.provider}|${k}` });
    }
    return aus;
  };
  return {
    heute: fuer(heuteIso),
    morgen: fuer(morgenIso),
    heuteIso,
    morgenIso,
    abgedeckt: Array.isArray(g.tage[heuteIso]) && Array.isArray(g.tage[morgenIso]),
    stand: g.stand,
  };
}

/** Ist überhaupt ein Kalender-Konto verbunden? (Ohne Konto zeigt die Zentrale keinen Abschnitt.) */
export const kontoVerbunden = anyAccountConnected;

// ---------- Erinnerung kurz vor Beginn (Einstellung, Standard aus) ----------
const ERINNERUNG_KEY = 'pixinotes-termin-erinnerung';
const ERINNERT_KEY = 'pixinotes:termin-erinnert';
/** So viele Minuten vorher meldet sich die Erinnerung (der Takt der Zentrale ist 5 Minuten) */
export const TERMIN_VORLAUF_MIN = 15;

export function terminErinnerungAn(): boolean {
  try { return localStorage.getItem(ERINNERUNG_KEY) === '1'; } catch { return false; }
}

export function setTerminErinnerung(an: boolean): void {
  try { localStorage.setItem(ERINNERUNG_KEY, an ? '1' : '0'); } catch { /* privates Fenster */ }
}

/** Termine, die in den nächsten TERMIN_VORLAUF_MIN Minuten beginnen und noch nicht gemeldet wurden — gleich vormerken */
export function termineZuErinnern(aufgaben: Array<{ text: string; due?: string }>, jetzt: Date = new Date()): ZentralTermin[] {
  if (!terminErinnerungAn() || !kontoVerbunden()) return [];
  let erinnert: Set<string>;
  try { erinnert = new Set(JSON.parse(localStorage.getItem(ERINNERT_KEY) ?? '[]') as string[]); } catch { erinnert = new Set(); }
  const treffer = termineHeuteMorgen(aufgaben, jetzt).heute.filter((t) => {
    if (!t.time || erinnert.has(t.key)) return false;
    const [h, m] = t.time.split(':').map(Number);
    const beginn = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate(), h, m);
    const minuten = (beginn.getTime() - jetzt.getTime()) / 60_000;
    return minuten > 0 && minuten <= TERMIN_VORLAUF_MIN;
  });
  if (treffer.length) {
    for (const t of treffer) erinnert.add(t.key);
    try { localStorage.setItem(ERINNERT_KEY, JSON.stringify([...erinnert].slice(-100))); } catch { /* Speicher voll */ }
  }
  return treffer;
}
