/**
 * M498 — Kanban-Ticket ganz gemeinsam bearbeiten: außer Titel und Beschreibung (M487) laufen Person, Frist, Priorität,
 * Spalte, Reihenfolge und die Checkliste (dazu, abhaken, umbenennen, umsortieren) im Live-Board über das Y-Dokument
 * der Karte — ohne Sperre, nichts geht verloren. Fremde Cursor stehen als Strich im Feld.
 * Supabase (Auth, PostgREST, RPCs, Realtime mit Broadcast + Presence) ist im Node-Prozess nachgebaut (Gerüst aus m487).
 *
 *   A  Live-Runde: Anna (Besitzerin) und Gerd (Gast ohne Konto) auf einem Board mit Kanban.
 *   B  Checkliste und Beschreibung zugleich: Gerd fügt hinzu, hakt ab, benennt um, während Anna tippt; beide fügen
 *      zugleich hinzu; Umsortieren (Alt+↑ und Ziehen) während der andere abhakt.
 *   C  Person, Frist und Priorität ändern, während der andere tippt — ohne Sperre, beides kommt an.
 *   D  Ticket verschieben, während getippt wird: im Ticket-Fenster und auf dem Board (ohne offenes Ticket-Fenster).
 *   E  Fremder Cursor: Strich in der Farbe der Person, wandert mit, Markierung, lesbar in Hell und Dunkel.
 *   F  Späteinsteiger bekommt alles.
 *   G  Rückweg ohne Yjs-Teil: gewohnte Felder, alles wird gespeichert.
 *   H  Ohne Live-Verbindung wie bisher (kein Yjs), Umbenennen und Umsortieren gehen auch allein.
 *   I  Texte, keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m498-ticket-gemeinsam.mjs`
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
const PORT = 5498;
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
  // Rückweg — der Yjs-Kern lehnt ab (vor dem ersten Laden, sonst käme er aus dem Service Worker)
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


// ---------- Board: ein Kanban ----------
const kanban = (id, x, y) => ({ id, type: 'kanban', width: 620, height: 420, position: { x, y }, data: {
  title: 'Aufgaben', cols: ['Offen', 'In Arbeit', 'Erledigt'], items: [
    { id: 't1', text: 'Ticket eins', col: 0, note: 'Beschreibung', subs: [{ id: 'p1', text: 'Punkt eins' }, { id: 'p2', text: 'Punkt zwei' }] },
    { id: 't2', text: 'Ticket zwei', col: 0 },
    { id: 't3', text: 'Ticket drei', col: 1 },
  ],
} });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const standA = {
  boards: [board('bx', 'Besprechung', [kanban('k1', 80, 60)])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1x', name: 'Allgemein', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
const standB = {
  boards: [board('bz', 'Nur hier', [])],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }],
  activeId: 'bz', view: 'board',
};
/** Ersatz für den Yjs-Kern, der ablehnt (Rückweg) — wie in m487 */
const KERN_AUS = 'export async function sitzungOeffnen() { throw new Error("M498: Yjs-Teil abgeschaltet"); }';

