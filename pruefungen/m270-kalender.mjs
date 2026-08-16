/**
 * M270 — „kalender.. bitte auch jahresansicht. und eine möglichkeit alle
 * termine oder auch wahlweise einen zeitraum mit terminen (nicht nur
 * sichtbare) als für outlook exportierbar zu machen!"
 *
 * Der Prüfgedanke: Es werden Termine über MEHRERE Jahre angelegt, von denen
 * im Monat immer nur ein Bruchteil sichtbar ist. Dann wird gemessen, was
 * tatsächlich in der .ics-Datei landet — und ob die Datei das Format hat, das
 * Outlook erwartet (Uhrzeiten, Maskierung, Ganztages-Ende exklusiv).
 */
// Läuft aus dem Repository: `node pruefungen/m270-kalender.mjs`
// Voraussetzung: `npm run build` (die Reihe prüft den dist/-Stand) und ein
// Chromium — Pfad über die Umgebungsvariable PW_CHROMIUM, sonst der
// Standardpfad der Claude-Umgebung.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4491;
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

/** Termine über drei Jahre — nur ein Bruchteil ist je gleichzeitig sichtbar */
const TERMINE = [
  { id: 'e1', date: '2026-03-04', title: 'Sitzung Gemeinsame Kommission', time: '09:00', end: '11:30', place: 'Raum 3.14', note: 'Tischvorlage mitbringen' },
  { id: 'e2', date: '2026-08-14', title: 'Sommerfest, mit Grillen', time: '17:00' },
  { id: 'e3', date: '2027-05-12', title: 'Abschlusspruefung Deutsch' },
  { id: 'e4', date: '2027-05-15', title: 'Abschlusspruefung Mathematik', time: '08:30', end: '11:00' },
  { id: 'e5', date: '2027-11-02', title: 'Klausurtagung', endDate: '2027-11-04' },
  { id: 'e6', date: '2028-01-09', title: 'Jahresauftakt' },
];
const JAHR_2027 = TERMINE.filter((t) => t.date.startsWith('2027'));

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
await ctx.addInitScript((termine) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
  const nodes = [{
    id: 'cal', type: 'calendar', position: { x: 40, y: 40 }, width: 900, height: 640,
    data: { month: '2027-05', myEvents: termine },
  }];
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
    spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
}, TERMINE);
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2200);

