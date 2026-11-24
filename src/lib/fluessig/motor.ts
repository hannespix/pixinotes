// M500: Motor der Karte „Flüssige Schrift“ — Ablauf, Eingaben und Effekte. Die Physik, der Zeichner, die Abtastung,
// die Qualitätsregler und die Effekte stammen aus Liquid Type von Hannes Pix (github.com/hannespix/liquidtype,
// src/app.mjs als Vorbild, Werte vom „Sweet Spot“ der MS-Seite, src/MS/ms.mjs). Dieses Modul wird nur per import()
// geholt, sobald eine solche Karte sichtbar ist — nie im Start-JS.
//
// Leistung auf dem Board:
//  - EIN Takt (requestAnimationFrame) für alle Karten, und nur, solange eine Karte wirklich läuft. Kommt eine
//    Flüssigkeit zur Ruhe, wird sie ein letztes Mal scharf gezeichnet und schläft — keine Takte mehr.
//  - Höchstens MAX_AKTIV Karten rechnen gleichzeitig (die zuletzt berührten); weitere bleiben bis dahin stehen.
//  - Außerhalb des Sichtfelds (IntersectionObserver) und bei verdecktem Tab rechnet nichts.
//  - Reduzierte Bewegung (Systemeinstellung): nur ruhend gezeichnet, keine Animation.
import { Fluid, type PhysikWerte, type Pinsel } from './physik';
import { Zeichner, type Ziel } from './zeichner';
import { sampleGlyphs } from './glyphen';
import { createQuality, type Qualitaet } from './qualitaet';
import { burstFrom, dripIndices, idleHand, isCalm, maxAbstand, meanSpeed, scatterAround, Settle } from './effekte';
import type { FluessigZaeh } from '../fluessigDaten';

export interface Einstellung {
  text: string;
  zaeh: FluessigZaeh;
  lebendig: boolean;
  /** wechselt mit Farbe oder Schrift der Karte — die Fläche liest dann Tinte und Schriftart neu */
  aussehen: string;
}

/** M506: Wo die Schrift steht (Anteile der Kartenfläche, 0…1) — die Karte legt dort ihre Klickfläche hin */
export interface Umriss { l: number; o: number; r: number; u: number }

/** Werte der MS-Seite von Liquid Type (src/MS/ms.mjs, `defaults`), dort von Hannes abgestimmt */
const FX = {
  idleDelay: 4000, idleForce: 1.4, assembleSpread: 0.22, assembleMs: 2200, holdMs: 450, burstSpeed: 1200, burstFreeMs: 300,
  dripMin: 6000, dripMax: 11000, dripFallMs: 1300, dripSize: 2.3, magnetStrength: 2.2, magnetRadius: 0.26,
};
/** Sweet Spot der MS-Seite: Zähigkeit 0,55, Oberflächenspannung 0,7, Anziehung 0,85, Impulsstärke 1,8 */
const GRUND: PhysikWerte = { viscosity: 0.55, tension: 0.7, attraction: 0.85, strength: 1.8, dripGravity: 1400 };
const ZAEH: Record<FluessigZaeh, Partial<PhysikWerte>> = {
  fluessig: { viscosity: 0.28, tension: 0.6, attraction: 0.7 },
  mittel: {},
  zaeh: { viscosity: 0.85, attraction: 0.95 },
};
const MAX_AKTIV = 3;
const SCHRIFT_REF = 100;

/** Für Prüfreihen und Fehlersuche: wie oft der Takt lief und wie viele Karten gerade rechnen */
export const zaehler = { takte: 0, laufend: 0, flaechen: 0 };
if (typeof window !== 'undefined') (window as unknown as { pixinotesFluessig: typeof zaehler }).pixinotesFluessig = zaehler;

