/**
 * M495 — Protokollreihe Feinschliff.
 *
 *   A  Viele Sitzungen: 60 Sitzungen — die Leiste läuft nicht über (Karte und Telefon), „Ältere …" führt nach Monat
 *      gruppiert alle übrigen; Sprung zu einer älteren Sitzung; ←/→ blättert zwischen den Sitzungen.
 *   B  E-Mail bei Überlänge: die mailto-Adresse bleibt kurz (Betreff + Hinweis), der volle Text liegt in der
 *      Zwischenablage; eine kurze Sitzung geht wie bisher ganz in die Adresse.
 *   C  Als Datei: Markdown und HTML mit Teilnehmenden, TOPs, Beschlüssen und Aufgaben (Person, Frist).
 *   D  Druckansicht: eigenes Fenster mit sauberem Blatt (Teilnehmende, Tagesordnung, Beschlüsse, Aufgaben-Tabelle).
 *   E  Unbekannte Person („Mia: …" in einer Aufgabe, Mia nicht in der Runde) wird vorgeschlagen; „Hinweis:" nicht.
 *   F  @ im Protokolltext zeigt die Runde; Auswahl fügt @Name ein (die Übersicht ordnet zu); in „a@b" keine Liste.
 *   G  Übergabe: „+" schlägt offene Aufgaben und TOPs ohne Beschluss vor (abwählbar); der beschlossene TOP fehlt.
 *   H  Kontraste der neuen Teile hell/dunkel ≥ 4,5:1, Ränder ≥ 3:1; keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m495-protokoll-schliff.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';
import { kontrastScan, randScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = process.env.M495_BILDER ?? path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5495;
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
const TAG = 86_400_000;
const iso = (n) => { const d = new Date(Date.now() + n * TAG); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fehler = [];
const warteBis = async (P, fn, arg, ms = 15000) => P.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);

/** 60 Sitzungen, wöchentlich rückwärts; die neueste mit Text, TOPs, Beschluss und Aufgaben */
const vieleSitzungen = (n = 60) => Array.from({ length: n }, (_, i) => ({
  id: `s${i}`, date: iso(-7 * i), attendees: 'Anna Berg, Gerd Huber',
  title: i === 37 ? 'Klausurtagung' : undefined,
  blocks: i === 0
    ? [{ id: 'h1', type: 'heading', props: { level: 3 }, content: 'TOP 1: Haushalt' }, { id: 'p1', type: 'paragraph', content: 'Der Entwurf liegt vor.' }]
    : [{ id: `p${i}`, type: 'paragraph', content: `Sitzung Nummer ${i}.` }],
  decisions: [],
}));
/** Eine Sitzung, deren Text eine mailto-Adresse sprengt — mit TOPs, Beschlüssen und Aufgaben mit Person und Frist */
const langeSitzung = () => ({
  id: 'l1', date: iso(-1), title: 'Jahresplanung', attendees: 'Anna Berg, Gerd Huber, Petra Lang',
  blocks: [
    { id: 'h1', type: 'heading', props: { level: 3 }, content: 'TOP 1: Haushalt' },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, type: 'paragraph', content: `Absatz ${i}: Die Ausgaben für das Vorhaben Nummer ${i} wurden ausführlich besprochen und abgewogen.` })),
    { id: 'h2', type: 'heading', props: { level: 3 }, content: 'TOP 2: Personal' },
    { id: 'a1', type: 'checkListItem', props: { checked: false }, content: 'Gerd: Zahlen an das Referat schicken bis 04.12.' },
    { id: 'a2', type: 'checkListItem', props: { checked: true }, content: 'Raumbuchung klären @Anna' },
    { id: 'z1', type: 'paragraph', content: 'SCHLUSSSATZ-MARKE' },
  ],
  decisions: [{ id: 'd1', text: 'Der Haushaltsentwurf geht in die Abstimmung.' }],
});

