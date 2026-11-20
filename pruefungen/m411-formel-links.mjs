/**
 * M411 — Links in Tabellen: auch die, deren Adresse eine Formel zusammensetzt.
 *
 * Gemeldet: „HTML-Hyperlinks werden in den Tabellen weiterhin nicht richtig angezeigt. Dort steht nur eine Nummer
 * statt dem Text/Link – man kann auch nicht anklicken."
 *
 * Nachgestellt mit Dateien, wie XlsxWriter (wie Excel) und LibreOffice sie schreiben: Links an der Zelle gingen,
 * =HYPERLINK("https://…") auch. Nicht aber die übliche Schreibweise =HYPERLINK("https://…/ticket/"&C3; C3) – das
 * Ziel wurde aus dem TEXT der Formel gelesen und nur gefunden, wenn es wörtlich dastand. In der Zelle stand dann
 * „4.712": eine Nummer mit Tausenderpunkt, nicht anklickbar.
 *
 *   A  Excel-Datei: zusammengesetzte Adresse (mit Text und mit der Nummer selbst), Zelle als Adresse, bedingt;
 *      Formel, deren Text hier nicht rechnet (der Link bleibt); Unsicheres wird kein Link; eine Zelle, die nur auf
 *      eine Link-Zelle zeigt, erbt nichts. Nummern mit Link stehen ohne Tausenderpunkt da.
 *   B  LibreOffice-Datei (aus einer HTML-Tabelle mit <a href>): Text und Ziel je Zelle.
 *   C  Selbst getippt: Die Adresse folgt der Zelle, aus der sie gebaut wird; Klick und Fingertipp öffnen sie –
 *      der Bearbeiten-Stift lag bei rechtsbündigen Nummern AUF dem Link und fing den Tipp ab; er sitzt dort jetzt links.
 */
// Läuft aus dem Repository: `node pruefungen/m411-formel-links.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4727;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const auf = async (nodes = [], wahl = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: wahl.viewport ?? { width: 1440, height: 900 }, hasTouch: !!wahl.touch, isMobile: !!wahl.touch });
  await ctx.route(/example\.org/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Ziel</title>ok' }));
  await ctx.addInitScript(([nn]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: nn }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [nodes]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
};
const daten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0]?.data ?? null);
const anzahl = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.length);
const einfuegen = async (P, datei) => {
  const felder = P.locator('input[type="file"]');
  const c = await felder.count();
  for (let i = 0; i < c; i++) {
    try { await felder.nth(i).setInputFiles(datei); await P.waitForTimeout(1600); if ((await anzahl(P)) > 0) break; } catch { /* nächstes Feld */ }
  }
  await P.waitForTimeout(1100);
};
/** Text einer Zelle und das Ziel ihres Links (null: kein Link) */
const zelle = (P, adr) => P.evaluate((a) => { const td = document.querySelector(`.sheet-grid td[data-zelle="${a}"]`); if (!td) return null; const l = td.querySelector('a.sheet-link'); return { text: (l ?? td.querySelector('span') ?? td).textContent.trim(), link: l?.getAttribute('href') ?? null }; }, adr);
/** Den Link einer Zelle öffnen (Maus oder Finger) und die Adresse des neuen Fensters liefern */
const oeffne = async (ctx, P, adr, finger = false) => {
  const b = await P.locator(`.sheet-grid td[data-zelle="${adr}"] a.sheet-link`).boundingBox();
  if (!b) return 'kein Link';
  const fenster = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
  if (finger) await P.touchscreen.tap(b.x + Math.min(12, b.width / 2), b.y + b.height / 2); else await P.mouse.click(b.x + Math.min(12, b.width / 2), b.y + b.height / 2);
  const neu = await fenster;
  if (!neu) return 'kein Fenster';
  await neu.waitForURL(/example\.org/, { timeout: 4000 }).catch(() => {});
  const u = neu.url(); await neu.close();
  return u;
};

