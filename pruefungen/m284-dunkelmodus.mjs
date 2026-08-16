/**
 * M284 — „bitte bei dunkel Modus noch optimieren!"
 *
 * Anlass war ein Bildschirmfoto: Die neue Rechen-Tabelle stand als graue
 * Platte auf dem hellen Notizpapier, Knöpfe und Schrift kaum zu erkennen.
 * Ursache: Die Tabelle griff auf die Theme-Flächen zu (`--surface` & Co.),
 * die im Dunkelmodus dunkel sind — Haftnotizen bleiben aber ausdrücklich
 * helles Papier (Regel aus M172).
 *
 * Beim Nachmessen fiel ein ÄLTERER Fehler auf: Eine WEISSE Haftnotiz ist im
 * Dunkelmodus eine dunkle Karte (`--surface-card`), ihr Text stand aber
 * pauschal auf #2b2a27 — gemessen 43,42,39 auf 57,53,48. Das ist praktisch
 * unsichtbar und ist hier mit behoben.
 *
 * Geprüft wird deshalb nicht „sieht gut aus", sondern der KONTRAST: Für jede
 * Schrift wird die tatsächlich darunterliegende Farbe zusammengerechnet
 * (auch durchscheinende Schichten) und das Verhältnis nach WCAG gebildet.
 */
// Läuft aus dem Repository: `node pruefungen/m284-dunkelmodus.mjs`
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
const PORT = 4502;
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

const ZELLEN = {
  A1: 'Posten', B1: 'Betrag', A2: 'Software', B2: '1200',
  A3: 'Schulung', B3: '450,50', A4: 'Summe', B4: '=SUMME(B2:B3)',
  A5: 'Ampel', B5: '=B4*0,19', A6: '[[Test]]',
};
const STIL = { A1: { fett: true }, A4: { bg: '#f8d8d8' }, A5: { bg: '#d8f0d8' }, B5: { bg: '#fdf0c8' } };
const BLOCKS = [
  { id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Kostenaufstellung', styles: {} }], children: [] },
  { id: 'b2', type: 'rechentabelle', children: [],
    props: { zellen: JSON.stringify(ZELLEN), stil: JSON.stringify(STIL), spalten: 2, zeilen: 6 } },
];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

async function seite(thema, notizfarbe) {
  const ctx = await browser.newContext({ viewport: { width: 700, height: 760 } });
  await ctx.addInitScript(({ blocks, thema, farbe }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ theme: thema, navLinks: false }));
    const nodes = [{ id: 'n1', type: 'note', position: { x: 20, y: 30 }, width: 470, height: 520,
      data: { blocks, color: farbe } }];
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
  }, { blocks: BLOCKS, thema, farbe: notizfarbe });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1400);
  await P.evaluate((t) => document.documentElement.setAttribute('data-theme', t), thema);
  await P.waitForTimeout(900);
  return { ctx, P };
}

/**
 * Kontrast eines Elements gegen seinen tatsächlichen Untergrund.
 *
 * Durchscheinende Flächen werden von unten nach oben zusammengerechnet —
 * sonst käme bei „rgba(255,255,255,.44)" der falsche Wert heraus.
 */
const KONTRAST_FN = `
  const zahl = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const misch = (oben, unten) => oben.map((c, i) => (i < 3 ? c * oben[3] + unten[i] * (1 - oben[3]) : 1));
  function grund(el) {
    let farbe = [255, 255, 255, 1];
    const kette = [];
    for (let e = el; e; e = e.parentElement) kette.push(e);
    for (const e of kette.reverse()) {
      const bg = zahl(getComputedStyle(e).backgroundColor);
      if (bg.length < 3) continue;
      const a = bg.length > 3 ? bg[3] : 1;
      if (a === 0) continue;
      farbe = misch([bg[0], bg[1], bg[2], a], farbe);
    }
    return farbe;
  }
  const lum = (c) => {
    const f = c.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  function kontrast(el) {
    const vg = zahl(getComputedStyle(el).color);
    const hg = grund(el);
    const gemischt = vg.length > 3 && vg[3] < 1 ? misch([vg[0], vg[1], vg[2], vg[3]], hg) : vg;
    const a = lum(gemischt); const b = lum(hg);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  }
`;

