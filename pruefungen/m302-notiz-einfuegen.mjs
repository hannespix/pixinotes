/**
 * M302 — Einfügen im Menü der Notiz.
 *
 * Der 🖼-Chip unter der Notiz ist weg; das „/"-Menü bietet unter „Medien"
 * Bild aus Zwischenablage, Bild aus Datei und Datei als Karte daneben.
 *   A  Kein Chip mehr, auch mit Cursor im Text; die drei Menü-Einträge stehen da.
 *   B  „Datei als Karte daneben" öffnet einen Wähler ohne Bild-Beschränkung;
 *      eine gewählte Datei wird zur Datei-Karte rechts neben der Notiz.
 *   C  „Bild aus Datei" öffnet den Bild-Wähler; ein gewähltes Bild landet als
 *      Bild-Block in der Notiz.
 *   D  Quelltext: kein Chip mehr in NoteCard und im Stylesheet.
 */
// Läuft aus dem Repository: `node pruefungen/m302-notiz-einfuegen.mjs`
// Voraussetzung: `npm run build` und ein Chromium (PW_CHROMIUM).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4523;
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

async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false, schliff: 1 }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes: [
        { id: 'n1', type: 'note', position: { x: 60, y: 60 }, width: 320, height: 240,
          data: { color: 'yellow', blocks: [{ id: 'p1', type: 'paragraph', props: {},
            content: [{ type: 'text', text: 'Aktenvermerk', styles: {} }], children: [] }] } }] }],
      spaces: [{ id: 's1', name: 'Dienst', projects: [{ id: 'p1', name: 'Vorgänge', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board' } }));
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P };
}
const MENUE = '.bn-suggestion-menu-item, [class*="suggestion-menu"] [role="option"]';
const stand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards?.[0] ?? null);
/** Cursor in die Notiz, neue Zeile, „/" tippen */
async function menueOeffnen(P) {
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.keyboard.press('End');
  await P.keyboard.press('Enter');
  await P.keyboard.type('/');
  await P.waitForTimeout(900);
}
// Ein winziges, gültiges PNG (1×1) für den Bild-Wähler
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

console.log('════ A: Kein Chip, drei Menü-Einträge ════');
{
  const { ctx, P } = await seite();
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.waitForTimeout(500);
  pruefe('A1 kein 🖼-Chip mehr unter der Notiz, auch mit Cursor im Text', (await P.locator('.due-chip', { hasText: 'Bild' }).count()) === 0 && (await P.locator('.bild-chip').count()) === 0);
  await P.keyboard.press('End');
  await P.keyboard.press('Enter');
  await P.keyboard.type('/');
  await P.waitForTimeout(900);
  const texte = await P.locator(MENUE).allTextContents();
  pruefe('A2 „Bild aus Zwischenablage" steht im Menü', texte.some((t) => /Bild aus Zwischenablage/.test(t)));
  pruefe('A3 „Bild aus Datei" steht im Menü', texte.some((t) => /Bild aus Datei/.test(t)));
  pruefe('A4 „Datei als Karte daneben" steht im Menü', texte.some((t) => /Datei als Karte daneben/.test(t)));
  await P.screenshot({ path: `${SD}/m302-a-menue.png` });
  await ctx.close();
}

console.log('════ B: Datei als Karte daneben ════');
{
  const { ctx, P } = await seite();
  await menueOeffnen(P);
  await P.locator(MENUE, { hasText: 'Datei als Karte daneben' }).first().click();
  await P.waitForTimeout(400);
  const feld = P.locator('input[type="file"]:not([accept])').last();
  pruefe('B1 der Eintrag öffnet einen Wähler ohne Bild-Beschränkung', (await feld.count()) > 0 && await feld.evaluate((i) => i.multiple));
  await feld.setInputFiles({ name: 'Vermerk.txt', mimeType: 'text/plain', buffer: Buffer.from('Hallo Akte') });
  await P.waitForTimeout(2500);
  const b = await stand(P);
  const datei = (b?.nodes ?? []).find((n) => n.id !== 'n1');
  pruefe('B2 die Datei wird zur Karte auf dem Board', !!datei && (await P.locator('.file-card').count()) >= 1, JSON.stringify((b?.nodes ?? []).map((n) => n.type)));
  pruefe('B3 … rechts neben der Notiz', !!datei && datei.position.x >= 60 + 320 && Math.abs(datei.position.y - 60) < 80, JSON.stringify(datei?.position));
  pruefe('B4 die Notiz selbst bleibt ohne Datei-Block', !(b?.nodes ?? []).find((n) => n.id === 'n1').data.blocks.some((x) => x.type === 'file'));
  await P.screenshot({ path: `${SD}/m302-b-datei.png` });
  await ctx.close();
}

console.log('════ C: Bild aus Datei ════');
{
  const { ctx, P } = await seite();
  await menueOeffnen(P);
  await P.locator(MENUE, { hasText: 'Bild aus Datei' }).first().click();
  await P.waitForTimeout(400);
  const feld = P.locator('input[type="file"][accept="image/*"]').last();
  pruefe('C1 der Eintrag öffnet den Bild-Wähler', (await feld.count()) > 0);
  await feld.setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await P.waitForTimeout(2500);
  const b = await stand(P);
  const typen = (b?.nodes ?? []).find((n) => n.id === 'n1')?.data.blocks.map((x) => x.type) ?? [];
  pruefe('C2 das Bild landet als Bild-Block in der Notiz', typen.includes('image'), typen.join(','));
  pruefe('C3 … und nicht als eigene Karte', (b?.nodes ?? []).length === 1);
  await ctx.close();
}

console.log('════ D: Quelltext ════');
{
  const karte = readFileSync(join(__repo, 'src/components/nodes/NoteCard.tsx'), 'utf8');
  const css = readFileSync(join(__repo, 'src/index.css'), 'utf8');
  pruefe('D1 kein Bild-Chip mehr in der Notiz-Karte', !/bild-chip|🖼 Bild/.test(karte));
  pruefe('D2 keine Chip-Regel mehr im Stylesheet', !/bild-chip/.test(css));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
