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
 *   3. M494 Nicht-Text-Kontrast (WCAG 1.4.11, Grenze 3:1): `randScan(page, sel)` misst Ränder von Eingabefeldern,
 *      Auswahllisten, Kästchen und Schaltern, `fokusScan(page, sel)` wandert mit Tab und misst jeden Fokusring.
 *      Von Hand: … --rand bzw. … --fokus
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Läuft im Browser: alle Textstellen unter `sel` mit ihrem Kontrast */
function scanImBrowser([sel, grenze, alle, art = 'text']) {
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
  const kontrast = (a, b) => { const A = lum(a); const B = lum(b); return Math.round(((Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05)) * 100) / 100; };
  const liste = [];
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.name || el.id
    || (el.labels && el.labels[0] ? el.labels[0].textContent : '') || el.textContent || el.tagName).trim().slice(0, 40);
  /** Grund AUSSERHALB eines Elements (dort, wo Rand und Fokusring stehen) */
  const aussen = (el) => (el.parentElement ? grund(el.parentElement).farbe : leinwand());
  /** Ringe aus box-shadow: „rgb(…) 0px 0px 0px 2px [inset]" mit Ausbreitung > 0 und ohne Unschärfe */
  const schattenRinge = (bs) => {
    if (!bs || bs === 'none') return [];
    return bs.split(/,(?![^(]*\))/).map((t) => {
      const farbe = /(rgba?\([^)]+\)|color\([^)]+\))/.exec(t);
      const zahlen = t.replace(/(rgba?\([^)]+\)|color\([^)]+\))/, '').match(/-?[\d.]+px/g)?.map(parseFloat) ?? [];
      return { farbe: farbe ? rgba(farbe[1]) : null, unschaerfe: zahlen[2] ?? 0, breite: zahlen[3] ?? 0, innen: /inset/.test(t) };
    }).filter((r) => r.farbe && r.farbe[3] > 0 && r.breite >= 1 && r.unschaerfe <= 1);
  };
  const imBild = (r) => !(r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth);
  // M494: Nicht-Text-Kontrast (WCAG 1.4.11) — Ränder von Bedienelementen gegen ihren Grund
  if (art === 'rand') {
    const felder = [wurzel, ...wurzel.querySelectorAll('*')].filter((el) => el.matches(
      'input:not([type=hidden]):not([type=file]):not([type=color]), select, textarea, [role=switch], [role=checkbox], [role=radio]'));
    for (const el of felder) {
      if (el.disabled || el.closest('[disabled], [aria-disabled="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2 || !imBild(r) || !sichtbar(el)) continue;
      // Weggescrollt in einem Behälter mit overflow (Dialog-Inhalt): liegt nicht obenauf → zählt nicht
      const oben = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!oben || !(oben === el || el.contains(oben) || (el.labels && [...el.labels].some((l) => l.contains(oben))))) continue;
      const s = getComputedStyle(el);
      const aus = aussen(el);
      const eintrag = { text: name(el), klasse: typeof el.className === 'string' ? el.className.slice(0, 50) : el.tagName, pfad: pfad(el), grund: hex(aus) };
      // Native Kästchen zeichnet der Browser selbst — dort misst randScan (unten) die Bildpunkte
      if ((el.type === 'checkbox' || el.type === 'radio' || el.type === 'range') && s.appearance !== 'none') {
        liste.push({ ...eintrag, nativ: true, art: el.type, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, aussen: aus.slice(0, 3) });
        continue;
      }
      const eigen = rgba(s.backgroundColor);
      const flaeche = eigen[3] > 0 ? misch(eigen, aus) : aus;
      let v = kontrast(flaeche, aus); let farbe = hex(flaeche); let quelle = 'Fläche';
      for (const seite of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(s[`border${seite}Width`]) < 1 || s[`border${seite}Style`] === 'none' || s[`border${seite}Style`] === 'hidden') continue;
        const c = rgba(s[`border${seite}Color`]);
        if (c[3] <= 0) continue;
        const rand = misch(c, flaeche);
        const w = kontrast(rand, aus);
        if (w > v) { v = w; farbe = hex(rand); quelle = 'Rand'; }
      }
      for (const ring of schattenRinge(s.boxShadow)) {
        const unter = ring.innen ? flaeche : aus;
        const w = kontrast(misch(ring.farbe, unter), unter);
        if (w > v) { v = w; farbe = hex(misch(ring.farbe, unter)); quelle = 'Ring'; }
      }
      if (quelle === 'Fläche' && v < 1.2) continue;   // Feld ohne Rand und ohne eigene Fläche: steht wie Text da
      if (!alle && v >= grenze) continue;
      liste.push({ ...eintrag, v, farbe, quelle });
    }
    return { fehlt: false, liste };
  }
  // M494: Fokusring des gerade fokussierten Elements (die Reihe wandert mit Tab durch einen Dialog)
  if (art === 'fokus') {
    const el = document.activeElement;
    if (!el || el === document.body || !wurzel.contains(el)) return { fehlt: false, liste: [] };
    // Übergänge (Randfarbe blendet ein) sofort ans Ende, sonst misst die Reihe den Zustand vor dem Fokus
    for (const an of el.getAnimations()) { try { an.finish(); } catch { /* unendliche Animation */ } }
    const s = getComputedStyle(el);
    const eintrag = { text: name(el), klasse: typeof el.className === 'string' ? el.className.slice(0, 50) : el.tagName, pfad: pfad(el) };
    const aus = aussen(el);
    const eigen = rgba(s.backgroundColor);
    const flaeche = eigen[3] > 0 ? misch(eigen, aus) : aus;
    let v = 0; let farbe = ''; let quelle = 'ohne';
    if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1) {
      const c = rgba(s.outlineColor);
      const unter = parseFloat(s.outlineOffset) < 0 ? flaeche : aus;
      if (c[3] > 0) { v = kontrast(misch(c, unter), unter); farbe = hex(misch(c, unter)); quelle = 'Umriss'; }
    }
    for (const ring of schattenRinge(s.boxShadow)) {
      const unter = ring.innen ? flaeche : aus;
      const w = kontrast(misch(ring.farbe, unter), unter);
      if (w > v) { v = w; farbe = hex(misch(ring.farbe, unter)); quelle = 'Ring'; }
    }
    // Ohne Umriss und Ring zählt ein Rand, der sich vom Grund abhebt (z. B. Rand in Akzentfarbe)
    if (quelle === 'ohne') {
      for (const seite of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(s[`border${seite}Width`]) < 1 || s[`border${seite}Style`] === 'none') continue;
        const c = rgba(s[`border${seite}Color`]);
        if (c[3] <= 0) continue;
        const w = kontrast(misch(c, flaeche), aus);
        if (w > v) { v = w; farbe = hex(misch(c, flaeche)); quelle = 'Rand'; }
      }
    }
    if (!alle && v >= grenze) return { fehlt: false, liste: [] };
    return { fehlt: false, liste: [{ ...eintrag, v, farbe, grund: hex(aus), quelle }] };
  }
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