async function seite({ dunkel = false, breite = 1440, hoehe = 900, mobil = false, nodes } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1, colorScheme: dunkel ? 'dark' : 'light', isMobile: mobil, hasTouch: mobil, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` });
  await ctx.addInitScript(([nodes]) => {
    // mailto-Adressen mitschreiben statt das Mailprogramm zu öffnen
    window.__mails = [];
    const offen = window.open.bind(window);
    window.open = (u, ...r) => { if (String(u).startsWith('mailto:')) { window.__mails.push(String(u)); return null; } return offen(u, ...r); };
    if (sessionStorage.getItem('m495-geladen')) return;
    sessionStorage.setItem('m495-geladen', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    const state = { boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes }], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board' };
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state }));
  }, [nodes]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.minutes-card', { timeout: 30000 });
  await P.waitForTimeout(800);
  return { ctx, P };
}
const karte = (id, d, x = 40, y = 40, w = 460, h = 620) => ({ id, type: 'minutes', position: { x, y }, width: w, height: h, data: d });
const gespeichert = async (P, id) => P.evaluate((id) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === id), id);
const warteGespeichert = async (P, id, fn, ms = 15000) => P.waitForFunction(([id, fs]) => {
  const n = JSON.parse(localStorage.getItem('pixinotes-board') || '{}')?.state?.boards?.[0]?.nodes?.find((x) => x.id === id);
  // eslint-disable-next-line no-new-func
  return n && new Function('n', `return (${fs})(n)`)(n);
}, [id, fn.toString()], { timeout: ms, polling: 150 }).then(() => true, () => false);
const waehle = async (P, id) => {
  await P.locator(`.react-flow__node[data-id="${id}"] .card-grip`).click({ force: true });
  await P.waitForTimeout(300);
};
const textAus = (bs) => (bs ?? []).map((b) => [typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => c.text ?? '').join(''), textAus(b.children)].join('|')).join('/');
const menue = async (P, M, text) => {
  await P.locator(`${M} .pr-mehr`).click();
  await P.locator(`${M} .pr-menue button`, { hasText: text }).click();
};

// ───────────────────────────── A: viele Sitzungen ─────────────────────────────
console.log('════ A: 60 Sitzungen ════');
{
  const { ctx, P } = await seite({ nodes: [karte('m', { title: 'Jour fixe', color: 'white', entries: vieleSitzungen(), current: 's0' })] });
  const M = '.react-flow__node[data-id="m"]';
  await waehle(P, 'm');
  const mass = async () => P.evaluate((M) => {
    const l = document.querySelector(`${M} .pr-leiste`); const z = document.querySelector(`${M} .pr-leiste-zeile`);
    const k = document.querySelector(`${M} .card-body`).getBoundingClientRect(); const zr = z.getBoundingClientRect();
    const r = document.querySelector(`${M} .pr-rahmen`);
    return { tags: l.querySelectorAll('.pr-tag').length, ueberLeiste: l.scrollWidth - l.clientWidth, zeileRaus: zr.right > k.right + 1 || zr.left < k.left - 1, ueberRahmen: r.scrollWidth - r.clientWidth,
      optionen: document.querySelectorAll(`${M} .pr-aeltere option[value]:not([value=""])`).length, gruppen: [...document.querySelectorAll(`${M} .pr-aeltere optgroup`)].map((g) => g.label) };
  }, M);
  const a = await mass();
  pruefe('A1 Leiste ohne Überlauf: höchstens 8 Sitzungen sichtbar, nichts rollt, nichts ragt aus der Karte', a.tags >= 2 && a.tags <= 8 && a.ueberLeiste <= 1 && !a.zeileRaus && a.ueberRahmen <= 1, JSON.stringify(a));
  pruefe('A2 „Ältere …" führt alle übrigen Sitzungen, nach Monat gruppiert', a.tags + a.optionen === 60 && a.gruppen.length >= 12 && /\d{4}/.test(a.gruppen[0]), JSON.stringify({ t: a.tags, o: a.optionen, g: a.gruppen.slice(0, 3) }));
  // Sprung zu einer älteren Sitzung (Nr. 37, mit Titel)
  await P.locator(`${M} .pr-aeltere`).selectOption('s37');
  const sprung = await warteGespeichert(P, 'm', (n) => n.data.current === 's37');
  const nachSprung = await P.evaluate((M) => ({
    sel: document.querySelector(`${M} .pr-tag[aria-selected="true"]`)?.textContent, titel: document.querySelector(`${M} .pr-sitzung-titel`)?.value,
    text: document.querySelector(`${M} .minutes-body`)?.textContent, wert: document.querySelector(`${M} .pr-aeltere`)?.value,
  }), M);
  pruefe('A3 Auswahl öffnet die ältere Sitzung (in der Leiste markiert, ihr Text steht da)', sprung && nachSprung.titel === 'Klausurtagung' && /Sitzung Nummer 37/.test(nachSprung.text) && !!nachSprung.sel && nachSprung.wert === '', JSON.stringify(nachSprung));
  // Tastatur: ←/→ zwischen den Sitzungen
  await P.locator(`${M} .pr-tag[aria-selected="true"]`).focus();
  await P.keyboard.press('ArrowRight');
  const rechts = await warteGespeichert(P, 'm', (n) => n.data.current === 's38');
  const fokus = await P.evaluate((M) => document.activeElement?.matches(`${M} .pr-tag[aria-selected="true"]`), M);
  await P.keyboard.press('ArrowLeft');
  await P.keyboard.press('ArrowLeft');
  const links = await warteGespeichert(P, 'm', (n) => n.data.current === 's36');
  pruefe('A4 → älter, ← neuer; der Fokus bleibt auf der gezeigten Sitzung', rechts && links && fokus, JSON.stringify({ rechts, links, fokus }));
  const nachTaste = await mass();
  pruefe('A5 nach dem Blättern weiter ohne Überlauf', nachTaste.ueberLeiste <= 1 && !nachTaste.zeileRaus, JSON.stringify(nachTaste));
  await P.mouse.click(1300, 850);
  await P.waitForTimeout(400);
  await P.locator(M).screenshot({ path: `${SD}/m495-a-viele.png` });
  await ctx.close();
}
for (const dunkel of [false, true]) {
  const { ctx, P } = await seite({ dunkel, breite: 390, hoehe: 800, mobil: true, nodes: [karte('m', { title: 'Jour fixe Referat 21 mit langem Namen', color: 'white', entries: vieleSitzungen(), current: 's0' })] });
  const M = '.react-flow__node[data-id="m"]';
  await P.locator(`${M} .minutes-title`).tap({ force: true });
  await P.waitForTimeout(1500);
  const t = await P.evaluate((M) => {
    const k = document.querySelector(`${M} .card-body`).getBoundingClientRect();
    const raus = [...document.querySelectorAll(`${M} .pr-rahmen *`)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > k.right + 1 || r.left < k.left - 1); }).map((el) => el.className || el.tagName);
    const l = document.querySelector(`${M} .pr-leiste`);
    return { raus: raus.slice(0, 5), ueber: l.scrollWidth - l.clientWidth, tags: l.querySelectorAll('.pr-tag').length, aeltere: !!document.querySelector(`${M} .pr-aeltere`), fokus: !!document.querySelector('.app.focus-mode') };
  }, M);
  pruefe(`A6 Telefon ${dunkel ? 'dunkel' : 'hell'}: 60 Sitzungen ohne Überlauf, „Ältere …" erreichbar`, t.fokus && t.raus.length === 0 && t.ueber <= 1 && t.tags >= 1 && t.aeltere, JSON.stringify(t));
  await P.screenshot({ path: `${SD}/m495-a-telefon-${dunkel ? 'dunkel' : 'hell'}.png` });
  await ctx.close();
}

