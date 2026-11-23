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
export function neigungsFeder(el: HTMLElement | null, variable: string, grenze = 7): Neigung {
  let winkel = 0; let ziel = 0; let raf = 0; let aktiv = true;
  const arm = bewegungArm();
  const schreib = () => { if (el) el.style.setProperty(variable, `${winkel.toFixed(2)}deg`); };
  const schritt = () => {
    ziel *= 0.86;
    winkel += (ziel - winkel) * 0.22;
    schreib();
    if (aktiv || Math.abs(winkel) > 0.05) raf = requestAnimationFrame(schritt);
    else { raf = 0; winkel = 0; if (el) el.style.removeProperty(variable); }
  };
  const an = () => { if (!raf && !arm) raf = requestAnimationFrame(schritt); };
  an();
  return {
    tempo(vx) { if (arm) return; ziel = Math.max(-grenze, Math.min(grenze, vx * NEIGUNG_JE_TEMPO)); an(); },
    loslassen() { aktiv = false; ziel = 0; an(); },
    gerade() { ziel = 0; winkel = 0; schreib(); },
    stop() { aktiv = false; cancelAnimationFrame(raf); raf = 0; winkel = 0; if (el) el.style.removeProperty(variable); },
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

/**
 * Ausweichen während eines Zugs (M481): Wer unter dem gezogenen Kasten liegt, gleitet beiseite — nur als
 * Anzeige (`translate` am Knoten, der Übergang kommt aus dem CSS), ohne den Stand anzufassen. Erst beim
 * Ablegen wird übernommen, was dann noch ausweicht (`ende`). So schreibt ein Zug nichts Zusätzliches in den
 * Verlauf oder an das Live-Team, und wer nur darüber hinwegzieht, findet alles, wie es war.
 */
export function ausweichen(kandidaten: Ausweicher[], abstand = 12) {
  const versatz = new Map<string, [number, number]>();
  const setzen = (k: Ausweicher, v: [number, number] | null) => {
    const alt = versatz.get(k.id);
    if (!v) {
      if (!alt) return;
      versatz.delete(k.id);
      if (k.el) k.el.style.removeProperty('translate');
      return;
    }
    if (alt && Math.abs(alt[0] - v[0]) < 0.5 && Math.abs(alt[1] - v[1]) < 0.5) return;
    versatz.set(k.id, v);
    if (k.el) k.el.style.setProperty('translate', `${v[0].toFixed(1)}px ${v[1].toFixed(1)}px`);
  };
  return {
    /** Der gezogene Kasten steht jetzt hier */
    setze(kasten: Kasten): void {
      for (const k of kandidaten) setzen(k, wegVektor(kasten, k.kasten, abstand));
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
    zurueck(): void { for (const k of kandidaten) setzen(k, null); },
    get anzahl() { return versatz.size; },
  };
}

/**
 * Übernommene Ausweich-Lage ohne Ruck: Der Knoten trägt noch `translate`; sobald React Flow ihn an die neue
 * Lage gesetzt hat (Inline-`transform`), fällt `translate` weg — im selben Bild und ohne Übergang.
 */
export function versatzAufloesen(el: HTMLElement, x: number, y: number): void {
  let n = 0;
  const pruefen = () => {
    const tr = el.style.transform;
    const m = /translate\(\s*(-?[\d.e+-]+)px\s*,\s*(-?[\d.e+-]+)px/.exec(tr);
    const da = !!m && Math.abs(Number(m[1]) - x) < 0.6 && Math.abs(Number(m[2]) - y) < 0.6;
    if (da || ++n > 30) {
      const tr0 = el.style.transition;
      el.style.transition = 'none';
      el.style.removeProperty('translate');
      void el.offsetWidth; // Stil jetzt anwenden, bevor der Übergang zurückkommt
      el.style.transition = tr0;
      return;
    }
    requestAnimationFrame(pruefen);
  };
  pruefen();
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
export function zugStarten(wurzel: HTMLElement, gegriffen: ZugKnoten, alle: ZugKnoten[], zoom: number): Zug | null {
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
  const aus = kandidaten.length ? ausweichen(kandidaten, AUSWEICH_ABSTAND) : null;
  const neigung = neigungsFeder(wurzel, '--zieh-neigung', neigungsGrenze(kasten.w, kasten.h));
  const tempo = tempoMesser(x0 * zoom, performance.now());
  let gerastetVorher = false;
  return {
    schritt(x, y, z, gerastet) {
      const vx = tempo.messen(x * z, performance.now());
      // M344/M349: Greift eine Fanglinie, liegt die Karte flach — ihre Kanten stehen dann genau dort, wo sie
      // landen, und die Linie stimmt mit dem, was man sieht
      if (gerastet !== gerastetVorher) { gerastetVorher = gerastet; wurzel.toggleAttribute('data-gerastet', gerastet); }
      if (gerastet) neigung.gerade(); else neigung.tempo(vx);
      for (const g of gehoben) {
        g.el.style.setProperty('--zieh-x', `${x + g.dx}px`);
        g.el.style.setProperty('--zieh-y', `${y + g.dy}px`);
      }
      aus?.setze({ ...kasten, x: kasten.x + x - x0, y: kasten.y + y - y0 });
    },
    ende(abbrechen = false) {
      wurzel.removeAttribute('data-gerastet');
      neigung.loslassen();
      for (const g of gehoben) {
        g.el.dataset.gehoben = 'landet';
        window.setTimeout(() => { if (g.el.dataset.gehoben === 'landet') delete g.el.dataset.gehoben; }, LANDEN_MS);
      }
      if (!aus) return [];
      if (abbrechen) { aus.zurueck(); return []; }
      return aus.ende();
    },
    aufloesen(lagen) {
      for (const [id, x, y] of lagen) {
        const e = kandidaten.find((k) => k.id === id)?.el;
        if (e) versatzAufloesen(e, x, y);
      }
    },
  };
}
