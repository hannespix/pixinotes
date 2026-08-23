/**
 * M290 — „kann man auf Android irgendwie eine Teilen-mit-Funktion wählen bei
 * anderen Apps und dann die PWA PixiNotes als Ziel auswählen? … dann in der
 * App auswählen wohin es kopiert/eingefügt wird"
 *
 * Ja — über das Web Share Target. Damit das trägt, müssen drei Dinge
 * zusammenspielen, und genau die prüft diese Reihe:
 *  1. Das Manifest meldet PixiNotes im Teilen-Menü an (sonst taucht es dort
 *     gar nicht auf).
 *  2. Der Service Worker fängt die POST-Anfrage ab. Ohne ihn liefe sie gegen
 *     eine Adresse, die es auf GitHub Pages nicht gibt — ein statischer Server
 *     nimmt keine Formulare an.
 *  3. Die App fragt danach, WOHIN das Geteilte soll, statt es blind irgendwo
 *     abzulegen.
 *
 * Der Teilen-Dialog von Android selbst lässt sich im Prüflauf nicht bedienen
 * (das ist Betriebssystem, kein Browser-Fenster). Nachgestellt wird deshalb
 * exakt das, was Android schickt: ein POST mit multipart/form-data an
 * „./teilen-ziel".
 */
// Läuft aus dem Repository: `node pruefungen/m290-teilen-ziel.mjs`
// Voraussetzung: `npm run build` und ein Chromium (PW_CHROMIUM).
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

const DIST = path.join(__repo, 'dist');
const PORT = 4510;
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  let f = join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  const typ = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  }[extname(f)] ?? 'application/octet-stream';
  r.writeHead(200, { 'Content-Type': typ, 'Service-Worker-Allowed': '/' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

async function seite(viewport = { width: 1280, height: 860 }, finger = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: finger, isMobile: finger });
  await ctx.addInitScript(() => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [
        { id: 'b0', name: 'Schreibtisch', edges: [], drawings: [], comments: [], nodes: [
          { id: 'n1', type: 'note', position: { x: 60, y: 60 }, width: 300, height: 200,
            data: { color: 'yellow', blocks: [{ id: 'p1', type: 'paragraph', props: {},
              content: [{ type: 'text', text: 'Sammelnotiz', styles: {} }], children: [] }] } }] },
        { id: 'b1', name: 'Urlaub', edges: [], drawings: [], comments: [], nodes: [] },
      ],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'Alltag', boardIds: ['b0', 'b1'] }] }],
      activeId: 'b0', view: 'board', cardFocus: true } }));
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2000);
  // Auf den Service Worker warten — er ist der Empfänger des Teilens
  const swDa = await P.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    return !!reg?.active;
  });
  return { ctx, P, swDa };
}

/** Genau das, was Android schickt: multipart-POST an ./teilen-ziel */
const teile = (P, { mitBild = true, text = '' } = {}) => P.evaluate(async ([mitBild, text]) => {
  const fd = new FormData();
  if (mitBild) {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const x = c.getContext('2d'); x.fillStyle = '#0a7d40'; x.fillRect(0, 0, 300, 200);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    fd.append('dateien', new File([blob], 'urlaubsfoto.png', { type: 'image/png' }));
  }
  if (text) { fd.append('titel', 'Geteilter Titel'); fd.append('text', text); }
  const antwort = await fetch('./teilen-ziel', { method: 'POST', body: fd, redirect: 'follow' });
  return { url: antwort.url, status: antwort.status, umgeleitet: antwort.redirected };
}, [mitBild, text]);

const eingang = (P) => P.evaluate(() => new Promise((ok) => {
  const a = indexedDB.open('pixinotes-geteilt', 1);
  a.onsuccess = () => {
    const db = a.result;
    if (!db.objectStoreNames.contains('eingang')) { ok(null); return; }
    const g = db.transaction('eingang', 'readonly').objectStore('eingang').get('letztes');
    g.onsuccess = () => ok(g.result
      ? { titel: g.result.titel, text: g.result.text,
          dateien: g.result.dateien.map((d) => ({ name: d.name, typ: d.typ, groesse: d.blob.size })) }
      : null);
    g.onerror = () => ok(null);
  };
  a.onerror = () => ok(null);
}));

const stand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);

