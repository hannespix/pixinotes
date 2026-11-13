/**
 * M360 — Freigabe mit Rolle (bearbeiten / nur lesen) und Einladungslink.
 * Supabase (Auth, PostgREST, RPCs, Realtime) ist im Node-Prozess nachgebaut (Gerüst aus m330).
 *
 *   A  Anna gibt „Planung" für Bernd NUR ZUM LESEN frei (Rollenwahl im Dialog).
 *   B  Bernd sieht das Board mit Hinweisband und Schloss; Doppelklick, Tippen, Ziehen, Entf,
 *      Stift ändern nichts; nichts reist zum Server.
 *   C  Annas Änderung kommt bei Bernd live an (er liest mit).
 *   D  Anna stellt Bernd auf „darf bearbeiten" → das Band verschwindet live, Bernds Karte landet bei Anna.
 *   E  Rollenwechsel zurück, OHNE dass Bernd es schon weiß (kein Realtime): Seine Änderung wird abgelehnt,
 *      das Board bleibt geteilt (nur lesen), sein Stand gleicht wieder Annas.
 *   F  „Eigene Kopie anlegen": Die Kopie gehört Bernd, liegt in seinem Projekt und lässt sich bearbeiten.
 *   G  Einladungslink: Anna legt ihn an; Clara (ohne Konto) öffnet ihn → Hinweis + Anmeldung → nach dem
 *      Anmelden ist sie Gast und das Board geht auf. Rolle des Links ändern, eigener Link, widerrufen.
 *   H  Server ohne Einladungs-Tabelle: Der Abschnitt fehlt, die E-Mail-Freigabe geht weiter.
 *   I  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m360-freigabe-rollen.mjs`
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

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4578;
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
  einladungen: [],        // { token, besitzer, board_id, rolle, created_at }
  ohneEinladung: false,   // Server ohne Tabelle board_einladungen (Migration fehlt)
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
      if (m === 'PATCH') {
        for (const f of filt(sb.freigaben.filter((x) => x.besitzer === uid))) { Object.assign(f, { rolle: body().rolle }); melden(uid, '', 'UPDATE', 'board_freigaben', f); }
        return route.fulfill({ status: 204, body: '' });
      }
      if (m === 'DELETE') {
        const weg = filt(sb.freigaben.filter((f) => f.besitzer === uid || f.gast_id === uid));
        sb.freigaben = sb.freigaben.filter((f) => !weg.includes(f));
        for (const f of weg) melden(uid, '', 'DELETE', 'board_freigaben', f);
        return route.fulfill({ status: 204, body: '' });
      }
    }
    // ---- board_einladungen (M360) ----
    if (pfad === '/rest/v1/board_einladungen') {
      if (sb.ohneEinladung) return json(route, 404, { code: 'PGRST205', message: "Could not find the table 'public.board_einladungen'" });
      const meine = () => sb.einladungen.filter((e) => e.besitzer === uid && (!eq('board_id') || e.board_id === eq('board_id')));
      if (m === 'GET') return json(route, 200, meine());
      if (m === 'POST') {
        const b = body();
        let e = sb.einladungen.find((x) => x.besitzer === uid && x.board_id === b.board_id);
        if (e) Object.assign(e, { rolle: b.rolle }); else { e = { token: b.token, besitzer: uid, board_id: b.board_id, rolle: b.rolle ?? 'bearbeiten', created_at: new Date().toISOString() }; sb.einladungen.push(e); }
        return json(route, 201, [e]);
      }
      if (m === 'DELETE') { const weg = meine(); sb.einladungen = sb.einladungen.filter((e) => !weg.includes(e)); return route.fulfill({ status: 204, body: '' }); }
    }
    if (pfad === '/rest/v1/rpc/einladung_annehmen' && m === 'POST') {
      if (sb.ohneEinladung) return json(route, 404, { message: 'Could not find the function' });
      const e = sb.einladungen.find((x) => x.token === body().p_token);
      if (!e) return json(route, 200, null);
      if (e.besitzer === uid) return json(route, 200, { board_id: e.board_id, rolle: e.rolle, eigen: true });
      const mail = (ich?.email ?? '').toLowerCase();
      let f = sb.freigaben.find((x) => x.besitzer === e.besitzer && x.board_id === e.board_id && x.gast_email === mail);
      if (f) f.gast_id = uid; else { f = { id: `fg-${++sb.n}`, besitzer: e.besitzer, board_id: e.board_id, gast_email: mail, gast_id: uid, rolle: e.rolle, created_at: new Date().toISOString() }; sb.freigaben.push(f); }
      melden(uid, '', 'INSERT', 'board_freigaben', f);
      return json(route, 200, { board_id: e.board_id, rolle: f.rolle, eigen: false, besitzer_email: nutzerVon(e.besitzer)?.email });
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
async function geraet(name, stand, anker = '') {
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
  await P.goto(`http://localhost:${PORT}/${anker}`, { waitUntil: 'networkidle' });
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


const texteVon = (P) => P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((n) => n.textContent).join(' | '));
const band = (P) => P.locator('[data-taste="lese-band"]').count();
/** Eine freie Stelle der Leinwand suchen (keine Karte, kein Bedienelement) und dort eine Notiz anlegen */
async function notizFrei(P, text) {
  const [x, y] = await P.evaluate(() => {
    const karten = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
    for (let yy = 220; yy <= 660; yy += 40) {
      for (let xx = 1300; xx >= 520; xx -= 40) {
        if (karten.some((r) => xx > r.left - 30 && xx < r.right + 30 && yy > r.top - 30 && yy < r.bottom + 30)) continue;
        const el = document.elementFromPoint(xx, yy);
        if (el?.classList.contains('react-flow__pane')) return [xx, yy];
      }
    }
    return [1300, 240];
  });
  return notiz(P, text, x, y);
}
async function dialogOeffnen(P, name) {
  const z = P.locator('.tabs.spalte .side-board', { hasText: name }).first();
  await z.hover(); await P.waitForTimeout(200);
  await z.locator('.ebenen-menu-knopf').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="board-freigeben"]').click(); await P.waitForTimeout(600);
}

