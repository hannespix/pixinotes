/**
 * M445 — Karten nach Themen ordnen (Auto-Clustering).
 *
 * Roadmap KONZEPT.md „Clustering": Die KI schlägt Themengruppen mit Namen vor; nach der Bestätigung liegen die Karten
 * in benannten Rahmen, kollisionsfrei, als EIN Schritt im Verlauf.
 *
 *   A  DOCK, ganzes Board, Chat-KI: der Auftrag enthält nur die losen Karten (nicht den Rahmen, nicht seinen Inhalt);
 *      der Dialog zeigt die Gruppen; ein umbenannter Name wird der Rahmen-Titel; jede Karte liegt GANZ in ihrem
 *      Rahmen (gespeicherte Lage und gezeichnete Lage); die Rahmen überlappen weder einander noch den alten Rahmen
 *      samt Inhalt; was die KI vergisst, landet in „Weitere Karten".
 *   B  RÜCKGÄNGIG: ein Strg+Z entfernt alle Rahmen und stellt jede Karte an ihren alten Platz.
 *   C  ABBRECHEN: Esc im Dialog lässt das Board unverändert.
 *   D  AUSWAHL ohne Chat-KI: Anordnen-Feld → „Nach Themen …" gruppiert über die Einbettungen des Gehirns, benennt
 *      aus den Kartentiteln und ordnet nur die markierten Karten.
 *   E  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m445-themen-ordnen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5445;
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

const notiz = (id, x, y, text, w = 240, h = 120) => ({ id, type: 'note', position: { x, y }, width: w, height: h, autoFit: false,
  data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] } });
const BOARD = [
  notiz('r1', 60, 80, 'Urlaub Mallorca planen'),
  notiz('f1', 360, 60, 'Budget Rechnung Q3', 260, 150),
  notiz('r2', 700, 120, 'Flug nach Mallorca buchen'),
  notiz('f2', 120, 340, 'Rechnung Lieferant prüfen', 220, 100),
  notiz('r3', 460, 380, 'Hotel Mallorca am Strand', 280, 140),
  notiz('f3', 820, 360, 'Rechnung Steuer Termin'),
  { id: 'alt', type: 'frame', position: { x: 1200, y: 40 }, width: 420, height: 320, dragHandle: '.frame-head', data: { name: 'Schon geordnet' } },
  notiz('drin', 1260, 120, 'Liegt im alten Rahmen'),
];
const LOSE = ['r1', 'f1', 'r2', 'f2', 'r3', 'f3'];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const auf = async ({ ki = true } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([nn, mitKi]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Themen', edges: [], drawings: [], nodes: nn, comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
      ai: mitKi ? { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } : { provider: 'ollama', model: '', apiKey: '', baseUrl: 'http://localhost:11434' },
      brain: mitKi ? { on: false, provider: 'auto' } : { on: true, provider: 'ollama', embedModel: 'nomic-embed-text' } } }));
  }, [BOARD, ki]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const aufrufe = [];
  const einbettungen = [];
  return { ctx, P, aufrufe, einbettungen, starten: async (antwort) => {
    await P.route('**/chat/completions', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      const c = body.messages?.[0]?.content;
      aufrufe.push(typeof c === 'string' ? c : (c ?? []).map((t) => t.text ?? '').join('\n'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(antwort) }, finish_reason: 'stop' }] }) });
    });
    // Einbettungen des Gehirns (Ollama): Reise-Karten zeigen in eine Richtung, Finanz-Karten in eine andere
    await P.route('**/api/embed', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      einbettungen.push(...body.input);
      const vek = body.input.map((t) => (/Mallorca/.test(t) ? [1, 0.05, 0] : /Rechnung/.test(t) ? [0.05, 1, 0] : [0, 0, 1]));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ embeddings: vek }) });
    });
    await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await P.waitForTimeout(1500);
  } };
};
const knoten = async (P) => { await P.waitForTimeout(900); return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes); };
const rechteck = (n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.width, h: n.height });
const drin = (k, f) => k.x >= f.x - 0.5 && k.y >= f.y - 0.5 && k.x + k.w <= f.x + f.w + 0.5 && k.y + k.h <= f.y + f.h + 0.5;
const ueber = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const dialog = (P) => P.locator('.themen-dialog');
const kiMenue = async (P) => {
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click());
  await P.waitForTimeout(300);
};

