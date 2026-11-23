/**
 * M428 — Bestehende Präsentationen per KI überarbeiten.
 *
 * Gewünscht: „Präsentation per KI auch für bestehende Präsentationen zum Überarbeiten."
 *
 *   A  Menü der Präsentations-Karte: „Mit KI überarbeiten …" — der Auftrag enthält die Folien, wie sie JETZT sind
 *      (auch im Editor Geändertes), den Wunsch und die Karten mit einem Pfeil zur Präsentation.
 *   B  Die Karte bekommt die neuen Folien und lädt neu; Gestaltung (Logo, Design, Schriften) bleibt; der Name folgt
 *      dem neuen Titel.
 *   C  „Vorige Fassung wiederherstellen" holt den Stand davor zurück (und wieder vor).
 *   D  Freitext „Mach die Präsentation kürzer" überarbeitet die vorhandene; Auswahl-KI „Präsentation überarbeiten".
 *   E  Abgeschnittene Antwort (Ausgabegrenze des Modells): nichts wird ersetzt.
 *   F  Hilfe, Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m428-ki-ueberarbeiten.mjs`
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
const PORT = 4770;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const NOTIZ = { id: 'q1', type: 'note', position: { x: -500, y: 0 }, width: 300, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Kosten Q3: 120.000 Euro, Budget eingehalten.' }] } };
const NEU = { titel: 'Kurzbericht Q3', untertitel: 'Das Wichtigste', folien: [
  { art: 'zahl', zahl: '120', titel: 'Tausend Euro Kosten.', text: 'Budget eingehalten.', notiz: 'Aus der Notiz.' },
  { art: 'schluss', titel: 'Danke.', notiz: 'Ende.' }] };
const auf = async (antwort) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((nn) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Vertrieb', edges: [], drawings: [], nodes: nn, comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
      ai: { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } } }));
  }, [NOTIZ]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const aufrufe = [];
  await P.route('**/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const c = body.messages?.[0]?.content;
    aufrufe.push(typeof c === 'string' ? c : (c ?? []).map((t) => t.text ?? '').join('\n'));
    const a = typeof antwort.wert === 'function' ? antwort.wert(aufrufe.length) : antwort.wert;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: typeof a === 'string' ? a : JSON.stringify(a) }, finish_reason: antwort.grund ?? 'stop' }] }) });
  });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, aufrufe };
};
const board = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]);
const idb = (P, key) => P.evaluate(async (k) => {
  const db = await new Promise((ok, nein) => { const r = indexedDB.open('pixinotes-sync'); r.onsuccess = () => ok(r.result); r.onerror = () => nein(r.error); });
  return new Promise((ok) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result ?? null); q.onerror = () => ok(null); });
}, key);
const idbSetzen = (P, key, wert) => P.evaluate(async ([k, w]) => {
  const db = await new Promise((ok, nein) => { const r = indexedDB.open('pixinotes-sync'); r.onsuccess = () => ok(r.result); r.onerror = () => nein(r.error); });
  await new Promise((ok) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(w, k); tx.oncomplete = ok; });
}, [key, wert]);
const rahmen = async (P, ms = 30000) => {   // M484: unter Last braucht der Rahmen länger als 12 s
  for (let t = 0; t < ms; t += 250) {
    // M484: alle Rahmen prüfen und nicht nach der Adresse filtern – unter Last meldet Playwright für den Rahmen der
    // Präsentation zeitweise "" statt "about:srcdoc" (gemessen), der Editor (#edit) steht trotzdem darin
    for (const f of P.frames()) {
      if (f === P.mainFrame()) continue;
      if (await f.locator('#edit').count().catch(() => 0)) return f;
    }
    await P.waitForTimeout(250);
  }
  return null;
};
const fertig = async (P) => {
  await P.waitForFunction(() => { const t = document.querySelector('.toast')?.textContent ?? ''; return t !== '' && !/überarbeitet die|^KI: /.test(t); }, null, { timeout: 30000 }).catch(() => {});
  const t = await P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  await P.waitForTimeout(1500);
  return t;
};
/** Präsentation anlegen (Palette), Titel im Editor ändern, Pfeil von der Notiz */
const anlegen = async (P) => {
  await P.locator('.dock .dock-add-wrap').nth(0).locator('button').first().click(); await P.waitForTimeout(400);
  await P.locator('.modul-kachel[data-modul="praesentation"]').click();
  // M484: auf die neue Karte im Speicher warten statt fester 1,5 s
  await P.waitForFunction(() => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards?.[0]?.nodes?.some((n) => n.type === 'htmlapp'), null, { timeout: 20000 });
  const id = (await board(P)).nodes.find((n) => n.type === 'htmlapp').id;
  const f = await rahmen(P);
  if (!f) throw new Error(`Präsentation ohne Editor-Rahmen nach 30 s – Rahmen: ${JSON.stringify(await Promise.all(P.frames().map(async (x) => [x.url().slice(0, 40), await x.locator('#edit').count().catch(() => -1)])))}`);
  const k = await P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  await P.mouse.click(k.x + 60, k.y + 12); await P.waitForTimeout(300);
  await f.locator('#edit').click({ force: true }); await P.waitForTimeout(800);
  await f.locator('.chapter-title h1').first().click(); await P.waitForTimeout(150);
  await f.evaluate(() => { const el = document.querySelector('.chapter-title h1'); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await P.keyboard.type('Quartalsbericht Q3');
  await f.locator('.reveal').first().click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
  // M484: warten, bis der geänderte Titel im Stand der Karte liegt (statt fester 2,5 s)
  for (let t = 0; t < 20000 && !JSON.stringify(await idb(P, `happ-state:${id}`) ?? '').includes('Quartalsbericht Q3'); t += 250) await P.waitForTimeout(250);
  await P.waitForTimeout(1000);   // der Speicher der App schreibt mit kurzer Verzögerung – danach erst den Pfeil eintragen
  return id;
};
/** Pfeil von der Notiz zur Präsentation in den gespeicherten Stand legen und neu laden. M484: Schreibt die App ihren
 *  Stand zwischen Eintragen und Neuladen noch einmal, ist der Pfeil weg – dann erneut eintragen. */
const pfeilUndNeuLaden = async (P, id) => {
  for (let versuch = 0; versuch < 4; versuch += 1) {
    await P.evaluate(([q, d]) => {
      const b = JSON.parse(localStorage.getItem('pixinotes-board'));
      if (!b.state.boards[0].edges.some((e) => e.id === 'e-q')) b.state.boards[0].edges.push({ id: 'e-q', source: q, target: d, type: 'labeled', data: {} });
      localStorage.setItem('pixinotes-board', JSON.stringify(b));
    }, ['q1', id]);
    await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
    if ((await board(P)).edges.some((e) => e.id === 'e-q')) return;
  }
};
const menue = async (P, id) => {
  await P.locator(`[data-hmbtn="${id}"]`).click({ force: true }); await P.waitForTimeout(400);
};

console.log('\n════ A–C: Karten-Menü ════');
{
  const { ctx, P, aufrufe } = await auf({ wert: NEU });
  const id = await anlegen(P);
  await pfeilUndNeuLaden(P, id);   // Pfeil aus dem gespeicherten Stand
  // Gestaltung, die bleiben soll
  const stand = await idb(P, `happ-state:${id}`);
  const schl = Object.keys(stand ?? {}).find((k) => k.startsWith('vibecoding-editor-'));
  const s0 = JSON.parse(stand[schl]); s0.design = { preset: 'ruhig' }; s0.logo = { src: 'data:image/png;base64,AAAA', w: 40 };
  await idbSetzen(P, `happ-state:${id}`, { ...stand, [schl]: JSON.stringify(s0) });
  const altHtml = await idb(P, `happ:${id}`);
  P.once('dialog', (d) => d.accept('Kürzer, nur das Wichtigste'));
  await menue(P, id);
  pruefe('A1 Menü der Präsentation: „Mit KI überarbeiten …"', (await P.locator('[data-taste="happ-ki-ueberarbeiten"]').count()) === 1);
  await P.locator('[data-taste="happ-ki-ueberarbeiten"]').click();
  const t = await fertig(P);
  const pr = aufrufe[0] ?? '';
  pruefe('A2 Meldung nennt die Folienzahl und den Weg zurück', /2 → 3 Folien/.test(t) && /vorige Fassung/.test(t), t);
  pruefe('A3 der Auftrag enthält die Folien, wie sie jetzt sind (im Editor geänderter Titel)', pr.startsWith('Du überarbeitest') && pr.includes('Quartalsbericht Q3') && pr.includes('Dein Titel'), pr.slice(0, 300));
  pruefe('A4 … den Wunsch und die Karte mit dem Pfeil zur Präsentation', pr.includes('Kürzer, nur das Wichtigste') && pr.includes('Kosten Q3: 120.000 Euro'));
  const neuHtml = await idb(P, `happ:${id}`);
  pruefe('B1 neue Folien in der Karte', neuHtml.includes('<h1>Kurzbericht Q3</h1>') && neuHtml.includes('count-slide') && !neuHtml.includes('Neue Präsentation</h1>'));
  const st1 = await idb(P, `happ-state:${id}`); const g1 = JSON.parse(st1[schl]);
  pruefe('B2 Gestaltung bleibt (Design, Logo), Texte aus dem alten Stand nicht', g1.design?.preset === 'ruhig' && g1.logo?.w === 40 && Object.keys(g1.texts ?? {}).length === 0, Object.keys(g1));
  const f = await rahmen(P);
  pruefe('B3 die Karte lädt neu und zeigt den neuen Titel', !!f && (await f.locator('.chapter-title h1').first().textContent()) === 'Kurzbericht Q3');
  const name = (await board(P)).nodes.find((n) => n.id === id).data.name;
  pruefe('B4 der Name der Karte folgt dem Titel', name === 'Kurzbericht Q3', name);
  await P.waitForTimeout(500);
  await menue(P, id);
  pruefe('C1 „Vorige Fassung wiederherstellen" im Menü', (await P.locator('[data-taste="happ-fassung-zurueck"]').count()) === 1);
  await P.locator('[data-taste="happ-fassung-zurueck"]').click(); await P.waitForTimeout(1500);
  pruefe('C2 der alte Stand ist zurück', (await idb(P, `happ:${id}`)) === altHtml);
  await menue(P, id);
  await P.locator('[data-taste="happ-fassung-zurueck"]').click(); await P.waitForTimeout(1500);
  pruefe('C3 … und derselbe Punkt holt die neue Fassung wieder', (await idb(P, `happ:${id}`)) === neuHtml);
  await P.screenshot({ path: `${SD}/m428-ueberarbeitet.png` });
  await ctx.close();
}

console.log('\n════ D: Freitext, Auswahl ════');
{
  const { ctx, P, aufrufe } = await auf({ wert: NEU });
  const id = await anlegen(P);
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click()); await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click()); await P.waitForTimeout(300);
  await P.locator('[data-taste="ki-board-eingabe"]').fill('Mach die Präsentation kürzer');
  await P.locator('.dock-menu-ai .ai-cmd-go').click();
  await fertig(P);
  pruefe('D1 „Mach die Präsentation kürzer" überarbeitet die vorhandene (keine zweite)', (aufrufe[0] ?? '').startsWith('Du überarbeitest') && (await board(P)).nodes.filter((n) => n.type === 'htmlapp').length === 1 && (await idb(P, `happ:${id}`)).includes('Kurzbericht Q3'));
  const k = await P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  // M484: Auswahl-Leiste und Menüs laden seit M483 nach – auf sie warten statt fester Pausen
  await P.mouse.click(k.x + 60, k.y + 12); await P.waitForSelector('.sel-toolbar button[aria-label="Mehr"]', { timeout: 15000 }).catch(() => {});
  await P.evaluate(() => [...(document.querySelector('.sel-toolbar')?.querySelectorAll('button') ?? [])].find((x) => x.getAttribute('aria-label') === 'Mehr')?.click()); await P.waitForSelector('.sel-more-menu', { timeout: 15000 }).catch(() => {});
  await P.evaluate(() => [...(document.querySelector('.sel-more-menu')?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('KI-Aktionen'))?.click()); await P.waitForSelector('[data-taste="ki-praesentation-ueberarbeiten"]', { timeout: 15000 }).catch(() => {});
  pruefe('D2 Auswahl-KI einer Präsentation: „Präsentation überarbeiten"', (await P.locator('[data-taste="ki-praesentation-ueberarbeiten"]').count()) === 1);
  await ctx.close();
}

console.log('\n════ E: abgeschnitten ════');
{
  const { ctx, P } = await auf({ wert: { titel: 'Halb', untertitel: '', folien: [{ art: 'text', titel: 'Eins.' }] }, grund: 'length' });
  const id = await anlegen(P);
  const vorher = await idb(P, `happ:${id}`);
  P.once('dialog', (d) => d.accept('Mehr Details'));
  await menue(P, id);
  await P.locator('[data-taste="happ-ki-ueberarbeiten"]').click();
  const t = await fertig(P);
  pruefe('E1 abgeschnittene Antwort: Meldung, nichts ersetzt', /abgeschnitten/.test(t) && (await idb(P, `happ:${id}`)) === vorher, t);
  await ctx.close();
}

console.log('\n════ F ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('F1 Hilfe nennt M428', /M428/.test(hilfe));
  pruefe('F2 Umbau-Liste nennt M428', /M428/.test(umbau));
  pruefe('F3 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
}
await browser.close();
app.close();
console.log(`\nM428: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
