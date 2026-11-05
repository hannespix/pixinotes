/**
 * M320 — Handschrift → Text.
 *
 *   A  Browser-Erkennung: Mit der Handwriting Recognition API (hier nachgestellt)
 *      erscheint nach dem Schreiben in der Palette „Text"; ein Klick erkennt die
 *      Striche, legt an ihrer Stelle eine Notiz mit dem Text an und entfernt
 *      die Striche; ↶ holt die Striche zurück.
 *   B  Ohne Browser-Erkennung und ohne Opt-in: Klartext-Hinweis, nichts geht
 *      außer Haus (kein Aufruf an inputtools.google.com), Striche bleiben.
 *   C  Opt-in unter ⚙ → Dienste → Handschrift: der Schalter ist standardmäßig
 *      aus, bleibt über das Neuladen erhalten; dann läuft die Erkennung online
 *      (Anfrage nachgestellt) mit Schreibfeld-Maßen und Tinten-Spuren.
 *   D  „Was ist neu" und die Hilfe nennen M320.
 */
// Läuft aus dem Repository: `node pruefungen/m320-handschrift.mjs`
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
const PORT = 4542;
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

const stand = {
  boards: [{ id: 'b1', name: 'Skizze', edges: [], drawings: [], comments: [], nodes: [{ id: 'n1', type: 'note', width: 220, position: { x: -600, y: -400 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Ecke' }] } }] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
/** Nachgestellte Handwriting Recognition API — liefert, was `antwort` sagt, und protokolliert, was sie bekam */
const FAKE_HW = ({ antwort }) => {
  window.__hw = { aufrufe: 0, striche: 0, punkte: 0, hints: null, sprachen: null };
  window.HandwritingStroke = class { constructor() { this.p = []; } addPoint(p) { this.p.push(p); } };
  navigator.createHandwritingRecognizer = async ({ languages }) => {
    window.__hw.sprachen = languages;
    return {
      startDrawing(hints) {
        window.__hw.hints = hints;
        const st = [];
        return {
          addStroke(s) { st.push(s); },
          async getPrediction() {
            window.__hw.aufrufe += 1; window.__hw.striche = st.length; window.__hw.punkte = st.reduce((a, s) => a + s.p.length, 0);
            window.__hw.min = Math.min(...st.flatMap((s) => s.p.map((q) => Math.min(q.x, q.y))));
            return antwort.map((text) => ({ text }));
          },
        };
      },
      finish() { window.__hw.fertig = true; },
    };
  };
};
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript(({ st, online }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...(online ? { handschriftOnline: true } : {}) }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, online: !!opt.online });
  if (opt.hw) await ctx.addInitScript(FAKE_HW, { antwort: opt.hw });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const werkzeug = async (P, name) => {
  await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu-draw button', { hasText: name }).click(); await P.waitForTimeout(250);
};
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7;
  const mk = (typ, [x, y, p], extra = {}) => new PointerEvent(typ, {
    bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: o.art ?? 'mouse',
    isPrimary: true, clientX: x, clientY: y, pressure: p ?? 0.5, buttons: 1, button: 0, ...extra,
  });
  const ziel = (x, y) => document.elementFromPoint(x, y) ?? document.body;
  const start = ziel(punkte[0][0], punkte[0][1]);
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  for (const pt of punkte.slice(1)) { start.dispatchEvent(mk('pointermove', pt)); await new Promise((r) => setTimeout(r, 8)); }
  start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0 }));
}, { punkte, o });
const striche = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []);
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const warte = (P, ms = 900) => P.waitForTimeout(ms);
/** Drei „Buchstaben": Wellenlinien nebeneinander — bewusst krumm, damit keine Form einrastet */
const schreiben = async (P, x0 = 600, y0 = 450) => {
  for (let k = 0; k < 3; k += 1) {
    await zug(P, Array.from({ length: 18 }, (_, i) => [x0 + k * 70 + i * 3, y0 + Math.sin(i / 1.7) * 22 + (i % 3) * 4]), { art: 'pen', id: 11 + k });
    await P.waitForTimeout(150);
  }
  await warte(P, 700);
};

