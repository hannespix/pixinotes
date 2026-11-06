/**
 * M324 — Stift & Handschrift 2.
 *
 *   A  Vorschlag nach der Schreibpause: Schrift ins Leere → Chip mit dem
 *      erkannten Text; ein Tipp macht eine neue Notiz an Ort und Stelle.
 *   B  Ziel-Logik: Schrift über einer Notiz landet IN dieser Notiz — neben
 *      einem Listenpunkt als Listenpunkt, direkt dahinter; unterhalb ans Ende.
 *   C  KI-Korrektur mit Kontext (Gratis-KI nachgestellt): die Anfrage trägt
 *      Notiz-Text und Lesarten, der übernommene Text ist der korrigierte.
 *   D  Durchstreichen löscht den Strich darunter (der Kritzel selbst bleibt nicht).
 *   E  Umkreisen markiert die Karte und wechselt in die Auswahl.
 *   F  Formen rasten schneller ein (320 ms statt 550).
 *   G  Strichstärke in der Palette.
 *   H  Schalter unter Dienste: Vorschlag aus → kein Chip; KI-Schalter nur mit KI.
 *   I  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m324-stift2.mjs`
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
const PORT = 4546;
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

const stand = (opt = {}) => ({
  boards: [{ id: 'b1', name: 'Projekt Küche', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 300, height: 170, position: { x: -600, y: -400 }, data: { color: 'yellow', blocks: [
      { id: 'b-titel', type: 'paragraph', content: 'Einkauf Wochenende' },
      { id: 'b-milch', type: 'checkListItem', props: { checked: true }, content: 'Milch' },
      { id: 'b-brot', type: 'checkListItem', content: 'Brot' },
      { id: 'b-butter', type: 'checkListItem', content: 'Butter' },
    ] } },
    { id: 'n2', type: 'note', width: 240, position: { x: -150, y: -400 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Kurze Idee' }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
  ...(opt.ki ? { ai: { provider: 'free', model: 'openai', apiKey: '', baseUrl: '' } } : {}),
});
/** Nachgestellte Handwriting Recognition API: liefert `antwort` (Lesarten) */
const FAKE_HW = ({ antwort }) => {
  window.__hw = { aufrufe: 0 };
  window.HandwritingStroke = class { constructor() { this.p = []; } addPoint(p) { this.p.push(p); } };
  navigator.createHandwritingRecognizer = async () => ({
    startDrawing() { const st = []; return { addStroke(s) { st.push(s); }, async getPrediction() { window.__hw.aufrufe += 1; return antwort.map((text) => ({ text })); } }; },
    finish() {},
  });
};
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript(({ st, auto }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true, ...(auto === false ? { handschriftAuto: false } : {}) }));
    localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand(opt), auto: opt.auto });
  await ctx.addInitScript(FAKE_HW, { antwort: opt.hw ?? ['hallo welt', 'hallo wett'] });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1600);
  return { ctx, P };
}
const werkzeug = async (P, name) => {
  await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu-draw button', { hasText: name }).click(); await P.waitForTimeout(250);
};
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7;
  const mk = (typ, [x, y, p], extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: o.art ?? 'pen', isPrimary: true, clientX: x, clientY: y, pressure: p ?? 0.5, buttons: 1, button: 0, ...extra });
  const start = document.elementFromPoint(punkte[0][0], punkte[0][1]) ?? document.body;
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  for (const pt of punkte.slice(1)) { start.dispatchEvent(mk('pointermove', pt)); await new Promise((r) => setTimeout(r, o.takt ?? 8)); }
  if (o.halten) await new Promise((r) => setTimeout(r, o.halten));
  if (!o.offen) start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0 }));
  return start.className?.baseVal ?? start.className;
}, { punkte, o });
const striche = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []);
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const warte = (P, ms = 600) => P.waitForTimeout(ms);
const welle = (x0, y0, n = 18, amp = 14) => Array.from({ length: n }, (_, i) => [x0 + i * 3, y0 + Math.sin(i / 1.7) * amp + (i % 3) * 2]);
/** Drei „Wörter" nebeneinander bei (x0,y0) */
const schreiben = async (P, x0, y0, amp = 14) => {
  for (let k = 0; k < 3; k += 1) { await zug(P, welle(x0 + k * 60, y0, 18, amp), { id: 11 + k }); await P.waitForTimeout(120); }
};
const chipText = async (P) => {
  const c = P.locator('.schrift-vorschlag .vorschlag-text');
  return (await c.count()) ? (await c.first().textContent()).replace(/^✍️…?/, '').trim() : null;
};
const texte = (bs) => bs.map((b) => [b.type, Array.isArray(b.content) ? b.content.map((c) => c.text).join('') : (b.content ?? '')]);

