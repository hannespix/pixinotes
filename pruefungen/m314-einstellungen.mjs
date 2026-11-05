/**
 * M314 — Weniger ist mehr, Etappe 3: die Einstellungen.
 *
 *   A  Drei Reiter: Darstellung · Daten · Dienste; Darstellung ist beim Öffnen aktiv.
 *   B  Darstellung: genau sechs Zeilen (Erscheinungsbild, Akzentfarbe, Anzeigegröße,
 *      Besser lesbar, Mausrad zoomt, Lebendige Fläche); keine Zeilen mehr für
 *      Milchglas, Navigation links, Karte im Fokus, Stift, Physik, Klick-Zoom, Konfetti.
 *      „Besser lesbar" setzt Schrift UND Kontrast; „Lebendige Fläche" drei Werte.
 *   C  Daten: Sichern & Laden · Synchronisation · Team-Sync · Markdown · OneNote ·
 *      Alles leeren — keine Dateien-Obergrenze, keine Starter-Umgebung.
 *   D  Dienste: Gehirn zeigt einen Schalter; Bereiche/Anbieter liegen unter „Erweitert".
 *   E  Ein Direktsprung „sync" (Status-Chip) landet im Reiter Daten.
 *   F  Automatik: Milchglas ist an, obwohl keine Option mehr existiert; eine alte
 *      Vorliebe „Spalte aus / Stift schiebt" wird einmalig angeglichen.
 *   G  „Was ist neu" nennt M314.
 */
// Läuft aus dem Repository: `node pruefungen/m314-einstellungen.mjs`
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
const PORT = 4535;
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

const note = (id, text) => ({ id, type: 'note', width: 240, position: { x: 60, y: 60 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const stand = {
  boards: [{ id: 'b1', name: 'Planung', edges: [], drawings: [], comments: [], nodes: [note('n1', 'Antrag prüfen')] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
async function seite(vorlieben = null) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ st, v }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    if (v) localStorage.setItem('pixinotes-einstellungen', JSON.stringify(v));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, v: vorlieben });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const oeffne = async (P) => { await P.locator('[data-taste="einstellungen"]').click(); await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300); };
const reiter = async (P, name) => { await P.locator('.modal-tabs button', { hasText: name }).click(); await P.waitForTimeout(300); };
const h3s = (P) => P.locator('.modal-body h3').allTextContents().then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim()));
const zeilen = (P) => P.evaluate(() => [...document.querySelectorAll('.modal-body .modal-row > span:first-child, .modal-body .modal-row-check > span:first-child')].map((e) => e.textContent.trim()));
const vorlieben = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen') ?? '{}'));