// ══ T1: Ohne Manifest-Eintrag steht PixiNotes gar nicht im Teilen-Menü ══
console.log('════ T1: Anmeldung im Teilen-Menü ════');
{
  const m = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'));
  const st = m.share_target;
  console.log('    share_target:', JSON.stringify(st));
  pruefe('T1a das Manifest meldet ein Teilen-Ziel an', !!st, JSON.stringify(Object.keys(m)));
  pruefe('T1b als POST mit multipart (nur so kommen DATEIEN mit)',
    st?.method?.toUpperCase() === 'POST' && st?.enctype === 'multipart/form-data', JSON.stringify(st));
  pruefe('T1c Bilder sind ausdrücklich erlaubt',
    (st?.params?.files?.[0]?.accept ?? []).some((a) => a.startsWith('image/')), JSON.stringify(st?.params?.files));
  pruefe('T1d Titel, Text und Adresse werden ebenfalls angenommen',
    !!st?.params?.title && !!st?.params?.text && !!st?.params?.url, JSON.stringify(st?.params));
}

// ══ T2: Der Service Worker nimmt das Geteilte an ════════════════════
console.log('\n════ T2: Empfang im Service Worker ════');
{
  const { ctx, P, swDa } = await seite();
  pruefe('T2a der Service Worker läuft (ohne ihn geht gar nichts)', swDa);
  const a = await teile(P, { text: 'Fähre nach Amrum buchen' });
  console.log('    Antwort:', JSON.stringify(a));
  pruefe('T2b die POST-Anfrage endet in der App, nicht im Nichts',
    /\?geteilt=1$/.test(a.url), JSON.stringify(a));
  const e = await eingang(P);
  console.log('    Eingang:', JSON.stringify(e));
  pruefe('T2c die geteilte Datei liegt in der Geräte-Ablage',
    e?.dateien?.length === 1 && e.dateien[0].groesse > 0, JSON.stringify(e));
  pruefe('T2d und der geteilte Text ebenfalls',
    /Amrum/.test(e?.text ?? ''), JSON.stringify(e));
  await ctx.close();
}

