/**
 * M287 — „Board heißt '🏖️ Amrum 2026', wenn ich umbenennen drücke kommt aber
 * nur 'Amrum' … wieso?!"
 *
 * Der Befund: Nichts war kaputt — es waren ZWEI verschiedene Dinge mit
 * demselben Wort. „Bereich" hieß die oberste Hierarchie-Ebene (Bereich ›
 * Projekt › Board) UND der Rahmen auf dem Board. Der Knopf „Umbenennen" in
 * der Auswahl-Leiste benannte deshalb den RAHMEN um („Amrum"), während man
 * das BOARD („🏖️ Amrum 2026") im Sinn hatte.
 *
 * Diese Reihe prüft beides: dass die Wörter jetzt auseinandergehalten werden
 * und dass das Board dort umbenannt werden kann, wo man es gerade sieht —
 * im Navigator.
 */
// Läuft aus dem Repository: `node pruefungen/m287-wortwahl.mjs`
// Voraussetzung: `npm run build` und ein Chromium (PW_CHROMIUM).
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
const PORT = 4507;
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

/* Genau der gemeldete Fall: ein Board mit Emoji im Namen, darauf ein Rahmen,
   der nur „Amrum" heißt. */
async function seite(ansicht = 'board', viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((ansicht) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    const mk = (id, txt, x, y) => ({ id, type: 'note', position: { x, y }, width: 240, height: 150,
      data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', props: {},
        content: [{ type: 'text', text: txt, styles: {} }], children: [] }] } });
    const rahmen = { id: 'f1', type: 'frame', position: { x: 20, y: 20 }, width: 560, height: 260,
      data: { name: 'Amrum', color: '#dbe7f6' } };
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [
        { id: 'b0', name: '🏖️ Amrum 2026', edges: [], drawings: [], comments: [],
          nodes: [rahmen, mk('n1', 'Fähre buchen', 60, 70)] },
        { id: 'b1', name: 'Dienstplan', edges: [], drawings: [], comments: [], nodes: [] },
      ],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'Urlaub', boardIds: ['b0', 'b1'] }] }],
      activeId: 'b0', view: ansicht, cardFocus: true, navLinks: false } }));
  }, ansicht);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2400);
  return { ctx, P };
}

const boardName = (P, id = 'b0') => P.evaluate((id) => {
  const s = JSON.parse(localStorage.getItem('pixinotes-board'));
  return s.state.boards.find((b) => b.id === id)?.name ?? null;
}, id);

// ══ T1: Der Rahmen sagt jetzt, dass er ein Rahmen ist ═══════════════
console.log('════ T1: Umbenennen am Rahmen nennt das Ding beim Namen ════');
{
  const { ctx, P } = await seite('board');
  let frage = null;
  P.on('dialog', async (d) => { frage = d.message(); await d.dismiss(); });
  // Rahmen an seiner Titel-Leiste auswählen (die Fläche gehört dem Board)
  await P.locator('.frame-head, .frame-title').first().click();
  await P.waitForTimeout(700);
  const knopf = P.locator('.sel-toolbar button', { hasText: 'Rahmen' }).first();
  const daFrameKnopf = await knopf.count();
  pruefe('T1a die Auswahl-Leiste bietet den Rahmen-Knopf', daFrameKnopf > 0, String(daFrameKnopf));
  if (daFrameKnopf) {
    await knopf.click();
    await P.waitForTimeout(500);
    const eintrag = P.locator('.sel-frame-menu button', { hasText: 'Umbenennen' }).first();
    await eintrag.click();
    await P.waitForTimeout(600);
    console.log('    Rückfrage:', JSON.stringify(frage));
    pruefe('T1b die Rückfrage spricht vom RAHMEN, nicht vom Board',
      /Rahmen auf dem Board/.test(frage ?? ''), String(frage));
    pruefe('T1c und sagt, was mit den Karten darin passiert',
      /Karten darin bleiben unberührt/.test(frage ?? ''), String(frage));
  }
  await P.screenshot({ path: `${SD}/m287-rahmen.png` });
  await ctx.close();
}

