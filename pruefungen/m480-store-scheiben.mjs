/**
 * M480 — src/store.ts in Scheiben (reiner Umbau ohne Verhaltensänderung).
 *
 * Der Board-Speicher liegt jetzt in src/store/ (typen, schutz, verlauf, speicher, start, hinweise, selektoren und je
 * eine Scheibe für ansicht, struktur, karten, kanten, zeichnen, kommentare, abgleich); src/store.ts setzt ihn zusammen
 * und exportiert dieselben Namen wie vorher. Diese Reihe fährt je Scheibe einen kurzen Weg durch die echte App:
 *
 *   Q  Quelle: store.ts exportiert genau die Namen von vorher; jede Scheibe trägt ihre Aktionen; kein Teil enthält
 *      mehr als 750 Zeilen; der Einstieg lädt firstRun zuerst (M217).
 *   A  Start: die App lädt den gespeicherten Stand (speicher/migrate), zeigt das Board und keine Seitenfehler.
 *   K  Karten: löschen (Entf) → Hinweis mit „Rückgängig" (hinweise), Strg+Z holt die Karte zurück, Strg+Y nimmt sie
 *      wieder weg, Strg+Z noch einmal (verlauf); Text ändern bündelt Tippen zu EINEM Schritt (karten + verlauf).
 *   S  Struktur: ein anderes Board öffnen (struktur), die Ansicht folgt; Neuladen behält Board und Karten (speicher).
 *   F  Keine Seitenfehler.
 */
// Läuft aus dem Repository: `node werkzeug/alle-pruefungen.mjs m480`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5480;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 600) : JSON.stringify(info).slice(0, 600)}`); }
};

// ---------- Q: Quelle ----------
console.log('Q  Quelle: Einstieg und Scheiben');
{
  const einstieg = readFileSync(path.join(__repo, 'src/store.ts'), 'utf8');
  const namen = new Set(['useBoard']);
  for (const m of einstieg.matchAll(/^export (?:type )?\{ (.*) \} from/gm)) for (const n of m[1].split(', ')) namen.add(n);
  // Die Namen, die store.ts vor M480 exportierte (55) – kein importierender Code musste sich ändern
  const vorher = 'AiProvider AiSettings BoardDoc BoardSortierung CardTemplate CommentThread EbeneLoeschen FOLIEN_SEITE FREMD_SCHUB_AB GRUPPE_EREIGNIS GastRecht GruppenInfo LESE_HINWEIS NOTIZ_EXTERN Project START_BOARD_NAME START_BOARD_NAME_EN Space Stroke Tool WriterRole adoptPersistedState alteNamenOhneEmoji anhaengeMitnehmen claimWriter flushPersist getWriterRole gruppeVon hinweisKnopfDruecken hinweisMitKnopf inDerived isImportedState kamVonAussen karteFest leeresStartboard markImported mutedHistory ohneLeseschutz ohneStartboard persistHaken reassertPersist runDerived selectActiveBoard selectNurLesen setzeGruppe setzeKartenSperren setzeNotizSchutz singleWriterSupported startNamenAufEnglisch takeOverWriter useBoard useKarteFest useNurLesen verlaufAbgrenzen vorUmbauHaken'.split(' ');
  const fehlt = vorher.filter((n) => !namen.has(n));
  const neu = [...namen].filter((n) => !vorher.includes(n));
  pruefe('Q1 store.ts exportiert genau die 55 Namen von vorher', fehlt.length === 0 && neu.length === 0, { fehlt, neu });
  const zeilen = einstieg.split('\n');
  pruefe('Q2 firstRun ist der erste Import (M217)', zeilen.find((z) => z.startsWith('import ')) === "import './lib/firstRun';");
  const teile = readdirSync(path.join(__repo, 'src/store')).filter((f) => f.endsWith('.ts'));
  const gross = teile.map((f) => [f, readFileSync(path.join(__repo, 'src/store', f), 'utf8').split('\n').length]).filter(([, n]) => n > 750);
  pruefe(`Q3 ${teile.length} Teile unter src/store/, keiner über 750 Zeilen; store.ts selbst unter 120`, teile.length >= 10 && gross.length === 0 && zeilen.length < 120, { gross, store: zeilen.length });
  const scheibe = (f) => readFileSync(path.join(__repo, 'src/store', f), 'utf8');
  pruefe('Q4 Aktionen liegen in ihrer Scheibe (undo → verlauf, addBoard → struktur, removeNodes → karten, showToast → hinweise)',
    /\n    undo: /.test(scheibe('verlauf.ts')) && /\n    addBoard: /.test(scheibe('struktur.ts')) && /\n    removeNodes: /.test(scheibe('karten.ts')) && /\n    showToast: /.test(scheibe('hinweise.ts')));
}

