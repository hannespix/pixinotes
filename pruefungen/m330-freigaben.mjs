/**
 * M330 — Geteilte Boards zwischen Konten und schnellerer Live-Abgleich.
 * Supabase (Auth, PostgREST auf konto_dateien und board_freigaben, RPCs,
 * Realtime mit mehreren Filtern) ist im Node-Prozess nachgebaut.
 *
 *   A  Anna gibt „Planung" über das Board-Menü für bernd@… frei → Zeile wartet.
 *   B  Bernd meldet sich an: die Einladung wird angenommen, „Planung" erscheint
 *      unter „Geteilt mit mir › anna@…" mit Annas Karten, Abzeichen 👥.
 *   C  Bernd legt eine Karte an → sie landet in ANNAS Zeile (freigabe_schreiben,
 *      Stempel + savedAt in Annas Umgebung) → Anna sieht sie live.
 *   D  Anna legt eine Karte an → Bernd sieht sie live (Realtime auf Annas Zeilen).
 *   E  Tipp-Pause: mit Live-Verbindung steht die Karte binnen ~2 s nach dem letzten
 *      Tastendruck im Konto (statt 2,5 s + Schreibzeit).
 *   F  Anna entfernt die Freigabe → Bernds nächste Änderung: „keine Freigabe",
 *      das Board bleibt als eigene Kopie (ohne Besitzer-Kennung).
 *   G  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m330-freigaben.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4551;
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

// ---------- Nachgebautes Supabase (zwei Konten) ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const sb = {
  nutzer: new Map(), tokens: new Map(), refresh: new Map(),
  zeilen: new Map(),      // `${uid}/${name}` → Zeile
  freigaben: [],          // { id, besitzer, board_id, gast_email, gast_id, rolle, created_at }
  sockets: [], objekte: new Map(), n: 0,
  aufrufe: { freigabeSchreiben: 0, vorbedingung: 0, keineFreigabe: 0, stapel: 0 },
};
const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (u, bis) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: u.id, email: u.email, exp: Math.floor(bis / 1000) }))}.sig`;
const sitzungFuer = (u, lebensdauerS = 3600) => {
  const bis = Date.now() + lebensdauerS * 1000;
  const t = jwt(u, bis), r = `rt-${++sb.n}`;
  sb.tokens.set(t, { uid: u.id, bis }); sb.refresh.set(r, u.id);
  return { access_token: t, refresh_token: r, expires_in: lebensdauerS, token_type: 'bearer', user: { id: u.id, email: u.email } };
};
const uidAus = (req) => {
  const t = /^Bearer (.+)$/.exec(req.headers()['authorization'] ?? '')?.[1];
  const e = t && sb.tokens.get(t);
  return e && e.bis >= Date.now() ? e.uid : null;
};
const nutzerVon = (uid) => [...sb.nutzer.values()].find((x) => x.id === uid);
const zeilenVon = (uid) => [...sb.zeilen.values()].filter((z) => z.user_id === uid);
const zeile = (uid, name) => sb.zeilen.get(`${uid}/${name}`);
const zeileText = (uid, name) => zeile(uid, name)?.inhalt ?? '';
const nutzerId = (email) => sb.nutzer.get(email)?.id;
const freigabeFuer = (besitzer, boardId, gastId) => sb.freigaben.find((f) => f.besitzer === besitzer && f.board_id === boardId && f.gast_id === gastId);
const istGeteiltMit = (besitzer, name, gastId) => { const m = /^board-(.+)\.json$/.exec(name); return !!m && !!freigabeFuer(besitzer, m[1], gastId); };
/** Realtime: an alle Kanäle, deren Filter die Zeile sehen dürfen (RLS nachgestellt) */
const melden = (uid, name, type, tabelle = 'konto_dateien', zeileRoh = null) => {
  for (const s of sb.sockets) {
    if (!s.uid) continue;
    const passt = (s.filter ?? []).some((f) => {
      if (f.table !== tabelle) return false;
      if (tabelle === 'konto_dateien') {
        if (f.filter !== `user_id=eq.${uid}`) return false;
        return s.uid === uid || istGeteiltMit(uid, name, s.uid);
      }
      const [, feld, wert] = /^(\w+)=eq\.(.+)$/.exec(f.filter ?? '') ?? [];
      return !!zeileRoh && zeileRoh[feld] === wert;
    });
    if (!passt) continue;
    const record = tabelle === 'konto_dateien' ? { name, user_id: uid } : zeileRoh;
    s.ws.send(JSON.stringify({ topic: 'realtime:konto', event: 'postgres_changes', payload: { ids: [1], data: { type, schema: 'public', table: tabelle, record, old_record: record } }, ref: null }));
  }
};
const schreib = (uid, name, inhalt, mime, groesse) => {
  const z = zeile(uid, name);
  const neu = z ? Object.assign(z, { inhalt, mime, groesse, version: z.version + 1, updated_at: new Date().toISOString() })
    : { user_id: uid, name, inhalt, mime, groesse, version: 1, updated_at: new Date().toISOString() };
  sb.zeilen.set(`${uid}/${name}`, neu);
  melden(uid, name, z ? 'UPDATE' : 'INSERT');
  return neu;
};
async function dienste(ctx) {
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method();
    const pfad = url.pathname;
    const body = () => { try { return JSON.parse(req.postData() ?? '{}'); } catch { return {}; } };
    const eq = (k) => /^eq\.(.+)$/.exec(url.searchParams.get(k) ?? '')?.[1];
    if ((req.headers()['apikey'] ?? '') !== SB_KEY) return json(route, 401, { message: 'No API key found in request' });
    // ---- Auth ----
    if (pfad === '/auth/v1/signup' && m === 'POST') {
      const { email, password } = body();
      const u = { id: sb.nutzer.get(email)?.id ?? `uid-${++sb.n}`, email, passwort: password };
      sb.nutzer.set(email, u);
      return json(route, 200, sitzungFuer(u));
    }
    if (pfad === '/auth/v1/token' && m === 'POST') {
      const art = url.searchParams.get('grant_type');
      if (art === 'password') {
        const { email, password } = body();
        const u = sb.nutzer.get(email);
        if (!u || u.passwort !== password) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return json(route, 200, sitzungFuer(u));
      }
      if (art === 'refresh_token') {
        const uid = sb.refresh.get(body().refresh_token);
        if (!uid) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        return json(route, 200, sitzungFuer(nutzerVon(uid)));
      }
    }
    if (pfad === '/auth/v1/user' && m === 'GET') { const uid = uidAus(req); return uid ? json(route, 200, { id: uid, email: nutzerVon(uid)?.email }) : json(route, 401, {}); }
    if (pfad === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    const uid = uidAus(req);
    if (!uid) return json(route, 401, { message: 'JWT expired' });
    const ich = nutzerVon(uid);
    // ---- RPCs ----
    if (pfad === '/rest/v1/rpc/konto_schreiben' && m === 'POST') {
      sb.aufrufe.stapel += 1;
      const b = body();
      const alt = zeile(uid, 'umgebung.json');
      const wenn = b.p_wenn_version;
      if ((wenn === null && alt) || (wenn !== null && String(alt?.version ?? '') !== String(wenn))) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
      for (const d of b.p_dateien ?? []) schreib(uid, d.name, d.inhalt ?? '', d.mime ?? 'application/json', d.groesse ?? 0);
      const u = schreib(uid, 'umgebung.json', b.p_umgebung, 'application/json', String(b.p_umgebung ?? '').length);
      return json(route, 200, u.version);
    }
    if (pfad === '/rest/v1/rpc/freigaben_annehmen' && m === 'POST') {
      let n = 0;
      for (const f of sb.freigaben) {
        if (!f.gast_id && f.gast_email.toLowerCase() === (ich?.email ?? '').toLowerCase()) { f.gast_id = uid; n += 1; melden(uid, '', 'UPDATE', 'board_freigaben', f); }
      }
      return json(route, 200, n);
    }
    if (pfad === '/rest/v1/rpc/freigaben_fuer_mich' && m === 'POST') {
      return json(route, 200, sb.freigaben.filter((f) => f.gast_id === uid).map((f) => ({ besitzer: f.besitzer, besitzer_email: nutzerVon(f.besitzer)?.email, board_id: f.board_id, rolle: f.rolle })));
    }
    if (pfad === '/rest/v1/rpc/freigabe_schreiben' && m === 'POST') {
      sb.aufrufe.freigabeSchreiben += 1;
      const b = body();
      const f = freigabeFuer(b.p_besitzer, b.p_board_id, uid);
      if (!f || f.rolle !== 'bearbeiten') { sb.aufrufe.keineFreigabe += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
      const name = `board-${b.p_board_id}.json`;
      const alt = zeile(b.p_besitzer, name);
      if (b.p_wenn_version !== null && String(alt?.version ?? '') !== String(b.p_wenn_version)) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
      const neu = schreib(b.p_besitzer, name, b.p_inhalt, 'application/json', String(b.p_inhalt).length);
      const um = zeile(b.p_besitzer, 'umgebung.json');
      if (um) { const u = JSON.parse(um.inhalt); u.boards[b.p_board_id] = b.p_stempel; u.savedAt = new Date().toISOString(); schreib(b.p_besitzer, 'umgebung.json', JSON.stringify(u), 'application/json', 0); }
      return json(route, 200, neu.version);
    }
    // ---- board_freigaben ----
    if (pfad === '/rest/v1/board_freigaben') {
      const sichtbar = sb.freigaben.filter((f) => f.besitzer === uid || f.gast_id === uid || f.gast_email.toLowerCase() === (ich?.email ?? '').toLowerCase());
      const filt = (liste) => liste.filter((f) => (!eq('board_id') || f.board_id === eq('board_id')) && (!eq('besitzer') || f.besitzer === eq('besitzer')) && (!eq('gast_id') || f.gast_id === eq('gast_id')) && (!eq('id') || f.id === eq('id')));
      if (m === 'GET') return json(route, 200, filt(sichtbar));
      if (m === 'POST') {
        const b = body();
        let f = sb.freigaben.find((x) => x.besitzer === uid && x.board_id === b.board_id && x.gast_email === b.gast_email);
        if (!f) { f = { id: `fg-${++sb.n}`, besitzer: uid, board_id: b.board_id, gast_email: b.gast_email, gast_id: null, rolle: b.rolle ?? 'bearbeiten', created_at: new Date().toISOString() }; sb.freigaben.push(f); melden(uid, '', 'INSERT', 'board_freigaben', f); }
        return json(route, 201, [f]);
      }
      if (m === 'DELETE') {
        const weg = filt(sb.freigaben.filter((f) => f.besitzer === uid || f.gast_id === uid));
        sb.freigaben = sb.freigaben.filter((f) => !weg.includes(f));
        for (const f of weg) melden(uid, '', 'DELETE', 'board_freigaben', f);
        return route.fulfill({ status: 204, body: '' });
      }
    }
    // ---- konto_dateien ----
    if (pfad === '/rest/v1/konto_dateien') {
      const fName = eq('name');
      const fUser = eq('user_id');
      const select = (url.searchParams.get('select') ?? '*').split(',');
      const projiziere = (z) => (select.includes('*') ? z : Object.fromEntries(select.map((k) => [k, z[k]])));
      let treffer;
      if (fUser && fUser !== uid) treffer = zeilenVon(fUser).filter((z) => istGeteiltMit(fUser, z.name, uid));
      else treffer = zeilenVon(uid);
      if (fName !== undefined) treffer = treffer.filter((z) => z.name === fName);
      if (m === 'GET') return json(route, 200, treffer.map(projiziere));
      if (m === 'DELETE') { for (const z of treffer) if (z.user_id === uid) sb.zeilen.delete(`${uid}/${z.name}`); return route.fulfill({ status: 204, body: '' }); }
      return json(route, 405, { message: 'nur GET/DELETE im Mock' });
    }
    return json(route, 404, { message: `unbekannt: ${m} ${pfad}` });
  });
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const eintrag = { ws, uid: null, filter: [] };
    sb.sockets.push(eintrag);
    ws.onMessage((roh) => {
      const j = JSON.parse(String(roh));
      if (j.event === 'phx_join') {
        const e = sb.tokens.get(j.payload?.access_token);
        eintrag.uid = e?.uid ?? null;
        eintrag.filter = j.payload?.config?.postgres_changes ?? [];
        ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: eintrag.filter.map((_, i) => ({ id: i + 1 })) } }, ref: j.ref }));
      } else if (j.event === 'heartbeat') {
        ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: j.ref }));
      } else if (j.event === 'access_token') {
        const e = sb.tokens.get(j.payload?.access_token); if (e) eintrag.uid = e.uid;
      }
    });
    ws.onClose(() => { sb.sockets = sb.sockets.filter((s) => s !== eintrag); });
  });
}

