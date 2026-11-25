/**
 * M415 — Ideabubbles im Tropfen-Look: Gruppen fließen als Tropfen um ihre Ideen, das Modul ist randlos.
 *
 * Gemeldet: „Schau dir mal dieses Repo an (Verantwortungsplaner) – coole Bubble-Animationen, die in sich verschmelzen,
 * mit Farbverlauf … können wir uns davon Ideen/Teile und Look für Ideabubbles übernehmen? Vielleicht auch die eine
 * oder andere praktische Funktion." – „Mehr der randlose Style … sleek, schick." – „Auch das gesamte Modulfenster
 * soll schicker und reduzierter aussehen, ohne an Funktionen einzubüßen."
 * (Das Repository hat keine Lizenz: übernommen sind Ideen und Anmutung, kein Code.)
 *
 *   A  Tropfen: eine Formen-Schicht unter den Blasen mit eigenem Filter; je Idee eine Scheibe, in einer Gruppe um den
 *      Rand größer (so fließt die Gruppe zu einem Tropfen zusammen); dazu je Gruppe Kern und Kuppe für den Namen.
 *   B  Randlos: kein Kartenrahmen, keine Box um die Bühne, Ablauf als Textreiter, unten eine schwebende Leiste.
 *   C  Der Name einer Gruppe steht in ihrer Kuppe – nicht über ihren Ideen.
 *   D  Die Blasen kommen zur Ruhe (vorher krochen sie endlos weiter, und der Filter zeichnete jedes Bild neu).
 *   E  Doppelklick auf die Fläche legt dort eine Idee an – in einem Tropfen gleich in dessen Gruppe.
 *   F  Farbe einer Gruppe ändern.
 *   G  „Klar" im ⋯ zeigt den bisherigen Look; dunkle Ansicht.
 */
// Läuft aus dem Repository: `node pruefungen/m415-bubbles-tropfen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 4743;
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

const t = Date.now();
const idee = (text, g) => ({ text, von: 'g:a', name: 'Anna', t, g });
const KARTE = { id: 'b1', type: 'bubbles', position: { x: 0, y: 0 }, width: 900, height: 620, data: {
  title: 'Ideen', frage: 'Was brauchen wir für den Auftritt?',
  ideen: { i1: idee('Messestand', 'g1'), i2: idee('Empfangstresen', 'g1'), i3: idee('Markenfarben', 'g1'), i4: idee('Lounge', 'g1'), i5: idee('Schaufenster', 'g2'), i6: idee('Lichtplanung', 'g2'), i7: idee('Eiche geölt', null), i8: idee('Filz', null), i9: idee('Podcast', null) },
  stimmen: {}, gruppen: { g1: { name: 'Messe', farbe: 0, t }, g2: { name: 'Showroom', farbe: 3, t } }, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } };
const auf = async (opt = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1400, height: 900 }, ...opt });
  await ctx.addInitScript(([n]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'Test', edges: [], drawings: [], nodes: [n] }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board' } }));
  }, [KARTE]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(3500);
  return { ctx, P };
};
const daten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data);
const kaesten = (P) => P.evaluate(() => [...document.querySelectorAll('[data-taste="bub-blase"]')].map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent, x: r.left, y: r.top, w: r.width, h: r.height, bg: getComputedStyle(e).backgroundColor }; }));
const blase = (P, text) => P.locator('[data-taste="bub-blase"]', { hasText: text }).first();

