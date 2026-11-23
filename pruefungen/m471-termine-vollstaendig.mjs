/**
 * M471 — Termine vollständig: Kennung, Ende, Ort; eigene und ICS-Termine in der Aufgaben-Zentrale.
 *
 * Google Kalender und Microsoft Graph sind per page.route nachgestellt, die Uhr per page.clock (Ortszeit Berlin).
 *
 *   A  FELDER: Der Abruf fragt Kennung, Ende, Ort und Web-Link ab (Google `fields`, Graph `$select`, Graph in Weltzeit);
 *      die Zentrale zeigt Beginn–Ende und Ort, Outlook-Zeiten aus Weltzeit richtig in Ortszeit, Ganztägiges oben,
 *      Mehrtägiges an beiden Tagen.
 *   B  QUELLEN: eigene Termine der Kalender-Karte und ICS-Termine erscheinen; Doppel (Konto + Abo, Konto + Konto)
 *      stehen einmal, fehlender Ort kommt vom Doppel; ein ganztägiger ICS-Eintrag neben dem Zeittermin entfällt.
 *   C  KLICK: öffnet den einzelnen Termin in der Kalender-Karte (markiert, Zeit, Ort, Link zu Outlook/Google);
 *      ein unsicherer Link erscheint nicht; ein eigener Termin öffnet seinen Editor.
 *   D  ALTER ZWISCHENSPEICHER (Fassung 1, M469) bleibt lesbar und wird beim nächsten Abruf auf Fassung 2 gebracht.
 *   E  HINTERGRUND: ohne Erinnerung kein Abruf (auch nicht im Takt); mit Erinnerung holt die App beim Start
 *      Heute/Morgen nach, erinnert an einen nur so bekannten Termin und fragt höchstens alle 15 Minuten.
 *   F  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m471-termine-vollstaendig.mjs`
process.env.TZ = 'Europe/Berlin';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5471;
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

// Feste Uhr: heute 09:10 Ortszeit (Berlin)
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const basis = new Date(); basis.setHours(9, 10, 0, 0);
const H = iso(basis);
const M = iso(new Date(basis.getFullYear(), basis.getMonth(), basis.getDate() + 1));
const U = iso(new Date(basis.getFullYear(), basis.getMonth(), basis.getDate() + 2));
const T = (tag) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.`;
/** Ortszeit → Graph-Weltzeit ohne Versatz („…T13:00:00.0000000") */
const welt = (tag, zeit) => `${new Date(`${tag}T${zeit}:00`).toISOString().slice(0, 19)}.0000000`;
/** Ortszeit → RFC 3339 mit Versatz, wie Google ihn liefert */
const mitVersatz = (tag, zeit) => {
  const d = new Date(`${tag}T${zeit}:00`);
  const v = -d.getTimezoneOffset();
  return `${tag}T${zeit}:00${v >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(v) / 60))}:${pad(Math.abs(v) % 60)}`;
};

