/**
 * M473 — Kalender korrekt: Serientermine, Zeitzonen, Token-Erneuerung im Hintergrund.
 *
 *   N  LOGIK direkt in Node (lib/ics.ts + lib/icsSerie.ts, mit esbuild gebündelt): wöchentlich mit EXDATE und
 *      verschobenem Einzeltermin, monatlich „letzter Freitag" mit UNTIL, COUNT, BYMONTHDAY=-1, BYSETPOS, 29.02.,
 *      TZID New York über die US-Sommerzeit, Windows-Zonenname, Outlook-Anzeigename mit Doppelpunkt, Termin über
 *      die EU-Umstellung, Obergrenze gegen Endlosschleifen, unbekannte Regel, Abo-Aktualisierung (mergeEvents).
 *   A  ABO im Browser (page.route, Uhr per page.clock, Zone Europe/Berlin): „Abos aktualisieren" legt die Serien an;
 *      die Kalender-Karte zeigt jeden Termin am richtigen Tag (Ausnahme fehlt, Verschiebung am neuen Tag, Zone
 *      verschiebt den Tag), ein Klick zeigt die Uhrzeit in Ortszeit (auch über die Umstellung).
 *   B  ZENTRALE: „Termine heute und morgen" mit Serienterminen in Ortszeit — vor und nach der Sommerzeit.
 *   C  TOKEN: abgelaufenes Google-Token → der Hintergrund-Abruf erneuert still (vorgegebener Endpunkt) → Termin da,
 *      Erinnerung kommt; scheitert die Erneuerung → leiser Hinweis in der Zentrale, „Erneut anmelden" holt nach.
 *   F  Keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m473-kalender-korrekt.mjs`
process.env.TZ = 'Europe/Berlin';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5473;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 900) : JSON.stringify(info).slice(0, 900)}`); }
};

// Das Abo: alles, was ein Outlook-/Google-Kalender typischerweise schreibt
const ABO = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prüfung//DE',
  'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'END:STANDARD', 'END:VTIMEZONE',
  // wöchentlich Montag 09:00 Berlin, 15.03. ausgelassen, 22.03. auf Dienstag 23.03. 14:00 verschoben
  'BEGIN:VEVENT', 'UID:jourfixe@test', 'SUMMARY:Jour fixe', 'LOCATION:Raum 4',
  'DTSTART;TZID=Europe/Berlin:20270301T090000', 'DTEND;TZID=Europe/Berlin:20270301T100000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270430T215959Z', 'EXDATE;TZID=Europe/Berlin:20270315T090000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:jourfixe@test', 'RECURRENCE-ID;TZID=Europe/Berlin:20270322T090000', 'SUMMARY:Jour fixe (verschoben)',
  'DTSTART;TZID=Europe/Berlin:20270323T140000', 'DTEND;TZID=Europe/Berlin:20270323T150000', 'END:VEVENT',
  // New York, Montag 09:00 — sechsmal; die US-Sommerzeit beginnt am 14.03., die EU-Sommerzeit am 28.03.
  'BEGIN:VEVENT', 'UID:nycall@test', 'SUMMARY:NY Call',
  'DTSTART;TZID=America/New_York:20270301T090000', 'DTEND;TZID=America/New_York:20270301T093000',
  'RRULE:FREQ=WEEKLY;COUNT=6', 'END:VEVENT',
  // letzter Freitag im Monat, Windows-Zonenname aus Outlook (in Anführungszeichen)
  'BEGIN:VEVENT', 'UID:lastfri@test', 'SUMMARY:Monatsabschluss',
  'DTSTART;TZID="W. Europe Standard Time":20270129T160000', 'DTEND;TZID="W. Europe Standard Time":20270129T170000',
  'RRULE:FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20271231T000000Z', 'END:VEVENT',
  // Einzeltermin in New York, der hier am nächsten Tag liegt
  'BEGIN:VEVENT', 'UID:nyabend@test', 'SUMMARY:Abstimmung NY',
  'DTSTART;TZID=Eastern Standard Time:20270310T193000', 'DTEND;TZID=Eastern Standard Time:20270310T203000', 'END:VEVENT',
  // über die EU-Umstellung (28.03.): 20–22 Uhr New York = 01:00–04:00 hier (die Uhr springt dazwischen vor)
  'BEGIN:VEVENT', 'UID:nacht@test', 'SUMMARY:Nachtschicht',
  'DTSTART;TZID=America/New_York:20270327T200000', 'DTEND;TZID=America/New_York:20270327T220000', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

// ═════════════════════════════ N: Logik in Node ═════════════════════════════
console.log('N  Logik (lib/ics.ts, lib/icsSerie.ts)');
const ablage = mkdtempSync(path.join(os.tmpdir(), 'm473-'));
const buendel = path.join(ablage, 'ics.mjs');
await build({
  stdin: { contents: `export * from ${JSON.stringify(path.join(__repo, 'src/lib/ics.ts'))}; export * from ${JSON.stringify(path.join(__repo, 'src/lib/icsSerie.ts'))};`, resolveDir: __repo, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: buendel, logLevel: 'silent',
});
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
const L = await import(pathToFileURL(buendel).href);
const zeile = (t) => `${t.start} ${t.startTime ?? '–'}${t.endTime ? `–${t.endTime}` : ''}${t.end ? ` bis ${t.end}` : ''} ${t.title}`;
const roh = L.parseIcs(ABO);
const alle = L.icsImFenster(roh, '2027-01-01', '2027-12-31').map(zeile).sort();
const von = (titel) => alle.filter((z) => z.endsWith(` ${titel}`));
pruefe('N1 wöchentlich: 15.03. ausgelassen, 22.03. verschoben, bis UNTIL (26.04.)',
  JSON.stringify(von('Jour fixe')) === JSON.stringify(['2027-03-01 09:00–10:00 Jour fixe', '2027-03-08 09:00–10:00 Jour fixe', '2027-03-29 09:00–10:00 Jour fixe', '2027-04-05 09:00–10:00 Jour fixe', '2027-04-12 09:00–10:00 Jour fixe', '2027-04-19 09:00–10:00 Jour fixe', '2027-04-26 09:00–10:00 Jour fixe'])
  && JSON.stringify(von('Jour fixe (verschoben)')) === JSON.stringify(['2027-03-23 14:00–15:00 Jour fixe (verschoben)']), von('Jour fixe').concat(von('Jour fixe (verschoben)')));
pruefe('N2 New York über die US-Sommerzeit: 15:00, 15:00, dann 14:00 bis zur EU-Umstellung, dann wieder 15:00; COUNT=6',
  JSON.stringify(von('NY Call')) === JSON.stringify(['2027-03-01 15:00–15:30 NY Call', '2027-03-08 15:00–15:30 NY Call', '2027-03-15 14:00–14:30 NY Call', '2027-03-22 14:00–14:30 NY Call', '2027-03-29 15:00–15:30 NY Call', '2027-04-05 15:00–15:30 NY Call']), von('NY Call'));
const fr = von('Monatsabschluss');
pruefe('N3 letzter Freitag (-1FR) mit Windows-Zonenname, Sommerzeit ohne Versatz, bis UNTIL',
  fr.length === 11 && fr[0] === '2027-01-29 16:00–17:00 Monatsabschluss' && fr.includes('2027-03-26 16:00–17:00 Monatsabschluss') && fr.includes('2027-04-30 16:00–17:00 Monatsabschluss') && fr.at(-1) === '2027-11-26 16:00–17:00 Monatsabschluss', fr);
pruefe('N4 Einzeltermin „Eastern Standard Time" 19:30 → hier am nächsten Tag 01:30', JSON.stringify(von('Abstimmung NY')) === JSON.stringify(['2027-03-11 01:30–02:30 Abstimmung NY']), von('Abstimmung NY'));
pruefe('N5 Termin über die EU-Umstellung: zwei Stunden in New York = 01:00–04:00 hier', JSON.stringify(von('Nachtschicht')) === JSON.stringify(['2027-03-28 01:00–04:00 Nachtschicht']), von('Nachtschicht'));
const serie = (rrule, beginn, extra = {}) => ({ title: 'S', start: beginn.slice(0, 10), serie: { rrule, beginn, dauer: 60, ...extra } });
const tage = (ev, a, b) => L.serieAufloesen(ev, a, b).map((t) => t.start);
pruefe('N6 BYMONTHDAY=-1 (Monatsletzter), BYSETPOS=-1 (letzter Werktag), 29.02. nur im Schaltjahr',
  JSON.stringify(tage(serie('FREQ=MONTHLY;BYMONTHDAY=-1', '2027-01-31T10:00:00'), '2027-01-01', '2027-04-30')) === JSON.stringify(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  && JSON.stringify(tage(serie('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2027-01-29T10:00:00'), '2027-01-01', '2027-07-31')) === JSON.stringify(['2027-01-29', '2027-02-26', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30', '2027-07-30'])
  && JSON.stringify(tage(serie('FREQ=YEARLY', '2024-02-29T10:00:00'), '2024-01-01', '2032-12-31')) === JSON.stringify(['2024-02-29', '2028-02-29', '2032-02-29']),
[tage(serie('FREQ=MONTHLY;BYMONTHDAY=-1', '2027-01-31T10:00:00'), '2027-01-01', '2027-04-30'), tage(serie('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2027-01-29T10:00:00'), '2027-01-01', '2027-07-31'), tage(serie('FREQ=YEARLY', '2024-02-29T10:00:00'), '2024-01-01', '2032-12-31')]);
pruefe('N7 täglich alle 2 Tage, jährlich im März am 2. Sonntag (BYMONTH + 2SU), ganztägig über zwei Tage',
  JSON.stringify(tage(serie('FREQ=DAILY;INTERVAL=2;COUNT=4', '2027-03-02T08:00:00'), '2027-03-01', '2027-03-31')) === JSON.stringify(['2027-03-02', '2027-03-04', '2027-03-06', '2027-03-08'])
  && JSON.stringify(tage(serie('FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', '2025-03-09T08:00:00'), '2025-01-01', '2028-12-31')) === JSON.stringify(['2025-03-09', '2026-03-08', '2027-03-14', '2028-03-12'])
  && JSON.stringify(L.serieAufloesen({ title: 'G', start: '2027-05-03', serie: { rrule: 'FREQ=WEEKLY;COUNT=2', beginn: '2027-05-03', dauer: 2 } }, '2027-05-01', '2027-05-31').map((t) => `${t.start}…${t.end}`)) === JSON.stringify(['2027-05-03…2027-05-04', '2027-05-10…2027-05-11']));
const t0 = Date.now();
const lang = L.serieAufloesen(serie('FREQ=DAILY', '1990-01-01T07:00:00'), '2027-03-01', '2027-03-31');
const ewig = L.serieAufloesen(serie('FREQ=MONTHLY;BYMONTHDAY=31;BYMONTH=2', '2027-01-31T07:00:00'), '2027-01-01', '2099-12-31');
const ms = Date.now() - t0;
pruefe('N8 kein Endlos-Lauf: tägliche Serie seit 1990 liefert genau den März; eine Regel ohne Treffer endet (Obergrenze)', lang.length === 31 && lang[0].start === '2027-03-01' && ewig.length === 1 && ms < 1500, [lang.length, ewig.length, ms]);
pruefe('N9 unbekannte Regel (stündlich): nur der erste Termin wie bisher', L.serieAufloesen(serie('FREQ=HOURLY', '2027-03-01T07:00:00'), '2027-03-01', '2027-03-31').length === 1);
const outlook = L.parseIcs('BEGIN:VEVENT\r\nSUMMARY:Outlook\r\nDTSTART;TZID="(UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien":20270701T090000\r\nDTEND;TZID="(UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien":20270701T100000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Unbekannt\r\nDTSTART;TZID=Mars/Olympus:20270701T090000\r\nEND:VEVENT');
pruefe('N10 Outlook-Anzeigename mit Doppelpunkt in Anführungszeichen; unbekannte Zone bleibt Wandzeit', outlook[0]?.startTime === '09:00' && outlook[0]?.endTime === '10:00' && outlook[1]?.startTime === '09:00', outlook);
// Abo ändert sich: Verschiebung zurückgenommen, neue Ausnahme — der alte Ersatztermin verschwindet
const ABO2 = ABO.replace(/BEGIN:VEVENT\r\nUID:jourfixe@test\r\nRECURRENCE-ID[\s\S]*?END:VEVENT\r\n/, '').replace('EXDATE;TZID=Europe/Berlin:20270315T090000', 'EXDATE;TZID=Europe/Berlin:20270329T090000');
const vorM473 = [{ title: 'Jour fixe', start: '2027-03-01' }, { title: 'NY Call', start: '2027-03-01', startTime: '09:00' }];
const zus = L.mergeEvents(L.mergeEvents(vorM473, roh), L.parseIcs(ABO2));
const jf = L.icsImFenster(zus, '2027-03-01', '2027-03-31').filter((t) => t.title.startsWith('Jour fixe')).map((t) => t.start);
const ny = zus.filter((e) => e.title === 'NY Call');
pruefe('N11 „Abos aktualisieren": neuer Stand gewinnt (Serie, Zone), alte Einträge der UID entfallen', JSON.stringify(jf) === JSON.stringify(['2027-03-01', '2027-03-08', '2027-03-15', '2027-03-22']) && ny.length === 1 && ny[0].startTime === '15:00' && !!ny[0].serie, [jf, ny]);

// ═════════════════════════════ Browser ═════════════════════════════
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const ABO_URL = 'https://kalender.example.org/team.ics';

/**
 * Seite mit fester Uhr (Ortszeit Berlin). `kal` = Daten der Kalender-Karte, `konten` = verbundene Konten,
 * `erneuern` = Antwort des (nachgestellten) Google-Anmeldedienstes beim stillen Erneuern.
 */
