/**
 * M338 — Notizen ruhen, bis man schreibt; ferne Karten kosten nichts.
 *
 *   A  Ruhend: kein Editor nach dem Laden; der Inhalt steht da.
 *   B  Pixelgleich: Jeder Block liegt nach dem Wecken exakt dort, wo er ruhend lag (±0,6 px), die Karte ist gleich hoch.
 *   C  Klick weckt: Der Cursor landet an der Klickstelle, Tippen fügt dort ein, die Karte ist ausgewählt.
 *   D  Haken ruhend umlegen: Daten und Fortschritt folgen, kein Editor entsteht; Strg+Z nimmt es zurück.
 *   E  Verweilen mit der Maus weckt vor; Fokus weckt.
 *   F  Tabellen-Notiz und leere Notiz haben sofort ihren Editor.
 *   G  Blöcke ohne Id: Ansehen schreibt nichts; die ruhende Ansicht zeigt Pfad-Ids.
 *   H  Fern-Ruhe: Karte weit außerhalb ruht mit gleicher Höhe, kommt beim Hinfahren zurück; „alles zeigen" hebt sie auf.
 *   I  300 Karten: bedienbar in wenigen Sekunden, kein einziger Editor.
 *   J  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m338-ruhe.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4556;
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

const t = (text, styles = {}) => ({ type: 'text', text, styles });
const reich = [
  { id: 'r1', type: 'heading', props: { level: 2 }, content: [t('Besprechung Relaunch')] },
  { id: 'r2', type: 'paragraph', content: [t('Normal '), t('fett', { bold: true }), t(' kursiv', { italic: true }), t(' unter', { underline: true }), t(' durch', { strike: true }), t(' code', { code: true }), t(' rot', { textColor: 'red' }), t(' gelb', { backgroundColor: 'yellow' }), t(' und ein längerer Satz, der sicher in die zweite Zeile umbricht, damit der Umbruch geprüft wird. '), { type: 'link', href: 'https://example.com', content: [t('Link')] }] },
  { id: 'r3', type: 'bulletListItem', content: [t('Punkt eins')], children: [{ id: 'r3a', type: 'bulletListItem', content: [t('Unterpunkt mit Text')], children: [{ id: 'r3b', type: 'checkListItem', props: { checked: true }, content: [t('tief verschachtelt')] }] }] },
  { id: 'r4', type: 'numberedListItem', content: [t('Eins')] },
  { id: 'r5', type: 'numberedListItem', content: [t('Zwei')] },
  { id: 'r6', type: 'paragraph', content: [t('Dazwischen')] },
  { id: 'r7', type: 'numberedListItem', props: { start: 5 }, content: [t('Fünf')] },
  { id: 'r8', type: 'checkListItem', props: { checked: true }, content: [t('Erledigt')] },
  { id: 'r9', type: 'checkListItem', content: [t('Offen, mit einem Text, der über die Zeile hinausläuft und umbricht')] },
  { id: 'r10', type: 'quote', content: [t('Ein Zitat')] },
  { id: 'r11', type: 'paragraph', props: { textAlignment: 'center', textColor: 'blue', backgroundColor: 'green' }, content: [t('Mitte, blau auf grün')] },
  { id: 'r12', type: 'heading', props: { level: 1 }, content: [t('Groß')] },
  { id: 'r13', type: 'heading', props: { level: 3, textAlignment: 'right' }, content: [t('Klein rechts')] },
  { id: 'r14', type: 'paragraph', content: [] },
  { id: 'r15', type: 'paragraph', content: [t('Schluss')] },
];
const stand = (extra = []) => ({
  boards: [{ id: 'b1', name: 'Ruhe', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 320, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: reich } },
    { id: 'n2', type: 'note', width: 280, position: { x: 400, y: 0 }, data: { color: 'sky', blocks: [
      { id: 'c0', type: 'paragraph', content: [t('Einkauf Wochenende')] },
      { id: 'c1', type: 'checkListItem', props: { checked: true }, content: [t('Milch')] },
      { id: 'c2', type: 'checkListItem', content: [t('Brot')] },
      { id: 'c3', type: 'checkListItem', content: [t('Butter')] },
    ] } },
    { id: 'n3', type: 'note', width: 280, position: { x: 400, y: 260 }, data: { color: 'mint', blocks: [{ id: 'w1', type: 'paragraph', content: [t('Hallo schöne Welt da draußen')] }] } },
    { id: 'n4', type: 'note', width: 300, position: { x: 760, y: 0 }, data: { color: 'white', blocks: [{ id: 'tb', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[t('A')], [t('B')]] }, { cells: [[t('1')], [t('2')]] }] } }] } },
    { id: 'n5', type: 'note', width: 260, position: { x: 760, y: 260 }, data: { color: 'pink', blocks: [{ type: 'paragraph', content: 'Ohne Id eins' }, { type: 'bulletListItem', content: 'Ohne Id zwei' }] } },
    ...extra,
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite(st, { breite = 1440, hoehe = 900, touch = false, einKlick = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1, hasTouch: touch });
  await ctx.addInitScript(({ st, einKlick }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...(einKlick ? { fokusEinKlick: true } : {}) }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st, einKlick });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1600);
  return { ctx, P };
}
const knoten = (P, id) => P.evaluate((id) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === id), id);
const editoren = (P) => P.evaluate(() => [...document.querySelectorAll('.react-flow__node-note')].filter((n) => n.querySelector('.note-editor [contenteditable="true"]')).map((n) => n.getAttribute('data-id')));
/** Lage jedes Blocks relativ zur Karte, dazu die Kartenhöhe */
const lagen = (P, id) => P.evaluate((id) => {
  const k = document.querySelector(`.react-flow__node[data-id="${id}"]`);
  const kr = k.getBoundingClientRect();
  const z = kr.width / k.offsetWidth;
  const r = (v) => Math.round(v / z * 100) / 100;
  return { hoehe: k.offsetHeight, ruhend: !!k.querySelector('.notiz-ruhend'), bloecke: [...k.querySelectorAll('.bn-block-content')].map((b) => { const br = b.getBoundingClientRect(); const i = b.querySelector('.bn-inline-content').getBoundingClientRect(); return { typ: b.dataset.contentType, x: r(br.left - kr.left), y: r(br.top - kr.top), w: r(br.width), h: r(br.height), ix: r(i.left - kr.left), iw: r(i.width), ih: r(i.height), index: b.dataset.index ?? null, text: b.textContent.slice(0, 14), schrift: getComputedStyle(b.querySelector('.bn-inline-content')).fontSize + '/' + getComputedStyle(b.querySelector('.bn-inline-content')).fontWeight + '/' + getComputedStyle(b.querySelector('.bn-inline-content')).color }; }) };
}, id);

