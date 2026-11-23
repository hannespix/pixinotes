/**
 * M501: Pixi, das Maskottchen — das Verhalten als kleine Zustandsmaschine, getrennt von der Darstellung.
 *
 * Kein Zeichnen, kein DOM, keine eigenen Zeitgeber: Die Karte fragt `schritt()`, wann sie wiederkommen soll, und
 * stellt dafür EINEN setTimeout. Uhr und Zufall kommen von außen — so lässt sich das Verhalten mit beschleunigter Uhr
 * durchspielen (Prüfreihe m501). Ziel aus dem Wunsch: „lustige kleine abwechslungsreiche Animationen, dass es nie
 * langweilig wird“ — darum gewichteter Zufall, nie dieselbe Animation zweimal hintereinander, Pausen dazwischen,
 * nach langer Ruhe Gähnen und Einschlafen.
 */
import type { PixiAugen, PixiMund } from './pixiBild';

export type PixiAnim =
  | 'blinzeln' | 'doppelblinzeln' | 'umsehen' | 'huepfen' | 'freudensprung' | 'winken' | 'niesen' | 'funkeln'
  | 'tanzen' | 'kopfschief' | 'pfeifen' | 'gaehnen' | 'staunen'
  | 'herzchen' | 'kichern' | 'schwindelig' | 'erschrecken' | 'einschlafen' | 'schlafen' | 'aufwachen';

export type PixiArme = 'winken' | 'hoch' | 'tanzen';
export type PixiEffekt = 'zzz' | 'noten' | 'herzen' | 'funken' | 'ausruf' | 'puff' | 'sterne' | 'kichern';

export interface PixiAnimDef {
  /** Dauer in ms (Infinity: bis etwas sie beendet — Schlafen) */
  dauer: number;
  /** Gewicht im Zufall der Ruhe-Animationen; ohne: nur als Reaktion */
  gewicht?: number;
  /** auch bei „Bewegung reduzieren“ erlaubt (nur Augen, keine Sprünge) */
  ruhig?: boolean;
  augen: PixiAugen;
  mund: PixiMund;
  arme?: PixiArme;
  effekt?: PixiEffekt;
  /** Die Augen folgen in dieser Zeit nicht dem Zeiger (sie sind zu, drehen sich oder schauen selbst umher) */
  eigenerBlick?: boolean | Blick;
}

export const PIXI_ANIMATIONEN: Record<PixiAnim, PixiAnimDef> = {
  blinzeln: { dauer: 360, gewicht: 5, ruhig: true, augen: 'offen', mund: 'laecheln' },
  doppelblinzeln: { dauer: 820, gewicht: 3, ruhig: true, augen: 'offen', mund: 'laecheln' },
  umsehen: { dauer: 2400, gewicht: 4, augen: 'offen', mund: 'laecheln', eigenerBlick: true },
  huepfen: { dauer: 900, gewicht: 3, augen: 'offen', mund: 'laecheln' },
  freudensprung: { dauer: 1300, gewicht: 1.5, augen: 'froh', mund: 'grinsen', arme: 'hoch', eigenerBlick: true },
  winken: { dauer: 2000, gewicht: 2, augen: 'froh', mund: 'laecheln', arme: 'winken', eigenerBlick: true },
  niesen: { dauer: 1800, gewicht: 1, augen: 'kneifen', mund: 'o', effekt: 'puff', eigenerBlick: true },
  funkeln: { dauer: 1600, gewicht: 2.5, augen: 'offen', mund: 'o', effekt: 'funken', eigenerBlick: { dx: 1, dy: -2 } },
  tanzen: { dauer: 2600, gewicht: 1.5, augen: 'froh', mund: 'grinsen', arme: 'tanzen', effekt: 'noten', eigenerBlick: true },
  kopfschief: { dauer: 2000, gewicht: 2.5, augen: 'offen', mund: 'o' },
  pfeifen: { dauer: 2600, gewicht: 1.5, augen: 'offen', mund: 'pfeifen', effekt: 'noten', eigenerBlick: { dx: -1, dy: -1 } },
  gaehnen: { dauer: 2200, gewicht: 1, augen: 'zu', mund: 'gaehnen', eigenerBlick: true },
  staunen: { dauer: 1800, gewicht: 1.5, augen: 'gross', mund: 'o', effekt: 'funken', eigenerBlick: { dx: 0, dy: -2 } },
  herzchen: { dauer: 1800, augen: 'herz', mund: 'grinsen', effekt: 'herzen', eigenerBlick: true },
  kichern: { dauer: 1600, augen: 'kneifen', mund: 'grinsen', effekt: 'kichern', eigenerBlick: true },
  schwindelig: { dauer: 2800, augen: 'spirale', mund: 'schief', effekt: 'sterne', eigenerBlick: true },
  erschrecken: { dauer: 1000, augen: 'gross', mund: 'o', effekt: 'ausruf' },
  einschlafen: { dauer: 2400, augen: 'halb', mund: 'klein', eigenerBlick: true },
  schlafen: { dauer: Infinity, augen: 'zu', mund: 'klein', effekt: 'zzz', eigenerBlick: true },
  aufwachen: { dauer: 1200, augen: 'gross', mund: 'o', effekt: 'funken' },
};
export const PIXI_ANIM_NAMEN = Object.keys(PIXI_ANIMATIONEN) as PixiAnim[];

