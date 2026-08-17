/**
 * M285 — „boards karten bereiche soll man immer auch bearbeiten können.
 * momentan geht es aus der netzansicht und so weiter noch gar nicht … sodass
 * man überall das gleiche arbeitsfeeling hat und nicht in jeder Ansicht sich
 * umgewöhnen muss."
 *
 * Der Befund vorher, gemessen: In der Übersicht gab es NULL anfassbare Karten
 * — weder in der Hierarchie noch im Netz. Die Mini-Vorschau war ein Bild aus
 * blauen Klötzchen, der Navigator (Baum bis zur Karte) stand nur neben dem
 * Board.
 *
 * Das Prinzip dahinter: Es gibt genau EINE Stelle, an der eine Karte
 * bearbeitet wird — das Karten-Blatt. Jede Ansicht führt dorthin, und jede
 * Ansicht bekommt einen zurück. Geprüft wird deshalb der ganze Rundweg aus
 * jeder Ansicht, nicht nur das Öffnen.
 */
// Läuft aus dem Repository: `node pruefungen/m285-durchgang.mjs`
// Voraussetzung: `npm run build` (die Reihe prüft den dist/-Stand) und ein
// Chromium — Pfad über die Umgebungsvariable PW_CHROMIUM, sonst der
// Standardpfad der Claude-Umgebung.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4503;
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

async function seite(ansicht) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((ansicht) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    const mk = (id, txt, x, y) => ({ id, type: 'note', position: { x, y }, width: 240, height: 150,
      data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', props: {},
        content: [{ type: 'text', text: txt, styles: {} }], children: [] }] } });
    const rahmen = { id: 'f1', type: 'frame', position: { x: 20, y: 20 }, width: 560, height: 260,
      data: { name: 'Bereich Planung', color: '#dbe7f6' } };
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [
        { id: 'b0', name: '🏠 Schreibtisch', edges: [], drawings: [], comments: [],
          nodes: [rahmen, mk('n1', 'Antrag prüfen', 60, 70), mk('n2', 'Rückmeldung Amt', 320, 70), mk('n3', 'Dritte Notiz', 60, 330)] },
        { id: 'b1', name: 'Projekt B', edges: [], drawings: [], comments: [], nodes: [mk('m1', 'Konzept B', 40, 40)] },
      ],
      spaces: [{ id: 's1', name: 'Dienst', projects: [{ id: 'p1', name: 'Vorgänge', boardIds: ['b0', 'b1'] }] }],
      activeId: 'b0', view: ansicht, cardFocus: true, navLinks: false } }));
  }, ansicht);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2400);
  return { ctx, P };
}

const stand = (P) => P.evaluate(() => ({
  ansicht: document.querySelector('.ov-canvas') || document.querySelector('.ov-graph') ? 'uebersicht' : 'board',
  blattOffen: !!document.querySelector('.app.focus-mode'),
  navigatorDa: !!document.querySelector('.sidepanel') || !!document.querySelector('.sidepanel-fahne'),
}));