// ══ A/B ═══════════════════════════════════════════════════════════════
console.log('════ A: ruhend nach dem Laden ════');
{
  const { ctx, P } = await seite(stand());
  const e = await editoren(P);
  pruefe('A1 einfache Notizen haben keinen Editor', !e.includes('n1') && !e.includes('n2') && !e.includes('n3') && !e.includes('n5'), JSON.stringify(e));
  pruefe('A2 der Inhalt steht da (Überschrift, Zitat, Schluss)', await P.evaluate(() => { const tx = document.querySelector('.react-flow__node[data-id="n1"]').textContent; return tx.includes('Besprechung Relaunch') && tx.includes('Ein Zitat') && tx.includes('Schluss'); }));
  pruefe('A3 kein Mantine-Stilblock in ruhenden Notizen', await P.evaluate(() => document.querySelectorAll('.react-flow__node[data-id="n1"] style, .react-flow__node[data-id="n2"] style').length === 0));

  console.log('\n════ B: pixelgleich mit dem Editor ════');
  const vor = await lagen(P, 'n1');
  // wecken ohne Klick in den Text (kein Cursor, keine Fokus-Platzhalter): über das Ereignis der Zeichenebene
  await P.evaluate(() => window.dispatchEvent(new CustomEvent('pixinotes:notiz-aktiv', { detail: { id: 'n1' } })));
  await P.waitForTimeout(900);
  const nach = await lagen(P, 'n1');
  pruefe('B1 der Editor ist da', vor.ruhend && !nach.ruhend && (await editoren(P)).includes('n1'));
  pruefe('B2 gleich viele Blöcke, gleiche Kartenhöhe', vor.bloecke.length === nach.bloecke.length && vor.bloecke.length === 18 && vor.hoehe === nach.hoehe, JSON.stringify({ vor: [vor.bloecke.length, vor.hoehe, vor.bloecke.map((b) => b.typ[0] + ':' + b.text)], nach: [nach.bloecke.length, nach.hoehe, nach.bloecke.map((b) => b.typ[0] + ':' + b.text)] }));
  const abweichung = [];
  vor.bloecke.forEach((b, i) => { const n = nach.bloecke[i]; if (!n) return; for (const k of ['x', 'y', 'w', 'h', 'ix', 'iw', 'ih']) if (Math.abs(b[k] - n[k]) > 0.6) abweichung.push(`${i} ${b.typ} „${b.text}" ${k}: ${b[k]} → ${n[k]}`); if (b.schrift !== n.schrift) abweichung.push(`${i} ${b.typ} Schrift ${b.schrift} → ${n.schrift}`); if (b.index !== n.index) abweichung.push(`${i} Nummer ${b.index} → ${n.index}`); });
  pruefe('B3 jeder Block liegt, wo er ruhend lag — Lage, Größe, Schrift, Nummer', abweichung.length === 0, '\n      ' + abweichung.slice(0, 12).join('\n      '));
  pruefe('B4 Nummern laufen wie im Editor (1, 2, neu ab 5)', JSON.stringify(vor.bloecke.filter((b) => b.typ === 'numberedListItem').map((b) => b.index)) === '["1","2","5"]', JSON.stringify(vor.bloecke.filter((b) => b.typ === 'numberedListItem').map((b) => b.index)));
  await ctx.close();
}

