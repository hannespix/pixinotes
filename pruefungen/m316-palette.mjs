/**
 * M316 — Die Modul-Palette: ＋ zeigt alle Module auf einen Blick.
 *
 *   A  Eine Palette statt Liste + „Weitere Module": fünf Gruppen, 20 Kacheln
 *      (Symbol + Name), eindeutige Namen, mittig über dem Dock, im Bild.
 *   B  Suche: „summe" lässt nur die Rechen-Tabelle übrig; Enter legt sie an;
 *      Esc leert zuerst die Suche, ein zweites Esc schließt.
 *   C  Klick auf eine Kachel legt das Modul an und schließt die Palette;
 *      „Rahmen" trägt seinen Hinweis; „Datei oder Bild" öffnet den Datei-Dialog.
 *   D  Vorlagen erscheinen als eigene Gruppe; ✕ löscht die Vorlage.
 *   E  Telefon: drei Spalten, Palette innerhalb des Schirms, kein Auto-Fokus.
 *   F  „Was ist neu" und die Hilfe nennen die Palette.
 */
// Läuft aus dem Repository: `node pruefungen/m316-palette.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4537;
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
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const note = (id, text, x) => ({ id, type: 'note', width: 240, position: { x, y: 60 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const stand = {
  boards: [{ id: 'b1', name: 'Planung', edges: [], drawings: [], comments: [], nodes: [note('n1', 'Antrag prüfen', 60)] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
  templates: [{ id: 't1', name: 'Meine Vorlage', node: { id: 'tx', type: 'note', width: 240, position: { x: 0, y: 0 }, data: { color: 'mint', blocks: [{ type: 'paragraph', content: 'Aus Vorlage' }] } } }],
};
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opt });
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const oeffne = async (P) => { await P.locator('.dock [aria-label="Objekt hinzufügen"]').click(); await P.waitForSelector('.modul-palette'); await P.waitForTimeout(250); };
const kacheln = (P) => P.locator('.modul-palette .modul-kachel:not(.modul-vorlage)');
const knoten = (P) => P.locator('.react-flow__node').count();

// ══ A: Eine Palette ═════════════════════════════════════════════════
console.log('\n════ A: Eine Palette ════');
{
  const { ctx, P } = await seite();
  await oeffne(P);
  pruefe('A1 genau eine Palette, kein „Weitere Module"', (await P.locator('.dock-menu.modul-palette').count()) === 1 && (await P.locator('.dock-menu-mehr').count()) === 0);
  const gruppen = await P.locator('.modul-palette .modul-gruppe .dock-menu-label').allTextContents();
  pruefe('A2 Gruppen: Notieren & Rechnen · Planen · Ablauf · Einfügen · Ordnen · Vorlagen', gruppen.join(' · ') === 'Notieren & Rechnen · Planen · Ablauf · Einfügen · Ordnen · Vorlagen', gruppen.join(' · '));
  const n = await kacheln(P).count();
  const namen = await kacheln(P).locator('> span:first-of-type').allTextContents();
  pruefe('A3 20 Modul-Kacheln mit eindeutigen Namen', n === 20 && new Set(namen).size === 20, `${n}: ${namen.join(', ')}`);
  const symbole = await P.evaluate(() => [...document.querySelectorAll('.modul-palette .modul-kachel')].every((b) => b.querySelector('svg') && b.textContent.trim().length > 0));
  pruefe('A4 jede Kachel hat Symbol und Namen', symbole);
  const lage = await P.evaluate(() => {
    const p = document.querySelector('.modul-palette').getBoundingClientRect(); const d = document.querySelector('.dock').getBoundingClientRect();
    return { pl: p.left, pr: p.right, pt: p.top, pb: p.bottom, pm: p.left + p.width / 2, dm: d.left + d.width / 2, dt: d.top, w: innerWidth, h: innerHeight };
  });
  pruefe('A5 mittig über dem Dock und vollständig im Bild', Math.abs(lage.pm - lage.dm) < 4 && lage.pl >= 0 && lage.pr <= lage.w && lage.pt >= 0 && lage.pb <= lage.dt, JSON.stringify(lage));
  const spalten = await P.evaluate(() => getComputedStyle(document.querySelector('.modul-raster')).gridTemplateColumns.split(' ').length);
  pruefe('A6 fünf Spalten am PC', spalten === 5, String(spalten));
  const fokus = await P.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  pruefe('A7 das Suchfeld hat den Fokus', fokus === 'Modul suchen', String(fokus));
  await P.screenshot({ path: path.join(SD, 'm316-palette.png') });
  await ctx.close();
}

// ══ B: Suche ════════════════════════════════════════════════════════
console.log('\n════ B: Suche ════');
{
  const { ctx, P } = await seite();
  await oeffne(P);
  await P.keyboard.type('excel'); await P.waitForTimeout(200);
  let namen = await kacheln(P).locator('> span:first-of-type').allTextContents();
  pruefe('B1 „excel" findet die Rechen-Tabelle (und „Datei oder Bild", weil Excel-Dateien aufs Board dürfen)', namen[0] === 'Rechen-Tabelle' && namen.length <= 2, namen.join(', '));
  await P.fill('.modul-suche input', 'summe'); await P.waitForTimeout(200);
  namen = await kacheln(P).locator('> span:first-of-type').allTextContents();
  const gruppen = await P.locator('.modul-palette .modul-gruppe .dock-menu-label').allTextContents();
  pruefe('B2 „summe" lässt nur die Rechen-Tabelle übrig, leere Gruppen verschwinden', namen.length === 1 && namen[0] === 'Rechen-Tabelle' && gruppen.length === 1 && gruppen[0] === 'Notieren & Rechnen', `${namen.join(', ')} | ${gruppen.join(' · ')}`);
  const vorher = await knoten(P);
  await P.keyboard.press('Enter'); await P.waitForTimeout(700);
  pruefe('B3 Enter legt den Treffer an und schließt die Palette', (await knoten(P)) === vorher + 1 && (await P.locator('.modul-palette').count()) === 0, `${vorher} → ${await knoten(P)}`);
  pruefe('B4 … und zwar eine Rechen-Tabelle', (await P.locator('.react-flow__node-sheet').count()) === 1);
  await oeffne(P);
  await P.keyboard.type('xyzq'); await P.waitForTimeout(200);
  pruefe('B5 ohne Treffer ein ehrlicher Satz', (await P.locator('.modul-leer').count()) === 1 && (await kacheln(P).count()) === 0);
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  pruefe('B6 Esc leert zuerst die Suche, Palette bleibt offen', (await P.locator('.modul-palette').count()) === 1 && (await P.inputValue('.modul-suche input')) === '' && (await kacheln(P).count()) === 20);
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  pruefe('B7 zweites Esc schließt', (await P.locator('.modul-palette').count()) === 0);
  await ctx.close();
}

// ══ C: Kacheln ═════════════════════════════════════════════════════
console.log('\n════ C: Kacheln ════');
{
  const { ctx, P } = await seite();
  await oeffne(P);
  const vorher = await knoten(P);
  await P.locator('.modul-kachel[data-modul="kanban"]').click(); await P.waitForTimeout(700);
  pruefe('C1 Kanban-Kachel legt ein Kanban an und schließt', (await P.locator('.react-flow__node-kanban').count()) === 1 && (await knoten(P)) === vorher + 1 && (await P.locator('.modul-palette').count()) === 0);
  await oeffne(P);
  const titel = await P.locator('.modul-kachel[data-modul="rahmen"]').getAttribute('title');
  pruefe('C2 „Rahmen" erklärt sich im Hinweis', /nicht der Bereich/.test(titel ?? ''), String(titel));
  const [chooser] = await Promise.all([
    P.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null),
    P.locator('.modul-kachel[data-modul="datei"]').click(),
  ]);
  pruefe('C3 „Datei oder Bild" öffnet den Datei-Dialog', !!chooser);
  await P.keyboard.press('Escape');
  await ctx.close();
}

// ══ D: Vorlagen ═════════════════════════════════════════════════════
console.log('\n════ D: Vorlagen ════');
{
  const { ctx, P } = await seite();
  await oeffne(P);
  const v = P.locator('.modul-palette .modul-vorlage');
  pruefe('D1 die Vorlage steht als Kachel in der Gruppe Vorlagen', (await v.count()) === 1 && (await v.textContent()).includes('Meine Vorlage'));
  const vorher = await knoten(P);
  await v.click(); await P.waitForTimeout(700);
  pruefe('D2 Klick fügt die Vorlage als Karte ein', (await knoten(P)) === vorher + 1);
  await oeffne(P);
  await P.locator('.modul-palette .modul-vorlage').hover();
  await P.locator('.modul-palette .modul-vorlage .dock-menu-template-x').click(); await P.waitForTimeout(300);
  pruefe('D3 ✕ löscht die Vorlage, Gruppe verschwindet', (await P.locator('.modul-palette .modul-vorlage').count()) === 0 && !(await P.locator('.modul-palette .dock-menu-label').allTextContents()).includes('Vorlagen'));
  await ctx.close();
}

// ══ E: Telefon ══════════════════════════════════════════════════════
console.log('\n════ E: Telefon ════');
{
  const { ctx, P } = await seite({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await P.locator('.dock [aria-label="Objekt hinzufügen"]').tap(); await P.waitForSelector('.modul-palette'); await P.waitForTimeout(300);
  const lage = await P.evaluate(() => { const p = document.querySelector('.modul-palette').getBoundingClientRect(); return { l: p.left, r: p.right, t: p.top, w: innerWidth, spalten: getComputedStyle(document.querySelector('.modul-raster')).gridTemplateColumns.split(' ').length, fokus: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName }; });
  pruefe('E1 Palette innerhalb des Schirms, drei Spalten', lage.l >= 0 && lage.r <= lage.w && lage.t >= 0 && lage.spalten === 3, JSON.stringify(lage));
  pruefe('E2 kein Auto-Fokus am Finger (Tastatur bleibt unten)', lage.fokus !== 'Modul suchen', String(lage.fokus));
  await P.screenshot({ path: path.join(SD, 'm316-telefon.png') });
  await ctx.close();
}

// ══ F: Texte ════════════════════════════════════════════════════════
console.log('\n════ F: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('F1 „Was ist neu" nennt M316', js.includes('Die Modul-Palette (M316)'));
  pruefe('F2 die Hilfe erklärt die Palette statt „Weitere Module"', js.includes('öffnet die Modul-Palette') && !js.includes('„Weitere Module" öffnet den Rest'));
}

await browser.close(); app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
