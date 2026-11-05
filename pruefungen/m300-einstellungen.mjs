/**
 * M300 — Einstellungen entrümpelt.
 *
 * Vier Reiter statt sechs, nach Alltagsnähe geordnet; ein Sync-Weg zur Zeit;
 * Team-Sync über einen Wähler; Konten gebündelt; Bild-Export als Aktion am
 * Board. Die Reihe prüft:
 *   A  Reiter: Design · Daten · Synchronisation · Dienste, Design ist offen.
 *   B  Design: vier Gruppen, Erscheinungsbild als Umschalter, Fokus-Umschalter
 *      folgen dem Haupt-Häkchen, kein Erklärtext über zwei Sätze.
 *   C  Daten: Sichern & Laden zuerst, kein Word-Abschnitt, OneNote verweist
 *      auf die Dienste, Starter in einem Satz.
 *   D  Synchronisation: Weg-Umschalter zeigt einen Weg zur Zeit, Team-Sync
 *      mit Wähler statt Knopf je Projekt, Obergrenze als letzte Option.
 *   E  Dienste: KI, Gehirn als Häkchen, Konten mit Google und Microsoft
 *      (OneNote im selben Formular).
 *   F  Kein Fuß mehr im Fenster, kein Daten-Eintrag mehr im Logo-Menü.
 *   G  Bild-Export aus dem Dock (⋯ → Als Bild exportieren) liefert eine Datei.
 *   H  Quelltext: alte Reiter-Namen werden umgeleitet.
 */
// Läuft aus dem Repository: `node pruefungen/m300-einstellungen.mjs`
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
const PORT = 4521;
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
async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { localStorage.setItem('pixinotes-onboarded', '1'); });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const oeffne = async (P) => { await P.locator('[data-taste="einstellungen"]').click(); await P.waitForSelector('.modal-tabs'); };
const reiter = (P, name) => P.locator('.modal-tabs button', { hasText: name }).click();
const h3s = (P) => P.locator('.modal-body section > h3').allTextContents();
/** Sätze zählen, Abkürzungen ausgenommen */
const zuLang = (P) => P.evaluate(() => [...document.querySelectorAll('.modal .modal-hint')]
  .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
  .filter((t) => {
    const o = t.replace(/\b(z\. ?B\.|u\. ?a\.|d\. ?h\.|bzw\.|ca\.|Nr\.|vgl\.|inkl\.|ggf\.|evtl\.|usw\.|etc\.|Abs\.|lit\.|Art\.|S\.)/g, '');
    return (o.match(/[.!?]["“”)]?(\s+(?=[A-ZÄÖÜ„"(\d])|$)/g) ?? []).length > 2;
  }).map((t) => t.slice(0, 80)));

console.log('════ A: Reiter ════');
const { ctx, P } = await seite();
await oeffne(P);
{
  const tabs = await P.locator('.modal-tabs button').allTextContents();
  // M314: drei Reiter — Synchronisation lebt im Reiter Daten
  pruefe('A1 drei Reiter: Darstellung · Daten · Dienste', JSON.stringify(tabs) === JSON.stringify(['Darstellung', 'Daten', 'Dienste']), tabs.join(' | '));
  pruefe('A2 Darstellung ist beim Öffnen aktiv', (await P.locator('.modal-tabs button.on').textContent()) === 'Darstellung');
}

console.log('════ B: Darstellung ════');
{
  const g = await h3s(P);
  pruefe('B1 drei Gruppen: Aussehen, Lesbarkeit, Bedienung (M314)', g.length === 3 && g[0] === 'Aussehen' && g[1] === 'Lesbarkeit' && g[2] === 'Bedienung', g.join(' | '));
  const seg = P.locator('.seg[aria-label="Erscheinungsbild"] button');
  pruefe('B2 Erscheinungsbild ist ein Umschalter mit System · Hell · Dunkel', (await seg.allTextContents()).join(',') === 'System,Hell,Dunkel');
  pruefe('B3 … der aktive Zustand ist sichtbar (Hintergrundfarbe)', await P.locator('.seg[aria-label="Erscheinungsbild"] button.on').evaluate((b) => {
    const cs = getComputedStyle(b); return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.fontWeight !== '400';
  }));
  await seg.nth(2).click();
  await P.waitForTimeout(200);
  const dunkel = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen') ?? '{}').ui?.theme ?? JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.ui?.theme ?? null);
  pruefe('B4 „Dunkel" landet in den Vorlieben', dunkel === 'dark', String(dunkel));
  await seg.nth(0).click();
  // M314: Fokus-Umschalter sind automatisch (Handy: Tipp, PC: Doppelklick, Blatt) — keine Zeilen mehr
  pruefe('B5 keine Fokus-Umschalter mehr (automatisch)', (await P.locator('.modal-row-check', { hasText: 'Karte im Fokus' }).count()) === 0 && (await P.locator('.seg[aria-label="Fokus am PC öffnen mit"]').count()) === 0);
  pruefe('B6 „Besser lesbar" und „Lebendige Fläche" stehen da', (await P.locator('.modal-row-check', { hasText: 'Besser lesbar' }).count()) === 1 && (await P.locator('.modal-row-check', { hasText: 'Lebendige Fläche' }).count()) === 1);
  pruefe('B7 kein Erklärtext im Design hat mehr als zwei Sätze', (await zuLang(P)).length === 0, JSON.stringify(await zuLang(P)));
  pruefe('B8 kein „Mehr dazu"-Sprung mehr aus dem Design', (await P.locator('.modal-body .link-btn', { hasText: 'Mehr dazu' }).count()) === 0);
  await P.locator('.modal').screenshot({ path: `${SD}/m300-b-design.png` });
}

