/**
 * M507 — Design „pix·el" in den Einstellungen (LCD-Grün, Papier, Pixel-Kanten, Pixelschrift wie pix-el.de).
 *
 *   A  Einstellungen → Darstellung → Design: „pix·el" wirkt sofort (html[data-design], Papier-Grund), übersteht das
 *      Neuladen und steht in den Vorlieben; zurück auf „Klassisch" verschwindet das Attribut ganz.
 *   B  Schrift: Titel (Wortmarke, Kartentitel, Dialogtitel, Überschrift in der Notiz) in der Pixelschrift, Fließtext in
 *      der Sans; die Schrift kommt aus dem eigenen Build (kein fremder Host). In Klassisch wird sie NICHT geladen.
 *      „Besser lesbar" gewinnt auch in pix·el (Atkinson).
 *   C  Pixel-Kanten: Karten, Leisten und Fenster ohne Rundung, Schatten ohne Unschärfe (harte Pixel-Schatten); in
 *      Klassisch bleiben die Rundungen. Die Akzentfarbe ist in pix·el LCD-Grün, die gewählte bleibt gemerkt.
 *   D  Kontrast-Scan (werkzeug/kontrast-pruefen.mjs) in pix·el hell und dunkel: Notiz (mit allen Editor-Farben),
 *      Kanban, Protokoll, Tabelle, Pixi, Flüssige Schrift — ruhend, ausgewählt, im Fokus — keine Schrift unter 4,5:1.
 *   E  Fenster in pix·el hell und dunkel: Einstellungen, Hilfe, Suche, Präsentation — Schrift ≥ 4,5:1; Ränder der
 *      Bedienelemente und Fokusringe in den Einstellungen ≥ 3:1.
 *   F  Flüssige Schrift formt in pix·el die Pixelschrift; der Wechsel des Designs tastet neu ab.
 *   G  Keine Seitenfehler.
 *
 * Bilder: M507_BILDER=<ordner> legt Bildschirmfotos ab (Board, Einstellungen, Hilfe, Präsentation; hell und dunkel).
 * Klassisch unverändert: `node werkzeug/bild-vergleich.mjs <dist-vorher> dist` (siehe docs/meilensteine/M507-design-pixel.md).
 */
