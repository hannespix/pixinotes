/**
 * M332 — Markdown-Import als Notiz & KI-Stapelaufgaben in Portionen.
 *
 *   A  .md-Import: formatierte Notiz (Überschrift, Liste, Checkliste), keine Datei-Karte.
 *   B  „Als Notiz übernehmen": zwei md-Datei-Karten → zwei Notizen an derselben Stelle, Datei weg.
 *   C  Freitext über 8 große Dateien: Portionen (≥ 3 Aufrufe), Fortschritts-Toast „Teil x von y",
 *      8 Notizen, Meldung nennt Teile.
 *   D  Ein Teil scheitert (HTTP 500): übrige Teile laufen durch, Meldung mit ⚠️ und „Nicht geschafft".
 *   E  Antwort abgeschnitten (finish_reason=length) bei 2 Karten: Portion wird halbiert, am Ende alle 8.
 *   F  Abbrechen über den Toast: Aktion endet vorzeitig, Meldung „Abgebrochen", nicht alle Notizen.
 *   G  „Texte verbessern (2)": zwei Vorschläge statt einem.
 *   H  Board-Aktion mit zu viel Inhalt: Hinweis „passten nicht mehr in den Kontext".
 */
// Läuft aus dem Repository: `node pruefungen/m332-md-ki.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4553;
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

/* ---------- Testdaten ---------- */
const mdPfad = `${SD}/m332-plan.md`;
writeFileSync(mdPfad, '# Projektplan Q1\n\nEin kurzer **Einstieg**.\n\n## Schritte\n\n- Kickoff\n- Entwurf\n\n- [ ] Budget freigeben\n- [x] Team benennen\n');

/** Große Markdown-Datei (~5.200 Zeichen) als data:-URL — 8 davon sprengen den 30k-Kontext */
const grossesMd = (i) => {
  const zeilen = [`# Kapitel ${i}`, '', `Marker KAP${i}.`];
  for (let z = 0; z < 60; z++) zeilen.push(`- Punkt ${z} in Kapitel ${i}: Lorem ipsum dolor sit amet, consetetur sadipscing elitr.`);
  return zeilen.join('\n');
};
const dataUrl = (text) => `data:text/markdown;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
const dateiKarten = (n, groesse = grossesMd) => Array.from({ length: n }, (_, i) => ({
  id: `f${i + 1}`, type: 'file', position: { x: 40 + (i % 4) * 300, y: 40 + Math.floor(i / 4) * 220 }, width: 240,
  data: { name: `kapitel-${i + 1}.md`, mime: 'text/markdown', size: groesse(i + 1).length, dataUrl: dataUrl(groesse(i + 1)) },
}));

/**
 * Mock des KI-Servers (OpenAI-Format). Aus dem Prompt wird die Kartenliste
 * gelesen; je Karte kommt eine note-Operation zurück. `plan(nr, items)` darf
 * je Aufruf eingreifen (Fehler, Abschneiden, Verzögerung).
 */
async function seite({ nodes = [], plan = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((nodes) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false, schliff: 2 }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: false,
      ai: { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } } }));
  }, nodes);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  const aufrufe = [];
  await P.route('https://api.openai.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const prompt = typeof body.messages?.[0]?.content === 'string' ? body.messages[0].content : (body.messages?.[0]?.content ?? []).map((t) => t.text ?? '').join('\n');
    const m = /Vorhandene Karten \(id, type, text\):\n(\[.*?\])\n\n(?:Dies ist Teil [^\n]*\n\n)?Antworte NUR/s.exec(prompt);
    const items = m ? JSON.parse(m[1]) : [];
    const nr = aufrufe.length + 1;
    aufrufe.push({ nr, items: items.map((i) => i.id), teil: /Dies ist Teil (\d+) von (\d+)/.exec(prompt)?.slice(1, 3) ?? null, maxTokens: body.max_tokens });
    const eingriff = plan ? await plan(nr, items, prompt) : null;
    if (eingriff?.status) { await route.fulfill({ status: eingriff.status, contentType: 'application/json', body: '{"error":"kaputt"}' }); return; }
    const ops = eingriff?.ops ?? items.map((it) => ({ op: 'note', title: `Notiz zu ${it.id}`, text: `## Inhalt ${it.id}\n- [ ] Punkt A\n- Punkt B`, from: it.id }));
    const antwort = eingriff?.text ?? JSON.stringify({ summary: `Teil erledigt (${items.length})`, ops });
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: antwort }, finish_reason: eingriff?.finish ?? 'stop' }] }) });
  });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, aufrufe };
}

const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const toastText = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');

/** Freitext-Anweisung übers Dock (ganzes Board) absenden */
async function dockAnweisung(P, wunsch) {
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click());
  await P.waitForTimeout(300);
  await P.locator('.dock-menu-ai textarea.ai-cmd-input').fill(wunsch);
  await P.locator('.dock-menu-ai .ai-cmd-go').click();
}