console.log('════ C: Daten ════');
{
  await reiter(P, 'Daten');
  await P.waitForTimeout(250);
  const g = await h3s(P);
  // M314: Synchronisation und Team-Sync stehen hier; die Starter-Umgebung liegt unter ＋ Neu
  pruefe('C1 Reihenfolge: Sichern & Laden · Synchronisation · Team-Sync · Markdown · OneNote · Alles leeren',
    g.length === 6 && /^Sichern & Laden/.test(g[0]) && /^Synchronisation/.test(g[1]) && /^Team-Sync/.test(g[2]) && /Markdown/.test(g[3]) && /OneNote/.test(g[4]) && /Alles leeren/.test(g[5]), g.join(' | '));
  pruefe('C2 kein Word-Abschnitt ohne Knopf mehr', !g.some((t) => /Word/.test(t)));
  pruefe('C3 keine Starter-Umgebung mehr in den Einstellungen', !g.some((t) => /Starter/.test(t)));
  pruefe('C4 der OneNote-Import hat kein eigenes Konto-Formular', (await P.locator('.modal-section', { hasText: 'OneNote' }).locator('input[type="text"]').count()) === 0);
  pruefe('C5 kein Erklärtext im Reiter Daten hat mehr als zwei Sätze', (await zuLang(P)).length === 0, JSON.stringify(await zuLang(P)));
  await P.locator('.modal').screenshot({ path: `${SD}/m300-c-daten.png` });
  await P.locator('.on-konto .link-btn').click();
  await P.waitForTimeout(200);
  pruefe('C6 „Unter Dienste einrichten" springt in den Reiter Dienste', (await P.locator('.modal-tabs button.on').textContent()) === 'Dienste');
}

console.log('════ D: Synchronisation (im Reiter Daten) ════');
{
  await reiter(P, 'Daten');
  await P.waitForTimeout(250);
  const g = await h3s(P);
  pruefe('D1 Synchronisation und Team-Sync stehen im Reiter Daten, keine Dateien-Obergrenze mehr', g.some((t) => /^Synchronisation/.test(t)) && g.some((t) => /Team-Sync/.test(t)) && !g.some((t) => /Dateien mitsynchronisieren/.test(t)), g.join(' | '));
  const wege = await P.locator('.seg-weg button').allTextContents();
  // M317: Konto (Google Drive / OneDrive) steht als erster Weg davor
  pruefe('D2 der Weg-Umschalter bietet Konto, Ordner und WebDAV (Chrome am PC)', wege.join(',') === 'Konto,Ordner,WebDAV', wege.join(','));
  pruefe('D3 „Ordner" ist vorgewählt und zeigt seinen Knopf', (await P.locator('.seg-weg button.on').textContent()) === 'Ordner' && (await P.locator('.modal-buttons button', { hasText: 'Sync-Ordner verbinden' }).count()) === 1);
  pruefe('D4 die WebDAV-Felder sind dabei nicht zu sehen', (await P.locator('input[placeholder^="https://cloud"]').count()) === 0);
  await P.locator('.seg-weg button', { hasText: 'WebDAV' }).click();
  await P.waitForTimeout(150);
  pruefe('D5 „WebDAV" zeigt die Felder und blendet den Ordner-Knopf aus', (await P.locator('input[placeholder^="https://cloud"]').count()) === 1 && (await P.locator('.modal-buttons button', { hasText: 'Sync-Ordner verbinden' }).count()) === 0);
  const auswahl = await P.locator('select[aria-label="Projekt"] option').count();
  pruefe('D6 Team-Sync: ein Wähler mit allen Projekten und EIN Verbinden-Knopf', auswahl >= 2 && (await P.locator('button', { hasText: 'Mit Team-Ordner verbinden' }).count()) === 1, `Optionen: ${auswahl}`);
  pruefe('D7 … keine Liste unverbundener Projekte mehr', (await P.locator('.psync-row').count()) === 0);
  pruefe('D8 kein „Text kopieren" neben „Einladen" mehr', (await P.locator('button', { hasText: 'Text kopieren' }).count()) === 0);
  pruefe('D9 keine Obergrenze mehr zu wählen (fest 25 MB)', (await P.locator('.seg-obergrenze').count()) === 0);
  pruefe('D10 kein Erklärtext in der Synchronisation hat mehr als zwei Sätze', (await zuLang(P)).length === 0, JSON.stringify(await zuLang(P)));
  await P.locator('.modal').screenshot({ path: `${SD}/m300-d-sync.png` });
}

