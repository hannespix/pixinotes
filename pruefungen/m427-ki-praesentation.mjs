/**
 * M427 — Präsentation per KI: Gliederung als JSON, PixiNotes baut die Vibe-Studio-Folien.
 *
 * Gewünscht: „Die Präsentation im Präsentationsmodul soll per KI-Funktion erstellt werden können! Geht das sauber?"
 *
 *   A  KI-Menü des Boards: „Präsentation erstellen" — der Auftrag enthält die Karten und den Wunsch aus dem Feld;
 *      es entsteht eine Präsentations-Karte (Vibe Studio) mit dem Titel als Namen, Pfeile von den Quellen (≤ 4).
 *   B  Die Folien: Titelfolie mit Motiv, dann die Arten der Gliederung (Kapitel, Text, Punkte, Zahl, Zitat, Ablauf,
 *      Schluss) als Vibe-Studio-Abschnitte; Sprechernotizen; der Editor öffnet sich auf ihnen.
 *   C  Sicherheit: HTML aus der KI bleibt Text; unbekannte Arten werden Text; zu lange Texte werden gekürzt; ein
 *      Ablauf mit falscher Schrittzahl wird Text; kaputtes JSON → verständliche Meldung, keine leere Karte.
 *   D  Freitext „Erstelle eine Präsentation …" nimmt denselben Weg; „Notiz zur Präsentation" nicht.
 *   E  KI-Menü einer Auswahl: „Als Präsentation" aus genau den markierten Karten.
 *   F  Hilfe, Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m427-ki-praesentation.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4765;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const KARTEN = [
  { id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 300, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 2 }, content: 'Quartal Q3' }, { type: 'paragraph', content: 'Umsatz plus 18 Prozent, Bestandskunden bestellen mehr.' }] } },
  { id: 'n2', type: 'note', position: { x: 360, y: 0 }, width: 300, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Kundenstimme: So schnell hat uns noch niemand beliefert.' }] } },
  { id: 'k1', type: 'kanban', position: { x: 0, y: 300 }, width: 420, height: 260, data: { title: 'Nächste Schritte', items: [{ id: 'a', text: 'Zielkunden festlegen', col: 0 }, { id: 'b', text: 'Wartungsvertrag anbieten', col: 0 }] } },
];
const GUT = {
  titel: 'Quartalsbericht Q3', untertitel: 'Umsatz, Kunden, nächste Schritte', autor: 'Team Vertrieb', anlass: 'Geschäftsführung',
  folien: [
    { art: 'kapitel', titel: 'Wo wir stehen.', text: 'Ein starkes Quartal.', notiz: 'Kurz einordnen.' },
    { art: 'zahl', zahl: '18', titel: 'Prozent mehr Umsatz.', text: 'Vor allem durch Bestandskunden.', notiz: 'Zahl aus der Notiz.' },
    { art: 'punkte', marke: '01 / gründe', titel: 'Drei Gründe.', punkte: [{ titel: 'Treue Kunden.', text: 'Mehr Wiederkäufe.' }, { titel: 'Neues Angebot.', text: 'Wartungsverträge.' }, { titel: 'Schnell.', text: 'Zwei Tage früher.' }], notiz: 'Gründe erläutern.' },
    { art: 'zitat', titel: 'So schnell hat uns noch niemand beliefert.', text: 'Kundenstimme', notiz: 'Zitat vorlesen.' },
    { art: 'ablauf', titel: 'Planen. Anbieten. Nachfassen.', punkte: [{ titel: 'planen', text: 'Zielkunden festlegen.' }, { titel: 'anbieten', text: 'Wartungsvertrag anbieten.' }, { titel: 'nachfassen', text: 'Nach zwei Wochen anrufen.' }], notiz: 'Ausblick.' },
    { art: 'text', titel: 'Die Pipeline ist gut gefüllt.', text: 'Neue Kunden kommen langsamer, aber stetig.', notiz: 'Details.' },
    { art: 'schluss', titel: 'Danke. Fragen?', text: 'Team Vertrieb', notiz: 'Fragerunde.' },
  ],
};
const BOESE = {
  titel: 'Test <img src=x onerror=alert(1)>', untertitel: '<script>alert(2)</script>',
  folien: [
    { art: 'weissnicht', titel: 'Unbekannte Art.', text: 'Wird Text.' },
    { art: 'ablauf', titel: 'Nur zwei Schritte.', punkte: [{ titel: 'a', text: 'eins' }, { titel: 'b', text: 'zwei' }] },
    { art: 'text', titel: 'Sehr lang ' + 'x'.repeat(300), text: 'Wort '.repeat(300) },
  ],
};
const auf = async (antwort) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((nn) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Vertrieb', edges: [], drawings: [], nodes: nn, comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
      ai: { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } } }));
  }, KARTEN);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const aufrufe = [];
  await P.route('**/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const c = body.messages?.[0]?.content;
    aufrufe.push({ prompt: typeof c === 'string' ? c : (c ?? []).map((t) => t.text ?? '').join('\n'), max: body.max_tokens ?? body.max_completion_tokens });
    const a = typeof antwort === 'function' ? antwort(aufrufe.length) : antwort;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: typeof a === 'string' ? a : JSON.stringify(a) }, finish_reason: 'stop' }] }) });
  });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, aufrufe };
};
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const fertig = async (P) => {
  await P.waitForFunction(() => { const t = document.querySelector('.toast')?.textContent ?? ''; return t !== '' && !/analysiert|^KI: /.test(t); }, null, { timeout: 30000 }).catch(() => {});
  const t = await toast(P);
  await P.waitForTimeout(1300);
  return t;
};
const kiMenue = async (P) => {
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click());
  await P.waitForTimeout(300);
};
const quelltext = (P, id) => P.evaluate(async (i) => {
  const db = await new Promise((ok, nein) => { const r = indexedDB.open('pixinotes-sync'); r.onsuccess = () => ok(r.result); r.onerror = () => nein(r.error); });
  return new Promise((ok) => { const q = db.transaction('kv').objectStore('kv').get(`happ:${i}`); q.onsuccess = () => ok(q.result ?? ''); q.onerror = () => ok(''); });
}, id);
const vibeRahmen = async (P, ms = 12000) => {
  for (let t = 0; t < ms; t += 250) {
    const f = P.frames().find((x) => x !== P.mainFrame() && x.url().startsWith('about:srcdoc'));
    if (f && await f.locator('#edit').count().catch(() => 0)) return f;
    await P.waitForTimeout(250);
  }
  return null;
};

