#!/usr/bin/env node
/**
 * M492: Kontrast-Scan — findet sichtbare Schrift, die zu ihrem tatsächlichen Hintergrund weniger als 4,5:1 hat.
 *
 * Für jedes sichtbare Element mit eigenem Text (oder ausgefülltem Eingabefeld) werden Schrift- und Hintergrundfarbe
 * berechnet: der Hintergrund über alle Vorfahren, halbdurchsichtige Flächen werden übereinander gemischt (wie der
 * Browser sie zeichnet), eine halbdurchsichtige Schrift ebenso auf ihren Grund. Ausgelassen werden: unsichtbare
 * Elemente (display/visibility/opacity 0, Größe 0, „nur für Vorleser" mit 1 px), deaktivierte Bedienelemente (WCAG
 * nimmt sie aus), Platzhalter und Text in SVG. Liegt ein Hintergrundbild (Verlauf, Foto) unter dem Text, ist der
 * Wert nur geschätzt — der Treffer trägt dann `unsicher: true`.
 *
 * Zwei Wege:
 *   1. In einer Prüfreihe:  import { kontrastScan } from '../werkzeug/kontrast-pruefen.mjs';
 *      const treffer = await kontrastScan(page, '.react-flow__node[data-id="n1"]', { grenze: 4.5 });
 *      → [{ text, v, farbe, grund, klasse, pfad, unsicher }]  (nur Paare unter der Grenze; `alle: true` liefert alle)
 *   2. Von Hand gegen einen laufenden Server oder einen Build:
 *      node werkzeug/kontrast-pruefen.mjs http://localhost:5173/ [--dunkel] [--sel "<css>"] [--grenze 4.5] [--alle]
 *      node werkzeug/kontrast-pruefen.mjs dist [--dunkel] …     (startet selbst einen Server auf Port 5492+1000)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Läuft im Browser: alle Textstellen unter `sel` mit ihrem Kontrast */
