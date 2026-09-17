/**
 * M303 — Speicher fast voll: Das Bild wird zur Karte, nicht zum leeren Block.
 *
 * Gemeldet: „Uncaught (in promise) Error: Speicherbudget" beim Einfügen von
 * Bildern in eine Notiz. Der Editor setzt beim Einfügen zuerst einen leeren
 * Bild-Block; wies die Ablage das Bild ab, blieb der Block leer und die
 * Abweisung landete unbehandelt in der Konsole.
 *   A  Notiz, Stand fast voll: Einfügen erzeugt keinen Fehler, keinen leeren
 *      Bild-Block, sondern eine Datei-Karte (Geräte-Ablage) rechts neben der
 *      Notiz — ohne Base64 im Stand.
 *   B  Board, Stand fast voll: Einfügen auf der Fläche legt ebenfalls eine
 *      Datei-Karte an statt das Bild zu verwerfen.
 *   C  Stand mit Platz: Einfügen in die Notiz erzeugt weiterhin den Bild-Block.
 *   D  index.html trägt neben dem Apple-Meta auch mobile-web-app-capable.
 */
// Läuft aus dem Repository: `node pruefungen/m303-speicher-voll.mjs`
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
const PORT = 4524;
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

/** Seite mit einer Notiz; `voll` legt ein zweites, nie gezeigtes Board an, das den Stand bis kurz vor das Budget füllt */
async function seite(voll) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript((voll) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false, schliff: 1 }));
    const boards = [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes: [
      { id: 'n1', type: 'note', position: { x: 60, y: 60 }, width: 320, height: 240,
        data: { color: 'yellow', blocks: [{ id: 'p1', type: 'paragraph', props: {},
          content: [{ type: 'text', text: 'Aktenvermerk', styles: {} }], children: [] }] } }] }];
    if (voll) {
      // Budget 4.000.000 Zeichen — dieser Stand lässt ~20 KB Luft, jedes echte Bild sprengt ihn
      boards.push({ id: 'b1', name: 'Ballast', edges: [], drawings: [], comments: [], nodes: [
        { id: 'n9', type: 'note', position: { x: 0, y: 0 }, width: 320, height: 240,
          data: { color: 'yellow', blocks: [{ id: 'p9', type: 'paragraph', props: {},
            content: [{ type: 'text', text: 'x'.repeat(3_978_000), styles: {} }], children: [] }] } }] });
    }
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards,
      spaces: [{ id: 's1', name: 'Dienst', projects: [{ id: 'p1', name: 'Vorgänge', boardIds: voll ? ['b0', 'b1'] : ['b0'] }] }],
      activeId: 'b0', view: 'board' } }));
  }, !!voll);
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P, fehler };
}
const stand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards?.[0] ?? null);