// ---------- A: Dock, ganzes Board, Chat-KI ----------
console.log('A  Ganzes Board per KI: Vorschlag, Bestätigung, Rahmen');
const A = await auf();
await A.starten({ themen: [{ titel: 'Reise', ids: ['r1', 'r2', 'r3', 'gibt-es-nicht'] }, { titel: 'Finanzen', ids: ['f1', 'f2', 'r1'] }] });
const vorher = await knoten(A.P);
{
  await kiMenue(A.P);
  await A.P.locator('[data-taste="ki-themen-board"]').click();
  await dialog(A.P).waitFor({ timeout: 15000 }).catch(() => {});
  const prompt = A.aufrufe[0] ?? '';
  pruefe('A1 ein Auftrag mit genau den losen Karten – der alte Rahmen und sein Inhalt fehlen', A.aufrufe.length === 1 && LOSE.every((id) => prompt.includes(`"id":"${id}"`)) && !prompt.includes('"id":"alt"') && !prompt.includes('"id":"drin"'), { n: A.aufrufe.length, p: prompt.slice(0, 400) });
  const namen = await A.P.locator('.themen-dialog .themen-name').evaluateAll((els) => els.map((e) => e.value));
  pruefe('A2 der Dialog zeigt die Gruppen; Vergessenes steht in „Weitere Karten", doppelt Genanntes nur einmal', namen.join('|') === 'Reise|Finanzen|Weitere Karten', namen);
  const unveraendert = JSON.stringify((await knoten(A.P)).map(rechteck)) === JSON.stringify(vorher.map(rechteck));
  pruefe('A3 vor der Bestätigung hat sich am Board nichts geändert', unveraendert);
  await A.P.locator('.themen-dialog .themen-name').first().fill('Sommerreise');
  await A.P.locator('[data-taste="themen-ordnen"]').click();
  await A.P.waitForTimeout(400);
  const nach = await knoten(A.P);
  const rahmen = nach.filter((n) => n.type === 'frame' && n.id !== 'alt');
  const nachName = Object.fromEntries(rahmen.map((f) => [f.data.name, rechteck(f)]));
  pruefe('A4 drei neue Rahmen mit den Namen (umbenannt: „Sommerreise")', rahmen.length === 3 && ['Sommerreise', 'Finanzen', 'Weitere Karten'].every((t) => nachName[t]), rahmen.map((f) => f.data.name));
  const k = Object.fromEntries(nach.filter((n) => n.type !== 'frame').map((n) => [n.id, rechteck(n)]));
  const lage = { Sommerreise: ['r1', 'r2', 'r3'], Finanzen: ['f1', 'f2'], 'Weitere Karten': ['f3'] };
  const falsch = Object.entries(lage).flatMap(([t, ids]) => ids.filter((id) => !nachName[t] || !drin(k[id], nachName[t])));
  pruefe('A5 jede Karte liegt ganz in ihrem Rahmen (gespeicherte Lage)', falsch.length === 0, falsch);
  const kartenUeber = LOSE.flatMap((a, i) => LOSE.slice(i + 1).filter((b) => ueber(k[a], k[b])).map((b) => `${a}/${b}`));
  const rahmenListe = Object.values(nachName);
  const rahmenUeber = rahmenListe.some((a, i) => rahmenListe.slice(i + 1).some((b) => ueber(a, b)));
  const altR = rechteck(nach.find((n) => n.id === 'alt'));
  pruefe('A6 nichts überlappt: Karten untereinander, Rahmen untereinander, Rahmen mit dem alten Rahmen', !kartenUeber.length && !rahmenUeber && !rahmenListe.some((f) => ueber(f, altR)), { kartenUeber, rahmenUeber });
  const altDrin = nach.find((n) => n.id === 'drin');
  pruefe('A7 der alte Rahmen und sein Inhalt bleiben, wo sie waren', altDrin.position.x === 1260 && altDrin.position.y === 120 && altR.x === 1200, { altR, drin: altDrin.position });
  // Gezeichnete Lage: einpassen und die Rechtecke im Bild messen
  await A.P.keyboard.press('Escape'); await A.P.locator('.react-flow__pane').click({ position: { x: 1400, y: 500 } });
  await A.P.keyboard.press('f'); await A.P.waitForTimeout(900);
  const bild = await A.P.evaluate(() => Object.fromEntries([...document.querySelectorAll('.react-flow__node')].map((el) => {
    const r = el.getBoundingClientRect(); return [el.getAttribute('data-id'), { x: r.left, y: r.top, w: r.width, h: r.height, kopf: el.querySelector('.frame-head')?.textContent ?? '' }];
  })));
  const bildRahmen = Object.fromEntries(rahmen.map((f) => [f.data.name, bild[f.id]]));
  const bildFalsch = Object.entries(lage).flatMap(([t, ids]) => ids.filter((id) => !bild[id] || !bildRahmen[t] || !drin(bild[id], bildRahmen[t])));
  pruefe('A8 auch gezeichnet liegt jede Karte in ihrem Rahmen, die Titel stehen im Rahmenkopf', bildFalsch.length === 0 && Object.entries(bildRahmen).every(([t, r]) => r?.kopf.includes(t)), { bildFalsch, koepfe: Object.values(bildRahmen).map((r) => r?.kopf) });
  const t = await toast(A.P);
  pruefe('A9 die Meldung nennt Zahl und Themen und bietet „Rückgängig"', /6 Karten in 3 Rahmen geordnet: Sommerreise · Finanzen · Weitere Karten/.test(t) && /Rückgängig/.test(t), t);

  // ---------- B: Rückgängig ----------
  console.log('B  Ein Schritt im Verlauf');
  await A.P.keyboard.press('Escape');
  await A.P.keyboard.press('Control+z');
  const zurueck = await knoten(A.P);
  pruefe('B1 ein Strg+Z: keine neuen Rahmen mehr, jede Karte an ihrem alten Platz', JSON.stringify(zurueck.map(rechteck)) === JSON.stringify(vorher.map(rechteck)), zurueck.map(rechteck));
  await A.P.keyboard.press('Control+y');
  const wieder = await knoten(A.P);
  pruefe('B2 Wiederholen stellt die Ordnung wieder her', wieder.filter((n) => n.type === 'frame').length === 4, wieder.length);
}
await A.ctx.close();

