/**
 * M274 — „bitte KI Recherche deutlich mächtiger machen … gerne auch mit
 * einem Rückfragen Dialog."
 *
 * Alle Netzwege werden ABGEFANGEN und mit Markern bestückt. Der Nachweis:
 *  · Der Dialog stellt die Rückfragen der KI und lässt sie überspringen.
 *  · Wikipedia, Wikivoyage und Open-Meteo werden wirklich abgefragt.
 *  · Der finale Prompt enthält Quellen-MARKER, Wetterzeilen und die
 *    Antwort aus dem Rückfragen-Dialog — die KI arbeitet mit Material.
 *  · Auf dem Board entsteht eine Notiz mit Quellenliste.
 */
// Läuft aus dem Repository: `node pruefungen/m274-recherche.mjs`
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
const PORT = 4495;
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
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addInitScript(() => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes: [], comments: [] }],
    spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: false,
    ai: { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } } }));
});
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));

// ---------- Netz-Attrappen ----------
const abrufe = { wikiSuche: 0, wikiAuszug: 0, voyage: 0, geo: 0, wetter: 0 };
const kiPrompts = [];

await P.route('https://de.wikipedia.org/**', async (route) => {
  const url = route.request().url();
  if (url.includes('list=search')) {
    abrufe.wikiSuche += 1;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ query: { search: [{ title: 'Kaiserstuhl (Baden)' }] } }) });
  } else {
    abrufe.wikiAuszug += 1;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ query: { pages: { 1: { title: 'Kaiserstuhl (Baden)',
        extract: 'Der Kaiserstuhl ist ein VULKANGEBIRGE-MARKER im Oberrheingraben mit besonders warmem Klima und Weinbau. '.repeat(3) } } } }) });
  }
});
await P.route('https://de.wikivoyage.org/**', async (route) => {
  const url = route.request().url();
  abrufe.voyage += 1;
  if (url.includes('list=search')) {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ query: { search: [{ title: 'Kaiserstuhl' }] } }) });
  } else {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ query: { pages: { 2: { title: 'Kaiserstuhl',
        extract: 'WIKIVOYAGE-MARKER: Sehenswert sind der Badberg, die Winzergenossenschaften und der Baumkronenpfad. '.repeat(3) } } } }) });
  }
});
await P.route('https://geocoding-api.open-meteo.com/**', async (route) => {
  abrufe.geo += 1;
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ results: [{ name: 'Ihringen', latitude: 48.04, longitude: 7.65, admin1: 'Baden-Württemberg' }] }) });
});
await P.route('https://api.open-meteo.com/**', async (route) => {
  abrufe.wetter += 1;
  const tage = Array.from({ length: 7 }, (_, i) => `2026-08-${String(17 + i).padStart(2, '0')}`);
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ daily: {
      time: tage, weather_code: [0, 1, 2, 61, 3, 0, 95],
      temperature_2m_max: [31, 29, 27, 22, 24, 28, 26], temperature_2m_min: [18, 17, 16, 14, 15, 16, 17],
      precipitation_probability_max: [5, 10, 20, 80, 30, 5, 60] } }) });
});
await P.route('https://api.openai.com/**', async (route) => {
  const body = route.request().postData() ?? '';
  kiPrompts.push(body);
  const antwort = kiPrompts.length === 1
    ? JSON.stringify({ suchbegriffe: ['Kaiserstuhl', 'Ihringen'], reise: true, wetterOrt: 'Ihringen',
        fragen: ['Seid ihr mit Kindern unterwegs?', 'Wie weit darf die Anfahrt sein?'] })
    : '## Ausflugsziele\n- Der Kaiserstuhl mit dem Badberg [1]\n- Baumkronenpfad [2]\n\n## Wetter\n- Donnerstag Regen [3], sonst freundlich\n\n## Offen geblieben\n- Öffnungszeiten und Preise nennen die Quellen nicht.';
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: antwort } }] }) });
});

await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2000);

// ══ T1: Der Weg zum Dialog ═══════════════════════════════════════════
console.log('════ T1: Einstieg über das KI-Menü ════');
await P.locator('button[aria-label="Mehr: KI-Assistent · Aufräumen & Anordnen · Physik · Archiv"], button[title^="Mehr:"]').first().click();
await P.waitForTimeout(500);
await P.locator('button[aria-label="KI-Assistent"]').click();
await P.waitForTimeout(500);
const eintrag = await P.evaluate(() => {
  const b = [...document.querySelectorAll('.dock-menu-ai button')].find((x) => x.textContent.includes('Recherche mit Quellen'));
  if (!b) return false;
  b.click();
  return true;
});
pruefe('T1a das KI-Menü hat „Recherche mit Quellen …"', eintrag);
await P.waitForTimeout(600);
pruefe('T1b der Dialog öffnet sich', await P.evaluate(() => !!document.querySelector('.recherche-modal')));

