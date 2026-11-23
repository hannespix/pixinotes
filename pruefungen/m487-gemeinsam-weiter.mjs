/**
 * M487 — Gemeinsam tippen auch im Protokoll und in Kanban-Texten (Yjs über den vorhandenen Live-Kanal, wie M477).
 * Supabase (Auth, PostgREST, RPCs, Realtime mit Broadcast + Presence) ist im Node-Prozess nachgebaut (Gerüst aus m477).
 *
 *   A  Live-Runde: Anna (Besitzerin) und Gerd (Gast ohne Konto) auf einem Board mit Protokoll und Kanban.
 *   B  Protokoll: beide tippen gleichzeitig (vorne/hinten), keine Sperre, fremder Cursor, übrige Felder geschützt,
 *      gespeichert das gewohnte Block-JSON der Sitzung, kein Konflikt.
 *   C  Ticket: gleichzeitig in derselben Beschreibung und im Titel, „… tippt", eigener Cursor bleibt, Strg+Z nur
 *      Eigenes; zwei verschiedene Tickets zugleich verlieren nichts mehr.
 *   D  Späteinsteiger Bernd: voller Stand in Ticket und Protokoll, zu dritt.
 *   E  Rückweg: Lädt der Yjs-Teil nicht, gelten Karten-Sperre und gewohnte Felder wie vorher.
 *   F  Ohne Live-Verbindung wie bisher (kein Yjs).
 *   G  Texte, keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m477-gemeinsam-tippen.mjs`
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
const PORT = 5487;
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
  aufrufe: { freigabeSchreiben: 0, vorbedingung: 0, keineFreigabe: 0, stapel: 0, gastLesen: 0, gastStand: 0, gastSchreiben: 0, gastAbgelehnt: 0, nichtErlaubt: 0, karte: 0, stand: 0, gastAendern: 0, besitzerBoard: 0, delta: 0 },
  ohneAendern: false,     // Server ohne gast_aendern
  // M364
  kanaele: new Map(),     // `${besitzer}/${board}` → Kanalname
  live: [],               // { ws, topic, key, meta } — Broadcast + Presence
  ohneGast: false,        // Server ohne gast_*-Funktionen (Migration fehlt)
  ohneLive: false,        // Der Live-Kanal antwortet nicht (neue Verbindungen)
};
const kanalVon = (besitzer, boardId) => { const k = `${besitzer}/${boardId}`; if (!sb.kanaele.has(k)) sb.kanaele.set(k, `k${++sb.n}${Math.random().toString(36).slice(2, 12)}`); return sb.kanaele.get(k); };
// M366: kartenweise Änderung, wie gast_aendern auf dem Server
const patchAuf = (board, p) => {
  for (const art of ['nodes', 'edges', 'drawings', 'comments']) {
    const t = p[art]; if (!t) continue;
    const set = new Map((t.set ?? []).map((o) => [o.id, o])); const del = new Set(t.del ?? []);
    const neu = [];
    for (const o of board[art] ?? []) { if (del.has(o.id)) continue; if (set.has(o.id)) { neu.push(set.get(o.id)); set.delete(o.id); } else neu.push(o); }
    for (const o of set.values()) if (!del.has(o.id)) neu.push(o);
    board[art] = neu;
  }
  return board;
};
const serverAendern = (e, p) => {
  const name = `board-${e.board_id}.json`;
  const z = zeile(e.besitzer, name);
  const vor = z.version;
  const neu = schreib(e.besitzer, name, JSON.stringify(patchAuf(JSON.parse(z.inhalt), p)), 'application/json', 0);
  const um = zeile(e.besitzer, 'umgebung.json');
  if (um) { const u = JSON.parse(um.inhalt); u.boards[e.board_id] = `v${neu.version}`; u.savedAt = new Date().toISOString(); u.basisEtag = String(um.version); schreib(e.besitzer, 'umgebung.json', JSON.stringify(u), 'application/json', 0); }
  return { version: neu.version, vor };
};
const liveAn = (topic, nachricht, ausser = null) => { for (const s of sb.live) if (s.topic === topic && s !== ausser) { try { s.ws.send(JSON.stringify(nachricht)); } catch { /* zu */ } } };
/** Ein Teilnehmer, den es als Gerät nicht gibt (für die Sicherheitsprüfung) */
const fakeDa = (topic, key, meta) => liveAn(topic, { topic, event: 'presence_diff', payload: { joins: { [key]: { metas: [meta] } }, leaves: {} }, ref: null });
const fakeWeg = (topic, key, meta) => liveAn(topic, { topic, event: 'presence_diff', payload: { joins: {}, leaves: { [key]: { metas: [meta] } } }, ref: null });
const fakeSenden = (topic, ereignis, inhalt) => liveAn(topic, { topic, event: 'broadcast', payload: { type: 'broadcast', event: ereignis, payload: inhalt }, ref: null });
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
    // ---- M364: Gäste ohne Konto — nur das Token zählt (öffentlicher Schlüssel genügt) ----
    if (/^\/rest\/v1\/rpc\/gast_/.test(pfad) && m === 'POST') {
      if (sb.ohneGast) return json(route, 404, { code: 'PGRST202', message: 'Could not find the function' });
      const b = body();
      const e = sb.einladungen.find((x) => x.token === b.p_token && x.ohne_konto);
      const name = e && `board-${e.board_id}.json`;
      const z = e && zeile(e.besitzer, name);
      if (pfad.endsWith('/gast_lesen')) {
        sb.aufrufe.gastLesen += 1;
        if (!z) return json(route, 200, null);
        return json(route, 200, { board_id: e.board_id, rolle: e.rolle, besitzer: e.besitzer, inhalt: z.inhalt, version: z.version, dateien: e.dateien ?? [], kanal: kanalVon(e.besitzer, e.board_id), optionen: e.optionen ?? {} });
      }
      if (pfad.endsWith('/gast_stand')) {
        sb.aufrufe.gastStand += 1;
        return json(route, 200, z ? { version: z.version, rolle: e.rolle, optionen: e.optionen ?? {} } : null);
      }
      if (pfad.endsWith('/gast_aendern')) {
        if (sb.ohneAendern) return json(route, 404, { code: 'PGRST202', message: 'Could not find the function' });
        if (!z || e.rolle !== 'bearbeiten') { sb.aufrufe.gastAbgelehnt += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
        sb.aufrufe.gastAendern += 1;
        return json(route, 200, serverAendern(e, b.p_patch));
      }
      if (pfad.endsWith('/gast_schreiben')) {
        if (!z || e.rolle !== 'bearbeiten') { sb.aufrufe.gastAbgelehnt += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
        if (b.p_wenn_version == null || String(z.version) !== String(b.p_wenn_version)) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
        {
          // M365: wie gast_schreiben auf dem Server — Karten, die nicht von einem Gast per Link stammen
          const recht = e.optionen?.gastRecht ?? 'alles';
          if (recht !== 'alles') {
            const alt = JSON.parse(z.inhalt).nodes ?? []; const nn = JSON.parse(b.p_inhalt).nodes ?? [];
            const N = new Map(nn.map((n) => [n.id, n])); const A = new Map(alt.map((n) => [n.id, n]));
            const gast = (n) => String(n.data?.von ?? '').startsWith('g:');
            const J = (x) => JSON.stringify(x ?? null);
            const verstoss = alt.some((x) => { if (gast(x)) return false; const n = N.get(x.id); return !n || !!n.archived !== !!x.archived || n.data?.von !== x.data?.von || (recht === 'eigenes' && (J(n.data) !== J(x.data) || J(n.position) !== J(x.position))); })
              || nn.some((n) => !A.has(n.id) && !gast(n));
            if (verstoss) { sb.aufrufe.nichtErlaubt += 1; return json(route, 400, { code: 'P0004', message: 'nicht erlaubt' }); }
          }
        }
        sb.aufrufe.gastSchreiben += 1;
        const neu = schreib(e.besitzer, name, b.p_inhalt, 'application/json', String(b.p_inhalt).length);
        const um = zeile(e.besitzer, 'umgebung.json');
        if (um) { const u = JSON.parse(um.inhalt); u.boards[e.board_id] = b.p_stempel; u.savedAt = new Date().toISOString(); u.basisEtag = String(um.version); schreib(e.besitzer, 'umgebung.json', JSON.stringify(u), 'application/json', 0); }
        return json(route, 200, neu.version);
      }
    }
    const uid = uidAus(req);
    if (!uid) return json(route, 401, { message: 'JWT expired' });
    const ich = nutzerVon(uid);
    if (pfad === '/rest/v1/rpc/board_kanal' && m === 'POST') {
      const b = body();
      if (b.p_besitzer !== uid && !freigabeFuer(b.p_besitzer, b.p_board_id, uid)) return json(route, 200, null);
      return json(route, 200, { kanal: kanalVon(b.p_besitzer, b.p_board_id), optionen: sb.einladungen.find((x) => x.besitzer === b.p_besitzer && x.board_id === b.p_board_id)?.optionen ?? {} });
    }
    // ---- RPCs ----
    if (pfad === '/rest/v1/rpc/konto_schreiben' && m === 'POST') {
      sb.aufrufe.stapel += 1;
      const b = body();
      const alt = zeile(uid, 'umgebung.json');
      const wenn = b.p_wenn_version;
      if ((wenn === null && alt) || (wenn !== null && String(alt?.version ?? '') !== String(wenn))) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
      if ((b.p_dateien ?? []).some((d) => d.name === 'board-bx.json')) sb.aufrufe.besitzerBoard += 1;
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
        if (e) Object.assign(e, { rolle: b.rolle }); else { e = { token: b.token, besitzer: uid, board_id: b.board_id, rolle: b.rolle ?? 'bearbeiten', created_at: new Date().toISOString(), ohne_konto: false, dateien: [] }; sb.einladungen.push(e); }
        if ('ohne_konto' in b) e.ohne_konto = !!b.ohne_konto;
        if ('optionen' in b) e.optionen = b.optionen;
        return json(route, 201, [e]);
      }
      if (m === 'PATCH') { for (const e of sb.einladungen.filter((x) => x.besitzer === uid && x.token === eq('token'))) Object.assign(e, body()); return route.fulfill({ status: 204, body: '' }); }
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
      // ---- M364: Broadcast + Presence auf den Board-Kanälen ----
      if (typeof j.topic === 'string' && j.topic.startsWith('realtime:pn-')) {
        if (j.event === 'phx_join') {
          if (sb.ohneLive) return;
          const l = { ws, topic: j.topic, key: j.payload?.config?.presence?.key ?? `k${++sb.n}`, meta: null };
          sb.live.push(l); eintrag.live = l;
          ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: [] } }, ref: j.ref }));
          const state = {};
          for (const s of sb.live) if (s.topic === j.topic && s.meta) state[s.key] = { metas: [s.meta] };
          ws.send(JSON.stringify({ topic: j.topic, event: 'presence_state', payload: state, ref: null }));
        } else if (j.event === 'presence' && j.payload?.event === 'track' && eintrag.live) {
          const l = eintrag.live;
          const alt = l.meta; l.meta = j.payload.payload;
          liveAn(l.topic, { topic: l.topic, event: 'presence_diff', payload: { joins: { [l.key]: { metas: [l.meta] } }, leaves: alt ? { [l.key]: { metas: [alt] } } : {} }, ref: null });
        } else if (j.event === 'broadcast' && eintrag.live) {
          if (j.payload?.event === 'karte') sb.aufrufe.karte += 1;
          if (j.payload?.event === 'stand') sb.aufrufe.stand += 1;
          if (j.payload?.event === 'delta') sb.aufrufe.delta += 1;
          if (j.payload?.event === 'notiz-y') sb.aufrufe.notizY = (sb.aufrufe.notizY ?? 0) + 1;
          if (j.payload?.event === 'maus') sb.aufrufe.maus = (sb.aufrufe.maus ?? 0) + 1;
          // M391: Für die Drosselung zählen nur gemeldete STELLEN — das „weg" eines anderen, der gerade stillhält, ist keine
          if (j.payload?.event === 'maus' && !j.payload?.payload?.weg) sb.aufrufe.mausStelle = (sb.aufrufe.mausStelle ?? 0) + 1;
          liveAn(eintrag.live.topic, { topic: eintrag.live.topic, event: 'broadcast', payload: j.payload, ref: null }, eintrag.live);
        }
        return;
      }
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
    ws.onClose(() => {
      sb.sockets = sb.sockets.filter((s) => s !== eintrag);
      const l = eintrag.live;
      if (l) { sb.live = sb.live.filter((s) => s !== l); if (l.meta) liveAn(l.topic, { topic: l.topic, event: 'presence_diff', payload: { joins: {}, leaves: { [l.key]: { metas: [l.meta] } } }, ref: null }); }
    });
  });
}

