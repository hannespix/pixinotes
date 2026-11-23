/**
 * M489 — Protokollreihe neu gedacht.
 *
 *   A  Kontrast: jede Schrift der Karte ≥ 4,5:1 zu ihrem tatsächlichen Hintergrund (berechnete Farben, durch alle
 *      halbdurchsichtigen Flächen hindurch) — hell und dunkel, auf weißem Papier, auf Gelb und auf einer dunklen
 *      eigenen Farbe; auch der Protokolltext (BlockNote) und die Übersicht.
 *   B  Neue Sitzung übernimmt Teilnehmende und offene Aufgaben der letzten (mit „offen seit").
 *   C  Zeile am Cursor als Aufgabe und als Beschluss markieren — gespeichert als Checklisten-Punkt bzw. Beschluss;
 *      die Übersicht zeigt die Aufgabe bei ihrer Person mit Frist und den Beschluss; Abhaken in der Übersicht wirkt.
 *   D  Ein altes Protokoll (Stand vor M489, Blöcke ohne Kennung, ohne `current`, mit unbekannten Feldern) zeigt
 *      alles und verliert beim Laden und Bearbeiten nichts.
 *   E  Nach dem Neuladen steht alles noch da.
 *   F  Telefonbreite: im Fokus nichts breiter als die Karte, Werkzeuge erreichbar.
 *   G  Kachel nennt die offenen Aufgaben; Suche über alle Sitzungen; keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m489-protokoll-neu.mjs`
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

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5489;
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

const sitzungen = () => [
  { id: 's3', date: iso(-1), attendees: 'Anna Berg, Gerd Huber, Petra Lang', blocks: [
    { id: 'b1', type: 'heading', props: { level: 3 }, content: 'TOP 1: Haushalt' },
    { id: 'b2', type: 'paragraph', content: 'Der Entwurf liegt vor.' },
    { id: 'b3', type: 'checkListItem', props: { checked: false }, content: 'Gerd: Zahlen an das Referat schicken bis Freitag' },
    { id: 'b4', type: 'checkListItem', props: { checked: true }, content: 'Petra: Vorlage verteilen' },
    { id: 'b5', type: 'checkListItem', props: { checked: false }, content: 'Raumbuchung klären @Anna' },
    { id: 'b6', type: 'paragraph', content: 'Zwei Stellen sind ausgeschrieben.' } ],
    decisions: [{ id: 'd1', text: 'Der Haushaltsentwurf geht in die Abstimmung.' }] },
  { id: 's2', date: iso(-8), attendees: 'Anna Berg, Gerd Huber', blocks: [{ id: 'c1', type: 'paragraph', content: 'Raumplanung besprochen.' }],
    decisions: [{ id: 'd0', text: 'Die Runde tagt künftig dienstags.' }] },
];
/** Stand vor M489: Blöcke ohne Kennung, kein `current`, Felder, die die Karte nicht kennt */
const altesProtokoll = () => ({
  title: 'Altes Protokoll', color: 'mint', agenda: ['Bericht', 'Verschiedenes'], rhythm: 'monat', carryOpen: true, fremdFeld: 'bleibt',
  entries: [
    { id: 'x2', date: '2025-03-04', title: 'Sondersitzung', attendees: 'Ute; Max', blocks: [
      { type: 'heading', props: { level: 3 }, content: 'Bericht' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Fett ', styles: { bold: true } }, { type: 'text', text: 'und normal', styles: {} }] },
      { type: 'checkListItem', props: { checked: false }, content: 'Max: Angebot einholen (offen seit 01.02.25)' },
      { type: 'bulletListItem', content: 'Punkt eins', children: [{ type: 'bulletListItem', content: 'Unterpunkt' }] } ],
      decisions: [{ id: 'y1', text: 'Angebot wird eingeholt.' }], extraEntry: 42 },
    { id: 'x1', date: '2025-02-01', attendees: 'Ute', blocks: [{ type: 'paragraph', content: 'Erste Runde.' }], decisions: [] },
  ],
});

async function seite({ dunkel = false, breite = 1440, hoehe = 900, mobil = false, nodes } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1, colorScheme: dunkel ? 'dark' : 'light', isMobile: mobil, hasTouch: mobil });
  await ctx.addInitScript(([nodes]) => {
    if (sessionStorage.getItem('m489-geladen')) return;   // Neuladen: den gespeicherten Stand behalten
    sessionStorage.setItem('m489-geladen', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    const state = { boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes }], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board' };
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state }));
  }, [nodes]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const karte = (id, d, x = 40, y = 40, w = 460, h = 620, extra = {}) => ({ id, type: 'minutes', position: { x, y }, width: w, height: h, data: d, ...extra });