// ─────────────────────── B–D: E-Mail, Datei, Druckansicht ───────────────────────
console.log('════ B–D: Versenden, Speichern, Drucken ════');
{
  const kurz = { id: 'k1', date: iso(-3), attendees: 'Anna Berg', blocks: [{ id: 'q1', type: 'paragraph', content: 'Kurz und knapp.' }], decisions: [] };
  const { ctx, P } = await seite({ nodes: [karte('m', { title: 'Jour fixe', color: 'white', entries: [langeSitzung(), kurz], current: 'l1' })] });
  const M = '.react-flow__node[data-id="m"]';
  await waehle(P, 'm');

  // B — E-Mail bei Überlänge
  await menue(P, M, 'Per E-Mail');
  await warteBis(P, () => window.__mails.length > 0);
  const mail = await P.evaluate(() => window.__mails[0] ?? '');
  const zwischen = await P.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  const body = decodeURIComponent((/[?&]body=([^&]*)/.exec(mail) ?? [])[1] ?? '');
  const betreff = decodeURIComponent((/[?&]subject=([^&]*)/.exec(mail) ?? [])[1] ?? '');
  pruefe('B1 lange Sitzung: die mailto-Adresse bleibt kurz (< 1 800 Zeichen), mit Betreff und Hinweis auf die Zwischenablage', mail.length > 0 && mail.length < 1800 && /Jour fixe/.test(betreff) && /Zwischenablage/.test(body), `${mail.length} ${betreff} | ${body}`);
  pruefe('B2 … und der volle Text liegt in der Zwischenablage (bis zum Schluss, mit Beschluss und Aufgaben)', zwischen.length > 2000 && /SCHLUSSSATZ-MARKE/.test(zwischen) && /Haushaltsentwurf/.test(zwischen) && /Zahlen an das Referat/.test(zwischen), `${zwischen.length}`);
  await P.locator(`${M} .pr-tag`).nth(1).click();
  await warteGespeichert(P, 'm', (n) => n.data.current === 'k1');
  await menue(P, M, 'Per E-Mail');
  await warteBis(P, () => window.__mails.length > 1);
  const mail2 = await P.evaluate(() => window.__mails[1] ?? '');
  pruefe('B3 kurze Sitzung: der Text steht wie bisher ganz in der Mail', /Kurz%20und%20knapp/.test(mail2) && !/Zwischenablage/.test(decodeURIComponent(mail2)), mail2.slice(0, 200));
  await P.locator(`${M} .pr-tag`).nth(0).click();
  await warteGespeichert(P, 'm', (n) => n.data.current === 'l1');

  // C — als Datei
  const holen = async (text) => {
    const [dl] = await Promise.all([P.waitForEvent('download', { timeout: 15000 }), menue(P, M, text)]);
    const f = await dl.path();
    return { name: dl.suggestedFilename(), inhalt: readFileSync(f, 'utf8') };
  };
  const md = await holen('Markdown');
  pruefe('C1 Markdown: Dateiname, Kopf, Teilnehmende, TOPs, Beschlüsse und Aufgaben-Tabelle mit Person und Frist', /^Jour-fixe-\d{4}-\d{2}-\d{2}\.md$/.test(md.name)
    && /^# Jour fixe – Jahresplanung/.test(md.inhalt) && /\*\*Teilnehmende:\*\* Anna Berg, Gerd Huber, Petra Lang/.test(md.inhalt) && /## TOP 1: Haushalt/.test(md.inhalt)
    && /## Beschlüsse\n\n1\. Der Haushaltsentwurf/.test(md.inhalt) && /\| Zahlen an das Referat schicken bis 04\.12\. \| Gerd \| 04\.12\.\d{4} \| offen \|/.test(md.inhalt)
    && /\| Raumbuchung klären \| Anna \| {2}\| erledigt \|/.test(md.inhalt), `${md.name}\n${md.inhalt.slice(-500)}`);
  const html = await holen('Webseite');
  pruefe('C2 HTML: eigenständige Seite mit Tagesordnung, Beschlüssen und Aufgaben-Tabelle', /\.html$/.test(html.name) && /^<!doctype html>/.test(html.inhalt) && /<ol class="tops"><li>TOP 1: Haushalt<\/li><li>TOP 2: Personal<\/li><\/ol>/.test(html.inhalt)
    && /<td>Zahlen an das Referat schicken bis 04\.12\.<\/td><td>Gerd<\/td>/.test(html.inhalt) && !/<script/i.test(html.inhalt), html.name);

  // D — Druckansicht
  const [druck] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), menue(P, M, 'Drucken')]);
  await druck.waitForLoadState('domcontentloaded').catch(() => {});
  await warteBis(druck, () => document.querySelectorAll('table td').length > 0, undefined, 10000);
  const blatt = await druck.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent, reihe: document.querySelector('.reihe')?.textContent, meta: document.querySelector('.meta')?.textContent,
    h2: [...document.querySelectorAll('h2')].map((h) => h.textContent), zeilen: [...document.querySelectorAll('tbody tr')].map((r) => [...r.cells].map((c) => c.textContent)),
    beschluss: document.querySelector('ol.beschluesse li')?.textContent, hg: getComputedStyle(document.body).backgroundColor, farbe: getComputedStyle(document.body).color,
  }));
  pruefe('D1 Druckansicht: eigenes Blatt mit Reihe, Sitzung, Teilnehmenden', blatt.reihe === 'Jour fixe' && /Jahresplanung/.test(blatt.h1) && /Anna Berg, Gerd Huber, Petra Lang/.test(blatt.meta), JSON.stringify(blatt));
  pruefe('D2 … mit Tagesordnung, Beschlüssen und Aufgaben (Person, Frist, Stand)', ['Tagesordnung', 'Protokoll', 'Beschlüsse', 'Aufgaben'].every((h) => blatt.h2.includes(h))
    && /Haushaltsentwurf/.test(blatt.beschluss) && blatt.zeilen.some((z) => z[1] === 'Gerd' && /04\.12\./.test(z[2]) && z[3] === 'offen'), JSON.stringify(blatt.zeilen));
  pruefe('D3 … ruhig: dunkle Schrift auf Weiß', blatt.hg === 'rgb(255, 255, 255)' && /rgb\((2\d|1\d|\d),/.test(blatt.farbe), `${blatt.hg} ${blatt.farbe}`);
  await druck.screenshot({ path: `${SD}/m495-d-druck.png`, fullPage: true });
  await druck.close();
  await ctx.close();
}

