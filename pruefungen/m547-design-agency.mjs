/**
 * M547 — Design „Agency" (nach vave.log) in den Einstellungen (Violett, Grün-Grau, Readex Pro, weiche Rundungen, atmende Wortmarke).
 *
 *   A  Einstellungen → Darstellung → Design: drei Wahlen; „Agency" wirkt sofort (html[data-design], Grund #f8f9f6),
 *      steht in den Vorlieben, übersteht das Neuladen; Akzent-Tupfer weichen dem Satz „Violett (Agency)", die gewählte
 *      Akzentfarbe bleibt gemerkt; zurück auf Klassisch: Attribut weg, Akzent wieder da. pix·el bleibt wählbar.
 *   B  Schrift: Readex Pro aus dem eigenen Build, in Bedienung, Text und Titeln; in Klassisch und pix·el NICHT geladen;
 *      „Besser lesbar" gewinnt (Atkinson).
 *   C  Formen wie in vave.log: Tokens (Akzent #641dff, Tinte, Fläche), Karte flach mit 1-px-Kante ohne Schatten, unter
 *      der Maus violett umrissen; Kanban-Spalte 13 px auf #f0f2eb, Ticket 9 px; Umschalter als Segment (8/5 px, gewählt
 *      weiß mit violetter Schrift); Fenster 17 px mit Etikett „PIXINOTES" über dem Titel (500, −0,045 em); Felder 7 px;
 *      Kontextmenü mit weicher Wolke; Hinweis (Toast) warm-schwarz, 8 px; Fokusring 3 px #8951ff.
 *   D  Wortmarke (M550, Einzelheiten in m548-agency-logo.mjs): „pixi · notes“ fließt von selbst
 *      und steht bei „Besser lesbar“ still.
 *   E  Kontrast-Scan (werkzeug/kontrast-pruefen.mjs) hell und dunkel: Karten (Notiz mit allen Editor-Farben, Kanban,
 *      Protokoll, Tabelle) ruhend/ausgewählt/Fokus, Board, Einstellungen (dazu Ränder und Fokusringe ≥ 3:1), Hilfe,
 *      Suche, Kontextmenü — keine Schrift unter 4,5:1. Dunkel: eigener Grund.
 *   F  Klassisch unverändert (Markup der Wortmarke „Pixi<span>Notes</span>", Geist/Newsreader, kein data-design).
 *   G  Keine Seitenfehler.
 *
 * Bilder: M547_BILDER=<ordner> legt Bildschirmfotos ab (Board, Einstellungen, Menü; hell und dunkel; Wortmarke).
 * Klassisch und pix·el unverändert: `node werkzeug/bild-vergleich.mjs <dist-vorher> dist` (docs/meilensteine/M547-design-agency.md).
 */