// ══ A: Browser-Erkennung ════════════════════════════════════════════
console.log('\n════ A: Browser erkennt selbst ════');
{
  const { ctx, P } = await seite({ hw: ['Hallo Welt', 'Hallo Wett'] });
  await werkzeug(P, 'Stift');
  pruefe('A1 vor dem Schreiben kein „Text"-Knopf in der Palette', (await P.locator('.draw-palette .draw-text').count()) === 0);
  await schreiben(P);
  const vorher = await striche(P);
  pruefe('A2 drei Stift-Striche gespeichert', vorher.length === 3 && vorher.every((s) => s.tool === 'pen'), String(vorher.length));
  const knopf = P.locator('.draw-palette .draw-text');
  pruefe('A3 nach dem Schreiben steht „Text" in der Palette (mit Erklärung)', (await knopf.count()) === 1 && (await knopf.getAttribute('aria-label')) === 'Handschrift in Text umwandeln' && /Text/.test(await knopf.textContent()));
  await P.screenshot({ path: path.join(SD, 'm320-palette.png') });
  await knopf.click();
  await warte(P, 1200);
  const hw = await P.evaluate(() => window.__hw);
  pruefe('A4 der Browser-Erkenner bekam alle drei Striche mit allen Punkten (Deutsch, Text, Stift)', hw.aufrufe === 1 && hw.striche === 3 && hw.punkte === vorher.reduce((a, s) => a + s.points.length, 0) && hw.sprachen?.[0] === 'de' && hw.hints?.recognitionType === 'text' && hw.hints?.inputType === 'pen', JSON.stringify(hw));
  pruefe('A5 Striche normiert: kleine positive Koordinaten (Rand 10)', hw.min >= 9 && hw.min <= 11, String(hw.min));
  const nachher = await striche(P);
  const n = await knoten(P);
  const neu = n.find((k) => k.id !== 'n1');
  pruefe('A6 die Striche sind weg, an ihrer Stelle eine weiße Notiz mit dem erkannten Text', nachher.length === 0 && !!neu && neu.type === 'note' && neu.data.color === 'white' && JSON.stringify(neu.data.blocks).includes('Hallo Welt'), JSON.stringify({ striche: nachher.length, neu: neu?.data }));
  // Lage: Notiz dort, wo geschrieben wurde (links oben der Striche)
  // Geankerte Striche liegen relativ zur Karte — Versatz dazurechnen
  const anker = Object.fromEntries((await knoten(P)).map((k) => [k.id, k.position]));
  const abs = (s) => s.points.map((p) => [p[0] + (s.anchor ? anker[s.anchor]?.x ?? 0 : 0), p[1] + (s.anchor ? anker[s.anchor]?.y ?? 0 : 0)]);
  const minX = Math.min(...vorher.flatMap((s) => abs(s).map((p) => p[0])));
  const minY = Math.min(...vorher.flatMap((s) => abs(s).map((p) => p[1])));
  pruefe('A7 Notiz sitzt an der linken oberen Ecke des Geschriebenen', !!neu && Math.abs(neu.position.x - minX) < 2 && Math.abs(neu.position.y - minY) < 2, JSON.stringify({ pos: neu?.position, minX, minY }));
  pruefe('A8 Toast nennt den übernommenen Text', /Handschrift übernommen/.test(await toast(P)) && /Hallo Welt/.test(await toast(P)), await toast(P));
  pruefe('A9 der „Text"-Knopf ist danach wieder weg (nichts Ungelesenes mehr)', (await P.locator('.draw-palette .draw-text').count()) === 0);
  await P.screenshot({ path: path.join(SD, 'm320-notiz.png') });
  // Rückgängig: Striche wieder da, Notiz weg
  await P.locator('[data-taste="rueckgaengig"]').click(); await warte(P, 300);
  await P.locator('[data-taste="rueckgaengig"]').click(); await warte(P, 500);
  const zurueck = await striche(P);
  const n2 = await knoten(P);
  pruefe('A10 ↶ ↶ holt die drei Striche zurück und nimmt die Notiz weg', zurueck.length === 3 && n2.length === 1, JSON.stringify({ s: zurueck.length, n: n2.length }));
  await ctx.close();
}

// ══ B: Weder Browser noch Opt-in ════════════════════════════════════
console.log('\n════ B: Kein Weg offen → Hinweis, nichts geht außer Haus ════');
{
  const { ctx, P } = await seite();
  let online = 0;
  await ctx.route('https://inputtools.google.com/**', (route) => { online += 1; route.fulfill({ status: 200, contentType: 'application/json', body: '["SUCCESS",[["",["x"]]]]' }); });
  const api = await P.evaluate(() => typeof navigator.createHandwritingRecognizer);
  pruefe('B1 Testbrowser hat die Handwriting-API nicht (Ausgangslage)', api === 'undefined', api);
  await werkzeug(P, 'Stift');
  await schreiben(P);
  const knopf = P.locator('.draw-palette .draw-text');
  pruefe('B2 „Text" steht trotzdem in der Palette (der Hinweis erklärt den Weg)', (await knopf.count()) === 1);
  await knopf.click();
  await warte(P, 1000);
  const t = await toast(P);
  pruefe('B3 Klartext-Hinweis nennt den Schalter ⚙ → Dienste → Handschrift', /erkennt Handschrift nicht selbst/.test(t) && /Dienste/.test(t) && /Handschrift/.test(t), t);
  pruefe('B4 kein Aufruf nach außen ohne Opt-in', online === 0, String(online));
  pruefe('B5 die Striche bleiben erhalten', (await striche(P)).length === 3);
  pruefe('B6 keine Notiz entstanden', (await knoten(P)).length === 1);
  await ctx.close();
}

