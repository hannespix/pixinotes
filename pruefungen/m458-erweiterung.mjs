/**
 * M458 — Browser-Erweiterung „An PixiNotes senden" (Ordner erweiterung/).
 *
 * Chromium startet MIT der entpackten Erweiterung (--load-extension, headless). Die App läuft auf einem lokalen
 * Server (Port 5458), die Ausgangsseiten auf einem zweiten (Port 6458, andere Herkunft). Die Erweiterung ist auf
 * die App-Adresse eingestellt. Kontextmenü und Werkzeugleisten-Knopf lassen sich im Prüflauf nicht anklicken
 * (das ist Browser-Oberfläche, keine Seite) — die Reihe ruft deshalb dieselben Funktionen im Hintergrund der
 * Erweiterung auf, die die Menüs auslösen (globalThis.pixinotesSenden).
 *
 *   A  Seite senden: der PixiNotes-Tab kommt nach vorn, der Empfangs-Dialog fragt nach dem Board, danach liegt
 *      eine Notiz mit Titel, Auszug und echtem Verweis auf die Seite auf dem gewählten Board.
 *   B  Markierten Text senden mit „ohne Rückfrage": Karte gleich auf dem geöffneten Board, kurze Meldung.
 *   C  Bild senden (Rechtsklick auf ein Bild): eine Bild-Karte mit genau diesem Bild.
 *   D  Sichtbaren Bereich senden: eine Bild-Karte mit dem Bildschirmfoto.
 *   E  Kein PixiNotes-Tab offen: die Erweiterung öffnet ihn und liefert, sobald die App bereit ist.
 *   F  Manipulierte Eingaben: Skript-Tags bleiben Text und laufen nie, „javascript:"-Adressen und SVG-Bilder
 *      werden verworfen, Nachrichten aus eingebetteten Rahmen und fremder Herkunft ignoriert.
 *   G  Rückfallweg Adress-Fragment (#pixinotes-senden=…): Dialog, Fragment verschwindet, Bilder und „ohne
 *      Rückfrage" kommen darüber nicht an.
 *   H  Adresse ohne Berechtigung: Text kommt über das Fragment in einem neuen Tab, ein Bild wird abgelehnt.
 *   I  Paket: ZIP aus `npm run build:erweiterung`, Berechtigungen schmal, beide Sprachen.
 */
// Läuft aus dem Repository: `node pruefungen/m458-erweiterung.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import http from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const ERW = path.join(__repo, 'erweiterung');
const PORT = 5458;
const PORT_SEITE = 6458;
const APP = `http://127.0.0.1:${PORT}/`;
const SEITE = `http://127.0.0.1:${PORT_SEITE}`;

