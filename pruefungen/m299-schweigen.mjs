/**
 * M299 — Die App redet weniger.
 *
 * Leitplanke 5 aus dem Konzept (Kapitel 10a): „Ein Toast ist ein Satz. Ein
 * Tooltip benennt, erklärt nicht." Und die Hilfe beschreibt die App von
 * heute in sechs Abschnitten; „Was ist neu" ist eine eigene Seite. Die Reihe
 * prüft:
 *   A  Quelltext: kein Toast und keine Sprechblase länger als 110 Zeichen,
 *      die Hilfe kennt genau sechs Abschnitte und „neu" ist keiner davon.
 *   B  Hilfe im Browser: sechs Einträge plus Impressum/Datenschutz darunter,
 *      kein Fassungs-Vermerk und keine alten Begriffe (Seitenleiste,
 *      Navigator) in den Texten, die Suche filtert weiter, der Fuß führt zu
 *      „Was ist neu" und zurück.
 *   C  „Was ist neu" aus dem Logo-Menü: eigene Seite ohne Menü, neueste
 *      Ausbaustufe zuerst; nach dem Schließen öffnet ❓ wieder die Hilfe.
 *   D  Impressum aus dem Logo-Menü landet in der Hilfe, im Rechtliches-Block.
 *   E  Einstellungen: in keinem Reiter hat ein Erklärtext mehr als zwei Sätze.
 */
// Läuft aus dem Repository: `node pruefungen/m299-schweigen.mjs`
// Voraussetzung: `npm run build` und ein Chromium (PW_CHROMIUM).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4519;
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

