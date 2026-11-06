/**
 * M327 — Handschrift mit Struktur.
 *
 *   A  Form-Marker ins Leere: Kästchen → Aufgabe, Strich → Aufzählung,
 *      Unterstreichung → Überschrift, größere erste Zeile → Überschrift.
 *      Die Marker-Striche gehen nicht mit in die Erkennung.
 *   B  Text-Marker: „- eier" / „# plan" aus dem Erkenner werden Aufzählung und Überschrift.
 *   C  Kontext in der Notiz: unter einer Checkliste wird die Schrift ein
 *      Kästchen-Punkt; links der Einrückung wieder normaler Text.
 *   D  Umschalter im Vorschlag: ¶ • 1. ☐ H — Wahl bleibt beim Übernehmen.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m327-struktur.mjs`
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
const PORT = 4549;
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

const stand = () => ({
  boards: [{ id: 'b1', name: 'Projekt Küche', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 320, height: 300, position: { x: -600, y: -400 }, data: { color: 'yellow', blocks: [
      { id: 'b-titel', type: 'heading', props: { level: 2 }, content: 'Einkauf Wochenende' },
      { id: 'b-milch', type: 'checkListItem', props: { checked: true }, content: 'Milch' },
      { id: 'b-brot', type: 'checkListItem', content: 'Brot' },
      { id: 'b-butter', type: 'checkListItem', content: 'Butter' },
    ] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
/** Nachgestellte Handwriting Recognition API: Antwort nach Zahl der gelieferten Striche (window.__hwPlan) */
const FAKE_HW = () => {
  window.__hw = { aufrufe: 0, striche: [] };
  window.__hwPlan = {};
  window.HandwritingStroke = class { constructor() { this.p = []; } addPoint(p) { this.p.push(p); } };
  navigator.createHandwritingRecognizer = async () => ({
    startDrawing() {
      const st = [];
      return {
        addStroke(s) { st.push(s); },
        async getPrediction() {
          window.__hw.aufrufe += 1; window.__hw.striche.push(st.length);
          const plan = window.__hwPlan || {};
          const text = plan[st.length] ?? plan.sonst ?? 'hallo welt';
          return [{ text }];
        },
      };
    },
    finish() {},
  });
};
async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true }));
    localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand() });
  await ctx.addInitScript(FAKE_HW);
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
  const mk = (typ, [x, y, p], extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, pressure: p ?? 0.5, buttons: 1, button: 0, ...extra });
  const start = document.elementFromPoint(punkte[0][0], punkte[0][1]) ?? document.body;
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  for (const pt of punkte.slice(1)) { start.dispatchEvent(mk('pointermove', pt)); await new Promise((r) => setTimeout(r, 8)); }
  start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0 }));
}, { punkte, o });
const plan = (P, p) => P.evaluate((p) => { window.__hwPlan = p; }, p);
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const striche = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []);
const warte = (P, ms = 600) => P.waitForTimeout(ms);
const welle = (x0, y0, n = 18, amp = 14) => Array.from({ length: n }, (_, i) => [x0 + i * 3, y0 + Math.sin(i / 1.7) * amp + (i % 3) * 2]);
let zid = 100;
/** Drei „Wörter" nebeneinander bei (x0,y0) — y0 ist die Mittellinie */
const schreiben = async (P, x0, y0, amp = 14) => {
  for (let k = 0; k < 3; k += 1) { await zug(P, welle(x0 + k * 60, y0, 18, amp), { id: ++zid }); await P.waitForTimeout(90); }
};
/** Ein gezeichnetes Kästchen — wie mit dem Stift: vier Kanten mit je vier Punkten */
const kasten = (x, y, s) => {
  const ecken = [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
  const pts = [];
  for (let k = 0; k < 4; k += 1) for (let i = 0; i < 4; i += 1) pts.push([ecken[k][0] + (ecken[k + 1][0] - ecken[k][0]) * i / 4, ecken[k][1] + (ecken[k + 1][1] - ecken[k][1]) * i / 4]);
  pts.push([x + 1, y + 1]);
  return pts;
};
/** Zurück auf den Ausgangsstand (n1 wie im Stand, keine Striche), Stift an */
const frisch = async (P) => {
  await P.evaluate((st) => { localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st })); }, stand());
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1400);
  await werkzeug(P, 'Stift');
};
const chipText = async (P) => {
  const c = P.locator('.schrift-vorschlag .vorschlag-text:not(.erkennt)');
  try { await c.first().waitFor({ timeout: 4000 }); } catch { return null; }
  return (await c.first().textContent()).replace(/^✍️…?/, '').trim();
};
const artAn = async (P) => { const b = P.locator('.schrift-vorschlag .vorschlag-art.on'); return (await b.count()) ? b.first().textContent() : null; };
const texte = (bs) => bs.map((b) => [b.type, Array.isArray(b.content) ? b.content.map((c) => c.text).join('') : (b.content ?? ''), b.props?.checked ?? null, b.props?.level ?? null]);
const neueNotiz = async (P) => (await knoten(P)).find((k) => k.id !== 'n1');
const aufraeumen = async (P) => {
  // Neue Notizen weg, Striche weg — für den nächsten Fall
  await P.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('pixinotes-board'));
    st.state.boards[0].nodes = st.state.boards[0].nodes.filter((n) => n.id === 'n1');
    st.state.boards[0].drawings = [];
    localStorage.setItem('pixinotes-board', JSON.stringify(st));
  });
  await P.reload({ waitUntil: 'networkidle' }); await warte(P, 1400);
  await werkzeug(P, 'Stift');
};