/** Ein Bild mit Rauschen (lässt sich nicht kleinrechnen) als Einfüge-Ereignis auf ein Ziel schicken */
const einfuegen = (P, sel) => P.evaluate(async ([sel]) => {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 480;
  const x = c.getContext('2d');
  const bild = x.createImageData(c.width, c.height);
  for (let i = 0; i < bild.data.length; i++) bild.data[i] = (Math.random() * 255) | 0;
  x.putImageData(bild, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'rauschen.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const ziel = sel ? document.querySelector(sel) : document.body;
  if (!ziel) return { ok: false, roh: blob.size };
  ziel.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
  return { ok: true, roh: blob.size };
}, [sel]);

console.log('════ A: Notiz bei fast vollem Stand ════');
{
  const { ctx, P, fehler } = await seite(true);
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.keyboard.press('End');
  const roh = await einfuegen(P, '.note-editor [contenteditable="true"]');
  pruefe('A1 das Einfügen erreicht den Text', roh.ok, JSON.stringify(roh));
  // Der Hinweis steht nur ein paar Sekunden — währenddessen einsammeln
  const toasts = new Set();
  for (let i = 0; i < 14; i++) {
    await P.waitForTimeout(250);
    const t = await P.locator('.toast.show').textContent().catch(() => null);
    if (t) toasts.add(t.trim());
  }
  pruefe('A2 kein unbehandelter Fehler „Speicherbudget"', !fehler.some((m) => /Speicherbudget/.test(m)), fehler.join(' | '));
  const b = await stand(P);
  const notiz = (b?.nodes ?? []).find((n) => n.id === 'n1');
  const typen = notiz?.data.blocks.map((x) => x.type) ?? [];
  pruefe('A3 kein Bild-Block in der Notiz (er passte nicht)', !typen.includes('image'), typen.join(','));
  pruefe('A4 kein leerer Bild-Platzhalter im Editor', (await P.locator('.note-editor [data-content-type="image"], .note-editor .bn-file-block-content-wrapper').count()) === 0);
  const karte = (b?.nodes ?? []).find((n) => n.id !== 'n1');
  pruefe('A5 stattdessen eine Datei-Karte rechts neben der Notiz', !!karte && karte.type === 'file' && karte.position.x >= 60 + 320, JSON.stringify(karte && { type: karte.type, pos: karte.position }));
  pruefe('A6 … in der Geräte-Ablage, ohne Base64 im Stand', !!karte && karte.data.lokal === true && !karte.data.dataUrl);
  pruefe('A7 die Karte ist auf dem Board zu sehen', (await P.locator('.file-card').count()) >= 1);
  pruefe('A8 ein Hinweis nennt den Grund', [...toasts].some((t) => /Speicher fast voll/.test(t)), [...toasts].join(' | '));
  await P.screenshot({ path: `${SD}/m303-a-notiz.png` });
  await ctx.close();
}

console.log('════ B: Board bei fast vollem Stand ════');
{
  const { ctx, P, fehler } = await seite(true);
  await P.locator('.react-flow__pane').click({ position: { x: 900, y: 600 } });
  await P.waitForTimeout(300);
  const roh = await einfuegen(P, null);
  pruefe('B1 das Einfügen erreicht die Fläche', roh.ok);
  await P.waitForTimeout(3500);
  pruefe('B2 kein unbehandelter Fehler', fehler.length === 0, fehler.join(' | '));
  const b = await stand(P);
  const neu = (b?.nodes ?? []).filter((n) => n.id !== 'n1');
  pruefe('B3 das Bild wird nicht verworfen: eine Datei-Karte entsteht', neu.length === 1 && neu[0].type === 'file', JSON.stringify(neu.map((n) => n.type)));
  pruefe('B4 … in der Geräte-Ablage, ohne Base64 im Stand', neu[0]?.data.lokal === true && !neu[0]?.data.dataUrl);
  const roher = await P.evaluate(() => localStorage.getItem('pixinotes-board') ?? '');
  pruefe('B5 der gespeicherte Stand enthält kein neues Bild als Base64', (roher.match(/data:image/g) ?? []).length === 0);
  await ctx.close();
}

console.log('════ C: Stand mit Platz — der normale Weg bleibt ════');
{
  const { ctx, P, fehler } = await seite(false);
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.keyboard.press('End');
  await einfuegen(P, '.note-editor [contenteditable="true"]');
  await P.waitForTimeout(3500);
  const b = await stand(P);
  const typen = (b?.nodes ?? []).find((n) => n.id === 'n1')?.data.blocks.map((x) => x.type) ?? [];
  pruefe('C1 mit Platz landet das Bild als Block in der Notiz', typen.includes('image'), typen.join(','));
  pruefe('C2 keine zusätzliche Karte, kein Fehler', (b?.nodes ?? []).length === 1 && fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

console.log('════ D: Meta ════');
{
  const html = readFileSync(join(__repo, 'index.html'), 'utf8');
  pruefe('D1 index.html trägt mobile-web-app-capable neben dem Apple-Meta', /name="mobile-web-app-capable"/.test(html) && /name="apple-mobile-web-app-capable"/.test(html));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