const GOOGLE_LINK = 'https://www.google.com/calendar/event?eid=dGVhbXJ1bmRl';
const OUTLOOK_LINK = 'https://outlook.office365.com/owa/?itemid=AAMkAGI2&exvsurl=1&path=/calendar/item';
const GOOGLE = [
  { id: 'g-ausflug', summary: 'Betriebsausflug', start: { date: H }, end: { date: U } },
  { id: 'g-team', summary: 'Teamrunde', start: { dateTime: mitVersatz(H, '09:30') }, end: { dateTime: mitVersatz(H, '10:30') }, location: 'Raum 2', htmlLink: GOOGLE_LINK },
  { id: 'g-abnahme', summary: 'Abnahme Halle', start: { dateTime: mitVersatz(H, '11:00') }, end: { dateTime: mitVersatz(H, '12:00') } },
];
const OUTLOOK = [
  { id: 'ms-abnahme', subject: 'Abnahme Halle', isAllDay: false, start: { dateTime: welt(H, '11:00'), timeZone: 'UTC' }, end: { dateTime: welt(H, '12:00'), timeZone: 'UTC' }, location: { displayName: 'Hof' } },
  { id: 'ms-bau', subject: 'Bauabnahme', isAllDay: false, start: { dateTime: welt(H, '14:00'), timeZone: 'UTC' }, end: { dateTime: welt(H, '15:30'), timeZone: 'UTC' }, location: { displayName: 'Halle Nord' }, webLink: OUTLOOK_LINK },
  { id: 'ms-frei', subject: 'Feiertag Betrieb', isAllDay: true, start: { dateTime: `${M}T00:00:00.0000000`, timeZone: 'UTC' }, end: { dateTime: `${U}T00:00:00.0000000`, timeZone: 'UTC' } },
  { id: 'ms-gefahr', subject: 'Gefahr', isAllDay: false, start: { dateTime: welt(M, '10:00'), timeZone: 'UTC' }, end: { dateTime: welt(M, '11:00'), timeZone: 'UTC' }, webLink: 'javascript:alert(1)' },
];
/** nur für E: ein Termin, den bisher kein Abruf kannte */
const KURZ = { id: 'g-kurz', summary: 'Kurzfristig', start: { dateTime: mitVersatz(H, '09:20') }, end: { dateTime: mitVersatz(H, '09:50') } };
const KONTEN = {
  google: { clientId: 'g-id', token: 'g-tok', tokenExp: 4102444800000, connectedAs: 'Ich', calendars: [{ id: 'primary', name: 'Ich', enabled: true }] },
  ms: { clientId: 'ms-id', tenant: 'common', token: 'ms-tok', tokenExp: 4102444800000, refreshToken: 'ms-ref', scopes: 'Calendars.Read User.Read offline_access', connectedAs: 'Hanna' },
};
const KAL = {
  myEvents: [{ id: 'e-zahn', date: H, title: 'Zahnarzt', time: '16:00', end: '16:45', place: 'Praxis' }],
  icsEvents: [
    { title: 'Müllabfuhr', start: M, startTime: '07:00', uid: 'u-muell' },
    { title: 'Bauabnahme', start: H },
    { title: 'Teamrunde', start: H, startTime: '09:30' },
  ],
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

const auf = async ({ erinnern = false, cache = null, kaputt = false, extraGoogle = [] } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin', viewport: { width: 1440, height: 900 } });
  const log = { google: [], graph: [] };
  const json = (route, obj) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
  await ctx.route('https://www.googleapis.com/**', (route) => {
    const url = new URL(route.request().url());
    log.google.push({ pfad: url.pathname, fields: url.searchParams.get('fields') });
    if (kaputt) return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '' });
    const von = Date.parse(url.searchParams.get('timeMin')); const bis = Date.parse(url.searchParams.get('timeMax'));
    const drin = (e) => {
      const a = new Date(e.start.dateTime ?? `${e.start.date}T00:00:00`).getTime();
      const b = new Date(e.end?.dateTime ?? `${e.end?.date ?? e.start.date}T00:00:00`).getTime();
      return a < bis && Math.max(a + 1, b) > von;
    };
    return json(route, { items: [...GOOGLE, ...extraGoogle].filter(drin) });
  });
  await ctx.route('https://graph.microsoft.com/**', (route) => {
    const url = new URL(route.request().url());
    log.graph.push({ pfad: url.pathname, select: url.searchParams.get('$select'), prefer: route.request().headers().prefer });
    if (kaputt) return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '' });
    const von = Date.parse(url.searchParams.get('startDateTime')); const bis = Date.parse(url.searchParams.get('endDateTime'));
    const drin = (e) => { const a = Date.parse(`${e.start.dateTime.slice(0, 19)}Z`); const b = Date.parse(`${e.end.dateTime.slice(0, 19)}Z`); return a < bis && b > von; };
    return json(route, { value: OUTLOOK.filter(drin) });
  });
  await ctx.route(/^https?:\/\/(?!localhost|www\.googleapis\.com|graph\.microsoft\.com)/, (route) => route.abort());
  await ctx.addInitScript(([k, H, kal, erinnern, cache]) => {
    if (localStorage.getItem('pixinotes-onboarded')) return;
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-cal-accounts', JSON.stringify(k));
    if (erinnern) localStorage.setItem('pixinotes-termin-erinnerung', '1');
    if (cache) localStorage.setItem('pixinotes-cal-termine', JSON.stringify(cache));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [
        { id: 'b1', name: 'Planung', edges: [], drawings: [], comments: [], nodes: [
          { id: 'n1', type: 'note', width: 300, height: 160, position: { x: 0, y: 0 }, data: { title: 'Notiz' } },
        ] },
        { id: 'b2', name: 'Kalender', edges: [], drawings: [], comments: [], nodes: [
          { id: 'kal', type: 'calendar', width: 520, height: 420, position: { x: 60, y: 60 }, data: kal },
        ] },
      ],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1', 'b2'] }] }], activeId: 'b1', view: 'board', cardFocus: false, clickZoom: false, physicsEnabled: false,
      brain: { on: false, provider: 'auto' } } }));
  }, [KONTEN, H, KAL, erinnern, cache]);
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
const tagZeilen = (P) => abschnitt(P).evaluate((s) => {
  const aus = { heute: [], morgen: [] }; let tag = '';
  for (const el of s.querySelectorAll('.th-termine-tag, button.th-termin')) {
    if (el.classList.contains('th-termine-tag')) tag = /Heute/.test(el.textContent) ? 'heute' : 'morgen';
    else aus[tag].push(el.innerText.replace(/\s+/g, ' ').trim());
  }
  return aus;
});
const toast = (P) => P.locator('.toast').innerText().catch(() => '');
const anzahl = (log) => log.google.length + log.graph.length;

