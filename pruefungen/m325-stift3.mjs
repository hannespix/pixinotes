/**
 * M325 — Stift wie auf Surface und iPad: „Der Stift schreibt, der Finger bedient."
 *
 *   A  Tipp = Klick (Auswahlmodus): Stift-Tipp setzt den Cursor in die Notiz,
 *      setzt Haken, wählt Karten, wählt auf der Fläche ab — ohne einen Punkt zu malen.
 *   B  Stift schreibt im Auswahlmodus auch auf Notizen (geankert, Karte bleibt
 *      stehen); Seitentaste zieht die Karte; der Griff bleibt Griff.
 *   C  Radierer-Ende des Stifts radiert in jedem Werkzeug (Teil-Radierer teilt
 *      den Strich); Strich-Radierer nimmt den ganzen Strich.
 *   D  Getippten Text mit dem Stift bearbeiten: Kritzel löscht ein Wort,
 *      Durchstreichen löscht, Unterstreichen bleibt Tinte, Schleife markiert.
 *   E  Handschrift zwischen getipptem Text: hinter dem Zeilenende und vor dem
 *      Zeilenanfang wird inline eingefügt (kein neuer Block).
 *   F  Finger-Tipps (Procreate): zwei Finger = Rückgängig, drei = Wiederholen,
 *      zweiter Finger beim Halten rastet die Form sofort ein.
 *   G  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m325-stift3.mjs`
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
const PORT = 4547;
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
  boards: [{ id: 'b1', name: 'Werkstatt', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 320, height: 150, position: { x: -600, y: -400 }, data: { color: 'yellow', blocks: [
      { id: 'b-satz', type: 'paragraph', content: 'Milch Brot Butter Eier' },
      { id: 'b-haken', type: 'checkListItem', content: 'Haken' },
    ] } },
    { id: 'n2', type: 'note', width: 240, height: 120, position: { x: -150, y: -400 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Kurze Idee' }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
const FAKE_HW = ({ antwort }) => {
  window.HandwritingStroke = class { constructor() { this.p = []; } addPoint(p) { this.p.push(p); } };
  navigator.createHandwritingRecognizer = async () => ({ startDrawing() { return { addStroke() {}, async getPrediction() { return antwort.map((text) => ({ text })); } }; }, finish() {} });
};
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript(({ st, auto }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true, handschriftAuto: !!auto }));
    localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand(), auto: opt.auto });
  await ctx.addInitScript(FAKE_HW, { antwort: opt.hw ?? ['Käse'] });
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
/** Stift-Zug mit Tasten: o.buttons (2 = Seitentaste, 32 = Radierer), o.button (5 = Radierer) */
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7;
  const mk = (typ, [x, y], extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: o.art ?? 'pen', isPrimary: true, clientX: x, clientY: y, pressure: 0.5, buttons: o.buttons ?? 1, button: o.button ?? 0, ...extra });
  const start = document.elementFromPoint(punkte[0][0], punkte[0][1]) ?? document.body;
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  for (const pt of punkte.slice(1)) { start.dispatchEvent(mk('pointermove', pt)); await new Promise((r) => setTimeout(r, o.takt ?? 8)); }
  if (o.halten) await new Promise((r) => setTimeout(r, o.halten));
  if (!o.offen) start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0, button: o.button ?? 0 }));
  return start.className?.baseVal ?? start.className;
}, { punkte, o });
/** Echter Stift-Tipp über das DevTools-Protokoll: Pointer-Ereignisse mit pointerType pen samt dem Klick, den der Browser danach schickt */
const tipp = async (P, x, y) => {
  const cdp = await P.context().newCDPSession(P);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
  await P.waitForTimeout(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await cdp.detach();
};
/** Ein Punkt auf der freien Fläche (abhängig vom Ausschnitt) */
const freierPunkt = (P) => P.evaluate(() => { for (let y = 860; y > 120; y -= 40) for (let x = 120; x < 1400; x += 40) { const el = document.elementFromPoint(x, y); if (el?.classList.contains('react-flow__pane')) return [x, y]; } return [700, 700]; });
/** Finger-Tipp mit n Fingern (synthetische Touch-Ereignisse am Element unter dem Punkt) */
const fingerTipp = (P, n, x, y) => P.evaluate(async ({ n, x, y }) => {
  const el = document.elementFromPoint(x, y) ?? document.body;
  const ts = Array.from({ length: n }, (_, i) => new Touch({ identifier: 100 + i, target: el, clientX: x + i * 40, clientY: y, touchType: 'direct' }));
  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: ts, targetTouches: ts, changedTouches: ts }));
  await new Promise((r) => setTimeout(r, 80));
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: ts }));
}, { n, x, y });
const striche = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []);
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const warte = (P, ms = 600) => P.waitForTimeout(ms);
const blockText = (n, id) => { const b = n.data.blocks.find((x) => x.id === id); return Array.isArray(b?.content) ? b.content.map((c) => c.text).join('') : (b?.content ?? ''); };
/** Bildschirm-Rechteck eines Elements (Playwrights boundingBox verrechnet sich bei React-Flow-Karten) */
const rect = (P, sel) => P.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null; }, sel);
/** Bildschirm-Rechteck eines Wortes im Editor der Karte */
const wortRect = (P, nodeId, wort) => P.evaluate(({ nodeId, wort }) => {
  const root = document.querySelector(`.react-flow__node[data-id="${nodeId}"] .bn-editor`);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let t; while ((t = w.nextNode())) { const i = t.data.indexOf(wort); if (i >= 0) { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + wort.length); const b = r.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; } }
  return null;
}, { nodeId, wort });
const welle = (x0, y0, n = 18, amp = 6, dx = 3) => Array.from({ length: n }, (_, i) => [x0 + i * dx, y0 + Math.sin(i / 1.7) * amp + (i % 3)]);
const kritzelUeber = (r) => { const out = []; for (let b = 0; b < 7; b += 1) for (let i = 0; i <= 8; i += 1) { const t = i / 8; const x = b % 2 === 0 ? r.x - 2 + t * (r.w + 4) : r.r + 2 - t * (r.w + 4); out.push([x, r.y + 2 + b * ((r.h - 4) / 6)]); } return out; };

