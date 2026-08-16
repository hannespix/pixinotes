/**
 * M277 — Formatier-Leiste am Telefon dockt auch auf BOARD-Ebene unten an.
 *
 * Der Befund davor: Auf Board-Ebene steckte die schwebende Leiste im
 * React-Flow-Knoten; dessen `transform` machte die KARTE zum Bezugsrahmen
 * von `position: fixed`. Die Leiste war exakt kartenbreit (280 statt 390
 * Punkte), klebte mitten im Bild und skalierte mit dem Board-Zoom. Im Fokus
 * war alles richtig — genau das Gefälle, das der User gemeldet hat.
 *
 * Jetzt rendert die Leiste am Telefon als Portal am `body` (NoteTypo.tsx,
 * PhoneFormatDock). Geprüft wird:
 *  · volle Schirmbreite, unten angedockt, keine transform-Ahnen
 *  · die Auswahl-Leiste weicht nach oben aus (kein Übereinander)
 *  · Fett wirkt wirklich auf den markierten Text
 *  · A−/A+/Aa (M267) stehen in der Leiste
 *  · Tipp auf die freie Fläche blendet die Leiste aus
 *  · am Desktop schwebt die Leiste weiterhin an der Auswahl
 */
// Läuft aus dem Repository: `node pruefungen/m277-format-dock.mjs`
// Voraussetzung: `npm run build` (die Reihe prüft den dist/-Stand) und ein
// Chromium — Pfad über die Umgebungsvariable PW_CHROMIUM, sonst der
// Standardpfad der Claude-Umgebung.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4496;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};

const seed = () => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  const blocks = [{ id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Hallo Welt dies ist ein Beispieltext für die Formatprobe', styles: {} }], children: [] }];
  const nodes = [{ id: 'n1', type: 'note', position: { x: 20, y: 120 }, width: 280, height: 200,
    data: { blocks, color: 'amber' } }];
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
    spaces: [{ id: 's1', name: 'P', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

/** In den Notiztext klicken und die Zeile markieren */
async function markiere(P) {
  const absatz = P.locator('.bn-editor p').first();
  await absatz.click();
  await P.waitForTimeout(500);
  await absatz.click();
  await P.waitForTimeout(500);
  await P.keyboard.press('Home');
  await P.keyboard.press('Shift+End');
  await P.waitForTimeout(800);
}

// ══ Telefon: Board-Ebene ══════════════════════════════════════════════
console.log('════ T1: Telefon, Board-Ebene ════');
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
});
await ctx.addInitScript(seed);
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2200);
await markiere(P);
{
  const m = await P.evaluate(() => {
    const t = document.querySelector('.bn-formatting-toolbar');
    if (!t) return null;
    const w = t.parentElement;
    const b = w.getBoundingClientRect();
    let ahn = w.parentElement; const trans = [];
    while (ahn && ahn !== document.documentElement) {
      const tr = getComputedStyle(ahn).transform;
      if (tr && tr !== 'none') trans.push(ahn.className?.toString().split(' ')[0]);
      ahn = ahn.parentElement;
    }
    return { box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
      fenster: [window.innerWidth, window.innerHeight], trans, imDock: !!w.closest('.pn-format-dock') || w.classList.contains('pn-format-dock') };
  });
  console.log('   ', JSON.stringify(m));
  pruefe('T1a die Leiste erscheint bei Textauswahl', !!m);
  if (m) {
    pruefe('T1b sie ist SCHIRMBREIT, nicht kartenbreit', m.box[2] >= m.fenster[0] - 2, `${m.box[2]} von ${m.fenster[0]}`);
    pruefe('T1c sie sitzt unten am Schirm', Math.abs(m.box[1] + m.box[3] - m.fenster[1]) < 8, JSON.stringify(m.box));
    pruefe('T1d kein transform-Ahne verzerrt sie mehr', m.trans.length === 0, JSON.stringify(m.trans));
  }
  const ueber = await P.evaluate(() => {
    const s = document.querySelector('.sel-toolbar-dock')?.getBoundingClientRect();
    const d = document.querySelector('.pn-format-dock')?.getBoundingClientRect();
    return s && d ? { ueberlappt: s.bottom > d.top + 1, s: Math.round(s.bottom), d: Math.round(d.top) } : null;
  });
  pruefe('T1e die Auswahl-Leiste weicht nach oben aus', !!ueber && !ueber.ueberlappt, JSON.stringify(ueber));
  await P.screenshot({ path: `${SD}/m277-board.png` });
}

console.log('\n════ T2: Formatieren wirkt ════');
{
  pruefe('T2a A−/A+/Aa aus M267 stehen in der Leiste', await P.evaluate(() => {
    const t = document.querySelector('.pn-format-dock');
    const texte = [...(t?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim());
    return texte.includes('A−') && texte.includes('A+') && texte.includes('Aa');
  }));
  // Fett über die angedockte Leiste
  await P.evaluate(() => {
    const knopf = [...document.querySelectorAll('.pn-format-dock button')]
      .find((b) => (b.getAttribute('data-test') ?? '').includes('bold') || b.querySelector('svg')?.outerHTML.includes('bold') || b.textContent === 'B');
    knopf?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await P.waitForTimeout(700);
  const fett = await P.evaluate(() => !!document.querySelector('.bn-editor p strong, .bn-editor p b'));
  pruefe('T2b Fett wirkt auf den markierten Text', fett);
}

console.log('\n════ T3: Tipp daneben blendet aus ════');
{
  await P.mouse.click(340, 200);
  await P.waitForTimeout(700);
  pruefe('T3a Tipp auf die freie Fläche schließt die Leiste',
    await P.evaluate(() => !document.querySelector('.pn-format-dock')));
}
await ctx.close();

// ══ Desktop: weiterhin schwebend ══════════════════════════════════════
console.log('\n════ T4: Desktop unverändert ════');
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx2.addInitScript(seed);
const D = await ctx2.newPage();
await D.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await D.waitForTimeout(2200);
await markiere(D);
{
  const m = await D.evaluate(() => {
    const t = document.querySelector('.bn-formatting-toolbar');
    if (!t) return null;
    const b = t.getBoundingClientRect();
    const karte = document.querySelector('.note-card')?.getBoundingClientRect();
    return { box: [Math.round(b.left), Math.round(b.top), Math.round(b.width)],
      dock: !!document.querySelector('.pn-format-dock'),
      nahDerKarte: karte ? Math.abs(b.top - karte.top) < 260 : false };
  });
  console.log('   ', JSON.stringify(m));
  pruefe('T4a die Leiste erscheint', !!m);
  pruefe('T4b am Desktop KEIN Dock — sie schwebt an der Auswahl', !!m && !m.dock && m.nahDerKarte, JSON.stringify(m));
}
await ctx2.close();

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