// ---------- Geräte ----------
const note = (id, text, x = 60, y = 60) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const standA = {
  boards: [board('bx', 'Planung', [note('x1', 'Planung Notiz')]), board('by', 'Ideen', [note('y1', 'Ideen Notiz')])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx', 'by'] }] }],
  activeId: 'bx', view: 'board',
};
const standB = {
  boards: [board('bz', 'Nur hier', [note('z1', 'Z Notiz')])],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }],
  activeId: 'bz', view: 'board',
};
async function geraet(name, stand) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await dienste(ctx);
  await ctx.addInitScript(({ st, konfig }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, konfig: { url: SB_URL, key: SB_KEY } });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log(`    PAGEERROR[${name}]:`, e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, name };
}
const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const texte = (P) => zustand(P).then((s) => JSON.stringify(s.boards));
const boardVon = (P, id) => zustand(P).then((s) => s.boards.find((b) => b.id === id));
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const knoten = (P) => P.locator('.react-flow__node').count();
async function warteBis(P, fn, ms = 16000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(200); }
  return fn();
}
async function kontoPanel(P) {
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
  await P.locator('.seg-weg button', { hasText: 'Konto' }).click(); await P.waitForTimeout(300);
}
async function schliessen(P) { await P.keyboard.press('Escape'); await P.waitForTimeout(500); }
async function anmelden(P, email, pass, neu) {
  await kontoPanel(P);
  await P.locator('[data-taste="konto-email"]').fill(email);
  if ((await P.locator('[data-taste="konto-mail"] details[open]').count()) === 0) { await P.locator('[data-taste="konto-mail"] details summary').click(); await P.waitForTimeout(150); }
  await P.locator('[data-taste="konto-pass"]').fill(pass);
  await P.locator(`[data-taste="${neu ? 'konto-neu' : 'konto-passwort'}"]`).click();
  await warteBis(P, async () => (await P.locator('[data-taste="konto-stand"]').count()) > 0, 10000);
  await P.waitForTimeout(400);
  await schliessen(P);
}
/** Ein zugeklapptes Projekt in der Spalte öffnen */
async function aufklappen(P, projekt) {
  const kopf = P.locator('.tabs.spalte .side-proj:not(.auf) .side-proj-head', { hasText: projekt }).first();
  if (await kopf.count()) { await kopf.click(); await P.waitForTimeout(400); }
}
async function boardWechseln(P, name, projekt) {
  if (projekt) await aufklappen(P, projekt);
  await P.locator('.tabs.spalte .side-board', { hasText: name }).first().click(); await P.waitForTimeout(700);
}
async function notiz(P, text, x = 900, y = 500) {
  const vorher = await P.locator('.react-flow__node').count();
  await P.mouse.dblclick(x, y);
  await P.waitForTimeout(700);
  const aktiv = await P.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true');
  if (!aktiv) { await P.locator('.react-flow__node').last().locator('[contenteditable="true"]').first().click(); await P.waitForTimeout(300); }
  await P.keyboard.type(text, { delay: 20 });
  await P.waitForTimeout(300);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(200);
  return (await P.locator('.react-flow__node').count()) === vorher + 1;
}