// ══ A/B: Reiter und Darstellung ══════════════════════════════════════
console.log('\n════ A: Reiter ════');
{
  const { ctx, P } = await seite();
  await oeffne(P);
  const tabs = await P.locator('.modal-tabs button').allTextContents();
  pruefe('A1 drei Reiter: Darstellung · Daten · Dienste', JSON.stringify(tabs) === JSON.stringify(['Darstellung', 'Daten', 'Dienste']), tabs.join(' | '));
  pruefe('A2 Darstellung ist beim Öffnen aktiv', (await P.locator('.modal-tabs button.on').textContent()) === 'Darstellung');

  console.log('\n════ B: Darstellung ════');
  const g = await h3s(P);
  pruefe('B1 drei Gruppen: Aussehen, Lesbarkeit, Bedienung', JSON.stringify(g) === JSON.stringify(['Aussehen', 'Lesbarkeit', 'Bedienung']), g.join(' | '));
  const z = await zeilen(P);
  pruefe('B2 genau sechs Zeilen', JSON.stringify(z) === JSON.stringify(['Erscheinungsbild', 'Akzentfarbe', 'Anzeigegröße', 'Besser lesbar', 'Mausrad zoomt', 'Lebendige Fläche']), JSON.stringify(z));
  pruefe('B3 keine Zeilen mehr für Milchglas, Navigation, Fokus, Stift, Physik, Klick-Zoom, Konfetti', !z.some((t) => /Milchglas|Navigation|Fokus|Stift|Physik|Klick|Konfetti|Kontrast|lesbare Schrift/.test(t)));
  const check = (text) => P.locator('.modal-row-check', { hasText: text }).locator('input[type="checkbox"]');
  await check('Besser lesbar').check();
  await P.waitForTimeout(600);
  let v = await vorlieben(P);
  pruefe('B4 „Besser lesbar" setzt klare Schrift UND Kontrast', v.lesbareSchrift === true && v.hoherKontrast === true, JSON.stringify({ s: v.lesbareSchrift, k: v.hoherKontrast }));
  pruefe('B5 … und die App trägt beides', (await P.evaluate(() => [document.documentElement.dataset.lesbar, document.documentElement.dataset.kontrast].join('/'))) === 'an/hoch');
  await check('Besser lesbar').uncheck();
  await check('Lebendige Fläche').check();
  await P.waitForTimeout(600);
  v = await vorlieben(P);
  pruefe('B6 „Lebendige Fläche" setzt Physik, Klick-Zoom und Konfetti', v.physicsEnabled === true && v.clickZoom === true && v.konfetti === true, JSON.stringify({ p: v.physicsEnabled, k: v.clickZoom, c: v.konfetti }));
  await check('Lebendige Fläche').uncheck();
  await P.waitForTimeout(400);
  pruefe('B7 kein Erklärtext hat mehr als zwei Sätze', (await P.evaluate(() => [...document.querySelectorAll('.modal-body .modal-hint')].map((e) => e.textContent.trim()).filter((t) => (t.match(/[.!?](\s|$)/g) ?? []).length > 2).length)) === 0);
  await P.locator('.modal').screenshot({ path: `${SD}/m314-b-darstellung.png` });

  console.log('\n════ C: Daten ════');
  await reiter(P, 'Daten');
  const d = await h3s(P);
  pruefe('C1 Reihenfolge: Sichern & Laden · Synchronisation · Team-Sync · Markdown · OneNote · Alles leeren',
    d.length === 6 && /^Sichern & Laden/.test(d[0]) && /^Synchronisation/.test(d[1]) && /^Team-Sync/.test(d[2]) && /Markdown/.test(d[3]) && /OneNote/.test(d[4]) && /Alles leeren/.test(d[5]), d.join(' | '));
  pruefe('C2 keine Dateien-Obergrenze und keine Starter-Umgebung mehr', !d.some((t) => /Dateien mitsynchronisieren|Starter/.test(t)) && (await P.locator('.seg-obergrenze').count()) === 0);
  pruefe('C3 der Weg-Umschalter (Ordner · WebDAV) steht im Reiter Daten', (await P.locator('.seg-weg button').count()) >= 2);
  await P.locator('.modal').screenshot({ path: `${SD}/m314-c-daten.png` });

  console.log('\n════ D: Dienste ════');
  await reiter(P, 'Dienste');
  const s = await h3s(P);
  pruefe('D1 Dienste: KI-Assistent · Gehirn · Konten', s.length === 3 && /KI/.test(s[0]) && /Gehirn/.test(s[1]) && /Konten/.test(s[2]), s.join(' | '));
  await P.locator('.modal-row-check', { hasText: 'Gehirn einschalten' }).locator('input').check();
  await P.waitForTimeout(500);
  pruefe('D2 eingeschaltet zeigt das Gehirn „Erweitert" eingeklappt', (await P.locator('.modal-details summary').count()) === 1 && !(await P.locator('.modal-details').evaluate((d) => d.open)));
  pruefe('D3 … Bereiche und Anbieter liegen darin', (await P.locator('.modal-details .brain-scope').count()) === 1 && (await P.locator('.modal-details select').count()) >= 1);
  await P.locator('.modal-row-check', { hasText: 'Gehirn einschalten' }).locator('input').uncheck();
  await P.keyboard.press('Escape');
  await P.waitForTimeout(300);

  console.log('\n════ E: Direktsprung ════');
  await P.evaluate(() => { window.dispatchEvent(new CustomEvent('pixinotes:sync-status', { detail: { source: 'ordner', state: 'conflict' } })); });
  await P.waitForTimeout(400);
  const wolke = P.locator('.sync-status');
  if (await wolke.count()) {
    await wolke.click();
    await P.waitForTimeout(500);
    pruefe('E1 der Status-Chip öffnet den Reiter Daten (statt des alten Reiters Synchronisation)', (await P.locator('.modal-tabs button.on').textContent()) === 'Daten');
    await P.keyboard.press('Escape');
  } else {
    pruefe('E1 der Status-Chip öffnet den Reiter Daten', false, 'kein Status-Chip sichtbar');
  }
  await ctx.close();
}

// ══ F: Automatik ══════════════════════════════════════════════════════
console.log('\n════ F: Automatik statt Option ════');
{
  // Alte Vorlieben: Milchglas aus, Spalte aus, Stift schiebt, Fokus formatfüllend
  const { ctx, P } = await seite({ milchglas: false, navLinks: false, stiftZeichnet: false, fokusVollbild: true, schliff: 1 });
  const glas = await P.evaluate(() => document.documentElement.dataset.glas);
  pruefe('F1 Milchglas ist an, obwohl die alte Vorliebe „aus" sagte', glas === 'an', String(glas));
  pruefe('F2 die eingeklappte Spalte bleibt eingeklappt (‹ und Anheften regeln das weiter)', (await P.locator('.tabs.spalte').count()) === 0 && (await P.locator('.tab-nav').count()) === 1);
  const v = await vorlieben(P);
  pruefe('F3 die Vorlieben sind einmalig angeglichen (Stift zeichnet, Blatt statt formatfüllend, Marke 2)', v.stiftZeichnet === true && v.fokusVollbild === false && v.navLinks === false && v.schliff === 2, JSON.stringify(v));
  await ctx.close();
}

// ══ G: Changelog ══════════════════════════════════════════════════════
console.log('\n════ G: Was ist neu ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G1 „Was ist neu" nennt M314', js.includes('Etappe 3 — die Einstellungen (M314)'));
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