let zeichner: Zeichner | null = null;
let qualitaet: Qualitaet | null = null;
let kaputt = false;
const flaechen = new Set<Flaeche>();
let raf = 0;
let letzterTakt = 0;
const reduziert = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function zeichnerHolen(): Zeichner | null {
  if (zeichner) return zeichner;
  if (kaputt) return null;
  try {
    const z = new Zeichner();
    z.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      // Neue Fläche, neuer Kontext — die Karten legen ihre Ziele beim nächsten Zeichnen neu an
      if (zeichner === z) zeichner = null;
      for (const f of flaechen) f.zielVerloren();
      setTimeout(() => { for (const f of flaechen) f.neuZeichnen(); }, 400);
    });
    qualitaet ??= createQuality(z.gl, {
      floatSurface: z.floatSurface,
      onChange: ({ changed }) => {
        if (changed === 'resolution' && zeichner) { zeichner.maxScale = qualitaet!.resolution; for (const f of flaechen) f.neuZeichnen(); }
        else for (const f of flaechen) f.abtasten(false);
      },
    });
    z.maxScale = qualitaet.resolution;
    zeichner = z;
    return z;
  } catch (e) {
    console.warn('Flüssige Schrift: keine Grafik', e);
    kaputt = true;
    return null;
  }
}

/** Kann dieses Gerät die Flüssigkeit zeichnen (WebGL2)? Legt den gemeinsamen Kontext beim ersten Mal an. */
export function webgl2Moeglich(): boolean { return !!zeichnerHolen(); }

function wecken(): void {
  if (raf || typeof document === 'undefined' || document.hidden) return;
  // Nur wenn wirklich eine Fläche laufen will — sonst wäre auch ein leerer Takt einer zu viel
  if (![...flaechen].some((f) => f.willLaufen())) return;
  raf = requestAnimationFrame(takt);
}

function takt(t: number): void {
  raf = 0;
  if (document.hidden) { letzterTakt = 0; return; }
  zaehler.takte++;
  const interval = letzterTakt ? t - letzterTakt : 0;
  const dt = letzterTakt ? Math.min(0.04, interval / 1000) : 1 / 60;
  letzterTakt = t;
  const laufen = [...flaechen].filter((f) => f.willLaufen()).sort((a, b) => b.beruehrt - a.beruehrt).slice(0, MAX_AKTIV);
  zaehler.laufend = laufen.length;
  if (!laufen.length) { letzterTakt = 0; return; }
  const arbeit = performance.now();
  for (const f of laufen) f.schritt(t, dt);
  qualitaet?.frame(interval, performance.now() - arbeit);
  if ([...flaechen].some((f) => f.willLaufen())) raf = requestAnimationFrame(takt);
  else { letzterTakt = 0; zaehler.laufend = 0; }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; letzterTakt = 0; qualitaet?.reset(); for (const f of flaechen) f.loslassen(); }
    else wecken();
  });
  // Hell/Dunkel oder Akzentfarbe gewechselt: Tinte neu lesen
  new MutationObserver(() => { for (const f of flaechen) f.farbeNeu(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'class', 'style'] });
  reduziert?.addEventListener?.('change', () => { for (const f of flaechen) { f.loslassen(); f.neuZeichnen(); } wecken(); });
}

/** CSS-Farbe → [r, g, b] in 0..1 */
function farbeLesen(el: Element): [number, number, number] {
  const m = getComputedStyle(el).color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : [0.1, 0.1, 0.1];
}

/** Zeilen für den Text: eine, oder geteilt am Leerzeichen nächst der Mitte — was die größere Schrift erlaubt */
function satz(ctx: CanvasRenderingContext2D, text: string, familie: string, w: number, h: number) {
  const kandidaten: string[][] = [[text]];
  const leer = [...text.matchAll(/ /g)].map((m) => m.index ?? 0);
  if (leer.length) {
    const mitte = text.length / 2, an = leer.reduce((a, b) => (Math.abs(b - mitte) < Math.abs(a - mitte) ? b : a));
    kandidaten.push([text.slice(0, an), text.slice(an + 1)]);
  }
  let best: { zeilen: string[]; groesse: number; hoch: number; tief: number } | null = null;
  for (const zeilen of kandidaten) {
    ctx.font = `500 ${SCHRIFT_REF}px ${familie}`;
    const mass = zeilen.map((z) => ctx.measureText(z));
    const breit = Math.max(1, ...mass.map((m) => m.width));
    const hoch = Math.max(...mass.map((m) => m.actualBoundingBoxAscent || SCHRIFT_REF * 0.72));
    const tief = Math.max(...mass.map((m) => Math.max(0, m.actualBoundingBoxDescent || 0)));
    const block = hoch + tief + (zeilen.length - 1) * SCHRIFT_REF * 1.08;
    const groesse = Math.min(SCHRIFT_REF * (w * 0.86) / breit, SCHRIFT_REF * (h * 0.74) / block, 330);
    // Eine Zeile bleibt, solange zwei nicht deutlich größer würden
    if (!best || groesse > best.groesse * (zeilen.length > 1 ? 1.12 : 1)) best = { zeilen, groesse, hoch: hoch / SCHRIFT_REF, tief: tief / SCHRIFT_REF };
  }
  return best!;
}