// ---------- A, B ----------
console.log('A  Felder: Kennung, Ende, Ort, Link');
let { ctx, P, log } = await auf();
await zentrale(P);
pruefe('A1 Google fragt Kennung, Ende, Ort und Link ab', log.google.some((l) => /\bid\b/.test(l.fields ?? '') && /end/.test(l.fields) && /location/.test(l.fields) && /htmlLink/.test(l.fields)), log.google);
pruefe('A2 Graph fragt Kennung, Ende, Ort und Link ab, in Weltzeit', log.graph.some((l) => /\bid\b/.test(l.select ?? '') && /end/.test(l.select) && /location/.test(l.select) && /webLink/.test(l.select) && /UTC/.test(l.prefer ?? '')), log.graph);
const tz = await tagZeilen(P);
console.log('    heute ', tz.heute);
console.log('    morgen', tz.morgen);
pruefe('A3 Beginn–Ende und Ort (Google)', tz.heute.includes('09:30–10:30 Teamrunde Raum 2 Google'), tz.heute);
pruefe('A4 Outlook-Weltzeit in Ortszeit: 14:00–15:30, mit Ort', tz.heute.includes('14:00–15:30 Bauabnahme Halle Nord Outlook'), tz.heute);
pruefe('A5 Ganztägiges oben, Mehrtägiges heute „bis …"', tz.heute[0] === `bis ${T(M)} Betriebsausflug Google`, tz.heute);
pruefe('A6 morgen: ganztägige zuerst (Fortsetzung + Outlook-Ganztag am richtigen Tag)', tz.morgen[0] === 'ganztägig Betriebsausflug Google' && tz.morgen[1] === 'ganztägig Feiertag Betrieb Outlook', tz.morgen);
const st = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-cal-termine')));
const team = st?.tage?.[H]?.find((e) => e.title === 'Teamrunde');
pruefe('A7 Zwischenspeicher Fassung 2 mit Kennung, Ende, Ort, Link', st?.v === 2 && team?.id === 'g-team' && team?.end === '10:30' && team?.place === 'Raum 2' && team?.link === GOOGLE_LINK, team);

console.log('B  Eigene und ICS-Termine, Doppel');
pruefe('B1 eigener Termin der Kalender-Karte', tz.heute.includes('16:00–16:45 Zahnarzt Praxis Kalender'), tz.heute);
pruefe('B2 ICS-Termin (Abo) mit Uhrzeit morgen', tz.morgen.includes('07:00 Müllabfuhr Abo'), tz.morgen);
const alle = [...tz.heute, ...tz.morgen];
pruefe('B3 Konto + Abo: Teamrunde einmal', alle.filter((x) => x.includes('Teamrunde')).length === 1, alle);
pruefe('B4 Google + Outlook: Abnahme Halle einmal, Ort vom Doppel', alle.filter((x) => x.includes('Abnahme Halle')).length === 1 && alle.includes('11:00–12:00 Abnahme Halle Hof Google'), alle);
pruefe('B5 ganztägiger ICS-Eintrag neben dem Zeittermin entfällt', alle.filter((x) => x.includes('Bauabnahme')).length === 1, alle);
pruefe('B6 Reihenfolge heute: ganztägig, dann nach Uhrzeit', JSON.stringify(tz.heute.map((x) => x.split(' ')[0])) === JSON.stringify([`bis`, '09:30–10:30', '11:00–12:00', '14:00–15:30', '16:00–16:45']), tz.heute);

