/**
 * M436 — Ablauf-Formen nachgeschärft.
 *
 * Gemeldet: „Wenn ich in den Prozess-Formen Handschrift wähle etc., wird das nicht richtig übernommen; Resizing manuell
 * kommt mit dem Auto-Sizing in Konflikt; wenn ich Text als Überschrift gestalte, wird immer unterhalb eine leere Zeile
 * angezeigt und der Text ist entsprechend nicht mehr zentriert in der Form!"
 *
 *   A  Schriftart und -größe aus dem Schrift-Menü (Handschrift, groß …) stehen auch in der ruhenden Form da.
 *   B  Eine Überschrift steht mittig — keine leere Zeile darunter, weder ruhend noch im Editor.
 *   C  Von Hand ziehen: Die Form folgt der Hand, behält danach die gezogene Größe; zu klein für den Text wächst sie
 *      nur in die Höhe (die von Hand gesetzte Breite bleibt, auch bei der Raute).
 *   E  „Textbearbeitungs-Menü: falsche Z-Reihenfolge!" — Formatleiste und ihre Menüs liegen über Anfassern,
 *      Verbindungspunkten und der Form-Leiste.
 */
// Läuft aus dem Repository: `node pruefungen/m436-formen-feinschliff.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 4772;
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
const absatz = (text, styles = {}) => ({ id: Math.random().toString(36).slice(2), type: 'paragraph', props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }, content: [{ type: 'text', text, styles }], children: [] });
const leer = () => ({ id: Math.random().toString(36).slice(2), type: 'paragraph', props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }, content: [], children: [] });
const titel = (text) => ({ id: Math.random().toString(36).slice(2), type: 'heading', props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left', level: 2 }, content: [{ type: 'text', text, styles: {} }], children: [] });
const form = (id, shape, x, y, w, h, blocks, text) => ({ id, type: 'shape', position: { x, y }, width: w, height: h, data: { shape, color: '#eef2ff', text, blocks } });
const NODES = [
  form('h', 'process', 0, 0, 170, 80, [absatz('Handschrift', { textFont: 'hand', textSize: 'gross' }), leer()], 'Handschrift'),
  form('u', 'process', 260, 0, 170, 90, [titel('Prüfen'), leer()], 'Prüfen'),
  form('r', 'decision', 520, -10, 170, 100, [absatz('Ok?'), leer()], 'Ok?'),
];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1300, height: 820 } });
await ctx.addInitScript(([ns]) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'Ablauf', edges: [], drawings: [], nodes: ns }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board' } }));
}, [NODES]);
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2200);
const warte = (ms = 500) => P.waitForTimeout(ms);
const karte = async (id) => { await warte(1300); return P.evaluate((i) => { const n = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((k) => k.id === i); return { w: n.width, h: n.height, grund: n.data.grund ?? null }; }, id); };
const mitte = async (id) => { const b = await P.locator(`.react-flow__node[data-id="${id}"] .shape-body`).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
/** Wie weit liegt der sichtbare Text neben der Mitte der Form (Punkte, senkrecht)? */
const versatz = (id) => P.evaluate((i) => {
  const body = document.querySelector(`.react-flow__node[data-id="${i}"] .shape-body`);
  const sichtbar = [...body.querySelectorAll('.bn-block-outer')].filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height > 0);
  if (!sichtbar.length) return 999;
  const oben = Math.min(...sichtbar.map((b) => b.getBoundingClientRect().top)); const unten = Math.max(...sichtbar.map((b) => b.getBoundingClientRect().bottom));
  const r = body.getBoundingClientRect();
  return Math.round(Math.abs((oben + unten) / 2 - (r.top + r.height / 2)));
}, id);

console.log('A  Schrift');
const schrift = await P.evaluate(() => { const s = [...document.querySelectorAll('.react-flow__node[data-id="h"] .shape-ruhend span')].filter((e) => e.textContent === 'Handschrift' && !e.querySelector('span')).pop(); const c = s && getComputedStyle(s); return c ? { font: c.fontFamily, size: parseFloat(c.fontSize) } : null; });
pruefe('A1 Handschrift und „groß" stehen auch in der ruhenden Form da', !!schrift && /Kalam/.test(schrift.font) && schrift.size > 14, schrift);

