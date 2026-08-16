/**
 * M269 — Dateiinhalte erreichbar machen.
 *
 * Zwei Befunde aus der Praxis:
 *  A) Auf dem Telefon stand auf der Karte „Der Inhalt liegt nicht auf diesem
 *     Gerät" — der Sync trug nur Name und Größe.
 *  B) Neben einer PDF legte die KI eine Notiz an: „Der Dateiinhalt liegt mir
 *     nicht als Text vor" — im KI-Kontext stand nur der Dateiname.
 *
 * Geprüft wird mit einer ECHTEN PDF (selbst gebaut, mit bekanntem Text). Für
 * B wird die Anfrage an den KI-Anbieter ABGEFANGEN und nachgesehen, ob der
 * Text wirklich drinsteht — das ist der einzige Nachweis, der zählt.
 */
// Läuft aus dem Repository: `node pruefungen/m269-dateien.mjs`
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
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4481;
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

/** Winzige, gültige PDF mit echter Textebene — ohne Bibliothek gebaut */
function baueTestPdf(zeilen) {
  const strom = `BT /F1 12 Tf 40 780 Td 14 TL\n${zeilen.map((z) => `(${z.replace(/([()\\])/g, '\\$1')}) Tj T*`).join('\n')}\nET`;
  const objekte = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${strom.length} >>\nstream\n${strom}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objekte.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objekte.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const MARKER = 'Mathematik: 15. Mai 2027';
const ZEILEN = [
  'Pruefungstermine fuer die schriftlichen Abschlusspruefungen',
  'Berufsfeld Haus- und Landwirtschaft',
  'Deutsch: 12. Mai 2027',
  MARKER,
  'Fachtheorie: 19. Mai 2027',
];
const pdfPfad = `${SD}/m269-test.pdf`;
writeFileSync(pdfPfad, baueTestPdf(ZEILEN));
console.log('Test-PDF:', readFileSync(pdfPfad).length, 'Bytes ·', ZEILEN.length, 'Zeilen');

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

/** Seite mit optionaler KI-Konfiguration */
async function seite(mitKi = false, ohneOrdner = false) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  /* Der Dateien-Weg (M190) erscheint nur ohne Ordner-API — genau die Lage auf
     Telefon und iPad, um die es hier geht. Also wird sie hier weggenommen. */
  if (ohneOrdner) await ctx.addInitScript(() => { delete window.showDirectoryPicker; });
  await ctx.addInitScript((ki) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes: [], comments: [] }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: false,
      ...(ki ? { ai: { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } } : {}),
    } }));
  }, mitKi);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}

/** PDF über das versteckte Datei-Eingabefeld einschleusen */
async function pdfEinfuegen(P) {
  const felder = P.locator('input[type="file"]');
  const n = await felder.count();
  for (let i = 0; i < n; i++) {
    try {
      await felder.nth(i).setInputFiles(pdfPfad);
      await P.waitForTimeout(1600);
      if (await P.locator('.file-card').count()) return true;
    } catch { /* nächstes Feld */ }
  }
  return false;
}

// ══ T1: PDF liegt als Karte mit Vorschau auf dem Board ════════════════
console.log('\n════ T1: Die PDF kommt aufs Board ════');
{
  const { ctx, P } = await seite();
  const da = await pdfEinfuegen(P);
  pruefe('T1a die PDF liegt als Datei-Karte auf dem Board', da,
    `Karten: ${await P.locator('.file-card').count()}`);
  if (da) {
    await P.waitForTimeout(1400);
    pruefe('T1b die erste Seite wird als Vorschau gerendert',
      (await P.locator('.file-card canvas').count()) > 0);
    const abl = await P.evaluate(async () => {
      const db = await new Promise((res) => {
        const r = indexedDB.open('pixinotes-sync', 1);
        r.onsuccess = () => res(r.result);
      });
      const keys = await new Promise((res) => {
        const q = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
        q.onsuccess = () => res(q.result);
      });
      const k = keys.find((x) => String(x).startsWith('file:'));
      if (!k) return { anzahl: 0 };
      const blob = await new Promise((res) => {
        const q = db.transaction('kv', 'readonly').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result);
      });
      return { anzahl: keys.filter((x) => String(x).startsWith('file:')).length, groesse: blob?.size ?? 0 };
    });
    console.log('    lokale Ablage:', JSON.stringify(abl));
    pruefe('T1c der Inhalt liegt in der lokalen Ablage', abl.anzahl === 1 && abl.groesse > 300,
      JSON.stringify(abl));
  }
  await ctx.close();
}