const geladen = new Map();   // Gerät → nachgeladene Dateien
async function geraet(name, stand, anker = '', port = PORT, ohneKern = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await dienste(ctx);
  // M487: Rückweg — der Yjs-Kern lehnt ab (vor dem ersten Laden, sonst käme er aus dem Service Worker)
  if (ohneKern) await ctx.route(/\/assets\/notizGemeinsamKern-[^/]*\.js$/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: KERN_AUS }));
  await ctx.addInitScript(({ st, konfig }) => {
    if (window !== window.top) return;
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    if (konfig) localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, konfig: port === PORT ? { url: SB_URL, key: SB_KEY } : null });
  const P = await ctx.newPage();
  P.fehler = [];
  geladen.set(name, []);
  P.on('request', (r) => { if (/\/assets\//.test(r.url())) geladen.get(name).push(r.url()); });
  P.on('pageerror', (e) => { P.fehler.push(e.message); console.log(`    PAGEERROR[${name}]:`, e.message, String(e.stack).split('\n').slice(0, 4).join(' | ')); });
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${port}/${anker}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, name };
}
const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const boardVon = (P, id) => zustand(P).then((s) => s.boards.find((b) => b.id === id));
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
async function dialogOeffnen(P, name) {
  const z = P.locator('.tabs.spalte .side-board', { hasText: name }).first();
  await z.hover(); await P.waitForTimeout(200);
  await z.locator('.ebenen-menu-knopf').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="board-freigeben"]').click(); await P.waitForTimeout(600); await P.waitForSelector('[data-taste="einladung-optionen"], [data-taste="freigabe-ohne-konto"], [data-taste="freigabe-verlassen"]', { timeout: 2500 }).catch(() => {}); await P.evaluate(() => document.querySelectorAll('.freigabe-dialog details').forEach((d) => { d.open = true; }));
}
const zahl = (P) => P.locator('[data-taste="live-zahl"]').textContent().catch(() => '');