// ---------- C ----------
console.log('C  Klick öffnet den einzelnen Termin');
await abschnitt(P).locator('button.th-termin', { hasText: 'Bauabnahme' }).click();
await P.waitForTimeout(1500);
const aktiv = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.activeId);
const karte = P.locator('.react-flow__node[data-id="kal"]');
const dlg = karte.locator('[role="dialog"][aria-label="Termin"]');
const dText = (await dlg.innerText().catch(() => '')).replace(/\s+/g, ' ');
pruefe('C1 Board „Kalender" offen, Termin-Angaben in der Karte', aktiv === 'b2' && dText.includes('Bauabnahme') && dText.includes('14:00–15:30') && dText.includes('Halle Nord'), [aktiv, dText]);
const a = dlg.locator('a.cal-termin-link');
const href = await a.getAttribute('href').catch(() => null);
pruefe('C2 Link „In Outlook öffnen" führt zum Outlook-Termin (neuer Tab, ohne Rückgriff)', href === OUTLOOK_LINK && (await a.innerText()) === 'In Outlook öffnen' && (await a.getAttribute('target')) === '_blank' && /noopener/.test(await a.getAttribute('rel')), href);
const mark = await karte.locator('.cal-chip[aria-current="true"]').allInnerTexts();
pruefe('C3 der Termin ist im Raster markiert (genau einer)', mark.length === 1 && mark[0].includes('Bauabnahme'), mark);
// Google-Link
await zentrale(P);
await abschnitt(P).locator('button.th-termin', { hasText: 'Teamrunde' }).click();
await P.waitForTimeout(1500);
const href2 = await dlg.locator('a.cal-termin-link').getAttribute('href').catch(() => null);
pruefe('C4 Google-Termin: „In Google Kalender öffnen" mit htmlLink', href2 === GOOGLE_LINK && (await dlg.locator('a.cal-termin-link').innerText()) === 'In Google Kalender öffnen', href2);
// unsicherer Link (morgen)
await zentrale(P);
await abschnitt(P).locator('button.th-termin', { hasText: 'Gefahr' }).click();
await P.waitForTimeout(1500);
pruefe('C5 javascript:-Link erscheint nicht', (await dlg.innerText().catch(() => '')).includes('Gefahr') && await dlg.locator('a').count() === 0);
// eigener Termin → Editor
await zentrale(P);
await abschnitt(P).locator('button.th-termin', { hasText: 'Zahnarzt' }).click();
await P.waitForTimeout(1500);
const titel = await karte.locator('.cal-evform-title').inputValue().catch(() => '');
pruefe('C6 eigener Termin öffnet seinen Editor', titel === 'Zahnarzt', titel);
await ctx.close();

// ---------- D ----------
console.log('D  Alter Zwischenspeicher (Fassung 1)');
const ALT = { stand: basis.getTime() - 60_000, tage: { [H]: [{ date: H, title: 'Alter Termin', time: '08:00', provider: 'google' }], [M]: [] } };
({ ctx, P, log } = await auf({ cache: ALT, kaputt: true }));
await zentrale(P);
let z = await zeilen(P);
pruefe('D1 Einträge der Fassung 1 werden gezeigt (Konten gerade nicht erreichbar)', z.some((x) => x.startsWith('08:00 Alter Termin') && x.endsWith('Google')), z);
pruefe('D2 Fassung 1 gilt als alt: das Öffnen fragt neu', anzahl(log) > 0, log);
await ctx.close();
({ ctx, P, log } = await auf({ cache: ALT }));
await zentrale(P);
z = await zeilen(P);
const st2 = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-cal-termine')));
pruefe('D3 nach dem Abruf Fassung 2, alter Eintrag ersetzt', st2?.v === 2 && !z.some((x) => x.includes('Alter Termin')) && z.some((x) => x.includes('Bauabnahme')), [st2?.v, z]);
await ctx.close();

// ---------- E ----------
console.log('E  Hintergrund-Abruf nur mit Erinnerung');
({ ctx, P, log } = await auf({ extraGoogle: [KURZ] }));
pruefe('E1 ohne Erinnerung: beim Start keine Anfrage', anzahl(log) === 0, log);
await P.clock.fastForward('20:00');
await P.waitForTimeout(800);
pruefe('E2 ohne Erinnerung: auch im Takt keine Anfrage', anzahl(log) === 0, log);
await ctx.close();
({ ctx, P, log } = await auf({ erinnern: true, extraGoogle: [KURZ] }));
pruefe('E3 mit Erinnerung: beim Start Heute/Morgen nachgeholt', log.google.length > 0 && log.graph.length > 0, log);
const t1 = await toast(P);
pruefe('E4 Erinnerung an einen nur so bekannten Termin (09:20 Kurzfristig)', t1.includes('Termin um 09:20') && t1.includes('Kurzfristig'), t1);
const n1 = anzahl(log);
await P.clock.fastForward('05:00');
await P.waitForTimeout(800);
pruefe('E5 nach 5 Minuten kein neuer Abruf (gedrosselt)', anzahl(log) === n1, [n1, anzahl(log)]);
await P.reload({ waitUntil: 'networkidle' });
await P.waitForTimeout(3000);
pruefe('E6 Neuladen innerhalb der Viertelstunde: kein neuer Abruf', anzahl(log) === n1, [n1, anzahl(log)]);
await P.clock.fastForward('12:00');
await P.waitForTimeout(1000);
pruefe('E7 nach über 15 Minuten wieder ein Abruf', anzahl(log) > n1, [n1, anzahl(log)]);
await ctx.close();

console.log('F  Fehler');
pruefe('F1 keine Seitenfehler', fehler.length === 0, fehler);

await browser.close();
app.close();
console.log(`\nM471: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