function scanImBrowser([sel, grenze, alle]) {
  const rgba = (s) => {
    // color-mix() u. ä. liefert berechnet `color(srgb r g b / a)` mit Anteilen 0…1
    const f = /color\(srgb ([^)]+)\)/.exec(s || '');
    if (f) { const t = f[1].split(/[ /]+/).filter(Boolean).map(Number); return [t[0] * 255, t[1] * 255, t[2] * 255, t.length > 3 ? t[3] : 1]; }
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return [0, 0, 0, 0];
    const t = m[1].split(/[ ,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : Number(x)));
    return [t[0], t[1], t[2], t.length > 3 ? t[3] : 1];
  };
  const lum = ([r, g, b]) => {
    const k = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
  };
  const misch = (oben, unten) => [0, 1, 2].map((i) => oben[i] * oben[3] + unten[i] * (1 - oben[3])).concat(1);
  // Grund der Seite, wenn nichts Deckendes darunter liegt: html/body, sonst die Leinwand des Browsers
  // (bei `color-scheme: dark` dunkel, sonst weiß)
  const leinwand = () => {
    for (const e of [document.body, document.documentElement]) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] >= 1) return c; }
    return /dark/.test(getComputedStyle(document.documentElement).colorScheme) ? [18, 18, 18, 1] : [255, 255, 255, 1];
  };
  const grund = (el) => {
    const schichten = [];
    let bild = false;
    const nimm = (e) => {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== 'none' && !/^url\(.*\.svg/.test(s.backgroundImage)) bild = true;
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) schichten.push(c);
      return c[3] >= 1;
    };
    let deckend = false;
    for (let e = el; e && !deckend; e = e.parentElement) deckend = nimm(e);
    // Liegt das Element frei über etwas, das nicht sein Vorfahr ist (schwebende Leisten, Ecken-Links über der
    // Fläche), zählt, was an seiner Mitte darunter gezeichnet ist.
    if (!deckend) {
      const r = el.getBoundingClientRect();
      let stapel = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const ab = stapel.findIndex((e) => e === el || el.contains(e) || e.contains(el));   // nur, was darunter liegt
      if (ab > 0) stapel = stapel.slice(ab);
      for (const e of stapel) {
        if (deckend) break;
        if (e === el || el.contains(e) || e.contains(el)) continue;
        deckend = nimm(e);
      }
    }
    let farbe = schichten.length && schichten[schichten.length - 1][3] >= 1 ? schichten.pop() : leinwand();
    while (schichten.length) farbe = misch(schichten.pop(), farbe);
    return { farbe, bild };
  };
  const wurzel = document.querySelector(sel);
  if (!wurzel) return { fehlt: true, liste: [] };
  const sichtbar = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
    }
    return true;
  };
  const pfad = (el) => {
    const teile = [];
    for (let e = el; e && e !== document.body && teile.length < 4; e = e.parentElement) {
      const k = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      teile.unshift(e.tagName.toLowerCase() + k);
    }
    return teile.join(' > ');
  };
  const hex = (c) => '#' + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  const liste = [];
  for (const el of [wurzel, ...wurzel.querySelectorAll('*')]) {
    if (el.closest('svg')) continue;
    const feld = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
    const eigen = feld
      ? (el.value && !['checkbox', 'radio', 'color', 'range', 'hidden', 'file'].includes(el.type))
      : [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!eigen) continue;
    if (el.disabled || el.closest('[disabled], [aria-disabled="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    if (!sichtbar(el)) continue;
    const s = getComputedStyle(el);
    if (parseFloat(s.fontSize) < 1) continue;   // Schrift 0 (Streifen, die nur Farbe zeigen)
    const { farbe: g, bild } = grund(el);
    const c = rgba(s.color);
    const t = c[3] < 1 ? misch(c, g) : c;
    const L1 = lum(t); const L2 = lum(g);
    const v = Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
    if (!alle && v >= grenze) continue;
    liste.push({
      text: (feld ? el.value : [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ')).trim().slice(0, 40),
      v, farbe: hex(t), grund: hex(g), unsicher: bild,
      klasse: typeof el.className === 'string' ? el.className.slice(0, 50) : el.tagName,
      pfad: pfad(el),
    });
  }
  return { fehlt: false, liste };
}

/**
 * Kontrast aller sichtbaren Texte unter `sel` (Standard: ganze Seite). Liefert die Paare unter `grenze`
 * (Standard 4,5:1); mit `alle: true` jede Textstelle mit ihrem Wert.
 */
export async function kontrastScan(page, sel = 'body', { grenze = 4.5, alle = false } = {}) {
  const { fehlt, liste } = await page.evaluate(scanImBrowser, [sel, grenze, alle]);
  if (fehlt) throw new Error(`kontrastScan: „${sel}" nicht gefunden`);
  return liste;
}

/** Kurze Zeile je Treffer für die Ausgabe */
export const trefferZeile = (t) => `${String(t.v).padStart(5)}:1  ${t.farbe} auf ${t.grund}${t.unsicher ? ' (Bild darunter, geschätzt)' : ''}  „${t.text}"  ${t.pfad}`;

// ---------- Aufruf von Hand ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ziel = args.find((a) => !a.startsWith('--') && !/^\d/.test(a) && args[args.indexOf(a) - 1] !== '--sel');
  const wert = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  if (!ziel) {
    console.error('Aufruf: node werkzeug/kontrast-pruefen.mjs <url|dist-Ordner> [--dunkel] [--sel "<css>"] [--grenze 4.5] [--alle]');
    process.exit(2);
  }
  const { chromium } = await import('playwright-core');
  let url = ziel; let server = null;
  if (!/^https?:/.test(ziel)) {
    const http = await import('node:http'); const { readFileSync, existsSync } = await import('node:fs');
    const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm' };
    server = http.createServer((q, r) => {
      let f = path.join(ziel, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
      if (!existsSync(f)) f = path.join(ziel, 'index.html');
      r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' }); r.end(readFileSync(f));
    });
    await new Promise((ok) => server.listen(6492, ok));
    url = 'http://localhost:6492/';
  }
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: args.includes('--dunkel') ? 'dark' : 'light' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const liste = await kontrastScan(page, wert('--sel', 'body'), { grenze: Number(wert('--grenze', '4.5')), alle: args.includes('--alle') });
  for (const t of liste) console.log(trefferZeile(t));
  console.log(liste.length ? `${liste.length} Stelle(n) unter der Grenze.` : 'Keine Stelle unter der Grenze.');
  await browser.close(); server?.close();
  process.exit(args.includes('--alle') || !liste.length ? 0 : 1);
}
