/**
 * M459 — Start-Leistung Teil 2: Fristen-, Rufnummern-Erkennung und Konto-/Team-Abgleich bei Bedarf.
 *
 *   A  Start: Ein Board ohne Termin und Rufnummer lädt weder chrono-node (Fristen) noch libphonenumber-js
 *      (Rufnummern) noch kontoSync/gastSync (Abgleich) noch den Freigabe-Dialog. Start-JS unter der neuen Grenze.
 *   B  Fristen und Rufnummern kommen nach: Notiz mit „bis Freitag" und Rufnummer, E-Mail mit Datum und
 *      Rufnummer — Fristen-Chips, Telefon-Chip und tel:-Link erscheinen kurz nach dem Start; die Notiz bekommt
 *      ihren Fristen-Anker (M390) wie vorher.
 *   C  Mit Konto: der Abgleich lädt sofort beim Start.
 *   D  Anmeldung später (Einstellungen, anderes Fenster): der Abgleich lädt in dem Augenblick.
 *   E  Einladungslink ohne Konto (#e=…): der Abgleich lädt, das gemeinsame Board öffnet sich direkt.
 *   F  Die Aufgaben-Zentrale liest Fristen wie vorher (sie wartet auf die Erkennung).
 */
// Läuft aus dem Repository: `node pruefungen/m459-start-leistung-2.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = path.join(__repo, 'dist');
const PORT = 5459;
/** Grenze knapp über dem gemessenen Stand (M467: 2 168 523 B = 2,07 MiB; M459: 2 192 986 B; M446: 2 441 218 B) */
// M462: BlockNote 0.57 (Tiptap 3, Mantine 8) — Start 2 220 718 B (+50 KB, Emoji-Auswahl schon nachgeladen; siehe docs/meilensteine/M462-blocknote.md)
// M483: Start 2 097 102 B (vorher 2 238 181 B) — Grenze GESENKT auf neuer Stand + gut 20 KB, damit das Polster nicht gleich wieder verbraucht ist (docs/meilensteine/M483-start-leicht.md)
const START_JS_GRENZE = 2_120_000;