/** Ruhe ohne Zeigerbewegung, nach der Pixi gähnt und einschläft */
export const SCHLAF_NACH = 45_000;
/** Pause zwischen zwei Animationen */
export const PAUSE_MIN = 2200;
export const PAUSE_MAX = 7000;
/** So lange ohne Zeiger, bis Pixi selbst irgendwohin schaut */
export const BLICK_RUHE_NACH = 4000;

/** Was ein Klick oder Tipp auslöst (abwechselnd, nie zweimal dasselbe) */
const KLICK: Array<[PixiAnim, number]> = [['herzchen', 3], ['freudensprung', 1.5], ['winken', 1.2], ['kichern', 1]];

export interface PixiOptionen {
  /** „Bewegung reduzieren“: nur Augen folgen und Blinzeln */
  reduziert: boolean;
  /** Darf nach langer Ruhe einschlafen */
  schlafen: boolean;
}

export interface Blick { dx: number; dy: number }

/**
 * Blickrichtung zum Zeiger: Versatz der Augen im 32er-Raster, je Achse −2 … 2 (halbe Pixel des Originals).
 * `vx`, `vy`: Weg von den Augen zum Zeiger in Bildschirm-Pixeln, `groesse`: Breite der Figur in Bildschirm-Pixeln.
 * Ganz nah schaut Pixi geradeaus (dich an), in mittlerer Nähe nur halb zur Seite, weiter weg ganz.
 */
export function blickZu(vx: number, vy: number, groesse: number): Blick {
  const d = Math.hypot(vx, vy);
  const g = Math.max(8, groesse);
  if (d < g * 0.12) return { dx: 0, dy: 0 };
  const staerke = d < g * 0.45 ? 1 : 2;
  const rund = (v: number) => Math.max(-2, Math.min(2, Math.round(v))) || 0;
  return { dx: rund((vx / d) * staerke), dy: rund((vy / d) * staerke) };
}

const RUHE_BLICKE: Blick[] = [{ dx: -2, dy: 0 }, { dx: 2, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: -1 }, { dx: 1, dy: 1 }, { dx: 0, dy: 0 }, { dx: 2, dy: -1 }];

export class PixiHirn {
  /** laufende Animation (null: Pause) */
  anim: PixiAnim | null = null;
  /** zuletzt gestartete Animation — die nächste Zufallswahl schließt sie aus */
  letzte: PixiAnim | null = null;
  schlaf: 'wach' | 'muede' | 'schlaeft' = 'wach';
  /** wohin Pixi von selbst schaut, wenn eine Weile kein Zeiger kommt */
  ruheBlick: Blick = { dx: 0, dy: 0 };
  private bis = 0;
  private naechste: number;
  private aktivSeit: number;
  private folge: PixiAnim[] = [];