// ══ T1: Übersicht (Hierarchie) — die Vorschau ist anfassbar ══════════
console.log('════ T1: Übersicht, Mini-Vorschau ════');
{
  const { ctx, P } = await seite('overview');
  const s0 = await stand(P);
  pruefe('T1a wir starten in der Übersicht', s0.ansicht === 'uebersicht', JSON.stringify(s0));
  pruefe('T1b der Navigator steht auch hier zur Verfügung', s0.navigatorDa, JSON.stringify(s0));
  const anzahl = await P.locator('.ov-mini-karte').count();
  console.log('    anfassbare Karten in der Vorschau:', anzahl);
  pruefe('T1c die Karten der Vorschau sind Ziele (vorher: keins)', anzahl >= 5, String(anzahl));
  const zeiger = await P.locator('.ov-mini-karte title').first().textContent();
  pruefe('T1d der Zeiger nennt die Karte beim Namen',
    /öffnen und bearbeiten/.test(zeiger ?? ''), String(zeiger));

  // Eine echte Notiz öffnen (nicht den Rahmen)
  const idx = await P.evaluate(() => {
    const t = [...document.querySelectorAll('.ov-mini-karte title')].map((x) => x.textContent ?? '');
    return t.findIndex((x) => x.startsWith('Antrag prüfen'));
  });
  pruefe('T1e die Notiz ist in der Vorschau auffindbar', idx >= 0, String(idx));
  await P.locator('.ov-mini-karte').nth(Math.max(0, idx)).click({ force: true });
  await P.waitForTimeout(1600);
  const s1 = await stand(P);
  console.log('   ', JSON.stringify(s1));
  pruefe('T1f ein Klick öffnet das Karten-Blatt', s1.blattOffen, JSON.stringify(s1));
  pruefe('T1g und zwar mit DIESER Karte', await P.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board'));
    void s;
    const el = document.querySelector('.react-flow__node.pn-focused');
    return !!el && (el.textContent ?? '').includes('Antrag prüfen');
  }));
  pruefe('T1h der Schließen-Knopf sagt, wohin er führt',
    (await P.locator('.focus-x').getAttribute('aria-label')) === 'Zurück zur Übersicht',
    String(await P.locator('.focus-x').getAttribute('aria-label')));
  await P.screenshot({ path: `${SD}/m285-blatt.png` });

  // … und zurück
  await P.locator('.focus-x').click();
  await P.waitForTimeout(1500);
  const s2 = await stand(P);
  console.log('   ', JSON.stringify(s2));
  pruefe('T1i nach dem Schließen steht man wieder in der Übersicht',
    s2.ansicht === 'uebersicht' && !s2.blattOffen, JSON.stringify(s2));
  await P.screenshot({ path: `${SD}/m285-zurueck.png` });
  await ctx.close();
}

// ══ T2: Netzansicht — Karten am Knoten ══════════════════════════════
console.log('\n════ T2: Netzansicht ════');
{
  const { ctx, P } = await seite('overview');
  await P.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Netz')?.click();
  });
  await P.waitForTimeout(2200);
  pruefe('T2a das Netz ist offen', await P.evaluate(() => !!document.querySelector('.ov-graph')));
  // Rechtsklick auf einen Board-Knoten öffnet das Menü
  const treffer = await P.evaluate(() => {
    const k = document.querySelector('.ov-graph circle, .ov-graph .ov-graph-node, .ov-graph g[data-board]');
    if (!k) return false;
    const r = k.getBoundingClientRect();
    k.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    return true;
  });
  await P.waitForTimeout(900);
  const menue = await P.evaluate(() => {
    const m = document.querySelector('.ov-graph-ctx');
    return m ? [...m.querySelectorAll('button')].map((b) => b.textContent.trim()) : null;
  });
  console.log('    Menü:', JSON.stringify(menue));
  pruefe('T2b am Board-Knoten öffnet sich ein Menü', !!menue, `Knoten getroffen: ${treffer}`);
  if (menue) {
    pruefe('T2c es führt direkt zu den Karten des Boards',
      menue.some((t) => /Antrag prüfen|Rückmeldung|Konzept B/.test(t)), JSON.stringify(menue));
    // Eine NOTIZ wählen — ein Bereich hat bewusst kein Blatt (siehe T4)
    const kartenKnopf = P.locator('.ov-graph-ctx-karte', { hasText: 'Antrag prüfen' }).first();
    if (await kartenKnopf.count()) {
      await kartenKnopf.click();
      await P.waitForTimeout(1700);
      const s = await stand(P);
      console.log('   ', JSON.stringify(s));
      pruefe('T2d ein Klick öffnet dasselbe Karten-Blatt', s.blattOffen, JSON.stringify(s));
      if (s.blattOffen) {
        await P.locator('.focus-x').click();
        await P.waitForTimeout(1500);
        const z = await stand(P);
        pruefe('T2e und führt zurück in die Übersicht', z.ansicht === 'uebersicht', JSON.stringify(z));
      }
    } else {
      pruefe('T2d ein Klick öffnet dasselbe Karten-Blatt', false, 'Karten-Eintrag nicht gefunden');
    }
  }
  await P.screenshot({ path: `${SD}/m285-netz.png` });
  await ctx.close();
}