const auf = async ({ uhr, kal, konten = null, erinnern = false, erneuern = null, googleTermine = [], aktiv = 'b2' }) => {
  const ctx = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin', viewport: { width: 1440, height: 900 } });
  const log = { abo: 0, gis: 0, erneuern: [], google: [] };
  const json = (route, obj, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
  await ctx.route(ABO_URL, (route) => { log.abo += 1; return route.fulfill({ status: 200, contentType: 'text/calendar', headers: { 'access-control-allow-origin': '*' }, body: ABO }); });
  // Google-Anmeldedienst (GIS) nachgestellt: requestAccessToken fragt den vorgegebenen Erneuerungs-Endpunkt
  await ctx.route('https://accounts.google.com/gsi/client', (route) => { log.gis += 1; return route.fulfill({ status: 200, contentType: 'text/javascript', body: `
    window.google = { accounts: { oauth2: { initTokenClient(cfg) { return { requestAccessToken(over) {
      fetch('https://accounts.google.com/pruefung/erneuern?prompt=' + encodeURIComponent((over && over.prompt) ?? cfg.prompt ?? 'x'))
        .then((r) => r.json())
        .then((j) => { if (j.access_token) cfg.callback(j); else if (cfg.error_callback) cfg.error_callback({ type: 'popup_failed_to_open' }); else cfg.callback({ error: j.error }); });
    } }; } } } };` }); });
  await ctx.route('https://accounts.google.com/pruefung/erneuern**', (route) => {
    log.erneuern.push(new URL(route.request().url()).searchParams.get('prompt'));
    return json(route, erneuern.antwort);
  });
  await ctx.route('https://www.googleapis.com/**', (route) => {
    const auth = route.request().headers().authorization;
    log.google.push(auth);
    if (auth !== 'Bearer g-neu') return json(route, { error: { code: 401 } }, 401);
    return json(route, { items: googleTermine });
  });
  await ctx.route(/^https?:\/\/(?!localhost|kalender\.example\.org|accounts\.google\.com|www\.googleapis\.com)/, (route) => route.abort());
  await ctx.addInitScript(([kal, konten, erinnern, aktiv]) => {
    if (localStorage.getItem('pixinotes-onboarded')) return;
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    if (konten) localStorage.setItem('pixinotes-cal-accounts', JSON.stringify(konten));
    if (erinnern) localStorage.setItem('pixinotes-termin-erinnerung', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [
        { id: 'b1', name: 'Planung', edges: [], drawings: [], comments: [], nodes: [
          { id: 'n1', type: 'note', width: 300, height: 160, position: { x: 0, y: 0 }, data: { title: 'Notiz' } },
        ] },
        { id: 'b2', name: 'Kalender', edges: [], drawings: [], comments: [], nodes: [
          { id: 'kal', type: 'calendar', width: 760, height: 620, position: { x: 40, y: 40 }, data: kal },
        ] },
      ],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1', 'b2'] }] }], activeId: aktiv, view: 'board', cardFocus: false, clickZoom: false, physicsEnabled: false,
      brain: { on: false, provider: 'auto' } } }));
  }, [kal, konten, erinnern, aktiv]);
  const P = await ctx.newPage();
  await P.clock.install({ time: uhr });
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2500);
  return { ctx, P, log };
};
const karte = (P) => P.locator('.react-flow__node[data-id="kal"]');
/** Tag im Monat → Texte der Einträge (nur Tage des angezeigten Monats) */
const raster = (P) => karte(P).locator('.cal-cell:not(.out)').evaluateAll((zellen) => Object.fromEntries(zellen.map((z) => [
  Number(z.querySelector('.cal-daynum')?.textContent), [...z.querySelectorAll('.cal-chip, .cal-strip')].map((c) => c.textContent.replace(/^\S+\s/, '').trim()),
])));
const zentrale = async (P) => { await P.locator('.tab-tasks').first().click(); await P.waitForSelector('.taskhub'); await P.waitForTimeout(1200); };
const abschnitt = (P) => P.locator('section[aria-label="Termine heute und morgen"]');
const tagZeilen = (P) => abschnitt(P).evaluate((s) => {
  const aus = { heute: [], morgen: [] }; let tag = '';
  for (const el of s.querySelectorAll('.th-termine-tag, button.th-termin')) {
    if (el.classList.contains('th-termine-tag')) tag = /Heute/.test(el.textContent) ? 'heute' : 'morgen';
    else aus[tag].push(el.innerText.replace(/\s+/g, ' ').trim());
  }
  return aus;
}).catch(() => ({ heute: [], morgen: [] }));

