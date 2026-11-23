/**
 * M499 — Kräftigere Editor-Farben im Hellen.
 *
 *   A  Hell: jede Schriftfarbe, jede Hintergrundfarbe und jede Kombination (BlockNote) auf der weißen Notiz (ruhend
 *      und im Editor), auf den vier Haftnotiz-Farben und im Protokoll (Thema und gelbes Papier): jede farbige Stelle
 *      ≥ 4,5:1; Standardschrift auf jedem Hintergrund ≥ 7:1.
 *   B  Die gezeichneten Töne sind die neuen Hellstufen: dieselben Werte wie `--tag-hl-*` und wie lib/editorFarben.ts
 *      (Export, E-Mail, Druck) — und nicht mehr BlockNotes Originale.
 *   C  Dunkel unverändert (M494): weiße Notiz dunkel zeigt die Nachtstufen, gelbe Haftnotiz dunkel BlockNotes
 *      Originale; das Protokoll mit dunkler eigener Farbe zeigt auch im Hellen die Nachtstufen.
 *   D  Die Farbwahl (Formatierungs-Leiste → Farben) zeigt im Hellen die neuen Töne.
 *   E  Keine Seitenfehler.
 *
 * Bilder: M499_BILDER=<ordner> legt Farbtafeln ab (alle Kombinationen auf Weiß, den Haftnotiz-Farben und im gelben
 *        Protokoll; hell und dunkel) sowie die Farbwahl im Hellen.
 * Mit PN_DIST=<alter Build> und eigenem Ordner entsteht dieselbe Tafel „vorher".
 */
