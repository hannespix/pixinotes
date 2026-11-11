/**
 * M350 — Eigenes Rechtsklick-Menü statt des Browser-Menüs.
 *
 *   A  Freie Fläche: Browser-Menü unterdrückt, eigenes Menü am Zeiger; „Notiz hier" legt sie dort an;
 *      „Modul hier einfügen" öffnet die Palette, das Modul landet an der Klickstelle.
 *   B  Karte: wird gewählt, das Karten-Menü öffnet am Zeiger (Öffnen, Duplizieren, Teilen, Löschen);
 *      eine Mehrfach-Auswahl bleibt erhalten.
 *   C  Ausnahmen: im Notiz-Text beim Schreiben und mit Umschalt bleibt das Browser-Menü.
 *   D  Navigationsbaum: das ⋯-Menü der Zeile am Zeiger.   E  Verbindung: benennen, löschen.
 *   F  Esc und Klick daneben schließen.   G  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m350-kontextmenue.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4568;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const nz = (id, x, y, farbe = 'yellow') => ({ id, type: 'note', width: 240, height: 130, autoFit: false, position: { x, y }, data: { color: farbe, blocks: [{ id: id + 't', type: 'paragraph', content: 'Karte ' + id }] } });
const stand = () => ({
  boards: [
    { id: 'b1', name: 'Planung', comments: [], drawings: [], nodes: [nz('n1', 0, 0), nz('n2', 420, 0, 'sky'), nz('n3', 0, 260, 'mint')],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'labeled', data: {} }] },
    { id: 'b2', name: 'Ideen', comments: [], edges: [], drawings: [], nodes: [nz('m1', 0, 0)] },
  ],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Kunden', boardIds: ['b1', 'b2'] }] }],
  activeId: 'b1', view: 'board',
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(({ st }) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: true }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, { st: stand() });
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
// Wurde das Browser-Menü verhindert? (Zuhörer am Ende der Kette)
await P.evaluate(() => { window.addEventListener('contextmenu', (e) => { window.__verhindert = e.defaultPrevented; }); });
const verhindert = () => P.evaluate(() => window.__verhindert);
const knoten = async () => { await P.waitForTimeout(1300); return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]); };
const rect = (sel) => P.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].filter((x) => x.getBoundingClientRect().width > 2)[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
const flaeche = { x: 1250, y: 330 };
const eintrag = (menue, text) => P.evaluate(({ menue, text }) => { const b = [...document.querySelectorAll(`${menue} button`)].find((x) => x.textContent.includes(text)); if (!b) return false; b.click(); return true; }, { menue, text });

console.log('\n════ A: freie Fläche ════');
{
  const vor = (await knoten()).nodes.length;
  await P.mouse.click(flaeche.x, flaeche.y, { button: 'right' }); await P.waitForTimeout(350);
  const m = await rect('.kontext-menue');
  // am Zeiger — außer der Bildrand ist zu nah, dann daran verankert (8 Punkte Luft)
  const amX = !!m && (Math.abs(m.left - flaeche.x) < 4 || Math.abs(m.right - (1440 - 8)) < 1.5);
  const amY = !!m && (Math.abs(m.top - flaeche.y) < 4 || Math.abs(m.bottom - (900 - 8)) < 1.5);
  pruefe('A1 Browser-Menü verhindert, eigenes Menü am Zeiger (ganz im Bild)', (await verhindert()) === true && amX && amY && m.left >= 8 && m.right <= 1432.5, m);
  const texte = await P.evaluate(() => [...document.querySelectorAll('.kontext-menue button')].map((b) => b.textContent));
  pruefe('A2 das Menü bietet Notiz, Modul, Einpassen, Auswählen, Zeichnen, Raster', ['Notiz hier', 'Modul hier einfügen', 'Alles einpassen', 'Alles auswählen', 'Zeichnen', 'Raster-Fang'].every((t) => texte.some((x) => x.includes(t))), texte);
  const fokus = await P.evaluate(() => !!document.activeElement?.closest('.kontext-menue'));
  pruefe('A3 der erste Eintrag hat den Tastatur-Fokus (Pfeiltasten gehen sofort)', fokus);
  await eintrag('.kontext-menue', 'Notiz hier'); await P.waitForTimeout(300);
  const b = await knoten();
  const neu = b.nodes.find((n) => !['n1', 'n2', 'n3'].includes(n.id));
  const r = neu ? await rect(`.react-flow__node[data-id="${neu.id}"]`) : null;
  pruefe('A4 „Notiz hier" legt eine Notiz an der Klickstelle an', b.nodes.length === vor + 1 && !!r && Math.abs(r.left - (flaeche.x - 20)) < 40 && Math.abs(r.top - (flaeche.y - 16)) < 40, { r, n: b.nodes.length });
  pruefe('A5 danach ist das Menü zu', !(await rect('.kontext-menue')));
  await P.keyboard.press('Escape'); await P.mouse.click(1380, 120); await P.waitForTimeout(300);
  // Modul hier einfügen
  const ziel = { x: 1250, y: 560 };
  const flow = await P.evaluate(({ x, y }) => { const v = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform); const rf = document.querySelector('.react-flow').getBoundingClientRect(); const z = Number(v[3]); return { x: (x - 12 - rf.left - Number(v[1])) / z, y: (y - 12 - rf.top - Number(v[2])) / z }; }, ziel);
  await P.mouse.click(ziel.x, ziel.y, { button: 'right' }); await P.waitForTimeout(300);
  await eintrag('.kontext-menue', 'Modul hier einfügen'); await P.waitForTimeout(450);
  const palette = !!(await rect('.modul-palette'));
  await P.evaluate(() => [...document.querySelectorAll('.modul-palette .modul-kachel')].find((b) => b.textContent.trim().startsWith('Kanban'))?.click());
  await P.waitForTimeout(900);
  const b2 = await knoten();
  const kan = b2.nodes.find((n) => n.type === 'kanban');
  const kr = kan ? await rect(`.react-flow__node[data-id="${kan.id}"]`) : null;
  pruefe('A6 „Modul hier einfügen" öffnet die Palette, das Modul landet an der Klickstelle', palette && !!kan && !!kr, { palette, kr });
  // Kamera kann zum neuen Modul fliegen — die Lage im Board zählt: oben links am Klickpunkt
  // Ziel-Lage im Board aus der Kamera VOR dem Einfügen (die Kamera fliegt danach zum Modul)
  pruefe('A7 die Lage im Board entspricht der Klickstelle (± 20)', !!kan && Math.abs(kan.position.x - flow.x) < 20 && Math.abs(kan.position.y - flow.y) < 20, { pos: kan?.position, flow });
}

console.log('\n════ B: Karte ════');
{
  await P.keyboard.press('Escape'); await P.mouse.click(1380, 120); await P.waitForTimeout(300);
  await P.keyboard.press('f'); await P.waitForTimeout(700);
  const r = await rect('.react-flow__node[data-id="n2"]');
  const pt = { x: r.left + r.width / 2, y: r.top + r.height / 2 + 10 };
  await P.mouse.click(pt.x, pt.y, { button: 'right' }); await P.waitForTimeout(450);
  const gew = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.dataset.id));
  const m = await rect('.sel-more-menu');
  pruefe('B1 Rechtsklick wählt die Karte und öffnet ihr Menü am Zeiger', (await verhindert()) === true && gew.join() === 'n2' && !!m && Math.abs(m.left - pt.x) < 30 && Math.abs(m.top - pt.y) < 30, { gew, m, pt });
  const texte = await P.evaluate(() => [...document.querySelectorAll('.sel-more-menu button')].map((b) => b.textContent.trim()));
  pruefe('B2 das Menü hat Öffnen, Duplizieren, Teilen und Löschen dazu', ['Öffnen', 'Duplizieren', 'Teilen', 'Löschen', 'Kommentar'].every((t) => texte.some((x) => x.startsWith(t))), texte);
  const sichtbar = await P.evaluate(() => { const m = document.querySelector('.sel-more-menu'); const r = m.getBoundingClientRect(); const l = [...m.querySelectorAll('button')].find((x) => x.textContent.includes('Löschen')).getBoundingClientRect(); return { innen: l.top >= r.top - 0.5 && l.bottom <= r.bottom + 0.5, imBild: r.bottom <= innerHeight && r.top >= 0, rollt: m.scrollHeight > m.clientHeight + 1 }; });
  pruefe('B2b alles ist ohne Rollen zu sehen, auch „Löschen", und das Menü bleibt im Bild', sichtbar.innen && sichtbar.imBild && !sichtbar.rollt, sichtbar);
  const vor = (await knoten()).nodes.length;
  await eintrag('.sel-more-menu', 'Duplizieren'); await P.waitForTimeout(300);
  pruefe('B3 „Duplizieren" aus dem Menü legt eine Kopie an', (await knoten()).nodes.length === vor + 1);
  // Mehrfach-Auswahl bleibt
  await P.keyboard.press('Escape'); await P.mouse.click(1380, 120); await P.waitForTimeout(300);
  const a = await rect('.react-flow__node[data-id="n1"]'); const c = await rect('.react-flow__node[data-id="n3"]');
  await P.mouse.click(a.left + a.width / 2, a.top + 6); await P.keyboard.down('Shift'); await P.mouse.click(c.left + c.width / 2, c.top + 6); await P.keyboard.up('Shift'); await P.waitForTimeout(300);
  await P.mouse.click(c.left + c.width / 2, c.top + c.height / 2 + 10, { button: 'right' }); await P.waitForTimeout(400);
  const gew2 = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.dataset.id).sort());
  pruefe('B4 Rechtsklick in eine Mehrfach-Auswahl lässt sie bestehen', gew2.join() === 'n1,n3' && !!(await rect('.sel-more-menu')), gew2);
  await P.keyboard.press('Escape'); await P.waitForTimeout(250);
  pruefe('F1 Esc schließt das Menü', !(await rect('.sel-more-menu')));
}

console.log('\n════ C: Ausnahmen ════');
{
  await P.mouse.click(1380, 120); await P.waitForTimeout(300);
  await P.keyboard.down('Shift'); await P.mouse.click(flaeche.x, flaeche.y, { button: 'right' }); await P.keyboard.up('Shift'); await P.waitForTimeout(250);
  pruefe('C1 Umschalt+Rechtsklick lässt das Browser-Menü zu (kein eigenes Menü)', (await verhindert()) === false && !(await rect('.kontext-menue')));
  // in den Notiz-Text schreiben
  const r = await rect('.react-flow__node[data-id="n1"] .bn-inline-content, .react-flow__node[data-id="n1"] p');
  await P.mouse.click(r.left + 20, r.top + 6); await P.waitForTimeout(700);
  const ed = await rect('.react-flow__node[data-id="n1"] [contenteditable="true"] p, .react-flow__node[data-id="n1"] [contenteditable="true"]');
  await P.mouse.click(ed.left + 20, ed.top + 6, { button: 'right' }); await P.waitForTimeout(250);
  pruefe('C2 im Notiz-Text beim Schreiben bleibt das Browser-Menü (Rechtschreibung, Einfügen)', (await verhindert()) === false && !(await rect('.sel-more-menu')));
  await P.keyboard.press('Escape'); await P.keyboard.press('Escape'); await P.mouse.click(1380, 120); await P.waitForTimeout(300);
}

console.log('\n════ D/E: Baum und Verbindung ════');
{
  const z = await rect('.nav-tree .side-board-name');
  const pt = { x: z.left + 20, y: z.top + z.height / 2 };
  await P.mouse.click(pt.x, pt.y, { button: 'right' }); await P.waitForTimeout(400);
  const m = await rect('.ebenen-menu');
  const texte = await P.evaluate(() => [...document.querySelectorAll('.ebenen-menu button')].map((b) => b.textContent.trim()));
  pruefe('D1 Rechtsklick auf ein Board im Baum öffnet sein ⋯-Menü am Zeiger', (await verhindert()) === true && !!m && Math.abs(m.left - pt.x) < 10 && Math.abs(m.top - pt.y) < 10 && texte.some((t) => t.startsWith('Umbenennen')), { m, pt, texte: texte.slice(0, 3) });
  await P.mouse.click(1380, 120); await P.waitForTimeout(300);
  pruefe('F2 Klick daneben schließt es', !(await rect('.ebenen-menu')));
  // Verbindung: Mitte des Pfads
  await P.keyboard.press('f'); await P.waitForTimeout(700);
  const mitte = await P.evaluate(() => { const p = document.querySelector('.react-flow__edge[data-id="e1"] path'); const l = p.getTotalLength(); const q = p.getPointAtLength(l / 3); const m = p.getScreenCTM(); return { x: q.x * m.a + m.e, y: q.y * m.d + m.f }; });
  await P.mouse.click(mitte.x, mitte.y, { button: 'right' }); await P.waitForTimeout(400);
  const texte2 = await P.evaluate(() => [...document.querySelectorAll('.kontext-menue button')].map((b) => b.textContent.trim()));
  pruefe('E1 Rechtsklick auf eine Verbindung: benennen und löschen', texte2.some((t) => t.startsWith('Beziehung benennen')) && texte2.some((t) => t.startsWith('Verbindung löschen')), texte2);
  await eintrag('.kontext-menue', 'Verbindung löschen'); await P.waitForTimeout(300);
  const kanten = (await knoten()).edges.map((e) => e.id);
  pruefe('E2 „Verbindung löschen" entfernt sie', !kanten.includes('e1'), kanten);
}

console.log('\n════ G: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('G1 Hilfe und Kürzel-Tabelle nennen das Rechtsklick-Menü, „Was ist neu" nennt M350', js.includes('(M350)') && js.includes('Umschalt+Rechtsklick: Menü des Browsers'));

await browser.close(); app.close();
console.log(`\nm350-kontextmenue: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
