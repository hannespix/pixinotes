// M395: Einfache Bildbearbeitung — der Rechenkern, ohne Bibliothek und ohne Oberfläche.
//
// Ein Bild durchläuft immer dieselbe Kette (BildSchritte beschreibt sie vollständig):
//   1. verpixeln   — Rechtecke unkenntlich machen. Sie liegen im URSPRÜNGLICHEN Bild: Was einmal verdeckt ist,
//                    bleibt es — gleich, wie danach gedreht, gespiegelt oder gerade gerichtet wird.
//   2. ausrichten  — Vierteldrehung, spiegeln, gerade richten (kleiner Winkel; das Bild wird dabei so weit
//                    vergrößert, dass keine leeren Ecken entstehen)
//   3. zuschneiden — Ausschnitt des ausgerichteten Bildes
//   4. anpassen    — Helligkeit, Kontrast, Sättigung
// Ausschnitt und Rechtecke sind Bruchteile (0…1): Die Vorschau rechnet an einer kleinen Fassung, das Ergebnis am
// Original — dieselben Schritte, dieselbe Wirkung.
//
// Farben werden Punkt für Punkt gerechnet statt mit `ctx.filter`: Das kennt nicht jeder Browser auf der Zeichenfläche.

export interface Kasten { x: number; y: number; w: number; h: number }
export interface BildSchritte {
  /** Vierteldrehungen im Uhrzeigersinn (0…3) */
  dreh: number;
  spiegel: boolean;
  /** Gerade richten in Grad (−20…20) */
  neigung: number;
  /** Ausschnitt — Bruchteile des AUSGERICHTETEN Bildes */
  schnitt: Kasten;
  /** verpixelte Rechtecke — Bruchteile des URSPRÜNGLICHEN Bildes */
  pixel: Kasten[];
  /** je −100…100 */
  hell: number;
  kontrast: number;
  saettigung: number;
}
export const OHNE: BildSchritte = { dreh: 0, spiegel: false, neigung: 0, schnitt: { x: 0, y: 0, w: 1, h: 1 }, pixel: [], hell: 0, kontrast: 0, saettigung: 0 };
export const NEIGUNG_MAX = 20;

export const unveraendert = (s: BildSchritte): boolean =>
  s.dreh % 4 === 0 && !s.spiegel && Math.abs(s.neigung) < 0.05 && s.pixel.length === 0
  && s.hell === 0 && s.kontrast === 0 && s.saettigung === 0
  && s.schnitt.x < 0.001 && s.schnitt.y < 0.001 && s.schnitt.w > 0.999 && s.schnitt.h > 0.999;

type Quelle = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
const leinwand = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
};
const klemme = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Maße des ausgerichteten Bildes */
export function ausgerichtetMasse(bw: number, bh: number, s: BildSchritte): { w: number; h: number } {
  return s.dreh % 2 ? { w: bh, h: bw } : { w: bw, h: bh };
}