// ══ C ═════════════════════════════════════════════════════════════════
console.log('\n════ C: Klick weckt, Cursor an der Klickstelle ════');
{
  const { ctx, P } = await seite(stand());
  // zwischen „schöne" und „Welt" klicken: Wortgrenze aus dem ruhenden DOM lesen
  const punkt = await P.evaluate(() => {
    const p = document.querySelector('.react-flow__node[data-id="n3"] .bn-inline-content');
    const tn = p.firstChild; const r = document.createRange();
    const i = tn.textContent.indexOf('Welt'); r.setStart(tn, i); r.setEnd(tn, i + 1);
    const b = r.getBoundingClientRect(); return { x: b.left - 1, y: b.top + b.height / 2 };
  });
  await P.mouse.click(punkt.x, punkt.y);
  await P.waitForTimeout(500);
  pruefe('C1 der Klick weckt den Editor und gibt ihm den Fokus', (await editoren(P)).includes('n3') && await P.evaluate(() => !!document.activeElement?.closest('.react-flow__node[data-id="n3"]')));
  await P.keyboard.type('große ');
  await P.waitForTimeout(700);
  const n3 = await knoten(P, 'n3');
  pruefe('C2 getippter Text landet an der Klickstelle', JSON.stringify(n3.data.blocks).includes('Hallo schöne große Welt da draußen'), JSON.stringify(n3.data.blocks).slice(0, 200));
  pruefe('C3 die Karte ist ausgewählt (Auswahl-Leiste)', await P.evaluate(() => document.querySelector('.react-flow__node[data-id="n3"]').classList.contains('selected')));
  await ctx.close();
}

// ══ D ═════════════════════════════════════════════════════════════════
console.log('\n════ D: Haken ruhend umlegen ════');
{
  const { ctx, P } = await seite(stand());
  await P.locator('.react-flow__node[data-id="n2"] input[type="checkbox"]').nth(1).click();
  await P.waitForTimeout(700);
  let n2 = await knoten(P, 'n2');
  pruefe('D1 „Brot" ist abgehakt — in den Daten und in der Ansicht', n2.data.blocks[2].props?.checked === true && await P.evaluate(() => document.querySelectorAll('.react-flow__node[data-id="n2"] [data-checked="true"]').length === 2));
  pruefe('D2 dabei entsteht kein Editor', !(await editoren(P)).includes('n2'));
  pruefe('D3 der Fortschritt zeigt 2/3', await P.evaluate(() => document.querySelector('.react-flow__node[data-id="n2"] .note-fortschritt-text')?.textContent.includes('2/3')));
  await P.locator('.react-flow__pane').click({ position: { x: 20, y: 700 } });
  await P.keyboard.press('Control+z'); await P.waitForTimeout(700);
  n2 = await knoten(P, 'n2');
  pruefe('D4 Strg+Z nimmt den Haken zurück', n2.data.blocks[2].props?.checked !== true && await P.evaluate(() => document.querySelectorAll('.react-flow__node[data-id="n2"] [data-checked="true"]').length === 1), JSON.stringify(n2.data.blocks[2].props));
  await ctx.close();
}