// ══ A: Tipp = Klick ═════════════════════════════════════════════════
console.log('\n════ A: Tipp = Klick ════');
{
  const { ctx, P } = await seite();
  const brot = await wortRect(P, 'n1', 'Brot');
  await tipp(P, brot.x + 4, brot.y + brot.h / 2); await warte(P, 400);
  const fokus = await P.evaluate(() => { const a = document.activeElement; const sel = getSelection(); return { imEditor: !!a?.closest?.('.react-flow__node[data-id="n1"] .bn-editor'), knoten: sel?.anchorNode?.textContent?.slice(0, 30), offset: sel?.anchorOffset }; });
  pruefe('A1 ein Stift-Tipp in den Text setzt den Cursor dorthin (kein Punkt gemalt)', fokus.imEditor && /Milch Brot/.test(fokus.knoten ?? '') && fokus.offset >= 6 && fokus.offset <= 7 && (await striche(P)).length === 0, JSON.stringify(fokus));
  const box = await P.locator('.react-flow__node[data-id="n1"] input[type=checkbox]').first().boundingBox();
  await tipp(P, box.x + box.width / 2, box.y + box.height / 2); await warte(P, 500);
  const haken = (await knoten(P)).find((k) => k.id === 'n1').data.blocks.find((b) => b.id === 'b-haken').props?.checked;
  pruefe('A2 ein Stift-Tipp auf das Kästchen setzt den Haken', haken === true, String(haken));
  const n2 = await rect(P, '.react-flow__node[data-id="n2"] .card-body');
  await tipp(P, n2.x + 6, n2.y + n2.height - 6); await warte(P, 400);
  pruefe('A3 ein Stift-Tipp auf den Kartenrand wählt die Karte', await P.locator('.react-flow__node.selected[data-id="n2"]').count() === 1, JSON.stringify(n2));
  const [fx, fy] = await freierPunkt(P);
  await tipp(P, fx, fy); await warte(P, 400);
  pruefe('A4 ein Stift-Tipp auf die Fläche wählt ab — und malt keinen Punkt', (await P.locator('.react-flow__node.selected').count()) === 0 && (await striche(P)).length === 0, JSON.stringify({ sel: await P.locator('.react-flow__node.selected').count(), n: (await striche(P)).length }));
  await ctx.close();
}