// ══ A: Anna gibt nur zum Lesen frei ═════════════════════════════════
console.log('\n════ A: Anna gibt „Planung" für Bernd nur zum Lesen frei ════');
const A = await geraet('A', standA);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
{
  const z = A.P.locator('.tabs.spalte .side-board', { hasText: 'Planung' }).first();
  await z.hover(); await A.P.waitForTimeout(200);
  await z.locator('.ebenen-menu-knopf').click(); await A.P.waitForTimeout(300);
  pruefe('A1 das Board-Menü nennt den Weg „Gemeinsam bearbeiten …"', /Gemeinsam bearbeiten/.test(await A.P.locator('[data-taste="board-freigeben"]').textContent()));
  await A.P.locator('[data-taste="board-freigeben"]').click(); await A.P.waitForTimeout(600);
}
pruefe('A2 der Dialog bietet Einladungslink und E-Mail mit Rollenwahl', (await A.P.locator('[data-taste="einladung"]').count()) === 1 && (await A.P.locator('[data-taste="freigabe-rolle"]').count()) === 1);
await A.P.locator('[data-taste="freigabe-email"]').fill('bernd@example.de');
await A.P.locator('[data-taste="freigabe-rolle"]').selectOption('lesen');
await A.P.locator('[data-taste="freigabe-einladen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="freigabe-liste"] li').count()) === 1, 6000);
pruefe('A3 die Freigabe trägt die Rolle „lesen"', sb.freigaben[0]?.rolle === 'lesen' && sb.freigaben[0]?.gast_email === 'bernd@example.de', JSON.stringify(sb.freigaben[0]));
pruefe('A4 die Liste zeigt die Rolle zum Umstellen', (await A.P.locator('[data-taste="freigabe-liste"] li select').inputValue()) === 'lesen');
await A.P.screenshot({ path: path.join(SD, 'm360-dialog.png') });
await schliessen(A.P);