// ══ A ═══════════════════════════════════════════════════════════════
console.log('A  Tropfen');
const { ctx, P } = await auf();
const a = await P.evaluate(() => {
  const bub = document.querySelector('[data-taste="bubbles"]');
  const f = document.querySelector('[data-taste="bub-formen"]');
  const filter = f ? getComputedStyle(f).filter : '';
  const id = /url\("?#([^")]+)"?\)/.exec(filter)?.[1];
  return { tropfen: bub.classList.contains('tropfen'), filter, def: !!(id && document.getElementById(id)?.querySelector('feGaussianBlur')), formen: f?.querySelectorAll('.bub-form').length ?? 0 };
});
pruefe('A1 Tropfen ist die Darstellung von Anfang an; die Formen-Schicht hat ihren Filter', a.tropfen && a.def, a);
pruefe('A2 neun Ideen, zwei Gruppen → neun Scheiben plus je Gruppe Kern und Kuppe', a.formen === 9 + 2 + 2, a);
const groesse = await P.evaluate(() => {
  const formen = [...document.querySelectorAll('[data-taste="bub-formen"] .bub-form:not(.kuppe)')].map((e) => e.getBoundingClientRect().width);
  const blasen = [...document.querySelectorAll('[data-taste="bub-blase"]')].map((e) => ({ t: e.textContent, w: e.getBoundingClientRect().width }));
  return { formen, blasen };
});
// die letzten neun Formen gehören zu den Ideen (in derselben Reihenfolge wie die Blasen)
const ideenFormen = groesse.formen.slice(-9);
const grp = groesse.blasen.map((b, i) => ({ ...b, f: ideenFormen[i] }));
const inGruppe = grp.filter((b) => /Messestand|Lounge|Schaufenster/.test(b.t)); const frei = grp.filter((b) => /Podcast|Filz/.test(b.t));
pruefe('A3 in einer Gruppe ist die Scheibe um den Rand größer, frei genauso groß wie die Blase', inGruppe.every((b) => b.f > b.w + 18) && frei.every((b) => Math.abs(b.f - b.w) < 3), grp);
const farben = await kaesten(P);
pruefe('A4 Ideen in einer Gruppe tragen Pastell, freie sind durchsichtig (ihre Fläche ist der Tropfen)', farben.filter((b) => /Messestand|Lounge/.test(b.text)).every((b) => b.bg !== 'rgba(0, 0, 0, 0)') && farben.filter((b) => /Podcast|Filz/.test(b.text)).every((b) => b.bg === 'rgba(0, 0, 0, 0)'), farben.map((b) => b.bg));
const schrift = await P.evaluate(() => getComputedStyle(document.querySelector('[data-taste="bub-blase"]')).color);
pruefe('A5 dunkle Schrift auf Pastell (vorher weiß auf kräftig)', schrift !== 'rgb(255, 255, 255)', schrift);

