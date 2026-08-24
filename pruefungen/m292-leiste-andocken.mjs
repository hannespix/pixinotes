/**
 * M292 — „das schwebende Bearbeitungsmenü von Cards ist immer irgendwo
 * verteilt auf dem Screen. könnte man das doch irgendwo sauber an die Card
 * andocken, am besten unten oder oben, je nachdem wo am besten Platz ist? …
 * eine freie Verschiebbarkeit ist ein bisschen zu chaotisch."
 *
 * Vorgeschichte: M243 hatte die Leiste beweglich gemacht — als Ausweg, weil
 * „immer über der Auswahl" mal den Inhalt verdeckte und mal am Bildrand keinen
 * Platz fand. Der gemerkte Versatz galt dann aber für JEDE Karte, und die
 * Leiste stand irgendwo (User-Bildschirmfoto: mitten auf der Karte).
 *
 * Jetzt gilt eine Regel statt eines Gedächtnisses:
 *   über der Karte → sonst darunter → sonst feste Zeile am unteren Rand.
 * Diese Reihe misst genau das — in Bildpunkten, auf Telefon und großem Schirm.
 */
// Läuft aus dem Repository: `node pruefungen/m292-leiste-andocken.mjs`
// Voraussetzung: `npm run build` und ein Chromium (PW_CHROMIUM).
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
const PORT = 4512;
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

/**
 * @param karte  Position/Größe der einen Karte auf dem Board
 * @param versatz alter, gemerkter Leisten-Versatz (M243) — er darf nichts mehr bewirken
 */
async function seite({ karte = { x: 300, y: 300, w: 320, h: 220 }, viewport = { width: 1440, height: 900 },
  finger = false, versatz = null } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: finger, isMobile: finger });
  await ctx.addInitScript(([karte, versatz]) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    const state = {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes: [
        { id: 'n1', type: 'note', position: { x: karte.x, y: karte.y }, width: karte.w, height: karte.h,
          data: { color: 'pink', blocks: [{ id: 'p1', type: 'paragraph', props: {},
            content: [{ type: 'text', text: 'Holthaus, St. Josephshaus', styles: {} }], children: [] }] } }] }],
      spaces: [{ id: 's1', name: 'Dienst', projects: [{ id: 'p1', name: 'Beratung', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: true, physicsEnabled: false,
    };
    if (versatz) state.leisteVersatz = versatz;
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state }));
  }, [karte, versatz]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2300);
  return { ctx, P };
}

/** Karte auswählen — über den Griff, das trifft nie den Text */
async function waehle(P) {
  const griff = P.locator('.react-flow__node[data-id="n1"] .card-grip').first();
  if (await griff.count()) {
    const g = await griff.boundingBox();
    if (g) { await P.mouse.click(g.x + g.width / 2, g.y + g.height / 2); await P.waitForTimeout(900); }
  }
  if (await P.locator('.sel-toolbar').count() === 0) {
    /* Diagnose, falls es hier je wieder klemmt: Ein Fehler IN der Auswahl-
       Leiste reißt die ganze Board-Ansicht in die Fehlergrenze — dann gibt es
       weder Knoten noch Leiste, und ohne diese Zeile sucht man lange. */
    const lageDiag = await P.evaluate(() => ({
      knoten: [...document.querySelectorAll('.react-flow__node')].length,
      board: !!document.querySelector('.react-flow'),
      fehler: document.querySelector('.err-box')?.textContent?.slice(0, 80) ?? null,
    }));
    if (!lageDiag.board) console.log('    ⚠ Board nicht gerendert:', JSON.stringify(lageDiag));
    // Rückfallweg: Auswahl direkt setzen (nicht die Bedienung, aber derselbe Zustand)
    await P.evaluate(() => {
      const k = document.querySelector('.react-flow__node[data-id="n1"]');
      const r = k.getBoundingClientRect();
      for (const art of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        k.dispatchEvent(new MouseEvent(art, { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 }));
      }
    });
    await P.waitForTimeout(900);
  }
}