// ══ A: Anna gibt frei ═══════════════════════════════════════════════
console.log('\n════ A: Anna gibt „Planung" für Bernd frei ════');
const A = await geraet('A', standA);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
// Board-Menü von „Planung" in der Spalte
const zeileA = A.P.locator('.tabs.spalte .side-board', { hasText: 'Planung' }).first();
await zeileA.hover(); await A.P.waitForTimeout(200);
await zeileA.locator('.ebenen-menu-knopf').click(); await A.P.waitForTimeout(300);
pruefe('A1 das Board-Menü bietet „Für ein Konto freigeben …" (nur mit PixiNotes-Konto)', (await A.P.locator('[data-taste="board-freigeben"]').count()) === 1);
await A.P.locator('[data-taste="board-freigeben"]').click(); await A.P.waitForTimeout(500);
pruefe('A2 der Freigabe-Dialog öffnet sich, noch niemand', (await A.P.locator('.freigabe-dialog').count()) === 1 && /Noch für niemanden/.test(await A.P.locator('.freigabe-dialog').textContent()));
await A.P.locator('[data-taste="freigabe-email"]').fill('Bernd@Example.de');
await A.P.locator('[data-taste="freigabe-einladen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="freigabe-liste"] li').count()) === 1, 6000);
const fg = sb.freigaben[0];
pruefe('A3 Freigabe-Zeile angelegt: Besitzer Anna, Board bx, E-Mail klein geschrieben, wartet', !!fg && fg.besitzer === uidA && fg.board_id === 'bx' && fg.gast_email === 'bernd@example.de' && fg.gast_id === null, JSON.stringify(fg));
pruefe('A4 die Liste zeigt „wartet auf Anmeldung"', /wartet auf Anmeldung/.test(await A.P.locator('[data-taste="freigabe-liste"]').textContent()));
await A.P.screenshot({ path: path.join(SD, 'm330-freigabe.png') });
await schliessen(A.P);

