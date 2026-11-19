/**
 * M405 — Präsentation: „Weiter" und „Zurück" gehen immer von Karte zu Karte; im Dokument blättert dessen eigene Leiste.
 *
 * Gemeldet: „Im Präsentationsmodus ist das Vorwärts zur nächsten Card nicht immer gleich. Bei PDF mit mehreren Seiten
 * kann ich nicht einfach zur nächsten Card, es blättert immer erst das PDF. Vielleicht braucht man immer an derselben
 * Stelle, egal welcher Card-Typ, einen Weiter/Zurück-Button. Aber auch einen inneren Umschalter für internes Blättern
 * innerhalb Dokument."
 *
 *   A  Die Knöpfe der Fußleiste gehen von Karte zu Karte – auch aus einem Dokument mit mehreren Seiten heraus;
 *      sie stehen bei jedem Kartentyp an derselben Stelle.
 *   B  Die Leiste am Dokument blättert nur im Dokument und endet an der ersten und letzten Seite.
 *   C  Zurück im Dokument liegt die Seite offen, auf der man es verlassen hat (Knöpfe, Punkte).
 *   D  Tasten: → / ← / Leertaste gehen weiter Seite für Seite, Strg + Pfeil von Karte zu Karte.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m405-karte-und-seite.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4721;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

/** Eine kleine, gültige PDF mit n Seiten (612 × 792), je Seite ein farbiges Rechteck */
function pdfErzeugen(n) {
  const objekte = [];
  objekte.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: n }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objekte.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    const inhalt = `${(i % 3) / 2} 0.2 ${1 - (i % 3) / 2} rg 80 ${600 - i * 120} 300 80 re f`;
    objekte.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R >>`);
    objekte.push(`<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`);
  }
  let aus = '%PDF-1.4\n';
  const offsets = [];
  objekte.forEach((o, i) => { offsets.push(aus.length); aus += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = aus.length;
  aus += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) aus += `${String(o).padStart(10, '0')} 00000 n \n`;
  aus += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return aus;
}
const pdf = pdfErzeugen(3);
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const notiz = (id, x, text) => ({ id, type: 'note', position: { x, y: 0 }, width: 260, height: 170, autoFit: false, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] } });
const KARTEN = [notiz('n1', 0, 'Erste Karte'), { id: 'f1', type: 'file', width: 300, position: { x: 400, y: 0 }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } }, notiz('n2', 900, 'Dritte Karte')];
const auf = async (sprache = '', opt = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, ...opt });
  await ctx.addInitScript(([n, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: n }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [KARTEN, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  if (!opt.hasTouch) { await P.keyboard.press('Escape'); await P.mouse.click(1200, 760); await P.waitForTimeout(250); }
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(900);
  return { ctx, P };
};
const { ctx, P } = await auf();
const stand = () => P.evaluate(() => {
  const d = document.querySelector('.presenter .folie-dok'); const r = (t) => { const e = document.querySelector(`[data-taste="${t}"]`); const b = e?.getBoundingClientRect(); return e ? { x: Math.round(b.left), y: Math.round(b.top), aus: e.getAttribute('aria-disabled') === 'true' } : null; };
  return { zaehler: (document.querySelector('.presenter-count')?.textContent ?? '').replace(/\s+/g, ' ').trim(), dok: !!d, seite: d ? Number(d.dataset.seite) : 0, seiten: d ? Number(d.dataset.seiten) : 0,
    weiter: r('vortrag-weiter'), zurueck: r('vortrag-zurueck'), vor: r('folie-vor'), rueck: r('folie-zurueck'), text: document.querySelector('.presenter-slide .bn-editor')?.textContent?.slice(0, 40) ?? '' };
});
const klick = async (t, ms = 700) => { await P.locator(`[data-taste="${t}"]`).click({ force: true }); await P.waitForTimeout(ms); };
const taste = async (k, ms = 700) => { await P.keyboard.press(k); await P.waitForTimeout(ms); };
const warteAufPdf = async () => { await P.waitForFunction(() => Number(document.querySelector('.presenter .folie-dok')?.dataset.seiten ?? 0) === 3, null, { timeout: 15000 }).catch(() => {}); await P.waitForTimeout(400); };

// ---------- A: Fußleiste = Karten ----------
console.log('A  „Weiter" und „Zurück" gehen von Karte zu Karte');
// (der Hinweis am Knopf, bevor der Zeiger darüber war – die Hinweis-Schicht nimmt ihn dann an sich)
const tipps = await P.evaluate(() => ['vortrag-weiter', 'vortrag-zurueck'].map((t) => document.querySelector(`[data-taste="${t}"]`).getAttribute('title') ?? ''));
const a0 = await stand();
pruefe('A1 erste Karte: „Zurück" ist grau, „Weiter" nicht', a0.zaehler === '1 / 3' && a0.zurueck.aus && !a0.weiter.aus && !a0.dok, a0);
await klick('vortrag-weiter'); await warteAufPdf();
const a1 = await stand();
pruefe('A2 „Weiter" → die PDF, Seite 1 von 3', a1.zaehler === '2 / 3' && a1.dok && a1.seite === 1 && a1.seiten === 3, a1);
pruefe('A3 die Knöpfe stehen auf der Dokument-Folie an derselben Stelle wie auf der Notiz', Math.abs(a1.weiter.x - a0.weiter.x) <= 1 && Math.abs(a1.weiter.y - a0.weiter.y) <= 1 && Math.abs(a1.zurueck.x - a0.zurueck.x) <= 1 && Math.abs(a1.zurueck.y - a0.zurueck.y) <= 1, { notiz: a0.weiter, dok: a1.weiter });
await klick('vortrag-weiter');
const a2 = await stand();
pruefe('A4 noch einmal „Weiter" → die nächste Karte, nicht Seite 2 der PDF (vorher blätterte es erst alle Seiten durch)', a2.zaehler === '3 / 3' && !a2.dok && /Dritte Karte/.test(a2.text), a2);
pruefe('A5 letzte Karte: „Weiter" ist grau', a2.weiter.aus && !a2.zurueck.aus, a2);
await klick('vortrag-zurueck'); await warteAufPdf();
const a3 = await stand();
pruefe('A6 „Zurück" → wieder die PDF', a3.zaehler === '2 / 3' && a3.dok && a3.seite === 1, a3);

// ---------- B: die Leiste am Dokument ----------
console.log('B  Die Leiste am Dokument blättert nur im Dokument');
pruefe('B1 auf Seite 1 ist „Vorherige Seite" grau, „Nächste Seite" nicht', !!a3.rueck && a3.rueck.aus && !a3.vor.aus, a3);
await klick('folie-zurueck', 500);
pruefe('B2 „Vorherige Seite" auf Seite 1 verlässt das Dokument nicht', (await stand()).zaehler === '2 / 3' && (await stand()).seite === 1, await stand());
await klick('folie-vor'); await klick('folie-vor');
const b1 = await stand();
pruefe('B3 „Nächste Seite" zweimal → Seite 3 von 3, weiter Karte 2', b1.zaehler === '2 / 3' && b1.seite === 3 && b1.vor.aus && !b1.rueck.aus, b1);
await klick('folie-vor', 500);
const b2 = await stand();
pruefe('B4 auf der letzten Seite endet die Leiste: kein Sprung zur nächsten Karte', b2.zaehler === '2 / 3' && b2.dok && b2.seite === 3, b2);
pruefe('B5 die Knöpfe der Fußleiste sind mitten im Dokument beide bedienbar', !b2.weiter.aus && !b2.zurueck.aus, b2);

// ---------- C: gemerkte Seite ----------
console.log('C  Zurück im Dokument: die Seite von vorhin');
await klick('vortrag-weiter');
pruefe('C1 von Seite 3 aus „Weiter" → Karte 3', (await stand()).zaehler === '3 / 3' && !(await stand()).dok, await stand());
await klick('vortrag-zurueck'); await warteAufPdf();
pruefe('C2 „Zurück" → die PDF liegt wieder auf Seite 3 offen', (await stand()).dok && (await stand()).seite === 3, await stand());
await P.locator('.presenter-dots button').nth(0).click(); await P.waitForTimeout(600);
pruefe('C3 ein Punkt der Fußleiste führt zur Karte', (await stand()).zaehler === '1 / 3', await stand());
await P.locator('.presenter-dots button').nth(1).click(); await warteAufPdf();
pruefe('C4 … und zurück per Punkt: ebenfalls Seite 3', (await stand()).dok && (await stand()).seite === 3, await stand());

// ---------- D: Tasten ----------
console.log('D  Tasten');
await P.locator('.presenter-count').click(); await P.waitForTimeout(150);
await taste('ArrowLeft');
pruefe('D1 ← blättert im Dokument zurück (Seite 2)', (await stand()).seite === 2 && (await stand()).zaehler === '2 / 3', await stand());
await taste('Control+ArrowRight');
pruefe('D2 Strg + → geht zur nächsten Karte – mitten aus dem Dokument', (await stand()).zaehler === '3 / 3' && !(await stand()).dok, await stand());
await taste('Control+ArrowLeft'); await warteAufPdf();
pruefe('D3 Strg + ← zurück: die PDF, Seite 2', (await stand()).dok && (await stand()).seite === 2, await stand());
// (in Seitenbreite rollt → erst die Seite zu Ende, dann blättert es – wie bisher)
for (let i = 0; i < 6 && (await stand()).seite === 2; i++) await taste('ArrowRight');
pruefe('D4 → blättert weiter Seite für Seite (Seite 3)', (await stand()).seite === 3 && (await stand()).zaehler === '2 / 3', await stand());
for (let i = 0; i < 6 && (await stand()).dok; i++) await taste('ArrowRight');
pruefe('D5 → nach der letzten Seite: die nächste Karte (wie bisher)', (await stand()).zaehler === '3 / 3', await stand());
await taste('ArrowLeft'); await warteAufPdf();
pruefe('D6 ← rückwärts landet auf der letzten Seite des Dokuments (wie bisher)', (await stand()).dok && (await stand()).seite === 3, await stand());
await taste('Control+ArrowLeft');
await taste('Control+ArrowLeft', 400);
pruefe('D7 Strg + ← an der ersten Karte bleibt dort', (await stand()).zaehler === '1 / 3', await stand());
pruefe('D8 die Knöpfe nennen ihre Taste', /Nächste Karte \(Strg\+→\)/.test(tipps[0]) && /Vorherige Karte \(Strg\+←\)/.test(tipps[1]), tipps);
await ctx.close();

// ---------- T: Telefon ----------
console.log('T  Am Telefon');
{
  const T = await auf('', { viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const Q = T.P;
  const lage = () => Q.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); const st = getComputedStyle(e); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), u: Math.round(b.bottom), da: st.display !== 'none' && b.width > 0 && b.bottom <= window.innerHeight + 1 }; };
    const d = document.querySelector('.presenter .folie-dok'); const blatt = document.querySelector('.folie-dok-seite')?.getBoundingClientRect();
    return { zaehler: (document.querySelector('.presenter-count')?.textContent ?? '').replace(/\s+/g, ' ').trim(), dok: !!d, seite: d ? Number(d.dataset.seite) : 0, weiter: r('[data-taste="vortrag-weiter"]'), zurueck: r('[data-taste="vortrag-zurueck"]'), leiste: r('.folie-dok-leiste'), blattH: blatt ? Math.round(blatt.height) : 0, blattB: blatt ? Math.round(blatt.width) : 0, h: window.innerHeight, b: window.innerWidth };
  });
  const t0 = await lage();
  await Q.locator('[data-taste="vortrag-weiter"]').tap(); await Q.waitForFunction(() => Number(document.querySelector('.presenter .folie-dok')?.dataset.seiten ?? 0) === 3, null, { timeout: 15000 }).catch(() => {}); await Q.waitForTimeout(600);
  const t1 = await lage();
  pruefe('T1 auf der Dokument-Folie steht die Fußleiste auch am Telefon (vorher war sie dort ausgeblendet)', t1.dok && !!t1.weiter?.da && !!t1.zurueck?.da, t1);
  pruefe('T2 … an derselben Stelle wie auf der Notiz, mit dem Finger zu treffen', !!t1.weiter && Math.abs(t1.weiter.x - t0.weiter.x) <= 1 && Math.abs(t1.weiter.y - t0.weiter.y) <= 1 && t1.weiter.h >= 40, { notiz: t0.weiter, dok: t1.weiter });
  pruefe('T3 die Leiste des Dokuments steht darüber, nichts überlappt, die Seite bleibt groß', !!t1.leiste?.da && t1.leiste.u <= t1.weiter.y + 1 && t1.blattB >= t1.b * 0.6 && t1.blattH >= t1.h * 0.5, t1);
  await Q.locator('[data-taste="vortrag-weiter"]').tap(); await Q.waitForTimeout(700);
  const t2 = await lage();
  pruefe('T4 „Weiter" am Telefon: von der PDF (Seite 1) direkt zur nächsten Karte', t2.zaehler === '3 / 3' && !t2.dok, t2);
  await T.ctx.close();
}

// ---------- E: Texte ----------
console.log('E  Texte');
{
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  const en = JSON.parse(lies('src/sprache/en.json'));
  pruefe('E1 englisch: Next card / Previous card', en['Nächste Karte (Strg+→)'] === 'Next card (Ctrl+→)' && en['Vorherige Karte (Strg+←)'] === 'Previous card (Ctrl+←)', [en['Nächste Karte (Strg+→)'], en['Vorherige Karte (Strg+←)']]);
  pruefe('E2 die Hilfe nennt M405 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M405)') && lies('src/components/HelpOverlayEn.tsx').includes('(M405)'));
  pruefe('E3 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm405-karte-und-seite: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
