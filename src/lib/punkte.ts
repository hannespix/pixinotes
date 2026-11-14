// M377: Punkte auf Karten — abstimmen, was wichtig ist („Punkte kleben").
//
// Jede Person kann jeder Karte einen Punkt geben (und ihn wieder nehmen). Die Punkte liegen an der Karte
// (data.punkte) und reisen mit ihr — zu allen Geräten, in die Sicherung, in den Export.
//
// Wie bei den Entscheidungs-Bubbles (lib/bubbles.ts) stimmen VIELE gleichzeitig ab. Darum gehört jeder Punkt
// seiner Person: ein Eintrag je Kennung, mit Zeitstempel; von zwei Fassungen gilt die jüngere, ein
// zurückgenommener Punkt bleibt als Eintrag mit n = 0 stehen (sonst käme er beim Vereinigen wieder). Zwei
// Fassungen einer Karte lassen sich so immer verlustfrei vereinigen — auch wenn der eine gerade ihren Text
// ändert und der andere ihr einen Punkt gibt.
export interface Punkt { n: number; t: number }
export type Punkte = Record<string, Punkt>;

const sortiert = (p: Punkte): Punkte => { const aus: Punkte = {}; for (const k of Object.keys(p).sort()) aus[k] = p[k]; return aus; };
const gueltig = (v: unknown): v is Punkt => !!v && typeof v === 'object' && typeof (v as Punkt).n === 'number' && typeof (v as Punkt).t === 'number';
/** Die Punkte einer Karte (nie werfen: Unlesbares zählt als „keine") */
export function punkteVon(daten: unknown): Punkte {
  const p = (daten as { punkte?: unknown } | undefined)?.punkte;
  if (!p || typeof p !== 'object') return {};
  const aus: Punkte = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) if (gueltig(v)) aus[k] = { n: v.n > 0 ? 1 : 0, t: v.t };
  return aus;
}
export const punkteZahl = (daten: unknown): number => Object.values(punkteVon(daten)).filter((p) => p.n > 0).length;
export const hatPunktVon = (daten: unknown, wer: string): boolean => (punkteVon(daten)[wer]?.n ?? 0) > 0;
/** Meinen Punkt setzen oder nehmen — liefert die neue Tabelle (sortierte Schlüssel: jedes Gerät schreibt sie gleich) */
export function punktSetzen(daten: unknown, wer: string, an: boolean): Punkte {
  const p = punkteVon(daten);
  return sortiert({ ...p, [wer]: { n: an ? 1 : 0, t: Math.max(Date.now(), (p[wer]?.t ?? 0) + 1) } });
}
/** Zwei Fassungen vereinigen: je Person die jüngere (bei gleichem Stempel entscheidet der Inhalt — überall gleich) */
export function punkteMischen(a: unknown, b: unknown): Punkte {
  const x = punkteVon({ punkte: a }); const y = punkteVon({ punkte: b });
  const aus: Punkte = {};
  for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
    const l = x[k]; const r = y[k];
    aus[k] = !l ? r : !r ? l : l.t !== r.t ? (l.t > r.t ? l : r) : (l.n >= r.n ? l : r);
  }
  return aus;
}
export const punkteGleich = (a: unknown, b: unknown): boolean => JSON.stringify(punkteMischen(a, undefined)) === JSON.stringify(punkteMischen(b, undefined));

// ---------- Punkte-Modus: Karten antippen statt auswählen ----------
export const PUNKTE_MODUS = 'pixinotes:punkte-modus';
let modus = false;
export const punkteModus = (): boolean => modus;
export function punkteModusSetzen(an: boolean): void {
  if (modus === an) return;
  modus = an;
  document.documentElement.toggleAttribute('data-punkte-modus', an);
  window.dispatchEvent(new CustomEvent(PUNKTE_MODUS));
}