/** Toast beobachten, bis die Endmeldung kommt; sammelt alle Zwischenstände */
async function wartenBisFertig(P, maxMs = 60000, { beiText = null } = {}) {
  const gesehen = [];
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const t = await toastText(P);
    if (t && gesehen[gesehen.length - 1] !== t) gesehen.push(t);
    if (beiText && t.includes(beiText.text) && !beiText.erledigt) { beiText.erledigt = true; await beiText.tue(); }
    const busy = await P.evaluate(() => document.querySelector('.dock button.active[aria-label="Mehr"]') !== null);
    if (!busy && gesehen.length && Date.now() - start > 1500) break;
    await P.waitForTimeout(150);
  }
  return gesehen;
}

async function auswaehlen(P, ids) {
  await P.evaluate((ids) => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board'));
    for (const n of s.state.boards[0].nodes) n.selected = ids.includes(n.id);
    localStorage.setItem('pixinotes-board', JSON.stringify(s));
  }, ids);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
}
async function auswahlMenue(P, menue, knopfText) {
  await P.evaluate(() => [...document.querySelectorAll('.sel-toolbar button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(400);
  if (menue === 'ai') {
    await P.evaluate(() => [...(document.querySelector('.sel-more-menu')?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('KI-Aktionen'))?.click());
    await P.waitForTimeout(400);
    return P.evaluate((t) => { const b = [...(document.querySelector('.sel-ai-menu')?.querySelectorAll('button') ?? [])].find((x) => x.textContent.includes(t)); b?.click(); return !!b; }, knopfText);
  }
  return P.evaluate((t) => { const b = [...(document.querySelector('.sel-more-menu')?.querySelectorAll('button') ?? [])].find((x) => x.textContent.includes(t)); b?.click(); return !!b; }, knopfText);
}

// ══ A: .md-Import ══════════════════════════════════════════════════════
console.log('════ A: Markdown-Import als Notiz ════');
{
  const { ctx, P } = await seite();
  const felder = P.locator('input[type="file"]');
  const n = await felder.count();
  for (let i = 0; i < n; i++) {
    try { await felder.nth(i).setInputFiles(mdPfad); await P.waitForTimeout(1500); if ((await knoten(P)).length) break; } catch { /* nächstes */ }
  }
  const ks = await knoten(P);
  pruefe('A1 die .md wird eine Notiz, keine Datei-Karte', ks.length === 1 && ks[0].type === 'note', JSON.stringify(ks.map((k) => k.type)));
  const bl = ks[0]?.data?.blocks ?? [];
  const typen = bl.map((b) => b.type);
  pruefe('A2 Überschrift bleibt Überschrift', typen[0] === 'heading', typen.join(','));
  pruefe('A3 Aufzählung und Checkliste bleiben Blöcke', typen.includes('bulletListItem') && typen.includes('checkListItem'), typen.join(','));
  const text = JSON.stringify(bl);
  pruefe('A4 kein Markdown-Rohtext („##", „- [ ]") in der Notiz', !/##|- \[ \]/.test(text));
  pruefe('A5 Haken „Team benennen" ist gesetzt', bl.some((b) => b.type === 'checkListItem' && b.props?.checked === true));
  pruefe('A6 Toast bestätigt die Notiz', (await toastText(P)).includes('als Notiz'), await toastText(P));
  await ctx.close();
}

// ══ B: Als Notiz übernehmen ═════════════════════════════════════════════
console.log('════ B: Datei-Karten → Notizen ohne KI ════');
{
  const kurz = (i) => `# Thema ${i}\n\n- [ ] Aufgabe ${i}\n- Hinweis`;
  const nodes = dateiKarten(2, kurz);
  const { ctx, P } = await seite({ nodes: [...nodes, { id: 'n9', type: 'note', position: { x: 700, y: 40 }, width: 280, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Ziel' }] } }], });
  await P.evaluate(() => { const s = JSON.parse(localStorage.getItem('pixinotes-board')); s.state.boards[0].edges = [{ id: 'e1', source: 'f1', target: 'n9', label: 'gehört zu' }]; localStorage.setItem('pixinotes-board', JSON.stringify(s)); });
  await auswaehlen(P, ['f1', 'f2']);
  pruefe('B1 Knopf „Als Notiz übernehmen (2)" im ⋯-Menü', await auswahlMenue(P, 'more', 'Als Notiz übernehmen (2)'));
  await P.waitForTimeout(1500);
  const ks = await knoten(P);
  const notizen = ks.filter((k) => k.type === 'note');
  pruefe('B2 zwei Notizen, keine Datei-Karten mehr', notizen.length === 3 && !ks.some((k) => k.type === 'file'), JSON.stringify(ks.map((k) => k.type)));
  const neu = notizen.filter((k) => k.id !== 'n9');
  pruefe('B3 Notiz liegt an der Stelle der Datei', neu.some((k) => k.position.x === 40 && k.position.y === 40) && neu.some((k) => k.position.x === 340));
  pruefe('B4 Überschrift + Checkliste erhalten', neu.every((k) => k.data.blocks[0]?.type === 'heading' && k.data.blocks.some((b) => b.type === 'checkListItem')));
  const edges = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].edges);
  pruefe('B5 Verbindung hängt jetzt an der Notiz', edges.length === 1 && edges[0].target === 'n9' && edges[0].source !== 'f1' && neu.some((k) => k.id === edges[0].source), JSON.stringify(edges));
  await P.keyboard.press('Control+z');
  await P.waitForTimeout(700);
  const zurueck = await knoten(P);
  pruefe('B6 Strg+Z holt beide Datei-Karten zurück', zurueck.filter((k) => k.type === 'file').length === 2, JSON.stringify(zurueck.map((k) => k.type)));
  await ctx.close();
}

// ══ C: Portionen ═══════════════════════════════════════════════════════
console.log('════ C: 8 große Dateien → Portionen mit Fortschritt ════');
{
  const { ctx, P, aufrufe } = await seite({ nodes: dateiKarten(8) });
  await dockAnweisung(P, 'Wandle alle Dateien in schön formatierte Notizkarten um');
  const toasts = await wartenBisFertig(P);
  pruefe('C1 mehrere Aufrufe statt einem (Portionen)', aufrufe.length >= 3, `${aufrufe.length} Aufrufe`);
  pruefe('C2 jeder Aufruf sieht nur seinen Teil der Karten', aufrufe.every((a) => a.items.length <= 4 && a.items.length >= 1) && new Set(aufrufe.flatMap((a) => a.items)).size === 8, JSON.stringify(aufrufe.map((a) => a.items)));
  pruefe('C3 Prompt nennt „Teil x von y"', aufrufe.every((a) => a.teil), JSON.stringify(aufrufe.map((a) => a.teil)));
  pruefe('C4 Antwortgrenze 4096 Token statt 1024', aufrufe[0].maxTokens === 4096, String(aufrufe[0].maxTokens));
  pruefe('C5 Fortschritts-Toast „Teil … von …"', toasts.some((t) => /Teil \d+ von \d+/.test(t)), toasts.join(' | ').slice(0, 300));
  const ks = await knoten(P);
  pruefe('C6 acht neue Notizen, je eine pro Datei', ks.filter((k) => k.type === 'note').length === 8, String(ks.filter((k) => k.type === 'note').length));
  const ende = toasts[toasts.length - 1];
  pruefe('C7 Endmeldung nennt Schritte und Teile ohne ⚠️', /8 Schritte in \d+ Teilen/.test(ende) && !ende.includes('⚠️'), ende);
  const edges = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].edges);
  pruefe('C8 jede Notiz ist mit ihrer Datei verbunden (from)', edges.length === 8, String(edges.length));
  await P.keyboard.press('Control+z');
  await P.waitForTimeout(700);
  pruefe('C9 EIN Strg+Z nimmt alle Teile zurück', (await knoten(P)).filter((k) => k.type === 'note').length === 0);
  await ctx.close();
}

// ══ D: ein Teil scheitert ═════════════════════════════════════════════
console.log('════ D: ein Teil scheitert — Rest läuft, Meldung ehrlich ════');
{
  const { ctx, P, aufrufe } = await seite({ nodes: dateiKarten(8), plan: (nr) => (nr === 2 ? { status: 500 } : null) });
  await dockAnweisung(P, 'Wandle alle Dateien in Notizen um');
  const toasts = await wartenBisFertig(P);
  const ks = await knoten(P);
  const n = ks.filter((k) => k.type === 'note').length;
  const kaputt = aufrufe[1]?.items.length ?? 0;
  pruefe('D1 die anderen Teile liefen durch', n === 8 - kaputt && n >= 4, `${n} Notizen, Teil 2 hatte ${kaputt}`);
  const ende = toasts[toasts.length - 1];
  pruefe('D2 Meldung mit ⚠️ und „Nicht geschafft"', ende.includes('⚠️') && ende.includes('Nicht geschafft') && /HTTP 500/.test(ende), ende);
  pruefe('D3 Meldung nennt die betroffenen Karten', /Teil 2 \(kapitel-/.test(ende), ende);
  await ctx.close();
}

// ══ E: abgeschnittene Antwort ═══════════════════════════════════════════
console.log('════ E: abgeschnittene Antwort → Portion halbieren ════');
{
  let erstes = true;
  const { ctx, P, aufrufe } = await seite({ nodes: dateiKarten(8), plan: (nr, items) => {
    // Erster Aufruf: nur die erste Karte beantwortet und als abgeschnitten markiert
    if (erstes && items.length > 1) { erstes = false; return { finish: 'length', ops: [{ op: 'note', title: 'halb', text: 'x', from: items[0].id }] }; }
    return null;
  } });
  await dockAnweisung(P, 'Wandle alle Dateien in Notizen um');
  const toasts = await wartenBisFertig(P);
  const ks = await knoten(P);
  pruefe('E1 trotz Abschneiden am Ende alle 8 Notizen', ks.filter((k) => k.type === 'note').length === 8, String(ks.filter((k) => k.type === 'note').length));
  pruefe('E2 ein Aufruf mehr als Portionen (die halbierte)', aufrufe.length >= 4 && aufrufe.slice(1, 3).every((a) => a.items.length < aufrufe[0].items.length), JSON.stringify(aufrufe.map((a) => a.items.length)));
  pruefe('E3 kein „halb"-Teilergebnis übernommen', !ks.some((k) => JSON.stringify(k.data.blocks ?? []).includes('halb')));
  pruefe('E4 Endmeldung ohne ⚠️', !toasts[toasts.length - 1].includes('⚠️'), toasts[toasts.length - 1]);
  await ctx.close();
}

// ══ F: Abbrechen ═══════════════════════════════════════════════════════
console.log('════ F: Abbrechen über den Toast ════');
{
  const { ctx, P, aufrufe } = await seite({ nodes: dateiKarten(8), plan: async () => { await new Promise((r) => setTimeout(r, 1200)); return null; } });
  await dockAnweisung(P, 'Wandle alle Dateien in Notizen um');
  let gedrueckt = false;
  const toasts = await wartenBisFertig(P, 60000, { beiText: { text: 'Teil 2 von', tue: async () => { const k = P.locator('[data-taste="ki-abbrechen"]'); gedrueckt = (await k.count()) === 1; await k.click(); } } });
  await P.waitForTimeout(1500);
  const ks = await knoten(P);
  const n = ks.filter((k) => k.type === 'note').length;
  pruefe('F1 Abbrechen-Knopf war im Fortschritts-Toast und wurde gedrückt', gedrueckt, toasts.join(' | ').slice(0, 300));
  pruefe('F2 nicht alle Notizen entstanden', n > 0 && n < 8, `${n} Notizen, ${aufrufe.length} Aufrufe`);
  pruefe('F3 Endmeldung „Abgebrochen nach Teil …"', toasts.some((t) => /Abgebrochen nach Teil \d/.test(t)), toasts.slice(-2).join(' | '));
  pruefe('F4 keine weiteren Aufrufe nach dem Abbruch', aufrufe.length <= 3, String(aufrufe.length));
  await ctx.close();
}

// ══ G: Texte verbessern (2) ═════════════════════════════════════════════
console.log('════ G: zwei Notizen verbessern ════');
{
  const nodes = [1, 2].map((i) => ({ id: `n${i}`, type: 'note', position: { x: 40 + i * 320, y: 40 }, width: 280, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: `Notiz ${i} mit Tipfehler` }] } }));
  const { ctx, P, aufrufe } = await seite({ nodes, plan: () => ({ text: '## Verbessert\n\nNotiz ohne Tippfehler.' }) });
  await auswaehlen(P, ['n1', 'n2']);
  pruefe('G1 Knopf heißt „Texte verbessern (2)"', await auswahlMenue(P, 'ai', 'Texte verbessern (2)'));
  await wartenBisFertig(P, 30000);
  await P.waitForTimeout(800);
  const ks = await knoten(P);
  pruefe('G2 zwei Vorschläge, zwei Aufrufe', ks.filter((k) => k.type === 'note').length === 4 && aufrufe.length === 2, `${ks.length} Karten, ${aufrufe.length} Aufrufe`);
  pruefe('G3 Meldung „2 von 2 Texten verbessert"', (await toastText(P)).includes('2 von 2 Texten'), await toastText(P));
  await ctx.close();
}

// ══ H: Kontext-Hinweis ═════════════════════════════════════════════════
console.log('════ H: Board-Aktion mit zu viel Inhalt meldet die Auslassung ════');
{
  const { ctx, P } = await seite({ nodes: dateiKarten(8), plan: () => ({ text: JSON.stringify({ summary: 'ok', ops: [] }) }) });
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-ai button')].find((b) => b.textContent.includes('Briefing'))?.click());
  const toasts = await wartenBisFertig(P, 30000);
  const ende = toasts[toasts.length - 1];
  pruefe('H1 Meldung nennt weggelassene Karten', /passten nicht mehr in den Kontext/.test(ende) && /\d Karte\(n\)/.test(ende), ende);
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\nm332-md-ki: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