// ══ A: Form-Marker ins Leere ═════════════════════════════════════════
console.log('\n════ A: Form-Marker — Kästchen, Strich, Unterstreichung, Größe ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  // A1 Kästchen + drei Wörter → ☐ Milch
  await plan(P, { 3: 'milch', sonst: 'o milch' });
  await zug(P, kasten(880, 640, 18), { id: ++zid }); await warte(P, 120);
  await schreiben(P, 920, 650);
  let t = await chipText(P);
  pruefe('A1 Kästchen vor der Zeile → Vorschlag „☐ Milch" (Marker nicht im Erkenner)', t === '☐ Milch', String(t));
  pruefe('A1b der Erkenner bekam drei Striche (ohne das Kästchen)', (await P.evaluate(() => window.__hw.striche.at(-1))) === 3, String(await P.evaluate(() => window.__hw.striche)));
  pruefe('A1c im Umschalter ist ☐ an', (await artAn(P)) === '☐', String(await artAn(P)));
  await P.screenshot({ path: path.join(SD, 'm327-kasten.png') });
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  let neu = await neueNotiz(P);
  pruefe('A1d Übernehmen → neue Notiz mit offenem Kästchen-Punkt „Milch"', !!neu && JSON.stringify(texte(neu.data.blocks)[0]) === JSON.stringify(['checkListItem', 'Milch', false, null]), JSON.stringify(texte(neu?.data.blocks ?? [])));
  pruefe('A1e alle Striche sind weg (auch das Kästchen)', (await striche(P)).length === 0, String((await striche(P)).length));

  // A2 Kästchen mit Haken → erledigt
  await aufraeumen(P);
  await plan(P, { 3: 'brot', sonst: 'x brot' });
  await zug(P, kasten(880, 640, 18), { id: ++zid }); await warte(P, 100);
  await zug(P, [[883, 650], [888, 656], [896, 643]], { id: ++zid }); await warte(P, 100);
  await schreiben(P, 920, 650);
  t = await chipText(P);
  pruefe('A2 Kästchen mit Haken → „☑ Brot"', t === '☑ Brot', String(t));
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  neu = await neueNotiz(P);
  pruefe('A2b Übernehmen → erledigter Punkt', !!neu && texte(neu.data.blocks)[0][2] === true, JSON.stringify(texte(neu?.data.blocks ?? [])));

  // A3 Strich davor → Aufzählung
  await aufraeumen(P);
  await plan(P, { 3: 'eier', sonst: '- eier' });
  await zug(P, [[880, 650], [888, 650], [896, 650.5]], { id: ++zid }); await warte(P, 100);
  await schreiben(P, 915, 650);
  t = await chipText(P);
  pruefe('A3 kurzer Strich vor der Zeile → „• Eier"', t === '• Eier', String(t));
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  neu = await neueNotiz(P);
  pruefe('A3b Übernehmen → Aufzählungspunkt', !!neu && texte(neu.data.blocks)[0][0] === 'bulletListItem', JSON.stringify(texte(neu?.data.blocks ?? [])));

  // A4 Linie unter der Zeile → Überschrift
  await aufraeumen(P);
  await plan(P, { 3: 'plan', sonst: 'plan -' });
  await schreiben(P, 900, 650);
  await zug(P, [[896, 676], [960, 676.5], [1040, 676], [1075, 676]], { id: ++zid });
  t = await chipText(P);
  pruefe('A4 Linie unter der Zeile → „H Plan"', t === 'H Plan', String(t));
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  neu = await neueNotiz(P);
  pruefe('A4b Übernehmen → Überschrift (Ebene 2), die Linie ist weg', !!neu && texte(neu.data.blocks)[0][0] === 'heading' && texte(neu.data.blocks)[0][3] === 2 && (await striche(P)).length === 0, JSON.stringify(texte(neu?.data.blocks ?? [])));

  // A5 erste Zeile deutlich größer → Überschrift, Rest Text
  await aufraeumen(P);
  await plan(P, { 9: 'wochenende\nmilch holen\nbrot backen', sonst: '?' });
  await schreiben(P, 900, 600, 30);
  await schreiben(P, 900, 680, 12);
  await schreiben(P, 900, 730, 12);
  t = await chipText(P);
  pruefe('A5 größere erste Zeile → „H Wochenende", die anderen Zeilen Text', t === 'H Wochenende\nMilch holen\nBrot backen', JSON.stringify(t));
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  neu = await neueNotiz(P);
  pruefe('A5b Übernehmen → Überschrift + zwei Absätze', !!neu && texte(neu.data.blocks).map((b) => b[0]).join(',') === 'heading,paragraph,paragraph', JSON.stringify(texte(neu?.data.blocks ?? [])));
  await ctx.close();
}