// ─────────────────────── E–G: Personen, @, Übergabe ───────────────────────
console.log('════ E–G: Personen, @-Liste, Übergabe ════');
for (const dunkel of [false, true]) {
  const name = dunkel ? 'dunkel' : 'hell';
  const reihe = () => ({
    title: 'Lenkungskreis', color: 'white', carryOpen: true, agenda: ['Bericht'], entries: [
      { id: 'n1', date: iso(-2), attendees: 'Anna Berg, Gerd Huber', blocks: [
        { id: 'b0', type: 'heading', props: { level: 3 }, content: 'Bericht' },
        { id: 'b1', type: 'heading', props: { level: 3 }, content: 'TOP 1: Haushalt' },
        { id: 'b2', type: 'paragraph', content: 'Der Entwurf liegt vor.' },
        { id: 'b3', type: 'heading', props: { level: 3 }, content: 'TOP 2: Sommerfest planen' },
        { id: 'b4', type: 'paragraph', content: 'Noch offen, wer die Getränke übernimmt.' },
        { id: 'b5', type: 'checkListItem', props: { checked: false }, content: 'Mia: Raum buchen bis Freitag' },
        { id: 'b6', type: 'checkListItem', props: { checked: false }, content: 'Hinweis: Protokoll rechtzeitig verteilen' },
        { id: 'b7', type: 'checkListItem', props: { checked: true }, content: 'Gerd: Einladung verschicken' },
        { id: 'b8', type: 'paragraph', content: '' },
      ], decisions: [{ id: 'd1', text: 'Der Haushaltsentwurf wird angenommen.' }] },
      { id: 'n0', date: iso(-9), attendees: 'Anna Berg', blocks: [{ id: 'c1', type: 'paragraph', content: 'Erste Runde.' }], decisions: [] },
    ],
  });
  const { ctx, P } = await seite({ dunkel, nodes: [karte('m', reihe(), 40, 40, 520, 680)] });
  const M = '.react-flow__node[data-id="m"]';
  await waehle(P, 'm');

  // E — unbekannte Person
  const vorschlaege = await P.locator(`${M} .pr-vorschlag-text`).allTextContents();
  pruefe(`E1 ${name}: „Mia" wird zur Runde vorgeschlagen, „Hinweis" nicht`, vorschlaege.length === 1 && vorschlaege[0] === 'Mia zur Runde hinzufügen?', JSON.stringify(vorschlaege));
  if (!dunkel) {
    await P.locator(M).screenshot({ path: `${SD}/m495-e-vorschlag-hell.png` });
    await P.locator(`${M} [data-taste="pr-person-ja"]`).click();
    const dazu = await warteGespeichert(P, 'm', (n) => n.data.entries.find((e) => e.id === 'n1').attendees === 'Anna Berg, Gerd Huber, Mia');
    const weg = await warteBis(P, (M) => !document.querySelector(`${M} .pr-vorschlag`), M);
    await P.locator(`${M} [data-taste="pr-uebersicht"]`).click();
    const mia = await warteBis(P, (M) => [...document.querySelectorAll(`${M} .pr-gruppe-name`)].some((g) => g.textContent === 'Mia'), M);
    pruefe('E2 „Hinzufügen" nimmt Mia in die Runde; die Übersicht ordnet ihre Aufgabe zu', dazu && weg && mia, JSON.stringify({ dazu, weg, mia }));
    await P.locator(`${M} [data-taste="pr-sitzung"]`).click();
  } else {
    await P.locator(`${M} .pr-vorschlag-nein`).click();
    pruefe('E3 dunkel: „Nicht zur Runde" blendet den Vorschlag aus, die Runde bleibt', await warteBis(P, (M) => !document.querySelector(`${M} .pr-vorschlag`), M)
      && (await gespeichert(P, 'm')).data.entries.find((e) => e.id === 'n1').attendees === 'Anna Berg, Gerd Huber');
  }

  // F — @-Liste
  if (!dunkel) {
    const absatz = P.locator(`${M} .minutes-body [contenteditable="true"] .bn-block-content`).last();
    await absatz.click();
    await P.keyboard.press('End');
    await P.keyboard.type('mail an a@b');
    await P.waitForTimeout(500);
    const beiMail = await P.locator('.pr-at-liste').count();
    await P.keyboard.press('Enter');
    await P.keyboard.type('Termin abstimmen @');
    const liste = await warteBis(P, () => document.querySelectorAll('.pr-at-liste .pr-at-name').length === 3);
    const namen = await P.locator('.pr-at-liste .pr-at-name').allTextContents();
    await P.locator(M).screenshot({ path: `${SD}/m495-f-at-hell.png` });
    await P.keyboard.type('ge');
    const gefiltert = await warteBis(P, () => [...document.querySelectorAll('.pr-at-liste .pr-at-name')].map((x) => x.textContent).join('|') === 'Gerd Huber');
    await P.keyboard.press('Enter');
    await P.keyboard.type('bis Montag');
    pruefe('F1 in „a@b" öffnet keine Liste', beiMail === 0, String(beiMail));
    pruefe('F2 „@" am Wortanfang zeigt die Runde, Tippen filtert', liste && gefiltert && namen.join('|') === 'Anna Berg|Gerd Huber|Mia', JSON.stringify(namen));
    const eingefuegt = await warteGespeichert(P, 'm', (n) => /Termin abstimmen @Gerd bis Montag/.test(JSON.stringify(n.data.entries.find((e) => e.id === 'n1').blocks)));
    const zeile = textAus((await gespeichert(P, 'm')).data.entries.find((e) => e.id === 'n1').blocks);
    pruefe('F3 Enter fügt „@Gerd " ein (Vorname reicht, er ist eindeutig); in „a@b" blieb der Text unverändert', eingefuegt && /mail an a@b/.test(zeile), zeile.slice(-160));
    await P.locator(`${M} [data-taste="pr-aufgabe"]`).click();
    await P.locator(`${M} [data-taste="pr-uebersicht"]`).click();
    const gerd = await warteBis(P, (M) => [...document.querySelectorAll(`${M} .pr-gruppe`)].some((g) => g.querySelector('.pr-gruppe-name')?.textContent === 'Gerd' && /Termin abstimmen/.test(g.textContent)), M);
    pruefe('F4 als Aufgabe markiert steht sie in der Übersicht bei Gerd', gerd);
    await P.locator(`${M} [data-taste="pr-sitzung"]`).click();
  }

  // G — Übergabe
  await P.locator(`${M} [data-taste="pr-neu"]`).click();
  await P.waitForSelector(`${M} .pr-uebergabe`, { timeout: 10000 });
  const punkte = await P.locator(`${M} .pr-uebergabe-punkt`).evaluateAll((ls) => ls.map((l) => ({ art: l.querySelector('.pr-art').textContent, text: l.querySelector('.pr-uebergabe-text').textContent, an: l.querySelector('input').checked })));
  const tops = punkte.filter((p) => /TOP/.test(p.art)).map((p) => p.text);
  pruefe(`G1 ${name}: „+" schlägt offene Aufgaben und den TOP ohne Beschluss vor, alles angehakt — nicht den beschlossenen TOP, nicht die feste Tagesordnung, nichts Erledigtes`,
    tops.length === 1 && tops[0] === 'TOP 2: Sommerfest planen' && punkte.some((p) => /Mia: Raum buchen/.test(p.text)) && punkte.every((p) => p.an) && !punkte.some((p) => /Einladung|Haushalt|^Bericht$/.test(p.text)), JSON.stringify(punkte));
  await H(P, M, name);
  if (!dunkel) await P.locator(M).screenshot({ path: `${SD}/m495-g-uebergabe-hell.png` });
  else await P.locator(M).screenshot({ path: `${SD}/m495-g-uebergabe-dunkel.png` });
  // Aufgabe „Mia" abwählen, den Rest übernehmen
  await P.locator(`${M} .pr-uebergabe-punkt`, { hasText: 'Mia: Raum buchen' }).locator('input').uncheck();
  const toasts = [];
  await P.exposeFunction(`__toast${name}`, (t) => toasts.push(t)).catch(() => {});
  await P.evaluate((fn) => { new MutationObserver(() => { for (const el of document.querySelectorAll('.toast, [role="status"]')) window[fn]?.(el.textContent); }).observe(document.body, { childList: true, subtree: true, characterData: true }); }, `__toast${name}`);
  await P.locator(`${M} [data-taste="pr-anlegen"]`).click();
  const neu = await warteGespeichert(P, 'm', (n) => n.data.entries.length === 3);
  const d = (await gespeichert(P, 'm')).data;
  const sitzung = d.entries.find((e) => !['n0', 'n1'].includes(e.id));
  const t = textAus(sitzung?.blocks);
  pruefe(`G2 ${name}: neue Sitzung mit dem TOP „(offen seit …)", ohne die abgewählte Aufgabe, mit der Runde und der festen Tagesordnung`,
    neu && d.current === sitzung?.id && /TOP 2: Sommerfest planen \(offen seit \d\d\.\d\d\.\d\d\)/.test(t) && !/Raum buchen/.test(t) && /Bericht/.test(t) && !/Haushalt/.test(t)
      && sitzung.blocks.some((b) => b.type === 'heading' && /Sommerfest/.test(textAus([b]))), t);
  await warteBis(P, (fn) => true, undefined, 500);
  await P.waitForTimeout(300);
  pruefe(`G3 ${name}: die Meldung nennt den übernommenen TOP`, toasts.some((x) => /offener TOP/.test(x)), JSON.stringify(toasts.slice(-3)));
  await ctx.close();
}

