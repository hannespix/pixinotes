// M558: Zwei Gäste im selben Board, mit je eigener Timeranzeige.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PORT = 5558;
const HOST = '127.0.0.1';
const APP_URL = new URL(process.env.PN_URL ?? `http://${HOST}:${PORT}/`);
const DIST = path.resolve(process.env.PN_DIST ?? fileURLToPath(new URL('../dist', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = process.env.PN_URL ? null : http.createServer(async (req, res) => {
  const datei = path.resolve(DIST, `.${new URL(req.url, 'http://localhost').pathname}`);
  const ziel = datei === DIST ? path.join(DIST, 'index.html') : datei;
  if (!ziel.startsWith(`${DIST}${path.sep}`)) { res.writeHead(404).end(); return; }
  try {
    const inhalt = await readFile(ziel);
    res.writeHead(200, { 'Content-Type': mime[path.extname(ziel)] ?? 'application/octet-stream' }).end(inhalt);
  } catch { res.writeHead(404).end(); }
});
if (server) await new Promise((fertig) => server.listen(PORT, HOST, fertig));

const SB_URL = 'https://m558-supabase.test';
const TOKEN = 'praesentation-m558';
APP_URL.hash = `e=${TOKEN}`;
const kanal = 'm558';
const board = {
  id: 'b558', name: 'Präsentationsprobe', edges: [], drawings: [], comments: [],
  nodes: [{ id: 'notiz', type: 'note', width: 280, position: { x: 140, y: 160 },
    data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Die erste Folie' }] } }],
};
const teilnehmer = new Set();

async function teamDienst(ctx) {
  await ctx.route(`${SB_URL}/rest/v1/rpc/*`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (route.request().postDataJSON()?.p_token !== TOKEN) return route.fulfill({ status: 200, json: null });
    const stand = { version: 1, rolle: 'bearbeiten', optionen: {} };
    if (name === 'gast_lesen') return route.fulfill({ json: { ...stand, board_id: board.id, kanal,
      besitzer: 'leiter', inhalt: JSON.stringify(board), dateien: [] } });
    if (name === 'gast_stand') return route.fulfill({ json: stand });
    return route.fulfill({ status: 404, json: { message: name } });
  });
  await ctx.routeWebSocket(`${SB_URL.replace('https', 'wss')}/realtime/v1/websocket?*`, (ws) => {
    const t = { ws, name: '', meta: null, topic: '' };
    const senden = (empfaenger, event, payload, ref = null) => empfaenger.ws.send(JSON.stringify({ topic: t.topic, event, payload, ref }));
    ws.onMessage((roh) => {
      const { topic, event, payload, ref } = JSON.parse(String(roh));
      if (event === 'phx_join') {
        t.topic = topic;
        t.name = payload.config.presence.key;
        teilnehmer.add(t);
        senden(t, 'phx_reply', { status: 'ok', response: {} }, ref);
      } else if (topic === t.topic && event === 'presence') {
        t.meta = payload.payload;
        const state = Object.fromEntries([...teilnehmer].filter((p) => p.topic === topic && p.meta)
          .map((p) => [p.name, { metas: [p.meta] }]));
        for (const p of teilnehmer) if (p.topic === topic) senden(p, 'presence_state', state);
      } else if (topic === t.topic && event === 'broadcast') {
        for (const p of teilnehmer) if (p !== t && p.topic === topic) senden(p, 'broadcast', payload);
      }
    });
    ws.onClose(() => { teilnehmer.delete(t); });
  });
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
const taste = (P, name) => P.locator(`[data-taste="${name}"]`);
const chip = (P) => taste(P, 'timer-chip');
const griff = (P) => taste(P, 'timer-griff');
const klapp = (P) => taste(P, 'timer-klapp');
const zeit = (P) => taste(P, 'timer-zeit');
const offen = (P) => klapp(P).getAttribute('aria-expanded', { timeout: 3000 });
const warteKlapp = (P, wert) => P.locator(`[data-taste="timer-klapp"][aria-expanded="${wert}"]`).waitFor();
const rest = async (P) => (await zeit(P).textContent()).split(':').reduce((n, s) => 60 * n + Number(s), 0);
const mitte = ({ x, y, width, height }) => ({ x: x + width / 2, y: y + height / 2 });

async function seite(name, mobil = false) {
  const ctx = await browser.newContext({ viewport: mobil ? { width: 390, height: 844 } : { width: 1280, height: 820 },
    isMobile: mobil, hasTouch: mobil, locale: 'de-DE', serviceWorkers: 'block' });
  // Auch gegen PN_URL lädt nur die App selbst vom Netz. Der Team-Dienst läuft im Testprozess.
  await ctx.route('**/*', (route) => new URL(route.request().url()).origin === APP_URL.origin ? route.continue() : route.abort());
  await ctx.routeWebSocket((url) => url.origin !== SB_URL.replace('https', 'wss'), (ws) => ws.close());
  await teamDienst(ctx);
  await ctx.addInitScript(({ url }) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-supabase', JSON.stringify({ url, key: 'anon-test-key' }));
  }, { url: SB_URL });
  const P = await ctx.newPage();
  P.setDefaultTimeout(8000);
  await P.goto(APP_URL.href);
  await taste(P, 'gast-name').fill(name);
  await taste(P, 'gast-name-ok').click();
  return P;
}

async function starten(P, minuten) {
  await taste(P, 'live-auf').click();
  await P.locator(`[data-taste="timer-min"][data-min="${minuten}"]`).click();
}

async function ziehen(P, dx, dy) {
  const ziel = mitte(await griff(P).boundingBox());
  await P.mouse.move(ziel.x, ziel.y);
  await P.mouse.down();
  await P.mouse.move(ziel.x + dx, ziel.y + dy, { steps: 8 });
  await P.mouse.up();
}

async function touchZiehen(P, dx, dy) {
  const cdp = await P.context().newCDPSession(P);
  const ziel = mitte(await griff(P).boundingBox());
  const schicken = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await schicken('touchStart', [ziel]);
  for (let i = 1; i <= 5; i++) await schicken('touchMove', [{ x: ziel.x + dx * i / 5, y: ziel.y + dy * i / 5 }]);
  await schicken('touchEnd', []);
  await cdp.detach();
}

async function passt(P) {
  await P.waitForFunction(() => {
    const e = document.querySelector('[data-taste="timer-chip"]');
    if (!e) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  });
}

let checks = 0;
function pruefe(name, erfuellt) {
  assert.ok(erfuellt, name);
  checks++;
  console.log(`  ✓ ${name}`);
}

try {
  const [A, B] = await Promise.all([seite('Ada'), seite('Ben', true)]);
  await A.locator('[data-taste="live-chip"][data-name="Ben"]').waitFor();
  await B.locator('[data-taste="live-chip"][data-name="Ada"]').waitFor();
  await starten(A, 5);
  await Promise.all([chip(A).waitFor(), chip(B).waitFor()]);
  pruefe('Beide sehen denselben frisch gestarteten Lauf', await rest(A) >= 297 && Math.abs(await rest(A) - await rest(B)) <= 2);
  pruefe('Der laufende Timer hat einen Einklappknopf', await klapp(A).count() === 1);
  pruefe('Der Timer startet bei beiden in voller Größe', await offen(A) === 'true' && await offen(B) === 'true');

  const vorher = await chip(A).boundingBox();
  const gastVorher = await chip(B).boundingBox();
  await ziehen(A, 490, 625);
  const gezogen = await chip(A).boundingBox();
  pruefe('Ziehen am Griff verschiebt den Timer auf beiden Achsen', gezogen.x > vorher.x + 300 && gezogen.y > vorher.y + 450);
  await griff(A).press('ArrowLeft');
  const tastenlage = await chip(A).boundingBox();
  pruefe('Die Pfeiltaste bewegt den fokussierten Griff nach links', tastenlage.x < gezogen.x - 5 && Math.abs(tastenlage.y - gezogen.y) < 2);

  const sek = await rest(A);
  await klapp(A).click();
  pruefe('Eingeklappt bleiben Griff und Restzeit sichtbar', await offen(A) === 'false' && await griff(A).isVisible()
    && await zeit(A).isVisible() && (await chip(A).boundingBox()).width < tastenlage.width);
  await A.waitForFunction((alt) => {
    const s = document.querySelector('[data-taste="timer-zeit"]')?.textContent;
    return !!s && s.split(':').reduce((n, z) => n * 60 + Number(z), 0) < alt;
  }, sek);
  const gastJetzt = await chip(B).boundingBox();
  pruefe('Das Einklappen lässt den Timer weiterlaufen und ändert beim Gast nichts', await offen(A) === 'false' && await offen(B) === 'true'
    && Math.abs(await rest(A) - await rest(B)) <= 2 && Math.abs(gastVorher.x - gastJetzt.x) < 3 && Math.abs(gastVorher.y - gastJetzt.y) < 3);

  const kompakteLage = await chip(A).boundingBox();
  await A.mouse.click(50, 450);
  await A.keyboard.press('Alt+p');
  await A.locator('.presenter-slide').waitFor();
  const folienLage = await chip(A).boundingBox();
  pruefe('In der Präsentation bleibt der eingeklappte Timer an der eigenen Stelle', await offen(A) === 'false'
    && await zeit(A).isVisible() && Math.abs(folienLage.x - kompakteLage.x) < 3 && Math.abs(folienLage.y - kompakteLage.y) < 3);
  await klapp(A).press('Enter');
  pruefe('Enter öffnet den Timer in der Präsentation und der Fokus bleibt auf dem Knopf', await offen(A) === 'true'
    && await klapp(A).evaluate((e) => e === document.activeElement));
  await A.keyboard.press('Space');
  pruefe('Die Leertaste klappt den Timer wieder ein und lässt den Fokus auf dem Knopf', await offen(A) === 'false'
    && await klapp(A).evaluate((e) => e === document.activeElement));
  await zeit(A).click();
  pruefe('Ein Klick auf die Restzeit öffnet den Timer auch über der Folie', await offen(A) === 'true' && await taste(A, 'timer-zu').isVisible());
  await klapp(A).click();
  await taste(A, 'vortrag-zu').click();
  pruefe('Beim Verlassen der Präsentation bleibt der Timer eingeklappt', await offen(A) === 'false');

  await taste(A, 'einstellungen').first().click();
  await A.getByRole('group', { name: 'Anzeigegröße' }).getByRole('button', { name: '175 %', exact: true }).click();
  await A.waitForFunction(() => getComputedStyle(document.documentElement).zoom === '1.75');
  await A.keyboard.press('Escape');
  await A.setViewportSize({ width: 570, height: 420 });
  await passt(A);
  await zeit(A).click();
  await passt(A);
  pruefe('Bei 175 % bleibt der Timer nach Verkleinern und Wiederherstellen im Fenster', await offen(A) === 'true');

  await touchZiehen(B, 85, 185);
  const touch = await chip(B).boundingBox();
  pruefe('Auf dem Telefon lässt sich der Timer mit dem Finger verschieben', touch.x > gastJetzt.x + 30 && touch.y > gastJetzt.y + 120);
  await klapp(B).tap();
  await warteKlapp(B, false);
  pruefe('Ein Tipp klappt nur die eigene Anzeige ein', await offen(B) === 'false' && await offen(A) === 'true');
  await zeit(B).tap();
  await warteKlapp(B, true);
  pruefe('Ein Tipp auf die Restzeit öffnet den Timer wieder', await offen(B) === 'true');

  await klapp(A).click();
  const alterLauf = await chip(A).boundingBox();
  await starten(B, 3);
  await A.waitForFunction(() => {
    const klapp = document.querySelector('[data-taste="timer-klapp"]');
    const zeit = document.querySelector('[data-taste="timer-zeit"]')?.textContent;
    return klapp?.getAttribute('aria-expanded') === 'true' && /^(3:00|2:5[6-9])$/.test(zeit ?? '');
  });
  pruefe('Ein neuer gemeinsamer Lauf beginnt wieder mit der vollen Anzeige an der Vorgabestelle',
    await offen(B) === 'true' && (await chip(A).boundingBox()).y < alterLauf.y - 50);
  await taste(B, 'timer-zu').tap();
  await Promise.all([chip(A).waitFor({ state: 'detached' }), chip(B).waitFor({ state: 'detached' })]);
  pruefe('Anhalten über den separaten Knopf beendet den Timer auf beiden Geräten', await chip(A).count() === 0 && await chip(B).count() === 0);
} finally {
  await browser.close();
  server?.close();
}
console.log(`M558: ${checks} bestanden, 0 fehlgeschlagen`);