// ══ T3: Die App fragt, WOHIN — der eigentliche Wunsch ═══════════════
console.log('\n════ T3: Zielwahl in der App ════');
{
  const { ctx, P } = await seite();
  await teile(P, { text: 'Notiz aus dem Browser' });
  await P.goto(`http://localhost:${PORT}/?geteilt=1`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  const da = await P.locator('.geteilt-modal').count();
  pruefe('T3a der Empfangs-Dialog erscheint', da > 0);
  if (da) {
    const boards = await P.evaluate(() =>
      [...document.querySelectorAll('.geteilt-modal select option')].map((o) => o.textContent.trim()));
    console.log('    Ziele:', JSON.stringify(boards));
    pruefe('T3b man kann JEDES Board als Ziel wählen',
      boards.includes('Schreibtisch') && boards.includes('Urlaub'), JSON.stringify(boards));
    const formen = await P.evaluate(() =>
      [...document.querySelectorAll('.geteilt-wahl label')].map((l) => l.textContent.trim()));
    pruefe('T3c und die Form: Karten oder in eine Notiz',
      formen.length === 2 && /Karten/.test(formen[0]) && /Notiz/.test(formen[1]), JSON.stringify(formen));
    pruefe('T3d die Vorschau zeigt, was angekommen ist',
      await P.locator('.geteilt-vorschau img').count() === 1
      && /Browser/.test(await P.locator('.geteilt-text').first().textContent() ?? ''));
    pruefe('T3e die Marke verschwindet aus der Adresse (kein zweites Mal beim Neuladen)',
      !(await P.evaluate(() => location.search.includes('geteilt'))));
    await P.screenshot({ path: `${SD}/m290-dialog.png` });
  }
  await ctx.close();
}

// ══ T4: Übernehmen als Karten — auf dem GEWÄHLTEN Board ═════════════
console.log('\n════ T4: Als Karten auf ein anderes Board ════');
{
  const { ctx, P } = await seite();
  await teile(P, { text: 'Fähre buchen' });
  await P.goto(`http://localhost:${PORT}/?geteilt=1`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  await P.locator('.geteilt-modal select').first().selectOption({ label: 'Urlaub' });
  await P.locator('.geteilt-ok').click();
  await P.waitForTimeout(2500);
  const st = await stand(P);
  const urlaub = st.boards.find((b) => b.id === 'b1');
  console.log('    Karten auf „Urlaub":', JSON.stringify(urlaub.nodes.map((n) => n.type)));
  pruefe('T4a das Bild wird eine Karte auf dem gewählten Board',
    urlaub.nodes.some((n) => n.type === 'image'), JSON.stringify(urlaub.nodes.map((n) => n.type)));
  pruefe('T4b der geteilte Text wird eine Notiz daneben',
    urlaub.nodes.some((n) => n.type === 'note'), JSON.stringify(urlaub.nodes.map((n) => n.type)));
  pruefe('T4c das Ausgangs-Board bleibt unberührt',
    st.boards.find((b) => b.id === 'b0').nodes.length === 1);
  pruefe('T4d und man steht danach auf dem Ziel-Board', st.activeId === 'b1', st.activeId);
  pruefe('T4e der Eingang ist geleert', (await eingang(P)) === null);
  await P.screenshot({ path: `${SD}/m290-karten.png` });
  await ctx.close();
}

// ══ T5: Übernehmen in eine bestehende Notiz ═════════════════════════
console.log('\n════ T5: In eine Notiz einfügen ════');
{
  const { ctx, P } = await seite();
  await teile(P, { text: 'Gehört in die Sammelnotiz' });
  await P.goto(`http://localhost:${PORT}/?geteilt=1`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  await P.locator('.geteilt-wahl input[type="radio"]').nth(1).check();
  await P.waitForTimeout(400);
  const notizWahl = await P.locator('.geteilt-modal select').count();
  pruefe('T5a jetzt lässt sich auch die Notiz wählen', notizWahl === 2, String(notizWahl));
  await P.locator('.geteilt-ok').click();
  await P.waitForTimeout(2800);
  const st = await stand(P);
  const notiz = st.boards.find((b) => b.id === 'b0').nodes.find((n) => n.id === 'n1');
  const typen = notiz.data.blocks.map((b) => b.type);
  console.log('    Blöcke der Notiz:', JSON.stringify(typen));
  pruefe('T5b das Bild landet IM Text der Notiz', typen.includes('image'), JSON.stringify(typen));
  pruefe('T5c der geteilte Text ebenfalls',
    JSON.stringify(notiz.data.blocks).includes('Sammelnotiz gehört') || /Sammelnotiz/.test(JSON.stringify(notiz.data.blocks)),
    JSON.stringify(typen));
  pruefe('T5d es entsteht KEINE zusätzliche Karte',
    st.boards.find((b) => b.id === 'b0').nodes.length === 1,
    JSON.stringify(st.boards.find((b) => b.id === 'b0').nodes.map((n) => n.type)));
  await ctx.close();
}

// ══ T6: Verwerfen lässt nichts liegen ═══════════════════════════════
console.log('\n════ T6: Verwerfen ════');
{
  const { ctx, P } = await seite();
  await teile(P, {});
  await P.goto(`http://localhost:${PORT}/?geteilt=1`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  await P.locator('.geteilt-verwerfen').click();
  await P.waitForTimeout(1200);
  pruefe('T6a der Dialog schließt', await P.locator('.geteilt-modal').count() === 0);
  pruefe('T6b und der Eingang ist leer', (await eingang(P)) === null);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  pruefe('T6c ein Neuladen bringt ihn nicht zurück', await P.locator('.geteilt-modal').count() === 0);
  await ctx.close();
}

// ══ T7: Am Telefon — dort passiert das Teilen ═══════════════════════
console.log('\n════ T7: Telefon ════');
{
  const { ctx, P } = await seite({ width: 390, height: 844 }, true);
  await teile(P, { text: 'Vom Handy geteilt' });
  await P.goto(`http://localhost:${PORT}/?geteilt=1`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2400);
  pruefe('T7a der Dialog erscheint auch am Telefon', await P.locator('.geteilt-modal').count() > 0);
  const box = await P.locator('.geteilt-modal').boundingBox();
  console.log('    Dialog:', JSON.stringify(box && { b: Math.round(box.width), h: Math.round(box.height) }));
  pruefe('T7b er passt auf den Schirm', !!box && box.width <= 390 && box.height <= 844, JSON.stringify(box));
  const knopf = await P.locator('.geteilt-ok').boundingBox();
  pruefe('T7c „Übernehmen" ist mit dem Finger zu treffen (≥ 42 Punkte)',
    !!knopf && knopf.height >= 42, JSON.stringify(knopf));
  await P.screenshot({ path: `${SD}/m290-telefon.png` });
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
