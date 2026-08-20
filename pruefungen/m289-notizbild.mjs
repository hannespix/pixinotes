/**
 * M289 — „kann man einfach Bilder aus Clipboard in Notes einfügen? das
 * funktioniert jedenfalls nicht bei mir am Handy" (und: „png hat auch
 * Probleme").
 *
 * Der Befund vorher, gemessen an dieser Reihe im alten Stand: Ein PNG in eine
 * Notiz eingefügt → Blocktypen vorher/nachher identisch (["paragraph"]), null
 * Bilder im DOM, keine Karte, keine Meldung. Es passierte schlicht GAR NICHTS:
 * Der Board-Zeiger lässt Einfügen im Text bewusst durch (sonst entstünde beim
 * Tippen ständig eine Karte), und der Editor konnte Dateien nicht annehmen —
 * ihm fehlte der Anschluss dafür.
 *
 * Geprüft wird deshalb der ganze Weg: einfügen, verkleinern, im Kartenrand
 * bleiben, am Telefon erreichbar sein — und mitkommen, wenn die Notiz
 * exportiert wird.
 */
// Läuft aus dem Repository: `node pruefungen/m289-notizbild.mjs`
// Voraussetzung: `npm run build` und ein Chromium (PW_CHROMIUM).
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
const PORT = 4509;
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

async function seite(viewport = { width: 1280, height: 860 }, finger = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: finger, isMobile: finger });
  await ctx.addInitScript(() => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes: [
        { id: 'n1', type: 'note', position: { x: 60, y: 60 }, width: 320, height: 240,
          data: { color: 'yellow', blocks: [{ id: 'p1', type: 'paragraph', props: {},
            content: [{ type: 'text', text: 'Aktenvermerk', styles: {} }], children: [] }] } }] }],
      spaces: [{ id: 's1', name: 'Dienst', projects: [{ id: 'p1', name: 'Vorgänge', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: true } }));
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P };
}

/** Ein echtes PNG in der Seite bauen und als Einfüge-Ereignis auf ein Ziel schicken */
const einfuegen = (P, sel, kante = 240) => P.evaluate(async ([sel, kante]) => {
  const c = document.createElement('canvas');
  c.width = kante; c.height = Math.round(kante * 0.66);
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,255,0.9)'; x.fillRect(0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'screenshot.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const ziel = sel ? document.querySelector(sel) : document.body;
  if (!ziel) return { ok: false, roh: blob.size };
  ziel.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
  return { ok: true, roh: blob.size };
}, [sel, kante]);

const notiz = (P) => P.evaluate(() =>
  JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]);

// ══ T1: Das war der Fehler — Einfügen im Notiztext ══════════════════
console.log('════ T1: PNG in die Notiz einfügen ════');
{
  const { ctx, P } = await seite();
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.waitForTimeout(400);
  const roh = await einfuegen(P, '.note-editor [contenteditable="true"]');
  pruefe('T1a das Einfügen erreicht den Notiztext', roh.ok);
  await P.waitForTimeout(1800);
  const b = await notiz(P);
  const typen = b.nodes.find((n) => n.id === 'n1').data.blocks.map((x) => x.type);
  console.log('    Blocktypen:', JSON.stringify(typen));
  pruefe('T1b im Text steht jetzt ein Bild-Block (vorher: nichts passierte)',
    typen.includes('image'), JSON.stringify(typen));
  pruefe('T1c und daneben entsteht KEINE zusätzliche Bildkarte',
    b.nodes.filter((n) => n.type === 'image').length === 0);
  pruefe('T1d das Bild ist wirklich zu sehen',
    await P.evaluate(() => document.querySelectorAll('.note-editor img').length) === 1);
  const mass = await P.evaluate(() => {
    const img = document.querySelector('.note-editor img');
    const karte = document.querySelector('.note-card');
    const r = img.getBoundingClientRect(); const k = karte.getBoundingClientRect();
    return { ueber: Math.round(r.right - k.right), breite: Math.round(r.width) };
  });
  console.log('    Bild:', JSON.stringify(mass));
  pruefe('T1e und bleibt im Kartenrand (nichts ragt hinaus)', mass.ueber <= 0, JSON.stringify(mass));
  await P.screenshot({ path: `${SD}/m289-notiz.png` });
  await ctx.close();
}