// ══ B: Bernd liest mit ══════════════════════════════════════════════
console.log('\n════ B: Bernd sieht das Board — und kann nichts ändern ════');
const B = await geraet('B', standB);
await anmelden(B.P, 'bernd@example.de', 'geheim456', true);
const uidB = nutzerId('bernd@example.de');
await warteBis(B.P, async () => !!(await boardVon(B.P, 'bx')), 12000);
const bxB = await boardVon(B.P, 'bx');
pruefe('B1 „Planung" ist da, mit Besitzer und Rolle „lesen"', bxB?.geteiltVon === uidA && bxB?.geteiltRolle === 'lesen', JSON.stringify({ von: bxB?.geteiltVon, rolle: bxB?.geteiltRolle }));
await boardWechseln(B.P, 'Planung', 'anna@example.de');
await B.P.waitForTimeout(600);
pruefe('B2 Hinweisband „Nur lesen · geteilt von anna@…" mit „Eigene Kopie anlegen"', (await band(B.P)) === 1 && /Nur lesen/.test(await B.P.locator('[data-taste="lese-band"]').textContent()) && /anna@example\.de/.test(await B.P.locator('[data-taste="lese-band"]').textContent()) && (await B.P.locator('[data-taste="lese-kopie"]').count()) === 1);
pruefe('B3 die Spalte zeigt ein Schloss statt der zwei Köpfe', /🔒/.test(await B.P.locator('.tabs.spalte .side-board', { hasText: 'Planung' }).first().textContent()));
await B.P.screenshot({ path: path.join(SD, 'm360-nur-lesen.png') });
const schreibVor = sb.aufrufe.freigabeSchreiben;
// Doppelklick auf die freie Fläche: keine neue Notiz, dafür ein Hinweis
const nVor = await knoten(B.P);
await B.P.mouse.dblclick(1000, 620); await B.P.waitForTimeout(700);
pruefe('B4 Doppelklick legt keine Notiz an', (await knoten(B.P)) === nVor && (await boardVon(B.P, 'bx')).nodes.length === 1, `${await knoten(B.P)}`);
pruefe('B5 ein Hinweis erklärt es („nur zum Lesen freigegeben")', /nur zum Lesen freigegeben/.test(await toast(B.P)), await toast(B.P));
// Tippen in die Notiz
const karte = B.P.locator('.react-flow__node').first();
pruefe('B6 der Notiz-Editor nimmt nichts an (contenteditable aus)', (await karte.locator('[contenteditable="true"]').count()) === 0);
await karte.locator('.bn-editor').click({ force: true }).catch(() => {}); await B.P.waitForTimeout(200);
await B.P.keyboard.type('XYZ'); await B.P.waitForTimeout(400);
pruefe('B7 getippter Text landet nirgends', !/XYZ/.test(await texteVon(B.P)) && !/XYZ/.test(JSON.stringify(await boardVon(B.P, 'bx'))));
// Ziehen
const posVor = (await boardVon(B.P, 'bx')).nodes[0].position;
const kb = await karte.boundingBox();
await B.P.mouse.move(kb.x + 12, kb.y + 6); await B.P.mouse.down(); await B.P.mouse.move(kb.x + 160, kb.y + 120, { steps: 8 }); await B.P.mouse.up(); await B.P.waitForTimeout(500);
const posNach = (await boardVon(B.P, 'bx')).nodes[0].position;
const kb2 = await karte.boundingBox();
pruefe('B8 die Karte lässt sich nicht verschieben (das Ziehen schwenkt nur die Ansicht)', posNach.x === posVor.x && posNach.y === posVor.y, JSON.stringify({ posVor, posNach }));
// Auswählen geht (zum Kopieren), Entf löscht nicht
await B.P.mouse.click(kb2.x + 12, kb2.y + 6); await B.P.waitForTimeout(300);
await B.P.waitForTimeout(5200); // der Hinweis von eben ist verklungen
await B.P.mouse.click(1250, 800); await B.P.waitForTimeout(300);
await B.P.mouse.click(kb2.x + 12, kb2.y + 6); await B.P.waitForTimeout(400);
pruefe('B9 Auswählen geht weiterhin — ohne Hinweis (ein Klick ist keine Bearbeitung)', (await B.P.locator('.react-flow__node.selected').count()) === 1 && !/nur zum Lesen/.test(await toast(B.P)), await toast(B.P));
await B.P.keyboard.press('Delete'); await B.P.waitForTimeout(500);
pruefe('B10 Entf löscht die Karte nicht', (await knoten(B.P)) === 1 && (await boardVon(B.P, 'bx')).nodes.length === 1);
await B.P.keyboard.press('Escape'); await B.P.waitForTimeout(200);
// Stift-Werkzeug
await B.P.keyboard.press('p'); await B.P.waitForTimeout(400);
pruefe('B11 das Stift-Werkzeug geht nicht an', (await zustand(B.P)).tool !== 'pen' && (await B.P.locator('.draw-palette').count()) === 0);
await B.P.waitForTimeout(3600);
pruefe('B12 nichts reist zum Server (kein freigabe_schreiben)', sb.aufrufe.freigabeSchreiben === schreibVor && sb.aufrufe.keineFreigabe === 0, JSON.stringify(sb.aufrufe));
pruefe('B13 Verbindungs-Punkte sind unsichtbar', await B.P.evaluate(() => [...document.querySelectorAll('.react-flow__handle')].every((h) => getComputedStyle(h).visibility === 'hidden')));

