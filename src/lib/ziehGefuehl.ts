// M481: Das Gefühl beim Ziehen — EINE Quelle für die Übersicht (M440) und das Board.
//
// Was sich beim Ziehen der Board-Kacheln in der Übersicht gut anfühlt, lässt sich in vier Teile zerlegen:
//   · Heben   — das Gegriffene wird ein wenig größer und bekommt einen tieferen Schatten (CSS: `.dragging`).
//   · Neigen  — es kippt mit dem Tempo in Zugrichtung, wie ein angehobenes Blatt, und schwingt aus, wenn die
//               Hand stillsteht. Eine gedämpfte Feder (rAF), gedeckelt.
//   · Ausweichen — die anderen machen schon während des Ziehens Platz und gleiten dorthin (CSS-Übergang mit
//               leicht überschwingender Kurve); zieht man weiter, kehren sie zurück.
//   · Landen  — beim Loslassen senkt sich das Gegriffene federnd an seinen Platz.
// Die Kurven und Dauern stehen als Tokens in `styles/00-tokens.css` (`--zieh-*`), die Rechnung hier.
// Übersicht und Board benutzen dieselbe Feder und dasselbe Tempo; das Board außerdem `Ausweichen`
// (die Übersicht weicht über ihr Raster aus, siehe Overview.tsx `vorschau`).

import { anzeigeMelden, anzeigeSetzen, type Anzeige } from './zugAnzeige';

/** Rechtecke in Flächen-Punkten */
export interface Kasten { x: number; y: number; w: number; h: number }

/** Möchte der Mensch wenig Bewegung? Dann weder Feder noch Neigung (nur kurze, ruhige Übergänge). */
export const bewegungArm = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Wie weit sich das Gegriffene höchstens neigt. Kleine Karten und Kacheln wie in der Übersicht (7°), große
 * weniger — eine 800 Punkte breite Gantt-Karte, die um 7° kippt, schwenkt ihre Ecken um fast 50 Punkte.
 */
export const neigungsGrenze = (w: number, h: number): number => Math.max(1.5, Math.min(7, (7 * 260) / Math.max(1, w, h)));

/** Wie stark es sich hebt: wie in der Übersicht (6 %), bei großen Karten höchstens ~14 Punkte mehr je Seite. */
export const hebeSkala = (w: number, h: number): number => 1 + Math.max(0.012, Math.min(0.06, 28 / Math.max(1, w, h)));

/**
 * Tempo in Zugrichtung (x), leicht geglättet — Punkte je Millisekunde. `zeit` in ms (Ereignis- oder
 * performance-Zeit, Hauptsache aus einer Quelle).
 */
export function tempoMesser(x0: number, t0: number) {
  let x = x0; let t = t0; let vx = 0;
  return {
    messen(xNeu: number, tNeu: number): number {
      const dt = Math.max(8, tNeu - t);
      vx = vx * 0.6 + ((xNeu - x) / dt) * 0.4;
      x = xNeu; t = tNeu;
      return vx;
    },
    get vx() { return vx; },
  };
}

/** Grad je (Punkt/ms) — in der Übersicht abgestimmt (M440) */
export const NEIGUNG_JE_TEMPO = 9;

export interface Neigung {
  /** Zielwinkel aus dem Tempo setzen (Punkte/ms in Zugrichtung) */
  tempo(vx: number): void;
  /** Mit 0 bzw. ohne Ziel weiterschwingen (bis Ruhe) — nach dem Loslassen */
  loslassen(): void;
  /** Sofort gerade (Fanglinie hat gegriffen: Kanten müssen dort stehen, wo sie landen) */
  gerade(): void;
  stop(): void;
}

/**
 * Gedämpfte Feder für die Neigung (M440): Das Ziel klingt ab (×0,86 je Bild), der Winkel folgt ihm (×0,22).
 * Schreibt den Winkel als CSS-Variable `variable` an `el`; in Ruhe wird die Variable entfernt.
 */
