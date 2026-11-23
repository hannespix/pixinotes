/**
 * M453 — Karten wissen, wann sie zuletzt geändert wurden.
 *
 *   A  Anlage setzt angelegt/geaendert; Verschieben (Pfeiltasten) ändert den Zeitpunkt nicht, Text schon;
 *      Strg+Z stellt Text UND Zeitpunkt zurück; Neuladen erhält die Zeitpunkte; alte Karten ohne Zeitpunkt
 *      bekommen kein erfundenes Datum.
 *   B  Fokus: „Geändert vor 10 Tagen" unter dem Titel, genaue Zeit im Tooltip; ohne Zeitpunkt „Änderung unbekannt".
 *   C  Suche (Strg+K): Alter am Treffer; „Zuletzt geändert zuerst" ordnet neueste zuerst, Unbekanntes ans Ende;
 *      ohne Suchwort die zuletzt geänderten Karten.
 *   D  Board-Briefing (ohne KI): „Lange unberührt" nennt die seit 40 Tagen unveränderte Karte und die E-Mail ohne
 *      Folgeaktivität – nicht die E-Mail mit Folgekarte, nicht die frische Karte, nicht die ohne Zeitpunkt.
 *   E  Keine Fehler.
 * Uhr: page.clock (fester Startpunkt, läuft weiter; fastForward springt).
 */
// Läuft aus dem Repository: `node pruefungen/m453-karten-zeit.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5453;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 700) : JSON.stringify(info).slice(0, 700)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