// ══ B: Bernd nimmt an ═══════════════════════════════════════════════
console.log('\n════ B: Bernd meldet sich an und sieht das geteilte Board ════');
const B = await geraet('B', standB);
await anmelden(B.P, 'bernd@example.de', 'geheim456', true);
const uidB = nutzerId('bernd@example.de');
const da = await warteBis(B.P, async () => !!(await boardVon(B.P, 'bx')), 15000);
const bxB = await boardVon(B.P, 'bx');
pruefe('B1 die Einladung ist angenommen (gast_id = Bernd)', sb.freigaben[0].gast_id === uidB);
pruefe('B2 „Planung" liegt bei Bernd — mit Annas Karte und Besitzer-Kennung', da && bxB?.name === 'Planung' && JSON.stringify(bxB.nodes).includes('Planung Notiz') && bxB.geteiltVon === uidA && bxB.geteiltVonName === 'anna@example.de', JSON.stringify(bxB && { name: bxB.name, geteiltVon: bxB.geteiltVon, geteiltVonName: bxB.geteiltVonName }));
const spB = await zustand(B.P).then((s) => s.spaces);
const geteilt = spB.find((sp) => sp.id === 'geteilt');
pruefe('B3 … unter „Geteilt mit mir › anna@example.de"; Bernds eigenes Board bleibt', geteilt?.name === 'Geteilt mit mir' && geteilt.projects[0]?.name === 'anna@example.de' && geteilt.projects[0].boardIds.includes('bx') && !!(await boardVon(B.P, 'bz')), JSON.stringify(spB));
pruefe('B4 Bernds Umgebung listet „Planung" NICHT als eigenes Board', !JSON.parse(zeileText(uidB, 'umgebung.json')).boards.bx && !zeile(uidB, 'board-bx.json'));
await aufklappen(B.P, 'anna@example.de');
pruefe('B5 Abzeichen 👥 in der Spalte (Projekt „anna@example.de" aufgeklappt)', (await B.P.locator('.side-board', { hasText: 'Planung' }).locator('.side-board-geteilt').count()) === 1);
pruefe('B6 Bernds Realtime lauscht auch auf Annas Zeilen', sb.sockets.some((s) => s.uid === uidB && s.filter.some((f) => f.filter === `user_id=eq.${uidA}`)), JSON.stringify(sb.sockets.map((s) => [s.uid, s.filter.map((f) => f.filter)])));