/**
 * M494: Nicht-Text-Kontrast (WCAG 1.4.11) aller Bedienelemente unter `sel`: Eingabefelder, Auswahllisten,
 * Textfelder, Schalter, Kästchen. Gemessen wird, was das Element vom Grund abhebt — Rand, eigene Fläche oder
 * Ring (box-shadow ohne Unschärfe), jeweils das Stärkste. Felder ganz ohne Rand und Fläche (Titel zum Umbenennen,
 * die wie Text dastehen) zählen nicht. Native Kästchen, Optionsfelder und Regler zeichnet der Browser selbst:
 * dort zählt der kräftigste Bildpunkt im Element gegen den Grund. Liefert die Treffer unter `grenze` (3:1).
 */
export async function randScan(page, sel = 'body', { grenze = 3, alle = false } = {}) {
  const { fehlt, liste } = await page.evaluate(scanImBrowser, [sel, grenze, true, 'rand']);
  if (fehlt) throw new Error(`randScan: „${sel}" nicht gefunden`);
  const aus = [];
  for (const t of liste) {
    if (t.nativ) {
      const r = t.rect;
      const bild = await page.screenshot({ clip: { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.max(1, r.w), height: Math.max(1, r.h) } });
      t.v = await page.evaluate(async ([b64, grund]) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data;
        const lum = (r, gg, b) => { const k = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * k(r) + 0.7152 * k(gg) + 0.0722 * k(b); };
        const L0 = lum(...grund);
        let best = 1;
        for (let i = 0; i < d.length; i += 4) { const L = lum(d[i], d[i + 1], d[i + 2]); best = Math.max(best, (Math.max(L, L0) + 0.05) / (Math.min(L, L0) + 0.05)); }
        return Math.round(best * 100) / 100;
      }, [bild.toString('base64'), t.aussen]);
      t.quelle = 'Bildpunkte'; t.farbe = '(nativ)';
      delete t.rect; delete t.aussen;
    }
    if (alle || t.v < grenze) aus.push(t);
  }
  return aus;
}

/**
 * M494: Fokusringe — drückt bis zu `schritte`-mal Tab und misst nach jedem Schritt den Ring des fokussierten
 * Elements unter `sel` (Umriss, Ring aus box-shadow, sonst ein Rand) gegen den Grund daneben. Liefert die
 * Treffer unter `grenze` (3:1), je Element einmal; Elemente ganz ohne sichtbaren Ring mit `quelle: 'ohne'`.
 */
export async function fokusScan(page, sel = 'body', { grenze = 3, schritte = 30, alle = false } = {}) {
  const gesehen = new Map();
  for (let i = 0; i < schritte; i += 1) {
    await page.keyboard.press('Tab');
    const { liste } = await page.evaluate(scanImBrowser, [sel, grenze, true, 'fokus']);
    for (const t of liste) if (!gesehen.has(t.pfad + t.text)) gesehen.set(t.pfad + t.text, t);
  }
  return [...gesehen.values()].filter((t) => alle || t.v < grenze);
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
  const art = args.includes('--rand') ? randScan : args.includes('--fokus') ? fokusScan : kontrastScan;
  const liste = await art(page, wert('--sel', 'body'), { grenze: Number(wert('--grenze', art === kontrastScan ? '4.5' : '3')), alle: args.includes('--alle') });
  for (const t of liste) console.log(trefferZeile(t));
  console.log(liste.length ? `${liste.length} Stelle(n) unter der Grenze.` : 'Keine Stelle unter der Grenze.');
  await browser.close(); server?.close();
  process.exit(args.includes('--alle') || !liste.length ? 0 : 1);
}
