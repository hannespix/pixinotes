/**
 * M422 — Ideabubbles: Kein Tropfen wird mehr am Rand der Bühne abgeschnitten.
 *
 * Gemeldet (Screenshot am Telefon, dunkel): „Ich meine das Problem, dass die Bubbles vom Rand abgeschnitten werden,
 * wenn sie diesen berühren." Die Physik hielt nur jede Idee von der Kante fern — die Form einer Gruppe ragt im
 * Tropfen-Look aber um ihren Rand darüber hinaus, und oben wächst die Kuppe mit dem Namen heraus. Die Bühne schnitt
 * glatt ab; der Name wich nach unten aus, mitten in die Nachbargruppe.
 *
 *   A  Volle, enge Bühne (Telefon, vier Gruppen): jede Form und jede Namenskuppe liegt ganz in der Bühne.
 *   B  Der Name steht über seiner Gruppe (nicht darunter).
 *   C  Auch nach dem Ziehen einer Gruppe an den Rand: nichts abgeschnitten.
 *   D  Schrift: kurze Wörter werden nicht getrennt; lange Wörter nicht winzig.
 *   E  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m422-tropfen-am-rand.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium, devices } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4759;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const t = Date.now();
const ideen = {};
const liste = [['Deine Mudder hat auch ne Blase', 'g1'], ['Norbert', 'g1'], ['Ich mag Kekse', 'g1'], ['Vaterlandsliebeleidampfhochhausmuseum', 'g1'],
  ['Chuck Norris war hier', 'g2'], ['noi', 'g2'], ['Heeeey Ihringer :-)', 'g2'],
  ['Heyyy zurück', 'g3'], ['Kuchen', 'g3'], ['Apfel', 'g3'], ['Waterboarding', 'g3'], ['huch', 'g3'],
  ['blaaaaa', 'g4'], ['Moscow mule!', 'g4'], ['Theaterstück über Menopause', 'g4'], ['Blubb', 'g4']];
liste.forEach(([x, g], i) => { ideen['i' + i] = { text: x, von: 'g:' + (i % 5), name: 'Anna', t, g }; });
const gruppen = { g1: { name: 'Spielfilmvertreter', farbe: 0, t }, g2: { name: 'Humor', farbe: 1, t }, g3: { name: 'Begrüßungen', farbe: 2, t }, g4: { name: 'Alltagsaufnahmen', farbe: 3, t } };
const karte = (w, h) => ({ id: 'b1', type: 'bubbles', position: { x: 0, y: 0 }, width: w, height: h, data: { title: 'Ideen', frage: 'Wie könnten wir …?', ideen, stimmen: {}, gruppen, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } });

async function auf(w, h, geraet = devices['Pixel 7'], dunkel = true) {
  const ctx = await browser.newContext({ ...geraet, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { boards: [{ id: 'x', name: 'Colab Demo', edges: [], drawings: [], nodes: [karte(w, h)] }], spaces: [{ id: 's1', name: 'Misc', projects: [{ id: 'p1', name: 'Misc', boardIds: ['x'] }] }], activeId: 'x', view: 'board' });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(6500);
  return { ctx, P };
}
/** Was ragt über die Bühne hinaus? (Formen der Tropfen, Kuppen, Namen) — in Bildpunkten */
const ueberstand = (P) => P.evaluate(() => {
  const bu = document.querySelector('.bub-buehne').getBoundingClientRect();
  const raus = [];
  for (const e of document.querySelectorAll('.bub-formen .bub-form, .bub-ring-name, .bub-blase')) {
    const r = e.getBoundingClientRect(); if (r.width < 1) continue;
    const m = Math.max(bu.left - r.left, bu.top - r.top, r.right - bu.right, r.bottom - bu.bottom);
    if (m > 0.5) raus.push([e.className.split(' ').slice(0, 2).join('.'), (e.textContent || '').trim().slice(0, 14), Math.round(m)]);
  }
  return raus;
});
const namenOben = (P) => P.evaluate(() => {
  const out = [];
  for (const n of document.querySelectorAll('.bub-ring-name')) {
    const gid = n.dataset.gruppe;
    const blasen = [...document.querySelectorAll(`.bub-blase[data-gruppe="${gid}"]`)];
    if (!blasen.length) continue;
    const oben = Math.min(...blasen.map((b) => b.getBoundingClientRect().top));
    out.push([n.textContent.trim(), Math.round(n.getBoundingClientRect().bottom - oben)]);
  }
  return out;
});