const karte = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`);
async function ticketOeffnen(P, text) {
  await karte(P, 'k1').locator('.kanban-item-text', { hasText: text }).first().click();
  return warteBis(P, async () => (await P.locator('.ticket-modal').count()) === 1, 4000);
}
const ticketZu = async (P) => { await P.locator('.ticket-modal .taskhub-x').click().catch(() => {}); await P.waitForTimeout(300); };
const feldGemeinsam = (P, sel) => P.locator(`.ticket-modal ${sel}[data-gemeinsam]`).count();
async function insFeld(P, sel, wo = 'ende') {
  await warteBis(P, async () => (await feldGemeinsam(P, sel)) === 1, 8000);
  const f = P.locator(`.ticket-modal ${sel}`).first();
  await f.click();
  await f.evaluate((el, w) => { const p = w === 'ende' ? el.value.length : 0; el.setSelectionRange(p, p); el.dispatchEvent(new Event('select')); }, wo);
  await P.waitForTimeout(80);
}
const feldWert = (P, sel) => P.locator(`.ticket-modal ${sel}`).first().inputValue().catch(() => null);
/** Was das Ticket-Fenster zeigt */
const fenster = (P) => P.evaluate(() => {
  const m = document.querySelector('.ticket-modal');
  if (!m) return null;
  return {
    note: m.querySelector('.ticket-note')?.value ?? null,
    titel: m.querySelector('.ticket-title')?.value ?? null,
    who: m.querySelector('.ticket-meta-row input[placeholder="Person"]')?.value ?? null,
    due: m.querySelector('.ticket-meta-row input[type="date"]')?.value ?? null,
    col: m.querySelector('.ticket-colsel')?.value ?? null,
    prio: [...m.querySelectorAll('.prio-btn')].findIndex((b) => b.classList.contains('on')),
    subs: [...m.querySelectorAll('.ticket-sub')].map((r) => [r.querySelector('.ticket-sub-text')?.value ?? '', !!r.querySelector('input[type="checkbox"]')?.checked]),
  };
});
const subsText = (f) => JSON.stringify(f?.subs ?? null);
const itemVon = (b, id) => b?.nodes.find((n) => n.id === 'k1')?.data.items?.find((i) => i.id === id);
const lokalItem = async (P, id) => itemVon(await boardVon(P, 'bx'), id);
const serverBoard = () => { try { return JSON.parse(zeileText(uidA, 'board-bx.json')); } catch { return null; } };
const serverItem = (id) => itemVon(serverBoard(), id);
const serverSubs = (id) => JSON.stringify((serverItem(id)?.subs ?? []).map((p) => [p.text, !!p.done]));
const reihe = (b) => (b?.nodes.find((n) => n.id === 'k1')?.data.items ?? []).map((i) => `${i.id}:${i.col}`).join(' ');
/** In welcher Spalte steht das Ticket auf dem Board (Index der Spalte im Kanban) */
const spalteAufBoard = (P, kid) => P.evaluate((k) => {
  const cols = [...document.querySelectorAll('.react-flow__node[data-id="k1"] .kanban-cols > .kanban-col')];
  return cols.findIndex((c) => !!c.querySelector(`[data-kid="${k}"]`));
}, kid);
const reiheAufBoard = (P, col) => P.evaluate((c) => {
  const cols = [...document.querySelectorAll('.react-flow__node[data-id="k1"] .kanban-cols > .kanban-col')];
  return [...(cols[c]?.querySelectorAll('[data-kid]') ?? [])].map((e) => e.dataset.kid).join(' ');
}, col);
const tippt = (P) => P.locator('.ticket-modal [data-taste="feld-tippt"]').allTextContents();
const toasts = new Map();
let abschnitt = 'A';
/** Hinweise mitschreiben (kurze Toasts verschwinden, bevor man nachsieht — docs/AGENTEN.md) */
async function toastMitschreiben(P, name) {
  toasts.set(name, []);
  await P.exposeFunction('__m498Toast', (t) => toasts.get(name).push(`${abschnitt}: ${t}`)).catch(() => {});
  await P.evaluate(() => {
    const mo = new MutationObserver(() => { const t = document.querySelector('.toast')?.textContent; if (t && t !== window.__m498Letzter) { window.__m498Letzter = t; window.__m498Toast(t); } });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
const sperrHinweis = (name) => (toasts.get(name) ?? []).filter((t) => /tippt gerade|bearbeitet diese Karte|Konflikt|überschrieben/i.test(t));
/** Mehrere Tasten in einem Zug mit kleiner Pause — gleichzeitig zu den Handgriffen des anderen */
const tippen = (P, text, delay = 45) => P.keyboard.type(text, { delay });

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Live-Runde mit Kanban ════');
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
await toastMitschreiben(A.P, 'A'); await toastMitschreiben(G.P, 'G');

// ══ B ═══════════════════════════════════════════════════════════════
abschnitt = 'B';
console.log('\n════ B: Checkliste ändern, während der andere die Beschreibung tippt ════');
pruefe('B1 Anna und Gerd öffnen dasselbe Ticket', (await ticketOeffnen(A.P, 'Ticket eins')) && (await ticketOeffnen(G.P, 'Ticket eins')));
await insFeld(A.P, '.ticket-note', 'ende');
await warteBis(G.P, async () => (await feldGemeinsam(G.P, '.ticket-note')) === 1, 8000);
// Anna tippt fortlaufend; Gerd fügt einen Punkt hinzu, hakt Punkt eins ab und benennt Punkt zwei um — zugleich
const annaTippt = tippen(A.P, ' von Anna und noch mehr Text', 60);
await G.P.locator('.ticket-modal .ticket-sub-add').fill('Punkt drei');
await G.P.locator('.ticket-modal .ticket-sub-add').press('Enter');
await G.P.locator('.ticket-modal [data-punkt="p1"] input[type="checkbox"]').click();
await G.P.locator('.ticket-modal [data-punkt="p2"] .ticket-sub-text').click();
await G.P.keyboard.press('End');
await tippen(G.P, ' geändert', 40);
await annaTippt;
const sollNote = 'Beschreibung von Anna und noch mehr Text';
const sollSubs = JSON.stringify([['Punkt eins', true], ['Punkt zwei geändert', false], ['Punkt drei', false]]);
await warteBis(A.P, async () => subsText(await fenster(A.P)) === sollSubs && subsText(await fenster(G.P)) === sollSubs
  && (await fenster(A.P))?.note === sollNote && (await fenster(G.P))?.note === sollNote, 10000);
const fA = await fenster(A.P); const fG = await fenster(G.P);
pruefe('B2 beide sehen dieselbe Beschreibung – Annas Text vollständig', fA?.note === sollNote && fG?.note === sollNote, JSON.stringify([fA?.note, fG?.note]));
pruefe('B3 beide sehen dieselbe Checkliste: neu, abgehakt, umbenannt', subsText(fA) === sollSubs && subsText(fG) === sollSubs, JSON.stringify([fA?.subs, fG?.subs]));
pruefe('B4 Gerd bekam keine Sperre und keinen Konflikt-Hinweis', sperrHinweis('G').length === 0 && sperrHinweis('A').length === 0, JSON.stringify([toasts.get('G'), toasts.get('A')]));
await A.P.evaluate(() => document.activeElement?.blur?.()); await G.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(A.P, () => serverItem('t1')?.note === sollNote && serverSubs('t1') === sollSubs, 12000);
pruefe('B5 auf dem Server: Beschreibung und Checkliste wie bei beiden', serverItem('t1')?.note === sollNote && serverSubs('t1') === sollSubs, JSON.stringify(serverItem('t1')));
await warteBis(G.P, async () => JSON.stringify(((await lokalItem(G.P, 't1'))?.subs ?? []).map((p) => [p.text, !!p.done])) === sollSubs, 10000);
pruefe('B6 … und im gespeicherten Stand beider Geräte', JSON.stringify(((await lokalItem(G.P, 't1'))?.subs ?? []).map((p) => [p.text, !!p.done])) === sollSubs
  && JSON.stringify(((await lokalItem(A.P, 't1'))?.subs ?? []).map((p) => [p.text, !!p.done])) === sollSubs);
// Beide fügen im selben Augenblick einen Punkt hinzu
await A.P.locator('.ticket-modal .ticket-sub-add').fill('Von Anna');
await G.P.locator('.ticket-modal .ticket-sub-add').fill('Von Gerd');
await Promise.all([A.P.locator('.ticket-modal .ticket-sub-add').press('Enter'), G.P.locator('.ticket-modal .ticket-sub-add').press('Enter')]);
const beideDa = (f) => (f?.subs ?? []).some((p) => p[0] === 'Von Anna') && (f?.subs ?? []).some((p) => p[0] === 'Von Gerd') && (f?.subs ?? []).length === 5;
await warteBis(A.P, async () => beideDa(await fenster(A.P)) && beideDa(await fenster(G.P)) && subsText(await fenster(A.P)) === subsText(await fenster(G.P)), 8000);
pruefe('B7 zugleich hinzugefügte Punkte: beide da, bei beiden in derselben Reihenfolge', beideDa(await fenster(A.P)) && subsText(await fenster(A.P)) === subsText(await fenster(G.P)), JSON.stringify([(await fenster(A.P))?.subs, (await fenster(G.P))?.subs]));
// Umsortieren per Alt+↑, während der andere abhakt
const vorher = (await fenster(G.P)).subs.map((p) => p[0]);
const idDrei = await G.P.evaluate(() => [...document.querySelectorAll('.ticket-modal .ticket-sub')].find((r) => r.querySelector('.ticket-sub-text')?.value === 'Punkt drei')?.dataset.punkt);
await G.P.locator(`.ticket-modal [data-punkt="${idDrei}"] .ticket-sub-text`).click();
await Promise.all([
  (async () => { await G.P.keyboard.press('Alt+ArrowUp'); await G.P.waitForTimeout(120); await G.P.keyboard.press('Alt+ArrowUp'); })(),
  A.P.locator('.ticket-modal [data-punkt="p2"] input[type="checkbox"]').click(),
]);
const sollReihe = ['Punkt drei', 'Punkt eins', 'Punkt zwei geändert', ...vorher.filter((t) => !['Punkt eins', 'Punkt zwei geändert', 'Punkt drei'].includes(t))];
const umsortiert = async (P) => { const f = await fenster(P); return JSON.stringify(f?.subs.map((p) => p[0])) === JSON.stringify(sollReihe) && f?.subs.find((p) => p[0] === 'Punkt zwei geändert')?.[1] === true; };
await warteBis(A.P, async () => (await umsortiert(A.P)) && (await umsortiert(G.P)), 8000);
pruefe('B8 Alt+↑ sortiert um, während Anna abhakt – bei beiden beides', (await umsortiert(A.P)) && (await umsortiert(G.P)), JSON.stringify([(await fenster(A.P))?.subs, (await fenster(G.P))?.subs]));
pruefe('B9 der Cursor bleibt beim Umsortieren im verschobenen Punkt', await G.P.evaluate(() => document.activeElement?.classList.contains('ticket-sub-text') && document.activeElement.value === 'Punkt drei'));
// Ziehen am Griff
const zielZeile = A.P.locator('.ticket-modal .ticket-sub').last();
await A.P.locator('.ticket-modal [data-punkt="p1"] .ticket-sub-griff').dragTo(zielZeile);
const letzter = async (P) => (await fenster(P))?.subs.at(-1)?.[0];
await warteBis(A.P, async () => (await letzter(A.P)) === 'Punkt eins' && (await letzter(G.P)) === 'Punkt eins', 8000);
pruefe('B10 Ziehen am Griff sortiert um – bei beiden', (await letzter(A.P)) === 'Punkt eins' && (await letzter(G.P)) === 'Punkt eins', JSON.stringify([(await fenster(A.P))?.subs, (await fenster(G.P))?.subs]));
// Entfernen, während der andere denselben Punkt umbenennt: Entfernen gewinnt, sonst nichts verloren
await G.P.locator('.ticket-modal .ticket-sub', { has: G.P.locator('.ticket-sub-text[value="Von Gerd"]') }).first().locator('button[title="Punkt entfernen"]').click().catch(async () => {
  await G.P.evaluate(() => [...document.querySelectorAll('.ticket-modal .ticket-sub')].find((r) => r.querySelector('.ticket-sub-text')?.value === 'Von Gerd')?.querySelector('button')?.click());
});
const ohneGerd = async (P) => { const f = await fenster(P); return f?.subs.length === 4 && !f.subs.some((p) => p[0] === 'Von Gerd'); };
await warteBis(A.P, async () => (await ohneGerd(A.P)) && (await ohneGerd(G.P)), 8000);
pruefe('B11 Entfernen kommt bei beiden an', (await ohneGerd(A.P)) && (await ohneGerd(G.P)), JSON.stringify((await fenster(A.P))?.subs));
const sollB12 = JSON.stringify((await fenster(A.P)).subs);
await warteBis(A.P, () => serverSubs('t1') === sollB12, 12000);
pruefe('B12 auf dem Server: Reihenfolge, Haken und Entfernen wie am Bildschirm', serverSubs('t1') === JSON.stringify((await fenster(A.P)).subs), JSON.stringify([serverSubs('t1'), (await fenster(A.P)).subs]));

// ══ C ═══════════════════════════════════════════════════════════════
abschnitt = 'C';
console.log('\n════ C: Person, Frist und Priorität, während der andere tippt ════');
await insFeld(A.P, '.ticket-note', 'ende');
const annaTippt2 = tippen(A.P, ' – zweiter Absatz', 60);
await G.P.locator('.ticket-modal .ticket-meta-row input[placeholder="Person"]').fill('Gerd Bauer');
await G.P.locator('.ticket-modal .ticket-meta-row input[type="date"]').fill('2026-12-24');
await G.P.locator('.ticket-modal .prio-btn.prio-2').click();
await annaTippt2;
const sollNote2 = `${sollNote} – zweiter Absatz`;
const felderDa = async (P) => { const f = await fenster(P); return f?.who === 'Gerd Bauer' && f?.due === '2026-12-24' && f?.prio === 1 && f?.note === sollNote2; };
await warteBis(A.P, async () => (await felderDa(A.P)) && (await felderDa(G.P)), 10000);
pruefe('C1 Anna sieht Person, Frist und Priorität sofort – ihr Text ist vollständig', await felderDa(A.P), JSON.stringify(await fenster(A.P)));
pruefe('C2 Gerds Felder bleiben stehen (vorher nahm der Schutz sie zurück)', await felderDa(G.P), JSON.stringify(await fenster(G.P)));
pruefe('C3 kein Sperr- oder Konflikt-Hinweis', sperrHinweis('G').length === 0 && sperrHinweis('A').length === 0, JSON.stringify([toasts.get('G'), toasts.get('A')]));
await A.P.evaluate(() => document.activeElement?.blur?.()); await G.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(A.P, () => serverItem('t1')?.who === 'Gerd Bauer' && serverItem('t1')?.due === '2026-12-24' && serverItem('t1')?.prio === 2 && serverItem('t1')?.note === sollNote2, 12000);
pruefe('C4 auf dem Server: Person, Frist, Priorität und Text', serverItem('t1')?.who === 'Gerd Bauer' && serverItem('t1')?.due === '2026-12-24' && serverItem('t1')?.prio === 2 && serverItem('t1')?.note === sollNote2, JSON.stringify(serverItem('t1')));
// Anna und Gerd ändern zugleich verschiedene Felder desselben Tickets (Person / Frist)
await Promise.all([
  A.P.locator('.ticket-modal .ticket-meta-row input[placeholder="Person"]').fill('Anna'),
  G.P.locator('.ticket-modal .ticket-meta-row input[type="date"]').fill('2027-01-08'),
]);
const zweiFelder = async (P) => { const f = await fenster(P); return f?.who === 'Anna' && f?.due === '2027-01-08'; };
await warteBis(A.P, async () => (await zweiFelder(A.P)) && (await zweiFelder(G.P)), 8000);
await A.P.evaluate(() => document.activeElement?.blur?.()); await G.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(A.P, () => serverItem('t1')?.who === 'Anna' && serverItem('t1')?.due === '2027-01-08', 12000);
pruefe('C5 zwei Felder zugleich: beide Änderungen bei beiden und auf dem Server', (await zweiFelder(A.P)) && (await zweiFelder(G.P)) && serverItem('t1')?.who === 'Anna' && serverItem('t1')?.due === '2027-01-08', JSON.stringify(serverItem('t1')));

// ══ D ═══════════════════════════════════════════════════════════════
abschnitt = 'D';
console.log('\n════ D: Ticket verschieben, während getippt wird ════');
await insFeld(A.P, '.ticket-note', 'ende');
const annaTippt3 = tippen(A.P, ' – dritter', 60);
await G.P.locator('.ticket-modal .ticket-colsel').selectOption('1');
await annaTippt3;
const sollNote3 = `${sollNote2} – dritter`;
await warteBis(A.P, async () => (await spalteAufBoard(A.P, 't1')) === 1 && (await spalteAufBoard(G.P, 't1')) === 1 && (await fenster(A.P))?.col === '1', 8000);
pruefe('D1 Gerd schiebt das Ticket im Ticket-Fenster nach „In Arbeit" – bei beiden sofort dort', (await spalteAufBoard(A.P, 't1')) === 1 && (await spalteAufBoard(G.P, 't1')) === 1 && (await fenster(A.P))?.col === '1');
pruefe('D2 … und Annas Text ist vollständig', (await fenster(A.P))?.note === sollNote3 && (await fenster(G.P))?.note === sollNote3, JSON.stringify([(await fenster(A.P))?.note, (await fenster(G.P))?.note]));
await ticketZu(G.P);
// Gerd hat kein Ticket offen — Anna tippt weiter im Ticket; Gerd schiebt ein anderes Ticket auf dem Board weiter
await insFeld(A.P, '.ticket-note', 'ende');
const annaTippt4 = tippen(A.P, ' vierter', 70);
await G.P.evaluate(() => document.querySelector('.react-flow__node[data-id="k1"] [data-kid="t2"] button[title="Weiter"]')?.click());
await annaTippt4;
const sollNote4 = `${sollNote3} vierter`;
await warteBis(A.P, async () => (await spalteAufBoard(A.P, 't2')) === 1 && (await spalteAufBoard(G.P, 't2')) === 1, 8000);
pruefe('D3 auf dem Board (ohne offenes Ticket-Fenster) verschoben, während Anna tippt – bei beiden', (await spalteAufBoard(A.P, 't2')) === 1 && (await spalteAufBoard(G.P, 't2')) === 1, JSON.stringify([await spalteAufBoard(A.P, 't2'), await spalteAufBoard(G.P, 't2')]));
pruefe('D4 kein Sperr-Hinweis beim Verschieben', sperrHinweis('G').length === 0, JSON.stringify(toasts.get('G')));
await A.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(A.P, () => serverItem('t1')?.col === 1 && serverItem('t2')?.col === 1 && serverItem('t1')?.note === sollNote4, 12000);
pruefe('D5 auf dem Server: beide Tickets in „In Arbeit", Text vollständig', serverItem('t1')?.col === 1 && serverItem('t2')?.col === 1 && serverItem('t1')?.note === sollNote4, JSON.stringify([serverItem('t1'), serverItem('t2')]));
await warteBis(A.P, async () => reihe(await boardVon(A.P, 'bx')) === reihe(await boardVon(G.P, 'bx')) && reihe(await boardVon(A.P, 'bx')) === reihe(serverBoard()), 10000);
pruefe('D6 Reihenfolge und Spalten gleich: Anna, Gerd, Server', reihe(await boardVon(A.P, 'bx')) === reihe(await boardVon(G.P, 'bx')) && reihe(await boardVon(A.P, 'bx')) === reihe(serverBoard()), JSON.stringify([reihe(await boardVon(A.P, 'bx')), reihe(await boardVon(G.P, 'bx')), reihe(serverBoard())]));
// Innerhalb der Spalte umsortieren (Ziehen auf dem Board mit der Maus), während Anna tippt: t3 nach ganz oben
await insFeld(A.P, '.ticket-note', 'ende');
const vorherReihe = await reiheAufBoard(G.P, 1);
const annaTippt5 = tippen(A.P, '.', 60);
const q = await karte(G.P, 'k1').locator('[data-kid="t3"] .kanban-item-text').boundingBox();
const z = await karte(G.P, 'k1').locator('[data-kid="t1"]').boundingBox();
await G.P.mouse.move(q.x + 8, q.y + q.height / 2);
await G.P.mouse.down();
for (let i = 1; i <= 8; i++) { await G.P.mouse.move(q.x + 8, q.y + q.height / 2 + ((z.y + 2) - (q.y + q.height / 2)) * i / 8); await G.P.waitForTimeout(30); }
await G.P.mouse.up();
await annaTippt5;
const sollReihe1 = ['t3', ...vorherReihe.split(' ').filter((x) => x !== 't3')].join(' ');
await warteBis(A.P, async () => (await reiheAufBoard(A.P, 1)) === sollReihe1 && (await reiheAufBoard(G.P, 1)) === sollReihe1, 8000);
pruefe('D7 innerhalb der Spalte umsortiert, während Anna tippt – bei beiden dieselbe Reihe', (await reiheAufBoard(A.P, 1)) === sollReihe1 && (await reiheAufBoard(G.P, 1)) === sollReihe1, JSON.stringify([vorherReihe, await reiheAufBoard(G.P, 1), await reiheAufBoard(A.P, 1)]));
await ticketZu(G.P);
await A.P.evaluate(() => document.activeElement?.blur?.());

// ══ E ═══════════════════════════════════════════════════════════════
abschnitt = 'E';
console.log('\n════ E: Fremder Cursor im Ticket-Feld ════');
pruefe('E1 Gerd öffnet das Ticket wieder', await ticketOeffnen(G.P, 'Ticket eins'));
await insFeld(A.P, '.ticket-note', 'ende');
await A.P.keyboard.type(' x', { delay: 30 });
const strich = (P, name) => P.evaluate((n) => {
  const c = [...document.querySelectorAll('.ticket-modal [data-taste="feld-cursor"]')].find((x) => x.dataset.name === n);
  const s = c?.querySelector('.feld-cursor-strich');
  if (!s) return null;
  const r = s.getBoundingClientRect(); const f = document.querySelector('.ticket-modal .ticket-note').getBoundingClientRect();
  return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height, fw: f.width, fh: f.height, farbe: getComputedStyle(s).backgroundColor, name: c.querySelector('.feld-cursor-name')?.textContent ?? null, markiert: c.querySelectorAll('.feld-cursor-markierung').length };
}, name);
await warteBis(G.P, async () => !!(await strich(G.P, annaName)), 6000);
const s1 = await strich(G.P, annaName);
pruefe('E2 Gerd sieht Annas Cursor als Strich im Feld, mit ihrem Namen', !!s1 && s1.w >= 1 && s1.w <= 3 && s1.h >= 10 && s1.x > 0 && s1.x < s1.fw && s1.y >= 0 && s1.y < s1.fh && s1.name === annaName, JSON.stringify(s1));
await G.P.screenshot({ path: `${SD}/m498-e-cursor.png` });
// Anna springt an den Anfang: der Strich wandert nach links oben
await A.P.keyboard.press('Control+Home');
await A.P.waitForTimeout(80);
await A.P.locator('.ticket-modal .ticket-note').evaluate((el) => el.dispatchEvent(new Event('select')));
await warteBis(G.P, async () => { const s = await strich(G.P, annaName); return !!s && s.x < 20 && s.y < s1.y + 1; }, 6000);
const s2 = await strich(G.P, annaName);
pruefe('E3 der Strich folgt Annas Cursor (an den Anfang)', !!s2 && s2.x < 20 && s2.y <= s1.y, JSON.stringify([s1, s2]));
// Gerd tippt vor Annas Stelle — ihr Strich bleibt hinter ihrem Wort (relative Position)
await A.P.keyboard.press('End');   // Ende der ersten Zeile
await A.P.waitForTimeout(80);
await A.P.locator('.ticket-modal .ticket-note').evaluate((el) => el.dispatchEvent(new Event('select')));
await warteBis(G.P, async () => { const s = await strich(G.P, annaName); return !!s && s.x > 30; }, 6000);
const s3 = await strich(G.P, annaName);
await insFeld(G.P, '.ticket-note', 'anfang');
await G.P.keyboard.type('Vorn ', { delay: 30 });
await warteBis(G.P, async () => { const s = await strich(G.P, annaName); return !!s && s.x > s3.x + 15; }, 6000);
const s4 = await strich(G.P, annaName);
pruefe('E4 tippt Gerd davor, wandert Annas Strich mit ihrem Text nach rechts', !!s4 && s4.x > s3.x + 15, JSON.stringify([s3, s4]));
// Markierung
await A.P.keyboard.press('Shift+Home');
await A.P.locator('.ticket-modal .ticket-note').evaluate((el) => el.dispatchEvent(new Event('select')));
await warteBis(G.P, async () => ((await strich(G.P, annaName))?.markiert ?? 0) > 0, 6000);
pruefe('E5 Annas Markierung ist bei Gerd leicht eingefärbt', ((await strich(G.P, annaName))?.markiert ?? 0) > 0);
// Lesbar in Hell und Dunkel: der Strich hebt sich ≥ 3:1 vom Feld ab
const kontrastStrich = (P, name) => P.evaluate((n) => {
  const c = [...document.querySelectorAll('.ticket-modal [data-taste="feld-cursor"]')].find((x) => x.dataset.name === n);
  const s = c?.querySelector('.feld-cursor-strich'); const f = document.querySelector('.ticket-modal .ticket-note');
  if (!s || !f) return 0;
  const rgb = (t) => (t.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const L = ([r, g, b]) => { const k = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b); };
  const a = L(rgb(getComputedStyle(s).backgroundColor)); const b = L(rgb(getComputedStyle(f).backgroundColor));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}, name);
const kHell = await kontrastStrich(G.P, annaName);
await G.P.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await G.P.waitForTimeout(300);
await A.P.keyboard.press('End'); await A.P.locator('.ticket-modal .ticket-note').evaluate((el) => el.dispatchEvent(new Event('select')));
await G.P.waitForTimeout(400);
const kDunkel = await kontrastStrich(G.P, annaName);
await G.P.screenshot({ path: `${SD}/m498-e-cursor-dunkel.png` });
await G.P.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
pruefe('E6 der Strich ist lesbar: Kontrast zum Feld ≥ 3:1 in Hell und Dunkel', kHell >= 3 && kDunkel >= 3, JSON.stringify({ kHell, kDunkel }));
await A.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(G.P, async () => !(await strich(G.P, annaName)), 6000);
pruefe('E7 verlässt Anna das Feld, verschwindet ihr Strich', !(await strich(G.P, annaName)));
await G.P.evaluate(() => document.activeElement?.blur?.());

// ══ F ═══════════════════════════════════════════════════════════════
abschnitt = 'F';
console.log('\n════ F: Späteinsteiger ════');
await insFeld(A.P, '.ticket-note', 'ende');
const B = await geraet('B', standB, `#e=${token}`);
await warteBis(B.P, async () => !!(await boardVon(B.P, 'bx')), 12000);
await B.P.locator('[data-taste="gast-name"]').fill('Bernd');
await B.P.locator('[data-taste="gast-name-ok"]').click(); await B.P.waitForTimeout(500);
await warteBis(B.P, async () => /3 dabei/.test(await zahl(B.P)), 8000);
// Gerd ändert die Person, Anna tippt — Bernd öffnet und sieht den gemeinsamen Stand
await G.P.locator('.ticket-modal .ticket-meta-row input[placeholder="Person"]').fill('Gerd und Anna');
await A.P.keyboard.type(' Bernd?', { delay: 30 });
pruefe('F1 Bernd öffnet dasselbe Ticket', await ticketOeffnen(B.P, 'Ticket eins'));
const gleichWieAnna = async () => { const a = await fenster(A.P); const b = await fenster(B.P); return !!a && !!b && JSON.stringify({ ...a }) === JSON.stringify({ ...b }); };
await warteBis(B.P, async () => (await feldGemeinsam(B.P, '.ticket-note')) === 1 && (await gleichWieAnna()) && (await fenster(B.P))?.who === 'Gerd und Anna', 10000);
pruefe('F2 Bernd sieht alles wie Anna: Text, Person, Frist, Spalte, Checkliste', (await gleichWieAnna()) && (await fenster(B.P))?.who === 'Gerd und Anna' && /Bernd\?$/.test((await fenster(B.P))?.note ?? ''), JSON.stringify([await fenster(A.P), await fenster(B.P)]));
await B.P.locator('.ticket-modal .ticket-sub-add').fill('Von Bernd');
await B.P.locator('.ticket-modal .ticket-sub-add').press('Enter');
await warteBis(A.P, async () => ((await fenster(A.P))?.subs ?? []).some((p) => p[0] === 'Von Bernd') && ((await fenster(G.P))?.subs ?? []).some((p) => p[0] === 'Von Bernd'), 8000);
pruefe('F3 zu dritt: Bernds neuer Punkt kommt bei Anna und Gerd an', ((await fenster(A.P))?.subs ?? []).some((p) => p[0] === 'Von Bernd') && ((await fenster(G.P))?.subs ?? []).some((p) => p[0] === 'Von Bernd'));
await A.P.evaluate(() => document.activeElement?.blur?.()); await G.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(A.P, () => (serverItem('t1')?.subs ?? []).some((p) => p.text === 'Von Bernd') && serverItem('t1')?.who === 'Gerd und Anna', 12000);
pruefe('F4 der gemeinsame Stand steht auf dem Server', (serverItem('t1')?.subs ?? []).some((p) => p.text === 'Von Bernd') && serverItem('t1')?.who === 'Gerd und Anna', JSON.stringify(serverItem('t1')));
pruefe('F5 keine Seitenfehler', [A, G, B].every((g) => g.P.fehler.length === 0), JSON.stringify([A, G, B].map((g) => g.P.fehler)));
pruefe('F6 kein Sperr- oder Konflikt-Hinweis während der ganzen Runde', sperrHinweis('A').length === 0 && sperrHinweis('G').length === 0, JSON.stringify([toasts.get('A'), toasts.get('G')]));

