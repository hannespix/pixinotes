/**
 * M531 — Karten: offene Punkte aus den Audits M513, M519, M520.
 *
 *   A  Fristen auch englisch: „by Friday" in der englischen Oberfläche, „Review on Friday" auch in der deutschen
 *      (deutsch kam dort nichts); englische Schnell-Eingabe mit englischem Platzhalter und Frist.
 *   B  Timer für alle: Der Starter lädt neu — die Uhr läuft bei ihm weiter (gleiche Restzeit wie bei den anderen),
 *      ein angehaltener Timer kommt nicht wieder, ein abgelaufener ist danach abgelaufen.
 *   C  Kalender: eigene Termine eines Tages nach Uhrzeit (ganztägige zuerst); „Bis" vor „Von" wird abgewiesen und
 *      lässt sich tauschen. Wochenplan: Soll zählt nur, was im Raster liegt. Zeiterfassung: Blättern behält den Tag.
 *   D  Mitmachen per QR: Karte mit laufender Runde löschen und mit Strg+Z zurückholen → die Runde gilt als beendet
 *      (kein „QR offen", kein „Läuft auf einem anderen Gerät") und startet ohne Rückfrage neu.
 *   E  Diagramm: Der Hinweis „Klick auf Schritt …" verdeckt in einer schmalen Karte keinen Schritt (dann Tooltip).
 *   F  Board nur zum Lesen: Bearbeiten-Leisten (Diagramm, Form, Farbpunkt, Zeiterfassung …) sind weg, reine
 *      Ansichts-Bedienung (Blättern, Ansicht, Skala, Filter) bleibt.
 *   G  Kontakt: Klick daneben oder Fokus woandershin beendet das Bearbeiten, die Eingaben bleiben.
 *   H  Zähl-Texte: keine „(e)/(n)/(en)"-Endungen mehr in Oberflächentexten.
 *   I  Texte: Hilfe DE/EN, Wörterbuch, Meilenstein-Datei.
 */
// Läuft aus dem Repository: `node werkzeug/alle-pruefungen.mjs m531`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { webcrypto } from 'node:crypto';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.PN_BILDER ?? path.join(__repo, 'pruefungen', 'ablage', 'm531');
mkdirSync(BILDER, { recursive: true });
const PORT = 5531;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
async function warte(fn, ms = 12000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { try { if (await fn()) return true; } catch { /* weiter */ } await new Promise((x) => setTimeout(x, 150)); }
  try { return !!(await fn()); } catch { return false; }
}