// ══ E ═════════════════════════════════════════════════════════════════
console.log('\n════ E: Verweilen und Fokus wecken ════');
{
  const { ctx, P } = await seite(stand(), { einKlick: true });
  const box = await P.locator('.react-flow__node[data-id="n2"] .note-editor').boundingBox();
  await P.mouse.move(box.x + 30, box.y + 12); await P.waitForTimeout(80);
  pruefe('E1 nach 80 ms Verweilen ruht die Notiz noch', !(await editoren(P)).includes('n2'));
  await P.waitForTimeout(600);
  pruefe('E2 nach dem Verweilen ist der Editor vorgewärmt — ohne Fokus', (await editoren(P)).includes('n2') && await P.evaluate(() => !document.activeElement?.closest('.note-editor')));
  // Fokus (ein Klick, wie am Tablet eingestellt) weckt n1
  const k1 = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
  await P.mouse.click(k1.x + k1.width / 2, k1.y + k1.height - 6);
  await P.waitForTimeout(1100);
  pruefe('E3 im Fokus hat die Notiz ihren Editor', await P.evaluate(() => !!document.querySelector('.app.focus-mode')) && (await editoren(P)).includes('n1'));
  await ctx.close();
}

// ══ F/G ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Tabellen- und leere Notiz · G: Ids ════');
{
  const { ctx, P } = await seite(stand());
  pruefe('F1 die Notiz mit Tabelle hat sofort ihren Editor', (await editoren(P)).includes('n4'));
  // neue Notiz per Doppelklick auf die Fläche
  await P.mouse.dblclick(300, 760); await P.waitForTimeout(900);
  const neu = await P.evaluate(() => { const a = document.activeElement?.closest('.react-flow__node-note'); return a ? { id: a.getAttribute('data-id'), editor: !!a.querySelector('[contenteditable="true"]') } : null; });
  pruefe('F2 eine neue, leere Notiz hat Editor und Cursor', !!neu?.editor, JSON.stringify(neu));
  const n5 = await knoten(P, 'n5');
  pruefe('G1 bloßes Ansehen schreibt nichts: Blöcke ohne Id bleiben, wie sie sind (kein Hochladen durch den Abgleich)', n5.data.blocks.every((b) => !b.id), JSON.stringify(n5.data.blocks.map((b) => b.id ?? null)));
  pruefe('G2 die ruhende Ansicht gibt ihnen Pfad-Ids (Stift und Handschrift finden sie darüber)', await P.evaluate(() => ['_r0', '_r1'].every((id) => document.querySelector(`.react-flow__node[data-id="n5"] .bn-block[data-id="${id}"]`))));
  await ctx.close();
}