// ---------- C: Abbrechen ----------
console.log('C  Abbrechen');
{
  const C = await auf();
  await C.starten({ themen: [{ titel: 'Reise', ids: ['r1', 'r2', 'r3'] }, { titel: 'Finanzen', ids: ['f1', 'f2', 'f3'] }] });
  const v = await knoten(C.P);
  await kiMenue(C.P);
  await C.P.locator('[data-taste="ki-themen-board"]').click();
  await dialog(C.P).waitFor({ timeout: 15000 }).catch(() => {});
  await C.P.keyboard.press('Escape');
  await C.P.waitForTimeout(300);
  const n = await knoten(C.P);
  pruefe('C1 Esc schließt den Dialog, das Board bleibt unverändert', !(await dialog(C.P).count()) && JSON.stringify(n.map(rechteck)) === JSON.stringify(v.map(rechteck)), n.length);
  await C.ctx.close();
}

// ---------- D: Auswahl, ohne Chat-KI über das Gehirn ----------
console.log('D  Auswahl ohne Chat-KI: Gehirn-Einbettungen');
{
  const D = await auf({ ki: false });
  await D.starten({});
  await D.P.locator('.react-flow__pane').click({ position: { x: 1400, y: 600 } });
  const wahl = ['r1', 'f1', 'r2', 'f2', 'r3'];
  for (const [i, id] of wahl.entries()) await D.P.locator(`.react-flow__node[data-id="${id}"]`).click({ modifiers: i ? ['Shift'] : [], position: { x: 30, y: 40 } });
  await D.P.waitForTimeout(300);
  await D.P.locator('[data-taste="auswahl-mehr"]').click(); await D.P.waitForTimeout(200);
  await D.P.locator('[data-taste="anordnen-auf"]').click(); await D.P.waitForTimeout(250);
  await D.P.locator('[data-anordnen="themen"]').click();
  await dialog(D.P).waitFor({ timeout: 20000 }).catch(() => {});
  const namen = await D.P.locator('.themen-dialog .themen-name').evaluateAll((els) => els.map((e) => e.value));
  const hinweis = await D.P.locator('.themen-dialog .modal-hint').first().textContent().catch(() => '');
  pruefe('D1 ohne Chat-KI: das Gehirn gruppiert, Namen aus den Kartentiteln', namen.length === 2 && namen.includes('Mallorca') && namen.includes('Rechnung') && /Gehirn/.test(hinweis ?? ''), { namen, hinweis });
  pruefe('D2 keine Anfrage an eine Chat-KI', D.aufrufe.length === 0 && D.einbettungen.length > 0, { chat: D.aufrufe.length, emb: D.einbettungen.length });
  await D.P.locator('[data-taste="themen-ordnen"]').click();
  await D.P.waitForTimeout(400);
  const nach = await knoten(D.P);
  const rahmen = Object.fromEntries(nach.filter((n) => n.type === 'frame' && n.id !== 'alt').map((f) => [f.data.name, rechteck(f)]));
  const k = Object.fromEntries(nach.map((n) => [n.id, n]));
  const falsch = [['Mallorca', ['r1', 'r2', 'r3']], ['Rechnung', ['f1', 'f2']]].flatMap(([t, ids]) => ids.filter((id) => !rahmen[t] || !drin(rechteck(k[id]), rahmen[t])));
  pruefe('D3 die markierten Karten liegen in ihren Rahmen', Object.keys(rahmen).length === 2 && falsch.length === 0, { rahmen: Object.keys(rahmen), falsch });
  pruefe('D4 die nicht markierte Karte bleibt liegen und liegt in keinem neuen Rahmen', k.f3.position.x === 820 && k.f3.position.y === 360 && !Object.values(rahmen).some((r) => ueber(rechteck(k.f3), r)), k.f3.position);
  await D.ctx.close();
}

console.log('E  Fehler');
pruefe('E1 keine Seitenfehler', fehler.length === 0, fehler);

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