// ══ A: Vorschlag, Schrift ins Leere ═════════════════════════════════
console.log('\n════ A: Vorschlag nach Schreibpause — neue Notiz ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  await schreiben(P, 900, 650);
  await warte(P, 300);
  pruefe('A1 direkt nach dem Schreiben noch kein fertiger Vorschlag (Ruhe abwarten)', (await P.locator('.schrift-vorschlag .vorschlag-text:not(.erkennt)').count()) === 0);
  await warte(P, 1400);
  const t = await chipText(P);
  pruefe('A2 nach der Pause steht der erkannte Text als Vorschlag (Satzanfang groß)', t === 'Hallo welt', String(t));
  const box = await P.locator('.schrift-vorschlag').boundingBox();
  pruefe('A3 der Vorschlag sitzt unter dem Geschriebenen', !!box && box.x > 850 && box.x < 980 && box.y > 650 && box.y < 760, JSON.stringify(box));
  await P.screenshot({ path: path.join(SD, 'm324-vorschlag.png') });
  const vorher = (await knoten(P)).length;
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  const n = await knoten(P);
  const neu = n.find((k) => !['n1', 'n2'].includes(k.id));
  pruefe('A4 ein Tipp macht eine neue Notiz mit dem Text, die Striche sind weg', n.length === vorher + 1 && !!neu && texte(neu.data.blocks)[0][1] === 'Hallo welt' && (await striche(P)).length === 0, JSON.stringify(texte(neu?.data.blocks ?? [])));
  pruefe('A5 der Chip verschwindet nach dem Übernehmen', (await P.locator('.schrift-vorschlag').count()) === 0);
  pruefe('A6 Hinweis „Neue Notiz"', /Neue Notiz/.test(await toast(P)), await toast(P));
  // Weiterschreiben setzt den Vorschlag zurück
  await schreiben(P, 900, 560);
  await warte(P, 200);
  await zug(P, welle(1100, 560), { id: 21 });
  await warte(P, 1400);
  pruefe('A7 nach weiteren Strichen kommt ein neuer Vorschlag (eine Erkennung je Pause)', (await chipText(P)) === 'Hallo welt' && (await P.evaluate(() => window.__hw.aufrufe)) >= 2);
  await P.keyboard.press('Escape'); await warte(P, 600);
  pruefe('A8 Esc blendet den Vorschlag aus, die Striche bleiben, der Zeichenmodus auch', (await P.locator('.schrift-vorschlag').count()) === 0 && (await striche(P)).length === 4 && (await P.locator('.draw-palette').count()) === 1, JSON.stringify({ chip: await P.locator('.schrift-vorschlag').count(), striche: (await striche(P)).length, palette: await P.locator('.draw-palette').count() }));
  await ctx.close();
}

