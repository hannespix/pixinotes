// M534: Suche ohne Umlaute — „ubersicht" findet „Übersicht", „vertraege" „Verträge", „strasse" „Straße".
//
// Text und Eingabe werden gleich „gefaltet": klein, Akzente weg (ä → a, é → e), ß → ss und die Umschreibungen
// ae/oe/ue → a/o/u. Weil beide Seiten dieselbe Faltung durchlaufen, findet „Verträge", „vertrage" und „vertraege"
// dasselbe; die Tippfehler-Toleranz der Suche (uFuzzy, ein Fehler je Wort) arbeitet danach auf dem gefalteten Text.
// `falteMitStellen` merkt sich zu jedem Zeichen, woher es im Original kam — damit Ausschnitt und Markierung auf
// dem ursprünglichen Text an der richtigen Stelle stehen.

const OHNE_ZEICHEN = /[̀-ͯ]/g;

/** Gefalteter Text und je Zeichen die Stelle im Original */
export function falteMitStellen(text: string): { t: string; stelle: number[] } {
  let t = '';
  const stelle: number[] = [];
  for (let k = 0; k < text.length; k += 1) {
    const roh = text[k];
    const z = roh === 'ß' || roh === 'ẞ' ? 'ss' : roh.toLowerCase().normalize('NFD').replace(OHNE_ZEICHEN, '');
    for (const c of z) {
      // ae/oe/ue → a/o/u: das „e" fällt weg, wenn es auf a, o oder u folgt („Quelle" wird auf beiden Seiten „qulle")
      if (c === 'e' && /[aou]/.test(t[t.length - 1] ?? '')) continue;
      t += c;
      stelle.push(k);
    }
  }
  return { t, stelle };
}

/** Nur der gefaltete Text — dasselbe Ergebnis wie `falteMitStellen(text).t`, aber am Stück (für den ganzen Suchindex) */
export const falte = (text: string): string =>
  text.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(OHNE_ZEICHEN, '').replace(/([aou])e+/g, '$1');

/**
 * Bereiche im Original, an denen eines der Wörter (gefaltet) steht — für `<mark>`. Überlappende werden zusammengelegt.
 */
export function fundstellen(text: string, worte: string[]): [number, number][] {
  const { t, stelle } = falteMitStellen(text);
  const bereiche: [number, number][] = [];
  for (const w of worte.map(falte).filter((x) => x.length >= 2)) {
    for (let at = t.indexOf(w); at !== -1; at = t.indexOf(w, at + w.length)) {
      bereiche.push([stelle[at], stelle[at + w.length - 1] + 1]);
    }
  }
  bereiche.sort((a, b) => a[0] - b[0]);
  const zusammen: [number, number][] = [];
  for (const b of bereiche) {
    const letzter = zusammen[zusammen.length - 1];
    if (letzter && b[0] <= letzter[1]) letzter[1] = Math.max(letzter[1], b[1]);
    else zusammen.push([...b]);
  }
  return zusammen;
}
