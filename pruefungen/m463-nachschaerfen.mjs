/**
 * M463 — Nachschärfen der Runde 1 (offene Punkte aus M444, M445, M453, M457).
 *
 *   A  M445 „Nicht mit ordnen": Eigenschaft im ⋯ der Karte; im Fokus dezent sichtbar; „Nach Themen ordnen" schickt die
 *      Karte nicht an die KI und lässt sie liegen; die Meldung nennt sie; zurückschalten geht im selben Menü.
 *   B  M457 Kontakt über den Namen: vorhandener Kontakt „Berg, Anna" (andere Adresse) wird ergänzt – die Adresse aus der
 *      Mail kommt als weitere E-Mail dazu, kein zweiter Kontakt; „Anna Bergmann" bleibt unberührt; Umlaute/Titel/Groß-
 *      Klein zählen nicht („JUERGEN WEISS" = „Dr. Jürgen Weiß").
 *      M451 Destillat: danach bietet die Mail „Absender als Kontakt" an – derselbe Weg, danach verschwindet das Angebot.
 *   C  M453 Änderungszeit: leise Zeile im ⋯ der Karte (kein Knopf), „Änderung unbekannt" ohne Zeit; ein ersetztes Bild
 *      stempelt; der Destillat-Merker stempelt die Mail nicht; über den MCP-Server angelegte Karten tragen die Zeit.
 *   D  M444 Briefing ohne KI: Risiken nennen die überfällige Frist mit Namen und Dauer, ein Ticket lange „In Arbeit"
 *      und einen Pfeil „blockiert" – nicht das frisch bewegte Ticket, nicht den harmlosen Pfeil.
 *   E  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m463-nachschaerfen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5463;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 700) : JSON.stringify(info).slice(0, 700)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

const TAG = 86_400_000;
const JETZT = Date.now();
const iso = (tage) => { const d = new Date(); d.setDate(d.getDate() + tage); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const absatz = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] });
const notiz = (id, x, y, text, extra = {}) => ({ id, type: 'note', position: { x, y }, width: 240, height: 120, autoFit: false, data: { color: 'yellow', blocks: [absatz(text)] }, ...extra });

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
/** Seite mit Board; `ki` = Chat-KI eingerichtet, `antwort(prompt)` = abgefangene Antwort */
const auf = async ({ nodes = [], edges = [], ki = false, fokus = false, antwort = () => ({}) } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([nn, ee, mitKi, mitFokus]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Nachschärfen', edges: ee, drawings: [], nodes: nn, comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: mitFokus, navLinks: false, clickZoom: false, physicsEnabled: false,
      ai: mitKi ? { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } : { provider: 'none', model: '', apiKey: '', baseUrl: '' },
      brain: { on: false, provider: 'auto' } } }));
  }, [nodes, edges, ki, fokus]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const aufrufe = [];
  await P.route(/chat\/completions|api\/generate|anthropic|pollinations|openrouter/, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const c = body.messages?.[0]?.content;
    const text = typeof c === 'string' ? c : (c ?? []).map((x) => x.text ?? '').join('\n');
    aufrufe.push(text);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(antwort(text)) }, finish_reason: 'stop' }] }) });
  });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, aufrufe };
};
const stand = async (P) => { await P.waitForTimeout(900); return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]); };
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const waehle = async (P, id) => {
  await P.keyboard.press('Escape');
  await P.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 30, y: 40 } });
  await P.waitForTimeout(300);
};
/** Karte wählen und ihr ⋯ öffnen */
const mehr = async (P, id) => {
  await waehle(P, id);
  await P.locator('[data-taste="auswahl-mehr"]').click();
  await P.waitForTimeout(300);
};
const fokusZeile = async (P, id) => {
  // wie m453: ein Klick-Ereignis wählt die Karte, ohne den Editor zu fokussieren – Enter öffnet dann den Fokus
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  await P.evaluate((i) => { const el = [...document.querySelectorAll('.react-flow__node')].find((e) => e.dataset.id === i); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, id);
  await P.waitForTimeout(250);
  await P.evaluate(() => document.activeElement?.blur());
  if (!(await P.locator('.focus-title').count())) { await P.keyboard.press('Enter'); await P.waitForTimeout(700); }
  if (!(await P.locator('.focus-title').count())) { await P.locator(`.react-flow__node[data-id="${id}"]`).click({ button: 'right', position: { x: 3, y: 3 } }); await P.waitForTimeout(400); await P.locator('.sel-more-menu button', { hasText: 'Öffnen' }).first().click().catch(() => {}); await P.waitForTimeout(800); }
  const z = await P.evaluate(() => ({ zeile: document.querySelector('.focus-title span')?.textContent ?? '', marke: document.querySelector('.focus-title .focus-ohne-ordnen')?.getAttribute('title') ?? '' }));
  await P.keyboard.press('Escape'); await P.waitForTimeout(500);
  return z;
};
const eml = ({ von, betreff, text }) => [
  `From: ${von}`, 'To: Team <team@beispiel.de>', `Subject: ${betreff}`, 'Date: Mon, 16 Nov 2026 09:30:00 +0100',
  'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text,
].join('\r\n');
/** .eml aufs Board legen; liefert die NEUE E-Mail-Karte */
const ablegen = async (P, inhalt, x = 300, y = 250) => {
  const vorher = new Set((await stand(P)).nodes.map((n) => n.id));
  await P.evaluate(([text, cx, cy]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'post.eml', { type: 'message/rfc822' }));
    const ziel = document.querySelector('.react-flow__pane');
    for (const art of ['dragover', 'drop']) ziel.dispatchEvent(new DragEvent(art, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
  }, [inhalt, x, y]);
  await P.waitForTimeout(1800);
  return (await stand(P)).nodes.find((n) => n.type === 'email' && !vorher.has(n.id));
};
const alsKontakt = async (P, mailId) => {
  const vorher = await toast(P);
  await P.locator(`.react-flow__node[data-id="${mailId}"] h3`).click({ button: 'right' });
  await P.waitForTimeout(450);
  const eintrag = P.locator('.sel-more-menu [data-taste="absender-kontakt"]');
  if (!(await eintrag.count())) return '(kein Eintrag im Menü)';
  await eintrag.click();
  await P.waitForFunction((alt) => { const t = document.querySelector('.toast')?.textContent ?? ''; return /Kontakt|Absender/.test(t) && t !== alt; }, vorher, { timeout: 8000 }).catch(() => {});
  return toast(P);
};

// ---------- A: Nicht mit ordnen ----------
console.log('A  „Nicht mit ordnen" (M445)');
{
  const KARTEN = [
    notiz('r1', 60, 80, 'Urlaub Mallorca planen'), notiz('f1', 360, 60, 'Budget Rechnung Q3'), notiz('r2', 700, 120, 'Flug nach Mallorca buchen'),
    notiz('f2', 120, 340, 'Rechnung Lieferant prüfen'), notiz('r3', 460, 380, 'Hotel Mallorca am Strand'), notiz('f3', 820, 360, 'Rechnung Steuer Termin'),
    notiz('pin', 1100, 600, 'Legende Mallorca Rechnung'),
  ];
  const { ctx, P, aufrufe } = await auf({ nodes: KARTEN, ki: true, fokus: true, antwort: () => ({ themen: [{ titel: 'Reise', ids: ['r1', 'r2', 'r3', 'pin'] }, { titel: 'Finanzen', ids: ['f1', 'f2', 'f3'] }] }) });
  await mehr(P, 'pin');
  const knopf = P.locator('.sel-more-menu [data-taste="ohne-ordnen"]');
  const beschriftung = (await knopf.textContent().catch(() => '')) ?? '';
  pruefe('A1 im ⋯ der Karte steht „Nicht mit ordnen"', /Nicht mit ordnen/.test(beschriftung), beschriftung);
  await knopf.click().catch(() => {});
  let b = await stand(P);
  pruefe('A2 die Karte trägt danach die Eigenschaft – und nur sie', b.nodes.find((n) => n.id === 'pin')?.ohneOrdnen === true && b.nodes.filter((n) => n.ohneOrdnen).length === 1, b.nodes.map((n) => [n.id, n.ohneOrdnen]));
  const fPin = await fokusZeile(P, 'pin');
  const fR1 = await fokusZeile(P, 'r1');
  pruefe('A3 im Fokus dezent „ordnet nicht mit" – bei anderen Karten nicht', /ordnet nicht mit/.test(fPin.zeile) && !!fPin.marke && !/ordnet nicht mit/.test(fR1.zeile), { fPin, fR1 });
  const vorPin = b.nodes.find((n) => n.id === 'pin').position;
  await P.keyboard.press('Escape');
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((x) => x.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((x) => x.textContent.includes('KI-Assistent'))?.click());
  await P.waitForTimeout(300);
  await P.locator('[data-taste="ki-themen-board"]').click();
  await P.locator('.themen-dialog').waitFor({ timeout: 15000 }).catch(() => {});
  const prompt = aufrufe[0] ?? '';
  pruefe('A4 der Auftrag an die KI enthält die ausgenommene Karte nicht', aufrufe.length === 1 && prompt.includes('"id":"r1"') && !prompt.includes('"id":"pin"'), prompt.slice(0, 300));
  await P.locator('[data-taste="themen-ordnen"]').click().catch(() => {});
  await P.waitForTimeout(500);
  const meldung = await toast(P);
  b = await stand(P);
  const pin = b.nodes.find((n) => n.id === 'pin');
  pruefe('A5 geordnet wird, die Karte bleibt liegen, wo sie war', b.nodes.filter((n) => n.type === 'frame').length === 2 && pin.position.x === vorPin.x && pin.position.y === vorPin.y, { pin: pin.position, rahmen: b.nodes.filter((n) => n.type === 'frame').length });
  pruefe('A6 die Meldung nennt die ausgenommene Karte', /nicht mit geordnet: 1 Karte\b/.test(meldung), meldung);
  await mehr(P, 'pin');
  const zurueck = (await knopf.textContent().catch(() => '')) ?? '';
  await knopf.click().catch(() => {});
  b = await stand(P);
  pruefe('A7 dasselbe Menü schaltet zurück („Wieder mit ordnen")', /Wieder mit ordnen/.test(zurueck) && b.nodes.find((n) => n.id === 'pin')?.ohneOrdnen === undefined, { zurueck, pin: b.nodes.find((n) => n.id === 'pin')?.ohneOrdnen });
  pruefe('A8 die Eigenschaft stempelt keine Änderung am Inhalt', b.nodes.find((n) => n.id === 'pin')?.geaendert === undefined, b.nodes.find((n) => n.id === 'pin')?.geaendert);
  await ctx.close();
}

// ---------- B: Kontakt über den Namen, Angebot nach dem Destillat ----------
console.log('B  Kontakt über den Namen (M457) und nach dem Destillat (M451)');
const MAIL_ANNA = eml({
  von: 'Anna Berg <anna.berg@beispiel.de>', betreff: 'Angebot Umbau Halle',
  text: ['Hallo Ben,', '', 'anbei das Angebot.', '', 'Mit freundlichen Grüßen', '', 'Anna Berg', 'Leiterin Einkauf', 'Beispiel Bau GmbH', 'Tel. +49 761 208-1234'].join('\n'),
});
const MAIL_JUERGEN = eml({
  von: 'JUERGEN WEISS <jw@weiss-planung.de>', betreff: 'Pläne',
  text: ['Hallo,', '', 'die Pläne kommen morgen.', '', 'Viele Grüße', '', 'JUERGEN WEISS'].join('\n'),
});
{
  const KONTAKTE = [
    { id: 'kb', type: 'kontakt', position: { x: 900, y: 60 }, width: 300, data: { name: 'Berg, Anna', telefone: [], emails: ['a.berg@privat.de'] } },
    { id: 'kx', type: 'kontakt', position: { x: 900, y: 320 }, width: 300, data: { name: 'Anna Bergmann', telefone: [], emails: ['bergmann@x.de'] } },
    { id: 'kj', type: 'kontakt', position: { x: 900, y: 560 }, width: 300, data: { name: 'Dr. Jürgen Weiß', telefone: [], emails: [] } },
  ];
  const { ctx, P } = await auf({ nodes: KONTAKTE });
  const mail = await ablegen(P, MAIL_ANNA, 260, 200);
  const m1 = await alsKontakt(P, mail?.id);
  let b = await stand(P);
  const kb = b.nodes.find((n) => n.id === 'kb');
  pruefe('B1 kein zweiter Kontakt – „Berg, Anna" wird über den Namen erkannt', b.nodes.filter((n) => n.type === 'kontakt').length === 3, b.nodes.filter((n) => n.type === 'kontakt').map((n) => n.data.name));
  pruefe('B2 die Adresse aus der Mail kommt als weitere E-Mail dazu, die alte bleibt', JSON.stringify(kb?.data.emails) === JSON.stringify(['a.berg@privat.de', 'anna.berg@beispiel.de']), kb?.data.emails);
  pruefe('B3 Meldung nennt die weitere E-Mail, Pfeil Mail → Kontakt', /weitere E-Mail/.test(m1) && b.edges.some((e) => e.source === mail?.id && e.target === 'kb' && e.data?.label === 'Kontakt'), { m1, kanten: b.edges });
  const kx = b.nodes.find((n) => n.id === 'kx');
  pruefe('B4 der ähnlich heißende „Anna Bergmann" bleibt unberührt', JSON.stringify(kx?.data.emails) === JSON.stringify(['bergmann@x.de']) && !b.edges.some((e) => e.target === 'kx'), kx?.data);
  const mail2 = await ablegen(P, MAIL_JUERGEN, 260, 600);
  const m2 = await alsKontakt(P, mail2?.id);
  b = await stand(P);
  const kj = b.nodes.find((n) => n.id === 'kj');
  pruefe('B5 Umlaute, Titel und Großschreibung zählen nicht: „JUERGEN WEISS" ergänzt „Dr. Jürgen Weiß"', b.nodes.filter((n) => n.type === 'kontakt').length === 3 && JSON.stringify(kj?.data.emails) === JSON.stringify(['jw@weiss-planung.de']), { m2, kj: kj?.data });
  await ctx.close();
}
const destillatAntwort = (text) => (text.includes('Absender-Kopf')
  ? { name: 'Anna Berg', funktion: 'Leiterin Einkauf', firma: 'Beispiel Bau GmbH', telefone: [], emails: ['anna.berg@beispiel.de'] }
  : { kern: 'Das Angebot liegt vor.', fragen: [], aufgaben: [{ text: 'Angebot prüfen', wer: 'Ben', frist: '' }], termine: [] });
let mailNachDestillat = null;
{
  const { ctx, P } = await auf({ ki: true, antwort: destillatAntwort });
  const mail = await ablegen(P, MAIL_ANNA, 260, 200);
  pruefe('B6 vor dem Destillat kein Angebot an der Mail', (await P.locator(`.react-flow__node[data-id="${mail?.id}"] [data-taste="kontakt-nach-destillat"]`).count()) === 0);
  await P.locator(`.react-flow__node[data-id="${mail?.id}"] button`, { hasText: 'Destillat' }).click();
  await P.waitForFunction(() => /Destillat als Notiz|KI-Fehler/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
  await P.waitForTimeout(600);
  const angebot = P.locator(`.react-flow__node[data-id="${mail?.id}"] [data-taste="kontakt-nach-destillat"]`);
  pruefe('B7 nach dem Destillat bietet die Mail „Absender als Kontakt" an', (await angebot.count()) === 1 && /Absender als Kontakt/.test(await angebot.textContent()));
  mailNachDestillat = (await stand(P)).nodes.find((n) => n.id === mail?.id);
  await angebot.click().catch(() => {});
  await P.waitForFunction(() => /Kontakt/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  const b = await stand(P);
  const k = b.nodes.find((n) => n.type === 'kontakt');
  pruefe('B8 derselbe Weg wie im ⋯: Kontakt mit Pfeil „Kontakt" neben der Mail', k?.data.name === 'Anna Berg' && k?.data.firma === 'Beispiel Bau GmbH' && b.edges.some((e) => e.source === mail?.id && e.target === k?.id && e.data?.label === 'Kontakt'), { k: k?.data, kanten: b.edges.map((e) => e.data?.label) });
  pruefe('B9 danach verschwindet das Angebot (ein Kontakt hängt an der Mail)', (await P.locator(`.react-flow__node[data-id="${mail?.id}"] [data-taste="kontakt-nach-destillat"]`).count()) === 0);
  await ctx.close();
}

// ---------- C: Änderungszeit ----------
console.log('C  Änderungszeit (M453)');
/** Ein PNG (w × h) – ohne Bibliothek */
function png(w, h) {
  const crcTab = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const stueck = (typ, daten) => { const kopf = Buffer.alloc(8); kopf.writeUInt32BE(daten.length, 0); kopf.write(typ, 4, 'latin1'); const pruef = Buffer.alloc(4); pruef.writeUInt32BE(crc(Buffer.concat([kopf.subarray(4), daten])), 0); return Buffer.concat([kopf, daten, pruef]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const roh = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; roh[i] = Math.round(255 * x / w); roh[i + 1] = Math.round(255 * y / h); roh[i + 2] = 140; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), stueck('IHDR', ihdr), stueck('IDAT', deflateSync(roh)), stueck('IEND', Buffer.alloc(0))]);
}
{
  const ALT = JETZT - 40 * TAG;
  const { ctx, P } = await auf({ nodes: [
    notiz('c1', 60, 60, 'Vor drei Tagen geändert', { angelegt: JETZT - 10 * TAG, geaendert: JETZT - 3 * TAG }),
    notiz('c2', 360, 60, 'Aus einem alten Stand'),
    { id: 'bild', type: 'image', width: 400, height: 200, position: { x: 60, y: 320 }, angelegt: ALT, geaendert: ALT, data: { src: `data:image/png;base64,${png(400, 200).toString('base64')}`, name: 'verlauf.png' } },
  ] });
  await mehr(P, 'c1');
  const zeile = await P.evaluate(() => { const el = document.querySelector('.sel-more-menu [data-zeit]'); return el ? { text: el.textContent, tag: el.tagName, rolle: el.getAttribute('role'), tipp: el.getAttribute('title') ?? '', letzte: el === el.parentElement?.lastElementChild } : null; });
  pruefe('C1 im ⋯ der Karte eine leise Zeile „Geändert vor 3 Tagen" (genaue Zeit im Tooltip)', zeile?.text === 'Geändert vor 3 Tagen' && /Zuletzt geändert: \d/.test(zeile.tipp), zeile);
  pruefe('C2 die Zeile ist kein Knopf und steht ganz unten', !!zeile && zeile.tag !== 'BUTTON' && zeile.rolle !== 'menuitem' && zeile.letzte, zeile);
  await mehr(P, 'c2');
  const unbekannt = await P.evaluate(() => document.querySelector('.sel-more-menu [data-zeit]')?.textContent ?? '');
  pruefe('C3 ohne Zeitpunkt: „Änderung unbekannt"', unbekannt === 'Änderung unbekannt', unbekannt);
  await waehle(P, 'bild');
  await P.locator('.react-flow__node[data-id="bild"] [data-taste="bild-bearbeiten-auf"]').click().catch(() => {});
  await P.waitForSelector('.bild-editor .be-blatt canvas', { timeout: 6000 }).catch(() => {});
  await P.waitForTimeout(500);
  await P.locator('[data-taste="be-format"][data-format="1:1"]').click().catch(() => {});
  await P.waitForTimeout(200);
  await P.locator('[data-taste="be-fertig"]').click().catch(() => {});
  await P.waitForSelector('.bild-editor', { state: 'detached', timeout: 8000 }).catch(() => {});
  const bild = (await stand(P)).nodes.find((n) => n.type === 'image');
  pruefe('C4 ein ersetztes Bild (Bild bearbeiten) stempelt die Karte', !!bild && bild.data.src !== '' && Math.abs((bild.geaendert ?? 0) - Date.now()) < 120_000 && bild.angelegt === ALT, { g: bild?.geaendert, a: bild?.angelegt });
  await ctx.close();
}
pruefe('C5 der Destillat-Merker stempelt die Mail nicht (die Mail selbst blieb unverändert)', !!mailNachDestillat?.data?.destillat && typeof mailNachDestillat.angelegt === 'number' && mailNachDestillat.geaendert === mailNachDestillat.angelegt, { a: mailNachDestillat?.angelegt, g: mailNachDestillat?.geaendert });
{
  // Über den MCP-Server angelegte/geänderte Karten tragen die Zeit (die Server-Datei baut release.yml nach dem Merge)
  const SERVER = path.join(__repo, 'release', 'pixinotes-mcp.mjs');
  const quelle = existsSync(SERVER) ? readFileSync(SERVER, 'utf8') : '';
  if (!/nodes: \[\.\.\.b\.nodes, frisch\(/.test(quelle)) {
    console.log('  (C6 übersprungen: release/pixinotes-mcp.mjs ist noch nicht mit M463 gebaut – npm run build:mcp)');
  } else {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const datei = path.join(mkdtempSync(path.join(os.tmpdir(), 'pn-m463-')), 'daten.json');
    const c = new Client({ name: 'pruefung', version: '1' });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER, '--datei', datei], stderr: 'ignore' }));
    const ruf = async (name, args = {}) => (await c.callTool({ name, arguments: args })).content?.[0]?.text ?? '';
    const vor = Date.now();
    const an = await ruf('pixinotes_board_anlegen', { name: 'Zeit' });
    const bid = /\[([^\]]+)\]/.exec(an)?.[1];
    await ruf('pixinotes_bearbeiten', { board: bid, ops: [{ op: 'kanban', title: 'Aufgaben', items: [{ text: 'Eins' }] }] });
    const k1 = JSON.parse(readFileSync(datei, 'utf8')).boards.find((x) => x.id === bid)?.nodes.find((n) => n.type === 'kanban');
    await new Promise((r) => setTimeout(r, 30));
    await ruf('pixinotes_bearbeiten', { board: bid, ops: [{ op: 'edit_title', id: k1?.id, title: 'Aufgaben neu' }] });
    const k2 = JSON.parse(readFileSync(datei, 'utf8')).boards.find((x) => x.id === bid)?.nodes.find((n) => n.type === 'kanban');
    await c.close();
    pruefe('C6 MCP: neue Karte trägt angelegt/geaendert, eine Änderung stempelt neu', typeof k1?.angelegt === 'number' && k1.angelegt >= vor && k2?.data?.title === 'Aufgaben neu' && k2.geaendert > k1.geaendert && k2.angelegt === k1.angelegt, { k1: [k1?.angelegt, k1?.geaendert], k2: [k2?.angelegt, k2?.geaendert, k2?.data?.title] });
  }
}