// ---------- Board: ein Protokoll und ein Kanban ----------
const protokoll = (id, x, y) => ({ id, type: 'minutes', width: 440, height: 430, position: { x, y }, data: {
  title: 'Jour fixe', current: 'e1', entries: [{ id: 'e1', date: '2026-11-23', blocks: [{ type: 'paragraph', content: 'Protokoll Start' }] }],
} });
const kanban = (id, x, y) => ({ id, type: 'kanban', width: 560, height: 380, position: { x, y }, data: {
  title: 'Aufgaben', cols: ['Offen', 'In Arbeit', 'Erledigt'], items: [
    { id: 't1', text: 'Ticket eins', col: 0, note: 'Beschreibung' },
    { id: 't2', text: 'Ticket zwei', col: 0 },
  ],
} });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const standA = {
  boards: [board('bx', 'Besprechung', [protokoll('p1', 40, 60), kanban('k1', 520, 60)])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1x', name: 'Allgemein', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
const standB = {
  boards: [board('bz', 'Nur hier', [])],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }],
  activeId: 'bz', view: 'board',
};
/** Ersatz für den Yjs-Kern, der ablehnt (Rückweg) — wie in m364/m372 */
const KERN_AUS = 'export async function sitzungOeffnen() { throw new Error("M487: Yjs-Teil abgeschaltet"); }';

