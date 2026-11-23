/**
 * M442 — Google einfacher verknüpfen: E-Mail-Adresse statt technischer Felder.
 *
 * Gemeldet: „Kann man den Google-Account einfacher verknüpfen, einfach mit E-Mail-Adresse? Momentan ist es zu
 * kompliziert."
 *
 *   A  Ist die Google-Anmeldung eingerichtet, sieht man unter Dienste → Konten nur „Google-Konto" (E-Mail, optional) und
 *      „Mit Google verbinden" — keine Client-ID. Die E-Mail geht als Vorauswahl an Google (login_hint).
 *   B  Ist sie (noch) nicht eingerichtet, steht ein klarer Satz da; die technische Einrichtung liegt eingeklappt unter
 *      „Für Betreiber".
 *   C  Die Anmeldung fürs Konto (Daten → Abgleich) nimmt die eingetippte E-Mail ebenfalls als Vorauswahl.
 */
// Läuft aus dem Repository: `node pruefungen/m442-google-einfach.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5442;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
/** Seite öffnen; `cid`: gespeicherte Client-ID (wie vom Betreiber eingerichtet); Google-Dienst wird nachgebildet */
const seite = async (cid) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(([c]) => {
    if (!localStorage.getItem('pixinotes-board')) {
      localStorage.setItem('pixinotes-onboarded', '1');
      localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'A', edges: [], drawings: [], nodes: [] }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board' } }));
      if (c) localStorage.setItem('pixinotes-cal-accounts', JSON.stringify({ google: { clientId: c } }));
      // ein Konto-Backend wie auf der gehosteten App (dort kommt es aus dem Build) — nur, damit das E-Mail-Feld erscheint
      localStorage.setItem('pixinotes-supabase', JSON.stringify({ url: 'https://beispiel.supabase.co', key: 'anon' }));
    }
    // Google-Anmeldedienst nachbilden: merkt sich, womit er gerufen wurde, und bricht dann ab
    window.__gis = [];
    window.google = { accounts: { oauth2: { initTokenClient: (cfg) => ({ requestAccessToken: () => { window.__gis.push({ client_id: cfg.client_id, scope: cfg.scope, login_hint: cfg.login_hint ?? null }); cfg.callback({ error: 'access_denied' }); } }) } } };
  }, [cid]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1200);
  await P.locator('[data-taste="einstellungen"]').click(); await P.waitForTimeout(300);
  return { ctx, P };
};
const reiter = async (P, name) => { await P.locator('.modal .tabs button, .modal [role="tablist"] button, .modal-tabs button', { hasText: name }).first().click(); await P.waitForTimeout(300); };

console.log('A  Eingerichtet');
{
  const { ctx, P } = await seite('123-abc.apps.googleusercontent.com');
  await reiter(P, 'Dienste');
  const sicht = await P.evaluate(() => {
    const sichtbar = (el) => !!el && el.offsetParent !== null && !el.closest('details:not([open])');
    const felder = [...document.querySelectorAll('.modal input')].filter(sichtbar).map((i) => i.placeholder);
    return { mail: sichtbar(document.querySelector('[data-taste="google-mail"]')), knopf: sichtbar(document.querySelector('[data-taste="google-verbinden"]')), clientFeld: felder.some((p) => /googleusercontent/.test(p)) };
  });
  pruefe('A1 nur E-Mail und „Mit Google verbinden" – kein Feld für eine Client-ID', sicht.mail && sicht.knopf && !sicht.clientFeld, sicht);
  await P.locator('[data-taste="google-mail"]').fill('anna@gmail.com');
  await P.locator('[data-taste="google-verbinden"]').click(); await P.waitForTimeout(500);
  const rufe = await P.evaluate(() => window.__gis);
  pruefe('A2 die E-Mail geht als Vorauswahl an Google (login_hint), mit der Client-ID des Betreibers', rufe.length === 1 && rufe[0].login_hint === 'anna@gmail.com' && rufe[0].client_id === '123-abc.apps.googleusercontent.com' && /calendar/.test(rufe[0].scope), rufe);
  await P.locator('[data-taste="google-mail"]').fill('');
  await P.locator('[data-taste="google-verbinden"]').click(); await P.waitForTimeout(500);
  const zwei = await P.evaluate(() => window.__gis[1]);
  pruefe('A3 ohne E-Mail geht es auch (Google zeigt dann die Konto-Auswahl)', !!zwei && zwei.login_hint === null, zwei);
  await ctx.close();
}

console.log('B  Nicht eingerichtet');
{
  const { ctx, P } = await seite(null);
  await reiter(P, 'Dienste');
  const sicht = await P.evaluate(() => {
    const d = document.querySelector('[data-taste="google-betreiber"]');
    return { hinweis: document.querySelector('[data-taste="google-nicht-eingerichtet"]')?.textContent ?? '', zu: !!d && !d.open, knopf: !!document.querySelector('[data-taste="google-verbinden"]') };
  });
  pruefe('B1 ein klarer Satz statt Technik; kein Verbinden-Knopf ohne Einrichtung', /noch nicht eingerichtet/.test(sicht.hinweis) && !sicht.knopf, sicht);
  pruefe('B2 die technische Einrichtung liegt eingeklappt unter „Für Betreiber"', sicht.zu, sicht);
  await ctx.close();
}

console.log('C  Konto-Anmeldung');
{
  const { ctx, P } = await seite('123-abc.apps.googleusercontent.com');
  await reiter(P, 'Daten');
  const konto = P.locator('.sync-weg button, .seg button', { hasText: 'Konto' }).first();
  if (await konto.count()) { await konto.click(); await P.waitForTimeout(300); }
  const mail = P.locator('[data-taste="konto-email"]');
  if (await mail.count()) await mail.fill('ben@gmail.com');
  const knopf = P.locator('[data-taste="konto-google"]');
  const da = await knopf.count();
  if (da) { await knopf.click(); await P.waitForTimeout(600); }
  const rufe = await P.evaluate(() => window.__gis);
  pruefe('C1 „Mit Google anmelden" nimmt die eingetippte E-Mail als Vorauswahl', da > 0 && rufe.length >= 1 && rufe[rufe.length - 1].login_hint === 'ben@gmail.com' && /drive/.test(rufe[rufe.length - 1].scope), { da, rufe });
  await ctx.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readdirSync(path.join(__repo, 'docs/meilensteine')).join(' ');
  pruefe('D1 Hilfe und Meilenstein-Notiz nennen M442', /M442/.test(hilfe) && /M442/.test(umbau));
}
await browser.close(); app.close();
console.log(`\nM442: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