// ---------- D: Briefing-Risiken ohne KI ----------
console.log('D  Briefing ohne KI: Risiken aus der Struktur (M444)');
{
  const ALT = JETZT - 20 * TAG;
  const { ctx, P, aufrufe } = await auf({
    nodes: [
      { id: 'k1', type: 'kanban', position: { x: 40, y: 40 }, width: 520, angelegt: ALT, geaendert: ALT, data: { title: 'Umbau', cols: ['Offen', 'In Arbeit', 'Erledigt'], items: [
        { id: 't1', text: 'Angebot schreiben', col: 0, due: iso(-5) },
        { id: 't2', text: 'Statik prüfen', col: 1 },
        { id: 't3', text: 'Fertig gemacht', col: 2 },
      ] } },
      { id: 'k2', type: 'kanban', position: { x: 40, y: 420 }, width: 520, angelegt: JETZT - TAG, geaendert: JETZT - TAG, data: { title: 'Frisch', cols: ['Offen', 'In Arbeit', 'Erledigt'], items: [{ id: 'u1', text: 'Gerade begonnen', col: 1 }] } },
      notiz('n1', 640, 40, 'Freigabe Bauamt'), notiz('n2', 980, 40, 'Druck der Pläne'),
      notiz('n3', 640, 320, 'Logo'), notiz('n4', 980, 320, 'Briefpapier'),
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', type: 'labeled', data: { label: 'blockiert', kind: 'arrow' } },
      { id: 'e2', source: 'n3', target: 'n4', type: 'labeled', data: { label: 'gehört zu', kind: 'arrow' } },
    ],
  });
  const vorher = (await stand(P)).nodes.map((n) => n.id);
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click());
  await P.waitForTimeout(300);
  await P.locator('[data-taste="ki-briefing"]').click();
  await P.waitForFunction(() => /Briefing/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
  await P.waitForTimeout(1200);
  const neu = (await stand(P)).nodes.find((n) => !vorher.includes(n.id));
  const texte = JSON.stringify(neu?.data?.blocks ?? []);
  const risiken = texte.slice(texte.indexOf('Risiken und Blocker'));
  pruefe('D1 die überfällige Frist steht mit Namen und Dauer bei den Risiken', /Frist seit 5 Tagen überschritten: Angebot schreiben/.test(risiken), risiken.slice(0, 600));
  pruefe('D2 das Ticket, das seit 20 Tagen „In Arbeit" steht, wird genannt', /Seit 20 Tagen in „In Arbeit“: Statik prüfen/.test(risiken), risiken.slice(0, 600));
  pruefe('D3 der Pfeil „blockiert" wird zum Blocker', risiken.includes('„Freigabe Bauamt“ blockiert „Druck der Pläne“'), risiken.slice(0, 600));
  pruefe('D4 nicht genannt: das frisch begonnene Ticket, der harmlose Pfeil, Erledigtes', !/Gerade begonnen|gehört zu|Fertig gemacht/.test(risiken), risiken.slice(0, 600));
  pruefe('D5 ohne KI: keine Anfrage ins Netz', aufrufe.length === 0, aufrufe.length);
  await ctx.close();
}

pruefe('E1 keine Fehler', fehler.length === 0, fehler);
await browser.close();
app.close();
console.log(`\nM463: ${ok} ok, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
