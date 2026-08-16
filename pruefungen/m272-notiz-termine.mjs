/**
 * M272 — „aus einer normalen notitz sollen ebenfalls kalender einträge mit
 * verbundenen kalender modulen synchronisiert (übergeben) werden!"
 *
 * Aufbau: Zwei Notizen mit Datumsangaben im FLIESSTEXT (keine Checklisten),
 * eine davon per Pfeil mit dem Kalender verbunden. Geprüft wird:
 *  · Erscheinen die Termine im Kalender — am richtigen Tag, mit Uhrzeit?
 *  · Respektiert der Verbunden-Bereich die Pfeile?
 *  · Entsteht KEIN Duplikat, wenn dieselbe Frist in einer Checkliste steht?
 *  · Landen die Notiz-Termine im Export (M270) — also „übergeben"?
 */
// Läuft aus dem Repository: `node pruefungen/m272-notiz-termine.mjs`
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
const PORT = 4493;
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

const absatz = (id, text) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] });
const check = (id, text) => ({ id, type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text, styles: {} }], children: [] });

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
  const nodes = [
    { id: 'cal', type: 'calendar', position: { x: 480, y: 40 }, width: 860, height: 620,
      data: { month: '2027-05' } },
    // VERBUNDENE Notiz: Fließtext-Termine + eine Checkliste mit derselben Frist
    { id: 'n1', type: 'note', position: { x: 40, y: 40 }, width: 380, height: 300,
      data: { color: 'yellow', blocks: [
        { id: 'h1', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Abschlussprüfungen 2027', styles: {} }], children: [] },
        { id: 'p1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Deutsch am 12.05.2027 im Haus A', styles: {} }], children: [] },
        { id: 'p2', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Mathematik am 15.05.2027 um 08:30 Uhr', styles: {} }], children: [] },
        { id: 'c1', type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'Raumplan bis 10.05.2027 aushängen', styles: {} }], children: [] },
      ] } },
    // NICHT verbundene Notiz mit eigenem Termin
    { id: 'n2', type: 'note', position: { x: 40, y: 400 }, width: 380, height: 160,
      data: { color: 'blue', blocks: [
        { id: 'p3', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Elternabend am 20.05.2027', styles: {} }], children: [] },
      ] } },
  ];
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b0', name: 'Test', edges: [
      { id: 'e1', source: 'n1', target: 'cal', type: 'labeled', data: {} },
    ], drawings: [], nodes, comments: [] }],
    spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
});
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2400);

/** Alle Kalender-Chips eines Tages */
const chips = () => P.evaluate(() => {
  const out = {};
  for (const zelle of document.querySelectorAll('.cal-cell')) {
    const tagNr = zelle.querySelector('.cal-daynum')?.textContent.trim();
    const texte = [...zelle.querySelectorAll('.cal-chip')].map((c) => c.textContent.trim());
    if (texte.length) out[tagNr] = texte;
  }
  return out;
});

// ══ T1: Verbunden-Bereich — nur die verbundene Notiz liefert ══════════
console.log('════ T1: Termine der VERBUNDENEN Notiz ════');
{
  const bereich = await P.evaluate(() =>
    [...document.querySelectorAll('.cal-nav button')].find((b) => b.textContent.includes('Verbunden'))?.textContent.trim());
  console.log('    Bereichs-Schalter:', bereich);
  pruefe('T1a der Kalender steht auf „Verbunden" (Pfeil vorhanden)', bereich === 'Verbunden (1)', bereich);

  const c = await chips();
  console.log('    Chips im Mai 2027:', JSON.stringify(c));
  pruefe('T1b „Deutsch am 12.05." steht am 12.', !!c['12']?.some((t) => t.includes('Deutsch')), JSON.stringify(c['12']));
  pruefe('T1c „Mathematik" steht am 15. MIT Uhrzeit', !!c['15']?.some((t) => t.includes('08:30') && t.includes('Mathematik')), JSON.stringify(c['15']));
  pruefe('T1d der Checklisten-Punkt erscheint als Aufgabe am 10.', !!c['10']?.some((t) => t.includes('Raumplan')), JSON.stringify(c['10']));
  pruefe('T1e der Checklisten-Punkt steht NICHT doppelt', (c['10'] ?? []).filter((t) => t.includes('Raumplan')).length === 1, JSON.stringify(c['10']));
  pruefe('T1f die UNVERBUNDENE Notiz liefert hier nichts', !c['20']?.some((t) => t.includes('Elternabend')), JSON.stringify(c['20']));
  pruefe('T1g Notiz-Termine tragen das Stift-Zeichen', !!c['12']?.some((t) => t.startsWith('✎')), JSON.stringify(c['12']));
}

