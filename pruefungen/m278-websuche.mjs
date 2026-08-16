/**
 * M278 — Recherche über die Websuche des KI-Anbieters.
 *
 * Mit eigenem Anthropic-Schlüssel sucht das Modell SELBST im Netz
 * (serverseitiges web_search-Tool) statt nur die Nachschlagewerke aus M274
 * zu lesen. Alle Netzwege sind abgefangen; geprüft wird:
 *  · Anthropic-Anfrage trägt das web_search-Werkzeug
 *  · die Zitate der Antwort werden zur Quellenliste der Notiz
 *  · Wikipedia/Wikivoyage werden auf diesem Weg NICHT mehr gebraucht
 *  · scheitert die Websuche, greift lückenlos der M274-Weg
 *  · andere Anbieter (hier OpenAI) bleiben beim M274-Weg
 *  · der Dialog sagt vorher ehrlich, welcher Weg gilt
 */
// Läuft aus dem Repository: `node pruefungen/m278-websuche.mjs`
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
const PORT = 4497;
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

/** Board mit gewähltem KI-Anbieter aufsetzen */
const seed = (ai) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes: [], comments: [] }],
    spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: false, ai } }));
};

/** Nachschlagewerke immer bedienen — so lässt sich zählen, WER gebraucht wird */
async function lexikaAttrappe(P, zaehler) {
  await P.route('https://de.wikipedia.org/**', async (route) => {
    zaehler.wiki += 1;
    const url = route.request().url();
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: url.includes('list=search')
        ? JSON.stringify({ query: { search: [{ title: 'Kaiserstuhl (Baden)' }] } })
        : JSON.stringify({ query: { pages: { 1: { title: 'Kaiserstuhl (Baden)',
          extract: 'LEXIKON-MARKER: Der Kaiserstuhl ist ein Vulkangebirge im Oberrheingraben. '.repeat(3) } } } }) });
  });
  await P.route('https://de.wikivoyage.org/**', async (route) => {
    zaehler.voyage += 1;
    const url = route.request().url();
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: url.includes('list=search')
        ? JSON.stringify({ query: { search: [{ title: 'Kaiserstuhl' }] } })
        : JSON.stringify({ query: { pages: { 2: { title: 'Kaiserstuhl',
          extract: 'VOYAGE-MARKER: Sehenswert ist der Badberg. '.repeat(3) } } } }) });
  });
  await P.route('https://geocoding-api.open-meteo.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) }));
}

/** Den Recherche-Dialog öffnen (Dock → KI → Recherche) */
async function oeffneDialog(P) {
  await P.locator('button[title^="Mehr:"]').first().click();
  await P.waitForTimeout(500);
  await P.locator('button[aria-label="KI-Assistent"]').click();
  await P.waitForTimeout(500);
  await P.evaluate(() => {
    [...document.querySelectorAll('.dock-menu-ai button')]
      .find((x) => x.textContent.includes('Recherche mit Quellen'))?.click();
  });
  await P.waitForTimeout(600);
}

