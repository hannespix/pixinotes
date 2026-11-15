/**
 * M382 — Englische Hilfe, Vorlagen und Standardnamen.
 *
 *   A  Beide Fassungen der Hilfe sind deckungsgleich: dieselben Abschnitte, dieselben Einträge („(M…)") in
 *      derselben Reihenfolge, gleich viele Listenpunkte je Abschnitt.
 *   B  Englische Oberfläche: Hilfe und „Was ist neu" erscheinen englisch (Abschnitte, Navigation, Suche,
 *      Tastenkürzel, Fuß); kein deutscher Hinweis mehr.
 *   C  Deutsche Oberfläche: unverändert deutsch, die englische Fassung wird nicht geladen.
 *   D  Vorlagen legen auf Englisch englisch beschriftete Karten an; auf Deutsch deutsche.
 *   E  Standardnamen neuer Karten, Boards, Projekte; Suche in Palette und Strg+K findet englische Begriffe.
 *   F  Texte, Pakete.
 *
 * Läuft aus dem Repository: node pruefungen/m382-englische-hilfe.mjs   (PN_DIST=… für einen anderen Bau)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4694;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const abrufe = [];
const app = http.createServer((q, r) => {
  const pfad = decodeURIComponent(q.url.split('?')[0]);
  abrufe.push(pfad);
  let f = path.join(DIST, pfad);
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


const stand = () => ({
  boards: [{ id: 'b1', name: 'Nutzer-Board', nodes: [], edges: [], drawings: [], comments: [] }],
  spaces: [{ id: 's1', name: 'Nutzer-Bereich', projects: [{ id: 'p1', name: 'Nutzer-Projekt', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: opt.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: opt.locale ?? 'de-DE', ...(opt.telefon ? { hasTouch: true, isMobile: true } : {}) });
  await ctx.addInitScript(({ st, sprache, frisch, mensch }) => {
    if (mensch) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    if (sessionStorage.getItem('pn-test-bereit')) return;
    sessionStorage.setItem('pn-test-bereit', '1');
    if (!frisch) { localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st })); }
    if (sprache) localStorage.setItem('pixinotes-sprache', sprache);
  }, { st: stand(), sprache: opt.sprache ?? null, frisch: !!opt.frisch, mensch: !!opt.mensch });
  const P = await ctx.newPage();
  P.fehler = []; P.dialoge = [];
  P.on('pageerror', (e) => { P.fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  P.on('dialog', (d) => { P.dialoge.push(d.message()); d.accept().catch(() => {}); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1200);
  return { ctx, P };
}
const lang = (P) => P.evaluate(() => document.documentElement.lang);
const gespeichert = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const esc = async (P, n = 1) => { for (let i = 0; i < n; i++) { await P.keyboard.press('Escape'); await P.waitForTimeout(180); } };
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: beide Fassungen deckungsgleich ════');
const de = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf-8');
const en = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf-8');
const marken = (q) => [...q.matchAll(/\((M\d+(?:[/–-]M?\d+)?)\)/g)].map((m) => m[1]);
const neuDe = de.slice(de.indexOf('<section id="help-neu">'), de.indexOf('</section>', de.indexOf('<section id="help-neu">')));
const neuEn = en.slice(en.indexOf('<section id="help-neu">'), en.indexOf('</section>', en.indexOf('<section id="help-neu">')));
const ersteMarke = (q) => q.split('\n').filter((z) => /<li>/.test(z)).map((z) => /\((M\d+)/.exec(z)?.[1] ?? '?');
pruefe('A1 „Was ist neu": gleich viele Einträge in beiden Fassungen', ersteMarke(neuDe).length === ersteMarke(neuEn).length && ersteMarke(neuDe).length > 100, `${ersteMarke(neuDe).length} / ${ersteMarke(neuEn).length}`);
const abw = ersteMarke(neuDe).map((m, i) => [m, ersteMarke(neuEn)[i]]).filter(([a, b]) => a !== b);
pruefe('A2 … mit denselben Marken „(M…)" in derselben Reihenfolge', abw.length === 0, JSON.stringify(abw.slice(0, 5)));
pruefe('A3 der neueste Eintrag steht in beiden oben — derselbe (M382 oder neuer)', ersteMarke(neuDe)[0] === ersteMarke(neuEn)[0] && Number(String(ersteMarke(neuDe)[0]).slice(1)) >= 382, `${ersteMarke(neuDe)[0]} / ${ersteMarke(neuEn)[0]}`);
const abschnitte = (q) => [...q.matchAll(/<section id="(help-[a-z]+)">/g)].map((m) => m[1]);
pruefe('A4 dieselben Abschnitte mit denselben Ankern', JSON.stringify(abschnitte(de)) === JSON.stringify(abschnitte(en)) && abschnitte(en).length === 9, abschnitte(en).join(','));
const punkte = (q) => abschnitte(q).map((id) => { const a = q.indexOf(`<section id="${id}">`); return (q.slice(a, q.indexOf('</section>', a)).match(/<li>/g) ?? []).length; });
pruefe('A5 gleich viele Listenpunkte je Abschnitt', JSON.stringify(punkte(de)) === JSON.stringify(punkte(en)), `${punkte(de)} / ${punkte(en)}`);
const deutschReste = en.split('\n').filter((z) => /<li>|<p>/.test(z) && /\b(und|oder|nicht|eine|wird|werden|für|mit dem|auf dem)\b/.test(z.replace(/<code>.*?<\/code>/g, '').replace(/“[^”]*”/g, '')));
pruefe('A6 die englische Fassung enthält keine deutschen Sätze mehr', deutschReste.length === 0, deutschReste.slice(0, 3).map((z) => z.trim().slice(0, 120)).join(' ¦ '));
pruefe('A7 keine deutschen Anführungszeichen oder Tastennamen in der englischen Fassung', !/„/.test(en.replace(/\/\/.*$/gm, '')) && !/\b(Strg|Umschalt|Entf)\b/.test(en.replace(/\/\/.*$/gm, '')), (en.match(/„[^"”]{0,30}/g) ?? []).slice(0, 4).join(' ¦ '));

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Hilfe auf Englisch ════');
{
  abrufe.length = 0;
  const { ctx, P } = await seite({ sprache: 'en' });
  await P.locator('[data-taste="hilfe"]').click(); await P.waitForTimeout(900);
  const koepfe = await P.locator('.help-body h3').allTextContents();
  pruefe('B1 die Hilfe öffnet mit englischen Abschnitten', koepfe.some((k) => /Getting started/.test(k)) && koepfe.some((k) => /Keyboard shortcuts/.test(k)) && !koepfe.some((k) => /Erste Schritte|Tastenkürzel/.test(k)), koepfe.join(' | '));
  pruefe('B2 die englische Fassung wurde als eigenes Paket geladen', abrufe.some((a) => /HelpOverlayEn-[^/]+\.js$/.test(a)), abrufe.filter((a) => /Help/.test(a)).join(','));
  pruefe('B3 kein Hinweis „in German" mehr', (await P.locator('[data-taste="hilfe-en-hinweis"]').count()) === 0);
  const nav = await P.locator('.help-nav').textContent();
  pruefe('B4 die Navigation der Hilfe ist englisch', /Getting started/.test(nav) && /Cards & modules/.test(nav) && /Legal notice/.test(nav) && !/Erste Schritte|Impressum/.test(nav), nav.slice(0, 200));
  const text = await P.locator('.help-body').textContent();
  pruefe('B5 der Text ist englisch (keine deutschen Füllwörter im Fließtext)', !/ (und|oder|nicht|wird|für) /.test(text.replace(/Eisenbahnstraße[^.]*\./, '')) && /board/i.test(text), (text.match(/.{30} (und|oder|nicht|wird|für) .{30}/) ?? [''])[0]);
  const tasten = await P.locator('#help-tasten').evaluate((s) => ({ gruppen: [...s.querySelectorAll('h4')].map((h) => h.textContent), kbd: [...s.querySelectorAll('kbd')].map((k) => k.textContent), was: [...s.querySelectorAll('td:last-child')].slice(0, 6).map((t) => t.textContent) }));
  pruefe('B6 Tastenkürzel: Gruppen, Tastennamen und Beschreibungen englisch', tasten.gruppen.includes('Everywhere') && tasten.kbd.includes('Ctrl') && !tasten.kbd.includes('Strg') && !tasten.kbd.includes('Umschalt') && !tasten.was.some((w) => /rückgängig|Suche öffnen/.test(w)), JSON.stringify([tasten.gruppen, [...new Set(tasten.kbd)].slice(0, 12), tasten.was]));
  await P.locator('.help-search').fill('template'); await P.waitForTimeout(500);
  const treffer = await P.locator('.help-nav .help-count').allTextContents();
  pruefe('B7 die Suche findet englische Begriffe („template")', treffer.length >= 1 && treffer.some((t) => Number(t) > 0), treffer.join(','));
  await P.locator('.help-search').fill(''); await P.waitForTimeout(300);
  pruefe('B8 Impressum und Datenschutz tragen den Hinweis auf die maßgebliche deutsche Fassung', (await P.locator('.help-en-recht').count()) === 2 && /German version is the legally binding/.test(await P.locator('.help-en-recht').first().textContent()));
  const fuss = await P.locator('.help-body .help-foot').textContent();
  pruefe('B9 der Fuß ist englisch („local, open, yours" · „What’s new" · „Build")', /local, open, yours/.test(fuss) && /What’s new/.test(fuss) && /Build/.test(fuss) && !/Stand |willkommen/.test(fuss), fuss.slice(0, 160));
  await P.screenshot({ path: `${SD}/m382-b-hilfe.png` });
  await P.locator('.help-neu-link').click(); await P.waitForTimeout(500);
  const neu = await P.locator('.help-body.help-neu li').evaluateAll((ls) => ls.slice(0, 3).map((l) => l.textContent.slice(0, 90)));
  pruefe('B10 „What’s new" ist englisch, der neueste Eintrag zuerst', (() => { const nr = neu.map((t) => Number(/\(M(\d+)\)/.exec(t)?.[1] ?? 0)); return nr[0] >= 382 && nr[0] > nr[1] && nr[1] > nr[2] && neu.some((t) => /\(M382\)/.test(t) && /English/.test(t)); })() && (await P.locator('.help-body.help-neu li').count()) > 100, neu.join(' ¦ '));
  await P.screenshot({ path: `${SD}/m382-b-neu.png` });
  pruefe('B11 keine Skriptfehler', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 300));
  await ctx.close();
}

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Deutsch bleibt ════');
{
  abrufe.length = 0;
  const { ctx, P } = await seite();
  await P.locator('[data-taste="hilfe"]').click(); await P.waitForTimeout(900);
  const koepfe = await P.locator('.help-body h3').allTextContents();
  pruefe('C1 deutsche Oberfläche: die Hilfe ist deutsch', koepfe.some((k) => /Erste Schritte/.test(k)) && !koepfe.some((k) => /Getting started/.test(k)), koepfe.join(' | '));
  pruefe('C2 die englische Fassung wird nicht geladen', !abrufe.some((a) => /HelpOverlayEn/.test(a)) && !abrufe.some((a) => /\/en-[^/]+\.js$/.test(a)));
  await P.locator('.help-search').fill('vorlage'); await P.waitForTimeout(500);
  pruefe('C3 die Suche findet deutsche Begriffe', (await P.locator('.help-nav .help-count').count()) >= 1);
  pruefe('C4 keine Skriptfehler', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 300));
  await ctx.close();
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Vorlagen ════');
const vorlage = async (P, id) => { await P.locator('[data-taste="leer-vorlage"]').click(); await P.locator('[data-taste="vorlagen-dialog"]').waitFor({ timeout: 6000 }); await P.waitForTimeout(300); await P.locator(`[data-taste="vorlage"][data-vorlage="${id}"]`).click(); await P.waitForTimeout(1000); };
{
  const { ctx, P } = await seite({ sprache: 'en' });
  await P.locator('[data-taste="leer-vorlage"]').click(); await P.locator('[data-taste="vorlagen-dialog"]').waitFor({ timeout: 6000 }); await P.waitForTimeout(300);
  const namen = await P.locator('[data-taste="vorlage"] b').allTextContents();
  pruefe('D1 der Vorlagen-Dialog nennt die Vorlagen englisch', namen.some((n) => /Meeting/.test(n)) && namen.some((n) => /Retrospective/.test(n)) && namen.some((n) => /Project plan/.test(n)) && !namen.some((n) => /Besprechung|Rückblick/.test(n)), namen.join(' | '));
  await P.locator('[data-taste="vorlage"][data-vorlage="rueckblick"]').click(); await P.waitForTimeout(1000);
  const b = (await gespeichert(P)).boards[0];
  const rahmen = b.nodes.filter((n) => n.type === 'frame').map((n) => n.data.name);
  pruefe('D2 „Retrospective": Die Rahmen heißen englisch — als Inhalt gespeichert', JSON.stringify(rahmen) === JSON.stringify(['😀 Went well', '😕 Didn’t go well', '💡 Let’s try']), JSON.stringify(rahmen));
  const bub = b.nodes.find((n) => n.type === 'bubbles'); const kan = b.nodes.find((n) => n.type === 'kanban');
  pruefe('D3 … Frage der Bubbles und Titel des Kanban ebenfalls', bub.data.title === 'Actions' && /What do we commit to/.test(bub.data.frage) && kan.data.title === 'We’ll do this', JSON.stringify([bub.data.title, bub.data.frage, kan.data.title]));
  pruefe('D4 das Board heißt, weil es noch seinen eigenen Namen trug, weiter „Nutzer-Board"; die Meldung ist englisch', b.name === 'Nutzer-Board' && /Template “🔁 Retrospective” inserted|Retrospective/.test(await toast(P)) && !/eingesetzt/.test(await toast(P)), `${b.name} | ${await toast(P)}`);
  await P.screenshot({ path: `${SD}/m382-d-vorlage.png` });
  // neues Board aus Vorlage: Name englisch
  await P.locator('.tabs-foot .tab-add').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="neu-vorlage"]').click(); await P.locator('[data-taste="vorlagen-dialog"]').waitFor({ timeout: 6000 }); await P.waitForTimeout(300);
  await P.locator('[data-taste="vorlage"][data-vorlage="besprechung"]').click(); await P.waitForTimeout(1000);
  const st = await gespeichert(P); const neu = st.boards.find((x) => x.id !== 'b1');
  const notiz = JSON.stringify(neu.nodes.filter((n) => n.type === 'note').map((n) => n.data.blocks));
  pruefe('D5 neues Board aus „Meeting": englischer Board-Name, englische Überschriften, englische Tagesordnung', /Meeting/.test(neu.name) && /Goal of the meeting/.test(notiz) && /Attendees/.test(notiz) && neu.nodes.find((n) => n.type === 'minutes').data.agenda.includes('Decisions'), JSON.stringify([neu.name, neu.nodes.find((n) => n.type === 'minutes').data.agenda]));
  pruefe('D6 keine Skriptfehler', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 300));
  await ctx.close();
}
{
  const { ctx, P } = await seite();
  await vorlage(P, 'rueckblick');
  const b = (await gespeichert(P)).boards[0];
  pruefe('D7 deutsche Oberfläche: dieselbe Vorlage legt deutsche Karten an', JSON.stringify(b.nodes.filter((n) => n.type === 'frame').map((n) => n.data.name)) === JSON.stringify(['😀 Gut gelaufen', '😕 Hat gehakt', '💡 Probieren wir aus']) && b.nodes.find((n) => n.type === 'kanban').data.title === 'Das setzen wir um');
  await ctx.close();
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Standardnamen und Suche ════');
const palette = async (P) => { if (!(await P.locator('.modul-palette').count())) { await P.locator('.dock .dock-add-wrap').nth(0).locator('button').first().click(); await P.waitForTimeout(400); } };
{
  const { ctx, P } = await seite({ sprache: 'en' });
  for (const id of ['woche', 'zeit', 'tabelle', 'rahmen', 'protokoll', 'kanban']) {
    await palette(P);
    const k = P.locator(`.modul-kachel[data-modul="${id}"]`);
    if (await k.count()) { await k.click(); await P.waitForTimeout(500); } else console.log(`    (Kachel ${id} fehlt)`);
    await P.mouse.click(1400, 880); await P.waitForTimeout(200);
  }
  const d = (await gespeichert(P)).boards[0].nodes;
  const titel = Object.fromEntries(d.map((n) => [n.type, n.data.title ?? n.data.name]));
  console.log('    Titel:', JSON.stringify(titel));
  pruefe('E1 neue Karten tragen englische Standardnamen (Weekly plan, Time tracking, Spreadsheet, New frame, Minutes …)', titel.week === 'Weekly plan' && titel.time === 'Time tracking' && titel.sheet === 'Spreadsheet' && titel.frame === 'New frame' && !!titel.minutes && !/Besprechung/.test(titel.minutes) && !!titel.kanban && !/Neues/.test(titel.kanban), JSON.stringify(titel));
  await palette(P);
  await P.locator('.modul-palette input').fill('timeline'); await P.waitForTimeout(400);
  const kacheln = await P.locator('.modul-kachel').evaluateAll((ks) => ks.map((k) => k.dataset.modul));
  pruefe('E2 die Palette findet „timeline" (Zeitplan)', kacheln.length >= 1 && kacheln.length <= 3 && kacheln.some((k) => /gantt|zeitplan/.test(k)), kacheln.join(','));
  await esc(P, 2); await P.mouse.click(1400, 880);
  await P.keyboard.press('Control+k'); await P.waitForTimeout(400); await P.keyboard.type('template'); await P.waitForTimeout(500);
  const befehle = await P.locator('.search-cmd').allTextContents();
  pruefe('E3 Strg+K „template" bietet „Board from template" an', befehle.some((b) => /Board from template/.test(b)), befehle.join(' | '));
  await esc(P, 2);
  await P.locator('.tabs-foot .tab-add').click(); await P.waitForTimeout(300);
  await P.locator('.neu-menu [role="menuitem"]').nth(2).click(); await P.waitForTimeout(500);
  const st = await gespeichert(P);
  pruefe('E4 ein neues Projekt heißt „📁 Project"', st.spaces[0].projects.some((p) => /^📁 Project/.test(p.name)), JSON.stringify(st.spaces[0].projects.map((p) => p.name)));
  pruefe('E5 keine Skriptfehler', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 300));
  await ctx.close();
}
{
  const { ctx, P } = await seite();
  await palette(P);
  await P.locator('.modul-kachel[data-modul="woche"]').click().catch(() => {}); await P.waitForTimeout(500);
  const w = (await gespeichert(P)).boards[0].nodes.find((n) => n.type === 'week');
  pruefe('E6 deutsche Oberfläche: Standardnamen bleiben deutsch („Wochenplan")', w?.data.title === 'Wochenplan', String(w?.data.title));
  await ctx.close();
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Texte, Pakete ════');
pruefe('F1 „Was ist neu" nennt die englische Hilfe (M382) in beiden Fassungen, neueste zuerst', /\(M382\)/.test(de) && /\(M382\)/.test(en) && de.indexOf('(M382)') < de.indexOf('(M381)') && en.indexOf('(M382)') < en.indexOf('(M381)'));
const teile = readdirSync(path.join(DIST, 'assets'));
const haupt = /assets\/(index-[^"]+\.js)/.exec(readFileSync(path.join(DIST, 'index.html'), 'utf-8'))?.[1];
const hilfeDe = teile.find((t) => /^HelpOverlay-.*\.js$/.test(t));
pruefe('F2 die englische Hilfe ist ein eigenes Paket — weder im Start noch im deutschen Hilfe-Paket', teile.some((t) => /^HelpOverlayEn-.*\.js$/.test(t)) && !!haupt && !!hilfeDe && !/Getting started/.test(readFileSync(path.join(DIST, 'assets', haupt), 'utf-8')) && !/Getting started/.test(readFileSync(path.join(DIST, 'assets', hilfeDe), 'utf-8')), `${haupt} ${hilfeDe}`);

console.log(`\n  m382-englische-hilfe: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close(); app.close();
process.exit(bad ? 1 : 0);
