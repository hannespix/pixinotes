/**
 * M469 — Termine aus Kalender-Konten in der Aufgaben-Zentrale.
 *
 * Google Kalender und Microsoft Graph sind per page.route nachgestellt, die Uhr per page.clock — kein echter Netzverkehr.
 *
 *   A  KEIN NETZ BEIM START: mit verbundenen Konten fragt die App beim Start weder Google noch Microsoft.
 *   B  ABSCHNITT: Öffnen der Zentrale holt Heute/Morgen; „Termine heute und morgen" zeigt die Termine beider Konten
 *      sortiert (ganztägig zuerst, dann nach Uhrzeit) mit Konto-Kennung, ohne Haken; übermorgen fehlt; ein Termin aus
 *      beiden Konten steht einmal, ein Termin mit Titel eines Zeitplan-Vorgangs am selben Tag nicht doppelt.
 *   C  KLICK: führt zur Kalender-Karte (auf einem anderen Board) und stellt sie auf den Tag des Termins.
 *   D  ERINNERUNG: Standard aus – kurz vor Beginn keine Meldung; mit Häkchen erscheint sie einmal, 15 Minuten vorher.
 *   E  OHNE KONTO: kein Abschnitt, keine Anfrage.
 *   F  OHNE KALENDER-KARTE: der Klick legt eine an.
 *   G  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m469-termine-zentrale.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5469;
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

// Feste Uhr: heute 09:10 Ortszeit
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const basis = new Date(); basis.setHours(9, 10, 0, 0);
const H = iso(basis);
const M = iso(new Date(basis.getFullYear(), basis.getMonth(), basis.getDate() + 1));
const U = iso(new Date(basis.getFullYear(), basis.getMonth(), basis.getDate() + 2));

const GOOGLE = [
  { summary: 'Betriebsausflug', start: { date: H } },
  { summary: 'Teamrunde', start: { dateTime: `${H}T09:30:00` } },
  { summary: 'Abnahme Halle', start: { dateTime: `${H}T11:00:00` } },
  { summary: 'Steuerberater', start: { dateTime: `${U}T10:00:00` } },
];
const OUTLOOK = [
  { subject: 'Abnahme Halle', isAllDay: false, start: { dateTime: `${H}T11:00:00.0000000` } },
  { subject: 'Bauabnahme Nord', isAllDay: false, start: { dateTime: `${H}T14:00:00.0000000` } },
  { subject: 'Zahnarzt', isAllDay: false, start: { dateTime: `${M}T07:45:00.0000000` } },
];
const KONTEN = {
  google: { clientId: 'g-id', token: 'g-tok', tokenExp: 4102444800000, connectedAs: 'Ich', calendars: [{ id: 'primary', name: 'Ich', enabled: true }] },
  ms: { clientId: 'ms-id', tenant: 'common', token: 'ms-tok', tokenExp: 4102444800000, refreshToken: 'ms-ref', scopes: 'Calendars.Read User.Read offline_access', connectedAs: 'Hanna' },
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

/** Neue Seite: Board „Planung" (Zeitplan mit Vorgang heute), Board „Kalender" (Kalender-Karte, falls gewünscht) */
const auf = async ({ konten = KONTEN, kalender = true } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  const log = { google: [], graph: [] };
  const json = (route, obj) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
  await ctx.route('https://www.googleapis.com/**', (route) => {
    const url = new URL(route.request().url());
    log.google.push(url.pathname);
    const von = url.searchParams.get('timeMin'); const bis = url.searchParams.get('timeMax');
    const drin = (e) => { const t = new Date(e.start.dateTime ?? `${e.start.date}T12:00:00`).getTime(); return t >= Date.parse(von) && t < Date.parse(bis); };
    return json(route, { items: GOOGLE.filter(drin) });
  });
  await ctx.route('https://graph.microsoft.com/**', (route) => {
    const url = new URL(route.request().url());
    log.graph.push(url.pathname);
    const von = url.searchParams.get('startDateTime'); const bis = url.searchParams.get('endDateTime');
    const drin = (e) => { const t = new Date(e.start.dateTime.slice(0, 19)).getTime(); return t >= Date.parse(von) && t < Date.parse(bis); };
    return json(route, { value: OUTLOOK.filter(drin) });
  });
  await ctx.route(/^https?:\/\/(?!localhost|www\.googleapis\.com|graph\.microsoft\.com)/, (route) => route.abort());
  await ctx.addInitScript(([k, H, mitKal]) => {
    if (localStorage.getItem('pixinotes-onboarded')) return;
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    if (k) localStorage.setItem('pixinotes-cal-accounts', JSON.stringify(k));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [
        { id: 'b1', name: 'Planung', edges: [], drawings: [], comments: [], nodes: [
          { id: 'g1', type: 'gantt', width: 700, height: 260, position: { x: 0, y: 0 }, data: { title: 'Bau', dayWidth: 24, rows: [{ id: 'r1', name: 'Bauabnahme Nord', start: H, end: H, progress: 0 }] } },
        ] },
        { id: 'b2', name: 'Kalender', edges: [], drawings: [], comments: [], nodes: mitKal ? [
          { id: 'kal', type: 'calendar', width: 430, height: 340, position: { x: 60, y: 60 }, data: {} },
        ] : [] },
      ],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1', 'b2'] }] }], activeId: 'b1', view: 'board', cardFocus: false, clickZoom: false, physicsEnabled: false,
      brain: { on: false, provider: 'auto' } } }));
  }, [konten, H, kalender]);
  const P = await ctx.newPage();
  await P.clock.install({ time: basis });
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(3000);
  return { ctx, P, log };
};
const zentrale = async (P) => { await P.locator('.tab-tasks').first().click(); await P.waitForSelector('.taskhub'); await P.waitForTimeout(1200); };
const abschnitt = (P) => P.locator('section[aria-label="Termine heute und morgen"]');
const zeilen = (P) => abschnitt(P).locator('button.th-termin').evaluateAll((bs) => bs.map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
const toast = (P) => P.locator('.toast').innerText().catch(() => '');
const boardStand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);