// ══ T1: Anthropic — das Modell sucht selbst ══════════════════════════
console.log('════ T1: Anthropic sucht selbst im Netz ════');
const ctx1 = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx1.addInitScript(seed, { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test', baseUrl: '' });
const P = await ctx1.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
const zaehler1 = { wiki: 0, voyage: 0 };
await lexikaAttrappe(P, zaehler1);
const anfragen = [];
await P.route('https://api.anthropic.com/**', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  anfragen.push(body);
  // 1. Aufruf = Planung (JSON), 2. Aufruf = die eigentliche Recherche
  if (anfragen.length === 1) {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
        suchbegriffe: ['Kaiserstuhl'], reise: true, wetterOrt: null, fragen: [] }) }] }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    content: [
      { type: 'server_tool_use', name: 'web_search', input: { query: 'Kaiserstuhl Ausflug' } },
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.org/a', title: 'Ausflugsziele' }] },
      { type: 'text',
        text: '## Ausflugsziele\n- WEBSUCHE-MARKER: Badberg und Winzerkeller sind aktuell geöffnet.\n',
        citations: [
          { type: 'web_search_result_location', url: 'https://example.org/a', title: 'Ausflugsziele am Kaiserstuhl' },
          { type: 'web_search_result_location', url: 'https://example.org/b', title: 'Öffnungszeiten Badberg' },
          { type: 'web_search_result_location', url: 'https://example.org/a', title: 'Ausflugsziele am Kaiserstuhl' },
        ] },
    ] }) });
});
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2000);
{
  await oeffneDialog(P);
  pruefe('T1a der Dialog kündigt die eigene Netzrecherche an', await P.evaluate(() => {
    const t = document.querySelector('.recherche-modal .modal-hint')?.textContent ?? '';
    return t.includes('selbst im Netz') && !t.includes('Wikivoyage');
  }), await P.evaluate(() => document.querySelector('.recherche-modal .modal-hint')?.textContent?.slice(0, 90)));
  await P.locator('.recherche-auftrag').fill('Ausflugsziele rund um den Kaiserstuhl, was hat gerade offen?');
  await P.locator('.recherche-modal button', { hasText: 'Recherche starten' }).click();
  for (let i = 0; i < 50 && anfragen.length < 2; i++) await P.waitForTimeout(400);
  await P.waitForTimeout(2000);

  const recherche = anfragen[1] ?? {};
  pruefe('T1b es gab zwei Anthropic-Aufrufe (Plan + Recherche)', anfragen.length === 2, String(anfragen.length));
  pruefe('T1c die Planung läuft OHNE Websuche (spart Kontingent)', !anfragen[0]?.tools, JSON.stringify(anfragen[0]?.tools ?? null));
  pruefe('T1d die Recherche-Anfrage trägt das web_search-Werkzeug',
    recherche.tools?.[0]?.type === 'web_search_20250305' && recherche.tools?.[0]?.name === 'web_search',
    JSON.stringify(recherche.tools ?? null));
  pruefe('T1e die Zahl der Suchen ist gedeckelt', typeof recherche.tools?.[0]?.max_uses === 'number',
    String(recherche.tools?.[0]?.max_uses));
  pruefe('T1f die Ehrlichkeits-Regel steht auch hier im Auftrag',
    JSON.stringify(recherche.messages ?? '').includes('NICHTS erfinden'));
  console.log('    Lexika-Abrufe:', JSON.stringify(zaehler1));
  pruefe('T1g Wikipedia/Wikivoyage werden auf diesem Weg nicht gebraucht',
    zaehler1.wiki === 0 && zaehler1.voyage === 0, JSON.stringify(zaehler1));

  const notiz = await P.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
    const n = s.boards[0].nodes.find((x) => x.type === 'note');
    if (!n) return null;
    const text = JSON.stringify(n.data.blocks);
    return { text: text.includes('WEBSUCHE-MARKER'), quelleA: text.includes('example.org/a'),
      quelleB: text.includes('example.org/b'),
      doppelt: (text.match(/example\.org\/a/g) ?? []).length,
      titel: text.includes('🔎'), zu: !document.querySelector('.recherche-modal') };
  });
  console.log('   ', JSON.stringify(notiz));
  pruefe('T1h die Notiz entsteht mit dem Text aus der Websuche', notiz?.text === true);
  pruefe('T1i die zitierten Seiten stehen als Quellen darunter',
    notiz?.quelleA === true && notiz?.quelleB === true, JSON.stringify(notiz));
  pruefe('T1j doppelt zitierte Seiten stehen nur EINMAL in der Liste', notiz?.doppelt === 1, String(notiz?.doppelt));
  pruefe('T1k der Dialog schließt sich nach getaner Arbeit', notiz?.zu === true);
  await P.screenshot({ path: `${SD}/m278-websuche.png` });
}
await ctx1.close();