// ---------- A ----------
console.log('A  Excel-Datei: Links aus Formeln');
{
  const { ctx, P } = await auf();
  await einfuegen(P, path.join(__repo, 'pruefungen', 'daten', 'm411-links.xlsx'));
  const d = await daten(P);
  const d3 = await zelle(P, 'D3');
  pruefe('A1 =HYPERLINK("…?id="&C3; C3): die Nummer ist der Link – „4712", ohne Tausenderpunkt, mit ausgerechneter Adresse', d3?.text === '4712' && d3.link === 'https://example.org/t?id=4712', d3);
  pruefe('A2 … und lässt sich anklicken', (await oeffne(ctx, P, 'D3')) === 'https://example.org/t?id=4712');
  const d2 = await zelle(P, 'D2');
  pruefe('A3 zusammengesetzte Adresse mit zusammengesetztem Text', d2?.text === 'Auftrag 4711' && d2.link === 'https://example.org/t?id=4711', d2);
  const d4 = await zelle(P, 'D4'); const d5 = await zelle(P, 'D5'); const d8 = await zelle(P, 'D8');
  pruefe('A4 Zelle als Adresse, mit und ohne eigenen Text; Link in einer Bedingung', d4?.link === 'https://example.org/beamer' && d5?.text === 'Beamer' && d5.link === 'https://example.org/beamer' && d8?.text === 'Bedingt' && d8.link === 'https://example.org/wenn', { d4, d5, d8 });
  const d6 = await zelle(P, 'D6');
  pruefe('A5 der Text rechnet hier nicht (unbekannte Funktion): Es steht der gemerkte Text – und der Link bleibt', d6?.text === 'Beamer' && d6.link === 'https://example.org/x/4711' && d?.links?.D6 === 'https://example.org/x/4711' && d?.cells?.D6 === 'Beamer', { d6, gemerkt: d?.links?.D6 });
  const d7 = await zelle(P, 'D7'); const d9 = await zelle(P, 'D9'); const d10 = await zelle(P, 'D10');
  pruefe('A6 kein Ziel zu rechnen: bleibt Text; javascript: wird kein Link', d7?.text === 'Ohne Ziel' && d7.link === null && d10?.text === 'Unsicher' && d10.link === null, { d7, d10 });
  pruefe('A7 eine Zelle, die nur auf eine Link-Zelle zeigt (=D3), erbt den Link nicht und bleibt eine gewöhnliche Zahl', d9?.text === '4.712' && d9.link === null, d9);
  const b6 = await zelle(P, 'B6'); const c7 = await zelle(P, 'C7'); const c2 = await zelle(P, 'C2');
  pruefe('A8 Nummern mit einem Link an der Zelle: „12345" und „100234" ohne Tausenderpunkt; Zahlen ohne Link wie bisher', b6?.text === '12345' && b6.link === 'https://example.org/zahl' && c7?.text === '100234' && c7.link === 'https://example.org/nummer' && c2?.text === '4.711' && c2.link === null, { b6, c7, c2 });
  const b3 = await zelle(P, 'B3'); const b4 = await zelle(P, 'B4'); const b5 = await zelle(P, 'B5');
  pruefe('A9 Links an der Zelle wie gehabt: Text mit Ziel, Mail; ein Sprung im Blatt ist kein Link', b3?.text === 'Zum Shop' && b3.link === 'https://example.org/leinwand' && b4?.link === 'mailto:info@example.org' && b5?.text === 'Nach oben' && b5.link === null, { b3, b4, b5 });
  // Filterliste nennt die Nummer so, wie sie in der Zelle steht
  await P.locator('.react-flow__node .card-menu-btn, .react-flow__node button[title^="Mehr"]').first().click().catch(() => {});
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Filtern und sortieren/.test(b.textContent ?? ''))?.click());
  await P.waitForTimeout(400);
  await P.locator('[data-taste="sheet-filter"][data-spalte="D"]').click().catch(() => {});
  await P.waitForTimeout(400);
  const werte = await P.evaluate(() => [...document.querySelectorAll('[data-taste="sheet-filter-wert"]')].map((e) => e.getAttribute('data-wert')));
  pruefe('A10 die Filterliste der Spalte nennt die Nummer wie die Zelle („4712")', werte.includes('4712'), werte);
  await P.keyboard.press('Escape');
  await P.screenshot({ path: path.join(SD, 'm411-links.png') });
  await ctx.close();
}

