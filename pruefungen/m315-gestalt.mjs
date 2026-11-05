/**
 * M315 — Weniger ist mehr, Etappe 4: die Gestalt.
 *
 *   A  Tokens: Systemschrift statt ui-rounded; Fläche einfarbig (--bg) ohne
 *      Verlauf und ohne Textur-Ebene; kein backdrop-filter in der ganzen
 *      Stilvorlage; Radien dezent (Leisten/Fenster ≤ 6 px, Knöpfe ≤ 4 px);
 *      Leisten und Menüs haben eine 1-px-Kante; kein warmer Schatten mehr.
 *   B  Bewegung: Dock-Knöpfe und Kopf-Knöpfe hüpfen beim Zeigen nicht; das
 *      Logo hat keinen Farbverlauf; der Schwenk schreibt keine Textur-Variablen.
 *   C  Dunkel: dieselbe Schicht in kühlen Tönen, Zweitschrift ≥ 4,5:1.
 *   D  Mehr Kontrast: kühle Kontrast-Töne greifen weiterhin.
 *   E  Spalte: „Aufgaben" steht in einer Zeile neben seinem Symbol.
 *   F  Telefon: Dock sichtbar, Radius ≤ 6 px, kein waagerechtes Überlaufen.
 *   G  „Was ist neu" nennt M315.
 */
// Läuft aus dem Repository: `node pruefungen/m315-gestalt.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4536;
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

