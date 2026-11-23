/**
 * M416 — Schrift: eine elegante, zeitlose Serife für Überschriften, eine klare Sans für alles andere.
 *
 * Gemeldet: „Was mir an Matthias' Tool gefällt, ist auch die Schriftkombination einer sehr schönen, eleganten, zeitlosen
 * Serifenschrift mit einer klaren Sans-Schrift … kannst du das auch als Grundidee für unser komplettes Tool übernehmen?"
 *
 * M420: „Die Serifenschrift ist schon gut, könnte aber noch zeitloser, moderner, schicker, wertiger sein. Momentan
 * empfinde ich die Kombination etwas unrund/unruhig." → Newsreader (optische Größen) statt Playfair Display, Geist
 * statt Manrope; die Serife steht nur noch an großen Stellen, Kartentitel tragen die Sans.
 *
 *   A  Geist für Bedienung und Text (auch in Notizen und Kartentiteln), Newsreader für Wortmarke, Dialog- und
 *      Folientitel und große Überschriften.
 *   B  Beide liegen beim Tool – keine Anfrage an einen Schriften-Dienst; die Lizenzen liegen bei.
 *   C  Einstellungen: Abschnitte als kleine, gesperrte Versalien; der Dialogtitel in der Serife.
 *   D  „Besser lesbar" setzt weiter überall Atkinson Hyperlegible – auch Titel und Überschriften.
 */
// Läuft aus dem Repository: `node pruefungen/m416-schrift.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4747;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const note = { id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 340, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 1 }, content: 'Messekonzept' }, { type: 'paragraph', content: 'Ein ruhiger Auftritt.' }] } };
const kan = { id: 'k1', type: 'kanban', position: { x: 400, y: 0 }, width: 340, height: 260, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }] } };
const auf = async (lesbar = false) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1400, height: 900 } });
  const fremd = [];
  ctx.on('request', (q) => { if (!q.url().startsWith(`http://localhost:${PORT}`) && !q.url().startsWith('data:') && !q.url().startsWith('blob:')) fremd.push(q.url()); });
  await ctx.addInitScript(([ns, lb]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    if (lb) localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ lesbareSchrift: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'Test', edges: [], drawings: [], nodes: ns }], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board' } }));
  }, [[note, kan], lesbar]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2500);
  return { ctx, P, fremd };
};
const familie = (P, sel) => P.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontFamily : null; }, sel);