// ══ T2: Bereich „Alle Boards" — auch die unverbundene Notiz ══════════
console.log('\n════ T2: Bereich „Alle Boards" ════');
{
  await P.evaluate(() => {
    [...document.querySelectorAll('.cal-nav button')].find((b) => b.textContent.includes('Verbunden'))?.click();
  });
  await P.waitForTimeout(700);
  const c = await chips();
  pruefe('T2a jetzt ist auch der Elternabend am 20. da', !!c['20']?.some((t) => t.includes('Elternabend')), JSON.stringify(c['20']));
  pruefe('T2b die verbundene Notiz liefert weiterhin', !!c['12']?.some((t) => t.includes('Deutsch')));
  await P.screenshot({ path: `${SD}/m272-kalender.png` });
}

// ══ T3: Klick springt zur Notiz ══════════════════════════════════════
console.log('\n════ T3: Klick auf den Eintrag ════');
{
  await P.evaluate(() => {
    for (const zelle of document.querySelectorAll('.cal-cell')) {
      const chip = [...zelle.querySelectorAll('.cal-chip')].find((c) => c.textContent.includes('Deutsch'));
      if (chip) { chip.click(); return; }
    }
  });
  await P.waitForTimeout(1200);
  const ausgewaehlt = await P.evaluate(() =>
    document.querySelector('.react-flow__node.selected')?.getAttribute('data-id')
    ?? document.querySelector('.react-flow__node[data-id="n1"]')?.classList.contains('selected'));
  console.log('    ausgewählt:', JSON.stringify(ausgewaehlt));
  pruefe('T3a der Klick führt zur Quell-Notiz', ausgewaehlt === 'n1' || ausgewaehlt === true, JSON.stringify(ausgewaehlt));
}

// ══ T4: Abschaltbar ══════════════════════════════════════════════════
console.log('\n════ T4: Der Schalter „Termine aus Notizen" ════');
{
  await P.evaluate(() => {
    document.querySelector('.cal-nav button[aria-label="Kalender-Optionen"]')?.click();
  });
  await P.waitForTimeout(600);
  const schalter = await P.evaluate(() => {
    const labels = [...document.querySelectorAll('.cal-menu-check')];
    const l = labels.find((x) => x.textContent.includes('Termine aus Notizen'));
    if (!l) return null;
    l.querySelector('input').click();
    return true;
  });
  pruefe('T4a es gibt den Schalter „Termine aus Notizen"', schalter === true);
  await P.waitForTimeout(700);
  const c = await chips();
  pruefe('T4b abgeschaltet verschwinden die Notiz-Termine', !c['12']?.some((t) => t.includes('Deutsch')), JSON.stringify(c['12']));
  pruefe('T4c die Aufgabe aus der Checkliste bleibt (eigener Schalter)', !!c['10']?.some((t) => t.includes('Raumplan')));
  // wieder einschalten für T5
  await P.evaluate(() => {
    const l = [...document.querySelectorAll('.cal-menu-check')].find((x) => x.textContent.includes('Termine aus Notizen'));
    l?.querySelector('input')?.click();
  });
  await P.waitForTimeout(700);
}

// ══ T5: „Übergeben" — die Notiz-Termine stehen im Export ═════════════
console.log('\n════ T5: Export enthält die Notiz-Termine ════');
{
  await P.evaluate(() => {
    const m = document.querySelector('.cal-menu:not(.cal-dayedit)');
    const b = [...(m?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim().startsWith('Alle Termine / Zeitraum'));
    b?.click();
  });
  await P.waitForTimeout(500);
  const dl = P.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await P.evaluate(() => {
    [...document.querySelectorAll('.cal-export-schnell button')].find((b) => b.textContent.trim() === 'Alle Termine')?.click();
  });
  const datei = await dl;
  pruefe('T5a der Export erzeugt eine Datei', !!datei);
  if (datei) {
    const pfad = `${SD}/m272-export.ics`;
    await datei.saveAs(pfad);
    const ics = readFileSync(pfad, 'utf8');
    pruefe('T5b „Deutsch am 12.05.2027" ist als Termin drin',
      ics.includes('Deutsch am 12.05.2027') && ics.includes('20270512'), '');
    pruefe('T5c der Mathematik-Termin ebenfalls', ics.includes('20270515'));
    pruefe('T5d auch der Elternabend (Bereich „Alle Boards")', ics.includes('Elternabend'));
  }
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