export class Flaeche {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private e: Einstellung;
  private w = 0; private h = 0;
  private fluid: Fluid | null = null;
  private ziel: Ziel | null = null;
  private material: HTMLCanvasElement | null = null;
  private ink: [number, number, number] = [0.1, 0.1, 0.1];
  private schriftGroesse = 100;
  private strokeRatio = 8;
  private centre: { x: number; y: number; rx: number; ry: number } | null = null;
  private bereich: { l: number; r: number; o: number; u: number } | null = null;
  private settle = new Settle();
  private pointer = { x: -1000, y: -1000, radius: 60, down: false, id: -1 as number, typ: '', startX: 0, startY: 0, dragged: false, burst: false, cx: 0, cy: 0, since: 0, last: 0 };
  private magnet: Pinsel = { x: 0, y: 0, radius: 0, down: true };
  private magnetAn = false;
  private haltenTimer = 0;
  private burstUntil = 0;
  private tropfen: { indices: number[]; until: number } | null = null;
  private naechsterTropfen = 0;
  private ruhigSeit = 0;
  private idleSince = 0;
  private hand: { x: number; y: number } | null = null;
  private restCalm = 0;
  private ruht = false;
  private zusammensetzen = true;
  private sichtbar = false;
  /** Liegt die Karte bereit zum Anfassen (markiert/Fokus/Folie)? Sonst zieht ein Druck die Karte. */
  greifbar = false;
  /** Zeitpunkt der letzten Berührung — bei mehr als MAX_AKTIV laufenden gewinnt die zuletzt berührte */
  beruehrt = 0;
  /** M506: meldet den Umriss der ruhenden Schrift (null = keine Schrift) — die rahmenlose Karte greift nur dort */
  umrissMelden: ((u: Umriss | null) => void) | null = null;
  private umriss: Umriss | null = null;
  private io: IntersectionObserver | null = null;
  private weg: Array<() => void> = [];

  /**
   * M506: `ereignisse` ist das Element, an dem Zeiger-Ereignisse gehört werden (die Bühne der Karte). Ruhend ist die
   * Fläche selbst nicht anfassbar (pointer-events: none) — Bewegungen über der Klickfläche der Schrift kommen über
   * die Bühne an, damit Schubsen und Magnet bleiben.
   */
  constructor(canvas: HTMLCanvasElement, e: Einstellung, ereignisse: HTMLElement = canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D-Zeichenfläche nicht verfügbar');
    this.ctx = ctx;
    this.e = e;
    this.beruehrt = performance.now();
    this.idleSince = performance.now();
    this.naechsterTropfen = performance.now() + FX.dripMin;
    flaechen.add(this);
    zaehler.flaechen = flaechen.size;
    this.ink = farbeLesen(canvas);
    // Für Prüfreihen und Fehlersuche erreichbar (zustand()) — keine Daten, nur der Ablauf
    (canvas as HTMLCanvasElement & { __fluessig?: Flaeche }).__fluessig = this;
    this.io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((eintraege) => {
      const war = this.sichtbar;
      this.sichtbar = eintraege.some((x) => x.isIntersecting);
      if (this.sichtbar && !war) { this.neuZeichnen(); this.zusammensetzenWennNoetig(); wecken(); }
    }) : null;
    if (this.io) this.io.observe(canvas); else this.sichtbar = true;
    const an = <K extends keyof HTMLElementEventMap>(typ: K, fn: (ev: HTMLElementEventMap[K]) => void) => {
      ereignisse.addEventListener(typ, fn as EventListener);
      this.weg.push(() => ereignisse.removeEventListener(typ, fn as EventListener));
    };
    an('pointerdown', (ev) => this.druck(ev));
    an('pointermove', (ev) => { if (this.pointer.id !== -1 && ev.pointerId !== this.pointer.id) return; this.bewegen(ev); });
    an('pointerup', (ev) => this.los(ev));
    an('pointercancel', (ev) => { if (ev.pointerId === this.pointer.id) this.langerDruck(); this.los(ev); });
    an('lostpointercapture', (ev) => this.los(ev));
    an('pointerleave', () => { this.magnetAn = false; if (!this.pointer.down) this.pointer.last = 0; });
    an('contextmenu', (ev) => { if (this.pointer.id !== -1 && this.pointer.typ !== 'mouse') { ev.preventDefault(); this.langerDruck(); } });
  }