// ══ B: Text-Marker ═══════════════════════════════════════════════════
console.log('\n════ B: Text-Marker aus dem Erkenner ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  await plan(P, { sonst: '- eier\n1. mehl\n[x] zucker\n# plan' });
  await schreiben(P, 900, 650);
  const t = await chipText(P);
  pruefe('B1 „- eier / 1. mehl / [x] zucker / # plan" → Vorsätze • 1. ☑ H, Satzanfang groß', t === '• Eier\n1. Mehl\n☑ Zucker\nH Plan', JSON.stringify(t));
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  const neu = await neueNotiz(P);
  pruefe('B2 Übernehmen → vier Blöcke der richtigen Art', !!neu && JSON.stringify(texte(neu.data.blocks)) === JSON.stringify([['bulletListItem', 'Eier', null, null], ['numberedListItem', 'Mehl', null, null], ['checkListItem', 'Zucker', true, null], ['heading', 'Plan', null, 1]]), JSON.stringify(texte(neu?.data.blocks ?? [])));
  await ctx.close();
}

// ══ C: Kontext der Notiz ═════════════════════════════════════════════
console.log('\n════ C: Unter einer Liste geht die Liste weiter — links der Einrückung wieder Text ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  const lage = async () => P.evaluate(() => {
    const b = document.querySelector('.react-flow__node[data-id="n1"] .bn-block[data-id="b-butter"]');
    const i = b.querySelector('.bn-inline-content').getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const n = document.querySelector('.react-flow__node[data-id="n1"]').getBoundingClientRect();
    return { textLinks: i.left, blockLinks: r.left, unten: r.bottom, noteUnten: n.bottom, noteLinks: n.left };
  });
  let L = await lage();
  pruefe('C0 unter „Butter" ist in der Notiz noch Platz', L.noteUnten - L.unten > 60, JSON.stringify(L));
  // C1: unter dem Listentext weiterschreiben → ☐
  await plan(P, { sonst: 'sahne' });
  await schreiben(P, L.textLinks + 6, L.unten + 18, 8);
  let t = await chipText(P);
  pruefe('C1 Schrift unter der Checkliste → Vorschlag „☐ Sahne" (Kontext)', t === '☐ Sahne', String(t));
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  let n1 = (await knoten(P)).find((k) => k.id === 'n1');
  let bs = texte(n1.data.blocks).filter((b) => b[1] !== '');
  pruefe('C1b Übernehmen → neuer offener Kästchen-Punkt nach „Butter"', JSON.stringify(bs[4]) === JSON.stringify(['checkListItem', 'Sahne', false, null]) && bs.length === 5, JSON.stringify(bs));
  // C2: links der Einrückung → Text
  await frisch(P);
  L = await lage();
  await plan(P, { sonst: 'nicht vergessen' });
  await schreiben(P, L.blockLinks - 12, L.unten + 18, 8);
  t = await chipText(P);
  pruefe('C2 Schrift links der Einrückung → normaler Text „Nicht vergessen"', t === 'Nicht vergessen', String(t));
  pruefe('C2b im Umschalter ist ¶ an', (await artAn(P)) === '¶');
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  n1 = (await knoten(P)).find((k) => k.id === 'n1');
  bs = texte(n1.data.blocks).filter((b) => b[1] !== '');
  pruefe('C2c Übernehmen → Absatz nach der Liste', bs.at(-1)[0] === 'paragraph' && bs.at(-1)[1] === 'Nicht vergessen', JSON.stringify(bs));
  // C2d: links der Einrückung auf der ZEILE eines Punkts → vor den Zeilenanfang (M325 bleibt)
  await frisch(P);
  L = await lage();
  await plan(P, { sonst: 'auch' });
  await schreiben(P, L.blockLinks - 12, (await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="n1"] .bn-block[data-id="b-butter"]').getBoundingClientRect(); return (r.top + r.bottom) / 2; })), 6);
  t = await chipText(P);
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  n1 = (await knoten(P)).find((k) => k.id === 'n1');
  bs = texte(n1.data.blocks).filter((b) => b[1] !== '');
  pruefe('C2d Schrift vor „Butter" auf derselben Zeile → „Auch Butter" im Punkt (kein neuer Block)', bs.length === 4 && bs[3][1] === 'Auch Butter' && bs[3][0] === 'checkListItem', JSON.stringify(bs) + ' chip=' + t);
  // C3: unter der Überschrift schreibt man Text, keine Überschrift
  await frisch(P);
  const titel = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="n1"] .bn-block[data-id="b-titel"]').getBoundingClientRect(); return { rechts: r.right, mitte: (r.top + r.bottom) / 2 }; });
  await plan(P, { sonst: 'samstag' });
  await schreiben(P, titel.rechts - 60, titel.mitte, 7);
  t = await chipText(P);
  pruefe('C3 Schrift neben der Überschrift → kein „H"-Vorsatz (Überschrift setzt sich nicht fort)', t === 'Samstag', String(t));
  await P.keyboard.press('Escape'); await warte(P, 300);
  await ctx.close();
}