let anfragen = [];
const gastAufrufe = [];
const BOARD_GAST = { id: 'gb1', name: 'Gemeinsam', edges: [], drawings: [], comments: [], nodes: [
  { id: 'gn1', type: 'note', width: 220, position: { x: 0, y: 0 }, data: { color: 'blue', blocks: [{ id: 'k1', type: 'paragraph', content: 'Planung gemeinsam' }] } },
] };
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  // Nachgebauter Server: nur das, was ein Gast per Link beim Beitreten braucht
  if (pfad.startsWith('/sb/')) {
    let body = '';
    q.on('data', (c) => { body += c; });
    q.on('end', () => {
      gastAufrufe.push(pfad);
      if (pfad === '/sb/rest/v1/rpc/gast_lesen') {
        r.writeHead(200, { 'Content-Type': 'application/json' });
        r.end(JSON.stringify({ board_id: 'gb1', rolle: 'bearbeiten', besitzer: 'anna', inhalt: JSON.stringify(BOARD_GAST), version: 1 }));
        return;
      }
      if (pfad === '/sb/rest/v1/rpc/gast_stand') { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ version: 1 })); return; }
      r.writeHead(404); r.end();
    });
    return;
  }
  anfragen.push(pfad);
  let f = join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const note = (id, text, x = 0, y = 0) => ({ id, type: 'note', width: 260, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
const stand = (nodes) => ({
  boards: [{ id: 'b1', name: 'Skizze', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false,
});
async function seite(nodes, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // Kein Weg nach draußen: Google/Microsoft/Supabase-Adressen beantwortet niemand (die App muss damit leben)
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`), (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript(([st, extra]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
  }, [stand(nodes), opt.speicher ?? {}]);
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  P.on('dialog', (d) => d.accept());
  anfragen = [];
  await P.goto(`http://localhost:${PORT}/${opt.hash ?? ''}`);
  await P.waitForSelector('.react-flow', { state: 'visible' });
  await P.waitForSelector('.react-flow__node', { state: 'visible' });
  return { ctx, P, fehler };
}
const jsAssets = () => [...new Set(anfragen)].filter((p) => p.startsWith('/assets/') && p.endsWith('.js')).map((p) => p.split('/').pop());
const groesse = (dateien) => dateien.reduce((a, f) => a + statSync(join(DIST, 'assets', f)).size, 0);
const inhalt = (f) => readFileSync(join(DIST, 'assets', f), 'utf8');
/** chrono-node erkennt man am deutschen Monatsnamen „jänner" (kommt sonst nirgends vor) */
const istChrono = (f) => /jänner/.test(inhalt(f));
const art = (geladen) => ({
  chrono: geladen.some(istChrono),
  rufnummer: geladen.some((f) => /^rufnummer-/.test(f)),
  konto: geladen.some((f) => /^kontoSync-/.test(f)),
  gast: geladen.some((f) => /^gastSync-/.test(f)),
  freigabe: geladen.some((f) => /^FreigabeDialog-/.test(f)),
});
const SUPABASE = JSON.stringify({ url: `http://localhost:${PORT}/sb`, key: 'anon-test' });

// ══ A: Start ═══════════════════════════════════════════════════════
console.log('\n════ A: Start ohne Termin, Rufnummer, Konto ════');
{
  const { ctx, P, fehler } = await seite([note('n1', 'Hallo Welt')]);
  await P.waitForLoadState('networkidle');
  await P.waitForTimeout(400);
  const geladen = jsAssets();
  const summe = groesse(geladen);
  const a = art(geladen);
  console.log(`  Start-JS ${(summe / 1024 / 1024).toFixed(2)} MB (${summe} B) in ${geladen.length} Dateien: ${geladen.join(', ')}`);
  pruefe(`A1 Start-JS unter ${(START_JS_GRENZE / 1024 / 1024).toFixed(2)} MB (ist ${(summe / 1024 / 1024).toFixed(2)} MB; vorher 2,35 MB)`, summe < START_JS_GRENZE && summe > 1_000_000, String(summe));
  pruefe('A2 keine Fristen-Erkennung (chrono-node) im Start', !a.chrono);
  pruefe('A3 keine Rufnummern-Erkennung (libphonenumber-js) im Start', !a.rufnummer);
  pruefe('A4 kein Konto-/Team-Abgleich (kontoSync, gastSync) und kein Freigabe-Dialog im Start', !a.konto && !a.gast && !a.freigabe, JSON.stringify(a));
  pruefe('A5 die Notiz zeigt ihren Text, ohne Chips', /Hallo Welt/.test(await P.locator('.react-flow__node[data-id="n1"]').textContent()) && (await P.locator('.react-flow__node[data-id="n1"] .due-chip').count()) === 0);
  pruefe('A6 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ B: Fristen und Rufnummern kommen nach ═══════════════════════════
console.log('\n════ B: Fristen und Rufnummern bei Bedarf ════');
{
  const mail = { id: 'm1', type: 'email', width: 360, position: { x: 320, y: 0 }, data: { subject: 'Rückruf', fromName: 'Amt', text: 'Bitte bis 24.12. zurückrufen: Tel. 0761 208 1356', attachments: [] } };
  const { ctx, P, fehler } = await seite([note('n1', 'Bericht bis Freitag, Rückfragen an 0761 2081356'), mail]);
  await P.waitForFunction(() => document.querySelectorAll('.react-flow__node[data-id="n1"] .due-chip:not(.ent-chip)').length > 0, null, { timeout: 10000 }).catch(() => {});
  await P.waitForFunction(() => !!document.querySelector('.react-flow__node[data-id="m1"] a.ent-tel[href^="tel:"]'), null, { timeout: 10000 }).catch(() => {});
  const r = await P.evaluate(() => {
    const n = document.querySelector('.react-flow__node[data-id="n1"]');
    const m = document.querySelector('.react-flow__node[data-id="m1"]');
    return {
      frist: n?.querySelectorAll('.due-chip:not(.ent-chip)').length ?? 0,
      fristText: n?.querySelector('.due-chip:not(.ent-chip)')?.textContent ?? '',
      telChip: n?.querySelector('.ent-chip-tel')?.getAttribute('href') ?? '',
      mailTel: m?.querySelector('a.ent-tel')?.getAttribute('href') ?? '',
      mailText: m?.textContent ?? '',
      mailFrist: m?.querySelectorAll('.due-chip').length ?? 0,
    };
  });
  pruefe('B1 Fristen-Chip „bis Freitag" erscheint an der Notiz', r.frist >= 1 && /\w/.test(r.fristText), JSON.stringify(r));
  pruefe('B2 Telefon-Chip an der Notiz (tel:+49…)', /^tel:\+49761/.test(r.telChip), r.telChip);
  pruefe('B3 die E-Mail verlinkt die Rufnummer (tel:) und zeigt ihre Frist', /^tel:\+49761/.test(r.mailTel) && r.mailFrist >= 1 && /zurückrufen/.test(r.mailText), JSON.stringify(r));
  const a = art(jsAssets());
  pruefe('B4 dafür kamen genau Fristen- und Rufnummern-Erkennung — kein Abgleich', a.chrono && a.rufnummer && !a.konto && !a.gast, JSON.stringify(a));
  // M390: Der Fristen-Anker wird wie vorher nachgetragen (nach dem Laden der Erkennung)
  await P.waitForFunction(() => {
    const st = JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state;
    return !!st?.boards?.[0]?.nodes?.find((x) => x.id === 'n1')?.data?.fristAnker;
  }, null, { timeout: 8000 }).catch(() => {});
  const anker = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards?.[0]?.nodes?.find((x) => x.id === 'n1')?.data?.fristAnker ?? null);
  pruefe('B5 die Notiz trägt ihren Fristen-Anker („bis Freitag" bleibt dieser Freitag)', !!anker?.n1b && anker.n1b[1].includes('bis Freitag'), JSON.stringify(anker));
  // Neu getippt: eine Frist in einer neuen Notiz erscheint sofort (die Erkennung ist jetzt da)
  await P.screenshot({ path: path.join(SD, 'm459-chips.png') });
  pruefe('B6 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ C: Mit Konto ═══════════════════════════════════════════════════
console.log('\n════ C: Mit Konto lädt der Abgleich sofort ════');
{
  const konto = JSON.stringify({ anbieter: 'supabase', clientId: 'anon-test', url: `http://localhost:${PORT}/sb`, token: 'x.eyJzdWIiOiJ1MSJ9.y', tokenExp: Date.now() + 3600_000, refreshToken: 'r', userId: 'u1', name: 'anna@example.org' });
  const { ctx, P, fehler } = await seite([note('n1', 'Hallo Welt')], { speicher: { 'pixinotes-konto-sync': konto, 'pixinotes-supabase': SUPABASE } });
  await P.waitForLoadState('networkidle');
  await P.waitForTimeout(400);
  const a = art(jsAssets());
  pruefe('C1 Konto angemeldet → kontoSync und gastSync laden beim Start', a.konto && a.gast, JSON.stringify(a));
  pruefe('C2 der Abgleich fragt den Server (Freigaben/Einladungen des Kontos)', gastAufrufe.some((p) => /board_einladungen|board_freigaben|umgebung|storage|rpc/.test(p)), gastAufrufe.slice(-5).join(', '));
  pruefe('C3 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ D: Später angemeldet ═══════════════════════════════════════════
console.log('\n════ D: Anmeldung nach dem Start ════');
{
  const { ctx, P, fehler } = await seite([note('n1', 'Hallo Welt')]);
  await P.waitForLoadState('networkidle');
  pruefe('D1 ohne Konto: kein Abgleich geladen', !art(jsAssets()).konto);
  // So meldet sich ein anderes Fenster an (storage-Ereignis) — hier nachgestellt: Sitzung schreiben, Bescheid geben
  await P.evaluate((k) => { localStorage.setItem('pixinotes-konto-sync', k); window.dispatchEvent(new CustomEvent('pixinotes:konto')); },
    JSON.stringify({ anbieter: 'google', clientId: 'cid', token: 't', tokenExp: Date.now() + 3600_000, name: 'anna@example.org' }));
  await P.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /kontoSync-/.test(e.name)), null, { timeout: 8000 }).catch(() => {});
  await P.waitForTimeout(300);
  pruefe('D2 nach der Anmeldung lädt der Abgleich sofort', art(jsAssets()).konto && art(jsAssets()).gast);
  pruefe('D3 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ E: Einladungslink ohne Konto ═══════════════════════════════════
console.log('\n════ E: Einladungslink (#e=…) ohne Konto ════');
{
  gastAufrufe.length = 0;
  const { ctx, P, fehler } = await seite([note('n1', 'Hallo Welt')], { hash: '#e=AbCdEfGhIjKlMnOpQrStUv', speicher: { 'pixinotes-supabase': SUPABASE } });
  await P.waitForFunction(() => /Planung gemeinsam/.test(document.querySelector('.react-flow')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  const txt = await P.evaluate(() => document.querySelector('.react-flow')?.textContent ?? '');
  pruefe('E1 der Link führt direkt ins gemeinsame Board (ohne Anmeldung)', /Planung gemeinsam/.test(txt), txt.slice(0, 80));
  pruefe('E2 dafür wurde der Gast-Zugang beim Server gelesen (gast_lesen)', gastAufrufe.includes('/sb/rest/v1/rpc/gast_lesen'), gastAufrufe.join(', '));
  const gast = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-gast') ?? '{}'));
  pruefe('E3 der Gast-Zugang ist gemerkt (läuft beim nächsten Start weiter)', !!gast.gb1, JSON.stringify(gast));
  pruefe('E4 der Abgleich ist geladen', art(jsAssets()).gast);
  pruefe('E5 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  // Neu laden: als Gast dabei → der Abgleich lädt sofort beim Start
  anfragen = [];
  await P.reload();
  await P.waitForSelector('.react-flow__node', { state: 'visible' });
  await P.waitForLoadState('networkidle');
  pruefe('E6 nach dem Neuladen: als Gast dabei → Abgleich startet mit', art(jsAssets()).gast);
  await ctx.close();
}

// ══ F: Aufgaben lesen Fristen wie vorher ═══════════════════════════
console.log('\n════ F: Aufgaben-Zentrale ════');
{
  const { ctx, P, fehler } = await seite([
    { id: 'c1', type: 'note', width: 260, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ id: 'cb', type: 'checkListItem', props: { checked: false }, content: 'Angebot schicken bis morgen' }] } },
  ]);
  await P.waitForTimeout(300);
  await P.keyboard.press('Control+k');
  await P.waitForSelector('.search-box', { state: 'visible' });
  await P.keyboard.type('Aufgaben');
  await P.waitForTimeout(250);
  await P.locator('.search-cmds .search-cmd', { hasText: 'Aufgaben' }).first().click();
  await P.waitForTimeout(1200);
  const hub = await P.evaluate(() => document.body.innerText);
  pruefe('F1 die Aufgabe steht in der Aufgaben-Zentrale mit Frist „morgen"', /Angebot schicken/.test(hub) && /morgen/i.test(hub), hub.slice(0, 200));
  pruefe('F2 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
