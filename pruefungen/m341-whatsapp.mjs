/**
 * M341 — WhatsApp-Nachricht.
 *
 *   A  Auszeichnung: Titel/Überschrift fett, *fett* _kursiv_, Listen, Nummern, Zitat, ✅/⬜, Link mit Adresse.
 *   B  Der Knopf ist ein echter Link auf wa.me (neuer Tab), die Adresse lässt sich entschlüsseln.
 *   C  Lange Notiz: Adresse bleibt unter der Grenze, Schnitt an einem Zeilenende, der GANZE Text
 *      liegt in der Zwischenablage, ein Hinweis sagt das.
 *   D  Emoji an der Schnittstelle: kein Fehler (vorher tat der Knopf dann nichts).
 *   E  Handy: lange Nachricht geht über das Teilen-Blatt des Geräts, ungekürzt.
 *   F  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m341-whatsapp.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4559;
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

const t = (text, styles = {}) => ({ type: 'text', text, styles });
const reich = [
  { id: 'a0', type: 'paragraph', content: [t('Einkauf fürs Wochenende 🛒')] },
  { id: 'a1', type: 'heading', props: { level: 2 }, content: [t('Besprechung '), t('Relaunch', { bold: true })] },
  { id: 'a2', type: 'paragraph', content: [t('Normal '), t('fett', { bold: true }), t(' und '), t('kursiv', { italic: true }), t(' und '), t('weg', { strike: true }), t(' — siehe '), { type: 'link', href: 'https://example.com/plan', content: [t('Plan')] }] },
  { id: 'a3', type: 'bulletListItem', content: [t('Punkt eins')], children: [{ id: 'a3a', type: 'bulletListItem', content: [t('Unterpunkt tief')] }] },
  { id: 'a4', type: 'numberedListItem', content: [t('Erstens')] },
  { id: 'a5', type: 'numberedListItem', content: [t('Zweitens')] },
  { id: 'a6', type: 'quote', content: [t('Ein Zitat')] },
  { id: 'a7', type: 'checkListItem', content: [t('Offene Aufgabe')] },
  { id: 'a8', type: 'checkListItem', props: { checked: true }, content: [t('Erledigte Aufgabe')] },
];
const lang = Array.from({ length: 120 }, (_, i) => ({ id: `l${i}`, type: 'paragraph', content: `Zeile ${i + 1}: Größere Mengen Text für die Übergabe, mit Umlauten äöü und Zeichen.` }));
const stand = () => ({
  boards: [{ id: 'b1', name: 'WA', comments: [], edges: [], drawings: [], nodes: [
    { id: 'n1', type: 'note', width: 340, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: reich } },
    { id: 'n2', type: 'kanban', width: 320, height: 240, position: { x: 420, y: 0 }, data: { title: 'Aufgaben', items: [{ id: 'k1', text: 'Angebot schreiben', col: 0, who: 'Mia' }] } },
    { id: 'n3', type: 'note', width: 300, height: 200, autoFit: false, position: { x: 820, y: 0 }, data: { color: 'sky', blocks: lang } },
    { id: 'n4', type: 'note', width: 300, height: 200, autoFit: false, position: { x: 1200, y: 0 }, data: { color: 'mint', blocks: [{ id: 'e1', type: 'paragraph', content: '😀'.repeat(2500) }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite({ handy = false } = {}) {
  const ctx = await browser.newContext(handy
    ? { viewport: { width: 420, height: 860 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/wa\.me|whatsapp\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>ok' }));
  await ctx.addInitScript(({ st }) => {
    window.__geteilt = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__geteilt.push(d); return Promise.resolve(); } });
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand() });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
  return { ctx, P };
}
/** Teilen-Dialog für diese Karten öffnen (über den Speicher — die Auswahl-Leiste prüft m340) */
const dialog = async (P, ids) => {
  await P.keyboard.press('Escape');
  await P.evaluate(() => document.querySelector('.share-cards-modal .modal-x')?.click());
  await P.waitForTimeout(200);
  if (await P.locator('.react-flow__node[data-id="' + ids[0] + '"] .card-grip').count() && !(await P.evaluate(() => matchMedia('(pointer: coarse)').matches))) {
    await P.mouse.click(1380, 860); await P.waitForTimeout(150);
    for (const [i, id] of ids.entries()) { await P.locator(`.react-flow__node[data-id="${id}"] .card-grip`).click({ force: true, modifiers: i ? ['Shift'] : [] }); await P.waitForTimeout(250); }
    await P.locator('.sel-toolbar [aria-label="Teilen"]').click();
  } else {
    await P.locator(`.react-flow__node[data-id="${ids[0]}"]`).tap({ position: { x: 20, y: 6 } }).catch(() => {});
    await P.waitForTimeout(400);
    await P.locator('[aria-label="Teilen"]').first().click();
  }
  await P.waitForSelector('.share-cards-modal'); await P.waitForTimeout(300);
  return P.locator('.share-cards-modal a.share-ziel');
};
const nachricht = async (a) => { const h = await a.getAttribute('href'); return { h, text: decodeURIComponent(h.replace('https://wa.me/?text=', '')) }; };