// ══ C: Annas Änderung kommt live ════════════════════════════════════
console.log('\n════ C: Anna schreibt — Bernd liest live mit ════');
await A.P.waitForTimeout(300);
pruefe('C0 Anna legt eine Notiz an', await notizFrei(A.P, 'Von Anna live'));
pruefe('C1 Bernd sieht sie binnen Sekunden', await warteBis(B.P, async () => /Von Anna live/.test(await texteVon(B.P)), 12000), await texteVon(B.P));
pruefe('C2 das Board bleibt bei Bernd nur lesbar', (await boardVon(B.P, 'bx'))?.geteiltRolle === 'lesen' && (await band(B.P)) === 1);

// ══ D: Rolle auf „bearbeiten" ═══════════════════════════════════════
console.log('\n════ D: Anna stellt Bernd auf „darf bearbeiten" ════');
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="freigabe-liste"] li select').selectOption('bearbeiten');
await warteBis(A.P, () => sb.freigaben[0]?.rolle === 'bearbeiten', 5000);
pruefe('D1 die Rolle steht beim Server auf „bearbeiten"', sb.freigaben[0]?.rolle === 'bearbeiten');
await schliessen(A.P);
pruefe('D2 bei Bernd verschwindet das Band live', await warteBis(B.P, async () => (await band(B.P)) === 0, 12000));
pruefe('D3 das Board trägt keine Lese-Rolle mehr', !(await boardVon(B.P, 'bx'))?.geteiltRolle && (await boardVon(B.P, 'bx'))?.geteiltVon === uidA);
pruefe('D4 Bernd legt eine Notiz an', await notizFrei(B.P, 'Von Bernd'));
pruefe('D5 sie landet in Annas Zeile und bei Anna auf dem Board', await warteBis(A.P, async () => /Von Bernd/.test(zeileText(uidA, 'board-bx.json')) && /Von Bernd/.test(await texteVon(A.P)), 14000));