// ══ B: Stift schreibt, Seitentaste greift ═══════════════════════════
console.log('\n════ B: Stift schreibt auf Notizen, Seitentaste greift ════');
{
  const { ctx, P } = await seite();
  const n2 = await rect(P, '.react-flow__node[data-id="n2"] .card-body');
  const vorher = (await knoten(P)).find((k) => k.id === 'n2').position;
  await zug(P, welle(n2.x + 20, n2.y + 70, 20, 8), { id: 21 }); await warte(P, 800);
  const d = await striche(P);
  const nachher = (await knoten(P)).find((k) => k.id === 'n2').position;
  pruefe('B1 im Auswahlmodus schreibt der Stift auf der Notiz (geankert), die Karte bleibt stehen', d.length === 1 && d[0].anchor === 'n2' && nachher.x === vorher.x && nachher.y === vorher.y, JSON.stringify({ n: d.length, anker: d[0]?.anchor, vorher, nachher }));
  await zug(P, [[n2.x + 60, n2.y + 60], [n2.x + 90, n2.y + 80], [n2.x + 140, n2.y + 110], [n2.x + 180, n2.y + 130]], { id: 22, buttons: 2, button: 2 }); await warte(P, 700);
  const pos2 = (await knoten(P)).find((k) => k.id === 'n2').position;
  pruefe('B2 mit gedrückter Seitentaste zieht der Stift die Karte (kein Strich)', Math.abs(pos2.x - (vorher.x + 120)) < 2 && Math.abs(pos2.y - (vorher.y + 70)) < 2 && (await striche(P)).length === 1, JSON.stringify({ pos2, erwartet: { x: vorher.x + 120, y: vorher.y + 70 } }));
  const grip = await rect(P, '.react-flow__node[data-id="n2"] .card-grip');
  const vorGriff = (await striche(P)).length;
  await zug(P, [[grip.x + grip.width / 2, grip.y + grip.height / 2], [grip.x + 30, grip.y + 20], [grip.x + 60, grip.y + 40]], { id: 23 }); await warte(P, 500);
  pruefe('B3 der Griff bleibt Griff: dort malt der Stift nicht', (await striche(P)).length === vorGriff);
  await P.screenshot({ path: path.join(SD, 'm325-schreibt.png') });
  await ctx.close();
}

// ══ C: Radierer ═════════════════════════════════════════════════════
console.log('\n════ C: Radierer-Ende und Radierer-Arten ════');
{
  const { ctx, P } = await seite();
  await zug(P, Array.from({ length: 30 }, (_, i) => [800 + i * 8, 650 + Math.sin(i / 3) * 12]), { id: 31 }); await warte(P, 700);
  pruefe('C1 ein langer Strich liegt da', (await striche(P)).length === 1);
  // Radierer-Ende des Stifts quer durch die Mitte (Auswahlmodus!)
  await zug(P, [[920, 610], [920, 640], [920, 665], [920, 700]], { id: 32, buttons: 32, button: 5 }); await warte(P, 800);
  const d = await striche(P);
  const beruehrtMitte = d.some((s) => s.points.some((p) => Math.abs(p[0] - (920 - 1210)) < 9));
  pruefe('C2 das Radierer-Ende radiert in jedem Werkzeug, der Teil-Radierer teilt den Strich', d.length === 2 && !beruehrtMitte, JSON.stringify({ n: d.length, mitte: beruehrtMitte }));
  await werkzeug(P, 'Radierer');
  const arten = P.locator('.draw-palette .draw-radierer-art');
  pruefe('C3 die Palette bietet Teil- und Strich-Radierer, Teil ist Standard', (await arten.count()) === 2 && (await arten.nth(0).evaluate((e) => e.classList.contains('on'))));
  await arten.nth(1).click(); await warte(P, 200);
  await zug(P, [[850, 630], [850, 650], [850, 670]], { id: 33 }); await warte(P, 800);
  pruefe('C4 der Strich-Radierer nimmt den ganzen Strich', (await striche(P)).length === 1, String((await striche(P)).length));
  await ctx.close();
}