// ══ G ═══════════════════════════════════════════════════════════════
abschnitt = 'G';
console.log('\n════ G: Rückweg, wenn der Yjs-Teil nicht lädt ════');
await B.ctx.close(); await A.ctx.close(); await G.ctx.close();
const R1 = await geraet('R1', standB, `#e=${token}`, PORT, true);
await warteBis(R1.P, async () => !!(await boardVon(R1.P, 'bx')), 12000);
await R1.P.locator('[data-taste="gast-name"]').fill('Rita');
await R1.P.locator('[data-taste="gast-name-ok"]').click(); await R1.P.waitForTimeout(500);
const R2 = await geraet('R2', standB, `#e=${token}`, PORT, true);
await warteBis(R2.P, async () => !!(await boardVon(R2.P, 'bx')), 12000);
await R2.P.locator('[data-taste="gast-name"]').fill('Rolf');
await R2.P.locator('[data-taste="gast-name-ok"]').click(); await R2.P.waitForTimeout(500);
await warteBis(R1.P, async () => /2 dabei/.test(await zahl(R1.P)) && /2 dabei/.test(await zahl(R2.P)), 12000);
pruefe('G1 Ticket öffnen: die gewohnten Felder (nicht gemeinsam gebunden)', (await ticketOeffnen(R2.P, 'Ticket zwei')) && (await warteBis(R2.P, async () => (await R2.P.locator('.ticket-modal .ticket-note:not([readonly])').count()) === 1, 5000)) && (await feldGemeinsam(R2.P, '.ticket-note')) === 0);
await R2.P.locator('.ticket-modal .ticket-meta-row input[placeholder="Person"]').fill('Rolf');
await R2.P.locator('.ticket-modal .ticket-sub-add').fill('Allein');
await R2.P.locator('.ticket-modal .ticket-sub-add').press('Enter');
await R2.P.locator('.ticket-modal .ticket-sub-text').first().click();
await R2.P.keyboard.press('End'); await R2.P.keyboard.type('er Punkt', { delay: 25 });
await R2.P.evaluate(() => document.activeElement?.blur?.());
await warteBis(R2.P, () => serverItem('t2')?.who === 'Rolf' && (serverItem('t2')?.subs ?? []).some((p) => p.text === 'Alleiner Punkt'), 12000);
pruefe('G2 Person und Checkliste (auch umbenannt) sind gespeichert', serverItem('t2')?.who === 'Rolf' && (serverItem('t2')?.subs ?? []).some((p) => p.text === 'Alleiner Punkt'), JSON.stringify(serverItem('t2')));
await ticketZu(R2.P);
pruefe('G3 keine Seitenfehler auf dem Rückweg', [R1, R2].every((g) => g.P.fehler.length === 0), JSON.stringify([R1, R2].map((g) => g.P.fehler)));