// Läuft aus dem Repository: `node pruefungen/m499-farben-kraeftiger.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { kontrastScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M499_BILDER ?? '';
if (BILDER) mkdirSync(BILDER, { recursive: true });
const PORT = 5499;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const heute = new Date(); const iso = (n) => { const d = new Date(heute.getTime() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const meldung = (liste) => liste.slice(0, 4).map(trefferZeile).join(' | ');

// ---------- Soll-Werte: Quelle für Export (lib/editorFarben.ts) und Tokens (00-tokens.css) ----------
const quelleTs = readFileSync(path.join(__repo, 'src/lib/editorFarben.ts'), 'utf8');
const ausTs = (name) => Object.fromEntries([...new RegExp(`${name}[^{]*\\{([^}]*)\\}`).exec(quelleTs)[1].matchAll(/(\w+): '(#[0-9a-f]{6})'/g)].map((m) => [m[1], m[2]]));
const SCHRIFT = ausTs('EDITOR_SCHRIFT'); const GRUND = ausTs('EDITOR_GRUND');
const tokens = readFileSync(path.join(__repo, 'src/styles/00-tokens.css'), 'utf8');
const DE = { gray: 'grau', brown: 'braun', red: 'rot', orange: 'orange', yellow: 'gelb', green: 'gruen', blue: 'blau', purple: 'lila', pink: 'rosa' };
const rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
const BLOCKNOTE_HELL = { red: 'rgb(224, 62, 62)', gray: 'rgb(155, 154, 151)', yellow: 'rgb(223, 171, 1)', blueGrund: 'rgb(221, 235, 241)' };
const NACHT = { red: 'rgb(245, 148, 139)', gray: 'rgb(181, 180, 176)', blueGrund: 'rgb(31, 58, 74)' };

// ---------- Inhalt: alle Editor-Farben ----------
const FARBEN = ['gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
const span = (text, styles = {}) => ({ type: 'text', text, styles });
const farbBloecke = () => [
  { type: 'paragraph', content: FARBEN.map((f) => span(`${f} `, { textColor: f })) },
  ...FARBEN.map((g) => ({ type: 'paragraph', content: [span(`${g}:`, { backgroundColor: g }), ...FARBEN.map((f) => span(` ${f.slice(0, 3)}`, { textColor: f, backgroundColor: g }))] })),
];
const stand = (nodes) => ({ boards: [{ id: 'b0', name: 'Prüfung', edges: [], drawings: [], comments: [], nodes }], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board' });
async function seite(nodes, { dunkel = false, breite = 1440, hoehe = 1000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([s, d]) => {
    if (localStorage.getItem('pixinotes-onboarded')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ theme: d ? 'dark' : 'light' }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, [stand(nodes), dunkel]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30_000 });
  await P.waitForFunction((n) => document.querySelectorAll('.react-flow__node [data-text-color], .react-flow__node [data-style-type]').length >= n, nodes.length * 90, { timeout: 30_000 });
  return { ctx, P };
}
/** Alle Textstellen mit Editor-Farbe unter `sel` */
const stellen = async (P, sel) => (await kontrastScan(P, sel, { alle: true }))
  .filter((t) => /^(gray|brown|red|orange|yellow|green|blue|purple|pink):?$|^(gra|bro|red|ora|yel|gre|blu|pur|pin)$/.test(t.text));
const auswerten = (name, liste) => {
  const farbig = liste.filter((t) => !t.text.endsWith(':'));
  const tinte = liste.filter((t) => t.text.endsWith(':'));
  const schlecht = farbig.filter((t) => t.v < 4.5); const schlechtTinte = tinte.filter((t) => t.v < 7);
  const min = farbig.length ? Math.min(...farbig.map((t) => t.v)) : 0;
  const minT = tinte.length ? Math.min(...tinte.map((t) => t.v)) : 0;
  pruefe(`${name}: ${farbig.length} farbige Stellen ≥ 4,5:1 (min ${min})`, farbig.length >= 90 && !schlecht.length, farbig.length < 90 ? `(nur ${farbig.length})` : meldung(schlecht));
  pruefe(`${name}: Standardschrift auf ${tinte.length} Hintergründen ≥ 7:1 (min ${minT})`, tinte.length >= 9 && !schlechtTinte.length, meldung(schlechtTinte));
  return Math.min(min, 99);
};
const farbeVon = (P, sel) => P.evaluate((sel) => {
  const q = (s) => document.querySelector(s);
  const t = (f) => { const e = q(`${sel} [data-text-color="${f}"]:not([data-background-color]), ${sel} [data-style-type="textColor"][data-value="${f}"]`); return e && getComputedStyle(e).color; };
  const b = (f) => { const e = q(`${sel} [data-background-color="${f}"], ${sel} [data-style-type="backgroundColor"][data-value="${f}"]`); return e && getComputedStyle(e).backgroundColor; };
  const F = ['gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
  return { schrift: Object.fromEntries(F.map((f) => [f, t(f)])), grund: Object.fromEntries(F.map((f) => [f, b(f)])) };
}, sel);

console.log('════ B: Soll-Werte stimmen überein (Tokens = Export) ════');
{
  const abw = FARBEN.filter((f) => !tokens.includes(`--tag-hl-${DE[f]}: ${SCHRIFT[f]};`) || !tokens.includes(`--tag-hl-${DE[f]}-grund: ${GRUND[f]};`));
  pruefe(`B --tag-hl-* in 00-tokens.css = lib/editorFarben.ts (9 × 2 Werte)`, Object.keys(SCHRIFT).length === 9 && Object.keys(GRUND).length === 9 && !abw.length, abw.join(', '));
}

console.log('════ A: Hell — alle Kombinationen ≥ 4,5:1 ════');
const PAPIERE = ['white', 'yellow', 'pink', 'mint', 'sky'];
let minGesamt = 99;
/** Farbtafel: alle fünf Papiere und das gelbe Protokoll auf einen Blick, bei 100 % */
async function tafel(dunkel) {
  const nodes = [
    ...PAPIERE.map((c, i) => ({ id: `n-${c}`, type: 'note', width: 380, height: 300, position: { x: 10 + (i % 3) * 400, y: 10 + Math.floor(i / 3) * 320 }, data: { color: c, blocks: farbBloecke() } })),
    { id: 'm-y', type: 'minutes', width: 380, height: 480, position: { x: 10 + 2 * 400, y: 330 }, data: { title: 'Gelbes Protokoll', color: 'yellow', entries: [{ id: 'x1', date: '2026-11-23', attendees: 'Anna', blocks: farbBloecke(), decisions: [] }], current: 'x1' } },
  ];
  const s = await seite(nodes, { dunkel, breite: 1540, hoehe: 820 });
  // Ansicht so legen, dass alle Karten bei 100 % stehen (Board öffnet je nach Stand gezoomt)
  await s.P.evaluate(() => { const v = document.querySelector('.react-flow__viewport'); if (v) v.style.transform = 'translate(0px, 0px) scale(1)'; });
  await s.P.waitForTimeout(300);
  return s;
}
{
  const { ctx, P } = await tafel(false);
  if (BILDER) await P.screenshot({ path: path.join(BILDER, 'farbtafel-hell.png') });
  const f = await farbeVon(P, '.react-flow__node[data-id="n-white"]');
  const falsch = FARBEN.filter((x) => f.schrift[x] !== rgb(SCHRIFT[x]) || f.grund[x] !== rgb(GRUND[x]));
  pruefe(`B weiße Notiz hell zeigt die Hellstufen (rot ${f.schrift.red}, gelb ${f.schrift.yellow}, Grund blau ${f.grund.blue})`, !falsch.length, falsch.map((x) => `${x}: ${f.schrift[x]} / ${f.grund[x]}`).join(' | '));
  pruefe('B nicht mehr BlockNotes Originale', f.schrift.red !== BLOCKNOTE_HELL.red && f.schrift.yellow !== BLOCKNOTE_HELL.yellow && f.grund.blue !== BLOCKNOTE_HELL.blueGrund);
  for (const c of PAPIERE) minGesamt = Math.min(minGesamt, auswerten(`A Notiz ${c} hell, ruhend`, await stellen(P, `.react-flow__node[data-id="n-${c}"]`)));
  minGesamt = Math.min(minGesamt, auswerten('A Protokoll gelb hell', await stellen(P, '.react-flow__node[data-id="m-y"]')));
  await ctx.close();
}
{
  const { ctx, P } = await seite([
    { id: 'w1', type: 'note', width: 760, height: 560, position: { x: 80, y: 60 }, data: { color: 'white', blocks: farbBloecke() } },
    { id: 'm1', type: 'minutes', width: 760, height: 720, position: { x: 880, y: 40 }, data: { title: 'Farben', color: 'white', entries: [{ id: 'x1', date: iso(0), attendees: 'Anna', blocks: farbBloecke(), decisions: [] }], current: 'x1' } },
  ], { breite: 1700 });
  minGesamt = Math.min(minGesamt, auswerten('A Protokoll im Thema hell', await stellen(P, '.react-flow__node[data-id="m1"]')));
  const sel = '.react-flow__node[data-id="w1"]';
  await P.locator(`${sel} .card-grip`).first().click({ force: true }).catch(() => {});
  await P.locator(`${sel} .notiz-ruhend, ${sel} .bn-editor`).first().click();
  await P.waitForFunction((s) => document.querySelectorAll(`${s} [data-style-type]`).length >= 90, sel, { timeout: 20_000 }).catch(() => {});
  const imEditor = await P.locator(`${sel} [data-style-type]`).count();
  pruefe(`A Editor geöffnet (${imEditor} gefärbte Stellen von BlockNote)`, imEditor >= 90);
  minGesamt = Math.min(minGesamt, auswerten('A weiße Notiz hell, im Editor', await stellen(P, sel)));
  const fe = await farbeVon(P, sel);
  pruefe(`B im Editor dieselben Töne (gelb ${fe.schrift.yellow})`, FARBEN.every((x) => fe.schrift[x] === rgb(SCHRIFT[x]) && fe.grund[x] === rgb(GRUND[x])), JSON.stringify(fe.schrift));

  console.log('════ D: Farbwahl zeigt die neuen Töne ════');
  await P.keyboard.press('Control+Home'); await P.keyboard.down('Shift'); await P.keyboard.press('End'); await P.keyboard.up('Shift');
  await P.waitForSelector('.bn-formatting-toolbar [data-test="colors"]', { timeout: 10_000 }).catch(() => {});
  await P.locator('.bn-formatting-toolbar [data-test="colors"]').click();
  await P.waitForSelector('.bn-color-icon[data-text-color="yellow"]', { timeout: 10_000 }).catch(() => {});
  const muster = await P.evaluate(() => {
    const F = ['gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
    const e = (a, f) => document.querySelector(`.bn-color-icon[data-${a}-color="${f}"]`);
    return { schrift: Object.fromEntries(F.map((f) => [f, e('text', f) && getComputedStyle(e('text', f)).color])), grund: Object.fromEntries(F.map((f) => [f, e('background', f) && getComputedStyle(e('background', f)).backgroundColor])) };
  });
  if (BILDER) {
    // Einblenden des Menüs beenden, sonst zeigt das Foto die halbdurchsichtige Anfangsstufe
    await P.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    await P.waitForTimeout(500);
    await P.screenshot({ path: path.join(BILDER, 'farbwahl-hell.png') });
  }
  const falschM = FARBEN.filter((x) => muster.schrift[x] !== rgb(SCHRIFT[x]) || muster.grund[x] !== rgb(GRUND[x]));
  pruefe(`D Farbwahl: 18 Muster in den Hellstufen (gelb ${muster.schrift.yellow}, Grund gelb ${muster.grund.yellow})`, !falschM.length, falschM.map((x) => `${x}: ${muster.schrift[x]} / ${muster.grund[x]}`).join(' | '));
  await P.keyboard.press('Escape');
  await ctx.close();
}
pruefe(`A alle hellen Stellen zusammen: min ${minGesamt}:1`, minGesamt >= 4.5);

console.log('════ C: Dunkel unverändert ════');
{
  // Farbtafel im Dunkeln: Haftnotizen bleiben helles Papier mit BlockNotes Farben (Bild für den Vergleich vorher/nachher)
  const { ctx, P } = await tafel(true);
  if (BILDER) await P.screenshot({ path: path.join(BILDER, 'farbtafel-dunkel.png') });
  for (const c of ['yellow', 'pink', 'mint', 'sky']) {
    const y = await farbeVon(P, `.react-flow__node[data-id="n-${c}"]`);
    pruefe(`C Haftnotiz ${c} dunkel: BlockNotes Farben wie bisher (${y.schrift.yellow})`, y.schrift.red === BLOCKNOTE_HELL.red && y.schrift.yellow === BLOCKNOTE_HELL.yellow && y.grund.blue === BLOCKNOTE_HELL.blueGrund, JSON.stringify(y.schrift));
  }
  await ctx.close();
}
{
  const { ctx, P } = await seite([
    { id: 'w1', type: 'note', width: 760, height: 560, position: { x: 80, y: 60 }, data: { color: 'white', blocks: farbBloecke() } },
    { id: 'y1', type: 'note', width: 760, height: 560, position: { x: 880, y: 60 }, data: { color: 'yellow', blocks: farbBloecke() } },
  ], { dunkel: true, breite: 1700 });
  const w = await farbeVon(P, '.react-flow__node[data-id="w1"]');
  pruefe(`C weiße Notiz dunkel: Nachtstufen (M494) (${w.schrift.red}, ${w.schrift.gray}, ${w.grund.blue})`, w.schrift.red === NACHT.red && w.schrift.gray === NACHT.gray && w.grund.blue === NACHT.blueGrund, JSON.stringify(w));
  const y = await farbeVon(P, '.react-flow__node[data-id="y1"]');
  pruefe(`C gelbe Haftnotiz dunkel: BlockNotes Farben wie bisher (${y.schrift.red}, ${y.schrift.yellow})`, y.schrift.red === BLOCKNOTE_HELL.red && y.schrift.gray === BLOCKNOTE_HELL.gray && y.schrift.yellow === BLOCKNOTE_HELL.yellow && y.grund.blue === BLOCKNOTE_HELL.blueGrund, JSON.stringify(y));
  await ctx.close();
}
{
  const { ctx, P } = await seite([{ id: 'm1', type: 'minutes', width: 760, height: 720, position: { x: 80, y: 40 }, data: { title: 'Farben', color: 'white', hex: '#1f2a44', entries: [{ id: 'x1', date: iso(0), attendees: 'Anna', blocks: farbBloecke(), decisions: [] }], current: 'x1' } }]);
  const m = await farbeVon(P, '.react-flow__node[data-id="m1"]');
  pruefe(`C Protokoll in dunkler eigener Farbe (hell): Nachtstufen gewinnen (${m.schrift.red})`, m.schrift.red === NACHT.red && m.grund.blue === NACHT.blueGrund, JSON.stringify(m));
  await ctx.close();
}

console.log('════ E: Keine Seitenfehler ════');
pruefe('E keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));

await browser.close(); app.close();
console.log(`\n${ok} ✓  ${bad} ✗`);
process.exit(bad ? 1 : 0);
