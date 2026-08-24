/**
 * M291 — „wenn Karte im Fokus: Text-Bearbeitungsmenü überlagert das
 * Fokus-Karten-Menü …" (Bildschirmfoto vom Telefon)
 *
 * Der Befund, gemessen im alten Stand (390 × 844):
 *   Blätter-Zeile   792 – 844
 *   Karten-Leiste   740 – 792
 *   Formatier-Leiste 800 – 844   ← liegt EXAKT auf der Blätter-Zeile
 *
 * Die Ursache war nicht die Rechnung, sondern ihr Ort: `--focus-bottom` stand
 * an `.focus-mode` — also am App-Container. Die Formatier-Leiste ist aber ein
 * Portal am <body> und liegt NEBEN diesem Container; sie erbte die 0 der
 * Wurzel statt der 104. Eine Variable, die zwei Nachbarn teilen sollen, muss
 * dort stehen, wo beide sie sehen.
 *
 * Diese Reihe misst deshalb Rechtecke, keine Klassennamen: Keine zwei Leisten
 * dürfen sich überlappen — mit und ohne Tastatur.
 */
// Läuft aus dem Repository: `node pruefungen/m291-fokus-leisten.mjs`
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
const PORT = 4511;
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

async function seite(viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');   // Spickzettel-Toast unterdrücken
    const zeilen = ['Urlaubsplan Übersicht', 'Motto: Naturnah', 'Grundregeln',
      'Wettercheck jeden Morgen', 'Highlights', 'Zelt-Nacht im eigenen Garten'];
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Urlaub', edges: [], drawings: [], comments: [], nodes: [
        { id: 'n1', type: 'note', position: { x: 40, y: 40 }, width: 300, height: 260,
          data: { color: 'blue', blocks: zeilen.map((t, i) => ({ id: `p${i}`, type: 'paragraph', props: {},
            content: [{ type: 'text', text: t, styles: {} }], children: [] })) } },
        { id: 'n2', type: 'note', position: { x: 40, y: 340 }, width: 300, height: 180,
          data: { color: 'yellow', blocks: [{ id: 'q1', type: 'paragraph', props: {},
            content: [{ type: 'text', text: 'Zweite Notiz', styles: {} }], children: [] }] } }] }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'Alltag', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: true } }));
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P };
}

/** Karte im Fokus öffnen und Text markieren — der gemeldete Zustand */
async function imFokusMarkieren(P) {
  await P.locator('.note-card').first().click({ force: true });
  await P.waitForTimeout(1600);
  await P.evaluate(() => {
    const el = document.querySelector('.note-editor [contenteditable="true"] p, .note-editor .bn-block-content');
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    el.closest('[contenteditable="true"]')?.focus();
    document.dispatchEvent(new Event('selectionchange'));
  });
  await P.waitForTimeout(1400);
}

const leisten = (P) => P.evaluate(() => {
  const kasten = (sel, name) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    if (r.height === 0 || getComputedStyle(e).display === 'none') return null;
    return { name, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  };
  return [
    kasten('.focus-nav', 'Blättern'),
    kasten('.sel-toolbar-dock', 'Karten-Werkzeuge'),
    kasten('.pn-format-dock', 'Formatieren'),
  ].filter(Boolean);
});

/** Alle Paare auf Überschneidung prüfen (in Bildpunkten, nicht in Absichten) */
function ueberlappungen(liste) {
  const raus = [];
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      const a = liste[i]; const b = liste[j];
      const ueber = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ueber > 1) raus.push(`${a.name} ∩ ${b.name} = ${ueber}px`);
    }
  }
  return raus;
}