// ══ C: Bernd schreibt, Anna sieht ═══════════════════════════════════
console.log('\n════ C: Bernd legt eine Karte an → Annas Zeile, Anna sieht sie live ════');
await boardWechseln(B.P, 'Planung', 'anna@example.de');
{
  const angelegt = await notiz(B.P, 'Gruß von Bernd', 1000, 500);
  pruefe('C1 Bernd legt auf „Planung" eine Karte an', angelegt, `Karten ${await knoten(B.P)}`);
  const t0 = Date.now();
  const inAnnasZeile = await warteBis(B.P, () => zeileText(uidA, 'board-bx.json').includes('Gruß von Bernd'), 10000);
  pruefe('C2 die Karte steht in ANNAS board-bx.json (freigabe_schreiben), nicht bei Bernd', inAnnasZeile && !zeile(uidB, 'board-bx.json') && sb.aufrufe.freigabeSchreiben >= 1, JSON.stringify(sb.aufrufe));
  const uA = JSON.parse(zeileText(uidA, 'umgebung.json'));
  pruefe('C3 Annas Umgebung trägt den neuen Stempel und ein neues savedAt', typeof uA.boards.bx === 'string' && uA.boards.bx.length > 0 && Date.now() - new Date(uA.savedAt).getTime() < 15000, JSON.stringify({ st: uA.boards.bx, savedAt: uA.savedAt }));
  const beiAnna = await warteBis(A.P, async () => (await texte(A.P)).includes('Gruß von Bernd'), 12000);
  pruefe(`C4 Anna hat die Karte ohne Klick (${Date.now() - t0} ms nach Bernds Schreiben)`, beiAnna);
  pruefe('C5 … und zeigt sie auf dem offenen Board', (await knoten(A.P)) === 2, `Karten ${await knoten(A.P)}`);
  pruefe('C6 Bernds eigene Umgebung wurde dafür nicht angefasst (kein eigener Schreibvorgang nötig)', !JSON.parse(zeileText(uidB, 'umgebung.json')).boards.bx);
}