/** H — Kontraste der neuen Teile (Übergabe offen, Vorschlag, Leiste mit „Ältere …") */
async function H(P, M, name) {
  const schlecht = await kontrastScan(P, M);
  pruefe(`H1 ${name}: alle Texte der Karte ≥ 4,5:1 (Übergabe offen)`, schlecht.length === 0, schlecht.slice(0, 6).map(trefferZeile).join('\n'));
  const raender = (await randScan(P, M)).filter((x) => !/pr-datum|pr-sitzung-titel|minutes-title|pr-person-neu|minutes-decision-add|pr-beschluss-text/.test(`${x.klasse ?? ''} ${x.pfad ?? ''}`));
  pruefe(`H2 ${name}: Ränder der neuen Bedienelemente ≥ 3:1`, raender.length === 0, raender.slice(0, 6).map((x) => `${x.v} ${x.pfad}`).join('\n'));
}
console.log('════ H: Leiste mit „Ältere …" im Dunkeln ════');
for (const dunkel of [false, true]) {
  const { ctx, P } = await seite({ dunkel, nodes: [karte('m', { title: 'Jour fixe', color: 'white', entries: vieleSitzungen(), current: 's0' }), karte('g', { title: 'Gelb', color: 'yellow', entries: vieleSitzungen(), current: 's0' }, 560, 40)] });
  for (const id of ['m', 'g']) {
    await waehle(P, id);
    const s = await kontrastScan(P, `.react-flow__node[data-id="${id}"] .pr-leiste-zeile`);
    const r = await randScan(P, `.react-flow__node[data-id="${id}"] .pr-leiste-zeile`);
    pruefe(`H3 ${dunkel ? 'dunkel' : 'hell'}/${id}: Leiste und „Ältere …" lesbar (Schrift ≥ 4,5:1, Rand ≥ 3:1)`, s.length === 0 && r.length === 0, [...s, ...r].slice(0, 4).map(trefferZeile).join('\n'));
  }
  await P.mouse.click(1300, 850);
  await P.waitForTimeout(300);
  await P.screenshot({ path: `${SD}/m495-h-leiste-${dunkel ? 'dunkel' : 'hell'}.png` });
  await ctx.close();
}

pruefe('Z keine Seitenfehler', fehler.length === 0, JSON.stringify(fehler.slice(0, 3)));
await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