// ══ T2: Die KI bekommt den PDF-TEXT, nicht nur den Dateinamen ═════════
console.log('\n════ T2: Was die KI wirklich zu sehen bekommt ════');
{
  const { ctx, P } = await seite(true);
  let gesendet = '';
  await P.route('https://api.openai.com/**', async (route) => {
    gesendet = route.request().postData() ?? '';
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: 'Zusammenfassung: alles klar.' } }] }),
    });
  });
  const da = await pdfEinfuegen(P);
  pruefe('T2a PDF eingefügt', da);
  await P.waitForTimeout(1500);
  // Karte auswählen → ⋯ → KI-Aktionen → Zusammenfassen
  await P.locator('.file-card').first().click({ position: { x: 6, y: 6 } });
  await P.waitForTimeout(700);
  await P.evaluate(() => {
    [...document.querySelectorAll('.sel-toolbar button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click();
  });
  await P.waitForTimeout(600);
  await P.evaluate(() => {
    const m = document.querySelector('.sel-more-menu');
    [...(m?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('KI-Aktionen'))?.click();
  });
  await P.waitForTimeout(600);
  const angestossen = await P.evaluate(() => {
    const m = document.querySelector('.sel-ai-menu');
    const b = [...(m?.querySelectorAll('button') ?? [])].find((x) => x.textContent.includes('Zusammenfassen'));
    if (!b) return false;
    b.click();
    return true;
  });
  pruefe('T2b die KI-Aktion „Zusammenfassen" ist erreichbar', angestossen);
  for (let i = 0; i < 30 && !gesendet; i++) await P.waitForTimeout(400);
  console.log('    gesendete Zeichen:', gesendet.length);
  pruefe('T2c es ging überhaupt eine Anfrage raus', gesendet.length > 0);
  pruefe('T2d der Dateiname steht im Kontext', gesendet.includes('m269-test.pdf'), '');
  pruefe('T2e DER PDF-TEXT steht im Kontext (der eigentliche Punkt)',
    gesendet.includes('Mathematik') && gesendet.includes('15. Mai 2027'),
    `Ausschnitt: ${gesendet.slice(0, 200)}`);
  pruefe('T2f auch die Kopfzeile der PDF ist dabei',
    gesendet.includes('Berufsfeld Haus- und Landwirtschaft'));
  await ctx.close();
}

// ══ T3: Der Sync-Stand nimmt die Datei mit ════════════════════════════
console.log('\n════ T3: Dateien reisen im Sync-Stand mit ════');
{
  const { ctx, P } = await seite(false, true);
  const da = await pdfEinfuegen(P);
  pruefe('T3a PDF eingefügt', da);
  await P.waitForTimeout(1200);

  // Den Stand über den Dateien-Weg erzeugen: Der Download wird abgefangen.
  const dl = P.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await P.locator('button[title^="Einstellungen"]').click();
  await P.waitForTimeout(700);
  await P.locator('.modal button', { hasText: 'Synchronisation' }).first().click();
  await P.waitForTimeout(600);
  const budget = await P.evaluate(() => {
    const knoepfe = [...document.querySelectorAll('.modal-row .seg button')].map((b) => b.textContent.trim());
    const an = [...document.querySelectorAll('.modal-row .seg button.on')].map((b) => b.textContent.trim());
    return { knoepfe: knoepfe.slice(0, 5), an: an[0] };
  });
  console.log('    Budget-Schalter:', JSON.stringify(budget));
  pruefe('T3b die Obergrenze ist einstellbar und steht auf 25 MB',
    budget.knoepfe.includes('25 MB') && budget.an === '25 MB', JSON.stringify(budget));

  const gespeichert = await P.evaluate(() => {
    const b = [...document.querySelectorAll('.modal button')]
      .find((x) => x.textContent.trim().startsWith('Stand sichern'));
    if (!b) return null;
    b.click();
    return b.textContent.trim();
  });
  console.log('    geklickt:', gespeichert);
  const datei = await dl;
  if (datei) {
    const pfad = `${SD}/m269-sync.json`;
    await datei.saveAs(pfad);
    const roh = readFileSync(pfad, 'utf8');
    const stand = JSON.parse(roh);
    const ids = Object.keys(stand.dateien ?? {});
    console.log(`    Sync-Datei: ${Math.round(roh.length / 1024)} KB · Dateien im Beipack: ${ids.length}`);
    pruefe('T3c der Sync-Stand trägt einen Datei-Beipack', ids.length === 1, JSON.stringify(ids));
    const eintrag = stand.dateien?.[ids[0]];
    pruefe('T3d der Beipack nennt Name und Typ',
      eintrag?.name === 'm269-test.pdf' && !!eintrag?.b64, JSON.stringify({ n: eintrag?.name, m: eintrag?.mime }));
    const zurueck = Buffer.from(eintrag.b64, 'base64');
    pruefe('T3e der Inhalt kommt Byte für Byte an',
      zurueck.equals(readFileSync(pdfPfad)), `${zurueck.length} gegen ${readFileSync(pdfPfad).length} Bytes`);
    pruefe('T3f KEINE Zugangsdaten im Stand',
      !/apiKey|passwor|token|webdav/i.test(roh), 'Achtung: verdächtige Zeichenkette gefunden');

    // ══ T4: Ein zweites Gerät übernimmt den Stand — samt Datei ══════════
    console.log('\n════ T4: Das zweite Gerät sieht die Datei ════');
    const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx2.addInitScript(() => { delete window.showDirectoryPicker; });
    await ctx2.addInitScript(() => {
      localStorage.setItem('pixinotes-onboarded', '1');
      localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    });
    const Z = await ctx2.newPage();
    Z.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
    // Das Laden fragt sicherheitshalber nach („Boards werden ersetzt") —
    // ohne Zustimmung passiert nichts, und Playwright lehnt still ab.
    Z.on('dialog', (d) => d.accept());
    await Z.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await Z.waitForTimeout(1800);
    await Z.locator('button[title^="Einstellungen"]').click();
    await Z.waitForTimeout(700);
    await Z.locator('.modal button', { hasText: 'Synchronisation' }).first().click();
    await Z.waitForTimeout(600);
    // Das Eingabefeld für „Stand laden" füttern
    const felder = Z.locator('.modal input[type="file"]');
    const n = await felder.count();
    let geladen = false;
    for (let i = 0; i < n; i++) {
      try {
        await felder.nth(i).setInputFiles(pfad);
        await Z.waitForTimeout(2500);
        if (await Z.locator('.file-card').count()) { geladen = true; break; }
      } catch { /* nächstes */ }
    }
    if (!geladen) {
      await Z.keyboard.press('Escape');
      await Z.waitForTimeout(800);
      geladen = (await Z.locator('.file-card').count()) > 0;
    }
    pruefe('T4a der Stand ist übernommen (die Karte ist da)', geladen,
      `Karten: ${await Z.locator('.file-card').count()}`);
    if (geladen) {
      await Z.keyboard.press('Escape');
      await Z.waitForTimeout(2500);
      const zustand = await Z.evaluate(() => ({
        platzhalter: !!document.querySelector('.file-nopreview'),
        vorschau: document.querySelectorAll('.file-card canvas').length,
      }));
      console.log('    zweites Gerät:', JSON.stringify(zustand));
      pruefe('T4b kein „liegt nicht auf diesem Gerät" mehr', zustand.platzhalter === false,
        JSON.stringify(zustand));
      pruefe('T4c die Vorschau wird auch hier gerendert', zustand.vorschau > 0, JSON.stringify(zustand));
      await Z.screenshot({ path: `${SD}/m269-zweites-geraet.png` });
    }
    await ctx2.close();
  } else {
    pruefe('T3c der Sync-Stand ließ sich sichern', false, 'kein Download ausgelöst');
  }
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