const lage = (P) => P.evaluate(() => {
  const l = document.querySelector('.sel-toolbar');
  const k = document.querySelector('.react-flow__node[data-id="n1"]');
  if (!l || !k) return null;
  const a = l.getBoundingClientRect(); const b = k.getBoundingClientRect();
  const chrome = (sel) => {
    const e = document.querySelector(sel);
    if (!e || e.offsetHeight === 0) return null;
    const r = e.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  };
  const ueber = (x, y) => (x && y ? Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) : 0);
  const leiste = { top: Math.round(a.top), bottom: Math.round(a.bottom), links: Math.round(a.left), rechts: Math.round(a.right) };
  return {
    leiste,
    karte: { top: Math.round(b.top), bottom: Math.round(b.bottom) },
    angedockt: document.querySelector('.sel-toolbar-dock') ? 'dock' : (a.bottom <= b.top + 2 ? 'oben' : (a.top >= b.bottom - 2 ? 'unten' : 'ÜBER DER KARTE')),
    aufKarte: ueber(leiste, { top: Math.round(b.top), bottom: Math.round(b.bottom) }),
    aufKopf: ueber(leiste, chrome('.tabs')),
    aufDock: ueber(leiste, chrome('.dock')),
    griffDa: !!document.querySelector('.sel-griff'),
  };
});

// ══ T1: Karte mitten im Bild — die Leiste sitzt OBEN an ihr ═════════
console.log('════ T1: Platz oben ════');
{
  const { ctx, P } = await seite({ karte: { x: 300, y: 320, w: 340, h: 220 } });
  await waehle(P);
  const l = await lage(P);
  console.log('   ', JSON.stringify(l));
  pruefe('T1a die Leiste ist da', !!l);
  if (!l) { console.log('    (ohne Leiste keine weiteren Messungen)'); process.exit(1); }
  pruefe('T1b sie sitzt ÜBER der Karte', l.angedockt === 'oben', JSON.stringify(l));
  pruefe('T1c und liegt NICHT auf der Karte (das war der Befund)', l.aufKarte <= 0, String(l.aufKarte));
  pruefe('T1d dicht an der Kante (höchstens 30 Punkte Abstand)',
    l.karte.top - l.leiste.bottom <= 30, String(l.karte.top - l.leiste.bottom));
  pruefe('T1e kein Zieh-Griff mehr — die Stelle ist keine Geschmacksfrage', !l.griffDa);
  await P.screenshot({ path: `${SD}/m292-oben.png` });
  await ctx.close();
}

/** Die Ansicht so schieben, dass die Karte an einer gewünschten Höhe steht */
async function schiebeBis(P, zielOben) {
  const jetzt = await P.evaluate(() =>
    document.querySelector('.react-flow__node[data-id="n1"]').getBoundingClientRect().top);
  const dy = Math.round(zielOben - jetzt);
  await P.mouse.move(1100, 450);
  await P.mouse.down();
  await P.mouse.move(1100, 450 + dy, { steps: 14 });
  await P.mouse.up();
  await P.waitForTimeout(900);
}

// ══ T2: Karte klebt unter der Kopfleiste — dann nach UNTEN ══════════
console.log('\n════ T2: Kein Platz oben ════');
{
  const { ctx, P } = await seite({ karte: { x: 300, y: 320, w: 340, h: 200 } });
  await waehle(P);
  // dicht unter die Kopfleiste schieben: oben ist dann kein Platz mehr
  await schiebeBis(P, 112);
  const l = await lage(P);
  console.log('   ', JSON.stringify(l));
  pruefe('T2a die Leiste weicht nach UNTEN aus', l.angedockt === 'unten' || l.angedockt === 'dock', JSON.stringify(l));
  pruefe('T2b sie liegt nicht auf der Karte', l.aufKarte <= 0, String(l.aufKarte));
  pruefe('T2c und nicht unter der Kopf-/Reiterleiste begraben', l.aufKopf <= 0, String(l.aufKopf));
  await P.screenshot({ path: `${SD}/m292-unten.png` });
  await ctx.close();
}

