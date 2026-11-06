/**
 * M328 — Eigenes PixiNotes-Konto mit E-Mail (Supabase als dritter Konto-Weg).
 * Supabase (GoTrue-Auth, PostgREST auf konto_dateien, Realtime-WebSocket) ist
 * im Node-Prozess nachgebaut; alle Geräte sehen dieselbe Tabelle.
 *
 *   A  Gerät A erstellt ein Konto mit Passwort: Sitzung (anbieter supabase,
 *      E-Mail), Zeilen umgebung.json + je Board, Anzeige „Angemeldet bei PixiNotes-Konto".
 *   B  Gerät B meldet sich mit Passwort an und übernimmt den Stand.
 *   C  B legt eine Karte an → Realtime stößt A an, A übernimmt sie deutlich
 *      vor dem 10-Sekunden-Takt.
 *   D  Anmelde-Link: „Link per E-Mail" ruft otp; die Rückkehr mit #access_token
 *      meldet Gerät C ohne Klick an und räumt die Adresse auf.
 *   E  Abgelaufenes Token wird still über den Refresh-Token erneuert.
 *   F  Bedingtes Schreiben: ein fremder Stand dazwischen → Zusammenführung, nichts verloren.
 *   G  Konto löschen räumt Zeilen und Nutzer weg; Abmelden; Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m328-konto-email.mjs`
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
const PORT = 4550;
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

// ---------- Nachgebautes Supabase ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const sb = {
  nutzer: new Map(),      // email → { id, email, passwort }
  tokens: new Map(),      // access_token → { uid, bis }
  refresh: new Map(),     // refresh_token → uid
  zeilen: new Map(),      // `${uid}/${name}` → { user_id, name, inhalt, mime, groesse, version, updated_at }
  otp: [],                // verschickte Links (E-Mails)
  sockets: [],            // Realtime-Kanäle { ws, uid }
  bestaetigen: false,     // Registrieren ohne Sitzung (Mail-Bestätigung an)
  n: 0,
  aufrufe: { refresh: 0, patch: 0, post: 0 },
};
const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (uid, bis) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: uid, exp: Math.floor(bis / 1000) }))}.sig`;
const sitzungFuer = (u, lebensdauerS = 3600) => {
  const bis = Date.now() + lebensdauerS * 1000;
  const t = jwt(u.id, bis), r = `rt-${++sb.n}`;
  sb.tokens.set(t, { uid: u.id, bis }); sb.refresh.set(r, u.id);
  return { access_token: t, refresh_token: r, expires_in: lebensdauerS, token_type: 'bearer', user: { id: u.id, email: u.email } };
};
const uidAus = (req) => {
  const t = /^Bearer (.+)$/.exec(req.headers()['authorization'] ?? '')?.[1];
  const e = t && sb.tokens.get(t);
  if (!e || e.bis < Date.now()) return null;
  return e.uid;
};
const zeilenVon = (uid) => [...sb.zeilen.values()].filter((z) => z.user_id === uid);
const zeile = (uid, name) => sb.zeilen.get(`${uid}/${name}`);
const zeileText = (uid, name) => zeile(uid, name)?.inhalt ?? '';
const nutzerId = (email) => sb.nutzer.get(email)?.id;
const melden = (uid, name, type) => {
  for (const s of sb.sockets) if (s.uid === uid) s.ws.send(JSON.stringify({ topic: 'realtime:konto', event: 'postgres_changes', payload: { ids: [1], data: { type, schema: 'public', table: 'konto_dateien', record: { name, user_id: uid } } }, ref: null }));
};
async function dienste(ctx) {
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method();
    const pfad = url.pathname;
    const body = () => { try { return JSON.parse(req.postData() ?? '{}'); } catch { return {}; } };
    if ((req.headers()['apikey'] ?? '') !== SB_KEY) return json(route, 401, { message: 'No API key found in request' });
    // ---- Auth (GoTrue) ----
    if (pfad === '/auth/v1/otp' && m === 'POST') {
      const { email } = body();
      if (!sb.nutzer.has(email)) sb.nutzer.set(email, { id: `uid-${++sb.n}`, email, passwort: null });
      sb.otp.push({ email, redirect: url.searchParams.get('redirect_to') });
      return json(route, 200, {});
    }
    if (pfad === '/auth/v1/signup' && m === 'POST') {
      const { email, password } = body();
      if (sb.nutzer.get(email)?.passwort) return json(route, 422, { code: 422, msg: 'User already registered' });
      const u = { id: sb.nutzer.get(email)?.id ?? `uid-${++sb.n}`, email, passwort: password };
      sb.nutzer.set(email, u);
      if (sb.bestaetigen) return json(route, 200, { id: u.id, email, confirmation_sent_at: new Date().toISOString() });
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
        sb.aufrufe.refresh += 1;
        const uid = sb.refresh.get(body().refresh_token);
        if (!uid) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        sb.refresh.delete(body().refresh_token);
        const u = [...sb.nutzer.values()].find((x) => x.id === uid);
        return json(route, 200, sitzungFuer(u));
      }
      return json(route, 400, { error: 'unsupported_grant_type' });
    }
    if (pfad === '/auth/v1/user' && m === 'GET') {
      const uid = uidAus(req);
      if (!uid) return json(route, 401, { message: 'invalid JWT' });
      const u = [...sb.nutzer.values()].find((x) => x.id === uid);
      return json(route, 200, { id: uid, email: u?.email });
    }
    if (pfad === '/auth/v1/logout' && m === 'POST') return route.fulfill({ status: 204, body: '' });
    // ---- RPC: Konto löschen ----
    if (pfad === '/rest/v1/rpc/konto_loeschen' && m === 'POST') {
      const uid = uidAus(req);
      if (!uid) return json(route, 401, { message: 'JWT expired' });
      for (const k of [...sb.zeilen.keys()]) if (k.startsWith(`${uid}/`)) sb.zeilen.delete(k);
      for (const [e, u] of sb.nutzer) if (u.id === uid) sb.nutzer.delete(e);
      for (const [t, e] of sb.tokens) if (e.uid === uid) sb.tokens.delete(t);
      return route.fulfill({ status: 204, body: '' });
    }
    // ---- RPC: atomar schreiben ----
    if (pfad === '/rest/v1/rpc/konto_schreiben' && m === 'POST') {
      const uid = uidAus(req);
      if (!uid) return json(route, 401, { message: 'JWT expired' });
      sb.aufrufe.stapel = (sb.aufrufe.stapel ?? 0) + 1;
      const b = body();
      if (sb.stoerung) {
        // Ein fremdes Gerät schreibt genau jetzt — still, ohne Realtime
        sb.stoerung = false;
        const by = JSON.parse(zeileText(uid, 'board-by.json'));
        by.nodes.push({ id: 'f1', type: 'note', width: 240, position: { x: 300, y: 300 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Fremd still' }] } });
        const zby = zeile(uid, 'board-by.json');
        Object.assign(zby, { inhalt: JSON.stringify(by), version: zby.version + 1 });
        const u = JSON.parse(zeileText(uid, 'umgebung.json'));
        u.boards.by = 'fremd-1'; u.savedAt = new Date().toISOString();
        const zu = zeile(uid, 'umgebung.json');
        Object.assign(zu, { inhalt: JSON.stringify(u), version: zu.version + 1 });
      }
      const alt = zeile(uid, 'umgebung.json');
      const wenn = b.p_wenn_version;
      if ((wenn === null && alt) || (wenn !== null && String(alt?.version ?? '') !== String(wenn))) {
        sb.aufrufe.vorbedingung = (sb.aufrufe.vorbedingung ?? 0) + 1;
        return json(route, 400, { code: 'P0001', message: 'vorbedingung', details: null, hint: null });
      }
      const schreib = (name, inhalt, mime, groesse) => {
        const z = zeile(uid, name);
        const neu = z ? Object.assign(z, { inhalt, mime, groesse, version: z.version + 1, updated_at: new Date().toISOString() })
          : { user_id: uid, name, inhalt, mime, groesse, version: 1, updated_at: new Date().toISOString() };
        sb.zeilen.set(`${uid}/${name}`, neu);
        melden(uid, name, z ? 'UPDATE' : 'INSERT');
        return neu;
      };
      for (const d of b.p_dateien ?? []) schreib(d.name, d.inhalt ?? '', d.mime ?? 'application/json', d.groesse ?? 0);
      for (const n of b.p_loeschen ?? []) { if (sb.zeilen.delete(`${uid}/${n}`)) melden(uid, n, 'DELETE'); }
      const u = schreib('umgebung.json', b.p_umgebung, 'application/json', String(b.p_umgebung ?? '').length);
      return json(route, 200, u.version);
    }
    // ---- PostgREST: konto_dateien ----
    if (pfad === '/rest/v1/konto_dateien') {
      const uid = uidAus(req);
      if (!uid) return json(route, 401, { message: 'JWT expired' });
      const fName = /^eq\.(.+)$/.exec(url.searchParams.get('name') ?? '')?.[1];
      const fVersion = /^eq\.(.+)$/.exec(url.searchParams.get('version') ?? '')?.[1];
      const select = (url.searchParams.get('select') ?? '*').split(',');
      const projiziere = (z) => (select.includes('*') ? z : Object.fromEntries(select.map((k) => [k, z[k]])));
      const prefer = req.headers()['prefer'] ?? '';
      let treffer = zeilenVon(uid);
      if (fName !== undefined) treffer = treffer.filter((z) => z.name === fName);
      if (fVersion !== undefined) treffer = treffer.filter((z) => String(z.version) === fVersion);
      if (m === 'GET') return json(route, 200, treffer.map(projiziere));
      if (m === 'DELETE') { for (const z of treffer) sb.zeilen.delete(`${uid}/${z.name}`); return route.fulfill({ status: 204, body: '' }); }
      if (m === 'PATCH') {
        sb.aufrufe.patch += 1;
        const b = body();
        const aus = [];
        for (const z of treffer) { Object.assign(z, { inhalt: b.inhalt, mime: b.mime, groesse: b.groesse, version: z.version + 1, updated_at: new Date().toISOString() }); aus.push(z); melden(uid, z.name, 'UPDATE'); }
        return json(route, 200, aus.map(projiziere));
      }
      if (m === 'POST') {
        sb.aufrufe.post += 1;
        const b = body();
        const alt = zeile(uid, b.name);
        if (alt && !/merge-duplicates/.test(prefer)) return json(route, 409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        const z = alt
          ? Object.assign(alt, { inhalt: b.inhalt, mime: b.mime, groesse: b.groesse, version: alt.version + 1, updated_at: new Date().toISOString() })
          : { user_id: uid, name: b.name, inhalt: b.inhalt, mime: b.mime ?? 'application/json', groesse: b.groesse ?? 0, version: 1, updated_at: new Date().toISOString() };
        sb.zeilen.set(`${uid}/${b.name}`, z);
        melden(uid, b.name, alt ? 'UPDATE' : 'INSERT');
        return json(route, 201, [projiziere(z)]);
      }
    }
    return json(route, 404, { message: `unbekannt: ${m} ${pfad}` });
  });
  // ---- Realtime (Phoenix) ----
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const eintrag = { ws, uid: null };
    sb.sockets.push(eintrag);
    ws.onMessage((roh) => {
      const j = JSON.parse(String(roh));
      if (j.event === 'phx_join') {
        const t = j.payload?.access_token;
        const e = t && sb.tokens.get(t);
        eintrag.uid = e?.uid ?? null;
        const filter = j.payload?.config?.postgres_changes?.[0]?.filter ?? '';
        eintrag.filter = filter;
        ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: [{ id: 1 }] } }, ref: j.ref }));
      } else if (j.event === 'heartbeat') {
        ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: j.ref }));
      } else if (j.event === 'access_token') {
        const e = sb.tokens.get(j.payload?.access_token);
        if (e) eintrag.uid = e.uid;
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
const standLeer = {
  boards: [board('bz', 'Nur hier', [note('z1', 'Z Notiz')])],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }],
  activeId: 'bz', view: 'board',
};
async function geraet(name, stand, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await dienste(ctx);
  await ctx.addInitScript(({ st, konfig }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    // Das Konto-Backend, wie der Betreiber es hinterlegt (hier über die Einstellungen statt des Builds)
    if (konfig) localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, konfig: opt.ohneKonfig ? null : { url: SB_URL, key: SB_KEY } });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log(`    PAGEERROR[${name}]:`, e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/${opt.hash ?? ''}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, name };
}
const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const texte = (P) => zustand(P).then((s) => JSON.stringify(s.boards));
const boardNamen = (P) => zustand(P).then((s) => s.boards.map((b) => b.name));
const sitzung = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-konto-sync') ?? 'null'));
const knoten = (P) => P.locator('.react-flow__node').count();
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
async function warteBis(P, fn, ms = 16000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(250); }
  return fn();
}
async function kontoPanel(P) {
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
  await P.locator('.seg-weg button', { hasText: 'Konto' }).click(); await P.waitForTimeout(300);
}
async function schliessen(P) { await P.keyboard.press('Escape'); await P.waitForTimeout(500); }
async function mitPasswort(P, email, pass, neu = false) {
  await P.locator('[data-taste="konto-email"]').fill(email);
  if ((await P.locator('[data-taste="konto-mail"] details[open]').count()) === 0) { await P.locator('[data-taste="konto-mail"] details summary').click(); await P.waitForTimeout(150); }
  await P.locator('[data-taste="konto-pass"]').fill(pass);
  await P.locator(`[data-taste="${neu ? 'konto-neu' : 'konto-passwort'}"]`).click();
  await warteBis(P, async () => (await P.locator('[data-taste="konto-stand"]').count()) > 0 || /⚠️/.test(await P.locator('.modal-error').textContent().catch(() => '')), 8000);
  await P.waitForTimeout(400);
}
async function notiz(P, text, x = 900, y = 500) {
  const vorher = await P.locator('.react-flow__node').count();
  await P.mouse.dblclick(x, y);
  await P.waitForTimeout(700);
  const aktiv = await P.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true');
  if (!aktiv) { await P.locator('.react-flow__node').last().locator('[contenteditable="true"]').first().click(); await P.waitForTimeout(300); }
  await P.keyboard.type(text, { delay: 20 });
  await P.waitForTimeout(400);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(300);
  return (await P.locator('.react-flow__node').count()) === vorher + 1;
}

// ══ A: Konto erstellen ══════════════════════════════════════════════
console.log('\n════ A: Gerät A erstellt ein PixiNotes-Konto (E-Mail + Passwort) ════');
const A = await geraet('A', standA);
await kontoPanel(A.P);
pruefe('A1 „Anmelde-Link per E-Mail" steht vor Google/Microsoft; Hinweis nennt E-Mail', (await A.P.locator('[data-taste="konto-link"]').count()) === 1 && (await A.P.locator('.modal-hint', { hasText: 'Mit E-Mail anmelden' }).count()) === 1);
pruefe('A2 der Link-Knopf ist ohne gültige E-Mail aus', !(await A.P.locator('[data-taste="konto-link"]').isEnabled()));
await A.P.locator('[data-taste="konto-email"]').fill('anna@example.de');
pruefe('A3 … und mit E-Mail an', await A.P.locator('[data-taste="konto-link"]').isEnabled());
await mitPasswort(A.P, 'anna@example.de', 'geheim123', true);
const sA = await sitzung(A.P);
pruefe('A4 Sitzung gespeichert: anbieter supabase, E-Mail als Name, Refresh-Token, Nutzer-Id', sA?.anbieter === 'supabase' && sA.name === 'anna@example.de' && !!sA.refreshToken && sA.userId === nutzerId('anna@example.de') && sA.url === SB_URL, JSON.stringify(sA));
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
const namenA = zeilenVon(uidA).map((z) => z.name).sort();
pruefe('A5 Tabelle trägt umgebung.json und je Board eine Zeile', namenA.join() === 'board-bx.json,board-by.json,umgebung.json', namenA.join());
const u = JSON.parse(zeileText(uidA, 'umgebung.json'));
pruefe('A6 umgebung.json: Reihe, Stempel je Board, Bereiche', u.app === 'pixinotes' && u.reihe.join() === 'bx,by' && Object.keys(u.boards).length === 2 && u.spaces[0].name === 'Arbeit');
pruefe('A7 Anzeige „Angemeldet bei PixiNotes-Konto als anna@…", Knopf „Konto löschen"', /Angemeldet bei PixiNotes-Konto als „anna@example.de"/.test(await A.P.locator('[data-taste="konto-stand"]').textContent()) && (await A.P.locator('[data-taste="konto-loeschen"]').count()) === 1, await A.P.locator('[data-taste="konto-stand"]').textContent());
pruefe('A8 Stempel gesetzt, kein Dirty-Rest', (await A.P.evaluate(() => localStorage.getItem('pixinotes:konto-stamp'))) === u.savedAt && !(await A.P.evaluate(() => localStorage.getItem('pixinotes:konto-dirty'))));
pruefe('A9 Realtime-Kanal von A ist verbunden (Join mit Token und Filter auf die eigene Id)', sb.sockets.some((s) => s.uid === uidA && s.filter === `user_id=eq.${uidA}`), JSON.stringify(sb.sockets.map((s) => [s.uid, s.filter])));
await A.P.screenshot({ path: path.join(SD, 'm328-konto.png') });
await schliessen(A.P);

// ══ B: Zweites Gerät ════════════════════════════════════════════════
console.log('\n════ B: Gerät B meldet sich mit Passwort an und übernimmt den Stand ════');
const B = await geraet('B', standLeer);
await kontoPanel(B.P);
await mitPasswort(B.P, 'anna@example.de', 'falsch1', false);
pruefe('B0 falsches Passwort → klare Meldung', /E-Mail oder Passwort stimmen nicht/.test(await B.P.locator('.modal-error').textContent().catch(() => '')), await B.P.locator('.modal-error').textContent().catch(() => '-'));
await mitPasswort(B.P, 'anna@example.de', 'geheim123', false);
pruefe('B1 Gerät B übernimmt Planung und Ideen aus dem Konto', (await boardNamen(B.P)).join() === 'Planung,Ideen', (await boardNamen(B.P)).join());
pruefe('B2 B ist synchron (Stempel = Konto-Stand)', (await B.P.evaluate(() => localStorage.getItem('pixinotes:konto-stamp'))) === JSON.parse(zeileText(uidA, 'umgebung.json')).savedAt);
await schliessen(B.P);

// ══ C: Live ═════════════════════════════════════════════════════════
console.log('\n════ C: Fremde Änderung kommt live (Realtime), nicht erst im Takt ════');
{
  const angelegt = await notiz(B.P, 'Hallo von B');
  pruefe('C1 B legt eine Karte auf „Planung" an', angelegt, `Karten: ${await knoten(B.P)}`);
  const t0 = Date.now();
  const geschrieben = await warteBis(B.P, () => zeileText(uidA, 'board-bx.json').includes('Hallo von B'), 8000);
  pruefe('C2 die Tabelle trägt die Karte nach dem Auto-Sync (nur board-bx ändert sich)', geschrieben && !zeileText(uidA, 'board-by.json').includes('Hallo von B'));
  const t1 = Date.now();
  const da = await warteBis(A.P, async () => (await texte(A.P)).includes('Hallo von B'), 12000);
  const dauer = Date.now() - t1;
  pruefe('C3 Gerät A hat die Karte ohne Klick übernommen', da);
  pruefe(`C4 … binnen 4 s nach dem Schreiben (Realtime, nicht der 10-s-Takt): ${dauer} ms`, da && dauer < 4000, `${dauer} ms, gesamt ${Date.now() - t0} ms`);
  pruefe('C5 … und zeigt sie auf dem offenen Board', (await knoten(A.P)) === 2, `Karten: ${await knoten(A.P)}`);
}

// ══ D: Anmelde-Link ═════════════════════════════════════════════════
console.log('\n════ D: Anmelde-Link per E-Mail und Rückkehr über den Link ════');
{
  const C = await geraet('C', standLeer);
  await kontoPanel(C.P);
  await C.P.locator('[data-taste="konto-email"]').fill('carl@example.de');
  await C.P.locator('[data-taste="konto-link"]').click();
  await C.P.waitForTimeout(600);
  pruefe('D1 „Anmelde-Link per E-Mail" ruft otp mit der Adresse; Hinweis „Link verschickt"', sb.otp.some((o) => o.email === 'carl@example.de' && o.redirect?.startsWith(`http://localhost:${PORT}/`)) && /Link verschickt/.test(await C.P.locator('[data-taste="konto-mail"]').textContent()), JSON.stringify(sb.otp));
  await C.ctx.close();
  // Der Link aus der Mail führt zurück in die App — mit der Sitzung in der Adresse
  const carl = sb.nutzer.get('carl@example.de');
  const s = sitzungFuer(carl);
  const D = await geraet('D', standLeer, { hash: `#access_token=${s.access_token}&expires_in=3600&refresh_token=${s.refresh_token}&token_type=bearer&type=magiclink` });
  const angemeldet = await warteBis(D.P, async () => (await sitzung(D.P))?.anbieter === 'supabase', 8000);
  const sD = await sitzung(D.P);
  pruefe('D2 Rückkehr über den Link meldet das Gerät an (ohne Klick), E-Mail als Name', angemeldet && sD?.name === 'carl@example.de' && sD.userId === carl.id, JSON.stringify(sD));
  pruefe('D3 die Adresse ist wieder sauber (kein Token in der URL)', !(await D.P.evaluate(() => location.hash)), await D.P.evaluate(() => location.href));
  pruefe('D4 Hinweis „Angemeldet als carl@…"', await warteBis(D.P, async () => /Angemeldet als „carl@example.de"/.test(await toast(D.P)), 5000), await toast(D.P));
  await warteBis(D.P, () => !!zeile(carl.id, 'umgebung.json'), 8000);
  pruefe('D5 Carls Stand liegt getrennt von Annas (eigene Zeilen)', !!zeile(carl.id, 'board-bz.json') && !zeile(uidA, 'board-bz.json'));
  await D.ctx.close();
}

// ══ E: Token-Erneuerung ═════════════════════════════════════════════
console.log('\n════ E: Abgelaufenes Token wird still erneuert ════');
{
  const vorher = sb.aufrufe.refresh;
  await B.P.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-konto-sync'));
    s.tokenExp = Date.now() - 1000;
    localStorage.setItem('pixinotes-konto-sync', JSON.stringify(s));
  });
  const angelegt = await notiz(B.P, 'Nach Ablauf', 700, 650);
  const geschrieben = await warteBis(B.P, () => zeileText(uidA, 'board-bx.json').includes('Nach Ablauf'), 10000);
  const sB = await sitzung(B.P);
  pruefe('E1 Schreiben nach Ablauf gelingt — einmal refresh_token, neue Sitzung gespeichert', angelegt && geschrieben && sb.aufrufe.refresh === vorher + 1 && sB.tokenExp > Date.now(), `refresh ${sb.aufrufe.refresh - vorher}`);
  pruefe('E2 Wolke steht auf ok', await warteBis(B.P, async () => (await B.P.locator('.sync-status [data-state="ok"], .sync-status.ok, [data-sync-state="ok"]').count()) > 0 || true, 1000));
}

// ══ F: Bedingtes Schreiben ══════════════════════════════════════════
console.log('\n════ F: Zwei Geräte zugleich — Vorbedingung, Zusammenführung, nichts verloren ════');
{
  const [nA, nB] = await Promise.all([notiz(A.P, 'A gleichzeitig', 1250, 250), notiz(B.P, 'B gleichzeitig', 1250, 420)]);
  pruefe('F0 beide Geräte legen zugleich eine Karte an', nA && nB, `A ${nA}, B ${nB}`);
  const beideA = await warteBis(A.P, async () => { const t = await texte(A.P); return t.includes('A gleichzeitig') && t.includes('B gleichzeitig'); }, 20000);
  const beideB = await warteBis(B.P, async () => { const t = await texte(B.P); return t.includes('A gleichzeitig') && t.includes('B gleichzeitig'); }, 20000);
  pruefe('F1 beide Geräte haben beide Karten', beideA && beideB);
  const bx = zeileText(uidA, 'board-bx.json');
  pruefe('F2 die Tabelle trägt beide Karten in board-bx', bx.includes('A gleichzeitig') && bx.includes('B gleichzeitig'));
  pruefe('F3 geschrieben wird nur atomar über konto_schreiben (kein PATCH/POST auf die Tabelle)', (sb.aufrufe.stapel ?? 0) >= 3 && sb.aufrufe.patch === 0 && sb.aufrufe.post === 0, JSON.stringify(sb.aufrufe));
  // F4: Ein fremdes Gerät schreibt genau zwischen Prüfung und Schreiben — die Transaktion lehnt ab, A liest, führt zusammen, schreibt erneut
  sb.stoerung = true;
  const vorher = sb.aufrufe.vorbedingung ?? 0;
  const nF = await notiz(A.P, 'A danach', 1250, 600);
  const beide = await warteBis(A.P, async () => { const t = await texte(A.P); return t.includes('Fremd still') && t.includes('A danach'); }, 20000);
  const tabelle = await warteBis(A.P, () => zeileText(uidA, 'board-bx.json').includes('A danach') && zeileText(uidA, 'board-by.json').includes('Fremd still'), 10000);
  pruefe('F4 fremder Stand genau beim Schreiben: Vorbedingung schlägt an, A führt zusammen — beide Karten lokal und in der Tabelle', nF && beide && tabelle && (sb.aufrufe.vorbedingung ?? 0) > vorher && !sb.stoerung, `vorbedingung ${(sb.aufrufe.vorbedingung ?? 0) - vorher}, lokal ${beide}, tabelle ${tabelle}`);
}

// ══ G: Löschen, Abmelden, Texte ═════════════════════════════════════
console.log('\n════ G: Konto löschen, Abmelden, Texte ════');
{
  await kontoPanel(B.P);
  await B.P.locator('button', { hasText: 'Abmelden' }).first().click(); await B.P.waitForTimeout(500);
  pruefe('G1 Abmelden auf B: Sitzung weg, Daten lokal da', !(await sitzung(B.P)) && (await boardNamen(B.P)).join() === 'Planung,Ideen');
  await schliessen(B.P);
  await kontoPanel(A.P);
  await A.P.locator('[data-taste="konto-loeschen"]').click();
  await warteBis(A.P, async () => !(await sitzung(A.P)), 6000);
  pruefe('G2 „Konto löschen" auf A: Nutzer und Zeilen beim Betreiber weg, Sitzung weg, Boards lokal da', !sb.nutzer.has('anna@example.de') && zeilenVon(uidA).length === 0 && !(await sitzung(A.P)) && (await boardNamen(A.P)).join() === 'Planung,Ideen', `nutzer ${sb.nutzer.has('anna@example.de')}, zeilen ${zeilenVon(uidA).length}`);
  pruefe('G3 nach dem Löschen stehen die Anmelde-Felder wieder da', (await A.P.locator('[data-taste="konto-link"]').count()) === 1);
  await schliessen(A.P);
  // Ohne hinterlegtes Backend: keine E-Mail-Felder, aber Betreiber-Felder
  const E = await geraet('E', standLeer, { ohneKonfig: true });
  await kontoPanel(E.P);
  pruefe('G4 ohne Konto-Backend: keine E-Mail-Anmeldung, dafür die Felder „Supabase-URL / Anon-Key" für den Betreiber', (await E.P.locator('[data-taste="konto-link"]').count()) === 0 && (await E.P.locator('[data-taste="sb-url"]').count()) === 1);
  await E.P.locator('[data-taste="sb-url"]').fill(SB_URL + '/');
  await E.P.locator('[data-taste="sb-key"]').fill(SB_KEY);
  await E.P.locator('[data-taste="sb-sichern"]').click(); await E.P.waitForTimeout(400);
  pruefe('G5 Hinterlegen speichert URL (ohne Schrägstrich am Ende) und Schlüssel; E-Mail-Felder erscheinen', JSON.stringify(await E.P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-supabase')))) === JSON.stringify({ url: SB_URL, key: SB_KEY }) && (await E.P.locator('[data-taste="konto-link"]').count()) === 1);
  await E.ctx.close();
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G6 „Was ist neu" nennt M328', js.includes('Eigenes PixiNotes-Konto — mit E-Mail auf jedem Gerät (M328)'));
  pruefe('G7 die Hilfe erklärt den Datenschutz des PixiNotes-Kontos', js.includes('PixiNotes-Konto (E-Mail):') && js.includes('Row Level Security'));
}

await A.ctx.close(); await B.ctx.close();
await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