export function neigungsFeder(ziel1: Element | null | HTMLElement[], variable: string, grenze = 7): Neigung {
  let winkel = 0; let ziel = 0; let raf = 0; let aktiv = true;
  const arm = bewegungArm();
  // M486: auch mehrere Elemente (die gehobenen Karten). Die Variable an der ganzen Fläche zu setzen ließ den Browser
  // je Bild den Stil ALLER Karten neu berechnen (sie erben sie) — mit 200 Karten der größte Posten beim Ziehen.
  const els = (Array.isArray(ziel1) ? ziel1 : ziel1 ? [ziel1] : []) as HTMLElement[];
  const setzen = (w: string | null) => { for (const e of els) if (w === null) e.style.removeProperty(variable); else e.style.setProperty(variable, w); };
  const schreib = () => setzen(`${winkel.toFixed(2)}deg`);
  const schritt = () => {
    ziel *= 0.86;
    winkel += (ziel - winkel) * 0.22;
    schreib();
    if (aktiv || Math.abs(winkel) > 0.05) raf = requestAnimationFrame(schritt);
    else { raf = 0; winkel = 0; setzen(null); }
  };
  const an = () => { if (!raf && !arm) raf = requestAnimationFrame(schritt); };
  an();
  return {
    tempo(vx) { if (arm) return; ziel = Math.max(-grenze, Math.min(grenze, vx * NEIGUNG_JE_TEMPO)); an(); },
    loslassen() { aktiv = false; ziel = 0; an(); },
    gerade() { ziel = 0; winkel = 0; schreib(); },
    stop() { aktiv = false; cancelAnimationFrame(raf); raf = 0; winkel = 0; setzen(null); },
  };
}

/**
 * Minimaler Verschiebe-Vektor, um `andere` aus `schieber` (+`abstand`) herauszudrücken — oder null, wenn sich
 * beide nicht zu nahe kommen. Entlang der Achse mit der geringsten Eindringtiefe (früher lib/physics.ts).
 */
export function wegVektor(schieber: Kasten, andere: Kasten, abstand = 12): [number, number] | null {
  const ox = Math.min(schieber.x + schieber.w, andere.x + andere.w) - Math.max(schieber.x, andere.x);
  const oy = Math.min(schieber.y + schieber.h, andere.y + andere.h) - Math.max(schieber.y, andere.y);
  const px = ox + abstand;
  const py = oy + abstand;
  if (px <= 0 || py <= 0) return null;
  const cxs = schieber.x + schieber.w / 2; const cys = schieber.y + schieber.h / 2;
  const cxa = andere.x + andere.w / 2; const cya = andere.y + andere.h / 2;
  if (px < py) return [Math.sign(cxa - cxs || 1) * px, 0];
  return [0, Math.sign(cya - cys || 1) * py];
}

export interface Ausweicher { id: string; el: HTMLElement | null; kasten: Kasten }

/** M485: So viele Stufen tief nimmt eine ausweichende Karte ihre Nachbarn mit (1 = nur die Karten unter der gezogenen) */
export const AUSWEICH_STUFEN = 3;
/** M485: Mit jeder Stufe hält die Kette weniger Abstand (12 → 8 → 5 Punkte) — sie läuft weich aus */
export const STUFEN_DAEMPFUNG = 0.66;

const verschoben = (k: Kasten, v: [number, number]): Kasten => ({ x: k.x + v[0], y: k.y + v[1], w: k.w, h: k.h });

/**
 * Ausweichen während eines Zugs (M481): Wer unter dem gezogenen Kasten liegt, gleitet beiseite — nur als
 * Anzeige (`translate` am Knoten, der Übergang kommt aus dem CSS), ohne den Stand anzufassen. Erst beim
 * Ablegen wird übernommen, was dann noch ausweicht (`ende`). So schreibt ein Zug nichts Zusätzliches in den
 * Verlauf oder an das Live-Team, und wer nur darüber hinwegzieht, findet alles, wie es war.
 *
 * M485: Kettenreaktion — trifft eine ausweichende Karte ihrerseits eine Nachbarin, gleitet die mit (bis
 * `stufen` tief, mit kleiner werdendem Abstand und je Stufe etwas später: `--zieh-stufe` verzögert den Übergang).
 * Nie angestoßen wird, was schon vor dem Zug an der Schiebenden lag (Stapel bleiben Stapel), und nie in die
 * gezogene Karte hinein.
 */