// ══ D: Anna schreibt, Bernd sieht ═══════════════════════════════════
console.log('\n════ D: Anna legt eine Karte an → Bernd sieht sie live ════');
{
  const angelegt = await notiz(A.P, 'Antwort von Anna', 1000, 700);
  pruefe('D1 Anna legt eine Karte an', angelegt);
  const t0 = Date.now();
  const beiBernd = await warteBis(B.P, async () => (await texte(B.P)).includes('Antwort von Anna'), 12000);
  pruefe(`D2 Bernd hat Annas Karte live (${Date.now() - t0} ms)`, beiBernd);
  const bx = await boardVon(B.P, 'bx');
  pruefe('D3 das Board bleibt bei Bernd als geteiltes gekennzeichnet', bx?.geteiltVon === uidA);
}

// ══ E: Tipp-Pause ═══════════════════════════════════════════════════
console.log('\n════ E: Mit Live-Verbindung schreibt die App nach einer Sekunde ════');
{
  const vorher = zeile(uidA, 'umgebung.json').version;
  await A.P.mouse.dblclick(600, 700); await A.P.waitForTimeout(600);
  const aktiv = await A.P.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true');
  if (!aktiv) { await A.P.locator('.react-flow__node').last().locator('[contenteditable="true"]').first().click(); await A.P.waitForTimeout(200); }
  await A.P.keyboard.type('Schnell', { delay: 15 });
  const t0 = Date.now();
  await A.P.keyboard.press('Escape');
  const geschrieben = await warteBis(A.P, () => zeile(uidA, 'umgebung.json').version > vorher && zeileText(uidA, 'board-bx.json').includes('Schnell'), 6000);
  const dauer = Date.now() - t0;
  pruefe(`E1 der Stand liegt ${dauer} ms nach dem letzten Tastendruck im Konto (< 2200 ms)`, geschrieben && dauer < 2200, `${dauer} ms`);
}

