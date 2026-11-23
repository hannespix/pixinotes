/**
 * M477 — Gemeinsam in einer Notiz tippen (Yjs über den vorhandenen Live-Kanal).
 * Supabase (Auth, PostgREST, RPCs, Realtime mit Broadcast + Presence) ist im Node-Prozess nachgebaut (Gerüst aus m375).
 *
 *   A  Live-Runde: solange niemand eine Notiz betritt, wird nichts von Yjs geladen und nichts gesendet.
 *   B  Anna und Gerd tippen gleichzeitig in dieselbe Notiz (hinten und vorne) — keine Sperre, beide sehen denselben
 *      Text, nichts geht verloren, nichts doppelt.
 *   C  Fremder Cursor mit Namen und Farbe der Person, fremde Markierung.
 *   D  Späteinsteiger Bernd bekommt den vollen (noch ungespeicherten) Stand und tippt zu dritt mit.
 *   E  Nach dem Verlassen steht das Block-JSON auf dem Server und bei allen gleich — jedes Stück einmal, kein Konflikt.
 *   F  Neu laden und wieder betreten: nichts doppelt; Fremde/kaputte Nachrichten aus dem Kanal wirken nicht; Start ohne Yjs.
 *   G  Ohne Live-Verbindung: wie bisher (kein gemeinsamer Modus, Yjs nicht geladen, Strg+Z im Board).
 *   H  Texte, keine Seitenfehler.
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
const PORT = 5477;
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

// ---------- Geräte ----------
const note = (id, text, x = 60, y = 60) => ({ id, type: 'note', width: 300, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const standA = {
  boards: [board('bx', 'Planung', [note('x1', 'Planung Notiz', 120, 80), note('x2', 'Zweite Notiz', 520, 80)])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
const standB = {
  boards: [board('bz', 'Nur hier', [note('z1', 'Z Notiz')])],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }],
  activeId: 'bz', view: 'board',
};
const geladen = new Map();   // Gerät → nachgeladene Dateien
async function geraet(name, stand, anker = '', port = PORT) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await dienste(ctx);
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
const karte = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`);
/** In die Notiz klicken und warten, bis der Cursor in ihrem Editor steht */
async function hinein(P, id, wo = 'ende') {
  await karte(P, id).locator('.note-editor').first().click({ position: { x: 30, y: 14 } });
  const drin = await warteBis(P, () => P.evaluate((i) => !!document.activeElement?.isContentEditable && document.activeElement.closest('.react-flow__node')?.dataset.id === i, id), 5000);
  await P.waitForTimeout(150);
  await P.keyboard.press(wo === 'ende' ? 'Control+End' : 'Control+Home');
  if (wo === 'ende') await P.keyboard.press('End'); else await P.keyboard.press('Home');
  return drin;
}
const heraus = async (P) => { await P.keyboard.press('Escape'); await P.waitForTimeout(120); await P.evaluate(() => document.activeElement?.blur?.()); await P.waitForTimeout(300); };
/** Der Text, den der Editor einer Notiz zeigt — ohne die Namensschilder fremder Cursor */
const editorText = (P, id) => P.evaluate((i) => {
  const pm = document.querySelector(`.react-flow__node[data-id="${i}"] .ProseMirror`) ?? document.querySelector(`.react-flow__node[data-id="${i}"] .notiz-ruhend`);
  if (!pm) return null;
  const k = pm.cloneNode(true);
  k.querySelectorAll('.bn-collaboration-cursor__base, .ProseMirror-yjs-cursor').forEach((e) => e.remove());
  return k.textContent.replace(/[⁠​]/g, '');
}, id);
const gemeinsamOffen = (P, id) => karte(P, id).locator('.note-gemeinsam').count();
/** Fremde Cursor in einer Notiz: Name und Farbe */
const fremdeCursor = (P, id) => P.evaluate((i) => [...document.querySelectorAll(`.react-flow__node[data-id="${i}"] .bn-collaboration-cursor__base`)].map((c) => {
  const caret = c.querySelector('.bn-collaboration-cursor__caret');
  return { name: c.querySelector('.bn-collaboration-cursor__label')?.textContent ?? '', farbe: caret ? getComputedStyle(caret).backgroundColor : '' };
}), id);
const chipFarbe = (P, name) => P.evaluate((n) => {
  const c = [...document.querySelectorAll('[data-taste="live-chip"]')].find((x) => x.dataset.name === n);
  if (!c) return null;
  const d = document.createElement('i'); d.style.color = c.style.getPropertyValue('--farbe'); document.body.append(d);
  const f = getComputedStyle(d).color; d.remove(); return f;
}, name);
const textDerBlocks = (blocks) => JSON.stringify(blocks ?? []).match(/"text":"([^"]*)"/g)?.map((t) => t.slice(8, -1)).join('') ?? '';
const lokalText = async (P, id) => textDerBlocks((await boardVon(P, 'bx'))?.nodes.find((n) => n.id === id)?.data.blocks);
const serverText = (id) => { try { return textDerBlocks(JSON.parse(zeileText(uidA, 'board-bx.json')).nodes.find((n) => n.id === id)?.data.blocks); } catch { return '?'; } };
const vorkommen = (t, s) => (t.match(new RegExp(s, 'g')) ?? []).length;
const notizY = () => sb.aufrufe.notizY ?? 0;