// ══ B: Ziel-Logik — in die Notiz ════════════════════════════════════
console.log('\n════ B: Schrift über einer Notiz landet in der Notiz ════');
{
  const { ctx, P } = await seite({ hw: ['Käse', 'Kase'] });
  await werkzeug(P, 'Stift');
  // Neben „Brot" schreiben (rechts im selben Block)
  const brot = await P.locator('.react-flow__node[data-id="n1"] [data-content-type="checkListItem"]').nth(1).boundingBox();
  const x0 = brot.x + brot.width * 0.55, y0 = brot.y + brot.height / 2;
  await zug(P, welle(x0, y0, 16, 5), { id: 31 }); await warte(P, 100);
  await zug(P, welle(x0 + 50, y0, 16, 5), { id: 32 });
  await warte(P, 1600);
  // M327: neben einem Kästchen-Punkt trägt der Vorschlag den Vorsatz „☐" (Kontext der Notiz)
  pruefe('B1 Vorschlag erscheint auch über der Notiz (M327: als Kästchen-Punkt)', (await chipText(P)) === '☐ Käse', String(await chipText(P)));
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 1000);
  const n1 = (await knoten(P)).find((k) => k.id === 'n1');
  const tx = texte(n1.data.blocks);
  const idx = tx.findIndex((t) => t[1] === 'Käse');
  // M325: Schrift in derselben Zeile wird INLINE eingefügt („Brot Käse"), kein eigener Punkt mehr
  pruefe('B2 „Käse" steht in der Zeile hinter „Brot" (inline, M325)', idx === -1 && tx[2][1] === 'Brot Käse' && tx[2][0] === 'checkListItem' && tx[3][1] === 'Butter', JSON.stringify(tx));
  pruefe('B3 keine neue Karte, Striche weg, extEpoch hochgezählt', (await knoten(P)).length === 2 && (await striche(P)).length === 0 && typeof n1.data.extEpoch === 'number');
  const imEditor = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="n1"] [data-content-type="checkListItem"]')].map((e) => e.textContent.trim()));
  pruefe('B4 der offene Editor zeigt die Einfügung', imEditor.join(',') === 'Milch,Brot Käse,Butter', imEditor.join(','));
  pruefe('B5 Hinweis nennt die Zielnotiz', /In „Einkauf Wochenende" eingefügt/.test(await toast(P)), await toast(P));
  // Unterhalb des Textes, im leeren Bereich der Notiz → ans Ende
  const karte = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
  await ctx.route('**/*', (r) => r.continue()); // (kein Netz nötig — nur Platzhalter)
  await P.evaluate(() => { navigator.createHandwritingRecognizer = async () => ({ startDrawing() { return { addStroke() {}, async getPrediction() { return [{ text: 'noch Eier' }]; } }; }, finish() {} }); });
  await schreiben(P, karte.x + 20, karte.y + karte.height - 22, 6);
  await warte(P, 1600);
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 1000);
  const n1b = (await knoten(P)).find((k) => k.id === 'n1');
  const tb = texte(n1b.data.blocks);
  // BlockNote hält am Ende einen leeren Absatz bereit — der letzte Block MIT Text zählt
  const letzterText = [...tb].reverse().find((t) => t[1])?.[1];
  pruefe('B6 Schrift im leeren Bereich der Notiz hängt sich ans Ende', letzterText === 'Noch Eier' && tb.filter((t) => t[1]).length === 5, JSON.stringify(tb));
  await P.screenshot({ path: path.join(SD, 'm324-in-notiz.png') });
  await ctx.close();
}

// ══ C: KI-Korrektur mit Kontext ═════════════════════════════════════
console.log('\n════ C: KI korrigiert mit Kontext ════');
{
  const { ctx, P } = await seite({ ki: true, hw: ['Butler kaufen', 'Butter kaufen'] });
  const anfragen = [];
  await ctx.route('https://text.pollinations.ai/openai', (route) => {
    anfragen.push(JSON.parse(route.request().postData()));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Butter kaufen' } }] }) });
  });
  await werkzeug(P, 'Stift');
  const karte = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
  await schreiben(P, karte.x + 20, karte.y + karte.height - 22, 6);
  await warte(P, 2000);
  const t = await chipText(P);
  pruefe('C1 der Vorschlag zeigt den KI-korrigierten Text', t === 'Butter kaufen', String(t));
  const inhalt = anfragen[0]?.messages?.[0]?.content;
  const prompt = typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt);
  pruefe('C2 die KI-Anfrage trägt Notiz-Kontext, Board-Name und die Lesarten', anfragen.length === 1 && /Einkauf Wochenende/.test(prompt) && /Projekt Küche/.test(prompt) && /Butter kaufen/.test(prompt) && /nichts weglassen/i.test(prompt), prompt.slice(0, 200));
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  const n1 = (await knoten(P)).find((k) => k.id === 'n1');
  pruefe('C3 übernommen wird der korrigierte Text', texte(n1.data.blocks).some((x) => x[1] === 'Butter kaufen'));
  pruefe('C4 die zweite Erkennung ruft die KI nicht erneut für den schon übernommenen Text', anfragen.length === 1, String(anfragen.length));
  await ctx.close();
}

