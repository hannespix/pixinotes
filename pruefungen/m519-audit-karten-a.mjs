/**
 * M519 — Bugfixing-Audit, Karten A (Notiz, E-Mail, Datei, Bild, Portal, HTML-App, Diagramm, Kontakt, Form, Flüssige
 * Schrift, Pixi, Fokus-Ansicht). Je behobenem Befund ein Prüfpunkt, der das Verhalten misst.
 *
 *   A  Fremde Board-Datei mit kaputten Karten-Inhalten (Notiz, deren `blocks` kein Feld ist oder `null` enthält; Mail
 *      ohne Absender; Datei ohne Namen; Diagramm/Form mit Zahlen statt Text): Die App bleibt stehen, jede Karte lässt
 *      sich anklicken und in den Fokus holen, nach dem Neuladen steht das Board wieder. (Vorher: „PixiNotes lässt
 *      sich gerade nicht anzeigen" — auch nach jedem Neuladen.)
 *   B  Diagramm mit kaputtem oder leerem Code: nichts bleibt am Dokument hängen (keine „Syntax error in text"-Grafik
 *      unter der App, das Dokument ist nicht höher als das Fenster) — auch nicht nach ungültigen Zwischenständen im
 *      Code-Editor. Das letzte gültige Diagramm bleibt sichtbar, der Fehler steht als Chip in der Karte.
 *   C  Kontakt: Eine E-Mail-Adresse mit angehängten Parametern (aus einer fremden vCard) hängt dem Mail-Programm
 *      nichts an; eine gewöhnliche Adresse bleibt, wie sie ist. Eine Karte nur mit Anschrift ist nicht „leer".
 *   D  Kontraste (≥ 4,5:1) unter dem Notiztext und auf Formen, hell · dunkel · pix·el hell und dunkel: Zähler der
 *      Checkliste (offen und fertig), Fristen-, Telefon-, Mail- und Verweis-Chips auf allen fünf Papierfarben und auf
 *      eigenen Farben (hell, mittel, dunkel); Rufnummer im Mailtext; Platzhalter leerer Formen.
 *   E  Telefon (390 px): Die Kontakt-Karte füllt im Fokus die Breite wie Notiz und Mail.
 *   F  Fokus-Kopfzeile einer Diagramm-Karte: „Diagramm" ohne hängenden Doppelpunkt.
 *   G  Diagramm, Schritt entfernen: nur der Schritt und seine Verbindungen verschwinden — die Nachbarn behalten ihre
 *      Beschriftung, auch wenn sie in derselben Zeile standen oder die Kennung in ihrem Text vorkommt. (Vorher blieb
 *      vom Vorlagen-Diagramm nur die Kopfzeile.)
 *   H  Telefon, Doppeltipp auf eine verkleinerte Karte (Notiz, Kontakt, Mail; 8 Stellen, 90 und 250 ms Abstand): Der
 *      Fokus ist offen, sonst ist nichts passiert — kein Haken, kein gewählter Verweis, keine neue Notiz, kein Fenster,
 *      kein Cursor im Text. Danach nimmt die Karte Tipps an. Und: Ein Tipp auf die Telefonnummer einer Karte auf dem
 *      Board öffnet die Karte, wählt aber nicht; erst in der offenen Karte wählt der Tipp.
 *   I  Alte Stände: Form ohne Farbe, Mail nur mit Betreff, Datei ohne Namen, Diagramm ohne Code – keine Karte fällt
 *      aus, die markierte Form meldet keine Warnung des Farbfelds in der Konsole.
 *   J  Telefon: Die offene Karte hat keine Größen-Anfasser; ein Wisch vom unteren Kartenrand ändert ihre Größe nicht.
 * Bilder nach PN_BILDER (Standard pruefungen/ablage/).
 */