const messe = (P) => P.evaluate(`(() => { ${KONTRAST_FN}
  const w = (s) => document.querySelector(s);
  const farbig = [...document.querySelectorAll('.rt-zelle')].find((z) => z.style.getPropertyValue('--rt-zellbg'));
  return {
    notiztext: kontrast(w('.bn-editor p')),
    zelle: kontrast(w('.rt-zelle .rt-wert')),
    farbigeZelle: farbig ? kontrast(farbig.querySelector('.rt-wert') ?? farbig) : null,
    knopf: kontrast(w('.rt-leiste button')),
    hilfe: kontrast(w('.rt-hilfe')),
    link: kontrast(w('.rt-link')),
  };
})()`);

const FAELLE = [
  ['hell', 'yellow', 'helles Thema, gelbe Notiz'],
  ['dark', 'yellow', 'dunkles Thema, gelbe Notiz (Papier bleibt hell)'],
  ['dark', 'white', 'dunkles Thema, weiße Notiz (dunkle Karte)'],
  ['dark', 'sky', 'dunkles Thema, blaue Notiz'],
];
const MINDEST = 4.5;   // WCAG AA für normalen Text

for (const [thema, farbe, beschreibung] of FAELLE) {
  console.log(`\n════ ${beschreibung} ════`);
  const { ctx, P } = await seite(thema === 'hell' ? 'light' : 'dark', farbe);
  const k = await messe(P);
  console.log('   ', JSON.stringify(k));
  pruefe(`${thema}/${farbe}: der Notiztext ist lesbar`, k.notiztext >= MINDEST, `Kontrast ${k.notiztext}`);
  pruefe(`${thema}/${farbe}: Zellen der Rechen-Tabelle sind lesbar`, k.zelle >= MINDEST, `Kontrast ${k.zelle}`);
  pruefe(`${thema}/${farbe}: eingefärbte Zellen sind lesbar`, (k.farbigeZelle ?? 0) >= MINDEST, `Kontrast ${k.farbigeZelle}`);
  pruefe(`${thema}/${farbe}: die Werkzeugleiste ist lesbar`, k.knopf >= MINDEST, `Kontrast ${k.knopf}`);
  // Hilfstext und Links dürfen etwas leiser sein (WCAG AA für großen/sekundären Text)
  pruefe(`${thema}/${farbe}: Hilfszeile und Links bleiben erkennbar`,
    k.hilfe >= 3 && k.link >= 3, `Hilfe ${k.hilfe}, Link ${k.link}`);
  await P.screenshot({ path: `${SD}/m284-${thema}-${farbe}.png`, clip: await P.locator('.note-card').boundingBox() });
  await ctx.close();
}

// ══ Die Papier-Palette gilt nur für die hellen Töne ═══════════════════
console.log('\n════ Palette richtig gewählt ════');
{
  const { ctx, P } = await seite('dark', 'yellow');
  const gelb = await P.evaluate(() => getComputedStyle(document.querySelector('.rt-block')).getPropertyValue('--rt-text').trim());
  await ctx.close();
  const { ctx: c2, P: P2 } = await seite('dark', 'white');
  const weiss = await P2.evaluate(() => getComputedStyle(document.querySelector('.rt-block')).getPropertyValue('--rt-text').trim());
  await c2.close();
  console.log(`    gelb → ${gelb} · weiß → ${weiss}`);
  pruefe('auf farbigem Papier gilt die Papier-Palette (dunkle Schrift)', gelb === '#2b2a27', gelb);
  pruefe('auf der weißen (im Dunkeln dunklen) Karte gilt die Theme-Palette', weiss !== '#2b2a27', weiss);
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