console.log('A/B  Enge Bühne am Telefon (dunkel)');
{
  const { ctx, P } = await auf(330, 480);
  const raus = await ueberstand(P);
  pruefe('A1 jede Form, Kuppe und Idee liegt ganz in der Bühne', raus.length === 0, raus);
  const brueche = await P.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('.bub-blase')) {
      const tx = e.querySelector('.bub-text') ?? e; const node = [...tx.childNodes].find((n) => n.nodeType === 3); if (!node) continue;
      const r = document.createRange(); let zeile = null; let vorher = '';
      for (let i = 0; i < node.textContent.length; i++) {
        r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getClientRects()[0]; if (!q) continue;
        const z = Math.round(q.top);
        // Wörter unter 10 Zeichen dürfen nie getrennt werden (längere trennt der Browser mit Strich — der steht nicht im Text)
        const wortHier = node.textContent.slice(0, i).match(/\S*$/)[0] + node.textContent.slice(i).match(/^\S*/)[0];
        if (zeile !== null && z > zeile + 2 && /\S/.test(vorher) && /\S/.test(node.textContent[i]) && !/[-–]/.test(vorher) && wortHier.length < 10) out.push(wortHier);
        zeile = z; vorher = node.textContent[i];
      }
    }
    return out;
  });
  pruefe('A2 kein Wort unter 10 Zeichen bricht mitten im Wort', brueche.length === 0, brueche);
  const n = await namenOben(P);
  pruefe('B1 jeder Gruppenname steht über seiner Gruppe', n.length === 4 && n.every(([, d]) => d <= 4), n);
  await P.screenshot({ path: path.join(SD, 'm422-telefon-dunkel.png') });

  console.log('C  An den Rand gezogen');
  const bu = await P.locator('.bub-buehne').boundingBox();
  for (const [text, zx, zy] of [['Apfel', bu.x + bu.width - 6, bu.y + 6], ['Blubb', bu.x + 6, bu.y + bu.height - 6]]) {
    const b = await P.locator('.bub-blase', { hasText: text }).first().boundingBox();
    await P.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await P.mouse.down();
    for (let i = 1; i <= 14; i++) { await P.mouse.move(b.x + b.width / 2 + (zx - b.x - b.width / 2) * i / 14, b.y + b.height / 2 + (zy - b.y - b.height / 2) * i / 14); await P.waitForTimeout(16); }
    await P.mouse.up(); await P.waitForTimeout(2500);
  }
  const raus2 = await ueberstand(P);
  pruefe('C1 nach dem Ziehen in die Ecken: wieder nichts abgeschnitten', raus2.length === 0, raus2);
  await ctx.close();
}

console.log('D  Schrift');
{
  const { ctx, P } = await auf(700, 900, devices['Pixel 7'], false);
  const d = await P.evaluate(() => {
    const zeilen = (text) => { const e = [...document.querySelectorAll('.bub-blase')].find((b) => b.textContent.trim() === text); const tx = e.querySelector('.bub-text') ?? e; const r = document.createRange(); r.selectNodeContents(tx); return { zeilen: new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size, fs: parseFloat(getComputedStyle(e).fontSize) }; };
    return { kuchen: zeilen('Kuchen'), apfel: zeilen('Apfel'), lang: zeilen('Vaterlandsliebeleidampfhochhausmuseum') };
  });
  pruefe('D1 kurze Wörter bleiben ganz („Kuchen" in einer Zeile)', d.kuchen.zeilen === 1, d);
  pruefe('D2 ein langes Wort wird getrennt statt auf die kleinste Stufe geschrumpft (über 8 Punkte)', d.lang.fs > 8, d);
  await P.screenshot({ path: path.join(SD, 'm422-hell.png') });
  await ctx.close();
}

console.log('E  Hilfe');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('E1 Hilfe nennt M422 – deutsch und englisch', quelle('src/components/HelpOverlay.tsx').includes('(M422)') && quelle('src/components/HelpOverlayEn.tsx').includes('(M422)'));
pruefe('E2 docs/UMBAU.md führt M422', quelle('docs/UMBAU.md').includes('M422'));
pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM422: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