const karte = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`);
// ---- Protokoll ----
const protokollGemeinsam = (P) => karte(P, 'p1').locator('.protokoll-wahl.note-gemeinsam').count();
async function insProtokoll(P, wo = 'ende') {
  await karte(P, 'p1').locator('.minutes-body .ProseMirror').first().click({ position: { x: 20, y: 10 } });
  const drin = await warteBis(P, () => P.evaluate(() => !!document.activeElement?.isContentEditable && document.activeElement.closest('.react-flow__node')?.dataset.id === 'p1'), 5000);
  await P.waitForTimeout(150);
  await P.keyboard.press(wo === 'ende' ? 'Control+End' : 'Control+Home');
  if (wo === 'ende') await P.keyboard.press('End'); else await P.keyboard.press('Home');
  return drin;
}
const protokollText = (P) => P.evaluate(() => {
  const pm = document.querySelector('.react-flow__node[data-id="p1"] .minutes-body .ProseMirror') ?? document.querySelector('.react-flow__node[data-id="p1"] .notiz-ruhend');
  if (!pm) return null;
  const k = pm.cloneNode(true);
  k.querySelectorAll('.bn-collaboration-cursor__base, .ProseMirror-yjs-cursor').forEach((e) => e.remove());
  return k.textContent.replace(/[⁠​]/g, '');
});
const fremdeCursor = (P) => P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="p1"] .bn-collaboration-cursor__base')].map((c) => c.querySelector('.bn-collaboration-cursor__label')?.textContent ?? ''));
const textDerBlocks = (blocks) => JSON.stringify(blocks ?? []).match(/"text":"([^"]*)"/g)?.map((t) => t.slice(8, -1)).join('') ?? '';
const eintragVon = (b) => b?.nodes.find((n) => n.id === 'p1')?.data.entries?.find((e) => e.id === 'e1');
const lokalProtokoll = async (P) => textDerBlocks(eintragVon(await boardVon(P, 'bx'))?.blocks);
const serverBoard = () => { try { return JSON.parse(zeileText(uidA, 'board-bx.json')); } catch { return null; } };
const serverProtokoll = () => textDerBlocks(eintragVon(serverBoard())?.blocks);
// ---- Kanban ----
async function ticketOeffnen(P, text) {
  await karte(P, 'k1').locator('.kanban-item-text', { hasText: text }).first().click();
  return warteBis(P, async () => (await P.locator('.ticket-modal').count()) === 1, 4000);
}
const ticketZu = async (P) => { await P.locator('.ticket-modal .taskhub-x').click().catch(() => {}); await P.waitForTimeout(300); };
/** Das Feld ist gemeinsam gebunden (die Sitzung steht) */
const feldGemeinsam = (P, sel) => P.locator(`.ticket-modal ${sel}[data-gemeinsam]`).count();
async function insFeld(P, sel, wo = 'ende') {
  await warteBis(P, async () => (await feldGemeinsam(P, sel)) === 1, 6000);
  const f = P.locator(`.ticket-modal ${sel}`).first();
  await f.click();
  await f.evaluate((el, w) => { const p = w === 'ende' ? el.value.length : 0; el.setSelectionRange(p, p); }, wo);
  await P.waitForTimeout(80);
}
const feldWert = (P, sel) => P.locator(`.ticket-modal ${sel}`).first().inputValue().catch(() => null);
const itemVon = (b, id) => b?.nodes.find((n) => n.id === 'k1')?.data.items?.find((i) => i.id === id);
const lokalItem = async (P, id) => itemVon(await boardVon(P, 'bx'), id);
const serverItem = (id) => itemVon(serverBoard(), id);
const vorkommen = (t, s) => ((t ?? '').match(new RegExp(s, 'g')) ?? []).length;
const tippt = (P) => P.locator('.ticket-modal [data-taste="feld-tippt"]').allTextContents();
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const keinKonflikt = async (geraete) => {
  const t = await Promise.all(geraete.map((g) => toast(g.P)));
  return { gut: !t.some((x) => /Konflikt|gleichzeitig|überschrieben/i.test(x)), t };
};

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Live-Runde mit Protokoll und Kanban ════');
const A = await geraet('A', standA);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await dialogOeffnen(A.P, 'Besprechung');
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
await schliessen(A.P);
await warteBis(A.P, () => sb.live.length >= 1, 8000);
const G = await geraet('G', standB, `#e=${token}`);
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 8000);
await warteBis(A.P, async () => /2 dabei/.test(await zahl(A.P)), 8000);
const annaName = await G.P.evaluate(() => [...document.querySelectorAll('[data-taste="live-chip"]')].map((c) => c.dataset.name).find((n) => n !== 'Gerd') ?? '');
pruefe('A1 zwei im Live-Board', /2 dabei/.test(await zahl(A.P)) && /2 dabei/.test(await zahl(G.P)) && !!annaName, annaName);

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Zwei tippen zugleich im Protokoll ════');
await warteBis(A.P, async () => (await protokollGemeinsam(A.P)) === 1 && (await protokollGemeinsam(G.P)) === 1, 8000);
pruefe('B1 das Protokoll läuft im Live-Board bei beiden gemeinsam (Yjs nachgeladen)', (await protokollGemeinsam(A.P)) === 1 && (await protokollGemeinsam(G.P)) === 1 && geladen.get('A').some((u) => /gemeinsam/.test(u)));
pruefe('B2 Anna setzt den Cursor ans Ende des Protokolls', await insProtokoll(A.P, 'ende'));
pruefe('B3 Gerd setzt den Cursor an den Anfang – keine Sperre', await insProtokoll(G.P, 'anfang'));
await G.P.waitForTimeout(300);
pruefe('B4 keine Karten-Sperre auf beiden Seiten', (await A.P.locator('[data-taste="live-sperre"]').count()) === 0 && (await G.P.locator('[data-taste="live-sperre"]').count()) === 0);
await Promise.all([
  A.P.keyboard.type(' TOP eins erledigt', { delay: 35 }),
  G.P.keyboard.type('Gerd notiert ', { delay: 45 }),
]);
await Promise.all([
  A.P.keyboard.type(' und zwei', { delay: 30 }),
  G.P.keyboard.type('vorne ', { delay: 30 }),
]);
const sollP = 'Gerd notiert vorne Protokoll Start TOP eins erledigt und zwei';
await warteBis(A.P, async () => (await protokollText(A.P)) === sollP && (await protokollText(G.P)) === sollP, 6000);
const pA = await protokollText(A.P); const pG = await protokollText(G.P);
console.log(`    Anna sieht: „${pA}"\n    Gerd sieht: „${pG}"`);
pruefe('B5 beide sehen denselben Protokolltext – nichts verloren, nichts doppelt', pA === pG && pA === sollP, JSON.stringify({ pA, pG }));
await A.P.keyboard.type('!', { delay: 20 });
await warteBis(G.P, async () => (await fremdeCursor(G.P)).includes(annaName), 4000);
pruefe('B6 Gerd sieht Annas Cursor mit ihrem Namen im Protokoll', (await fremdeCursor(G.P)).includes(annaName), JSON.stringify(await fremdeCursor(G.P)));
await A.P.screenshot({ path: `${SD}/m487-b-protokoll.png` });
// Während Anna tippt, bleiben die übrigen Felder der Karte, wie sie sind (sonst hielte Gerd die Karte)
await G.P.locator('.react-flow__node[data-id="p1"] .pr-person-neu').click();
await G.P.waitForTimeout(500);
pruefe('B7 Teilnehmende ändern geht nicht, solange Anna im Protokoll tippt – ein Hinweis nennt sie', new RegExp(annaName).test(await toast(G.P)) && !(await G.P.evaluate(() => document.activeElement?.matches?.('.pr-person-neu'))), await toast(G.P));
await A.P.keyboard.press('Escape'); await A.P.evaluate(() => document.activeElement?.blur?.());
await G.P.keyboard.press('Escape'); await G.P.evaluate(() => document.activeElement?.blur?.());
const endeP = await protokollText(A.P);
await warteBis(A.P, async () => serverProtokoll() === endeP && (await lokalProtokoll(A.P)) === endeP && (await lokalProtokoll(G.P)) === endeP, 15000);
console.log(`    Server: „${serverProtokoll()}"`);
pruefe('B8 auf dem Server und bei beiden steht der Protokolltext genau so – jedes Stück einmal', serverProtokoll() === endeP && vorkommen(serverProtokoll(), 'Protokoll Start') === 1 && vorkommen(serverProtokoll(), 'Gerd notiert') === 1 && (await lokalProtokoll(G.P)) === endeP, JSON.stringify({ s: serverProtokoll(), endeP }));
const e1 = eintragVon(serverBoard());
pruefe('B9 gespeichert wird das gewohnte Block-JSON der Sitzung (Datum bleibt)', Array.isArray(e1?.blocks) && e1.blocks[0]?.type === 'paragraph' && e1.date === '2026-11-23' && !JSON.stringify(e1).includes('ydoc'), JSON.stringify(e1).slice(0, 200));
pruefe('B10 kein Konflikt-Hinweis', (await keinKonflikt([A, G])).gut, JSON.stringify((await keinKonflikt([A, G])).t));
// Niemand tippt mehr: Teilnehmende sind wieder frei
await G.P.locator('.react-flow__node[data-id="p1"] .pr-person-neu').click();
await G.P.keyboard.type('Anna, Gerd', { delay: 20 });
await G.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(A.P, () => eintragVon(serverBoard())?.attendees === 'Anna, Gerd', 10000);
pruefe('B11 niemand tippt mehr: Gerd trägt die Teilnehmenden ein – der Protokolltext bleibt', eintragVon(serverBoard())?.attendees === 'Anna, Gerd' && serverProtokoll() === endeP, JSON.stringify({ att: eintragVon(serverBoard())?.attendees, s: serverProtokoll() }));

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Zwei tippen zugleich in einem Ticket ════');
pruefe('C1 Anna und Gerd öffnen dasselbe Ticket', (await ticketOeffnen(A.P, 'Ticket eins')) && (await ticketOeffnen(G.P, 'Ticket eins')));
await insFeld(A.P, '.ticket-note', 'ende');
await insFeld(G.P, '.ticket-note', 'anfang');
pruefe('C2 die Beschreibung ist bei beiden gemeinsam gebunden', (await feldGemeinsam(A.P, '.ticket-note')) === 1 && (await feldGemeinsam(G.P, '.ticket-note')) === 1);
await Promise.all([
  A.P.keyboard.type(' von Anna', { delay: 35 }),
  G.P.keyboard.type('Gerd: ', { delay: 45 }),
]);
const sollN = 'Gerd: Beschreibung von Anna';
await warteBis(A.P, async () => (await feldWert(A.P, '.ticket-note')) === sollN && (await feldWert(G.P, '.ticket-note')) === sollN, 6000);
pruefe('C3 beide sehen dieselbe Beschreibung – zeichengenau zusammengeführt', (await feldWert(A.P, '.ticket-note')) === sollN && (await feldWert(G.P, '.ticket-note')) === sollN, JSON.stringify([await feldWert(A.P, '.ticket-note'), await feldWert(G.P, '.ticket-note')]));
await G.P.waitForTimeout(700);   // eigener Rückgängig-Schritt (Yjs fasst Eingaben binnen 500 ms zusammen)
await G.P.keyboard.type('x', { delay: 20 });
await warteBis(A.P, async () => (await tippt(A.P)).some((t) => /Gerd/.test(t) && /tippt/.test(t)), 4000);
pruefe('C4 Anna sieht, dass Gerd gerade in der Beschreibung tippt', (await tippt(A.P)).some((t) => /Gerd/.test(t) && /tippt/.test(t)), JSON.stringify(await tippt(A.P)));
pruefe('C5 … und Gerds Cursor blieb an seiner Stelle (hinter seinem Text)', (await feldWert(G.P, '.ticket-note')) === 'Gerd: xBeschreibung von Anna', await feldWert(G.P, '.ticket-note'));
await G.P.screenshot({ path: `${SD}/m487-c-ticket.png` });
// Strg+Z im Feld nimmt nur die eigene Eingabe zurück
await G.P.waitForTimeout(700);
await G.P.keyboard.press('Control+z');
await warteBis(A.P, async () => (await feldWert(A.P, '.ticket-note')) === sollN, 4000);
pruefe('C6 Strg+Z im Feld nimmt nur Gerds letzte Eingabe zurück – bei beiden', (await feldWert(A.P, '.ticket-note')) === sollN && (await feldWert(G.P, '.ticket-note')) === sollN, JSON.stringify([await feldWert(A.P, '.ticket-note'), await feldWert(G.P, '.ticket-note')]));
// Titel: gleichzeitig vorne und hinten
await insFeld(A.P, '.ticket-title', 'ende');
await insFeld(G.P, '.ticket-title', 'anfang');
await Promise.all([A.P.keyboard.type(' (dringend)', { delay: 35 }), G.P.keyboard.type('Neu: ', { delay: 40 })]);
const sollT = 'Neu: Ticket eins (dringend)';
await warteBis(A.P, async () => (await feldWert(A.P, '.ticket-title')) === sollT && (await feldWert(G.P, '.ticket-title')) === sollT, 6000);
pruefe('C7 auch im Titel: beide tippen zugleich, derselbe Text', (await feldWert(A.P, '.ticket-title')) === sollT && (await feldWert(G.P, '.ticket-title')) === sollT, JSON.stringify([await feldWert(A.P, '.ticket-title'), await feldWert(G.P, '.ticket-title')]));
// Solange jemand im Ticket tippt, lässt sich die Kanban-Karte nicht verschieben (wie die Notiz in M477)
await A.P.keyboard.type('!', { delay: 20 });
await G.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(A.P, async () => serverItem('t1')?.text === `${sollT}!` && serverItem('t1')?.note === sollN, 10000);
pruefe('C8 auf dem Server: Titel und Beschreibung des Tickets wie bei allen, jedes Stück einmal', serverItem('t1')?.text === `${sollT}!` && serverItem('t1')?.note === sollN, JSON.stringify(serverItem('t1')));
await ticketZu(A.P); await ticketZu(G.P);
// Zwei verschiedene Tickets zugleich – vorher ging dabei eine Änderung im kartenweisen Abgleich verloren
pruefe('C9 Anna öffnet Ticket eins, Gerd Ticket zwei', (await ticketOeffnen(A.P, 'Neu: Ticket eins')) && (await ticketOeffnen(G.P, 'Ticket zwei')));
await insFeld(A.P, '.ticket-note', 'ende'); await insFeld(G.P, '.ticket-note', 'ende');
await Promise.all([A.P.keyboard.type(' Ergänzung', { delay: 35 }), G.P.keyboard.type('Neue Beschreibung', { delay: 30 })]);
await A.P.evaluate(() => document.activeElement?.blur?.()); await G.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(A.P, async () => serverItem('t1')?.note === `${sollN} Ergänzung` && serverItem('t2')?.note === 'Neue Beschreibung'
  && (await lokalItem(A.P, 't2'))?.note === 'Neue Beschreibung' && (await lokalItem(G.P, 't1'))?.note === `${sollN} Ergänzung`, 12000);
