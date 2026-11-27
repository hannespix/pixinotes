import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const SB_URL = 'https://m558-supabase.test';
const TOKEN = 'praesentation-m558';
const kanal = 'm558';
const board = {
  id: 'b558', name: 'Präsentationsprobe', edges: [], drawings: [], comments: [],
  nodes: [{ id: 'notiz', type: 'note', width: 280, position: { x: 140, y: 160 },
    data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Die erste Folie' }] } }],
};

async function teamDienst(ctx, appUrl, teilnehmer) {
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/rest/v1/rpc/')) {
      return url.origin === appUrl.origin ? route.continue() : route.abort();
    }
    const name = url.pathname.split('/').at(-1);
    if (route.request().postDataJSON()?.p_token !== TOKEN) return route.fulfill({ status: 200, json: null });
    const stand = { version: 1, rolle: 'bearbeiten', optionen: {} };
    if (name === 'gast_lesen') return route.fulfill({ json: { ...stand, board_id: board.id, kanal,
      besitzer: 'leiter', inhalt: JSON.stringify(board), dateien: [] } });
    if (name === 'gast_stand') return route.fulfill({ json: stand });
    return route.fulfill({ status: 404, json: { message: name } });
  });
  await ctx.routeWebSocket('**/*', (ws) => {
    if (new URL(ws.url()).pathname !== '/realtime/v1/websocket') return ws.close();
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

export const taste = (P, name) => P.locator(`[data-taste="${name}"]`);

export async function mitTimerTeam(port, pruefen) {
  const HOST = '127.0.0.1';
  const appUrl = new URL(process.env.PN_URL ?? `http://${HOST}:${port}/`);
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
  if (server) await new Promise((fertig) => server.listen(port, HOST, fertig));
  appUrl.hash = `e=${TOKEN}`;
  const teilnehmer = new Set();
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });

  async function seite(name, mobil = false) {
    const ctx = await browser.newContext({ viewport: mobil ? { width: 390, height: 844 } : { width: 1280, height: 820 },
      isMobile: mobil, hasTouch: mobil, locale: 'de-DE', serviceWorkers: 'block' });
    // Auch gegen PN_URL lädt nur die App selbst vom Netz. Der Team-Dienst läuft im Testprozess.
    await teamDienst(ctx, appUrl, teilnehmer);
    await ctx.addInitScript(({ url }) => {
      localStorage.setItem('pixinotes-onboarded', '1');
      sessionStorage.setItem('pixinotes-hint-shown', '1');
      localStorage.setItem('pixinotes-supabase', JSON.stringify({ url, key: 'anon-test-key' }));
    }, { url: SB_URL });
    const P = await ctx.newPage();
    P.setDefaultTimeout(8000);
    await P.goto(appUrl.href);
    await taste(P, 'gast-name').fill(name);
    await taste(P, 'gast-name-ok').click();
    return P;
  }
  try {
    const [desktop, telefon] = await Promise.all([seite('Ada'), seite('Ben', true)]);
    await desktop.locator('[data-taste="live-chip"][data-name="Ben"]').waitFor();
    await telefon.locator('[data-taste="live-chip"][data-name="Ada"]').waitFor();
    await pruefen(desktop, telefon);
  } finally {
    await browser.close();
    server?.close();
  }
}
