/**
 * M374 — Bilder liegen rahmenlos auf dem Board.
 * (Nutzerwunsch: „Bilder rahmenlos einfügen. Transparente PNG sollen auch mit Transparenz eingefügt werden, JPG
 * einfach so ohne Rahmen. Erst wenn man sie markiert, sollen Größen, Rahmen etc. angezeigt werden.")
 *
 * Geprüft wird am gebauten Stand: Aussehen (kein Schatten, keine Fläche, kein Innenabstand, Bild = Karte),
 * Durchsichtigkeit (ein Bildpunkt in der freien Ecke zeigt den Board-Grund), Bedienelemente erst bei Auswahl,
 * Seitenverhältnis an den Griffen, alte Karten mit gezogener Höhe, die Fassung „mit Rahmen" — und der Import:
 * Eine große freigestellte Grafik darf beim Verkleinern NICHT zum JPEG werden.
 */
// Läuft aus dem Repository: `node pruefungen/m374-bilder-rahmenlos.mjs` (PN_DIST = anderer Build-Ordner)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4592;
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

// ── Testbilder (im Browser gezeichnet) ───────────────────────────────
const werkstatt = await (await browser.newContext()).newPage();
await werkstatt.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
const BILDER = await werkstatt.evaluate(() => {
  const flaeche = (w, h, malen) => { const c = document.createElement('canvas'); c.width = w; c.height = h; malen(c.getContext('2d'), w, h); return c; };
  // freigestellt: roter Kreis, Ecken durchsichtig — 300×150 (2:1)
  const png = flaeche(300, 150, (x, w, h) => { x.fillStyle = '#d6336c'; x.beginPath(); x.ellipse(w / 2, h / 2, w / 2 - 30, h / 2 - 20, 0, 0, 7); x.fill(); }).toDataURL('image/png');
  // Foto: deckender Verlauf — 400×300 (4:3)
  const jpg = flaeche(400, 300, (x, w, h) => { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1971c2'); g.addColorStop(1, '#f08c00'); x.fillStyle = g; x.fillRect(0, 0, w, h); }).toDataURL('image/jpeg', 0.9);
  return { png, jpg };
});
await werkstatt.context().close();

async function seite({ telefon = false } = {}) {
  const ctx = await browser.newContext(telefon
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'de-DE' }
    : { viewport: { width: 1400, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript(({ png, jpg }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    const nodes = [
      { id: 'png', type: 'image', position: { x: 60, y: 80 }, width: 260, data: { src: png, name: 'logo.png' } },
      { id: 'jpg', type: 'image', position: { x: 400, y: 80 }, width: 260, data: { src: jpg, name: 'foto.jpg' } },
      // alte Karte: von Hand gezogene Höhe, in der noch Rand und Namenszeile steckten
      { id: 'alt', type: 'image', position: { x: 740, y: 80 }, width: 260, height: 300, autoFit: false, data: { src: png, name: 'alt.png' } },
      { id: 'titel', type: 'image', position: { x: 60, y: 420 }, width: 260, data: { src: png, name: 'x.png', titel: 'Unser Logo' } },
      { id: 'mit', type: 'image', position: { x: 400, y: 420 }, width: 260, data: { src: jpg, name: 'karte.jpg', rahmen: true } },
    ];
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Bilder', edges: [], drawings: [], comments: [], nodes }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
  }, BILDER);
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node-image img');
  await P.waitForTimeout(1800);
  return { ctx, P, fehler };
}
const stand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards?.[0] ?? null);
const karte = async (P, id) => (await stand(P))?.nodes.find((n) => n.id === id) ?? null;

/** Maße und Aussehen einer Bild-Karte */
const lage = (P, id) => P.evaluate((id) => {
  const k = document.querySelector(`.react-flow__node[data-id="${id}"]`);
  if (!k) return null;
  const r = k.getBoundingClientRect();
  const koerper = k.querySelector('.image-card');
  const bild = k.querySelector('img');
  const b = bild.getBoundingClientRect();
  const name = k.querySelector('.img-name');
  const nr = name?.getBoundingClientRect();
  const sk = getComputedStyle(k); const sb = getComputedStyle(koerper);
  const deck = (sel) => { const e = k.querySelector(sel); return e ? getComputedStyle(e).opacity : null; };
  return {
    x: r.left, y: r.top, w: r.width, h: r.height,
    bild: { x: b.left, y: b.top, w: b.width, h: b.height },
    schatten: sk.boxShadow, koerperSchatten: sb.boxShadow, grund: sb.backgroundColor, innen: sb.paddingTop, ecken: sb.borderRadius,
    klasse: koerper.className, gewaehlt: k.classList.contains('selected'), umriss: sk.outlineStyle,
    name: name ? { text: name.textContent.trim(), oben: nr.top, hoch: nr.height } : null,
    punkte: deck('.pn-handle'), griff: deck('.card-grip'), lupe: deck('.bild-lupe-auf'),
    ziehgriffe: [...k.querySelectorAll('.react-flow__resize-control.handle')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length,
  };
}, id);
const nah = (a, b, t = 1.5) => Math.abs(a - b) <= t;

/** Farben eines kleinen Ausschnitts (als „r,g,b"-Menge) */
async function farben(P, x, y, w, h) {
  const png = await P.screenshot({ clip: { x, y, width: w, height: h } });
  return P.evaluate(async (d) => {
    const i = new Image(); i.src = `data:image/png;base64,${d}`; await i.decode();
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
    const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    const p = g.getImageData(0, 0, i.width, i.height).data;
    const s = new Set();
    for (let k = 0; k < p.length; k += 4) s.add(`${p[k]},${p[k + 1]},${p[k + 2]}`);
    return [...s];
  }, png.toString('base64'));
}

// ══ A: So liegt ein Bild auf dem Board ═══════════════════════════════
console.log('════ A: rahmenlos ════');
{
  const { ctx, P, fehler } = await seite();
  await P.mouse.move(1350, 860);
  await P.waitForTimeout(300);
  const png = await lage(P, 'png'); const jpg = await lage(P, 'jpg');
  console.log('   ', JSON.stringify({ png: { w: png.w, h: png.h, schatten: png.schatten, grund: png.grund, innen: png.innen }, jpg: { w: jpg.w, h: jpg.h } }));
  for (const [n, l] of [['PNG', png], ['JPG', jpg]]) {
    pruefe(`A1 ${n}: kein Schatten`, l.schatten === 'none' && l.koerperSchatten === 'none', `${l.schatten} / ${l.koerperSchatten}`);
    pruefe(`A2 ${n}: keine Fläche, kein Innenabstand, keine runden Ecken`, l.grund === 'rgba(0, 0, 0, 0)' && l.innen === '0px' && l.ecken === '0px', `${l.grund} ${l.innen} ${l.ecken}`);
    pruefe(`A3 ${n}: das Bild füllt die Karte genau`, nah(l.bild.x, l.x) && nah(l.bild.y, l.y) && nah(l.bild.w, l.w) && nah(l.bild.h, l.h), JSON.stringify(l.bild));
  }
  pruefe('A4 die Karte hat das Seitenverhältnis des Bildes (2:1 und 4:3)', nah(png.w / png.h, 2, 0.03) && nah(jpg.w / jpg.h, 4 / 3, 0.03), `${png.w / png.h} · ${jpg.w / jpg.h}`);

  // Durchsichtig: In der freien Ecke des PNG steht der Board-Grund — dieselben Farben wie knapp neben der Karte
  const aussen = await farben(P, Math.round(png.x) - 40, Math.round(png.y) - 40, 34, 34);
  const ecke = await farben(P, Math.round(png.x) + 2, Math.round(png.y) + 2, 6, 6);
  const mitte = await farben(P, Math.round(png.x + png.w / 2) - 3, Math.round(png.y + png.h / 2) - 3, 6, 6);
  console.log('    Grund:', aussen.slice(0, 4).join(' | '), '· Ecke:', ecke.join(' | '), '· Mitte:', mitte.join(' | '));
  pruefe('A5 die durchsichtige Ecke zeigt den Board-Grund', ecke.every((f) => aussen.includes(f)), ecke.join(' | '));
  pruefe('A6 in der Mitte steht das Bild (Gegenprobe)', mitte.some((f) => !aussen.includes(f)), mitte.join(' | '));

  pruefe('A7 ohne Auswahl steht kein Name da (Dateiname ist kein Titel)', png.name === null && jpg.name === null, JSON.stringify(png.name));
  const titel = await lage(P, 'titel');
  pruefe('A8 ein selbst vergebener Name steht als Bildunterschrift da', titel.name?.text.includes('Unser Logo'), JSON.stringify(titel.name));
  pruefe('A9 … unter dem Bild und außerhalb der Karte (ihre Maße bleiben 2:1)', titel.name && titel.name.oben >= titel.y + titel.h && nah(titel.w / titel.h, 2, 0.03), JSON.stringify({ name: titel.name, y: titel.y, h: titel.h }));

  // Zeigen allein ändert nichts
  await P.mouse.move(png.x + png.w / 2, png.y + png.h / 2);
  await P.waitForTimeout(400);
  const z = await lage(P, 'png');
  pruefe('A10 beim Zeigen: keine Anschlusspunkte, kein Griff, keine Lupe, keine Größen-Griffe',
    z.punkte === '0' && z.griff === '0' && z.lupe === '0' && z.ziehgriffe === 0, JSON.stringify({ p: z.punkte, g: z.griff, l: z.lupe, z: z.ziehgriffe }));
  await P.screenshot({ path: `${SD}/m374-a-rahmenlos.png` });

  // ══ B: Markiert ════════════════════════════════════════════════════
  console.log('\n════ B: markiert ════');
  await P.mouse.click(png.x + png.w / 2, png.y + png.h / 2);
  await P.waitForTimeout(500);
  const m = await lage(P, 'png');
  pruefe('B1 ein Klick markiert das Bild — mit Auswahlrahmen', m.gewaehlt && m.umriss === 'solid', `${m.gewaehlt} ${m.umriss}`);
  pruefe('B2 jetzt sind die Größen-Griffe da', m.ziehgriffe >= 4, String(m.ziehgriffe));
  pruefe('B3 … die Lupe', m.lupe === '1', String(m.lupe));
  pruefe('B4 … und der Name, unter dem Bild', m.name?.text.includes('logo.png') && m.name.oben >= m.y + m.h, JSON.stringify(m.name));
  pruefe('B5 die Karte selbst ist dabei nicht gewachsen', nah(m.w, png.w) && nah(m.h, png.h), `${m.w}×${m.h} gegen ${png.w}×${png.h}`);
  pruefe('B6 Fläche und Schatten bleiben auch markiert weg', m.schatten === 'none' && m.grund === 'rgba(0, 0, 0, 0)', `${m.schatten} ${m.grund}`);
  await P.mouse.move(m.x + m.w / 2, m.y + m.h / 2 + 4);
  await P.waitForTimeout(350);
  pruefe('B7 markiert und gezeigt: die Anschlusspunkte kommen', (await lage(P, 'png')).punkte === '1');
  await P.screenshot({ path: `${SD}/m374-b-markiert.png` });

  // Griff unten rechts ziehen — das Seitenverhältnis bleibt
  const griff = await P.evaluate(() => {
    const e = document.querySelector('.react-flow__node[data-id="png"] .react-flow__resize-control.handle.bottom.right');
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await P.mouse.move(griff.x, griff.y);
  await P.mouse.down();
  await P.mouse.move(griff.x + 50, griff.y + 5, { steps: 6 });
  await P.mouse.move(griff.x + 120, griff.y + 12, { steps: 8 });
  await P.mouse.up();
  await P.waitForTimeout(700);
  const g = await lage(P, 'png');
  const gk = await karte(P, 'png');
  console.log('    nach dem Ziehen:', JSON.stringify({ w: g.w, h: g.h, gespeichert: { w: gk.width, h: gk.height } }));
  pruefe('B8 am Griff gezogen: das Bild ist größer', g.w > png.w + 60, `${g.w} gegen ${png.w}`);
  pruefe('B9 … und behält sein Seitenverhältnis', nah(g.w / g.h, 2, 0.04) && nah(gk.width / gk.height, 2, 0.04), `${g.w / g.h} · ${gk.width / gk.height}`);
  pruefe('B10 … und füllt die Karte weiterhin genau', nah(g.bild.w, g.w) && nah(g.bild.h, g.h), JSON.stringify(g.bild));

  // ══ C: Alte Karte ══════════════════════════════════════════════════
  console.log('\n════ C: alte Karte mit gezogener Höhe ════');
  const alt = await lage(P, 'alt'); const altK = await karte(P, 'alt');
  console.log('   ', JSON.stringify({ w: alt.w, h: alt.h, gespeichert: altK.height }));
  pruefe('C1 sie legt sich an das Bild an (260×300 → 260×130)', altK.height === 130 && altK.width === 260, `${altK.width}×${altK.height}`);
  pruefe('C2 … ohne leere Streifen in der Auswahl', nah(alt.bild.w, alt.w) && nah(alt.bild.h, alt.h) && nah(alt.w / alt.h, 2, 0.03), JSON.stringify(alt.bild));

  // ══ D: Mit Rahmen ══════════════════════════════════════════════════
  console.log('\n════ D: „Mit Rahmen" ════');
  const mit = await lage(P, 'mit');
  pruefe('D1 eine Karte mit Rahmen hat Fläche, Innenabstand und Schatten', mit.klasse.includes('mit-rahmen') && mit.grund !== 'rgba(0, 0, 0, 0)' && mit.innen === '8px' && mit.koerperSchatten !== 'none', `${mit.grund} ${mit.innen} ${mit.koerperSchatten}`);
  pruefe('D2 … und zeigt ihren Namen in der Karte', mit.name?.text.includes('karte.jpg') && mit.name.oben < mit.y + mit.h, JSON.stringify(mit.name));

  await P.keyboard.press('Escape');
  await P.mouse.click(jpg.x + jpg.w / 2, jpg.y + jpg.h / 2);
  await P.waitForTimeout(500);
  await P.locator('button[data-smbtn][aria-label="Mehr"]').click();
  await P.waitForSelector('[data-taste="bild-rahmen"]');
  const knopf = await P.locator('[data-taste="bild-rahmen"]').textContent();
  pruefe('D3 im ⋯ der Auswahl steht „Mit Rahmen (als Karte)"', /Mit Rahmen/.test(knopf), knopf);
  await P.locator('[data-taste="bild-rahmen"]').click();
  await P.waitForTimeout(500);
  const j1 = await lage(P, 'jpg');
  pruefe('D4 danach ist das Bild eine Karte mit Rand', j1.klasse.includes('mit-rahmen') && j1.innen === '8px' && (await karte(P, 'jpg')).data.rahmen === true, `${j1.klasse} ${j1.innen}`);
  await P.screenshot({ path: `${SD}/m374-d-mit-rahmen.png` });
  await P.locator('button[data-smbtn][aria-label="Mehr"]').click();
  await P.waitForSelector('[data-taste="bild-rahmen"]');
  pruefe('D5 der Eintrag heißt jetzt „Ohne Rahmen (nur das Bild)"', /Ohne Rahmen/.test(await P.locator('[data-taste="bild-rahmen"]').textContent()));
  await P.locator('[data-taste="bild-rahmen"]').click();
  await P.waitForTimeout(500);
  const j2 = await lage(P, 'jpg');
  // der Stand wird mit kurzer Verzögerung gespeichert — warten, bis er angekommen ist
  let weg = false;
  for (let i = 0; i < 20 && !weg; i++) { weg = (await karte(P, 'jpg')).data.rahmen === undefined; if (!weg) await P.waitForTimeout(200); }
  pruefe('D6 … und macht es wieder rahmenlos', j2.klasse.includes('rahmenlos') && j2.innen === '0px' && weg, `${j2.klasse} ${j2.innen} ${weg}`);
  pruefe('A/B/C/D ohne Skriptfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ E: Einfügen ══════════════════════════════════════════════════════
console.log('\n════ E: Einfügen ════');
{
  const { ctx, P, fehler } = await seite();
  /** Ein gezeichnetes Bild als Datei einfügen (Zwischenablage) */
  const einfuegen = (art) => P.evaluate(async (art) => {
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    if (art === 'symbol') {
      c.width = 48; c.height = 48;
      x.fillStyle = '#2b8a3e'; x.beginPath(); x.arc(24, 24, 20, 0, 7); x.fill();
    } else {
      // 2000×1400 Rauschen (lässt sich nicht kleinrechnen → sicher über 400 KB)
      c.width = 2000; c.height = 1400;
      const d = x.createImageData(c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255;
      }
      if (art === 'frei') {
        // freigestellt: ein breiter Rand ringsum ist durchsichtig
        for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
          if (xx < 300 || xx >= c.width - 300 || yy < 200 || yy >= c.height - 200) d.data[(yy * c.width + xx) * 4 + 3] = 0;
        }
      }
      x.putImageData(d, 0, 0);
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], `${art}.png`, { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
    return blob.size;
  }, art);
  const neu = async (name) => {
    for (let i = 0; i < 40; i++) {
      const n = (await stand(P))?.nodes.find((k) => k.type === 'image' && k.data.name === name);
      if (n) return n;
      await P.waitForTimeout(250);
    }
    return null;
  };
  /** Was steckt im abgelegten Bild? */
  const pruefBild = (src) => P.evaluate(async (src) => {
    const i = new Image(); i.src = src; await i.decode();
    const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    const ecke = g.getImageData(5, 5, 1, 1).data; const mitte = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
    return { w: c.width, h: c.height, eckeAlpha: ecke[3], mitteAlpha: mitte[3], art: /^data:([^;,]+)/.exec(src)?.[1], kb: Math.round(src.length / 1024) };
  }, src);

  const rohFrei = await einfuegen('frei');
  const frei = await neu('frei.png');
  const fb = frei ? await pruefBild(frei.data.src) : null;
  console.log('    freigestellt:', Math.round(rohFrei / 1024), 'KB roh →', JSON.stringify(fb));
  pruefe('E1 die große freigestellte Grafik kommt als Bild-Karte an', !!frei);
  pruefe('E2 … verkleinert (längste Kante höchstens 1600)', fb && Math.max(fb.w, fb.h) <= 1600 && fb.w < 2000, JSON.stringify(fb));
  pruefe('E3 … NICHT als JPEG', fb && fb.art !== 'image/jpeg' && /image\/(webp|png)/.test(fb.art), fb?.art);
  pruefe('E4 … und bleibt durchsichtig, wo sie durchsichtig war', fb && fb.eckeAlpha === 0 && fb.mitteAlpha === 255, JSON.stringify(fb));

  const rohFoto = await einfuegen('foto');
  const foto = await neu('foto.png');
  const pb = foto ? await pruefBild(foto.data.src) : null;
  console.log('    deckend:', Math.round(rohFoto / 1024), 'KB roh →', JSON.stringify(pb));
  pruefe('E5 ein großes deckendes Bild wird weiterhin platzsparend als JPEG abgelegt', pb && pb.art === 'image/jpeg' && Math.max(pb.w, pb.h) <= 1600, JSON.stringify(pb));

  await einfuegen('symbol');
  const symbol = await neu('symbol.png');
  await P.waitForTimeout(500);
  const sb = symbol ? await pruefBild(symbol.data.src) : null;
  pruefe('E6 ein kleines Symbol bleibt klein (48 breit statt aufgeblasen auf 260)', symbol?.width === 48, String(symbol?.width));
  pruefe('E7 … unverändert als PNG mit Durchsichtigkeit', sb && sb.art === 'image/png' && sb.eckeAlpha === 0, JSON.stringify(sb));
  const sl = symbol ? await lage(P, symbol.id) : null;
  pruefe('E8 … und liegt rahmenlos und quadratisch da', sl && sl.klasse.includes('rahmenlos') && nah(sl.w / sl.h, 1, 0.05) && sl.schatten === 'none', JSON.stringify(sl && { w: sl.w, h: sl.h }));
  pruefe('E ohne Skriptfehler', fehler.length === 0, fehler.join(' | '));
  await P.screenshot({ path: `${SD}/m374-e-eingefuegt.png` });
  await ctx.close();
}

// ══ F: Am Telefon ════════════════════════════════════════════════════
console.log('\n════ F: Telefon (kein Zeigen) ════');
{
  const { ctx, P, fehler } = await seite({ telefon: true });
  const v = await lage(P, 'png');
  pruefe('F1 ohne Auswahl: keine Lupe, keine Anschlusspunkte, kein Name', v.lupe === '0' && v.punkte === '0' && v.name === null, JSON.stringify({ l: v.lupe, p: v.punkte, n: v.name }));
  pruefe('F2 rahmenlos auch hier', v.schatten === 'none' && v.grund === 'rgba(0, 0, 0, 0)' && v.innen === '0px', `${v.schatten} ${v.grund}`);
  await P.touchscreen.tap(v.x + v.w / 2, v.y + v.h / 2);
  await P.waitForTimeout(600);
  const n = await lage(P, 'png');
  pruefe('F3 angetippt = markiert: Lupe, Anschlusspunkte und Name sind da', n.gewaehlt && Number(n.lupe) > 0.5 && n.punkte === '1' && !!n.name, JSON.stringify({ g: n.gewaehlt, l: n.lupe, p: n.punkte, n: n.name }));
  pruefe('F ohne Skriptfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