const T0 = Date.parse('2026-11-02T09:00:00+01:00');
const TAG = 86_400_000;
const absatz = (t) => ({ type: 'paragraph', content: t });
const notiz = (id, x, y, zeilen, zeit) => ({ id, type: 'note', position: { x, y }, width: 240, data: { color: 'yellow', blocks: zeilen.map(absatz) }, ...(zeit ? { angelegt: zeit, geaendert: zeit } : {}) });
const mail = (id, x, y, betreff, zeit) => ({ id, type: 'email', position: { x, y }, width: 280, data: { subject: betreff, fromName: 'Erika Muster', fromAddress: 'erika@example.org', text: `Text zu ${betreff}`, attachments: [] }, ...(zeit ? { angelegt: zeit, geaendert: zeit } : {}) });
const board = () => [
  notiz('n1', 40, 40, ['Altnotiz Projekt Alpha', 'liegt seit Wochen'], T0 - 40 * TAG),
  notiz('n2', 320, 40, ['Ohne Zeit Projekt Beta', 'aus einem alten Stand']),
  notiz('n3', 600, 40, ['Frisch Projekt Gamma', 'vorgestern geändert'], T0 - 2 * TAG),
  mail('e1', 40, 320, 'Rechnung Q3', T0 - 10 * TAG),
  mail('e2', 360, 320, 'Anfrage Messe', T0 - 10 * TAG),
  mail('e3', 680, 320, 'Altmail ohne Zeit'),
];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([nn]) => {
  try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
  localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    // e2 hat eine Folgekarte (n3, nach der Mail geändert) – e1 nicht
    boards: [{ id: 'b1', name: 'Zeit', edges: [{ id: 'k1', source: 'e2', target: 'n3' }], drawings: [], nodes: nn, comments: [] }],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: true, navLinks: false, clickZoom: false, physicsEnabled: false,
    ai: { provider: 'none', model: '', apiKey: '', baseUrl: '' } } }));
}, [board()]);
const P = await ctx.newPage();
await P.clock.install({ time: T0 });
P.on('pageerror', (e) => fehler.push(e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(1500);

const knoten = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const text = (n) => JSON.stringify(n?.data?.blocks ?? '');
const nahe = (a, b, ms = 60_000) => typeof a === 'number' && Math.abs(a - b) <= ms;
const kartenEl = (id) => P.locator(`.react-flow__node[data-id="${id}"]`);

// ---------- A: Anlage, Verschieben, Text, Undo, Neuladen ----------
console.log('A  Anlage setzt die Zeit, Verschieben nicht, Text schon');
await P.mouse.dblclick(1100, 700); await P.waitForTimeout(800);
await P.keyboard.type('Neue Karte M453', { delay: 15 }); await P.waitForTimeout(400);
await P.keyboard.press('Escape'); await P.waitForTimeout(1600);
let liste = await knoten();
const neu = liste.find((n) => !['n1', 'n2', 'n3', 'e1', 'e2', 'e3'].includes(n.id));
const id = neu?.id;
pruefe('A1 neue Karte trägt angelegt und geaendert (jetzt)', !!neu && nahe(neu.angelegt, T0) && nahe(neu.geaendert, T0) && text(neu).includes('Neue Karte M453'), { angelegt: neu?.angelegt, geaendert: neu?.geaendert, T0 });
const g1 = neu?.geaendert;
pruefe('A2 alte Karte ohne Zeitpunkt bleibt ohne (kein erfundenes Datum)', liste.find((n) => n.id === 'n2')?.geaendert === undefined && liste.find((n) => n.id === 'n2')?.angelegt === undefined);

await P.clock.fastForward('01:00:00');
await kartenEl(id).click({ position: { x: 4, y: 4 } }).catch(() => {});
await P.keyboard.press('Escape'); await P.waitForTimeout(200);
// Karte wählen (Rand anklicken) und mit den Pfeiltasten verschieben
await P.evaluate((i) => { const el = [...document.querySelectorAll('.react-flow__node')].find((e) => e.dataset.id === i); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, id);
await P.waitForTimeout(200);
const vorPos = (await knoten()).find((n) => n.id === id)?.position;
await P.keyboard.press('ArrowRight'); await P.keyboard.press('ArrowRight'); await P.keyboard.press('ArrowDown');
await P.waitForTimeout(1600);
let k = (await knoten()).find((n) => n.id === id);
const bewegt = vorPos && (k.position.x !== vorPos.x || k.position.y !== vorPos.y);
// Fallback: mit der Maus ziehen, falls die Auswahl per Tastatur nicht griff
if (!bewegt) {
  const box = await kartenEl(id).boundingBox();
  await P.mouse.move(box.x + 3, box.y + 3); await P.mouse.down(); await P.mouse.move(box.x + 80, box.y + 60, { steps: 8 }); await P.mouse.up();
  await P.waitForTimeout(1600);
  k = (await knoten()).find((n) => n.id === id);
}
pruefe('A3 Verschieben ändert die Lage, nicht den Zeitpunkt', vorPos && (k.position.x !== vorPos.x || k.position.y !== vorPos.y) && k.geaendert === g1, { vorPos, nach: k?.position, g: k?.geaendert, g1 });

await P.clock.fastForward('02:00:00');
const feld = kartenEl(id).locator('[contenteditable="true"]').first();
await feld.click(); await P.keyboard.press('End');
await P.keyboard.type(' mehr Text', { delay: 15 }); await P.waitForTimeout(300);
await P.keyboard.press('Escape'); await P.waitForTimeout(1600);
k = (await knoten()).find((n) => n.id === id);
pruefe('A4 Textänderung stempelt neu (drei Stunden später)', text(k).includes('mehr Text') && nahe(k.geaendert, T0 + 3 * 3600_000) && k.angelegt === neu?.angelegt, { g: k?.geaendert, soll: T0 + 3 * 3600_000 });

await P.mouse.click(1300, 860); await P.waitForTimeout(200);
await P.keyboard.press('Control+z'); await P.waitForTimeout(1600);
k = (await knoten()).find((n) => n.id === id);
pruefe('A5 Strg+Z nimmt Text und Zeitpunkt zurück', !!k && !text(k).includes('mehr Text') && k.geaendert === g1, { text: text(k).slice(0, 120), g: k?.geaendert, g1 });

await P.keyboard.press('Control+y'); await P.waitForTimeout(1600);
k = (await knoten()).find((n) => n.id === id);
const gNeu = k?.geaendert;
liste = await knoten();
await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
const nachLaden = await knoten();
pruefe('A6 Neuladen erhält die Zeitpunkte', JSON.stringify(nachLaden.map((n) => [n.id, n.angelegt ?? null, n.geaendert ?? null])) === JSON.stringify(liste.map((n) => [n.id, n.angelegt ?? null, n.geaendert ?? null])) && typeof gNeu === 'number', nachLaden.map((n) => [n.id, n.geaendert]));

// ---------- B: Fokus ----------
console.log('B  Im Fokus: „Geändert vor …"');
const fokusZeile = async (karte) => {
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  await P.evaluate((i) => { const el = [...document.querySelectorAll('.react-flow__node')].find((e) => e.dataset.id === i); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, karte);
  await P.waitForTimeout(200);
  if (!(await P.locator('.focus-title').count())) { await P.keyboard.press('Enter'); await P.waitForTimeout(700); }
  if (!(await P.locator('.focus-title').count())) { await kartenEl(karte).dblclick({ position: { x: 20, y: 12 } }); await P.waitForTimeout(700); }
  const z = await P.evaluate(() => {
    const el = document.querySelector('.focus-title .focus-zeit');
    return { zeile: document.querySelector('.focus-title span')?.textContent ?? '', tipp: el?.getAttribute('title') ?? '', datum: el?.getAttribute('datetime') ?? '' };
  });
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  return z;
};
const f1 = await fokusZeile('e1');
pruefe('B1 E-Mail von vor 10 Tagen: „Geändert vor 10 Tagen", genaue Zeit im Tooltip', /Geändert vor 10 Tagen/.test(f1.zeile) && /Zuletzt geändert: \d/.test(f1.tipp) && f1.datum.startsWith('2026-10-2'), f1);
const f3 = await fokusZeile('e3');
pruefe('B2 ohne Zeitpunkt: „Änderung unbekannt" (kein Datum)', /Änderung unbekannt/.test(f3.zeile) && !/Geändert vor/.test(f3.zeile), f3);

// ---------- C: Suche ----------
console.log('C  Strg+K: Alter am Treffer, nach Änderung ordnen');
await P.mouse.click(1300, 860); await P.waitForTimeout(200);
await P.keyboard.press('Control+k'); await P.waitForTimeout(400);
await P.keyboard.type('Projekt'); await P.waitForTimeout(500);
const treffer = () => P.evaluate(() => [...document.querySelectorAll('.search-results .search-hit')].map((h) => ({ titel: h.querySelector('.hit-title')?.textContent ?? '', alter: h.querySelector('.hit-alter')?.textContent ?? '' })));
const t1 = await treffer();
const alpha = t1.find((h) => h.titel.startsWith('Altnotiz'));
const beta = t1.find((h) => h.titel.startsWith('Ohne Zeit'));
const gamma = t1.find((h) => h.titel.startsWith('Frisch'));
pruefe('C1 Treffer zeigen ihr Alter (unbekannt: nichts)', gamma?.alter === 'vorgestern' && /Monat/.test(alpha?.alter ?? '') && beta && beta.alter === '', t1);
await P.locator('[data-taste="suche-nach-zeit"]').click(); await P.waitForTimeout(400);
const t2 = (await treffer()).map((h) => h.titel.split(' ')[0]);
pruefe('C2 „Zuletzt geändert zuerst": Frisch → Altnotiz → Ohne Zeit (unbekannt ans Ende)', t2.indexOf('Frisch') === 0 && t2.indexOf('Altnotiz') < t2.indexOf('Ohne') && t2.indexOf('Ohne') === t2.length - 1, t2);
pruefe('C3 der Knopf zeigt seinen Zustand', (await P.locator('[data-taste="suche-nach-zeit"]').getAttribute('aria-pressed')) === 'true');
await P.keyboard.press('Control+a'); await P.keyboard.press('Backspace'); await P.waitForTimeout(400);
const t3 = (await treffer()).map((h) => h.titel);
pruefe('C4 ohne Suchwort: die zuletzt geänderten Karten, neueste zuerst, ohne Unbekannte', t3[0]?.startsWith('Neue Karte M453') && t3.indexOf('Frisch Projekt Gamma') > 0 && t3.indexOf('Frisch Projekt Gamma') < t3.indexOf('Altnotiz Projekt Alpha') && !t3.some((x) => x.startsWith('Ohne Zeit') || x.includes('Altmail')), t3);
await P.keyboard.press('Escape'); await P.waitForTimeout(300);

// ---------- D: Briefing ----------
console.log('D  Board-Briefing: lange unberührte Karten und E-Mails ohne Folge');
const vorher = await knoten();
await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
await P.waitForTimeout(300);
await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click());
await P.waitForTimeout(300);
await P.locator('[data-taste="ki-briefing"]').click();
await P.waitForFunction(() => /Briefing/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
await P.waitForTimeout(1600);
const notizNeu = (await knoten()).find((n) => !vorher.some((v) => v.id === n.id));
const texte = [];
const lauf = (b) => { if (Array.isArray(b)) { b.forEach(lauf); return; } if (!b || typeof b !== 'object') return; if (typeof b.text === 'string') texte.push(b.text); if (typeof b.content === 'string') texte.push(b.content); if (b.content) lauf(b.content); if (b.children) lauf(b.children); };
lauf(notizNeu?.data?.blocks ?? []);
const bt = texte.join('\n');
const abschnitt = bt.slice(Math.max(0, bt.indexOf('Lange unberührt')));
pruefe('D1 Abschnitt „Lange unberührt" mit der 40 Tage alten Karte', bt.includes('Lange unberührt') && /Altnotiz Projekt Alpha – seit 40 Tagen unverändert/.test(bt), bt.slice(bt.indexOf("Risiken")));
pruefe('D2 E-Mail ohne Folgeaktivität genannt, die mit Folgekarte nicht', /E-Mail: Rechnung Q3 – seit 10 Tagen ohne Folgeaktivität/.test(bt) && bt.includes('Lange unberührt') && !abschnitt.includes('Anfrage Messe'), bt.slice(bt.indexOf("Risiken")));
pruefe('D3 frische Karten und Karten ohne Zeitpunkt fehlen dort', !/Frisch Projekt Gamma – seit/.test(bt) && !/Ohne Zeit Projekt Beta – seit/.test(bt) && bt.includes('Lange unberührt') && !abschnitt.includes('Altmail ohne Zeit') && !abschnitt.includes('Frisch') && !abschnitt.includes('Ohne Zeit'), bt.slice(bt.indexOf("Risiken")));
pruefe('D4 das Briefing selbst trägt seinen Zeitpunkt', typeof notizNeu?.angelegt === 'number' && notizNeu.angelegt > T0);

pruefe('E1 keine Fehler in der Seite', fehler.length === 0, fehler.slice(0, 3));

await browser.close(); app.close();
console.log(`\nM453: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