const kalMenue = async () => {
  const offen = await P.evaluate(() => !!document.querySelector('.cal-menu:not(.cal-dayedit)'));
  if (!offen) {
    await P.evaluate(() => {
      document.querySelector('.cal-nav button[aria-label="Kalender-Optionen"]')?.click();
    });
    await P.waitForTimeout(500);
  }
};
const menueKnopf = (text) => P.evaluate((t) => {
  const m = document.querySelector('.cal-menu:not(.cal-dayedit)');
  const b = [...(m?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim().startsWith(t));
  if (!b) return 'FEHLT';
  b.click();
  return 'ok';
}, text);

// ══ T1: Es gibt eine Jahresansicht ═══════════════════════════════════
console.log('════ T1: Jahresansicht ════');
{
  const start = await P.evaluate(() => document.querySelector('.cal-nav button:nth-of-type(3)')?.textContent.trim());
  console.log('    Umschalter zeigt zunächst:', start);
  pruefe('T1a der Umschalter beginnt bei „Woche" (Monatsansicht)', start === 'Woche');
  // Monat → Woche → Jahr
  await P.evaluate(() => [...document.querySelectorAll('.cal-nav button')].find((b) => b.textContent.trim() === 'Woche')?.click());
  await P.waitForTimeout(500);
  await P.evaluate(() => [...document.querySelectorAll('.cal-nav button')].find((b) => b.textContent.trim() === 'Jahr')?.click());
  await P.waitForTimeout(900);
  const jahr = await P.evaluate(() => ({
    raster: !!document.querySelector('.cal-jahr'),
    monate: document.querySelectorAll('.cal-jahr-monat').length,
    titel: document.querySelector('.cal-title')?.textContent.trim(),
    belegte: document.querySelectorAll('.cal-jahr-tag.voll').length,
    koepfe: [...document.querySelectorAll('.cal-jahr-kopf')].map((b) => b.textContent.trim()),
  }));
  console.log('   ', JSON.stringify(jahr));
  pruefe('T1b das Jahresraster ist da', jahr.raster);
  pruefe('T1c es zeigt zwölf Monate', jahr.monate === 12, String(jahr.monate));
  pruefe('T1d die Kopfzeile nennt das Jahr', jahr.titel === '2027', jahr.titel);
  pruefe('T1e die Monate sind beschriftet', jahr.koepfe.length === 12 && jahr.koepfe[0].startsWith('Jan'),
    JSON.stringify(jahr.koepfe));
  // 2027 hat drei Einzeltermine + einen dreitägigen Streifen = 3 + 3 belegte Tage
  pruefe('T1f genau die Tage mit Terminen sind markiert', jahr.belegte === 5,
    `${jahr.belegte} markierte Tage, erwartet 5 (12.5., 15.5., 2.–4.11.)`);

  await P.screenshot({ path: `${SD}/m270-jahr.png` });

  // Weiterblättern springt ein JAHR
  await P.evaluate(() => [...document.querySelectorAll('.cal-nav button')].find((b) => b.getAttribute('aria-label') === 'Weiter')?.click());
  await P.waitForTimeout(700);
  const naechstes = await P.evaluate(() => ({
    titel: document.querySelector('.cal-title')?.textContent.trim(),
    belegte: document.querySelectorAll('.cal-jahr-tag.voll').length,
  }));
  console.log('    nach „Weiter":', JSON.stringify(naechstes));
  pruefe('T1g „Weiter" blättert ein Jahr', naechstes.titel === '2028', naechstes.titel);
  pruefe('T1h 2028 hat genau einen belegten Tag', naechstes.belegte === 1, String(naechstes.belegte));

  // Klick auf einen Monat führt in die Monatsansicht
  await P.evaluate(() => document.querySelectorAll('.cal-jahr-kopf')[2]?.click());
  await P.waitForTimeout(700);
  const zurueck = await P.evaluate(() => ({
    grid: !!document.querySelector('.cal-grid'),
    titel: document.querySelector('.cal-title')?.textContent.trim(),
  }));
  console.log('    nach Monatsklick:', JSON.stringify(zurueck));
  pruefe('T1i ein Klick auf den Monat öffnet ihn', zurueck.grid && /März 2028/.test(zurueck.titel ?? ''),
    JSON.stringify(zurueck));
}

// ══ T2: Export — alle Termine, nicht nur sichtbare ════════════════════
console.log('\n════ T2: Export aller Termine ════');
{
  // zurück auf Mai 2027 (Monatsansicht)
  await P.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board'));
    return s;
  });
  await kalMenue();
  const auf = await menueKnopf('Alle Termine / Zeitraum exportieren');
  pruefe('T2a der Eintrag „Alle Termine / Zeitraum exportieren…" ist da', auf === 'ok', auf);
  await P.waitForTimeout(500);
  const feld = await P.evaluate(() => {
    const e = document.querySelector('.cal-export');
    if (!e) return null;
    return {
      schnell: [...e.querySelectorAll('.cal-export-schnell button')].map((b) => b.textContent.trim()),
      datumsfelder: e.querySelectorAll('input[type="date"]').length,
    };
  });
  console.log('   ', JSON.stringify(feld));
  pruefe('T2b es gibt Schnellwahl und Zeitraum-Felder',
    feld?.schnell.includes('Alle Termine') && feld?.datumsfelder === 2, JSON.stringify(feld));

  const dl = P.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await P.evaluate(() => {
    [...document.querySelectorAll('.cal-export-schnell button')].find((b) => b.textContent.trim() === 'Alle Termine')?.click();
  });
  const datei = await dl;
  pruefe('T2c die Datei wird erzeugt', !!datei);
  if (datei) {
    const pfad = `${SD}/m270-alle.ics`;
    await datei.saveAs(pfad);
    const ics = readFileSync(pfad, 'utf8');
    const anzahl = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    console.log(`    ${datei.suggestedFilename()} · ${ics.length} Zeichen · ${anzahl} VEVENTs`);
    pruefe('T2d ALLE sechs Termine sind drin — auch die aus 2026 und 2028',
      anzahl === 6, `${anzahl} statt 6`);
    for (const t of TERMINE) {
      pruefe(`T2e „${t.title.slice(0, 28)}" ist enthalten`,
        ics.includes(t.title.replace(/,/g, '\\,')), '');
    }
    pruefe('T2f der Termin aus 2026 ist dabei (weit außerhalb des Sichtbaren)',
      ics.includes('20260304'), '');
    pruefe('T2g der Termin aus 2028 ist dabei', ics.includes('20280109'), '');
  }
}