console.log('\n════ A/B: Auszeichnung und Link ════');
{
  const { ctx, P } = await seite();
  const a = await dialog(P, ['n1', 'n2']);
  const { h, text } = await nachricht(a);
  console.log(text.split('\n').map((z) => `      ${z}`).join('\n'));
  pruefe('A1 Titelzeile und Überschrift fett — ohne doppelte Sternchen', text.startsWith('*Einkauf fürs Wochenende 🛒*') && text.includes('\n*Besprechung Relaunch*\n') && !text.includes('**'));
  pruefe('A2 fett, kursiv, durchgestrichen in WhatsApp-Zeichen', text.includes('Normal *fett* und _kursiv_ und ~weg~'));
  pruefe('A3 der Link steht mit seiner Adresse da', text.includes('Plan: https://example.com/plan'));
  pruefe('A4 Liste mit Unterpunkt, Nummern, Zitat', text.includes('- Punkt eins\n   ◦ Unterpunkt tief\n\n1. Erstens\n2. Zweitens') && text.includes('> Ein Zitat'));
  pruefe('A5 offene und erledigte Punkte', text.includes('⬜ Offene Aufgabe') && text.includes('✅ ~Erledigte Aufgabe~'));
  pruefe('A6 zweite Karte abgesetzt, ihr Titel fett', text.includes('\n\n———\n\n*Aufgaben*\n\n_') && text.includes('⬜ Angebot schreiben @Mia') && !/:\n\s+—/.test(text));
  pruefe('B1 ein echter Link auf wa.me in neuem Tab', h.startsWith('https://wa.me/?text=') && await a.getAttribute('target') === '_blank' && /noopener/.test(await a.getAttribute('rel')));
  const [pop] = await Promise.all([P.waitForEvent('popup', { timeout: 15000 }), a.click()]);
  pruefe('B2 der Klick öffnet WhatsApp mit genau dieser Nachricht', pop.url() === h, pop.url().slice(0, 60));
  await pop.close();

  console.log('\n════ C: lange Nachricht ════');
  const l = await dialog(P, ['n3']);
  const lang1 = await nachricht(l);
  pruefe('C1 die Adresse bleibt unter 6000 Zeichen und lässt sich lesen', lang1.h.length <= 6000 && lang1.h.length > 4000 && lang1.text.startsWith('*Zeile 1:'), String(lang1.h.length));
  pruefe('C2 gekürzt an einem Zeilenende, mit Hinweis', /Zeichen\.\n… \(gekürzt\)$/.test(lang1.text), JSON.stringify(lang1.text.slice(-60)));
  pruefe('C3 der Knopf sagt, dass die Nachricht lang ist', /lange Nachricht/.test(await l.textContent()));
  const [pop2] = await Promise.all([P.waitForEvent('popup', { timeout: 15000 }), l.click()]);
  await P.waitForTimeout(600);
  const zw = await P.evaluate(() => navigator.clipboard.readText());
  pruefe('C4 der GANZE Text liegt in der Zwischenablage', zw.includes('Zeile 120:') && zw.startsWith('*Zeile 1:'), `${zw.length} Zeichen`);
  pruefe('C5 … und ein Hinweis sagt das', /Zwischenablage/.test(await P.evaluate(() => document.querySelector('.toast')?.textContent ?? '')));
  await pop2.close();

  console.log('\n════ D: Emoji an der Schnittstelle ════');
  const e = await dialog(P, ['n4']);
  let fehler = '';
  let em = null;
  try { em = await nachricht(e); } catch (x) { fehler = String(x); }
  pruefe('D1 die Adresse ist gültig (kein halbes Emoji)', !fehler && !!em && em.h.length <= 6000 && /^(😀)+\n… \(gekürzt\)$/u.test(em.text), fehler || String(em?.h.length));
  await ctx.close();
}

console.log('\n════ E: Handy ════');
{
  const { ctx, P } = await seite({ handy: true });
  const grob = await P.evaluate(() => matchMedia('(pointer: coarse)').matches);
  // Dialog direkt über die Auswahl-Leiste am Handy
  const karte = P.locator('.react-flow__node[data-id="n3"]');
  await karte.scrollIntoViewIfNeeded().catch(() => {});
  let a = null;
  try { a = await dialog(P, ['n3']); } catch { /* unten gemeldet */ }
  if (a && await a.count()) {
    const pops = []; P.on('popup', (x) => pops.push(x));
    await a.click(); await P.waitForTimeout(700);
    const geteilt = await P.evaluate(() => window.__geteilt);
    pruefe('E1 lange Nachricht am Handy: das Teilen-Blatt bekommt den ganzen Text, kein gekürzter Link', grob && geteilt.length === 1 && geteilt[0].text.includes('Zeile 120:') && pops.length === 0, JSON.stringify({ grob, n: geteilt.length, pops: pops.length }));
  } else pruefe('E1 lange Nachricht am Handy: das Teilen-Blatt bekommt den ganzen Text', false, 'Dialog nicht erreichbar');
  await ctx.close();
}

console.log('\n════ F: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('F1 „Was ist neu" nennt M341', js.includes('(M341)'));

await browser.close();
app.close();
console.log(`\nm341-whatsapp: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