const typen = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const app = http.createServer((q, r) => {
  const p = q.url.split('?')[0];
  let f = join(DIST, p === '/' ? 'index.html' : p.slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': typen[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

const BILD = readFileSync(path.join(ERW, 'icons', 'icon-128.png'));
const seiten = {
  '/artikel.html': `<!doctype html><html><head><meta charset="utf-8"><title>Fährplan Amrum</title>
    <meta name="description" content="Abfahrten der Fähre nach Amrum im Sommer."></head>
    <body style="background:#2a7d4f;margin:0;height:2000px"><h1>Fährplan</h1>
    <p id="absatz">Die Fähre fährt stündlich ab Dagebüll, an Wochenenden zusätzlich um 7 Uhr früh. Bitte rechtzeitig buchen.</p>
    <img id="bild" src="/bild.png" width="128" height="128" alt=""></body></html>`,
  '/boese.html': `<!doctype html><html><head><meta charset="utf-8">
    <title>&lt;script&gt;window.__boese=1&lt;/script&gt;&lt;img src=x onerror="window.__boese=2"&gt;</title></head>
    <body><p>&lt;img src=x onerror="window.__boese=3"&gt; Kurzer Absatz, der lang genug ist, um als Auszug zu zählen, wirklich.</p></body></html>`,
  '/rahmen.html': `<!doctype html><html><body><script>
    parent.postMessage({ typ: 'pixinotes-erweiterung', id: 'x', sendung: { v: 1, art: 'auswahl', titel: 'Fremder Rahmen', text: 'von fremder Herkunft' } }, '*');
    </script></body></html>`,
};
const quelle = http.createServer((q, r) => {
  const p = q.url.split('?')[0];
  if (p === '/bild.png') { r.writeHead(200, { 'Content-Type': 'image/png' }); r.end(BILD); return; }
  r.writeHead(seiten[p] ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(seiten[p] ?? 'fehlt');
});
await new Promise((x) => quelle.listen(PORT_SEITE, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};

// ── Browser mit Erweiterung ─────────────────────────────────────────────
const profil = mkdtempSync(path.join(os.tmpdir(), 'm458-'));
const ctx = await chromium.launchPersistentContext(profil, {
  executablePath: CHROMIUM,
  headless: true,
  viewport: { width: 1280, height: 860 },
  args: ['--no-sandbox', `--disable-extensions-except=${ERW}`, `--load-extension=${ERW}`,
    // Für Extensions.triggerAction (Klick auf den Werkzeugleisten-Knopf, Teil D) — Browser-Ebene des Protokolls
    `--remote-debugging-port=${PORT + 2000}`, '--enable-unsafe-extension-debugging',
    // Teil H: eine Adresse, für die die Erweiterung KEINE Berechtigung hat (zeigt auf denselben Server)
    '--host-resolver-rules=MAP pixinotes.test 127.0.0.1'],
});
// Ausgangszustand der App (nur auf ihrer Herkunft, nicht auf den Ausgangsseiten)
await ctx.addInitScript(([port]) => {
  if (location.port !== String(port) || sessionStorage.getItem('m458-gesaet')) return;
  sessionStorage.setItem('m458-gesaet', '1');
  // M478: Diese Reihe prüft den Empfangs-Dialog — mit dem Eingang (Vorgabe an) käme alles ohne Dialog dorthin (m478)
  localStorage.setItem('pixinotes-eingang-sammeln', '0');
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [
      { id: 'b0', name: 'Schreibtisch', edges: [], drawings: [], comments: [], nodes: [] },
      { id: 'b1', name: 'Recherche', edges: [], drawings: [], comments: [], nodes: [] },
    ],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Alltag', boardIds: ['b0', 'b1'] }] }],
    activeId: 'b0', view: 'board', cardFocus: true } }));
}, [PORT]);

let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
pruefe('die Erweiterung lädt (Hintergrund läuft)', !!sw, String(ctx.serviceWorkers().map((w) => w.url())));
if (!sw) { await ctx.close(); app.close(); quelle.close(); process.exit(1); }
const einstellen = (werte) => sw.evaluate((w) => chrome.storage.local.set(w), werte);
await einstellen({ adresse: APP, direkt: false });

const fehlerSeiten = [];
ctx.on('page', (p) => p.on('pageerror', (e) => fehlerSeiten.push(e.message)));

const stand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const karten = async (P, boardId) => { const st = await stand(P); return st.boards.find((b) => b.id === (boardId ?? st.activeId)).nodes; };
const alsText = (n) => JSON.stringify(n.data.blocks ?? []);
/** Funktion im Hintergrund der Erweiterung, wie sie das Menü auslöst — Tab der Ausgangsseite per Adresse */
const sende = (was, pfad, ...args) => sw.evaluate(async ([was, url, args]) => {
  const [tab] = await chrome.tabs.query({ url });
  if (!tab) return 'kein Tab';
  try { await globalThis.pixinotesSenden[was](tab, ...args); return 'ok'; } catch (e) { return `Fehler: ${e.message}`; }
}, [was, `${SEITE}${pfad}`, args]);

const P = await ctx.newPage();
await P.goto(APP, { waitUntil: 'networkidle' });
await P.waitForTimeout(1500);
pruefe('die App meldet ihren Eingang bereit', await P.evaluate(() => document.documentElement.dataset.pixinotesEingang === 'bereit'));
const Q = await ctx.newPage();
await Q.goto(`${SEITE}/artikel.html`, { waitUntil: 'load' });

// ══ A: Seite senden → Dialog → gewähltes Board ══════════════════════════
console.log('════ A: Seite senden ════');
{
  await Q.bringToFront();
  const r = await sende('seite', '/artikel.html');
  pruefe('A1 der Hintergrund sendet ohne Fehler', r === 'ok', r);
  await P.waitForSelector('.geteilt-modal', { timeout: 10000 }).catch(() => {});
  const vorne = await P.evaluate(() => document.visibilityState);
  pruefe('A2 der PixiNotes-Tab ist nach vorn geholt', vorne === 'visible', vorne);
  pruefe('A3 der Empfangs-Dialog fragt nach dem Ziel', await P.locator('.geteilt-modal').count() === 1);
  const kopf = await P.locator('.geteilt-modal .modal-head b').textContent().catch(() => '');
  pruefe('A4 und sagt, dass es aus dem Browser kommt', /Browser/.test(kopf), kopf);
  const vorschau = await P.locator('.geteilt-text').first().textContent().catch(() => '');
  pruefe('A5 die Vorschau zeigt Titel, Auszug und Adresse',
    /Fährplan Amrum/.test(vorschau) && /Abfahrten der Fähre/.test(vorschau) && vorschau.includes(`${SEITE}/artikel.html`), vorschau);
  await P.screenshot({ path: `${SD}/m458-dialog.png` });
  await P.locator('.geteilt-modal select').first().selectOption({ label: 'Recherche' });
  await P.locator('.geteilt-ok').click();
  await P.waitForTimeout(1800);
  const k = await karten(P, 'b1');
  const notiz = k.find((n) => n.type === 'note');
  pruefe('A6 eine Notiz liegt auf dem gewählten Board', !!notiz, JSON.stringify(k.map((n) => n.type)));
  const verweis = notiz?.data.blocks.flatMap((b) => b.content ?? []).find((c) => c.type === 'link');
  pruefe('A7 die Adresse ist ein echter Verweis auf die Seite', verweis?.href === `${SEITE}/artikel.html`, JSON.stringify(verweis));
  pruefe('A8 man steht danach auf diesem Board', (await stand(P)).activeId === 'b1');
}

// ══ B: Auswahl, ohne Rückfrage ══════════════════════════════════════════
console.log('\n════ B: Auswahl ohne Rückfrage ════');
{
  await einstellen({ adresse: APP, direkt: true });
  await Q.bringToFront();
  await Q.evaluate(() => {
    const r = document.createRange(); r.selectNodeContents(document.getElementById('absatz'));
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  const vorher = (await karten(P, 'b1')).length;
  const r = await sende('auswahl', '/artikel.html', 'Ersatztext aus dem Menü');
  pruefe('B1 gesendet', r === 'ok', r);
  await P.waitForTimeout(1800);
  pruefe('B2 kein Dialog — gleich aufs Board', await P.locator('.geteilt-modal').count() === 0);
  const k = await karten(P, 'b1');
  pruefe('B3 eine Karte mehr auf dem geöffneten Board', k.length === vorher + 1, `${vorher} → ${k.length}`);
  pruefe('B4 mit dem markierten Text', /stündlich ab Dagebüll/.test(alsText(k.at(-1))), alsText(k.at(-1)).slice(0, 200));
  const meldung = await P.evaluate(() => document.body.innerText);
  pruefe('B5 eine kurze Meldung bestätigt es', /Aus dem Browser übernommen/.test(meldung));
}

// ══ C: Bild senden ══════════════════════════════════════════════════════
console.log('\n════ C: Bild ════');
{
  await Q.bringToFront();
  const vorher = (await karten(P, 'b1')).length;
  const r = await sende('bild', '/artikel.html', `${SEITE}/bild.png`);
  pruefe('C1 gesendet', r === 'ok', r);
  await P.waitForTimeout(2200);
  const k = await karten(P, 'b1');
  const bild = k.slice(vorher).find((n) => n.type === 'image');
  pruefe('C2 eine Bild-Karte ist entstanden', !!bild, JSON.stringify(k.slice(vorher).map((n) => n.type)));
  pruefe('C3 und zwar NUR das Bild (keine Notiz daneben)', k.length === vorher + 1, `${vorher} → ${k.length}`);
  // Bild-Inhalt: gleiche Breite wie die Vorlage (128 px)
  const breite = await P.evaluate(() => new Promise((ok) => {
    const img = [...document.querySelectorAll('.react-flow__node img')].at(-1);
    if (!img) return ok(0);
    if (img.complete) ok(img.naturalWidth); else img.onload = () => ok(img.naturalWidth);
  }));
  pruefe('C4 das Bild ist angekommen (128 px wie die Vorlage)', breite === 128, String(breite));
}

// ══ D: Werkzeugleisten-Knopf (echter Klick über das Protokoll) und sichtbarer Bereich ══
console.log('\n════ D: Knopf und Bildschirmfoto ════');
{
  /** Browser-Befehl über die Debug-Schnittstelle (Playwright reicht die Browser-Ebene nicht durch) */
  const browserBefehl = async (methode, params) => {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT + 2000}/json/version`)).json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
    const antwort = await new Promise((ok) => {
      ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id === 1) ok(d); };
      ws.send(JSON.stringify({ id: 1, method: methode, params }));
    });
    ws.close();
    return antwort;
  };
  await Q.bringToFront();
  await Q.evaluate(() => getSelection().removeAllRanges());
  await Q.waitForTimeout(300);
  const ziele = (await browserBefehl('Target.getTargets', { filter: [{ type: 'tab' }] })).result?.targetInfos ?? [];
  const zielId = ziele.find((z) => z.type === 'tab' && z.url.startsWith(`${SEITE}/artikel.html`))?.targetId;
  const erwId = new URL(sw.url()).host;
  const vorK = (await karten(P, 'b1')).length;
  const klick = await browserBefehl('Extensions.triggerAction', { id: erwId, targetId: zielId });
  pruefe('D1 Klick auf den Knopf der Erweiterung', !klick.error, JSON.stringify(klick.error));
  await P.waitForTimeout(2500);
  const kk = await karten(P, 'b1');
  pruefe('D2 der Knopf sendet die Seite (direkt: Notiz mit Verweis)',
    kk.length === vorK + 1 && alsText(kk.at(-1)).includes(`${SEITE}/artikel.html`), alsText(kk.at(-1) ?? { data: {} }).slice(0, 200));
  // Der Klick hat „activeTab" für die Ausgangsseite erteilt — damit darf die Erweiterung den Bereich aufnehmen
  await Q.bringToFront();
  await Q.waitForTimeout(400);
  const vorher = (await karten(P, 'b1')).length;
  const r = await sende('bildschirm', '/artikel.html');
  pruefe('D3 sichtbaren Bereich gesendet', r === 'ok', r);
  await P.waitForTimeout(2500);
  const k = await karten(P, 'b1');
  const bild = k.slice(vorher).find((n) => n.type === 'image');
  pruefe('D4 eine Bild-Karte mit dem Bildschirmfoto', !!bild, JSON.stringify(k.slice(vorher).map((n) => n.type)));
  // Das Foto zeigt die grüne Seite, nicht PixiNotes
  const gruen = await P.evaluate(() => new Promise((ok) => {
    const img = [...document.querySelectorAll('.react-flow__node img')].at(-1);
    const lesen = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const [r, g, b] = x.getImageData(Math.floor(c.width * 0.8), Math.floor(c.height * 0.8), 1, 1).data;
      ok({ r, g, b, w: c.width });
    };
    if (!img) ok(null); else if (img.complete) lesen(); else img.onload = lesen;
  }));
  pruefe('D5 das Foto zeigt die gesendete Seite (grüner Grund)', gruen && gruen.g > 100 && gruen.r < 80 && gruen.w > 600, JSON.stringify(gruen));
}

// ══ E: Kein PixiNotes-Tab offen ═════════════════════════════════════════
console.log('\n════ E: Tab wird geöffnet ════');
{
  await einstellen({ adresse: APP, direkt: false });
  await P.close();
  await Q.bringToFront();
  const neu = ctx.waitForEvent('page', { timeout: 15000 });
  const r = await sende('seite', '/artikel.html');
  pruefe('E1 gesendet', r === 'ok', r);
  const N = await neu.catch(() => null);
  pruefe('E2 die Erweiterung hat PixiNotes geöffnet', !!N && N.url().startsWith(APP), N?.url());
  if (N) {
    await N.waitForSelector('.geteilt-modal', { timeout: 15000 }).catch(() => {});
    pruefe('E3 und die Sendung kommt an, sobald die App bereit ist', await N.locator('.geteilt-modal').count() === 1);
    await N.locator('.geteilt-verwerfen').click().catch(() => {});
  }
}
const pixi = () => ctx.pages().find((p) => p.url().startsWith(APP));
const R = pixi();

// ══ F: Manipulierte Eingaben ════════════════════════════════════════════
console.log('\n════ F: Manipulation ════');
{
  // F-a: über die Erweiterung, aus einer Seite mit Skript im Titel und im Text
  await einstellen({ adresse: APP, direkt: true });
  const B = await ctx.newPage();
  await B.goto(`${SEITE}/boese.html`, { waitUntil: 'load' });
  const vorher = (await karten(R)).length;
  const r = await sende('seite', '/boese.html');
  pruefe('F1 gesendet', r === 'ok', r);
  await R.waitForTimeout(1800);
  const k = await karten(R);
  const neueKarte = k.at(-1);
  pruefe('F2 die Karte ist da, das Skript steht nur als Text darin',
    k.length === vorher + 1 && /<script>window.__boese=1<\/script>/.test(alsText(neueKarte)), alsText(neueKarte).slice(0, 300));
  await B.close();

  // F-b: direkt an den Eingang (wie es das Skript der Erweiterung tut) — „javascript:" und SVG
  const quittung = (sendung) => R.evaluate((s) => new Promise((ok) => {
    const id = Math.random().toString(36).slice(2);
    const h = (e) => { if (e.data?.typ === 'pixinotes-erweiterung-ok' && e.data.id === id) { removeEventListener('message', h); ok(e.data.angenommen); } };
    addEventListener('message', h);
    window.postMessage({ typ: 'pixinotes-erweiterung', id, sendung: s }, location.origin);
    setTimeout(() => ok('keine Quittung'), 3000);
  }), sendung);
  const vor2 = (await karten(R)).length;
  const q1 = await quittung({ v: 1, art: 'link', titel: 'Klick mich', text: '', adresse: 'javascript:window.__boese=4', direkt: true });
  await R.waitForTimeout(1200);
  const k2 = await karten(R);
  const linkKarte = k2.at(-1);
  pruefe('F3 „javascript:"-Adresse: die Karte entsteht ohne Verweis',
    q1 === true && k2.length === vor2 + 1 && !alsText(linkKarte).includes('javascript') && !/"type":"link"/.test(alsText(linkKarte)), `${q1} ${alsText(linkKarte)}`);
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__boese=5"/>').toString('base64')}`;
  const q2 = await quittung({ v: 1, art: 'bild', titel: '', text: '', adresse: '', bild: { daten: svg, name: 'x' }, direkt: true });
  await R.waitForTimeout(1200);
  pruefe('F4 SVG-Bild wird abgewiesen (keine Karte)', q2 === false && (await karten(R)).length === vor2 + 1, String(q2));
  const q3 = await quittung({ v: 2, art: 'auswahl', titel: 'x', text: 'y' });
  pruefe('F5 unbekannte Fassung wird abgewiesen', q3 === false, String(q3));

  // F-c: Nachricht aus einem eingebetteten Rahmen gleicher Herkunft und aus fremder Herkunft
  const vor3 = (await karten(R)).length;
  await R.evaluate(([seite]) => {
    const a = document.createElement('iframe');
    a.srcdoc = `<script>parent.postMessage({ typ: 'pixinotes-erweiterung', id: 'y', sendung: { v: 1, art: 'auswahl', titel: 'Rahmen', text: 'aus dem Rahmen', direkt: true } }, '*')<\/script>`;
    document.body.append(a);
    const b = document.createElement('iframe'); b.src = `${seite}/rahmen.html`; document.body.append(b);
  }, [SEITE]);
  await R.waitForTimeout(2000);
  pruefe('F6 Rahmen und fremde Herkunft legen nichts ab, kein Dialog',
    (await karten(R)).length === vor3 && await R.locator('.geteilt-modal').count() === 0);
  const boese = await R.evaluate(() => window.__boese);
  pruefe('F7 kein eingeschleustes Skript ist gelaufen', boese === undefined, String(boese));
}

// ══ G: Adress-Fragment ══════════════════════════════════════════════════
console.log('\n════ G: Fragment ════');
{
  const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  const daten = `data:image/png;base64,${BILD.toString('base64')}`;
  // In einem frischen Tab — so, wie ein Link ankommt (der alte Tab trägt noch die Rahmen aus F)
  const L = await ctx.newPage();
  await L.goto(`${APP}#pixinotes-senden=${b64({ v: 1, art: 'seite', titel: 'Über das Fragment', text: 'Grüße', adresse: 'https://example.org/', direkt: true, bild: { daten, name: 'b' } })}`, { waitUntil: 'load' });
  await L.waitForSelector('.geteilt-modal', { timeout: 8000 }).catch(() => {});
  pruefe('G1 der Dialog fragt (auch wenn „direkt" im Link steht)', await L.locator('.geteilt-modal').count() === 1);
  pruefe('G2 das Fragment ist aus der Adresse verschwunden', !(await L.evaluate(() => location.hash.includes('pixinotes-senden'))));
  pruefe('G3 kein Bild über das Fragment', await L.locator('.geteilt-vorschau img').count() === 0);
  const t = await L.locator('.geteilt-text').first().textContent().catch(() => '');
  pruefe('G4 der Text ist da (Umlaute heil)', /Über das Fragment/.test(t) && /Grüße/.test(t), t);
  await L.locator('.geteilt-verwerfen').click().catch(() => {});
  await L.close();
}

// ══ H: Adresse ohne Berechtigung ════════════════════════════════════════
console.log('\n════ H: ohne Berechtigung ════');
{
  const OHNE = `http://pixinotes.test:${PORT}/`;   // Name zeigt auf 127.0.0.1, die Erweiterung hat dafür keine Berechtigung
  await einstellen({ adresse: OHNE, direkt: true });
  const Q2 = await ctx.newPage();
  await Q2.goto(`${SEITE}/artikel.html`, { waitUntil: 'load' });
  const neu = ctx.waitForEvent('page', { timeout: 10000 });
  const r = await sende('seite', '/artikel.html');
  const N = await neu.catch(() => null);
  pruefe('H1 Text: neuer Tab über das Fragment', r === 'ok' && !!N, `${r} ${N?.url()}`);
  if (N) {
    await N.waitForSelector('.geteilt-modal', { timeout: 15000 }).catch(() => {});
    pruefe('H2 dort fragt der Dialog', await N.locator('.geteilt-modal').count() === 1);
    await N.close();
  }
  const seitenVorher = ctx.pages().length;
  const ergBild = await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await globalThis.pixinotesSenden.bild(tab, `${url.replace('*', '')}bild.png`);
    return chrome.action.getBadgeText({});
  }, `${SEITE}/*`);
  pruefe('H3 ein Bild ohne Berechtigung wird nicht gesendet, der Knopf zeigt „!"', ergBild === '!' && ctx.pages().length === seitenVorher, `${ergBild} ${ctx.pages().length}`);
  await einstellen({ adresse: APP, direkt: false });
}

// ══ I: Paket und Berechtigungen ═════════════════════════════════════════
console.log('\n════ I: Paket ════');
{
  const zip = path.join(__repo, 'release', 'pixinotes-erweiterung.zip');
  execFileSync(process.execPath, [path.join(__repo, 'werkzeug', 'erweiterung-packen.mjs')], { stdio: 'pipe' });
  const inhalt = readFileSync(zip);
  pruefe('I1 `build:erweiterung` legt ein ZIP an', inhalt.readUInt32LE(0) === 0x04034b50);
  const namen = [];
  for (let i = 0; i < inhalt.length - 4; i += 1) {
    if (inhalt.readUInt32LE(i) === 0x02014b50) namen.push(inhalt.toString('utf8', i + 46, i + 46 + inhalt.readUInt16LE(i + 28)));
  }
  pruefe('I2 mit Manifest, Hintergrund, Optionen und beiden Sprachen',
    ['manifest.json', 'hintergrund.js', 'optionen.html', '_locales/de/messages.json', '_locales/en/messages.json'].every((n) => namen.includes(n)), JSON.stringify(namen));
  const m = JSON.parse(readFileSync(path.join(ERW, 'manifest.json'), 'utf8'));
  pruefe('I3 Manifest V3', m.manifest_version === 3);
  pruefe('I4 Berechtigungen schmal (kein „tabs", kein <all_urls>, keine Webanfragen)',
    !m.permissions.some((p) => ['tabs', '<all_urls>', 'webRequest', 'history', 'cookies'].includes(p))
    && !m.host_permissions.includes('<all_urls>'), JSON.stringify(m.permissions));
  const en = await sw.evaluate(() => chrome.i18n.getMessage('menueSeite'));
  pruefe('I5 Menütexte kommen aus _locales', /PixiNotes/.test(en), en);
  const gitignore = readFileSync(path.join(__repo, '.gitignore'), 'utf8');
  pruefe('I6 das ZIP steht in .gitignore', gitignore.includes('release/pixinotes-erweiterung.zip'));
}

pruefe('keine Seitenfehler', fehlerSeiten.length === 0, JSON.stringify(fehlerSeiten.slice(0, 3)));
await ctx.close();
rmSync(profil, { recursive: true, force: true });
app.close(); quelle.close();
console.log(`\nm458-erweiterung: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