console.log('B  Überschrift mittig');
const vu = await versatz('u');
const zeilen = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="u"] .bn-block-outer')].filter((b) => b.getBoundingClientRect().height > 0).length);
pruefe('B1 ruhend: nur die Überschrift, keine leere Zeile darunter – mittig', zeilen === 1 && vu <= 2, { zeilen, vu });
let [mx, my] = await mitte('u');
await P.mouse.dblclick(mx, my); await warte(500);
const ve = await versatz('u');
pruefe('B2 im Editor ebenso mittig', (await P.locator('.react-flow__node[data-id="u"] [contenteditable="true"]').count()) === 1 && ve <= 2, { ve });
await warte(300); await P.keyboard.press('End'); await warte(100); await P.keyboard.press('Enter'); await P.keyboard.type('weiter'); await warte(300);
const zwei = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="u"] .bn-block-outer')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent));
pruefe('B3 wer unter der Überschrift weiterschreibt, sieht seine Zeile', zwei.includes('weiter'), zwei);
await P.screenshot({ path: path.join(SD, 'm436-formen.png') });
await P.mouse.click(1150, 700); await warte(500);

console.log('C  Von Hand ziehen');
// Die Raute wählen und am Anfasser unten rechts deutlich größer ziehen
[mx, my] = await mitte('r');
await P.mouse.click(mx, my); await warte(300);
const griff = await P.locator('.react-flow__node[data-id="r"] .react-flow__resize-control.handle.bottom.right').boundingBox();
const gx = griff.x + griff.width / 2; const gy = griff.y + griff.height / 2;
await P.mouse.move(gx, gy); await P.mouse.down();
const spur = [];
for (let i = 1; i <= 10; i += 1) {
  await P.mouse.move(gx + i * 8, gy + i * 6); await warte(40);
  spur.push(await P.evaluate(() => { const b = document.querySelector('.react-flow__node[data-id="r"]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }));
}
await P.mouse.up(); await warte(300);
const folgt = spur.every((s, i) => i === 0 || (s[0] >= spur[i - 1][0] && s[1] >= spur[i - 1][1]));
const gross = await karte('r');
pruefe('C1 während des Ziehens folgt die Form der Hand (kein Zurückspringen)', folgt, spur);
pruefe('C2 danach behält sie die gezogene Größe', gross.w >= 240 && gross.h >= 150 && gross.grund?.manuell === true, gross);
// Jetzt schmal ziehen und viel Text schreiben: die Breite bleibt, die Höhe wächst
const g2 = await P.locator('.react-flow__node[data-id="r"] .react-flow__resize-control.handle.bottom.right').boundingBox();
await P.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2); await P.mouse.down();
await P.mouse.move(g2.x - 70, g2.y - 60, { steps: 8 }); await P.mouse.up(); await warte(400);
const schmal = await karte('r');
[mx, my] = await mitte('r');
await P.mouse.dblclick(mx, my); await warte(400);
await P.keyboard.press('Control+End');
await P.keyboard.type(' Sind alle Nachweise und Unterschriften vollständig?'); await warte(900);
const voll = await karte('r');
pruefe('C3 von Hand gesetzte Breite bleibt; der Text holt sich nur Höhe', Math.abs(voll.w - schmal.w) <= 1 && voll.h > schmal.h, { schmal, voll });
await P.mouse.click(1150, 700); await warte(300);

console.log('E  Menüs obenauf');
[mx, my] = await mitte('h');
await P.mouse.click(mx, my); await warte(300);
await P.mouse.dblclick(mx, my); await warte(600);
await P.keyboard.press('Control+a'); await warte(600);
await P.locator('.bn-formatting-toolbar button').first().click(); await warte(500);
const verdeckt = await P.evaluate(() => {
  const m = document.querySelector('.mantine-Menu-dropdown'); if (!m) return ['kein Menü'];
  const r = m.getBoundingClientRect(); const fremd = new Set();
  for (let y = r.top + 6; y < r.bottom - 6; y += 10) for (let x = r.left + 6; x < r.right - 6; x += 10) {
    const e = document.elementFromPoint(x, y); if (e && !m.contains(e)) fremd.add(String(e.className).slice(0, 40));
  }
  return [...fremd];
});
pruefe('E1 das Absatz-Menü der Formatleiste liegt über Anfassern, Verbindungspunkten und Form-Leiste', verdeckt.length === 0, verdeckt);
await P.keyboard.press('Escape'); await P.mouse.click(1150, 700); await warte(300);

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('D1 Hilfe und Umbau-Liste nennen M436', /M436/.test(hilfe) && /M436/.test(umbau));
}
await browser.close(); app.close();
console.log(`\nM436: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