const knoten = async (P, id) => { await P.waitForTimeout(1400); return P.evaluate((id) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === id), id); };
const waehle = async (P, id) => {
  await P.locator(`.react-flow__node[data-id="${id}"] .card-grip`).click({ force: true });
  await P.waitForTimeout(400);
};
const textAus = (bs) => (bs ?? []).map((b) => [typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => c.text ?? '').join(''), textAus(b.children)].join('|')).join('/');

/** Alle Texte der Karte: Schrift- und tatsächliche Hintergrundfarbe (durch halbdurchsichtige Flächen gemischt) */
async function kontraste(P, sel) {
  return P.evaluate((sel) => {
    const rgba = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return [0, 0, 0, 0]; const t = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [t[0], t[1], t[2], t.length > 3 ? t[3] : 1]; };
    const lum = ([r, g, b]) => { const k = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b); };
    const grund = (el) => {
      const schichten = [];
      for (let e = el; e; e = e.parentElement) {
        const c = rgba(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) schichten.push(c);
        if (c[3] >= 1) break;
      }
      let farbe = schichten.length && schichten[schichten.length - 1][3] >= 1 ? schichten.pop() : rgba(getComputedStyle(document.body).backgroundColor);
      while (schichten.length) { const c = schichten.pop(); farbe = [0, 1, 2].map((i) => c[i] * c[3] + farbe[i] * (1 - c[3])).concat(1); }
      return farbe;
    };
    const wurzel = document.querySelector(sel);
    const out = [];
    const sichtbar = (el) => { for (let e = el; e && e !== wurzel.parentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.opacity === '0' || s.visibility === 'hidden' || s.display === 'none') return false; } return true; };
    const felder = [...wurzel.querySelectorAll('*')];
    for (const el of felder) {
      const eigen = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.value && el.type !== 'checkbox' && el.type !== 'color');
      if (!eigen || !sichtbar(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      const c = rgba(s.color); const g = grund(el);
      const t = c[3] < 1 ? [0, 1, 2].map((i) => c[i] * c[3] + g[i] * (1 - c[3])) : c;
      const L1 = lum(t); const L2 = lum(g);
      const v = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      out.push({ text: (el.value || el.textContent).trim().slice(0, 30), v: Math.round(v * 100) / 100, klasse: el.className && typeof el.className === 'string' ? el.className.slice(0, 40) : el.tagName });
    }
    return out;
  }, sel);
}