// ══ D: Getippten Text mit dem Stift bearbeiten ══════════════════════
console.log('\n════ D: Text mit dem Stift bearbeiten ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  const brot = await wortRect(P, 'n1', 'Brot');
  await zug(P, kritzelUeber(brot), { id: 41, takt: 4 }); await warte(P, 900);
  let n1 = (await knoten(P)).find((k) => k.id === 'n1');
  pruefe('D1 Kritzel über „Brot" löscht das Wort — der Satz bleibt sauber', blockText(n1, 'b-satz') === 'Milch Butter Eier' && (await striche(P)).length === 0, blockText(n1, 'b-satz'));
  pruefe('D2 Hinweis nennt das Wort', /„Brot" gelöscht/.test(await toast(P)), await toast(P));
  const butter = await wortRect(P, 'n1', 'Butter');
  await zug(P, Array.from({ length: 14 }, (_, i) => [butter.x - 3 + i * ((butter.w + 6) / 13), butter.y + butter.h * 0.5 + (i % 2)]), { id: 42 }); await warte(P, 900);
  n1 = (await knoten(P)).find((k) => k.id === 'n1');
  pruefe('D3 ein waagerechter Strich durch „Butter" streicht es durch = löscht es', blockText(n1, 'b-satz') === 'Milch Eier' && (await striche(P)).length === 0, blockText(n1, 'b-satz'));
  const eier = await wortRect(P, 'n1', 'Eier');
  await zug(P, Array.from({ length: 14 }, (_, i) => [eier.x - 3 + i * ((eier.w + 6) / 13), eier.b + 3 + (i % 2)]), { id: 43 }); await warte(P, 900);
  n1 = (await knoten(P)).find((k) => k.id === 'n1');
  pruefe('D4 ein Strich UNTER „Eier" ist eine Unterstreichung: Text bleibt, Tinte bleibt', blockText(n1, 'b-satz') === 'Milch Eier' && (await striche(P)).length === 1, JSON.stringify({ t: blockText(n1, 'b-satz'), n: (await striche(P)).length }));
  const milch = await wortRect(P, 'n1', 'Milch');
  const cx = milch.x + milch.w / 2, cy = milch.y + milch.h / 2, rx = milch.w / 2 + 10, ry = milch.h / 2 + 8;
  await zug(P, Array.from({ length: 30 }, (_, i) => { const t = (i / 28) * Math.PI * 2; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]; }), { id: 44 }); await warte(P, 700);
  const auswahl = await P.evaluate(() => getSelection()?.toString() ?? '');
  pruefe('D5 eine kleine Schleife um „Milch" markiert das Wort (Formatierleiste kann kommen)', auswahl === 'Milch' && (await striche(P)).length === 1, JSON.stringify(auswahl));
  await P.screenshot({ path: path.join(SD, 'm325-textgesten.png') });
  await ctx.close();
}