console.log('A  Zwei Schriften');
const { ctx, P, fremd } = await auf();
const a = await P.evaluate(async () => {
  await document.fonts.ready;
  const geladen = [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))];
  return { geladen, check: document.fonts.check('16px "PN Geist"') && document.fonts.check('16px "Newsreader Variable"') };
});
pruefe('A1 Geist und Newsreader sind geladen – Manrope und Playfair Display nicht mehr', a.geladen.includes('PN Geist') && a.geladen.includes('Newsreader Variable') && a.check && !a.geladen.some((f) => /Manrope|Playfair/.test(f)), a);
pruefe('A2 die Oberfläche setzt Geist', /^"?PN Geist/.test(await familie(P, 'body')) && /Geist/.test(await familie(P, '.dock button')), await familie(P, 'body'));
pruefe('A3 auch der Text in Notizen', /Geist/.test(await familie(P, ".react-flow__node-note .bn-block-content[data-content-type='paragraph'] .bn-inline-content")), await familie(P, ".react-flow__node-note .bn-block-content[data-content-type='paragraph'] .bn-inline-content"));
pruefe('A4 die Wortmarke in der Serife', /^"?Newsreader Variable/.test(await familie(P, '.logo')), await familie(P, '.logo'));
pruefe('A5 (M420) Kartentitel in der Sans – viele kleine Serifentitel machten das Board unruhig', /^"?PN Geist/.test(await familie(P, '.react-flow__node-kanban .drag-title')), await familie(P, '.react-flow__node-kanban .drag-title'));
// M462: BlockNote 0.57 schreibt data-level bei Stufe 1 nicht mehr
pruefe('A6 die große Überschrift einer Notiz in der Serife, der Fließtext nicht', /Newsreader/.test(await familie(P, ".bn-block-content[data-content-type='heading']:is([data-level='1'], :not([data-level]))")) && !/Newsreader/.test(await familie(P, ".bn-block-content[data-content-type='paragraph']")));
const opt = await P.evaluate(() => { const l = document.querySelector('.logo'); const r = document.createRange(); r.selectNodeContents(document.querySelector(".react-flow__node-note .bn-block-content[data-content-type='paragraph'] .bn-inline-content")); const t = r.getBoundingClientRect(); const n = document.querySelector(".react-flow__node-note .bn-block-content[data-content-type='paragraph'] .bn-inline-content").textContent.length; return { opsz: getComputedStyle(l).fontOpticalSizing, zeichen: t.width / n, kursiv: [...document.fonts].some((f) => /PN Geist/.test(f.family) && f.style === 'italic') }; });
pruefe('A7 (M420) optische Größen an, echte Kursive vorhanden', opt.opsz === 'auto' && opt.kursiv, opt);

console.log('B  Beim Tool');
pruefe('B1 keine Anfrage an einen Schriften-Dienst (oder sonst nach außen)', fremd.length === 0, fremd.slice(0, 3).join(' | '));
const lizenz = await P.evaluate(async () => (await fetch('lizenzen/schriften.txt')).text());
pruefe('B2 die Lizenzen liegen bei (SIL Open Font License: Geist, Newsreader, Atkinson)', /Geist Project Authors/.test(lizenz) && /Newsreader Project Authors/.test(lizenz) && /Braille Institute/.test(lizenz) && /SIL Open Font License/.test(lizenz) && !/Manrope|Playfair/.test(lizenz));

console.log('C  Einstellungen');
await P.keyboard.press('Control+,'); await P.waitForTimeout(800);
if (!(await P.locator('.modal-head').count())) { await P.locator('[aria-label*="Einstellungen"]').first().click(); await P.waitForTimeout(800); }
const c = await P.evaluate(() => {
  const h2 = document.querySelector('.modal-head h2'); const h3 = document.querySelector('.modal-section h3');
  return { titel: h2 && getComputedStyle(h2).fontFamily, abschnitt: h3 && { t: getComputedStyle(h3).textTransform, ls: parseFloat(getComputedStyle(h3).letterSpacing), fs: parseFloat(getComputedStyle(h3).fontSize) } };
});
pruefe('C1 der Dialogtitel in der Serife', /Newsreader/.test(c.titel ?? ''), c);
pruefe('C2 Abschnitte als kleine, gesperrte Versalien', c.abschnitt?.t === 'uppercase' && c.abschnitt.ls > 0.5 && c.abschnitt.fs <= 12, c);
await ctx.close();

console.log('D  Besser lesbar');
{
  const { ctx: c2, P: Q } = await auf(true);
  const d = { body: await familie(Q, 'body'), logo: await familie(Q, '.logo'), titel: await familie(Q, '.react-flow__node-kanban .drag-title'), h1: await familie(Q, ".bn-block-content[data-content-type='heading']") };
  pruefe('D1 „Besser lesbar": überall Atkinson Hyperlegible – auch Wortmarke, Titel, Überschriften', Object.values(d).every((f) => /Atkinson/.test(f ?? '')), d);
  await c2.close();
}

{
  const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
  pruefe('E1 Hilfe nennt M420 – deutsch und englisch; docs/UMBAU.md führt M420', quelle('src/components/HelpOverlay.tsx').includes('(M420)') && quelle('src/components/HelpOverlayEn.tsx').includes('(M420)') && quelle('docs/UMBAU.md').includes('M420'));
}
pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM416: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
