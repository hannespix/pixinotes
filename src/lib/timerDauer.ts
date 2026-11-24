// M512: Freie Eingabe für den Timer für alle (M376) — „90", „90m", „1h30", „1:30", „1,5 h", „45s".
//
// Eine Zahl ohne Einheit sind Minuten: Der häufigste Fall ist „90" auf der Zahlentastatur des Telefons.
// „1:30" ist eine Uhrzeit-Dauer in Stunden und Minuten (wie die Uhr selbst ab einer Stunde zeigt: „1:30:00");
// „1:30:00" sind Stunden, Minuten, Sekunden. Unter dem Feld steht vor dem Start, was verstanden wurde.
// Nur geladen mit der Liste der Gruppe (components/Gruppenraum.tsx), nicht im Start-Bundle.
import { TIMER_MAX_MS, TIMER_MIN_MS } from './gruppenraum';

export type TimerDauer = { ms: number; fehler?: undefined } | { ms?: undefined; fehler: string };

const H = 3_600_000; const M = 60_000; const S = 1000;
const EINHEIT: Record<string, number> = {};
for (const w of ['h', 'std', 'stde', 'stunde', 'stunden', 'hr', 'hrs', 'hour', 'hours']) EINHEIT[w] = H;
for (const w of ['m', 'min', 'mins', 'minute', 'minuten', 'minutes', "'"]) EINHEIT[w] = M;
for (const w of ['s', 'sek', 'sec', 'secs', 'sekunde', 'sekunden', 'second', 'seconds', '"']) EINHEIT[w] = S;

/** Text → Dauer in Millisekunden, oder ein Satz, was nicht stimmt */
export function timerDauerLesen(text: string): TimerDauer {
  const roh = text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  if (!roh) return { fehler: 'Bitte eine Dauer eingeben.' };
  let ms: number | null = null;
  const uhr = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(roh);
  if (uhr) {
    const [, h, m, s] = uhr;
    if (Number(m) < 60 && (s === undefined || Number(s) < 60)) ms = Number(h) * H + Number(m) * M + Number(s ?? 0) * S;
  } else {
    // Folge aus Zahl + Einheit; eine Zahl ohne Einheit nimmt die nächstkleinere nach der vorigen (1h30 → 30 Minuten)
    const teil = /(\d+(?:[.,]\d+)?)\s*([a-zäöü'"]*)\s*/gy;
    let summe = 0; let pos = 0; let vorige = 0; let treffer: RegExpExecArray | null;
    const gesehen = new Set<number>();
    while (pos < roh.length && (treffer = teil.exec(roh))) {
      pos = teil.lastIndex;
      const zahl = Number(treffer[1].replace(',', '.'));
      let einheit = treffer[2] ? EINHEIT[treffer[2]] : (vorige === H ? M : vorige === M ? S : vorige === 0 ? M : 0);
      if (!einheit || gesehen.has(einheit) || (vorige && einheit >= vorige)) { summe = NaN; break; }
      gesehen.add(einheit); vorige = einheit;
      summe += zahl * einheit;
    }
    if (pos === roh.length && Number.isFinite(summe) && gesehen.size) ms = Math.round(summe);
  }
  if (ms === null) return { fehler: 'Bitte eine Dauer wie 90, 1h30 oder 45s eingeben.' };
  if (ms < TIMER_MIN_MS) return { fehler: 'Mindestens 10 Sekunden.' };
  if (ms > TIMER_MAX_MS) return { fehler: 'Höchstens 12 Stunden.' };
  return { ms };
}