// ══ A/B: KI-Menü des Boards ══
console.log('\n════ A/B: KI-Menü des Boards ════');
{
  const { ctx, P, aufrufe } = await auf(GUT);
  await kiMenue(P);
  pruefe('A1 Eintrag „Präsentation erstellen" im KI-Menü', (await P.locator('[data-taste="ki-praesentation"]').count()) === 1);
  await P.locator('[data-taste="ki-board-eingabe"]').fill('Für die Geschäftsführung, sachlich, 8 Folien');
  await P.locator('[data-taste="ki-praesentation"]').click();
  const t = await fertig(P);
  pruefe('A2 Meldung nennt Titel und Folienzahl', /Quartalsbericht Q3/.test(t) && /8 Folien/.test(t), t);
  const pr = aufrufe[0]?.prompt ?? '';
  pruefe('A3 der Auftrag enthält Wunsch und Karten', pr.includes('Für die Geschäftsführung, sachlich, 8 Folien') && pr.includes('Umsatz plus 18 Prozent') && pr.includes('Wartungsvertrag anbieten'), pr.slice(0, 200));
  pruefe('A4 genug Platz für die Antwort (max. Token ≥ 8000)', (aufrufe[0]?.max ?? 0) >= 8000, String(aufrufe[0]?.max));
  const b = await knoten(P);
  const neu = b.nodes.find((n) => n.type === 'htmlapp');
  pruefe('A5 Präsentations-Karte mit dem Titel als Namen', !!neu && neu.data.vorlage === 'vibestudio' && neu.data.name === 'Quartalsbericht Q3', neu?.data);
  pruefe('A6 bei einem ganzen Board (3 Karten) Pfeile von den Quellen', b.edges.filter((e) => e.target === neu?.id).length === 3, b.edges.length);
  const html = await quelltext(P, neu.id);
  const sek = (html.match(/<section /g) ?? []).length;
  pruefe('B1 acht Abschnitte (Titel + 7)', sek === 8, sek);
  pruefe('B2 Arten als Vibe-Studio-Layouts', ['class="chapter paper"', 'content ink quote-slide big', 'content cream count-slide', 'content cream rules-slide', 'content ink quote-slide"', 'content sage flow-slide', 'class="content cream"'].every((k) => html.includes(k)));
  pruefe('B3 Sprechernotizen in jeder Folie', (html.match(/<aside class="notes">[^<]+<\/aside>/g) ?? []).length >= 7);
  pruefe('B4 Fenstertitel und Titelfolie', html.includes('<title>Quartalsbericht Q3</title>') && html.includes('<h1>Quartalsbericht Q3</h1>') && html.includes('Team Vertrieb <span>Geschäftsführung</span>'));
  const f = await vibeRahmen(P);
  pruefe('B5 die Karte läuft, Vibe Studio zeigt die Titelfolie', !!f && (await f.locator('.chapter-title h1').first().textContent()) === 'Quartalsbericht Q3');
  if (f) {
    const k = await P.locator(`.react-flow__node[data-id="${neu.id}"]`).boundingBox();
    await P.mouse.click(k.x + 60, k.y + 12); await P.waitForTimeout(300);
    await f.locator('#edit').click({ force: true }); await P.waitForTimeout(900);
    const folien = await f.locator('.slides > section').count();
    pruefe('B6 im Editor: acht Folien, bearbeitbar', folien === 8 && await f.locator('#editor-present').isVisible(), folien);
  }
  await P.screenshot({ path: `${SD}/m427-a-board.png` });
  // Tasten gehören sonst dem Tool in der Karte: erst aufs Board klicken
  await P.mouse.click(1380, 860); await P.waitForTimeout(300);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(800);
  const nach = await knoten(P);
  pruefe('A7 Strg+Z nimmt Karte und Pfeile zurück', !nach.nodes.some((n) => n.type === 'htmlapp') && nach.edges.length === 0, [nach.nodes.length, nach.edges.length]);
  await ctx.close();
}