export function ausweichen(kandidaten: Ausweicher[], abstand = 12, stufen = 1) {
  const versatz = new Map<string, [number, number]>();
  /** M485: wer in diesem Zug je verschoben wurde (gleitet womöglich noch zurück) — die Kanten schauen dorthin */
  const beruehrt = new Set<string>();
  const setzen = (k: Ausweicher, v: [number, number] | undefined, stufe = 1) => {
    const alt = versatz.get(k.id);
    if (!v) {
      if (!alt) return;
      versatz.delete(k.id);
      if (k.el) { k.el.style.removeProperty('translate'); k.el.style.removeProperty('--zieh-stufe'); stoeren(k.el); }
      return;
    }
    beruehrt.add(k.id);
    if (alt && Math.abs(alt[0] - v[0]) < 0.5 && Math.abs(alt[1] - v[1]) < 0.5) return;
    versatz.set(k.id, v);
    if (k.el) {
      if (stufe > 1) k.el.style.setProperty('--zieh-stufe', String(stufe - 1)); else k.el.style.removeProperty('--zieh-stufe');
      k.el.style.setProperty('translate', `${v[0].toFixed(1)}px ${v[1].toFixed(1)}px`);
      stoeren(k.el);
    }
  };
  return {
    /** Der gezogene Kasten steht jetzt hier */
    setze(kasten: Kasten): void {
      const neu = new Map<string, [[number, number], number]>();
      let front: Array<[Ausweicher, Kasten]> = [];
      for (const k of kandidaten) {
        const v = wegVektor(kasten, k.kasten, abstand);
        if (v) { neu.set(k.id, [v, 1]); front.push([k, verschoben(k.kasten, v)]); }
      }
      // M485: weitere Stufen — nur, wer noch nicht ausweicht, und nur von einer Nachbarin, mit der er vorher nichts zu tun hatte
      for (let st = 2; st <= stufen && front.length; st += 1) {
        const ab = abstand * STUFEN_DAEMPFUNG ** (st - 1);
        const naechste: Array<[Ausweicher, Kasten]> = [];
        for (const k of kandidaten) {
          if (neu.has(k.id)) continue;
          for (const [f, r] of front) {
            if (wegVektor(f.kasten, k.kasten, 0)) continue;
            const v = wegVektor(r, k.kasten, ab);
            if (!v) continue;
            const ziel = verschoben(k.kasten, v);
            if (wegVektor(kasten, ziel, 0)) continue;
            neu.set(k.id, [v, st]); naechste.push([k, ziel]);
            break;
          }
        }
        front = naechste;
      }
      for (const k of kandidaten) { const n = neu.get(k.id); setzen(k, n?.[0], n?.[1]); }
    },
    /** Was ausweicht, als [id, x, y] in Flächen-Punkten (neue Lage) */
    ende(): Array<[string, number, number]> {
      const raus: Array<[string, number, number]> = [];
      for (const k of kandidaten) {
        const v = versatz.get(k.id);
        if (v) raus.push([k.id, k.kasten.x + v[0], k.kasten.y + v[1]]);
      }
      return raus;
    },
    /** Alle zurück an ihren Platz (gleitend) */
    zurueck(): void { for (const k of kandidaten) setzen(k, undefined); },
    get anzahl() { return versatz.size; },
    beruehrt,
  };
}

/**
 * Übernommene Ausweich-Lage ohne Ruck: Der Knoten trägt noch `translate`; sobald React Flow ihn an die neue
 * Lage gesetzt hat (Inline-`transform`), fällt `translate` weg — im selben Bild und ohne Übergang.
 */