/** Ein Punkt, an dem man genau DIESE Karte greift (nicht ihren Text, keinen Knopf) */
const greifpunkt = (P, id) => P.evaluate((i) => {
  const karte = document.querySelector(`.react-flow__node[data-id="${i}"]`);
  if (!karte) return null;
  const r = karte.getBoundingClientRect();
  for (const dy of [7, 9, 5, 11, r.height - 7]) {
    for (let dx = 14; dx < r.width - 14; dx += 12) {
      const el = document.elementFromPoint(r.left + dx, r.top + dy);
      if (el && el.closest('.react-flow__node') === karte && !el.closest('.nodrag, button, input, [contenteditable="true"], .react-flow__resize-control')) return [r.left + dx, r.top + dy];
    }
  }
  return null;
}, id);
const lage = async (P, id) => JSON.stringify((await boardVon(P, 'bx')).nodes.find((n) => n.id === id)?.position);
const ziehen = async (P, id, dx, dy) => {
  const vorher = await lage(P, id);
  const g = await greifpunkt(P, id);
  if (!g) return 'kein Griff';
  await P.mouse.move(g[0], g[1]); await P.mouse.down(); await P.mouse.move(g[0] + dx / 2, g[1] + dy / 2, { steps: 6 }); await P.mouse.move(g[0] + dx, g[1] + dy, { steps: 6 }); await P.mouse.up();
  await P.waitForTimeout(900);
  return (await lage(P, id)) !== vorher;
};
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Live-Runde, die Notizen ruhen ════');
const A = await geraet('A', standA);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
await schliessen(A.P);
await warteBis(A.P, () => sb.live.length >= 1, 8000);
const topic = `realtime:pn-${kanalVon(uidA, 'bx')}`;
const G = await geraet('G', standB, `#e=${token}`);
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 8000);
await warteBis(A.P, async () => /2 dabei/.test(await zahl(A.P)), 8000);
const annaName = await G.P.evaluate(() => [...document.querySelectorAll('[data-taste="live-chip"]')].map((c) => c.dataset.name).find((n) => n !== 'Gerd') ?? '');
pruefe('A1 zwei im Live-Board', /2 dabei/.test(await zahl(A.P)) && /2 dabei/.test(await zahl(G.P)) && !!annaName, annaName);
await A.P.waitForTimeout(800);
pruefe('A2 solange niemand eine Notiz betritt: nichts von Yjs geladen, keine Nachricht', !geladen.get('A').some((u) => /gemeinsam/.test(u)) && !geladen.get('G').some((u) => /gemeinsam/.test(u)) && notizY() === 0, JSON.stringify({ n: notizY() }));

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Zwei tippen zugleich in derselben Notiz ════');
pruefe('B1 Anna betritt die Notiz', await hinein(A.P, 'x1', 'ende'));
await warteBis(G.P, async () => (await gemeinsamOffen(G.P, 'x1')) === 1, 6000);
pruefe('B2 bei Gerd wacht dieselbe Notiz auf und läuft gemeinsam mit (ohne dass er sie anfasst)', (await gemeinsamOffen(G.P, 'x1')) === 1 && (await gemeinsamOffen(A.P, 'x1')) === 1);
pruefe('B3 die Yjs-Teile kommen erst jetzt (nachgeladen)', geladen.get('A').some((u) => /gemeinsam/.test(u)));
pruefe('B4 Gerd betritt dieselbe Notiz – keine Sperre („bearbeitet gerade")', await hinein(G.P, 'x1', 'anfang'));
await G.P.waitForTimeout(400);
pruefe('B5 keine Karten-Sperre auf beiden Seiten', (await A.P.locator('[data-taste="live-sperre"]').count()) === 0 && (await G.P.locator('[data-taste="live-sperre"]').count()) === 0);
// gleichzeitig: Anna hinten, Gerd vorne
await Promise.all([
  A.P.keyboard.type(' Anna eins zwei drei', { delay: 35 }),
  G.P.keyboard.type('Gerd vorn ', { delay: 45 }),
]);
await Promise.all([
  A.P.keyboard.type(' und vier', { delay: 30 }),
  G.P.keyboard.type('schreibt mit ', { delay: 30 }),
]);
const soll = 'Gerd vorn schreibt mit Planung Notiz Anna eins zwei drei und vier';
await warteBis(A.P, async () => (await editorText(A.P, 'x1')) === (await editorText(G.P, 'x1')) && (await editorText(A.P, 'x1')) === soll, 6000);
const tA = await editorText(A.P, 'x1'); const tG = await editorText(G.P, 'x1');
console.log(`    Anna sieht: „${tA}"\n    Gerd sieht: „${tG}"`);
pruefe('B6 beide sehen denselben Text – nichts verloren, nichts doppelt', tA === tG && tA === soll, JSON.stringify({ tA, tG }));
await A.P.screenshot({ path: `${SD}/m477-b-anna.png` });
// Solange Anna darin tippt, bleibt die Karte, wo sie ist: Gerd kann sie nicht ziehen oder löschen (der Text bleibt frei)
await heraus(G.P);
const gezogen = await ziehen(G.P, 'x1', 160, 120);
pruefe('B7 Gerd kann die Notiz nicht verschieben, solange Anna darin tippt', gezogen === false, String(gezogen));
pruefe('B8 … ein Hinweis nennt Anna', new RegExp(annaName, 'i').test(await toast(G.P)), await toast(G.P));
await G.P.keyboard.press('Delete'); await G.P.waitForTimeout(600);
pruefe('B9 … und nicht löschen', (await boardVon(G.P, 'bx')).nodes.some((n) => n.id === 'x1'));
await G.P.mouse.click(1400, 870); await G.P.waitForTimeout(200);
pruefe('B10 Gerd betritt die Notiz wieder', await hinein(G.P, 'x1', 'anfang'));
await G.P.screenshot({ path: `${SD}/m477-b-gerd.png` });

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Der Cursor der anderen ════');
await A.P.keyboard.type('!', { delay: 20 });
await warteBis(G.P, async () => (await fremdeCursor(G.P, 'x1')).length === 1, 4000);
const cG = await fremdeCursor(G.P, 'x1');
pruefe('C1 Gerd sieht Annas Cursor mit ihrem Namen', cG.length === 1 && cG[0].name === annaName, JSON.stringify(cG));
pruefe('C2 … in ihrer Farbe (wie ihr Kürzel oben)', cG[0] && cG[0].farbe === (await chipFarbe(G.P, annaName)), `${cG[0]?.farbe} / ${await chipFarbe(G.P, annaName)}`);
await G.P.keyboard.type('?', { delay: 20 });
await warteBis(A.P, async () => (await fremdeCursor(A.P, 'x1')).some((c) => c.name === 'Gerd'), 4000);
const cA = await fremdeCursor(A.P, 'x1');
pruefe('C3 Anna sieht Gerds Cursor – in einer anderen Farbe', cA.length === 1 && cA[0].name === 'Gerd' && cA[0].farbe !== cG[0]?.farbe, JSON.stringify(cA));
// Markierung: Gerd markiert sein erstes Wort
await G.P.keyboard.press('Control+Home'); await G.P.keyboard.press('Shift+Control+ArrowRight');
await warteBis(A.P, () => A.P.evaluate(() => document.querySelectorAll('.react-flow__node[data-id="x1"] .ProseMirror-yjs-selection').length > 0), 4000);
pruefe('C4 Gerds Markierung ist bei Anna zu sehen', await A.P.evaluate(() => document.querySelectorAll('.react-flow__node[data-id="x1"] .ProseMirror-yjs-selection').length > 0));
await G.P.keyboard.press('End');
// Strg+Z im Text nimmt nur das Eigene zurück
await A.P.waitForTimeout(700);
const vorZ = await editorText(A.P, 'x1');
await A.P.keyboard.type(' XYZ', { delay: 20 });
await warteBis(G.P, async () => /XYZ/.test(await editorText(G.P, 'x1') ?? ''), 4000);
await A.P.waitForTimeout(700);
await A.P.keyboard.press('Control+z');
await warteBis(G.P, async () => !/XYZ/.test(await editorText(G.P, 'x1') ?? ''), 4000);
pruefe('C5 Strg+Z nimmt Annas letzte Eingabe zurück – bei allen, Gerds Text bleibt', (await editorText(A.P, 'x1')) === vorZ && (await editorText(G.P, 'x1')) === vorZ && /Gerd vorn/.test(vorZ), JSON.stringify({ vorZ, a: await editorText(A.P, 'x1'), g: await editorText(G.P, 'x1') }));

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Späteinsteiger ════');
const B = await geraet('B', standB, `#e=${token}`);
await warteBis(B.P, async () => !!(await boardVon(B.P, 'bx')), 12000);
await B.P.locator('[data-taste="gast-name"]').fill('Bernd');
await B.P.locator('[data-taste="gast-name-ok"]').click(); await B.P.waitForTimeout(500);
await warteBis(B.P, async () => /3 dabei/.test(await zahl(B.P)), 8000);
// Anna tippt weiter, noch ehe irgendetwas gespeichert sein muss
await A.P.keyboard.type(' fünf', { delay: 30 });
await warteBis(B.P, async () => (await gemeinsamOffen(B.P, 'x1')) === 1, 6000);
await warteBis(B.P, async () => (await editorText(B.P, 'x1')) === (await editorText(A.P, 'x1')), 6000);
const tB = await editorText(B.P, 'x1');
pruefe('D1 Bernd kommt dazu und sieht den vollen Stand (live, noch vor dem Speichern)', tB === (await editorText(A.P, 'x1')) && /fünf/.test(tB) && vorkommen(tB, 'Planung') === 1, JSON.stringify({ tB, tA: await editorText(A.P, 'x1') }));
pruefe('D2 Bernd tippt mit, ohne die Notiz zu sperren', await hinein(B.P, 'x1', 'ende'));
await B.P.keyboard.type(' Bernd', { delay: 30 });
await warteBis(A.P, async () => /Bernd$/.test(await editorText(A.P, 'x1') ?? '') && (await editorText(G.P, 'x1')) === (await editorText(A.P, 'x1')) && (await editorText(B.P, 'x1')) === (await editorText(A.P, 'x1')), 6000);
const t3 = [await editorText(A.P, 'x1'), await editorText(G.P, 'x1'), await editorText(B.P, 'x1')];
pruefe('D3 zu dritt: alle drei sehen denselben Text', t3[0] === t3[1] && t3[1] === t3[2] && /Bernd$/.test(t3[0]), JSON.stringify(t3));
await B.P.waitForTimeout(400);
pruefe('D4 Bernd sieht zwei fremde Cursor', (await fremdeCursor(B.P, 'x1')).length === 2, JSON.stringify(await fremdeCursor(B.P, 'x1')));

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Gespeichert wird das Block-JSON – einmal ════');
const vorher = vorkommen(serverText('x1'), 'Gerd vorn');
await heraus(A.P); await heraus(G.P); await heraus(B.P);
const endText = t3[0];
await warteBis(A.P, async () => serverText('x1') === endText && (await lokalText(A.P, 'x1')) === endText && (await lokalText(G.P, 'x1')) === endText && (await lokalText(B.P, 'x1')) === endText, 15000);
console.log(`    Server: „${serverText('x1')}"`);
pruefe('E1 auf dem Server steht der Text genau so, wie alle ihn sehen', serverText('x1') === endText, JSON.stringify({ server: serverText('x1'), endText, vorher }));
pruefe('E2 … jedes Stück genau einmal', vorkommen(serverText('x1'), 'Gerd vorn') === 1 && vorkommen(serverText('x1'), 'Anna eins') === 1 && vorkommen(serverText('x1'), 'Planung Notiz') === 1 && vorkommen(serverText('x1'), 'Bernd') === 1);
pruefe('E3 bei allen dreien ist dasselbe gespeichert (Block-JSON wie bisher)', (await lokalText(A.P, 'x1')) === endText && (await lokalText(G.P, 'x1')) === endText && (await lokalText(B.P, 'x1')) === endText);
const blocksA = (await boardVon(A.P, 'bx')).nodes.find((n) => n.id === 'x1').data.blocks;
pruefe('E4 das Format ist das gewohnte BlockNote-JSON (Absätze mit Text, keine Yjs-Daten)', Array.isArray(blocksA) && blocksA[0]?.type === 'paragraph' && !JSON.stringify(blocksA).includes('ydoc'), JSON.stringify(blocksA).slice(0, 200));
const toasts = await Promise.all([A, G, B].map((g) => g.P.evaluate(() => document.querySelector('.toast')?.textContent ?? '')));
pruefe('E5 kein Konflikt-Hinweis beim Abgleich', !toasts.some((t) => /Konflikt|gleichzeitig|überschrieben/i.test(t)), JSON.stringify(toasts));
const x2 = (b) => JSON.stringify(b?.nodes.find((n) => n.id === 'x2')?.data.blocks ?? null);
pruefe('E6 die andere Notiz blieb unberührt', x2(JSON.parse(zeileText(uidA, 'board-bx.json'))) === JSON.stringify([{ type: 'paragraph', content: 'Zweite Notiz' }]) && x2(await boardVon(G.P, 'bx')) === JSON.stringify([{ type: 'paragraph', content: 'Zweite Notiz' }]), x2(JSON.parse(zeileText(uidA, 'board-bx.json'))));