// ══ T3: Das Format, das Outlook erwartet ══════════════════════════════
console.log('\n════ T3: Outlook-taugliches Format ════');
{
  const ics = readFileSync(`${SD}/m270-alle.ics`, 'utf8');
  pruefe('T3a Kopf und Fuß stimmen',
    ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
  pruefe('T3b Zeilen enden nach RFC mit CRLF', ics.includes('\r\n') && !/[^\r]\n/.test(ics));
  pruefe('T3c VERSION und PRODID sind gesetzt',
    ics.includes('VERSION:2.0') && ics.includes('PRODID:'));
  // Uhrzeit-Termin: 09:00–11:30 am 4.3.2026
  pruefe('T3d ein Termin mit Uhrzeit wird als ZEIT-Termin geschrieben',
    ics.includes('DTSTART:20260304T090000') && ics.includes('DTEND:20260304T113000'),
    ics.split('\r\n').filter((z) => z.startsWith('DTSTART')).join(' | '));
  pruefe('T3e ohne Endzeit gilt eine Stunde',
    ics.includes('DTSTART:20260814T170000') && ics.includes('DTEND:20260814T180000'));
  pruefe('T3f ein Termin ohne Uhrzeit bleibt Ganztages-Termin',
    ics.includes('DTSTART;VALUE=DATE:20270512'));
  pruefe('T3g bei Ganztages-Terminen ist das Ende exklusiv (RFC 5545)',
    ics.includes('DTEND;VALUE=DATE:20270513'),
    ics.split('\r\n').filter((z) => z.startsWith('DTEND;VALUE=DATE')).join(' | '));
  pruefe('T3h der dreitägige Termin endet am 5.11. (exklusiv für 2.–4.11.)',
    ics.includes('DTSTART;VALUE=DATE:20271102') && ics.includes('DTEND;VALUE=DATE:20271105'));
  pruefe('T3i Kommas im Titel sind maskiert', ics.includes('Sommerfest\\, mit Grillen'),
    ics.split('\r\n').find((z) => z.includes('Sommerfest')) ?? '');
  pruefe('T3j Ort und Notiz reisen mit',
    ics.includes('LOCATION:Raum 3.14') && ics.includes('DESCRIPTION:Tischvorlage mitbringen'));
  pruefe('T3k keine Zeile ist länger als 75 Zeichen (Faltung)',
    ics.split('\r\n').every((z) => z.length <= 75),
    ics.split('\r\n').filter((z) => z.length > 75).slice(0, 2).join(' | '));
}

// ══ T4: Export eines Zeitraums ════════════════════════════════════════
console.log('\n════ T4: Export eines Zeitraums ════');
{
  await kalMenue();
  // Nach einem erfolgreichen Export klappt das Feld zu — also erneut öffnen
  if (!(await P.locator('.cal-export').count())) {
    await menueKnopf('Alle Termine / Zeitraum exportieren');
    await P.waitForTimeout(500);
  }
  const dl = P.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await P.locator('.cal-export-spanne input[type="date"]').nth(0).fill('2027-01-01');
  await P.locator('.cal-export-spanne input[type="date"]').nth(1).fill('2027-12-31');
  await P.waitForTimeout(400);
  await P.evaluate(() => {
    [...document.querySelectorAll('.cal-export-spanne button')].find((b) => b.textContent.includes('Zeitraum'))?.click();
  });
  const datei = await dl;
  pruefe('T4a der Zeitraum-Export erzeugt eine Datei', !!datei);
  if (datei) {
    const pfad = `${SD}/m270-2027.ics`;
    await datei.saveAs(pfad);
    const ics = readFileSync(pfad, 'utf8');
    const anzahl = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    console.log(`    ${datei.suggestedFilename()} · ${anzahl} VEVENTs`);
    pruefe('T4b der Dateiname nennt den Zeitraum',
      /2027-01-01.*2027-12-31/.test(datei.suggestedFilename()), datei.suggestedFilename());
    pruefe('T4c genau die drei Termine aus 2027 sind drin',
      anzahl === JAHR_2027.length, `${anzahl} statt ${JAHR_2027.length}`);
    pruefe('T4d 2026 ist NICHT dabei', !ics.includes('20260304'));
    pruefe('T4e 2028 ist NICHT dabei', !ics.includes('20280109'));
    for (const t of JAHR_2027) {
      pruefe(`T4f „${t.title.slice(0, 26)}" ist im Zeitraum`, ics.includes(t.title));
    }
  }
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
