/**
 * M403 — Präsentation: den Ausschnitt verschieben, mittig zoomen, Darstellung als Schnellauswahl.
 *
 * Gewünscht: „Bei gezoomten Präsentationen soll man wie gewohnt auch per Drag & Drop Inhalt verschieben können, mit
 * den gewohnten Gesten und Tastenkombis. Zudem wäre gut, nicht füllende Inhalte zentriert anzuzeigen und beim Zoomen
 * auch zentriert zu zoomen, damit man sich beim Zoomen nicht um den Fokus kümmern muss. Oder auch seitenfüllend
 * darstellen etc. als Schnellauswahl anbieten. Das soll dann für den gesamten Präsentationsmodus gemerkt werden,
 * auch wenn man zwischen Cards wechselt."
 *
 *   A  Mittig: Was die Folie nicht füllt, steht in ihrer Mitte (auch Bild-Folien); verkleinert und vergrößert bleibt
 *      die Mitte stehen – mit den Tasten ohne Zeiger.
 *   B  Verschieben: auf freier Fläche ziehen, Leertaste + Ziehen (auch im Text), mittlere Maustaste,
 *      Umschalt + Pfeile; ein kurzer Druck auf die Leertaste blättert weiter; im Text wird weiter markiert.
 *   C  Schnellauswahl: Standard · Einpassen · Volle Breite – gilt für alle Folien, bleibt nach dem Neuladen,
 *      „0" führt dorthin zurück, „B" wechselt, Esc schließt erst die Auswahl.
 *   D  Dokument-Folien übernehmen die Darstellung; ihr eigener Umschalter gilt weiter je Dokument.
 *   E  Doppelklick zoomt auf Folien ohne eigene Bedienung heran und zurück; Finger: wischen blättert weiter,
 *      solange es seitlich nichts zu schieben gibt.
 *   F  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m403-folien-darstellung.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4719;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

function png(w, h) {
  const crcTab = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const stueck = (typ, daten) => { const kopf = Buffer.alloc(8); kopf.writeUInt32BE(daten.length, 0); kopf.write(typ, 4, 'latin1'); const pruef = Buffer.alloc(4); pruef.writeUInt32BE(crc(Buffer.concat([kopf.subarray(4), daten])), 0); return Buffer.concat([kopf, daten, pruef]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const roh = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; roh[i] = Math.round(255 * x / w); roh[i + 1] = Math.round(255 * y / h); roh[i + 2] = 140; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), stueck('IHDR', ihdr), stueck('IDAT', deflateSync(roh)), stueck('IEND', Buffer.alloc(0))]);
}
const bildUrl = `data:image/png;base64,${png(480, 300).toString('base64')}`;

const notiz = (id, x, zeilen) => ({ id, type: 'note', position: { x, y: 0 }, width: 260, height: 170, autoFit: false,
  data: { color: 'yellow', blocks: zeilen.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] })) } });
// Reihenfolge der Folien: lange Notiz · Bild · kurze Notiz · Bild-Datei (Dokument-Folie)
const KARTEN = [
  notiz('n1', 0, Array.from({ length: 5 }, (_, i) => `Zeile ${i + 1} der ersten Folie`)),
  { id: 'bild', type: 'image', position: { x: 400, y: 0 }, width: 240, height: 150, data: { src: bildUrl, name: 'skizze.png' } },
  notiz('n2', 800, ['Kurze Notiz']),
  { id: 'foto', type: 'file', position: { x: 1200, y: 0 }, width: 240, data: { name: 'urlaub.png', mime: 'image/png', size: 2000, dataUrl: bildUrl } },
];
const auf = async (opt = {}, sprache = '') => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, ...opt });
  await ctx.addInitScript(([karten, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: karten }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [KARTEN, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
};
const nah = (a, b, t = 2) => Math.abs(a - b) <= t;
const vortrag = async (P) => {
  await P.keyboard.press('Escape'); await P.mouse.click(1200, 760); await P.waitForTimeout(250);
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(900);
};
const lageVon = (P) => P.evaluate(() => {
  const f = document.querySelector('.presenter-slide'); const k = f?.firstElementChild; if (!f || !k) return null;
  const r = k.getBoundingClientRect(); const fr = f.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(k).transform);
  const knopf = document.querySelector('[data-taste="folie-zoom"]');
  return { zoom: Math.round(m.a * 1000) / 1000, chip: knopf?.textContent?.replace(/\s+/g, ' ').trim() ?? null, symbol: !!knopf?.querySelector('svg'),
    l: r.left, t: r.top, w: r.width, h: r.height, mx: r.left + r.width / 2, my: r.top + r.height / 2,
    f: { l: fr.left, t: fr.top, w: fr.width, h: fr.height, mx: fr.left + f.clientLeft + f.clientWidth / 2, my: fr.top + f.clientTop + f.clientHeight / 2, cw: f.clientWidth, ch: f.clientHeight },
    rollX: f.scrollWidth > f.clientWidth + 1, rollY: f.scrollHeight > f.clientHeight + 1, sl: f.scrollLeft, st: f.scrollTop,
    zaehler: document.querySelector('.presenter-count')?.textContent ?? '', bereit: f.classList.contains('zieh-bereit'), modus: f.classList.contains('fz-modus') };
});
const waehle = async (P, a) => {
  await P.locator('[data-taste="folie-zoom"]').click(); await P.waitForTimeout(200);
  await P.locator(`[data-taste="folie-ansicht"][data-ansicht="${a}"]`).click(); await P.waitForTimeout(450);
};
const ziehe = async (P, von, nach, knopf = 'left') => {
  await P.mouse.move(von.x, von.y); await P.mouse.down({ button: knopf });
  await P.mouse.move((von.x + nach.x) / 2, (von.y + nach.y) / 2, { steps: 4 }); await P.mouse.move(nach.x, nach.y, { steps: 4 });
  await P.mouse.up({ button: knopf }); await P.waitForTimeout(200);
};

const V = await auf();
const P = V.P;
const lage = () => lageVon(P);
await vortrag(P);

// ---------- A: mittig ----------
console.log('A  Mittig anzeigen, mittig zoomen');
{
  const n = await lage();
  pruefe('A1 die Notiz steht in der Mitte der Folie', !!n && nah(n.mx, n.f.mx, 2) && nah(n.my, n.f.my, 2) && n.zoom === 1, n);
  pruefe('A2 oben steht nur das Symbol der Darstellung, keine Zahl', n?.chip === '' && n.symbol, n);
  await P.keyboard.press('ArrowRight'); await P.waitForTimeout(700);
  const b = await lage();
  pruefe('A3 die Bild-Folie: das Bild steht in der Mitte der Folie (vorher: oben links)', !!b && /2 \/ 4/.test(b.zaehler) && nah(b.mx, b.f.mx, 2) && nah(b.my, b.f.my, 2) && b.w > 200 && b.w < b.f.w * 0.7, b);
  await P.keyboard.press('-'); await P.keyboard.press('-'); await P.waitForTimeout(300);
  const k = await lage();
  pruefe('A4 verkleinert (64 %) bleibt es in der Mitte', !!k && nah(k.zoom, 0.64, 0.01) && nah(k.mx, k.f.mx, 2) && nah(k.my, k.f.my, 2), k);
  await P.keyboard.press('0'); await P.waitForTimeout(350);
  for (let i = 0; i < 3; i++) await P.keyboard.press('+');
  await P.waitForTimeout(300);
  const g = await lage();
  pruefe('A5 vergrößert, solange es hineinpasst: weiter in der Mitte, nichts zu rollen', !!g && g.zoom > 1.9 && g.w < g.f.cw && !g.rollX && nah(g.mx, g.f.mx, 2), g);
  for (let i = 0; i < 4; i++) await P.keyboard.press('+');
  await P.waitForTimeout(300);
  const gg = await lage();
  pruefe('A6 größer als die Folie: die Mitte des Bildes bleibt in der Mitte des Ausschnitts (Tasten, ohne Zeiger)', !!gg && gg.w > gg.f.cw && gg.h > gg.f.ch && gg.rollX && gg.rollY && nah(gg.mx, gg.f.mx, 8) && nah(gg.my, gg.f.my, 8), gg);
  pruefe('A7 oben steht jetzt die Stufe', new RegExp(`^${Math.round(gg.zoom * 100)} %$`).test(gg.chip ?? ''), gg?.chip);
}

// ---------- B: verschieben ----------
console.log('B  Den Ausschnitt verschieben');
{
  // Bild-Folie, weit hineingezoomt: ein einfacher Zug verschiebt
  const a = await lage();
  await P.mouse.move(a.f.mx, a.f.my); await P.waitForTimeout(120);
  const hand = await P.evaluate(() => { const f = document.querySelector('.presenter-slide'); return { bereit: f.classList.contains('zieh-bereit'), zeiger: getComputedStyle(f.querySelector('img')).cursor }; });
  pruefe('B1 über dem Bild zeigt der Zeiger die Hand', hand.bereit && hand.zeiger === 'grab', hand);
  await ziehe(P, { x: a.f.mx, y: a.f.my }, { x: a.f.mx - 120, y: a.f.my - 80 });
  const b = await lage();
  pruefe('B2 ziehen verschiebt den Ausschnitt genau um den Weg der Maus', !!b && nah(b.sl - a.sl, 120, 2) && nah(b.st - a.st, 80, 2) && nah(b.l - a.l, -120, 2) && nah(b.t - a.t, -80, 2), { von: [a.sl, a.st], nach: [b?.sl, b?.st] });
  pruefe('B3 … und blättert dabei nicht', /2 \/ 4/.test(b?.zaehler ?? ''), b?.zaehler);
  // mittlere Maustaste
  await ziehe(P, { x: a.f.mx, y: a.f.my }, { x: a.f.mx + 60, y: a.f.my + 40 }, 'middle');
  const c = await lage();
  pruefe('B4 die mittlere Maustaste zieht ebenso', !!c && nah(c.sl - b.sl, -60, 2) && nah(c.st - b.st, -40, 2), { von: [b.sl, b.st], nach: [c?.sl, c?.st] });
  // Umschalt + Pfeile
  await P.keyboard.press('Shift+ArrowRight'); await P.waitForTimeout(500);
  await P.keyboard.press('Shift+ArrowDown'); await P.waitForTimeout(500);
  const d = await lage();
  pruefe('B5 Umschalt + Pfeil schiebt in Schritten – ohne zu blättern', !!d && d.sl > c.sl + 80 && d.st > c.st + 80 && /2 \/ 4/.test(d.zaehler), { von: [c.sl, c.st], nach: [d?.sl, d?.st], z: d?.zaehler });
  // Leertaste kurz: blättert weiter
  await P.keyboard.press('Space'); await P.waitForTimeout(600);
  pruefe('B6 ein kurzer Druck auf die Leertaste blättert weiter', /3 \/ 4/.test((await lage())?.zaehler ?? ''), (await lage())?.zaehler);
  await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(400); await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(600);

  // Notiz (editierbar), hineingezoomt
  for (let i = 0; i < 4; i++) await P.keyboard.press('+');
  await P.waitForTimeout(300);
  const n = await lage();
  pruefe('B7 die Notiz ist hineingezoomt und größer als die Folie', !!n && /1 \/ 4/.test(n.zaehler) && n.zoom > 2.3 && (n.rollX || n.rollY), n);
  // im Text ziehen: markiert, verschiebt nicht
  // eine Stelle im Text, die im Ausschnitt liegt
  const text = await P.evaluate(() => { const f = document.querySelector('.presenter-slide').getBoundingClientRect(); const p = document.querySelector('.presenter-slide .bn-block-content'); const r = p.getBoundingClientRect(); const x = Math.max(r.left + 12, f.left + 160); return { x, y: Math.max(r.top + r.height / 2, f.top + 60), bis: x + 300 }; });
  await ziehe(P, { x: text.x, y: text.y }, { x: text.bis, y: text.y });
  const m = await lage();
  const markiert = await P.evaluate(() => String(window.getSelection()));
  pruefe('B8 im Text ziehen markiert Text – der Ausschnitt bleibt', !!m && nah(m.sl, n.sl, 1) && nah(m.st, n.st, 1) && markiert.length > 2, { markiert, von: [n.sl, n.st], nach: [m?.sl, m?.st] });
  await P.locator('.presenter-count').click(); await P.waitForTimeout(150);
  // Leertaste + Ziehen: verschiebt auch über dem Text
  await P.mouse.move(text.x + 60, text.y);
  await P.keyboard.down('Space'); await P.waitForTimeout(120);
  const handAn = await P.evaluate(() => document.documentElement.classList.contains('folie-hand'));
  await P.mouse.down(); await P.mouse.move(text.x + 10, text.y - 30, { steps: 5 }); await P.mouse.move(text.x - 40, text.y - 60, { steps: 5 }); await P.mouse.up();
  await P.waitForTimeout(700);     // länger als ein „kurzer Druck"
  await P.keyboard.up('Space'); await P.waitForTimeout(500);
  const s = await lage();
  pruefe('B9 Leertaste halten zeigt die Hand', handAn);
  pruefe('B10 Leertaste + Ziehen verschiebt auch über dem Text', !!s && nah(s.sl - m.sl, 100, 3) && nah(s.st - m.st, m.rollY ? 60 : 0, 3), { von: [m.sl, m.st], nach: [s?.sl, s?.st] });
  pruefe('B11 … und blättert danach nicht weiter', /1 \/ 4/.test(s?.zaehler ?? ''), s?.zaehler);
  // freie Fläche der Folie (neben dem Inhalt, falls sichtbar) – sonst der Rand des Inhalts
  await P.keyboard.press('0'); await P.waitForTimeout(350);
  const null1 = await lage();
  pruefe('B12 „0" führt zurück: 100 %, in der Mitte, oben nur das Symbol', null1?.zoom === 1 && nah(null1.mx, null1.f.mx, 2) && null1.chip === '', null1);
  // bei 100 % gibt es nichts zu schieben: die Leertaste blättert sofort (beim Drücken, wie bisher)
  await P.keyboard.down('Space'); await P.waitForTimeout(350);
  const sofort = (await lage())?.zaehler ?? '';
  await P.keyboard.up('Space'); await P.waitForTimeout(300);
  pruefe('B13 ohne etwas zu verschieben blättert die Leertaste sofort', /2 \/ 4/.test(sofort), sofort);
  await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(600);
}

// ---------- C: Schnellauswahl ----------
console.log('C  Darstellung als Schnellauswahl');
{
  await P.keyboard.press('ArrowRight'); await P.waitForTimeout(350); await P.keyboard.press('ArrowRight'); await P.waitForTimeout(700);
  const a = await lage();
  pruefe('C0 die kurze Notiz steht bei 100 % in der Mitte', !!a && /3 \/ 4/.test(a.zaehler) && a.zoom === 1 && nah(a.mx, a.f.mx, 2), a);
  await P.locator('[data-taste="folie-zoom"]').click(); await P.waitForTimeout(250);
  const menu = await P.evaluate(() => ({ eintraege: [...document.querySelectorAll('[data-taste="folie-ansicht"]')].map((b) => `${b.textContent.trim()}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`),
    stufe: document.querySelector('[data-taste="ansicht-stufe"]')?.textContent?.trim(), imBild: (() => { const r = document.querySelector('.presenter-ansicht-menu').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0; })() }));
  pruefe('C1 die Auswahl: Standard (gewählt) · Einpassen · Volle Breite, dazu die Stufe', menu.eintraege.join('|') === 'Standard*|Einpassen|Volle Breite' && menu.stufe === '100 %' && menu.imBild, menu);
  await P.keyboard.press('Escape'); await P.waitForTimeout(250);
  pruefe('C2 Esc schließt die Auswahl – die Präsentation bleibt offen', (await P.locator('.presenter-ansicht-menu').count()) === 0 && (await P.locator('.presenter').count()) === 1);
  await P.locator('[data-taste="folie-zoom"]').click(); await P.waitForTimeout(200);
  await P.locator('[data-taste="ansicht-groesser"]').click(); await P.waitForTimeout(250);
  const plus = await P.evaluate(() => document.querySelector('[data-taste="ansicht-stufe"]')?.textContent?.trim());
  pruefe('C3 „+" in der Auswahl vergrößert, die Auswahl bleibt offen', plus === '125 %' && nah((await lage()).zoom, 1.25, 0.01), plus);
  await P.locator('[data-taste="folie-ansicht"][data-ansicht="einpassen"]').click(); await P.waitForTimeout(500);
  const e = await lage();
  const rand = 24;
  const fuelltB = nah(e.w, e.f.cw - 2 * rand, 4); const fuelltH = nah(e.h, e.f.ch - 2 * rand, 4);
  pruefe('C4 „Einpassen": die kurze Notiz füllt die Folie – so groß, wie sie ganz hineinpasst', !!e && e.zoom > 1.1 && (fuelltB || fuelltH) && e.w <= e.f.cw - 2 * rand + 1 && e.h <= e.f.ch - 2 * rand + 1, e);
  pruefe('C5 … mittig, ohne Rollbalken, oben nur das Symbol', nah(e.mx, e.f.mx, 2) && nah(e.my, e.f.my, 2) && !e.rollX && !e.rollY && e.chip === '' && e.symbol, e);
  pruefe('C6 gemerkt auf diesem Gerät', (await P.evaluate(() => localStorage.getItem('pixinotes-folien-ansicht'))) === 'einpassen');
  // andere Folie: dieselbe Darstellung
  await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(800);
  const b = await lage();
  pruefe('C7 die Bild-Folie davor ist ebenfalls eingepasst (größer als 100 %, ganz im Bild, mittig)', !!b && /2 \/ 4/.test(b.zaehler) && b.zoom > 1.5 && b.w <= b.f.cw && b.h <= b.f.ch && nah(b.mx, b.f.mx, 2) && nah(b.my, b.f.my, 2) && (nah(b.h, b.f.ch - 2 * rand, 4) || nah(b.w, b.f.cw - 2 * rand, 4)), b);
  // selbst zoomen, „0" führt zur Darstellung zurück – nicht zu 100 %
  await P.keyboard.press('+'); await P.waitForTimeout(250);
  const z = await lage();
  await P.keyboard.press('0'); await P.waitForTimeout(400);
  const zurueck = await lage();
  pruefe('C8 selbst gezoomt zeigt die Stufe; „0" führt zur gewählten Darstellung zurück', z.zoom > b.zoom * 1.2 && /%$/.test(z.chip ?? '') && nah(zurueck.zoom, b.zoom, 0.005) && zurueck.chip === '', { z: z.zoom, chip: z.chip, zurueck: zurueck.zoom });
  // Volle Breite: die lange Notiz
  await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(700);
  await P.locator('.presenter-count').click(); await P.waitForTimeout(100);
  await P.keyboard.press('b'); await P.waitForTimeout(500);
  const w = await lage();
  pruefe('C9 „B" wählt „Volle Breite": der Inhalt ist so breit wie die Folie', !!w && /1 \/ 4/.test(w.zaehler) && nah(w.w, w.f.cw - 2 * rand, 4) && nah(w.mx, w.f.mx, 2) && (await P.evaluate(() => localStorage.getItem('pixinotes-folien-ansicht'))) === 'breite', w);
  pruefe('C10 … und bleibt in der Höhe der Folie (die Notiz rollt in sich, nicht Notiz und Folie)', !!w && w.h <= w.f.ch - 2 * rand + 2 && !w.rollY, w);
  await P.keyboard.press('b'); await P.waitForTimeout(450);
  pruefe('C11 noch einmal „B" führt zur Darstellung davor (Einpassen)', (await P.evaluate(() => localStorage.getItem('pixinotes-folien-ansicht'))) === 'einpassen');
  await P.keyboard.press('b'); await P.waitForTimeout(450);
}

// ---------- D: Dokument-Folien ----------
console.log('D  Dokument-Folien übernehmen die Darstellung');
{
  const dok = () => P.evaluate(() => { const d = document.querySelector('.folie-dok'); const f = document.querySelector('.folie-dok-flaeche'); const s = document.querySelector('.folie-dok-seite')?.getBoundingClientRect();
    return d ? { modus: d.dataset.modus, zoom: Number(d.dataset.zoom), sl: f.scrollLeft, st: f.scrollTop, rollbar: f.scrollWidth > f.clientWidth + 1 || f.scrollHeight > f.clientHeight + 1, b: s?.width ?? 0, platz: f.clientWidth, knopf: !!document.querySelector('[data-taste="folie-zoom"]') } : null; });
  await P.keyboard.press('End'); await P.waitForTimeout(1200);
  let d = await dok();
  pruefe('D1 „Volle Breite" gilt auch für die Bild-Datei: Seitenbreite', d?.modus === 'breite' && d.zoom === 1 && d.knopf, d);
  await waehle(P, 'einpassen');
  d = await dok();
  pruefe('D2 in der Auswahl „Einpassen" gewählt → sofort die ganze Seite', d?.modus === 'seite' && d.zoom === 1, d);
  // der eigene Umschalter des Dokuments gilt weiter – nur für dieses Dokument
  await P.locator('[data-taste="folie-modus"]').click(); await P.waitForTimeout(450);
  d = await dok();
  pruefe('D3 der Umschalter des Dokuments wechselt weiter (Seitenbreite) – die Darstellung der Präsentation bleibt', d?.modus === 'breite' && (await P.evaluate(() => localStorage.getItem('pixinotes-folien-ansicht'))) === 'einpassen', d);
  // hineingezoomt: ziehen verschiebt
  await P.keyboard.press('+'); await P.keyboard.press('+'); await P.keyboard.press('+'); await P.waitForTimeout(500);
  const vor = await dok();
  const mitte = await P.evaluate(() => { const r = document.querySelector('.folie-dok-flaeche').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await ziehe(P, mitte, { x: mitte.x - 90, y: mitte.y - 70 });
  const nach = await dok();
  pruefe('D4 im vergrößerten Dokument verschiebt ein Zug den Ausschnitt', vor.rollbar && nah(nach.sl - vor.sl, 90, 2) && nah(nach.st - vor.st, 70, 2), { vor, nach });
  await P.keyboard.press('0'); await P.waitForTimeout(300);
  await waehle(P, 'standard');
  d = await dok();
  pruefe('D5 „Standard" stellt das Dokument wieder nach Lesbarkeit ein', (d?.modus === 'seite' || d?.modus === 'breite') && d.zoom === 1 && (await P.evaluate(() => localStorage.getItem('pixinotes-folien-ansicht'))) === null, d);
}

// ---------- E: Doppelklick, Finger ----------
console.log('E  Doppelklick und Finger');
{
  await P.keyboard.press('Home'); await P.waitForTimeout(500); await P.keyboard.press('ArrowRight'); await P.waitForTimeout(700);
  const a = await lage();
  const punkt = { x: a.l + a.w * 0.25, y: a.t + a.h * 0.3 };
  await P.mouse.dblclick(punkt.x, punkt.y); await P.waitForTimeout(450);
  const b = await lage();
  pruefe('E1 Doppelklick auf das Bild zoomt auf das Zweieinhalbfache', !!b && /2 \/ 4/.test(b.zaehler) && a.zoom === 1 && nah(b.zoom, 2.5, 0.01), b);
  await P.mouse.dblclick(punkt.x, punkt.y); await P.waitForTimeout(450);
  const c = await lage();
  pruefe('E2 noch ein Doppelklick führt zurück', c?.zoom === 1 && nah(c.mx, c.f.mx, 2), c);
  // editierbare Folie: Doppelklick markiert ein Wort, zoomt nicht
  await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(600);
  const wort = await P.evaluate(() => { const p = document.querySelector('.presenter-slide .bn-block-content'); const r = p.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  await P.mouse.dblclick(wort.x, wort.y); await P.waitForTimeout(350);
  pruefe('E3 in der Notiz markiert der Doppelklick ein Wort – gezoomt wird nicht', (await lage())?.zoom === 1 && (await P.evaluate(() => String(window.getSelection()))).trim().length > 2);
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
}
await V.ctx.close();
{
  // Telefon: eingepasst ist das Bild größer als 100 %, aber es gibt seitlich nichts zu schieben – wischen blättert
  const T = await auf({ viewport: { width: 400, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await T.P.evaluate(() => localStorage.setItem('pixinotes-folien-ansicht', 'einpassen'));
  await T.P.reload({ waitUntil: 'networkidle' }); await T.P.waitForTimeout(1200);
  await T.P.evaluate(() => { const s = JSON.parse(localStorage.getItem('pixinotes-board')); return s.state.boards[0].nodes.length; });
  await T.P.keyboard.press('Alt+p'); await T.P.waitForSelector('.presenter', { timeout: 5000 }); await T.P.waitForTimeout(900);
  await T.P.keyboard.press('ArrowRight'); await T.P.waitForTimeout(800);
  const a = await lageVon(T.P);
  pruefe('E4 Telefon, nach dem Neuladen: die gemerkte Darstellung gilt – das Bild ist eingepasst', !!a && /2 \/ 4/.test(a.zaehler) && a.modus && nah(a.w, a.f.cw - 2 * Math.min(24, (a.f.w - a.f.cw) / 2 + 24), 30) && a.w <= a.f.cw && nah(a.mx, a.f.mx, 2), a);
  const kopf = await T.P.evaluate(() => { const k = document.querySelector('.presenter-head'); const x = [...k.querySelectorAll('button')].map((b) => b.getBoundingClientRect()); return { breit: k.scrollWidth <= k.clientWidth + 1, alleImBild: x.every((r) => r.left >= 0 && r.right <= window.innerWidth + 0.5), knopf: (() => { const r = document.querySelector('[data-taste="folie-zoom"]').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() }; });
  pruefe('E5 die Kopfzeile passt am Telefon ganz ins Bild, das Symbol ist mit dem Finger zu treffen', kopf.alleImBild && kopf.knopf[0] >= 40 && kopf.knopf[1] >= 40, kopf);
  await T.P.locator('[data-taste="folie-zoom"]').tap(); await T.P.waitForTimeout(300);
  const tm = await T.P.evaluate(() => { const r = document.querySelector('.presenter-ansicht-menu')?.getBoundingClientRect(); return r ? { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: window.innerWidth } : null; });
  pruefe('E5b die Auswahl öffnet sich am Telefon ganz im Bild', !!tm && tm.l >= 0 && tm.r <= tm.b && tm.t > 30, tm);
  await T.P.locator('[data-taste="folie-ansicht"][aria-checked="true"]').tap(); await T.P.waitForTimeout(300);
  const wischen = (x0, x1, y) => T.P.evaluate(([a0, a1, yy]) => {
    const el = document.querySelector('.presenter-slide');
    const mk = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: yy, touchType: 'direct' });
    const los = (typ, t, c) => el.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true, composed: true, touches: t, targetTouches: t, changedTouches: c }));
    los('touchstart', [mk(a0)], [mk(a0)]);
    for (let i = 1; i <= 5; i++) { const x = a0 + ((a1 - a0) * i) / 5; los('touchmove', [mk(x)], [mk(x)]); }
    los('touchend', [], [mk(a1)]);
  }, [x0, x1, y]);
  await wischen(320, 80, a.f.my); await T.P.waitForTimeout(600);
  pruefe('E6 wischen blättert weiter, obwohl die Folie größer als 100 % zeigt (es gibt seitlich nichts zu schieben)', /3 \/ 4/.test((await lageVon(T.P))?.zaehler ?? ''), (await lageVon(T.P))?.zaehler);
  await T.ctx.close();
}

// ---------- F: Texte ----------
console.log('F  Texte');
{
  const E = await auf({}, 'en');
  await vortrag(E.P);
  await E.P.locator('[data-taste="folie-zoom"]').click(); await E.P.waitForTimeout(300);
  const en = await E.P.evaluate(() => ({ eintraege: [...document.querySelectorAll('[data-taste="folie-ansicht"]')].map((b) => b.textContent.trim()), knopf: document.querySelector('[data-taste="folie-zoom"]').getAttribute('aria-label') }));
  pruefe('F1 englisch: Default · Fit · Full width', en.eintraege.join('|') === 'Default|Fit|Full width' && en.knopf === 'Slide view', en);
  await E.ctx.close();
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  pruefe('F2 die Hilfe nennt M403 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M403)') && lies('src/components/HelpOverlayEn.tsx').includes('(M403)'));
  pruefe('F3 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm403-folien-darstellung: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
