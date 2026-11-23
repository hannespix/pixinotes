/**
 * M455 — Texte in Grafiken mehrsprachig.
 *
 *   A  Gantt auf Englisch: Kopfzeile (Monate, Kalenderwochen, Quartale, Heute-Fahne) spricht Englisch, nichts
 *      ragt aus dem sichtbaren Bereich oder aus der Fahne; Balken-Namen bleiben, wie sie sind („Heute", „Vorgang"
 *      sind Inhalt), und tragen translate="no".
 *   B  Kalender: Jahresansicht mit englischen Wochentags-Buchstaben (M T W T F S S), Monatsnamen englisch.
 *   C  Zeiterfassung: Wochen- und Monatskopf englisch („Wk", „March").
 *   D  Übersicht (Netz): Board- und Bereichsnamen bleiben und tragen translate="no"; allgemeine Kartenbezeichnungen
 *      englisch; nichts ragt über das Netz hinaus.
 *   E  Gegenprobe auf Deutsch: „KW", „M D M D F S S", „März" — unverändert.
 *
 * Läuft aus dem Repository: node pruefungen/m455-svg-sprache.mjs   (PN_DIST=… für einen anderen Bau)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5455;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, decodeURIComponent(q.url.split('?')[0]));
  if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  r.setHeader('content-type', TYP[path.extname(f)] ?? 'application/octet-stream');
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

// ---------- Vorrat ----------
// Inhalte sind absichtlich Wörter der Oberfläche („Heute", „Vorgang", „Wochen", „Tage") — sie dürfen nicht übersetzt werden
const tag = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const gantt = (id, dw) => ({ id, type: 'gantt', width: 760, height: 260, position: { x: 0, y: 0 }, data: { title: 'Wochen', dayWidth: dw, rows: [
  { id: 'r1', name: 'Vorgang', start: tag(-3), end: tag(40), color: '#4f7cff', who: 'Anna Berg' },
  { id: 'r2', name: 'Heute', start: tag(6), end: tag(6), color: '#d84b3d' },
] } });
const boards = [
  { id: 'g-tage', name: 'Wochen', nodes: [gantt('g1', 24)], edges: [] },
  { id: 'g-wochen', name: 'G2', nodes: [gantt('g2', 8)], edges: [] },
  { id: 'g-monate', name: 'G3', nodes: [gantt('g3', 1.5)], edges: [] },
  { id: 'g-jahre', name: 'G4', nodes: [gantt('g4', 0.6)], edges: [] },
  { id: 'kal', name: 'Kal', nodes: [{ id: 'c1', type: 'calendar', width: 760, height: 620, position: { x: 0, y: 0 }, data: { view: 'jahr' } }], edges: [] },
  { id: 'zeit', name: 'Zeit', nodes: [{ id: 'z1', type: 'time', width: 520, height: 420, position: { x: 0, y: 0 }, data: { title: 'Zeit', segs: [], view: 'woche' } }], edges: [] },
];
const stand = (aktiv, view = 'board') => ({
  boards, activeId: aktiv, view, overviewMode: 'netz',
  graphLayers: { cards: true, portals: true, wikis: true, projectOnly: false, regionen: true },
  spaces: [{ id: 's1', name: 'Tage', projects: [{ id: 'p1', name: 'Vorgang', boardIds: boards.map((b) => b.id) }] }],
});

async function seite(aktiv, sprache, view = 'board') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ st, sprache }) => {
    if (sessionStorage.getItem('pn-test-bereit')) return;
    sessionStorage.setItem('pn-test-bereit', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    localStorage.setItem('pixinotes-sprache', sprache);
  }, { st: stand(aktiv, view), sprache });
  const P = await ctx.newPage();
  P.fehler = [];
  P.on('pageerror', (e) => { P.fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1400);
  return { ctx, P };
}

/** Alle Texte im Gantt-Diagramm: Inhalt, Klasse, translate="no"?, ragt etwas aus dem sichtbaren Bereich der Karte? */
const ganttTexte = (P) => P.evaluate(() => {
  const svg = document.querySelector('.react-flow__node-gantt svg text')?.ownerSVGElement;
  if (!svg) return null;
  // sichtbarer Bereich: der scrollende Rahmen um das Diagramm
  let rahmen = svg.parentElement;
  while (rahmen && rahmen.scrollWidth <= rahmen.clientWidth + 1 && rahmen !== document.body) rahmen = rahmen.parentElement;
  const R = (rahmen ?? svg).getBoundingClientRect();
  return [...svg.querySelectorAll('text')].map((t) => {
    const r = t.getBoundingClientRect();
    return {
      text: t.textContent, klasse: t.getAttribute('class') ?? '', ohne: !!t.closest('[translate="no"]'),
      breite: r.width, drin: r.left >= R.left - 0.5 && r.right <= R.right + 0.5 && r.width > 0,
    };
  });
});
const kopf = (liste) => liste.filter((t) => /gantt-(month|day|heute-text)/.test(t.klasse));
const balken = (liste) => liste.filter((t) => /gantt-barlabel/.test(t.klasse));
const MONATE_EN = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d\d$/;

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Gantt auf Englisch ════');
{
  const { ctx, P } = await seite('g-tage', 'en');
  const t = await ganttTexte(P);
  pruefe('A1 Diagramm gezeichnet', !!t && t.length > 5, JSON.stringify(t)?.slice(0, 200));
  const k = kopf(t ?? []);
  pruefe('A2 Monate englisch (en-GB, „Nov 26")', k.filter((x) => x.klasse.includes('gantt-month')).every((x) => MONATE_EN.test(x.text)) && k.some((x) => x.klasse.includes('gantt-month')), k.map((x) => x.text).join('|'));
  const fahne = await P.evaluate(() => {
    const tx = document.querySelector('.react-flow__node-gantt .gantt-heute-text');
    const rect = tx?.previousElementSibling;
    if (!tx || !rect) return null;
    const a = tx.getBoundingClientRect(), b = rect.getBoundingClientRect();
    return { text: tx.textContent, drin: a.left >= b.left && a.right <= b.right, a: [a.left, a.right], b: [b.left, b.right] };
  });
  pruefe('A3 Heute-Fahne sagt „Today" und der Text passt in die Fahne', fahne?.text === 'Today' && fahne.drin, JSON.stringify(fahne));
  const b = balken(t ?? []);
  pruefe('A4 Balken-Namen bleiben (Inhalt „Vorgang", „Heute" — kein „Task"/„Today")', b.some((x) => x.text === 'Vorgang') && b.some((x) => x.text === 'Heute') && !b.some((x) => /^(Task|Today)$/.test(x.text)), b.map((x) => x.text).join('|'));
  pruefe('A5 Balken-Namen und Initialen tragen translate="no"', b.length >= 2 && b.every((x) => x.ohne) && t.filter((x) => x.klasse.includes('gantt-who-badge')).every((x) => x.ohne && x.text === 'AB'));
  const titel = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node-gantt .gantt-bar > title')].map((x) => [x.textContent, !!x.closest('[translate="no"]')]));
  pruefe('A6 Balken-Tooltip (Name: Datum → Datum) ist Inhalt — translate="no", Name unverändert', titel.length >= 2 && titel.every(([s, n]) => n && /^(Vorgang|Heute): /.test(s)), JSON.stringify(titel));
  pruefe('A7 Tage: kein Text der Kopfzeile ragt aus dem sichtbaren Bereich', k.length > 3 && k.every((x) => x.drin), JSON.stringify(k.filter((x) => !x.drin)));
  await P.screenshot({ path: `${SD}/m455-a-tage.png` });
  pruefe('A8 keine Skriptfehler', P.fehler.length === 0, P.fehler.join(' | '));
  await ctx.close();
}
{
  const { ctx, P } = await seite('g-wochen', 'en');
  const k = kopf((await ganttTexte(P)) ?? []);
  const wochen = k.filter((x) => x.klasse.includes('gantt-day'));
  pruefe('A9 Wochen: Kalenderwochen heißen „Wk n", kein „KW"', wochen.length >= 3 && wochen.every((x) => /^Wk \d{1,2}$/.test(x.text)), wochen.map((x) => x.text).join('|'));
  pruefe('A10 Wochen: Schilder liegen ganz im Bild', k.every((x) => x.drin), JSON.stringify(k.filter((x) => !x.drin)));
  await P.screenshot({ path: `${SD}/m455-a-wochen.png` });
  await ctx.close();
}
for (const [board, name] of [['g-monate', 'Monate'], ['g-jahre', 'Jahre']]) {
  const { ctx, P } = await seite(board, 'en');
  const t = (await ganttTexte(P)) ?? [];
  const k = kopf(t);
  const monate = k.filter((x) => x.klasse.includes('gantt-month'));
  const gut = name === 'Monate' ? monate.every((x) => MONATE_EN.test(x.text)) : monate.every((x) => /^\d{4}$/.test(x.text)) && k.some((x) => /^Q[1-4]$/.test(x.text));
  pruefe(`A11 ${name}: Kopfzeile englisch/sprachneutral und ganz im Bild`, monate.length >= 2 && gut && k.every((x) => x.drin), k.map((x) => `${x.text}${x.drin ? '' : '!'}`).join('|'));
  pruefe(`A12 ${name}: Balken-Namen unverändert mit translate="no"`, balken(t).length >= 1 && balken(t).every((x) => x.ohne && /^(Vorgang|Heute|Vorg.*…|Heu.*…)$/.test(x.text)), balken(t).map((x) => x.text).join('|'));
  await P.screenshot({ path: `${SD}/m455-a-${name.toLowerCase()}.png` });
  await ctx.close();
}

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Kalender ════');
const kalender = (P) => P.evaluate(() => {
  const k = document.querySelector('.react-flow__node-calendar');
  const erster = k?.querySelector('.cal-jahr-raster');
  return {
    buchstaben: erster ? [...erster.querySelectorAll('.cal-jahr-dow')].map((s) => s.textContent).join(' ') : '',
    monate: k ? [...k.querySelectorAll('.cal-jahr-kopf')].map((b) => b.textContent.trim()) : [],
    abgeschnitten: k ? [...k.querySelectorAll('.cal-jahr-kopf, .cal-jahr-dow')].filter((e) => e.scrollWidth > e.clientWidth + 1).length : -1,
  };
});
{
  const { ctx, P } = await seite('kal', 'en');
  const k = await kalender(P);
  pruefe('B1 Jahresansicht: Wochentage „M T W T F S S"', k.buchstaben === 'M T W T F S S', k.buchstaben);
  pruefe('B2 Monatsnamen englisch (Mar, May, Oct, Dec)', k.monate.length === 12 && ['Mar', 'May', 'Oct', 'Dec'].every((m) => k.monate.includes(m)), k.monate.join('|'));
  pruefe('B3 nichts abgeschnitten', k.abgeschnitten === 0, String(k.abgeschnitten));
  await P.screenshot({ path: `${SD}/m455-b-kalender.png` });
  await ctx.close();
}

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Zeiterfassung ════');
const navText = (P) => P.locator('.react-flow__node-time .time-nav b').textContent();
const nachMaerz = async (P) => {
  // Monatsansicht und zurück bis zum März (dort unterscheiden sich die Sprachen)
  await P.evaluate(() => { const s = JSON.parse(localStorage.getItem('pixinotes-board')); return s; });
  const ansicht = P.locator('.react-flow__node-time .time-views button');
  for (let i = 0; i < await ansicht.count(); i++) {
    const t = (await ansicht.nth(i).textContent()).trim();
    if (/^(Monat|Month)$/.test(t)) { await ansicht.nth(i).click({ force: true }); break; }
  }
  await P.waitForTimeout(300);
  for (let i = 0; i < 14 && !/^(März|March) /.test(await navText(P)); i++) {
    await P.locator('.react-flow__node-time .time-nav button').first().click({ force: true });
    await P.waitForTimeout(80);
  }
  return navText(P);
};
{
  const { ctx, P } = await seite('zeit', 'en');
  const woche = await navText(P);
  pruefe('C1 Wochenkopf „Wk n · …"', /^Wk \d{1,2} · /.test(woche), woche);
  const passt = await P.locator('.react-flow__node-time .time-nav b').evaluate((b) => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= b.closest('.react-flow__node').getBoundingClientRect().right);
  pruefe('C2 Wochenkopf passt in die Karte', passt);
  const monat = await nachMaerz(P);
  pruefe('C3 Monatskopf „March 2026" (nicht „März")', /^March \d{4}$/.test(monat), monat);
  await P.screenshot({ path: `${SD}/m455-c-zeit.png` });
  await ctx.close();
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Übersicht (Netz) ════');
{
  const { ctx, P } = await seite('g-tage', 'en', 'overview');
  await P.waitForTimeout(1200);
  const netz = await P.evaluate(() => {
    const svg = document.querySelector('svg.ov-graph-leinwand');
    if (!svg) return null;
    // die Leinwand (und ihr Träger) ist 1×1 px groß und läuft über — maßgeblich ist der Rahmen des Netzes
    let rahmen = svg.parentElement;
    while (rahmen && rahmen.getBoundingClientRect().width < 200) rahmen = rahmen.parentElement;
    const R = rahmen.getBoundingClientRect();
    const namen = [...svg.querySelectorAll('.ov-graph-node > text:not(.ov-graph-count)')].map((t) => ({ text: t.textContent, ohne: !!t.closest('[translate="no"]'), breite: t.getBoundingClientRect().width }));
    const bereich = [...svg.querySelectorAll('text tspan')].map((t) => ({ text: t.textContent, ohne: !!t.closest('[translate="no"]') }));
    const punkte = [...svg.querySelectorAll('.ov-graph-dot > title')].map((t) => ({ text: t.textContent, ohne: !!t.closest('[translate="no"]') }));
    const alle = [...svg.querySelectorAll('text')].filter((t) => t.getBoundingClientRect().width > 0);
    const raus = alle.filter((t) => { const r = t.getBoundingClientRect(); return r.left < R.left || r.right > R.right || r.top < R.top || r.bottom > R.bottom; }).length;
    return { namen, bereich, punkte, raus, zahl: alle.length };
  });
  pruefe('D1 Netz gezeichnet', !!netz && netz.namen.length === boards.length, JSON.stringify(netz)?.slice(0, 300));
  pruefe('D2 Board-Namen unverändert („Wochen", nicht „Weeks") und translate="no"', !!netz && netz.namen.some((n) => n.text === 'Wochen') && !netz.namen.some((n) => n.text === 'Weeks') && netz.namen.every((n) => n.ohne && n.breite > 0), JSON.stringify(netz?.namen));
  pruefe('D3 Bereichsname unverändert („Tage", nicht „Days") und translate="no"', !!netz && netz.bereich.some((b) => b.text === 'Tage' && b.ohne) && !netz.bereich.some((b) => b.text === 'Days'), JSON.stringify(netz?.bereich));
  pruefe('D4 Karten-Punkte: allgemeine Bezeichnung englisch („Calendar (month view)"), Titel translate="no"', !!netz && netz.punkte.some((p) => /^Calendar \(/.test(p.text)) && !netz.punkte.some((p) => /^Kalender \(/.test(p.text)) && netz.punkte.every((p) => p.ohne), JSON.stringify(netz?.punkte));
  pruefe('D5 jeder Text liegt ganz im Netz-Fenster', !!netz && netz.raus === 0 && netz.zahl > 5, `${netz?.raus} von ${netz?.zahl}`);
  await P.screenshot({ path: `${SD}/m455-d-netz.png` });
  pruefe('D6 keine Skriptfehler', P.fehler.length === 0, P.fehler.join(' | '));
  await ctx.close();
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Gegenprobe Deutsch ════');
{
  const { ctx, P } = await seite('g-wochen', 'de');
  const k = kopf((await ganttTexte(P)) ?? []);
  const wochen = k.filter((x) => x.klasse.includes('gantt-day'));
  pruefe('E1 Gantt: „KW n" und „Heute"', wochen.length >= 3 && wochen.every((x) => /^KW \d{1,2}$/.test(x.text)) && k.some((x) => x.text === 'Heute'), k.map((x) => x.text).join('|'));
  await ctx.close();
}
{
  const { ctx, P } = await seite('kal', 'de');
  const k = await kalender(P);
  pruefe('E2 Kalender: „M D M D F S S", „Mär"', k.buchstaben === 'M D M D F S S' && k.monate.includes('Mär'), `${k.buchstaben} ${k.monate.join('|')}`);
  await ctx.close();
}
{
  const { ctx, P } = await seite('zeit', 'de');
  const woche = await navText(P);
  const monat = await nachMaerz(P);
  pruefe('E3 Zeiterfassung: „KW n · …", „März …"', /^KW \d{1,2} · /.test(woche) && /^März \d{4}$/.test(monat), `${woche} / ${monat}`);
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\nM455: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