pruefe('C10 beide Änderungen kommen an – auf dem Server und bei beiden', serverItem('t1')?.note === `${sollN} Ergänzung` && serverItem('t2')?.note === 'Neue Beschreibung' && (await lokalItem(A.P, 't2'))?.note === 'Neue Beschreibung' && (await lokalItem(G.P, 't1'))?.note === `${sollN} Ergänzung`, JSON.stringify({ s1: serverItem('t1')?.note, s2: serverItem('t2')?.note }));
pruefe('C11 kein Konflikt-Hinweis', (await keinKonflikt([A, G])).gut, JSON.stringify((await keinKonflikt([A, G])).t));
pruefe('C12 Spalten und Reihenfolge der Tickets blieben unberührt', JSON.stringify(serverBoard().nodes.find((n) => n.id === 'k1').data.items.map((i) => [i.id, i.col])) === JSON.stringify([['t1', 0], ['t2', 0]]));

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Späteinsteiger ════');
// Anna tippt weiter im Ticket, Bernd kommt dazu
await insFeld(A.P, '.ticket-note', 'ende');
const B = await geraet('B', standB, `#e=${token}`);
await warteBis(B.P, async () => !!(await boardVon(B.P, 'bx')), 12000);
await B.P.locator('[data-taste="gast-name"]').fill('Bernd');
await B.P.locator('[data-taste="gast-name-ok"]').click(); await B.P.waitForTimeout(500);
await warteBis(B.P, async () => /3 dabei/.test(await zahl(B.P)), 8000);
await A.P.keyboard.type(' und mehr', { delay: 30 });
pruefe('D1 Bernd öffnet dasselbe Ticket', await ticketOeffnen(B.P, 'Neu: Ticket eins'));
await warteBis(B.P, async () => (await feldGemeinsam(B.P, '.ticket-note')) === 1 && (await feldWert(B.P, '.ticket-note')) === (await feldWert(A.P, '.ticket-note')), 6000);
pruefe('D2 … und sieht den vollen Stand der Beschreibung', (await feldWert(B.P, '.ticket-note')) === (await feldWert(A.P, '.ticket-note')) && /und mehr$/.test(await feldWert(B.P, '.ticket-note')), JSON.stringify([await feldWert(B.P, '.ticket-note'), await feldWert(A.P, '.ticket-note')]));
await insFeld(B.P, '.ticket-note', 'ende');
await B.P.keyboard.type(' Bernd', { delay: 30 });
await warteBis(A.P, async () => /Bernd$/.test((await feldWert(A.P, '.ticket-note')) ?? ''), 6000);
pruefe('D3 Bernd tippt mit, Anna sieht es', /und mehr Bernd$/.test((await feldWert(A.P, '.ticket-note')) ?? ''), await feldWert(A.P, '.ticket-note'));
// Protokoll: Bernd sieht Gerds und Annas Text und schreibt mit
await A.P.evaluate(() => document.activeElement?.blur?.()); await B.P.evaluate(() => document.activeElement?.blur?.());
await ticketZu(A.P); await ticketZu(B.P);
await warteBis(B.P, async () => (await protokollGemeinsam(B.P)) === 1 && (await protokollText(B.P)) === (await protokollText(A.P)), 8000);
pruefe('D4 Bernds Protokoll läuft gemeinsam und zeigt denselben Text', (await protokollGemeinsam(B.P)) === 1 && (await protokollText(B.P)) === (await protokollText(A.P)), JSON.stringify([await protokollText(B.P), await protokollText(A.P)]));
await insProtokoll(A.P, 'ende');
await A.P.keyboard.type(' Anna ungespeichert', { delay: 25 });
await warteBis(B.P, async () => /ungespeichert$/.test((await protokollText(B.P)) ?? ''), 5000);
pruefe('D5 was Anna gerade tippt, sieht Bernd sofort', /Anna ungespeichert$/.test((await protokollText(B.P)) ?? ''), await protokollText(B.P));
await insProtokoll(B.P, 'ende');
await B.P.keyboard.type(' und Bernd', { delay: 25 });
await warteBis(A.P, async () => /und Bernd$/.test((await protokollText(A.P)) ?? '') && (await protokollText(G.P)) === (await protokollText(A.P)), 6000);
const p3 = [await protokollText(A.P), await protokollText(G.P), await protokollText(B.P)];
pruefe('D6 zu dritt: alle sehen denselben Protokolltext', p3[0] === p3[1] && p3[1] === p3[2] && /und Bernd$/.test(p3[0]) && vorkommen(p3[0], 'Protokoll Start') === 1, JSON.stringify(p3));
await A.P.evaluate(() => document.activeElement?.blur?.()); await B.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(A.P, () => serverProtokoll() === p3[0], 12000);
pruefe('D7 der gemeinsame Stand steht auf dem Server', serverProtokoll() === p3[0], JSON.stringify({ s: serverProtokoll(), p: p3[0] }));
pruefe('D8 keine Seitenfehler', [A, G, B].every((g) => g.P.fehler.length === 0), JSON.stringify([A, G, B].map((g) => g.P.fehler)));

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Rückweg, wenn der Yjs-Teil nicht lädt ════');
await B.ctx.close(); await A.ctx.close(); await G.ctx.close();
// Zwei Gäste, bei denen der Yjs-Teil nicht lädt (ein Kern, der ablehnt — wie in m364/m372)
const R1 = await geraet('R1', standB, `#e=${token}`, PORT, true);
await warteBis(R1.P, async () => !!(await boardVon(R1.P, 'bx')), 12000);
await R1.P.locator('[data-taste="gast-name"]').fill('Rita');
await R1.P.locator('[data-taste="gast-name-ok"]').click(); await R1.P.waitForTimeout(500);
const R2 = await geraet('R2', standB, `#e=${token}`, PORT, true);
await warteBis(R2.P, async () => !!(await boardVon(R2.P, 'bx')), 12000);
await R2.P.locator('[data-taste="gast-name"]').fill('Rolf');
await R2.P.locator('[data-taste="gast-name-ok"]').click(); await R2.P.waitForTimeout(500);
await warteBis(R1.P, async () => /2 dabei/.test(await zahl(R1.P)) && /2 dabei/.test(await zahl(R2.P)), 12000);
await R1.P.waitForTimeout(1500);
pruefe('E1 ohne Yjs-Teil läuft das Protokoll allein weiter (kein gemeinsamer Modus)', (await protokollGemeinsam(R1.P)) === 0 && (await protokollGemeinsam(R2.P)) === 0 && (await karte(R1.P, 'p1').locator('.minutes-body .ProseMirror').count()) === 1);
pruefe('E2 Rita schreibt ins Protokoll', await insProtokoll(R1.P, 'ende'));
await R1.P.keyboard.type(' Rückweg', { delay: 30 });
await warteBis(R2.P, async () => (await R2.P.locator('[data-taste="live-sperre"]').count()) > 0, 5000);
pruefe('E3 … und hält die Karte wie vor M487 (Rolf sieht die Sperre)', (await R2.P.locator('[data-taste="live-sperre"]').count()) > 0);
await R1.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(R1.P, async () => /Rückweg$/.test(serverProtokoll()) && /Rückweg$/.test(await lokalProtokoll(R2.P)), 12000);
pruefe('E4 der Text kommt gespeichert bei Rolf und auf dem Server an', /Rückweg$/.test(serverProtokoll()) && /Rückweg$/.test(await lokalProtokoll(R2.P)), JSON.stringify({ s: serverProtokoll(), g: await lokalProtokoll(R2.P) }));
pruefe('E5 Ticket öffnen: die gewohnten Felder (nicht gemeinsam gebunden)', await ticketOeffnen(R2.P, 'Ticket zwei'));
await warteBis(R2.P, async () => (await R2.P.locator('.ticket-modal .ticket-note:not([readonly])').count()) === 1, 5000);
pruefe('E6 … das Feld nimmt Eingaben an', (await R2.P.locator('.ticket-modal .ticket-note:not([readonly])').count()) === 1 && (await feldGemeinsam(R2.P, '.ticket-note')) === 0);
const f2 = R2.P.locator('.ticket-modal .ticket-note').first();
await f2.click(); await f2.press('End'); await R2.P.keyboard.type(' allein', { delay: 25 });
await R2.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(R2.P, () => serverItem('t2')?.note === 'Neue Beschreibung allein', 10000);
pruefe('E7 … und das Getippte ist gespeichert', serverItem('t2')?.note === 'Neue Beschreibung allein', JSON.stringify(serverItem('t2')));
await ticketZu(R2.P);
pruefe('E8 keine Seitenfehler auf dem Rückweg', [R1, R2].every((g) => g.P.fehler.length === 0), JSON.stringify([R1, R2].map((g) => g.P.fehler)));

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Ohne Live-Verbindung wie bisher ════');
const ALLEIN = 6487;
const app2 = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app2.listen(ALLEIN, x));
const O = await geraet('O', standA, '', ALLEIN);
pruefe('F1 ohne Kanal: das Protokoll öffnet sich wie bisher', await insProtokoll(O.P, 'ende'));
await O.P.keyboard.type(' allein', { delay: 25 });
await O.P.evaluate(() => document.activeElement?.blur?.()); await O.P.waitForTimeout(500);
pruefe('F2 … gespeichert, ohne gemeinsamen Modus', (await lokalProtokoll(O.P)) === 'Protokoll Start allein' && (await protokollGemeinsam(O.P)) === 0, await lokalProtokoll(O.P));
pruefe('F3 Ticket: die gewohnten Felder', (await ticketOeffnen(O.P, 'Ticket eins')) && (await feldGemeinsam(O.P, '.ticket-note')) === 0);
const fo = O.P.locator('.ticket-modal .ticket-note').first();
await fo.click(); await fo.press('End'); await O.P.keyboard.type(' ohne Kanal', { delay: 25 });
await O.P.waitForTimeout(500);
pruefe('F4 … das Getippte ist gespeichert', (await lokalItem(O.P, 't1'))?.note === 'Beschreibung ohne Kanal', JSON.stringify(await lokalItem(O.P, 't1')));
await ticketZu(O.P);
pruefe('F5 ohne Kanal wird nichts von Yjs geladen', !geladen.get('O').some((u) => /gemeinsam/.test(u)));

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Texte ════');
const hilfeDe = readFileSync(path.join(__repo, 'src', 'components', 'HelpOverlay.tsx'), 'utf8');
const hilfeEn = readFileSync(path.join(__repo, 'src', 'components', 'HelpOverlayEn.tsx'), 'utf8');
pruefe('G1 die Hilfe nennt Protokoll und Ticket beim gemeinsamen Tippen (deutsch und englisch)', /Protokoll[^<]{0,200}Ticket|Ticket[^<]{0,200}Protokoll/.test(hilfeDe) && /minutes[^<]{0,200}ticket|ticket[^<]{0,200}minutes/i.test(hilfeEn));
pruefe('G2 keine Seitenfehler', [A, G, B, R1, R2, O].every((g) => g.P.fehler.length === 0), JSON.stringify([A, G, B, R1, R2, O].map((g) => g.P.fehler)));

await browser.close();
app.close(); app2.close();
console.log(`\n${ok} ok, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