// ══ F: Freigabe entfernt ════════════════════════════════════════════
console.log('\n════ F: Anna entfernt die Freigabe → Bernd behält eine eigene Kopie ════');
{
  const zeileA2 = A.P.locator('.tabs.spalte .side-board', { hasText: 'Planung' }).first();
  await zeileA2.hover(); await A.P.waitForTimeout(200);
  await zeileA2.locator('.ebenen-menu-knopf').click(); await A.P.waitForTimeout(300);
  await A.P.locator('[data-taste="board-freigeben"]').click(); await A.P.waitForTimeout(500);
  await warteBis(A.P, async () => (await A.P.locator('[data-taste="freigabe-liste"] li').count()) === 1, 6000);
  pruefe('F1 die Liste zeigt Bernd als „angenommen"', /angenommen/.test(await A.P.locator('[data-taste="freigabe-liste"]').textContent()));
  await A.P.locator('[data-taste="freigabe-liste"] .freigabe-weg').click();
  await warteBis(A.P, () => sb.freigaben.length === 0, 6000);
  pruefe('F2 Freigabe entfernt', sb.freigaben.length === 0);
  await schliessen(A.P);
  // M364: Bernds Gerät erfährt es (live oder beim nächsten Abgleich) → das Board bleibt als eigene Kopie, mit
  // Hinweis — spätestens, wenn er etwas ändert und der Server das Schreiben ablehnt.
  let hinweis = false;
  const kopieFrueh = await warteBis(B.P, async () => { if (/bleibt als eigene Kopie/.test(await toast(B.P))) hinweis = true; const b = await boardVon(B.P, 'bx'); return !!b && !b.geteiltVon; }, 8000);
  await notiz(B.P, 'Nach dem Ende', 600, 300);
  const kopie = await warteBis(B.P, async () => { if (/bleibt als eigene Kopie/.test(await toast(B.P))) hinweis = true; const b = await boardVon(B.P, 'bx'); return !!b && !b.geteiltVon; }, 15000);
  pruefe('F3 Bernds „Planung" verliert die Besitzer-Kennung (eigene Kopie), Hinweis erscheint', kopie && (hinweis || sb.aufrufe.keineFreigabe >= 1), `früh ${kopieFrueh}, keineFreigabe ${sb.aufrufe.keineFreigabe}, hinweis ${hinweis}`);
  const eigeneZeile = await warteBis(B.P, () => !!zeile(uidB, 'board-bx.json') && zeileText(uidB, 'board-bx.json').includes('Nach dem Ende'), 15000);
  pruefe('F4 die Kopie liegt jetzt in Bernds eigenem Konto; Annas Zeile bleibt ohne „Nach dem Ende"', eigeneZeile && !zeileText(uidA, 'board-bx.json').includes('Nach dem Ende'));
}

// ══ G: Texte ════════════════════════════════════════════════════════
console.log('\n════ G: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G1 „Was ist neu" nennt M330', js.includes('Geteilte Boards und schnellerer Live-Abgleich (M330)'));
  pruefe('G2 der Dialog nennt die Grenze bei Anhängen', js.includes('bei Gästen mit Konto wandern Anhänge noch nicht mit'));
}

await A.ctx.close(); await B.ctx.close();
await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