// ══ T3: Navigator — überall derselbe Weg ════════════════════════════
console.log('\n════ T3: Navigator in beiden Ansichten ════');
for (const ansicht of ['overview', 'board']) {
  const { ctx, P } = await seite(ansicht);
  // Navigator aufklappen — echter Klick, das Fähnchen hört auf Zeiger-Ereignisse
  await P.locator('.sidepanel-fahne').click();
  await P.waitForTimeout(1200);
  const offen = await P.evaluate(() => !!document.querySelector('.side-tree'));
  pruefe(`T3a (${ansicht}) der Navigator lässt sich öffnen`, offen);
  if (offen) {
    /* Das aktive Board ist im Baum schon aufgeklappt. Ist es das nicht, hilft
       der PFEIL — der Board-Name öffnet bewusst das Board (und wechselt damit
       die Ansicht). Genau diese Trennung macht den Baum überall brauchbar. */
    if (await P.locator('.side-card').count() === 0) {
      await P.locator('.side-board-arrow').first().click();
      await P.waitForTimeout(800);
    }
    // gezielt eine NOTIZ — der erste Eintrag ist der Bereich, und der hat
    // bewusst kein Karten-Blatt (siehe T4)
    const karte = P.locator('.side-card', { hasText: 'Antrag prüfen' }).first();
    const hatKarten = await karte.count();
    pruefe(`T3b (${ansicht}) der Baum reicht bis zur Karte`, hatKarten > 0, String(hatKarten));
    if (hatKarten) {
      pruefe(`T3c (${ansicht}) und verspricht das Bearbeiten`,
        /bearbeiten/.test((await karte.getAttribute('title')) ?? ''),
        String(await karte.getAttribute('title')));
      await karte.click();
      await P.waitForTimeout(1600);
      const s = await stand(P);
      pruefe(`T3d (${ansicht}) der Klick öffnet das Karten-Blatt`, s.blattOffen, JSON.stringify(s));
      if (s.blattOffen) {
        const ziel = await P.locator('.focus-x').getAttribute('aria-label');
        pruefe(`T3e (${ansicht}) der Rückweg führt an den Ausgangsort`,
          ziel === (ansicht === 'overview' ? 'Zurück zur Übersicht' : 'Zurück zum Board'), String(ziel));
      }
    }
  }
  await ctx.close();
}

// ══ T4: Bereiche und Boards bleiben bearbeitbar ═════════════════════
console.log('\n════ T4: Bereiche und Boards ════');
{
  const { ctx, P } = await seite('overview');
  // Ein Bereich (Rahmen) kennt kein Karten-Blatt — dort führt der Weg aufs
  // Board, wo er bearbeitet wird. Auch das muss verlässlich funktionieren.
  const idx = await P.evaluate(() => {
    const t = [...document.querySelectorAll('.ov-mini-karte title')].map((x) => x.textContent ?? '');
    return t.findIndex((x) => x.startsWith('Bereich Planung'));
  });
  pruefe('T4a der Bereich steht als Ziel in der Vorschau', idx >= 0, String(idx));
  if (idx >= 0) {
    /* Eine Stelle des Bereichs treffen, die KEINE Karte verdeckt — auf dem
       Board ist es genauso: Wo eine Karte liegt, trifft der Klick die Karte. */
    const punkt = await P.evaluate((i) => {
      const rects = [...document.querySelectorAll('.ov-mini-karte')];
      const ziel = rects[i].getBoundingClientRect();
      const andere = rects.filter((_, j) => j !== i).map((r) => r.getBoundingClientRect());
      for (let dy = ziel.height - 2; dy > 1; dy -= 1) {
        for (let dx = 2; dx < ziel.width - 1; dx += 1) {
          const x = ziel.left + dx; const y = ziel.top + dy;
          if (!andere.some((a) => x >= a.left && x <= a.right && y >= a.top && y <= a.bottom)) return { x, y };
        }
      }
      return null;
    }, idx);
    pruefe('T4a2 der Bereich hat eine freie Stelle zum Anklicken', !!punkt, JSON.stringify(punkt));
    if (punkt) await P.mouse.click(punkt.x, punkt.y);
    await P.waitForTimeout(1600);
    const s = await stand(P);
    console.log('   ', JSON.stringify(s));
    pruefe('T4b er führt aufs Board (dort wird ein Bereich bearbeitet)',
      s.ansicht === 'board' && !s.blattOffen, JSON.stringify(s));
    pruefe('T4c und ist dort ausgewählt', await P.evaluate(() =>
      !!document.querySelector('.react-flow__node.selected')));
  }
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