const app = http.createServer((q, r) => {
  const p = q.url.split('?')[0].split('#')[0];
  let f = path.join(DIST, p === '/' ? 'index.html' : p.slice(1));
  if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const brett = (id, name, nodes, extra = {}) => ({ id, name, nodes, edges: [], drawings: [], comments: [], ...extra });
const standMit = (boards, extra = {}) => ({ boards, spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: boards.map((b) => b.id) }] }], activeId: boards[0].id, view: 'board', ...extra });
/** Neues Profil mit vorgegebenem Stand; opt.zeit = feste Uhr, opt.ls = weitere Einträge im Speicher */
const profil = async (st, opt = {}) => {
  const ctx = await browser.newContext({ viewport: opt.vp ?? { width: 1500, height: 950 }, deviceScaleFactor: 1, locale: opt.locale ?? 'de-DE', timezoneId: 'Europe/Berlin' });
  // Ein Live-Server, den es nicht gibt: nichts verlässt den Rechner
  await ctx.route('https://test.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript(({ st, ls }) => {
    if (localStorage.getItem('pixinotes-board') || sessionStorage.getItem('x-init')) return;
    sessionStorage.setItem('x-init', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st, ls: opt.ls ?? {} });
  const P = await ctx.newPage();
  P.dialoge = [];
  P.on('dialog', (d) => { P.dialoge.push(d.message()); void d.dismiss(); });
  if (opt.zeit) await P.clock.setFixedTime(new Date(opt.zeit));
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 300)); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 20000 });
  const zustand = async () => {
    let vor = null;
    for (let i = 0; i < 40; i += 1) {
      await P.waitForTimeout(350);
      const jetzt = await P.evaluate(() => localStorage.getItem('pixinotes-board'));
      if (jetzt === vor) break;
      vor = jetzt;
    }
    return JSON.parse(vor ?? 'null')?.state ?? null;
  };
  const karte = async (id) => { const s = await zustand(); return s.boards.find((b) => b.id === s.activeId).nodes.find((n) => n.id === id); };
  const knoten = (id) => P.locator(`.react-flow__node[data-id="${id}"]`);
  const waehlen = async (id, x = 40, y = 12) => { await knoten(id).click({ position: { x, y } }); await P.waitForSelector(`.react-flow__node[data-id="${id}"].selected`); };
  await P.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => { const t = document.querySelector('.toast.show')?.textContent; if (t && window.__toasts.at(-1) !== t) window.__toasts.push(t); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const toasts = () => P.evaluate(() => window.__toasts);
  return { ctx, P, zustand, karte, knoten, waehlen, toasts };
};
const notiz = (id, text, x = 80, y = 80) => ({ id, type: 'note', width: 260, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
const sichtbar = (P, sel) => P.evaluate((s) => [...document.querySelectorAll(s)].some((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }), sel);

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Fristen auch englisch ════');
{
  const en = await profil(standMit([brett('b1', 'Board', [notiz('n1', 'Send the report by Friday', 80, 80), notiz('n2', 'Call Anna tomorrow', 400, 80), notiz('n3', 'Bericht bis Freitag', 720, 80)])]), { ls: { 'pixinotes-sprache': 'en' }, locale: 'en-GB' });
  const chips = (H, id) => H.P.locator(`.react-flow__node[data-id="${id}"] .due-chip`).count();
  pruefe('A1 Englische Oberfläche: „by Friday" und „tomorrow" werden Fristen (Chip an der Notiz)', await warte(async () => (await chips(en, 'n1')) === 1 && (await chips(en, 'n2')) === 1, 10000), [await chips(en, 'n1'), await chips(en, 'n2')]);
  pruefe('A2 … deutsche Angaben gelten dort weiter („bis Freitag")', (await chips(en, 'n3')) === 1);
  // Schnell-Eingabe der Aufgaben-Zentrale
  await en.P.keyboard.press('Control+k');
  await en.P.waitForSelector('.search-box', { state: 'visible' });
  await en.P.keyboard.type('tasks');
  await en.P.locator('.search-cmds .search-cmd', { hasText: 'Task hub' }).first().click();
  await en.P.waitForSelector('.taskhub-quick', { timeout: 10000 });
  const platz = await en.P.locator('.taskhub-quick').getAttribute('placeholder');
  pruefe('A3 Platzhalter der englischen Schnell-Eingabe ist englisch („by Friday")', /by Friday/.test(platz ?? '') && !/Freitag/.test(platz ?? ''), platz);
  await en.P.locator('.taskhub-quick').fill('Write minutes by Friday @Anna');
  await en.P.locator('.taskhub-quick').press('Enter');
  const ticket = await warte(async () => {
    const s = await en.zustand();
    return s.boards[0].nodes.find((n) => n.type === 'kanban')?.data.items?.find((i) => /Write minutes/.test(i.text));
  }, 8000) ? (await en.zustand()).boards[0].nodes.find((n) => n.type === 'kanban').data.items.find((i) => /Write minutes/.test(i.text)) : null;
  const freitag = ticket?.due ? new Date(`${ticket.due}T12:00:00`).getDay() === 5 : false;
  pruefe('A4 „Write minutes by Friday @Anna" → Aufgabe „Write minutes" für Anna, fällig an einem Freitag', !!ticket && ticket.text === 'Write minutes' && ticket.who === 'Anna' && freitag, ticket);
  await en.ctx.close();

  const de = await profil(standMit([brett('b1', 'Board', [notiz('n1', 'Review on Friday', 80, 80), notiz('n2', 'Termin mit Jan Müller', 400, 80), notiz('n3', 'Abgabe bis Freitag', 720, 80)])]));
  const chipsDe = (id) => de.P.locator(`.react-flow__node[data-id="${id}"] .due-chip`).count();
  pruefe('A5 Deutsche Oberfläche: „Review on Friday" wird eine Frist (deutsch ergab der Text nichts)', await warte(async () => (await chipsDe('n1')) === 1, 10000), await chipsDe('n1'));
  pruefe('A6 … „Termin mit Jan Müller" bleibt ohne Frist, „Abgabe bis Freitag" wie bisher', (await chipsDe('n2')) === 0 && (await chipsDe('n3')) === 1, [await chipsDe('n2'), await chipsDe('n3')]);
  await de.ctx.close();
}

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Kalender, Wochenplan, Zeiterfassung ════');
{
  // Kalender: drei eigene Termine am 24.11., eingetragen in der Reihenfolge 14:00, 09:00, ganztägig
  const kal = { id: 'ca', type: 'calendar', width: 520, height: 440, position: { x: 60, y: 60 }, data: { month: '2026-11', myEvents: [
    { id: 'e1', date: '2026-11-24', title: 'Nachmittag', time: '14:00' },
    { id: 'e2', date: '2026-11-24', title: 'Morgen', time: '09:00' },
    { id: 'e3', date: '2026-11-24', title: 'Ganztag' },
  ] } };
  const h = await profil(standMit([brett('b1', 'Kalender', [kal])]), { zeit: '2026-11-24T10:00:00+01:00' });
  const P = h.P;
  await h.waehlen('ca', 16, 14);
  const zelle = h.knoten('ca').locator('.cal-cell', { hasText: 'Ganztag' }).first();
  const chipFolge = await zelle.locator('.cal-chip').allInnerTexts();
  pruefe('C1 Monatsfeld: eigene Termine nach Uhrzeit, ganztägige zuerst', /Ganztag/.test(chipFolge[0] ?? '') && /09:00/.test(chipFolge[1] ?? '') && /14:00/.test(chipFolge[2] ?? ''), chipFolge);
  // Tages-Editor: Klick in die Zelle (nicht auf einen Termin)
  const zb = await zelle.boundingBox();
  await P.mouse.click(zb.x + 4, zb.y + 4);
  await P.waitForSelector('.cal-dayedit-row', { timeout: 5000 });
  const zeilen = await P.locator('.cal-dayedit-row .cal-dayedit-title').allInnerTexts();
  pruefe('C2 Tagesliste: Ganztag · 09:00 Morgen · 14:00 Nachmittag', /Ganztag/.test(zeilen[0] ?? '') && /09:00/.test(zeilen[1] ?? '') && /14:00/.test(zeilen[2] ?? ''), zeilen);
  // Detail-Formular: Bis vor Von
  await P.locator('.cal-dayedit-row .cal-dayedit-title', { hasText: 'Morgen' }).click();
  await P.waitForSelector('.cal-evform');
  const zeiten = P.locator('.cal-evform input[type="time"]');
  await zeiten.nth(1).fill('08:00');
  const fehlerDa = await warte(async () => (await P.locator('[data-taste="cal-zeit-fehler"]').count()) === 1, 3000);
  const gesperrt = await P.locator('.cal-evform-save').isDisabled();
  pruefe('C3 „Bis" 08:00 vor „Von" 09:00: Hinweis, Speichern gesperrt', fehlerDa && gesperrt, { fehlerDa, gesperrt });
  await P.locator('.cal-evform input.cal-evform-title').press('Enter');
  await P.waitForTimeout(300);
  pruefe('C4 … auch Enter speichert nicht', (await P.locator('.cal-evform').count()) === 1);
  // (ohne Knopf – Stand vor M531 – nur bis hierher; die übrigen Teile laufen weiter)
  await P.locator('[data-taste="cal-zeit-fehler"] button', { hasText: 'Tauschen' }).click({ timeout: 3000 }).catch(() => {});
  const getauscht = [await zeiten.nth(0).inputValue({ timeout: 3000 }).catch(() => ''), await zeiten.nth(1).inputValue({ timeout: 3000 }).catch(() => '')];
  pruefe('C5 „Tauschen" macht 08:00 bis 09:00, der Hinweis geht', getauscht[0] === '08:00' && getauscht[1] === '09:00' && (await P.locator('[data-taste="cal-zeit-fehler"]').count()) === 0, getauscht);
  await P.locator('.cal-evform-save').click({ timeout: 3000 }).catch(() => {});
  const ev = await warte(async () => (await h.karte('ca')).data.myEvents.find((e) => e.id === 'e2')?.time === '08:00', 6000);
  const e2 = (await h.karte('ca')).data.myEvents.find((e) => e.id === 'e2');
  pruefe('C6 gespeichert: 08:00 bis 09:00', ev && e2.end === '09:00', e2);
  // Mehrtägig: Bis-Uhrzeit vor Von ist dann erlaubt
  if (!(await P.locator('.cal-dayedit-row').count())) { const zb2 = await zelle.boundingBox(); await P.mouse.click(zb2.x + 4, zb2.y + 4); }
  await P.locator('.cal-dayedit-row .cal-dayedit-title', { hasText: 'Nachmittag' }).click();
  await P.waitForSelector('.cal-evform');
  await zeiten.nth(1).fill('10:00');
  await P.locator('.cal-evform input[type="date"]').nth(1).fill('2026-11-25');
  await P.waitForTimeout(200);
  pruefe('C7 mit Bis-Datum am Folgetag ist 14:00 bis 10:00 ein gültiger Termin', (await P.locator('[data-taste="cal-zeit-fehler"]').count()) === 0 && !(await P.locator('.cal-evform-save').isDisabled()));
  await P.screenshot({ path: path.join(BILDER, 'kalender.png') });
  await h.ctx.close();
}
{
  // Wochenplan Mo–Fr, 8:00–17:00 → Soll der verbundenen Zeiterfassung
  const woche = { id: 'we', type: 'week', width: 520, height: 360, position: { x: 40, y: 40 }, data: { title: 'Dienstplan', days: 5, from: 480, to: 1020, entries: [
    { id: 'w1', day: 0, start: 540, dur: 120, title: 'Mo im Raster' },       // 2:00 Montag
    { id: 'w2', day: 1, start: 420, dur: 120, title: 'Di halb davor' },      // 7:00–9:00 → 1:00 im Raster
    { id: 'w3', day: 1, start: 960, dur: 120, title: 'Di halb danach' },     // 16:00–18:00 → 1:00 im Raster
    { id: 'w4', day: 5, start: 540, dur: 240, title: 'Samstag' },            // nicht im Raster (Mo–Fr)
  ] } };
  const zeit = { id: 'ti', type: 'time', width: 520, height: 420, position: { x: 620, y: 40 }, data: { title: 'Zeiterfassung', segs: [] } };
  const st = standMit([brett('b1', 'Plan', [woche, zeit])]);
  st.boards[0].edges = [{ id: 'k1', source: 'we', target: 'ti' }];
  const h = await profil(st, { zeit: '2026-11-24T10:00:00+01:00' });   // ein Dienstag
  const soll = await h.knoten('ti').locator('.time-soll').first().innerText();
  pruefe('C8 Soll am Dienstag = 2:00 h (nur der Teil der Blöcke im Raster 8–17 Uhr; vorher 4:00 h)', /Soll 2:00 h/.test(soll), soll);
  await h.waehlen('ti', 30, 12);
  await h.knoten('ti').locator('.time-views button', { hasText: 'Woche' }).click();
  const wsoll = await warte(async () => /Soll 4:00 h/.test(await h.knoten('ti').locator('.time-soll').first().innerText()), 4000);
  pruefe('C9 Wochen-Soll = 4:00 h (der Samstag liegt nicht im Raster Mo–Fr; vorher 10:00 h)', wsoll, await h.knoten('ti').locator('.time-soll').first().innerText());
  await h.ctx.close();
}
{
  // Zeiterfassung am 31. Januar: Monat weiter → 28. Februar (nicht der 15.)
  const zeit = { id: 'ti', type: 'time', width: 520, height: 420, position: { x: 60, y: 40 }, data: { title: 'Zeiterfassung', segs: [] } };
  const h = await profil(standMit([brett('b1', 'Zeit', [zeit])]), { zeit: '2027-01-31T10:00:00+01:00' });
  const T = h.knoten('ti');
  await h.waehlen('ti', 30, 12);
  await T.locator('.time-views button', { hasText: 'Monat' }).click();
  await T.locator('.time-nav button[title="Weiter"]').click();
  await T.locator('.time-views button', { hasText: 'Tag' }).click();
  const tag = await T.locator('.time-nav b').first().innerText();
  pruefe('C10 31.01. → Monat weiter → Tag zeigt den 28.02. (der letzte gültige Tag, nicht der 15.)', /28\.02\.2027/.test(tag), tag);
  await T.locator('.time-views button', { hasText: 'Jahr' }).click();
  await T.locator('.time-ymonth', { hasText: 'Apr' }).click();
  await T.locator('.time-views button', { hasText: 'Tag' }).click();
  const tag2 = await T.locator('.time-nav b').first().innerText();
  pruefe('C11 Jahr → April → Tag behält den Tag (28.04.)', /28\.04\.2027/.test(tag2), tag2);
  await h.ctx.close();
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Mitmachen per QR nach Löschen und Strg+Z ════');
{
  const schluessel = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', schluessel.privateKey);
  const token = 'tokenM531AAAAAAAA';
  const bubbles = { id: 'bu', type: 'bubbles', width: 520, height: 420, position: { x: 80, y: 80 }, data: { title: 'Ideen', frage: 'Was verbessern wir?', ideen: { i1: { text: 'Mehr Pausen', von: 'g:x', t: 1 } }, stimmen: {}, gruppen: {}, abstimmung: { phase: 'sammeln', punkte: 3, t: 4 }, regeln: { t: 4 }, mitmachen: { token, k: 'abdruckM531', an: true, t: 1, karte: 'bu' } } };
  const h = await profil(standMit([brett('b1', 'Ideen', [bubbles])]), { ls: {
    'pixinotes-mitmachen': JSON.stringify({ [token]: { jwk, board: 'b1', karte: 'bu', seit: Date.now() } }),
    'pixinotes-supabase': JSON.stringify({ url: 'https://test.supabase.co', key: 'anon-test-key' }),
  } });
  const P = h.P;
  const stand = () => P.locator('.react-flow__node[data-id="bu"] [data-taste="bub-mit-stand"]');
  pruefe('D1 die Runde läuft auf diesem Gerät („QR offen")', await warte(async () => (await stand().count()) === 1, 6000), await stand().count());
  await h.waehlen('bu', 40, 10);
  await P.keyboard.press('Delete');
  await warte(async () => (await P.locator('.react-flow__node[data-id="bu"]').count()) === 0, 4000);
  await warte(async () => /"ende"/.test(await P.evaluate(() => localStorage.getItem('pixinotes-mitmachen') ?? '')), 4000);
  await P.keyboard.press('Control+z');
  await P.waitForSelector('.react-flow__node[data-id="bu"]', { timeout: 6000 });
  await P.waitForTimeout(600);
  const anData = (await h.karte('bu')).data.mitmachen?.an;
  pruefe('D2 Strg+Z holt die Karte samt ihrer Daten zurück (die Runde steht dort noch „an")', anData === true, anData);
  pruefe('D3 … sie zeigt die Runde aber nicht mehr als laufend (kein „QR offen", Knopf nicht hervorgehoben)', (await stand().count()) === 0 && (await P.locator('.react-flow__node[data-id="bu"] .bub-mitmachen.an').count()) === 0);
  await h.waehlen('bu', 40, 10);
  await P.locator('.react-flow__node[data-id="bu"] [data-taste="bub-mitmachen"]').click();
  const qr = await warte(async () => (await P.locator('[data-taste="mit-qr"]').count()) === 1, 8000);
  const dabei = qr ? await P.locator('[data-taste="mit-qr-dabei"]').innerText() : '';
  pruefe('D4 „Mitmachen per QR" startet direkt eine neue Runde – ohne Rückfrage, dieses Gerät ist Gastgeber', qr && P.dialoge.length === 0 && !/anderen Gerät/.test(dabei), { dialoge: P.dialoge, dabei });
  const neu = (await h.karte('bu')).data.mitmachen;
  pruefe('D5 … mit neuem Code (neues Token, an)', neu?.an === true && neu.token !== token, neu?.token);
  await P.screenshot({ path: path.join(BILDER, 'mitmachen-neu.png') });
  await h.ctx.close();
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Diagramm-Hinweis ════');
{
  const code = 'flowchart TD\n  A[Start] --> B[Prüfen]\n  B --> C[Fertig]';
  const h = await profil(standMit([brett('b1', 'Diagramm', [
    { id: 'schmal', type: 'mermaid', width: 190, height: 280, position: { x: 60, y: 60 }, data: { code } },
    { id: 'breit', type: 'mermaid', width: 620, height: 420, position: { x: 400, y: 60 }, data: { code: 'flowchart LR\n  A[Start] --> B[Prüfen]' } },
  ])]));
  const P = h.P;
  const messe = (id) => P.evaluate((k) => {
    const n = document.querySelector(`.react-flow__node[data-id="${k}"]`);
    const hint = n.querySelector('.mm-hint');
    const vorschau = n.querySelector('.mermaid-preview');
    if (!hint) return { hint: false, title: vorschau?.title ?? '' };
    const r = hint.getBoundingClientRect();
    const sichtbar = getComputedStyle(hint).visibility !== 'hidden';
    const verdeckt = [...n.querySelectorAll('.mermaid-svg g.node')].filter((g) => { const q = g.getBoundingClientRect(); return q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top; }).length;
    return { hint: true, sichtbar, verdeckt, title: vorschau.title };
  }, id);
  await P.waitForSelector('.react-flow__node[data-id="schmal"] .mermaid-svg g.node');
  await h.waehlen('schmal', 30, 8);
  await P.waitForTimeout(500);
  const s = await messe('schmal');
  pruefe('E1 schmales Diagramm, markiert: der Hinweis verdeckt keinen Schritt', !(s.hint && s.sichtbar && s.verdeckt > 0), s);
  pruefe('E2 … sein Text steht dann als Tooltip an der Zeichenfläche', !s.sichtbar ? /Klick auf Schritt/.test(s.title) : true, s);
  await P.screenshot({ path: path.join(BILDER, 'diagramm-schmal.png'), clip: { x: 0, y: 0, width: 420, height: 420 } });
  await h.waehlen('breit', 30, 8);
  await P.waitForSelector('.react-flow__node[data-id="breit"] .mermaid-svg g.node');
  await P.waitForTimeout(500);
  const b = await messe('breit');
  pruefe('E3 breites Diagramm mit Platz darunter: der Hinweis steht wie bisher (sichtbar, nichts verdeckt)', b.hint && b.sichtbar && b.verdeckt === 0 && !b.title, b);
  await h.ctx.close();
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Board nur zum Lesen ════');
{
  const t = (s) => [{ type: 'text', text: s, styles: {} }];
  const karten = [
    { id: 'no', type: 'note', width: 240, position: { x: 30, y: 30 }, data: { color: 'yellow', blocks: [{ id: 'a', type: 'paragraph', content: 'Notiz' }] } },
    { id: 'fo', type: 'shape', width: 160, height: 90, position: { x: 300, y: 30 }, data: { shape: 'process', text: 'Form', color: '#eef2ff' } },
    { id: 'di', type: 'mermaid', width: 360, height: 240, position: { x: 500, y: 30 }, data: { code: 'flowchart LR\n  A[Start] --> B[Ende]' } },
    { id: 'ti', type: 'time', width: 460, height: 360, position: { x: 900, y: 30 }, data: { title: 'Zeiterfassung', segs: [] } },
    { id: 'ga', type: 'gantt', width: 560, height: 240, position: { x: 30, y: 420 }, data: { title: 'Zeitplan', dayWidth: 24, rows: [{ id: 'r1', name: 'Phase 1', start: '2026-11-24', end: '2026-11-30', color: '#4f7cff' }] } },
    { id: 'sh', type: 'sheet', width: 460, height: 260, position: { x: 640, y: 420 }, data: { title: 'Tabelle', cols: 3, rows: 4, cells: { A1: 'Posten', B1: '3' } } },
    { id: 'we', type: 'week', width: 460, height: 300, position: { x: 30, y: 720 }, data: { title: 'Wochenplan', entries: [] } },
    { id: 'mi', type: 'minutes', width: 480, height: 420, position: { x: 540, y: 720 }, data: { title: 'Jour Fixe', color: 'white', agenda: [], rhythm: 'woche', carryOpen: true, current: 'e1', entries: [{ id: 'e1', date: '2026-11-17', attendees: 'Anna', blocks: [{ id: 'p1', type: 'paragraph', props: {}, content: t('Sitzung'), children: [] }], decisions: [] }] } },
    { id: 'ka', type: 'kanban', width: 440, height: 300, position: { x: 1080, y: 720 }, data: { title: 'Kanban', cols: ['To Do', 'Erledigt'], items: [] } },
  ];
  const leer = { id: 'ca', type: 'calendar', width: 420, height: 340, position: { x: 1150, y: 420 }, data: { month: '2026-11' } };
  const st = standMit([brett('b1', 'Geteilt', [...karten, leer], { geteiltRolle: 'lesen', geteiltVon: 'u-fremd', geteiltName: 'Ada' })]);
  const h = await profil(st, { vp: { width: 1600, height: 1150 }, zeit: '2026-11-24T10:00:00+01:00' });
  const P = h.P;
  await P.evaluate(() => { const v = document.querySelector('.react-flow__viewport'); return !!v; });
  const pruefKarte = async (id, weg, bleibt, x = 30, y = 8) => {
    await h.waehlen(id, x, y);
    await P.waitForTimeout(250);
    const w = {}; const b = {};
    for (const s of weg) w[s] = await sichtbar(P, s);
    for (const s of bleibt) b[s] = await sichtbar(P, s);
    return { weg: Object.entries(w).filter(([, v]) => v).map(([k]) => k), fehlt: Object.entries(b).filter(([, v]) => !v).map(([k]) => k) };
  };
  const n = await pruefKarte('no', ['.react-flow__node[data-id="no"] .color-dot'], []);
  pruefe('F1 Notiz: kein Farbpunkt', n.weg.length === 0, n);
  const f = await pruefKarte('fo', ['.react-flow__node[data-id="fo"] .shape-toolbar'], [], 20, 20);
  pruefe('F2 Form: keine Form-Leiste (Form, Farbe)', f.weg.length === 0, f);
  const d = await pruefKarte('di', ['.react-flow__node-toolbar.mm-toolbar', '.mm-toolbar'], []);
  pruefe('F3 Diagramm: keine Leiste „＋ Schritt" unter der Karte', d.weg.length === 0, d);
  const z = await pruefKarte('ti', ['.react-flow__node[data-id="ti"] .time-rec', '.react-flow__node[data-id="ti"] .time-add'], ['.react-flow__node[data-id="ti"] .time-views', '.react-flow__node[data-id="ti"] .time-nav button[title="Weiter"]']);
  pruefe('F4 Zeiterfassung: kein „Arbeit/Pause starten", kein „＋ Eintrag" – Ansicht und Blättern bleiben', z.weg.length === 0 && z.fehlt.length === 0, z);
  const g = await pruefKarte('ga', ['.react-flow__node[data-id="ga"] .gantt-tools > button[aria-label="Vorgang hinzufügen"]', '.react-flow__node[data-id="ga"] .gantt-addzeile'], ['.react-flow__node[data-id="ga"] .gantt-tools button[aria-haspopup]']);
  pruefe('F5 Zeitplan: kein „Vorgang hinzufügen" – das Menü (Skala, zu heute) bleibt', g.weg.length === 0 && g.fehlt.length === 0, g);
  const s = await pruefKarte('sh', ['.react-flow__node[data-id="sh"] .sheet-tools > button[aria-label="Zeile anhängen"]'], ['.react-flow__node[data-id="sh"] .sheet-tools button[aria-haspopup]']);
  pruefe('F6 Tabelle: kein „Zeile anhängen" – das Menü (Filter, Sortieren) bleibt', s.weg.length === 0 && s.fehlt.length === 0, s);
  const w = await pruefKarte('we', ['.react-flow__node[data-id="we"] .week-tools'], []);
  pruefe('F7 Wochenplan: keine Raster-Einstellungen', w.weg.length === 0, w);
  const m = await pruefKarte('mi', ['.react-flow__node[data-id="mi"] [data-taste="pr-top"]', '.react-flow__node[data-id="mi"] .minutes-setup-btn', '.react-flow__node[data-id="mi"] .minutes-new'], ['.react-flow__node[data-id="mi"] .pr-mehr', '.react-flow__node[data-id="mi"] .pr-reiter']);
  pruefe('F8 Protokoll: kein TOP/Aufgabe/Beschluss, kein Einrichten – Kopieren/Drucken und Übersicht bleiben', m.weg.length === 0 && m.fehlt.length === 0, m);
  const k = await pruefKarte('ka', ['.react-flow__node[data-id="ka"] .kanban-add'], []);
  pruefe('F9 Kanban: keine Zeile „＋ Neues Ticket"', k.weg.length === 0, k);
  const c = await pruefKarte('ca', [], ['.react-flow__node[data-id="ca"] .cal-nav button[aria-label="Weiter"]']);
  pruefe('F10 Kalender: Blättern bleibt', c.fehlt.length === 0, c);
  await P.screenshot({ path: path.join(BILDER, 'nur-lesen.png') });
  await h.ctx.close();
  // Gegenprobe: im eigenen Board ist alles da
  const eigen = standMit([brett('b1', 'Eigen', karten)]);
  const e = await profil(eigen, { vp: { width: 1600, height: 1150 }, zeit: '2026-11-24T10:00:00+01:00' });
  await e.waehlen('no', 30, 8);
  const dot = await sichtbar(e.P, '.react-flow__node[data-id="no"] .color-dot');
  await e.waehlen('di', 30, 8);
  await e.P.waitForTimeout(300);
  const leiste = await sichtbar(e.P, '.mm-toolbar');
  await e.waehlen('ti', 30, 8);
  const rec = await sichtbar(e.P, '.react-flow__node[data-id="ti"] .time-rec');
  pruefe('F11 Gegenprobe eigenes Board: Farbpunkt, Diagramm-Leiste und Zeiterfassung sind da', dot && leiste && rec, { dot, leiste, rec });
  await e.ctx.close();
}

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Kontakt ════');
{
  const kontakt = { id: 'ko', type: 'kontakt', width: 320, position: { x: 80, y: 80 }, data: { name: 'Anna Müller', firma: 'Amt', telefone: [{ art: 'Dienstlich', nummer: '0761 208-1234' }], emails: ['anna@example.de'] } };
  const h = await profil(standMit([brett('b1', 'Kontakte', [kontakt, notiz('n1', 'Daneben', 600, 80)])]));
  const P = h.P;
  const form = () => P.locator('.react-flow__node[data-id="ko"] .kontakt-form').count();
  await h.waehlen('ko', 30, 10);
  await P.locator('.react-flow__node[data-id="ko"] .kontakt-tools button[aria-label="Bearbeiten"]').click();
  await P.waitForSelector('.react-flow__node[data-id="ko"] .kontakt-form');
  const feldF = P.locator('.react-flow__node[data-id="ko"] .kontakt-feld[aria-label="Funktion"]');
  await feldF.click();
  await P.keyboard.insertText('Sachbearbeiterin');
  await P.mouse.click(1300, 700);   // freie Fläche
  pruefe('G1 Klick auf die freie Fläche beendet das Bearbeiten (wie „Fertig")', await warte(async () => (await form()) === 0, 3000), await form());
  const gespeichert = await warte(async () => (await h.karte('ko')).data.funktion === 'Sachbearbeiterin', 5000);
  pruefe('G2 … die Eingabe bleibt gespeichert', gespeichert);
  // Fokus woandershin (Tastatur): aus dem Formular in eine andere Karte
  await h.waehlen('ko', 30, 10);
  await P.locator('.react-flow__node[data-id="ko"] .kontakt-tools button[aria-label="Bearbeiten"]').click({ timeout: 3000 }).catch(() => {});   // (vor M531 stand das Formular noch offen)
  await P.waitForSelector('.react-flow__node[data-id="ko"] .kontakt-form');
  await P.locator('.react-flow__node[data-id="ko"] .kontakt-feld[aria-label="Name"]').focus();
  await P.evaluate(() => { const b = document.querySelector('[data-taste="einstellungen"]'); b?.focus(); });
  pruefe('G3 Fokus verlässt die Karte (Tastatur) → Bearbeiten endet', await warte(async () => (await form()) === 0, 3000));
  // Klick IN die Karte (anderes Feld) beendet nichts
  await h.waehlen('ko', 30, 10);
  await P.locator('.react-flow__node[data-id="ko"] .kontakt-tools button[aria-label="Bearbeiten"]').click({ timeout: 3000 }).catch(() => {});
  await P.waitForSelector('.react-flow__node[data-id="ko"] .kontakt-form');
  await P.locator('.react-flow__node[data-id="ko"] .kontakt-feld[aria-label="Firma"]').click();
  await P.locator('.react-flow__node[data-id="ko"] .kontakt-feld[aria-label="Name"]').click();
  await P.waitForTimeout(300);
  pruefe('G4 Klicks innerhalb des Formulars lassen es offen', (await form()) === 1);
  await h.ctx.close();
}

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\n════ H: Zähl-Texte ════');
{
  const funde = [];
  const geh = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) geh(p); else if (/\.(tsx?|mts)$/.test(e.name)) { readFileSync(p, 'utf8').split('\n').forEach((z, i) => { if (/^\s*(\/\/|\*|\/\*)/.test(z)) return; if (/(?<![A-Za-z0-9_$])[A-ZÄÖÜ][a-zäöüß]{2,}\((?:e|n|en|er|s|nen)\)(?=\s+\p{L}|['"`»“”])/u.test(z)) funde.push(`${path.relative(__repo, p)}:${i + 1}`); }); } } };
  geh(path.join(__repo, 'src'));
  pruefe('H1 keine Oberflächentexte mit „Karte(n)", „Frist(en)", „Punkt(e)" … (zahlWort statt Klammer-Endung)', funde.length === 0, funde.join(', '));
}

// ---------- Nachgebautes Supabase und Helfer (übernommen aus m512) ----------
// ---------- Nachgebautes Supabase (zwei Konten) ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const sb = {
  nutzer: new Map(), tokens: new Map(), refresh: new Map(),
  zeilen: new Map(),      // `${uid}/${name}` → Zeile
  freigaben: [],          // { id, besitzer, board_id, gast_email, gast_id, rolle, created_at }
  einladungen: [],        // { token, besitzer, board_id, rolle, created_at }
  ohneEinladung: false,   // Server ohne Tabelle board_einladungen (Migration fehlt)
  sockets: [], objekte: new Map(), n: 0,
  aufrufe: { freigabeSchreiben: 0, vorbedingung: 0, keineFreigabe: 0, stapel: 0, gastLesen: 0, gastStand: 0, gastSchreiben: 0, gastAbgelehnt: 0, nichtErlaubt: 0, karte: 0, stand: 0, gastAendern: 0, besitzerBoard: 0, delta: 0 },
  ohneAendern: false,     // Server ohne gast_aendern
  // M364
  kanaele: new Map(),     // `${besitzer}/${board}` → Kanalname
  live: [],               // { ws, topic, key, meta } — Broadcast + Presence
  ohneGast: false,        // Server ohne gast_*-Funktionen (Migration fehlt)
  ohneLive: false,        // Der Live-Kanal antwortet nicht (neue Verbindungen)
};
const kanalVon = (besitzer, boardId) => { const k = `${besitzer}/${boardId}`; if (!sb.kanaele.has(k)) sb.kanaele.set(k, `k${++sb.n}${Math.random().toString(36).slice(2, 12)}`); return sb.kanaele.get(k); };
// M366: kartenweise Änderung, wie gast_aendern auf dem Server
const patchAuf = (board, p) => {
  for (const art of ['nodes', 'edges', 'drawings', 'comments']) {
    const t = p[art]; if (!t) continue;
    const set = new Map((t.set ?? []).map((o) => [o.id, o])); const del = new Set(t.del ?? []);
    const neu = [];
    for (const o of board[art] ?? []) { if (del.has(o.id)) continue; if (set.has(o.id)) { neu.push(set.get(o.id)); set.delete(o.id); } else neu.push(o); }
    for (const o of set.values()) if (!del.has(o.id)) neu.push(o);
    board[art] = neu;
  }
  return board;
};
const serverAendern = (e, p) => {
  const name = `board-${e.board_id}.json`;
  const z = zeile(e.besitzer, name);
  const vor = z.version;
  const neu = schreib(e.besitzer, name, JSON.stringify(patchAuf(JSON.parse(z.inhalt), p)), 'application/json', 0);
  const um = zeile(e.besitzer, 'umgebung.json');
  if (um) { const u = JSON.parse(um.inhalt); u.boards[e.board_id] = `v${neu.version}`; u.savedAt = new Date().toISOString(); u.basisEtag = String(um.version); schreib(e.besitzer, 'umgebung.json', JSON.stringify(u), 'application/json', 0); }
  return { version: neu.version, vor };
};
const liveAn = (topic, nachricht, ausser = null) => { for (const s of sb.live) if (s.topic === topic && s !== ausser) { try { s.ws.send(JSON.stringify(nachricht)); } catch { /* zu */ } } };
/** Ein Teilnehmer, den es als Gerät nicht gibt (für die Sicherheitsprüfung) */
const fakeDa = (topic, key, meta) => liveAn(topic, { topic, event: 'presence_diff', payload: { joins: { [key]: { metas: [meta] } }, leaves: {} }, ref: null });
const fakeWeg = (topic, key, meta) => liveAn(topic, { topic, event: 'presence_diff', payload: { joins: {}, leaves: { [key]: { metas: [meta] } } }, ref: null });
const fakeSenden = (topic, ereignis, inhalt) => liveAn(topic, { topic, event: 'broadcast', payload: { type: 'broadcast', event: ereignis, payload: inhalt }, ref: null });
const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (u, bis) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: u.id, email: u.email, exp: Math.floor(bis / 1000) }))}.sig`;
const sitzungFuer = (u, lebensdauerS = 3600) => {
  const bis = Date.now() + lebensdauerS * 1000;
  const t = jwt(u, bis), r = `rt-${++sb.n}`;
  sb.tokens.set(t, { uid: u.id, bis }); sb.refresh.set(r, u.id);
  return { access_token: t, refresh_token: r, expires_in: lebensdauerS, token_type: 'bearer', user: { id: u.id, email: u.email } };
};
const uidAus = (req) => {
  const t = /^Bearer (.+)$/.exec(req.headers()['authorization'] ?? '')?.[1];
  const e = t && sb.tokens.get(t);
  return e && e.bis >= Date.now() ? e.uid : null;
};
const nutzerVon = (uid) => [...sb.nutzer.values()].find((x) => x.id === uid);
const zeilenVon = (uid) => [...sb.zeilen.values()].filter((z) => z.user_id === uid);
const zeile = (uid, name) => sb.zeilen.get(`${uid}/${name}`);
const zeileText = (uid, name) => zeile(uid, name)?.inhalt ?? '';
const nutzerId = (email) => sb.nutzer.get(email)?.id;
const freigabeFuer = (besitzer, boardId, gastId) => sb.freigaben.find((f) => f.besitzer === besitzer && f.board_id === boardId && f.gast_id === gastId);
const istGeteiltMit = (besitzer, name, gastId) => { const m = /^board-(.+)\.json$/.exec(name); return !!m && !!freigabeFuer(besitzer, m[1], gastId); };
/** Realtime: an alle Kanäle, deren Filter die Zeile sehen dürfen (RLS nachgestellt) */
const melden = (uid, name, type, tabelle = 'konto_dateien', zeileRoh = null) => {
  for (const s of sb.sockets) {
    if (!s.uid) continue;
    const passt = (s.filter ?? []).some((f) => {
      if (f.table !== tabelle) return false;
      if (tabelle === 'konto_dateien') {
        if (f.filter !== `user_id=eq.${uid}`) return false;
        return s.uid === uid || istGeteiltMit(uid, name, s.uid);
      }
      const [, feld, wert] = /^(\w+)=eq\.(.+)$/.exec(f.filter ?? '') ?? [];
      return !!zeileRoh && zeileRoh[feld] === wert;
    });
    if (!passt) continue;
    const record = tabelle === 'konto_dateien' ? { name, user_id: uid } : zeileRoh;
    s.ws.send(JSON.stringify({ topic: 'realtime:konto', event: 'postgres_changes', payload: { ids: [1], data: { type, schema: 'public', table: tabelle, record, old_record: record } }, ref: null }));
  }
};
const schreib = (uid, name, inhalt, mime, groesse) => {
  const z = zeile(uid, name);
  const neu = z ? Object.assign(z, { inhalt, mime, groesse, version: z.version + 1, updated_at: new Date().toISOString() })
    : { user_id: uid, name, inhalt, mime, groesse, version: 1, updated_at: new Date().toISOString() };
  sb.zeilen.set(`${uid}/${name}`, neu);
  melden(uid, name, z ? 'UPDATE' : 'INSERT');
  return neu;
};
async function dienste(ctx) {
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method();
    const pfad = url.pathname;
    const body = () => { try { return JSON.parse(req.postData() ?? '{}'); } catch { return {}; } };
    const eq = (k) => /^eq\.(.+)$/.exec(url.searchParams.get(k) ?? '')?.[1];
    if ((req.headers()['apikey'] ?? '') !== SB_KEY) return json(route, 401, { message: 'No API key found in request' });
    // ---- Auth ----
    if (pfad === '/auth/v1/signup' && m === 'POST') {
      const { email, password } = body();
      const u = { id: sb.nutzer.get(email)?.id ?? `uid-${++sb.n}`, email, passwort: password };
      sb.nutzer.set(email, u);
      return json(route, 200, sitzungFuer(u));
    }
    if (pfad === '/auth/v1/token' && m === 'POST') {
      const art = url.searchParams.get('grant_type');
      if (art === 'password') {
        const { email, password } = body();
        const u = sb.nutzer.get(email);
        if (!u || u.passwort !== password) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return json(route, 200, sitzungFuer(u));
      }
      if (art === 'refresh_token') {
        const uid = sb.refresh.get(body().refresh_token);
        if (!uid) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        return json(route, 200, sitzungFuer(nutzerVon(uid)));
      }
    }
    if (pfad === '/auth/v1/user' && m === 'GET') { const uid = uidAus(req); return uid ? json(route, 200, { id: uid, email: nutzerVon(uid)?.email }) : json(route, 401, {}); }
    if (pfad === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    // ---- M364: Gäste ohne Konto — nur das Token zählt (öffentlicher Schlüssel genügt) ----
    if (/^\/rest\/v1\/rpc\/gast_/.test(pfad) && m === 'POST') {
      if (sb.ohneGast) return json(route, 404, { code: 'PGRST202', message: 'Could not find the function' });
      const b = body();
      const e = sb.einladungen.find((x) => x.token === b.p_token && x.ohne_konto);
      const name = e && `board-${e.board_id}.json`;
      const z = e && zeile(e.besitzer, name);
      if (pfad.endsWith('/gast_lesen')) {
        sb.aufrufe.gastLesen += 1;
        if (!z) return json(route, 200, null);
        return json(route, 200, { board_id: e.board_id, rolle: e.rolle, besitzer: e.besitzer, inhalt: z.inhalt, version: z.version, dateien: e.dateien ?? [], kanal: kanalVon(e.besitzer, e.board_id), optionen: e.optionen ?? {} });
      }
      if (pfad.endsWith('/gast_stand')) {
        sb.aufrufe.gastStand += 1;
        return json(route, 200, z ? { version: z.version, rolle: e.rolle, optionen: e.optionen ?? {} } : null);
      }
      if (pfad.endsWith('/gast_aendern')) {
        if (sb.ohneAendern) return json(route, 404, { code: 'PGRST202', message: 'Could not find the function' });
        if (!z || e.rolle !== 'bearbeiten') { sb.aufrufe.gastAbgelehnt += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
        sb.aufrufe.gastAendern += 1;
        return json(route, 200, serverAendern(e, b.p_patch));
      }
      if (pfad.endsWith('/gast_schreiben')) {
        if (!z || e.rolle !== 'bearbeiten') { sb.aufrufe.gastAbgelehnt += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
        if (b.p_wenn_version == null || String(z.version) !== String(b.p_wenn_version)) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
        {
          // M365: wie gast_schreiben auf dem Server — Karten, die nicht von einem Gast per Link stammen
          const recht = e.optionen?.gastRecht ?? 'alles';
          if (recht !== 'alles') {
            const alt = JSON.parse(z.inhalt).nodes ?? []; const nn = JSON.parse(b.p_inhalt).nodes ?? [];
            const N = new Map(nn.map((n) => [n.id, n])); const A = new Map(alt.map((n) => [n.id, n]));
            const gast = (n) => String(n.data?.von ?? '').startsWith('g:');
            const J = (x) => JSON.stringify(x ?? null);
            const verstoss = alt.some((x) => { if (gast(x)) return false; const n = N.get(x.id); return !n || !!n.archived !== !!x.archived || n.data?.von !== x.data?.von || (recht === 'eigenes' && (J(n.data) !== J(x.data) || J(n.position) !== J(x.position))); })
              || nn.some((n) => !A.has(n.id) && !gast(n));
            if (verstoss) { sb.aufrufe.nichtErlaubt += 1; return json(route, 400, { code: 'P0004', message: 'nicht erlaubt' }); }
          }
        }
        sb.aufrufe.gastSchreiben += 1;
        const neu = schreib(e.besitzer, name, b.p_inhalt, 'application/json', String(b.p_inhalt).length);
        const um = zeile(e.besitzer, 'umgebung.json');
        if (um) { const u = JSON.parse(um.inhalt); u.boards[e.board_id] = b.p_stempel; u.savedAt = new Date().toISOString(); u.basisEtag = String(um.version); schreib(e.besitzer, 'umgebung.json', JSON.stringify(u), 'application/json', 0); }
        return json(route, 200, neu.version);
      }
    }
    const uid = uidAus(req);
    if (!uid) return json(route, 401, { message: 'JWT expired' });
    const ich = nutzerVon(uid);
    if (pfad === '/rest/v1/rpc/board_kanal' && m === 'POST') {
      const b = body();
      if (b.p_besitzer !== uid && !freigabeFuer(b.p_besitzer, b.p_board_id, uid)) return json(route, 200, null);
      return json(route, 200, { kanal: kanalVon(b.p_besitzer, b.p_board_id), optionen: sb.einladungen.find((x) => x.besitzer === b.p_besitzer && x.board_id === b.p_board_id)?.optionen ?? {} });
    }
    // ---- RPCs ----
    if (pfad === '/rest/v1/rpc/konto_schreiben' && m === 'POST') {
      sb.aufrufe.stapel += 1;
      const b = body();
      const alt = zeile(uid, 'umgebung.json');
      const wenn = b.p_wenn_version;
      if ((wenn === null && alt) || (wenn !== null && String(alt?.version ?? '') !== String(wenn))) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
      if ((b.p_dateien ?? []).some((d) => d.name === 'board-bx.json')) sb.aufrufe.besitzerBoard += 1;
      for (const d of b.p_dateien ?? []) schreib(uid, d.name, d.inhalt ?? '', d.mime ?? 'application/json', d.groesse ?? 0);
      const u = schreib(uid, 'umgebung.json', b.p_umgebung, 'application/json', String(b.p_umgebung ?? '').length);
      return json(route, 200, u.version);
    }
    if (pfad === '/rest/v1/rpc/freigaben_annehmen' && m === 'POST') {
      let n = 0;
      for (const f of sb.freigaben) {
        if (!f.gast_id && f.gast_email.toLowerCase() === (ich?.email ?? '').toLowerCase()) { f.gast_id = uid; n += 1; melden(uid, '', 'UPDATE', 'board_freigaben', f); }
      }
      return json(route, 200, n);
    }
    if (pfad === '/rest/v1/rpc/freigaben_fuer_mich' && m === 'POST') {
      return json(route, 200, sb.freigaben.filter((f) => f.gast_id === uid).map((f) => ({ besitzer: f.besitzer, besitzer_email: nutzerVon(f.besitzer)?.email, board_id: f.board_id, rolle: f.rolle })));
    }
    if (pfad === '/rest/v1/rpc/freigabe_schreiben' && m === 'POST') {
      sb.aufrufe.freigabeSchreiben += 1;
      const b = body();
      const f = freigabeFuer(b.p_besitzer, b.p_board_id, uid);
      if (!f || f.rolle !== 'bearbeiten') { sb.aufrufe.keineFreigabe += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
      const name = `board-${b.p_board_id}.json`;
      const alt = zeile(b.p_besitzer, name);
      if (b.p_wenn_version !== null && String(alt?.version ?? '') !== String(b.p_wenn_version)) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
      const neu = schreib(b.p_besitzer, name, b.p_inhalt, 'application/json', String(b.p_inhalt).length);
      const um = zeile(b.p_besitzer, 'umgebung.json');
      if (um) { const u = JSON.parse(um.inhalt); u.boards[b.p_board_id] = b.p_stempel; u.savedAt = new Date().toISOString(); schreib(b.p_besitzer, 'umgebung.json', JSON.stringify(u), 'application/json', 0); }
      return json(route, 200, neu.version);
    }
    // ---- board_freigaben ----
    if (pfad === '/rest/v1/board_freigaben') {
      const sichtbar = sb.freigaben.filter((f) => f.besitzer === uid || f.gast_id === uid || f.gast_email.toLowerCase() === (ich?.email ?? '').toLowerCase());
      const filt = (liste) => liste.filter((f) => (!eq('board_id') || f.board_id === eq('board_id')) && (!eq('besitzer') || f.besitzer === eq('besitzer')) && (!eq('gast_id') || f.gast_id === eq('gast_id')) && (!eq('id') || f.id === eq('id')));
      if (m === 'GET') return json(route, 200, filt(sichtbar));
      if (m === 'POST') {
        const b = body();
        let f = sb.freigaben.find((x) => x.besitzer === uid && x.board_id === b.board_id && x.gast_email === b.gast_email);
        if (!f) { f = { id: `fg-${++sb.n}`, besitzer: uid, board_id: b.board_id, gast_email: b.gast_email, gast_id: null, rolle: b.rolle ?? 'bearbeiten', created_at: new Date().toISOString() }; sb.freigaben.push(f); melden(uid, '', 'INSERT', 'board_freigaben', f); }
        return json(route, 201, [f]);
      }
      if (m === 'PATCH') {
        for (const f of filt(sb.freigaben.filter((x) => x.besitzer === uid))) { Object.assign(f, { rolle: body().rolle }); melden(uid, '', 'UPDATE', 'board_freigaben', f); }
        return route.fulfill({ status: 204, body: '' });
      }
      if (m === 'DELETE') {
        const weg = filt(sb.freigaben.filter((f) => f.besitzer === uid || f.gast_id === uid));
        sb.freigaben = sb.freigaben.filter((f) => !weg.includes(f));
        for (const f of weg) melden(uid, '', 'DELETE', 'board_freigaben', f);
        return route.fulfill({ status: 204, body: '' });
      }
    }
    // ---- board_einladungen (M360) ----
    if (pfad === '/rest/v1/board_einladungen') {
      if (sb.ohneEinladung) return json(route, 404, { code: 'PGRST205', message: "Could not find the table 'public.board_einladungen'" });
      const meine = () => sb.einladungen.filter((e) => e.besitzer === uid && (!eq('board_id') || e.board_id === eq('board_id')));
      if (m === 'GET') return json(route, 200, meine());
      if (m === 'POST') {
        const b = body();
        let e = sb.einladungen.find((x) => x.besitzer === uid && x.board_id === b.board_id);
        if (e) Object.assign(e, { rolle: b.rolle }); else { e = { token: b.token, besitzer: uid, board_id: b.board_id, rolle: b.rolle ?? 'bearbeiten', created_at: new Date().toISOString(), ohne_konto: false, dateien: [] }; sb.einladungen.push(e); }
        if ('ohne_konto' in b) e.ohne_konto = !!b.ohne_konto;
        if ('optionen' in b) e.optionen = b.optionen;
        return json(route, 201, [e]);
      }
      if (m === 'PATCH') { for (const e of sb.einladungen.filter((x) => x.besitzer === uid && x.token === eq('token'))) Object.assign(e, body()); return route.fulfill({ status: 204, body: '' }); }
      if (m === 'DELETE') { const weg = meine(); sb.einladungen = sb.einladungen.filter((e) => !weg.includes(e)); return route.fulfill({ status: 204, body: '' }); }
    }
    if (pfad === '/rest/v1/rpc/einladung_annehmen' && m === 'POST') {
      if (sb.ohneEinladung) return json(route, 404, { message: 'Could not find the function' });
      const e = sb.einladungen.find((x) => x.token === body().p_token);
      if (!e) return json(route, 200, null);
      if (e.besitzer === uid) return json(route, 200, { board_id: e.board_id, rolle: e.rolle, eigen: true });
      const mail = (ich?.email ?? '').toLowerCase();
      let f = sb.freigaben.find((x) => x.besitzer === e.besitzer && x.board_id === e.board_id && x.gast_email === mail);
      if (f) f.gast_id = uid; else { f = { id: `fg-${++sb.n}`, besitzer: e.besitzer, board_id: e.board_id, gast_email: mail, gast_id: uid, rolle: e.rolle, created_at: new Date().toISOString() }; sb.freigaben.push(f); }
      melden(uid, '', 'INSERT', 'board_freigaben', f);
      return json(route, 200, { board_id: e.board_id, rolle: f.rolle, eigen: false, besitzer_email: nutzerVon(e.besitzer)?.email });
    }
    // ---- konto_dateien ----
    if (pfad === '/rest/v1/konto_dateien') {
      const fName = eq('name');
      const fUser = eq('user_id');
      const select = (url.searchParams.get('select') ?? '*').split(',');
      const projiziere = (z) => (select.includes('*') ? z : Object.fromEntries(select.map((k) => [k, z[k]])));
      let treffer;
      if (fUser && fUser !== uid) treffer = zeilenVon(fUser).filter((z) => istGeteiltMit(fUser, z.name, uid));
      else treffer = zeilenVon(uid);
      if (fName !== undefined) treffer = treffer.filter((z) => z.name === fName);
      if (m === 'GET') return json(route, 200, treffer.map(projiziere));
      if (m === 'DELETE') { for (const z of treffer) if (z.user_id === uid) sb.zeilen.delete(`${uid}/${z.name}`); return route.fulfill({ status: 204, body: '' }); }
      return json(route, 405, { message: 'nur GET/DELETE im Mock' });
    }
    return json(route, 404, { message: `unbekannt: ${m} ${pfad}` });
  });
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const eintrag = { ws, uid: null, filter: [] };
    sb.sockets.push(eintrag);
    ws.onMessage((roh) => {
      const j = JSON.parse(String(roh));
      // ---- M364: Broadcast + Presence auf den Board-Kanälen ----
      if (typeof j.topic === 'string' && j.topic.startsWith('realtime:pn-')) {
        if (j.event === 'phx_join') {
          if (sb.ohneLive) return;
          const l = { ws, topic: j.topic, key: j.payload?.config?.presence?.key ?? `k${++sb.n}`, meta: null };
          sb.live.push(l); eintrag.live = l;
          ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: [] } }, ref: j.ref }));
          const state = {};
          for (const s of sb.live) if (s.topic === j.topic && s.meta) state[s.key] = { metas: [s.meta] };
          ws.send(JSON.stringify({ topic: j.topic, event: 'presence_state', payload: state, ref: null }));
        } else if (j.event === 'presence' && j.payload?.event === 'track' && eintrag.live) {
          const l = eintrag.live;
          const alt = l.meta; l.meta = j.payload.payload;
          liveAn(l.topic, { topic: l.topic, event: 'presence_diff', payload: { joins: { [l.key]: { metas: [l.meta] } }, leaves: alt ? { [l.key]: { metas: [alt] } } : {} }, ref: null });
        } else if (j.event === 'broadcast' && eintrag.live) {
          if (j.payload?.event === 'karte') sb.aufrufe.karte += 1;
          if (j.payload?.event === 'stand') sb.aufrufe.stand += 1;
          if (j.payload?.event === 'delta') sb.aufrufe.delta += 1;
          if (j.payload?.event === 'reakt') sb.aufrufe.reakt = (sb.aufrufe.reakt ?? 0) + 1;
          if (j.payload?.event === 'timer') sb.aufrufe.timer = (sb.aufrufe.timer ?? 0) + 1;
          liveAn(eintrag.live.topic, { topic: eintrag.live.topic, event: 'broadcast', payload: j.payload, ref: null }, eintrag.live);
        }
        return;
      }
      if (j.event === 'phx_join') {
        const e = sb.tokens.get(j.payload?.access_token);
        eintrag.uid = e?.uid ?? null;
        eintrag.filter = j.payload?.config?.postgres_changes ?? [];
        ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: eintrag.filter.map((_, i) => ({ id: i + 1 })) } }, ref: j.ref }));
      } else if (j.event === 'heartbeat') {
        ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: j.ref }));
      } else if (j.event === 'access_token') {
        const e = sb.tokens.get(j.payload?.access_token); if (e) eintrag.uid = e.uid;
      }
    });
    ws.onClose(() => {
      sb.sockets = sb.sockets.filter((s) => s !== eintrag);
      const l = eintrag.live;
      if (l) { sb.live = sb.live.filter((s) => s !== l); if (l.meta) liveAn(l.topic, { topic: l.topic, event: 'presence_diff', payload: { joins: {}, leaves: { [l.key]: { metas: [l.meta] } } }, ref: null }); }
    });
  });
}

const gruppeAuf = async (P) => { if (!(await P.locator('[data-taste="live-liste"]').count()) && (await P.locator('[data-taste="live-auf"]').count())) { await P.locator('[data-taste="live-auf"]').click(); await P.waitForTimeout(250); } };
const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const texte = (P) => zustand(P).then((s) => JSON.stringify(s.boards));
const boardVon = (P, id) => zustand(P).then((s) => s.boards.find((b) => b.id === id));
async function warteBis(P, fn, ms = 16000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(200); }
  return fn();
}
async function kontoPanel(P) {
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
  await P.locator('.seg-weg button', { hasText: 'Konto' }).click(); await P.waitForTimeout(300);
}
async function schliessen(P) { await P.keyboard.press('Escape'); await P.waitForTimeout(500); }
async function anmelden(P, email, pass, neu) {
  await kontoPanel(P);
  await P.locator('[data-taste="konto-email"]').fill(email);
  if ((await P.locator('[data-taste="konto-mail"] details[open]').count()) === 0) { await P.locator('[data-taste="konto-mail"] details summary').click(); await P.waitForTimeout(150); }
  await P.locator('[data-taste="konto-pass"]').fill(pass);
  await P.locator(`[data-taste="${neu ? 'konto-neu' : 'konto-passwort'}"]`).click();
  await warteBis(P, async () => (await P.locator('[data-taste="konto-stand"]').count()) > 0, 10000);
  await P.waitForTimeout(400);
  await schliessen(P);
}
async function dialogOeffnen(P, name) {
  const z = P.locator('.tabs.spalte .side-board', { hasText: name }).first();
  await z.hover(); await P.waitForTimeout(200);
  await z.locator('.ebenen-menu-knopf').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="board-freigeben"]').click(); await P.waitForTimeout(600); await P.waitForSelector('[data-taste="einladung-optionen"], [data-taste="freigabe-ohne-konto"], [data-taste="freigabe-verlassen"]', { timeout: 2500 }).catch(() => {}); await P.evaluate(() => document.querySelectorAll('.freigabe-dialog details').forEach((d) => { d.open = true; }));
}
const zahl = (P) => P.locator('[data-taste="live-zahl"]').textContent().catch(() => '');
const uhr = (P) => P.evaluate(() => {
  const el = document.querySelector('[data-taste="timer-chip"]');
  if (!el) return null;
  const zeit = el.querySelector('[data-taste="timer-zeit"]').textContent;
  const t = zeit.split(':').map(Number);
  const sek = /^\d+(:\d\d){1,2}$/.test(zeit) ? t.reduce((a, b) => a * 60 + b, 0) : null;
  return { zeit, sek, von: el.querySelector('.gruppen-timer-von').textContent, um: el.classList.contains('um') };
});
const feld = (P) => P.locator('[data-taste="timer-eingabe"]');
const info = (P) => P.locator('[data-taste="timer-frei-info"]').textContent().catch(() => '');
/** Liste der Gruppe öffnen, Dauer ins freie Feld tippen; mit start=true auch abschicken (Enter) */
async function eingeben(P, text, { start = false, enter = true } = {}) {
  await gruppeAuf(P);
  await warteBis(P, async () => (await feld(P).count()) === 1, 6000);
  await feld(P).fill('');
  await feld(P).pressSequentially(text, { delay: 15 });
  await P.waitForTimeout(120);
  if (start) {
    if (enter) await feld(P).press('Enter');
    else await P.locator('[data-taste="timer-frei-start"]').click();
    await P.waitForTimeout(250);
  }
}


// ══ B ═══════════════════════════════════════════════════════════════
// Timer für alle über den Live-Kanal — Supabase im Node-Prozess nachgebaut (Gerüst aus m376/m512)
console.log('\n════ B: Timer für alle überlebt das Neuladen beim Starter ════');
const note = (id, text, x = 60, y = 60) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const standTeam = { boards: [board('bx', 'Planung', [note('x1', 'Erste Notiz', 40, 60)])], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }], activeId: 'bx', view: 'board' };
const standB = { boards: [board('bz', 'Nur hier', [note('z1', 'Z Notiz')])], spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }], activeId: 'bz', view: 'board' };
async function geraet(name, stand, anker = '') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await dienste(ctx);
  await ctx.addInitScript(({ st, konfig }) => {
    if (window !== window.top) return;
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, konfig: { url: SB_URL, key: SB_KEY } });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log(`    PAGEERROR[${name}]:`, e.message.slice(0, 300)); });
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/${anker}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, name };
}
{
  const A = await geraet('A', standTeam);
  await anmelden(A.P, 'anna@example.de', 'geheim123', true);
  const uidA = nutzerId('anna@example.de');
  await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
  await dialogOeffnen(A.P, 'Planung');
  await A.P.locator('[data-taste="einladung-anlegen"]').click();
  await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
  const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
  await schliessen(A.P);
  await warteBis(A.P, () => sb.live.length >= 1, 8000);
  const G = await geraet('G', standB, `#e=${token}`);
  await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 15000);
  await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
  await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
  await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 15000);
  await warteBis(A.P, async () => /2 dabei/.test(await zahl(A.P)), 15000);

  // 2 Minuten starten, dann lädt Anna (die Starterin) neu
  await eingeben(A.P, '2', { start: true });
  await warteBis(G.P, async () => !!(await uhr(G.P)), 8000);
  const vorA = await uhr(A.P); const vorG = await uhr(G.P);
  pruefe('B1 Anna startet 2 Minuten, bei beiden läuft die Uhr', vorA && vorG && vorA.sek >= 110 && Math.abs(vorA.sek - vorG.sek) <= 2, `${vorA?.zeit} / ${vorG?.zeit}`);
  await A.P.waitForTimeout(3000);
  await A.P.reload({ waitUntil: 'networkidle' });
  const zurueck = await warteBis(A.P, async () => !!(await uhr(A.P)), 15000);
  const nachA = await uhr(A.P); const nachG = await uhr(G.P);
  console.log('    nach dem Neuladen:', JSON.stringify(nachA), '/', JSON.stringify(nachG));
  pruefe('B2 nach dem Neuladen läuft die Uhr bei Anna weiter – dieselbe Restzeit wie bei Gerd (nicht von vorn)', zurueck && nachA && nachG && nachA.sek < vorA.sek - 2 && Math.abs(nachA.sek - nachG.sek) <= 2 && nachA.von === 'von dir', `${nachA?.zeit} / ${nachG?.zeit}`);
  await A.P.waitForTimeout(2200);
  const weiterA = await uhr(A.P); const weiterG = await uhr(G.P);
  pruefe('B3 … sie zählt weiter herunter, bei Gerd im Gleichschritt', weiterA && weiterA.sek < nachA.sek && Math.abs(weiterA.sek - weiterG.sek) <= 2, `${weiterA?.zeit} / ${weiterG?.zeit}`);
  // Gerd hält an → Anna lädt neu → kein Timer kommt zurück
  await gruppeAuf(G.P);
  await G.P.locator('[data-taste="timer-stopp"]').click();
  await warteBis(A.P, async () => !(await uhr(A.P)), 8000);
  await A.P.reload({ waitUntil: 'networkidle' });
  await warteBis(A.P, async () => /2 dabei/.test(await zahl(A.P)), 15000);
  await A.P.waitForTimeout(3500);
  pruefe('B4 angehalten (von Gerd) und neu geladen: bei Anna und Gerd kommt kein Timer zurück', !(await uhr(A.P)) && !(await uhr(G.P)), `${JSON.stringify(await uhr(A.P))} / ${JSON.stringify(await uhr(G.P))}`);
  // Abgelaufen während des Neuladens: 10 Sekunden, dann erst nach Ablauf neu laden
  await eingeben(A.P, '10s', { start: true });
  await warteBis(A.P, async () => !!(await uhr(A.P)), 5000);
  await warteBis(A.P, async () => (await uhr(A.P))?.um === true || !(await uhr(A.P)), 16000);
  await A.P.waitForTimeout(9000);
  await A.P.reload({ waitUntil: 'networkidle' });
  await warteBis(A.P, async () => /2 dabei/.test(await zahl(A.P)), 15000);
  await A.P.waitForTimeout(3500);
  const spaet = await uhr(A.P);
  pruefe('B5 lief der Timer während des Neuladens ab, ist er danach vorbei (keine Uhr mehr)', !spaet, JSON.stringify(spaet));
  await A.P.screenshot({ path: path.join(BILDER, 'timer.png') });
  await A.ctx.close(); await G.ctx.close();
}

// ══ I ═══════════════════════════════════════════════════════════════
console.log('\n════ I: Texte ════');
{
  const de = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const en = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  pruefe('I1 „Was ist neu" DE und EN nennen M531', /M531/.test(de) && /M531/.test(en));
  const wb = JSON.parse(readFileSync(path.join(__repo, 'src/sprache/en.json'), 'utf8'));
  const fehlt = ['„Bis" liegt vor „Von". Zeiten tauschen oder für mehrere Tage ein Bis-Datum setzen.', 'Tauschen'].filter((k) => !wb[k]);
  pruefe('I2 Wörterbuch: neue Texte haben eine englische Fassung', fehlt.length === 0, fehlt);
  pruefe('I3 Meilenstein-Datei docs/meilensteine/M531-karten.md', existsSync(path.join(__repo, 'docs/meilensteine/M531-karten.md')));
  pruefe('I4 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3));
}

await browser.close(); app.close();
console.log(`\nM531: ${ok} ok, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
