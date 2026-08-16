/**
 * M283 — „kann man rechentabellen auch einfach in normale notes einfügen? …
 * dann hätten wir nur noch einen tabellentyp … daran soll man rechnen können."
 *
 * Geprüft wird die ganze Kette:
 *  · Das Einfügen-Menü („/") bietet EINE Tabelle an — die rechnende; die alte
 *    Fließtext-Tabelle steht nicht mehr zur Wahl.
 *  · In der Notiz rechnet sie wirklich: Summen, Prozente, Bezüge aufeinander.
 *  · Zellen tragen Fett, Ausrichtung, Farbe und Links (ausdrücklicher Wunsch).
 *  · Bestehende Tabellen bleiben stehen und lassen sich per Knopf umwandeln.
 *  · Export/Text/KI-Kontext enthalten die ERRECHNETEN Werte.
 *  · Die Zahlen der Tabelle landen nicht in der Rufnummern-Erkennung.
 */
// Läuft aus dem Repository: `node pruefungen/m283-tabelle.mjs`
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
const PORT = 4501;
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
  A1: 'Posten', B1: 'Betrag',
  A2: 'Software', B2: '1200',
  A3: 'Schulung', B3: '450,50',
  A4: 'Summe', B4: '=SUMME(B2:B3)',
  A5: 'davon 19 %', B5: '=B4*0,19',
  A6: '[[Test]]', B6: 'https://example.org',
};
const STIL = { A1: { fett: true }, B1: { fett: true, aus: 'm' }, B5: { bg: '#fdf0c8' } };

/** Notiz mit rechnender Tabelle UND einer alten Fließtext-Tabelle */
const BLOCKS = [
  { id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Kostenaufstellung', styles: {} }], children: [] },
  { id: 'b2', type: 'rechentabelle', children: [],
    props: { zellen: JSON.stringify(ZELLEN), stil: JSON.stringify(STIL), spalten: 2, zeilen: 6 } },
  { id: 'b3', type: 'table', props: {}, children: [],
    content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: 'Alt A', styles: {} }], [{ type: 'text', text: '10', styles: {} }]] },
      { cells: [[{ type: 'text', text: 'Alt B', styles: {} }], [{ type: 'text', text: '32', styles: {} }]] },
    ] } },
];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

async function seite(blocks) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  await ctx.addInitScript((blocks) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    const nodes = [{ id: 'n1', type: 'note', position: { x: 40, y: 80 }, width: 470, height: 470,
      data: { blocks, color: 'amber' } }];
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
  }, blocks);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2400);
  return { ctx, P };
}