export function versatzAufloesen(el: HTMLElement, x: number, y: number, id?: string): void {
  let n = 0;
  const pruefen = () => {
    const tr = el.style.transform;
    const m = /translate\(\s*(-?[\d.e+-]+)px\s*,\s*(-?[\d.e+-]+)px/.exec(tr);
    const da = !!m && Math.abs(Number(m[1]) - x) < 0.6 && Math.abs(Number(m[2]) - y) < 0.6;
    if (da || ++n > 30) {
      const tr0 = el.style.transition;
      el.style.transition = 'none';
      el.style.removeProperty('translate');
      el.style.removeProperty('--zieh-stufe');
      stoeren(el);
      // M485: die Kanten im selben Bild zurück auf den Stand — der trägt jetzt die neue Lage
      if (id) { anzeigeSetzen(id); anzeigeMelden(); }
      void el.offsetWidth; // Stil jetzt anwenden, bevor der Übergang zurückkommt
      el.style.transition = tr0;
      return;
    }
    requestAnimationFrame(pruefen);
  };
  pruefen();
}

/**
 * M485: Die Kanten folgen der sichtbaren Karte. Gehoben, geneigt und ausgewichen wird über CSS am Knoten (mit
 * Übergängen); was davon gerade zu sehen ist, liest dieser Beobachter je Bild aus dem berechneten Stil (`translate`,
 * `scale`, `rotate` — mitten im Übergang der aktuelle Zwischenwert) und gibt es über lib/zugAnzeige.ts an die
 * Kanten. Nur, solange sich etwas bewegt — ohne Kanten auf dem Board läuft er gar nicht. M486: auch Karten ohne
 * eigene Verbindung (mit dem Ziel ihres Ausweichens), denn Kanten weichen ihnen aus (LabeledEdge).
 * Geschrieben wird dabei nichts (kein Stand, kein Verlauf, kein Live-Team).
 */
/**
 * M491: Was eine Karte zeigen SOLL, wenn kein Übergang mehr läuft — aus ihrem Inline-Stil und denselben Regeln wie
 * im CSS (34-praesentation.css, „Ziehen"): `translate` steht inline, die gehobene Karte trägt `--zieh-skala` und
 * `--zieh-neigung` (die Neigung hat keinen Übergang, ihre Feder rechnet in JS), flach bei „weniger Bewegung" und an
 * der Fanglinie.
 */
let gerastetJetzt = false;
function erwartet(e: HTMLElement, arm: boolean): Anzeige {
  const tr = e.style.translate || 'none';
  const t = tr === 'none' ? [] : tr.split(' ').map(parseFloat);
  const g = e.dataset.gehoben;
  const flach = arm || (gerastetJetzt && g === 'an');
  const s = g === 'an' && !flach ? parseFloat(e.style.getPropertyValue('--zieh-skala')) || 1 : 1;
  const w = g && !flach ? parseFloat(e.style.getPropertyValue('--zieh-neigung')) || 0 : 0;
  return [t[0] || 0, t[1] || 0, s, w];
}
const gleich = (a: Anzeige, b: Anzeige): boolean =>
  Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05 && Math.abs(a[2] - b[2]) < 1e-4 && Math.abs(a[3] - b[3]) < 0.01;
/**
 * M491: Wie oft hintereinander der berechnete Stil einer Karte schon genau dem erwarteten entsprach. Ab zwei Mal
 * (einmal könnte ein überschwingender Übergang zufällig durchs Ziel laufen) ist sie „ruhig": Dann liest der
 * Beobachter nicht mehr `getComputedStyle` (das erzwang je Bild eine Stil-Rechnung mitten im Bild, im Profil der
 * größte JS-Posten beim Ziehen mit Verbindungen), sondern nimmt das Erwartete. Jede Änderung, die einen Übergang
 * startet, stört die Ruhe wieder (`stoeren`).
 */
const ruhe = new WeakMap<HTMLElement, number>();
const stoeren = (e: HTMLElement | null | undefined): void => { if (e) ruhe.delete(e); };

export function kantenBeobachter(elVon: (id: string) => HTMLElement | null, beobachtet: () => Iterable<string>, verbunden: ReadonlySet<string>) {
  const zuletzt = new Map<string, Anzeige>();
  const els = new Map<string, HTMLElement | null>();
  const arm = bewegungArm();
  let raf = 0; let bis = Infinity;
  const lesen = () => {
    raf = 0;
    let bewegt = false; let geaendert = false;
    for (const id of beobachtet()) {
      let e = els.get(id);
      if (e === undefined) { e = elVon(id); els.set(id, e); }
      if (!e?.isConnected) continue;
      // M486: Karten ohne eigene Verbindung sind für die Kanten nur Hindernis — dafür reicht das Ziel des Ausweichens
      // (Inline-Stil, kostet nichts). Den berechneten Stil zu lesen erzwingt eine Stil-Rechnung mitten im Bild.
      let a: Anzeige;
      if (!verbunden.has(id)) {
        const tr = e.style.translate || 'none';
        const t = tr === 'none' ? [] : tr.split(' ').map(parseFloat);
        a = [t[0] || 0, t[1] || 0, 1, 0];
      } else if ((ruhe.get(e) ?? 0) >= 2) a = erwartet(e, arm);
      else {
        const cs = getComputedStyle(e);
        const t = cs.translate === 'none' ? [] : cs.translate.split(' ').map(parseFloat);
        a = [t[0] || 0, t[1] || 0, cs.scale === 'none' ? 1 : parseFloat(cs.scale) || 1, cs.rotate === 'none' ? 0 : parseFloat(cs.rotate) || 0];
        ruhe.set(e, gleich(a, erwartet(e, arm)) ? (ruhe.get(e) ?? 0) + 1 : 0);
      }
      const alt = zuletzt.get(id);
      if (Math.abs(a[0]) < 0.05 && Math.abs(a[1]) < 0.05 && Math.abs(a[2] - 1) < 1e-4 && Math.abs(a[3]) < 0.01) {
        if (alt) { zuletzt.delete(id); anzeigeSetzen(id); geaendert = true; }
        continue;
      }
      bewegt = true;
      if (alt && a.every((v, i) => Math.abs(v - alt[i]) < 0.01)) continue;
      zuletzt.set(id, a); anzeigeSetzen(id, a); geaendert = true;
    }
    if (bewegt || performance.now() < bis) raf = requestAnimationFrame(lesen);
    else if (zuletzt.size) { for (const id of zuletzt.keys()) anzeigeSetzen(id); zuletzt.clear(); geaendert = true; }   // nichts hängen lassen
    if (geaendert) anzeigeMelden();
  };
  const an = () => { if (!raf) raf = requestAnimationFrame(lesen); };
  an();
  return {
    /** Zug vorbei: noch so lange schauen, bis Landen und Zurückgleiten vorbei sind */
    nachlauf(ms: number) { bis = performance.now() + ms; an(); },
  };
}

/* ───────────────────────── Ein Zug auf dem Board ───────────────────────── */

/** M481: Bis zu so vielen gezogenen Karten heben sie sich und lassen Nachbarn ausweichen (darüber: ruhig, Leistung) */
export const ZIEH_HEBEN_MAX = 6;
/** Abstand, den ausweichende Nachbarn zur gezogenen Karte halten (Flächen-Punkte) */
export const AUSWEICH_ABSTAND = 12;
/** So lange hält die abgelegte Karte ihre Neigung als Anzeige (Feder schwingt aus, Skala landet) */
export const LANDEN_MS = 650;

/** Was der Zug von einer Karte wissen muss (passt auf die Knoten von React Flow) */
export interface ZugKnoten {
  id: string; type?: string; selected?: boolean; hidden?: boolean; archived?: boolean;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number }; width?: number | null; height?: number | null;
}
export interface Zug {
  /** Die gegriffene Karte steht jetzt bei (x, y); `zoom` für das Tempo am Bildschirm, `gerastet` = Fanglinie greift */
  schritt(x: number, y: number, zoom: number, gerastet: boolean): void;
  /** Loslassen (oder abbrechen): liefert, was ausgewichen bleibt — als [id, x, y] zum Übernehmen */
  ende(abbrechen?: boolean): Array<[string, number, number]>;
  /** Nach dem Übernehmen: Versatz an genau diesen Karten ohne Ruck auflösen */
  aufloesen(lagen: Array<[string, number, number]>): void;
}