// ══ D: Umschalter ════════════════════════════════════════════════════
console.log('\n════ D: Textart umschalten ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  await plan(P, { sonst: 'angebot schreiben' });
  await schreiben(P, 900, 650);
  let t = await chipText(P);
  pruefe('D1 ohne Marker: „Angebot schreiben", ¶ an', t === 'Angebot schreiben' && (await artAn(P)) === '¶', String(t));
  const knoepfe = await P.locator('.schrift-vorschlag .vorschlag-art').allTextContents();
  pruefe('D2 fünf Textarten: ¶ • 1. ☐ H', knoepfe.join(' ') === '¶ • 1. ☐ H', knoepfe.join(' '));
  await P.locator('.schrift-vorschlag .vorschlag-art[aria-label="Als Aufgabe mit Kästchen übernehmen"]').click(); await warte(P, 200);
  t = await chipText(P);
  pruefe('D3 Tipp auf ☐ → Vorsatz „☐", ☐ an, aria-pressed', t === '☐ Angebot schreiben' && (await artAn(P)) === '☐' && (await P.locator('.schrift-vorschlag .vorschlag-art.on').getAttribute('aria-pressed')) === 'true', String(t));
  await P.locator('.schrift-vorschlag .vorschlag-art[aria-label="Als Nummerierte Liste übernehmen"]').click(); await warte(P, 200);
  t = await chipText(P);
  pruefe('D4 Tipp auf 1. → „1. Angebot schreiben"', t === '1. Angebot schreiben', String(t));
  await P.screenshot({ path: path.join(SD, 'm327-umschalter.png') });
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  const neu = await neueNotiz(P);
  pruefe('D5 Übernehmen → nummerierter Listenpunkt', !!neu && texte(neu.data.blocks)[0][0] === 'numberedListItem', JSON.stringify(texte(neu?.data.blocks ?? [])));
  // Zurück zu Text: ein Vorschlag mit Kästchen, dann ¶
  await aufraeumen(P);
  await plan(P, { 3: 'milch', sonst: 'o milch' });
  await zug(P, kasten(880, 640, 18), { id: ++zid }); await warte(P, 100);
  await schreiben(P, 920, 650);
  t = await chipText(P);
  await P.locator('.schrift-vorschlag .vorschlag-art[aria-label="Als Text übernehmen"]').click(); await warte(P, 200);
  pruefe('D6 Kästchen erkannt, dann ¶ → wieder „Milch" ohne Vorsatz', t === '☐ Milch' && (await chipText(P)) === 'Milch', String(await chipText(P)));
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  const neu2 = await neueNotiz(P);
  pruefe('D7 Übernehmen → Absatz', !!neu2 && texte(neu2.data.blocks)[0][0] === 'paragraph', JSON.stringify(texte(neu2?.data.blocks ?? [])));
  await ctx.close();
}

// ══ E: Texte ═════════════════════════════════════════════════════════
console.log('\n════ E: Texte ════');
{
  const { ctx, P } = await seite();
  await P.locator('.topbar .brand, .topbar [aria-label="Hilfe"], button[aria-label="Hilfe"]').first().click(); await warte(P, 500);
  const neuKnopf = P.locator('button', { hasText: 'Was ist neu' });
  if (await neuKnopf.count()) { await neuKnopf.first().click(); await warte(P, 400); }
  const html = await P.content();
  pruefe('E1 „Was ist neu" nennt „Handschrift mit Struktur (M327)"', /Handschrift mit Struktur \(M327\)/.test(html));
  pruefe('E2 … und den Umschalter', /Umschalter/.test(html));
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