// ══ T2: Ein großes Foto darf den Speicher nicht sprengen ════════════
console.log('\n════ T2: Großes Bild wird verkleinert ════');
{
  const { ctx, P } = await seite();
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.waitForTimeout(400);
  const roh = await einfuegen(P, '.note-editor [contenteditable="true"]', 3000);
  await P.waitForTimeout(2500);
  const laenge = await P.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('pixinotes-board')).state;
    const bild = st.boards[0].nodes[0].data.blocks.find((b) => b.type === 'image');
    return bild?.props?.url?.length ?? 0;
  });
  console.log(`    Rohdatei ${roh.roh} Byte → eingebettet ${laenge} Zeichen`);
  pruefe('T2a das Bild ist im Text angekommen', laenge > 0);
  pruefe('T2b und wurde auf ein speicherbares Maß gebracht (< 900 000 Zeichen)',
    laenge > 0 && laenge < 900_000, String(laenge));
  const breite = await P.evaluate(() => {
    const img = document.querySelector('.note-editor img');
    const k = document.querySelector('.note-card').getBoundingClientRect();
    return Math.round(img.getBoundingClientRect().right - k.right);
  });
  pruefe('T2c auch das große Bild bleibt in der Karte', breite <= 0, String(breite));
  await ctx.close();
}

// ══ T3: Das Einfügen-Menü bietet Bilder an — und nur die ════════════
console.log('\n════ T3: „/"-Menü ════');
{
  const { ctx, P } = await seite();
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.keyboard.press('End');
  await P.keyboard.press('Enter');
  await P.keyboard.type('/');
  await P.waitForTimeout(900);
  const eintraege = await P.evaluate(() =>
    [...document.querySelectorAll('.bn-suggestion-menu-item, [class*="suggestion-menu"] [role="option"]')]
      .map((e) => e.textContent.trim().slice(0, 40)));
  console.log('    Einträge:', JSON.stringify(eintraege.slice(0, 14)));
  pruefe('T3a „Bild" steht im Menü', eintraege.some((t) => /^Bild/i.test(t)), JSON.stringify(eintraege));
  pruefe('T3b „Bild aus Zwischenablage" ebenfalls',
    eintraege.some((t) => /Zwischenablage/i.test(t)), JSON.stringify(eintraege));
  pruefe('T3c Video, Ton und Datei werden NICHT angeboten (sie sprengen den Speicher)',
    !eintraege.some((t) => /^(video|audio|ton|datei|file)/i.test(t)), JSON.stringify(eintraege));
  await P.screenshot({ path: `${SD}/m289-slash.png` });
  await ctx.close();
}

// ══ T4: Der sichtbare Weg — der Bild-Chip ═══════════════════════════
console.log('\n════ T4: Bild-Chip an der Notiz ════');
{
  const { ctx, P } = await seite();
  pruefe('T4a ohne Cursor im Text trägt die Notiz keinen Bild-Chip',
    await P.locator('.due-chip', { hasText: 'Bild' }).count() === 0);
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.waitForTimeout(600);
  const chip = P.locator('.due-chip', { hasText: 'Bild' }).first();
  pruefe('T4b sobald der Cursor im Text steht, ist er da', await chip.count() > 0);
  if (await chip.count()) {
    const titel = await chip.getAttribute('title');
    console.log('    Zeiger:', JSON.stringify(titel));
    pruefe('T4c und erklärt den Weg am Telefon (Fotomediathek/Kamera)',
      /Fotomediathek|Kamera/.test(titel ?? ''), String(titel));
    // Der Chip öffnet einen Dateiwähler für Bilder
    await chip.click();
    await P.waitForTimeout(500);
    const feld = await P.evaluate(() => {
      const i = document.querySelector('input[type="file"][accept="image/*"]');
      return i ? { accept: i.accept, mehrere: i.multiple } : null;
    });
    console.log('    Dateiwähler:', JSON.stringify(feld));
    pruefe('T4d ein Klick öffnet den Bild-Wähler', !!feld, JSON.stringify(feld));
  }
  await ctx.close();
}