  constructor(
    private jetzt: () => number,
    private zufall: () => number,
    public opt: PixiOptionen,
    /** nach jedem Wechsel (Animation, Pause, Schlaf) — die Darstellung zieht nach */
    private melden: () => void,
  ) {
    const t = jetzt();
    this.aktivSeit = t;
    this.naechste = t + 900 + this.zufall() * 1600;
  }

  get def(): PixiAnimDef | null { return this.anim ? PIXI_ANIMATIONEN[this.anim] : null; }

  /** Gewichtete Wahl, ohne die zuletzt gespielte */
  private waehle(liste: Array<[PixiAnim, number]>): PixiAnim {
    const frei = liste.filter(([a]) => a !== this.letzte);
    const summe = frei.reduce((s, [, g]) => s + g, 0);
    let r = this.zufall() * summe;
    for (const [a, g] of frei) { r -= g; if (r < 0) return a; }
    return frei[frei.length - 1][0];
  }

  private ruhePool(): Array<[PixiAnim, number]> {
    return PIXI_ANIM_NAMEN
      .filter((a) => PIXI_ANIMATIONEN[a].gewicht && (!this.opt.reduziert || PIXI_ANIMATIONEN[a].ruhig))
      .map((a) => [a, PIXI_ANIMATIONEN[a].gewicht!] as [PixiAnim, number]);
  }

  private starte(a: PixiAnim) {
    const t = this.jetzt();
    this.anim = a;
    this.letzte = a;
    this.bis = t + PIXI_ANIMATIONEN[a].dauer;
    if (a === 'schlafen') this.schlaf = 'schlaeft';
    else if (a === 'einschlafen') this.schlaf = 'muede';
    else if (a !== 'gaehnen' || !this.folge.length) this.schlaf = 'wach';
    this.melden();
  }

  private pause() {
    const t = this.jetzt();
    this.anim = null;
    this.naechste = t + PAUSE_MIN + this.zufall() * (PAUSE_MAX - PAUSE_MIN);
    this.ruheBlick = RUHE_BLICKE[Math.floor(this.zufall() * RUHE_BLICKE.length)] ?? { dx: 0, dy: 0 };
    this.melden();
  }

  /** Weiterschalten; liefert, in wie vielen ms die Karte wieder fragen soll (Infinity: erst bei einem Ereignis) */
  schritt(): number {
    const t = this.jetzt();
    if (this.anim) {
      if (t < this.bis) return this.bis - t;
      const weiter = this.folge.shift();
      if (weiter) { this.starte(weiter); return PIXI_ANIMATIONEN[weiter].dauer; }
      this.pause();
      return this.naechste - t;
    }
    if (t < this.naechste) return this.naechste - t;
    // lange Ruhe: erst gähnen (falls nicht eben schon), dann einschlafen
    if (this.opt.schlafen && !this.opt.reduziert && t - this.aktivSeit >= SCHLAF_NACH) {
      this.folge = this.letzte === 'gaehnen' ? ['schlafen'] : ['einschlafen', 'schlafen'];
      this.starte(this.letzte === 'gaehnen' ? 'einschlafen' : 'gaehnen');
      return PIXI_ANIMATIONEN[this.anim!].dauer;
    }
    this.starte(this.waehle(this.ruhePool()));
    return PIXI_ANIMATIONEN[this.anim!].dauer;
  }

  /** Irgendwo auf dem Board bewegt sich der Zeiger (hält wach, weckt aber nicht) */
  aktivitaet() { this.aktivSeit = this.jetzt(); }

  get schlaeft() { return this.schlaf !== 'wach' || this.folge.length > 0; }

  /** Der Zeiger kommt nah heran (oder tippt) — ein schlafender Pixi wacht auf */
  nah(): boolean {
    this.aktivSeit = this.jetzt();
    if (!this.schlaeft) return false;
    this.folge = [];
    this.schlaf = 'wach';
    this.starte('aufwachen');
    return true;
  }