// ══ E: Rolle zurück, ohne Realtime ══════════════════════════════════
console.log('\n════ E: Rolle wieder „lesen", Bernd erfährt es erst beim Schreiben ════');
sb.freigaben[0].rolle = 'lesen'; // still, ohne Meldung — wie bei abgerissener Live-Verbindung
const keineVor = sb.aufrufe.keineFreigabe;
await notizFrei(B.P, 'Zu spät');
pruefe('E1 der Server lehnt Bernds Änderung ab', await warteBis(B.P, () => sb.aufrufe.keineFreigabe > keineVor, 10000));
pruefe('E2 das Board bleibt geteilt und ist jetzt nur lesbar (keine stille Abspaltung)', await warteBis(B.P, async () => { const b = await boardVon(B.P, 'bx'); return b?.geteiltVon === uidA && b?.geteiltRolle === 'lesen'; }, 8000), JSON.stringify(await boardVon(B.P, 'bx').then((b) => ({ von: b?.geteiltVon, rolle: b?.geteiltRolle }))));
pruefe('E3 Bernds abgelehnte Karte ist wieder weg — sein Stand gleicht Annas', await warteBis(B.P, async () => !/Zu spät/.test(JSON.stringify(await boardVon(B.P, 'bx'))) && !/Zu spät/.test(await texteVon(B.P)), 8000));
pruefe('E4 Annas Zeile hat die Karte nie gesehen', !/Zu spät/.test(zeileText(uidA, 'board-bx.json')));
pruefe('E5 das Band ist zurück', (await band(B.P)) === 1);

// ══ F: Eigene Kopie ═════════════════════════════════════════════════
console.log('\n════ F: „Eigene Kopie anlegen" ════');
await B.P.locator('[data-taste="lese-kopie"]').click(); await B.P.waitForTimeout(1200);
const stB = await zustand(B.P);
const kopie = stB.boards.find((b) => /Planung \(Kopie\)/.test(b.name));
pruefe('F1 die Kopie gehört Bernd (ohne Besitzer, ohne Rolle) und hat alle Karten', !!kopie && !kopie.geteiltVon && !kopie.geteiltRolle && kopie.nodes.length === (await boardVon(B.P, 'bx')).nodes.length, JSON.stringify(kopie && { von: kopie.geteiltVon, n: kopie.nodes.length }));
pruefe('F2 sie liegt in Bernds eigenem Projekt, nicht unter „Geteilt mit mir"', !!stB.spaces.find((sp) => sp.id === 's9')?.projects[0].boardIds.includes(kopie?.id) && !stB.spaces.find((sp) => sp.id === 'geteilt')?.projects.some((p) => p.boardIds.includes(kopie?.id)));
pruefe('F3 sie ist offen und ohne Band', stB.activeId === kopie?.id && (await band(B.P)) === 0);
pruefe('F4 in der Kopie lässt sich schreiben', await notizFrei(B.P, 'Meine Anmerkung') && await warteBis(B.P, async () => /Meine Anmerkung/.test(JSON.stringify((await zustand(B.P)).boards.find((b) => b.id === kopie?.id))), 3000));
pruefe('F5 die Kopie liegt in Bernds Konto, nicht in Annas', await warteBis(B.P, () => /Meine Anmerkung/.test(zeileText(uidB, `board-${kopie?.id}.json`)), 10000) && !zeilenVon(uidA).some((z) => /Meine Anmerkung/.test(z.inhalt)));
// Die Freigabe endet: Das nur lesbare Board darf nicht gesperrt und veraltet liegen bleiben
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="freigabe-liste"] li .freigabe-weg').click();
await warteBis(A.P, () => !sb.freigaben.some((f) => f.board_id === 'bx'), 5000);
await schliessen(A.P);
pruefe('F6 Anna entfernt die Freigabe: Das nur lesbare Board verschwindet bei Bernd', await warteBis(B.P, async () => !(await boardVon(B.P, 'bx')), 16000));
pruefe('F7 Bernds eigene Kopie bleibt', !!(await zustand(B.P)).boards.find((b) => b.id === kopie?.id));