const note = (id, text, x) => ({ id, type: 'note', width: 240, position: { x, y: 60 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const stand = {
  boards: [{ id: 'b1', name: 'Planung', edges: [], drawings: [], comments: [], nodes: [note('n1', 'Antrag prüfen', 60), note('n2', 'Rückruf Weber', 360)] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
async function seite(vorlieben = null, viewport = { width: 1440, height: 900 }, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme });
  await ctx.addInitScript(({ st, v }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    if (v) localStorage.setItem('pixinotes-einstellungen', JSON.stringify(v));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, v: vorlieben });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const px = (v) => parseFloat(String(v)) || 0;
const stil = (P, sel, eig, pseudo = null) => P.evaluate(([s, e, ps]) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el, ps)[e]; }, [sel, eig, pseudo]);
const radius = (P, sel) => stil(P, sel, 'borderTopLeftRadius').then(px);
const farbe = (s) => { const m = String(s).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const kontrast = (a, b) => { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const token = (P, name) => P.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
// Farb-Token als rgb auflösen: ein Hilfselement färben und messen
const tokenRgb = (P, name) => P.evaluate((n) => { const d = document.createElement('div'); d.style.color = `var(${n})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }, name).then(farbe);

// ══ A: Tokens und Flächen ═══════════════════════════════════════════
console.log('\n════ A: Tokens und Flächen ════');
{
  const { ctx, P } = await seite();
  const font = await stil(P, 'body', 'fontFamily');
  pruefe('A1 Systemschrift, nicht ui-rounded', /^system-ui/.test(font) && !/rounded/i.test(font), font);
  const bgImg = await stil(P, '.react-flow', 'backgroundImage');
  const bg = await stil(P, '.react-flow', 'backgroundColor');
  pruefe('A2 Fläche ohne Verlauf, einfarbig --bg', bgImg === 'none' && bg === 'rgb(243, 244, 246)', `${bgImg} / ${bg}`);
  const textur = await stil(P, '.react-flow', 'content', '::before');
  pruefe('A3 keine Textur-Ebene (::before)', textur === 'none', String(textur));
  const blur = await P.evaluate(() => {
    let n = 0; const seen = [];
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; }
      const geh = (rs) => { for (const r of rs) { if (r.cssRules) geh(r.cssRules); if (r.style && (r.style.backdropFilter || r.style.webkitBackdropFilter) && !/^\.m_/.test(r.selectorText || '')) { n += 1; if (seen.length < 5) seen.push(r.selectorText); } } };
      geh(rules); }
    return { n, seen };
  });
  pruefe('A4 kein backdrop-filter in der eigenen Stilvorlage (Mantine-Klassen .m_* ausgenommen)', blur.n === 0, JSON.stringify(blur.seen));
  const r = { dock: await radius(P, '.dock'), dockKnopf: await radius(P, '.dock button'), logo: await radius(P, '.logo'), tabs: await radius(P, '.tabs'), karte: await radius(P, '.react-flow__node'), zahl: await radius(P, '.side-board-count'), kopf: await radius(P, '.top-actions') };
  pruefe('A5 Radien dezent: Leisten ≤ 6, Knöpfe/Karten ≤ 4, Zahl-Chip ≤ 3', r.dock <= 6 && r.logo <= 6 && r.tabs <= 6 && r.kopf <= 6 && r.dockKnopf <= 4 && r.karte <= 4 && r.zahl <= 3, JSON.stringify(r));
  const ueberall = await P.evaluate(() => {
    const ausnahme = (el) => el.closest('.react-flow__node, .bn-container, .mantine-focus-auto') || el.matches('.task-who, .comment-pin-count, .dock-badge, .shape-terminator .shape-body');
    const treffer = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el); const rc = el.getBoundingClientRect();
      if (rc.width === 0 || rc.height === 0 || ausnahme(el)) continue;
      const rad = parseFloat(cs.borderTopLeftRadius) || 0;
      const kreis = cs.borderTopLeftRadius.endsWith('%') || (Math.abs(rc.width - rc.height) < 1 && rad >= rc.width / 2 - 1);
      if (!kreis && rad > 6.5) treffer.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}=${rad}`);
    }
    return treffer.slice(0, 8);
  });
  pruefe('A6 kein sichtbares Element außerhalb der Karten rundet stärker als 6 px', ueberall.length === 0, ueberall.join(' '));
  const kante = await P.evaluate(() => ['.dock', '.tabs', '.top-actions', '.logo'].map((s) => { const cs = getComputedStyle(document.querySelector(s)); return `${s}:${cs.borderTopWidth}/${cs.borderTopStyle}`; }));
  pruefe('A7 Leisten tragen eine 1-px-Kante', kante.every((k) => /1px\/solid/.test(k)), kante.join(' '));
  const schatten = await P.evaluate(() => ['.dock', '.react-flow__node', '.logo'].map((s) => getComputedStyle(document.querySelector(s)).boxShadow));
  pruefe('A8 Schatten kühl (kein rgba(50, 40, 20)/rgba(40, 30, 10)) und vorhanden', schatten.every((s) => s !== 'none' && !/\(50, 40, 20|\(40, 30, 10/.test(s)), schatten.join(' | '));
  const dockBg = await stil(P, '.dock', 'backgroundColor');
  pruefe('A9 Dock ist deckend weiß', dockBg === 'rgb(255, 255, 255)', dockBg);
  const bgTok = await tokenRgb(P, '--bg'); const muted = await tokenRgb(P, '--muted'); const ink = await tokenRgb(P, '--ink');
  pruefe('A10 Zweitschrift ≥ 5:1, Schrift ≥ 12:1 auf der Fläche', kontrast(muted, bgTok) >= 5 && kontrast(ink, bgTok) >= 12, `${kontrast(muted, bgTok).toFixed(2)} / ${kontrast(ink, bgTok).toFixed(2)}`);
  await ctx.close();
}

// ══ B: Bewegung ════════════════════════════════════════════════════
console.log('\n════ B: Bewegung ════');
{
  const { ctx, P } = await seite();
  await P.hover('.dock button:first-child'); await P.waitForTimeout(250);
  const t1 = await stil(P, '.dock button:first-child', 'transform');
  pruefe('B1 Dock-Knopf hüpft beim Zeigen nicht', t1 === 'none', t1);
  await P.hover('.top-actions button:nth-child(1)').catch(() => {}); await P.waitForTimeout(250);
  const t2 = await stil(P, '.top-actions button', 'transform');
  pruefe('B2 Kopf-Knopf hüpft beim Zeigen nicht', t2 === 'none', t2);
  const fill = await stil(P, '.logo span', 'webkitTextFillColor');
  const logoBg = await stil(P, '.logo span', 'backgroundImage');
  pruefe('B3 Logo ohne Farbverlauf', logoBg === 'none' && !/rgba\(0, 0, 0, 0\)/.test(fill), `${logoBg} / ${fill}`);
  // Schwenk: keine Textur-Variablen mehr am Board
  await P.mouse.move(900, 500); await P.mouse.down(); await P.mouse.move(820, 440, { steps: 6 }); await P.mouse.up(); await P.waitForTimeout(300);
  const tex = await P.evaluate(() => document.querySelector('.react-flow').style.getPropertyValue('--tex-x'));
  pruefe('B4 der Schwenk schreibt keine Textur-Variablen mehr', tex === '', JSON.stringify(tex));
  const anim = await P.evaluate(() => { let t = ''; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) if (r.name === 'pn-pop-in') t = r.cssText; } catch {} } return t; });
  pruefe('B5 Einblenden ohne scale', anim && !/scale\(/.test(anim), anim.slice(0, 120));
  await ctx.close();
}

// ══ C: Dunkel ═══════════════════════════════════════════════════════
console.log('\n════ C: Dunkel ════');
{
  const { ctx, P } = await seite(null, { width: 1440, height: 900 }, 'dark');
  const theme = await P.evaluate(() => document.documentElement.dataset.theme);
  pruefe('C1 System dunkel → data-theme=dark', theme === 'dark', String(theme));
  const bg = await stil(P, '.react-flow', 'backgroundColor');
  const dock = await stil(P, '.dock', 'backgroundColor');
  pruefe('C2 Fläche #141618, Dock #1d2024', bg === 'rgb(20, 22, 24)' && dock === 'rgb(29, 32, 36)', `${bg} / ${dock}`);
  const bgTok = await tokenRgb(P, '--bg'); const muted = await tokenRgb(P, '--muted'); const ink = await tokenRgb(P, '--ink');
  pruefe('C3 Zweitschrift ≥ 4,5:1 und Schrift ≥ 10:1 im Dunkeln', kontrast(muted, bgTok) >= 4.5 && kontrast(ink, bgTok) >= 10, `${kontrast(muted, bgTok).toFixed(2)} / ${kontrast(ink, bgTok).toFixed(2)}`);
  const bgImg = await stil(P, '.react-flow', 'backgroundImage');
  pruefe('C4 auch dunkel kein Verlauf', bgImg === 'none', bgImg);
  const papier = await stil(P, '.react-flow__node-note .note-card', 'backgroundColor');
  pruefe('C5 Haftnotiz bleibt helles Papier', papier === 'rgb(255, 243, 163)', papier);
  await P.screenshot({ path: path.join(SD, 'm315-dunkel.png') });
  await ctx.close();
}

// ══ D: Mehr Kontrast ════════════════════════════════════════════════
console.log('\n════ D: Mehr Kontrast ════');
{
  const { ctx, P } = await seite({ hoherKontrast: true, lesbareSchrift: true, schliff: 2 });
  const k = await P.evaluate(() => document.documentElement.dataset.kontrast);
  const muted = await tokenRgb(P, '--muted');
  pruefe('D1 Kontrast-Modus setzt kühle Zweitschrift #3c424c', k === 'hoch' && muted && muted.join(',') === '60,66,76', `${k} / ${muted}`);
  const bgTok = await tokenRgb(P, '--bg');
  pruefe('D2 Zweitschrift ≥ 7:1', kontrast(muted, bgTok) >= 7, kontrast(muted, bgTok).toFixed(2));
  await ctx.close();
}

// ══ E: Spalte ═══════════════════════════════════════════════════════
console.log('\n════ E: Spalte ════');
{
  const { ctx, P } = await seite();
  const z = await P.evaluate(() => {
    const b = document.querySelector('.tabs.spalte .tab-tasks'); if (!b) return null;
    const r = b.getBoundingClientRect(); const svg = b.querySelector('svg')?.getBoundingClientRect(); const lab = b.querySelector('.tab-home-label')?.getBoundingClientRect();
    const h = document.querySelector('.tabs.spalte .tab-home')?.getBoundingClientRect();
    return { h: r.height, w: r.width, svgTop: svg?.top, labTop: lab?.top, labW: lab?.width, homeH: h?.height, homeW: h?.width };
  });
  pruefe('E1 Aufgaben: Symbol und Wort in EINER Zeile, so hoch und breit wie Übersicht', z && z.h <= 36 && Math.abs(z.svgTop - z.labTop) < 8 && Math.abs(z.h - z.homeH) < 2 && Math.abs(z.w - z.homeW) < 2, JSON.stringify(z));
  await ctx.close();
}

// ══ F: Telefon ══════════════════════════════════════════════════════
console.log('\n════ F: Telefon ════');
{
  const { ctx, P } = await seite(null, { width: 390, height: 844 });
  const dock = await P.locator('.dock').boundingBox();
  pruefe('F1 Dock sichtbar und innerhalb des Schirms', dock && dock.x >= 0 && dock.x + dock.width <= 390, JSON.stringify(dock));
  pruefe('F2 Dock-Radius ≤ 6 px', (await radius(P, '.dock')) <= 6, String(await radius(P, '.dock')));
  const ueber = await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  pruefe('F3 kein waagerechtes Überlaufen', ueber);
  await P.screenshot({ path: path.join(SD, 'm315-telefon.png') });
  await ctx.close();
}

// ══ G: Was ist neu ══════════════════════════════════════════════════
console.log('\n════ G: Was ist neu ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G1 „Was ist neu" nennt M315', js.includes('Etappe 4 — das Gesicht (M315)'));
}

await browser.close(); app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