// ══ T5: Am Telefon — genau der gemeldete Fall ═══════════════════════
console.log('\n════ T5: Telefon ════');
{
  const { ctx, P } = await seite({ width: 390, height: 844 }, true);
  // Karte antippen öffnet das Karten-Blatt (Fokus)
  await P.locator('.note-card').first().click({ force: true });
  await P.waitForTimeout(1600);
  const imBlatt = await P.evaluate(() => !!document.querySelector('.app.focus-mode'));
  pruefe('T5a die Notiz öffnet sich formatfüllend', imBlatt);
  await P.locator('.note-editor .bn-block-content').first().click({ force: true });
  await P.waitForTimeout(600);
  const chip = P.locator('.due-chip', { hasText: 'Bild' }).first();
  pruefe('T5b der Bild-Chip ist auch dort erreichbar', await chip.count() > 0);
  if (await chip.count()) {
    const box = await chip.boundingBox();
    console.log('    Trefferfläche:', JSON.stringify(box && { w: Math.round(box.width), h: Math.round(box.height) }));
    pruefe('T5c und mit dem Finger sicher zu treffen (≥ 30 Punkte hoch)',
      !!box && box.height >= 30, JSON.stringify(box));
  }
  // … und das Einfügen aus der Zwischenablage funktioniert dort genauso
  const roh = await einfuegen(P, '.note-editor [contenteditable="true"]');
  pruefe('T5d das Einfügen erreicht den Text', roh.ok);
  await P.waitForTimeout(1800);
  const b = await notiz(P);
  const typen = b.nodes.find((n) => n.id === 'n1').data.blocks.map((x) => x.type);
  pruefe('T5e am Telefon landet das Bild ebenfalls in der Notiz',
    typen.includes('image'), JSON.stringify(typen));
  await P.screenshot({ path: `${SD}/m289-telefon.png` });
  await ctx.close();
}