// Niemand tippt mehr (die Sitzungen sind noch offen): Gerd darf die Notiz verschieben, der Text bleibt, wie er ist
const lageVor = JSON.stringify(JSON.parse(zeileText(uidA, 'board-bx.json')).nodes.find((n) => n.id === 'x1')?.position);
const frei = await ziehen(G.P, 'x1', 120, 90);
const lageNach = await lage(G.P, 'x1');
await warteBis(A.P, async () => JSON.stringify(JSON.parse(zeileText(uidA, 'board-bx.json')).nodes.find((n) => n.id === 'x1')?.position) === lageNach && (await lage(A.P, 'x1')) === lageNach, 12000);
pruefe('E7 niemand tippt mehr: Gerd verschiebt die Notiz – die Lage gilt überall', frei === true && lageNach !== lageVor && (await lage(A.P, 'x1')) === lageNach && JSON.stringify(JSON.parse(zeileText(uidA, 'board-bx.json')).nodes.find((n) => n.id === 'x1')?.position) === lageNach, JSON.stringify({ frei, lageVor, lageNach, a: await lage(A.P, 'x1') }));
await A.P.waitForTimeout(1500);
pruefe('E8 … und der gemeinsame Text steht weiter vollständig auf dem Server', serverText('x1') === endText, JSON.stringify({ server: serverText('x1'), endText }));

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Wieder öffnen, Rechte, falsche Nachrichten ════');
// Neu laden: Gerd öffnet die Notiz erneut, Anna ist noch drin → kein doppelter Text
await G.P.reload({ waitUntil: 'networkidle' }); await G.P.waitForTimeout(1500);
await warteBis(G.P, async () => /3 dabei/.test(await zahl(G.P)), 10000);
pruefe('F1 nach dem Neuladen betritt Gerd die Notiz wieder', await hinein(G.P, 'x1', 'ende'));
await G.P.keyboard.type(' neu', { delay: 30 });
await warteBis(A.P, async () => /neu$/.test(await editorText(A.P, 'x1') ?? ''), 6000);
const tF = await editorText(A.P, 'x1');
pruefe('F2 sein neuer Text kommt an, der alte steht nicht doppelt da', /neu$/.test(tF) && vorkommen(tF, 'Planung Notiz') === 1 && tF === (await editorText(G.P, 'x1')), JSON.stringify({ tF, g: await editorText(G.P, 'x1') }));
await heraus(G.P);
// Ein Fremder, der nicht im Kanal ist, schiebt eine Änderung unter
const vorFremd = await editorText(A.P, 'x1');
fakeSenden(topic, 'notiz-y', { von: 'eindringling', c: 4242, n: 'x1', a: 'upd', d: 'AQGB5QEAhyEFcGFyYWdyYXBoBGVpbg==' });
fakeSenden(topic, 'notiz-y', { von: 'eindringling', c: 4242, n: 'x1', a: 'hallo', sv: 'AA==' });
// Ein Anwesender (vom Kanal gemeldet) mit Unsinn und Übergröße
fakeDa(topic, 'f1', { id: 'f1', name: 'Falsch', farbe: '#dc2626', karte: null, seit: null });
await A.P.waitForTimeout(400);
fakeSenden(topic, 'notiz-y', { von: 'f1', c: 99, n: 'x1', a: 'upd', d: 'ganz//kaputt==' });
fakeSenden(topic, 'notiz-y', { von: 'f1', c: 99, n: 'x1', a: 'upd', d: 'A'.repeat(70_000) });
fakeSenden(topic, 'notiz-y', { von: 'f1', c: 99, n: 'x1', a: 'aw', d: 'AQGB5QEAAntudWxsfQ==' });
await A.P.waitForTimeout(800);
pruefe('F3 Fremdes und Kaputtes ändert nichts und bricht nichts', (await editorText(A.P, 'x1')) === vorFremd && A.P.fehler.length === 0 && G.P.fehler.length === 0, JSON.stringify({ vor: vorFremd, nach: await editorText(A.P, 'x1'), f: A.P.fehler }));
fakeWeg(topic, 'f1', { id: 'f1', name: 'Falsch', farbe: '#dc2626', karte: null, seit: null });
pruefe('F4 das Editor-Paket im Start bleibt ohne Yjs (eigenes Nachlade-Paket „gemeinsam")', existsSync(DIST) && (() => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const start = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
  return start.length > 0 && !start.some((f) => /gemeinsam/.test(f)) && !start.some((f) => readFileSync(join(DIST, 'assets', f), 'utf8').includes('Yjs was already imported'));
})());

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Ohne Live-Verbindung wie bisher ════');
const ALLEIN = 6477;
const app2 = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app2.listen(ALLEIN, x));
const O = await geraet('O', standA, '', ALLEIN);
pruefe('G1 ohne Kanal: die Notiz öffnet sich wie bisher', await hinein(O.P, 'x1', 'ende'));
await O.P.keyboard.type(' allein', { delay: 25 });
await O.P.waitForTimeout(500);
pruefe('G2 … ohne gemeinsamen Modus, ohne Yjs zu laden', (await gemeinsamOffen(O.P, 'x1')) === 0 && !geladen.get('O').some((u) => /gemeinsam/.test(u)));
await heraus(O.P); await O.P.waitForTimeout(600);
pruefe('G3 … und das Tippen ist gespeichert', (await lokalText(O.P, 'x1')) === 'Planung Notiz allein', await lokalText(O.P, 'x1'));
await O.P.mouse.click(1400, 870); await O.P.waitForTimeout(300);
await O.P.keyboard.press('Control+z'); await O.P.waitForTimeout(900);
const nachZ = JSON.stringify((await boardVon(O.P, 'bx')).nodes.find((n) => n.id === 'x1').data.blocks);
pruefe('G4 Strg+Z auf dem Board nimmt den Text zurück wie bisher', !nachZ.includes('allein') && nachZ.includes('Planung Notiz'), nachZ);

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\n════ H: Texte ════');
const hilfeDe = readFileSync(path.join(__repo, 'src', 'components', 'HelpOverlay.tsx'), 'utf8');
const hilfeEn = readFileSync(path.join(__repo, 'src', 'components', 'HelpOverlayEn.tsx'), 'utf8');
pruefe('H1 die Hilfe erklärt das gemeinsame Tippen (deutsch und englisch)', /gleichzeitig in derselben Notiz/.test(hilfeDe) && /same note at the same time/.test(hilfeEn));
pruefe('H2 keine Seitenfehler', [A, G, B, O].every((g) => g.P.fehler.length === 0), JSON.stringify([A, G, B, O].map((g) => g.P.fehler)));

await browser.close();
app.close(); app2.close();
console.log(`\n${ok} ok, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