/** Vergrößerung, mit der ein um `neigung` gedrehtes Bild seine Fläche wieder ganz deckt */
const deckZoom = (w: number, h: number, neigung: number) => {
  const t = Math.abs((neigung * Math.PI) / 180);
  return Math.cos(t) + Math.max(w / h, h / w) * Math.sin(t);
};
const drehe = (x: number, y: number, a: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

/** Ein Punkt des ursprünglichen Bildes (Bruchteile) → wo er im ausgerichteten Bild liegt (Bruchteile) */
export function nachAnsicht(p: [number, number], bw: number, bh: number, s: BildSchritte): [number, number] {
  const v = ausgerichtetMasse(bw, bh, s);
  let x = (p[0] - 0.5) * bw; let y = (p[1] - 0.5) * bh;
  if (s.spiegel) x = -x;
  [x, y] = drehe(x, y, ((s.dreh % 4) * Math.PI) / 2);
  const z = deckZoom(v.w, v.h, s.neigung);
  [x, y] = drehe(x * z, y * z, (s.neigung * Math.PI) / 180);
  return [x / v.w + 0.5, y / v.h + 0.5];
}
/** … und zurück */
export function nachQuelle(p: [number, number], bw: number, bh: number, s: BildSchritte): [number, number] {
  const v = ausgerichtetMasse(bw, bh, s);
  let [x, y] = drehe((p[0] - 0.5) * v.w, (p[1] - 0.5) * v.h, (-s.neigung * Math.PI) / 180);
  const z = deckZoom(v.w, v.h, s.neigung);
  [x, y] = drehe(x / z, y / z, (-(s.dreh % 4) * Math.PI) / 2);
  if (s.spiegel) x = -x;
  return [x / bw + 0.5, y / bh + 0.5];
}
/** Ein Rechteck der Ansicht → das umschließende Rechteck im ursprünglichen Bild (auf das Bild begrenzt) */
export function kastenNachQuelle(r: Kasten, bw: number, bh: number, s: BildSchritte): Kasten {
  const ecken = ([[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]] as [number, number][]).map((e) => nachQuelle(e, bw, bh, s));
  const x0 = klemme(Math.min(...ecken.map((e) => e[0])), 0, 1); const x1 = klemme(Math.max(...ecken.map((e) => e[0])), 0, 1);
  const y0 = klemme(Math.min(...ecken.map((e) => e[1])), 0, 1); const y1 = klemme(Math.max(...ecken.map((e) => e[1])), 0, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** Die vier Ecken eines Rechtecks des ursprünglichen Bildes in der Ansicht */
export const eckenInAnsicht = (r: Kasten, bw: number, bh: number, s: BildSchritte): [number, number][] =>
  ([[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]] as [number, number][]).map((e) => nachAnsicht(e, bw, bh, s));

/** Den Ausschnitt mitnehmen, wenn die Ansicht eine Vierteldrehung macht oder gespiegelt wird */
export function kastenDrehen(r: Kasten, art: 'rechts' | 'links' | 'spiegeln'): Kasten {
  if (art === 'rechts') return { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w };
  if (art === 'links') return { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w };
  return { x: 1 - r.x - r.w, y: r.y, w: r.w, h: r.h };
}
/** Die Ansicht drehen oder spiegeln — „spiegeln" heißt immer: links und rechts tauschen, so wie man es gerade sieht */
export function ansichtWenden(s: BildSchritte, art: 'rechts' | 'links' | 'spiegeln'): BildSchritte {
  const schnitt = kastenDrehen(s.schnitt, art);
  if (art === 'rechts') return { ...s, dreh: (s.dreh + 1) % 4, schnitt };
  if (art === 'links') return { ...s, dreh: (s.dreh + 3) % 4, schnitt };
  return { ...s, dreh: (4 - (s.dreh % 4)) % 4, spiegel: !s.spiegel, neigung: -s.neigung, schnitt };
}

/** Schritt 2: drehen, spiegeln, gerade richten — in eine Fläche mit höchstens `maxSeite` Kantenlänge */
export function ausrichten(bild: Quelle, bw: number, bh: number, s: BildSchritte, maxSeite: number): HTMLCanvasElement {
  const voll = ausgerichtetMasse(bw, bh, s);
  const k = Math.min(1, maxSeite / Math.max(voll.w, voll.h));
  const c = leinwand(voll.w * k, voll.h * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const t = (s.neigung * Math.PI) / 180;
  // Gerade richten: um den Winkel drehen und so weit vergrößern, dass das gedrehte Bild die Fläche ganz deckt
  const zoom = deckZoom(voll.w, voll.h, s.neigung);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(t);
  ctx.scale(zoom, zoom);
  ctx.rotate(((s.dreh % 4) * Math.PI) / 2);
  if (s.spiegel) ctx.scale(-1, 1);
  ctx.drawImage(bild, (-bw * k) / 2, (-bh * k) / 2, bw * k, bh * k);
  return c;
}

/** Schritt 1: Rechtecke verpixeln (Bruchteile der Fläche) — grobe Klötze, deren Größe mit dem Rechteck wächst */
export function verpixeln(c: HTMLCanvasElement, kaesten: Kasten[]): void {
  if (kaesten.length === 0) return;
  const ctx = c.getContext('2d')!;
  for (const r of kaesten) {
    const x = Math.round(klemme(r.x, 0, 1) * c.width); const y = Math.round(klemme(r.y, 0, 1) * c.height);
    const w = Math.round(Math.min(r.w, 1 - r.x) * c.width); const h = Math.round(Math.min(r.h, 1 - r.y) * c.height);
    if (w < 2 || h < 2) continue;
    // rund ein Dutzend Klötze über die kurze Seite, mindestens 1/60 der Bildkante — auch groß gezogen nicht lesbar
    const klotz = Math.max(Math.min(w, h) / 12, Math.max(c.width, c.height) / 60, 4);
    const kw = Math.max(1, Math.round(w / klotz)); const kh = Math.max(1, Math.round(h / klotz));
    const klein = leinwand(kw, kh);
    const kctx = klein.getContext('2d')!;
    kctx.imageSmoothingQuality = 'medium';
    kctx.drawImage(c, x, y, w, h, 0, 0, kw, kh);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(klein, 0, 0, kw, kh, x, y, w, h);
    ctx.restore();
  }
}

/** Schritt 3: zuschneiden (Bruchteile der Fläche) */
export function zuschneiden(c: HTMLCanvasElement, r: Kasten): HTMLCanvasElement {
  const x = Math.round(klemme(r.x, 0, 1) * c.width); const y = Math.round(klemme(r.y, 0, 1) * c.height);
  const w = Math.max(1, Math.min(c.width - x, Math.round(r.w * c.width)));
  const h = Math.max(1, Math.min(c.height - y, Math.round(r.h * c.height)));
  if (x === 0 && y === 0 && w === c.width && h === c.height) return c;
  const aus = leinwand(w, h);
  aus.getContext('2d')!.drawImage(c, x, y, w, h, 0, 0, w, h);
  return aus;
}

/** Schritt 4: Helligkeit, Kontrast, Sättigung — Punkt für Punkt, Durchsichtiges bleibt durchsichtig */
export function anpassen(c: HTMLCanvasElement, s: Pick<BildSchritte, 'hell' | 'kontrast' | 'saettigung'>): void {
  if (!s.hell && !s.kontrast && !s.saettigung) return;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const bild = ctx.getImageData(0, 0, c.width, c.height);
  const d = bild.data;
  const hell = (s.hell / 100) * 90;                                  // ±90 Stufen
  const kon = s.kontrast >= 0 ? 1 + s.kontrast / 100 : 1 + s.kontrast / 200;   // 0,5 … 2
  const sat = s.saettigung >= 0 ? 1 + s.saettigung / 100 : 1 + s.saettigung / 100;   // 0 … 2
  // Helligkeit und Kontrast über eine Tabelle — einmal 256 Werte statt Millionen Rechnungen
  const tab = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) tab[i] = (i - 128) * kon + 128 + hell;
  const mitSat = sat !== 1;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = tab[d[i]]; let g = tab[d[i + 1]]; let b = tab[d[i + 2]];
    if (mitSat) {
      const grau = 0.299 * r + 0.587 * g + 0.114 * b;
      r = grau + (r - grau) * sat; g = grau + (g - grau) * sat; b = grau + (b - grau) * sat;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(bild, 0, 0);
}

/** Die ganze Kette — `mitSchnitt: false` liefert das ausgerichtete Bild samt Anpassung (für die Vorschau mit Rahmen) */
export function rechnen(bild: Quelle, bw: number, bh: number, s: BildSchritte, maxSeite: number, mitSchnitt = true): HTMLCanvasElement {
  let q: Quelle = bild; let qw = bw; let qh = bh;
  if (s.pixel.length) {
    const k = Math.min(1, maxSeite / Math.max(bw, bh));
    const kopie = leinwand(bw * k, bh * k);
    const kctx = kopie.getContext('2d')!;
    kctx.imageSmoothingQuality = 'high';
    kctx.drawImage(bild, 0, 0, kopie.width, kopie.height);
    verpixeln(kopie, s.pixel);
    q = kopie; qw = kopie.width; qh = kopie.height;
  }
  // die Maße des Originals bestimmen das Seitenverhältnis — eine verkleinerte Kopie rundet es um einen Bildpunkt
  let c = ausrichten(q, qw, qh, s, Math.min(maxSeite, Math.max(bw, bh)));
  if (mitSchnitt) c = zuschneiden(c, s.schnitt);
  anpassen(c, s);
  return c;
}

/**
 * „Automatisch": Helligkeit und Kontrast so wählen, dass das Bild seinen Tonumfang nutzt — die dunkelsten 1 %
 * werden schwarz, die hellsten 1 % weiß. Ein flaues Foto bekommt Kontrast, ein ausgewogenes bleibt fast, wie es ist.
 */
export function autoWerte(c: HTMLCanvasElement): { hell: number; kontrast: number } {
  const k = Math.min(1, 240 / Math.max(c.width, c.height));
  const klein = leinwand(c.width * k, c.height * k);
  const ctx = klein.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, klein.width, klein.height);
  const d = ctx.getImageData(0, 0, klein.width, klein.height).data;
  const hist = new Uint32Array(256); let n = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])] += 1; n += 1; }
  if (n < 16) return { hell: 0, kontrast: 0 };
  let unten = 0; let oben = 255; let summe = 0;
  for (let i = 0; i < 256; i++) { summe += hist[i]; if (summe >= n * 0.01) { unten = i; break; } }
  summe = 0;
  for (let i = 255; i >= 0; i--) { summe += hist[i]; if (summe >= n * 0.01) { oben = i; break; } }
  if (oben - unten < 24) return { hell: 0, kontrast: 0 };          // einfarbige Fläche: nichts zu holen
  // Tabelle: (i − 128)·kon + 128 + hell  →  unten ↦ 0, oben ↦ 255
  const kon = klemme(255 / (oben - unten), 1, 2);
  const hell = 127.5 - ((unten + oben) / 2 - 128) * kon - 128;
  return { hell: Math.round(klemme((hell / 90) * 100, -60, 60)), kontrast: Math.round((kon - 1) * 100) };
}