// ══ T2: Das Board wird im Navigator umbenannt — mit vollem Namen ════
console.log('\n════ T2: Board umbenennen im Navigator ════');
{
  const { ctx, P } = await seite('board');
  await P.locator('.sidepanel-fahne').click();
  await P.waitForTimeout(1200);
  pruefe('T2a der Navigator ist offen', await P.evaluate(() => !!document.querySelector('.side-tree')));
  const zeile = P.locator('.side-board', { hasText: 'Amrum 2026' }).first();
  pruefe('T2b das Board steht mit seinem VOLLEN Namen da',
    (await zeile.locator('.side-board-name').first().textContent())?.includes('🏖️') === true,
    String(await zeile.locator('.side-board-name').first().textContent()));
  const stift = zeile.locator('.side-board-pen');
  pruefe('T2c es gibt einen Weg zum Umbenennen — direkt hier', await stift.count() > 0);
  await stift.click({ force: true });
  await P.waitForTimeout(500);
  const feld = P.locator('.side-board-name input, input.side-board-name').first();
  const wert = await feld.inputValue();
  console.log('    Feldinhalt:', JSON.stringify(wert));
  pruefe('T2d im Feld steht der GANZE Board-Name (der gemeldete Fehler)',
    wert === '🏖️ Amrum 2026', wert);
  await feld.fill('🏖️ Amrum 2027');
  await feld.press('Enter');
  await P.waitForTimeout(900);
  pruefe('T2e das Umbenennen wirkt auf das Board', await boardName(P) === '🏖️ Amrum 2027',
    String(await boardName(P)));
  pruefe('T2f der Rahmen auf dem Board bleibt davon unberührt',
    await P.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('pixinotes-board'));
      return s.state.boards.find((b) => b.id === 'b0').nodes.find((n) => n.id === 'f1').data.name;
    }) === 'Amrum');
  await P.screenshot({ path: `${SD}/m287-navigator.png` });
  await ctx.close();
}

// ══ T3: Wortwahl in der Oberfläche ══════════════════════════════════
console.log('\n════ T3: Ein Ding, ein Wort ════');
{
  const { ctx, P } = await seite('board');
  // ＋-Menü des Docks öffnen
  const auf = await P.evaluate(() => {
    const b = [...document.querySelectorAll('.dock button')]
      .find((x) => x.getAttribute('aria-label') === 'Objekt hinzufügen');
    b?.click();
    return !!b;
  });
  await P.waitForTimeout(700);
  const eintraege = await P.evaluate(() => [...document.querySelectorAll('.dock-menu button')].map((b) => b.textContent.trim()));
  console.log('    ＋-Menü:', JSON.stringify(eintraege.slice(0, 20)));
  pruefe('T3a das ＋-Menü ist offen', eintraege.length > 3, `geöffnet: ${auf}`);
  pruefe('T3b der Rahmen heißt nur noch „Rahmen"',
    eintraege.includes('Rahmen'), JSON.stringify(eintraege));
  pruefe('T3c und nirgends mehr „Rahmen (Bereich)"',
    !eintraege.some((t) => /Rahmen \(Bereich\)/.test(t)), JSON.stringify(eintraege));
  const hinweis = await P.evaluate(() =>
    [...document.querySelectorAll('.dock-menu button')].find((b) => b.textContent.trim() === 'Rahmen')?.getAttribute('title') ?? '');
  pruefe('T3d der Zeiger erklärt den Unterschied zum Bereich der Übersicht',
    /Bereich in der Übersicht/.test(hinweis), hinweis);
  await ctx.close();
}

// ══ T4: Neuer Rahmen heißt „Neuer Rahmen" ═══════════════════════════
console.log('\n════ T4: Vorgabename ════');
{
  const { ctx, P } = await seite('board');
  await P.evaluate(() => {
    [...document.querySelectorAll('.dock button')]
      .find((x) => x.getAttribute('aria-label') === 'Objekt hinzufügen')?.click();
  });
  await P.waitForTimeout(600);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu button')].find((b) => b.textContent.trim() === 'Rahmen')?.click());
  await P.waitForTimeout(1200);
  const namen = await P.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board'));
    return s.state.boards.find((b) => b.id === 'b0').nodes.filter((n) => n.type === 'frame').map((n) => n.data.name);
  });
  console.log('    Rahmen auf dem Board:', JSON.stringify(namen));
  pruefe('T4a ein neuer Rahmen heißt „Neuer Rahmen" (vorher „Neuer Bereich")',
    namen.includes('Neuer Rahmen'), JSON.stringify(namen));
  pruefe('T4b kein Rahmen heißt mehr „Neuer Bereich"',
    !namen.includes('Neuer Bereich'), JSON.stringify(namen));
  await ctx.close();
}

// ══ T5: Der Bereich der Übersicht erklärt sich ══════════════════════
console.log('\n════ T5: Bereich in der Übersicht ════');
{
  const { ctx, P } = await seite('overview');
  const t = await P.locator('.ov-add-space-float').getAttribute('title');
  console.log('    Zeiger:', JSON.stringify(t));
  pruefe('T5a „+ Neuer Bereich" sagt, welche Ebene gemeint ist',
    /oberste Ebene/.test(t ?? '') && /Rahmen/.test(t ?? ''), String(t));
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