// ══ H ═════════════════════════════════════════════════════════════════
console.log('\n════ H: Fern-Ruhe ════');
{
  const fernN = { id: 'f1', type: 'note', width: 280, position: { x: 9000, y: 6000 }, data: { color: 'yellow', blocks: [{ id: 'q1', type: 'heading', props: { level: 3 }, content: [t('Weit weg')] }, { id: 'q2', type: 'paragraph', content: [t('Diese Karte liegt weit außerhalb des Bildes und ruht.')] }, { id: 'q3', type: 'checkListItem', content: [t('Punkt')] }] } };
  const { ctx, P } = await seite(stand([fernN]));
  // Ansicht auf die nahen Karten: „Alles einpassen" zeigt alles — also gezielt hineinzoomen
  const nahBox = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
  // erst die nahen Karten in die Bildmitte schieben (Rad schwenkt), dann dort hineinzoomen
  await P.mouse.move(720, 500);
  await P.mouse.wheel(nahBox.x + nahBox.width / 2 - 720, nahBox.y + nahBox.height / 2 - 500); await P.waitForTimeout(300);
  for (let i = 0; i < 14; i++) { await P.keyboard.down('Control'); await P.mouse.wheel(0, -240); await P.keyboard.up('Control'); await P.waitForTimeout(40); }
  await P.waitForTimeout(900);
  const zustand = () => P.evaluate(() => { const k = document.querySelector('.react-flow__node[data-id="f1"]'); const s = k.querySelector('.card-shell'); const b = s.querySelector('.card-body'); const r = k.getBoundingClientRect(); return { fern: s.hasAttribute('data-fern'), cv: getComputedStyle(b).contentVisibility, hoehe: k.offsetHeight, breite: k.offsetWidth, imBild: r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight, nah: [...document.querySelectorAll('.react-flow__node')].filter((n) => { const q = n.getBoundingClientRect(); return q.right > 0 && q.left < innerWidth && q.bottom > 0 && q.top < innerHeight; }).map((n) => n.querySelector('.card-shell')?.hasAttribute('data-fern')) }; });
  const weg = await zustand();
  pruefe('H1 die ferne Karte ruht (Inhalt wird nicht gerechnet), keine Karte im Bild ruht', weg.fern && weg.cv === 'hidden' && !weg.imBild && weg.nah.every((f) => f === false), JSON.stringify(weg));
  const gemessen = (await knoten(P, 'f1')).measured;
  pruefe('H2 ihre Größe bleibt die gemessene', weg.hoehe > 60 && gemessen && Math.abs(gemessen.height - weg.hoehe) <= 1 && weg.breite === 280, JSON.stringify({ weg, gemessen }));
  // „alles zeigen" (Export/Druck)
  await P.evaluate(() => document.documentElement.setAttribute('data-alles-zeigen', '')); await P.waitForTimeout(200);
  const gezeigt = await zustand();
  pruefe('H3 „alles zeigen" (Export, Druck) hebt die Ruhe auf, die Höhe bleibt gleich', gezeigt.cv === 'visible' && gezeigt.hoehe === weg.hoehe, JSON.stringify(gezeigt));
  await P.evaluate(() => document.documentElement.removeAttribute('data-alles-zeigen'));
  // Alles einpassen (Taste F) holt die Karte ins Bild
  await P.locator('.react-flow__pane').click({ position: { x: 10, y: 800 } });
  await P.keyboard.press('f'); await P.waitForTimeout(1200);
  const da = await zustand();
  pruefe('H4 kommt die Karte ins Bild, ist ihr Inhalt wieder da — gleiche Höhe, keine der sichtbaren Karten ruht', !da.fern && da.cv === 'visible' && da.imBild && da.hoehe === weg.hoehe && da.nah.length >= 6 && da.nah.every((f) => f === false), JSON.stringify(da));
  await ctx.close();
}

// ══ I ═════════════════════════════════════════════════════════════════
console.log('\n════ I: 300 Karten ════');
{
  const viele = Array.from({ length: 300 }, (_, i) => ({ id: `v${i}`, type: 'note', width: 280, position: { x: 1400 + (i % 22) * 320, y: (Math.floor(i / 22)) * 260 }, data: { color: ['yellow', 'pink', 'mint', 'sky', 'white'][i % 5], blocks: [
    { id: `va${i}`, type: 'heading', props: { level: 3 }, content: [t(`Karte ${i}`)] }, { id: `vb${i}`, type: 'paragraph', content: [t('Absatz mit etwas Text, damit die Karte realistisch gefüllt ist.')] },
    { id: `vc${i}`, type: 'checkListItem', props: { checked: i % 2 === 0 }, content: [t('Erster Punkt')] }, { id: `vd${i}`, type: 'checkListItem', content: [t('Zweiter Punkt')] }, { id: `ve${i}`, type: 'bulletListItem', content: [t('Stichpunkt')] }] } }));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((st) => { localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st })); }, stand(viele));
  const P = await ctx.newPage();
  const t0 = Date.now();
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'commit' });
  await P.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 300 && !!document.querySelector('.dock'), null, { timeout: 60000 });
  const ms = Date.now() - t0;
  await P.waitForTimeout(800);
  const e = await editoren(P);
  pruefe(`I1 305 Karten stehen in ${ms} ms (Grenze 12 s; vorher 49 s)`, ms < 12000, `${ms} ms`);
  pruefe('I2 dabei entsteht nur der eine Editor der Tabellen-Notiz', e.length === 1 && e[0] === 'n4', JSON.stringify(e));
  await ctx.close();
}

// ══ J ═════════════════════════════════════════════════════════════════
console.log('\n════ J ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('J1 „Was ist neu" nennt M338', js.includes('(M338)'));

await browser.close();
app.close();
console.log(`\nm338-ruhe: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