// ══ H ═══════════════════════════════════════════════════════════════
abschnitt = 'H';
console.log('\n════ H: Ohne Live-Verbindung wie bisher ════');
const ALLEIN = 6498;
const app2 = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app2.listen(ALLEIN, x));
const O = await geraet('O', standA, '', ALLEIN);
pruefe('H1 Ticket: die gewohnten Felder', (await ticketOeffnen(O.P, 'Ticket eins')) && (await feldGemeinsam(O.P, '.ticket-note')) === 0);
await O.P.locator('.ticket-modal [data-punkt="p2"] .ticket-sub-text').click();
await O.P.keyboard.press('End'); await O.P.keyboard.type(' neu', { delay: 25 });
await O.P.keyboard.press('Alt+ArrowUp');
await O.P.locator('.ticket-modal .ticket-meta-row input[placeholder="Person"]').fill('Olga');
await O.P.waitForTimeout(500);
const oi = await lokalItem(O.P, 't1');
pruefe('H2 umbenannt, umsortiert und Person gespeichert – ohne Kanal', JSON.stringify((oi?.subs ?? []).map((p) => p.text)) === JSON.stringify(['Punkt zwei neu', 'Punkt eins']) && oi?.who === 'Olga', JSON.stringify(oi));
await ticketZu(O.P);
pruefe('H3 ohne Kanal wird nichts von Yjs geladen', !geladen.get('O').some((u) => /gemeinsam/i.test(u)), JSON.stringify(geladen.get('O').filter((u) => /gemeinsam/i.test(u))));

// ══ I ═══════════════════════════════════════════════════════════════
abschnitt = 'I';
console.log('\n════ I: Texte ════');
const hilfeDe = readFileSync(path.join(__repo, 'src', 'components', 'HelpOverlay.tsx'), 'utf8');
const hilfeEn = readFileSync(path.join(__repo, 'src', 'components', 'HelpOverlayEn.tsx'), 'utf8');
pruefe('I1 die Hilfe nennt das gemeinsame Ticket (deutsch und englisch)', /M498/.test(hilfeDe) && /M498/.test(hilfeEn) && /Checkliste/.test(hilfeDe) && /checklist/i.test(hilfeEn));
pruefe('I2 keine Seitenfehler', [A, G, B, R1, R2, O].every((g) => g.P.fehler.length === 0), JSON.stringify([A, G, B, R1, R2, O].map((g) => g.P.fehler)));

await browser.close();
app.close(); app2.close();
console.log(`\n${ok} ok, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