/** Hat die Fläche durchsichtige Stellen? (Stichprobe — entscheidet PNG oder JPEG) */
export function hatDurchsicht(c: HTMLCanvasElement): boolean {
  const k = Math.min(1, 200 / Math.max(c.width, c.height));
  const klein = leinwand(c.width * k, c.height * k);
  const ctx = klein.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, klein.width, klein.height);
  const d = ctx.getImageData(0, 0, klein.width, klein.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

const alsBlob = (c: HTMLCanvasElement, mime: string, q?: number) => new Promise<Blob | null>((ok) => c.toBlob(ok, mime, q));

/**
 * Das fertige Bild als Datei. Zeichnungen und Bildschirmfotos (PNG, WebP, GIF) bleiben verlustfrei PNG, solange das
 * tragbar ist; Fotos werden JPEG. Durchsichtiges erzwingt PNG.
 */
export async function alsDatei(c: HTMLCanvasElement, quellMime: string): Promise<{ blob: Blob; mime: string }> {
  const verlustfrei = /png|webp|gif|svg|bmp/i.test(quellMime);
  if (verlustfrei) {
    const png = await alsBlob(c, 'image/png');
    if (png && (png.size <= 1_200_000 || hatDurchsicht(c))) return { blob: png, mime: 'image/png' };
  } else if (hatDurchsicht(c)) {
    const png = await alsBlob(c, 'image/png');
    if (png) return { blob: png, mime: 'image/png' };
  }
  const jpg = await alsBlob(c, 'image/jpeg', 0.9);
  if (jpg) return { blob: jpg, mime: 'image/jpeg' };
  const png = await alsBlob(c, 'image/png');
  if (!png) throw new Error('Bild ließ sich nicht speichern');
  return { blob: png, mime: 'image/png' };
}

export const blobAlsDataUrl = (b: Blob) => new Promise<string>((ok, weh) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result)); r.onerror = () => weh(r.error);
  r.readAsDataURL(b);
});