// ══ T3: Karte größer als der Schirm — feste Zeile unten ═════════════
console.log('\n════ T3: Kein Platz, nirgends ════');
{
  const { ctx, P } = await seite({ karte: { x: 0, y: 0, w: 1300, h: 1400 } });
  await waehle(P);
  const l = await lage(P);
  console.log('   ', JSON.stringify(l));
  pruefe('T3a die Leiste wird zur festen Zeile am unteren Rand', l.angedockt === 'dock', JSON.stringify(l));
  pruefe('T3b sie verdeckt das Dock nicht', l.aufDock <= 0, String(l.aufDock));
  await P.screenshot({ path: `${SD}/m292-dock.png` });
  await ctx.close();
}

// ══ T4: Ein alter gemerkter Versatz wirkt nicht mehr ════════════════
console.log('\n════ T4: Alter Versatz aus M243 ════');
{
  const { ctx, P } = await seite({
    karte: { x: 300, y: 320, w: 340, h: 220 },
    versatz: { board: { x: 260, y: 180 }, fokus: { x: 0, y: 0 } },
  });
  await waehle(P);
  const l = await lage(P);
  console.log('   ', JSON.stringify(l));
  pruefe('T4a die Leiste steht trotzdem an der Karte', l.angedockt === 'oben', JSON.stringify(l));
  pruefe('T4b und nicht 180 Punkte tiefer auf der Karte', l.aufKarte <= 0, String(l.aufKarte));
  await ctx.close();
}

// ══ T5: Dieselbe Regel am Telefon ═══════════════════════════════════
console.log('\n════ T5: Telefon ════');
for (const [name, karte] of [
  ['kleine Karte', { x: 40, y: 300, w: 260, h: 150 }],
  ['große Karte', { x: 0, y: 0, w: 900, h: 1200 }],
]) {
  const { ctx, P } = await seite({ karte, viewport: { width: 390, height: 844 }, finger: true });
  await waehle(P);
  const l = await lage(P);
  console.log(`    ${name}:`, JSON.stringify(l));
  pruefe(`T5 (${name}) die Leiste liegt nicht auf der Karte`, l && l.aufKarte <= 0, JSON.stringify(l));
  pruefe(`T5 (${name}) und nicht unter der Kopfleiste`, l && l.aufKopf <= 0, JSON.stringify(l));
  pruefe(`T5 (${name}) die Stelle ist eine der drei erlaubten`,
    ['oben', 'unten', 'dock'].includes(l?.angedockt ?? ''), JSON.stringify(l));
  await P.screenshot({ path: `${SD}/m292-telefon-${name.split(' ')[0]}.png` });
  await ctx.close();
}

// ══ T6: Beim Verschieben der Ansicht bleibt sie an der Karte ════════
console.log('\n════ T6: Pannen ════');
{
  const { ctx, P } = await seite({ karte: { x: 300, y: 500, w: 340, h: 200 } });
  await waehle(P);
  const vorher = await lage(P);
  // Ansicht so schieben, dass die Karte nach oben unter die Kopfleiste rutscht
  await P.mouse.move(1000, 700);
  await P.mouse.down();
  await P.mouse.move(1000, 260, { steps: 12 });
  await P.mouse.up();
  await P.waitForTimeout(900);
  const nachher = await lage(P);
  console.log('    vorher:', vorher.angedockt, '· nachher:', nachher.angedockt, JSON.stringify(nachher));
  pruefe('T6a die Leiste bleibt an der Karte (oder dockt an, wenn kein Platz mehr ist)',
    ['oben', 'unten', 'dock'].includes(nachher.angedockt), JSON.stringify(nachher));
  pruefe('T6b sie liegt weiterhin nicht auf der Karte', nachher.aufKarte <= 0, String(nachher.aufKarte));
  pruefe('T6c und nicht unter der Kopfleiste', nachher.aufKopf <= 0, String(nachher.aufKopf));
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