// ---------- A, B ----------
console.log('A  Kein Netz beim Start');
let { ctx, P, log } = await auf();
pruefe('A1 beim Start keine Anfrage an Google oder Microsoft', log.google.length + log.graph.length === 0, log);

console.log('B  Abschnitt „Termine heute und morgen"');
await zentrale(P);
pruefe('B1 Öffnen der Zentrale fragt beide Konten', log.google.length > 0 && log.graph.length > 0, log);
const z = await zeilen(P);
console.log('    ', z);
const erwartet = ['ganztägig Betriebsausflug Google', '09:30 Teamrunde Google', '11:00 Abnahme Halle', '07:45 Zahnarzt Outlook'];
pruefe('B2 heute und morgen sortiert, mit Konto', z.length === 4 && erwartet.every((e, i) => z[i]?.startsWith(e)), z);
pruefe('B3 übermorgen fehlt', !z.some((x) => x.includes('Steuerberater')), z);
pruefe('B4 Termin aus beiden Konten einmal', z.filter((x) => x.includes('Abnahme Halle')).length === 1, z);
pruefe('B5 Zeitplan-Vorgang nicht doppelt', !z.some((x) => x.includes('Bauabnahme Nord')), z);
const kopf = await abschnitt(P).innerText();
pruefe('B6 Tage beschriftet (Heute/Morgen)', /Heute/.test(kopf) && /Morgen/.test(kopf), kopf);
pruefe('B7 keine Haken im Abschnitt', await abschnitt(P).locator('li input[type="checkbox"]').count() === 0);
const aufgabe = await P.locator('.taskhub').getByText('Bauabnahme Nord').count();
pruefe('B8 der Zeitplan-Vorgang steht weiter als Aufgabe da', aufgabe > 0);

// ---------- C ----------
console.log('C  Klick führt zur Kalender-Karte');
await abschnitt(P).locator('button.th-termin', { hasText: 'Zahnarzt' }).click();
await P.waitForTimeout(1200);
let st = await boardStand(P);
const kal = st.boards.find((b) => b.id === 'b2').nodes.find((n) => n.id === 'kal');
pruefe('C1 Zentrale zu, Board „Kalender" offen', await P.locator('.taskhub').count() === 0 && st.activeId === 'b2', st.activeId);
pruefe('C2 Kalender-Karte steht auf dem Tag (morgen)', kal?.data?.anchor === M && kal?.data?.month === M.slice(0, 7), kal?.data);
pruefe('C3 Kalender-Karte sichtbar', await P.locator('.react-flow__node[data-id="kal"]').isVisible());

// ---------- D ----------
console.log('D  Erinnerung kurz vor Beginn');
// 09:10 → 09:21: Teamrunde 09:30 liegt im Vorlauf; die Einstellung ist aber aus
await P.clock.fastForward('11:00');
await P.waitForTimeout(800);
pruefe('D1 ohne Einstellung keine Termin-Erinnerung', !(await toast(P)).includes('Termin um'), await toast(P));
await zentrale(P);
const haken = abschnitt(P).getByLabel('Vorher erinnern');
pruefe('D2 Einstellung standardmäßig aus', !(await haken.isChecked()));
await haken.check();
await P.locator('.taskhub-x').click();
await P.clock.fastForward('05:00');
await P.waitForTimeout(800);
const t1 = await toast(P);
pruefe('D3 mit Einstellung: „Termin um 09:30: Teamrunde (Google)"', t1.includes('Termin um 09:30') && t1.includes('Teamrunde') && t1.includes('Google'), t1);
const erinnert = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes:termin-erinnert') ?? '[]'));
const vorher = log.google.length + log.graph.length;
await P.clock.fastForward('05:00');
await P.waitForTimeout(500);
const erinnert2 = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes:termin-erinnert') ?? '[]'));
pruefe('D4 nur einmal erinnert', erinnert.length === 1 && erinnert2.length === 1, [erinnert, erinnert2]);
pruefe('D5 die Erinnerung fragt kein Konto ab', log.google.length + log.graph.length === vorher, log);
await ctx.close();

// ---------- E ----------
console.log('E  Ohne Konto kein Abschnitt');
({ ctx, P, log } = await auf({ konten: null }));
await zentrale(P);
pruefe('E1 kein Abschnitt', await abschnitt(P).count() === 0);
pruefe('E2 keine Anfrage', log.google.length + log.graph.length === 0, log);
await ctx.close();

// ---------- F ----------
console.log('F  Ohne Kalender-Karte legt der Klick eine an');
({ ctx, P, log } = await auf({ kalender: false }));
await zentrale(P);
await abschnitt(P).locator('button.th-termin', { hasText: 'Teamrunde' }).click();
await P.waitForTimeout(1200);
st = await boardStand(P);
const neu = st.boards.find((b) => b.id === 'b1').nodes.filter((n) => n.type === 'calendar');
pruefe('F1 Kalender-Karte auf dem aktiven Board angelegt', neu.length === 1, st.boards[0].nodes.map((n) => n.type));
pruefe('F2 sichtbar', neu.length === 1 && await P.locator(`.react-flow__node[data-id="${neu[0].id}"]`).isVisible());
await ctx.close();

console.log('G  Fehler');
pruefe('G1 keine Seitenfehler', fehler.length === 0, fehler);

await browser.close();
app.close();
console.log(`\nM469: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