// ══ T6: Das Bild kommt beim Weitergeben mit ═════════════════════════
console.log('\n════ T6: Export ════');
{
  const { ctx, P } = await seite();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.waitForTimeout(400);
  await einfuegen(P, '.note-editor [contenteditable="true"]');
  await P.waitForTimeout(1800);
  // Karte auswählen und „Kopieren" (formatiertes HTML) drücken
  await P.locator('.note-card').first().click({ position: { x: 5, y: 5 } });
  await P.waitForTimeout(600);
  const knopf = P.locator('.sel-toolbar button', { hasText: 'Kopieren' }).first();
  if (await knopf.count()) {
    await knopf.click();
    await P.waitForTimeout(900);
    const html = await P.evaluate(async () => {
      try {
        const eintraege = await navigator.clipboard.read();
        for (const e of eintraege) {
          if (e.types.includes('text/html')) return await (await e.getType('text/html')).text();
        }
      } catch (err) { return `FEHLER: ${err.message}`; }
      return '';
    });
    console.log('    HTML-Länge:', html.length, '· Bild enthalten:', /<img[^>]+src="data:image/.test(html));
    pruefe('T6a das formatierte Kopieren nimmt das Bild mit',
      /<img[^>]+src="data:image/.test(html), html.slice(0, 160));
  } else {
    pruefe('T6a das formatierte Kopieren nimmt das Bild mit', false, 'Kopieren-Knopf nicht gefunden');
  }
  await ctx.close();
}

// ══ T7: Was NICHT in eine Notiz gehört, sagt das freundlich ═════════
console.log('\n════ T7: Andere Dateien ════');
{
  const { ctx, P } = await seite();
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.waitForTimeout(400);
  await P.evaluate(() => {
    const file = new File([new Blob(['%PDF-1.4 test'])], 'bericht.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer(); dt.items.add(file);
    document.querySelector('.note-editor [contenteditable="true"]')
      ?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
  });
  await P.waitForTimeout(1500);
  const b = await notiz(P);
  const typen = b.nodes.find((n) => n.id === 'n1').data.blocks.map((x) => x.type);
  console.log('    Blocktypen:', JSON.stringify(typen));
  pruefe('T7a eine PDF wird nicht in den Text eingebettet',
    !typen.includes('image') && !typen.includes('file'), JSON.stringify(typen));
  pruefe('T7b die Seite bleibt heil (kein Absturz)',
    await P.evaluate(() => !!document.querySelector('.note-editor')));
  const meldung = await P.evaluate(() => document.querySelector('.toast, .pn-toast')?.textContent ?? '');
  console.log('    Meldung:', JSON.stringify(meldung));
  pruefe('T7c und die Meldung sagt, wohin solche Dateien gehören',
    /Board/i.test(meldung), String(meldung));
  await ctx.close();
}

// ══ T8: Auf der Notiz abgelegte Dateien ═════════════════════════════
console.log('\n════ T8: Ablegen auf der Notiz ════');
{
  const { ctx, P } = await seite();
  // Ein BILD auf die Notiz ziehen → gehört in den Text
  await P.locator('.note-editor .bn-block-content').first().click();
  await P.waitForTimeout(400);
  await P.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 140;
    c.getContext('2d').fillRect(0, 0, 200, 140);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'foto.png', { type: 'image/png' }));
    const ziel = document.querySelector('.note-editor [contenteditable="true"]');
    const r = ziel.getBoundingClientRect();
    for (const art of ['dragover', 'drop']) {
      ziel.dispatchEvent(new DragEvent(art, { bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: r.left + 40, clientY: r.top + 20 }));
    }
  });
  await P.waitForTimeout(2000);
  const b1 = await notiz(P);
  const typen1 = b1.nodes.find((n) => n.id === 'n1').data.blocks.map((x) => x.type);
  console.log('    nach Bild-Ablage:', JSON.stringify(typen1), '· Karten:', b1.nodes.length);
  pruefe('T8a ein abgelegtes Bild landet IM Text', typen1.includes('image'), JSON.stringify(typen1));

  // Eine PDF auf dieselbe Notiz ziehen → gehört als Karte aufs Board
  await P.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Blob(['%PDF-1.4 x'])], 'bericht.pdf', { type: 'application/pdf' }));
    const ziel = document.querySelector('.note-editor [contenteditable="true"]');
    const r = ziel.getBoundingClientRect();
    for (const art of ['dragover', 'drop']) {
      ziel.dispatchEvent(new DragEvent(art, { bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: r.left + 40, clientY: r.top + 20 }));
    }
  });
  await P.waitForTimeout(2200);
  const b2 = await notiz(P);
  const typen2 = b2.nodes.find((n) => n.id === 'n1').data.blocks.map((x) => x.type);
  const dateikarten = b2.nodes.filter((n) => n.type === 'file' || n.type === 'pdf');
  console.log('    nach PDF-Ablage:', JSON.stringify(typen2), '· Datei-Karten:', dateikarten.length);
  pruefe('T8b eine abgelegte PDF landet NICHT im Text', !typen2.includes('file'), JSON.stringify(typen2));
  pruefe('T8c sondern wird eine Karte auf dem Board', dateikarten.length === 1,
    JSON.stringify(b2.nodes.map((n) => n.type)));
  await P.screenshot({ path: `${SD}/m289-ablegen.png` });
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