console.log('════ A: Kontrast hell und dunkel ════');
for (const dunkel of [false, true]) {
  const name = dunkel ? 'dunkel' : 'hell';
  const { ctx, P } = await seite({ dunkel, nodes: [
    karte('w', { title: 'Weiß', color: 'white', entries: sitzungen(), current: 's3' }, 40, 40),
    karte('g', { title: 'Gelb', color: 'yellow', entries: sitzungen(), current: 's3' }, 540, 40),
    karte('d', { title: 'Dunkel eigen', color: 'white', hex: '#2b2f36', entries: sitzungen(), current: 's3' }, 1040, 40, 380),
  ] });
  for (const id of ['w', 'g', 'd']) {
    await waehle(P, id);
    const sitz = await kontraste(P, `.react-flow__node[data-id="${id}"] .card-body`);
    const schlecht = sitz.filter((x) => x.v < 4.5);
    const editor = sitz.filter((x) => /Entwurf liegt vor|Zahlen an das Referat/.test(x.text));
    pruefe(`A ${name}/${id}: Sitzung – ${sitz.length} Texte, alle ≥ 4,5:1 (auch der Protokolltext)`, sitz.length > 15 && schlecht.length === 0 && editor.length >= 2, JSON.stringify(schlecht.slice(0, 6)));
    await P.locator(`.react-flow__node[data-id="${id}"] [data-taste="pr-uebersicht"]`).click();
    await P.waitForTimeout(400);
    const ueb = await kontraste(P, `.react-flow__node[data-id="${id}"] .card-body`);
    const schlecht2 = ueb.filter((x) => x.v < 4.5);
    pruefe(`A ${name}/${id}: Übersicht – ${ueb.length} Texte, alle ≥ 4,5:1`, ueb.length > 8 && schlecht2.length === 0, JSON.stringify(schlecht2.slice(0, 6)));
    await P.locator(`.react-flow__node[data-id="${id}"] [data-taste="pr-sitzung"]`).click();
    await P.waitForTimeout(300);
  }
  await P.mouse.click(1400, 860);
  await P.screenshot({ path: `${SD}/m489-a-${name}.png` });
  await ctx.close();
}