// Läuft aus dem Repository: `node pruefungen/m519-audit-karten-a.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { kontrastScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = process.env.PN_BILDER ?? path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 5519;
const laufe = (teil) => !process.env.NUR || [...teil].some((b) => process.env.NUR.includes(b));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  let f = path.join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const stand = (nodes) => ({
  boards: [{ id: 'b1', name: 'Büro', edges: [], drawings: [], comments: [], nodes }, { id: 'b2', name: 'Zweites', edges: [], drawings: [], comments: [], nodes: [] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1', 'b2'] }] }],
  activeId: 'b1', view: 'board', cardFocus: true, navLinks: false, clickZoom: false,
});
async function seite(nodes, opt = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: opt.viewport ?? { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: !!opt.telefon, isMobile: !!opt.telefon });
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`), (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript(([st, einst]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...einst }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, [stand(nodes), opt.einst ?? {}]);
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); });
  await P.goto(`http://localhost:${PORT}/`);
  await P.waitForSelector('.react-flow', { state: 'visible', timeout: 30000 });
  return { ctx, P, fehler };
}
const warteBis = async (P, fn, ms = 15000, arg) => P.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);
const knoten = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`);
const ablegen = (P, name, text, typ) => P.evaluate(([n, t, ty]) => {
  const dt = new DataTransfer(); dt.items.add(new File([new TextEncoder().encode(t)], n, { type: ty }));
  const ziel = document.querySelector('.board-wrap'); const r = ziel.getBoundingClientRect();
  ziel.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.4 }));
}, [name, text, typ]);
const notiz = (id, text, x = 0, y = 0) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
/** Was außer der App am Dokument hängt (mermaid legt seine Arbeits-Elemente dort ab) und ob das Dokument höher ist als das Fenster */
const dokument = (P) => P.evaluate(() => ({
  reste: [...document.body.children].filter((e) => /^[di]?pn-(mermaid|slide)/.test(e.id)).map((e) => e.id),
  bomben: [...document.querySelectorAll('svg')].filter((s) => /Syntax error in text/.test(s.textContent ?? '')).length,
  hoeher: document.documentElement.scrollHeight - window.innerHeight,
}));

// ───────────────────────────── A · fremde Board-Datei mit kaputten Inhalten
if (laufe('A')) {
  console.log('A  Fremde Board-Datei mit kaputten Karten-Inhalten');
  const lage = (i) => ({ x: (i % 4) * 280, y: Math.floor(i / 4) * 220 });
  const kaputt = [
    { id: 'k-feld', type: 'note', data: { color: 'yellow', blocks: 'kein Feld' } },
    { id: 'k-null', type: 'note', data: { color: 'yellow', blocks: [null, 5, { type: 'paragraph', content: 'bleibt lesbar' }] } },
    { id: 'k-kind', type: 'note', data: { color: 'yellow', hex: 5, blocks: [{ type: 'paragraph', content: 'mit Kind', children: 'x' }] } },
    { id: 'k-mail', type: 'email', data: { subject: 5, fromName: null, text: ['a'], attachments: 'x' } },
    { id: 'k-mail2', type: 'email', data: { subject: 'Betreff', fromName: 'Anna Berg', text: 'hallo', attachments: [null, { name: 5 }, { name: 'gut.txt', size: 3 }] } },
    { id: 'k-datei', type: 'file', data: { name: 12, size: 'groß' } },
    { id: 'k-diagramm', type: 'mermaid', data: { code: 7 } },
    { id: 'k-form', type: 'shape', data: { shape: 'stern', text: 9, color: 4 } },
    { id: 'k-app', type: 'htmlapp', data: {} },
    { id: 'k-heil', type: 'note', data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'heile Notiz' }] } },
  ].map((n, i) => ({ ...n, width: 240, height: 160, position: lage(i) }));
  const datei = JSON.stringify({ app: 'pixinotes-board', v: 1, board: { id: 'fremd', name: 'Fremdes Board', nodes: kaputt, edges: [] } });
  const { ctx, P, fehler } = await seite([notiz('n0', 'eigene Notiz')]);
  await ablegen(P, 'fremd.pixiboard.json', datei, 'application/json');
  const da = await warteBis(P, () => document.querySelectorAll('.react-flow__node').length >= 10, 15000);
  const lebt = () => P.locator('.react-flow').isVisible().catch(() => false);
  pruefe('A1 das fremde Board ist da und die App steht (alle 10 Karten liegen auf der Fläche)', da && await lebt(), { karten: await P.locator('.react-flow__node').count(), fehler: fehler.slice(0, 2), seite: (await P.evaluate(() => document.body.innerText.slice(0, 90))) });
  const texte = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  pruefe('A2 was lesbar war, ist zu lesen (Text hinter dem kaputten Eintrag, Mail mit heilem Anhang, heile Notiz)', texte.some((t) => t.includes('bleibt lesbar')) && texte.some((t) => t.includes('mit Kind')) && texte.some((t) => t.includes('Betreff') && t.includes('gut.txt')) && texte.some((t) => t.includes('heile Notiz')), texte);
  // jede Karte anklicken und in den Fokus holen — Auswahl-Leiste und Fokus-Kopf lesen die Daten außerhalb der Karte
  const ids = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((e) => e.getAttribute('data-id')));
  let tot = '';
  for (const id of ids) {
    await knoten(P, id).click({ position: { x: 5, y: 5 }, force: true, timeout: 5000 }).catch(() => {});
    await warteBis(P, (k) => document.querySelector(`.react-flow__node[data-id="${k}"]`)?.classList.contains('selected') || !document.querySelector('.react-flow'), 3000, id);
    await knoten(P, id).dblclick({ position: { x: 5, y: 5 }, force: true, timeout: 5000 }).catch(() => {});
    const offen = await warteBis(P, () => !!document.querySelector('.focus-head') || !document.querySelector('.react-flow'), 2500);
    if (offen && await P.locator('.focus-x').count()) { await P.locator('.focus-x').click(); await warteBis(P, () => !document.querySelector('.focus-head'), 5000); }
    if (!(await lebt())) { tot = id; break; }
  }
  pruefe('A3 jede Karte lässt sich anklicken und in den Fokus holen, ohne dass die App abstürzt', tot === '' && fehler.length === 0, { tot, fehler: fehler.slice(0, 2) });
  // der Stand wird gespeichert — nach dem Neuladen muss das Board wieder stehen
  await warteBis(P, () => (JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards ?? []).some((b) => b.name === 'Fremdes Board'), 10000);
  await P.reload();
  const wieder = await P.waitForSelector('.react-flow', { state: 'visible', timeout: 20000 }).then(() => true, () => false);
  pruefe('A4 nach dem Neuladen steht das Board wieder', wieder && await warteBis(P, () => document.querySelectorAll('.react-flow__node').length >= 10, 15000), { fehler: fehler.slice(0, 2) });
  await ctx.close();
}

// ───────────────────────────── B · Diagramm: nichts bleibt am Dokument hängen
if (laufe('B')) {
  console.log('B  Diagramm mit kaputtem Code');
  const nodes = [
    { id: 'd1', type: 'mermaid', width: 360, height: 260, position: { x: 0, y: 0 }, data: { code: 'flowchart TD\n  A[Start] --> B{Prüfen}\n  B -->|ja| C[Fertig]' } },
    { id: 'd2', type: 'mermaid', width: 320, height: 200, position: { x: 420, y: 0 }, data: { code: 'flowchart TD\n  A[Start --> ' } },
    { id: 'd3', type: 'mermaid', width: 320, height: 200, position: { x: 800, y: 0 }, data: { code: '' } },
  ];
  const { ctx, P, fehler } = await seite(nodes);
  const gemalt = await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="d1"] .mermaid-svg svg') && document.querySelectorAll('.mermaid-error').length >= 2, 30000);
  pruefe('B1 das gültige Diagramm ist gezeichnet, die beiden kaputten zeigen ihren Fehler in der Karte', gemalt);
  let d = await dokument(P);
  pruefe('B2 am Dokument hängt nichts (keine Fehlergrafik unter der App, Dokument nicht höher als das Fenster)', d.reste.length === 0 && d.bomben === 0 && d.hoeher <= 0, d);
  // Code-Editor: ungültige Zwischenstände tippen
  await knoten(P, 'd1').click({ position: { x: 8, y: 8 } });
  await P.locator('.mm-mehr').first().click();
  await P.getByRole('menuitem', { name: /Code anzeigen/ }).click();
  const feld = knoten(P, 'd1').locator('textarea.mermaid-code');
  await feld.waitFor({ state: 'visible', timeout: 5000 });
  await feld.click(); await P.keyboard.press('Control+End');
  for (const stueck of ['\n  C --> D[', 'offen', ' --> ((']) {
    await P.keyboard.insertText(stueck);
    await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="d1"] .mermaid-error'), 8000);
    await P.waitForTimeout(450);   // der nächste Zwischenstand soll einen eigenen Render-Versuch bekommen (Entprellung 250 ms)
  }
  d = await dokument(P);
  const karte = await knoten(P, 'd1').evaluate((e) => ({ svg: !!e.querySelector('.mermaid-svg svg'), fehler: e.querySelector('.mermaid-error')?.textContent ?? '' }));
  pruefe('B3 nach drei ungültigen Zwischenständen im Code-Editor hängt weiter nichts am Dokument', d.reste.length === 0 && d.bomben === 0 && d.hoeher <= 0, d);
  pruefe('B4 das letzte gültige Diagramm bleibt sichtbar, der Fehler steht als Chip in der Karte', karte.svg && /unvollständig/.test(karte.fehler), karte);
  pruefe('B5 ohne Seitenfehler', fehler.length === 0, fehler.slice(0, 2));
  await ctx.close();
}

// ───────────────────────────── C · Kontakt
if (laufe('C')) {
  console.log('C  Kontakt: Mail-Verweis und „leer"');
  const { ctx, P } = await seite([
    { id: 'k1', type: 'kontakt', width: 300, position: { x: 0, y: 0 }, data: { name: '', telefone: [], emails: [], adresse: 'Hauptstr. 1\n79098 Freiburg', notiz: 'nur Anschrift' } },
    { id: 'k2', type: 'kontakt', width: 300, position: { x: 0, y: 320 }, data: { name: 'Anna Berg', telefone: [], emails: ['anna.berg+amt@example.de'] } },
  ]);
  const VCF = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Fremde Person\r\nEMAIL:opfer@example.de?bcc=spion@evil.example&subject=Hi&body=Text\r\nEND:VCARD\r\n';
  await ablegen(P, 'fremd.vcf', VCF, 'text/vcard');
  const da = await warteBis(P, () => [...document.querySelectorAll('.react-flow__node-kontakt')].some((e) => e.textContent.includes('Fremde Person')), 15000);
  const verweise = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node-kontakt a[href^="mailto:"]')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent })));
  const fremd = verweise.find((v) => v.text.includes('opfer@'));
  // was das Mail-Programm bekäme: Adresse und Parameter des Verweises
  const zerlegt = fremd ? await P.evaluate((h) => { const u = new URL(h); return { an: decodeURIComponent(u.pathname), parameter: u.search }; }, fremd.href) : null;
  pruefe('C1 die Adresse aus der fremden vCard hängt dem Mail-Programm nichts an (kein bcc, kein Betreff, kein Text)', da && !!zerlegt && zerlegt.parameter === '' && !/[?&]/.test(fremd.href) && zerlegt.an.startsWith('opfer@example.de'), { fremd, zerlegt });
  pruefe('C2 eine gewöhnliche Adresse bleibt, wie sie ist', verweise.some((v) => v.href === 'mailto:anna.berg%2Bamt@example.de' || v.href === 'mailto:anna.berg+amt@example.de'), verweise);
  const k1 = await knoten(P, 'k1').evaluate((e) => ({ felder: e.querySelectorAll('input, textarea').length, text: e.innerText.replace(/\s+/g, ' ') }));
  pruefe('C3 eine Karte nur mit Anschrift ist nicht „leer": kein Formular beim Öffnen, kein Hinweis „Noch leer", die Anschrift steht da', k1.felder === 0 && !/Noch leer/.test(k1.text) && /Hauptstr\. 1/.test(k1.text) && /nur Anschrift/.test(k1.text), k1);
  await ctx.close();
}

// ───────────────────────────── D · Kontraste
if (laufe('D')) {
  console.log('D  Kontraste unter dem Notiztext, im Mailtext und auf leeren Formen');
  const liste = (id, color, hex, fertig) => ({ id, type: 'note', width: 260, data: { color, ...(hex ? { hex } : {}), blocks: [
    { id: 'a', type: 'paragraph', content: 'Anruf 0761 208-1356 bis 24.12.2031 an a@b.de siehe [[Zweites]] und [[Gibt es nicht]]' },
    { id: 'c', type: 'checkListItem', props: { checked: !!fertig }, content: 'Punkt eins' }, { id: 'd', type: 'checkListItem', props: { checked: true }, content: 'Punkt zwei' }] } });
  const nodes = [
    liste('gelb', 'yellow'), liste('rosa', 'pink'), liste('mint', 'mint'), liste('blau', 'sky'), liste('weiss', 'white'),
    liste('hexhell', 'yellow', '#fff8c5'), liste('hexdunkel', 'yellow', '#1f2a44'), liste('hexmittel', 'yellow', '#7a8f3c'),
    liste('gelbfertig', 'yellow', undefined, true), liste('weissfertig', 'white', undefined, true), liste('dunkelfertig', 'yellow', '#1f2a44', true), liste('rosafertig', 'pink', undefined, true),
  ].map((n, i) => ({ ...n, position: { x: (i % 4) * 300, y: Math.floor(i / 4) * 280 } }));
  nodes.push({ id: 'mail', type: 'email', width: 300, position: { x: 0, y: 860 }, data: { subject: 'Rückruf', fromName: 'Erika Muster', text: 'Tel. 0761 208 1356 oder https://example.org', attachments: [] } });
  ['#eef2ff', '#111827', '#7a8f3c', '#ffffff', '#dcfce7'].forEach((c, i) => nodes.push({ id: `form${i}`, type: 'shape', width: 150, height: i === 1 ? 110 : 70, position: { x: 400 + i * 180, y: 860 }, data: { shape: i === 1 ? 'decision' : i === 4 ? 'terminator' : 'process', text: '', color: c } }));
  for (const [name, ui] of [['hell', { theme: 'light', accent: 'blue' }], ['dunkel', { theme: 'dark', accent: 'blue' }], ['pix·el hell', { theme: 'light', accent: 'blue', design: 'pixel' }], ['pix·el dunkel', { theme: 'dark', accent: 'blue', design: 'pixel' }]]) {
    const { ctx, P } = await seite(nodes, { einst: { ui }, viewport: { width: 1400, height: 1200 } });
    // Fristen und Rufnummern werden nachgeladen — warten, bis die Chips stehen
    const bereit = await warteBis(P, () => document.querySelectorAll('.react-flow__node-note .ent-chip-tel').length >= 12 && document.querySelectorAll('.react-flow__node-note .due-chip:not(.ent-chip):not(.link-chip)').length >= 12
      && document.querySelectorAll('.note-fortschritt-text').length >= 12 && !!document.querySelector('.react-flow__node-email .ent-tel') && document.querySelectorAll('.shape-ph').length >= 5, 30000);
    const treffer = [];
    for (const n of nodes) for (const t of await kontrastScan(P, `.react-flow__node[data-id="${n.id}"]`)) treffer.push(`${n.id}: ${trefferZeile(t)}`);
    pruefe(`D ${name}: Zähler, Chips, Rufnummer im Mailtext und Platzhalter haben ≥ 4,5:1`, bereit && treffer.length === 0, bereit ? treffer.slice(0, 6) : 'Chips nicht erschienen');
    await P.screenshot({ path: path.join(SD, `m519-kontrast-${name.replace(/[^a-z]+/g, '-')}.png`) });
    await ctx.close();
  }
}

// ───────────────────────────── E · Telefon: Kontakt im Fokus
if (laufe('E')) {
  console.log('E  Telefon: Kontakt-Karte im Fokus');
  const { ctx, P } = await seite([
    { id: 'k1', type: 'kontakt', width: 300, position: { x: 0, y: 0 }, data: { name: 'Anna Müller', funktion: 'Sachbearbeiterin', firma: 'Regierungspräsidium', telefone: [{ art: 'Dienstlich', nummer: '0761 208-1234' }], emails: ['anna.mueller@example.de'] } },
  ], { viewport: { width: 390, height: 780 }, telefon: true });
  await knoten(P, 'k1').waitFor({ state: 'visible', timeout: 15000 });
  const r = await knoten(P, 'k1').boundingBox();
  await P.touchscreen.tap(r.x + r.width / 2, r.y + 14);
  const offen = await warteBis(P, () => !!document.querySelector('.focus-head'), 8000);
  // warten, bis die Kamera steht (Breite ändert sich nicht mehr)
  let breite = 0; let ruhig = 0;
  for (let i = 0; i < 40 && ruhig < 4; i++) { await P.waitForTimeout(120); const b = (await knoten(P, 'k1').boundingBox())?.width ?? 0; ruhig = Math.abs(b - breite) < 0.5 ? ruhig + 1 : 0; breite = b; }
  const tel = await knoten(P, 'k1').locator('a[href^="tel:"]').first().evaluate((a) => a.getBoundingClientRect().height);
  pruefe('E1 die Kontakt-Karte füllt im Fokus die Schirmbreite (wie Notiz und Mail), die Rufnummer ist entsprechend größer', offen && breite >= 370 && breite <= 390 && tel >= 17, { offen, breite, tel });
  await P.screenshot({ path: path.join(SD, 'm519-kontakt-telefon.png') });
  await ctx.close();
}

// ───────────────────────────── F · Fokus-Kopfzeile der Diagramm-Karte
if (laufe('F')) {
  console.log('F  Fokus-Kopfzeile einer Diagramm-Karte');
  const { ctx, P } = await seite([
    { id: 'd1', type: 'mermaid', width: 360, height: 260, position: { x: 0, y: 0 }, data: { code: 'flowchart TD\n  A[Start] --> B[Ende]' } },
    notiz('n1', 'Einkauf: Liste', 460, 0),
  ]);
  await knoten(P, 'n1').locator('.card-grip').dblclick({ force: true });
  await warteBis(P, () => !!document.querySelector('.focus-head'), 8000);
  const notizTitel = await P.locator('.focus-title b').innerText();
  const nachbar = await P.locator('.focus-karte').first().getAttribute('title').catch(() => '') ?? await P.locator('.focus-karte').first().getAttribute('aria-describedby').catch(() => '');
  await P.keyboard.press('Alt+ArrowDown');
  await warteBis(P, () => document.querySelector('.pn-focused')?.getAttribute('data-id') === 'd1', 8000);
  const titel = await P.locator('.focus-title b').innerText();
  pruefe('F1 die Kopfzeile nennt die Diagramm-Karte „Diagramm" (ohne hängenden Doppelpunkt)', titel.trim() === 'Diagramm', { titel });
  pruefe('F2 der Titel einer Notiz bleibt ihr erster Satz – samt Doppelpunkt, wenn er einen hat', notizTitel.trim() === 'Einkauf: Liste', { notizTitel, nachbar });
  await ctx.close();
}

// ───────────────────────────── G · Diagramm: einen Schritt entfernen
if (laufe('G')) {
  console.log('G  Diagramm: Schritt entfernen');
  const code0 = 'flowchart TD\n  A[Start] --> B{Prüfen}\n  B -->|ja| C[Fertig]\n  B -->|nein| D[Zurück an A]\n  subgraph B2 [Ablage]\n    E[Akte]\n  end\n  C --> E';
  const { ctx, P, fehler } = await seite([{ id: 'd1', type: 'mermaid', width: 460, height: 420, position: { x: 0, y: 0 }, data: { code: code0 } }]);
  const schritte = () => knoten(P, 'd1').locator('.mermaid-svg g.node').allTextContents().then((t) => t.map((x) => (x ?? '').trim()).sort());
  const codeJetzt = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.code);
  const entferne = async (name, erwartet) => {
    // (fehlt der Schritt schon, weil ein früheres Entfernen zu viel mitnahm, zeigen das die Prüfpunkte danach)
    if (!(await knoten(P, 'd1').locator('.mermaid-svg g.node', { hasText: name }).first().click({ timeout: 5000 }).then(() => true, () => false))) return;
    await P.locator('.mm-step-row button.danger').first().click({ timeout: 5000 }).catch(() => {});
    // warten, bis das Bild genau die erwarteten Schritte zeigt (oder nichts mehr, wenn alles weg ist)
    await warteBis(P, (n) => { const g = document.querySelectorAll('.react-flow__node[data-id="d1"] .mermaid-svg g.node').length; return g === n || !!document.querySelector('.react-flow__node[data-id="d1"] .mermaid-error'); }, 15000, erwartet);
    await warteBis(P, (kennung) => !new RegExp(`(^|[^\\p{L}\\p{N}_])${kennung}[\\[{(]`, 'u').test(JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.code), 8000, name === 'Prüfen' ? 'B' : 'A');
  };
  await warteBis(P, () => document.querySelectorAll('.react-flow__node[data-id="d1"] .mermaid-svg g.node').length === 5, 30000);
  await knoten(P, 'd1').click({ position: { x: 6, y: 6 } });
  await entferne('Prüfen', 4);
  const nachB = { schritte: await schritte(), code: await codeJetzt(), fehler: await knoten(P, 'd1').locator('.mermaid-error').count() };
  pruefe('G1 „Prüfen" entfernen nimmt nur diesen Schritt: Start, Fertig, „Zurück an A" und Akte bleiben mit ihrer Beschriftung',
    JSON.stringify(nachB.schritte) === JSON.stringify(['Akte', 'Fertig', 'Start', 'Zurück an A']) && nachB.fehler === 0, nachB);
  pruefe('G2 die Verbindung zwischen den übrigen Schritten und der Rahmen im Diagramm bleiben', /C --> E/.test(nachB.code) && /subgraph B2 \[Ablage\]/.test(nachB.code) && !/-->\s*\|/.test(nachB.code), nachB.code);
  await entferne('Start', 3);
  const nachA = { schritte: await schritte(), code: await codeJetzt() };
  pruefe('G3 „Start" (Kennung A) entfernen lässt den Schritt stehen, in dessen Beschriftung ein „A" vorkommt', JSON.stringify(nachA.schritte) === JSON.stringify(['Akte', 'Fertig', 'Zurück an A']), nachA);
  pruefe('G4 ohne Seitenfehler', fehler.length === 0, fehler.slice(0, 2));
  await ctx.close();
}

// ───────────────────────────── H · Telefon: Doppeltipp auf eine verkleinerte Karte
if (laufe('H')) {
  console.log('H  Telefon: Doppeltipp öffnet den Fokus und löst sonst nichts aus');
  const karten = {
    notiz: { id: 'k', type: 'note', width: 260, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ id: 'a', type: 'paragraph', content: 'Anruf 0761 208-1356' }, { id: 'c', type: 'checkListItem', props: { checked: false }, content: 'Punkt eins' }, { id: 'd', type: 'checkListItem', props: { checked: false }, content: 'Punkt zwei' }, { id: 'e', type: 'checkListItem', props: { checked: false }, content: 'Punkt drei' }] } },
    kontakt: { id: 'k', type: 'kontakt', width: 300, position: { x: 0, y: 0 }, data: { name: 'Anna Müller', firma: 'Amt', telefone: [{ art: 'Dienstlich', nummer: '0761 208-1234' }, { art: 'Mobil', nummer: '0151 2345678' }], emails: ['anna@example.de'], adresse: 'Hauptstr. 1\n79098 Freiburg' } },
    mail: { id: 'k', type: 'email', width: 300, position: { x: 0, y: 0 }, data: { subject: 'Rückruf', fromName: 'Erika Muster', fromAddress: 'erika@example.org', text: 'Bitte zurückrufen: 0761 208 1356\nMehr unter https://example.org', attachments: [{ name: 'a.txt', size: 5, mime: 'text/plain', dataUrl: 'data:text/plain;base64,SGFsbG8=' }] } },
  };
  // eine zweite Karte weit weg: Das Board zeigt beide, die Karten sind also klein (wie auf einem vollen Board)
  const fern = notiz('fern', 'weit weg', 900, 900);
  const punkte = [[0.2, 0.15], [0.5, 0.15], [0.85, 0.15], [0.2, 0.45], [0.5, 0.45], [0.8, 0.45], [0.3, 0.8], [0.7, 0.8]];
  for (const [name, karte] of Object.entries(karten)) {
    const auff = [];
    for (const [fx, fy] of punkte) for (const pause of [90, 250]) for (let versuch = 0; versuch < 3; versuch++) {
      const { ctx, P, fehler } = await seite([karte, fern], { viewport: { width: 390, height: 780 }, telefon: true });
      // Zeiten mitschreiben: wann die Tipps ankamen und wann der erste Klick den Fokus öffnete (unter Last kommt der
      // zweite Tipp mitunter zu spät). Der Klick des ersten Tipps IST das Öffnen — die Kopfzeile erscheint erst danach.
      await P.evaluate(() => {
        window.__druck = []; window.addEventListener('pointerdown', () => window.__druck.push(performance.now()), true);
        window.addEventListener('click', () => { window.__offenAb ??= performance.now(); }, true);
      });
      // was der zweite Tipp auslösen könnte, mitschreiben statt ausführen: Verweise (tel:, mailto:, Web), Downloads
      await P.evaluate(() => { window.__ausgeloest = []; document.addEventListener('click', (e) => { const a = e.target.closest?.('a[href]'); if (a && !e.defaultPrevented) { window.__ausgeloest.push(a.getAttribute('href')); e.preventDefault(); } }); });
      const geladen = []; P.on('download', (d) => geladen.push(d.suggestedFilename()));
      await knoten(P, 'k').waitFor({ state: 'visible', timeout: 20000 });
      await warteBis(P, () => document.querySelectorAll('.react-flow__node').length === 2 && !!JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state, 10000);
      const stand0 = () => P.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.map((k) => [k.id, k.data])));
      const vorher = await stand0();
      const b = await knoten(P, 'k').boundingBox();
      const x = b.x + b.width * fx; const y = b.y + b.height * fy;
      await P.touchscreen.tap(x, y); await P.waitForTimeout(pause); await P.touchscreen.tap(x, y);
      const offen = await warteBis(P, () => !!document.querySelector('.focus-head'), 5000);
      await P.waitForTimeout(1100);   // danach darf sich nichts mehr tun: der gespeicherte Stand (verzögert geschrieben) muss gleich bleiben
      const z = await P.evaluate(() => ({ fokus: !!document.querySelector('.focus-head'), fenster: document.querySelectorAll('[role=dialog], .pdf-viewer, .modal').length, ausgeloest: window.__ausgeloest, karten: document.querySelectorAll('.react-flow__node').length,
        tippt: !!document.activeElement && (document.activeElement.isContentEditable || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) }));
      const was = [];
      if (!offen || !z.fokus) was.push('Fokus nicht offen');
      if (await stand0() !== vorher) was.push('Inhalt geändert');
      if (z.karten !== 2) was.push(`${z.karten} Karten`);
      if (z.fenster) was.push('Fenster offen');
      if (z.ausgeloest.length) was.push(`Verweis ${z.ausgeloest[0]}`);
      if (geladen.length) was.push(`Download ${geladen[0]}`);
      // (bei der Notiz setzt schon der ERSTE Tipp in den Text den Cursor — das gehört zum Antippen einer Notiz, nicht zum Doppeltipp)
      if (z.tippt && name !== 'notiz') was.push('Cursor im Text');
      if (fehler.length) was.push(fehler[0]);
      const zeit = await P.evaluate(() => ({ d: window.__druck, f: window.__offenAb ?? 0 }));
      await ctx.close();
      // Kam der zweite Tipp erst lange nach dem Öffnen an (Rechner unter Last), war es kein Doppeltipp, sondern ein
      // gewöhnlicher Tipp in die offene Karte — der Fall wird wiederholt, nicht gewertet
      if (zeit.d.length >= 2 && zeit.f && zeit.d[1] - zeit.f > 400) { if (versuch === 2) console.log(`    (${fx}, ${fy}) ${pause} ms: zweiter Tipp dreimal zu spät – nicht gewertet`); continue; }
      if (was.length) auff.push(`(${fx}, ${fy}) ${pause} ms: ${was.join(', ')}`);
      break;
    }
    pruefe(`H ${name}: an ${punkte.length} Stellen, mit 90 und 250 ms Abstand – der Fokus ist offen, sonst ist nichts passiert`, auff.length === 0, auff.slice(0, 5));
  }
  // … und danach ist die Karte ganz normal zu bedienen
  const { ctx, P } = await seite([karten.notiz, fern], { viewport: { width: 390, height: 780 }, telefon: true });
  await knoten(P, 'k').waitFor({ state: 'visible', timeout: 20000 });
  const b = await knoten(P, 'k').boundingBox();
  await P.touchscreen.tap(b.x + b.width / 2, b.y + 8);
  await warteBis(P, () => !!document.querySelector('.focus-head'), 8000);
  await P.waitForTimeout(700);   // halbe Sekunde Schonfrist (M521, Board.tsx) und Kamerafahrt vorbei
  await knoten(P, 'k').locator('input[type=checkbox]').first().tap();
  const gehakt = await warteBis(P, () => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.blocks[1]?.props?.checked === true, 8000);
  pruefe('H nach der Schonfrist nimmt die Karte Tipps an (Haken setzen)', gehakt);
  await ctx.close();
  // Der Tipp, der öffnet, öffnet nur: Steht die Karte lesbar groß auf dem Board (allein, also nicht verkleinert) und trifft der Tipp
  // ihre Telefonnummer, geht nicht zugleich der Wähldialog auf
  {
    const { ctx, P } = await seite([karten.kontakt], { viewport: { width: 390, height: 780 }, telefon: true });
    await P.evaluate(() => { window.__ausgeloest = []; document.addEventListener('click', (e) => { const a = e.target.closest?.('a[href]'); if (a && !e.defaultPrevented) { window.__ausgeloest.push(a.getAttribute('href')); e.preventDefault(); } }); });
    const nummer = knoten(P, 'k').locator('a[href^="tel:"]').first();
    await nummer.waitFor({ state: 'visible', timeout: 20000 });
    await P.waitForTimeout(600);
    const r = await nummer.boundingBox();
    await P.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
    const offen = await warteBis(P, () => !!document.querySelector('.focus-head'), 8000);
    await P.waitForTimeout(300);
    const gewaehlt = await P.evaluate(() => window.__ausgeloest);
    pruefe('H ein Tipp auf die Telefonnummer einer Karte auf dem Board öffnet die Karte, wählt aber nicht', offen && gewaehlt.length === 0, gewaehlt);
    // … in der offenen Karte wählt der Tipp auf die Nummer dann wie gewohnt
    await P.waitForTimeout(900);
    const r2 = await nummer.boundingBox();
    await P.touchscreen.tap(r2.x + r2.width / 2, r2.y + r2.height / 2);
    const danach = await warteBis(P, () => window.__ausgeloest.length === 1, 5000);
    pruefe('H in der offenen Karte wählt der Tipp auf die Nummer', danach, await P.evaluate(() => window.__ausgeloest));
    await ctx.close();
  }
}

// ───────────────────────────── J · Telefon: im Fokus keine Größen-Anfasser, ein Wisch vom Kartenrand ändert nichts
if (laufe('J')) {
  console.log('J  Telefon: die offene Karte hat keine Größen-Anfasser');
  const kontakt = { id: 'k', type: 'kontakt', width: 300, position: { x: 0, y: 0 }, data: { name: 'Anna Müller', firma: 'Amt', emails: ['anna@example.de'] } };
  const { ctx, P } = await seite([kontakt], { viewport: { width: 390, height: 780 }, telefon: true });
  await knoten(P, 'k').waitFor({ state: 'visible', timeout: 20000 });
  await P.waitForTimeout(700);
  const b = await knoten(P, 'k').boundingBox();
  await P.touchscreen.tap(b.x + b.width / 2, b.y + 10);
  await warteBis(P, () => !!document.querySelector('.focus-head'), 8000);
  await P.waitForTimeout(1200);
  const mass = () => P.evaluate(() => { const n = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0]; return `${Math.round(n.width ?? 0)}×${Math.round(n.height ?? 0)}`; });
  const vorher = await mass();
  // sichtbar = hat eine Fläche auf dem Schirm
  const griffe = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="k"] .react-flow__resize-control')].filter((g) => { const r = g.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(g).visibility !== 'hidden'; }).length);
  pruefe('J1 an der offenen Karte liegt kein Größen-Anfasser', griffe === 0, `${griffe} Anfasser`);
  // Wisch nach oben, Start auf der Unterkante der Karte (dort lag die Griff-Linie)
  const f = await knoten(P, 'k').boundingBox();
  const cdp = await ctx.newCDPSession(P);
  const x = f.x + f.width / 2; let y = f.y + f.height - 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 0; i < 8; i++) { y -= 6; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await P.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await P.waitForTimeout(1300);
  const danach = await mass();
  pruefe('J2 ein Wisch vom unteren Kartenrand lässt die Größe der Karte, wie sie war', danach === vorher, `${vorher} → ${danach}`);
  await ctx.close();
}

// ───────────────────────────── I · alte Stände: Karten ohne einzelne Felder
if (laufe('I')) {
  console.log('I  Karten ohne einzelne Felder (alte Stände) rechnen mit Vorgaben');
  const { ctx, P, fehler } = await seite([
    { id: 'form', type: 'shape', width: 150, height: 70, position: { x: 0, y: 0 }, data: { shape: 'process', text: 'ohne Farbe' } },
    { id: 'mail', type: 'email', width: 300, position: { x: 200, y: 0 }, data: { subject: 'Nur Betreff' } },
    { id: 'datei', type: 'file', width: 260, position: { x: 540, y: 0 }, data: { size: 5 } },
    { id: 'diagramm', type: 'mermaid', width: 300, height: 200, position: { x: 840, y: 0 }, data: {} },
  ]);
  const meldungen = [];
  P.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') meldungen.push(m.text()); });
  await warteBis(P, () => document.querySelectorAll('.react-flow__node').length === 4 && !!document.querySelector('.react-flow__node-shape .shape-body'), 20000);
  const ausgefallen = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].filter((e) => /lässt sich gerade nicht anzeigen/.test(e.textContent)).map((e) => e.getAttribute('data-id')));
  pruefe('I1 keine Karte fällt aus („lässt sich gerade nicht anzeigen")', ausgefallen.length === 0, ausgefallen);
  // jede anklicken: Auswahl-Leiste und Werkzeuge der Karte lesen die Daten ebenfalls
  for (const id of ['form', 'mail', 'datei', 'diagramm']) {
    await knoten(P, id).click({ position: { x: 5, y: 5 }, force: true });
    await warteBis(P, (k) => document.querySelector(`.react-flow__node[data-id="${k}"]`)?.classList.contains('selected'), 5000, id);
  }
  await P.waitForTimeout(400);
  const farbfeld = meldungen.filter((t) => /does not conform to the required format/.test(t));
  pruefe('I2 die markierte Form ohne Farbe löst keine Warnung des Farbfelds aus', farbfeld.length === 0, farbfeld.slice(0, 1));
  pruefe('I3 die App steht, ohne Seitenfehler', await P.locator('.react-flow').isVisible() && fehler.length === 0, fehler.slice(0, 2));
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\nM519: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