// ══ T1: Genau der gemeldete Fall ════════════════════════════════════
console.log('════ T1: Karte im Fokus, Text markiert ════');
{
  const { ctx, P } = await seite();
  await imFokusMarkieren(P);
  const l = await leisten(P);
  console.log('   ', JSON.stringify(l));
  pruefe('T1a alle drei Leisten sind da (Blättern, Werkzeuge, Formatieren)', l.length === 3, JSON.stringify(l));
  const u = ueberlappungen(l);
  pruefe('T1b und KEINE liegt auf einer anderen', u.length === 0, JSON.stringify(u));
  // Reihenfolge von unten nach oben: Blättern · Formatieren · Werkzeuge
  const nachUnten = [...l].sort((a, b) => b.bottom - a.bottom).map((x) => x.name);
  console.log('    von unten:', JSON.stringify(nachUnten));
  pruefe('T1c die Formatier-Leiste sitzt direkt über dem Blättern (dort arbeitet man)',
    nachUnten[0] === 'Blättern' && nachUnten[1] === 'Formatieren', JSON.stringify(nachUnten));
  const unten = Math.min(...l.map((x) => x.top));
  const karte = await P.evaluate(() => {
    const e = document.querySelector('.pn-focused .card-body');
    return e ? Math.round(e.getBoundingClientRect().bottom) : null;
  });
  console.log('    Karte endet bei', karte, '· oberste Leiste beginnt bei', unten);
  pruefe('T1d der Karteninhalt endet über dem Fuß (nichts liegt darunter begraben)',
    karte !== null && karte <= unten + 2, `${karte} vs ${unten}`);
  await P.screenshot({ path: `${SD}/m291-fokus.png` });
  await ctx.close();
}

// ══ T2: Mit offener Tastatur ════════════════════════════════════════
console.log('\n════ T2: Tastatur offen ════');
{
  const { ctx, P } = await seite();
  await imFokusMarkieren(P);
  await P.evaluate(() => {
    document.documentElement.dataset.keyboard = 'on';
    document.documentElement.style.setProperty('--kb', '320px');
  });
  await P.waitForTimeout(700);
  const l = await leisten(P);
  console.log('   ', JSON.stringify(l));
  pruefe('T2a das Blättern tritt zurück (es hilft beim Tippen nicht)',
    !l.some((x) => x.name === 'Blättern'), JSON.stringify(l));
  const u = ueberlappungen(l);
  pruefe('T2b Formatieren und Werkzeuge liegen NICHT übereinander', u.length === 0, JSON.stringify(u));
  pruefe('T2c beide stehen über der Tastatur',
    l.every((x) => x.bottom <= 844 - 320 + 1), JSON.stringify(l));
  await P.screenshot({ path: `${SD}/m291-tastatur.png` });
  await ctx.close();
}

// ══ T3: Ohne Markierung bleibt es zweizeilig ════════════════════════
console.log('\n════ T3: Ohne Textmarkierung ════');
{
  const { ctx, P } = await seite();
  await P.locator('.note-card').first().click({ force: true });
  await P.waitForTimeout(1700);
  const l = await leisten(P);
  console.log('   ', JSON.stringify(l));
  pruefe('T3a ohne Markierung erscheint keine Formatier-Leiste',
    !l.some((x) => x.name === 'Formatieren'), JSON.stringify(l));
  pruefe('T3b und die verbleibenden Leisten überlappen sich nicht',
    ueberlappungen(l).length === 0, JSON.stringify(ueberlappungen(l)));
  await ctx.close();
}

// ══ T4: Meldungen stehen über dem Fuß, nicht darauf ═════════════════
console.log('\n════ T4: Toast im Fokus ════');
{
  const { ctx, P } = await seite();
  await imFokusMarkieren(P);
  await P.evaluate(() => window.__pnStore?.getState?.().showToast?.('Prüfmeldung'));
  // Der Store hängt nicht am window — den Toast über eine echte Aktion auslösen
  await P.evaluate(() => {
    const knopf = [...document.querySelectorAll('.sel-toolbar-dock button')]
      .find((b) => /Duplizieren/i.test(b.getAttribute('title') ?? ''));
    knopf?.click();
  });
  await P.waitForTimeout(900);
  const lage = await P.evaluate(() => {
    const t = document.querySelector('.toast.show');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const leisten = [...document.querySelectorAll('.focus-nav, .sel-toolbar-dock, .pn-format-dock')]
      .map((e) => e.getBoundingClientRect());
    return {
      unten: Math.round(r.bottom),
      kollision: leisten.some((b) => Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 1),
    };
  });
  console.log('    Toast:', JSON.stringify(lage));
  if (lage) {
    pruefe('T4a die Meldung liegt nicht auf einer Leiste', !lage.kollision, JSON.stringify(lage));
  } else {
    pruefe('T4a die Meldung liegt nicht auf einer Leiste', true, '(keine Meldung ausgelöst — nichts zu prüfen)');
  }
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