console.log('════ B–E: Arbeiten mit der Reihe, Altbestand, Neuladen ════');
{
  const { ctx, P } = await seite({ nodes: [
    karte('m1', { title: 'Jour fixe', color: 'white', entries: sitzungen(), current: 's2', rhythm: 'woche', carryOpen: true, agenda: ['Haushalt'] }, 40, 40),
    karte('alt', altesProtokoll(), 560, 40, 420, 520),
    karte('k', { title: 'Lenkungskreis', color: 'white', entries: sitzungen() }, 1040, 40, 300, 160, { kachel: true, kachelMass: { w: 460, h: 620 } }),
  ] });
  const M = '.react-flow__node[data-id="m1"]';

  // B — neue Sitzung (die neueste ist s3 mit drei Namen und zwei offenen Aufgaben)
  await waehle(P, 'm1');
  await P.locator(`${M} [data-taste="pr-neu"]`).click();
  // M495: gibt es etwas zu übernehmen, zeigt „+" erst die Übergabe (alles angehakt) — anlegen wie vorgeschlagen
  await P.locator(`${M} [data-taste="pr-anlegen"]`).click();
  await P.waitForTimeout(500);
  let n = await knoten(P, 'm1');
  const neu = n.data.entries.find((e) => !['s2', 's3'].includes(e.id));
  const offenNeu = (neu?.blocks ?? []).filter((b) => b.type === 'checkListItem' && !b.props?.checked).map((b) => b.content);
  pruefe('B1 neue Sitzung angelegt und angezeigt', !!neu && n.data.current === neu.id && (await P.locator(`${M} .pr-tag[aria-selected="true"]`).count()) === 1);
  pruefe('B2 Teilnehmende der letzten Sitzung übernommen', neu?.attendees === 'Anna Berg, Gerd Huber, Petra Lang', neu?.attendees);
  pruefe('B3 beide offenen Aufgaben übernommen, mit „offen seit", die erledigte nicht', offenNeu.length === 2 && offenNeu.every((t) => /\(offen seit/.test(t)) && !offenNeu.some((t) => /Vorlage verteilen/.test(t)), JSON.stringify(offenNeu));
  pruefe('B4 die Runde steht als Namen in der Karte', (await P.locator(`${M} .pr-person`).allTextContents()).map((t) => t.trim()).join('|') === 'Anna Berg|Gerd Huber|Petra Lang');
  const toast = await P.locator('.toast, [role="status"]').allTextContents().catch(() => []);
  pruefe('B5 die Meldung nennt, was übernommen wurde', toast.some((t) => /3 Personen/.test(t) && /2 offene Aufgaben/.test(t)), JSON.stringify(toast));

  // C — Zeile als Aufgabe und als Beschluss markieren
  const absatz = P.locator(`${M} .minutes-body [contenteditable="true"] .bn-block-content`).last();
  await absatz.click();
  await P.keyboard.press('End');
  await P.keyboard.press('Enter');
  await P.keyboard.type('Petra: Budget prüfen bis 04.12.');
  await P.locator(`${M} [data-taste="pr-aufgabe"]`).click();
  await P.waitForTimeout(300);
  await P.keyboard.press('End');
  await P.keyboard.press('Enter');
  await P.keyboard.type('Die Klausur wird verschoben.');
  // Enter in einem Checklisten-Punkt legt den nächsten an — für den Beschluss egal, er nimmt die Zeile heraus
  await P.locator(`${M} [data-taste="pr-beschluss"]`).click();
  await P.waitForTimeout(400);
  n = await knoten(P, 'm1');
  const s = n.data.entries.find((e) => e.id === n.data.current);
  const aufgabe = (s.blocks ?? []).find((b) => /Budget prüfen/.test(textAus([b])));
  pruefe('C1 „Aufgabe" macht die Zeile zum Checklisten-Punkt', aufgabe?.type === 'checkListItem' && aufgabe.props?.checked === false, JSON.stringify(aufgabe));
  pruefe('C2 „Beschluss" hält die Zeile als Beschluss fest und nimmt sie aus dem Text', (s.decisions ?? []).some((d) => d.text === 'Die Klausur wird verschoben.') && !textAus(s.blocks).includes('Klausur'), JSON.stringify(s.decisions));
  pruefe('C3 der Beschluss steht in der Karte', (await P.locator(`${M} .pr-beschluss-text`).evaluateAll((els) => els.map((e) => e.value))).includes('Die Klausur wird verschoben.'));
  await P.locator(`${M} [data-taste="pr-uebersicht"]`).click();
  await P.waitForTimeout(500);
  const gruppen = await P.locator(`${M} .pr-gruppe`).evaluateAll((gs) => gs.map((g) => ({ name: g.querySelector('.pr-gruppe-name')?.textContent, aufgaben: [...g.querySelectorAll('.pr-aufgabe')].map((a) => ({ text: a.querySelector('.pr-aufgabe-text')?.textContent, frist: a.querySelector('.pr-frist')?.textContent ?? '' })) })));
  const petra = gruppen.find((g) => g.name === 'Petra');
  pruefe('C4 Übersicht: die neue Aufgabe steht bei Petra, ohne Namen im Text, mit Frist', !!petra && petra.aufgaben.some((a) => a.text === 'Budget prüfen bis 04.12.' && /04\.12\./.test(a.frist)), JSON.stringify(gruppen));
  pruefe('C5 Übersicht: Gerd und Anna (auch @Anna) mit ihren übernommenen Aufgaben', gruppen.some((g) => g.name === 'Gerd') && gruppen.some((g) => g.name === 'Anna' && g.aufgaben.some((a) => /Raumbuchung/.test(a.text))), JSON.stringify(gruppen.map((g) => g.name)));
  const beschl = await P.locator(`${M} .pr-beschluss`).allTextContents();
  pruefe('C6 Übersicht: Beschlusslage der ganzen Reihe, neueste zuerst', beschl.length === 3 && /Klausur/.test(beschl[0]) && /dienstags/.test(beschl[2]), JSON.stringify(beschl));
  pruefe('C7 der Zähler am Reiter nennt die offenen Aufgaben', (await P.locator(`${M} [data-taste="pr-uebersicht"] .pr-zahl`).textContent()) === '3');
  await P.locator(`${M} .pr-gruppe`, { hasText: 'Gerd' }).locator('input[type="checkbox"]').first().click();
  await P.waitForTimeout(400);
  n = await knoten(P, 'm1');
  const gerd = n.data.entries.find((e) => e.id === n.data.current).blocks.find((b) => /Zahlen an das Referat/.test(textAus([b])));
  pruefe('C8 Abhaken in der Übersicht hakt den Punkt im Protokoll ab', gerd?.props?.checked === true && (await P.locator(`${M} .pr-gruppe`, { hasText: 'Gerd' }).count()) === 0, JSON.stringify(gerd));
  // Suche über alle Sitzungen
  await P.locator(`${M} .pr-suche input`).fill('raumplanung');
  await P.waitForTimeout(300);
  const treffer = await P.locator(`${M} .pr-treffer`).allTextContents();
  pruefe('C9 Suche findet einen Satz aus einer älteren Sitzung; Klick öffnet sie', treffer.length === 1 && /Raumplanung/.test(treffer[0]));
  await P.locator(`${M} .pr-treffer`).first().click();
  await P.waitForTimeout(500);
  n = await knoten(P, 'm1');
  pruefe('C10 … und zeigt die Sitzung im Reiter „Sitzung"', n.data.current === 's2' && (await P.locator(`${M} [data-taste="pr-sitzung"][aria-selected="true"]`).count()) === 1);

  // D — altes Protokoll: alles da, nichts verloren
  const A = '.react-flow__node[data-id="alt"]';
  const tags = await P.locator(`${A} .pr-tag`).allTextContents();
  pruefe('D1 altes Protokoll: beide Sitzungen in der Leiste, neueste zuerst und gezeigt', tags.length === 2 && /04\.03/.test(tags[0]) && (await P.locator(`${A} .pr-tag[aria-selected="true"]`).textContent()).includes('04.03'), JSON.stringify(tags));
  pruefe('D2 Titel, Runde (mit Semikolon), Text und Beschluss werden gezeigt', (await P.locator(`${A} .pr-sitzung-titel`).inputValue()) === 'Sondersitzung'
    && (await P.locator(`${A} .pr-person`).allTextContents()).map((t) => t.trim()).join('|') === 'Ute|Max'
    && /Fett und normal/.test(await P.locator(`${A} .minutes-body`).textContent())
    && (await P.locator(`${A} .pr-beschluss-text`).inputValue()) === 'Angebot wird eingeholt.');
  await waehle(P, 'alt');
  await P.locator(`${A} .pr-person-neu`).fill('Lea');
  await P.keyboard.press('Enter');
  await P.waitForTimeout(300);
  await P.locator(`${A} .pr-tag`).nth(1).click();
  await P.waitForTimeout(500);
  await P.locator(`${A} .pr-tag`).nth(0).click();
  await P.waitForTimeout(500);
  const alt = (await knoten(P, 'alt')).data;
  const vorher = altesProtokoll();
  const e2 = alt.entries.find((e) => e.id === 'x2');
  pruefe('D3 unbekannte Felder bleiben (Karte und Sitzung)', alt.fremdFeld === 'bleibt' && e2?.extraEntry === 42 && alt.rhythm === 'monat' && JSON.stringify(alt.agenda) === JSON.stringify(vorher.agenda));
  pruefe('D4 Text, Struktur und Beschlüsse unverändert, die Runde um Lea ergänzt', textAus(e2.blocks) === textAus(vorher.entries[0].blocks)
    && JSON.stringify(e2.decisions) === JSON.stringify(vorher.entries[0].decisions) && e2.attendees === 'Ute, Max, Lea'
    && textAus(alt.entries.find((e) => e.id === 'x1').blocks) === textAus(vorher.entries[1].blocks), JSON.stringify({ t: textAus(e2.blocks), a: e2.attendees }));
  await P.locator(`${A} [data-taste="pr-uebersicht"]`).click();
  await P.waitForTimeout(400);
  pruefe('D5 Übersicht des alten Protokolls: Aufgabe von Max mit „seit", Beschluss', (await P.locator(`${A} .pr-gruppe`, { hasText: 'Max' }).locator('.pr-seit').textContent()) === 'seit 01.02.25'
    && (await P.locator(`${A} .pr-beschluss`).count()) === 1);

  // G — Kachel
  const kz = await P.locator('.react-flow__node[data-id="k"] .kachel-zeile').allTextContents();
  pruefe('G1 die Kachel nennt die offenen Aufgaben', kz.some((t) => /^2 offene Aufgaben/.test(t)), JSON.stringify(kz));
  await P.screenshot({ path: `${SD}/m489-b-arbeit.png` });

  // E — Neuladen
  await P.waitForTimeout(1200);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  n = await knoten(P, 'm1');
  pruefe('E1 nach dem Neuladen: drei Sitzungen, die gezeigte Sitzung bleibt', n.data.entries.length === 3 && n.data.current === 's2' && (await P.locator(`${M} .pr-tag`).count()) === 3);
  await P.locator(`${M} [data-taste="pr-uebersicht"]`).click();
  await P.waitForTimeout(400);
  const nachher = await P.locator(`${M} .pr-aufgabe-text`).allTextContents();
  pruefe('E2 … Aufgaben und Beschlüsse stehen noch da', nachher.includes('Budget prüfen bis 04.12.') && !nachher.some((t) => /Zahlen an das Referat/.test(t)) && (await P.locator(`${M} .pr-beschluss`).count()) === 3, JSON.stringify(nachher));
  await ctx.close();
}

console.log('════ F: Telefonbreite ════');
for (const dunkel of [false, true]) {
  const { ctx, P } = await seite({ dunkel, breite: 390, hoehe: 800, mobil: true, nodes: [karte('m1', { title: 'Jour fixe Referat 21 mit langem Namen', color: 'white', entries: sitzungen().concat([{ id: 's0', date: iso(-15), attendees: 'Anna Berg', blocks: [] }, { id: 's-1', date: iso(-22), blocks: [] }, { id: 's-2', date: iso(-400), blocks: [] }]), current: 's3' }, 40, 40)] });
  await P.locator('.react-flow__node[data-id="m1"] .minutes-title').tap({ force: true });
  await P.waitForTimeout(1500);
  const M = '.react-flow__node[data-id="m1"]';
  const mass = async () => P.evaluate((M) => {
    const k = document.querySelector(`${M} .card-body`).getBoundingClientRect();
    const zuBreit = [...document.querySelectorAll(`${M} .pr-rahmen *`)].filter((el) => {
      if (el.closest('.pr-leiste') && !el.classList.contains('pr-leiste')) return false;   // die Leiste rollt waagrecht
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > k.right + 1 || r.left < k.left - 1);
    }).map((el) => el.className || el.tagName);
    const rahmen = document.querySelector(`${M} .pr-rahmen`);
    return { zuBreit: zuBreit.slice(0, 5), ueber: rahmen.scrollWidth - rahmen.clientWidth, fokus: !!document.querySelector('.app.focus-mode') };
  }, M);
  const m1 = await mass();
  pruefe(`F ${dunkel ? 'dunkel' : 'hell'}: im Fokus, Sitzung ohne Überlauf`, m1.fokus && m1.ueber <= 1 && m1.zuBreit.length === 0, JSON.stringify(m1));
  const knoepfe = await P.locator(`${M} .pr-werkzeuge button`).evaluateAll((bs) => {
    const d = document.querySelector('.react-flow__node[data-id="m1"] .pr-datum').getBoundingClientRect();
    return bs.map((b) => { const r = b.getBoundingClientRect(); return { h: Math.round(r.height), zeile: r.top < d.bottom && r.bottom > d.top }; });
  });
  pruefe(`F ${dunkel ? 'dunkel' : 'hell'}: Werkzeuge erreichbar (vier Knöpfe in der Datumszeile, für den Finger groß genug)`, knoepfe.length === 4 && knoepfe.every((k) => k.h >= 28 && k.zeile), JSON.stringify(knoepfe));
  await P.locator(`${M} [data-taste="pr-uebersicht"]`).tap();
  await P.waitForTimeout(400);
  const m2 = await mass();
  pruefe(`F ${dunkel ? 'dunkel' : 'hell'}: Übersicht ohne Überlauf`, m2.ueber <= 1 && m2.zuBreit.length === 0, JSON.stringify(m2));
  await P.screenshot({ path: `${SD}/m489-f-telefon-${dunkel ? 'dunkel' : 'hell'}.png` });
  await ctx.close();
}

pruefe('G2 keine Seitenfehler', fehler.length === 0, JSON.stringify(fehler.slice(0, 3)));
await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