// ══ T2: Auftrag → Rückfragen ═════════════════════════════════════════
console.log('\n════ T2: Rückfragen-Dialog ════');
await P.locator('.recherche-auftrag').fill('Ausflugsziele rund um Ihringen am Kaiserstuhl, mit Wetter');
await P.locator('.recherche-modal button', { hasText: 'Recherche starten' }).click();
await P.waitForTimeout(2500);
const fragen = await P.evaluate(() =>
  [...document.querySelectorAll('.recherche-frage span')].map((s) => s.textContent));
console.log('    Rückfragen:', JSON.stringify(fragen));
pruefe('T2a die Rückfragen der KI erscheinen im Dialog',
  fragen.length === 2 && fragen[0].includes('Kindern'), JSON.stringify(fragen));
pruefe('T2b es gibt beide Wege: mit Antworten und ohne', await P.evaluate(() =>
  !!document.querySelector('.recherche-modal button') &&
  [...document.querySelectorAll('.recherche-modal button')].some((b) => b.textContent.includes('Ohne Antworten'))));

// Eine Frage beantworten, die andere leer lassen
await P.locator('.recherche-frage input').first().fill('Ja, zwei Kinder (4 und 7)');
await P.locator('.recherche-modal button', { hasText: 'Mit diesen Antworten' }).click();

// ══ T3: Quellen-Abrufe + finaler Prompt ══════════════════════════════
console.log('\n════ T3: Es wird wirklich recherchiert ════');
for (let i = 0; i < 40 && kiPrompts.length < 2; i++) await P.waitForTimeout(400);
await P.waitForTimeout(800);
console.log('    Abrufe:', JSON.stringify(abrufe));
pruefe('T3a Wikipedia wurde durchsucht (Suche + Auszüge)', abrufe.wikiSuche >= 2 && abrufe.wikiAuszug >= 1, JSON.stringify(abrufe));
pruefe('T3b Wikivoyage wurde abgefragt (Reise-Thema)', abrufe.voyage >= 2, String(abrufe.voyage));
pruefe('T3c das Wetter für Ihringen wurde geholt (Geocoding + Vorhersage)', abrufe.geo === 1 && abrufe.wetter === 1, JSON.stringify(abrufe));
pruefe('T3d es gab genau zwei KI-Aufrufe (Plan + Antwort)', kiPrompts.length === 2, String(kiPrompts.length));

const finale = kiPrompts[1] ?? '';
pruefe('T3e der Wikipedia-Auszug steckt im finalen Prompt', finale.includes('VULKANGEBIRGE-MARKER'));
pruefe('T3f der Wikivoyage-Auszug ebenfalls', finale.includes('WIKIVOYAGE-MARKER'));
pruefe('T3g die Wetterzeilen sind drin (mit Regenrisiko)', finale.includes('Regenrisiko 80'), '');
pruefe('T3h die Dialog-Antwort steht als Präzisierung drin', finale.includes('zwei Kinder (4 und 7)'));
pruefe('T3i die unbeantwortete Frage wird NICHT als leere Antwort mitgeschickt',
  !finale.includes('Anfahrt sein?\\nAntwort:'), '');
pruefe('T3j die Ehrlichkeits-Regel steht im Prompt', finale.includes('NICHTS erfinden'));

// ══ T4: Ergebnis-Notiz mit Quellen ═══════════════════════════════════
console.log('\n════ T4: Die Ergebnis-Notiz ════');
await P.waitForTimeout(1500);
const notiz = await P.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
  const n = s.boards[0].nodes.find((x) => x.type === 'note');
  if (!n) return null;
  const text = JSON.stringify(n.data.blocks);
  return {
    dialogZu: !document.querySelector('.recherche-modal'),
    titelDrin: text.includes('🔎'),
    inhalt: text.includes('Kaiserstuhl'),
    quellenListe: text.includes('Quellen') && text.includes('wikipedia.org'),
    luecke: text.includes('Öffnungszeiten'),
  };
});
console.log('   ', JSON.stringify(notiz));
pruefe('T4a die Notiz liegt auf dem Board und der Dialog ist zu', !!notiz && notiz.dialogZu);
pruefe('T4b sie trägt den Recherche-Titel', notiz?.titelDrin === true);
pruefe('T4c der Inhalt kommt aus den Quellen', notiz?.inhalt === true);
pruefe('T4d die Quellenliste mit Links steht am Ende', notiz?.quellenListe === true);
pruefe('T4e die Lücken stehen ehrlich drin', notiz?.luecke === true);
await P.screenshot({ path: `${SD}/m274-ergebnis.png` });

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