/** Dateiname mit der Endung, die zum neuen Typ passt */
export function nameMitEndung(name: string, mime: string): string {
  const end = mime === 'image/png' ? 'png' : 'jpg';
  const basis = name.replace(/\.[a-z0-9]{2,5}$/i, '');
  const alt = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  if (alt && ((end === 'jpg' && (alt === 'jpg' || alt === 'jpeg')) || alt === end)) return name;
  return `${basis || 'bild'}.${end}`;
}

/** Ausschnitt mit festem Seitenverhältnis (Breite : Höhe des Ergebnisses), so groß wie möglich, mittig im alten Ausschnitt */
export function schnittMitFormat(alt: Kasten, format: number, flaeche: { w: number; h: number }): Kasten {
  // format bezieht sich auf Bildpunkte — der Kasten zählt in Bruchteilen der Fläche
  const f = (format * flaeche.h) / flaeche.w;          // Breite/Höhe in Bruchteilen
  let w = alt.w; let h = w / f;
  if (h > alt.h) { h = alt.h; w = h * f; }
  if (w > 1) { w = 1; h = w / f; }
  if (h > 1) { h = 1; w = h * f; }
  const x = klemme(alt.x + (alt.w - w) / 2, 0, 1 - w); const y = klemme(alt.y + (alt.h - h) / 2, 0, 1 - h);
  return { x, y, w, h };
}