// ---------- B ----------
console.log('B  LibreOffice-Datei (aus einer HTML-Tabelle mit Links)');
{
  const { ctx, P } = await auf();
  await einfuegen(P, path.join(__repo, 'pruefungen', 'daten', 'm411-libreoffice.xlsx'));
  const b2 = await zelle(P, 'B2'); const c2 = await zelle(P, 'C2'); const b3 = await zelle(P, 'B3'); const b4 = await zelle(P, 'B4'); const c4 = await zelle(P, 'C4');
  pruefe('B1 Text mit Ziel, Adresse als Text, Mail', b2?.text === 'Zum Beamer' && b2.link === 'https://example.org/beamer' && b3?.link === 'https://example.org/leinwand' && b4?.link === 'mailto:info@example.org', { b2, b3, b4 });
  pruefe('B2 eine verlinkte Nummer steht als „4711" da und führt zu ihrem Ziel', c2?.text === '4711' && c2.link === 'https://example.org/t/4711' && (await oeffne(ctx, P, 'C2')) === 'https://example.org/t/4711', c2);
  pruefe('B3 Link mitten im Satz: der ganze Satz steht da und trägt das Ziel', c4?.text === 'Text mit Link im Satz und mehr' && c4.link === 'https://example.org/teil', c4);
  await ctx.close();
}

// ---------- C ----------
console.log('C  Selbst getippt; Maus und Finger');
const eigene = () => [{ id: 't1', type: 'sheet', position: { x: 0, y: 0 }, width: 460, height: 260, data: { title: 'Tickets', cols: 3, rows: 5, cells: { A1: 'Ticket', B1: 'Nr', A2: '=HYPERLINK("https://example.org/t/"&B2;B2)', B2: '4711', A3: '=HYPERLINK("https://example.org/t/"&B3;"Ticket "&B3)', B3: '5000' } } }];
{
  const { ctx, P } = await auf(eigene());
  const a2 = await zelle(P, 'A2');
  pruefe('C1 getippte Formel: Nummer als Link', a2?.text === '4711' && a2.link === 'https://example.org/t/4711', a2);
  await P.locator('.sheet-grid td[data-zelle="B2"]').click(); await P.waitForTimeout(200);
  await P.keyboard.press('Control+a'); await P.keyboard.type('4800'); await P.keyboard.press('Enter'); await P.waitForTimeout(400);
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  const neu = await zelle(P, 'A2');
  pruefe('C2 ändert sich die Nummer, folgen Text und Adresse', neu?.text === '4800' && neu.link === 'https://example.org/t/4800' && (await oeffne(ctx, P, 'A2')) === 'https://example.org/t/4800', neu);
  // der Stift führt weiter zum Bearbeiten der Formel
  await P.locator('.sheet-grid td[data-zelle="A3"]').hover(); await P.waitForTimeout(150);
  await P.locator('.sheet-grid td[data-zelle="A3"] [data-taste="sheet-link-stift"]').click(); await P.waitForTimeout(250);
  const feld = await P.locator('.sheet-grid td[data-zelle="A3"] input').inputValue().catch(() => '');
  pruefe('C3 der Stift öffnet die Formel zum Bearbeiten', feld.startsWith('=HYPERLINK('), feld);
  await P.keyboard.press('Escape');
  await ctx.close();
}
{
  const { ctx, P } = await auf(eigene(), { viewport: { width: 390, height: 800 }, touch: true });
  const lage = await P.evaluate(() => { const td = document.querySelector('.sheet-grid td[data-zelle="A2"]'); const l = td.querySelector('a.sheet-link').getBoundingClientRect(); const st = td.querySelector('.sheet-link-stift').getBoundingClientRect(); return { link: [Math.round(l.left), Math.round(l.right)], stift: [Math.round(st.left), Math.round(st.right)] }; });
  pruefe('C4 Telefon: der Stift liegt nicht auf der rechtsbündigen Nummer (vorher verdeckte er sie)', lage.stift[1] <= lage.link[0] || lage.stift[0] >= lage.link[1], lage);
  pruefe('C5 Telefon: ein Fingertipp auf die Nummer öffnet ihr Ziel – nicht die Bearbeitung', (await oeffne(ctx, P, 'A2', true)) === 'https://example.org/t/4711' && (await P.locator('.sheet-grid input').count()) === 0);
  const a3 = await P.evaluate(() => { const td = document.querySelector('.sheet-grid td[data-zelle="A3"]'); const l = td.querySelector('a.sheet-link').getBoundingClientRect(); const st = td.querySelector('.sheet-link-stift').getBoundingClientRect(); return { link: [Math.round(l.left), Math.round(l.right)], stift: [Math.round(st.left), Math.round(st.right)] }; });
  pruefe('C6 Telefon: bei linksbündigem Text bleibt der Stift rechts, neben dem Link', a3.stift[0] >= a3.link[1] - 1, a3);
  await ctx.close();
}
pruefe('C7 keine Fehler in der Seite', fehler.length === 0, fehler.slice(0, 3));

await browser.close(); app.close();
console.log(`\nM411: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