// ══ B ═══════════════════════════════════════════════════════════════
console.log('B  Randlos');
const b = await P.evaluate(() => {
  const n = document.querySelector('.react-flow__node-bubbles'); const c = n.querySelector('.bubbles-card'); const bu = document.querySelector('.bub-buehne');
  const jetzt = document.querySelector('.bub-schritt.jetzt'); const leiste = document.querySelector('.bub-leiste');
  return { schatten: getComputedStyle(n).boxShadow, karte: getComputedStyle(c).backgroundColor, buehneRand: getComputedStyle(bu).borderTopColor, buehneGrund: getComputedStyle(bu).backgroundColor,
    reiter: getComputedStyle(jetzt).backgroundColor, reiterLinie: getComputedStyle(jetzt).boxShadow, leiste: getComputedStyle(leiste).borderTopLeftRadius };
});
pruefe('B1 kein Kartenrahmen, keine Fläche', b.schatten === 'none' && b.karte === 'rgba(0, 0, 0, 0)', b);
pruefe('B2 keine Box um die Bühne', b.buehneRand === 'rgba(0, 0, 0, 0)' && b.buehneGrund === 'rgba(0, 0, 0, 0)', b);
pruefe('B3 der jetzige Schritt ist ein unterstrichener Textreiter (keine gefüllte Pille)', b.reiter === 'rgba(0, 0, 0, 0)' && /inset/.test(b.reiterLinie), b);
pruefe('B4 unten eine schwebende, runde Leiste', parseFloat(b.leiste) >= 16, b.leiste);
await P.locator('.react-flow__node-bubbles').hover({ position: { x: 20, y: 20 } }); await P.waitForTimeout(700);
pruefe('B5 beim Zeigen erscheint eine feine Linie (man sieht, wo das Modul ist)', /1px/.test(await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node-bubbles')).boxShadow)));

// ══ C ═══════════════════════════════════════════════════════════════
console.log('C  Name in der Kuppe');
const c = await P.evaluate(() => [...document.querySelectorAll('[data-taste="bub-ring-name"]')].map((n) => {
  const r = n.getBoundingClientRect();
  const deckt = [...document.querySelectorAll('[data-taste="bub-blase"]')].filter((e) => { const q = e.getBoundingClientRect(); const cx = q.left + q.width / 2; const cy = q.top + q.height / 2; const rr = q.width / 2; const nx = Math.max(r.left, Math.min(cx, r.right)); const ny = Math.max(r.top, Math.min(cy, r.bottom)); return Math.hypot(nx - cx, ny - cy) < rr - 3; }).map((e) => e.textContent);
  return { name: n.textContent, deckt, grund: getComputedStyle(n).backgroundColor, gross: parseFloat(getComputedStyle(n).fontSize) };
}));
pruefe('C1 kein Gruppenname liegt über einer Idee', c.every((x) => x.deckt.length === 0), c);
pruefe('C2 ohne Pille, und die größere Gruppe hat den größeren Namen', c.every((x) => x.grund === 'rgba(0, 0, 0, 0)') && c.find((x) => x.name === 'Messe').gross > c.find((x) => x.name === 'Showroom').gross, c);
await P.screenshot({ path: path.join(SD, 'm415-tropfen.png') });

// ══ D ═══════════════════════════════════════════════════════════════
console.log('D  Ruhe');
// (Ohne Grafikkarte zeichnet der Prüf-Browser den Filter langsam — gut 70 ms je Bild; darum bis zu 25 s Geduld)
const still = () => P.evaluate(() => new Promise((ok) => { let n = 0; const mo = new MutationObserver((ms) => { n += ms.length; }); mo.observe(document.querySelector('.bub-buehne'), { subtree: true, attributes: true, attributeFilter: ['style'] }); setTimeout(() => { mo.disconnect(); ok(n); }, 1500); }));
let aenderungen = -1;
for (let i = 0; i < 16 && aenderungen !== 0; i++) aenderungen = await still();
pruefe('D1 nach dem Einschwingen ruht alles: keine Bewegung in 1,5 s (vorher pendelten die Blasen endlos)', aenderungen === 0, String(aenderungen));
const nachRuhe = await still();
pruefe('D2 … und bleibt ruhig (nichts weckt die Rechnung von selbst)', nachRuhe === 0, String(nachRuhe));

// ══ E ═══════════════════════════════════════════════════════════════
console.log('E  Doppelklick: hier eine Idee');
const buehne = await P.locator('.bub-buehne').boundingBox();
// eine freie Stelle unten links
const frei0 = await P.evaluate(() => { const r = document.querySelector('.bub-buehne').getBoundingClientRect(); for (let y = r.bottom - 30; y > r.top + 40; y -= 20) for (let x = r.left + 30; x < r.right - 30; x += 20) { const el = document.elementFromPoint(x, y); if (el?.classList.contains('bub-buehne')) return [x, y]; } return null; });
await P.mouse.dblclick(frei0[0], frei0[1]); await P.waitForTimeout(300);
pruefe('E1 Doppelklick auf eine freie Stelle öffnet dort ein Feld', (await P.locator('[data-taste="bub-hier"]').count()) === 1 && /Neue Idee/.test(await P.locator('[data-taste="bub-hier"]').getAttribute('placeholder')));
// Sie entsteht an der Stelle (und schwimmt dann zu den freien Ideen).
// M518: Die Lage wird IN der Seite festgehalten, in dem Augenblick, in dem die Blase zum ersten Mal gezeichnet ist
// (Beobachter vor dem Enter) – nicht mehr „60 ms nach dem Erscheinen" von außen: Unter Last kam diese Messung so
// spät, dass die Blase schon 120 Punkte weit zu den freien Ideen geschwommen war (E2 rot, allein grün).
await P.evaluate(() => {
  window.__ersteLage = null;
  const schau = () => {
    if (window.__ersteLage) return;
    const el = [...document.querySelectorAll('[data-taste="bub-blase"]')].find((e) => e.textContent === 'Kaffeebar');
    if (!el || !el.style.transform) return;                      // noch nicht gezeichnet (die Bühne setzt die Lage je Bild)
    const r = el.getBoundingClientRect();
    window.__ersteLage = { x: r.left, y: r.top, width: r.width, height: r.height };
    mo.disconnect();
  };
  const mo = new MutationObserver(schau);
  mo.observe(document.querySelector('.bub-buehne'), { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
});
await P.keyboard.type('Kaffeebar'); await P.keyboard.press('Enter');
await P.waitForFunction(() => !!window.__ersteLage, null, { timeout: 15000 }).catch(() => {});
const lageK = await P.evaluate(() => window.__ersteLage);
await P.waitForTimeout(1200);
let d = await daten(P);
const kaffee = Object.values(d.ideen).find((i) => i.text === 'Kaffeebar');
pruefe('E2 die Idee ist da – frei, und sie entsteht dort (nicht vom Rand hereingeflogen)', !!kaffee && !kaffee.g && !!lageK && Math.hypot(lageK.x + lageK.width / 2 - frei0[0], lageK.y + lageK.height / 2 - frei0[1]) < 60, JSON.stringify({ kaffee, lageK, frei0 }));
// Doppelklick in den Tropfen der Gruppe „Messe" (neben einer Idee, im Rand der Form)
const imTropfen = await P.evaluate(() => {
  const ms = [...document.querySelectorAll('[data-taste="bub-blase"]')].filter((e) => /Messestand|Lounge|Markenfarben|Empfangstresen/.test(e.textContent)).map((e) => e.getBoundingClientRect());
  for (const q of ms) for (let w = 0; w < 360; w += 15) { const rad = q.width / 2 + 7; const x = q.left + q.width / 2 + Math.cos(w / 57.3) * rad; const y = q.top + q.height / 2 + Math.sin(w / 57.3) * rad; if (document.elementFromPoint(x, y)?.classList.contains('bub-buehne')) return [x, y]; }
  return null;
});
await P.mouse.dblclick(imTropfen[0], imTropfen[1]); await P.waitForTimeout(300);
pruefe('E3 Doppelklick im Tropfen einer Gruppe: das Feld nennt die Gruppe', /Messe/.test(await P.locator('[data-taste="bub-hier"]').getAttribute('placeholder').catch(() => '')));
await P.keyboard.type('Garderobe'); await P.keyboard.press('Enter'); await P.waitForTimeout(1200);
d = await daten(P);
pruefe('E4 … und die Idee landet in der Gruppe', Object.values(d.ideen).find((i) => i.text === 'Garderobe')?.g === 'g1', JSON.stringify(Object.values(d.ideen).find((i) => i.text === 'Garderobe')));
await P.mouse.dblclick(frei0[0], frei0[1] - 40); await P.waitForTimeout(200);
await P.keyboard.press('Escape'); await P.waitForTimeout(300);
pruefe('E5 Esc schließt das Feld, ohne etwas anzulegen', (await P.locator('[data-taste="bub-hier"]').count()) === 0 && Object.keys((await daten(P)).ideen).length === 11);

// ══ F ═══════════════════════════════════════════════════════════════
console.log('F  Farbe einer Gruppe');
await P.locator('[data-taste="bub-ring-name"][data-gruppe="g2"]').click(); await P.waitForTimeout(300);
pruefe('F1 die Gruppen-Leiste hat Farbpunkte', (await P.locator('[data-taste="bub-gruppe-farben"] button').count()) === 10);
await P.locator('[data-taste="bub-gruppe-farben"] button[data-farbe="5"]').click(); await P.waitForTimeout(800);
pruefe('F2 ein Punkt ändert die Farbe der Gruppe', (await daten(P)).gruppen.g2.farbe === 5, JSON.stringify((await daten(P)).gruppen.g2));
await P.keyboard.press('Escape'); await P.waitForTimeout(200);

// ══ G ═══════════════════════════════════════════════════════════════
console.log('G  Klar; dunkel');
await P.locator('.bub-buehne').click({ position: { x: 5, y: 5 } }).catch(() => {});
await P.locator('[data-taste="bub-mehr"]').click(); await P.waitForTimeout(200);
await P.locator('[data-taste="bub-stil"] button[data-stil="klar"]').click(); await P.waitForTimeout(1200);
const klar = await P.evaluate(() => ({ tropfen: document.querySelector('[data-taste="bubbles"]').classList.contains('tropfen'), formen: !!document.querySelector('[data-taste="bub-formen"]'), ring: getComputedStyle(document.querySelector('[data-taste="bub-ring"]')).borderTopStyle, schatten: getComputedStyle(document.querySelector('.react-flow__node-bubbles')).boxShadow }));
pruefe('G1 „Klar" zeigt den bisherigen Look: Ringe, keine Formen-Schicht, Kartenrahmen', !klar.tropfen && !klar.formen && klar.ring === 'dashed' && klar.schatten !== 'none', klar);
pruefe('G2 die Wahl gehört zur Karte (für alle gleich)', (await daten(P)).stil === 'klar');
await P.locator('[data-taste="bub-mehr"]').click({ force: true }).catch(() => {}); await P.waitForTimeout(200);
if (!(await P.locator('[data-taste="bub-stil"]').count())) { await P.locator('[data-taste="bub-mehr"]').click(); await P.waitForTimeout(200); }
await P.locator('[data-taste="bub-stil"] button[data-stil="tropfen"]').click(); await P.waitForTimeout(800);
pruefe('G3 und zurück zu Tropfen', await P.evaluate(() => document.querySelector('[data-taste="bubbles"]').classList.contains('tropfen')));
await ctx.close();
{
  const { ctx: c2, P: Q } = await auf({ colorScheme: 'dark' });
  await Q.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await Q.waitForTimeout(400);
  const dunkel = await Q.evaluate(() => ({ grund: getComputedStyle(document.querySelector('.bub')).getPropertyValue('--bub-grund').trim(), schrift: getComputedStyle(document.querySelector('[data-taste="bub-blase"]')).color }));
  pruefe('G4 dunkle Ansicht: dunkler Grund für das Pastell, helle Schrift', dunkel.grund !== '#ffffff' && dunkel.grund !== '' && dunkel.schrift !== 'rgb(0, 0, 0)', dunkel);
  await Q.screenshot({ path: path.join(SD, 'm415-dunkel.png') });
  await c2.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM415: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