  abmelden(): void {
    flaechen.delete(this);
    zaehler.flaechen = flaechen.size;
    this.io?.disconnect();
    for (const w of this.weg) w();
    clearTimeout(this.haltenTimer);
    if (this.ziel && zeichner) zeichner.freigeben(this.ziel);
    this.ziel = null;
  }

  zielVerloren(): void { this.ziel = null; }

  private get still(): boolean { return !!reduziert?.matches; }

  private werte(): PhysikWerte { return { ...GRUND, ...ZAEH[this.e.zaeh] }; }

  /** Größe in CSS-Pixeln (die Karte meldet sie per ResizeObserver) */
  groesse(w: number, h: number): void {
    w = Math.max(40, Math.round(w)); h = Math.max(30, Math.round(h));
    if (w === this.w && h === this.h && this.fluid) return;
    this.w = w; this.h = h;
    this.pointer.radius = Math.max(40, Math.min(110, w * 0.13));
    qualitaet?.reset();
    this.abtasten(false);
  }

  einstellen(e: Einstellung): void {
    const alt = this.e;
    this.e = e;
    if (e.aussehen !== alt.aussehen) this.ink = farbeLesen(this.canvas);
    if (e.text !== alt.text || e.aussehen !== alt.aussehen) this.abtasten(e.text !== alt.text);
    else if (e.lebendig !== alt.lebendig || e.zaeh !== alt.zaeh) { this.aufwecken(); }
  }

  farbeNeu(): void {
    const neu = farbeLesen(this.canvas);
    if (neu.join() === this.ink.join()) return;
    this.ink = neu;
    this.neuZeichnen();
  }

  /** Den Text neu in Teilchen abtasten; mit `morph` fließt die alte Flüssigkeit in die neue Form */
  abtasten(morph: boolean): void {
    if (!this.w || !this.h) return;
    const z = zeichnerHolen();
    if (!z) return;
    const text = this.e.text.trim();
    const alt = this.fluid;
    const familie = getComputedStyle(this.canvas).fontFamily || 'Georgia, serif';
    const w = this.w, h = this.h;
    const budget = Math.round(Math.max(500, Math.min(2400, (w * h) / 45)) * (qualitaet?.particles ?? 1));
    let punkte: { x: number; y: number }[] = [], spacing = 6;
    if (text) {
      const mess = document.createElement('canvas').getContext('2d')!;
      const s = satz(mess, text, familie, w, h);
      const font = `500 ${s.groesse}px ${familie}`;
      const blockOben = (h - (s.hoch + s.tief + (s.zeilen.length - 1) * 1.08) * s.groesse) / 2 + s.hoch * s.groesse;
      const abt = sampleGlyphs(w, h, (g) => {
        g.font = font; g.textAlign = 'center'; g.fillStyle = 'black';
        s.zeilen.forEach((zeile, i) => g.fillText(zeile, w / 2, blockOben + i * 1.08 * s.groesse));
      }, budget);
      punkte = abt.points; spacing = abt.spacing;
      this.material = abt.material;
      this.strokeRatio = abt.stroke ? abt.stroke / spacing : 8;
      this.schriftGroesse = s.groesse;
      // Eine Web-Schrift (Handschrift der Karte) ist vielleicht noch nicht geladen — dann gleich noch einmal
      if (document.fonts && !document.fonts.check(font, text)) {
        void document.fonts.load(font, text).then(() => { if (this.e.text.trim() === text) this.abtasten(false); }).catch(() => {});
      }
    } else {
      this.material = document.createElement('canvas'); this.material.width = this.material.height = 1;
    }
    this.fluid = new Fluid(punkte, w, h, spacing);
    this.vermessen(punkte);
    this.tropfen = null; this.burstUntil = 0;
    if (!this.ziel) this.ziel = z.neuesZiel();
    z.material(this.ziel, this.material);
    const { pw, ph } = z.groesse(this.ziel, w, h);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    const f = this.fluid;
    if (morph && alt?.n && f.n && !this.still) {
      // Wie im Original: ein kurzer, begrenzter Übergang beim Tippen
      for (let i = 0; i < f.n; i++) {
        const j = Math.min(alt.n - 1, Math.floor(i * alt.n / f.n));
        f.x[i] = f.tx[i] + Math.max(-80, Math.min(80, alt.x[j] - f.tx[i])) * 0.55;
        f.y[i] = f.ty[i] + Math.max(-60, Math.min(60, alt.y[j] - f.ty[i])) * 0.55;
        f.vy[i] = Math.sin(i * 0.19) * 30;
      }
      this.restCalm = 0;
      this.aufwecken();
    } else if (!this.zusammensetzenWennNoetig()) {
      // Alles an seinem Platz: einmal scharf zeichnen und schlafen
      this.restCalm = 1;
      if (!this.pointer.down) this.ruht = true;
      this.zeichnen();
    }
  }