// ══ C: Opt-in und Online-Erkennung ══════════════════════════════════
console.log('\n════ C: Schalter in den Diensten, Online-Weg ════');
{
  const { ctx, P } = await seite();
  await P.locator('[data-taste="einstellungen"]').click(); await warte(P, 300);
  await P.locator('.modal-tabs button', { hasText: 'Dienste' }).click(); await warte(P, 300);
  const schalter = P.locator('[data-taste="handschrift-online"]');
  pruefe('C1 Dienste zeigen den Abschnitt Handschrift mit Schalter, standardmäßig aus', (await schalter.count()) === 1 && !(await schalter.isChecked()) && (await P.locator('.modal h3', { hasText: 'Handschrift' }).count()) === 1);
  const erkl = await P.locator('.modal h3', { hasText: 'Handschrift' }).locator('xpath=..').textContent();
  pruefe('C2 der Text sagt ehrlich, dass Striche dann außer Haus gehen und nennt Scribble am iPad', /außer Haus/.test(erkl) && /Scribble/.test(erkl), erkl.slice(0, 160));
  await schalter.check(); await warte(P, 300);
  const gespeichert = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen')).handschriftOnline);
  pruefe('C3 der Schalter landet in den Geräte-Einstellungen', gespeichert === true, String(gespeichert));
  await P.locator('.modal').screenshot({ path: path.join(SD, 'm320-dienste.png') });
  await P.reload({ waitUntil: 'networkidle' }); await warte(P, 1200);
  await P.locator('[data-taste="einstellungen"]').click(); await warte(P, 300);
  await P.locator('.modal-tabs button', { hasText: 'Dienste' }).click(); await warte(P, 300);
  pruefe('C4 nach dem Neuladen ist der Schalter noch an', await P.locator('[data-taste="handschrift-online"]').isChecked());
  await P.keyboard.press('Escape'); await warte(P, 300);
  await ctx.close();
}
{
  const { ctx, P } = await seite({ online: true });
  const anfragen = [];
  await ctx.route('https://inputtools.google.com/**', (route) => {
    anfragen.push({ url: route.request().url(), body: JSON.parse(route.request().postData()) });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(['SUCCESS', [['', ['Einkaufen', 'Einkaufer'], [], { is_html_escaped: false }]]]) });
  });
  await werkzeug(P, 'Stift');
  await schreiben(P, 700, 500);
  const vorher = await striche(P);
  await P.locator('.draw-palette .draw-text').click();
  await warte(P, 1200);
  pruefe('C5 mit Opt-in geht genau eine Anfrage an den Handschrift-Dienst (Deutsch)', anfragen.length === 1 && /itc=de-t-i0-handwrit/.test(anfragen[0]?.url ?? ''), JSON.stringify(anfragen.map((a) => a.url)));
  const req = anfragen[0]?.body?.requests?.[0];
  pruefe('C6 Anfrage trägt Schreibfeld-Maße und drei Tinten-Spuren [x[],y[],t[]]', !!req && req.writing_guide?.writing_area_width > 100 && req.writing_guide?.writing_area_height > 30 && req.ink?.length === 3 && req.ink.every((s) => s.length === 3 && s[0].length === s[1].length && s[1].length === s[2].length) && req.language === 'de', JSON.stringify({ wg: req?.writing_guide, ink: req?.ink?.map((s) => s[0].length) }));
  const n = await knoten(P);
  const neu = n.find((k) => k.id !== 'n1');
  pruefe('C7 das Ergebnis wird zur Notiz, die Striche verschwinden', (await striche(P)).length === 0 && !!neu && JSON.stringify(neu.data.blocks).includes('Einkaufen') && vorher.length === 3, JSON.stringify(neu?.data));
  // Fehlerfall: Dienst nicht erreichbar → Klartext, Striche bleiben
  await ctx.unroute('https://inputtools.google.com/**');
  await ctx.route('https://inputtools.google.com/**', (route) => route.fulfill({ status: 503, body: 'nope' }));
  await schreiben(P, 700, 650);
  await P.locator('.draw-palette .draw-text').click();
  await warte(P, 1200);
  const t = await toast(P);
  pruefe('C8 Dienst antwortet 503 → Klartext mit HTTP-Status, Striche bleiben', /nicht erreichbar/.test(t) && /503/.test(t) && (await striche(P)).length === 3, t);
  await ctx.close();
}

// ══ D: Hilfe ════════════════════════════════════════════════════════
console.log('\n════ D: Hilfe & Was ist neu ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('D1 „Was ist neu" nennt „Handschrift wird Text (M320)" und Scribble', js.includes('Handschrift wird Text (M320)') && js.includes('Scribble'));
  pruefe('D2 die Hilfe erklärt Handschrift → Text mit dem „Text"-Knopf', js.includes('Handschrift → Text:'));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