// ══ D: Durchstreichen ═══════════════════════════════════════════════
console.log('\n════ D: Durchstreichen löscht ════');
{
  const { ctx, P } = await seite({ auto: false });
  await werkzeug(P, 'Stift');
  await zug(P, welle(900, 650, 24, 12), { id: 41 }); await warte(P, 400);
  pruefe('D1 ein Strich liegt da', (await striche(P)).length === 1);
  // Kritzel quer über den Strich: 7 Bahnen hin und her
  const kritzel = [];
  for (let b = 0; b < 7; b += 1) for (let i = 0; i <= 10; i += 1) { const t = i / 10; const x = b % 2 === 0 ? 892 + t * 90 : 982 - t * 90; kritzel.push([x, 638 + b * 4 + (i % 2) * 2]); }
  await zug(P, kritzel, { id: 42, takt: 4 }); await warte(P, 600);
  pruefe('D2 der Kritzel löscht den Strich darunter und bleibt selbst nicht stehen', (await striche(P)).length === 0, String((await striche(P)).length));
  pruefe('D3 Hinweis „Durchgestrichen … ↶"', /Durchgestrichen/.test(await toast(P)) && /↶/.test(await toast(P)), await toast(P));
  // Ein Kritzel ins Leere ist nur ein Strich
  await zug(P, kritzel.map(([x, y]) => [x + 250, y]), { id: 43, takt: 4 }); await warte(P, 900);
  pruefe('D4 ein Kritzel ohne Strich darunter bleibt eine normale Zeichnung', (await striche(P)).length === 1, JSON.stringify({ n: (await striche(P)).length, toast: await toast(P) }));
  await ctx.close();
}

// ══ E: Umkreisen ════════════════════════════════════════════════════
console.log('\n════ E: Umkreisen markiert ════');
{
  const { ctx, P } = await seite({ auto: false });
  await werkzeug(P, 'Stift');
  const k = await P.locator('.react-flow__node[data-id="n2"]').boundingBox();
  const cx = k.x + k.width / 2, cy = k.y + k.height / 2, rx = k.width / 2 + 40, ry = k.height / 2 + 40;
  const schleife = Array.from({ length: 44 }, (_, i) => { const t = (i / 42) * Math.PI * 2; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]; });
  await zug(P, schleife, { id: 51 }); await warte(P, 600);
  const sel = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.dataset.id));
  pruefe('E1 die umkreiste Karte ist markiert, keine andere', sel.join(',') === 'n2', sel.join(','));
  pruefe('E2 die Schleife wird nicht als Strich gespeichert', (await striche(P)).length === 0);
  pruefe('E3 Wechsel in die Auswahl: Palette weg, Auswahl-Leiste da', (await P.locator('.draw-palette').count()) === 0 && (await P.locator('.sel-toolbar, .sel-toolbar-dock').count()) >= 1);
  pruefe('E4 Hinweis „1 Karte markiert"', /1 Karte markiert/.test(await toast(P)), await toast(P));
  await ctx.close();
}