// ══ E: Handschrift zwischen getipptem Text ══════════════════════════
console.log('\n════ E: Einfügen zwischen Wörtern ════');
{
  const { ctx, P } = await seite({ auto: true, hw: ['Käse'] });
  await werkzeug(P, 'Stift');
  const eier = await wortRect(P, 'n1', 'Eier');
  // hinter dem Zeilenende
  await zug(P, welle(eier.r + 14, eier.y + eier.h / 2, 16, 5, 2.5), { id: 51 }); await warte(P, 1700);
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  let n1 = (await knoten(P)).find((k) => k.id === 'n1');
  // (BlockNote hält am Ende einen leeren Absatz bereit — gezählt werden Blöcke mit Text)
  const mitText = (n) => n.data.blocks.filter((b) => (Array.isArray(b.content) ? b.content.some((c) => c.text) : !!b.content)).length;
  pruefe('E1 Schrift hinter dem Zeilenende wird an die Zeile angehängt (kein neuer Block)', blockText(n1, 'b-satz') === 'Milch Brot Butter Eier Käse' && mitText(n1) === 2, JSON.stringify({ t: blockText(n1, 'b-satz'), n: mitText(n1) }));
  const milch = await wortRect(P, 'n1', 'Milch');
  await zug(P, welle(milch.x - 9, milch.y + milch.h / 2, 12, 4, 0.7), { id: 52 }); await warte(P, 1700);
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  n1 = (await knoten(P)).find((k) => k.id === 'n1');
  pruefe('E2 Schrift am Zeilenanfang kommt vor das erste Wort', blockText(n1, 'b-satz') === 'Käse Milch Brot Butter Eier Käse', blockText(n1, 'b-satz'));
  const brot = await wortRect(P, 'n1', 'Brot');
  await zug(P, welle(brot.r + 1, brot.y + brot.h / 2, 10, 4, 0.6), { id: 53 }); await warte(P, 1700);
  await P.locator('.schrift-vorschlag .vorschlag-text').click(); await warte(P, 900);
  n1 = (await knoten(P)).find((k) => k.id === 'n1');
  pruefe('E3 Schrift zwischen zwei Wörtern landet an der Wortgrenze', blockText(n1, 'b-satz') === 'Käse Milch Brot Käse Butter Eier Käse', blockText(n1, 'b-satz'));
  await ctx.close();
}

// ══ F: Finger-Tipps (Procreate) ═════════════════════════════════════
console.log('\n════ F: Finger-Tipps ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  await zug(P, welle(900, 650, 20, 10), { id: 61 }); await warte(P, 700);
  pruefe('F0 ein Strich', (await striche(P)).length === 1);
  await fingerTipp(P, 2, 700, 700); await warte(P, 800);
  pruefe('F1 Zwei-Finger-Tipp = Rückgängig', (await striche(P)).length === 0 && /Rückgängig/.test(await toast(P)), JSON.stringify({ n: (await striche(P)).length, toast: await toast(P) }));
  await fingerTipp(P, 3, 700, 700); await warte(P, 800);
  pruefe('F2 Drei-Finger-Tipp = Wiederholen', (await striche(P)).length === 1 && /Wiederholen/.test(await toast(P)), String((await striche(P)).length));
  // Zweiter Finger beim Halten rastet die Form sofort ein
  const kreis = Array.from({ length: 40 }, (_, i) => { const t = (i / 40) * Math.PI * 2 * 0.92; return [1050 + 60 * Math.cos(t) + (i % 2 ? 2 : -2), 500 + 60 * Math.sin(t)]; });
  await zug(P, kreis, { id: 62, offen: true });
  await fingerTipp(P, 1, 600, 760);
  await warte(P, 120);
  const sofort = /eingerastet/.test(await toast(P));
  await P.evaluate(() => { document.elementFromPoint(1110, 500)?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 62, pointerType: 'pen', clientX: 1110, clientY: 500, buttons: 0 })); });
  await warte(P, 900);
  pruefe('F3 tippt ein Finger, während der Stift hält, rastet die Form sofort ein (ohne 320 ms zu warten)', sofort && (await striche(P)).length === 2, JSON.stringify({ sofort, n: (await striche(P)).length }));
  await ctx.close();
}

// ══ G: Texte ════════════════════════════════════════════════════════
console.log('\n════ G: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G1 „Was ist neu" nennt „Stift wie auf Surface und iPad (M325)"', js.includes('Stift wie auf Surface und iPad (M325)'));
  pruefe('G2 die Palette sagt „Stift schreibt, Finger bedient, Seitentaste greift"', js.includes('Stift schreibt, Finger bedient, Seitentaste greift'));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