// Läuft aus dem Repository: `node pruefungen/m547-design-agency.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { kontrastScan, randScan, fokusScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M547_BILDER ?? '';
if (BILDER) mkdirSync(BILDER, { recursive: true });
const PORT = 5547;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const meldung = (liste) => liste.slice(0, 4).map(trefferZeile).join(' | ');
const heute = new Date(); const iso = (n) => { const d = new Date(heute.getTime() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const absatz = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] });
const FARBEN = ['gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
const span = (text, styles = {}) => ({ type: 'text', text, styles });
const farbBloecke = () => [
  { type: 'paragraph', content: FARBEN.map((f) => span(`${f} `, { textColor: f })) },
  ...FARBEN.slice(0, 5).map((g) => ({ type: 'paragraph', content: [span(`${g}:`, { backgroundColor: g }), ...FARBEN.map((f) => span(` ${f.slice(0, 3)}`, { textColor: f, backgroundColor: g }))] })),
];
const KARTEN = [
  { id: 'n1', type: 'note', width: 340, height: 240, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 2 }, content: 'Quartal' }, absatz('Umsatz wächst weiter.'), { type: 'checkListItem', content: 'Angebot prüfen' }] } },
  { id: 'n2', type: 'note', width: 420, height: 300, data: { color: 'white', blocks: [{ type: 'heading', props: { level: 1 }, content: 'Farben' }, ...farbBloecke()] } },
  { id: 'k1', type: 'kanban', width: 440, height: 300, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }, { id: 'b', text: 'Maße nehmen', col: 1 }, { id: 'c', text: 'Rechnung', col: 2 }] } },
  { id: 'm1', type: 'minutes', width: 420, height: 440, data: { title: 'Jour fixe', entries: [{ id: 'x1', date: iso(0), attendees: 'Anna, Gerd', blocks: [{ id: 'q1', type: 'heading', props: { level: 3 }, content: 'TOP 1: Stand' }, { id: 'q2', type: 'paragraph', content: 'Alles im Plan.' }, { id: 'q3', type: 'checkListItem', props: { checked: false }, content: 'Gerd: Angebot einholen' }], decisions: [] }], current: 'x1' } },
  { id: 'r1', type: 'sheet', width: 460, height: 260, data: { title: 'Budget', cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '1200', A3: 'Strom', B3: '180', A4: 'Summe', B4: '=SUMME(B2:B3)' }, cols: 4, rows: 6 } },
];
const brett = (nodes) => ({ boards: [{ id: 'b0', name: 'Studio', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board', cardFocus: false, navLinks: false, clickZoom: false });
const ALLE = () => KARTEN.map((k, i) => ({ ...k, position: { x: 40 + (i % 3) * 500, y: 40 + Math.floor(i / 3) * 480 } }));

/** Neue Seite; `design` = 'agency' | 'pixel' | 'klassisch' | 'ohne' (Vorlieben ohne Design) */
async function seite(nodes, { dunkel = false, design = 'agency', lesbar = false, anfragen = null, ruhig = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light', reducedMotion: ruhig ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(([s, d, des, les]) => {
    if (localStorage.getItem('pixinotes-onboarded')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...(les ? { lesbareSchrift: true } : {}),
      ui: { theme: d ? 'dark' : 'light', accent: 'orange', ...(des === 'ohne' ? {} : { design: des }) } }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, [brett(nodes), dunkel, design, lesbar]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  if (anfragen) P.on('request', (q) => anfragen.push(q.url()));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const foto = async (P, name, sel) => { if (!BILDER) return; if (sel) await P.locator(sel).first().screenshot({ path: path.join(BILDER, `${name}.png`) }); else await P.screenshot({ path: path.join(BILDER, `${name}.png`) }); };
const warteBis = async (P, fn, ms = 10000) => { const ende = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > ende) return null; await P.waitForTimeout(150); } };
const attr = (P) => P.evaluate(() => document.documentElement.dataset.design ?? null);
const grund = (P) => P.evaluate(() => getComputedStyle(document.querySelector('.react-flow')).backgroundColor);
const vorlieben = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen') || '{}').ui ?? {});
const stil = (P, sel, prop, pseudo = null) => P.evaluate(([sel, prop, pseudo]) => { const e = document.querySelector(sel); return e ? getComputedStyle(e, pseudo)[prop] : null; }, [sel, prop, pseudo]);
const readex = (u) => /readex/i.test(u);
/** Die Buchstabenkonturen ändern sich in den gerenderten Lottie-Frames. */
const konturenSammeln = (P, ms) => P.evaluate((ms) => new Promise((fertig) => {
  const liste = []; const ab = performance.now();
  const iv = setInterval(() => {
    const form = document.querySelector('.agency-pixi svg');
    liste.push(!form?.getClientRects().length || getComputedStyle(form).visibility !== 'visible' ? ''
      : [...form.querySelectorAll('path[d]')].map((pfad) => pfad.getAttribute('d')).join('/'));
    if (performance.now() - ab > ms) { clearInterval(iv); fertig(liste); }
  }, 60);
}), ms);

console.log('════ A: Umschalten in den Einstellungen ════');
{
  const anfragen = [];
  const { ctx, P } = await seite(ALLE(), { design: 'ohne', anfragen });
  pruefe('A Vorlieben ohne Design = Klassisch (kein Attribut, kühler Grund)', (await attr(P)) === null && (await grund(P)) === 'rgb(243, 244, 246)', `${await attr(P)} ${await grund(P)}`);
  pruefe('B Klassisch lädt Readex Pro nicht', !anfragen.some(readex), anfragen.filter((u) => /woff/.test(u)).join(' '));
  await P.locator('[data-taste="einstellungen"]').first().click();
  await P.waitForSelector('[data-design-wahl="agency"]');
  const wahlen = await P.locator('[data-taste="design"] [data-design-wahl]').evaluateAll((l) => l.map((b) => `${b.dataset.designWahl}:${b.textContent}`));
  pruefe('A drei Wahlen: Klassisch · pix·el · Agency', wahlen.join(' ') === 'klassisch:Klassisch pixel:pix·el agency:Agency', wahlen);
  const tupfer = await P.locator('.accent-swatch').count();
  await P.locator('[data-design-wahl="agency"]').click();
  pruefe('A Agency wirkt sofort (Attribut, Grund #f8f9f6)', (await warteBis(P, async () => (await attr(P)) === 'agency' && (await grund(P)) === 'rgb(248, 249, 246)')) !== null, `${await attr(P)} ${await grund(P)}`);
  pruefe('A Knopf „Agency" ist gedrückt', (await P.locator('[data-design-wahl="agency"]').getAttribute('aria-pressed')) === 'true');
  pruefe('A Akzentfarbe: statt der Tupfer „Violett (Agency)"', tupfer === 5 && (await P.locator('.accent-swatch').count()) === 0 && (await P.locator('.akzent-agency').textContent()) === 'Violett (Agency)');
  const gespeichert = await warteBis(P, async () => { const v = await vorlieben(P); return v.design === 'agency' ? v : null; });
  pruefe('A Wahl steht in den Vorlieben, Akzent bleibt gemerkt', gespeichert?.design === 'agency' && gespeichert?.accent === 'orange', gespeichert);
  await P.keyboard.press('Escape');
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForSelector('.react-flow__node'); await P.waitForTimeout(1200);
  pruefe('A Agency übersteht das Neuladen', (await attr(P)) === 'agency' && (await grund(P)) === 'rgb(248, 249, 246)', `${await attr(P)} ${await grund(P)}`);
  pruefe('B Readex Pro kommt aus dem eigenen Build, keine fremde Anfrage',
    anfragen.some((u) => u.startsWith(`http://localhost:${PORT}/`) && readex(u)) && anfragen.every((u) => u.startsWith(`http://localhost:${PORT}/`) || u.startsWith('data:') || u.startsWith('blob:')),
    anfragen.filter((u) => !u.startsWith(`http://localhost:${PORT}/`)).slice(0, 3).join(' '));
  await P.locator('[data-taste="einstellungen"]').first().click();
  await P.locator('[data-design-wahl="pixel"]').click();
  pruefe('A pix·el bleibt wählbar (Attribut pixel, Papier)', (await warteBis(P, async () => (await attr(P)) === 'pixel' && (await grund(P)) === 'rgb(246, 247, 239)')) !== null);
  await P.locator('[data-design-wahl="klassisch"]').click();
  pruefe('A zurück auf Klassisch: Attribut weg, kühler Grund, Akzent Orange wieder da',
    (await warteBis(P, async () => (await attr(P)) === null && (await grund(P)) === 'rgb(243, 244, 246)')) !== null
      && (await P.evaluate(() => document.documentElement.dataset.accent)) === 'orange' && (await P.locator('.accent-swatch').count()) === 5);
  await ctx.close();
}

console.log('════ B/C: Schrift und Formen ════');
{
  const { ctx, P } = await seite(ALLE());
  const r = await P.evaluate(() => {
    const st = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e) : null; };
    const root = getComputedStyle(document.documentElement);
    return {
      akzent: root.getPropertyValue('--accent').trim(), body: getComputedStyle(document.body).fontFamily, tinte: getComputedStyle(document.body).color,
      titel: st('.react-flow__node[data-id="k1"] .kanban-title')?.fontFamily,
      ueberschrift: st('.react-flow__node[data-id="n1"] .bn-block-content[data-content-type="heading"]')?.fontFamily,
      ueberGewicht: st('.react-flow__node[data-id="n1"] .bn-block-content[data-content-type="heading"] > *')?.fontWeight,
      geladen: [...document.fonts].some((f) => /Readex/.test(f.family) && f.status === 'loaded'),
      radius: st('.react-flow__node[data-id="k1"]').borderRadius, schatten: st('.react-flow__node[data-id="k1"]').boxShadow,
      spalte: [st('.kanban-col').borderRadius, st('.kanban-col').backgroundColor], ticket: st('.kanban-item').borderRadius,
    };
  });
  pruefe('C Akzent #641dff trotz gespeicherter Akzentfarbe Orange, Tinte #1b1b1b', r.akzent === '#641dff' && r.tinte === 'rgb(27, 27, 27)', `${r.akzent} ${r.tinte}`);
  pruefe('B Readex Pro in Bedienung, Kartentitel und Notiz-Überschrift — geladen', /PN Readex/.test(r.body) && /PN Readex/.test(r.titel) && /PN Readex/.test(r.ueberschrift) && r.geladen, r);
  pruefe('B Überschrift in der Notiz Gewicht 500 wie die Titel in vave.log', r.ueberGewicht === '500', r.ueberGewicht);
  pruefe('C Karte rund (10 px), flach: nur die 1-px-Kante #e7e8e3, kein Schatten', r.radius === '10px' && /^rgb\(231, 232, 227\) 0px 0px 0px 1px$/.test(r.schatten), `${r.radius} | ${r.schatten}`);
  pruefe('C Kanban: Spalte 13 px auf #f0f2eb, Ticket 9 px', r.spalte[0] === '13px' && r.spalte[1] === 'rgb(240, 242, 235)' && r.ticket === '9px', r);
  const k1 = await P.locator('.react-flow__node[data-id="k1"] .kanban-title').boundingBox();
  await P.mouse.move(k1.x + 40, k1.y + 4);
  const hover = await warteBis(P, async () => { const s = await stil(P, '.react-flow__node[data-id="k1"]', 'boxShadow'); return /rgb\(207, 181, 255\)/.test(s) ? s : null; }, 4000);
  pruefe('C unter der Maus: Kante violett (#cfb5ff) wie die Projektkarten in vave.log', hover !== null, await stil(P, '.react-flow__node[data-id="k1"]', 'boxShadow'));
  await P.mouse.move(1400, 960);
  await foto(P, 'agency-hell-board');
  await foto(P, 'agency-wortmarke', '.logo');

  // Einstellungen: Fenster, Etikett, Titel, Umschalter, Felder
  await P.locator('[data-taste="einstellungen"]').first().click(); await P.waitForSelector('.modal-head h2'); await P.waitForTimeout(400);
  const m = await P.evaluate(() => {
    const st = (sel, ps) => { const e = document.querySelector(sel); return e ? getComputedStyle(e, ps) : null; };
    const h = st('.modal-head h2');
    return { fenster: st('.modal').borderRadius, gewicht: h.fontWeight, laufweite: h.letterSpacing, groesse: h.fontSize, etikett: st('.modal-head h2', '::before').content,
      etikettFarbe: st('.modal-head h2', '::before').color, seg: [st('.seg').borderRadius, st('.seg').backgroundColor], an: [st('.seg button.on').backgroundColor, st('.seg button.on').color, st('.seg button.on').borderRadius],
      feld: null,
      abdunkler: st('.modal-backdrop')?.backdropFilter };
  });
  pruefe('C Fenster 17 px rund, Abdunkler mit leichter Unschärfe', m.fenster === '17px' && /blur\(3px\)/.test(m.abdunkler ?? ''), m);
  pruefe('C Titel 500, eng (−0,045 em), darüber das violette Etikett „PIXINOTES"', m.gewicht === '500' && Math.abs(parseFloat(m.laufweite) + 0.045 * parseFloat(m.groesse)) < 0.05 && /PIXINOTES/.test(m.etikett) && m.etikettFarbe === 'rgb(84, 18, 227)', m);
  pruefe('C Umschalter als Segment: 8 px auf #eff1e9, gewählt weiß mit violetter Schrift, 5 px', m.seg[0] === '8px' && m.seg[1] === 'rgb(239, 241, 233)' && m.an[0] === 'rgb(255, 255, 255)' && m.an[1] === 'rgb(84, 18, 227)' && m.an[2] === '5px', m);
  // Felder: alle Reiter durchgehen, jedes Text-/Auswahlfeld zählt (auch in zugeklappten Abschnitten)
  const felder = [];
  for (const reiter of await P.locator('.modal-tabs button').all()) {
    await reiter.click(); await P.waitForTimeout(250);
    felder.push(...await P.evaluate(() => [...document.querySelectorAll('.modal :is(input[type=text], input[type=url], input[type=password], input[type=number], input:not([type]), select, textarea)')].map((e) => getComputedStyle(e).borderRadius)));
  }
  await P.locator('.modal-tabs button').first().click(); await P.waitForTimeout(250);
  pruefe(`C Felder 7 px rund (${felder.length} Felder in den Einstellungen)`, felder.length > 0 && felder.every((r) => r === '7px'), [...new Set(felder)]);
  await foto(P, 'agency-hell-einstellungen');
  // Fokusring per Tastatur
  await P.keyboard.press('Tab'); await P.keyboard.press('Tab');
  const fokus = await P.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`; });
  pruefe('C Fokusring 3 px #8951ff wie in vave.log', fokus === '3px solid rgb(137, 81, 255)', fokus);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);

  // Kontextmenü
  await P.mouse.click(1400, 940, { button: 'right' });
  const menue = await warteBis(P, async () => P.evaluate(() => { const e = document.querySelector('.kontext-menue'); if (!e) return null; const s = getComputedStyle(e); return { r: s.borderRadius, sch: s.boxShadow, rand: s.borderColor }; }), 5000);
  pruefe('C Kontextmenü rund (16 px) mit weicher Wolke wie die Menüs in vave.log', menue?.r === '16px' && /60px/.test(menue?.sch ?? ''), menue);
  await foto(P, 'agency-hell-menue');
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);

  // Hinweis (Toast): Doppelklick auf die leere Fläche legt eine Notiz an und meldet es
  await P.evaluate(() => { window.__toast = null; new MutationObserver(() => { const t = document.querySelector('.toast.show'); if (t && !window.__toast) { const s = getComputedStyle(t); window.__toast = { bg: s.backgroundColor, r: s.borderRadius, schrift: s.fontFamily }; } }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }); });
  await P.mouse.dblclick(1200, 900);
  const toast = await warteBis(P, () => P.evaluate(() => window.__toast), 6000);
  pruefe('C Hinweis warm-schwarz (#1b1b1b), 8 px rund, in Readex Pro', toast?.bg === 'rgb(27, 27, 27)' && toast?.r === '8px' && /PN Readex/.test(toast?.schrift ?? ''), toast);
  await ctx.close();
}
{
  const { ctx, P } = await seite(ALLE(), { lesbar: true });
  pruefe('B „Besser lesbar" gewinnt auch in Agency (Atkinson)', /Atkinson/.test(await stil(P, 'body', 'fontFamily')) && /Atkinson/.test(await stil(P, '.logo', 'fontFamily')));
  const text = P.locator('.agency-wortmarke-text');
  const g = await konturenSammeln(P, 550);
  pruefe('D „Besser lesbar": sichtbarer Schriftzug ohne Bewegung (M548)', await text.isVisible() && g.every((d) => d === ''));
  await ctx.close();
}

console.log('════ D: Marke ════');
{
  // M554 prüft die Bewegungsformen in Bildpunkten. M548 prüft die Pausen in der App.
  const { ctx, P } = await seite([{ ...KARTEN[2], position: { x: 300, y: 300 } }]);
  await P.waitForSelector('.agency-pixi[data-agency-frame] svg');
  const marke = await P.evaluate(() => {
    const l = document.querySelector('.logo');
    return {
      pixi: l.querySelector('.agency-wortmarke-text')?.textContent,
      notes: l.querySelector('.agency-notes')?.textContent,
      label: l.getAttribute('aria-label'),
      versteckt: l.querySelector('.agency-wortmarke')?.getAttribute('aria-hidden'),
    };
  });
  pruefe('D Wortmarke pixi · notes, Name für Vorleser bleibt',
    marke.pixi === 'pixi' && marke.notes === 'notes' && marke.label === 'PixiNotes – zur Übersicht' && marke.versteckt === 'true', marke);
  await P.waitForFunction(() => {
    const frame = Number(document.querySelector('.agency-pixi')?.dataset.agencyFrame);
    return frame > 3 && frame < 18;
  });
  const g = new Set(await konturenSammeln(P, 700));
  g.delete('');
  pruefe('D die Kontur von pixi verändert sich von selbst', g.size > 3, g.size);
  await ctx.close();
}

for (const dunkel of [false, true]) {
  const name = dunkel ? 'dunkel' : 'hell';
  console.log(`════ E: Kontrast-Scan Agency ${name} – Kartentypen ════`);
  for (const k of KARTEN) {
    const { ctx, P } = await seite([{ ...k, position: { x: 160, y: 120 } }], { dunkel });
    const node = P.locator(`.react-flow__node[data-id="${k.id}"]`);
    await P.waitForTimeout(k.type === 'note' ? 600 : 200);
    const ruhe = await kontrastScan(P);
    const box = await node.boundingBox();
    await P.mouse.click(box.x + Math.min(150, box.width / 2), box.y + 12); await P.waitForTimeout(600);
    const auswahl = await kontrastScan(P);
    await node.evaluate((el) => el.focus()); await P.keyboard.press('Enter'); await P.waitForTimeout(1300);
    const fokus = await kontrastScan(P);
    pruefe(`E ${name} ${k.type}/${k.id}: ruhend ${ruhe.length}, ausgewählt ${auswahl.length}, Fokus ${fokus.length} Stellen unter 4,5:1`,
      !ruhe.length && !auswahl.length && !fokus.length, meldung([...ruhe, ...auswahl, ...fokus]));
    await ctx.close();
  }

  console.log(`════ E: Fenster Agency ${name} ════`);
  const { ctx, P } = await seite(ALLE(), { dunkel });
  await P.waitForTimeout(800);
  if (dunkel) pruefe('E dunkel: Anthrazit (#282b25), Akzent hell genug', (await grund(P)) === 'rgb(40, 43, 37)' && (await P.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) === '#9a6bff', await grund(P));
  await foto(P, `agency-${name}-board`);
  const zu = async () => { await P.keyboard.press('Escape'); await P.waitForTimeout(350); await P.keyboard.press('Escape'); await P.waitForTimeout(300); };
  const fenster = async (titel, auf, sel = 'body', { rand = false } = {}) => {
    try { await auf(); await P.waitForTimeout(900); } catch (e) { pruefe(`E ${name} ${titel}: öffnet`, false, e.message.split('\n')[0]); return; }
    if (sel !== 'body' && !(await P.locator(sel).count())) { pruefe(`E ${name} ${titel}: öffnet`, false, `(${sel} fehlt)`); return; }
    const t = await kontrastScan(P, sel);
    pruefe(`E ${name} ${titel}: keine Schrift unter 4,5:1`, t.length === 0, meldung(t));
    if (rand) {
      const r = (await randScan(P, sel, { alle: true }));
      pruefe(`E ${name} ${titel}: ${r.length} Bedienelemente, Ränder ≥ 3:1`, r.length > 0 && !r.some((x) => x.v < 3), meldung(r.filter((x) => x.v < 3)));
      const f = await fokusScan(P, sel, { schritte: 18, alle: true });
      pruefe(`E ${name} ${titel}: ${f.length} Fokusringe ≥ 3:1`, f.length > 0 && !f.some((x) => x.v < 3), f.filter((x) => x.v < 3).slice(0, 4).map((x) => `${x.v} „${x.text}" ${x.pfad}`).join(' | '));
    }
    await foto(P, `agency-${name}-${titel.toLowerCase()}`);
    await zu();
  };
  await fenster('Board', async () => {});
  await fenster('Einstellungen', () => P.locator('[data-taste="einstellungen"]').first().click(), '.modal', { rand: true });
  await fenster('Hilfe', () => P.locator('[data-taste="hilfe"]').first().click(), '.help-modal');
  await fenster('Suche', async () => { await P.mouse.click(1400, 940); await P.keyboard.press('Control+k'); await P.waitForTimeout(300); await P.keyboard.type('Angebot'); }, '.search-box');
  await fenster('Kontextmenü', () => P.mouse.click(1400, 940, { button: 'right' }));
  await ctx.close();
}

console.log('════ F: Klassisch unverändert ════');
{
  const anfragen = [];
  const { ctx, P } = await seite(ALLE(), { design: 'klassisch', anfragen });
  const r = await P.evaluate(() => ({ html: document.querySelector('.logo').innerHTML, schrift: getComputedStyle(document.querySelector('.logo')).fontFamily, body: getComputedStyle(document.body).fontFamily, radius: getComputedStyle(document.querySelector('.react-flow__node')).borderRadius }));
  pruefe('F Klassisch: Wortmarke „Pixi<span>Notes</span>" in Newsreader, Text in Geist, Karten 4 px, kein data-design',
    r.html === 'Pixi<span>Notes</span>' && /Newsreader/.test(r.schrift) && /Geist/.test(r.body) && r.radius === '4px' && (await attr(P)) === null, r);
  pruefe('F Klassisch: kein Readex, kein Agency-Zeichen', !anfragen.some(readex) && (await P.locator('.agency-wortmarke').count()) === 0);
  await ctx.close();
}

console.log('════ G: Seitenfehler ════');
pruefe('G keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));

await browser.close(); app.close();
console.log(`\nM547: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