// ══ G: Einladungslink ═══════════════════════════════════════════════
console.log('\n════ G: Einladungslink ════');
await dialogOeffnen(A.P, 'Ideen');
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const einl = sb.einladungen[0];
const adresse = await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => '');
pruefe('G1 Link angelegt: Board by, Rolle bearbeiten, langes Token, Adresse …#e=<token>', !!einl && einl.board_id === 'by' && einl.rolle === 'bearbeiten' && einl.token.length >= 20 && adresse.endsWith(`#e=${einl?.token}`), adresse);
await A.P.screenshot({ path: path.join(SD, 'm360-einladung.png') });
await schliessen(A.P);
// Clara: ohne Konto, öffnet den Link
const standC = { boards: [board('bc', 'Claras Board', [note('c1', 'C Notiz')])], spaces: [{ id: 'sc', name: 'Uni', projects: [{ id: 'pc', name: 'Semester', boardIds: ['bc'] }] }], activeId: 'bc', view: 'board' };
const C = await geraet('C', standC, `#e=${einl.token}`);
pruefe('G2 ohne Konto: Hinweis auf die Einladung, die Einstellungen stehen bei der Konto-Anmeldung', /Einladung zu einem gemeinsamen Board/.test(await toast(C.P)) && (await C.P.locator('[data-taste="konto-email"]').count()) === 1, await toast(C.P));
pruefe('G3 die Einladung ist gemerkt, die Adresse aufgeräumt', (await C.P.evaluate(() => localStorage.getItem('pixinotes-einladung-offen'))) === einl.token && (await C.P.evaluate(() => location.hash)) === '');
await C.P.locator('[data-taste="konto-email"]').fill('clara@example.de');
if ((await C.P.locator('[data-taste="konto-mail"] details[open]').count()) === 0) { await C.P.locator('[data-taste="konto-mail"] details summary').click(); await C.P.waitForTimeout(150); }
await C.P.locator('[data-taste="konto-pass"]').fill('geheim789');
await C.P.locator('[data-taste="konto-neu"]').click();
await warteBis(C.P, () => !!nutzerId('clara@example.de'), 8000);
const uidC = nutzerId('clara@example.de');
pruefe('G4 nach der Anmeldung ist Clara Gast (Rolle bearbeiten)', await warteBis(C.P, () => sb.freigaben.some((f) => f.besitzer === uidA && f.board_id === 'by' && f.gast_id === uidC && f.rolle === 'bearbeiten'), 12000), JSON.stringify(sb.freigaben));
await schliessen(C.P);
pruefe('G5 „Ideen" ist bei Clara da und offen', await warteBis(C.P, async () => { const s = await zustand(C.P); return s.activeId === 'by' && s.boards.some((b) => b.id === 'by' && b.geteiltVon === uidA); }, 16000), await zustand(C.P).then((s) => `${s.activeId} ${s.boards.map((b) => b.id)}`));
pruefe('G6 die gemerkte Einladung ist erledigt', (await C.P.evaluate(() => localStorage.getItem('pixinotes-einladung-offen'))) === null);
await C.P.waitForTimeout(800);
pruefe('G7 Clara schreibt mit — Anna sieht es', (await notizFrei(C.P, 'Von Clara')) && await warteBis(A.P, () => /Von Clara/.test(zeileText(uidA, 'board-by.json')), 14000));
// Rolle des Links ändern: Token bleibt
await dialogOeffnen(A.P, 'Ideen');
pruefe('G8 Anna sieht Clara in der Liste (angenommen)', /clara@example\.de/.test(await A.P.locator('[data-taste="freigabe-liste"]').textContent()) && /angenommen/.test(await A.P.locator('[data-taste="freigabe-liste"]').textContent()));
await A.P.locator('[data-taste="einladung-rolle"]').selectOption('lesen');
await warteBis(A.P, () => sb.einladungen[0]?.rolle === 'lesen', 5000);
pruefe('G9 Rolle des Links auf „lesen", das Token bleibt', sb.einladungen[0]?.rolle === 'lesen' && sb.einladungen[0]?.token === einl.token && sb.einladungen.length === 1);
pruefe('G10 Claras bestehende Freigabe behält „bearbeiten"', sb.freigaben.find((f) => f.gast_id === uidC)?.rolle === 'bearbeiten');
await schliessen(A.P);
// Bernd ist angemeldet und folgt dem Link (Anker in der offenen App)
await B.P.evaluate((t) => { location.hash = `#e=${t}`; }, einl.token);
pruefe('G11 Bernd (angemeldet) tritt bei — als Leser', await warteBis(B.P, () => sb.freigaben.some((f) => f.board_id === 'by' && f.gast_id === uidB && f.rolle === 'lesen'), 10000));
pruefe('G12 „Ideen" geht bei Bernd auf, mit Band', await warteBis(B.P, async () => (await zustand(B.P)).activeId === 'by' && (await band(B.P)) === 1, 16000), await zustand(B.P).then((s) => s.activeId));
pruefe('G13 Meldung nennt die Besitzerin und „nur lesen"', await warteBis(B.P, async () => /anna@example\.de/.test(await toast(B.P)) && /nur lesen/.test(await toast(B.P)), 4000), await toast(B.P));
// Anna öffnet ihren eigenen Link
await A.P.evaluate((t) => { location.hash = `#e=${t}`; }, einl.token);
pruefe('G14 eigener Link: Hinweis statt Freigabe an sich selbst', await warteBis(A.P, async () => /eigenen Board/.test(await toast(A.P)), 6000) && !sb.freigaben.some((f) => f.gast_id === uidA), await toast(A.P));
// Widerrufen
await dialogOeffnen(A.P, 'Ideen');
await A.P.locator('[data-taste="einladung-weg"]').click();
pruefe('G15 Link widerrufen: Zeile weg, Gäste bleiben', await warteBis(A.P, () => sb.einladungen.length === 0, 5000) && sb.freigaben.filter((f) => f.board_id === 'by').length === 2);
await schliessen(A.P);
await C.P.evaluate((t) => { location.hash = `#e=${t}`; }, einl.token);
pruefe('G16 der widerrufene Link sagt, dass es ihn nicht mehr gibt', await warteBis(C.P, async () => /gibt es nicht mehr/.test(await toast(C.P)), 6000), await toast(C.P));

// ══ H: Server ohne Einladungs-Tabelle ═══════════════════════════════
console.log('\n════ H: Server ohne Einladungs-Tabelle ════');
sb.ohneEinladung = true;
await dialogOeffnen(A.P, 'Planung');
await A.P.waitForTimeout(500);
pruefe('H1 der Abschnitt „Einladungslink" fehlt, die E-Mail-Freigabe bleibt', (await A.P.locator('[data-taste="einladung"]').count()) === 0 && (await A.P.locator('[data-taste="freigabe-email"]').count()) === 1 && (await A.P.locator('.freigabe-dialog .modal-error').count()) === 0);
await schliessen(A.P);
sb.ohneEinladung = false;

// ══ I: Texte ════════════════════════════════════════════════════════
console.log('\n════ I: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('I1 „Was ist neu" nennt M360', js.includes('(M360)'));
  pruefe('I2 die Migration liegt im Repository', existsSync(path.join(__repo, 'supabase', 'migrations', '20261113150000_board_einladungen.sql')));
}

await A.ctx.close(); await B.ctx.close(); await C.ctx.close();
await browser.close();
app.close();
console.log(`\nm360-freigabe-rollen: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