// ══ T2: Websuche fällt aus → Nachschlagewerke ════════════════════════
console.log('\n════ T2: Rückfall auf die Nachschlagewerke ════');
const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx2.addInitScript(seed, { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test', baseUrl: '' });
const Q = await ctx2.newPage();
Q.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
const zaehler2 = { wiki: 0, voyage: 0 };
await lexikaAttrappe(Q, zaehler2);
const anfragen2 = [];
await Q.route('https://api.anthropic.com/**', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  anfragen2.push(body);
  if (anfragen2.length === 1) {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
        suchbegriffe: ['Kaiserstuhl'], reise: true, wetterOrt: null, fragen: [] }) }] }) });
    return;
  }
  // Die Websuche scheitert (z. B. kein Kontingent) …
  if (body.tools) { await route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"no web search"}' }); return; }
  // … die normale Antwort aus dem Lexikon-Material gelingt
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: '## Ergebnis\n- RUECKFALL-MARKER aus dem Lexikon [1]' }] }) });
});
await Q.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await Q.waitForTimeout(2000);
{
  await oeffneDialog(Q);
  await Q.locator('.recherche-auftrag').fill('Ausflugsziele rund um den Kaiserstuhl');
  await Q.locator('.recherche-modal button', { hasText: 'Recherche starten' }).click();
  for (let i = 0; i < 60 && zaehler2.wiki === 0; i++) await Q.waitForTimeout(400);
  await Q.waitForTimeout(2500);
  console.log('    Lexika-Abrufe:', JSON.stringify(zaehler2), 'Anfragen:', anfragen2.length);
  pruefe('T2a nach dem Fehlschlag werden die Nachschlagewerke gelesen', zaehler2.wiki > 0, JSON.stringify(zaehler2));
  const notiz = await Q.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
    const n = s.boards[0].nodes.find((x) => x.type === 'note');
    const text = n ? JSON.stringify(n.data.blocks) : '';
    return { da: !!n, rueck: text.includes('RUECKFALL-MARKER'), quellen: text.includes('wikipedia.org') };
  });
  console.log('   ', JSON.stringify(notiz));
  pruefe('T2b die Recherche liefert trotzdem eine Notiz', notiz.da && notiz.rueck, JSON.stringify(notiz));
  pruefe('T2c mit der Quellenliste des M274-Wegs', notiz.quellen === true);
}
await ctx2.close();

// ══ T3: Andere Anbieter bleiben beim M274-Weg ════════════════════════
console.log('\n════ T3: Anderer Anbieter, alter Weg ════');
const ctx3 = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx3.addInitScript(seed, { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' });
const R = await ctx3.newPage();
R.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
const zaehler3 = { wiki: 0, voyage: 0 };
await lexikaAttrappe(R, zaehler3);
const anfragen3 = [];
await R.route('https://api.openai.com/**', async (route) => {
  anfragen3.push(route.request().postData() ?? '');
  const antwort = anfragen3.length === 1
    ? JSON.stringify({ suchbegriffe: ['Kaiserstuhl'], reise: true, wetterOrt: null, fragen: [] })
    : '## Ergebnis\n- OPENAI-MARKER aus dem Lexikon [1]';
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: antwort } }] }) });
});
let anthropicBeruehrt = 0;
await R.route('https://api.anthropic.com/**', async (route) => { anthropicBeruehrt += 1; await route.abort(); });
await R.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await R.waitForTimeout(2000);
{
  await oeffneDialog(R);
  pruefe('T3a der Dialog nennt hier weiter die Nachschlagewerke', await R.evaluate(() => {
    const t = document.querySelector('.recherche-modal .modal-hint')?.textContent ?? '';
    return t.includes('Wikivoyage') && !t.includes('selbst im Netz');
  }));
  await R.locator('.recherche-auftrag').fill('Ausflugsziele rund um den Kaiserstuhl');
  await R.locator('.recherche-modal button', { hasText: 'Recherche starten' }).click();
  for (let i = 0; i < 60 && anfragen3.length < 2; i++) await R.waitForTimeout(400);
  await R.waitForTimeout(2000);
  console.log('    Lexika-Abrufe:', JSON.stringify(zaehler3));
  pruefe('T3b die Nachschlagewerke werden gelesen', zaehler3.wiki > 0 && zaehler3.voyage > 0, JSON.stringify(zaehler3));
  pruefe('T3c kein Anthropic-Aufruf mit fremdem Anbieter', anthropicBeruehrt === 0, String(anthropicBeruehrt));
  pruefe('T3d die Notiz entsteht wie gehabt', await R.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
    const n = s.boards[0].nodes.find((x) => x.type === 'note');
    return !!n && JSON.stringify(n.data.blocks).includes('OPENAI-MARKER');
  }));
}
await ctx3.close();

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