  /** Beim ersten Erscheinen setzt sich die Schrift aus verstreuten Tropfen zusammen (nicht bei reduzierter Bewegung) */
  private zusammensetzenWennNoetig(): boolean {
    const f = this.fluid;
    if (!this.zusammensetzen || !this.sichtbar || !f?.n) return false;
    this.zusammensetzen = false;
    if (this.still) return false;
    scatterAround(f, Math.min(this.w, this.h) * FX.assembleSpread);
    this.settle.start(performance.now(), FX.assembleMs, { viscosity: 0.3, attraction: 0.5, homing: 2 });
    this.restCalm = 0;
    this.aufwecken();
    return true;
  }

  private vermessen(punkte: { x: number; y: number }[]): void {
    if (!punkte.length) { this.centre = this.bereich = null; this.umrissSetzen(null); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of punkte) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    this.centre = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, rx: (x1 - x0) * 0.42, ry: this.schriftGroesse * 0.3 };
    const reach = this.schriftGroesse * FX.magnetRadius * 0.5;
    this.bereich = { l: x0 - reach, r: x1 + reach, o: y0 - reach, u: y1 + reach };
    // M506: Klickfläche = Schrift plus der Rand, in dem der Magnet zieht (mindestens 10 px) — wo die Schrift anzieht,
    // lässt sie sich auch greifen; daneben bleibt das Board das Board
    const rand = Math.max(10, reach), w = this.w || 1, h = this.h || 1;
    this.umrissSetzen({
      l: Math.max(0, (x0 - rand) / w), r: Math.min(1, (x1 + rand) / w),
      o: Math.max(0, (y0 - rand) / h), u: Math.min(1, (y1 + rand) / h),
    });
  }

  private umrissSetzen(u: Umriss | null): void {
    this.umriss = u;
    this.umrissMelden?.(u);
  }

  /** Ruhend neu zeichnen (Farbe, Größe, sichtbar geworden) — ohne einen Takt zu verlangen */
  neuZeichnen(): void {
    if (!this.fluid || !this.ziel || !zeichner) { this.abtasten(false); return; }
    const { pw, ph } = zeichner.groesse(this.ziel, this.w, this.h);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    this.zeichnen();
  }

  private zeichnen(): void {
    const z = zeichnerHolen();
    if (!z || !this.fluid) return;
    if (!this.ziel) {
      this.ziel = z.neuesZiel();
      if (this.material) z.material(this.ziel, this.material);
      z.groesse(this.ziel, this.w, this.h);
    }
    // Dünne Striche bekommen in Bewegung etwas weniger Reichweite (wie im Original)
    const grow = 0.85 + 0.15 * Math.max(0, Math.min(1, (this.strokeRatio - 2) / 4));
    z.zeichne(this.ziel, this.fluid, {
      ink: this.ink,
      calm: this.restCalm,
      fine: grow < 1 ? { from: 1e4, to: 1e4 + 1, grow, amp: 1 } : { from: 0, to: 0, grow: 1, amp: 1 },
    }, this.ctx);
  }

  private aufwecken(): void {
    this.ruht = false; this.ruhigSeit = 0;
    this.beruehrt = performance.now();
    wecken();
  }

  willLaufen(): boolean {
    return this.sichtbar && !this.ruht && !!this.fluid && this.fluid.n > 0 && !this.still;
  }

  /** Ein Bild: Effekte, Physik in festen Schritten von 1/120 s, Ruhe erkennen, zeichnen */
  schritt(t: number, dt: number): void {
    const f = this.fluid;
    if (!f) return;
    this.effekte(t);
    const brush: Pinsel | null = this.pointer.down ? this.pointer : (this.magnetAn ? this.magnet : null);
    this.magnet.radius = this.schriftGroesse * FX.magnetRadius;
    const basis = this.werte();
    const prm = brush === this.magnet ? { ...basis, strength: FX.magnetStrength } : this.settle.params(basis, t);
    // Bei schwachem Prozessor holt ein später Takt nicht die ganze Zeit auf — die Flüssigkeit wird kurz langsamer
    const deckel = (qualitaet?.level.part ?? 0) >= 2 ? 1 / 40 : 0.04;
    let rest = Math.min(deckel, dt);
    while (rest >= 1 / 120 - 1e-6) { f.step(1 / 120, prm, brush); rest -= 1 / 120; }
    const still = 1 - Math.max(0, Math.min(1, (meanSpeed(f) - 12) / 48));
    this.restCalm += (still - this.restCalm) * Math.min(1, dt * 8);
    // Ruhe: kein Druck, keine Einschwingphase, kein Tropfen, nichts Lebendiges — und alles fast an seinem Platz
    const magnetFrisch = this.magnetAn && t - this.pointer.last < 1500;
    const ruhig = !this.pointer.down && !magnetFrisch && t > this.settle.until && !this.burstUntil && !this.tropfen && !this.e.lebendig
      && meanSpeed(f) < 6 && maxAbstand(f) < f.spacing * 0.4;
    if (ruhig) {
      if (!this.ruhigSeit) this.ruhigSeit = t;
      if (t - this.ruhigSeit > 500) { this.ruht = true; this.restCalm = 1; }
    } else this.ruhigSeit = 0;
    this.zeichnen();
  }

  private effekte(t: number): void {
    const f = this.fluid!;
    if (this.burstUntil && t > this.burstUntil) { f.free.fill(0); this.burstUntil = 0; }
    // Nach dem Platzen weiter gedrückt: sind die Buchstaben zurück, zählt der Druck neu
    if (this.pointer.burst && this.pointer.id !== -1 && !this.pointer.down && t > this.settle.until) this.nochmalDruecken(false);
    if (this.tropfen) {
      if (t > this.tropfen.until) { for (const i of this.tropfen.indices) f.free[i] = 0; this.tropfen = null; this.naechsterTropfen = t + FX.dripMin + Math.random() * (FX.dripMax - FX.dripMin); }
    } else if (this.e.lebendig && t > this.naechsterTropfen) {
      if (this.pointer.id === -1 && !this.burstUntil && isCalm(f)) {
        const indices = dripIndices(f, FX.dripSize);
        for (const i of indices) f.free[i] = 1;
        this.tropfen = indices.length ? { indices, until: t + FX.dripFallMs } : null;
      } else this.naechsterTropfen = t + 800;
    }
    // Lebendig: nach einem ruhigen Moment zieht eine unsichtbare Hand durch die Schrift
    if (!this.e.lebendig || this.pointer.down || !this.centre || t - this.idleSince < FX.idleDelay) { this.hand = null; return; }
    const p = idleHand(this.centre, (t - this.idleSince - FX.idleDelay) / 1000);
    if (this.hand) this.stoss(p.x, p.y, (p.x - this.hand.x) * FX.idleForce * GRUND.strength, (p.y - this.hand.y) * FX.idleForce * GRUND.strength, this.pointer.radius * 0.6);
    this.hand = p;
  }

  private stoss(x: number, y: number, dx: number, dy: number, r: number): void {
    if (Math.abs(dx) + Math.abs(dy) < 0.1 || !this.fluid) return;
    this.fluid.impulse(x, y, dx, dy, r);
  }

  private ort(ev: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (this.w / Math.max(1, r.width)), y: (ev.clientY - r.top) * (this.h / Math.max(1, r.height)) };
  }

  private bewegen(ev: PointerEvent): void {
    if (this.still || !this.fluid) return;
    const { x, y } = this.ort(ev);
    const p = this.pointer, jetzt = performance.now();
    // Eine fremde Geste (die Karte wird gerade gezogen) schubst nicht
    const fremd = ev.buttons !== 0 && p.id === -1;
    if (!fremd && p.last) {
      const dx = x - p.x, dy = y - p.y, s = this.werte().strength;
      if (p.down) this.stoss(x, y, dx * 16 * s, dy * 16 * s, p.radius);
      else if (ev.pointerType === 'mouse' && Math.hypot(dx, dy) < 100) this.stoss(x, y, dx * 2.5 * s, dy * 2.5 * s, p.radius * 0.65);
    }
    if (p.id !== -1) { p.cx = ev.clientX; p.cy = ev.clientY; }
    if (p.burst && p.id !== -1 && !p.down && Math.hypot(ev.clientX - p.startX, ev.clientY - p.startY) > 8) this.nochmalDruecken(true);
    if (p.down && !p.dragged && Math.hypot(ev.clientX - p.startX, ev.clientY - p.startY) > 8) { p.dragged = true; clearTimeout(this.haltenTimer); }
    const b = this.bereich;
    this.magnetAn = !fremd && !p.down && ev.pointerType === 'mouse' && !!b && x > b.l && x < b.r && y > b.o && y < b.u;
    this.magnet.x = x; this.magnet.y = y;
    p.x = x; p.y = y; p.last = jetzt;
    if (!fremd) { this.idleSince = jetzt; this.aufwecken(); }
  }

  private druck(ev: PointerEvent): void {
    if (!this.greifbar || this.still || !this.fluid || this.pointer.id !== -1) return;
    this.bewegen(ev);
    Object.assign(this.pointer, { id: ev.pointerId, typ: ev.pointerType, cx: ev.clientX, cy: ev.clientY, burst: false });
    this.magnetAn = false;
    try { this.canvas.setPointerCapture(ev.pointerId); } catch { /* ohne Capture geht es auch */ }
    this.nochmalDruecken(false);
  }

  /** Ein Druck hält die Flüssigkeit am Zeiger; still gehalten platzt sie (wie im Original) */
  private nochmalDruecken(ziehend: boolean): void {
    const p = this.pointer;
    Object.assign(p, { down: true, dragged: ziehend, startX: p.cx, startY: p.cy, since: performance.now() });
    clearTimeout(this.haltenTimer);
    if (!ziehend) this.haltenTimer = window.setTimeout(() => { if (p.down && !p.dragged) this.platzen(p.x, p.y); }, FX.holdMs);
    this.aufwecken();
  }

  /** Das eigene lange Drücken des Handys kann vor holdMs kommen — dann platzt ein still gehaltener Finger sofort */
  private langerDruck(): void {
    const p = this.pointer;
    if (!p.down || p.dragged || p.typ === 'mouse' || performance.now() - p.since < FX.holdMs * 0.6) return;
    clearTimeout(this.haltenTimer);
    this.platzen(p.x, p.y);
  }

  private platzen(x: number, y: number): void {
    const f = this.fluid;
    if (!f) return;
    const jetzt = performance.now();
    burstFrom(f, x, y, FX.burstSpeed);
    f.free.fill(1); this.burstUntil = jetzt + FX.burstFreeMs; this.tropfen = null;
    const p = this.pointer;
    p.down = false; p.dragged = true; p.burst = true; p.startX = p.cx; p.startY = p.cy;
    this.idleSince = jetzt;
    this.settle.start(jetzt, FX.burstFreeMs + 2600, { homing: 2.5 });
    this.restCalm = 0;
    this.aufwecken();
  }

  private los(ev: PointerEvent): void {
    if (this.pointer.id !== -1 && ev.pointerId !== this.pointer.id) return;
    this.loslassen();
  }

  loslassen(): void {
    clearTimeout(this.haltenTimer);
    Object.assign(this.pointer, { down: false, id: -1, dragged: false, burst: false });
    this.magnetAn = false;
  }

  /** Nur für Prüfreihen: wie die Flüssigkeit gerade steht */
  zustand(): { teilchen: number; ruht: boolean; sichtbar: boolean; umriss: Umriss | null } {
    return { teilchen: this.fluid?.n ?? 0, ruht: this.ruht, sichtbar: this.sichtbar, umriss: this.umriss };
  }
}

export function flaecheAnlegen(canvas: HTMLCanvasElement, e: Einstellung, ereignisse?: HTMLElement): Flaeche | null {
  if (!zeichnerHolen()) return null;
  return new Flaeche(canvas, e, ereignisse);
}