// Läuft aus dem Repository: `node pruefungen/m507-design-pixel.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { kontrastScan, randScan, fokusScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M507_BILDER ?? '';
if (BILDER) mkdirSync(BILDER, { recursive: true });
const PORT = 5507;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const meldung = (liste) => liste.slice(0, 4).map(trefferZeile).join(' | ');
const heute = new Date(); const iso = (n) => { const d = new Date(heute.getTime() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const absatz = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] });
const FARBEN = ['gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
const span = (text, styles = {}) => ({ type: 'text', text, styles });
const farbBloecke = () => [
  { type: 'paragraph', content: FARBEN.map((f) => span(`${f} `, { textColor: f })) },
  ...FARBEN.slice(0, 5).map((g) => ({ type: 'paragraph', content: [span(`${g}:`, { backgroundColor: g }), ...FARBEN.map((f) => span(` ${f.slice(0, 3)}`, { textColor: f, backgroundColor: g }))] })),
];
const KARTEN = [
  { id: 'n1', type: 'note', width: 340, height: 240, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 2 }, content: 'Quartal' }, absatz('Umsatz wächst weiter.'), { type: 'checkListItem', content: 'Angebot prüfen' }] } },
  { id: 'n2', type: 'note', width: 420, height: 300, data: { color: 'white', blocks: [{ type: 'heading', props: { level: 1 }, content: 'Farben' }, ...farbBloecke()] } },
  { id: 'k1', type: 'kanban', width: 440, height: 300, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }, { id: 'b', text: 'Maße nehmen', col: 1 }, { id: 'c', text: 'Rechnung', col: 2 }] } },
  { id: 'm1', type: 'minutes', width: 420, height: 440, data: { title: 'Jour fixe', entries: [{ id: 'x1', date: iso(0), attendees: 'Anna, Gerd', blocks: [{ id: 'q1', type: 'heading', props: { level: 3 }, content: 'TOP 1: Stand' }, { id: 'q2', type: 'paragraph', content: 'Alles im Plan.' }, { id: 'q3', type: 'checkListItem', props: { checked: false }, content: 'Gerd: Angebot einholen' }], decisions: [] }], current: 'x1' } },
  { id: 'r1', type: 'sheet', width: 460, height: 260, data: { title: 'Budget', cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '1200', A3: 'Strom', B3: '180', A4: 'Summe', B4: '=SUMME(B2:B3)' }, cols: 4, rows: 6 } },
  { id: 'p1', type: 'pixi', width: 192, height: 192, autoFit: false, data: {} },
  { id: 'f1', type: 'fluessig', width: 440, height: 220, autoFit: false, data: { text: 'PIXEL' } },
];
const brett = (nodes) => ({ boards: [{ id: 'b0', name: 'Büro', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board', cardFocus: false, navLinks: false, clickZoom: false });
const ALLE = () => KARTEN.map((k, i) => ({ ...k, position: { x: 40 + (i % 3) * 500, y: 40 + Math.floor(i / 3) * 480 } }));

/** Neue Seite; `design` = 'pixel' | 'klassisch' | 'ohne' (gespeicherte Vorlieben ohne Design), `lesbar` = „Besser lesbar" */
async function seite(nodes, { dunkel = false, design = 'pixel', lesbar = false, anfragen = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([s, d, des, les]) => {
    if (localStorage.getItem('pixinotes-onboarded')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...(les ? { lesbareSchrift: true } : {}),
      // 'ohne' = Vorlieben von vor M507 (ui ohne `design`) → Klassisch
      ui: { theme: d ? 'dark' : 'light', accent: 'orange', ...(des === 'ohne' ? {} : { design: des }) } }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, [brett(nodes), dunkel, design, lesbar]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  if (anfragen) P.on('request', (q) => anfragen.push(q.url()));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const foto = async (P, name) => { if (BILDER) await P.screenshot({ path: path.join(BILDER, `${name}.png`) }); };
const warteBis = async (P, fn, ms = 10000) => { const ende = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > ende) return null; await P.waitForTimeout(150); } };
const attr = (P) => P.evaluate(() => document.documentElement.dataset.design ?? null);
const grund = (P) => P.evaluate(() => getComputedStyle(document.querySelector('.react-flow')).backgroundColor);
const vorlieben = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen') || '{}').ui ?? {});
const schrift = (P, sel) => P.evaluate((sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).fontFamily : null; }, sel);

console.log('════ A: Umschalten in den Einstellungen ════');
{
  const anfragen = [];
  const { ctx, P } = await seite(ALLE(), { design: 'ohne', anfragen });
  pruefe('A Vorlieben ohne Design (von vor M507) = Klassisch (kein Attribut, kühler Grund)', (await attr(P)) === null && (await grund(P)) === 'rgb(243, 244, 246)', `${await attr(P)} ${await grund(P)}`);
  pruefe('B Klassisch lädt die Pixelschrift nicht', !anfragen.some((u) => /jersey/i.test(u)), anfragen.filter((u) => /woff/.test(u)).join(' '));
  await P.locator('[data-taste="einstellungen"]').first().click();
  await P.waitForSelector('[data-design-wahl="pixel"]');
  const swatchVorher = await P.locator('.accent-swatch').count();
  await P.locator('[data-design-wahl="pixel"]').click();
  pruefe('A pix·el wirkt sofort (Attribut, Papier-Grund)', (await warteBis(P, async () => (await attr(P)) === 'pixel' && (await grund(P)) === 'rgb(246, 247, 239)')) !== null, `${await attr(P)} ${await grund(P)}`);
  pruefe('A Knopf „pix·el" ist gedrückt', (await P.locator('[data-design-wahl="pixel"]').getAttribute('aria-pressed')) === 'true');
  pruefe('C Akzentfarbe: statt der Tupfer „LCD-Grün" (vorher 5 Tupfer)', swatchVorher === 5 && (await P.locator('.accent-swatch').count()) === 0 && (await P.locator('.akzent-pixel').count()) === 1);
  await foto(P, 'pixel-hell-einstellungen');
  const gespeichert = await warteBis(P, async () => { const v = await vorlieben(P); return v.design === 'pixel' ? v : null; });
  pruefe('A Wahl steht in den Vorlieben, Akzent bleibt gemerkt', gespeichert?.design === 'pixel' && gespeichert?.accent === 'orange', gespeichert);
  await P.keyboard.press('Escape');
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForSelector('.react-flow__node'); await P.waitForTimeout(1200);
  pruefe('A pix·el übersteht das Neuladen', (await attr(P)) === 'pixel' && (await grund(P)) === 'rgb(246, 247, 239)', `${await attr(P)} ${await grund(P)}`);
  pruefe('B pix·el lädt die Schrift aus dem eigenen Build', anfragen.some((u) => u.startsWith(`http://localhost:${PORT}/`) && /jersey/i.test(u)) && anfragen.every((u) => u.startsWith(`http://localhost:${PORT}/`) || u.startsWith('data:') || u.startsWith('blob:')),
    anfragen.filter((u) => !u.startsWith(`http://localhost:${PORT}/`)).slice(0, 3).join(' '));
  await P.locator('[data-taste="einstellungen"]').first().click();
  await P.locator('[data-design-wahl="klassisch"]').click();
  pruefe('A zurück auf Klassisch: Attribut weg, kühler Grund, Akzent Orange wieder da',
    (await warteBis(P, async () => (await attr(P)) === null && (await grund(P)) === 'rgb(243, 244, 246)')) !== null
      && (await P.evaluate(() => document.documentElement.dataset.accent)) === 'orange' && (await P.locator('.accent-swatch').count()) === 5);
  await ctx.close();
}

console.log('════ B/C: Schrift und Kanten ════');
for (const design of ['pixel', 'klassisch']) {
  const { ctx, P } = await seite(ALLE(), { design });
  const r = await P.evaluate(() => {
    const st = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e) : null; };
    const unscharf = (s) => (s && s !== 'none' ? s.split(/,(?![^(]*\))/).some((t) => { const z = t.replace(/rgba?\([^)]*\)|#[0-9a-f]+/gi, '').trim().split(/\s+/).filter((x) => /px$/.test(x)); return z.length >= 3 && parseFloat(z[2]) > 0; }) : false);
    const node = st('.react-flow__node[data-id="k1"]');
    const modalLos = st('.top-actions') ?? st('.logo');
    return {
      radius: node.borderRadius, schatten: node.boxShadow, unscharf: unscharf(node.boxShadow), leiste: unscharf(modalLos?.boxShadow ?? ''),
      logo: st('.logo')?.fontFamily, titel: st('.react-flow__node[data-id="k1"] .drag-title')?.fontFamily,
      ueberschrift: st('.react-flow__node[data-id="n1"] .bn-block-content[data-content-type="heading"]')?.fontFamily,
      text: st('.react-flow__node[data-id="n1"] .bn-block-content[data-content-type="paragraph"]')?.fontFamily,
      akzent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      geladen: [...document.fonts].some((f) => /Jersey/.test(f.family) && f.status === 'loaded'),
    };
  });
  if (design === 'pixel') {
    pruefe('B Wortmarke, Kartentitel und Notiz-Überschrift in der Pixelschrift', /PN Jersey/.test(r.logo) && /PN Jersey/.test(r.titel) && /PN Jersey/.test(r.ueberschrift), r);
    pruefe('B Fließtext bleibt in der Sans', !/Jersey/.test(r.text ?? ''), r.text);
    pruefe('B Schrift ist geladen', r.geladen);
    pruefe('C Karte eckig, Schatten ohne Unschärfe (Pixel-Rahmen + harter Versatz)', r.radius === '0px' && !r.unscharf && r.schatten.split(/,(?![^(]*\))/).length >= 5, `${r.radius} | ${r.schatten}`);
    pruefe('C Leisten ohne weiche Schatten', !r.leiste);
    pruefe('C Akzent = LCD-Grün trotz gespeicherter Akzentfarbe Orange', r.akzent === '#487318', r.akzent);
    // Dialogtitel
    await P.locator('[data-taste="einstellungen"]').first().click(); await P.waitForSelector('.modal-head h2');
    pruefe('B Dialogtitel in der Pixelschrift', /PN Jersey/.test(await schrift(P, '.modal-head h2')));
    await P.keyboard.press('Escape');
  } else {
    pruefe('C Klassisch: Karte mit Rundung (4 px), Schrift der Titel unverändert', r.radius === '4px' && !/Jersey/.test(r.logo + r.titel + r.ueberschrift), `${r.radius} ${r.logo}`);
    pruefe('B Klassisch: Pixelschrift nicht geladen', !r.geladen);
  }
  await ctx.close();
}
{
  const { ctx, P } = await seite(ALLE(), { design: 'pixel', lesbar: true });
  pruefe('B „Besser lesbar" gewinnt auch in pix·el (Atkinson in Wortmarke und Kartentitel)',
    /Atkinson/.test(await schrift(P, '.logo')) && !/Jersey/.test(await schrift(P, '.react-flow__node[data-id="k1"] .drag-title')));
  await ctx.close();
}

for (const dunkel of [false, true]) {
  const name = dunkel ? 'dunkel' : 'hell';
  console.log(`════ D: Kontrast-Scan pix·el ${name} – Kartentypen ════`);
  for (const k of KARTEN) {
    const { ctx, P } = await seite([{ ...k, position: { x: 160, y: 120 } }], { dunkel });
    const node = P.locator(`.react-flow__node[data-id="${k.id}"]`);
    await P.waitForTimeout(k.type === 'note' ? 600 : 200);
    const ruhe = await kontrastScan(P);
    const box = await node.boundingBox();
    await P.mouse.click(box.x + Math.min(150, box.width / 2), box.y + 12); await P.waitForTimeout(600);
    const auswahl = await kontrastScan(P);
    await node.evaluate((el) => el.focus()); await P.keyboard.press('Enter'); await P.waitForTimeout(1300);
    const fokus = await kontrastScan(P);
    pruefe(`D ${name} ${k.type}/${k.id}: ruhend ${ruhe.length}, ausgewählt ${auswahl.length}, Fokus ${fokus.length} Stellen unter 4,5:1`,
      !ruhe.length && !auswahl.length && !fokus.length, meldung([...ruhe, ...auswahl, ...fokus]));
    await ctx.close();
  }

  console.log(`════ E: Fenster pix·el ${name} ════`);
  const { ctx, P } = await seite(ALLE(), { dunkel });
  await P.waitForTimeout(800);
  await foto(P, `pixel-${name}-board`);
  const zu = async () => { await P.keyboard.press('Escape'); await P.waitForTimeout(350); await P.keyboard.press('Escape'); await P.waitForTimeout(300); };
  const fenster = async (titel, auf, sel = 'body', { rand = false } = {}) => {
    try { await auf(); await P.waitForTimeout(900); } catch (e) { pruefe(`E ${name} ${titel}: öffnet`, false, e.message.split('\n')[0]); return; }
    if (sel !== 'body' && !(await P.locator(sel).count())) { pruefe(`E ${name} ${titel}: öffnet`, false, `(${sel} fehlt)`); return; }
    const t = await kontrastScan(P, sel);
    pruefe(`E ${name} ${titel}: keine Schrift unter 4,5:1`, t.length === 0, meldung(t));
    if (rand) {
      const r = (await randScan(P, sel, { alle: true }));
      pruefe(`E ${name} ${titel}: ${r.length} Bedienelemente, Ränder ≥ 3:1`, r.length > 0 && !r.some((x) => x.v < 3), meldung(r.filter((x) => x.v < 3)));
      const f = await fokusScan(P, sel, { schritte: 18, alle: true });
      pruefe(`E ${name} ${titel}: ${f.length} Fokusringe ≥ 3:1`, f.length > 0 && !f.some((x) => x.v < 3), f.filter((x) => x.v < 3).slice(0, 4).map((x) => `${x.v} „${x.text}" ${x.pfad}`).join(' | '));
    }
    await foto(P, `pixel-${name}-${titel.toLowerCase()}`);
    await zu();
  };
  await fenster('Board', async () => {});
  await fenster('Einstellungen', () => P.locator('[data-taste="einstellungen"]').first().click(), '.modal', { rand: true });
  await fenster('Hilfe', () => P.locator('[data-taste="hilfe"]').first().click(), '.help-modal');
  await fenster('Suche', async () => { await P.mouse.click(1400, 940); await P.keyboard.press('Control+k'); await P.waitForTimeout(300); await P.keyboard.type('Angebot'); }, '.search-box');
  await fenster('Kontextmenü', () => P.mouse.click(1400, 940, { button: 'right' }));
  await fenster('Präsentation', async () => { await P.mouse.click(1400, 940); await P.keyboard.press('Alt+p'); await P.waitForSelector('.presenter', { timeout: 8000 }); }, '.presenter');
  await ctx.close();
}

console.log('════ F: Flüssige Schrift ════');
{
  const { ctx, P } = await seite([{ ...KARTEN.find((k) => k.id === 'f1'), position: { x: 200, y: 160 } }], { design: 'klassisch' });
  const canvasSchrift = () => P.evaluate(() => { const c = document.querySelector('.fluessig-card canvas'); return c ? getComputedStyle(c).fontFamily : ''; });
  const bildPunkte = () => P.evaluate(() => { const c = document.querySelector('.fluessig-card canvas'); return c ? c.toDataURL().length : 0; });
  await warteBis(P, async () => (await bildPunkte()) > 2000);
  const vorher = await bildPunkte();
  pruefe('F Klassisch: Flüssigkeit in der Serife', !/Jersey/.test(await canvasSchrift()));
  await P.locator('[data-taste="einstellungen"]').first().click(); await P.locator('[data-design-wahl="pixel"]').click(); await P.keyboard.press('Escape');
  pruefe('F pix·el: Flüssigkeit formt die Pixelschrift', /PN Jersey/.test(await canvasSchrift()));
  const anders = await warteBis(P, async () => { const n = await bildPunkte(); return Math.abs(n - vorher) > 200 ? n : null; }, 12000);
  pruefe('F der Wechsel tastet neu ab (das Bild der Flüssigkeit ändert sich)', anders !== null, `${vorher}`);
  await foto(P, 'pixel-hell-fluessig');
  await ctx.close();
}

console.log('════ G: Seitenfehler ════');
pruefe('G keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));

await browser.close(); app.close();
console.log(`\nM507: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