const masse = (n: ZugKnoten) => ({ w: n.measured?.width ?? n.width ?? 260, h: n.measured?.height ?? n.height ?? 120 });

/**
 * Beginnt einen Zug mit Gefühl (Board.tsx ruft es aus `onNodeDragStart`). Null, wenn nichts zu tun ist: große
 * Auswahl, Rahmen dabei. Ausweichen nur, was beim Greifen NICHT schon unter der Karte lag (Stapel bleiben Stapel),
 * keine Rahmen, nichts Archiviertes und kein Rahmen-Inhalt (dort ist die Ordnung gewollt).
 */
export function zugStarten(wurzel: HTMLElement, gegriffen: ZugKnoten, alle: ZugKnoten[], zoom: number, verbunden?: ReadonlySet<string>): Zug | null {
  const bewegt = gegriffen.selected ? alle.filter((n) => n.selected) : alle.filter((n) => n.id === gegriffen.id);
  if (bewegt.length === 0 || bewegt.length > ZIEH_HEBEN_MAX || bewegt.some((n) => n.type === 'frame')) return null;
  const el = (id: string) => wurzel.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const n of bewegt) { const m = masse(n); x1 = Math.min(x1, n.position.x); y1 = Math.min(y1, n.position.y); x2 = Math.max(x2, n.position.x + m.w); y2 = Math.max(y2, n.position.y + m.h); }
  const kasten: Kasten = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  const x0 = gegriffen.position.x; const y0 = gegriffen.position.y;
  const gehoben: Array<{ el: HTMLElement; dx: number; dy: number }> = [];
  for (const n of bewegt) {
    const e = el(n.id);
    if (!e) continue;
    const m = masse(n);
    e.style.setProperty('--zieh-skala', String(hebeSkala(m.w, m.h)));
    e.style.setProperty('--zieh-x', `${n.position.x}px`);
    e.style.setProperty('--zieh-y', `${n.position.y}px`);
    e.dataset.gehoben = 'an';
    stoeren(e);
    gehoben.push({ el: e, dx: n.position.x - x0, dy: n.position.y - y0 });
  }
  const ids = new Set(bewegt.map((n) => n.id));
  const rahmen = alle.filter((n) => n.type === 'frame' && !n.archived).map((f) => ({ x: f.position.x, y: f.position.y, ...masse(f) }));
  const imRahmen = (k: Kasten) => { const cx = k.x + k.w / 2; const cy = k.y + k.h / 2; return rahmen.some((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h); };
  const kandidaten: Ausweicher[] = [];
  for (const n of alle) {
    if (ids.has(n.id) || n.type === 'frame' || n.archived || n.hidden) continue;
    const k = { x: n.position.x, y: n.position.y, ...masse(n) };
    if (wegVektor(kasten, k, 0) || imRahmen(k)) continue;
    kandidaten.push({ id: n.id, el: el(n.id), kasten: k });
  }
  // M485: Kettenreaktion über mehrere Stufen — nicht bei „weniger Bewegung"
  const aus = kandidaten.length ? ausweichen(kandidaten, AUSWEICH_ABSTAND, bewegungArm() ? 1 : AUSWEICH_STUFEN) : null;
  const beob = verbunden?.size
    ? kantenBeobachter(el, function* () { for (const n of bewegt) yield n.id; if (aus) yield* aus.beruehrt; }, verbunden)
    : null;
  const neigung = neigungsFeder(gehoben.map((g) => g.el), '--zieh-neigung', neigungsGrenze(kasten.w, kasten.h));
  const tempo = tempoMesser(x0 * zoom, performance.now());
  let gerastetVorher = false;
  return {
    schritt(x, y, z, gerastet) {
      const vx = tempo.messen(x * z, performance.now());
      // M344/M349: Greift eine Fanglinie, liegt die Karte flach — ihre Kanten stehen dann genau dort, wo sie
      // landen, und die Linie stimmt mit dem, was man sieht
      if (gerastet !== gerastetVorher) {
        gerastetVorher = gerastet; gerastetJetzt = gerastet; wurzel.toggleAttribute('data-gerastet', gerastet);
        for (const g of gehoben) stoeren(g.el);
      }
      if (gerastet) neigung.gerade(); else neigung.tempo(vx);
      for (const g of gehoben) {
        g.el.style.setProperty('--zieh-x', `${x + g.dx}px`);
        g.el.style.setProperty('--zieh-y', `${y + g.dy}px`);
      }
      aus?.setze({ ...kasten, x: kasten.x + x - x0, y: kasten.y + y - y0 });
    },
    ende(abbrechen = false) {
      wurzel.removeAttribute('data-gerastet'); gerastetJetzt = false;
      neigung.loslassen();
      beob?.nachlauf(LANDEN_MS + 400);
      for (const g of gehoben) {
        g.el.dataset.gehoben = 'landet'; stoeren(g.el);
        window.setTimeout(() => { if (g.el.dataset.gehoben === 'landet') { delete g.el.dataset.gehoben; stoeren(g.el); } }, LANDEN_MS);
      }
      if (!aus) return [];
      if (abbrechen) { aus.zurueck(); return []; }
      return aus.ende();
    },
    aufloesen(lagen) {
      for (const [id, x, y] of lagen) {
        const e = kandidaten.find((k) => k.id === id)?.el;
        if (e) versatzAufloesen(e, x, y, id);
      }
    },
  };
}