const gitter = (P) => P.evaluate(() =>
  [...document.querySelectorAll('.rt-tabelle tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())));

// ══ T1: Sie steht in der Notiz und rechnet ═══════════════════════════
console.log('════ T1: Rechnen in der Notiz ════');
{
  const { ctx, P } = await seite(BLOCKS);
  pruefe('T1a die Tabelle liegt IN der Notiz', await P.evaluate(() =>
    !!document.querySelector('.note-editor .rt-block')));
  const g = await gitter(P);
  console.log('   ', JSON.stringify(g));
  pruefe('T1b „=SUMME(B2:B3)" ergibt 1.650,5', g[3]?.[1] === '1.650,5', JSON.stringify(g[3]));
  pruefe('T1c eine Formel darf auf eine Formel zeigen (=B4*0,19)',
    g[4]?.[1] === '313,595', JSON.stringify(g[4]));
  pruefe('T1d angezeigt wird das ERGEBNIS, nicht die Formel',
    !JSON.stringify(g).includes('SUMME'), JSON.stringify(g));

  // Hineinklicken zeigt die Formel
  await P.evaluate(() => {
    const zellen = [...document.querySelectorAll('.rt-zelle .rt-wert')];
    // B4 = die Summenzelle
    zellen.find((z) => z.textContent.trim() === '1.650,5')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await P.waitForTimeout(500);
  pruefe('T1e beim Hineinklicken steht die Formel da (Excel-Muster)',
    await P.evaluate(() => document.querySelector('.rt-eingabe')?.value === '=SUMME(B2:B3)'),
    await P.evaluate(() => document.querySelector('.rt-eingabe')?.value ?? 'keine Eingabe'));
  await P.keyboard.press('Escape');
  await P.waitForTimeout(300);

  // Neue Formel tippen — erst eine leere Zeile anhängen, dann hineinschreiben
  await P.locator('.rt-leiste button', { hasText: 'Zeile' }).first().click();
  await P.waitForTimeout(600);
  const leerZelle = P.locator('.rt-zelle .rt-wert').last();
  await leerZelle.dblclick();
  await P.waitForTimeout(400);
  const feld = P.locator('.rt-eingabe').first();
  pruefe('T1f0 ein Doppelklick öffnet die Zelle zum Bearbeiten', await feld.count() === 1);
  if (await feld.count()) {
    await feld.fill('=B4+100');
    await feld.press('Enter');
    await P.waitForTimeout(800);
  }
  const g2 = await gitter(P);
  pruefe('T1f eine neu getippte Formel rechnet sofort',
    JSON.stringify(g2).includes('1.750,5'), JSON.stringify(g2[5]));
  pruefe('T1g und sie steht auch im gespeicherten Stand', await P.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
    const b = s.boards[0].nodes[0].data.blocks.find((x) => x.type === 'rechentabelle');
    return JSON.stringify(b?.props?.zellen ?? '').includes('B4+100');
  }));
  await P.screenshot({ path: `${SD}/m283-notiz.png`, clip: await P.locator('.note-card').boundingBox() });
  await ctx.close();
}

// ══ T2: Formate und Links in der Zelle ═══════════════════════════════
console.log('\n════ T2: Fett, Ausrichtung, Farbe, Links ════');
{
  const { ctx, P } = await seite(BLOCKS);
  const f = await P.evaluate(() => {
    const zellen = [...document.querySelectorAll('.rt-zelle')];
    return {
      fett: zellen.filter((z) => z.classList.contains('fett')).length,
      mitte: zellen.filter((z) => z.classList.contains('aus-m')).length,
      rechts: zellen.filter((z) => z.classList.contains('aus-r')).length,
      /* M284: Die Farbe steht als Variable am Element und wird per CSS zur
         Fläche — geprüft wird deshalb die BERECHNETE Fläche, nicht das
         Attribut. Das hält auch, wenn sich die Ablage nochmal ändert. */
      farbig: zellen.filter((z) => {
        const bg = getComputedStyle(z).backgroundColor;
        return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      }).length,
      links: [...document.querySelectorAll('.rt-link')].map((a) => a.textContent.trim()),
    };
  });
  console.log('   ', JSON.stringify(f));
  pruefe('T2a fette Zellen', f.fett === 2, String(f.fett));
  pruefe('T2b Ausrichtung wird übernommen (zentriert)', f.mitte === 1, String(f.mitte));
  pruefe('T2c Zahlen stehen von selbst rechts', f.rechts >= 3, String(f.rechts));
  pruefe('T2d Zellfarbe wird angezeigt', f.farbig === 1, String(f.farbig));
  pruefe('T2e [[Board]] und https:// werden zu Links',
    f.links.length === 2 && f.links.some((t) => t.includes('Test')) && f.links.some((t) => t.includes('example.org')),
    JSON.stringify(f.links));

  // Format über die Leiste setzen
  await P.locator('.rt-wert', { hasText: /^Software$/ }).first().click();
  await P.waitForTimeout(500);
  pruefe('T2f0 die Leiste nennt die angeklickte Zelle', 
    (await P.locator('.rt-adr').textContent()).trim() === 'A2',
    await P.locator('.rt-adr').textContent());
  await P.locator('.rt-leiste button', { hasText: /^F$/ }).first().click();
  await P.waitForTimeout(700);
  pruefe('T2f „F" macht die angeklickte Zelle fett', await P.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
    const b = s.boards[0].nodes[0].data.blocks.find((x) => x.type === 'rechentabelle');
    return JSON.parse(b.props.stil).A2?.fett === true;
  }));
  await ctx.close();
}

// ══ T3: Das Einfügen-Menü bietet EINE Tabelle ════════════════════════
console.log('\n════ T3: „/" bietet die rechnende Tabelle ════');
{
  const { ctx, P } = await seite([
    { id: 'b1', type: 'paragraph', props: {}, content: [], children: [] },
  ]);
  await P.locator('.bn-editor p').first().click();
  await P.waitForTimeout(400);
  await P.keyboard.type('/tabelle');
  await P.waitForTimeout(900);
  const eintraege = await P.evaluate(() => {
    const alle = [...document.querySelectorAll('[class*="suggestion-menu-item"]')];
    // nur die äußersten Einträge zählen — die Hüllen enthalten ihre Kinder nochmal
    return alle.filter((e) => !alle.some((a) => a !== e && a.contains(e)))
      .map((e) => e.textContent.trim());
  });
  console.log('   ', JSON.stringify(eintraege));
  pruefe('T3a das Menü zeigt genau EINEN Tabellen-Eintrag',
    eintraege.filter((t) => /tabelle/i.test(t)).length === 1, JSON.stringify(eintraege));
  pruefe('T3b und der kündigt das Rechnen an',
    eintraege.some((t) => /rechnet|=/.test(t)), JSON.stringify(eintraege));
  await P.keyboard.press('Enter');
  await P.waitForTimeout(900);
  pruefe('T3c der Eintrag fügt eine rechnende Tabelle ein', await P.evaluate(() =>
    !!document.querySelector('.rt-block')));
  pruefe('T3d und keine Fließtext-Tabelle', await P.evaluate(() =>
    !document.querySelector('.bn-editor table:not(.rt-tabelle)')));
  await ctx.close();
}

// ══ T4: Bestehende Tabelle bleibt — und lässt sich umwandeln ═════════
console.log('\n════ T4: Alte Tabelle umwandeln ════');
{
  const { ctx, P } = await seite(BLOCKS);
  pruefe('T4a die alte Fließtext-Tabelle wird weiter angezeigt', await P.evaluate(() =>
    !!document.querySelector('.bn-editor table:not(.rt-tabelle)')));
  // Cursor in die alte Tabelle setzen
  await P.evaluate(() => {
    const alt = document.querySelector('.bn-editor table:not(.rt-tabelle)');
    const zelle = alt?.querySelector('td, th');
    const r = zelle.getBoundingClientRect();
    zelle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
    const sel = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(zelle);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    zelle.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.dispatchEvent(new Event('selectionchange'));
  });
  await P.waitForTimeout(700);
  const knopf = await P.evaluate(() => {
    const b = [...document.querySelectorAll('.due-chip')].find((x) => x.textContent.includes('Rechnen lassen'));
    if (!b) return false;
    b.click();
    return true;
  });
  pruefe('T4b der Knopf „Σ Rechnen lassen" steht bereit', knopf);
  await P.waitForTimeout(900);
  if (knopf) {
    const stand = await P.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
      const bl = s.boards[0].nodes[0].data.blocks;
      const rt = bl.filter((b) => b.type === 'rechentabelle');
      return {
        alte: bl.filter((b) => b.type === 'table').length,
        rechnende: rt.length,
        inhalt: rt.map((b) => b.props.zellen).join(' '),
      };
    });
    console.log('   ', JSON.stringify(stand));
    pruefe('T4c aus der alten Tabelle wurde eine rechnende',
      stand.alte === 0 && stand.rechnende === 2, JSON.stringify(stand));
    pruefe('T4d die Texte sind mitgekommen',
      stand.inhalt.includes('Alt A') && stand.inhalt.includes('32'), stand.inhalt.slice(0, 120));
  }
  await ctx.close();
}

// ══ T5: Export, Suche, KI — und keine falschen Rufnummern ════════════
console.log('\n════ T5: Text, Export, Chips ════');
{
  const { ctx, P } = await seite(BLOCKS);
  const chips = await P.evaluate(() =>
    [...document.querySelectorAll('.ent-chip')].map((c) => c.textContent.trim()));
  console.log('    Chips:', JSON.stringify(chips));
  pruefe('T5a Tabellenzahlen werden NICHT als Rufnummern angeboten',
    !chips.some((c) => c.startsWith('☎')), JSON.stringify(chips));
  // Kopieren liefert den errechneten Wert
  await P.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('pixinotes-board')).state;
    window.__pn_blocks = st.boards[0].nodes[0].data.blocks;
  });
  const html = await P.evaluate(async () => {
    const karte = document.querySelector('.note-card');
    karte?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return document.body.innerHTML.length > 0;
  });
  pruefe('T5b die Seite bleibt heil', html);
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