// ══ C: Sicherheit, Prüfung ══
console.log('\n════ C: Sicherheit ════');
{
  const { ctx, P } = await auf(BOESE);
  await kiMenue(P);
  await P.locator('[data-taste="ki-praesentation"]').click();
  await fertig(P);
  const neu = (await knoten(P)).nodes.find((n) => n.type === 'htmlapp');
  const html = neu ? await quelltext(P, neu.id) : '';
  const folien = html.slice(html.indexOf('<div class="slides">'), html.indexOf('<div class="deck-ui"'));
  pruefe('C1 HTML aus der KI bleibt Text', !/<img src=x|<script>alert/.test(folien) && folien.includes('&lt;img src=x') && folien.includes('&lt;script&gt;'));
  pruefe('C2 unbekannte Art → Textfolie; Ablauf mit 2 Schritten → Textfolie', (folien.match(/class="content cream"/g) ?? []).length === 3 && !folien.includes('flow-slide'));
  const h2 = [...folien.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
  pruefe('C3 zu lange Titel gekürzt', h2.every((t) => t.length <= 95), h2.map((t) => t.length));
  await ctx.close();
}
{
  const { ctx, P } = await auf('Hier ist leider kein JSON.');
  await kiMenue(P);
  await P.locator('[data-taste="ki-praesentation"]').click();
  const t = await fertig(P);
  pruefe('C4 kein JSON: Meldung, keine Karte', /fehlgeschlagen|JSON/.test(t) && !(await knoten(P)).nodes.some((n) => n.type === 'htmlapp'), t);
  await ctx.close();
}

// ══ D: Freitext ══
console.log('\n════ D: Freitext ════');
{
  const { ctx, P, aufrufe } = await auf((nr) => (nr === 1 ? GUT : { summary: 'ok', ops: [{ op: 'note', text: 'Notiz zur Präsentation' }] }));
  await kiMenue(P);
  await P.locator('[data-taste="ki-board-eingabe"]').fill('Erstelle eine Präsentation über das Quartal für den Vorstand');
  await P.locator('.dock-menu-ai .ai-cmd-go').click();
  await fertig(P);
  pruefe('D1 „Erstelle eine Präsentation …": Folien-Auftrag, Präsentations-Karte', (aufrufe[0]?.prompt ?? '').startsWith('Du erstellst eine Präsentation') && (await knoten(P)).nodes.some((n) => n.type === 'htmlapp'));
  await kiMenue(P);
  await P.locator('[data-taste="ki-board-eingabe"]').fill('Erstelle eine Notiz zur Präsentation');
  await P.locator('.dock-menu-ai .ai-cmd-go').click();
  await fertig(P);
  pruefe('D2 „Notiz zur Präsentation": normaler Plan, keine zweite Präsentation', !(aufrufe[1]?.prompt ?? 'Du erstellst eine Präsentation').startsWith('Du erstellst eine Präsentation') && (await knoten(P)).nodes.filter((n) => n.type === 'htmlapp').length === 1);
  await ctx.close();
}

// ══ E: Auswahl ══
console.log('\n════ E: Auswahl ════');
{
  const { ctx, P, aufrufe } = await auf(GUT);
  const a = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
  await P.mouse.click(a.x + 60, a.y + 20); await P.keyboard.down('Shift');
  const b2 = await P.locator('.react-flow__node[data-id="n2"]').boundingBox();
  await P.mouse.click(b2.x + 60, b2.y + 20); await P.keyboard.up('Shift'); await P.waitForTimeout(400);
  await P.evaluate(() => [...(document.querySelector('.sel-toolbar')?.querySelectorAll('button') ?? [])].find((x) => x.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(500);
  await P.evaluate(() => [...(document.querySelector('.sel-more-menu')?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('KI-Aktionen'))?.click());
  await P.waitForTimeout(400);
  const knopf = P.locator('[data-taste="ki-praesentation-auswahl"]');
  pruefe('E1 „Als Präsentation" im KI-Menü der Auswahl', (await knopf.count()) === 1);
  if (await knopf.count()) {
    await knopf.click();
    await fertig(P);
    const pr = aufrufe[0]?.prompt ?? '';
    pruefe('E2 nur die markierten Karten im Auftrag', pr.includes('Umsatz plus 18 Prozent') && pr.includes('niemand beliefert') && !pr.includes('Wartungsvertrag anbieten'));
    const b = await knoten(P); const neu = b.nodes.find((n) => n.type === 'htmlapp');
    pruefe('E3 Pfeile von den zwei Quellen', b.edges.filter((e) => e.target === neu?.id).length === 2);
  }
  await ctx.close();
}

// ══ F ══
console.log('\n════ F: Hilfe, Umbau ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('F1 Hilfe nennt M427', /M427/.test(hilfe));
  pruefe('F2 Umbau-Liste nennt M427', /M427/.test(umbau));
  pruefe('F3 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
}
await browser.close();
app.close();
console.log(`\nM427: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