console.log('════ E: Dienste ════');
{
  await reiter(P, 'Dienste');
  await P.waitForTimeout(250);
  const g = await h3s(P);
  pruefe('E1 drei Abschnitte: KI-Assistent · Gehirn · Konten', g.length === 3 && /KI-Assistent/.test(g[0]) && /Gehirn/.test(g[1]) && /Konten/.test(g[2]), g.join(' | '));
  pruefe('E2 das Gehirn ist ein Häkchen, keine Auswahlliste', (await P.locator('.modal-row-check', { hasText: 'Gehirn einschalten' }).locator('input[type="checkbox"]').count()) === 1);
  const h4 = await P.locator('.modal-section h4').allTextContents();
  pruefe('E3 Konten: Google und Microsoft 365', h4.join(',') === 'Google,Microsoft 365', h4.join(','));
  pruefe('E4 Microsoft: OneNote im selben Formular („Auch OneNote lesen")', (await P.locator('.modal-row-check', { hasText: 'Auch OneNote lesen' }).count()) === 1);
  pruefe('E5 kein Erklärtext in den Diensten hat mehr als zwei Sätze', (await zuLang(P)).length === 0, JSON.stringify(await zuLang(P)));
  await P.locator('.modal').screenshot({ path: `${SD}/m300-e-dienste.png` });
}

console.log('════ F: Fuß und Logo-Menü ════');
{
  pruefe('F1 kein Fuß mit Version und Rechtlichem mehr im Fenster', (await P.locator('.modal .modal-foot').count()) === 0);
  await P.locator('.modal-x').click();
  await P.locator('button.logo').click();
  await P.waitForTimeout(400);
  // M312: Das Logo-Menü ist aufgelöst — das Logo öffnet die Hilfe, Einstellungen bleiben beim Zahnrad
  pruefe('F2 das Logo öffnet die Hilfe (kein Logo-Menü mehr)', (await P.locator('.help-modal').count()) === 1 && (await P.locator('.about-menu').count()) === 0);
  await P.keyboard.press('Escape');
}

console.log('════ G: Bild-Export aus dem Dock ════');
{
  await P.locator('.dock button[aria-label="Mehr"]').click().catch(async () => { await P.locator('.dock button[title="Mehr"]').click(); });
  await P.waitForTimeout(200);
  const eintrag = P.locator('.dock-menu-more button', { hasText: 'Als Bild exportieren' });
  pruefe('G1 Dock ⋯ hat „Als Bild exportieren …"', (await eintrag.count()) === 1);
  await eintrag.click();
  await P.waitForSelector('.bild-export');
  pruefe('G2 das Fenster bietet Format, Auflösung, Hintergrund, Kopfzeile, Auswahl', (await P.locator('.bild-export select').count()) === 3 && (await P.locator('.bild-export input[type="checkbox"]').count()) === 2);
  const dl = P.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await P.locator('.bild-export .modal-buttons button').click();
  const d = await dl;
  pruefe('G3 „Exportieren" liefert eine PNG-Datei', !!d && /\.png$/i.test(d.suggestedFilename()), d ? d.suggestedFilename() : 'kein Download');
  await P.waitForTimeout(300);
  pruefe('G4 … und das Fenster schließt sich', (await P.locator('.bild-export').count()) === 0);
}
await ctx.close();

console.log('════ H: Quelltext ════');
{
  const s = readFileSync(join(__repo, 'src/components/Settings.tsx'), 'utf8');
  pruefe('H1 alte Reiter-Namen (ki, kalender, export) werden umgeleitet', /ALT_REITER[^]*?ki: 'dienste'[^]*?kalender: 'dienste'[^]*?export: 'daten'/.test(s));
  pruefe('H2 keine Bild-Export-Optionen mehr in den Einstellungen', !/expFormat|exportBoard/.test(s));
  const css = readFileSync(join(__repo, 'src/index.css'), 'utf8');
  pruefe('H3 der Seg-Schalter hat jetzt eine Regel für den aktiven Zustand', /\.seg button\.on/.test(css));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