// ---------- Server ----------
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  let f = join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }[extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const notiz = (id, x, text) => ({ id, type: 'note', width: 240, position: { x, y: 0 }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
// Bewusst ein Stand der Fassung 4: migrate (speicher.ts) muss ihn auf 5 bringen
const STAND = {
  version: 4,
  state: {
    boards: [
      { id: 'b1', name: 'Erstes', edges: [], drawings: [], comments: [], nodes: [notiz('n1', 0, 'Alpha Karte'), notiz('n2', 320, 'Beta Karte')] },
      { id: 'b2', name: 'Zweites', edges: [], drawings: [], comments: [], nodes: [notiz('m1', 0, 'Gamma Karte')] },
    ],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b2'] }] }],
    activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false,
  },
};
const fehler = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`), (r) => r.fulfill({ status: 404, body: '' }));
await ctx.addInitScript((st) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-ohne-emoji', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify(st));
}, STAND);
const P = await ctx.newPage();
P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
P.on('dialog', (d) => d.accept());
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForSelector('.react-flow__node', { state: 'visible' });
await P.waitForTimeout(1200);

const gespeichert = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')));
const karten = async (id = 'b1') => ((await gespeichert()).state.boards.find((b) => b.id === id)?.nodes ?? []).map((n) => n.id).sort().join(',');
const sichtbar = () => P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((e) => e.dataset.id).sort().join(','));
const toast = () => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');

// ---------- A: Start ----------
console.log('A  Start');
{
  const st = await gespeichert();
  pruefe('A1 der gespeicherte Stand trägt jetzt Fassung 5 (migrate)', st.version === 5, st.version);
  pruefe('A2 das Board „Erstes" zeigt seine zwei Karten', (await sichtbar()) === 'n1,n2', await sichtbar());
}

// ---------- K: Karten, Hinweis, Verlauf ----------
console.log('K  Karten, Hinweis, Verlauf');
{
  await P.locator('.react-flow__node[data-id="n2"]').click({ position: { x: 8, y: 8 } });
  await P.waitForTimeout(200);
  await P.evaluate(() => document.activeElement?.blur?.());
  await P.keyboard.press('Delete');
  await P.waitForTimeout(900);
  pruefe('K1 Entf löscht die gewählte Karte', (await sichtbar()) === 'n1' && (await karten()) === 'n1', [await sichtbar(), await karten()]);
  pruefe('K2 der Hinweis bietet „Rückgängig"', /Rückgängig/.test(await toast()), await toast());
  await P.keyboard.press('Control+z'); await P.waitForTimeout(900);
  pruefe('K3 Strg+Z holt sie zurück', (await sichtbar()) === 'n1,n2' && (await karten()) === 'n1,n2', [await sichtbar(), await karten()]);
  await P.keyboard.press('Control+y'); await P.waitForTimeout(900);
  pruefe('K4 Strg+Y nimmt sie wieder weg', (await karten()) === 'n1', await karten());
  await P.keyboard.press('Control+z'); await P.waitForTimeout(900);
  pruefe('K5 Strg+Z noch einmal: wieder da', (await karten()) === 'n1,n2', await karten());

  // Tippen in einer Notiz: Die Tastendrücke bündeln sich zu EINEM Rückgängig-Schritt
  const text = async () => (await gespeichert()).state.boards[0].nodes.find((n) => n.id === 'n1').data.blocks.map((b) => (Array.isArray(b.content) ? b.content.map((c) => c.text).join('') : b.content)).join('|');
  await P.locator('.react-flow__node[data-id="n1"] .note-editor').first().click({ position: { x: 30, y: 14 } });
  for (let i = 0; i < 50 && !(await P.evaluate(() => !!document.activeElement?.isContentEditable)); i += 1) await P.waitForTimeout(100);
  await P.waitForTimeout(150);
  await P.keyboard.press('Control+End'); await P.keyboard.press('End');
  await P.keyboard.type(' plus', { delay: 40 });
  await P.waitForTimeout(1000);
  pruefe('K6 der getippte Text ist gespeichert', /Alpha Karte plus/.test(await text()), await text());
  await P.keyboard.press('Escape'); await P.waitForTimeout(120);
  await P.evaluate(() => document.activeElement?.blur?.());
  await P.waitForTimeout(500);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(1200);
  pruefe('K7 ein Strg+Z nimmt das ganze Tippen zurück', (await text()) === 'Alpha Karte', await text());
}

// ---------- S: Struktur und Neuladen ----------
console.log('S  Struktur und Neuladen');
{
  await P.evaluate(() => { location.hash = ''; });
  const tab = P.locator('.tabs .tab', { hasText: 'Zweites' }).first();
  if (await tab.count()) await tab.click();
  else {
    await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box', { state: 'visible' });
    await P.keyboard.type('Zweites'); await P.waitForTimeout(300);
    await P.keyboard.press('Enter');
  }
  await P.waitForTimeout(1200);
  pruefe('S1 das andere Board ist offen und zeigt seine Karte', (await gespeichert()).state.activeId === 'b2' && (await sichtbar()) === 'm1', [(await gespeichert()).state.activeId, await sichtbar()]);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { state: 'visible' });
  await P.waitForTimeout(1000);
  pruefe('S2 nach dem Neuladen: dasselbe Board, dieselben Karten', (await gespeichert()).state.activeId === 'b2' && (await sichtbar()) === 'm1' && (await karten('b1')) === 'n1,n2', [await sichtbar(), await karten('b1')]);
}

pruefe('F1 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
await ctx.close();
await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