console.log('════ A: Quelltext ════');
{
  const dateien = [];
  const lauf = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) lauf(p); else if (/\.tsx?$/.test(f)) dateien.push(p); } };
  lauf(join(__repo, 'src'));
  const toasts = []; const titel = [];
  for (const f of dateien) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/showToast\(\s*(["`'])([^]*?)\1/g)) {
      const t = m[2].replace(/\$\{[^}]*\}/g, 'X');
      if (t.length > 110) toasts.push(`${path.relative(__repo, f)}: ${t.slice(0, 60)}… (${t.length})`);
    }
    for (const m of s.matchAll(/\btitle=\{?["`']([^"`']{111,})["`']/g)) titel.push(`${path.relative(__repo, f)}: ${m[1].slice(0, 60)}… (${m[1].length})`);
  }
  pruefe('A1 kein Toast im Quelltext ist länger als 110 Zeichen', toasts.length === 0, toasts.join(' | '));
  pruefe('A2 keine Sprechblase (title) ist länger als 110 Zeichen', titel.length === 0, titel.join(' | '));
  const hilfe = readFileSync(join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const block = hilfe.match(/const SECTIONS = \[([^]*?)\] as const;/)?.[1] ?? '';
  const ids = [...block.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
  pruefe('A3 die Hilfe kennt genau sechs Abschnitte', ids.length === 6, ids.join(','));
  pruefe('A4 „neu" ist kein Hilfe-Abschnitt mehr', !ids.includes('neu'));
  pruefe('A5 Impressum und Datenschutz stehen als Rechtliches darunter', /const RECHT = \[[^]*?'impressum'[^]*?'datenschutz'/.test(hilfe));
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem('pixinotes-onboarded', '1'); });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const navTexte = (P) => P.locator('.help-nav button:not(.recht)').allTextContents();

console.log('════ B: Die Hilfe ════');
{
  const { ctx, P } = await seite();
  await P.locator('[data-taste="hilfe"]').click();
  await P.waitForSelector('.help-modal');
  const haupt = await navTexte(P);
  pruefe('B1 sechs Einträge in der Hilfe-Navigation', haupt.length === 6, haupt.join(' | '));
  const erwartet = ['Erste Schritte', 'Bereiche · Projekte · Boards', 'Karten & Module', 'Aufgaben & Erinnerungen', 'Speichern, Sync & Teilen', 'Tastenkürzel'];
  pruefe('B2 … in dieser Reihenfolge', erwartet.every((t, i) => (haupt[i] ?? '').includes(t)), haupt.join(' | '));
  const recht = await P.locator('.help-nav button.recht').allTextContents();
  pruefe('B3 Impressum und Datenschutz stehen klein darunter', recht.length === 2 && /Impressum/.test(recht[0]) && /Datenschutz/.test(recht[1]), recht.join(' | '));
  pruefe('B4 „Was ist neu" ist kein Abschnitt der Hilfe', (await P.locator('.help-nav button', { hasText: 'Was ist neu' }).count()) === 0 && (await P.locator('.help-body #help-neu').count()) === 0);
  const text = await P.locator('.help-body').evaluate((el) => {
    const t = [...el.querySelectorAll('section')].filter((s) => !/impressum|datenschutz/.test(s.id)).map((s) => s.textContent).join('\n');
    return t;
  });
  pruefe('B5 kein Fassungs-Vermerk „(M2…)" in den Hilfetexten', !/\(M2\d\d\)/.test(text));
  pruefe('B6 keine alten Begriffe: Seitenleiste, Navigator-Fenster, Physik-Schalter im Dock', !/Seitenleiste|Navigator|⋯ „Mehr"/.test(text), (text.match(/.{0,30}(Seitenleiste|Navigator|⋯ „Mehr").{0,30}/) ?? [''])[0]);
  pruefe('B7 die Hilfe nennt die neue Oberfläche: Navigation, Kachel, ⋯', /Navigation/.test(text) && /Kachel/.test(text) && /⋯/.test(text));
  const langeSaetze = await P.locator('.help-body').evaluate((el) => [...el.querySelectorAll('section:not(#help-impressum):not(#help-datenschutz) li')]
    .map((li) => li.textContent.trim()).filter((t) => t.length > 420).map((t) => t.slice(0, 60)));
  pruefe('B8 kein Hilfe-Punkt ist länger als 420 Zeichen', langeSaetze.length === 0, JSON.stringify(langeSaetze));
  // Suche filtert weiter — sie liest die Abschnitte aus dem DOM
  await P.locator('.help-search').fill('Kachel');
  await P.waitForTimeout(300);
  const treffer = await navTexte(P);
  pruefe('B9 die Suche „Kachel" findet Karten & Module', treffer.some((t) => /Karten & Module/.test(t)) && treffer.length < 6, treffer.join(' | '));
  await P.locator('.help-search').fill('');
  await P.waitForTimeout(200);
  pruefe('B10 leere Suche zeigt wieder alle sechs', (await navTexte(P)).length === 6);
  await P.screenshot({ path: `${SD}/m299-b-hilfe.png` });
  // Der Fuß führt zu „Was ist neu" — und zurück
  await P.locator('.help-foot .help-neu-link').click();
  await P.waitForTimeout(200);
  pruefe('B11 der Fuß-Link öffnet „Was ist neu" als eigene Seite', (await P.locator('.help-neu-modal').count()) === 1 && (await P.locator('.help-nav').count()) === 0);
  await P.locator('.help-zurueck').click();
  await P.waitForTimeout(200);
  pruefe('B12 „Zur Hilfe" führt zurück', (await P.locator('.help-neu-modal').count()) === 0 && (await navTexte(P)).length === 6);
  await ctx.close();
}

console.log('════ C: „Was ist neu" aus dem Logo-Menü ════');
{
  const { ctx, P } = await seite();
  await P.locator('button[aria-label="Über PixiNotes"]').click();
  await P.locator('.about-menu [role="menuitem"]', { hasText: 'Was ist neu' }).click();
  await P.waitForSelector('.help-neu-modal');
  pruefe('C1 eigene Seite: Titel „Was ist neu", kein Hilfe-Menü, kein Suchfeld',
    (await P.locator('.help-neu-modal h2').textContent()).includes('Was ist neu') && (await P.locator('.help-nav').count()) === 0 && (await P.locator('.help-search').count()) === 0);
  const eintraege = await P.locator('#help-neu li').allTextContents();
  // Die Liste wächst mit jeder Ausbaustufe — geprüft wird die Ordnung, nicht eine feste Nummer
  const nummern = eintraege.map((t) => Number((t.match(/\(M(\d+)\)/) ?? [])[1] ?? 0));
  pruefe('C2 die Liste ist lang und beginnt mit der höchsten Ausbaustufe', eintraege.length >= 6 && nummern[0] >= 299 && nummern[0] === Math.max(...nummern), (eintraege[0] ?? '').slice(0, 60));
  pruefe('C3 … und fällt danach Stufe um Stufe ab', nummern.slice(0, 4).every((n, i) => i === 0 || n < nummern[i - 1]), nummern.slice(0, 5).join(','));
  await P.waitForTimeout(600); // Einblend-Animation abwarten, sonst zeigt das Bild ein halb durchsichtiges Fenster
  await P.screenshot({ path: `${SD}/m299-c-neu.png` });
  await P.locator('.help-neu-modal .modal-x').click();
  await P.waitForTimeout(200);
  await P.locator('[data-taste="hilfe"]').click();
  await P.waitForSelector('.help-modal');
  pruefe('C4 ❓ danach öffnet wieder die Hilfe, nicht die Neu-Seite', (await P.locator('.help-neu-modal').count()) === 0 && (await navTexte(P)).length === 6);
  await ctx.close();
}

console.log('════ D: Impressum aus dem Logo-Menü ════');
{
  const { ctx, P } = await seite();
  await P.locator('button[aria-label="Über PixiNotes"]').click();
  await P.locator('.about-menu [role="menuitem"]', { hasText: 'Impressum' }).click();
  await P.waitForSelector('.help-modal');
  await P.waitForTimeout(1200); // der Sprung scrollt weich (scroll-behavior: smooth)
  const on = await P.locator('.help-nav button.on').allTextContents();
  pruefe('D1 die Hilfe öffnet mit markiertem Impressum im Rechtliches-Block', on.length === 1 && /Impressum/.test(on[0]) && (await P.locator('.help-nav button.recht.on').count()) === 1, on.join('|'));
  const sichtbar = await P.locator('#help-impressum h3').evaluate((el) => { const r = el.getBoundingClientRect(); const b = el.closest('.help-body').getBoundingClientRect(); return r.top >= b.top - 2 && r.top < b.bottom; });
  pruefe('D2 … und das Impressum steht im Bild', sichtbar);
  await ctx.close();
}

console.log('════ E: Einstellungen — kein Erklärtext über zwei Sätze ════');
{
  const { ctx, P } = await seite();
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs');
  const reiter = await P.locator('.modal-tabs button').allTextContents();
  const lang = [];
  for (const r of reiter) {
    await P.locator('.modal-tabs button', { hasText: r }).click();
    await P.waitForTimeout(250);
    const treffer = await P.evaluate(() => [...document.querySelectorAll('.modal .modal-hint')]
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
      .filter((t) => {
        // Abkürzungen zählen nicht als Satzende; ein Satz endet vor Großbuchstabe, Ziffer oder Anführungszeichen
        const o = t.replace(/\b(z\. ?B\.|u\. ?a\.|d\. ?h\.|bzw\.|ca\.|Nr\.|vgl\.|inkl\.|ggf\.|evtl\.|usw\.|etc\.|Abs\.|lit\.|Art\.|S\.)/g, '');
        const enden = (o.match(/[.!?]["“”)]?(\s+(?=[A-ZÄÖÜ„"(\d])|$)/g) ?? []).length;
        return enden > 2;
      }));
    for (const t of treffer) lang.push(`[${r}] ${t.slice(0, 90)}…`);
  }
  pruefe('E1 in keinem Reiter hat ein Erklärtext mehr als zwei Sätze', lang.length === 0, '\n      ' + lang.join('\n      '));
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