  /** Klick oder Tipp auf Pixi */
  tippen() {
    if (this.nah()) return;
    if (this.opt.reduziert) { this.starte(this.waehle([['blinzeln', 1], ['doppelblinzeln', 1]])); return; }
    this.starte(this.waehle(KLICK));
  }

  /** Erkannte Geste (kitzeln, Kreise, plötzliche Nähe). Liefert, ob sie etwas ausgelöst hat. */
  reaktion(a: 'kichern' | 'schwindelig' | 'erschrecken'): boolean {
    if (this.opt.reduziert || this.schlaeft) return false;
    if (this.anim === a) return false;   // läuft schon
    // Erschrecken unterbricht keine andere Reaktion (z. B. die Herzchen gleich nach dem Klick)
    if (a === 'erschrecken' && this.anim && !PIXI_ANIMATIONEN[this.anim].gewicht) return false;
    this.starte(a);
    return true;
  }

  /** Optionen geändert (z. B. Schlafen verboten): ein schlafender Pixi wacht auf */
  optionen(o: PixiOptionen) {
    this.opt = o;
    if ((!o.schlafen || o.reduziert) && this.schlaeft) this.nah();
    if (o.reduziert && this.anim && !PIXI_ANIMATIONEN[this.anim].ruhig) this.pause();
  }
}

/* ---------- Gesten-Erkennung (reine Rechnung über die letzten Zeigerpunkte) ---------- */

export interface ZeigerPunkt { x: number; y: number; t: number }

/** Kitzeln: schnelles Hin-und-her über der Figur — mindestens vier Richtungswechsel binnen einer Sekunde */
export function istKitzeln(punkte: ZeigerPunkt[], drin: (p: ZeigerPunkt) => boolean, jetzt: number): boolean {
  const p = punkte.filter((q) => jetzt - q.t <= 1000 && drin(q));
  if (p.length < 6) return false;
  let wechsel = 0; let richtung = 0; let weg = 0;
  for (let i = 1; i < p.length; i++) {
    const dx = p[i].x - p[i - 1].x;
    if (Math.abs(dx) < 2) continue;
    weg += Math.abs(dx);
    const r = Math.sign(dx);
    if (richtung && r !== richtung) wechsel += 1;
    richtung = r;
  }
  return wechsel >= 4 && weg >= 120;
}

/** Schwindelig: der Zeiger kreist schnell um Pixi — fast zwei volle Runden binnen zweieinhalb Sekunden */
export function istKreisen(punkte: ZeigerPunkt[], mitte: { x: number; y: number }, groesse: number, jetzt: number): boolean {
  const p = punkte.filter((q) => jetzt - q.t <= 2500 && Math.hypot(q.x - mitte.x, q.y - mitte.y) < groesse * 4 && Math.hypot(q.x - mitte.x, q.y - mitte.y) > groesse * 0.2);
  if (p.length < 12) return false;
  let summe = 0;
  for (let i = 1; i < p.length; i++) {
    let d = Math.atan2(p[i].y - mitte.y, p[i].x - mitte.x) - Math.atan2(p[i - 1].y - mitte.y, p[i - 1].x - mitte.x);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    summe += d;
  }
  return Math.abs(summe) >= Math.PI * 3.5;
}

/** Erschrecken: der Zeiger war eben (binnen einer Viertelsekunde) noch weit weg und ist plötzlich ganz nah */
export function istPloetzlichNah(punkte: ZeigerPunkt[], mitte: { x: number; y: number }, groesse: number): boolean {
  const b = punkte[punkte.length - 1];
  if (!b || Math.hypot(b.x - mitte.x, b.y - mitte.y) >= groesse * 0.7) return false;
  for (let i = punkte.length - 2; i >= 0 && b.t - punkte[i].t <= 250; i--) {
    if (Math.hypot(punkte[i].x - mitte.x, punkte[i].y - mitte.y) > groesse * 3) return true;
  }
  return false;
}