// ══ F: Formen schneller ═════════════════════════════════════════════
console.log('\n════ F: Formen rasten schneller ein ════');
{
  const { ctx, P } = await seite({ auto: false });
  await werkzeug(P, 'Stift');
  const kreis = Array.from({ length: 40 }, (_, i) => { const t = (i / 40) * Math.PI * 2 * 0.92; return [1000 + 60 * Math.cos(t) + (i % 2 ? 2 : -2), 650 + 60 * Math.sin(t)]; });
  await zug(P, kreis, { id: 61, offen: true });
  await warte(P, 150);
  const frueh = /eingerastet/.test(await toast(P));
  await warte(P, 320);
  const spaet = /eingerastet/.test(await toast(P));
  await P.evaluate(() => { document.elementFromPoint(1000, 710)?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 61, pointerType: 'pen', clientX: 1000, clientY: 710, buttons: 0 })); });
  await warte(P, 900);
  pruefe('F1 nach ~150 ms noch nichts, nach ~470 ms ist die Form eingerastet (vorher 550 ms)', !frueh && spaet && (await striche(P)).length === 1, `${frueh} → ${spaet}, Striche ${(await striche(P)).length}`);
  await ctx.close();
}

// ══ G: Strichstärke ═════════════════════════════════════════════════
console.log('\n════ G: Strichstärke ════');
{
  const { ctx, P } = await seite({ auto: false });
  await werkzeug(P, 'Stift');
  const dicken = P.locator('.draw-palette .draw-dicke');
  pruefe('G1 drei Strichstärken in der Palette, „normal" gewählt', (await dicken.count()) === 3 && (await dicken.nth(1).evaluate((e) => e.classList.contains('on'))));
  await dicken.nth(2).click(); await warte(P, 200);
  await zug(P, welle(900, 650), { id: 71 }); await warte(P, 400);
  pruefe('G2 „dick" zeichnet mit Breite 4', (await striche(P))[0]?.width === 4, String((await striche(P))[0]?.width));
  await werkzeug(P, 'Textmarker');
  pruefe('G3 beim Textmarker gibt es keine Stärken-Wahl', (await P.locator('.draw-palette .draw-dicke').count()) === 0);
  await ctx.close();
}

// ══ H: Schalter ═════════════════════════════════════════════════════
console.log('\n════ H: Schalter in den Diensten ════');
{
  const { ctx, P } = await seite({ auto: false });
  await werkzeug(P, 'Stift');
  await schreiben(P, 900, 650);
  await warte(P, 1600);
  pruefe('H1 mit ausgeschaltetem Vorschlag erscheint kein Chip', (await P.locator('.schrift-vorschlag').count()) === 0);
  pruefe('H2 der „Text"-Knopf in der Palette bleibt als Weg', (await P.locator('.draw-palette .draw-text').count()) === 1);
  await P.keyboard.press('Escape'); await warte(P, 300);
  await P.locator('[data-taste="einstellungen"]').click(); await warte(P, 300);
  await P.locator('.modal-tabs button', { hasText: 'Dienste' }).click(); await warte(P, 300);
  const auto = P.locator('[data-taste="handschrift-auto"]');
  pruefe('H3 Dienste → Handschrift: „Vorschlag nach dem Schreiben" (aus, wie gesetzt), kein KI-Schalter ohne KI', (await auto.count()) === 1 && !(await auto.isChecked()) && (await P.locator('[data-taste="handschrift-ki"]').count()) === 0);
  await auto.check(); await warte(P, 200);
  pruefe('H4 der Schalter landet in den Geräte-Einstellungen', await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen')).handschriftAuto === true));
  await ctx.close();
  const { ctx: c2, P: P2 } = await seite({ ki: true });
  await P2.locator('[data-taste="einstellungen"]').click(); await warte(P2, 300);
  await P2.locator('.modal-tabs button', { hasText: 'Dienste' }).click(); await warte(P2, 300);
  pruefe('H5 mit eingerichteter KI gibt es „KI verbessert die Erkennung" (an)', (await P2.locator('[data-taste="handschrift-ki"]').count()) === 1 && (await P2.locator('[data-taste="handschrift-ki"]').isChecked()));
  await c2.close();
}

// ══ I: Texte ════════════════════════════════════════════════════════
console.log('\n════ I: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('I1 „Was ist neu" nennt „Schreiben wie auf Papier, Etappe 2 (M324)"', js.includes('Schreiben wie auf Papier, Etappe 2 (M324)'));
  pruefe('I2 die Hilfe nennt die Gesten', js.includes('Umkreisen markiert Karten, Durchstreichen löscht Striche'));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