// ---------- A ----------
console.log('A  Abo in der Kalender-Karte');
let { ctx, P, log } = await auf({ uhr: new Date('2027-03-22T08:00:00+01:00'), kal: { month: '2027-03', icsUrls: [ABO_URL], icsEvents: [] } });
await karte(P).click({ position: { x: 300, y: 12 } });
await karte(P).locator('button[aria-label="Mehr"]').evaluate((b) => b.click());
await karte(P).locator('button', { hasText: 'Abos aktualisieren' }).evaluate((b) => b.click());
await P.waitForTimeout(1500);
await karte(P).locator('button[aria-label="Mehr"]').evaluate((b) => b.click());
await P.waitForTimeout(400);
const r = await raster(P);
const tageMit = (titel) => Object.entries(r).filter(([, l]) => l.includes(titel)).map(([d]) => Number(d));
pruefe('A1 das Abo wurde geholt und als Serie gespeichert (nicht als Einzeltage)', log.abo === 1 && await P.evaluate(() => {
  const n = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[1].nodes[0];
  return n.data.icsEvents.filter((e) => e.serie).length === 3;
}), log);
pruefe('A2 Jour fixe: 1., 8., 29. — 15. ausgelassen, 22. verschoben auf den 23.', JSON.stringify(tageMit('Jour fixe')) === '[1,8,29]' && JSON.stringify(tageMit('Jour fixe (verschoben)')) === '[23]', r);
pruefe('A3 NY Call an jedem Montag (COUNT=6 reicht in den April)', JSON.stringify(tageMit('NY Call')) === '[1,8,15,22,29]', r);
pruefe('A4 letzter Freitag: 26.; Abstimmung NY wegen der Zone am 11. statt am 10.', JSON.stringify(tageMit('Monatsabschluss')) === '[26]' && JSON.stringify(tageMit('Abstimmung NY')) === '[11]', r);
const detail = async (tag, titel) => {
  await karte(P).locator('.cal-cell:not(.out)').filter({ has: P.locator('.cal-daynum', { hasText: new RegExp(`^${tag}$`) }) }).locator('.cal-chip', { hasText: titel }).first().evaluate((b) => b.click());
  await P.waitForTimeout(300);
  return (await karte(P).locator('[role="dialog"][aria-label="Termin"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
};
const d1 = await detail(15, 'NY Call');
pruefe('A5 Klick auf den Serientermin: Uhrzeit in Ortszeit (14:00–14:30 in der US-Sommerzeit-Woche)', d1.includes('14:00–14:30') && d1.includes('NY Call'), d1);
const d2 = await detail(28, 'Nachtschicht');
pruefe('A6 Termin über die Umstellung: 01:00–04:00', d2.includes('01:00–04:00'), d2);
const d3 = await detail(29, 'Jour fixe');
pruefe('A7 Jour fixe nach der Umstellung weiter 09:00–10:00, mit Ort', d3.includes('09:00–10:00') && d3.includes('Raum 4'), d3);
const gespeichert = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[1].nodes[0].data.icsEvents);

// ---------- B ----------
console.log('B  Zentrale: Serien vor und nach der Sommerzeit');
await zentrale(P);
let tz = await tagZeilen(P);
console.log('    22.03.', tz.heute, '23.03.', tz.morgen);
pruefe('B1 heute (22.03.): NY Call 14:00–14:30, kein Jour fixe (verschoben)', tz.heute.includes('14:00–14:30 NY Call Abo') && !tz.heute.some((z) => z.includes('Jour fixe')), tz.heute);
pruefe('B2 morgen (23.03.): der verschobene Jour fixe um 14:00–15:00', tz.morgen.includes('14:00–15:00 Jour fixe (verschoben) Abo'), tz.morgen);
await ctx.close();
({ ctx, P, log } = await auf({ uhr: new Date('2027-03-29T08:50:00+02:00'), kal: { month: '2027-03', icsUrls: [ABO_URL], icsEvents: gespeichert }, erinnern: true, aktiv: 'b1' }));
const erinnerung = await P.locator('.toast').innerText().catch(() => '');
pruefe('B5 Erinnerung an den Serientermin (Auflösung lädt beim Start nach, Board ohne Kalender offen)', erinnerung.includes('Termin um 09:00') && erinnerung.includes('Jour fixe'), erinnerung);
await zentrale(P);
tz = await tagZeilen(P);
console.log('    29.03.', tz.heute);
pruefe('B3 nach der Umstellung (29.03.): Jour fixe 09:00–10:00 mit Ort, NY Call 15:00–15:30', JSON.stringify(tz.heute) === JSON.stringify(['09:00–10:00 Jour fixe Raum 4 Abo', '15:00–15:30 NY Call Abo']), tz.heute);
pruefe('B4 ohne Netz: nichts nachgeladen (die Serie steht in der Karte)', log.abo === 0, log);
await ctx.close();

// ---------- C ----------
console.log('C  Google-Token im Hintergrund erneuern');
const jetzt = new Date('2027-05-12T09:10:00+02:00');
const KONTEN = { google: { clientId: 'g-id', token: 'g-alt', tokenExp: jetzt.getTime() - 60_000, connectedAs: 'Ich', calendars: [{ id: 'primary', name: 'Ich', enabled: true }] } };
const KURZ = [{ id: 'g-kurz', summary: 'Kurzfristig', start: { dateTime: '2027-05-12T09:20:00+02:00' }, end: { dateTime: '2027-05-12T09:50:00+02:00' } }];
const erneuern = { antwort: { access_token: 'g-neu', expires_in: 3600 } };
({ ctx, P, log } = await auf({ uhr: jetzt, kal: { month: '2027-05' }, konten: KONTEN, erinnern: true, erneuern, googleTermine: KURZ, aktiv: 'b1' }));
const konto = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-cal-accounts')).google);
pruefe('C1 abgelaufenes Token: still erneuert (prompt leer), neues Token gespeichert', log.erneuern.length === 1 && log.erneuern[0] === '' && konto.token === 'g-neu' && konto.tokenExp > jetzt.getTime(), [log, konto]);
pruefe('C2 Termine mit dem neuen Token abgerufen, nie mit dem alten', log.google.length > 0 && log.google.every((a) => a === 'Bearer g-neu'), log.google);
const toast = await P.locator('.toast').innerText().catch(() => '');
pruefe('C3 Erinnerung an den nur so bekannten Termin (09:20 Kurzfristig)', toast.includes('09:20') && toast.includes('Kurzfristig'), toast);
await zentrale(P);
tz = await tagZeilen(P);
pruefe('C4 Zentrale zeigt ihn, ohne Hinweis', tz.heute.some((z) => z.startsWith('09:20–09:50 Kurzfristig')) && await abschnitt(P).locator('.th-termine-hinweis').count() === 0, tz.heute);
await ctx.close();

const scheitert = { antwort: { error: 'interaction_required' } };
({ ctx, P, log } = await auf({ uhr: jetzt, kal: { month: '2027-05' }, konten: KONTEN, erinnern: true, erneuern: scheitert, googleTermine: KURZ, aktiv: 'b1' }));
pruefe('C5 Erneuerung scheitert: kein Abruf mit dem alten Token, Hinweis gemerkt (nur der Kontoname)', log.erneuern.length === 1 && log.google.length === 0
  && await P.evaluate(() => localStorage.getItem('pixinotes:konto-hinweis')) === '["google"]', [log, await P.evaluate(() => localStorage.getItem('pixinotes:konto-hinweis'))]);
const toast2 = await P.locator('.toast').innerText().catch(() => '');
pruefe('C6 keine Fehlermeldung als Toast', !/fehl|abgelaufen|error/i.test(toast2), toast2);
await zentrale(P);
const hinweis = (await abschnitt(P).locator('.th-termine-hinweis').innerText().catch(() => '')).replace(/\s+/g, ' ');
pruefe('C7 leiser Hinweis in der Zentrale', hinweis.includes('Google: Anmeldung abgelaufen') && hinweis.includes('Erneut anmelden'), hinweis);
erneuern.antwort = { access_token: 'g-neu', expires_in: 3600 };
scheitert.antwort = erneuern.antwort;
await abschnitt(P).locator('button.th-termine-erneuern').click();
await P.waitForTimeout(1200);
tz = await tagZeilen(P);
pruefe('C8 „Erneut anmelden" holt nach: Hinweis weg, Termin da', await abschnitt(P).locator('.th-termine-hinweis').count() === 0 && tz.heute.some((z) => z.includes('Kurzfristig'))
  && await P.evaluate(() => localStorage.getItem('pixinotes:konto-hinweis')) === null, [tz.heute, log]);
await ctx.close();

console.log('F  Fehler');
pruefe('F1 keine Seitenfehler', fehler.length === 0, fehler);

await browser.close();
app.close();
console.log(`\nM473: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
